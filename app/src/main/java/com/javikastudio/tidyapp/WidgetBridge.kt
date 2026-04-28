package com.javikastudio.tidyapp

import android.content.Context
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject

/**
 * WidgetBridge — owns widget theme, Smart Routine (LaunchTracker), storage stats,
 * widget pinning, and insight toggle.
 * Phase 3: extracted from AppBridge.kt.
 */
class WidgetBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val pm: PackageManager,
    private val appManagement: AppManagementBridge
) : AppBridgeController {

    @JavascriptInterface fun getWidgetTheme(): String = prefs.getString(WIDGET_THEME, "DEFAULT") ?: "DEFAULT"
    @JavascriptInterface fun setWidgetTheme(key: String) { prefs.edit().putString(WIDGET_THEME, key).apply(); WidgetUpdater.updateAll(context) }

    @JavascriptInterface fun getWidgetThemes(): String {
        val activeKey = getWidgetTheme(); val arr = JSONArray()
        WidgetTheme.values().forEach { theme ->
            arr.put(JSONObject().apply { put("key",theme.key); put("displayName",theme.displayName); put("isPro",theme.isPro); put("active",theme.key==activeKey) })
        }
        return arr.toString()
    }

    @JavascriptInterface fun getWidgetApps(): String {
        val slot = TimeSlot.current(); val topPkgs = LaunchTracker.get(context).getTopAppsForSlot(slot, 5)
        val arr = JSONArray()
        topPkgs.forEach { pkg ->
            runCatching { val info = pm.getApplicationInfo(pkg,0); arr.put(JSONObject().apply { put("packageName",pkg); put("name",pm.getApplicationLabel(info).toString()); put("iconUrl","app-icon://$pkg"); put("slot",slot.name); put("slotLabel",TimeSlot.label(slot)) }) }
        }
        return arr.toString()
    }

    @JavascriptInterface fun getRoutineSummary(): String = getRoutineSummaryForDay(java.util.Calendar.getInstance().get(java.util.Calendar.DAY_OF_WEEK))

    @JavascriptInterface fun getRoutineSummaryForDay(dayOfWeek: Int): String {
        val tracker = LaunchTracker.get(context); val ownPkg = context.packageName; val root = JSONObject()
        TimeSlot.values().forEach { slot ->
            val pkgs = tracker.getTopAppsForSlot(slot, 12, dayOfWeek)
            val arr = JSONArray()
            pkgs.filter { it != ownPkg }
                .filter { pkg -> runCatching { val info = pm.getApplicationInfo(pkg,0); appManagement.isUserApp(info) }.getOrDefault(false) }
                .take(5)
                .forEach { pkg -> runCatching { val info=pm.getApplicationInfo(pkg,0); arr.put(JSONObject().apply { put("packageName",pkg); put("name",pm.getApplicationLabel(info).toString()); put("iconUrl","app-icon://$pkg") }) } }
            root.put(slot.name, arr)
        }
        return root.toString()
    }

    @JavascriptInterface fun getWidgetStorageStats(): String {
        val tracker = LaunchTracker.get(context)
        return JSONObject().apply { put("launchDbKb",tracker.dbSizeKb(context)); put("totalRows",tracker.totalRows()); put("maxAgeDays",60) }.toString()
    }

    @JavascriptInterface fun clearWidgetHistory() {
        LaunchTracker.get(context).clearAll()
        prefs.edit().putInt(CACHED_STREAK_DAYS, 0).apply()
    }

    @JavascriptInterface fun getWidgetLearningDays(): Int =
        runCatching { LaunchTracker.get(context).getDaysOfData().coerceAtLeast(1) }.getOrElse { 1 }

    @JavascriptInterface fun getWidgetLearningDaysForDay(dayOfWeek: Int): Int =
        runCatching { LaunchTracker.get(context).getDaysOfDataForDay(dayOfWeek) }.getOrElse { 0 }

    @JavascriptInterface fun refreshWidgets() { WidgetUpdater.updateAll(context) }

    @JavascriptInterface fun setWidgetInsightEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(WIDGET_INSIGHT_ENABLED, enabled).apply()
        runCatching { WidgetUpdater.updateAll(context) }
    }

    @JavascriptInterface fun recordAppLaunch(packageName: String) {
        if (!SecurityValidators.isInstalledLaunchablePackage(context, packageName)) return
        Thread { LaunchTracker.get(context).recordLaunch(packageName) }.start()
    }

    @JavascriptInterface fun requestPinWidget(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) return false
        val activity = context as? android.app.Activity ?: return false
        val dispatched = java.util.concurrent.atomic.AtomicBoolean(false)
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            try {
                val manager = android.appwidget.AppWidgetManager.getInstance(context)
                val provider = android.content.ComponentName(context, AureloWidgetProvider::class.java)
                val callbackFlags = android.app.PendingIntent.FLAG_CANCEL_CURRENT or
                        if (android.os.Build.VERSION.SDK_INT >= 31) android.app.PendingIntent.FLAG_MUTABLE else 0
                val callbackIntent = android.content.Intent(context, activity::class.java).apply { action="com.javikastudio.tidyapp.WIDGET_PINNED"; flags=android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP }
                val successCallback = android.app.PendingIntent.getActivity(context,7701,callbackIntent,callbackFlags)
                dispatched.set(manager.requestPinAppWidget(provider,null,successCallback))
            } catch (e: Exception) { dispatched.set(false) } finally { latch.countDown() }
        }
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return dispatched.get()
    }

    @JavascriptInterface fun canPinWidget(): Boolean = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O

    @JavascriptInterface fun isWidgetAdded(): Boolean = runCatching {
        val manager = android.appwidget.AppWidgetManager.getInstance(context)
        manager.getAppWidgetIds(android.content.ComponentName(context,AureloWidgetProvider::class.java)).isNotEmpty()
    }.getOrDefault(false)
}
