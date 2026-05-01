package com.javikastudio.tidyapp

import java.util.Calendar

/**
 * CoachFeatureBuilder
 *
 * Builds the 15-value float vector expected by aurelo_coach.onnx.
 * Keep this order stable unless the ONNX model is retrained/exported again.
 *
 * Feature order:
 *  0 todayMinutes
 *  1 pickupsToday
 *  2 topCategoryEncoded
 *  3 currentHour
 *  4 focusSessionsCompleted
 *  5 streakDays
 *  6 pickupDeltaVsAvg
 *  7 firstUseHour
 *  8 dayOfWeek
 *  9 hrvDeltaVsAvg, zero when HC off
 * 10 stepsToday, zero when HC off
 * 11 sleepDurationHours, zero when HC off
 * 12 rhrDeltaVsAvg, zero when HC off
 * 13 externalMindfulnessMinutesToday, zero when HC off
 * 14 dailyGoalMinutes  ← added in v2 retrain so the model can normalise
 *                       todayMinutes against the user's goal. Without it
 *                       ~35% of feature vectors had labels that depended
 *                       on a value the model couldn't see, capping ceiling
 *                       accuracy. Bumped from 14 to 15 for retrain v2.
 */
object CoachFeatureBuilder {

    /** Length of the feature vector emitted by [toOnnx]. */
    const val FEATURE_COUNT = 15

    fun toOnnx(summary: UsageSummary): FloatArray {
        val currentHour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY).toFloat()
        val dayOfWeek = Calendar.getInstance().get(Calendar.DAY_OF_WEEK).toFloat()

        val hrvDelta = if (
            summary.hcConnected &&
            summary.hrvToday != null &&
            summary.hrv7DayAvg != null &&
            summary.hrv7DayAvg > 0f
        ) {
            summary.hrvToday - summary.hrv7DayAvg
        } else 0f

        val rhrDelta = if (
            summary.hcConnected &&
            summary.restingHeartRate != null &&
            summary.rhr7DayAvg != null &&
            summary.rhr7DayAvg > 0f
        ) {
            summary.restingHeartRate.toFloat() - summary.rhr7DayAvg
        } else 0f

        val sleepHours = if (summary.hcConnected) {
            (summary.sleepDurationMinutes ?: 0) / 60f
        } else 0f

        return floatArrayOf(
            summary.todayMinutes.toFloat(),
            summary.pickupsToday.toFloat(),
            encodeTopCategory(summary.topCategory).toFloat(),
            currentHour,
            summary.focusSessionsCompleted.toFloat(),
            summary.streakDays.toFloat(),
            summary.pickupsToday.toFloat() - summary.pickups7DayAvg,
            summary.firstUseHour.toFloat(),
            dayOfWeek,
            hrvDelta,
            if (summary.hcConnected) (summary.stepsToday ?: 0).toFloat() else 0f,
            sleepHours,
            rhrDelta,
            if (summary.hcConnected) (summary.externalMindfulnessMinutesToday ?: 0).toFloat() else 0f,
            summary.dailyGoalMinutes.toFloat(),
        )
    }

    /**
     * Encode the top category as a 0-7 integer for ONNX feature 2.
     *
     * The retrained model expects this exact mapping; mirror it in
     * `scripts/train_coach_onnx.py` if you ever change it. UsageSummaryBuilder
     * now emits the canonical category names (e.g. "Social & Communication"
     * rather than the short "social" used in the original training set), so
     * we accept both the canonical names from `Categories.kt` and the legacy
     * short labels for compatibility with any cached values.
     *
     * Anything we don't recognise is bucketed into 0 (UNASSIGNED) so the
     * model still runs — but with feature 2 contributing nothing.
     */
    private fun encodeTopCategory(category: String?): Int {
        val c = category?.trim()?.lowercase() ?: return 0
        return when {
            c == "social" || c == Categories.SOCIAL.lowercase() -> 1
            c == "entertainment" || c == Categories.ENTERTAINMENT.lowercase() -> 2
            c == "games" || c == "gaming" || c == Categories.GAMES.lowercase() -> 3
            c == "productivity" || c == "work" || c == Categories.PRODUCTIVITY.lowercase() -> 4
            c == "communication" || c == "messages" -> 5
            c == "browser" || c == "browsing" || c == "web" -> 6
            c == "health" || c == "fitness" || c == Categories.HEALTH.lowercase() -> 7
            // Map a few additional canonical buckets that didn't have a
            // legacy short alias — group them with the closest training
            // bucket rather than dropping to 0.
            c == Categories.MUSIC.lowercase() -> 2          // music ≈ entertainment
            c == Categories.CREATIVE.lowercase() -> 4       // creative ≈ productivity
            c == Categories.NEWS.lowercase() -> 6           // news ≈ browser
            c == Categories.EDUCATION.lowercase() -> 4
            c == Categories.SHOPPING.lowercase() -> 6
            c == Categories.TOOLS.lowercase() -> 6
            else -> 0
        }
    }
}
