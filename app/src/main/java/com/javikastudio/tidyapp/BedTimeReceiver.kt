package com.javikastudio.tidyapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BedtimeReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val prefs       = ctx.getSharedPreferences("tidyapp_v6", Context.MODE_PRIVATE)
        val securePrefs = SensitivePrefs.get(ctx)

        when (intent.action) {

            // ── BEDTIME_ON ────────────────────────────────────────────────────
            "${ctx.packageName}.BEDTIME_ON" -> {
                val raw = BedtimePrefs.getSettings(ctx, prefs, securePrefs)
                val cfg = try { org.json.JSONObject(raw ?: "{}") } catch (_: Exception) { org.json.JSONObject() }
                val blockedPkgsJson = when (val v = cfg.opt("blockedApps")) {
                    is org.json.JSONArray -> v.toString()
                    is String             -> v
                    else                  -> "[]"
                }

                // BM-016 FIX: only activate DND when the user has enabled the DND toggle
                // in bedtime settings.  Previously setDnd(ctx, true) was unconditional.
                if (cfg.optBoolean("dndEnabled", true)) setDnd(ctx, true)

                startBedtimeBlock(ctx, blockedPkgsJson)

                // Clear wind-down state — bedtime has now started.
                prefs.edit()
                    .putLong(BEDTIME_WINDOWN_START_TS, 0L)
                    .putLong(BEDTIME_WINDOWN_SNOOZE_UNTIL_TS, 0L)
                    // BUG-2 FIX: clear the exact bedtime epoch; it is no longer needed
                    // now that bedtime has started (the wind-down countdown is gone).
                    .putLong(BEDTIME_STARTS_AT_MS, 0L)
                    .apply()

                // Dismiss the old static wind-down notification (ID 7003) if it somehow persists
                runCatching {
                    (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                        .cancel(7003)
                }

                // CB-017 FIX: save the user's pre-bedtime filter state only if it hasn't
                // already been saved by the BEDTIME_WINDOWN handler (which fires 30 min earlier).
                if (!prefs.contains(SCREEN_FILTER_PRE_BEDTIME_STATE)) {
                    savePreBedtimeFilterState(prefs)
                }

                // Bring filter to full intensity instantly (wind-down already faded it in).
                // CB-014 FIX: gate the bedtime auto-filter behind IS_PRO_USER so free users
                // can never get the automatic bedtime screen filter.
                runCatching {
                    val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                    val sfCfg = if (!sfRaw.isNullOrBlank())
                        runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
                    val isProUser = prefs.getBoolean(IS_PRO_USER, false)
                    if (isProUser && sfCfg?.optBoolean("bedtimeAutoApply", true) != false) {
                        val (warm, dim) = presetAlpha(sfCfg)
                        val preset  = sfCfg?.optString("bedtimePreset", ScreenFilterEngine.PRESET_WARM) ?: ScreenFilterEngine.PRESET_WARM
                        val customR = sfCfg?.optInt("bedtimeCustomR", 255) ?: 255
                        val customG = sfCfg?.optInt("bedtimeCustomG", 100) ?: 100
                        val customB = sfCfg?.optInt("bedtimeCustomB", 0)   ?: 0
                        startScreenFilter(ctx, warm, dim, gradual = false,
                            preset = preset, customR = customR, customG = customG, customB = customB)
                    }
                }

                prefs.edit()
                    .putLong(BEDTIME_ON_TS, System.currentTimeMillis())
                    .putBoolean(BEDTIME_ACTIVE, true)
                    .putBoolean(BEDTIME_BLOCK_ACTIVE, true)
                    // Reset live counters for tonight's fresh session
                    .putBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)
                    .putInt(BEDTIME_SNOOZE_COUNT, 0)
                    // FIX: clear "skipped tonight" flag set by notification Turn Off —
                    // a new bedtime night has started so the UI should show Bedtime Active.
                    .putBoolean(BEDTIME_SKIPPED_TONIGHT, false)
                    .apply()
                BedtimePrefs.clearAttempts(securePrefs)

                // Week-days tracking
                runCatching {
                    val weekFmt  = java.text.SimpleDateFormat("yyyy-'W'ww", java.util.Locale.US)
                    val weekId   = weekFmt.format(java.util.Date())
                    val storedId = prefs.getString(BEDTIME_WEEK_ID, "")
                    val base     = if (storedId == weekId)
                        prefs.getString(BEDTIME_WEEK_DAYS, "[false,false,false,false,false,false,false]")
                            ?: "[false,false,false,false,false,false,false]"
                    else "[false,false,false,false,false,false,false]"
                    val dayIdx = java.util.Calendar.getInstance().get(java.util.Calendar.DAY_OF_WEEK) - 1
                    val arr    = org.json.JSONArray(base); arr.put(dayIdx, true)
                    prefs.edit().putString(BEDTIME_WEEK_ID, weekId).putString(BEDTIME_WEEK_DAYS, arr.toString()).apply()
                }

                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_ON", 7001)
            }

            // ── BEDTIME_OFF ───────────────────────────────────────────────────
            "${ctx.packageName}.BEDTIME_OFF" -> {
                val raw = BedtimePrefs.getSettings(ctx, prefs, securePrefs)
                val cfg = try { org.json.JSONObject(raw ?: "{}") } catch (_: Exception) { org.json.JSONObject() }

                setDnd(ctx, false)
                runCatching<Unit> { stopScreenFilter(ctx) }
                stopBedtimeBlock(ctx)

                // BM-028 FIX: read BEDTIME_ON_TS before anything clears it.
                // BEDTIME_ON_TS is reset to 0 at the END of this handler so that if
                // tomorrow night BEDTIME_ON never fires, bedOnTs will be 0 here.
                val bedOnTs = prefs.getLong(BEDTIME_ON_TS, 0L)

                // BM-024 FIX: when bedOnTs == 0 BEDTIME_ON never fired this session →
                // the user missed bedtime → reset the streak to 0.
                if (bedOnTs > 0L) {
                    val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
                    val lastDate = prefs.getString(BEDTIME_STREAK_LAST_DATE, null)
                    if (lastDate != today) {
                        val yesterday = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                            .format(java.util.Date(System.currentTimeMillis() - 86_400_000L))
                        val prevStreak = prefs.getInt(BEDTIME_STREAK, 0)
                        val newStreak  = if (lastDate == yesterday) prevStreak + 1 else 1
                        prefs.edit().putInt(BEDTIME_STREAK, newStreak)
                            .putString(BEDTIME_STREAK_LAST_DATE, today).apply()
                    }
                } else {
                    // BM-024: missed bedtime — reset streak to 0.
                    prefs.edit()
                        .putInt(BEDTIME_STREAK, 0)
                        .remove(BEDTIME_STREAK_LAST_DATE)
                        .apply()
                }

                // Morning summary
                if (bedOnTs > 0L) {
                    val bedH  = cfg.optInt("bedHour",    22); val bedM  = cfg.optInt("bedMinute",  0)
                    val wakeH = cfg.optInt("wakeHour",    7); val wakeM = cfg.optInt("wakeMinute", 0)
                    val bedTotalMins  = bedH  * 60 + bedM
                    val wakeTotalMins = wakeH * 60 + wakeM
                    val durationMins  = if (wakeTotalMins > bedTotalMins)
                        wakeTotalMins - bedTotalMins
                    else (24 * 60 - bedTotalMins) + wakeTotalMins

                    val streak = prefs.getInt(BEDTIME_STREAK, 0)

                    val alreadySnapshotted = prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)
                    val snoozeCount = if (alreadySnapshotted)
                        prefs.getInt(BEDTIME_LAST_NIGHT_SNOOZES, 0)
                    else
                        prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
                    val appAttemptsJson = if (alreadySnapshotted)
                        prefs.getString(BEDTIME_LAST_NIGHT_ATTEMPTS_JSON, "{}") ?: "{}"
                    else
                        BedtimePrefs.getAttempts(securePrefs)

                    postMorningSummary(ctx, durationMins, streak, snoozeCount, appAttemptsJson)
                }

                prefs.edit()
                    .putBoolean(BEDTIME_ACTIVE, false)
                    .putBoolean(BEDTIME_BLOCK_ACTIVE, false)
                    .putBoolean(BEDTIME_SKIPPED_TONIGHT, false)
                    .apply()

                // Receiver-side snapshot (covers the case where the service was never running).
                // BM-028 FIX: BEDTIME_LAST_NIGHT_KEPT reflects whether BEDTIME_ON actually fired
                // (bedOnTs > 0) rather than being hardcoded to true.
                if (bedOnTs > 0L && !prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)) {
                    val snoozeCountR  = prefs.getInt(BEDTIME_SNOOZE_COUNT, 0)
                    val attemptsJson  = BedtimePrefs.getAttempts(securePrefs)
                    val attemptsTotal = runCatching {
                        val obj = org.json.JSONObject(attemptsJson); var s = 0
                        val keys = obj.keys(); while (keys.hasNext()) { s += obj.optInt(keys.next(), 0) }; s
                    }.getOrElse { 0 }
                    prefs.edit()
                        .putInt    (BEDTIME_LAST_NIGHT_SNOOZES,         snoozeCountR)
                        .putInt    (BEDTIME_LAST_NIGHT_ATTEMPTS,         attemptsTotal)
                        .putString (BEDTIME_LAST_NIGHT_ATTEMPTS_JSON,    attemptsJson)
                        // BM-028 FIX: was hardcoded true — now derives from whether BEDTIME_ON fired.
                        .putBoolean(BEDTIME_LAST_NIGHT_KEPT,             true)  // bedOnTs > 0L confirmed above
                        .putBoolean(BEDTIME_LAST_NIGHT_HAS_DATA,         true)
                        .putInt    (BEDTIME_SNOOZE_COUNT,                0)
                        .apply()
                    BedtimePrefs.clearAttempts(securePrefs)
                }

                // BM-028 FIX: clear BEDTIME_ON_TS so tomorrow, if BEDTIME_ON never fires,
                // bedOnTs will be 0 and the missed-bedtime branch (BM-024) triggers correctly.
                prefs.edit().putLong(BEDTIME_ON_TS, 0L).apply()

                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_OFF", 7002)

                // CB-017 FIX: restore the user's pre-bedtime manual filter state.
                restorePreBedtimeFilterState(ctx, prefs)

                // Schedule filter fade-out notification 10 min after wake time
                runCatching {
                    val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                    val sfCfg = if (!sfRaw.isNullOrBlank())
                        runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
                    if (sfCfg?.optBoolean("fadeOut", true) == true &&
                        sfCfg.optBoolean("bedtimeAutoApply", true)) {
                        val pi = android.app.PendingIntent.getBroadcast(
                            ctx, 7005,
                            Intent("${ctx.packageName}.BEDTIME_WAKEUP_FADE"),
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                        )
                        val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
                        val triggerAt = System.currentTimeMillis() + 10 * 60_000L
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms())
                            am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
                        else
                            am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
                    }
                }
            }

            // ── BEDTIME_WAKEUP_FADE ───────────────────────────────────────────
            "${ctx.packageName}.BEDTIME_WAKEUP_FADE" -> {
                runCatching { stopScreenFilter(ctx) }
                postWakeFilterFadeNotification(ctx)
            }

            // ── BEDTIME_WINDOWN (30 min before bedtime) ───────────────────────
            "${ctx.packageName}.BEDTIME_WINDOWN" -> {
                // Cancel any lingering old-style static notification (ID 7003).
                runCatching {
                    (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                        .cancel(7003)
                }

                // Store the exact bedtime epoch so countdown in JS matches the alarm exactly.
                runCatching {
                    val raw = BedtimePrefs.getSettings(ctx, prefs, securePrefs)
                    val cfg = org.json.JSONObject(raw ?: "{}")
                    val bedH = cfg.optInt("bedHour", 22)
                    val bedM = cfg.optInt("bedMinute", 0)
                    val cal  = java.util.Calendar.getInstance().apply {
                        set(java.util.Calendar.HOUR_OF_DAY, bedH)
                        set(java.util.Calendar.MINUTE, bedM)
                        set(java.util.Calendar.SECOND, 0)
                        set(java.util.Calendar.MILLISECOND, 0)
                    }
                    if (cal.timeInMillis <= System.currentTimeMillis())
                        cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
                    prefs.edit().putLong(BEDTIME_STARTS_AT_MS, cal.timeInMillis).apply()
                }

                // CB-017 FIX: save the manual filter state NOW (before wind-down takes over)
                // so we can restore it accurately at BEDTIME_OFF.
                if (!prefs.contains(SCREEN_FILTER_PRE_BEDTIME_STATE)) {
                    savePreBedtimeFilterState(prefs)
                }

                val svcIntent = Intent(ctx, AppMonitorService::class.java).apply {
                    action = AppMonitorService.ACTION_BEDTIME_WINDOWN
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    ctx.startForegroundService(svcIntent)
                else
                    ctx.startService(svcIntent)

                rescheduleForTomorrow(ctx, prefs, "${ctx.packageName}.BEDTIME_WINDOWN", 7003)
            }

            // ── BEDTIME_SNOOZE_EXPIRE ─────────────────────────────────────────
            "${ctx.packageName}.BEDTIME_SNOOZE_EXPIRE" -> {
                prefs.edit().putLong(BEDTIME_SNOOZE_UNTIL_TS, 0L).apply()

                // BUG-3 FIX: If the user pressed "Turn Off" from the bedtime notification
                // while a snooze was still pending, BEDTIME_BLOCK_ACTIVE is now false and
                // BEDTIME_SKIPPED_TONIGHT is true. The snooze-expire alarm still fires
                // 15 min later — do NOT re-enable DND or restart blocking in that case.
                val blockActive = prefs.getBoolean(BEDTIME_BLOCK_ACTIVE, false)
                val skipped     = prefs.getBoolean(BEDTIME_SKIPPED_TONIGHT, false)
                if (!blockActive || skipped) return

                val raw2 = BedtimePrefs.getSettings(ctx, prefs, securePrefs)
                val cfg2 = try { org.json.JSONObject(raw2 ?: "{}") } catch (_: Exception) { org.json.JSONObject() }
                if (cfg2.optBoolean("enabled", false)) {
                    val bedH2  = cfg2.optInt("bedHour",   22); val bedM2  = cfg2.optInt("bedMinute",  0)
                    val wakeH2 = cfg2.optInt("wakeHour",   7); val wakeM2 = cfg2.optInt("wakeMinute", 0)
                    val cal2   = java.util.Calendar.getInstance()
                    val nowM2  = cal2.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal2.get(java.util.Calendar.MINUTE)
                    val bedMins2  = bedH2  * 60 + bedM2; val wakeMins2 = wakeH2 * 60 + wakeM2
                    val inWindow2 = if (bedMins2 > wakeMins2) nowM2 >= bedMins2 || nowM2 < wakeMins2
                    else nowM2 >= bedMins2 && nowM2 < wakeMins2
                    if (inWindow2) {
                        if (cfg2.optBoolean("dndEnabled", true)) setDnd(ctx, true)
                        runCatching {
                            val sfRaw2  = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                            val sfCfg2b = if (!sfRaw2.isNullOrBlank())
                                runCatching { org.json.JSONObject(sfRaw2) }.getOrNull() else null
                            val isProUser = prefs.getBoolean(IS_PRO_USER, false)
                            if (isProUser &&
                                prefs.getBoolean("bedtime_filter_snoozed", false) &&
                                sfCfg2b?.optBoolean("bedtimeAutoApply", true) == true) {
                                prefs.edit().putBoolean("bedtime_filter_snoozed", false).apply()
                                val (warm2, dim2) = presetAlpha(sfCfg2b)
                                val preset2  = sfCfg2b.optString("bedtimePreset", ScreenFilterEngine.PRESET_WARM)
                                val customR2 = sfCfg2b.optInt("bedtimeCustomR", 255)
                                val customG2 = sfCfg2b.optInt("bedtimeCustomG", 100)
                                val customB2 = sfCfg2b.optInt("bedtimeCustomB", 0)
                                startScreenFilter(ctx, warm2, dim2, gradual = false,
                                    preset = preset2, customR = customR2, customG = customG2, customB = customB2)
                                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
                            }
                        }
                        val svcIntent = Intent(ctx, AppMonitorService::class.java).apply {
                            action = AppMonitorService.ACTION_BEDTIME_SNOOZE_CLEAR
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                            ctx.startForegroundService(svcIntent)
                        else
                            ctx.startService(svcIntent)
                    }
                }
            }

            // ── FILTER_SCHEDULE_ON / OFF ──────────────────────────────────────
            "${ctx.packageName}.FILTER_SCHEDULE_ON" -> {
                val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null) ?: return
                val sfCfg = runCatching { org.json.JSONObject(sfRaw) }.getOrElse { return }
                if (!sfCfg.optBoolean("enabled", false)) return
                val (warm, dim) = sfCfg.optInt("warmAlpha", 80) to sfCfg.optInt("dimAlpha", 45)
                val preset  = sfCfg.optString("preset", ScreenFilterEngine.PRESET_WARM)
                val customR = sfCfg.optInt("customR", 255)
                val customG = sfCfg.optInt("customG", 100)
                val customB = sfCfg.optInt("customB", 0)
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
                startScreenFilter(ctx, warm, dim, sfCfg.optBoolean("fadeIn", true),
                    preset = preset, customR = customR, customG = customG, customB = customB)
                rescheduleFilterAlarmForTomorrow(ctx, prefs, sfCfg,
                    "${ctx.packageName}.FILTER_SCHEDULE_ON", 7015, isStart = true)
            }
            "${ctx.packageName}.FILTER_SCHEDULE_OFF" -> {
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
                stopScreenFilter(ctx)
                val sfRaw2 = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
                val sfCfg2 = if (!sfRaw2.isNullOrBlank())
                    runCatching { org.json.JSONObject(sfRaw2) }.getOrNull() else null
                if (sfCfg2 != null) rescheduleFilterAlarmForTomorrow(ctx, prefs, sfCfg2,
                    "${ctx.packageName}.FILTER_SCHEDULE_OFF", 7016, isStart = false)
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Alpha values for the bedtime screen filter based on the selected preset.
     * SF-012 FIX: added "night" case.  The deep-red colour is resolved in
     * ScreenFilterEngine.start() via the preset name — alpha values are the same
     * as the default "bedtime" preset so the intensity behaviour is unchanged.
     */
    private fun presetAlpha(sfCfg: org.json.JSONObject?): Pair<Int, Int> =
        when (sfCfg?.optString("bedtimePreset", "bedtime") ?: "bedtime") {
            "soft"   -> Pair(40, 15)
            "medium" -> Pair(65, 30)
            // SF-012: "night" uses the same alpha as "bedtime"; colour (deep red) is
            // handled by ScreenFilterEngine when preset="night" is passed through.
            "night"  -> Pair(80, 45)
            else     -> Pair(80, 45)  // "bedtime" / default
        }

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

    /**
     * CB-017 helper: snapshot current manual filter state so it can be restored at wake.
     * Reads warm/dim from SCREEN_FILTER_SETTINGS_V1 and active flag from SCREEN_FILTER_ACTIVE.
     */
    private fun savePreBedtimeFilterState(prefs: android.content.SharedPreferences) {
        runCatching {
            val wasActive = prefs.getBoolean(SCREEN_FILTER_ACTIVE, false)
            val sfRaw = prefs.getString(SCREEN_FILTER_SETTINGS_V1, null)
            val sfCfg = if (!sfRaw.isNullOrBlank()) runCatching { org.json.JSONObject(sfRaw) }.getOrNull() else null
            val state = org.json.JSONObject().apply {
                put("active",  wasActive)
                put("warm",    sfCfg?.optInt("warmAlpha", 60)  ?: 60)
                put("dim",     sfCfg?.optInt("dimAlpha",  30)  ?: 30)
                put("preset",  sfCfg?.optString("preset", ScreenFilterEngine.PRESET_WARM) ?: ScreenFilterEngine.PRESET_WARM)
                put("customR", sfCfg?.optInt("customR", 255) ?: 255)
                put("customG", sfCfg?.optInt("customG", 100) ?: 100)
                put("customB", sfCfg?.optInt("customB", 0)   ?: 0)
            }
            prefs.edit().putString(SCREEN_FILTER_PRE_BEDTIME_STATE, state.toString()).apply()
        }
    }

    /**
     * CB-017 helper: restore the pre-bedtime manual filter state saved by
     * [savePreBedtimeFilterState].  Called from the BEDTIME_OFF handler.
     */
    private fun restorePreBedtimeFilterState(ctx: Context, prefs: android.content.SharedPreferences) {
        runCatching {
            val stateRaw = prefs.getString(SCREEN_FILTER_PRE_BEDTIME_STATE, null) ?: return
            val state = org.json.JSONObject(stateRaw)
            if (state.optBoolean("active", false)) {
                val warm    = state.optInt("warm",    60)
                val dim     = state.optInt("dim",     30)
                val preset  = state.optString("preset", ScreenFilterEngine.PRESET_WARM)
                val customR = state.optInt("customR", 255)
                val customG = state.optInt("customG", 100)
                val customB = state.optInt("customB", 0)
                startScreenFilter(ctx, warm, dim, gradual = false,
                    preset = preset, customR = customR, customG = customG, customB = customB)
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, true).apply()
            } else {
                // Filter was not active before bedtime — ensure it stays off.
                prefs.edit().putBoolean(SCREEN_FILTER_ACTIVE, false).apply()
            }
        }
        // Always clear the snapshot regardless of success/failure.
        prefs.edit().remove(SCREEN_FILTER_PRE_BEDTIME_STATE).apply()
    }

    /**
     * SF-012 / SF-013: updated to forward preset name and custom RGB to AppMonitorService
     * so ScreenFilterEngine can apply the correct tint colour.
     */
    private fun startScreenFilter(
        ctx: Context,
        warmAlpha: Int,
        dimAlpha: Int,
        gradual: Boolean,
        preset: String = ScreenFilterEngine.PRESET_WARM,
        customR: Int = 255,
        customG: Int = 100,
        customB: Int = 0
    ) {
        val intent = Intent(ctx, AppMonitorService::class.java).apply {
            action = AppMonitorService.ACTION_FILTER_START
            putExtra("filter_warm",     warmAlpha)
            putExtra("filter_dim",      dimAlpha)
            putExtra("filter_gradual",  gradual)
            putExtra("filter_preset",   preset)
            putExtra("filter_custom_r", customR)
            putExtra("filter_custom_g", customG)
            putExtra("filter_custom_b", customB)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
        else ctx.startService(intent)
    }

    private fun stopScreenFilter(ctx: Context) {
        val intent = Intent(ctx, AppMonitorService::class.java).apply {
            action = AppMonitorService.ACTION_FILTER_STOP
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
        else ctx.startService(intent)
    }

    private fun startBedtimeBlock(ctx: Context, blockedPkgsJson: String) {
        if (blockedPkgsJson == "[]" || blockedPkgsJson.isBlank()) return
        val intent = Intent(ctx, AppMonitorService::class.java).apply {
            action = "START_BEDTIME"; putExtra("blocked_apps", blockedPkgsJson)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
        else ctx.startService(intent)
    }

    private fun stopBedtimeBlock(ctx: Context) {
        val intent = Intent(ctx, AppMonitorService::class.java).apply { action = "STOP_BEDTIME" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
        else ctx.startService(intent)
    }

    // ── Reschedule helpers ────────────────────────────────────────────────────

    private fun rescheduleFilterAlarmForTomorrow(
        ctx: Context, prefs: android.content.SharedPreferences,
        sfCfg: org.json.JSONObject, action: String, requestCode: Int, isStart: Boolean
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
            else         { hour = sfCfg.optInt("schedEndHour",   7);  minute = sfCfg.optInt("schedEndMin",   0) }
        }
        val activeDayIndices: List<Int> = sfCfg.optJSONArray("schedDays")
            ?.let { arr -> (0 until 7).filter { arr.optInt(it, 1) != 0 } }
            ?: (0..6).toList()
        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, hour); set(java.util.Calendar.MINUTE, minute)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
            add(java.util.Calendar.DAY_OF_YEAR, 1); var steps = 0
            while (steps < 7) {
                if (activeDayIndices.contains(get(java.util.Calendar.DAY_OF_WEEK) - 1)) break
                add(java.util.Calendar.DAY_OF_YEAR, 1); steps++
            }
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT
        val pi = android.app.PendingIntent.getBroadcast(ctx, requestCode,
            Intent(action).apply { setPackage(ctx.packageName) }, flags)
        BedtimePrefs.setExactSafely(ctx, ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager,
            android.app.AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
    }

    private fun rescheduleForTomorrow(
        ctx: Context, prefs: android.content.SharedPreferences, action: String, requestCode: Int
    ) {
        val raw = BedtimePrefs.getSettings(ctx, prefs, SensitivePrefs.get(ctx)) ?: return
        val cfg = try { org.json.JSONObject(raw) } catch (_: Exception) { return }
        if (!cfg.optBoolean("enabled", false)) return

        val bedH    = cfg.optInt("bedHour",    22); val bedM    = cfg.optInt("bedMinute",  0)
        val wakeH   = cfg.optInt("wakeHour",    7); val wakeM   = cfg.optInt("wakeMinute", 0)
        val rawWd   = bedH * 60 + bedM - 30

        val targetHour = when {
            action.endsWith("BEDTIME_ON")      -> bedH
            action.endsWith("BEDTIME_OFF")     -> wakeH
            action.endsWith("BEDTIME_WINDOWN") -> ((rawWd / 60 + 24) % 24)
            else -> return
        }
        val targetMin = when {
            action.endsWith("BEDTIME_ON")      -> bedM
            action.endsWith("BEDTIME_OFF")     -> wakeM
            action.endsWith("BEDTIME_WINDOWN") -> ((rawWd % 60 + 60) % 60)
            else -> 0
        }

        val activeDays = cfg.optJSONArray("activeDays")
            ?.let { arr -> (0 until arr.length()).map { arr.getInt(it) } }
            ?.takeIf { it.isNotEmpty() } ?: listOf(0,1,2,3,4,5,6)

        val cal = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, targetHour); set(java.util.Calendar.MINUTE, targetMin)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
            add(java.util.Calendar.DAY_OF_YEAR, 1); var steps = 0
            while (!activeDays.map { it + 1 }.contains(get(java.util.Calendar.DAY_OF_WEEK)) && steps < 7) {
                add(java.util.Calendar.DAY_OF_YEAR, 1); steps++
            }
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        else android.app.PendingIntent.FLAG_UPDATE_CURRENT

        val pi = android.app.PendingIntent.getBroadcast(ctx, requestCode,
            Intent(action).apply { setPackage(ctx.packageName) }, flags)
        BedtimePrefs.setExactSafely(ctx,
            ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager,
            android.app.AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
    }

    // ── Morning summary notification ──────────────────────────────────────────

    private fun postMorningSummary(
        ctx: Context, durationMins: Int, streak: Int, snoozeCount: Int, appAttemptsJson: String
    ) {
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            ensureAlertChannel(ctx, nm)

            val h = durationMins / 60; val m = durationMins % 60
            val durStr = when { h > 0 && m > 0 -> "${h}h ${m}m"; h > 0 -> "${h}h"; else -> "${m}m" }

            val streakLine = when {
                streak >= 30 -> "🏆 $streak night streak — you've mastered your sleep!"
                streak >= 20 -> "🌟 $streak night streak — exceptional discipline!"
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
                val name  = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }
                    .getOrDefault(pkg.split(".").last())
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
                else                                    -> "DND was lifted $snoozeCount times. ${if (appLine.isNotEmpty()) appLine else ""}".trim()
            }

            val body = buildString {
                append("Bedtime ran for $durStr. "); append(disturbanceLine)
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

    private fun ensureAlertChannel(ctx: Context, nm: android.app.NotificationManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                android.app.NotificationChannel("tidyalerts", "Aurelo Smart Alerts",
                    android.app.NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Bedtime and smart usage alerts"
                }
            )
        }
    }
}
