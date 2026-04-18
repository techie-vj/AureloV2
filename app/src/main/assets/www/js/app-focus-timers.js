'use strict';
/* ═══════════════════════════════════════════════════════════════
 * APP TIMER MODULE — app-focus-timers.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Daily App Timers list rendering, timer ignore stats.
 * State (_timerIgnoreCache) lives in FocusTab for backward-compat
 * with BUG-5 fix (home strip renders before Focus tab visits).
 *
 * Public API:  FocusTimers.render(wrapEl)
 * ═══════════════════════════════════════════════════════════════ */
window.FocusTimers = (function () {

  /* ── Main render ─────────────────────────────────────────────── */
  function render(wrap) {
    if (!wrap) return;
    var limits = S.limits || {};
    var pkgs   = Object.keys(limits);

    if (!pkgs.length) {
      wrap.innerHTML =
        '<div style="padding:14px 0 4px;display:flex;align-items:center;justify-content:space-between">' +
          '<div>' +
            '<div style="font-size:13px;font-weight:600;color:var(--t2)">Daily App Timers</div>' +
            '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);margin-top:2px">' +
              'Set a limit and Aurelo shows a soft-block when you hit it' +
            '</div>' +
          '</div>' +
          '<div onclick="openPanel(\'timer-panel\')"' +
             ' style="padding:8px 14px;border-radius:99px;flex-shrink:0;' +
             'background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.25);' +
             'font-family:var(--ff-m);font-size:11px;font-weight:700;' +
             'color:var(--p);cursor:pointer;white-space:nowrap">Set timer →' +
          '</div>' +
        '</div>';
      return;
    }

    var usageMap = {};
    DAILY_USE.forEach(function (u) { usageMap[u.packageName] = u.totalMinutes || 0; });

    // Get timer ignore cache through FocusTab (BUG-5: cache lives there)
    var ignoreCache = (typeof FocusTab !== 'undefined' && typeof FocusTab.getTimerIgnoreCache === 'function')
      ? FocusTab.getTimerIgnoreCache() : {};

    // Weekly ignore totals across all limited apps
    var totalWeekIgnores = pkgs.reduce(function (s, p) {
      return s + ((ignoreCache[p] || {}).weekIgnores || 0);
    }, 0);

    var rows = pkgs.map(function (pkg) {
      var limitMins = limits[pkg];
      var usedMins  = usageMap[pkg] || 0;
      var pct       = Math.min(100, Math.round((usedMins / limitMins) * 100));
      var isOver    = usedMins >= limitMins;
      var weekIgn   = (ignoreCache[pkg] || {}).weekIgnores || 0;
      var appName   = (DAILY_USE.find(function (a) { return a.packageName === pkg; }) || {}).name
                    || (Object.values(CATS_MAP).flat().find(function (a) { return a.packageName === pkg; }) || {}).name
                    || pkg.split('.').pop();

      // Escape backslashes first, then single-quotes, so the value is safe
      // inside the single-quoted onclick="openTimerForApp('...','...',n)" string.
      // Without this, any app name containing an apostrophe (e.g. "McDonald's")
      // produces invalid inline JS and an opaque script error on tap.
      var safeAppName = appName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var safePkg     = pkg.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      var barColor = pct >= 100 ? '#F04E7A' : pct >= 80 ? '#F7A623' : pct >= 50 ? '#05C8E8' : '#12D48A';
      var timeColor = pct >= 100 ? 'var(--r)' : pct >= 80 ? 'var(--a)' : 'var(--t2)';

      var statusTag = isOver
        ? '<span style="font-family:var(--ff-m);font-size:10px;background:rgba(240,78,122,.15);' +
          'color:var(--r);border-radius:4px;padding:1px 5px;margin-left:5px">OVER</span>'
        : pct >= 80
          ? '<span style="font-family:var(--ff-m);font-size:10px;background:rgba(247,166,35,.12);' +
            'color:var(--a);border-radius:4px;padding:1px 5px;margin-left:5px">80%</span>'
          : '';

      var ignLabel = weekIgn > 0
        ? '<span style="font-family:var(--ff-m);font-size:11px;color:var(--t3)">' +
          '· ignored ' + weekIgn + '× this week</span>' : '';

      return '<div onclick="openTimerForApp(\'' + safePkg + '\',\'' + safeAppName + '\',' + usedMins + ')"' +
        ' style="display:flex;align-items:center;gap:10px;padding:8px 0;' +
        'border-bottom:1px solid var(--border);cursor:pointer">' +
        '<div style="width:34px;height:34px;border-radius:10px;overflow:hidden;background:var(--s2);' +
        'flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
          appIco(pkg, 34, 9) +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0;margin-bottom:4px">' +
            '<span style="font-size:12px;font-weight:600;color:var(--t1)">' + appName + '</span>' +
            statusTag + ignLabel +
          '</div>' +
          '<div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden">' +
            '<div style="height:100%;width:' + Math.min(pct, 100) + '%;background:' + barColor + ';' +
            'border-radius:2px;transition:width .4s ease"></div>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:' + timeColor + '">' +
            fmtM(usedMins) +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3)">' + fmtM(limitMins) + '</div>' +
        '</div>' +
        '</div>';
    }).join('');

    var overCount   = pkgs.filter(function (p) { return (usageMap[p] || 0) >= limits[p]; }).length;
    var footerStats = overCount > 0
      ? '<span style="color:var(--r)">' + overCount + ' over today</span>'
      : '<span style="color:var(--t3)">all within limit</span>';
    var ignFooter   = totalWeekIgnores > 0
      ? ' · <span style="color:var(--t3)">' + totalWeekIgnores +
        ' escape hatch' + (totalWeekIgnores !== 1 ? 's' : '') + ' this week</span>'
      : '';

    wrap.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:0 0 6px">' +
        '<div>' +
          '<div style="font-size:13px;font-weight:600;color:var(--t1)">Daily Timers</div>' +
          '<div style="font-family:var(--ff-m);font-size:10px;margin-top:1px">' +
            footerStats + ignFooter +
          '</div>' +
        '</div>' +
        '<div onclick="openPanel(\'timer-panel\')"' +
          ' style="font-family:var(--ff-m);font-size:10px;color:var(--p);cursor:pointer">Manage →</div>' +
      '</div>' +
      rows;

    // Ceiling nudge — show "X/3 · Unlock unlimited with Pro" below the last timer row
    ProTier.applyCeiling(pkgs.length, 'TIMER_APPS_UNLIMITED', wrap, null);
  }

  /* ── Native callback: user granted 5-more-minutes grace ─────── */
  window.onTimerGraceGranted = function (pkg) {
    if (typeof FocusTab !== 'undefined') {
      if (typeof FocusTab.loadTimerIgnoreStats === 'function') FocusTab.loadTimerIgnoreStats();
      if (typeof FocusTab.renderFocusStrip     === 'function') FocusTab.renderFocusStrip();
    }
    var wrap = document.getElementById('focus-timers-wrap');
    if (wrap) render(wrap);
  };

  return { render };
})();