package com.javikastudio.tidyapp

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/**
 * FocusSessionBridge — owns focus session lifecycle, state persistence,
 * weekly stats, and session outcome recording.
 * Phase 3: extracted from AppBridge.kt.
 *
 * FIX F-06: Added daily session counters (KEY_FOCUS_COMPLETED_TODAY,
 *           KEY_FOCUS_INTERRUPTED_TODAY, KEY_FOCUS_PLANNED_MINS_TODAY,
 *           KEY_FOCUS_ELAPSED_MINS_TODAY, KEY_FOCUS_DATE) so that the Focus
 *           Score's daily Aurelo composite uses today's data, not weekly data.
 *
 * FIX F-07: getFocusDailyStats() now returns plannedMins and elapsedMins so
 *           the JS layer can compute duration-weighted, partial-credit scores.
 *           A session interrupted at 89/90 min now contributes proportionally
 *           rather than being treated identically to a 2-minute bail.
 */
class FocusSessionBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    // ── Session state ─────────────────────────────────────────────────────────
    @JavascriptInterface
    fun getFocusSessionState(): String {
        val active = prefs.getBoolean(KEY_FOCUS_ACTIVE, false)
        val difficulty = prefs.getString(KEY_FOCUS_DIFFICULTY, "gentle") ?: "gentle"
        val endTs = prefs.getLong(KEY_FOCUS_END_TS, 0L)
        val remaining = if (active && endTs > 0) ((endTs - System.currentTimeMillis()) / 1000L).coerceAtLeast(0L).toInt() else 0

        if (active && endTs > 0 && System.currentTimeMillis() > endTs) {
            val plannedMins = prefs.getInt(KEY_FOCUS_LAST_TOTAL, 0)
            val existingOutcome = prefs.getString(KEY_FOCUS_LAST_OUTCOME, "") ?: ""
            if (existingOutcome != "completed") {
                _maybeResetWeeklyFocusStats()
                _maybeResetDailyFocusStats()
                prefs.edit()
                    .putInt(KEY_FOCUS_COMPLETED_WEEK, prefs.getInt(KEY_FOCUS_COMPLETED_WEEK,0)+1)
                    .putLong(KEY_FOCUS_TIME_WEEK_MINS, prefs.getLong(KEY_FOCUS_TIME_WEEK_MINS,0L)+plannedMins)
                    // F-06: also update daily counters
                    .putInt(KEY_FOCUS_COMPLETED_TODAY, prefs.getInt(KEY_FOCUS_COMPLETED_TODAY,0)+1)
                    .putInt(KEY_FOCUS_PLANNED_MINS_TODAY, prefs.getInt(KEY_FOCUS_PLANNED_MINS_TODAY,0)+plannedMins)
                    .putInt(KEY_FOCUS_ELAPSED_MINS_TODAY, prefs.getInt(KEY_FOCUS_ELAPSED_MINS_TODAY,0)+plannedMins)
                    .putString(KEY_FOCUS_LAST_OUTCOME, "completed")
                    .putInt(KEY_FOCUS_LAST_ELAPSED, plannedMins).apply()
                runCatching {
                    val dayIdx = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)-1
                    val existing = prefs.getString(KEY_FOCUS_WEEK_DAYS,"[false,false,false,false,false,false,false]") ?: "[false,false,false,false,false,false,false]"
                    val arr = JSONArray(existing); arr.put(dayIdx, true); prefs.edit().putString(KEY_FOCUS_WEEK_DAYS, arr.toString()).apply()
                }
            }
            _clearFocusSession()
            return JSONObject().apply { put("active",false); put("difficulty","gentle"); put("remainingSecs",0); put("blockedApps",JSONArray()) }.toString()
        }

        val blockedApps = try { JSONArray(prefs.getString(KEY_FOCUS_BLOCKED_APPS,"[]")?:"[]") } catch (_:Exception) { JSONArray() }
        return JSONObject().apply {
            put("active", active); put("difficulty", difficulty); put("remainingSecs", remaining)
            put("totalSecs", prefs.getInt(KEY_FOCUS_LAST_TOTAL,0)*60L)
            put("blockedApps", blockedApps); put("activeRoutineId", prefs.getString(KEY_FOCUS_ACTIVE_ROUTINE,"")?:"")
        }.toString()
    }

    @JavascriptInterface
    fun startFocusSession(blockedAppsJson: String, durationMins: Int, difficulty: String) {
        if (durationMins < 1 || durationMins > 480) return
        if (difficulty !in setOf("gentle","firm","deep")) return
        val pkgArr = try { JSONArray(blockedAppsJson) } catch (_:Exception) { return }
        val pm = context.packageManager
        val appsArr = JSONArray()
        for (i in 0 until pkgArr.length()) {
            val obj = pkgArr.optJSONObject(i)
            val pkg = (obj?.optString("packageName") ?: pkgArr.optString(i))
                .takeIf { it.isNotBlank() } ?: continue
            runCatching {
                val info = pm.getApplicationInfo(pkg, 0)
                val name = obj?.optString("name")?.takeIf { it.isNotBlank() }
                    ?: pm.getApplicationLabel(info).toString()
                appsArr.put(JSONObject().apply { put("packageName", pkg); put("name", name) })
            }
        }
        if (appsArr.length() == 0) return
        val endTs = System.currentTimeMillis() + durationMins * 60_000L
        prefs.edit()
            .putBoolean(KEY_FOCUS_ACTIVE, true).putString(KEY_FOCUS_DIFFICULTY, difficulty)
            .putLong(KEY_FOCUS_END_TS, endTs).putString(KEY_FOCUS_BLOCKED_APPS, appsArr.toString())
            .putInt(KEY_FOCUS_LAST_TOTAL, durationMins).putString(KEY_FOCUS_LAST_OUTCOME, "in_progress").apply()
        runCatching {
            val ping = Intent(context, AppMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(ping) else context.startService(ping)
            val intent = Intent(context, AppMonitorService::class.java).apply {
                action = AppMonitorService.ACTION_FOCUS_START
                putExtra("difficulty",difficulty); putExtra("durationMins",durationMins); putExtra("blockedApps",appsArr.toString()); putExtra("endTs",endTs)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        }
    }

    @JavascriptInterface
    fun stopFocusSession() {
        val endTs = prefs.getLong(KEY_FOCUS_END_TS, 0L); val now = System.currentTimeMillis()
        val existing = prefs.getString(KEY_FOCUS_LAST_OUTCOME,"") ?: ""
        val plannedMins = prefs.getInt(KEY_FOCUS_LAST_TOTAL, 0)
        val routineId = prefs.getString(KEY_FOCUS_ACTIVE_ROUTINE,"") ?: ""
        if (existing != "completed" && existing != "interrupted") {
            _maybeResetWeeklyFocusStats()
            _maybeResetDailyFocusStats()
            if (endTs > 0 && now >= endTs) {
                prefs.edit()
                    .putInt(KEY_FOCUS_COMPLETED_WEEK, prefs.getInt(KEY_FOCUS_COMPLETED_WEEK,0)+1)
                    .putLong(KEY_FOCUS_TIME_WEEK_MINS, prefs.getLong(KEY_FOCUS_TIME_WEEK_MINS,0L)+plannedMins)
                    // F-06: daily counters
                    .putInt(KEY_FOCUS_COMPLETED_TODAY, prefs.getInt(KEY_FOCUS_COMPLETED_TODAY,0)+1)
                    .putInt(KEY_FOCUS_PLANNED_MINS_TODAY, prefs.getInt(KEY_FOCUS_PLANNED_MINS_TODAY,0)+plannedMins)
                    .putInt(KEY_FOCUS_ELAPSED_MINS_TODAY, prefs.getInt(KEY_FOCUS_ELAPSED_MINS_TODAY,0)+plannedMins)
                    .putString(KEY_FOCUS_LAST_OUTCOME,"completed").putInt(KEY_FOCUS_LAST_ELAPSED, plannedMins).apply()
                runCatching {
                    val dayIdx = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)-1
                    val arr = JSONArray(prefs.getString(KEY_FOCUS_WEEK_DAYS,"[false,false,false,false,false,false,false]")?:"[false,false,false,false,false,false,false]")
                    arr.put(dayIdx,true); prefs.edit().putString(KEY_FOCUS_WEEK_DAYS, arr.toString()).apply()
                }
            } else if (endTs > 0) {
                val elapsedMins = ((now - (endTs - plannedMins*60_000L))/60_000L).coerceAtLeast(1L).toInt()
                prefs.edit()
                    .putInt(KEY_FOCUS_INTERRUPTED_WEEK, prefs.getInt(KEY_FOCUS_INTERRUPTED_WEEK,0)+1)
                    .putLong(KEY_FOCUS_TIME_WEEK_MINS, prefs.getLong(KEY_FOCUS_TIME_WEEK_MINS,0L)+elapsedMins)
                    // F-06: daily counters for interrupted sessions
                    .putInt(KEY_FOCUS_INTERRUPTED_TODAY, prefs.getInt(KEY_FOCUS_INTERRUPTED_TODAY,0)+1)
                    .putInt(KEY_FOCUS_PLANNED_MINS_TODAY, prefs.getInt(KEY_FOCUS_PLANNED_MINS_TODAY,0)+plannedMins)
                    .putInt(KEY_FOCUS_ELAPSED_MINS_TODAY, prefs.getInt(KEY_FOCUS_ELAPSED_MINS_TODAY,0)+elapsedMins)
                    .putString(KEY_FOCUS_LAST_OUTCOME,"interrupted").putInt(KEY_FOCUS_LAST_ELAPSED, elapsedMins).apply()
            }
        }
        _clearFocusSession()
        runCatching {
            val intent = Intent(context, AppMonitorService::class.java).apply { action = AppMonitorService.ACTION_FOCUS_STOP }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        }
        val escapedId = routineId.replace("'","\\'")
        (context as? Activity)?.runOnUiThread {
            webView.evaluateJavascript("if(typeof window.onFocusSessionEnded==='function') window.onFocusSessionEnded('$escapedId')", null)
        }
    }

    @JavascriptInterface
    fun updateFocusSession(blockedAppsJson: String, newEndTs: Long, difficulty: String) {
        if (!prefs.getBoolean(KEY_FOCUS_ACTIVE, false)) return
        if (difficulty !in setOf("gentle","firm","deep")) return
        runCatching { JSONArray(blockedAppsJson) }.onFailure { return }
        prefs.edit().putString(KEY_FOCUS_DIFFICULTY,difficulty).putLong(KEY_FOCUS_END_TS,newEndTs).putString(KEY_FOCUS_BLOCKED_APPS,blockedAppsJson).apply()
        runCatching {
            val intent = Intent(context, AppMonitorService::class.java).apply { action = AppMonitorService.ACTION_FOCUS_UPDATE; putExtra("difficulty",difficulty); putExtra("endTs",newEndTs); putExtra("blockedApps",blockedAppsJson) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        }
    }

    @JavascriptInterface
    fun updateFocusTimer(newDurationMins: Int) {
        if (newDurationMins < 1 || newDurationMins > 120) return
        val difficulty = prefs.getString(KEY_FOCUS_DIFFICULTY,"gentle") ?: "gentle"
        val blockedApps = prefs.getString(KEY_FOCUS_BLOCKED_APPS,"[]") ?: "[]"
        val newEndTs = System.currentTimeMillis() + newDurationMins*60_000L
        prefs.edit().putInt(KEY_FOCUS_LAST_TOTAL, newDurationMins).apply()
        updateFocusSession(blockedApps, newEndTs, difficulty)
    }

    // ── Weekly stats ──────────────────────────────────────────────────────────
    @JavascriptInterface
    fun getFocusStats(): String {
        _maybeResetWeeklyFocusStats()
        return JSONObject().apply {
            put("completed", prefs.getInt(KEY_FOCUS_COMPLETED_WEEK,0))
            put("interrupted", prefs.getInt(KEY_FOCUS_INTERRUPTED_WEEK,0))
            put("totalMins", prefs.getLong(KEY_FOCUS_TIME_WEEK_MINS,0L))
        }.toString()
    }

    // ── Daily stats — F-06, F-07 ─────────────────────────────────────────────
    // Returns today-only session data for use in the daily Aurelo Score Focus pillar.
    // Includes plannedMins and elapsedMins for duration-weighted scoring (F-07).
    @JavascriptInterface
    fun getFocusDailyStats(): String {
        _maybeResetDailyFocusStats()
        val completedToday   = prefs.getInt(KEY_FOCUS_COMPLETED_TODAY, 0)
        val interruptedToday = prefs.getInt(KEY_FOCUS_INTERRUPTED_TODAY, 0)
        val plannedMins      = prefs.getInt(KEY_FOCUS_PLANNED_MINS_TODAY, 0)
        val elapsedMins      = prefs.getInt(KEY_FOCUS_ELAPSED_MINS_TODAY, 0)
        val totalSessions    = completedToday + interruptedToday
        return JSONObject().apply {
            put("completedToday",   completedToday)
            put("interruptedToday", interruptedToday)
            put("totalSessions",    totalSessions)
            put("plannedMins",      plannedMins)
            put("elapsedMins",      elapsedMins)
        }.toString()
    }

    @JavascriptInterface
    fun getFocusWeekDays(): String {
        _maybeResetWeeklyFocusStats()
        return prefs.getString(KEY_FOCUS_WEEK_DAYS,"[false,false,false,false,false,false,false]") ?: "[false,false,false,false,false,false,false]"
    }

    @JavascriptInterface
    fun getAndClearLastFocusOutcome(): String {
        if (prefs.getBoolean(KEY_FOCUS_ACTIVE, false)) return JSONObject().apply { put("outcome","") }.toString()
        var outcome = prefs.getString(KEY_FOCUS_LAST_OUTCOME,"") ?: ""
        val elapsed = prefs.getInt(KEY_FOCUS_LAST_ELAPSED, 0); val total = prefs.getInt(KEY_FOCUS_LAST_TOTAL, 0)
        if (outcome == "in_progress") {
            val endTs = prefs.getLong(KEY_FOCUS_END_TS, 0L); val now = System.currentTimeMillis()
            outcome = if (endTs == 0L || now >= endTs) "completed" else "interrupted"
            if (outcome == "completed" && total > 0) {
                _maybeResetWeeklyFocusStats()
                _maybeResetDailyFocusStats()
                prefs.edit().putInt(KEY_FOCUS_COMPLETED_WEEK,prefs.getInt(KEY_FOCUS_COMPLETED_WEEK,0)+1)
                    .putLong(KEY_FOCUS_TIME_WEEK_MINS,prefs.getLong(KEY_FOCUS_TIME_WEEK_MINS,0L)+total)
                    .putInt(KEY_FOCUS_COMPLETED_TODAY,prefs.getInt(KEY_FOCUS_COMPLETED_TODAY,0)+1)
                    .putInt(KEY_FOCUS_PLANNED_MINS_TODAY,prefs.getInt(KEY_FOCUS_PLANNED_MINS_TODAY,0)+total)
                    .putInt(KEY_FOCUS_ELAPSED_MINS_TODAY,prefs.getInt(KEY_FOCUS_ELAPSED_MINS_TODAY,0)+total)
                    .putInt(KEY_FOCUS_LAST_ELAPSED,total).apply()
            }
        }
        if (outcome != "completed" && outcome != "interrupted") return JSONObject().apply { put("outcome","") }.toString()
        prefs.edit().putString(KEY_FOCUS_LAST_OUTCOME,"").apply()
        return JSONObject().apply { put("outcome",outcome); put("elapsedMins",if(elapsed>0) elapsed else total); put("totalMins",total) }.toString()
    }

    @JavascriptInterface fun recordFocusComplete(durationMins: Int) {
        _maybeResetWeeklyFocusStats()
        _maybeResetDailyFocusStats()
        prefs.edit()
            .putInt(KEY_FOCUS_COMPLETED_WEEK, prefs.getInt(KEY_FOCUS_COMPLETED_WEEK,0)+1)
            .putLong(KEY_FOCUS_TIME_WEEK_MINS, prefs.getLong(KEY_FOCUS_TIME_WEEK_MINS,0L)+durationMins)
            .putInt(KEY_FOCUS_COMPLETED_TODAY, prefs.getInt(KEY_FOCUS_COMPLETED_TODAY,0)+1)
            .putInt(KEY_FOCUS_PLANNED_MINS_TODAY, prefs.getInt(KEY_FOCUS_PLANNED_MINS_TODAY,0)+durationMins)
            .putInt(KEY_FOCUS_ELAPSED_MINS_TODAY, prefs.getInt(KEY_FOCUS_ELAPSED_MINS_TODAY,0)+durationMins)
            .putString(KEY_FOCUS_LAST_OUTCOME,"completed").putInt(KEY_FOCUS_LAST_ELAPSED,durationMins).putInt(KEY_FOCUS_LAST_TOTAL,durationMins).apply()
    }

    @JavascriptInterface fun recordFocusInterrupt(elapsedMins: Int) {
        val plannedMins = prefs.getInt(KEY_FOCUS_LAST_TOTAL, elapsedMins)
        _maybeResetWeeklyFocusStats()
        _maybeResetDailyFocusStats()
        prefs.edit()
            .putInt(KEY_FOCUS_INTERRUPTED_WEEK, prefs.getInt(KEY_FOCUS_INTERRUPTED_WEEK,0)+1)
            .putLong(KEY_FOCUS_TIME_WEEK_MINS, prefs.getLong(KEY_FOCUS_TIME_WEEK_MINS,0L)+elapsedMins)
            .putInt(KEY_FOCUS_INTERRUPTED_TODAY, prefs.getInt(KEY_FOCUS_INTERRUPTED_TODAY,0)+1)
            .putInt(KEY_FOCUS_PLANNED_MINS_TODAY, prefs.getInt(KEY_FOCUS_PLANNED_MINS_TODAY,0)+plannedMins)
            .putInt(KEY_FOCUS_ELAPSED_MINS_TODAY, prefs.getInt(KEY_FOCUS_ELAPSED_MINS_TODAY,0)+elapsedMins)
            .putString(KEY_FOCUS_LAST_OUTCOME,"interrupted").putInt(KEY_FOCUS_LAST_ELAPSED,elapsedMins).apply()
    }

    @JavascriptInterface fun getFocusBlockedApps(): String = prefs.getString(KEY_FOCUS_BLOCKED_APPS,"[]") ?: "[]"

    @JavascriptInterface fun saveFocusBlockedApps(json: String) {
        runCatching { JSONArray(json) }.onFailure { return }
        prefs.edit().putString(KEY_FOCUS_BLOCKED_APPS, json).apply()
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    internal fun _maybeResetWeeklyFocusStats() {
        val stored = prefs.getString(KEY_FOCUS_WEEK_ID,"") ?: ""; val current = currentWeekId()
        if (stored != current) prefs.edit()
            .putString(KEY_FOCUS_WEEK_ID,current).putInt(KEY_FOCUS_COMPLETED_WEEK,0)
            .putInt(KEY_FOCUS_INTERRUPTED_WEEK,0).putLong(KEY_FOCUS_TIME_WEEK_MINS,0L)
            .putString(KEY_FOCUS_WEEK_DAYS,"[false,false,false,false,false,false,false]").apply()
    }

    // F-06: Reset daily stats at midnight (date change)
    internal fun _maybeResetDailyFocusStats() {
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val stored = prefs.getString(KEY_FOCUS_DATE, "") ?: ""
        if (stored != today) {
            prefs.edit()
                .putString(KEY_FOCUS_DATE, today)
                .putInt(KEY_FOCUS_COMPLETED_TODAY, 0)
                .putInt(KEY_FOCUS_INTERRUPTED_TODAY, 0)
                .putInt(KEY_FOCUS_PLANNED_MINS_TODAY, 0)
                .putInt(KEY_FOCUS_ELAPSED_MINS_TODAY, 0)
                .apply()
        }
    }

    private fun _clearFocusSession() {
        prefs.edit()
            .putBoolean(KEY_FOCUS_ACTIVE,false).putLong(KEY_FOCUS_END_TS,0L)
            .remove(KEY_FOCUS_DIFFICULTY).remove(KEY_FOCUS_BLOCKED_APPS)
            .putString(KEY_FOCUS_ACTIVE_ROUTINE,"").apply()
    }

    internal fun currentWeekId(): String = SimpleDateFormat("yyyy-'W'ww", Locale.US).format(Date())

    companion object {
        // F-06: new daily stat keys
        const val KEY_FOCUS_DATE              = "focus_date_v1"
        const val KEY_FOCUS_COMPLETED_TODAY   = "focus_completed_today"
        const val KEY_FOCUS_INTERRUPTED_TODAY = "focus_interrupted_today"
        const val KEY_FOCUS_PLANNED_MINS_TODAY = "focus_planned_mins_today"
        const val KEY_FOCUS_ELAPSED_MINS_TODAY = "focus_elapsed_mins_today"
    }
}
