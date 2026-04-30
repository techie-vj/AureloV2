package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// CoachBridge — JS interface for Aurelo Coach Phase 1.
// Exposes query counting (free/pro gate), daily insight for home tab,
// and contextual chip generation to the WebView layer.
// Business logic is handled by KotlinPatternDetector + InsightTemplateLibrary.
// ═══════════════════════════════════════════════════════════════════════════

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

class CoachBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: SharedPreferences,
    private val securePrefs: SharedPreferences,
    private val bridgeScope: CoroutineScope,
) {

    companion object {
        private const val KEY_COACH_QUERY_COUNT  = "coach_query_count"
        private const val KEY_COACH_QUERY_DATE   = "coach_query_date"
        private const val KEY_COACH_INSIGHT_JSON = "coach_daily_insight_json"
        private const val KEY_COACH_INSIGHT_DATE = "coach_daily_insight_date"
        // Per-day dismissed flag for the home insight card. Stored as YYYYMMDD
        // so it expires automatically when the day rolls over and the user
        // sees a fresh insight in the morning.
        private const val KEY_COACH_INSIGHT_DISMISSED_DATE = "coach_insight_dismissed_date"
        private const val KEY_TAB_INSIGHT_PREFIX = "tab_coach_insight_"
        private const val FREE_DAILY_LIMIT = 3
    }

    // ── Date helpers ─────────────────────────────────────────────────────────

    private fun todayKey(): String =
        SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())

    // ── Query count — free/pro gate ───────────────────────────────────────────

    /**
     * Returns JSON: { count: Int, limit: Int, date: String, limitReached: Boolean }
     * JS calls this before sending a query to check whether the free limit is reached.
     */
    @JavascriptInterface
    fun getCoachQueryCount(): String {
        val today = todayKey()
        val storedDate = prefs.getString(KEY_COACH_QUERY_DATE, "")
        val count = if (storedDate == today) prefs.getInt(KEY_COACH_QUERY_COUNT, 0) else 0
        return JSONObject().apply {
            put("count",        count)
            put("limit",        FREE_DAILY_LIMIT)
            put("date",         today)
            put("limitReached", count >= FREE_DAILY_LIMIT)
        }.toString()
    }

    /**
     * Increments today's query count.
     * Called by CoachUI.send() after every successful coach response.
     */
    @JavascriptInterface
    fun incrementCoachQueryCount() {
        val today = todayKey()
        val storedDate = prefs.getString(KEY_COACH_QUERY_DATE, "")
        val current = if (storedDate == today) prefs.getInt(KEY_COACH_QUERY_COUNT, 0) else 0
        prefs.edit()
            .putString(KEY_COACH_QUERY_DATE, today)
            .putInt(KEY_COACH_QUERY_COUNT, current + 1)
            .apply()
    }

    /**
     * Returns the pre-computed daily insight for the Home tab insight card.
     * JSON shape: { title: String, body: String, intent: String, hcBadge: Boolean }
     * Returns empty JSON object if no insight available yet.
     */
    @JavascriptInterface
    fun getDailyCoachInsight(): String {
        val today = todayKey()
        val insightDate = prefs.getString(KEY_COACH_INSIGHT_DATE, "")
        if (insightDate == today) {
            val cached = prefs.getString(KEY_COACH_INSIGHT_JSON, null)
            if (!cached.isNullOrBlank()) return cached
        }
        // Insight not yet computed for today — return empty so JS can show default
        return JSONObject().toString()
    }

    /**
     * Returns "1" when the user dismissed today's home insight card, "0"
     * otherwise. Mirrors the JS-side localStorage key
     * `coach_insight_dismissed_v1_YYYY-MM-DD` so dismissal state is consistent
     * between WebView storage and SharedPreferences.
     */
    @JavascriptInterface
    fun getCoachInsightDismissed(): String {
        val today = todayKey()
        val storedDate = prefs.getString(KEY_COACH_INSIGHT_DISMISSED_DATE, "") ?: ""
        return if (storedDate == today) "1" else "0"
    }

    /**
     * Marks today's home insight card as dismissed. The flag clears
     * automatically when the day rolls over.
     */
    @JavascriptInterface
    fun setCoachInsightDismissed() {
        prefs.edit()
            .putString(KEY_COACH_INSIGHT_DISMISSED_DATE, todayKey())
            .apply()
    }

    /**
     * Called by CoachInsightWorker to cache the day's computed insight.
     * [json] must match the shape expected by getDailyCoachInsight().
     */
    fun cacheDailyInsight(json: String) {
        prefs.edit()
            .putString(KEY_COACH_INSIGHT_DATE, todayKey())
            .putString(KEY_COACH_INSIGHT_JSON, json)
            .apply()
    }

    /**
     * Returns pre-generated contextual chips as a JSON array.
     * Shape: [{ label: String, intent: String }, …]
     * Chips are generated fresh each call using the latest prefs snapshot.
     * On error returns an empty array.
     */
    @JavascriptInterface
    fun getCoachChips(): String {
        return try {
            val chips = buildChips()
            chips.toString()
        } catch (e: Exception) {
            "[]"
        }
    }

    // ── Chip generation (mirrors ChipGenerator in app-coach.js) ──────────────

    private fun buildChips(): JSONArray {
        val arr = JSONArray()

        val todayMins  = prefs.getInt("cached_total_mins", 0)
        val goalMins   = prefs.getInt("streak_goal_mins", 240)
        val streak     = prefs.getInt("cached_streak_days", 0)
        val aureloScore         = prefs.getInt("cached_aurelo_score", 0)
        val aureloScoreYesterday = prefs.getInt("cached_aurelo_score_yesterday", 0)
        val daysSinceFocus = prefs.getInt("days_since_last_focus_cached", 3)
        val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        val pickupsToday = prefs.getInt("cached_pickups", 0)

        // FIX: zero-data fallback — fresh installs would otherwise only see the
        // day-of-week chip ("What's my Tuesday pattern?") which routes to a
        // GENERAL_SUMMARY response that has no data to summarise. Surface
        // onboarding-flavoured chips instead.
        if (aureloScore == 0 && todayMins == 0 && pickupsToday == 0) {
            arr.put(JSONObject().apply {
                put("label",  "What can Aurelo help me with?")
                put("intent", "FEATURE_EXPLANATION")
            })
            arr.put(JSONObject().apply {
                put("label",  "How does the score work?")
                put("intent", "FEATURE_EXPLANATION")
            })
            return arr
        }

        // Score drop chip
        if (aureloScoreYesterday - aureloScore > 4) {
            arr.put(JSONObject().apply {
                put("label",  "Why did my score drop ${aureloScoreYesterday - aureloScore} pts?")
                put("intent", "SCORE_DROP")
            })
        }

        // Streak at risk
        val rate      = if (hour > 0) todayMins.toFloat() / hour else 0f
        val projected = todayMins + rate * (24 - hour)
        if (projected > goalMins * 0.85f && streak > 3) {
            arr.put(JSONObject().apply {
                put("label",  "Is my ${streak}-day streak safe?")
                put("intent", "STREAK_AT_RISK")
            })
        }

        // Focus gap
        if (daysSinceFocus >= 3) {
            arr.put(JSONObject().apply {
                put("label",  "I haven't focused in a while — what should I do?")
                put("intent", "FOCUS_GAP")
            })
        }

        // Day-of-week default
        val days = arrayOf("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")
        val dayName = days[java.util.Calendar.getInstance().get(java.util.Calendar.DAY_OF_WEEK) - 1]
        arr.put(JSONObject().apply {
            put("label",  "What's my $dayName pattern?")
            put("intent", "GENERAL_SUMMARY")
        })

        return arr
    }

    /**
     * Returns a tab-specific coach insight. Caches per-tab per day (today/week)
     * or per calendar month (month).
     * [tab]         "today" | "week" | "month"
     * [contextJson] JSON assembled by JS from in-memory tab data (WEEKLY, MONTHLY_DATA, etc.)
     * Returns JSON: { title, body, intent, hcBadge, followUps: [] }
     * Always returns a usable response — fallback is built-in so Pro users always see something.
     */
    @JavascriptInterface
    fun getTabCoachInsight(tab: String, contextJson: String): String {
        val today = todayKey()
        val cacheKey = when (tab) {
            "week"  -> KEY_TAB_INSIGHT_PREFIX + "week_" + today
            "month" -> KEY_TAB_INSIGHT_PREFIX + "month_" +
                    java.text.SimpleDateFormat("yyyyMM", java.util.Locale.US).format(java.util.Date())
            else    -> KEY_TAB_INSIGHT_PREFIX + "today_" + today
        }

        // Return cached insight if still fresh for this period
        val cached = prefs.getString(cacheKey, null)
        if (!cached.isNullOrBlank()) return cached

        return try {
            val ctx = org.json.JSONObject(contextJson)

            // Build a natural-language query that steers the orchestrator toward
            // the most meaningful intent for this tab's actual data
            val query = buildTabQuery(tab, ctx)

            // Read Health Connect data (best-effort, non-blocking with timeout)
            val hcData: HCDailyData = runBlocking {
                val hcManager = HealthConnectManager(context)
                if (hcManager.isAvailable() && hcManager.hasAnyPermission()) {
                    try {
                        val repo = HealthConnectRepository(hcManager)
                        kotlinx.coroutines.withTimeoutOrNull(4_000) { repo.readDailyData() }
                            ?: HCDailyData(isAvailable = false)
                    } catch (_: Exception) { HCDailyData(isAvailable = false) }
                } else HCDailyData(isAvailable = false)
            }

            // FIX: drop the hard-coded 7-day window so the orchestrator can
            // surface ESTABLISHED-variant copy for users with 30+ days of data.
            val summary = UsageSummaryBuilder(context, prefs).build(hcData)
            val answer  = CoachOrchestrator(context).answer(query, summary)
            val result  = answer.toJson()

            prefs.edit().putString(cacheKey, result).apply()
            result

        } catch (e: Exception) {
            Log.e("CoachBridge", "getTabCoachInsight failed tab=$tab", e)
            // Guaranteed non-empty fallback so Pro users always see a card
            _tabFallback(tab)
        }
    }

    /**
     * Builds a natural-language query string from the JS-provided context JSON.
     * The query is designed so CoachOrchestrator picks a meaningful intent
     * (e.g. STREAK_AT_RISK, DOPAMINE_LOOP) rather than always GENERAL_SUMMARY.
     */
    private fun buildTabQuery(tab: String, ctx: org.json.JSONObject): String {
        return when (tab) {
            "week" -> {
                val weekTotal  = ctx.optInt("weekTotalMinutes", 0)
                val weekAvg    = ctx.optInt("weekAvgMinutes", 0)
                val goalMins   = ctx.optInt("goalMinutes", 240)
                val daysUnder  = ctx.optInt("daysUnder", 0)
                val tracked    = ctx.optInt("trackedDays", 7)
                val peakDay    = ctx.optString("peakDay", "")
                val peakMins   = ctx.optInt("peakDayMinutes", 0)
                val bestDay    = ctx.optString("bestDay", "")
                val topCat     = ctx.optString("topCategory", "")
                val trending   = if (weekAvg > goalMins) "over" else "under"

                "Weekly summary analysis: ${weekTotal}min total this week, ${weekAvg}min daily avg " +
                        "vs ${goalMins}min goal — averaging $trending goal. " +
                        "Hit goal $daysUnder/$tracked days. Heaviest: $peakDay (${peakMins}min). " +
                        "Lightest: $bestDay. Top category: $topCat. " +
                        "Give me a detailed weekly insight covering trends and what to focus on."
            }
            "month" -> {
                val monthTotal   = ctx.optInt("monthTotalMinutes", 0)
                val dailyAvg     = ctx.optInt("monthDailyAvg", 0)
                val goalMins     = ctx.optInt("goalMinutes", 240)
                val daysUnder    = ctx.optInt("daysUnder", 0)
                val tracked      = ctx.optInt("trackedDays", 0)
                val topCat       = ctx.optString("topCategory", "")
                val morningPct   = ctx.optInt("morningPct", 0)
                val lateNightPct = ctx.optInt("lateNightPct", 0)

                "Monthly overview: ${monthTotal}min this month, ${dailyAvg}min daily avg vs ${goalMins}min goal. " +
                        "Hit goal $daysUnder/$tracked days. Top category: $topCat. " +
                        "Morning: $morningPct%, late night: $lateNightPct%. " +
                        "Give me a comprehensive monthly insight about patterns, consistency, and improvements."
            }
            else -> {  // "today"
                val todayMins  = ctx.optInt("todayMinutes", 0)
                val goalMins   = ctx.optInt("goalMinutes", 240)
                val pickups    = ctx.optInt("pickupsToday", 0)
                val pickupsAvg = ctx.optInt("pickupsAvg", 60)
                val topApp     = ctx.optString("topApp", "")
                val peakHour   = ctx.optInt("peakHour", -1)
                val peakStr    = if (peakHour >= 0) "peak usage at ${peakHour}:00" else ""

                "Today's deep-dive: ${todayMins}min vs ${goalMins}min goal, $pickups pickups (avg $pickupsAvg). " +
                        "Top app: $topApp. $peakStr. " +
                        "Give me a detailed analysis of today's usage patterns."
            }
        }
    }

    /**
     * Guaranteed non-empty fallback for when orchestrator or HC fails.
     * Uses a rule-based insight derived directly from the context so users
     * always see something useful rather than an error state.
     */
    private fun _tabFallback(tab: String): String {
        // Pull raw values from prefs as a last-resort source of truth
        val todayMins = prefs.getInt("cached_total_mins", 0)
        val goalMins  = prefs.getInt("streak_goal_mins", 240)
        val streak    = prefs.getInt("cached_streak_days", 0)

        val (title, body) = when (tab) {
            "week" -> {
                val fmtGoal = if (goalMins >= 60) "${goalMins / 60}h ${goalMins % 60}m".trimEnd('m').trim() else "${goalMins}m"
                Pair(
                    "✦ This week at a glance",
                    "Your weekly data has been collected. Your daily goal is $fmtGoal — keep building the habit." +
                            if (streak > 0) " You're on a $streak-day streak — don't break it!" else ""
                )
            }
            "month" -> Pair(
                "✦ This month at a glance",
                "Your monthly patterns are taking shape. Check the calendar heatmap above to spot your best and worst days, then use Focus Mode to lock in improvement."
            )
            else -> {
                val overMin = todayMins - goalMins
                if (overMin > 0) Pair(
                    "✦ You're over your goal today",
                    "You've used ${todayMins}min today — ${overMin}min over your ${goalMins}min goal. " +
                            "A short focus session now can help you finish the day on a stronger note."
                ) else Pair(
                    "✦ Today's looking good",
                    "You've used ${todayMins}min today against a ${goalMins}min goal. " +
                            "Stay consistent — your streak and score update at midnight."
                )
            }
        }

        return JSONObject().apply {
            put("intent",   "GENERAL_SUMMARY")
            put("title",    title)
            put("body",     body)
            put("hcBadge",  false)
            put("followUps", org.json.JSONArray())
            put("usedFallback", true)
        }.toString()
    }

    /**
     * Clears today's and this week's tab insight caches.
     * Called from SettingsBridge when the user clears all data.
     * Month cache is intentionally preserved — it's slow to regenerate.
     */
    fun clearTabInsightCache() {
        val today = todayKey()
        prefs.edit()
            .remove(KEY_TAB_INSIGHT_PREFIX + "today_" + today)
            .remove(KEY_TAB_INSIGHT_PREFIX + "week_"  + today)
            .apply()
    }

    @JavascriptInterface
    fun askCoach(query: String): String {
        return try {
            Log.d("AureloCoach", "CoachBridge.askCoach called query=$query")
            val hcData: HCDailyData = runBlocking {
                val hcManager = HealthConnectManager(context)

                if (hcManager.isAvailable() && hcManager.hasAnyPermission()) {
                    try {
                        val repo = HealthConnectRepository(hcManager)

                        withTimeoutOrNull(5_000) {
                            repo.readDailyData()
                        } ?: HCDailyData(isAvailable = false)

                    } catch (_: Exception) {
                        HCDailyData(isAvailable = false)
                    }
                } else {
                    HCDailyData(isAvailable = false)
                }
            }

            val summary = UsageSummaryBuilder(context, prefs).build(hcData)

            CoachOrchestrator(context)
                .answer(query, summary)
                .toJson()

        } catch (e: Exception) {
            JSONObject().apply {
                put("intent", "GENERAL_SUMMARY")
                put("title", "Aurelo Coach")
                put("body", "I couldn't analyse that yet, but your coach is available.")
                put("hcBadge", false)
                put("followUps", JSONArray())
                put("usedFallback", true)
                put("source", "error")
            }.toString()
        }
    }
}