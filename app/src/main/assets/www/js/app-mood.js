/* ═══════════════════════════════════════════════════════════════════════
   AURELO  |  Daily Mood Check-In  |  app-mood.js  v1.0
   ─────────────────────────────────────────────────────────────────────
   Responsibilities
     • Inject popup HTML into #modals-root on first call
     • Morning trigger: first app open 07:00–11:00 if not logged today
     • Onboarding step-2 face rendering (replaces old 4-button system)
     • Settings section: toggle on/off, "Log now" if today not logged
     • Score History: expose getMoodHistory(n) for chart overlay
     • Encrypted storage via S.moodHistory[] + saveS()

   Gating
     • Logging itself: FREE
     • Mood history > 7 days: PRO  (same pattern as Score History)
   ═══════════════════════════════════════════════════════════════════════ */

var Mood = (function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────── */
  var MORNING_START_H = 7;
  var MORNING_END_H   = 11;
  var _audioCtx       = null;

  var MOODS = {
    awful: {
      face: '😞', label: 'Rough', sub: 'Hang in there — you\'ve got this.',
      c1: '#ef4444', c2: '#f97316', cr: '239,68,68', pattern: [40, 20, 40], tone: [180, 'sine']
    },
    low: {
      face: '😕', label: 'Low', sub: 'It\'s okay to feel this way.',
      c1: '#f97316', c2: '#eab308', cr: '249,115,22', pattern: [30, 15, 30], tone: [250, 'sine']
    },
    okay: {
      face: '😐', label: 'Okay', sub: 'Steady. One step at a time.',
      c1: '#7c3aed', c2: '#0891b2', cr: '124,58,237', pattern: [20], tone: [380, 'sine']
    },
    good: {
      face: '🙂', label: 'Good', sub: 'Nice! You\'re in a good place.',
      c1: '#22c55e', c2: '#0891b2', cr: '34,197,94', pattern: [15, 10, 15, 10, 15], tone: [520, 'triangle']
    },
    great: {
      face: '🤩', label: 'Great', sub: 'Incredible energy today! 🚀',
      c1: '#f59e0b', c2: '#ec4899', cr: '245,158,11', pattern: [10, 5, 10, 5, 10, 5, 10], tone: [720, 'triangle']
    }
  };

  var MOOD_TAGS = {
    awful: ['😣 Overwhelmed', '😔 Burned out', '🛌 Resting', '📉 Heavy day', '💬 Need support'],
    low:   ['😴 Tired', '🧠 Unfocused', '🌧️ Sluggish', '📆 Busy', '🫂 Need space'],
    okay:  ['✅ Fine', '🧘 Calm', '📋 Routine', '☕ Caffeinated', '🔍 Distracted'],
    good:  ['💪 Productive', '😊 Positive', '🎯 Focused', '👥 Connected', '🏃 Active'],
    great: ['🚀 On a roll', '🎉 Celebrating', '✨ Inspired', '💡 Creative', '🏆 Winning']
  };

  /* ── Module state ───────────────────────────────────────────────────── */
  var _injected     = false;
  var _selectedMood = null;
  var _mode         = 'popup'; // 'popup' | 'onboarding'

  /* ── Storage helpers ────────────────────────────────────────────────── */
  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  function _getHistory() {
    if (!S.moodHistory) S.moodHistory = [];
    return S.moodHistory;
  }

  function _saveEntry(mood, tags, note) {
    var hist  = _getHistory();
    var today = _todayStr();
    S.moodHistory = hist.filter(function (e) { return e.d !== today; });
    S.moodHistory.unshift({ d: today, m: mood, t: tags, n: note || '' });
    S.moodHistory = S.moodHistory.slice(0, 90);
    saveS();

    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE && typeof N !== 'undefined' && typeof N.saveMoodEntry === 'function') {
      try { N.saveMoodEntry(today, mood, JSON.stringify(tags), note || ''); } catch (_) {}
    }
  }

  function _getTodayEntry() {
    var today = _todayStr();
    return (_getHistory()).find(function (e) { return e.d === today; }) || null;
  }

  /* ── DOM helpers ────────────────────────────────────────────────────── */
  function _q(id) { return document.getElementById(id); }

  /* ── Media & Effects ────────────────────────────────────────────────── */
  function _applyTheme(m, targetId) {
    var el = _q(targetId);
    if (!el) return;
    el.style.setProperty('--c1', m.c1);
    el.style.setProperty('--c2', m.c2);
    el.style.setProperty('--cr', m.cr);
  }

  function _playSound(moodKey) {
    try {
      var m = MOODS[moodKey];
      _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var now = _audioCtx.currentTime;
      var play = function(freq, delay, vol, type, dur) {
        var o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
        o.connect(g); g.connect(_audioCtx.destination);
        o.type = type;
        o.frequency.setValueAtTime(freq, now + delay);
        g.gain.setValueAtTime(vol, now + delay);
        g.gain.exponentialRampToValueAtTime(.001, now + delay + dur);
        o.start(now + delay); o.stop(now + delay + dur + .02);
      };

      if (moodKey === 'great') {
        play(m.tone[0], 0, .18, m.tone[1], .18);
        play(1040, .13, .14, 'triangle', .16);
      } else if (moodKey === 'good') {
        play(m.tone[0], 0, .16, m.tone[1], .2);
      } else if (moodKey === 'okay') {
        play(m.tone[0], 0, .12, m.tone[1], .18);
      } else if (moodKey === 'low') {
        play(m.tone[0], 0, .12, m.tone[1], .2);
      } else {
        play(m.tone[0], 0, .14, m.tone[1], .28);
      }
    } catch(e) {}
  }

  /* ── Inject popup HTML ──────────────────────────────────────────────── */
  function _inject() {
    if (_injected) return;
    _injected = true;

    var html = '<div id="mood-backdrop" role="dialog" aria-modal="true" aria-label="Daily mood check-in">'
      + '<div id="mood-card">'
      + '<div class="mood-top-bar"></div>'
      + '<div class="mood-inner" id="mood-main-state">'

      // Header
      + '<div class="mood-header">'
      + '<div>'
      + '<div class="mood-date" id="mood-popup-date"></div>'
      + '<div class="mood-title">How are you<br>feeling today?</div>'
      + '</div>'
      + '<button class="mood-close" onclick="Mood.dismiss()" aria-label="Skip today">✕</button>'
      + '</div>'

      // Big Face display
      + '<div class="mood-big">'
      + '<div class="mood-big-face" id="mp-big-face">😐</div>'
      + '<div class="mood-big-label" id="mp-big-label">Okay</div>'
      + '<div class="mood-big-sub" id="mp-big-sub">Tap a mood to continue</div>'
      + '</div>'

      // Nodes
      + '<div class="mood-row" id="mp-mood-row"></div>'

      // Tags (hidden until mood selected)
      + '<div class="mood-tags-wrap" id="mood-popup-tags-wrap-cont">'
      + '<div class="mood-section-lbl">What shaped today?</div>'
      + '<div class="mood-tags" id="mood-popup-tags"></div>'
      + '</div>'

      // Note Toggle & Box
      + '<div class="mood-note-toggle" id="mood-popup-note-toggle" onclick="Mood.toggleNote(\'mood-popup-note-box\', \'mood-popup-note-text\')">'
      + '<span>Add a note for today <span style="opacity:.45">(optional)</span></span>'
      + '<span>＋</span>'
      + '</div>'
      + '<div class="mood-note-box" id="mood-popup-note-box">'
      + '<textarea id="mood-popup-note-text" rows="2" placeholder="What made today stand out?"></textarea>'
      + '</div>'

      // Bottom / Log button
      + '<div class="mood-bottom">'
      + '<button class="mood-log-btn" id="mood-popup-log-btn" disabled onclick="Mood.log()">Log mood →</button>'
      + '</div>'

      + '</div>'  // .mood-inner

      // Success state
      + '<div class="mood-success" id="mood-popup-success">'
      + '<div class="mood-success-face" id="mood-popup-success-face">😐</div>'
      + '<div class="mood-success-title">Logged. See you tomorrow.</div>'
      + '<div class="mood-success-sub">Your mood helps Coach personalise your insights.</div>'
      + '<div class="mood-success-bar"></div>'
      + '</div>'

      + '</div>'  // #mood-card
      + '</div>'; // #mood-backdrop

    var root = _q('modals-root') || document.body;
    var el = document.createElement('div');
    el.innerHTML = html;
    while (el.firstChild) root.appendChild(el.firstChild);

    _populateFaceRow('mp');
  }

  function _populateFaceRow(prefix) {
    var row = _q(prefix + '-mood-row');
    if (!row) return;
    row.innerHTML = '';
    Object.keys(MOODS).forEach(function(k) {
      var m = MOODS[k];
      var node = document.createElement('div');
      node.className = 'mood-node';
      node.id = prefix + '-item-' + k;
      node.innerHTML = '<div class="mood-node-emoji">' + m.face + '</div><div class="mood-node-lbl">' + m.label + '</div>';
      node.onclick = function() { Mood.selectMood(k, prefix); };
      row.appendChild(node);
    });
  }

  function _setDateLabel(elId) {
    var el = _q(elId);
    if (!el) return;
    var d = new Date();
    var days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    el.textContent = days[d.getDay()] + ' · ' + months[d.getMonth()] + ' ' + d.getDate();
  }

  function checkMorningPrompt() {
    if (typeof S !== 'undefined' && S.moodCheckInDisabled) return;
    if (_getTodayEntry()) return;
    if (typeof S !== 'undefined' && S.moodDismissedDate === _todayStr()) return;
    var h = new Date().getHours();
    if (h < MORNING_START_H || h >= MORNING_END_H) return;
    if (_q('ob-screen') && (_q('ob-screen').style.display !== 'none')) return;
    show('popup');
  }

  function show(mode) {
    _mode = mode || 'popup';
    if (_mode === 'popup') {
      _inject();
      _reset('mp');
      _setDateLabel('mood-popup-date');
      var bd = _q('mood-backdrop');
      if (bd) {
        requestAnimationFrame(function () {
          bd.classList.add('open');
        });
      }
    }
  }

  function dismiss() {
    if (typeof S !== 'undefined') S.moodDismissedDate = _todayStr();
    saveS();
    _close();
  }

  function _close() {
    var bd = _q('mood-backdrop');
    if (bd) bd.classList.remove('open');
  }

  function _reset(prefix) {
    _selectedMood = null;
    var card = _q(_mode === 'popup' ? 'mood-card' : 'ob-mood-card');
    if (card) {
      card.style.removeProperty('--c1');
      card.style.removeProperty('--c2');
      card.style.removeProperty('--cr');
    }

    Object.keys(MOODS).forEach(function(k) {
      var item = _q(prefix + '-item-' + k);
      if (item) item.classList.remove('active');
    });

    var bigFace = _q(prefix + '-big-face');
    if (bigFace) {
      bigFace.textContent = '😐';
      bigFace.classList.remove('pop');
    }

    var tagsWrap = _q('mood-popup-tags-wrap-cont');
    var noteBox  = _q('mood-popup-note-box');
    var logBtn   = _q('mood-popup-log-btn');
    var mainSt   = _q('mood-main-state');
    var succSt   = _q('mood-popup-success');
    var noteText = _q('mood-popup-note-text');

    if (tagsWrap) tagsWrap.classList.remove('visible');
    if (noteBox) noteBox.classList.remove('open');
    if (logBtn) logBtn.disabled = true;
    if (mainSt) mainSt.style.display = 'block';
    if (succSt) succSt.classList.remove('show');
    if (noteText) noteText.value = '';
  }

  function toggleNote(boxId, textId) {
    var box = _q(boxId);
    if (box) {
      box.classList.toggle('open');
      if (box.classList.contains('open')) {
        var input = _q(textId);
        if (input) setTimeout(function() { input.focus(); }, 300);
      }
    }
  }

  function selectMood(mood, prefix) {
    prefix = prefix || (_mode === 'onboarding' ? 'ob' : 'mp');
    _selectedMood = mood;
    var m = MOODS[mood];

    Object.keys(MOODS).forEach(function (k) {
      var item = _q(prefix + '-item-' + k);
      if (item) item.classList.remove('active');
    });

    var activeItem = _q(prefix + '-item-' + mood);
    if (activeItem) activeItem.classList.add('active');

    var bigFace  = _q(prefix + '-big-face');
    var bigLabel = _q(prefix + '-big-label');
    var bigSub   = _q(prefix + '-big-sub');
    var sFace    = _q('mood-popup-success-face');

    if (bigFace) {
      bigFace.classList.remove('pop');
      void bigFace.offsetWidth;
      bigFace.classList.add('pop');
      bigFace.textContent = m.face;
    }
    if (bigLabel) bigLabel.textContent = m.label;
    if (bigSub) bigSub.textContent = m.sub;
    if (sFace) sFace.textContent = m.face;

    _applyTheme(m, _mode === 'popup' ? 'mood-card' : 'ob-mood-card');

    if (navigator.vibrate) navigator.vibrate(m.pattern);
    _playSound(mood);

    if (_mode === 'popup') {
      _showTags(mood);
      var btn = _q('mood-popup-log-btn');
      if (btn) btn.disabled = false;
      var noteBox = _q('mood-popup-note-box');
      if (noteBox) noteBox.classList.remove('open');
    } else {
      _obSyncMoodState(mood);
    }
  }

  function _showTags(mood) {
    var wrap = _q('mood-popup-tags');
    var cont = _q('mood-popup-tags-wrap-cont');
    if (!wrap || !cont) return;

    var list = MOOD_TAGS[mood] || [];
    wrap.innerHTML = '';
    list.forEach(function (tagTxt) {
      var el = document.createElement('div');
      el.className = 'mood-tag';
      el.textContent = tagTxt;
      el.onclick = function () { el.classList.toggle('selected'); };
      wrap.appendChild(el);
    });
    cont.classList.add('visible');
  }

  function log() {
    if (!_selectedMood) return;
    var mood = _selectedMood;

    var tags = [];
    var tagEls = document.querySelectorAll('#mood-popup-tags .mood-tag.selected');
    tagEls.forEach(function (el) { tags.push(el.textContent.trim()); });
    var noteVal = _q('mood-popup-note-text') ? _q('mood-popup-note-text').value.trim() : '';

    _saveEntry(mood, tags, noteVal);

    var mainSt = _q('mood-main-state');
    var succSt = _q('mood-popup-success');

    if (mainSt) mainSt.style.display = 'none';
    if (succSt) succSt.classList.add('show');

    if (navigator.vibrate) navigator.vibrate([20, 25, 20]);
    try {
      _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var now = _audioCtx.currentTime;
      [0, .14].forEach(function(d, i) {
        var o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
        o.connect(g); g.connect(_audioCtx.destination);
        o.type = 'sine'; o.frequency.value = 600 + i * 150;
        g.gain.setValueAtTime(.22, now + d);
        g.gain.exponentialRampToValueAtTime(.001, now + d + .16);
        o.start(now + d); o.stop(now + d + .18);
      });
    } catch(e) {}

    setTimeout(_close, 2200);
    setTimeout(renderSettingsSection, 2300);
  }

  function logOnboardingMood(mood, tags) {
    if (!mood) return;
    _saveEntry(mood, tags || [], '');
  }

  function renderOnboardingFaces(containerId) {
    var el = _q(containerId);
    if (!el) return;
    _mode = 'onboarding';

    var html = '<div id="ob-mood-card" style="width:100%; transition:--c1 0.3s, --c2 0.3s, --cr 0.3s;">'
      + '<div class="mood-big" style="min-height:90px; margin-bottom:15px;">'
      + '<div class="mood-big-face" id="ob-big-face">😐</div>'
      + '<div class="mood-big-label" id="ob-big-label">Okay</div>'
      + '<div class="mood-big-sub" id="ob-big-sub">Tap a mood to continue</div>'
      + '</div>'
      + '<div class="mood-row" id="ob-mood-row"></div>'
      + '</div>';

    el.innerHTML = html;
    _populateFaceRow('ob');
  }

  function _obSyncMoodState(mood) {
    if (typeof window._obMoodId !== 'undefined') window._obMoodId = mood;
    var btn = _q('ob2-next-btn');
    if (btn) btn.disabled = false;
    var input = _q('ob-name-input');
    if (typeof obUpdateNamePreview === 'function') obUpdateNamePreview(input ? input.value : '');
  }

  function renderSettingsSection() {
    var el = _q('mood-settings-section');
    if (!el) return;

    var todayEntry  = _getTodayEntry();
    var enabled     = typeof S !== 'undefined' ? !S.moodCheckInDisabled : true;
    var moodLabel   = todayEntry ? (MOODS[todayEntry.m] || {}).label || todayEntry.m : null;
    var moodColor   = todayEntry ? (MOODS[todayEntry.m] || {}).c1 || 'var(--t2)' : 'var(--t2)';

    el.innerHTML =
      '<div class="sr">' +
        '<div class="sr-ico" style="background:rgba(155,149,255,.15);color:var(--p2)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div>' +
        '<div style="flex:1">' +
          '<div class="sr-lbl">Mood Check-In</div>' +
          '<div class="sr-sub">' +
            (todayEntry
              ? '<span style="color:' + moodColor + ';font-weight:600">' + moodLabel + '</span> logged today'
              : 'Daily morning prompt · 7–11 AM') +
          '</div>' +
        '</div>' +
        '<div class="tog ' + (enabled ? 'on' : '') + '" onclick="Mood.setEnabled(' + (!enabled) + ')" style="flex-shrink:0"><div class="tog-knob"></div></div>' +
      '</div>' +
      (!todayEntry && enabled
        ? '<div style="padding:2px 14px 8px">' +
            '<button class="mood-settings-log-now" onclick="Mood.openFromSettings()">+ Log today\'s mood</button>' +
          '</div>'
        : '');
  }

  function setEnabled(val) {
    if (typeof S !== 'undefined') S.moodCheckInDisabled = !val;
    saveS();
    renderSettingsSection();
    if (typeof toast === 'function') toast(val ? 'Mood check-in enabled' : 'Mood check-in paused', 'info');
  }

  function openFromSettings() { show('popup'); }

  function getMoodHistory(days) {
    days = days || 30;
    var hist = _getHistory();
    if (days > 7 && typeof ProTier !== 'undefined' && !ProTier.isPro) return hist.slice(0, 7);
    return hist.slice(0, days);
  }

  function getMoodForDay(dateStr) {
    var MAP = { awful: 1, low: 2, okay: 3, good: 4, great: 5 };
    var entry = (_getHistory()).find(function (e) { return e.d === dateStr; });
    return entry ? (MAP[entry.m] || null) : null;
  }

  function getTodayMood() {
    var e = _getTodayEntry();
    return e ? e.m : null;
  }

  return {
    show: show,
    dismiss: dismiss,
    selectMood: selectMood,
    toggleNote: toggleNote,
    log: log,
    checkMorningPrompt: checkMorningPrompt,
    renderOnboardingFaces: renderOnboardingFaces,
    logOnboardingMood: logOnboardingMood,
    renderSettingsSection: renderSettingsSection,
    setEnabled: setEnabled,
    openFromSettings: openFromSettings,
    getMoodHistory: getMoodHistory,
    getMoodForDay: getMoodForDay,
    getTodayMood: getTodayMood
  };
}());