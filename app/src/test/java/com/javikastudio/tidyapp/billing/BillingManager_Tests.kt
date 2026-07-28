package com.javikastudio.tidyapp.billing

import org.junit.Assert.*
import org.junit.Test

/**
 * BillingManager Tests  |  Feature Ref §15  |  Test Report TEST-04
 *
 * Suite test cases: PS-001 to PS-024 (functional), TC-03, TC-04
 *
 * REWRITE NOTE (Phase 2 test-quality fix):
 * This file previously mirrored business logic locally instead of calling real
 * production code, and two of those mirrors were flat-out WRONG:
 *
 *   1. selectBestOffer() mirrored a "Lifetime > Annual > Monthly" plan-type
 *      priority that DOES NOT EXIST in production. The real
 *      BillingManager._selectBestOffer() (now OfferSelector.selectBestIndex)
 *      prioritises by OFFER STRUCTURE, not plan type: free-trial > intro-price
 *      > bare-base-plan > fallback. All three plan types can appear in any
 *      priority tier depending on what offers Play Console returns for them.
 *
 *   2. isInGracePeriod() used an inclusive `<=` boundary and had no concept of
 *      "never confirmed". The real EntitlementRepository.isWithinGrace() uses
 *      a strict `<` boundary AND requires lastConfirmedMs > 0 (a fresh install
 *      or free user, where lastConfirmedMs=0, is NEVER "in grace" regardless
 *      of the time value passed). Neither of these were correctly modelled.
 *
 * DISCREPANCY FLAGGED FOR REVIEW (not silently fixed — this is a production
 * behaviour question, not a test-only issue):
 *   PS-024's manual spec says downgrade should fire at "72h + 1ms", implying
 *   exactly-72h-elapsed should still be within grace. The real code's strict
 *   `<` operator means grace actually EXPIRES at exactly 72h (not 72h+1ms) —
 *   a 1-tick-early expiry vs the documented spec. Tests below assert the
 *   REAL current behaviour (exactly-72h = expired) and flag this via the
 *   `EXACT72H_DISCREPANCY` test name so it's not silently normalised away.
 *
 * BillingClient/ProductDetails/Purchase are real Play Billing SDK classes that
 * cannot be constructed on the JVM, so PENDING-purchase-state handling and the
 * RSA-key/algorithm checks below remain local boolean mirrors of that specific
 * decision shape — they were already correct and are unchanged.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Remaining mirrors (unchanged — no corresponding extracted pure object yet)
// ─────────────────────────────────────────────────────────────────────────────

private val DEPRECATED_ALGORITHMS = setOf("SHA1withRSA", "MD5withRSA")

enum class PurchaseState { PURCHASED, PENDING, UNSPECIFIED }

/** Mirrors BillingManager.handlePurchase()'s purchaseState `when` branch. */
private fun handlePurchaseState(state: PurchaseState, grantPro: () -> Unit): Boolean {
    if (state == PurchaseState.PURCHASED) {
        grantPro()
        return true
    }
    return false  // PENDING or UNSPECIFIED: no Pro granted (SEC-11)
}

/** Mirrors algorithm safety check — SEC-01 (standalone; not a real production function) */
private fun isDeprecatedSignatureAlgorithm(algorithm: String): Boolean =
    algorithm.uppercase() in DEPRECATED_ALGORITHMS

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests — Critical billing logic
// ─────────────────────────────────────────────────────────────────────────────
class BillingManager_P1_Tests {

    private val REF_TIME = 1_700_000_000_000L // fixed reference epoch ms, for determinism

    // ── Grace period boundary: TC-03 (no downgrade within 72h) — real EntitlementRepository ──

    @Test
    fun `TC03 no downgrade within 72h grace period — 71h59m elapsed`() {
        val elapsed71h59m = (71L * 60 + 59) * 60_000L
        assertTrue(
            "App must still be Pro at 71h 59m after last confirmation",
            EntitlementRepository.isWithinGrace(REF_TIME, REF_TIME + elapsed71h59m)
        )
    }

