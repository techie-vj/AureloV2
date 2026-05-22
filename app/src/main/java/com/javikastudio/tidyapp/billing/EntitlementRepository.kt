package com.javikastudio.tidyapp.billing

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * EntitlementRepository — single source of truth for Pro status.
 *
 * Uses the SAME EncryptedSharedPreferences pattern as AppBridge.securePrefs
 * (tidyapp_secure_v1) but stored under a separate file name so billing data
 * stays isolated. Falls back to plain prefs if Keystore is unavailable,
 * matching AppBridge's existing fallback pattern.
 *
 * Pro status is cached locally so:
 *   - App works offline after purchase
 *   - No Play query needed on every cold start (BillingManager queries on connect)
 *   - Status survives process death
 *
 * KEY_LAST_PRO_CONFIRMED_MS — timestamp of the most recent billing confirmation
 * that isPro=true. Updated only when granting Pro, never on revocation. Used by
 * AppBridge and JS to apply a grace period before running destructive cleanup,
 * preventing spurious downgrades caused by transient billing errors or Play
 * cache misses on cold start.
 */
class EntitlementRepository(private val context: Context) {

    companion object {
        private const val TAG                       = "AureloEntitlement"
        private const val PREFS_FILE                = "tidyapp_entitlement_v1"
        private const val KEY_IS_PRO                = "is_pro"
        private const val KEY_VERIFIED_AT           = "verified_at_ms"
        private const val KEY_LAST_PRO_CONFIRMED_MS = "last_pro_confirmed_ms"
        // Cache is valid for 7 days offline — after that, Play re-confirms on next connect
        private const val CACHE_TTL_MS = 7L * 24 * 60 * 60 * 1000
        const val REVOCATION_GRACE_MS  = 72L * 60 * 60 * 1000  // 72 h
        // Mirror constants for the main prefs file (tidyapp_v6).
        // Kept private so the billing package stays self-contained; no import of BridgeKeys needed.
        // EntitlementRepository is now the SINGLE write point for IS_PRO_USER in both stores,
        // eliminating the multi-site write race described in Issue 2.
        private const val MAIN_PREFS_FILE = "tidyapp_v6"
        private const val MAIN_KEY_IS_PRO = "is_pro_user"
    }

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Same fallback as AppBridge.securePrefs
            Log.w(TAG, "EncryptedSharedPreferences unavailable, falling back: ${e.message}")
            context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        }
    }

    // Plain prefs mirror — readers such as BedtimeReceiver and SmartNotificationWorker
    // that have not yet been migrated to EntitlementRepository read IS_PRO_USER from here.
    // By writing from setProStatus()/revokePro() only, we eliminate the multi-site write race.
    private val mainPrefs: SharedPreferences by lazy {
        context.getSharedPreferences(MAIN_PREFS_FILE, Context.MODE_PRIVATE)
    }

    // ── Read ──────────────────────────────────────────────────────

    /**
     * Returns current cached Pro status.
     * BillingManager will update this on every successful connect — treat as optimistic cache.
     */
    val isPro: Boolean
        get() = prefs.getBoolean(KEY_IS_PRO, false)

    /**
     * True if cached status is within TTL — used to decide if we need
     * an urgent re-verify on startup (e.g. after long offline period).
     */
    val isCacheValid: Boolean
        get() {
            val verifiedAt = prefs.getLong(KEY_VERIFIED_AT, 0L)
            return verifiedAt > 0 && (System.currentTimeMillis() - verifiedAt) < CACHE_TTL_MS
        }

    /**
     * Timestamp of the last time billing positively confirmed isPro=true.
     * Only updated when granting Pro — never cleared on revocation.
     *
     * Used by AppBridge to implement the revocation grace period:
     *   - If this is recent (< REVOCATION_GRACE_MS), a billing "false" may be
     *     transient (Play cache empty, network error). Skip destructive cleanup.
     *   - If this is old (> REVOCATION_GRACE_MS), trust billing and run cleanup.
     *
     * 0L means Pro was never confirmed on this device (free user or fresh install).
     */
    val lastProConfirmedMs: Long
        get() = prefs.getLong(KEY_LAST_PRO_CONFIRMED_MS, 0L)

    // ── Write ─────────────────────────────────────────────────────

    /**
     * True when billing last confirmed Pro within REVOCATION_GRACE_MS (72 h).
     * A billing "false" during this window is treated as a transient Play cache miss,
     * not a genuine lapse. AppBridge skips destructive downgrade cleanup when this is true.
     * Returns false if Pro was never confirmed on this device (free user / fresh install).
     */
    fun isWithinRevocationGrace(): Boolean {
        val last = lastProConfirmedMs
        return last > 0L && (System.currentTimeMillis() - last) < REVOCATION_GRACE_MS
    }

    /**
     * Called by BillingManager after a verified purchase or purchase query.
     *
     * @param isPro true = grant Pro (also updates lastProConfirmedMs),
     *              false = mark as free (lastProConfirmedMs is intentionally NOT cleared
     *                      so the grace period can check when Pro was last real).
     */
    fun setProStatus(isPro: Boolean) {
        Log.d(TAG, "Setting Pro status: $isPro")
        val editor = prefs.edit()
            .putBoolean(KEY_IS_PRO, isPro)
            .putLong(KEY_VERIFIED_AT, System.currentTimeMillis())
        if (isPro) {
            // Only stamp the confirmation time when billing positively grants Pro.
            // This timestamp is the anchor for the revocation grace period.
            editor.putLong(KEY_LAST_PRO_CONFIRMED_MS, System.currentTimeMillis())
        }
        editor.apply()
        // Mirror to main prefs so native receivers (BedtimeReceiver, SmartNotificationWorker)
        // that read IS_PRO_USER from tidyapp_v6 stay in sync. This is the ONLY write site
        // for IS_PRO_USER — all other callers were migrated to call setProStatus() instead.
        mainPrefs.edit().putBoolean(MAIN_KEY_IS_PRO, isPro).apply()
    }

    /**
     * Clears Pro status — called on refund / purchase revocation.
     * Does NOT clear lastProConfirmedMs — the grace period logic needs it.
     */
    fun revokePro() {
        prefs.edit()
            .putBoolean(KEY_IS_PRO, false)
            .putLong(KEY_VERIFIED_AT, System.currentTimeMillis())
            .apply()
        // Mirror revocation to main prefs.
        mainPrefs.edit().putBoolean(MAIN_KEY_IS_PRO, false).apply()
    }
}
