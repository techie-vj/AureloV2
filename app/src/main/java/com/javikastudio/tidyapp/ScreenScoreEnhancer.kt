package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// ScreenScoreEnhancer — applies the HC activity bonus/penalty modifier to the
// base Screen Score after it has been computed from goal adherence, pickups,
// and first-use time.  The base formula is never changed. — Spec §5.2.
//
// FIX F-17: Removed the 3,000–4,999 step dead zone.
//           Old: <3000 = -3, 3000–4999 = 0 (same as 5000–7999), cliff at 3001.
//           New: linear gradient from -3 at ≤2000 steps to 0 at 5000 steps.
//           The dead zone made 3001 steps feel identical to 5000 steps,
//           and the cliff at 3000 was confusing and abrupt.
//
// FIX B1: stepsToday < 0 is the sentinel emitted by HealthConnectRepository
//         when no step records have synced yet for today (the HC aggregate
//         returns null → repository maps it to -1). Previously the repository
//         defaulted to 0, causing modifier() to award a −3 penalty before
//         any wearable or phone pedometer had synced — a false "low activity"
//         signal every morning. Guard: steps < 0 → no modifier applied.
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
     *
     * F-17: Steps below 5000 now use a smooth linear gradient (-3 at ≤2000,
     * 0 at 5000) instead of a flat 0 for 3000-4999 and a cliff at 3000.
     */
    fun modifier(data: HCDailyData): HCActivityModifier {
        if (!data.isAvailable) return HCActivityModifier(0, null, 0)
        val steps = data.stepsToday

        // FIX B1: negative sentinel means "no HC step data yet" — no modifier.
        // HealthConnectRepository sets stepsToday = -1 when the HC aggregate
        // returns null (no records synced). This is the normal early-morning
        // state. Penalising it as "low activity" was incorrect.
        if (steps < 0) return HCActivityModifier(0, null, steps)

        return when {
            steps >= 10_000 -> HCActivityModifier(+5, "+5 pts · very active day",  steps)
            steps >= 8_000  -> HCActivityModifier(+3, "+3 pts · active day bonus", steps)
            steps >= 5_000  -> HCActivityModifier( 0, null,                        steps)
            else -> {
                // F-17: smooth linear gradient from -3 at ≤2000 to 0 at 5000
                // Replaces: cliff at 3000 (-3 → 0) with dead zone 3000-4999
                val gradient = ((steps - 2_000).toFloat() / (5_000 - 2_000)).coerceIn(0f, 1f)
                val mod = ((gradient * 3f) - 3f).toInt().coerceIn(-3, 0)
                val label = when {
                    mod <= -2 -> "$mod pts · low activity today"
                    mod == -1 -> "$mod pt · low activity today"
                    else      -> null
                }
                HCActivityModifier(mod, label, steps)
            }
        }
    }
}
