package com.javikastudio.tidyapp

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import java.security.MessageDigest

/**
 * AppLockActivity — full-screen lock screen shown when a locked app is
 * detected in the foreground by AppMonitorService's UsageEvents poller.
 *
 * Authentication flow:
 *   1. If biometric available + enabled → show BiometricPrompt immediately
 *   2. On biometric failure/cancel → fall back to PIN entry
 *   3. Correct PIN → finish() → locked app becomes visible
 *   4. Wrong PIN → show error + shake animation, allow retry
 *
 * UI: Consistent with FocusBlockingEngine / IntentionEngine overlays:
 *   - Dark gradient backdrop (#10182A → #060912)
 *   - Aurelo wordmark + "APP LOCK" label at top
 *   - App icon + name chip in centre
 *   - 4-dot PIN indicator (filled/empty circles)
 *   - Custom 3×4 numpad — no system keyboard
 *   - Biometric / fingerprint shortcut row at bottom
 */
class AppLockActivity : AppCompatActivity() {

    companion object {
        @Volatile var currentLockedPackage: String = ""
        val sessionUnlockedApps: MutableMap<String, Long> =
            java.util.Collections.synchronizedMap(mutableMapOf())
    }

    private var lockedPackage    = ""
    private var biometricEnabled = true
    private lateinit var securePrefs: android.content.SharedPreferences

    // Tracks whether the user successfully unlocked this instance. Used by
    // onStop() to distinguish a legitimate unlock-then-finish (no state
    // cleanup needed; unlockSuccess already cleared it) from a dismissal
    // without auth (back gesture, Recents swipe, task kill) — in which
    // case we must clear currentLockedPackage so AppMonitorService re-fires
    // the lock on the next foreground of the locked app.
    private var unlocked = false

    // PIN state
    private val MAX_PIN_LEN = 6          // supports 4–6 digit PINs
    private val pinBuffer   = StringBuilder()

    // UI refs updated after digit input
    private lateinit var dotContainer: LinearLayout
    private lateinit var errorLabel:   TextView
    private var pinLength: Int = 4          // actual stored PIN length

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        // UI-05 FIX: this Activity previously had no edge-to-edge setup, unlike
        // MainActivity — inconsistent handling across Activities triggers Play
        // Console's "edge-to-edge may not display for all users" warning.
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        window.decorView.post {
            val ctrl = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
            ctrl.hide(androidx.core.view.WindowInsetsCompat.Type.statusBars())
            ctrl.systemBarsBehavior =
                androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        lockedPackage    = intent.getStringExtra("locked_package") ?: ""
        biometricEnabled = intent.getBooleanExtra("biometric_enabled", true)
        securePrefs      = SensitivePrefs.get(this)
        currentLockedPackage = lockedPackage

        // Determine stored PIN length so we know how many dots to show
        val storedHash = securePrefs.getString(APP_LOCK_PIN_HASH, null)
        pinLength = if (storedHash != null) 4 else 4   // default 4; could be read from prefs

        buildUI()

        onBackPressedDispatcher.addCallback(
            this, object : androidx.activity.OnBackPressedCallback(true) {
                override fun handleOnBackPressed() { goHome() }
            })

        if (biometricEnabled && isBiometricAvailable()) showBiometricPrompt()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        val newPkg = intent?.getStringExtra("locked_package") ?: return
        if (newPkg != lockedPackage) {
            lockedPackage = newPkg
            currentLockedPackage = newPkg
            resetPin()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (currentLockedPackage == lockedPackage) currentLockedPackage = ""
    }

    /**
     * Back-bypass fix: when the lock UI is dismissed without a successful
     * unlock (back gesture → goHome, Recents swipe, task kill), we must
     * clear the static [currentLockedPackage] guard. Otherwise the next
     * AppMonitorService poll tick will see `alreadyLocking == true` for
     * the same package and skip launching a fresh lock screen — letting
     * the user straight into the locked app on re-launch.
     *
     * isChangingConfigurations excludes rotation/locale changes, where
     * onStop fires but onCreate immediately follows on a new instance
     * (which would re-set currentLockedPackage anyway).
     */
    override fun onStop() {
        super.onStop()
        if (!unlocked && !isChangingConfigurations &&
            currentLockedPackage == lockedPackage) {
            currentLockedPackage = ""
        }
    }

    // ── UI construction ───────────────────────────────────────────────────────

    private fun buildUI() {
        val dp: (Int) -> Int = { v -> (v * resources.displayMetrics.density + 0.5f).toInt() }

        // ── Root: full-screen frame with gradient ─────────────────────────────
        val root = FrameLayout(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF0D1525.toInt(), 0xFF060912.toInt())
            )
            clipChildren = false
            clipToPadding = false
        }

