package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// ScoreHistoryBridge — @JavascriptInterface bridge for streak history.
//
// v2.2 new bridge. Exposes:
//   AppBridge.saveStreakDay(date, screenOk, focusOk, bedtimeOk, bodyOk)
//     Called by SmartNotificationWorker (Kotlin) nightly — JS does NOT call this.
//     Exposed as @JavascriptInterface only as a fallback for JS-triggered saves.
//
//   AppBridge.getStreakHistory(days)
//     Returns JSON array of per-day streak data with cumulative counts.
//     Called by app-score-history.js to render the heatmap.
//
//   AppBridge.getBodyStreak()   → current Body streak count (Int)
//   AppBridge.getFocusStreak()  → current Focus streak count (Int)
//
//   AppBridge.getStepGoal()     → user-configured step goal (Int, default 8000)
//   AppBridge.saveStepGoal(n)   → persist step goal in EncryptedSharedPreferences
// ═══════════════════════════════════════════════════════════════════════════

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class ScoreHistoryBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
) : AppBridgeController {

    private val tracker get() = LaunchTracker.get(context)
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    // ── Step Goal ─────────────────────────────────────────────────────────────

    /**
     * Returns the user-configured daily step goal.
     * Stored in EncryptedSharedPreferences (HC is PRO, so securePrefs is appropriate).
     * Default: 8,000 steps.
     */
    @JavascriptInterface
    fun getStepGoal(): Int =
        securePrefs.getInt(HC_STEP_GOAL, BodyScoreCalculator.DEFAULT_STEP_GOAL)

    /**
     * Persists the user's daily step goal.
     * [goal] is clamped to [2000, 15000] per spec.
     */
    @JavascriptInterface
    fun saveStepGoal(goal: Int) {
        val clamped = goal.coerceIn(2_000, 15_000)
        securePrefs.edit().putInt(HC_STEP_GOAL, clamped).apply()
    }

    // ── Streak counts (current) ───────────────────────────────────────────────

    /**
     * Returns the current Body streak — number of consecutive days steps >= step goal,
     * walking back from the most recent row in streak_history.
     * N/A days (body_ok = -1, HC disconnected) are skipped without breaking the streak.
     */
    @JavascriptInterface
    fun getBodyStreak(): Int = tracker.getCurrentStreakForColumn("body_ok")

    /**
     * Returns the current Focus streak — consecutive days with any focus activity.
     * N/A days are skipped (future-proofing; Focus is always applicable).
     */
    @JavascriptInterface
    fun getFocusStreak(): Int = tracker.getCurrentStreakForColumn("focus_ok")

    // ── Full Streak History ───────────────────────────────────────────────────

    /**
     * Returns a JSON array of streak rows for the past [days] days, with
     * running cumulative streak counts computed per pillar.
     *
     * Shape (ascending date order):
     * [
     *   {
     *     date: "2025-05-01",
     *     screen:  { ok: 1,  count: 12 },
     *     focus:   { ok: 0,  count: 0  },
     *     bedtime: { ok: -1, count: 4  },   // -1 = N/A (feature off)
     *     body:    { ok: 1,  count: 7  }    // -1 = N/A (HC disconnected)
     *   }, …
     * ]
     *
     * ok values: 1 = maintained (green), 0 = missed (red), -1 = N/A (grey dash)
     * count: cumulative consecutive streak up to and including this day.
     *        N/A days don't reset the count.
     */
    @JavascriptInterface
    fun getStreakHistory(days: Int): String {
        val safeDays = days.coerceIn(7, 365)
        val rows = tracker.getStreakRows(safeDays)

        // Running cumulative streak counts — reset on missed (0), skip on N/A (-1)
        var screenCount  = 0
        var focusCount   = 0
        var bedtimeCount = 0
        var bodyCount    = 0

        val arr = JSONArray()
        for (row in rows) {
            screenCount  = nextCount(screenCount,  row.screenOk)
            focusCount   = nextCount(focusCount,   row.focusOk)
            bedtimeCount = nextCount(bedtimeCount, row.bedtimeOk)
            bodyCount    = nextCount(bodyCount,    row.bodyOk)

            arr.put(JSONObject().apply {
                put("date",    row.date)
                put("screen",  pillarObj(row.screenOk,  screenCount))
                put("focus",   pillarObj(row.focusOk,   focusCount))
                put("bedtime", pillarObj(row.bedtimeOk, bedtimeCount))
                put("body",    pillarObj(row.bodyOk,    bodyCount))
            })
        }
        return arr.toString()
    }

    /**
     * Upsert a streak row for the given date. Exposed as @JavascriptInterface
     * as a fallback; primary writer is SmartNotificationWorker (Kotlin-side).
     *
     * [date]       yyyy-MM-dd
     * [screenOk]   1 | 0 | -1
     * [focusOk]    1 | 0 | -1
     * [bedtimeOk]  1 | 0 | -1
     * [bodyOk]     1 | 0 | -1
     */
    @JavascriptInterface
    fun saveStreakDay(date: String, screenOk: Int, focusOk: Int, bedtimeOk: Int, bodyOk: Int) {
        // Basic date validation — reject obviously bad input
        if (!date.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) return
        tracker.saveStreakRow(date, screenOk, focusOk, bedtimeOk, bodyOk)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun nextCount(current: Int, ok: Int): Int = when (ok) {
        1    -> current + 1   // maintained — extend streak
        0    -> 0             // missed — reset
        else -> current       // N/A (-1) — don't change count
    }

    private fun pillarObj(ok: Int, count: Int): JSONObject =
        JSONObject().apply {
            put("ok",    ok)
            put("count", count)
        }
}
