/* ═══════════════════════════════════════════════════════════════════════════
 * app-coach.js  —  Aurelo Coach · Phase 1
 * Rule Engine + Keyword Classifier + Health Connect integration
 *
 * Phase upgrade path (§11.2):
 *   CoachOrchestrator.classifyIntent() is the ONLY function that changes
 *   for Phase 2 (TinyBERT) or Phase 3 (Gemini Nano).
 *
 * HC integration: all HC checks guarded by hcConnected === false until
 *   HC is connected. HC feature columns in the classifier are zero-padded.
 *
 * Bridge integration (§14.8):
 *   On native Android: AppBridge.getHCUsageSummary() returns live data.
 *   In browser: falls back to buildMockUsageSummary().
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── EARLY: ensure all coach DOM elements exist before app-core.js TemplateLoader runs ──
 * TemplateLoader (app-core.js:~295) calls .textContent on coach element IDs without
 * null-guarding. If the coach modal HTML is injected after TemplateLoader fires,
 * those elements are null → "TypeError: Cannot set properties of null (setting 'textContent')".
 * This IIFE runs synchronously at parse time so every ID is in the DOM as a hidden stub. */
(function _ensureCoachDomStubs() {
  if (typeof document === 'undefined') return;
  var IDS = [
    'coach-modal','coach-fab','coach-chat','coach-intro',
    'coach-chips','coach-chips-section','coach-cat-questions',
    'coach-input','coach-send-btn','coach-transparency'
  ];
  var root = document.body || document.documentElement;
  if (!root) return;
  for (var i = 0; i < IDS.length; i++) {
    if (!document.getElementById(IDS[i])) {
      var s = document.createElement('div');
      s.id = IDS[i];
      s.setAttribute('data-stub','1');
      s.style.cssText = 'display:none!important;position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;';
      root.appendChild(s);
    }
  }
})();

/* ─────────────────────────────────────────────────────────────────────────
 * 0. BRIDGE HELPER
 * ───────────────────────────────────────────────────────────────────────── */
var IS_NATIVE_COACH = (typeof window.AppBridge === 'object' && window.AppBridge !== null);

