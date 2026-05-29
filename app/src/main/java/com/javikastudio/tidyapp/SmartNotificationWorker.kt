package com.javikastudio.tidyapp

import android.Manifest
import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import androidx.core.app.NotificationCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray

/**
 * SmartNotificationWorker
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs every 2 hours via WorkManager — completely independent of whether the
 * app's WebView is open. Reads usage data from SharedPreferences (kept warm
 * by AppBridge.refreshUsageStats every 30 s while the app is in foreground)
 * and posts relevant screen-time alerts to the Android notification shade.
 *
 * Key design decisions:
 *   • Uses Worker (not CoroutineWorker) to avoid coroutines dependency.
 *   • Reads ONLY from SharedPrefs — never does a live queryEvents scan, so
 *     there is no startup latency and no risk of ANR on the worker thread.
 *   • Respects the NOTIF_CLEARED_TS timestamp that AppBridge writes when the
 *     user taps "Clear All" — suppresses re-posting for 1 hour after a clear.
 *   • Uses stable notification IDs (hash-based) so Android replaces, never
 *     duplicates, the same alert when the worker fires multiple times.
 *   • Posts at most 3 notifications per run to avoid spamming the shade.
 *
 * Daily Recap (separate from smart alerts):
 *   • Posts once per day in the 8–10 PM window (research-backed wind-down time).
 *   • Has its own channel (tidy_recap) and its own sent-date flag.
 *   • Ignores notif_cleared_ts — a user clearing alerts should not suppress
 *     their end-of-day summary.
 *   • Only suppressed if smart_alerts_enabled = false (notifications off).
 */
