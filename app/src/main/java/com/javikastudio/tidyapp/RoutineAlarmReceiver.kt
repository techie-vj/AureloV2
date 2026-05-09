package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * RoutineAlarmReceiver  —  v3
 *
 * Full bug-fix changelog:
 *
 *  FIX 1 — Prefs never written for background-started sessions
 *    startFocusServiceDirectly() now writes all focus_* SharedPrefs keys
 *    before starting the service, exactly mirroring AppBridge.startFocusSession().
 *    This means: JS _syncSessionState() sees the session on app reopen,
 *    FocusHandler.restoreFromPrefs() recovers correctly after OS kills the service,
 *    and the schedule watcher does NOT double-start when the app comes to foreground.
 *
 *  FIX 2 — Notification channel "focus_routines" never created
 *    ensureRoutineChannel() creates the channel inline before every notify() call.
 *    It is idempotent (no-op if channel already exists) so safe to call repeatedly.
 *    Also switched buildNotification() to NotificationCompat so priority flags work
 *    on all API levels.
 *
 *  FIX 3 — Tapping the session-started notification double-starts the session
 *    consumePendingRoutineIntent() in MainActivity now checks focus_session_active
 *    before calling onRoutineTriggered(). On the Kotlin side the launchIntent() now
 *    carries a "session_already_active" flag so MainActivity can skip the JS trigger
 *    and instead just navigate to the focus tab.
 *
 *  FIX 4 — Alarms lost on device reboot / app update
 *    onReceive() now handles BOOT_COMPLETED and MY_PACKAGE_REPLACED by reading the
 *    plain-prefs mirror of the routines list and rescheduling every enabled routine.
 *    AppBridge.saveFocusRoutines() must write this mirror — see AppBridge.kt changes.
 *
 *  FIX 5 — Zero-duration routine (start == end time)
 *    startFocusServiceDirectly() guards against durationMins < 1 and returns early.
 *
 *  FIX 6 — "Start Now" extra never read in MainActivity
 *    launchIntent() no longer sends the unused "auto_start_routine" extra.
 *    The session is triggered purely via "pending_routine_json" which MainActivity
 *    already handles correctly (with the FIX 3 active-session guard).
 *
 *  AndroidManifest.xml requirements (unchanged from v2, repeated for convenience):
 *
 *    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
 *    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
 *    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />       <!-- API 33+ -->
 *    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
 *
 *    <receiver
 *        android:name=".RoutineAlarmReceiver"
 *        android:exported="false">
 *      <intent-filter>
 *        <action android:name="android.intent.action.BOOT_COMPLETED" />
 *        <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
 *      </intent-filter>
 *    </receiver>
 *
 *  proguard-rules.pro (unchanged from v2):
 *    -keep class com.javikastudio.tidyapp.RoutineAlarmReceiver { *; }
 *    -keep class com.javikastudio.tidyapp.WebViewHolder { *; }
 *    -keepclassmembers class com.javikastudio.tidyapp.AppMonitorService {
 *        public static final java.lang.String ACTION_FOCUS_START;
 *    }
 *    -keep public class * extends android.content.BroadcastReceiver
 */
class RoutineAlarmReceiver : BroadcastReceiver() {

