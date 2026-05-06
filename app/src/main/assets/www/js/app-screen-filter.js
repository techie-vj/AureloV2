'use strict';
/* ═══════════════════════════════════════════════════════════════
 * SCREEN FILTER MODULE — app-screen-filter.js  v4
 *
 * Standalone first-class card on Focus › Habits tab,
 * placed directly below Bedtime Mode card.
 *
 * Config schema:
 *   { enabled, paused, preset, warmAlpha, dimAlpha,
 *     schedule, schedStartHour, schedStartMin,
 *     schedEndHour, schedEndMin,
 *     schedDays,            ← NEW v4: [Mon..Sun] 0/1 array (7 elements)
 *     fadeIn, fadeOut, excludedApps,
 *     bedtimeAutoApply, bedtimePreset }
 *
 * Fixes in v4:
 *   1. Camera chips collapsed → single "📷 Camera (auto)" chip (was 7–8 chips)
 *   2. Add-app picker uses N.getCachedApps() — N.getInstalledApps() never existed;
 *      field name fixed: a.name (not a.label)
 *   3. Custom time picker: _openTimePicker() bottom-sheet added; time blocks clickable
 *   4. Day-of-week picker added for custom / sun schedule modes
 *   5. _cacheTs refreshed in every mutating fn — dirty changes survive tab switches
 *      and 2-second TTL expiry without being silently discarded
 *   6. _discard() now calls _applyNative() to revert the live overlay, not just the UI
 * ═══════════════════════════════════════════════════════════════ */