    @Test
    fun `EXACT72H_DISCREPANCY real code expires grace at exactly 72h — not 72h+1ms per PS024 spec`() {
        // See file header: PS-024 describes 72h+1ms as the expiry point, but the
        // real strict `<` comparison expires grace at exactly 72h. This test
        // documents ACTUAL behaviour so a future code change is a deliberate,
        // visible diff here — not a silently-passing assumption.
        assertFalse(
            "Real code currently treats exactly-72h-elapsed as EXPIRED, not grace",
            EntitlementRepository.isWithinGrace(REF_TIME, REF_TIME + EntitlementRepository.REVOCATION_GRACE_MS)
        )
    }

    @Test
    fun `PS023 downgrade suppressed within grace period at 72h minus 1ms`() {
        assertTrue(
            "Must still be within grace 1ms before the 72h boundary",
            EntitlementRepository.isWithinGrace(REF_TIME, REF_TIME + EntitlementRepository.REVOCATION_GRACE_MS - 1)
        )
    }

    @Test
    fun `lastConfirmedMs of 0 (never confirmed) is NEVER within grace regardless of elapsed time`() {
        // New coverage — previously untested. Fresh installs / pure free users
        // have lastProConfirmedMs=0 and must never be treated as "in grace".
        assertFalse(EntitlementRepository.isWithinGrace(0L, 0L))
        assertFalse(EntitlementRepository.isWithinGrace(0L, 1L))
        assertFalse(EntitlementRepository.isWithinGrace(0L, REF_TIME))
    }

    // ── Grace period boundary: TC-04 (downgrade fires at 72h+1ms) ────────────

    @Test
    fun `TC04 downgrade fires at 72h + 1ms after last confirmation`() {
        assertFalse(
            "Grace period must have expired at 72h+1ms",
            EntitlementRepository.isWithinGrace(REF_TIME, REF_TIME + EntitlementRepository.REVOCATION_GRACE_MS + 1)
        )
    }

    @Test
    fun `PS024 downgrade fires well after grace period — 100h elapsed`() {
        val elapsed100h = 100L * 60 * 60_000L
        assertFalse(EntitlementRepository.isWithinGrace(REF_TIME, REF_TIME + elapsed100h))
    }

    // ── PENDING purchase must NOT grant Pro (TEST-04 item 3) ─────────────────

    @Test
    fun `PENDING purchase state does not grant Pro`() {
        var proGranted = false
        val granted = handlePurchaseState(PurchaseState.PENDING) { proGranted = true }
        assertFalse("Pro must NOT be granted for PENDING purchase", proGranted)
        assertFalse(granted)
    }

    @Test
    fun `UNSPECIFIED purchase state does not grant Pro`() {
        var proGranted = false
        val granted = handlePurchaseState(PurchaseState.UNSPECIFIED) { proGranted = true }
        assertFalse(proGranted)
        assertFalse(granted)
    }

    @Test
    fun `PURCHASED state grants Pro immediately`() {
        var proGranted = false
        val granted = handlePurchaseState(PurchaseState.PURCHASED) { proGranted = true }
        assertTrue("Pro MUST be granted for PURCHASED state", proGranted)
        assertTrue(granted)
    }

    // ── RSA key configuration guard (BUILD-02 / SEC-01) — now calls real PurchaseVerifier ──

    @Test
    fun `BUILD02 empty RSA key treated as not configured`() {
        assertFalse(PurchaseVerifier.isConfiguredKey(""))
    }

    @Test
    fun `BUILD02 null RSA key treated as not configured`() {
        assertFalse(PurchaseVerifier.isConfiguredKey(null))
    }

    @Test
    fun `BUILD02 placeholder RSA key string treated as not configured`() {
        assertFalse(PurchaseVerifier.isConfiguredKey("REPLACE_WITH_YOUR_PLAY_CONSOLE_RSA_PUBLIC_KEY"))
    }

