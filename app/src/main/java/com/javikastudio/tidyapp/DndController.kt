package com.javikastudio.tidyapp

import android.app.NotificationManager
import android.content.Context

/**
 * DndController — single chokepoint for engaging/releasing system Do Not Disturb.
 *
 * Aurelo has multiple subsystems that can claim DND (Bedtime Mode and Quiet Hours
 * today; potentially more later). Without a shared owner token, the receiver that
 * fires *last* clobbers DND state — e.g. a Bedtime wake-up alarm that runs while
 * a Quiet Hours window is still active would silently un-mute the phone.
 *
 * Ownership rules:
 *   • acquire(owner) snapshots the user's prior InterruptionFilter on first
 *     acquisition (so we can restore it later) and writes the current owner.
 *   • release(owner) restores the prior filter ONLY if the caller currently
 *     owns DND. Releases from a non-owning subsystem are no-ops, preventing
 *     the late-firing-bedtime-alarm bug described above.
 *   • acquire() can be called by a higher-priority owner while a lower one
 *     holds DND — the new owner takes over and the snapshot is preserved
 *     (so end-of-all-windows still restores to the original system state).
 *
 * v1 priority order: BEDTIME > QUIET_HOURS. Higher-priority acquires override
 * lower-priority owners; lower-priority acquires are deferred and treated as
 * a no-op for the DND filter but the owner field is left untouched.
 *
 * Mode is always [NotificationManager.INTERRUPTION_FILTER_PRIORITY] for
 * Quiet Hours (allows starred contacts + repeat callers via system policy)
 * and [NotificationManager.INTERRUPTION_FILTER_ALARMS] for Bedtime, matching
 * existing behaviour in BedtimeReceiver.setDnd.
 */
object DndController {

    /** Returns true if DND was actually engaged. */
    fun acquire(ctx: Context, owner: String, filter: Int): Boolean {
        if (owner != DND_OWNER_BEDTIME && owner != DND_OWNER_QUIET_HOURS) return false
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
        if (!nm.isNotificationPolicyAccessGranted) return false

        val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        val currentOwner = prefs.getString(DND_OWNER, DND_OWNER_NONE) ?: DND_OWNER_NONE

        // Higher-priority acquires take over from lower-priority ones.
        // Lower-priority acquires while a higher one holds DND are deferred.
        if (currentOwner == DND_OWNER_BEDTIME && owner == DND_OWNER_QUIET_HOURS) {
            // Quiet Hours wants in but Bedtime owns DND — leave alone.
            return false
        }

        // Snapshot the user's prior filter only on the *first* acquisition of
        // this DND "session" (i.e. when no one currently owns it). Subsequent
        // hand-offs between owners preserve the same snapshot.
        if (currentOwner == DND_OWNER_NONE) {
            runCatching {
                val current = nm.currentInterruptionFilter
                prefs.edit().putInt(QUIET_HOURS_PRE_DND_FILTER, current).apply()
            }
        }

        return runCatching {
            nm.setInterruptionFilter(filter)
            prefs.edit().putString(DND_OWNER, owner).apply()
            true
        }.getOrDefault(false)
    }

    /**
     * Release DND if the caller owns it. Restores the snapshotted filter.
     * Returns true if state changed (filter was actually restored).
     */
    fun release(ctx: Context, owner: String): Boolean {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
        if (!nm.isNotificationPolicyAccessGranted) return false

        val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        val currentOwner = prefs.getString(DND_OWNER, DND_OWNER_NONE) ?: DND_OWNER_NONE
        if (currentOwner != owner) return false

        val priorFilter = prefs.getInt(QUIET_HOURS_PRE_DND_FILTER, NotificationManager.INTERRUPTION_FILTER_ALL)
        return runCatching {
            nm.setInterruptionFilter(priorFilter)
            prefs.edit()
                .putString(DND_OWNER, DND_OWNER_NONE)
                .remove(QUIET_HOURS_PRE_DND_FILTER)
                .apply()
            true
        }.getOrDefault(false)
    }

    /**
     * Current owner of DND (or DND_OWNER_NONE). Used by receivers to make
     * priority decisions without re-implementing the rules.
     */
    fun currentOwner(ctx: Context): String {
        val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        return prefs.getString(DND_OWNER, DND_OWNER_NONE) ?: DND_OWNER_NONE
    }

    /**
     * Convenience helper: returns true if Quiet Hours should be allowed to
     * engage DND right now. False when Bedtime currently owns DND.
     */
    fun canQuietHoursAcquire(ctx: Context): Boolean =
        currentOwner(ctx) != DND_OWNER_BEDTIME

    /** Returns true if the runtime permission for DND policy access is granted. */
    fun hasPermission(ctx: Context): Boolean =
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)
            ?.isNotificationPolicyAccessGranted ?: false
}
