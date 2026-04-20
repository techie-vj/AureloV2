'use strict';
/* ═══════════════════════════════════════════════════════════════
 * APP TIMER MODULE — app-focus-timers.js
 *
 * FIX #4: Show max MAX_VISIBLE apps by default; overflow opens a
 *         "show more" modal that lists all timer apps with their
 *         usage bars and limits.
 * ═══════════════════════════════════════════════════════════════ */
window.FocusTimers = (function () {

  var MAX_VISIBLE = 5; // max apps before "show more" link

  /* ── Build a single timer row HTML string ─────────────────────── */
  function _timerRow(pkg, limitMins, usedMins, ignoreCache) {
    var pct      = Math.min(100, Math.round((usedMins / limitMins) * 100));
    var isOver   = usedMins >= limitMins;
    var weekIgn  = (ignoreCache[pkg] || {}).weekIgnores || 0;
    var appName  = (DAILY_USE.find(function (a) { return a.packageName === pkg; }) || {}).name
                 || (Object.values(CATS_MAP).flat().find(function (a) { return a.packageName === pkg; }) || {}).name
                 || pkg.split('.').pop();

    var safeAppName = appName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var safePkg     = pkg.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    var barColor  = pct >= 100 ? '#F04E7A' : pct >= 80 ? '#F7A623' : pct >= 50 ? '#05C8E8' : '#12D48A';
    var timeColor = pct >= 100 ? 'var(--r)' : pct >= 80 ? 'var(--a)' : 'var(--t2)';

    var statusTag = isOver
      ? '<span style="font-family:var(--ff-m);font-size:10px;background:rgba(240,78,122,.15);' +
        'color:var(--r);border-radius:4px;padding:1px 5px;margin-left:5px">OVER</span>'
      : pct >= 80
        ? '<span style="font-family:var(--ff-m);font-size:10px;background:rgba(247,166,35,.12);' +
          'color:var(--a);border-radius:4px;padding:1px 5px;margin-left:5px">80%</span>'
        : '';

    var ignLabel = weekIgn > 0
      ? '<span style="font-family:var(--ff-m);font-size:11px;color:var(--t3)">· ignored ' + weekIgn + '× this week</span>'
      : '';

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
  }

  /* ── Show all timers modal ────────────────────────────────────── */
  function showAllTimers(pkgs, limits, usageMap, ignoreCache) {
    var existing = document.getElementById('_timers-all-modal');
    if (existing) existing.remove();

    var overCount = pkgs.filter(function (p) { return (usageMap[p] || 0) >= limits[p]; }).length;

    var rowsHtml = pkgs.map(function (pkg) {
      return _timerRow(pkg, limits[pkg], usageMap[pkg] || 0, ignoreCache);
    }).join('');

    var modal = document.createElement('div');
    modal.id = '_timers-all-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
    modal.innerHTML =
      '<div style="background:var(--s1);border-radius:22px 22px 0 0;padding:0 0 32px;width:100%;max-width:480px;' +
      'max-height:82vh;display:flex;flex-direction:column;box-shadow:0 -4px 40px rgba(0,0,0,.5)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 18px 14px;' +
        'border-bottom:1px solid var(--border);flex-shrink:0">' +
          '<div>' +
            '<div style="font-size:15px;font-weight:700;color:var(--t1)">All App Timers</div>' +
            '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px">' +
              pkgs.length + ' timer' + (pkgs.length !== 1 ? 's' : '') +
              (overCount > 0 ? ' · <span style="color:var(--r)">' + overCount + ' over</span>' : '') +
            '</div>' +
          '</div>' +
          '<div onclick="document.getElementById(\'_timers-all-modal\').remove()"' +
          ' style="width:30px;height:30px;border-radius:50%;background:var(--s2);border:1px solid var(--border2);' +
          'display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:var(--t2)">×</div>' +
        '</div>' +
        '<div style="overflow-y:auto;padding:0 18px;flex:1">' + rowsHtml + '</div>' +
        '<div style="padding:14px 18px 0;flex-shrink:0">' +
          '<div onclick="document.getElementById(\'_timers-all-modal\').remove();openPanel(\'timer-panel\')"' +
          ' style="width:100%;padding:12px;border-radius:13px;background:rgba(108,99,255,.12);' +
          'border:1px solid rgba(108,99,255,.25);font-family:var(--ff-m);font-size:13px;font-weight:700;' +
          'color:var(--p);cursor:pointer;text-align:center">Set timer →</div>' +
        '</div>' +
      '</div>';

    modal.addEventListener('click', function(e){ if(e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

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

    var ignoreCache = (typeof FocusTab !== 'undefined' && typeof FocusTab.getTimerIgnoreCache === 'function')
      ? FocusTab.getTimerIgnoreCache() : {};

    var totalWeekIgnores = pkgs.reduce(function (s, p) {
      return s + ((ignoreCache[p] || {}).weekIgnores || 0);
    }, 0);

    var overCount    = pkgs.filter(function (p) { return (usageMap[p] || 0) >= limits[p]; }).length;
    var visiblePkgs  = pkgs.slice(0, MAX_VISIBLE);
    var hiddenCount  = pkgs.length - MAX_VISIBLE;

    var rows = visiblePkgs.map(function (pkg) {
      return _timerRow(pkg, limits[pkg], usageMap[pkg] || 0, ignoreCache);
    }).join('');

    var showMoreHtml = hiddenCount > 0
      ? '<div onclick="FocusTimers._showMore()" style="text-align:center;padding:8px 0 0;' +
        'font-family:var(--ff-m);font-size:11px;color:var(--p);cursor:pointer">' +
        '+ ' + hiddenCount + ' more app' + (hiddenCount !== 1 ? 's' : '') + ' · tap to see all</div>'
      : '';

    var footerStats = overCount > 0
      ? '<span style="color:var(--r)">' + overCount + ' over today</span>'
      : '<span style="color:var(--t3)">all within limit</span>';
    var ignFooter = totalWeekIgnores > 0
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
      rows + showMoreHtml;

    // Stash state for the modal opener
    wrap._timerState = { pkgs: pkgs, limits: limits, usageMap: usageMap, ignoreCache: ignoreCache };

    ProTier.applyCeiling(pkgs.length, 'TIMER_APPS_UNLIMITED', wrap, null);
  }

  /* Called from onclick in the "show more" link */
  function _showMore() {
    var wrap = document.getElementById('focus-timers-wrap');
    var state = wrap && wrap._timerState;
    if (!state) return;
    showAllTimers(state.pkgs, state.limits, state.usageMap, state.ignoreCache);
  }

  window.onTimerGraceGranted = function (pkg) {
    if (typeof FocusTab !== 'undefined') {
      if (typeof FocusTab.loadTimerIgnoreStats === 'function') FocusTab.loadTimerIgnoreStats();
      if (typeof FocusTab.renderFocusStrip     === 'function') FocusTab.renderFocusStrip();
    }
    var wrap = document.getElementById('focus-timers-wrap');
    if (wrap) render(wrap);
  };

  return { render, _showMore };
})();