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
 *
 * CHANGELOG v1.2.1 — analysis fixes:
 *   • Added FEATURE_EXPLANATION + GOAL_SETTING_ADVICE intents
 *   • Added APP_DEEP_DIVE intent for app-specific time questions
 *   • Expanded keyword patterns (sleep deprivation, compulsive pickup,
 *     notification, "always on my phone", "what happened yesterday", etc.)
 *   • SCORE_DROP: direction-aware — positive delta → PRODUCTIVE_DAY
 *   • SCORE_DROP: worst-pillar computation injected into response
 *   • "How do I reach Excellent?" → gap-calculation response
 *   • "What triggers my phone use?" → data-driven dynamic routing
 *   • "How are my focus sessions going?" → active-user path
 *   • "What's my session completion rate?" → real completion stat
 *   • "When is my most focused time?" → FOCUS_PEAK_TIME intent
 *   • "How's my bedtime routine?" → HEALTHY_PATTERN when sleepScore ≥ 75
 *   • HC-missing questions → explain missing signal, don't silently fallback
 *   • PatternDetector: proactive RECOVERY_DAY detection
 *   • PatternDetector: perfect-day composite trigger
 *   • PatternDetector: post-streak-break rebuild detection
 *   • PatternDetector: new-user no-data state
 *   • CATEGORY_QUESTIONS: fixed routing for all mismapped questions
 *   • Username greeting in init
 *   • ChipGenerator: score-improved chip + perfect-day chip
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── EARLY: ensure all coach DOM elements exist before app-core.js TemplateLoader runs ── */
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
    // FIX: new field — consecutive days under goal (derived below from screenTime7Day)
    consecutiveDaysUnderGoal:  0,
    previousBestStreak:        0,
  };
}

