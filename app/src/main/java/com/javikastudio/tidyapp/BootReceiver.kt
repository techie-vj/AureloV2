package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON" &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        val prefs = ctx.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
        val am    = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        // ── 1. Bedtime alarms ─────────────────────────────────────────────────
        val raw = BedtimePrefs.getSettings(ctx, prefs)
        val cfg = raw?.let { runCatching { org.json.JSONObject(it) }.getOrNull() }

        if (cfg != null && cfg.optBoolean("enabled", false)) {
            val bedHour    = cfg.optInt("bedHour", 22)
            val bedMinute  = cfg.optInt("bedMinute", 0)
            val wakeHour   = cfg.optInt("wakeHour", 7)
            val wakeMinute = cfg.optInt("wakeMinute", 0)
            val windDown   = cfg.optBoolean("windDown", true)

            // COMPAT-01: On API 31+ check canScheduleExactAlarms before scheduling.
            // If permission is missing, skip — MainActivity will prompt the user via banner.
            if (canScheduleExact(am)) {
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
                startService(ctx, Intent(ctx, AppMonitorService::class.java).apply {
                    val isSkippedTonight = prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT, false)
                    if (inWindow && !isSkippedTonight) {
                        startService(ctx, Intent(ctx, AppMonitorService::class.java).apply {
                            action = AppMonitorService.ACTION_BEDTIME_START
                            putExtra("blocked_apps", blockedAppsJson)
                        })
                    }
                })
            }
        }

        // ── 2. Screen Filter restore ──────────────────────────────────────────
        // SF-05 / SF-17: The filter overlay is destroyed when the device reboots
        // because WindowManager state is not persisted. Restore it if:
        //   (a) the filter was active at the time of reboot (screen_filter_active=true), AND
        //   (b) the filter is enabled in settings, AND
        //   (c) if a schedule is configured, we are currently inside the schedule window.
        //
        // We start AppMonitorService with ACTION_FILTER_START rather than calling
        // ScreenFilterEngine directly so the service is properly in the foreground and
        // the poll loop is running (needed for exclusion logic and the stop condition).
        val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
        val sfCfg = if (!sfRaw.isNullOrBlank())
            runCatching { org.json.JSONObject(sfRaw) }.getOrNull()
        else null

        val sfEnabled   = sfCfg?.optBoolean("enabled", false) ?: false
        val sfWasActive = prefs.getBoolean(SCREEN_FILTER_ACTIVE, false)

        if (sfEnabled && sfWasActive) {
            val inScheduleWindow = isInsideFilterSchedule(sfCfg)
            if (inScheduleWindow) {
                val w = sfCfg?.optInt("warmAlpha", 60) ?: 60
                val d = sfCfg?.optInt("dimAlpha",  30) ?: 30
                startService(ctx, Intent(ctx, AppMonitorService::class.java).apply {
                    action = AppMonitorService.ACTION_FILTER_START
                    putExtra("filter_warm",    w)
                    putExtra("filter_dim",     d)
                    putExtra("filter_gradual", false)
                })
            } else {
                // Outside the schedule window — clear the active flag so the
                // filter doesn't reactivate on sticky service restart either.
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
            }
        }

        // ── 3. Coach insight worker ───────────────────────────────────────────
        // H4 FIX: Re-enqueue the daily CoachInsightWorker with UPDATE policy so the
        // initialDelay is recomputed from the current time after every reboot or
        // package replacement.  Without this the KEEP policy caused the worker to miss
        // its 08:30 slot for up to a full 24-hour cycle.
        CoachInsightWorker.schedule(ctx)

        // ── 4. Focus routine alarms ───────────────────────────────────────────
        // H5 FIX: Explicitly re-schedule all enabled focus routines here in BootReceiver
        // in addition to RoutineAlarmReceiver's own BOOT_COMPLETED handler.  Android
        // delivers BOOT_COMPLETED to all registered receivers but the order is
        // unspecified; calling this from BootReceiver guarantees routines are re-armed
        // regardless of receiver execution order.  The call is idempotent — scheduling
        // the same alarm twice replaces the previous PendingIntent via FLAG_UPDATE_CURRENT.
        RoutineAlarmReceiver().rescheduleAllRoutinesOnBoot(ctx)

        // ── 5. App Lock — restart monitor service after reboot / upgrade ──────
        // AppMonitorService keeps itself alive while locked apps are configured
        // (via the hasLockedApps guard in pollRunnable). After a device reboot or
        // app upgrade the process is killed. START_STICKY is unreliable on OEM
        // devices (Samsung, MIUI aggressive battery optimisation) and may never
        // fire, leaving App Lock silently broken until the user opens Aurelo and
        // taps Save. Explicitly restart the service here so the poll loop resumes
        // immediately without any user action required.
        //
        // We start with no action (null intent) — the service's onStartCommand
        // null branch calls restoreFromPrefs() on all engines and starts polling.
        // App Lock detection runs every poll tick reading directly from SensitivePrefs,
        // so no extra restore step is needed beyond starting the service.
        val appLockSetup = prefs.getBoolean(APP_LOCK_SETUP_DONE, false)
        if (appLockSetup) {
            val hasLockedApps = runCatching {
                org.json.JSONArray(
                    SensitivePrefs.get(ctx).getString(LOCKED_APPS_V4, "[]") ?: "[]"
                ).length() > 0
            }.getOrDefault(false)
            if (hasLockedApps) {
                startService(ctx, Intent(ctx, AppMonitorService::class.java))
            }
        }

        // ── 6. Mindful Pause — restart monitor service if intention apps configured ─
        // IntentionEngine.isActive = focus_intention_enabled AND apps list non-empty.
        // The stop condition in pollRunnable keeps the service alive while this is
        // true, but only if the service is running in the first place. After a
        // reboot or upgrade nothing restarts it, so mindful pause overlays never
        // fire until the user opens Aurelo.
        val intentionEnabled = prefs.getBoolean(KEY_INTENTION_ENABLED, false)
        if (intentionEnabled) {
            val hasIntentionApps = runCatching {
                org.json.JSONArray(
                    prefs.getString(KEY_INTENTION_APPS, "[]") ?: "[]"
                ).length() > 0
            }.getOrDefault(false)
            if (hasIntentionApps) {
                startService(ctx, Intent(ctx, AppMonitorService::class.java))
            }
        }

        // ── 7. App Timers — restart if a timer block was active at upgrade time ──
        // timerblockmode=true means a daily limit was exceeded and the soft-block
        // overlay was (or should be) showing. TimerBlockingEngine.restoreFromPrefs()
        // reloads the blocked-app map from timerblock_pkgs_map and sets isActive=true,
        // keeping the service alive via the stop condition — but again only if the
        // service is started. Relevant mainly for same-day upgrades where the user
        // had already hit a timer limit before the upgrade installed.
        if (prefs.getBoolean("timerblockmode", false)) {
            startService(ctx, Intent(ctx, AppMonitorService::class.java))
        }

        // ── 8. Active Focus Session — restart if a session was mid-flight ──────
        // Uncommon but possible: user starts a Focus session, app upgrades in the
        // background (Play Store auto-update), service is killed. KEY_FOCUS_ACTIVE
        // remains true in prefs. FocusBlockingEngine.restoreFromPrefs() will pick
        // it up and set isActive=true, but only after the service is started.
        // Note: Focus ROUTINES do NOT need this — rescheduleAllRoutinesOnBoot (step 4)
        // re-arms the alarm, and RoutineAlarmReceiver starts the service when it fires.
        if (prefs.getBoolean(KEY_FOCUS_ACTIVE, false)) {
            startService(ctx, Intent(ctx, AppMonitorService::class.java))
        }
    }

    // ── Schedule window check ─────────────────────────────────────────────────

    /**
     * Returns true if the current time falls inside the filter's schedule window.
     *
     * If the filter has no schedule (schedule == "none" or field absent) it is
     * treated as always active, so we return true unconditionally.
     *
     * For "custom" schedule we compare hour:minute against schedStartHour/Min and
     * schedEndHour/Min. For "sun" we do the same using the stored hours (the JS
     * layer pre-computes sunrise/sunset into schedStartHour/schedEndHour before
     * saving, so Kotlin doesn't need location access here).
     *
     * Day-of-week filtering is deliberately skipped here — if the device reboots
     * mid-session on the correct day we should restore rather than risk a silent
     * miss due to timezone edge cases.
     */
    private fun isInsideFilterSchedule(sfCfg: org.json.JSONObject?): Boolean {
        if (sfCfg == null) return true
        val schedule = sfCfg.optString("schedule", "none")
        if (schedule == "none" || schedule.isBlank()) return true   // always-on mode

        val startH = sfCfg.optInt("schedStartHour", 21)
        val startM = sfCfg.optInt("schedStartMin",   0)
        val endH   = sfCfg.optInt("schedEndHour",    7)
        val endM   = sfCfg.optInt("schedEndMin",     0)

        val cal    = java.util.Calendar.getInstance()
        val nowMin = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        val startMin = startH * 60 + startM
        val endMin   = endH   * 60 + endM

        // Overnight window (e.g. 21:00 → 07:00)
        return if (startMin > endMin) nowMin >= startMin || nowMin < endMin
        // Same-day window (e.g. 09:00 → 18:00)
        else nowMin >= startMin && nowMin < endMin
    }

    // ── Alarm helpers ─────────────────────────────────────────────────────────

    private fun canScheduleExact(am: AlarmManager): Boolean = BedtimePrefs.canScheduleExact(am)

    private fun startService(ctx: Context, intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ctx.startForegroundService(intent)
        else
            ctx.startService(intent)
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

        BedtimePrefs.setExactSafely(ctx, am, AlarmManager.RTC_WAKEUP, triggerMs, pi)
    }
}