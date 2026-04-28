package com.javikastudio.tidyapp

import java.util.Calendar

/**
 * CoachFeatureBuilder
 *
 * Builds the 14-value float vector expected by aurelo_coach.onnx.
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
 */
object CoachFeatureBuilder {

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
        )
    }

    private fun encodeTopCategory(category: String?): Int {
        return when (category?.trim()?.lowercase()) {
            "social" -> 1
            "entertainment" -> 2
            "games", "gaming" -> 3
            "productivity", "work" -> 4
            "communication", "messages" -> 5
            "browser", "browsing", "web" -> 6
            "health", "fitness" -> 7
            else -> 0
        }
    }
}
