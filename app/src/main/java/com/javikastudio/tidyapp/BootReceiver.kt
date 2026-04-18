package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON") return

        val prefs = ctx.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)

        // Only reschedule if bedtime was enabled before reboot
        val raw = prefs.getString("bedtime_settings_v1", null) ?: return
        val cfg = try { org.json.JSONObject(raw) } catch (e: Exception) { return }
        if (!cfg.optBoolean("enabled", false)) return

        val bedHour   = cfg.optInt("bedHour", 22)
        val bedMinute = cfg.optInt("bedMinute", 0)
        val wakeHour  = cfg.optInt("wakeHour", 7)
        val wakeMinute= cfg.optInt("wakeMinute", 0)
        val windDown  = cfg.optBoolean("windDown", true)

        // COMPAT-01: On API 31+ check canScheduleExactAlarms before scheduling.
        // If permission is missing, skip — MainActivity will prompt the user via banner.
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!canScheduleExact(am)) return

        // Reschedule all three alarms
        rescheduleSingle(ctx, am, "${ctx.packageName}.BEDTIME_ON",      7001, bedHour,  bedMinute,  0)
        rescheduleSingle(ctx, am, "${ctx.packageName}.BEDTIME_OFF",     7002, wakeHour, wakeMinute, 0)
        if (windDown) {
            // FUN-02 FIX: Apply offset in milliseconds AFTER setting base time, not to
            // Calendar.MINUTE directly. Setting MINUTE to a negative value (e.g. -30)
            // produces undefined behaviour — the Calendar rolls incorrectly on most JVMs.
            rescheduleSingleWithOffsetMs(ctx, am, "${ctx.packageName}.BEDTIME_WINDOWN",
                7003, bedHour, bedMinute, -30 * 60 * 1000L)
        }

        // If currently inside the bedtime window, restart the blocking service too
        val cal      = java.util.Calendar.getInstance()
        val nowMins  = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        val bedMins  = bedHour * 60 + bedMinute
        val wakeMins = wakeHour * 60 + wakeMinute
        val inWindow = if (bedMins > wakeMins) nowMins >= bedMins || nowMins < wakeMins
        else nowMins >= bedMins && nowMins < wakeMins

        if (inWindow) {
            val blockedAppsJson = when (val v = cfg.opt("blockedApps")) {
                is org.json.JSONArray -> v.toString()
                is String             -> v
                else                  -> "[]"
            }
            val serviceIntent = Intent(ctx, AppMonitorService::class.java).apply {
                action = AppMonitorService.ACTION_BEDTIME_START
                putExtra("blocked_apps", blockedAppsJson)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ctx.startForegroundService(serviceIntent)
            else
                ctx.startService(serviceIntent)
        }
    }

    // COMPAT-01: canScheduleExactAlarms() gating
    private fun canScheduleExact(am: AlarmManager): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.canScheduleExactAlarms()
        else true
    }

    // Standard reschedule: sets hour/minute directly, no offset issues
    private fun rescheduleSingle(ctx: Context, am: AlarmManager, action: String,
                                 reqCode: Int, hour: Int, minute: Int, offsetMins: Int) {
        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, hour)
            set(java.util.Calendar.MINUTE, minute + offsetMins)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        if (cal.timeInMillis <= System.currentTimeMillis())
            cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
        setExact(ctx, am, reqCode, action, cal.timeInMillis)
    }

    // FUN-02 FIX: Offset applied in milliseconds after base time is set —
    // avoids negative MINUTE field causing wrong rollover.
    private fun rescheduleSingleWithOffsetMs(ctx: Context, am: AlarmManager, action: String,
                                             reqCode: Int, hour: Int, minute: Int, offsetMs: Long) {
        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, hour)
            set(java.util.Calendar.MINUTE, minute)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        cal.timeInMillis += offsetMs          // safe: millisecond arithmetic, no field overflow
        if (cal.timeInMillis <= System.currentTimeMillis())
            cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
        setExact(ctx, am, reqCode, action, cal.timeInMillis)
    }

    private fun setExact(ctx: Context, am: AlarmManager, reqCode: Int, action: String, triggerMs: Long) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT

        val pi = android.app.PendingIntent.getBroadcast(ctx, reqCode,
            Intent(action).apply { setPackage(ctx.packageName) }, flags)

        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
    }
}