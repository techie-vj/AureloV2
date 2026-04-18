package com.javikastudio.tidyapp

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.*

/**
 * IntentionPromptBridge — owns mindful pause app list, enable/disable toggle,
 * and daily pause/resist counters.
 * Phase 3: extracted from AppBridge.kt.
 */
class IntentionPromptBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    @JavascriptInterface fun getIntentionPromptApps(): String = prefs.getString(KEY_INTENTION_APPS,"[]") ?: "[]"

    @JavascriptInterface fun saveIntentionPromptApps(json: String) {
        runCatching { JSONArray(json) }.onFailure { return }
        prefs.edit().putString(KEY_INTENTION_APPS, json).apply()
        if (prefs.getBoolean(KEY_INTENTION_ENABLED, false)) {
            runCatching {
                val intent = Intent(context, AppMonitorService::class.java).apply { action = AppMonitorService.ACTION_INTENTION_START }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
            }
        }
        runCatching { context.sendBroadcast(Intent("${context.packageName}.INTENTION_APPS_CHANGED").apply { setPackage(context.packageName) }) }
    }

    @JavascriptInterface fun saveIntentionPromptEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_INTENTION_ENABLED, enabled).apply()
        if (enabled) {
            runCatching {
                val intent = Intent(context, AppMonitorService::class.java).apply { action = AppMonitorService.ACTION_INTENTION_START }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
            }
        } else {
            runCatching {
                val stopIntent = Intent(context, AppMonitorService::class.java).apply { action = AppMonitorService.ACTION_INTENTION_STOP }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(stopIntent) else context.startService(stopIntent)
            }
        }
        runCatching { context.sendBroadcast(Intent("${context.packageName}.INTENTION_APPS_CHANGED").apply { setPackage(context.packageName) }) }
    }

    @JavascriptInterface fun isIntentionPromptEnabled(): Boolean = prefs.getBoolean(KEY_INTENTION_ENABLED, false)

    @JavascriptInterface fun getIntentionPauseCount(): Int {
        if (prefs.getString(KEY_INTENTION_PAUSE_DATE,"") != todayDateString()) return 0
        return prefs.getInt(KEY_INTENTION_PAUSE_COUNT, 0)
    }

    @JavascriptInterface fun getIntentionResistCount(): Int {
        if (prefs.getString(KEY_INTENTION_RESIST_DATE,"") != todayDateString()) return 0
        return prefs.getInt(KEY_INTENTION_RESIST_COUNT, 0)
    }

    @JavascriptInterface fun recordIntentionPause() {
        val today = todayDateString()
        val current = if (prefs.getString(KEY_INTENTION_PAUSE_DATE,"") == today) prefs.getInt(KEY_INTENTION_PAUSE_COUNT,0) else 0
        prefs.edit().putString(KEY_INTENTION_PAUSE_DATE,today).putInt(KEY_INTENTION_PAUSE_COUNT,current+1).apply()
        (context as? Activity)?.runOnUiThread {
            webView.evaluateJavascript("if(typeof window.onIntentionResist==='function') window.onIntentionResist()", null)
        }
    }

    @JavascriptInterface fun recordIntentionResist() {
        val today = todayDateString()
        val current = if (prefs.getString(KEY_INTENTION_RESIST_DATE,"") == today) prefs.getInt(KEY_INTENTION_RESIST_COUNT,0) else 0
        prefs.edit().putString(KEY_INTENTION_RESIST_DATE,today).putInt(KEY_INTENTION_RESIST_COUNT,current+1).apply()
        (context as? Activity)?.runOnUiThread {
            webView.evaluateJavascript("if(typeof window.onIntentionResist==='function') window.onIntentionResist()", null)
        }
    }

    private fun todayDateString(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
}
