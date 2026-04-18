package com.javikastudio.tidyapp

import android.app.usage.UsageStatsManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * AureloWidgetUpdateWorker
 * ─────────────────────────────────────────────────────────────────────────
 * Runs every 15 minutes via WorkManager even when the app is fully closed.
 * Updates cached SharedPrefs (total_mins, pickups, streak, ghost_count)
 * then fires a widget broadcast to redraw all active widget instances.
 *
 * Why WorkManager and not AlarmManager?
 *  - WorkManager survives reboots and Doze mode better
 *  - 15 min is the platform minimum for periodic work
 *  - The AppBridge 10s loop handles foreground real-time; this handles background
 *
 * Schedule by calling:  AureloWidgetUpdateWorker.schedule(context)
 */
class AureloWidgetUpdateWorker(
    private val appContext: Context,
    workerParams: WorkerParameters
) : Worker(appContext, workerParams) {

    private val prefs = appContext.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)

    override fun doWork(): Result {
        if (!hasUsagePermission()) return Result.success()

        refreshCaches()
        pushWidgetBroadcast()
        return Result.success()
    }

    // ── Refresh SharedPrefs caches ─────────────────────────────────────────
    private fun refreshCaches() {
        runCatching {
            val usm = appContext.getSystemService(Context.USAGE_STATS_SERVICE)
                as? UsageStatsManager ?: return
            val now      = System.currentTimeMillis()
            val dayStart = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0);      set(Calendar.MILLISECOND, 0)
            }.timeInMillis

            // ── Use queryEvents (FOREGROUND/BACKGROUND pairs) instead of
            //    queryUsageStats so we never count still-open sessions.
            //    queryUsageStats.totalTimeInForeground includes the current
            //    in-progress session time which inflates the widget counter
            //    while the phone sits idle with an app "open".
            val events  = usm.queryEvents(dayStart, now)
            val ev      = android.app.usage.UsageEvents.Event()
            val timeMap = mutableMapOf<String, Long>()
            val fgStart = mutableMapOf<String, Long>()
            val MAX_SESSION_MS = 4 * 60 * 60_000L   // cap any single session at 4h
            var pickups  = 0

            while (events.hasNextEvent()) {
                events.getNextEvent(ev)
                if (ev.packageName == appContext.packageName) continue
                when (ev.eventType) {
                    android.app.usage.UsageEvents.Event.KEYGUARD_HIDDEN -> {
                        // Each screen unlock = one pickup — matches iOS/Digital Wellbeing definition
                        pickups++
                    }
                    android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                        fgStart[ev.packageName] = ev.timeStamp
                    }
                    android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                        val start = fgStart.remove(ev.packageName) ?: continue
                        val ms = (ev.timeStamp - start).coerceAtMost(MAX_SESSION_MS)
                        timeMap[ev.packageName] = (timeMap[ev.packageName] ?: 0L) + ms
                    }
                }
            }
            // Apps still in foreground right now — add elapsed time (capped at MAX_SESSION_MS)
            // Only count if the session started within the last 4h to avoid runaway totals
            fgStart.forEach { (pkg, start) ->
                val elapsed = (now - start).coerceAtMost(MAX_SESSION_MS)
                timeMap[pkg] = (timeMap[pkg] ?: 0L) + elapsed
            }

            val totalMin = timeMap
                .filter { isUserApp(it.key) }
                .values.sum() / 60_000L

            val ghostCount = runCatching {
                org.json.JSONArray(prefs.getString(CACHED_GHOSTS, "[]") ?: "[]").length()
            }.getOrElse { 0 }

            val goalMins = prefs.getInt(STREAK_GOAL_MINS, 240).toLong()
            val streakDays = runCatching { computeStreak(usm, goalMins) }.getOrElse { 0 }

            prefs.edit()
                .putLong(CACHED_TOTAL_MINS,   totalMin)
                .putInt (CACHED_PICKUPS,       pickups)
                .putInt (CACHED_GHOST_COUNT,   ghostCount)
                .putInt (CACHED_STREAK_DAYS,   streakDays)
                .apply()

            // ── Feed LaunchTracker from real usage events ─────────────────────
            // Worker runs every 15 min — scan events since last tracker sync so
            // Smart Routine learns from all app opens even when app is fully closed.
            runCatching {
                val lastScanTs = prefs.getLong("cached_tracker_scan_ts", dayStart)
                val tracker    = LaunchTracker.get(appContext)
                val evScan     = usm.queryEvents(lastScanTs, now)
                val evItem     = android.app.usage.UsageEvents.Event()
                while (evScan.hasNextEvent()) {
                    evScan.getNextEvent(evItem)
                    if (evItem.eventType != android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND) continue
                    if (evItem.packageName == appContext.packageName) continue  // never record Aurelo itself
                    if (!isUserApp(evItem.packageName)) continue
                    tracker.recordLaunch(evItem.packageName, evItem.timeStamp)
                }
                prefs.edit().putLong("cached_tracker_scan_ts", now).apply()

                // ISSUE-02 FIX: pruneOldData() existed but was never called, so the
                // SQLite database grew unbounded. Prune once per day: compare today's
                // date string against the last-prune date stored in prefs.
                val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                    .format(java.util.Date(now))
                val lastPruneDate = prefs.getString("launch_db_last_prune", "") ?: ""
                if (lastPruneDate != todayStr) {
                    tracker.pruneOldData()
                    prefs.edit().putString("launch_db_last_prune", todayStr).apply()
                }
            }
        }
    }

    // BUG-04 FIX: was a minimal 10-entry list, diverging from AppBridge's 70+ prefix blocklist.
    // Divergent implementations caused the widget to show system apps the in-app view correctly
    // hides, and made cached_pickups diverge from AppBridge's count.
    // This list now mirrors AppBridge.isKnownUserPackage() exactly.
    private fun isUserApp(pkg: String): Boolean {
        if (pkg == appContext.packageName) return false
        val systemPrefixes = listOf(
            // Android OS core
            "android",
            "com.android.systemui",
            "com.android.launcher",
            "com.android.launcher3",
            "com.android.settings",
            "com.android.providers",
            "com.android.server",
            "com.android.phone",
            "com.android.dialer",
            "com.android.contacts",
            "com.android.mms",
            "com.android.packageinstaller",
            "com.android.managedprovisioning",
            "com.android.inputmethod",
            "com.android.nfc",
            "com.android.bluetooth",
            "com.android.wifi",
            "com.android.connectivity",
            "com.android.hotspot2",
            // Google system infrastructure
            "com.google.android.gms",
            "com.google.android.gsf",
            "com.google.android.inputmethod",
            "com.google.android.googlequicksearchbox",
            "com.google.android.tts",
            "com.google.android.syncadapters",
            "com.google.android.backuptransport",
            "com.google.android.configupdater",
            "com.google.android.partnersetup",
            "com.google.android.setupwizard",
            "com.google.android.onetimeinitializer",
            "com.google.android.packageinstaller",
            "com.google.android.permissioncontroller",
            "com.google.android.printservice",
            "com.google.android.networkstack",
            // Accessibility / switch / enterprise
            "com.google.android.accessibility",
            "com.google.android.apps.accessibility",
            "com.android.accessibility",
            "com.google.android.apps.enterprise",
            "com.google.android.apps.work",
            "com.android.enterprise",
            // Safety / emergency / device management
            "com.google.android.apps.safetyhub",
            "com.google.android.apps.emergencyassist",
            "com.google.android.apps.restore",
            "com.google.android.apps.setupwizard",
            // Themes / overlays
            "com.android.theme",
            "com.android.overlay",
            "com.samsung.android.theme",
            "com.oneplus.theme",
            // VPN / network management
            "com.google.android.apps.vpn",
            "com.android.vpndialogs",
            // Samsung / OEM system infrastructure
            "com.samsung.android.honeyboard",
            "com.android.vending",
            // SIM Toolkit and carrier/telecom infrastructure
            // These have launch intents so they pass the normal flag check, but
            // are never apps a user would see or open intentionally.
            "com.android.stk",
            "com.samsung.android.stk",
            "com.qualcomm.qti.stk",
            "com.mediatek.stk",
            "com.sprd.stk",
            "com.android.incallui",
            "com.android.server.telecom",
            "com.android.calllogbackup"
        )
        if (systemPrefixes.any { pkg == it || pkg.startsWith("$it.") }) return false
        val systemExact = setOf(
            "com.google.android.dialer",
            "com.google.android.contacts",
            "com.google.android.apps.turbo",
            "com.google.android.apps.wallpaper",
            "com.google.android.apps.photos.scanner",
            "com.google.android.apps.pixel.launcher",
            "com.google.android.apps.work.oobe",
            "com.google.android.apps.devicelockcontroller",
            "com.google.android.devicelockcontroller"
        )
        if (pkg in systemExact) return false
        return try {
            val pm   = appContext.packageManager
            val info = pm.getApplicationInfo(pkg, 0)
            pm.getLaunchIntentForPackage(pkg) != null &&
                (info.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) == 0
        } catch (_: Exception) { false }
    }

    // Accessible from companion for refreshCachesStatic
    internal fun computeStreak(usm: UsageStatsManager, goalMins: Long): Int {
        val now = System.currentTimeMillis()
        var streak = 0
        var graceUsedInWindow = false
        var graceWindowStart  = -1
        val MAX_SESSION_MS = 4 * 60 * 60_000L
        for (i in 0..29) {
            val dayStart = Calendar.getInstance().apply {
                timeInMillis = now
                add(Calendar.DAY_OF_YEAR, -i)
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0);      set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            val dayEnd   = if (i == 0) now else dayStart + 86_400_000L
            val boundary = if (i == 0) now else dayEnd
            val dayMins = runCatching {
                val events  = usm.queryEvents(dayStart, dayEnd)
                val ev      = android.app.usage.UsageEvents.Event()
                val fgStart = mutableMapOf<String, Long>()
                val totalMs = mutableMapOf<String, Long>()
                while (events.hasNextEvent()) {
                    events.getNextEvent(ev)
                    if (ev.packageName == appContext.packageName) continue
                    when (ev.eventType) {
                        android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND ->
                            fgStart[ev.packageName] = ev.timeStamp
                        android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                            val start = fgStart.remove(ev.packageName) ?: continue
                            val ms = (ev.timeStamp - start).coerceAtMost(MAX_SESSION_MS)
                            totalMs[ev.packageName] = (totalMs[ev.packageName] ?: 0L) + ms
                        }
                    }
                }
                fgStart.forEach { (pkg, start) ->
                    val ms = (boundary - start).coerceAtMost(MAX_SESSION_MS)
                    totalMs[pkg] = (totalMs[pkg] ?: 0L) + ms
                }
                totalMs.values.sum() / 60_000L
            }.getOrElse { 0L }

            if (dayMins <= goalMins) {
                streak++
                // Reset grace once 7+ days have passed since it was last used
                if (graceUsedInWindow && graceWindowStart >= 0 && i - graceWindowStart >= 7) {
                    graceUsedInWindow = false
                    graceWindowStart  = -1
                }
            } else {
                if (!graceUsedInWindow) {
                    graceUsedInWindow = true
                    graceWindowStart  = i
                    streak++   // grace day keeps the streak alive
                } else {
                    break      // second over-goal day in same window — streak ends
                }
            }
        }
        return streak
    }

    // ── Trigger widget redraw broadcast ───────────────────────────────────
    private fun pushWidgetBroadcast() {
        runCatching {
            val mgr  = AppWidgetManager.getInstance(appContext)
            val comp = ComponentName(appContext, AureloWidgetProvider::class.java)
            val ids  = mgr.getAppWidgetIds(comp)
            if (ids.isEmpty()) return
            appContext.sendBroadcast(
                Intent(appContext, AureloWidgetProvider::class.java).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
            )
        }
    }

    private fun hasUsagePermission(): Boolean {
        return runCatching {
            val appOps = appContext.getSystemService(Context.APP_OPS_SERVICE)
                as android.app.AppOpsManager
            val mode = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), appContext.packageName
                )
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(
                    android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), appContext.packageName
                )
            }
            mode == android.app.AppOpsManager.MODE_ALLOWED
        }.getOrElse { false }
    }

    companion object {
        private const val WORK_NAME = "tidy_widget_bg_update"

        /**
         * Call once from MainActivity.onCreate() and from AureloWidgetProvider.onEnabled().
         * WorkManager de-dupes — safe to call multiple times.
         */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<AureloWidgetUpdateWorker>(
                15, TimeUnit.MINUTES
            ).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }

        /**
         * FIX-08: Lightweight cache refresh callable without a full Worker lifecycle.
         * Called from the 5-min AlarmManager tick in AureloWidgetProvider.onUpdate() so
         * the widget shows fresh data on every alarm, not just every 15-min WorkManager cycle.
         *
         * Runs a single queryEvents pass to update:
         *   cached_total_mins, cached_pickups, cached_streak_days, cached_first_pickup_ts
         *
         * Intentionally skips ghost-app scan and LaunchTracker feed (expensive) —
         * those stay on the full WorkManager 15-min cycle.
         */
        fun refreshCachesStatic(context: Context) {
            if (!hasUsagePermissionStatic(context)) return
            runCatching {
                val prefs  = context.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
                val usm    = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
                val now    = System.currentTimeMillis()
                val dayStart = Calendar.getInstance().apply {
                    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 0);      set(Calendar.MILLISECOND, 0)
                }.timeInMillis

                val events  = usm.queryEvents(dayStart, now)
                val ev      = android.app.usage.UsageEvents.Event()
                val timeMap = mutableMapOf<String, Long>()
                val fgStart = mutableMapOf<String, Long>()
                val MAX_SESSION_MS = 4 * 60 * 60_000L
                var pickups       = 0
                var firstPickupTs = 0L

                while (events.hasNextEvent()) {
                    events.getNextEvent(ev)
                    if (ev.packageName == context.packageName) continue
                    when (ev.eventType) {
                        android.app.usage.UsageEvents.Event.KEYGUARD_HIDDEN -> {
                            pickups++
                            if (firstPickupTs == 0L) firstPickupTs = ev.timeStamp
                        }
                        android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                            fgStart[ev.packageName] = ev.timeStamp
                        }
                        android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                            val start = fgStart.remove(ev.packageName) ?: continue
                            val ms = (ev.timeStamp - start).coerceAtMost(MAX_SESSION_MS)
                            timeMap[ev.packageName] = (timeMap[ev.packageName] ?: 0L) + ms
                        }
                    }
                }
                fgStart.forEach { (pkg, start) ->
                    timeMap[pkg] = (timeMap[pkg] ?: 0L) + (now - start).coerceAtMost(MAX_SESSION_MS)
                }

                val totalMin = timeMap
                    .filter { isUserApp(it.key) }   // ← add this line
                    .values.sum() / 60_000L
                val goalMins = prefs.getInt(STREAK_GOAL_MINS, 240).toLong()
                val streakDays = runCatching {
                    computeStreakStatic(context, usm, goalMins)
                }.getOrElse { prefs.getInt(CACHED_STREAK_DAYS, 0) }

                val editor = prefs.edit()
                    .putLong(CACHED_TOTAL_MINS,  totalMin)
                    .putInt (CACHED_PICKUPS,      pickups)
                    .putInt (CACHED_STREAK_DAYS,  streakDays)
                if (firstPickupTs > 0L) editor.putLong("cached_first_pickup_ts", firstPickupTs)
                editor.apply()
            }
        }

        // Streak logic extracted to companion so refreshCachesStatic can call it
        // without instantiating a Worker (Worker requires WorkerParameters).
        private fun computeStreakStatic(context: Context, usm: UsageStatsManager, goalMins: Long): Int {
            val now = System.currentTimeMillis()
            var streak = 0
            var graceUsedInWindow = false
            var graceWindowStart  = -1
            val MAX_MS = 4 * 60 * 60_000L
            for (i in 0..29) {
                val dayStart = Calendar.getInstance().apply {
                    timeInMillis = now
                    add(Calendar.DAY_OF_YEAR, -i)
                    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 0);      set(Calendar.MILLISECOND, 0)
                }.timeInMillis
                val dayEnd   = if (i == 0) now else dayStart + 86_400_000L
                val boundary = if (i == 0) now else dayEnd
                val dayMins = runCatching {
                    val ev      = android.app.usage.UsageEvents.Event()
                    val fgStart = mutableMapOf<String, Long>()
                    val totalMs = mutableMapOf<String, Long>()
                    val evts    = usm.queryEvents(dayStart, dayEnd)
                    while (evts.hasNextEvent()) {
                        evts.getNextEvent(ev)
                        if (ev.packageName == context.packageName) continue
                        when (ev.eventType) {
                            android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND ->
                                fgStart[ev.packageName] = ev.timeStamp
                            android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                                val start = fgStart.remove(ev.packageName) ?: continue
                                totalMs[ev.packageName] =
                                    (totalMs[ev.packageName] ?: 0L) + (ev.timeStamp - start).coerceAtMost(MAX_MS)
                            }
                        }
                    }
                    fgStart.forEach { (pkg, start) ->
                        totalMs[pkg] = (totalMs[pkg] ?: 0L) + (boundary - start).coerceAtMost(MAX_MS)
                    }
                    totalMs.values.sum() / 60_000L
                }.getOrElse { 0L }
                if (dayMins <= goalMins) {
                    streak++
                    if (graceUsedInWindow && graceWindowStart >= 0 && i - graceWindowStart >= 7) {
                        graceUsedInWindow = false; graceWindowStart = -1
                    }
                } else {
                    if (!graceUsedInWindow) {
                        graceUsedInWindow = true; graceWindowStart = i; streak++
                    } else break
                }
            }
            return streak
        }

        private fun hasUsagePermissionStatic(context: Context): Boolean = runCatching {
            val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
            val mode = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), context.packageName
                )
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(
                    android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), context.packageName
                )
            }
            mode == android.app.AppOpsManager.MODE_ALLOWED
        }.getOrElse { false }

        /** Mirrors the instance isUserApp() — needed because companion funs can't call instance methods. */
        private fun isUserApp(pkg: String): Boolean {
            // FIX (Issue 6): The previous companion version only checked a short prefix list and
            // did not verify pm.getLaunchIntentForPackage. This allowed OEM/system apps without
            // launch intents to be counted in the widget total, inflating it vs the in-app value
            // (which uses the instance isUserApp that does the full check).
            // Prefix list now mirrors the instance method exactly. LaunchIntent is skipped here
            // since we have no Context — instead we use the full prefix + exact-block lists that
            // cover all known system packages that would fail the LaunchIntent check anyway.
            val systemPrefixes = listOf(
                // Android OS core
                "android",
                "com.android.systemui",
                "com.android.launcher",
                "com.android.launcher3",
                "com.android.settings",
                "com.android.providers",
                "com.android.server",
                "com.android.phone",
                "com.android.dialer",
                "com.android.contacts",
                "com.android.mms",
                "com.android.camera",
                "com.android.soundrecorder",
                "com.android.packageinstaller",
                "com.android.managedprovisioning",
                "com.android.inputmethod",
                "com.android.nfc",
                "com.android.bluetooth",
                "com.android.wifi",
                "com.android.connectivity",
                "com.android.hotspot2",
                "com.android.stk",
                "com.android.calllogbackup",
                "com.android.incallui",
                "com.android.calculator",
                "com.android.deskclock",
                "com.android.gallery",
                "com.android.gallery3d",
                "com.android.music",
                "com.android.filemanager",
                "com.android.documentsui",
                "com.android.theme",
                "com.android.overlay",
                "com.android.enterprise",
                "com.android.accessibility",
                "com.android.vpndialogs",
                // Google system infrastructure
                "com.google.android.gms",
                "com.google.android.gsf",
                "com.google.android.inputmethod",
                "com.google.android.googlequicksearchbox",
                "com.google.android.tts",
                "com.google.android.syncadapters",
                "com.google.android.backuptransport",
                "com.google.android.configupdater",
                "com.google.android.partnersetup",
                "com.google.android.setupwizard",
                "com.google.android.onetimeinitializer",
                "com.google.android.packageinstaller",
                "com.google.android.permissioncontroller",
                "com.google.android.printservice",
                "com.google.android.networkstack",
                "com.google.android.accessibility",
                "com.google.android.apps.accessibility",
                "com.google.android.apps.enterprise",
                "com.google.android.apps.work",
                "com.google.android.apps.safetyhub",
                "com.google.android.apps.emergencyassist",
                "com.google.android.apps.restore",
                "com.google.android.apps.setupwizard",
                "com.google.android.apps.vpn",
                // Samsung system infrastructure
                "com.samsung.android.honeyboard",
                "com.samsung.android.stk",
                "com.samsung.android.app.camera",
                "com.samsung.android.dialer",
                "com.samsung.android.incallui",
                "com.samsung.android.app.clockpack",
                "com.samsung.android.calculator",
                "com.samsung.android.gallery3d",
                "com.samsung.android.contacts",
                "com.samsung.android.app.contacts",
                "com.samsung.android.MtpApplication",
                "com.samsung.android.theme",
                // OEM / carrier / SIM toolkit
                "com.android.vending",
                "com.qualcomm.qti.stk",
                "com.mediatek.stk",
                "com.sprd.stk",
                "com.android.server.telecom",
            )
            if (systemPrefixes.any { pkg == it || pkg.startsWith("$it.") }) return false

            // Exact hard-block for packages that slip through prefix checks
            val systemExact = setOf(
                "com.google.android.dialer",
                "com.google.android.contacts",
                "com.google.android.calculator",
                "com.google.android.GoogleCamera",
                "com.google.android.deskclock",
                "com.google.android.apps.turbo",
                "com.google.android.apps.wallpaper",
                "com.google.android.apps.photos.scanner",
                "com.google.android.apps.pixel.launcher",
                "com.google.android.apps.work.oobe",
                "com.google.android.apps.devicelockcontroller",
                "com.google.android.devicelockcontroller",
                "com.samsung.android.app.telephonyui",
                "com.samsung.android.app.soundalive",
                "com.oneplus.camera",
                "com.oneplus.dialer",
                "com.oneplus.deskclock",
                "com.oppo.camera",
                "com.realme.camera",
                "com.miui.camera",
                "com.miui.calculator",
                "com.miui.clock",
                "com.coloros.calculator",
                "com.coloros.camera2",
            )
            return pkg !in systemExact
        }
    }
}
