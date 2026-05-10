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

                // Start bedtime app blocking via Focus overlay service
                startBedtimeBlock(ctx, blockedPkgsJson)

                // Start screen filter — replaces old dimBrightness
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
                        startScreenFilter(ctx, warm, dim, gradual = sfCfg.optBoolean("fadeIn", true))
                    }
                }

                // BUG 8 FIX: Record only the bedtime-on timestamp here; streak
                // increment has moved to BEDTIME_OFF so it only fires when the
                // user actually completes the sleep window.
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
                    // FIX: also write bedtime_block_active (read by getBedtimeStreak isActive check)
                    // BedtimeHandler.start() only writes this when blocked apps are configured;
                    // without it isActive stays false and live snooze count is never served.
                    .putBoolean(BEDTIME_BLOCK_ACTIVE, true)
                    .apply()

                // FIX: Reset last-night snapshot guard and live counters so
                // tonight's data gets a fresh snapshot. Without this, the
                // bedtime_last_night_has_data flag from the previous night
                // permanently blocks all snapshot writes on night 2+, leaving
                // stale zeros in snoozeCount and appAttemptsTotal.
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

                // Stop screen filter (replaces old dimBrightness restore)
                runCatching<Unit> { stopScreenFilter(ctx) }

                // Stop bedtime app blocking
                stopBedtimeBlock(ctx)

                // BUG 8 FIX: Streak is now incremented HERE (bedtime end / morning)
                // instead of at bedtime start. Only count if bedtime_on_ts was
                // recorded (i.e. the BEDTIME_ON alarm actually fired), so manual
                // enable-then-immediately-disable doesn't earn a streak day.
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

                // Morning summary notification (bedOnTs already read above — reuse it)
                if (bedOnTs > 0) {
                    // Calculate duration from configured bed/wake hours — not wall clock.
                    // Wall clock is wrong when bedtime_on_ts is stale from a previous reschedule.
                    val bedH  = cfg.optInt("bedHour",    22)
                    val bedM  = cfg.optInt("bedMinute",  0)
                    val wakeH = cfg.optInt("wakeHour",   7)
                    val wakeM = cfg.optInt("wakeMinute", 0)

                    val bedTotalMins  = bedH  * 60 + bedM
                    val wakeTotalMins = wakeH * 60 + wakeM
                    // Handle overnight wrap (e.g. bed=22:00, wake=07:00 → 9h)
                    // and same-day window (e.g. bed=16:15, wake=17:30 → 1h15m)
                    val configuredDurationMins = if (wakeTotalMins > bedTotalMins)
                        wakeTotalMins - bedTotalMins          // same day: wake is after bed
                    else
                        (24 * 60 - bedTotalMins) + wakeTotalMins  // overnight: wraps midnight

                    val streak       = prefs.getInt(BEDTIME_STREAK, 0)
                    val snoozeCount      = prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
                    val appAttemptsJson  = BedtimePrefs.getAttempts(securePrefs)
                    postMorningSummary(ctx, configuredDurationMins, streak, snoozeCount, appAttemptsJson)
//                    prefs.edit()
//                        .putInt(BEDTIME_SNOOZE_COUNT, 0)
//                        .putString(BEDTIME_APP_ATTEMPTS, "{}")
//                        .apply()
                }

                prefs.edit()
                    .putBoolean(BEDTIME_ACTIVE,       false)
                    .putBoolean(BEDTIME_BLOCK_ACTIVE, false)  // keep in sync with BEDTIME_ON
                    .apply()

                // FIX (Issue 4 — snooze/summary): Write last-night snapshot directly in
                // BedtimeReceiver so it is persisted even when AppMonitorService is not running
                // (which happens when no blocked apps are configured — start() is skipped so
                // the service never starts, and its stop() that normally writes this snapshot
                // never runs). AppMonitorService.BedtimeHandler.stop() also writes these keys
                // when the service IS running — that's fine, it runs after this receiver and
                // its values take precedence since they include live overlay/snooze tracking.
                // Only write if bedtime_on_ts is set (bedtime actually activated this night).
                if (bedOnTs > 0L) {
                    val snoozeCount   = prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
                    val attemptsTotal = runCatching {
                        val obj = org.json.JSONObject(BedtimePrefs.getAttempts(securePrefs))
                        var sum = 0; val keys = obj.keys()
                        while (keys.hasNext()) { sum += obj.optInt(keys.next(), 0) }
                        sum
                    }.getOrElse { 0 }
                    // Only write if AppMonitorService hasn't already written it this session
                    // (AppMonitorService sets bedtime_block_active=false when it stops; we
                    // cleared it above so check bedtime_last_night_has_data as proxy).
                    if (!prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)) {
                        prefs.edit()
                            .putInt    (BEDTIME_LAST_NIGHT_SNOOZES,   snoozeCount)
                            .putInt    (BEDTIME_LAST_NIGHT_ATTEMPTS, attemptsTotal)
                            .putBoolean(BEDTIME_LAST_NIGHT_KEPT,           true)
                            .putBoolean(BEDTIME_LAST_NIGHT_HAS_DATA,       true)
                            .putInt    (BEDTIME_SNOOZE_COUNT,              0)
                            .apply()
                        BedtimePrefs.clearAttempts(securePrefs)
                    }
                }
                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_OFF", 7002)

                // Schedule filter fade-out notification 10 min after wake time
                // (only if fadeOut is enabled in screen filter config)
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

            "${ctx.packageName}.BEDTIME_WINDOWN" -> {
                postWindDownNotification(ctx)
                // Begin gradual screen filter fade-in 30 min before bedtime
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
                        startScreenFilter(ctx, warm, dim, gradual = true)
                    }
                }
                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_WINDOWN", 7003)
            }

            // ── Snooze expiry ─────────────────────────────────────────────────────────
            // SNOOZE FIX 3: This broadcast is fired by the alarm scheduled in
            // BedtimeBlockingEngine.scheduleSnoozeExpireAlarm().  It is the guaranteed
            // fallback for when AppMonitorService is killed during a snooze — onTick()
            // handles the happy-path but cannot run if the service is dead.
            "${ctx.packageName}.BEDTIME_SNOOZE_EXPIRE" -> {
                // Clear persisted snooze state regardless of window check, so stale
                // state never blocks the next night's snooze from working.
                prefs.edit().putLong(BEDTIME_SNOOZE_UNTIL_TS, 0L).apply()

                // Only re-enable DND if we are still inside the bedtime window.
                // (If the snooze somehow fired after wake-up time, leave DND off.)
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
                        // Re-enable DND
                        setDnd(ctx, true)
                        // ✅ Also restore grayscale if configured
                        val grayscale2 = cfg2.optBoolean("grayscale", true)
                        if (grayscale2) setGrayscale(ctx, true)

                        // SNOOZE-FILTER FIX: restart bedtime screen filter if it was
                        // paused for the snooze. clearSnooze() on the service also does
                        // this, but BedtimeBlockingEngine.restoreBedtimeFilter() only runs
                        // when the service is alive. This receiver path covers the case where
                        // AppMonitorService was killed during the snooze.
                        runCatching {
                            val sfRaw2 = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
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
                                android.util.Log.d("BedtimeReceiver", "SNOOZE_EXPIRE: screen filter restarted")
                            }
                        }

                        // Tell AppMonitorService to clear in-memory snooze and resume blocking.
                        // Uses a new action; AppMonitorService must handle ACTION_BEDTIME_SNOOZE
                        // by calling bedtimeEngine.clearSnooze().
                        runCatching {
                            val svcIntent = android.content.Intent(ctx, AppMonitorService::class.java).apply {
                                action = AppMonitorService.ACTION_BEDTIME_SNOOZE_CLEAR
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                                ctx.startForegroundService(svcIntent)
                            else
                                ctx.startService(svcIntent)
                        }
                        android.util.Log.d("BedtimeReceiver", "SNOOZE_EXPIRE: DND re-enabled, service notified")
                    } else {
                        android.util.Log.d("BedtimeReceiver", "SNOOZE_EXPIRE: outside window, DND left off")
                    }
                }
            }

            // ── Screen Filter schedule alarms ─────────────────────────────────────────
            // Fired by AlarmManager when BedtimeBridge.scheduleFilterAlarms() sets
            // FILTER_SCHEDULE_ON / FILTER_SCHEDULE_OFF exact alarms.

            "${ctx.packageName}.FILTER_SCHEDULE_ON" -> {
                val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null) ?: return
                val sfCfg = runCatching { org.json.JSONObject(sfRaw) }.getOrElse { return }
                // Only activate if filter is still enabled (user may have disabled it)
                if (!sfCfg.optBoolean("enabled", false)) return
                val warm    = sfCfg.optInt("warmAlpha", 80)
                val dim     = sfCfg.optInt("dimAlpha",  45)
                val gradual = sfCfg.optBoolean("fadeIn", true)
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
                startScreenFilter(ctx, warm, dim, gradual)
                rescheduleFilterAlarmForTomorrow(ctx, prefs, sfCfg,
                    "${ctx.packageName}.FILTER_SCHEDULE_ON", 7015, isStart = true)
                android.util.Log.d("BedtimeReceiver", "FILTER_SCHEDULE_ON: started filter warm=$warm dim=$dim")
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
                android.util.Log.d("BedtimeReceiver", "FILTER_SCHEDULE_OFF: stopped filter")
            }
        }
    }

    // ── Shared notification channel ───────────────────────────────────────────────
    // BUG-3 FIX: single helper, always IMPORTANCE_HIGH, so wind-down heads-up works
    // regardless of which notification posted first.  Android ignores subsequent
    // createNotificationChannel calls with a *lower* importance for the same ID, so
    // if postMorningSummary (formerly IMPORTANCE_DEFAULT) ran first, postWindDownNotification
    // (IMPORTANCE_HIGH) would silently inherit the lower level — no heads-up, no sound.
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

    /**
     * Reschedules a FILTER_SCHEDULE_ON or FILTER_SCHEDULE_OFF alarm for tomorrow
     * (or the next active day if day-of-week filtering is configured).
     * [isStart] = true → uses sunsetHour/schedStartHour; false → sunriseHour/schedEndHour.
     */
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
            if (isStart) {
                hour   = sfCfg.optInt("sunsetHour",  21)
                minute = sfCfg.optInt("sunsetMin",    0)
            } else {
                hour   = sfCfg.optInt("sunriseHour",  7)
                minute = sfCfg.optInt("sunriseMin",   0)
            }
        } else {
            if (isStart) {
                hour   = sfCfg.optInt("schedStartHour", 21)
                minute = sfCfg.optInt("schedStartMin",   0)
            } else {
                hour   = sfCfg.optInt("schedEndHour",    7)
                minute = sfCfg.optInt("schedEndMin",     0)
            }
        }

        // Day-of-week — schedDays is Sun-first [0..6]; Calendar.DAY_OF_WEEK 1=Sun..7=Sat
        val schedDaysArr = sfCfg.optJSONArray("schedDays")
        val activeDayIndices: List<Int> = if (schedDaysArr != null && schedDaysArr.length() == 7)
            (0 until 7).filter { schedDaysArr.optInt(it, 1) != 0 }
        else (0..6).toList() // all days active by default

        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, hour)
            set(java.util.Calendar.MINUTE,      minute)
            set(java.util.Calendar.SECOND,      0)
            set(java.util.Calendar.MILLISECOND, 0)
            add(java.util.Calendar.DAY_OF_YEAR, 1) // start from tomorrow
            // Advance to the next active day (max 7 steps to avoid infinite loop)
            var steps = 0
            while (steps < 7) {
                val calDayIdx = get(java.util.Calendar.DAY_OF_WEEK) - 1 // 0=Sun..6=Sat
                if (activeDayIndices.contains(calDayIdx)) break
                add(java.util.Calendar.DAY_OF_YEAR, 1)
                steps++
            }
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT

        val pi = android.app.PendingIntent.getBroadcast(
            ctx, requestCode,
            Intent(action).apply { setPackage(ctx.packageName) }, flags)

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        BedtimePrefs.setExactSafely(ctx, am, android.app.AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
        android.util.Log.d("BedtimeReceiver", "rescheduleFilterAlarm: $action at ${cal.time}")
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

        val bedHour   = cfg.optInt("bedHour", 22)
        val bedMinute = cfg.optInt("bedMinute", 0)   // BUG-2b FIX: was ignored, always 0
        val wakeHour  = cfg.optInt("wakeHour", 7)
        val wakeMinute = cfg.optInt("wakeMinute", 0) // BUG-2b FIX: was ignored, always 0
        val grayscale = cfg.optBoolean("grayscale", true)

        // BUG-2b FIX: previously targetHour was correct but the Calendar minute was
        // always set to `offsetMins` (0 for ON/OFF, 30 for WINDOWN).  For BEDTIME_ON
        // and BEDTIME_OFF the actual bedMinute/wakeMinute were never used, so all
        // rescheduled alarms fired at the top of the hour (e.g. 22:00 instead of 22:15).
        // For WINDOWN, 30 was used as the literal minute value, which is only coincidentally
        // correct when bedMinute==0 — for bedTime=22:15 the wind-down should be 21:45 not 21:30.
        val rawWindDownMins = bedHour * 60 + bedMinute - 30  // may go negative → handled below
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
            ?: listOf(0,1,2,3,4,5,6) // default: every day

        // JS days: 0=Sun…6=Sat, Calendar days: 1=Sun…7=Sat
        fun jsToCalDay(jsDay: Int) = jsDay + 1

        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, targetHour)
            set(java.util.Calendar.MINUTE, targetMinute)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
            add(java.util.Calendar.DAY_OF_YEAR, 1) // start from tomorrow
            // Walk forward until we land on an active day
            var steps = 0
            while (!activeDays.map { jsToCalDay(it) }.contains(get(java.util.Calendar.DAY_OF_WEEK)) && steps < 7) {
                add(java.util.Calendar.DAY_OF_YEAR, 1)
                steps++
            }
        }

        val flagImmutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT

        val pi = android.app.PendingIntent.getBroadcast(
            ctx, requestCode,
            Intent(action).apply {
                setPackage(ctx.packageName)
                putExtra("grayscale", grayscale)
            },
            flagImmutable
        )

        val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        if (!BedtimePrefs.setExactSafely(ctx, am, android.app.AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)) {
            android.util.Log.w("BedtimeReceiver", "Skipping bedtime reschedule; exact alarms unavailable")
        }
    }

    // ── DND ─────────────────────────────────────────────────────────────────────

    private fun setDnd(ctx: Context, enable: Boolean) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
                    as android.app.NotificationManager
            if (!nm.isNotificationPolicyAccessGranted) return
            nm.setInterruptionFilter(
                if (enable) android.app.NotificationManager.INTERRUPTION_FILTER_ALARMS
                else android.app.NotificationManager.INTERRUPTION_FILTER_ALL
            )
        }
    }

    // ── Grayscale ────────────────────────────────────────────────────────────────

    private fun setGrayscale(ctx: Context, enable: Boolean) {
        runCatching {
            android.provider.Settings.Secure.putInt(
                ctx.contentResolver, "display_daltonizer_enabled", if (enable) 1 else 0
            )
            android.provider.Settings.Secure.putInt(
                ctx.contentResolver, "display_daltonizer", 0   // 0 = grayscale
            )
        }
    }

    // ── Brightness ───────────────────────────────────────────────────────────────
    // Requires WRITE_SETTINGS (normal permission — manifest entry is sufficient,
    // no runtime dialog, but API 23+ needs Settings.System.canWrite() guard).

    private fun setBrightness(ctx: Context, value: Int) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                !android.provider.Settings.System.canWrite(ctx)) return
            // Disable auto-brightness so the manual value actually takes effect
            android.provider.Settings.System.putInt(
                ctx.contentResolver,
                android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE,
                android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
            )
            android.provider.Settings.System.putInt(
                ctx.contentResolver,
                android.provider.Settings.System.SCREEN_BRIGHTNESS,
                value.coerceIn(1, 255)
            )
        }
    }

    // ── Screen Filter helpers ─────────────────────────────────────────────────────

    private fun startScreenFilter(ctx: Context, warmAlpha: Int, dimAlpha: Int, gradual: Boolean) {
        val intent = Intent(ctx, AppMonitorService::class.java).apply {
            action = AppMonitorService.ACTION_FILTER_START
            putExtra("filter_warm",    warmAlpha)
            putExtra("filter_dim",     dimAlpha)
            putExtra("filter_gradual", gradual)
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

    // ── Bedtime app blocking (delegates to Focus overlay service) ────────────────

    private fun startBedtimeBlock(ctx: Context, blockedPkgsJson: String) {
        runCatching {
            if (blockedPkgsJson == "[]" || blockedPkgsJson.isBlank()) return
            val intent = Intent(ctx, AppMonitorService::class.java).apply {
                action = "START_BEDTIME"
                putExtra("blocked_apps", blockedPkgsJson)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ctx.startForegroundService(intent)
            else
                ctx.startService(intent)
        }
    }

    private fun stopBedtimeBlock(ctx: Context) {
        runCatching {
            val intent = Intent(ctx, AppMonitorService::class.java).apply {
                action = "STOP_BEDTIME"
            }
            // Must use startForegroundService on O+ — startService fails silently
            // when called from a BroadcastReceiver on a running foreground service
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ctx.startForegroundService(intent)
            else
                ctx.startService(intent)
        }
    }

    // ── Morning summary notification ─────────────────────────────────────────────

    private fun postMorningSummary(ctx: Context, durationMins: Int, streak: Int, snoozeCount: Int, appAttemptsJson: String) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
                    as android.app.NotificationManager
            // BUG-3 FIX: use shared helper so the channel is always IMPORTANCE_HIGH.
            // Previously each method created "tidyalerts" independently — postMorningSummary
            // used IMPORTANCE_DEFAULT while postWindDownNotification used IMPORTANCE_HIGH.
            // Android only honours the *first* createNotificationChannel call per channel ID,
            // so whichever ran first locked in the lower importance for the other.
            ensureAlertChannel(ctx, nm)

            val h      = durationMins / 60
            val m      = durationMins % 60
            val durStr = when {
                h > 0 && m > 0 -> "${h}h ${m}m"
                h > 0           -> "${h}h"
                else            -> "${m}m"
            }

            // Streak line — show for any streak including first night
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

            // Parse attempts map and build readable string
            val attemptsMap = runCatching { org.json.JSONObject(appAttemptsJson) }.getOrElse { org.json.JSONObject() }

            val pm = ctx.packageManager
            val entries = attemptsMap.keys().asSequence().map { pkg ->
                val count = attemptsMap.optInt(pkg, 0)
                val name  = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg.split(".").last())
                Pair(name, count)
            }.sortedByDescending { it.second }.toList()

            val totalAttempts = entries.sumOf { it.second }

            val appLine = if (entries.isEmpty()) {
                ""
            } else {
                val parts = entries.map { (name, count) ->
                    if (count == 1) name else "$name × $count"
                }
                when {
                    parts.size == 1 -> "You reached for ${parts[0]}."
                    parts.size == 2 -> "You reached for ${parts[0]} and ${parts[1]}."
                    else            -> "You reached for ${parts.dropLast(1).joinToString(", ")} and ${parts.last()}."
                }
            }

            val disturbanceLine = when {
                snoozeCount == 0 && totalAttempts == 0 ->
                    "DND kept you undisturbed all night. 😴"
                snoozeCount == 0 && totalAttempts > 0 ->
                    "DND stayed on, but $appLine"
                snoozeCount == 1 && totalAttempts == 0 ->
                    "DND was lifted once during the night."
                snoozeCount == 1 && totalAttempts > 0 ->
                    "DND was lifted once. $appLine"
                snoozeCount > 1 && totalAttempts == 0 ->
                    "DND was lifted $snoozeCount times during the night."
                else ->
                    "DND was lifted $snoozeCount times. $appLine"
            }

            val body = buildString {
                append("Bedtime mode ran for $durStr. ")
                append(disturbanceLine)
                if (streakLine.isNotEmpty()) { append("\n"); append(streakLine) }
            }

            val notif = androidx.core.app.NotificationCompat.Builder(ctx, "tidyalerts")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setColor(0xFF6C63FF.toInt())
                .setContentTitle("Good morning ☀️")
                .setContentText(body)
                .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .build()
            nm.notify(7004, notif)
        }
    }

    // ── Wind-down reminder ────────────────────────────────────────────────────────

    private fun postWindDownNotification(ctx: Context) {
        runCatching {
            val prefs = ctx.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
            val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfg = if (!sfRaw.isNullOrBlank())
                runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
            val filterOn = sfCfg?.optBoolean("bedtimeAutoApply", true) == true &&
                    sfCfg?.optBoolean("fadeIn", true) == true

            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
                    as android.app.NotificationManager
            ensureAlertChannel(ctx, nm)

            val builder = androidx.core.app.NotificationCompat.Builder(ctx, "tidyalerts")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setColor(0xFF6C63FF.toInt())
                .setContentTitle("🌙 Bedtime in 30 minutes")
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)

            if (filterOn) {
                val presetKey = sfCfg?.optString("bedtimePreset", "bedtime") ?: "bedtime"
                val presetLabel = presetKey.replaceFirstChar { it.uppercaseChar() }
                builder
                    .setContentText("Screen filter fading in gradually · $presetLabel preset by bedtime")
                    .setStyle(
                        androidx.core.app.NotificationCompat.BigTextStyle()
                            .bigText(
                                "Screen filter is fading in now 🌅\n" +
                                        "Blue light + dim will reach $presetLabel intensity at bedtime.\n" +
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
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
                    as android.app.NotificationManager
            ensureAlertChannel(ctx, nm)
            val notif = androidx.core.app.NotificationCompat.Builder(ctx, "tidyalerts")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setColor(0xFF12D48A.toInt())
                .setContentTitle("🌄 Good morning!")
                .setContentText("Screen filter fading off. Full brightness restored in a moment.")
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .build()
            nm.notify(7005, notif)
        }
    }

}