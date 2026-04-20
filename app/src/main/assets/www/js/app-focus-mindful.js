'use strict';
/* ═══════════════════════════════════════════════════════════════
 * MINDFUL PAUSE MODULE — app-focus-mindful.js
 *
 * KEY BUG FIX: IntentionEngine.kt stores counts under keys
 * "focus_intention_pause_count" / "focus_intention_resist_count"
 * but IntentionPromptBridge.kt reads "intention_pause_count" /
 * "intention_resist_count" (missing "focus_" prefix) — so
 * N.getIntentionPauseCount() always returns 0.
 *
 * Workaround: maintain JS-side daily counters incremented by the
 * onIntentionPause / onIntentionResist native callbacks, which
 * IntentionEngine fires correctly.  Persisted to localStorage
 * so they survive renders within the same day.
 * ═══════════════════════════════════════════════════════════════ */
window.FocusMindful = (function () {

  var MAX_VISIBLE = 5;
  var _JS_PAUSE_KEY  = 'mp_pause_count';
  var _JS_RESIST_KEY = 'mp_resist_count';
  var _JS_DATE_KEY   = 'mp_date';

  /* ── JS-side daily counter helpers ──────────────────────────── */
  function _todayStr() {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  function _getJsCount(key) {
    try {
      if (localStorage.getItem(_JS_DATE_KEY) !== _todayStr()) return 0;
      return parseInt(localStorage.getItem(key) || '0', 10) || 0;
    } catch (_) { return 0; }
  }

  function _incJsCount(key) {
    try {
      var today = _todayStr();
      if (localStorage.getItem(_JS_DATE_KEY) !== today) {
        localStorage.setItem(_JS_DATE_KEY, today);
        localStorage.setItem(_JS_PAUSE_KEY, '0');
        localStorage.setItem(_JS_RESIST_KEY, '0');
      }
      var cur = parseInt(localStorage.getItem(key) || '0', 10) || 0;
      localStorage.setItem(key, String(cur + 1));
      return cur + 1;
    } catch (_) { return 0; }
  }

  /* Read counts — JS-side counters are authoritative (see header note) */
  function _getPauseCounts() {
    var pauses  = _getJsCount(_JS_PAUSE_KEY);
    var resists = _getJsCount(_JS_RESIST_KEY);
    // Also try the native bridge as a secondary check; take max to be safe
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

  /* ── Helpers ─────────────────────────────────────────────────── */
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

    // ── Header badge — always shown ───────────────────────────────
    var statsBadge = totalResists > 0
      ? '<div style="font-family:var(--ff-m);font-size:11px;font-weight:700;' +
        'padding:3px 10px;border-radius:99px;background:rgba(18,212,138,.15);' +
        'border:1px solid rgba(18,212,138,.3);color:var(--g)">' +
        totalPauses + ' pauses · ' + totalResists + ' resists</div>'
      : (totalPauses > 0
        ? '<div style="font-family:var(--ff-m);font-size:11px;' +
          'padding:3px 10px;border-radius:99px;background:var(--s2);' +
          'border:1px solid var(--border2);color:var(--t3)">' +
          totalPauses + ' paused today</div>'
        : '<div style="font-family:var(--ff-m);font-size:11px;' +
          'padding:3px 10px;border-radius:99px;background:var(--s2);' +
          'border:1px solid var(--border2);color:var(--t3)">0 pauses today</div>');

    var headerHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<div class="intention-badge">✦ Mindful Pause</div>' +
        statsBadge +
      '</div>';

    // ── Description ───────────────────────────────────────────────
    var descHtml =
      '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.5;margin-bottom:12px">' +
        'Before opening these apps, Aurelo asks <em>"What are you looking for?"</em> — a 5-second pause that interrupts the automatic scroll reflex.' +
      '</div>';

    // ── App rows ──────────────────────────────────────────────────
    var appsHtml = '';
    if (intentionApps.length) {
      var visibleApps = intentionApps.slice(0, MAX_VISIBLE);
      var hiddenCount = intentionApps.length - MAX_VISIBLE;

      var rowsHtml = visibleApps.map(function (a) {
        // Per-app breakdown is not available from the native bridge (key mismatch in
        // IntentionEngine vs IntentionPromptBridge). Show aggregate stats on each row
        // as context; this is better than showing nothing or wrong zeros.
        var statStr = '';
        if (totalPauses > 0 || totalResists > 0) {
          statStr = totalPauses + ' pause' + (totalPauses !== 1 ? 's' : '') + ' today';
          if (totalResists > 0) {
            statStr += ' · <span style="color:var(--g)">' + totalResists + ' resist' + (totalResists !== 1 ? 's' : '') + '</span>';
          }
        }

        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<div style="width:32px;height:32px;border-radius:9px;overflow:hidden;background:var(--s2);' +
            'flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
            appIco(a.packageName, 32, 8) +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:1px">' +
              escHtml(a.name.split(' ')[0]) +
            '</div>' +
            (statStr ? '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">' + statStr + '</div>' : '') +
          '</div>' +
          '<span onclick="event.stopPropagation();FocusMindful.removeApp(\'' + escAttr(a.packageName) + '\')"' +
          ' style="opacity:.4;font-size:16px;cursor:pointer;padding:2px 4px;line-height:1">×</span>' +
        '</div>';
      }).join('');

      var showMoreHtml = hiddenCount > 0
        ? '<div onclick="FocusMindful.showAllApps()" style="text-align:center;padding:8px 0 0;' +
          'font-family:var(--ff-m);font-size:11px;color:var(--p);cursor:pointer">' +
          '+ ' + hiddenCount + ' more app' + (hiddenCount !== 1 ? 's' : '') + ' · tap to see all</div>'
        : '';

      var addBtnHtml = (!ProTier.isPro && intentionApps.length >= ProTier.getLimit('MINDFUL_OPENING_UNLIMITED'))
        ? '<div class="focus-chip-add focus-app-slot locked" style="opacity:.6;border-style:dashed;margin-top:10px;width:100%;justify-content:center"' +
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
          ' style="width:100%;justify-content:center">＋ Choose apps</div>' +
        '</div>';
    }

    // ── Toggle ────────────────────────────────────────────────────
    var toggleHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;' +
      'padding-top:10px;border-top:1px solid var(--border)">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div class="tog ' + (enabled ? 'on' : 'off') + '" onclick="FocusMindful.toggle()">' +
            '<div class="tog-knob"></div>' +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2)">' +
            (enabled ? 'Enabled · 5s pause' : 'Tap to enable') +
          '</div>' +
        '</div>' +
      '</div>';

    el.innerHTML = headerHtml + descHtml + appsHtml + toggleHtml;

    var ceilAnchor = document.getElementById('intention-ceiling-anchor');
    if (ceilAnchor) ProTier.applyCeiling(intentionApps.length, 'MINDFUL_OPENING_UNLIMITED', ceilAnchor, null);
  }

  /* ── Show all apps modal ─────────────────────────────────────── */
  function showAllApps() {
    var apps   = _getIntentionApps();
    var counts = _getPauseCounts();
    var totalP = counts.pauses;
    var totalR = counts.resists;

    var existing = document.getElementById('_mindful-all-modal');
    if (existing) existing.remove();

    var rowsHtml = apps.map(function (a) {
      var statStr = (totalP > 0 || totalR > 0)
        ? totalP + ' pause' + (totalP !== 1 ? 's' : '') + ' today' +
          (totalR > 0 ? ' · ' + totalR + ' resist' + (totalR !== 1 ? 's' : '') : '')
        : '';
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:38px;height:38px;border-radius:10px;overflow:hidden;background:var(--s2);' +
          'flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
          appIco(a.packageName, 38, 10) +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:600;color:var(--t1)">' + escHtml(a.name) + '</div>' +
          (statStr ? '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px">' + statStr + '</div>' : '') +
        '</div>' +
        '<span onclick="event.stopPropagation();FocusMindful.removeApp(\'' + escAttr(a.packageName) + '\');' +
          'document.getElementById(\'_mindful-all-modal\').remove()"' +
          ' style="opacity:.4;font-size:18px;cursor:pointer;padding:4px">×</span>' +
      '</div>';
    }).join('');

    var modal = document.createElement('div');
    modal.id = '_mindful-all-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
    modal.innerHTML =
      '<div style="background:var(--s1);border-radius:22px 22px 0 0;padding:0 0 32px;width:100%;max-width:480px;' +
      'max-height:82vh;display:flex;flex-direction:column;box-shadow:0 -4px 40px rgba(0,0,0,.5)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 18px 14px;' +
        'border-bottom:1px solid var(--border);flex-shrink:0">' +
          '<div>' +
            '<div style="font-size:15px;font-weight:700;color:var(--t1)">Mindful Pause Apps</div>' +
            (totalP > 0 || totalR > 0
              ? '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px">' +
                totalP + ' paused · <span style="color:var(--g)">' + totalR + ' resisted</span> today</div>'
              : '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px">No pauses today yet</div>') +
          '</div>' +
          '<div onclick="document.getElementById(\'_mindful-all-modal\').remove()"' +
          ' style="width:30px;height:30px;border-radius:50%;background:var(--s2);border:1px solid var(--border2);' +
          'display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:var(--t2)">×</div>' +
        '</div>' +
        '<div style="overflow-y:auto;padding:0 18px;flex:1">' + rowsHtml + '</div>' +
        '<div style="padding:14px 18px 0;flex-shrink:0">' +
          '<div onclick="document.getElementById(\'_mindful-all-modal\').remove();openFocusAppPicker(\'intention\',true)"' +
          ' style="width:100%;padding:12px;border-radius:13px;background:rgba(108,99,255,.12);' +
          'border:1px solid rgba(108,99,255,.25);font-family:var(--ff-m);font-size:13px;font-weight:700;' +
          'color:var(--p);cursor:pointer;text-align:center;margin-bottom:8px">Edit in picker →</div>' +
          '<div onclick="document.getElementById(\'_mindful-all-modal\').remove();openFocusAppPicker(\'intention\')"' +
          ' style="width:100%;padding:12px;border-radius:13px;background:rgba(18,212,138,.08);' +
          'border:1px solid rgba(18,212,138,.2);font-family:var(--ff-m);font-size:13px;font-weight:700;' +
          'color:var(--g);cursor:pointer;text-align:center">＋ Add more apps</div>' +
        '</div>' +
      '</div>';

    modal.addEventListener('click', function(e){ if(e.target === modal) modal.remove(); });
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

  /* ── Native callbacks ────────────────────────────────────────── */
  // IntentionEngine.kt calls these when the user acts on the pause screen.
  // We increment JS-side counters here because the native bridge has a key
  // mismatch (IntentionEngine writes "focus_intention_*" keys, bridge reads
  // "intention_*" keys) so N.getIntentionPauseCount() always returns 0.
  window.onIntentionPause = function () {
    _incJsCount(_JS_PAUSE_KEY);
    if (typeof _activeTab !== 'undefined' && _activeTab === 'focus') render();
  };

  window.onIntentionResist = function () {
    _incJsCount(_JS_RESIST_KEY);
    if (typeof _activeTab !== 'undefined' && _activeTab === 'focus') render();
  };

  return { render, toggle, applyToggle, removeApp, getApps: _getIntentionApps, showAllApps };
})();

function removeIntentionApp(pkg) { FocusMindful.removeApp(pkg); }
function toggleIntentionPrompt() { FocusMindful.toggle(); }