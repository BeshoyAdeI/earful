package com.beshoy.earful.android;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(EarfulPlaybackPlugin.class);
        registerPlugin(EarfulDevicePlugin.class);
        registerPlugin(EarfulUpdaterPlugin.class);
        // Before Capacitor reads the launch intent: a shared file becomes an "open" it understands.
        setIntent(asOpen(getIntent()));
        super.onCreate(savedInstanceState);
        // Draw behind the status and navigation bars on every Android version; the page pads itself
        // (env(safe-area-inset-*)) and the SystemBars plugin keeps the icons readable for the theme.
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(asOpen(intent));
    }

    /**
     * "Share → Earful" sends the file as an attachment (ACTION_SEND + EXTRA_STREAM). Capacitor's App plugin only
     * reports opened links (ACTION_VIEW), so a shared file is turned into one: web/src/native/playlistFiles.ts then
     * handles it like a file opened with Earful. The read permission granted with the share stays with this activity.
     */
    private static Intent asOpen(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return intent;
        Uri stream;
        if (Build.VERSION.SDK_INT >= 33) stream = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        else stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (stream == null) return intent;
        Intent open = new Intent(Intent.ACTION_VIEW, stream);
        open.setDataAndType(stream, intent.getType());
        open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return open;
    }
}
