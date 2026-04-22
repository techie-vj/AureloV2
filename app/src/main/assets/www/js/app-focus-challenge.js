'use strict';
/* ═══════════════════════════════════════════════════════════════
 * WEEKLY CHALLENGE MODULE — app-focus-challenge.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Challenge pool, pick logic, progress, streak, render.
 *
 * Public API (via FocusChallenge.*):
 *   render()                 — renders #focus-challenge-wrap
 *   pickChallenge()          — returns this week's challenge or null
 *   getChallengeProgress(id) — {done}
 *   weekNumber()             — current week key string
 * ═══════════════════════════════════════════════════════════════ */
window.FocusChallenge = (function () {

  var CHALLENGE_KEY = 'disc_challenge_v1';

  var CHALLENGE_POOL = [
    {id:'no-phone-9pm',   title:'📵 Phone-free after 9pm',         desc:'Stay under 5 mins after 9pm.',           target:5, unit:'days', checkFn:'evening',   difficulty:1},
    {id:'under-goal-3',   title:'🎯 Under goal 3 days',             desc:'Hit your daily goal 3 times.',           target:3, unit:'days', checkFn:'goal',      difficulty:1},
    {id:'pickups-80',     title:'📲 Under 80 pickups',              desc:'Fewer than 80 phone pickups.',           target:3, unit:'days', checkFn:'pickups80', difficulty:1},
    {id:'late-start',     title:'🌅 No phone first 30 mins',        desc:'First pickup after 7:30am.',             target:3, unit:'days', checkFn:'morning',   difficulty:1},
    {id:'cut-top-20',     title:'✂️ Cut top app 20%',               desc:'20% less than last week.',               target:1, unit:'week', checkFn:'topapp20',  difficulty:2},
    {id:'under-goal-5',   title:'🎯 Under goal 5 days',             desc:'Hit your daily goal 5 times.',           target:5, unit:'days', checkFn:'goal',      difficulty:2},
    {id:'pickups-60',     title:'📲 Under 60 pickups',              desc:'Fewer than 60 pickups.',                 target:3, unit:'days', checkFn:'pickups60', difficulty:2},
    {id:'lunch-free',     title:'🍽️ Phone-free lunch hour',         desc:'Zero screen time 12–1pm.',               target:3, unit:'days', checkFn:'lunch',     difficulty:2},
    {id:'under-goal-7',   title:'🏆 Perfect week',                  desc:'Hit your goal every day.',               target:7, unit:'days', checkFn:'goal',      difficulty:3},
    {id:'cut-top-30',     title:'✂️ Cut top app 30%',               desc:'30% less than last week.',               target:1, unit:'week', checkFn:'topapp30',  difficulty:3},
    {id:'no-phone-10pm',  title:'🌙 Screens off after 10pm',        desc:'Zero usage after 10pm.',                 target:5, unit:'days', checkFn:'latenight', difficulty:3},
    {id:'morning-5',      title:'☀️ No phone before 9am — 5 days',  desc:'First pickup after 9am.',                target:5, unit:'days', checkFn:'morning',   difficulty:3},
    {id:'ghost-cleanup',  title:'👻 Ghost app cleanup',             desc:'Uninstall one unused app.',              target:1, unit:'app',  checkFn:'ghost',     difficulty:1},
    {id:'beat-last-week', title:'📉 Beat last week',                desc:'Total screen time lower than last week.',target:1, unit:'week', checkFn:'beatweek',  difficulty:2},
    {id:'pickups-50',     title:'📲 Under 50 pickups',              desc:'Fewer than 50 pickups.',                 target:3, unit:'days', checkFn:'pickups50', difficulty:3},
  ];

  /* ── Utilities ───────────────────────────────────────────────── */
  function _weekNumber() {
    var d   = new Date();
    var day = d.getDay();
    var monday = new Date(d);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return monday.toISOString().slice(0, 10);
  }

  function _getNextMondayDateStr() {
    var d = new Date();
    var day = d.getDay();
    var daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    return d.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
  }

  function _getLateNightMins() {
    if (!IS_NATIVE) return 0;
    try {
      var h = JSON.parse(N.getCachedHourly() || '[]');
      return h.filter(function (x) { return x.hour >= 21 || x.hour <= 5; })
              .reduce(function (s, x) { return s + (x.minutes || 0); }, 0);
    } catch (_) { return 0; }
  }

  /* ── Pick / progress ─────────────────────────────────────────── */
  function _pickChallenge() {
    var goalMins    = S.streakGoalMins || 240;
    var overDays    = WEEKLY.filter(function (d) { return d.minutes > goalMins; }).length;
    var highPickups = PICKUPS > 80;
    var lateNight   = _getLateNightMins() > 30;
    var hasGhosts   = GHOSTS.length > 0;
    var daysData    = WEEKLY.filter(function (d) { return d.minutes > 0; }).length;
    var diff        = daysData < 3 ? 1 : daysData < 6 ? 2 : 3;

    try {
      var raw  = IS_NATIVE && N.getStringPref ? N.getStringPref(CHALLENGE_KEY) : localStorage.getItem(CHALLENGE_KEY);
      var data = JSON.parse(raw || '{}');
      if (data[_weekNumber()] && data[_weekNumber()]['__skipped']) return null;
    } catch (_) {}

    var pool = CHALLENGE_POOL.filter(function (c) { return c.difficulty <= diff; });
    if (lateNight)        pool = CHALLENGE_POOL.filter(function (c) { return ['evening','latenight','no-phone-9pm','no-phone-10pm'].includes(c.checkFn) || c.id === 'no-phone-9pm'; });
    else if (highPickups) pool = CHALLENGE_POOL.filter(function (c) { return c.checkFn.includes('pickup') && c.difficulty <= diff; });
    else if (overDays >= 4) pool = CHALLENGE_POOL.filter(function (c) { return c.checkFn === 'goal' && c.difficulty <= diff; });
    else if (hasGhosts)   pool = CHALLENGE_POOL.filter(function (c) { return c.id === 'ghost-cleanup'; });
    if (!pool.length)     pool = CHALLENGE_POOL.filter(function (c) { return c.difficulty === 1; });

    // BUG 4 FIX: convert week string to numeric seed before modulo
    var weekStr  = _weekNumber();
    var weekSeed = parseInt(weekStr.replace(/-/g, ''), 10);
    return pool[weekSeed % pool.length];
  }

  function _getChallengeProgress(id) {
    try {
      var raw  = IS_NATIVE && N.getStringPref ? N.getStringPref(CHALLENGE_KEY) : localStorage.getItem(CHALLENGE_KEY);
      var data = JSON.parse(raw || '{}');
      var wn   = _weekNumber();
      return (data[wn] && data[wn][id]) ? data[wn][id] : { done: 0 };
    } catch (_) { return { done: 0 }; }
  }

  function _saveChallengeProgress(id, done) {
    try {
      var raw  = IS_NATIVE && N.getStringPref ? N.getStringPref(CHALLENGE_KEY) : localStorage.getItem(CHALLENGE_KEY);
      var data = JSON.parse(raw || '{}');
      var wn   = _weekNumber();
      if (!data[wn]) data[wn] = {};
      data[wn][id] = { done: done, updatedAt: Date.now() };
      var c = CHALLENGE_POOL.find(function (x) { return x.id === id; });
      if (c && done >= c.target) data[wn].__completed = true;
      var json = JSON.stringify(data);
      if (IS_NATIVE && N.setStringPref) N.setStringPref(CHALLENGE_KEY, json);
      else localStorage.setItem(CHALLENGE_KEY, json);
    } catch (_) {}
  }

  function _getChallengeStreak() {
    try {
      var raw  = IS_NATIVE && N.getStringPref ? N.getStringPref(CHALLENGE_KEY) : localStorage.getItem(CHALLENGE_KEY);
      var data = JSON.parse(raw || '{}');
      var weeks = [];
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
      for (var i = 0; i < 52; i++) {
        weeks.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() - 7);
      }
      var streak = 0, longest = 0, run = 0;
      for (var j = 1; j < weeks.length; j++) {
        var entry = data[weeks[j]];
        if (entry && entry.__completed) {
          run++;
          if (run > longest) longest = run;
          if (j === streak + 1) streak = run;
        } else {
          if (j === 1) break;
          break;
        }
      }
      var thisWeek = data[weeks[0]];
      if (thisWeek && thisWeek.__completed) streak++;
      return { streak: streak, longestStreak: Math.max(longest, streak) };
    } catch (_) { return { streak: 0, longestStreak: 0 }; }
  }

  /* ── Context text ────────────────────────────────────────────── */
  function _buildChallengeContext(c) {
    var g = S.streakGoalMins || 240;
    var monday = new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1));
    switch (c.checkFn) {
      case 'evening':   return 'You averaged ' + fmtM(_getLateNightMins()) + ' on your phone after 9pm last week. Try staying under 5 mins for ' + c.target + ' of the next 7 days.';
      case 'latenight': return 'Screen time after 10pm disrupts sleep. Keep it at zero for ' + c.target + ' days.';
      case 'morning':   return 'Protect your morning — no phone for the first 30 minutes, ' + c.target + ' days.';
      case 'goal':      return 'Your goal is ' + fmtM(g) + '/day. Hit it ' + c.target + ' times this week — ' + WEEKLY.filter(function (d) { return new Date(d.date) >= monday && d.minutes > 0 && d.minutes <= g; }).length + ' done so far.';
      case 'pickups80': return 'You checked your phone ' + PICKUPS + ' times today. Aim for under 80 on ' + c.target + ' days this week.';
      case 'pickups60': return 'Under 60 pickups/day means real focus. Try it ' + c.target + ' days this week.';
      case 'pickups50': return 'Under 50 pickups is exceptional. Hit it ' + c.target + ' times this week.';
      case 'lunch':     return 'A phone-free lunch resets your afternoon focus. Try it ' + c.target + ' days.';
      case 'topapp20':  { var t = DAILY_USE[0]; return t ? t.name + ' is your top app at ' + fmtM(t.totalMinutes) + '. Cut it 20% vs last week.' : 'Use your most-used app 20% less this week.'; }
      case 'topapp30':  { var t2 = DAILY_USE[0]; return t2 ? 'Cut ' + t2.name + ' by 30% this week — that\'s real progress.' : 'Cut your top app 30% vs last week.'; }
      case 'ghost':     return 'You have ' + GHOSTS.length + ' unused app' + (GHOSTS.length !== 1 ? 's' : '') + ' installed. Uninstall at least one.';
      case 'beatweek':  { var w = WEEKLY.reduce(function (s, d) { return s + (d.minutes || 0); }, 0); return w ? 'Last week\'s total was ' + fmtM(w) + '. Beat it this week.' : 'Reduce your total screen time vs last week.'; }
      default: return c.desc;
    }
  }

  /* ── Auto-check ──────────────────────────────────────────────── */
  function _autoCheckChallenge(c) {
    var g = S.streakGoalMins || 240;
    switch (c.checkFn) {
      case 'goal':      return WEEKLY.filter(function (d) { return d.minutes > 0 && d.minutes <= g; }).length;
      case 'pickups80': return PICKUPS < 80 ? 1 : 0;
      case 'pickups60': return PICKUPS < 60 ? 1 : 0;
      case 'pickups50': return PICKUPS < 50 ? 1 : 0;
      case 'evening':   return _getLateNightMins() <= 5 ? 1 : 0;
      case 'latenight': {
        var h = IS_NATIVE ? JSON.parse((N.getCachedHourly && N.getCachedHourly()) || '[]') : [];
        var afterTen = h.filter(function (x) { return x.hour >= 22; }).reduce(function (s, x) { return s + (x.minutes || 0); }, 0);
        return afterTen === 0 ? 1 : 0;
      }
      case 'morning': return 0;
      case 'lunch': {
        var h2 = IS_NATIVE ? JSON.parse((N.getCachedHourly && N.getCachedHourly()) || '[]') : [];
        var lunchMins = h2.filter(function (x) { return x.hour === 12; }).reduce(function (s, x) { return s + (x.minutes || 0); }, 0);
        return lunchMins === 0 ? 1 : 0;
      }
      default: return 0;
    }
  }

  /* ── Manual check progress ───────────────────────────────────── */
  function checkProgress(id) {
    var c = CHALLENGE_POOL.find(function (x) { return x.id === id; });
    if (!c) return;
    var cur  = _getChallengeProgress(id);
    var auto = _autoCheckChallenge(c);
    var manualOnly = ['morning','topapp20','topapp30','beatweek','ghost','lunch','latenight'];
    var newDone = manualOnly.includes(c.checkFn)
      ? Math.min(cur.done + 1, c.target)
      : (c.unit === 'days' && auto > 0) ? cur.done + 1 : Math.max(cur.done, auto);
    _saveChallengeProgress(id, newDone);
    if (newDone >= c.target) toast('🏆 Challenge complete! Streak extended.', 'success', 3000);
    else toast('Progress: ' + newDone + '/' + c.target + ' — keep going!', 'info', 2000);
    if (newDone >= c.target && IS_NATIVE && typeof N.checkAndTriggerRateApp === 'function') {
      try { N.checkAndTriggerRateApp('challenge_complete'); } catch (_) {}
    }
    // Immediately refresh home strips so challenge tier (at-risk / milestone) updates
    // without requiring a tab-switch or waiting for the next 30-s poll.
    if (typeof FocusHome !== 'undefined') FocusHome._refreshStrips();
    var old = document.getElementById('challenge-card');
    if (old) { var tmp = document.createElement('div'); tmp.innerHTML = _buildChallengeSection(); var newCard = tmp.querySelector('#challenge-card'); if (newCard) old.replaceWith(newCard); }
  }

  function skipChallenge() {
    showConfirm('Skip this challenge?', 'A new challenge will be available next week.', function () {
      try {
        var raw  = IS_NATIVE && N.getStringPref ? N.getStringPref(CHALLENGE_KEY) : localStorage.getItem(CHALLENGE_KEY);
        var data = JSON.parse(raw || '{}');
        var wn   = _weekNumber();
        if (!data[wn]) data[wn] = {};
        data[wn]['__skipped'] = true;
        var json = JSON.stringify(data);
        if (IS_NATIVE && N.setStringPref) N.setStringPref(CHALLENGE_KEY, json);
        else localStorage.setItem(CHALLENGE_KEY, json);
      } catch (_) {}
      toast('Challenge skipped', 'info', 1500);
      // Refresh home strips so the "challenge at risk" and "milestone" tiers
      // disappear immediately — without needing a tab-switch or 30-s poll.
      if (typeof FocusHome !== 'undefined') FocusHome._refreshStrips();
      var card = document.getElementById('challenge-card');
      if (card) {
        var wrap2 = card.closest('#focus-challenge-wrap');
        if (wrap2) {
          var tmp2 = document.createElement('div');
          tmp2.innerHTML = _buildChallengeSkippedSection();
          wrap2.innerHTML = tmp2.innerHTML;
        } else {
          card.parentElement && (card.parentElement.innerHTML = '');
        }
      }
      if (typeof _discLoaded !== 'undefined' && _discLoaded) {
        _discLoaded = false;
        if (typeof _renderDiscover === 'function') _renderDiscover();
      }
    });
  }

  /* ── HTML builders ───────────────────────────────────────────── */
  function _buildChallengeSection() {
    var challenge = _pickChallenge();
    if (!challenge) return _buildChallengeSkippedSection();
    var context    = _buildChallengeContext(challenge);
    var progress   = _getChallengeProgress(challenge.id);
    var done       = progress.done || 0;
    var total      = challenge.target;
    var isComplete = done >= total;

    var dots = challenge.unit === 'days'
      ? Array.from({length: total}, function (_, i) {
          var cls = i < done ? 'done' : i === done ? 'today' : '';
          var bg  = cls === 'done' ? 'var(--g)' : cls === 'today' ? 'linear-gradient(90deg,var(--g),var(--p))' : 'var(--s3)';
          return '<div style="height:6px;flex:1;border-radius:3px;background:' + bg + (cls === 'today' ? ';box-shadow:0 0 8px rgba(61,214,140,.4)' : '') + '"></div>';
        }).join('')
      : '';

    var progressLabel = challenge.unit === 'days' ? done + '/' + total + ' days done' : isComplete ? 'Complete ✓' : 'In progress';
    var streakData    = _getChallengeStreak();
    var streakTip     = streakData.streak > 0
      ? '🔥 ' + streakData.streak + '-week streak — complete to keep it going'
      : '🏆 Complete to start your streak — tracked on your device';

    return '<div style="padding:18px 20px 10px;display:flex;align-items:baseline;justify-content:space-between">' +
        '<div>' +
          '<div style="font-family:var(--ff-d);font-size:16px;font-weight:700">This Week\'s Challenge</div>' +
          '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px;letter-spacing:.5px">BASED ON YOUR PATTERNS · LOCAL ONLY</div>' +
        '</div>' +
        '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">Day ' + Math.min(done+1,total) + ' of ' + total + '</div>' +
      '</div>' +
      '<div style="margin:0 20px;border-radius:20px;background:linear-gradient(135deg,rgba(124,111,255,.1),rgba(61,214,140,.06));border:1px solid rgba(124,111,255,.22);padding:16px;position:relative;overflow:hidden" id="challenge-card">' +
        '<div style="position:absolute;top:-20px;right:-20px;width:100px;height:100px;border-radius:50%;background:rgba(124,111,255,.05);pointer-events:none"></div>' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--p2);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">' +
          '<div style="width:6px;height:6px;border-radius:50%;background:var(--p);box-shadow:0 0 6px var(--p);flex-shrink:0"></div>' +
          'Week of ' + _weekNumber() + ' · Personalised for you' +
        '</div>' +
        '<div style="font-size:16px;font-weight:700;margin-bottom:5px;color:var(--t1)">' + challenge.title + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.6;margin-bottom:14px">' + context + '</div>' +
        (dots ? '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="display:flex;gap:5px;flex:1">' + dots + '</div><div style="font-family:var(--ff-m);font-size:10px;color:var(--t2);white-space:nowrap">' + progressLabel + '</div></div>'
              : '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);margin-bottom:14px">' + progressLabel + '</div>') +
        '<div style="display:flex;gap:8px">' +
          '<button type="button" onclick="FocusChallenge.checkProgress(\'' + challenge.id + '\')" style="flex:1;padding:11px;border-radius:12px;border:none;background:linear-gradient(135deg,var(--p),var(--c));color:#fff;font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer">' +
            (isComplete ? '🏆 Completed!' : 'Check Progress →') +
          '</button>' +
          '<button type="button" onclick="FocusChallenge.skipChallenge()" style="padding:11px 14px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--t3);font-family:var(--ff-m);font-size:11px;cursor:pointer">Skip</button>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:7px;padding:9px 10px;background:rgba(247,184,35,.07);border:1px solid rgba(247,184,35,.18);border-radius:10px;margin-top:10px">' +
          '<span style="font-size:14px">🏆</span>' +
          '<span style="font-family:var(--ff-m);font-size:10px;color:var(--a)">' + streakTip + '</span>' +
        '</div>' +
      '</div>';
  }

  function _buildChallengeSkippedSection() {
    return '<div style="padding:18px 20px 10px">' +
        '<div style="font-family:var(--ff-d);font-size:16px;font-weight:700">This Week\'s Challenge</div>' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px;letter-spacing:.5px">BASED ON YOUR PATTERNS · LOCAL ONLY</div>' +
      '</div>' +
      '<div style="margin:0 20px;border-radius:20px;background:var(--s1);border:1px solid var(--border);padding:20px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px">' +
        '<div style="font-size:28px;opacity:.5">📅</div>' +
        '<div style="font-size:14px;font-weight:600;color:var(--t1)">Your next challenge starts ' + _getNextMondayDateStr() + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);line-height:1.6;max-width:260px">You\'ve skipped this week\'s challenge. A new personalised challenge will be ready for you on Monday.</div>' +
      '</div>';
  }

  /* ── Render ──────────────────────────────────────────────────── */
  function render() {
    var el = document.getElementById('focus-challenge-wrap');
    if (!el) return;

    if (!ProTier.isPro) {
      el.innerHTML =
        '<div style="padding:18px 20px 10px;display:flex;align-items:baseline;justify-content:space-between">' +
          '<div>' +
            '<div style="font-family:var(--ff-d);font-size:16px;font-weight:700">This Week\'s Challenge</div>' +
            '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px;letter-spacing:.5px">BASED ON YOUR PATTERNS · LOCAL ONLY</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin:0 20px;position:relative;border-radius:20px;overflow:hidden;cursor:pointer"' +
          ' class="challenge-locked" onclick="ProTier.triggerUpsell(\'WEEKLY_CHALLENGE\')">' +
          '<div style="filter:blur(5px);pointer-events:none;background:linear-gradient(135deg,rgba(124,111,255,.1),rgba(61,214,140,.06));border:1px solid rgba(124,111,255,.22);border-radius:20px;padding:16px">' +
            '<div style="font-size:16px;font-weight:700;margin-bottom:5px;color:var(--t1)">🎯 Under goal 3 days</div>' +
            '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.6;margin-bottom:14px">Hit your daily goal 3 times this week — 1 done so far.</div>' +
            '<div style="display:flex;gap:5px;flex:1;margin-bottom:14px">' +
              Array.from({length:7}, function (_, i) {
                return '<div style="height:6px;flex:1;border-radius:3px;background:' + (i < 1 ? 'var(--g)' : 'var(--s3)') + '"></div>';
              }).join('') +
            '</div>' +
            '<button style="width:100%;padding:11px;border-radius:12px;border:none;background:linear-gradient(135deg,var(--p),var(--c));color:#fff;font-family:var(--ff-m);font-size:12px;font-weight:700">Check Progress →</button>' +
          '</div>' +
          '<div class="pro-lock-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(0,0,0,.18)">' +
            (typeof proBadge === 'function' ? proBadge() : '') +
            '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2)">Unlock weekly challenges</div>' +
          '</div>' +
        '</div>';
      return;
    }

    el.innerHTML = _buildChallengeSection();

    // Init: auto-check progress
    var c = _pickChallenge();
    if (c) {
      var auto = _autoCheckChallenge(c);
      if (auto > 0) _saveChallengeProgress(c.id, auto);
    }
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    render,
    pickChallenge:       _pickChallenge,
    getChallengeProgress: _getChallengeProgress,
    getChallengeStreak:  _getChallengeStreak,
    weekNumber:          _weekNumber,
    checkProgress,
    skipChallenge,
  };
})();

/* ── Global shims ─────────────────────────────────────────────── */
function _checkChallengeProgress(id) { FocusChallenge.checkProgress(id); }
function _skipChallenge() { FocusChallenge.skipChallenge(); }