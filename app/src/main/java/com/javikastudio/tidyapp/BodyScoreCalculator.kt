package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// BodyScoreCalculator — computes the Body pillar score (0–100) from
// Health Connect HRV, Resting Heart Rate, and Steps signals.
// Spec §4.2.
//
// FIX F-15: Weights changed from equal 1/3 each to Steps 40%, HRV 35%, RHR 25%
//           Steps is physiologically independent from HRV/RHR; equal weighting
//           double-counted autonomic recovery signals.
// FIX F-24: Steps ceiling now uses personal 7-day average when > 8000, so
//           high-activity users are scored relative to their own baseline.
// FIX F-28: RHR ceiling changed from absolute +20 bpm to percentage-based
//           (avg * 1.40), so athletes with low RHR baselines are not penalized
//           disproportionately for moderate elevation.
// FIX F-25: Overnight HRV floor tightened from 40% below avg to 30% below avg,
//           reflecting that overnight HRV is more stable than daytime HRV and
//           should therefore have a tighter acceptable-deviation band.
// ═══════════════════════════════════════════════════════════════════════════

object BodyScoreCalculator {

    /**
     * Compute a 0–100 Body Score from the three HC signals.
     *
     * Returns -1 if no HC data is available (caller should hide the pillar).
     * Partial data (some signals null) is handled by weighting available
     * signals only — spec §4.3 "HC connected, partial data".
     *
     * F-15: weights are now Steps 40%, HRV 35%, RHR 25% (not equal thirds).
     */
    fun compute(data: HCDailyData): Int {
        if (!data.isAvailable) return -1

        data class Signal(val score: Int?, val weight: Float)

        // F-15: differentiated weights — Steps is independent; HRV+RHR are correlated
        val signals = listOf(
            Signal(stepsScore(data), weight = 0.40f),   // most independent signal
            Signal(hrvScore(data),   weight = 0.35f),   // autonomic recovery
            Signal(rhrScore(data),   weight = 0.25f),   // correlated with HRV — lower weight
        ).filter { it.score != null }

        if (signals.isEmpty()) return -1

        val totalWeight = signals.sumOf { it.weight.toDouble() }.toFloat()
        val weightedSum = signals.sumOf { (it.score!! * it.weight).toDouble() }.toFloat()
        return (weightedSum / totalWeight).toInt().coerceIn(0, 100)
    }

    // ── HRV sub-score ────────────────────────────────────────────────────────
    // Full 100 when hrv >= 7-day personal average.
    // F-25: floor tightened to avg * 0.70 (30% below avg) from avg * 0.50
    // (50% below avg). Overnight HRV is more stable — tighter floor is correct.

    fun hrvScore(data: HCDailyData): Int? {
        val hrv = data.hrvToday   ?: return null
        val avg = data.avgHrv7d   ?: return null
        if (avg <= 0f) return null
        if (hrv >= avg) return 100
        // F-25: floor tightened from 50% to 70% of average
        val floor = avg * 0.70f
        if (hrv <= floor) return 0
        return (((hrv - floor) / (avg - floor)) * 100f).toInt().coerceIn(0, 100)
    }

    // ── RHR sub-score ────────────────────────────────────────────────────────
    // Full 100 when rhr <= 7-day personal average.
    // F-28: ceiling changed from absolute +20 bpm to percentage-based (avg * 1.40).
    // Example: avg RHR 45 → ceiling 63 bpm; avg RHR 70 → ceiling 98 bpm.
    // Prevents athletes with low baselines from reaching 0 too easily.

    fun rhrScore(data: HCDailyData): Int? {
        val rhr = data.restingHrToday?.toFloat() ?: return null
        val avg = data.avgRhr7d                  ?: return null
        if (avg <= 0f) return null
        if (rhr <= avg) return 100
        // F-28: percentage-based ceiling = 40% above personal average
        val ceiling = avg * 1.40f
        if (rhr >= ceiling) return 0
        return ((1f - (rhr - avg) / (ceiling - avg)) * 100f).toInt().coerceIn(0, 100)
    }

    // ── Steps sub-score ──────────────────────────────────────────────────────
    // F-24: ceiling uses personal 7-day average when > 8000 steps.
    //       A runner who averages 15k steps gets full credit at 15k, not 8k.
    // Base floor stays at 2 000 steps (absolute, not personal — below 2k is sedentary
    // for virtually everyone regardless of personal baseline).

    fun stepsScore(data: HCDailyData): Int? {
        val steps = data.stepsToday
        if (steps < 0) return null

        // F-24: use personal ceiling when available and greater than 8000
        val ceiling = if (data.avgSteps7d != null && data.avgSteps7d > 8_000f)
            data.avgSteps7d.toInt()
        else
            8_000

        if (steps >= ceiling) return 100
        if (steps <= 2_000) return 0
        return (((steps - 2_000).toFloat() / (ceiling - 2_000)) * 100f).toInt().coerceIn(0, 100)
    }
}
