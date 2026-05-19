package com.javikastudio.tidyapp

import android.content.Intent
import android.graphics.Color
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

        // Prevent screenshots of the lock screen
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        lockedPackage    = intent.getStringExtra("locked_package") ?: ""
        biometricEnabled = intent.getBooleanExtra("biometric_enabled", true)
        securePrefs      = SensitivePrefs.get(this)

        currentLockedPackage = lockedPackage
        buildUI()

        // Auto-launch biometric if available and enabled
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
    private fun unlockSuccess() {
        sessionUnlockedApps[lockedPackage] = System.currentTimeMillis()  // stay unlocked until app backgrounds
        currentLockedPackage = ""
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
