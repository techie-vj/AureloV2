package com.javikastudio.tidyapp

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * QuietHoursBridge — JS-facing surface for the Quiet Hours feature.
 *
 * The feature is intentionally minimal: a single time window with day
 * selector, schedules DND on/off and nothing else. No app blocking, no
 * filter, no morning summary, no streak. Coexists with Bedtime Mode via
 * [DndController].
 */
class QuietHoursBridge(
    private val context: Context,
    @Suppress("unused") private val webView: WebView,
    private val prefs: android.content.SharedPreferences
) : AppBridgeController {

    @JavascriptInterface
    fun getQuietHoursSettings(): String =
        prefs.getString(QUIET_HOURS_SETTINGS_V1, null) ?: "{}"

    /**
     * Saves the config and re-arms alarms in one call. JS only needs to call
     * this — alarm scheduling follows automatically.
     *
     * Side effects:
     *   • If new config has enabled=true and current time is inside the window,
     *     DND engages immediately (so toggling on at 2pm with a 9–5 window
     *     doesn't make the user wait until tomorrow for it to take effect).
     *   • If new config has enabled=false, cancels alarms and releases DND
     *     if Quiet Hours currently owns it.
     */
    @JavascriptInterface
    fun saveQuietHoursSettings(json: String) {
        val parsed = runCatching { JSONObject(json) }.getOrElse { return }
        val nowEnabled = parsed.optBoolean("enabled", false)

        QuietHoursPrefs.saveConfig(prefs, json)

        if (!nowEnabled) {
            QuietHoursReceiver.cancelAlarms(context)
            // Release DND if we currently own it; dismiss any persistent notif.
            if (DndController.currentOwner(context) == DND_OWNER_QUIET_HOURS) {
                DndController.release(context, DND_OWNER_QUIET_HOURS)
            }
            prefs.edit()
                .putBoolean(QUIET_HOURS_ACTIVE, false)
                .putLong(QUIET_HOURS_STARTS_AT_MS, 0L)
                .putLong(QUIET_HOURS_ENDS_AT_MS, 0L)
                .putLong(QUIET_HOURS_SNOOZE_UNTIL_TS, 0L)
                .remove(QUIET_HOURS_SKIPPED_TODAY)
                .apply()
            runCatching {
                (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .cancel(QuietHoursReceiver.NOTIF_ID_ACTIVE)
            }
            return
        }

        QuietHoursReceiver.scheduleAlarms(context)
        // Engage immediately if we just enabled while inside the window today.
        if (QuietHoursReceiver.isDayEnabled(parsed) &&
            QuietHoursReceiver.isCurrentlyInWindow(parsed)) {
            QuietHoursReceiver.resumeIfActive(context)
        }
    }

    /**
     * Sanitised state snapshot for the settings UI. Stable shape regardless
     * of whether the feature is enabled or active.
     */
    @JavascriptInterface
    fun getQuietHoursState(): String {
        val cfg = QuietHoursPrefs.getConfig(prefs)
        val enabled = cfg?.optBoolean("enabled", false) ?: false
        val active = prefs.getBoolean(QUIET_HOURS_ACTIVE, false) &&
            DndController.currentOwner(context) == DND_OWNER_QUIET_HOURS
        val pausedUntil = prefs.getLong(QUIET_HOURS_SNOOZE_UNTIL_TS, 0L)
            .let { if (it > System.currentTimeMillis()) it else 0L }
        return JSONObject().apply {
            put("enabled", enabled)
            put("active", active)
            put("startsAtMs", prefs.getLong(QUIET_HOURS_STARTS_AT_MS, 0L))
            put("endsAtMs", prefs.getLong(QUIET_HOURS_ENDS_AT_MS, 0L))
            put("pausedUntilMs", pausedUntil)
            put("hasDndPermission", DndController.hasPermission(context))
            put("skippedToday",
                prefs.getString(QUIET_HOURS_SKIPPED_TODAY, null) ==
                    QuietHoursReceiver.todayYmd())
        }.toString()
    }

    /** End the current window immediately (mirrors the notification action). */
    @JavascriptInterface
    fun endQuietHoursNow() {
        context.sendBroadcast(Intent(QuietHoursReceiver.ACTION_END_NOW)
            .apply { setPackage(context.packageName) })
    }

    /** Pause for N minutes (mirrors the notification action). */
    @JavascriptInterface
    fun pauseQuietHours(@Suppress("UNUSED_PARAMETER") mins: Int) {
        // v1 only supports 30-minute pause from the UI to match the notification
        // action; the mins parameter is reserved for future "Pause 15m / 1h"
        // variants without forcing a JS contract change.
        context.sendBroadcast(Intent(QuietHoursReceiver.ACTION_PAUSE_30)
            .apply { setPackage(context.packageName) })
    }
}
