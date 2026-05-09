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

  // Sun-first to match Bedtime: index 0=Sunday … 6=Saturday
  var DAY_LABELS      = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var DAY_LABELS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
      // 7-element array [Sun..Sat], 1=active 0=skip
      schedDays: [1, 1, 1, 1, 1, 1, 1],
      schedDaysSunFirst: true,
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
      _cfg.schedDaysSunFirst = true;
    }
    // Migrate old Mon-first (index 0=Mon) → Sun-first (index 0=Sun)
    if (!_cfg.schedDaysSunFirst) {
      var old = _cfg.schedDays;
      _cfg.schedDays = [old[6], old[0], old[1], old[2], old[3], old[4], old[5]];
      _cfg.schedDaysSunFirst = true;
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
      var cfgDay    = now.getDay(); // 0=Sun…6=Sat — matches schedDays Sun-first
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
    var cfgDay = now.getDay(); // 0=Sun…6=Sat — matches schedDays Sun-first
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

    // FIX 4: separate day picker HTML for each mode so IDs never collide.
    // custom schedule → 'sf-day-*' IDs (inside #sf-times, always visible when custom active)
    // sun schedule    → 'sf-sday-*' IDs (outside #sf-times, no overlap)
    var customDayPickerHtml = (isPro && cfg.schedule === 'custom') ? _buildDayPicker(cfg.schedDays, 'sf-day-')  : '';
    var sunDayPickerHtml    = (isPro && cfg.schedule === 'sun')    ? _buildDayPicker(cfg.schedDays, 'sf-sday-') : '';

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

        // When to run — renamed options for clarity
        '<div class="sf-sec-lbl">WHEN TO RUN</div>' +
        '<div class="sf-sched-list">' +
          _schedRow('none',   'Manual (Always On)',       null,         cfg.schedule, false) +
          _schedRow('sun',    'Automatic (Sun-based)',    _sunSubLabel(cfg), cfg.schedule, !isPro) +
          _schedRow('custom', 'Scheduled (Custom times)', null,         cfg.schedule, !isPro) +
        '</div>' +

        // FIX 3: custom time pickers — now have onclick via _timePicker()
        '<div id="sf-times" style="' + (cfg.schedule === 'custom' && isPro ? '' : 'display:none') + '">' +
          '<div class="sf-time-row">' +
            _timePicker('Start', cfg.schedStartHour, cfg.schedStartMin, 'sf-t-start') +
            _timePicker('End',   cfg.schedEndHour,   cfg.schedEndMin,   'sf-t-end') +
          '</div>' +
          // Day picker inside #sf-times uses 'sf-day-*' IDs (only rendered when custom is selected)
          customDayPickerHtml +
        '</div>' +

        // FIX 4: sun-based schedule day picker outside #sf-times — uses 'sf-sday-*' IDs (no collision)
        sunDayPickerHtml +


 // FIX 1 + 2: excluded apps — camera shown as single chip
        '<div class="sf-sec-lbl">PAUSED FOR APPS</div>' +
        excludedHtml +

        // SF-26: Transparency / documentation row
        // Users always know what the filter does and can dismiss it without
        // hunting through settings — matches Aurelo Coach transparency philosophy.
        '<div class="sf-info-row">' +
          '<span class="sf-info-icon">&#9432;</span>' +
          '<p class="sf-info-text">' +
            'Screen Filter applies a warm tint to ease blue light and reduce brightness. ' +
            'As a private overlay, it passes touches through—it cannot see or read your screen content.<br><br>' +
            '<strong>To disable:</strong> Tap <strong>OFF</strong> above, or tap the Aurelo notification in your shade.' +
          '</p>' +
        '</div>' +

        // Save / Discard
        '<div class="sf-actions" id="sf-actions" style="display:none">' +
          '<button class="sf-discard" onclick="ScreenFilter._discard()">Discard</button>' +
          '<button class="sf-save"    onclick="ScreenFilter._save()">Save</button>' +
        '</div>' +

      // Bug-3 FIX: closing </div> for the outer card div was missing, causing the
      // '+' operator to concatenate _bindSliders() return value (undefined) into
      // the innerHTML string, which rendered the literal text "undefined" below
      // the Save/Discard buttons.
      '</div>';

    _bindSliders();
    _bindExcludedApps();
    // FIX 1: restore dirty state after re-render — _markDirty() was called before
    // render() in _preset() / _sched(), but render() reset _dirty to false at the
    // top. Restoring via _markDirty() makes the save/discard bar reappear correctly.
    if (wasDirty) _markDirty();
  }

  /* ── Excluded apps HTML — bedtime-style: 5 chips + overflow ── */
  function _buildExcludedAppsHtml(apps) {
    var nonCam = apps.filter(function (p) { return CAMERA_PKGS.indexOf(p) === -1; });
    var chips  = '';

    // Camera auto chip always first
    chips +=
      '<div class="sf-excl-chip">' +
        '<span class="sf-excl-lbl">📷 Camera</span>' +
        '<span class="sf-excl-auto">auto</span>' +
      '</div>';

    // Show first 5 user-added apps
    nonCam.slice(0, 5).forEach(function (pkg) {
      chips +=
        '<div class="sf-excl-chip">' +
          '<span class="sf-excl-lbl">' + _pkgLabel(pkg) + '</span>' +
          '<button class="sf-excl-rm" onclick="ScreenFilter._removeExcluded(\'' + pkg + '\')" aria-label="Remove">\u00d7</button>' +
        '</div>';
    });

    // Overflow chip — tapping opens panel with "Selected" filter pre-active
    if (nonCam.length > 5) {
      chips +=
        '<div class="sf-excl-chip sf-excl-overflow" onclick="ScreenFilter._addExcluded(true)" ' +
          'style="background:var(--s2,rgba(255,255,255,.04));border-color:var(--border2);' +
          'color:var(--t3);font-family:var(--ff-m);font-size:var(--text-2xs);' +
          'font-weight:700;cursor:pointer">+' + (nonCam.length - 5) + ' more</div>';
    }

    return (
      '<div class="sf-excl-wrap" id="sf-excl-wrap">' +
        chips +
        '<button class="sf-excl-add" id="sf-excl-add" onclick="ScreenFilter._addExcluded()">+ Add app</button>' +
      '</div>' +
      '<div class="sf-excl-note">Auto-pauses for Camera & chosen apps. Resumes when you’re done.</div>'
    );
  }

  function _pkgLabel(pkg) {
    var parts = pkg.split('.');
    var last   = parts[parts.length - 1];
    return last.charAt(0).toUpperCase() + last.slice(1);
  }

  /* ── Day-of-week picker — bedtime-style, Sun-first ──────────── */
  /* idPrefix distinguishes custom ('sf-day-') from sun ('sf-sday-') pickers so
   * duplicate IDs never appear when both schedules' HTML coexists in the DOM. */
  function _buildDayPicker(days, idPrefix) {
    idPrefix = idPrefix || 'sf-day-';
    var btns = '';
    DAY_LABELS.forEach(function (lbl, i) {
      var on = days[i] !== 0;
      var borderColor = on ? 'var(--p)' : 'var(--border2,rgba(255,255,255,.12))';
      var bg          = on ? 'var(--p)' : 'var(--bg,#0d0d1a)';
      var color       = on ? '#fff'     : 'var(--t3,rgba(255,255,255,.35))';
      btns +=
        '<div id="' + idPrefix + i + '" data-active="' + (on ? '1' : '0') + '"' +
          ' onclick="ScreenFilter._toggleDay(' + i + ')"' +
          ' aria-label="' + DAY_LABELS_FULL[i] + '" aria-pressed="' + on + '"' +
          ' style="flex:1;text-align:center;padding:7px 0 5px;border-radius:8px;cursor:pointer;' +
          'font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;' +
          'border:1px solid ' + borderColor + ';' +
          'background:' + bg + ';' +
          'color:' + color + ';' +
          '-webkit-tap-highlight-color:transparent">' + lbl + '</div>';
    });
    return (
      '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);' +
      'color:var(--t2,rgba(255,255,255,.6));font-weight:600;margin:14px 0 8px">Active days</div>' +
      '<div class="sf-day-row">' + btns + '</div>'
    );
  }

  function _toggleDay(idx) {
    var cfg = getCfg();
    if (!Array.isArray(cfg.schedDays) || cfg.schedDays.length !== 7)
      cfg.schedDays = [1, 1, 1, 1, 1, 1, 1];
    cfg.schedDays[idx] = cfg.schedDays[idx] ? 0 : 1;
    _cfg = cfg;
    _cacheTs = Date.now();
    // FIX: sun schedule uses 'sf-sday-' prefix; custom uses 'sf-day-'
    // This prevents getElementById from accidentally finding the hidden copy
    // inside #sf-times when sun is selected (duplicate-ID bug).
    var prefix = cfg.schedule === 'sun' ? 'sf-sday-' : 'sf-day-';
    var pill = document.getElementById(prefix + idx);
    if (pill) {
      var on = !!cfg.schedDays[idx];
      pill.setAttribute('data-active', on ? '1' : '0');
      pill.setAttribute('aria-pressed', on);
      pill.style.borderColor = on ? 'var(--p)' : 'var(--border2,rgba(255,255,255,.12))';
      pill.style.background  = on ? 'var(--p)' : 'var(--bg,#0d0d1a)';
      pill.style.color       = on ? '#fff'     : 'var(--t3,rgba(255,255,255,.35))';
    }
    _markDirty();
  }

  /* ── HTML helpers ──────────────────────────────────────────── */
  /* ── Sun schedule sublabel helper ───────────────────────────── */
  function _sunSubLabel(cfg) {
    if (cfg.sunsetHour == null || cfg.sunriseHour == null) return null;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var times = pad(cfg.sunsetHour) + ':' + pad(cfg.sunsetMin || 0) +
      ' \u2192 ' + pad(cfg.sunriseHour) + ':' + pad(cfg.sunriseMin || 0);
    return cfg.sunCity ? cfg.sunCity + ' \u00b7 ' + times : times;
  }

  var PRESET_SUBS = {
    soft:    'Reduces eye strain',
    medium:  'Blocks blue light',
    bedtime: 'Melatonin protection',
    custom:  'Advanced manual control'
  };

  function _pBtn(key, label, cur) {
    var sub = PRESET_SUBS[key] || '';
    return '<button class="sf-pset' + (cur === key ? ' sf-pset--on' : '') +
      '" onclick="ScreenFilter._preset(\'' + key + '\')">' +
        '<span class="sf-pset-lbl">' + label + '</span>' +
        '<span class="sf-pset-sub">' + sub + '</span>' +
      '</button>';
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

  function _schedRow(key, label, sublabel, cur, pro) {
    var proTag = pro ? ' <span class="sf-pro-tag">PRO</span>' : '';
    var click  = pro
      ? 'typeof ProTier!==\'undefined\'&&ProTier.triggerUpsell(\'screen_filter\')'
      : 'ScreenFilter._sched(\'' + key + '\')';
    var subHtml = sublabel
      ? '<div class="sf-sched-sub">' + sublabel + '</div>'
      : '';
    return '<div class="sf-sched-row' + (pro ? ' sf-sched--pro' : '') + '" onclick="' + click + '">' +
      '<div class="sf-radio' + (cur === key ? ' sf-radio--on' : '') + '"></div>' +
      '<div class="sf-sched-lbl-wrap">' +
        '<span class="sf-sched-lbl">' + label + proTag + '</span>' +
        subHtml +
      '</div>' +
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

  /* Picker state — module-level so helper fns can access without closure ── */
  var _sfPickerBd = null, _sfPickerSh = null;
  var _sfPickerH = 12, _sfPickerM = 0, _sfPickerP = 'AM', _sfPickerTarget = null;

  /* Grid time picker — matches focus-routine style (AM/PM + hour grid + minute grid) */
  function _openTimePicker(blockId) {
    var cfg     = getCfg();
    var isStart = blockId === 'sf-t-start';
    var curH    = isStart ? cfg.schedStartHour : cfg.schedEndHour;
    var curM    = isStart ? cfg.schedStartMin  : cfg.schedEndMin;

    _sfPickerTarget = blockId;
    _sfPickerP = curH >= 12 ? 'PM' : 'AM';
    _sfPickerH = curH % 12 === 0 ? 12 : curH % 12;
    _sfPickerM = Math.round(curM / 5) * 5;
    if (_sfPickerM >= 60) _sfPickerM = 55;

    _sfPickerBd = document.createElement('div');
    _sfPickerBd.className = 'sf-backdrop';
    _sfPickerSh = document.createElement('div');
    _sfPickerSh.className = 'sf-perm-sheet sf-tp-sheet';

    // Hour cells 1–12
    var hourCells = '';
    for (var h = 1; h <= 12; h++) {
      hourCells += '<div class="sf-tp-cell" id="sf-ph-' + h + '" ' +
        'onclick="ScreenFilter._sfPickerSetH(' + h + ')">' + h + '</div>';
    }
    // Minute cells :00 :05 … :55
    var minCells = '';
    for (var m = 0; m < 60; m += 5) {
      minCells += '<div class="sf-tp-cell" id="sf-pm-' + m + '" ' +
        'onclick="ScreenFilter._sfPickerSetM(' + m + ')">:' + (m < 10 ? '0' + m : m) + '</div>';
    }

    _sfPickerSh.innerHTML =
      '<div class="sf-drag"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:0 2px 10px">' +
        '<div style="font-family:var(--ff-d);font-size:15px;font-weight:700;color:var(--t1)">' +
          (isStart ? 'Start Time' : 'End Time') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="display:flex;background:var(--s2,rgba(255,255,255,.06));border-radius:10px;' +
               'border:1px solid var(--border2,rgba(255,255,255,.1));overflow:hidden">' +
            '<div id="sf-tp-am" onclick="ScreenFilter._sfPickerSetP(\'AM\')" ' +
              'style="padding:6px 14px;font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer;transition:all .12s">AM</div>' +
            '<div id="sf-tp-pm" onclick="ScreenFilter._sfPickerSetP(\'PM\')" ' +
              'style="padding:6px 14px;font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer;transition:all .12s">PM</div>' +
          '</div>' +
          '<div onclick="ScreenFilter._sfPickerDone()" ' +
            'style="font-family:var(--ff-m);font-size:13px;font-weight:700;color:var(--p);cursor:pointer;padding:4px 0 4px 4px">Done</div>' +
        '</div>' +
      '</div>' +
      '<div id="sf-tp-display" style="text-align:center;font-family:var(--ff-d);font-size:36px;' +
        'font-weight:700;color:var(--t1);letter-spacing:-1.5px;padding:2px 16px 12px;line-height:1.1"></div>' +
      '<div style="padding:0 0 8px">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
             'letter-spacing:.8px;margin-bottom:6px">HOUR</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">' + hourCells + '</div>' +
      '</div>' +
      '<div style="padding:8px 0 16px">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
             'letter-spacing:.8px;margin-bottom:6px">MINUTE</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">' + minCells + '</div>' +
      '</div>';

    document.body.appendChild(_sfPickerBd);
    document.body.appendChild(_sfPickerSh);
    _sfPickerBd.onclick = function () { _sfPickerDismiss(); };
    _sfPickerRefresh();
  }

  function _sfPickerRefresh() {
    for (var h = 1; h <= 12; h++) {
      var el = document.getElementById('sf-ph-' + h);
      if (el) el.classList.toggle('sf-tp-cell--on', h === _sfPickerH);
    }
    for (var m = 0; m < 60; m += 5) {
      var el2 = document.getElementById('sf-pm-' + m);
      if (el2) el2.classList.toggle('sf-tp-cell--on', m === _sfPickerM);
    }
    var amEl = document.getElementById('sf-tp-am');
    var pmEl = document.getElementById('sf-tp-pm');
    if (amEl) { amEl.style.background = _sfPickerP === 'AM' ? 'var(--p)' : 'transparent'; amEl.style.color = _sfPickerP === 'AM' ? '#fff' : 'var(--t3)'; }
    if (pmEl) { pmEl.style.background = _sfPickerP === 'PM' ? 'var(--p)' : 'transparent'; pmEl.style.color = _sfPickerP === 'PM' ? '#fff' : 'var(--t3)'; }
    var disp = document.getElementById('sf-tp-display');
    if (disp) disp.textContent = String(_sfPickerH).padStart(2, '0') + ':' + String(_sfPickerM).padStart(2, '0') + ' ' + _sfPickerP;
  }

  function _sfPickerSetH(h) { _sfPickerH = h; _sfPickerRefresh(); }
  function _sfPickerSetM(m) { _sfPickerM = m; _sfPickerRefresh(); }
  function _sfPickerSetP(p) { _sfPickerP = p; _sfPickerRefresh(); }

  function _sfPickerDismiss() {
    if (_sfPickerBd) { _sfPickerBd.remove(); _sfPickerBd = null; }
    if (_sfPickerSh) { _sfPickerSh.remove(); _sfPickerSh = null; }
  }

  function _sfPickerDone() {
    var h24 = _sfPickerP === 'AM'
      ? (_sfPickerH === 12 ? 0  : _sfPickerH)
      : (_sfPickerH === 12 ? 12 : _sfPickerH + 12);
    _sfPickerDismiss();
    if (!_sfPickerTarget) return;
    var localCfg = getCfg();
    var isStart  = _sfPickerTarget === 'sf-t-start';
    if (isStart) { localCfg.schedStartHour = h24; localCfg.schedStartMin = _sfPickerM; }
    else         { localCfg.schedEndHour   = h24; localCfg.schedEndMin   = _sfPickerM; }
    _cfg = localCfg;
    _cacheTs = Date.now();
    var block = document.getElementById(_sfPickerTarget);
    if (block) {
      var valEl = block.querySelector('.sf-time-val');
      if (valEl) valEl.textContent = _f2(h24) + ':' + _f2(_sfPickerM);
    }
    _markDirty();
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
        window._sfGeoPending = false;
        var times = _computeSunTimes(pos.coords.latitude, pos.coords.longitude);
        if (!times) {
          if (typeof toast === 'function') toast('Sun times unavailable for polar latitudes — use Custom schedule instead', 'warn', 4000);
          if (onDenied) onDenied();
          return;
        }
        // Attempt reverse geocode for city name — silent fail is fine
        var lat = pos.coords.latitude.toFixed(4);
        var lon = pos.coords.longitude.toFixed(4);
        try {
          fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lon + '&zoom=10', {
            headers: { 'Accept-Language': 'en', 'User-Agent': 'Aurelo/1.0' }
          }).then(function (r) { return r.json(); }).then(function (data) {
            var addr = data && data.address;
            var city = addr && (addr.city || addr.town || addr.village || addr.county || '');
            if (city) times.city = city;
            if (onSuccess) onSuccess(times);
          }).catch(function () { if (onSuccess) onSuccess(times); });
        } catch (_) {
          if (onSuccess) onSuccess(times);
        }
      },
      function (err) {
        if (err.code === 1) {
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
      _requestSunLocation(
        function (times) {
          var cfg = getCfg();
          cfg.sunriseHour = times.sunriseHour;
          cfg.sunriseMin  = times.sunriseMin;
          cfg.sunsetHour  = times.sunsetHour;
          cfg.sunsetMin   = times.sunsetMin;
          // Store city name for display if reverse geocode available
          if (times.city) cfg.sunCity = times.city;
          cfg.schedule = 'sun';
          _cfg = cfg;
          _cacheTs = Date.now();
          // No toast here — shown only after Save so user can review first
          _schedApply('sun');
        },
        function () {
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

  /* ── Excluded apps handlers ──────────────────────────────────── */

  /* Multi-select app picker panel — similar to bedtime blocked-apps picker */
  /* initialFilter: pass true/'selected' to open with Selected tab active (used by overflow chip) */
  function _addExcluded(initialFilter) {
    var installedRaw = [];
    try {
      if (IS_NATIVE && typeof N.getCachedApps === 'function')
        installedRaw = JSON.parse(N.getCachedApps() || '[]');
    } catch (_) {}

    var cfg = getCfg();
    // Start with a copy of current excluded set (without camera)
    var pending = new Set(cfg.excludedApps.filter(function (p) {
      return CAMERA_PKGS.indexOf(p) === -1;
    }));

    // Filter out camera from the list
    var allApps = installedRaw.filter(function (a) {
      return CAMERA_PKGS.indexOf(a.packageName) === -1;
    }).sort(function (a, b) {
      return (a.name || a.packageName).localeCompare(b.name || b.packageName);
    });

    if (!allApps.length) {
      var pkg = window.prompt('Enter package name (e.g. com.instagram.android):');
      if (pkg && pkg.trim()) _applyExcludedSet(new Set(cfg.excludedApps.concat([pkg.trim()])));
      return;
    }

    var backdrop = document.createElement('div');
    backdrop.className = 'sf-backdrop';
    var panel = document.createElement('div');
    panel.className = 'sf-excl-panel';

    function _buildRows(filter, query) {
      var q = (query || '').toLowerCase().trim();
      return allApps
        .filter(function (a) {
          var nameMatch = !q || (a.name || a.packageName).toLowerCase().includes(q);
          var selMatch  = filter !== 'selected' || pending.has(a.packageName);
          return nameMatch && selMatch;
        })
        .map(function (a) {
          var on  = pending.has(a.packageName);
          var lbl = a.name || a.packageName;
          return '<div class="sf-ep-row" data-pkg="' + a.packageName + '" ' +
            'onclick="ScreenFilter._togglePendingExclude(\'' + a.packageName + '\')">' +
            '<div class="sf-ep-ico">' +
              (IS_NATIVE && typeof appIco === 'function' ? appIco(a.packageName, 36, 9) : '📱') +
            '</div>' +
            '<div class="sf-ep-name">' + lbl + '</div>' +
            '<div class="sf-ep-check' + (on ? ' sf-ep-check--on' : '') + '" ' +
              'id="sf-epchk-' + a.packageName.replace(/\./g, '_') + '"></div>' +
          '</div>';
        }).join('') || '<div class="sf-ep-empty">No apps found</div>';
    }

    var selCount = pending.size;
    panel.innerHTML =
      '<div class="sf-drag"></div>' +
      '<div class="sf-ep-hdr">' +
        '<div class="sf-ep-title">Pause filter for apps</div>' +
        '<div class="sf-ep-pills">' +
          '<div class="sf-ep-pill sf-ep-pill--on" id="sf-ep-all"  onclick="ScreenFilter._setExclFilter(\'all\')">All</div>' +
          '<div class="sf-ep-pill"              id="sf-ep-sel"  onclick="ScreenFilter._setExclFilter(\'selected\')">' +
            'Selected' + (selCount ? ' (' + selCount + ')' : '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sf-ep-search-wrap">' +
        '<input class="sf-ep-search" id="sf-ep-q" placeholder="Search apps…" ' +
          'oninput="ScreenFilter._filterExclPanel(this.value)" autocomplete="off">' +
      '</div>' +
      '<div class="sf-ep-list" id="sf-ep-list">' + _buildRows('all', '') + '</div>' +
      '<div class="sf-ep-foot">' +
        '<button class="sf-discard" onclick="ScreenFilter._dismissExclPanel()">Cancel</button>' +
        '<button class="sf-save" id="sf-ep-save" onclick="ScreenFilter._saveExclPanel()">' +
          'Save' + (selCount ? ' (' + selCount + ')' : '') + '</button>' +
      '</div>';

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    backdrop.onclick = function () { _dismissExclPanel(); };

    // Store state on panel for access from event handlers
    window._sfExclPanel = { panel: panel, backdrop: backdrop, pending: pending, allApps: allApps, filter: 'all' };

    // Expose helpers called from inline onclick
    window._sfBuildExclRows = _buildRows;

    // FIX 3: open with Selected filter pre-active when launched from overflow chip
    if (initialFilter === true || initialFilter === 'selected') {
      _setExclFilter('selected');
    }
  }

  function _togglePendingExclude(pkg) {
    if (!window._sfExclPanel) return;
    var state = window._sfExclPanel;
    if (state.pending.has(pkg)) { state.pending.delete(pkg); }
    else                        { state.pending.add(pkg); }
    var chk = document.getElementById('sf-epchk-' + pkg.replace(/\./g, '_'));
    if (chk) chk.classList.toggle('sf-ep-check--on', state.pending.has(pkg));
    // Update Selected pill count + save button
    var selCount = state.pending.size;
    var selPill = document.getElementById('sf-ep-sel');
    if (selPill) selPill.textContent = 'Selected' + (selCount ? ' (' + selCount + ')' : '');
    var saveBtn = document.getElementById('sf-ep-save');
    if (saveBtn) saveBtn.textContent = 'Save' + (selCount ? ' (' + selCount + ')' : '');
  }

  function _setExclFilter(filter) {
    if (!window._sfExclPanel) return;
    window._sfExclPanel.filter = filter;
    var pillAll = document.getElementById('sf-ep-all');
    var pillSel = document.getElementById('sf-ep-sel');
    if (pillAll) { pillAll.classList.toggle('sf-ep-pill--on', filter === 'all'); }
    if (pillSel) { pillSel.classList.toggle('sf-ep-pill--on', filter === 'selected'); }
    var q = (document.getElementById('sf-ep-q') || {}).value || '';
    var listEl = document.getElementById('sf-ep-list');
    if (listEl) listEl.innerHTML = window._sfBuildExclRows(filter, q);
  }

  function _filterExclPanel(query) {
    if (!window._sfExclPanel) return;
    var listEl = document.getElementById('sf-ep-list');
    if (listEl) listEl.innerHTML = window._sfBuildExclRows(window._sfExclPanel.filter, query);
  }

  function _dismissExclPanel() {
    if (!window._sfExclPanel) return;
    window._sfExclPanel.panel.remove();
    window._sfExclPanel.backdrop.remove();
    window._sfExclPanel = null;
    delete window._sfBuildExclRows;
  }

  function _saveExclPanel() {
    if (!window._sfExclPanel) return;
    var newSet = window._sfExclPanel.pending;
    _dismissExclPanel();
    _applyExcludedSet(newSet);
  }

  function _applyExcludedSet(newSet) {
    var cfg = getCfg();
    cfg.excludedApps = Array.from(newSet).filter(function (p) {
      return CAMERA_PKGS.indexOf(p) === -1;
    });
    _cfg = cfg;
    _cacheTs = Date.now();
    _markDirty();
    _refreshExclWrap(cfg.excludedApps);
  }

  function _pickExcluded(pkg) {
    if (window._sfPickerDismiss) window._sfPickerDismiss();
    _addExcludedPkg(pkg);
  }

  function _addExcludedPkg(pkg) {
    var cfg = getCfg();
    if (CAMERA_PKGS.indexOf(pkg) !== -1) return;
    if (cfg.excludedApps.indexOf(pkg) === -1) {
      cfg.excludedApps.push(pkg);
      _cfg = cfg;
      _cacheTs = Date.now();
      _markDirty();
      _refreshExclWrap(cfg.excludedApps);
    }
  }

  function _refreshExclWrap(apps) {
    var wrap = document.getElementById('sf-excl-wrap');
    if (!wrap) return;
    var note = wrap.nextElementSibling;
    var tmp  = document.createElement('div');
    tmp.innerHTML = _buildExcludedAppsHtml(apps);
    wrap.parentNode.replaceChild(tmp.firstChild, wrap);
    if (note && note.classList && note.classList.contains('sf-excl-note')) note.remove();
    _bindExcludedApps();
  }

  function _removeExcluded(pkg) {
    var cfg = getCfg();
    cfg.excludedApps = cfg.excludedApps.filter(function (p) { return p !== pkg; });
    _cfg = cfg;
    _cacheTs = Date.now();
    _markDirty();
    _refreshExclWrap(cfg.excludedApps);
  }

  function _save() {
    var cfg = getCfg();
    saveCfg(cfg);
    _dirty = false;
    var a = document.getElementById('sf-actions');
    if (a) a.style.display = 'none';
    // Show schedule-specific confirmation on save (not on schedule selection)
    if (cfg.schedule === 'sun' && cfg.sunsetHour != null) {
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      var msg = 'Filter saved \u00b7 active ' +
        pad(cfg.sunsetHour) + ':' + pad(cfg.sunsetMin || 0) + ' \u2192 ' +
        pad(cfg.sunriseHour) + ':' + pad(cfg.sunriseMin || 0);
      if (cfg.sunCity) msg = cfg.sunCity + ' \u00b7 ' + msg.replace('Filter saved · ', '');
      if (typeof toast === 'function') toast(msg, 'success', 4000);
    } else {
      if (typeof toast === 'function') toast('Screen filter saved', 'success');
    }
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
    _sfPickerSetH: _sfPickerSetH, _sfPickerSetM: _sfPickerSetM,
    _sfPickerSetP: _sfPickerSetP, _sfPickerDone: _sfPickerDone,
    _addExcluded: _addExcluded, _pickExcluded: _pickExcluded,
    _removeExcluded: _removeExcluded,
    _togglePendingExclude: _togglePendingExclude,
    _setExclFilter: _setExclFilter,
    _filterExclPanel: _filterExclPanel,
    _dismissExclPanel: _dismissExclPanel,
    _saveExclPanel: _saveExclPanel,
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