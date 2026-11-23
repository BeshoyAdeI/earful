package com.beshoy.earful.android;

import android.app.UiModeManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/** What kind of device the app runs on (web/src/native/android.ts): the same APK serves phones and Android TV. */
@CapacitorPlugin(name = "EarfulDevice")
public class EarfulDevicePlugin extends Plugin {

    @PluginMethod
    public void sharePlaylist(PluginCall call) {
        String uri = call.getString("uri", "");
        String title = call.getString("title", "");
        try {
            Context context = getContext();
            Uri source = Uri.parse(uri);
            String path = source.getPath();
            if (!"file".equals(source.getScheme()) || path == null) {
                call.reject("INVALID_PLAYLIST_PATH");
                return;
            }
            File file = new File(path).getCanonicalFile();
            if (!context.getCacheDir().getCanonicalFile().equals(file.getParentFile()) || !file.getName().endsWith(".earful")) {
                call.reject("INVALID_PLAYLIST_PATH");
                return;
            }
            Uri shared = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType("application/x-earful-playlist")
                .putExtra(Intent.EXTRA_STREAM, shared)
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri(title, shared));
            getActivity().startActivity(Intent.createChooser(send, null));
            call.resolve();
        } catch (Exception error) {
            call.reject("PLAYLIST_SHARE_FAILED", error);
        }
    }

    @PluginMethod
    public void info(PluginCall call) {
        Context context = getContext();
        UiModeManager uiMode = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        boolean tv =
            (uiMode != null && uiMode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) ||
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        JSObject result = new JSObject();
        result.put("tv", tv);
        call.resolve(result);
    }
}
