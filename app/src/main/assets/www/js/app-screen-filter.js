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

  /* ── BUG 2 FIX: sunrise/sunset calculator ───────────────────
   * Replaces the unreliable N.requestLocationPermission() /
   * N.hasLocationPermission() bridge calls, which had coarse/fine
   * mismatch and timing issues on Android 15.
   * Uses the W3C navigator.geolocation API that WebView handles
   * natively and correctly on all Android versions. Sunrise/sunset
   * times are computed on-device in JS from the returned coordinates
   * and stored in cfg so _isInScheduleWindow() can evaluate them.
   *
   * Algorithm: simplified USNO/Almanac method (accurate to ±1 min).
   * Returns { sunriseHour, sunriseMin, sunsetHour, sunsetMin }
   * in local device time, or null when the location is inside a
   * polar day/night period.
   * ─────────────────────────────────────────────────────────── */
  function _computeSunTimes(lat, lon) {
    var D2R    = Math.PI / 180;
    var R2D    = 180 / Math.PI;
    var ZENITH = 90.83333; // official + atmospheric refraction
    var now    = new Date();
    var start  = new Date(now.getFullYear(), 0, 0);
    var dayOfYear = Math.floor((now - start) / 86400000);
    var lngHour   = lon / 15;
    var tzOff     = -now.getTimezoneOffset() / 60; // local UTC offset in hours

    function calcTime(isSunrise) {
      var t  = isSunrise
        ? dayOfYear + (6  - lngHour) / 24
        : dayOfYear + (18 - lngHour) / 24;
      var M  = 0.9856 * t - 3.289;
      var L  = M + 1.916 * Math.sin(M * D2R) + 0.020 * Math.sin(2 * M * D2R) + 282.634;
      L = ((L % 360) + 360) % 360;
      var RA = R2D * Math.atan(0.91764 * Math.tan(L * D2R));
      RA = ((RA % 360) + 360) % 360;
      RA = RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);
      RA = RA / 15;
      var sinDec = 0.39782 * Math.sin(L * D2R);
      var cosDec = Math.cos(Math.asin(sinDec));
      var cosH   = (Math.cos(ZENITH * D2R) - sinDec * Math.sin(lat * D2R))
                 / (cosDec * Math.cos(lat * D2R));
      if (cosH > 1 || cosH < -1) return null; // polar day or night
      var H  = isSunrise ? 360 - R2D * Math.acos(cosH) : R2D * Math.acos(cosH);
      H      = H / 15;
      var T  = H + RA - 0.06571 * t - 6.622;
      var UT = ((T - lngHour) % 24 + 24) % 24; // UTC decimal hours
      var local = ((UT + tzOff) % 24 + 24) % 24;
      return local; // decimal hours in local time
    }

    var sunriseH = calcTime(true);
    var sunsetH  = calcTime(false);
    if (sunriseH === null || sunsetH === null) return null;

    var srM = Math.round((sunriseH % 1) * 60); var srH = Math.floor(sunriseH); if (srM === 60) { srM = 0; srH++; }
    var ssM = Math.round((sunsetH  % 1) * 60); var ssH = Math.floor(sunsetH);  if (ssM === 60) { ssM = 0; ssH++; }
    return { sunriseHour: srH, sunriseMin: srM, sunsetHour: ssH, sunsetMin: ssM };
  }

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

  // BUG 1 FIX: only start overlay if inside the schedule window
  function _applyNative(cfg) {
    if (!IS_NATIVE) return;
    try {
      if (cfg.enabled && !cfg.paused) {
        if (!_isInScheduleWindow(cfg)) {
          if (typeof N.removeScreenFilter === 'function') N.removeScreenFilter();
          return;
        }
        if (typeof N.applyScreenFilter === 'function')
          N.applyScreenFilter(cfg.warmAlpha, cfg.dimAlpha, !!cfg.fadeIn);
      } else {
        if (typeof N.removeScreenFilter === 'function') N.removeScreenFilter();
      }
    } catch (_) {}
  }

  // Returns true if current time is inside the filter active window.
  // 'none'/'': always true.
  // 'sun':  uses stored sunsetHour/sunriseHour computed by _computeSunTimes()
  //         — active from sunset tonight until sunrise tomorrow.
  //         Returns false if coordinates have not been obtained yet.
  // 'custom': compare H:M against schedStart/End + schedDays [Mon=0..Sun=6].
  function _isInScheduleWindow(cfg) {
    if (!cfg) return false;
    if (cfg.schedule === 'none' || !cfg.schedule) return true;

    // BUG 2 FIX: sun schedule now evaluated in JS using stored computed times.
    if (cfg.schedule === 'sun') {
      if (cfg.sunsetHour == null || cfg.sunriseHour == null) return false;
      var now       = new Date();
      var cfgDay    = (now.getDay() + 6) % 7; // Mon=0…Sun=6
      if (Array.isArray(cfg.schedDays) && cfg.schedDays.length === 7) {
        if (!cfg.schedDays[cfgDay]) return false;
      }
      var nowMins     = now.getHours() * 60 + now.getMinutes();
      var sunsetMins  = cfg.sunsetHour  * 60 + (cfg.sunsetMin  || 0);
      var sunriseMins = cfg.sunriseHour * 60 + (cfg.sunriseMin || 0);
      // Active window is overnight: sunset → next-day sunrise
      if (sunsetMins > sunriseMins) return nowMins >= sunsetMins || nowMins < sunriseMins;
      return nowMins >= sunsetMins && nowMins < sunriseMins;
    }

    var now    = new Date();
    var cfgDay = (now.getDay() + 6) % 7;
    if (Array.isArray(cfg.schedDays) && cfg.schedDays.length === 7) {
      if (!cfg.schedDays[cfgDay]) return false;
    }
    var nowMins   = now.getHours() * 60 + now.getMinutes();
    var startMins = (cfg.schedStartHour != null ? cfg.schedStartHour : 21) * 60
                  + (cfg.schedStartMin  != null ? cfg.schedStartMin  : 0);
    var endMins   = (cfg.schedEndHour   != null ? cfg.schedEndHour   : 7) * 60
                  + (cfg.schedEndMin    != null ? cfg.schedEndMin    : 0);
    if (startMins > endMins) return nowMins >= startMins || nowMins < endMins;
    return nowMins >= startMins && nowMins < endMins;
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

        // SF-26: Transparency / documentation row
        // Users always know what the filter does and can dismiss it without
        // hunting through settings — matches Aurelo Coach transparency philosophy.
        '<div class="sf-info-row">' +
          '<span class="sf-info-icon">&#9432;</span>' +
          '<p class="sf-info-text">' +
            'Screen Filter overlays a tinted layer above all apps to reduce blue light ' +
            'and brightness. It runs as a transparent overlay that passes touches through ' +
            '&mdash; it cannot read your screen content. Tap <strong>OFF</strong> above, ' +
            'or pull down the notification shade and tap the Aurelo notification to disable it.' +
          '</p>' +
        '</div>' +

        // Save / Discard
        '<div class="sf-actions" id="sf-actions" style="display:none">' +
          '<button class="sf-discard" onclick="ScreenFilter._discard()">Discard</button>' +
          '<button class="sf-save"    onclick="ScreenFilter._save()">Save</button>' +
        '</div>' +

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
      if (cfg.schedule !== 'none') {
        _startSchedule(cfg);
        // BUG 1 FIX: inform user when activation is deferred to schedule window
        if (!_isInScheduleWindow(cfg)) {
          var hint = cfg.schedule === 'sun'
            ? 'Filter enabled - will activate at sunset'
            : (function () {
                var h = cfg.schedStartHour != null ? cfg.schedStartHour : 21;
                var m = cfg.schedStartMin  != null ? cfg.schedStartMin  : 0;
                var ap = h >= 12 ? 'PM' : 'AM'; var h12 = h % 12 || 12;
                return 'Filter enabled - activates at ' + h12 + ':'
                     + (m < 10 ? '0' : '') + m + ' ' + ap;
              })();
          setTimeout(function () {
            if (typeof toast === 'function') toast(hint, 'info', 3500);
          }, 250);
        }
      }
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

  /* ── Location (for sun-based schedule) ──────────────────────
   * BUG 2 FIX: All N.hasLocationPermission() / N.requestLocationPermission()
   * calls replaced with navigator.geolocation.getCurrentPosition().
   * The W3C Geolocation API is natively handled by the Android WebView
   * and prompts the system location permission dialog itself — no bridge
   * required, no coarse/fine mismatch, no polling race.
   *
   * _requestSunLocation(onSuccess, onDenied) obtains coordinates once,
   * computes sunrise/sunset via _computeSunTimes(), and returns the result.
   * ─────────────────────────────────────────────────────────── */
  function _requestSunLocation(onSuccess, onDenied) {
    if (!navigator.geolocation) {
      if (typeof toast === 'function') toast('Geolocation not available on this device', 'warn', 3500);
      if (onDenied) onDenied();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        // Got a position — clear any pending-retry flag.
        window._sfGeoPending = false;
        var times = _computeSunTimes(pos.coords.latitude, pos.coords.longitude);
        if (!times) {
          if (typeof toast === 'function') toast('Sun times unavailable for polar latitudes — use Custom schedule instead', 'warn', 4000);
          if (onDenied) onDenied();
          return;
        }
        if (onSuccess) onSuccess(times);
      },
      function (err) {
        // err.code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        if (err.code === 1) {
          // GEO-03: Set a flag so onAppResume can retry automatically after
          // the user grants location permission in system Settings and returns.
          window._sfGeoPending = true;
          if (typeof toast === 'function')
            toast('Location permission denied — grant it in Settings › Apps › Aurelo › Permissions, then return here', 'warn', 5000);
        } else {
          if (typeof toast === 'function')
            toast('Could not get location for Sun schedule — check GPS/network and try again', 'warn', 4500);
        }
        if (onDenied) onDenied();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 3600000 }
    );
  }

  function _schedApply(key) {
    var cfg = getCfg();
    cfg.schedule = key; _cfg = cfg;
    _cacheTs = Date.now();
    _markDirty();
    render();
  }

  function _sched(key) {
    if (key === 'sun') {
      // BUG 2 FIX: use W3C navigator.geolocation — no N.requestLocationPermission()
      // bridge call, no polling loop, no coarse/fine mismatch on Android 15.
      // The WebView handles the system permission dialog natively.
      _requestSunLocation(
        function (times) {
          // Got coordinates → computed sunrise/sunset → store in cfg and apply
          var cfg = getCfg();
          cfg.sunriseHour = times.sunriseHour;
          cfg.sunriseMin  = times.sunriseMin;
          cfg.sunsetHour  = times.sunsetHour;
          cfg.sunsetMin   = times.sunsetMin;
          _cfg = cfg;
          _cacheTs = Date.now();
          // Show human-readable confirmation
          var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
          if (typeof toast === 'function')
            toast('Sun schedule set — filter active ' +
              pad(times.sunsetHour) + ':' + pad(times.sunsetMin) + ' → ' +
              pad(times.sunriseHour) + ':' + pad(times.sunriseMin), 'success', 3500);
          _schedApply('sun');
        },
        function () {
          // Denied or error — stay on current schedule (don't switch to 'sun')
          render();
        }
      );
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
    _toggleDay: _toggleDay,
    _openTimePicker: _openTimePicker,
    _addExcluded: _addExcluded, _pickExcluded: _pickExcluded,
    _removeExcluded: _removeExcluded,
    _save: _save, _discard: _discard
  };
}());

/* GEO-03: Retry sun-schedule location request when the user returns to the app
 * after manually granting location permission in system Settings.
 * MainActivity.onResume() calls window.onAppResume() on every foreground resume.
 * We check _sfGeoPending (set by _requestSunLocation on PERMISSION_DENIED) and,
 * if the sun schedule is still selected, silently retry without user interaction. */
(function () {
  var _prev = window.onAppResume;
  window.onAppResume = function () {
    if (_prev) _prev();
    if (!window._sfGeoPending) return;
    try {
      var cfg = ScreenFilter.getCfg();
      if (cfg && cfg.schedule === 'sun') {
        // Retry: if permission is now granted, _requestSunLocation succeeds and
        // clears _sfGeoPending; if still denied, the flag stays set for next resume.
        ScreenFilter._sched('sun');
      } else {
        window._sfGeoPending = false; // schedule changed while we were waiting
      }
    } catch (_) {}
  };
}());