'use strict';
/* ═══════════════════════════════════════════════════════════════════════════════
 * FOCUS SCORE MODULE — app-focus-score.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Focus/Sleep/Aurelo score calculations, score history,
 *       focus streak, static rows (7-day calendar), dynamic
 *       event rows, score-detail bottom sheets.
 *
 * Public API (via FocusScore.*)
 *   calculateFocus()          → {score, sessPts, timerPts, …}
 *   calculateSleep()          → {score, adherePts, …, bedStreak}
 *   calculateAurelo()         → {score, screenScore, …}
 *   renderFocusStaticRow()    — renders #focus-static-row
 *   renderHabitsStaticRow()   — renders #habits-static-row
 *   renderFocusDynamicRow()   — renders #focus-dynamic-row
 *   renderHabitsDynamicRow()  — renders #habits-dynamic-row
 *   openFocusScoreSheet()
 *   openHabitsScoreSheet()
 *   maybeEarnFocusStreak(d)
 *   getFocusStreak()          → {count, lastDate, earnedDates}
 *
 * FIXES APPLIED
 *   F-02  JS sleep blend re-normalizes weights for partial HC data
 *   F-03  Sleep score history saves effective (HC-blended) score, not raw
 *   F-04  HC null crash in openHabitsScoreSheet — null-safe blend
 *   F-05  Single timer/pause no longer yields 100 (engagement scale)
 *   F-06  Focus Score now uses today-only session data, not weekly
 *   F-07  Session scoring is duration-weighted with partial credit for interrupts
 *   F-08  Bedtime window used as sleep duration proxy; HC sessions filtered
 *         to those overlapping the bedtime window
 *   F-09  Aurelo Score persisted to history for genuine delta display
 *   F-11  Focus streak requires ≥2 timers (not 1) to qualify via timer path
 *   F-12  Snooze scoring graduated: 0→30, 1→20, 2→10, 3+→0 (was 0→30, 1→15, 2+→0)
 *   F-16  Sleep duration ceiling extended to 11h (10h was too harsh)
 *   F-18  Unified grade labels: Excellent/Good/Fair/Start across all scores
 *   F-19  HC-only Focus Score state labelled explicitly in sheet
 *   F-22  Sleep Score pre-wake-time state shown in UI with explanation
 *   F-23  Body pillar weight raised to 15% (from 10%)
 *   F-26  Focus sheet data line corrected to say "this week" not "today"
 *   B7    Sleep Score streak bonus (+3/night, up to +20) now applied to score
 *         (bedStreak was fetched but silently dropped from the result)
 * ═══════════════════════════════════════════════════════════════════════════════ */
