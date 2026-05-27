/* ═══════════════════════════════════════════════════════════════
   app-notif-sheet.js — Notification detail bottom sheets
   ---------------------------------------------------------------
   Handles rich detail sheets for coach, streak, success, goal,
   and recap notification types.
   Weekly recap has its own module (WeeklyRecap).

   Entry point:
     NotifSheet.open(notifObj)   — open sheet for a notification
     NotifSheet.close()          — dismiss

   Follows the app-weekly-recap.js pattern exactly.
   ═══════════════════════════════════════════════════════════════ */

var NotifSheet = (function () {
  'use strict';

  /* ── CSS variable helper ─────────────────────────────────────── */
  function _rgba(cssVar, a) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    var m;
    if ((m = raw.match(/^#([0-9a-f]{6})$/i))) {
      return 'rgba(' + parseInt(m[1].slice(0, 2), 16) + ',' +
                       parseInt(m[1].slice(2, 4), 16) + ',' +
                       parseInt(m[1].slice(4, 6), 16) + ',' + a + ')';
    }
    if ((m = raw.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/))) {
      return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')';
    }
    // Fallbacks per var
    var fb = { '--r':'220,38,38', '--g':'18,212,138', '--p':'108,99,255', '--a':'247,166,35' };
    return 'rgba(' + (fb[cssVar] || '108,99,255') + ',' + a + ')';
  }

  function _escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _escAttr(s) {
    return (s || '').replace(/'/g, "\\'");
  }

  /* ── Shared header ───────────────────────────────────────────── */
  function _hdr(eyebrow, title) {
    return '<div class="ns-hdr">'
      + '<div class="ns-hdr-left">'
        + '<div class="ns-eyebrow">' + eyebrow + '</div>'
        + '<div class="ns-hdr-title">' + _escHtml(title) + '</div>'
      + '</div>'
      + '<button class="ns-close-btn" onclick="NotifSheet.close()" aria-label="Close">✕</button>'
    + '</div>';
  }

  /* ── Arch SVG (Aurelo icon) ──────────────────────────────────── */
  function _archSvg(size) {
    size = size || 22;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 108 108" fill="none">'
      + '<defs><linearGradient id="nsArchGa" x1="28" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">'
        + '<stop offset="0%" stop-color="#FFE082"/>'
        + '<stop offset="55%" stop-color="#FFAA44"/>'
        + '<stop offset="100%" stop-color="#FF7020"/>'
      + '</linearGradient></defs>'
      + '<path d="M 22 88 C 22 88 30 30 54 20 C 78 30 86 88 86 88"'
        + ' stroke="url(#nsArchGa)" stroke-width="9" fill="none" stroke-linecap="round"/>'
      + '<circle cx="54" cy="20" r="6" fill="#FFE082"/>'
    + '</svg>';
  }

  /* ── Intent → follow-up query ────────────────────────────────── */
  function _intentQuery(intent) {
    var map = {
      STREAK_AT_RISK:                  'Is my streak safe today?',
      SCORE_DROP:                      'Why did my score drop?',
      HC_POOR_SLEEP_HIGH_USAGE:        'How did poor sleep affect my usage today?',
      HC_ACTIVE_DAY_BETTER_FOCUS:      'What happens on my active days?',
      FOCUS_GAP:                       "I haven't focused in a while — what should I do?",
      FOCUS_BURNOUT:                   "Why can't I focus today?",
      FOCUS_PEAK_TIME:                 'When is my most focused time?',
      MORNING_DOOM_SCROLL:             'How does morning phone use affect my day?',
      ANOMALOUS_SPIKE:                 'Tell me about my worst day this week',
      BEDTIME_REVENGE_PROCRASTINATION: 'Why do I use my phone at night?',
      PRODUCTIVE_DAY:                  'What is going well this week?',
      HEALTHY_PATTERN:                 "What's my best habit right now?",
      SOCIAL_SPIRAL:                   'Am I on social media too much?',
      DOPAMINE_LOOP:                   'Do I have a dopamine loop?',
      WEEKEND_BINGE:                   'How do I control weekend usage?',
      GENERAL_SUMMARY:                 'Tell me about my week',
    };
    return map[intent] || 'Tell me about my habits today';
  }

  /* ══════════════════════════════════════════════════════════════
     COACH SHEET
     Full insight body + optional HC badge + ask follow-up CTA
  ══════════════════════════════════════════════════════════════ */
  function _renderCoach(n) {
    // Try to load full insight from bridge; fall back to notification copy
    var insight = { title: n.title || 'Your Daily Insight', body: n.body || '', hcBadge: false, query: null };
    if (typeof window.AppBridge === 'object' && window.AppBridge) {
      try {
        var raw = window.AppBridge.getDailyCoachInsight();
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.title) {
            insight.title  = parsed.title;
            insight.body   = parsed.body   || n.body || '';
            insight.hcBadge = !!parsed.hcBadge;
            insight.query  = parsed.intent ? _intentQuery(parsed.intent) : null;
          }
        }
      } catch (_) {}
    }
    if (!insight.query) insight.query = 'Tell me about my habits today';

    var hcBadge = insight.hcBadge
      ? '<span class="ns-hc-badge">Health Connect</span>'
      : '';

    return _hdr('AURELO COACH · TODAY', insight.title)
      + '<div class="ns-body">'
        + '<div class="ns-coach-card">'
          + '<div class="ns-coach-card-hdr">'
            + '<div class="ns-coach-arch-icon">' + _archSvg(20) + '</div>'
            + '<span class="ns-coach-label">Aurelo Coach</span>'
            + hcBadge
          + '</div>'
          + '<div class="ns-coach-text">' + _escHtml(insight.body) + '</div>'
        + '</div>'
        + '<button class="ns-cta-btn" onclick="NotifSheet._coachFollowUp(\''
          + _escAttr(insight.query) + '\')">'
          + 'Ask follow\u2011up \u2192'
        + '</button>'
        + '<div class="ns-ondevice">'
          + '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">'
            + '<rect x="1" y="1" width="8" height="8" rx="1.5" stroke="#5C5278" stroke-width="1"/>'
            + '<path d="M3 5h4M3 3.5h2.5M3 6.5h2" stroke="#5C5278" stroke-width="0.8" stroke-linecap="round"/>'
          + '</svg>'
          + ' On\u2011device \xb7 Private'
        + '</div>'
        + '<div style="height:40px"></div>'
      + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     STREAK SHEET
     Big streak number, at-risk vs milestone variant, action CTA
  ══════════════════════════════════════════════════════════════ */
  function _renderStreak(n) {
    var body       = (n.body  || '');
    var title      = (n.title || 'Streak');
    var isAtRisk   = /at risk/i.test(title + ' ' + body);

    // Parse streak count from notification copy ("8-day streak")
    var streakCount = 0;
    var m = body.match(/(\d+)-day/);
    if (!m) m = title.match(/(\d+)-day/);
    if (m) streakCount = parseInt(m[1]);
    // Try live bridge value
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
        typeof N !== 'undefined' && typeof N.getStreakDays === 'function') {
      try { streakCount = parseInt(N.getStreakDays()) || streakCount; } catch (_) {}
    }

    var accentVar   = isAtRisk ? '--r' : '--p';
    var heroBg      = _rgba(accentVar, 0.08);
    var heroBorder  = _rgba(accentVar, 0.22);
    var heroColor   = isAtRisk ? 'var(--r)' : 'var(--p, #B06EFF)';
    var statusIcon  = isAtRisk ? '⚠️' : '🎉';
    var statusLabel = isAtRisk ? 'Streak at risk today' : 'Milestone reached!';
    var statusColor = isAtRisk ? 'var(--r)' : 'var(--g)';
    var ctaLabel    = isAtRisk ? 'Start a focus session \u2192' : 'Keep it going \u2192';
    var ctaAction   = isAtRisk
      ? "activateTab('focus');NotifSheet.close()"
      : "activateTab('home');NotifSheet.close()";
    var ctaClass    = isAtRisk ? 'ns-cta-btn ns-cta-warn' : 'ns-cta-btn';

    return _hdr('STREAK', title)
      + '<div class="ns-body">'
        + '<div class="ns-hero-block" style="background:' + heroBg + ';border-color:' + heroBorder + '">'
          + '<div class="ns-streak-num" style="color:' + heroColor + '">'
            + (streakCount > 0 ? streakCount : '🔥')
          + '</div>'
          + '<div class="ns-streak-day-label">day streak</div>'
          + '<div class="ns-streak-status" style="color:' + statusColor + '">'
            + statusIcon + ' ' + statusLabel
          + '</div>'
        + '</div>'
        + '<div class="ns-body-text">' + _escHtml(body) + '</div>'
        + '<button class="' + ctaClass + '" onclick="' + ctaAction + '">' + ctaLabel + '</button>'
        + '<div style="height:40px"></div>'
      + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     SUCCESS / PERSONAL BEST SHEET
     Trophy hero, record value, share button
  ══════════════════════════════════════════════════════════════ */
  function _renderSuccess(n) {
    var body  = n.body  || '';
    var title = n.title || 'Achievement';
    var isPb  = /personal best|new best/i.test(title + ' ' + body);

    var shareBtn = isPb
      ? '<button class="ns-cta-btn ns-cta-success" onclick="NotifSheet._shareScore()">↗ Share your record</button>'
      : '';

    return _hdr('ACHIEVEMENT', title)
      + '<div class="ns-body">'
        + '<div class="ns-hero-block" style="background:' + _rgba('--g', 0.07) + ';border-color:' + _rgba('--g', 0.2) + '">'
          + '<div class="ns-achieve-icon">🏆</div>'
          + '<div class="ns-achieve-text">' + _escHtml(body) + '</div>'
        + '</div>'
        + shareBtn
        + '<button class="ns-cta-btn ns-cta-secondary" onclick="activateTab(\'wellness\');NotifSheet.close()">'
          + 'View full stats \u2192'
        + '</button>'
        + '<div style="height:40px"></div>'
      + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     GOAL SHEET
     Goal achieved / goal-related encouragement
  ══════════════════════════════════════════════════════════════ */
  function _renderGoal(n) {
    var body  = n.body  || '';
    var title = n.title || 'Goal';

    return _hdr('DAILY GOAL', title)
      + '<div class="ns-body">'
        + '<div class="ns-hero-block" style="background:' + _rgba('--g', 0.07) + ';border-color:' + _rgba('--g', 0.2) + '">'
          + '<div class="ns-achieve-icon">🎯</div>'
          + '<div class="ns-achieve-text">' + _escHtml(body) + '</div>'
        + '</div>'
        + '<button class="ns-cta-btn ns-cta-success" onclick="activateTab(\'wellness\');NotifSheet.close()">'
          + 'View today\'s stats \u2192'
        + '</button>'
        + '<div style="height:40px"></div>'
      + '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     RECAP SHEET
     Daily summary — screen time, pickups, streak + verdict line
  ══════════════════════════════════════════════════════════════ */
  function _recapStatTile(label, value, color) {
    return '<div class="ns-recap-tile">'
      + '<div class="ns-recap-tile-val" style="color:' + color + '">' + _escHtml(String(value)) + '</div>'
      + '<div class="ns-recap-tile-lbl">' + label + '</div>'
      + '</div>';
  }

  function _renderRecap(n) {
    var body  = n.body  || '';
    var title = n.title || 'Your Day in Review';

    // Body format from SmartNotificationWorker:
    // "1h 30m screen time · 45 pickups[ · 3🔥 streak]\nVerdict text"
    var lines      = body.split('\n');
    var statsLine  = lines[0] || '';
    var verdict    = lines.slice(1).join(' ').trim();

    var timeMatch   = statsLine.match(/^([^·]+?)\s*screen time/);
    var pickupMatch = statsLine.match(/(\d+)\s*pickups?/);
    var streakMatch = statsLine.match(/(\d+)\s*🔥\s*streak/);

    var screenTime = timeMatch  ? timeMatch[1].trim() : '';
    var pickups    = pickupMatch ? pickupMatch[1]      : '';
    var streakDays = streakMatch ? streakMatch[1]      : '';

    var verdictColor = 'var(--t2)';
    if (/over.*goal|too much/i.test(verdict))                      verdictColor = 'var(--r)';
    else if (/under.*goal|great|solid|on goal|personal best/i.test(verdict)) verdictColor = 'var(--g)';

    var tiles = '';
    if (screenTime) tiles += _recapStatTile('Screen Time', screenTime, 'var(--p)');
    if (pickups)    tiles += _recapStatTile('Pickups',     pickups,    '#F04E7A');
    if (streakDays) tiles += _recapStatTile('Day Streak',  streakDays + ' 🔥', '#FFAA44');

    return _hdr('DAILY RECAP', title)
      + '<div class="ns-body">'
        + (tiles ? '<div class="ns-recap-stats">' + tiles + '</div>' : '')
        + (verdict
            ? '<div class="ns-recap-verdict" style="color:' + verdictColor + '">' + _escHtml(verdict) + '</div>'
            : '')
        + '<button class="ns-cta-btn" onclick="activateTab(\'wellness\');NotifSheet.close()">'
          + 'View today\u2019s stats \u2192'
        + '</button>'
        + '<div style="height:40px"></div>'
      + '</div>';
  }

  /* ── Open ────────────────────────────────────────────────────── */
  function open(n) {
    if (!n) return;

    var inner;
    switch (n.type) {
      case 'coach':   inner = _renderCoach(n);   break;
      case 'streak':  inner = _renderStreak(n);  break;
      case 'success': inner = _renderSuccess(n); break;
      case 'goal':    inner = _renderGoal(n);    break;
      case 'recap':   inner = _renderRecap(n);   break;
      default:        return; // no sheet for this type
    }

    var html = '<div id="ns-backdrop" class="modal-bg" role="dialog" aria-modal="true"'
      + ' aria-label="Notification detail"'
      + ' onclick="if(event.target===this)NotifSheet.close()">'
      + '<div id="ns-sheet" class="sheet ns-sheet">'
        + '<div class="sheet-handle"></div>'
        + inner
      + '</div>'
    + '</div>';

    var existing = document.getElementById('ns-backdrop');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.body.insertAdjacentHTML('beforeend', html);

    requestAnimationFrame(function () {
      var bd = document.getElementById('ns-backdrop');
      var sh = document.getElementById('ns-sheet');
      if (!bd) return;
      bd.classList.add('open');
      if (sh) {
        sh.classList.add('ns-animating');
        sh.style.transform = 'translate3d(0,0,0)';
      }
    });
  }

  /* ── Close ───────────────────────────────────────────────────── */
  function close() {
    var bd = document.getElementById('ns-backdrop');
    if (!bd) return;
    var sh = document.getElementById('ns-sheet');
    bd.style.opacity    = '0';
    bd.style.visibility = 'hidden';
    if (sh) sh.style.transform = 'translate3d(0,100%,0)';
    setTimeout(function () {
      if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
    }, 320);
  }

  /* ── CTA helpers (called from inline onclick) ────────────────── */
  function _coachFollowUp(query) {
    close();
    setTimeout(function () {
      if (typeof CoachUI !== 'undefined') CoachUI.open(query || null);
    }, 350);
  }

  function _shareScore() {
    close();
    if (typeof shareCard === 'function') shareCard('score');
  }

  return { open: open, close: close, _coachFollowUp: _coachFollowUp, _shareScore: _shareScore };

})();

window.NotifSheet = NotifSheet;
