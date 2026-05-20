package com.javikastudio.tidyapp

import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
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
 *   4. Wrong PIN → show error, allow retry
 *
 * Key design decisions:
 *   - Full-screen AppCompatActivity (not SYSTEM_ALERT_WINDOW) → harder to bypass
 *   - FLAG_SECURE prevents screenshots of the lock screen
 *   - showWhenLocked + turnScreenOn in Manifest handles lock screen scenario
 *   - Tracks currentLockedPackage so AppMonitorService doesn't re-launch in a loop
 *
 * Fix 3: unlockSuccess() now brings the locked app's task to the front via
 *   FLAG_ACTIVITY_REORDER_TO_FRONT before finishing, so Aurelo no longer
 *   surfaces instead of the unlocked app when Aurelo was in the background.
 */
class AppLockActivity : AppCompatActivity() {

    companion object {
        /** Package currently being locked. Set on start, cleared on destroy. */
        @Volatile var currentLockedPackage: String = ""

        /**
         * Packages unlocked this session mapped to their unlock timestamp.
         * Cleared when the package moves to background AFTER the unlock so it
         * re-locks on the next open. Background events that pre-date the unlock
         * timestamp (i.e. the bg event from AppLockActivity covering the locked
         * app) are ignored so they don't immediately re-trigger the lock screen.
         */
        val sessionUnlockedApps: MutableMap<String, Long> = java.util.Collections.synchronizedMap(mutableMapOf())
    }

    private var lockedPackage: String = ""
    private var biometricEnabled: Boolean = true
    private lateinit var securePrefs: android.content.SharedPreferences

    private lateinit var pinInput: EditText
    private lateinit var errorText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        lockedPackage    = intent.getStringExtra("locked_package") ?: ""
        biometricEnabled = intent.getBooleanExtra("biometric_enabled", true)
        securePrefs      = SensitivePrefs.get(this)

        currentLockedPackage = lockedPackage
        buildUI()

