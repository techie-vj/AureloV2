package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

/**
 * ReferralManager Tests  |  Feature Ref §13.11  |  Test Report TEST-03
 * Suite test cases: ST-015, ST-016, ST-025, ST-026, ST-031, ST-032, ST-033, ST-034
 * Critical TC:      TC-01, TC-02, TC-10, TC-11
 *
 * REWRITE NOTE (Phase 2 test-quality fix):
 * Previously every test here called locally re-implemented mirror functions with
 * signatures and semantics that did NOT match the real ReferralManager — e.g. the
 * mirror's redeemReferralCode() checked "incomingCode == myCode" directly, but the
 * real function actually checks against REFERRAL_CONFIRM_CODE/REFERRAL_CONV_CONFIRM_CODE
 * (a different guard), and the mirror never modelled recordFriendConversion() at all
 * (monthly/annual/lifetime reward tiers had zero real coverage).
 *
 * All tests below now call the real com.javikastudio.tidyapp.ReferralManager object
 * directly, using FakeSharedPreferences (SharedPreferences is a plain interface —
 * no mocking library needed). One tiny guard (isSelfReferral) was extracted from the
 * Context-requiring processReferrerString() so ST-031 can test it directly too.
 */

private fun sha256hex(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    return digest.digest(input.toByteArray()).joinToString("") { "%02X".format(it) }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests — Critical regression coverage for referral system
// ─────────────────────────────────────────────────────────────────────────────
class ReferralManager_P1_Tests {

    // ── Referral code generation & stability (ST-015, ST-025) — real getMyReferralCode ──

    @Test
    fun `ST015 referral code deterministic — same stored install ID yields same code across calls`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_INSTALL_ID to "device-uuid-abc123"))
        val code1 = ReferralManager.getMyReferralCode(prefs)
        val code2 = ReferralManager.getMyReferralCode(prefs)
        assertEquals("Same install ID must produce same code", code1, code2)
    }

    @Test
    fun `ST025 referral code stable across multiple invocations — not regenerated each visit`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_INSTALL_ID to "install-uuid-xyz"))
        val codes = (1..5).map { ReferralManager.getMyReferralCode(prefs) }
        assertTrue("Code must be identical on every call", codes.all { it == codes[0] })
    }

    @Test
    fun `ST015 different install IDs produce different referral codes`() {
        val codeA = ReferralManager.getMyReferralCode(FakeSharedPreferences(mapOf(REFERRAL_INSTALL_ID to "device-A")))
        val codeB = ReferralManager.getMyReferralCode(FakeSharedPreferences(mapOf(REFERRAL_INSTALL_ID to "device-B")))
        assertNotEquals("Different install IDs must not collide", codeA, codeB)
    }

    @Test
    fun `referral code is 8 uppercase alphanumeric characters`() {
        val code = ReferralManager.getMyReferralCode(FakeSharedPreferences())
        assertEquals(8, code.length)
        assertEquals(code.uppercase(), code)
        assertTrue(code.all { it.isLetterOrDigit() })
    }

    // ── Self-referral prevention (ST-031, TC-01, SEC-05) — real isSelfReferral guard ──

    @Test
    fun `ST031 TC01 self-referral via reinstall blocked — own code matches own code`() {
        val myCode = ReferralManager.getMyReferralCode(FakeSharedPreferences(mapOf(REFERRAL_INSTALL_ID to "my-device-uuid")))
        assertTrue(ReferralManager.isSelfReferral(myCode, myCode))
    }

    @Test
    fun `TC01 different codes are not flagged as self-referral`() {
        assertFalse(ReferralManager.isSelfReferral("ABCD1234", "WXYZ9876"))
    }

    // ── Monthly rate limit (ST-032, TC-02, FUN-08) — real recordFriendInstall ────────

    @Test
    fun `ST032 TC02 fourth recordFriendInstall in same month returns 0 days`() {
        val prefs = FakeSharedPreferences()
        assertEquals(3, ReferralManager.recordFriendInstall(prefs, "CODE_A"))
        assertEquals(3, ReferralManager.recordFriendInstall(prefs, "CODE_B"))
        assertEquals(3, ReferralManager.recordFriendInstall(prefs, "CODE_C"))
        // 4th — monthly cap reached
        assertEquals(0, ReferralManager.recordFriendInstall(prefs, "CODE_D"))
    }

    // ── Own confirmation code dedup (ST-033, TC-10, BUG-REF-6) — real redeemReferralCode ──

    @Test
    fun `ST033 TC10 redeeming own install confirmation code on same device returns invalid_code`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_CONFIRM_CODE to "OWNCODE1"))
        val result = ReferralManager.redeemReferralCode(prefs, "OWNCODE1")
        assertEquals("invalid_code", result.optString("error", ""))
    }

    @Test
    fun `ST033 redeeming own conversion confirmation code on same device returns invalid_code`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_CONV_CONFIRM_CODE to "M12CODE12"))
        val result = ReferralManager.redeemReferralCode(prefs, "M12CODE12")
        assertEquals("invalid_code", result.optString("error", ""))
    }

    // ── Verifier prefix check (ST-034, TC-11, BUG-REF-7) — real redeemReferralCode ──

    @Test
    fun `ST034 TC11 8-char code without correct verifier prefix returns invalid_code`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_INSTALL_ID to "referrer-device"))
        val myCode = ReferralManager.getMyReferralCode(prefs)
        val wrongPrefix = if (sha256hex(myCode).take(2).uppercase() == "AA") "BB" else "AA"
        val badCode = wrongPrefix + "XXXXXX"
        val result = ReferralManager.redeemReferralCode(prefs, badCode)
        assertEquals("invalid_code", result.optString("error", ""))
    }

    @Test
    fun `BUG-REF-7 8-char code with correct verifier prefix succeeds and grants install days`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_INSTALL_ID to "referrer-device-2"))
        val myCode = ReferralManager.getMyReferralCode(prefs)
        val correctPrefix = sha256hex(myCode).take(2).uppercase()
        val goodCode = correctPrefix + "ABCDEF"
        val result = ReferralManager.redeemReferralCode(prefs, goodCode)
        assertFalse("Correct verifier prefix must not error", result.has("error"))
        assertEquals(3, result.optInt("daysEarned"))
        assertEquals("install", result.optString("type"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests — Referral rewards, tracking, conversions, lapse extension
// ─────────────────────────────────────────────────────────────────────────────
class ReferralManager_P2_Tests {

    // ── Referral reward tracking (ST-016, ST-026) — real recordFriendInstall ────────

    @Test
    fun `ST016 successful referral install grants 3 days`() {
        val days = ReferralManager.recordFriendInstall(FakeSharedPreferences(), "FRIEND_CODE_01")
        assertEquals(3, days)
    }

    @Test
    fun `ST026 referral days accumulate correctly across multiple distinct referrals`() {
        val prefs = FakeSharedPreferences()
        var totalDays = 0
        totalDays += ReferralManager.recordFriendInstall(prefs, "F1")
        totalDays += ReferralManager.recordFriendInstall(prefs, "F2")
        assertEquals(6, totalDays)
    }

    // ── Install code deduplication ────────────────────────────────────────────

    @Test
    fun `duplicate friend code not credited twice for install reward`() {
        val prefs = FakeSharedPreferences()
        val first  = ReferralManager.recordFriendInstall(prefs, "SAME_CODE")
        val second = ReferralManager.recordFriendInstall(prefs, "SAME_CODE")
        assertEquals(3, first)
        assertEquals(0, second)  // dedup fires, not month cap (only 2 calls)
    }

    // ── Conversion rewards — real recordFriendConversion (previously ZERO coverage) ──

    @Test
    fun `conversion reward — monthly plan grants 31 days`() {
        assertEquals(31, ReferralManager.recordFriendConversion(FakeSharedPreferences(), "monthly", "CF1"))
    }

    @Test
    fun `conversion reward — annual plan grants 62 days`() {
        assertEquals(62, ReferralManager.recordFriendConversion(FakeSharedPreferences(), "annual", "CF2"))
    }

    @Test
    fun `conversion reward — lifetime plan grants 93 days`() {
        assertEquals(93, ReferralManager.recordFriendConversion(FakeSharedPreferences(), "lifetime", "CF3"))
    }

    @Test
    fun `conversion reward — unknown plan grants 0 days`() {
        assertEquals(0, ReferralManager.recordFriendConversion(FakeSharedPreferences(), "bogus", "CF4"))
    }

    @Test
    fun `conversion reward — same friend code not credited twice`() {
        val prefs = FakeSharedPreferences()
        val first  = ReferralManager.recordFriendConversion(prefs, "monthly", "SAME_CONV")
        val second = ReferralManager.recordFriendConversion(prefs, "annual", "SAME_CONV")
        assertEquals(31, first)
        assertEquals(0, second) // dedup by friend code, regardless of plan on second call
    }

    // ── Extension on lapse — real activateExtensionOnLapse / bankExtensionDays ────────

    @Test
    fun `activateExtensionOnLapse activates banked days as a live expiry window`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_PENDING_EXTENSION_DAYS to 9))
        val activated = ReferralManager.activateExtensionOnLapse(prefs)
        assertEquals(9, activated)
        assertTrue(ReferralManager.isExtensionActive(prefs))
        assertEquals("Pending days must be consumed on activation", 0, ReferralManager.getPendingExtensionDays(prefs))
    }

    @Test
    fun `activateExtensionOnLapse with zero banked days activates nothing`() {
        val prefs = FakeSharedPreferences()
        assertEquals(0, ReferralManager.activateExtensionOnLapse(prefs))
        assertFalse(ReferralManager.isExtensionActive(prefs))
    }

    @Test
    fun `bankExtensionDays accumulates across multiple banking events`() {
        val prefs = FakeSharedPreferences()
        ReferralManager.bankExtensionDays(prefs, "monthly", 5)
        ReferralManager.bankExtensionDays(prefs, "annual", 3)
        assertEquals(8, ReferralManager.getPendingExtensionDays(prefs))
    }

    @Test
    fun `bankExtensionDays ignores lifetime plan — lifetime rewards tracked differently`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_PENDING_EXTENSION_DAYS to 8))
        ReferralManager.bankExtensionDays(prefs, "lifetime", 10)
        assertEquals("Lifetime banking must be a no-op", 8, ReferralManager.getPendingExtensionDays(prefs))
    }

    // ── Referred-user bonus + wasReferred ─────────────────────────────────────

    @Test
    fun `wasReferred is false for a fresh install with no incoming code`() {
        assertFalse(ReferralManager.wasReferred(FakeSharedPreferences()))
    }

    @Test
    fun `wasReferred is true once an incoming referral code is recorded`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_INCOMING_CODE to "SOMECODE"))
        assertTrue(ReferralManager.wasReferred(prefs))
    }

    @Test
    fun `getReferralBonusDays returns 0 until bonus is granted`() {
        assertEquals(0, ReferralManager.getReferralBonusDays(FakeSharedPreferences()))
    }

    @Test
    fun `getReferralBonusDays returns granted amount once bonus flag is set`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_BONUS_GRANTED to true, REFERRAL_BONUS_DAYS to 14))
        assertEquals(14, ReferralManager.getReferralBonusDays(prefs))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P3 Tests — Boundary conditions and edge values
