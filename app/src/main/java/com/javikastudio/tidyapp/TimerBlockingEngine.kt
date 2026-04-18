package com.javikastudio.tidyapp

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
 *
 * Extracted from AppMonitorService.TimerBlockHandler (Phase 5 full refactor).
 * Receives an [AppMonitorService.EngineHelpers] bundle for all service-owned
 * utilities — never touches AppMonitorService fields directly.
 */
class TimerBlockingEngine(
    private val prefs:       SharedPreferences,
    private val coordinator: AppMonitorService.OverlayCoordinator,
    private val h:           AppMonitorService.EngineHelpers
) {
    var isActive = false
        private set

    // pkg -> Triple(appName, usedMins, limitMins)
    private val timerBlockApps  = mutableMapOf<String, Triple<String, Int, Int>>()
    private val gracePerApp     = mutableMapOf<String, Long>()
    private val graceInFgPerApp = mutableMapOf<String, Boolean>()

    // In-memory fg tracking — updated every tick regardless of event window age.
    // Fixes the grace-expiry bug where users staying in an app >5 min were
    // never shown the overlay because the FG event was outside the query window.
    private val currentlyInFgApps = mutableSetOf<String>()

    // Display fields for the currently shown overlay
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

    fun onDestroy() { /* nothing beyond what coordinator handles */ }

    /**
     * Called each tick. Returns true if timer overlay is active/shown this tick.
     */
    fun onTick(currentFgPkg: String, now: Long): Boolean {
        if (!isActive) return coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)

        syncFromPrefs()
        if (timerBlockApps.isEmpty()) { isActive = false; coordinator.dismiss(AppMonitorService.PRIORITY_TIMER); return false }
        if (!isSameDay(now, lastBlockedTs)) { clearAll(); return false }

        currentlyInFgApps.clear()
        if (currentFgPkg.isNotEmpty() && timerBlockApps.containsKey(currentFgPkg))
            currentlyInFgApps.add(currentFgPkg)

        if (coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)) return true

        // PATH A: grace-expiry for apps that had grace granted while already in fg.
        for ((pkg, _) in timerBlockApps.toMap()) {
            val pkgGrace = gracePerApp[pkg] ?: 0L
            if (pkgGrace in 1..now && graceInFgPerApp[pkg] == true) {
                gracePerApp[pkg]     = 0L
                graceInFgPerApp[pkg] = false
                prefs.edit().remove("timer_grace_until_ts_$pkg").remove("timer_grace_in_fg_$pkg").apply()
                if (currentlyInFgApps.contains(pkg)) {
                    setDisplayFields(pkg); showTimerOverlay()
                    return coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)
                }
            }
        }

        // Main path
        val effectiveFgPkg = if (currentFgPkg.isNotEmpty()) currentFgPkg
        else currentlyInFgApps.firstOrNull() ?: return false
        if (h.isFocusBlockingPackage(effectiveFgPkg)) return false
        timerBlockApps[effectiveFgPkg] ?: return false
        val grace = gracePerApp[effectiveFgPkg] ?: 0L
        if (grace > 0L && now < grace) return false

        setDisplayFields(effectiveFgPkg)
        lastBlockedTs = now
        showTimerOverlay()
        return coordinator.isShowing(AppMonitorService.PRIORITY_TIMER)
    }

    /** Called when a higher-priority overlay owns the slot — state maintenance only, no overlay. */
    fun onTickNoOverlay(currentFgPkg: String, now: Long) {
        if (!isActive) return
        syncFromPrefs()
        if (timerBlockApps.isEmpty()) { isActive = false; return }

        currentlyInFgApps.clear()
        if (currentFgPkg.isNotEmpty() && timerBlockApps.containsKey(currentFgPkg))
            currentlyInFgApps.add(currentFgPkg)

        // Silently expire grace timestamps
        for ((pkg, _) in timerBlockApps.toMap()) {
            val pkgGrace = gracePerApp[pkg] ?: 0L
            if (pkgGrace in 1..now && graceInFgPerApp[pkg] == true) {
                gracePerApp[pkg]     = 0L
                graceInFgPerApp[pkg] = false
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
        val ctx    = h.context
        val accent = 0xFFF04E7A.toInt()

        val root = FrameLayout(ctx).apply { setBackgroundColor(Color.rgb(10, 8, 5)) }

        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(h.dpToPx(32), h.dpToPx(16), h.dpToPx(32), h.dpToPx(16))
        }

        // Aurelo wordmark header
        root.addView(h.buildAureloWordmarkView(), FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity   = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 52 else 36)
        })

        // Mode title
        root.addView(TextView(ctx).apply {
            text = "Daily Timer"; textSize = 19f
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
            setTextColor(Color.argb(230, 255, 243, 220)); gravity = Gravity.CENTER; letterSpacing = 0.05f
        }, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity   = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 88 else 72)
        })

        // Badge
        col.addView(TextView(ctx).apply {
            text = "⏱ DAILY LIMIT REACHED"; textSize = 10f; letterSpacing = 0.12f; setTextColor(accent)
            setPadding(h.dpToPx(12), h.dpToPx(5), h.dpToPx(12), h.dpToPx(5))
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(999).toFloat()
                it.setColor(Color.argb(25, 240, 78, 122)); it.setStroke(1, Color.argb(60, 240, 78, 122))
            }
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(28) })

        // App icon
        val icoWrap = FrameLayout(ctx)
        val icoView = ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            runCatching { setImageDrawable(h.packageManager.getApplicationIcon(overlayPkg)) }
        }
        val icoBg = View(ctx).apply {
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(22).toFloat()
                it.setColor(Color.argb(50, 240, 78, 122)); it.setStroke(1, Color.argb(80, 240, 78, 122))
            }
        }
        val icoSz = h.dpToPx(80)
        icoWrap.addView(icoBg, FrameLayout.LayoutParams(icoSz + h.dpToPx(8), icoSz + h.dpToPx(8)).apply { gravity = Gravity.CENTER })
        icoWrap.addView(icoView, FrameLayout.LayoutParams(icoSz, icoSz).apply { gravity = Gravity.CENTER })
        col.addView(icoWrap, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(20) })

        col.addView(TextView(ctx).apply {
            text = overlayName; textSize = 22f; setTextColor(Color.argb(230, 255, 243, 220))
            gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(8) })

        col.addView(TextView(ctx).apply {
            text = "${overlayUsed}m used today · ${overlayLimit}m limit"
            textSize = 13f; setTextColor(Color.argb(153, 255, 243, 220)); gravity = Gravity.CENTER
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(32) })

        // Primary: Take a break
        col.addView(TextView(ctx).apply {
            text = "Take a break →"; textSize = 14f; setTextColor(0xFF060610.toInt())
            gravity = Gravity.CENTER; setPadding(h.dpToPx(24), h.dpToPx(15), h.dpToPx(24), h.dpToPx(15))
            background = GradientDrawable().also { it.cornerRadius = h.dpToPx(14).toFloat(); it.setColor(accent) }
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_TIMER)
                runCatching {
                    h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
                }
            }
        }, h.linearFill().also { it.bottomMargin = h.dpToPx(10) })

        // Secondary: hold 3 seconds for 5 more minutes
        val escapeBtn = TextView(ctx)
        var holdHandler: Handler? = null
        var holdProgress = 0

        fun resetHold() {
            holdHandler?.removeCallbacksAndMessages(null); holdProgress = 0
            escapeBtn.text = "Hold 3s for 5 more minutes"
            escapeBtn.setTextColor(Color.argb(100, 255, 170, 68))
            escapeBtn.background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(14).toFloat()
                it.setColor(Color.argb(20, 255, 255, 255)); it.setStroke(1, Color.argb(30, 255, 255, 255))
            }
        }

        val capturedOverlayPkg = overlayPkg   // capture at build time, not at click time
        escapeBtn.apply {
            text = "Hold 3s for 5 more minutes"; textSize = 12f
            setTextColor(Color.argb(100, 255, 170, 68)); gravity = Gravity.CENTER
            setPadding(h.dpToPx(24), h.dpToPx(13), h.dpToPx(24), h.dpToPx(13))
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(14).toFloat()
                it.setColor(Color.argb(20, 255, 255, 255)); it.setStroke(1, Color.argb(30, 255, 255, 255))
            }
            setOnTouchListener { _, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        holdHandler = Handler(Looper.getMainLooper())
                        holdHandler?.postDelayed(object : Runnable {
                            override fun run() {
                                holdProgress++
                                val secs = holdProgress / 3
                                if (secs >= 3) {
                                    val graceTs = System.currentTimeMillis() + AppMonitorService.GRACE_MS
                                    gracePerApp[capturedOverlayPkg]     = graceTs
                                    graceInFgPerApp[capturedOverlayPkg] = true
                                    prefs.edit()
                                        .putLong   ("timer_grace_until_ts_$capturedOverlayPkg", graceTs)
                                        .putBoolean("timer_grace_in_fg_$capturedOverlayPkg",    true)
                                        .apply()
                                    // Log ignore stat
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
                                    val rem = 3 - secs
                                    escapeBtn.text = "Keep holding… ${rem}s"
                                    escapeBtn.setTextColor(Color.argb(160 + holdProgress * 20, 255, 170, 68))
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
        col.addView(escapeBtn, h.linearFill())

        root.addView(col, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER })
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