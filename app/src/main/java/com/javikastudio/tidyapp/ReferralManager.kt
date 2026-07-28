package com.javikastudio.tidyapp

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Calendar

/**
 * ReferralManager — all referral logic lives here, fully on-device.
 *
 * Design decisions:
 *  • Referral code is derived deterministically from the device's unique
 *    installation ID (UUID generated on first run) so it never changes and
 *    requires no server.
 *  • Referral link uses Play Store UTM referrer parameter so the Install
 *    Referrer API on the referred device can read the code at first launch.
 *  • Cross-device attribution is handled by the referred device storing the
 *    ref code, granting itself 14 bonus Pro days, and surfacing a
 *    "thank your referrer" confirmation code the referrer can redeem locally.
 *  • Rate limit: install reward capped at 3 per calendar month to prevent abuse.
 *  • All data stored in PREFS_FILE under REFERRAL_* keys (see BridgeKeys).
 */
object ReferralManager {

    // CRIT-1 FIX: single lock guards every read-modify-write on SharedPreferences.
    // ReferralManager is a Kotlin object (singleton). Without this lock, concurrent
    // callers — e.g. a JS double-tap on "Claim" and a SmartNotificationWorker run —
    // can both read the same counter value, both pass cap checks, and both write an
    // inflated result. SharedPreferences.apply() is async so the last writer wins
    // for the value but both callers already returned "success".
    private val lock = Any()

    private const val PACKAGE_ID = "com.javikastudio.tidyapp"
    private const val BASE_LINK   = "https://play.google.com/store/apps/details"

    // Install reward limit per calendar month
    private const val MAX_INSTALLS_PER_MONTH = 3

    // Pro days granted per event
    private const val DAYS_INSTALL   = 3
    private const val DAYS_MONTHLY   = 31
    private const val DAYS_ANNUAL    = 62
    private const val DAYS_LIFETIME  = 93

    // HIGH-3: rate-limit constants for redeemReferralCode()
    private const val MAX_REDEEM_FAILS  = 5
    private const val REDEEM_LOCKOUT_MS = 60_000L

    // ── Referral code generation ──────────────────────────────────────────────

    /**
     * Returns the referrer's own 8-char alphanumeric code, creating it on first call.
     * Derived from a stable per-installation UUID — deterministic, never changes.
     */
    fun getMyReferralCode(prefs: SharedPreferences): String {
        val stored = prefs.getString(REFERRAL_MY_CODE, null)
        if (!stored.isNullOrBlank()) return stored

        // Generate a stable install UUID if missing
        val installId = prefs.getString(REFERRAL_INSTALL_ID, null)
            ?: java.util.UUID.randomUUID().toString().also { uuid ->
                prefs.edit().putString(REFERRAL_INSTALL_ID, uuid).apply()
            }

        val code = sha256hex(installId).take(8).uppercase()
        prefs.edit().putString(REFERRAL_MY_CODE, code).apply()
        return code
    }

    fun getReferralLink(prefs: SharedPreferences): String {
        val code = getMyReferralCode(prefs)
        return "$BASE_LINK?id=$PACKAGE_ID&referrer=aurelo_ref_$code"
    }

    // ── Install referrer check (called once at first launch) ──────────────────

