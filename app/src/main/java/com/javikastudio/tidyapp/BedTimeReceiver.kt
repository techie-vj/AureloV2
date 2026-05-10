package com.javikastudio.tidyapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BedtimeReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val prefs = ctx.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
        val securePrefs = SensitivePrefs.get(ctx)

        when (intent.action) {
            "${ctx.packageName}.BEDTIME_ON" -> {
                val raw = BedtimePrefs.getSettings(ctx, prefs, securePrefs)
                val cfg = try { org.json.JSONObject(raw ?: "{}") } catch (e: Exception) { org.json.JSONObject() }
                val grayscale = cfg.optBoolean("grayscale", true)
                val blockedPkgsJson = when (val raw = cfg.opt("blockedApps")) {
                    is org.json.JSONArray -> raw.toString()
                    is String             -> raw
                    else                  -> "[]"
                }

                setDnd(ctx, true)
                if (grayscale) setGrayscale(ctx, true)

                startBedtimeBlock(ctx, blockedPkgsJson)

                // ISSUE-1 FIX: clear wind-down start timestamp — bedtime has now started
                // so the foreground notification should switch to bedtime-active mode.
                prefs.edit().putLong(BEDTIME_WINDOWN_START_TS, 0L).apply()

                // Start screen filter at full intensity (wind-down already faded it in).
                // If the wind-down ran, the filter is already active at target intensity;
                // starting it again with gradual=false just re-confirms the final value.
                runCatching {
                    val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                    val sfCfg = if (!sfRaw.isNullOrBlank()) org.json.JSONObject(sfRaw) else org.json.JSONObject()
                    if (sfCfg.optBoolean("bedtimeAutoApply", true)) {
                        val presetKey = sfCfg.optString("bedtimePreset", "bedtime")
                        val (warm, dim) = when (presetKey) {
                            "soft"   -> Pair(40, 15)
                            "medium" -> Pair(65, 30)
                            else     -> Pair(80, 45)
                        }
                        // gradual=false: either the wind-down already handled fading,
                        // or the user skipped wind-down and wants immediate intensity.
                        startScreenFilter(ctx, warm, dim, gradual = false)
                    }
                }

                prefs.edit()
                    .putLong(BEDTIME_ON_TS, System.currentTimeMillis())
                    .apply()

                // Week-days: record which day of week bedtime fired (0=Sun … 6=Sat)
                runCatching {
                    val weekFmt = java.text.SimpleDateFormat("yyyy-'W'ww", java.util.Locale.US)
                    val weekId  = weekFmt.format(java.util.Date())
                    val storedWeekId = prefs.getString(BEDTIME_WEEK_ID, "")
                    val base = if (storedWeekId == weekId)
                        prefs.getString(BEDTIME_WEEK_DAYS, "[false,false,false,false,false,false,false]")
                            ?: "[false,false,false,false,false,false,false]"
                    else
                        "[false,false,false,false,false,false,false]"
                    val dayIdx = java.util.Calendar.getInstance().get(java.util.Calendar.DAY_OF_WEEK) - 1
                    val arr = org.json.JSONArray(base)
                    arr.put(dayIdx, true)
                    prefs.edit()
                        .putString(BEDTIME_WEEK_ID,   weekId)
                        .putString(BEDTIME_WEEK_DAYS, arr.toString())
                        .apply()
                }

                prefs.edit()
                    .putBoolean(BEDTIME_ACTIVE,       true)
                    .putBoolean(BEDTIME_BLOCK_ACTIVE, true)
                    .apply()

                // Reset last-night snapshot guard and live counters for tonight's fresh data
                prefs.edit()
                    .putBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)
                    .putInt(BEDTIME_SNOOZE_COUNT, 0)
                    .apply()
                BedtimePrefs.clearAttempts(securePrefs)
                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_ON", 7001)
            }

            "${ctx.packageName}.BEDTIME_OFF" -> {
                val raw = BedtimePrefs.getSettings(ctx, prefs, securePrefs)
                val cfg = try { org.json.JSONObject(raw ?: "{}") } catch (e: Exception) { org.json.JSONObject() }
                val grayscale = cfg.optBoolean("grayscale", true)

                setDnd(ctx, false)
                if (grayscale) setGrayscale(ctx, false)

                runCatching<Unit> { stopScreenFilter(ctx) }
                stopBedtimeBlock(ctx)

                val bedOnTs = prefs.getLong(BEDTIME_ON_TS, 0L)
                if (bedOnTs > 0L) {
                    val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                        .format(java.util.Date())
                    val lastDate = prefs.getString(BEDTIME_STREAK_LAST_DATE, null)
                    if (lastDate != today) {
                        val yesterday = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                            .format(java.util.Date(System.currentTimeMillis() - 86_400_000L))
                        val prevStreak = prefs.getInt(BEDTIME_STREAK, 0)
                        val newStreak  = if (lastDate == yesterday) prevStreak + 1 else 1
                        prefs.edit()
                            .putInt(BEDTIME_STREAK, newStreak)
                            .putString(BEDTIME_STREAK_LAST_DATE, today)
                            .apply()
                    }
                }

                // Morning summary notification
                if (bedOnTs > 0) {
                    val bedH  = cfg.optInt("bedHour",    22); val bedM  = cfg.optInt("bedMinute",  0)
                    val wakeH = cfg.optInt("wakeHour",   7);  val wakeM = cfg.optInt("wakeMinute", 0)
                    val bedTotalMins  = bedH  * 60 + bedM
                    val wakeTotalMins = wakeH * 60 + wakeM
                    val configuredDurationMins = if (wakeTotalMins > bedTotalMins)
                        wakeTotalMins - bedTotalMins
                    else
                        (24 * 60 - bedTotalMins) + wakeTotalMins

                    val streak = prefs.getInt(BEDTIME_STREAK, 0)

                    // ISSUE-5 FIX: AppMonitorService.bedtimeEngine.stop() may have already run,
                    // clearing BEDTIME_SNOOZE_COUNT and wiping the attempts secure pref.
                    // When it ran, it wrote a snapshot — read from there instead so the
                    // morning summary always shows the correct snooze count and app names.
                    val alreadySnapshotted = prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)
                    val snoozeCount = if (alreadySnapshotted)
                        prefs.getInt(BEDTIME_LAST_NIGHT_SNOOZES, 0)
                    else
                        prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
                    val appAttemptsJson = if (alreadySnapshotted)
                        prefs.getString(BEDTIME_LAST_NIGHT_ATTEMPTS_JSON, "{}") ?: "{}"
                    else
                        BedtimePrefs.getAttempts(securePrefs)

                    postMorningSummary(ctx, configuredDurationMins, streak, snoozeCount, appAttemptsJson)
                }

                prefs.edit()
                    .putBoolean(BEDTIME_ACTIVE,       false)
                    .putBoolean(BEDTIME_BLOCK_ACTIVE, false)
                    .apply()

                // Write last-night snapshot from the receiver path (for when AppMonitorService
                // was not running — e.g. no blocked apps configured, so the engine never started).
                if (bedOnTs > 0L) {
                    if (!prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)) {
                        val snoozeCountR   = prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
                        val attemptsJson   = BedtimePrefs.getAttempts(securePrefs)
                        val attemptsTotal  = runCatching {
                            val obj = org.json.JSONObject(attemptsJson)
                            var sum = 0; val keys = obj.keys()
                            while (keys.hasNext()) { sum += obj.optInt(keys.next(), 0) }
                            sum
                        }.getOrElse { 0 }
                        prefs.edit()
                            .putInt    (BEDTIME_LAST_NIGHT_SNOOZES,         snoozeCountR)
                            .putInt    (BEDTIME_LAST_NIGHT_ATTEMPTS,         attemptsTotal)
                            .putString (BEDTIME_LAST_NIGHT_ATTEMPTS_JSON,    attemptsJson)
                            .putBoolean(BEDTIME_LAST_NIGHT_KEPT,             true)
                            .putBoolean(BEDTIME_LAST_NIGHT_HAS_DATA,         true)
                            .putInt    (BEDTIME_SNOOZE_COUNT,                0)
                            .apply()
                        BedtimePrefs.clearAttempts(securePrefs)
                    }
                }
                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_OFF", 7002)

                // Schedule filter fade-out notification 10 min after wake time
                runCatching {
                    val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                    val sfCfg = if (!sfRaw.isNullOrBlank()) org.json.JSONObject(sfRaw) else org.json.JSONObject()
                    if (sfCfg.optBoolean("fadeOut", true) && sfCfg.optBoolean("bedtimeAutoApply", true)) {
                        val pi = android.app.PendingIntent.getBroadcast(
                            ctx, 7005,
                            Intent("${ctx.packageName}.BEDTIME_WAKEUP_FADE"),
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                        )
                        val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
                        val triggerAt = System.currentTimeMillis() + 10 * 60 * 1000L
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms()) {
                            am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
                        } else {
                            am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
                        }
                    }
                }
            }

            // ── Wake filter fade-out: fires 10 min after wake time ─────────────────────
            "${ctx.packageName}.BEDTIME_WAKEUP_FADE" -> {
                runCatching { stopScreenFilter(ctx) }
                postWakeFilterFadeNotification(ctx)
            }

            // ── Wind-down (30 min before bedtime) ─────────────────────────────────────
            "${ctx.packageName}.BEDTIME_WINDOWN" -> {
                // ISSUE-1 FIX: record when wind-down started so the foreground service
                // notification can display a live intensity progress bar for the 30-min fade.
                prefs.edit().putLong(BEDTIME_WINDOWN_START_TS, System.currentTimeMillis()).apply()

                postWindDownNotification(ctx)

                runCatching {
                    val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                    val sfCfg = if (!sfRaw.isNullOrBlank()) org.json.JSONObject(sfRaw) else org.json.JSONObject()
                    if (sfCfg.optBoolean("bedtimeAutoApply", true) && sfCfg.optBoolean("fadeIn", true)) {
                        val presetKey = sfCfg.optString("bedtimePreset", "bedtime")
                        val (warm, dim) = when (presetKey) {
                            "soft"   -> Pair(40, 15)
                            "medium" -> Pair(65, 30)
                            else     -> Pair(80, 45)
                        }
                        // ISSUE-1 FIX: calculate per-step duration so the full fade fills
                        // exactly 30 minutes (1,800,000 ms ÷ maxAlpha steps = ms/step).
                        // e.g. for preset "bedtime" (warm=80): 1,800,000 / 80 = 22,500 ms/step
                        // This replaces the previous fast ~20-second fade.
                        val maxAlpha = maxOf(warm, dim, 1)
                        val stepMs   = (30L * 60_000L) / maxAlpha
                        startScreenFilter(ctx, warm, dim, gradual = true, stepMs = stepMs)
                    }
                }
                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_WINDOWN", 7003)
            }

            // ── Snooze expiry ─────────────────────────────────────────────────────────
            "${ctx.packageName}.BEDTIME_SNOOZE_EXPIRE" -> {
                prefs.edit().putLong(BEDTIME_SNOOZE_UNTIL_TS, 0L).apply()

                val raw2 = BedtimePrefs.getSettings(ctx, prefs, securePrefs)
                val cfg2 = try { org.json.JSONObject(raw2 ?: "{}") } catch (_: Exception) { org.json.JSONObject() }
                if (cfg2.optBoolean("enabled", false)) {
                    val bedH2  = cfg2.optInt("bedHour",   22); val bedM2  = cfg2.optInt("bedMinute",  0)
                    val wakeH2 = cfg2.optInt("wakeHour",   7); val wakeM2 = cfg2.optInt("wakeMinute", 0)
                    val cal2   = java.util.Calendar.getInstance()
                    val nowM2  = cal2.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal2.get(java.util.Calendar.MINUTE)
                    val bedMins2  = bedH2  * 60 + bedM2
                    val wakeMins2 = wakeH2 * 60 + wakeM2
                    val inWindow2 = if (bedMins2 > wakeMins2) nowM2 >= bedMins2 || nowM2 < wakeMins2
                    else nowM2 >= bedMins2 && nowM2 < wakeMins2
                    if (inWindow2) {
                        setDnd(ctx, true)
                        val grayscale2 = cfg2.optBoolean("grayscale", true)
                        if (grayscale2) setGrayscale(ctx, true)

                        runCatching {
                            val sfRaw2  = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                            val sfCfg2b = if (!sfRaw2.isNullOrBlank())
                                runCatching { org.json.JSONObject(sfRaw2) }.getOrNull() else null
                            if (prefs.getBoolean("bedtime_filter_snoozed", false) &&
                                sfCfg2b?.optBoolean("bedtimeAutoApply", true) == true) {
                                prefs.edit().putBoolean("bedtime_filter_snoozed", false).apply()
                                val presetKey2 = sfCfg2b.optString("bedtimePreset", "bedtime")
                                val (warm2, dim2) = when (presetKey2) {
                                    "soft"   -> Pair(40, 15)
                                    "medium" -> Pair(65, 30)
                                    else     -> Pair(80, 45)
                                }
                                startScreenFilter(ctx, warm2, dim2, gradual = false)
                                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
                            }
                        }

                        runCatching {
                            val svcIntent = android.content.Intent(ctx, AppMonitorService::class.java).apply {
                                action = AppMonitorService.ACTION_BEDTIME_SNOOZE_CLEAR
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                                ctx.startForegroundService(svcIntent)
                            else
                                ctx.startService(svcIntent)
                        }
                    }
                }
            }

            // ── Screen Filter schedule alarms ─────────────────────────────────────────

            "${ctx.packageName}.FILTER_SCHEDULE_ON" -> {
                val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null) ?: return
                val sfCfg = runCatching { org.json.JSONObject(sfRaw) }.getOrElse { return }
                if (!sfCfg.optBoolean("enabled", false)) return
                val warm    = sfCfg.optInt("warmAlpha", 80)
                val dim     = sfCfg.optInt("dimAlpha",  45)
                val gradual = sfCfg.optBoolean("fadeIn", true)
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
                startScreenFilter(ctx, warm, dim, gradual)
                rescheduleFilterAlarmForTomorrow(ctx, prefs, sfCfg,
                    "${ctx.packageName}.FILTER_SCHEDULE_ON", 7015, isStart = true)
            }

            "${ctx.packageName}.FILTER_SCHEDULE_OFF" -> {
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
                stopScreenFilter(ctx)
                val sfRaw2 = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                val sfCfg2 = if (!sfRaw2.isNullOrBlank())
                    runCatching { org.json.JSONObject(sfRaw2) }.getOrNull() else null
                if (sfCfg2 != null) {
                    rescheduleFilterAlarmForTomorrow(ctx, prefs, sfCfg2,
                        "${ctx.packageName}.FILTER_SCHEDULE_OFF", 7016, isStart = false)
                }
            }
        }
    }

    // ── Shared notification channel ───────────────────────────────────────────────

    private fun ensureAlertChannel(ctx: Context, nm: android.app.NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                android.app.NotificationChannel(
                    "tidyalerts", "Aurelo Smart Alerts",
                    android.app.NotificationManager.IMPORTANCE_HIGH
                ).apply { description = "Bedtime and smart usage alerts" }
            )
        }
    }

    // ── Reschedule (exact alarm for tomorrow) ────────────────────────────────────

    private fun rescheduleFilterAlarmForTomorrow(
        ctx: Context,
        prefs: android.content.SharedPreferences,
        sfCfg: org.json.JSONObject,
        action: String,
        requestCode: Int,
        isStart: Boolean
    ) {
        if (!sfCfg.optBoolean("enabled", false)) return
        val schedule = sfCfg.optString("schedule", "none")
        if (schedule == "none" || schedule.isBlank()) return

        val hour: Int; val minute: Int
        if (schedule == "sun") {
            if (!sfCfg.has("sunsetHour") || !sfCfg.has("sunriseHour")) return
            if (isStart) { hour = sfCfg.optInt("sunsetHour", 21); minute = sfCfg.optInt("sunsetMin", 0) }
            else         { hour = sfCfg.optInt("sunriseHour", 7); minute = sfCfg.optInt("sunriseMin", 0) }
        } else {
            if (isStart) { hour = sfCfg.optInt("schedStartHour", 21); minute = sfCfg.optInt("schedStartMin", 0) }
            else         { hour = sfCfg.optInt("schedEndHour", 7);    minute = sfCfg.optInt("schedEndMin", 0) }
        }

        val schedDaysArr = sfCfg.optJSONArray("schedDays")
        val activeDayIndices: List<Int> = if (schedDaysArr != null && schedDaysArr.length() == 7)
            (0 until 7).filter { schedDaysArr.optInt(it, 1) != 0 }
        else (0..6).toList()

        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, hour); set(java.util.Calendar.MINUTE, minute)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
            add(java.util.Calendar.DAY_OF_YEAR, 1)
            var steps = 0
            while (steps < 7) {
                if (activeDayIndices.contains(get(java.util.Calendar.DAY_OF_WEEK) - 1)) break
                add(java.util.Calendar.DAY_OF_YEAR, 1); steps++
            }
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT

        val pi = android.app.PendingIntent.getBroadcast(
            ctx, requestCode, Intent(action).apply { setPackage(ctx.packageName) }, flags)
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        BedtimePrefs.setExactSafely(ctx, am, android.app.AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
    }

    private fun rescheduleForTomorrow(
        ctx: Context,
        prefs: android.content.SharedPreferences,
        action: String,
        requestCode: Int
    ) {
        val raw = BedtimePrefs.getSettings(ctx, prefs, SensitivePrefs.get(ctx)) ?: return
        val cfg = try { org.json.JSONObject(raw) } catch (e: Exception) { return }
        if (!cfg.optBoolean("enabled", false)) return

        val bedHour    = cfg.optInt("bedHour",    22); val bedMinute  = cfg.optInt("bedMinute",  0)
        val wakeHour   = cfg.optInt("wakeHour",    7); val wakeMinute = cfg.optInt("wakeMinute", 0)
        val grayscale  = cfg.optBoolean("grayscale", true)

        val rawWindDownMins = bedHour * 60 + bedMinute - 30
        val targetHour = when {
            action.endsWith("BEDTIME_ON")      -> bedHour
            action.endsWith("BEDTIME_OFF")     -> wakeHour
            action.endsWith("BEDTIME_WINDOWN") -> ((rawWindDownMins / 60 + 24) % 24)
            else -> return
        }
        val targetMinute = when {
            action.endsWith("BEDTIME_ON")      -> bedMinute
            action.endsWith("BEDTIME_OFF")     -> wakeMinute
            action.endsWith("BEDTIME_WINDOWN") -> ((rawWindDownMins % 60 + 60) % 60)
            else -> 0
        }

        val activeDays = cfg.optJSONArray("activeDays")
            ?.let { arr -> (0 until arr.length()).map { arr.getInt(it) } }
            ?.takeIf { it.isNotEmpty() }
            ?: listOf(0,1,2,3,4,5,6)

        fun jsToCalDay(jsDay: Int) = jsDay + 1

        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, targetHour); set(java.util.Calendar.MINUTE, targetMinute)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
            add(java.util.Calendar.DAY_OF_YEAR, 1)
            var steps = 0
            while (!activeDays.map { jsToCalDay(it) }.contains(get(java.util.Calendar.DAY_OF_WEEK)) && steps < 7) {
                add(java.util.Calendar.DAY_OF_YEAR, 1); steps++
            }
        }

        val flagImmutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT

        val pi = android.app.PendingIntent.getBroadcast(
            ctx, requestCode,
            Intent(action).apply { setPackage(ctx.packageName); putExtra("grayscale", grayscale) },
            flagImmutable
        )

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        BedtimePrefs.setExactSafely(ctx, am, android.app.AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────

    private fun setDnd(ctx: Context, enable: Boolean) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            if (!nm.isNotificationPolicyAccessGranted) return
            nm.setInterruptionFilter(
                if (enable) android.app.NotificationManager.INTERRUPTION_FILTER_ALARMS
                else android.app.NotificationManager.INTERRUPTION_FILTER_ALL
            )
        }
    }

    private fun setGrayscale(ctx: Context, enable: Boolean) {
        runCatching {
            android.provider.Settings.Secure.putInt(ctx.contentResolver, "display_daltonizer_enabled", if (enable) 1 else 0)
            android.provider.Settings.Secure.putInt(ctx.contentResolver, "display_daltonizer", 0)
        }
    }

    /**
     * Starts the screen filter via AppMonitorService.
     *
     * @param stepMs  Per-step fade interval in ms. 0 = use engine default (~80 ms → fast ~20 s fade).
     *                Pass (30 * 60_000L / maxAlpha) for the bedtime wind-down 30-min fade.
     */
    private fun startScreenFilter(
        ctx: Context,
        warmAlpha: Int,
        dimAlpha: Int,
        gradual: Boolean,
        stepMs: Long = 0L
    ) {
        val intent = Intent(ctx, AppMonitorService::class.java).apply {
            action = AppMonitorService.ACTION_FILTER_START
            putExtra("filter_warm",    warmAlpha)
            putExtra("filter_dim",     dimAlpha)
            putExtra("filter_gradual", gradual)
            // Only include step_ms if non-default; 0 means "use engine default"
            if (stepMs > 0L) putExtra("filter_step_ms", stepMs)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ctx.startForegroundService(intent)
        else
            ctx.startService(intent)
    }

    private fun stopScreenFilter(ctx: Context) {
        val intent = Intent(ctx, AppMonitorService::class.java).apply {
            action = AppMonitorService.ACTION_FILTER_STOP
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ctx.startForegroundService(intent)
        else
            ctx.startService(intent)
    }

    private fun startBedtimeBlock(ctx: Context, blockedPkgsJson: String) {
        runCatching {
            if (blockedPkgsJson == "[]" || blockedPkgsJson.isBlank()) return
            val intent = Intent(ctx, AppMonitorService::class.java).apply {
                action = "START_BEDTIME"; putExtra("blocked_apps", blockedPkgsJson)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
            else ctx.startService(intent)
        }
    }

    private fun stopBedtimeBlock(ctx: Context) {
        runCatching {
            val intent = Intent(ctx, AppMonitorService::class.java).apply { action = "STOP_BEDTIME" }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
            else ctx.startService(intent)
        }
    }

    // ── Notifications ─────────────────────────────────────────────────────────────

    private fun postMorningSummary(
        ctx: Context,
        durationMins: Int,
        streak: Int,
        snoozeCount: Int,
        appAttemptsJson: String
    ) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            ensureAlertChannel(ctx, nm)

            val h = durationMins / 60; val m = durationMins % 60
            val durStr = when { h > 0 && m > 0 -> "${h}h ${m}m"; h > 0 -> "${h}h"; else -> "${m}m" }

            val streakLine = when {
                streak >= 30 -> "🏆 $streak night streak — you've mastered your sleep!"
                streak >= 25 -> "💎 $streak night streak — almost a month of great sleep!"
                streak >= 20 -> "🌟 $streak night streak — exceptional discipline!"
                streak >= 15 -> "🔥 $streak night streak — two weeks strong, unstoppable!"
                streak >= 10 -> "⚡ $streak night streak — double digits, you're on fire!"
                streak >= 7  -> "🔥 $streak night streak — a full week, incredible!"
                streak >= 3  -> "🔥 $streak night streak — keep it up!"
                streak == 2  -> "✨ 2 night streak — you're building a habit!"
                streak == 1  -> "⭐ First night done — great start!"
                else         -> ""
            }

            val attemptsMap = runCatching { org.json.JSONObject(appAttemptsJson) }.getOrElse { org.json.JSONObject() }
            val pm = ctx.packageManager
            val entries = attemptsMap.keys().asSequence().map { pkg ->
                val count = attemptsMap.optInt(pkg, 0)
                val name  = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg.split(".").last())
                Pair(name, count)
            }.sortedByDescending { it.second }.toList()
            val totalAttempts = entries.sumOf { it.second }

            val appLine = when {
                entries.isEmpty() -> ""
                entries.size == 1 -> "You reached for ${if (entries[0].second == 1) entries[0].first else "${entries[0].first} × ${entries[0].second}"}."
                entries.size == 2 -> "You reached for ${entries[0].first} and ${entries[1].first}."
                else              -> "You reached for ${entries.dropLast(1).joinToString(", ") { it.first }} and ${entries.last().first}."
            }

            val disturbanceLine = when {
                snoozeCount == 0 && totalAttempts == 0 -> "DND kept you undisturbed all night. 😴"
                snoozeCount == 0 && totalAttempts > 0  -> "DND stayed on, but $appLine"
                snoozeCount == 1 && totalAttempts == 0 -> "DND was lifted once during the night."
                snoozeCount == 1 && totalAttempts > 0  -> "DND was lifted once. $appLine"
                snoozeCount > 1 && totalAttempts == 0  -> "DND was lifted $snoozeCount times during the night."
                else                                    -> "DND was lifted $snoozeCount times. $appLine"
            }

            val body = buildString {
                append("Bedtime mode ran for $durStr. "); append(disturbanceLine)
                if (streakLine.isNotEmpty()) { append("\n"); append(streakLine) }
            }

            nm.notify(7004, androidx.core.app.NotificationCompat.Builder(ctx, "tidyalerts")
                .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF6C63FF.toInt())
                .setContentTitle("Good morning ☀️").setContentText(body)
                .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true).build())
        }
    }

    private fun postWindDownNotification(ctx: Context) {
        runCatching {
            val prefs = ctx.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
            val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfg = if (!sfRaw.isNullOrBlank()) runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
            val filterOn = sfCfg?.optBoolean("bedtimeAutoApply", true) == true &&
                           sfCfg?.optBoolean("fadeIn", true) == true

            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            ensureAlertChannel(ctx, nm)

            val builder = androidx.core.app.NotificationCompat.Builder(ctx, "tidyalerts")
                .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF6C63FF.toInt())
                .setContentTitle("🌙 Bedtime in 30 minutes")
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)

            if (filterOn) {
                val presetKey   = sfCfg?.optString("bedtimePreset", "bedtime") ?: "bedtime"
                val presetLabel = presetKey.replaceFirstChar { it.uppercaseChar() }
                // ISSUE-1 FIX: updated copy to reflect the 30-min gradual fade (not "already at full")
                builder
                    .setContentText("Screen filter fading in gradually · $presetLabel preset by bedtime")
                    .setStyle(
                        androidx.core.app.NotificationCompat.BigTextStyle()
                            .bigText(
                                "Screen filter is fading in now 🌅\n" +
                                "Warm tone + dim will gradually reach $presetLabel intensity over 30 minutes.\n" +
                                "Tap to adjust."
                            )
                    )
            } else {
                builder.setContentText("Time to wrap up and wind down.")
            }

            nm.notify(7003, builder.build())
        }
    }

    private fun postWakeFilterFadeNotification(ctx: Context) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            ensureAlertChannel(ctx, nm)
            nm.notify(7005, androidx.core.app.NotificationCompat.Builder(ctx, "tidyalerts")
                .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(0xFF12D48A.toInt())
                .setContentTitle("🌄 Good morning!")
                .setContentText("Screen filter fading off. Full brightness restored in a moment.")
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true).build())
        }
    }
}
