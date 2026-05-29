/* ═══ app-health-connect.js — Health Connect integration (Pro feature) ════════
 * Manages HC state, score calculations, and all HC UI rendering.
 *
 * Depends on (globals):
 *   IS_NATIVE, N (bridge)        — pref read/write via AppBridge
 *   ProTier                       — pro gate
 *   activateTab, toast            — navigation + toasts
 *   renderAureloScore             — home score re-render after connect/disconnect
 *
 * Native bridge methods consumed (all via AppBridge.* on Android):
 *   getHCStatus()          → {status, connected, lastSyncTs}
 *   getHCData()            → full HC data JSON
 *   requestHCPermissions() → triggers system permission sheet
 *   disconnectHC()         → revokes permissions
 *   syncHCData()           → force refresh
 *   getHCBodyScore()       → Int
 *   getHCActivityModifier()→ {modifier, label, steps}
 *   getHCSleepData()       → {durScore, oHrvScore, …}
 *   openHCPlayStore()      → deep-link for Android 9–13
 *   openHCSettings()       → HC system settings (API 34+) or Play Store
 *
 * CSS tokens used: --hc, --hc-dim, --hc-border (defined in tokens.css)
 * ══════════════════════════════════════════════════════════════════════════════ */

/* global IS_NATIVE, N, ProTier, activateTab, toast, renderAureloScore */

