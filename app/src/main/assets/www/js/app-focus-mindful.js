'use strict';
/* ═══════════════════════════════════════════════════════════════
 * MINDFUL PAUSE MODULE — app-focus-mindful.js
 *
 * FIX #3: Horizontal per-app layout with pause/resist counts,
 *         total badge at top, max 3 apps visible, "show more"
 *         link opens a modal (similar to add-apps picker).
 * ═══════════════════════════════════════════════════════════════ */
window.FocusMindful = (function () {

  var MAX_VISIBLE = 5; // max apps shown before "show more"

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _getIntentionApps() {
    var apps = [];
    if (IS_NATIVE) {
      try { apps = JSON.parse(N.getIntentionPromptApps() || '[]'); } catch (_) {}
    }
    if (!apps.length) {
      var KW = ['instagram','tiktok','twitter','facebook','reddit','snapchat','youtube','threads'];
      apps = DAILY_USE
        .filter(function (a) {
          return KW.some(function (kw) { return a.packageName.toLowerCase().includes(kw); });
        })
        .slice(0, 3)
        .map(function (a) { return { packageName: a.packageName, name: a.name }; });
    }
    return apps;
  }

  /* Returns per-app stats {pkg: {pauses, resists}} if the bridge supports it,
     otherwise returns {} and the caller falls back to aggregate totals.        */
  function _getPerAppStats() {
    if (!IS_NATIVE) return {};
    try {
      if (typeof N.getIntentionStatsPerApp === 'function') {
        var raw = JSON.parse(N.getIntentionStatsPerApp() || '[]');
        var map = {};
        raw.forEach(function(s){ map[s.packageName] = { pauses: s.pauses || 0, resists: s.resists || 0 }; });
        return map;
      }
    } catch (_) {}
    return {};
  }

  /* ── Render ──────────────────────────────────────────────────── */
  function render() {
    var el = document.getElementById('focus-intention-card');
    if (!el) return;

    var intentionApps = _getIntentionApps();
    var enabled       = S.settings.intentionPrompt === true;
    var totalPauses   = IS_NATIVE && typeof N.getIntentionPauseCount  === 'function' ? (N.getIntentionPauseCount()  || 0) : 0;
    var totalResists  = IS_NATIVE && typeof N.getIntentionResistCount === 'function' ? (N.getIntentionResistCount() || 0) : 0;
    var perApp        = _getPerAppStats();
    var hasPerApp     = Object.keys(perApp).length > 0;

    // ── Header row ──────────────────────────────────────────────
    var headerHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div class="intention-badge">✦ Mindful Pause</div>' +
        '</div>' +
        (totalResists > 0
          ? '<div style="font-family:var(--ff-m);font-size:11px;font-weight:700;' +
            'padding:3px 10px;border-radius:99px;background:rgba(18,212,138,.15);' +
            'border:1px solid rgba(18,212,138,.3);color:var(--g)">' +
            totalResists + ' resist' + (totalResists !== 1 ? 's' : '') + '</div>'
          : (totalPauses > 0
            ? '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3)">' +
              totalPauses + ' paused today</div>'
            : '')) +
      '</div>';

    // ── Description ──────────────────────────────────────────────
    var descHtml =
      '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.5;margin-bottom:12px">' +
        'Before opening these apps, Aurelo asks <em>"What are you looking for?"</em> — a 5-second pause that interrupts the automatic scroll reflex.' +
      '</div>';

    // ── Per-app rows ─────────────────────────────────────────────
    var appsHtml = '';
    if (intentionApps.length) {
      var visibleApps = intentionApps.slice(0, MAX_VISIBLE);
      var hiddenCount = intentionApps.length - MAX_VISIBLE;

      var rowsHtml = visibleApps.map(function (a) {
        var stats   = perApp[a.packageName] || null;
        var pauses  = stats ? stats.pauses  : (hasPerApp ? 0 : null);
        var resists = stats ? stats.resists : (hasPerApp ? 0 : null);

        var statStr = '';
        if (pauses !== null) {
          statStr = pauses + ' pause' + (pauses !== 1 ? 's' : '');
          if (resists > 0) statStr += ' · <span style="color:var(--g)">' + resists + ' resist' + (resists !== 1 ? 's' : '') + '</span>';
        } else if (!hasPerApp && totalPauses > 0) {
          // No per-app breakdown — show aggregate hint on first app only
          statStr = '';
        }

        return '<div style="display:flex;align-items:center;gap:10px;' +
          'padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<div style="width:32px;height:32px;border-radius:9px;overflow:hidden;' +
            'background:var(--s2);flex-shrink:0;display:flex;align-items:center;justify-content:center">' +
            appIco(a.packageName, 32, 8) +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:1px">' +
              escHtml(a.name.split(' ')[0]) +
            '</div>' +
            (statStr
              ? '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">' + statStr + '</div>'
              : '') +
          '</div>' +
          '<span onclick="event.stopPropagation();FocusMindful.removeApp(\'' + escAttr(a.packageName) + '\')"' +
          ' style="opacity:.4;font-size:16px;cursor:pointer;padding:2px 4px;line-height:1">×</span>' +
        '</div>';
      }).join('');

      var showMoreHtml = '';
      if (hiddenCount > 0) {
        showMoreHtml =
          '<div onclick="FocusMindful.showAllApps()" style="text-align:center;' +
          'padding:8px 0 0;font-family:var(--ff-m);font-size:11px;color:var(--p);cursor:pointer">' +
          '+ ' + hiddenCount + ' more app' + (hiddenCount !== 1 ? 's' : '') + ' · tap to see all</div>';
      }

      var addBtnHtml = (!ProTier.isPro && intentionApps.length >= ProTier.getLimit('MINDFUL_OPENING_UNLIMITED'))
        ? '<div class="focus-chip-add focus-app-slot locked" style="opacity:.6;border-style:dashed;margin-top:10px;width:100%;justify-content:center"' +
          ' onclick="ProTier.triggerUpsell(\'MINDFUL_OPENING_UNLIMITED\')">＋&nbsp;' +
          (typeof proBadge === 'function' ? proBadge(true) : '') + '</div>'
        : '<div onclick="openFocusAppPicker(\'intention\')" class="focus-chip-add"' +
          ' style="margin-top:10px;width:100%;justify-content:center">＋ Add app</div>';

      appsHtml = rowsHtml + showMoreHtml + addBtnHtml + '<div id="intention-ceiling-anchor" style="margin-top:4px"></div>';
    } else {
      appsHtml =
        '<div style="margin-bottom:10px">' +
          '<div onclick="openFocusAppPicker(\'intention\')" class="focus-chip-add"' +
          ' style="width:100%;justify-content:center">＋ Choose apps</div>' +
        '</div>';
    }

    // ── Toggle row ───────────────────────────────────────────────
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
    var apps    = _getIntentionApps();
    var perApp  = _getPerAppStats();
    var totalP  = IS_NATIVE && typeof N.getIntentionPauseCount  === 'function' ? (N.getIntentionPauseCount()  || 0) : 0;
    var totalR  = IS_NATIVE && typeof N.getIntentionResistCount === 'function' ? (N.getIntentionResistCount() || 0) : 0;

    var existing = document.getElementById('_mindful-all-modal');
    if (existing) existing.remove();

    var rowsHtml = apps.map(function (a) {
      var stats   = perApp[a.packageName] || {};
      var pauses  = stats.pauses  || 0;
      var resists = stats.resists || 0;
      var statStr = Object.keys(perApp).length > 0
        ? (pauses + ' pause' + (pauses !== 1 ? 's' : '') +
           (resists > 0 ? ' · ' + resists + ' resist' + (resists !== 1 ? 's' : '') : ''))
        : (totalP > 0 ? 'tracked' : '');
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
                totalP + ' paused · <span style=\'color:var(--g)\'>' + totalR + ' resisted</span> today</div>'
              : '') +
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
    var enabled    = S.settings.intentionPrompt === true;
    var newEnabled = !enabled;
    if (newEnabled && IS_NATIVE) {
      var hasOverlay = typeof N.hasOverlayPermission === 'function' && N.hasOverlayPermission();
      if (!hasOverlay) {
        showConfirm(
          'Draw Over Apps Permission',
          'Mindful Pause shows a brief pause screen over your apps. Tap Grant to enable this — you can revoke it any time in Android Settings.',
          function () {
            if (typeof N.requestOverlayPermission === 'function') N.requestOverlayPermission();
            window._pendingIntentionEnable = true;
          },
          'Grant Permission', 'Cancel'
        );
        return;
      }
    }
    applyToggle(newEnabled);
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

  /* ── Remove one app ──────────────────────────────────────────── */
  function removeApp(pkg) {
    var apps = _getIntentionApps().filter(function (a) { return a.packageName !== pkg; });
    if (IS_NATIVE) { try { N.saveIntentionPromptApps(JSON.stringify(apps)); } catch (_) {} }
    render();
  }

  window.onIntentionResist = function () {
    if (typeof _activeTab !== 'undefined' && _activeTab === 'focus') render();
  };

  return { render, toggle, applyToggle, removeApp, getApps: _getIntentionApps, showAllApps };
})();

function removeIntentionApp(pkg) { FocusMindful.removeApp(pkg); }
function toggleIntentionPrompt() { FocusMindful.toggle(); }