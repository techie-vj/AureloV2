'use strict';
/* ═══════════════════════════════════════════════════════════════
 * FOCUS TAB SHELL — app-focus.js  (Phase 2 reduced shell)
 *
 * This file owns ONLY:
 *   • Module-level state variables (session, picker, streaks)
 *   • Focus session lifecycle (start / stop / orbit / countdown)
 *   • App-picker state (delegating UI to FocusPicker)
 *   • Blocked-app chip management
 *   • Tab init / refresh / sub-tab switch
 *   • Thin delegators to: FocusHome, FocusScore, FocusRoutine,
 *     FocusTimers, FocusMindful, FocusChallenge, FocusBedtime
 *
 * Load order:
 *   app-focus-score.js → app-focus-timers.js → app-focus-mindful.js
 *   → app-focus-bedtime.js → app-focus-challenge.js
 *   → app-focus-routine.js → app-focus-picker.js
 *   → app-focus-home.js → app-focus.js
 * ═══════════════════════════════════════════════════════════════ */
window.FocusTab = (function () {

  /* ═══════════════════════════════════════════════════════════════
   * STATE
   * ═══════════════════════════════════════════════════════════════ */
  var _focusLoaded          = false;
  var _focusDirty           = false;
  var _focusSessionActive   = false;
  var _focusSessionSecs     = 0;
  var _focusSessionTimer    = null;
  var _focusDifficulty      = 'gentle';    // 'gentle' | 'firm' | 'deep'
  var _focusBlockedApps     = [];
  var _selectedFocusDur     = 25;
  var _firmCountdown        = null;
  var _firmCountdownSecs    = 30;
  var _focusSessionTotalSecs= 0;
  var _focusCustomDur       = false;
  var _focusPickerMode      = 'block';     // 'block' | 'intention' | 'bedtime' | 'routine'
  var _focusPickerSelected  = new Set();
  var _pickerReturnTarget   = null;
  var _activeRoutineId      = '';

  var _focusLastState       = null;   // 'completed' | 'interrupted' | null
  var _focusLastStateTs     = 0;
  var _focusLastElapsedMins = 0;
  var _focusLastTotalMins   = 0;

  // BUG-5 fix: declared here so home-strip renders before tab is visited
  var _timerIgnoreCache     = {};

  /* Streak celebration state */
  var _prevFocusStreak       = 0;
  var _prevSleepStreak       = 0;
  var _focusStreakCelebUntil = 0;
  var _sleepStreakCelebUntil = 0;

  var _focusActiveSubTab    = 'focus';   // 'focus' | 'habits'

  /* ── Difficulty config ───────────────────────────────────── */
  var FOCUS_DIFF = {
    gentle: { label: 'Gentle',     color: '#12D48A', emoji: '🌿', desc: 'A gentle nudge when you open a blocked app. You can still continue if needed.' },
    firm:   { label: 'Firm',       color: '#F7A623', emoji: '🔥', desc: 'A 30-second wait before you can dismiss the block screen.' },
    deep:   { label: 'Deep Focus', color: '#F04E7A', emoji: '🔒', desc: 'Full block for the session duration — no way past until it ends.' },
  };

  /* ═══════════════════════════════════════════════════════════════
   * HOME STRIP DELEGATORS
   * ═══════════════════════════════════════════════════════════════ */
  function renderFocusStrip()  { if (typeof FocusHome !== 'undefined') FocusHome.renderFocusStrip(); }
  function renderLimitsStrip() {}
  function renderFocusScore()  {}

  function checkStreakIncrements()      { if (typeof FocusHome !== 'undefined') FocusHome.checkStreakIncrements(); }
  function renderHomeFocusDynamicRow()  { if (typeof FocusHome !== 'undefined') FocusHome.renderHomeFocusDynamicRow(); }
  function renderHomeHabitsDynamicRow() { if (typeof FocusHome !== 'undefined') FocusHome.renderHomeHabitsDynamicRow(); }
  function dismissMorningSummary()      { if (typeof FocusHome !== 'undefined') FocusHome.dismissMorningSummary(); }

  function renderFocusStaticRow()  { if (typeof FocusScore !== 'undefined') FocusScore.renderFocusStaticRow(); }
  function renderHabitsStaticRow() { if (typeof FocusScore !== 'undefined') FocusScore.renderHabitsStaticRow(); }
  function renderFocusDynamicRow() { if (typeof FocusScore !== 'undefined') FocusScore.renderFocusDynamicRow(); }
  function renderHabitsDynamicRow(){ if (typeof FocusScore !== 'undefined') FocusScore.renderHabitsDynamicRow(); }

  /* ═══════════════════════════════════════════════════════════════
   * STRIP / SCORE DATA DELEGATORS
   * ═══════════════════════════════════════════════════════════════ */
  function _loadStripData()        { return typeof FocusHome  !== 'undefined' ? FocusHome.loadStripData()       : {}; }
  function _invalidateStripCache() { if    (typeof FocusHome  !== 'undefined')  FocusHome.invalidateStripCache(); }
  function _getFocusStreak()       { return typeof FocusScore !== 'undefined' ? FocusScore.getFocusStreak()     : { count: 0 }; }
  function _maybeEarnFocusStreak(d){ if    (typeof FocusScore !== 'undefined')  FocusScore.maybeEarnFocusStreak(d); }

  /* ─── Shared helpers used by session UI ─────────────────────── */
  function _fmtStripTimer(secsLeft) {
    return typeof FocusHome !== 'undefined'
      ? FocusHome.fmtStripTimer(secsLeft)
      : (secsLeft < 3600
          ? (Math.floor(secsLeft/60)<10?'0':'')+Math.floor(secsLeft/60)+':'+(secsLeft%60<10?'0':'')+secsLeft%60
          : Math.floor(secsLeft/3600)+'h');
  }

  function _fmt12h(h, m) {
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  /* ─── Live-countdown DOM patches (called every second) ──────── */
  function _updateStripTimer() {
    var secsLeft = Math.max(0, _focusSessionSecs);
    var elapsed  = _focusSessionTotalSecs - _focusSessionSecs;
    var elapsedM = Math.floor(elapsed / 60), totalM = Math.floor(_focusSessionTotalSecs / 60);
    var pct      = _focusSessionTotalSecs > 0 ? Math.round((elapsed / _focusSessionTotalSecs) * 100) : 0;
    var timerStr = _fmtStripTimer(secsLeft);
    document.querySelectorAll('.fs-live-timer').forEach(function (el) { el.textContent = timerStr; });
    document.querySelectorAll('.fs-live-bar').forEach(function (el)   { el.style.width = pct + '%'; });
    document.querySelectorAll('.fs-live-sub').forEach(function (el)   { el.textContent = elapsedM + ' of ' + totalM + ' min elapsed'; });
    var hdt = document.getElementById('home-focus-dyn-timer');
    if (hdt) hdt.textContent = timerStr;
  }

  /* ═══════════════════════════════════════════════════════════════
   * SYNC STATE ON BOOT / RESUME
   * ═══════════════════════════════════════════════════════════════ */
  function _syncSessionState() {
    if (!IS_NATIVE) return;
    try {
      var state = JSON.parse(N.getFocusSessionState() || 'null');
      if (state && state.active) {
        var wasActive = _focusSessionActive;
        _focusSessionActive = true;
        _focusDifficulty    = state.difficulty || 'gentle';
        if (state.blockedApps && state.blockedApps.length) _focusBlockedApps = state.blockedApps;
        _focusSessionTotalSecs = state.totalSecs || S.settings.focusTotalSecs || (_selectedFocusDur * 60);
        if (state.activeRoutineId) _activeRoutineId = state.activeRoutineId;
        if (!wasActive || !_focusSessionTimer) {
          _focusSessionSecs = state.remainingSecs || 0;
          _renderSessionActive(state);
        } else {
          if (Math.abs(_focusSessionSecs - (state.remainingSecs || 0)) > 3) _focusSessionSecs = state.remainingSecs || 0;
        }
      } else {
        if (_focusSessionActive) {
          clearInterval(_focusSessionTimer); _focusSessionTimer = null;
          clearInterval(_firmCountdown);     _firmCountdown     = null;
          _focusSessionActive = false; _activeRoutineId = '';
          var wrap = document.getElementById('focus-session-wrap');
          if (wrap && wrap.querySelector('.focus-orbit.active')) {
            _renderSessionIdle();
            if (typeof FocusRoutine !== 'undefined') FocusRoutine.render();
            _updateFocusSubheader();
          }
        } else { _focusSessionActive = false; _activeRoutineId = ''; }
      }
    } catch (_) {}
  }

  window._syncFocusStateOnBoot = function () {
    if (!IS_NATIVE) return;
    _syncSessionState();
    if (!_focusSessionActive && typeof N.getAndClearLastFocusOutcome === 'function') {
      try {
        var r = JSON.parse(N.getAndClearLastFocusOutcome() || '{}');
        if (r.outcome === 'completed' || r.outcome === 'interrupted') {
          _focusLastState = r.outcome; _focusLastStateTs = Date.now();
          _focusLastElapsedMins = r.elapsedMins || 0; _focusLastTotalMins = r.totalMins || 0;
        }
      } catch (_) {}
    }
    _loadTimerIgnoreStats();
    renderFocusScore(); renderLimitsStrip();
    renderFocusStrip();
    renderHomeFocusDynamicRow(); renderHomeHabitsDynamicRow();
  };

  /* ═══════════════════════════════════════════════════════════════
   * TAB LIFECYCLE
   * ═══════════════════════════════════════════════════════════════ */
  function initFocusTab() {
    if (_focusLoaded) { _refreshFocusData(); return; }
    _focusLoaded = true;
    _loadFocusBlockedApps();
    _loadTimerIgnoreStats();
    if (typeof FocusTimers   !== 'undefined') FocusTimers.render(document.getElementById('focus-timers-wrap'));
    if (typeof FocusMindful  !== 'undefined') FocusMindful.render();
    if (typeof FocusBedtime  !== 'undefined') FocusBedtime.render();
    if (typeof FocusChallenge!== 'undefined') FocusChallenge.render();
    renderFocusStaticRow();
    if (typeof FocusRoutine  !== 'undefined') { FocusRoutine.load(); FocusRoutine.render(); }
    _syncSessionState();
    _renderFocusSession();
    _updateFocusSubheader();
    if (!window._focusDynInterval) {
      window._focusDynInterval = setInterval(function () {
        _invalidateStripCache();
        renderFocusStaticRow();
        renderHabitsStaticRow();
        renderFocusDynamicRow();
        renderHabitsDynamicRow();
      }, 30000);
    }
  }

  function onFocusTabVisible() { _refreshFocusData(); }

  function _refreshFocusData() {
    _syncSessionState();
    _loadTimerIgnoreStats();
    _invalidateStripCache();
    if (typeof FocusTimers   !== 'undefined') FocusTimers.render(document.getElementById('focus-timers-wrap'));
    if (typeof FocusMindful  !== 'undefined') FocusMindful.render();
    if (typeof FocusBedtime  !== 'undefined') FocusBedtime.render();
    if (typeof FocusChallenge!== 'undefined') FocusChallenge.render();
    if (typeof FocusRoutine  !== 'undefined') FocusRoutine.render();
    renderFocusStaticRow(); renderHabitsStaticRow();
    renderFocusDynamicRow(); renderHabitsDynamicRow();
    _updateFocusSubheader();
  }

  /* ─── Sub-tab switch ─────────────────────────────────────────── */
  function _switchFocusSubTab(tab) {
    _focusActiveSubTab = tab;
    var focusEl  = document.getElementById('focus-subtab-focus');
    var habitsEl = document.getElementById('focus-subtab-habits');
    if (focusEl)  focusEl.style.display  = tab === 'focus'  ? '' : 'none';
    if (habitsEl) habitsEl.style.display = tab === 'habits' ? '' : 'none';
    // IDs match focus.html: focus-pill-focus / focus-pill-habits
    // Styling uses w-tpb 'on'/'off' classes (same pattern as wellness tabs)
    var btnF = document.getElementById('focus-pill-focus');
    var btnH = document.getElementById('focus-pill-habits');
    if (btnF) { btnF.classList.toggle('on', tab === 'focus');  btnF.classList.toggle('off', tab !== 'focus');  }
    if (btnH) { btnH.classList.toggle('on', tab === 'habits'); btnH.classList.toggle('off', tab !== 'habits'); }
    if (tab === 'focus') {
      renderFocusStaticRow(); renderFocusDynamicRow();
    } else {
      renderHabitsStaticRow(); renderHabitsDynamicRow();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * TIMER IGNORE STATS (kept here: cache lives in shell for BUG-5)
   * ═══════════════════════════════════════════════════════════════ */
  function _loadTimerIgnoreStats() {
    if (!IS_NATIVE || typeof N.getTimerIgnoreStats !== 'function') return;
    try { _timerIgnoreCache = JSON.parse(N.getTimerIgnoreStats() || '{}'); } catch (_) { _timerIgnoreCache = {}; }
  }

  /* ═══════════════════════════════════════════════════════════════
   * BLOCKED APPS (state lives here; UI delegated to FocusPicker)
   * ═══════════════════════════════════════════════════════════════ */
  function _loadFocusBlockedApps() {
    if (_focusSessionActive) return;
    if (IS_NATIVE) { try { _focusBlockedApps = JSON.parse(N.getFocusBlockedApps() || '[]'); } catch (_) { _focusBlockedApps = []; } }
    if (!_focusBlockedApps.length) {
      var KW = ['instagram','tiktok','twitter','facebook','youtube','reddit','snapchat','threads','pinterest'];
      _focusBlockedApps = (typeof DAILY_USE !== 'undefined' ? DAILY_USE : [])
        .filter(function (a) { return KW.some(function (kw) { return a.packageName.toLowerCase().includes(kw) || a.name.toLowerCase().includes(kw); }); })
        .slice(0, 3).map(function (a) { return { packageName: a.packageName, name: a.name }; });
    }
  }

  function _saveFocusBlockedApps() {
    if (IS_NATIVE) { try { N.saveFocusBlockedApps(JSON.stringify(_focusBlockedApps)); } catch (_) {} }
  }

  function removeFocusBlockedApp(pkg) {
    _focusBlockedApps = _focusBlockedApps.filter(function (a) { return a.packageName !== pkg; });
    _saveFocusBlockedApps();
    _refreshFocusChips();
    if (_focusSessionActive && IS_NATIVE) {
      try { N.updateFocusSession(JSON.stringify(_focusBlockedApps), Date.now() + _focusSessionSecs * 1000, _focusDifficulty); } catch (_) {}
    }
  }

  function _refreshFocusChips() {
    var wrap = document.getElementById('focus-app-chips');
    if (!wrap || _focusSessionActive) return;
    var atLimit = !ProTier.isPro && _focusBlockedApps.length >= ProTier.getLimit('FOCUS_APPS_UNLIMITED');
    var chips   = _focusBlockedApps.slice(0, 5).map(_makeBlockedChip).join('');
    var overflow= _focusBlockedApps.length > 5 ? _makeOverflowChip(_focusBlockedApps.length - 5) : '';
    var addSlot = atLimit
      ? '<div class="focus-chip-add focus-app-slot locked" style="opacity:.6;border-style:dashed" onclick="ProTier.triggerUpsell(\'FOCUS_APPS_UNLIMITED\')">＋ Add app&nbsp;' + (typeof proBadge === 'function' ? proBadge(true) : '') + '</div>'
      : '<div class="focus-chip-add" onclick="openFocusAppPicker(\'block\')">＋ Add app</div>';
    wrap.innerHTML = chips + overflow + addSlot;
    ProTier.applyCeiling(_focusBlockedApps.length, 'FOCUS_APPS_UNLIMITED', wrap, null);
  }

  /* ═══════════════════════════════════════════════════════════════
   * FOCUS SESSION — RENDER
   * ═══════════════════════════════════════════════════════════════ */
  function _renderFocusSession() {
    if (_focusSessionActive) {
      _syncSessionState();
      // safety net: if sync didn't render (non-native env), fall back to idle
      var wrap = document.getElementById('focus-session-wrap');
      if (wrap && !wrap.innerHTML.trim()) _renderSessionIdle();
    } else {
      _renderSessionIdle();
    }
  }

  function _makeBlockedChip(a) {
    return '<div class="focus-app-chip blocked">' +
      '<div class="focus-chip-ico">' + appIco(a.packageName, 20, 5) + '</div>' +
      '<span>' + a.name.split(' ')[0] + '</span>' +
      '<span onclick="event.stopPropagation();FocusTab.removeFocusBlockedApp(\'' + escAttr(a.packageName) + '\')" style="opacity:.45;font-size:12px;margin-left:2px;cursor:pointer">\u00d7</span>' +
      '</div>';
  }

  function _makeOverflowChip(count) {
    return '<div class="focus-app-chip" style="background:var(--s2);border-color:var(--border2);color:var(--t3);font-family:var(--ff-m);font-size:10px;cursor:default">+' + count + '</div>';
  }

  function _renderSessionIdle() {
    var wrap = document.getElementById('focus-session-wrap');
    if (!wrap) return;
    var diff  = FOCUS_DIFF[_focusDifficulty] || FOCUS_DIFF.gentle;
    var isPro = ProTier.isPro;

    // Duration buttons — two-line format matching old UI
    var durs    = [25, 60, 90, 120];
    var durBtns = durs.map(function (m) {
      var active = (!_focusCustomDur && m === _selectedFocusDur);
      var num    = m < 60 ? m : (m / 60);
      var unit   = m < 60 ? 'min' : (m === 60 ? 'hr' : 'hrs');
      return '<div class="focus-dur-btn' + (active ? ' active' : '') +
        '" onclick="FocusTab.selectFocusDuration(' + m + ',this)">' +
        num + '<span>' + unit + '</span></div>';
    }).join('');

    // Custom — full-width separate row
    var customLabel = _focusCustomDur
      ? '⏱ ' + _formatCustomDur(_selectedFocusDur)
      : '⏱ Set custom duration';
    var customBtn = '<div class="focus-dur-custom' + (_focusCustomDur ? ' active' : '') +
      '" onclick="FocusTab.openCustomDurPicker()">' + customLabel + '</div>';

    // Blocked chips
    var chips    = _focusBlockedApps.slice(0, 5).map(_makeBlockedChip).join('');
    var overflow = _focusBlockedApps.length > 5 ? _makeOverflowChip(_focusBlockedApps.length - 5) : '';
    var atLimit  = !isPro && _focusBlockedApps.length >= ProTier.getLimit('FOCUS_APPS_UNLIMITED');
    var addSlot  = atLimit
      ? '<div class="focus-chip-add focus-app-slot locked" style="opacity:.6;border-style:dashed" onclick="ProTier.triggerUpsell(\'FOCUS_APPS_UNLIMITED\')">＋ Add app&nbsp;' + (typeof proBadge === 'function' ? proBadge(true) : '') + '</div>'
      : '<div class="focus-chip-add" onclick="openFocusAppPicker(\'block\')">＋ Add app</div>';

    // Difficulty pills — with emojis
    var diffPills = Object.keys(FOCUS_DIFF).map(function (k) {
      var dk      = FOCUS_DIFF[k];
      var proLock = !isPro && k === 'deep';
      return '<div class="focus-diff-pill' + (k === _focusDifficulty ? ' active' : '') +
        '" data-diff="' + k + '" onclick="FocusTab.setFocusDifficulty(\'' + k + '\')">' +
        dk.emoji + ' ' + dk.label +
        (proLock ? '&nbsp;' + (typeof proBadge === 'function' ? proBadge(true) : '') : '') +
        '</div>';
    }).join('');

    var upcomingNotice = '';
    try { if (typeof FocusRoutine !== 'undefined') upcomingNotice = FocusRoutine.buildUpcomingNotice() || ''; } catch(_) {}

    wrap.innerHTML =
      '<div class="focus-orbit-wrap">' +
        '<div class="focus-orbit idle" style="border-color:' + diff.color + '22">' +
          '<div class="focus-orbit-inner" onclick="FocusTab.startFocusSession()" ' +
            'style="background:radial-gradient(circle,' + diff.color + '28,rgba(6,6,16,.85));border-color:' + diff.color + '55;cursor:pointer">' +
            '<div class="focus-orbit-time">' + _fmtStripTimer(_selectedFocusDur * 60) + '</div>' +
            '<div class="focus-orbit-lbl">READY</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="focus-dur-row">' + durBtns + '</div>' +
      customBtn +
      '<div class="focus-diff-row">' + diffPills + '</div>' +
      '<div class="focus-diff-desc">' + diff.desc + '</div>' +
      '<div id="focus-app-chips" style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:' + (chips ? '10' : '6') + 'px">' +
        chips + overflow + addSlot +
      '</div>' +
      upcomingNotice +
      '<button class="focus-start-btn" onclick="FocusTab.startFocusSession()">Start Focus Session →</button>';

    ProTier.applyCeiling(_focusBlockedApps.length, 'FOCUS_APPS_UNLIMITED', document.getElementById('focus-app-chips'), null);
  }

  function _renderSessionActive(state) {
    var wrap = document.getElementById('focus-session-wrap');
    if (!wrap) return;
    var diff     = FOCUS_DIFF[_focusDifficulty] || FOCUS_DIFF.gentle;
    var secsLeft = Math.max(0, _focusSessionSecs);
    var elapsed  = _focusSessionTotalSecs - _focusSessionSecs;
    var pct      = _focusSessionTotalSecs > 0 ? Math.round((elapsed / _focusSessionTotalSecs) * 100) : 0;
    var chips    = _focusBlockedApps.slice(0, 4).map(_makeBlockedChip).join('');

    // Canvas sized to match orbit + outer ring (136px orbit + 10px inset = 156px)
    wrap.innerHTML =
      '<div class="focus-orbit-wrap">' +
        '<div class="focus-orbit active" style="border-color:' + diff.color + '55">' +
          '<div class="focus-orbit-inner active" style="background:radial-gradient(circle,' + diff.color + '28,rgba(6,6,16,.85));border-color:' + diff.color + '55">' +
            '<div class="focus-orbit-time fs-live-timer" id="focus-timer-display" style="color:' + diff.color + '">' + _fmtStripTimer(secsLeft) + '</div>' +
            '<div class="focus-orbit-lbl" style="color:' + diff.color + '99">' + diff.emoji + ' ' + diff.label + '</div>' +
          '</div>' +
          '<canvas id="focus-orbit-dot" width="156" height="156" style="position:absolute;inset:-10px;pointer-events:none"></canvas>' +
        '</div>' +
      '</div>' +
      '<div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden;margin:12px 0 8px">' +
        '<div id="focus-progress-bar" style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,' + diff.color + ',var(--c));border-radius:3px;transition:width 1s linear"></div>' +
      '</div>' +
      (chips ? '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px">' + chips + '</div>' : '') +
      '<div style="display:flex;gap:8px">' +
        '<button onclick="FocusTab.handleEndSession()" class="focus-end-btn">End session</button>' +
      '</div>';

    _updateOrbitDot(_focusSessionSecs, _focusSessionTotalSecs);
    if (!_focusSessionTimer) _startCountdown(_focusSessionSecs);
  }

  /* ═══════════════════════════════════════════════════════════════
   * ORBIT DOT + COUNTDOWN
   * ═══════════════════════════════════════════════════════════════ */
  function _updateTimerDisplay(secs) {
    var el = document.getElementById('focus-timer-display');
    if (el) el.textContent = _fmtStripTimer(Math.max(0, secs));
    var bar = document.getElementById('focus-progress-bar');
    if (bar && _focusSessionTotalSecs > 0) {
      var elapsed = _focusSessionTotalSecs - secs;
      bar.style.width = Math.round((elapsed / _focusSessionTotalSecs) * 100) + '%';
    }
  }

  function _updateOrbitDot(remainingSecs, totalSecs) {
    var canvas = document.getElementById('focus-orbit-dot');
    if (!canvas) return;
    var ctx = canvas.getContext('2d'); if (!ctx) return;
    // Canvas is 156×156 (orbit 136px + 10px inset each side)
    var W = canvas.width, H = canvas.height, CX = W / 2, CY = H / 2;
    var R = W / 2 - 8; // ~70px — sits on the outer ring border
    var pct     = totalSecs > 0 ? (totalSecs - remainingSecs) / totalSecs : 0;
    var angle   = -Math.PI / 2 + pct * Math.PI * 2;
    var diff    = FOCUS_DIFF[_focusDifficulty] || FOCUS_DIFF.gentle;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(CX + R * Math.cos(angle), CY + R * Math.sin(angle), 6, 0, Math.PI * 2);
    ctx.fillStyle = diff.color; ctx.shadowColor = diff.color; ctx.shadowBlur = 8; ctx.fill();
  }

  function _startCountdown(secs) {
    clearInterval(_focusSessionTimer);
    _focusSessionSecs = secs;
    _focusSessionTimer = setInterval(function () {
      _focusSessionSecs = Math.max(0, _focusSessionSecs - 1);
      _updateTimerDisplay(_focusSessionSecs);
      _updateOrbitDot(_focusSessionSecs, _focusSessionTotalSecs);
      _updateStripTimer();
      if (_focusSessionSecs <= 0) {
        clearInterval(_focusSessionTimer); _focusSessionTimer = null;
        _onSessionComplete();
      }
    }, 1000);
  }

  /* ═══════════════════════════════════════════════════════════════
   * SESSION CONTROLS — START / EXTEND / STOP
   * ═══════════════════════════════════════════════════════════════ */
  function extendFocusSession(deltaMins) {
    _focusSessionSecs      += deltaMins * 60;
    _focusSessionTotalSecs += deltaMins * 60;
    if (IS_NATIVE && typeof N.extendFocusSession === 'function') {
      try { N.extendFocusSession(deltaMins); } catch (_) {}
    }
    _updateTimerDisplay(_focusSessionSecs);
    _updateOrbitDot(_focusSessionSecs, _focusSessionTotalSecs);
  }

  function selectFocusDuration(mins, el) {
    _selectedFocusDur = mins; _focusCustomDur = false;
    document.querySelectorAll('.focus-dur-btn').forEach(function (b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
  }

  function setFocusDifficulty(level) {
    if (level === 'deep' && !ProTier.isPro) { ProTier.triggerUpsell('DEEP_FOCUS'); return; }
    _focusDifficulty = level;
    _renderSessionIdle();
  }

  function _formatCustomDur(mins) {
    if (mins < 60) return mins + 'm';
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }

  /* ── Custom duration drum picker ─────────────────────────────── */
  function _initDrumColumns() {
    var hoursEl = document.getElementById('dur-drum-hours');
    var minsEl  = document.getElementById('dur-drum-mins');
    if (!hoursEl || !minsEl) return;
    var h = Math.floor(_selectedFocusDur / 60);
    var m = Math.round((_selectedFocusDur % 60) / 5) * 5; // snap to nearest 5
    // Build items with top+bottom pads so the first/last item can centre
    var hHtml = '<div class="focus-drum-pad"></div>';
    var mHtml = '<div class="focus-drum-pad"></div>';
    for (var i = 0; i <= 8; i++) {
      hHtml += '<div class="focus-drum-item' + (i === h ? ' sel' : '') + '" data-val="' + i +
        '" onclick="this.parentElement.querySelectorAll(\'.focus-drum-item\').forEach(function(x){x.classList.remove(\'sel\')});this.classList.add(\'sel\')">' + i + 'h</div>';
    }
    for (var j = 0; j <= 55; j += 5) {
      mHtml += '<div class="focus-drum-item' + (j === m ? ' sel' : '') + '" data-val="' + j +
        '" onclick="this.parentElement.querySelectorAll(\'.focus-drum-item\').forEach(function(x){x.classList.remove(\'sel\')});this.classList.add(\'sel\')">' + (j < 10 ? '0' : '') + j + 'm</div>';
    }
    hHtml += '<div class="focus-drum-pad"></div>';
    mHtml += '<div class="focus-drum-pad"></div>';
    hoursEl.innerHTML = hHtml;
    minsEl.innerHTML  = mHtml;
    // Scroll the selected item into the visual centre of each column
    setTimeout(function () {
      var hSel = hoursEl.querySelector('.focus-drum-item.sel');
      var mSel = minsEl.querySelector('.focus-drum-item.sel');
      if (hSel) hoursEl.scrollTop = hSel.offsetTop - (hoursEl.clientHeight / 2 - hSel.offsetHeight / 2);
      if (mSel) minsEl.scrollTop  = mSel.offsetTop  - (minsEl.clientHeight  / 2 - mSel.offsetHeight  / 2);
    }, 30);

    // BUG-07: Scroll-to-select — auto-select the item closest to centre on scroll stop
    function _attachScrollSelect(colEl) {
      var scrollTimer = null;
      colEl.addEventListener('scroll', function () {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
          // Find the item whose centre is closest to the column's visual centre
          var colCentre = colEl.scrollTop + colEl.clientHeight / 2;
          var items = colEl.querySelectorAll('.focus-drum-item');
          var closest = null, closestDist = Infinity;
          items.forEach(function (item) {
            var itemCentre = item.offsetTop + item.offsetHeight / 2;
            var dist = Math.abs(itemCentre - colCentre);
            if (dist < closestDist) { closestDist = dist; closest = item; }
          });
          if (closest) {
            items.forEach(function (x) { x.classList.remove('sel'); });
            closest.classList.add('sel');
            // Snap scroll so the selected item sits perfectly centred
            colEl.scrollTo({ top: closest.offsetTop - (colEl.clientHeight / 2 - closest.offsetHeight / 2), behavior: 'smooth' });
          }
        }, 120); // 120ms debounce — fires shortly after scroll momentum stops
      }, { passive: true });
    }
    _attachScrollSelect(hoursEl);
    _attachScrollSelect(minsEl);
  }

  function openCustomDurPicker() {
    var panel = document.getElementById('focus-dur-picker');
    if (!panel) {
      // Build the modal on first use and append to body
      panel = document.createElement('div');
      panel.id = 'focus-dur-picker';
      panel.style.cssText = 'display:none;position:fixed;inset:0;z-index:2000;' +
        'background:rgba(6,6,16,.92);align-items:center;justify-content:center;';
      panel.innerHTML =
        '<div style="background:var(--s1);border:1px solid var(--border2);border-radius:22px;' +
        'padding:24px 20px;width:280px;box-sizing:border-box">' +
          '<div style="font-family:var(--ff-m);font-size:11px;letter-spacing:2px;' +
          'text-transform:uppercase;color:var(--t3);text-align:center;margin-bottom:18px">Custom Duration</div>' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:16px;' +
          'margin-bottom:4px;position:relative">' +
            // Selection highlight bar behind the centre row
            '<div style="position:absolute;left:0;right:0;height:44px;top:50%;transform:translateY(-50%);' +
            'border-top:1px solid var(--border2);border-bottom:1px solid var(--border2);' +
            'border-radius:8px;pointer-events:none"></div>' +
            '<div class="focus-drum-col" id="dur-drum-hours"></div>' +
            '<div style="font-family:var(--ff-m);font-size:22px;color:var(--t2);font-weight:300;flex-shrink:0">:</div>' +
            '<div class="focus-drum-col" id="dur-drum-mins"></div>' +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:9px;color:var(--t3);' +
          'text-align:center;margin-bottom:18px;letter-spacing:.5px">hours : minutes</div>' +
          '<div style="display:flex;gap:10px">' +
            '<button onclick="FocusTab.closeCustomDurPicker()" style="flex:1;padding:12px;border-radius:12px;' +
            'border:1px solid var(--border2);background:transparent;color:var(--t2);' +
            'font-family:var(--ff-m);font-size:13px;cursor:pointer">Cancel</button>' +
            '<button onclick="FocusTab.confirmCustomDur()" style="flex:1;padding:12px;border-radius:12px;' +
            'border:none;background:linear-gradient(135deg,var(--p),var(--c));color:#fff;' +
            'font-family:var(--ff-m);font-size:13px;font-weight:600;cursor:pointer">Set Duration</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(panel);
    }
    panel.style.display = 'flex';
    _initDrumColumns();
  }

  function closeCustomDurPicker() {
    var panel = document.getElementById('focus-dur-picker');
    if (panel) panel.style.display = 'none';
  }

  function confirmCustomDur() {
    var hSel = document.querySelector('#dur-drum-hours .focus-drum-item.sel');
    var mSel = document.querySelector('#dur-drum-mins .focus-drum-item.sel');
    var h = hSel ? parseInt(hSel.dataset.val) : 0;
    var m = mSel ? parseInt(mSel.dataset.val) : 25;
    var total = h * 60 + m;
    if (total < 5)  { toast('Minimum 5 minutes', 'warn'); return; }
    if (total > 480){ toast('Maximum 8 hours', 'warn'); return; }
    _selectedFocusDur = total; _focusCustomDur = true;
    closeCustomDurPicker();
    _renderSessionIdle();
  }

  function startFocusSession() {
    if (_focusSessionActive) return;
    // BUG-08: Require at least 1 blocked app before starting
    if (!_focusBlockedApps || _focusBlockedApps.length === 0) {
      toast('Add at least 1 app to block before starting a session.', 'info');
      return;
    }
    if (IS_NATIVE && typeof N.hasOverlayPermission === 'function' && !N.hasOverlayPermission()) {
      showConfirm('Draw Over Apps Permission', 'Focus Mode needs to show a block screen over restricted apps. Tap Grant to allow it.',
        function () { if (typeof N.requestOverlayPermission === 'function') N.requestOverlayPermission(); window._pendingFocusStart = true; },
        'Grant Permission', 'Cancel');
      return;
    }
    // BUG-05: Show pre-start warning for Firm and Deep modes
    if (_focusDifficulty === 'deep') {
      showConfirm(
        '🔒 Deep Focus',
        'This session cannot be ended early. The block screen will remain active for the full duration. Are you ready?',
        function () { _activeRoutineId = ''; _doStartFocusSession(); },
        'Start Deep Focus', 'Cancel'
      );
      return;
    }
    if (_focusDifficulty === 'firm') {
      showConfirm(
        '🔥 Firm Focus',
        'If you try to end this session early you will face a 30-second wait before the option to stop is unlocked.',
        function () { _activeRoutineId = ''; _doStartFocusSession(); },
        'Start Firm Focus', 'Cancel'
      );
      return;
    }
    _activeRoutineId = '';
    _doStartFocusSession();
  }

  function _doStartFocusSession() {
    var durationMins = _selectedFocusDur;
    _focusSessionTotalSecs = durationMins * 60;
    _focusSessionSecs      = _focusSessionTotalSecs;
    _focusSessionActive    = true;
    _focusLastState        = null; _focusLastStateTs = 0;
    if (IS_NATIVE) {
      try { N.startFocusSession(JSON.stringify(_focusBlockedApps), durationMins, _focusDifficulty); } catch (_) {}
    }
    S.settings.focusTotalSecs = _focusSessionTotalSecs; saveS();
    _renderSessionActive({});
    renderFocusStrip();
    _invalidateStripCache();
    renderHomeFocusDynamicRow();
    if (typeof FocusRoutine !== 'undefined') FocusRoutine.render();
    _updateFocusSubheader();
  }

  /* ─── End session ────────────────────────────────────────────── */
  /* ── Firm countdown state ──────────────────────────────────── */
  var _firmCountdownActive = false;

  function handleEndSession() {
    if (!_focusSessionActive) return;
    var isComplete = (_focusSessionSecs <= 0);
    if (isComplete) { endFocusSession(); return; }

    // BUG-05: Deep mode — block ending entirely
    if (_focusDifficulty === 'deep') {
      toast('Deep Focus is active — session cannot be ended early. 🔒', 'info');
      return;
    }

    // BUG-05: Firm mode — 30-second exit delay
    if (_focusDifficulty === 'firm') {
      if (_firmCountdownActive) return; // already counting down
      _firmCountdownActive = true;
      var secs = 30;
      // Show a dismissible countdown toast-style notice
      var noticeId = 'firm-exit-notice';
      var existing = document.getElementById(noticeId);
      if (existing) existing.remove();
      var notice = document.createElement('div');
      notice.id = noticeId;
      notice.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
        'background:#1a1a2e;border:1px solid #F7A623;border-radius:14px;padding:14px 20px;' +
        'font-family:var(--ff-m);font-size:13px;color:#F7A623;z-index:9999;text-align:center;' +
        'min-width:240px;box-shadow:0 4px 24px rgba(0,0,0,.5)';
      notice.textContent = '🔥 Firm mode — unlocking in ' + secs + 's…';
      document.body.appendChild(notice);
      var tick = setInterval(function () {
        secs--;
        if (notice.parentNode) notice.textContent = '🔥 Firm mode — unlocking in ' + secs + 's…';
        if (secs <= 0) {
          clearInterval(tick);
          _firmCountdownActive = false;
          if (notice.parentNode) notice.remove();
          // Now allow end
          showConfirm('End session early?', 'You have ' + _fmtStripTimer(_focusSessionSecs) + ' remaining.',
            function () { endFocusSession(); }, 'End session', 'Keep going');
        }
      }, 1000);
      return;
    }

    // BUG-05: Gentle mode only — show confirm popup
    var elapsed = Math.floor((_focusSessionTotalSecs - _focusSessionSecs) / 60);
    var total   = Math.floor(_focusSessionTotalSecs / 60);
    if (elapsed < total * 0.5) {
      showConfirm('End session early?', 'You have ' + _fmtStripTimer(_focusSessionSecs) + ' remaining.',
        function () { endFocusSession(); }, 'End session', 'Keep going');
    } else { endFocusSession(); }
  }

  function endFocusSession() {
    clearInterval(_focusSessionTimer); _focusSessionTimer = null;
    clearInterval(_firmCountdown);     _firmCountdown     = null;
    var elapsed  = Math.floor((_focusSessionTotalSecs - _focusSessionSecs) / 60);
    var total    = Math.floor(_focusSessionTotalSecs / 60);
    var complete = (_focusSessionSecs <= 0 || elapsed >= total * 0.9);
    _focusSessionActive = false;
    if (IS_NATIVE) { try { N.stopFocusSession(); } catch (_) {} }
    if (complete) { _celebrateCompletion(total); }
    else {
      _focusLastState = 'interrupted'; _focusLastStateTs = Date.now();
      _focusLastElapsedMins = elapsed; _focusLastTotalMins = total;
      _renderSessionIdle();
      _invalidateStripCache(); renderFocusStrip(); renderHomeFocusDynamicRow(); renderHomeHabitsDynamicRow();
    }
    if (typeof FocusRoutine !== 'undefined') FocusRoutine.render();
    _activeRoutineId = ''; _updateFocusSubheader();
  }

  function _onSessionComplete() {
    var total = Math.floor(_focusSessionTotalSecs / 60);
    _focusSessionActive = false;
    clearInterval(_focusSessionTimer); _focusSessionTimer = null;
    _celebrateCompletion(total);
    if (typeof FocusRoutine !== 'undefined') FocusRoutine.render();
    _activeRoutineId = '';
  }

  window.onFocusSessionEnded = function (routineId) {
    clearInterval(_focusSessionTimer); _focusSessionTimer = null;
    clearInterval(_firmCountdown);     _firmCountdown     = null;
    var elapsed  = Math.floor((_focusSessionTotalSecs - _focusSessionSecs) / 60);
    var total    = Math.floor(_focusSessionTotalSecs / 60);
    var complete = (_focusSessionSecs <= 0 || elapsed >= total * 0.9);
    _focusSessionActive = false; _activeRoutineId = '';
    if (complete) { _celebrateCompletion(total); }
    else {
      _focusLastState = 'interrupted'; _focusLastStateTs = Date.now();
      _focusLastElapsedMins = elapsed; _focusLastTotalMins = total;
      _renderSessionIdle();
      _invalidateStripCache(); renderFocusStrip(); renderHomeFocusDynamicRow(); renderHomeHabitsDynamicRow();
    }
    if (typeof FocusRoutine !== 'undefined') FocusRoutine.render();
    _updateFocusSubheader();
  };

  /* ─── Post-session celebration ───────────────────────────────── */
  function _celebrateCompletion(durationMins) {
    if (IS_NATIVE) {
      try { if (typeof N.recordFocusComplete === 'function') N.recordFocusComplete(durationMins); } catch (_) {}
      try { if (typeof N.checkAndTriggerRateApp === 'function') N.checkAndTriggerRateApp('focus_complete'); } catch (_) {}
    }
    _focusLastTotalMins = durationMins; _focusLastElapsedMins = durationMins;
    _launchConfetti();
    setTimeout(function () {
      _invalidateStripCache(); _focusLastState = 'completed'; _focusLastStateTs = Date.now();
      _renderSessionIdle();
      renderFocusStrip(); renderFocusDynamicRow(); checkStreakIncrements();
      renderHomeFocusDynamicRow(); renderHomeHabitsDynamicRow();
    }, 3500);
  }

  function _launchConfetti() {
    var wrap = document.createElement('div');
    wrap.id = 'focus-confetti';
    wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
    var colors = ['#6C63FF','#05C8E8','#12D48A','#F7A623','#F04E7A','#B06EFF'];
    for (var i = 0; i < 48; i++) {
      var p = document.createElement('div');
      var color = colors[i % colors.length];
      var x = 20 + Math.random() * 60;
      p.style.cssText = 'position:absolute;width:' + (4+Math.random()*6) + 'px;height:' + (4+Math.random()*6) + 'px;' +
        'background:' + color + ';left:' + x + '%;top:-10px;border-radius:' + (Math.random()>0.5?'50%':'2px') + ';' +
        'animation:confetti-fall ' + (1.2+Math.random()*1.5) + 's linear ' + (Math.random()*0.6) + 's forwards;' +
        'transform:rotate(' + (Math.random()*360) + 'deg)';
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 4000);
  }

  /* ─── Post-session card ──────────────────────────────────────── */
  function _showPostSessionCard(completed, durationMins) {
    var existing = document.getElementById('post-session-card');
    if (existing) existing.remove();
    var msg = completed ? '\uD83C\uDF89 Session complete! ' + durationMins + ' min focused.' : '\u23F8 Session ended early.';
    var card = document.createElement('div');
    card.id = 'post-session-card';
    card.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);z-index:3000;background:var(--s2);border:1px solid var(--border2);border-radius:16px;padding:14px 20px;box-shadow:0 8px 32px rgba(0,0,0,.25);font-family:var(--ff-m);font-size:13px;color:var(--t1);white-space:nowrap;animation:fade-in-up .3s ease';
    card.textContent = msg;
    document.body.appendChild(card);
    setTimeout(function () { card.style.opacity = '0'; card.style.transition = 'opacity .4s'; setTimeout(function () { card.remove(); }, 400); }, 3500);
  }

  /* ═══════════════════════════════════════════════════════════════
   * SUBHEADER
   * ═══════════════════════════════════════════════════════════════ */
  function _updateFocusSubheader() {
    var el = document.getElementById('focus-subheader');
    if (!el) return;
    if (_focusSessionActive) {
      el.textContent = '\uD83C\uDFAF Session active \u00b7 ' + _focusBlockedApps.length + ' app' + (_focusBlockedApps.length !== 1 ? 's' : '') + ' blocked';
      return;
    }
    var parts = [], limitCount = Object.keys(S.limits || {}).length;
    if (limitCount) parts.push(limitCount + ' timer' + (limitCount !== 1 ? 's' : ''));
    if (S.settings.intentionPrompt !== false && typeof FocusMindful !== 'undefined' && FocusMindful.getApps().length) parts.push('pause prompt on');
    if (S.settings.bedtime) parts.push('bedtime on');
    el.textContent = parts.length ? parts.join(' \u00b7 ') : 'Build healthier habits';
  }

  /* ═══════════════════════════════════════════════════════════════
   * PRO STATUS HOOK
   * ═══════════════════════════════════════════════════════════════ */
  (function () {
    var _prev = window.onProStatusChanged;
    window.onProStatusChanged = function (isPro) {
      if (typeof _prev === 'function') _prev(isPro);
      if (!_focusLoaded) { _focusLoaded = false; return; }
      if (typeof FocusChallenge !== 'undefined') FocusChallenge.render();
      _renderFocusSession();
      if (typeof FocusBedtime !== 'undefined') FocusBedtime.render();
      if (typeof FocusRoutine !== 'undefined') FocusRoutine.render();
      renderFocusStaticRow();
      renderHabitsStaticRow();
    };
  })();

  /* ═══════════════════════════════════════════════════════════════
   * RESUME HOOK
   * ═══════════════════════════════════════════════════════════════ */
  (function () {
    var _orig = window.onAppResume;
    window.onAppResume = function () {
      if (typeof _orig === 'function') _orig();
      if (window._pendingFocusStart) { window._pendingFocusStart = false; _doStartFocusSession(); }
      if (window._pendingIntentionEnable) {
        window._pendingIntentionEnable = false;
        if (IS_NATIVE && typeof N.hasOverlayPermission === 'function' && N.hasOverlayPermission()) {
          if (typeof FocusMindful !== 'undefined') FocusMindful.applyToggle(true);
        }
      }
      if (window._pendingTimerApply) { window._pendingTimerApply = false; }
      if (window._pendingBedtimeToggleOn) {
        window._pendingBedtimeToggleOn = false;
        if (IS_NATIVE && typeof N.hasDndPermission === 'function' && N.hasDndPermission()) {
          if (typeof FocusBedtime !== 'undefined') FocusBedtime.toggle();
        }
      }
    };
  })();

  window._pendingFocusStart     = false;
  window._pendingIntentionEnable= false;
  window._pendingBedtimeToggleOn= false;

  /* ═══════════════════════════════════════════════════════════════
   * BACKWARD-COMPAT WINDOW DELEGATES (score, bedtime, challenge)
   * ═══════════════════════════════════════════════════════════════ */
  window._saveScoreForToday  = function (k, s) { if (typeof FocusScore !== 'undefined') FocusScore.saveScoreForToday(k, s); };
  window._getYesterdayScore  = function (k)    { return typeof FocusScore !== 'undefined' ? FocusScore.getYesterdayScore(k) : null; };
  window.openFocusScoreSheet = function ()      { if (typeof FocusScore !== 'undefined') FocusScore.openFocusScoreSheet(); };
  window.openHabitsScoreSheet= function ()      { if (typeof FocusScore !== 'undefined') FocusScore.openHabitsScoreSheet(); };
  window._closeScoreSheet    = function ()      { if (typeof FocusScore !== 'undefined') FocusScore.closeScoreSheet(); };
  window._showQueuedEvents   = function (id)    { if (typeof FocusScore !== 'undefined') FocusScore.showQueuedEvents(id); };
  window.snoozeBedtimePrompt = function ()      { if (typeof FocusBedtime !== 'undefined') FocusBedtime.snooze(); };
  window._checkChallengeProgress = function (id){ if (typeof FocusChallenge !== 'undefined') FocusChallenge.checkProgress(id); };
  window._skipChallenge      = function ()      { if (typeof FocusChallenge !== 'undefined') FocusChallenge.skipChallenge(); };

  /* ═══════════════════════════════════════════════════════════════
   * PUBLIC API
   * ═══════════════════════════════════════════════════════════════ */
  return {
    /* Lifecycle */
    initFocusTab, onFocusTabVisible,

    /* Session */
    startFocusSession, stopFocusSession: endFocusSession, handleEndSession,
    extendFocusSession, selectFocusDuration, setFocusDifficulty,
    openCustomDurPicker, closeCustomDurPicker, confirmCustomDur,

    /* Blocked apps */
    removeFocusBlockedApp,

    /* Picker delegation (FocusPicker needs these) */
    getPickerMode:       function ()    { return _focusPickerMode; },
    setPickerMode:       function (m)   { _focusPickerMode = m; },
    getPickerSelected:   function ()    { return _focusPickerSelected; },
    setPickerSelected:   function (s)   { _focusPickerSelected = s; },
    getPickerReturnTarget: function ()  { return _pickerReturnTarget; },
    setPickerReturnTarget: function (t) { _pickerReturnTarget = t; },
    getBlockedApps:      function ()    { return _focusBlockedApps; },
    setBlockedApps:      function (a)   { _focusBlockedApps = a; },
    saveBlockedApps:     _saveFocusBlockedApps,
    refreshChips:        _refreshFocusChips,
    saveFocusPick:       function () { if (typeof FocusPicker !== 'undefined') FocusPicker.savePick(); },
    buildPickerHTML:     function ()    { return typeof FocusPicker !== 'undefined' ? FocusPicker.buildPickerHTML() : ''; },
    buildPickerUsageMap: function ()    { if (typeof FocusPicker !== 'undefined') FocusPicker.buildPickerUsageMap(); },

    /* Routines (FocusRoutine delegates to these for session start) */
    doStartFocusSession: function (rid) { _activeRoutineId = rid || ''; _doStartFocusSession(); },
    renderSessionIdle:   function ()    { if (!_focusSessionActive) _renderSessionIdle(); },
    setDifficulty:       function (d)   { _focusDifficulty = d; },
    setSelectedFocusDur: function (m)   { _selectedFocusDur = m; _focusCustomDur = ![25,60,90,120].includes(m); },

    /* Sub-tab */
    _switchFocusSubTab,

    /* State getters (for FocusHome, FocusScore, FocusPicker) */
    getSessionState: function () {
      return { active: _focusSessionActive, secs: _focusSessionSecs, totalSecs: _focusSessionTotalSecs,
               difficulty: _focusDifficulty, blockedApps: _focusBlockedApps, activeRoutineId: _activeRoutineId };
    },
    getLastState: function () {
      return { state: _focusLastState, ts: _focusLastStateTs, elapsedMins: _focusLastElapsedMins, totalMins: _focusLastTotalMins };
    },
    getStreakState: function () {
      return { prevFocusStreak: _prevFocusStreak, prevSleepStreak: _prevSleepStreak,
               focusStreakCelebUntil: _focusStreakCelebUntil, sleepStreakCelebUntil: _sleepStreakCelebUntil };
    },
    setStreakState: function (fs, ss, fcUntil, scUntil) {
      _prevFocusStreak = fs; _prevSleepStreak = ss;
      _focusStreakCelebUntil = fcUntil || _focusStreakCelebUntil;
      _sleepStreakCelebUntil = scUntil || _sleepStreakCelebUntil;
    },
    getTimerIgnoreCache: function () { return _timerIgnoreCache; },
    loadTimerIgnoreStats: _loadTimerIgnoreStats,

    /* Strip data (delegated through FocusHome) */
    loadStripData:        _loadStripData,
    invalidateStripCache: _invalidateStripCache,

    /* Score sheet */
    _showFocusScoreBreakdown: function () { if (typeof FocusScore !== 'undefined') FocusScore.openFocusScoreSheet(); },
    openFocusScoreSheet:  function () { if (typeof FocusScore !== 'undefined') FocusScore.openFocusScoreSheet(); },
    openHabitsScoreSheet: function () { if (typeof FocusScore !== 'undefined') FocusScore.openHabitsScoreSheet(); },
    _closeScoreSheet:     function () { if (typeof FocusScore !== 'undefined') FocusScore.closeScoreSheet(); },
    _showQueuedEvents:    function (id) { if (typeof FocusScore !== 'undefined') FocusScore.showQueuedEvents(id); },

    /* Home / score rows */
    renderFocusStrip, renderLimitsStrip, checkStreakIncrements,
    renderHomeFocusDynamicRow, renderHomeHabitsDynamicRow,
    renderFocusStaticRow, renderHabitsStaticRow,
    renderFocusDynamicRow, renderHabitsDynamicRow,
    dismissMorningSummary,

    /* Challenge */
    _checkChallengeProgress: function (id) { if (typeof FocusChallenge !== 'undefined') FocusChallenge.checkProgress(id); },
    _skipChallenge: function () { if (typeof FocusChallenge !== 'undefined') FocusChallenge.skipChallenge(); },

    /* Bedtime */
    _toggleBedtimeSettings: function ()   { if (typeof FocusBedtime !== 'undefined') FocusBedtime.toggleSettings(); },
    _disableBedtime:        function ()   { if (typeof FocusBedtime !== 'undefined') FocusBedtime.disable(); },
    _saveBedtimeInline:     function ()   { if (typeof FocusBedtime !== 'undefined') FocusBedtime.save(); },
    _btInlineToggle: function (id)        { if (typeof FocusBedtime !== 'undefined') FocusBedtime.btInlineToggle(id); },
    _btToggleDay:    function (d)         { if (typeof FocusBedtime !== 'undefined') FocusBedtime.btToggleDay(d); },
    snoozeBedtimePrompt: function ()      { if (typeof FocusBedtime !== 'undefined') FocusBedtime.snooze(); },

    /* Routines */
    openRoutinePicker:    function (id, p) { if (typeof FocusRoutine !== 'undefined') FocusRoutine.openRoutinePicker(id, p); },
    closeRoutinePicker:   function ()      { if (typeof FocusRoutine !== 'undefined') FocusRoutine.closeRoutinePicker(); },
    saveRoutine:          function ()      { if (typeof FocusRoutine !== 'undefined') FocusRoutine.saveRoutine(); },
    toggleRoutine:        function (id)    { if (typeof FocusRoutine !== 'undefined') FocusRoutine.toggleRoutine(id); },
    activateTemplate:     function (id)    { if (typeof FocusPicker  !== 'undefined') FocusPicker.activateTemplate(id); },
    _rpToggleDay:         function (d)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpToggleDay(d); },
    _rpPresetDays:        function (a)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpPresetDays(a); },
    _rpRefreshPresetPills:function ()      { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpRefreshPresetPills(); },
    _rpSetDiff:           function (k)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpSetDiff(k); },
    _rpCycleEmoji:        function ()      { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpCycleEmoji(); },
    _rpRemoveApp:         function (p)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpRemoveApp(p); },
    _rpOpenAppPicker:     function ()      { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpOpenAppPicker(); },
    _rpSaveInlinePicker:  function ()      { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpSaveInlinePicker(); },
    _rpFilterInlinePicker:function (q)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpFilterInlinePicker(q); },
    _rpDelete:            function (id)    { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpDelete(id); },
    _rpConfirmDelete:     function (id)    { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpConfirmDelete(id); },
    _rpOpenTimePicker:    function (p)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpOpenTimePicker(p); },
    _rpCloseTimePicker:   function ()      { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpCloseTimePicker(); },
    _rpPickerSetHour:     function (h)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpPickerSetHour(h); },
    _rpPickerSetMin:      function (m)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpPickerSetMin(m); },
    _rpPickerSetAmPm:     function (p)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine._rpPickerSetAmPm(p); },

    /* Misc */
    shareCard: typeof shareCard !== 'undefined' ? shareCard : function () {},
  };
})();

