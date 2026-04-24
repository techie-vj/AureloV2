package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// KotlinPatternDetector — server-side pattern detection.
// Runs inside CoachInsightWorker (WorkManager) using a UsageSummary snapshot.
// HC checks run only when hcConnected = true (spec §14.5).
// ═══════════════════════════════════════════════════════════════════════════

import kotlin.math.*

data class PatternResult(
    val intent: String,
    val priority: Int,
    val description: String,
    val hcBased: Boolean = false,
)

object KotlinPatternDetector {

    /** Run all pattern checks and return sorted results (highest priority first). */
    fun detectAll(summary: UsageSummary): List<PatternResult> {
        val results = mutableListOf<PatternResult>()
        val hour = currentHour()

        // ── Streak-at-risk ────────────────────────────────────────────────
        val rate      = if (hour > 0) summary.todayMinutes.toFloat() / hour else 0f
        val projected = summary.todayMinutes + rate * (24 - hour)
        if (projected > summary.dailyGoalMinutes * 0.85f && summary.streakDays > 3) {
            results += PatternResult(
                intent      = "STREAK_AT_RISK",
                priority    = 10,
                description = "Projected to exceed goal by ${(projected - summary.dailyGoalMinutes).toInt()} min — ${summary.streakDays}-day streak at risk.",
            )
        }

        // ── Score drop ────────────────────────────────────────────────────
        if (summary.aureloScoreYesterday - summary.aureloScore > 8) {
            results += PatternResult(
                intent      = "SCORE_DROP",
                priority    = 9,
                description = "Score dropped ${summary.aureloScoreYesterday - summary.aureloScore} pts from yesterday.",
            )
        }

        // ── HC: poor sleep → high usage correlation (spec §14.5) ─────────
        if (summary.hcConnected) {
            val hrv7 = summary.hrv7DayAvg
            val hrvToday = summary.hrvToday
            if (hrv7 != null && hrv7 > 0f && hrvToday != null) {
                val correlation = hrvToday / hrv7  // simplified ratio
                if (correlation < 0.80f && summary.todayMinutes > summary.dailyGoalMinutes * 0.9f) {
                    results += PatternResult(
                        intent      = "HC_POOR_SLEEP_HIGH_USAGE",
                        priority    = 9,
                        description = "HRV is ${String.format("%.0f", (1f - correlation) * 100)}% below average — and screen time is already elevated.",
                        hcBased     = true,
                    )
                }
            }

            // ── HC: active day → better focus (spec §14.5) ───────────────
            val steps = summary.stepsToday
            if (steps != null && steps >= 8000 && summary.focusSessionsCompleted > 0) {
                results += PatternResult(
                    intent      = "HC_ACTIVE_DAY_BETTER_FOCUS",
                    priority    = 7,
                    description = "$steps steps today — active days often correlate with better focus and lower screen time.",
                    hcBased     = true,
                )
            }

            // ── HC: sleep duration insight ────────────────────────────────
            val sleepHours = summary.sleepDurationMinutes?.div(60f)
            if (sleepHours != null && sleepHours < 6f) {
                results += PatternResult(
                    intent      = "BEDTIME_REVENGE_PROCRASTINATION",
                    priority    = 8,
                    description = "Only ${String.format("%.1f", sleepHours)}h sleep last night — short nights tend to push pickup counts higher.",
                    hcBased     = true,
                )
            }
        }

        // ── Focus gap ─────────────────────────────────────────────────────
        if (summary.daysSinceLastFocus >= 3) {
            results += PatternResult(
                intent      = "FOCUS_GAP",
                priority    = 8,
                description = "No focus session in ${summary.daysSinceLastFocus} days — Focus Score is declining.",
            )
        }

        // ── Morning doom-scroll ───────────────────────────────────────────
        if (summary.firstUseHour < 8) {
            results += PatternResult(
                intent      = "MORNING_DOOM_SCROLL",
                priority    = 6,
                description = "First phone use at ${summary.firstUseHour}:00 AM — early first-use raises pickup count all day.",
            )
        }

        // ── Anomalous spike ───────────────────────────────────────────────
        val activeDays = summary.screenTime7Day.filter { it.minutes > 0 }
        if (activeDays.size >= 3) {
            val avg = activeDays.sumOf { it.minutes }.toFloat() / activeDays.size
            val worst = activeDays.maxByOrNull { it.minutes }
            if (worst != null && worst.minutes > avg * 1.5f) {
                results += PatternResult(
                    intent      = "ANOMALOUS_SPIKE",
                    priority    = 7,
                    description = "${worst.dateLabel} is consistently your heaviest day — ${worst.minutes} min vs ${avg.toInt()} min average.",
                )
            }
        }

        // ── Positive milestone ────────────────────────────────────────────
        if (summary.streakDays in listOf(7, 14, 21, 30) ||
            (summary.aureloScore >= 85 && summary.aureloScoreYesterday < 85)) {
            results += PatternResult(
                intent      = "PRODUCTIVE_DAY",
                priority    = 6,
                description = if (summary.streakDays in listOf(7, 14, 21, 30))
                    "${summary.streakDays}-day streak milestone!" else "Reached Excellent grade (85+) today!",
            )
        }

        // ── General fallback ─────────────────────────────────────────────
        results += PatternResult(
            intent      = "GENERAL_SUMMARY",
            priority    = 1,
            description = "Aurelo Score ${summary.aureloScore} · ${summary.streakDays}-day streak.",
        )

        return results.sortedByDescending { it.priority }
    }

    /** Dopamine loop detection — spec §14.5 (heuristic proxy). */
    fun detectDopamineLoop(sessions: List<Triple<String, Long, Long>>): Boolean {
        // sessions: list of (packageName, startTimeMs, endTimeMs)
        val shortSessions = sessions.filter { (_, start, end) -> (end - start) < 90_000L }
        return shortSessions
            .groupBy { (pkg, _, _) -> pkg }
            .any { (_, appSessions) ->
                appSessions.zipWithNext().count { (a, b) ->
                    b.second - a.third < 5 * 60_000L  // gap < 5 min
                } >= 4
            }
    }

    /** Pearson correlation between two float lists (min 3 values). Returns null if insufficient data. */
    fun pearsonCorrelation(xs: List<Float>, ys: List<Float>): Float? {
        if (xs.size != ys.size || xs.size < 3) return null
        val n = xs.size
        val meanX = xs.average().toFloat()
        val meanY = ys.average().toFloat()
        val num = xs.zip(ys).sumOf { (x, y) -> ((x - meanX) * (y - meanY)).toDouble() }.toFloat()
        val denomX = sqrt(xs.sumOf { ((it - meanX) * (it - meanX)).toDouble() }.toFloat())
        val denomY = sqrt(ys.sumOf { ((it - meanY) * (it - meanY)).toDouble() }.toFloat())
        return if (denomX == 0f || denomY == 0f) null else num / (denomX * denomY)
    }

    private fun currentHour(): Int =
        java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
}
