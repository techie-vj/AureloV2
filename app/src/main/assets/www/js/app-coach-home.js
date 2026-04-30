/* ═══════════════════════════════════════════════════════════════════════════
 * app-coach-home.js — Home tab coach insight card + HC home banner
 *
 * Spec §19: Home tab coach insight card (below Aurelo Score card).
 * Spec §4.4: HC home banner for Pro users who haven't connected HC yet.
 *
 * This module hooks into the home tab render lifecycle.
 * It is loaded after app-home.js and app-health-connect.js.
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

(function () {

  /* ── Dismiss persistence ────────────────────────────────────────────────── */

  // Key format: coach_insight_dismissed_v1_YYYY-MM-DD
  // Dismissed state expires at end of day so the card reappears next morning
  // with a fresh insight. Native Android bridge is checked first.
  function _getDismissedKey() {
    var d = new Date();
    return 'coach_insight_dismissed_v1_' +
      d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function _isDismissed() {
    if (typeof window.AppBridge === 'object' && window.AppBridge) {
      try {
        var raw = window.AppBridge.getCoachInsightDismissed();
        if (raw != null) return !!JSON.parse(raw);
      } catch (_) {}
    }
    try { return localStorage.getItem(_getDismissedKey()) === '1'; } catch (_) { return false; }
  }

  function _setDismissed() {
    if (typeof window.AppBridge === 'object' && window.AppBridge) {
      try {
        if (typeof window.AppBridge.setCoachInsightDismissed === 'function') {
          window.AppBridge.setCoachInsightDismissed();
          return;
        }
      } catch (_) {}
    }
    try { localStorage.setItem(_getDismissedKey(), '1'); } catch (_) {}
  }

  /* ── Insight card renderer ──────────────────────────────────────────────── */

  function renderCoachHomeInsight() {
    if (_isDismissed()) return;

    var isPro   = typeof ProTier !== 'undefined' && ProTier.isPro;
    var insight = _loadInsight(isPro);
    if (!insight) return;

    var card = document.getElementById('coach-home-insight');
    if (!card) {
      card = _createInsightCard();
      if (!card) return;
    }

    var titleEl   = card.querySelector('.coach-home-insight-title');
    var bodyEl    = card.querySelector('.coach-home-insight-body');
    var hcBadge   = card.querySelector('.coach-home-insight-hc-badge');
    var tsEl      = card.querySelector('.coach-home-insight-timestamp');
    var ctaEl     = card.querySelector('.coach-home-insight-cta');
    var dismissEl = card.querySelector('.coach-home-insight-dismiss');

    if (titleEl)   titleEl.textContent = insight.title || '';
    if (bodyEl)    bodyEl.textContent  = insight.previewBody || insight.body || '';
    if (hcBadge)   hcBadge.style.display = insight.hcBadge ? '' : 'none';

    if (tsEl) {
      var now = new Date(), h = now.getHours(), m = now.getMinutes();
      var ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      tsEl.textContent = h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
    }

    if (ctaEl) {
      ctaEl.onclick = function (e) {
        e.stopPropagation();
        if (typeof CoachUI !== 'undefined') CoachUI.open(insight.intentQuery || null);
      };
    }

    if (dismissEl) {
      dismissEl.onclick = function (e) {
        e.stopPropagation();
        _setDismissed();        // persist — survives refresh
        card.style.display = 'none';
      };
    }

    card.onclick = function () {
      if (typeof CoachUI === 'undefined') return;
      if (typeof CoachUI.openInsight === 'function') {
        CoachUI.openInsight(
          insight.title || 'Your daily insight',
          insight.fullBody || insight.body || insight.previewBody || '',
          insight.intentQuery ? [insight.intentQuery] : []
        );
      } else {
        CoachUI.open(null);
      }
    };

    card.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    };

    card.style.display = '';
  }

  /* ── Load insight ───────────────────────────────────────────────────────── */

  function _loadInsight(isPro) {
    if (typeof window.AppBridge === 'object' && window.AppBridge) {
      try {
        var raw = window.AppBridge.getDailyCoachInsight();
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.title) {
            var parsedBody = parsed.body || '';
            return {
              title:       parsed.title,
              body:        isPro ? parsedBody : _truncate(parsedBody, 80),
              fullBody:    isPro ? parsedBody : _truncate(parsedBody, 80),
              previewBody: isPro ? _truncate(parsedBody, 118) : _truncate(parsedBody, 80),
              hcBadge:     !!parsed.hcBadge,
              intentQuery: _intentToQuery(parsed.intent),
            };
          }
        }
      } catch (_) {}
    }

    if (typeof AureloCoach === 'undefined') return null;
    try {
      var summary  = AureloCoach.loadUsageSummary();
      var patterns = AureloCoach.PatternDetector.detectAll(summary);
      var top      = patterns[0];
      if (!top) return null;
      var resp     = AureloCoach.TemplateLibrary.get(top.intent, summary);
      var bodyText = (resp.text || '').replace(/<[^>]+>/g, '');
      return {
        title:       _intentTitle(top.intent),
        body:        isPro ? bodyText : _truncate(bodyText, 80),
        fullBody:    isPro ? bodyText : _truncate(bodyText, 80),
        previewBody: isPro ? _truncate(bodyText, 118) : _truncate(bodyText, 80),
        hcBadge:     top.intent === 'HC_POOR_SLEEP_HIGH_USAGE' ||
                     top.intent === 'HC_ACTIVE_DAY_BETTER_FOCUS',
        intentQuery: resp.followUps && resp.followUps[0] ? resp.followUps[0] : null,
      };
    } catch (_) { return null; }
  }

  /* ── Create card DOM ────────────────────────────────────────────────────── */

