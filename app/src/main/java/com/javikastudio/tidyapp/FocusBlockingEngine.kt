package com.javikastudio.tidyapp

import android.animation.ValueAnimator
import android.app.PendingIntent
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * FocusBlockingEngine
 *
 * Owns: focus-mode overlay logic, difficulty levels (Gentle / Firm / Deep),
 * blocked-app list evaluation, session timer, OEM battery prompt, and prefs.
 */
class FocusBlockingEngine(
    private val prefs:       SharedPreferences,
    private val coordinator: AppMonitorService.OverlayCoordinator,
    private val h:           AppMonitorService.EngineHelpers
) {
    companion object {
        object PREFS_KEYS {
            const val FOCUS_ACTIVE          = "focus_session_active"
            const val FOCUS_DIFFICULTY      = "focus_session_difficulty"
            const val FOCUS_END_TS          = "focus_session_end_ts"
            const val FOCUS_ROUTINE_ID      = "focus_active_routine_id"
            const val FOCUS_BLOCKED_APPS    = "focus_blocked_apps"
            const val FOCUS_COMPLETE_COUNT  = "focus_complete_count"
            const val FOCUS_INTERRUPT_COUNT = "focus_interrupt_count"
        }
    }

    var isActive = false
        private set

    private var difficulty      = "gentle"
    private var sessionEndTs    = 0L
    private var blockedPkgs     = emptySet<String>()
    private var blockedAppNames = mapOf<String, String>()
    private var activeRoutineId = ""

    private var firmHandler:       Handler? = null
    private var firmRunnable:      Runnable? = null
    private var timerTickHandler:  Handler? = null
    private var timerTickRunnable: Runnable? = null
    private var firmSecsLeft = 30

    private var lastBlockedPkg = ""
    private var lastBlockedTs  = 0L
    private var gentleAllowPkg = ""
    private var gentleAllowUntilTs = 0L

    // ── Public API ────────────────────────────────────────────────────────────

    fun start(intent: Intent) {
        readExtras(intent)
        isActive = true
        prefs.edit()
            .putBoolean("focus_session_active",    true)
            .putString ("focus_session_difficulty", difficulty)
            .putLong   ("focus_session_end_ts",     sessionEndTs)
            .putString ("focus_active_routine_id",  activeRoutineId)
            .apply()
        maybeShowOemBatteryPrompt()
    }

    fun update(intent: Intent) {
        if (!isActive) return
        readExtras(intent)
    }

    fun stop() {
        val routineId       = activeRoutineId
        isActive            = false
        sessionEndTs        = 0L
        blockedPkgs         = emptySet()
        blockedAppNames     = emptyMap()
        gentleAllowPkg      = ""
        gentleAllowUntilTs  = 0L
        activeRoutineId     = ""
        prefs.edit()
            .putBoolean("focus_session_active",   false)
            .putLong   ("focus_session_end_ts",   0L)
            .putString ("focus_active_routine_id", "")
            .apply()
        coordinator.dismiss(AppMonitorService.PRIORITY_FOCUS)
        firmHandler?.removeCallbacksAndMessages(null)
        timerTickHandler?.removeCallbacksAndMessages(null)
        notifyJsSessionEnded(routineId)
    }

    fun restoreFromPrefs() {
        if (!prefs.getBoolean("focus_session_active", false)) return
        difficulty      = prefs.getString("focus_session_difficulty", "gentle") ?: "gentle"
        sessionEndTs    = prefs.getLong("focus_session_end_ts", 0L)
        activeRoutineId = prefs.getString("focus_active_routine_id", "") ?: ""
        if (sessionEndTs > 0L && System.currentTimeMillis() < sessionEndTs) {
            parseBlockedApps(prefs.getString("focus_blocked_apps", "[]") ?: "[]")
            isActive = true
        } else {
            prefs.edit().putBoolean("focus_session_active", false)
                .putString("focus_active_routine_id", "").apply()
        }
    }

    fun onDestroy() {
        firmHandler?.removeCallbacksAndMessages(null)
        timerTickHandler?.removeCallbacksAndMessages(null)
    }

    fun isBlockingPackage(pkg: String): Boolean = isActive && blockedPkgs.contains(pkg)

    fun onTick(currentFgPkg: String, now: Long): Boolean {
        if (!isActive) return coordinator.isShowing(AppMonitorService.PRIORITY_FOCUS)
        if (sessionEndTs > 0L && now >= sessionEndTs) { onSessionExpired(); return false }
        if (coordinator.isShowing(AppMonitorService.PRIORITY_FOCUS)) return true

        if (currentFgPkg.isEmpty() || currentFgPkg == h.packageName) {
            if (gentleAllowPkg.isNotEmpty()) { gentleAllowPkg = ""; gentleAllowUntilTs = 0L }
            return false
        }
        if (!blockedPkgs.contains(currentFgPkg)) return false
        if (difficulty == "gentle" && currentFgPkg == gentleAllowPkg && now < gentleAllowUntilTs) return false
        if (currentFgPkg == lastBlockedPkg && (now - lastBlockedTs) < 2000L) return false

        lastBlockedPkg = currentFgPkg; lastBlockedTs = now
        val appName = blockedAppNames[currentFgPkg] ?: currentFgPkg.split(".").last()

        when (difficulty) {
            "gentle" -> showOverlay(currentFgPkg, appName, canDismiss = true,  gentle = true)
            "firm"   -> showOverlay(currentFgPkg, appName, canDismiss = true,  gentle = false)
            "deep"   -> showOverlay(currentFgPkg, appName, canDismiss = false, gentle = false)
        }
        return coordinator.isShowing(AppMonitorService.PRIORITY_FOCUS)
    }

    fun onTickNoOverlay(currentFgPkg: String, now: Long) {
        if (!isActive) return
        if (sessionEndTs > 0L && now >= sessionEndTs) onSessionExpired()
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun onSessionExpired() {
        val routineId      = activeRoutineId
        isActive           = false; sessionEndTs = 0L
        blockedPkgs        = emptySet(); gentleAllowPkg = ""; gentleAllowUntilTs = 0L
        activeRoutineId    = ""
        prefs.edit()
            .putBoolean("focus_session_active",   false)
            .putLong   ("focus_session_end_ts",   0L)
            .putString ("focus_active_routine_id", "")
            .apply()
        coordinator.dismiss(AppMonitorService.PRIORITY_FOCUS)
        firmHandler?.removeCallbacksAndMessages(null)
        timerTickHandler?.removeCallbacksAndMessages(null)
        h.vibrate(longArrayOf(0, 80, 60, 120))
        h.updateNotification("🎉 Session complete!", "Great work!")
        // Bypass DND check: this cue fires precisely when the user has
        // earned a break and the prior focus block has cleared. Skipping it
        // because DND happens to still be held by a sibling subsystem
        // (rare race) would lose the moment that the entire feature builds
        // towards.
        SoundEffects.play(h.context, SoundEffects.Tone.SESSION_COMPLETE, bypassDndCheck = true)
        notifyJsSessionEnded(routineId)
    }

    private fun showOverlay(pkg: String, appName: String, canDismiss: Boolean, gentle: Boolean) {
        if (!h.canDrawOverlay()) { showGentleNotification(appName); return }
        h.vibrate(if (canDismiss) longArrayOf(0, 40, 30, 40) else longArrayOf(0, 60, 40, 80))
        val secsLeft = ((sessionEndTs - System.currentTimeMillis()) / 1000L).coerceAtLeast(0L).toInt()
        val root  = buildFocusOverlayView(pkg, appName, canDismiss, gentle, secsLeft)
        val shown = coordinator.show(AppMonitorService.PRIORITY_FOCUS, root)
        if (!shown) showGentleNotification(appName)
    }

    private fun showGentleNotification(appName: String) {
        h.vibrate(longArrayOf(0, 40))
        val stopPi = PendingIntent.getBroadcast(
            h.context, 0,
            Intent("${h.packageName}.FOCUS_STOP_BROADCAST"),
            h.pendingFlags()
        )
        val notif = NotificationCompat.Builder(h.context, h.channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setColor(0xFF8EA2FF.toInt())
            .setContentTitle("🎯 You're in Focus Mode")
            .setContentText("$appName is on your blocked list — stay on track!")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End Session", stopPi)
            .build()
        h.nm.notify(h.notifId + 1, notif)
    }

    private fun buildFocusOverlayView(
        pkg: String, appName: String,
        canDismiss: Boolean, gentle: Boolean, secsLeft: Int
    ): View {
        val ctx = h.context
        val animators = mutableListOf<ValueAnimator>()

        // Define modeLabel here so it is accessible in the view construction
        val modeLabel = when {
            gentle     -> "🌿 GENTLE FOCUS"
            canDismiss -> "🛡 FIRM FOCUS"
            else       -> "🔒 DEEP FOCUS"
        }

        val root = FrameLayout(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF10182A.toInt(), 0xFF060912.toInt())
            )
        }

        // Top Logo + Subtitle
        val logoWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        logoWrap.addView(h.buildAureloWordmarkView(), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        logoWrap.addView(TextView(ctx).apply {
            text = "FOCUS MODE"
            textSize = 10f
            letterSpacing = 0.2f
            setTextColor(Color.parseColor("#8EA2FF"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = h.dpToPx(4)
        })
        root.addView(logoWrap, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 52 else 36)
        })

        val shieldContainer = FrameLayout(ctx)

        // Background Layer
        val shieldBg = View(ctx).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x1E8EA2FF, 0x0A8EA2FF)).apply {
                cornerRadii = floatArrayOf(
                    h.dpToPx(122).toFloat(), h.dpToPx(122).toFloat(),
                    h.dpToPx(122).toFloat(), h.dpToPx(122).toFloat(),
                    h.dpToPx(64).toFloat(), h.dpToPx(64).toFloat(),
                    h.dpToPx(64).toFloat(), h.dpToPx(64).toFloat()
                )
                setStroke(h.dpToPx(1), 0x338EA2FF)
            }
        }
        shieldContainer.addView(shieldBg, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // Centered Core Plate
        val corePlate = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x14FFFFFF, 0x05FFFFFF)).apply {
                cornerRadius = h.dpToPx(28).toFloat()
                setStroke(h.dpToPx(1), 0x14FFFFFF)
            }
        }
        val timeLabel = TextView(ctx).apply {
            textSize = 38f; setTextColor(0xFFFFFFFF.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        val remainingLabel = TextView(ctx).apply {
            text = "REMAINING"
            textSize = 10f; setTextColor(Color.argb(153, 255, 255, 255))
            letterSpacing = 0.05f; typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER; setPadding(0, h.dpToPx(2), 0, 0)
        }
        corePlate.addView(timeLabel)
        corePlate.addView(remainingLabel)

        shieldContainer.addView(corePlate, FrameLayout.LayoutParams(h.dpToPx(130), h.dpToPx(96)).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(78)
        })

        // Orbiting Arch (Positioned to rotate around the plate)
        val archView = object : View(ctx) {
            val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                style = android.graphics.Paint.Style.STROKE
                strokeWidth = h.dpToPx(4).toFloat()
                color = 0xFF8EA2FF.toInt()
                strokeCap = android.graphics.Paint.Cap.ROUND
            }
            val rect = android.graphics.RectF()
            override fun onDraw(canvas: android.graphics.Canvas) {
                super.onDraw(canvas)
                val p = paint.strokeWidth
                rect.set(p, p, width - p, height - p)
                canvas.drawArc(rect, 200f, 100f, false, paint)
            }
        }
        // Orbiting Arch - Increased size to 180dp, adjusted top margin to 36dp
        shieldContainer.addView(archView, FrameLayout.LayoutParams(h.dpToPx(180), h.dpToPx(180)).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            // 36dp top margin ensures the 180dp arch remains centered
            // with the corePlate (which is at 78dp top margin + 48dp half-height = 126dp center)
            topMargin = h.dpToPx(36)
        })

        animators.add(ValueAnimator.ofFloat(0f, 360f).apply {
            duration = 5000L; repeatCount = ValueAnimator.INFINITE
            interpolator = android.view.animation.LinearInterpolator()
            addUpdateListener { archView.rotation = it.animatedValue as Float }
        })

        // Shifted entire container down
        root.addView(shieldContainer, FrameLayout.LayoutParams(h.dpToPx(230), h.dpToPx(274)).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(150) // Pushed down
        })

        // Timer Tick Logic
        timerTickHandler?.removeCallbacksAndMessages(null)
        timerTickHandler = Handler(Looper.getMainLooper())
        timerTickRunnable = object : Runnable {
            override fun run() {
                if (!coordinator.isShowing(AppMonitorService.PRIORITY_FOCUS)) return
                val sLeft = ((sessionEndTs - System.currentTimeMillis()) / 1000L).coerceAtLeast(0L).toInt()
                val h2 = sLeft / 3600; val m2 = sLeft % 3600 / 60; val s2 = sLeft % 60
                timeLabel.text = if (h2 > 0) "${h2}h ${m2}m" else "${m2}m"
                timerTickHandler?.postDelayed(this, 1000L)
            }
        }
        timerTickHandler?.post(timerTickRunnable!!)

        // Bottom Stack
        val stack = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        }

        stack.addView(TextView(ctx).apply {
            text = modeLabel; textSize = 11f; setTextColor(0xFFEDF3FF.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(h.dpToPx(14), h.dpToPx(8), h.dpToPx(14), h.dpToPx(8))
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(100).toFloat()
                it.setColor(0x12FFFFFF); it.setStroke(1, 0x14FFFFFF)
            }
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(12) })

        stack.addView(TextView(ctx).apply {
            text = "$appName is currently outside this session"
            textSize = 26f; setTextColor(0xFFEDF3FF.toInt())
            gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setLineSpacing(0f, 1.1f)
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(8) })

        stack.addView(TextView(ctx).apply {
            text = when {
                !gentle && !canDismiss -> "You're locked in until the session ends."
                !gentle                -> "You committed to protected work. Maintain the boundary until the timer unlocks."
                else                   -> "A gentle reminder to stay mindful."
            }
            textSize = 14f; setTextColor(Color.argb(153, 237, 243, 255)); gravity = Gravity.CENTER
            setLineSpacing(0f, 1.4f)
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(24) })

        // Actions
        if (gentle) {
            stack.addView(TextView(ctx).apply {
                text = "Continue to app"; textSize = 15f; setTextColor(0xFF050811.toInt())
                gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
                setPadding(0, h.dpToPx(16), 0, h.dpToPx(16))
                background = GradientDrawable().also { it.cornerRadius = h.dpToPx(20).toFloat(); it.setColor(Color.WHITE) }
                setOnClickListener {
                    coordinator.dismiss(AppMonitorService.PRIORITY_FOCUS)
                    gentleAllowPkg     = pkg
                    gentleAllowUntilTs = System.currentTimeMillis() + 5 * 60_000L
                    lastBlockedPkg     = pkg
                    lastBlockedTs      = System.currentTimeMillis()
                }
            }, h.linearFill().also { it.bottomMargin = h.dpToPx(8) })
        } else {
            stack.addView(TextView(ctx).apply {
                text = "Back to work"; textSize = 15f; setTextColor(0xFF050811.toInt())
                gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
                setPadding(0, h.dpToPx(16), 0, h.dpToPx(16))
                background = GradientDrawable().also { it.cornerRadius = h.dpToPx(20).toFloat(); it.setColor(Color.WHITE) }
                setOnClickListener {
                    coordinator.dismiss(AppMonitorService.PRIORITY_FOCUS)
                    runCatching {
                        h.startActivity(h.packageManager.getLaunchIntentForPackage(h.packageName)
                            ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }!!)
                    }
                }
            }, h.linearFill().also { it.bottomMargin = h.dpToPx(8) })
        }

        if (!gentle && canDismiss) {
            firmSecsLeft = 30
            val endBtn = TextView(ctx).apply {
                text = "Wait ${firmSecsLeft}s to end"; textSize = 14f
                setTextColor(Color.WHITE); gravity = Gravity.CENTER
                setPadding(0, h.dpToPx(16), 0, h.dpToPx(16))
                background = GradientDrawable().also {
                    it.cornerRadius = h.dpToPx(20).toFloat()
                    it.setStroke(h.dpToPx(1), 0x14FFFFFF)
                }
                isEnabled = false
            }
            stack.addView(endBtn, h.linearFill())
            firmHandler?.removeCallbacksAndMessages(null)
            firmHandler = Handler(Looper.getMainLooper())
            firmRunnable = object : Runnable {
                override fun run() {
                    firmSecsLeft--
                    if (firmSecsLeft <= 0) {
                        endBtn.text = "End session"
                        endBtn.isEnabled = true
                        endBtn.setOnClickListener { coordinator.dismiss(AppMonitorService.PRIORITY_FOCUS); stop() }
                    } else {
                        endBtn.text = "Wait ${firmSecsLeft}s to end"
                        firmHandler?.postDelayed(this, 1000L)
                    }
                }
            }
            firmHandler!!.postDelayed(firmRunnable!!, 1000L)
        }

        root.addView(stack, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.BOTTOM
            leftMargin = h.dpToPx(24); rightMargin = h.dpToPx(24); bottomMargin = h.dpToPx(28)
        })

        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) { animators.forEach { it.start() } }
            override fun onViewDetachedFromWindow(v: View) { animators.forEach { it.cancel() } }
        })

        return root
    }

    private fun notifyJsSessionEnded(routineId: String = "") {
        val js = if (routineId.isNotBlank()) {
            val escaped = routineId.replace("'", "\\'")
            "if(typeof window.onFocusSessionEnded==='function') window.onFocusSessionEnded('$escaped')"
        } else {
            "if(typeof window.onFocusSessionEnded==='function') window.onFocusSessionEnded('')"
        }
        h.notifyJs(js)
    }

    private fun readExtras(intent: Intent) {
        difficulty      = intent.getStringExtra("difficulty")      ?: prefs.getString("focus_session_difficulty", "gentle") ?: "gentle"
        sessionEndTs    = intent.getLongExtra  ("endTs", 0L).takeIf { it > 0L } ?: prefs.getLong("focus_session_end_ts", 0L)
        activeRoutineId = intent.getStringExtra("activeRoutineId") ?: prefs.getString("focus_active_routine_id", "") ?: ""
        val appsJson    = intent.getStringExtra("blockedApps")     ?: prefs.getString("focus_blocked_apps", "[]") ?: "[]"
        parseBlockedApps(appsJson)
        prefs.edit()
            .putString("focus_session_difficulty", difficulty)
            .putLong  ("focus_session_end_ts",     sessionEndTs)
            .putString("focus_blocked_apps",        appsJson)
            .putString("focus_active_routine_id",  activeRoutineId)
            .apply()
    }

    private fun parseBlockedApps(json: String) {
        val actualJson = if (json.trim().startsWith("\""))
            runCatching { org.json.JSONObject("{\"x\":$json}").getString("x") }.getOrDefault(json)
        else json

        val arr   = runCatching { JSONArray(actualJson) }.getOrElse { JSONArray() }
        val pkgs  = mutableSetOf<String>()
        val names = mutableMapOf<String, String>()
        for (i in 0 until arr.length()) {
            val elem = arr.opt(i)
            val pkg: String; val name: String
            if (elem is JSONObject) {
                pkg  = elem.optString("packageName").takeIf { it.isNotBlank() } ?: continue
                name = elem.optString("name", pkg.split(".").last())
            } else {
                pkg  = elem.toString().takeIf { it.isNotBlank() } ?: continue
                name = pkg.split(".").last()
            }
            pkgs += pkg; names[pkg] = name
        }
        blockedPkgs = pkgs; blockedAppNames = names
    }

    private fun maybeShowOemBatteryPrompt() {
        if (prefs.getBoolean("oem_battery_prompt_shown", false)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = h.context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            if (pm.isIgnoringBatteryOptimizations(h.packageName)) {
                prefs.edit().putBoolean("oem_battery_prompt_shown", true).apply(); return
            }
        }
        prefs.edit().putBoolean("oem_battery_prompt_shown", true).apply()

        val manufacturer = Build.MANUFACTURER.lowercase(java.util.Locale.ROOT)
        val oemIntent: Intent? = when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") ->
                tryIntent(Intent("miui.intent.action.APP_PERM_EDITOR").apply {
                    setClassName("com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity")
                })
            manufacturer.contains("samsung") ->
                tryIntent(Intent().apply {
                    component = android.content.ComponentName(
                        "com.samsung.android.lool",
                        "com.samsung.android.sm.ui.battery.BatteryActivity")
                })
            manufacturer.contains("oppo") || manufacturer.contains("realme") ->
                tryIntent(Intent().apply {
                    component = android.content.ComponentName(
                        "com.coloros.safecenter",
                        "com.coloros.privacypermissionsentry.PermissionTopActivity")
                })
            manufacturer.contains("oneplus") ->
                tryIntent(Intent().apply {
                    component = android.content.ComponentName(
                        "com.oneplus.security",
                        "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")
                })
            else -> null
        }

        val finalIntent = oemIntent ?: Intent(
            android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            android.net.Uri.parse("package:${h.packageName}")
        )
        finalIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { h.startActivity(finalIntent) }
    }

    private fun tryIntent(intent: Intent): Intent? =
        if (h.packageManager.resolveActivity(intent, 0) != null) intent else null
}