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
 */
class EntitlementRepository(private val context: Context) {

    companion object {
        private const val TAG             = "AureloEntitlement"
        private const val PREFS_FILE      = "tidyapp_entitlement_v1"
        private const val KEY_IS_PRO      = "is_pro"
        private const val KEY_VERIFIED_AT = "verified_at_ms"
        // Cache is valid for 7 days offline — after that, Play re-confirms on next connect
        private const val CACHE_TTL_MS    = 7L * 24 * 60 * 60 * 1000
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

    // ── Read ──────────────────────────────────────────────────────

    /**
     * Returns current cached Pro status.
     * BillingManager will update this on every connect — treat as optimistic cache.
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

    // ── Write ─────────────────────────────────────────────────────

    /**
     * Called by BillingManager after a verified purchase or purchase query.
     * @param isPro true = grant Pro, false = revoke (e.g. refund)
     */
    fun setProStatus(isPro: Boolean) {
        Log.d(TAG, "Setting Pro status: $isPro")
        prefs.edit()
            .putBoolean(KEY_IS_PRO, isPro)
            .putLong(KEY_VERIFIED_AT, System.currentTimeMillis())
            .apply()
    }

    /**
     * Clears Pro status — called on refund / purchase revocation.
     */
    fun revokePro() {
        prefs.edit()
            .putBoolean(KEY_IS_PRO, false)
            .putLong(KEY_VERIFIED_AT, System.currentTimeMillis())
            .apply()
    }
}