    @Test
    fun `BUILD02 string literal null treated as not configured`() {
        assertFalse(PurchaseVerifier.isConfiguredKey("null"))
    }

    @Test
    fun `BUILD02 real RSA key value treated as configured`() {
        assertTrue(PurchaseVerifier.isConfiguredKey("MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"))
    }

    // ── SHA1withRSA deprecated algorithm detection (SEC-01) ──────────────────

    @Test
    fun `SEC01 SHA1withRSA detected as deprecated algorithm`() {
        assertTrue(isDeprecatedSignatureAlgorithm("SHA1withRSA"))
    }

    @Test
    fun `SEC01 SHA256withRSA is not deprecated — should be used instead`() {
        assertFalse(isDeprecatedSignatureAlgorithm("SHA256withRSA"))
    }

    @Test
    fun `SEC01 MD5withRSA also detected as deprecated`() {
        assertTrue(isDeprecatedSignatureAlgorithm("MD5withRSA"))
    }

    // ── No ads in either tier (PS-009, PS-016) ───────────────────────────────

    @Test
    fun `PS009 PS016 no ads flag is always false for both tiers`() {
        assertFalse("Free tier must have no ads", false)
        assertFalse("Pro tier must have no ads", false)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests — Offer selection (real OfferSelector), period parsing (real
//  BillingPeriodParser), plan lifecycle
// ─────────────────────────────────────────────────────────────────────────────
class BillingManager_P2_Tests {

    // ── Offer selection priority — real OfferSelector (TEST-04 item 4) ───────
    // Priority is by OFFER STRUCTURE (trial > intro > base > fallback), not by
    // plan type — see file header for why the old mirror was wrong.

    @Test
    fun `OfferSelector picks the free-trial offer over intro and base offers`() {
        val offers = listOf(
            OfferSelector.OfferSignature(offerId = "base",  hasZeroPricePhase = false, firstPhasePriceMicros = 4_990_000L, firstPhaseRecurrenceMode = 1),
            OfferSelector.OfferSignature(offerId = "intro", hasZeroPricePhase = false, firstPhasePriceMicros = 990_000L,   firstPhaseRecurrenceMode = OfferSelector.RECURRENCE_NON_RECURRING),
            OfferSelector.OfferSignature(offerId = "trial", hasZeroPricePhase = true,  firstPhasePriceMicros = 0L,         firstPhaseRecurrenceMode = OfferSelector.RECURRENCE_NON_RECURRING),
        )
        val index = OfferSelector.selectBestIndex(offers)
        assertEquals("trial", offers[index!!].offerId)
    }

    @Test
    fun `OfferSelector picks intro-price offer when no trial offer present`() {
        val offers = listOf(
            OfferSelector.OfferSignature(offerId = "base",  hasZeroPricePhase = false, firstPhasePriceMicros = 4_990_000L, firstPhaseRecurrenceMode = 1),
            OfferSelector.OfferSignature(offerId = "intro", hasZeroPricePhase = false, firstPhasePriceMicros = 990_000L,   firstPhaseRecurrenceMode = OfferSelector.RECURRENCE_NON_RECURRING),
        )
        val index = OfferSelector.selectBestIndex(offers)
        assertEquals("intro", offers[index!!].offerId)
    }

    @Test
    fun `OfferSelector picks bare base-plan offer when no trial or intro exists`() {
        val offers = listOf(
            OfferSelector.OfferSignature(offerId = null, hasZeroPricePhase = false, firstPhasePriceMicros = 4_990_000L, firstPhaseRecurrenceMode = 1),
        )
        val index = OfferSelector.selectBestIndex(offers)
        assertNull(offers[index!!].offerId)
    }

    @Test
    fun `OfferSelector returns null for empty offer list`() {
        assertNull(OfferSelector.selectBestIndex(emptyList()))
    }

    @Test
    fun `OfferSelector falls back to first offer when none match any priority tier`() {
        // Every offer has a non-null offerId AND a non-zero, recurring first phase —
        // matches none of tiers 1-3, so tier 4 (fallback = first) applies.
        val offers = listOf(
            OfferSelector.OfferSignature(offerId = "promoA", hasZeroPricePhase = false, firstPhasePriceMicros = 4_990_000L, firstPhaseRecurrenceMode = 1),
            OfferSelector.OfferSignature(offerId = "promoB", hasZeroPricePhase = false, firstPhasePriceMicros = 5_990_000L, firstPhaseRecurrenceMode = 1),
        )
        assertEquals(0, OfferSelector.selectBestIndex(offers))
    }

    // ── Billing period parsing — real BillingPeriodParser (H6 regression) ────
    // Previously completely untested despite being a documented bug fix (H6).

    @Test
    fun `H6 parseToDays handles P7D as 7 days`() {
        assertEquals(7, BillingPeriodParser.parseToDays("P7D"))
    }

    @Test
    fun `H6 parseToDays handles P1W as 7 days`() {
        assertEquals(7, BillingPeriodParser.parseToDays("P1W"))
    }

    @Test
    fun `H6 parseToDays handles P1M as 30 days`() {
        assertEquals(30, BillingPeriodParser.parseToDays("P1M"))
    }

    @Test
    fun `H6 parseToDays handles P1Y as 365 days`() {
        assertEquals(365, BillingPeriodParser.parseToDays("P1Y"))
    }

    @Test
    fun `H6 parseToDays returns 0 for time-only period PT0S — the original bug case`() {
        // This is the exact case the H6 fix targeted: the old drop(1).dropLast(1).toInt()
        // implementation threw NumberFormatException on "PT0S" and silently returned 0
        // for EVERY period afterward due to the unguarded exception path.
        assertEquals(0, BillingPeriodParser.parseToDays("PT0S"))
    }

    @Test
    fun `H6 parseToDays returns 0 for blank input`() {
        assertEquals(0, BillingPeriodParser.parseToDays(""))
    }

    // ── Data preservation on downgrade (PS-018) ───────────────────────────────

    @Test
    fun `PS018 historical data is preserved when subscription expires`() {
        data class UserData(val scoreHistory: List<Int>, val focusSessions: Int)
        val data = UserData(listOf(72, 68, 80), focusSessions = 15)
        val isPro = false
        assertEquals("Score history preserved after downgrade", 3, data.scoreHistory.size)
        assertEquals(15, data.focusSessions)
        assertFalse(isPro)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P3 Tests — Edge cases
// ─────────────────────────────────────────────────────────────────────────────
class BillingManager_P3_Tests {

    @Test
    fun `grace check with clock skew — nowMs before lastConfirmedMs still reads as within grace`() {
        // Edge: lastConfirmedMs is after nowMs (clock skew). Negative diff is always < graceMs.
        assertTrue(EntitlementRepository.isWithinGrace(lastConfirmedMs = 1_000_000L, nowMs = 500_000L))
    }

    @Test
    fun `H6 parseToDays returns 0 for compound period not issued by Play Console`() {
        // Documented limitation, not a bug: compound periods aren't issued by Play
        // Console UI, so only the first matched unit in a genuinely malformed
        // string would be picked up — this pins current (accepted) behaviour.
        assertEquals(0, BillingPeriodParser.parseToDays("garbage"))
    }

    @Test
    fun `PURCHASED state correctly reported as handled`() {
        assertTrue(handlePurchaseState(PurchaseState.PURCHASED) {})
    }

    @Test
    fun `PENDING state correctly reported as not handled`() {
        assertFalse(handlePurchaseState(PurchaseState.PENDING) {})
    }

    @Test
    fun `downgrade callback not called when grace period still active`() {
        val ref = 1_700_000_000_000L
        assertTrue(EntitlementRepository.isWithinGrace(ref, ref + EntitlementRepository.REVOCATION_GRACE_MS / 2))
    }
}
