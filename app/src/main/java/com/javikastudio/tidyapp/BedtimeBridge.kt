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

    /**
     * BM-003 FIX: when the user toggles Bedtime Mode off from the settings UI the
     * streak must be reset to 0.  Previously only the alarm path ever wrote the
     * streak, so toggling off left a stale positive value that persisted forever.
     */
    @JavascriptInterface fun saveBedtimeSettings(json: String) {
        val parsed = runCatching { JSONObject(json) }.getOrElse { return }

        // Detect enabled → disabled transition BEFORE saving the new value.
        val wasEnabled = try {
            JSONObject(BedtimePrefs.getSettings(prefs, securePrefs)).optBoolean("enabled", false)
        } catch (_: Exception) { false }
        val nowEnabled = parsed.optBoolean("enabled", false)
        BedtimePrefs.saveSettings(prefs, securePrefs, json)
// FIX: if disabling, force a synchronous commit so the value is readable immediately on restart
        if (wasEnabled && !nowEnabled) {
            prefs.edit()
                .putInt(BEDTIME_STREAK, 0)
                .remove(BEDTIME_STREAK_LAST_DATE)
                .putBoolean(BEDTIME_ACTIVE, false)         // belt-and-suspenders
                .putBoolean(BEDTIME_BLOCK_ACTIVE, false)
                .commit()  // synchronous
        }
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
        val isActive = prefs.getBoolean(BEDTIME_ACTIVE, false)  // FIX-BUG2: use only BLOCK_ACTIVE; BEDTIME_ACTIVE stays true until morning alarm
        val liveSnoozeCount = prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
        val lastNightSnoozeCount = prefs.getInt(BEDTIME_LAST_NIGHT_SNOOZES, 0)
        val snoozeCount = if (isActive) liveSnoozeCount else lastNightSnoozeCount
        put("streak",streak); put("lastDate",lastDate); put("bedOnTs",bedOnTs); put("bedOffTs",bedOffTs)
        // FIX-BUG2: expose skippedTonight so JS strip renders "Starts tonight" not "Active"
        put("skippedTonight", prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT, false))
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
        if (!BedtimePrefs.canScheduleExact(am)) { notifyExactAlarmMissing(); return }
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

    /**
     * Returns true when the user tapped "Turn Off" from the bedtime active notification
     * during the current bedtime window. The flag is set by ACTION_BEDTIME_STOP and
     * cleared when BEDTIME_ON fires at the start of the next night (or BEDTIME_OFF at
     * morning wake). JS uses this to show "Starts tomorrow" instead of "Bedtime Active".
     */
    @JavascriptInterface fun isBedtimeSkippedTonight(): Boolean =
        prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT, false)

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

    /**
     * Skips bedtime for tonight only — stops blocking and sets BEDTIME_SKIPPED_TONIGHT
     * so the UI shows the next scheduled window, but leaves recurring alarms intact
     * so bedtime resumes automatically tomorrow night.
     * Unlike stopBedtimeBlock() (STOP_SOFT), this fires ACTION_BEDTIME_STOP which
     * calls BedtimeBlockingEngine.stop(wasNatural=false), persisting the skipped flag.
     */
    @JavascriptInterface fun skipBedtimeTonight() {
        // FIX (restart bug): write all three flags atomically and synchronously with
        // commit() BEFORE starting the service intent. This guarantees that even if
        // the process is killed between here and onStartCommand(ACTION_BEDTIME_STOP),
        // the prefs are already correct so:
        //   • isInBedtimeWindow()      → false  (skipped guard added above)
        //   • isBedtimeFilterM
        //   anaged() → false  (BEDTIME_ACTIVE cleared here)
        //   • restoreFromPrefs()       → exits early at bedtime_block_active=false
        //   • DND is not re-enabled on service restart
        prefs.edit()
            .putBoolean(BEDTIME_SKIPPED_TONIGHT, true)
            .putBoolean("bedtime_block_active", false)
            .putBoolean(BEDTIME_ACTIVE, false)        // ← new: stops isBedtimeFilterManaged returning true
            .putBoolean(BEDTIME_BLOCK_ACTIVE, false)  // ← new: belt-and-suspenders (same key, constant form)
            .commit()
        startService(AppMonitorService.ACTION_BEDTIME_STOP, null, null)
        runCatching { setBedtimeDnd(false) }
        runCatching { recordBedtimeOff() }
        // Screen filter: stop if bedtime was managing it
        runCatching {
            val intent = android.content.Intent(context, AppMonitorService::class.java).apply {
                action = AppMonitorService.ACTION_FILTER_STOP
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }

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
        // Safety guard: never re-enable DND from JS if the block is not active
        // or the user has already skipped tonight. Prevents stale JS state or
        // async pref-write race from re-activating DND after user turns off.
        if (enable) {
            if (!prefs.getBoolean(BEDTIME_BLOCK_ACTIVE, false) ||
                prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT, false)) {
                android.util.Log.w("AureloBedtimeDND",
                    "setBedtimeDnd(true) BLOCKED — BLOCK_ACTIVE=${prefs.getBoolean(BEDTIME_BLOCK_ACTIVE,false)}, SKIPPED=${prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT,false)}")
                return
            }
        }
        runCatching {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            if (!nm.isNotificationPolicyAccessGranted) { context.startActivity(Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK }); return }
            nm.setInterruptionFilter(if (enable) android.app.NotificationManager.INTERRUPTION_FILTER_ALARMS else android.app.NotificationManager.INTERRUPTION_FILTER_ALL)
        }
    }

    @JavascriptInterface fun isDndPolicyGranted(): Boolean =
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).isNotificationPolicyAccessGranted

    /**
     * SF-09: Deprecated — system grayscale is no longer supported (conflicts with Screen Filter).
     * Kept as a no-op so legacy JS call paths silently succeed.
     */
    @JavascriptInterface fun setBedtimeGrayscale(@Suppress("UNUSED_PARAMETER") enable: Boolean) {
        // No-op: system grayscale removed — conflicts with Screen Filter overlay.
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
                this.action = action; putExtra(extraKey, extraVal)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }

    private fun notifyExactAlarmMissing() {
        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onExactAlarmPermissionMissing==='function') window.onExactAlarmPermissionMissing()", null)
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

    @JavascriptInterface fun applyScreenFilter(warmAlpha: Int, dimAlpha: Int, gradual: Boolean = false) {
        runCatching {
            val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfg = if (!sfRaw.isNullOrBlank()) runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
            val preset  = sfCfg?.optString("preset", ScreenFilterEngine.PRESET_WARM) ?: ScreenFilterEngine.PRESET_WARM
            val customR = sfCfg?.optInt("customR", 255) ?: 255
            val customG = sfCfg?.optInt("customG", 100) ?: 100
            val customB = sfCfg?.optInt("customB", 0)   ?: 0
            val intent = android.content.Intent(context, AppMonitorService::class.java).apply {
                action = AppMonitorService.ACTION_FILTER_START
                putExtra("filter_warm",    warmAlpha)
                putExtra("filter_dim",     dimAlpha)
                putExtra("filter_gradual", gradual)
                putExtra("filter_preset",  preset)
                putExtra("filter_custom_r", customR)
                putExtra("filter_custom_g", customG)
                putExtra("filter_custom_b", customB)
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else
                context.startService(intent)
        }
    }

    /**
     * ISSUE-4 FIX: Returns true when bedtime mode is currently active AND the screen
     * filter is managed by bedtime (bedtimeAutoApply=true in screen filter settings).
     */
    @JavascriptInterface fun isBedtimeFilterManaged(): Boolean {
        val bedtimeActive = prefs.getBoolean(BEDTIME_BLOCK_ACTIVE, false) ||
                            prefs.getBoolean(BEDTIME_ACTIVE, false)
        if (!bedtimeActive) return false
        val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null) ?: return false
        return runCatching { org.json.JSONObject(sfRaw) }
            .getOrNull()?.optBoolean("bedtimeAutoApply", true) ?: true
    }

    /**
     * Stops the screen filter overlay.
     * ISSUE-4 FIX: no-op when bedtime is managing the filter.
     */
    @JavascriptInterface fun removeScreenFilter() {
        if (isBedtimeFilterManaged()) {
            android.util.Log.d("BedtimeBridge",
                "removeScreenFilter: skipped — bedtime is managing the filter.")
            return
        }
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
     * Force-removes the screen filter even if bedtime is managing it.
     */
    @JavascriptInterface fun removeScreenFilterForced() {
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

    @JavascriptInterface fun startScreenFilterSchedule(json: String) {
        val cfg = runCatching { org.json.JSONObject(json) }.getOrElse { return }
        prefs.edit().putString(SCREEN_FILTER_SETTINGS_V1, json).apply()
        scheduleFilterAlarms(cfg)
    }

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

    @JavascriptInterface fun reverseGeocodeCity(lat: Double, lon: Double): String {
        return runCatching {
            if (!Geocoder.isPresent()) return ""
            val geocoder = Geocoder(context, Locale.getDefault())
            val addresses = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                var result: android.location.Address? = null
                geocoder.getFromLocation(lat, lon, 1) { list -> result = list.firstOrNull() }
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

    private fun setFilterAlarm(am: AlarmManager, action: String, requestCode: Int, hour: Int, minute: Int) {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
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
