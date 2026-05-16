package com.javikastudio.tidyapp

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import kotlinx.coroutines.CoroutineScope

/**
 * UsageStatsBridge — owns all UsageStats queries, caching, streak calculation,
 * smart tips, discover, and ghost-app detection.
 * Phase 3: extracted from AppBridge.kt.
 */
class UsageStatsBridge(
    private val context: Context,
    private val webView: WebView,
    internal val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val pm: PackageManager,
    private val appManagement: AppManagementBridge   // needed for isUserApp / hiddenSet
) : AppBridgeController {

    // ── Fast cache getters ────────────────────────────────────────────────────
    @JavascriptInterface fun getCachedDailyUsage(): String = prefs.getString(CACHED_DAILY_USAGE, "[]") ?: "[]"
    @JavascriptInterface fun getCachedWeeklyData(): String = prefs.getString(CACHED_WEEKLY, "[]") ?: "[]"
    @JavascriptInterface fun getCachedHourly():     String = prefs.getString(CACHED_HOURLY, "[]") ?: "[]"
    @JavascriptInterface fun getCachedTotalMins():   Long  = prefs.getLong(CACHED_TOTAL_MINS, 0L)
    @JavascriptInterface fun getCachedPickupCount(): Int   = prefs.getInt(CACHED_PICKUPS, 0)

    // ── Live getters (triggers queryEvents) ──────────────────────────────────
    @JavascriptInterface fun getDailyUsageStats():     String { if (!hasUsagePermission()) return "[]"; return buildDailyUsageStats().also { prefs.edit().putString(CACHED_DAILY_USAGE, it).apply() } }
    @JavascriptInterface fun getWeeklyBreakdown():     String { if (!hasUsagePermission()) return "[]"; return buildWeeklyBreakdown().also     { prefs.edit().putString(CACHED_WEEKLY, it).apply() } }
    @JavascriptInterface fun getHourlyBreakdownToday():String { if (!hasUsagePermission()) return "[]"; return buildHourlyBreakdown().also    { prefs.edit().putString(CACHED_HOURLY, it).apply() } }

    @JavascriptInterface fun getTotalScreenTimeToday(): Long {
        if (!hasUsagePermission()) return -1L
        val cached = prefs.getLong(CACHED_TOTAL_MINS, -1L)
        if (cached >= 0L) return cached
        return try {
            val arr = JSONArray(prefs.getString(CACHED_DAILY_USAGE, "[]") ?: "[]")
            (0 until arr.length()).sumOf { arr.getJSONObject(it).optLong("totalMinutes", 0) }
        } catch (_: Exception) { 0L }
    }

    @JavascriptInterface fun getFirstPickupTime(): String {
        if (!hasUsagePermission()) return "–"
        val ts = prefs.getLong(CACHED_FIRST_PICKUP_TS, -1L)
        if (ts > 0L) {
            val cal = Calendar.getInstance().apply { timeInMillis = ts }
            val h = cal.get(Calendar.HOUR_OF_DAY); val m = cal.get(Calendar.MINUTE)
            return "${if (h % 12 == 0) 12 else h % 12}:${m.toString().padStart(2, '0')} ${if (h >= 12) "PM" else "AM"}"
        }
        return "–"
    }

    @JavascriptInterface fun getPickupCountToday(): Int {
        if (!hasUsagePermission()) return -1
        val cached = prefs.getInt(CACHED_PICKUPS, -1)
        return if (cached >= 0) cached else 0
    }

    @JavascriptInterface fun getStreakDays(): Int = getStreakDaysForGoal(prefs.getInt(STREAK_GOAL_MINS, 240))
    @JavascriptInterface fun getStreakDays(goalMinutes: Int): Int = getStreakDaysForGoal(goalMinutes)

    @JavascriptInterface fun refreshUsageData(): String {
        if (!hasUsagePermission()) return "{}"
        val snapshot = buildUsageSnapshot()
        prefs.edit()
            .putString(CACHED_DAILY_USAGE,    snapshot.optString("topAppsJson", "[]"))
            .putString(CACHED_HOURLY,         snapshot.optString("hourlyJson",  "[]"))
            .putLong  (CACHED_TOTAL_MINS,     snapshot.optLong  ("totalMins",  0L))
            .putInt   (CACHED_PICKUPS,        snapshot.optInt   ("pickups",    0))
            .putLong  (CACHED_FIRST_PICKUP_TS,snapshot.optLong  ("firstPickupTs", 0L))
            .apply()
        return snapshot.toString()
    }

    // ── Weekly app usage ──────────────────────────────────────────────────────
    @Suppress("DEPRECATION")
    @JavascriptInterface fun getWeeklyAppUsage(): String {
        if (!hasUsagePermission()) return "[]"
        return try {
            val now = System.currentTimeMillis(); val weekStart = now - 7L * 86_400_000L
            val events = usm().queryEvents(weekStart, now)
            val ev = UsageEvents.Event()
            val timeMap = mutableMapOf<String, Long>(); val fgStart = mutableMapOf<String, Long>()
            val MAX_MS = 4 * 60 * 60_000L
            while (events.hasNextEvent()) {
                events.getNextEvent(ev)
                if (ev.packageName == context.packageName) continue
                when (ev.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND -> fgStart[ev.packageName] = ev.timeStamp
                    UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                        val start = fgStart.remove(ev.packageName) ?: continue
                        val ms = (ev.timeStamp - start).coerceAtMost(MAX_MS)
                        if (isKnownUserPackage(ev.packageName)) timeMap[ev.packageName] = (timeMap[ev.packageName] ?: 0L) + ms
                    }
                }
            }
            fgStart.forEach { (pkg, start) -> if (isKnownUserPackage(pkg)) { val ms = (now - start).coerceAtMost(MAX_MS); timeMap[pkg] = (timeMap[pkg] ?: 0L) + ms } }
            val arr = JSONArray()
            timeMap.entries.filter { it.value > 60_000L }.sortedByDescending { it.value }.forEach { (pkg, ms) ->
                runCatching { val info = pm.getApplicationInfo(pkg, 0); arr.put(JSONObject().apply { put("packageName", pkg); put("name", pm.getApplicationLabel(info).toString()); put("iconUrl","app-icon://$pkg"); put("weeklyMinutes", ms / 60_000L) }) }
            }
            arr.toString()
        } catch (_: Exception) { "[]" }
    }

    // ── Monthly breakdowns ────────────────────────────────────────────────────
    // FIX: all four monthly getters now check that the cached data belongs to the
    // current calendar month before serving it. Previously, April's cache would be
    // returned for the entire month of May (until the background refresh ran).
    private fun isMonthCacheValid(): Boolean {
        val cached = prefs.getString(CACHED_MONTHLY_BREAKDOWN, null)
        if (cached.isNullOrEmpty() || cached == "[]") return false
        val cachedMonth = prefs.getInt(CACHED_MONTHLY_MONTH, -1)
        return cachedMonth == Calendar.getInstance().get(Calendar.MONTH)
    }

    @JavascriptInterface fun getMonthlyBreakdown(): String {
        if (isMonthCacheValid()) return prefs.getString(CACHED_MONTHLY_BREAKDOWN, "[]") ?: "[]"
        if (!hasUsagePermission()) return "[]"
        return try { val s = buildMonthlySnapshot(); saveMonthlySnapshot(s); s[0] } catch (_: Exception) { "[]" }
    }

    @JavascriptInterface fun getMonthlyPickupBreakdown(): String {
        if (isMonthCacheValid()) return prefs.getString(CACHED_MONTHLY_PICKUPS, "[]") ?: "[]"
        if (!hasUsagePermission()) return "[]"
        return try { val s = buildMonthlySnapshot(); saveMonthlySnapshot(s); s[1] } catch (_: Exception) { "[]" }
    }

    @JavascriptInterface fun getMonthlyHourlyBreakdown(): String {
        if (isMonthCacheValid()) return prefs.getString(CACHED_MONTHLY_HOURLY, "[]") ?: "[]"
        if (!hasUsagePermission()) return "[]"
        return try { val s = buildMonthlySnapshot(); saveMonthlySnapshot(s); s[2] } catch (_: Exception) { "[]" }
    }

    @JavascriptInterface fun getMonthlyAppUsage(): String {
        if (isMonthCacheValid()) return prefs.getString(CACHED_MONTHLY_APP_USAGE, "[]") ?: "[]"
        if (!hasUsagePermission()) return "[]"
        return try { val s = buildMonthlySnapshot(); saveMonthlySnapshot(s); s[3] } catch (_: Exception) { "[]" }
    }

    private fun saveMonthlySnapshot(s: Array<String>) {
        prefs.edit()
            .putString(CACHED_MONTHLY_BREAKDOWN, s[0])
            .putString(CACHED_MONTHLY_PICKUPS,   s[1])
            .putString(CACHED_MONTHLY_HOURLY,    s[2])
            .putString(CACHED_MONTHLY_APP_USAGE, s[3])
            .putLong  (CACHED_MONTHLY_TS,    System.currentTimeMillis())
            .putInt   (CACHED_MONTHLY_MONTH, Calendar.getInstance().get(Calendar.MONTH)) // FIX: stamp month for cache-validity check
            .apply()
    }

    // ── Ghost apps ────────────────────────────────────────────────────────────
    @JavascriptInterface fun getCachedGhosts(): String = prefs.getString(CACHED_GHOSTS, "[]") ?: "[]"

    @JavascriptInterface fun getGhostApps(days: Int): String {
        if (!hasUsagePermission()) return "[]"
        val now = System.currentTimeMillis(); val lastScan = prefs.getLong(CACHED_GHOSTS_TS, 0L)
        val cached = prefs.getString(CACHED_GHOSTS, null)
        if (cached != null && now - lastScan < 24 * 60 * 60_000L) return cached
        return buildGhostApps(days).also { prefs.edit().putString(CACHED_GHOSTS, it).putLong(CACHED_GHOSTS_TS, now).apply() }
    }

    @JavascriptInterface fun forceGetGhostApps(days: Int): String {
        if (!hasUsagePermission()) return "[]"
        val now = System.currentTimeMillis()
        return buildGhostApps(days).also { prefs.edit().putString(CACHED_GHOSTS, it).putLong(CACHED_GHOSTS_TS, now).apply() }
    }

    // ── Smart tips ────────────────────────────────────────────────────────────
    @JavascriptInterface fun getSmartTips(): String {
        val tips = JSONArray()
        if (!hasUsagePermission()) {
            tips.put(j("icon","💡","title","Enable Usage Access","body","Grant permission to get personalized insights based on your real app usage.","type","info")); return tips.toString()
        }
        val todayMins = getTotalScreenTimeToday(); val pickups = getPickupCountToday()
        val daily = JSONArray(getCachedDailyUsage())
        val goalMins = prefs.getInt(STREAK_GOAL_MINS, 240).toLong()
        if (daily.length() > 0) {
            val top = daily.getJSONObject(0); val appMins = top.getLong("totalMinutes"); val appName = top.getString("name")
            val pct = if (todayMins > 0) (appMins * 100 / todayMins).toInt() else 0
            when {
                pct > 60 && appMins > 60 -> tips.put(j("icon","📱","title","$appName takes up ${pct}% of screen time","body","${fmtM(appMins)} on $appName today — more than half your total phone use. Setting a limit can help.","type","warn"))
                appMins > 120 -> tips.put(j("icon","📱","title","Heavy $appName usage","body","You've spent ${fmtM(appMins)} in $appName today. Try scheduling specific times instead of frequent short visits.","type","info"))
            }
        }
        when {
            pickups > 80 -> tips.put(j("icon","📲","title","${pickups} phone pickups today","body","That's nearly once every few minutes. Try leaving your phone face-down or in another room.","type","warn"))
            pickups > 40 -> tips.put(j("icon","🔔","title","${pickups} phone checks","body","Frequent checking breaks focus. Try batching your phone use to every 30 minutes.","type","info"))
            pickups in 1..20 -> tips.put(j("icon","✅","title","Great pickup discipline","body","Only ${pickups} phone pickups today — you're using your phone intentionally!","type","success"))
        }
        when {
            todayMins > goalMins * 2 -> tips.put(j("icon","🔴","title","Screen time is very high","body","At ${fmtM(todayMins)}, you're over 2× your daily goal. Put it down and don't pick it up for the next hour.","type","warn"))
            todayMins > goalMins     -> tips.put(j("icon","⚠️","title","Daily goal exceeded","body","${fmtM(todayMins)} used vs your ${fmtM(goalMins)} goal. Finish the day strong by avoiding social apps.","type","warn"))
            todayMins in 1..goalMins -> tips.put(j("icon","🎯","title","On track today","body","${fmtM(todayMins)} used with ${fmtM(goalMins - todayMins)} remaining under your goal. Keep it up!","type","success"))
        }
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        if (hour >= 21 && daily.length() > 0) {
            val socialMins = (0 until daily.length()).map { daily.getJSONObject(it) }
                .filter { listOf("instagram","tiktok","twitter","youtube","facebook","reddit","snapchat").any { kw -> it.getString("name").lowercase().contains(kw) } }
                .sumOf { it.getLong("totalMinutes") }
            if (socialMins > 30) tips.put(j("icon","🌙","title","Evening wind-down tip","body","${fmtM(socialMins)} on social/video apps today. Blue light before bed disrupts sleep — try airplane mode from 10pm.","type","info"))
        }
        val streak = getStreakDays(goalMins.toInt())
        when {
            streak >= 7 -> tips.put(j("icon","🔥","title","${streak}-day streak — impressive!","body","$streak consecutive days under your screen time goal. You're building a lasting habit!","type","success"))
            streak in 3..6 -> tips.put(j("icon","🔥","title","${streak}-day streak","body","${7-streak} more days to hit a full week under your goal. Don't break it!","type","success"))
            streak == 0 -> tips.put(j("icon","💪","title","Start a new streak today","body","Stay under ${fmtM(goalMins)} today to kick off a streak. Day 1 is the most important.","type","info"))
        }
        return tips.toString()
    }

    // ── Background refresh (called from bgExecutor — NOT @JavascriptInterface) ─
    fun refreshUsageStats() {
        if (!hasUsagePermission()) return
        if (!RefreshCoordinator.tryBeginRefresh("usage-bridge", minIntervalMs = 8_000L)) return
        val snapshot = buildUsageSnapshot()
        val now = System.currentTimeMillis()
        val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date(now))
        val ed = prefs.edit()
            .putString(CACHED_DAILY_USAGE,    snapshot.optString("topAppsJson", "[]"))
            .putString(CACHED_HOURLY,         snapshot.optString("hourlyJson",  "[]"))
            .putLong  (CACHED_TOTAL_MINS,     snapshot.optLong  ("totalMins",  0L))
            .putInt   (CACHED_PICKUPS,        snapshot.optInt   ("pickups",    0))
            .putLong  (CACHED_FIRST_PICKUP_TS,snapshot.optLong  ("firstPickupTs", 0L))

        // ── Daily history accumulation ─────────────────────────────────────────
        // FIX: When the app hasn't been opened for N days, the previous code only
        // saved lastSavedDay and silently dropped all days in between. Now we walk
        // every missed day and re-query the OS event buffer for each one. Days
        // beyond the buffer (~7–14 days) will return 0 — still better than a gap.
        val lastSavedDay = prefs.getString(DAILY_HIST_LAST_DAY, "") ?: ""
        if (lastSavedDay.isEmpty()) {
            ed.putString(DAILY_HIST_LAST_DAY, todayStr)
        } else if (lastSavedDay != todayStr) {
            val histFmt  = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            val histJson = prefs.getString(DAILY_HIST_MAP, "{}") ?: "{}"
            val histMap  = try { JSONObject(histJson) } catch (_: Exception) { JSONObject() }

            // Capture the last cached total BEFORE the new snapshot is applied —
            // this is the final reading for lastSavedDay.
            val lastSavedMins = prefs.getLong(CACHED_TOTAL_MINS, 0L)

            // Walk from lastSavedDay up to (but not including) today
            val fillCal = Calendar.getInstance().apply {
                try { time = histFmt.parse(lastSavedDay)!! } catch (_: Exception) { timeInMillis = now }
            }
            while (true) {
                val dayStr = histFmt.format(fillCal.time)
                if (dayStr >= todayStr) break          // today is still in progress — don't save yet
                if (!histMap.has(dayStr)) {
                    val mins = if (dayStr == lastSavedDay) {
                        // Use the final cached reading rather than re-querying
                        lastSavedMins
                    } else {
                        // Re-query the OS event buffer for this missed day
                        val dayStart = (fillCal.clone() as Calendar).apply {
                            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
                        }.timeInMillis
                        screenTimeMinsForDay(dayStart, dayStart + 86_400_000L, isToday = false)
                    }
                    histMap.put(dayStr, mins)
                }
                fillCal.add(Calendar.DAY_OF_YEAR, 1)
            }

            val cutoff = histFmt.format(java.util.Date(now - 90L * 86_400_000L))
            histMap.keys().asSequence().toList().forEach { k -> if (k < cutoff) histMap.remove(k) }
            ed.putString(DAILY_HIST_MAP, histMap.toString()).putString(DAILY_HIST_LAST_DAY, todayStr)
        }

        val weeklyTs = prefs.getLong(CACHED_WEEKLY_TS, 0L)
        if (now - weeklyTs > 5 * 60_000L) {
            ed.putString(CACHED_WEEKLY, buildWeeklyBreakdown()).putLong(CACHED_WEEKLY_TS, now)
        }

        val monthlyTs = prefs.getLong(CACHED_MONTHLY_TS, 0L)
        if (now - monthlyTs > 5 * 60_000L) {
            runCatching {
                val snap = buildMonthlySnapshot()
                ed.putString(CACHED_MONTHLY_BREAKDOWN, snap[0]).putString(CACHED_MONTHLY_PICKUPS, snap[1])
                    .putString(CACHED_MONTHLY_HOURLY, snap[2]).putString(CACHED_MONTHLY_APP_USAGE, snap[3])
                    .putLong(CACHED_MONTHLY_TS, now)
                    .putInt(CACHED_MONTHLY_MONTH, Calendar.getInstance().get(Calendar.MONTH)) // FIX: stamp month for cache-validity check
            }
        }

        runCatching { ed.putInt(CACHED_GHOST_COUNT, JSONArray(prefs.getString(CACHED_GHOSTS, "[]") ?: "[]").length()) }
        runCatching { ed.putInt(CACHED_STREAK_DAYS, getStreakDaysForGoal(prefs.getInt(STREAK_GOAL_MINS, 240))) }
        ed.putLong(CACHED_USAGE_TS, now).apply()

        // Feed LaunchTracker
        runCatching {
            val lastScanTs = prefs.getLong(CACHED_TRACKER_SCAN_TS, startOfToday())
            val tracker = LaunchTracker.get(context)
            val events = usm().queryEvents(lastScanTs, now); val ev = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(ev)
                if (ev.eventType != UsageEvents.Event.MOVE_TO_FOREGROUND) continue
                if (ev.packageName == context.packageName || !isKnownUserPackage(ev.packageName)) continue
                tracker.recordLaunch(ev.packageName, ev.timeStamp)
            }
            prefs.edit().putLong(CACHED_TRACKER_SCAN_TS, now).apply()
        }
        runCatching { AureloWidgetProvider.pushUpdate(context) }
    }

    // ── preScan (called from MainActivity on cold start) ──────────────────────
    fun preScan(buildInstalledAppsList: () -> String) {
        val apps = buildInstalledAppsList()
        prefs.edit().putString(CACHED_APPS_V5, apps).commit()
        if (!hasUsagePermission()) return
        val snapshot = buildUsageSnapshot()
        val ed = prefs.edit()
            .putString(CACHED_DAILY_USAGE,    snapshot.optString("topAppsJson", "[]"))
            .putString(CACHED_HOURLY,         snapshot.optString("hourlyJson",  "[]"))
            .putLong  (CACHED_TOTAL_MINS,     snapshot.optLong  ("totalMins",  0L))
            .putInt   (CACHED_PICKUPS,        snapshot.optInt   ("pickups",    0))
            .putLong  (CACHED_FIRST_PICKUP_TS,snapshot.optLong  ("firstPickupTs", 0L))
        ed.putString(CACHED_WEEKLY, buildWeeklyBreakdown())
        val ghostTs = prefs.getLong(CACHED_GHOSTS_TS, 0L)
        if (System.currentTimeMillis() - ghostTs > 2 * 3_600_000L) {
            ed.putString(CACHED_GHOSTS, buildGhostApps(30)).putLong(CACHED_GHOSTS_TS, System.currentTimeMillis())
        }
        ed.apply()
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    internal fun hasUsagePermission(): Boolean {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
        val mode = ops.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName)
        return mode == android.app.AppOpsManager.MODE_ALLOWED
    }

    internal fun usm(): UsageStatsManager =
        context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

    internal fun startOfToday(): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    internal fun isKnownUserPackage(pkg: String): Boolean {
        if (pkg == context.packageName) return false
        return try { val info = pm.getApplicationInfo(pkg, 0); appManagement.isUserApp(info) } catch (_: Exception) { false }
    }

    @Suppress("DEPRECATION")
    internal fun buildUsageSnapshot(): JSONObject {
        val now = System.currentTimeMillis(); val dayStart = startOfToday()
        val events = usm().queryEvents(dayStart, now); val ev = UsageEvents.Event()
        val timeMap = mutableMapOf<String, Long>(); val fgStart = mutableMapOf<String, Long>()
        val hourMap = LongArray(24); var pickups = 0; var firstPickupTs = 0L
        while (events.hasNextEvent()) {
            events.getNextEvent(ev)
            if (ev.packageName == context.packageName) continue
            when (ev.eventType) {
                UsageEvents.Event.KEYGUARD_HIDDEN -> { pickups++; if (firstPickupTs == 0L) firstPickupTs = ev.timeStamp }
                UsageEvents.Event.MOVE_TO_FOREGROUND -> fgStart[ev.packageName] = ev.timeStamp
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    val start = fgStart.remove(ev.packageName) ?: continue
                    val ms = ev.timeStamp - start; timeMap[ev.packageName] = (timeMap[ev.packageName] ?: 0L) + ms
                    val hour = Calendar.getInstance().apply { timeInMillis = start }.get(Calendar.HOUR_OF_DAY)
                    hourMap[hour] += ms / 60_000L
                }
            }
        }
        val MAX_SESSION_MS = 4 * 60 * 60_000L
        fgStart.forEach { (pkg, start) ->
            val ms = (now - start).coerceAtMost(MAX_SESSION_MS); timeMap[pkg] = (timeMap[pkg] ?: 0L) + ms
            val hour = Calendar.getInstance().apply { timeInMillis = start }.get(Calendar.HOUR_OF_DAY)
            hourMap[hour] += ms / 60_000L
        }
        val totalMins = timeMap.filter { isKnownUserPackage(it.key) }.values.sum() / 60_000L
        val topApps = JSONArray()
        timeMap.entries.filter { it.value > 60_000L && isKnownUserPackage(it.key) }.sortedByDescending { it.value }.forEach { (pkg, ms) ->
            runCatching { val info = pm.getApplicationInfo(pkg, 0); topApps.put(JSONObject().apply { put("packageName",pkg); put("name",pm.getApplicationLabel(info).toString()); put("iconUrl","app-icon://$pkg"); put("totalMinutes",ms/60_000L); put("lastUsed",now) }) }
        }
        val hourly = JSONArray(); hourMap.forEachIndexed { h, m -> hourly.put(JSONObject().apply { put("hour",h); put("minutes",m) }) }
        return JSONObject().apply {
            put("topAppsJson", topApps.toString()); put("hourlyJson", hourly.toString())
            put("totalMins", totalMins); put("pickups", pickups); put("firstPickupTs", firstPickupTs)
            put("topApps", topApps); put("hourly", hourly)
        }
    }

    @Suppress("DEPRECATION")
    internal fun buildWeeklyBreakdown(): String {
        val usm = usm(); val result = JSONArray()
        val days = listOf("Sun","Mon","Tue","Wed","Thu","Fri","Sat")
        val now = System.currentTimeMillis(); val MAX_MS = 4 * 60 * 60_000L
        for (i in 6 downTo 0) {
            val dayStart = Calendar.getInstance().apply { timeInMillis = now; add(Calendar.DAY_OF_YEAR,-i); set(Calendar.HOUR_OF_DAY,0); set(Calendar.MINUTE,0); set(Calendar.SECOND,0); set(Calendar.MILLISECOND,0) }.timeInMillis
            val dayEnd = if (i == 0) now else dayStart + 86_400_000L
            val foregroundStart = mutableMapOf<String,Long>(); val totalMs = mutableMapOf<String,Long>(); var pickups = 0
            runCatching {
                val events = usm.queryEvents(dayStart, dayEnd); val event = UsageEvents.Event()
                while (events.hasNextEvent()) {
                    events.getNextEvent(event); val pkg = event.packageName
                    if (pkg == context.packageName) continue
                    if (event.eventType == UsageEvents.Event.KEYGUARD_HIDDEN) { pickups++; continue }
                    if (!isKnownUserPackage(pkg)) continue
                    when (event.eventType) {
                        UsageEvents.Event.MOVE_TO_FOREGROUND -> foregroundStart[pkg] = event.timeStamp
                        UsageEvents.Event.MOVE_TO_BACKGROUND -> { val start = foregroundStart.remove(pkg); if (start != null) totalMs[pkg] = (totalMs[pkg] ?: 0L) + (event.timeStamp - start).coerceAtMost(MAX_MS) }
                    }
                }
                val boundary = if (i == 0) now else dayEnd
                foregroundStart.forEach { (pkg, start) -> totalMs[pkg] = (totalMs[pkg] ?: 0L) + (boundary - start).coerceAtMost(MAX_MS) }
            }
            val dayPickups = if (i == 0) prefs.getInt(CACHED_PICKUPS, pickups) else pickups
            val totalMins = totalMs.values.sum() / 60_000L
            val tops = totalMs.entries.filter { it.value > 0 && isKnownUserPackage(it.key) }.sortedByDescending { it.value }.take(3)
                .mapNotNull { (pkg,_) -> runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg,0)).toString() }.getOrNull() }
            val cal = Calendar.getInstance().apply { timeInMillis = dayStart }
            result.put(JSONObject().apply { put("day",days[cal.get(Calendar.DAY_OF_WEEK)-1]); put("minutes",totalMins); put("pickups",dayPickups); put("isToday",i==0); put("date","${cal.get(Calendar.MONTH)+1}/${cal.get(Calendar.DAY_OF_MONTH)}"); put("topApps",JSONArray(tops)) })
        }
        return result.toString()
    }

    private fun buildDailyUsageStats(): String = prefs.getString(CACHED_DAILY_USAGE, "[]") ?: "[]"
    private fun buildHourlyBreakdown(): String = prefs.getString(CACHED_HOURLY, "[]") ?: "[]"

    @Suppress("DEPRECATION")
    internal fun buildMonthlySnapshot(): Array<String> {
        val now      = System.currentTimeMillis()
        val cal      = Calendar.getInstance()
        val today    = cal.get(Calendar.DAY_OF_MONTH)
        val month    = cal.get(Calendar.MONTH)
        val year     = cal.get(Calendar.YEAR)
        val dayNames = listOf("Sun","Mon","Tue","Wed","Thu","Fri","Sat")
        val MAX_MS   = 4 * 60 * 60_000L

        val monthStart = Calendar.getInstance().apply {
            set(Calendar.YEAR, year); set(Calendar.MONTH, month)
            set(Calendar.DAY_OF_MONTH, 1); set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        // ── Boundaries ────────────────────────────────────────────────────────
        // queryEvents() reliably covers ~7 days on most devices; use 6 to stay
        // safely inside the buffer on stricter OEMs.
        val eventsCutoff = (now - 6L * 86_400_000L).coerceAtLeast(monthStart)

        val dayTotalMs  = mutableMapOf<Int, Long>()
        val pkgTotalMs  = mutableMapOf<String, Long>()
        val dayPickups  = mutableMapOf<Int, Int>()
        val hourTotalMs = LongArray(24)

        // ── Phase 1: queryUsageStats(INTERVAL_DAILY) for the full month ───────
        // This API is not subject to the ~7-day event-buffer limit, so it fills
        // in screen-time totals for all days older than eventsCutoff.
        // It does NOT give pickup counts or hourly detail — those come from Phase 2.
        runCatching {
            val dailyStats = usm().queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY, monthStart, eventsCutoff
            )
            for (stat in dailyStats) {
                if (!isKnownUserPackage(stat.packageName)) continue
                if (stat.totalTimeInForeground <= 0L) continue
                val statCal = Calendar.getInstance().apply { timeInMillis = stat.firstTimeStamp }
                // Guard: only accept stats that belong to the current month/year
                if (statCal.get(Calendar.MONTH) != month || statCal.get(Calendar.YEAR) != year) continue
                val d = statCal.get(Calendar.DAY_OF_MONTH)
                // Only apply Phase 1 to days outside the precise events window
                val dayStartTs = (statCal.clone() as Calendar).apply {
                    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
                }.timeInMillis
                if (dayStartTs >= eventsCutoff) continue   // Phase 2 will cover this day precisely
                dayTotalMs[d]  = (dayTotalMs[d]  ?: 0L) + stat.totalTimeInForeground
                pkgTotalMs[stat.packageName] =
                    (pkgTotalMs[stat.packageName] ?: 0L) + stat.totalTimeInForeground
            }
        }

        // ── Phase 2: queryEvents() for the last ~6 days ───────────────────────
        // More precise session-boundary tracking; also captures pickups and
        // per-hour detail. Overrides Phase 1 for any day it covers.
        val fgStart = mutableMapOf<String, Long>()
        runCatching {
            val events = usm().queryEvents(eventsCutoff, now)
            val ev     = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(ev)
                if (ev.packageName == context.packageName) continue
                when (ev.eventType) {
                    UsageEvents.Event.KEYGUARD_HIDDEN -> {
                        val d = Calendar.getInstance().apply { timeInMillis = ev.timeStamp }
                            .get(Calendar.DAY_OF_MONTH)
                        dayPickups[d] = (dayPickups[d] ?: 0) + 1
                    }
                    UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                        if (isKnownUserPackage(ev.packageName)) fgStart[ev.packageName] = ev.timeStamp
                    }
                    UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                        val start = fgStart.remove(ev.packageName) ?: continue
                        val ms    = (ev.timeStamp - start).coerceAtMost(MAX_MS)
                        val d     = Calendar.getInstance().apply { timeInMillis = start }
                            .get(Calendar.DAY_OF_MONTH)
                        val hour  = Calendar.getInstance().apply { timeInMillis = start }
                            .get(Calendar.HOUR_OF_DAY)
                        dayTotalMs[d]  = (dayTotalMs[d]  ?: 0L) + ms
                        pkgTotalMs[ev.packageName] = (pkgTotalMs[ev.packageName] ?: 0L) + ms
                        hourTotalMs[hour] += ms
                    }
                }
            }
        }

        // Handle apps still in foreground at query time
        fgStart.forEach { (pkg, start) ->
            val ms   = (now - start).coerceAtMost(MAX_MS)
            val hour = Calendar.getInstance().apply { timeInMillis = start }.get(Calendar.HOUR_OF_DAY)
            dayTotalMs[today]  = (dayTotalMs[today]  ?: 0L) + ms
            pkgTotalMs[pkg]    = (pkgTotalMs[pkg]    ?: 0L) + ms
            hourTotalMs[hour] += ms
        }

        // ── Build output arrays ───────────────────────────────────────────────
        val todayMins = prefs.getLong(CACHED_TOTAL_MINS, 0L)
        val breakdown = JSONArray()
        val pickupArr = JSONArray()

        for (d in 1..today) {
            val dayCal = Calendar.getInstance().apply {
                set(Calendar.YEAR, year); set(Calendar.MONTH, month)
                set(Calendar.DAY_OF_MONTH, d); set(Calendar.HOUR_OF_DAY, 12)
                set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            val dayMins = if (d == today) todayMins else (dayTotalMs[d] ?: 0L) / 60_000L
            breakdown.put(JSONObject().apply {
                put("day",     dayNames[dayCal.get(Calendar.DAY_OF_WEEK) - 1])
                put("date",    "${month + 1}/$d")
                put("minutes", dayMins)
                put("isToday", d == today)
            })
            pickupArr.put(JSONObject().apply {
                put("date",    "${month + 1}/$d")
                put("pickups", if (d == today) prefs.getInt(CACHED_PICKUPS, 0) else (dayPickups[d] ?: 0))
                put("isToday", d == today)
            })
        }

        val trackedDays = (1..today).count { d ->
            val mins = if (d == today) todayMins else (dayTotalMs[d] ?: 0L) / 60_000L
            mins >= 10
        }.coerceAtLeast(1)

        val hourly = JSONArray()
        hourTotalMs.forEachIndexed { h, ms ->
            hourly.put(JSONObject().apply { put("hour", h); put("minutes", ms / 60_000L / trackedDays) })
        }

        val appsArr = JSONArray()
        pkgTotalMs.entries.filter { it.value > 60_000L }.sortedByDescending { it.value }
            .forEach { (pkg, ms) ->
                runCatching {
                    val info = pm.getApplicationInfo(pkg, 0)
                    appsArr.put(JSONObject().apply {
                        put("packageName",    pkg)
                        put("name",           pm.getApplicationLabel(info).toString())
                        put("iconUrl",        "app-icon://$pkg")
                        put("monthlyMinutes", ms / 60_000L)
                    })
                }
            }

        return arrayOf(breakdown.toString(), pickupArr.toString(), hourly.toString(), appsArr.toString())
    }

    @Suppress("DEPRECATION")
    internal fun buildGhostApps(thresholdDays: Int): String {
        val usm = usm(); val now = System.currentTimeMillis()
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_BEST, now - 365L*86_400_000, now)
        val usageMap = stats.associate { it.packageName to it.lastTimeUsed }
        val result = JSONArray()
        pm.getInstalledApplications(PackageManager.GET_META_DATA)
            .filter { appManagement.isUserApp(it) && it.packageName != context.packageName }.forEach { info ->
                runCatching {
                    val lastUsed = usageMap[info.packageName] ?: 0L
                    val daysSince = if (lastUsed == 0L) thresholdDays + 30 else ((now - lastUsed) / 86_400_000L).toInt()
                    if (daysSince >= thresholdDays) {
                        val mb = try { java.io.File(info.sourceDir).length() / 1_048_576L } catch (_: Exception) { 0L }
                        result.put(JSONObject().apply { put("packageName",info.packageName); put("name",pm.getApplicationLabel(info).toString()); put("iconUrl","app-icon://${info.packageName}"); put("daysSinceUse",daysSince); put("sizeMB",mb) })
                    }
                }
            }
        return result.toString()
    }

    private fun getStreakDaysForGoal(goalMinutes: Int): Int {
        if (!hasUsagePermission()) return 0
        val now = System.currentTimeMillis(); var streak = 0; var graceUsedInWindow = false; var graceWindowStart = -1
        for (i in 0..29) {
            val dayStart = Calendar.getInstance().apply { timeInMillis = now; add(Calendar.DAY_OF_YEAR,-i); set(Calendar.HOUR_OF_DAY,0); set(Calendar.MINUTE,0); set(Calendar.SECOND,0); set(Calendar.MILLISECOND,0) }.timeInMillis
            val dayEnd = if (i == 0) now else dayStart + 86_400_000L
            val dayMins = screenTimeMinsForDay(dayStart, dayEnd, i == 0)
            if (dayMins <= goalMinutes) {
                streak++
                if (graceUsedInWindow && graceWindowStart >= 0 && i - graceWindowStart >= 7) { graceUsedInWindow = false; graceWindowStart = -1 }
            } else {
                if (!graceUsedInWindow) { graceUsedInWindow = true; graceWindowStart = i; streak++ } else break
            }
        }
        return streak
    }

    @Suppress("DEPRECATION")
    private fun screenTimeMinsForDay(dayStart: Long, dayEnd: Long, isToday: Boolean): Long {
        return runCatching {
            val now = System.currentTimeMillis(); val events = usm().queryEvents(dayStart, dayEnd)
            val ev = UsageEvents.Event(); val fgStart = mutableMapOf<String,Long>(); val totalMs = mutableMapOf<String,Long>()
            val MAX_MS = 4 * 60 * 60_000L
            while (events.hasNextEvent()) {
                events.getNextEvent(ev); if (ev.packageName == context.packageName) continue
                when (ev.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND -> fgStart[ev.packageName] = ev.timeStamp
                    UsageEvents.Event.MOVE_TO_BACKGROUND -> { val start = fgStart.remove(ev.packageName) ?: continue; totalMs[ev.packageName] = (totalMs[ev.packageName] ?: 0L) + (ev.timeStamp - start).coerceAtMost(MAX_MS) }
                }
            }
            val boundary = if (isToday) now else dayEnd
            fgStart.forEach { (pkg, start) -> val ms = (boundary - start).coerceAtMost(MAX_MS); totalMs[pkg] = (totalMs[pkg] ?: 0L) + ms }
            totalMs.values.sum() / 60_000L
        }.getOrElse { 0L }
    }

    // ── Discover ──────────────────────────────────────────────────────────────
    @JavascriptInterface fun getDiscoverSuggestions(): String = buildDiscoverResult(shuffled = false)
    @JavascriptInterface fun getDiscoverSuggestionsRefresh(): String = buildDiscoverResult(shuffled = true)

    private fun buildDiscoverResult(shuffled: Boolean): String {
        val pool = buildDiscoverPool(); val topCats = topCatsFromUsage()
        val orderedCats = (topCats + pool.keys.filter { !topCats.contains(it) }).let { if (shuffled) it.shuffled() else it }
        val result = JSONArray()
        for (cat in orderedCats) {
            val entries = (pool[cat] ?: continue).let { if (shuffled) it.shuffled() else it }
            for ((pkg, name) in entries) {
                if (!isAppInstalled(pkg)) {
                    result.put(JSONObject().apply { put("packageName",pkg); put("name",name); put("category",cat); put("reason",if(topCats.contains(cat)) "Based on your $cat usage" else "Popular pick") })
                    if (result.length() >= 20) return result.toString()
                }
            }
        }
        return result.toString()
    }

    private fun isAppInstalled(pkg: String): Boolean = runCatching { pm.getPackageInfo(pkg, 0); true }.getOrDefault(false)

    private fun topCatsFromUsage(): List<String> {
        val daily = JSONArray(getCachedDailyUsage()); val appsList = JSONArray(prefs.getString(CACHED_APPS_V5, "[]") ?: "[]")
        val pkgToCat = mutableMapOf<String,String>()
        for (i in 0 until appsList.length()) { val a = appsList.getJSONObject(i); pkgToCat[a.getString("packageName")] = a.getString("category") }
        val catMins = mutableMapOf<String,Long>()
        for (i in 0 until daily.length()) { val d = daily.getJSONObject(i); val cat = pkgToCat[d.getString("packageName")] ?: "Unassigned"; catMins[cat] = (catMins[cat] ?: 0L) + d.getLong("totalMinutes") }
        return catMins.entries.sortedByDescending { it.value }.take(5).map { it.key }
    }

    private fun buildDiscoverPool(): Map<String, List<Pair<String, String>>> = mapOf(
        "Social & Communication" to listOf("com.discord" to "Discord","cc.bereal" to "BeReal","org.joinmastodon.android" to "Mastodon","xyz.blueskyweb.app" to "Bluesky"),
        "Entertainment & Video"  to listOf("com.twitch.android.app" to "Twitch","com.plex.android" to "Plex","tv.pluto.android" to "Pluto TV","com.tubi.tv" to "Tubi"),
        "Productivity & Business" to listOf("notion.id" to "Notion","com.todoist.android.Todoist" to "Todoist","com.trello" to "Trello","com.evernote" to "Evernote"),
        "Health & Wellness" to listOf("com.getsomeheadspace.android" to "Headspace","com.strava" to "Strava","com.myfitnesspal.android" to "MyFitnessPal","com.calm.android" to "Calm"),
        "Education & Books" to listOf("com.duolingo" to "Duolingo","org.khanacademy.android" to "Khan Academy","com.coursera.android" to "Coursera"),
        "Finance" to listOf("com.robinhood.android" to "Robinhood","com.coinbase.android" to "Coinbase","com.ynab.ynab" to "YNAB"),
        "Games" to listOf("com.supercell.brawlstars" to "Brawl Stars","com.mojang.minecraftpe" to "Minecraft"),
        "Tools & Utilities" to listOf("com.nordvpn.android" to "NordVPN","org.mozilla.firefox" to "Firefox","com.bitwarden.mobile" to "Bitwarden")
    )

    // ── Shared helpers ────────────────────────────────────────────────────────
    internal fun fmtM(mins: Long): String {
        if (mins <= 0L) return "0m"; val h = mins / 60L; val m = mins % 60L
        return when { h > 0L && m > 0L -> "${h}h ${m}m"; h > 0L -> "${h}h"; else -> "${m}m" }
    }

    private fun j(vararg pairs: Any): JSONObject {
        val obj = JSONObject(); var i = 0
        while (i + 1 < pairs.size) { obj.put(pairs[i].toString(), pairs[i+1]); i += 2 }
        return obj
    }
}