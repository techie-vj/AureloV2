package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// CoachBridge — JS interface for Aurelo Coach Phase 1.
// Exposes query counting (free/pro gate), daily insight for home tab,
// and contextual chip generation to the WebView layer.
// Business logic is handled by KotlinPatternDetector + InsightTemplateLibrary.
// ═══════════════════════════════════════════════════════════════════════════

import android.content.Context
import android.content.SharedPreferences
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CoachBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: SharedPreferences,
    private val securePrefs: SharedPreferences,
    private val bridgeScope: CoroutineScope,
) {

    companion object {
        private const val KEY_COACH_QUERY_COUNT = "coach_query_count"
        private const val KEY_COACH_QUERY_DATE  = "coach_query_date"
        private const val KEY_COACH_INSIGHT_JSON = "coach_daily_insight_json"
        private const val KEY_COACH_INSIGHT_DATE = "coach_daily_insight_date"
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
}