        // Android 13+ predictive back gesture support
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                startActivity(Intent(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_HOME)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                })
            }
        })

        if (biometricEnabled && isBiometricAvailable()) {
            showBiometricPrompt()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Handle re-launch for a different locked package without full recreation
        val newPkg = intent?.getStringExtra("locked_package") ?: return
        if (newPkg != lockedPackage) {
            lockedPackage = newPkg
            currentLockedPackage = newPkg
            pinInput.text.clear()
            errorText.visibility = View.INVISIBLE
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (currentLockedPackage == lockedPackage) {
            currentLockedPackage = ""
        }
    }

    // Back button sends user to home — not to the locked app
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(homeIntent)
    }

    // ── Build UI programmatically (no layout XML needed) ──────────────────────
    private fun buildUI() {
        val dp = { v: Int -> (v * resources.displayMetrics.density + 0.5f).toInt() }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0D0F14"))
            setPadding(dp(32), dp(48), dp(32), dp(48))
        }

        // ── Aurelo wordmark (top, matching other overlay layouts) ─────────────
        val wordmarkRow = buildWordmark(dp)
        root.addView(wordmarkRow,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.gravity = Gravity.CENTER_HORIZONTAL
                it.bottomMargin = dp(36)
            })

        // Lock icon
        root.addView(TextView(this).apply {
            text = "🔒"; textSize = 48f; gravity = Gravity.CENTER
        }, lp(dp, bottomMargin = 8))

        // App name
        root.addView(TextView(this).apply {
            text = getAppName(lockedPackage)
            textSize = 20f; gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#E8EAF0"))
            typeface = Typeface.DEFAULT_BOLD
        }, lp(dp, bottomMargin = 4))

        // Subtitle
        root.addView(TextView(this).apply {
            text = "This app is locked"
            textSize = 13f; gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#7C8490"))
        }, lp(dp, bottomMargin = 40))

        // PIN input
        pinInput = EditText(this).apply {
            hint = "Enter PIN"
            setHintTextColor(Color.parseColor("#4A5068"))
            setTextColor(Color.WHITE)
            textSize = 24f; gravity = Gravity.CENTER; letterSpacing = 0.3f
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            maxLines = 1
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1A1F2E"))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.parseColor("#2E3447"))
            }
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setOnEditorActionListener { _, _, _ -> attemptPinUnlock(); true }
        }
        root.addView(pinInput, lp(dp, bottomMargin = 12))

        // Error label
        errorText = TextView(this).apply {
            text = ""; textSize = 12f; gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#E86B5F"))
            visibility = View.INVISIBLE
        }
        root.addView(errorText, lp(dp, bottomMargin = 16))

        // Unlock button
        root.addView(Button(this).apply {
            text = "Unlock"; textSize = 15f; setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#6C63FF")); cornerRadius = dp(10).toFloat()
            }
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setOnClickListener { attemptPinUnlock() }
        }, lp(dp, bottomMargin = 16))

        // Biometric button (only shown if available)
        if (biometricEnabled && isBiometricAvailable()) {
            root.addView(Button(this).apply {
                text = "Use fingerprint / face"; textSize = 13f
                setTextColor(Color.parseColor("#7C8490"))
                background = null
                setOnClickListener { showBiometricPrompt() }
            }, lp(dp))
        }

        setContentView(root)
    }

    /**
     * Builds the "Aurelo" wordmark row (arch logo + "URELO" text) consistent
     * with buildAureloWordmarkView() in AppMonitorService and other overlays.
     */
    private fun buildWordmark(dp: (Int) -> Int): View {
        val logoSz = dp(24)
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

        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM or Gravity.CENTER_VERTICAL
            addView(logoView, LinearLayout.LayoutParams(logoSz, logoSz).also {
                it.rightMargin = dp(1); it.bottomMargin = dp(1)
            })
            addView(TextView(this@AppLockActivity).apply {
                text = "URELO"; textSize = 21f
                typeface = Typeface.create("serif", Typeface.NORMAL)
                letterSpacing = 0.09f
                setTextColor(Color.rgb(255, 224, 130))
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ))
        }
    }

    // ── PIN verification ──────────────────────────────────────────────────────
    private fun attemptPinUnlock() {
        val entered = pinInput.text.toString()
        if (entered.isEmpty()) return
        val stored = securePrefs.getString(APP_LOCK_PIN_HASH, null)
        if (stored != null && sha256(entered) == stored) {
            unlockSuccess()
        } else {
            showError("Incorrect PIN")
            pinInput.text.clear()
        }
    }

    // ── Biometric prompt ──────────────────────────────────────────────────────
    private fun showBiometricPrompt() {
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this),
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
            })

        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock App")
                .setSubtitle(getAppName(lockedPackage))
                .setNegativeButtonText("Use PIN")
                .build()
        )
    }

    // ── Unlock success ────────────────────────────────────────────────────────
    /**
     * FIX (Issue 3): After a successful unlock, explicitly bring the locked
     * app's existing task to the foreground with FLAG_ACTIVITY_REORDER_TO_FRONT
     * before finishing this activity. Without this, finish() falls back to
     * whichever task Android considers "previous" — which is Aurelo when it was
     * running in the background. REORDER_TO_FRONT moves the app's existing task
     * to the front WITHOUT restarting it, preserving the user's in-app state.
     */
    private fun unlockSuccess() {
        sessionUnlockedApps[lockedPackage] = System.currentTimeMillis()
        currentLockedPackage = ""
        // Simply finish — Android naturally brings the locked app's existing
        // task back to front. The previous getLaunchIntentForPackage() call
        // re-launched the app's MAIN activity, losing the user's in-app
        // destination (e.g. WhatsApp new chat would bounce back to the chat
        // list instead of opening the new chat screen).
        finish()
    }

    // ── Error display ─────────────────────────────────────────────────────────
    private fun showError(msg: String) {
        errorText.text = msg
        errorText.visibility = View.VISIBLE
        Handler(Looper.getMainLooper()).postDelayed({ errorText.visibility = View.INVISIBLE }, 3000)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun isBiometricAvailable(): Boolean =
        BiometricManager.from(this)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) ==
                BiometricManager.BIOMETRIC_SUCCESS

    private fun getAppName(pkg: String): String = runCatching {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    }.getOrDefault(pkg)

    /** Convenience LP builder to reduce boilerplate in buildUI() */
    private fun lp(dp: (Int) -> Int, bottomMargin: Int = 0) =
        LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).also { it.bottomMargin = dp(bottomMargin) }
}