    companion object {

        // Intent extra keys
        private const val EXTRA_ROUTINE_JSON      = "routine_json"
        private const val EXTRA_IS_PRE_SESSION    = "is_pre_session"

        // Notification channel shared with focus routines
        private const val CHANNEL_ROUTINES        = "focus_routines"

        // SEC-08 FIX: PREFS_ROUTINES_PLAIN removed — routines are now read directly
        // from EncryptedSharedPreferences in rescheduleAllRoutinesOnBoot().
        internal const val PREFS_NAME             = "tidyapp_v6"

        /** How many minutes before start to show the heads-up notification. */
        private const val PRE_SESSION_LEAD_MINS = 2

        // ── Request-code scheme ─────────────────────────────────────────────
        // Bits 0-28: hash of (routineId, dayOfWeek)
        // Bit  29  : set   → pre-session alarm
        // Bit  29  : clear → main alarm

        private fun requestCode(routineId: String, dayOfWeek: Int): Int =
            (routineId.hashCode() * 31 + dayOfWeek) and 0x1FFFFFFF

        private fun preSessionRequestCode(routineId: String, dayOfWeek: Int): Int =
            requestCode(routineId, dayOfWeek) or 0x20000000

        // ── Public API ──────────────────────────────────────────────────────

        /**
         * Schedule (or re-schedule) all enabled days for a routine.
         * Registers both the main alarm and the pre-session reminder.
         * Called from AppBridge: N.scheduleRoutineAlarm(routineJson)
         */
        fun schedule(context: Context, routineJson: String) {
            val routine = parseJson(routineJson) ?: return
            if (!routine.optBoolean("enabled", false)) return
            val id        = routine.optString("id").takeIf { it.isNotBlank() } ?: return
            val startHour = routine.optInt("startHour", 9)
            val startMin  = routine.optInt("startMin",  0)
            val daysArray = routine.optJSONArray("days") ?: return
            val am        = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

            for (i in 0 until daysArray.length()) {
                val jsDay  = daysArray.getInt(i)           // 0 (Sun) … 6 (Sat)
                val calDay = jsDay2CalendarDay(jsDay)

                // Main alarm
                val mainMillis = nextOccurrenceMillis(calDay, startHour, startMin)
                val mainIntent = Intent(context, RoutineAlarmReceiver::class.java).apply {
                    putExtra(EXTRA_ROUTINE_JSON, routineJson)
                    putExtra(EXTRA_IS_PRE_SESSION, false)
                }
                val mainPi = pendingBroadcast(context, requestCode(id, jsDay), mainIntent)
                setExact(am, mainMillis, mainPi)

                // Pre-session reminder
                schedulePreSessionForDay(context, routine, jsDay, calDay, am)
            }
        }

        /**
         * Schedule ONLY the pre-session reminders for all days of a routine.
         * Called from AppBridge: N.schedulePreSessionAlarm(routineJson)
         */
        fun schedulePreSession(context: Context, routineJson: String) {
            val routine = parseJson(routineJson) ?: return
            if (!routine.optBoolean("enabled", false)) return
            val daysArray = routine.optJSONArray("days") ?: return
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            for (i in 0 until daysArray.length()) {
                val jsDay  = daysArray.getInt(i)
                schedulePreSessionForDay(context, routine, jsDay, jsDay2CalendarDay(jsDay), am)
            }
        }

        /**
         * Cancel all alarms (main + pre-session) for every day of a routine.
         * Called from AppBridge: N.cancelRoutineAlarm(routineId)
         */
        fun cancel(context: Context, routineId: String) {
            if (routineId.isBlank()) return
            val am     = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, RoutineAlarmReceiver::class.java)
            for (day in 0..6) {
                cancelPi(context, am, intent, requestCode(routineId, day))
                cancelPi(context, am, intent, preSessionRequestCode(routineId, day))
            }
        }

