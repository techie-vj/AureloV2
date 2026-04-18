package com.javikastudio.tidyapp

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray

/**
 * FocusRoutineBridge — owns recurring focus schedules (routines), alarm
 * scheduling, and exact-alarm permission checks.
 * Phase 3: extracted from AppBridge.kt.
 */
class FocusRoutineBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    @JavascriptInterface
    fun getFocusRoutines(): String = securePrefs.getString(KEY_FOCUS_ROUTINES, "[]") ?: "[]"

    @JavascriptInterface
    fun saveFocusRoutines(json: String) {
        // SEC-08 FIX: routines stored only in EncryptedSharedPreferences — no plaintext mirror
        securePrefs.edit().putString(KEY_FOCUS_ROUTINES, json).apply()
    }

    @JavascriptInterface
    fun scheduleRoutineAlarm(json: String) { RoutineAlarmReceiver.schedule(context, json) }

    @JavascriptInterface
    fun cancelRoutineAlarm(routineId: String) { RoutineAlarmReceiver.cancel(context, routineId) }

    /**
     * Returns true if the app can schedule exact alarms.
     * On API < 31 always returns true; on API 31+ checks AlarmManager.canScheduleExactAlarms().
     */
    @JavascriptInterface
    fun canScheduleExactAlarms(): Boolean {
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            am.canScheduleExactAlarms()
        } else true
    }
}
