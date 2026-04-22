package com.javikastudio.tidyapp

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/**
 * IntentionPromptBridge — owns mindful pause app list, enable/disable toggle,
 * and daily pause/resist counters.
 *
 * BUG FIXES:
 * 1. getIntentionPauseCount / getIntentionResistCount always returned 0 because
 *    BridgeKeys had the wrong key strings (missing "focus_" prefix). Fixed in
 *    BridgeKeys.kt — KEY_INTENTION_PAUSE_COUNT now = "focus_intention_pause_count".
 *
 * 2. recordIntentionPause() called window.onIntentionResist() instead of
 *    window.onIntentionPause() — copy-paste error. Fixed below.
 *
 * 3. New bridge methods getIntentionAppPauseCount / getIntentionAppResistCount
 *    expose the per-app counts stored by IntentionEngine so JS can show
 *    individual app statistics.
 *
 * 4. New bridge method getIntentionAppStats returns all per-app stats as JSON
 *    so the JS layer can render per-app rows without multiple bridge calls.
 */
class IntentionPromptBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    @JavascriptInterface fun getIntentionPromptApps(): String =
        prefs.getString(KEY_INTENTION_APPS, "[]") ?: "[]"

    @JavascriptInterface fun saveIntentionPromptApps(json: String) {
        runCatching { JSONArray(json) }.onFailure { return }
        prefs.edit().putString(KEY_INTENTION_APPS, json).apply()
        if (prefs.getBoolean(KEY_INTENTION_ENABLED, false)) {
            runCatching {
                val intent = Intent(context, AppMonitorService::class.java).apply {
                    action = AppMonitorService.ACTION_INTENTION_START
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    context.startForegroundService(intent) else context.startService(intent)
            }
        }
        runCatching {
            context.sendBroadcast(
                Intent("${context.packageName}.INTENTION_APPS_CHANGED")
                    .apply { setPackage(context.packageName) }
            )
        }
    }

    @JavascriptInterface fun saveIntentionPromptEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_INTENTION_ENABLED, enabled).apply()
        if (enabled) {
            runCatching {
                val intent = Intent(context, AppMonitorService::class.java).apply {
                    action = AppMonitorService.ACTION_INTENTION_START
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    context.startForegroundService(intent) else context.startService(intent)
            }
        } else {
            runCatching {
                val stopIntent = Intent(context, AppMonitorService::class.java).apply {
                    action = AppMonitorService.ACTION_INTENTION_STOP
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    context.startForegroundService(stopIntent) else context.startService(stopIntent)
            }
        }
        runCatching {
            context.sendBroadcast(
                Intent("${context.packageName}.INTENTION_APPS_CHANGED")
                    .apply { setPackage(context.packageName) }
            )
        }
    }

    @JavascriptInterface fun isIntentionPromptEnabled(): Boolean =
        prefs.getBoolean(KEY_INTENTION_ENABLED, false)

    // ── Aggregate counts ──────────────────────────────────────────────────

    @JavascriptInterface fun getIntentionPauseCount(): Int {
        if (prefs.getString(KEY_INTENTION_PAUSE_DATE, "") != todayDateString()) return 0
        return prefs.getInt(KEY_INTENTION_PAUSE_COUNT, 0)
    }

    @JavascriptInterface fun getIntentionResistCount(): Int {
        if (prefs.getString(KEY_INTENTION_RESIST_DATE, "") != todayDateString()) return 0
        return prefs.getInt(KEY_INTENTION_RESIST_COUNT, 0)
    }

    // ── Per-app counts ────────────────────────────────────────────────────

    /** Returns today's pause count for a specific app package, or 0. */
    @JavascriptInterface fun getIntentionAppPauseCount(packageName: String): Int {
        val dateKey  = KEY_INTENTION_APP_PAUSE_DATE_PREFIX  + packageName
        val countKey = KEY_INTENTION_APP_PAUSE_COUNT_PREFIX + packageName
        if (prefs.getString(dateKey, "") != todayDateString()) return 0
        return prefs.getInt(countKey, 0)
    }

    /** Returns today's resist count for a specific app package, or 0. */
    @JavascriptInterface fun getIntentionAppResistCount(packageName: String): Int {
        val dateKey  = KEY_INTENTION_APP_RESIST_DATE_PREFIX  + packageName
        val countKey = KEY_INTENTION_APP_RESIST_COUNT_PREFIX + packageName
        if (prefs.getString(dateKey, "") != todayDateString()) return 0
        return prefs.getInt(countKey, 0)
    }

    /**
     * Returns a JSON array of per-app stats for all currently-configured
     * intention apps. Each element: { packageName, pauses, resists }.
     * JS calls this once on render instead of calling getIntentionApp*Count
     * once per app (avoids repeated bridge round-trips).
     */
    @JavascriptInterface fun getIntentionAppStats(): String {
        val today = todayDateString()
        val apps  = runCatching { JSONArray(prefs.getString(KEY_INTENTION_APPS, "[]") ?: "[]") }
            .getOrElse { JSONArray() }
        android.util.Log.d("AureloBridge", "getIntentionAppStats: apps=${apps.length()}, file=${(prefs as? android.content.SharedPreferences)}")
        val result = JSONArray()
        for (i in 0 until apps.length()) {
            val pkg = apps.optJSONObject(i)?.optString("packageName")?.takeIf { it.isNotBlank() }
                ?: continue
            val pauseDateKey  = KEY_INTENTION_APP_PAUSE_DATE_PREFIX  + pkg
            val pauseCountKey = KEY_INTENTION_APP_PAUSE_COUNT_PREFIX + pkg
            val resistDateKey = KEY_INTENTION_APP_RESIST_DATE_PREFIX + pkg
            val resistCountKey= KEY_INTENTION_APP_RESIST_COUNT_PREFIX+ pkg
            val pauses  = if (prefs.getString(pauseDateKey,  "") == today) prefs.getInt(pauseCountKey,  0) else 0
            val resists = if (prefs.getString(resistDateKey, "") == today) prefs.getInt(resistCountKey, 0) else 0
            result.put(JSONObject().apply {
                put("packageName", pkg)
                put("pauses",  pauses)
                put("resists", resists)
            })
            android.util.Log.d("AureloBridge", "pkg=$pkg pauses=$pauses resists=$resists dateMatch=${prefs.getString(pauseDateKey,"")}, today=$today")
        }
        return result.toString()
    }

    // ── JS-callable record methods (called from web layer if needed) ───────

    /** BUG FIX: was calling window.onIntentionResist instead of window.onIntentionPause */
    @JavascriptInterface fun recordIntentionPause() {
        val today = todayDateString()
        val current = if (prefs.getString(KEY_INTENTION_PAUSE_DATE, "") == today)
            prefs.getInt(KEY_INTENTION_PAUSE_COUNT, 0) else 0
        prefs.edit()
            .putString(KEY_INTENTION_PAUSE_DATE, today)
            .putInt(KEY_INTENTION_PAUSE_COUNT, current + 1)
            .apply()
        (context as? Activity)?.runOnUiThread {
            // BUG FIX: was incorrectly calling onIntentionResist here
            webView.evaluateJavascript(
                "if(typeof window.onIntentionPause==='function') window.onIntentionPause()", null
            )
        }
    }

    @JavascriptInterface fun recordIntentionResist() {
        val today = todayDateString()
        val current = if (prefs.getString(KEY_INTENTION_RESIST_DATE, "") == today)
            prefs.getInt(KEY_INTENTION_RESIST_COUNT, 0) else 0
        prefs.edit()
            .putString(KEY_INTENTION_RESIST_DATE, today)
            .putInt(KEY_INTENTION_RESIST_COUNT, current + 1)
            .apply()
        (context as? Activity)?.runOnUiThread {
            webView.evaluateJavascript(
                "if(typeof window.onIntentionResist==='function') window.onIntentionResist()", null
            )
        }
    }

    /** Called from JS onIntentionPause(pkg) — writes per-app pause count to bridge prefs */
    @JavascriptInterface fun recordIntentionAppPause(packageName: String) {
        if (packageName.isBlank()) return
        val today    = todayDateString()
        val dateKey  = KEY_INTENTION_APP_PAUSE_DATE_PREFIX  + packageName
        val countKey = KEY_INTENTION_APP_PAUSE_COUNT_PREFIX + packageName
        val count = if (prefs.getString(dateKey, "") == today) prefs.getInt(countKey, 0) else 0
        prefs.edit()
            .putString(dateKey,  today)
            .putInt(   countKey, count + 1)
            .apply()
    }

    /** Called from JS onIntentionResist(pkg) — writes per-app resist count to bridge prefs */
    @JavascriptInterface fun recordIntentionAppResist(packageName: String) {
        if (packageName.isBlank()) return
        val today    = todayDateString()
        val dateKey  = KEY_INTENTION_APP_RESIST_DATE_PREFIX  + packageName
        val countKey = KEY_INTENTION_APP_RESIST_COUNT_PREFIX + packageName
        val count = if (prefs.getString(dateKey, "") == today) prefs.getInt(countKey, 0) else 0
        prefs.edit()
            .putString(dateKey,  today)
            .putInt(   countKey, count + 1)
            .apply()
    }

    private fun todayDateString(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
}