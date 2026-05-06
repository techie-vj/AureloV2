package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// UsageSummaryBuilder — merges screen time data with Health Connect signals
// into a single UsageSummary passed to the Coach pipeline.
// Spec §14.1 (data class definition) + §2.1 (file responsibility).
// ═══════════════════════════════════════════════════════════════════════════

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

// ── Data classes ─────────────────────────────────────────────────────────────

data class AppUsageEntry(val packageName: String, val label: String, val minutes: Int)
data class DayRecord(val dateLabel: String, val minutes: Int)

/**
 * Merged snapshot of screen-time + HC signals for the Coach pipeline.
 * HC fields are null when Health Connect is not connected — spec §14.1.
 */
data class UsageSummary(
    // ── Screen time signals ────────────────────────────────────────────────
    val todayMinutes: Int,
    val dailyGoalMinutes: Int,
    val pickupsToday: Int,
    val pickups7DayAvg: Float,
    val firstUseHour: Int,
    val streakDays: Int,
    val topApps: List<AppUsageEntry>,
    val topCategory: String,
    val screenTime7Day: List<DayRecord>,
    val focusSessionsCompleted: Int,
    val focusSessionsInterrupted: Int,
    val daysSinceLastFocus: Int,
    val aureloScore: Int,
    val aureloScoreYesterday: Int,
    /** Pillar sub-scores cached by app-home-score.js via the cacheScore bridge. */
    val screenScore: Int,
    val focusScore: Int,
    val sleepScore: Int,
    val bodyScore: Int,
    // ── Health Connect signals ─────────────────────────────────────────────
    val hrvToday: Float?,
    val hrv7DayAvg: Float?,
    val stepsToday: Int?,
    val steps7DayAvg: Float?,
    val sleepDurationMinutes: Int?,
    val sleepDuration7DayAvg: Float?,
    val restingHeartRate: Int?,
    val rhr7DayAvg: Float?,
    val externalMindfulnessMinutesToday: Int?,
    val hcConnected: Boolean,
    /** 7 for Phase 1 / Phase 2 rule engine; 30 for Gemini Nano. */
    val dataWindowDays: Int,
)

