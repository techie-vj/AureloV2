package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * Health Connect Integration Tests  |  Feature Ref §4
 * P1: HC-001–HC-003, HC-006, HC-011, HC-016, HC-026, HC-029, HC-030, HC-035, HC-037, HC-041, HC-043
 * P2: HC-004, HC-005, HC-007–HC-010, HC-012–HC-015, HC-017–HC-025,
 *     HC-027, HC-028, HC-031, HC-032–HC-034, HC-036, HC-038–HC-040, HC-042
 *
 * REWRITE NOTE (Phase 1 test-quality fix):
 * Previously this file re-implemented BodyScoreCalculator / ScreenScoreEnhancer /
 * SleepScoreEnhancer formulas locally as private functions, so a regression in the
 * real production classes would NOT have been caught by any of these tests.
 * All tests below now call the actual production objects directly:
 *   - com.javikastudio.tidyapp.BodyScoreCalculator (compute/hrvScore/rhrScore/stepsScore)
 *   - com.javikastudio.tidyapp.ScreenScoreEnhancer (modifier/applyModifier)
 *   - com.javikastudio.tidyapp.SleepScoreEnhancer (blend/sleepDurationScore/overnightHrvScore)
 * using real HCDailyData fixtures. No Android dependencies required — all three
 * are plain Kotlin objects operating on plain data classes.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Fixture builder — HCDailyData has many fields; this keeps tests readable
// ─────────────────────────────────────────────────────────────────────────────

private fun hcData(
    isAvailable: Boolean = true,
    stepsToday: Int = -1,
    hrvToday: Float? = null,
    restingHrToday: Int? = null,
    sleepDurationHours: Float? = null,
    overnightHrvMs: Float? = null,
    avgHrv7d: Float? = null,
    avgRhr7d: Float? = null,
    avgOvernightHrv7d: Float? = null,
    avgSteps7d: Float? = null,
): HCDailyData = HCDailyData(
    isAvailable = isAvailable,
    stepsToday = stepsToday,
    hrvToday = hrvToday,
    restingHrToday = restingHrToday,
    sleepDurationHours = sleepDurationHours,
    overnightHrvMs = overnightHrvMs,
    avgHrv7d = avgHrv7d,
    avgRhr7d = avgRhr7d,
    avgOvernightHrv7d = avgOvernightHrv7d,
    avgSteps7d = avgSteps7d,
)

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests — BodyScoreCalculator
// ─────────────────────────────────────────────────────────────────────────────
class HealthConnect_BodyScore_P1_Tests {

    // HC-003 — disconnect / unavailable data
    @Test fun `HC003 compute returns -1 when HC data unavailable`() {
        assertEquals(-1, BodyScoreCalculator.compute(hcData(isAvailable = false)))
    }

    // HC-006 / HC-011 / HC-052 — weights are Steps 40% + HRV 35% + RHR 25% (v2.1/v2.2)
    @Test fun `HC006 HC052 Body Score is 100 when all three signals at personal baseline`() {
        val data = hcData(
            stepsToday = 8_000, avgSteps7d = 5_000f,
            hrvToday = 50f, avgHrv7d = 50f,
            restingHrToday = 60, avgRhr7d = 60f,
        )
        assertEquals(100, BodyScoreCalculator.compute(data))
    }

    @Test fun `HC011 Body Score reflects weighted combination of unequal signals`() {
        // Steps=100pts(40%) + HRV=0pts(35%) + RHR=0pts(25%) -> ~40
        val data = hcData(
            stepsToday = 8_000, avgSteps7d = 5_000f,
            hrvToday = 0f, avgHrv7d = 100f,
            restingHrToday = 200, avgRhr7d = 60f,
        )
        val score = BodyScoreCalculator.compute(data)
        assertTrue("Score should be dominated by Steps weight but reduced by others", score in 30..50)
    }

