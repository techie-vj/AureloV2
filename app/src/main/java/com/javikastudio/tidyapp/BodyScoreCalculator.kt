package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// BodyScoreCalculator — computes the Body pillar score (0–100) from
// Health Connect HRV, Resting Heart Rate, and Steps signals.
// Spec §4.2.
//
// FIX F-15: Weights changed from equal 1/3 each to Steps 40%, HRV 35%, RHR 25%
// FIX F-24: Steps ceiling uses personal 7-day average when > step goal.
// FIX F-28: RHR ceiling is percentage-based (avg * 1.40).
// FIX F-25: Overnight HRV floor tightened to 70% of personal average.
//
// v2.2: stepsScore() accepts an explicit stepGoal parameter (default 8,000).
//       This allows users to configure their own daily step goal under
//       Settings → Health Connect. The goal affects:
//         • Body Score steps component: 100 pts when steps >= stepGoal
//         • Body streak criteria (evaluated by SmartNotificationWorker)
//       Activity modifier thresholds (Screen Score) remain hardcoded.
// ═══════════════════════════════════════════════════════════════════════════

object BodyScoreCalculator {

    /** Default step goal used when no user-configured goal is available. */
    const val DEFAULT_STEP_GOAL = 8_000

    /**
     * Compute a 0–100 Body Score from the three HC signals.
     *
     * Returns -1 if no HC data is available (caller should hide the pillar).
     * Partial data (some signals null) is handled by weighting available
     * signals only — spec §4.3.
     *
     * v2.2: accepts optional [stepGoal] so the user's configured goal affects
     * the steps component ceiling. Defaults to [DEFAULT_STEP_GOAL] (8,000)
     * for callers that don't yet pass a goal (e.g. older code paths).
     */
    fun compute(data: HCDailyData, stepGoal: Int = DEFAULT_STEP_GOAL): Int {
        if (!data.isAvailable) return -1

        data class Signal(val score: Int?, val weight: Float)

        // F-15: differentiated weights — Steps is independent; HRV+RHR are correlated
        val signals = listOf(
            Signal(stepsScore(data, stepGoal), weight = 0.40f),
            Signal(hrvScore(data),             weight = 0.35f),
            Signal(rhrScore(data),             weight = 0.25f),
        ).filter { it.score != null }

        if (signals.isEmpty()) return -1

        val totalWeight = signals.sumOf { it.weight.toDouble() }.toFloat()
        val weightedSum = signals.sumOf { (it.score!! * it.weight).toDouble() }.toFloat()
        return (weightedSum / totalWeight).toInt().coerceIn(0, 100)
    }

    // ── HRV sub-score ────────────────────────────────────────────────────────
    // Full 100 when hrv >= 7-day personal average.
    // F-25: floor tightened to avg * 0.70 (30% below avg).

    fun hrvScore(data: HCDailyData): Int? {
        val hrv = data.hrvToday   ?: return null
        val avg = data.avgHrv7d   ?: return null
        if (avg <= 0f) return null
        if (hrv >= avg) return 100
        val floor = avg * 0.70f
        if (hrv <= floor) return 0
        return (((hrv - floor) / (avg - floor)) * 100f).toInt().coerceIn(0, 100)
    }

    // ── RHR sub-score ────────────────────────────────────────────────────────
    // Full 100 when rhr <= 7-day personal average.
    // F-28: ceiling = avg * 1.40 (percentage-based, not flat +20 bpm).

    fun rhrScore(data: HCDailyData): Int? {
        val rhr = data.restingHrToday?.toFloat() ?: return null
        val avg = data.avgRhr7d                  ?: return null
        if (avg <= 0f) return null
        if (rhr <= avg) return 100
        val ceiling = avg * 1.40f
        if (rhr >= ceiling) return 0
        return ((1f - (rhr - avg) / (ceiling - avg)) * 100f).toInt().coerceIn(0, 100)
    }

    // ── Steps sub-score ──────────────────────────────────────────────────────
    // v2.2: [stepGoal] replaces the hardcoded 8,000 ceiling.
    //       Ceiling is max(stepGoal, personal 7-day average) so high-activity
    //       users are still scored relative to their own baseline.
    //       Floor stays at 2,000 steps (absolute sedentary threshold).

    fun stepsScore(data: HCDailyData, stepGoal: Int = DEFAULT_STEP_GOAL): Int? {
        val steps = data.stepsToday
        // FIX B1: -1 sentinel means no step records synced — exclude from average.
        if (steps < 0) return null

        // Use the larger of user's step goal and personal 7-day average (F-24).
        val ceiling = if (data.avgSteps7d != null && data.avgSteps7d > stepGoal.toFloat())
            data.avgSteps7d.toInt()
        else
            stepGoal

        if (steps >= ceiling) return 100
        if (steps <= 2_000)   return 0
        return (((steps - 2_000).toFloat() / (ceiling - 2_000)) * 100f).toInt().coerceIn(0, 100)
    }

    /**
     * Returns true if today's steps meet or exceed the user's configured step goal.
     * Used by SmartNotificationWorker to determine Body streak maintained/missed.
     * Returns null if step data is unavailable (-1 sentinel).
     */
    fun isBodyStreakMaintained(data: HCDailyData, stepGoal: Int = DEFAULT_STEP_GOAL): Boolean? {
        if (!data.isAvailable) return null
        val steps = data.stepsToday
        if (steps < 0) return null   // no data — treat as N/A
        return steps >= stepGoal
    }
}
