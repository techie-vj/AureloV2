package com.javikastudio.tidyapp

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

object BedtimePrefs {
    fun getSettings(context: Context, prefs: SharedPreferences, securePrefs: SharedPreferences = SensitivePrefs.get(context)): String =
        getSettings(prefs, securePrefs)

    fun getSettings(prefs: SharedPreferences, securePrefs: SharedPreferences): String {
        migratePlainSettings(prefs, securePrefs)
        return securePrefs.getString(BEDTIME_SETTINGS_V1, null) ?: "{}"
    }

    fun saveSettings(prefs: SharedPreferences, securePrefs: SharedPreferences, json: String) {
        JSONObject(json)
        securePrefs.edit().putString(BEDTIME_SETTINGS_V1, json).apply()
        prefs.edit().remove(BEDTIME_SETTINGS_V1).apply()
    }

    fun migratePlainSettings(prefs: SharedPreferences, securePrefs: SharedPreferences) {
        if (securePrefs.contains(BEDTIME_SETTINGS_V1)) return
        val plaintext = prefs.getString(BEDTIME_SETTINGS_V1, null) ?: return
        securePrefs.edit().putString(BEDTIME_SETTINGS_V1, plaintext).apply()
        prefs.edit().remove(BEDTIME_SETTINGS_V1).apply()
    }

    fun getAttempts(securePrefs: SharedPreferences): String =
        securePrefs.getString(BEDTIME_APP_ATTEMPTS, "{}") ?: "{}"

    fun getAttempts(prefs: SharedPreferences, securePrefs: SharedPreferences): String {
        migrateString(prefs, securePrefs, BEDTIME_APP_ATTEMPTS)
        return getAttempts(securePrefs)
    }

    fun setAttempts(securePrefs: SharedPreferences, json: String) {
        securePrefs.edit().putString(BEDTIME_APP_ATTEMPTS, json).apply()
    }

    fun clearAttempts(securePrefs: SharedPreferences) {
        securePrefs.edit().putString(BEDTIME_APP_ATTEMPTS, "{}").apply()
    }

    fun getSavedBrightness(securePrefs: SharedPreferences): Int =
        securePrefs.getInt(BEDTIME_SAVED_BRIGHTNESS, 180)

    fun getSavedBrightness(prefs: SharedPreferences, securePrefs: SharedPreferences): Int {
        migrateInt(prefs, securePrefs, BEDTIME_SAVED_BRIGHTNESS)
        return getSavedBrightness(securePrefs)
    }

    fun setSavedBrightness(securePrefs: SharedPreferences, value: Int) {
        securePrefs.edit().putInt(BEDTIME_SAVED_BRIGHTNESS, value).apply()
    }

    fun migrateSensitiveBedtimeState(prefs: SharedPreferences, securePrefs: SharedPreferences) {
        migratePlainSettings(prefs, securePrefs)
        migrateString(prefs, securePrefs, BEDTIME_APP_ATTEMPTS)
        migrateInt(prefs, securePrefs, BEDTIME_SAVED_BRIGHTNESS)
    }

    fun canScheduleExact(am: android.app.AlarmManager): Boolean =
        android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S || am.canScheduleExactAlarms()

    fun setExactSafely(
        context: Context,
        am: android.app.AlarmManager,
        type: Int,
        triggerAtMillis: Long,
        operation: android.app.PendingIntent,
        onMissingPermission: () -> Unit = {},
    ): Boolean {
        if (!canScheduleExact(am)) {
            onMissingPermission()
            return false
        }
        return runCatching {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(type, triggerAtMillis, operation)
            } else {
                am.setExact(type, triggerAtMillis, operation)
            }
        }.onFailure {
            android.util.Log.w("BedtimePrefs", "Unable to schedule exact alarm for ${context.packageName}", it)
            onMissingPermission()
        }.isSuccess
    }

    private fun migrateString(prefs: SharedPreferences, securePrefs: SharedPreferences, key: String) {
        if (securePrefs.contains(key)) return
        val plaintext = prefs.getString(key, null) ?: return
        securePrefs.edit().putString(key, plaintext).apply()
        prefs.edit().remove(key).apply()
    }

    private fun migrateInt(prefs: SharedPreferences, securePrefs: SharedPreferences, key: String) {
        if (securePrefs.contains(key) || !prefs.contains(key)) return
        securePrefs.edit().putInt(key, prefs.getInt(key, 180)).apply()
        prefs.edit().remove(key).apply()
    }
}