// ─────────────────────────────────────────────────────────────────────────────
class ReferralManager_P3_Tests {

    @Test
    fun `recordFriendInstall boundary — exactly 3 installs allowed, 4th blocked`() {
        val prefs = FakeSharedPreferences()
        repeat(3) { i -> assertEquals(3, ReferralManager.recordFriendInstall(prefs, "C$i")) }
        assertEquals(0, ReferralManager.recordFriendInstall(prefs, "C_FOURTH"))
    }

    @Test
    fun `recordFriendInstall does not credit a new code once monthly cap reached`() {
        val prefs = FakeSharedPreferences()
        repeat(3) { i -> ReferralManager.recordFriendInstall(prefs, "X$i") }
        val result = ReferralManager.recordFriendInstall(prefs, "NEW_CODE_AFTER_CAP")
        assertEquals(0, result)
    }

    @Test
    fun `getExtensionDaysRemaining is 0 when expiry is in the past`() {
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_EXTENSION_EXPIRY_MS to (System.currentTimeMillis() - 1000)))
        assertEquals(0, ReferralManager.getExtensionDaysRemaining(prefs))
        assertFalse(ReferralManager.isExtensionActive(prefs))
    }

    @Test
    fun `getExtensionDaysRemaining is at least 1 when expiry is a few hours in the future`() {
        val fewHoursMs = 3 * 60 * 60 * 1000L
        val prefs = FakeSharedPreferences(mapOf(REFERRAL_EXTENSION_EXPIRY_MS to (System.currentTimeMillis() + fewHoursMs)))
        assertTrue(ReferralManager.isExtensionActive(prefs))
        assertTrue(ReferralManager.getExtensionDaysRemaining(prefs) >= 1)
    }

    @Test
    fun `redeemReferralCode with code shorter than 8 chars returns invalid_code`() {
        val result = ReferralManager.redeemReferralCode(FakeSharedPreferences(), "AB12")
        assertEquals("invalid_code", result.optString("error", ""))
    }

    @Test
    fun `redeemReferralCode with blank code returns invalid_code`() {
        val result = ReferralManager.redeemReferralCode(FakeSharedPreferences(), "")
        assertEquals("invalid_code", result.optString("error", ""))
    }

    @Test
    fun `isSelfReferral is case-sensitive on raw input — caller is responsible for normalising case`() {
        // ReferralManager.getMyReferralCode() always returns uppercase, so in practice
        // this never surfaces, but the guard itself does a plain equality check.
        assertFalse(ReferralManager.isSelfReferral("abcd1234", "ABCD1234"))
    }
}