/* ── BUG-10: Expose FOCUS_DIFF globally so app-focus-routine.js can access it ── */
window.FOCUS_DIFF = (function () {
  // FocusTab keeps FOCUS_DIFF private inside its IIFE; mirror it here so that
  // FocusRoutine._diffPills() does not get an undefined check and renders pills.
  return {
    gentle: { label: 'Gentle',     color: '#12D48A', emoji: '🌿', desc: 'A gentle nudge when you open a blocked app. You can still continue if needed.' },
    firm:   { label: 'Firm',       color: '#F7A623', emoji: '🔥', desc: 'A 30-second wait before you can dismiss the block screen.' },
    deep:   { label: 'Deep Focus', color: '#F04E7A', emoji: '🔒', desc: 'Full block for the session duration — no way past until it ends.' },
  };
})();

/* ── Score calculation wrappers ───────────────────────────────── */
function calculateFocusScore(d)  { return typeof FocusScore !== 'undefined' ? FocusScore.calculateFocus(d)  : null; }
function calculateSleepScore()   { return typeof FocusScore !== 'undefined' ? FocusScore.calculateSleep()   : { score: -1 }; }
function calculateAureloScore()  { return typeof FocusScore !== 'undefined' ? FocusScore.calculateAurelo()  : { score: -1 }; }

