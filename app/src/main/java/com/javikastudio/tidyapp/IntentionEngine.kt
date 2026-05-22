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
        val MP  = LinearLayout.LayoutParams.MATCH_PARENT
        val WC  = LinearLayout.LayoutParams.WRAP_CONTENT

        // ── Colour palette — deep indigo-black with purple accent ─────────────────────────
        val bgColor        = Color.parseColor("#0A0A14")
        val accent         = Color.parseColor("#7C6AF7")       // Aurelo purple
        val accentDark     = Color.parseColor("#5A4FCC")
        val accentFill     = Color.argb(18,  124, 106, 247)   // very faint fill
        val accentGlow     = Color.argb(35,  124, 106, 247)   // outer ring glow
        val accentMid      = Color.argb(120, 124, 106, 247)   // main ring border
        val accentStrong   = Color.argb(200, 124, 106, 247)   // inner ring border
        val white90        = Color.argb(230, 255, 255, 255)
        val white60        = Color.argb(153, 255, 255, 255)
        val white35        = Color.argb(89,  255, 255, 255)
        val white15        = Color.argb(38,  255, 255, 255)
        val pillBg         = Color.argb(22,  255, 255, 255)
        val pillBorder     = Color.argb(45,  255, 255, 255)
        val ghostBorder    = Color.argb(55,  255, 255, 255)

        val root = FrameLayout(ctx).apply {
            setBackgroundColor(bgColor); clipChildren = false; clipToPadding = false
        }

        // ── Header area: Aurelo wordmark + subtitle ─────────────────────────────────
        val headerCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        }
        headerCol.addView(h.buildAureloWordmarkView(),
            LinearLayout.LayoutParams(WC, WC).apply { gravity = Gravity.CENTER_HORIZONTAL })
        headerCol.addView(TextView(ctx).apply {
            text = "MINDFUL PAUSE"; textSize = 9.5f; letterSpacing = 0.28f
            setTextColor(accentMid); gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(MP, WC).apply { topMargin = h.dpToPx(5) })

        root.addView(headerCol, FrameLayout.LayoutParams(MP, WC).apply {
            gravity   = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 54 else 38)
        })

        // ── App identity pill: [icon] [AppName] ─────────────────────────────────────
        // Shared between phase1 and phase2 — stays on screen the whole time.
        val appPill = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            setPadding(h.dpToPx(10), h.dpToPx(7), h.dpToPx(14), h.dpToPx(7))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(28).toFloat()
                setColor(pillBg); setStroke(1, pillBorder)
            }
        }
        try {
            // Show the real app icon in the pill for instant visual context
            val icon = ctx.packageManager.getApplicationIcon(pkg)
            val iconView = android.widget.ImageView(ctx).apply {
                setImageDrawable(icon)
                scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            }
            appPill.addView(iconView, LinearLayout.LayoutParams(h.dpToPx(22), h.dpToPx(22)))
        } catch (_: Exception) {} // graceful fallback: no icon, just name
        appPill.addView(TextView(ctx).apply {
            text = appName; textSize = 13f; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(white90)
        }, LinearLayout.LayoutParams(WC, WC).apply { leftMargin = h.dpToPx(7) })

        val pillRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
        }
        pillRow.addView(appPill)

        // ── Phase 1: breathing orb ──────────────────────────────────────────────────
        val phase1 = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false; clipToPadding = false
        }

        // Orb: 3 concentric rings + center dot (clean, Calm-style)
        val orbSz      = h.dpToPx(148)
        val orbContainer = FrameLayout(ctx).apply { clipChildren = false; clipToPadding = false }

        // Outer atmospheric halo — large, extremely faint, scaled hard during breathe
        val outerHalo = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(accentFill); setStroke(1, accentGlow)
            }
        }
        // Main breathing ring — clearly visible, pulses with main scale
        val mainRing = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(accentFill); setStroke(h.dpToPx(2), accentMid)
            }
        }
        // Inner core — slightly filled, stronger border, scales with center dot
        val innerCore = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(30, 124, 106, 247)); setStroke(h.dpToPx(2), accentStrong)
            }
        }
        // Center dot — solid accent, pulses most dramatically
        val centerDot = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(accent)
            }
        }

        orbContainer.addView(outerHalo, FrameLayout.LayoutParams(h.dpToPx(148), h.dpToPx(148)).apply { gravity = Gravity.CENTER })
        orbContainer.addView(mainRing,  FrameLayout.LayoutParams(h.dpToPx(104), h.dpToPx(104)).apply { gravity = Gravity.CENTER })
        orbContainer.addView(innerCore, FrameLayout.LayoutParams(h.dpToPx(58),  h.dpToPx(58) ).apply { gravity = Gravity.CENTER })
        orbContainer.addView(centerDot, FrameLayout.LayoutParams(h.dpToPx(12),  h.dpToPx(12) ).apply { gravity = Gravity.CENTER })

        phase1.addView(orbContainer, LinearLayout.LayoutParams(orbSz, orbSz).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = h.dpToPx(28); bottomMargin = h.dpToPx(18)
        })

        val breatheLabel = TextView(ctx).apply {
            text = "breathe in"; textSize = 11f; letterSpacing = 0.22f
            setTextColor(accent); gravity = Gravity.CENTER
        }
        phase1.addView(breatheLabel, LinearLayout.LayoutParams(MP, WC))
        phase1.addView(TextView(ctx).apply {
            text = "take a moment before opening"; textSize = 11.5f
            setTextColor(white35); gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(MP, WC).apply { topMargin = h.dpToPx(7) })

        // ── Phase 2: intent check ──────────────────────────────────────────────────
        val phase2 = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(h.dpToPx(30), 0, h.dpToPx(30), 0)
            visibility = View.GONE; alpha = 0f
        }

        // Question heading — bolder, more direct than before
        phase2.addView(TextView(ctx).apply {
            text = "What do you need from $appName right now?"; textSize = 21f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(white90); gravity = Gravity.CENTER; setLineSpacing(0f, 1.35f)
        }, LinearLayout.LayoutParams(MP, WC).apply { topMargin = h.dpToPx(28); bottomMargin = h.dpToPx(10) })

        phase2.addView(TextView(ctx).apply {
            text = "Be intentional — no judgement."; textSize = 12.5f
            setTextColor(white35); gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(32) })

        // Primary CTA: open the app — filled, clearly primary
        val openBtn = TextView(ctx).apply {
            text = "Open $appName"; textSize = 15f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = Gravity.CENTER
            setPadding(0, h.dpToPx(17), 0, h.dpToPx(17))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(18).toFloat()
                // Vertical gradient: lighter top to darker bottom for tactile depth
                setColors(intArrayOf(accent, accentDark))
                orientation = GradientDrawable.Orientation.TOP_BOTTOM
            }
            isClickable = true; isFocusable = true
            setOnClickListener {
                allowedPkgs.add(pkg)   // allow for this foreground session
                coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
            }
        }
        phase2.addView(openBtn, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(11) })

        // Secondary: resist — ghost button, clearly secondary
        val resistBtn = TextView(ctx).apply {
            text = "Not now — go back"; textSize = 14f
            setTextColor(white60); gravity = Gravity.CENTER
            setPadding(0, h.dpToPx(15), 0, h.dpToPx(15))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(18).toFloat()
                setColor(Color.TRANSPARENT); setStroke(1, ghostBorder)
            }
            isClickable = true; isFocusable = true
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
                lastEventMap.remove(pkg)   // allow prompt to fire again on next open
                recordResist(pkg)
                runCatching {
                    h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
                }
            }
        }
        phase2.addView(resistBtn, LinearLayout.LayoutParams(MP, WC))

        // ── Assemble full content column ─────────────────────────────────────────────
        val contentCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false; clipToPadding = false
        }
        contentCol.addView(pillRow, LinearLayout.LayoutParams(MP, WC))
        contentCol.addView(phase1,  LinearLayout.LayoutParams(MP, WC))
        contentCol.addView(phase2,  LinearLayout.LayoutParams(MP, WC))

        root.addView(contentCol, FrameLayout.LayoutParams(MP, WC).apply { gravity = Gravity.CENTER })

        // ── Breathing animations ──────────────────────────────────────────────────
        // outerHalo + mainRing breathe together (rings expand)
        val expandRings = ValueAnimator.ofFloat(0.86f, 1.14f).apply {
            duration = 2500L; interpolator = DecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                outerHalo.scaleX = v; outerHalo.scaleY = v
                mainRing.scaleX  = v; mainRing.scaleY  = v
            }
        }
        // innerCore + centerDot pulse with slightly wider range for depth
        val expandCore = ValueAnimator.ofFloat(0.75f, 1.28f).apply {
            duration = 2500L; interpolator = DecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                innerCore.scaleX = v; innerCore.scaleY = v
                centerDot.scaleX = v; centerDot.scaleY = v
            }
        }
        val contractRings = ValueAnimator.ofFloat(1.14f, 0.86f).apply {
            duration = 2500L; interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                outerHalo.scaleX = v; outerHalo.scaleY = v
                mainRing.scaleX  = v; mainRing.scaleY  = v
            }
        }
        val contractCore = ValueAnimator.ofFloat(1.28f, 0.75f).apply {
            duration = 2500L; interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                innerCore.scaleX = v; innerCore.scaleY = v
                centerDot.scaleX = v; centerDot.scaleY = v
            }
        }

        val phaseHandler = Handler(Looper.getMainLooper())
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {
                expandRings.start(); expandCore.start()
                phaseHandler.postDelayed({
                    // Smooth label swap: fade out → swap text → fade in
                    breatheLabel.animate().alpha(0f).setDuration(250L).withEndAction {
                        breatheLabel.text = "breathe out"
                        breatheLabel.animate().alpha(1f).setDuration(250L).start()
                    }.start()
                    contractRings.start(); contractCore.start()
                }, 2500L)
                phaseHandler.postDelayed({
                    phase1.animate().alpha(0f).setDuration(350L).withEndAction {
                        phase1.visibility = View.GONE
                        phase2.visibility = View.VISIBLE
                        phase2.animate().alpha(1f).setDuration(450L).start()
                    }.start()
                }, 5000L)
            }
            override fun onViewDetachedFromWindow(v: View) {
                phaseHandler.removeCallbacksAndMessages(null)
                expandRings.cancel(); expandCore.cancel()
                contractRings.cancel(); contractCore.cancel()
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
        val t = today()
        val aggCount = if (prefs.getString("focus_intention_pause_date", "") == t)
            prefs.getInt("focus_intention_pause_count", 0) else 0
        val appCount = if (prefs.getString("focus_intention_pause_date_$pkg", "") == t)
            prefs.getInt("focus_intention_pause_count_$pkg", 0) else 0
        prefs.edit()
            .putString("focus_intention_pause_date",       t)
            .putInt(   "focus_intention_pause_count",      aggCount + 1)
            .putString("focus_intention_pause_date_$pkg",  t)
            .putInt(   "focus_intention_pause_count_$pkg", appCount + 1)
            .apply()
        h.notifyJs("if(typeof window.onIntentionPause==='function') window.onIntentionPause('${pkg.replace("'", "\\'")}')")
    }

    private fun recordResist(pkg: String) {
        val t = today()
        val aggCount = if (prefs.getString("focus_intention_resist_date", "") == t)
            prefs.getInt("focus_intention_resist_count", 0) else 0
        val appCount = if (prefs.getString("focus_intention_resist_date_$pkg", "") == t)
            prefs.getInt("focus_intention_resist_count_$pkg", 0) else 0
        prefs.edit()
            .putString("focus_intention_resist_date",       t)
            .putInt(   "focus_intention_resist_count",      aggCount + 1)
            .putString("focus_intention_resist_date_$pkg",  t)
            .putInt(   "focus_intention_resist_count_$pkg", appCount + 1)
            .apply()
        h.notifyJs("if(typeof window.onIntentionResist==='function') window.onIntentionResist('${pkg.replace("'", "\\'")}')")
    }

    private fun today(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
}