package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// AureloScoreBridge — single Kotlin source of truth for score computation.
//
// MOTIVATION:
//   Previously, Screen Score, Sleep Score, and the composite Aurelo Score
//   weights were implemented in both Kotlin (ScreenScoreEnhancer, SleepScoreEnhancer,
//   BodyScoreCalculator) AND re-implemented in JS (app-wellness.js calculateScreenScore,
//   app-focus-score.js calculateSleep / calculateAurelo, app-home-score.js
//   _computeAureloScore). The two copies drifted silently — JS fixes (F-13, F-21,
//   F-27, B7) were never ported back to any Kotlin path, so the Coach and
//   ScoreHistory received stale scores.
//
// APPROACH:
//   – Screen Score: fully Kotlin. All inputs (total mins, pickups, pickup avg,
//     first-use timestamp) come from SharedPrefs caches written by UsageStatsBridge.
//   – Sleep Score: fully Kotlin. Inputs come from BedtimeBridge prefs;
//     HC blend delegated to existing SleepScoreEnhancer.
//   – Body Score: already Kotlin (BodyScoreCalculator). Unchanged.
//   – Focus Score: still computed in JS (requires live timer/pause state from
//     app-focus-home.js loadStripData). JS passes the result as a parameter.
//   – Composite: Kotlin assembles the final weighted Aurelo Score from the four pillars.
//
// JS ENTRY POINTS (registered in AppBridge.kt):
//   N.getScreenScore()              → JSON {score, base, goalAdherence, pickupScore, firstUsePts, modifier, ...}
//   N.getSleepScore()               → JSON {score, hasData, base, snoozeDeduct, attemptDeduct, streakBonus, hcEnhanced, ...}
//   N.getAureloScore(focusScore)    → JSON {score, screenScore, focusScore, sleepScore, hcBodyScore, weights...}
//
// FIXES CARRIED OVER FROM JS:
//   F-13  First-use score graduated (midnight=0, 5am=20, 6am=30, 7am=50, 8am=75, 9am=100)
//   F-21  Pickup decay steeper: 1.3× average now dents score (was 1.5×)
//   F-27  Weekend-aware first-use threshold relaxed to 9:30am
//   B7    Sleep Score streak bonus (+3/night, up to +20) correctly applied
// ═══════════════════════════════════════════════════════════════════════════

import android.content.SharedPreferences
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.Calendar

