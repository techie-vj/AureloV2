package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// CoachInsightWorker — daily WorkManager job that:
//   1. Reads latest UsageSummary (screen + HC data merged)
//   2. Runs KotlinPatternDetector to find the highest-priority pattern
//   3. Generates notification text via InsightTemplateLibrary
//   4. Posts the notification (respects user's smart-alerts toggle)
//   5. Caches the insight JSON for the Home tab insight card
//
// Trigger: daily at user's optimal time (default 08:30) via periodic work.
// Constraints: not low battery. Network: not required. Charging: not required.
// Spec §18.1
// ═══════════════════════════════════════════════════════════════════════════

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class CoachInsightWorker(
    private val context: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

    companion object {
        const val WORK_NAME = "aurelo_coach_daily_insight"

        /**
         * Enqueue the daily insight worker.
         * Uses ExistingPeriodicWorkPolicy.KEEP so re-scheduling on boot
         * doesn't reset the timer mid-cycle.
         */
        fun schedule(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

            // Check smart-alerts toggle (spec §10.6 / §8)
            val alertsEnabled = prefs.getBoolean("smart_alerts_enabled", true)
            if (!alertsEnabled) {
                WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
                return
            }

            // Calculate initial delay so first run hits ~08:30 local time
            val delayMs = delayUntilNextOccurrence(hour = 8, minute = 30)

            val request = PeriodicWorkRequestBuilder<CoachInsightWorker>(
                repeatInterval = 24,
                repeatIntervalTimeUnit = TimeUnit.HOURS,
            )
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiresBatteryNotLow(true)
                        .build()
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                // H4 FIX: UPDATE (not KEEP) so that after a device reboot or app update the
                // initialDelay is re-computed from the current time.  KEEP preserved the old
                // request's delay base, meaning the worker could miss 08:30 by an entire day
                // after a reboot.  UPDATE cancels-and-replaces the pending work with a fresh
                // delay calculation while leaving any already-running execution intact.
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        /** Returns milliseconds until the next occurrence of hour:minute. */
        private fun delayUntilNextOccurrence(hour: Int, minute: Int): Long {
            val now = java.util.Calendar.getInstance()
            val target = java.util.Calendar.getInstance().apply {
                set(java.util.Calendar.HOUR_OF_DAY, hour)
                set(java.util.Calendar.MINUTE, minute)
                set(java.util.Calendar.SECOND, 0)
                set(java.util.Calendar.MILLISECOND, 0)
            }
            if (target.before(now)) target.add(java.util.Calendar.DAY_OF_YEAR, 1)
            return target.timeInMillis - now.timeInMillis
        }
    }

    override suspend fun doWork(): Result {
        return try {
            val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

            // Smart-alerts toggle check
            if (!prefs.getBoolean("smart_alerts_enabled", true)) return Result.success()

            // Build merged UsageSummary ─────────────────────────────────────
            val hcManager = HealthConnectManager(context)
            val hcData: HCDailyData = if (hcManager.isAvailable() && hcManager.hasAnyPermission()) {
                try {
                    val repo = HealthConnectRepository(hcManager)
                    kotlinx.coroutines.withTimeoutOrNull(5_000) { repo.readDailyData() }
                        ?: HCDailyData(isAvailable = false)
                } catch (_: Exception) {
                    HCDailyData(isAvailable = false)
                }
            } else {
                HCDailyData(isAvailable = false)
            }

            val summaryBuilder = UsageSummaryBuilder(context, prefs)
            // FIX: drop the hard-coded 7-day window so InsightTemplateLibrary
            // can surface ESTABLISHED-variant copy for users with 30+ days of
            // data. UsageSummaryBuilder now derives the window from cached
            // history depth.
            val summary = summaryBuilder.build(hcData)

            // Run pattern detection ────────────────────────────────────────
            val patterns = KotlinPatternDetector.detectAll(summary)
            val topPattern = patterns.firstOrNull() ?: return Result.success()

            // Generate notification text ───────────────────────────────────
            val insight = InsightTemplateLibrary.get(topPattern, summary)

            // Cache for Home tab insight card ─────────────────────────────
            val insightJson = JSONObject().apply {
                put("title",   insight.title)
                put("body",    insight.body)
                put("intent",  topPattern.intent)
                put("hcBadge", topPattern.hcBased)
            }.toString()

            prefs.edit()
                .putString("coach_daily_insight_json", insightJson)
                .putString("coach_daily_insight_date",
                    java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US).format(java.util.Date()))
                .apply()

            // Post notification ────────────────────────────────────────────
            postNotification(insight)

            Result.success()
        } catch (e: Exception) {
            android.util.Log.e("CoachInsightWorker", "doWork failed", e)
            Result.retry()
        }
    }

    // ── Notification ─────────────────────────────────────────────────────────

    private fun postNotification(insight: InsightTemplateLibrary.InsightText) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Create channel (Android 8.0+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                InsightTemplateLibrary.NOTIFICATION_CHANNEL_ID,
                InsightTemplateLibrary.NOTIFICATION_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Daily wellness insights from Aurelo Coach"
                enableLights(false)
                enableVibration(false)
                setShowBadge(true)
            }
            nm.createNotificationChannel(channel)
        }

        // Tap opens MainActivity (which boots the WebView to Home)
        val tapIntent = context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }
            ?: return

        val pi = PendingIntent.getActivity(
            context, InsightTemplateLibrary.NOTIFICATION_ID, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, InsightTemplateLibrary.NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)   // BUG-FIX: ic_notification doesn't exist; use system icon like SmartNotificationWorker
            .setContentTitle(insight.title)
            .setContentText(insight.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(insight.body))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        nm.notify(InsightTemplateLibrary.NOTIFICATION_ID, notification)
    }
}