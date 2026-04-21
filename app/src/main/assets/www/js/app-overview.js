'use strict';
/* ═══════════════════════════════════════════════════════════════
 * APP OVERVIEW MODULE — app-overview.js
 *
 * FIX #5: Smart cross-feature "App Configuration" bottom sheet.
 *         Shows every app that has been added to any feature:
 *         Focus Mode, App Timer, Mindful Pause, Bedtime Mode,
 *         App Lock, Hidden Apps, Schedule Routines.
 *
 * Public API: AppOverview.show()
 * ═══════════════════════════════════════════════════════════════ */
window.AppOverview = (function () {

  /* ── Gather all configured apps from every feature ────────────── */
  function _collectFeatureApps() {
    var features = [];

    // 1. Focus Mode blocked apps
    try {
      var focusApps = IS_NATIVE ? JSON.parse(N.getFocusBlockedApps() || '[]') : [];
      if (focusApps.length) {
        features.push({
          id: 'focus', icon: '🎯', label: 'Focus Mode',
          color: 'rgba(108,99,255,.12)', borderColor: 'rgba(108,99,255,.25)',
          textColor: 'var(--p)',
          apps: focusApps,
          action: "openFocusAppPicker('block')",
        });
      }
    } catch (_) {}

    // 2. App Timers
    var limits = S.limits || {};
    var timerPkgs = Object.keys(limits);
    if (timerPkgs.length) {
      var allAppsFlat = Object.values(CATS_MAP).flat();
      var timerApps = timerPkgs.map(function (pkg) {
        var found = allAppsFlat.find(function (a) { return a.packageName === pkg; })
                 || DAILY_USE.find(function (a) { return a.packageName === pkg; });
        var usedMins  = (DAILY_USE.find(function (a) { return a.packageName === pkg; }) || {}).totalMinutes || 0;
        var limitMins = limits[pkg];
        var pct = Math.min(100, Math.round((usedMins / limitMins) * 100));
        return {
          packageName: pkg,
          name: found ? found.name : pkg.split('.').pop(),
          sub: fmtM(usedMins) + ' / ' + fmtM(limitMins) + (pct >= 100 ? ' · OVER' : (pct >= 80 ? ' · 80%' : '')),
          subColor: pct >= 100 ? 'var(--r)' : pct >= 80 ? 'var(--a)' : 'var(--t3)',
        };
      });
      features.push({
        id: 'timers', icon: '⏱', label: 'App Timers',
        color: 'rgba(5,200,232,.08)', borderColor: 'rgba(5,200,232,.2)',
        textColor: 'var(--c)',
        apps: timerApps,
        action: "openPanel('timer-panel')",
      });
    }

    // 3. Mindful Pause
    try {
      var mindfulApps = IS_NATIVE
        ? JSON.parse(N.getIntentionPromptApps() || '[]')
        : (typeof FocusMindful !== 'undefined' ? FocusMindful.getApps() : []);
      if (mindfulApps.length) {
        features.push({
          id: 'mindful', icon: '🧘', label: 'Mindful Pause',
          color: 'rgba(18,212,138,.08)', borderColor: 'rgba(18,212,138,.2)',
          textColor: 'var(--g)',
          apps: mindfulApps,
          action: "openFocusAppPicker('intention')",
        });
      }
    } catch (_) {}

    // 4. Bedtime Mode blocked apps
    try {
      var btCfg = IS_NATIVE
        ? JSON.parse(N.getBedtimeSettings() || '{}')
        : (typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {});
      var btApps = Array.isArray(btCfg.blockedApps) ? btCfg.blockedApps : [];
      if (btApps.length) {
        features.push({
          id: 'bedtime', icon: '🌙', label: 'Bedtime Mode',
          color: 'rgba(168,156,255,.08)', borderColor: 'rgba(168,156,255,.2)',
          textColor: '#a09bff',
          apps: btApps,
          action: "activateTab('focus');FocusTab._switchFocusSubTab('habits');setTimeout(function(){_btInlineOpenBlockPicker(true);},300)",
        });
      }
    } catch (_) {}

    // 5. App Lock
    var lockedPkgs = S.lockedPkgs || [];
    if (lockedPkgs.length) {
      var allAppsFlat2 = Object.values(CATS_MAP).flat();
      features.push({
        id: 'lock', icon: '🔒', label: 'App Lock',
        color: 'rgba(240,78,122,.08)', borderColor: 'rgba(240,78,122,.2)',
        textColor: 'var(--r)',
        apps: lockedPkgs.map(function (pkg) {
          var found = allAppsFlat2.find(function (a) { return a.packageName === pkg; });
          return { packageName: pkg, name: found ? found.name : pkg.split('.').pop() };
        }),
        action: "openPanel('lock-panel')",
      });
    }

    // 6. Hidden Apps
    var hiddenPkgs = S.hiddenPkgs || [];
    if (hiddenPkgs.length) {
      var allAppsFlat3 = Object.values(CATS_MAP).flat();
      features.push({
        id: 'hidden', icon: '🫥', label: 'Hidden Apps',
        color: 'rgba(255,255,255,.04)', borderColor: 'var(--border2)',
        textColor: 'var(--t2)',
        apps: hiddenPkgs.map(function (pkg) {
          var found = allAppsFlat3.find(function (a) { return a.packageName === pkg; });
          return { packageName: pkg, name: found ? found.name : pkg.split('.').pop() };
        }),
        action: "openPanel('hide-panel')",
      });
    }

    // 7. Schedule Routines
    try {
      var routines = IS_NATIVE ? JSON.parse(N.getFocusRoutines() || '[]') : [];
      var routineApps = [];
      var seen = new Set();
      routines.forEach(function (r) {
        (r.blockedApps || []).forEach(function (a) {
          if (!seen.has(a.packageName)) {
            seen.add(a.packageName);
            routineApps.push({ packageName: a.packageName, name: a.name || a.packageName.split('.').pop(), sub: 'in ' + (r.name || 'routine') });
          }
        });
      });
      if (routineApps.length) {
        features.push({
          id: 'routines', icon: '📅', label: 'Schedule Routines',
          color: 'rgba(247,166,35,.08)', borderColor: 'rgba(247,166,35,.2)',
          textColor: 'var(--a)',
          apps: routineApps,
          action: null,
        });
      }
    } catch (_) {}

    return features;
  }

  /* ── Build the bottom-sheet HTML ─────────────────────────────── */
  function show() {
    var existing = document.getElementById('_app-overview-modal');
    if (existing) existing.remove();

    var features = _collectFeatureApps();

    // Summary chip strip at the top
    var totalConfigured = (function () {
      var seen = new Set();
      features.forEach(function (f) {
        f.apps.forEach(function (a) { seen.add(a.packageName); });
      });
      return seen.size;
    })();

    if (!features.length) {
      // Nothing configured yet — show an empty state
      var modal = document.createElement('div');
      modal.id = '_app-overview-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
      modal.innerHTML =
        '<div style="background:var(--s1);border-radius:22px 22px 0 0;padding:28px 20px 40px;width:100%;max-width:480px;text-align:center">' +
          '<div style="font-size:36px;margin-bottom:12px">📱</div>' +
          '<div style="font-size:var(--text-base);font-weight:700;color:var(--t1);margin-bottom:8px">No apps configured yet</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-xs);color:var(--t3);line-height:1.6;margin-bottom:20px">' +
            'Add apps to Focus Mode, App Timers, Mindful Pause, Bedtime, App Lock, or Hidden to see them here.' +
          '</div>' +
          '<div onclick="document.getElementById(\'_app-overview-modal\').remove()"' +
          ' style="padding:12px;border-radius:13px;background:var(--s2);border:1px solid var(--border2);' +
          'font-family:var(--ff-m);font-size:var(--text-sm);color:var(--t2);cursor:pointer">Close</div>' +
        '</div>';
      modal.addEventListener('click', function(e){ if(e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
      return;
    }

    var sectionsHtml = features.map(function (f) {
      var MAX_CHIPS = 50;
      var safeId = 'aov-section-' + f.id;
      var chips = f.apps.slice(0, MAX_CHIPS).map(function (a) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<div style="width:34px;height:34px;border-radius:9px;overflow:hidden;background:var(--s2);' +
            'flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
            appIco(a.packageName, 34, 9) +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1)">' + escHtml(a.name || a.packageName.split('.').pop()) + '</div>' +
            (a.sub ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:' + (a.subColor || 'var(--t3)') + ';margin-top:1px">' + escHtml(a.sub) + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      var more = f.apps.length > MAX_CHIPS
        ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);padding:6px 0 2px">+' +
          (f.apps.length - MAX_CHIPS) + ' more</div>'
        : '';

      var editBtn = f.action
        ? '<div onclick="(function(){try{document.getElementById(\'_app-overview-modal\').remove();' + f.action.replace(/'/g, "\'") + '}catch(e){console.warn(\'[Overview edit]\'+(e&&e.message||e));}})()"' +
          ' style="font-family:var(--ff-m);font-size:var(--text-2xs);color:' + f.textColor + ';cursor:pointer;' +
          'padding:6px 12px;min-height:32px;display:flex;align-items:center;border-radius:8px;' +
          'border:1px solid ' + f.borderColor + ';background:' + f.color + '">' +
          'Edit →</div>'
        : '';

      // Collapsible section: header is tappable to toggle body
      return '<div style="margin-bottom:12px;border-radius:14px;background:var(--s1);' +
        'border:1px solid var(--border2);overflow:hidden">' +
        '<div onclick="(function(){' +
          'var b=document.getElementById(\'' + safeId + '\');' +
          'var a=document.getElementById(\'' + safeId + '-arrow\');' +
          'var open=b.style.display!==\'none\';' +
          'b.style.display=open?\'none\':\'block\';' +
          'if(a)a.style.transform=open?\'rotate(0deg)\':\'rotate(90deg)\';' +
        '})()" style="display:flex;align-items:center;justify-content:space-between;' +
          'padding:11px 14px;background:' + f.color + ';cursor:pointer;user-select:none">' +
          '<div style="display:flex;align-items:center;gap:7px">' +
            '<span id="' + safeId + '-arrow" style="font-size:var(--text-xs);color:' + f.textColor + ';transition:transform .2s">›</span>' +
            '<span style="font-size:15px">' + f.icon + '</span>' +
            '<span style="font-size:var(--text-sm);font-weight:700;color:' + f.textColor + '">' + f.label + '</span>' +
            '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:' + f.textColor + ';opacity:.7">' +
              f.apps.length + ' app' + (f.apps.length !== 1 ? 's' : '') +
            '</span>' +
          '</div>' +
          editBtn +
        '</div>' +
        '<div id="' + safeId + '" style="padding:0 14px;display:block">' + chips + more + '</div>' +
      '</div>';
    }).join('');

    var modal = document.createElement('div');
    modal.id = '_app-overview-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.65);display:flex;align-items:flex-end;justify-content:center';
    modal.innerHTML =
      '<div style="background:var(--bg);border-radius:22px 22px 0 0;padding:0 0 40px;width:100%;max-width:480px;' +
      'max-height:88vh;display:flex;flex-direction:column;box-shadow:0 -4px 40px rgba(0,0,0,.6)">' +

        // Handle bar
        '<div style="width:36px;height:4px;border-radius:2px;background:var(--border2);margin:10px auto 0"></div>' +

        // Header
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid var(--border);flex-shrink:0">' +
          '<div>' +
            '<div style="font-size:var(--text-base);font-weight:700;color:var(--t1)">App Configuration</div>' +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">' +
              totalConfigured + ' app' + (totalConfigured !== 1 ? 's' : '') + ' across ' +
              features.length + ' feature' + (features.length !== 1 ? 's' : '') +
            '</div>' +
          '</div>' +
          '<div onclick="document.getElementById(\'_app-overview-modal\').remove()"' +
          ' style="width:30px;height:30px;border-radius:50%;background:var(--s2);border:1px solid var(--border2);' +
          'display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:var(--t2)">×</div>' +
        '</div>' +

        // Scrollable content
        '<div style="overflow-y:auto;padding:16px 14px 0;flex:1">' + sectionsHtml + '</div>' +
      '</div>';

    modal.addEventListener('click', function(e){ if(e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  return { show };
})();