        // ── Top: wordmark + "APP LOCK" label — pinned to top ─────────────────
        val topBlock = buildTopBlock(dp)
        root.addView(topBlock, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = dp(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 56 else 40)
        })

        // ── Centre content: app chip + PIN + numpad + bio — vertically centred ─
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false
            clipToPadding = false
        }

        // App icon + name chip
        content.addView(buildAppChip(dp), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(36)
        })

        // Unlock hint label
        content.addView(TextView(this).apply {
            text = "Enter PIN to unlock"
            textSize = 13f
            setTextColor(Color.parseColor("#4A5570"))
            gravity = Gravity.CENTER
            letterSpacing = 0.04f
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(20)
        })

        // PIN dot row
        dotContainer = buildDotRow(dp)
        content.addView(dotContainer, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(4)
        })

        // Error label — reserves height so layout doesn't shift on show
        errorLabel = TextView(this).apply {
            text = ""
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#E86B5F"))
            visibility = View.INVISIBLE
            minHeight = dp(22)
        }
        content.addView(errorLabel, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(20)
        })

        // Numpad
        content.addView(buildNumpad(dp), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })

        // Biometric button
        if (biometricEnabled && isBiometricAvailable()) {
            content.addView(buildBiometricButton(dp), LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = dp(20)
            })
        }

        root.addView(content, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER
        })

        setContentView(root)

        // Entrance animation: slide up + fade in
        root.alpha = 0f
        root.translationY = dp(24).toFloat()
        root.animate().alpha(1f).translationY(0f)
            .setDuration(300).setInterpolator(DecelerateInterpolator()).start()
    }

    // ── Top block: wordmark + subtitle ───────────────────────────────────────

    private fun buildTopBlock(dp: (Int) -> Int): View {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false
            clipToPadding = false
        }
        // Explicit WRAP_CONTENT params so wordmark is never constrained / clipped
        col.addView(buildWordmark(dp), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER_HORIZONTAL })
        // "APP LOCK" pill badge
        col.addView(TextView(this).apply {
            text = "APP LOCK"
            textSize = 10f
            letterSpacing = 0.22f
            setTextColor(Color.parseColor("#8EA2FF"))
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(4), dp(10), dp(5))
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(0x148EA2FF.toInt())
            }
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(8); gravity = Gravity.CENTER_HORIZONTAL })
        return col
    }

    // ── App chip: frosted card with icon emoji + app name + lock badge ────────

    private fun buildAppChip(dp: (Int) -> Int): View {
        val appName = getAppName(lockedPackage)

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(20), dp(28), dp(20))
            background = GradientDrawable().apply {
                setColor(0x12FFFFFF)
                cornerRadius = dp(20).toFloat()
                setStroke(dp(1), 0x20FFFFFF)
            }
        }

        // App icon (best-effort via PackageManager; fallback to lock emoji)
        val iconView = TextView(this).apply {
            val icon = runCatching {
                val pm = packageManager
                val drawable = pm.getApplicationIcon(lockedPackage)
                drawable
            }.getOrNull()
            if (icon != null) {
                // Show actual icon centered
                val size = dp(52)
                icon.setBounds(0, 0, size, size)
                setCompoundDrawables(null, icon, null, null)
                text = ""
                gravity = Gravity.CENTER
            } else {
                text = "🔒"
                textSize = 32f
                gravity = Gravity.CENTER
            }
        }
        card.addView(iconView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(10) })

        // App name
        card.addView(TextView(this).apply {
            text = appName
            textSize = 16f
            setTextColor(Color.parseColor("#E8EAF0"))
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 1
            gravity = Gravity.CENTER
            ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(4) })

        // Lock status label
        card.addView(TextView(this).apply {
            text = "This app is locked"
            textSize = 11f
            setTextColor(Color.parseColor("#4A5570"))
            gravity = Gravity.CENTER
            letterSpacing = 0.02f
        }, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER_HORIZONTAL })

        return card
    }

    // ── PIN dot row ───────────────────────────────────────────────────────────

    private fun buildDotRow(dp: (Int) -> Int): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            clipChildren = false
            clipToPadding = false
            // Extra padding so stroke is never clipped at edges
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        repeat(4) {   // show 4 dots (standard PIN length)
            val dot = View(this).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(0x22FFFFFF)
                    setStroke(dp(2), 0x44FFFFFF)
                }
            }
            row.addView(dot, LinearLayout.LayoutParams(dp(14), dp(14)).apply {
                marginStart = dp(10); marginEnd = dp(10)
            })
        }
        return row
    }

    private fun refreshDots() {
        val filled = pinBuffer.length
        val total  = dotContainer.childCount
        for (i in 0 until total) {
            val dot = dotContainer.getChildAt(i) as View
            (dot.background as GradientDrawable).apply {
                if (i < filled) {
                    setColor(0xFF8EA2FF.toInt())
                    setStroke(0, Color.TRANSPARENT)
                } else {
                    setColor(0x33FFFFFF)
                    setStroke((resources.displayMetrics.density + 0.5f).toInt(), 0x55FFFFFF)
                }
            }
        }
    }

    // ── Numpad 3×4 grid ───────────────────────────────────────────────────────

    private fun buildNumpad(dp: (Int) -> Int): LinearLayout {
        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            clipChildren = false
            clipToPadding = false
        }
        val rows = listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("", "0", "⌫")
        )
        for (row in rows) {
            val rowView = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                clipChildren = false
                clipToPadding = false
            }
            for (label in row) {
                val btn = buildNumKey(label, dp)
                // topMargin prevents the oval stroke at y=0 being clipped by parent
                rowView.addView(btn, LinearLayout.LayoutParams(dp(74), dp(74)).apply {
                    marginStart = dp(10); marginEnd = dp(10)
                    topMargin = dp(4); bottomMargin = dp(4)
                })
            }
            grid.addView(rowView)
        }
        return grid
    }

    private fun buildNumKey(label: String, dp: (Int) -> Int): View {
        if (label.isEmpty()) return View(this)   // spacer

        val normalBg = { GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0x14FFFFFF)
            setStroke(dp(1), 0x28FFFFFF)
        }}
        val pressedBg = { GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0x30FFFFFF)
            setStroke(dp(1), 0x50FFFFFF)
        }}

        return TextView(this).apply {
            text = label
            textSize = if (label == "⌫") 20f else 22f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            background = normalBg()
            isClickable = true
            isFocusable = true

            setOnClickListener {
                // Press ripple — lighten momentarily
                background = pressedBg()
                Handler(Looper.getMainLooper()).postDelayed({
                    background = normalBg()
                }, 120)

                when (label) {
                    "⌫" -> {
                        if (pinBuffer.isNotEmpty()) {
                            pinBuffer.deleteCharAt(pinBuffer.length - 1)
                            refreshDots()
                            clearError()
                        }
                    }
                    else -> {
                        if (pinBuffer.length < MAX_PIN_LEN) {
                            pinBuffer.append(label)
                            refreshDots()
                            clearError()
                            if (pinBuffer.length >= 4) {
                                // Auto-submit on 4 digits (standard PIN length)
                                Handler(Looper.getMainLooper()).postDelayed({ attemptUnlock() }, 120)
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Biometric button ──────────────────────────────────────────────────────

    private fun buildBiometricButton(dp: (Int) -> Int): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(12), dp(16), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(20).toFloat()
                setColor(0x0FFFFFFF)
                setStroke(dp(1), 0x18FFFFFF)
            }
            isClickable = true; isFocusable = true
            setOnClickListener { showBiometricPrompt() }
        }
        row.addView(TextView(this).apply {
            text = "👆"; textSize = 18f
        })
        row.addView(TextView(this).apply {
            text = " Use fingerprint / face"
            textSize = 13f
            setTextColor(Color.parseColor("#7C8490"))
        })
        return row
    }

    // ── Wordmark (matches FocusBlockingEngine / buildWordmark style) ──────────

    private fun buildWordmark(dp: (Int) -> Int): View {
        val logoSz   = dp(28)    // slightly larger for better presence
        val logoView = object : View(this) {
            private val archPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND
            }
            private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL
            }
            override fun onDraw(canvas: Canvas) {
                val sx = width / 108f; val sy = height / 108f
                canvas.save(); canvas.scale(sx, sy)
                val path = Path().apply {
                    moveTo(22f, 88f)
                    cubicTo(22f, 88f, 30f, 30f, 54f, 20f)
                    cubicTo(78f, 30f, 86f, 88f, 86f, 88f)
                }
                val archGrad = LinearGradient(
                    28f, 20f, 80f, 90f,
                    intArrayOf(Color.rgb(255, 224, 130), Color.rgb(255, 170, 68), Color.rgb(255, 112, 32)),
                    floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP
                )
                archPaint.shader = archGrad; archPaint.strokeWidth = 7.5f; archPaint.alpha = 255
                canvas.drawPath(path, archPaint)
                archPaint.strokeWidth = 1.5f; archPaint.alpha = 128
                canvas.drawPath(path, archPaint)
                dotPaint.shader = LinearGradient(
                    48f, 22f, 60f, 34f,
                    intArrayOf(Color.rgb(255, 243, 192), Color.rgb(255, 208, 96)),
                    null, Shader.TileMode.CLAMP
                )
                canvas.drawCircle(54f, 20f, 5.5f, dotPaint)
                canvas.restore()
            }
        }
        // clipChildren=false + setSingleLine(true) on the TextView prevents the
        // "URELO" text being measured-then-clipped by an ancestor constraint.
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            clipChildren = false
            clipToPadding = false
            addView(logoView, LinearLayout.LayoutParams(logoSz, logoSz).also {
                it.rightMargin = dp(2)
            })
            addView(TextView(this@AppLockActivity).apply {
                text = "URELO"       // 'A' is the arch logo; text starts at U
                textSize = 22f
                typeface = Typeface.create("serif", Typeface.NORMAL)
                letterSpacing = 0.09f
                setTextColor(Color.rgb(255, 224, 130))
                setSingleLine(true)  // prevent wrap; ensures full width is measured
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))
        }
    }

    // ── PIN verification ──────────────────────────────────────────────────────

    private fun attemptUnlock() {
        val entered = pinBuffer.toString()
        if (entered.isEmpty()) return
        val stored  = securePrefs.getString(APP_LOCK_PIN_HASH, null)
        if (stored != null && sha256(entered) == stored) {
            unlockSuccess()
        } else {
            showError("Incorrect PIN")
            shakeDots()
            Handler(Looper.getMainLooper()).postDelayed({ resetPin() }, 400)
        }
    }

    // ── Biometric prompt ──────────────────────────────────────────────────────

    private fun showBiometricPrompt() {
        BiometricPrompt(this, ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) {
                    unlockSuccess()
                }
                override fun onAuthenticationFailed() {
                    showError("Biometric failed — enter PIN")
                }
                override fun onAuthenticationError(code: Int, msg: CharSequence) {
                    showError("Use PIN to unlock")
                }
            }
        ).authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock ${getAppName(lockedPackage)}")
                .setSubtitle("Confirm your identity to continue")
                .setNegativeButtonText("Use PIN")
                .build()
        )
    }

    // ── Unlock / helpers ──────────────────────────────────────────────────────

    private fun unlockSuccess() {
        unlocked = true
        sessionUnlockedApps[lockedPackage] = System.currentTimeMillis()
        currentLockedPackage = ""
        SoundEffects.play(applicationContext, SoundEffects.Tone.UNLOCK)
        finish()
    }

    private fun resetPin() {
        pinBuffer.clear()
        refreshDots()
    }

    private fun showError(msg: String) {
        errorLabel.text = msg
        errorLabel.visibility = View.VISIBLE
        Handler(Looper.getMainLooper()).postDelayed({
            errorLabel.visibility = View.INVISIBLE
        }, 2500)
    }

    private fun clearError() {
        if (errorLabel.visibility == View.VISIBLE) errorLabel.visibility = View.INVISIBLE
    }

    /** Quick horizontal shake on wrong PIN — consistent with lock apps */
    private fun shakeDots() {
        val shake = ObjectAnimator.ofFloat(dotContainer, "translationX",
            0f, -12f, 12f, -8f, 8f, -4f, 4f, 0f)
        shake.duration = 350
        shake.start()
    }

    private fun goHome() {
        // Back-bypass fix: clear the static lock guard BEFORE starting home
        // so AppMonitorService can re-fire the lock on the next foreground
        // of the same package. Without this clear, the alreadyLocking guard
        // in AppMonitorService.pollRunnable suppresses the new lock screen
        // and the user gets straight into the protected app.
        if (currentLockedPackage == lockedPackage) currentLockedPackage = ""
        startActivity(Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        })
        // finishAndRemoveTask() tears down this activity's task entirely —
        // matches the existing android:excludeFromRecents="true" intent
        // (the lock task shouldn't linger as a phantom in Recents) and
        // prevents the dormant activity from being mistaken for a live
        // lock screen by the poll-loop guard above.
        finishAndRemoveTask()
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun isBiometricAvailable(): Boolean =
        BiometricManager.from(this)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) ==
                BiometricManager.BIOMETRIC_SUCCESS

    private fun getAppName(pkg: String): String = runCatching {
        packageManager.getApplicationLabel(
            packageManager.getApplicationInfo(pkg, 0)
        ).toString()
    }.getOrDefault(pkg)
}