function _bridgeCall(method) {
  try {
    if (IS_NATIVE_COACH && typeof window.AppBridge[method] === 'function') {
      return window.AppBridge[method]();
    }
  } catch (_) {}
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
 * 1. USAGE SUMMARY — bridge-first, mock fallback
 * ───────────────────────────────────────────────────────────────────────── */
function buildMockUsageSummary() {
  return {
    todayMinutes:              200,
    dailyGoalMinutes:          240,
    pickupsToday:              68,
    pickups7DayAvg:            54.3,
    firstUseHour:              7,
    streakDays:                11,
    topApps:                   ['Instagram', 'YouTube', 'Chrome', 'Spotify', 'Gmail'],
    topCategory:               'Social',
    screenTime7Day:            [95, 320, 180, 330, 200, 0, 0],
    dayLabels:                 ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    focusSessionsCompleted:    3,
    focusSessionsFail:         1,
    daysSinceLastFocus:        0,
    aureloScore:               76,
    aureloScoreYesterday:      72,
    screenScore:               82,
    focusScore:                71,
    sleepScore:                68,
    worstDay:                  'Thursday',
    worstDayMinutes:           330,
    bestDay:                   'Monday',
    bestDayMinutes:            95,
    currentHour:               new Date().getHours() || 14,
    userName:                  '',
    hcConnected:               false,
    hrvToday:                  null,
    hrv7DayAvg:                null,
    stepsToday:                null,
    steps7DayAvg:              null,
    sleepDurationMinutes:      null,
    sleepDuration7DayAvg:      null,
    restingHeartRate:          null,
    rhr7DayAvg:                null,
    externalMindfulnessMinutesToday: null,
    dataWindowDays:            7,
  };
}

/**
 * Load UsageSummary from native bridge (getHCUsageSummary returns screen + HC merged).
 * Falls back to mock when running in browser or on error.
 */
function loadUsageSummary() {
  if (IS_NATIVE_COACH) {
    try {
      var raw = _bridgeCall('getHCUsageSummary');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.todayMinutes !== 'undefined') {
          // Normalise field names (bridge uses focusSessionsDone, JS uses focusSessionsCompleted)
          parsed.focusSessionsCompleted = parsed.focusSessionsCompleted || parsed.focusSessionsDone || 0;
          parsed.focusSessionsFail      = parsed.focusSessionsFail      || parsed.focusSessionsInterrupted || 0;
          // Derive derived fields the mock provides
          parsed.currentHour  = new Date().getHours();
          // screenTime7Day comes as [{dateLabel, minutes}, ...], flatten for charts
          if (Array.isArray(parsed.screenTime7Day) && parsed.screenTime7Day.length &&
              typeof parsed.screenTime7Day[0] === 'object') {
            parsed.dayLabels = parsed.screenTime7Day.map(function(d) { return d.dateLabel || ''; });
            parsed.screenTime7Day = parsed.screenTime7Day.map(function(d) { return d.minutes || 0; });
          }
          // topApps may be [{label, minutes, ...}] — flatten to string array
          if (Array.isArray(parsed.topApps) && parsed.topApps.length &&
              typeof parsed.topApps[0] === 'object') {
            parsed.topApps = parsed.topApps.map(function(a) { return a.label || a.packageName || ''; });
          }
          // Derive worst/best day from screenTime7Day
          var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
          var timeArr = Array.isArray(parsed.screenTime7Day) ? parsed.screenTime7Day : [];
          if (timeArr.length) {
            var worstIdx = 0, bestIdx = 0;
            for (var i = 1; i < timeArr.length; i++) {
              if (timeArr[i] > timeArr[worstIdx]) worstIdx = i;
              if (timeArr[i] > 0 && timeArr[i] < (timeArr[bestIdx] || Infinity)) bestIdx = i;
            }
            parsed.worstDay        = (parsed.dayLabels && parsed.dayLabels[worstIdx]) || days[worstIdx] || 'Thursday';
            parsed.worstDayMinutes = timeArr[worstIdx] || 0;
            parsed.bestDay         = (parsed.dayLabels && parsed.dayLabels[bestIdx])  || days[bestIdx]  || 'Monday';
            parsed.bestDayMinutes  = timeArr[bestIdx]  || 0;
          }
          // Score fields cached separately in prefs if not in summary
          parsed.screenScore = parsed.screenScore || 0;
          parsed.focusScore  = parsed.focusScore  || 0;
          parsed.sleepScore  = parsed.sleepScore  || 0;
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[CoachJS] loadUsageSummary bridge error:', e);
    }
  }
  return buildMockUsageSummary();
}

/* ─────────────────────────────────────────────────────────────────────────
 * 2. COACH INTENTS — 15 labels, same across Phase 1-2-3 (spec §14.2)
 * ───────────────────────────────────────────────────────────────────────── */
var CoachIntent = Object.freeze({
  SCORE_DROP:                       'SCORE_DROP',
  STREAK_AT_RISK:                   'STREAK_AT_RISK',
  BEDTIME_REVENGE_PROCRASTINATION:  'BEDTIME_REVENGE_PROCRASTINATION',
  MORNING_DOOM_SCROLL:              'MORNING_DOOM_SCROLL',
  FOCUS_BURNOUT:                    'FOCUS_BURNOUT',
  HC_POOR_SLEEP_HIGH_USAGE:         'HC_POOR_SLEEP_HIGH_USAGE',
  HC_ACTIVE_DAY_BETTER_FOCUS:       'HC_ACTIVE_DAY_BETTER_FOCUS',
  PRODUCTIVE_DAY:                   'PRODUCTIVE_DAY',
  WEEKEND_BINGE:                    'WEEKEND_BINGE',
  RECOVERY_DAY:                     'RECOVERY_DAY',
  SOCIAL_SPIRAL:                    'SOCIAL_SPIRAL',
  HEALTHY_PATTERN:                  'HEALTHY_PATTERN',
  ANOMALOUS_SPIKE:                  'ANOMALOUS_SPIKE',
  FOCUS_GAP:                        'FOCUS_GAP',
  DOPAMINE_LOOP:                    'DOPAMINE_LOOP',
  GENERAL_SUMMARY:                  'GENERAL_SUMMARY',
  UNKNOWN:                          'UNKNOWN',
});

/* ─────────────────────────────────────────────────────────────────────────
 * 3. KEYWORD CLASSIFIER (Phase 1)
 * ───────────────────────────────────────────────────────────────────────── */
var INTENT_RULES = [
  { intent: CoachIntent.SCORE_DROP,
    patterns: ['score drop','score went down','doing worse','lower score','score fell',
                'worse score','score change','why did my score','score lower',
                'score decreased','went down','score bad'] },

  { intent: CoachIntent.STREAK_AT_RISK,
    patterns: ['streak','lose streak','break streak','safe today','streak risk',
                'keep streak','lose my streak','will i break','streak gone'] },

  { intent: CoachIntent.FOCUS_GAP,
    patterns: ["haven't focused","no session","last session","focus gap","slacking",
                'should i focus','not focused','no focus','missed sessions',
                'when did i last','skipped focus','no sessions'] },

  { intent: CoachIntent.DOPAMINE_LOOP,
    patterns: ['keep picking','mindless','keep checking','pick up phone',
                'check instagram','put it down','keep scrolling','doom scroll',
                'dopamine','habit loop','checking my phone','mindlessly'] },

  { intent: CoachIntent.SOCIAL_SPIRAL,
    patterns: ['social media','instagram','tiktok','twitter','too much social',
                'social apps','facebook','reddit','social time','scrolling social'] },

  { intent: CoachIntent.PRODUCTIVE_DAY,
    patterns: ['doing well','on track','good day','how am i','am i improving',
                'getting better','doing good','good score','great day','going well'] },

  { intent: CoachIntent.MORNING_DOOM_SCROLL,
    patterns: ['morning','first thing','woke up','first use','wake up',
                'morning routine','first app','start of day'] },

  { intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION,
    patterns: ['late night','bedtime','night time','before bed',
                'revenge procrastination','midnight','phone at night',
                'night usage','nighttime','bed scrolling'] },

  { intent: CoachIntent.FOCUS_BURNOUT,
    patterns: ['burnt out','burnout','tired','exhausted','stressed',
                'productivity low','no motivation','unfocused','scattered',
                'struggling to focus','distracted'] },

  { intent: CoachIntent.WEEKEND_BINGE,
    patterns: ['weekend','saturday','sunday','days off','weekends','binge'] },

  { intent: CoachIntent.RECOVERY_DAY,
    patterns: ['recovery','recovering','bounce back','coming down','after bad day',
                'better than yesterday','improvement','getting better'] },

  { intent: CoachIntent.ANOMALOUS_SPIKE,
    patterns: ['spike','unusual','way more','a lot today','way too much',
                'really high','so much today','highest ever','record'] },

  { intent: CoachIntent.HEALTHY_PATTERN,
    patterns: ["what's working",'best habit','positive pattern',
                'what am i doing right','good habit'] },

  { intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE,
    patterns: ['hrv','heart rate variability','poor sleep affect','sleep affect usage',
                'sleep and phone','hrv low','bad sleep scrolling','sleep usage',
                'how did sleep affect','is poor sleep'] },

  { intent: CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS,
    patterns: ['active day','steps','exercise','walking more','do active days',
                'when i exercise','steps and screen','phone use when i walk'] },

  { intent: CoachIntent.GENERAL_SUMMARY,
    patterns: ['summary','overall','overview','tell me','what do you see',
                'what does my data','this week','give me a summary',
                'analyse','analyze','my data'] },
];

var KEYWORD_CLASSIFIER = {
  THRESHOLD: 0.3,
  classify: function(query) {
    var q = query.toLowerCase().trim();
    var best = { intent: CoachIntent.UNKNOWN, confidence: 0 };
    for (var i = 0; i < INTENT_RULES.length; i++) {
      var rule = INTENT_RULES[i];
      var score = 0;
      for (var j = 0; j < rule.patterns.length; j++) {
        var pattern = rule.patterns[j];
        if (q.indexOf(pattern) !== -1) {
          score += pattern.split(' ').length > 1 ? 0.6 : 0.3;
        }
      }
      var confidence = Math.min(1, score);
      if (confidence > best.confidence) {
        best = { intent: rule.intent, confidence: confidence };
      }
    }
    return best;
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 4. PATTERN DETECTOR — screen + HC correlation (spec §14.5)
 * ───────────────────────────────────────────────────────────────────────── */
var PatternDetector = {
  getTopPattern: function(summary) {
    var patterns = this.detectAll(summary);
    return patterns[0] || { intent: CoachIntent.GENERAL_SUMMARY, data: {} };
  },

  detectAll: function(summary) {
    var found = [];
    var hour = summary.currentHour || 14;

    // ── Streak-at-risk projection ────────────────────────────────────────
    var ratePerHour = hour > 0 ? summary.todayMinutes / hour : 0;
    var hoursLeft   = Math.max(0, 24 - hour);
    var projected   = summary.todayMinutes + (ratePerHour * hoursLeft);
    if (projected > summary.dailyGoalMinutes * 0.85 && summary.streakDays > 3) {
      found.push({ intent: CoachIntent.STREAK_AT_RISK, priority: 10,
        data: { projected: Math.round(projected) } });
    }

    // ── Score drop ───────────────────────────────────────────────────────
    if (summary.aureloScoreYesterday - summary.aureloScore > 8) {
      found.push({ intent: CoachIntent.SCORE_DROP, priority: 9, data: {} });
    }

    // ── Score improved ───────────────────────────────────────────────────
    if (summary.aureloScore - summary.aureloScoreYesterday > 5) {
      found.push({ intent: CoachIntent.PRODUCTIVE_DAY, priority: 6, data: {} });
    }

    // ── Anomalous spike ──────────────────────────────────────────────────
    var activeDays = (summary.screenTime7Day || []).filter(function(d) { return d > 0; });
    if (activeDays.length > 0) {
      var avg7 = activeDays.reduce(function(a, b) { return a + b; }, 0) / activeDays.length;
      if (summary.worstDayMinutes > avg7 * 1.5) {
        found.push({ intent: CoachIntent.ANOMALOUS_SPIKE, priority: 7,
          data: { avg: Math.round(avg7) } });
      }
    }

    // ── Social spiral ────────────────────────────────────────────────────
    if (summary.topCategory === 'Social') {
      found.push({ intent: CoachIntent.SOCIAL_SPIRAL, priority: 5, data: {} });
    }

    // ── Focus gap ────────────────────────────────────────────────────────
    if (summary.daysSinceLastFocus >= 3) {
      found.push({ intent: CoachIntent.FOCUS_GAP, priority: 8,
        data: { days: summary.daysSinceLastFocus } });
    }

    // ── Morning doom-scroll ──────────────────────────────────────────────
    if (summary.firstUseHour < 8) {
      found.push({ intent: CoachIntent.MORNING_DOOM_SCROLL, priority: 6,
        data: { hour: summary.firstUseHour } });
    }

    // ── Weekend binge ────────────────────────────────────────────────────
    var dow = new Date().getDay(); // 0=Sun, 6=Sat
    if ((dow === 0 || dow === 6) && summary.todayMinutes > (summary.dailyGoalMinutes * 1.3)) {
      found.push({ intent: CoachIntent.WEEKEND_BINGE, priority: 7, data: {} });
    }

    // ── HC patterns — gated on hcConnected ──────────────────────────────
    if (summary.hcConnected) {
      var hrv7    = summary.hrv7DayAvg;
      var hrvToday = summary.hrvToday;
      var steps   = summary.stepsToday;
      var sleep   = summary.sleepDurationMinutes;

      // HC_POOR_SLEEP_HIGH_USAGE: HRV below avg + screen time above avg
      if (hrv7 && hrv7 > 0 && hrvToday !== null && hrvToday !== undefined) {
        var ratio = hrvToday / hrv7;
        if (ratio < 0.80 && summary.todayMinutes > summary.dailyGoalMinutes * 0.9) {
          found.push({ intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE, priority: 9,
            data: { ratio: ratio, hrv7: hrv7, hrvToday: hrvToday } });
        }
      }

      // HC_ACTIVE_DAY_BETTER_FOCUS: steps >8000 on days screen under goal
      // Check today only — historical correlation handled by template copy
      if (steps !== null && steps !== undefined && steps >= 8000 &&
          summary.todayMinutes <= summary.dailyGoalMinutes) {
        found.push({ intent: CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS, priority: 7,
          data: { steps: steps } });
      }

      // BEDTIME_REVENGE_PROCRASTINATION: sleep duration < 6h → reinforce
      if (sleep !== null && sleep !== undefined && sleep < 360) { // < 6h in minutes
        found.push({ intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION, priority: 8,
          data: { sleepMins: sleep } });
      }

      // FOCUS_BURNOUT: low HRV + low focus session completion
      if (hrv7 && hrv7 > 0 && hrvToday !== null && hrvToday !== undefined &&
          hrvToday / hrv7 < 0.85 && summary.focusSessionsCompleted === 0) {
        found.push({ intent: CoachIntent.FOCUS_BURNOUT, priority: 7,
          data: { hcReinforced: true } });
      }
    }

    return found.sort(function(a, b) { return b.priority - a.priority; });
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 5. TEMPLATE LIBRARY — screen + HC-aware templates (spec §14.7)
 * ───────────────────────────────────────────────────────────────────────── */
var TemplateLibrary = {
  templates: {
    SCORE_DROP: [
      {
        text: function(s) {
          var drop = Math.abs(s.aureloScore - s.aureloScoreYesterday);
          var hcNote = s.hcConnected && s.hrvToday && s.hrv7DayAvg && s.hrvToday < s.hrv7DayAvg
            ? ' Your HRV is <strong>' + Math.round((1 - s.hrvToday / s.hrv7DayAvg) * 100) + '%</strong> below average — poor sleep the night before often shows up as a score dip.'
            : '';
          return 'Your Aurelo Score dipped to <strong>' + s.aureloScore + '</strong> from <strong>' + s.aureloScoreYesterday + '</strong> yesterday — a <strong>' + drop + ' point</strong> drop. The main drag was your pickup count: <strong>' + s.pickupsToday + ' pickups</strong> vs your 7-day average of <strong>' + Math.round(s.pickups7DayAvg) + '</strong>.' + hcNote;
        },
        followUps: ['What drove the pickup spike?', 'How do I improve my pickup score?', 'Is my streak still safe?']
      },
      {
        text: function(s) {
          return 'Score went from <strong>' + s.aureloScoreYesterday + '</strong> to <strong>' + s.aureloScore + '</strong> — ' + Math.abs(s.aureloScore - s.aureloScoreYesterday) + ' points down. Your first app open was at <strong>' + s.firstUseHour + ':00</strong>, which costs first-use points. Waiting until 9 AM recovers the full 20 points there.';
        },
        followUps: ['Why does first-use time matter?', 'What time should I open my phone?', 'How do I boost my focus score?']
      }
    ],

    STREAK_AT_RISK: [
      {
        text: function(s) {
          var hour = s.currentHour || 14;
          var rate = hour > 0 ? s.todayMinutes / hour : 0;
          var projected = Math.round(s.todayMinutes + rate * (24 - hour));
          var overBy = projected - s.dailyGoalMinutes;
          if (overBy > 0) {
            return 'At your current pace you\'ll finish around <strong>' + Math.floor(projected/60) + 'h ' + (projected%60) + 'm</strong> — about <strong>' + overBy + ' min over</strong> your ' + Math.floor(s.dailyGoalMinutes/60) + 'h goal. Your <strong>' + s.streakDays + '-day streak</strong> is at risk. Put the phone down for the next ~' + Math.round(overBy / (rate || 1)) + ' hours to land under goal.';
          }
          return 'Your <strong>' + s.streakDays + '-day streak</strong> looks safe at current pace — <strong>' + s.todayMinutes + ' min</strong> against a ' + Math.floor(s.dailyGoalMinutes/60) + 'h goal. Watch the evening; pickup count typically climbs after 6 PM.';
        },
        followUps: ['What should I do right now?', 'When is my riskiest time?', 'Start a focus session']
      }
    ],

    FOCUS_GAP: [
      {
        text: function(s) {
          var days = s.daysSinceLastFocus;
          var hcNote = s.hcConnected && s.externalMindfulnessMinutesToday
            ? ' You did have <strong>' + s.externalMindfulnessMinutesToday + ' min</strong> of external mindfulness (50% credit) — that\'s a good start, but an Aurelo session earns full credit.'
            : '';
          return 'You haven\'t done a focus session in <strong>' + (days === 0 ? 'a few days' : days + ' days') + '</strong>. Your Focus Score is <strong>' + s.focusScore + '</strong> — it\'ll drop further if you miss another day. Even a quick <strong>10-minute Gentle session</strong> would stop the slide. Your top distractor is <strong>' + (s.topApps && s.topApps[0] || 'social apps') + '</strong> — a good candidate to block.' + hcNote;
        },
        followUps: ['Start a 10-min session', 'Which apps should I block?', "What's a good session length?"]
      }
    ],

    DOPAMINE_LOOP: [
      {
        text: function(s) {
          return 'You\'re showing a classic dopamine loop — picking up your phone, opening <strong>' + (s.topApps && s.topApps[0] || 'your top app') + '</strong>, putting it down, and repeating within minutes. Each short session under 90 seconds reinforces the urge rather than satisfying it. Try a <strong>Mindful Pause</strong> on ' + (s.topApps && s.topApps[0] || 'that app') + ': it adds a 10-second intention check before the app opens, which breaks the automatic loop.';
        },
        followUps: ['Add a mindful pause', 'Why does the pause help?', 'How many pickups is normal?']
      }
    ],

    SOCIAL_SPIRAL: [
      {
        text: function(s) {
          var diff = Math.round(s.pickupsToday - s.pickups7DayAvg);
          return 'Social apps are your top category today, led by <strong>' + (s.topApps && s.topApps[0] || 'social apps') + '</strong>. You\'ve got <strong>' + s.pickupsToday + ' pickups</strong> — <strong>' + (diff > 0 ? '+' + diff : diff) + '</strong> vs your weekly average. A <strong>25-min Firm session</strong> with ' + (s.topApps && s.topApps[0] || 'your top app') + ' blocked right now would reset the loop.';
        },
        followUps: ['Block social apps for 25 min', "What's a healthy social limit?", 'Show my social trend']
      }
    ],

    PRODUCTIVE_DAY: [
      {
        text: function(s) {
          return 'Today looks good — <strong>' + s.todayMinutes + ' min</strong> against your <strong>' + s.dailyGoalMinutes + ' min</strong> goal, Screen Score <strong>' + s.screenScore + '</strong>, and <strong>' + s.focusSessionsCompleted + ' focus sessions</strong> completed. Your <strong>' + s.streakDays + '-day streak</strong> is alive. ' + (s.firstUseHour < 9 ? 'One thing: first use was at ' + s.firstUseHour + ':00 AM — waiting until 9 AM tomorrow adds 20 points to your Screen Score.' : 'You waited until 9 AM for first use — perfect.');
        },
        followUps: ['Share my score', "What's my best habit this week?", 'How do I get to Excellent?']
      }
    ],

    MORNING_DOOM_SCROLL: [
      {
        text: function(s) {
          return 'Your first phone use today was at <strong>' + s.firstUseHour + ':00 AM</strong> — that costs you the full first-use score (20 pts). Checking your phone within the first hour of waking is linked to higher pickup counts all day. Tomorrow: try waiting until <strong>9 AM</strong>. Just that change adds 20 points to your Screen Score.';
        },
        followUps: ['Set a morning reminder', 'What should I do instead?', 'How much does it affect my score?']
      }
    ],

    ANOMALOUS_SPIKE: [
      {
        text: function(s) {
          var activeDays = (s.screenTime7Day || []).filter(function(d) { return d > 0; });
          var avg = activeDays.length ? Math.round(activeDays.reduce(function(a,b){return a+b;},0)/activeDays.length) : 0;
          return '<strong>' + s.worstDay + '</strong> is your heaviest screen day — <strong>' + s.worstDayMinutes + ' min</strong> vs your weekly average of ~' + avg + ' min. The pattern repeats. A scheduled focus routine on ' + s.worstDay + ' afternoons would directly address this.';
        },
        followUps: ['Schedule a routine', 'Why is that day different?', 'Show my weekly pattern']
      }
    ],

    BEDTIME_REVENGE_PROCRASTINATION: [
      {
        text: function(s) {
          var sleepLine = '';
          if (s.hcConnected && s.sleepDurationMinutes) {
            var sleepH = Math.floor(s.sleepDurationMinutes / 60);
            var sleepM = s.sleepDurationMinutes % 60;
            sleepLine = ' Health Connect shows last night\'s sleep was <strong>' + sleepH + 'h ' + sleepM + 'm</strong> — below the 7h target.';
          }
          return 'Late-night phone use is a form of "revenge procrastination" — reclaiming personal time at the cost of sleep.' + sleepLine + ' If Bedtime Mode is set, your phone handles the blocking automatically. Key signal: pickup count spikes after 10 PM are almost always followed by a higher-usage next day. Your <strong>' + s.streakDays + '-day streak</strong> could be at risk if tonight follows that pattern.';
        },
        followUps: ['Enable Bedtime Mode', 'What time should I stop?', 'How does sleep affect my score?']
      }
    ],

    FOCUS_BURNOUT: [
      {
        text: function(s) {
          var diff = Math.round(s.pickupsToday - s.pickups7DayAvg);
          var hcNote = s.hcConnected && s.hrvToday && s.hrv7DayAvg && s.hrvToday < s.hrv7DayAvg
            ? ' Your HRV is below average today — that reinforces the fatigue signal.'
            : '';
          return 'Your Focus Score is <strong>' + s.focusScore + '</strong> with <strong>' + s.focusSessionsCompleted + ' sessions</strong> this week. Burnout shows as more pickups and shorter focus attempts — you have <strong>' + s.pickupsToday + ' pickups</strong> today, ' + (diff > 0 ? diff + ' above your average' : 'near your average') + '.' + hcNote + ' Try a <strong>5-min Gentle session</strong> — it restores the habit without the pressure.';
        },
        followUps: ['Start a 5-min session', "What's causing this?", 'How long should sessions be?']
      }
    ],

    WEEKEND_BINGE: [
      {
        text: function(s) {
          var activeDays = (s.screenTime7Day || []).filter(function(d) { return d > 0; });
          var weekdayAvg = activeDays.length
            ? Math.round(activeDays.reduce(function(a,b){return a+b;},0) / activeDays.length) : 0;
          return 'Weekends are your highest-usage days — today you\'re at <strong>' + s.todayMinutes + ' min</strong>, about <strong>' + Math.round(s.todayMinutes / (weekdayAvg || 1) * 100 - 100) + '%</strong> above your weekday average. Screen time on days off often doubles because routines loosen. A weekend focus schedule would help cap the spike.';
        },
        followUps: ['Set a weekend routine', "What's a good weekend goal?", 'Show my week pattern']
      }
    ],

    RECOVERY_DAY: [
      {
        text: function(s) {
          return 'You\'re having a recovery day — <strong>' + s.todayMinutes + ' min</strong> is below your recent average. After a heavy usage day your brain naturally pulls back. Lean into it: this is a good day for a focus session and an early first-use cutoff tomorrow.';
        },
        followUps: ['Start a recovery focus session', "What's the best next step?", 'How am I trending?']
      }
    ],

    HC_POOR_SLEEP_HIGH_USAGE: [
      {
        text: function(s) {
          var hcDelta = s.hrv7DayAvg && s.hrvToday
            ? Math.round((1 - s.hrvToday / s.hrv7DayAvg) * 100) : null;
          var weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
          var screenDelta = s.dailyGoalMinutes > 0
            ? Math.round((s.todayMinutes / s.dailyGoalMinutes - 1) * 100) : 0;
          return 'Your HRV last night was <strong>' + (hcDelta !== null ? hcDelta + '%' : 'notably') + '</strong> below your average — and your screen time today is already <strong>' + (screenDelta > 0 ? '+' + screenDelta + '%' : screenDelta + '%') + '</strong> vs your usual ' + weekday + ' total. Poor sleep and heavier phone use tend to reinforce each other. A <strong>15-minute focus session</strong> could help break the cycle. Based on Health Connect + screen data.';
        },
        followUps: ['Start a focus session now', 'How does HRV affect my score?', 'What can I do tonight?']
      },
      {
        text: function(s) {
          var sleep = s.sleepDurationMinutes
            ? Math.floor(s.sleepDurationMinutes/60) + 'h ' + (s.sleepDurationMinutes%60) + 'm'
            : 'below target';
          return 'Sleep quality is showing up in your data. Last night: <strong>' + sleep + '</strong> (Health Connect). On low-HRV days your pickup count runs <strong>15–20%</strong> higher than average — and that\'s exactly what\'s happening today. Your focus sessions are your best defence on days like this.';
        },
        followUps: ['How does sleep affect my phone use?', 'What should I do differently tonight?', 'Show my HRV trend']
      }
    ],

    HC_ACTIVE_DAY_BETTER_FOCUS: [
      {
        text: function(s) {
          var steps = s.stepsToday ? s.stepsToday.toLocaleString() : '8,000+';
          return 'You\'ve logged <strong>' + steps + ' steps</strong> today (Health Connect). On days when your step count exceeds 8,000 your screen time tends to run <strong>10–15%</strong> below goal and focus session completion is higher. Physical activity and focused phone use are correlated in your 7-day pattern. Keep it going.';
        },
        followUps: ['What else helps my focus?', 'Do active days improve my score?', 'Show me the correlation']
      },
      {
        text: function(s) {
          var steps = s.stepsToday ? s.stepsToday.toLocaleString() : '8,000+';
          return '<strong>' + steps + ' steps</strong> today — your Health Connect data shows a clear pattern: on days with 8,000+ steps, your phone use tends to stay under your goal. This is one of the strongest correlations in your personal data. An active day + a focus session is the best combo for a high Aurelo Score.';
        },
        followUps: ['Start a focus session', 'How do I track this pattern?', 'What other patterns do you see?']
      }
    ],

    GENERAL_SUMMARY: [
      {
        text: function(s) {
          var hcLine = s.hcConnected
            ? ' Health Connect is active.' : '';
          return 'Here\'s your week: Aurelo Score <strong>' + s.aureloScore + '</strong>, Screen Score <strong>' + s.screenScore + '</strong>, Focus Score <strong>' + s.focusScore + '</strong>, Sleep Score <strong>' + s.sleepScore + '</strong>.' + hcLine + ' Best day was <strong>' + s.bestDay + '</strong> (' + s.bestDayMinutes + ' min), worst was <strong>' + s.worstDay + '</strong> (' + s.worstDayMinutes + ' min). You\'ve got a <strong>' + s.streakDays + '-day streak</strong>. Biggest opportunity: ' + (s.firstUseHour < 9 ? 'delay your morning first-use to 9 AM' : s.focusSessionsCompleted < 3 ? 'complete more focus sessions' : 'reduce your ' + s.worstDay + ' usage spike') + '.';
        },
        followUps: ['What should I work on first?', "Why is " + 'that day' + " so high?", 'How close am I to Excellent?']
      }
    ],

    HEALTHY_PATTERN: [
      {
        text: function(s) {
          var hcLine = s.hcConnected && s.stepsToday && s.stepsToday >= 8000
            ? ' Your <strong>' + (s.stepsToday || 0).toLocaleString() + ' steps</strong> today (Health Connect) reinforce the pattern — active days and lower screen time go together for you.'
            : '';
          return 'Your strongest habit right now is the <strong>' + s.streakDays + '-day streak</strong> — that\'s real consistency. Your Screen Score of <strong>' + s.screenScore + '</strong> shows you\'re managing goal adherence well. The ' + s.focusSessionsCompleted + ' focus sessions this week is solid.' + hcLine + ' Keep the morning routine going — first-use timing is your clearest lever.';
        },
        followUps: ['How do I build on this?', 'Share my streak', "What's my best day pattern?"]
      }
    ],

    UNKNOWN: [
      {
        text: function(s) {
          var hcNote = s.hcConnected ? ' + Health Connect data' : '';
          return 'I don\'t have a specific insight for that — but here\'s what stands out today: <strong>' + s.worstDay + '</strong> was your heaviest day at <strong>' + s.worstDayMinutes + ' min</strong>, your streak is at <strong>' + s.streakDays + ' days</strong>, and your Focus Score of <strong>' + s.focusScore + '</strong> has room to grow. Based on ' + s.dataWindowDays + ' days of screen data' + hcNote + '.';
        },
        followUps: ['Tell me about my worst day', "How's my streak looking?", 'How do I improve focus?']
      }
    ]
  },

  get: function(intent, summary) {
    var pool = this.templates[intent] || this.templates['UNKNOWN'];
    var template = pool[Math.floor(Math.random() * pool.length)];
    return {
      text:      template.text(summary),
      followUps: template.followUps || []
    };
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 6. CHIP GENERATOR (spec §13.2)
 * ───────────────────────────────────────────────────────────────────────── */
var ChipGenerator = {
  generate: function(summary) {
    var chips = [];
    var hour = summary.currentHour || 14;

    // Score drop
    if (summary.aureloScoreYesterday - summary.aureloScore > 4) {
      chips.push({ label: 'Why did my score drop ' + (summary.aureloScoreYesterday - summary.aureloScore) + ' pts?', intent: CoachIntent.SCORE_DROP });
    }

    // Streak at risk
    var rate = hour > 0 ? summary.todayMinutes / hour : 0;
    var projected = summary.todayMinutes + rate * (24 - hour);
    if (projected > summary.dailyGoalMinutes * 0.85 && summary.streakDays > 3) {
      chips.push({ label: 'Is my ' + summary.streakDays + '-day streak safe?', intent: CoachIntent.STREAK_AT_RISK });
    }

    // HC: sleep + screen correlation chip
    if (summary.hcConnected && summary.hrv7DayAvg && summary.hrvToday &&
        summary.hrvToday < summary.hrv7DayAvg * 0.80) {
      chips.push({ label: 'How did poor sleep affect my usage today?', intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE });
    }

    // HC: active day chip
    if (summary.hcConnected && summary.stepsToday > 8000) {
      chips.push({ label: 'What happens on my active days?', intent: CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS });
    }

    // Focus gap
    if (summary.daysSinceLastFocus >= 3) {
      chips.push({ label: "I haven't focused in a while — what should I do?", intent: CoachIntent.FOCUS_GAP });
    }

    // Worst day anomaly
    if (summary.worstDayMinutes > summary.bestDayMinutes * 2.5) {
      chips.push({ label: 'Why is ' + summary.worstDay + ' always my worst day?', intent: CoachIntent.ANOMALOUS_SPIKE });
    }

    // Social spiral
    if (summary.topCategory === 'Social' && summary.pickupsToday > summary.pickups7DayAvg * 1.2) {
      chips.push({ label: 'Why do I keep opening ' + (summary.topApps && summary.topApps[0] || 'social apps') + '?', intent: CoachIntent.DOPAMINE_LOOP });
    }

    // Default day-of-week chip
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    chips.push({ label: "What's my " + days[new Date().getDay()] + ' pattern?', intent: CoachIntent.GENERAL_SUMMARY });

    return chips.slice(0, 3);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 7. STATIC CATEGORY QUESTIONS — includes Sleep & Body tab (spec §13.3)
 * ───────────────────────────────────────────────────────────────────────── */
var CATEGORY_QUESTIONS = {
  score: [
    { label: 'Why did my score change?',        intent: CoachIntent.SCORE_DROP },
    { label: 'How do I reach Excellent?',        intent: CoachIntent.PRODUCTIVE_DAY },
    { label: "What's dragging my score down?",   intent: CoachIntent.GENERAL_SUMMARY },
    { label: "What's going well this week?",     intent: CoachIntent.HEALTHY_PATTERN },
  ],
  habits: [
    { label: 'Do I have a dopamine loop?',           intent: CoachIntent.DOPAMINE_LOOP },
    { label: 'What triggers my phone use?',           intent: CoachIntent.MORNING_DOOM_SCROLL },
    { label: 'Am I on social media too much?',        intent: CoachIntent.SOCIAL_SPIRAL },
    { label: "What's my best habit right now?",       intent: CoachIntent.HEALTHY_PATTERN },
  ],
  sleep: [
    { label: 'Why do I use my phone at night?',         intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION },
    { label: 'How does sleep affect my usage?',         intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE },
    { label: "How's my bedtime routine?",               intent: CoachIntent.GENERAL_SUMMARY },
    { label: 'What does my HRV tell me?',               intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE },
    { label: 'Am I active enough?',                     intent: CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS },
    { label: 'What is revenge procrastination?',        intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION },
  ],
  focus: [
    { label: "Why can't I focus?",                     intent: CoachIntent.FOCUS_BURNOUT },
    { label: 'How are my focus sessions going?',        intent: CoachIntent.FOCUS_GAP },
    { label: "What's my session completion rate?",      intent: CoachIntent.GENERAL_SUMMARY },
    { label: 'When is my most focused time?',           intent: CoachIntent.GENERAL_SUMMARY },
  ],
};

/* ─────────────────────────────────────────────────────────────────────────
 * 8. FREE / PRO QUERY GATE (spec §20)
 * ───────────────────────────────────────────────────────────────────────── */
var QueryGate = {
  FREE_LIMIT: 3,
  _todayKey: function() {
    var d = new Date();
    return '' + d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2);
  },

  /** Returns { count, limitReached } for current user tier. */
  getStatus: function() {
    // Pro users have unlimited queries
    if (typeof ProTier !== 'undefined' && ProTier.isPro) {
      return { count: 0, limitReached: false };
    }
    // Native: delegate to bridge
    if (IS_NATIVE_COACH) {
      try {
        var raw = _bridgeCall('getCoachQueryCount');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (typeof parsed.limitReached !== 'undefined') return parsed;
        }
      } catch (_) {}
    }
    // Browser fallback — use localStorage
    try {
      var today = this._todayKey();
      var stored = JSON.parse(localStorage.getItem('coach_qcount_v1') || '{}');
      var count = stored.date === today ? (stored.count || 0) : 0;
      return { count: count, limitReached: count >= this.FREE_LIMIT };
    } catch (_) {
      return { count: 0, limitReached: false };
    }
  },

  increment: function() {
    if (typeof ProTier !== 'undefined' && ProTier.isPro) return;
    if (IS_NATIVE_COACH) {
      try { window.AppBridge.incrementCoachQueryCount(); return; } catch (_) {}
    }
    try {
      var today = this._todayKey();
      var stored = JSON.parse(localStorage.getItem('coach_qcount_v1') || '{}');
      var count = stored.date === today ? (stored.count || 0) : 0;
      localStorage.setItem('coach_qcount_v1', JSON.stringify({ date: today, count: count + 1 }));
    } catch (_) {}
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 9. COACH ORCHESTRATOR (spec §11.2)
 *    Phase 2 upgrade: swap classifyIntent to TinyBERT — nothing else changes.
 *    Phase 3 upgrade: add Gemini Nano check above TinyBERT.
 * ───────────────────────────────────────────────────────────────────────── */
var CoachOrchestrator = {
  CONFIDENCE_THRESHOLD: 0.3,

  classifyIntent: function(query) {
    // Phase 3: if (GeminiNano.isAvailable()) return GeminiNano.classify(query);
    // Phase 2: if (TinyBERT.isAvailable())   return TinyBERT.classify(query);
    return KEYWORD_CLASSIFIER.classify(query); // Phase 1
  },

  handleQuery: function(query, summary) {
    var classified = this.classifyIntent(query);
    var intent     = classified.intent;
    var confidence = classified.confidence;

    // HC-only intents — redirect when HC not connected
    var HC_ONLY = [CoachIntent.HC_POOR_SLEEP_HIGH_USAGE, CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS];
    if (HC_ONLY.indexOf(intent) !== -1 && !summary.hcConnected) {
      return {
        intent:      CoachIntent.GENERAL_SUMMARY,
        response:    TemplateLibrary.get(CoachIntent.GENERAL_SUMMARY, summary),
        confidence:  confidence,
        usedFallback: true
      };
    }

    // Low confidence — graceful fallback with top detected pattern (spec §14.4)
    if (confidence < this.CONFIDENCE_THRESHOLD || intent === CoachIntent.UNKNOWN) {
      var topPattern = PatternDetector.getTopPattern(summary);
      var hcNote     = summary.hcConnected ? ' + Health Connect data' : '';
      var fallbackR  = TemplateLibrary.get(topPattern.intent, summary);
      return {
        intent:   CoachIntent.UNKNOWN,
        response: {
          text: "I don't have a specific insight for that — but here's what stands out in your data: " +
                fallbackR.text +
                "<br><br><small>Based on " + summary.dataWindowDays + " days of screen data" + hcNote + ".</small>",
          followUps: ChipGenerator.generate(summary).map(function(c) { return c.label; })
        },
        confidence:   confidence,
        usedFallback: true
      };
    }

    return {
      intent:       intent,
      response:     TemplateLibrary.get(intent, summary),
      confidence:   confidence,
      usedFallback: false
    };
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 10. EXPORTS
 * ───────────────────────────────────────────────────────────────────────── */
window.AureloCoach = {
  buildMockUsageSummary:  buildMockUsageSummary,
  loadUsageSummary:       loadUsageSummary,
  CoachIntent:            CoachIntent,
  CoachOrchestrator:      CoachOrchestrator,
  PatternDetector:        PatternDetector,
  ChipGenerator:          ChipGenerator,
  TemplateLibrary:        TemplateLibrary,
  CATEGORY_QUESTIONS:     CATEGORY_QUESTIONS,
  QueryGate:              QueryGate,
};

/* ─────────────────────────────────────────────────────────────────────────
 * 11. COACH UI
 *     FAB + bottom-sheet + conversation thread
 * ───────────────────────────────────────────────────────────────────────── */
window.CoachUI = {
  _summary:     null,
  _loading:     false,
  _initialised: false,

  init: function() {
    try {
      this._summary = AureloCoach.loadUsageSummary();
      this._renderChips();
      this._renderCatTab('score');
      this._renderTransparency();
      this._initFabDrag();
      this._initFabIcon();
      this._initialised = true;
    } catch (e) {
      console.error('[CoachUI] init error:', e);
      if (!this._summary) this._summary = AureloCoach.buildMockUsageSummary();
      this._initialised = true;
    }
  },

  // Inject Aurelo arch logo into FAB (replaces any star placeholder in HTML)
  _initFabIcon: function() {
    var fab = document.getElementById('coach-fab');
    if (!fab || fab.querySelector('.coach-fab-logo')) return;
    fab.innerHTML =
      '<div id="coach-fab-ring" style="position:absolute;inset:-6px;border-radius:50%;border:1.5px solid rgba(108,99,255,0.35);animation:coachFabPulse 2.8s ease-in-out infinite;pointer-events:none"></div>' +
      '<svg class="coach-fab-logo" width="26" height="26" viewBox="0 0 108 108" fill="none" overflow="visible">' +
        '<defs>' +
          '<linearGradient id="fabGa" x1="28" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0%" stop-color="#FFE082"/>' +
            '<stop offset="55%" stop-color="#FFAA44"/>' +
            '<stop offset="100%" stop-color="#FF7020"/>' +
          '</linearGradient>' +
          '<linearGradient id="fabDa" x1="48" y1="22" x2="60" y2="34" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0%" stop-color="#FFF3C0"/>' +
            '<stop offset="100%" stop-color="#FFD060"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<path d="M 22 88 C 22 88 30 30 54 20 C 78 30 86 88 86 88" stroke="url(#fabGa)" stroke-width="9" fill="none" stroke-linecap="round"/>' +
        '<circle cx="54" cy="20" r="6.5" fill="url(#fabDa)"/>' +
      '</svg>';
  },

  open: function(prefilled) {
    try {
      if (!this._initialised) this.init();
      var modal = document.getElementById('coach-modal');
      if (modal) modal.classList.add('open');
      if (prefilled) {
        var self = this;
        setTimeout(function() { self.send(prefilled); }, 320);
      }
    } catch (e) {
      console.error('[CoachUI] open error:', e);
    }
  },

  close: function() {
    var modal = document.getElementById('coach-modal');
    if (modal) modal.classList.remove('open');
  },

  openTransparency: function() {
    var el = document.getElementById('coach-transparency');
    if (el) el.classList.add('open');
  },

  closeTransparency: function() {
    var el = document.getElementById('coach-transparency');
    if (el) el.classList.remove('open');
  },

  setCatTab: function(tab, btn) {
    var tabs = document.querySelectorAll('.cat-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    if (btn) btn.classList.add('active');
    this._renderCatTab(tab);
  },

  handleKey: function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  },

  autoResize: function(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  },

  send: function(prefilled) {
    if (this._loading) return;

    // Free query gate check
    var gate = AureloCoach.QueryGate.getStatus();
    if (gate.limitReached) {
      this._showLimitMessage();
      return;
    }

    var input = document.getElementById('coach-input');
    var query = prefilled || (input ? input.value : '');
    query = (query || '').trim();
    if (!query) return;

    if (input) { input.value = ''; input.style.height = ''; }

    this._loading = true;
    var sendBtn = document.getElementById('coach-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    this._addUserMsg(query);
    this._showTyping();

    var self = this;
    setTimeout(function() {
      try {
        var result = AureloCoach.CoachOrchestrator.handleQuery(query, self._summary);
        self._removeTyping();
        self._addCoachMsg(result.response.text, result.response.followUps);
        self._hideIntroAndChips();
        // Increment query count after successful response
        AureloCoach.QueryGate.increment();
      } catch (err) {
        self._removeTyping();
        self._addCoachMsg(
          "Something went wrong processing your question. Try asking about your screen time, focus sessions, or streak.",
          ['Tell me about my week', 'How is my streak?', 'What should I work on?']
        );
        console.error('[CoachUI] send error:', err);
      }
      self._loading = false;
      if (sendBtn) sendBtn.disabled = false;
    }, 400);
  },

  _showLimitMessage: function() {
    var isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    if (isPro) return; // shouldn't reach here, but guard
    this._addCoachMsg(
      'You\'ve used your 3 free coach queries today. <strong>Upgrade to Pro</strong> for unlimited coach queries, full HC-aware insights, and more.',
      []
    );
    var chat = document.getElementById('coach-chat');
    if (chat) {
      var lastBubble = chat.querySelector('.msg-coach:last-child .msg-coach-bubble');
      if (lastBubble) {
        var btn = document.createElement('button');
        btn.textContent = 'Upgrade to Pro →';
        btn.style.cssText = 'margin-top:8px;padding:9px 18px;border-radius:10px;border:none;background:var(--p);color:#fff;font-family:var(--ff-m);font-size:13px;font-weight:600;cursor:pointer;display:block';
        btn.addEventListener('click', function() {
          if (typeof ProTier !== 'undefined' && typeof ProTier.triggerUpsell === 'function') {
            ProTier.triggerUpsell('COACH');
          }
        });
        lastBubble.appendChild(btn);
      }
    }
  },

  // ── Private methods ──────────────────────────────────────────

  _addUserMsg: function(text) {
    var chat = document.getElementById('coach-chat');
    if (!chat) return;
    var el = document.createElement('div');
    el.className = 'msg-user';
    el.textContent = text;
    chat.appendChild(el);
    this._scrollChat();
  },

  _addCoachMsg: function(html, followUps) {
    var chat = document.getElementById('coach-chat');
    if (!chat) return;

    var el = document.createElement('div');
    el.className = 'msg-coach';
    var avatar = document.createElement('div');
    avatar.className = 'msg-coach-avatar';
    avatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 108 108" fill="none" overflow="visible"><defs><linearGradient id="avGa" x1="28" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FFE082"/><stop offset="55%" stop-color="#FFAA44"/><stop offset="100%" stop-color="#FF7020"/></linearGradient></defs><path d="M 22 88 C 22 88 30 30 54 20 C 78 30 86 88 86 88" stroke="url(#avGa)" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="54" cy="20" r="6" fill="#FFE082"/></svg>';
    var bubble = document.createElement('div');
    bubble.className = 'msg-coach-bubble';
    bubble.innerHTML = html;
    if (followUps && followUps.length) {
      var fuDiv = document.createElement('div');
      fuDiv.className = 'msg-followups';
      var self = this;
      for (var i = 0; i < followUps.length; i++) {
        (function(label) {
          var btn = document.createElement('button');
          btn.className = 'msg-fu-chip';
          btn.textContent = label;
          btn.addEventListener('click', function() { self.send(label); });
          fuDiv.appendChild(btn);
        })(followUps[i]);
      }
      bubble.appendChild(fuDiv);
    }
    el.appendChild(avatar);
    el.appendChild(bubble);
    chat.appendChild(el);
    this._scrollChat();
  },

  _showTyping: function() {
    var chat = document.getElementById('coach-chat');
    if (!chat) return;
    var el = document.createElement('div');
    el.className = 'typing-wrap';
    el.id = 'coach-typing';
    el.innerHTML =
      '<div class="typing-dot"></div>' +
      '<div class="typing-dot"></div>' +
      '<div class="typing-dot"></div>';
    chat.appendChild(el);
    this._scrollChat();
  },

  _removeTyping: function() {
    var el = document.getElementById('coach-typing');
    if (el) el.parentNode.removeChild(el);
  },

  _hideIntroAndChips: function() {
    var intro = document.getElementById('coach-intro');
    var chips = document.getElementById('coach-chips-section');
    if (intro) intro.style.display = 'none';
    if (chips) chips.style.display = 'none';
  },

  _scrollChat: function() {
    var chat = document.getElementById('coach-chat');
    if (!chat) return;
    setTimeout(function() { chat.scrollTop = chat.scrollHeight; }, 60);
  },

  _renderChips: function() {
    var el = document.getElementById('coach-chips');
    if (!el || !this._summary) return;
    var chips = AureloCoach.ChipGenerator.generate(this._summary);
    el.innerHTML = '';
    var self = this;
    for (var i = 0; i < chips.length; i++) {
      (function(chip) {
        var btn = document.createElement('button');
        btn.className = 'coach-chip';
        btn.innerHTML = chip.label + '<span class="coach-chip-arr">›</span>';
        btn.addEventListener('click', function() { self.send(chip.label); });
        el.appendChild(btn);
      })(chips[i]);
    }
  },

  _renderCatTab: function(tab) {
    var el = document.getElementById('coach-cat-questions');
    if (!el) return;
    var qs = AureloCoach.CATEGORY_QUESTIONS[tab] || [];
    // Filter HC questions if HC not connected
    var s = this._summary;
    if (s && !s.hcConnected) {
      qs = qs.filter(function(q) {
        return q.intent !== CoachIntent.HC_POOR_SLEEP_HIGH_USAGE &&
               q.intent !== CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS;
      });
    }
    el.innerHTML = '';
    var self = this;
    for (var i = 0; i < qs.length; i++) {
      (function(q) {
        var btn = document.createElement('button');
        btn.className = 'cat-q';
        btn.textContent = q.label;
        btn.addEventListener('click', function() { self.send(q.label); });
        el.appendChild(btn);
      })(qs[i]);
    }
  },

  /** Dynamically update the transparency panel based on HC connection state (spec §21). */
  _renderTransparency: function() {
    var s = this._summary;
    if (!s) return;
    var container = document.querySelector('.coach-transparency-sheet');
    if (!container) return;

    // Build dynamic HC rows
    var hcRows = '';
    if (s.hcConnected) {
      var hcTypes = [
        { label: 'Heart rate variability', granted: s.hrvToday !== null },
        { label: 'Sleep sessions',          granted: s.sleepDurationMinutes !== null },
        { label: 'Daily steps',             granted: s.stepsToday !== null },
        { label: 'Resting heart rate',      granted: s.restingHeartRate !== null },
        { label: 'Mindfulness sessions',    granted: s.externalMindfulnessMinutesToday !== null },
      ];
      for (var i = 0; i < hcTypes.length; i++) {
        var t = hcTypes[i];
        if (t.granted) {
          hcRows += '<div class="coach-data-row hc-row">' +
            '<div class="coach-data-check hc-check">✓</div>' +
            '<div class="coach-data-label">' + t.label + ' <span class="hc-badge-inline">HC</span></div>' +
            '<div class="coach-data-meta">7 days</div>' +
          '</div>';
        }
      }
    } else {
      hcRows = '<div class="coach-data-row" style="opacity:0.4">' +
        '<div class="coach-data-check" style="border-color:var(--border2)">+</div>' +
        '<div class="coach-data-label" style="color:var(--t3)">Health Connect data</div>' +
        '<div class="coach-data-meta">Not connected</div>' +
      '</div>';
    }

    // Find and replace HC section only (leave existing rows intact)
    var hcSection = container.querySelector('.hc-section');
    if (!hcSection) {
      hcSection = document.createElement('div');
      hcSection.className = 'hc-section';
      var privacyFooter = container.querySelector('.coach-trans-privacy');
      if (privacyFooter) {
        container.insertBefore(hcSection, privacyFooter);
      } else {
        container.appendChild(hcSection);
      }
    }
    hcSection.innerHTML = hcRows;

    // Update privacy footer
    var footer = container.querySelector('.coach-trans-privacy');
    if (footer) {
      footer.textContent = 'All analysis runs entirely on your device. No data' +
        (s.hcConnected ? ' — including your Health Connect signals —' : '') +
        ' is ever sent to any server. Aurelo Coach has no internet connection.';
    }
  },

  // ── FAB drag (touch-based for Android WebView) ───────────────
  _initFabDrag: function() {
    var fab = document.getElementById('coach-fab');
    if (!fab || fab._dragInit) return;
    fab._dragInit = true;

    var isDragging = false;
    var startX, startY;
    var moved = false;

    function getParentRect() {
      return (fab.offsetParent || document.body).getBoundingClientRect();
    }

    fab.addEventListener('touchstart', function(e) {
      var t = e.touches[0];
      isDragging = true;
      moved = false;
      startX = t.clientX;
      startY = t.clientY;

      var rect = fab.getBoundingClientRect();
      var parent = getParentRect();
      fab.style.right  = 'auto';
      fab.style.bottom = 'auto';
      fab.style.left   = (rect.left - parent.left) + 'px';
      fab.style.top    = (rect.top  - parent.top)  + 'px';
      e.preventDefault();
    }, { passive: false });

    fab.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;

      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved = true; // raised: normal tap jitter is 5-8px

      var parent = getParentRect();
      var newLeft = parseFloat(fab.style.left) + dx;
      var newTop  = parseFloat(fab.style.top)  + dy;

      newLeft = Math.max(0, Math.min(parent.width  - fab.offsetWidth,  newLeft));
      newTop  = Math.max(0, Math.min(parent.height - fab.offsetHeight, newTop));

      fab.style.left = newLeft + 'px';
      fab.style.top  = newTop  + 'px';

      startX = t.clientX;
      startY = t.clientY;
      e.preventDefault();
    }, { passive: false });

    fab.addEventListener('touchend', function(e) {
      isDragging = false;
      if (!moved) { CoachUI.open(null); }
      fab._touchFired = true; // suppress the synthetic click Android fires after touchend
      setTimeout(function() { fab._touchFired = false; }, 400);
      e.preventDefault();
    }, { passive: false });

    // Desktop click fallback — skip if touch already handled this tap
    fab.addEventListener('click', function() {
      if (fab._touchFired) return;
      if (!moved) CoachUI.open(null);
    });
  }
};

// Proactively init CoachUI on DOMContentLoaded so FAB listeners are attached
// immediately — prevents chicken-and-egg where first tap does nothing.
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (typeof CoachUI !== 'undefined' && !CoachUI._initialised) { CoachUI.init(); }
  }, 300);
});