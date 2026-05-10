package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.location.Geocoder
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * BedtimeBridge — owns bedtime configuration, alarm scheduling, DND control,
 * brightness/grayscale, streak, and Sleep Score data access.
 * Phase 3: extracted from AppBridge.kt.
 */
class BedtimeBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    init {
        BedtimePrefs.migratePlainSettings(prefs, securePrefs)
    }

    @JavascriptInterface fun getBedtimeSettings(): String = BedtimePrefs.getSettings(prefs, securePrefs)
    @JavascriptInterface fun saveBedtimeSettings(json: String) {
        runCatching { JSONObject(json) }.onFailure { return }
        BedtimePrefs.saveSettings(prefs, securePrefs, json)
    }

    @JavascriptInterface fun saveBedtimeBlockedApps(appsJson: String) {
        runCatching {
            val cfg = try { JSONObject(BedtimePrefs.getSettings(prefs, securePrefs)) } catch (_:Exception) { JSONObject() }
            cfg.put("blockedApps", org.json.JSONArray(appsJson))
            BedtimePrefs.saveSettings(prefs, securePrefs, cfg.toString())
        }
    }

    @JavascriptInterface fun getBedtimeBlockedApps(): String {
        return runCatching {
            val cfg = JSONObject(BedtimePrefs.getSettings(prefs, securePrefs))
            when (val v = cfg.opt("blockedApps")) {
                is org.json.JSONArray -> v.toString()
                is String -> v
                else -> "[]"
            }
        }.getOrDefault("[]")
    }

    @JavascriptInterface fun getBedtimeStreak(): String = JSONObject().apply {
        val streak = prefs.getInt(BEDTIME_STREAK, 0); val lastDate = prefs.getString(BEDTIME_STREAK_LAST_DATE,"") ?: ""
        val bedOnTs = prefs.getLong(BEDTIME_ON_TS, 0L); val bedOffTs = prefs.getLong(BEDTIME_OFF_TS, 0L)
        val isActive = prefs.getBoolean(BEDTIME_BLOCK_ACTIVE,false) || prefs.getBoolean(BEDTIME_ACTIVE,false)
        val liveSnoozeCount = prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
        val lastNightSnoozeCount = prefs.getInt(BEDTIME_LAST_NIGHT_SNOOZES, 0)
        val snoozeCount = if (isActive) liveSnoozeCount else lastNightSnoozeCount
        put("streak",streak); put("lastDate",lastDate); put("bedOnTs",bedOnTs); put("bedOffTs",bedOffTs)
        val hasLastNight = prefs.contains(BEDTIME_LAST_NIGHT_SNOOZES)
        if (hasLastNight) put("lastNight", JSONObject().apply {
            put("hasData",true); put("bedtimeKept",prefs.getBoolean(BEDTIME_LAST_NIGHT_KEPT,true))
            put("snoozeCount",snoozeCount); put("appAttemptsTotal",prefs.getInt(BEDTIME_LAST_NIGHT_ATTEMPTS,0))
        })
        put("snoozeCount", snoozeCount)
    }.toString()

    @JavascriptInterface fun getBedtimeLastNightStats(): String = JSONObject().apply {
        put("snoozeCount",      prefs.getInt    (BEDTIME_LAST_NIGHT_SNOOZES,   0))
        put("appAttemptsTotal", prefs.getInt    (BEDTIME_LAST_NIGHT_ATTEMPTS,  0))
        put("bedtimeKept",      prefs.getBoolean(BEDTIME_LAST_NIGHT_KEPT,     false))
        put("hasData",          prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false))
    }.toString()

    @JavascriptInterface fun getBedtimeWeekDays(): String {
        val weekId = currentWeekId()
        if (prefs.getString(BEDTIME_WEEK_ID,"") != weekId) return "[false,false,false,false,false,false,false]"
        return prefs.getString(BEDTIME_WEEK_DAYS,"[false,false,false,false,false,false,false]") ?: "[false,false,false,false,false,false,false]"
    }

    @JavascriptInterface fun scheduleBedtimeAlarms(bedHour: Int, bedMinute: Int, wakeHour: Int, wakeMinute: Int, windDown: Boolean) {
        if (bedHour !in 0..23 || wakeHour !in 0..23 || bedMinute !in 0..59 || wakeMinute !in 0..59) return
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!BedtimePrefs.canScheduleExact(am)) {
            notifyExactAlarmMissing()
            return
        }
        fun nextTriggerMs(hour: Int, minute: Int): Long {
            val cal = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY,hour); set(Calendar.MINUTE,minute); set(Calendar.SECOND,0); set(Calendar.MILLISECOND,0) }
            if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR,1)
            return cal.timeInMillis
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_UPDATE_CURRENT
        val onPi = PendingIntent.getBroadcast(context,7001,Intent("${context.packageName}.BEDTIME_ON").apply { setPackage(context.packageName) },flags)
        BedtimePrefs.setExactSafely(context, am, AlarmManager.RTC_WAKEUP,nextTriggerMs(bedHour,bedMinute),onPi) { notifyExactAlarmMissing() }
        val offPi = PendingIntent.getBroadcast(context,7002,Intent("${context.packageName}.BEDTIME_OFF").apply { setPackage(context.packageName) },flags)
        BedtimePrefs.setExactSafely(context, am, AlarmManager.RTC_WAKEUP,nextTriggerMs(wakeHour,wakeMinute),offPi) { notifyExactAlarmMissing() }
        if (windDown) {
            val windPi = PendingIntent.getBroadcast(context,7003,Intent("${context.packageName}.BEDTIME_WINDOWN").apply { setPackage(context.packageName) },flags)
            BedtimePrefs.setExactSafely(context, am, AlarmManager.RTC_WAKEUP,nextTriggerMs(bedHour,bedMinute)-30*60_000L,windPi) { notifyExactAlarmMissing() }
        } else cancelWindDownAlarm()
    }

    @JavascriptInterface fun cancelBedtimeAlarms() {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val flagImmutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT else android.app.PendingIntent.FLAG_UPDATE_CURRENT
        listOf(7001 to "${context.packageName}.BEDTIME_ON", 7002 to "${context.packageName}.BEDTIME_OFF", 7003 to "${context.packageName}.BEDTIME_WINDOWN").forEach { (reqCode,action) ->
            runCatching { val pi = android.app.PendingIntent.getBroadcast(context,reqCode,Intent(action).apply { setPackage(context.packageName) },flagImmutable); am.cancel(pi) }
        }
    }

    private fun cancelWindDownAlarm() {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val flagImmutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT else android.app.PendingIntent.FLAG_UPDATE_CURRENT
        runCatching { val pi = android.app.PendingIntent.getBroadcast(context,7003,Intent("${context.packageName}.BEDTIME_WINDOWN").apply { setPackage(context.packageName) },flagImmutable); am.cancel(pi) }
    }

    @JavascriptInterface fun startBedtimeBlock(blockedAppsJson: String) = startService(AppMonitorService.ACTION_BEDTIME_START,"blocked_apps",blockedAppsJson)
    @JavascriptInterface fun updateBedtimeBlock(blockedAppsJson: String) = startService(AppMonitorService.ACTION_BEDTIME_UPDATE,"blocked_apps",blockedAppsJson)
    @JavascriptInterface fun stopBedtimeBlock() = startService(AppMonitorService.ACTION_BEDTIME_STOP_SOFT,null,null)
    @JavascriptInterface fun isBedtimeBlockActive(): Boolean = prefs.getBoolean(BEDTIME_BLOCK_ACTIVE, false)

    @JavascriptInterface fun isInBedtimeWindow(): Boolean {
        return try {
            val cfg = JSONObject(BedtimePrefs.getSettings(prefs, securePrefs))
            if (!cfg.optBoolean("enabled",false)) return false
            val bedH=cfg.optInt("bedHour",22); val bedM=cfg.optInt("bedMinute",0)
            val wakeH=cfg.optInt("wakeHour",7); val wakeM=cfg.optInt("wakeMinute",0)
            val cal=Calendar.getInstance(); val nowMins=cal.get(Calendar.HOUR_OF_DAY)*60+cal.get(Calendar.MINUTE)
            val bedMins=bedH*60+bedM; val wakeMins=wakeH*60+wakeM
            if (bedMins > wakeMins) nowMins >= bedMins || nowMins < wakeMins else nowMins >= bedMins && nowMins < wakeMins
        } catch (_:Exception) { false }
    }

    @JavascriptInterface fun snoozeBedtime(mins: Int) = startService(AppMonitorService.ACTION_BEDTIME_SNOOZE,"snooze_mins",mins)
    @JavascriptInterface fun recordBedtimeOff() { prefs.edit().putLong(BEDTIME_OFF_TS, System.currentTimeMillis()).apply() }
    @JavascriptInterface fun getBedtimeSnoozeEndsAt(): Long = prefs.getLong(BEDTIME_SNOOZE_UNTIL_TS, 0L)

    // ── DND / brightness ──────────────────────────────────────────────────────
    @JavascriptInterface fun hasDndPermission(): Boolean =
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).isNotificationPolicyAccessGranted

    @JavascriptInterface fun openDndSettings() {
        runCatching { context.startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }) }
            .onFailure { runCatching { context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply { putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,context.packageName); flags=Intent.FLAG_ACTIVITY_NEW_TASK }) } }
    }

    @JavascriptInterface fun setBedtimeDnd(enable: Boolean) {
        runCatching {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            if (!nm.isNotificationPolicyAccessGranted) { context.startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK }); return }
            nm.setInterruptionFilter(if (enable) android.app.NotificationManager.INTERRUPTION_FILTER_ALARMS else android.app.NotificationManager.INTERRUPTION_FILTER_ALL)
        }
    }

    @JavascriptInterface fun isDndPolicyGranted(): Boolean =
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).isNotificationPolicyAccessGranted

    /**
     * SF-09: Deprecated — system grayscale is no longer supported.
     *
     * The previous implementation used ColorDisplayManager.setSaturationLevel() on
     * API 34+ and the accessibility_display_daltonizer secure setting on older APIs.
     * Both paths conflicted with the Screen Filter overlay when both were active
     * simultaneously, producing double-tinted or washed-out rendering.
     *
     * This method is intentionally a no-op. The @JavascriptInterface annotation is
     * kept so that any old JS call paths (e.g. legacy saved config with grayscale:true)
     * silently succeed rather than throwing "method not found". Use the Screen Filter
     * feature (applyScreenFilter / removeScreenFilter) instead.
     */
    @JavascriptInterface fun setBedtimeGrayscale(@Suppress("UNUSED_PARAMETER") enable: Boolean) {
        // No-op: system grayscale removed — conflicts with Screen Filter overlay.
        // Old call sites from JS are safely swallowed here without crashing.
    }

    @JavascriptInterface fun hasSecureSettingsPermission(): Boolean =
        context.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == android.content.pm.PackageManager.PERMISSION_GRANTED

    private fun startService(action: String, extraKey: String?, extraVal: String?) {
        runCatching {
            val intent = Intent(context, AppMonitorService::class.java).apply {
                this.action = action
                if (extraKey != null && extraVal != null) putExtra(extraKey, extraVal)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        }
    }

    private fun startService(action: String, extraKey: String, extraVal: Int) {
        runCatching {
            val intent = Intent(context, AppMonitorService::class.java).apply {
                this.action = action
                putExtra(extraKey, extraVal)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else
                context.startService(intent)
        }
    }

    private fun notifyExactAlarmMissing() {
        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onExactAlarmPermissionMissing==='function') window.onExactAlarmPermissionMissing()",
                null
            )
        }
    }

    private fun currentWeekId(): String = java.text.SimpleDateFormat("yyyy-'W'ww", java.util.Locale.US).format(java.util.Date())

    // ── Screen Filter ─────────────────────────────────────────────────────────

    @JavascriptInterface fun getScreenFilterSettings(): String =
        prefs.getString(SCREEN_FILTER_SETTINGS_V1, "{}") ?: "{}"

    @JavascriptInterface fun saveScreenFilterSettings(json: String) {
        runCatching { org.json.JSONObject(json) }.onFailure { return }
        prefs.edit().putString(SCREEN_FILTER_SETTINGS_V1, json).apply()
    }

    /**
     * SF-BUG2 FIX: always route through AppMonitorService so there is only ever
     * ONE ScreenFilterEngine instance in WindowManager.
     *
     * The previous implementation called _getOrCreateFilterEngine() which allocated
     * engine A directly.  When AppMonitorService later started (e.g. for a Focus
     * session) it created engine B in onCreate() and assigned filterEngineInstance=B,
     * orphaning engine A's WindowManager view permanently — no subsequent call to
     * removeScreenFilter() or coordinator.show().suspend() could reach it.
     *
     * By routing all start/stop through service intents, the service is the sole
     * owner of the engine.  coordinator.show() and the poll loop both operate on
     * the same instance via filterEngineInstance, so suspend/resume and stop all
     * work correctly regardless of what other engines are running.
     */
    @JavascriptInterface fun applyScreenFilter(warmAlpha: Int, dimAlpha: Int, gradual: Boolean = false) {
        runCatching {
            val intent = android.content.Intent(context, AppMonitorService::class.java).apply {
                action = AppMonitorService.ACTION_FILTER_START
                putExtra("filter_warm",    warmAlpha)
                putExtra("filter_dim",     dimAlpha)
                putExtra("filter_gradual", gradual)
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else
                context.startService(intent)
        }
    }

    @JavascriptInterface fun removeScreenFilter() {
        // Clear the active pref immediately so restoreFromPrefs() on sticky restart
        // does not re-show the filter while the service is winding down.
        prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
        runCatching {
            val intent = android.content.Intent(context, AppMonitorService::class.java).apply {
                action = AppMonitorService.ACTION_FILTER_STOP
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else
                context.startService(intent)
        }
    }

    @JavascriptInterface fun isScreenFilterActive(): Boolean =
        prefs.getBoolean(SCREEN_FILTER_ACTIVE, false)

    /**
     * Called by the JS schedule engine (sun-based / custom-time Pro modes).
     * Persists the schedule config AND schedules AlarmManager alarms so the filter
     * starts/stops at the configured times even when the app is not in the foreground.
     */
    @JavascriptInterface fun startScreenFilterSchedule(json: String) {
        val cfg = runCatching { org.json.JSONObject(json) }.getOrElse { return }
        prefs.edit().putString(SCREEN_FILTER_SETTINGS_V1, json).apply()
        scheduleFilterAlarms(cfg)
    }

    /** Stops any active filter immediately, cancels schedule alarms, and clears the schedule flag. */
    @JavascriptInterface fun stopScreenFilterSchedule() {
        cancelFilterAlarms()
        prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
        runCatching {
            val intent = android.content.Intent(context, AppMonitorService::class.java).apply {
                action = AppMonitorService.ACTION_FILTER_STOP
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else
                context.startService(intent)
        }
    }

    /**
     * Reverse-geocodes a lat/lon to a city name using the on-device Android Geocoder.
     * Called from JS as the primary source for the sun-schedule city label (faster and
     * more reliable than the Nominatim network call from inside the WebView).
     * Returns the city string or "" on failure.
     */
    @JavascriptInterface fun reverseGeocodeCity(lat: Double, lon: Double): String {
        return runCatching {
            if (!Geocoder.isPresent()) return ""
            val geocoder = Geocoder(context, Locale.getDefault())
            val addresses = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Non-blocking API on API 33+
                var result: android.location.Address? = null
                geocoder.getFromLocation(lat, lon, 1) { list -> result = list.firstOrNull() }
                // Give the async callback a moment before falling back to empty
                Thread.sleep(1500)
                result?.let { listOf(it) } ?: emptyList()
            } else {
                @Suppress("DEPRECATION")
                geocoder.getFromLocation(lat, lon, 1) ?: emptyList()
            }
            val addr = addresses.firstOrNull() ?: return ""
            addr.locality ?: addr.subAdminArea ?: addr.adminArea ?: ""
        }.getOrDefault("")
    }

    // ── Filter alarm helpers ──────────────────────────────────────────────────

    /**
     * Schedules exact AlarmManager alarms for the filter's start/stop times.
     * Fires BedtimeReceiver with FILTER_SCHEDULE_ON / FILTER_SCHEDULE_OFF actions.
     * Called whenever the user saves a scheduled filter config.
     */
    private fun scheduleFilterAlarms(cfg: org.json.JSONObject) {
        val schedule = cfg.optString("schedule", "none")
        if (schedule == "none" || schedule.isBlank()) { cancelFilterAlarms(); return }

        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!BedtimePrefs.canScheduleExact(am)) return

        val startH: Int; val startM: Int; val endH: Int; val endM: Int
        if (schedule == "sun") {
            if (!cfg.has("sunsetHour") || !cfg.has("sunriseHour")) return
            startH = cfg.optInt("sunsetHour",  21); startM = cfg.optInt("sunsetMin",  0)
            endH   = cfg.optInt("sunriseHour",  7); endM   = cfg.optInt("sunriseMin", 0)
        } else {
            startH = cfg.optInt("schedStartHour", 21); startM = cfg.optInt("schedStartMin", 0)
            endH   = cfg.optInt("schedEndHour",    7); endM   = cfg.optInt("schedEndMin",   0)
        }

        setFilterAlarm(am, "${context.packageName}.FILTER_SCHEDULE_ON",  7015, startH, startM)
        setFilterAlarm(am, "${context.packageName}.FILTER_SCHEDULE_OFF", 7016, endH,   endM)
    }

    /** Cancels pending filter schedule alarms. */
    private fun cancelFilterAlarms() {
        val am    = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
        else PendingIntent.FLAG_NO_CREATE
        listOf("${context.packageName}.FILTER_SCHEDULE_ON"  to 7015,
            "${context.packageName}.FILTER_SCHEDULE_OFF" to 7016).forEach { (action, code) ->
            val pi = PendingIntent.getBroadcast(context, code,
                android.content.Intent(action).apply { setPackage(context.packageName) }, flags)
            pi?.let { am.cancel(it) }
        }
    }

    /** Schedules a single one-shot exact alarm for today (or tomorrow if the time has passed). */
    private fun setFilterAlarm(am: AlarmManager, action: String, requestCode: Int, hour: Int, minute: Int) {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0);          set(Calendar.MILLISECOND, 0)
        }
        if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR, 1)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else PendingIntent.FLAG_UPDATE_CURRENT
        val pi = PendingIntent.getBroadcast(context, requestCode,
            android.content.Intent(action).apply { setPackage(context.packageName) }, flags)
        BedtimePrefs.setExactSafely(context, am, AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
    }

}