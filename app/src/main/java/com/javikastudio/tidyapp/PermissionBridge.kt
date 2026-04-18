package com.javikastudio.tidyapp

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope

/**
 * PermissionBridge — owns all permission checks and settings navigation:
 * usage access, overlay, accessibility, DND, notifications, battery optimisation,
 * exact alarms, and OEM battery whitelists.
 * Phase 3: extracted from AppBridge.kt.
 */
class PermissionBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    @JavascriptInterface fun hasUsagePermission(): Boolean {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    @JavascriptInterface fun requestUsagePermission() {
        context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK })
    }

    @JavascriptInterface fun hasOverlayPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true

    @JavascriptInterface fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            runCatching { context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:${context.packageName}")).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK }) }
                .onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK }) } }
        }
    }

    @JavascriptInterface fun hasAccessibilityPermission(): Boolean {
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return enabled.lowercase().contains(context.packageName.lowercase())
    }

    @JavascriptInterface fun requestAccessibilitySettings() {
        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK })
    }

    @JavascriptInterface fun hasNotificationPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
        else true

    @JavascriptInterface fun openNotificationSettings() {
        runCatching { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply { putExtra(Settings.EXTRA_APP_PACKAGE,context.packageName); flags=Intent.FLAG_ACTIVITY_NEW_TASK }) }
    }

    @JavascriptInterface fun requestNotificationPermission() {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val activity = context as? android.app.Activity
                if (activity != null) { activity.runOnUiThread { androidx.core.app.ActivityCompat.requestPermissions(activity, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9001) }; return }
            }
            context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply { putExtra(Settings.EXTRA_APP_PACKAGE,context.packageName); flags=Intent.FLAG_ACTIVITY_NEW_TASK })
        }
    }

    @JavascriptInterface fun isBatteryOptimizationExempt(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    @JavascriptInterface fun requestBatteryOptimizationExempt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        runCatching { context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply { data=android.net.Uri.parse("package:${context.packageName}"); flags=Intent.FLAG_ACTIVITY_NEW_TASK }) }
            .onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK }) } }
    }

    @JavascriptInterface fun getManufacturer(): String = Build.MANUFACTURER?.lowercase() ?: ""

    @JavascriptInterface fun openOemBatterySettings() {
        val mfr = Build.MANUFACTURER?.lowercase() ?: ""
        val oemIntents = when {
            mfr.contains("xiaomi") -> listOf("com.miui.powerkeeper/.ui.HideAppsContainerManagementActivity","com.miui.securitycenter/.PowerKeeperActivity")
            mfr.contains("oppo")||mfr.contains("oneplus")||mfr.contains("realme") -> listOf("com.coloros.oppoguardelf/.powersave.PowerAppListActivity","com.oplus.battery/.OplusBackgroundAppListActivity")
            mfr.contains("huawei")||mfr.contains("honor") -> listOf("com.huawei.systemmanager/.optimize.process.ProtectActivity","com.huawei.systemmanager/.startemup.StartupActivity")
            mfr.contains("samsung") -> listOf("com.samsung.android.lool/.ui.activity.AppMainActivity")
            mfr.contains("vivo") -> listOf("com.vivo.abe/.ManageApplicationsActivity")
            else -> emptyList()
        }
        for (componentStr in oemIntents) {
            runCatching { val parts=componentStr.split("/"); context.startActivity(Intent().apply { component=android.content.ComponentName(parts[0],parts[0]+parts[1]); flags=Intent.FLAG_ACTIVITY_NEW_TASK }); return }
        }
        runCatching { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK }) }
    }

    @JavascriptInterface fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        runCatching { context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply { data=android.net.Uri.parse("package:${context.packageName}"); flags=Intent.FLAG_ACTIVITY_NEW_TASK }) }
    }

    @JavascriptInterface fun canScheduleExactAlarms(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) (context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager).canScheduleExactAlarms() else true
}
