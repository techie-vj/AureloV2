package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.widget.RemoteViews
import java.util.Calendar
import java.util.concurrent.Executors

class AureloWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_OPEN_SEARCH   = "com.javikastudio.tidyapp.ACTION_OPEN_SEARCH"
        const val ACTION_OPEN_HOME     = "com.javikastudio.tidyapp.ACTION_OPEN_HOME"
        const val ACTION_OPEN_WELLNESS = "com.javikastudio.tidyapp.ACTION_OPEN_WELLNESS"
        const val ACTION_CYCLE_INSIGHT = "com.javikastudio.tidyapp.ACTION_CYCLE_INSIGHT"
        const val WIDGET_RENDER_TS = "widget_render_ts"
        /** Fired when user taps an app slot; records the launch then opens the app. */
        const val ACTION_LAUNCH_APP    = "com.javikastudio.tidyapp.ACTION_LAUNCH_APP"
        const val EXTRA_PACKAGE        = "pkg"
        private const val ICON_PX = 160
        private const val PREFS   = "tidyapp_v6"

        private const val COLOR_GREEN  = 0xFF12D48A.toInt()
        private const val COLOR_CYAN   = 0xFF5DD6F8.toInt()
        private const val COLOR_AMBER  = 0xFFF7A623.toInt()
        private const val COLOR_PURPLE = 0xFFA89CFF.toInt()
        private const val COLOR_PINK   = 0xFFF04E7A.toInt()
        private const val COLOR_MUTED  = 0x66FFFFFF.toInt()

        /** Called by AppBridge.refreshUsageStats() every 10 s while app is open. */
        fun pushUpdate(context: Context) {
            val mgr  = AppWidgetManager.getInstance(context)
            val comp = ComponentName(context, AureloWidgetProvider::class.java)
            val ids  = mgr.getAppWidgetIds(comp)
            if (ids.isEmpty()) return
            context.sendBroadcast(
                Intent(context, AureloWidgetProvider::class.java).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
            )
        }

        /** Advance pulse step 0→1→2→0 in SharedPrefs and return the new step. */
        private fun advancePulse(context: Context): Int {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val next  = (prefs.getInt("widget_pulse_step", 0) + 1) % 3
            prefs.edit().putInt("widget_pulse_step", next).apply()
            return next
        }
    }

    private val executor = Executors.newSingleThreadExecutor()

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        AureloWidgetUpdateWorker.schedule(context)
        scheduleAlarm(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        AureloWidgetUpdateWorker.cancel(context)
        cancelAlarm(context)
    }

    private fun scheduleAlarm(context: Context) {
        val am     = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = alarmIntent(context)
        // Inexact repeating every 5 minutes — Android may batch it but it's close enough
        am.setInexactRepeating(
            AlarmManager.RTC,
            System.currentTimeMillis() + 5 * 60_000L,
            5 * 60_000L,
            intent
        )
    }

    private fun cancelAlarm(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(alarmIntent(context))
    }

    private fun alarmIntent(context: Context): PendingIntent {
        val intent = Intent(context, AureloWidgetProvider::class.java).apply {
            action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
            val ids = AppWidgetManager.getInstance(context)
                .getAppWidgetIds(ComponentName(context, AureloWidgetProvider::class.java))
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        }
        return PendingIntent.getBroadcast(
            context,
            // BUG-05 FIX: was hardcoded 9901. Widget slot codes are widgetId*100+slot,
            // so widget ID 99 slot 1 = 9901 — an exact collision. Use Int.MAX_VALUE-2
            // which is far outside any realistic widgetId*100 range.
            Int.MAX_VALUE - 2,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_LAUNCH_APP) {
            val pkg = intent.getStringExtra(EXTRA_PACKAGE) ?: return
            if (!SecurityValidators.isValidPackageName(pkg)) return
            val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
            if (widgetId != -1) {
                val ids = AppWidgetManager.getInstance(context)
                    .getAppWidgetIds(ComponentName(context, AureloWidgetProvider::class.java))
                if (!ids.contains(widgetId)) return
            }
            val launchIntent = context.packageManager.getLaunchIntentForPackage(pkg) ?: return
            val widgetApps = runCatching {
                resolveApps(context, currentTimeSlot()).take(5)
            }.getOrElse { emptyList<String>() }
            if (widgetApps.isNotEmpty() && pkg !in widgetApps) return
            // Haptic feedback — short click-style vibration on app slot tap
            runCatching {
                val vibrator = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                    val vm = context.getSystemService(android.content.Context.VIBRATOR_MANAGER_SERVICE)
                            as android.os.VibratorManager
                    vm.defaultVibrator
                } else {
                    @Suppress("DEPRECATION")
                    context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as android.os.Vibrator
                }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    vibrator.vibrate(
                        android.os.VibrationEffect.createOneShot(30, android.os.VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(30)
                }
            }
            // Record the launch in LaunchTracker (off main thread)
            executor.execute { runCatching { LaunchTracker.get(context).recordLaunch(pkg) } }
            // Then open the app
            runCatching {
                launchIntent.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
                    .let { context.startActivity(it) }
            }
            return
        }
        if (intent.action == ACTION_CYCLE_INSIGHT) {
            val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
            if (widgetId != -1) {
                // Haptic feedback — light tick on insight bar tap
                runCatching {
                    val vibrator = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                        val vm = context.getSystemService(android.content.Context.VIBRATOR_MANAGER_SERVICE)
                                as android.os.VibratorManager
                        vm.defaultVibrator
                    } else {
                        @Suppress("DEPRECATION")
                        context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as android.os.Vibrator
                    }
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        vibrator.vibrate(
                            android.os.VibrationEffect.createOneShot(18, android.os.VibrationEffect.DEFAULT_AMPLITUDE)
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator.vibrate(18)
                    }
                }
                // Advance the tap cycle for this widget
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                val key   = "insight_tap_$widgetId"
                val next  = (prefs.getInt(key, 0) + 1) % 3
                prefs.edit().putInt(key, next).apply()
                // Redraw
                val mgr = AppWidgetManager.getInstance(context)
                executor.execute {
                    try { mgr.updateAppWidget(widgetId, buildWidget(context, widgetId)) }
                    catch (_: Exception) {}
                }
            }
            return
        }
        super.onReceive(context, intent)
    }

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        scheduleAlarm(context)  // re-arm after reboot or system restart
        // Advance pulse state on every update tick
        advancePulse(context)
        // FIX-08: WorkManager minimum is 15 min, but our AlarmManager fires every 5 min.
        // Refresh usage caches here so each alarm tick has up-to-date screen time / pickups
        // even when the app is fully in the background.
        // BUG-1 FIX: When UsageStatsBridge.refreshUsageStats() runs (every ~10s while app is
        // open), it writes CACHED_TOTAL_MINS and then calls pushUpdate() which triggers
        // onUpdate(). If refreshCachesStatic() then runs and overwrites CACHED_TOTAL_MINS
        // with its own background calculation (which may be slightly out of sync), the widget
        // shows a lower value than the app. Guard: skip the widget-side recalculation when
        // the app already wrote fresh data within the last 15 seconds.
        executor.execute {
            runCatching {
                val cachedTs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getLong(CACHED_USAGE_TS, 0L)
                val appRefreshRecent = cachedTs > 0L &&
                        (System.currentTimeMillis() - cachedTs) < 15_000L
                if (!appRefreshRecent && RefreshCoordinator.shouldRefreshWidgetCaches(context)) {
                    AureloWidgetUpdateWorker.refreshCachesStatic(context)
                }
            }
        }
        ids.forEach { id ->
            executor.execute {
                try   {
                    mgr.updateAppWidget(id, buildWidget(context, id))
                    // Write render timestamp AFTER successful update
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit().putLong(WIDGET_RENDER_TS, System.currentTimeMillis()).apply()
                }
                catch (e: Exception) {
                    android.util.Log.e("AureloWidget", "build failed $id", e)
                    try {
                        val fb = RemoteViews(context.packageName, R.layout.widget_tidy)
                        fb.setOnClickPendingIntent(R.id.widget_root,
                            PendingIntent.getActivity(context, 0,
                                aureloIntent(context, null), pendingFlags()))
                        mgr.updateAppWidget(id, fb)
                    } catch (_: Exception) {}
                }
            }
        }
    }

    // ── Build ─────────────────────────────────────────────────────────────────
    private fun buildWidget(context: Context, widgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_tidy)
        val theme = WidgetThemeManager.getTheme(context)
        applyTheme(views, theme)
        val slot  = currentTimeSlot()
        val days  = learningDays(context)
        // Count how many apps come from real LaunchTracker history
        val learnedApps = runCatching {
            LaunchTracker.get(context).getTopAppsForSlot(slot.trackerSlot, 12, slot.dayOfWeek)
                .filter { it != context.packageName && isUserApp(context, it) }
                .distinct().size.coerceAtMost(5)
        }.getOrElse { 0 }
        val apps  = resolveApps(context, slot)
        val freqs = resolveFrequencies(context, apps, slot)
        populateHeader(views, context, slot, days)
        populateSlots(context, views, apps, freqs, learnedApps)
        populateInsight(context, views, slot, widgetId)
        populateStats(context, views)
        wireClicks(context, views, apps, widgetId)
        return views
    }

    // ── Time slot ─────────────────────────────────────────────────────────────
    data class TimeSlot(val hour: Int) {
        private val dayName: String get() {
            val dow = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)
            return when (dow) {
                Calendar.SUNDAY    -> "Sunday"
                Calendar.MONDAY    -> "Monday"
                Calendar.TUESDAY   -> "Tuesday"
                Calendar.WEDNESDAY -> "Wednesday"
                Calendar.THURSDAY  -> "Thursday"
                Calendar.FRIDAY    -> "Friday"
                else               -> "Saturday"
            }
        }
        val label: String get() = when (hour) {
            in 6..8   -> "$dayName ☀️ Morning"
            in 9..10  -> "$dayName 🚌 Commute"
            in 11..13 -> "$dayName 🌤 Midday"
            in 14..16 -> "$dayName 🌞 Afternoon"
            in 17..20 -> "$dayName 🌅 Evening"
            else      -> "$dayName 🌙 Night"
        }
        /** Pick pulse-state drawable: s1=contracted, s2=mid, s3=full-bloom */
        fun dotDrawable(pulseStep: Int): Int {
            val family = when (hour) {
                in 6..8  -> "amber"; in 9..16 -> "cyan"; in 17..20 -> "amber"; else -> "purple"
            }
            return when (pulseStep % 3) {
                0 -> when (family) {
                    "amber"  -> R.drawable.widget_dot_s1_amber
                    "cyan"   -> R.drawable.widget_dot_s1_cyan
                    else     -> R.drawable.widget_dot_s1_purple
                }
                1 -> when (family) {
                    "amber"  -> R.drawable.widget_dot_s2_amber
                    "cyan"   -> R.drawable.widget_dot_s2_cyan
                    else     -> R.drawable.widget_dot_s2_purple
                }
                else -> when (family) {
                    "amber"  -> R.drawable.widget_dot_s3_amber
                    "cyan"   -> R.drawable.widget_dot_s3_cyan
                    else     -> R.drawable.widget_dot_s3_purple
                }
            }
        }
        val nameColor: Int get() = when (hour) {
            in 6..8   -> COLOR_AMBER
            in 9..16  -> COLOR_CYAN
            in 17..20 -> COLOR_AMBER
            else      -> COLOR_PURPLE
        }
        // ISSUE-08 FIX: was always calling TimeSlot.current() which ignores this.hour
        // and returns the slot for the moment the property is read — not the slot for
        // the hour stored in this TimeSlot. This matters when the executor fires slightly
        // after the slot boundary or during testing. Derive from this.hour instead.
        val trackerSlot: com.javikastudio.tidyapp.TimeSlot get() = when (hour) {
            in 6..8   -> com.javikastudio.tidyapp.TimeSlot.MORNING
            in 9..10  -> com.javikastudio.tidyapp.TimeSlot.COMMUTE
            in 11..13 -> com.javikastudio.tidyapp.TimeSlot.MIDDAY
            in 14..16 -> com.javikastudio.tidyapp.TimeSlot.AFTERNOON
            in 17..20 -> com.javikastudio.tidyapp.TimeSlot.EVENING
            else      -> com.javikastudio.tidyapp.TimeSlot.NIGHT
        }
        val dayOfWeek: Int get() =
            Calendar.getInstance().get(Calendar.DAY_OF_WEEK)
    }

    private fun currentTimeSlot() = TimeSlot(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))

    private fun learningDays(context: Context): Int =
        runCatching { LaunchTracker.get(context).getDaysOfData().coerceAtLeast(1) }.getOrElse { 1 }

    // ── App resolution ────────────────────────────────────────────────────────
    private fun resolveApps(context: Context, slot: TimeSlot): List<String> {
        val excl   = context.packageName
        val result = mutableListOf<String>()

        // Tier 1: LaunchTracker history (best signal — user actually opened these)
        runCatching {
            LaunchTracker.get(context)
                .getTopAppsForSlot(slot.trackerSlot, 12, slot.dayOfWeek)
                .filter { it != excl && isUserApp(context, it) }
                .distinct().forEach { if (!result.contains(it)) result.add(it) }
        }
        if (result.size >= 5) return result.take(5)

        // Tier 2: UsageStats — most-used apps today
        runCatching {
            val usm = context.getSystemService(Context.USAGE_STATS_SERVICE)
                    as? android.app.usage.UsageStatsManager ?: return@runCatching
            val now = System.currentTimeMillis()
            usm.queryUsageStats(android.app.usage.UsageStatsManager.INTERVAL_DAILY, now - 86_400_000L, now)
                .filter { it.totalTimeInForeground > 0 && it.packageName != excl && isUserApp(context, it.packageName) }
                .sortedByDescending { it.totalTimeInForeground }
                .distinctBy { it.packageName }
                .forEach { if (!result.contains(it.packageName)) result.add(it.packageName) }
        }
        if (result.size >= 5) return result.take(5)

        // Tier 3: Launcher apps (last resort — at least fills all 5 slots)
        runCatching {
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            context.packageManager.queryIntentActivities(intent, 0)
                .map { it.activityInfo.packageName }
                .filter { it != excl && isUserApp(context, it) }
                .distinct()
                .forEach { if (!result.contains(it)) result.add(it) }
        }
        return result.take(5)
    }

    private fun resolveFrequencies(context: Context, apps: List<String>, slot: TimeSlot): List<Int> {
        val days = runCatching { LaunchTracker.get(context).getDaysOfData() }.getOrElse { 0 }
        if (days >= 2) {
            return runCatching {
                val tracker = LaunchTracker.get(context)
                apps.map { pkg -> tracker.getSlotFrequencyPercent(pkg, slot.trackerSlot, slot.dayOfWeek).coerceIn(0, 100) }
            }.getOrElse { apps.map { 0 } }
        }
        // Day 1: show share of today's total screen time
        return runCatching {
            val usm = context.getSystemService(Context.USAGE_STATS_SERVICE)
                    as? android.app.usage.UsageStatsManager ?: return@runCatching apps.map { 0 }
            val now   = System.currentTimeMillis()
            val stats = usm.queryUsageStats(android.app.usage.UsageStatsManager.INTERVAL_DAILY,
                now - 86_400_000L, now).associateBy { it.packageName }
            val totalMs = stats.values.filter { isUserApp(context, it.packageName) }
                .sumOf { it.totalTimeInForeground }.coerceAtLeast(1L)
            apps.map { pkg ->
                ((( stats[pkg]?.totalTimeInForeground ?: 0L) * 100L) / totalMs).toInt().coerceIn(0, 99)
            }
        }.getOrElse { apps.map { 0 } }
    }

    private fun isUserApp(context: Context, pkg: String): Boolean {
        if (pkg == context.packageName) return false
        return try {
            val pm   = context.packageManager
            val info = pm.getApplicationInfo(pkg, 0)

            // Must have a user-visible launch intent
            if (pm.getLaunchIntentForPackage(pkg) == null) return false

            val isSystem        = (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            val isUpdatedSystem = (info.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0

            // Pure user-installed app — always include
            if (!isSystem) return true

            // Hard-block prefixes — always system infrastructure
            val systemPrefixes = listOf(
                "android",
                "com.android.systemui",
                "com.android.launcher",
                "com.android.settings",
                "com.android.providers",
                "com.android.server",
                "com.android.phone",
                "com.android.dialer",
                "com.android.contacts",
                "com.android.mms",
                "com.android.camera",
                "com.android.soundrecorder",
                "com.android.packageinstaller",
                "com.android.managedprovisioning",
                "com.android.inputmethod",
                "com.android.nfc",
                "com.android.bluetooth",
                "com.android.wifi",
                "com.android.connectivity",
                "com.android.hotspot2",
                "com.android.stk",
                "com.android.calllogbackup",
                "com.android.incallui",
                "com.android.calculator",           // AOSP calculator
                "com.android.deskclock",            // AOSP clock/alarm
                "com.android.gallery",              // AOSP gallery
                "com.android.gallery3d",
                "com.android.music",                // AOSP music
                "com.android.filemanager",
                "com.android.documentsui",
                "com.google.android.gms",
                "com.google.android.gsf",
                "com.google.android.inputmethod",
                "com.google.android.googlequicksearchbox",
                "com.google.android.tts",
                "com.google.android.syncadapters",
                "com.google.android.backuptransport",
                "com.google.android.configupdater",
                "com.google.android.partnersetup",
                "com.google.android.setupwizard",
                "com.google.android.onetimeinitializer",
                "com.google.android.packageinstaller",
                "com.google.android.permissioncontroller",
                "com.google.android.networkstack",
                "com.google.android.accessibility",
                "com.google.android.apps.accessibility",
                "com.android.accessibility",
                "com.google.android.apps.enterprise",
                "com.google.android.apps.safetyhub",
                "com.google.android.apps.emergencyassist",
                "com.google.android.apps.restore",
                "com.google.android.apps.setupwizard",
                "com.android.theme",
                "com.android.overlay",
                "com.samsung.android.theme",
                "com.samsung.android.stk",
                "com.samsung.android.app.camera",  // Samsung Camera
                "com.samsung.android.dialer",       // Samsung Phone
                "com.samsung.android.incallui",
                "com.samsung.android.app.clockpack", // Samsung Clock
                "com.samsung.android.calculator",   // Samsung Calculator
                "com.samsung.android.gallery3d",    // Samsung Gallery
                "com.samsung.android.contacts",     // Samsung Contacts
                "com.samsung.android.app.contacts",
                "com.samsung.android.MtpApplication",
                "com.qualcomm.qti.stk",
                "com.mediatek.stk",
                "com.sprd.stk",
            )
            if (systemPrefixes.any { pkg == it || pkg.startsWith("$it.") }) return false

            // Exact hard-block for packages that slip through prefix checks
            val systemExact = setOf(
                "com.google.android.dialer",
                "com.google.android.contacts",
                "com.google.android.calculator",    // Google Calculator
                "com.google.android.GoogleCamera",  // Google Camera (Pixel)
                "com.google.android.deskclock",     // Google Clock
                "com.google.android.apps.turbo",
                "com.google.android.apps.wallpaper",
                "com.google.android.apps.photos.scanner",
                "com.google.android.apps.pixel.launcher",
                "com.google.android.apps.work.oobe",
                "com.google.android.apps.devicelockcontroller",
                "com.google.android.devicelockcontroller",
                "com.samsung.android.app.telephonyui",
                "com.samsung.android.incallui",
                "com.samsung.android.dialer",
                "com.samsung.android.app.soundalive", // Samsung sound
                "com.oneplus.camera",               // OnePlus Camera
                "com.oneplus.dialer",               // OnePlus Phone
                "com.oneplus.deskclock",            // OnePlus Clock
                "com.oppo.camera",                  // OPPO Camera
                "com.realme.camera",                // Realme Camera
                "com.miui.camera",                  // Xiaomi Camera
                "com.miui.calculator",              // Xiaomi Calculator
                "com.miui.clock",                   // Xiaomi Clock
                "com.coloros.calculator",           // ColorOS Calculator
                "com.coloros.camera2",              // ColorOS Camera
            )
            if (pkg in systemExact) return false

            // Updated system apps: only genuinely user-facing social/productivity apps
            // Deliberately excludes Camera, Calculator, Clock, Phone — these are
            // utilities that shouldn't appear in contextual time-slot suggestions.
            if (isUpdatedSystem) {
                val allowedUpdatedSystem = setOf(
                    "com.android.chrome",
                    "com.google.android.apps.messaging",
                    "com.google.android.apps.photos",
                    "com.google.android.apps.maps",
                    "com.google.android.youtube",
                    "com.google.android.gm",
                    "com.google.android.apps.docs",
                    "com.google.android.apps.sheets",
                    "com.google.android.apps.slides",
                    "com.google.android.keep",
                    "com.google.android.calendar",
                    "com.google.android.apps.meet",
                    "com.google.android.apps.subscriptions.red",
                    "com.google.android.music",
                    "com.google.android.play.games",
                    "com.google.android.apps.recorder",
                    "com.google.android.apps.wellbeing",
                    "com.google.android.apps.chromecast.app",
                    "com.google.android.apps.nbu.files",
                    "com.samsung.android.email.provider",
                    "com.samsung.android.calendar",
                    "com.samsung.android.browser",
                    "com.samsung.android.messaging",
                )
                return pkg in allowedUpdatedSystem
            }

            // Remaining pure-system (not updated by Play): exclude
            false
        } catch (_: Exception) { false }
    }

    private fun isCarrierOrTelecomSystem(pkg: String): Boolean = false // superseded by isUserApp above

    // ── Theme ──────────────────────────────────────────────────────────────────
    private fun applyTheme(views: RemoteViews, theme: WidgetTheme) {
        views.setInt(R.id.widget_root, "setBackgroundColor", theme.bgColor)
        views.setTextColor(R.id.widget_insight_bar, theme.textDim)
        listOf(R.id.widget_stat_key_0, R.id.widget_stat_key_1,
            R.id.widget_stat_key_2, R.id.widget_stat_key_3_view)
            .forEach { views.setTextColor(it, theme.textDim) }
    }

    // ── Header ────────────────────────────────────────────────────────────────
    private fun populateHeader(views: RemoteViews, context: Context, slot: TimeSlot, days: Int) {
        val pulseStep = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt("widget_pulse_step", 0)
        views.setImageViewResource(R.id.widget_slot_dot, slot.dotDrawable(pulseStep))
        views.setTextViewText(R.id.widget_slot_name, slot.label)
        views.setTextColor(R.id.widget_slot_name, slot.nameColor)

        val badge = when {
            days >= 21 -> "Based on $days days"
            days >= 7  -> "Learnt · $days days"
            days >= 2  -> "Learning… $days days"
            else       -> "Learning… 1 day"
        }
        views.setTextViewText(R.id.widget_learning_label, badge)
        views.setTextColor(R.id.widget_learning_label, slot.nameColor)
    }

    // ── App icon slots ────────────────────────────────────────────────────────
    private fun populateSlots(context: Context, views: RemoteViews, apps: List<String>, freqs: List<Int>, learnedApps: Int = 5) {
        val pm     = context.packageManager
        val slots  = listOf(R.id.widget_slot_0, R.id.widget_slot_1, R.id.widget_slot_2, R.id.widget_slot_3, R.id.widget_slot_4)
        val icons  = listOf(R.id.widget_icon_0, R.id.widget_icon_1, R.id.widget_icon_2, R.id.widget_icon_3, R.id.widget_icon_4)
        val labels = listOf(R.id.widget_label_0, R.id.widget_label_1, R.id.widget_label_2, R.id.widget_label_3, R.id.widget_label_4)
        val freqVs = listOf(R.id.widget_freq_0,  R.id.widget_freq_1,  R.id.widget_freq_2,  R.id.widget_freq_3,  R.id.widget_freq_4)

        for (i in 0..4) {
            val pkg  = apps.getOrNull(i)
            val freq = freqs.getOrNull(i) ?: 0
            if (pkg == null) {
                // Show a dashed "learning" placeholder rather than leaving an empty gap
                views.setViewVisibility(slots[i], android.view.View.VISIBLE)
                views.setInt(slots[i], "setBackgroundResource", R.drawable.widget_learning_slot)
                // Use the Aurelo icon as a soft placeholder
                views.setImageViewResource(icons[i], R.mipmap.ic_launcher_round)
                views.setInt(icons[i], "setAlpha", 40)  // ~16% opacity
                views.setTextViewText(labels[i], "···")
                views.setTextColor(labels[i], 0x33FFFFFF.toInt())
                views.setTextViewText(freqVs[i], "🌱")
                views.setTextColor(freqVs[i], 0x33FFFFFF.toInt())
                continue
            }
            val isFallback = i >= learnedApps   // slot came from usage/launcher fallback
            try {
                views.setViewVisibility(slots[i], android.view.View.VISIBLE)
                val info = pm.getApplicationInfo(pkg, 0)
                val icon = scaledIcon(pm.getApplicationIcon(pkg))
                views.setImageViewBitmap(icons[i], icon)
                views.setInt(icons[i], "setAlpha", 255)  // full opacity for real apps
                views.setTextViewText(labels[i], pm.getApplicationLabel(info).toString())
                // Fallback slots are dimmed to signal they're not from learned history
                views.setTextColor(labels[i], if (isFallback) 0x55FFFFFF.toInt() else 0x99FFFFFF.toInt())
                val ringRes = when {
                    isFallback -> R.drawable.widget_slot_bg  // no ring for fallback
                    freq >= 70 -> R.drawable.widget_freq_ring_high
                    freq >= 45 -> R.drawable.widget_freq_ring_mid
                    freq >= 20 -> R.drawable.widget_freq_ring_low
                    else       -> R.drawable.widget_slot_bg
                }
                views.setInt(slots[i], "setBackgroundResource", ringRes)
                val freqColor = when {
                    isFallback -> 0x44FFFFFF.toInt()          // very muted for fallback
                    freq >= 70 -> COLOR_GREEN
                    freq >= 45 -> COLOR_CYAN
                    freq >= 20 -> COLOR_AMBER
                    else       -> COLOR_MUTED
                }
                // Fallback slots show "·" instead of a %, to avoid false data
                views.setTextViewText(freqVs[i], if (isFallback) "·" else if (freq > 0) "$freq%" else "–")
                views.setTextColor(freqVs[i], freqColor)
            } catch (_: Exception) {
                views.setViewVisibility(slots[i], android.view.View.INVISIBLE)
            }
        }
    }

    // ── Insight bar (replaces search bar) ─────────────────────────────────────
    private fun populateInsight(context: Context, views: RemoteViews, slot: TimeSlot, widgetId: Int) {
        runCatching {
            // Phase 3 (#2): Gate insight bar for free users
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val insightEnabled = prefs.getBoolean(WIDGET_INSIGHT_ENABLED, true)
            if (!insightEnabled) {
                // Show a static placeholder — native widget can't blur, so we replace
                // the text with a locked message. The JS preview uses CSS blur.
                views.setTextViewText(R.id.widget_insight_bar,
                    "✦ PRO — Upgrade to unlock daily insights")
                views.setTextColor(R.id.widget_insight_bar,  slot.nameColor) // muted
                return@runCatching
            }

            // No usage permission — show a prompt instead of data-based insights
            val hasPermission = runCatching {
                val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
                val mode = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q)
                    appOps.unsafeCheckOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                        android.os.Process.myUid(), context.packageName)
                else
                    @Suppress("DEPRECATION")
                    appOps.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                        android.os.Process.myUid(), context.packageName)
                mode == android.app.AppOpsManager.MODE_ALLOWED
            }.getOrDefault(false)

            if (!hasPermission) {
                views.setTextViewText(R.id.widget_insight_bar,
                    "📊 Open Aurelo → grant Usage Access for live insights")
                views.setTextColor(R.id.widget_insight_bar, slot.nameColor)
                return@runCatching
            }

            //val prefs      = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val tapCycle   = prefs.getInt("insight_tap_$widgetId", 0)
            val todayMin   = prefs.getLong(CACHED_TOTAL_MINS, 0L)
            val pickups    = prefs.getInt(CACHED_PICKUPS, 0)
            val streakDays = prefs.getInt(CACHED_STREAK_DAYS, 0)
            val ghostCount = prefs.getInt(CACHED_GHOST_COUNT, 0)
            val goalMins   = prefs.getInt(STREAK_GOAL_MINS, 240).toLong()
            val pct        = if (goalMins > 0) ((todayMin * 100L) / goalMins).toInt().coerceAtMost(999) else 0
            val overMin    = (todayMin - goalMins).coerceAtLeast(0L)
            val underMin   = (goalMins - todayMin).coerceAtLeast(0L)

            val cal     = Calendar.getInstance()
            val autoRot = (cal.get(Calendar.DAY_OF_YEAR) + cal.get(Calendar.HOUR_OF_DAY)) % 3
            val variant  = (autoRot + tapCycle) % 3

            val msg = buildInsightMessage(slot.hour, variant, todayMin, pickups, streakDays,
                ghostCount, goalMins, pct, overMin, underMin)
            views.setTextViewText(R.id.widget_insight_bar, msg)
            views.setTextColor(R.id.widget_insight_bar, slot.nameColor)
        }
    }

    private fun buildInsightMessage(
        hour: Int, v: Int,
        todayMin: Long, pickups: Int, streak: Int, ghosts: Int,
        goalMins: Long, pct: Int, overMin: Long, underMin: Long
    ): String {
        return when {
            // ── Morning 6–8am ──────────────────────────────────────────────────
            hour in 6..8 -> when (v) {
                0 -> if (streak > 0) "🌅 Rise & shine! ${streak}-day streak — keep the momentum"
                else "🌅 Rise & shine! Fresh day, make it count"
                1 -> "🔥 Goal: stay under ${fmtM(goalMins)} today. " +
                        if (streak > 0) "You're on a $streak-day streak!" else "Start a streak now"
                else -> if (pickups == 0) "☀️ First pickup of the day. Morning is your most focused time"
                else "☀️ $pickups pickup${if (pickups == 1) "" else "s"} already — pace yourself today"
            }

            // ── Commute 9–10am ────────────────────────────────────────────────
            hour in 9..10 -> when (v) {
                0 -> "📊 ${fmtM(todayMin)} used · ${pct}% of daily ${fmtM(goalMins)} goal"
                1 -> if (pickups > 5) "📱 $pickups pickups already — deep work means fewer checks"
                else "👍 $pickups pickups — solid focus this morning"
                else -> if (underMin > 0) "🎯 ${fmtM(underMin)} left in your daily goal — stay sharp"
                else "⚠️ Already over goal — slow down this afternoon"
            }

            // ── Midday 11am–1pm ───────────────────────────────────────────────
            hour in 11..13 -> when (v) {
                0 -> if (underMin > 0) "⏱ ${fmtM(underMin)} left of your ${fmtM(goalMins)} goal"
                else "⚠️ ${fmtM(overMin)} over goal — afternoon reset time"
                1 -> if (pickups > 10) "📱 $pickups pickups midday — try phone-free lunch"
                else "✅ $pickups pickups so far — good discipline"
                else -> "🌤 Halfway through the day · ${pct}% of daily goal used"
            }

            // ── Afternoon 2–4pm ───────────────────────────────────────────────
            hour in 14..16 -> when (v) {
                0 -> if (pct > 80) "📈 ${pct}% of goal used — slow down to finish under"
                else "📈 ${pct}% of goal · pacing well this afternoon"
                1 -> if (ghosts > 0) "👻 $ghosts unused app${if (ghosts == 1) "" else "s"} taking up space — clean up later"
                else "✨ No ghost apps — great app hygiene"
                else -> if (todayMin > goalMins) "⏳ ${fmtM(overMin)} over — aim to wind down by evening"
                else "⏳ ${fmtM(underMin)} left in goal · you're on track"
            }

            // ── Evening 5–8pm ─────────────────────────────────────────────────
            hour in 17..20 -> when (v) {
                0 -> if (todayMin > goalMins) "⚠️ ${fmtM(overMin)} over goal — time to wind down"
                else "✅ Under goal — ${fmtM(underMin)} to spare today"
                1 -> "🌅 ${fmtM(todayMin)} screen time today · $pickups pickups"
                else -> if (pickups > 20) "🌙 ${pickups} pickups today — try phone-free evenings"
                else "👌 $pickups pickups today — great balance"
            }

            // ── Night 9pm+ ────────────────────────────────────────────────────
            else -> when (v) {
                // BUG-06 FIX: was "· ${streak}🔥 streak" unconditionally, showing
                // "0🔥 streak" for new users which looks broken and discouraging.
                0 -> buildString {
                    append("📱 ${fmtM(todayMin)} today · $pickups pickups")
                    if (streak > 0) append(" · ${streak}🔥 streak")
                }
                1 -> if (todayMin > goalMins) "😴 ${fmtM(overMin)} over goal — screens before bed affect sleep"
                else "😴 Goal achieved ✅ — screens off soon for better sleep"
                else -> if (streak > 0) "🔥 ${streak}-day streak — finish today strong"
                else "💪 Start a streak tomorrow — put the phone down now"
            }
        }
    }

    // ── Stats strip ───────────────────────────────────────────────────────────
    private fun populateStats(context: Context, views: RemoteViews) {
        runCatching {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

            val todayMin   = prefs.getLong(CACHED_TOTAL_MINS, 0L)
            val pickups    = prefs.getInt(CACHED_PICKUPS, 0)
            val streakDays = prefs.getInt(CACHED_STREAK_DAYS, 0)

            // Aurelo Score — written by JS (renderAureloScore) via N.setStringPref.
            // Show "--" if the app has not been opened today (stale date or missing).
            val todayStr      = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                .format(java.util.Date())
            val aureloScoreDate = prefs.getString("cached_tidy_score_date", "") ?: ""
            val aureloScoreRaw  = if (aureloScoreDate == todayStr)
                prefs.getString("cached_tidy_score", null)?.toIntOrNull() ?: -1
            else -1
            val aureloScoreDisp = if (aureloScoreRaw >= 0) aureloScoreRaw.toString() else "--"
            val aureloScoreColor = when {
                aureloScoreRaw >= 75 -> COLOR_GREEN
                aureloScoreRaw >= 60 -> COLOR_CYAN
                aureloScoreRaw >= 40 -> COLOR_AMBER
                aureloScoreRaw >= 0  -> COLOR_PINK
                else               -> COLOR_MUTED  // "--" state
            }

            // Slot 0 — Total screen time (unchanged)
            views.setTextViewText(R.id.widget_stat_val_0, fmtM(todayMin))
            // Slot 1 — Aurelo Score (replaces Pickups; Pickups moved to slot 3)
            views.setTextViewText(R.id.widget_stat_val_1, aureloScoreDisp)
            views.setTextColor(R.id.widget_stat_val_1, aureloScoreColor)
            views.setTextViewText(R.id.widget_stat_key_1, "AURELO SCORE")
            // Slot 2 — Screen time streak (unchanged)
            // BUG-06 FIX: was "${streakDays}🔥" unconditionally, showing "0🔥" for new users.
            views.setTextViewText(R.id.widget_stat_val_2, if (streakDays > 0) "${streakDays}🔥" else "–")
            // Slot 3 — Pickups (replaces First pickup time)
            views.setTextViewText(R.id.widget_stat_val_3, if (pickups > 0) pickups.toString() else "–")
            views.setTextViewText(R.id.widget_stat_key_3_view, "PICKUPS")

            // FUN-09 FIX: Staleness indicator — shows how old the cached data is.
            // During Doze mode WorkManager intervals can stretch to hours; this sets
            // correct user expectations rather than implying live data.
            val cachedTs  = prefs.getLong(WIDGET_RENDER_TS, 0L)
            val ageMillis = if (cachedTs > 0L) System.currentTimeMillis() - cachedTs else -1L
            val (label, colour) = when {
                ageMillis < 0L           -> "Updated just now"  to 0x88FFFFFF.toInt()  // no stamp yet
                ageMillis < 2 * 60_000L  -> "Updated just now"  to 0x88FFFFFF.toInt()  // < 2 min — grey
                ageMillis < 30 * 60_000L -> {
                    val mins = (ageMillis / 60_000L).toInt()
                    "Updated ${mins}m ago" to 0x88FFFFFF.toInt()  // grey
                }
                ageMillis < 60 * 60_000L -> {
                    val mins = (ageMillis / 60_000L).toInt()
                    "Updated ${mins}m ago" to 0xFFF7A623.toInt()  // amber — stale
                }
                else -> {
                    val hrs = (ageMillis / 3_600_000L).toInt()
                    "Updated ${hrs}h ago"  to 0xFFE05252.toInt()  // red — very stale
                }
            }
            views.setTextViewText(R.id.widget_last_updated, label)
            views.setTextColor(R.id.widget_last_updated, colour)
        }
    }

    // ── Clicks ────────────────────────────────────────────────────────────────
    private fun wireClicks(context: Context, views: RemoteViews, apps: List<String>, widgetId: Int) {
        // Insight bar → cycle message variant
        val cycleIntent = Intent(context, AureloWidgetProvider::class.java).apply {
            action = ACTION_CYCLE_INSIGHT
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        }
        views.setOnClickPendingIntent(R.id.widget_insight_bar,
            PendingIntent.getBroadcast(context, widgetId * 100 + 97, cycleIntent, pendingFlags()))

        // App slots → broadcast → record launch → open app
        val slotIds = listOf(R.id.widget_slot_0, R.id.widget_slot_1, R.id.widget_slot_2, R.id.widget_slot_3, R.id.widget_slot_4)
        for (i in 0..4) {
            val pkg = apps.getOrNull(i) ?: continue
            val launchIntent = Intent(context, AureloWidgetProvider::class.java).apply {
                action = ACTION_LAUNCH_APP
                putExtra(EXTRA_PACKAGE, pkg)
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            }
            views.setOnClickPendingIntent(slotIds[i],
                PendingIntent.getBroadcast(context, widgetId * 100 + i + 1, launchIntent, pendingFlags()))
        }

        // More → Aurelo home
        views.setOnClickPendingIntent(R.id.widget_more_btn,
            PendingIntent.getActivity(context, widgetId * 100 + 99,
                aureloIntent(context, ACTION_OPEN_HOME), pendingFlags()))

        // Stats strip → Wellness tab
        views.setOnClickPendingIntent(R.id.widget_st_row,
            PendingIntent.getActivity(context, widgetId * 100 + 98,
                aureloIntent(context, ACTION_OPEN_WELLNESS),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                else PendingIntent.FLAG_UPDATE_CURRENT))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private fun aureloIntent(context: Context, action: String?): Intent =
        Intent(context, MainActivity::class.java).apply {
            if (action != null) this.action = action
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

    private fun pendingFlags() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else PendingIntent.FLAG_UPDATE_CURRENT

    private fun scaledIcon(d: android.graphics.drawable.Drawable): Bitmap {
        val w = d.intrinsicWidth.takeIf  { it > 0 } ?: ICON_PX
        val h = d.intrinsicHeight.takeIf { it > 0 } ?: ICON_PX
        val raw = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, w, h); d.draw(Canvas(raw))
        // BUG-03 FIX: when scaling is needed the original 'raw' bitmap was never
        // recycled, leaking ~60 MB/hour on a 2-widget device with 5-min updates.
        return if (w == ICON_PX && h == ICON_PX) raw
        else Bitmap.createScaledBitmap(raw, ICON_PX, ICON_PX, true).also { raw.recycle() }
    }

    private fun fmtM(mins: Long): String {
        if (mins <= 0L) return "0m"
        val h = mins / 60L; val m = mins % 60L
        return when { h > 0L && m > 0L -> "${h}h ${m}m"; h > 0L -> "${h}h"; else -> "${m}m" }
    }
}