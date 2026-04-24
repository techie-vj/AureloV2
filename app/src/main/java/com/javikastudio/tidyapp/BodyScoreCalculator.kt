package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// BodyScoreCalculator — computes the Body pillar score (0–100) from
// Health Connect HRV, Resting Heart Rate, and Steps signals.
// Spec §4.2.
// ═══════════════════════════════════════════════════════════════════════════

object BodyScoreCalculator {

    /**
     * Compute a 0–100 Body Score from the three HC signals.
     *
     * Returns -1 if no HC data is available (caller should hide the pillar).
     * Partial data (some signals null) is handled by weighting available
     * signals only — spec §4.3 "HC connected, partial data".
     */
    fun compute(data: HCDailyData): Int {
        if (!data.isAvailable) return -1

        data class Signal(val score: Int?, val weight: Float)

        val signals = listOf(
            Signal(hrvScore(data),   weight = 1f),
            Signal(rhrScore(data),   weight = 1f),
            Signal(stepsScore(data), weight = 1f),
        ).filter { it.score != null }

        if (signals.isEmpty()) return -1

        val totalWeight  = signals.sumOf { it.weight.toDouble() }.toFloat()
        val weightedSum  = signals.sumOf { (it.score!! * it.weight).toDouble() }.toFloat()
        return (weightedSum / totalWeight).toInt().coerceIn(0, 100)
    }

    // ── HRV sub-score ────────────────────────────────────────────────────────
    // Full 100 when hrv >= 7-day personal average.
    // Linear from 0 at 50% below average to 100 at average. — spec §4.2

    fun hrvScore(data: HCDailyData): Int? {
        val hrv  = data.hrvToday   ?: return null
        val avg  = data.avgHrv7d   ?: return null
        if (avg <= 0f) return null
        if (hrv >= avg) return 100
        val floor = avg * 0.5f
        if (floor >= avg) return 0
        return (((hrv - floor) / (avg - floor)) * 100f).toInt().coerceIn(0, 100)
    }

    // ── RHR sub-score ────────────────────────────────────────────────────────
    // Full 100 when rhr <= 7-day personal average.
    // Linear from 0 at +20 bpm above average to 100 at average. — spec §4.2

    fun rhrScore(data: HCDailyData): Int? {
        val rhr = data.restingHrToday?.toFloat() ?: return null
        val avg = data.avgRhr7d                  ?: return null
        if (avg <= 0f) return null
        if (rhr <= avg) return 100
        return ((1f - (rhr - avg) / 20f) * 100f).toInt().coerceIn(0, 100)
    }

    // ── Steps sub-score ──────────────────────────────────────────────────────
    // 0 at 2 000 steps, 100 at 8 000+. — spec §4.2

    fun stepsScore(data: HCDailyData): Int? {
        val steps = data.stepsToday
        if (steps < 0) return null
        if (steps >= 8_000) return 100
        return (((steps - 2_000).toFloat() / (8_000 - 2_000)) * 100f).toInt().coerceIn(0, 100)
    }
}
