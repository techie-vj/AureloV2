package com.javikastudio.tidyapp

import android.animation.ValueAnimator
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * BedtimeBlockingEngine
 *
 * Owns: bedtime window checks, blocked-app overlay logic, snooze handling,
 * allow-window tracking, morning summary data snapshot, and prefs.
 */
class BedtimeBlockingEngine(
    private val prefs:       SharedPreferences,
    private val coordinator: AppMonitorService.OverlayCoordinator,
    private val h:           AppMonitorService.EngineHelpers
) {
    private val securePrefs: SharedPreferences by lazy { SensitivePrefs.get(h.context) }
    companion object {
        object PREFS_KEYS {
            const val BEDTIME_ENABLED      = "bedtime_enabled"
            const val BEDTIME_START_H      = "bedtime_start_hour"
            const val BEDTIME_START_M      = "bedtime_start_min"
            const val BEDTIME_END_H        = "bedtime_end_hour"
            const val BEDTIME_END_M        = "bedtime_end_min"
            const val BEDTIME_BLOCKED_APPS = "bedtime_blocked_apps"
            const val BEDTIME_WEEKDAYS     = "bedtime_weekdays"
            const val BEDTIME_DND          = "bedtime_dnd_enabled"
            const val BEDTIME_BRIGHTNESS   = "bedtime_brightness_enabled"
            const val BEDTIME_STREAK       = "bedtime_streak"
            const val BEDTIME_LAST_NIGHT   = "bedtime_last_night_stats"
            const val BEDTIME_SNOOZE_UNTIL = "bedtime_snooze_until"
        }
    }

    var isActive = false
        private set

    private var blockedPkgs      = emptySet<String>()
    private var blockedAppNames  = mapOf<String, String>()
    private var lastBlockedPkg   = ""
    private var lastBlockedTs    = 0L
    private var allowedPkg       = ""
    private var allowedUntilTs   = 0L
    private var snoozedUntilTs   = 0L
    private var allowedAppIsInFg = false

    // ── Public API ────────────────────────────────────────────────────────────

    fun start(intent: Intent) {
        val appsJson = intent.getStringExtra("blocked_apps")
        if (appsJson.isNullOrBlank() || appsJson == "[]") {
            isActive = true
            prefs.edit().putBoolean("bedtime_block_active", true).apply()
            return
        }
        parseBlockedApps(appsJson)
        if (blockedPkgs.isEmpty()) {
            isActive = true
            prefs.edit().putBoolean("bedtime_block_active", true).apply()
            return
        }

        if (!h.canDrawOverlay()) {
            runCatching {
                val pi = android.app.PendingIntent.getActivity(
                    h.context, 9010,
                    Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        android.net.Uri.parse("package:${h.packageName}"))
                        .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK },
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                        android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
                    else android.app.PendingIntent.FLAG_UPDATE_CURRENT
                )
                h.nm.notify(h.notifId + 4,
                    NotificationCompat.Builder(h.context, h.channelId)
                        .setSmallIcon(android.R.drawable.ic_dialog_alert).setColor(0xFF6C63FF.toInt())
                        .setContentTitle("🌙 Bedtime: one permission needed")
                        .setContentText("Tap to allow 'Display over other apps' so blocked apps show a screen overlay.")
                        .setContentIntent(pi).setAutoCancel(true)
                        .setPriority(NotificationCompat.PRIORITY_HIGH).build()
                )
            }
        }

        isActive = true
        prefs.edit().putBoolean("bedtime_block_active", true)
            .putString("bedtime_blocked_apps", appsJson).apply()
    }

    fun update(intent: Intent) {
        val appsJson = intent.getStringExtra("blocked_apps") ?: "[]"
        val cfg      = runCatching { JSONObject(BedtimePrefs.getSettings(h.context, prefs, securePrefs) ?: "{}") }.getOrElse { JSONObject() }
        val bedH     = cfg.optInt("bedHour", 22);  val bedM  = cfg.optInt("bedMinute", 0)
        val wakeH    = cfg.optInt("wakeHour", 7);  val wakeM = cfg.optInt("wakeMinute", 0)
        val cal      = java.util.Calendar.getInstance()
        val nowMins  = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        val bedMins  = bedH * 60 + bedM; val wakeMins = wakeH * 60 + wakeM
        val inWindow = if (bedMins > wakeMins) nowMins >= bedMins || nowMins < wakeMins
        else nowMins >= bedMins && nowMins < wakeMins
        if (!inWindow) { stop(); return }
        parseBlockedApps(appsJson)
        if (coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)) coordinator.forceRemove()
    }

    fun stopSoft() {
        isActive = false; blockedPkgs = emptySet(); blockedAppNames = emptyMap()
        allowedPkg = ""; allowedUntilTs = 0L; snoozedUntilTs = 0L; allowedAppIsInFg = false
        cancelSnoozeExpireAlarm()
        prefs.edit()
            .putBoolean("bedtime_block_active", false)
            .putBoolean(BEDTIME_ACTIVE, false)
            .putLong("bedtime_snooze_until_ts", 0L)
            .putBoolean("bedtime_filter_snoozed", false)
            .apply()

        val snoozeCount   = prefs.getInt("bedtime_snooze_count", 0)
        val attemptsTotal = sumAttempts()
        val attemptsJson  = BedtimePrefs.getAttempts(securePrefs)
        if (!prefs.getBoolean("bedtime_last_night_has_data", false)) {
            prefs.edit()
                .putInt    ("bedtime_last_night_snooze_count",              snoozeCount)
                .putInt    ("bedtime_last_night_attempts_total",            attemptsTotal)
                .putString (BEDTIME_LAST_NIGHT_ATTEMPTS_JSON, attemptsJson)
                .putBoolean("bedtime_last_night_kept",                      true)
                .putBoolean("bedtime_last_night_has_data",                  true)
                .putInt    (BEDTIME_LAST_NIGHT_IN_WINDOW_SCREEN_MINS, 0)
                .putBoolean(BEDTIME_LAST_NIGHT_SKIPPED_TONIGHT, false)
                .putBoolean(BEDTIME_LAST_NIGHT_FILTER_ACTIVE, false)
                .apply()
        }
        coordinator.forceRemove()
    }

    fun stop(wasNatural: Boolean = false) {
        isActive = false; blockedPkgs = emptySet(); blockedAppNames = emptyMap()
        allowedPkg = ""; allowedUntilTs = 0L; snoozedUntilTs = 0L; allowedAppIsInFg = false
        cancelSnoozeExpireAlarm()

        val snoozeCount       = prefs.getInt("bedtime_snooze_count", 0)
        val attemptsTotal     = sumAttempts()
        val attemptsJson      = BedtimePrefs.getAttempts(securePrefs)
        val alreadySnapshotted = prefs.getBoolean("bedtime_last_night_has_data", false)

        prefs.edit().apply {
            putBoolean("bedtime_block_active", false)
            putBoolean(BEDTIME_ACTIVE, false)
            putLong   ("bedtime_snooze_until_ts", 0L)
            putBoolean("bedtime_filter_snoozed", false)
            if (!wasNatural) putBoolean(BEDTIME_SKIPPED_TONIGHT, true)
            putString (BEDTIME_LAST_NIGHT_ATTEMPTS_JSON, attemptsJson)
            if (!alreadySnapshotted) {
                putInt    ("bedtime_last_night_snooze_count",              snoozeCount)
                putInt    ("bedtime_last_night_attempts_total",            attemptsTotal)
                putBoolean("bedtime_last_night_kept",                      wasNatural)
                putBoolean("bedtime_last_night_has_data",                  true)
                putInt    (BEDTIME_LAST_NIGHT_IN_WINDOW_SCREEN_MINS, 0)
                putBoolean(BEDTIME_LAST_NIGHT_SKIPPED_TONIGHT, !wasNatural)
                putBoolean(BEDTIME_LAST_NIGHT_FILTER_ACTIVE, false)
            }
            putInt   ("bedtime_snooze_count", 0)
        }.apply()
        BedtimePrefs.clearAttempts(securePrefs)
        coordinator.forceRemove()
    }

    fun snooze(mins: Int) {
        snoozedUntilTs = System.currentTimeMillis() + mins * 60_000L
        prefs.edit().putLong("bedtime_snooze_until_ts", snoozedUntilTs).apply()
        coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)
        val current = prefs.getInt("bedtime_snooze_count", 0)
        prefs.edit().putInt("bedtime_snooze_count", current + 1).apply()

        runCatching {
            val nm = h.context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (!nm.isNotificationPolicyAccessGranted) return@runCatching
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
        }

        runCatching {
            val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfg = if (!sfRaw.isNullOrBlank()) org.json.JSONObject(sfRaw) else org.json.JSONObject()
            if (sfCfg.optBoolean("bedtimeAutoApply", true)) {
                AppMonitorService.filterEngineInstance?.stop(fadeOut = false)
                prefs.edit().putBoolean("bedtime_filter_snoozed", true).apply()
            }
        }
        scheduleSnoozeExpireAlarm(snoozedUntilTs)
    }

    fun clearSnooze() {
        snoozedUntilTs = 0L
        prefs.edit().putLong("bedtime_snooze_until_ts", 0L).apply()
        restoreBedtimeFilter()
    }

    private fun scheduleSnoozeExpireAlarm(triggerAtMs: Long) {
        runCatching {
            val am = h.context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            val flags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M)
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            val pi = android.app.PendingIntent.getBroadcast(
                h.context, 7005,
                android.content.Intent("${h.packageName}.BEDTIME_SNOOZE_EXPIRE").apply { setPackage(h.packageName) },
                flags
            )
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M)
                am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMs, pi)
            else am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAtMs, pi)
        }
    }

    private fun cancelSnoozeExpireAlarm() {
        runCatching {
            val am = h.context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            val flags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M)
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_NO_CREATE
            else android.app.PendingIntent.FLAG_NO_CREATE
            val pi = android.app.PendingIntent.getBroadcast(
                h.context, 7005,
                android.content.Intent("${h.packageName}.BEDTIME_SNOOZE_EXPIRE").apply { setPackage(h.packageName) },
                flags
            )
            pi?.let { am.cancel(it) }
        }
    }

    fun restoreFromPrefs() {
        if (!prefs.getBoolean("bedtime_block_active", false)) return
        if (prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT, false)) {
            prefs.edit().putBoolean("bedtime_block_active", false).apply(); return
        }
        if (!isInBedtimeWindow()) {
            prefs.edit().putBoolean("bedtime_block_active", false).apply(); return
        }

        val appsJson: String = run {
            val direct = prefs.getString("bedtime_blocked_apps", null)
            if (!direct.isNullOrBlank() && direct != "[]") return@run direct
            val raw = BedtimePrefs.getSettings(h.context, prefs, securePrefs) ?: return
            val cfg = runCatching { JSONObject(raw) }.getOrNull() ?: return
            when (val v = cfg.opt("blockedApps")) {
                is JSONArray -> v.toString()
                is String    -> v.ifBlank { "[]" }
                else         -> "[]"
            }
        }
        parseBlockedApps(appsJson)

        val savedSnoozeUntil = prefs.getLong("bedtime_snooze_until_ts", 0L)
        val nowMs = System.currentTimeMillis()
        when {
            savedSnoozeUntil > nowMs -> snoozedUntilTs = savedSnoozeUntil
            savedSnoozeUntil > 0L -> {
                prefs.edit().putLong("bedtime_snooze_until_ts", 0L).apply()
                if (!prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT, false)) {
                    runCatching {
                        val nm = h.context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                        if (nm.isNotificationPolicyAccessGranted) nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
                    }
                }
            }
        }
        isActive = true
    }

    fun onDestroy() {}

    private fun isInBedtimeWindow(): Boolean {
        val cfg = runCatching { org.json.JSONObject(BedtimePrefs.getSettings(h.context, prefs, securePrefs) ?: "{}") }.getOrElse { org.json.JSONObject() }
        if (!cfg.optBoolean("enabled", false)) return false
        val bedH  = cfg.optInt("bedHour", 22); val bedM  = cfg.optInt("bedMinute", 0)
        val wakeH = cfg.optInt("wakeHour", 7); val wakeM = cfg.optInt("wakeMinute", 0)
        val cal      = java.util.Calendar.getInstance()
        val nowMins  = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        val bedMins  = bedH  * 60 + bedM
        val wakeMins = wakeH * 60 + wakeM
        return if (bedMins > wakeMins) nowMins >= bedMins || nowMins < wakeMins else nowMins >= bedMins && nowMins < wakeMins
    }

    fun onTick(currentFgPkg: String, now: Long): Boolean {
        if (!isActive) return coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)

        if (!isInBedtimeWindow()) { stop(wasNatural = true); return false }

        if (snoozedUntilTs > 0L) {
            if (now < snoozedUntilTs) {
                if (coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)) coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)
                return false
            } else {
                snoozedUntilTs = 0L
                prefs.edit().putLong("bedtime_snooze_until_ts", 0L).apply()
                runCatching {
                    val nm = h.context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    if (nm.isNotificationPolicyAccessGranted) nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
                }
                restoreBedtimeFilter()
                h.notifyJs("if(typeof window.onBedtimeSnoozeEnded==='function') window.onBedtimeSnoozeEnded()")
            }
        }

        if (coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)) return true

        if (currentFgPkg.isEmpty() || currentFgPkg == h.packageName) {
            if (allowedAppIsInFg) { allowedPkg = ""; allowedUntilTs = 0L; allowedAppIsInFg = false }
            return false
        }
        if (!blockedPkgs.contains(currentFgPkg)) return false
        if (currentFgPkg == allowedPkg && now < allowedUntilTs) { allowedAppIsInFg = true; return false }
        if (currentFgPkg == lastBlockedPkg && (now - lastBlockedTs) < 2000L) return false

        lastBlockedPkg = currentFgPkg; lastBlockedTs = now; allowedAppIsInFg = false
        val appName = blockedAppNames[currentFgPkg] ?: currentFgPkg.split(".").last()
        showOverlay(currentFgPkg, appName)
        return coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun showOverlay(pkg: String, appName: String) {
        if (!h.canDrawOverlay()) {
            runCatching { h.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:${h.packageName}")).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }) }
            showFallbackNotification(appName); return
        }
        h.vibrate(longArrayOf(0, 30, 20, 30))
        runCatching {
            val attempts = JSONObject(BedtimePrefs.getAttempts(securePrefs))
            attempts.put(pkg, attempts.optInt(pkg, 0) + 1)
            BedtimePrefs.setAttempts(securePrefs, attempts.toString())
        }
        val root  = buildBedtimeOverlayView(pkg, appName)
        val shown = coordinator.show(AppMonitorService.PRIORITY_BEDTIME, root)
        if (!shown) showFallbackNotification(appName)
    }

    private fun buildBedtimeOverlayView(pkg: String, appName: String): View {
        val ctx = h.context
        val animators = mutableListOf<ValueAnimator>()
        val metrics = ctx.resources.displayMetrics

        val root = FrameLayout(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF0F1225.toInt(), 0xFF04050A.toInt())
            )
        }

        // Parallax Stars (Increased count & distribution)
        val starsLayer = FrameLayout(ctx)
        val starsData = listOf(
            Triple(8f, 15f, 3000L) to 2f,
            Triple(12f, 80f, 4500L) to 1.5f,
            Triple(18f, 35f, 2800L) to 2f,
            Triple(25f, 10f, 5000L) to 1f,
            Triple(32f, 85f, 3800L) to 2.5f,
            Triple(40f, 25f, 4200L) to 1.5f,
            Triple(48f, 75f, 5500L) to 2f,
            Triple(55f, 15f, 6000L) to 1f,
            Triple(65f, 88f, 3500L) to 2f,
            Triple(75f, 20f, 4800L) to 1.5f,
            Triple(82f, 70f, 3200L) to 2f,
            Triple(90f, 40f, 4000L) to 1f
        )
        starsData.forEach { (posData, sizeDp) ->
            val star = View(ctx).apply {
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) }
            }
            val lp = FrameLayout.LayoutParams(h.dpToPx(sizeDp.toInt()), h.dpToPx(sizeDp.toInt()))
            lp.leftMargin = (metrics.widthPixels * posData.second / 100f).toInt()
            lp.topMargin = (metrics.heightPixels * posData.first / 100f).toInt()
            starsLayer.addView(star, lp)

            animators.add(ValueAnimator.ofFloat(0.2f, 0.8f).apply {
                duration = posData.third; repeatMode = ValueAnimator.REVERSE; repeatCount = ValueAnimator.INFINITE
                addUpdateListener {
                    val v = it.animatedValue as Float
                    star.alpha = v; star.scaleX = 0.8f + (v - 0.2f) * (1.2f - 0.8f) / 0.6f; star.scaleY = star.scaleX
                }
            })
        }
        root.addView(starsLayer, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // Top Logo + Subtitle ("BEDTIME MODE")
        val logoWrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }

        logoWrap.addView(h.buildAureloWordmarkView(), LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        logoWrap.addView(TextView(ctx).apply {
            text = "BEDTIME MODE"
            textSize = 10f
            letterSpacing = 0.2f
            setTextColor(Color.parseColor("#B6A0FF"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = h.dpToPx(4)
        })

        root.addView(logoWrap, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 52 else 36)
        })

        // Moon Group (Full Moon & Aura)
        val moonGroup = FrameLayout(ctx)
        val moonSize = h.dpToPx(126)
        val glowSize = h.dpToPx(320)

        // Massive soft background glow
        val glowView = View(ctx).apply {
            background = object : GradientDrawable() {
                init {
                    shape = OVAL
                    gradientType = RADIAL_GRADIENT
                    colors = intArrayOf(Color.parseColor("#33B6A0FF"), Color.TRANSPARENT)
                    gradientRadius = glowSize / 2f
                }
            }
        }
        moonGroup.addView(glowView, FrameLayout.LayoutParams(glowSize, glowSize).apply { gravity = Gravity.CENTER })

        // Pulsing inner aura
        val pulseAura = View(ctx).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#40B6A0FF")) }
        }
        moonGroup.addView(pulseAura, FrameLayout.LayoutParams(moonSize, moonSize).apply { gravity = Gravity.CENTER })

        animators.add(ValueAnimator.ofFloat(1f, 1.4f).apply {
            duration = 3000L; repeatMode = ValueAnimator.REVERSE; repeatCount = ValueAnimator.INFINITE
            addUpdateListener {
                val scale = it.animatedValue as Float
                pulseAura.scaleX = scale; pulseAura.scaleY = scale; pulseAura.alpha = 1f - (scale - 1f) * 2f
            }
        })

        // Full Moon (Professional, clean gradient)
        val fullMoon = View(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                gradientType = GradientDrawable.RADIAL_GRADIENT
                // Crisp, high-end lunar palette
                colors = intArrayOf(0xFFFFFFFF.toInt(), 0xFFEAE2FF.toInt(), 0xFFB6A0FF.toInt())
                gradientRadius = moonSize * 0.8f
                setGradientCenter(0.35f, 0.35f)
            }
        }
        moonGroup.addView(fullMoon, FrameLayout.LayoutParams(moonSize, moonSize).apply { gravity = Gravity.CENTER })

        animators.add(ValueAnimator.ofFloat(0f, -h.dpToPx(8).toFloat()).apply {
            duration = 4000L; repeatMode = ValueAnimator.REVERSE; repeatCount = ValueAnimator.INFINITE
            interpolator = android.view.animation.AccelerateDecelerateInterpolator()
            addUpdateListener { fullMoon.translationY = it.animatedValue as Float }
        })

        // Shifted down to add breathing room
        root.addView(moonGroup, FrameLayout.LayoutParams(glowSize, glowSize).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(160)
        })

        // Haze
        root.addView(View(ctx).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xFF050914.toInt(), Color.TRANSPARENT))
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, (metrics.heightPixels * 0.45f).toInt()).apply {
            gravity = Gravity.BOTTOM
        })

        // Bottom Stack
        val stack = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        }

        stack.addView(TextView(ctx).apply {
            text = "🌙 NIGHT PROTECTION"; textSize = 11f; setTextColor(0xFFEDF3FF.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(h.dpToPx(14), h.dpToPx(8), h.dpToPx(14), h.dpToPx(8))
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(100).toFloat()
                it.setColor(0x12FFFFFF); it.setStroke(1, 0x14FFFFFF)
            }
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(12) })

        stack.addView(TextView(ctx).apply {
            text = "Leave the night undisturbed"
            textSize = 26f; setTextColor(0xFFEDF3FF.toInt())
            gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setLineSpacing(0f, 1.1f)
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(8) })

        stack.addView(TextView(ctx).apply {
            text = "$appName is blocked for rest."
            textSize = 14f; setTextColor(Color.argb(153, 237, 243, 255)); gravity = Gravity.CENTER
            setLineSpacing(0f, 1.4f)
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(12) })

        val bedtimeCfg = runCatching { JSONObject(BedtimePrefs.getSettings(h.context, prefs, securePrefs) ?: "{}") }.getOrElse { JSONObject() }
        if (bedtimeCfg.optBoolean("morningSummary", true)) {
            val wakeHour   = bedtimeCfg.optInt("wakeHour", 7); val wakeMinute = bedtimeCfg.optInt("wakeMinute", 0)
            val calNow     = java.util.Calendar.getInstance()
            val nowMins    = calNow.get(java.util.Calendar.HOUR_OF_DAY) * 60 + calNow.get(java.util.Calendar.MINUTE)
            val remainMins = (((wakeHour * 60 + wakeMinute) - nowMins + 1440) % 1440).let { if (it == 0) 1440 else it }
            val h2 = remainMins / 60; val m = remainMins % 60
            val timeStr = when { h2 > 0 && m > 0 -> "${h2}h ${m}m"; h2 > 0 -> "${h2}h"; else -> "${m}m" }
            stack.addView(TextView(ctx).apply {
                text = "Your morning summary opens in $timeStr"
                textSize = 12f; setTextColor(Color.argb(120, 255, 170, 68)); gravity = Gravity.CENTER
            }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(40) })
        } else {
            (stack.getChildAt(stack.childCount - 1).layoutParams as? LinearLayout.LayoutParams)?.bottomMargin = h.dpToPx(40)
        }

        stack.addView(TextView(ctx).apply {
            text = "Put phone down"; textSize = 15f; setTextColor(0xFF050811.toInt())
            gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, h.dpToPx(16), 0, h.dpToPx(16))
            background = GradientDrawable().also { it.cornerRadius = h.dpToPx(20).toFloat(); it.setColor(Color.WHITE) }
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)
                runCatching { h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }) }
            }
        }, h.linearFill().also { it.bottomMargin = h.dpToPx(8) })

        stack.addView(TextView(ctx).apply {
            text = "Open anyway"; textSize = 15f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, h.dpToPx(16), 0, h.dpToPx(16))
            background = GradientDrawable().also { it.cornerRadius = h.dpToPx(20).toFloat(); it.setStroke(h.dpToPx(1), 0x1AFFFFFF) }
            setOnClickListener {
                allowedPkg       = pkg
                allowedUntilTs   = System.currentTimeMillis() + 5 * 60_000L
                allowedAppIsInFg = true
                lastBlockedPkg   = pkg; lastBlockedTs = System.currentTimeMillis()
                coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)
            }
        }, h.linearFill())

        root.addView(stack, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.BOTTOM
            leftMargin = h.dpToPx(24); rightMargin = h.dpToPx(24); bottomMargin = h.dpToPx(28)
        })

        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) { animators.forEach { it.start() } }
            override fun onViewDetachedFromWindow(v: View) { animators.forEach { it.cancel() } }
        })

        return root
    }

    private fun showFallbackNotification(appName: String) {
        h.nm.notify(h.notifId + 3, NotificationCompat.Builder(h.context, h.channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF6C63FF.toInt())
            .setContentTitle("🌙 Bedtime Mode")
            .setContentText("$appName is blocked during bedtime. Rest well.")
            .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).build())
    }

    private fun parseBlockedApps(json: String) {
        val arr   = runCatching { JSONArray(json) }.getOrElse { JSONArray() }
        val pkgs  = mutableSetOf<String>()
        val names = mutableMapOf<String, String>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val pkg = obj.optString("packageName").takeIf { it.isNotBlank() } ?: continue
            pkgs += pkg; names[pkg] = obj.optString("name", pkg.split(".").last())
        }
        blockedPkgs = pkgs; blockedAppNames = names
    }

    private fun restoreBedtimeFilter() {
        if (!prefs.getBoolean("bedtime_filter_snoozed", false)) return
        prefs.edit().putBoolean("bedtime_filter_snoozed", false).apply()
        runCatching {
            val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfg = if (!sfRaw.isNullOrBlank()) org.json.JSONObject(sfRaw) else org.json.JSONObject()
            if (!sfCfg.optBoolean("bedtimeAutoApply", true)) return@runCatching
            val presetKey = sfCfg.optString("bedtimePreset", "bedtime")
            val (warm, dim) = when (presetKey) {
                "soft"   -> Pair(40, 15)
                "medium" -> Pair(65, 30)
                else     -> Pair(80, 45)
            }
            AppMonitorService.filterEngineInstance?.start(warm, dim, gradual = false)
            prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
        }
    }

    private fun sumAttempts(): Int = runCatching {
        val obj  = JSONObject(BedtimePrefs.getAttempts(securePrefs))
        val keys = obj.keys(); var sum = 0
        while (keys.hasNext()) sum += obj.optInt(keys.next(), 0)
        sum
    }.getOrElse { 0 }
}