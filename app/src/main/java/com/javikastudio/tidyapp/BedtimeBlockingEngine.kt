package com.javikastudio.tidyapp

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
import android.widget.ImageView
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
 *
 * Extracted from AppMonitorService.BedtimeHandler (Phase 5 full refactor).
 * Receives an [AppMonitorService.EngineHelpers] bundle for all service-owned
 * utilities — never touches AppMonitorService fields directly.
 */
class BedtimeBlockingEngine(
    private val prefs:       SharedPreferences,
    private val coordinator: AppMonitorService.OverlayCoordinator,
    private val h:           AppMonitorService.EngineHelpers
) {
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
            android.util.Log.d("BedtimeEngine", "start: no blocked apps, bedtime active but no overlay")
            isActive = true
            prefs.edit().putBoolean("bedtime_block_active", true).apply()
            return
        }
        parseBlockedApps(appsJson)
        android.util.Log.d("BedtimeEngine", "start: parsed ${blockedPkgs.size} blocked pkgs")
        if (blockedPkgs.isEmpty()) {
            android.util.Log.w("BedtimeEngine", "start: parseBlockedApps produced empty set — check JSON")
            return
        }

        if (!h.canDrawOverlay()) {
            android.util.Log.w("BedtimeEngine", "start: DISPLAY_OVER_OTHER_APPS not granted")
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

        // Re-evaluate whether we're still inside the window using the new config
        val cfg      = runCatching { JSONObject(prefs.getString("bedtime_settings_v1", null) ?: "{}") }.getOrElse { JSONObject() }
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

    /**
     * Soft stop — deactivates overlay blocking and clears in-memory state but
     * does NOT wipe bedtime_snooze_count / bedtime_app_attempts live counters.
     * Snapshots them for the morning summary if not already done.
     */
    fun stopSoft() {
        isActive = false; blockedPkgs = emptySet(); blockedAppNames = emptyMap()
        allowedPkg = ""; allowedUntilTs = 0L; snoozedUntilTs = 0L; allowedAppIsInFg = false

        val snoozeCount   = prefs.getInt("bedtime_snooze_count", 0)
        val attemptsTotal = sumAttempts()
        if (!prefs.getBoolean("bedtime_last_night_has_data", false)) {
            prefs.edit()
                .putInt    ("bedtime_last_night_snooze_count",    snoozeCount)
                .putInt    ("bedtime_last_night_attempts_total",  attemptsTotal)
                .putBoolean("bedtime_last_night_kept",            true)
                .putBoolean("bedtime_last_night_has_data",        true)
                .apply()
        }
        coordinator.forceRemove()
    }

    fun stop(wasNatural: Boolean = false) {
        isActive = false; blockedPkgs = emptySet(); blockedAppNames = emptyMap()
        allowedPkg = ""; allowedUntilTs = 0L; snoozedUntilTs = 0L; allowedAppIsInFg = false

        val snoozeCount       = prefs.getInt("bedtime_snooze_count", 0)
        val attemptsTotal     = sumAttempts()
        val alreadySnapshotted = prefs.getBoolean("bedtime_last_night_has_data", false)

        prefs.edit().apply {
            putBoolean("bedtime_block_active", false)
            putLong   ("bedtime_snooze_until_ts", 0L)
            if (!alreadySnapshotted) {
                putInt    ("bedtime_last_night_snooze_count",   snoozeCount)
                putInt    ("bedtime_last_night_attempts_total", attemptsTotal)
                putBoolean("bedtime_last_night_kept",           wasNatural)
                putBoolean("bedtime_last_night_has_data",       true)
            }
            putInt   ("bedtime_snooze_count", 0)
            putString("bedtime_app_attempts", "{}")
        }.apply()
        coordinator.forceRemove()
    }

    fun snooze(mins: Int) {
        snoozedUntilTs = System.currentTimeMillis() + mins * 60_000L
        prefs.edit().putLong("bedtime_snooze_until_ts", snoozedUntilTs).apply()
        coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)

        val current = prefs.getInt("bedtime_snooze_count", 0)
        prefs.edit().putInt("bedtime_snooze_count", current + 1).apply()

        // Turn DND off for the snooze window
        runCatching {
            val nm = h.context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (!nm.isNotificationPolicyAccessGranted) return@runCatching
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
        }

        // SNOOZE FIX 1: schedule a guaranteed alarm so DND re-enables and overlay
        // blocking resumes when the snooze expires — even if AppMonitorService is
        // killed in the meantime.  onTick() handles the happy-path when the service
        // is alive; this alarm is the fallback for killed/restarted service.
        scheduleSnoozeExpireAlarm(snoozedUntilTs)

        android.util.Log.d("BedtimeEngine", "snooze: paused for $mins min until $snoozedUntilTs")
    }

    /**
     * Called by AppMonitorService when it receives ACTION_BEDTIME_SNOOZE_EXPIRE
     * (sent by BedtimeReceiver after the alarm fires).
     * Clears in-memory snooze state so onTick() resumes normal blocking immediately.
     */
    fun clearSnooze() {
        snoozedUntilTs = 0L
        prefs.edit().putLong("bedtime_snooze_until_ts", 0L).apply()
        android.util.Log.d("BedtimeEngine", "clearSnooze: snooze state cleared by receiver alarm")
    }

    private fun scheduleSnoozeExpireAlarm(triggerAtMs: Long) {
        runCatching {
            val am = h.context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            val flags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M)
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            else
                android.app.PendingIntent.FLAG_UPDATE_CURRENT
            val pi = android.app.PendingIntent.getBroadcast(
                h.context, 7005,
                android.content.Intent("${h.packageName}.BEDTIME_SNOOZE_EXPIRE")
                    .apply { setPackage(h.packageName) },
                flags
            )
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M)
                am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMs, pi)
            else
                am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAtMs, pi)
            android.util.Log.d("BedtimeEngine", "scheduleSnoozeExpireAlarm: set for $triggerAtMs")
        }
    }

    fun restoreFromPrefs() {
        if (!prefs.getBoolean("bedtime_block_active", false)) return
        // BUG-4 FIX: validate we are still inside the bedtime window before restoring.
        // Without this check, a service restart (e.g. after device reboot) outside bedtime
        // hours would read the stale bedtime_block_active=true flag and immediately start
        // blocking apps, even at 2 PM.
        if (!isInBedtimeWindow()) {
            android.util.Log.d("BedtimeEngine", "restoreFromPrefs: outside window, clearing stale active flag")
            prefs.edit().putBoolean("bedtime_block_active", false).apply()
            return
        }

        val appsJson: String = run {
            val direct = prefs.getString("bedtime_blocked_apps", null)
            if (!direct.isNullOrBlank() && direct != "[]") return@run direct
            val raw = prefs.getString("bedtime_settings_v1", null) ?: return
            val cfg = runCatching { JSONObject(raw) }.getOrNull() ?: return
            when (val v = cfg.opt("blockedApps")) {
                is JSONArray -> v.toString()
                is String    -> v.ifBlank { "[]" }
                else         -> "[]"
            }
        }
        parseBlockedApps(appsJson)

        // SNOOZE FIX 2: restore in-memory snooze state from prefs so that a
        // service restart mid-snooze (Android killing and restarting the foreground
        // service) doesn't immediately fire the overlay again.
        val savedSnoozeUntil = prefs.getLong("bedtime_snooze_until_ts", 0L)
        val nowMs = System.currentTimeMillis()
        when {
            savedSnoozeUntil > nowMs -> {
                // Still inside the snooze window — restore the timestamp.
                // DND is already off (snooze() disabled it before the restart).
                snoozedUntilTs = savedSnoozeUntil
                android.util.Log.d("BedtimeEngine",
                    "restoreFromPrefs: snooze active, ${(savedSnoozeUntil - nowMs) / 1000}s remaining")
            }
            savedSnoozeUntil > 0L -> {
                // Snooze expired while the service was dead — the backup alarm should
                // have fired BedtimeReceiver.BEDTIME_SNOOZE_EXPIRE which re-enabled DND,
                // but call setDnd here as a belt-and-suspenders guard in case the alarm
                // was also missed (e.g. device was off the entire time).
                prefs.edit().putLong("bedtime_snooze_until_ts", 0L).apply()
                runCatching {
                    val nm = h.context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    if (nm.isNotificationPolicyAccessGranted)
                        nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
                }
                android.util.Log.d("BedtimeEngine", "restoreFromPrefs: snooze was expired, DND re-enabled")
            }
        }

        isActive = true
    }

    fun onDestroy() { /* coordinator handles view removal */ }

    // ── Private: bedtime-window check ────────────────────────────────────────────
    // BUG-4 FIX: onTick() had no time-window guard.  If the BEDTIME_OFF alarm was
    // missed (device off, delayed delivery) the engine stayed active indefinitely,
    // blocking apps all morning.  restoreFromPrefs() had the same problem — after a
    // reboot outside bedtime hours it re-activated blocking immediately.
    private fun isInBedtimeWindow(): Boolean {
        val cfg = runCatching {
            org.json.JSONObject(prefs.getString("bedtime_settings_v1", null) ?: "{}")
        }.getOrElse { org.json.JSONObject() }
        if (!cfg.optBoolean("enabled", false)) return false
        val bedH  = cfg.optInt("bedHour",    22); val bedM  = cfg.optInt("bedMinute",  0)
        val wakeH = cfg.optInt("wakeHour",   7);  val wakeM = cfg.optInt("wakeMinute", 0)
        val cal      = java.util.Calendar.getInstance()
        val nowMins  = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        val bedMins  = bedH  * 60 + bedM
        val wakeMins = wakeH * 60 + wakeM
        return if (bedMins > wakeMins) nowMins >= bedMins || nowMins < wakeMins
        else nowMins >= bedMins && nowMins < wakeMins
    }

    /**
     * Called each poll tick. Returns true if bedtime overlay is active/shown this tick.
     */
    fun onTick(currentFgPkg: String, now: Long): Boolean {
        if (!isActive) return coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)

        // BUG-4 FIX: auto-stop if we have drifted outside the bedtime window.
        // Covers: missed BEDTIME_OFF alarm, manual time changes, next-day service survival.
        if (!isInBedtimeWindow()) {
            android.util.Log.d("BedtimeEngine", "onTick: outside window — auto-stopping")
            stop(wasNatural = true)
            return false
        }

        // Snooze check
        if (snoozedUntilTs > 0L) {
            if (now < snoozedUntilTs) {
                if (coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME))
                    coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)
                return false
            } else {
                snoozedUntilTs = 0L
                prefs.edit().putLong("bedtime_snooze_until_ts", 0L).apply()
                runCatching {
                    val nm = h.context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    if (nm.isNotificationPolicyAccessGranted)
                        nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
                }
                h.notifyJs("if(typeof window.onBedtimeSnoozeEnded==='function') window.onBedtimeSnoozeEnded()")
            }
        }

        if (coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)) return true

        if (currentFgPkg.isEmpty() || currentFgPkg == h.packageName) {
            if (allowedAppIsInFg) { allowedPkg = ""; allowedUntilTs = 0L; allowedAppIsInFg = false }
            return false
        }
        if (!blockedPkgs.contains(currentFgPkg)) return false

        if (currentFgPkg == allowedPkg && now < allowedUntilTs) {
            allowedAppIsInFg = true; return false
        }
        if (currentFgPkg == lastBlockedPkg && (now - lastBlockedTs) < 2000L) return false

        lastBlockedPkg   = currentFgPkg; lastBlockedTs = now; allowedAppIsInFg = false
        val appName = blockedAppNames[currentFgPkg] ?: currentFgPkg.split(".").last()
        showOverlay(currentFgPkg, appName)
        return coordinator.isShowing(AppMonitorService.PRIORITY_BEDTIME)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun showOverlay(pkg: String, appName: String) {
        if (!h.canDrawOverlay()) {
            runCatching {
                h.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:${h.packageName}"))
                    .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
            }
            showFallbackNotification(appName); return
        }
        h.vibrate(longArrayOf(0, 30, 20, 30))
        runCatching {
            val attempts = JSONObject(prefs.getString("bedtime_app_attempts", "{}") ?: "{}")
            attempts.put(pkg, attempts.optInt(pkg, 0) + 1)
            prefs.edit().putString("bedtime_app_attempts", attempts.toString()).apply()
        }
        val root  = buildBedtimeOverlayView(pkg, appName)
        val shown = coordinator.show(AppMonitorService.PRIORITY_BEDTIME, root)
        if (!shown) showFallbackNotification(appName)
    }

    private fun buildBedtimeOverlayView(pkg: String, appName: String): View {
        val ctx    = h.context
        val accent = 0xFF6C63FF.toInt()

        val root = FrameLayout(ctx).apply {
            setBackgroundColor(Color.rgb(10, 8, 5)); clipChildren = false; clipToPadding = false
        }

        // Ambient amber glow blob
        val auraBlob = View(ctx).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.argb(18, 255, 170, 68), Color.TRANSPARENT)
            ).also { it.cornerRadius = 9999f }
        }
        root.addView(auraBlob, FrameLayout.LayoutParams(h.dpToPx(320), h.dpToPx(220)).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; topMargin = -h.dpToPx(60)
        })

        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(h.dpToPx(32), h.dpToPx(16), h.dpToPx(32), h.dpToPx(16))
        }

        // Aurelo wordmark header
        root.addView(h.buildAureloWordmarkView(), FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity   = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 52 else 36)
        })

        // Mode title
        root.addView(TextView(ctx).apply {
            text = "Bedtime Mode"; textSize = 19f
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
            setTextColor(Color.argb(230, 255, 243, 220)); gravity = Gravity.CENTER; letterSpacing = 0.05f
        }, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity   = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = h.dpToPx(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 88 else 72)
        })

        col.addView(TextView(ctx).apply {
            text = appName; textSize = 22f; setTextColor(0xFFEEEEFF.toInt())
            gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL)
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(8) })

        col.addView(TextView(ctx).apply {
            text = "You set a bedtime. Your future self thanks you."
            textSize = 14f; setTextColor(Color.argb(153, 255, 243, 220))
            gravity = Gravity.CENTER; setLineSpacing(0f, 1.4f)
        }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(12) })

        // Morning summary countdown line
        val bedtimeCfg = runCatching { JSONObject(prefs.getString("bedtime_settings_v1", null) ?: "{}") }
            .getOrElse { JSONObject() }
        if (bedtimeCfg.optBoolean("morningSummary", true)) {
            val wakeHour   = if (bedtimeCfg.has("wakeHour"))   bedtimeCfg.getInt("wakeHour")   else 7
            val wakeMinute = if (bedtimeCfg.has("wakeMinute")) bedtimeCfg.getInt("wakeMinute") else 0
            val calNow     = java.util.Calendar.getInstance()
            val nowMins    = calNow.get(java.util.Calendar.HOUR_OF_DAY) * 60 + calNow.get(java.util.Calendar.MINUTE)
            val wakeMin    = wakeHour * 60 + wakeMinute
            val remainMins = ((wakeMin - nowMins + 1440) % 1440).let { if (it == 0) 1440 else it }
            val h2 = remainMins / 60; val m = remainMins % 60
            val timeStr = when { h2 > 0 && m > 0 -> "${h2}h ${m}m"; h2 > 0 -> "${h2}h"; else -> "${m}m" }
            col.addView(TextView(ctx).apply {
                text = "☀️ Morning summary ready in $timeStr"
                textSize = 12f; setTextColor(Color.argb(120, 255, 170, 68)); gravity = Gravity.CENTER
            }, h.linearWrap(Gravity.CENTER_HORIZONTAL).also { it.bottomMargin = h.dpToPx(40) })
        } else {
            (col.getChildAt(col.childCount - 1).layoutParams as? LinearLayout.LayoutParams)
                ?.bottomMargin = h.dpToPx(40)
        }

        // Primary: put phone down
        col.addView(TextView(ctx).apply {
            text = "Put phone down 🌙"; textSize = 14f; setTextColor(0xFF060610.toInt())
            gravity = Gravity.CENTER; setPadding(h.dpToPx(24), h.dpToPx(15), h.dpToPx(24), h.dpToPx(15))
            background = GradientDrawable().also { it.cornerRadius = h.dpToPx(14).toFloat(); it.setColor(accent) }
            setOnClickListener {
                coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)
                runCatching {
                    h.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
                }
            }
        }, h.linearFill().also { it.bottomMargin = h.dpToPx(10) })

        // Secondary: open anyway (soft — bedtime is gentle, not an addiction block)
        col.addView(TextView(ctx).apply {
            text = "Open anyway"; textSize = 13f; setTextColor(Color.argb(120, 255, 243, 220))
            gravity = Gravity.CENTER; setPadding(h.dpToPx(24), h.dpToPx(13), h.dpToPx(24), h.dpToPx(13))
            background = GradientDrawable().also {
                it.cornerRadius = h.dpToPx(14).toFloat()
                it.setColor(Color.argb(20, 255, 255, 255))
                it.setStroke(1, Color.argb(30, 255, 255, 255))
            }
            setOnClickListener {
                allowedPkg       = pkg
                allowedUntilTs   = System.currentTimeMillis() + 5 * 60_000L
                allowedAppIsInFg = true
                lastBlockedPkg   = pkg; lastBlockedTs = System.currentTimeMillis()
                coordinator.dismiss(AppMonitorService.PRIORITY_BEDTIME)
            }
        }, h.linearFill())

        root.addView(col, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.CENTER })
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

    private fun sumAttempts(): Int = runCatching {
        val obj  = JSONObject(prefs.getString("bedtime_app_attempts", "{}") ?: "{}")
        val keys = obj.keys(); var sum = 0
        while (keys.hasNext()) sum += obj.optInt(keys.next(), 0)
        sum
    }.getOrElse { 0 }
}