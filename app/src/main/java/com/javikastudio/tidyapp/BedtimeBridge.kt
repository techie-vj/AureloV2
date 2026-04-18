package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONObject
import java.util.Calendar

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

    @JavascriptInterface fun getBedtimeSettings(): String = prefs.getString(BEDTIME_SETTINGS_V1, "{}") ?: "{}"
    @JavascriptInterface fun saveBedtimeSettings(json: String) {
        runCatching { JSONObject(json) }.onFailure { return }
        prefs.edit().putString(BEDTIME_SETTINGS_V1, json).apply()
    }

    @JavascriptInterface fun saveBedtimeBlockedApps(appsJson: String) {
        runCatching {
            val cfg = try { JSONObject(prefs.getString(BEDTIME_SETTINGS_V1,null) ?: "{}") } catch (_:Exception) { JSONObject() }
            cfg.put("blockedApps", org.json.JSONArray(appsJson))
            prefs.edit().putString(BEDTIME_SETTINGS_V1, cfg.toString()).apply()
        }
    }

    @JavascriptInterface fun getBedtimeBlockedApps(): String {
        return runCatching {
            val cfg = JSONObject(prefs.getString(BEDTIME_SETTINGS_V1,null) ?: return@runCatching "[]")
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
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        fun nextTriggerMs(hour: Int, minute: Int): Long {
            val cal = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY,hour); set(Calendar.MINUTE,minute); set(Calendar.SECOND,0); set(Calendar.MILLISECOND,0) }
            if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR,1)
            return cal.timeInMillis
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_UPDATE_CURRENT
        val onPi = PendingIntent.getBroadcast(context,7001,Intent("${context.packageName}.BEDTIME_ON").apply { setPackage(context.packageName) },flags)
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,nextTriggerMs(bedHour,bedMinute),onPi)
        val offPi = PendingIntent.getBroadcast(context,7002,Intent("${context.packageName}.BEDTIME_OFF").apply { setPackage(context.packageName) },flags)
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,nextTriggerMs(wakeHour,wakeMinute),offPi)
        if (windDown) {
            val windPi = PendingIntent.getBroadcast(context,7003,Intent("${context.packageName}.BEDTIME_WINDOWN").apply { setPackage(context.packageName) },flags)
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,nextTriggerMs(bedHour,bedMinute)-30*60_000L,windPi)
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
            val cfg = JSONObject(prefs.getString(BEDTIME_SETTINGS_V1,null) ?: return false)
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

    @JavascriptInterface fun setBedtimeGrayscale(enable: Boolean) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val cdmClass = Class.forName("android.hardware.display.ColorDisplayManager")
                val cdm = context.getSystemService(cdmClass)
                if (cdm != null) cdmClass.getMethod("setSaturationLevel",Int::class.java).invoke(cdm,if(enable) 0 else 100)
            } else {
                android.provider.Settings.Secure.putString(context.contentResolver,"accessibility_display_daltonizer_enabled",if(enable) "1" else "0")
                if (enable) android.provider.Settings.Secure.putString(context.contentResolver,"accessibility_display_daltonizer","0")
            }
        }
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
                putExtra(extraKey, extraVal)  // ✅ putExtra(String, Int)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else
                context.startService(intent)
        }
    }

    private fun currentWeekId(): String = java.text.SimpleDateFormat("yyyy-'W'ww", java.util.Locale.US).format(java.util.Date())
}