class SmartNotificationWorker(
    private val appContext: Context,
    workerParams: WorkerParameters
) : Worker(appContext, workerParams) {

    private val prefs = appContext.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)

    override fun doWork(): Result {

        // ── Guard: smart alerts must be enabled by the user ─────────────────────
        if (!prefs.getBoolean(SMART_ALERTS_ENABLED, true)) return Result.success()

        // ── Guard: usage permission required ─────────────────────────────────
        if (!hasUsagePermission()) return Result.success()

        // ── Guard: notification permission required (Android 13+) ────────────
        if (!hasNotificationPermission()) return Result.success()

        val nm          = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pendingIntent = buildLaunchIntent()
        val cal         = java.util.Calendar.getInstance()
        val hour        = cal.get(java.util.Calendar.HOUR_OF_DAY)
        val todayMins   = prefs.getLong(CACHED_TOTAL_MINS, 0L)
        val pickups     = prefs.getInt(CACHED_PICKUPS, 0)
        val goalMins    = prefs.getInt(STREAK_GOAL_MINS, 240).toLong()
        val userName    = (prefs.getString("user_name", "") ?: "").trim()

        // ── Daily Recap (8–9 PM, once per day, ignores cleared timestamp) ───
        // Research basis: evening reflection at 8–9 PM is the most effective window
        // for behavior change (post-dinner, pre-sleep prep). Apple Screen Time and
        // Android Digital Wellbeing both default to evening summaries for this reason.
        // ISSUE-05 FIX: was "hour in 20..22" which allowed firing at 10:59 PM —
        // too late and outside the stated research window. Narrowed to 20..21 (8–9 PM).
        if (hour in 20..21) {
            ensureRecapChannel(nm)
            val todayStr = "${cal.get(java.util.Calendar.YEAR)}-${cal.get(java.util.Calendar.DAY_OF_YEAR)}"
            val lastRecapDate = prefs.getString("recap_sent_date", "") ?: ""
            if (lastRecapDate != todayStr && todayMins > 0L) {
                val streakDays  = prefs.getInt(CACHED_STREAK_DAYS, 0)
                val overMin     = (todayMins - goalMins).coerceAtLeast(0)
                val underMin    = (goalMins - todayMins).coerceAtLeast(0)

                // Verdict line — gives the day a clear single-sentence takeaway
                val verdict = when {
                    todayMins > goalMins * 1.5 ->
                        "That's ${fmtM(overMin)} over your goal — tomorrow's a fresh start. 🔄"
                    todayMins > goalMins ->
                        "Just ${fmtM(overMin)} over goal — almost there. 💪"
                    underMin <= 10 ->
                        "Right on goal — solid day. ✅"
                    streakDays > 0 ->
                        "${fmtM(underMin)} under goal. $streakDays-day streak! 🔥"
                    else ->
                        "${fmtM(underMin)} under your goal. Great discipline. ✅"
                }

                val title = if (userName.isNotEmpty()) "📊 $userName's Day in Review" else "📊 Your Day in Review"
                val body  = buildString {
                    append("${fmtM(todayMins)} screen time · $pickups pickups")
                    if (streakDays > 0) append(" · ${streakDays}🔥 streak")
                    append("\n")
                    append(verdict)
                }

                val notif = NotificationCompat.Builder(appContext, RECAP_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setColor(0xFF6C63FF.toInt())
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setAutoCancel(true)
                    .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
                    .build()

                nm.notify(RECAP_NOTIF_ID, notif)
                prefs.edit().putString("recap_sent_date", todayStr).apply()

                // ADD THIS — persist recap to in-app history
                val histKey = NOTIF_HISTORY_KEY
                runCatching {
                    val existing = prefs.getString(histKey, "[]") ?: "[]"
                    val arr = org.json.JSONArray(existing)
                    val obj = org.json.JSONObject()
                    obj.put("id", "recap|$todayStr")
                    obj.put("type", "recap")
                    obj.put("title", title)
                    obj.put("body", body)
                    obj.put("timestamp", System.currentTimeMillis())
                    obj.put("read", false)
                    val newArr = org.json.JSONArray()
                    newArr.put(obj)
                    val cutoff = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000
                    for (i in 0 until arr.length()) {
                        val entry = arr.getJSONObject(i)
                        if (entry.optLong("timestamp", 0L) > cutoff) newArr.put(entry)
                    }
                    prefs.edit().putString(histKey, newArr.toString()).apply()
                }
            }
        }

        // ── Smart Alerts (respect cleared timestamp) ─────────────────────────
        val clearedTs = prefs.getLong(NOTIF_CLEARED_TS, 0L)
        // Weekly Recap notification (PRO, Sunday only, once per week)
        // Deduped by ISO week key so re-runs within the same week never re-fire.
        // Ignores notif_cleared_ts (same rationale as the daily recap above).
        val isPro     = prefs.getBoolean(IS_PRO_USER, false)
        val dayOfWeek = cal.get(java.util.Calendar.DAY_OF_WEEK)
        if (isPro && dayOfWeek == java.util.Calendar.SUNDAY) {
            val currentWeek   = WeeklyRecapBridge.getIsoWeekYear(cal)
            val lastRecapWeek = prefs.getString(LAST_WEEKLY_RECAP_WEEK, "") ?: ""
            if (lastRecapWeek != currentWeek) {
                ensureRecapChannel(nm)
                // Note: emoji rendered at runtime; Kotlin string literal uses escape
                val wrTitle = if (userName.isNotEmpty()) "$userName, your week is ready \uD83C\uDFC1" else "Your week is ready \uD83C\uDFC1"
                val wrBody  = "See your Aurelo Score average, top apps, and weekly summary."

                // Deep-link intent — MainActivity reads EXTRA_OPEN_WEEKLY_RECAP on resume
                val wrIntent = appContext.packageManager
                    .getLaunchIntentForPackage(appContext.packageName)
                    ?.apply {
                        putExtra(EXTRA_OPEN_WEEKLY_RECAP, currentWeek)
                        putExtra(EXTRA_OPEN_NOTIFICATIONS, true)
                    }
                val wrPendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                else PendingIntent.FLAG_UPDATE_CURRENT
                val wrPendingIntent = if (wrIntent != null)
                    PendingIntent.getActivity(
                        appContext, WEEKLY_RECAP_NOTIF_ID, wrIntent, wrPendingFlags)
                else null

                val wrNotif = NotificationCompat.Builder(appContext, RECAP_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setColor(0xFF6C63FF.toInt())
                    .setContentTitle(wrTitle)
                    .setContentText(wrBody)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(wrBody))
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setAutoCancel(true)
                    .apply { if (wrPendingIntent != null) setContentIntent(wrPendingIntent) }
                    .build()

                nm.notify(WEEKLY_RECAP_NOTIF_ID, wrNotif)
                prefs.edit().putString(LAST_WEEKLY_RECAP_WEEK, currentWeek).apply()

                // Persist to in-app notification history with isoWeekYear metadata
                // so tapping the history item opens that specific week's sheet.
                runCatching {
                    val existing = prefs.getString(NOTIF_HISTORY_KEY, "[]") ?: "[]"
                    val arr      = org.json.JSONArray(existing)
                    val obj      = org.json.JSONObject()
                    obj.put("id",          "weekly_recap|$currentWeek")
                    obj.put("type",        "weekly_recap")
                    obj.put("title",       wrTitle)
                    obj.put("body",        wrBody)
                    obj.put("isoWeekYear", currentWeek)
                    obj.put("timestamp",   System.currentTimeMillis())
                    obj.put("read",        false)
                    val cutoff  = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000
                    val newArr  = org.json.JSONArray()
                    newArr.put(obj)
                    for (i in 0 until arr.length()) {
                        val entry = arr.getJSONObject(i)
                        if (entry.optLong("timestamp", 0L) > cutoff) newArr.put(entry)
                    }
                    prefs.edit().putString(NOTIF_HISTORY_KEY, newArr.toString()).apply()
                }
            }
        }
        if (System.currentTimeMillis() - clearedTs < 6 * 60 * 60_000L) return Result.success()

        val todayDate   = "${cal.get(java.util.Calendar.YEAR)}-${cal.get(java.util.Calendar.DAY_OF_YEAR)}"
        ensureAlertChannel(nm)

        // ── Streak at risk ────────────────────────────────────────────────────
        // Fires when: streak > 3 days AND current pace will exceed goal AND there
        // is still time to course-correct (before 8 PM). Only once per day.
        // A streak worth protecting (>3 days) plus a concrete time-remaining hook
        // is the highest-leverage behavior-change message in digital wellness research.
        val streakDays      = prefs.getInt(CACHED_STREAK_DAYS, 0)
        val streakRiskSent  = prefs.getString("streak_risk_sent_date", "") ?: ""
        if (streakDays > 3 && hour in 14..19 && streakRiskSent != todayDate) {
            // Project end-of-day total based on current pace since midnight
            val dayMinutesElapsed = (hour * 60 + cal.get(java.util.Calendar.MINUTE)).coerceAtLeast(1)
            val projectedMins     = todayMins * 1440L / dayMinutesElapsed
            val minutesLeft       = ((24 - hour) * 60).toLong()
            if (projectedMins > goalMins && todayMins > goalMins * 0.6) {
                val overBy    = (projectedMins - goalMins).coerceAtLeast(1L)
                val title     = if (userName.isNotEmpty()) "🔥 $userName — $streakDays-day streak at risk" else "🔥 Streak at Risk — $streakDays days"
                val body      = "At this pace you'll finish ~${fmtM(overBy)} over goal. " +
                        "${fmtM(minutesLeft)} left today — put the phone down to protect your streak."
                postAlertNotification(nm, STREAK_RISK_NOTIF_ID, title, body, "warn", pendingIntent)
                prefs.edit().putString("streak_risk_sent_date", todayDate).apply()
            }
        }

        // ── Personal best ─────────────────────────────────────────────────────
        // Fires when today's screen time is the lowest of the past 7 days AND
        // it's afternoon/evening (enough data has accumulated to be meaningful).
        // Only fires once per day, and only when today is genuinely standout —
        // not just slightly below average, but below every other day this week.
        val personalBestSent = prefs.getString("personal_best_sent_date", "") ?: ""
        if (hour in 17..21 && personalBestSent != todayDate && todayMins > 10L) {
            runCatching {
                val weeklyJson = prefs.getString(CACHED_WEEKLY, "[]") ?: "[]"
                val weekly     = org.json.JSONArray(weeklyJson)
                // Collect past 6 days (exclude today which is isToday=true)
                val pastMins   = mutableListOf<Long>()
                for (i in 0 until weekly.length()) {
                    val day = weekly.getJSONObject(i)
                    if (!day.optBoolean("isToday", false)) {
                        val m = day.optLong("minutes", 0L)
                        if (m > 0L) pastMins += m
                    }
                }
                if (pastMins.size >= 3 && pastMins.all { todayMins < it }) {
                    val avgPast = pastMins.average().toLong()
                    val savedMin = avgPast - todayMins
                    val title = if (userName.isNotEmpty()) "🏆 $userName — Personal Best!" else "🏆 Personal Best This Week"
                    val body  = "${fmtM(todayMins)} so far — lower than every other day this week. " +
                            "That's ${fmtM(savedMin)} less than your daily average. Keep it up."
                    postAlertNotification(nm, PERSONAL_BEST_NOTIF_ID, title, body, "success", pendingIntent)
                    prefs.edit().putString("personal_best_sent_date", todayDate).apply()
                }
            }
        }

        // ── Guard: one notification group per time slot per calendar day ─────
        val currentSlot = when {
            hour in 6..11  -> "morning"
            hour in 12..17 -> "afternoon"
            hour in 18..22 -> "evening"
            else           -> "night"
        }

        // ── Referral: friend pending nudge ────────────────────────────────────
        // Fires once when a referred friend has been in trial for ~14 days.
        if (ReferralManager.shouldFirePendingReferralNudge(prefs)) {
            ensureReferralChannel(nm)
            val title = "⏳ Your friend is still trying Aurelo Pro"
            val body = "They've had Pro for 14 days — earn ${REFERRAL_INSTALL_DAYS}+ days free when they subscribe."
            val notif = NotificationCompat.Builder(appContext, REFERRAL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setColor(0xFF6C63FF.toInt())
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
                .build()
            nm.notify(REFERRAL_PENDING_NOTIF_ID, notif)
            // BUG-02 FIX: removed postAlertNotification() here — it was re-posting the same
            // notification to the wrong channel (tidy_alerts) and duplicating the in-app entry.
        }

        // HIGH-2 FIX: mark exactly ONE friend lapsed per worker run.
        // The old code called repeat(unresolved) { recordFriendLapsed() } in a single
        // shot, marking ALL unresolved friends lapsed simultaneously. If a referrer had
        // 1 old lapsed friend and 2 new friends still in trial, all 3 were marked lapsed
        // together. The oldest timestamp was then zeroed, so the 2 recent friends
        // permanently lost their lapse tracking.
        //
        // Fix: mark 1 at a time. Keep REFERRAL_OLDEST_INSTALL_TS pointing to the same
        // timestamp so the next worker run (≈2 h later) sees daysSinceOldest > 30 again
        // and marks another 1 — repeating until unresolved reaches 0. Only when the
        // final unresolved friend is marked do we clear the oldest timestamp so a fresh
        // batch of new installs can start tracking from zero.
        run {
            val lastInstallTs = prefs.getLong(REFERRAL_LAST_INSTALL_TS, 0L)
            if (lastInstallTs > 0L) {
                val totalInstalls    = prefs.getInt(REFERRAL_TOTAL_INSTALLS, 0)
                val totalConversions = prefs.getInt(REFERRAL_TOTAL_CONVERSIONS, 0)
                val totalLapsed      = prefs.getInt(REFERRAL_TOTAL_LAPSED, 0)
                val oldestInstallTs  = prefs.getLong(REFERRAL_OLDEST_INSTALL_TS, 0L)
                val daysSinceOldest  = if (oldestInstallTs > 0L)
                    ((System.currentTimeMillis() - oldestInstallTs) / 86_400_000L).toInt() else 0

                if (daysSinceOldest > 30) {
                    val unresolved = (totalInstalls - totalConversions - totalLapsed).coerceAtLeast(0)
                    if (unresolved > 0) {
                        ReferralManager.recordFriendLapsed(prefs)
                        // Only clear the oldest timestamp when the last unresolved friend is processed,
                        // so subsequent runs keep firing for any remaining unresolved friends.
                        if (unresolved == 1) {
                            prefs.edit().putLong(REFERRAL_OLDEST_INSTALL_TS, 0L).apply()
                        }
                    }
                }
            }
        }

        // ── Referral: friend converted notification ────────────────────────────
        // Fires when a friend converted and we have a pending conversion event.
        val conversionData = ReferralManager.consumePendingConversionNotif(prefs)
        if (conversionData != null) {
            ensureReferralChannel(nm)
            val days = conversionData.optInt("days", 31)
            val plan = conversionData.optString("plan", "Pro")
            val title = "🎉 Your friend just joined Aurelo Pro!"
            val body  = "You've earned +${days} free day${if (days != 1) "s" else ""} of Pro — thanks for spreading the word."
            val notif = NotificationCompat.Builder(appContext, REFERRAL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setColor(0xFF12D48A.toInt())
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
                .build()
            nm.notify(REFERRAL_CONVERTED_NOTIF_ID, notif)
        }

        val lastSlotKey = prefs.getString("notif_last_slot_key", "") ?: ""
        val expectedKey = "$todayDate-$currentSlot"
        if (lastSlotKey == expectedKey) return Result.success()

        // No meaningful data yet — skip until the foreground scan has run at least once
        if (todayMins == 0L && pickups == 0) return Result.success()

        ensureAlertChannel(nm)

        val alerts = mutableListOf<Triple<String, String, String>>() // title, body, type

        // Screen-time vs goal
        when {
            todayMins > goalMins * 1.75 ->
                alerts += Triple(
                    "High Screen Time 🔴",
                    "${fmtM(todayMins)} today — ${fmtM(todayMins - goalMins)} over your ${fmtM(goalMins)} goal.",
                    "warn"
                )
            todayMins > goalMins ->
                alerts += Triple(
                    "Daily Goal Exceeded ⚠️",
                    "${fmtM(todayMins)} used — ${fmtM(todayMins - goalMins)} over your ${fmtM(goalMins)} goal.",
                    "warn"
                )
            todayMins > goalMins * 0.75 ->
                alerts += Triple(
                    "Screen Time Update 📊",
                    "${fmtM(todayMins)} used. Only ${fmtM(goalMins - todayMins)} left under your goal.",
                    "info"
                )
        }

        // Pickup frequency
        // FIX: "nearly once a minute" was wrong — it compared pickups against
        // the full 1440-min day, not actual elapsed time or screen time.
        // Now computes two meaningful stats:
        //   intervalMins  — avg minutes between pickups across elapsed day time
        //   perHourOfUse  — pickups per hour of actual screen time
        val dayMinsElapsed = (hour * 60 + cal.get(java.util.Calendar.MINUTE)).coerceAtLeast(1)
        val intervalMins   = (dayMinsElapsed / pickups.coerceAtLeast(1)).coerceAtLeast(1)
        val perHourOfUse   = if (todayMins > 0) (pickups * 60 / todayMins).toInt() else pickups
        val intervalLabel  = when {
            intervalMins < 5  -> "once every ${intervalMins}m"
            intervalMins < 60 -> "once every ${intervalMins}m"
            else              -> "once every ${intervalMins / 60}h ${intervalMins % 60}m"
        }
        when {
            pickups > 80 ->
                alerts += Triple(
                    "High Pickup Count 📲",
                    "$pickups pickups today — $intervalLabel on average, $perHourOfUse times per hour of screen time. Try batching your checks.",
                    "warn"
                )
            pickups > 50 ->
                alerts += Triple(
                    "Frequent Pickups 🔔",
                    "$pickups checks today ($intervalLabel on average). Batching your phone use helps maintain focus.",
                    "info"
                )
        }

        val bestAlert = alerts.firstOrNull() ?: return Result.success()
        val (title, body, type) = bestAlert
        postAlertNotification(nm, stableId(title, body), title, body, type, pendingIntent)


        // ── v2.2: Save streak row for today ─────────────────────────────────────
        // Runs once per worker execution (throttled by slot key above).
        // Computes maintained/missed/N-A for all four pillars and upserts into
        // streak_history table in LaunchTracker SQLCipher DB.
        try {
            val dateFmt  = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            val todayDate = dateFmt.format(java.util.Date())

            // Screen: maintained if today's screen time <= daily goal
            val screenOk = if (goalMins > 0L) if (todayMins <= goalMins) 1 else 0 else -1

            // Focus: maintained if any session completed, any mindful pause triggered,
            // or any app timer limit reached today
            val focusCompleted   = prefs.getInt("focus_completed_today", 0)
            val mindfulPauses    = prefs.getInt("focus_intention_pause_count", 0)
            // Timer hits today — stored as a running count in prefs by AppTimerBridge
            val timerHitsToday   = prefs.getInt("timer_hits_today", 0)
            val focusOk = if (focusCompleted > 0 || mindfulPauses > 0 || timerHitsToday > 0) 1 else 0

            // Bedtime: maintained = last night kept; N/A if Bedtime Mode not enabled
            val bedtimeEnabled = prefs.getBoolean("bedtime_enabled", false)
            val bedtimeOk = when {
                !bedtimeEnabled -> -1
                prefs.getBoolean(BEDTIME_LAST_NIGHT_KEPT, false) -> 1
                prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false) -> 0
                else -> -1  // no data yet for last night
            }

            // Body: maintained = steps >= stepGoal; N/A if HC not connected
            val hcConnected = prefs.getString(HC_CONNECTED, "0") == "1"
            val bodyOk = if (!hcConnected) {
                -1
            } else {
                val stepGoal = try {
                    val masterKey = androidx.security.crypto.MasterKey.Builder(appContext)
                        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                        .build()
                    val secPrefs = androidx.security.crypto.EncryptedSharedPreferences.create(
                        appContext,
                        "tidyapp_secure_v1",
                        masterKey,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                    )
                    secPrefs.getInt(HC_STEP_GOAL, BodyScoreCalculator.DEFAULT_STEP_GOAL)
                } catch (_: Exception) { BodyScoreCalculator.DEFAULT_STEP_GOAL }

                // Steps cached in prefs by HC sync; -1 = no data
                val steps = prefs.getLong("cached_hc_steps_today", -1L).toInt()
                if (steps < 0) -1 else if (steps >= stepGoal) 1 else 0
            }

            LaunchTracker.get(appContext).saveStreakRow(todayDate, screenOk, focusOk, bedtimeOk, bodyOk)
        } catch (e: Exception) {
            android.util.Log.w("StreakWorker", "saveStreakRow failed: ${e.message}")
        }

        prefs.edit().putString("notif_last_slot_key", expectedKey).apply()
        return Result.success()
    }

    // ── Notification channels ─────────────────────────────────────────────────

    private fun ensureAlertChannel(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Aurelo Smart Alerts",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Screen time, pickup, and goal alerts"
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setShowBadge(true)
                    enableVibration(false)
                }
            )
        }
    }

    private fun ensureRecapChannel(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    RECAP_CHANNEL_ID,
                    "Daily Recap",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Your end-of-day screen time summary"
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setShowBadge(true)
                    enableVibration(false)
                }
            )
        }
    }

    // ── Post a smart alert notification ───────────────────────────────────────

    private fun postAlertNotification(
        nm: NotificationManager,
        id: Int,
        title: String,
        body: String,
        type: String,
        pendingIntent: PendingIntent?
    ) {
        val (smallIcon, color, priority) = when (type) {
            "warn"    -> Triple(android.R.drawable.ic_dialog_alert, 0xFFF04E7A.toInt(), NotificationCompat.PRIORITY_HIGH)
            "success" -> Triple(android.R.drawable.ic_dialog_info,  0xFF12D48A.toInt(), NotificationCompat.PRIORITY_DEFAULT)
            else      -> Triple(android.R.drawable.ic_dialog_info,  0xFF6C63FF.toInt(), NotificationCompat.PRIORITY_DEFAULT)
        }

        val notif = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(smallIcon)
            .setColor(color)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(priority)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(
                if (type == "warn") NotificationCompat.CATEGORY_ALARM
                else NotificationCompat.CATEGORY_REMINDER
            )
            .setAutoCancel(true)
            .apply { if (pendingIntent != null) setContentIntent(pendingIntent) }
            .build()

        nm.notify(id, notif)
        // Persist to in-app notification history via SharedPreferences
        val prefs = appContext.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
        val key = NOTIF_HISTORY_KEY
        val existing = prefs.getString(key, "[]") ?: "[]"
        try {
            val arr = JSONArray(existing)
            val obj = org.json.JSONObject()
            obj.put("id", "$title|$body")
            obj.put("type", type)
            obj.put("title", title)
            obj.put("body", body)
            obj.put("timestamp", System.currentTimeMillis())
            obj.put("read", false)
            // Prepend new entry
            val thirtyDaysMs = 30L * 24 * 60 * 60 * 1000
            val newArr = JSONArray()
            newArr.put(obj)
            for (i in 0 until arr.length()) {
                val entry = arr.getJSONObject(i)
                if (System.currentTimeMillis() - entry.optLong("timestamp", 0L) < thirtyDaysMs) {
                    newArr.put(entry)
                }
            }
            prefs.edit().putString(key, newArr.toString()).apply()
        } catch (_: Exception) {}
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun hasUsagePermission(): Boolean {
        val ops  = appContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = ops.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), appContext.packageName
        )
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return appContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    private fun buildLaunchIntent(): PendingIntent? {
        val intent = appContext.packageManager
            .getLaunchIntentForPackage(appContext.packageName) ?: return null
        intent.putExtra(EXTRA_OPEN_NOTIFICATIONS, true)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else PendingIntent.FLAG_UPDATE_CURRENT
        return PendingIntent.getActivity(appContext, 1, intent, flags)
    }

    private fun stableId(title: String, body: String): Int =
        4000 + ((title + body).hashCode() and 0x7FFF)

    private fun fmtM(mins: Long): String {
        if (mins <= 0L) return "0m"
        val h = mins / 60L
        val m = mins % 60L
        return when {
            h > 0L && m > 0L -> "${h}h ${m}m"
            h > 0L           -> "${h}h"
            else             -> "${m}m"
        }
    }

    private fun ensureReferralChannel(nm: NotificationManager) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                android.app.NotificationChannel(
                    REFERRAL_CHANNEL_ID,
                    "Referral Rewards",
                    android.app.NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Friend install and conversion reward notifications"
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    setShowBadge(true)
                    enableVibration(false)
                }
            )
        }
    }

    companion object {
        const val CHANNEL_ID            = "tidy_alerts"
        const val RECAP_CHANNEL_ID      = "tidy_recap"
        const val REFERRAL_CHANNEL_ID   = "tidy_referral"
        const val RECAP_NOTIF_ID        = 5001   // fixed ID — recap always replaces itself
        const val STREAK_RISK_NOTIF_ID  = 5002   // fixed ID — streak warning replaces itself
        const val PERSONAL_BEST_NOTIF_ID = 5003  // fixed ID — personal best replaces itself
        const val REFERRAL_PENDING_NOTIF_ID   = 5004
        const val REFERRAL_CONVERTED_NOTIF_ID = 5005
        const val REFERRAL_INSTALL_DAYS = 3      // days earned per install reward
        const val WORK_NAME             = "tidy_smart_notifs"
        // Prefs keys owned by the weekly recap notification path
        const val WEEKLY_RECAP_NOTIF_ID       = 5006
        const val LAST_WEEKLY_RECAP_WEEK  = "last_weekly_recap_week"
        const val EXTRA_OPEN_WEEKLY_RECAP = "open_weekly_recap"
        const val EXTRA_OPEN_NOTIFICATIONS = "open_notifications"
    }
}