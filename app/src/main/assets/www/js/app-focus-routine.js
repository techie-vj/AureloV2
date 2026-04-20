'use strict';
/* ═══════════════════════════════════════════════════════════════
 * FOCUS ROUTINE MODULE — app-focus-routine.js
 * Phase 2 extract from app-focus.js  (patch file ELIMINATED here)
 *
 * Owns: Scheduled routines list, full-screen editor, alarm
 *       scheduling, live-tick engine, template strip.
 *
 * State (_routines) lives here; FocusTab delegates all routine
 * calls to this module.
 *
 * Public API (via FocusRoutine.*):
 *   load()               — load routines from native/localStorage
 *   render()             — renders #focus-routines-wrap
 *   getRoutines()        — returns _routines array
 *   openRoutinePicker(id,prefill) — open full-screen editor
 *   closeRoutinePicker() — close editor
 *   saveRoutine()        — save edited/new routine
 *   toggleRoutine(id)    — enable / disable a routine
 *   activateTemplate(id) — open editor pre-filled from template
 *   buildUpcomingNotice()— HTML notice for session idle state
 *   handlePickerSave()   — called from saveFocusPick when mode=routine
 * ═══════════════════════════════════════════════════════════════ */
window.FocusRoutine = (function () {

  /* ── State ───────────────────────────────────────────────────── */
  var _routines            = [];
  var _routineEditId       = null;
  var _routineTriggerQueue = [];
  var _routineTriggerPending = false;
  var _routineEndedEarly   = new Map();

  /* ── Constants ───────────────────────────────────────────────── */
  var _ROUTINE_EMOJIS = ['🌅','🌙','💼','🍃','🔥','📚','🧘','⚡','🎯','🌿'];
  var _DAY_SHORT      = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  var _DAY_FULL       = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  /* ── Time helpers ────────────────────────────────────────────── */
  function _fmt12(h) {
    var hh  = Math.floor(h);
    var mm  = Math.round((h - hh) * 60);
    var h12 = hh % 12 === 0 ? 12 : hh % 12;
    return h12 + ':' + String(mm).padStart(2, '0') + ' ' + (hh >= 12 ? 'PM' : 'AM');
  }

  function _fmt12h(h, m) {
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + String(m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function _dayLabel(days) {
    if (!days || !days.length) return 'No days';
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'Weekdays';
    if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';
    return days.map(function (d) { return _DAY_SHORT[d]; }).join(' · ');
  }

  /* ── Persistence ─────────────────────────────────────────────── */
  function load() {
    if (IS_NATIVE && typeof N.getFocusRoutines === 'function') {
      try { _routines = JSON.parse(N.getFocusRoutines() || '[]'); } catch (_) { _routines = []; }
    } else {
      try { _routines = JSON.parse(localStorage.getItem('focusRoutines') || '[]'); } catch (_) { _routines = []; }
    }
  }

  function _saveRoutines() {
    var json = JSON.stringify(_routines);
    if (IS_NATIVE && typeof N.saveFocusRoutines === 'function') {
      try { N.saveFocusRoutines(json); } catch (_) {}
    } else {
      try { localStorage.setItem('focusRoutines', json); } catch (_) {}
    }
    _routines.forEach(function (r) {
      if (!IS_NATIVE) return;
      try {
        if (r.enabled && typeof N.scheduleRoutineAlarm === 'function') N.scheduleRoutineAlarm(JSON.stringify(r));
        else if (!r.enabled && typeof N.cancelRoutineAlarm === 'function') N.cancelRoutineAlarm(r.id);
      } catch (_) {}
    });
  }

  /* ── Timer utilities ─────────────────────────────────────────── */
  function _secsUntilRoutine(r) {
    if (!r || !r.enabled) return -1;
    var days = r.days instanceof Set ? [...r.days] : (r.days || []);
    if (!days.length) return -1;
    var now      = new Date();
    var nowDay   = now.getDay();
    var nowSecs  = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    var fireSecs = r.startHour * 3600 + r.startMin * 60;
    var endSecs  = (r.endHour !== undefined) ? r.endHour * 3600 + r.endMin * 60 : fireSecs + (r.durationMins || 0) * 60;
    var ss       = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
    var _sUrSessionRunning = ss.active && ss.activeRoutineId === r.id;
    var sorted = [...days].sort(function (a, b) { return a - b; });
    var pick = sorted.find(function (d) {
      if (d > nowDay) return true;
      if (d === nowDay) {
        var crossesMidnight = endSecs < fireSecs;
        if (crossesMidnight) { if (nowSecs >= fireSecs && !_sUrSessionRunning) return false; return true; }
        if (nowSecs < fireSecs) return true;
        if (_sUrSessionRunning && nowSecs < endSecs) return true;
        return false;
      }
      return false;
    });
    if (pick === undefined) pick = sorted[0];
    if (pick === nowDay) {
      var cm = endSecs < fireSecs;
      if (!cm) {
        if (_sUrSessionRunning && nowSecs >= fireSecs && nowSecs < endSecs) return endSecs - nowSecs;
        if (nowSecs < fireSecs) return fireSecs - nowSecs;
        return 7 * 86400 - nowSecs + fireSecs;
      } else {
        if (nowSecs >= fireSecs) return (86400 - nowSecs) + endSecs;
        if (nowSecs < endSecs) return endSecs - nowSecs;
        return fireSecs - nowSecs;
      }
    }
    var daysAway = ((pick - nowDay) + 7) % 7;
    return daysAway * 86400 - nowSecs + fireSecs;
  }

  function _routineActiveStatus(r) {
    if (!r || !r.enabled) return { active: false };
    var ss = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
    if (!ss.active || ss.activeRoutineId !== r.id) return { active: false };
    var days = r.days instanceof Set ? [...r.days] : (r.days || []);
    var now  = new Date();
    var nowDay = now.getDay();
    var nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    var startSecs = r.startHour * 3600 + r.startMin * 60;
    var endSecs   = (r.endHour !== undefined) ? r.endHour * 3600 + r.endMin * 60 : startSecs + (r.durationMins || 0) * 60;
    var crossesMidnight = endSecs < startSecs;
    if (!crossesMidnight) return { active: true, remainSecs: Math.max(0, endSecs - nowSecs) };
    var prevDay = (nowDay + 6) % 7;
    if (days.includes(nowDay) && nowSecs >= startSecs) return { active: true, remainSecs: (86400 - nowSecs) + endSecs };
    if (days.includes(prevDay) && nowSecs < endSecs) return { active: true, remainSecs: Math.max(0, endSecs - nowSecs) };
    var remainSecs = ss.secs ? Math.max(0, ss.secs) : 0;
    return { active: true, remainSecs: remainSecs };
  }

  function _fmtSecs(secs, mode) {
    var pre = mode === 'until' ? 'in ' : '';
    var suf = mode === 'remain' ? ' left' : '';
    if (secs >= 3600) {
      var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
      return pre + h + 'h ' + m + 'm' + suf;
    }
    var m2 = Math.floor(secs / 60), s2 = secs % 60;
    return pre + String(m2).padStart(2,'0') + ':' + String(s2).padStart(2,'0') + suf;
  }

  function _nextFireLabel(r) {
    if (!r || !r.enabled) return 'Paused';
    var secs = _secsUntilRoutine(r);
    if (secs < 0) return 'Paused';
    if (secs < 86400) return _fmtSecs(secs, 'until');
    var days   = r.days instanceof Set ? [...r.days] : (r.days || []);
    var now    = new Date();
    var nowDay = now.getDay();
    var sorted = [...days].sort(function (a, b) { return a - b; });
    var pick = sorted.find(function (d) { return d > nowDay; });
    if (pick === undefined) pick = sorted[0];
    return _DAY_FULL[pick];
  }

  /* ── Live-tick engine ────────────────────────────────────────── */
  var _rpPills     = new Map();
  var _rpTickHandle = null;

  function _rpRegisterPill(id, getter) {
    _rpPills.set(id, getter);
    if (!_rpTickHandle) _rpTickHandle = setInterval(_rpTick, 1000);
  }

  function _rpTick() {
    var any = false;
    _rpPills.forEach(function (getter, id) {
      var el = document.getElementById(id);
      if (!el) { _rpPills.delete(id); return; }
      any = true;
      var val = getter();
      if (val !== null && el.textContent !== val) el.textContent = val;
    });
    if (!any && _rpTickHandle) { clearInterval(_rpTickHandle); _rpTickHandle = null; }
  }

  /* ── Schedule watcher (JS-side cron, fires onRoutineTriggered) ── */
  (function _startScheduleWatcher() {
    var _fired = new Set();
    function _check() {
      if (!_routines || !_routines.length) return;
      _routines.forEach(function (r) {
        if (!r.enabled) return;
        var now     = new Date();
        var nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        var days    = r.days instanceof Set ? [...r.days] : (r.days || []);
        var startSecs = r.startHour * 3600 + r.startMin * 60;
        var endSecs   = (r.endHour !== undefined) ? r.endHour * 3600 + r.endMin * 60 : startSecs + (r.durationMins || 0) * 60;
        var crossesMidnight = endSecs < startSecs;
        var nowDay  = now.getDay();
        var prevDay = (nowDay + 6) % 7;
        var inWindow;
        if (!crossesMidnight) {
          inWindow = days.includes(nowDay) && nowSecs >= startSecs && nowSecs < endSecs;
        } else {
          inWindow = (days.includes(nowDay)  && nowSecs >= startSecs)
                  || (days.includes(prevDay) && nowSecs < endSecs);
        }
        if (inWindow) {
          if (!_fired.has(r.id)) {
            _fired.add(r.id);
            if (typeof window.onRoutineTriggered === 'function') window.onRoutineTriggered(JSON.stringify(r));
            render();
          }
        } else {
          _fired.delete(r.id);
        }
      });
    }
    setTimeout(_check, 500);
    setInterval(_check, 10000);
  })();

  /* ── Trigger handler ─────────────────────────────────────────── */
  window.onRoutineTriggered = function (routineJson) {
    if (_routineTriggerPending) { _routineTriggerQueue.push(routineJson); return; }
    _autoStartRoutine(routineJson);
  };

  function _autoStartRoutine(routineJson) {
    try {
      var r = JSON.parse(routineJson || '{}');
      if (!r.id) { _drainQueue(); return; }
      load();
      var live = _routines.find(function (x) { return x.id === r.id; });
      if (!live || !live.enabled) { _drainQueue(); return; }
      var ss = typeof FocusTab !== 'undefined' ? FocusTab.getSessionState() : {};
      if (ss.active) { _drainQueue(); return; }
      _routineTriggerPending = true;
      if (typeof FocusTab !== 'undefined') {
        FocusTab.setDifficulty(live.difficulty);
        FocusTab.setSelectedFocusDur(live.durationMins);
        if (live.blockedApps && live.blockedApps.length) {
          FocusTab.setBlockedApps(live.blockedApps);
        }
        FocusTab.doStartFocusSession(r.id);
      }
      var diff = (typeof FOCUS_DIFF !== 'undefined' && FOCUS_DIFF[live.difficulty]) || { label: '🎯 Gentle' };
      if (typeof toast === 'function') toast((live.emoji || '⏰') + ' ' + live.name + ' started · ' + diff.label, 'success', 3500);
      _routineTriggerPending = false;
      _drainQueue();
    } catch (e) {
      console.error('_autoStartRoutine error', e);
      _routineTriggerPending = false;
      _drainQueue();
    }
  }

  function _drainQueue() {
    if (!_routineTriggerQueue.length) return;
    var next = _routineTriggerQueue.shift();
    setTimeout(function () { _autoStartRoutine(next); }, 400);
  }

  /* ── Upcoming routine notice (for session idle state) ────────── */
  function buildUpcomingNotice() {
    if (!_routines || !_routines.length) return '';
    var now     = new Date();
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var nowDay  = now.getDay();
    var soon = _routines.find(function (r) {
      if (!r.enabled) return false;
      if (!r.days.includes(nowDay)) return false;
      var fireMins = r.startHour * 60 + r.startMin;
      var delta    = fireMins - nowMins;
      return delta > 0 && delta <= 30;
    });
    if (!soon) return '';
    var fireMins  = soon.startHour * 60 + soon.startMin;
    var minsAway  = fireMins - nowMins;
    var timeLabel = minsAway === 1 ? 'in 1 min' : 'in ' + minsAway + ' min';
    var diff      = (typeof FOCUS_DIFF !== 'undefined' && FOCUS_DIFF[soon.difficulty]) || FOCUS_DIFF.gentle;
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:10px 13px;' +
      'border-radius:12px;background:rgba(247,166,35,.08);border:1px solid rgba(247,166,35,.2)">' +
      '<div style="font-size:16px;flex-shrink:0">' + (soon.emoji || '⏰') + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--a)">' + soon.name + ' starts ' + timeLabel + '</div>' +
        '<div style="font-family:var(--ff-m);font-size:9px;color:var(--t3);margin-top:1px">Starting now will skip it · ' + diff.label + ' · ' + _fmtCustomDur(soon.durationMins) + '</div>' +
      '</div></div>';
  }

  function _fmtCustomDur(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h === 0) return m + 'm';
    if (m === 0) return h + 'h';
    return h + 'h ' + m + 'm';
  }

  /* ── CSS (injected once) ─────────────────────────────────────── */
  (function _injectCSS() {
    if (document.getElementById('_sp-css')) return;
    var s = document.createElement('style');
    s.id = '_sp-css';
    s.textContent = `
      #rp-page {
        position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:900;
        background:var(--bg,#0a0a14);transform:translateX(100%);
        overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
        overscroll-behavior:contain;display:none;
      }
      #rp-time-picker-overlay {
        display:none;position:fixed;inset:0;z-index:1200;
        background:rgba(0,0,0,.6);align-items:flex-end;
      }
      #rp-time-picker-sheet {
        background:var(--s1);border-radius:24px 24px 0 0;width:100%;
        transform:translateY(100%);transition:transform .28s cubic-bezier(.32,1,.45,1);
      }
      ._rp-lbl{font-family:var(--ff-m);font-size:10px;color:var(--t3);
        text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px;display:block;}
      ._rp-card{background:var(--s2);border:1px solid var(--border2);
        border-radius:18px;padding:14px;margin-bottom:10px;}
      ._rp-time-btn{flex:1;display:flex;align-items:center;justify-content:center;
        gap:3px;padding:9px 6px;border-radius:12px;background:var(--s3);
        border:1px solid var(--border2);cursor:pointer;transition:background .15s,border-color .15s;}
      ._rp-time-btn:active{background:var(--s1);}
      ._rp-grid-cell{padding:9px 4px;border-radius:11px;text-align:center;cursor:pointer;
        font-family:var(--ff-m);background:var(--s3);color:var(--t2);
        transition:background .1s,color .1s;-webkit-tap-highlight-color:transparent;}
      ._rp-grid-cell.on{background:var(--p)!important;color:#fff!important;}
      ._rp-preset-pill{padding:4px 10px;border-radius:99px;cursor:pointer;
        font-family:var(--ff-m);font-size:10px;font-weight:600;
        transition:background .12s,color .12s;background:var(--s3);color:var(--t3);
        -webkit-tap-highlight-color:transparent;user-select:none;}
      ._rp-preset-pill.on{background:var(--p)!important;color:#fff!important;}
      @keyframes _rp-pulse{0%,100%{opacity:1}50%{opacity:.55}}
      @keyframes _rp-shake{
        0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}
        40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}
      }
    `;
    document.head.appendChild(s);
  })();

  /* ── Template strip ──────────────────────────────────────────── */
  var FOCUS_SCHEDULE_TEMPLATES = [
    { id:'tpl_morning',  emoji:'🌅', name:'Morning Focus',  days:[1,2,3,4,5], startHour:8,  startMin:0, durationMins:60,  difficulty:'firm',  categoryNames:['Social','Entertainment','Social & Communication','Entertainment & Video'] },
    { id:'tpl_deepwork', emoji:'💼', name:'Deep Work',      days:[1,2,3,4,5], startHour:14, startMin:0, durationMins:90,  difficulty:'deep',  categoryNames:['Social','Gaming','Entertainment','Social & Communication','Entertainment & Video'] },
    { id:'tpl_winddown', emoji:'🌙', name:'Wind Down',      days:[0,1,2,3,4,5,6], startHour:21, startMin:0, durationMins:60, difficulty:'firm', categoryNames:['Social','Gaming','Social & Communication'] },
    { id:'tpl_study',    emoji:'🎓', name:'Study Block',    days:[1,2,3,4,5], startHour:16, startMin:0, durationMins:45,  difficulty:'deep',  categoryNames:['Social','Gaming','Entertainment','Social & Communication','Entertainment & Video'] },
  ];

  function _resolveTemplateApps(tpl) {
    var apps = [], seen = new Set();
    tpl.categoryNames.forEach(function (catName) {
      var catApps = CATS_MAP[catName] || [];
      catApps.forEach(function (a) {
        if (!seen.has(a.packageName)) { seen.add(a.packageName); apps.push({ packageName: a.packageName, name: a.name }); }
      });
    });
    return apps;
  }

  function activateTemplate(tplId) {
    var tpl = FOCUS_SCHEDULE_TEMPLATES.find(function (t) { return t.id === tplId; });
    if (!tpl) return;
    if (!ProTier.isPro) { ProTier.triggerUpsell('FOCUS_SCHEDULE'); return; }
    var resolvedApps = _resolveTemplateApps(tpl);
    var endTotal = tpl.startHour * 60 + tpl.startMin + tpl.durationMins;
    openRoutinePicker(null, {
      name: tpl.name, emoji: tpl.emoji, difficulty: tpl.difficulty,
      days: tpl.days, startHour: tpl.startHour, startMin: tpl.startMin,
      durationMins: tpl.durationMins, blockedApps: resolvedApps, templateId: tpl.id,
    });
  }

  function _buildTemplateStrip() {
    var usedTemplateIds = new Set(_routines.map(function (r) { return r.templateId; }).filter(Boolean));
    var unused = FOCUS_SCHEDULE_TEMPLATES.filter(function (t) { return !usedTemplateIds.has(t.id); });
    if (!unused.length) return '';
    function _tplDayLabel(days) {
      var sorted = [...days].sort(function (a,b){return a-b;}).join(',');
      if (sorted === '1,2,3,4,5') return 'Weekdays';
      if (sorted === '0,6') return 'Weekends';
      if (sorted === '0,1,2,3,4,5,6') return 'Every day';
      return days.map(function (d) { return _DAY_SHORT[d]; }).join(' · ');
    }
    return '<div style="margin-bottom:14px">' +
      '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">Quick Start Templates</div>' +
      '<div style="display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px">' +
        unused.map(function (tpl) {
          var endTotal = tpl.startHour * 60 + tpl.startMin + tpl.durationMins;
          var endH = Math.floor(endTotal / 60) % 24, endM = endTotal % 60;
          return '<div onclick="FocusRoutine.activateTemplate(\'' + tpl.id + '\')"' +
            ' style="flex-shrink:0;width:160px;background:var(--s2);border:1px solid var(--border2);border-radius:16px;padding:14px 12px;cursor:pointer">' +
            '<div style="font-size:22px;margin-bottom:6px">' + tpl.emoji + '</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:5px">' + escHtml(tpl.name) + '</div>' +
            '<div style="font-family:var(--ff-m);font-size:11px;font-weight:600;color:var(--t2);margin-bottom:2px">' + _fmt12h(tpl.startHour, tpl.startMin) + ' – ' + _fmt12h(endH, endM) + '</div>' +
            '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);margin-bottom:8px">' + _tplDayLabel(tpl.days) + '</div>' +
            '<div style="font-family:var(--ff-m);font-size:10px;color:var(--p);font-weight:700">Use template →</div>' +
            '</div>';
        }).join('') +
      '</div></div>';
  }

  /* ── Routine list renderer ───────────────────────────────────── */
  function render() {
    var el = document.getElementById('focus-routines-wrap');
    if (!el) return;
    load();

    if (!ProTier.canAccess('FOCUS_SCHEDULE')) {
      el.innerHTML = '';
      ProTier.applyTeaser(el, 'FOCUS_SCHEDULE', '📅', 'Scheduled Routines', 'Auto-start focus sessions on a repeating schedule');
      return;
    }

    if (!_routines.length) {
      el.innerHTML = _buildTemplateStrip() +
        '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:20px;padding:16px 18px;display:flex;align-items:center;gap:14px">' +
          '<div style="width:44px;height:44px;border-radius:14px;flex-shrink:0;background:rgba(108,99,255,.1);border:1px solid rgba(108,99,255,.2);display:flex;align-items:center;justify-content:center;font-size:20px">📅</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:2px">Scheduled Routines</div>' +
            '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);line-height:1.5">Auto-start focus sessions on a repeating schedule</div>' +
          '</div>' +
          '<div onclick="FocusRoutine.openRoutinePicker(null)"' +
            ' style="padding:8px 14px;border-radius:99px;flex-shrink:0;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.25);font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--p);cursor:pointer;white-space:nowrap">＋ Add</div>' +
        '</div>';
      return;
    }

    function _endFrom(r) {
      if (r.endHour !== undefined && r.endMin !== undefined) return { h: r.endHour, m: r.endMin };
      var t = r.startHour * 60 + r.startMin + (r.durationMins || 0);
      return { h: Math.floor(t / 60) % 24, m: t % 60 };
    }

    function row(r, isLast) {
      var diff   = (typeof FOCUS_DIFF !== 'undefined' && FOCUS_DIFF[r.difficulty]) || { color:'var(--p)', label:'🎯 Gentle' };
      var start  = _fmt12h(r.startHour, r.startMin);
      var end    = _endFrom(r);
      var endStr = _fmt12h(end.h, end.m);
      var dayStr = _dayLabel(r.days);
      var st     = _routineActiveStatus(r);
      var appIcons = (r.blockedApps || []).slice(0,4).map(function (a) {
        return '<div style="width:20px;height:20px;border-radius:6px;overflow:hidden;background:var(--s3);flex-shrink:0">' + appIco(a.packageName, 20, 4) + '</div>';
      }).join('');
      var appMore = (r.blockedApps||[]).length > 4 ? '<span style="font-family:var(--ff-m);font-size:9px;color:var(--t3)">+' + (r.blockedApps.length-4) + '</span>' : '';
      var endedEarly = _routineEndedEarly.has(r.id);
      var pillCol, pillText;
      if (!r.enabled)      { pillCol='var(--t3)'; pillText='Paused'; }
      else if (endedEarly) { pillCol='var(--a)';  pillText='⏹ Ended early'; }
      else if (st.active)  { pillCol='var(--p)';  pillText='🟢 ' + _fmtSecs(st.remainSecs,'remain'); }
      else {
        var secs = _secsUntilRoutine(r);
        pillCol  = (secs >= 0 && secs < 3600) ? 'var(--a)' : 'var(--g)';
        pillText = secs >= 0 && secs < 86400 ? '⏰ ' + _fmtSecs(secs,'until') : '⏰ ' + _nextFireLabel(r);
      }
      var pillId = 'rp-row-pill-' + r.id;
      return '<div onclick="FocusRoutine.openRoutinePicker(\'' + r.id + '\')"' +
        ' style="display:flex;align-items:center;gap:12px;padding:12px 0;' +
        (st.active ? 'box-shadow:0 0 0 2px rgba(108,99,255,.25);border-radius:12px;padding:12px 8px;' : '') +
        (isLast ? '' : 'border-bottom:1px solid var(--border);') +
        'cursor:pointer;opacity:' + (r.enabled ? '1' : '0.5') + ';transition:opacity .2s">' +
        '<div style="width:42px;height:42px;border-radius:13px;flex-shrink:0;background:' + diff.color + '18;border:1px solid ' + diff.color + '30;display:flex;align-items:center;justify-content:center;font-size:21px">' + (r.emoji||'🎯') + '</div>' +
        '<div style="flex:1;min-width:0;overflow:hidden">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
            '<span style="font-size:13px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + r.name + '</span>' +
            (st.active && !endedEarly ? '<span style="font-family:var(--ff-m);font-size:8px;padding:1px 7px;border-radius:99px;background:var(--p);color:#fff;flex-shrink:0;animation:_rp-pulse 1.4s ease-in-out infinite">ACTIVE</span>'
              : endedEarly ? '<span style="font-family:var(--ff-m);font-size:8px;padding:1px 6px;border-radius:99px;background:rgba(247,166,35,.15);color:var(--a);flex-shrink:0">ENDED EARLY</span>'
              : !r.enabled ? '<span style="font-family:var(--ff-m);font-size:8px;padding:1px 6px;border-radius:99px;background:var(--s3);color:var(--t3);flex-shrink:0">PAUSED</span>'
              : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:4px">' +
            '<span style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:var(--t1)">' + start + '</span>' +
            '<span style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">→</span>' +
            '<span style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:var(--t1)">' + endStr + '</span>' +
            '<span style="font-family:var(--ff-m);font-size:10px;color:var(--border2)">·</span>' +
            '<span style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">' + dayStr + '</span>' +
            '<span style="font-family:var(--ff-m);font-size:10px;color:var(--border2)">·</span>' +
            '<span style="font-family:var(--ff-m);font-size:10px;color:' + diff.color + '">' + diff.label.split(' ').slice(1).join(' ') + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:4px">' +
            appIcons + appMore +
            '<span id="' + pillId + '" style="font-family:var(--ff-m);font-size:9px;margin-left:auto;padding:2px 7px;border-radius:99px;white-space:nowrap;flex-shrink:0;background:' + (r.enabled ? pillCol + '18' : 'var(--s3)') + ';color:' + pillCol + '">' + pillText + '</span>' +
          '</div>' +
        '</div>' +
        (st.active && !endedEarly
          ? '<div style="flex-shrink:0;opacity:0.35;cursor:not-allowed" title="End the active session first" onclick="event.stopPropagation();toast(\'End the active session first\',\'warn\')">' +
            '<div class="tog on" style="pointer-events:none"><div class="tog-knob"></div></div></div>'
          : '<div onclick="event.stopPropagation();FocusRoutine.toggleRoutine(\'' + r.id + '\')" class="tog ' + (r.enabled ? 'on' : 'off') + '" style="flex-shrink:0"><div class="tog-knob"></div></div>'
        ) +
        '</div>';
    }

    var nowDay  = new Date().getDay();
    var nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    var activeCount = _routines.filter(function (r) {
      if (!r.enabled) return false;
      var fireMins = r.startHour * 60 + r.startMin;
      return r.days.some(function (d) { return d !== nowDay || fireMins > nowMins; });
    }).length;

    el.innerHTML = _buildTemplateStrip() +
      '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:20px;padding:14px 16px 6px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<div>' +
            '<div style="font-size:14px;font-weight:700;color:var(--t1)">Scheduled Routines</div>' +
            '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);margin-top:1px">' + activeCount + ' active · tap any to edit</div>' +
          '</div>' +
          '<div onclick="FocusRoutine.openRoutinePicker(null)"' +
            ' style="padding:7px 13px;border-radius:99px;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.22);font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--p);cursor:pointer;white-space:nowrap">＋ Add</div>' +
        '</div>' +
        _routines.map(function (r, i) { return row(r, i === _routines.length - 1); }).join('') +
      '</div>';

    _routines.forEach(function (r) {
      if (!r.enabled) return;
      _rpRegisterPill('rp-row-pill-' + r.id, function () {
        if (_routineEndedEarly.has(r.id)) return '⏹ Ended early';
        var s = _routineActiveStatus(r);
        if (s.active) return '🟢 ' + _fmtSecs(s.remainSecs, 'remain');
        var secs = _secsUntilRoutine(r);
        if (secs < 0) return 'Paused';
        if (secs >= 86400) return '⏰ ' + _nextFireLabel(r);
        return '⏰ ' + _fmtSecs(secs, 'until');
      });
    });
  }

  /* ── toggleRoutine ────────────────────────────────────────────── */
  function toggleRoutine(id) {
    var r = _routines.find(function (r) { return r.id === id; });
    if (!r) return;
    r.enabled = !r.enabled;
    _saveRoutines();
    render();
    toast(r.enabled ? '✓ Schedule enabled' : 'Schedule paused', 'info');
  }

  /* ── Full-screen editor ──────────────────────────────────────── */
  function _rpGetOrCreatePage() {
    var p = document.getElementById('rp-page');
    if (!p) { p = document.createElement('div'); p.id = 'rp-page'; document.body.appendChild(p); }
    return p;
  }

  function openRoutinePicker(editId, prefill) {
    if (!ProTier.canAccess('FOCUS_SCHEDULE')) { ProTier.triggerUpsell('FOCUS_SCHEDULE'); return; }
    _routineEditId = editId || null;
    var existing = prefill || (editId ? _routines.find(function (r) { return r.id === editId; }) : null);
    var defEndHour = 10, defEndMin = 0;
    if (existing) {
      if (existing.endHour !== undefined) { defEndHour = existing.endHour; defEndMin = existing.endMin; }
      else { var t = existing.startHour*60+existing.startMin+(existing.durationMins||0); defEndHour=Math.floor(t/60)%24; defEndMin=t%60; }
    }
    window._rp = {
      name: existing?.name || '', emoji: existing?.emoji || '🎯',
      difficulty: existing?.difficulty || 'gentle',
      days: new Set(existing?.days || [1,2,3,4,5]),
      startHour: existing?.startHour ?? 9, startMin: existing?.startMin ?? 0,
      endHour: defEndHour, endMin: defEndMin,
      blockedApps: existing?.blockedApps ? [...existing.blockedApps] : [],
      templateId: existing?.templateId || null,
    };
    var rp   = window._rp;
    var page = _rpGetOrCreatePage();

    function _dayBtns() {
      return _DAY_SHORT.map(function (d, i) {
        var on = rp.days.has(i);
        return '<div id="rp-day-' + i + '" onclick="FocusRoutine._rpToggleDay(' + i + ')"' +
          ' style="flex:1;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-family:var(--ff-m);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;background:' + (on?'var(--p)':'var(--s3)') + ';color:' + (on?'#fff':'var(--t3)') + '">' + d + '</div>';
      }).join('');
    }
    function _presetPills() {
      var P = [{id:'wd',label:'Weekdays',days:[1,2,3,4,5]},{id:'we',label:'Weekends',days:[0,6]},{id:'ed',label:'Every day',days:[0,1,2,3,4,5,6]}];
      var cur = [...rp.days].sort(function(a,b){return a-b;}).join(',');
      return P.map(function (p) {
        var on = cur === [...p.days].sort(function(a,b){return a-b;}).join(',');
        return '<div id="rp-preset-' + p.id + '" class="_rp-preset-pill' + (on?' on':'') + '" onclick="FocusRoutine._rpPresetDays([' + p.days.join(',') + '])">' + p.label + '</div>';
      }).join('');
    }
    function _timeBtn(idP, h, m) {
      var ampm=h>=12?'PM':'AM', h12=h%12===0?12:h%12;
      return '<div onclick="FocusRoutine._rpOpenTimePicker(\'' + idP + '\')" class="_rp-time-btn" id="' + idP + '-display">' +
        '<span style="font-family:var(--ff-d);font-size:18px;font-weight:700;color:var(--t1);letter-spacing:-0.5px">' + String(h12).padStart(2,'0') + ':' + String(m).padStart(2,'0') + '</span>' +
        '<span style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:var(--t3);margin-left:2px">' + ampm + '</span>' +
      '</div>';
    }
    function _diffPills() {
      if (typeof FOCUS_DIFF==='undefined') return '';
      return Object.entries(FOCUS_DIFF).map(function ([key, meta]) {
        var on=rp.difficulty===key, icon=meta.label.split(' ')[0], lbl=meta.label.split(' ').slice(1).join(' ');
        return '<div id="rp-diff-' + key + '" onclick="FocusRoutine._rpSetDiff(\'' + key + '\')"' +
          ' style="flex:1;padding:10px 4px;border-radius:12px;text-align:center;cursor:pointer;transition:all .15s;background:' + (on?meta.color+'1a':'var(--s3)') + ';border:2px solid ' + (on?meta.color:'transparent') + '">' +
          '<div style="font-size:15px;margin-bottom:2px">' + icon + '</div>' +
          '<div style="font-family:var(--ff-m);font-size:9px;font-weight:700;color:' + (on?meta.color:'var(--t3)') + '"> ' + lbl + '</div></div>';
      }).join('');
    }
    function _appChips() {
      var chips = (rp.blockedApps||[]).slice(0,5).map(function (a) {
        return '<div class="focus-app-chip blocked">' +
          '<div class="focus-chip-ico">' + appIco(a.packageName,18,4) + '</div>' +
          '<span>' + escHtml(a.name.split(' ')[0]) + '</span>' +
          '<span onclick="event.stopPropagation();FocusRoutine._rpRemoveApp(\'' + escAttr(a.packageName) + '\')" style="opacity:.45;font-size:12px;margin-left:2px;cursor:pointer">×</span>' +
        '</div>';
      }).join('');
      var more = (rp.blockedApps||[]).length>5 ? '<div class="focus-app-chip" style="background:var(--s2);border-color:var(--border2);color:var(--t3);font-family:var(--ff-m);font-size:10px;cursor:default">+' + (rp.blockedApps.length-5) + '</div>' : '';
      return chips + more + '<div class="focus-chip-add" onclick="FocusRoutine._rpOpenAppPicker()">＋ Add app</div>';
    }

    page.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;padding:max(env(safe-area-inset-top),16px) 16px 14px;position:sticky;top:0;z-index:10;background:var(--bg,var(--s1));border-bottom:1px solid var(--border)">' +
        '<div onclick="FocusRoutine.closeRoutinePicker()" style="width:36px;height:36px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--s3);cursor:pointer">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
        '</div>' +
        '<div style="flex:1;font-family:var(--ff-d);font-size:17px;font-weight:700;color:var(--t1)">' + (editId ? 'Edit Schedule' : 'New Schedule') + '</div>' +
        (editId ? '<div onclick="FocusRoutine._rpDelete(\'' + editId + '\')" style="font-family:var(--ff-m);font-size:12px;color:var(--r);cursor:pointer;padding:6px 10px">Delete</div>' : '') +
      '</div>' +
      '<div style="padding:12px 16px 40px">' +
        '<div class="_rp-card" style="display:flex;align-items:center;gap:12px;padding:10px 12px">' +
          '<div onclick="FocusRoutine._rpCycleEmoji()" id="rp-emoji-display"' +
            ' style="width:44px;height:44px;border-radius:13px;flex-shrink:0;background:var(--s3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;user-select:none">' + rp.emoji + '</div>' +
          '<input id="rp-name-input" value="' + escAttr(rp.name) + '" placeholder="Schedule name…" oninput="window._rp.name=this.value"' +
            ' style="flex:1;padding:0;border:none;background:transparent;color:var(--t1);font-size:15px;font-weight:600;outline:none;-webkit-appearance:none">' +
        '</div>' +
        '<div class="_rp-card" style="padding:12px 14px">' +
          '<span class="_rp-lbl">Time</span>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            _timeBtn('rp-start', rp.startHour, rp.startMin) +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
            _timeBtn('rp-end', rp.endHour, rp.endMin) +
          '</div>' +
        '</div>' +
        '<div class="_rp-card" style="padding:12px 14px">' +
          '<span class="_rp-lbl">On these days</span>' +
          '<div style="display:flex;gap:5px;margin-bottom:8px" id="rp-preset-pills">' + _presetPills() + '</div>' +
          '<div id="rp-day-btns" style="display:flex;gap:4px">' + _dayBtns() + '</div>' +
        '</div>' +
        '<div class="_rp-card" style="padding:12px 14px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">' +
            '<span class="_rp-lbl" style="margin:0">Apps Blocked</span>' +
            '<span style="font-family:var(--ff-m);font-size:9px;color:var(--t3);opacity:.7">Independent from session</span>' +
          '</div>' +
          '<div id="rp-app-chips" style="display:flex;gap:7px;flex-wrap:wrap">' + _appChips() + '</div>' +
        '</div>' +
        '<div class="_rp-card" style="padding:12px 14px">' +
          '<span class="_rp-lbl">Difficulty</span>' +
          '<div style="display:flex;gap:8px" id="rp-diff-pills">' + _diffPills() + '</div>' +
          '<div id="rp-diff-desc" style="font-family:var(--ff-m);font-size:10px;color:var(--t3);margin-top:9px;line-height:1.5">' +
            (typeof FOCUS_DIFF !== 'undefined' && FOCUS_DIFF[rp.difficulty] ? FOCUS_DIFF[rp.difficulty].desc : '') +
          '</div>' +
        '</div>' +
        '<button type="button" onclick="FocusRoutine.saveRoutine()" style="width:100%;padding:15px;border-radius:16px;border:none;background:#fff;color:#000;font-family:var(--ff-d);font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.2px">' +
          (editId ? 'Save Changes' : 'Start Schedule') + ' →' +
        '</button>' +
      '</div>' +
      // Time picker overlay
      '<div id="rp-time-picker-overlay" onclick="if(event.target===this)FocusRoutine._rpCloseTimePicker()"' +
        ' style="display:none;position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.6);align-items:flex-end">' +
        '<div id="rp-time-picker-sheet"' +
          ' style="background:var(--s1);border-radius:24px 24px 0 0;width:100%;transform:translateY(100%);transition:transform .28s cubic-bezier(.32,1,.45,1)">' +
          '<div style="width:36px;height:4px;border-radius:2px;background:var(--border2);margin:14px auto 0"></div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 6px">' +
            '<div style="font-family:var(--ff-d);font-size:15px;font-weight:700;color:var(--t1)" id="rp-picker-title">Start Time</div>' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<div style="display:flex;background:var(--s3);border-radius:10px;border:1px solid var(--border2);overflow:hidden">' +
                '<div id="rp-picker-am" onclick="FocusRoutine._rpPickerSetAmPm(\'AM\')" style="padding:6px 14px;font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer;transition:all .12s;background:var(--p);color:#fff">AM</div>' +
                '<div id="rp-picker-pm" onclick="FocusRoutine._rpPickerSetAmPm(\'PM\')" style="padding:6px 14px;font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer;transition:all .12s;background:transparent;color:var(--t3)">PM</div>' +
              '</div>' +
              '<div onclick="FocusRoutine._rpCloseTimePicker()" style="font-family:var(--ff-m);font-size:13px;font-weight:700;color:var(--p);cursor:pointer;padding:4px 4px 4px 0">Done</div>' +
            '</div>' +
          '</div>' +
          '<div id="rp-picker-display" style="text-align:center;font-family:var(--ff-d);font-size:36px;font-weight:700;color:var(--t1);letter-spacing:-1.5px;padding:4px 16px 10px;line-height:1.1"></div>' +
          '<div style="padding:0 12px 6px">' +
            '<div style="font-family:var(--ff-m);font-size:9px;color:var(--t3);letter-spacing:.8px;margin-bottom:6px">HOUR</div>' +
            '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px" id="rp-picker-hours"></div>' +
          '</div>' +
          '<div style="padding:6px 12px 12px">' +
            '<div style="font-family:var(--ff-m);font-size:9px;color:var(--t3);letter-spacing:.8px;margin-bottom:6px">MINUTE</div>' +
            '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px" id="rp-picker-mins"></div>' +
          '</div>' +
          '<div style="height:max(env(safe-area-inset-bottom),16px)"></div>' +
        '</div>' +
      '</div>';

    page.scrollTop = 0;
    page.style.display    = 'block';
    page.style.transition = 'none';
    page.style.transform  = 'translateX(100%)';
    document.body.style.overflow = 'hidden';
    document.getElementById('screen-focus')?.style.setProperty('visibility','hidden');
    document.querySelector('.bottom-nav')?.style.setProperty('visibility','hidden');
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      page.style.transition = 'transform .3s cubic-bezier(.32,1,.45,1)';
      page.style.transform  = 'translateX(0)';
      setTimeout(function () { page.style.minHeight='100.001vh'; requestAnimationFrame(function(){page.style.minHeight='';});}, 320);
    });});
  }

  function closeRoutinePicker() {
    var page = document.getElementById('rp-page');
    document.getElementById('screen-focus')?.style.removeProperty('visibility');
    document.querySelector('.bottom-nav')?.style.removeProperty('visibility');
    if (!page) return;
    page.style.transition = 'transform .3s cubic-bezier(.32,1,.45,1)';
    page.style.transform  = 'translateX(100%)';
    setTimeout(function () { page.style.display='none'; page.scrollTop=0; document.body.style.overflow=''; }, 310);
  }

  /* ── Day / preset / diff controls ────────────────────────────── */
  function _rpToggleDay(dayIdx) {
    var rp = window._rp; if (!rp) return;
    if (rp.days.has(dayIdx)) rp.days.delete(dayIdx); else rp.days.add(dayIdx);
    var btn = document.getElementById('rp-day-' + dayIdx);
    if (btn) { btn.style.background=rp.days.has(dayIdx)?'var(--p)':'var(--s3)'; btn.style.color=rp.days.has(dayIdx)?'#fff':'var(--t3)'; }
    _rpRefreshPresetPills();
  }
  function _rpPresetDays(daysArr) {
    var rp = window._rp; if (!rp) return;
    rp.days = new Set(daysArr);
    for (var i=0;i<7;i++) { var btn=document.getElementById('rp-day-'+i); if(!btn)continue; btn.style.background=rp.days.has(i)?'var(--p)':'var(--s3)'; btn.style.color=rp.days.has(i)?'#fff':'var(--t3)'; }
    _rpRefreshPresetPills();
  }
  function _rpRefreshPresetPills() {
    var rp = window._rp; if (!rp) return;
    var cur = [...rp.days].sort(function(a,b){return a-b;}).join(',');
    [{id:'wd',days:[1,2,3,4,5]},{id:'we',days:[0,6]},{id:'ed',days:[0,1,2,3,4,5,6]}].forEach(function (p) {
      var el=document.getElementById('rp-preset-'+p.id); if(!el)return;
      el.classList.toggle('on', cur === [...p.days].sort(function(a,b){return a-b;}).join(','));
    });
  }
  function _rpSetDiff(key) {
    var rp=window._rp; if(!rp) return;
    rp.difficulty=key;
    if(typeof FOCUS_DIFF==='undefined') return;
    Object.keys(FOCUS_DIFF).forEach(function (k) {
      var el=document.getElementById('rp-diff-'+k); if(!el) return;
      var meta=FOCUS_DIFF[k], on=(k===key);
      el.style.background=on?meta.color+'1a':'var(--s3)'; el.style.border='2px solid '+(on?meta.color:'transparent');
      var lbl=el.querySelector('div:last-child'); if(lbl) lbl.style.color=on?meta.color:'var(--t3)';
    });
    var desc=document.getElementById('rp-diff-desc');
    if(desc&&FOCUS_DIFF[key]) desc.textContent=FOCUS_DIFF[key].desc;
  }
  function _rpCycleEmoji() {
    var rp=window._rp; if(!rp) return;
    var idx=(_ROUTINE_EMOJIS.indexOf(rp.emoji)+1)%_ROUTINE_EMOJIS.length;
    rp.emoji=_ROUTINE_EMOJIS[idx];
    var el=document.getElementById('rp-emoji-display'); if(el) el.textContent=rp.emoji;
  }
  function _rpRemoveApp(pkg) {
    var rp=window._rp; if(!rp) return;
    rp.blockedApps=(rp.blockedApps||[]).filter(function (a){return a.packageName!==pkg;});
    _rpRefreshAppChips();
  }
  function _rpRefreshAppChips() {
    var rp=window._rp; if(!rp) return;
    var chips=document.getElementById('rp-app-chips'); if(!chips) return;
    var arr=(rp.blockedApps||[]);
    var html=arr.slice(0,5).map(function (a) {
      return '<div class="focus-app-chip blocked"><div class="focus-chip-ico">' + appIco(a.packageName,18,4) + '</div>' +
        '<span>' + escHtml(a.name.split(' ')[0]) + '</span>' +
        '<span onclick="event.stopPropagation();FocusRoutine._rpRemoveApp(\'' + escAttr(a.packageName) + '\')" style="opacity:.45;font-size:12px;margin-left:2px;cursor:pointer">×</span></div>';
    }).join('');
    var more=arr.length>5?'<div class="focus-app-chip" style="background:var(--s2);border-color:var(--border2);color:var(--t3);font-family:var(--ff-m);font-size:10px;cursor:default">+' + (arr.length-5) + '</div>':'';
    chips.innerHTML=html+more+'<div class="focus-chip-add" onclick="FocusRoutine._rpOpenAppPicker()">＋ Add app</div>';
  }

  /* ── Time picker ─────────────────────────────────────────────── */
  var _rpPickerTarget='start', _rpPickerHour=12, _rpPickerMin=0, _rpPickerPeriod='AM';
  function _rpOpenTimePicker(prefix) {
    _rpPickerTarget=prefix==='rp-start'?'start':'end';
    var rp=window._rp; if(!rp) return;
    var hour=(_rpPickerTarget==='start'?rp.startHour:rp.endHour)??9;
    var min =(_rpPickerTarget==='start'?rp.startMin :rp.endMin )??0;
    _rpPickerPeriod=hour>=12?'PM':'AM'; _rpPickerHour=hour%12===0?12:hour%12;
    _rpPickerMin=Math.round(min/5)*5; if(_rpPickerMin>=60)_rpPickerMin=55;
    var overlay=document.getElementById('rp-time-picker-overlay');
    var sheet=document.getElementById('rp-time-picker-sheet');
    var title=document.getElementById('rp-picker-title');
    if(!overlay||!sheet) return;
    if(title) title.textContent=_rpPickerTarget==='start'?'Start Time':'End Time';
    var hGrid=document.getElementById('rp-picker-hours');
    if(hGrid) hGrid.innerHTML=Array.from({length:12},function(_,i){var h=i+1;return'<div class="_rp-grid-cell" onclick="FocusRoutine._rpPickerSetHour('+h+')" id="rp-ph-'+h+'" style="font-size:16px;font-weight:700">'+h+'</div>';}).join('');
    var mGrid=document.getElementById('rp-picker-mins');
    if(mGrid) mGrid.innerHTML=Array.from({length:12},function(_,i){var m=i*5;return'<div class="_rp-grid-cell" onclick="FocusRoutine._rpPickerSetMin('+m+')" id="rp-pm-'+m+'" style="font-size:14px;font-weight:700">:'+String(m).padStart(2,'0')+'</div>';}).join('');
    overlay.style.display='flex';
    requestAnimationFrame(function(){requestAnimationFrame(function(){ sheet.style.transform='translateY(0)'; });});
    _rpPickerRefreshAll();
  }
  function _rpCloseTimePicker() {
    var sheet=document.getElementById('rp-time-picker-sheet');
    var overlay=document.getElementById('rp-time-picker-overlay');
    if(!sheet||!overlay) return;
    sheet.style.transform='translateY(100%)';
    setTimeout(function(){overlay.style.display='none';},280);
    if(!window._rp||!_rpPickerTarget) return;
    var h24=_rpPickerPeriod==='AM'?(_rpPickerHour===12?0:_rpPickerHour):(_rpPickerHour===12?12:_rpPickerHour+12);
    if(_rpPickerTarget==='start'){window._rp.startHour=h24;window._rp.startMin=_rpPickerMin;}
    else{window._rp.endHour=h24;window._rp.endMin=_rpPickerMin;}
    _rpRefreshTimeDisplays();
  }
  function _rpPickerSetHour(h){_rpPickerHour=h;_rpPickerRefreshAll();}
  function _rpPickerSetMin(m){_rpPickerMin=m;_rpPickerRefreshAll();}
  function _rpPickerSetAmPm(p){_rpPickerPeriod=p;_rpPickerRefreshAll();}
  function _rpPickerRefreshAll() {
    for(var h=1;h<=12;h++){var e=document.getElementById('rp-ph-'+h);if(e)e.classList.toggle('on',h===_rpPickerHour);}
    for(var i=0;i<12;i++){var m=i*5,e2=document.getElementById('rp-pm-'+m);if(e2)e2.classList.toggle('on',m===_rpPickerMin);}
    var isAM=_rpPickerPeriod==='AM';
    var am=document.getElementById('rp-picker-am'),pm2=document.getElementById('rp-picker-pm');
    if(am){am.style.background=isAM?'var(--p)':'transparent';am.style.color=isAM?'#fff':'var(--t3)';}
    if(pm2){pm2.style.background=!isAM?'var(--p)':'transparent';pm2.style.color=!isAM?'#fff':'var(--t3)';}
    var d=document.getElementById('rp-picker-display');
    if(d) d.textContent=String(_rpPickerHour).padStart(2,'0')+':'+String(_rpPickerMin).padStart(2,'0')+' '+_rpPickerPeriod;
  }
  function _rpRefreshTimeDisplays() {
    var rp=window._rp; if(!rp) return;
    function upd(id,h,m){var el=document.getElementById(id+'-display');if(!el)return;var ampm=h>=12?'PM':'AM',h12=h%12===0?12:h%12;var sp=el.querySelectorAll('span');if(sp[0])sp[0].textContent=String(h12).padStart(2,'0')+':'+String(m).padStart(2,'0');if(sp[1])sp[1].textContent=ampm;}
    upd('rp-start',rp.startHour,rp.startMin); upd('rp-end',rp.endHour,rp.endMin);
  }

  /* ── Inline app picker ─────────────────────────────────────────── */
  function _rpOpenAppPicker() {
    if (typeof FocusTab !== 'undefined') {
      FocusTab.setPickerReturnTarget('routine');
      var currentPkgs = new Set((window._rp?.blockedApps||[]).map(function (a) { return a.packageName; }));
      FocusTab.setPickerSelected(currentPkgs);
    }
    if (!Object.keys(CATS_MAP||{}).length && IS_NATIVE) {
      try { buildCatsMap(JSON.parse(N.getCachedApps()||'[]')); } catch(_) {}
    }
    if (typeof FocusTab !== 'undefined' && typeof FocusTab.buildPickerUsageMap === 'function') FocusTab.buildPickerUsageMap();
    var listHTML = typeof FocusTab !== 'undefined' && typeof FocusTab.buildPickerHTML === 'function' ? FocusTab.buildPickerHTML() : '';
    document.getElementById('rp-inline-picker')?.remove();
    var pickerEl = document.createElement('div');
    pickerEl.id = 'rp-inline-picker';
    pickerEl.style.cssText = 'position:fixed;inset:0;z-index:1300;background:var(--bg,var(--s1));display:flex;flex-direction:column;overflow:hidden;';
    pickerEl.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;padding:16px 16px 14px;border-bottom:1px solid var(--border);background:var(--bg,var(--s1));flex-shrink:0">' +
        '<div onclick="document.getElementById(\'rp-inline-picker\').remove()" style="width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:var(--s3);cursor:pointer;flex-shrink:0">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
        '</div>' +
        '<div style="flex:1;font-size:16px;font-weight:700;color:var(--t1)">Block During Routine</div>' +
        '<div onclick="FocusRoutine._rpSaveInlinePicker()" style="font-family:var(--ff-m);font-size:13px;font-weight:700;color:var(--p);cursor:pointer;padding:6px 10px">Done</div>' +
      '</div>' +
      '<div style="padding:10px 16px 8px;border-bottom:1px solid var(--border);flex-shrink:0">' +
        '<input id="rp-picker-search-inline" placeholder="Search apps or categories…"' +
          ' oninput="FocusRoutine._rpFilterInlinePicker(this.value)"' +
          ' style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:12px;border:1px solid var(--border2);background:var(--s3);color:var(--t1);font-size:13px;outline:none"/>' +
      '</div>' +
      '<div id="rp-picker-list-inline" style="flex:1;overflow-y:auto;scrollbar-width:none;padding-bottom:20px">' + listHTML + '</div>';
    document.body.appendChild(pickerEl);

    /* ── Category expand mirror fix ────────────────────────────────
     * Category expand/collapse buttons in the picker HTML call a FocusPicker
     * internal function that re-renders into #focus-picker-list (the hidden
     * standard panel).  The inline picker container (#rp-picker-list-inline)
     * never sees those updates.
     *
     * Fix: snapshot the standard panel's content before each click and, if it
     * changed after the click (meaning a category toggle fired), copy the new
     * content into the inline container.  Uses requestAnimationFrame so the
     * re-render inside FocusPicker has already completed by the time we diff.
     * ─────────────────────────────────────────────────────────────── */
    var _standardPanel = document.getElementById('focus-picker-list');
    if (_standardPanel) {
      var _lastSnapshot = _standardPanel.innerHTML;
      pickerEl.addEventListener('click', function () {
        requestAnimationFrame(function () {
          var inlineList = document.getElementById('rp-picker-list-inline');
          if (!inlineList || !_standardPanel) return;
          var current = _standardPanel.innerHTML;
          if (current !== _lastSnapshot) {
            _lastSnapshot  = current;
            inlineList.innerHTML = current;
          }
        });
      }, true /* capture — fires before onclick bubbling stops */);
    }
  }
  function _rpFilterInlinePicker(query) {
    var q = query.toLowerCase().trim();
    var list = document.getElementById('rp-picker-list-inline');
    if (!list) return;

    // 1. Show / hide individual app rows
    list.querySelectorAll('.app-sel-row').forEach(function (row) {
      var name = (row.querySelector('.app-sel-name') || row).textContent.toLowerCase();
      var cat  = (row.dataset.cat || '').toLowerCase();
      row.style.display = (name.includes(q) || cat.includes(q)) ? '' : 'none';
    });

    // 2. Hide category section wrappers whose every app row is now hidden.
    //    Handles both flat lists (no wrapper) and grouped layouts gracefully.
    list.querySelectorAll('.picker-cat-section, [data-cat-section]').forEach(function (sec) {
      var hasVisible = Array.from(sec.querySelectorAll('.app-sel-row'))
                           .some(function (r) { return r.style.display !== 'none'; });
      sec.style.display = hasVisible ? '' : 'none';
    });
  }
  function _rpSaveInlinePicker() {
    document.getElementById('rp-inline-picker')?.remove();
    _rpHandlePickerSave();
  }
  function handlePickerSave() { _rpHandlePickerSave(); }
  function _rpHandlePickerSave() {
    if (typeof FocusTab === 'undefined') return;
    FocusTab.setPickerReturnTarget(null);
    var all = IS_NATIVE ? (() => { try { return JSON.parse(N.getAllApps()||'[]'); } catch(_){ return []; } })() : Object.values(CATS_MAP).flat();
    var map = {};
    all.forEach(function (a) { map[a.packageName] = a; });
    var sel = FocusTab.getPickerSelected ? FocusTab.getPickerSelected() : new Set();
    window._rp.blockedApps = [...sel].map(function (pkg) { return { packageName: pkg, name: map[pkg]?.name || pkg.split('.').pop() }; });
    closePanel('focus-picker-panel');
    _rpRefreshAppChips();
    toast('Apps updated', 'success');
  }

  /* ── Delete ──────────────────────────────────────────────────── */
  function _rpDelete(id) {
    document.getElementById('rp-delete-confirm')?.remove();
    var el=document.createElement('div'); el.id='rp-delete-confirm';
    el.style.cssText='position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;';
    el.innerHTML='<div style="background:var(--s1);border-radius:24px 24px 0 0;width:100%;padding:24px 20px max(env(safe-area-inset-bottom),24px)">' +
      '<div style="width:36px;height:4px;border-radius:2px;background:var(--border2);margin:0 auto 18px"></div>' +
      '<div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:8px;text-align:center">Delete this schedule?</div>' +
      '<div style="font-family:var(--ff-m);font-size:12px;color:var(--t3);text-align:center;margin-bottom:24px">This recurring schedule will be removed.</div>' +
      '<button type="button" onclick="FocusRoutine._rpConfirmDelete(\'' + id + '\')" style="width:100%;padding:15px;border-radius:14px;border:none;background:var(--r);color:#fff;font-family:var(--ff-m);font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px">Delete</button>' +
      '<button type="button" onclick="document.getElementById(\'rp-delete-confirm\')?.remove()" style="width:100%;padding:13px;border-radius:14px;border:1px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--ff-m);font-size:13px;cursor:pointer">Cancel</button>' +
    '</div>';
    el.addEventListener('click', function (e) { if(e.target===el)el.remove(); });
    document.body.appendChild(el);
  }
  function _rpConfirmDelete(id) {
    document.getElementById('rp-delete-confirm')?.remove();
    if(IS_NATIVE && typeof N.cancelRoutineAlarm==='function'){try{N.cancelRoutineAlarm(id);}catch(_){}}
    _routines=_routines.filter(function (r){return r.id!==id;});
    _saveRoutines(); closeRoutinePicker(); render();
    toast('Schedule deleted','info');
  }

  /* ── saveRoutine ─────────────────────────────────────────────── */
  function saveRoutine() {
    if(!window._rp) return;
    var rp=window._rp;
    var nameInput=document.getElementById('rp-name-input');
    var name=(nameInput!=null?nameInput.value:rp.name).trim();
    var hasError=false;
    function _shake(el){ if(!el)return; el.style.transition='border-color .15s'; el.style.borderColor='var(--r,#f04e7a)'; el.style.animation='none'; requestAnimationFrame(function(){el.style.animation='_rp-shake .35s ease';}); setTimeout(function(){el.style.borderColor='';el.style.animation='';},1800); }
    if(!name){ toast('Give this schedule a name','warn'); _shake(nameInput?.closest('._rp-card')||nameInput?.parentElement||nameInput); if(nameInput){nameInput.style.borderBottom='2px solid var(--r,#f04e7a)';nameInput.focus();setTimeout(function(){nameInput.style.borderBottom='';},1800);} hasError=true; }
    if(!rp.days||!rp.days.size){ toast('Pick at least one day','warn'); _shake(document.getElementById('rp-day-btns')?.closest('._rp-card')); hasError=true; }
    if(!rp.blockedApps||!rp.blockedApps.length){ toast('Add at least one app to block','warn'); _shake(document.getElementById('rp-app-chips')?.closest('._rp-card')); hasError=true; }
    if(hasError) return;
    var startMins=rp.startHour*60+rp.startMin, endMins=rp.endHour*60+rp.endMin;
    if(startMins===endMins){toast('Start and end time cannot be the same','warn');return;}
    var durationMins=Math.max(5,((endMins-startMins+1440)%1440));
    if(durationMins<5){toast('Minimum session length is 5 minutes','warn');return;}
    var templateId=rp.templateId||(_routineEditId&&(_routines||[]).find(function(r){return r.id===_routineEditId;})?.templateId)||null;
    function _doCommit(){
      var id=_routineEditId||('rt_'+Date.now());
      var routine={id,name,emoji:rp.emoji,enabled:true,difficulty:rp.difficulty,durationMins,
        blockedApps:rp.blockedApps,days:[...rp.days].sort(),
        startHour:rp.startHour,startMin:rp.startMin,endHour:rp.endHour,endMin:rp.endMin,templateId};
      if(_routineEditId){var idx=_routines.findIndex(function(r){return r.id===_routineEditId;});if(idx>=0)_routines[idx]=routine;else _routines.push(routine);}
      else _routines.push(routine);
      _saveRoutines(); closeRoutinePicker(); render();
      if(typeof FocusTab !== 'undefined') FocusTab.renderSessionIdle();
      toast((routine.emoji)+' '+(routine.name)+' scheduled \u2713','success');
    }
    if(rp.difficulty==='deep'){
      var wasDeep=(_routineEditId&&_routines.find(function(r){return r.id===_routineEditId;})?.difficulty==='deep');
      if(!wasDeep){
        var el=document.createElement('div'); el.id='rp-deep-schedule-confirm';
        el.style.cssText='position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,.65);display:flex;align-items:flex-end;';
        el.innerHTML='<div style="background:var(--s1);border-radius:24px 24px 0 0;width:100%;padding:24px 20px max(env(safe-area-inset-bottom),24px)">' +
          '<div style="width:36px;height:4px;border-radius:2px;background:var(--border2);margin:0 auto 18px"></div>' +
          '<div style="font-size:24px;text-align:center;margin-bottom:10px">🔒</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--t1);text-align:center;margin-bottom:8px">Deep Focus Schedule</div>' +
          '<div style="font-family:var(--ff-m);font-size:12px;color:var(--t2);text-align:center;line-height:1.65;margin-bottom:22px">When this fires it will <strong>auto-start a session that cannot be cancelled</strong>. Schedule it?</div>' +
          '<button id="rp-deep-sched-ok" style="width:100%;padding:14px;border-radius:14px;border:none;background:var(--r);color:#fff;font-family:var(--ff-m);font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px">Schedule it</button>' +
          '<button id="rp-deep-sched-cancel" style="width:100%;padding:12px;border-radius:14px;border:1px solid var(--border2);background:transparent;color:var(--t2);font-family:var(--ff-m);font-size:13px;cursor:pointer">Cancel</button>' +
        '</div>';
        document.body.appendChild(el);
        el.addEventListener('click',function(e){if(e.target===el)el.remove();});
        document.getElementById('rp-deep-sched-ok').addEventListener('click',function(){el.remove();_doCommit();});
        document.getElementById('rp-deep-sched-cancel').addEventListener('click',function(){el.remove();});
        return;
      }
    }
    _doCommit();
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    load,
    render,
    getRoutines:      function () { return _routines; },
    getTemplates:     function () { return FOCUS_SCHEDULE_TEMPLATES; },
    buildUpcomingNotice,
    openRoutinePicker,
    closeRoutinePicker,
    saveRoutine,
    toggleRoutine,
    activateTemplate,
    handlePickerSave,
    // Editor controls (called from onclick)
    _rpToggleDay,
    _rpPresetDays,
    _rpRefreshPresetPills,
    _rpSetDiff,
    _rpCycleEmoji,
    _rpRemoveApp,
    _rpOpenAppPicker,
    _rpSaveInlinePicker,
    _rpFilterInlinePicker,
    _rpDelete,
    _rpConfirmDelete,
    _rpOpenTimePicker,
    _rpCloseTimePicker,
    _rpPickerSetHour,
    _rpPickerSetMin,
    _rpPickerSetAmPm,
    markEndedEarly: function (id, remainSecs) {
      _routineEndedEarly.set(id, Date.now());
      if (remainSecs > 0) setTimeout(function () { _routineEndedEarly.delete(id); render(); }, remainSecs * 1000);
    },
    fmt12h: _fmt12h,
    fmt12:  _fmt12,
  };
})();