        /**
         * Cancel only the pre-session alarms for a routine.
         * Called from AppBridge: N.cancelPreSessionAlarm(routineId)
         */
        fun cancelPreSession(context: Context, routineId: String) {
            if (routineId.isBlank()) return
            val am     = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, RoutineAlarmReceiver::class.java)
            for (day in 0..6) cancelPi(context, am, intent, preSessionRequestCode(routineId, day))
        }

        // ── Private helpers ─────────────────────────────────────────────────

        private fun schedulePreSessionForDay(
            context: Context,
            routine: JSONObject,
            jsDay: Int,
            calDay: Int,
            am: AlarmManager
        ) {
            val id        = routine.optString("id").takeIf { it.isNotBlank() } ?: return
            val startHour = routine.optInt("startHour", 9)
            val startMin  = routine.optInt("startMin",  0)

            // Subtract lead time, handling midnight wrap
            var preMin  = startMin  - PRE_SESSION_LEAD_MINS
            var preHour = startHour
            if (preMin < 0)  { preMin  += 60; preHour -= 1 }
            if (preHour < 0) { preHour += 24 }

            val preMillis = nextOccurrenceMillis(calDay, preHour, preMin)
            val preIntent = Intent(context, RoutineAlarmReceiver::class.java).apply {
                putExtra(EXTRA_ROUTINE_JSON, routine.toString())
                putExtra(EXTRA_IS_PRE_SESSION, true)
            }
            val prePi = pendingBroadcast(context, preSessionRequestCode(id, jsDay), preIntent)
            setExact(am, preMillis, prePi)
        }

        private fun rescheduleAfterFire(context: Context, routineJson: String) {
            // schedule() recalculates the NEXT occurrence from now so next week's
            // alarms are always set strictly in the future.
            schedule(context, routineJson)
        }

        private fun setExact(am: AlarmManager, triggerMs: Long, pi: PendingIntent) {
            // COMPAT-01: On API 31+, SCHEDULE_EXACT_ALARM requires user approval and can be
            // revoked. Check before scheduling — MainActivity will show a dialog if missing.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                Log.w("RoutineAlarm", "canScheduleExactAlarms() = false — skipping exact alarm. " +
                        "User must grant Alarms & Reminders permission.")
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
            else
                am.setExact(AlarmManager.RTC_WAKEUP, triggerMs, pi)
        }

        private fun pendingBroadcast(context: Context, code: Int, intent: Intent): PendingIntent =
            PendingIntent.getBroadcast(
                context, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        private fun cancelPi(context: Context, am: AlarmManager, intent: Intent, code: Int) {
            val pi = PendingIntent.getBroadcast(
                context, code, intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            pi?.let { am.cancel(it); it.cancel() }
        }

        private fun parseJson(json: String): JSONObject? =
            runCatching { JSONObject(json) }.getOrNull()

        /** Convert JS day index (0 = Sunday) to java.util.Calendar constant. */
        private fun jsDay2CalendarDay(jsDay: Int): Int = when (jsDay) {
            0 -> Calendar.SUNDAY
            1 -> Calendar.MONDAY
            2 -> Calendar.TUESDAY
            3 -> Calendar.WEDNESDAY
            4 -> Calendar.THURSDAY
            5 -> Calendar.FRIDAY
            6 -> Calendar.SATURDAY
            else -> Calendar.MONDAY
        }

        /**
         * Returns the epoch-millis of the next occurrence of [calDay] at [hour]:[min].
         * Always strictly in the future — never <= now.
         */
        internal fun nextOccurrenceMillis(calDay: Int, hour: Int, min: Int): Long {
            val now = Calendar.getInstance()

            val target = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE,      0)
                set(Calendar.SECOND,      0)
                set(Calendar.MILLISECOND, 0)
            }

            var steps = 0
            while (target.get(Calendar.DAY_OF_WEEK) != calDay && steps < 7) {
                target.add(Calendar.DAY_OF_YEAR, 1)
                steps++
            }

            target.set(Calendar.HOUR_OF_DAY, hour)
            target.set(Calendar.MINUTE,      min)
            target.set(Calendar.SECOND,      0)
            target.set(Calendar.MILLISECOND, 0)

            if (target.timeInMillis <= now.timeInMillis) {
                target.add(Calendar.WEEK_OF_YEAR, 1)
            }

            return target.timeInMillis
        }

        // ── FIX 2: Channel creation helper ──────────────────────────────────
        /**
         * Creates the "focus_routines" notification channel if it does not exist.
         * Safe to call on every notification — idempotent on API 26+, no-op below.
         */
        private fun ensureRoutineChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE)
                        as android.app.NotificationManager
                if (nm.getNotificationChannel(CHANNEL_ROUTINES) == null) {
                    val channel = android.app.NotificationChannel(
                        CHANNEL_ROUTINES,
                        "Focus Routines",
                        android.app.NotificationManager.IMPORTANCE_HIGH
                    ).apply {
                        description = "Upcoming and active scheduled focus session alerts"
                        enableVibration(true)
                        setShowBadge(true)
                    }
                    nm.createNotificationChannel(channel)
                }
            }
        }
    }

    // ── BroadcastReceiver.onReceive ──────────────────────────────────────────

    override fun onReceive(context: Context, intent: Intent) {

        // ── FIX 4: Reschedule all routines on boot or app update ────────────
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            rescheduleAllRoutinesOnBoot(context)
            return
        }

        // ── Normal alarm path ────────────────────────────────────────────────
        val routineJson  = intent.getStringExtra(EXTRA_ROUTINE_JSON) ?: return
        val isPreSession = intent.getBooleanExtra(EXTRA_IS_PRE_SESSION, false)
        val routine      = runCatching { JSONObject(routineJson) }.getOrNull() ?: return

        if (!routine.optBoolean("enabled", false)) return

        if (isPreSession) {
            // Only show the advance-warning notification — do NOT start the session yet.
            showPreSessionNotification(context, routine)
            return
        }

        // ── Main alarm ───────────────────────────────────────────────────────
        val webView = WebViewHolder.get()
        if (webView != null) {
            // App is foregrounded — delegate to JS.
            // JS _autoStartRoutine() will call _doStartFocusSession()
            // → N.startFocusSession() → AppMonitorService handles overlay + blocking.
            val safeJson = org.json.JSONObject.quote(routineJson)
            webView.post {
                webView.evaluateJavascript("onRoutineTriggered($safeJson)", null)
            }
        } else {
            // App is backgrounded — write prefs then start the service directly (FIX 1).
            startFocusServiceDirectly(context, routine)
            // Post the "session started" notification (FIX 2).
            showSessionStartedNotification(context, routine)
        }

        // Re-schedule next week's occurrence.
        rescheduleAfterFire(context, routineJson)
    }

    // ── FIX 4: Boot / update reschedule ─────────────────────────────────────

    /**
     * Reads the plain-prefs mirror of the routines list written by
     * AppBridge.saveFocusRoutines() and reschedules every enabled routine.
     *
     * Called on BOOT_COMPLETED and MY_PACKAGE_REPLACED — alarms don't survive
     * a reboot, so we must re-register them here.
     *
     * Note: this reads from the NON-encrypted "tidyapp_v6" prefs under key
     * "focus_routines_plain". AppBridge.saveFocusRoutines() must write this
     * SEC-08 FIX: Routines are read from EncryptedSharedPreferences, not the plaintext
     * mirror.  MasterKey can be built inside a BroadcastReceiver — there is no API
     * restriction preventing it.  If the Keystore is unavailable on this boot (extremely
     * rare; typically only on first boot before the key is generated), we skip rescheduling
     * and let the app reschedule the next time it is foregrounded.
     */
    // H5 FIX: elevated to internal so BootReceiver can call this as an explicit
    // fallback, giving a single reliable boot handler rather than relying solely on
    // the BOOT_COMPLETED broadcast race between two receivers.
    internal fun rescheduleAllRoutinesOnBoot(context: Context) {
        val json = try {
            val masterKey = androidx.security.crypto.MasterKey.Builder(context)
                .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                .build()
            val securePrefs = androidx.security.crypto.EncryptedSharedPreferences.create(
                context,
                "tidyapp_secure_v1",
                masterKey,
                androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            securePrefs.getString(KEY_FOCUS_ROUTINES, "[]") ?: "[]"
        } catch (e: Exception) {
            // Keystore unavailable on this boot — skip rescheduling gracefully.
            // The app will reschedule alarms the next time it is opened.
            Log.w("RoutineAlarmReceiver", "EncryptedSharedPreferences unavailable on boot; skipping reschedule", e)
            return
        }
        val arr = runCatching { JSONArray(json) }.getOrNull() ?: return
        for (i in 0 until arr.length()) {
            val routineJson = arr.optJSONObject(i)?.toString() ?: continue
            schedule(context, routineJson)
        }
    }

    // ── FIX 1: Background service start ─────────────────────────────────────

    /**
     * Starts AppMonitorService for a background-triggered routine.
     *
     * CRITICAL: writes all focus_* SharedPrefs keys before starting the service.
     * Without this:
     *   - JS _syncSessionState() sees no active session when app is opened
     *   - FocusHandler.restoreFromPrefs() finds nothing after an OS service kill
     *   - The JS schedule watcher re-fires onRoutineTriggered and double-starts
     *
     * This mirrors exactly what AppBridge.startFocusSession() does for manual sessions.
     */
    private fun startFocusServiceDirectly(context: Context, routine: JSONObject) {
        val blockedAppsArray = routine.optJSONArray("blockedApps") ?: JSONArray()
        val durationMins     = routine.optInt("durationMins", 25)
        val difficulty       = routine.optString("difficulty", "gentle")

        // FIX 5: Guard against zero-duration routines (start == end time edge case)
        if (durationMins < 1) return

        val endTs = System.currentTimeMillis() + durationMins * 60_000L

        // Build package-name-only array (matches N.startFocusSession arg 1 shape)
        val pkgNames = JSONArray()
        for (i in 0 until blockedAppsArray.length()) {
            blockedAppsArray.optJSONObject(i)?.optString("packageName")
                ?.takeIf { it.isNotBlank() }
                ?.let { pkgNames.put(it) }
        }

        val routineId = routine.optString("id", "")

        // ── Write prefs so JS and service-restore both see this session ──────
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(KEY_FOCUS_ACTIVE,     true)
            .putString (KEY_FOCUS_DIFFICULTY, difficulty)
            .putLong   (KEY_FOCUS_END_TS,     endTs)
            .putString (KEY_FOCUS_BLOCKED_APPS,        blockedAppsArray.toString())
            .putInt    (KEY_FOCUS_LAST_TOTAL,     durationMins)
            .putString (KEY_FOCUS_LAST_OUTCOME,        "in_progress")
            // Store the routine ID so FocusHandler.stop() can tell JS which routine ended
            .putString (KEY_FOCUS_ACTIVE_ROUTINE,  routineId)
            .apply()

        // ── Start the foreground service ─────────────────────────────────────
        val startIntent = Intent(context, AppMonitorService::class.java).apply {
            action = AppMonitorService.ACTION_FOCUS_START
            putExtra("blockedAppsJson",     pkgNames.toString())         // package-name array
            putExtra("blockedApps",         blockedAppsArray.toString()) // full-object array
            putExtra("difficulty",          difficulty)
            putExtra("durationMins",        durationMins)
            putExtra("endTs",               endTs)
            // Pass routine ID so the service knows this is a scheduled session
            putExtra("activeRoutineId",     routineId)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            context.startForegroundService(startIntent)
        else
            context.startService(startIntent)
    }

    // ── FIX 2: Notifications ─────────────────────────────────────────────────

    /**
     * Pre-session reminder shown PRE_SESSION_LEAD_MINS before start.
     * Includes a "Start Now" action that deep-links into the app to start the session.
     */
    private fun showPreSessionNotification(context: Context, routine: JSONObject) {
        // FIX 2: Create channel before posting — idempotent, safe to call every time.
        ensureRoutineChannel(context)

        val name    = routine.optString("name", "Focus Routine")
        val emoji   = routine.optString("emoji", "⏰")
        val durMins = routine.optInt("durationMins", 25)
        // Use a stable, distinct ID: base hash + 1 so it never collides with the session notif
        val notifId = (routine.optString("id").hashCode() and 0x7FFFFFFF) + 1

        val openPi = PendingIntent.getActivity(
            context, notifId,
            launchIntent(context, routine),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // FIX 6: "Start Now" uses the same launchIntent — pending_routine_json carries
        // the routine data; MainActivity.consumePendingRoutineIntent() starts the session.
        val startNowPi = PendingIntent.getActivity(
            context, notifId + 1,
            launchIntent(context, routine),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val n = androidx.core.app.NotificationCompat.Builder(context, CHANNEL_ROUTINES)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("$emoji $name starts in $PRE_SESSION_LEAD_MINS min")
            .setContentText("${durMins}-min session is about to begin.")
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openPi)
            .addAction(0, "Start Now", startNowPi)
            .build()

        (context.getSystemService(Context.NOTIFICATION_SERVICE)
                as android.app.NotificationManager).notify(notifId, n)
    }

    /**
     * "Session is now active" notification for background-triggered sessions.
     * Marked as ongoing so it stays visible while the session runs.
     * AppMonitorService replaces this with its own foreground-service notification
     * almost immediately, so this notification acts as a brief bridge.
     */
    private fun showSessionStartedNotification(context: Context, routine: JSONObject) {
        // FIX 2: Create channel before posting.
        ensureRoutineChannel(context)

        val name    = routine.optString("name", "Focus Routine")
        val emoji   = routine.optString("emoji", "⏰")
        val durMins = routine.optInt("durationMins", 25)
        val notifId = routine.optString("id").hashCode() and 0x7FFFFFFF

        // FIX 3: Mark the intent so MainActivity knows the service is already running
        // and should NOT re-trigger onRoutineTriggered() — it just navigates to focus tab.
        val tapPi = PendingIntent.getActivity(
            context, notifId,
            launchIntent(context, routine, sessionAlreadyActive = true),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val n = androidx.core.app.NotificationCompat.Builder(context, CHANNEL_ROUTINES)
            .setSmallIcon(android.R.drawable.ic_media_pause)
            .setContentTitle("$emoji $name — Focus active")
            .setContentText("Your ${durMins}-min session is running. Apps are blocked.")
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_LOW)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_SERVICE)
            .setAutoCancel(false)
            .setOngoing(true)
            .setContentIntent(tapPi)
            .build()

        (context.getSystemService(Context.NOTIFICATION_SERVICE)
                as android.app.NotificationManager).notify(notifId, n)
    }

    // ── Intent helpers ───────────────────────────────────────────────────────

    /**
     * Builds the launch intent that brings the app to foreground.
     *
     * @param sessionAlreadyActive  When true, MainActivity will skip calling
     *   onRoutineTriggered() (FIX 3) and just navigate to the focus tab instead,
     *   preventing a double-start when the user taps the session-active notification.
     */
    private fun launchIntent(
        context: Context,
        routine: JSONObject,
        sessionAlreadyActive: Boolean = false
    ): Intent =
        (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("pending_routine_json", routine.toString())
            // FIX 3: tells MainActivity not to re-trigger onRoutineTriggered()
            if (sessionAlreadyActive) putExtra("session_already_active", true)
        }
}

/**
 * WebViewHolder — lightweight singleton to expose the active WebView.
 *
 * WeakReference prevents the static field from leaking the Activity context.
 *
 * In your Activity / Fragment:
 *   onCreate / onResume  → WebViewHolder.set(webView)
 *   onDestroy            → WebViewHolder.clear()
 */
object WebViewHolder {
    private var instance: java.lang.ref.WeakReference<WebView>? = null

    fun set(webView: WebView)  { instance = java.lang.ref.WeakReference(webView) }
    fun clear()                { instance = null }
    fun get(): WebView?        = instance?.get()
}