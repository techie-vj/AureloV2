'use strict';
/* ═══════════════════════════════════════════════════════════════
 * FOCUS HOME MODULE — app-focus-home.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Strip data cache (_loadStripData), all home-card HTML
 *       builders, home dynamic rows, streak check, day-dots helper,
 *       focus score mini-card, morning summary dismiss.
 *
 * Depends on: FocusTab, FocusScore, FocusBedtime, FocusChallenge,
 *   FocusRoutine, S, IS_NATIVE, N, DAILY_USE, FOCUS_DIFF,
 *   fmtM, toast, showConfirm, calculateSleepScore,
 *   calculateFocusScore, snoozeBedtimePrompt, activateTab
 *
 * Public API (via FocusHome.*):
 *   loadStripData()            → data object (cached 2s)
 *   invalidateStripCache()     — bust the 2s cache
 *   renderFocusStrip()         — renders #home-focus-strip
 *   renderHomeFocusDynamicRow()— renders #home-focus-dynamic
 *   renderHomeHabitsDynamicRow()— renders #home-habits-dynamic
 *   checkStreakIncrements()    — detect streak bumps → celebration
 *   dismissMorningSummary()    — persist + re-render
 *   buildDayDots(daysArr)      → HTML string
 *   buildLiveSessionStripHtml(d)→ HTML (shared by FocusTab subtab)
 *   buildCompletedStripHtml(d) → HTML
 *   buildInterruptedStripHtml(d)→ HTML
 *   buildFocusSubtabStripHtml()→ HTML
 *   buildLimitsSubtabStripHtml()→ HTML
 *   buildHomeFocusStripHtml()  → HTML
 *   buildHomeLimitsStripHtml() → HTML
 *   buildStripRow(icon,label,sub,rightEl) → HTML
 *   buildStripRowMuted(icon,label,sub)   → HTML
 * ═══════════════════════════════════════════════════════════════ */
