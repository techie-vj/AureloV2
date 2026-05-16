package com.javikastudio.tidyapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.*
import java.util.concurrent.TimeUnit

class ReferralExtensionWorker(
    private val context: Context,
    workerParams: WorkerParameters,
) : Worker(context, workerParams) {

    companion object {
        private const val TAG      = "ReferralExtensionWorker"
        const val WORK_NAME        = "aurelo_referral_extension_expiry"
        private const val NOTIF_ID = 7823

        fun scheduleExpiry(context: Context) {
            // BUG-L2 FIX: use the PREFS_FILE constant from BridgeKeys instead of a
            // hardcoded string. Previously "tidyapp_v6" was duplicated here; if the
            // prefs file were ever renamed, this worker would silently read from an
            // empty store and never find REFERRAL_EXTENSION_EXPIRY_MS.
            val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
            val expiryMs = prefs.getLong(REFERRAL_EXTENSION_EXPIRY_MS, 0L)

            if (expiryMs <= 0L) {
                Log.w(TAG, "scheduleExpiry called but expiry timestamp is 0 — skipping")
                return
            }

            val delayMs = (expiryMs - System.currentTimeMillis()).coerceAtLeast(0L)
            Log.d(TAG, "Scheduling extension expiry in ${delayMs / 60_000} min")

            val request = OneTimeWorkRequestBuilder<ReferralExtensionWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "Extension expiry work cancelled (user re-subscribed)")
        }
    }

    override fun doWork(): Result {
        val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

        // Belt-and-suspenders: if billing renewed before this worker fired, do nothing.
        // isExtensionActive() reads the current REFERRAL_EXTENSION_EXPIRY_MS; a billing
        // renewal would have updated that timestamp via the normal subscription path.
        if (ReferralManager.isExtensionActive(prefs)) {
            Log.d(TAG, "Extension still active — skipping revocation")
            return Result.success()
        }

        // BUG-REF-3 FIX: before revoking Pro, check whether the user earned additional
        // referral rewards WHILE the previous extension was running (e.g. another friend
        // converted and bankExtensionDays() stored days in REFERRAL_PENDING_EXTENSION_DAYS).
        // Those days would otherwise be silently abandoned when we revoke Pro below.
        //
        // activateExtensionOnLapse() is idempotent: it reads pending days, writes a new
        // REFERRAL_EXTENSION_EXPIRY_MS from now + banked days, zeroes the pending counter,
        // and returns the days activated (0 if nothing was banked).
        val newDays = ReferralManager.activateExtensionOnLapse(prefs)
        if (newDays > 0) {
            Log.d(TAG, "BUG-REF-3 FIX: $newDays banked day(s) found — extending Pro, skipping revocation")

            // Keep IS_PRO_USER true so native receivers (BedtimeReceiver, startWindDownFilter)
            // continue to see Pro status without a gap.
            prefs.edit().putBoolean(IS_PRO_USER, true).apply()

            // BUG-REF-5 FIX: refresh EntitlementRepository so lastProConfirmedMs is
            // anchored to now. Without this the 72-h grace window expires relative to
            // when the PREVIOUS extension was activated, causing isWithinRevocationGrace()
            // to return false mid-extension and triggering a spurious double-lapse on the
            // next foreground billing query — wiping the freshly-activated extension.
            try {
                com.javikastudio.tidyapp.billing.EntitlementRepository(context).setProStatus(true)
            } catch (_: Exception) {
                Log.w(TAG, "BUG-REF-5: Could not update EntitlementRepository for extension renewal")
            }

            // Reschedule expiry worker for the new extension window. scheduleExpiry() reads
            // the updated REFERRAL_EXTENSION_EXPIRY_MS that activateExtensionOnLapse() just
            // wrote, so the delay is computed correctly.
            scheduleExpiry(context)
            return Result.success()
        }

        Log.d(TAG, "Extension expired — revoking Pro access")
        prefs.edit().putBoolean(IS_PRO_USER, false).apply()
        // BUG-03 FIX: also revoke EntitlementRepository (tidyapp_entitlement_v1).
        // Previously only IS_PRO_USER in tidyapp_v6 was cleared, causing split-brain:
        // BillingBridge.isProUser() (reads entitlement repo) still returned true while
        // native receivers (BedtimeReceiver etc.) saw false from tidyapp_v6.
        com.javikastudio.tidyapp.billing.EntitlementRepository(context).revokePro()
        postExpiryNotification()
        return Result.success()
    }

    private fun postExpiryNotification() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "aurelo_referral_expiry"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Referral Pro extension",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Notifies when a referral-earned Pro extension expires"
                enableLights(false)
                enableVibration(false)
            }
            nm.createNotificationChannel(channel)
        }

        val tapIntent = context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }

        val pi = tapIntent?.let {
            PendingIntent.getActivity(
                context, NOTIF_ID, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Your referral Pro extension has ended")
            .setContentText("Subscribe to keep Pro, or refer more friends to bank more days.")
            .setStyle(NotificationCompat.BigTextStyle()
                .bigText("Your referral-earned free Pro days have run out. Subscribe to Aurelo Pro to keep access, or share your referral link to earn more days."))
            .apply { if (pi != null) setContentIntent(pi) }
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        nm.notify(NOTIF_ID, notification)
    }
}