window.ScreenFilter = (function () {

  var PRESETS = {
    soft:    { warmAlpha: 40, dimAlpha: 15 },
    medium:  { warmAlpha: 65, dimAlpha: 30 },
    bedtime: { warmAlpha: 80, dimAlpha: 45 },
    custom:  null
  };

  // FIX 1: kept for detection only — never rendered individually anymore
  var CAMERA_PKGS = [
    'com.android.camera', 'com.android.camera2',
    'com.google.android.GoogleCamera', 'com.samsung.android.app.camera',
    'com.oneplus.camera', 'com.miui.camera', 'com.huawei.camera'
  ];

  // FIX 4: day labels Mon→Sun (index 0=Monday … 6=Sunday)
  var DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  var _cfg = null, _cacheTs = 0, _TTL = 2000, _dirty = false;

  /* ── Config ──────────────────────────────────────────────── */
  function _defaults() {
    return {
      enabled: false, paused: false,
      preset: 'bedtime', warmAlpha: 80, dimAlpha: 45,
      schedule: 'none',
      schedStartHour: 21, schedStartMin: 0,
      schedEndHour: 7,   schedEndMin: 0,
      // FIX 4: 7-element array [Mon..Sun], 1=active 0=skip
      schedDays: [1, 1, 1, 1, 1, 1, 1],
      fadeIn: true, fadeOut: true,
      // Camera packages always excluded by default — merged on read, not stored
      excludedApps: [],
      bedtimeAutoApply: true, bedtimePreset: 'bedtime'
    };
  }

  function getCfg() {
    var now = Date.now();
    // FIX 5: never evict cache while there are unsaved changes
    if (_cfg && (_dirty || (now - _cacheTs) < _TTL)) return _cfg;
    var raw = null;
    try {
      raw = (IS_NATIVE && typeof N.getScreenFilterSettings === 'function')
        ? N.getScreenFilterSettings()
        : localStorage.getItem('sfCfg');
    } catch (_) {}
    try { _cfg = Object.assign(_defaults(), JSON.parse(raw || '{}')); }
    catch (_) { _cfg = _defaults(); }
    // Migrate old 'manual' / 'always' schedule values to 'none'
    if (_cfg.schedule === 'manual' || _cfg.schedule === 'always' || !_cfg.schedule) {
      _cfg.schedule = 'none';
    }
    // Ensure schedDays is always a valid 7-element array after merge
    if (!Array.isArray(_cfg.schedDays) || _cfg.schedDays.length !== 7) {
      _cfg.schedDays = [1, 1, 1, 1, 1, 1, 1];
    }
    // Camera packages merged at read time — NOT stored in prefs
    // FIX 1: do NOT push individual camera pkgs into excludedApps for display;
    // they are represented by a single synthetic marker instead.
    // We keep them out of the stored list entirely; _buildExcludedAppsHtml handles display.
    _cacheTs = now;
    return _cfg;
  }

  function saveCfg(cfg) {
    // Strip camera packages before saving — they're represented by the synthetic marker
    var toSave = Object.assign({}, cfg);
    toSave.excludedApps = (cfg.excludedApps || []).filter(function (p) {
      return CAMERA_PKGS.indexOf(p) === -1;
    });
    _cfg = cfg; _cacheTs = Date.now();
    var json = JSON.stringify(toSave);
    try {
      if (IS_NATIVE && typeof N.saveScreenFilterSettings === 'function')
        N.saveScreenFilterSettings(json);
      else localStorage.setItem('sfCfg', json);
    } catch (_) {}
    _applyNative(cfg);
  }

  function _applyNative(cfg) {
    if (!IS_NATIVE) return;
    try {
      if (cfg.enabled && !cfg.paused) {
        if (typeof N.applyScreenFilter === 'function')
          N.applyScreenFilter(cfg.warmAlpha, cfg.dimAlpha, false);
      } else {
        if (typeof N.removeScreenFilter === 'function') N.removeScreenFilter();
      }
    } catch (_) {}
  }

  function _applyRaw(w, d, gradual) {
    if (!IS_NATIVE) return;
    try {
      if (typeof N.applyScreenFilter === 'function')
        N.applyScreenFilter(w, d, !!gradual);
    } catch (_) {}
  }

  /* ── Permission ──────────────────────────────────────────── */
  function _hasPerm() {
    if (!IS_NATIVE) return true;
    try { return typeof N.hasOverlayPermission === 'function' && N.hasOverlayPermission(); }
    catch (_) { return false; }
  }

  function _requestPerm(cb) {
    var backdrop = document.createElement('div');
    backdrop.className = 'sf-backdrop';
    var sheet = document.createElement('div');
    sheet.className = 'sf-perm-sheet';
    sheet.innerHTML =
      '<div class="sf-drag"></div>' +
      '<div style="font-size:28px;text-align:center;margin-bottom:10px">🔐</div>' +
      '<div class="sf-perm-title">One Permission Needed</div>' +
      '<div class="sf-perm-body">Aurelo needs permission to draw over other apps to display the screen filter.</div>' +
      '<div class="sf-perm-note"><span>🛡️</span><span>All data stays on your device. No tracking, no cloud.</span></div>' +
      '<button class="sf-btn-prim" id="sf-grant-btn">Grant Permission</button>' +
      '<button class="sf-btn-ghost" id="sf-skip-btn">Not now</button>';
    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    var dismiss = function () { sheet.remove(); backdrop.remove(); };
    document.getElementById('sf-grant-btn').onclick = function () {
      try { if (typeof N.requestOverlayPermission === 'function') N.requestOverlayPermission(); } catch (_) {}
      dismiss();
      var t = 0, poll = setInterval(function () {
        if (_hasPerm()) { clearInterval(poll); if (cb) cb(); }
        if (++t > 120) clearInterval(poll);
      }, 500);
    };
    document.getElementById('sf-skip-btn').onclick = dismiss;
    backdrop.onclick = dismiss;
  }

  /* ── Schedule / Service ──────────────────────────────────── */
  function _startSchedule(cfg) {
    if (!IS_NATIVE) return;
    try {
      if (typeof N.startScreenFilterSchedule === 'function')
        N.startScreenFilterSchedule(JSON.stringify(cfg));
    } catch (_) {}
  }

  function _stopSchedule() {
    if (!IS_NATIVE) return;
    try {
      if (typeof N.stopScreenFilterSchedule === 'function')
        N.stopScreenFilterSchedule();
    } catch (_) {}
  }

  /* ── Bedtime integration ─────────────────────────────────── */
  function getBedtimePreset() {
    var cfg = getCfg();
    return PRESETS[cfg.bedtimePreset] || PRESETS.bedtime;
  }

  function applyBedtimeFilter() {
    var cfg = getCfg();
    if (!cfg.bedtimeAutoApply) return;
    var p = getBedtimePreset();
    _applyRaw(p.warmAlpha, p.dimAlpha, cfg.fadeIn);
  }

  function stopBedtimeFilter() {
    var cfg = getCfg();
    if (cfg.enabled && !cfg.paused && cfg.schedule !== 'none') {
      _applyRaw(cfg.warmAlpha, cfg.dimAlpha, false);
    } else {
      try { if (IS_NATIVE && typeof N.removeScreenFilter === 'function') N.removeScreenFilter(); } catch (_) {}
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * RENDER
   * ═══════════════════════════════════════════════════════════ */
  function render() {
    var wrap = document.getElementById('sf-card-wrap');
    if (!wrap) return;

    wrap.style.overscrollBehavior = 'contain';
    wrap.style.touchAction = 'pan-y';

    var wasDirty = _dirty; // FIX 1: save before reset — preset/sched call _markDirty() then render()
    var cfg    = getCfg();
    _dirty     = false;
    var isPro  = typeof ProTier !== 'undefined' && ProTier.isPro;

    var btActive = IS_NATIVE && typeof N.isInBedtimeWindow === 'function' && N.isInBedtimeWindow();
    var bedtimeControlling = btActive && cfg.bedtimeAutoApply;

    var togState, togLabel;
    if (bedtimeControlling) {
      togState = 'on'; togLabel = 'ON';
    } else if (!cfg.enabled) {
      togState = 'off'; togLabel = 'OFF';
    } else {
      togState = 'on'; togLabel = 'ON';
    }

    var badge = bedtimeControlling
      ? '<span class="sf-active-badge">Active via Bedtime</span>' : '';

    // FIX 1: pass cfg.excludedApps WITHOUT camera pkgs — camera is shown separately
    var excludedHtml = _buildExcludedAppsHtml(cfg.excludedApps);

    var cardClass = bedtimeControlling ? 'sf-card sf-card--bedtime-controlled' : 'sf-card';
    var disabledHint = bedtimeControlling
      ? '<div class="sf-bedtime-hint">🌙 Bedtime Mode is controlling the filter. Adjust settings below.</div>'
      : '';

    // FIX 4: show day picker when custom or sun schedule is selected
    var showDayPicker = isPro && (cfg.schedule === 'custom' || cfg.schedule === 'sun');
    var dayPickerHtml = showDayPicker ? _buildDayPicker(cfg.schedDays) : '';

    wrap.innerHTML =
      '<div class="' + cardClass + '">' +

        // Header
        '<div class="sf-hdr">' +
          '<div class="sf-hdr-left"><span class="sf-icon">🌊</span>' +
            '<span class="sf-title">Screen Filter</span>' + badge +
          '</div>' +
          '<button class="sf-tog sf-tog--' + togState + '"' +
            (bedtimeControlling ? ' disabled style="opacity:.5;cursor:default"' : ' onclick="ScreenFilter._togMaster()"') +
            '>' + togLabel + '</button>' +
        '</div>' +

        disabledHint +

        // Presets
        '<div class="sf-sec-lbl">PRESET</div>' +
        '<div class="sf-presets-row">' +
          _pBtn('soft',    '🟡 Soft',    cfg.preset) +
          _pBtn('medium',  '🟠 Medium',  cfg.preset) +
          _pBtn('bedtime', '🔴 Bedtime', cfg.preset) +
          _pBtn('custom',  '✏️ Custom',  cfg.preset) +
        '</div>' +

        // Sliders (custom preset only)
        '<div id="sf-sliders" style="' + (cfg.preset === 'custom' ? '' : 'display:none') + '">' +
          _slider('Blue Light Filter', 'warm', cfg.warmAlpha, '#f97316') +
          _slider('Extra Dim',         'dim',  cfg.dimAlpha,  '#7c3aed') +
        '</div>' +

        // When to run — 'No schedule' replaces 'Manual only' + 'Always on'
        '<div class="sf-sec-lbl">WHEN TO RUN</div>' +
        '<div class="sf-sched-list">' +
          _schedRow('none',   'No schedule', cfg.schedule, false) +
          _schedRow('sun',    'Sun-based',    cfg.schedule, !isPro) +
          _schedRow('custom', 'Custom times', cfg.schedule, !isPro) +
        '</div>' +

        // FIX 3: custom time pickers — now have onclick via _timePicker()
        '<div id="sf-times" style="' + (cfg.schedule === 'custom' && isPro ? '' : 'display:none') + '">' +
          '<div class="sf-time-row">' +
            _timePicker('Start', cfg.schedStartHour, cfg.schedStartMin, 'sf-t-start') +
            _timePicker('End',   cfg.schedEndHour,   cfg.schedEndMin,   'sf-t-end') +
          '</div>' +
          // FIX 4: day picker injected here for custom schedule
          dayPickerHtml +
        '</div>' +

        // FIX 4: sun-based schedule also gets day picker (outside #sf-times)
        (cfg.schedule === 'sun' && isPro ? dayPickerHtml : '') +

        // FIX 1 + 2: excluded apps — camera shown as single chip
        '<div class="sf-sec-lbl">PAUSED FOR APPS</div>' +
        excludedHtml +

        // Save / Discard
        '<div class="sf-actions" id="sf-actions" style="display:none">' +
          '<button class="sf-discard" onclick="ScreenFilter._discard()">Discard</button>' +
          '<button class="sf-save"    onclick="ScreenFilter._save()">Save</button>' +
        '</div>' +

      '</div>';

    _bindSliders();
    _bindExcludedApps();
    // FIX 1: restore dirty state after re-render — _markDirty() was called before
    // render() in _preset() / _sched(), but render() reset _dirty to false at the
    // top. Restoring via _markDirty() makes the save/discard bar reappear correctly.
    if (wasDirty) _markDirty();
  }

  /* ── FIX 1: Excluded apps HTML — camera collapsed to one chip ── */
  function _buildExcludedAppsHtml(apps) {
    // apps here contains only non-camera packages (camera pkgs stripped at save time
    // and NOT re-merged into the array in v4 — we just show a single auto chip)
    var chips = '';

    // Single auto chip for camera — always shown first
    chips +=
      '<div class="sf-excl-chip">' +
        '<span class="sf-excl-lbl">📷 Camera</span>' +
        '<span class="sf-excl-auto">auto</span>' +
      '</div>';

    // User-added apps
    apps.filter(function (p) { return CAMERA_PKGS.indexOf(p) === -1; })
      .forEach(function (pkg) {
        chips +=
          '<div class="sf-excl-chip">' +
            '<span class="sf-excl-lbl">' + _pkgLabel(pkg) + '</span>' +
            '<button class="sf-excl-rm" onclick="ScreenFilter._removeExcluded(\'' + pkg + '\')" aria-label="Remove">\u00d7</button>' +
          '</div>';
      });

    return (
      '<div class="sf-excl-wrap" id="sf-excl-wrap">' +
        chips +
        '<button class="sf-excl-add" id="sf-excl-add" onclick="ScreenFilter._addExcluded()">+ Add app</button>' +
      '</div>' +
      '<div class="sf-excl-note">Camera excluded automatically — filter resumes when camera closes</div>'
    );
  }

  function _pkgLabel(pkg) {
    var parts = pkg.split('.');
    var last   = parts[parts.length - 1];
    return last.charAt(0).toUpperCase() + last.slice(1);
  }

  /* ── FIX 4: Day-of-week picker ─────────────────────────────── */
  function _buildDayPicker(days) {
    var btns = '';
    DAY_LABELS.forEach(function (lbl, i) {
      var on = days[i] !== 0;
      btns +=
        '<button class="sf-day-btn' + (on ? ' sf-day-btn--on' : '') + '" ' +
          'onclick="ScreenFilter._toggleDay(' + i + ')" ' +
          'aria-label="' + ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i] + '" ' +
          'aria-pressed="' + on + '">' +
          lbl +
        '</button>';
    });
    return (
      '<div class="sf-sec-lbl" style="margin-top:12px">DAYS</div>' +
      '<div class="sf-day-row">' + btns + '</div>'
    );
  }

  function _toggleDay(idx) {
    var cfg = getCfg();
    if (!Array.isArray(cfg.schedDays) || cfg.schedDays.length !== 7)
      cfg.schedDays = [1, 1, 1, 1, 1, 1, 1];
    cfg.schedDays[idx] = cfg.schedDays[idx] ? 0 : 1;
    _cfg = cfg;
    _cacheTs = Date.now(); // FIX 5
    // Update just the toggled button without a full re-render
    var btns = document.querySelectorAll('.sf-day-btn');
    if (btns[idx]) {
      var on = !!cfg.schedDays[idx];
      btns[idx].classList.toggle('sf-day-btn--on', on);
      btns[idx].setAttribute('aria-pressed', on);
    }
    _markDirty();
  }

  /* ── HTML helpers ──────────────────────────────────────────── */
  function _pBtn(key, label, cur) {
    return '<button class="sf-pset' + (cur === key ? ' sf-pset--on' : '') +
      '" onclick="ScreenFilter._preset(\'' + key + '\')">' + label + '</button>';
  }

  function _slider(label, id, val, color) {
    return '<div class="sf-slider-row">' +
      '<div class="sf-slider-lbl"><span>' + label + '</span>' +
        '<span id="sf-' + id + '-val">' + val + '%</span></div>' +
      '<div class="sf-track-bg">' +
        '<div class="sf-track-fill" id="sf-' + id + '-fill" style="width:' + val + '%;background:' + color + '"></div>' +
      '</div>' +
      '<input type="range" class="sf-range" id="sf-' + id + '" min="0" max="100" value="' + val + '">' +
    '</div>';
  }

  function _schedRow(key, label, cur, pro) {
    var proTag = pro ? ' <span class="sf-pro-tag">PRO</span>' : '';
    var click  = pro
      ? 'typeof ProTier!==\'undefined\'&&ProTier.triggerUpsell(\'screen_filter\')'
      : 'ScreenFilter._sched(\'' + key + '\')';
    return '<div class="sf-sched-row' + (pro ? ' sf-sched--pro' : '') + '" onclick="' + click + '">' +
      '<div class="sf-radio' + (cur === key ? ' sf-radio--on' : '') + '"></div>' +
      '<span class="sf-sched-lbl">' + label + proTag + '</span>' +
    '</div>';
  }

  /* FIX 3: time picker block now carries onclick ──────────────── */
  function _timePicker(label, h, m, id) {
    return '<div class="sf-time-block" id="' + id + '" ' +
      'onclick="ScreenFilter._openTimePicker(\'' + id + '\')" ' +
      'style="cursor:pointer">' +
      '<div class="sf-time-lbl">' + label + '</div>' +
      '<div class="sf-time-val">' + _f2(h) + ':' + _f2(m) + '</div>' +
    '</div>';
  }

  /* FIX 3: bottom-sheet time picker ─────────────────────────── */
  function _openTimePicker(blockId) {
    var cfg     = getCfg();
    var isStart = blockId === 'sf-t-start';
    var curH    = isStart ? cfg.schedStartHour : cfg.schedEndHour;
    var curM    = isStart ? cfg.schedStartMin  : cfg.schedEndMin;

    var backdrop = document.createElement('div');
    backdrop.className = 'sf-backdrop';
    var sheet = document.createElement('div');
    sheet.className = 'sf-perm-sheet';

    // Build hour options 00–23
    var hourOpts = '';
    for (var h = 0; h < 24; h++) {
      hourOpts += '<option value="' + h + '"' + (h === curH ? ' selected' : '') + '>' + _f2(h) + '</option>';
    }
    // Build minute options in 5-minute steps
    var minOpts = '';
    for (var m = 0; m < 60; m += 5) {
      var mSel = (m === Math.round(curM / 5) * 5) ? ' selected' : '';
      minOpts += '<option value="' + m + '"' + mSel + '>' + _f2(m) + '</option>';
    }

    sheet.innerHTML =
      '<div class="sf-drag"></div>' +
      '<div class="sf-perm-title" style="margin-bottom:20px">' +
        (isStart ? '⏰ Start time' : '⏰ End time') +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:24px">' +
        '<select id="sf-tp-h" class="sf-tp-sel">' + hourOpts + '</select>' +
        '<span style="font-size:22px;font-weight:700;color:var(--t1,#fff)">:</span>' +
        '<select id="sf-tp-m" class="sf-tp-sel">' + minOpts + '</select>' +
      '</div>' +
      '<button class="sf-btn-prim" id="sf-tp-ok">Set</button>' +
      '<button class="sf-btn-ghost" id="sf-tp-cancel" style="margin-top:8px">Cancel</button>';

    // Inline style for selects (works without external CSS)
    var selStyle =
      'font-size:20px;padding:10px 14px;border-radius:10px;' +
      'background:var(--card2,#1e1e2e);color:var(--t1,#fff);' +
      'border:1px solid var(--border,#333);min-width:72px;text-align:center;';
    sheet.querySelectorAll('.sf-tp-sel').forEach(function (s) { s.style.cssText = selStyle; });

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    var dismiss = function () { sheet.remove(); backdrop.remove(); };
    backdrop.onclick = dismiss;
    document.getElementById('sf-tp-cancel').onclick = dismiss;
    document.getElementById('sf-tp-ok').onclick = function () {
      var newH = parseInt(document.getElementById('sf-tp-h').value, 10);
      var newM = parseInt(document.getElementById('sf-tp-m').value, 10);
      dismiss();
      var localCfg = getCfg();
      if (isStart) { localCfg.schedStartHour = newH; localCfg.schedStartMin = newM; }
      else          { localCfg.schedEndHour   = newH; localCfg.schedEndMin   = newM; }
      _cfg = localCfg;
      _cacheTs = Date.now(); // FIX 5
      // Update the display value in the block without full re-render
      var block = document.getElementById(blockId);
      if (block) {
        var valEl = block.querySelector('.sf-time-val');
        if (valEl) valEl.textContent = _f2(newH) + ':' + _f2(newM);
      }
      _markDirty();
    };
  }

  function _transRow(field, on, label) {
    return '<div class="sf-trans-row">' +
      '<div class="sf-sm-tog ' + (on ? 'on' : 'off') + '" ' +
        'onclick="ScreenFilter._trans(\'' + field + '\',this)">' +
        '<div class="sf-sm-knob"></div></div>' +
      '<span class="sf-trans-lbl">' + label + '</span>' +
    '</div>';
  }

  function _f2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ── Slider binding ─────────────────────────────────────────── */
  function _bindSliders() {
    ['warm', 'dim'].forEach(function (id) {
      var el = document.getElementById('sf-' + id);
      if (!el) return;
      el.oninput = function () {
        var v = +this.value;
        var valEl  = document.getElementById('sf-' + id + '-val');
        var fillEl = document.getElementById('sf-' + id + '-fill');
        if (valEl)  valEl.textContent = v + '%';
        if (fillEl) fillEl.style.width = v + '%';
        if (id === 'warm') _cfg.warmAlpha = v; else _cfg.dimAlpha = v;
        _cacheTs = Date.now(); // FIX 5
        _applyRaw(_cfg.warmAlpha, _cfg.dimAlpha, false);
        _markDirty();
      };
    });
  }

  /* ── Excluded apps binding ─────────────────────────────────── */
  function _bindExcludedApps() {
    var wrap = document.getElementById('sf-excl-wrap');
    if (wrap) {
      wrap.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    }
  }

  /* ── Event handlers ───────────────────────────────────────── */
  function _togMaster() {
    var cfg = getCfg();
    if (!cfg.enabled) {
      if (!_hasPerm()) { _requestPerm(_togMaster); return; }
      cfg.enabled = true; cfg.paused = false;
      if (cfg.schedule !== 'none') _startSchedule(cfg);
    } else {
      cfg.enabled = false; cfg.paused = false;
      _stopSchedule();
    }
    saveCfg(cfg);
    render();
  }

  function _preset(key) {
    var cfg = getCfg();
    cfg.preset = key;
    if (key !== 'custom') { cfg.warmAlpha = PRESETS[key].warmAlpha; cfg.dimAlpha = PRESETS[key].dimAlpha; }
    _cfg = cfg;
    _cacheTs = Date.now(); // FIX 5
    if (cfg.enabled && !cfg.paused) _applyRaw(cfg.warmAlpha, cfg.dimAlpha, false);
    if (typeof window.onSFPresetChange === 'function') window.onSFPresetChange(key);
    _markDirty();
    render();
  }

  /* ── Location permission (for sun-based schedule) ───────────── */
  function _hasLocationPerm() {
    if (!IS_NATIVE) return true; // browser preview — assume granted
    try { return typeof N.hasLocationPermission === 'function' && N.hasLocationPermission(); }
    catch (_) { return false; }
  }

  function _requestLocationPerm(cb) {
    var backdrop = document.createElement('div');
    backdrop.className = 'sf-backdrop';
    var sheet = document.createElement('div');
    sheet.className = 'sf-perm-sheet';
    sheet.innerHTML =
      '<div class="sf-drag"></div>' +
      '<div style="font-size:28px;text-align:center;margin-bottom:10px">📍</div>' +
      '<div class="sf-perm-title">Location Needed for Sun Schedule</div>' +
      '<div class="sf-perm-body">Aurelo needs your approximate location to calculate local sunrise and sunset times. It is used only on-device and never sent anywhere.</div>' +
      '<div class="sf-perm-note"><span>🛡️</span><span>Coarse location only. No GPS tracking. Never leaves your device.</span></div>' +
      '<button class="sf-btn-prim" id="sf-loc-grant-btn">Allow Location</button>' +
      '<button class="sf-btn-ghost" id="sf-loc-skip-btn">Not now</button>';
    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    var dismiss = function () { sheet.remove(); backdrop.remove(); };
    document.getElementById('sf-loc-grant-btn').onclick = function () {
      try { if (typeof N.requestLocationPermission === 'function') N.requestLocationPermission(); } catch (_) {}
      dismiss();
      var t = 0, poll = setInterval(function () {
        if (_hasLocationPerm()) { clearInterval(poll); if (cb) cb(); }
        if (++t > 120) clearInterval(poll);
      }, 500);
    };
    document.getElementById('sf-loc-skip-btn').onclick = dismiss;
    backdrop.onclick = dismiss;
  }

  function _schedApply(key) {
    var cfg = getCfg();
    cfg.schedule = key; _cfg = cfg;
    _cacheTs = Date.now();
    _markDirty();
    render();
  }

  function _sched(key) {
    // FIX 2: sun-based schedule requires coarse location permission for
    // sunrise/sunset calculation — request it before applying the schedule.
    if (key === 'sun' && !_hasLocationPerm()) {
      _requestLocationPerm(function () { _schedApply('sun'); });
      return;
    }
    _schedApply(key);
  }

  function _trans(field, el) {
    var cfg = getCfg();
    cfg[field] = !cfg[field]; _cfg = cfg;
    _cacheTs = Date.now(); // FIX 5
    el.classList.toggle('on', cfg[field]);
    el.classList.toggle('off', !cfg[field]);
    _markDirty();
  }

  /* ── Excluded apps handlers — FIX 2: use getCachedApps() ─── */
  function _addExcluded() {
    var installedRaw = [];
    try {
      // FIX 2: correct bridge method is getCachedApps(), not getInstalledApps()
      if (IS_NATIVE && typeof N.getCachedApps === 'function')
        installedRaw = JSON.parse(N.getCachedApps() || '[]');
    } catch (_) {}

    var cfg     = getCfg();
    var already = cfg.excludedApps.concat(CAMERA_PKGS); // exclude camera from picker too

    if (!installedRaw.length) {
      // Fallback: manual package entry (unlikely path — getCachedApps always has data)
      var pkg = window.prompt('Enter package name (e.g. com.instagram.android):');
      if (pkg && pkg.trim()) _addExcludedPkg(pkg.trim());
      return;
    }

    var backdrop = document.createElement('div');
    backdrop.className = 'sf-backdrop';
    var sheet = document.createElement('div');
    sheet.className = 'sf-perm-sheet';
    sheet.style.maxHeight = '70vh';
    sheet.style.overflowY = 'auto';

    // FIX 2: field is 'name', not 'label'
    var listHtml = installedRaw
      .filter(function (a) { return already.indexOf(a.packageName) === -1; })
      .map(function (a) {
        return '<div class="sf-app-row" onclick="ScreenFilter._pickExcluded(\'' + a.packageName + '\')" ' +
          'data-pkg="' + a.packageName + '">' +
          '<span class="sf-app-row-lbl">' + (a.name || a.packageName) + '</span>' +
          '<span class="sf-app-row-pkg">' + a.packageName + '</span>' +
          '</div>';
      }).join('');

    sheet.innerHTML =
      '<div class="sf-drag"></div>' +
      '<div class="sf-perm-title" style="margin-bottom:12px">Choose app to pause filter for</div>' +
      '<div id="sf-app-list">' +
        (listHtml || '<div style="text-align:center;color:var(--t3);padding:20px">No apps to add</div>') +
      '</div>' +
      '<button class="sf-btn-ghost" id="sf-pick-cancel" style="margin-top:12px">Cancel</button>';

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    window._sfPickerDismiss = function () { sheet.remove(); backdrop.remove(); delete window._sfPickerDismiss; };
    document.getElementById('sf-pick-cancel').onclick = window._sfPickerDismiss;
    backdrop.onclick = window._sfPickerDismiss;
  }

  function _pickExcluded(pkg) {
    if (window._sfPickerDismiss) window._sfPickerDismiss();
    _addExcludedPkg(pkg);
  }

  function _addExcludedPkg(pkg) {
    var cfg = getCfg();
    // Guard: don't add camera packages manually — they are always auto-excluded
    if (CAMERA_PKGS.indexOf(pkg) !== -1) return;
    if (cfg.excludedApps.indexOf(pkg) === -1) {
      cfg.excludedApps.push(pkg);
      _cfg = cfg;
      _cacheTs = Date.now(); // FIX 5
      _markDirty();
      // Partial re-render of excluded section
      var wrap = document.getElementById('sf-excl-wrap');
      if (wrap) {
        // Replace wrap + the note sibling
        var note = wrap.nextElementSibling;
        var newHtml = _buildExcludedAppsHtml(cfg.excludedApps);
        var tmp = document.createElement('div');
        tmp.innerHTML = newHtml;
        wrap.parentNode.replaceChild(tmp.firstChild, wrap);
        if (note && note.classList && note.classList.contains('sf-excl-note')) {
          note.remove(); // already included in newHtml
        }
      }
      _bindExcludedApps();
    }
  }

  function _removeExcluded(pkg) {
    var cfg = getCfg();
    cfg.excludedApps = cfg.excludedApps.filter(function (p) { return p !== pkg; });
    _cfg = cfg;
    _cacheTs = Date.now(); // FIX 5
    _markDirty();
    var wrap = document.getElementById('sf-excl-wrap');
    if (wrap) {
      var tmp = document.createElement('div');
      tmp.innerHTML = _buildExcludedAppsHtml(cfg.excludedApps);
      wrap.parentNode.replaceChild(tmp.firstChild, wrap);
    }
    _bindExcludedApps();
  }

  function _save() {
    var cfg = getCfg();
    saveCfg(cfg);
    _dirty = false;
    var a = document.getElementById('sf-actions');
    if (a) a.style.display = 'none';
    if (typeof toast === 'function') toast('Screen filter saved', 'success');
    if (cfg.enabled && !cfg.paused && cfg.schedule !== 'none') _startSchedule(cfg);
  }

  /* FIX 6: _discard() now reverts the live overlay, not just the UI ── */
  function _discard() {
    _cfg  = null;
    _dirty = false;
    // Re-read persisted config and immediately restore the overlay to that state
    var saved = getCfg();
    _applyNative(saved);
    render();
  }

  function _markDirty() {
    if (_dirty) return;
    _dirty = true;
    var a = document.getElementById('sf-actions');
    if (a) a.style.display = 'flex';
  }

  /* ── Settings section renderer (for Settings tab) ────────────── */
  function renderSettingsSection() {
    var el = document.getElementById('sf-settings-section');
    if (!el) return;
    var cfg    = getCfg();
    var active = cfg.enabled && !cfg.paused;
    var presetLabel = { soft: 'Soft', medium: 'Medium', bedtime: 'Bedtime', custom: 'Custom' }[cfg.preset] || 'Bedtime';
    var schedLabel  = { none: 'No schedule', sun: 'Sun-based', custom: 'Custom schedule' }[cfg.schedule] || 'No schedule';

    el.innerHTML =
      '<div class="sr" onclick="if(typeof openFocusTab===\'function\')openFocusTab(\'habits\')" style="cursor:pointer">' +
        '<div class="sr-ico" style="background:rgba(5,200,232,.12)">🌊</div>' +
        '<div style="flex:1">' +
          '<div class="sr-lbl">Screen Filter</div>' +
          '<div class="sr-sub">' +
            (active
              ? presetLabel + ' preset \u00b7 ' + schedLabel
              : 'Configure on Focus tab \u203a Habits') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          (active
            ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:rgba(18,212,138,.15);color:#12D48A">ON</span>'
            : '<span style="font-size:10px;color:var(--t3,#7474A8)">OFF</span>') +
          '<span class="sr-chev">\u203a</span>' +
        '</div>' +
      '</div>';
  }

  return {
    render: render,
    getCfg: getCfg, saveCfg: saveCfg,
    getBedtimePreset: getBedtimePreset,
    applyBedtimeFilter: applyBedtimeFilter,
    stopBedtimeFilter: stopBedtimeFilter,
    renderSettingsSection: renderSettingsSection,
    _togMaster: _togMaster, _preset: _preset,
    _sched: _sched, _schedApply: _schedApply, _trans: _trans,
    _hasLocationPerm: _hasLocationPerm,
    _toggleDay: _toggleDay,
    _openTimePicker: _openTimePicker,
    _addExcluded: _addExcluded, _pickExcluded: _pickExcluded,
    _removeExcluded: _removeExcluded,
    _save: _save, _discard: _discard
  };
}());