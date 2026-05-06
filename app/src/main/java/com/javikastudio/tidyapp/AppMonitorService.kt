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
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  AppMonitorService  (~600 lines after Phase 5 full extraction)          │
 * │                                                                         │
 * │  Orchestrates four extracted engines:                                   │
 * │    FocusBlockingEngine   — timed session, blocks specified apps         │
 * │    TimerBlockingEngine   — per-app daily limit enforcement              │
 * │    IntentionEngine       — always-on mindful opening pause              │
 * │    BedtimeBlockingEngine — bedtime window, blocked apps, snooze        │
 * │                                                                         │
 * │  Overlay priority (highest → lowest):                                   │
 * │    Bedtime(0) > Focus(1) > Timer(2) > Intention(3)                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
class AppMonitorService : Service() {

    // ── Constants ─────────────────────────────────────────────────────────────
    companion object {
        const val CHANNEL_ID   = "tidy_app_monitor"
        const val NOTIF_ID     = 6001
        const val POLL_MS      = 500L
        const val GRACE_MS     = 5 * 60_000L

        const val ACTION_FOCUS_START       = "FOCUS_START"
        const val ACTION_FOCUS_STOP        = "FOCUS_STOP"
        const val ACTION_FOCUS_UPDATE      = "FOCUS_UPDATE"
        const val ACTION_TIMER_BLOCK       = "TIMER_BLOCK"
        const val ACTION_INTENTION_START   = "INTENTION_START"
        const val ACTION_INTENTION_STOP    = "INTENTION_STOP"
        const val ACTION_STOP_ALL          = "STOP_ALL"
        const val ACTION_BEDTIME_START     = "START_BEDTIME"
        const val ACTION_BEDTIME_STOP      = "STOP_BEDTIME"
        const val ACTION_BEDTIME_UPDATE    = "UPDATE_BEDTIME"
        const val ACTION_BEDTIME_SNOOZE    = "SNOOZE_BEDTIME"

        const val ACTION_BEDTIME_SNOOZE_CLEAR = "SNOOZE_BEDTIME_CLEAR"
        const val ACTION_BEDTIME_STOP_SOFT = "STOP_BEDTIME_SOFT"

        // Screen Filter actions
        const val ACTION_FILTER_START  = "FILTER_START"
        const val ACTION_FILTER_STOP   = "FILTER_STOP"
        const val ACTION_FILTER_UPDATE = "FILTER_UPDATE"

        // Direct engine reference — set once in onCreate, cleared in onDestroy.
        // Allows BedtimeBridge to call the engine without a service-intent round-trip.
        @Volatile var filterEngineInstance: ScreenFilterEngine? = null

        // Overlay priority levels — lower number = higher priority
        const val PRIORITY_BEDTIME   = 0
        const val PRIORITY_FOCUS     = 1
        const val PRIORITY_TIMER     = 2
        const val PRIORITY_INTENTION = 3
    }

    // ── Core infrastructure ───────────────────────────────────────────────────
    private lateinit var prefs:   SharedPreferences
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
    private var currentFgPkg = ""
    private var currentFgPkgTs = 0L

