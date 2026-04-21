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
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONArray

/**
 * IntentionEngine
 *
 * Owns: always-on mindful opening pause, breathing animation, resist/continue
 * buttons, pause/resist stat recording, and JS callbacks.
 *
 * Extracted from AppMonitorService.IntentionHandler (Phase 5 full refactor).
 * Receives an [AppMonitorService.EngineHelpers] bundle for all service-owned
 * utilities — never touches AppMonitorService fields directly.
 */
class IntentionEngine(
    private val prefs:       SharedPreferences,
    private val coordinator: AppMonitorService.OverlayCoordinator,
    private val h:           AppMonitorService.EngineHelpers
) {
    var isActive = false
        private set

    private var intentionPkgs  = emptySet<String>()
    private var intentionNames = mapOf<String, String>()

    // Dedup: 3-second window suppresses duplicate events for the same app open
    private val lastEventMap = mutableMapOf<String, Long>()

    // Session allow-list: packages where the user clicked "Continue" — overlay
    // won't re-show while the app remains in the foreground. Cleared automatically
    // the moment the app moves to background (previousFgPkg changes away from it).
    private val allowedPkgs  = mutableSetOf<String>()
    private var previousFgPkg = ""

    // ── Public API ────────────────────────────────────────────────────────────

    fun enable() {
        prefs.edit().putBoolean("focus_intention_enabled", true).apply()
        reloadConfig()
        isActive = intentionPkgs.isNotEmpty()
    }

    fun disable() {
        isActive = false
        prefs.edit().putBoolean("focus_intention_enabled", false).apply()
        coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
    }

    fun restoreFromPrefs() {
        if (!prefs.getBoolean("focus_intention_enabled", false)) return
        reloadConfig()
        isActive = intentionPkgs.isNotEmpty()
    }

    fun reloadConfig() {
        val json  = prefs.getString("focus_intention_apps", "[]") ?: "[]"
        val arr   = runCatching { JSONArray(json) }.getOrElse { JSONArray() }
        val pkgs  = mutableSetOf<String>()
        val names = mutableMapOf<String, String>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val pkg = obj.optString("packageName").takeIf { it.isNotBlank() } ?: continue
            pkgs += pkg; names[pkg] = obj.optString("name", pkg.split(".").last())
        }
        intentionPkgs  = pkgs; intentionNames = names
        isActive = prefs.getBoolean("focus_intention_enabled", false) && intentionPkgs.isNotEmpty()
    }

    fun onDestroy() {
        // CountDownTimer is held inside the overlay view — dismissed by coordinator.forceRemove()
    }

    /**
     * Called each tick when focus and timer overlays are not showing.
     */
    fun onTick(currentFgPkg: String, now: Long) {
        if (!isActive) return
        if (coordinator.isShowing(AppMonitorService.PRIORITY_INTENTION)) return

        // When the foreground app changes, the previous app has been closed/backgrounded —
        // evict it from the allow-list so the next open of that app triggers a prompt again.
        if (currentFgPkg != previousFgPkg) {
            if (previousFgPkg.isNotEmpty()) allowedPkgs.remove(previousFgPkg)
            previousFgPkg = currentFgPkg
        }

        if (currentFgPkg.isEmpty() || currentFgPkg == h.packageName) return
        if (!intentionPkgs.contains(currentFgPkg)) return

        // User already clicked "Continue" for this app in this foreground session — don't re-show.
        if (allowedPkgs.contains(currentFgPkg)) return

        // Skip if focus session is blocking this specific app
        if (prefs.getBoolean("focus_session_active", false)) {
            val focusPkgs = runCatching {
                JSONArray(prefs.getString("focus_blocked_apps", "[]") ?: "[]")
                    .run { (0 until length()).mapNotNull { optJSONObject(it)?.optString("packageName") }.toSet() }
            }.getOrDefault(emptySet())
            if (focusPkgs.contains(currentFgPkg)) return
        }

        // Dedup: 3-second window to avoid re-firing for the same open event
        val last = lastEventMap[currentFgPkg] ?: 0L
        if (now - last < 3000L) return

        lastEventMap[currentFgPkg] = now
        val appName = intentionNames[currentFgPkg] ?: currentFgPkg.split(".").last()
        recordPause(currentFgPkg)
        showPromptOverlay(currentFgPkg, appName)
    }

    /**
     * Called when a higher-priority overlay is showing. Intentionally does NOT
     * update [lastEventMap] so the next real open still gets a prompt.
     */
    fun onTickNoOverlay(currentFgPkg: String, now: Long) {
        // no-op by design — see KDoc above
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun showPromptOverlay(pkg: String, appName: String) {
        if (!h.canDrawOverlay()) { showFallbackNotification(appName); return }
        h.vibrate(longArrayOf(0, 25))
        val root  = buildIntentionOverlayView(pkg, appName)
        val shown = coordinator.show(AppMonitorService.PRIORITY_INTENTION, root)
        if (!shown) showFallbackNotification(appName)
    }

    private fun buildIntentionOverlayView(pkg: String, appName: String): View {
        val ctx = h.context

        // ── Colours — Aurelo warm amber palette ──────────────────────────────
        val bgColor       = Color.rgb(10, 8, 5)
        val amberMid      = Color.rgb(255, 170, 68)
        val amberLight    = Color.rgb(255, 217, 125)
        val cream         = Color.rgb(255, 243, 220)
        val glowFill      = Color.argb(20,  255, 217, 125)
        val ringOuter     = Color.argb(38,  255, 170, 68)
        val ringMain      = Color.argb(179, 255, 170, 68)
        val ringMid       = Color.argb(102, 255, 217, 125)
        val ringInner     = Color.argb(128, 255, 170, 68)
        val openBtnFill   = Color.argb(38,  255, 170, 68)
        val openBtnBorder = Color.argb(128, 255, 170, 68)
        val resistBorder  = Color.argb(76,  255, 170, 68)
        val textCream     = Color.argb(230, 255, 243, 220)
        val textAmber     = Color.argb(179, 255, 170, 68)
        val textSub       = Color.argb(153, 255, 243, 220)
        val chipBg        = Color.argb(15,  255, 255, 255)
        val chipBorder    = Color.argb(26,  255, 255, 255)

        val root = FrameLayout(ctx).apply {
            setBackgroundColor(bgColor); clipChildren = false; clipToPadding = false
        }

        // ── Header: wordmark + "Mindful Pause" ───────────────────────────────
        val mindfulPauseLabel = TextView(ctx).apply {
            text = "Mindful Pause"; textSize = 19f
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
            setTextColor(textCream); gravity = Gravity.CENTER; letterSpacing = 0.05f
        }
        val headerArea = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        }
        headerArea.addView(h.buildAureloWordmarkView(), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER_HORIZONTAL })
        headerArea.addView(mindfulPauseLabel, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.topMargin = h.dpToPx(10) })
        root.addView(headerArea, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity   = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 52 else 36)
        })

        // ── App chip: "Opening Instagram" ────────────────────────────────────
        val appChip = TextView(ctx).apply {
            text = "Opening  \u00A0$appName"; textSize = 13f; letterSpacing = 0.08f
            setTextColor(Color.argb(204, 255, 243, 220))
            setPadding(h.dpToPx(14), h.dpToPx(6), h.dpToPx(14), h.dpToPx(6))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(20).toFloat(); setColor(chipBg); setStroke(1, chipBorder)
            }
        }

        // ── Phase 1 — Aura Ring breathing ────────────────────────────────────
        val phase1 = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false; clipToPadding = false
            setPadding(h.dpToPx(32), 0, h.dpToPx(32), 0)
        }

        val ringContainerSz  = h.dpToPx(144)
        val auraContainer    = FrameLayout(ctx).apply { clipChildren = false; clipToPadding = false }

        val glowView = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(glowFill) }
        }
        val ring1 = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(1, ringOuter) }
        }
        val ring2 = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(h.dpToPx(2), ringMain) }
        }
        val ring3 = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(1, ringMid) }
        }
        val centerDot = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(amberMid) }
        }
        val ring4 = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(1, ringInner) }
        }

        auraContainer.addView(glowView,   FrameLayout.LayoutParams(h.dpToPx(112), h.dpToPx(112)).apply { gravity = Gravity.CENTER })
        auraContainer.addView(ring1,      FrameLayout.LayoutParams(h.dpToPx(100), h.dpToPx(100)).apply { gravity = Gravity.CENTER })
        auraContainer.addView(ring2,      FrameLayout.LayoutParams(h.dpToPx(84),  h.dpToPx(84) ).apply { gravity = Gravity.CENTER })
        auraContainer.addView(ring3,      FrameLayout.LayoutParams(h.dpToPx(64),  h.dpToPx(64) ).apply { gravity = Gravity.CENTER })
        auraContainer.addView(centerDot,  FrameLayout.LayoutParams(h.dpToPx(16),  h.dpToPx(16) ).apply { gravity = Gravity.CENTER })
        auraContainer.addView(ring4,      FrameLayout.LayoutParams(h.dpToPx(28),  h.dpToPx(28) ).apply { gravity = Gravity.CENTER })

        phase1.addView(auraContainer, LinearLayout.LayoutParams(ringContainerSz, ringContainerSz).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = h.dpToPx(20); bottomMargin = h.dpToPx(16)
        })

        val breatheLabel = TextView(ctx).apply {
            text = "breathe in"; textSize = 11f; letterSpacing = 0.25f
            setTextColor(textAmber); gravity = Gravity.CENTER
        }
        phase1.addView(breatheLabel, h.linearWrap(Gravity.CENTER_HORIZONTAL))

        // ── Phase 2 — CTA (hidden until breathing ends) ───────────────────────
        val phase2 = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(h.dpToPx(32), 0, h.dpToPx(32), 0); visibility = View.GONE; alpha = 0f
        }

        phase2.addView(TextView(ctx).apply {
            text = "Do you intend to open\n$appName right now?"; textSize = 14f
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
            setTextColor(textSub); gravity = Gravity.CENTER; setLineSpacing(0f, 1.6f); letterSpacing = 0.03f
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(24) })

        val btnRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }

        val resistBtn = TextView(ctx).apply {
            text = "Resist"; textSize = 11f; letterSpacing = 0.18f; setTextColor(amberMid)
            gravity = Gravity.CENTER; setPadding(0, h.dpToPx(12), 0, h.dpToPx(12))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(14).toFloat(); setColor(Color.TRANSPARENT); setStroke(1, resistBorder)
            }
            isClickable = true; isFocusable = true
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
                // Remove only this pkg's timestamp so the prompt fires again if user returns to the app.
                // Don't touch other entries in lastEventMap.
                lastEventMap.remove(pkg)
                recordResist(pkg)
                runCatching {
                    h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
                }
            }
        }
        val openBtn = TextView(ctx).apply {
            text = "Continue"; textSize = 11f; letterSpacing = 0.18f; setTextColor(amberLight)
            gravity = Gravity.CENTER; setPadding(0, h.dpToPx(12), 0, h.dpToPx(12))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(14).toFloat(); setColor(openBtnFill); setStroke(1, openBtnBorder)
            }
            isClickable = true; isFocusable = true
            setOnClickListener {
                // Allow this app for the current foreground session.
                // The overlay will re-appear only after the user closes and reopens the app.
                allowedPkgs.add(pkg)
                coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
            }
        }
        btnRow.addView(resistBtn, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            .also { it.rightMargin = h.dpToPx(10) })
        btnRow.addView(openBtn,   LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        phase2.addView(btnRow, h.linearFill())

        // ── Assemble content column ───────────────────────────────────────────
        val contentCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false; clipToPadding = false
        }
        contentCol.addView(appChip, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(4) })
        contentCol.addView(phase1,  LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        contentCol.addView(phase2,  LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        root.addView(contentCol, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER })

        // ── Breathing animations ───────────────────────────────────────────────
        val expandRings = ValueAnimator.ofFloat(0.85f, 1.15f).apply {
            duration = 2500L; interpolator = DecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                ring1.scaleX = v; ring1.scaleY = v; ring2.scaleX = v; ring2.scaleY = v
                ring3.scaleX = v; ring3.scaleY = v; ring4.scaleX = v; ring4.scaleY = v
            }
        }
        val expandGlow = ValueAnimator.ofFloat(0.7f, 1.3f).apply {
            duration = 2500L; interpolator = DecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                glowView.scaleX = v; glowView.scaleY = v; centerDot.scaleX = v; centerDot.scaleY = v
            }
        }
        val contractRings = ValueAnimator.ofFloat(1.15f, 0.85f).apply {
            duration = 2500L; interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                ring1.scaleX = v; ring1.scaleY = v; ring2.scaleX = v; ring2.scaleY = v
                ring3.scaleX = v; ring3.scaleY = v; ring4.scaleX = v; ring4.scaleY = v
            }
        }
        val contractGlow = ValueAnimator.ofFloat(1.3f, 0.7f).apply {
            duration = 2500L; interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                glowView.scaleX = v; glowView.scaleY = v; centerDot.scaleX = v; centerDot.scaleY = v
            }
        }

        val phaseHandler = Handler(Looper.getMainLooper())
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                expandRings.start(); expandGlow.start()
                phaseHandler.postDelayed({
                    breatheLabel.text = "breathe out"; contractRings.start(); contractGlow.start()
                }, 2500L)
                phaseHandler.postDelayed({
                    phase1.animate().alpha(0f).setDuration(300L).withEndAction {
                        phase1.visibility = View.GONE; phase2.visibility = View.VISIBLE
                        phase2.animate().alpha(1f).setDuration(400L).start()
                    }.start()
                }, 5000L)
            }
            override fun onViewDetachedFromWindow(v: View) {
                phaseHandler.removeCallbacksAndMessages(null)
                expandRings.cancel(); expandGlow.cancel()
                contractRings.cancel(); contractGlow.cancel()
            }
        })

        return root
    }

    private fun showFallbackNotification(appName: String) {
        h.nm.notify(h.notifId + 2, NotificationCompat.Builder(h.context, h.channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF12D48A.toInt())
            .setContentTitle("✦ What are you looking for?")
            .setContentText("You just opened $appName. Is this intentional?")
            .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).build())
    }

    private fun recordPause(pkg: String) {
        val t   = today()
        // ── Aggregate count ─────────────────────────────────────────────────
        val cur = if (prefs.getString("focus_intention_pause_date", "") == t)
            prefs.getInt("focus_intention_pause_count", 0) else 0
        prefs.edit()
            .putString("focus_intention_pause_date",  t)
            .putInt(   "focus_intention_pause_count", cur + 1)
            // ── Per-app count (Bug 4 fix: store per-pkg so JS can show individual stats) ──
            .putString("focus_intention_pause_date_$pkg",  t)
            .putInt(   "focus_intention_pause_count_$pkg",
                if (prefs.getString("focus_intention_pause_date_$pkg", "") == t)
                    prefs.getInt("focus_intention_pause_count_$pkg", 0) + 1 else 1)
            .apply()
        // Bug 2 fix: pass pkg as argument so JS onIntentionPause(pkg) can track per-app counts
        h.notifyJs("if(typeof window.onIntentionPause==='function') window.onIntentionPause('${pkg.replace("'", "\\'")}')")
    }

    private fun recordResist(pkg: String) {
        val t   = today()
        // ── Aggregate count ─────────────────────────────────────────────────
        val cur = if (prefs.getString("focus_intention_resist_date", "") == t)
            prefs.getInt("focus_intention_resist_count", 0) else 0
        prefs.edit()
            .putString("focus_intention_resist_date",  t)
            .putInt(   "focus_intention_resist_count", cur + 1)
            // ── Per-app count ────────────────────────────────────────────────
            .putString("focus_intention_resist_date_$pkg",  t)
            .putInt(   "focus_intention_resist_count_$pkg",
                if (prefs.getString("focus_intention_resist_date_$pkg", "") == t)
                    prefs.getInt("focus_intention_resist_count_$pkg", 0) + 1 else 1)
            .apply()
        // Bug 2 fix: pass pkg as argument
        h.notifyJs("if(typeof window.onIntentionResist==='function') window.onIntentionResist('${pkg.replace("'", "\\'")}')")
    }

    private fun today(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
}