class AureloScoreBridge(
    private val prefs: SharedPreferences,
    private val healthConnect: HealthConnectBridge,
) {

    // ── Screen Score ─────────────────────────────────────────────────────────
    // Formula: Goal adherence 50% + Pickup frequency 30% + First-use time 20%
    //          + HC steps modifier (−3 to +5) via ScreenScoreEnhancer.
    //
    // All inputs read from SharedPrefs caches written by UsageStatsBridge so
    // this method is safe to call from any thread without triggering fresh I/O.

    @JavascriptInterface
    fun getScreenScore(): String {
        val goalMins    = prefs.getInt(STREAK_GOAL_MINS, 240)
        // BUG-01 FIX: UsageStatsBridge writes CACHED_TOTAL_MINS as Long (putLong) and
        // CACHED_PICKUPS as Int (putInt). Read each with the correct type — no try/catch needed.
        val totalMins    = prefs.getLong(CACHED_TOTAL_MINS, 0L).toInt()
        val todayPickups = prefs.getInt(CACHED_PICKUPS, 0)
        val firstPickupTs = prefs.getLong(CACHED_FIRST_PICKUP_TS, 0L)

        // 7-day pickup average from monthly pickups cache
        // (same source as UsageSummaryBuilder.build() → pickups7DayAvg)
        val weeklyPickupsRaw = prefs.getString(CACHED_MONTHLY_PICKUPS, "[]") ?: "[]"
        val avgPickups = weeklyAvgPickups(weeklyPickupsRaw, 7)

        // ── Component 1: Goal adherence (50%) ────────────────────────────────
        val goalAdherence: Int = when {
            goalMins <= 0         -> 100
            totalMins < goalMins  -> 100
            totalMins <= goalMins * 1.5f -> {
                val over = (totalMins - goalMins).toFloat()
                maxOf(0, (100 - (over / (goalMins * 0.5f) * 100)).toInt())
            }
            else -> 0
        }

        // ── Component 2: Pickup frequency (30%) ──────────────────────────────
        // F-20: new-user guard — if no history yet, treat today as baseline
        // F-21: steeper decay — 1.3× avg now noticeably dents score (was 1.5×)
        val effectiveAvg = if (avgPickups <= 0f && todayPickups > 0) todayPickups.toFloat()
        else avgPickups
        val pickupScore: Int = when {
            effectiveAvg <= 0f || todayPickups <= effectiveAvg -> 100
            todayPickups <= effectiveAvg * 1.3f -> {
                // 1.0–1.3×: linear 100→60
                maxOf(60, (100 - ((todayPickups - effectiveAvg) / (effectiveAvg * 0.3f)) * 40).toInt())
            }
            todayPickups <= effectiveAvg * 2.0f -> {
                // 1.3–2.0×: linear 60→0
                maxOf(0, (60 - ((todayPickups - effectiveAvg * 1.3f) / (effectiveAvg * 0.7f)) * 60).toInt())
            }
            else -> 0
        }.coerceIn(0, 100)

        // ── Component 3: First-use time (20%) ────────────────────────────────
        // F-13: graduated scoring midnight=0 → 9am=100
        // F-27: weekend threshold relaxed to 9:30am
        val firstUsePts: Int = if (firstPickupTs <= 0L) {
            100 // no pickup yet today — no penalty
        } else {
            val cal = Calendar.getInstance().apply { timeInMillis = firstPickupTs }
            val hour = cal.get(Calendar.HOUR_OF_DAY)
            val min  = cal.get(Calendar.MINUTE)
            val firstUseHour = hour + min / 60f
            val isWeekend = cal.get(Calendar.DAY_OF_WEEK).let { it == Calendar.SATURDAY || it == Calendar.SUNDAY }
            val fullScoreH = if (isWeekend) 9.5f else 9.0f   // F-27
            when {
                firstUseHour >= fullScoreH -> 100
                firstUseHour >= 8f -> (75 + ((firstUseHour - 8f) / (fullScoreH - 8f)) * 25).toInt()
                firstUseHour >= 7f -> 50
                firstUseHour >= 6f -> 30
                firstUseHour >= 5f -> 20
                firstUseHour >= 3f -> 10
                else -> 0
            }.coerceIn(0, 100)
        }

        val baseScore = (goalAdherence * 0.50f + pickupScore * 0.30f + firstUsePts * 0.20f)
            .toInt().coerceIn(0, 100)

        val hcData   = healthConnect.getCachedData()
        val modResult = ScreenScoreEnhancer.modifier(hcData)
        val effective = ScreenScoreEnhancer.applyModifier(baseScore, hcData)

        return JSONObject().apply {
            put("score",         effective)
            put("base",          baseScore)
            put("goalAdherence", goalAdherence)
            put("pickupScore",   pickupScore)
            put("firstUsePts",   firstUsePts)
            put("modifier",      modResult.modifier)
            put("modifierLabel", modResult.label ?: JSONObject.NULL)
            put("steps",         modResult.steps)
            put("todayMins",     totalMins)
            put("goalMins",      goalMins)
            put("todayPickups",  todayPickups)
            put("avgPickups",    avgPickups)
        }.toString()
    }

    // ── Sleep Score ──────────────────────────────────────────────────────────
    // Base: 80 if bedtime kept, 25 if missed.
    // Deductions: −10/snooze (max −20), −4/blocked-app-attempt (max −20).
    // Streak bonus: +3/day, capped at +20 (B7: was silently dropped in JS).
    // HC blend: Bedtime 60% + HC sleep duration 25% + HC overnight HRV 15%.

    @JavascriptInterface
    fun getSleepScore(): String {
        val hasData = prefs.getBoolean(BEDTIME_LAST_NIGHT_HAS_DATA, false)
        if (!hasData) {
            return JSONObject().apply {
                put("score",   -1)
                put("hasData", false)
            }.toString()
        }

        val kept     = prefs.getBoolean(BEDTIME_LAST_NIGHT_KEPT, false)
        val snoozes  = prefs.getInt(BEDTIME_LAST_NIGHT_SNOOZES, 0)
        val attempts = prefs.getInt(BEDTIME_LAST_NIGHT_ATTEMPTS, 0)
        val streak   = prefs.getInt(BEDTIME_STREAK, 0)

        val base        = if (kept) 80 else 25
        val snoozeDed   = (snoozes  * 10).coerceAtMost(20)
        val attemptDed  = (attempts * 4).coerceAtMost(20)
        val streakBonus = (streak   * 3).coerceAtMost(20)   // B7 fix: was computed but silently dropped

        val rawScore = (base - snoozeDed - attemptDed + streakBonus).coerceIn(0, 100)

        val hcData   = healthConnect.getCachedData()
        val enhanced = SleepScoreEnhancer.blend(rawScore, hcData)

        return JSONObject().apply {
            put("score",        enhanced.score)
            put("hasData",      true)
            put("base",         base)
            put("snoozeDeduct", snoozeDed)
            put("attemptDeduct",attemptDed)
            put("streakBonus",  streakBonus)
            put("hcEnhanced",   enhanced.isHCEnhanced)
            if (enhanced.isHCEnhanced) {
                put("bedtimeComponent",    enhanced.bedtimeComponent)
                enhanced.durationComponent?.let    { put("durationComponent",    it) }
                enhanced.overnightHrvComponent?.let { put("overnightHrvComponent", it) }
            }
        }.toString()
    }

    // ── Composite Aurelo Score ───────────────────────────────────────────────
    // JS computes Focus Score (has live timer/pause state), passes it here.
    // Kotlin owns the weight table and assembles the composite.
    //
    // Weight table (F-23: Body raised to 15%):
    //   4-pillar (HC + Sleep): Screen 35% + Focus 30% + Sleep 20% + Body 15%
    //   3-pillar (Sleep, no HC): Screen 40% + Focus 35% + Sleep 25%
    //   2-pillar (HC, no Sleep): Screen 46% + Focus 39% + Body 15%
    //   2-pillar (neither):      Screen 55% + Focus 45%

    @JavascriptInterface
    fun getAureloScore(focusScore: Int): String {
        val screenJson  = runCatching { JSONObject(getScreenScore()) }.getOrNull()
        val screenScore = screenJson?.optInt("score", -1) ?: -1

        val sleepJson  = runCatching { JSONObject(getSleepScore()) }.getOrNull()
        val sleepScore = if (sleepJson?.optBoolean("hasData", false) == true)
            sleepJson.optInt("score", -1) else -1
        val sleepEnabled = sleepScore >= 0

        val hcData    = healthConnect.getCachedData()
        val bodyScore = BodyScoreCalculator.compute(hcData)
        val hcActive  = bodyScore >= 0

        val swScreen: Int; val swFocus: Int; val swSleep: Int; val swBody: Int
        if (hcActive) {
            swSleep  = if (sleepEnabled) 20 else 0
            swScreen = if (sleepEnabled) 35 else 46
            swFocus  = if (sleepEnabled) 30 else 39
            swBody   = 15
        } else {
            swSleep  = if (sleepEnabled) 25 else 0
            swScreen = if (sleepEnabled) 40 else 55
            swFocus  = if (sleepEnabled) 35 else 45
            swBody   = 0
        }

        data class Part(val score: Int, val weight: Int)
        val parts = buildList {
            if (screenScore >= 0) add(Part(screenScore, swScreen))
            if (focusScore  >= 0) add(Part(focusScore,  swFocus))
            if (sleepEnabled)     add(Part(sleepScore,  swSleep))
            if (hcActive)         add(Part(bodyScore,   swBody))
        }

        val totalW    = parts.sumOf { it.weight }
        val composite = if (totalW == 0) -1
        else (parts.sumOf { it.score * it.weight }.toFloat() / totalW)
            .toInt().coerceIn(0, 100)

        return JSONObject().apply {
            put("score",       composite)
            put("screenScore", screenScore)
            put("focusScore",  focusScore)
            put("sleepScore",  sleepScore)
            put("hcBodyScore", bodyScore)
            put("hcActive",    hcActive)
            put("sleepEnabled",sleepEnabled)
            put("swScreen",    swScreen)
            put("swFocus",     swFocus)
            put("swSleep",     swSleep)
            put("swBody",      swBody)
        }.toString()
    }

    // ── Pickup average helper ────────────────────────────────────────────────
    // Mirrors UsageSummaryBuilder.weeklyAverage() — parses CACHED_MONTHLY_PICKUPS
    // (a JSON array of daily pickup counts stored by UsageStatsBridge) and
    // returns the average over the last [days] entries.

    private fun weeklyAvgPickups(json: String, days: Int): Float = runCatching {
        val arr = org.json.JSONArray(json)
        val values = mutableListOf<Float>()
        val start = maxOf(0, arr.length() - days)
        for (i in start until arr.length()) {
            val v = arr.optDouble(i, -1.0)
            if (v >= 0) values.add(v.toFloat())
        }
        if (values.isEmpty()) 0f else values.sum() / values.size
    }.getOrDefault(0f)
}