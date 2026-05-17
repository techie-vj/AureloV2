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
    /* ── Original 15 ─────────────────────────────────────────── */
    {id:'no-phone-9pm',   title:'📵 Phone-free after 9pm',         desc:'Stay under 5 mins after 9pm.',           target:5,   unit:'days',    checkFn:'evening',          difficulty:1},
    {id:'under-goal-3',   title:'🎯 Under goal 3 days',             desc:'Hit your daily goal 3 times.',           target:3,   unit:'days',    checkFn:'goal',             difficulty:1},
    {id:'pickups-80',     title:'📲 Under 80 pickups',              desc:'Fewer than 80 phone pickups.',           target:3,   unit:'days',    checkFn:'pickups80',        difficulty:1},
    {id:'late-start',     title:'🌅 No phone first 30 mins',        desc:'First pickup after 7:30am.',             target:3,   unit:'days',    checkFn:'morning',          difficulty:1},
    {id:'cut-top-20',     title:'✂️ Cut top app 20%',               desc:'20% less than last week.',               target:1,   unit:'week',    checkFn:'topapp20',         difficulty:2},
    {id:'under-goal-5',   title:'🎯 Under goal 5 days',             desc:'Hit your daily goal 5 times.',           target:5,   unit:'days',    checkFn:'goal',             difficulty:2},
    {id:'pickups-60',     title:'📲 Under 60 pickups',              desc:'Fewer than 60 pickups.',                 target:3,   unit:'days',    checkFn:'pickups60',        difficulty:2},
    {id:'lunch-free',     title:'🍽️ Phone-free lunch hour',         desc:'Zero screen time 12–1pm.',               target:3,   unit:'days',    checkFn:'lunch',            difficulty:2},
    {id:'under-goal-7',   title:'🏆 Perfect week',                  desc:'Hit your goal every day.',               target:7,   unit:'days',    checkFn:'goal',             difficulty:3},
    {id:'cut-top-30',     title:'✂️ Cut top app 30%',               desc:'30% less than last week.',               target:1,   unit:'week',    checkFn:'topapp30',         difficulty:3},
    {id:'no-phone-10pm',  title:'🌙 Screens off after 10pm',        desc:'Zero usage after 10pm.',                 target:5,   unit:'days',    checkFn:'latenight',        difficulty:3},
    {id:'morning-5',      title:'☀️ No phone before 9am — 5 days',  desc:'First pickup after 9am.',                target:5,   unit:'days',    checkFn:'morning',          difficulty:3},
    {id:'ghost-cleanup',  title:'👻 Ghost app cleanup',             desc:'Uninstall one unused app.',              target:1,   unit:'app',     checkFn:'ghost',            difficulty:1},
    {id:'beat-last-week', title:'📉 Beat last week',                desc:'Total screen time lower than last week.',target:1,   unit:'week',    checkFn:'beatweek',         difficulty:2},
    {id:'pickups-50',     title:'📲 Under 50 pickups',              desc:'Fewer than 50 pickups.',                 target:3,   unit:'days',    checkFn:'pickups50',        difficulty:3},

    /* ── Focus Sessions ───────────────────────────────────────── */
    {id:'focus-3-sessions',  title:'🎯 3 Focus Sessions',           desc:'Complete 3 focus sessions this week.',   target:3,   unit:'sessions',checkFn:'focusSessions',    difficulty:1},
    {id:'focus-5-sessions',  title:'🎯 5 Focus Sessions',           desc:'Complete 5 focus sessions this week.',   target:5,   unit:'sessions',checkFn:'focusSessions',    difficulty:2},
    {id:'focus-deep-45',     title:'🧠 Deep Work Day',              desc:'Complete one 45-min+ Deep focus session.',target:1,  unit:'session', checkFn:'focusDeep45',      difficulty:2},
    {id:'focus-daily-habit', title:'🔁 Focus Every Day',            desc:'At least 1 focus session every day.',    target:5,   unit:'days',    checkFn:'focusDaily',       difficulty:3},
    {id:'focus-2h-total',    title:'⏳ 2 Hours of Focus',           desc:'Accumulate 2h of focus time this week.', target:120, unit:'mins',    checkFn:'focusTotalMins',   difficulty:3},

    /* ── Mindful Pause ────────────────────────────────────────── */
    {id:'mindful-resist-5',    title:'🧘 Resist 5 Times',           desc:'Tap "Resist" on 5 mindful pauses.',      target:5,   unit:'resists', checkFn:'mindfulResist',    difficulty:1},
    {id:'mindful-resist-rate', title:'🛑 50% Resist Rate',          desc:'Resist at least half your mindful pauses.',target:1, unit:'week',    checkFn:'mindfulResistRate', difficulty:2},

    /* ── Social Media ─────────────────────────────────────────── */
    {id:'social-under-30',    title:'📵 Social under 30 mins',      desc:'Keep social media under 30 mins/day.',   target:3,   unit:'days',    checkFn:'socialUnder30',    difficulty:2},
    {id:'social-free-morning',title:'🌅 Social-free mornings',      desc:'No social apps before noon for 3 days.', target:3,   unit:'days',    checkFn:'socialFreeMorning',difficulty:2},
    {id:'social-cut-40',      title:'✂️ Social media -40%',         desc:'Cut social apps 40% vs last week.',      target:1,   unit:'week',    checkFn:'socialCut40',      difficulty:3},
    {id:'no-social-3days',    title:'🚫 3 Social-free days',        desc:'Zero social media on 3 days this week.', target:3,   unit:'days',    checkFn:'noSocial3Days',    difficulty:3},

    /* ── Bedtime Streak ───────────────────────────────────────── */
    {id:'bedtime-3-streak', title:'🌙 Bedtime 3 nights',            desc:'Hit your bedtime 3 nights in a row.',    target:3,   unit:'nights',  checkFn:'bedtimeStreak',    difficulty:1},
    {id:'bedtime-5-streak', title:'😴 Bedtime 5 nights',            desc:'Keep your bedtime streak for 5 nights.', target:5,   unit:'nights',  checkFn:'bedtimeStreak',    difficulty:2},
    {id:'no-snooze-3',      title:'🚫 No bedtime snooze',           desc:"Don't snooze bedtime for 3 nights.",     target:3,   unit:'nights',  checkFn:'noSnooze',         difficulty:2},

    /* ── Weekend ──────────────────────────────────────────────── */
    {id:'weekend-under-goal',  title:'🏖️ Weekend goals',            desc:'Stay under goal both Sat and Sun.',      target:2,   unit:'days',    checkFn:'weekendGoal',      difficulty:2},
    {id:'sunday-detox',        title:'🌿 Sunday detox',             desc:'Under 30 mins total on Sunday.',         target:1,   unit:'day',     checkFn:'sundayDetox',      difficulty:3},
    {id:'weekend-pickup-40',   title:'📲 Chill weekend',            desc:'Under 40 pickups on both weekend days.', target:2,   unit:'days',    checkFn:'weekendPickups40', difficulty:2},

    /* ── Shareable "Wow Moment" ───────────────────────────────── */
    {id:'beat-personal-best',  title:'⭐ New Personal Best',        desc:'Beat your all-time best screen time day.',target:1,  unit:'day',     checkFn:'personalBest',     difficulty:2},
    {id:'pickup-drop-25',      title:'📉 25% fewer pickups',        desc:'Reduce pickups 25% vs your weekly avg.', target:1,   unit:'week',    checkFn:'pickupDrop25',     difficulty:2},
    {id:'digital-sunset',      title:'🌇 Digital sunset',           desc:'No phone after 8pm for 5 days.',         target:5,   unit:'days',    checkFn:'digitalSunset',    difficulty:3},
    {id:'phone-free-meal-7',   title:'🍽️ Mindful meals — full week',desc:'No phone during any meal, 7 days.',      target:7,   unit:'days',    checkFn:'phoneFreeMeal',    difficulty:3},

    /* ── Combo ────────────────────────────────────────────────── */
    {id:'focus-and-goal', title:'🎯+✅ Focus & Goal',               desc:'Use a focus session AND hit goal — 3 days.',target:3, unit:'days',   checkFn:'focusAndGoal',     difficulty:2},
    {id:'timer-set',      title:'⏱️ Set a timer',                   desc:'Add an app timer for your top app.',     target:1,   unit:'action',  checkFn:'timerSet',         difficulty:1},

    /* ── Round 3: to reach 52 ─────────────────────────────────── */

    // Specific hour targets — concrete, shareable ("I stayed under 2h today!")
    {id:'under-2h-3days',    title:'⏱️ Under 2h — 3 days',         desc:'Keep screen time under 2h on 3 days.',   target:3,   unit:'days',    checkFn:'under2h',          difficulty:2},
    {id:'under-3h-5days',    title:'⏱️ Under 3h — 5 days',         desc:'Keep screen time under 3h on 5 days.',   target:5,   unit:'days',    checkFn:'under3h',          difficulty:2},

    // Weekly total target — a single satisfying number to beat
    {id:'weekly-under-14h',  title:'📊 Under 14h this week',        desc:'Total screen time under 14h for the week.',target:1, unit:'week',    checkFn:'weeklyUnder14h',   difficulty:2},

    // Entertainment detox — second biggest time sink after social
    {id:'no-entertain-3',    title:'🎬 Entertainment detox',        desc:'No entertainment apps for 3 days.',      target:3,   unit:'days',    checkFn:'noEntertain3',     difficulty:2},

    // Focus quality — rewards finishing sessions, not just starting them
    {id:'focus-quality',     title:'✅ Finish what you start',       desc:'Complete 80%+ of focus sessions this week.',target:1, unit:'week',  checkFn:'focusQuality',     difficulty:2},

    // Score improvement — the most motivating meta-challenge, extremely shareable
    {id:'score-improve-10',  title:'📈 Level up your score',        desc:'Improve your Aurelo Score by 10 points this week.',target:1, unit:'week', checkFn:'scoreImprove', difficulty:2},

    // Breakfast — new meal slot, easier than dinner, builds morning routine
    {id:'breakfast-free-5',  title:'☕ Screen-free breakfast',       desc:'No phone during breakfast (7–9am) 5 days.',target:5, unit:'days',   checkFn:'breakfastFree',    difficulty:1},

    // All-7-days evening — hardest evening challenge in the pool
    {id:'zero-9pm-7days',    title:'🌑 Zero after 9pm — full week', desc:'Zero screen time after 9pm all 7 days.',  target:7,  unit:'days',    checkFn:'zeroEvening7',     difficulty:3},

    // Feature adoption — sets up a permanent habit tool, D1 because action is instant
    {id:'mindful-social',    title:'🧘 Mindful social setup',        desc:'Add mindful pause to all your social apps.',target:1, unit:'action', checkFn:'mindfulSocial',   difficulty:1},
    {id:'app-hide-1',        title:'🙈 Out of sight, out of mind',   desc:'Hide your most distracting app.',        target:1,   unit:'action',  checkFn:'appHide',          difficulty:1},

    // Micro-session trap — tackles the sub-2-min dopamine-loop pickups
    {id:'no-micro-sessions', title:'🧹 No micro-sessions',          desc:'Fewer than 15 sub-2-min sessions per day.',target:4,  unit:'days',    checkFn:'noMicroSessions',  difficulty:3},
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

  /* ── Data helpers ────────────────────────────────────────────── */
  function _getFocusStats() {
    try { return IS_NATIVE && N.getFocusStats ? JSON.parse(N.getFocusStats() || '{}') : {}; }
    catch (_) { return {}; }
  }

  function _getFocusWeekDays() {
    try { return IS_NATIVE && N.getFocusWeekDays ? JSON.parse(N.getFocusWeekDays() || '[]') : []; }
    catch (_) { return []; }
  }

  function _getMindfulStats() {
    try {
      if (!IS_NATIVE) return { pauses: 0, resists: 0 };
      var pauses  = parseInt(N.getIntentionPauseCount  ? (N.getIntentionPauseCount()  || '0') : '0', 10);
      var resists = parseInt(N.getIntentionResistCount ? (N.getIntentionResistCount() || '0') : '0', 10);
      return { pauses: pauses, resists: resists };
    } catch (_) { return { pauses: 0, resists: 0 }; }
  }

  function _getBedtimeStreak() {
    try { return IS_NATIVE && N.getBedtimeStreak ? parseInt(N.getBedtimeStreak() || '0', 10) : 0; }
    catch (_) { return 0; }
  }

  function _getBedtimeSnoozeCount() {
    try { return IS_NATIVE && N.getBedtimeSnoozeCount ? parseInt(N.getBedtimeSnoozeCount() || '0', 10) : 0; }
    catch (_) { return 0; }
  }

  function _getSocialMinsToday() {
    try {
      return (DAILY_USE || [])
        .filter(function (a) { var c = (a.category || '').toLowerCase(); return c === 'social' || c === 'social media'; })
        .reduce(function (s, a) { return s + (a.totalMinutes || a.minutes || 0); }, 0);
    } catch (_) { return 0; }
  }

  function _getEntertainMinsToday() {
    try {
      return (DAILY_USE || [])
        .filter(function (a) { var c = (a.category || '').toLowerCase(); return c === 'entertainment' || c === 'video'; })
        .reduce(function (s, a) { return s + (a.totalMinutes || a.minutes || 0); }, 0);
    } catch (_) { return 0; }
  }

  function _socialBeforeNoonToday() {
    try {
      var h = IS_NATIVE && N.getCachedHourly ? JSON.parse(N.getCachedHourly() || '[]') : [];
      var hasSocial = (DAILY_USE || []).some(function (a) {
        var c = (a.category || '').toLowerCase();
        return c === 'social' || c === 'social media';
      });
      if (!hasSocial) return false;
      return h.filter(function (x) { return x.hour < 12; }).reduce(function (s, x) { return s + (x.minutes || 0); }, 0) > 0;
    } catch (_) { return false; }
  }

  function _getHourMins(hourFrom, hourTo) {
    try {
      var h = IS_NATIVE && N.getCachedHourly ? JSON.parse(N.getCachedHourly() || '[]') : [];
      return h.filter(function (x) { return x.hour >= hourFrom && x.hour < hourTo; })
              .reduce(function (s, x) { return s + (x.minutes || 0); }, 0);
    } catch (_) { return 0; }
  }

  function _getAppTimerCount() {
    try { return JSON.parse((IS_NATIVE && N.getAppLimits ? N.getAppLimits() : '[]') || '[]').length; }
    catch (_) { return 0; }
  }

  function _getHiddenAppsCount() {
    try { return JSON.parse((IS_NATIVE && N.getHiddenApps ? N.getHiddenApps() : '[]') || '[]').length; }
    catch (_) { return 0; }
  }

  function _getIntentionAppsCount() {
    try { return JSON.parse((IS_NATIVE && N.getIntentionPromptApps ? N.getIntentionPromptApps() : '[]') || '[]').length; }
    catch (_) { return 0; }
  }

  function _getSocialAppCount() {
    try {
      return (DAILY_USE || []).filter(function (a) {
        var c = (a.category || '').toLowerCase();
        return c === 'social' || c === 'social media';
      }).length;
    } catch (_) { return 0; }
  }

  function _getPersonalBestMins() {
    try {
      var mins = (WEEKLY || []).filter(function (d) { return d.minutes > 0; }).map(function (d) { return d.minutes; });
      return mins.length ? Math.min.apply(null, mins) : 9999;
    } catch (_) { return 9999; }
  }

  function _getWeeklyTotalMins() {
    return (WEEKLY || []).reduce(function (s, d) { return s + (d.minutes || 0); }, 0);
  }

  function _isWeekend(dateStr) {
    var day = new Date(dateStr).getDay();
    return day === 0 || day === 6;
  }

  function _getWeekendDays() {
    return (WEEKLY || []).filter(function (d) { return _isWeekend(d.date); });
  }

  function _getCurrentAureloScore() {
    try {
      if (typeof FocusScore !== 'undefined' && FocusScore.calculateAurelo) {
        var r = FocusScore.calculateAurelo();
        return r ? (r.score || 0) : 0;
      }
    } catch (_) {}
    return 0;
  }

  /* ── Pick / progress ─────────────────────────────────────────── */
  function _pickChallenge() {
    var goalMins         = S.streakGoalMins || 240;
    var overDays         = WEEKLY.filter(function (d) { return d.minutes > goalMins; }).length;
    var highPickups      = PICKUPS > 80;
    var lateNight        = _getLateNightMins() > 30;
    var hasGhosts        = GHOSTS.length > 0;
    var daysData         = WEEKLY.filter(function (d) { return d.minutes > 0; }).length;
    var diff             = daysData < 3 ? 1 : daysData < 6 ? 2 : 3;
    var socialHeavy      = _getSocialMinsToday() > 60;
    var entertainHeavy   = _getEntertainMinsToday() > 90;
    var focusStats       = _getFocusStats();
    var hasFocusSessions = (focusStats.completed || 0) > 0;

    try {
      var raw  = IS_NATIVE && N.getStringPref ? N.getStringPref(CHALLENGE_KEY) : localStorage.getItem(CHALLENGE_KEY);
      var data = JSON.parse(raw || '{}');
      if (data[_weekNumber()] && data[_weekNumber()]['__skipped']) return null;
    } catch (_) {}

    var pool;
    if (lateNight) {
      pool = CHALLENGE_POOL.filter(function (c) {
        return ['evening','latenight','digitalSunset','zeroEvening7'].indexOf(c.checkFn) !== -1 && c.difficulty <= diff;
      });
    } else if (socialHeavy) {
      pool = CHALLENGE_POOL.filter(function (c) {
        return ['socialUnder30','socialFreeMorning','socialCut40','noSocial3Days'].indexOf(c.checkFn) !== -1 && c.difficulty <= diff;
      });
    } else if (entertainHeavy) {
      pool = CHALLENGE_POOL.filter(function (c) {
        return c.checkFn === 'noEntertain3' && c.difficulty <= diff;
      });
    } else if (highPickups) {
      pool = CHALLENGE_POOL.filter(function (c) {
        return (c.checkFn.indexOf('pickup') !== -1 || c.checkFn === 'noMicroSessions') && c.difficulty <= diff;
      });
    } else if (overDays >= 4) {
      pool = CHALLENGE_POOL.filter(function (c) {
        return (c.checkFn === 'goal' || c.checkFn === 'under2h' || c.checkFn === 'under3h' || c.checkFn === 'weeklyUnder14h') && c.difficulty <= diff;
      });
    } else if (hasFocusSessions) {
      pool = CHALLENGE_POOL.filter(function (c) {
        return ['focusSessions','focusDeep45','focusDaily','focusTotalMins','focusAndGoal','focusQuality'].indexOf(c.checkFn) !== -1 && c.difficulty <= diff;
      });
    } else if (hasGhosts) {
      pool = CHALLENGE_POOL.filter(function (c) { return c.id === 'ghost-cleanup'; });
    } else {
      pool = CHALLENGE_POOL.filter(function (c) { return c.difficulty <= diff; });
    }
    if (!pool.length) pool = CHALLENGE_POOL.filter(function (c) { return c.difficulty === 1; });

    var weekSeed = parseInt(_weekNumber().replace(/-/g, ''), 10);
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
    var g      = S.streakGoalMins || 240;
    var monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1));

    switch (c.checkFn) {
      /* ── Original ── */
      case 'evening':   return 'You averaged ' + fmtM(_getLateNightMins()) + ' on your phone after 9pm last week. Try staying under 5 mins for ' + c.target + ' of the next 7 days.';
      case 'latenight': return 'Screen time after 10pm disrupts sleep. Keep it at zero for ' + c.target + ' days.';
      case 'morning':   return 'Protect your morning — no phone for the first 30 minutes, ' + c.target + ' days.';
      case 'goal':      return 'Your goal is ' + fmtM(g) + '/day. Hit it ' + c.target + ' times this week — ' + WEEKLY.filter(function (d) { return new Date(d.date) >= monday && d.minutes > 0 && d.minutes <= g; }).length + ' done so far.';
      case 'pickups80': return 'You checked your phone ' + PICKUPS + ' times today. Aim for under 80 on ' + c.target + ' days this week.';
      case 'pickups60': return 'Under 60 pickups/day means real focus. Try it ' + c.target + ' days this week.';
      case 'pickups50': return 'Under 50 pickups is exceptional. Hit it ' + c.target + ' times this week.';
      case 'lunch':     return 'A phone-free lunch resets your afternoon focus. Try it ' + c.target + ' days.';
      case 'topapp20':  { var ta = DAILY_USE[0]; return ta ? ta.name + ' is your top app at ' + fmtM(ta.totalMinutes) + '. Cut it 20% vs last week.' : 'Use your most-used app 20% less this week.'; }
      case 'topapp30':  { var tb = DAILY_USE[0]; return tb ? 'Cut ' + tb.name + ' by 30% this week — that\'s real progress.' : 'Cut your top app 30% vs last week.'; }
      case 'ghost':     return 'You have ' + GHOSTS.length + ' unused app' + (GHOSTS.length !== 1 ? 's' : '') + ' installed. Uninstall at least one.';
      case 'beatweek':  { var w = _getWeeklyTotalMins(); return w ? 'Last week\'s total was ' + fmtM(w) + '. Beat it this week.' : 'Reduce your total screen time vs last week.'; }

      /* ── Focus Sessions ── */
      case 'focusSessions': {
        var fs  = _getFocusStats();
        return 'Complete ' + c.target + ' focus sessions this week. You\'ve finished ' + (fs.completed || 0) + ' so far — each session counts!';
      }
      case 'focusDeep45': return 'Start a Deep focus session of 45+ minutes. Deep mode fully blocks distractions for serious work.';
      case 'focusDaily': {
        var fdays = _getFocusWeekDays().filter(Boolean).length;
        return 'Build a daily focus habit — at least 1 session each day. ' + fdays + ' of 7 days done so far.';
      }
      case 'focusTotalMins': {
        var fs2 = _getFocusStats();
        return 'Accumulate 2 hours of focused work this week. You\'ve logged ' + fmtM(fs2.totalMins || 0) + ' so far.';
      }

      /* ── Mindful Pause ── */
      case 'mindfulResist': {
        var ms = _getMindfulStats();
        return 'Tap "Resist" on 5 mindful pauses this week. You\'ve resisted ' + ms.resists + ' time' + (ms.resists !== 1 ? 's' : '') + ' so far.';
      }
      case 'mindfulResistRate': {
        var ms2  = _getMindfulStats();
        var rate = ms2.pauses > 0 ? Math.round(ms2.resists / ms2.pauses * 100) : 0;
        return 'Resist at least half your mindful pauses this week. Current rate: ' + rate + '% (' + ms2.resists + '/' + ms2.pauses + ' pauses).';
      }

      /* ── Social Media ── */
      case 'socialUnder30':    return 'Keep social media under 30 mins/day for ' + c.target + ' days. Today: ' + fmtM(_getSocialMinsToday()) + '.';
      case 'socialFreeMorning': return 'No social apps before noon for ' + c.target + ' days. Protect your morning focus window.';
      case 'socialCut40': {
        var sc = _getSocialMinsToday();
        return sc ? 'Cut your social media time 40% vs last week. Currently at ' + fmtM(sc) + ' today.' : 'Reduce your total social media time by 40% compared to last week.';
      }
      case 'noSocial3Days': return 'Zero social media on 3 days this week. Pick your 3 best days and commit.';

      /* ── Bedtime ── */
      case 'bedtimeStreak': {
        var bstr = _getBedtimeStreak();
        return 'Hit your configured bedtime for ' + c.target + ' nights in a row. Current streak: ' + bstr + ' night' + (bstr !== 1 ? 's' : '') + '.';
      }
      case 'noSnooze': return 'Don\'t snooze bedtime for ' + c.target + ' nights. Tonight\'s snooze count: ' + _getBedtimeSnoozeCount() + '.';

      /* ── Weekend ── */
      case 'weekendGoal': {
        var wknd = _getWeekendDays().filter(function (d) { return d.minutes <= g; }).length;
        return 'Stay under your ' + fmtM(g) + ' goal on both Saturday and Sunday. ' + wknd + '/2 done this weekend.';
      }
      case 'sundayDetox': {
        var sun = _getWeekendDays().find(function (d) { return new Date(d.date).getDay() === 0; });
        return 'Keep Sunday under 30 minutes total. ' + (sun ? fmtM(sun.minutes) + ' used so far this Sunday.' : 'Sunday not tracked yet — start fresh.');
      }
      case 'weekendPickups40': return 'Under 40 pickups on both Saturday and Sunday. Today\'s pickups: ' + PICKUPS + '.';

      /* ── Wow Moments ── */
      case 'personalBest': {
        var pb = _getPersonalBestMins();
        return 'Beat your personal best screen time record. Best day this week so far: ' + (pb < 9999 ? fmtM(pb) : 'not set yet') + '.';
      }
      case 'pickupDrop25': return 'Reduce your pickup count by 25% vs your usual average. You\'re at ' + PICKUPS + ' today.';
      case 'digitalSunset': return 'No phone after 8pm for ' + c.target + ' days. Put it down before sunset and wind down naturally.';
      case 'phoneFreeMeal': return 'No phone during any meal for 7 days — breakfast, lunch, and dinner. Meals are for presence, not screens.';

      /* ── Combo ── */
      case 'focusAndGoal': {
        var gdays = WEEKLY.filter(function (d) { return new Date(d.date) >= monday && d.minutes > 0 && d.minutes <= g; }).length;
        var fs3   = _getFocusStats();
        return 'Use a focus session AND hit your goal on the same day, ' + c.target + ' times this week. Goal days: ' + gdays + ', focus sessions: ' + (fs3.completed || 0) + '.';
      }
      case 'timerSet': {
        var tc = _getAppTimerCount();
        return tc > 0
          ? 'You\'ve already set ' + tc + ' app timer' + (tc !== 1 ? 's' : '') + ' — great start! Add one for your most-used app.'
          : 'Add an app timer for your top app. Timers create natural usage limits without willpower.';
      }

      /* ── Round 3 ── */
      case 'under2h': {
        var u2 = WEEKLY.filter(function (d) { return d.minutes > 0 && d.minutes <= 120; }).length;
        return 'Stay under 2 hours of screen time on ' + c.target + ' days this week. ' + u2 + ' day' + (u2 !== 1 ? 's' : '') + ' done so far.';
      }
      case 'under3h': {
        var u3 = WEEKLY.filter(function (d) { return d.minutes > 0 && d.minutes <= 180; }).length;
        return 'Stay under 3 hours of screen time on ' + c.target + ' days this week. ' + u3 + ' day' + (u3 !== 1 ? 's' : '') + ' done so far.';
      }
      case 'weeklyUnder14h': {
        var wt = _getWeeklyTotalMins();
        return 'Keep your total screen time under 14 hours for the week. You\'re at ' + fmtM(wt) + ' so far (limit: 14h).';
      }
      case 'noEntertain3': {
        var em = _getEntertainMinsToday();
        return 'Skip entertainment apps (YouTube, Netflix, etc.) for 3 days this week. Today you\'ve used ' + (em > 0 ? fmtM(em) : 'none — great start!') + '.';
      }
      case 'focusQuality': {
        var fq   = _getFocusStats();
        var comp = fq.completed || 0;
        var intr = fq.interrupted || 0;
        var tot  = comp + intr;
        var pct  = tot > 0 ? Math.round(comp / tot * 100) : 0;
        return 'Complete at least 80% of the focus sessions you start this week. Current rate: ' + pct + '% (' + comp + '/' + tot + ' finished).';
      }
      case 'scoreImprove': {
        var cur = _getCurrentAureloScore();
        return cur > 0
          ? 'Raise your Aurelo Score by 10 points this week. You\'re currently at ' + Math.round(cur) + ' — small daily wins add up fast.'
          : 'Improve your Aurelo Score by 10 points this week. Hit your goal, use focus sessions, and keep a good bedtime.';
      }
      case 'breakfastFree': {
        var bf = _getHourMins(7, 9);
        return 'No phone during breakfast (7–9am) for 5 days. Today: ' + (bf === 0 ? 'phone-free ✓' : fmtM(bf) + ' used') + '.';
      }
      case 'zeroEvening7': {
        var ev = _getLateNightMins();
        return 'Zero screen time after 9pm every single day this week — 7 days. Tonight so far: ' + (ev === 0 ? '0 mins ✓' : fmtM(ev) + ' — put it down!') + '.';
      }
      case 'mindfulSocial': {
        var ia = _getIntentionAppsCount();
        var sa = _getSocialAppCount();
        return sa > 0
          ? 'Add a mindful pause to all ' + sa + ' of your social apps. ' + ia + ' pause' + (ia !== 1 ? 's' : '') + ' already configured.'
          : 'Add a mindful pause to your social media apps — a 5-second pause before opening them reduces mindless sessions dramatically.';
      }
      case 'appHide': {
        var ha = _getHiddenAppsCount();
        return ha > 0
          ? 'You\'ve already hidden ' + ha + ' app' + (ha !== 1 ? 's' : '') + '. Hide one more of your most distracting apps.'
          : 'Hide your most distracting app from Aurelo\'s tracking list. Out of sight, out of mind — removing it from stats reduces temptation.';
      }
      case 'noMicroSessions': {
        var du = (DAILY_USE || []).filter(function (a) { return (a.sessions || 0) > 0 && (a.avgSessionMins || 5) < 2; }).length;
        return 'Fewer than 15 sub-2-minute phone sessions per day, for 4 days. These micro-pickups are the core of the dopamine loop — breaking the pattern here changes everything.';
      }

      default: return c.desc;
    }
  }

  /* ── Auto-check ──────────────────────────────────────────────── */
  function _autoCheckChallenge(c) {
    var g = S.streakGoalMins || 240;

    switch (c.checkFn) {
      /* ── Original ── */
      case 'goal':      return WEEKLY.filter(function (d) { return d.minutes > 0 && d.minutes <= g; }).length;
      case 'pickups80': return PICKUPS < 80 ? 1 : 0;
      case 'pickups60': return PICKUPS < 60 ? 1 : 0;
      case 'pickups50': return PICKUPS < 50 ? 1 : 0;
      case 'evening':   return _getLateNightMins() <= 5 ? 1 : 0;
      case 'latenight': return _getHourMins(22, 24) === 0 ? 1 : 0;
      case 'morning':   return 0; // manual only
      case 'lunch':     return _getHourMins(12, 13) === 0 ? 1 : 0;

      /* ── Focus Sessions ── */
      case 'focusSessions':  { var fs = _getFocusStats(); return fs.completed || 0; }
      case 'focusDeep45':    return 0; // manual — bridge has no per-session difficulty+duration history
      case 'focusDaily':     return _getFocusWeekDays().filter(Boolean).length;
      case 'focusTotalMins': { var fs2 = _getFocusStats(); return fs2.totalMins || 0; }

      /* ── Mindful Pause ── */
      case 'mindfulResist':     return _getMindfulStats().resists;
      case 'mindfulResistRate': {
        var ms = _getMindfulStats();
        return (ms.pauses > 0 && ms.resists / ms.pauses >= 0.5) ? 1 : 0;
      }

      /* ── Social Media ── */
      case 'socialUnder30':    return _getSocialMinsToday() < 30 ? 1 : 0;
      case 'socialFreeMorning':return _socialBeforeNoonToday() ? 0 : 1;
      case 'socialCut40':      return 0; // manual — needs cross-week comparison
      case 'noSocial3Days':    return _getSocialMinsToday() === 0 ? 1 : 0;

      /* ── Bedtime ── */
      case 'bedtimeStreak': return _getBedtimeStreak();
      case 'noSnooze':      return _getBedtimeSnoozeCount() === 0 ? 1 : 0;

      /* ── Weekend ── */
      case 'weekendGoal':     return _getWeekendDays().filter(function (d) { return d.minutes > 0 && d.minutes <= g; }).length;
      case 'sundayDetox':     { var sun = _getWeekendDays().find(function (d) { return new Date(d.date).getDay() === 0; }); return (sun && sun.minutes > 0 && sun.minutes < 30) ? 1 : 0; }
      case 'weekendPickups40':return PICKUPS < 40 ? 1 : 0;

      /* ── Wow Moments ── */
      case 'personalBest': {
        var todayMins = WEEKLY.length ? WEEKLY[WEEKLY.length - 1].minutes : 0;
        return (todayMins > 0 && todayMins < _getPersonalBestMins()) ? 1 : 0;
      }
      case 'pickupDrop25':  return 0; // manual — needs multi-week average
      case 'digitalSunset': return _getHourMins(20, 24) === 0 ? 1 : 0;
      case 'phoneFreeMeal': return (_getHourMins(7, 9) === 0 && _getHourMins(12, 13) === 0 && _getHourMins(18, 20) === 0) ? 1 : 0;

      /* ── Combo ── */
      case 'focusAndGoal': {
        var fs3   = _getFocusStats();
        var gdays = WEEKLY.filter(function (d) {
          var monday = new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1));
          return new Date(d.date) >= monday && d.minutes > 0 && d.minutes <= g;
        }).length;
        return Math.min(gdays, fs3.completed || 0);
      }
      case 'timerSet': return _getAppTimerCount() > 0 ? 1 : 0;

      /* ── Round 3 ── */
      case 'under2h':        return WEEKLY.filter(function (d) { return d.minutes > 0 && d.minutes <= 120; }).length;
      case 'under3h':        return WEEKLY.filter(function (d) { return d.minutes > 0 && d.minutes <= 180; }).length;
      case 'weeklyUnder14h': return _getWeeklyTotalMins() < 840 ? 1 : 0;
      case 'noEntertain3':   return _getEntertainMinsToday() === 0 ? 1 : 0;
      case 'focusQuality': {
        var fq   = _getFocusStats();
        var comp = fq.completed || 0;
        var tot2 = comp + (fq.interrupted || 0);
        return (tot2 >= 2 && comp / tot2 >= 0.8) ? 1 : 0;
      }
      case 'scoreImprove':   return 0; // manual — needs week-start score snapshot
      case 'breakfastFree':  return _getHourMins(7, 9) === 0 ? 1 : 0;
      case 'zeroEvening7':   return _getLateNightMins() === 0 ? 1 : 0;
      case 'mindfulSocial':  return (_getIntentionAppsCount() > 0 && _getIntentionAppsCount() >= _getSocialAppCount()) ? 1 : 0;
      case 'appHide':        return _getHiddenAppsCount() > 0 ? 1 : 0;
      case 'noMicroSessions':return 0; // manual — bridge doesn't expose sub-2-min session counts

      default: return 0;
    }
  }

  /* ── Manual check progress ───────────────────────────────────── */
  function checkProgress(id) {
    var c = CHALLENGE_POOL.find(function (x) { return x.id === id; });
    if (!c) return;
    var cur  = _getChallengeProgress(id);
    var auto = _autoCheckChallenge(c);
    var manualOnly = [
      'morning','topapp20','topapp30','beatweek','ghost','lunch','latenight',
      'focusDeep45','socialCut40','pickupDrop25','noSnooze',
      'scoreImprove','noMicroSessions',
    ];
    var newDone = manualOnly.indexOf(c.checkFn) !== -1
      ? Math.min(cur.done + 1, c.target)
      : (c.unit === 'days' || c.unit === 'nights') && auto > 0 ? cur.done + 1 : Math.max(cur.done, auto);
    _saveChallengeProgress(id, newDone);
    if (newDone >= c.target) toast('🏆 Challenge complete! Streak extended.', 'success', 3000);
    else toast('Progress: ' + newDone + '/' + c.target + ' — keep going!', 'info', 2000);
    if (newDone >= c.target && IS_NATIVE && typeof N.checkAndTriggerRateApp === 'function') {
      try { N.checkAndTriggerRateApp('challenge_complete'); } catch (_) {}
    }
    if (typeof FocusHome !== 'undefined') FocusHome._refreshStrips();
    var old = document.getElementById('challenge-card');
    if (old) {
      var tmp = document.createElement('div');
      tmp.innerHTML = _buildChallengeSection();
      var newCard = tmp.querySelector('#challenge-card');
      if (newCard) old.replaceWith(newCard);
    }
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

    var dots = (challenge.unit === 'days' || challenge.unit === 'nights')
      ? Array.from({length: Math.min(total, 14)}, function (_, i) {
          var cls = i < done ? 'done' : i === done ? 'today' : '';
          var bg  = cls === 'done' ? 'var(--g)' : cls === 'today' ? 'linear-gradient(90deg,var(--g),var(--p))' : 'var(--s3)';
          return '<div style="height:6px;flex:1;border-radius:3px;background:' + bg + (cls === 'today' ? ';box-shadow:0 0 8px rgba(61,214,140,.4)' : '') + '"></div>';
        }).join('')
      : '';

    var progressLabel = (challenge.unit === 'days' || challenge.unit === 'nights')
      ? done + '/' + total + ' ' + challenge.unit + ' done'
      : (challenge.unit === 'sessions' || challenge.unit === 'resists')
        ? done + '/' + total + ' ' + challenge.unit
        : challenge.unit === 'mins'
          ? fmtM(done) + ' / ' + fmtM(total) + ' done'
          : isComplete ? 'Complete ✓' : 'In progress';

    var streakData = _getChallengeStreak();
    var streakTip  = streakData.streak > 0
      ? '🔥 ' + streakData.streak + '-week streak — complete to keep it going'
      : '🏆 Complete to start your streak — tracked on your device';

    return '<div style="padding:18px 20px 10px;display:flex;align-items:baseline;justify-content:space-between">' +
        '<div>' +
          '<div style="font-family:var(--ff-d);font-size:16px;font-weight:700">This Week\'s Challenge</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px;letter-spacing:.5px">BASED ON YOUR PATTERNS · LOCAL ONLY</div>' +
        '</div>' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Day ' + Math.min(done+1,total) + ' of ' + total + '</div>' +
      '</div>' +
      '<div style="margin:0 20px;border-radius:20px;background:linear-gradient(135deg,rgba(124,111,255,.1),rgba(61,214,140,.06));border:1px solid rgba(124,111,255,.22);padding:16px;position:relative;overflow:hidden" id="challenge-card">' +
        '<div style="position:absolute;top:-20px;right:-20px;width:100px;height:100px;border-radius:50%;background:rgba(124,111,255,.05);pointer-events:none"></div>' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p2);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">' +
          '<div style="width:6px;height:6px;border-radius:50%;background:var(--p);box-shadow:0 0 6px var(--p);flex-shrink:0"></div>' +
          'Week of ' + _weekNumber() + ' · Personalised for you' +
        '</div>' +
        '<div style="font-size:16px;font-weight:700;margin-bottom:5px;color:var(--t1)">' + challenge.title + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);line-height:1.6;margin-bottom:14px">' + context + '</div>' +
        (dots ? '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="display:flex;gap:5px;flex:1">' + dots + '</div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);white-space:nowrap">' + progressLabel + '</div></div>'
              : '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);margin-bottom:14px">' + progressLabel + '</div>') +
        '<div style="display:flex;gap:8px">' +
          '<button type="button" onclick="FocusChallenge.checkProgress(\'' + challenge.id + '\')" style="flex:1;padding:11px;border-radius:12px;border:none;background:linear-gradient(135deg,var(--p),var(--c));color:#fff;font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer">' +
            (isComplete ? '🏆 Completed!' : 'Check Progress →') +
          '</button>' +
          '<button type="button" onclick="FocusChallenge.skipChallenge()" style="padding:11px 14px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--t3);font-family:var(--ff-m);font-size:var(--text-2xs);cursor:pointer">Skip</button>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:7px;padding:9px 10px;background:rgba(247,184,35,.07);border:1px solid rgba(247,184,35,.18);border-radius:10px;margin-top:10px">' +
          '<span style="font-size:14px">🏆</span>' +
          '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--a)">' + streakTip + '</span>' +
        '</div>' +
      '</div>';
  }

  function _buildChallengeSkippedSection() {
    return '<div style="padding:18px 20px 10px">' +
        '<div style="font-family:var(--ff-d);font-size:16px;font-weight:700">This Week\'s Challenge</div>' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px;letter-spacing:.5px">BASED ON YOUR PATTERNS · LOCAL ONLY</div>' +
      '</div>' +
      '<div style="margin:0 20px;border-radius:20px;background:var(--s1);border:1px solid var(--border);padding:20px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px">' +
        '<div style="font-size:28px;opacity:.5">📅</div>' +
        '<div style="font-size:14px;font-weight:600;color:var(--t1)">Your next challenge starts ' + _getNextMondayDateStr() + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);line-height:1.6;max-width:260px">You\'ve skipped this week\'s challenge. A new personalised challenge will be ready for you on Monday.</div>' +
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
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px;letter-spacing:.5px">BASED ON YOUR PATTERNS · LOCAL ONLY</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin:0 20px;position:relative;border-radius:20px;overflow:hidden;cursor:pointer"' +
          ' class="challenge-locked" onclick="ProTier.triggerUpsell(\'WEEKLY_CHALLENGE\')">' +
          '<div style="filter:blur(5px);pointer-events:none;background:linear-gradient(135deg,rgba(124,111,255,.1),rgba(61,214,140,.06));border:1px solid rgba(124,111,255,.22);border-radius:20px;padding:16px">' +
            '<div style="font-size:16px;font-weight:700;margin-bottom:5px;color:var(--t1)">🎯 Under goal 3 days</div>' +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);line-height:1.6;margin-bottom:14px">Hit your daily goal 3 times this week — 1 done so far.</div>' +
            '<div style="display:flex;gap:5px;flex:1;margin-bottom:14px">' +
              Array.from({length:7}, function (_, i) {
                return '<div style="height:6px;flex:1;border-radius:3px;background:' + (i < 1 ? 'var(--g)' : 'var(--s3)') + '"></div>';
              }).join('') +
            '</div>' +
            '<button style="width:100%;padding:11px;border-radius:12px;border:none;background:linear-gradient(135deg,var(--p),var(--c));color:#fff;font-family:var(--ff-m);font-size:12px;font-weight:700">Check Progress →</button>' +
          '</div>' +
          '<div class="pro-lock-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(0,0,0,.18)">' +
            (typeof proBadge === 'function' ? proBadge() : '') +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2)">Unlock weekly challenges</div>' +
          '</div>' +
        '</div>';
      return;
    }

    el.innerHTML = _buildChallengeSection();

    var c = _pickChallenge();
    if (c) {
      var auto = _autoCheckChallenge(c);
      if (auto > 0) _saveChallengeProgress(c.id, auto);
    }
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    render,
    pickChallenge:        _pickChallenge,
    getChallengeProgress: _getChallengeProgress,
    getChallengeStreak:   _getChallengeStreak,
    weekNumber:           _weekNumber,
    checkProgress,
    skipChallenge,
  };
})();

/* ── Global shims ─────────────────────────────────────────────── */
function _checkChallengeProgress(id) { FocusChallenge.checkProgress(id); }
function _skipChallenge() { FocusChallenge.skipChallenge(); }
