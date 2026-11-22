import Capacitor
import UIKit
import WebKit

/// The app's web view: Capacitor's own, plus the two bridges iOS needs that Android has in its Java code —
/// the lock screen (EarfulPlayback) and resolving a stream URL (EarfulYouTube).
final class EarfulWebViewController: CAPBridgeViewController {
    private let playback = EarfulPlayback()
    private let youtube = EarfulYouTube()
    private let audio = EarfulAudio()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Capacitor replaces the web view's userContentController after the configuration is built, so the handlers
        // are added here, once the web view exists.
        webView?.configuration.userContentController.add(playback, name: "earfulMedia")
        webView?.configuration.userContentController.add(youtube, name: "earfulResolve")
        webView?.configuration.userContentController.add(audio, name: "earfulAudio")
        playback.attach(webView)
        youtube.attach(webView)
        audio.attach(webView)
        // Swipe from the left edge goes back, like the Android back button: dialogs close, then pages.
        webView?.allowsBackForwardNavigationGestures = true
    }
}
