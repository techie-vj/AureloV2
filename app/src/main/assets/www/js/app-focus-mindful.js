'use strict';
/* ═══════════════════════════════════════════════════════════════
 * MINDFUL PAUSE MODULE — app-focus-mindful.js  v2.1
 *
 * BUG FIXES IN THIS VERSION:
 *
 * 1. TOTAL COUNT ALWAYS 0 — Root cause: IntentionEngine.kt stores
 *    counts under "focus_intention_pause_count" but the bridge
 *    reads "intention_pause_count" (missing "focus_" prefix).
 *    Fix: JS-side localStorage counters incremented by
 *    onIntentionPause/onIntentionResist native callbacks.
 *    Display now shows "Active · ready" instead of "0 pauses
 *    today" when the feature is on but no pauses have occurred.
 *
 * 2. PER-APP COUNTS ALWAYS 0 — Per-app data not available via
 *    native bridge (same key-mismatch). Fix: track per-app counts
 *    in localStorage. onIntentionPause(pkg) and
 *    onIntentionResist(pkg) now accept an optional package name;
 *    if native code passes it, individual per-app totals are
 *    stored and shown. Falls back to aggregate display when pkg
 *    is not supplied.
 * ═══════════════════════════════════════════════════════════════ */
window.FocusMindful = (function () {

  var MAX_VISIBLE = 5;

  /* ── Storage key constants ─────────────────────────────────── */
  var _KEY_PAUSE      = 'mp_pause_count';   // aggregate daily pause count
  var _KEY_RESIST     = 'mp_resist_count';  // aggregate daily resist count
  var _KEY_DATE       = 'mp_date';          // today YYYY-MM-DD for aggregate

  var _PFX_APP_PAUSE  = 'mp_ap_';   // per-app pause:  mp_ap_{pkg}
  var _PFX_APP_RESIST = 'mp_ar_';   // per-app resist: mp_ar_{pkg}
  var _PFX_APP_DATE   = 'mp_ad_';   // per-app date:   mp_ad_{pkg}

  /* ── Date helper ───────────────────────────────────────────── */
  function _today() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  /* ── Aggregate counter helpers ─────────────────────────────── */
  function _getCount(key) {
    try {
      if (localStorage.getItem(_KEY_DATE) !== _today()) return 0;
      return parseInt(localStorage.getItem(key) || '0', 10) || 0;
    } catch (_) { return 0; }
  }

  function _incCount(key) {
    try {
      var t = _today();
      if (localStorage.getItem(_KEY_DATE) !== t) {
        localStorage.setItem(_KEY_DATE,    t);
        localStorage.setItem(_KEY_PAUSE,   '0');
        localStorage.setItem(_KEY_RESIST,  '0');
      }
      var n = (_getCount(key) || 0) + 1;
      localStorage.setItem(key, String(n));
      return n;
    } catch (_) { return 0; }
  }

  /* ── Per-app counter helpers ───────────────────────────────── */
  function _getAppCount(pfx, pkg) {
    try {
      if (localStorage.getItem(_PFX_APP_DATE + pkg) !== _today()) return 0;
      return parseInt(localStorage.getItem(pfx + pkg) || '0', 10) || 0;
    } catch (_) { return 0; }
  }

  function _incAppCount(pfx, pkg) {
    if (!pkg) return;
    try {
      var t = _today();
      var dk = _PFX_APP_DATE + pkg;
      if (localStorage.getItem(dk) !== t) {
        localStorage.setItem(dk, t);
        localStorage.setItem(_PFX_APP_PAUSE  + pkg, '0');
        localStorage.setItem(_PFX_APP_RESIST + pkg, '0');
      }
      var n = (_getAppCount(pfx, pkg) || 0) + 1;
      localStorage.setItem(pfx + pkg, String(n));
    } catch (_) {}
  }

  /* ── Read total counts ───────────────────────────────────────────────────
   * Native bridge now has correct keys (BridgeKeys.kt fix), so we prefer it.
   * JS-side localStorage counters remain as an immediate in-session fallback
   * (bridge calls are async and may lag by one render cycle).
   * We take the MAX of both sources to handle any residual timing edge-cases.
   */
  function _getPauseCounts() {
    var pauses  = _getCount(_KEY_PAUSE);
    var resists = _getCount(_KEY_RESIST);
    if (IS_NATIVE) {
      try {
        var np = typeof N.getIntentionPauseCount  === 'function' ? (N.getIntentionPauseCount()  || 0) : 0;
        var nr = typeof N.getIntentionResistCount === 'function' ? (N.getIntentionResistCount() || 0) : 0;
        pauses  = Math.max(pauses,  np);
        resists = Math.max(resists, nr);
      } catch (_) {}
    }
    return { pauses: pauses, resists: resists };
  }

  /* ── Read per-app counts ─────────────────────────────────────────────────
   * Strategy mirrors _getPauseCounts(): collect from every available source
   * and take Math.max so whichever source has the real data wins.
   *
   * Three failure modes this guards against:
   *  1. localStorage 0 — onIntentionPause(pkg) fired while WebView was inactive
   *     (user was in another app), so _incAppCount was never called.
   *  2. Native per-app 0 — bridge returns all-zero (e.g. apply() not yet
   *     flushed, or per-app write not yet deployed).  Previously the function
   *     returned immediately when native responded with zeros, skipping
   *     localStorage entirely.
   *  3. Bridge method absent — neither getIntentionAppStats nor
   *     getIntentionAppPauseCount exist in the installed APK yet.
   *
   * Fix: always seed from localStorage first, then overlay each native source
   * with Math.max.  Never return early just because one source returned zeros.
   */
  function _getAppStats() {
    var today = _today();
    var apps  = _getIntentionApps();

    // Step 1 — seed from JS localStorage (populated by onIntentionPause/Resist(pkg))
    var map = {};
    apps.forEach(function (a) {
      map[a.packageName] = {
        pauses:  _getAppCount(_PFX_APP_PAUSE,  a.packageName),
        resists: _getAppCount(_PFX_APP_RESIST, a.packageName),
      };
    });

    if (!IS_NATIVE) return map;

    // Step 2a — overlay with native bulk stats (preferred: one bridge call)
    // Only treat bulk stats as authoritative if the call succeeds AND returns
    // a non-empty array.  An empty array means the bridge method exists but
    // no apps are configured there — fall through to individual calls.
    if (typeof N.getIntentionAppStats === 'function') {
      try {
        var raw = N.getIntentionAppStats();
        if (raw) {
          var arr = JSON.parse(raw);
          if (arr.length > 0) {
            arr.forEach(function (item) {
              var pkg      = item.packageName;
              var existing = map[pkg] || { pauses: 0, resists: 0 };
              map[pkg] = {
                pauses:  Math.max(existing.pauses,  item.pauses  || 0),
                resists: Math.max(existing.resists, item.resists || 0),
              };
            });
            return map; // bulk stats merged — we're done
          }
        }
      } catch (_) {}
      // getIntentionAppStats exists but returned empty/threw — fall through
    }

    // Step 2b — fallback: individual bridge calls, still merged with localStorage
    if (typeof N.getIntentionAppPauseCount === 'function') {
      apps.forEach(function (a) {
        try {
          var p        = N.getIntentionAppPauseCount(a.packageName)  || 0;
          var r        = N.getIntentionAppResistCount(a.packageName) || 0;
          var existing = map[a.packageName] || { pauses: 0, resists: 0 };
          map[a.packageName] = {
            pauses:  Math.max(existing.pauses,  p),
            resists: Math.max(existing.resists, r),
          };
        } catch (_) {}
      });
    }

    return map;
  }

  /* ── Configured apps ───────────────────────────────────────── */
  function _getIntentionApps() {
    var apps = [];
    if (IS_NATIVE) {
      try { apps = JSON.parse(N.getIntentionPromptApps() || '[]'); } catch (_) {}
    }
    if (!apps.length) {
      var KW = ['instagram','tiktok','twitter','facebook','reddit','snapchat','youtube','threads'];
      apps = DAILY_USE
        .filter(function (a) { return KW.some(function (kw) { return a.packageName.toLowerCase().includes(kw); }); })
        .slice(0, 3)
        .map(function (a) { return { packageName: a.packageName, name: a.name }; });
    }
    return apps;
  }

  /* ── Render ──────────────────────────────────────────────────── */
  function render() {
    var el = document.getElementById('focus-intention-card');
    if (!el) return;

    var intentionApps = _getIntentionApps();
    var enabled       = S.settings.intentionPrompt === true;
    var counts        = _getPauseCounts();
    var totalPauses   = counts.pauses;
    var totalResists  = counts.resists;

    /* ── Header badge ──────────────────────────────────────────── */
    var statsBadge = '';
    if (totalResists > 0) {
      statsBadge =
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;' +
        'padding:4px 10px;border-radius:99px;background:rgba(18,212,138,.15);' +
        'border:1px solid rgba(18,212,138,.3);color:var(--g)">' +
        totalPauses + ' pause' + (totalPauses !== 1 ? 's' : '') + ' · ' +
        totalResists + ' resist' + (totalResists !== 1 ? 's' : '') + '</div>';
    } else if (totalPauses > 0) {
      statsBadge =
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);' +
        'padding:4px 10px;border-radius:99px;background:var(--s2);' +
        'border:1px solid var(--border2);color:var(--t2)">' +
        totalPauses + ' pause' + (totalPauses !== 1 ? 's' : '') + ' today</div>';
    } else if (enabled) {
      // Feature is ON but no pauses yet today — show "Active" not "0 pauses"
      statsBadge =
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);' +
        'padding:4px 10px;border-radius:99px;background:rgba(18,212,138,.10);' +
        'border:1px solid rgba(18,212,138,.22);color:var(--g)">Active</div>';
    }
    // When disabled + zero counts: show nothing (the toggle already signals state)

    var headerHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<div class="intention-badge">✦ Mindful Pause</div>' +
        statsBadge +
      '</div>';

    /* ── Description ─────────────────────────────────────────── */
    var descHtml =
      '<div style="font-family:var(--ff-m);font-size:var(--text-xs);color:var(--t2);' +
      'line-height:1.55;margin-bottom:12px">' +
        'Before opening these apps, Aurelo asks <em>"What are you looking for?"</em>' +
        ' — a 5-second pause that interrupts the automatic scroll reflex.' +
      '</div>';

    /* ── App rows ────────────────────────────────────────────── */
    var appsHtml = '';
    if (intentionApps.length) {
      var visibleApps = intentionApps.slice(0, MAX_VISIBLE);
      var hiddenCount = intentionApps.length - MAX_VISIBLE;
      var _appStatsMap = _getAppStats(); // single call for all per-app counts

      var rowsHtml = visibleApps.map(function (a) {
        var appStats   = _appStatsMap[a.packageName] || { pauses: 0, resists: 0 };
        var appPauses  = appStats.pauses;
        var appResists = appStats.resists;

        var statStr = '';
        if (appPauses > 0 || appResists > 0) {
          statStr = appPauses + ' pause' + (appPauses !== 1 ? 's' : '');
          if (appResists > 0) {
            statStr += ' · <span style="color:var(--g)">' +
              appResists + ' resist' + (appResists !== 1 ? 's' : '') + '</span>';
          }
        } else if (enabled) {
          statStr = '<span style="color:var(--g);font-size:9px">●</span> monitoring';
        }

        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;' +
          'border-bottom:1px solid var(--border)">' +
          '<div style="width:36px;height:36px;border-radius:10px;overflow:hidden;background:var(--s2);' +
            'flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
            appIco(a.packageName, 36, 10) +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1);margin-bottom:2px">' +
              escHtml(a.name) +
            '</div>' +
            (statStr
              ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">' +
                statStr + '</div>'
              : '') +
          '</div>' +
          '<span onclick="event.stopPropagation();FocusMindful.removeApp(\'' + escAttr(a.packageName) + '\')"' +
          ' style="opacity:.4;font-size:18px;cursor:pointer;padding:4px 6px;line-height:1' +
          ';min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center">×</span>' +
        '</div>';
      }).join('');

      var showMoreHtml = hiddenCount > 0
        ? '<div onclick="FocusMindful.showAllApps()" style="text-align:center;padding:9px 0 0;' +
          'font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p);cursor:pointer">' +
          '+ ' + hiddenCount + ' more app' + (hiddenCount !== 1 ? 's' : '') + ' · tap to see all</div>'
        : '';

      var addBtnHtml = (!ProTier.isPro && intentionApps.length >= ProTier.getLimit('MINDFUL_OPENING_UNLIMITED'))
        ? '<div class="focus-chip-add focus-app-slot locked"' +
          ' style="opacity:.6;border-style:dashed;margin-top:10px;width:100%;justify-content:center"' +
          ' onclick="ProTier.triggerUpsell(\'MINDFUL_OPENING_UNLIMITED\')">＋&nbsp;' +
          (typeof proBadge === 'function' ? proBadge(true) : '') + '</div>'
        : '<div onclick="openFocusAppPicker(\'intention\')" class="focus-chip-add"' +
          ' style="margin-top:10px;width:100%;justify-content:center">＋ Add app</div>';

      appsHtml = rowsHtml + showMoreHtml + addBtnHtml +
        '<div id="intention-ceiling-anchor" style="margin-top:4px"></div>';
    } else {
      appsHtml =
        '<div style="margin-bottom:10px">' +
          '<div onclick="openFocusAppPicker(\'intention\')" class="focus-chip-add"' +
          ' style="width:100%;justify-content:center">＋ Choose apps to monitor</div>' +
        '</div>';
    }

    /* ── Toggle row ──────────────────────────────────────────── */
    var toggleHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;' +
      'padding-top:10px;border-top:1px solid var(--border)">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div class="tog ' + (enabled ? 'on' : 'off') + '" onclick="FocusMindful.toggle()">' +
            '<div class="tog-knob"></div>' +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-xs);color:var(--t2)">' +
            (enabled ? 'Enabled · 5-second pause' : 'Tap to enable') +
          '</div>' +
        '</div>' +
      '</div>';

    el.innerHTML = headerHtml + descHtml + appsHtml + toggleHtml;

    var ceilAnchor = document.getElementById('intention-ceiling-anchor');
    if (ceilAnchor) ProTier.applyCeiling(intentionApps.length, 'MINDFUL_OPENING_UNLIMITED', ceilAnchor, null);
  }

  /* ── Show all apps modal ─────────────────────────────────────── */
  function showAllApps() {
    var apps    = _getIntentionApps();
    var counts  = _getPauseCounts();
    var totalP  = counts.pauses;
    var totalR  = counts.resists;
    var enabled = S.settings.intentionPrompt === true;

    var existing = document.getElementById('_mindful-all-modal');
    if (existing) existing.remove();

    var rowsHtml = apps.map(function (a) {
      var _asm = _getAppStats();
      var ap = (_asm[a.packageName] || {}).pauses  || _getAppCount(_PFX_APP_PAUSE,  a.packageName);
      var ar = (_asm[a.packageName] || {}).resists || _getAppCount(_PFX_APP_RESIST, a.packageName);
      var statStr = '';
      if (ap > 0 || ar > 0) {
        statStr = ap + ' pause' + (ap !== 1 ? 's' : '');
        if (ar > 0) statStr += ' · ' + ar + ' resist' + (ar !== 1 ? 's' : '');
      } else if (enabled) {
        statStr = '● monitoring';
      }
      return '<div style="display:flex;align-items:center;gap:12px;padding:11px 0;' +
        'border-bottom:1px solid var(--border)">' +
        '<div style="width:40px;height:40px;border-radius:11px;overflow:hidden;background:var(--s2);' +
          'flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
          appIco(a.packageName, 40, 11) +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:var(--text-base);font-weight:600;color:var(--t1)">' +
            escHtml(a.name) + '</div>' +
          (statStr
            ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);' +
              'color:' + (ap > 0 ? 'var(--g)' : 'var(--t3)') + ';margin-top:2px">' +
              statStr + '</div>'
            : '') +
        '</div>' +
        '<span onclick="event.stopPropagation();FocusMindful.removeApp(\'' + escAttr(a.packageName) + '\');' +
          'document.getElementById(\'_mindful-all-modal\').remove()"' +
          ' style="opacity:.4;font-size:20px;cursor:pointer;padding:6px;min-width:40px;' +
          'min-height:40px;display:flex;align-items:center;justify-content:center">×</span>' +
      '</div>';
    }).join('');

    var headerStats = (totalP > 0 || totalR > 0)
      ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:3px">' +
        totalP + ' paused · <span style="color:var(--g)">' + totalR + ' resisted</span> today</div>'
      : (enabled
          ? '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--g);margin-top:3px">Active · monitoring</div>'
          : '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:3px">Feature is off</div>');

    var modal = document.createElement('div');
    modal.id = '_mindful-all-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);' +
      'display:flex;align-items:flex-end;justify-content:center';
    modal.innerHTML =
      '<div style="background:var(--s1);border-radius:22px 22px 0 0;padding:0 0 32px;' +
      'width:100%;max-width:480px;max-height:82vh;display:flex;flex-direction:column;' +
      'box-shadow:0 -4px 40px rgba(0,0,0,.5)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'padding:18px 18px 14px;border-bottom:1px solid var(--border);flex-shrink:0">' +
          '<div>' +
            '<div style="font-size:var(--text-lg);font-weight:700;color:var(--t1)">Mindful Pause Apps</div>' +
            headerStats +
          '</div>' +
          '<div onclick="document.getElementById(\'_mindful-all-modal\').remove()"' +
          ' style="width:36px;height:36px;border-radius:50%;background:var(--s2);' +
          'border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;' +
          'cursor:pointer;font-size:18px;color:var(--t2)">×</div>' +
        '</div>' +
        '<div style="overflow-y:auto;padding:0 18px;flex:1">' + rowsHtml + '</div>' +
        '<div style="padding:14px 18px 0;flex-shrink:0;display:flex;flex-direction:column;gap:8px">' +
          '<div onclick="document.getElementById(\'_mindful-all-modal\').remove();openFocusAppPicker(\'intention\',true)"' +
          ' style="width:100%;padding:13px;border-radius:13px;background:rgba(108,99,255,.12);' +
          'border:1px solid rgba(108,99,255,.25);font-family:var(--ff-m);font-size:var(--text-sm);' +
          'font-weight:700;color:var(--p);cursor:pointer;text-align:center">Edit in picker →</div>' +
          '<div onclick="document.getElementById(\'_mindful-all-modal\').remove();openFocusAppPicker(\'intention\')"' +
          ' style="width:100%;padding:13px;border-radius:13px;background:rgba(18,212,138,.08);' +
          'border:1px solid rgba(18,212,138,.2);font-family:var(--ff-m);font-size:var(--text-sm);' +
          'font-weight:700;color:var(--g);cursor:pointer;text-align:center">＋ Add more apps</div>' +
        '</div>' +
      '</div>';

    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  /* ── Toggle ──────────────────────────────────────────────────── */
  function toggle() {
    var enabled = S.settings.intentionPrompt === true;
    if (!enabled && IS_NATIVE) {
      var hasOverlay = typeof N.hasOverlayPermission === 'function' && N.hasOverlayPermission();
      if (!hasOverlay) {
        showConfirm(
          'Draw Over Apps Permission',
          'Mindful Pause shows a brief pause screen over your apps. Tap Grant to enable this.',
          function () {
            if (typeof N.requestOverlayPermission === 'function') N.requestOverlayPermission();
            window._pendingIntentionEnable = true;
          },
          'Grant Permission', 'Cancel'
        );
        return;
      }
    }
    applyToggle(!enabled);
  }

  function applyToggle(newEnabled) {
    S.settings.intentionPrompt = newEnabled;
    saveS();
    if (IS_NATIVE) {
      try { N.saveIntentionPromptEnabled(newEnabled); } catch (_) {}
      if (newEnabled && typeof N.saveIntentionPromptApps === 'function') {
        try {
          var stored = JSON.parse(N.getIntentionPromptApps() || '[]');
          if (!stored.length) {
            var defaults = _getIntentionApps();
            if (defaults.length) N.saveIntentionPromptApps(JSON.stringify(defaults));
          }
        } catch (_) {}
      }
    }
    render();
    toast('Mindful Pause ' + (newEnabled ? 'enabled' : 'disabled'), 'info');
  }

  function removeApp(pkg) {
    var apps = _getIntentionApps().filter(function (a) { return a.packageName !== pkg; });
    if (IS_NATIVE) { try { N.saveIntentionPromptApps(JSON.stringify(apps)); } catch (_) {} }
    render();
  }

  /* ── Native callbacks ─────────────────────────────────────────
   * Called by IntentionEngine.kt when user interacts with the
   * pause screen.  The optional `pkg` argument (package name)
   * enables per-app tracking — passed if native code supports it.
   * ─────────────────────────────────────────────────────────── */
 window.onIntentionPause = function (pkg) {
     _incCount(_KEY_PAUSE);
     if (pkg) {
         _incAppCount(_PFX_APP_PAUSE, pkg);
         // Write to bridge prefs directly — this is now the authoritative per-app store
         if (IS_NATIVE && typeof N.recordIntentionAppPause === 'function') {
             try { N.recordIntentionAppPause(pkg); } catch (_) {}
         }
     }
     render(); // always — no _activeTab guard; no-ops if element absent
 };

 window.onIntentionResist = function (pkg) {
     _incCount(_KEY_RESIST);
     if (pkg) {
         _incAppCount(_PFX_APP_RESIST, pkg);
         if (IS_NATIVE && typeof N.recordIntentionAppResist === 'function') {
             try { N.recordIntentionAppResist(pkg); } catch (_) {}
         }
     }
     render(); // always
 };

  return {
    render      : render,
    toggle      : toggle,
    applyToggle : applyToggle,
    removeApp   : removeApp,
    getApps     : _getIntentionApps,
    showAllApps : showAllApps,
  };
})();

function removeIntentionApp(pkg)  { FocusMindful.removeApp(pkg); }
function toggleIntentionPrompt()  { FocusMindful.toggle(); }