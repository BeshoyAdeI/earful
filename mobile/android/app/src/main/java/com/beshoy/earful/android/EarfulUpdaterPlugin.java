package com.beshoy.earful.android;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updates the Android app from inside it (web/src/stores/appUpdate.ts), like the desktop app does: download the new
 * APK from the GitHub release, then hand it to Android's PackageInstaller. Android closes Earful while it replaces it.
 *
 * The first update asks the user once to allow "Install unknown apps" for Earful, and Android shows its own
 * "Update this app?" prompt. From then on Earful is the app's installer, so on Android 12+ later updates go through
 * without that prompt (setRequireUserAction).
 */
@CapacitorPlugin(name = "EarfulUpdater")
public class EarfulUpdaterPlugin extends Plugin {

    static final String ACTION_INSTALL_STATUS = "com.beshoy.earful.android.INSTALL_STATUS";
    private static EarfulUpdaterPlugin instance;
    private volatile boolean downloading = false;

    @Override
    public void load() {
        instance = this;
    }

    private File apkFile() {
        File dir = new File(getContext().getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, "earful-update.apk");
    }

    /** Downloads the APK at `url`, reporting "progress" events, and checks that it really is a newer Earful. */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) {
            call.reject("Not a secure download link", "BAD_URL");
            return;
        }
        if (downloading) {
            call.reject("Already downloading", "BUSY");
            return;
        }
        downloading = true;
        new Thread(() -> {
            File target = apkFile();
            File partial = new File(target.getPath() + ".part");
            HttpURLConnection connection = null;
            try {
                connection = open(url);
                long total = connection.getContentLengthLong();
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[64 * 1024];
                    long done = 0;
                    long lastEmit = 0;
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        done += read;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 200) {
                            lastEmit = now;
                            JSObject progress = new JSObject();
                            progress.put("transferred", done);
                            progress.put("total", total);
                            notifyListeners("progress", progress);
                        }
                    }
                }
                if (total > 0 && partial.length() != total) throw new Exception("The download was cut off");
                checkApk(partial);
                if (target.exists()) //noinspection ResultOfMethodCallIgnored
                    target.delete();
                if (!partial.renameTo(target)) throw new Exception("Couldn't save the update");
                JSObject result = new JSObject();
                result.put("size", target.length());
                call.resolve(result);
            } catch (Exception error) {
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
                call.reject(error.getMessage() != null ? error.getMessage() : "Download failed", "DOWNLOAD_FAILED");
            } finally {
                if (connection != null) connection.disconnect();
                downloading = false;
            }
        }).start();
    }

    /** GitHub sends release downloads through a redirect; HttpURLConnection follows those only on the same host. */
    private static HttpURLConnection open(String url) throws Exception {
        for (int hops = 0; hops < 5; hops++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String next = connection.getHeaderField("Location");
                connection.disconnect();
                if (next == null || !next.startsWith("https://")) throw new Exception("Bad redirect");
                url = next;
                continue;
            }
            if (code != 200) {
                connection.disconnect();
                throw new Exception("Server answered " + code);
            }
            return connection;
        }
        throw new Exception("Too many redirects");
    }

    /** Refuses anything that isn't this app at a higher version (Android itself checks the signature). */
    private void checkApk(File apk) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getPath(), 0);
        if (downloaded == null) throw new Exception("The download isn't a valid app");
        if (!getContext().getPackageName().equals(downloaded.packageName)) throw new Exception("The download isn't Earful");
        PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), 0);
        if (versionCode(downloaded) <= versionCode(installed)) throw new Exception("The download isn't newer than this version");
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    /** Installs the downloaded APK. Asks for "Install unknown apps" first when Earful doesn't have it yet. */
    @PluginMethod
    public void install(PluginCall call) {
        if (!apkFile().exists()) {
            call.reject("Download the update first", "NOT_DOWNLOADED");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            startActivityForResult(call, settings, "afterPermission");
            return;
        }
        startInstall(call);
    }

    @ActivityCallback
    private void afterPermission(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Allow Earful to install apps to update it", "NOT_ALLOWED");
            return;
        }
        startInstall(call);
    }

    private void startInstall(PluginCall call) {
        Context context = getContext();
        File apk = apkFile();
        try {
            PackageInstaller installer = context.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            params.setSize(apk.length());
            if (Build.VERSION.SDK_INT >= 31) {
                params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            }
            int sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("earful.apk", 0, apk.length())) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    session.fsync(out);
                }
                Intent status = new Intent(context, InstallStatusReceiver.class).setAction(ACTION_INSTALL_STATUS);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, status, flags);
                session.commit(pending.getIntentSender());
            }
            // From here Android takes over: it may show its own prompt, then closes and replaces Earful.
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "Install failed", "INSTALL_FAILED");
        }
    }

    /** The installer's answer, relayed by InstallStatusReceiver: a failure reaches the page; success closes the app. */
    static void reportFailure(String message) {
        EarfulUpdaterPlugin plugin = instance;
        if (plugin == null) return;
        JSObject event = new JSObject();
        event.put("message", message);
        plugin.notifyListeners("installFailed", event);
    }
}
