package com.javikastudio.tidyapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import com.javikastudio.tidyapp.billing.EntitlementRepository
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import androidx.core.app.NotificationCompat
import org.json.JSONArray

/**
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  AppMonitorService                                                          │
 * │                                                                             │
 * │  Orchestrates: FocusBlockingEngine, TimerBlockingEngine,                   │
 * │  IntentionEngine, BedtimeBlockingEngine, ScreenFilterEngine.               │
 * │                                                                             │
 * │  Single foreground notification (NOTIF_ID 6001) covers all states:         │
 * │    • Wind-down (filter fading in 0→100% over 30 min, snooze + turn-off)   │
 * │    • Bedtime active (snooze blocked during snooze, turn-off)               │
 * │    • Focus session, timer limit, standalone filter, mindful pause          │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
class AppMonitorService : Service() {

    // ── Constants ─────────────────────────────────────────────────────────────
    companion object {
        const val CHANNEL_ID = "tidy_app_monitor"
        const val NOTIF_ID   = 6001
        const val POLL_MS    = 500L
        const val GRACE_MS   = 5 * 60_000L

        // ── Intent actions ─────────────────────────────────────────────────────
        const val ACTION_FOCUS_START          = "FOCUS_START"
        const val ACTION_FOCUS_STOP           = "FOCUS_STOP"
        const val ACTION_FOCUS_UPDATE         = "FOCUS_UPDATE"
        const val ACTION_TIMER_BLOCK          = "TIMER_BLOCK"
        const val ACTION_INTENTION_START      = "INTENTION_START"
        const val ACTION_INTENTION_STOP       = "INTENTION_STOP"
        const val ACTION_STOP_ALL             = "STOP_ALL"
        const val ACTION_BEDTIME_START        = "START_BEDTIME"
        const val ACTION_BEDTIME_STOP         = "STOP_BEDTIME"
        const val ACTION_BEDTIME_UPDATE       = "UPDATE_BEDTIME"
        const val ACTION_BEDTIME_SNOOZE       = "SNOOZE_BEDTIME"
        const val ACTION_BEDTIME_SNOOZE_CLEAR = "SNOOZE_BEDTIME_CLEAR"
        const val ACTION_BEDTIME_STOP_SOFT    = "STOP_BEDTIME_SOFT"

        // Wind-down phase actions (pre-bedtime, 30 min before BEDTIME_ON)
        // ACTION_BEDTIME_WINDOWN: fired by BedtimeReceiver instead of postWindDownNotification().
        //   Sets BEDTIME_WINDOWN_START_TS, starts filter fade, service foreground notification
        //   becomes the sole wind-down notification — eliminating the duplicate.
        const val ACTION_BEDTIME_WINDOWN = "BEDTIME_WINDOWN_START"
        // ACTION_WINDOWN_SNOOZE: pauses the filter fade for 15 min, pushes windDownStartTs
        //   forward by 15 min so the "X min to bedtime" timer stays accurate.
        const val ACTION_WINDOWN_SNOOZE  = "WINDOWN_SNOOZE"
        // ACTION_WINDOWN_STOP: stops the filter, clears wind-down state, cancels tonight's
        //   BEDTIME_ON alarm so bedtime does not auto-start.
        const val ACTION_WINDOWN_STOP    = "WINDOWN_STOP"

        const val ACTION_FILTER_START   = "FILTER_START"
        const val ACTION_FILTER_STOP    = "FILTER_STOP"
        const val ACTION_FILTER_UPDATE  = "FILTER_UPDATE"
        /** Stops the filter AND sets enabled=false in prefs so the schedule won't restart it. */
        const val ACTION_FILTER_DISABLE = "FILTER_DISABLE"

        // Direct engine reference — set once in onCreate, cleared in onDestroy.
        @Volatile var filterEngineInstance: ScreenFilterEngine? = null

        // Overlay priority levels — lower number = higher priority
        const val PRIORITY_BEDTIME   = 0
        const val PRIORITY_FOCUS     = 1
        const val PRIORITY_TIMER     = 2
        const val PRIORITY_INTENTION = 3

        // Wind-down phase duration in ms — must match the 30-min alarm offset in BedtimeBridge
        private const val WINDOWN_DURATION_MS = 30L * 60_000L
    }

    // ── Core infrastructure ───────────────────────────────────────────────────
    private lateinit var prefs:           SharedPreferences
    private lateinit var entitlementRepo: EntitlementRepository   // authoritative Pro source
    private lateinit var wm:      WindowManager
    private lateinit var handler: Handler
    private lateinit var nm:      NotificationManager
    private var pollScheduled = false

    // ── Overlay coordinator ───────────────────────────────────────────────────
    private val coordinator = OverlayCoordinator()

    // ── Engines — initialized in onCreate after helpers is ready ──────────────
    private lateinit var helpers:         EngineHelpers
    private lateinit var focusEngine:     FocusBlockingEngine
    private lateinit var timerEngine:     TimerBlockingEngine
    private lateinit var intentionEngine: IntentionEngine
    private lateinit var bedtimeEngine:   BedtimeBlockingEngine
    private lateinit var filterEngine:    ScreenFilterEngine

    // Foreground package resolved once per poll tick, shared across all engines
    private var currentFgPkg   = ""
    private var currentFgPkgTs = 0L

    // ── Poll runnable ─────────────────────────────────────────────────────────
    private val pollRunnable = object : Runnable {
        override fun run() {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            val now = System.currentTimeMillis()

            if (usm != null && hasUsagePermission()) {
                val events = runCatching { usm.queryEvents(now - 5000L, now) }.getOrNull()
                var latestFgPkg = ""; var latestFgTs = 0L
                val bgTs = mutableMapOf<String, Long>()
                if (events != null) {
                    val ev = UsageEvents.Event()
                    while (events.hasNextEvent()) {
                        events.getNextEvent(ev)
                        when (ev.eventType) {
                            UsageEvents.Event.MOVE_TO_FOREGROUND ->
                                if (ev.timeStamp > latestFgTs) { latestFgPkg = ev.packageName; latestFgTs = ev.timeStamp }
                            UsageEvents.Event.MOVE_TO_BACKGROUND ->
                                bgTs[ev.packageName] = maxOf(bgTs[ev.packageName] ?: 0L, ev.timeStamp)
                        }
                    }
                }
                when {
                    latestFgTs > 0L -> {
                        if ((bgTs[latestFgPkg] ?: 0L) < latestFgTs) { currentFgPkg = latestFgPkg; currentFgPkgTs = latestFgTs }
                        else currentFgPkg = ""
                    }
                    currentFgPkg.isNotEmpty() -> { if ((bgTs[currentFgPkg] ?: 0L) > currentFgPkgTs) currentFgPkg = "" }
                }
            }

            bedtimeEngine.onTick(currentFgPkg, now)
            focusEngine.onTick(currentFgPkg, now)
            timerEngine.onTick(currentFgPkg, now)
            intentionEngine.onTick(currentFgPkg, now)

            // ── Wind-down snooze expiry ───────────────────────────────────────
            // When the user snoozed the wind-down, the filter is stopped. Once
            // the snooze expires, restart the gradual fade for remaining time.
            val windDownSnoozeUntil = prefs.getLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L)
            val windDownStartTs     = prefs.getLong(BEDTIME_WINDOWN_START_TS, 0L)
            val inWindDown          = windDownStartTs > 0L && (now - windDownStartTs) < WINDOWN_DURATION_MS
            if (inWindDown && windDownSnoozeUntil > 0L && now >= windDownSnoozeUntil && !filterEngine.isActive()) {
                prefs.edit().putLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L).apply()
                restartWindDownFilter(now, windDownStartTs)
            }

            // ── Screen Filter schedule tick ───────────────────────────────────
            // Guard: skip the schedule activation/stop logic while bedtime or wind-down
            // is managing the filter. Without this, the tick stops the 30-min wind-down
            // fade every 500 ms when the standalone schedule window doesn't include the
            // current time — leaving filterProgress stuck at 0 and the filter never visible.
            val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfg = if (!sfRaw.isNullOrBlank()) runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
            val bedtimeManagedInTick = (inWindDown || bedtimeEngine.isActive) &&
                    (sfCfg?.optBoolean("bedtimeAutoApply", true) != false)
            if (!bedtimeManagedInTick && sfCfg != null && sfCfg.optBoolean("enabled", false)) {
                val sfSchedule = sfCfg.optString("schedule", "none")
                if (sfSchedule != "none") {
                    val inWindow = isInsideFilterScheduleWindow(sfCfg)
                    if (inWindow && !filterEngine.isActive()) {
                        filterEngine.start(sfCfg.optInt("warmAlpha", 80), sfCfg.optInt("dimAlpha", 45),
                            sfCfg.optBoolean("fadeIn", true))
                        prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
                    } else if (!inWindow && filterEngine.isActive()) {
                        filterEngine.stop(sfCfg.optBoolean("fadeOut", true))
                        prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
                    }
                }
            }

            // ── Filter suspend/resume logic ───────────────────────────────────
            if (filterEngine.isActive()) {
                val anyOverlay = coordinator.activeView != null
                val isCam = currentFgPkg.isNotEmpty() && (
                        currentFgPkg.contains("camera", ignoreCase = true) ||
                                currentFgPkg.contains("cam.", ignoreCase = true) ||
                                currentFgPkg == "com.google.android.GoogleCamera" ||
                                try { packageManager.queryIntentActivities(Intent("android.media.action.IMAGE_CAPTURE"), 0)
                                    .any { it.activityInfo.packageName == currentFgPkg } } catch (_: Exception) { false }
                        )
                val isExcluded = currentFgPkg.isNotEmpty() &&
                        (sfCfg?.optJSONArray("excludedApps")?.let { arr ->
                            (0 until arr.length()).any { arr.optString(it) == currentFgPkg } } ?: false)
                if (anyOverlay || isCam || isExcluded) filterEngine.suspend()
                else {
                    filterEngine.resumeFilter()
                    // FIX-3: Don't call update() while bedtime or wind-down is managing the
                    // filter — update() calls handler.removeCallbacksAndMessages() which
                    // cancels the 30-min gradual fade and snaps intensity to 100% immediately.
                    // During standalone scheduled-filter use, update() is still needed to
                    // sync warmAlpha/dimAlpha if the user changed settings mid-session.
                    val bedtimeManaged = (inWindDown || bedtimeEngine.isActive) &&
                            (sfCfg?.optBoolean("bedtimeAutoApply", true) != false)
                    if (!bedtimeManaged) {
                        filterEngine.update(
                            sfCfg?.optInt("warmAlpha", 80) ?: 80,
                            sfCfg?.optInt("dimAlpha", 45) ?: 45
                        )
                    }
                }
            }

            nm.notify(NOTIF_ID, buildNotification(now))

            if (!focusEngine.isActive && !timerEngine.isActive && !intentionEngine.isActive &&
                !bedtimeEngine.isActive && !filterEngine.isActive() && !inWindDown) {
                pollScheduled = false; stopSelf(); return
            }
            handler.postDelayed(this, POLL_MS)
        }
    }

    // ── Broadcast receiver ────────────────────────────────────────────────────
    private val controlReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                "${ctx.packageName}.FOCUS_STOP_BROADCAST"   -> focusEngine.stop()
                "${ctx.packageName}.INTENTION_APPS_CHANGED" -> intentionEngine.reloadConfig()
                "${ctx.packageName}.INTENTION_STOP"         -> intentionEngine.disable()
                "${ctx.packageName}.BEDTIME_STOP_BROADCAST" -> bedtimeEngine.stop()
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        prefs            = getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
        entitlementRepo  = EntitlementRepository(this)
        wm      = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        handler = Handler(Looper.getMainLooper())
        nm      = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannel()

        helpers         = EngineHelpers()
        focusEngine     = FocusBlockingEngine(prefs, coordinator, helpers)
        timerEngine     = TimerBlockingEngine(prefs, coordinator, helpers)
        intentionEngine = IntentionEngine(prefs, coordinator, helpers)
        bedtimeEngine   = BedtimeBlockingEngine(prefs, coordinator, helpers)
        filterEngine    = ScreenFilterEngine(this, wm, prefs)
        filterEngineInstance = filterEngine

        val filter = IntentFilter().apply {
            addAction("${packageName}.FOCUS_STOP_BROADCAST")
            addAction("${packageName}.INTENTION_APPS_CHANGED")
            addAction("${packageName}.INTENTION_STOP")
            addAction("${packageName}.BEDTIME_STOP_BROADCAST")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            registerReceiver(controlReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else @Suppress("UnspecifiedRegisterReceiverFlag") registerReceiver(controlReceiver, filter)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_FOCUS_START     -> focusEngine.start(intent)
            ACTION_FOCUS_UPDATE    -> focusEngine.update(intent)
            ACTION_FOCUS_STOP      -> focusEngine.stop()
            ACTION_TIMER_BLOCK     -> timerEngine.addBlock(intent)
            ACTION_INTENTION_START -> intentionEngine.enable()
            ACTION_INTENTION_STOP  -> intentionEngine.disable()
            ACTION_BEDTIME_START   -> bedtimeEngine.start(intent)
            ACTION_BEDTIME_UPDATE  -> bedtimeEngine.update(intent)

            // ── Bedtime Turn Off: stops engine + filter + DND ─────────────────
            ACTION_BEDTIME_STOP -> {
                bedtimeEngine.stop(wasNatural = false)
                val sfAutoApply = runCatching {
                    org.json.JSONObject(prefs.getString(SCREEN_FILTER_SETTINGS_V1, "{}") ?: "{}")
                        .optBoolean("bedtimeAutoApply", true)
                }.getOrDefault(true)
                if (sfAutoApply) {
                    filterEngine.stop(fadeOut = false)
                    prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
                }
                prefs.edit().putLong(BEDTIME_WINDOWN_START_TS, 0L)
                    .putLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L)
                    // BUG-2 FIX: clear the exact bedtime epoch so it doesn't linger
                    // into the next wind-down window.
                    .putLong(BEDTIME_STARTS_AT_MS, 0L)
                    .putBoolean(BEDTIME_ACTIVE, false)
                    // FIX: clear BEDTIME_ACTIVE so isBedtimeFilterManaged() returns false
                    // immediately after the notification Turn Off button is pressed.
                    .putBoolean(BEDTIME_ACTIVE, false)
                    // FIX: mark as skipped-tonight so JS render() shows "Starts tomorrow"
                    // instead of "Bedtime Active" when the user opens the app.
                    // Cleared when BEDTIME_ON fires at the start of the next night.
                    .putBoolean(BEDTIME_SKIPPED_TONIGHT, true)
                    .apply()
                runCatching {
                    val notifMgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    if (notifMgr.isNotificationPolicyAccessGranted)
                        notifMgr.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
                }
            }

            ACTION_BEDTIME_STOP_SOFT    -> bedtimeEngine.stopSoft()
            ACTION_BEDTIME_SNOOZE       -> bedtimeEngine.snooze(intent.getIntExtra("snooze_mins", 15))
            ACTION_BEDTIME_SNOOZE_CLEAR -> bedtimeEngine.clearSnooze()

            // ── Wind-down start: replaces BedtimeReceiver.postWindDownNotification() ──
            // BedtimeReceiver sends this action instead of posting a separate notification.
            // The service becomes the single source of the foreground notification — no duplicate.
            ACTION_BEDTIME_WINDOWN -> {
                prefs.edit()
                    .putLong(BEDTIME_WINDOWN_START_TS, System.currentTimeMillis())
                    .putLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L)
                    .apply()
                startWindDownFilter()
            }

            // ── Wind-down Snooze 15 min ───────────────────────────────────────
            // Stops the filter fade. Pushes BEDTIME_WINDOWN_START_TS forward by 15 min
            // so the "X min to bedtime" countdown remains accurate after snooze ends.
            // The poll runnable restarts the fade when BEDTIME_WINDOWN_SNOOZE_UNTIL_TS expires.
            ACTION_WINDOWN_SNOOZE -> {
                val now       = System.currentTimeMillis()
                val snoozeDur = 15L * 60_000L
                val oldStart  = prefs.getLong(BEDTIME_WINDOWN_START_TS, now)
                prefs.edit()
                    .putLong(BEDTIME_WINDOWN_START_TS,        oldStart + snoozeDur)
                    .putLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, now + snoozeDur)
                    .apply()
                filterEngine.stop(fadeOut = false)
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
            }

            // ── Wind-down Turn Off: stops filter + clears state + cancels BEDTIME_ON ──
            ACTION_WINDOWN_STOP -> {
                filterEngine.stop(fadeOut = false)
                prefs.edit()
                    .putBoolean(SCREEN_FILTER_ACTIVE, false)
                    .putLong(BEDTIME_WINDOWN_START_TS, 0L)
                    .putLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L)
                    .putLong(BEDTIME_STARTS_AT_MS, 0L)
                    .apply()
                cancelTonightBedtimeAlarm()
            }

            // ── Screen filter ─────────────────────────────────────────────────
            ACTION_FILTER_START -> {
                val w    = intent.getIntExtra("filter_warm", 60)
                val d    = intent.getIntExtra("filter_dim",  30)
                val g    = intent.getBooleanExtra("filter_gradual", false)
                val step = intent.getLongExtra("filter_step_ms", 0L)
                // SF-012 / SF-013: forward preset and custom RGB so ScreenFilterEngine
                // renders the correct tint colour (warm=orange, night=deep-red, custom=RGB).
                val preset  = intent.getStringExtra("filter_preset") ?: ScreenFilterEngine.PRESET_WARM
                val customR = intent.getIntExtra("filter_custom_r", 255)
                val customG = intent.getIntExtra("filter_custom_g", 100)
                val customB = intent.getIntExtra("filter_custom_b", 0)
                if (step > 0L) filterEngine.start(w, d, g, step, preset, customR, customG, customB)
                else           filterEngine.start(w, d, g, preset = preset, customR = customR, customG = customG, customB = customB)
                // SF-STRIP-FIX: mark filter as active in prefs so JS renderActiveStrip()
                // (called from N.isScreenFilterActive()) shows the habits-tab compact strip.
                // Previously only the bedtime wind-down / schedule paths set this flag.
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
            }
            ACTION_FILTER_UPDATE -> filterEngine.update(
                intent.getIntExtra("filter_warm", 60), intent.getIntExtra("filter_dim", 30))
            ACTION_FILTER_STOP    -> filterEngine.stop()
            ACTION_FILTER_DISABLE -> {
                filterEngine.stop(fadeOut = false)
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
                val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                if (!sfRaw.isNullOrBlank()) runCatching {
                    val obj = org.json.JSONObject(sfRaw); obj.put("enabled", false)
                    prefs.edit().putString(SCREEN_FILTER_SETTINGS_V1, obj.toString()).apply()
                }
            }
            ACTION_STOP_ALL -> {
                bedtimeEngine.stop(); focusEngine.stop(); timerEngine.clearAll()
                intentionEngine.disable(); filterEngine.stop(fadeOut = false)
                prefs.edit().putLong(BEDTIME_WINDOWN_START_TS, 0L)
                    .putLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L).apply()
                stopSelf(); return START_NOT_STICKY
            }
            null -> {
                focusEngine.restoreFromPrefs(); timerEngine.restoreFromPrefs()
                intentionEngine.restoreFromPrefs(); bedtimeEngine.restoreFromPrefs()
                filterEngine.restoreFromPrefs()
                // WIND-DOWN-FIX: if the service was killed mid wind-down, restoreFromPrefs()
                // reads manual filter settings (enabled=false for most users) and skips
                // restarting the overlay — so progress stays 0% until the snooze-expiry
                // branch fires, which never happens because there's no snooze active.
                // Detect this and restart the gradual fade for whatever time remains.
                val _nowRestore  = System.currentTimeMillis()
                val _wdStart     = prefs.getLong(BEDTIME_WINDOWN_START_TS, 0L)
                val _inWD        = _wdStart > 0L && (_nowRestore - _wdStart) < WINDOWN_DURATION_MS
                val _wdSnoozeUntil = prefs.getLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L)
                if (_inWD && _wdSnoozeUntil <= _nowRestore && !filterEngine.isActive()) {
                    restartWindDownFilter(_nowRestore, _wdStart)
                }
                if (!pollScheduled) { pollScheduled = true; handler.post(pollRunnable) }
            }
        }

        startForeground(NOTIF_ID, buildNotification(System.currentTimeMillis()))
        if (!pollScheduled) { pollScheduled = true; handler.post(pollRunnable) }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        pollScheduled = false
        handler.removeCallbacksAndMessages(null)
        coordinator.forceRemove()
        runCatching { unregisterReceiver(controlReceiver) }
        focusEngine.onDestroy(); timerEngine.onDestroy(); intentionEngine.onDestroy()
        bedtimeEngine.onDestroy(); filterEngine.onDestroy()
        filterEngineInstance = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── OverlayCoordinator ────────────────────────────────────────────────────

    inner class OverlayCoordinator {
        var activeView:     View? = null; private set
        var activePriority: Int   = Int.MAX_VALUE; private set

        fun show(priority: Int, view: View): Boolean {
            if (activeView != null && priority >= activePriority) return false
            forceRemove()
            filterEngineInstance?.suspend()
            return runCatching {
                wm.addView(view, overlayLayoutParams())
                activeView = view; activePriority = priority; true
            }.getOrDefault(false)
        }
        fun dismiss(priority: Int) { if (activePriority != priority) return; forceRemove() }
        fun isShowing(priority: Int) = activeView != null && activePriority == priority
        fun forceRemove() {
            activeView?.let { runCatching { wm.removeView(it) } }
            activeView = null; activePriority = Int.MAX_VALUE
        }
    }

    // ── EngineHelpers ─────────────────────────────────────────────────────────

    inner class EngineHelpers {
        val context: Context               get() = this@AppMonitorService
        val nm: NotificationManager        get() = this@AppMonitorService.nm
        val channelId: String              get() = CHANNEL_ID
        val notifId: Int                   get() = NOTIF_ID
        val packageName: String            get() = this@AppMonitorService.packageName
        val packageManager: PackageManager get() = this@AppMonitorService.packageManager

        fun isFocusBlockingPackage(pkg: String): Boolean = focusEngine.isBlockingPackage(pkg)
        fun vibrate(pattern: LongArray)    = this@AppMonitorService.vibrate(pattern)
        fun canDrawOverlay(): Boolean      = this@AppMonitorService.canDrawOverlay()
        fun dpToPx(dp: Int): Int           = this@AppMonitorService.dpToPx(dp)
        fun pendingFlags(): Int             = this@AppMonitorService.pendingFlags()
        fun notifyJs(js: String)           = this@AppMonitorService.notifyJs(js)
        fun linearWrap(g: Int = Gravity.NO_GRAVITY): LinearLayout.LayoutParams = this@AppMonitorService.linearWrap(g)
        fun linearFill(): LinearLayout.LayoutParams = this@AppMonitorService.linearFill()
        fun startActivity(intent: Intent)  = this@AppMonitorService.startActivity(intent)
        fun updateNotification(title: String, body: String) = this@AppMonitorService.updateNotification(title, body)
        fun buildAureloWordmarkView(): View = this@AppMonitorService.buildAureloWordmarkView()
    }

    // ── Filter schedule helpers ───────────────────────────────────────────────

    private fun isInsideFilterScheduleWindow(sfCfg: org.json.JSONObject): Boolean {
        val schedule = sfCfg.optString("schedule", "none")
        if (schedule == "none" || schedule.isBlank()) return true
        val cal    = java.util.Calendar.getInstance()
        val dayIdx = cal.get(java.util.Calendar.DAY_OF_WEEK) - 1
        val schedDays = sfCfg.optJSONArray("schedDays")
        if (schedDays != null && schedDays.length() == 7 && schedDays.optInt(dayIdx, 1) == 0) return false
        val nowMin = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        val startH: Int; val startM: Int; val endH: Int; val endM: Int
        if (schedule == "sun") {
            if (!sfCfg.has("sunsetHour") || !sfCfg.has("sunriseHour")) return false
            startH = sfCfg.optInt("sunsetHour", 21); startM = sfCfg.optInt("sunsetMin",  0)
            endH   = sfCfg.optInt("sunriseHour", 7); endM   = sfCfg.optInt("sunriseMin", 0)
        } else {
            startH = sfCfg.optInt("schedStartHour", 21); startM = sfCfg.optInt("schedStartMin", 0)
            endH   = sfCfg.optInt("schedEndHour",    7); endM   = sfCfg.optInt("schedEndMin",   0)
        }
        val startMin = startH * 60 + startM; val endMin = endH * 60 + endM
        return if (startMin > endMin) nowMin >= startMin || nowMin < endMin
        else nowMin >= startMin && nowMin < endMin
    }

    // ── Wind-down helpers ─────────────────────────────────────────────────────

    /**
     * Reads screen filter settings and starts a gradual fade timed to fill exactly
     * 30 minutes. Called both for the initial start (ACTION_BEDTIME_WINDOWN) and
     * after a wind-down snooze expires.
     */
    private fun startWindDownFilter() {
        val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
        val sfCfg = if (!sfRaw.isNullOrBlank()) runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
        // CB-014 FIX: bedtime auto-filter is PRO-only.
        // BUG FIX: previously read IS_PRO_USER from "tidyapp_v6" prefs — a key that is
        // only written when the app is in the foreground and billing resolves. The wind-down
        // alarm fires in the background, so that key was stale/missing → filter never started.
        // EntitlementRepository reads from the authoritative encrypted store ("tidyapp_entitlement_v1")
        // which is written at purchase time and survives background/process-death correctly.
        if (!entitlementRepo.isPro) return
        if (sfCfg?.optBoolean("bedtimeAutoApply", true) == false) return
        if (sfCfg?.optBoolean("fadeIn", true) == false) return
        val (w, d)  = windDownPresetAlpha(sfCfg)
        val stepMs  = (WINDOWN_DURATION_MS / maxOf(w, d, 1).toLong()).coerceAtLeast(1L)
        // SF-012 / SF-013: resolve preset colour for the wind-down filter.
        val wdPreset = sfCfg?.optString("bedtimePreset", ScreenFilterEngine.PRESET_WARM) ?: ScreenFilterEngine.PRESET_WARM
        val wdCustR  = sfCfg?.optInt("bedtimeCustomR", 255) ?: 255
        val wdCustG  = sfCfg?.optInt("bedtimeCustomG", 100) ?: 100
        val wdCustB  = sfCfg?.optInt("bedtimeCustomB", 0)   ?: 0
        filterEngine.start(w, d, gradual = true, stepMs = stepMs,
            preset = wdPreset, customR = wdCustR, customG = wdCustG, customB = wdCustB)
        prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
    }

    /**
     * Restarts the filter fade after a wind-down snooze expires, covering only
     * the remaining time (total window - elapsed since original start).
     */
    private fun restartWindDownFilter(now: Long, windDownStartTs: Long) {
        val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
        val sfCfg = if (!sfRaw.isNullOrBlank()) runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
        // CB-014 FIX: PRO gate mirrors startWindDownFilter.
        // BUG FIX: same stale-key issue as startWindDownFilter — use entitlementRepo.
        if (!entitlementRepo.isPro) return
        if (sfCfg?.optBoolean("bedtimeAutoApply", true) == false) return
        if (sfCfg?.optBoolean("fadeIn", true) == false) return
        val (w, d)      = windDownPresetAlpha(sfCfg)
        val elapsedMs   = (now - windDownStartTs).coerceIn(0L, WINDOWN_DURATION_MS)
        val remainingMs = (WINDOWN_DURATION_MS - elapsedMs).coerceAtLeast(60_000L)
        // Progress up to where we were when snooze was pressed
        val startAlphaFraction = (elapsedMs.toFloat() / WINDOWN_DURATION_MS).coerceIn(0f, 1f)
        val stepMs = (remainingMs / maxOf(
            (w * (1f - startAlphaFraction)).toInt(),
            (d * (1f - startAlphaFraction)).toInt(),
            1
        ).toLong()).coerceAtLeast(1L)
        // SF-012 / SF-013: resolve preset colour for the resumed wind-down filter.
        val rwdPreset = sfCfg?.optString("bedtimePreset", ScreenFilterEngine.PRESET_WARM) ?: ScreenFilterEngine.PRESET_WARM
        val rwdCustR  = sfCfg?.optInt("bedtimeCustomR", 255) ?: 255
        val rwdCustG  = sfCfg?.optInt("bedtimeCustomG", 100) ?: 100
        val rwdCustB  = sfCfg?.optInt("bedtimeCustomB", 0)   ?: 0
        filterEngine.start(w, d, gradual = true, stepMs = stepMs,
            preset = rwdPreset, customR = rwdCustR, customG = rwdCustG, customB = rwdCustB)
        prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
    }

    private fun windDownPresetAlpha(sfCfg: org.json.JSONObject?): Pair<Int, Int> =
        when (sfCfg?.optString("bedtimePreset", "bedtime") ?: "bedtime") {
            "soft"   -> Pair(40, 15)
            "medium" -> Pair(65, 30)
            // SF-012: "night" preset — deep-red colour resolved in ScreenFilterEngine.
            "night"  -> Pair(80, 45)
            else     -> Pair(80, 45)   // "bedtime" / default
        }

    /** Cancels tonight's BEDTIME_ON alarm so bedtime doesn't auto-start after wind-down is turned off. */
    private fun cancelTonightBedtimeAlarm() {
        runCatching {
            val am    = getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE
            else PendingIntent.FLAG_NO_CREATE
            val pi = PendingIntent.getBroadcast(this, 7001,
                Intent("${packageName}.BEDTIME_ON").apply { setPackage(packageName) }, flags)
            pi?.let { am.cancel(it) }
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun buildNotification(now: Long): Notification {
        val openPi = packageManager.getLaunchIntentForPackage(packageName)?.let { i ->
            PendingIntent.getActivity(this, 0,
                i.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP },
                pendingFlags())
        }

        // ── 1. WIND-DOWN (pre-bedtime 30 min, filter fading in) ──────────────
        // Checked BEFORE bedtimeEngine.isActive because wind-down fires 30 min
        // before bedtime starts — bedtimeEngine is not yet active at that point.
        val windDownStartTs = prefs.getLong(BEDTIME_WINDOWN_START_TS, 0L)
        val inWindDown      = windDownStartTs > 0L && (now - windDownStartTs) < WINDOWN_DURATION_MS
        if (inWindDown && !bedtimeEngine.isActive) {
            val windDownSnoozeUntil = prefs.getLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L)
            val isWindDownSnoozed   = windDownSnoozeUntil > now

            // "X min to bedtime" — BUG-2 FIX: use the exact bedtime epoch stored
            // by BedtimeReceiver.BEDTIME_WINDOWN (from the configured hour:minute) so
            // the countdown matches the JS status bar exactly regardless of how late
            // doze-mode delivered the wind-down alarm.
            val bedtimeStartAt   = prefs.getLong(BEDTIME_STARTS_AT_MS, windDownStartTs + WINDOWN_DURATION_MS)
            val remainingToStart = (bedtimeStartAt - now) / 60_000L
            val minsLabel        = remainingToStart.coerceAtLeast(1L)

            // BUG-1 FIX: only show filter progress when "Fade in 30 min before" is on.
            // Read the fade-in flag from screen-filter settings — same source as
            // startWindDownFilter() uses. If fadeIn=false the filter never started,
            // so showing "Filter X%" and a progress bar would be misleading.
            val sfRawNotif = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfgNotif = if (!sfRawNotif.isNullOrBlank())
                runCatching { org.json.JSONObject(sfRawNotif) }.getOrNull() else null
            val fadeInEnabled     = sfCfgNotif?.optBoolean("fadeIn", true) != false
            val bedtimeAutoApply  = sfCfgNotif?.optBoolean("bedtimeAutoApply", true) != false
            val showFilterProgress = fadeInEnabled && bedtimeAutoApply

            // FIX-2: Wind-down notification is informational only — no Snooze or Turn Off
            // action buttons. Snooze & Turn Off are only shown when bedtime mode is active
            // (section 2 below). During wind-down the user can tap the notification to open
            // the app and manage the filter from there.
            return if (isWindDownSnoozed) {
                val snoozeRemainMins = ((windDownSnoozeUntil - now) / 60_000L).coerceAtLeast(1L)
                NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFFFFAA44.toInt())
                    .setContentTitle("🌅 Wind-down snoozed · ${minsLabel}m to bedtime")
                    .setContentText("Filter resumes in ${snoozeRemainMins}m · Tap to open Aurelo")
                    // Indeterminate bar while snoozed — shows activity without false progress
                    .setProgress(0, 0, true)
                    .setOngoing(true).setOnlyAlertOnce(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .apply { openPi?.let { setContentIntent(it) } }
                    .build()
            } else {
                // BUG-1 FIX: branch on whether "Fade in 30 min before" is enabled.
                // When fadeIn=false the filter never starts during wind-down, so the
                // notification must NOT show filter progress or the progress bar.
                if (showFilterProgress) {
                    val progress = (filterEngine.filterProgress * 100).toInt().coerceIn(0, 100)
                    NotificationCompat.Builder(this, CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFFFFAA44.toInt())
                        .setContentTitle("🌅 Bedtime in ${minsLabel}m · Filter ${progress}%")
                        .setContentText("Screen filter fading in gradually · Tap to open Aurelo")
                        // Live determinate progress bar: 0 → 100 over the 30-min window
                        .setProgress(100, progress, false)
                        .setOngoing(true).setOnlyAlertOnce(true)
                        .setPriority(NotificationCompat.PRIORITY_LOW)
                        .apply { openPi?.let { setContentIntent(it) } }
                        .build()
                } else {
                    // Plain reminder: bedtime in Xm, no filter info at all.
                    NotificationCompat.Builder(this, CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFFFFAA44.toInt())
                        .setContentTitle("🌅 Bedtime in ${minsLabel}m")
                        .setContentText("Wind-down reminder · Tap to open Aurelo")
                        .setOngoing(true).setOnlyAlertOnce(true)
                        .setPriority(NotificationCompat.PRIORITY_LOW)
                        .apply { openPi?.let { setContentIntent(it) } }
                        .build()
                }
            }
        }

        // ── 2. BEDTIME ACTIVE ─────────────────────────────────────────────────
        if (bedtimeEngine.isActive) {
            val snoozeUntilTs = prefs.getLong(BEDTIME_SNOOZE_UNTIL_TS, 0L)
            val isSnoozing    = snoozeUntilTs > now
            val stopPi = PendingIntent.getService(this, 11,
                Intent(this, AppMonitorService::class.java).apply { action = ACTION_BEDTIME_STOP },
                pendingFlags())
            return if (isSnoozing) {
                val snoozeRemainMins = ((snoozeUntilTs - now) / 60_000L).coerceAtLeast(1L)
                NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF6C63FF.toInt())
                    .setContentTitle("🌙 Bedtime snoozed · ${snoozeRemainMins}m remaining")
                    .setContentText("Blocking resumes after snooze · Tap to open Aurelo")
                    .setOngoing(true).setOnlyAlertOnce(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .apply { openPi?.let { setContentIntent(it) } }
                    // Snooze button hidden — can't snooze a snooze
                    .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Turn Off", stopPi)
                    .build()
            } else {
                val snoozePi = PendingIntent.getService(this, 12,
                    Intent(this, AppMonitorService::class.java).apply {
                        action = ACTION_BEDTIME_SNOOZE; putExtra("snooze_mins", 15)
                    }, pendingFlags())
                NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF6C63FF.toInt())
                    .setContentTitle("🌙 Bedtime Mode active")
                    .setContentText("Blocking distracting apps until morning")
                    .setOngoing(true).setOnlyAlertOnce(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .apply { openPi?.let { setContentIntent(it) } }
                    .addAction(android.R.drawable.ic_media_pause, "Snooze 15 min", snoozePi)
                    .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Turn Off", stopPi)
                    .build()
            }
        }

        // ── 3. FOCUS SESSION ──────────────────────────────────────────────────
        if (focusEngine.isActive) {
            val remaining  = ((prefs.getLong("focus_session_end_ts", 0L) - now) / 1000L).coerceAtLeast(0L)
            val difficulty = prefs.getString("focus_session_difficulty", "gentle") ?: "gentle"
            val modeLabel  = when (difficulty) { "firm" -> "Firm"; "deep" -> "Deep"; else -> "Gentle" }
            val stopPi = PendingIntent.getBroadcast(this, 1, Intent("${packageName}.FOCUS_STOP_BROADCAST"), pendingFlags())
            return NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_pause).setColor(0xFF6C63FF.toInt())
                .setContentTitle("🎯 $modeLabel Focus — ${String.format("%02d", remaining / 60)}:${String.format("%02d", remaining % 60)} remaining")
                .setContentText("Blocking distractions · Stay focused")
                .setOngoing(true).setOnlyAlertOnce(true).setPriority(NotificationCompat.PRIORITY_LOW)
                .apply { openPi?.let { setContentIntent(it) } }
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End Session", stopPi).build()
        }

        // ── 4. TIMER LIMIT ────────────────────────────────────────────────────
        if (timerEngine.isActive) {
            return NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert).setColor(0xFFF04E7A.toInt())
                .setContentTitle("⏱ Daily limit reached").setContentText("App limit enforced · Aurelo is watching")
                .setOngoing(true).setOnlyAlertOnce(true).setPriority(NotificationCompat.PRIORITY_LOW)
                .apply { openPi?.let { setContentIntent(it) } }.build()
        }

        // ── 5. STANDALONE SCREEN FILTER ───────────────────────────────────────
        if (filterEngine.isActive()) {
            val disablePi = PendingIntent.getService(this, 10,
                Intent(this, AppMonitorService::class.java).apply { action = ACTION_FILTER_DISABLE },
                pendingFlags())
            return NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF05C8E8.toInt())
                .setContentTitle("🌊 Screen Filter active").setContentText("Tap to manage in Aurelo")
                .setOngoing(true).setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_MIN).setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .apply { openPi?.let { setContentIntent(it) } }
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Turn Off", disablePi).build()
        }

        // ── 6. MINDFUL PAUSE (fallback) ───────────────────────────────────────
        val count = runCatching { JSONArray(prefs.getString("focus_intention_apps", "[]") ?: "[]").length() }.getOrDefault(0)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF12D48A.toInt())
            .setContentTitle("Mindful Pause active").setContentText("Pausing before $count app${if (count != 1) "s" else ""}")
            .setOngoing(true).setPriority(NotificationCompat.PRIORITY_MIN).setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .apply { openPi?.let { setContentIntent(it) } }.build()
    }

    internal fun updateNotification(title: String, body: String) {
        nm.notify(NOTIF_ID, NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF12D48A.toInt())
            .setContentTitle(title).setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT).setAutoCancel(true).build())
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Aurelo Monitor", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Focus sessions, app limits, bedtime, and mindful pause"
                    setShowBadge(false); lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun hasUsagePermission(): Boolean {
        val ops  = getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            ops.unsafeCheckOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
        else @Suppress("DEPRECATION")
        ops.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
        return mode == android.app.AppOpsManager.MODE_ALLOWED
    }

    private fun overlayLayoutParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, type,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START }
    }

    internal fun canDrawOverlay(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || android.provider.Settings.canDrawOverlays(this)

    internal fun dpToPx(dp: Int): Int = (dp * resources.displayMetrics.density + 0.5f).toInt()

    internal fun linearWrap(g: Int = Gravity.NO_GRAVITY) =
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.gravity = g }

    internal fun linearFill() =
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = dpToPx(8) }

    internal fun pendingFlags() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else PendingIntent.FLAG_UPDATE_CURRENT

    internal fun vibrate(pattern: LongArray) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager)
                    .defaultVibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
            else @Suppress("DEPRECATION")
            (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).vibrate(pattern, -1)
        }
    }

    internal fun notifyJs(js: String) {
        runCatching {
            val act = MainActivityRef.get() ?: return
            act.runOnUiThread { act.webView.evaluateJavascript(js, null) }
        }
    }

    internal fun buildAureloWordmarkView(): View {
        val logoSz   = dpToPx(24)
        val logoView = object : android.view.View(this) {
            private val archPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                style = android.graphics.Paint.Style.STROKE; strokeCap = android.graphics.Paint.Cap.ROUND }
            private val dotPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                style = android.graphics.Paint.Style.FILL }
            override fun onDraw(canvas: android.graphics.Canvas) {
                val sx = width / 108f; val sy = height / 108f
                canvas.save(); canvas.scale(sx, sy)
                val path = android.graphics.Path().apply {
                    moveTo(22f, 88f); cubicTo(22f, 88f, 30f, 30f, 54f, 20f); cubicTo(78f, 30f, 86f, 88f, 86f, 88f) }
                val archGrad = android.graphics.LinearGradient(28f, 20f, 80f, 90f,
                    intArrayOf(Color.rgb(255, 224, 130), Color.rgb(255, 170, 68), Color.rgb(255, 112, 32)),
                    floatArrayOf(0f, 0.55f, 1f), android.graphics.Shader.TileMode.CLAMP)
                archPaint.shader = archGrad; archPaint.strokeWidth = 7.5f; archPaint.alpha = 255
                canvas.drawPath(path, archPaint)
                archPaint.strokeWidth = 1.5f; archPaint.alpha = 128; canvas.drawPath(path, archPaint)
                dotPaint.shader = android.graphics.LinearGradient(48f, 22f, 60f, 34f,
                    intArrayOf(Color.rgb(255, 243, 192), Color.rgb(255, 208, 96)),
                    null, android.graphics.Shader.TileMode.CLAMP)
                canvas.drawCircle(54f, 20f, 5.5f, dotPaint); canvas.restore()
            }
        }
        val row = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM or Gravity.CENTER_VERTICAL }
        row.addView(logoView, android.widget.LinearLayout.LayoutParams(logoSz, logoSz).also {
            it.rightMargin = dpToPx(1); it.bottomMargin = dpToPx(1) })
        row.addView(android.widget.TextView(this).apply {
            text = "URELO"; textSize = 21f
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
            letterSpacing = 0.09f; setTextColor(Color.rgb(255, 224, 130))
        }, android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT))
        return row
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MainActivityRef — weak reference so service can call back to WebView
// ─────────────────────────────────────────────────────────────────────────────
object MainActivityRef {
    private var ref: java.lang.ref.WeakReference<MainActivity>? = null
    fun set(act: MainActivity)  { ref = java.lang.ref.WeakReference(act) }
    fun clear()                  { ref = null }
    fun get(): MainActivity?     = ref?.get()
}