    // ── Polling runnable ───────────────────────────────────────────────────────
    private val pollRunnable = object : Runnable {
        override fun run() {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            val now = System.currentTimeMillis()

            if (usm != null && hasUsagePermission()) {
                val events = runCatching { usm.queryEvents(now - 5000L, now) }.getOrNull()
                var latestFgPkg = ""
                var latestFgTs  = 0L
                val bgTs        = mutableMapOf<String, Long>()

                if (events != null) {
                    val ev = UsageEvents.Event()
                    while (events.hasNextEvent()) {
                        events.getNextEvent(ev)
                        when (ev.eventType) {
                            UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                                if (ev.timeStamp > latestFgTs) {
                                    latestFgPkg = ev.packageName
                                    latestFgTs  = ev.timeStamp
                                }
                            }
                            UsageEvents.Event.MOVE_TO_BACKGROUND ->
                                bgTs[ev.packageName] = maxOf(bgTs[ev.packageName] ?: 0L, ev.timeStamp)
                        }
                    }
                }

                when {
                    // Saw a new foreground event this tick
                    latestFgTs > 0L -> {
                        if ((bgTs[latestFgPkg] ?: 0L) < latestFgTs) {
                            currentFgPkg   = latestFgPkg
                            currentFgPkgTs = latestFgTs
                        } else {
                            currentFgPkg = ""
                        }
                    }
                    // No new events — check if the pkg we remember went to background
                    currentFgPkg.isNotEmpty() -> {
                        val wentBg = bgTs[currentFgPkg] ?: 0L
                        if (wentBg > currentFgPkgTs) currentFgPkg = ""
                        // else: no events at all → assume still in foreground, keep currentFgPkg as-is
                    }
                    // currentFgPkg already empty, no events → nothing to do
                }
            }

            // ── Camera + user-excluded apps for Screen Filter ────────────────────────
            // Pause filter when foreground app is camera OR user-configured excluded app.
            if (currentFgPkg.isNotEmpty()) {
                val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                val sfCfg = if (!sfRaw.isNullOrBlank()) runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null

                val isCam = currentFgPkg.contains("camera", ignoreCase = true) ||
                            currentFgPkg.contains("cam.", ignoreCase = true) ||
                            currentFgPkg == "com.google.android.GoogleCamera" ||
                            try {
                                packageManager.queryIntentActivities(
                                    android.content.Intent("android.media.action.IMAGE_CAPTURE"), 0
                                ).any { it.activityInfo.packageName == currentFgPkg }
                            } catch (_: Exception) { false }

                // User-configured excluded apps (stored in sfCfg.excludedApps JSON array)
                // Camera packages are also pre-populated client-side but we check by name here
                val isUserExcluded = sfCfg?.optJSONArray("excludedApps")?.let { arr ->
                    (0 until arr.length()).any { arr.optString(it) == currentFgPkg }
                } ?: false

                val shouldHide = isCam || isUserExcluded
                if (shouldHide) {
                    filterEngine.let { if (it.isActive()) it.update(0, 0) }
                } else {
                    filterEngine.let {
                        if (it.isActive()) {
                            val w = sfCfg?.optInt("warmAlpha", 80) ?: 80
                            val d = sfCfg?.optInt("dimAlpha",  45) ?: 45
                            it.update(w, d)
                        }
                    }
                }
            }

            // Dispatch in priority order; each handler returns true if it owns the overlay slot
            val bedtimeWants = bedtimeEngine.onTick(currentFgPkg, now)
            val focusWants   = if (!bedtimeWants) focusEngine.onTick(currentFgPkg, now)
                               else { focusEngine.onTickNoOverlay(currentFgPkg, now); false }
            val timerWants   = if (!bedtimeWants && !focusWants) timerEngine.onTick(currentFgPkg, now)
                               else { timerEngine.onTickNoOverlay(currentFgPkg, now); false }
            if (!bedtimeWants && !focusWants && !timerWants) intentionEngine.onTick(currentFgPkg, now)
            else intentionEngine.onTickNoOverlay(currentFgPkg, now)

            nm.notify(NOTIF_ID, buildNotification(now))

            if (!focusEngine.isActive && !timerEngine.isActive &&
                !intentionEngine.isActive && !bedtimeEngine.isActive) {
                pollScheduled = false
                stopSelf()
                return
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

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        prefs   = getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(controlReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(controlReceiver, filter)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_FOCUS_START       -> focusEngine.start(intent)
            ACTION_FOCUS_UPDATE      -> focusEngine.update(intent)
            ACTION_FOCUS_STOP        -> focusEngine.stop()
            ACTION_TIMER_BLOCK       -> timerEngine.addBlock(intent)
            ACTION_INTENTION_START   -> intentionEngine.enable()
            ACTION_INTENTION_STOP    -> intentionEngine.disable()
            ACTION_BEDTIME_START     -> bedtimeEngine.start(intent)
            ACTION_BEDTIME_UPDATE    -> bedtimeEngine.update(intent)
            ACTION_BEDTIME_STOP      -> bedtimeEngine.stop(wasNatural = false)
            ACTION_BEDTIME_STOP_SOFT -> bedtimeEngine.stopSoft()
            ACTION_BEDTIME_SNOOZE    -> bedtimeEngine.snooze(intent.getIntExtra("snooze_mins", 15))
            ACTION_BEDTIME_SNOOZE_CLEAR -> bedtimeEngine.clearSnooze()
            ACTION_FILTER_START  -> {
                val w = intent.getIntExtra("filter_warm", 60)
                val d = intent.getIntExtra("filter_dim",  30)
                val g = intent.getBooleanExtra("filter_gradual", false)
                filterEngine.start(w, d, g)
            }
            ACTION_FILTER_UPDATE -> {
                val w = intent.getIntExtra("filter_warm", 60)
                val d = intent.getIntExtra("filter_dim",  30)
                filterEngine.update(w, d)
            }
            ACTION_FILTER_STOP   -> filterEngine.stop()
            ACTION_STOP_ALL -> {
                bedtimeEngine.stop()
                focusEngine.stop()
                timerEngine.clearAll()
                intentionEngine.disable()
                filterEngine.stop(fadeOut = false)
                stopSelf()
                return START_NOT_STICKY
            }
            null -> {
                // Sticky restart — restore state from prefs
                focusEngine.restoreFromPrefs()
                timerEngine.restoreFromPrefs()
                intentionEngine.restoreFromPrefs()
                bedtimeEngine.restoreFromPrefs()
                filterEngine.restoreFromPrefs()
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
        focusEngine.onDestroy()
        timerEngine.onDestroy()
        intentionEngine.onDestroy()
        bedtimeEngine.onDestroy()
        filterEngine.onDestroy()
        filterEngineInstance = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ─────────────────────────────────────────────────────────────────────────
    // OverlayCoordinator — owns the single overlay slot
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Only one overlay can be on screen at a time; highest priority wins.
     * A lower-priority show() while a higher-priority overlay is on screen is a no-op.
     * dismiss() only removes the overlay if the caller owns it (matched priority).
     */
    inner class OverlayCoordinator {
        var activeView:     View? = null
            private set
        var activePriority: Int   = Int.MAX_VALUE
            private set

        fun show(priority: Int, view: View): Boolean {
            if (activeView != null && priority >= activePriority) return false
            forceRemove()
            return runCatching {
                wm.addView(view, overlayLayoutParams())
                activeView     = view
                activePriority = priority
                true
            }.getOrDefault(false)
        }

        fun dismiss(priority: Int) {
            if (activePriority != priority) return
            forceRemove()
        }

        fun isShowing(priority: Int) = activeView != null && activePriority == priority

        fun forceRemove() {
            activeView?.let { runCatching { wm.removeView(it) } }
            activeView     = null
            activePriority = Int.MAX_VALUE
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EngineHelpers — capability bundle passed to all extracted engines
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Bridges service-owned utilities (context, nm, helpers) into the extracted
     * engine classes without coupling them to AppMonitorService directly.
     * All properties are delegated getters so engines always see live values.
     */
    inner class EngineHelpers {
        val context: Context                 get() = this@AppMonitorService
        val nm: NotificationManager          get() = this@AppMonitorService.nm
        val channelId: String                get() = CHANNEL_ID
        val notifId: Int                     get() = NOTIF_ID
        val packageName: String              get() = this@AppMonitorService.packageName
        val packageManager: PackageManager   get() = this@AppMonitorService.packageManager

        // Cross-engine query — safe once focusEngine is initialized (always true at poll time)
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

    // ─────────────────────────────────────────────────────────────────────────
    // Notification
    // ─────────────────────────────────────────────────────────────────────────

    private fun buildNotification(now: Long): Notification {
        val openPi = packageManager.getLaunchIntentForPackage(packageName)?.let { i ->
            PendingIntent.getActivity(this, 0,
                i.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP },
                pendingFlags())
        }

        if (bedtimeEngine.isActive) {
            return NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF6C63FF.toInt())
                .setContentTitle("🌙 Bedtime Mode active")
                .setContentText("Blocking distracting apps until morning")
                .setOngoing(true).setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .apply { openPi?.let { setContentIntent(it) } }.build()
        }

        if (focusEngine.isActive) {
            val sessionEndTs = prefs.getLong("focus_session_end_ts", 0L)
            val remaining    = ((sessionEndTs - now) / 1000L).coerceAtLeast(0L)
            val m = remaining / 60; val s = remaining % 60
            val timeStr    = "${String.format("%02d", m)}:${String.format("%02d", s)}"
            val difficulty = prefs.getString("focus_session_difficulty", "gentle") ?: "gentle"
            val modeLabel  = when (difficulty) { "firm" -> "Firm"; "deep" -> "Deep"; else -> "Gentle" }
            val stopPi     = PendingIntent.getBroadcast(this, 1,
                Intent("${packageName}.FOCUS_STOP_BROADCAST"), pendingFlags())
            return NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_pause).setColor(0xFF6C63FF.toInt())
                .setContentTitle("🎯 $modeLabel Focus — $timeStr remaining")
                .setContentText("Blocking distractions · Stay focused")
                .setOngoing(true).setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .apply { openPi?.let { setContentIntent(it) } }
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End Session", stopPi)
                .build()
        }

        if (timerEngine.isActive) {
            return NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert).setColor(0xFFF04E7A.toInt())
                .setContentTitle("⏱ Daily limit reached")
                .setContentText("App limit enforced · Aurelo is watching")
                .setOngoing(true).setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .apply { openPi?.let { setContentIntent(it) } }.build()
        }

        val count = runCatching {
            JSONArray(prefs.getString("focus_intention_apps", "[]") ?: "[]").length()
        }.getOrDefault(0)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF12D48A.toInt())
            .setContentTitle("Mindful Pause active")
            .setContentText("Pausing before $count app${if (count != 1) "s" else ""}")
            .setOngoing(true).setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .apply { openPi?.let { setContentIntent(it) } }.build()
    }

    internal fun updateNotification(title: String, body: String) {
        nm.notify(NOTIF_ID, NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF12D48A.toInt())
            .setContentTitle(title).setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true).build())
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Aurelo Monitor", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Focus sessions, app limits, and mindful pause prompts"
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Shared helpers — internal so EngineHelpers can delegate to them
    // ─────────────────────────────────────────────────────────────────────────

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
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            type,
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
                style = android.graphics.Paint.Style.STROKE; strokeCap = android.graphics.Paint.Cap.ROUND
            }
            private val dotPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                style = android.graphics.Paint.Style.FILL
            }
            override fun onDraw(canvas: android.graphics.Canvas) {
                val sx = width / 108f; val sy = height / 108f
                canvas.save(); canvas.scale(sx, sy)
                val path = android.graphics.Path().apply {
                    moveTo(22f, 88f); cubicTo(22f, 88f, 30f, 30f, 54f, 20f)
                    cubicTo(78f, 30f, 86f, 88f, 86f, 88f)
                }
                val archGrad = android.graphics.LinearGradient(
                    28f, 20f, 80f, 90f,
                    intArrayOf(Color.rgb(255, 224, 130), Color.rgb(255, 170, 68), Color.rgb(255, 112, 32)),
                    floatArrayOf(0f, 0.55f, 1f), android.graphics.Shader.TileMode.CLAMP
                )
                archPaint.shader = archGrad; archPaint.strokeWidth = 7.5f; archPaint.alpha = 255
                canvas.drawPath(path, archPaint)
                archPaint.strokeWidth = 1.5f; archPaint.alpha = 128; canvas.drawPath(path, archPaint)
                dotPaint.shader = android.graphics.LinearGradient(
                    48f, 22f, 60f, 34f,
                    intArrayOf(Color.rgb(255, 243, 192), Color.rgb(255, 208, 96)),
                    null, android.graphics.Shader.TileMode.CLAMP
                )
                canvas.drawCircle(54f, 20f, 5.5f, dotPaint); canvas.restore()
            }
        }
        val row = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity     = Gravity.BOTTOM or Gravity.CENTER_VERTICAL
        }
        row.addView(logoView, android.widget.LinearLayout.LayoutParams(logoSz, logoSz).also {
            it.rightMargin = dpToPx(1); it.bottomMargin = dpToPx(1)
        })
        row.addView(android.widget.TextView(this).apply {
            text = "URELO"; textSize = 21f
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
            letterSpacing = 0.09f; setTextColor(Color.rgb(255, 224, 130))
        }, android.widget.LinearLayout.LayoutParams(
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
            android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
        ))
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
