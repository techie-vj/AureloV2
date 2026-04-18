package com.javikastudio.tidyapp

import android.content.Context
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope

/**
 * Marker interface implemented by every domain bridge controller.
 *
 * All controllers share the same constructor signature:
 *   (context, webView, prefs, securePrefs, bridgeScope)
 *
 * The bridgeScope is owned by the AppBridge coordinator and cancelled
 * in AppBridge.destroy() — controllers must NOT create their own scopes.
 */
interface AppBridgeController {
    /** Called by AppBridge.destroy() to release any held resources. */
    fun onDestroy() { /* default no-op */ }
}
