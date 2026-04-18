'use strict';
/* ═══════════════════════════════════════════════════════════════
 * MINDFUL PAUSE MODULE — app-focus-mindful.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Intention Prompt toggle, app list, pause/resist counters.
 *
 * Public API (via FocusMindful.*):
 *   render()          — renders #focus-intention-card
 *   toggle()          — toggles the intention prompt on/off
 *   applyToggle(bool) — applies after permission check
 *   removeApp(pkg)    — removes one app from the prompt list
 *   getApps()         — returns current intention app list
 * ═══════════════════════════════════════════════════════════════ */
window.FocusMindful = (function () {

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _getIntentionApps() {
    var apps = [];
    if (IS_NATIVE) {
      try { apps = JSON.parse(N.getIntentionPromptApps() || '[]'); } catch (_) {}
    }
    if (!apps.length) {
      // Default to top social apps from usage
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

  /* ── Render ──────────────────────────────────────────────────── */
  function render() {
    var el = document.getElementById('focus-intention-card');
    if (!el) return;

    var intentionApps = _getIntentionApps();
    var enabled       = S.settings.intentionPrompt === true;
    var pauseCount    = IS_NATIVE && typeof N.getIntentionPauseCount  === 'function' ? N.getIntentionPauseCount()  : 0;
    var resistCount   = IS_NATIVE && typeof N.getIntentionResistCount === 'function' ? N.getIntentionResistCount() : 0;

    var statsHtml = pauseCount > 0
      ? '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">' +
          pauseCount + ' paused today' +
          (resistCount > 0
            ? ' · <span style="color:var(--g)">' + resistCount + ' resisted ✓</span>'
            : '') +
        '</div>'
      : '';

    var appChips = intentionApps.length
      ? '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:6px">' +
          intentionApps.slice(0, 3).map(function (a) {
            return '<div class="focus-app-chip blocked" style="pointer-events:auto;cursor:default">' +
              '<div class="focus-chip-ico">' + appIco(a.packageName, 20, 5) + '</div>' +
              '<span>' + a.name.split(' ')[0] + '</span>' +
              '<span onclick="event.stopPropagation();FocusMindful.removeApp(\'' + escAttr(a.packageName) + '\')"' +
              ' style="opacity:.45;font-size:12px;margin-left:2px;cursor:pointer">×</span>' +
            '</div>';
          }).join('') +
          (intentionApps.length > 3
            ? '<div class="focus-app-chip" style="background:var(--s2);border-color:var(--border2);' +
              'color:var(--t3);font-family:var(--ff-m);font-size:10px;cursor:default">+' +
              (intentionApps.length - 3) + '</div>'
            : '') +
          ((!ProTier.isPro && intentionApps.length >= ProTier.getLimit('MINDFUL_OPENING_UNLIMITED'))
            ? '<div class="focus-chip-add focus-app-slot locked" style="opacity:.6;border-style:dashed"' +
              ' onclick="ProTier.triggerUpsell(\'MINDFUL_OPENING_UNLIMITED\')">＋&nbsp;' +
              (typeof proBadge === 'function' ? proBadge(true) : '') + '</div>'
            : '<div onclick="openFocusAppPicker(\'intention\')" class="focus-chip-add">＋</div>') +
        '</div>' +
        '<div id="intention-ceiling-anchor" style="margin-bottom:6px"></div>'
      : '<div style="margin-bottom:12px">' +
          '<div onclick="openFocusAppPicker(\'intention\')" class="focus-chip-add">＋ Choose apps</div>' +
        '</div>';

    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<div class="intention-badge">✦ Science-backed</div>' +
      '</div>' +
      '<div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:5px">Pause before you scroll</div>' +
      '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.6;margin-bottom:10px">' +
        'Before opening these apps, Aurelo asks "What are you looking for?" — a 5-second pause' +
        ' that interrupts the automatic scroll reflex.' +
      '</div>' +
      appChips +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div class="tog ' + (enabled ? 'on' : 'off') + '" onclick="FocusMindful.toggle()">' +
            '<div class="tog-knob"></div>' +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t2)">' +
            (enabled ? 'Enabled · 5s pause' : 'Disabled') +
          '</div>' +
        '</div>' +
        statsHtml +
      '</div>';

    // Ceiling nudge
    var ceilAnchor = document.getElementById('intention-ceiling-anchor');
    if (ceilAnchor) {
      ProTier.applyCeiling(intentionApps.length, 'MINDFUL_OPENING_UNLIMITED', ceilAnchor, null);
    }
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
      // On first enable, persist defaults so native overlay fires immediately
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

  /* ── Native event: user resisted a mindful pause ──────────────── */
  window.onIntentionResist = function () {
    if (typeof _activeTab !== 'undefined' && _activeTab === 'focus') render();
  };

  /* ── Public API ────────────────────────────────────────────────── */
  return {
    render,
    toggle,
    applyToggle,
    removeApp,
    getApps: _getIntentionApps,
  };
})();

/* ── Global shims for any remaining direct calls ─────────────── */
function removeIntentionApp(pkg) { FocusMindful.removeApp(pkg); }
function toggleIntentionPrompt() { FocusMindful.toggle(); }