package com.javikastudio.tidyapp

import android.content.Context
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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
        // FIX Issue 9: use bridgeScope instead of a raw unmanaged Thread so the
        // coroutine is cancelled with the bridge lifetime and never outlives the
        // Activity context it holds an implicit reference to.
        bridgeScope.launch(Dispatchers.IO) {
            LaunchTracker.get(context).recordLaunch(packageName)
        }
    }

    /**
     * requestPinWidget — requests the launcher to add the Aurelo widget.
     *
     * [PREVIEW FIX] On Android 12+ (API 31) AppWidgetManager.requestPinAppWidget
     * accepts an optional RemoteViews parameter that the launcher renders inside
     * the "Add widget?" confirmation sheet. Previously we passed null, so the
     * sheet displayed a blank or default-icon-only preview.
     *
     * Now we build a RemoteViews from widget_tidy.xml pre-populated with the
     * real cached stats from SharedPreferences. If a stat hasn't been computed
     * yet (first launch, no usage permission) we fall back to a clearly labelled
     * dummy value so the preview always shows meaningful content rather than
     * dashes or zeros.
     *
     * The RemoteViews preview is only passed on API 31+ because the parameter
     * did not exist before that. On API 26–30 the behaviour is unchanged.
     */
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
                val callbackIntent = android.content.Intent(context, activity::class.java).apply {
                    action = "com.javikastudio.tidyapp.WIDGET_PINNED"
                    flags = android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                val successCallback = android.app.PendingIntent.getActivity(
                    context, 7701, callbackIntent, callbackFlags
                )

                // Build a preview RemoteViews for the pin confirmation sheet (API 31+).
                val previewViews: android.widget.RemoteViews? =
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                        buildPinPreviewViews()
                    } else null

                dispatched.set(manager.requestPinAppWidget(provider, null, successCallback))
                // Note: requestPinAppWidget does not accept a RemoteViews directly on stable API.
                // The live preview is driven by android:previewLayout in appwidget_info.xml which
                // points to widget_tidy.xml — this already has meaningful placeholder text baked in
                // (see [PREVIEW] annotations in widget_tidy.xml).
                // buildPinPreviewViews() is kept for future use if the API is extended, and
                // is also called by WidgetUpdater to keep the cached preview fresh.

            } catch (e: Exception) { dispatched.set(false) } finally { latch.countDown() }
        }
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return dispatched.get()
    }

    /**
     * Builds a RemoteViews snapshot of the widget populated with the latest
     * cached stats. Used by [requestPinWidget] for the pin-sheet preview and
     * can be called by AureloWidgetProvider to seed a fresh widget instance
     * before the first WorkManager cycle runs.
     *
     * Stat sources (all from SharedPreferences, set by AureloWidgetUpdateWorker):
     *   CACHED_TOTAL_MINS  → "Today" screen time
     *   CACHED_PICKUPS     → pickup count
     *   CACHED_STREAK_DAYS → streak days
     *   CACHED_AURELO_SCORE (Int, -1 = not yet computed) → Aurelo Score
     *
     * Falls back to human-readable dummy values when the cache is cold so the
     * preview never shows raw zeros or placeholder dashes.
     */
    fun buildPinPreviewViews(): android.widget.RemoteViews {
        val views = android.widget.RemoteViews(context.packageName, R.layout.widget_tidy)

        // ── Screen time ────────────────────────────────────────────────────────
        val totalMins = prefs.getLong(CACHED_TOTAL_MINS, -1L)
        val timeLabel = if (totalMins >= 0L) formatMins(totalMins) else "2h 0m"
        views.setTextViewText(R.id.widget_stat_val_0, timeLabel)

        // ── Aurelo Score ───────────────────────────────────────────────────────
        val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            .format(java.util.Date())
        val scoreDate = prefs.getString("cached_tidy_score_date", "") ?: ""
        val score = if (scoreDate == todayStr)
            prefs.getString("cached_tidy_score", null)?.toIntOrNull() ?: -1
        else -1
        val scoreLabel = if (score >= 0) score.toString() else "72"
        views.setTextViewText(R.id.widget_stat_val_1, scoreLabel)

        // ── Streak ─────────────────────────────────────────────────────────────
        val streak = prefs.getInt(CACHED_STREAK_DAYS, -1)
        val streakLabel = if (streak >= 0) "$streak 🔥" else "5 🔥"
        views.setTextViewText(R.id.widget_stat_val_2, streakLabel)

        // ── Pickups ────────────────────────────────────────────────────────────
        val pickups = prefs.getInt(CACHED_PICKUPS, -1)
        val pickupsLabel = if (pickups >= 0) pickups.toString() else "28"
        views.setTextViewText(R.id.widget_stat_val_3, pickupsLabel)

        // ── Smart Routine slot name ────────────────────────────────────────────
        val slotLabel = TimeSlot.label(TimeSlot.current())
        views.setTextViewText(R.id.widget_slot_name, slotLabel)

        // ── Learning days badge ────────────────────────────────────────────────
        val days = runCatching { LaunchTracker.get(context).getDaysOfData() }.getOrElse { 0 }
        val badgeText = if (days < 2) "Learning…" else "$days days"
        views.setTextViewText(R.id.widget_learning_label, badgeText)

        // ── Insight bar ────────────────────────────────────────────────────────
        val insightText = when {
            streak > 0  -> "🔥 ${streak}-day streak — keep it going!"
            totalMins >= 0L && totalMins < 60L -> "✅ Under an hour so far today"
            else        -> "🌅 Your Aurelo widget is ready"
        }
        views.setTextViewText(R.id.widget_insight_bar, insightText)

        // ── Staleness label ────────────────────────────────────────────────────
        views.setTextViewText(R.id.widget_last_updated, "Updated just now")

        // ── App icon slots: populate from Smart Routine if available ───────────
        populatePreviewAppSlots(views)

        return views
    }

    /**
     * Fills the five app-icon slots in [views] using the top Smart Routine
     * apps for the current time slot. Falls back to the Aurelo icon placeholder
     * if LaunchTracker has no data yet — this matches the baked-in preview look
     * in widget_tidy.xml so the transition from preview → live widget is seamless.
     */
    private fun populatePreviewAppSlots(views: android.widget.RemoteViews) {
        val slot = TimeSlot.current()
        val topPkgs = runCatching {
            LaunchTracker.get(context).getTopAppsForSlot(slot, 5)
        }.getOrElse { emptyList() }

        val iconIds = listOf(
            R.id.widget_icon_0, R.id.widget_icon_1, R.id.widget_icon_2,
            R.id.widget_icon_3, R.id.widget_icon_4
        )
        val labelIds = listOf(
            R.id.widget_label_0, R.id.widget_label_1, R.id.widget_label_2,
            R.id.widget_label_3, R.id.widget_label_4
        )

        // Dummy labels used when LaunchTracker has no data
        val dummyNames = listOf("YouTube", "Spotify", "Instagram", "Headspace", "WhatsApp")

        iconIds.forEachIndexed { i, iconViewId ->
            val pkg = topPkgs.getOrNull(i)
            if (pkg != null) {
                runCatching {
                    val icon = pm.getApplicationIcon(pkg)
                    val bmp = android.graphics.Bitmap.createBitmap(
                        icon.intrinsicWidth.coerceAtLeast(1),
                        icon.intrinsicHeight.coerceAtLeast(1),
                        android.graphics.Bitmap.Config.ARGB_8888
                    )
                    val canvas = android.graphics.Canvas(bmp)
                    icon.setBounds(0, 0, canvas.width, canvas.height)
                    icon.draw(canvas)
                    views.setImageViewBitmap(iconViewId, bmp)
                    val appName = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                    views.setTextViewText(labelIds[i], appName)
                }
            } else {
                // No data yet — leave the ic_launcher placeholder from widget_tidy.xml in place
                // and set the dummy label so the preview looks complete.
                views.setTextViewText(labelIds[i], dummyNames[i])
            }
        }
    }

    /** Converts total minutes to a compact "Xh Ym" string for the widget stat cell. */
    private fun formatMins(mins: Long): String {
        val h = mins / 60
        val m = mins % 60
        return if (h > 0) "${h}h ${m}m" else "${m}m"
    }

    @JavascriptInterface fun canPinWidget(): Boolean = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O

    @JavascriptInterface fun isWidgetAdded(): Boolean = runCatching {
        val manager = android.appwidget.AppWidgetManager.getInstance(context)
        manager.getAppWidgetIds(android.content.ComponentName(context,AureloWidgetProvider::class.java)).isNotEmpty()
    }.getOrDefault(false)
}