const HealthConnect = (function () {
  'use strict';

  /* ── Native bridge helper ────────────────────────────────────────────────
   * On Android all calls go through window.AppBridge (HealthConnectBridge).
   * Falls back gracefully to demo values when running in a browser.       */

  function _bridge(method) {
    try {
      if (typeof window.AppBridge === 'object' && typeof window.AppBridge[method] === 'function')
        return window.AppBridge[method]();
    } catch (_) {}
    return null;
  }

  /* ── State ─────────────────────────────────────────────────── */

  function isConnected() {
    try {
      var s = _bridge('getHCStatus');
      if (s) return JSON.parse(s).connected === true;
    } catch (_) {}
    try { return localStorage.getItem('hc_connected') === '1'; } catch (_) { return false; }
  }

  /* ── HC data ──────────────────────────────────────────────────
   * On device: HealthConnectBridge.getHCData() returns real SDK data.
   * In browser/demo: falls back to mock values so the UI still renders. */

  function _getMockData() {
    return {
      steps:             8340,
      hrv:               48,    // ms RMSSD today
      restingHR:         62,    // bpm today
      sleepDuration:     7.2,   // hours last night
      overnightHrv:      51,    // ms overnight
      avgHrv7d:          45,    // personal 7-day avg
      avgRhr7d:          64,
      avgOvernightHrv7d: 48,
      lastSyncTs:        Date.now(),
      mindfulnessSessions: [
        { app: 'Headspace', type: 'Guided',  duration: 15, pts: 8 },
        { app: 'Calm',      type: 'Breathe', duration: 10, pts: 5 },
      ],
    };
  }

  function _getNativeData() {
    try {
      var raw = _bridge('getHCData');
      if (raw) {
      var d = JSON.parse(raw);
      if (d) return d;
      }
    } catch (_) {}
    return null;
  }

  /* ── Body Score — HRV + RHR + Steps → 0–100 ─────────────────── */
  // Spec §4.2: computed by BodyScoreCalculator.kt on device.

  function getBodyScore() {
    if (!isConnected()) return -1;
    // On device: delegate to Kotlin (BodyScoreCalculator.compute)
    try {
      var score = parseInt(window.AppBridge.getHCBodyScore(), 10);
      if (!isNaN(score)) return score;
    } catch (_) {}
    // JS fallback (browser / demo)
    // BUG-03 FIX: Updated to match Kotlin fixes F-15, F-24, F-25, F-28.
    // Old algorithm used equal 1/3 weights, HRV floor at avg*0.5, RHR ceiling at avg+20,
    // and a fixed 8,000 step ceiling — all now corrected below.
    var d = _getMockData();
    // F-25: HRV floor tightened to avg*0.70 (was avg*0.50)
    var hrvFloor = d.avgHrv7d * 0.70;
    var hrvScore = d.hrv >= d.avgHrv7d ? 100
      : Math.max(0, Math.round((d.hrv - hrvFloor) / (d.avgHrv7d - hrvFloor) * 100));
    // F-28: RHR ceiling = avg*1.40 (was avg+20 absolute)
    var rhrCeiling = d.avgRhr7d * 1.40;
    var rhrScore = d.restingHR <= d.avgRhr7d ? 100
      : Math.max(0, Math.round((1 - (d.restingHR - d.avgRhr7d) / (rhrCeiling - d.avgRhr7d)) * 100));
    // F-24: personal avg ceiling when avg>8000 (was fixed 8000)
    var _jsStepGoal = 8000;
    try {
      if (typeof window.AppBridge === 'object' && typeof window.AppBridge.getStepGoal === 'function')
        _jsStepGoal = window.AppBridge.getStepGoal();
    } catch(_) {}
    var stepsCeiling = _jsStepGoal;
    var stepsScore = d.steps >= stepsCeiling ? 100
      : Math.max(0, Math.round((d.steps - 2000) / (stepsCeiling - 2000) * 100));
    // F-15: weights 40% steps / 35% HRV / 25% RHR (was equal 1/3 each)
    return Math.round(stepsScore * 0.40 + hrvScore * 0.35 + rhrScore * 0.25);
  }

  /* ── Activity modifier for Screen Score ──────────────────────── */
  // Spec §5.2: computed by ScreenScoreEnhancer.kt on device.

  function getActivityModifier() {
    if (!isConnected()) return { modifier: 0, label: null, steps: 0 };
    try {
      var raw = window.AppBridge.getHCActivityModifier();
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    // JS fallback
    // BUG-14 FIX: Old code read from _getMockData() (hardcoded 8,340 steps) which always
    // returned a +3 bonus even on real low-activity days on native. Now try _getNativeData()
    // first and only fall back to mock when genuinely in browser/demo (not IS_NATIVE).
    var liveData = (typeof IS_NATIVE !== 'undefined' && IS_NATIVE) ? _getNativeData() : null;
    var steps = (liveData && typeof liveData.steps === 'number' && liveData.steps >= 0)
      ? liveData.steps
      : ((typeof IS_NATIVE !== 'undefined' && IS_NATIVE) ? 0 : _getMockData().steps);
    if (steps >= 10000) return { modifier: +5, label: '+5 pts · very active day', steps: steps };
    if (steps >= 8000)  return { modifier: +3, label: '+3 pts · active day bonus', steps: steps };
    if (steps >= 5000)  return { modifier: 0,  label: null,                        steps: steps };
    // F-17: smooth linear gradient from -3 at ≤2000 to 0 at 5000 (removes the dead zone)
    var gradient = Math.max(0, Math.min(1, (steps - 2000) / 3000));
    var mod = Math.round(gradient * 3) - 3; // -3 at 2000, 0 at 5000
    mod = Math.max(-3, Math.min(0, mod));
    var label2 = mod <= -2 ? (mod + ' pts · low activity today')
               : mod === -1 ? (mod + ' pt · low activity today')
               : null;
    return { modifier: mod, label: label2, steps: steps };
  }

  /* ── Sleep HC data — sleep duration + overnight HRV ────────── */
  // Spec §7.1: computed by SleepScoreEnhancer.kt on device.

  // F-14: getSleepData now accepts an optional bedtime window so that sessions
  // are filtered to those overlapping the user's configured bedtime window.
  // This prevents afternoon naps from inflating the sleep duration component.
  // F-16 (JS fallback): oversleep ceiling extended from 10h to 11h.
  function getSleepData(bedHour, wakeHour) {
    if (!isConnected()) return null;
    try {
      // Pass bedtime window to native so Kotlin can filter HC sessions server-side
      var raw;
      if (bedHour != null && wakeHour != null &&
          typeof window.AppBridge.getHCSleepDataForWindow === 'function') {
        raw = window.AppBridge.getHCSleepDataForWindow(bedHour, wakeHour);
      } else {
        raw = window.AppBridge.getHCSleepData();
      }
      if (raw) { var s = JSON.parse(raw); if (s && s.available) return s; }
    } catch (_) {}
    // JS fallback (browser/demo)
    var d = _getMockData();
    var durScore;
    if (d.sleepDuration >= 7 && d.sleepDuration <= 9) {
      durScore = 100;
    } else if (d.sleepDuration < 7) {
      durScore = Math.max(0, Math.round((d.sleepDuration - 4) / 3 * 100));
    } else {
      // F-16: (1 - (h-9)/2) * 100 → 100 at 9h, 50 at 10h, 0 at 11h
      durScore = Math.max(0, Math.round((1 - (d.sleepDuration - 9) / 2) * 100));
    }
    // F-25: overnight HRV floor tightened to 70% (30% below avg)
    var avgO = d.avgOvernightHrv7d, oFloor = avgO * 0.70;
    var oHrvScore = d.overnightHrv >= avgO ? 100
      : Math.max(0, Math.round((d.overnightHrv - oFloor) / (avgO - oFloor) * 100));
    return { sleepDuration: d.sleepDuration, overnightHrv: d.overnightHrv,
             avgOHrv: avgO, durScore: durScore, oHrvScore: oHrvScore };
  }

  /* ── External mindfulness sessions for Focus Score ──────────── */
  // Spec §6.2: 50% credit. Source: HealthConnectRepository on device.

  function getMindfulnessSessions() {
    if (!isConnected()) return [];
    try {
      var raw = window.AppBridge.getHCData();
      if (raw) { var d = JSON.parse(raw); if (d && Array.isArray(d.mindfulnessSessions)) return d.mindfulnessSessions; }
    } catch (_) {}
    return _getMockData().mindfulnessSessions;
  }

  /* ── Navigation helper ───────────────────────────────────────── */

  function openSettings() {
    if (typeof activateTab === 'function') activateTab('settings');
    setTimeout(function () {
      var el = document.getElementById('hc-settings-card');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 220);
  }

  /* ── Connect / Disconnect / Sync ───────────────────────────────────────── */

  // window callbacks fired by HealthConnectBridge via evaluateJavascript()
  //
  // granted     — Boolean: true if all HC permissions were granted
  // bodyScore   — Int: initial body score (-1 if denied)
  // needsSettings — Boolean: true when permissions are permanently denied on
  //                 Android 14+ and the user must go to Settings to unblock them
  // ── Issue 3 fix: missingJson carries the list of un-granted permission labels ──
  // Kotlin now passes a JSON array of human-readable names (e.g. ["Sleep", "Steps"])
  // so the dialog can tell the user exactly what is missing instead of a generic message.
  // ── Issue 2 fix: READ_MINDFULNESS is API 35+ only; on older devices it is silently
  // absent from the permission sheet, so "not granted" here may mean "not available on
  // this device" rather than "user denied". The Kotlin side already uses
  // availablePermissions() for the check, so missingJson will be empty in that case
  // and granted will be true. This JS side just needs to handle the labels gracefully.
  // ── Shared helper: refresh every score surface after HC state changes ───────
  // Called on connect, disconnect, and sync so all tabs show consistent data.
  // Invalidates the sleep score cache first so calculateSleep() re-runs with
  // the new HC signal set instead of returning the previous cached result.
  function _refreshAllScores() {
    if (typeof FocusScore !== 'undefined') {
      if (typeof FocusScore.invalidateSleepCache === 'function')
        FocusScore.invalidateSleepCache();          // clear stale sleep cache
      if (typeof FocusScore.renderFocusStaticRow === 'function')
        FocusScore.renderFocusStaticRow();           // Focus tab score row
      if (typeof FocusScore.renderHabitsStaticRow === 'function')
        FocusScore.renderHabitsStaticRow();          // Habits/Sleep tab score row
    }
    if (typeof renderAureloScore === 'function')   renderAureloScore();  // Home Aurelo card
    if (typeof renderFocusStrip  === 'function')   renderFocusStrip();   // Home focus strip
    // Wellness Screen Score is recalculated on next tab open — no explicit refresh needed
  }

  window.onHCPermissionsResult = function (granted, bodyScore, needsSettings, missingJson) {
    if (granted) {
      renderSettingsCard();
      _refreshAllScores();
      if (typeof toast === 'function') toast('Health Connect connected ✓', 'success');
      // FIX (Issue 3): HC just connected — immediately refresh home + visible wellness
      // coach cards so users see HC-enriched insights without restarting the app.
      // The Kotlin bridge already invalidated the Kotlin-side cache; here we also
      // re-render whatever card is currently on screen.
      setTimeout(function () {
        try {
          if (typeof window.renderCoachHomeInsight === 'function') {
            window.renderCoachHomeInsight();
          }
          // Re-render whichever wellness sub-tab is currently visible.
          var wellTab = (typeof window._wellnessView === 'string') ? window._wellnessView : null;
          if (wellTab === 'today'  && typeof window.renderTodayCoachInsight === 'function') window.renderTodayCoachInsight();
          if (wellTab === 'week'   && typeof window.renderWeekCoachInsight  === 'function') window.renderWeekCoachInsight();
          if (wellTab === 'month'  && typeof window.renderMonthCoachInsight === 'function') window.renderMonthCoachInsight();
        } catch (_) {}
      }, 600);
    } else if (needsSettings) {
      // Permanently denied via standard runtime-permission path (should not happen
      // with the HC SDK PermissionController contract, but kept as a safety net).
      var settingsMsg = 'Go to Health Connect › App permissions › Aurelo and enable the permissions manually, then come back and tap Connect.';
      var missing = [];
      try { if (missingJson) missing = JSON.parse(missingJson); } catch (_) {}
      if (missing.length) {
        settingsMsg = 'These permissions are not yet granted: ' + missing.join(', ') + '.\n\nOpen Health Connect › App permissions › Aurelo to enable them, then return and tap Connect.';
      }
      if (typeof showConfirm === 'function') {
        showConfirm(
          'Permissions needed',
          settingsMsg,
          function () {
            try { window.AppBridge.openHCSettings(); } catch (_) {}
          },
          'Open Health Connect',
          false
        );
      } else {
        try { window.AppBridge.openHCSettings(); } catch (_) {}
      }
    } else {
      // User dismissed the HC permission sheet without granting all permissions,
      // or granted only some. Build a specific message from the missing list if available.
      var missing = [];
      try { if (missingJson) missing = JSON.parse(missingJson); } catch (_) {}
      var detailMsg = missing.length
        ? 'These permissions were not granted: ' + missing.join(', ') + '.\n\nTap "Try again" to re-open the permissions screen, or open Health Connect to grant them manually.'
        : 'Aurelo needs all Health Connect permissions to calculate your Body Score. Tap "Try again" to re-open the permissions screen, or open Health Connect settings to manage them manually.';
      if (typeof showConfirm === 'function') {
        showConfirm(
          'Permissions needed',
          detailMsg,
          function () {
            // Re-trigger the permission sheet directly
            try { window.AppBridge.requestHCPermissions(); } catch (_) {}
          },
          'Try again',
          'Cancel'
        );
      } else {
        if (typeof toast === 'function') toast('Health Connect permissions not granted', 'warn');
      }
    }
  };
  // ── Issue 1 fix (extended): render settings card on first tab visit ──────────
  // The original fix only hooked onAppResume (fired by MainActivity.onResume), which
  // fires when the native app returns from the background — but NOT when the user
  // navigates to the settings tab for the first time within the same session.
  // This left #hc-settings-inner blank until a full app resume ("refresh").
  //
  // Two additional hooks close the gap:
  //   1. DOMContentLoaded  — paints the card as soon as the DOM is ready on initial load.
  //   2. activateTab patch — re-renders the card every time the user opens the settings
  //                          tab, keeping it in sync after connect/disconnect/sync actions
  //                          that may have happened while another tab was active.

  // 1. Initial paint on page load
  document.addEventListener('DOMContentLoaded', function () {
    renderSettingsCard();
  });

  // 2. Re-render on every settings-tab activation
  (function () {
    function _patchActivateTab() {
      var _origActivateTab = window.activateTab;
      window.activateTab = function (tab) {
        var result = typeof _origActivateTab === 'function'
          ? _origActivateTab.apply(this, arguments)
          : undefined;
        if (tab === 'settings') renderSettingsCard();
        return result;
      };
    }
    // Patch immediately if activateTab is already defined, otherwise wait for DOM
    if (typeof window.activateTab === 'function') {
      _patchActivateTab();
    } else {
      document.addEventListener('DOMContentLoaded', _patchActivateTab);
    }
  })();

  // 3. Keep the existing onAppResume hook so the card also refreshes when the
  //    native app returns from the background (e.g. after granting HC permissions
  //    in the system sheet and switching back to Aurelo).
  (function () {
    var _prev = window.onAppResume;
    window.onAppResume = function () {
      renderSettingsCard();
      if (typeof _prev === 'function') _prev();
    };
  })();

  window.onHCSyncComplete = function () {
    renderSettingsCard();
    _refreshAllScores();
    if (typeof toast === 'function') toast('Health Connect synced', 'success');
  };
  window.onHCDisconnected = function () {
    renderSettingsCard();
    _refreshAllScores();
  };

  function connect(onSuccess) {
    try {
      window.AppBridge.requestHCPermissions();
      // Result arrives via window.onHCPermissionsResult callback
    } catch (_) {
      // Browser / demo fallback
      try { localStorage.setItem('hc_connected', '1'); } catch (__) {}
      renderSettingsCard();
      _refreshAllScores();
      if (typeof onSuccess === 'function') onSuccess();
    }
  }

  function disconnect() {
    try {
      window.AppBridge.disconnectHC();
      // Result arrives via window.onHCDisconnected callback
    } catch (_) {
      try { localStorage.setItem('hc_connected', '0'); } catch (__) {}
      renderSettingsCard();
      _refreshAllScores();
    }
  }

  function syncNow() {
    if (typeof toast === 'function') toast('Syncing Health Connect data…', 'info');
    try {
      window.AppBridge.syncHCData();
      // Completion fires window.onHCSyncComplete
    } catch (_) {
      setTimeout(function () {
        renderSettingsCard();
        if (typeof toast === 'function') toast('Health Connect synced', 'success');
      }, 1200);
    }
  }

  /* ── Connect tap — pro-gated ─────────────────────────────────── */

  function _onConnectTap() {
    if (typeof ProTier !== 'undefined' && !ProTier.isPro) {
      ProTier.triggerUpsell('HEALTH_CONNECT');
      return;
    }

    // Check HC availability before attempting to request permissions.
    // On Android 9–13 the Health Connect app may not be installed yet
    // (status === 'NEEDS_INSTALL'). In that case redirect to the Play Store
    // instead of silently failing with a non-functional permission dialog.
    var hcStatus = 'AVAILABLE'; // safe default for browser/demo
    try {
      if (typeof window.AppBridge === 'object' && window.AppBridge) {
        var raw = window.AppBridge.getHCStatus();
        if (raw) hcStatus = (JSON.parse(raw).status || 'AVAILABLE');
      }
    } catch (_) {}

    if (hcStatus === 'NOT_SUPPORTED') {
      if (typeof toast === 'function') toast('Health Connect is not supported on this device', 'warn');
      return;
    }

    if (hcStatus === 'NEEDS_INSTALL') {
      if (typeof showConfirm === 'function') {
        showConfirm(
          'Install Health Connect?',
          'Health Connect is not installed on this device. Install it from the Play Store to enable body, sleep and activity data.',
          function () {
            try { window.AppBridge.openHCPlayStore(); } catch (_) {}
          },
          'Go to Play Store',
          false
        );
      } else {
        try { window.AppBridge.openHCPlayStore(); } catch (_) {}
      }
      return;
    }

    // AVAILABLE — proceed with normal permission flow
    if (typeof showConfirm === 'function') {
      showConfirm(
        'Connect Health Connect?',
        'Aurelo will read sleep, HRV, steps, resting heart rate and mindfulness sessions — read-only, never writes. Revoke at any time.',
        function () {
          connect(function () {
            if (typeof toast === 'function') toast('Health Connect connected', 'success');
          });
        },
        'Connect',
        false
      );
    } else {
      connect(function () {
        if (typeof toast === 'function') toast('Health Connect connected', 'success');
      });
    }
  }

  /* ── Settings card (rendered into #hc-settings-inner) ────────── */

  function renderSettingsCard() {
    var el = document.getElementById('hc-settings-inner');
    if (!el) return;

    var connected = isConnected();
    var statusDot  = connected ? 'var(--g)' : 'var(--r)';
    var statusText = connected ? 'Connected' : 'Not connected';
    var statusCol  = connected ? 'var(--g)' : 'var(--r)';

    var syncLine = '';
    if (connected) {
      var _hcStatus = {}; try { _hcStatus = JSON.parse(window.AppBridge.getHCStatus() || '{}'); } catch(_){}
      var ms = _hcStatus.lastSyncTs || _getMockData().lastSyncTs;
      var mins = Math.round((Date.now() - ms) / 60000);
      syncLine = mins < 1  ? 'Synced just now'
               : mins < 60 ? 'Synced ' + mins + 'm ago'
               : 'Synced ' + Math.round(mins / 60) + 'h ago';
    }

    var dataRows = [
      'Sleep sessions',
      'HRV (overnight)',
      'Daily steps',
      'Resting heart rate',
    ];
    var dataGridHtml = dataRows.map(function (label) {
      return '<div style="display:flex;align-items:center;gap:7px;font-size:var(--text-sm);color:var(--t1)">'
        + '<div style="width:5px;height:5px;border-radius:50%;background:var(--hc);flex-shrink:0"></div>'
        + label + '</div>';
    }).join('');

    var stepGoal = 8000;
    try {
      if (typeof window.AppBridge === 'object' && typeof window.AppBridge.getStepGoal === 'function')
        stepGoal = window.AppBridge.getStepGoal();
    } catch (_) {}

    var stepGoalRowHtml = connected
      ? '<div style="margin-top:14px;padding:12px 14px;background:var(--s2);border:1px solid var(--border2);border-radius:var(--rad-sm)">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
            + '<div>'
              + '<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1)">Daily Step Goal</div>'
              + '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Affects Body Score · 100 pts when met</div>'
            + '</div>'
            + '<div style="font-family:var(--ff-d);font-size:18px;font-weight:700;color:var(--hc)" id="hc-step-goal-val">' + stepGoal.toLocaleString() + ' steps</div>'
          + '</div>'
          + '<input type="range" min="2000" max="15000" step="500" value="' + stepGoal + '" id="hc-step-goal-slider"'
            + ' style="width:100%;accent-color:var(--hc);cursor:pointer"'
            + ' oninput="HealthConnect._onStepGoalChange(this.value)"'
            + ' onchange="HealthConnect._onStepGoalSave(this.value)">'
          + '<div style="display:flex;justify-content:space-between;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">'
            + '<span>2,000</span><span>15,000</span>'
          + '</div>'
        + '</div>'
      : '';

    var stepGoal = 8000;
    try {
      if (typeof window.AppBridge === 'object' && typeof window.AppBridge.getStepGoal === 'function')
        stepGoal = window.AppBridge.getStepGoal();
    } catch (_) {}

    var stepGoalRowHtml = connected
      ? '<div style="margin-top:14px;padding:12px 14px;background:var(--s2);border:1px solid var(--border2);border-radius:var(--rad-sm)">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
            + '<div>'
              + '<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1)">Daily Step Goal</div>'
              + '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Affects Body Score · 100 pts when met</div>'
            + '</div>'
            + '<div style="font-family:var(--ff-d);font-size:18px;font-weight:700;color:var(--hc)" id="hc-step-goal-val">' + stepGoal.toLocaleString() + ' steps</div>'
          + '</div>'
          + '<input type="range" min="2000" max="15000" step="500" value="' + stepGoal + '" id="hc-step-goal-slider"'
            + ' style="width:100%;accent-color:var(--hc);cursor:pointer"'
            + ' oninput="HealthConnect._onStepGoalChange(this.value)"'
            + ' onchange="HealthConnect._onStepGoalSave(this.value)">'
          + '<div style="display:flex;justify-content:space-between;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">'
            + '<span>2,000</span><span>15,000</span>'
          + '</div>'
        + '</div>'
      : '';

    var actionHtml = connected
      ? stepGoalRowHtml
        + '<div style="display:flex;gap:8px;margin-top:10px">'
          + '<button type="button" onclick="HealthConnect.syncNow()" '
          + 'style="flex:1;padding:11px;border-radius:var(--rad-sm);background:var(--s3);'
          + 'border:1px solid var(--border2);color:var(--t2);font-family:var(--ff-m);'
          + 'font-size:var(--text-xs);font-weight:var(--fw-semibold);cursor:pointer">⟳ Sync now</button>'
          + '<button type="button" onclick="HealthConnect.disconnect()" '
          + 'style="flex:1;padding:11px;border-radius:var(--rad-sm);background:rgba(240,78,122,.10);'
          + 'border:1px solid rgba(240,78,122,.25);color:var(--r);font-family:var(--ff-m);'
          + 'font-size:var(--text-xs);font-weight:var(--fw-semibold);cursor:pointer">Disconnect</button>'
          + '</div>'
          + '<div style="margin-top:10px;font-size:var(--text-2xs);color:var(--t3);cursor:pointer">Privacy policy ›</div>'
      : '<button type="button" onclick="HealthConnect._onConnectTap()" '
          + 'style="width:100%;padding:13px;border-radius:var(--rad-md);'
          + 'background:linear-gradient(135deg,var(--hc),var(--c));'
          + 'color:#fff;border:none;font-family:var(--ff-m);'
          + 'font-size:var(--text-sm);font-weight:var(--fw-bold);cursor:pointer;margin-top:14px">'
          + 'Connect Health Connect</button>';

    el.innerHTML =
      '<div style="background:var(--s1);border-radius:var(--rad-lg);border:1px solid var(--border2);overflow:hidden">'
        // ── Header ─────────────────────────────────────────────
        + '<div style="padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)">'
          + '<div style="width:40px;height:40px;border-radius:10px;'
          + 'background:linear-gradient(135deg,var(--hc),var(--c));'
          + 'display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          + '<svg width="20" height="20" viewBox="0 0 20 20" fill="white">'
          + '<path d="M10 3C10 3 6.5 7 6.5 10.5C6.5 12.5 8 14 10 14C12 14 13.5 12.5 13.5 10.5C13.5 7 10 3 10 3Z"/>'
          + '</svg></div>'
          + '<div style="flex:1">'
            + '<div style="font-size:var(--text-md);font-weight:var(--fw-semibold);color:var(--t1)">Health Connect</div>'
            + '<div style="display:flex;align-items:center;gap:5px;margin-top:2px">'
              + '<div style="width:6px;height:6px;border-radius:50%;background:' + statusDot + '"></div>'
              + '<span style="font-size:var(--text-xs);color:' + statusCol + '">' + statusText + '</span>'
              + (connected && syncLine
                  ? '<span style="font-size:var(--text-2xs);color:var(--t3);margin-left:4px">· ' + syncLine + '</span>'
                  : '')
            + '</div>'
          + '</div>'
        + '</div>'
        // ── Body ───────────────────────────────────────────────
        + '<div style="padding:14px 16px">'
          + '<div style="font-size:var(--text-2xs);color:var(--t3);text-transform:uppercase;'
          + 'letter-spacing:0.5px;margin-bottom:10px">AURELO READS — NEVER WRITES</div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'
          + dataGridHtml + '</div>'
          + '<div style="font-size:var(--text-2xs);color:var(--t3);text-transform:uppercase;'
          + 'letter-spacing:0.5px;margin-bottom:6px">MINDFULNESS (FOCUS SCORE)</div>'
          + '<div style="display:flex;align-items:flex-start;gap:7px;font-size:var(--text-sm);'
          + 'color:var(--t1);line-height:1.5;margin-bottom:12px">'
            + '<div style="width:5px;height:5px;border-radius:50%;background:var(--p2);flex-shrink:0;margin-top:6px"></div>'
            + 'Calm, Headspace, Insight Timer — 50% credit toward Focus Score'
          + '</div>'
          + '<div style="background:var(--hc-dim);border:1px solid var(--hc-border);border-radius:var(--rad-sm);'
          + 'padding:10px 12px;font-size:var(--text-xs);color:var(--t3);line-height:1.55;'
          + 'display:flex;gap:8px;align-items:flex-start">'
            + '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;margin-top:2px">'
            + '<rect x="1" y="5" width="12" height="8" rx="1.5" stroke="var(--hc)" stroke-width="1.1"/>'
            + '<path d="M4.5 5V4a2.5 2.5 0 015 0v1" stroke="var(--hc)" stroke-width="1.1" stroke-linecap="round"/>'
            + '</svg>'
            + '<span>Read-only · Data never leaves your device · Revoke anytime</span>'
          + '</div>'
          + actionHtml
        + '</div>'
      + '</div>';
  }

  /* ── Home banner — Pro users who haven't connected HC yet ──── */
  // Spec §4.4: prompt to connect HC from Home tab

  function renderHomeBanner() {
    var el = document.getElementById('hc-home-banner');
    if (!el) return;
    var isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    // Only show for Pro users who haven't connected HC yet
    if (!isPro || isConnected()) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML =
      '<div style="background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.22);' +
      'border-radius:var(--rad-md);padding:12px 14px;display:flex;align-items:center;gap:10px">' +
        '<div style="flex:1;font-size:var(--text-sm);color:var(--t1);line-height:1.55">' +
          'Unlock your <span style="color:var(--hc);font-weight:600">Body pillar</span>' +
          ' — connect Health Connect for steps, HRV and resting heart rate.' +
        '</div>' +
        '<button type="button" onclick="HealthConnect.openSettings()" ' +
        'style="background:var(--p);color:#fff;border:none;border-radius:var(--rad-sm);' +
        'padding:7px 10px;font-size:var(--text-xs);font-weight:var(--fw-semibold);' +
        'cursor:pointer;white-space:nowrap;font-family:var(--ff-b)">Settings →</button>' +
      '</div>';
  }

  function _onStepGoalChange(val) {
    var el = document.getElementById('hc-step-goal-val');
    if (el) el.textContent = parseInt(val, 10).toLocaleString() + ' steps';
  }

  function _onStepGoalSave(val) {
    var goal = parseInt(val, 10);
    try {
      if (typeof window.AppBridge === 'object' && typeof window.AppBridge.saveStepGoal === 'function')
        window.AppBridge.saveStepGoal(goal);
    } catch(_) {}
    _onStepGoalChange(val);
    if (typeof toast === 'function') toast('Step goal updated to ' + goal.toLocaleString(), 'success');
    if (typeof renderAureloScore === 'function') renderAureloScore();
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    isConnected:            isConnected,
    getBodyScore:           getBodyScore,
    getActivityModifier:    getActivityModifier,
    getSleepData:           getSleepData,
    getMindfulnessSessions: getMindfulnessSessions,
    openSettings:           openSettings,
    connect:                connect,
    disconnect:             disconnect,
    syncNow:                syncNow,
    renderSettingsCard:     renderSettingsCard,
    renderHomeBanner:       renderHomeBanner,
    _onConnectTap:          _onConnectTap,
    _onStepGoalChange: _onStepGoalChange,
    _onStepGoalSave:   _onStepGoalSave,
    /** Opens HC system settings (API 34+) or Play Store (API 26–33). */
    openHCSettings: function () {
      try { window.AppBridge.openHCSettings(); } catch (_) {}
    },
    getStepGoal: function() {
      try {
        if (typeof window.AppBridge === 'object' && typeof window.AppBridge.getStepGoal === 'function')
          return window.AppBridge.getStepGoal();
      } catch(_) {}
      return 8000;
    },
    /**
     * Called by pro-gate.js when Pro subscription expires.
     * Silently disconnects Health Connect if currently connected.
     * Safe to call when HC is not connected.
     */
    disconnectOnDowngrade: function () {
      if (!isConnected()) return; // nothing to do
      disconnect();
    },
  };
})();