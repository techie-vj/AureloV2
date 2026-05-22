package com.javikastudio.tidyapp

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
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
import android.view.animation.OvershootInterpolator
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
 *
 * v2 — one-sec style overlay:
 *   • Full-screen deep-blue gradient backdrop (matches one sec brand)
 *   • Large orb (3 staggered rings + glowing core) with 4 s breathe cycle
 *   • Open-count stat badge above progress bar
 *   • Progress bar counts down BREATH_LOCK_MS before Continue unlocks
 *   • Phase 2: intention chip-picker + weekly insight line
 */
class IntentionEngine(
    private val prefs: SharedPreferences,
    private val coordinator: AppMonitorService.OverlayCoordinator,
    private val h: AppMonitorService.EngineHelpers
) {
    var isActive = false
        private set

    private var intentionPkgs = emptySet<String>()
    private var intentionNames = mapOf<String, String>()

    // Dedup: 3-second window suppresses duplicate events for the same app open
    private val lastEventMap = mutableMapOf<String, Long>()

    // Session allow-list: packages where the user clicked "Continue" — overlay
    // won't re-show while the app remains in the foreground. Cleared automatically
    // the moment the app moves to background (previousFgPkg changes away from it).
    private val allowedPkgs = mutableSetOf<String>()
    private var previousFgPkg = ""

    // How long the breath phase must run before Continue unlocks (ms)
    private val BREATH_LOCK_MS = 5_000L
    // Full breathe-in / breathe-out cycle duration (ms)
    private val BREATH_CYCLE_MS = 4_000L

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
        val json = prefs.getString("focus_intention_apps", "[]") ?: "[]"
        val arr = runCatching { JSONArray(json) }.getOrElse { JSONArray() }
        val pkgs = mutableSetOf<String>()
        val names = mutableMapOf<String, String>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val pkg = obj.optString("packageName").takeIf { it.isNotBlank() } ?: continue
            pkgs += pkg; names[pkg] = obj.optString("name", pkg.split(".").last())
        }
        intentionPkgs = pkgs; intentionNames = names
        isActive = prefs.getBoolean("focus_intention_enabled", false) && intentionPkgs.isNotEmpty()
    }

    fun onDestroy() {
        // CountDownTimer is held inside the overlay view — dismissed by coordinator.forceRemove()
    }

    /** Called each tick when focus and timer overlays are not showing. */
    fun onTick(currentFgPkg: String, now: Long) {
        if (!isActive) return
        if (coordinator.isShowing(AppMonitorService.PRIORITY_INTENTION)) return

        if (currentFgPkg != previousFgPkg) {
            if (previousFgPkg.isNotEmpty()) allowedPkgs.remove(previousFgPkg)
            previousFgPkg = currentFgPkg
        }

        if (currentFgPkg.isEmpty() || currentFgPkg == h.packageName) return
        if (!intentionPkgs.contains(currentFgPkg)) return
        if (allowedPkgs.contains(currentFgPkg)) return

        if (prefs.getBoolean("focus_session_active", false)) {
            val focusPkgs = runCatching {
                JSONArray(prefs.getString("focus_blocked_apps", "[]") ?: "[]")
                    .run { (0 until length()).mapNotNull { optJSONObject(it)?.optString("packageName") }.toSet() }
            }.getOrDefault(emptySet())
            if (focusPkgs.contains(currentFgPkg)) return
        }

        val last = lastEventMap[currentFgPkg] ?: 0L
        if (now - last < 3000L) return

        lastEventMap[currentFgPkg] = now
        val appName = intentionNames[currentFgPkg] ?: currentFgPkg.split(".").last()
        recordPause(currentFgPkg)
        showPromptOverlay(currentFgPkg, appName)
    }

    /** Called when a higher-priority overlay is showing. */
    fun onTickNoOverlay(currentFgPkg: String, now: Long) {
        // no-op by design
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun showPromptOverlay(pkg: String, appName: String) {
        if (!h.canDrawOverlay()) { showFallbackNotification(appName); return }
        h.vibrate(longArrayOf(0, 25))
        val root = buildIntentionOverlayView(pkg, appName)
        val shown = coordinator.show(AppMonitorService.PRIORITY_INTENTION, root)
        if (!shown) showFallbackNotification(appName)
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  buildIntentionOverlayView  —  one-sec inspired full-screen mindful pause
    // ─────────────────────────────────────────────────────────────────────────
    private fun buildIntentionOverlayView(pkg: String, appName: String): View {
        val ctx = h.context
        val MP  = LinearLayout.LayoutParams.MATCH_PARENT
        val WC  = LinearLayout.LayoutParams.WRAP_CONTENT

        // ── Colour palette — deep ocean blue (one-sec style) ──────────────────
        val bgTop       = Color.parseColor("#1765C4")   // bright blue top
        val bgMid       = Color.parseColor("#1245A0")   // mid blue
        val bgDeep      = Color.parseColor("#0A2F7A")   // deeper blue
        val bgBottom    = Color.parseColor("#06194A")   // near-black navy
        val p2BgTop     = Color.parseColor("#111827")   // dark slate (phase 2)
        val p2BgBottom  = Color.parseColor("#060D18")   // near-black (phase 2)

        val white95     = Color.argb(242, 255, 255, 255)
        val white70     = Color.argb(179, 255, 255, 255)
        val white40     = Color.argb(102, 255, 255, 255)
        val white15     = Color.argb(38,  255, 255, 255)
        val white10     = Color.argb(26,  255, 255, 255)
        val white22     = Color.argb(56,  255, 255, 255)

        // Orb colours — bright sky-blue tones
        val orbRing1    = Color.argb(64,  140, 200, 255)  // outermost, faint
        val orbRing2    = Color.argb(115, 160, 215, 255)  // mid
        val orbRing3    = Color.argb(166, 180, 225, 255)  // inner, brighter
        val orbCoreFill = Color.parseColor("#5AABFF")
        val orbCoreDark = Color.parseColor("#1A72E8")

        // Chip / accent for phase 2
        val chipBg       = Color.argb(18, 255, 255, 255)
        val chipBorder   = Color.argb(33, 255, 255, 255)
        val chipSelBg    = Color.argb(51, 90, 171, 255)
        val chipSelBorder = Color.argb(191, 90, 171, 255)
        val chipSelText  = Color.parseColor("#A8D8FF")
        val accentBlue   = Color.parseColor("#64A5FF")

        // ── Root: full-screen frame ───────────────────────────────────────────
        val root = FrameLayout(ctx).apply {
            clipChildren = false; clipToPadding = false
        }

        // ── Phase 1 background: deep blue vertical gradient ───────────────────
        val p1Bg = View(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(bgTop, bgMid, bgDeep, bgBottom)
            )
            alpha = 0f
        }
        root.addView(p1Bg, FrameLayout.LayoutParams(MP, MP))

        // ── Phase 2 background: dark slate gradient ───────────────────────────
        val p2Bg = View(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(p2BgTop, p2BgBottom)
            )
            alpha = 0f; visibility = View.GONE
        }
        root.addView(p2Bg, FrameLayout.LayoutParams(MP, MP))

        // ─────────────────────────────────────────────────────────────────────
        //  PHASE 1 CONTENT
        // ─────────────────────────────────────────────────────────────────────
        val phase1 = FrameLayout(ctx).apply { clipChildren = false; clipToPadding = false }

        // ── Orb scene: centred in upper 55 % of screen ───────────────────────
        val orbSizeDp   = 260                    // large, prominent
        val orbSz       = h.dpToPx(orbSizeDp)
        val ring1Sz     = h.dpToPx(orbSizeDp)   // 100 %
        val ring2Sz     = h.dpToPx((orbSizeDp * 0.72).toInt())  // 72 %
        val ring3Sz     = h.dpToPx((orbSizeDp * 0.46).toInt())  // 46 %
        val coreSz      = h.dpToPx(54)

        val orbFrame = FrameLayout(ctx).apply { clipChildren = false; clipToPadding = false }

        // Glow halo behind everything (very faint radial-ish look via large oval)
        val orbGlow = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(28, 90, 171, 255))
            }
            scaleX = 0f; scaleY = 0f; alpha = 0f
        }
        orbFrame.addView(orbGlow, FrameLayout.LayoutParams(
            h.dpToPx(orbSizeDp + 60), h.dpToPx(orbSizeDp + 60)).apply { gravity = Gravity.CENTER })

        // Ring 1 — outermost
        val ring1 = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.TRANSPARENT)
                setStroke(h.dpToPx(2), orbRing1)
            }
            scaleX = 0f; scaleY = 0f; alpha = 0f
        }
        orbFrame.addView(ring1, FrameLayout.LayoutParams(ring1Sz, ring1Sz).apply { gravity = Gravity.CENTER })

        // Ring 2 — mid
        val ring2 = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.TRANSPARENT)
                setStroke(h.dpToPx(2), orbRing2)
            }
            scaleX = 0f; scaleY = 0f; alpha = 0f
        }
        orbFrame.addView(ring2, FrameLayout.LayoutParams(ring2Sz, ring2Sz).apply { gravity = Gravity.CENTER })

        // Ring 3 — inner, slight fill
        val ring3 = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(13, 100, 170, 255))
                setStroke(h.dpToPx(2), orbRing3)
            }
            scaleX = 0f; scaleY = 0f; alpha = 0f
        }
        orbFrame.addView(ring3, FrameLayout.LayoutParams(ring3Sz, ring3Sz).apply { gravity = Gravity.CENTER })

        // Core: solid glowing dot
        val orbCore = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColors(intArrayOf(orbCoreFill, orbCoreDark))
                orientation = GradientDrawable.Orientation.TOP_BOTTOM
            }
            scaleX = 0f; scaleY = 0f; alpha = 0f
        }
        orbFrame.addView(orbCore, FrameLayout.LayoutParams(coreSz, coreSz).apply { gravity = Gravity.CENTER })

        // Position orb frame — vertically centred in upper 52 % of screen
        phase1.addView(orbFrame, FrameLayout.LayoutParams(orbSz + h.dpToPx(60), orbSz + h.dpToPx(60)).apply {
            gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 168 else 148)
        })

        // ── Breathe label (centred, just below orb) ──────────────────────────
        val breatheLabel = TextView(ctx).apply {
            text = "breathe in"
            textSize = 12f; letterSpacing = 0.22f
            setTextColor(Color.argb(204, 200, 230, 255))
            gravity = Gravity.CENTER
            alpha = 0f
        }
        phase1.addView(breatheLabel, FrameLayout.LayoutParams(MP, WC).apply {
            gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 498 else 478)
        })

        // ── Bottom content column (pill + count + progress + headline + btns) ─
        val bottomCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(h.dpToPx(24), 0, h.dpToPx(24), 0)
            alpha = 0f; translationY = h.dpToPx(24).toFloat()
        }

        // App identity pill
        val appPill = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            setPadding(h.dpToPx(8), h.dpToPx(7), h.dpToPx(14), h.dpToPx(7))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(28).toFloat()
                setColor(white10); setStroke(1, white22)
            }
        }
        try {
            val icon = ctx.packageManager.getApplicationIcon(pkg)
            val iv   = android.widget.ImageView(ctx).apply {
                setImageDrawable(icon)
                scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            }
            appPill.addView(iv, LinearLayout.LayoutParams(h.dpToPx(26), h.dpToPx(26)))
        } catch (_: Exception) {}
        appPill.addView(TextView(ctx).apply {
            text = appName; textSize = 14f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(white95)
        }, LinearLayout.LayoutParams(WC, WC).apply { leftMargin = h.dpToPx(8) })

        val pillRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
        }
        pillRow.addView(appPill)
        bottomCol.addView(pillRow, LinearLayout.LayoutParams(MP, WC).apply {
            bottomMargin = h.dpToPx(10)
        })

        // Open-count badge — reads today's recorded pauses for this pkg
        val todayCount = run {
            val t = today()
            if (prefs.getString("focus_intention_pause_date_$pkg", "") == t)
                prefs.getInt("focus_intention_pause_count_$pkg", 0) else 0
        }
        bottomCol.addView(TextView(ctx).apply {
            text = "You've opened $appName $todayCount× today"
            textSize = 12f; setTextColor(Color.argb(166, 180, 220, 255))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(16) })

        // Progress bar container
        val progressTrack = FrameLayout(ctx).apply {
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(100).toFloat()
                setColor(white15)
            }
        }
        val progressFill = View(ctx).apply {
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(100).toFloat()
                setColor(Color.argb(166, 255, 255, 255))
            }
        }
        progressTrack.addView(progressFill, FrameLayout.LayoutParams(0, h.dpToPx(3)))
        bottomCol.addView(progressTrack, LinearLayout.LayoutParams(MP, h.dpToPx(3)).apply {
            bottomMargin = h.dpToPx(18)
        })

        // Headline + sub
        bottomCol.addView(TextView(ctx).apply {
            text = "Take a deep breath…"
            textSize = 22f; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(white95); gravity = Gravity.CENTER
            letterSpacing = -0.01f
        }, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(6) })

        bottomCol.addView(TextView(ctx).apply {
            text = "Just five seconds before you scroll"
            textSize = 13f; setTextColor(Color.argb(153, 180, 215, 255))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(24) })

        // Continue button — starts disabled, unlocks after BREATH_LOCK_MS
        val continueBtn = TextView(ctx).apply {
            text = "Continue →"
            textSize = 16f; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0D2E7A"))
            gravity = Gravity.CENTER
            setPadding(0, h.dpToPx(16), 0, h.dpToPx(16))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(16).toFloat()
                setColor(Color.argb(242, 255, 255, 255))
            }
            alpha = 0.38f; isClickable = false; isFocusable = false
        }
        bottomCol.addView(continueBtn, LinearLayout.LayoutParams(MP, WC).apply {
            bottomMargin = h.dpToPx(10)
        })

        // Ghost dismiss button
        val dismissBtn1 = TextView(ctx).apply {
            text = "Close app · go back"
            textSize = 15f; setTextColor(white70); gravity = Gravity.CENTER
            setPadding(0, h.dpToPx(14), 0, h.dpToPx(14))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(16).toFloat()
                setColor(Color.TRANSPARENT); setStroke(1, white22)
            }
            isClickable = true; isFocusable = true
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
                lastEventMap.remove(pkg)
                recordResist(pkg)
                runCatching {
                    h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
                }
            }
        }
        bottomCol.addView(dismissBtn1, LinearLayout.LayoutParams(MP, WC))

        phase1.addView(bottomCol, FrameLayout.LayoutParams(MP, WC).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            bottomMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 52 else 32)
        })

        // ─────────────────────────────────────────────────────────────────────
        //  PHASE 2 CONTENT
        // ─────────────────────────────────────────────────────────────────────
        val phase2 = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            setPadding(h.dpToPx(20), 0, h.dpToPx(20), h.dpToPx(52))
            visibility = View.GONE; alpha = 0f
            translationY = h.dpToPx(28).toFloat()
        }

        // Eyebrow label
        phase2.addView(TextView(ctx).apply {
            text = "SET YOUR INTENTION"
            textSize = 10f; letterSpacing = 0.18f
            setTextColor(Color.argb(179, 100, 165, 255))
            gravity = Gravity.START
        }, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(8) })

        // Question
        phase2.addView(TextView(ctx).apply {
            text = "Why are you opening $appName?"
            textSize = 22f; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(white95); setLineSpacing(0f, 1.2f)
            letterSpacing = -0.02f
        }, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(6) })

        // Sub-hint
        phase2.addView(TextView(ctx).apply {
            text = "No judgement — just awareness"
            textSize = 13f; setTextColor(Color.argb(140, 155, 195, 255))
        }, LinearLayout.LayoutParams(MP, WC).apply { bottomMargin = h.dpToPx(22) })

        // Intention chips
        val intentions = listOf("🎨  Inspiration", "💬  Message someone",
            "😴  Just bored", "📰  Stay updated",
            "😤  Stressed", "🎉  Share something", "🤷  No real reason")

        var selectedChip: TextView? = null

        // Open app button — declared HERE so chips can reference it
        val openAppBtn = TextView(ctx).apply {
            text = "Open $appName"
            textSize = 16f; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#0D2E7A"))
            gravity = Gravity.CENTER
            setPadding(0, h.dpToPx(16), 0, h.dpToPx(16))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(16).toFloat()
                setColor(Color.argb(242, 255, 255, 255))
            }
            alpha = 0.38f; isClickable = false; isFocusable = false
            setOnClickListener {
                allowedPkgs.add(pkg)
                coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
            }
        }

        // Chips in a wrapping flow — we simulate it with two rows
        val chipRows = listOf(
            intentions.subList(0, 3),
            intentions.subList(3, 5),
            intentions.subList(5, intentions.size)
        )
        for (row in chipRows) {
            val chipRow = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.START
            }
            for (label in row) {
                val chip = TextView(ctx).apply {
                    text = label; textSize = 11.5f
                    setTextColor(Color.argb(191, 200, 220, 255))
                    setPadding(h.dpToPx(12), h.dpToPx(8), h.dpToPx(12), h.dpToPx(8))
                    background = GradientDrawable().apply {
                        cornerRadius = h.dpToPx(100).toFloat()
                        setColor(chipBg); setStroke(h.dpToPx(1), chipBorder)
                    }
                    isClickable = true; isFocusable = true
                    setOnClickListener {
                        // Deselect previous
                        selectedChip?.let { prev ->
                            (prev.background as? GradientDrawable)?.apply {
                                setColor(chipBg); setStroke(h.dpToPx(1), chipBorder)
                            }
                            prev.setTextColor(Color.argb(191, 200, 220, 255))
                        }
                        // Select this chip
                        selectedChip = this
                        (background as? GradientDrawable)?.apply {
                            setColor(chipSelBg); setStroke(h.dpToPx(2), chipSelBorder)
                        }
                        setTextColor(chipSelText)

                        // Unlock open button
                        continueBtn  // reuse label here would be openAppBtn — see below
                        openAppBtn.alpha = 1f
                        openAppBtn.isClickable = true; openAppBtn.isFocusable = true
                    }
                }
                chipRow.addView(chip, LinearLayout.LayoutParams(WC, WC).apply {
                    rightMargin = h.dpToPx(8)
                })
            }
            phase2.addView(chipRow, LinearLayout.LayoutParams(MP, WC).apply {
                bottomMargin = h.dpToPx(8)
            })
        }

        // Weekly insight line (reads resist + pause counts)
        val weekBored = prefs.getInt("focus_intention_pause_count_$pkg", 0)
        phase2.addView(TextView(ctx).apply {
            text = "This week you opened $appName $weekBored× — be mindful"
            textSize = 11f; setTextColor(Color.argb(128, 120, 160, 200))
        }, LinearLayout.LayoutParams(MP, WC).apply {
            topMargin = h.dpToPx(4); bottomMargin = h.dpToPx(22)
        })

        phase2.addView(openAppBtn, LinearLayout.LayoutParams(MP, WC).apply {
            bottomMargin = h.dpToPx(10)
        })

        // Ghost back button
        phase2.addView(TextView(ctx).apply {
            text = "Not now · go back"
            textSize = 15f; setTextColor(white70); gravity = Gravity.CENTER
            setPadding(0, h.dpToPx(14), 0, h.dpToPx(14))
            background = GradientDrawable().apply {
                cornerRadius = h.dpToPx(16).toFloat()
                setColor(Color.TRANSPARENT); setStroke(1, white22)
            }
            isClickable = true; isFocusable = true
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_INTENTION)
                lastEventMap.remove(pkg)
                recordResist(pkg)
                runCatching {
                    h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
                }
            }
        }, LinearLayout.LayoutParams(MP, WC))

        // ── Add phase containers to root ──────────────────────────────────────
        root.addView(phase1, FrameLayout.LayoutParams(MP, MP))
        root.addView(phase2, FrameLayout.LayoutParams(MP, MP).apply { gravity = Gravity.BOTTOM })

        // Wordmark header (on top of everything)
        val headerCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        }
        headerCol.addView(h.buildAureloWordmarkView(),
            LinearLayout.LayoutParams(WC, WC).apply { gravity = Gravity.CENTER_HORIZONTAL })
        headerCol.addView(TextView(ctx).apply {
            text = "MINDFUL PAUSE"; textSize = 9.5f; letterSpacing = 0.28f
            setTextColor(Color.argb(100, 255, 255, 255)); gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(MP, WC).apply { topMargin = h.dpToPx(4) })
        root.addView(headerCol, FrameLayout.LayoutParams(MP, WC).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 54 else 38)
        })

        // ─────────────────────────────────────────────────────────────────────
        //  ANIMATION SEQUENCE
        // ─────────────────────────────────────────────────────────────────────
        val phaseHandler = Handler(Looper.getMainLooper())

        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {

            override fun onViewAttachedToWindow(v: View) {

                // 1. Fade in the blue gradient background
                ObjectAnimator.ofFloat(p1Bg, "alpha", 0f, 1f).apply {
                    duration = 600L; interpolator = DecelerateInterpolator(); start()
                }

                // 2. Orb elements bloom in with spring (staggered 80 ms apart)
                fun bloomIn(target: View, delay: Long) {
                    phaseHandler.postDelayed({
                        target.alpha = 1f
                        val sx = ObjectAnimator.ofFloat(target, "scaleX", 0f, 1f).apply {
                            duration = 700L; interpolator = OvershootInterpolator(1.2f)
                        }
                        val sy = ObjectAnimator.ofFloat(target, "scaleY", 0f, 1f).apply {
                            duration = 700L; interpolator = OvershootInterpolator(1.2f)
                        }
                        AnimatorSet().also { it.playTogether(sx, sy); it.start() }
                    }, delay)
                }
                bloomIn(orbGlow, 100L)
                bloomIn(ring1,   180L)
                bloomIn(ring2,   260L)
                bloomIn(ring3,   340L)
                bloomIn(orbCore, 420L)

                // 3. Breathe label fades in
                phaseHandler.postDelayed({
                    breatheLabel.animate().alpha(1f).setDuration(400L).start()
                }, 500L)

                // 4. Bottom content slides up
                phaseHandler.postDelayed({
                    bottomCol.animate()
                        .alpha(1f).translationY(0f)
                        .setDuration(500L)
                        .setInterpolator(DecelerateInterpolator())
                        .start()
                }, 400L)

                // 5. Continuous breathing — 4-second cycle, BREATH_CYCLE_MS
                //    Ring 1 outermost, smallest range
                //    Ring 3 innermost, widest range (more dramatic)
                fun breatheLoop(
                    target: View,
                    scaleMin: Float, scaleMax: Float,
                    cycleDuration: Long,
                    startDelay: Long
                ) {
                    phaseHandler.postDelayed(object : Runnable {
                        var expanding = true
                        override fun run() {
                            val to = if (expanding) scaleMax else scaleMin
                            expanding = !expanding
                            target.animate()
                                .scaleX(to).scaleY(to)
                                .setDuration(cycleDuration / 2)
                                .setInterpolator(
                                    if (!expanding) DecelerateInterpolator()
                                    else AccelerateDecelerateInterpolator()
                                )
                                .withEndAction { phaseHandler.post(this) }
                                .start()
                        }
                    }, startDelay)
                }

                val breathStart = 800L
                breatheLoop(ring1,   0.88f, 1.15f, BREATH_CYCLE_MS, breathStart)
                breatheLoop(ring2,   0.80f, 1.22f, BREATH_CYCLE_MS, breathStart + 60L)
                breatheLoop(ring3,   0.72f, 1.30f, BREATH_CYCLE_MS, breathStart + 120L)
                breatheLoop(orbCore, 0.75f, 1.38f, BREATH_CYCLE_MS, breathStart + 40L)
                breatheLoop(orbGlow, 0.85f, 1.18f, BREATH_CYCLE_MS, breathStart)

                // 6. Breathe label swaps every half-cycle
                var breathIn = true
                phaseHandler.postDelayed(object : Runnable {
                    override fun run() {
                        breathIn = !breathIn
                        breatheLabel.animate().alpha(0f).setDuration(250L).withEndAction {
                            breatheLabel.text = if (breathIn) "breathe in" else "breathe out"
                            breatheLabel.animate().alpha(1f).setDuration(250L).start()
                        }.start()
                        phaseHandler.postDelayed(this, BREATH_CYCLE_MS / 2)
                    }
                }, BREATH_CYCLE_MS / 2 + breathStart)

                // 7. Progress bar fills over BREATH_LOCK_MS
                phaseHandler.postDelayed({
                    val trackWidth = progressTrack.width.takeIf { it > 0 }
                        ?: h.dpToPx(300) // fallback estimate
                    ValueAnimator.ofInt(0, trackWidth).apply {
                        duration = BREATH_LOCK_MS
                        interpolator = android.view.animation.LinearInterpolator()
                        addUpdateListener { anim ->
                            progressFill.layoutParams =
                                (progressFill.layoutParams as FrameLayout.LayoutParams).also {
                                    it.width = anim.animatedValue as Int
                                }
                            progressFill.requestLayout()
                        }
                        start()
                    }
                }, 100L)

                // 8. Unlock Continue after BREATH_LOCK_MS
                phaseHandler.postDelayed({
                    continueBtn.animate().alpha(1f).setDuration(350L).start()
                    continueBtn.isClickable = true; continueBtn.isFocusable = true
                    continueBtn.setOnClickListener {
                        // Transition to phase 2
                        phase1.animate().alpha(0f).translationY((-h.dpToPx(20)).toFloat())
                            .setDuration(350L).withEndAction {
                                phase1.visibility = View.GONE
                                p1Bg.visibility = View.GONE
                                p2Bg.visibility = View.VISIBLE
                                p2Bg.animate().alpha(1f).setDuration(400L).start()
                                phase2.visibility = View.VISIBLE
                                phase2.animate()
                                    .alpha(1f).translationY(0f)
                                    .setDuration(450L)
                                    .setInterpolator(DecelerateInterpolator())
                                    .start()
                            }.start()
                    }
                }, BREATH_LOCK_MS)
            }

            override fun onViewDetachedFromWindow(v: View) {
                phaseHandler.removeCallbacksAndMessages(null)
            }
        })

        return root
    }

    // ── Fallback & recording helpers ──────────────────────────────────────────

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
            .putString("focus_intention_pause_date", t)
            .putInt( "focus_intention_pause_count", aggCount + 1)
            .putString("focus_intention_pause_date_$pkg", t)
            .putInt( "focus_intention_pause_count_$pkg", appCount + 1)
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
            .putString("focus_intention_resist_date", t)
            .putInt( "focus_intention_resist_count", aggCount + 1)
            .putString("focus_intention_resist_date_$pkg", t)
            .putInt( "focus_intention_resist_count_$pkg", appCount + 1)
            .apply()
        h.notifyJs("if(typeof window.onIntentionResist==='function') window.onIntentionResist('${pkg.replace("'", "\\'")}')")
    }

    private fun today(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
}
