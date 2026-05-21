package com.javikastudio.tidyapp

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/**
 * WeeklyRecapBridge — assembles weekly recap data for the "Your Week in Apps" sheet.
 *
 * getWeeklyRecapData(isoWeekYear) bundles everything the JS sheet needs in one call:
 *   • Date range formatted string (e.g. "May 12 – 18")
 *   • Aurelo Score: daily array + weekly average + grade label + delta vs prior week
 *   • Screen time: 7-day array (mins) + avg daily mins + goal mins + days goal met
 *   • Streak count at end of week
 *   • Top 3 apps (name + packageName + totalMins)
 *   • Coach one-liner (rule-based, no external call)
 *   • isPartial flag when < 5 data points available (first week of use)
 *
 * For the current ISO week, live cached data is used.
 * For past weeks accessed via notification history, score history is used for scores
 * and screen time is marked unavailable (isPartial = true).
 *
 * Banner dismiss state is stored natively keyed by isoWeekYear so the banner
 * automatically reappears for the next Sunday's new week key.
 */
class WeeklyRecapBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val usageBridge: UsageStatsBridge,
    private val coachBridge: CoachBridge
) : AppBridgeController {

    // ── Public bridge methods ────────────────────────────────────────────────

    @JavascriptInterface
    fun getWeeklyRecapData(isoWeekYear: String): String {
        return runCatching {
            val goalMins = prefs.getInt(STREAK_GOAL_MINS, 240).toLong()
            val isCurrentWeek = isoWeekYear == getCurrentIsoWeekYear()

            // ── Date range string ────────────────────────────────────────────
            val monday  = parseIsoWeekToMonday(isoWeekYear)
            val sunday  = (monday.clone() as Calendar).apply { add(Calendar.DAY_OF_WEEK, 6) }
            val fmtMon  = SimpleDateFormat("MMM d", Locale.US)
            val fmtSun  = SimpleDateFormat("d", Locale.US)
            val dateRange = "${fmtMon.format(monday.time)} – ${fmtSun.format(sunday.time)}"

            // ── Score history (all weeks) ────────────────────────────────────
            val sdf          = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val weekDates    = (0..6).map { i ->
                val d = monday.clone() as Calendar
                d.add(Calendar.DAY_OF_WEEK, i)
                sdf.format(d.time)
            }
            val aureloHist  = loadScoreHist("aurelo_score_history")
            val dailyScores = JSONArray()
            val validScores = mutableListOf<Int>()
            for (date in weekDates) {
                val v = aureloHist.optDouble(date, -1.0)
                if (v >= 0) {
                    dailyScores.put(v.toInt())
                    validScores += v.toInt()
                } else {
                    dailyScores.put(JSONObject.NULL)
                }
            }
            val weeklyAvg  = if (validScores.isNotEmpty()) validScores.average().toInt() else -1
            val gradeLabel = scoreGrade(weeklyAvg)

            // ── Week-over-week delta ─────────────────────────────────────────
            val prevWeekKey   = prevIsoWeekYear(isoWeekYear)
            val prevMonday    = parseIsoWeekToMonday(prevWeekKey)
            val prevDates     = (0..6).map { i ->
                val d = prevMonday.clone() as Calendar
                d.add(Calendar.DAY_OF_WEEK, i)
                sdf.format(d.time)
            }
            val prevValid = prevDates.mapNotNull { d ->
                aureloHist.optDouble(d, -1.0).takeIf { it >= 0 }?.toInt()
            }
            val prevAvg   = if (prevValid.isNotEmpty()) prevValid.average().toInt() else -1
            val delta     = if (weeklyAvg >= 0 && prevAvg >= 0) weeklyAvg - prevAvg else 0
            val hasDelta  = weeklyAvg >= 0 && prevAvg >= 0

            // ── Screen time (current week: live cache; past week: unavailable) ─
            val screenTimeDays = JSONArray()
            var totalMins     = 0L
            var goalMetCount  = 0

            if (isCurrentWeek) {
                val weeklyJson  = prefs.getString(CACHED_WEEKLY, "[]") ?: "[]"
                val weeklyArr   = JSONArray(weeklyJson)
                for (i in 0 until weeklyArr.length()) {
                    val m = weeklyArr.getJSONObject(i).optLong("minutes", 0L)
                    screenTimeDays.put(m)
                    totalMins += m
                    if (m in 1..goalMins) goalMetCount++
                }
                // Pad to 7 if cache has fewer entries
                repeat(7 - weeklyArr.length()) { screenTimeDays.put(0) }
            } else {
                // Historical: we don't persist per-day screen time beyond the weekly cache.
                // Return zeros + mark partial so JS can handle gracefully.
                repeat(7) { screenTimeDays.put(0) }
            }
            val dataCount = if (isCurrentWeek) {
                (0 until screenTimeDays.length()).count { screenTimeDays.optLong(it, 0) > 0 }
            } else validScores.size
            val avgDailyMins = if (dataCount > 0) totalMins / dataCount else 0L
            val isPartial    = (if (isCurrentWeek) dataCount else validScores.size) < 5

            // ── Streak ───────────────────────────────────────────────────────
            val streak = runCatching { usageBridge.getStreakDays(goalMins.toInt()) }.getOrElse { 0 }

            // ── Top apps (current week only) ─────────────────────────────────
            val topApps = JSONArray()
            if (isCurrentWeek) {
                runCatching {
                    val dailyUsage = JSONArray(prefs.getString(CACHED_DAILY_USAGE, "[]") ?: "[]")
                    for (i in 0 until minOf(3, dailyUsage.length())) {
                        val app = dailyUsage.getJSONObject(i)
                        topApps.put(JSONObject().apply {
                            put("name",        app.optString("name"))
                            put("packageName", app.optString("packageName"))
                            put("totalMins",   app.optLong("totalMinutes", 0L))
                        })
                    }
                }
            }

            // ── Coach one-liner (rule-based, no latency) ─────────────────────
            val coachOneLiner = buildOneLiner(weeklyAvg, streak, goalMetCount, avgDailyMins, goalMins)

            // ── Assemble result ──────────────────────────────────────────────
            JSONObject().apply {
                put("isoWeekYear",   isoWeekYear)
                put("dateRange",     dateRange)
                put("weeklyAvg",     weeklyAvg)
                put("gradeLabel",    gradeLabel)
                put("scoreDelta",    delta)
                put("hasDelta",      hasDelta)
                put("dailyScores",   dailyScores)
                put("screenTimeDays",screenTimeDays)
                put("avgDailyMins",  avgDailyMins)
                put("goalMins",      goalMins)
                put("goalMetCount",  goalMetCount)
                put("streak",        streak)
                put("topApps",       topApps)
                put("coachOneLiner", coachOneLiner)
                put("isPartial",     isPartial)
                put("isCurrentWeek", isCurrentWeek)
            }.toString()
        }.getOrElse { "{}" }
    }

    @JavascriptInterface
    fun getWeeklyRecapDismissed(isoWeekYear: String): Boolean =
        prefs.getBoolean("$WEEKLY_RECAP_DISMISSED_PREFIX$isoWeekYear", false)

    @JavascriptInterface
    fun setWeeklyRecapDismissed(isoWeekYear: String) {
        prefs.edit().putBoolean("$WEEKLY_RECAP_DISMISSED_PREFIX$isoWeekYear", true).apply()
    }

    /** Returns true on Sundays for PRO users who haven't dismissed this week yet. */
    @JavascriptInterface
    fun shouldShowWeeklyBanner(): Boolean {
        if (!prefs.getBoolean(IS_PRO_USER, false)) return false
        val cal = Calendar.getInstance()
        if (cal.get(Calendar.DAY_OF_WEEK) != Calendar.SUNDAY) return false
        return !prefs.getBoolean("$WEEKLY_RECAP_DISMISSED_PREFIX${getIsoWeekYear(cal)}", false)
    }

    @JavascriptInterface
    fun getCurrentIsoWeekYear(): String = getIsoWeekYear(Calendar.getInstance())

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun loadScoreHist(key: String): JSONObject =
        runCatching { JSONObject(prefs.getString(key, "{}") ?: "{}") }.getOrElse { JSONObject() }

    private fun scoreGrade(avg: Int): String = when {
        avg >= 85 -> "Excellent"
        avg >= 70 -> "Good"
        avg >= 55 -> "Fair"
        avg >= 0  -> "Start"
        else      -> ""
    }

    private fun buildOneLiner(avg: Int, streak: Int, goalMet: Int, avgMins: Long, goalMins: Long): String {
        val h = avgMins / 60; val m = avgMins % 60
        val avgStr = if (h > 0) "${h}h ${m}m" else "${m}m"
        return when {
            avg >= 85 && streak >= 7 ->
                "Exceptional week — Excellent score and a $streak-day streak. Your habits are compounding."
            avg >= 85 ->
                "Strong week — $avgStr daily average with an Excellent Aurelo score."
            avg >= 70 && goalMet >= 5 ->
                "Good week — goal hit $goalMet of 7 days. Consistency is building."
            avg >= 70 ->
                "Solid week. A few more goal days would push you to Excellent."
            avg >= 55 && streak > 0 ->
                "Fair week, but your $streak-day streak shows the habit is holding."
            avg >= 55 ->
                "Fair week — $avgStr daily average. One more focus session would shift the score."
            avg >= 0 ->
                "Challenging week ($avgStr/day). Small wins add up — start with bedtime and one focus session."
            else ->
                "Keep tracking — your weekly picture builds after a few days."
        }
    }

    // ── Static helpers (also used by SmartNotificationWorker) ────────────────

    companion object {

        fun getIsoWeekYear(cal: Calendar): String {
            val iso = Calendar.getInstance().apply {
                firstDayOfWeek      = Calendar.MONDAY
                minimalDaysInFirstWeek = 4
                time = cal.time
            }
            val week = iso.get(Calendar.WEEK_OF_YEAR)
            val year = iso.get(Calendar.YEAR)
            // Handle year-boundary edge cases
            val adjustedYear = when {
                week == 1  && iso.get(Calendar.MONTH) == Calendar.DECEMBER -> year + 1
                week >= 52 && iso.get(Calendar.MONTH) == Calendar.JANUARY  -> year - 1
                else                                                         -> year
            }
            return "$adjustedYear-W${week.toString().padStart(2, '0')}"
        }

        fun prevIsoWeekYear(isoWeekYear: String): String {
            val cal = parseIsoWeekToMonday(isoWeekYear)
            cal.add(Calendar.WEEK_OF_YEAR, -1)
            return getIsoWeekYear(cal)
        }

        fun parseIsoWeekToMonday(isoWeekYear: String): Calendar {
            val parts = isoWeekYear.split("-W")
            val year  = parts.getOrNull(0)?.toIntOrNull() ?: Calendar.getInstance().get(Calendar.YEAR)
            val week  = parts.getOrNull(1)?.toIntOrNull() ?: 1
            return Calendar.getInstance().apply {
                firstDayOfWeek         = Calendar.MONDAY
                minimalDaysInFirstWeek = 4
                set(Calendar.YEAR, year)
                set(Calendar.WEEK_OF_YEAR, week)
                set(Calendar.DAY_OF_WEEK, Calendar.MONDAY)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
        }
    }
}
