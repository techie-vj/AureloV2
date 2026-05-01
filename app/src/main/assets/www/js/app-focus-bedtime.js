'use strict';
/* ═══════════════════════════════════════════════════════════════
 * BEDTIME MODULE — app-focus-bedtime.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Bedtime Mode card (clock, days, blocked apps, settings),
 *       config persistence, DND permission flow, snooze.
 *
 * Depends on (globals expected at load time):
 *   FocusTab    — loadStripData(), invalidateStripCache(),
 *                 setPickerSelected(), buildPickerHTML(),
 *                 buildPickerUsageMap()
 *   FocusScore  — renderHabitsDynamicRow(), invalidateSleepCache()
 *   ProTier     — isPro, triggerUpsell()
 *   S, IS_NATIVE, N, toast, showConfirm, fmtM, appIco, escAttr
 *   proBadge(), openFocusAppPicker(), openPanel(), closePanel()
 *   filterPickerSearch(), renderHomeHabitsDynamicRow()
 *   CATS_MAP, buildCatsMap()
 *
 * Public API (via FocusBedtime.*):
 *   render()          — renders #focus-bedtime-strip
 *   toggle()          — master on/off (checks DND permission)
 *   toggleSettings()  — collapse/expand sleep settings sub-section
 *   save()            — inline save of clock + days + settings
 *   getCfg()          — returns current bedtime config object
 *   btInlineToggle(id)— toggle a settings row tog by element id
 *   btToggleDay(idx)  — toggle an active-day pill
 *   refreshChips()    — refresh blocked-apps chips after picker save
 *   snooze()          — snooze bedtime 15 min
 * ═══════════════════════════════════════════════════════════════ */
