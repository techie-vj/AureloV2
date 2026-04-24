package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// ScreenScoreEnhancer — applies the HC activity bonus/penalty modifier to the
// base Screen Score after it has been computed from goal adherence, pickups,
// and first-use time.  The base formula is never changed. — Spec §5.2.
// ═══════════════════════════════════════════════════════════════════════════

data class HCActivityModifier(
    val modifier: Int,       // −3 … +5
    val label: String?,      // shown in UI e.g. "+3 pts · active day bonus"
    val steps: Int,
    val attributionNote: String = "Includes Health Connect step data",
)

object ScreenScoreEnhancer {

    /**
     * Apply the HC step-count modifier to [baseScore].
     *
     * If HC data is unavailable ([data].isAvailable == false) the base score
     * is returned unchanged. — Spec §5.1 "The existing formula is untouched."
     */
    fun applyModifier(baseScore: Int, data: HCDailyData): Int {
        if (!data.isAvailable) return baseScore
        return (baseScore + modifier(data).modifier).coerceIn(0, 100)
    }

    /**
     * The modifier value and UI label for today's step count.
     * Returns modifier = 0, label = null when HC is not available.
     */
    fun modifier(data: HCDailyData): HCActivityModifier {
        if (!data.isAvailable) return HCActivityModifier(0, null, 0)
        val steps = data.stepsToday
        return when {
            steps >= 10_000 -> HCActivityModifier(+5, "+5 pts · very active day",  steps)
            steps >= 8_000  -> HCActivityModifier(+3, "+3 pts · active day bonus", steps)
            steps >= 5_000  -> HCActivityModifier( 0, null,                        steps)
            steps <  3_000  -> HCActivityModifier(-3, "−3 pts · sedentary day",    steps)
            else            -> HCActivityModifier( 0, null,                        steps)
        }
    }
}
