package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.Calendar

/**
 * QuietHoursReceiver — alarm + notification action handler for the Quiet Hours
 * feature. Distinct from Bedtime Mode: schedules DND only, no app blocking,
 * no wind-down, no filter, no streak. Coexists with Bedtime via DndController.
 *
 * Action set:
 *   QUIET_HOURS_ON              — start of window (engage DND if no conflict)
 *   QUIET_HOURS_OFF             — end of window (release DND, dismiss notif)
 *   QUIET_HOURS_END_NOW         — user tapped "End now" on the notification
 *   QUIET_HOURS_PAUSE_30        — user tapped "Pause 30m" on the notification
 *   QUIET_HOURS_SNOOZE_EXPIRE   — fires 30 min after a pause to resume DND
 *
 * Request codes (kept distinct from Bedtime's 7001-7016 / 7015-7016):
 *   7020 — QUIET_HOURS_ON
 *   7021 — QUIET_HOURS_OFF
 *   7022 — QUIET_HOURS_SNOOZE_EXPIRE
 *   7023 — persistent active-window notification id
 */
class QuietHoursReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        when (intent.action) {

            ACTION_ON -> handleStart(ctx, prefs)
            ACTION_OFF -> handleEnd(ctx, prefs)
            ACTION_END_NOW -> handleEndNow(ctx, prefs)
            ACTION_PAUSE_30 -> handlePause(ctx, prefs, durationMins = 30)
            ACTION_SNOOZE_EXPIRE -> handleSnoozeExpire(ctx, prefs)
        }
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    private fun handleStart(ctx: Context, prefs: android.content.SharedPreferences) {
        val cfg = QuietHoursPrefs.getConfig(prefs) ?: return
        if (!cfg.optBoolean("enabled", false)) return

        // Re-schedule tomorrow regardless of what happens below so the next
        // window fires even if today is skipped or DND permission is missing.
        rescheduleForTomorrow(ctx, cfg)

        // Skip-today guard — user tapped "End now" earlier this same window.
        if (isSkippedToday(prefs)) return

        // Day-of-week guard — alarms fire daily; we only engage on selected days.
        if (!isDayEnabled(cfg)) return

        // Conflict: Bedtime currently owns DND → defer silently.
        // BEDTIME_OFF will re-check Quiet Hours and engage if still in window.
        if (!DndController.canQuietHoursAcquire(ctx)) {
            // Still mark as active so JS UI reflects "Quiet Hours" — DND will
            // engage automatically when bedtime releases (handled in
            // BedtimeReceiver.BEDTIME_OFF -> resumeIfActive call).
            markActive(ctx, prefs, cfg)
            return
        }

        DndController.acquire(ctx, DND_OWNER_QUIET_HOURS,
            NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        markActive(ctx, prefs, cfg)
        postActiveNotification(ctx, prefs)
    }

    private fun handleEnd(ctx: Context, prefs: android.content.SharedPreferences) {
        DndController.release(ctx, DND_OWNER_QUIET_HOURS)
        prefs.edit()
            .putBoolean(QUIET_HOURS_ACTIVE, false)
            .putLong(QUIET_HOURS_STARTS_AT_MS, 0L)
            .putLong(QUIET_HOURS_ENDS_AT_MS, 0L)
            .putLong(QUIET_HOURS_SNOOZE_UNTIL_TS, 0L)
            .remove(QUIET_HOURS_SKIPPED_TODAY)
            .apply()
        dismissActiveNotification(ctx)

        // Re-arm tomorrow's window.
        QuietHoursPrefs.getConfig(prefs)?.let { rescheduleForTomorrow(ctx, it) }
    }

    private fun handleEndNow(ctx: Context, prefs: android.content.SharedPreferences) {
        // Mark today as skipped so a subsequent alarm/state-restore (e.g.
        // after a reboot inside the same window) does not re-engage DND.
        prefs.edit()
            .putString(QUIET_HOURS_SKIPPED_TODAY, todayYmd())
            .apply()
        handleEnd(ctx, prefs)
    }

    private fun handlePause(ctx: Context, prefs: android.content.SharedPreferences, durationMins: Int) {
        val resumeAt = System.currentTimeMillis() + durationMins * 60_000L
        DndController.release(ctx, DND_OWNER_QUIET_HOURS)
        prefs.edit().putLong(QUIET_HOURS_SNOOZE_UNTIL_TS, resumeAt).apply()

        // Schedule a one-shot to resume DND at resumeAt — but only if today's
        // window has not already ended by then.
        val cfg = QuietHoursPrefs.getConfig(prefs)
        val endsAt = prefs.getLong(QUIET_HOURS_ENDS_AT_MS, 0L)
        if (cfg != null && (endsAt == 0L || resumeAt < endsAt)) {
            scheduleSnoozeExpire(ctx, resumeAt)
        }
        postPausedNotification(ctx, resumeAt)
    }

    private fun handleSnoozeExpire(ctx: Context, prefs: android.content.SharedPreferences) {
        prefs.edit().putLong(QUIET_HOURS_SNOOZE_UNTIL_TS, 0L).apply()

        // Re-check window membership — user may have crossed the end time
        // during the pause, or skipped/disabled the feature.
        val cfg = QuietHoursPrefs.getConfig(prefs) ?: return
        if (!cfg.optBoolean("enabled", false)) return
        if (isSkippedToday(prefs)) return
        if (!isCurrentlyInWindow(cfg)) return
        if (!DndController.canQuietHoursAcquire(ctx)) return

        DndController.acquire(ctx, DND_OWNER_QUIET_HOURS,
            NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        postActiveNotification(ctx, prefs)
    }

    // ── Notification UI ───────────────────────────────────────────────────────

    private fun postActiveNotification(ctx: Context, prefs: android.content.SharedPreferences) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannel(ctx, nm)

        val endsAt = prefs.getLong(QUIET_HOURS_ENDS_AT_MS, 0L)
        val endsLabel = if (endsAt > 0L) " · ends ${formatTime(endsAt)}" else ""

        val endNowPi = PendingIntent.getBroadcast(
            ctx, REQ_ACTION_END_NOW,
            Intent(ACTION_END_NOW).apply { setPackage(ctx.packageName) },
            pendingFlags()
        )
        val pausePi = PendingIntent.getBroadcast(
            ctx, REQ_ACTION_PAUSE_30,
            Intent(ACTION_PAUSE_30).apply { setPackage(ctx.packageName) },
            pendingFlags()
        )
        val contentPi = openMainActivityPendingIntent(ctx)

        val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode)
            .setColor(0xFF6C63FF.toInt())
            .setContentTitle("Quiet Hours active")
            .setContentText("Notifications silenced$endsLabel")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(contentPi)
            .addAction(0, "End now", endNowPi)
            .addAction(0, "Pause 30m", pausePi)
            .build()
        nm.notify(NOTIF_ID_ACTIVE, notif)
    }

    private fun postPausedNotification(ctx: Context, resumeAt: Long) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannel(ctx, nm)
        val endNowPi = PendingIntent.getBroadcast(
            ctx, REQ_ACTION_END_NOW,
            Intent(ACTION_END_NOW).apply { setPackage(ctx.packageName) },
            pendingFlags()
        )
        val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode)
            .setColor(0xFF6C63FF.toInt())
            .setContentTitle("Quiet Hours paused")
            .setContentText("Resumes at ${formatTime(resumeAt)}")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(openMainActivityPendingIntent(ctx))
            .addAction(0, "End now", endNowPi)
            .build()
        nm.notify(NOTIF_ID_ACTIVE, notif)
    }

    private fun dismissActiveNotification(ctx: Context) {
        runCatching {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .cancel(NOTIF_ID_ACTIVE)
        }
    }

    private fun ensureChannel(ctx: Context, nm: NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val existing = nm.getNotificationChannel(CHANNEL_ID)
            if (existing != null) return
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Quiet Hours",
                    NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Persistent reminder while Quiet Hours is active"
                    setShowBadge(false)
                }
            )
        }
    }

    // ── State helpers ─────────────────────────────────────────────────────────

    private fun markActive(
        ctx: Context,
        prefs: android.content.SharedPreferences,
        cfg: JSONObject
    ) {
        val now = System.currentTimeMillis()
        val endsAt = computeEndAt(cfg, now)
        prefs.edit()
            .putBoolean(QUIET_HOURS_ACTIVE, true)
            .putLong(QUIET_HOURS_STARTS_AT_MS, now)
            .putLong(QUIET_HOURS_ENDS_AT_MS, endsAt)
            .apply()
    }

    private fun isSkippedToday(prefs: android.content.SharedPreferences): Boolean {
        val stored = prefs.getString(QUIET_HOURS_SKIPPED_TODAY, null) ?: return false
        return stored == todayYmd()
    }

    private fun rescheduleForTomorrow(ctx: Context, cfg: JSONObject) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!BedtimePrefs.canScheduleExact(am)) return
        val startH = cfg.optInt("startHour", 9)
        val startM = cfg.optInt("startMin", 0)
        val endH = cfg.optInt("endHour", 17)
        val endM = cfg.optInt("endMin", 0)

        val onAt = nextTriggerMs(startH, startM, minDaysAhead = 1)
        val offAt = nextTriggerMs(endH, endM, minDaysAhead = 1)

        val flags = pendingFlags()
        val onPi = PendingIntent.getBroadcast(ctx, REQ_ON,
            Intent(ACTION_ON).apply { setPackage(ctx.packageName) }, flags)
        val offPi = PendingIntent.getBroadcast(ctx, REQ_OFF,
            Intent(ACTION_OFF).apply { setPackage(ctx.packageName) }, flags)
        BedtimePrefs.setExactSafely(ctx, am, AlarmManager.RTC_WAKEUP, onAt, onPi)
        BedtimePrefs.setExactSafely(ctx, am, AlarmManager.RTC_WAKEUP, offAt, offPi)
    }

    private fun scheduleSnoozeExpire(ctx: Context, atMs: Long) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = PendingIntent.getBroadcast(ctx, REQ_SNOOZE_EXPIRE,
            Intent(ACTION_SNOOZE_EXPIRE).apply { setPackage(ctx.packageName) }, pendingFlags())
        BedtimePrefs.setExactSafely(ctx, am, AlarmManager.RTC_WAKEUP, atMs, pi)
    }

    private fun openMainActivityPendingIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(ctx, REQ_OPEN_APP, intent, pendingFlags())
    }

    // ── Companion (constants + scheduling entry points used by bridge/boot) ───

    companion object {
        const val CHANNEL_ID = "tidyquiet"
        const val NOTIF_ID_ACTIVE = 7023

        // Distinct request codes per slot — must be stable across reboots so
        // FLAG_UPDATE_CURRENT replaces the existing PendingIntent rather than
        // stacking new ones.
        const val REQ_ON = 7020
        const val REQ_OFF = 7021
        const val REQ_SNOOZE_EXPIRE = 7022
        const val REQ_ACTION_END_NOW = 7024
        const val REQ_ACTION_PAUSE_30 = 7025
        const val REQ_OPEN_APP = 7026

        val ACTION_ON: String            get() = "${AppCtxHolder.pkg}.QUIET_HOURS_ON"
        val ACTION_OFF: String           get() = "${AppCtxHolder.pkg}.QUIET_HOURS_OFF"
        val ACTION_END_NOW: String       get() = "${AppCtxHolder.pkg}.QUIET_HOURS_END_NOW"
        val ACTION_PAUSE_30: String      get() = "${AppCtxHolder.pkg}.QUIET_HOURS_PAUSE_30"
        val ACTION_SNOOZE_EXPIRE: String get() = "${AppCtxHolder.pkg}.QUIET_HOURS_SNOOZE_EXPIRE"

        fun pendingFlags(): Int =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            else PendingIntent.FLAG_UPDATE_CURRENT

        fun nextTriggerMs(hour: Int, minute: Int, minDaysAhead: Int = 0): Long {
            val cal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            if (minDaysAhead > 0) cal.add(Calendar.DAY_OF_YEAR, minDaysAhead)
            if (cal.timeInMillis <= System.currentTimeMillis())
                cal.add(Calendar.DAY_OF_YEAR, 1)
            return cal.timeInMillis
        }

        /**
         * Returns true if today's day-of-week is enabled in the schedule.
         * Calendar.DAY_OF_WEEK maps Sunday=1..Saturday=7; we store days[]
         * indexed 0..6 with 0=Sunday so the offset is -1.
         */
        fun isDayEnabled(cfg: JSONObject): Boolean {
            val days = cfg.optJSONArray("days") ?: return true
            val idx = (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1)
                .coerceIn(0, 6)
            return runCatching { days.optBoolean(idx, false) }.getOrDefault(false)
        }

        /** True iff the current wall-clock time is inside the configured window. */
        fun isCurrentlyInWindow(cfg: JSONObject): Boolean {
            if (!cfg.optBoolean("enabled", false)) return false
            val startH = cfg.optInt("startHour", 9)
            val startM = cfg.optInt("startMin", 0)
            val endH = cfg.optInt("endHour", 17)
            val endM = cfg.optInt("endMin", 0)
            val cal = Calendar.getInstance()
            val nowMin = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            val startMin = startH * 60 + startM
            val endMin = endH * 60 + endM
            return if (startMin > endMin)
                (nowMin >= startMin || nowMin < endMin)   // overnight window
            else
                (nowMin >= startMin && nowMin < endMin)   // same-day window
        }

        /** Compute the wall-clock end of the window relative to [now]. */
        fun computeEndAt(cfg: JSONObject, now: Long): Long {
            val endH = cfg.optInt("endHour", 17)
            val endM = cfg.optInt("endMin", 0)
            val cal = Calendar.getInstance().apply {
                timeInMillis = now
                set(Calendar.HOUR_OF_DAY, endH); set(Calendar.MINUTE, endM)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            if (cal.timeInMillis <= now) cal.add(Calendar.DAY_OF_YEAR, 1)
            return cal.timeInMillis
        }

        fun formatTime(ms: Long): String {
            if (ms <= 0L) return ""
            val cal = Calendar.getInstance().apply { timeInMillis = ms }
            val h = cal.get(Calendar.HOUR_OF_DAY); val m = cal.get(Calendar.MINUTE)
            val h12 = if (h % 12 == 0) 12 else h % 12
            val ampm = if (h < 12) "AM" else "PM"
            return "%d:%02d %s".format(h12, m, ampm)
        }

        fun todayYmd(): String {
            val cal = Calendar.getInstance()
            return "%04d-%02d-%02d".format(
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH)
            )
        }

        /**
         * Called from BedtimeReceiver.BEDTIME_OFF after Bedtime releases DND.
         * If a Quiet Hours window is currently active (i.e. start fired and
         * the window has not ended yet), engage DND under the QUIET_HOURS
         * owner so the user doesn't briefly hear notifications between bedtime
         * end and the next Quiet Hours alarm.
         */
        fun resumeIfActive(ctx: Context) {
            val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
            val cfg = QuietHoursPrefs.getConfig(prefs) ?: return
            if (!cfg.optBoolean("enabled", false)) return
            if (!isDayEnabled(cfg)) return
            val stored = prefs.getString(QUIET_HOURS_SKIPPED_TODAY, null)
            if (stored == todayYmd()) return
            if (!isCurrentlyInWindow(cfg)) return
            if (!DndController.canQuietHoursAcquire(ctx)) return

            DndController.acquire(ctx, DND_OWNER_QUIET_HOURS,
                NotificationManager.INTERRUPTION_FILTER_PRIORITY)
            val now = System.currentTimeMillis()
            prefs.edit()
                .putBoolean(QUIET_HOURS_ACTIVE, true)
                .putLong(QUIET_HOURS_STARTS_AT_MS, now)
                .putLong(QUIET_HOURS_ENDS_AT_MS, computeEndAt(cfg, now))
                .apply()
            QuietHoursReceiver().postActiveNotification(ctx, prefs)
        }

        /** Re-schedule both alarms from current config — used at boot and after save. */
        fun scheduleAlarms(ctx: Context) {
            val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
            val cfg = QuietHoursPrefs.getConfig(prefs) ?: return
            if (!cfg.optBoolean("enabled", false)) { cancelAlarms(ctx); return }
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            if (!BedtimePrefs.canScheduleExact(am)) return

            val startH = cfg.optInt("startHour", 9)
            val startM = cfg.optInt("startMin", 0)
            val endH = cfg.optInt("endHour", 17)
            val endM = cfg.optInt("endMin", 0)

            val flags = pendingFlags()
            val onPi = PendingIntent.getBroadcast(ctx, REQ_ON,
                Intent(ACTION_ON).apply { setPackage(ctx.packageName) }, flags)
            val offPi = PendingIntent.getBroadcast(ctx, REQ_OFF,
                Intent(ACTION_OFF).apply { setPackage(ctx.packageName) }, flags)
            BedtimePrefs.setExactSafely(ctx, am, AlarmManager.RTC_WAKEUP,
                nextTriggerMs(startH, startM), onPi)
            BedtimePrefs.setExactSafely(ctx, am, AlarmManager.RTC_WAKEUP,
                nextTriggerMs(endH, endM), offPi)
        }

        /** Cancel both alarms — used when the user disables the feature. */
        fun cancelAlarms(ctx: Context) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val flagsForCancel =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
                else PendingIntent.FLAG_NO_CREATE
            listOf(
                REQ_ON to ACTION_ON,
                REQ_OFF to ACTION_OFF,
                REQ_SNOOZE_EXPIRE to ACTION_SNOOZE_EXPIRE
            ).forEach { (code, action) ->
                val pi = PendingIntent.getBroadcast(ctx, code,
                    Intent(action).apply { setPackage(ctx.packageName) }, flagsForCancel)
                pi?.let { am.cancel(it) }
            }
        }
    }
}