window.FocusHome = (function () {

  /* ── Cache ────────────────────────────────────────────────────── */
  var _stripDataCache   = null;
  var _stripDataCacheTs = 0;
  var _CACHE_TTL_MS     = 2000;

  /* ── Morning dismiss ──────────────────────────────────────────── */
  var _MORNING_DISMISS_KEY = 'home_morning_dismissed_date';

  function _getMorningSummaryDismissed() {
    var today = new Date().toISOString().slice(0, 10);
    try {
      var s = IS_NATIVE && N.getStringPref ? N.getStringPref(_MORNING_DISMISS_KEY) : localStorage.getItem(_MORNING_DISMISS_KEY);
      return s === today;
    } catch (_) { return false; }
  }

  function dismissMorningSummary() {
    var today = new Date().toISOString().slice(0, 10);
    try {
      if (IS_NATIVE && N.setStringPref) N.setStringPref(_MORNING_DISMISS_KEY, today);
      else localStorage.setItem(_MORNING_DISMISS_KEY, today);
    } catch (_) {}
    renderHomeHabitsDynamicRow();
  }

  /* ═══════════════════════════════════════════════════════════════
   * STRIP DATA LOADER
   * ═══════════════════════════════════════════════════════════════ */

  function invalidateStripCache() {
    _stripDataCache   = null;
    _stripDataCacheTs = 0;
  }

  function loadStripData() {
    var now = Date.now();
    if (_stripDataCache && (now - _stripDataCacheTs) < _CACHE_TTL_MS) return _stripDataCache;

    var d = {
      completed:0, interrupted:0, totalMins:0,
      pauseCount:0, resistCount:0,
      focusDays:[false,false,false,false,false,false,false],
      bedtimeStreak:0, bedtimeDays:[false,false,false,false,false,false,false],
      bedtimeEnabled: !!S.settings.bedtime,
      bedtimeHour:22, bedtimeWakeHour:7,
    };

    if (IS_NATIVE) {
      try { var fs=JSON.parse(N.getFocusStats()||'{}'); d.completed=fs.completed||0; d.interrupted=fs.interrupted||0; d.totalMins=fs.totalMins||0; } catch(_){}
      try { d.pauseCount  = typeof N.getIntentionPauseCount  === 'function' ? N.getIntentionPauseCount()  : 0; } catch(_){}
      try { d.resistCount = typeof N.getIntentionResistCount === 'function' ? N.getIntentionResistCount() : 0; } catch(_){}
      try { d.focusDays   = typeof N.getFocusWeekDays  === 'function' ? JSON.parse(N.getFocusWeekDays() ||'[]') : d.focusDays;  } catch(_){}
      // Merge JS-persisted earnedDates so timer/pause earns show ticks too
      try {
        var fs2 = typeof FocusScore !== 'undefined' ? FocusScore.getFocusStreak() : null;
        if (fs2 && Array.isArray(fs2.earnedDates)) {
          fs2.earnedDates.forEach(function (ds) {
            var dow = new Date(ds + 'T00:00:00').getDay();
            d.focusDays[dow] = true;
          });
        }
      } catch(_){}
      try { var bs=JSON.parse((typeof N.getBedtimeStreak==='function'?N.getBedtimeStreak():'{}')||'{}'); d.bedtimeStreak=bs.streak||0; } catch(_){}
      try { d.bedtimeDays = typeof N.getBedtimeWeekDays==='function' ? JSON.parse(N.getBedtimeWeekDays()||'[]') : d.bedtimeDays; } catch(_){}
      try { var bc=JSON.parse((typeof N.getBedtimeSettings==='function'?N.getBedtimeSettings():'{}')||'{}'); d.bedtimeHour=bc.bedHour||22; d.bedtimeWakeHour=bc.wakeHour||7; } catch(_){}
    }

    d.total = d.completed + d.interrupted;
    d.rate  = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;

    // Timer data from JS state
    var limits    = S.limits || {};
    var timerPkgs = Object.keys(limits);
    var usageMap  = {};
    if (typeof DAILY_USE !== 'undefined') DAILY_USE.forEach(function (u) { usageMap[u.packageName] = u.totalMinutes || 0; });
    d.timerTotal     = timerPkgs.length;
    d.timerOverPkgs  = timerPkgs.filter(function (p) { return (usageMap[p] || 0) >= limits[p]; });
    d.timerOverCount = d.timerOverPkgs.length;

    // Challenge data
    try {
      var ch = typeof FocusChallenge !== 'undefined' ? FocusChallenge.pickChallenge() : null;
      if (ch) {
        var cp = typeof FocusChallenge !== 'undefined' ? FocusChallenge.getChallengeProgress(ch.id) : { done: 0 };
        d.challengeDone   = cp.done   || 0;
        d.challengeTarget = ch.target || 1;
        d.challengeLabel  = ch.title  || '';
      }
    } catch (_) {}

    _stripDataCache   = d;
    _stripDataCacheTs = Date.now();
    return d;
  }

  /* ═══════════════════════════════════════════════════════════════
   * STREAK CHECK
   * ═══════════════════════════════════════════════════════════════ */

  function checkStreakIncrements() {
    var now = Date.now();

    // Proactively earn focus streak
    if (typeof FocusScore !== 'undefined') FocusScore.maybeEarnFocusStreak(loadStripData());

    var currentFocusStreak = 0, currentSleepStreak = 0;
    try { currentFocusStreak = (typeof FocusScore !== 'undefined' ? FocusScore.getFocusStreak() : { count: 0 }).count || 0; } catch (_) {}
    if (IS_NATIVE && typeof N.getBedtimeStreak === 'function') {
      try { currentSleepStreak = (JSON.parse(N.getBedtimeStreak() || '{}') || {}).streak || 0; } catch (_) {}
    }

    var ss = typeof FocusTab !== 'undefined' ? FocusTab.getStreakState() : {};
    var prevFocus = ss.prevFocusStreak || 0, prevSleep = ss.prevSleepStreak || 0;

    if (prevFocus > 0 && currentFocusStreak > prevFocus) ss.focusStreakCelebUntil = now + 60000;
    if (prevSleep > 0 && currentSleepStreak > prevSleep) ss.sleepStreakCelebUntil = now + 60000;

    if (typeof FocusTab !== 'undefined') FocusTab.setStreakState(currentFocusStreak, currentSleepStreak, ss.focusStreakCelebUntil, ss.sleepStreakCelebUntil);
  }

  /* ═══════════════════════════════════════════════════════════════
   * HELPERS
   * ═══════════════════════════════════════════════════════════════ */

  function buildDayDots(daysArr) {
    var days = ['S','M','T','W','T','F','S'], order = [1,2,3,4,5,6,0];
    var todayIdx = new Date().getDay(), html = '<div style="display:flex;align-items:center;gap:4px">';
    order.forEach(function (i) {
      var on = daysArr && daysArr[i], today = (i === todayIdx);
      var bg     = on ? 'var(--p)' : today ? 'rgba(108,99,255,.18)' : 'var(--s3)';
      var border = today ? '1px solid rgba(108,99,255,.5)' : '1px solid transparent';
      html += '<div style="width:18px;height:18px;border-radius:50%;background:' + bg + ';border:' + border + ';' +
        'display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<span style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:' +
        (on ? '#fff' : today ? 'var(--p)' : 'var(--t3)') + '">' + days[i] + '</span></div>';
    });
    html += '</div>';
    return html;
  }

  function _fmt12(dec) {
    var h24 = ((Math.round(dec * 4) / 4) + 24) % 24, hh = Math.floor(h24), mm = Math.round((h24 - hh) * 60);
    return (hh % 12 || 12) + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');
  }

  function _fmt12h(h, m) {
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function _fmtStripTimer(secsLeft) {
    if (secsLeft < 3600) { var m=Math.floor(secsLeft/60),s=secsLeft%60; return (m<10?'0':'')+m+':'+(s<10?'0':'')+s; }
    var h=Math.floor(secsLeft/3600), mm=Math.floor((secsLeft%3600)/60);
    return mm>0?h+'h '+mm+'m':h+'h';
  }

  /* ═══════════════════════════════════════════════════════════════
   * STRIP ROW BUILDERS
   * ═══════════════════════════════════════════════════════════════ */

  function buildStripRow(icon, label, sub, rightEl) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 14px">' +
      '<span style="font-size:13px;flex-shrink:0">' + icon + '</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:11px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + label + '</div>' +
        (sub ? '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:1px">' + sub + '</div>' : '') +
      '</div>' +
      '<div style="flex-shrink:0">' + rightEl + '</div>' +
      '</div>';
  }

  function buildStripRowMuted(icon, label, sub) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 14px;opacity:.45">' +
      '<span style="font-size:13px;flex-shrink:0">' + icon + '</span>' +
      '<div style="flex:1">' +
        '<div style="font-size:11px;font-weight:600;color:var(--t3)">' + label + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:1px">' + sub + '</div>' +
      '</div></div>';
  }

  /* ── Session state strip builders ──────────────────────────────── */

  function buildLiveSessionStripHtml(d) {
    var ss       = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
    var secsLeft = Math.max(0, ss.secs || 0);
    var totalSecs= ss.totalSecs || 1;
    var elapsed  = totalSecs - secsLeft;
    var elapsedM = Math.floor(elapsed / 60), totalM = Math.floor(totalSecs / 60);
    var pct      = Math.round((elapsed / totalSecs) * 100);
    var diff     = (typeof FOCUS_DIFF !== 'undefined' && FOCUS_DIFF[ss.difficulty]) || FOCUS_DIFF.gentle;
    var timerStr = _fmtStripTimer(secsLeft);
    return '<div onclick="activateTab(\'focus\')" style="' +
      'background:var(--s2);border:1px solid rgba(108,99,255,.4);border-radius:14px;' +
      'padding:10px 14px 12px;cursor:pointer;overflow:hidden">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:' + diff.color + ';' +
        'box-shadow:0 0 0 3px ' + diff.color + '33;flex-shrink:0;animation:fs-pulse 2s ease-in-out infinite"></div>' +
        '<div style="flex:1">' +
          '<div style="font-size:12px;font-weight:700;color:var(--t1)">Focus Mode Active</div>' +
          '<div class="fs-live-sub" style="font-family:var(--ff-m);font-size:11px;color:var(--t2);margin-top:1px">' +
          elapsedM + ' of ' + totalM + ' min elapsed</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div class="fs-live-timer" style="font-family:var(--ff-m);font-size:20px;font-weight:700;' +
          'color:' + diff.color + ';letter-spacing:-1px;line-height:1">' + timerStr + '</div>' +
          '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:1px">' + diff.label + '</div>' +
        '</div></div>' +
      '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
        '<div class="fs-live-bar" style="height:100%;width:' + pct + '%;' +
        'background:linear-gradient(90deg,var(--p),var(--c));border-radius:2px;transition:width .5s linear"></div>' +
      '</div></div>';
  }

  function buildCompletedStripHtml(d) {
    var ls = typeof FocusTab !== 'undefined' ? FocusTab.getLastState() : {};
    return '<div onclick="activateTab(\'focus\')" style="' +
      'background:var(--s2);border:1px solid rgba(18,212,138,.3);border-radius:14px;' +
      'padding:10px 14px;cursor:pointer;animation:fade-in-up .4s ease">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="font-size:22px;flex-shrink:0">&#x1F525;</div>' +
        '<div style="flex:1">' +
          '<div style="font-size:12px;font-weight:700;color:var(--g)">Session complete!</div>' +
          '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);margin-top:1px">' +
          (ls.totalMins || 0) + ' min &middot; ' + (d.completed || 0) + ' done this week</div>' +
        '</div>' +
        '<div style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--g);' +
        'background:rgba(18,212,138,.12);border:1px solid rgba(18,212,138,.25);' +
        'border-radius:8px;padding:4px 10px;white-space:nowrap;flex-shrink:0">' +
        (d.completed || 0) + ' done &#x2713;</div>' +
      '</div></div>';
  }

  function buildInterruptedStripHtml(d) {
    var ls = typeof FocusTab !== 'undefined' ? FocusTab.getLastState() : {};
    return '<div onclick="activateTab(\'focus\')" style="' +
      'background:var(--s2);border:1px solid rgba(247,166,35,.25);border-radius:14px;' +
      'padding:10px 14px;cursor:pointer;animation:fade-in-up .4s ease">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="font-size:18px;flex-shrink:0">&#x23F8;</div>' +
        '<div style="flex:1">' +
          '<div style="font-size:12px;font-weight:700;color:var(--a)">Session ended early</div>' +
          '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);margin-top:1px">' +
          (ls.elapsedMins || 0) + ' of ' + (ls.totalMins || 0) + ' min &middot; ' +
          (d.completed || 0) + '/' + (d.total || 0) + ' complete this week</div>' +
        '</div>' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--p2);' +
        'background:rgba(108,99,255,.1);border:1px solid rgba(108,99,255,.2);' +
        'border-radius:6px;padding:3px 8px;white-space:nowrap;flex-shrink:0">Try again &#x2192;</div>' +
      '</div></div>';
  }

  /* ═══════════════════════════════════════════════════════════════
   * HOME FOCUS STRIP CARD (renders into #home-focus-strip)
   * ═══════════════════════════════════════════════════════════════ */

  function buildHomeFocusStripHtml() {
    var d  = loadStripData();
    var ss = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
    var ls = typeof FocusTab !== 'undefined' ? FocusTab.getLastState()   : {};
    if (ss.active)                      return buildLiveSessionStripHtml(d);
    if (ls.state === 'completed')       return buildCompletedStripHtml(d);
    if (ls.state === 'interrupted')     return buildInterruptedStripHtml(d);

    var focusVal = d.total > 0 ? d.completed + ' session' + (d.completed !== 1 ? 's' : '') : '\u2013';
    var focusSub = d.total > 0 ? d.totalMins + ' min today' : 'No sessions yet';
    var mindfulVal = d.pauseCount > 0 ? d.pauseCount + ' pause' + (d.pauseCount !== 1 ? 's' : '') : '\u2013';
    var mindfulSub = d.pauseCount > 0 ? (d.resistCount > 0 ? d.resistCount + ' resisted' : 'none resisted') : 'Not triggered';
    return '<div onclick="activateTab(\'focus\')" style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:11px 13px;cursor:pointer;display:flex;align-items:stretch">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);letter-spacing:.8px;margin-bottom:4px">FOCUS</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:2px;line-height:1.2">' + focusVal + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">' + focusSub + '</div>' +
      '</div>' +
      '<div style="width:1px;background:rgba(255,255,255,.07);margin:0 12px;align-self:stretch"></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);letter-spacing:.8px;margin-bottom:4px">MINDFUL</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:2px;line-height:1.2">' + mindfulVal + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">' + mindfulSub + '</div>' +
      '</div>' +
      '</div>';
  }

  function renderFocusStrip() {
    var el = document.getElementById('home-focus-strip');
    if (el) el.innerHTML = buildHomeFocusStripHtml();
  }

  /* ═══════════════════════════════════════════════════════════════
   * FOCUS & LIMITS SUB-TAB STRIPS
   * ═══════════════════════════════════════════════════════════════ */

  function buildFocusSubtabStripHtml() {
    var d  = loadStripData();
    var ss = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
    var ls = typeof FocusTab !== 'undefined' ? FocusTab.getLastState()   : {};
    if (ss.active)                  return buildLiveSessionStripHtml(d);
    if (ls.state === 'completed')   return buildCompletedStripHtml(d);
    if (ls.state === 'interrupted') return buildInterruptedStripHtml(d);
    if (d.total === 0)              return '';
    var rateColor = d.rate >= 70 ? 'var(--g)' : d.rate >= 50 ? 'var(--a)' : 'var(--r)';
    var streak = 0; for (var si = 0; si < 7; si++) if (d.focusDays[si]) streak++;
    var challengeHtml = '';
    if (d.challengeDone !== undefined) {
      var pct = Math.min(100, Math.round((d.challengeDone / d.challengeTarget) * 100));
      challengeHtml = buildStripRow('🏆', d.challengeLabel || 'Weekly Challenge', d.challengeDone + ' of ' + d.challengeTarget,
        '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;flex:1;min-width:60px">' +
        '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--p),var(--c));border-radius:2px;transition:width .4s"></div></div>');
    }
    return '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;overflow:hidden">' +
      buildStripRow('🎯', d.completed + '/' + d.total + ' sessions', d.totalMins + ' min',
        '<span style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:' + rateColor + '">' + d.rate + '% done</span>') +
      '<div style="height:1px;background:var(--border)"></div>' +
      buildStripRow('🔥', streak + '-day streak', '', buildDayDots(d.focusDays)) +
      (challengeHtml ? '<div style="height:1px;background:var(--border)"></div>' + challengeHtml : '') +
      '</div>';
  }

  function buildHomeLimitsStripHtml() {
    var d = loadStripData();
    var resistPct = d.pauseCount > 0 ? Math.round((d.resistCount / d.pauseCount) * 100) : null;
    var parts = [];
    if (d.timerTotal > 0)
      parts.push('<span style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:' + (d.timerOverCount > 0 ? 'var(--r)' : 'var(--g)') + '">' + d.timerOverCount + '/' + d.timerTotal + '</span><span style="font-family:var(--ff-m);font-size:11px;color:var(--t3)"> blocked</span>');
    if (resistPct !== null)
      parts.push('<span style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--pu)">' + resistPct + '%</span><span style="font-family:var(--ff-m);font-size:11px;color:var(--t3)"> resisted</span>');
    if (d.bedtimeEnabled)
      parts.push('<span style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--p2)">🌙 ' + d.bedtimeStreak + '</span><span style="font-family:var(--ff-m);font-size:11px;color:var(--t3)"> nights</span>');
    if (!parts.length) {
      return '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px"><span style="font-size:16px;opacity:.4">🛡️</span><div style="flex:1"><div style="font-size:11px;font-weight:600;color:var(--t3)">Limits</div><div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);opacity:.6">Set up timers or bedtime</div></div><div style="font-family:var(--ff-m);font-size:10px;color:var(--p2);opacity:.7">Set up \u2192</div></div>';
    }
    return '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px"><span style="font-size:14px">🛡️</span><div style="display:flex;align-items:center;gap:10px;flex:1;flex-wrap:wrap">' +
      parts.map(function (p) { return '<div>' + p + '</div>'; }).join('<div style="width:1px;height:14px;background:var(--border2)"></div>') +
      '</div><div style="font-family:var(--ff-m);font-size:11px;color:var(--p2);opacity:.7;flex-shrink:0">\u2192</div></div>';
  }

  function buildLimitsSubtabStripHtml() {
    var d = loadStripData();
    var resistPct   = d.pauseCount > 0 ? Math.round((d.resistCount / d.pauseCount) * 100) : null;
    var resistColor = resistPct !== null ? (resistPct >= 70 ? 'var(--g)' : resistPct >= 50 ? 'var(--a)' : 'var(--r)') : 'var(--t3)';
    if (!d.timerTotal && !d.pauseCount && !d.bedtimeEnabled) {
      return '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:14px 16px;text-align:center"><div style="font-size:22px;opacity:.3;margin-bottom:6px">🛡️</div><div style="font-family:var(--ff-m);font-size:11px;color:var(--t3)">Set up app timers, mindful pause or bedtime to see your limits stats here.</div></div>';
    }
    var timerDetail = d.timerOverCount > 0
      ? '<span style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:var(--r)">' + d.timerOverCount + ' limit' + (d.timerOverCount !== 1 ? 's' : '') + ' reached</span>'
      : '<span style="font-family:var(--ff-m);font-size:10px;color:var(--g)">All clear \u2713</span>';
    var timerRow    = d.timerTotal > 0 ? buildStripRow('\u23f1', d.timerTotal + ' timer' + (d.timerTotal !== 1 ? 's' : '') + ' active', '', timerDetail) : buildStripRowMuted('\u23f1', 'App Timers', 'Not configured');
    var resistBar   = '';
    if (d.pauseCount > 0) {
      var rp = Math.min(100, Math.round((d.resistCount / d.pauseCount) * 100));
      resistBar = '<div style="display:flex;align-items:center;gap:6px;flex:1"><div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;flex:1"><div style="height:100%;width:' + rp + '%;background:' + resistColor + ';border-radius:2px;transition:width .4s"></div></div><span style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:' + resistColor + '">' + rp + '%</span></div>';
    }
    var mindfulRow  = d.pauseCount > 0 ? buildStripRow('🧠', d.resistCount + '/' + d.pauseCount + ' paused', 'resisted', resistBar) : buildStripRowMuted('🧠', 'Mindful Pause', 'Not triggered today');
    var cfg    = typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {};
    var bedStr = cfg.bedHour !== undefined ? _fmt12(Math.floor(cfg.bedHour) + (cfg.bedMinute || 0) / 60) + ' \u2192 ' + _fmt12(Math.floor(cfg.wakeHour) + (cfg.wakeMinute || 0) / 60) : '';
    var bedRow  = d.bedtimeEnabled ? buildStripRow('🌙', d.bedtimeStreak + '-night streak', bedStr, buildDayDots(d.bedtimeDays)) : buildStripRowMuted('🌙', 'Bedtime', 'Disabled');
    return '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;overflow:hidden">' + timerRow + '<div style="height:1px;background:var(--border)"></div>' + mindfulRow + '<div style="height:1px;background:var(--border)"></div>' + bedRow + '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════
   * HOME DYNAMIC ROWS
   * ═══════════════════════════════════════════════════════════════ */

  function renderHomeFocusDynamicRow() {
    var el = document.getElementById('home-focus-dynamic');
    if (!el) return;
    var now      = Date.now();
    var limits   = S.limits || {};
    var usageMap = {};
    if (typeof DAILY_USE !== 'undefined') DAILY_USE.forEach(function (u) { usageMap[u.packageName] = u.totalMinutes || 0; });
    var ss = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
    var ls = typeof FocusTab !== 'undefined' ? FocusTab.getLastState() : {};
    var sk = typeof FocusTab !== 'undefined' ? FocusTab.getStreakState() : {};

    // Tier 1a: session active
    if (ss.active) {
      var diff    = (typeof FOCUS_DIFF !== 'undefined' && FOCUS_DIFF[ss.difficulty]) || FOCUS_DIFF.gentle;
      var secsLeft= Math.max(0, ss.secs || 0);
      var chips   = (ss.blockedApps || []).slice(0, 3).map(function (a) {
        return '<span style="background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.25);border-radius:6px;padding:2px 7px;font-family:var(--ff-m);font-size:11px;color:var(--p2)">' + a.name.split(' ')[0] + '</span>';
      }).join('');
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'focus\');activateTab(\'focus\')" style="background:var(--s2);border:1px solid ' + diff.color + ';border-radius:14px;padding:11px 13px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:' + (chips ? '8' : '0') + 'px">' +
          '<div style="width:7px;height:7px;border-radius:50%;background:' + diff.color + ';box-shadow:0 0 0 3px ' + diff.color + '22;flex-shrink:0;animation:fs-pulse 2s ease-in-out infinite"></div>' +
          '<div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--t1)">Focus Mode Active</div><div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);margin-top:1px">' + diff.label + '</div></div>' +
          '<div id="home-focus-dyn-timer" style="font-family:var(--ff-m);font-size:18px;font-weight:700;color:' + diff.color + ';letter-spacing:-1px;flex-shrink:0">' + _fmtStripTimer(secsLeft) + '</div>' +
        '</div>' + (chips ? '<div style="display:flex;gap:5px;flex-wrap:wrap">' + chips + '</div>' : '') + '</div>';
      return;
    }

    // Tier 1b: timer over limit — collect all, show worst + "+N more", navigate to limits subtab
    var allOverPkgs = Object.keys(limits).filter(function (pkg) { return (usageMap[pkg] || 0) > limits[pkg]; });
    if (allOverPkgs.length) {
      // sort worst-first (most over by minutes)
      allOverPkgs.sort(function (a, b) { return ((usageMap[b]||0) - limits[b]) - ((usageMap[a]||0) - limits[a]); });
      var overPkg  = allOverPkgs[0];
      var overName = (typeof DAILY_USE !== 'undefined' && (DAILY_USE.find(function (u) { return u.packageName === overPkg; }) || {}).name) || overPkg.split('.').pop();
      var overExtra = allOverPkgs.length > 1 ? '<span style="color:var(--t3);margin-left:4px">+'   + (allOverPkgs.length - 1) + ' more</span>' : '';
      var overOver  = fmtM((usageMap[overPkg] || 0) - limits[overPkg]);
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'focus\');activateTab(\'focus\')" style="background:rgba(240,78,122,.07);border:0.5px solid rgba(240,78,122,.3);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px;cursor:pointer"><div style="width:6px;height:6px;border-radius:50%;background:var(--r);flex-shrink:0"></div><div style="flex:1;font-family:var(--ff-m);font-size:11px;color:var(--r)">' + overName + ' limit reached today' + '\u00b7 +' + overOver  + overExtra + '</div><div style="font-family:var(--ff-m);font-size:10px;color:var(--r);opacity:.7;flex-shrink:0"></div></div>';
      return;
    }

    // Tier 2a: timer approaching 80–99% — collect all, show worst + "+N more", navigate to limits subtab
    var allWarnPkgs = Object.keys(limits).filter(function (pkg) { var u=usageMap[pkg]||0,l=limits[pkg],p=l>0?u/l:0; return p>=0.8&&p<1; });
    if (allWarnPkgs.length) {
      allWarnPkgs.sort(function (a, b) { var pa=(usageMap[b]||0)/limits[b], pb=(usageMap[a]||0)/limits[a]; return pa - pb; });
      var warnPkg  = allWarnPkgs[0];
      var warnName = (typeof DAILY_USE !== 'undefined' && (DAILY_USE.find(function (u) { return u.packageName === warnPkg; }) || {}).name) || warnPkg.split('.').pop();
      var warnExtra = allWarnPkgs.length > 1 ? '<span style="color:var(--t3);margin-left:4px">+' + (allWarnPkgs.length - 1) + ' more</span>' : '';
      var left = fmtM(Math.max(0, limits[warnPkg] - (usageMap[warnPkg] || 0)));
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'focus\');activateTab(\'focus\')" style="background:rgba(247,166,35,.07);border:0.5px solid rgba(247,166,35,.25);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px;cursor:pointer"><div style="width:6px;height:6px;border-radius:50%;background:var(--a);flex-shrink:0"></div><div style="flex:1;font-family:var(--ff-m);font-size:11px;color:var(--a)">' + warnName + ' approaching daily limit' +'\u00b7 ' + left + ' left today' + warnExtra + '</div><div style="font-family:var(--ff-m);font-size:10px;color:var(--a);opacity:.7;flex-shrink:0"></div></div>';
      return;
    }

    // Tier 2b: routine starting within 60 min
    var routines = typeof FocusRoutine !== 'undefined' ? FocusRoutine.getRoutines() : [];
    var nowMins  = new Date().getHours() * 60 + new Date().getMinutes();
    var soon = null;
    routines.forEach(function (r) {
      if (!r.enabled) return;
      var rMins = (r.startHour || r.hour || 0) * 60 + (r.startMin || r.minute || 0), d2 = rMins - nowMins;
      if (d2 > 0 && d2 <= 60) soon = r;
    });
    if (soon) {
      var rH = soon.startHour || soon.hour || 0, rM = soon.startMin || soon.minute || 0;
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'focus\');activateTab(\'focus\')" style="background:rgba(108,99,255,.07);border:0.5px solid rgba(108,99,255,.25);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px;cursor:pointer"><div style="width:6px;height:6px;border-radius:50%;background:var(--p);flex-shrink:0"></div><div style="flex:1;font-family:var(--ff-m);font-size:11px;color:var(--p2)">Your ' + _fmt12h(rH, rM) + ' focus session starts soon</div><div style="font-family:var(--ff-m);font-size:10px;color:var(--p2)">Start early \u2192</div></div>';
      return;
    }

    // Tier 3a: session ended within last 10 min
    if (ls.state && ls.ts && (now - ls.ts) < 600000) {
      var isComplete  = ls.state === 'completed';
      var scoreDelta  = '';
      try { var sfr = (typeof FocusScore !== 'undefined') ? FocusScore.calculateFocus(loadStripData()) : null; if (sfr && sfr.score >= 0) scoreDelta = '+' + Math.round(sfr.score * 0.4 / 10); } catch (_) {}
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'focus\');activateTab(\'focus\')" style="background:rgba(110,201,122,0.07);border:0.5px solid rgba(110,201,122,0.2);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px"><div style="width:6px;height:6px;border-radius:50%;background:#6ec97a;flex-shrink:0"></div><div style="flex:1;font-family:var(--ff-m);font-size:11px;color:#448855">' + (isComplete ? 'Session completed' : 'Session ended early') + ' \u00b7 ' + fmtM(ls.totalMins) + (scoreDelta ? ' \u00b7 Score ' + scoreDelta + ' pts' : '') + '</div></div>';
      return;
    }

    // Tier 3b: streak celebration
    if (sk.focusStreakCelebUntil && now < sk.focusStreakCelebUntil) {
      var fsN = sk.prevFocusStreak || 0, fsPrev = fsN > 0 ? fsN - 1 : 0;
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'focus\');activateTab(\'focus\')" style="background:rgba(108,99,255,0.08);border:0.5px solid rgba(108,99,255,0.22);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px"><div style="width:22px;height:22px;border-radius:7px;background:rgba(108,99,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px">🎯</div><div style="flex:1"><div style="font-family:var(--ff-m);font-size:11px;font-weight:600;color:#9b95ff;margin-bottom:2px">Focus streak \u00b7 ' + fsN + ' days</div><div style="font-family:var(--ff-m);font-size:10px;color:#6666aa">Complete a session, respect timers, or resist a pause</div></div><div style="font-family:var(--ff-m);font-size:10px;color:#9b95ff;background:rgba(108,99,255,0.15);border-radius:99px;padding:3px 8px;flex-shrink:0">\u2191 ' + fsPrev + '\u2192' + fsN + '</div></div>';
      return;
    }
    el.innerHTML = '';
  }

  function renderHomeHabitsDynamicRow() {
    var el = document.getElementById('home-habits-dynamic');
    if (!el) return;
    var cfg     = typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {};
    var nowH    = new Date().getHours() + new Date().getMinutes() / 60;
    var bedH    = (cfg.bedHour != null ? cfg.bedHour : 22) + (cfg.bedMinute || 0) / 60;
    var wakeH   = (cfg.wakeHour != null ? cfg.wakeHour : 7) + (cfg.wakeMinute || 0) / 60;
    // FIX-1: Use native bridge as source of truth (matches what the bedtime
    // section shows). JS math is kept only as a fallback for non-native / demo.
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
    var now     = Date.now();
    var sk      = typeof FocusTab !== 'undefined' ? FocusTab.getStreakState() : {};

    // Tier 1: bedtime active — click navigates to habits subtab
    if (inWindow) {
      var blockedCount = Array.isArray(cfg.blockedApps) ? cfg.blockedApps.length : 0;
      var wakeStr      = _fmt12((cfg.wakeHour || 7) + (cfg.wakeMinute || 0) / 60);
      var bedStreakNow  = 0;
      try { if (IS_NATIVE && typeof N.getBedtimeStreak === 'function') bedStreakNow = (JSON.parse(N.getBedtimeStreak() || '{}') || {}).streak || 0; } catch (_) {}
      var snoozeEndsAt = 0;
      try { if (IS_NATIVE && typeof N.getBedtimeSnoozeEndsAt === 'function') snoozeEndsAt = N.getBedtimeSnoozeEndsAt() || 0; } catch (_) {}
      var snoozeActive = snoozeEndsAt > now, minsLeft = snoozeActive ? Math.ceil((snoozeEndsAt - now) / 60000) : 0;
      var streakPill   = bedStreakNow > 1
        ? '<div style="font-family:var(--ff-m);font-size:10px;font-weight:600;color:#7a80ff;background:rgba(80,100,255,.15);border-radius:99px;padding:3px 8px;flex-shrink:0">\uD83D\uDD25 ' + bedStreakNow + '</div>'
        : '';
      var snoozeBtn = '<div onclick="event.stopPropagation();' + (snoozeActive ? '' : 'snoozeBedtimePrompt()') + '" style="font-family:var(--ff-m);font-size:10px;' + (snoozeActive ? 'color:var(--t3);background:var(--s3);cursor:default;opacity:.5;' : 'color:#7a80ff;background:rgba(80,100,255,0.15);cursor:pointer;') + 'border-radius:99px;padding:3px 8px;flex-shrink:0">' + (snoozeActive ? minsLeft + 'm' : 'Snooze') + '</div>';
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:rgba(80,100,255,0.1);border:0.5px solid rgba(100,120,255,0.28);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px;cursor:pointer"><div style="width:22px;height:22px;border-radius:7px;background:rgba(80,100,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px">\uD83C\uDF19</div><div style="flex:1"><div style="font-family:var(--ff-m);font-size:11px;font-weight:600;color:#7a80ff;margin-bottom:2px">Bedtime mode on \u00b7 ' + blockedCount + ' app' + (blockedCount !== 1 ? 's' : '') + ' blocked</div><div style="font-family:var(--ff-m);font-size:10px;color:#445588">Ends at ' + wakeStr + '</div></div>' + streakPill + snoozeBtn + '</div>';
      return;
    }

    // Tier 2a: wind-down — extended to 120 min before bedtime (was 60), click navigates to habits subtab
    if (cfg.enabled) {
      var minsUntil = (bedH - nowH) * 60; if (minsUntil < 0) minsUntil += 1440;
      if (minsUntil <= 120 && minsUntil > 0) {
        var bedStr2    = _fmt12((cfg.bedHour || 22) + (cfg.bedMinute || 0) / 60);
        var btStreak2  = 0;
        try { if (IS_NATIVE && typeof N.getBedtimeStreak === 'function') btStreak2 = (JSON.parse(N.getBedtimeStreak() || '{}') || {}).streak || 0; } catch (_) {}
        var streakNote = btStreak2 > 0 ? ' \u00b7 \uD83D\uDD25 ' + btStreak2 + '-night streak' : '';
        var urgency    = minsUntil <= 30 ? 'Wind down now' : 'Wind down soon';
        el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:rgba(80,100,255,0.08);border:0.5px solid rgba(100,120,255,0.2);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px;cursor:pointer"><div style="width:6px;height:6px;border-radius:50%;background:#7a80ff;flex-shrink:0"></div><div style="flex:1;font-family:var(--ff-m);font-size:11px;color:#6666aa">' + urgency + ' \u00b7 Bedtime at ' + bedStr2 + ' in ' + Math.round(minsUntil) + ' min' + streakNote + '</div><div style="font-family:var(--ff-m);font-size:10px;color:#7a80ff;opacity:.7;flex-shrink:0">\u2192</div></div>';
        return;
      }
    }

    // Tier 2b: challenge at risk
    var d = loadStripData();
    if (d.challengeLabel && d.challengeDone !== undefined) {
      var remaining = d.challengeTarget - d.challengeDone, daysLeft = 7 - new Date().getDay();
      if (remaining > 0 && remaining >= daysLeft) {
        el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:rgba(247,201,72,0.07);border:0.5px solid rgba(247,201,72,0.2);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px"><div style="width:6px;height:6px;border-radius:50%;background:#f7c948;flex-shrink:0"></div><div style="flex:1;font-family:var(--ff-m);font-size:11px;color:#998844">Challenge at risk \u00b7 ' + daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left to complete</div></div>';
        return;
      }
    }

    // Tier 3a: morning summary (6–11 am) — native stats primary, FocusScore fallback
    var h = new Date().getHours();
    if (h >= 6 && h < 11 && !_getMorningSummaryDismissed()) {
      // Try native bridge first (richer data), fall back to FocusScore.calculateSleep()
      var ln = null;
      if (IS_NATIVE && typeof N.getBedtimeLastNightStats === 'function') {
        try { var _raw = JSON.parse(N.getBedtimeLastNightStats() || 'null'); if (_raw && _raw.hasData) ln = _raw; } catch (_) {}
      }
      if (!ln) {
        var sleepRes = typeof FocusScore !== 'undefined' ? FocusScore.calculateSleep() : null;
        ln = sleepRes && sleepRes.lastNight;
        var sleepStrN = (sleepRes && sleepRes.bedStreak) || 0;
      }
      if (!sleepStrN) {
        try { if (IS_NATIVE && typeof N.getBedtimeStreak === 'function') sleepStrN = (JSON.parse(N.getBedtimeStreak() || '{}') || {}).streak || 0; } catch (_) {}
      }
      if (ln && ln.hasData) {
        var keptTxt    = ln.bedtimeKept ? 'Bedtime kept \u2713' : 'Bedtime missed';
        var keptColor  = ln.bedtimeKept ? '#6ec97a' : '#ff6b8a';
        var parts      = [];
        if ((ln.appAttemptsTotal || 0) > 0) parts.push((ln.appAttemptsTotal) + ' app attempt' + (ln.appAttemptsTotal !== 1 ? 's' : ''));
        else if (ln.bedtimeKept)            parts.push('0 app attempts');
        if ((ln.snoozeCount || 0) > 0)      parts.push(ln.snoozeCount + ' snooze' + (ln.snoozeCount !== 1 ? 's' : ''));
        var subTxt     = parts.length ? parts.join(' \u00b7 ') : 'Clean night';
        var streakPillM = sleepStrN > 0
          ? '<div style="font-family:var(--ff-m);font-size:10px;font-weight:600;color:#7a80ff;background:rgba(80,100,255,.15);border-radius:99px;padding:3px 8px;flex-shrink:0">\uD83D\uDD25 ' + sleepStrN + '</div>'
          : '';
        el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:rgba(80,100,255,0.08);border:0.5px solid rgba(100,120,255,0.2);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px;cursor:pointer"><div style="width:22px;height:22px;border-radius:7px;background:rgba(80,100,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px">\uD83C\uDF19</div><div style="flex:1"><div style="font-family:var(--ff-m);font-size:11px;font-weight:600;color:' + keptColor + ';margin-bottom:2px">Last night \u00b7 ' + keptTxt + '</div><div style="font-family:var(--ff-m);font-size:10px;color:#445588">' + subTxt + '</div></div>' + streakPillM + '<div onclick="event.stopPropagation();FocusHome.dismissMorningSummary()" style="font-family:var(--ff-m);font-size:14px;color:#445588;cursor:pointer;padding:0 4px;flex-shrink:0">\u00d7</div></div>';
        return;
      }
    }

    // Tier 3b: sleep streak celebration
    if (sk.sleepStreakCelebUntil && now < sk.sleepStreakCelebUntil) {
      var ssN = sk.prevSleepStreak || 0, ssPrev = ssN > 0 ? ssN - 1 : 0;
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:rgba(80,100,255,0.08);border:0.5px solid rgba(100,120,255,0.22);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px"><div style="width:22px;height:22px;border-radius:7px;background:rgba(80,100,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px">🌙</div><div style="flex:1"><div style="font-family:var(--ff-m);font-size:11px;font-weight:600;color:#7a80ff;margin-bottom:2px">Sleep streak \u00b7 ' + ssN + ' days</div><div style="font-family:var(--ff-m);font-size:10px;color:#445588">Bedtime respected last night</div></div><div style="font-family:var(--ff-m);font-size:10px;color:#7a80ff;background:rgba(80,100,255,0.15);border-radius:99px;padding:3px 8px;flex-shrink:0">\u2191 ' + ssPrev + '\u2192' + ssN + '</div></div>';
      return;
    }

    // Tier 3c: challenge milestone
    if (d.challengeDone > 0 && d.challengeTarget > 0 && d.challengeDone < d.challengeTarget) {
      el.innerHTML = '<div onclick="FocusTab._switchFocusSubTab(\'habits\');activateTab(\'focus\')" style="background:rgba(247,201,72,0.07);border:0.5px solid rgba(247,201,72,0.2);border-radius:14px;padding:9px 12px;display:flex;align-items:center;gap:9px"><div style="width:6px;height:6px;border-radius:50%;background:#f7c948;flex-shrink:0"></div><div style="flex:1;font-family:var(--ff-m);font-size:11px;color:#998844">' + d.challengeDone + ' of 7 days done \u00b7 On track to complete this week</div></div>';
      return;
    }
    el.innerHTML = '';
  }

  /* ═══════════════════════════════════════════════════════════════
   * SLEEP CARD  (#home-sleep-card)
   * Content consolidated into renderHomeHabitsDynamicRow.
   * This stub hides the legacy element so no duplicate strip appears.
   * ═══════════════════════════════════════════════════════════════ */
  function renderSleepCard() {
    var el = document.getElementById('home-sleep-card');
    if (el) el.style.display = 'none';
  }

  /* ═══════════════════════════════════════════════════════════════
   * TIMER ALERT  (#home-timer-alert)
   * Content consolidated into renderHomeFocusDynamicRow.
   * This stub hides the legacy element so no duplicate strip appears.
   * ═══════════════════════════════════════════════════════════════ */
  function renderTimerAlert() {
    var el = document.getElementById('home-timer-alert');
    if (el) el.style.display = 'none';
  }

  /* ── Global shims ─────────────────────────────────────────────── */
  window.renderFocusStrip            = function () { FocusHome.renderFocusStrip(); };
  window.renderLimitsStrip           = function () {};
  window.checkStreakIncrements       = function () { FocusHome.checkStreakIncrements(); };
  window.renderHomeFocusDynamicRow   = function () { FocusHome.renderHomeFocusDynamicRow(); };
  window.renderHomeHabitsDynamicRow  = function () { FocusHome.renderHomeHabitsDynamicRow(); };
  window.dismissMorningSummary       = function () { FocusHome.dismissMorningSummary(); };
  window.renderSleepCard             = function () { FocusHome.renderSleepCard(); };
  window.renderTimerAlert            = function () { FocusHome.renderTimerAlert(); };

  /* ── Public API ──────────────────────────────────────────────── */
  return {
    loadStripData:               loadStripData,
    invalidateStripCache:        invalidateStripCache,
    renderFocusStrip:            renderFocusStrip,
    renderHomeFocusDynamicRow:   renderHomeFocusDynamicRow,
    renderHomeHabitsDynamicRow:  renderHomeHabitsDynamicRow,
    checkStreakIncrements:        checkStreakIncrements,
    dismissMorningSummary:        dismissMorningSummary,
    renderSleepCard:             renderSleepCard,
    renderTimerAlert:            renderTimerAlert,
    buildDayDots:                buildDayDots,
    buildLiveSessionStripHtml:   buildLiveSessionStripHtml,
    buildCompletedStripHtml:     buildCompletedStripHtml,
    buildInterruptedStripHtml:   buildInterruptedStripHtml,
    buildFocusSubtabStripHtml:   buildFocusSubtabStripHtml,
    buildLimitsSubtabStripHtml:  buildLimitsSubtabStripHtml,
    buildHomeFocusStripHtml:     buildHomeFocusStripHtml,
    buildHomeLimitsStripHtml:    buildHomeLimitsStripHtml,
    buildStripRow:               buildStripRow,
    buildStripRowMuted:          buildStripRowMuted,
    fmtStripTimer:               _fmtStripTimer,
  };
})();