/* ═══════════════════════════════════════════════════════════════════════════
 * app-wellness-coach.js — Coach insight cards for Today / Week / Month tabs
 * Aurelo v1.3
 *
 * Replaces rule-based Smart Tips on Week tab (Pro).
 * Adds new insight panel to Month tab (Pro).
 * Adds coach card to Today tab (Pro) beneath smart tips.
 *
 * Design: mirrors home coach card but persistent (no dismiss), full body,
 * contextual header label ("Aurelo Coach · This Week" etc.)
 *
 * FALLBACK GUARANTEE: Every render path ends with a visible card for Pro users.
 * If the bridge is unavailable, times out, or returns an empty response, a
 * rule-based fallback card is synthesised from in-memory globals so users
 * never see a blank slot.
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

(function () {

  /* ── Arch SVG (unique defs prefix per container to avoid SVG ID clashes) ─ */
  function _archSvg(prefix) {
    return '<svg width="14" height="14" viewBox="0 0 108 108" fill="none" overflow="visible">'
      + '<defs><linearGradient id="' + prefix + 'Ga" x1="28" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">'
      + '<stop offset="0%" stop-color="#FFE082"/>'
      + '<stop offset="55%" stop-color="#FFAA44"/>'
      + '<stop offset="100%" stop-color="#FF7020"/>'
      + '</linearGradient></defs>'
      + '<path d="M 22 88 C 22 88 30 30 54 20 C 78 30 86 88 86 88" stroke="url(#' + prefix + 'Ga)" stroke-width="9" fill="none" stroke-linecap="round"/>'
      + '<circle cx="54" cy="20" r="6" fill="#FFE082"/>'
      + '</svg>';
  }

  /* ── Time string helper ─────────────────────────────────────────────────── */
  function _timeStr() {
    var now = new Date();
    var h = now.getHours(), m = now.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }

  /* ── Skeleton loader ────────────────────────────────────────────────────── */
  function _showCardSkeleton(container, label) {
    container.className = 'coach-home-insight';
    container.style.display = '';
    container.innerHTML =
      '<div class="coach-home-insight-inner">'
        + '<div class="coach-home-insight-hdr">'
          + '<div class="coach-home-insight-hdr-left">'
            + '<div class="coach-home-insight-icon">' + _archSvg('skl' + container.id) + '</div>'
            + '<div class="coach-home-insight-label">' + label + '</div>'
          + '</div>'
        + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">'
          + '<div style="height:10px;border-radius:5px;background:var(--s3);width:85%;animation:skeleton-pulse 1.4s ease-in-out infinite"></div>'
          + '<div style="height:10px;border-radius:5px;background:var(--s3);width:95%;animation:skeleton-pulse 1.4s ease-in-out infinite .1s"></div>'
          + '<div style="height:10px;border-radius:5px;background:var(--s3);width:70%;animation:skeleton-pulse 1.4s ease-in-out infinite .2s"></div>'
        + '</div>'
      + '</div>';
  }

  /* ── Full card renderer ─────────────────────────────────────────────────── */
  function _renderInsightCard(containerId, label, insight, followUpQuery) {
    var container = document.getElementById(containerId);
    if (!container) return;

    // If insight is missing or empty, use built-in JS fallback
    if (!insight || !insight.body) {
      insight = _jsFallbackForTab(containerId);
    }

    var hcBadgeHtml = insight.hcBadge
      ? '<div class="coach-home-insight-hc-badge">Health Connect</div>'
      : '';

    var ctaQuery = followUpQuery || (insight.followUps && insight.followUps[0]) || null;
    var ctaHtml  = ctaQuery
      ? '<div class="twc-cta" style="cursor:pointer;font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:var(--p2);letter-spacing:.3px">'
        + 'Ask follow&#8209;up &#x2192;</div>'
      : '';

    var fallbackNote = insight.usedFallback
      ? '<span style="color:var(--t3);font-size:var(--text-2xs);opacity:.7"> · offline</span>'
      : '';

    container.innerHTML =
      '<div class="coach-home-insight-inner">'
        + '<div class="coach-home-insight-hdr">'
          + '<div class="coach-home-insight-hdr-left">'
            + '<div class="coach-home-insight-icon">' + _archSvg('twc' + containerId) + '</div>'
            + '<div class="coach-home-insight-label">' + label + fallbackNote + '</div>'
            + hcBadgeHtml
          + '</div>'
          + '<div class="coach-home-insight-timestamp">' + _timeStr() + '</div>'
        + '</div>'
        + '<div class="coach-home-insight-title">' + (insight.title || '') + '</div>'
        + '<div class="coach-home-insight-body" style="white-space:pre-line">' + (insight.body || '') + '</div>'
        + (ctaHtml
          ? '<div class="coach-home-insight-actions">' + ctaHtml + '</div>'
          : '')
        + '<div class="coach-home-insight-source">'
          + '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">'
            + '<rect x="1" y="1" width="8" height="8" rx="1.5" stroke="#5C5278" stroke-width="1"/>'
            + '<path d="M3 5h4M3 3.5h2.5M3 6.5h2" stroke="#5C5278" stroke-width="0.8" stroke-linecap="round"/>'
          + '</svg>'
          + 'On&#8209;device \xb7 Private'
        + '</div>'
      + '</div>';

    container.className = 'coach-home-insight';
    container.style.display = '';

    // CTA tap → open coach modal pre-filled with follow-up query
    var ctaEl = container.querySelector('.twc-cta');
    if (ctaEl && ctaQuery) {
      ctaEl.onclick = function (e) {
        e.stopPropagation();
        if (typeof CoachUI !== 'undefined') CoachUI.open(ctaQuery);
      };
    }

    // Full card tap → open coach modal
    container.onclick = function () {
      if (typeof CoachUI !== 'undefined') CoachUI.open(ctaQuery || null);
    };
  }

  /* ── JS-side fallback (used when bridge returns null/empty for any reason) ─ */
  function _jsFallbackForTab(containerId) {
    var todayMins = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0) || 0;
    var goalMins  = (typeof S !== 'undefined' && S && S.streakGoalMins) ? S.streakGoalMins : 240;
    var streak    = (typeof S !== 'undefined' && S && S.streakDays) ? S.streakDays : 0;
    var fmtGoal   = goalMins >= 60
      ? (Math.floor(goalMins / 60) + 'h' + (goalMins % 60 > 0 ? ' ' + (goalMins % 60) + 'm' : ''))
      : (goalMins + 'm');

    var title, body;

    if (containerId === 'ww-insights') {
      // Week tab fallback
      var WEEKLY_DATA = (typeof WEEKLY !== 'undefined' ? WEEKLY : []);
      var validDays   = WEEKLY_DATA.filter(function (d) { return d.minutes > 0; });
      var weekTotal   = WEEKLY_DATA.reduce(function (s, d) { return s + (d.minutes || 0); }, 0);
      var weekAvg     = validDays.length ? Math.round(weekTotal / validDays.length) : 0;
      var daysUnder   = WEEKLY_DATA.filter(function (d) { return d.minutes > 0 && d.minutes <= goalMins; }).length;
      title = '✦ This week at a glance';
      body  = 'You\'ve averaged ' + (weekAvg > 0 ? _fmtMins(weekAvg) : '--') + '/day this week against your ' + fmtGoal + ' goal.\n'
            + (daysUnder > 0 ? 'You\'ve hit your goal on ' + daysUnder + ' day' + (daysUnder !== 1 ? 's' : '') + ' — keep the momentum going.' : 'Focus on getting more days under your goal.')
            + (streak > 0 ? '\nYou\'re on a ' + streak + '-day streak — protect it!' : '');

    } else if (containerId === 'wm-coach-insight') {
      // Month tab fallback
      var MDATA    = (typeof MONTHLY_DATA !== 'undefined' ? MONTHLY_DATA : []);
      var usedDays = MDATA.filter(function (d) { return d.minutes >= 10; });
      var mAvg     = usedDays.length ? Math.round(usedDays.reduce(function (s, d) { return s + d.minutes; }, 0) / usedDays.length) : 0;
      var mUnder   = usedDays.filter(function (d) { return d.minutes <= goalMins; }).length;
      title = '✦ This month at a glance';
      body  = 'You\'ve used your phone on ' + usedDays.length + ' day' + (usedDays.length !== 1 ? 's' : '') + ' this month'
            + (mAvg > 0 ? ', averaging ' + _fmtMins(mAvg) + '/day vs your ' + fmtGoal + ' goal' : '') + '.\n'
            + (mUnder > 0 ? 'Goal met on ' + mUnder + ' day' + (mUnder !== 1 ? 's' : '') + '. ' : '')
            + 'Check the heatmap above to spot patterns — your best days hold the key to consistency.';

    } else {
      // Today tab fallback
      var overMin = todayMins - goalMins;
      if (overMin > 0) {
        title = '✦ You\'re over your goal today';
        body  = 'You\'ve used ' + _fmtMins(todayMins) + ' today — ' + _fmtMins(overMin) + ' over your ' + fmtGoal + ' goal.\n'
              + 'A short focus session now can help you finish the day stronger.';
      } else {
        title = '✦ Today\'s looking good';
        body  = 'You\'ve used ' + _fmtMins(todayMins) + ' today against a ' + fmtGoal + ' goal.\n'
              + 'Stay consistent — your streak and Aurelo Score update at midnight.';
      }
    }

    return { intent: 'GENERAL_SUMMARY', title: title, body: body, hcBadge: false, followUps: [], usedFallback: true };
  }

  /* ── Minute formatter (mirrors fmtM in app-wellness.js) ─────────────────── */
  function _fmtMins(m) {
    if (!m || m <= 0) return '0m';
    var h = Math.floor(m / 60), mn = m % 60;
    if (h > 0 && mn > 0) return h + 'h ' + mn + 'm';
    if (h > 0) return h + 'h';
    return mn + 'm';
  }

  /* ── Bridge call with built-in timeout + fallback chain ─────────────────── */
  function _callTabInsight(tab, contextJson, cb) {
    // Timeout guard — if bridge doesn't respond in 8 s, show JS fallback
    var timedOut  = false;
    var responded = false;
    var guard = setTimeout(function () {
      if (!responded) {
        timedOut  = true;
        responded = true;
        cb(null);  // triggers JS fallback in _renderInsightCard
      }
    }, 8000);

    function _done(result) {
      if (timedOut) return;
      responded = true;
      clearTimeout(guard);
      cb(result);
    }

    if (typeof window.AppBridge === 'object' && window.AppBridge &&
        typeof window.AppBridge.getTabCoachInsight === 'function') {
      // Native path — run in next tick so UI thread is free to paint skeleton
      setTimeout(function () {
        try {
          var raw = window.AppBridge.getTabCoachInsight(tab, contextJson);
          var parsed = (raw && raw.length > 2) ? JSON.parse(raw) : null;
          _done(parsed);
        } catch (e) {
          console.warn('[WellnessCoach] bridge parse error tab=' + tab, e);
          _done(null);
        }
      }, 0);

    } else if (typeof window.AppBridge === 'object' && window.AppBridge &&
               typeof window.AppBridge.askCoach === 'function') {
      // Dev / browser fallback — use generic askCoach
      setTimeout(function () {
        try {
          var q = tab === 'week'  ? 'Give me a detailed weekly summary of my screen habits'
                : tab === 'month' ? 'Give me a comprehensive monthly overview of my screen habits'
                :                   'Give me a detailed analysis of today\'s usage patterns';
          var raw = window.AppBridge.askCoach(q);
          var parsed = (raw && raw.length > 2) ? JSON.parse(raw) : null;
          _done(parsed);
        } catch (e) {
          _done(null);
        }
      }, 0);

    } else {
      // No bridge at all (pure browser preview) — immediate JS fallback
      clearTimeout(guard);
      responded = true;
      cb(null);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * TODAY TAB
   * Shows below smart-tips for Pro users.
   * ═══════════════════════════════════════════════════════════════════════════ */
  window.renderTodayCoachInsight = function () {
    var isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    if (!isPro) return;

    var container = document.getElementById('wt-coach-insight');
    if (!container) return;

    // Hide rule-based smart-tips section for Pro (coach card takes over)
    var smartTips = document.getElementById('smart-tips');
    if (smartTips) smartTips.style.display = 'none';

    _showCardSkeleton(container, 'Aurelo Coach \xb7 Today');

    var todayMins = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0) || 0;
    var goalMins  = (typeof S !== 'undefined' && S && S.streakGoalMins) ? S.streakGoalMins : 240;
    var pickups   = (typeof PICKUPS   !== 'undefined' ? PICKUPS   : 0) || 0;
    var dailyUse  = (typeof DAILY_USE !== 'undefined' ? DAILY_USE : []);
    var topApp    = dailyUse.length ? (dailyUse[0].name || '') : '';

    // Estimate average daily pickups from weekly breakdown
    var avgPickups = 60;
    if (typeof WEEKLY !== 'undefined' && WEEKLY.length) {
      var puDays = WEEKLY.filter(function (d) { return d.minutes > 0; });
      if (puDays.length) {
        avgPickups = Math.round(
          puDays.reduce(function (s, d) { return s + (d.pickups || 0); }, 0) / puDays.length
        ) || 60;
      }
    }

    var ctx = JSON.stringify({
      tab:          'today',
      todayMinutes: todayMins,
      goalMinutes:  goalMins,
      pickupsToday: pickups,
      pickupsAvg:   avgPickups,
      topApp:       topApp,
      peakHour:     -1,
      topApps: dailyUse.slice(0, 5).map(function (a) {
        return { name: a.name || '', minutes: a.totalMinutes || 0 };
      })
    });

    _callTabInsight('today', ctx, function (insight) {
      _renderInsightCard(
        'wt-coach-insight',
        'Aurelo Coach \xb7 Today',
        insight,
        'What are the key patterns in my usage today?'
      );
    });
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * WEEK TAB
   * Pro: replaces rule-based Smart Tips with coach card.
   * Free: renders existing renderWeekInsights() unchanged.
   * ═══════════════════════════════════════════════════════════════════════════ */
  window.renderWeekCoachInsight = function () {
    var isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    var container = document.getElementById('ww-insights');
    if (!container) return;

    // Hide/show static "Weekly Insights" label based on Pro status
    var lbl = document.getElementById('ww-insights-label');
    if (lbl) lbl.style.display = isPro ? 'none' : '';

    if (!isPro) {
      // Free users — render rule-based tips exactly as before
      if (typeof renderWeekInsights === 'function') renderWeekInsights();
      return;
    }

    _showCardSkeleton(container, 'Aurelo Coach \xb7 This Week');

    var WEEKLY_DATA  = (typeof WEEKLY !== 'undefined' ? WEEKLY : []);
    var weeklyApps   = (typeof _getWeeklyApps === 'function') ? _getWeeklyApps() : [];
    var goalMins     = (typeof S !== 'undefined' && S && S.streakGoalMins) ? S.streakGoalMins : 240;
    var validDays    = WEEKLY_DATA.filter(function (d) { return d.minutes > 0; });
    var weekTotal    = WEEKLY_DATA.reduce(function (s, d) { return s + (d.minutes || 0); }, 0);
    var weekAvg      = validDays.length ? Math.round(weekTotal / validDays.length) : 0;
    var daysUnder    = WEEKLY_DATA.filter(function (d) { return d.minutes > 0 && d.minutes <= goalMins; }).length;

    var peakDay = null, bestDay = null;
    if (validDays.length) {
      peakDay = validDays.reduce(function (a, b) { return b.minutes > a.minutes ? b : a; }, validDays[0]);
      bestDay = validDays.length > 1
        ? validDays.reduce(function (a, b) { return b.minutes < a.minutes ? b : a; }, validDays[0])
        : null;
    }

    // Category breakdown
    var catMins     = (typeof _buildCatMinsFromWeekly === 'function') ? _buildCatMinsFromWeekly(weeklyApps) : {};
    var topCategory = '', topCatMins = 0;
    Object.keys(catMins).forEach(function (cat) {
      if (catMins[cat] > topCatMins) { topCatMins = catMins[cat]; topCategory = cat; }
    });

    // Weekday vs weekend split
    var DOW_WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var DOW_WEEKEND = ['Sat', 'Sun'];
    var weekdayDays = WEEKLY_DATA.filter(function (d) {
      return DOW_WEEKDAY.some(function (w) { return (d.day || '').slice(0, 3) === w; }) && d.minutes > 0;
    });
    var weekendDays = WEEKLY_DATA.filter(function (d) {
      return DOW_WEEKEND.some(function (w) { return (d.day || '').slice(0, 3) === w; }) && d.minutes > 0;
    });
    var weekdayAvg = weekdayDays.length
      ? Math.round(weekdayDays.reduce(function (s, d) { return s + d.minutes; }, 0) / weekdayDays.length) : 0;
    var weekendAvg = weekendDays.length
      ? Math.round(weekendDays.reduce(function (s, d) { return s + d.minutes; }, 0) / weekendDays.length) : 0;

    var ctx = JSON.stringify({
      tab:             'week',
      weekTotalMinutes: weekTotal,
      weekAvgMinutes:  weekAvg,
      goalMinutes:     goalMins,
      daysUnder:       daysUnder,
      trackedDays:     validDays.length,
      peakDay:         peakDay ? (peakDay.day || '') : '',
      peakDayMinutes:  peakDay ? (peakDay.minutes || 0) : 0,
      bestDay:         bestDay ? (bestDay.day || '') : '',
      bestDayMinutes:  bestDay ? (bestDay.minutes || 0) : 0,
      topCategory:     topCategory,
      weekdayAvg:      weekdayAvg,
      weekendAvg:      weekendAvg,
      topApps: weeklyApps.slice(0, 5).map(function (a) {
        return { name: a.name || '', weeklyMinutes: a.weeklyMinutes || 0 };
      })
    });

    _callTabInsight('week', ctx, function (insight) {
      _renderInsightCard(
        'ww-insights',
        'Aurelo Coach \xb7 This Week',
        insight,
        'What should I focus on most this week?'
      );
    });
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * MONTH TAB
   * Pro: adds coach insight card above Top Apps This Month.
   * ═══════════════════════════════════════════════════════════════════════════ */
  window.renderMonthCoachInsight = function () {
    var isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    if (!isPro) return;

    var container = document.getElementById('wm-coach-insight');
    if (!container) return;

    _showCardSkeleton(container, 'Aurelo Coach \xb7 This Month');

    var MDATA   = (typeof MONTHLY_DATA   !== 'undefined' ? MONTHLY_DATA   : []);
    var MAPPS   = (typeof MONTHLY_APPS   !== 'undefined' ? MONTHLY_APPS   : []);
    var MHOURLY = (typeof MONTHLY_HOURLY !== 'undefined' ? MONTHLY_HOURLY : []);
    var goalMins = (typeof S !== 'undefined' && S && S.streakGoalMins) ? S.streakGoalMins : 240;

    var usedDays   = MDATA.filter(function (d) { return d.minutes >= 10; });
    var monthTotal = usedDays.reduce(function (s, d) { return s + (d.minutes || 0); }, 0);
    var dailyAvg   = usedDays.length ? Math.round(monthTotal / usedDays.length) : 0;
    var daysUnder  = usedDays.filter(function (d) { return d.minutes <= goalMins; }).length;

    var peakEntry = null, bestEntry = null;
    if (usedDays.length) {
      peakEntry = usedDays.reduce(function (a, b) { return b.minutes > a.minutes ? b : a; }, usedDays[0]);
      bestEntry = usedDays.length > 1
        ? usedDays.reduce(function (a, b) { return b.minutes < a.minutes ? b : a; }, usedDays[0])
        : null;
    }

    // Top category from MONTHLY_APPS via CATS_MAP
    var pkgToCat = {};
    if (typeof CATS_MAP !== 'undefined' && CATS_MAP) {
      Object.keys(CATS_MAP).forEach(function (cat) {
        CATS_MAP[cat].forEach(function (a) { pkgToCat[a.packageName] = cat; });
      });
    }
    var catMins = {};
    MAPPS.forEach(function (a) {
      var cat = pkgToCat[a.packageName] || 'Other';
      catMins[cat] = (catMins[cat] || 0) + (a.monthlyMinutes || 0);
    });
    var topCat = '', topCatM = 0;
    Object.keys(catMins).forEach(function (c) {
      if (catMins[c] > topCatM) { topCatM = catMins[c]; topCat = c; }
    });

    // Time-of-day slots from MONTHLY_HOURLY
    var tSlots = { morning: 0, afternoon: 0, evening: 0, lateNight: 0 };
    MHOURLY.forEach(function (h) {
      var hr   = typeof h.hour !== 'undefined' ? h.hour : h;
      var mins = typeof h.minutes !== 'undefined' ? h.minutes : 0;
      if      (hr >= 6  && hr <= 11) tSlots.morning    += mins;
      else if (hr >= 12 && hr <= 16) tSlots.afternoon  += mins;
      else if (hr >= 17 && hr <= 20) tSlots.evening    += mins;
      else                           tSlots.lateNight  += mins;
    });
    var tTotal = Object.keys(tSlots).reduce(function (s, k) { return s + tSlots[k]; }, 0) || 1;
    var morningPct    = Math.round(tSlots.morning    / tTotal * 100);
    var afternoonPct  = Math.round(tSlots.afternoon  / tTotal * 100);
    var eveningPct    = Math.round(tSlots.evening    / tTotal * 100);
    var lateNightPct  = Math.round(tSlots.lateNight  / tTotal * 100);

    var ctx = JSON.stringify({
      tab:              'month',
      monthTotalMinutes: monthTotal,
      monthDailyAvg:    dailyAvg,
      goalMinutes:      goalMins,
      daysUnder:        daysUnder,
      trackedDays:      usedDays.length,
      peakDay:          peakEntry ? (peakEntry.day  || peakEntry.date  || '') : '',
      peakDayMinutes:   peakEntry ? (peakEntry.minutes || 0) : 0,
      bestDay:          bestEntry ? (bestEntry.day  || bestEntry.date  || '') : '',
      bestDayMinutes:   bestEntry ? (bestEntry.minutes || 0) : 0,
      topCategory:      topCat,
      morningPct:       morningPct,
      afternoonPct:     afternoonPct,
      eveningPct:       eveningPct,
      lateNightPct:     lateNightPct,
      topApps: MAPPS.slice(0, 5).map(function (a) {
        return { name: a.name || '', monthlyMinutes: a.monthlyMinutes || 0 };
      })
    });

    _callTabInsight('month', ctx, function (insight) {
      _renderInsightCard(
        'wm-coach-insight',
        'Aurelo Coach \xb7 This Month',
        insight,
        'What patterns should I work on this month?'
      );
    });
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * FIX: Session-completion refresh
   *
   * Problem: Tab insight caches are per-day. If a focus session completes at
   * 2 PM and the Today/Week coach cards were already rendered at 9 AM, the
   * stale FOCUS_GAP insight persists for the rest of the day even though
   * focusSessionsCompleted is now > 0 and daysSinceLastFocus is 0.
   *
   * Fix:
   *  1. On aurelo:focuscomplete — invalidate today + week caches via bridge,
   *     then re-render whichever tab insight is currently visible.
   *  2. On aurelo:sleepcomplete — invalidate today cache and re-render today.
   *  3. Helpers track which tab is currently active so we only re-render the
   *     visible card (avoids unnecessary background bridge calls).
   * ═══════════════════════════════════════════════════════════════════════════ */

  /** Returns the currently active wellness sub-tab id, or null if not on wellness. */
  function _activeWellnessTab() {
    // Use the same global the wellness view-switcher writes so we don't have
    // to parse DOM visibility (which may be unreliable across WebView repaints).
    var screenWellness = document.getElementById('screen-wellness');
    if (!screenWellness || screenWellness.style.display === 'none') return null;
    // _wellnessView is the global defined by app-wellness.js via Object.defineProperty.
    try { return window._wellnessView || 'today'; } catch (_) { return 'today'; }
  }

  /** Invalidate one or more tab insight caches via the native bridge. */
  function _invalidateBridgeCache(tab) {
    try {
      if (typeof window.AppBridge === 'object' && window.AppBridge &&
          typeof window.AppBridge.invalidateTabInsightCache === 'function') {
        window.AppBridge.invalidateTabInsightCache(tab);
      }
    } catch (_) {}
  }

  /**
   * Called when a focus session completes.
   * Clears today + week caches and re-renders whichever card is visible.
   */
  function _onFocusSessionComplete() {
    _invalidateBridgeCache('today');
    _invalidateBridgeCache('week');

    var activeTab = _activeWellnessTab();
    if (activeTab === 'today') {
      setTimeout(window.renderTodayCoachInsight, 400);
    } else if (activeTab === 'week') {
      setTimeout(window.renderWeekCoachInsight,  400);
    }
  }

  /**
   * Called when Bedtime Mode records a sleep score (morning summary or manual
   * completion). Clears the today cache and re-renders if today tab is active.
   */
  function _onSleepComplete() {
    _invalidateBridgeCache('today');

    var activeTab = _activeWellnessTab();
    if (activeTab === 'today') {
      setTimeout(window.renderTodayCoachInsight, 400);
    }
  }

  // FIX: Attach listeners for events dispatched by app-focus.js and
  // app-focus-bedtime.js after session completion.
  document.addEventListener('aurelo:focuscomplete', _onFocusSessionComplete);
  document.addEventListener('aurelo:sleepcomplete',  _onSleepComplete);

})();
