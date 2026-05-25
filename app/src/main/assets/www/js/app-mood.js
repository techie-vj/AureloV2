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

   Bridge surface expected (Kotlin, future sprint)
     N.saveMoodEntry(dateStr, mood, tags)   → persists to SQLCipher
     N.getMoodHistory(days)                 → JSON array
     N.scheduleMoodNotification(hourStr)    → WorkManager alarm
     (Until bridge lands, falls back to S.moodHistory[] in JS state)
   ═══════════════════════════════════════════════════════════════════════ */

var Mood = (function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────── */

  var MORNING_START_H = 7;
  var MORNING_END_H   = 11;

  var MOODS = {
    awful: {
      label : 'Rough day',
      color : '#F04E7A',
      successIcon : '💪',
      successMsg  : 'Noted. Coach will check in with you.',
    },
    low: {
      label : 'Meh...',
      color : '#F7A623',
      successIcon : '🤍',
      successMsg  : 'Got it. Rest up today.',
    },
    okay: {
      label : 'Could be worse',
      color : '#A0A0CC',
      successIcon : '👍',
      successMsg  : 'Fair enough. Small wins count.',
    },
    good: {
      label : 'Doing well',
      color : '#12D48A',
      successIcon : '🙌',
      successMsg  : 'Nice one. Keep it going!',
    },
    great: {
      label : 'Loving it!',
      color : '#9B95FF',
      successIcon : '🎉',
      successMsg  : 'Love to hear it. Let\'s channel it!',
    },
  };

  var MOOD_TAGS = {
    awful: [
      { t: 'anxious',     i: '⚡', c: '#F04E7A' },
      { t: 'overwhelmed', i: '🌊', c: '#F04E7A' },
      { t: 'angry',       i: '🔥', c: '#F7A623' },
      { t: 'exhausted',   i: '💀', c: '#7878A0' },
    ],
    low: [
      { t: 'tired',       i: '🌙', c: '#F7A623' },
      { t: 'unmotivated', i: '💤', c: '#7878A0' },
      { t: 'stressed',    i: '🌊', c: '#F7A623' },
      { t: 'lonely',      i: '💭', c: '#A0A0CC' },
    ],
    okay: [
      { t: 'distracted',    i: '💭', c: '#7878A0' },
      { t: 'a bit tired',   i: '🌙', c: '#7878A0' },
      { t: 'getting there', i: '🚶', c: '#A0A0CC' },
      { t: 'neutral',       i: '〰️', c: '#A0A0CC' },
    ],
    good: [
      { t: 'calm',      i: '🧘', c: '#12D48A' },
      { t: 'focused',   i: '🎯', c: '#6C63FF' },
      { t: 'energised', i: '🔋', c: '#12D48A' },
      { t: 'grateful',  i: '🌿', c: '#12D48A' },
    ],
    great: [
      { t: 'motivated', i: '✨', c: '#9B95FF' },
      { t: 'energised', i: '🔋', c: '#05C8E8' },
      { t: 'focused',   i: '🎯', c: '#6C63FF' },
      { t: 'on a roll', i: '🚀', c: '#9B95FF' },
    ],
  };

  /* Shared SVG face definitions — keyed by mood id */
  var FACE_SVG = {
    awful: '<svg class="mood-face-svg" viewBox="0 0 52 52" fill="none" overflow="visible" aria-hidden="true">'
      + '<circle cx="26" cy="26" r="23" fill="rgba(240,78,122,0.13)" stroke="#F04E7A" stroke-width="1.5"/>'
      + '<g class="mood-anim-fire" style="opacity:0">'
      +   '<ellipse cx="14" cy="45" rx="5" ry="7" fill="#F04E7A" opacity=".6" style="animation:moodFireFlicker 0.4s ease-in-out infinite;transform-origin:14px 45px"/>'
      +   '<ellipse cx="26" cy="43" rx="6" ry="9" fill="#F7A623" opacity=".7" style="animation:moodFireFlicker 0.35s ease-in-out .1s infinite;transform-origin:26px 43px"/>'
      +   '<ellipse cx="38" cy="45" rx="5" ry="7" fill="#F04E7A" opacity=".6" style="animation:moodFireFlicker 0.45s ease-in-out .05s infinite;transform-origin:38px 45px"/>'
      + '</g>'
      + '<path class="mood-anim-brow-l" d="M16 19l5 2.5" stroke="#F04E7A" stroke-width="2" stroke-linecap="round"/>'
      + '<path class="mood-anim-brow-r" d="M36 19l-5 2.5" stroke="#F04E7A" stroke-width="2" stroke-linecap="round"/>'
      + '<ellipse cx="19" cy="24" rx="2.5" ry="2.5" fill="#F04E7A"/>'
      + '<ellipse cx="33" cy="24" rx="2.5" ry="2.5" fill="#F04E7A"/>'
      + '<path d="M19 34c1.8-4 12.2-4 14 0" stroke="#F04E7A" stroke-width="2.2" stroke-linecap="round"/>'
      + '<path class="mood-anim-steam-l" d="M10 12 Q8 9 10 6" stroke="#F04E7A" stroke-width="1.5" stroke-linecap="round" opacity="0"/>'
      + '<path class="mood-anim-steam-r" d="M42 12 Q44 9 42 6" stroke="#F04E7A" stroke-width="1.5" stroke-linecap="round" opacity="0"/>'
      + '</svg>',

    low: '<svg class="mood-face-svg" viewBox="0 0 52 52" fill="none" overflow="visible" aria-hidden="true">'
      + '<circle cx="26" cy="26" r="23" fill="rgba(247,166,35,0.10)" stroke="#F7A623" stroke-width="1.5"/>'
      + '<ellipse cx="19" cy="24" rx="2.2" ry="2.2" fill="#F7A623"/>'
      + '<path class="mood-anim-eye-l" d="M16.5 23 Q19 21 21.5 23" stroke="#F7A623" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0"/>'
      + '<ellipse cx="33" cy="24" rx="2.2" ry="2.2" fill="#F7A623"/>'
      + '<path class="mood-anim-eye-r" d="M30.5 23 Q33 21 35.5 23" stroke="#F7A623" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0"/>'
      + '<path d="M19 31c1.5-2.5 12.5-2.5 14 0" stroke="#F7A623" stroke-width="2" stroke-linecap="round"/>'
      + '<circle class="mood-anim-tear-l" cx="19" cy="27" r="1.5" fill="#F7A623" opacity="0"/>'
      + '<circle class="mood-anim-tear-r" cx="33" cy="27" r="1.5" fill="#F7A623" opacity="0"/>'
      + '</svg>',

    okay: '<svg class="mood-face-svg" viewBox="0 0 52 52" fill="none" overflow="visible" aria-hidden="true">'
      + '<circle cx="26" cy="26" r="23" fill="rgba(160,160,204,0.08)" stroke="#A0A0CC" stroke-width="1.5"/>'
      + '<ellipse cx="19" cy="23" rx="2.2" ry="2.2" fill="#A0A0CC"/>'
      + '<ellipse cx="33" cy="23" rx="2.2" ry="2.2" fill="#A0A0CC"/>'
      + '<path d="M19 30h14" stroke="#A0A0CC" stroke-width="2" stroke-linecap="round"/>'
      + '<path class="mood-anim-arm-l" d="M10 30 Q8 26 12 24" stroke="#A0A0CC" stroke-width="1.8" stroke-linecap="round" opacity="0"/>'
      + '<path class="mood-anim-arm-r" d="M42 30 Q44 26 40 24" stroke="#A0A0CC" stroke-width="1.8" stroke-linecap="round" opacity="0"/>'
      + '</svg>',

    good: '<svg class="mood-face-svg" viewBox="0 0 52 52" fill="none" overflow="visible" aria-hidden="true">'
      + '<circle cx="26" cy="26" r="23" fill="rgba(18,212,138,0.09)" stroke="#12D48A" stroke-width="1.5"/>'
      + '<ellipse cx="19" cy="23" rx="2.2" ry="2.2" fill="#12D48A"/>'
      + '<ellipse cx="33" cy="23" rx="2.2" ry="2.2" fill="#12D48A"/>'
      + '<path d="M18 29c1.8 3 14.2 3 16 0" stroke="#12D48A" stroke-width="2.2" stroke-linecap="round"/>'
      + '<ellipse class="mood-anim-cheek-l" cx="14" cy="28" rx="3.5" ry="2" fill="#12D48A" opacity=".2"/>'
      + '<ellipse class="mood-anim-cheek-r" cx="38" cy="28" rx="3.5" ry="2" fill="#12D48A" opacity=".2"/>'
      + '</svg>',

    great: '<svg class="mood-face-svg" viewBox="0 0 52 52" fill="none" overflow="visible" aria-hidden="true">'
      + '<g class="mood-anim-sparks" style="opacity:0">'
      +   '<circle cx="5"  cy="10" r="2"   fill="#9B95FF" style="--sx:-8px;--sy:-10px"/>'
      +   '<circle cx="47" cy="10" r="2"   fill="#9B95FF" style="--sx:8px;--sy:-10px"/>'
      +   '<circle cx="3"  cy="28" r="1.5" fill="#05C8E8" style="--sx:-10px;--sy:0px"/>'
      +   '<circle cx="49" cy="28" r="1.5" fill="#05C8E8" style="--sx:10px;--sy:0px"/>'
      +   '<circle cx="10" cy="5"  r="1.5" fill="#9B95FF" style="--sx:-5px;--sy:-12px"/>'
      +   '<circle cx="42" cy="5"  r="1.5" fill="#9B95FF" style="--sx:5px;--sy:-12px"/>'
      + '</g>'
      + '<circle cx="26" cy="26" r="23" fill="rgba(155,149,255,0.13)" stroke="#9B95FF" stroke-width="1.5"/>'
      + '<ellipse cx="19" cy="22" rx="2.5" ry="2.5" fill="#9B95FF"/>'
      + '<ellipse cx="33" cy="22" rx="2.5" ry="2.5" fill="#9B95FF"/>'
      + '<path d="M16 28c2 5 18 5 20 0" stroke="#9B95FF" stroke-width="2.5" stroke-linecap="round"/>'
      + '<path d="M16 28c2 5 18 5 20 0" fill="rgba(155,149,255,.15)"/>'
      + '<ellipse cx="13" cy="29" rx="4" ry="2.2" fill="#9B95FF" opacity=".2"/>'
      + '<ellipse cx="39" cy="29" rx="4" ry="2.2" fill="#9B95FF" opacity=".2"/>'
      + '</svg>',
  };

  /* ── Module state ───────────────────────────────────────────────────── */
  var _injected     = false;
  var _selectedMood = null;
  var _animTimer    = null;
  var _sparksActive = false;
  var _tearTimers   = [];
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

  function _saveEntry(mood, tags) {
    var hist  = _getHistory();
    var today = _todayStr();
    // Remove any existing entry for today (re-log overrides)
    S.moodHistory = hist.filter(function (e) { return e.d !== today; });
    S.moodHistory.unshift({ d: today, m: mood, t: tags });
    // Cap at 90 days to keep state size reasonable
    S.moodHistory = S.moodHistory.slice(0, 90);
    saveS();

    // Forward to native bridge when available
    if (IS_NATIVE && typeof N.saveMoodEntry === 'function') {
      try { N.saveMoodEntry(today, mood, JSON.stringify(tags)); } catch (_) {}
    }
  }

  function _getTodayEntry() {
    var today = _todayStr();
    return (_getHistory()).find(function (e) { return e.d === today; }) || null;
  }

  /* ── DOM helpers ────────────────────────────────────────────────────── */

  function _q(id) { return document.getElementById(id); }
  function _qs(sel, root) { return (root || document).querySelector(sel); }

  /* ── Build face row HTML ────────────────────────────────────────────── */

  function _buildFaceRowHTML(idPrefix, showBackBtn) {
    var keys = Object.keys(MOODS);
    var html = '<div class="mood-row" role="radiogroup" aria-label="Select your mood">';
    keys.forEach(function (k) {
      var m = MOODS[k];
      html += '<div class="mood-item" id="' + idPrefix + '-item-' + k + '"'
        + ' style="--mood-color:' + m.color + '"'
        + ' onclick="Mood.selectMood(\'' + k + '\',\'' + idPrefix + '\')"'
        + ' role="radio" aria-checked="false" tabindex="0"'
        + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \')Mood.selectMood(\'' + k + '\',\'' + idPrefix + '\')">'
        + '<div class="mood-face-wrap" id="' + idPrefix + '-fw-' + k + '">'
        + '<div class="mood-ring"></div>'
        + FACE_SVG[k]
        + '</div>'
        + '<div class="mood-lbl">' + m.label + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ── Inject popup HTML ──────────────────────────────────────────────── */

  function _inject() {
    if (_injected) return;
    _injected = true;

    var html = '<div id="mood-backdrop" role="dialog" aria-modal="true" aria-label="Daily mood check-in">'
      + '<div id="mood-card">'
      + '<div class="mood-top-bar"></div>'
      + '<div class="mood-inner">'

      // Header
      + '<div class="mood-header">'
      + '<div>'
      + '<div class="mood-date" id="mood-popup-date"></div>'
      + '<div class="mood-title">How are you feeling?</div>'
      + '</div>'
      + '<button class="mood-close" onclick="Mood.dismiss()" aria-label="Skip today">✕</button>'
      + '</div>'

      // Faces
      + _buildFaceRowHTML('mp', false)

      // Divider
      + '<div class="mood-divider" id="mood-popup-divider"></div>'

      // Tags (hidden until mood selected)
      + '<div class="mood-tags-section" id="mood-popup-tags-section">'
      + '<div class="mood-tags-label">What\'s going on? <span>(optional)</span></div>'
      + '<div class="mood-tags-wrap" id="mood-popup-tags-wrap"></div>'
      + '</div>'

      // Log button
      + '<div id="mood-popup-log-area">'
      + '<button class="mood-log-btn" id="mood-popup-log-btn" disabled onclick="Mood.log()">Log mood</button>'
      + '</div>'

      // Success state
      + '<div class="mood-success" id="mood-popup-success">'
      + '<div class="mood-success-icon" id="mood-popup-success-icon">✓</div>'
      + '<div class="mood-success-title" id="mood-popup-success-title">Logged. See you tomorrow.</div>'
      + '<div class="mood-success-sub">Your mood helps Coach personalise your insights.</div>'
      + '</div>'

      + '</div>'  // .mood-inner
      + '</div>'  // #mood-card
      + '</div>'; // #mood-backdrop

    var root = _q('modals-root') || document.body;
    var el = document.createElement('div');
    el.innerHTML = html;
    while (el.firstChild) root.appendChild(el.firstChild);
  }

  /* ── Date label ─────────────────────────────────────────────────────── */

  function _setDateLabel(elId) {
    var el = _q(elId);
    if (!el) return;
    var d = new Date();
    var days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    el.textContent = days[d.getDay()] + ' · ' + months[d.getMonth()] + ' ' + d.getDate();
  }

  /* ── Morning trigger ────────────────────────────────────────────────── */

  function checkMorningPrompt() {
    // Feature disabled in settings?
    if (S.moodCheckInDisabled) return;
    // Already shown today?
    if (_getTodayEntry()) return;
    // Already dismissed today?
    if (S.moodDismissedDate === _todayStr()) return;
    // Is it morning window?
    var h = new Date().getHours();
    if (h < MORNING_START_H || h >= MORNING_END_H) return;
    // Don't show during onboarding
    if (_q('ob-screen') && (_q('ob-screen').style.display !== 'none')) return;

    show('popup');
  }

  /* ── Show popup ─────────────────────────────────────────────────────── */

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
    // Onboarding variant is rendered inline by renderOnboardingFaces()
  }

  /* ── Dismiss (skip today) ───────────────────────────────────────────── */

  function dismiss() {
    S.moodDismissedDate = _todayStr();
    saveS();
    _close();
  }

  function _close() {
    var bd = _q('mood-backdrop');
    if (!bd) return;
    bd.classList.remove('open');
  }

  /* ── Reset popup state ──────────────────────────────────────────────── */

  function _reset(prefix) {
    _selectedMood = null;
    _sparksActive = false;
    if (_animTimer) { clearTimeout(_animTimer); _animTimer = null; }
    _tearTimers.forEach(clearTimeout);
    _tearTimers = [];

    Object.keys(MOODS).forEach(function (k) {
      var item = _q(prefix + '-item-' + k);
      var fw   = _q(prefix + '-fw-' + k);
      if (item) { item.classList.remove('selected'); item.setAttribute('aria-checked','false'); }
      if (fw) fw.style.animation = '';
      _resetAnimEls(prefix, k);
    });

    var divider = _q('mood-popup-divider');
    var tagsSection = _q('mood-popup-tags-section');
    var logArea = _q('mood-popup-log-area');
    var success = _q('mood-popup-success');
    var btn = _q('mood-popup-log-btn');

    if (divider) divider.classList.remove('visible');
    if (tagsSection) tagsSection.classList.remove('visible');
    if (logArea) logArea.style.display = '';
    if (success) success.style.display = 'none';
    if (btn) btn.disabled = true;
  }

  /* ── Select mood ────────────────────────────────────────────────────── */

  function selectMood(mood, prefix) {
    prefix = prefix || (_mode === 'onboarding' ? 'ob-mood' : 'mp');

    // Deselect all
    Object.keys(MOODS).forEach(function (k) {
      var item = _q(prefix + '-item-' + k);
      var fw   = _q(prefix + '-fw-' + k);
      if (item) { item.classList.remove('selected'); item.setAttribute('aria-checked','false'); }
      if (fw) fw.style.animation = '';
      _resetAnimEls(prefix, k);
    });

    _selectedMood = mood;

    var item = _q(prefix + '-item-' + mood);
    var fw   = _q(prefix + '-fw-' + mood);
    if (item) { item.classList.add('selected'); item.setAttribute('aria-checked','true'); }

    _runAnim(mood, fw, prefix);

    if (_mode === 'popup') {
      _showTags(mood, prefix);
      var btn = _q('mood-popup-log-btn');
      if (btn) btn.disabled = false;
      var divider = _q('mood-popup-divider');
      if (divider) divider.classList.add('visible');
    } else {
      // Onboarding: update next-btn state and coach preview
      _obSyncMoodState(mood);
    }
  }

  /* ── Show tags ──────────────────────────────────────────────────────── */

  function _showTags(mood, prefix) {
    var wrap = _q('mood-popup-tags-wrap');
    var section = _q('mood-popup-tags-section');
    if (!wrap || !section) return;

    var list = MOOD_TAGS[mood] || [];
    wrap.innerHTML = '';
    list.forEach(function (tag) {
      var el = document.createElement('div');
      el.className = 'mood-tag';
      el.style.setProperty('--tag-color', tag.c);
      el.setAttribute('role', 'checkbox');
      el.setAttribute('aria-checked', 'false');
      el.setAttribute('tabindex', '0');
      el.onclick = function () { toggleTag(el); };
      el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') toggleTag(el); };
      el.innerHTML = '<span class="mood-tag-icon" aria-hidden="true">' + tag.i + '</span>' + tag.t;
      wrap.appendChild(el);
    });

    section.classList.add('visible');
  }

  /* ── Toggle tag ─────────────────────────────────────────────────────── */

  function toggleTag(el) {
    var isOn = el.classList.toggle('selected');
    el.setAttribute('aria-checked', isOn ? 'true' : 'false');
  }

  /* ── Log mood ───────────────────────────────────────────────────────── */

  function log() {
    if (!_selectedMood) return;
    var mood = _selectedMood;

    // Collect selected tags
    var tags = [];
    var tagEls = document.querySelectorAll('#mood-popup-tags-wrap .mood-tag.selected');
    tagEls.forEach(function (el) { tags.push(el.textContent.trim()); });

    // Save
    _saveEntry(mood, tags);

    // Show success
    var logArea = _q('mood-popup-log-area');
    var tagsSection = _q('mood-popup-tags-section');
    var success  = _q('mood-popup-success');
    var icon     = _q('mood-popup-success-icon');
    var title    = _q('mood-popup-success-title');
    var divider  = _q('mood-popup-divider');

    var m = MOODS[mood];
    if (logArea) logArea.style.display = 'none';
    if (tagsSection) tagsSection.classList.remove('visible');
    if (divider) divider.classList.remove('visible');

    if (icon) {
      icon.style.background    = 'color-mix(in srgb, ' + m.color + ' 15%, transparent)';
      icon.style.borderColor   = 'color-mix(in srgb, ' + m.color + ' 35%, transparent)';
      icon.textContent         = m.successIcon;
    }
    if (title) title.textContent = m.successMsg;

    if (success) {
      success.style.display = 'flex';
      // Reset animation so it re-runs
      success.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      success.offsetHeight; // reflow
      success.style.animation = '';
    }

    // Stop face animation
    _resetAnimEls('mp', mood);
    var fw = _q('mp-fw-' + mood);
    if (fw) fw.style.animation = '';

    // Close after 1.8s
    setTimeout(_close, 1800);

    // Refresh settings section if visible
    setTimeout(renderSettingsSection, 2000);
  }

  /* ── Log from onboarding (Day 0) ────────────────────────────────────── */

  function logOnboardingMood(mood, tags) {
    if (!mood) return;
    _saveEntry(mood, tags || []);
  }

  /* ── Animations ─────────────────────────────────────────────────────── */

  function _resetAnimEls(prefix, mood) {
    if (_animTimer) { clearTimeout(_animTimer); _animTimer = null; }
    _tearTimers.forEach(clearTimeout); _tearTimers = [];
    _sparksActive = false;

    var fw = _q(prefix + '-fw-' + mood);
    if (!fw) return;

    if (mood === 'awful') {
      var fire  = fw.querySelector('.mood-anim-fire');
      var sl    = fw.querySelector('.mood-anim-steam-l');
      var sr    = fw.querySelector('.mood-anim-steam-r');
      if (fire) fire.style.opacity = '0';
      if (sl) { sl.style.opacity = '0'; sl.style.animation = ''; }
      if (sr) { sr.style.opacity = '0'; sr.style.animation = ''; }
    }
    if (mood === 'low') {
      var tl = fw.querySelector('.mood-anim-tear-l');
      var tr = fw.querySelector('.mood-anim-tear-r');
      var el = fw.querySelector('.mood-anim-eye-l');
      var er = fw.querySelector('.mood-anim-eye-r');
      if (tl) { tl.style.opacity = '0'; tl.style.animation = ''; }
      if (tr) { tr.style.opacity = '0'; tr.style.animation = ''; }
      if (el) el.style.opacity = '0';
      if (er) er.style.opacity = '0';
    }
    if (mood === 'okay') {
      var al = fw.querySelector('.mood-anim-arm-l');
      var ar = fw.querySelector('.mood-anim-arm-r');
      if (al) al.style.opacity = '0';
      if (ar) ar.style.opacity = '0';
    }
    if (mood === 'good') {
      var cl = fw.querySelector('.mood-anim-cheek-l');
      var cr = fw.querySelector('.mood-anim-cheek-r');
      if (cl) cl.style.opacity = '.2';
      if (cr) cr.style.opacity = '.2';
    }
    if (mood === 'great') {
      var sp = fw.querySelector('.mood-anim-sparks');
      if (sp) {
        sp.style.opacity = '0';
        var circles = sp.querySelectorAll('circle');
        circles.forEach(function (c) { c.style.animation = ''; });
      }
    }
  }

  function _runAnim(mood, fw, prefix) {
    if (!fw) return;

    if (mood === 'awful') {
      fw.style.animation = 'moodShake .5s cubic-bezier(.36,.07,.19,.97) both';
      _animTimer = setTimeout(function () {
        var fire = fw.querySelector('.mood-anim-fire');
        var sl   = fw.querySelector('.mood-anim-steam-l');
        var sr   = fw.querySelector('.mood-anim-steam-r');
        if (fire) fire.style.opacity = '1';
        if (sl) { sl.style.opacity = '1'; sl.style.animation = 'moodFloat 1.2s ease-in-out infinite'; }
        if (sr) { sr.style.opacity = '1'; sr.style.animation = 'moodFloat 1.2s ease-in-out .3s infinite'; }
      }, 400);
    }

    if (mood === 'low') {
      fw.style.animation = 'moodSink .6s ease forwards';
      var el = fw.querySelector('.mood-anim-eye-l');
      var er = fw.querySelector('.mood-anim-eye-r');
      if (el) el.style.opacity = '1';
      if (er) er.style.opacity = '1';
      _animTimer = setTimeout(function () {
        var tl = fw.querySelector('.mood-anim-tear-l');
        var tr = fw.querySelector('.mood-anim-tear-r');
        function dropTear(tearEl, delay) {
          var tid = setTimeout(function () {
            if (!tearEl) return;
            tearEl.style.opacity = '1';
            tearEl.style.animation = 'moodTearDrop 0.7s ease-in forwards';
            var tid2 = setTimeout(function () {
              tearEl.style.animation = '';
              dropTear(tearEl, 0);
            }, 700);
            _tearTimers.push(tid2);
          }, delay);
          _tearTimers.push(tid);
        }
        dropTear(tl, 0);
        dropTear(tr, 350);
      }, 300);
    }

    if (mood === 'okay') {
      fw.style.animation = 'moodShrug .7s ease-in-out 3';
      var al = fw.querySelector('.mood-anim-arm-l');
      var ar = fw.querySelector('.mood-anim-arm-r');
      if (al) al.style.opacity = '1';
      if (ar) ar.style.opacity = '1';
    }

    if (mood === 'good') {
      fw.style.animation = 'moodBounce .7s cubic-bezier(.34,1.56,.64,1) both';
      var cl = fw.querySelector('.mood-anim-cheek-l');
      var cr = fw.querySelector('.mood-anim-cheek-r');
      if (cl) cl.style.opacity = '.45';
      if (cr) cr.style.opacity = '.45';
    }

    if (mood === 'great') {
      fw.style.animation = 'moodDance 1.2s cubic-bezier(.34,1.56,.64,1) infinite';
      _animTimer = setTimeout(function () {
        if (_sparksActive) return;
        _sparksActive = true;
        var sp = fw.querySelector('.mood-anim-sparks');
        if (sp) {
          sp.style.opacity = '1';
          var circles = sp.querySelectorAll('circle');
          circles.forEach(function (c, i) {
            c.style.animation = 'moodSparkBurst 0.6s ease-out ' + (i * 0.1) + 's infinite';
          });
        }
      }, 200);
    }
  }

  /* ── Onboarding integration ─────────────────────────────────────────── */

  /**
   * Called by app-onboarding.js to render the new face row inside #ob2.
   * Replaces the old 4-button mood system.
   */
  function renderOnboardingFaces(containerId) {
    var el = _q(containerId);
    if (!el) return;
    el.innerHTML = _buildFaceRowHTML('ob-mood', false);
    _mode = 'onboarding';
  }

  function _obSyncMoodState(mood) {
    // Update _obMoodId in onboarding module
    if (typeof window._obMoodId !== 'undefined') window._obMoodId = mood;

    // Enable Continue button
    var btn = _q('ob2-next-btn');
    if (btn) btn.disabled = false;

    // Update coach preview text using onboarding's own function
    var input = _q('ob-name-input');
    if (typeof obUpdateNamePreview === 'function') {
      obUpdateNamePreview(input ? input.value : '');
    }
  }

  /* ── Settings section ───────────────────────────────────────────────── */

  function renderSettingsSection() {
    var el = _q('mood-settings-section');
    if (!el) return;

    var todayEntry  = _getTodayEntry();
    var enabled     = !S.moodCheckInDisabled;
    var moodLabel   = todayEntry ? (MOODS[todayEntry.m] || {}).label || todayEntry.m : null;
    var moodColor   = todayEntry ? (MOODS[todayEntry.m] || {}).color || 'var(--t2)' : 'var(--t2)';

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
    S.moodCheckInDisabled = !val;
    saveS();
    renderSettingsSection();
    toast(val ? 'Mood check-in enabled' : 'Mood check-in paused', 'info');
  }

  function openFromSettings() {
    show('popup');
  }

  /* ── History API (used by Score History chart) ───────────────────────── */

  /**
   * Returns last `days` mood entries.
   * Entries beyond 7 days are PRO-gated — returns empty for free users.
   * @param {number} days
   * @returns {Array<{d:string, m:string, t:string[]}>}
   */
  function getMoodHistory(days) {
    days = days || 30;
    var hist = _getHistory();
    if (days > 7 && !ProTier.isPro) return hist.slice(0, 7);
    return hist.slice(0, days);
  }

  /**
   * Returns mood value (1-5) for a given dateStr, or null.
   * Used by Score History line chart to draw mood overlay.
   */
  function getMoodForDay(dateStr) {
    var MAP = { awful: 1, low: 2, okay: 3, good: 4, great: 5 };
    var entry = (_getHistory()).find(function (e) { return e.d === dateStr; });
    return entry ? (MAP[entry.m] || null) : null;
  }

  /**
   * Returns today's mood id, or null.
   */
  function getTodayMood() {
    var e = _getTodayEntry();
    return e ? e.m : null;
  }

  /* ── Public API ─────────────────────────────────────────────────────── */

  return {
    // Core
    show                : show,
    dismiss             : dismiss,
    selectMood          : selectMood,
    toggleTag           : toggleTag,
    log                 : log,

    // Morning trigger
    checkMorningPrompt  : checkMorningPrompt,

    // Onboarding
    renderOnboardingFaces : renderOnboardingFaces,
    logOnboardingMood     : logOnboardingMood,

    // Settings
    renderSettingsSection : renderSettingsSection,
    setEnabled            : setEnabled,
    openFromSettings      : openFromSettings,

    // History / data
    getMoodHistory  : getMoodHistory,
    getMoodForDay   : getMoodForDay,
    getTodayMood    : getTodayMood,
  };
}());