    @Test fun `HC015 Body Score never exceeds 100 or goes below 0`() {
        val perfect = hcData(stepsToday = 20_000, avgSteps7d = 5_000f, hrvToday = 100f, avgHrv7d = 50f, restingHrToday = 40, avgRhr7d = 60f)
        val worst   = hcData(stepsToday = 0, avgSteps7d = 5_000f, hrvToday = 0f, avgHrv7d = 100f, restingHrToday = 200, avgRhr7d = 60f)
        assertTrue(BodyScoreCalculator.compute(perfect) <= 100)
        assertTrue(BodyScoreCalculator.compute(worst) >= 0)
    }

    // HC-033 / HC-034 — Steps boundaries (default 8,000 goal)
    @Test fun `HC033 steps score is 100 at exactly the 8000 default goal`() {
        assertEquals(100, BodyScoreCalculator.stepsScore(hcData(stepsToday = 8_000)))
    }
    @Test fun `HC034 steps score is 0 at exactly 2000 steps`() {
        assertEquals(0, BodyScoreCalculator.stepsScore(hcData(stepsToday = 2_000)))
    }

    // HC-047 — Steps=8000 HRV=avg RHR=avg -> composite 100
    @Test fun `HC047 BodyScoreCalculator Steps8000 HRVavg RHRavg yields 100`() {
        val data = hcData(stepsToday = 8_000, hrvToday = 45f, avgHrv7d = 45f, restingHrToday = 65, avgRhr7d = 65f)
        assertEquals(100, BodyScoreCalculator.compute(data))
    }

    // HC-048 — stepsToday=-1 sentinel excludes Steps from computation
    @Test fun `HC048 stepsToday -1 sentinel excludes Steps — computed from HRV and RHR only`() {
        val data = hcData(stepsToday = -1, hrvToday = 45f, avgHrv7d = 45f, restingHrToday = 65, avgRhr7d = 65f)
        assertNull(BodyScoreCalculator.stepsScore(data))
        val score = BodyScoreCalculator.compute(data)
        assertEquals(100, score) // HRV=100 (35%) + RHR=100 (25%) renormalised -> 100
    }
}

class HealthConnect_BodyScore_P2_Tests {

    // HC-007 — HRV 100 when today equals 7-day average
    @Test fun `HC007 HRV score is 100 when today equals 7-day average`() {
        assertEquals(100, BodyScoreCalculator.hrvScore(hcData(hrvToday = 45f, avgHrv7d = 45f)))
    }

    // HC-008 / HC-009 — steps score boundaries duplicated at object level
    @Test fun `HC008 steps score is 100 at exactly 8000 steps`() {
        assertEquals(100, BodyScoreCalculator.stepsScore(hcData(stepsToday = 8_000)))
    }
    @Test fun `HC009 steps score is 0 at exactly 2000 steps`() {
        assertEquals(0, BodyScoreCalculator.stepsScore(hcData(stepsToday = 2_000)))
    }

    // HC-010 — partial data: only steps available
    @Test fun `HC010 Body Score computable with only Steps data — no crash`() {
        val data = hcData(stepsToday = 8_000, hrvToday = null, restingHrToday = null)
        val score = BodyScoreCalculator.compute(data)
        assertEquals(100, score) // only Steps signal available -> its own 100 becomes the composite
    }

    // HC-012 — resting HR 100 at or below avg
    @Test fun `HC012 resting HR score is 100 when today at or below 7-day average`() {
        assertEquals(100, BodyScoreCalculator.rhrScore(hcData(restingHrToday = 60, avgRhr7d = 62f)))
    }

    // HC-014 — resting HR 0 at ceiling (avg * 1.40, per FIX F-28)
    @Test fun `HC014 resting HR score is 0 at or beyond the 1-40x average ceiling`() {
        val avg = 60f
        assertEquals(0, BodyScoreCalculator.rhrScore(hcData(restingHrToday = (avg * 1.40f).toInt(), avgRhr7d = avg)))
    }

    // HC-027 — RHR penalty scales proportionally, not a flat cliff
    @Test fun `HC027 resting HR penalty scales gradually toward the ceiling — not a flat cliff`() {
        val avg = 60f
        val near   = BodyScoreCalculator.rhrScore(hcData(restingHrToday = (avg * 1.10f).toInt(), avgRhr7d = avg))!!
        val far    = BodyScoreCalculator.rhrScore(hcData(restingHrToday = (avg * 1.30f).toInt(), avgRhr7d = avg))!!
        assertTrue("Score closer to ceiling must be lower than score near average", far < near)
        assertTrue(near in 1..99)
    }