    /**
     * Called by MainActivity on very first launch ONLY (when isOnboardingDone() == false).
     * Reads the Play Install Referrer parameter and, if it contains a valid ref code,
     * grants 14 extra Pro trial days to THIS device (the referred user).
     *
     * Also performs the billing history sanity check: if the user has any prior
     * billing history for this package we skip the bonus (prevents reinstall abuse).
     *
     * Stores the incoming ref code so we can build a "thank your referrer" code flow.
     */
    fun checkInstallReferrerAndGrantBonus(context: Context, prefs: SharedPreferences) {
        if (prefs.getBoolean(REFERRAL_REFERRER_CHECKED, false)) return
        prefs.edit().putBoolean(REFERRAL_REFERRER_CHECKED, true).apply()

        // Billing history check: if prefs already hold a historic isPro token we abort.
        // (A full BillingClient query would be better but requires async; this guard
        //  handles the most common reinstall-abuse scenario synchronously.)
        if (prefs.getBoolean(IS_PRO_USER, false)) return

        try {
            val client = com.android.installreferrer.api.InstallReferrerClient.newBuilder(context).build()
            client.startConnection(object : com.android.installreferrer.api.InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(responseCode: Int) {
                    if (responseCode == com.android.installreferrer.api.InstallReferrerClient.InstallReferrerResponse.OK) {
                        val referrerUrl = client.installReferrer.installReferrer ?: ""
                        client.endConnection()
                        processReferrerString(context, prefs, referrerUrl)
                    } else {
                        client.endConnection()
                    }
                }
                override fun onInstallReferrerServiceDisconnected() {}
            })
        } catch (_: Exception) {
            // installreferrer library unavailable — skip bonus gracefully
        }
    }

    private fun processReferrerString(context: Context, prefs: SharedPreferences, referrerUrl: String) {
        // Extract aurelo_ref_XXXXXXXX from the referrer string
        val match = Regex("aurelo_ref_([A-Z0-9]{8})").find(referrerUrl) ?: return
        val incomingCode = match.groupValues[1]

        // BUG-L1 FIX: always call getMyReferralCode() so REFERRAL_MY_CODE is
        // initialised before the comparison. Previously, if the referral panel had
        // never been opened (REFERRAL_MY_CODE == null), myCode was null and the
        // equality check always returned false, allowing a self-referral on
        // reinstall before the code was first generated.
        val myCode = getMyReferralCode(prefs)
        if (isSelfReferral(incomingCode, myCode)) return

        val now = System.currentTimeMillis()
        // BUG-REF-2 FIX: compute the 14-day extension expiry immediately so
        // isExtensionActive() returns true right away. Previously only the metadata
        // flags (REFERRAL_BONUS_GRANTED, REFERRAL_BONUS_DAYS) were written but
        // nothing ever read them to actually grant Pro access — the "21 days free"
        // UI claim was entirely aspirational. Now we write REFERRAL_EXTENSION_EXPIRY_MS
        // using the same mechanism as activateExtensionOnLapse() so the extension
        // path is consistent regardless of how Pro was first activated.
        val bonusDays = 14
        val expiryMs = now + bonusDays.toLong() * 86_400_000L

        // Store the incoming code, bonus metadata, and the live extension expiry
        prefs.edit()
            .putString(REFERRAL_INCOMING_CODE, incomingCode)
            .putBoolean(REFERRAL_BONUS_GRANTED, true)
            .putInt(REFERRAL_BONUS_DAYS, bonusDays) // 7 existing trial + 14 bonus = 21 days total
            .putLong(REFERRAL_INSTALL_TS, now)
            // BUG-REF-2 FIX: write the extension expiry so isExtensionActive() can gate Pro.
            .putLong(REFERRAL_EXTENSION_EXPIRY_MS, expiryMs)
            // IS_PRO_USER is omitted here: EntitlementRepository.setProStatus(true) below
            // writes it to tidyapp_v6 as the single authoritative write point.
            .putInt(REFERRAL_PENDING_EXTENSION_DAYS, bonusDays)
            .apply()

        // BUG-REF-2 FIX: grant Pro in EntitlementRepository so BillingBridge.isProUser()
        // and the 72-h grace-period guard reflect the active extension state.
        // This also stamps lastProConfirmedMs so the grace window stays current.
        try {
            com.javikastudio.tidyapp.billing.EntitlementRepository(context).setProStatus(true)
        } catch (_: Exception) {
            android.util.Log.w("AureloReferral",
                "Could not update EntitlementRepository for referral bonus")
        }

        // BUG-REF-2 FIX: schedule the expiry worker so Pro is automatically revoked
        // when the 14-day extension window closes, even if the user never reopens the app.
        ReferralExtensionWorker.scheduleExpiry(context)

        // BUG-01 FIX: generate an install confirmation code that the referred user
        // can share with their referrer. The referrer enters it to trigger
        // recordFriendInstall(), completing the reward mechanism.
        //
        // BUG-REF-7 FIX: embed a 2-char verifier (sha256 of the referrer's code)
        // as the first two characters of the confirmation code. This lets the
        // referrer's device reject any random 8-char string that wasn't actually
        // generated from their link, closing the "any code gives 3 days" exploit.
        // Format: verifier(2) + sha256(referrerCode+installId+"install").take(6)
        val installId = prefs.getString(REFERRAL_INSTALL_ID, null) ?: java.util.UUID.randomUUID().toString()
        val verifierPrefix = sha256hex(incomingCode).take(2).uppercase()
        val confirmCode = verifierPrefix + sha256hex("$incomingCode-$installId-install").take(6).uppercase()
        prefs.edit().putString(REFERRAL_CONFIRM_CODE, confirmCode).apply()
    }

    /**
     * BUG-01 FIX: returns confirmation codes for the referred device to surface.
     * {installCode, convCode?, plan?, hasInstallCode}
     */
    fun getConfirmationCodes(prefs: SharedPreferences): JSONObject {
        val installCode = prefs.getString(REFERRAL_CONFIRM_CODE, null)
        val convCode    = prefs.getString(REFERRAL_CONV_CONFIRM_CODE, null)
        val plan        = prefs.getString(REFERRAL_CONV_CONFIRM_PLAN, null)
        return JSONObject().apply {
            put("hasInstallCode", !installCode.isNullOrBlank())
            if (!installCode.isNullOrBlank()) put("installCode", installCode)
            if (!convCode.isNullOrBlank())    put("convCode",    convCode)
            if (!plan.isNullOrBlank())        put("plan",        plan)
        }
    }

    /**
     * BUG-01 FIX: called on the referrer's device when they enter a confirmation code.
     * Auto-detects code type:
     *   8-char alphanumeric  → install code  → recordFriendInstall(code)
     *   9-char, first = M/A/L → conversion code → recordFriendConversion(plan, code)
     * Returns JSON {daysEarned, type} or {error}.
     */
    fun redeemReferralCode(
        prefs: SharedPreferences,
        code: String,
        securePrefs: SharedPreferences? = null
    ): JSONObject {
        // HIGH-3 FIX: rate-limit brute-force attempts.
        // 5 consecutive failures trigger a 60-second lockout.
        val now = System.currentTimeMillis()
        val lockUntil = prefs.getLong(REF_REDEEM_LOCK_MS, 0L)
        if (lockUntil > now) return JSONObject().apply { put("error", "rate_limited") }

        val cleaned = code.trim().uppercase()

        // BUG-REF-6 FIX: prevent self-redemption.
        val ownInstallCode = prefs.getString(REFERRAL_CONFIRM_CODE, null)?.trim()?.uppercase()
        val ownConvCode    = prefs.getString(REFERRAL_CONV_CONFIRM_CODE, null)?.trim()?.uppercase()
        if ((!ownInstallCode.isNullOrBlank() && cleaned == ownInstallCode) ||
            (!ownConvCode.isNullOrBlank()    && cleaned == ownConvCode)) {
            recordRedeemFailure(prefs, now)
            return JSONObject().apply { put("error", "invalid_code") }
        }

        // BUG-REF-7 FIX: verifier prefix check
        val myCode = getMyReferralCode(prefs)

        val result = when {
            cleaned.length == 8 && cleaned.all { it.isLetterOrDigit() } -> {
                val expectedVerifier = sha256hex(myCode).take(2).uppercase()
                if (!cleaned.startsWith(expectedVerifier)) {
                    recordRedeemFailure(prefs, now)
                    return JSONObject().apply { put("error", "invalid_code") }
                }
                val days = recordFriendInstall(prefs, cleaned, securePrefs)
                JSONObject().apply { put("daysEarned", days); put("type", "install") }
            }
            cleaned.length == 9 && cleaned[0] in listOf('M', 'A', 'L') ->
                cleaned.drop(1).let { rest ->
                    if (rest.all { it.isLetterOrDigit() }) {
                        val plan = when (cleaned[0]) { 'A' -> "annual"; 'L' -> "lifetime"; else -> "monthly" }
                        val expectedConvVerifier = sha256hex("$myCode-$plan").take(2).uppercase()
                        if (rest.take(2) != expectedConvVerifier) {
                            recordRedeemFailure(prefs, now)
                            return JSONObject().apply { put("error", "invalid_code") }
                        }
                        val days = recordFriendConversion(prefs, plan, cleaned, securePrefs)
                        JSONObject().apply { put("daysEarned", days); put("type", "conversion"); put("plan", plan) }
                    } else JSONObject().apply { put("error", "invalid_code") }
                }
            else -> JSONObject().apply { put("error", "invalid_code") }
        }

        // Reset fail counter on any non-error result; record failure otherwise
        if (result.has("error")) recordRedeemFailure(prefs, now)
        else prefs.edit().putInt(REF_REDEEM_FAIL_COUNT, 0).putLong(REF_REDEEM_LOCK_MS, 0L).apply()

        return result
    }

    /** HIGH-3: increments fail count and sets lockout if threshold reached. */
    private fun recordRedeemFailure(prefs: SharedPreferences, now: Long) {
        val fails = prefs.getInt(REF_REDEEM_FAIL_COUNT, 0) + 1
        val editor = prefs.edit().putInt(REF_REDEEM_FAIL_COUNT, fails)
        if (fails >= MAX_REDEEM_FAILS) editor.putLong(REF_REDEEM_LOCK_MS, now + REDEEM_LOCKOUT_MS)
        editor.apply()
    }

    // ── Referred-user bonus query ──────────────────────────────────────────────

    fun getReferralBonusDays(prefs: SharedPreferences): Int {
        if (!prefs.getBoolean(REFERRAL_BONUS_GRANTED, false)) return 0
        return prefs.getInt(REFERRAL_BONUS_DAYS, 0)
    }

    fun wasReferred(prefs: SharedPreferences): Boolean =
        !prefs.getString(REFERRAL_INCOMING_CODE, null).isNullOrBlank()

    // ── Referrer-side: track shares & record reward events ────────────────────

    /**
     * Called whenever the referrer copies or shares their link.
     * Increments share count, used for analytics display.
     */
    fun recordShareAttempt(prefs: SharedPreferences) {
        val current = prefs.getInt(REFERRAL_SHARE_COUNT, 0)
        prefs.edit().putInt(REFERRAL_SHARE_COUNT, current + 1).apply()
    }

    /**
     * Records that a referred friend confirmed installation.
     * Rate-limited to MAX_INSTALLS_PER_MONTH per calendar month.
     *
     * @param friendCode  The referring friend's unique code (8-char). Used to deduplicate
     *                    reinstalls — the same code is never credited more than once.
     *                    Pass null only in legacy/fallback paths where the code is unavailable.
     *
     * Returns the days earned (0 if rate-limited or already credited for this friend).
     */
    /**
     * @param securePrefs  EncryptedSharedPreferences used for dedup code storage
     *                     (HIGH-4 FIX). Pass null only in legacy/test paths — dedup
     *                     will fall back to plain prefs, which is less secure but safe.
     */
    fun recordFriendInstall(
        prefs: SharedPreferences,
        friendCode: String? = null,
        securePrefs: SharedPreferences? = null
    ): Int = synchronized(lock) { // CRIT-1 FIX: guard the full check-then-act sequence
        // ── Dedup: skip if this friend code was already credited ──────────────
        if (!friendCode.isNullOrBlank()) {
            val credited = getCreditedFriendCodes(prefs, securePrefs)
            if (credited.contains(friendCode)) return@synchronized 0
        }

        if (!canGrantInstallReward(prefs)) return@synchronized 0

        val now = Calendar.getInstance()
        // BUG-11 FIX: use Calendar.MONTH + 1 for human-readable keys (1=January, 12=December).
        val monthKey = "${now.get(Calendar.YEAR)}-${now.get(Calendar.MONTH) + 1}"
        val currentMonthCount = prefs.getInt(REFERRAL_INSTALLS_THIS_MONTH, 0)
        val storedMonthKey = prefs.getString(REFERRAL_INSTALLS_MONTH_KEY, "") ?: ""

        val newCount = if (storedMonthKey == monthKey) currentMonthCount + 1 else 1
        if (newCount > MAX_INSTALLS_PER_MONTH) return@synchronized 0

        val totalInstalls = prefs.getInt(REFERRAL_TOTAL_INSTALLS, 0) + 1
        val totalDays     = prefs.getInt(REFERRAL_TOTAL_DAYS_EARNED, 0) + DAYS_INSTALL

        val editor = prefs.edit()
            .putInt(REFERRAL_INSTALLS_THIS_MONTH, newCount)
            .putString(REFERRAL_INSTALLS_MONTH_KEY, monthKey)
            .putInt(REFERRAL_TOTAL_INSTALLS, totalInstalls)
            .putInt(REFERRAL_TOTAL_DAYS_EARNED, totalDays)
            .putLong(REFERRAL_LAST_INSTALL_TS, System.currentTimeMillis())
            // BUG-H1 FIX: reset the nudge-sent flag so a new nudge window
            // opens for each fresh friend install. Previously this was set once
            // and never cleared, meaning only the very first unconverted friend
            // ever triggered the "14-day" nudge notification.
            .putBoolean(REFERRAL_PENDING_NOTIF_SENT, false)

        // Persist the credited friend code so reinstalls are ignored
        // HIGH-4 FIX: write dedup codes to securePrefs (encrypted) when available.
        // On a rooted device, deleting plain prefs resets dedup and allows unlimited
        // re-redemption of the same confirmation codes.
        if (!friendCode.isNullOrBlank()) {
            val updated = getCreditedFriendCodes(prefs, securePrefs) + friendCode
            // ReferralManager.recordFriendInstall() — add to the editor block:
            val existingOldest = prefs.getLong(REFERRAL_OLDEST_INSTALL_TS, 0L)
            if (existingOldest == 0L) {
                editor.putLong(REFERRAL_OLDEST_INSTALL_TS, System.currentTimeMillis())
            }
            val codesStr = updated.joinToString(",")
            // Write to securePrefs when available; always mirror to plain prefs as fallback
            securePrefs?.edit()?.putString(REFERRAL_CREDITED_FRIEND_CODES, codesStr)?.apply()
            editor.putString(REFERRAL_CREDITED_FRIEND_CODES, codesStr)
        }

        editor.apply()
        return DAYS_INSTALL
    } // end synchronized

    /**
     * HIGH-4 FIX: reads dedup codes from securePrefs when available, falling back to
     * plain prefs. This handles migration: existing codes in plain prefs are still
     * honoured while new codes are written to the encrypted store.
     */
    private fun getCreditedFriendCodes(
        prefs: SharedPreferences,
        securePrefs: SharedPreferences? = null
    ): Set<String> {
        // Prefer encrypted store; union with plain prefs to cover migrated data
        val secure = securePrefs?.getString(REFERRAL_CREDITED_FRIEND_CODES, "") ?: ""
        val plain  = prefs.getString(REFERRAL_CREDITED_FRIEND_CODES, "") ?: ""
        val raw = when {
            secure.isNotBlank() -> secure
            plain.isNotBlank()  -> plain
            else                -> return emptySet()
        }
        return raw.split(",").filter { it.isNotBlank() }.toSet()
    }

    /**
     * Records that a referred friend converted to a paid plan.
     * plan: "monthly" | "annual" | "lifetime"
     *
     * BUG-02 FIX: Added per-friend deduplication via REFERRAL_CREDITED_CONVERSION_CODES.
     * Previously the same friend converting multiple times (subscribe → cancel → re-subscribe)
     * would credit the referrer unlimited Pro days on each cycle.
     *
     * @param friendCode  The 8-char code of the converting friend. Pass null only in
     *                    legacy/fallback paths where the code is unavailable.
     * Returns additional Pro days earned, 0 if already credited or invalid plan.
     */
    fun recordFriendConversion(
        prefs: SharedPreferences,
        plan: String,
        friendCode: String? = null,
        securePrefs: SharedPreferences? = null
    ): Int = synchronized(lock) { // CRIT-1 FIX
        val days = when (plan.lowercase()) {
            "monthly"  -> DAYS_MONTHLY
            "annual"   -> DAYS_ANNUAL
            "lifetime" -> DAYS_LIFETIME
            else       -> 0
        }
        if (days == 0) return@synchronized 0

        // BUG-02 FIX: dedup by friend code — same friend only credited once for a conversion
        if (!friendCode.isNullOrBlank()) {
            val creditedConversions = getCreditedConversionCodes(prefs, securePrefs)
            if (creditedConversions.contains(friendCode)) return@synchronized 0
        }

        // Track pending conversion notification
        val pending = prefs.getInt(REFERRAL_PENDING_CONVERSIONS, 0)
        val totalConversions = prefs.getInt(REFERRAL_TOTAL_CONVERSIONS, 0) + 1
        val totalDays = prefs.getInt(REFERRAL_TOTAL_DAYS_EARNED, 0) + days
        // BUG-M2 FIX: accumulate days across multiple pending conversions.
        val pendingConvDays = prefs.getInt(REFERRAL_PENDING_CONVERSION_DAYS, 0) + days

        val editor = prefs.edit()
            .putInt(REFERRAL_TOTAL_CONVERSIONS, totalConversions)
            .putInt(REFERRAL_TOTAL_DAYS_EARNED, totalDays)
            .putInt(REFERRAL_PENDING_CONVERSIONS, pending + 1)
            .putInt(REFERRAL_PENDING_CONVERSION_DAYS, pendingConvDays)
            .putString(REFERRAL_LAST_CONVERSION_PLAN, plan)
            .putLong(REFERRAL_LAST_CONVERSION_TS, System.currentTimeMillis())

        // HIGH-4 FIX: write dedup conversion codes to securePrefs when available
        if (!friendCode.isNullOrBlank()) {
            val updated = getCreditedConversionCodes(prefs, securePrefs) + friendCode
            val codesStr = updated.joinToString(",")
            securePrefs?.edit()?.putString(REFERRAL_CREDITED_CONVERSION_CODES, codesStr)?.apply()
            editor.putString(REFERRAL_CREDITED_CONVERSION_CODES, codesStr)
        }

        editor.apply()
        return@synchronized days
    } // end synchronized

    /** HIGH-4 FIX: reads conversion dedup codes from securePrefs with plain-prefs fallback. */
    private fun getCreditedConversionCodes(
        prefs: SharedPreferences,
        securePrefs: SharedPreferences? = null
    ): Set<String> {
        val secure = securePrefs?.getString(REFERRAL_CREDITED_CONVERSION_CODES, "") ?: ""
        val plain  = prefs.getString(REFERRAL_CREDITED_CONVERSION_CODES, "") ?: ""
        val raw = when {
            secure.isNotBlank() -> secure
            plain.isNotBlank()  -> plain
            else                -> return emptySet()
        }
        return raw.split(",").filter { it.isNotBlank() }.toSet()
    }

    /**
     * Called when the referred user converts to paid.
     * If this device was referred, record the conversion so the referrer
     * gets notified and can claim their credit.
     */
    fun onThisUserConverted(prefs: SharedPreferences, plan: String) {
        if (!wasReferred(prefs)) return

        // HIGH-3 FIX: only generate a new conv code if this is a new plan (upgrade path)
        // or if no conv code has been generated yet. Avoids invalidating a code the
        // referred user already shared with their referrer.
        val existingPlan = prefs.getString(REFERRAL_THIS_USER_PLAN, null)
        val existingCode = prefs.getString(REFERRAL_CONV_CONFIRM_CODE, null)
        if (!existingCode.isNullOrBlank() && existingPlan == plan) return   // same plan, code unchanged

        prefs.edit()
            .putBoolean(REFERRAL_THIS_USER_CONVERTED, true)
            .putString(REFERRAL_THIS_USER_PLAN, plan)
            .putLong(REFERRAL_THIS_USER_CONVERSION_TS, System.currentTimeMillis())
            .apply()

        val incomingCode = prefs.getString(REFERRAL_INCOMING_CODE, "") ?: ""
        val installId    = prefs.getString(REFERRAL_INSTALL_ID, "") ?: ""
        val planPrefix   = when (plan.lowercase()) { "annual" -> "A"; "lifetime" -> "L"; else -> "M" }
        // BUG-REF-7 FIX: embed a 2-char plan+referrer verifier at positions 1–2
        // (after the plan prefix) so the referrer can reject random conversion codes.
        // Format: planPrefix(1) + sha256(referrerCode+plan).take(2) + sha256(...).take(6)
        val verifier2    = sha256hex("$incomingCode-$plan").take(2).uppercase()
        val hash6        = sha256hex("$incomingCode-$installId-$plan-conv").take(6).uppercase()
        val convCode     = "$planPrefix$verifier2$hash6"
        prefs.edit()
            .putString(REFERRAL_CONV_CONFIRM_CODE, convCode)
            .putString(REFERRAL_CONV_CONFIRM_PLAN, plan)
            .apply()
    }

    // ── Stats ──────────────────────────────────────────────────────────────────

    fun getStats(prefs: SharedPreferences): JSONObject {
        val installTs = prefs.getLong(REFERRAL_INSTALL_TS, 0L)
        val now = System.currentTimeMillis()
        // BUG-L3 FIX: renamed from "daysSinceInstall" — this value reflects when THIS
        // device was referred (set by processReferrerString), not when the most recent
        // friend installed. On a referrer's device the value is -1 (they were not referred).
        val daysSinceWasReferred = if (installTs > 0) ((now - installTs) / 86_400_000L).toInt() else -1

        val totalInstalls    = prefs.getInt(REFERRAL_TOTAL_INSTALLS, 0)
        val totalConversions = prefs.getInt(REFERRAL_TOTAL_CONVERSIONS, 0)
        // BUG-M1 FIX: subtract lapsed friends from the pending count.
        // Previously (totalInstalls - totalConversions) remained inflated forever
        // for friends who installed but never converted, showing a misleading
        // "⏳ N friends trying Pro" banner indefinitely.
        val totalLapsed = prefs.getInt(REFERRAL_TOTAL_LAPSED, 0)
        val pending     = (totalInstalls - totalConversions - totalLapsed).coerceAtLeast(0)

        return JSONObject().apply {
            put("shareCount",           prefs.getInt(REFERRAL_SHARE_COUNT, 0))
            put("totalInstalls",        totalInstalls)
            put("totalConversions",     totalConversions)
            put("totalDaysEarned",      prefs.getInt(REFERRAL_TOTAL_DAYS_EARNED, 0))
            put("pending",              pending)
            put("bonusDays",            getReferralBonusDays(prefs))
            put("wasReferred",          wasReferred(prefs))
            put("daysSinceWasReferred", daysSinceWasReferred)
            // Extension fields
            put("pendingExtDays",       getPendingExtensionDays(prefs))
            put("extensionDaysLeft",    getExtensionDaysRemaining(prefs))
            put("extensionActive",      isExtensionActive(prefs))
            put("extensionExpiryMs",    prefs.getLong(REFERRAL_EXTENSION_EXPIRY_MS, 0L))
        }
    }

    // ── Pro Extension (monthly/annual only) ───────────────────────────────────

    /**
     * BUG-M1 FIX: marks a referred friend as lapsed (installed but did not convert
     * within the expected window, typically 30 days). Increments REFERRAL_TOTAL_LAPSED
     * so getStats() can subtract lapsed friends from the "pending" counter, preventing
     * the "⏳ N friends trying Pro" banner from inflating indefinitely.
     *
     * Call this from the nudge notification worker (or a scheduled check) after
     * REFERRAL_LAST_INSTALL_TS is 30+ days old and totalInstalls > totalConversions.
     */
    fun recordFriendLapsed(prefs: SharedPreferences) {
        synchronized(lock) { // CRIT-1 FIX
            val lapsed = prefs.getInt(REFERRAL_TOTAL_LAPSED, 0) + 1
            prefs.edit().putInt(REFERRAL_TOTAL_LAPSED, lapsed).apply()
        }
    }

    // ── Pro Extension (monthly/annual only) ───────────────────────────────────
    /**
     * Called when referral days are earned AND the user is on monthly/annual Pro.
     * Banks the days so they activate automatically when the subscription lapses.
     * Lifetime users are excluded — their earned days are tracked but not banked here.
     *
     * @param plan  Current plan of the referrer: "monthly" | "annual" | "lifetime"
     * @param days  Days just earned (will be added to any existing banked days)
     */
    fun bankExtensionDays(prefs: SharedPreferences, plan: String, days: Int) {
        if (plan.lowercase() == "lifetime") return   // Lifetime handles rewards differently
        if (days <= 0) return
        synchronized(lock) { // CRIT-1 FIX
            val existing   = prefs.getInt(REFERRAL_PENDING_EXTENSION_DAYS, 0)
            // CRIT-2 FIX: advance the permanent watermark so BillingBridge.recordActivatedPlan()
            // can compute the true unbanked delta rather than re-banking consumed days.
            val everBanked = prefs.getInt(REFERRAL_TOTAL_DAYS_EVER_BANKED, 0)
            prefs.edit()
                .putInt(REFERRAL_PENDING_EXTENSION_DAYS, existing + days)
                .putInt(REFERRAL_TOTAL_DAYS_EVER_BANKED, everBanked + days)
                .putString(REFERRAL_EXTENSION_SOURCE_PLAN, plan)
                .apply()
        }
    }

    /**
     * Called by BillingBridge when onProStatusChanged(false) fires — meaning the
     * subscription has lapsed. If the user has banked referral extension days, we
     * activate them by setting REFERRAL_EXTENSION_EXPIRY_MS = now + bankedDays.
     *
     * Returns the number of extension days activated (0 if none banked).
     */
    fun activateExtensionOnLapse(prefs: SharedPreferences): Int {
        val banked = prefs.getInt(REFERRAL_PENDING_EXTENSION_DAYS, 0)
        if (banked <= 0) return 0

        val expiryMs = System.currentTimeMillis() + banked.toLong() * 86_400_000L
        prefs.edit()
            .putLong(REFERRAL_EXTENSION_EXPIRY_MS, expiryMs)
            .putInt(REFERRAL_PENDING_EXTENSION_DAYS, 0)   // consumed
            .apply()

        return banked
    }

    /**
     * Returns true if a referral Pro extension is currently active.
     * Used by BillingBridge / EntitlementRepository to keep granting Pro
     * after the subscription lapses.
     */
    fun isExtensionActive(prefs: SharedPreferences): Boolean {
        val expiry = prefs.getLong(REFERRAL_EXTENSION_EXPIRY_MS, 0L)
        return expiry > System.currentTimeMillis()
    }

    /**
     * Returns remaining extension days (0 if not active or expired).
     */
    fun getExtensionDaysRemaining(prefs: SharedPreferences): Int {
        val expiry = prefs.getLong(REFERRAL_EXTENSION_EXPIRY_MS, 0L)
        val now = System.currentTimeMillis()
        if (expiry <= now) return 0
        return ((expiry - now) / 86_400_000L).toInt().coerceAtLeast(1)
    }

    /**
     * How many extension days have been banked (not yet activated).
     * Shown in the referral screen so the user knows what's waiting.
     */
    fun getPendingExtensionDays(prefs: SharedPreferences): Int =
        prefs.getInt(REFERRAL_PENDING_EXTENSION_DAYS, 0)

    // ── Notification helpers ──────────────────────────────────────────────────

    /** Returns notification data if a pending conversion event needs to be surfaced. */
    fun consumePendingConversionNotif(prefs: SharedPreferences): JSONObject? {
        val pending = prefs.getInt(REFERRAL_PENDING_CONVERSIONS, 0)
        if (pending <= 0) return null

        // BUG-M2 FIX: use the accumulated REFERRAL_PENDING_CONVERSION_DAYS value which
        // sums days across all pending conversions since the last notification poll.
        // Previously only REFERRAL_LAST_CONVERSION_PLAN was used, so if two friends
        // converted between polls (e.g. one monthly, one annual), only one plan's
        // worth of days was returned and the other was silently dropped.
        val pendingDays = prefs.getInt(REFERRAL_PENDING_CONVERSION_DAYS, 0)
        val plan = prefs.getString(REFERRAL_LAST_CONVERSION_PLAN, "") ?: ""

        // Fallback for installs that pre-date REFERRAL_PENDING_CONVERSION_DAYS.
        // BUG-M3 FIX: unknown/empty plan now returns 0 instead of silently
        // granting DAYS_MONTHLY (31 days) for a corrupt or missing plan key.
        val days = if (pendingDays > 0) pendingDays else when (plan.lowercase()) {
            "monthly"  -> DAYS_MONTHLY
            "annual"   -> DAYS_ANNUAL
            "lifetime" -> DAYS_LIFETIME
            else       -> 0
        }

        if (days == 0) return null

        prefs.edit()
            .putInt(REFERRAL_PENDING_CONVERSIONS, 0)
            .putInt(REFERRAL_PENDING_CONVERSION_DAYS, 0)
            .apply()

        return JSONObject().apply {
            put("plan", plan.ifBlank { "unknown" })
            put("days", days)
            put("count", pending)
        }
    }

    /**
     * Returns true if we should fire a "your friend has been trying Pro for 14 days" nudge.
     * Fires once when a referred install is 13–15 days old.
     *
     * BUG-08 FIX: previously used a hardcoded raw string key not in BridgeKeys.kt.
     */
    fun shouldFirePendingReferralNudge(prefs: SharedPreferences): Boolean {
        if (prefs.getBoolean(REFERRAL_PENDING_NOTIF_SENT, false)) return false
        val totalInstalls    = prefs.getInt(REFERRAL_TOTAL_INSTALLS, 0)
        val totalConversions = prefs.getInt(REFERRAL_TOTAL_CONVERSIONS, 0)
        if (totalInstalls <= totalConversions) return false // all converted already
        val lastInstallTs = prefs.getLong(REFERRAL_LAST_INSTALL_TS, 0L)
        if (lastInstallTs == 0L) return false
        val daysSince = ((System.currentTimeMillis() - lastInstallTs) / 86_400_000L).toInt()
        if (daysSince in 13..15) {
            prefs.edit().putBoolean(REFERRAL_PENDING_NOTIF_SENT, true).apply()
            return true
        }
        return false
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Pure self-referral guard used by processReferrerString() (ST-031/SEC-05).
     * Extracted for unit testing (Phase 2 test-quality fix) — processReferrerString()
     * itself requires a real Context to construct EntitlementRepository/WorkManager,
     * but the guard predicate itself is trivial and needs neither.
     */
    internal fun isSelfReferral(incomingCode: String, myCode: String): Boolean =
        incomingCode == myCode

    private fun canGrantInstallReward(prefs: SharedPreferences): Boolean {
        val now = Calendar.getInstance()
        // BUG-11 FIX: Calendar.MONTH is 0-indexed (January=0, December=11).
        // Adding +1 makes stored keys human-readable (e.g. "2025-12" for December).
        val monthKey = "${now.get(Calendar.YEAR)}-${now.get(Calendar.MONTH) + 1}"
        val storedMonthKey = prefs.getString(REFERRAL_INSTALLS_MONTH_KEY, "") ?: ""
        val count = if (storedMonthKey == monthKey) prefs.getInt(REFERRAL_INSTALLS_THIS_MONTH, 0) else 0
        return count < MAX_INSTALLS_PER_MONTH
    }

    /**
     * BUG-06 FIX: seeds REFERRAL_INSTALL_ID from ANDROID_ID so the referral code
     * is stable across reinstalls. Previously a random UUID was generated each time
     * SharedPreferences were wiped on uninstall, producing a new code that made the
     * self-referral check (incomingCode == myCode) always pass after reinstall.
     * Call once at startup (from ReferralBridge init) before getMyReferralCode.
     */
    fun seedInstallId(context: android.content.Context, prefs: SharedPreferences) {
        if (!prefs.getString(REFERRAL_INSTALL_ID, null).isNullOrBlank()) return
        val stableId = try {
            android.provider.Settings.Secure.getString(
                context.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID
            )?.takeIf { it.isNotBlank() && it != "9774d56d682e549c" } // filter known bad ANDROID_ID
                ?: java.util.UUID.randomUUID().toString()
        } catch (_: Exception) {
            java.util.UUID.randomUUID().toString()
        }
        prefs.edit().putString(REFERRAL_INSTALL_ID, stableId).apply()
    }

    private fun sha256hex(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(input.toByteArray()).joinToString("") { "%02X".format(it) }
    }
}