/* ── Global shims ─────────────────────────────────────────────── */
function initFocusTab()         { FocusTab.initFocusTab(); }
function onFocusTabVisible()    { FocusTab.onFocusTabVisible(); }
function renderFocusStrip()     { FocusTab.renderFocusStrip(); }
function renderLimitsStrip()    {}
function checkStreakIncrements(){ FocusTab.checkStreakIncrements(); }
function renderHomeFocusDynamicRow()  { FocusTab.renderHomeFocusDynamicRow(); }
function renderHomeHabitsDynamicRow() { FocusTab.renderHomeHabitsDynamicRow(); }
function removeFocusBlockedApp(pkg)   { FocusTab.removeFocusBlockedApp(pkg); }
function removeIntentionApp(pkg)      { if (typeof FocusMindful !== 'undefined') FocusMindful.removeApp(pkg); }
function stopFocusSession()           { FocusTab.stopFocusSession(); }
function _switchFocusSubTab(tab)      { FocusTab._switchFocusSubTab(tab); }
function removeTimer(pkg) {
  // FocusTimers module has no removeTimer method; do the work here instead.
  if (!pkg || !S || !S.limits) return;
  var removedName = pkg; // fallback label
  try { removedName = (DAILY_USE.find(function(a){ return a.packageName===pkg; })||{}).name || pkg; } catch(_){}
  delete S.limits[pkg]; saveS();
  nCall('removeAppLimit', pkg);
  if (typeof updateTimersSub === 'function') updateTimersSub();
  if (typeof renderTimerList === 'function') renderTimerList();
  if (typeof renderFocusStrip === 'function') renderFocusStrip();
  if (typeof FocusTimers !== 'undefined') FocusTimers.render(document.getElementById('focus-timers-wrap'));
  if (typeof toast === 'function') toast('Timer removed for ' + removedName, 'info');
}
function saveTimer(pkg) {
  // FocusTimers module has no saveTimer method — this shim is a no-op stub.
  // Timer saves are driven by _doApplyTimer() in app-panels.js.
}
function openBedtimePicker()          { if (typeof FocusBedtime !== 'undefined') FocusBedtime.openPicker(); }
function saveBedtime()                { if (typeof FocusBedtime !== 'undefined') FocusBedtime.save(); }
function openRoutinePicker(id, p)     { if (typeof FocusRoutine !== 'undefined') FocusRoutine.openRoutinePicker(id, p); }
// openTimerForApp is defined in app-panels.js — no shim needed here.