class UsageSummaryBuilder(
    private val context: Context,
    private val prefs: SharedPreferences,
) {

    /**
     * Assemble [UsageSummary] from SharedPrefs caches and [hcData].
     * Called by HealthConnectBridge and (in future) CoachOrchestrator.
     */
    fun build(hcData: HCDailyData, dataWindowDays: Int = -1): UsageSummary {
        // ── Screen time ────────────────────────────────────────────────────
        val todayMins = try {
            prefs.getInt(CACHED_TOTAL_MINS, 0)
        } catch (e: ClassCastException) {
            prefs.getLong(CACHED_TOTAL_MINS, 0L).toInt()
        }

        val goalMins = prefs.getInt(STREAK_GOAL_MINS, 240)

        // FIX: Apply the same logic to pickups just in case they were logged as Long
        val pickups = try {
            prefs.getInt(CACHED_PICKUPS, 0)
        } catch (e: ClassCastException) {
            prefs.getLong(CACHED_PICKUPS, 0L).toInt()
        }

        val streak      = prefs.getInt(CACHED_STREAK_DAYS, 0)

        val topApps     = parseTopApps(prefs.getString(CACHED_DAILY_USAGE, "[]") ?: "[]")
        // FIX: derive real top category from cached app→category map written by
        // AppManagementBridge (APP_CAT_MAP_V1) and CAT_OVERRIDES_V4. The previous
        // hard-coded "Social" caused every user with at least one tracked app to
        // be flagged as a social-media spiral candidate downstream.
        val topCategory = resolveTopCategory(topApps)
        val weekly      = parseWeekly(prefs.getString(CACHED_WEEKLY, "[]") ?: "[]")

        // Pickups 7-day average from weekly data
        val weeklyPickupsRaw = prefs.getString(CACHED_MONTHLY_PICKUPS, "[]") ?: "[]"
        val pickups7DayAvg  = weeklyAverage(weeklyPickupsRaw, 7)

        // First pickup hour from cached first-pickup timestamp.
        // FIX P1-05: default was 8 when no pickup was recorded (Day 1 / fresh install),
        // causing FOCUS_PEAK_TIME and ENCOURAGING templates to emit "first use at 8:00"
        // even when the user had never opened their phone. Sentinel -1 means "no pickup
        // recorded yet"; fillSlots() and guards throughout CoachOrchestrator must treat
        // firstUseHour < 0 as "unknown" rather than an actual early-morning value.
        val firstPickupTs = prefs.getLong(CACHED_FIRST_PICKUP_TS, 0L)
        val firstUseHour  = if (firstPickupTs > 0L)
            java.util.Calendar.getInstance().apply { timeInMillis = firstPickupTs }.get(java.util.Calendar.HOUR_OF_DAY)
        else -1  // sentinel: no pickup recorded today

        // ── Focus signals ─────────────────────────────────────────────────
        val weekId    = currentWeekId()
        val savedWeekId = prefs.getString(KEY_FOCUS_WEEK_ID, "")
        val focusDone = if (savedWeekId == weekId) prefs.getInt(KEY_FOCUS_COMPLETED_WEEK, 0) else 0
        val focusFail = if (savedWeekId == weekId) prefs.getInt(KEY_FOCUS_INTERRUPTED_WEEK, 0) else 0

        // Days since last focus session — iterate backward up to 14 days
        val daysSinceFocus = daysSinceLastFocus()

        // ── Aurelo score (yesterday cached) ───────────────────────────────
        // We use the raw screen + focus + sleep components cached by UsageStatsBridge.
        // The HC body pillar is not cached yet — bridge computes it fresh each time.
        val aureloScore          = prefs.getInt("cached_aurelo_score", 0)
        val aureloScoreYesterday = prefs.getInt("cached_aurelo_score_yesterday", 0)
        // Pillar sub-scores written by app-home-score.js via the cacheScore bridge.
        // These are the same values toJson() already reads for the Coach JS side.
        val screenScore          = prefs.getInt("cached_screen_score", 0)
        val focusScore           = prefs.getInt("cached_focus_score", 0)
        val sleepScore           = prefs.getInt("cached_sleep_score", 0)
        val bodyScore            = prefs.getInt("cached_body_score", 0)

        // ── HC signals ────────────────────────────────────────────────────
        val mindfulnessMins = if (hcData.isAvailable)
            hcData.mindfulnessSessions.sumOf { it.durationMinutes }
        else null

        return UsageSummary(
            todayMinutes                  = todayMins,
            dailyGoalMinutes              = goalMins,
            pickupsToday                  = pickups,
            pickups7DayAvg                = pickups7DayAvg,
            firstUseHour                  = firstUseHour,
            streakDays                    = streak,
            topApps                       = topApps.take(5),
            topCategory                   = topCategory,
            screenTime7Day                = weekly,
            focusSessionsCompleted        = focusDone,
            focusSessionsInterrupted      = focusFail,
            daysSinceLastFocus            = daysSinceFocus,
            aureloScore                   = aureloScore,
            aureloScoreYesterday          = aureloScoreYesterday,
            screenScore                   = screenScore,
            focusScore                    = focusScore,
            sleepScore                    = sleepScore,
            bodyScore                     = bodyScore,
            hrvToday                      = hcData.hrvToday,
            hrv7DayAvg                    = hcData.avgHrv7d,
            stepsToday                    = if (hcData.isAvailable) hcData.stepsToday else null,
            steps7DayAvg                  = hcData.avgSteps7d,
            sleepDurationMinutes          = hcData.sleepDurationHours?.let { (it * 60).toInt() },
            sleepDuration7DayAvg          = hcData.avgSleepDuration7d?.let { it * 60 },
            restingHeartRate              = hcData.restingHrToday,
            rhr7DayAvg                    = hcData.avgRhr7d,
            externalMindfulnessMinutesToday = mindfulnessMins,
            hcConnected                   = hcData.isAvailable,
            // FIX: reflect actual installed-history depth instead of always 7.
            // Falls back to the explicitly-supplied window when caller forces one.
            dataWindowDays                = if (dataWindowDays >= 0) dataWindowDays
            else effectiveDataWindowDays(weekly),
        )
    }

    /**
     * Returns the effective data window in days, capped at 30 (the value
     * `InsightTemplateLibrary.inferVariant` uses for ESTABLISHED). Drawn from
     * the cached daily-history map written by `UsageStatsBridge`, so users with
     * 30+ days of history actually surface ESTABLISHED templates.
     */
    private fun effectiveDataWindowDays(weekly: List<DayRecord>): Int {
        val activeWeekly = weekly.count { it.minutes > 0 }
        val histSize = runCatching {
            val raw = prefs.getString(DAILY_HIST_MAP, "{}") ?: "{}"
            JSONObject(raw).length()
        }.getOrDefault(0)
        return maxOf(activeWeekly, histSize).coerceIn(0, 30)
    }

    /**
     * Resolve the user's actual top app category by looking up each top app
     * against the same cat-map / overrides used by the rest of the app.
     * Falls back to "Other" when no mapping is found — never a hard-coded value.
     */
    private fun resolveTopCategory(topApps: List<AppUsageEntry>): String {
        if (topApps.isEmpty()) return "Other"
        val secure = try {
            context.getSharedPreferences(SECURE_PREFS_FILE, Context.MODE_PRIVATE)
        } catch (_: Exception) { null }
        val appCatMap = runCatching {
            JSONObject(secure?.getString(APP_CAT_MAP_V1, "{}") ?: "{}")
        }.getOrDefault(JSONObject())
        val overrides = runCatching {
            JSONObject(secure?.getString(CAT_OVERRIDES_V4, "{}") ?: "{}")
        }.getOrDefault(JSONObject())

        // Aggregate minutes per category across all top apps so the result
        // reflects the dominant category, not just the top single app.
        val totals = HashMap<String, Int>()
        for (app in topApps) {
            val pkg = app.packageName
            val cat = when {
                appCatMap.has(pkg) -> appCatMap.optString(pkg, "")
                overrides.has(pkg) -> overrides.optString(pkg, "")
                else -> ""
            }.let { Categories.migrate(it) }
            if (cat.isBlank()) continue
            totals[cat] = (totals[cat] ?: 0) + app.minutes
        }
        return totals.maxByOrNull { it.value }?.key ?: "Other"
    }

    // ── Serialise to JSON for the Coach JS side ───────────────────────────────

    fun toJson(summary: UsageSummary): String = JSONObject().apply {
        put("todayMinutes",       summary.todayMinutes)
        put("dailyGoalMinutes",   summary.dailyGoalMinutes)
        put("pickupsToday",       summary.pickupsToday)
        put("pickups7DayAvg",     summary.pickups7DayAvg)
        put("firstUseHour",       summary.firstUseHour)
        put("streakDays",         summary.streakDays)
        put("topCategory",        summary.topCategory)
        put("focusSessionsDone",  summary.focusSessionsCompleted)
        put("focusSessionsFail",  summary.focusSessionsInterrupted)
        put("daysSinceLastFocus", summary.daysSinceLastFocus)
        put("aureloScore",        summary.aureloScore)
        put("aureloScoreYesterday", summary.aureloScoreYesterday)
        put("hcConnected",        summary.hcConnected)
        put("dataWindowDays",     summary.dataWindowDays)
        // Pillar sub-scores — now sourced from UsageSummary (populated in build())
        put("screenScore",  summary.screenScore)
        put("focusScore",   summary.focusScore)
        put("sleepScore",   summary.sleepScore)
        put("bodyScore",   summary.bodyScore)
        // HC — use JSONObject.NULL for null Kotlin values
        put("hrvToday",           summary.hrvToday ?: JSONObject.NULL)
        put("hrv7DayAvg",         summary.hrv7DayAvg ?: JSONObject.NULL)
        put("stepsToday",         summary.stepsToday ?: JSONObject.NULL)
        put("steps7DayAvg",       summary.steps7DayAvg ?: JSONObject.NULL)
        put("sleepDurationMinutes", summary.sleepDurationMinutes ?: JSONObject.NULL)
        put("sleepDuration7DayAvg", summary.sleepDuration7DayAvg ?: JSONObject.NULL)
        put("restingHeartRate",   summary.restingHeartRate ?: JSONObject.NULL)
        put("rhr7DayAvg",         summary.rhr7DayAvg ?: JSONObject.NULL)
        put("externalMindfulnessMinutes", summary.externalMindfulnessMinutesToday ?: JSONObject.NULL)
    }.toString()

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun parseTopApps(json: String): List<AppUsageEntry> = runCatching {
        val arr = JSONArray(json)
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            AppUsageEntry(
                packageName = o.optString("pkg", ""),
                label       = o.optString("label", ""),
                minutes     = o.optInt("mins", 0),
            )
        }.sortedByDescending { it.minutes }
    }.getOrElse { emptyList() }

    private fun parseWeekly(json: String): List<DayRecord> = runCatching {
        val arr = JSONArray(json)
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            DayRecord(
                dateLabel = o.optString("date", ""),
                minutes   = o.optInt("total", 0),
            )
        }
    }.getOrElse { emptyList() }

    private fun weeklyAverage(json: String, days: Int): Float = runCatching {
        val arr = JSONArray(json)
        val values = (0 until minOf(arr.length(), days)).map { arr.getJSONObject(it).optInt("total", 0) }
        if (values.isEmpty()) 0f else values.average().toFloat()
    }.getOrElse { 0f }

    private fun daysSinceLastFocus(): Int {
        // FIX: use the exact timestamp now persisted by FocusSessionBridge so we
        // return real day counts (0/1/2/3/…) instead of jumping 0 → 7 → 14.
        val lastTs = prefs.getLong(KEY_FOCUS_LAST_COMPLETE_TS, 0L)
        if (lastTs > 0L) {
            val now = System.currentTimeMillis()
            if (now <= lastTs) return 0
            // Compare calendar days in the device's local timezone so a session
            // at 11pm last night reads as "1 day ago" the next morning, not "0".
            return calendarDayDelta(lastTs, now).coerceIn(0, 60)
        }

        // Legacy fallback for users who completed sessions before the timestamp
        // was introduced — keeps the old approximation but flagged for replacement
        // once the timestamp accumulates fresh data.
        val currentWeek = currentWeekId()
        val storedWeek  = prefs.getString(KEY_FOCUS_WEEK_ID, "") ?: ""
        val completedThisWeek = storedWeek == currentWeek &&
                prefs.getInt(KEY_FOCUS_COMPLETED_WEEK, 0) > 0

        if (!completedThisWeek) {
            val lastWeekCal = java.util.Calendar.getInstance()
            lastWeekCal.add(java.util.Calendar.WEEK_OF_YEAR, -1)
            val lastWeek = currentWeekId(lastWeekCal)
            return if (storedWeek == lastWeek &&
                prefs.getInt(KEY_FOCUS_COMPLETED_WEEK, 0) > 0) 7 else 14
        }

        val lastOutcome = prefs.getString(KEY_FOCUS_LAST_OUTCOME, "") ?: ""
        return if (lastOutcome == "completed" || lastOutcome == "in_progress") 0 else 1
    }

    /**
     * Number of calendar-day boundaries crossed between [olderTs] and [newerTs]
     * in the device's local timezone.
     */
    private fun calendarDayDelta(olderTs: Long, newerTs: Long): Int {
        if (olderTs <= 0L || newerTs <= olderTs) return 0
        val tz = java.util.TimeZone.getDefault()
        fun localMidnight(ts: Long): Long {
            val cal = java.util.Calendar.getInstance(tz).apply {
                timeInMillis = ts
                set(java.util.Calendar.HOUR_OF_DAY, 0)
                set(java.util.Calendar.MINUTE, 0)
                set(java.util.Calendar.SECOND, 0)
                set(java.util.Calendar.MILLISECOND, 0)
            }
            return cal.timeInMillis
        }
        val ms = localMidnight(newerTs) - localMidnight(olderTs)
        return (ms / 86_400_000L).toInt().coerceAtLeast(0)
    }

    // BUG-FIX: currentWeekId() was called but never defined in this class.
    // Mirrors the private helper in FocusSessionBridge / BedtimeBridge.
    private fun currentWeekId(): String =
        java.text.SimpleDateFormat("yyyy-'W'ww", java.util.Locale.US).format(java.util.Date())

    // Overload accepting a Calendar so daysSinceLastFocus() can check previous weeks.
    private fun currentWeekId(cal: java.util.Calendar): String =
        java.text.SimpleDateFormat("yyyy-'W'ww", java.util.Locale.US).format(cal.time)
}