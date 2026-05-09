package com.javikastudio.tidyapp

import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * AppTimerBridge — owns app timer limits, 80% warnings, soft blocks, and
 * timer ignore tracking.
 * Phase 3: extracted from AppBridge.kt.
 */
class AppTimerBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val usageBridge: UsageStatsBridge
) : AppBridgeController {

    @JavascriptInterface fun getLimits(): String {
        val obj = JSONObject(); limitsMap().forEach { (k,v) -> obj.put(k,v) }; return obj.toString()
    }

    @JavascriptInterface fun setAppLimit(pkg: String, mins: Int) {
        if (mins < 1 || mins > 1440 || pkg.isBlank() || pkg.length > 256) return
        if (!isAppInstalled(pkg)) return
        val newMap = limitsMap().toMutableMap().also { it[pkg] = mins }
        saveLimitsMap(newMap)
        val usedMins = cachedUsageMinsFor(pkg).toInt()
        val mapJson = prefs.getString(TIMERBLOCK_PKGS_MAP, "{}") ?: "{}"
        val mapObj = runCatching { JSONObject(mapJson) }.getOrElse { JSONObject() }
        if (usedMins < mins) {
            mapObj.remove(pkg)
            prefs.edit().putString(TIMERBLOCK_PKGS_MAP, mapObj.toString()).putBoolean("timerblockmode", mapObj.length() != 0)
                .remove("timer_grace_until_ts_$pkg").remove("timer_grace_in_fg_$pkg")
                .remove("timerblockts_$pkg").remove("timerblockday_$pkg").putString("timerblockpkg","").remove("timerblocklimit").apply()
        } else {
            val appName = runCatching { context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg.split(".").last())
            mapObj.put(pkg, JSONObject().apply { put("name",appName); put("used",usedMins); put("limit",mins) })
            prefs.edit().putString(TIMERBLOCK_PKGS_MAP, mapObj.toString()).putBoolean("timerblockmode",true).putString("timerblockpkg",pkg).putInt("timerblocklimit",mins).apply()
            // Bug-2 FIX: startTimerSoftBlock() was called via !latestMap.has(pkg) AFTER the
            // map write above, so latestMap always contained pkg and the condition was always
            // false — overlay never triggered on first add for an already-expired app.
            // Call it directly here instead; startTimerSoftBlock's own 5.5-min dedup
            // prevents double-firing on rapid re-saves.
            startTimerSoftBlock(pkg, appName, usedMins, mins)
        }
        if (usedMins < mins) prefs.edit().remove("timerblockts_$pkg").remove("timerblockday_$pkg").apply()
    }

    @JavascriptInterface fun removeAppLimit(pkg: String) {
        if (pkg.isBlank() || pkg.length > 256) return
        val newMap = limitsMap().toMutableMap().also { it.remove(pkg) }
        saveLimitsMap(newMap)
        val mapJson = prefs.getString(TIMERBLOCK_PKGS_MAP, "{}") ?: "{}"
        val mapObj = runCatching { JSONObject(mapJson) }.getOrElse { JSONObject() }
        mapObj.remove(pkg)
        prefs.edit().putString(TIMERBLOCK_PKGS_MAP, mapObj.toString()).putBoolean("timerblockmode", mapObj.length() != 0).apply()
        val timerPkg = prefs.getString("timerblockpkg", "") ?: ""
        if (prefs.getBoolean("timerblockmode", false) && timerPkg == pkg) {
            prefs.edit().putBoolean("timerblockmode", false).putString("timerblockpkg","").apply()
        }
        prefs.edit().remove("timerblockts_$pkg").remove("timerblockday_$pkg").apply()
        if (newMap.isEmpty() && !prefs.getBoolean(KEY_INTENTION_ENABLED, false)) {
            runCatching {
                val stopIntent = Intent(context, AppMonitorService::class.java).apply { action = AppMonitorService.ACTION_INTENTION_STOP }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(stopIntent)
                else context.startService(stopIntent)
            }
        }
    }

    @JavascriptInterface fun checkAppLimitReached(pkg: String): Boolean {
        val lim = limitsMap()[pkg] ?: return false
        if (!usageBridge.hasUsagePermission()) return false
        val stats = usageBridge.usm().queryUsageStats(android.app.usage.UsageStatsManager.INTERVAL_DAILY, usageBridge.startOfToday(), System.currentTimeMillis())
        return (stats.find { it.packageName == pkg }?.totalTimeInForeground?.div(60_000) ?: 0) >= lim
    }

    @JavascriptInterface fun recordTimerIgnore(pkg: String) {
        if (pkg.isBlank() || pkg.length > 256) return
        runCatching {
            val raw = prefs.getString(TIMER_IGNORE_STATS_V1, "{}") ?: "{}"
            val data = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
            val weekId = currentWeekId(); val obj = if (data.has(pkg)) data.getJSONObject(pkg) else JSONObject()
            if (obj.optString("weekId") != weekId) { obj.put("weekIgnores",0); obj.put("weekId",weekId) }
            obj.put("weekIgnores", obj.optInt("weekIgnores",0)+1); obj.put("totalIgnores", obj.optInt("totalIgnores",0)+1)
            data.put(pkg, obj); prefs.edit().putString(TIMER_IGNORE_STATS_V1, data.toString()).apply()
        }
    }

    @JavascriptInterface fun getTimerIgnoreStats(): String {
        return runCatching {
            val raw = prefs.getString(TIMER_IGNORE_STATS_V1, "{}") ?: "{}"
            val data = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
            val weekId = currentWeekId(); val result = JSONObject()
            data.keys().forEach { pkg ->
                val obj = data.getJSONObject(pkg)
                val week = if (obj.optString("weekId") == weekId) obj.optInt("weekIgnores",0) else 0
                result.put(pkg, JSONObject().apply { put("weekIgnores",week); put("totalIgnores",obj.optInt("totalIgnores",0)) })
            }
            result.toString()
        }.getOrElse { "{}" }
    }

    @JavascriptInterface fun postTimerWarningNotification(pkg: String, appName: String, limitMins: Int, usedMins: Int) {
        runCatching {
            val dedupKey = "timer_warn_${pkg}_${todayDateString()}"
            if (prefs.getBoolean(dedupKey, false)) return
            prefs.edit().putBoolean(dedupKey, true).apply()
            val remaining = limitMins - usedMins
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                nm.createNotificationChannel(android.app.NotificationChannel(NOTIF_CHANNEL_ID,"Aurelo Smart Alerts",android.app.NotificationManager.IMPORTANCE_HIGH))
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            val pi = if (launchIntent != null) android.app.PendingIntent.getActivity(context, 0, launchIntent, pendingFlags) else null
            val notif = NotificationCompat.Builder(context, NOTIF_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert).setColor(0xFFF7A623.toInt())
                .setContentTitle("⏱ ${remaining}m left on $appName today").setContentText("${usedMins}m used · ${limitMins}m limit. Time to wrap up.")
                .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).apply { if (pi != null) setContentIntent(pi) }.build()
            nm.notify(5000 + (pkg.hashCode() and 0x0FFF), notif)
        }
    }

    @JavascriptInterface fun startTimerSoftBlock(pkg: String, appName: String, usedMins: Int, limitMins: Int) {
        if (prefs.getBoolean(KEY_FOCUS_ACTIVE, false)) {
            val focusApps = runCatching { JSONArray(prefs.getString(KEY_FOCUS_BLOCKED_APPS, "[]") ?: "[]") }.getOrElse { JSONArray() }
            if ((0 until focusApps.length()).any { focusApps.optJSONObject(it)?.optString("packageName") == pkg }) return
        }
        val tsKey = "timerblockts_$pkg"; val dayKey = "timerblockday_$pkg"
        val lastStart = prefs.getLong(tsKey, 0L); val lastDay = prefs.getString(dayKey, "")
        val now = System.currentTimeMillis(); val graceWindowMs = 5 * 60_000L + 30_000L
        val isSameDay = (lastDay == todayDateString())
        if (isSameDay && lastStart > 0 && now - lastStart < graceWindowMs) return
        prefs.edit().putLong(tsKey, now).putString(dayKey, todayDateString()).apply()
        if (!hasOverlayPermission()) {
            // Still dedup notifications
            prefs.edit().putLong(tsKey, now).putString(dayKey, todayDateString()).apply()
            postTimerWarningNotification(pkg, appName, limitMins, usedMins)
            return
        }
        val intent = Intent(context, AppMonitorService::class.java).apply {
            action = AppMonitorService.ACTION_TIMER_BLOCK; putExtra("pkg",pkg); putExtra("appName",appName); putExtra("usedMins",usedMins); putExtra("limitMins",limitMins)
        }
        val mapJson = prefs.getString(TIMERBLOCK_PKGS_MAP, "{}") ?: "{}"
        val mapObj = runCatching { JSONObject(mapJson) }.getOrElse { JSONObject() }
        mapObj.put(pkg, JSONObject().apply { put("name",appName); put("used",usedMins); put("limit",limitMins) })
        prefs.edit().putBoolean("timerblockmode",true).putString(TIMERBLOCK_PKGS_MAP, mapObj.toString()).apply()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
            // ✅ Only stamp AFTER successful start — allows retry if service failed to start
            prefs.edit().putLong(tsKey, now).putString(dayKey, todayDateString()).apply()
        } catch (e: Exception) {
            // Android 12+ ForegroundServiceStartNotAllowedException — don't stamp,
            // allow the next checkTimerThresholds() cycle to retry
        }
    }

    /** Called from UsageStatsBridge.refreshUsageStats() — checks all limits and fires blocks. */
    fun checkTimerThresholds() {
        val limits = limitsMap(); if (limits.isEmpty()) return
        val daily = try { JSONArray(prefs.getString(CACHED_DAILY_USAGE, "[]") ?: "[]") } catch (_: Exception) { JSONArray() }
        for (i in 0 until daily.length()) {
            val app = daily.getJSONObject(i); val pkg = app.optString("packageName").takeIf { it.isNotBlank() } ?: continue
            val name = app.optString("name", pkg.split(".").last()); val used = app.optLong("totalMinutes", 0L).toInt()
            val limit = limits[pkg] ?: continue; val pct = if (limit > 0) (used * 100) / limit else 0
            when { used >= limit -> startTimerSoftBlock(pkg, name, used, limit); pct >= 80 -> postTimerWarningNotification(pkg, name, limit, used) }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    internal fun limitsMap(): Map<String,Int> {
        val obj = JSONObject(securePrefs.getString(APP_LIMITS_V5, "{}") ?: "{}")
        return obj.keys().asSequence().associate { it to obj.getInt(it) }
    }

    private fun saveLimitsMap(m: Map<String,Int>) {
        val obj = JSONObject(); m.forEach { (k,v) -> obj.put(k,v) }
        securePrefs.edit().putString(APP_LIMITS_V5, obj.toString()).apply()
    }

    private fun cachedUsageMinsFor(pkg: String): Long {
        return try {
            val arr = JSONArray(prefs.getString(CACHED_DAILY_USAGE, "[]") ?: "[]")
            (0 until arr.length()).firstNotNullOfOrNull { i -> val o = arr.getJSONObject(i); if (o.getString("packageName") == pkg) o.getLong("totalMinutes") else null } ?: 0L
        } catch (_: Exception) { 0L }
    }

    private fun hasOverlayPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.provider.Settings.canDrawOverlays(context) else true

    private fun isAppInstalled(pkg: String): Boolean = runCatching { context.packageManager.getPackageInfo(pkg,0); true }.getOrDefault(false)

    private fun currentWeekId(): String = SimpleDateFormat("yyyy-'W'ww", Locale.US).format(Date())
    private fun todayDateString(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
}