window.FocusBedtime = (function () {

  /* ── Constants ────────────────────────────────────────────────── */
  var _CFG_CACHE_TTL_MS = 2000;

  /* ── State ────────────────────────────────────────────────────── */
  var _bedtimeCfgCache   = null;
  var _bedtimeCfgCacheTs = 0;
  var _btBlockedApps     = [];   // live-edited list while card is open

  /* ═══════════════════════════════════════════════════════════════
   * CONFIG PERSISTENCE
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Persist a full bedtime config object.
   * Also sanitizes any decimal hour values that the clock drag can produce.
   */
  function _applyBedtimeConfig(cfg) {
    S.settings.bedtime = !!cfg.enabled;
    saveS();
    // Sanitize decimal hours (e.g. 7.75 → bedHour:7, bedMinute:45)
    (function _sanitize(hKey, mKey) {
      var dec = cfg[hKey];
      if (typeof dec === 'number' && !Number.isInteger(dec)) {
        var norm    = ((dec % 24) + 24) % 24;
        var snapped = Math.round(norm * 4) / 4;  // 15-min precision
        cfg[hKey] = Math.floor(snapped) % 24;
        cfg[mKey] = Math.round((snapped % 1) * 60);
      }
    })('bedHour', 'bedMinute');
    (function _sanitize(hKey, mKey) {
      var dec = cfg[hKey];
      if (typeof dec === 'number' && !Number.isInteger(dec)) {
        var norm    = ((dec % 24) + 24) % 24;
        var snapped = Math.round(norm * 4) / 4;
        cfg[hKey] = Math.floor(snapped) % 24;
        cfg[mKey] = Math.round((snapped % 1) * 60);
      }
    })('wakeHour', 'wakeMinute');

    cfg.enabled        = !!cfg.enabled;
    _bedtimeCfgCache   = cfg;
    _bedtimeCfgCacheTs = Date.now();

    // Invalidate sleep score cache
    if (typeof FocusScore !== 'undefined') FocusScore.invalidateSleepCache();
    // FIX: Invalidate today tab insight cache and notify home/wellness coach cards
    // that sleep data has changed (e.g. after bedtime settings saved / morning wakeup).
    try {
      if (typeof window.AppBridge === 'object' && window.AppBridge &&
          typeof window.AppBridge.invalidateTabInsightCache === 'function') {
        window.AppBridge.invalidateTabInsightCache('today');
      }
      document.dispatchEvent(new CustomEvent('aurelo:sleepcomplete'));
    } catch (_) {}

    if (IS_NATIVE && typeof N.saveBedtimeSettings === 'function') {
      try { N.saveBedtimeSettings(JSON.stringify(cfg)); } catch (_) {}
      // BUG-2a FIX: schedule (or cancel) alarms whenever config is persisted.
      // Previously only saveBedtimeSettings was called — scheduleBedtimeAlarms was
      // never invoked from JS, so BedtimeReceiver.BEDTIME_ON never fired and DND
      // was never activated at the configured hour.
      try {
        if (cfg.enabled) {
          if (typeof N.scheduleBedtimeAlarms === 'function') {
            N.scheduleBedtimeAlarms(
              cfg.bedHour   != null ? cfg.bedHour   : 22,
              cfg.bedMinute != null ? cfg.bedMinute : 0,
              cfg.wakeHour  != null ? cfg.wakeHour  : 7,
              cfg.wakeMinute != null ? cfg.wakeMinute : 0,
              !!cfg.windDown
            );
          }
        } else {
          if (typeof N.cancelBedtimeAlarms === 'function') N.cancelBedtimeAlarms();
        }
      } catch (_) {}
    } else {
      try { localStorage.setItem('bedtimeSettings', JSON.stringify(cfg)); } catch (_) {}
    }
    if (typeof updateBedtimeSub === 'function') updateBedtimeSub();
  }

  /**
   * Read bedtime config from native/localStorage with a short cache.
   */
  function _getBedtimeCfg() {
    var now = Date.now();
    if (_bedtimeCfgCache && (now - _bedtimeCfgCacheTs) < _CFG_CACHE_TTL_MS) {
      return _bedtimeCfgCache;
    }
    var cfg = {
      bedHour: 22, wakeHour: 7, grayscale: true, windDown: true,
      dimBrightness: true, blockedApps: [], enabled: !!S.settings.bedtime,
      activeDays: [0,1,2,3,4,5,6],
    };
    if (IS_NATIVE && typeof N.getBedtimeSettings === 'function') {
      try {
        var raw = JSON.parse(N.getBedtimeSettings() || '{}');
        Object.assign(cfg, raw);
        if (typeof cfg.blockedApps === 'string') {
          try { cfg.blockedApps = JSON.parse(cfg.blockedApps); } catch (_) { cfg.blockedApps = []; }
        }
        if (!Array.isArray(cfg.activeDays) || cfg.activeDays.length === 0) {
          cfg.activeDays = [0,1,2,3,4,5,6];
        }
      } catch (_) {}
    }
    S.settings.bedtime = cfg.enabled;
    _bedtimeCfgCache   = cfg;
    _bedtimeCfgCacheTs = now;
    return cfg;
  }

  /* ═══════════════════════════════════════════════════════════════
   * TOGGLE / DISABLE
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Collapse / expand the "Sleep settings" sub-section.
   */
  function _toggleBedtimeSettings() {
    var body = document.getElementById('bt-settings-body');
    var chev = document.getElementById('bt-settings-chev');
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    S.settings.bedtimeSettingsExpanded = !open;
    if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
  }

  /**
   * Master on/off toggle; checks DND permission on enable.
   */
  function _toggleBedtime() {
    var cfg = _getBedtimeCfg();
    if (!cfg.enabled) {
      // Enable — check DND permission first
      if (IS_NATIVE) {
        var hasDnd = typeof N.hasDndPermission === 'function' && N.hasDndPermission();
        if (!hasDnd) {
          showConfirm(
            'Do Not Disturb access needed',
            'Bedtime Mode silences calls and notifications at night. Tap Grant to allow it.',
            function () {
              try { N.openDndSettings(); } catch (_) { try { nCall('openDndSettings'); } catch (e) {} }
              window._pendingBedtimeToggleOn = true;
            },
            'Grant Permission', 'Cancel'
          );
          return;
        }
      }
      var newCfg = _getBedtimeCfg();
      newCfg.enabled = true;
      _applyBedtimeConfig(newCfg);
      // Mark today as a bedtime day for streak dots
      if (IS_NATIVE && typeof N.markBedtimeDay === 'function') {
        try { N.markBedtimeDay(); } catch (_) {}
      }
      window._btDirty = false;
      render();
      if (typeof FocusScore !== 'undefined') FocusScore.renderHabitsDynamicRow();
      // Bust strip cache and refresh all three home strips immediately so the
      // bedtime state appears on the home tab without needing a tab-switch.
      if (typeof FocusHome !== 'undefined') FocusHome._refreshStrips();
      // BUG-1b FIX: show a confirmation toast on enable, mirroring the
      // 'Bedtime mode off' toast shown on disable. Include the scheduled
      // window so the user sees what time was set.
      (function () {
        var c    = newCfg;
        var pad  = function (n) { return String(n).padStart(2, '0'); };
        var fmt  = function (h, m) {
          var h12 = h % 12 === 0 ? 12 : h % 12;
          return h12 + ':' + pad(m || 0) + ' ' + (h >= 12 ? 'PM' : 'AM');
        };
        var bedStr  = fmt(c.bedHour  != null ? c.bedHour  : 22, c.bedMinute  || 0);
        var wakeStr = fmt(c.wakeHour != null ? c.wakeHour : 7,  c.wakeMinute || 0);
        toast('Bedtime mode on \u00b7 ' + bedStr + ' \u2013 ' + wakeStr, 'success');
      })();
    } else {
      // Disable — _doDisableBedtime handles strip refresh internally
      window._btDirty = false;
      _disableBedtime();
    }
  }

  /**
   * Turn bedtime fully off and persist.
   * Also exposed as window._disableBedtime for app-settings.js compatibility.
   */
  function _disableBedtime() {
    var inWindow = false;

    if (IS_NATIVE && typeof N.isInBedtimeWindow === 'function') {
      try { inWindow = !!N.isInBedtimeWindow(); } catch (_) {}
    }

    if (!inWindow) {
      var cfg    = _getBedtimeCfg();
      var nowDec = new Date().getHours() + new Date().getMinutes() / 60;
      var bedDec  = (cfg.bedHour  || 22) + (cfg.bedMinute  || 0) / 60;
      var wakeDec = (cfg.wakeHour || 7)  + (cfg.wakeMinute || 0) / 60;
      inWindow = bedDec > wakeDec
        ? nowDec >= bedDec || nowDec < wakeDec
        : nowDec >= bedDec && nowDec < wakeDec;
    }

    if (inWindow) {
      _showBedtimeDisableNudge(_getBedtimeCfg());  // show nudge — don't disable yet
      return;
    }

    _doDisableBedtime();  // outside window — disable immediately
  }
  window._disableBedtime = _disableBedtime;

  /* ── Early-disable nudge — modal popup ─────────────────────────────────────── */
  function _showBedtimeDisableNudge(cfg) {
    const nowH = new Date().getHours();
    const nowM = new Date().getMinutes();
    const pad  = n => String(n).padStart(2, '0');
    const timeStr = `${pad(nowH % 12 === 0 ? 12 : nowH % 12)}:${pad(nowM)} ${nowH >= 12 ? 'PM' : 'AM'}`;

    // BUG-1 FIX: compute and display bedtime start alongside wake time so the
    // user can see the full scheduled window in the nudge (was showing wake only).
    const bedH    = cfg.bedHour    != null ? cfg.bedHour    : 22;
    const bedM    = cfg.bedMinute  != null ? cfg.bedMinute  : 0;
    const bedStr  = `${bedH % 12 === 0 ? 12 : bedH % 12}:${pad(bedM)} ${bedH >= 12 ? 'PM' : 'AM'}`;

    const wakeH   = cfg.wakeHour   != null ? cfg.wakeHour   : 7;
    const wakeM   = cfg.wakeMinute != null ? cfg.wakeMinute : 0;
    const wakeStr = `${wakeH % 12 === 0 ? 12 : wakeH % 12}:${pad(wakeM)} ${wakeH >= 12 ? 'PM' : 'AM'}`;

    document.getElementById('bt-nudge-popup')?.remove();

    const popup = document.createElement('div');
    popup.id = 'bt-nudge-popup';
    popup.innerHTML = `
      <div id="bt-nudge-overlay"
           style="position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.65);
                  display:flex;align-items:center;justify-content:center;padding:24px">
        <div style="width:100%;max-width:320px;background:#0f0f1a;
                    border:1px solid rgba(108,99,255,.25);border-radius:20px;
                    padding:28px 22px 22px;text-align:center;
                    box-shadow:0 24px 80px rgba(0,0,0,.8)">

          <div style="font-size:40px;margin-bottom:12px">🌙</div>

          <div style="font-size:16px;font-weight:700;color:#eeeeff;margin-bottom:6px">
            It's ${timeStr} — you set a bedtime
          </div>
          <div style="font-size:12px;color:rgba(238,238,255,.5);line-height:1.6;
                      margin-bottom:16px">
            Bedtime mode is active
            (<strong style="color:#a09bff">${bedStr}</strong>
            &rarr;
            <strong style="color:#a09bff">${wakeStr}</strong>).<br>
            What would you like to do?
          </div>

          <button type="button" onclick="snoozeBedtimePrompt();document.getElementById('bt-nudge-popup')?.remove()"
            style="width:100%;padding:13px;border-radius:13px;
                   border:1px solid rgba(108,99,255,.35);
                   background:rgba(108,99,255,.12);color:#a09bff;
                   font-size:13px;font-weight:700;cursor:pointer;
                   margin-bottom:8px;margin-top:8px;display:block">
            Just 15 more minutes
          </button>

          <button type="button" onclick="_bedtimeSnooze(30);document.getElementById('bt-nudge-popup')?.remove()"
            style="width:100%;padding:12px;border-radius:13px;
                   border:1px solid rgba(255,255,255,.1);
                   background:rgba(255,255,255,.05);color:rgba(238,238,255,.55);
                   font-size:12px;cursor:pointer;margin-bottom:8px;display:block">
            30 more minutes
          </button>

          <button type="button" onclick="_doDisableBedtime();document.getElementById('bt-nudge-popup')?.remove()"
            style="width:100%;padding:12px;border-radius:13px;border:none;
                   background:transparent;color:rgba(238,238,255,.3);
                   font-size:12px;cursor:pointer;display:block;margin-bottom:4px">
            I'm awake now — turn off bedtime
          </button>

          <div onclick="document.getElementById('bt-nudge-popup')?.remove()"
               style="font-size:var(--text-2xs);color:rgba(238,238,255,.25);margin-top:10px;cursor:pointer">
            Keep bedtime on →
          </div>

        </div>
      </div>
    `;

    popup.querySelector('#bt-nudge-overlay').addEventListener('click', function(e) {
      if (e.target === this) popup.remove();
    });

    document.body.appendChild(popup);
  }

  function _doDisableBedtime() {
    S.settings.bedtime = false;
    saveS();
    if (IS_NATIVE) {
      try { N.setBedtimeDnd(false); } catch (_) {}
      try { N.stopBedtimeBlock(); } catch (_) {}
      // grayscale removed — Google API no longer supports it

      try { N.cancelBedtimeAlarms(); } catch (_) {}
      try { N.recordBedtimeOff(); } catch (_) {}
      const cfg = _getBedtimeCfg();
      cfg.enabled = false;
      try { N.saveBedtimeSettings(JSON.stringify(cfg)); } catch (_) {}
    }
    Object.keys(_btPickerState).forEach(k => delete _btPickerState[k]);
    clearInterval(_bedtimePoller);
    updateBedtimeSub();
    if (typeof _renderBedtimeStrip === 'function') _renderBedtimeStrip();
    if (typeof _updateFocusSubheader === 'function') _updateFocusSubheader();

    render();
    if (typeof FocusScore !== 'undefined') FocusScore.renderHabitsDynamicRow();
    // Bust strip cache and refresh all home strips so bedtime-off state is
    // immediately visible without requiring a tab-switch or 30-s poll.
    if (typeof FocusHome !== 'undefined') FocusHome._refreshStrips();
    toast('Bedtime mode off', 'info');
  }

  function _closeBedtimeNudge() {
    const sheet    = document.getElementById('bt-nudge-panel');
    const backdrop = document.getElementById('bt-nudge-backdrop');
    if (sheet) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(() => sheet.remove(), 300);
    }
    if (backdrop) backdrop.remove();
  }

  /* Snooze: disable DND + blocking for N minutes, then re-enable */
  let _bedtimeSnoozeTimer = null;
  function _bedtimeSnooze(mins) {
    document.getElementById('bt-nudge-popup')?.remove();
    if (IS_NATIVE) {
      try { N.snoozeBedtime(mins); } catch (_) {}
    }
    toast(`Bedtime paused for ${mins} min 😴`, 'info', 2500);
  }

  /* ═══════════════════════════════════════════════════════════════
   * INLINE SAVE
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Persist clock position, active days, and settings toggle state.
   * Called by the "Save Changes" button.
   */
  function _saveBedtimeInline() {
    var cfg = _getBedtimeCfg();

    // Decimal hours from clock drag state
    var bedDec  = typeof window._btBedH  === 'number' ? window._btBedH
                : (cfg.bedHour  != null ? cfg.bedHour  : 22) + (cfg.bedMinute  || 0) / 60;
    var wakeDec = typeof window._btWakeH === 'number' ? window._btWakeH
                : (cfg.wakeHour != null ? cfg.wakeHour : 7)  + (cfg.wakeMinute || 0) / 60;

    function decToHM(dec) {
      var norm    = ((dec % 24) + 24) % 24;
      var snapped = Math.round(norm * 4) / 4;
      return { hour: Math.floor(snapped) % 24, minute: Math.round((snapped % 1) * 60) };
    }
    var bed  = decToHM(bedDec);
    var wake = decToHM(wakeDec);

    // Snap display state so clock doesn't drift
    window._btBedH  = bed.hour  + bed.minute  / 60;
    window._btWakeH = wake.hour + wake.minute / 60;

    // Read active days from pill DOM
    var activeDays = [0,1,2,3,4,5,6].filter(function (i) {
      var pill = document.getElementById('bt-day-' + i);
      if (!pill) return cfg.activeDays.includes(i);
      if (pill.dataset.active !== undefined) return pill.dataset.active === '1';
      return pill.classList.contains('bt-day-on');
    });

    var newCfg = {
      bedHour:        bed.hour,
      bedMinute:      bed.minute,
      wakeHour:       wake.hour,
      wakeMinute:     wake.minute,
      windDown:       (function () {
        var el = document.getElementById('bt-inline-tog-wind');
        return el ? el.classList.contains('on') : cfg.windDown;
      })(),
      morningSummary: (function () {
        var el = document.getElementById('bt-inline-tog-morning');
        return el ? el.classList.contains('on') : (cfg.morningSummary != null ? cfg.morningSummary : true);
      })(),
      blockedApps:    Array.isArray(_btBlockedApps) ? _btBlockedApps : (cfg.blockedApps || []),
      activeDays:     activeDays,
      enabled:        cfg.enabled,
    };

    // Pre-populate cache so re-reads before native write return correct values (snap-back fix)
    _bedtimeCfgCache   = newCfg;
    _bedtimeCfgCacheTs = Date.now();

    // Set seeded flag so render() skips re-seeding clock state
    window._btClockSeeded = true;
    _applyBedtimeConfig(newCfg);
    _bedtimeCfgCacheTs = 0; // bust so next tab-visit re-reads from bridge

    if (typeof FocusTab !== 'undefined') FocusTab.invalidateStripCache(); // kept for _applyBedtimeConfig internal reads

    window._btDirty      = false;
    window._btClockSeeded = true;  // consume again after _applyBedtimeConfig's internal render
    if (typeof FocusScore !== 'undefined') FocusScore.renderHabitsDynamicRow();
    // Bust strip cache and refresh all home strips so saved bedtime times and
    // blocked apps are visible on the home tab immediately after saving.
    if (typeof FocusHome !== 'undefined') FocusHome._refreshStrips();
    render();
    toast('Bedtime settings saved', 'success');
  }

  /* ═══════════════════════════════════════════════════════════════
   * SETTINGS TOGGLES & DAY PILLS
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Flip a tog element inside the settings section and mark form dirty.
   */
  function _btInlineToggle(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var on = el.classList.contains('on');
    el.classList.toggle('on', !on);
    el.classList.toggle('off', on);
    _btMarkDirty();
  }
  window._btInlineToggle = _btInlineToggle;

  function _btMarkDirty() {
    window._btDirty = true;
    var btn = document.getElementById('bt-save-btn');
    if (btn) btn.style.display = '';
  }

  /**
   * Toggle an active-day pill; prevents deselecting all days.
   */
  function _btToggleDay(dayIndex) {
    var pill = document.getElementById('bt-day-' + dayIndex);
    if (!pill) return;
    var active    = pill.dataset.active === '1';
    var allPills  = document.querySelectorAll('[id^="bt-day-"]');
    if (active) {
      var onCount = Array.from(allPills).filter(function (p) { return p.dataset.active === '1'; }).length;
      if (onCount <= 1) { toast('At least one day must be selected', 'warn'); return; }
    }
    var nowActive = !active;
    pill.dataset.active  = nowActive ? '1' : '0';
    pill.style.cssText   =
      'flex:1;text-align:center;padding:7px 0;border-radius:8px;cursor:pointer;' +
      'font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;' +
      'border:1px solid ' + (nowActive ? 'var(--p)' : 'var(--border2)') + ';' +
      'background:'       + (nowActive ? 'var(--p)' : 'var(--bg)') + ';' +
      'color:'            + (nowActive ? '#fff'     : 'var(--t3)') + ';' +
      'transition:background .15s,color .15s,border-color .15s';
    _btMarkDirty();
  }
  // Expose as window for inline onclick compatibility
  window._btToggleDay = _btToggleDay;

  /* ═══════════════════════════════════════════════════════════════
   * BLOCKED APPS
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Remove one app from the live blocked list and refresh chips.
   */
  function _btRemoveBlockedApp(pkg) {
    _btBlockedApps = _btBlockedApps.filter(function (a) { return a.packageName !== pkg; });
    var cfg = _getBedtimeCfg();
    cfg.blockedApps = _btBlockedApps.slice();
    _bedtimeCfgCache = cfg;
    _bedtimeCfgCacheTs = Date.now();
    _applyBedtimeConfig(cfg);
    _btRefreshInlineChips();
    toast('App removed', 'success');
  }
  window._btRemoveBlockedApp = _btRemoveBlockedApp;

  /**
   * Re-render just the chips section without a full card re-render.
   */
  function _btRefreshInlineChips() {
    // BUG-1 FIX: always mark dirty first so render() knows to use _btBlockedApps
    // even when the picker panel is covering the card and wrap is temporarily absent.
    _btMarkDirty();
    var wrap = document.getElementById('bt-inline-blocked-chips');
    if (!wrap) return;
    var chips = _btBlockedApps.slice(0, 5).map(function (a) {
      return '<div class="focus-app-chip blocked" style="margin-bottom:4px">' +
        '<div class="focus-chip-ico">' + appIco(a.packageName, 20, 5) + '</div>' +
        '<span>' + a.name.split(' ')[0] + '</span>' +
        '<span onclick="event.stopPropagation();_btRemoveBlockedApp(\'' + escAttr(a.packageName) + '\')"' +
        ' style="opacity:.45;font-size:12px;margin-left:2px;cursor:pointer">×</span>' +
        '</div>';
    }).join('');
    var overflow = _btBlockedApps.length > 5
      ? '<div class="focus-app-chip" onclick="_btInlineOpenBlockPicker(true)"' +
        ' style="background:var(--s2);border-color:var(--border2);color:var(--t3);' +
        'font-family:var(--ff-m);font-size:var(--text-2xs);cursor:pointer;font-weight:700">' +
        '+' + (_btBlockedApps.length - 5) + ' more</div>'
      : '';
    wrap.innerHTML = chips + overflow + (_btBlockedApps.length < 20
      ? '<div onclick="_btInlineOpenBlockPicker()" style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
        'border:1px dashed var(--border2);border-radius:8px;padding:5px 10px;cursor:pointer;opacity:.7">＋ Add</div>'
      : '');
    _btMarkDirty();
  }

  /**
   * Check overlay permission, then open the app-picker panel seeded with
   * the current bedtime blocked-apps list.
   */
  function _btInlineOpenBlockPicker(inSelected) {
    if (IS_NATIVE && typeof N.hasOverlayPermission === 'function' && !N.hasOverlayPermission()) {
      showConfirm(
        '"Display over other apps" needed',
        'Bedtime Mode needs this to show a block screen over restricted apps at night.',
        function () {
          if (typeof N.requestOverlayPermission === 'function') N.requestOverlayPermission();
          window._pendingBedtimePicker = true;
        },
        'Grant Permission', 'Cancel'
      );
      return;
    }
    _btInlineOpenBlockPickerNow(inSelected);
  }
  window._btInlineOpenBlockPicker = _btInlineOpenBlockPicker;

  /** Open the picker immediately (called after permission confirmed). */
  function _btInlineOpenBlockPickerNow(inSelected) {
    // Seed live list from saved cfg if empty
    if (!_btBlockedApps.length) {
      var cfg = _getBedtimeCfg();
      _btBlockedApps = Array.isArray(cfg.blockedApps) ? cfg.blockedApps.slice() : [];
    }

    // Ensure CATS_MAP is populated
    if (typeof CATS_MAP !== 'undefined' && !Object.keys(CATS_MAP).length && IS_NATIVE) {
      try { buildCatsMap(JSON.parse(N.getCachedApps() || '[]')); } catch (_) {}
    }

    if (typeof FocusTab !== 'undefined') {
      // Seed selection with current bedtime apps
      FocusTab.setPickerSelected(new Set(_btBlockedApps.map(function (a) { return a.packageName; })));
      FocusTab.buildPickerUsageMap();
    }

    var titleEl  = document.getElementById('focus-picker-title');
    var listEl   = document.getElementById('focus-picker-list');
    var searchEl = document.getElementById('focus-picker-search');
    if (titleEl)  titleEl.textContent = 'Block During Bedtime';
    if (listEl && typeof FocusTab !== 'undefined')   listEl.innerHTML = FocusTab.buildPickerHTML();
    if (searchEl) {
      searchEl.value   = '';
      searchEl.oninput = function () { if (typeof filterPickerSearch === 'function') filterPickerSearch(searchEl.value); };
    }

    // Set picker mode to 'bedtime' so saveFocusPick() routes back here
    // We do this after building the picker (which uses the selection we seeded)
    if (typeof openFocusAppPicker === 'function') {
      // openFocusAppPicker sets mode='bedtime' — then we re-apply our selection
      openFocusAppPicker('bedtime', inSelected);
      // Re-seed selection & rebuild list because openFocusAppPicker overwrites from _focusBlockedApps
      if (typeof FocusTab !== 'undefined') {
        FocusTab.setPickerSelected(new Set(_btBlockedApps.map(function (a) { return a.packageName; })));
        if (listEl) listEl.innerHTML = FocusTab.buildPickerHTML();
      }
      if (titleEl) titleEl.textContent = 'Block During Bedtime';
    } else if (typeof openPanel === 'function') {
      openPanel('focus-picker-panel');
    }
  }

  /**
   * Callback invoked by saveFocusPick() when picker mode === 'bedtime'.
   * Receives the final apps array; updates live state and refreshes chips.
   */
  window._btOnBlockPickerSave = function (apps) {
    _btBlockedApps = apps;
    _btRefreshInlineChips();
    // Ensure the bedtime card body is expanded so the chip row is visible.
    // If bt-card-body was collapsed when the picker opened the chips would
    // be correctly written to the DOM but hidden from the user.
    var body = document.getElementById('bt-card-body');
    if (body) body.style.display = 'block';
  };

  /* ═══════════════════════════════════════════════════════════════
   * STREAK HELPER
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Read bedtime streak from native bridge.
   * Exposed as window._getBedtimeStreak for backward compatibility.
   */
  function _getBedtimeStreak() {
    if (!IS_NATIVE || typeof N.getBedtimeStreak !== 'function') return { streak: 0 };
    try { return JSON.parse(N.getBedtimeStreak() || '{}') || { streak: 0 }; } catch (_) { return { streak: 0 }; }
  }
  window._getBedtimeStreak = _getBedtimeStreak;

  /* ═══════════════════════════════════════════════════════════════
   * CIRCULAR CLOCK
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Boots the canvas clock after render() injects #bt-clock-canvas.
   * Reads / writes window._btBedH and window._btWakeH (decimal 24-hour).
   * Snaps to 15-min increments.
   */
  function _btInitClock() {
    var canvas = document.getElementById('bt-clock-canvas');
    if (!canvas || canvas._btClockInit) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) { setTimeout(_btInitClock, 150); return; }
    canvas._btClockInit = true;

    var W = canvas.width, H = canvas.height, CX = W / 2, CY = H / 2;
    var R = 100, HR = 18;

    if (typeof window._btBedH  !== 'number') window._btBedH  = 22;
    if (typeof window._btWakeH !== 'number') window._btWakeH = 7;

    function snap(d)      { return Math.round(((d % 24) + 24) % 24 * 4) / 4; }
    function toAngle(d)   { return (d / 24) * Math.PI * 2 - Math.PI / 2; }
    function fromAngle(a) { return (((a + Math.PI / 2) / (Math.PI * 2) * 24) % 24 + 24) % 24; }
    function decStr(d) {
      var s = snap(d), hh = Math.floor(s), mm = Math.round((s % 1) * 60);
      return (hh % 12 || 12) + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');
    }
    function durStr() {
      var d = window._btWakeH - window._btBedH; if (d <= 0) d += 24;
      var h = Math.floor(d), m = Math.round((d % 1) * 60);
      return h + 'h' + (m ? ' ' + m + 'm' : '');
    }
    function hxy(d) { var a = toAngle(d); return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) }; }
    function dark() { var t = document.documentElement.getAttribute('data-theme'); if (t) return t !== 'light' && t !== 'warm'; return window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches; }

    function draw() {
      var dk     = dark();
      var trackC = dk ? '#2a2a3a' : '#eae8f0', arcC = dk ? '#8b84ff' : '#6c63ff';
      var arcF   = dk ? 'rgba(108,99,255,.2)' : 'rgba(108,99,255,.1)';
      var textP  = dk ? '#e8e6ff' : '#1a1a2e', textM = dk ? '#666' : '#888';
      var bedC   = dk ? '#ff6b8a' : '#f04e7a', wakeC = dk ? '#1ef0a0' : '#12d48a';
      var hBg    = dk ? '#1c1c2e' : '#fff';
      var tickMj = dk ? '#3a3a50' : '#ddd', tickMn = dk ? '#252535' : '#f0f0f0';

      ctx.clearRect(0, 0, W, H);

      // Track
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2);
      ctx.strokeStyle = trackC; ctx.lineWidth = 10; ctx.stroke();

      // Ticks — 96 positions = every 15 min
      for (var i = 0; i < 96; i++) {
        var a = (i / 96) * Math.PI * 2 - Math.PI / 2, maj = i % 4 === 0, inner = maj ? R - 13 : R - 6;
        ctx.beginPath();
        ctx.moveTo(CX + (R + 5) * Math.cos(a), CY + (R + 5) * Math.sin(a));
        ctx.lineTo(CX + inner * Math.cos(a),    CY + inner * Math.sin(a));
        ctx.strokeStyle = maj ? tickMj : tickMn; ctx.lineWidth = maj ? 1.5 : 0.75; ctx.stroke();
      }

      // Hour labels
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = textM;
      ctx.font = '500 10px system-ui,sans-serif';
      [{h:0,t:'12'},{h:6,t:'6'},{h:12,t:'12'},{h:18,t:'6'}].forEach(function (o) {
        var ang = toAngle(o.h), dist = R + 22;
        ctx.fillText(o.t, CX + dist * Math.cos(ang), CY + dist * Math.sin(ang));
      });
      ctx.font = '400 8px system-ui,sans-serif';
      ctx.fillText('AM', CX + (R + 22) * Math.cos(toAngle(0)),  CY + (R + 22) * Math.sin(toAngle(0))  + 11);
      ctx.fillText('PM', CX + (R + 22) * Math.cos(toAngle(12)), CY + (R + 22) * Math.sin(toAngle(12)) + 11);

      // Sleep arc — filled sector + stroke
      var sa = toAngle(window._btBedH), ea = toAngle(window._btWakeH);
      if (ea <= sa) ea += Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.arc(CX, CY, R, sa, ea); ctx.closePath();
      ctx.fillStyle = arcF; ctx.fill();
      ctx.beginPath(); ctx.arc(CX, CY, R, sa, ea);
      ctx.strokeStyle = arcC; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';

      // Centre: duration + label
      ctx.fillStyle = textP; ctx.font = '500 18px system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(durStr(), CX, CY - 9);
      ctx.font = '400 10px system-ui,sans-serif'; ctx.fillStyle = textM;
      ctx.fillText('sleep', CX, CY + 10);

      // Bed handle
      var bp = hxy(window._btBedH);
      ctx.beginPath(); ctx.arc(bp.x, bp.y, HR, 0, Math.PI * 2);
      ctx.fillStyle = hBg; ctx.fill(); ctx.strokeStyle = bedC; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.font = '14px serif'; ctx.fillText('🌙', bp.x, bp.y);

      // Wake handle
      var wp = hxy(window._btWakeH);
      ctx.beginPath(); ctx.arc(wp.x, wp.y, HR, 0, Math.PI * 2);
      ctx.fillStyle = hBg; ctx.fill(); ctx.strokeStyle = wakeC; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.font = '14px serif'; ctx.fillText('☀️', wp.x, wp.y);

      // Update pill text
      var pb = document.getElementById('bt-pill-bed'), pw = document.getElementById('bt-pill-wake');
      if (pb) pb.textContent = decStr(window._btBedH);
      if (pw) pw.textContent = decStr(window._btWakeH);
    }

    // Drag handlers
    var drag = null;
    function pt(e) {
      var rect = canvas.getBoundingClientRect(), sx = W / rect.width, sy = H / rect.height;
      var src  = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
    }
    function hit(p, d) { var h = hxy(d); return Math.hypot(p.x - h.x, p.y - h.y) < HR + 10; }
    function down(e) {
      var p = pt(e);
      var h = hit(p, window._btBedH) ? 'bed' : hit(p, window._btWakeH) ? 'wake' : null;
      if (h) { e.preventDefault(); e.stopPropagation(); drag = h; }
      else     drag = null;
    }
    function move(e) {
      if (!drag) return;
      e.preventDefault(); e.stopPropagation();
      var p   = pt(e);
      var raw = fromAngle(Math.atan2(p.y - CY, p.x - CX));
      if (drag === 'bed') {
        var prev  = ((window._btBedH % 24) + 24) % 24, delta = raw - prev;
        if (delta >  12) delta -= 24;
        if (delta < -12) delta += 24;
        window._btBedH = snap(((prev + delta) % 24 + 24) % 24);
      } else {
        window._btWakeH = snap(raw);
      }
      draw();
    }
    function up(e) { if (drag) { e.stopPropagation(); _btMarkDirty(); } drag = null; }

    canvas.addEventListener('mousedown',   down, { passive: false });
    canvas.addEventListener('mousemove',   move, { passive: false });
    canvas.addEventListener('mouseup',     up);
    canvas.addEventListener('mouseleave',  up);
    canvas.addEventListener('touchstart',  down, { passive: false });
    canvas.addEventListener('touchmove',   move, { passive: false });
    canvas.addEventListener('touchend',    up,   { passive: false });
    canvas.addEventListener('touchcancel', up,   { passive: false });

    draw();
  }

  /* ═══════════════════════════════════════════════════════════════
   * SNOOZE
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Snooze bedtime mode for 15 minutes.
   */
  function snoozeBedtimePrompt() {
    if (!IS_NATIVE || typeof N.snoozeBedtime !== 'function') return;

    // Don't snooze if already snoozed
    var snoozeEndsAt = 0;
    try {
      if (typeof N.getBedtimeSnoozeEndsAt === 'function')
        snoozeEndsAt = N.getBedtimeSnoozeEndsAt() || 0;
    } catch (_) {}
    if (snoozeEndsAt > Date.now()) {
      var minsLeft = Math.ceil((snoozeEndsAt - Date.now()) / 60000);
      toast('Snooze active \u2014 ' + minsLeft + 'm remaining', 'info');
      return;
    }

    N.snoozeBedtime(15);
    toast('Bedtime snoozed 15 min', 'info');

    // Re-render all home strips so snooze button reflects active state immediately.
    if (typeof FocusScore !== 'undefined') FocusScore.renderHabitsDynamicRow();
    if (typeof FocusHome !== 'undefined') FocusHome._refreshStrips();
  }

  /* ═══════════════════════════════════════════════════════════════
   * RENDER
   * ═══════════════════════════════════════════════════════════════ */

  function render() {
    var el = document.getElementById('focus-bedtime-strip');
    if (!el) return;

    // ── Pro gate ────────────────────────────────────────────────
    if (!ProTier.isPro) {
      el.style.cssText = 'display:flex;align-items:center;gap:12px;' +
        'background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:13px 16px;';
      el.innerHTML =
        '<div style="font-size:22px;flex-shrink:0;opacity:.5">🌙</div>' +
        '<div style="flex:1;min-width:0;cursor:pointer" onclick="ProTier.triggerUpsell(\'BEDTIME_MODE\')">' +
          '<div style="display:flex;align-items:center;gap:7px">' +
            '<span style="font-size:13px;font-weight:700;color:var(--t1)">Bedtime Mode</span>' +
            (typeof proBadge === 'function' ? proBadge() : '') +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">' +
            'DND &amp; wind-down &middot; Pro only</div>' +
        '</div>' +
        '<div class="tog off" onclick="ProTier.triggerUpsell(\'BEDTIME_MODE\')"' +
        ' style="flex-shrink:0;cursor:pointer;opacity:.5"><div class="tog-knob"></div></div>';
      return;
    }

    var cfg      = _getBedtimeCfg();
    var nowH     = new Date().getHours() + new Date().getMinutes() / 60;
    var bedDec   = (cfg.bedHour  != null ? cfg.bedHour  : 22) + (cfg.bedMinute  || 0) / 60;
    var wakeDec  = (cfg.wakeHour != null ? cfg.wakeHour : 7)  + (cfg.wakeMinute || 0) / 60;
    var inWindow = bedDec > wakeDec
      ? (nowH >= bedDec || nowH < wakeDec)
      : (nowH >= bedDec && nowH < wakeDec);

    // Seed clock state from saved config (skip if save just ran)
    if (!window._btClockSeeded) {
      window._btBedH  = bedDec;
      window._btWakeH = wakeDec;
    }
    window._btClockSeeded = false;
    var bedDecDisp  = window._btBedH;
    var wakeDecDisp = window._btWakeH;

    // Streak badge
    var streakData  = _getBedtimeStreak();
    var streakCount = streakData.streak || 0;

    // BUG-2 FIX: build per-day completion dots for the last 7 days.
    // Previously the tick for each day was inferred solely from cfg.activeDays
    // (scheduled days), so only today ever showed a filled dot even when the
    // streak was > 1 — yesterday's (and earlier) completed nights were ignored.
    //
    // Strategy: always mark the last `streakCount` consecutive days as complete
    // (a streak is by definition consecutive, so this is always authoritative).
    // Then additionally OR-in any explicit completions from the native `days`
    // array so days beyond the streak window are also shown if the bridge
    // provides them.
    //
    // Previously the native `days` array was trusted verbatim, but the bridge
    // can return streak:N while days[N-1] is still false (native write lag),
    // which caused only today's dot to appear even when the streak was > 1.
    var today = new Date().getDay(); // 0=Sun … 6=Sat
    var completedDotDays = new Set();
    // Step 1: seed from streak count — always correct for consecutive nights.
    // Use lastCompletedDow as anchor if available; fall back to yesterday
    var anchor = (typeof streakData.lastCompletedDow === 'number')
        ? streakData.lastCompletedDow
        : (today - 1 + 7) % 7;   // yesterday (last completed night ended this morning)

    for (var _d = 0; _d < Math.min(streakCount, 7); _d++) {
        completedDotDays.add((anchor - _d + 7) % 7);
    }
    // Step 2: merge native per-day array when available (additive only).
    if (Array.isArray(streakData.days) && streakData.days.length >= 7) {
      // streakData.days[0] = today, [1] = yesterday, etc.
      streakData.days.forEach(function (done, offset) {
        if (done) completedDotDays.add((today - offset + 7) % 7);
      });
    }

    var streakBadge = streakCount > 1
      ? '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);padding:2px 7px;border-radius:99px;' +
        'background:rgba(247,166,35,.15);color:var(--a);margin-left:5px">🔥 ' + streakCount + ' nights</span>'
      : '';

    // ── HC Enhanced badge (spec §7.3) ────────────────────────────
    var hcSleepAvail = typeof HealthConnect !== 'undefined' && HealthConnect.isConnected() && HealthConnect.getSleepData();
    var hcSleepBadge = hcSleepAvail
      ? '<span style="font-size:var(--text-2xs);color:var(--hc);background:var(--hc-dim);' +
        'border:1px solid var(--hc-border);border-radius:5px;' +
        'padding:1px 6px;font-weight:700;letter-spacing:.3px;margin-left:6px;' +
        'font-family:var(--ff-m)">HC Enhanced</span>'
      : '';

    // Status text
    function decToStr(dec) {
      var h24 = ((Math.round(dec * 4) / 4) + 24) % 24;
      var hh  = Math.floor(h24), mm = Math.round((h24 - hh) * 60);
      var h12 = hh % 12 === 0 ? 12 : hh % 12;
      return h12 + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');
    }
    var statusTxt;
    if (!cfg.enabled) {
      statusTxt = 'Tap to set your sleep routine.';
    } else if (inWindow) {
      statusTxt = 'Bedtime Active \u00b7 Ends at ' + decToStr(wakeDecDisp);
    } else {
      var nowMins  = nowH * 60;
      var minsAway = bedDec * 60 - nowMins;
      if (minsAway < 0) minsAway += 1440;

      var today      = new Date().getDay();
      var activeDays = Array.isArray(cfg.activeDays) ? cfg.activeDays : [0,1,2,3,4,5,6];
      var daysAhead  = 0;
      for (var i = 0; i < 7; i++) {
        var candidate = (today + i) % 7;
        if (activeDays.includes(candidate)) {
          if (i === 0 && minsAway <= 0) continue;
          daysAhead = i; break;
        }
      }
      var totalMins = minsAway + daysAhead * 1440;
      var hAway = Math.floor(totalMins / 60), mAway = Math.round(totalMins % 60);
      var countdown = hAway > 0 ? (hAway + 'h ' + mAway + 'm') : (mAway + 'm');
      var dayNames   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var daySuffix  = daysAhead === 0 ? '' : (' \u00b7 ' + dayNames[(today + daysAhead) % 7]);
      statusTxt = 'Starts in ' + countdown + daySuffix + ' \u00b7 ' + decToStr(bedDecDisp) + ' \u2013 ' + decToStr(wakeDecDisp);
    }

    // Blocked-apps chips
    // Only re-seed from persisted config when no pending in-memory edits exist.
    // If _btDirty is true the user has made picker changes not yet saved — keep
    // the live _btBlockedApps list so chips survive a render() call between
    // picker save and the main "Save Changes" button press (BUG-02 fix).
    var blockedApps = Array.isArray(cfg.blockedApps) ? cfg.blockedApps : [];
    if (!window._btDirty) {
      _btBlockedApps = blockedApps.slice();
    } else {
      blockedApps = _btBlockedApps;
    }
    var blockedChips = blockedApps.slice(0, 5).map(function (a) {
      return '<div class="focus-app-chip blocked" style="margin-bottom:4px">' +
        '<div class="focus-chip-ico">' + appIco(a.packageName, 20, 5) + '</div>' +
        '<span>' + a.name.split(' ')[0] + '</span>' +
        '<span onclick="event.stopPropagation();_btRemoveBlockedApp(\'' + escAttr(a.packageName) + '\')"' +
        ' style="opacity:.45;font-size:12px;margin-left:2px;cursor:pointer">\u00d7</span>' +
        '</div>';
    }).join('');
    var overflowChip = blockedApps.length > 5
      ? '<div class="focus-app-chip" onclick="openFocusAppPicker(\'bedtime\',true)"' +
        ' style="background:var(--s2);border-color:var(--border2);color:var(--t3);' +
        'font-family:var(--ff-m);font-size:var(--text-2xs);cursor:pointer;font-weight:700">' +
        '+' + (blockedApps.length - 5) + ' more</div>'
      : '';

    var settingsOpen = !!S.settings.bedtimeSettingsExpanded;

    el.style.cssText = 'background:var(--s2);border:1px solid var(--border2);border-radius:14px;overflow:hidden;';
    el.innerHTML =
      /* ── Header ─────────────────────────────────────────────── */
      '<div style="display:flex;align-items:center;gap:12px;padding:13px 16px">' +
        '<div style="font-size:22px;flex-shrink:0">🌙</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;flex-wrap:wrap">' +
            '<span style="font-size:13px;font-weight:700;color:var(--t1)">Bedtime Mode</span>' +
            streakBadge + hcSleepBadge +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">' + statusTxt + '</div>' +
        '</div>' +
        '<div class="tog ' + (cfg.enabled ? 'on' : 'off') + '" id="bt-inline-master-tog"' +
        ' onclick="event.stopPropagation();FocusBedtime.toggle()" style="flex-shrink:0">' +
          '<div class="tog-knob"></div>' +
        '</div>' +
      '</div>' +

      /* ── Always-visible body ─────────────────────────────────── */
      '<div id="bt-card-body" onclick="event.stopPropagation()" style="display:block;' +
      'border-top:1px solid var(--border);padding:16px 16px 0">' +

        /* 1. Clock slider */
        '<div style="display:flex;justify-content:center;margin-bottom:4px">' +
          '<canvas id="bt-clock-canvas" width="260" height="260"' +
          ' style="touch-action:none;cursor:grab;display:block;max-width:100%"></canvas>' +
        '</div>' +
        /* Time pills */
        '<div style="display:flex;gap:10px;margin-bottom:16px">' +
          '<div style="flex:1;text-align:center;background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:8px 6px">' +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-bottom:3px;letter-spacing:.5px">BEDTIME</div>' +
            '<div id="bt-pill-bed" style="font-size:15px;font-weight:700;color:var(--r)">' + decToStr(bedDecDisp) + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;color:var(--t3);font-size:14px">\u2192</div>' +
          '<div style="flex:1;text-align:center;background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:8px 6px">' +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-bottom:3px;letter-spacing:.5px">WAKE UP</div>' +
            '<div id="bt-pill-wake" style="font-size:15px;font-weight:700;color:var(--g)">' + decToStr(wakeDecDisp) + '</div>' +
          '</div>' +
        '</div>' +

        /* 2. Active days — rolling 7-day rolling ticks now removed; streak shown above */
        '<div style="margin-bottom:16px">' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);font-weight:600;margin-bottom:8px">Active days</div>' +
          '<div style="display:flex;gap:6px">' +
            ['S','M','T','W','T','F','S'].map(function (lbl, idx) {
              var on = cfg.activeDays.includes(idx);
              return '<div id="bt-day-' + idx + '" data-active="' + (on ? '1' : '0') + '"' +
                ' onclick="event.stopPropagation();FocusBedtime.btToggleDay(' + idx + ')"' +
                ' style="flex:1;text-align:center;padding:7px 0 5px;border-radius:8px;cursor:pointer;' +
                'font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;' +
                'border:1px solid ' + (on ? 'var(--p)' : 'var(--border2)') + ';' +
                'background:' + (on ? 'var(--p)' : 'var(--bg)') + ';' +
                'color:' + (on ? '#fff' : 'var(--t3)') + '">' + lbl + '</div>';
            }).join('') +
          '</div>' +
        '</div>' +

        /* 3. Blocked apps */
        '<div style="margin-bottom:14px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
            '<div>' +
              '<div style="font-size:12px;font-weight:700;color:var(--t1)">\uD83D\uDEAB Block during bedtime</div>' +
              '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">Shows calming screen instead</div>' +
            '</div>' +
            '<div onclick="_btInlineOpenBlockPicker()"' +
            ' style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p);cursor:pointer;white-space:nowrap;' +
            'padding:4px 10px;border-radius:8px;border:1px solid rgba(108,99,255,.25);background:rgba(108,99,255,.08)">' +
              '\uFF0B Add' +
            '</div>' +
          '</div>' +
          '<div id="bt-inline-blocked-chips" style="display:flex;flex-wrap:wrap;gap:6px">' +
            blockedChips + overflowChip +
            (!blockedApps.length
              ? '<div onclick="_btInlineOpenBlockPicker()" style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
                'border:1px dashed var(--border2);border-radius:8px;padding:5px 10px;cursor:pointer;opacity:.7">Tap to add apps\u2026</div>'
              : '') +
          '</div>' +
        '</div>' +

        /* 4. Sleep settings (collapsible) */
        '<div style="border-top:1px solid var(--border);margin:0 -16px;padding:0 16px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;cursor:pointer"' +
          ' onclick="_toggleBedtimeSettings()">' +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);font-weight:600">Sleep settings</div>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">DND \u00b7 wind-down \u00b7 morning</span>' +
              '<span id="bt-settings-chev" style="font-size:var(--text-2xs);color:var(--t3);transition:transform .2s;' +
              'transform:' + (settingsOpen ? 'rotate(180deg)' : 'rotate(0deg)') + '">\u25be</span>' +
            '</div>' +
          '</div>' +
          '<div id="bt-settings-body" style="display:' + (settingsOpen ? 'block' : 'none') + ';padding-bottom:4px">' +
            '<div style="background:var(--bg);border:1px solid var(--border2);border-radius:12px;overflow:hidden;margin-bottom:12px">' +
              /* DND row — always on, non-interactive */
              '<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border)">' +
                '<div style="font-size:16px">\uD83D\uDD15</div>' +
                '<div style="flex:1">' +
                  '<div style="font-size:12px;font-weight:600;color:var(--t1)">Do Not Disturb</div>' +
                  '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Silences notifications except alarms</div>' +
                '</div>' +
                '<div class="tog on" style="pointer-events:none;opacity:.5"><div class="tog-knob"></div></div>' +
              '</div>' +
              /* Wind-down */
              '<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--border)">' +
                '<div style="font-size:16px">\u23F0</div>' +
                '<div style="flex:1">' +
                  '<div style="font-size:12px;font-weight:600;color:var(--t1)">Wind-down reminder</div>' +
                  '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Notification 30 min before bedtime</div>' +
                '</div>' +
                '<div class="tog ' + (cfg.windDown ? 'on' : 'off') + '" id="bt-inline-tog-wind"' +
                ' onclick="event.stopPropagation();FocusBedtime.btInlineToggle(\'bt-inline-tog-wind\')">' +
                  '<div class="tog-knob"></div>' +
                '</div>' +
              '</div>' +
              /* Morning summary */
              '<div style="display:flex;align-items:center;gap:12px;padding:11px 14px">' +
                '<div style="font-size:16px">\u2600\uFE0F</div>' +
                '<div style="flex:1">' +
                  '<div style="font-size:12px;font-weight:600;color:var(--t1)">Morning summary</div>' +
                  '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Sleep duration + streak at wake-up</div>' +
                '</div>' +
                '<div class="tog ' + ((cfg.morningSummary != null ? cfg.morningSummary : true) ? 'on' : 'off') + '" id="bt-inline-tog-morning"' +
                ' onclick="event.stopPropagation();FocusBedtime.btInlineToggle(\'bt-inline-tog-morning\')">' +
                  '<div class="tog-knob"></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* 5. Save + Disable */
        '<div style="padding:12px 0 16px">' +
          '<button id="bt-save-btn" onclick="FocusBedtime.save()"' +
          ' style="display:' + (window._btDirty ? '' : 'none') + ';width:100%;padding:12px;border-radius:12px;border:none;' +
          'background:linear-gradient(135deg,var(--p),var(--c));' +
          'color:#fff;font-family:var(--ff-m);font-size:13px;font-weight:700;cursor:pointer;margin-bottom:8px">' +
            'Save Changes' +
          '</button>' +
          (cfg.enabled
            ? '<button type="button" onclick="FocusBedtime.disable()"' +
              ' style="width:100%;padding:10px;border-radius:12px;border:1px solid var(--border2);' +
              'background:transparent;color:var(--t3);font-family:var(--ff-m);font-size:12px;cursor:pointer">' +
              'Turn Off Bedtime Mode</button>'
            : '') +
        '</div>' +
      '</div>';

    // Boot canvas clock after render
    setTimeout(_btInitClock, 20);
  }

  /* ── Backward-compat global shims ─────────────────────────────── */
  // NOTE: these MUST be window assignments (not named function declarations).
  // Named function declarations inside the same IIFE scope are fully hoisted
  // and the last declaration wins — which would override the real implementations
  // above with these forwarding shims, causing infinite recursion on every call.
  window._toggleBedtime          = function() { FocusBedtime.toggle(); };
  window._toggleBedtimeSettings  = function() { FocusBedtime.toggleSettings(); };
  window._saveBedtimeInline       = function() { FocusBedtime.save(); };
  window.snoozeBedtimePrompt      = snoozeBedtimePrompt;
  // These two are called by inline onclick strings inside the nudge popup but
  // were never exported — causing ReferenceError on both buttons.
  window._doDisableBedtime        = _doDisableBedtime;
  window._bedtimeSnooze           = _bedtimeSnooze;

  /* ── Public API ──────────────────────────────────────────────── */
  return {
    render,
    toggle:          _toggleBedtime,
    toggleSettings:  _toggleBedtimeSettings,
    save:            _saveBedtimeInline,
    disable:         _disableBedtime,
    getCfg:          _getBedtimeCfg,
    btInlineToggle:  _btInlineToggle,
    btToggleDay:     _btToggleDay,
    refreshChips:    _btRefreshInlineChips,
    snooze:          snoozeBedtimePrompt,
    /**
     * Called by saveFocusPick() and the window._btOnBlockPickerSave shim in
     * app-settings.js after the user confirms their bedtime blocked-app selection.
     * Updates internal _btBlockedApps and refreshes chips in-place.
     * Exposed so external modules don't need to reach into IIFE state.
     */
    onBlockPickerSave: function (apps) {
      _btBlockedApps = Array.isArray(apps) ? apps : [];
      _btRefreshInlineChips();
      // Ensure card body is visible so updated chips are seen immediately
      var body = document.getElementById('bt-card-body');
      if (body) body.style.display = 'block';
    },
  };
})();