/**
 * Tiny helper so action strings can be computed without holding a Context.
 * Initialised in MainActivity (or any early-running component) by storing the
 * application package name. Falls back to a hard-coded value matching the
 * application id if uninitialised so unit tests don't NPE.
 */
internal object AppCtxHolder {
    @Volatile var pkg: String = "com.javikastudio.tidyapp"
    fun init(ctx: Context) { pkg = ctx.packageName }
}

/**
 * Plain-prefs accessor for the Quiet Hours config blob. Stored in
 * `tidyapp_v6` (not securePrefs) — a schedule is not sensitive and keeping
 * it out of EncryptedSharedPreferences avoids rooted-device degradation.
 */
object QuietHoursPrefs {
    fun getConfig(prefs: android.content.SharedPreferences): JSONObject? {
        val raw = prefs.getString(QUIET_HOURS_SETTINGS_V1, null) ?: return null
        return runCatching { JSONObject(raw) }.getOrNull()
    }
    fun saveConfig(prefs: android.content.SharedPreferences, json: String) {
        // Validate JSON before writing so a malformed save doesn't break boot.
        runCatching { JSONObject(json) }.getOrNull() ?: return
        prefs.edit().putString(QUIET_HOURS_SETTINGS_V1, json).apply()
    }
    fun clearConfig(prefs: android.content.SharedPreferences) {
        prefs.edit().remove(QUIET_HOURS_SETTINGS_V1).apply()
    }
}
