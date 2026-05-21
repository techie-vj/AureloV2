package com.javikastudio.tidyapp

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope

/**
 * SettingsBridge — owns user settings, goal, categories, onboarding flag,
 * data management, and app metadata utilities.
 * Phase 3: extracted from AppBridge.kt.
 */
class SettingsBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val secureStorageAvailable: () -> Boolean,
    // P1-02 FIX: caller passes a lambda to revoke Pro so SettingsBridge doesn't
    // depend directly on EntitlementRepository's internal API.
    private val clearEntitlementData: () -> Unit = {}
) : AppBridgeController {

    companion object {
        // P1-05 FIX: these keys are redirected to the SQLCipher LaunchTracker DB
        // instead of being stored in plain SharedPreferences (tidyapp_v6).
        private val SCORE_HISTORY_KEYS = setOf(
            "aurelo_score_history",
            "screen_score_history",
            "focus_score_history",
            "sleep_score_history",
            "body_score_history"
        )
    }

    @JavascriptInterface fun isOnboardingDone(): Boolean = securePrefs.getBoolean(ONBOARDING_DONE, false)
    @JavascriptInterface fun setOnboardingDone() { securePrefs.edit().putBoolean(ONBOARDING_DONE, true).commit() }
    @JavascriptInterface fun getSettings(): String = securePrefs.getString(USER_SETTINGS_V5, "{}") ?: "{}"
    @JavascriptInterface fun saveSettings(json: String) { securePrefs.edit().putString(USER_SETTINGS_V5, json).apply() }
    @JavascriptInterface fun saveStreakGoalMins(mins: Int) { prefs.edit().putInt(STREAK_GOAL_MINS, mins).apply() }
    @JavascriptInterface fun getStreakGoalMinsBridge(): Int = prefs.getInt(STREAK_GOAL_MINS, 240)
    @JavascriptInterface fun getStringPref(key: String): String {
        // P1-05: score history keys are stored in encrypted SQLCipher DB, not plain prefs
        if (key in SCORE_HISTORY_KEYS) return LaunchTracker.get(context).getScoreHistory(key)
        if (!SecurityValidators.isAllowedPublicPrefKey(key)) return ""
        return (prefs.all[key] ?: "").toString()
    }
    @JavascriptInterface fun setStringPref(key: String, value: String) {
        // P1-05: score history keys are stored in encrypted SQLCipher DB, not plain prefs
        if (key in SCORE_HISTORY_KEYS) { LaunchTracker.get(context).saveScoreHistory(key, value); return }
        if (!SecurityValidators.isAllowedPublicPrefKey(key)) return
        prefs.edit().putString(key, value).apply()
    }
    @JavascriptInterface fun getDeviceModel(): String = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
    @JavascriptInterface fun getCountryCode(): String = java.util.Locale.getDefault().country.uppercase().ifEmpty { "US" }
    @JavascriptInterface fun getPackageName(): String = context.packageName
    @JavascriptInterface fun isSecureStorageAvailable(): Boolean = secureStorageAvailable()

    @JavascriptInterface fun getAppVersion(): String = runCatching {
        "v${context.packageManager.getPackageInfo(context.packageName,0).versionName}"
    }.getOrElse { "v1.0.0" }

    @JavascriptInterface fun loadAssetFile(path: String): String {
        if (!SecurityValidators.isAllowedAssetPath(path)) return ""
        return try { context.assets.open(path).bufferedReader().use { it.readText() } } catch (_:Exception) { "" }
    }

    @JavascriptInterface fun clearAllData() {
        val obDone = securePrefs.getBoolean(ONBOARDING_DONE, false)
        prefs.edit().clear().commit(); securePrefs.edit().clear().commit()
        securePrefs.edit().putBoolean(ONBOARDING_DONE, obDone).commit()
        // Clear App Lock PIN and setup state
        prefs.edit()
            .remove(APP_LOCK_SETUP_DONE)
            .remove(APP_LOCK_BIOMETRIC_ENABLED)
            .apply()
        securePrefs.edit().remove(APP_LOCK_PIN_HASH).apply()
        context.getSharedPreferences("tidyapp_cat_cache_v1", Context.MODE_PRIVATE).edit().clear().commit()
        runCatching { LaunchTracker.get(context).clearAll() }
        // P1-02 FIX: revoke Pro entitlement so stale Pro access cannot persist post-reset
        runCatching { clearEntitlementData() }
    }

    @JavascriptInterface fun clearAllDataFull() {
        prefs.edit().clear().commit(); securePrefs.edit().clear().commit()
        context.getSharedPreferences("tidyapp_cat_cache_v1", Context.MODE_PRIVATE).edit().clear().commit()
        runCatching { LaunchTracker.get(context).clearAll() }
        // P1-02 FIX: same — full clear must also revoke entitlement
        runCatching { clearEntitlementData() }
    }

    @JavascriptInterface fun checkAndTriggerRateApp(trigger: String) {
        val now = System.currentTimeMillis(); val DAY_MS = 86_400_000L
        if (!prefs.contains(KEY_RATE_INSTALL_MS)) {
            val installMs = try { context.packageManager.getPackageInfo(context.packageName,0).firstInstallTime } catch (_:Exception) { now }
            prefs.edit().putLong(KEY_RATE_INSTALL_MS, installMs).apply()
        }
        val installMs = prefs.getLong(KEY_RATE_INSTALL_MS, now)
        val lastShownMs = prefs.getLong(KEY_RATE_LAST_SHOWN_MS, 0L)
        val attemptCount = prefs.getInt(KEY_RATE_ATTEMPT_COUNT, 0)
        if (now - installMs < 5 * DAY_MS) return
        if (lastShownMs > 0L && (now - lastShownMs) < 14 * DAY_MS) return
        if (attemptCount >= 5) return
        prefs.edit().putLong(KEY_RATE_LAST_SHOWN_MS, now).putInt(KEY_RATE_ATTEMPT_COUNT, attemptCount+1).apply()
        val activity = context as? MainActivity ?: return
        activity.runOnUiThread { activity.triggerInAppReview() }
    }

    @JavascriptInterface fun canWriteSettings(): Boolean =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) android.provider.Settings.System.canWrite(context) else true

    @JavascriptInterface fun requestWriteSettingsPermission() {
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                context.startActivity(android.content.Intent(android.provider.Settings.ACTION_MANAGE_WRITE_SETTINGS, android.net.Uri.parse("package:${context.packageName}")).apply { flags=android.content.Intent.FLAG_ACTIVITY_NEW_TASK })
            }
        }
    }
}