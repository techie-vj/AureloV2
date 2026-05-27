/* ═══════════════════════════════════════════════════════════════════════════
 * app-quiet-hours.js — Quiet Hours settings UI (Free feature)
 *
 * Minimal scheduled DND: time window + day picker. No app blocking, no filter,
 * no morning summary. Distinct from Bedtime Mode (which bundles wind-down /
 * filter / streak / summary specifically for sleep).
 *
 * Lives under Settings → Usage Controls → Quiet Hours. Routes to its own
 * full-screen panel; no inline picker so it doesn't compete with Bedtime's
 * Focus-tab card for screen real estate.
 * ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Default values used when nothing is saved yet — Mon-Fri 9am-5pm matches
  // the dominant use case from competitor app reviews (silence during work).
  var DEFAULT_CFG = {
    enabled: false,
    startHour: 9,
    startMin:  0,
    endHour:   17,
    endMin:    0,
    days: [false, true, true, true, true, true, false]   // Sun..Sat
  };

  var DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // ── State ──────────────────────────────────────────────────────────────────
  // _qhState is the working copy while the panel is open. It is committed to
  // native via saveQuietHoursSettings on every change (no separate Save button)
  // so the user's mental model matches Bedtime / Screen Filter editors.
  var _qhState = null;

  // ── Native bridge helpers ─────────────────────────────────────────────────

  function _getCfg() {
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
        typeof N !== 'undefined' && typeof N.getQuietHoursSettings === 'function') {
      try {
        var raw = N.getQuietHoursSettings();
        if (raw && raw !== '{}') {
          var parsed = JSON.parse(raw);
          // Merge against defaults so missing fields (e.g. on first save) fall
          // back gracefully rather than rendering as undefined.
          return Object.assign({}, DEFAULT_CFG, parsed);
        }
      } catch (_) {}
    }
    return Object.assign({}, DEFAULT_CFG);
  }

  function _saveCfg(cfg) {
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
        typeof N !== 'undefined' && typeof N.saveQuietHoursSettings === 'function') {
      try { N.saveQuietHoursSettings(JSON.stringify(cfg)); } catch (_) {}
    }
  }

  function _getState() {
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
        typeof N !== 'undefined' && typeof N.getQuietHoursState === 'function') {
      try { return JSON.parse(N.getQuietHoursState() || '{}'); } catch (_) {}
    }
    // Browser fallback so the demo UI is functional.
    return { enabled: !!(_qhState && _qhState.enabled), active: false,
             hasDndPermission: true, pausedUntilMs: 0, endsAtMs: 0 };
  }

  // ── Time formatting ────────────────────────────────────────────────────────

  function _fmt(h, m) {
    m = m || 0;
    var h12 = h % 12 === 0 ? 12 : h % 12;
    var ampm = h < 12 ? 'AM' : 'PM';
    return h12 + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  function _fmtMs(ms) {
    if (!ms || ms <= 0) return '';
    var d = new Date(ms);
    return _fmt(d.getHours(), d.getMinutes());
  }

  // ── Settings row subtitle (called by app-settings.applySettings) ──────────

  function updateQuietHoursSub() {
    var sub = document.getElementById('quiet-hours-sub');
    if (!sub) return;
    var cfg   = _getCfg();
    var state = _getState();
    if (!cfg.enabled) { sub.textContent = 'Disabled'; return; }
    if (state.active) {
      sub.textContent = 'Active · ends ' + _fmtMs(state.endsAtMs);
      return;
    }
    if (state.pausedUntilMs > 0) {
      sub.textContent = 'Paused · resumes ' + _fmtMs(state.pausedUntilMs);
      return;
    }
    sub.textContent = _fmt(cfg.startHour, cfg.startMin) + ' → ' +
                      _fmt(cfg.endHour,   cfg.endMin);
  }

  // ── Panel open / close ────────────────────────────────────────────────────

  function openQuietHoursPanel() {
    // Permission gate — DND access is required for the feature to do anything
    // useful. If missing, route the user to the system settings screen via
    // the existing bedtime helper rather than silently failing.
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE && typeof N !== 'undefined' &&
        typeof N.isDndPolicyGranted === 'function' && !N.isDndPolicyGranted()) {
      if (typeof toast === 'function') {
        toast('Enable DND access to use Quiet Hours', 'info', 3500);
      }
      if (typeof N.openDndSettings === 'function') { try { N.openDndSettings(); } catch (_) {} }
      return;
    }
    _qhState = _getCfg();
    var panel = document.getElementById('quiet-hours-panel');
    if (!panel) return;
    panel.classList.add('open');
    _renderPanel();
  }

  function closeQuietHoursPanel() {
    var panel = document.getElementById('quiet-hours-panel');
    if (panel) panel.classList.remove('open');
    if (typeof updateQuietHoursSub === 'function') updateQuietHoursSub();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Returns a human-readable summary of the selected days array.
  function _daysSummary(days) {
    var on = days.reduce(function (acc, v, i) { if (v) acc.push(i); return acc; }, []);
    if (on.length === 0) return 'No days';
    if (on.length === 7) return 'Every day';
    var weekdays = [1,2,3,4,5];
    var weekend  = [0,6];
    if (weekdays.every(function (i) { return days[i]; }) && !days[0] && !days[6]) return 'Weekdays';
    if (weekend.every(function (i) { return days[i]; }) && on.length === 2) return 'Weekends';
    var FULL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return on.map(function (i) { return FULL[i]; }).join(', ');
  }

  // Returns true when end time is earlier than start (overnight window)
  function _isOvernight(sh, sm, eh, em) {
    return (sh * 60 + sm) >= (eh * 60 + em);
  }

  function _renderPanel() {
    var body = document.getElementById('quiet-hours-body');
    if (!body || !_qhState) return;
    var state   = _getState();
    var enabled = !!_qhState.enabled;
    var dim     = enabled ? '' : 'opacity:.42;pointer-events:none;';

    // ── Update panel header subtitle ──────────────────────────────
    var sub = document.getElementById('qh-panel-subtitle');
    if (sub) {
      sub.textContent = !enabled ? 'Tap to enable' :
        state.active ? 'Active now' :
        state.pausedUntilMs > 0 ? 'Paused' :
        _daysSummary(_qhState.days);
    }

    // ── Status banner (active / paused) ─────────────────────────
    var statusBlock = '';
    if (enabled && state.active) {
      statusBlock =
        '<div style="background:rgba(108,99,255,.10);border:1px solid rgba(108,99,255,.28);' +
        'border-radius:16px;padding:14px 16px;margin-bottom:16px">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
            '<div style="width:28px;height:28px;border-radius:8px;background:rgba(108,99,255,.20);' +
                 'display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--p2,#a79fff)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><line x1="1" y1="1" x2="23" y2="23"/></svg>' +
            '</div>' +
            '<div style="flex:1">' +
              '<div style="font-family:var(--ff-m);font-size:13px;font-weight:700;color:var(--t1);line-height:1.2">Active now</div>' +
              '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:1px">Ends ' + _fmtMs(state.endsAtMs) + ' · Starred contacts can still call</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px">' +
            '<button onclick="QuietHours.endNow()" ' +
              'style="flex:1;padding:10px;border-radius:10px;border:1px solid var(--border2);background:var(--s1);' +
              'color:var(--t1);font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer">' +
              '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:5px;vertical-align:-1px"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>' +
              'End now' +
            '</button>' +
            '<button onclick="QuietHours.pause30()" ' +
              'style="flex:1;padding:10px;border-radius:10px;border:1px solid var(--border2);background:var(--s1);' +
              'color:var(--t1);font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer">' +
              '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:5px;vertical-align:-1px"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' +
              'Pause 30 min' +
            '</button>' +
          '</div>' +
        '</div>';
    } else if (enabled && state.pausedUntilMs > 0) {
      statusBlock =
        '<div style="background:rgba(247,166,35,.09);border:1px solid rgba(247,166,35,.28);' +
        'border-radius:16px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">' +
          '<div style="width:28px;height:28px;border-radius:8px;background:rgba(247,166,35,.18);' +
               'display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f7a623" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' +
          '</div>' +
          '<div>' +
            '<div style="font-family:var(--ff-m);font-size:13px;font-weight:700;color:var(--t1);line-height:1.2">Paused</div>' +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:1px">Resumes ' + _fmtMs(state.pausedUntilMs) + '</div>' +
          '</div>' +
        '</div>';
    }

    // ── Enable row ───────────────────────────────────────────────
    var enabledRow =
      '<div class="sr" onclick="QuietHours.toggle()" ' +
          'style="border-bottom:1px solid var(--border2);border-radius:0">' +
        '<div class="sr-ico sr-ico--moon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>' +
        '<div style="flex:1">' +
          '<div class="sr-lbl">Enable Quiet Hours</div>' +
          '<div class="sr-sub" id="qh-enable-sub">' +
            (enabled ? 'Schedules DND on selected days' : 'Off') +
          '</div>' +
        '</div>' +
        '<div class="tog ' + (enabled ? 'on' : 'off') + '" id="qh-tog-enabled">' +
          '<div class="tog-knob"></div>' +
        '</div>' +
      '</div>';

    // ── Preset chips ─────────────────────────────────────────────
    var PRESETS = [
      { label: 'Work',    sh: 9,  sm: 0, eh: 17, em: 0, days: [false,true,true,true,true,true,false] },
      { label: 'Evening', sh: 19, sm: 0, eh: 22, em: 0, days: [true,true,true,true,true,true,true] },
      { label: 'Night',   sh: 22, sm: 0, eh: 7,  em: 0, days: [true,true,true,true,true,true,true] },
      { label: 'Focus',   sh: 8,  sm: 0, eh: 12, em: 0, days: [false,true,true,true,true,true,false] }
    ];
    function _presetActive(p) {
      return _qhState.startHour === p.sh && _qhState.startMin === p.sm &&
             _qhState.endHour   === p.eh && _qhState.endMin   === p.em &&
             p.days.every(function (v, i) { return !!_qhState.days[i] === v; });
    }
    var presetChips = PRESETS.map(function (p, idx) {
      var isOn = _presetActive(p);
      return '<button onclick="QuietHours.applyPreset(' + idx + ')" ' +
        'style="padding:7px 13px;border-radius:99px;cursor:pointer;white-space:nowrap;transition:all .15s;' +
        'font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;' +
        (isOn
          ? 'background:var(--p);border:1px solid var(--p);color:#fff;'
          : 'background:var(--s1);border:1px solid var(--border2);color:var(--t2);') +
        '">' + p.label + '</button>';
    }).join('');
    var presetsRow =
      '<div style="padding:14px 0;' + dim + '">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
             'letter-spacing:1.1px;text-transform:uppercase;margin-bottom:9px">Quick Presets</div>' +
        '<div style="display:flex;gap:7px;flex-wrap:wrap">' + presetChips + '</div>' +
      '</div>';

    // ── Time window ──────────────────────────────────────────────
    var overnight   = _isOvernight(_qhState.startHour, _qhState.startMin, _qhState.endHour, _qhState.endMin);
    var overnightBadge = overnight
      ? '<div style="display:inline-flex;align-items:center;gap:4px;margin-top:7px;' +
             'padding:3px 8px;border-radius:6px;background:rgba(108,99,255,.12);' +
             'border:1px solid rgba(108,99,255,.22)">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--p2,#a79fff)" stroke-width="2.5" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>' +
          '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p2,#a79fff);font-weight:600">Overnight window</span>' +
        '</div>'
      : '';
    var timesRow =
      '<div style="padding:16px 0;border-top:1px solid var(--border2);' + dim + '">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
             'letter-spacing:1.1px;text-transform:uppercase;margin-bottom:10px">Window</div>' +
        '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center">' +
          '<button onclick="QuietHours.editStart()" ' +
            'style="padding:13px 14px;border-radius:13px;border:1px solid var(--border2);background:var(--s1);' +
            'color:var(--t1);font-family:var(--ff-m);cursor:pointer;text-align:left;transition:border-color .15s">' +
            '<div style="font-size:var(--text-2xs);color:var(--t3);font-weight:600;margin-bottom:3px">FROM</div>' +
            '<div style="font-size:17px;font-weight:700;letter-spacing:-.3px">' + _fmt(_qhState.startHour, _qhState.startMin) + '</div>' +
          '</button>' +
          '<div style="display:flex;flex-direction:column;align-items:center;gap:3px">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
          '</div>' +
          '<button onclick="QuietHours.editEnd()" ' +
            'style="padding:13px 14px;border-radius:13px;border:1px solid var(--border2);background:var(--s1);' +
            'color:var(--t1);font-family:var(--ff-m);cursor:pointer;text-align:left;transition:border-color .15s">' +
            '<div style="font-size:var(--text-2xs);color:var(--t3);font-weight:600;margin-bottom:3px">TO</div>' +
            '<div style="font-size:17px;font-weight:700;letter-spacing:-.3px">' + _fmt(_qhState.endHour, _qhState.endMin) + '</div>' +
          '</button>' +
        '</div>' +
        overnightBadge +
      '</div>';

    // ── Days ─────────────────────────────────────────────────────
    var DAY_FULL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var dayPills = '';
    for (var i = 0; i < 7; i++) {
      var on = !!_qhState.days[i];
      dayPills +=
        '<button onclick="QuietHours.toggleDay(' + i + ')" ' +
          'title="' + DAY_FULL[i] + '" ' +
          'style="flex:1;padding:9px 0;border-radius:10px;cursor:pointer;transition:all .15s;' +
          'font-family:var(--ff-m);font-size:12px;font-weight:700;' +
          (on
            ? 'background:var(--p);border:1px solid var(--p);color:#fff;'
            : 'background:var(--s1);border:1px solid var(--border2);color:var(--t3);') +
          '">' + DAY_LABELS[i] + '</button>';
    }
    var daysRow =
      '<div style="padding:0 0 16px;border-bottom:1px solid var(--border2);' + dim + '">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
               'letter-spacing:1.1px;text-transform:uppercase">Days</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p2,var(--p));font-weight:600">' +
            _daysSummary(_qhState.days) +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:5px">' + dayPills + '</div>' +
      '</div>';

    // ── Info block ───────────────────────────────────────────────
    var helpBlock =
      '<div style="margin-top:16px;background:var(--s1);border:1px solid var(--border2);' +
           'border-radius:14px;padding:13px 14px">' +
        '<div style="display:flex;align-items:flex-start;gap:10px">' +
          '<div style="width:26px;height:26px;border-radius:7px;background:rgba(108,99,255,.12);' +
               'display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--p2,#a79fff)" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);line-height:1.65">' +
            'Silences notifications using Do Not Disturb. ' +
            'Starred contacts &amp; repeat callers still ring through.<br>' +
            '<span style="color:var(--t2);font-weight:600">For sleep wind-down</span> use ' +
            '<span style="color:var(--p);cursor:pointer;font-weight:600" onclick="QuietHours._openBedtime()">Bedtime Mode</span> ' +
            'instead — it adds screen filter &amp; a morning summary.' +
          '</div>' +
        '</div>' +
      '</div>';

    body.innerHTML = statusBlock + enabledRow + presetsRow + timesRow + daysRow + helpBlock;
  }

  // ── Mutators ──────────────────────────────────────────────────────────────

  function _commit() {
    if (!_qhState) return;
    _saveCfg(_qhState);
    _renderPanel();
    if (typeof updateQuietHoursSub === 'function') updateQuietHoursSub();
  }

  function applyPreset(idx) {
    var PRESETS = [
      { sh: 9,  sm: 0, eh: 17, em: 0, days: [false,true,true,true,true,true,false] },
      { sh: 19, sm: 0, eh: 22, em: 0, days: [true,true,true,true,true,true,true] },
      { sh: 22, sm: 0, eh: 7,  em: 0, days: [true,true,true,true,true,true,true] },
      { sh: 8,  sm: 0, eh: 12, em: 0, days: [false,true,true,true,true,true,false] }
    ];
    var p = PRESETS[idx];
    if (!p || !_qhState) return;
    _qhState.startHour = p.sh; _qhState.startMin = p.sm;
    _qhState.endHour   = p.eh; _qhState.endMin   = p.em;
    _qhState.days      = p.days.slice();
    _commit();
  }

  function toggleEnabled() {
    if (!_qhState) return;
    _qhState.enabled = !_qhState.enabled;
    _commit();
  }

  function toggleDay(idx) {
    if (!_qhState || idx < 0 || idx > 6) return;
    _qhState.days = _qhState.days.slice();
    _qhState.days[idx] = !_qhState.days[idx];
    // Don't allow zero days — degenerate config (alarm would fire daily but
    // every fire would early-out). Re-enable the day the user just tapped off.
    if (!_qhState.days.some(function (d) { return d; })) _qhState.days[idx] = true;
    _commit();
  }

  function _editTime(label, hour, minute, onPick) {
    // Bottom-sheet grid time picker — identical pattern to Screen Filter's
    // _openTimePicker(). Reuses .sf-backdrop / .sf-perm-sheet / .sf-tp-sheet /
    // .sf-drag / .sf-tp-cell CSS already loaded via screen-filter.css.
    // The hidden <input type="time"> approach is unreliable in Android WebViews.
    var bd = document.createElement('div');
    bd.className = 'sf-backdrop';
    var sh = document.createElement('div');
    sh.className = 'sf-perm-sheet sf-tp-sheet';

    var state = {
      h: hour % 12 === 0 ? 12 : hour % 12,
      m: Math.min(55, Math.round(minute / 5) * 5),
      p: hour >= 12 ? 'PM' : 'AM'
    };

    var hourCells = '', minCells = '';
    for (var h = 1; h <= 12; h++) {
      hourCells += '<div class="sf-tp-cell" id="qhph-' + h + '" onclick="window._qhPickerSetH(' + h + ')">' + h + '</div>';
    }
    for (var m = 0; m < 60; m += 5) {
      minCells += '<div class="sf-tp-cell" id="qhpm-' + m + '" onclick="window._qhPickerSetM(' + m + ')">:' + (m < 10 ? '0' + m : m) + '</div>';
    }

    sh.innerHTML =
      '<div class="sf-drag"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:0 2px 10px">' +
        '<div style="font-family:var(--ff-d);font-size:var(--text-sm);font-weight:700;color:var(--t1)">' + label + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="display:flex;background:var(--s2,rgba(255,255,255,.06));border-radius:10px;' +
               'border:1px solid var(--border2,rgba(255,255,255,.1));overflow:hidden">' +
            '<div id="qh-tp-am" onclick="window._qhPickerSetP(\'AM\')" ' +
              'style="padding:6px 14px;font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;cursor:pointer;transition:all .12s">AM</div>' +
            '<div id="qh-tp-pm" onclick="window._qhPickerSetP(\'PM\')" ' +
              'style="padding:6px 14px;font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;cursor:pointer;transition:all .12s">PM</div>' +
          '</div>' +
          '<div onclick="window._qhPickerDone()" ' +
            'style="font-family:var(--ff-m);font-size:var(--text-xs);font-weight:700;color:var(--p);cursor:pointer;padding:4px 0 4px 4px">Done</div>' +
        '</div>' +
      '</div>' +
      '<div id="qh-tp-display" style="text-align:center;font-family:var(--ff-d);font-size:var(--text-3xl);' +
        'font-weight:700;color:var(--t1);letter-spacing:-1.5px;padding:2px 16px 12px;line-height:1.1"></div>' +
      '<div style="padding:0 0 8px">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.8px;margin-bottom:6px">HOUR</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">' + hourCells + '</div>' +
      '</div>' +
      '<div style="padding:8px 0 16px">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.8px;margin-bottom:6px">MINUTE</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">' + minCells + '</div>' +
      '</div>';

    document.body.appendChild(bd);
    document.body.appendChild(sh);

    function _refresh() {
      for (var i = 1; i <= 12; i++) {
        var el = document.getElementById('qhph-' + i);
        if (el) el.classList.toggle('sf-tp-cell--on', i === state.h);
      }
      for (var j = 0; j < 60; j += 5) {
        var el2 = document.getElementById('qhpm-' + j);
        if (el2) el2.classList.toggle('sf-tp-cell--on', j === state.m);
      }
      var amEl = document.getElementById('qh-tp-am');
      var pmEl = document.getElementById('qh-tp-pm');
      if (amEl) { amEl.style.background = state.p === 'AM' ? 'var(--p)' : 'transparent'; amEl.style.color = state.p === 'AM' ? '#fff' : 'var(--t3)'; }
      if (pmEl) { pmEl.style.background = state.p === 'PM' ? 'var(--p)' : 'transparent'; pmEl.style.color = state.p === 'PM' ? '#fff' : 'var(--t3)'; }
      var disp = document.getElementById('qh-tp-display');
      if (disp) disp.textContent = String(state.h).padStart(2, '0') + ':' + String(state.m).padStart(2, '0') + ' ' + state.p;
    }

    function _dismiss() {
      if (bd.parentNode) bd.parentNode.removeChild(bd);
      if (sh.parentNode) sh.parentNode.removeChild(sh);
      delete window._qhPickerSetH;
      delete window._qhPickerSetM;
      delete window._qhPickerSetP;
      delete window._qhPickerDone;
    }

    window._qhPickerSetH = function (h) { state.h = h; _refresh(); };
    window._qhPickerSetM = function (m) { state.m = m; _refresh(); };
    window._qhPickerSetP = function (p) { state.p = p; _refresh(); };
    window._qhPickerDone = function () {
      var h24 = state.p === 'AM'
        ? (state.h === 12 ? 0 : state.h)
        : (state.h === 12 ? 12 : state.h + 12);
      _dismiss();
      onPick(h24, state.m);
    };

    bd.onclick = _dismiss;
    _refresh();
  }

  function editStart() {
    if (!_qhState) return;
    _editTime('From', _qhState.startHour, _qhState.startMin, function (h, m) {
      _qhState.startHour = h; _qhState.startMin = m;
      // Don't enforce start < end here — overnight windows (e.g. 22:00 → 06:00)
      // are valid and the receiver handles wraparound correctly.
      _commit();
    });
  }

  function editEnd() {
    if (!_qhState) return;
    _editTime('To', _qhState.endHour, _qhState.endMin, function (h, m) {
      _qhState.endHour = h; _qhState.endMin = m;
      _commit();
    });
  }

  function endNow() {
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE && typeof N !== 'undefined' &&
        typeof N.endQuietHoursNow === 'function') {
      try { N.endQuietHoursNow(); } catch (_) {}
    }
    setTimeout(function () { _renderPanel(); updateQuietHoursSub(); }, 120);
  }

  function pause30() {
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE && typeof N !== 'undefined' &&
        typeof N.pauseQuietHours === 'function') {
      try { N.pauseQuietHours(30); } catch (_) {}
    }
    setTimeout(function () { _renderPanel(); updateQuietHoursSub(); }, 120);
  }

  function _openBedtime() {
    closeQuietHoursPanel();
    if (typeof openBedtimePicker === 'function') openBedtimePicker();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.QuietHours = {
    open:        openQuietHoursPanel,
    close:       closeQuietHoursPanel,
    toggle:      toggleEnabled,
    toggleDay:   toggleDay,
    applyPreset: applyPreset,
    editStart:   editStart,
    editEnd:     editEnd,
    endNow:      endNow,
    pause30:     pause30,
    updateSub:   updateQuietHoursSub,
    _openBedtime: _openBedtime
  };

  // Expose top-level for the Settings row onclick handler — keeps the
  // template HTML simple (matches openBedtimePicker pattern).
  window.openQuietHoursPanel = openQuietHoursPanel;
  window.closeQuietHoursPanel = closeQuietHoursPanel;
  window.updateQuietHoursSub  = updateQuietHoursSub;
})();