function _createInsightCard() {
  var screen = document.getElementById('screen-home');
  if (!screen) return null;

  var card = document.createElement('div');
  card.id = 'coach-home-insight';
  card.style.display = 'none';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', 'Aurelo Coach daily insight — tap to read full insight');

  var ARCH_SVG =
    '<svg width="14" height="14" viewBox="0 0 108 108" fill="none" overflow="visible">' +
      '<defs>' +
        '<linearGradient id="chiGa" x1="28" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">' +
          '<stop offset="0%" stop-color="#FFE082"/>' +
          '<stop offset="55%" stop-color="#FFAA44"/>' +
          '<stop offset="100%" stop-color="#FF7020"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="M 22 88 C 22 88 30 30 54 20 C 78 30 86 88 86 88" stroke="url(#chiGa)" stroke-width="9" fill="none" stroke-linecap="round"/>' +
      '<circle cx="54" cy="20" r="6" fill="#FFE082"/>' +
    '</svg>';

  card.innerHTML =
    '<div class="coach-home-insight-inner">' +
      '<div class="coach-home-insight-hdr">' +
        '<div class="coach-home-insight-hdr-left">' +
          '<div class="coach-home-insight-icon">' + ARCH_SVG + '</div>' +
          '<div class="coach-home-insight-label">Aurelo Coach \xb7 Today</div>' +
          '<div class="coach-home-insight-hc-badge" style="display:none">Health Connect</div>' +
        '</div>' +
        '<div class="coach-home-insight-timestamp"></div>' +
      '</div>' +
      '<div class="coach-home-insight-title"></div>' +
      '<div class="coach-home-insight-body"></div>' +
      '<div class="coach-home-insight-actions">' +
        '<div class="coach-home-insight-cta">Ask follow\u2011up \u2192</div>' +
        '<div class="coach-home-insight-dismiss">Got it</div>' +
      '</div>' +
      '<div class="coach-home-insight-source">' +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
          '<rect x="1" y="1" width="8" height="8" rx="1.5" stroke="#5C5278" stroke-width="1"/>' +
          '<path d="M3 5h4M3 3.5h2.5M3 6.5h2" stroke="#5C5278" stroke-width="0.8" stroke-linecap="round"/>' +
        '</svg>' +
        'On\u2011device \xb7 Private' +
      '</div>' +
    '</div>';

  // ── Insertion: use named anchor if present, otherwise append to screen ──
  var anchor = document.getElementById('coach-home-insight-anchor');
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(card, anchor);
  } else {
    screen.appendChild(card);
  }

  return card;   // always return the node — never null after this point
}

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  function _truncate(str, maxChars) {
    if (!str) return '';
    return str.length <= maxChars ? str : str.slice(0, maxChars).trimEnd() + '\u2026';
  }

  function _intentTitle(intent) {
    var map = {
      STREAK_AT_RISK:                  '\uD83D\uDD25 Streak at risk today',
      SCORE_DROP:                      '\uD83D\uDCC9 Your score dropped',
      HC_POOR_SLEEP_HIGH_USAGE:        '\uD83D\uDE34 Poor sleep \u2192 more scrolling',
      HC_ACTIVE_DAY_BETTER_FOCUS:      '\uD83D\uDEB6 Active day pattern detected',
      FOCUS_GAP:                       '\uD83C\uDFAF Time to focus',
      MORNING_DOOM_SCROLL:             '\uD83C\uDF05 Morning phone check',
      ANOMALOUS_SPIKE:                 '\uD83D\uDCCA Usage spike detected',
      BEDTIME_REVENGE_PROCRASTINATION: '\uD83C\uDF19 Late-night pattern',
      PRODUCTIVE_DAY:                  '\u2728 Great day so far',
      FOCUS_BURNOUT:                   '\uD83D\uDCA4 Focus feels hard',
      SOCIAL_SPIRAL:                   '\uD83D\uDCF1 Social apps leading',
      WEEKEND_BINGE:                   '\uD83D\uDCC5 Weekend usage spike',
      HEALTHY_PATTERN:                 '\u2B50 Strong habit streak',
    };
    return map[intent] || '\u2756 Your daily insight';
  }

  function _intentToQuery(intent) {
    var map = {
      STREAK_AT_RISK:                  'Is my streak safe today?',
      SCORE_DROP:                      'Why did my score drop?',
      HC_POOR_SLEEP_HIGH_USAGE:        'How did poor sleep affect my usage today?',
      HC_ACTIVE_DAY_BETTER_FOCUS:      'What happens on my active days?',
      FOCUS_GAP:                       "I haven't focused in a while \u2014 what should I do?",
      MORNING_DOOM_SCROLL:             'How does morning phone use affect my day?',
      ANOMALOUS_SPIKE:                 'Why is this day always my worst?',
      BEDTIME_REVENGE_PROCRASTINATION: 'Why do I use my phone at night?',
      PRODUCTIVE_DAY:                  'What is going well this week?',
      FOCUS_BURNOUT:                   "Why can't I focus today?",
      SOCIAL_SPIRAL:                   'Am I on social media too much?',
    };
    return map[intent] || null;
  }

  /* ── Initialisation ─────────────────────────────────────────────────────── */

  document.addEventListener('tabchange', function (e) {
    if (e && e.detail && e.detail.tab === 'home') {
      setTimeout(renderCoachHomeInsight, 150);
    }
  });

  if (document.readyState === 'complete') {
    setTimeout(renderCoachHomeInsight, 800);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(renderCoachHomeInsight, 800);
    });
  }

  window.renderCoachHomeInsight = renderCoachHomeInsight;

})();