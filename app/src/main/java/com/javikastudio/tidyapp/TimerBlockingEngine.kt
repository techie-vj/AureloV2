package com.javikastudio.tidyapp

import android.animation.ValueAnimator
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * TimerBlockingEngine
 *
 * Owns: per-app daily limit enforcement, grace-window management, path-A
 * grace-expiry for apps that were already in foreground, day-rollover reset,
 * hold-to-unlock interaction, and ignore-stats logging.
 */
class TimerBlockingEngine(
    private val prefs:       SharedPreferences,
    private val coordinator: AppMonitorService.OverlayCoordinator,
    private val h:           AppMonitorService.EngineHelpers
) {
    var isActive = false
        private set

    private val timerBlockApps  = mutableMapOf<String, Triple<String, Int, Int>>()
    private val gracePerApp     = mutableMapOf<String, Long>()
    private val graceInFgPerApp = mutableMapOf<String, Boolean>()
    private val currentlyInFgApps = mutableSetOf<String>()

    private var overlayPkg   = ""
    private var overlayName  = ""
    private var overlayUsed  = 0
    private var overlayLimit = 0
    private var lastBlockedTs = System.currentTimeMillis()

    // ── Public API ────────────────────────────────────────────────────────────

    fun addBlock(intent: Intent) {
        val pkg   = intent.getStringExtra("pkg") ?: return
        val name  = intent.getStringExtra("appName") ?: pkg.split(".").last()
        val used  = intent.getIntExtra("usedMins", 0)
        val limit = intent.getIntExtra("limitMins", 0)
        timerBlockApps[pkg] = Triple(name, used, limit)
        val savedGrace = prefs.getLong("timer_grace_until_ts_$pkg", 0L)
        gracePerApp[pkg]     = if (savedGrace > System.currentTimeMillis()) savedGrace else 0L
        graceInFgPerApp[pkg] = prefs.getBoolean("timer_grace_in_fg_$pkg", false)
        lastBlockedTs        = System.currentTimeMillis()
        isActive             = true
        persistState()
    }

    fun clearAll() {
        timerBlockApps.clear(); gracePerApp.clear(); graceInFgPerApp.clear()
        currentlyInFgApps.clear(); isActive = false
        coordinator.dismiss(AppMonitorService.PRIORITY_TIMER)
        prefs.edit().putBoolean("timerblockmode", false).putString("timerblock_pkgs_map", "{}").apply()
    }

    fun restoreFromPrefs() {
        if (!prefs.getBoolean("timerblockmode", false)) return
        val json = prefs.getString("timerblock_pkgs_map", null) ?: return
        val obj  = runCatching { JSONObject(json) }.getOrNull() ?: return
        obj.keys().forEach { pkg ->
            val e = obj.optJSONObject(pkg) ?: return@forEach
            timerBlockApps[pkg] = Triple(e.optString("name", pkg.split(".").last()), e.optInt("used", 0), e.optInt("limit", 0))
            val savedGrace = prefs.getLong("timer_grace_until_ts_$pkg", 0L)
            gracePerApp[pkg]     = if (savedGrace > System.currentTimeMillis()) savedGrace else 0L
            graceInFgPerApp[pkg] = prefs.getBoolean("timer_grace_in_fg_$pkg", false)
        }
        if (timerBlockApps.isNotEmpty()) { isActive = true; lastBlockedTs = System.currentTimeMillis() }
    }

    fun onDestroy() { }

    fun onTick(currentFgPkg: String, now: Long): Boolean {
        if (!isActive) return coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)

        syncFromPrefs()
        if (timerBlockApps.isEmpty()) { isActive = false; coordinator.dismiss(AppMonitorService.PRIORITY_TIMER); return false }
        if (!isSameDay(now, lastBlockedTs)) { clearAll(); return false }

        if (currentFgPkg.isNotEmpty()) {
            if (timerBlockApps.containsKey(currentFgPkg)) currentlyInFgApps.add(currentFgPkg)
            else currentlyInFgApps.clear()
        }

        if (coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)) return true

        for ((pkg, _) in timerBlockApps.toMap()) {
            val pkgGrace = gracePerApp[pkg] ?: 0L
            if (pkgGrace in 1..now && graceInFgPerApp[pkg] == true) {
                gracePerApp[pkg]     = 0L; graceInFgPerApp[pkg] = false
                prefs.edit().remove("timer_grace_until_ts_$pkg").remove("timer_grace_in_fg_$pkg").apply()
                if (currentlyInFgApps.contains(pkg)) {
                    setDisplayFields(pkg); showTimerOverlay()
                    return coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)
                }
            }
        }

        val effectiveFgPkg = if (currentFgPkg.isNotEmpty()) currentFgPkg else currentlyInFgApps.firstOrNull() ?: return false
        if (h.isFocusBlockingPackage(effectiveFgPkg)) return false
        timerBlockApps[effectiveFgPkg] ?: return false
        val grace = gracePerApp[effectiveFgPkg] ?: 0L
        if (grace > 0L && now < grace) return false

        setDisplayFields(effectiveFgPkg)
        lastBlockedTs = now
        showTimerOverlay()
        return coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)
    }

    fun onTickNoOverlay(currentFgPkg: String, now: Long) {
        if (!isActive) return
        syncFromPrefs()
        if (timerBlockApps.isEmpty()) { isActive = false; return }

        currentlyInFgApps.clear()
        if (currentFgPkg.isNotEmpty() && timerBlockApps.containsKey(currentFgPkg)) currentlyInFgApps.add(currentFgPkg)

        for ((pkg, _) in timerBlockApps.toMap()) {
            val pkgGrace = gracePerApp[pkg] ?: 0L
            if (pkgGrace in 1..now && graceInFgPerApp[pkg] == true) {
                gracePerApp[pkg]     = 0L; graceInFgPerApp[pkg] = false
                prefs.edit().remove("timer_grace_until_ts_$pkg").remove("timer_grace_in_fg_$pkg").apply()
            }
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun showTimerOverlay() {
        if (!h.canDrawOverlay()) { showTimerNotification(); return }
        h.vibrate(longArrayOf(0, 40, 30, 40))
        val root  = buildTimerOverlayView()
        val shown = coordinator.show(AppMonitorService.PRIORITY_TIMER, root)
        if (!shown) showTimerNotification()
    }

    private fun setDisplayFields(pkg: String) {
        val t = timerBlockApps[pkg] ?: return
        overlayPkg = pkg; overlayName = t.first; overlayUsed = t.second; overlayLimit = t.third
    }

    private fun showTimerNotification() {
        val pi = h.packageManager.getLaunchIntentForPackage(h.packageName)?.let { i ->
            android.app.PendingIntent.getActivity(h.context, 0,
                i.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP },
                h.pendingFlags())
        }
        h.nm.notify(6003 + (overlayPkg.hashCode() and 0x0FFF),
            NotificationCompat.Builder(h.context, h.channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_alert).setColor(0xFFF04E7A.toInt())
                .setContentTitle("⏱ $overlayName limit reached")
                .setContentText("${overlayUsed}m used · ${overlayLimit}m limit. Take a break.")
                .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true)
                .apply { if (pi != null) setContentIntent(pi) }.build())
    }

    private fun buildTimerOverlayView(): View {
        val ctx = h.context
        val animators = mutableListOf<ValueAnimator>()
        val density = ctx.resources.displayMetrics.density

        val root = FrameLayout(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF1C1018.toInt(), 0xFF07070C.toInt())
            )
        }

        // 1. Top Logo + Subtitle ("DAILY TIMER")
        val logoWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }

        logoWrap.addView(h.buildAureloWordmarkView(), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        logoWrap.addView(TextView(ctx).apply {
            text = "DAILY TIMER"
            textSize = 10f
            letterSpacing = 0.2f
            setTextColor(Color.parseColor("#FF7698")) // Match HTML --timer color
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

        // 2. V2-A Clock Face & Guaranteed Glow
        val clockGroup = FrameLayout(ctx)

        // The Glow Layer (Massive radial gradient)
        val glowSize = h.dpToPx(320)
        val glowView = View(ctx).apply {
            background = object : GradientDrawable() {
                init {
                    shape = OVAL
                    gradientType = RADIAL_GRADIENT
                    // Solid pink center fading to completely transparent edges
                    colors = intArrayOf(Color.parseColor("#4DFF7698"), Color.TRANSPARENT)
                    gradientRadius = glowSize / 2f
                }
            }
        }
        clockGroup.addView(glowView, FrameLayout.LayoutParams(glowSize, glowSize).apply {
            gravity = Gravity.CENTER
        })

        // The Clock Face
        val clockSize = h.dpToPx(184)
        val clockFace = FrameLayout(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#08FF7698")) // Faint pink tint inside
                setStroke(h.dpToPx(2), Color.parseColor("#40FFFFFF")) // Crisp border
            }
        }

        // Short Hand
        val handS = View(ctx).apply {
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(4).toFloat()
                it.setColor(Color.parseColor("#FF9BB4"))
            }
            pivotX = density * 2f
            pivotY = h.dpToPx(64).toFloat()
        }
        animators.add(ValueAnimator.ofFloat(22f, 25f).apply {
            duration = 2000L; repeatMode = ValueAnimator.REVERSE; repeatCount = ValueAnimator.INFINITE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            addUpdateListener { handS.rotation = it.animatedValue as Float }
        })

        // Long Hand
        val handL = View(ctx).apply {
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(4).toFloat()
                it.setColor(Color.parseColor("#FFD2DD"))
            }
            pivotX = density * 1.5f
            pivotY = h.dpToPx(78).toFloat()
            rotation = 142f
        }

        clockFace.addView(handS, FrameLayout.LayoutParams(h.dpToPx(4), h.dpToPx(64)).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(28)
        })
        clockFace.addView(handL, FrameLayout.LayoutParams(h.dpToPx(3), h.dpToPx(78)).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(14)
        })

        clockGroup.addView(clockFace, FrameLayout.LayoutParams(clockSize, clockSize).apply {
            gravity = Gravity.CENTER
        })

        // 3. Pushing the clock down the screen
        root.addView(clockGroup, FrameLayout.LayoutParams(glowSize, glowSize).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            // Increased margin to drop the clock much further away from the logo
            topMargin = h.dpToPx(120)
        })

        // Tactile Grace Hold Card
        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(h.dpToPx(20), h.dpToPx(20), h.dpToPx(20), h.dpToPx(20))
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(28).toFloat()
                it.setColor(0x0AFFFFFF); it.setStroke(1, 0x14FFFFFF)
            }
        }

        col.addView(TextView(ctx).apply {
            text = "✋ HOLD TO EXTEND"; textSize = 11f; setTextColor(0xFFEDF3FF.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(h.dpToPx(14), h.dpToPx(8), h.dpToPx(14), h.dpToPx(8))
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(100).toFloat()
                it.setColor(0x12FFFFFF); it.setStroke(1, 0x14FFFFFF)
            }
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(14) })

        col.addView(TextView(ctx).apply {
            text = "Need 5 more minutes?"
            textSize = 24f; setTextColor(0xFFEDF3FF.toInt())
            gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(6) })

        val over = (overlayUsed - overlayLimit).coerceAtLeast(0)
        col.addView(TextView(ctx).apply {
            text = "Used ${overlayUsed}m · Limit ${overlayLimit}m · Over by ${over}m"
            textSize = 12f; setTextColor(Color.argb(153, 237, 243, 255)); gravity = Gravity.CENTER
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(14) })

        // Rail Progress
        val progressTrack = FrameLayout(ctx).apply {
            background = GradientDrawable().also { it.cornerRadius = h.dpToPx(999).toFloat(); it.setColor(0x14FFFFFF) }
        }
        val progressFill = FrameLayout(ctx).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor("#FF7698"), Color.parseColor("#FFD1DC"))).apply {
                cornerRadius = h.dpToPx(999).toFloat()
            }
            clipToOutline = true
        }
        val shimmer = View(ctx).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.TRANSPARENT, 0x60FFFFFF, Color.TRANSPARENT))
        }
        progressFill.addView(shimmer, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        progressTrack.addView(progressFill, FrameLayout.LayoutParams(0, FrameLayout.LayoutParams.MATCH_PARENT))

        animators.add(ValueAnimator.ofFloat(-1f, 1f).apply {
            duration = 3000L; repeatCount = ValueAnimator.INFINITE
            addUpdateListener {
                if (progressFill.width > 0) shimmer.translationX = (it.animatedValue as Float) * progressFill.width
            }
        })

        col.addView(progressTrack, h.linearFill().also { it.height = h.dpToPx(10); it.bottomMargin = h.dpToPx(8) })

        val holdIndicator = TextView(ctx).apply {
            text = "0.0s of 3.0s held"; textSize = 11f; setTextColor(Color.argb(153, 237, 243, 255))
            gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        col.addView(holdIndicator, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(16) })

        // Actions
        val btnsLayout = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }

        btnsLayout.addView(TextView(ctx).apply {
            text = "Take a break"; textSize = 15f; setTextColor(0xFF050811.toInt())
            gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, h.dpToPx(14), 0, h.dpToPx(14))
            background = GradientDrawable().also { it.cornerRadius = h.dpToPx(20).toFloat(); it.setColor(Color.WHITE) }
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_TIMER)
                runCatching { h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }) }
            }
        }, h.linearFill().also { it.bottomMargin = h.dpToPx(10) })

        var holdHandler: Handler? = null
        var holdProgress = 0

        val escapeBtn = TextView(ctx)
        fun resetHold() {
            holdHandler?.removeCallbacksAndMessages(null); holdProgress = 0
            escapeBtn.text = "Keep holding"; escapeBtn.setTextColor(Color.WHITE)
            escapeBtn.background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(20).toFloat(); it.setStroke(h.dpToPx(1), 0x1AFFFFFF)
            }
            holdIndicator.text = "0.0s of 3.0s held"
            progressFill.layoutParams = (progressFill.layoutParams as FrameLayout.LayoutParams).also { it.width = 0 }
            progressTrack.requestLayout()
        }

        val capturedOverlayPkg = overlayPkg
        escapeBtn.apply {
            text = "Keep holding"; textSize = 15f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, h.dpToPx(14), 0, h.dpToPx(14))
            background = GradientDrawable().also { it.cornerRadius = h.dpToPx(20).toFloat(); it.setStroke(h.dpToPx(1), 0x1AFFFFFF) }

            setOnTouchListener { _, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        holdHandler = Handler(Looper.getMainLooper())
                        holdHandler?.postDelayed(object : Runnable {
                            override fun run() {
                                holdProgress++
                                val secsF = holdProgress / 3f
                                val secsFormatted = "%.1f".format(secsF)
                                holdIndicator.text = "${secsFormatted}s of 3.0s held"
                                val fraction = (holdProgress / 9f).coerceIn(0f, 1f)
                                progressTrack.post {
                                    val trackW = progressTrack.width
                                    if (trackW > 0) {
                                        progressFill.layoutParams = (progressFill.layoutParams as FrameLayout.LayoutParams).also {
                                            it.width = (trackW * fraction).toInt()
                                        }
                                        progressFill.requestLayout()
                                    }
                                }
                                val secs = holdProgress / 3
                                if (secs >= 3) {
                                    val graceTs = System.currentTimeMillis() + AppMonitorService.GRACE_MS
                                    gracePerApp[capturedOverlayPkg]     = graceTs
                                    graceInFgPerApp[capturedOverlayPkg] = true
                                    prefs.edit()
                                        .putLong   ("timer_grace_until_ts_$capturedOverlayPkg", graceTs)
                                        .putBoolean("timer_grace_in_fg_$capturedOverlayPkg",    true)
                                        .apply()
                                    runCatching {
                                        val statsRaw = prefs.getString("timer_ignore_stats_v1", "{}") ?: "{}"
                                        val statsObj = runCatching { JSONObject(statsRaw) }.getOrElse { JSONObject() }
                                        val weekId   = java.text.SimpleDateFormat("yyyy-'W'ww", java.util.Locale.US).format(java.util.Date())
                                        val entry    = if (statsObj.has(capturedOverlayPkg)) statsObj.getJSONObject(capturedOverlayPkg) else JSONObject()
                                        if (entry.optString("weekId") != weekId) { entry.put("weekIgnores", 0); entry.put("weekId", weekId) }
                                        entry.put("weekIgnores",  entry.optInt("weekIgnores",  0) + 1)
                                        entry.put("totalIgnores", entry.optInt("totalIgnores", 0) + 1)
                                        statsObj.put(capturedOverlayPkg, entry)
                                        prefs.edit().putString("timer_ignore_stats_v1", statsObj.toString()).apply()
                                    }
                                    coordinator.dismiss(AppMonitorService.PRIORITY_TIMER)
                                    h.notifyJs("if(typeof window.onTimerGraceGranted==='function') window.onTimerGraceGranted('$capturedOverlayPkg')")
                                } else {
                                    escapeBtn.setTextColor(Color.argb(160 + holdProgress * 10, 255, 170, 68))
                                    holdHandler?.postDelayed(this, 333L)
                                }
                            }
                        }, 333L)
                        true
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { if (holdProgress < 9) resetHold(); true }
                    else -> false
                }
            }
        }
        btnsLayout.addView(escapeBtn, h.linearFill())
        col.addView(btnsLayout, h.linearFill())

        root.addView(col, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.BOTTOM
            leftMargin = h.dpToPx(18); rightMargin = h.dpToPx(18); bottomMargin = h.dpToPx(18)
        })

        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) { animators.forEach { it.start() } }
            override fun onViewDetachedFromWindow(v: View) { animators.forEach { it.cancel() } }
        })

        return root
    }

    private fun syncFromPrefs() {
        val json = prefs.getString("timerblock_pkgs_map", null) ?: return
        val obj  = runCatching { JSONObject(json) }.getOrNull() ?: return
        timerBlockApps.keys.toList().forEach { if (!obj.has(it)) timerBlockApps.remove(it) }
        obj.keys().forEach { pkg ->
            val e = obj.optJSONObject(pkg) ?: return@forEach
            timerBlockApps[pkg] = Triple(e.optString("name", pkg.split(".").last()), e.optInt("used", 0), e.optInt("limit", 0))
        }
        isActive = timerBlockApps.isNotEmpty()
    }

    private fun persistState() {
        val obj = JSONObject()
        timerBlockApps.forEach { (pkg, t) ->
            obj.put(pkg, JSONObject().apply { put("name", t.first); put("used", t.second); put("limit", t.third) })
        }
        prefs.edit()
            .putBoolean("timerblockmode", timerBlockApps.isNotEmpty())
            .putString ("timerblock_pkgs_map", obj.toString())
            .apply()
    }

    private fun isSameDay(a: Long, b: Long): Boolean {
        val calA = java.util.Calendar.getInstance().apply { timeInMillis = a }
        val calB = java.util.Calendar.getInstance().apply { timeInMillis = b }
        return calA.get(java.util.Calendar.YEAR) == calB.get(java.util.Calendar.YEAR) &&
                calA.get(java.util.Calendar.DAY_OF_YEAR) == calB.get(java.util.Calendar.DAY_OF_YEAR)
    }
}