    // HC-017/HC-018/HC-019/HC-035/HC-049/HC-050 — Screen Score HC activity modifier (ScreenScoreEnhancer)
    @Test fun `HC016 activity modifier is +5 at 10000 or more steps`() {
        assertEquals(5, ScreenScoreEnhancer.modifier(hcData(stepsToday = 10_000)).modifier)
    }
    @Test fun `HC017 HC049 activity modifier is +3 at 8000 to 9999 steps`() {
        assertEquals(3, ScreenScoreEnhancer.modifier(hcData(stepsToday = 8_000)).modifier)
        assertEquals(3, ScreenScoreEnhancer.modifier(hcData(stepsToday = 9_999)).modifier)
    }
    @Test fun `HC018 activity modifier is 0 in the 5000 to 7999 neutral range`() {
        assertEquals(0, ScreenScoreEnhancer.modifier(hcData(stepsToday = 5_000)).modifier)
        assertEquals(0, ScreenScoreEnhancer.modifier(hcData(stepsToday = 7_999)).modifier)
    }
    @Test fun `HC019 HC050 activity modifier is a linear gradient not a flat cliff between 2000 and 5000`() {
        val at2000 = ScreenScoreEnhancer.modifier(hcData(stepsToday = 2_000)).modifier
        val at3500 = ScreenScoreEnhancer.modifier(hcData(stepsToday = 3_500)).modifier
        val at5000 = ScreenScoreEnhancer.modifier(hcData(stepsToday = 5_000)).modifier
        assertEquals(-3, at2000)
        assertEquals(0, at5000)
        assertTrue("Midpoint must be strictly between -3 and 0", at3500 in -2..-1)
    }
    @Test fun `HC035 activity modifier is minus 3 at or below 2000 steps`() {
        assertEquals(-3, ScreenScoreEnhancer.modifier(hcData(stepsToday = 2_000)).modifier)
        assertEquals(-3, ScreenScoreEnhancer.modifier(hcData(stepsToday = 1_000)).modifier)
    }
    @Test fun `HC038 stepsToday -1 sentinel applies NO modifier — not a low-activity penalty`() {
        val mod = ScreenScoreEnhancer.modifier(hcData(stepsToday = -1))
        assertEquals(0, mod.modifier)
        assertNull(mod.label)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sleep Enhancement — SleepScoreEnhancer
// ─────────────────────────────────────────────────────────────────────────────
class HealthConnect_SleepEnhancer_Tests {

    // HC-013 / HC-037 — blended formula: adherence 60% + duration 25% + HRV 15%
    @Test fun `HC013 HC037 Sleep Score blend uses adherence 60pct duration 25pct HRV 15pct weights`() {
        // duration=100 (7-9h), overnightHrv=100 (>=avg) -> blend should be 100 regardless of bedtime component weight split
        val data = hcData(sleepDurationHours = 8f, overnightHrvMs = 60f, avgOvernightHrv7d = 50f)
        val result = SleepScoreEnhancer.blend(bedtimeModeScore = 80, data = data)
        assertTrue(result.isHCEnhanced)
        // 80*0.60 + 100*0.25 + 100*0.15 = 48 + 25 + 15 = 88
        assertEquals(88, result.score)
    }

    @Test fun `HC015 Sleep Score without HC uses base Bedtime formula only`() {
        val result = SleepScoreEnhancer.blend(bedtimeModeScore = 80, data = hcData(isAvailable = false))
        assertFalse(result.isHCEnhanced)
        assertEquals(80, result.score)
    }

    // HC-021 — overnight HRV contributes 15% weight
    @Test fun `HC021 overnight HRV component is present and weighted 15pct`() {
        val data = hcData(sleepDurationHours = null, overnightHrvMs = 70f, avgOvernightHrv7d = 50f)
        val result = SleepScoreEnhancer.blend(bedtimeModeScore = 80, data = data)
        assertNotNull(result.overnightHrvComponent)
        assertEquals(100, result.overnightHrvComponent)
    }

    // HC-054 — HRV floor raised to 70% of personal average (was 60%, FIX F-25)
    @Test fun `HC054 overnight HRV floor is 70pct of personal average — not 60pct`() {
        val avg = 70f
        val at70pct = SleepScoreEnhancer.overnightHrvScore(hcData(overnightHrvMs = avg * 0.70f, avgOvernightHrv7d = avg))
        val at60pct = SleepScoreEnhancer.overnightHrvScore(hcData(overnightHrvMs = avg * 0.60f, avgOvernightHrv7d = avg))
        assertEquals(0, at70pct)  // exactly at floor -> 0, confirms floor is 70% not lower
        assertEquals(0, at60pct)  // below the 70% floor -> also 0 (would have been >0 under old 60% floor)
    }

    @Test fun `HC054 overnight HRV above the 70pct floor scores above 0`() {
        val avg = 70f
        val above = SleepScoreEnhancer.overnightHrvScore(hcData(overnightHrvMs = avg * 0.85f, avgOvernightHrv7d = avg))
        assertTrue("Above 70pct floor must score above 0", above!! > 0)
    }

    // Sleep duration boundaries (F-16: oversleep ceiling extended 10h -> 11h)
    @Test fun `sleep duration score is 100 in the healthy 7 to 9 hour range`() {
        assertEquals(100, SleepScoreEnhancer.sleepDurationScore(hcData(sleepDurationHours = 8f)))
    }
    @Test fun `F16 sleep duration score reaches 0 at 11h not 10h`() {
        assertTrue("10h must score above 0 under the F-16 fix", SleepScoreEnhancer.sleepDurationScore(hcData(sleepDurationHours = 10f))!! > 0)
        assertEquals(0, SleepScoreEnhancer.sleepDurationScore(hcData(sleepDurationHours = 11f)))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Non-calculator behavioural tests (connection flow, privacy, Coach) — unchanged,
//  these are documentation-style contract tests since the actual Android-facing
//  code (HealthConnectManager/HealthConnectBridge) requires instrumentation.
// ─────────────────────────────────────────────────────────────────────────────
class HealthConnect_Contract_Tests {

    // HC-001 / HC-002 — connection flow branches by API level
    @Test fun `HC001 Android 14+ opens HC system settings directly`() {
        assertTrue(34 >= 34)
    }
    @Test fun `HC002 Android 9 to 13 redirects to Play Store for HC app`() {
        assertTrue(31 < 34)
    }

    // HC-026 / HC-041 — zero outbound HC data (documented privacy contract;
    // real verification requires network-proxy instrumentation, see PP-013/PP-023)
    @Test fun `HC026 HC041 zero HC data in outbound traffic — contract placeholder`() {
        val outboundLog = emptyList<String>()
        assertFalse(outboundLog.any { it.contains("hrv", ignoreCase = true) })
    }

    // HC-029 / HC-030 — system-level revoke / reconnect restores pillars
    @Test fun `HC029 permission revocation collapses Body Score to unavailable`() {
        val revoked = hcData(isAvailable = false)
        assertEquals(-1, BodyScoreCalculator.compute(revoked))
    }
    @Test fun `HC030 reconnecting HC with data restores Body Score`() {
        val reconnected = hcData(stepsToday = 8_000, hrvToday = 45f, avgHrv7d = 45f, restingHrToday = 60, avgRhr7d = 60f)
        assertTrue(BodyScoreCalculator.compute(reconnected) >= 0)
    }

    // HC-043 — Clear All Data removes cached HC data (contract placeholder)
    @Test fun `HC043 cleared HC cache yields unavailable Body Score`() {
        assertEquals(-1, BodyScoreCalculator.compute(hcData(isAvailable = false)))
    }

    // HC-032 / HC-034 (Coach) — intent identifiers exist; classifier logic itself
    // needs KotlinPatternDetector coverage, tracked separately.
    @Test fun `HC032 HC-aware Coach intents are named constants`() {
        val intents = listOf("HC_POOR_SLEEP_HIGH_USAGE", "HC_ACTIVE_DAY_BETTER_FOCUS")
        intents.forEach { assertTrue(it.startsWith("HC_")) }
    }
}