window.FocusScore = (function () {

  /* ── Constants ─────────────────────────────────────────────── */
  var _FOCUS_SCORE_KEY   = 'focus_score_history';
  var _SLEEP_SCORE_KEY   = 'sleep_score_history';
  var _AURELO_SCORE_KEY  = 'aurelo_score_history';  // F-09
  var _FOCUS_STREAK_KEY  = 'focus_streak_v1';
  var _STRIP_CACHE_TTL   = 2000;

  /* ── F-18: Unified grade system ────────────────────────────── */
  // All four score surfaces (Aurelo, Screen, Focus, Sleep) now share
  // identical thresholds and labels: Excellent / Good / Fair / Start
  function _unifiedGrade(score) {
    if (score >= 85) return { label: 'Excellent', color: 'var(--g)'  };
    if (score >= 70) return { label: 'Good',      color: 'var(--c)'  };
    if (score >= 55) return { label: 'Fair',       color: 'var(--a)'  };
    return               { label: 'Start',      color: 'var(--r)'  };
  }

  /* ── F-16: Sleep duration sub-score helper ─────────────────── */
  // Shared between _getEffectiveSleepScore and openHabitsScoreSheet.
  // F-16: ceiling extended from 10h to 11h so 10h scores ~50 (not 0).
  function _sleepDurationScore(hours) {
    if (hours >= 7 && hours <= 9) return 100;
    if (hours < 7) return Math.max(0, Math.round(((hours - 4) / 3) * 100));
    // F-16: (1 - (h-9)/2) * 100 → 100 at 9h, 50 at 10h, 0 at 11h
    return Math.max(0, Math.round((1 - (hours - 9) / 2) * 100));
  }

  /* ── HC mindfulness credit helper ──────────────────────────── */
  function _hcMindfulCredit(s) {
    if (!s) return 0;
    if (typeof s.creditPts === 'number') return Math.max(0, Math.round(s.creditPts));
    if (typeof s.halfPts   === 'number') return Math.max(0, Math.round(s.halfPts));
    // BUG-01 FIX: Kotlin's HealthConnectRepository already applies 50% credit when
    // computing pts (durationMins / 2). Do NOT halve again here — that was producing
    // 25% of the original value (double halving). Use raw pts directly.
    var raw = Number(s.pts || 0);
    return Math.max(0, Math.round(raw));
  }

  /* ── Sleep score cache ─────────────────────────────────────── */
  var _sleepScoreCache   = null;
  var _sleepScoreCacheTs = 0;

  /* ════════════════════════════════════════════════════════════
   * calculateFocus(d)
   *
   * F-05: Single-feature engagement scale — one timer or one pause
   *       no longer produces 100. Each feature's pts are multiplied
   *       by an engagement factor (0.5 for 1 item, 1.0 for 2+ items).
   *
   * F-06: Session data now sourced from getFocusDailyStats() (today only)
   *       rather than getFocusStats() (weekly cumulative).
   *
   * F-07: Sessions are duration-weighted with partial credit for interrupts:
   *       score = (elapsedMins / plannedMins) * completionBonus
   *       where completionBonus = 1.0 if at least one session was completed,
   *       else 0.75 (partial credit for interrupted-only days).
   * ════════════════════════════════════════════════════════════ */
  function calculateFocus(d) {
    d = d || (typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {});

    // F-06: load daily session data from native bridge
    var daily = {};
    if (IS_NATIVE && typeof N.getFocusDailyStats === 'function') {
      try { daily = JSON.parse(N.getFocusDailyStats() || '{}'); } catch(_) {}
    }
    var completedToday   = daily.completedToday   || 0;
    var interruptedToday = daily.interruptedToday || 0;
    var totalSessions    = daily.totalSessions    || (completedToday + interruptedToday);
    var plannedMins      = daily.plannedMins      || 0;
    var elapsedMins      = daily.elapsedMins      || 0;

    var totalW = 0, earned = 0;
    var sessW = 0, timerW = 0, mindfulW = 0;
    var sessPts = 0, timerPts = 0, mindfulPts = 0;

    // ── Sessions pillar (F-06, F-07) ──────────────────────────
    // Score is DAILY. Weekly data (d.total / d.completed) is only a graceful-
    // degradation fallback when the native daily bridge returns no duration info.
    var sessEngageScale = 1;          // exposed in return for score sheet hint
    var weeklyConsistencyBonus = 0;   // additive pts applied to baseScore below

    // BUG-1 FIX: removed `|| (d.total > 0)` — that weekly condition caused the sessions
    // pillar to fire on days with zero sessions, falling into the weekly fallback and
    // producing a phantom score of 100 (F-06 was supposed to fix this but the outer
    // gate still leaked weekly data). Sessions pillar now only activates for today.
    if (totalSessions > 0) {
      sessW = 40;
      totalW += sessW;

      if (plannedMins > 0) {
        // ── Primary daily path ──────────────────────────────────
        // F-07: duration-weighted + partial credit for interrupts.
        // Engagement scale: a 5-min session completing 100% of its plan should not
        // yield 40/40 and re-normalise to 100 when sessions is the only active pillar.
        // 15 min = full credit (the shortest "proper" preset); shorter sessions
        // scale linearly. Mirrors timerEngageScale / pauseEngageScale pattern.
        var completionRatio = Math.min(1, elapsedMins / plannedMins);
        var completionBonus = completedToday > 0 ? 1.0 : 0.75;
        sessEngageScale = Math.min(1, plannedMins / 15);
        sessPts = Math.round(completionRatio * completionBonus * 40 * sessEngageScale);
      }
      earned += sessPts;

      // ── Weekly consistency bonus ────────────────────────────────────────────
      // Additive bonus applied to baseScore (not to the pillar ratio) so it does
      // not inflate weight labels. +4 pts per session done earlier this week,
      // capped at +10. Rewards habit-building without dominating the score.
      // BUG-3 FIX: use (d.total - totalSessions) so today's own sessions are not
      // double-counted as "extra history." Old formula used (d.total - 1), which
      // assumed exactly 1 session today and over-bonused on multi-session days.
      var sessionsBeforeToday = Math.max(0, (d.total || 0) - totalSessions);
      weeklyConsistencyBonus = Math.min(10, Math.max(0, sessionsBeforeToday * 4));
    }

    // ── Timers pillar (F-05) ───────────────────────────────────
    // BUG-6 FIX: only activate timer pillar when at least one configured app was
    // actually opened today. Not opening an app at all is neutral — it should not
    // inflate the score. d.timerUsedCount is added by loadStripData() in app-focus-home.js.
    if (d.timerTotal > 0 && (d.timerUsedCount || 0) > 0) {
      timerW = 35;
      totalW += timerW;
      var timerRatio = (d.timerTotal - d.timerOverCount) / d.timerTotal;
      // F-05: engagement scale — 1 timer caps at 50% of pillar max
      var timerEngageScale = Math.min(1, d.timerTotal / 2);
      timerPts = Math.round(timerRatio * 35 * timerEngageScale);
      earned += timerPts;
    }

    // ── Mindful Pause pillar (F-05) ────────────────────────────
    if (d.pauseCount > 0) {
      mindfulW = 25;
      totalW += mindfulW;
      var pauseRatio = d.resistCount / d.pauseCount;
      // F-05: engagement scale — fewer than 3 pauses encountered caps proportionally
      var pauseEngageScale = Math.min(1, d.pauseCount / 3);
      mindfulPts = Math.round(pauseRatio * 25 * pauseEngageScale);
      earned += mindfulPts;
    }

    // ── HC external mindfulness (50% credit bonus on top) ──────
    var hcMindfulPts = 0, hcActive = false, hcOnlyMode = false;
    if (typeof HealthConnect !== 'undefined' && HealthConnect.isConnected()) {
      var _hcSess = HealthConnect.getMindfulnessSessions();
      if (_hcSess.length) {
        hcMindfulPts = _hcSess.reduce(function(sum, s) { return sum + _hcMindfulCredit(s); }, 0);
        hcActive = true;
      }
    }

    var baseScore = totalW === 0 ? -1 : Math.round((earned / totalW) * 100);

    var activePillars = (sessW > 0 ? 1 : 0) + (timerW > 0 ? 1 : 0) + (mindfulW > 0 ? 1 : 0);
    // BUG-09 FIX: Do NOT apply single-pillar cap to baseScore here — it was previously
    // applied before HC mindfulness was added, allowing HC to bypass the cap entirely.
    // Cap is now enforced on the final `score` below AFTER HC boost is applied.

    // Apply weekly consistency bonus before HC boost — both are additive on top.
    if (baseScore >= 0 && weeklyConsistencyBonus > 0) {
      baseScore = Math.min(100, baseScore + weeklyConsistencyBonus);
    }

    // F-19: HC-only mode when no Aurelo features are configured
    if (baseScore < 0 && hcActive && hcMindfulPts > 0) {
      hcOnlyMode = true;
      baseScore = 0; // will be boosted by hcMindfulPts below
    }

    var score = hcActive
      ? Math.min(100, (baseScore >= 0 ? baseScore : 0) + hcMindfulPts)
      : baseScore;

    // BUG-09 FIX: Enforce single-pillar cap on the FINAL score (after HC boost).
    // When HC mindfulness is contributing, raise the cap from 70 → 80 to reflect that
    // the user genuinely earned extra credit via wearable data, while still preventing
    // a single Aurelo pillar day from hitting an unrealistically high score.
    if (activePillars === 1 && score >= 0) {
      var _pillarCap = hcActive ? 80 : 70;
      if (score > _pillarCap) score = _pillarCap;
    }

    return {
      score, sessPts, timerPts, mindfulPts, sessW, timerW, mindfulW,
      sessMax: sessW, timerMax: timerW, mindfulMax: mindfulW,
      hcMindfulPts, hcActive, hcOnlyMode,
      // daily session data for display
      completedToday, interruptedToday, totalSessions, plannedMins, elapsedMins,
      // weekly data for history/streak
      weekCompleted: d.completed || 0, weekTotal: d.total || 0,
      weeklyConsistencyBonus, sessionsBeforeToday,
      // engagement scale — used by score sheet duration hint when < 1
      sessEngageScale,
      activePillars,
    };
  }

  /* ════════════════════════════════════════════════════════════
  /* ════════════════════════════════════════════════════════════
   * calculateSleep()
   *
   * Revised Sleep Score formula (v2.1):
   *
   * Adherence base (0–40 pts):
   *   bedtime kept            → 40
   *   skipped tonight         → 15  (distinct from missing entirely)
   *   missed (never started)  → 10
   *
   * In-window phone usage (0–30 pts, kept only):
   *   ≤15 min cumulative      → 30  (grace period — alarm/music/notes)
   *   each 5 min over 15 min  → −3  (max deduction −30, floor 0)
   *
   * Friction signals (0–20 pts, kept only):
   *   snooze deduction        → −5/snooze, max −10
   *   blocked app attempts    → −2/attempt, max −10
   *
   * Streak bonus (0–12 pts, kept only):
   *   +2 per consecutive night, max +12
   *
   * Screen Filter bonus (+3, kept only):
   *   +3 when bedtime auto-filter was active this night
   *
   * Max achievable: 40+30+20+12+3 = 105 → capped at 100
   *
   * F-12: Graduated snooze scoring replaced by friction-slot deduction model.
   * ════════════════════════════════════════════════════════════ */
  function calculateSleep() {
    var now = Date.now();
    if (_sleepScoreCache && (now - _sleepScoreCacheTs) < _STRIP_CACHE_TTL) return _sleepScoreCache;

    var bedStreak = 0;
    if (IS_NATIVE) { try { bedStreak = (JSON.parse(N.getBedtimeStreak()||'{}') || {}).streak || 0; } catch(_){} }

    var cfg   = typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {};
    var nowH  = new Date().getHours() + new Date().getMinutes()/60;
    var wakeH = (cfg.wakeHour != null ? cfg.wakeHour : 7)  + (cfg.wakeMinute || 0)/60;
    var bedH  = (cfg.bedHour  != null ? cfg.bedHour  : 22) + (cfg.bedMinute  || 0)/60;
    var pastWake = bedH > wakeH ? (nowH >= wakeH && nowH < bedH) : (nowH >= wakeH || nowH < bedH);

    // F-22: return pre-wake sentinel with a descriptive reason so UI can show context
    // BUG-13 FIX: Only embed the specific time in the message when the user has actually
    // configured a wake time. Falling back to the default 7 would show "after 7:00 AM"
    // to night-shift workers or unconfigured users, which could be before their real habit.
    if (!pastWake) {
      var wakeTimeLabel = _fmt12h(cfg.wakeHour != null ? cfg.wakeHour : 7, cfg.wakeMinute || 0);
      var preWakeMsg = (cfg.wakeHour != null)
        ? 'Check back after ' + wakeTimeLabel
        : 'Check back later today';
      var r0 = { score: -1, bedStreak: bedStreak, preWakeReason: preWakeMsg };
      _sleepScoreCache = r0; _sleepScoreCacheTs = now;
      return r0;
    }

    var lastNight = null;
    if (IS_NATIVE) { try { if (typeof N.getBedtimeLastNightStats === 'function') lastNight = JSON.parse(N.getBedtimeLastNightStats()||'{}'); } catch(_){} }

    var result;
    if (!lastNight || !lastNight.hasData) {
      result = { score: -1, bedStreak: bedStreak };
    } else {
      var kept          = !!lastNight.bedtimeKept;
      var skipped       = !!lastNight.skippedTonight;
      var inWindowMins  = lastNight.inWindowScreenMins || 0;
      var filterActive  = !!lastNight.filterWasActive;

      // ── Adherence base ───────────────────────────────────────
      var adherePts = kept ? 40 : (skipped ? 15 : 10);

      // ── In-window usage (grace 15 min, then −3 per 5 min, max −30) ──
      // Only meaningful when bedtime was kept; for skipped/missed = 0.
      var inWindowPts = 0;
      if (kept) {
        var GRACE_MINS = 15;
        var overGrace  = Math.max(0, inWindowMins - GRACE_MINS);
        var deduction  = Math.ceil(overGrace / 5) * 3;
        inWindowPts    = Math.max(0, 30 - deduction);
      }

      // ── Friction (snooze + blocked app attempts) — kept only ──
      // BUG-06 FIX: Gate on bedtimeKept. Snooze count of 0 on a missed night
      // is irrelevant and should not award points.
      var snoozePts  = 0;
      var attemptPts = 0;
      var frictionPts = 0;
      if (kept) {
        var snoozeDed  = Math.min((lastNight.snoozeCount  || 0) * 5, 10);
        var attemptDed = Math.min((lastNight.appAttemptsTotal || 0) * 2, 10);
        snoozePts  = Math.max(0, 10 - snoozeDed);    // 0–10
        attemptPts = Math.max(0, 10 - attemptDed);   // 0–10
        frictionPts = snoozePts + attemptPts;         // 0–20
      }

      // ── Streak bonus — kept only ──────────────────────────────
      var streakBonus = kept ? Math.min(12, (bedStreak || 0) * 2) : 0;

      // ── Screen Filter bonus — kept only ──────────────────────
      var filterBonus = (kept && filterActive) ? 3 : 0;

      result = {
        score: Math.min(100, adherePts + inWindowPts + frictionPts + streakBonus + filterBonus),
        adherePts:   adherePts,
        inWindowPts: inWindowPts,
        snoozePts:   snoozePts,
        attemptPts:  attemptPts,
        frictionPts: frictionPts,
        streakBonus: streakBonus,
        filterBonus: filterBonus,
        // Weights for breakdown UI
        adhereW:     40,
        inWindowW:   30,
        frictionW:   20,
        streakW:     12,
        filterW:     3,
        lastNight:   lastNight,
        bedStreak:   bedStreak,
        cfg:         cfg,
      };
    }
    _sleepScoreCache = result; _sleepScoreCacheTs = now;
    return result;
  }

  /* ════════════════════════════════════════════════════════════
   * _getEffectiveSleepScore(res)
   *
   * F-02: Partial HC data is re-normalized — missing oHrvScore no longer
   *       silently caps the achievable score at ~85%.
   *
   * F-08: Priority hierarchy for sleep duration signal:
   *   Tier 1 – HC session overlapping bedtime window → use HC duration
   *   Tier 2 – Bedtime kept (no HC / HC no matching session) → use window hours
   *   Tier 3 – HC session only (no bedtime mode) → use HC duration
   *   Tier 4 – No data → no duration component
   *
   * F-14: HC sleep sessions are filtered to those overlapping the configured
   *       bedtime window when possible, preventing afternoon naps from
   *       influencing the bedtime sleep duration component.
   * ════════════════════════════════════════════════════════════ */
  function _getEffectiveSleepScore(res) {
    if (!res || res.score < 0) {
      // BUG-12 FIX: Even in pre-wake state (score === -1), if the user has a wearable
      // that logged sleep with duration and/or overnight HRV, compute a provisional score
      // from HC data alone so the sleep pillar contributes to the Aurelo composite before
      // the Aurelo bedtime-mode score unlocks after wake time.
      // Weights renormalized from the HC portions only (dur=0.25, oHrv=0.15 → 62.5/37.5).
      if (res && res.score < 0) {
        var _hcProv = null;
        try {
          if (typeof HealthConnect !== 'undefined' && HealthConnect.isConnected() &&
              typeof HealthConnect.getSleepData === 'function') {
            _hcProv = HealthConnect.getSleepData();
          }
        } catch (_) {}
        if (_hcProv && (_hcProv.durScore != null || _hcProv.oHrvScore != null)) {
          var _pW = 0, _pSum = 0;
          if (_hcProv.durScore  != null) { _pSum += _hcProv.durScore  * 0.625; _pW += 0.625; }
          if (_hcProv.oHrvScore != null) { _pSum += _hcProv.oHrvScore * 0.375; _pW += 0.375; }
          if (_pW > 0) return Math.min(100, Math.max(0, Math.round(_pSum / _pW)));
        }
      }
      return -1;
    }

    var hcSleep = null;
    var cfg = res.cfg || (typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {});

    try {
      if (typeof HealthConnect !== 'undefined' && HealthConnect.isConnected() &&
          typeof HealthConnect.getSleepData === 'function') {
        hcSleep = HealthConnect.getSleepData();
      }
    } catch (_) {}

    // F-08: compute Aurelo bedtime window duration proxy
    var aureloWindowHours = null;
    if (res.lastNight && res.lastNight.bedtimeKept && cfg.bedHour != null && cfg.wakeHour != null) {
      var bedH  = cfg.bedHour  + (cfg.bedMinute  || 0) / 60;
      var wakeH = cfg.wakeHour + (cfg.wakeMinute || 0) / 60;
      var windowH = wakeH > bedH ? wakeH - bedH : (24 - bedH) + wakeH;
      if (windowH >= 3 && windowH <= 14) aureloWindowHours = windowH; // sanity bounds
    }

    // F-08 / F-14: choose best available duration signal
    var durScore = null;
    if (hcSleep && hcSleep.durScore != null && aureloWindowHours != null) {
      // Tier 1: HC available + bedtime kept → trust HC (more precise measurement)
      durScore = hcSleep.durScore;
    } else if (aureloWindowHours != null) {
      // Tier 2: Bedtime kept, no HC → derive duration from the configured window
      durScore = _sleepDurationScore(aureloWindowHours);
    } else if (hcSleep && hcSleep.durScore != null) {
      // Tier 3: HC only, no Aurelo bedtime window (bedtime mode off or missed)
      durScore = hcSleep.durScore;
    }

    var oHrvScore = (hcSleep && hcSleep.oHrvScore != null) ? hcSleep.oHrvScore : null;

    // If no enhancement data at all, return base score unchanged
    if (durScore === null && oHrvScore === null) return res.score;

    // F-02: re-normalized blend — totalW accumulates only for present signals
    var totalW = 0.60, weighted = res.score * 0.60;
    if (durScore  != null) { weighted += durScore  * 0.25; totalW += 0.25; }
    if (oHrvScore != null) { weighted += oHrvScore * 0.15; totalW += 0.15; }
    return Math.min(100, Math.max(0, Math.round(weighted / totalW)));
  }

  /* ════════════════════════════════════════════════════════════
   * calculateAurelo()
   *
   * F-01: Fallback weights fixed — removed duplicate implementation.
   *       All weight calculation now delegates to this canonical function.
   *       Fallback in app-home-score.js now calls calculateAurelo() first
   *       before using its own pillar helpers.
   *
   * F-23: Body pillar weight raised from 10% to 15% (Sleep reduced to 20%)
   *       so HC users feel the Body pillar has meaningful impact.
   * ════════════════════════════════════════════════════════════ */
  function calculateAurelo() {
    var d        = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
    var focusRes = calculateFocus(d);

    // ── Kotlin bridge path (single source of truth) ───────────────────────
    // AureloScoreBridge.kt now owns Screen Score, Sleep Score, and composite
    // weight assembly. JS passes the Focus Score (which still needs JS-side
    // timer/pause state from loadStripData) and receives the full composite back.
    // Fallback to the JS-only path if the bridge is unavailable (e.g. dev preview).
    if (IS_NATIVE && typeof N.getAureloScore === 'function') {
      try {
        var r = JSON.parse(N.getAureloScore(focusRes.score >= 0 ? focusRes.score : -1));
        if (r && r.score >= 0) {
          return {
            score:       r.score,
            screenScore: r.screenScore,
            focusScore:  r.focusScore,
            sleepScore:  r.sleepScore,
            hcBodyScore: r.hcBodyScore,
            hcActive:    r.hcActive,
            swScreen:    r.swScreen,
            swFocus:     r.swFocus,
            swSleep:     r.swSleep,
            swBody:      r.swBody,
            sleepEnabled:r.sleepEnabled,
          };
        }
      } catch (_) {}
    }

    // ── JS fallback (non-native / bridge unavailable) ─────────────────────
    var sleepRes = calculateSleep();
    var screenScore = -1;
    if (typeof calculateScreenScoreWithHealthConnect === 'function') {
      try { screenScore = calculateScreenScoreWithHealthConnect().effectiveScore; } catch (_) { screenScore = -1; }
    }
    if (screenScore < 0 && typeof calculateScreenScore === 'function') screenScore = calculateScreenScore().score;

    var effectiveSleepScore = _getEffectiveSleepScore(sleepRes);
    // BUG-05 FIX: When Bedtime Mode is enabled and we're in the pre-wake period, the
    // sleep score returns -1 (sentinel) and the Aurelo composite switches from a 4-pillar
    // to a 3-pillar model, causing a visible score jump at wake time with zero user action.
    // Use yesterday's persisted sleep score as a placeholder to keep weights stable all day.
    // The actual bedtime-mode score unlocks post-wake and replaces this when available.
    if (effectiveSleepScore < 0 && sleepRes && sleepRes.preWakeReason) {
      var _yScore = getYesterdayScore(_SLEEP_SCORE_KEY);
      if (_yScore !== null && _yScore >= 0) effectiveSleepScore = _yScore;
    }
    var sleepEnabled = effectiveSleepScore >= 0;

    var hcBodyScore = -1, hcActive = false;
    if (typeof HealthConnect !== 'undefined' && HealthConnect.isConnected()) {
      hcBodyScore = HealthConnect.getBodyScore();
      hcActive    = hcBodyScore >= 0;
    }

    var swScreen, swFocus, swSleep, swBody;
    if (hcActive) {
      swSleep  = sleepEnabled ? 20 : 0;
      swScreen = sleepEnabled ? 35 : 46;
      swFocus  = sleepEnabled ? 30 : 39;
      swBody   = 15;
    } else {
      swSleep  = sleepEnabled ? 25 : 0;
      swScreen = sleepEnabled ? 40 : 55;
      swFocus  = sleepEnabled ? 35 : 45;
      swBody   = 0;
    }

    var parts = [], weights = [];
    if (screenScore >= 0)    { parts.push(screenScore * swScreen);         weights.push(swScreen); }
    if (focusRes.score >= 0) { parts.push(focusRes.score * swFocus);        weights.push(swFocus);  }
    if (sleepEnabled)        { parts.push(effectiveSleepScore * swSleep);   weights.push(swSleep);  }
    if (hcActive)            { parts.push(hcBodyScore * swBody);            weights.push(swBody);   }

    var totalW = weights.reduce(function(a, b) { return a + b; }, 0);
    var score  = totalW === 0 ? -1 : Math.round(parts.reduce(function(a, b) { return a + b; }, 0) / totalW);

    return {
      score, screenScore, focusScore: focusRes.score,
      sleepScore: effectiveSleepScore, hcBodyScore, hcActive,
      swScreen, swFocus, swSleep, swBody, sleepEnabled,
    };
  }

  /* ── Score persistence ─────────────────────────────────────── */
  function saveScoreForToday(key, score) {
    if (score < 0) return;
    var today = new Date().toISOString().slice(0,10);
    var raw = {};
    try { var s = IS_NATIVE && N.getStringPref ? N.getStringPref(key) : localStorage.getItem(key); raw = JSON.parse(s||'{}'); } catch(_) {}
    if (raw[today] === score) return;
    raw[today] = score;
    // Keep all daily history — no cap. Scores are tiny integers; even 5 years
    // of data per key stays well under 20 KB. The 8-day ceiling that was here
    // has been removed so the history chart can show 7D / 30D / 90D / 1Y views.
    try { if (IS_NATIVE && N.setStringPref) N.setStringPref(key, JSON.stringify(raw)); else localStorage.setItem(key, JSON.stringify(raw)); } catch(_) {}
  }

  function getYesterdayScore(key) {
    var yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    var yStr = yesterday.toISOString().slice(0,10);
    try { var s = IS_NATIVE && N.getStringPref ? N.getStringPref(key) : localStorage.getItem(key); var raw = JSON.parse(s||'{}'); return raw[yStr] !== undefined ? raw[yStr] : null; } catch(_) { return null; }
  }

  /* ── Focus streak ──────────────────────────────────────────── */
  function getFocusStreak() {
    try { var s = IS_NATIVE && N.getStringPref ? N.getStringPref(_FOCUS_STREAK_KEY) : localStorage.getItem(_FOCUS_STREAK_KEY); return JSON.parse(s||'{"count":0,"lastDate":""}'); } catch(_) { return {count:0,lastDate:''}; }
  }

  /* F-11: Streak via timer path now requires ≥2 timers configured (not 1).
   *       A single overnight timer for an unused app was earning the streak
   *       without any meaningful engagement. */
  function maybeEarnFocusStreak(d) {
    var daily = {};
    if (IS_NATIVE && typeof N.getFocusDailyStats === 'function') {
      try { daily = JSON.parse(N.getFocusDailyStats() || '{}'); } catch(_) {}
    }
    var completedToday = daily.completedToday || 0;
    var earned = (completedToday > 0)                                    // completed a session today
              // BUG-2 FIX: added (d.timerUsedCount || 0) > 0 so the timer path requires
              // at least one monitored app was actually opened. Previously, just having 2
              // timers configured and never touching the apps earned the streak daily.
              || (d.timerTotal >= 2 && d.timerOverCount === 0 && (d.timerUsedCount || 0) > 0)
              || (d.pauseCount >= 3 && d.resistCount > 0);               // mindful: requires ≥3 pauses
    if (!earned) return;
    var today = new Date().toISOString().slice(0,10), cur = getFocusStreak();
    if (cur.lastDate === today) return;
    var yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    var yStr = yesterday.toISOString().slice(0,10);
    var newCount = (cur.lastDate === yStr) ? cur.count + 1 : 1;
    var earnedDates = Array.isArray(cur.earnedDates) ? cur.earnedDates.slice() : [];
    if (earnedDates.indexOf(today) === -1) earnedDates.push(today);
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate()-6);
    earnedDates = earnedDates.filter(function(ed) { return ed >= cutoff.toISOString().slice(0,10); });
    var updated = { count: newCount, lastDate: today, earnedDates };
    try { if (IS_NATIVE && N.setStringPref) N.setStringPref(_FOCUS_STREAK_KEY, JSON.stringify(updated)); else localStorage.setItem(_FOCUS_STREAK_KEY, JSON.stringify(updated)); } catch(_) {}
  }

  /* ── Static row builder ────────────────────────────────────── */
  function _buildStaticRowHtml(opts) {
    var todayIdx = new Date().getDay(), dayLetters = ['S','M','T','W','T','F','S'], orderIdx = [1,2,3,4,5,6,0];
    var squares = orderIdx.map(function(i) {
      var isToday = i === todayIdx, filled = opts.days7 && opts.days7[i];
      var bg, border, textCol;
      if (filled)       { bg = 'var(--p)';                   border = 'none';                              textCol = '#fff'; }
      else if (isToday) { bg = 'rgba(108,99,255,.15)';       border = '1px solid rgba(108,99,255,.45)';   textCol = 'var(--p2)'; }
      else              { bg = 'var(--s2)';                  border = '1px solid var(--border2)';         textCol = 'var(--t3)'; }
      var inner = filled ? '✓' : (isToday ? '–' : '·');
      return '<div style="width:22px;height:22px;border-radius:6px;background:'+bg+';border:'+border+';display:flex;align-items:center;justify-content:center;flex-direction:column;flex-shrink:0">'
        + '<div style="font-family:var(--ff-m);font-size:7px;color:'+textCol+';opacity:.7;letter-spacing:.3px">'+dayLetters[i]+'</div>'
        + '<div style="font-family:var(--ff-m);font-size:9px;color:'+textCol+';line-height:1">'+inner+'</div>'
        + '</div>';
    }).join('');
    // F-18: use unified grade colors
    var g = _unifiedGrade(opts.score >= 0 ? opts.score : 0);
    var scoreColor = opts.score >= 0 ? g.color : 'var(--t3)';
    var scoreDisp  = opts.score >= 0 ? opts.score : '–';
    return '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:11px 13px;overflow:hidden">'
      + '<div style="display:flex;align-items:center;gap:6px">'+squares
      + '<div style="flex:1"></div>'
      + '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">'
        + '<span style="font-size:14px">🔥</span>'
        + '<div><div style="font-family:var(--ff-m);font-size:14px;font-weight:700;color:var(--a);line-height:1">'+(opts.streak||0)+'</div>'
        + '<div style="font-family:var(--ff-m);font-size:8px;color:var(--t3);margin-top:1px">'+(opts.streakLabel||'days')+'</div></div></div>'
      + '<div onclick="'+opts.onScoreTap+'" style="cursor:pointer;text-align:right;flex-shrink:0;'
        + 'padding:4px 8px;border-radius:8px;background:rgba(108,99,255,.1);border:1px solid rgba(108,99,255,.2);min-width:52px;max-width:60px;box-sizing:border-box">'
        + '<div style="font-family:var(--ff-m);font-size:9px;color:var(--p2);letter-spacing:.5px">SCORE</div>'
        + '<div style="font-family:var(--ff-d);font-size:18px;font-weight:700;color:'+scoreColor+';line-height:1">'+scoreDisp+'</div>'
        + (opts.hcActive ? '<div style="font-family:var(--ff-m);font-size:7px;color:var(--hc);letter-spacing:.3px;margin-top:1px">HC</div>' : '')
      + '</div></div>'
      + (opts.streakEarnLine ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:8px;line-height:1.4">'+opts.streakEarnLine+'</div>' : '')
    + '</div>';
  }

  function renderFocusStaticRow() {
    var el = document.getElementById('focus-static-row'); if (!el) return;
    var d   = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
    var res = calculateFocus(d);
    maybeEarnFocusStreak(d);
    saveScoreForToday(_FOCUS_SCORE_KEY, res.score);
    var streak = getFocusStreak();
    if (Array.isArray(streak.earnedDates)) {
      streak.earnedDates.forEach(function(dateStr) { var dow = new Date(dateStr+'T00:00:00').getDay(); if (d.focusDays) d.focusDays[dow] = true; });
    }
    el.innerHTML = _buildStaticRowHtml({
      days7: d.focusDays, streak: streak.count, streakLabel: 'day streak',
      score: res.score, onScoreTap: 'FocusScore.openFocusScoreSheet()',
      hcActive: res.hcActive,
      streakEarnLine: 'Complete sessions, respect timers & resist pauses today',
    });
  }

  function renderHabitsStaticRow() {
    var el = document.getElementById('habits-static-row'); if (!el) return;
    var res = calculateSleep();
    // F-03: save effective (HC-blended) score to history, not raw base score
    var effectiveSleep = _getEffectiveSleepScore(res);
    var scoreToSave    = effectiveSleep >= 0 ? effectiveSleep : res.score;
    if (scoreToSave >= 0) saveScoreForToday(_SLEEP_SCORE_KEY, scoreToSave);

    var d = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
    // Use rolling last-7-days from sleep score history (consistent with Focus streak day pills)
    var habitsBedtimeDays = [false,false,false,false,false,false,false];
    try {
      var _sleepHistRaw = {};
      try { var _sh = IS_NATIVE && N.getStringPref ? N.getStringPref(_SLEEP_SCORE_KEY) : localStorage.getItem(_SLEEP_SCORE_KEY); _sleepHistRaw = JSON.parse(_sh||'{}'); } catch(_) {}
      var _cutoff7 = new Date(); _cutoff7.setDate(_cutoff7.getDate()-6);
      var _cutoff7Str = _cutoff7.toISOString().slice(0,10);
      Object.keys(_sleepHistRaw).forEach(function(dateStr) {
        if (dateStr >= _cutoff7Str && _sleepHistRaw[dateStr] >= 0) {
          habitsBedtimeDays[new Date(dateStr+'T00:00:00').getDay()] = true;
        }
      });
    } catch(_) {}
    try {
      var cfg2   = typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {};
      var nowH2  = new Date().getHours() + new Date().getMinutes()/60;
      var wakeH2 = (cfg2.wakeHour != null ? cfg2.wakeHour : 7) + (cfg2.wakeMinute||0)/60;
      var bedH2  = (cfg2.bedHour  != null ? cfg2.bedHour  : 22) + (cfg2.bedMinute ||0)/60;
      var pastWake2 = bedH2 > wakeH2 ? (nowH2 >= wakeH2 && nowH2 < bedH2) : (nowH2 >= wakeH2 || nowH2 < bedH2);
      if (!pastWake2) habitsBedtimeDays[new Date().getDay()] = false;
    } catch(_) {}
    el.innerHTML = _buildStaticRowHtml({
      days7: habitsBedtimeDays, streak: res.bedStreak || 0, streakLabel: 'night streak',
      score: scoreToSave, onScoreTap: 'FocusScore.openHabitsScoreSheet()',
      streakEarnLine: 'Respect bedtime, no snoozes & keep blocked apps closed',
    });
  }

  /* ── Format helpers ────────────────────────────────────────── */
  function _fmtStripTimer(secsLeft) {
    if (secsLeft < 3600) { var m = Math.floor(secsLeft/60), s = secsLeft%60; return (m<10?'0':'')+m+':'+(s<10?'0':'')+s; }
    var h = Math.floor(secsLeft/3600), mm = Math.floor((secsLeft%3600)/60);
    return mm > 0 ? h+'h '+mm+'m' : h+'h';
  }

  function _fmt12h(h, m) {
    var h12 = h%12===0?12:h%12;
    return h12+':'+(m<10?'0':'')+m+' '+(h>=12?'PM':'AM');
  }

  /* ── Dynamic row event collectors — unchanged ──────────────── */
  function _collectFocusEvents() {
    var events = [], d = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
    var now = new Date();
    var ss  = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
    var nav = "FocusTab._switchFocusSubTab('focus');activateTab('focus')";

    // Tier 1a: live session
    if (ss.active) {
      var secsLeft = Math.max(0, ss.secs||0), totalSecs = ss.totalSecs||1;
      var pct = Math.round(((totalSecs-secsLeft)/totalSecs)*100);
      var diff = typeof FOCUS_DIFF!=='undefined'?(FOCUS_DIFF[ss.difficulty]||FOCUS_DIFF.gentle):{color:'var(--p)',label:'🌿 Gentle'};
      var blockedApps = ss.blockedApps||[];
      var chips = blockedApps.slice(0,3).map(function(a) {
        return '<span style="background:'+diff.color+'1a;border:1px solid '+diff.color+'44;border-radius:6px;padding:2px 8px;font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:'+diff.color+'">'+a.name.split(' ')[0]+'</span>';
      }).join('');
      if (blockedApps.length > 3) chips += '<span style="background:'+diff.color+'1a;border:1px solid '+diff.color+'44;border-radius:6px;padding:2px 8px;font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:'+diff.color+'">+'+(blockedApps.length-3)+'</span>';
      var schedName = '';
      if (ss.activeRoutineId && typeof FocusRoutine !== 'undefined') {
        try { var _rt = FocusRoutine.getRoutines().find(function(r){return r.id===ss.activeRoutineId;}); if (_rt) schedName = (_rt.emoji||'')+' '+_rt.name; } catch(_) {}
      }
      var subLine = schedName ? schedName+' · '+diff.label : diff.label;
      events.push({tier:1,id:'session',html:
        '<div onclick="'+nav+'" style="background:var(--s2);border:1px solid '+diff.color+';border-radius:16px;padding:12px 14px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
        +'<div style="display:flex;align-items:center;gap:12px;'+(chips?'margin-bottom:10px':'')+'">'
        +'<div style="width:36px;height:36px;border-radius:10px;background:'+diff.color+'1a;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
        +'<div style="width:9px;height:9px;border-radius:50%;background:'+diff.color+';animation:fs-pulse 2s ease-in-out infinite"></div>'
        +'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1);margin-bottom:2px">Focus Mode Active</div>'
        +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">'+subLine+'</div>'
        +'</div>'
        +'<div class="fs-live-timer" style="font-family:var(--ff-m);font-size:22px;font-weight:700;color:'+diff.color+';letter-spacing:-1px;flex-shrink:0;line-height:1">'+_fmtStripTimer(secsLeft)+'</div>'
        +'</div>'
        +(chips?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">'+chips+'</div>':'')
        +'<div style="height:4px;background:var(--border2);border-radius:999px;overflow:hidden">'
        +'<div class="fs-live-bar" style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,'+diff.color+'88,'+diff.color+');border-radius:999px;transition:width .5s linear"></div></div>'
        +'</div>'
      });
    }

    // Tier 1b: timer over limit
    var limits = S.limits||{}, usageMap = {};
    if (typeof DAILY_USE !== 'undefined') DAILY_USE.forEach(function(u){usageMap[u.packageName]=u.totalMinutes||0;});
    var overPkgs = Object.keys(limits).filter(function(pkg){return (usageMap[pkg]||0)>=limits[pkg];});
    overPkgs.sort(function(a,b){return((usageMap[b]||0)-limits[b])-((usageMap[a]||0)-limits[a]);});
    overPkgs.forEach(function(pkg) {
      var name = (typeof DAILY_USE!=='undefined'&&(DAILY_USE.find(function(u){return u.packageName===pkg;})||{}).name)||pkg.split('.').pop();
      var over = fmtM((usageMap[pkg]||0)-limits[pkg]);
      var more = overPkgs.length > 1 && overPkgs[0] === pkg ? ' <span style="color:var(--t3)">+'+(overPkgs.length-1)+' more</span>' : '';
      events.push({tier:1,id:'timer_over_'+pkg,html:
        '<div onclick="'+nav+'" style="background:rgba(240,78,122,.08);border:1px solid rgba(240,78,122,.28);border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
        +'<div style="width:7px;height:7px;border-radius:50%;background:var(--r);flex-shrink:0"></div>'
        +'<div style="flex:1;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--r);line-height:1.45">'
        +'<span style="font-weight:600">'+name+'</span> limit reached · +'+over+more+'</div>'
        +'</div>'
      });
    });
    if (events.some(function(e){return e.tier===1;})) return events;

    // Tier 2a: timer approaching
    var warnPkgs = Object.keys(limits).filter(function(pkg){ var u=usageMap[pkg]||0,l=limits[pkg],p2=l>0?u/l:0; return p2>=0.8&&p2<1; });
    warnPkgs.sort(function(a,b){return(usageMap[b]||0)/limits[b]-(usageMap[a]||0)/limits[a];});
    if (warnPkgs.length) {
      var wp = warnPkgs[0];
      var wname = (typeof DAILY_USE!=='undefined'&&(DAILY_USE.find(function(u){return u.packageName===wp;})||{}).name)||wp.split('.').pop();
      var wleft = fmtM(Math.max(0, limits[wp]-(usageMap[wp]||0)));
      var wmore = warnPkgs.length > 1 ? ' <span style="color:var(--t3)">+'+(warnPkgs.length-1)+' more</span>' : '';
      events.push({tier:2,id:'timer_warn_'+wp,html:
        '<div onclick="'+nav+'" style="background:rgba(247,166,35,.08);border:1px solid rgba(247,166,35,.25);border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
        +'<div style="width:7px;height:7px;border-radius:50%;background:var(--a);flex-shrink:0"></div>'
        +'<div style="flex:1;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--a);line-height:1.45">'
        +'<span style="font-weight:600">'+wname+'</span> · '+wleft+' remaining today'+wmore+'</div>'
        +'</div>'
      });
    }

    // Tier 2b: routine soon
    if (!events.some(function(e){return e.tier===2;})) {
      var routines = typeof FocusRoutine !== 'undefined' ? FocusRoutine.getRoutines() : [];
      var nowMins  = now.getHours()*60 + now.getMinutes();
      routines.forEach(function(r) {
        if (!r.enabled) return;
        var rH = r.startHour||r.hour||0, rM = r.startMin||r.minute||0;
        var sMins = rH*60+rM, diff2 = sMins-nowMins;
        if (diff2 > 0 && diff2 <= 60) {
          var appsCount = (r.blockedApps||[]).length;
          var appsBit   = appsCount > 0 ? ' · '+appsCount+' app'+(appsCount!==1?'s':'') : '';
          events.push({tier:2,id:'routine_soon_'+r.id,html:
            '<div onclick="'+nav+'" style="background:rgba(108,99,255,.09);border:1px solid rgba(108,99,255,.28);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
            +'<div style="width:36px;height:36px;border-radius:10px;background:rgba(108,99,255,.16);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">📅</div>'
            +'<div style="flex:1;min-width:0">'
            +'<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1);margin-bottom:2px">'+(r.name||'Focus session')+' at '+_fmt12h(rH,rM)+'</div>'
            +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Starting soon'+appsBit+'</div>'
            +'</div>'
            +'<div style="font-size:18px;color:rgba(108,99,255,.6);flex-shrink:0;line-height:1">›</div>'
            +'</div>'
          });
        }
      });
    }
    if (events.some(function(e){return e.tier===2;})) return events;

    // Tier 3a: post-session summary
    var lt = typeof FocusTab !== 'undefined' ? FocusTab.getLastState() : {};
    if (lt.state && lt.ts && (Date.now()-lt.ts) < 600000) {
      var isComplete = lt.state === 'completed';
      var pCol = isComplete ? 'rgba(18,212,138,.28)' : 'rgba(247,166,35,.25)';
      var pBg2 = isComplete ? 'rgba(18,212,138,.08)' : 'rgba(247,166,35,.08)';
      var pDot = isComplete ? 'var(--g)' : 'var(--a)';
      var txt3 = isComplete
        ? 'Session complete · '+fmtM(lt.totalMins||0)+' focused'
        : 'Session ended early · '+fmtM(lt.elapsedMins||0)+' of '+fmtM(lt.totalMins||0);
      events.push({tier:3,id:'post_session',html:
        '<div style="background:'+pBg2+';border:1px solid '+pCol+';border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px">'
        +'<div style="width:7px;height:7px;border-radius:50%;background:'+pDot+';flex-shrink:0"></div>'
        +'<div style="flex:1;font-family:var(--ff-m);font-size:var(--text-2xs);color:'+(isComplete?'var(--g)':'var(--a)')+';line-height:1.45;font-weight:600">'+txt3+'</div>'
        +'</div>'
      });
    }

    // Tier 3b: weekly challenge almost done
    if (d.challengeLabel && d.challengeDone !== undefined) {
      var remaining = (d.challengeTarget - d.challengeDone);
      if (remaining <= 1 && remaining > 0) {
        events.push({tier:3,id:'challenge_close',html:
          '<div onclick="'+nav+'" style="background:rgba(247,201,72,.08);border:1px solid rgba(247,201,72,.22);border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
          +'<div style="width:7px;height:7px;border-radius:50%;background:#f7c948;flex-shrink:0"></div>'
          +'<div style="flex:1;font-family:var(--ff-m);font-size:var(--text-2xs);color:#c4982e;line-height:1.45">'
          +'<span style="font-weight:600">'+d.challengeDone+'/'+d.challengeTarget+'</span> — '+remaining+' more to complete this week\'s challenge</div>'
          +'</div>'
        });
      }
    }
    return events;
  }

  function _collectHabitsEvents() {
    var events = [], now = new Date(), nowH = now.getHours()+now.getMinutes()/60;
    var cfg  = typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {};
    var bedH = (cfg.bedHour  != null ? cfg.bedHour  : 22) + (cfg.bedMinute ||0)/60;
    var wakeH= (cfg.wakeHour != null ? cfg.wakeHour : 7)  + (cfg.wakeMinute||0)/60;
    var nav  = "FocusTab._switchFocusSubTab('habits');activateTab('focus')";
    var fmt12 = function(dec){var h24=Math.floor(dec%24),mm=Math.round((dec%1)*60),h12=h24%12||12;return h12+':'+(mm<10?'0':'')+mm+' '+(h24<12?'AM':'PM');};
    // ISSUE-3 FIX: tracks whether we fell through from a skipped bedtime window.
    // Used below to suppress the screen filter strip during an active-but-skipped window.
    var _skippedInWindow = false;

    var inWindow = false;
    if (cfg.enabled) {
      if (IS_NATIVE && typeof N.isInBedtimeWindow === 'function') {
        try { inWindow = !!N.isInBedtimeWindow(); } catch (_) {
          inWindow = bedH > wakeH ? (nowH >= bedH || nowH < wakeH) : (nowH >= bedH && nowH < wakeH);
        }
      } else {
        inWindow = bedH > wakeH ? (nowH >= bedH || nowH < wakeH) : (nowH >= bedH && nowH < wakeH);
      }
    }

    // Tier 1: bedtime window active
    // BUG-3 FIX: also check isBedtimeSkippedTonight() so that pressing "Turn Off"
    // from the bedtime notification immediately hides this strip even while the
    // configured bedtime window is still active (e.g. user turns off at 11 pm
    // but window runs until 7 am). Without this check the strip showed "Bedtime
    // mode on" for the rest of the night after the user explicitly dismissed it.
    if (cfg.enabled && inWindow) {
      // Check skip-tonight flag via FocusBedtime (uses local optimistic OR native pref)
            // so pressing "Done for tonight" immediately removes the active card.
            var _skippedNow = typeof FocusBedtime !== 'undefined' && typeof FocusBedtime.isSkippedTonight === 'function'
              ? FocusBedtime.isSkippedTonight()
              : (IS_NATIVE && typeof N.isBedtimeSkippedTonight === 'function' && !!N.isBedtimeSkippedTonight());
            if (_skippedNow) {
              // Skipped tonight — fall through to wind-down / screen-filter / next-bedtime tiers
              // ISSUE-3 FIX: track that we fell through from a skipped bedtime window so we
              // can suppress the screen filter strip (bedtime window is still technically active).
              var _skippedInWindow = true;
            } else {
      var blockedCount = Array.isArray(cfg.blockedApps) ? cfg.blockedApps.length : 0;
      var snoozeEndsAt = 0;
      try { if (IS_NATIVE && typeof N.getBedtimeSnoozeEndsAt === 'function') snoozeEndsAt = N.getBedtimeSnoozeEndsAt() || 0; } catch(_) {}
      var snoozeActive = snoozeEndsAt > Date.now(), snoozeMins = snoozeActive ? Math.ceil((snoozeEndsAt-Date.now())/60000) : 0;
      var bedStreakN = 0;
      try { if (IS_NATIVE && typeof N.getBedtimeStreak === 'function') bedStreakN = (JSON.parse(N.getBedtimeStreak()||'{}')||{}).streak||0; } catch(_) {}
      var streakPill = bedStreakN > 1
        ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:#7a80ff;background:rgba(80,100,255,.16);border-radius:99px;padding:3px 9px;flex-shrink:0;white-space:nowrap">🔥 '+bedStreakN+'</div>' : '';
      var snoozeBtn = snoozeActive
        ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:var(--t3);background:var(--s3);border-radius:99px;padding:4px 10px;flex-shrink:0;white-space:nowrap;cursor:default;opacity:.55">⏱ '+snoozeMins+'m</div>'
        : '<div onclick="event.stopPropagation();snoozeBedtimePrompt()" style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:#7a80ff;background:rgba(80,100,255,.16);border-radius:99px;padding:4px 10px;flex-shrink:0;white-space:nowrap;cursor:pointer">Snooze</div>';
      events.push({tier:1,id:'bedtime_active',html:
        '<div onclick="'+nav+'" style="background:rgba(80,100,255,.09);border:1px solid rgba(100,120,255,.25);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
        +'<div style="width:36px;height:36px;border-radius:10px;background:rgba(80,100,255,.16);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🌙</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1);margin-bottom:2px">Bedtime mode on · '+blockedCount+' app'+(blockedCount!==1?'s':'')+' blocked</div>'
        +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Wake up at '+fmt12(wakeH)+'</div>'
        +'</div>'+streakPill+snoozeBtn+'</div>'
      });
      return events;
      } // end: !_skippedTonight — fall through to show next-bedtime tiers
    }

    // Tier 2a: wind-down
    if (cfg.enabled && !inWindow) {
      var minsU = (bedH - nowH) * 60; if (minsU < 0) minsU += 1440;
      if (minsU <= 60 && minsU > 0) {
        var btStreak2 = 0;
        try { if (IS_NATIVE && typeof N.getBedtimeStreak === 'function') btStreak2 = (JSON.parse(N.getBedtimeStreak()||'{}')||{}).streak||0; } catch(_) {}
        var urgency = minsU <= 30 ? 'Wind down now' : 'Wind down soon';
        var streakNote = btStreak2 > 0 ? ' · 🔥 <span style="font-weight:600">'+btStreak2+'</span>-night streak' : '';
        events.push({tier:2,id:'wind_down',html:
          '<div onclick="'+nav+'" style="background:rgba(80,100,255,.09);border:1px solid rgba(100,120,255,.25);border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
          +'<div style="width:7px;height:7px;border-radius:50%;background:#7a80ff;flex-shrink:0"></div>'
          +'<div style="flex:1;font-family:var(--ff-m);font-size:var(--text-2xs);color:#7a80ff;line-height:1.45">'
          +'<span style="font-weight:600">'+urgency+'</span> · Bedtime at '+fmt12(bedH)+' in '+Math.round(minsU)+'m'+streakNote+'</div>'
          +'</div>'
        });
      }
    }

    // Tier 2b: screen filter active — same priority as home habits strip
    // ISSUE-3 FIX: suppress screen filter strip when bedtime is active but skipped
    // tonight. The bedtime window is technically still open, so inWindow=true means
    // Tier 2a (wind-down, !inWindow) never fires either — fall straight to Tier 3.
    if (!events.length && !_skippedInWindow) {
      try {
        if (typeof ScreenFilter !== 'undefined') {
          var sfCfg3 = ScreenFilter.getCfg();
          var sfActive3 = IS_NATIVE && typeof N.isScreenFilterActive === 'function'
            ? !!N.isScreenFilterActive() : (sfCfg3.enabled && !sfCfg3.paused);
          if (sfActive3) {
            var sfPreset3 = { soft: 'Soft', medium: 'Medium', bedtime: 'Bedtime', custom: 'Custom' }[sfCfg3.preset] || 'On';
            var sfEndStr3 = typeof ScreenFilter.getEndStr === 'function' ? ScreenFilter.getEndStr(sfCfg3) : 'Active';
            events.push({ tier: 2, id: 'screen_filter_active', html:
              '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:rgba(5,200,232,.09);border:1px solid rgba(5,200,232,.26);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
              + '<div style="width:36px;height:36px;border-radius:10px;background:rgba(5,200,232,.18);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🌊</div>'
              + '<div style="flex:1;min-width:0">'
              + '<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1);margin-bottom:2px">Screen Filter Active <span style="font-family:var(--ff-m);font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(5,200,232,.15);color:#05C8E8;margin-left:5px">' + sfPreset3 + '</span></div>'
              + '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">' + sfEndStr3 + '</div>'
              + '</div>'
              + '<div onclick="event.stopPropagation();if(typeof ScreenFilter!==undefined)ScreenFilter._togMaster()" style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:rgba(5,200,232,.9);border:1px solid rgba(5,200,232,.3);border-radius:8px;padding:5px 10px;cursor:pointer;white-space:nowrap;background:rgba(5,200,232,.08);flex-shrink:0">Off</div>'
              + '</div>'
            });
          }
        }
      } catch (_) {}
    }

    // Tier 2c: challenge at risk
    var d = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
    if (!events.length && d.challengeLabel && d.challengeDone !== undefined) {
      var daysLeft = 7 - new Date().getDay(), needed = d.challengeTarget - d.challengeDone;
      if (needed > 0 && needed >= daysLeft) {
        events.push({tier:2,id:'challenge_risk',html:
          '<div onclick="'+nav+'" style="background:rgba(247,166,35,.08);border:1px solid rgba(247,166,35,.25);border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
          +'<div style="width:7px;height:7px;border-radius:50%;background:var(--a);flex-shrink:0"></div>'
          +'<div style="flex:1;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--a);line-height:1.45">'
          +'<span style="font-weight:600">Challenge at risk</span> · '+daysLeft+' day'+(daysLeft!==1?'s':'')+' left to complete</div>'
          +'</div>'
        });
      }
    }
    if (events.some(function(e){return e.tier===2;})) return events;

    // Tier 3a: morning summary
    var h = now.getHours();
    if (h >= 6 && h < 11) {
      var sr = calculateSleep();
      if (sr.lastNight && sr.lastNight.hasData) {
        var ln = sr.lastNight;
        var keptColor = ln.bedtimeKept ? 'var(--g)' : 'var(--r)';
        var keptTxt   = ln.bedtimeKept ? 'Bedtime kept ✓' : 'Bedtime missed';
        var parts2 = [];
        if ((ln.appAttemptsTotal||0) > 0) parts2.push(ln.appAttemptsTotal+' app attempt'+(ln.appAttemptsTotal!==1?'s':''));
        else if (ln.bedtimeKept)           parts2.push('0 app attempts');
        if ((ln.snoozeCount||0) > 0)       parts2.push(ln.snoozeCount+' snooze'+(ln.snoozeCount!==1?'s':''));
        var subTxt2 = parts2.length ? parts2.join(' · ') : 'Clean night ✨';
        var sleepStreakPill = sr.bedStreak > 0
          ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:#7a80ff;background:rgba(80,100,255,.16);border-radius:99px;padding:3px 9px;flex-shrink:0;white-space:nowrap">🔥 '+sr.bedStreak+'</div>' : '';
        var dismissBtn = '<div onclick="event.stopPropagation();'+(typeof FocusHome!=='undefined'?'FocusHome.dismissMorningSummary()':'')+'" style="font-size:18px;color:var(--t3);cursor:pointer;padding:0 2px;flex-shrink:0;line-height:1">×</div>';
        events.push({tier:3,id:'morning_summary',html:
          '<div onclick="'+nav+'" style="background:rgba(80,100,255,.09);border:1px solid rgba(100,120,255,.25);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
          +'<div style="width:36px;height:36px;border-radius:10px;background:rgba(80,100,255,.16);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🌅</div>'
          +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:var(--text-sm);font-weight:600;color:'+keptColor+';margin-bottom:2px">Last night · '+keptTxt+'</div>'
          +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">'+subTxt2+'</div>'
          +'</div>'+sleepStreakPill+dismissBtn+'</div>'
        });
      }
    }

    // Tier 3b: challenge milestone
    if (d.challengeLabel && d.challengeDone !== undefined && d.challengeDone > 0 && d.challengeDone < d.challengeTarget) {
      events.push({tier:3,id:'challenge_milestone',html:
        '<div onclick="'+nav+'" style="background:rgba(18,212,138,.08);border:1px solid rgba(18,212,138,.28);border-radius:16px;padding:11px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:opacity .15s" ontouchstart="this.style.opacity=\'.75\'" ontouchend="this.style.opacity=\'1\'">'
        +'<div style="width:7px;height:7px;border-radius:50%;background:var(--g);flex-shrink:0"></div>'
        +'<div style="flex:1;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--g);line-height:1.45">'
        +'<span style="font-weight:600">'+d.challengeDone+' of '+d.challengeTarget+' days done</span> · On track this week</div>'
        +'</div>'
      });
    }
    return events;
  }

  function _showQueuedEvents(elId) {
    var el = document.getElementById(elId);
    if (!el || !el._queuedEvents || !el._queuedEvents.length) return;
    var items = el._queuedEvents.map(function(e){return e.html;}).join('<div style="height:8px"></div>');
    if (typeof showConfirm === 'function') {
      showConfirm('Other active events','\u00a0',function(){},'Close',null);
      var body = document.getElementById('cdlg-body');
      if (body) body.innerHTML = items;
    }
  }

  function _renderDynamicRow(elId, events) {
    var el = document.getElementById(elId); if (!el) return;
    if (!events.length) { el.innerHTML=''; el.style.display='none'; return; }
    el.style.display = '';
    var top = events[0], moreCount = events.length-1;
    var moreBadge = moreCount > 0 ? '<div onclick="FocusScore.showQueuedEvents(\''+elId+'\')" style="position:absolute;top:6px;right:6px;font-family:var(--ff-m);font-size:9px;color:var(--t2);background:var(--s1);border:1px solid var(--border2);border-radius:6px;padding:2px 6px;cursor:pointer">+'+moreCount+' more</div>' : '';
    el.innerHTML = '<div style="position:relative">'+top.html+moreBadge+'</div>';
    el._queuedEvents = events.slice(1);
  }

  function renderFocusDynamicRow()  { _renderDynamicRow('focus-dynamic-row',  _collectFocusEvents()); }
  function renderHabitsDynamicRow() { _renderDynamicRow('habits-dynamic-row', _collectHabitsEvents()); }

  /* ── Score sheet builder ───────────────────────────────────── */
  function _buildScoreSheet(opts) {
    // F-18: use unified grade
    var g = _unifiedGrade(opts.score >= 0 ? opts.score : 0);
    var gradeColor = opts.score >= 0 ? g.color : 'var(--t3)';
    var yScore = getYesterdayScore(opts.scoreKey), deltaHtml = '';
    if (yScore !== null && opts.score >= 0) {
      var diff = opts.score - yScore, dCol = diff >= 0 ? 'var(--g)' : 'var(--r)', dSign = diff >= 0 ? '↑' : '↓';
      deltaHtml = '<span style="font-family:var(--ff-m);font-size:12px;font-weight:700;color:'+dCol+';margin-left:8px">'+dSign+Math.abs(diff)+' from yesterday</span>';
    }
    var componentsHtml = opts.components.map(function(c) {
      var bf = c.maxPts > 0 ? Math.round((c.pts/c.maxPts)*100) : 0;
      var cColor = bf >= 70 ? 'var(--g)' : bf >= 40 ? 'var(--a)' : 'var(--r)';
      return '<div style="margin-bottom:16px"><div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3px"><div style="font-size:13px;font-weight:700;color:var(--t1)">'+c.label+'</div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">weighted '+c.weight+'%</div></div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);margin-bottom:6px">'+c.dataLine+'</div><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+bf+'%;background:'+cColor+';border-radius:3px;transition:width .4s"></div></div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:'+cColor+';flex-shrink:0">+'+c.pts+' pts</div></div></div>';
    }).join('');
    var improvHtml = (opts.improvements||[]).length
      ? '<div style="height:1px;background:var(--border);margin:4px 0 16px"></div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.8px;margin-bottom:12px">HOW TO IMPROVE</div>'
        + (opts.improvements||[]).map(function(im) {
            return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px"><div style="font-family:var(--ff-m);font-size:12px;color:var(--t2);flex:1;line-height:1.5">'+im.text+'</div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:var(--g);flex-shrink:0;white-space:nowrap">+'+im.impact+' pts</div></div>';
          }).join('')
      : '';
    return '<div id="score-sheet-backdrop" role="presentation" style="position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:9998;display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .25s;pointer-events:none" onclick="if(event.target===this)FocusScore.closeScoreSheet()">'
      + '<div id="score-sheet" role="dialog" aria-modal="true" aria-label="Score breakdown" style="width:100%;max-width:480px;background:var(--s0);border-radius:24px 24px 0 0;border:1px solid var(--border2);border-bottom:none;padding:12px 20px 44px;padding-bottom:max(44px,calc(env(safe-area-inset-bottom,0px) + 24px));box-sizing:border-box;transform:translate3d(0,100%,0);backface-visibility:hidden;will-change:transform;contain:layout paint;transition:transform .3s cubic-bezier(.32,.72,0,1);max-height:88vh;overflow-y:auto">'
      + '<div style="width:40px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 18px"></div>'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">'
        + '<div style="flex:1">'
          + '<div style="font-family:var(--ff-d);font-size:20px;font-weight:700;color:var(--t1);letter-spacing:-.3px">'+opts.title+'</div>'
        + '</div>'
        + '<div style="text-align:right;flex-shrink:0">'
          + '<span style="font-family:var(--ff-d);font-size:32px;font-weight:700;color:'+gradeColor+';line-height:1">'+(opts.score>=0?opts.score:'–')+'</span>'
          + '<div style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px;margin-top:4px">'
            + (opts.score >= 0 ? '<span style="font-family:var(--ff-m);font-size:13px;font-weight:600;color:'+gradeColor+'">'+g.label+'</span>' : '')
            + deltaHtml
          + '</div>'
        + '</div>'
      + '</div>'
      + '<div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:20px"><div style="height:100%;width:'+Math.max(0,opts.score)+'%;background:linear-gradient(90deg,var(--p),var(--c));border-radius:3px;transition:width .4s"></div></div>'
      + '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.8px;margin-bottom:14px">HOW THIS IS CALCULATED</div>'
      + componentsHtml + improvHtml
      + '<div style="display:flex;gap:8px;margin-top:4px">'
        + '<button type="button" onclick=\"FocusScore.closeScoreSheet();ScoreHistory.open(\''+(opts.scoreKey===_SLEEP_SCORE_KEY?'sleep':opts.scoreKey==='screen_score_history'?'screen':'focus')+'\')" style="flex:1;padding:12px 14px;border-radius:14px;background:transparent;border:1px solid var(--border2);color:var(--t2);font-family:var(--ff-m);font-size:var(--text-sm);font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">&#128200; View History</button>'
        + '<button type="button" onclick="shareCard(\''+(opts.scoreKey===_SLEEP_SCORE_KEY?'sleep_score':opts.scoreKey==='screen_score_history'?'screen_score':'focus_score')+'\');" style="flex:1;padding:12px 14px;border-radius:14px;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.30);color:var(--p2);font-family:var(--ff-m);font-size:var(--text-sm);font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">📤 Share</button>'
      + '</div></div></div>';
  }

  function closeScoreSheet() {
    var backdrop = document.getElementById('score-sheet-backdrop'), sheet = document.getElementById('score-sheet');
    if (!backdrop) return;
    backdrop.style.opacity = '0'; if (sheet) sheet.style.transform = 'translate3d(0,100%,0)';
    setTimeout(function(){ backdrop && backdrop.remove(); }, 320);
  }

  function _openScoreSheet(html) {
    document.getElementById('score-sheet-backdrop') && document.getElementById('score-sheet-backdrop').remove();
    document.body.insertAdjacentHTML('beforeend', html);
    requestAnimationFrame(function() {
      var backdrop = document.getElementById('score-sheet-backdrop'), sheet = document.getElementById('score-sheet');
      if (!backdrop) return;
      void backdrop.offsetHeight;
      backdrop.style.opacity = '1'; backdrop.style.pointerEvents = 'all';
      if (sheet) sheet.style.transform = 'translate3d(0,0,0)';
    });
  }

  /* ════════════════════════════════════════════════════════════
   * openFocusScoreSheet()
   *
   * F-19: Shows "HC only" state when no Aurelo features are configured
   *       and score is derived purely from HC mindfulness sessions.
   * F-26: Data lines now correctly say "this week" for session data
   *       (previously said "today" but data was weekly cumulative).
   * ════════════════════════════════════════════════════════════ */
  function openFocusScoreSheet() {
    if (typeof ProTier !== 'undefined' && !ProTier.isPro) {
        if (typeof ProTier.triggerUpsell === 'function') ProTier.triggerUpsell('TIDY_SCORE_PILLARS');
        return;
      }
    var d   = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
    var res = calculateFocus(d);
    if (res.score < 0) { toast('No focus data yet — start a session to build your score', 'info'); return; }

    var improvements = [];
    if (res.sessW > 0 && res.sessPts < res.sessW)     improvements.push({text:'Complete your next focus session without interruption',         impact: Math.round((res.sessW-res.sessPts)*.5)});
    if (res.timerW > 0 && res.timerPts < res.timerW)  improvements.push({text:'Respect all active app timers for the rest of today',           impact: Math.round((res.timerW-res.timerPts)*.6)});
    if (res.mindfulW > 0 && res.mindfulPts < res.mindfulW) improvements.push({text:'Resist the next mindful pause instead of proceeding',       impact: Math.round((res.mindfulW-res.mindfulPts)*.5)});

    var components = [];
    // F-26: session data line uses today's daily counts; fallback to weekly label only
    // when there are truly no sessions today (post BUG-1 fix this branch is now dead code
    // but kept as a display-only safety net in case bridge is unavailable).
    if (res.sessW > 0) {
      var sessDataLine = res.totalSessions > 0
        ? res.completedToday + ' of ' + res.totalSessions + ' sessions completed today'
          + (res.plannedMins > 0 ? ' · ' + Math.round(res.elapsedMins / res.plannedMins * 100) + '% duration' : '')
        : (res.weekCompleted + ' of ' + res.weekTotal + ' sessions this week');
      // Engagement hint — shown when sessEngageScale < 1 (short session today)
      var sessEngaged = res.sessEngageScale < 1
        ? ' (aim for 15+ min for full credit)'
        : '';
      components.push({label: 'Sessions', weight: res.sessW, pts: res.sessPts, maxPts: res.sessMax, dataLine: sessDataLine + sessEngaged});
    }
    if (res.timerW > 0) {
      var timerUsed = d.timerUsedCount || d.timerTotal;
      var timerEngaged = d.timerTotal >= 2 ? '' : ' (1 timer — set 2+ for full score)';
      components.push({label: 'App Timers', weight: res.timerW, pts: res.timerPts, maxPts: res.timerMax, dataLine: (timerUsed - d.timerOverCount) + ' of ' + timerUsed + ' timers respected today' + timerEngaged});
    }
    if (res.mindfulW > 0) {
      components.push({label: 'Mindful Pause', weight: res.mindfulW, pts: res.mindfulPts, maxPts: res.mindfulMax, dataLine: d.resistCount + ' of ' + d.pauseCount + ' pauses resisted today'});
    }

    // ── Weekly Consistency & Streak Bonus row ──────────────────────────────────
    // Always shown when sessions pillar is active, mirroring the sleep score's
    // Bedtime Streak Bonus row. Surfaces the additive consistency bonus and the
    // focus day-streak so users understand what drives the bonus and how to grow it.
    if (res.sessW > 0) {
      var streakObj   = getFocusStreak();
      var streakDays  = streakObj.count || 0;
      var sBefore     = res.sessionsBeforeToday || 0;
      var bonusPts    = res.weeklyConsistencyBonus || 0;
      var bonusDataLine;
      if (sBefore > 0) {
        bonusDataLine = sBefore + ' session' + (sBefore !== 1 ? 's' : '') + ' completed earlier this week · +'+ bonusPts + ' pts (max +10)';
      } else {
        bonusDataLine = 'Complete sessions on multiple days this week to earn up to +10 pts';
      }
      if (streakDays > 0) {
        bonusDataLine += ' · 🔥 ' + streakDays + '-day streak';
      }
      components.push({
        label:   'Weekly Consistency Bonus',
        weight:  10,
        pts:     bonusPts,
        maxPts:  10,
        dataLine: bonusDataLine,
      });
      // Prompt for consistency if bonus not yet maxed
      if (bonusPts < 10) {
        var needed = Math.ceil((10 - bonusPts) / 4);
        improvements.push({text: 'Complete ' + needed + ' more session' + (needed !== 1 ? 's' : '') + ' on separate days this week for consistency bonus', impact: 10 - bonusPts});
      }
    }

    var sheetHtml = _buildScoreSheet({title: 'Focus Score', score: res.score, scoreKey: _FOCUS_SCORE_KEY, components: components, improvements: improvements.slice(0, 3)});

    // F-19: HC-only mode banner
    if (res.hcOnlyMode) {
      var hcOnlyBanner = '<div style="background:rgba(0,200,200,.07);border:1px solid rgba(0,200,200,.2);border-radius:12px;padding:10px 13px;font-family:var(--ff-m);font-size:var(--text-xs);color:var(--t3);line-height:1.5;margin-bottom:16px">'
        + 'Your Focus Score is based entirely on Health Connect mindfulness sessions. '
        + 'Start a Focus session, set App Timers, or configure Mindful Pauses inside Aurelo to activate the full score.'
        + '</div>';
      sheetHtml = sheetHtml.replace('HOW THIS IS CALCULATED', hcOnlyBanner + 'HOW THIS IS CALCULATED');
    }

    // BUG-5 FIX: single-pillar note now mentions the score cap at 70 so users
    // aren't confused by a sub-100 "Good" score when they've completed their session.
    var _activePillarCount = res.activePillars || ((res.sessW > 0 ? 1 : 0) + (res.timerW > 0 ? 1 : 0) + (res.mindfulW > 0 ? 1 : 0));
    if (_activePillarCount === 1 && !res.hcOnlyMode) {
      var singlePillarNote = '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:12px;padding:10px 13px;font-family:var(--ff-m);font-size:var(--text-xs);color:var(--t3);line-height:1.5;margin-bottom:16px">'
        + '💡 Only one pillar is active — score is capped at 70 to keep the number honest. '
        + 'Set App Timers or configure Mindful Pauses to unlock a richer Focus Score and raise the ceiling to 100.'
        + '</div>';
      sheetHtml = sheetHtml.replace('HOW THIS IS CALCULATED', singlePillarNote + 'HOW THIS IS CALCULATED');
    }

    // HC mindfulness section
    var _hcConnected = typeof HealthConnect !== 'undefined' && HealthConnect.isConnected();
    if (_hcConnected) {
      var hcBadge = '<span style="font-size:var(--text-2xs);color:var(--hc);background:var(--hc-dim);border:1px solid var(--hc-border);border-radius:5px;padding:1px 6px;font-weight:700;letter-spacing:.3px;margin-left:8px;vertical-align:middle">HC</span>';
      sheetHtml = sheetHtml.replace('Focus Score</div>', 'Focus Score'+hcBadge+'</div>');

      var hcSessions = HealthConnect.getMindfulnessSessions();
      var totalHcPts = hcSessions.reduce(function(sum,s){return sum+_hcMindfulCredit(s);},0);
      var sessionRows = hcSessions.length > 0
        ? hcSessions.map(function(s) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
              + '<div style="flex:1"><div style="font-size:var(--text-sm);font-weight:600;color:var(--t1)">'+s.app+'</div>'
              + '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">'+s.type+' · '+s.duration+' min</div></div>'
              + '<div style="font-family:var(--ff-m);font-size:var(--text-xs);font-weight:700;color:var(--hc)">+'+_hcMindfulCredit(s)+' pts</div>'
              + '</div>';
          }).join('')
        : '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);padding:10px 2px">No external mindfulness sessions recorded today.</div>';
      var hcFooter = hcSessions.length > 0
        ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);line-height:1.5;padding:0 2px">Run sessions inside Aurelo for full credit. External sessions earn 50% to reward healthy habits wherever they happen.</div>'
        : '';
      var hcSection = '<div style="margin-bottom:16px">'
        + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">'
          + '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.8px">HEALTH CONNECT · MINDFULNESS</span>'
          + '<span style="font-size:var(--text-2xs);color:var(--hc);background:var(--hc-dim);border:1px solid var(--hc-border);border-radius:5px;padding:1px 5px;font-weight:600;letter-spacing:.3px">50% credit</span>'
        + '</div>'
        + '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:4px 14px;margin-bottom:8px">'+sessionRows+'</div>'
        + hcFooter+'</div>';
      sheetHtml = sheetHtml.replace('HOW THIS IS CALCULATED', hcSection+'HOW THIS IS CALCULATED');

      if (res.hcActive && res.hcMindfulPts > 0) {
        var hcCompRow = '<div style="margin-bottom:16px">'
          + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3px"><div style="font-size:13px;font-weight:700;color:var(--hc)">HC Mindfulness (bonus)</div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">+'+res.hcMindfulPts+' pts bonus</div></div>'
          + '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);margin-bottom:6px">'+totalHcPts+' bonus pts added from Health Connect mindfulness sessions (50% credit)</div>'
          + '<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:100%;background:var(--hc);border-radius:3px;transition:width .4s"></div></div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:var(--hc);flex-shrink:0">+'+res.hcMindfulPts+' pts</div></div>'
          + '</div>';
        sheetHtml = sheetHtml.replace('HOW THIS IS CALCULATED', hcCompRow+'HOW THIS IS CALCULATED');
      }
    }
    _openScoreSheet(sheetHtml);
  }

  /* ════════════════════════════════════════════════════════════
   * openHabitsScoreSheet()
   *
   * F-04: HC blend uses null-safe renormalized formula (no NaN crash)
   * F-08: Duration component now reflects Aurelo window proxy when HC unavailable
   * F-18: Unified grade labels
   * ════════════════════════════════════════════════════════════ */
  function openHabitsScoreSheet() {
    var res = calculateSleep();
    var cfg = typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {};
    var bedtimeEnabled = !!(cfg.enabled || (S.settings && S.settings.bedtime));

    if (res.score < 0 && !bedtimeEnabled) {
      toast('Enable Bedtime Mode to start tracking your sleep score', 'info');
      return;
    }
    if (res.score < 0 && bedtimeEnabled) {
      var noDataComponents = [
        {label:'Bedtime Adherence',       weight:50, pts:0, maxPts:50, dataLine:'No bedtime session recorded yet'},
        {label:'Snooze Count',            weight:30, pts:0, maxPts:30, dataLine:'No data'},
        {label:'App Attempts Blocked',    weight:20, pts:0, maxPts:20, dataLine:'No data'},
      ];
      _openScoreSheet(_buildScoreSheet({title:'Sleep Score',score:-1,scoreKey:_SLEEP_SCORE_KEY,components:noDataComponents,improvements:[]}));
      return;
    }

    var ln = res.lastNight;
    // improvements are built after the HC blend so impact values can be
    // scaled by the actual effective weight rather than raw base weights.
    var improvements = [];

    // ── HC sleep data ───────────────────────────────────────────────────────────
    // F-14: pass bedtime window so Kotlin filters HC sessions to those overlapping
    // the configured window (prevents afternoon naps inflating the duration score).
    var hcActive = !!(typeof HealthConnect !== 'undefined' &&
                      HealthConnect.isConnected && HealthConnect.isConnected());
    var hcSleep = null;
    if (hcActive && typeof HealthConnect.getSleepData === 'function') {
      try {
        var _bHp = cfg.bedHour  != null ? cfg.bedHour  + (cfg.bedMinute  || 0) / 60 : null;
        var _wHp = cfg.wakeHour != null ? cfg.wakeHour + (cfg.wakeMinute || 0) / 60 : null;
        hcSleep = (_bHp != null && _wHp != null && HealthConnect.getSleepData.length >= 2)
          ? HealthConnect.getSleepData(_bHp, _wHp)
          : HealthConnect.getSleepData();
      } catch (_) {}
    }

    // ── Aurelo bedtime window proxy (F-08) ─────────────────────────────────────
    // Always compute the window duration — do NOT gate on bedtimeKept here.
    // bedtimeKept is applied in the tier selection below, not to block computation.
    // This was the root cause of Bug 3: cfg.bedHour was valid but the old code
    // also required ln.bedtimeKept before even computing aureloWindowHours, so
    // when the HC path ran first and bedtimeKept was false, window was never set
    // and Tier 3 fired with "no bedtime target" even when bedtime mode was active.
    var aureloWindowHours = null;
    var aureloWindowKept  = !!(ln && ln.bedtimeKept);
    if (cfg.bedHour != null && cfg.wakeHour != null) {
      var _bHw  = cfg.bedHour  + (cfg.bedMinute  || 0) / 60;
      var _wHw  = cfg.wakeHour + (cfg.wakeMinute || 0) / 60;
      var _winH = _wHw > _bHw ? _wHw - _bHw : (24 - _bHw) + _wHw;
      if (_winH >= 3 && _winH <= 14) aureloWindowHours = _winH;
    }

    // ── Duration source: three-tier priority hierarchy (F-08) ──────────────────
    // durSource:     'hc-verified' | 'aurelo-window' | 'hc-only' | null
    // hcContributed: true ONLY when HC actually supplied a value.
    //                Controls the badge — Tier 2 Aurelo-window gets NO badge.
    var durScore = null, durLabel = 'No data', durSource = null, hcContributed = false;

    if (hcSleep && hcSleep.durScore != null && aureloWindowHours != null && aureloWindowKept) {
      // Tier 1: HC session overlapping bedtime window AND bedtime was kept.
      // HC provides precise measurement; window provides the target label.
      durScore = hcSleep.durScore;  durSource = 'hc-verified';  hcContributed = true;
      var _dH = hcSleep.sleepDuration != null ? Math.floor(hcSleep.sleepDuration) : null;
      var _dM = hcSleep.sleepDuration != null ? Math.round((hcSleep.sleepDuration % 1) * 60) : null;
      durLabel = (_dH != null ? _dH + 'h' + (_dM > 0 ? ' ' + _dM + 'm' : '') : 'HC data')
               + ' from Health Connect (target ' + Math.floor(aureloWindowHours) + 'h)';

    } else if (aureloWindowHours != null && aureloWindowKept) {
      // Tier 2: Bedtime kept but NO matching HC sleep session.
      // Use the configured window as a duration proxy.
      // hcContributed stays false — HC played no role — no badge shown.
      durScore = _sleepDurationScore(aureloWindowHours);  durSource = 'aurelo-window';
      var _wHr  = Math.floor(aureloWindowHours);
      var _wMin = Math.round((aureloWindowHours % 1) * 60);
      durLabel  = _wHr + 'h' + (_wMin > 0 ? ' ' + _wMin + 'm' : '')
                + ' from your bedtime window';

    } else if (hcSleep && hcSleep.durScore != null) {
      // Tier 3: HC session exists but bedtime not kept or not configured.
      durScore = hcSleep.durScore;  durSource = 'hc-only';  hcContributed = true;
      var _dH3 = hcSleep.sleepDuration != null ? Math.floor(hcSleep.sleepDuration) : null;
      var _dM3 = hcSleep.sleepDuration != null ? Math.round((hcSleep.sleepDuration % 1) * 60) : null;
      var _note = !aureloWindowKept ? ' (bedtime not kept)' : ' (bedtime mode off)';
      durLabel  = (_dH3 != null ? _dH3 + 'h' + (_dM3 > 0 ? ' ' + _dM3 + 'm' : '') : 'HC data')
                + ' from Health Connect' + _note;
    }

    // Overnight HRV always comes from HC
    var oHrvScore = (hcSleep && hcSleep.oHrvScore != null) ? hcSleep.oHrvScore : null;
    if (oHrvScore != null) hcContributed = true;
    var oHrvLabel = oHrvScore != null
      ? (hcSleep.overnightHrv != null ? hcSleep.overnightHrv + 'ms overnight' : 'HC data')
        + ' · avg ' + (hcSleep.avgOHrv != null ? hcSleep.avgOHrv + 'ms' : '–')
      : 'Not available · no wearable HRV data';

    // ── F-04: renormalized blend ────────────────────────────────────────────────
    // Accumulate totalNomW ONLY for signals that have data.
    // Max achievable score always stays 100 regardless of which signals are present.
    // Old formula substituted 0 for null — silently capped users at ~85% with no HRV.
    var _totalNomW = 0.60;
    if (durScore  != null) _totalNomW += 0.25;
    if (oHrvScore != null) _totalNomW += 0.15;

    var _wgtSum = res.score * 0.60;
    if (durScore  != null) _wgtSum += durScore  * 0.25;
    if (oHrvScore != null) _wgtSum += oHrvScore * 0.15;
    var effectiveScore = Math.min(100, Math.max(0, Math.round(_wgtSum / _totalNomW)));

    // ── Bug 1 fix: renormalized display weights ─────────────────────────────────
    // Sheet shows the ACTUAL weight each row carries after renormalization,
    // not the nominal design weight. Example with no HRV (totalNomW = 0.85):
    //   Bedtime = round(60/85*100) = 71%
    //   Duration = round(25/85*100) = 29%
    //   HRV = 0% (excluded)
    // This makes "+70 pts · weighted 71%" consistent. Old "+70 pts · weighted 60%" was not.
    var _effW_bed = Math.round((0.60 / _totalNomW) * 100);
    var _effW_dur = durScore  != null ? Math.round((0.25 / _totalNomW) * 100) : 0;
    var _effW_hrv = oHrvScore != null ? Math.round((0.15 / _totalNomW) * 100) : 0;

    // Points each component contributes toward effectiveScore
    var _pts_bed = Math.round(res.score * (0.60 / _totalNomW));
    var _pts_dur = durScore  != null ? Math.round(durScore  * (0.25 / _totalNomW)) : 0;
    var _pts_hrv = oHrvScore != null ? Math.round(oHrvScore * (0.15 / _totalNomW)) : 0;

    // ── Component rows ──────────────────────────────────────────────────────────
    var components;
    if (hcActive) {
      // HC connected: three-row layout with renormalized effective weights.
      // Bug 2 fix: excluded rows show weight=0 and a clear "not included" note
      // so users understand why the bar is empty, not just confused by "+0 pts".
      var _durDataLine = durScore != null
        ? durLabel + ' · goal: 7–9 hours'
        : aureloWindowHours != null && !aureloWindowKept
          ? 'Bedtime not kept last night · not scored [not included]'
          : 'No wearable data · keep bedtime for window estimate [not included]';

      var _hrvDataLine = oHrvScore != null
        ? oHrvLabel
        : oHrvLabel + ' [not included]';

      components = [
        {
          label:   'Bedtime Mode',
          weight:  _effW_bed,
          pts:     _pts_bed,
          maxPts:  _effW_bed,
          // Surface snooze and attempt detail so users can see what drove the
          // Bedtime Mode score — previously only showed "kept/missed" and the
          // impact of snoozes + blocked attempts was invisible in HC mode.
          dataLine: ln && ln.hasData
            ? (ln.bedtimeKept ? 'Bedtime kept ✓' : (ln.skippedTonight ? 'Skipped tonight' : 'Bedtime missed'))
              + ' · ' + (ln.snoozeCount || 0) + ' snooze' + ((ln.snoozeCount || 0) !== 1 ? 's' : '')
              + ' · ' + (ln.appAttemptsTotal || 0) + ' attempt' + ((ln.appAttemptsTotal || 0) !== 1 ? 's' : '')
              + ' · ' + (ln.inWindowScreenMins || 0) + ' min phone use' + ((ln.inWindowScreenMins || 0) <= 15 ? ' (within grace)' : ' (over grace)')
              + ' · Screen Filter ' + (ln.filterWasActive ? '✓' : '✗')
            : 'No data',
        },
        {
          label:   'Sleep Duration',
          weight:  _effW_dur,
          pts:     _pts_dur,
          maxPts:  Math.max(_effW_dur, 1),
          dataLine: _durDataLine,
        },
        {
          label:   'Overnight HRV',
          weight:  _effW_hrv,
          pts:     _pts_hrv,
          maxPts:  Math.max(_effW_hrv, 1),
          dataLine: _hrvDataLine,
        },
      ];
    } else {
      // No HC — new formula: adherence(40) + in-window(30) + friction(20) + streak(12) + filter(3)
      var ln = res.lastNight || {};
      var keptLabel   = ln.hasData ? (ln.bedtimeKept ? 'Bedtime window respected' : (ln.skippedTonight ? 'Skipped tonight' : 'Bedtime missed')) : 'No data yet';
      var winMins     = ln.inWindowScreenMins || 0;
      var winLabel    = ln.hasData
        ? (winMins <= 15
            ? winMins + ' min used — within 15 min grace period'
            : winMins + ' min used — ' + (winMins - 15) + ' min over 15 min grace')
        : 'No data';
      var snoozeLabel  = ln.hasData ? ((ln.snoozeCount || 0) + ' snooze' + ((ln.snoozeCount || 0) !== 1 ? 's' : '') + ' last night') : 'No data';
      var attemptLabel = ln.hasData ? ((ln.appAttemptsTotal || 0) + ' blocked attempt' + ((ln.appAttemptsTotal || 0) !== 1 ? 's' : '') + ' last night') : 'No data';
      var streakLabel  = res.bedStreak > 0
        ? res.bedStreak + '-night streak · +' + (res.streakBonus || 0) + ' pts (max +12)'
        : 'Build a bedtime streak to earn up to +12 pts';
      var filterLabel  = ln.hasData
        ? (ln.filterWasActive ? 'Screen Filter was active during bedtime window (+3 pts)' : 'Screen Filter was not active last night')
        : 'No data';

      components = [
        { label: 'Bedtime Adherence',
          weight: 40, pts: res.adherePts,   maxPts: 40, dataLine: keptLabel },
        { label: 'In-Window Usage',
          weight: 30, pts: res.inWindowPts, maxPts: 30, dataLine: winLabel },
        { label: 'Friction (Snooze + Attempts)',
          weight: 20, pts: res.frictionPts, maxPts: 20,
          dataLine: ln.hasData ? (snoozeLabel + ' · ' + attemptLabel) : 'No data' },
        { label: 'Bedtime Streak Bonus',
          weight: 12, pts: res.streakBonus || 0, maxPts: 12, dataLine: streakLabel },
        { label: 'Screen Filter Bonus',
          weight: 3,  pts: res.filterBonus || 0, maxPts: 3,  dataLine: filterLabel },
      ];
    }

    // ── Improvements — built after HC blend so impact values are correctly scaled ─
    // In HC mode the base behavioural score feeds only the 60% Bedtime component;
    // scale potential gains accordingly so "+N pts" reflects the composite impact.
    // In non-HC mode the raw base pts are the full score — no scaling needed.
    var _impactScale = hcActive ? (0.60 / _totalNomW) : 1;
    if (res.adherePts        <  40) improvements.push({text:'Keep your bedtime window tonight',                                     impact: Math.round((40 - res.adherePts)           * _impactScale)});
    if ((res.inWindowPts||0) <  30) improvements.push({text:'Keep phone use under 15 min during bedtime (alarm/music is fine)',     impact: Math.round((30 - (res.inWindowPts||0))    * _impactScale)});
    if ((res.frictionPts||0) <  20) improvements.push({text:'Reduce snoozes and blocked app attempts during bedtime',               impact: Math.round((20 - (res.frictionPts||0))    * _impactScale)});
    if (!(res.filterBonus))         improvements.push({text:'Enable Screen Filter in Bedtime settings for a small bonus (+3 pts)',  impact: Math.round(3                              * _impactScale)});

    var sheetHtml = _buildScoreSheet({
      title:'Sleep Score', score:effectiveScore, scoreKey:_SLEEP_SCORE_KEY,
      components:components, improvements:improvements.slice(0,3),
    });

    // ── Bug 3 fix: three-state badge ────────────────────────────────────────────
    // "HC Enhanced"  HC contributed duration AND/OR HRV actual data
    // "HC · HRV"     HC contributed only overnight HRV (no matching sleep session)
    // No badge       Tier 2 Aurelo-window only — HC connected but contributed nothing
    var hcBadgeText = null;
    if (hcContributed) {
      hcBadgeText = (oHrvScore != null && durSource !== 'hc-verified' && durSource !== 'hc-only')
        ? 'HC · HRV'
        : 'HC Enhanced';
    }
    if (hcBadgeText) {
      var hcBadge = '<span style="font-size:var(--text-2xs);color:var(--hc);background:var(--hc-dim);'
        + 'border:1px solid var(--hc-border);border-radius:5px;padding:1px 6px;font-weight:700;'
        + 'letter-spacing:.3px;margin-left:8px;vertical-align:middle">' + hcBadgeText + '</span>';
      sheetHtml = sheetHtml.replace('Sleep Score</div>', 'Sleep Score' + hcBadge + '</div>');
    }

    // Nudge non-HC users to connect
    if (!hcActive) {
      var nudge = '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:12px;'
        + 'padding:10px 13px;font-family:var(--ff-m);font-size:var(--text-xs);color:var(--t3);'
        + 'line-height:1.5;margin-bottom:16px">'
        + 'Connect Health Connect to add Sleep Duration and Overnight HRV '
        + 'to your Sleep Score for a richer picture of last night.'
        + '</div>';
      sheetHtml = sheetHtml.replace('HOW THIS IS CALCULATED', nudge + 'HOW THIS IS CALCULATED');
    }

    _openScoreSheet(sheetHtml);
  }

  /* ── Public API ────────────────────────────────────────────── */
  var api = {
    calculateFocus, calculateSleep, calculateAurelo,
    saveScoreForToday, getYesterdayScore,
    getFocusStreak, maybeEarnFocusStreak,
    renderFocusStaticRow, renderHabitsStaticRow,
    renderFocusDynamicRow, renderHabitsDynamicRow,
    openFocusScoreSheet, openHabitsScoreSheet,
    closeScoreSheet,
    buildScoreSheet: _buildScoreSheet,
    openScoreSheet:  _openScoreSheet,
    showQueuedEvents: _showQueuedEvents,
    invalidateSleepCache: function() { _sleepScoreCache = null; _sleepScoreCacheTs = 0; },
    unifiedGrade: _unifiedGrade,  // F-18: exported for use in app-wellness.js and app-home-score.js
    FOCUS_SCORE_KEY:  _FOCUS_SCORE_KEY,
    SLEEP_SCORE_KEY:  _SLEEP_SCORE_KEY,
    AURELO_SCORE_KEY: _AURELO_SCORE_KEY,  // F-09
  };

  window.openFocusScoreSheet  = function() { api.openFocusScoreSheet(); };
  window.openHabitsScoreSheet = function() { api.openHabitsScoreSheet(); };
  window._closeScoreSheet     = function() { api.closeScoreSheet(); };

  return api;
})();