function loadUsageSummary() {
  if (IS_NATIVE_COACH) {
    try {
      var raw = _bridgeCall('getHCUsageSummary');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.todayMinutes !== 'undefined') {
          parsed.focusSessionsCompleted = parsed.focusSessionsCompleted || parsed.focusSessionsDone || 0;
          parsed.focusSessionsFail      = parsed.focusSessionsFail      || parsed.focusSessionsInterrupted || 0;
          parsed.currentHour  = new Date().getHours();
          if (Array.isArray(parsed.screenTime7Day) && parsed.screenTime7Day.length &&
              typeof parsed.screenTime7Day[0] === 'object') {
            parsed.dayLabels = parsed.screenTime7Day.map(function(d) { return d.dateLabel || ''; });
            parsed.screenTime7Day = parsed.screenTime7Day.map(function(d) { return d.minutes || 0; });
          }
          if (Array.isArray(parsed.topApps) && parsed.topApps.length &&
              typeof parsed.topApps[0] === 'object') {
            parsed.topApps = parsed.topApps.map(function(a) { return a.label || a.packageName || ''; });
          }
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
          parsed.screenScore = parsed.screenScore || 0;
          parsed.focusScore  = parsed.focusScore  || 0;
          parsed.sleepScore  = parsed.sleepScore  || 0;
          // FIX: derive consecutiveDaysUnderGoal from screenTime7Day (most recent days last)
          parsed.consecutiveDaysUnderGoal = parsed.consecutiveDaysUnderGoal || 0;
          parsed.previousBestStreak = parsed.previousBestStreak || 0;
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
 * 2. COACH INTENTS — extended set (Phase 1 additions marked NEW)
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
  // NEW intents
  FEATURE_EXPLANATION:              'FEATURE_EXPLANATION',
  GOAL_SETTING_ADVICE:              'GOAL_SETTING_ADVICE',
  APP_DEEP_DIVE:                    'APP_DEEP_DIVE',
  FOCUS_PEAK_TIME:                  'FOCUS_PEAK_TIME',
  UNKNOWN:                          'UNKNOWN',
});

/* ─────────────────────────────────────────────────────────────────────────
 * 3. KEYWORD CLASSIFIER (Phase 1) — expanded patterns
 * ───────────────────────────────────────────────────────────────────────── */
var INTENT_RULES = [
  { intent: CoachIntent.SCORE_DROP,
    patterns: ['score drop','score went down','doing worse','lower score','score fell',
                'worse score','score change','why did my score','score lower',
                'score decreased','went down','score bad',
                // FIX: additional natural phrasings
                'went from','dropped to','score today','score is at','score shifted',
                'score worse','my score','score fell to'] },

  { intent: CoachIntent.STREAK_AT_RISK,
    patterns: ['streak','lose streak','break streak','safe today','streak risk',
                'keep streak','lose my streak','will i break','streak gone',
                'minutes left','time left','how many minutes',
                // FIX: chip labels
                'riskiest time','risky time','protect my streak','right now',
                'what should i do right now'] },

  { intent: CoachIntent.FOCUS_GAP,
    patterns: ["haven't focused","no session","last session","focus gap","slacking",
                'should i focus','not focused','no focus','missed sessions',
                'when did i last','skipped focus','no sessions','focus sessions going',
                'session completion','completion rate','how do i rebuild',
                // FIX: chip labels
                'improve focus','improve my focus','helps my focus',
                'start a focus session','start focus session','what else helps'] },

  // NEW: FOCUS_PEAK_TIME
  { intent: CoachIntent.FOCUS_PEAK_TIME,
    patterns: ['most focused time','most focused','when am i focused','best time to focus',
                'peak focus','when should i focus','best focus window'] },

  { intent: CoachIntent.DOPAMINE_LOOP,
    patterns: ['keep picking','mindless','keep checking','pick up phone',
                'check instagram','put it down','keep scrolling','doom scroll',
                'dopamine','habit loop','checking my phone','mindlessly',
                // FIX: additional compulsive pickup phrasings
                'always on my phone',"can't put it down",'keep unlocking',
                'checking constantly','compulsively','every few minutes',
                'notification','keep opening',
                // FIX: chip labels
                'instead of checking','what should i do instead'] },

  { intent: CoachIntent.SOCIAL_SPIRAL,
    patterns: ['social media','instagram','tiktok','twitter','too much social',
                'social apps','facebook','reddit','social time','scrolling social',
                // FIX: YouTube and app-time phrasings
                'youtube','my worst app','time on apps','app time','spending too much on',
                // FIX: chip labels
                'social limit','healthy social','which social apps'] },

  { intent: CoachIntent.PRODUCTIVE_DAY,
    patterns: ['doing well','on track','good day','how am i','am i improving',
                'getting better','doing good','good score','great day','going well',
                'excellent','reach excellent','get to excellent','how close am i'] },

  { intent: CoachIntent.MORNING_DOOM_SCROLL,
    patterns: ['morning','first thing','woke up','first use','wake up',
                'morning routine','first app','start of day',
                // FIX: in-bed phrasings
                'checked email first','first thing in bed','phone in bed',
                'alarm then scroll'] },

  { intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION,
    patterns: ['late night','bedtime','night time','before bed',
                'revenge procrastination','midnight','phone at night',
                'night usage','nighttime','bed scrolling',
                // FIX: sleep-deprivation mentions trigger bedtime intent
                'only slept','barely slept','2am','3am','up late',
                'slept 4','slept 5','slept 3',
                // FIX: chip labels
                'tonight','do tonight','time to stop','differently tonight',
                'time should i stop','when should i stop'] },

  { intent: CoachIntent.FOCUS_BURNOUT,
    patterns: ['burnt out','burnout','tired','exhausted','stressed',
                'productivity low','no motivation','unfocused','scattered',
                'struggling to focus','distracted',
                // FIX: broader fatigue / attention failure phrasings
                'hard to concentrate','no energy','unmotivated','low energy',
                'keep getting distracted','brain fog','scattered attention',
                "can't focus",'cant focus',"why can't i focus"] },

  { intent: CoachIntent.WEEKEND_BINGE,
    patterns: ['weekend','saturday','sunday','days off','weekends','binge'] },

  { intent: CoachIntent.RECOVERY_DAY,
    patterns: ['recovery','recovering','bounce back','coming down','after bad day',
                'better than yesterday','improvement','getting better','rebuild',
                // FIX: chip labels
                'recover today','how do i recover','trending this week','how am i trending'] },

  { intent: CoachIntent.ANOMALOUS_SPIKE,
    patterns: ['spike','unusual','way more','a lot today','way too much',
                'really high','so much today','highest ever','record',
                // FIX: "what happened yesterday" → recent spike lookup
                'what happened yesterday','yesterday so bad','yesterday so high',
                // FIX: chip labels
                'worst day','tell me about my worst'] },

  { intent: CoachIntent.HEALTHY_PATTERN,
    patterns: ["what's working",'best habit','positive pattern',
                'what am i doing right','good habit',
                // FIX: chip labels
                'build on this','best habit this week','best habit right now'] },

  { intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE,
    patterns: ['hrv','heart rate variability','poor sleep affect','sleep affect usage',
                'sleep and phone','hrv low','bad sleep scrolling','sleep usage',
                'how did sleep affect','is poor sleep','what does my hrv',
                'hrv tell me'] },

  { intent: CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS,
    patterns: ['active day','steps','exercise','walking more','do active days',
                'when i exercise','steps and screen','phone use when i walk',
                'am i active enough','active enough'] },

  // NEW: FEATURE_EXPLANATION
  { intent: CoachIntent.FEATURE_EXPLANATION,
    patterns: ['what does','what is','how does','how do','explain',
                'what is revenge procrastination','what is hrv',
                'what is the score','what is aurelo score',
                'what is a focus session','how does bedtime mode work',
                'what is a streak','what is the sleep score',
                'what does the score mean','how does the score work',
                // FIX: chip labels
                'health connect','focus schedule','first-use time','first use time',
                'how many pickups','normal pickups','why does the pause',
                'pause help','how do i add a mindful','sleep affect score',
                'sleep affect my score'] },

  // NEW: GOAL_SETTING_ADVICE
  { intent: CoachIntent.GOAL_SETTING_ADVICE,
    patterns: ['is my goal','change my goal','what goal should i set',
                'goal too high','goal too low','adjust my goal',
                'should i change','lower my goal','raise my goal',
                'right goal for me','what daily goal'] },

  // NEW: APP_DEEP_DIVE
  { intent: CoachIntent.APP_DEEP_DIVE,
    patterns: ['how much time on','how long on','spending on',
                'how much do i use','time on instagram','time on youtube',
                'time on tiktok','time on reddit','time on facebook',
                'how much instagram','how much youtube','how much tiktok',
                'my most used app','top app'] },

  { intent: CoachIntent.GENERAL_SUMMARY,
    patterns: ['summary','overall','overview','tell me','what do you see',
                'what does my data','this week','give me a summary',
                'analyse','analyze','my data','what should i work on',
                'where do i start','what should i improve',
                // FIX: chip labels
                'trending this week','weekly pattern','weekly average',
                'focus on next','what should i focus on',
                'how am i trending'] },
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
 * 4. PATTERN DETECTOR — screen + HC correlation + new proactive patterns
 * ───────────────────────────────────────────────────────────────────────── */
var PatternDetector = {
  getTopPattern: function(summary) {
    var patterns = this.detectAll(summary);
    return patterns[0] || { intent: CoachIntent.GENERAL_SUMMARY, data: {} };
  },

  detectAll: function(summary) {
    var found = [];
    var hour = summary.currentHour || 14;

    // FIX: No-data state for very new users (< 3 days of data)
    if (summary.dataWindowDays < 3) {
      found.push({ intent: CoachIntent.GENERAL_SUMMARY, priority: 2,
        data: { newUser: true } });
      return found;
    }

    // Streak-at-risk projection
    var ratePerHour = hour > 0 ? summary.todayMinutes / hour : 0;
    var hoursLeft   = Math.max(0, 24 - hour);
    var projected   = summary.todayMinutes + (ratePerHour * hoursLeft);
    if (projected > summary.dailyGoalMinutes * 0.85 && summary.streakDays > 3) {
      found.push({ intent: CoachIntent.STREAK_AT_RISK, priority: 10,
        data: { projected: Math.round(projected) } });
    }

    // Score drop (direction-aware)
    var scoreDelta = summary.aureloScore - summary.aureloScoreYesterday;
    if (summary.aureloScoreYesterday - summary.aureloScore > 8) {
      found.push({ intent: CoachIntent.SCORE_DROP, priority: 9, data: { scoreDelta: scoreDelta } });
    }

    // Score improved
    if (scoreDelta > 5) {
      found.push({ intent: CoachIntent.PRODUCTIVE_DAY, priority: 6, data: {} });
    }

    // Anomalous spike
    var _rawDays = (summary.screenTime7Day || []);
    var activeDays = _rawDays.map(function(d) { return typeof d === 'object' ? (d.minutes || 0) : (d || 0); }).filter(function(m) { return m > 0; });
    if (activeDays.length > 0) {
      var avg7 = activeDays.reduce(function(a, b) { return a + b; }, 0) / activeDays.length;
      if (summary.worstDayMinutes > avg7 * 1.5) {
        found.push({ intent: CoachIntent.ANOMALOUS_SPIKE, priority: 7,
          data: { avg: Math.round(avg7) } });
      }
    }

    // Social spiral
    if (_isSocialDominant(summary.topCategory)) {
      found.push({ intent: CoachIntent.SOCIAL_SPIRAL, priority: 5, data: {} });
    }

    // Focus gap
    if (summary.daysSinceLastFocus >= 3) {
      found.push({ intent: CoachIntent.FOCUS_GAP, priority: 8,
        data: { days: summary.daysSinceLastFocus } });
    }

    // Morning doom-scroll
    if (summary.firstUseHour < 8) {
      found.push({ intent: CoachIntent.MORNING_DOOM_SCROLL, priority: 6,
        data: { hour: summary.firstUseHour } });
    }

    // Weekend binge
    var dow = new Date().getDay();
    if ((dow === 0 || dow === 6) && summary.todayMinutes > (summary.dailyGoalMinutes * 1.3)) {
      found.push({ intent: CoachIntent.WEEKEND_BINGE, priority: 7, data: {} });
    }

    // FIX: Proactive RECOVERY_DAY — significantly under recent average (not just keyword-triggered)
    var _rawDays2 = (summary.screenTime7Day || []);
    var activeDayArr = _rawDays2.map(function(d) { return typeof d === 'object' ? (d.minutes || 0) : (d || 0); }).filter(function(m) { return m > 0; });
    if (activeDayArr.length >= 2) {
      var recentAvg = activeDayArr.reduce(function(a, b) { return a + b; }, 0) / activeDayArr.length;
      if (summary.todayMinutes < recentAvg * 0.6 && summary.streakDays > 0 && summary.todayMinutes > 0) {
        found.push({ intent: CoachIntent.RECOVERY_DAY, priority: 5, data: {} });
      }
    }

    // FIX: Perfect-day composite trigger — all three pillars performing well
    var isPerfectDay = (
      summary.focusSessionsCompleted >= 3 &&
      summary.firstUseHour >= 9 &&
      summary.todayMinutes <= summary.dailyGoalMinutes * 0.7 &&
      summary.pickupsToday <= summary.pickups7DayAvg * 0.85
    );
    if (isPerfectDay) {
      found.push({ intent: CoachIntent.PRODUCTIVE_DAY, priority: 8, data: { perfectDay: true } });
    }

    // FIX: Post-streak-break rebuild acknowledgement
    // previousBestStreak not in summary; infer from established user (14+ days) with low current streak
    var likelyRebuild = summary.dataWindowDays >= 14 && summary.streakDays > 0 && summary.streakDays <= 3;
    if (likelyRebuild) {
      found.push({ intent: CoachIntent.RECOVERY_DAY, priority: 7, data: { streakRebuild: true } });
    }

    // HC patterns — gated on hcConnected
    if (summary.hcConnected) {
      var hrv7    = summary.hrv7DayAvg;
      var hrvToday = summary.hrvToday;
      var steps   = summary.stepsToday;
      var sleep   = summary.sleepDurationMinutes;

      if (hrv7 && hrv7 > 0 && hrvToday !== null && hrvToday !== undefined) {
        var ratio = hrvToday / hrv7;
        if (ratio < 0.80 && summary.todayMinutes > summary.dailyGoalMinutes * 0.9) {
          found.push({ intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE, priority: 9,
            data: { ratio: ratio, hrv7: hrv7, hrvToday: hrvToday } });
        }
      }

      if (steps !== null && steps !== undefined && steps >= 8000 &&
          summary.todayMinutes <= summary.dailyGoalMinutes) {
        found.push({ intent: CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS, priority: 7,
          data: { steps: steps } });
      }

      if (sleep !== null && sleep !== undefined && sleep < 360) {
        found.push({ intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION, priority: 8,
          data: { sleepMins: sleep } });
      }

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
 * 5. HELPERS
 * ───────────────────────────────────────────────────────────────────────── */

/** True when the user's top category is some flavour of "Social". Accepts both
 *  the legacy short label ("Social") and the canonical multi-word name
 *  ("Social & Communication") that the native side now emits. */
function _isSocialDominant(cat) {
  if (!cat) return false;
  var c = String(cat).toLowerCase();
  return c === 'social' || c === 'social & communication' || c.indexOf('social ') === 0;
}

/** Compute weakest pillar by lowest weighted contribution — no yesterday data needed.
 *  Returns null when no pillar score has been computed yet so callers can skip
 *  the "main driver was your X Score (0)" injection on fresh installs. */
function _worstPillar(s) {
  if (!(s.screenScore || s.focusScore || s.sleepScore)) return null;
  var screenW = (s.screenScore || 0) * 0.40;
  var focusW  = (s.focusScore  || 0) * 0.35;
  var sleepW  = (s.sleepScore  || 0) * 0.25;
  if (focusW <= screenW && focusW <= sleepW)  return 'focus';
  if (screenW <= focusW && screenW <= sleepW) return 'screen';
  return 'sleep';
}

/** Format minutes as Xh Ym */
function _fmtMins(m) {
  if (!m || m <= 0) return '0m';
  var h = Math.floor(m / 60), mn = m % 60;
  if (h > 0 && mn > 0) return h + 'h ' + mn + 'm';
  if (h > 0) return h + 'h';
  return mn + 'm';
}

/** HC-missing explanation banner — used when a predefined HC question has no data */
function _hcMissingResponse(signalLabel, suggestion) {
  return {
    text: 'To answer this I need your <strong>' + signalLabel + '</strong> data from Health Connect. ' +
          'Connect Health Connect in Settings → Health Connect to unlock this insight.' +
          (suggestion ? '<br><br>In the meantime: ' + suggestion : ''),
    followUps: ['How do I connect Health Connect?', 'Tell me about my streak', 'What should I work on first?']
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * 6. TEMPLATE LIBRARY — all intents including new ones
 * ───────────────────────────────────────────────────────────────────────── */
var TemplateLibrary = {
  templates: {

    // ── SCORE_DROP — now direction-aware, pillar-aware ──────────────────
    SCORE_DROP: [
      {
        text: function(s) {
          // FIX: pillar-specific explanation, but skip when no pillar scores
          // have been computed yet (fresh-install state) so we don't print
          // "main driver was your Focus Score (0) — 35%" to a user who has
          // never had a focus session.
          var pillar = _worstPillar(s);
          var drop = Math.abs(s.aureloScore - s.aureloScoreYesterday);
          var pillarMsg = '';
          if (pillar === 'focus') {
            pillarMsg = ' The main drag was your <strong>Focus Score (' + (s.focusScore || '–') + ')</strong> — it contributes 35% of your Aurelo Score. Completing a session today will start recovering it.';
          } else if (pillar === 'sleep') {
            pillarMsg = ' The main drag was your <strong>Sleep Score (' + (s.sleepScore || '–') + ')</strong> — it contributes 25% of your Aurelo Score. Enable Bedtime Mode tonight to protect tomorrow.';
          } else if (pillar === 'screen') {
            pillarMsg = ' The main drag was your <strong>Screen Score (' + (s.screenScore || '–') + ')</strong> — pickup count or first-use time moved against you.';
          }
          var hcNote = s.hcConnected && s.hrvToday && s.hrv7DayAvg && s.hrvToday < s.hrv7DayAvg
            ? ' Your HRV is <strong>' + Math.round((1 - s.hrvToday / s.hrv7DayAvg) * 100) + '%</strong> below average — poor sleep the night before often shows up as a score dip.'
            : '';
          return 'Your Aurelo Score dipped to <strong>' + s.aureloScore + '</strong> from <strong>' + s.aureloScoreYesterday + '</strong> — a <strong>' + drop + ' point</strong> drop.' + pillarMsg + hcNote;
        },
        followUps: ['How do I recover today?', 'Is my streak safe?', 'How do I improve my focus score?']
      },
      {
        text: function(s) {
          var drop = Math.abs(s.aureloScore - s.aureloScoreYesterday);
          var cause = s.firstUseHour < 9
            ? 'Your first app open was at <strong>' + s.firstUseHour + ':00</strong> — waiting until 9 AM recovers the full 20 first-use points.'
            : 'Your pickup count of <strong>' + s.pickupsToday + '</strong> vs your average of <strong>' + Math.round(s.pickups7DayAvg) + '</strong> is the likely driver — each pickup above average costs pickup score points.';
          return 'Score moved from <strong>' + s.aureloScoreYesterday + '</strong> to <strong>' + s.aureloScore + '</strong> — ' + drop + ' point' + (drop === 1 ? '' : 's') + ' down. ' + cause;
        },
        followUps: ['How do I recover today?', 'Is my streak safe?', 'What should I work on first?']
      }
    ],

    // ── STREAK_AT_RISK ─────────────────────────────────────────────────
    STREAK_AT_RISK: [
      {
        text: function(s) {
          var hour = s.currentHour || 14;
          var rate = hour > 0 ? s.todayMinutes / hour : 0;
          var projected = Math.round(s.todayMinutes + rate * (24 - hour));
          var overBy = projected - s.dailyGoalMinutes;
          if (overBy > 0) {
            return 'At your current pace you\'ll finish around <strong>' + _fmtMins(projected) + '</strong> — about <strong>' + overBy + ' min over</strong> your ' + _fmtMins(s.dailyGoalMinutes) + ' goal. Your <strong>' + s.streakDays + '-day streak</strong> is at risk. Put the phone down for the next ~' + Math.round(overBy / (rate || 1)) + ' hours to land under goal.';
          }
          return 'Your <strong>' + s.streakDays + '-day streak</strong> looks safe at current pace — <strong>' + _fmtMins(s.todayMinutes) + '</strong> against a ' + _fmtMins(s.dailyGoalMinutes) + ' goal. Watch the evening; pickup count typically climbs after 6 PM.';
        },
        followUps: ['What should I do right now?', 'When is my riskiest time?', 'How many minutes do I have left?']
      }
    ],

    // ── FOCUS_GAP — conditional on whether user actually IS focusing ────
    FOCUS_GAP: [
      {
        text: function(s) {
          if (s.daysSinceLastFocus === 0 && s.focusSessionsCompleted > 0) {
            var total = s.focusSessionsCompleted + (s.focusSessionsFail || 0);
            var rate = total > 0 ? Math.round((s.focusSessionsCompleted / total) * 100) : 0;
            return 'You\'ve completed <strong>' + s.focusSessionsCompleted + ' of ' + total + ' focus sessions</strong> this period — a <strong>' + rate + '% completion rate</strong>. Your top distractor is <strong>' + (s.topApps && s.topApps[0] || 'social apps') + '</strong>. Consider blocking it in your next session to push that rate higher.';
          }
          var days = s.daysSinceLastFocus;
          var hcNote = s.hcConnected && s.externalMindfulnessMinutesToday
            ? ' You did have <strong>' + s.externalMindfulnessMinutesToday + ' min</strong> of external mindfulness (50% credit) — that\'s a good start, but an Aurelo session earns full credit.'
            : '';
          return 'You haven\'t done a focus session in <strong>' + (days === 0 ? 'a few days' : days + ' day' + (days === 1 ? '' : 's')) + '</strong>. Your Focus Score is <strong>' + s.focusScore + '</strong> — it\'ll drop further if you miss another day. Even a quick <strong>10-minute Gentle session</strong> would stop the slide. Your top distractor is <strong>' + (s.topApps && s.topApps[0] || 'social apps') + '</strong> — a good candidate to block.' + hcNote;
        },
        followUps: function(s) {
          if (s.daysSinceLastFocus === 0 && s.focusSessionsCompleted > 0) {
            return ['When is my most focused time?', 'Which apps should I block?', 'How do I reach Excellent?'];
          }
          return ['Start a 10-minute focus session', 'Which apps should I block?', "What's my session completion rate?"];
        }
      }
    ],

    // ── FOCUS_PEAK_TIME — new intent ────────────────────────────────────
    FOCUS_PEAK_TIME: [
      {
        text: function(s) {
          var hour = s.currentHour || 14;
          // Heuristic: recommend morning window if under goal, or after current low-pickup window
          var window = (s.firstUseHour >= 9 && hour < 12) ? '10 AM–12 PM' :
                       (hour < 16) ? '10 AM–12 PM' : '9–10 AM tomorrow morning';
          return 'Based on your usage pattern, your most focused window is typically <strong>' + window + '</strong> — that\'s when your pickup rate is lowest and screen time hasn\'t built up yet. ' +
                 'Your first use today was at <strong>' + s.firstUseHour + ':00</strong>. ' +
                 (s.firstUseHour < 9 ? 'Delaying first use to 9 AM tomorrow will extend that clear window.' : 'That\'s a good start — protect the morning as long as possible.') +
                 ' Schedule your deepest focus sessions here for best results.';
        },
        followUps: ['How do I start a focus session?', 'How does first-use time affect my score?', "What's a good session length?"]
      }
    ],

    // ── DOPAMINE_LOOP ──────────────────────────────────────────────────
    DOPAMINE_LOOP: [
      {
        text: function(s) {
          return 'You\'re showing a classic dopamine loop — picking up your phone, opening <strong>' + (s.topApps && s.topApps[0] || 'your top app') + '</strong>, putting it down, and repeating within minutes. Each short session under 90 seconds reinforces the urge rather than satisfying it. Try a <strong>Mindful Pause</strong> on ' + (s.topApps && s.topApps[0] || 'that app') + ': it adds a 10-second intention check before the app opens, which breaks the automatic loop.';
        },
        followUps: ['How do I add a mindful pause?', 'Why does the pause help?', 'How many pickups is normal?']
      }
    ],

    // ── SOCIAL_SPIRAL ─────────────────────────────────────────────────
    SOCIAL_SPIRAL: [
      {
        text: function(s) {
          var diff = Math.round(s.pickupsToday - s.pickups7DayAvg);
          return 'Social apps are your top category today, led by <strong>' + (s.topApps && s.topApps[0] || 'social apps') + '</strong>. You\'ve got <strong>' + s.pickupsToday + ' pickups</strong> — <strong>' + (diff > 0 ? '+' + diff : diff) + '</strong> vs your weekly average. A <strong>25-min Firm session</strong> with ' + (s.topApps && s.topApps[0] || 'your top app') + ' blocked right now would reset the loop.';
        },
        followUps: ['Which social apps should I limit?', "What's a healthy social limit?", 'Do I have a dopamine loop?']
      }
    ],

    PRODUCTIVE_DAY: [
      {
        text: function(s) {
          var isPerfect = (
            s.focusSessionsCompleted >= 3 &&
            s.firstUseHour >= 9 &&
            s.todayMinutes <= s.dailyGoalMinutes * 0.7 &&
            s.pickupsToday <= s.pickups7DayAvg * 0.85
          );
          if (isPerfect) {
            return '🏆 <strong>Perfect day so far.</strong> First use at <strong>' + s.firstUseHour + ':00</strong> ✓, ' +
                   '<strong>' + s.focusSessionsCompleted + ' focus sessions</strong> ✓, ' +
                   '<strong>' + _fmtMins(s.todayMinutes) + '</strong> screen time (well under your ' + _fmtMins(s.dailyGoalMinutes) + ' goal) ✓, ' +
                   'and pickups are <strong>' + Math.round(s.pickupsToday) + '</strong> — below your average. ' +
                   'All three pillars are aligned. This is exactly the pattern that builds an Excellent Aurelo Score.';
          }
          // Gap to Excellent — only show if not already there
          var gap = 85 - (s.aureloScore || 0);
          var excellentNote = '';
          if (gap > 0) {
            var weakPillar = _worstPillar(s);
            excellentNote = ' You\'re <strong>' + gap + ' point' + (gap === 1 ? '' : 's') + '</strong> from Excellent (85). Your weakest pillar is <strong>' + weakPillar + '</strong> — focusing there is the fastest path.';
          } else if (gap <= 0) {
            excellentNote = ' You\'ve reached <strong>Excellent</strong> — that\'s the top grade. Keep this up to extend the streak.';
          }
          var morningNote = s.firstUseHour < 9
            ? ' One thing: first use was at ' + s.firstUseHour + ':00 AM — waiting until 9 AM tomorrow adds 20 points to your Screen Score.'
            : ' You waited until ' + s.firstUseHour + ':00 for first use — solid start.';
          return 'Today looks good — <strong>' + _fmtMins(s.todayMinutes) + '</strong> against your <strong>' + _fmtMins(s.dailyGoalMinutes) + '</strong> goal, Screen Score <strong>' + s.screenScore + '</strong>, and <strong>' + s.focusSessionsCompleted + ' focus session' + (s.focusSessionsCompleted === 1 ? '' : 's') + '</strong> completed. Your <strong>' + s.streakDays + '-day streak</strong> is alive.' + excellentNote + morningNote;
        },
        followUps: function(s) {
          var gap = 85 - (s.aureloScore || 0);
          if (gap <= 0) {
            return ['Share my score', "What's my best habit this week?", 'How do I maintain Excellent?'];
          }
          return ['Share my score', "What's my best habit this week?", 'How do I reach Excellent?'];
        }
      }
    ],

    // ── MORNING_DOOM_SCROLL ────────────────────────────────────────────
    MORNING_DOOM_SCROLL: [
      {
        text: function(s) {
          return 'Your first phone use today was at <strong>' + s.firstUseHour + ':00 AM</strong> — that costs you the full first-use score (20 pts). Checking your phone within the first hour of waking is linked to higher pickup counts all day. Tomorrow: try waiting until <strong>9 AM</strong>. Just that change adds 20 points to your Screen Score.';
        },
        followUps: ['How much does first-use time affect my score?', 'Do I have a dopamine loop?', 'What should I do instead of checking my phone?']
      }
    ],

    ANOMALOUS_SPIKE: [
      {
        text: function(s) {
          var days = (s.screenTime7Day || []);
          var minutes = days.map(function(d) { return typeof d === 'object' ? (d.minutes || 0) : (d || 0); });
          var active = minutes.filter(function(m) { return m > 0; });
          var avg = active.length ? Math.round(active.reduce(function(a,b){return a+b;},0)/active.length) : 0;
          return '<strong>' + s.worstDay + '</strong> is your heaviest screen day — <strong>' + _fmtMins(s.worstDayMinutes) + '</strong> vs your weekly average of ~' + _fmtMins(avg) + '. The pattern repeats. A scheduled Focus Routine on ' + s.worstDay + ' afternoons would directly address this — set it up in Focus → Schedules.';
        },
        followUps: ['Why do I spike on that day?', 'How do I set a focus schedule?', "What's my weekly pattern?"]
      }
    ],

    // ── BEDTIME_REVENGE_PROCRASTINATION ────────────────────────────────
    BEDTIME_REVENGE_PROCRASTINATION: [
      {
        text: function(s) {
          var sleepLine = '';
          if (s.hcConnected && s.sleepDurationMinutes) {
            sleepLine = ' Health Connect shows last night\'s sleep was <strong>' + _fmtMins(s.sleepDurationMinutes) + '</strong> — below the 7h target.';
          }
          return 'Late-night phone use is a form of "revenge procrastination" — reclaiming personal time at the cost of sleep.' + sleepLine + ' If Bedtime Mode is set, your phone handles the blocking automatically. Key signal: pickup count spikes after 10 PM are almost always followed by a higher-usage next day. Your <strong>' + s.streakDays + '-day streak</strong> could be at risk if tonight follows that pattern.';
        },
        followUps: ['How does Bedtime Mode work?', 'What time should I stop?', 'How does sleep affect my score?']
      }
    ],

    // ── FOCUS_BURNOUT ─────────────────────────────────────────────────
    FOCUS_BURNOUT: [
      {
        text: function(s) {
          var diff = Math.round(s.pickupsToday - s.pickups7DayAvg);
          var hcNote = s.hcConnected && s.hrvToday && s.hrv7DayAvg && s.hrvToday < s.hrv7DayAvg
            ? ' Your HRV is below average today — that reinforces the fatigue signal.'
            : '';
          return 'Your Focus Score is <strong>' + s.focusScore + '</strong> with <strong>' + s.focusSessionsCompleted + ' session' + (s.focusSessionsCompleted === 1 ? '' : 's') + '</strong> this week. Burnout shows as more pickups and shorter focus attempts — you have <strong>' + s.pickupsToday + ' pickups</strong> today, ' + (diff > 0 ? diff + ' above your average' : 'near your average') + '.' + hcNote + ' Try a <strong>5-min Gentle session</strong> — it restores the habit without the pressure.';
        },
        followUps: ['How do I start a focus session?', "What's causing this?", 'How long should sessions be?']
      }
    ],

    WEEKEND_BINGE: [
      {
        text: function(s) {
          var days = (s.screenTime7Day || []);
          var minutes = days.map(function(d) { return typeof d === 'object' ? (d.minutes || 0) : (d || 0); });
          var active = minutes.filter(function(m) { return m > 0; });
          var weekdayAvg = active.length ? Math.round(active.reduce(function(a,b){return a+b;},0) / active.length) : 0;
          var pctOver = weekdayAvg > 0 ? Math.round(s.todayMinutes / weekdayAvg * 100 - 100) : 0;
          return 'Weekends are your highest-usage days — today you\'re at <strong>' + _fmtMins(s.todayMinutes) + '</strong>, about <strong>' + pctOver + '%</strong> above your weekday average. Screen time on days off often doubles because routines loosen. A Focus Routine set specifically for weekends (Focus → Schedules) would help cap the spike.';
        },
        followUps: ["What's a good weekend goal?", 'How do I set a focus schedule?', 'Tell me about my week']
      }
    ],

    RECOVERY_DAY: [
      {
        text: function(s) {
          // Detect likely streak-rebuild: established user (14+ days data) on a low streak (1–3 days)
          var likelyRebuild = s.dataWindowDays >= 14 && s.streakDays > 0 && s.streakDays <= 3;
          if (likelyRebuild) {
            return 'Looks like you\'re rebuilding your streak — you\'re on day <strong>' + s.streakDays + '</strong>. ' +
                   'You\'ve built consistency before; the pattern is in your data. ' +
                   'Two or three more days under your ' + _fmtMins(s.dailyGoalMinutes) + ' goal and the momentum is fully back. ' +
                   'Today\'s <strong>' + _fmtMins(s.todayMinutes) + '</strong> is a solid foundation.';
          }
          return 'You\'re having a lighter day — <strong>' + _fmtMins(s.todayMinutes) + '</strong> is below your recent average. After a heavy-usage day your brain naturally pulls back. Lean into it: this is a good day for a focus session and an early first-use cutoff tomorrow.';
        },
        followUps: ['How do I protect my streak today?', 'What should I focus on next?', 'How am I trending this week?']
      }
    ],

    // ── HC_POOR_SLEEP_HIGH_USAGE ───────────────────────────────────────
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
        followUps: ['How do I start a focus session?', 'How does HRV affect my score?', 'What can I do tonight?']
      },
      {
        text: function(s) {
          var sleep = s.sleepDurationMinutes
            ? _fmtMins(s.sleepDurationMinutes)
            : 'below target';
          return 'Sleep quality is showing up in your data. Last night: <strong>' + sleep + '</strong> (Health Connect). On low-HRV days your pickup count runs <strong>15–20%</strong> higher than average — and that\'s exactly what\'s happening today. Your focus sessions are your best defence on days like this.';
        },
        followUps: ['How does sleep affect my phone use?', 'What should I do differently tonight?', 'What does my HRV tell me?']
      }
    ],

    // ── HC_ACTIVE_DAY_BETTER_FOCUS ─────────────────────────────────────
    HC_ACTIVE_DAY_BETTER_FOCUS: [
      {
        text: function(s) {
          var steps = s.stepsToday ? s.stepsToday.toLocaleString() : '8,000+';
          return 'You\'ve logged <strong>' + steps + ' steps</strong> today (Health Connect). On days when your step count exceeds 8,000 your screen time tends to run <strong>10–15%</strong> below goal and focus session completion is higher. Physical activity and focused phone use are correlated in your 7-day pattern. Keep it going.';
        },
        followUps: ['What else helps my focus?', 'Do active days improve my score?', "What's my best habit right now?"]
      }
    ],

    // ── GENERAL_SUMMARY ────────────────────────────────────────────────
    GENERAL_SUMMARY: [
      {
        text: function(s) {
          // FIX: new-user no-data state
          if (s.dataWindowDays < 3) {
            return 'Aurelo is still building your baseline — I need at least a few days of data to give you personalised insights. <strong>Keep using the app normally</strong> and check back in a day or two. In the meantime: set a daily goal, try a focus session, and let Aurelo learn your patterns.';
          }
          var greeting = s.userName ? 'Here\'s your week, <strong>' + s.userName + '</strong>: ' : 'Here\'s your week: ';
          var hcLine = s.hcConnected ? ' Health Connect is active.' : '';
          return greeting + 'Aurelo Score <strong>' + s.aureloScore + '</strong>, Screen Score <strong>' + s.screenScore + '</strong>, Focus Score <strong>' + s.focusScore + '</strong>, Sleep Score <strong>' + s.sleepScore + '</strong>.' + hcLine + ' Best day was <strong>' + s.bestDay + '</strong> (' + _fmtMins(s.bestDayMinutes) + '), worst was <strong>' + s.worstDay + '</strong> (' + _fmtMins(s.worstDayMinutes) + '). You\'ve got a <strong>' + s.streakDays + '-day streak</strong>. Biggest opportunity: ' + (s.firstUseHour < 9 ? 'delay your morning first-use to 9 AM' : s.focusSessionsCompleted < 3 ? 'complete more focus sessions' : 'reduce your ' + s.worstDay + ' usage spike') + '.';
        },
        followUps: ['What should I work on first?', 'How close am I to Excellent?', "What's my best habit this week?"]
      }
    ],

    // ── HEALTHY_PATTERN ────────────────────────────────────────────────
    HEALTHY_PATTERN: [
      {
        text: function(s) {
          var hcLine = s.hcConnected && s.stepsToday && s.stepsToday >= 8000
            ? ' Your <strong>' + (s.stepsToday || 0).toLocaleString() + ' steps</strong> today (Health Connect) reinforce the pattern — active days and lower screen time go together for you.'
            : '';
          return 'Your strongest habit right now is the <strong>' + s.streakDays + '-day streak</strong> — that\'s real consistency. Your Screen Score of <strong>' + s.screenScore + '</strong> shows you\'re managing goal adherence well. The ' + s.focusSessionsCompleted + ' focus session' + (s.focusSessionsCompleted === 1 ? '' : 's') + ' this week is solid.' + hcLine + ' Keep the morning routine going — first-use timing is your clearest lever.';
        },
        followUps: ['How do I build on this?', 'How is my streak looking?', 'How close am I to Excellent?']
      }
    ],

    // ── NEW: APP_DEEP_DIVE ─────────────────────────────────────────────
    APP_DEEP_DIVE: [
      {
        text: function(s) {
          var topApp = (s.topApps && s.topApps[0]) || 'your top app';
          // We don't have per-app breakdown in the summary, but we have topApps list + total
          // Give useful framing with what we have
          return '<strong>' + topApp + '</strong> is your most-used app this period. It\'s in your <strong>' + (s.topCategory || 'top') + '</strong> category, which is leading your screen time. ' +
                 'Total screen time today: <strong>' + _fmtMins(s.todayMinutes) + '</strong>. ' +
                 'To see a full per-app breakdown, go to <strong>Wellness → Today → All Apps</strong>. ' +
                 'Adding a <strong>Mindful Pause</strong> or <strong>App Timer</strong> on ' + topApp + ' is the fastest way to directly cut time on it.';
        },
        followUps: ['How do I add a mindful pause?', 'Am I on social media too much?', 'Do I have a dopamine loop?']
      }
    ],

    // ── NEW: FEATURE_EXPLANATION ───────────────────────────────────────
    FEATURE_EXPLANATION: [
      {
        text: function(s) {
          return 'Happy to explain. Here are the key concepts in Aurelo:<br><br>' +
                 '<strong>Aurelo Score (0–100):</strong> Your daily composite — Screen (40%) + Focus (35%) + Sleep (25%). Excellent = 85+.<br>' +
                 '<strong>Screen Score:</strong> Goal adherence (50%), pickup count (30%), first-use time (20%).<br>' +
                 '<strong>Focus Score:</strong> Sessions completed, app timers, and mindful pauses.<br>' +
                 '<strong>Sleep Score (Pro):</strong> Bedtime adherence minus snoozes and blocked-app attempts.<br>' +
                 '<strong>Streak:</strong> Consecutive days you stayed under your daily screen time goal.<br>' +
                 '<strong>Revenge procrastination:</strong> Using your phone late at night to reclaim personal time — at the cost of sleep.<br>' +
                 '<strong>Mindful Pause:</strong> A 10-second intention check before a chosen app opens, breaking the automatic habit loop.<br>' +
                 'Ask me about any specific one for more detail.';
        },
        followUps: ['How do I reach Excellent?', "What's my session completion rate?", 'Why do I use my phone at night?']
      }
    ],

    // ── NEW: GOAL_SETTING_ADVICE ───────────────────────────────────────
    GOAL_SETTING_ADVICE: [
      {
        text: function(s) {
          var days = (s.screenTime7Day || []);
          var minutes = days.map(function(d) { return typeof d === 'object' ? (d.minutes || 0) : (d || 0); });
          var active = minutes.filter(function(m) { return m > 0; });
          var avg7 = active.length
            ? Math.round(active.reduce(function(a,b){return a+b;},0) / active.length)
            : s.todayMinutes;
          var currentGoal = _fmtMins(s.dailyGoalMinutes);
          var suggestion = '';
          if (avg7 > s.dailyGoalMinutes * 1.3) {
            suggestion = 'Your 7-day average is <strong>' + _fmtMins(avg7) + '</strong> — significantly above your <strong>' + currentGoal + '</strong> goal. Consider stepping up to a more achievable goal first (e.g. ' + _fmtMins(Math.round(avg7 * 0.9 / 30) * 30) + '), then tightening it over weeks.';
          } else if (avg7 < s.dailyGoalMinutes * 0.6) {
            suggestion = 'Your 7-day average is <strong>' + _fmtMins(avg7) + '</strong> — well under your <strong>' + currentGoal + '</strong> goal. You could tighten it to ' + _fmtMins(Math.round(avg7 * 1.15 / 30) * 30) + ' for a more motivating challenge.';
          } else {
            suggestion = 'Your current goal of <strong>' + currentGoal + '</strong> looks well-matched to your 7-day average of <strong>' + _fmtMins(avg7) + '</strong>. Stick with it — the consistency is what builds the streak.';
          }
          return 'Goal-setting advice: ' + suggestion + ' You can adjust your goal in <strong>Settings → Daily Goal</strong> at any time — it takes effect immediately.';
        },
        followUps: ['How do I change my goal?', 'How does my goal affect my score?', "What's my weekly average?"]
      }
    ],

    // ── UNKNOWN fallback ───────────────────────────────────────────────
    UNKNOWN: [
      {
        text: function(s) {
          var hcNote = s.hcConnected ? ' + Health Connect data' : '';
          return 'I don\'t have a specific insight for that — but here\'s what stands out today: <strong>' + s.worstDay + '</strong> was your heaviest day at <strong>' + _fmtMins(s.worstDayMinutes) + '</strong>, your streak is at <strong>' + s.streakDays + ' day' + (s.streakDays === 1 ? '' : 's') + '</strong>, and your Focus Score of <strong>' + s.focusScore + '</strong> has room to grow. Based on ' + s.dataWindowDays + ' days of screen data' + hcNote + '.';
        },
        followUps: ['Tell me about my worst day', "How's my streak looking?", 'How do I improve focus?']
      }
    ]
  },

  get: function(intent, summary) {
    var pool = this.templates[intent] || this.templates['UNKNOWN'];
    var template = pool[Math.floor(Math.random() * pool.length)];
    var followUps = typeof template.followUps === 'function'
      ? template.followUps(summary)
      : (template.followUps || []);
    return {
      text:      template.text(summary),
      followUps: followUps
    };
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 7. CHIP GENERATOR — updated with score-improvement and perfect-day chips
 * ───────────────────────────────────────────────────────────────────────── */
var ChipGenerator = {
  generate: function(summary) {
    var chips = [];
    var hour = summary.currentHour || 14;

    // FIX: zero-data state — fresh installs / no usage permission yet have
    // no meaningful chips to surface. Return a single onboarding-flavoured
    // chip that routes to the FEATURE_EXPLANATION welcome copy instead of
    // the misleading "What's my Tuesday pattern?" default.
    var noData = !summary.aureloScore && !summary.todayMinutes && !summary.pickupsToday;
    if (noData || summary.dataWindowDays < 3) {
      chips.push({ label: 'What can Aurelo help me with?', intent: CoachIntent.FEATURE_EXPLANATION });
      chips.push({ label: 'How does the score work?',      intent: CoachIntent.FEATURE_EXPLANATION });
      return chips;
    }

    // FIX: direction-aware score chip
    var scoreDelta = (summary.aureloScore || 0) - (summary.aureloScoreYesterday || 0);
    if (scoreDelta < -4) {
      chips.push({ label: 'Why did my score drop ' + Math.abs(scoreDelta) + ' pts?', intent: CoachIntent.SCORE_DROP });
    } else if (scoreDelta > 4) {
      chips.push({ label: 'My score improved ' + scoreDelta + ' pts — what worked?', intent: CoachIntent.PRODUCTIVE_DAY });
    }

    // Streak at risk
    var rate = hour > 0 ? summary.todayMinutes / hour : 0;
    var projected = summary.todayMinutes + rate * (24 - hour);
    if (projected > summary.dailyGoalMinutes * 0.85 && summary.streakDays > 3) {
      chips.push({ label: 'Is my ' + summary.streakDays + '-day streak safe?', intent: CoachIntent.STREAK_AT_RISK });
    }

    // HC chips
    if (summary.hcConnected && summary.hrv7DayAvg && summary.hrvToday &&
        summary.hrvToday < summary.hrv7DayAvg * 0.80) {
      chips.push({ label: 'How did poor sleep affect my usage today?', intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE });
    }
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
    if (_isSocialDominant(summary.topCategory) && summary.pickupsToday > summary.pickups7DayAvg * 1.2) {
      chips.push({ label: 'Why do I keep opening ' + (summary.topApps && summary.topApps[0] || 'social apps') + '?', intent: CoachIntent.DOPAMINE_LOOP });
    }

    // FIX: perfect-day chip
    var isPerfect = (
      summary.focusSessionsCompleted >= 3 &&
      summary.firstUseHour >= 9 &&
      summary.todayMinutes <= summary.dailyGoalMinutes * 0.7
    );
    if (isPerfect) {
      chips.push({ label: "Today's looking great — what's working?", intent: CoachIntent.PRODUCTIVE_DAY });
    }

    // Default day-of-week chip
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    chips.push({ label: "What's my " + days[new Date().getDay()] + ' pattern?', intent: CoachIntent.GENERAL_SUMMARY });

    return chips.slice(0, 3);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 8. STATIC CATEGORY QUESTIONS — all routing fixes applied
 * ───────────────────────────────────────────────────────────────────────── */
var CATEGORY_QUESTIONS = {
  score: [
    // FIX: routing is now handled dynamically by CoachOrchestrator.handleQuery
    // based on score direction — labels are the same, logic is in orchestrator
    { label: 'Why did my score change?',        intent: CoachIntent.SCORE_DROP },
    { label: 'How do I reach Excellent?',        intent: CoachIntent.PRODUCTIVE_DAY },
    { label: "What's dragging my score down?",   intent: CoachIntent.SCORE_DROP },
    { label: "What's going well this week?",     intent: CoachIntent.HEALTHY_PATTERN },
  ],
  habits: [
    { label: 'Do I have a dopamine loop?',            intent: CoachIntent.DOPAMINE_LOOP },
    // FIX: "What triggers my phone use?" — use MORNING_DOOM_SCROLL as base,
    // orchestrator.handleQuery() will reroute based on actual top trigger
    { label: 'What triggers my phone use?',            intent: CoachIntent.MORNING_DOOM_SCROLL },
    { label: 'Am I on social media too much?',         intent: CoachIntent.SOCIAL_SPIRAL },
    { label: "What's my best habit right now?",        intent: CoachIntent.HEALTHY_PATTERN },
  ],
  sleep: [
    { label: 'Why do I use my phone at night?',          intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION },
    { label: 'How does sleep affect my usage?',          intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE },
    // FIX: bedtime routine question — routed conditionally in handleQuery
    { label: "How's my bedtime routine?",                intent: CoachIntent.BEDTIME_REVENGE_PROCRASTINATION },
    { label: 'What does my HRV tell me?',                intent: CoachIntent.HC_POOR_SLEEP_HIGH_USAGE },
    { label: 'Am I active enough?',                      intent: CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS },
    { label: 'What is revenge procrastination?',         intent: CoachIntent.FEATURE_EXPLANATION },
  ],
  focus: [
    { label: "Why can't I focus?",                      intent: CoachIntent.FOCUS_BURNOUT },
    // FIX: active-user path handled in FOCUS_GAP template
    { label: 'How are my focus sessions going?',         intent: CoachIntent.FOCUS_GAP },
    // FIX: completion rate — handled in FOCUS_GAP template
    { label: "What's my session completion rate?",       intent: CoachIntent.FOCUS_GAP },
    // FIX: FOCUS_PEAK_TIME is now a real intent
    { label: 'When is my most focused time?',            intent: CoachIntent.FOCUS_PEAK_TIME },
  ],
};

/* ─────────────────────────────────────────────────────────────────────────
 * 9. FREE / PRO QUERY GATE (spec §20)
 * ───────────────────────────────────────────────────────────────────────── */
var QueryGate = {
  FREE_LIMIT: 3,
  _todayKey: function() {
    var d = new Date();
    return '' + d.getFullYear() + ('0'+(d.getMonth()+1)).slice(-2) + ('0'+d.getDate()).slice(-2);
  },
  getStatus: function() {
    if (typeof ProTier !== 'undefined' && ProTier.isPro) {
      return { count: 0, limitReached: false };
    }
    if (IS_NATIVE_COACH) {
      try {
        var raw = _bridgeCall('getCoachQueryCount');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (typeof parsed.limitReached !== 'undefined') return parsed;
        }
      } catch (_) {}
    }
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
 * 10. COACH ORCHESTRATOR — enhanced routing logic
 * ───────────────────────────────────────────────────────────────────────── */
var CoachOrchestrator = {
  CONFIDENCE_THRESHOLD: 0.3,

  classifyIntent: function(query) {
    // Phase 3: if (GeminiNano.isAvailable()) return GeminiNano.classify(query);
    // Phase 2: if (TinyBERT.isAvailable())   return TinyBERT.classify(query);
    return KEYWORD_CLASSIFIER.classify(query); // Phase 1
  },

  /* ── History surface framing ─────────────────────────────────────────────
   * When Coach is opened from Score History, we inject a lightweight
   * contextual header above the normal response so the answer is framed
   * in historical terms rather than today's real-time data.
   *
   * ctx shape (from CoachUI._context):
   *   { surface:'score_history', pillar, window, avg, trend, above70, total }
   *
   * This is the ONLY place surface context affects output — intents and
   * templates are unchanged.  Adding a new surface in future requires only
   * a new branch here and a matching _applyXxxFrame helper.
   * ─────────────────────────────────────────────────────────────────────── */
  _applyHistoryFrame: function(response, ctx) {
    if (!response || !response.text) return response;

    var PILLAR_LABELS = { aurelo:'Aurelo', screen:'Screen', focus:'Focus', sleep:'Sleep', body:'Body' };
    var WINDOW_LABELS = { '7D':'7-day', '30D':'30-day', '90D':'90-day', '1Y':'annual' };

    var pillarLabel  = PILLAR_LABELS[ctx.pillar]  || ctx.pillar;
    var windowLabel  = WINDOW_LABELS[ctx.window]  || ctx.window;
    var hasAvg       = ctx.avg !== null && ctx.avg !== undefined;
    var trendSign    = ctx.trend > 0 ? '+' : '';
    var trendStr     = (ctx.trend !== 0) ? (', trending ' + trendSign + ctx.trend + ' pts') : '';

    /* Build the small framing pill shown above the coach response */
    var frameHtml =
      '<div style="'
        + 'display:inline-flex;align-items:center;gap:6px;'
        + 'padding:4px 10px;border-radius:20px;margin-bottom:10px;'
        + 'background:rgba(108,99,255,0.07);border:1px solid rgba(108,99,255,0.18);'
        + 'font-family:var(--ff-m);font-size:11px;color:var(--t3)">'
        + '✦ ' + windowLabel + ' ' + pillarLabel + ' history'
        + (hasAvg ? ' · avg ' + ctx.avg : '')
        + trendStr
      + '</div><br>';

    return Object.assign({}, response, { text: frameHtml + response.text });
  },

  /** Dynamic routing for predefined questions that need data-driven intent selection. */
  _resolveDynamicIntent: function(query, summary) {
    var q = query.toLowerCase().trim();

    // FIX: "How do I reach Excellent?" — when score ≥85, give maintenance advice via
    // HEALTHY_PATTERN rather than celebrating in PRODUCTIVE_DAY.
    if (q.indexOf('reach excellent') !== -1 || q.indexOf('get to excellent') !== -1) {
      return (summary.aureloScore || 0) >= 85
        ? CoachIntent.HEALTHY_PATTERN
        : CoachIntent.PRODUCTIVE_DAY;
    }

    // FIX: "Why did my score change?" — direction-aware with no-baseline guard.
    if (q.indexOf('score change') !== -1 || q.indexOf('why did my score') !== -1) {
      var ys = summary.aureloScoreYesterday || 0;
      if (ys <= 0) return CoachIntent.GENERAL_SUMMARY;
      var delta = (summary.aureloScore || 0) - ys;
      if (delta < 0) return CoachIntent.SCORE_DROP;
      if (delta === 0) return CoachIntent.HEALTHY_PATTERN;
      return CoachIntent.PRODUCTIVE_DAY;
    }

    // FIX: "What's dragging my score down?" — pillar-aware with a no-drag guard
    // so the response doesn't fabricate a problem on a great-score day.
    if (q.indexOf("dragging my score") !== -1 || q.indexOf("what's dragging") !== -1) {
      var noDrag = (summary.aureloScore || 0) >= 80 &&
                   (summary.screenScore || 0) >= 65 &&
                   (summary.focusScore  || 0) >= 65 &&
                   (summary.sleepScore  || 0) >= 65;
      if (noDrag) return CoachIntent.HEALTHY_PATTERN;
      var allZero = !(summary.screenScore || summary.focusScore || summary.sleepScore);
      if (allZero) return CoachIntent.GENERAL_SUMMARY;
      var fs = summary.focusScore || 0;
      if (fs > 0 && fs < 60) return CoachIntent.FOCUS_GAP;
      if ((summary.firstUseHour || 9) < 8) return CoachIntent.MORNING_DOOM_SCROLL;
      return CoachIntent.SCORE_DROP;
    }

    // FIX: "What triggers my phone use?" — diagnostic, uses ANOMALOUS_SPIKE in high-pickup
    // case to avoid overlap with "Do I have a dopamine loop?" → DOPAMINE_LOOP.
    if (q.indexOf('triggers my phone') !== -1 || q.indexOf('trigger my phone') !== -1) {
      if ((summary.firstUseHour || 9) < 8) return CoachIntent.MORNING_DOOM_SCROLL;
      if (_isSocialDominant(summary.topCategory)) return CoachIntent.SOCIAL_SPIRAL;
      if (summary.pickupsToday > summary.pickups7DayAvg * 1.3) return CoachIntent.ANOMALOUS_SPIKE;
      return CoachIntent.MORNING_DOOM_SCROLL;
    }

    // FIX: data-guarded predefined questions — don't force a negative diagnosis
    // on users whose data doesn't support it.
    if (q.indexOf('am i on social media too much') !== -1 ||
        q.indexOf('social media too much') !== -1) {
      return _isSocialDominant(summary.topCategory)
        ? CoachIntent.SOCIAL_SPIRAL : CoachIntent.HEALTHY_PATTERN;
    }
    if (q.indexOf('do i have a dopamine loop') !== -1 || q === 'dopamine loop') {
      var avgPick = summary.pickups7DayAvg || 0;
      if (avgPick > 0 && summary.pickupsToday < avgPick) return CoachIntent.HEALTHY_PATTERN;
      return CoachIntent.DOPAMINE_LOOP;
    }
    if (q.indexOf("why can't i focus") !== -1 || q.indexOf('why cant i focus') !== -1) {
      if ((summary.focusSessionsCompleted || 0) > 0 &&
          (summary.focusSessionsFail || 0) === 0) return CoachIntent.PRODUCTIVE_DAY;
      return CoachIntent.FOCUS_BURNOUT;
    }
    if (q.indexOf('why do i use my phone at night') !== -1 ||
        q.indexOf('phone at night') !== -1) {
      return (summary.sleepScore || 0) >= 75
        ? CoachIntent.HEALTHY_PATTERN
        : CoachIntent.BEDTIME_REVENGE_PROCRASTINATION;
    }

    // FIX: bedtime-routine routing — poor adherence routes to
    // BEDTIME_REVENGE_PROCRASTINATION whose templates actually discuss
    // Bedtime Mode setup and adherence, not RECOVERY_DAY which talks about
    // "yesterday was tough" — unrelated to a user asking about their routine.
    if (q.indexOf("bedtime routine") !== -1) {
      if ((summary.sleepScore || 0) >= 75) return CoachIntent.HEALTHY_PATTERN;
      return CoachIntent.BEDTIME_REVENGE_PROCRASTINATION;
    }

    // FIX: "What's my session completion rate?" — always shows stat.
    // Routes to PRODUCTIVE_DAY (positive stat view) when sessions exist,
    // FOCUS_GAP when no sessions — distinct from "How are my focus sessions going?"
    // which always routes to FOCUS_GAP.
    if (q.indexOf('session completion rate') !== -1 || q.indexOf('what\'s my session completion') !== -1 ||
        q.indexOf('completion rate') !== -1) {
      var hasSessions = (summary.focusSessionsCompleted || 0) > 0 || (summary.focusSessionsInterrupted || 0) > 0;
      return hasSessions ? CoachIntent.PRODUCTIVE_DAY : CoachIntent.FOCUS_GAP;
    }

    if (q.indexOf('focus sessions going') !== -1) {
      return CoachIntent.FOCUS_GAP;
    }

    // FIX: "When is my most focused time?" → FOCUS_PEAK_TIME
    if (q.indexOf('most focused time') !== -1 || q.indexOf('most focused') !== -1 ||
        q.indexOf('best time to focus') !== -1) {
      return CoachIntent.FOCUS_PEAK_TIME;
    }

    // FIX: HC questions key off the actual signal availability, not just
    // hcConnected — a user with HC connected for steps but no HRV grant should
    // still get the "please grant HRV" explanation.
    var hasHrv   = summary.hcConnected && summary.hrvToday != null && summary.hrv7DayAvg && summary.hrv7DayAvg > 0;
    var hasSleep = summary.hcConnected && summary.sleepDurationMinutes != null && summary.sleepDurationMinutes > 0;
    var hasSteps = summary.hcConnected && summary.stepsToday != null && summary.stepsToday > 0;
    if ((q.indexOf('hrv') !== -1 || q.indexOf('heart rate variability') !== -1) && !hasHrv) {
      return '_HC_MISSING_HRV';
    }
    if ((q.indexOf('active enough') !== -1 || q.indexOf('am i active') !== -1 || q.indexOf('steps') !== -1) && !hasSteps) {
      return '_HC_MISSING_STEPS';
    }
    if ((q.indexOf('sleep affect') !== -1 || q.indexOf('sleep affect my phone') !== -1) && !hasSleep) {
      return '_HC_MISSING_SLEEP';
    }

    // ── Unrouted chip labels — dynamic overrides ─────────────────────────────

    // STREAK_AT_RISK group
    if (q.indexOf('protect my streak') !== -1 || q.indexOf('protect streak') !== -1 ||
        q.indexOf('riskiest time') !== -1 || q.indexOf('risky time') !== -1 ||
        q.indexOf('do right now') !== -1 || q.indexOf('what should i do right now') !== -1 ||
        q.indexOf('how many minutes do i have left') !== -1) {
      return CoachIntent.STREAK_AT_RISK;
    }

    // RECOVERY_DAY group
    if (q.indexOf('recover today') !== -1 || q.indexOf('how do i recover') !== -1 ||
        q.indexOf('how am i trending') !== -1 || q.indexOf('trending this week') !== -1) {
      return CoachIntent.RECOVERY_DAY;
    }

    // BEDTIME group
    if (q.indexOf('do tonight') !== -1 || q.indexOf('differently tonight') !== -1 ||
        q.indexOf('time should i stop') !== -1 || q.indexOf('time to stop') !== -1) {
      return CoachIntent.BEDTIME_REVENGE_PROCRASTINATION;
    }

    // FOCUS_GAP group
    if (q.indexOf('improve focus') !== -1 || q.indexOf('improve my focus') !== -1 ||
        q.indexOf('helps my focus') !== -1 || q.indexOf('what else helps') !== -1 ||
        q.indexOf('start a focus session') !== -1 || q.indexOf('start focus session') !== -1 ||
        q.indexOf('how do i start a focus') !== -1) {
      return CoachIntent.FOCUS_GAP;
    }

    // SOCIAL_SPIRAL group
    if (q.indexOf('social limit') !== -1 || q.indexOf('healthy social') !== -1 ||
        q.indexOf('which social apps') !== -1) {
      return CoachIntent.SOCIAL_SPIRAL;
    }

    // DOPAMINE_LOOP group
    if (q.indexOf('instead of checking') !== -1 || q.indexOf('what should i do instead') !== -1) {
      return CoachIntent.DOPAMINE_LOOP;
    }

    // HEALTHY_PATTERN group
    if (q.indexOf('build on this') !== -1 || q.indexOf('best habit this week') !== -1 ||
        q.indexOf('best habit right now') !== -1) {
      return CoachIntent.HEALTHY_PATTERN;
    }

    // GENERAL_SUMMARY group
    if (q.indexOf('focus on next') !== -1 || q.indexOf('what should i focus on') !== -1 ||
        q.indexOf('weekly pattern') !== -1 || q.indexOf('weekly average') !== -1 ||
        q.indexOf('my weekly') !== -1) {
      return CoachIntent.GENERAL_SUMMARY;
    }

    // ANOMALOUS_SPIKE group
    if (q.indexOf('worst day') !== -1 || q.indexOf('tell me about my worst') !== -1) {
      return CoachIntent.ANOMALOUS_SPIKE;
    }

    // SCORE_DROP group
    if (q.indexOf('causing this') !== -1 || q.indexOf("what's causing") !== -1) {
      return CoachIntent.SCORE_DROP;
    }

    // FEATURE_EXPLANATION group
    if (q.indexOf('health connect') !== -1 || q.indexOf('focus schedule') !== -1 ||
        q.indexOf('first-use time') !== -1 || q.indexOf('first use time') !== -1 ||
        q.indexOf('how many pickups') !== -1 || q.indexOf('normal pickups') !== -1 ||
        q.indexOf('why does the pause') !== -1 || q.indexOf('pause help') !== -1 ||
        q.indexOf('how do i add a mindful') !== -1 || q.indexOf('how does bedtime mode') !== -1 ||
        q.indexOf('sleep affect my score') !== -1 || q.indexOf('sleep affect score') !== -1) {
      return CoachIntent.FEATURE_EXPLANATION;
    }

    return null; // no dynamic override
  },

  handleQuery: function(query, summary, ctx) {
    // Dynamic intent resolution takes priority (handles predefined question special cases)
    var dynamicIntent = this._resolveDynamicIntent(query, summary);

    // HC-missing explanations — return immediately
    if (dynamicIntent === '_HC_MISSING_HRV') {
      return { intent: CoachIntent.UNKNOWN, response: _hcMissingResponse('Heart Rate Variability (HRV)',
        'Your Bedtime Mode sleep score and streak are still available without Health Connect.'), confidence: 1, usedFallback: false };
    }
    if (dynamicIntent === '_HC_MISSING_STEPS') {
      return { intent: CoachIntent.UNKNOWN, response: _hcMissingResponse('Daily Steps',
        'Your screen time and focus patterns already show a lot about your activity habits.'), confidence: 1, usedFallback: false };
    }
    if (dynamicIntent === '_HC_MISSING_SLEEP') {
      return { intent: CoachIntent.UNKNOWN, response: _hcMissingResponse('Sleep data',
        'If you have Bedtime Mode enabled, your Sleep Score shows last night\'s bedtime adherence.'), confidence: 1, usedFallback: false };
    }

    var response, intent, confidence, usedFallback;

    if (dynamicIntent) {
      intent       = dynamicIntent;
      response     = TemplateLibrary.get(dynamicIntent, summary);
      confidence   = 1.0;
      usedFallback = false;
    } else {
      var classified = this.classifyIntent(query);
      intent     = classified.intent;
      confidence = classified.confidence;

      // HC-only intents — redirect when HC not connected
      var HC_ONLY = [CoachIntent.HC_POOR_SLEEP_HIGH_USAGE, CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS];
      if (HC_ONLY.indexOf(intent) !== -1 && !summary.hcConnected) {
        intent       = CoachIntent.GENERAL_SUMMARY;
        response     = TemplateLibrary.get(CoachIntent.GENERAL_SUMMARY, summary);
        confidence   = confidence;
        usedFallback = true;
      } else if (confidence < this.CONFIDENCE_THRESHOLD || intent === CoachIntent.UNKNOWN) {
        // Low confidence — graceful fallback with top detected pattern
        var topPattern = PatternDetector.getTopPattern(summary);
        var hcNote     = summary.hcConnected ? ' + Health Connect data' : '';
        var fallbackR  = TemplateLibrary.get(topPattern.intent, summary);
        response = {
          text: "I don't have a specific insight for that — but here's what stands out in your data: " +
                fallbackR.text +
                "<br><br><small>Based on " + summary.dataWindowDays + " days of screen data" + hcNote + ".</small>",
          followUps: ChipGenerator.generate(summary).map(function(c) { return c.label; })
        };
        intent       = CoachIntent.UNKNOWN;
        usedFallback = true;
      } else {
        response     = TemplateLibrary.get(intent, summary);
        usedFallback = false;
      }
    }

    /* Apply surface framing when the query came from a named surface.
     * New surfaces: add an _applyXxxFrame branch here — no other changes needed. */
    if (ctx && ctx.surface === 'score_history' && response) {
      response = this._applyHistoryFrame(response, ctx);
    }

    return { intent: intent, response: response, confidence: confidence, usedFallback: usedFallback };
  }
};

/* ─────────────────────────────────────────────────────────────────────────
 * 11. EXPORTS
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
 * 12. COACH UI  (unchanged from original — all UI logic preserved)
 * ───────────────────────────────────────────────────────────────────────── */
window.CoachUI = {
  _summary:     null,
  _loading:     false,
  _initialised: false,
  /* Surface context — set by open(prefilled, ctx), consumed on first send.
   * Shape: { surface, pillar, window, avg, trend, above70, total }
   * null when Coach is opened without a surface context (FAB tap, etc.). */
  _context:     null,

  init: function() {
    try {
      this._summary = AureloCoach.loadUsageSummary();
      this._renderChips();
      this._renderCatTab('score');
      this._renderTransparency();
      this._initFabDrag();
      this._initFabIcon();
      // FIX: personalised greeting using userName
      this._renderGreeting();
      this._initialised = true;
    } catch (e) {
      console.error('[CoachUI] init error:', e);
      if (!this._summary) this._summary = AureloCoach.buildMockUsageSummary();
      this._initialised = true;
    }
  },

  // FIX: show personalised greeting when userName is set
  _renderGreeting: function() {
    var s = this._summary;
    if (!s || !s.userName) return;
    var introEl = document.getElementById('coach-intro');
    if (!introEl) return;
    var greetEl = introEl.querySelector('.coach-intro-greeting');
    if (greetEl) {
      greetEl.textContent = 'Hi ' + s.userName + ' — ask me anything about your habits.';
    }
  },

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

  open: function(prefilled, ctx) {
    try {
      if (!this._initialised) this.init();
      /* Store surface context for the first send — cleared after use so
       * subsequent free-form questions in the same session run normally. */
      this._context = ctx || null;
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

  openInsight: function(title, body, followUps) {
    try {
      if (!this._initialised) this.init();
      var modal = document.getElementById('coach-modal');
      if (modal) modal.classList.add('open');
      var safeTitle = this._escapeHtml(title || 'Your daily insight');
      var safeBody  = this._escapeHtml(body || '').replace(/\n/g, '<br>');
      var html = '<strong>' + safeTitle + '</strong>' + (safeBody ? '<br><br>' + safeBody : '');
      var self = this;
      setTimeout(function() {
        self._hideIntroAndChips();
        self._addCoachMsg(html, followUps || []);
      }, 180);
    } catch (e) {
      console.error('[CoachUI] openInsight error:', e);
      this.open(null);
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

    /* Consume the surface context on the first send so follow-up
     * free-form questions in the same session run without historical
     * framing (which would be confusing after the first exchange). */
    var ctx = this._context;
    this._context = null;

    var self = this;
    setTimeout(function() {
      try {
        var result = null;

        /* When a surface context is present the JS orchestrator must handle
         * the query — AppBridge operates on today's data only and cannot
         * apply historical framing. For all other queries try AppBridge first
         * as usual. */
        if (!ctx && window.AppBridge && typeof window.AppBridge.askCoach === 'function') {
          console.log('[CoachJS] calling AppBridge.askCoach:', query);
          var raw = window.AppBridge.askCoach(query);
          console.log('[CoachJS] AppBridge coach response:', raw);
          if (raw) result = JSON.parse(raw);
        }

        if (!result) {
          console.log('[CoachJS] using JS orchestrator' + (ctx ? ' (surface: ' + ctx.surface + ')' : ''));
          var fallback = AureloCoach.CoachOrchestrator.handleQuery(query, self._summary, ctx);
          result = {
            intent:      fallback.intent,
            response:    fallback.response,
            confidence:  fallback.confidence,
            usedFallback: fallback.usedFallback
          };
        }

        self._removeTyping();
        if (result.response) {
          self._addCoachMsg(result.response.text, result.response.followUps || []);
        } else {
          var html = result.title
            ? '<strong>' + result.title + '</strong><br><br>' + result.body
            : result.body;
          self._addCoachMsg(html, result.followUps || []);
        }
        self._hideIntroAndChips();
        // FIX: don't burn a query against the free daily limit when the
        // response was an explicit error fallback (bridge timeout, HC failure,
        // etc.) — those aren't useful answers and shouldn't count.
        var src = result && (result.source || (result.response && result.response.source)) || '';
        var isErrorFallback = src === 'error' || (result && result.usedFallback === true && !result.intent);
        if (!isErrorFallback) {
          AureloCoach.QueryGate.increment();
        }
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
    if (isPro) return;
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
         CoachUI.close();
         if (typeof ProTier !== 'undefined' && typeof ProTier.triggerUpsell === 'function') {
              ProTier.triggerUpsell('COACH');
                  setTimeout(function() {
                    ProTier.triggerUpsell('COACH_UPGRADE');
                  }, 150);
              }
         });
      lastBubble.appendChild(btn);
      }
    }
  },

  _escapeHtml: function(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

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
    var s = this._summary;
    // FIX: filter HC questions only if HC not connected
    if (s && !s.hcConnected) {
      qs = qs.filter(function(q) {
        return q.intent !== CoachIntent.HC_POOR_SLEEP_HIGH_USAGE &&
               q.intent !== CoachIntent.HC_ACTIVE_DAY_BETTER_FOCUS;
      });
    }
    // FIX P3-08: filter BEDTIME_REVENGE_PROCRASTINATION chips from the Sleep tab when
    // Bedtime Mode is not enabled (sleepScore <= 0). Without this guard, chips like
    // "Why do I use my phone at night?" and "How's my bedtime routine?" appeared and
    // fired a behavioural diagnosis for a routine the user has never set up.
    // The P1-02 fix routes these to FEATURE_EXPLANATION when sleepScore <= 0, but hiding
    // the misleading chip labels here is a cleaner user experience.
    if (tab === 'sleep' && s && (s.sleepScore === undefined || s.sleepScore <= 0)) {
      qs = qs.filter(function(q) {
        return q.intent !== CoachIntent.BEDTIME_REVENGE_PROCRASTINATION;
      });
      // Surface a feature-introduction chip in place of the removed behaviour chips
      // so the Sleep tab still has useful content for new users.
      qs = [{ label: 'What is Bedtime Mode?', intent: CoachIntent.FEATURE_EXPLANATION }].concat(qs);
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

  _renderTransparency: function() {
    var s = this._summary;
    if (!s) return;
    var container = document.querySelector('.coach-transparency-sheet');
    if (!container) return;
    var hcRows = '';
    if (s.hcConnected) {
      // FIX P3-07: hardcoded "7 days" was inaccurate on Days 1–6 when the user has
      // less than a week of HC history. Compute the actual window from summary.dataWindowDays,
      // capped at 7 since that's the maximum Aurelo uses for rolling averages.
      var hcDays = Math.min(7, (s.dataWindowDays && s.dataWindowDays > 0) ? s.dataWindowDays : 1);
      var hcDaysLabel = hcDays + ' day' + (hcDays !== 1 ? 's' : '');
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
            '<div class="coach-data-meta">' + hcDaysLabel + '</div>' +
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
    var footer = container.querySelector('.coach-trans-privacy');
    if (footer) {
      footer.textContent = 'All analysis runs entirely on your device. No data' +
        (s.hcConnected ? ' — including your Health Connect signals —' : '') +
        ' is ever sent to any server. Aurelo Coach has no internet connection.';
    }
  },

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
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved = true;
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
      fab._touchFired = true;
      setTimeout(function() { fab._touchFired = false; }, 400);
      e.preventDefault();
    }, { passive: false });
    fab.addEventListener('click', function() {
      if (fab._touchFired) return;
      if (!moved) CoachUI.open(null);
    });
  }
};

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (typeof CoachUI !== 'undefined' && !CoachUI._initialised) { CoachUI.init(); }
  }, 300);
});