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

  function _renderPanel() {
    var body = document.getElementById('quiet-hours-body');
    if (!body || !_qhState) return;
    var state = _getState();

    var statusBlock = '';
    if (_qhState.enabled && state.active) {
      statusBlock =
        '<div style="background:rgba(108,99,255,.10);border:1px solid rgba(108,99,255,.30);' +
        'border-radius:14px;padding:14px;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-m);font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px">' +
            '🔕 Active until ' + _fmtMs(state.endsAtMs) +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);line-height:1.5;margin-bottom:10px">' +
            'Notifications are silenced. Starred contacts and repeat callers still ring through.' +
          '</div>' +
          '<div style="display:flex;gap:8px">' +
            '<button onclick="QuietHours.endNow()" style="flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--border2);background:var(--s1);color:var(--t1);font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer">End now</button>' +
            '<button onclick="QuietHours.pause30()" style="flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--border2);background:var(--s1);color:var(--t1);font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer">Pause 30m</button>' +
          '</div>' +
        '</div>';
    } else if (_qhState.enabled && state.pausedUntilMs > 0) {
      statusBlock =
        '<div style="background:rgba(247,166,35,.10);border:1px solid rgba(247,166,35,.30);' +
        'border-radius:14px;padding:14px;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-m);font-size:13px;font-weight:700;color:var(--t1);margin-bottom:4px">' +
            '⏸ Paused' +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);line-height:1.5">' +
            'Resumes ' + _fmtMs(state.pausedUntilMs) +
          '</div>' +
        '</div>';
    }

    var enabledRow =
      '<div class="sr" onclick="QuietHours.toggle()" style="border-bottom:1px solid var(--border2)">' +
        '<div class="sr-ico" style="background:rgba(108,99,255,.15);width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px">🔕</div>' +
        '<div style="flex:1">' +
          '<div class="sr-lbl">Enable Quiet Hours</div>' +
          '<div class="sr-sub">' +
            (_qhState.enabled ? 'On — schedules DND on selected days' : 'Off')  +
          '</div>' +
        '</div>' +
        '<div class="tog ' + (_qhState.enabled ? 'on' : '') + '" id="qh-tog-enabled">' +
          '<div class="tog-knob"></div>' +
        '</div>' +
      '</div>';

    var timesRow =
      '<div style="padding:14px 4px;border-bottom:1px solid var(--border2);' +
      (_qhState.enabled ? '' : 'opacity:.45;pointer-events:none;') + '">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px">Window</div>' +
        '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between">' +
          '<button onclick="QuietHours.editStart()" style="flex:1;padding:14px;border-radius:12px;border:1px solid var(--border2);background:var(--s1);color:var(--t1);font-family:var(--ff-m);font-size:14px;font-weight:700;cursor:pointer;text-align:left">' +
            '<div style="font-size:var(--text-2xs);color:var(--t3);margin-bottom:2px">From</div>' +
            _fmt(_qhState.startHour, _qhState.startMin) +
          '</button>' +
          '<div style="color:var(--t3);font-size:18px">→</div>' +
          '<button onclick="QuietHours.editEnd()" style="flex:1;padding:14px;border-radius:12px;border:1px solid var(--border2);background:var(--s1);color:var(--t1);font-family:var(--ff-m);font-size:14px;font-weight:700;cursor:pointer;text-align:left">' +
            '<div style="font-size:var(--text-2xs);color:var(--t3);margin-bottom:2px">To</div>' +
            _fmt(_qhState.endHour, _qhState.endMin) +
          '</button>' +
        '</div>' +
      '</div>';

    var dayPills = '';
    for (var i = 0; i < 7; i++) {
      var on = !!_qhState.days[i];
      dayPills +=
        '<button onclick="QuietHours.toggleDay(' + i + ')" ' +
          'style="flex:1;padding:10px 0;border-radius:99px;cursor:pointer;' +
          'font-family:var(--ff-m);font-size:13px;font-weight:700;' +
          (on
            ? 'background:var(--p);border:1px solid var(--p);color:#fff;'
            : 'background:transparent;border:1px solid var(--border2);color:var(--t3);') +
          '">' + DAY_LABELS[i] + '</button>';
    }
    var daysRow =
      '<div style="padding:14px 4px;border-bottom:1px solid var(--border2);' +
      (_qhState.enabled ? '' : 'opacity:.45;pointer-events:none;') + '">' +
        '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px">Days</div>' +
        '<div style="display:flex;gap:6px">' + dayPills + '</div>' +
      '</div>';

    var helpBlock =
      '<div style="padding:16px 4px 4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);line-height:1.6">' +
        '<strong style="color:var(--t2)">What this does:</strong> ' +
        'Silences notifications during the selected window using your phone\'s Do Not Disturb. ' +
        'Starred contacts and repeat callers can still reach you.<br><br>' +
        '<strong style="color:var(--t2)">For sleep,</strong> use ' +
        '<span style="color:var(--p);cursor:pointer;text-decoration:underline" onclick="QuietHours._openBedtime()">Bedtime Mode</span> ' +
        'instead — it adds wind-down, screen filter, and a morning summary.' +
      '</div>';

    body.innerHTML = statusBlock + enabledRow + timesRow + daysRow + helpBlock;
  }

  // ── Mutators ──────────────────────────────────────────────────────────────

  function _commit() {
    if (!_qhState) return;
    _saveCfg(_qhState);
    _renderPanel();
    if (typeof updateQuietHoursSub === 'function') updateQuietHoursSub();
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
    // Reuse the simple HTML time input — opens the native time picker on
    // Android via WebView. Avoids re-implementing a wheel picker for a feature
    // the user touches at most a few times.
    var input = document.createElement('input');
    input.type = 'time';
    input.value = (hour < 10 ? '0' + hour : hour) + ':' + (minute < 10 ? '0' + minute : minute);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var parts = (input.value || '').split(':');
      if (parts.length === 2) {
        var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
        if (!isNaN(h) && !isNaN(m)) onPick(h, m);
      }
      document.body.removeChild(input);
    });
    // Some Android WebViews fire 'blur' without 'change' if the user cancels;
    // remove the orphan input after a short delay to avoid leaks.
    setTimeout(function () {
      if (input.parentNode) input.parentNode.removeChild(input);
    }, 30000);
    try { input.showPicker ? input.showPicker() : input.click(); }
    catch (_) { input.click(); }
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
