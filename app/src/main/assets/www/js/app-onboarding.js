/* ═══════════════════════════════════════════════════════════
   AURELO  |  ONBOARDING v2.1  |  app-onboarding.js

   6-step flow:
     0  Hook        — emotional urgency, stat strip
     1  Goal        — writes S.streakGoalMins directly
     2  Name + Mood — optional name, mood picker feeds coach tone
     3  Permission  — value checklist before the ask
     4  Scan        — deterministic, Unassigned sorted last
     5  Reveal      — celebration header, what-happens-next, sounds

   Native bridge compatibility preserved:
     obStep, checkPermAfterResume, updatePermBadge, obGrantPerm,
     finishOb, hideOb, quickStart, _finishObScan, runObScan
   ═══════════════════════════════════════════════════════════ */

// ── Module state ─────────────────────────────────────────────────────────────
let obStep        = 0;
let _obGoalMins   = 0;
let _obGoalId     = '';
let _obMoodId     = '';
let _obScanIv     = null;
let _scanBufReady = false;

const _OB_GOAL_LABELS = { light:'2-3 hours', balanced:'3–4 hours', heavy:'4–5 hours' };

// ── Subtle UI sounds (Web Audio API — no files needed) ───────────────────────
let _obAudioCtx = null;

function _obGetAudio() {
  if (!_obAudioCtx) {
    try {
      _obAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) { return null; }
  }
  if (_obAudioCtx.state === 'suspended') {
    _obAudioCtx.resume().catch(() => {});
  }
  return _obAudioCtx;
}

function _obSound(type) {
  const ctx = _obGetAudio();
  if (!ctx) return;
  const t = ctx.currentTime;

  if (type === 'tick') {
    // Goal card selected — soft pop
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 0.07);
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.start(t); o.stop(t + 0.1);

  } else if (type === 'mood') {
    // Mood selected — lighter tap
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.start(t); o.stop(t + 0.07);

  } else if (type === 'success') {
    // Permission granted — ascending C5–E5–G5 chime
    [[523, 0], [659, 0.11], [784, 0.22]].forEach(([freq, delay]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.065, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.22);
      o.start(t + delay); o.stop(t + delay + 0.25);
    });

  } else if (type === 'scan') {
    // Scan complete — single soft ding
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 659;
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.start(t); o.stop(t + 0.38);

  } else if (type === 'reveal') {
    // Reveal entrance — gentle rising whoosh + chord
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g  = ctx.createGain();
    o1.connect(g); o2.connect(g); g.connect(ctx.destination);
    o1.type = 'sine'; o1.frequency.setValueAtTime(392, t);
    o1.frequency.exponentialRampToValueAtTime(784, t + 0.45);
    o2.type = 'sine'; o2.frequency.setValueAtTime(494, t);
    o2.frequency.exponentialRampToValueAtTime(988, t + 0.45);
    g.gain.setValueAtTime(0.04, t);
    g.gain.setValueAtTime(0.04, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o1.start(t); o1.stop(t + 0.62);
    o2.start(t); o2.stop(t + 0.62);
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function obNext() {
  const cur = document.getElementById('ob' + obStep);
  if (cur) cur.classList.remove('active');

  obStep++;

  const nxt = document.getElementById('ob' + obStep);
  if (nxt) {
    nxt.classList.add('active');
    const first = nxt.querySelector('button,input,[tabindex="0"]');
    if (first) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch(_) {} }, 50);
  }

  if (obStep === 3) _obUpdatePermBadge();
  if (obStep === 4) runObScan();
  if (obStep === 5) _obInitReveal();
}

// ── Step 1 — Goal ─────────────────────────────────────────────────────────────
function obGoalSelect(id, mins) {
  ['light','balanced','heavy'].forEach(g => {
    const card = document.getElementById('ob-gc-' + g);
    const arc  = document.getElementById('ob-arc-' + g);
    if (card) { card.classList.remove('ob-goal-card--selected'); card.setAttribute('aria-checked','false'); }
    if (arc)  arc.style.display = 'none';
  });

  const card = document.getElementById('ob-gc-' + id);
  const arc  = document.getElementById('ob-arc-' + id);
  if (card) { card.classList.add('ob-goal-card--selected'); card.setAttribute('aria-checked','true'); }
  if (arc)  arc.style.display = 'flex';

  _obGoalId   = id;
  _obGoalMins = mins;

  // Write directly to the state field the Home arc actually uses
  S.streakGoalMins = mins;
  saveS();

  _obSound('tick');

  const btn = document.getElementById('ob1-next-btn');
  if (btn) {
    btn.disabled = false;
    btn.setAttribute('aria-disabled','false');
    btn.classList.remove('ob-btn--disabled');
    btn.textContent = 'Lock in ' + (_OB_GOAL_LABELS[id] || '') + ' →';
  }
}

function obGoalNext() {
  if (!_obGoalId) return;
  obNext();
}

// ── Step 2 — Mood picker ──────────────────────────────────────────────────────
function obMoodSelect(mood, emoji) {
  ['chill','motivated','frustrated','zen'].forEach(m => {
    const btn = document.getElementById('ob-mood-' + m);
    if (btn) btn.classList.remove('selected');
  });

  const btn = document.getElementById('ob-mood-' + mood);
  if (btn) btn.classList.add('selected');

  _obMoodId = mood;
  S.onboardingMood = mood;
  saveS();

  _obSound('mood');

  // Update coach preview if name already typed
  const name = (document.getElementById('ob-name-input') || {}).value || '';
  obUpdateNamePreview(name);
}

// ── Step 2 — Name ─────────────────────────────────────────────────────────────
const _OB_MOOD_LINES = {
  chill:      'Take it easy today — your score is already building.',
  motivated:  'That energy shows. Let\'s channel it into your score.',
  frustrated: 'Totally valid. Aurelo will help you see what\'s draining you.',
  zen:        'Perfect headspace. Your focus score will love this.',
};

function obUpdateNamePreview(val) {
  const el   = document.getElementById('ob-coach-preview-txt');
  const btn  = document.getElementById('ob2-next-btn');
  const name = val.trim();
  if (!el) return;

  const moodLine = _obMoodId ? _OB_MOOD_LINES[_obMoodId] : 'Your score is building — check in tomorrow for your first insight.';

  if (name) {
    el.innerHTML =
      'Good morning, <strong style="color:var(--p2)">' + _obEsc(name) + '</strong>. ' +
      moodLine;
  } else {
    el.innerHTML = '<span class="ob-placeholder">Type your name to see how Coach greets you</span>';
  }

  if (btn) btn.textContent = name ? 'Continue as ' + _obEsc(name) + ' →' : 'Continue';
}

function obSaveNameAndNext() {
  const input = document.getElementById('ob-name-input');
  const name  = input ? input.value.trim() : '';
  S.userName = name;
  saveS();
  obNext();
}

// ── Step 3 — Permission ───────────────────────────────────────────────────────
function _obHasPerm() {
  return IS_NATIVE &&
    typeof N.hasUsagePermission === 'function' &&
    N.hasUsagePermission();
}

function _obUpdatePermBadge() {
  const badge = document.getElementById('ob-usage-badge');
  const btn   = document.getElementById('ob3-grant-btn');
  if (!badge || !btn) return;

  const granted = _obHasPerm();
  badge.className = 'ob-usage-badge ' + (granted ? 'ob-usage-badge--granted' : 'ob-usage-badge--pending');
  badge.textContent = granted ? 'Granted ✓' : 'Tap to grant';
  btn.textContent   = granted ? 'Continue →' : 'Grant & unlock my data';

  const card = document.getElementById('ob-perm-usage');
  if (card) card.style.borderColor = granted ? 'rgba(18,212,138,.35)' : '';

  if (granted) _obSound('success');
}

function obGrantUsage() {
  if (IS_NATIVE && typeof N.requestUsagePermission === 'function') {
    N.requestUsagePermission();
  }
}

function obHandlePermStep() {
  if (_obHasPerm()) { obNext(); }
  else              { obGrantUsage(); }
}

function checkPermAfterResume() {
  if (obStep !== 3) return;
  _obUpdatePermBadge();
  if (_obHasPerm()) { setTimeout(obNext, 700); }
}

function updatePermBadge() { _obUpdatePermBadge(); }
function obGrantPerm()     { obGrantUsage(); }

// ── Step 4 — Scan ─────────────────────────────────────────────────────────────
function runObScan() {
  const fill    = document.getElementById('ob-scan-fill');
  const txt     = document.getElementById('ob-scan-txt');
  if (!fill) return;

  if (scanReadyForOnboarding || _scanBufReady) {
    txt.textContent = 'Analysing apps…';
    fill.style.transition = 'width 0.55s ease';
    fill.style.width = '100%';
    setTimeout(_finishObScan, 700);
    return;
  }

  let pct = 0;
  if (_obScanIv) { clearInterval(_obScanIv); _obScanIv = null; }
  txt.textContent = 'Scanning installed apps…';

  _obScanIv = setInterval(() => {
    pct = Math.min(pct + 3.5, 82);
    fill.style.width = pct + '%';
    if (pct >= 82) {
      clearInterval(_obScanIv);
      _obScanIv = null;
      txt.textContent = 'Waiting for scan to complete…';
    }
  }, 100);
}

function _finishObScan() {
  if (obStep !== 4) { _scanBufReady = true; return; }
  if (_obScanIv) { clearInterval(_obScanIv); _obScanIv = null; }

  const fill    = document.getElementById('ob-scan-fill');
  const txt     = document.getElementById('ob-scan-txt');
  const rows    = document.getElementById('ob-scan-rows');
  const btn     = document.getElementById('ob4-done-btn');
  const countEl = document.getElementById('ob-scan-count');
  if (!fill) return;

  fill.style.transition = 'width 0.4s ease';
  fill.style.width = '100%';

  const catsMap = CATS_MAP || {};
  const catKeys = Object.keys(catsMap);
  const total   = Object.values(catsMap).reduce((n, a) => n + a.length, 0);

  txt.textContent = 'Found ' + total + ' apps in ' + catKeys.length + ' categories ✓';
  if (countEl) countEl.textContent = 'Found ' + total + ' apps across ' + catKeys.length + ' categories';

  _obSound('scan');

  if (rows) {
    rows.innerHTML = '';
    rows.style.display = 'flex';

    const entries = catKeys
      .map(c => [c, catsMap[c].length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => {
        // Unassigned always last — showing it first was demotivating
        if (a[0] === 'Unassigned') return 1;
        if (b[0] === 'Unassigned') return -1;
        return b[1] - a[1];
      });

    entries.forEach(([name, n], i) => {
      setTimeout(() => {
        const icon = (typeof CAT_ICONS !== 'undefined' && CAT_ICONS[name]) || '📱';
        const row  = document.createElement('div');
        row.className = 'scan-row';
        row.setAttribute('role','listitem');
        row.setAttribute('aria-label', name + ', ' + n + ' apps');
        row.innerHTML =
          '<div class="scan-tick" aria-hidden="true">✓</div>' +
          '<span style="font-size:16px;flex-shrink:0" aria-hidden="true">' + icon + '</span>' +
          '<div class="scan-name">' + _obEsc(name) + '</div>' +
          '<div class="scan-n">' + n + ' app' + (n !== 1 ? 's' : '') + '</div>';
        rows.appendChild(row);

        if (i === entries.length - 1) {
          setTimeout(() => { if (btn) btn.style.display = ''; }, 500);
        }
      }, i * 220);
    });

    setTimeout(() => {
      if (btn && btn.style.display === 'none') btn.style.display = '';
    }, 3500);
  }
}

// ── Step 5 — Reveal ───────────────────────────────────────────────────────────
function _obInitReveal() {
  _obSound('reveal');

  // Personalise celebration title with user name
  const name  = (S.userName || '').trim();
  const title = document.getElementById('ob-reveal-title');
  if (title) {
    title.textContent = name ? 'You\'re all set, ' + name + '.' : 'You\'re all set.';
  }

  // Arc animation — partial fill (just started)
  requestAnimationFrame(() => {
    setTimeout(() => {
      const arc = document.getElementById('ob-arc-fill');
      if (arc) {
        arc.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        arc.style.strokeDashoffset = '155';
      }
      // Bounce the score card
      const card = document.querySelector('#ob5 .ob-score-card');
      if (card) {
        card.style.transform = 'scale(1.03)';
        setTimeout(() => {
          card.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)';
          card.style.transform = 'scale(1)';
        }, 80);
      }
    }, 320);
  });

  // Show real today's data if permission was granted
  if (IS_NATIVE && _obHasPerm()) {
    try {
      const totalMs   = (typeof N.getTotalScreenTimeToday === 'function') ? N.getTotalScreenTimeToday() : 0;
      const pickups   = (typeof N.getPickupCountToday    === 'function') ? N.getPickupCountToday()    : 0;
      const goalMs    = (_obGoalMins || S.streakGoalMins || 120) * 60000;

      // Format screen time
      // Was: const totalMs = N.getTotalScreenTimeToday(); const totalMins = Math.round(totalMs / 60000);
      const totalMins = (typeof N.getTotalScreenTimeToday === 'function') ? (N.getTotalScreenTimeToday() || 0) : 0;
      const hh = Math.floor(totalMins / 60), mm = totalMins % 60;
      const timeStr = hh > 0 ? hh + 'h ' + mm + 'm' : (mm > 0 ? mm + 'm' : '—');
      // Simple Screen Score: goal adherence 50% + pickup component 30% + first-use 20%
      const adherence = totalMs <= goalMs
        ? 100
        : Math.max(0, 100 - ((totalMs - goalMs) / (goalMs * 0.5)) * 100);
      const pickupScore = Math.max(0, 100 - Math.max(0, pickups - 60) * 2); // rough
      const screenScore = Math.round(adherence * 0.5 + pickupScore * 0.3 + 80 * 0.2);

      // Fetch top app from daily usage stats
      let topAppName = '—';
      try {
        const usageRaw = N.getDailyUsageStats ? N.getDailyUsageStats() : '[]';
        const usage = JSON.parse(usageRaw);
        if (usage && usage.length > 0) topAppName = usage[0].name;
      } catch(e) {}

      // Update score number
      const scoreEl = document.getElementById('ob-score-num');
      if (scoreEl) {
        scoreEl.textContent = screenScore;
        scoreEl.removeAttribute('aria-label');
      }

      // Update arc fill to match score (182 = full arc dasharray)
      const arcFill = document.getElementById('ob-arc-fill');
      if (arcFill) {
        const offset = Math.round(182 - (screenScore / 100) * 182);
        setTimeout(() => {
          arcFill.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
          arcFill.style.strokeDashoffset = offset;
        }, 320);
      }

      // Update subtitle
      const baselineEl = document.querySelector('#ob5 .ob-score-baseline');
      if (baselineEl) baselineEl.textContent = 'Screen Score · ' + timeStr + ' used · ' + pickups + ' pickups';

      // Update pillar tiles with real values
      const tiles = document.querySelectorAll('#ob5 .ob-pillar-tile');
      if (tiles[0]) { tiles[0].querySelector('.ob-pillar-val').textContent = timeStr; }
      if (tiles[1]) { tiles[1].querySelector('.ob-pillar-val').textContent = pickups + ' picks'; }
      if (tiles[2]) {
        tiles[2].querySelector('.ob-pillar-val').textContent = topAppName !== '—' ? '📱' : '—';
        tiles[2].querySelector('.ob-pillar-name').textContent = topAppName !== '—' ? topAppName.split(' ')[0] : 'Top App';
        tiles[2].querySelector('.ob-pillar-sub').textContent  = topAppName !== '—' ? 'today' : 'none yet';
        // Update the CSS color var to match the other tiles (no longer sleep's purple)
        tiles[2].style.setProperty('--ptc', 'var(--a)');
      }

    } catch(e) { /* fail silently — stays as — */ }
  }

  // Personalise Coach nudge
  const nudge = document.getElementById('ob-coach-nudge-txt');
  if (nudge && name) {
    nudge.innerHTML =
      'Hey <strong style="color:var(--p2)">' + _obEsc(name) + '</strong>, ' +
      'your first personalised insight will be ready tomorrow morning.';
  }
}

// ── Finish & teardown ─────────────────────────────────────────────────────────
function finishOb() {
  if (_obGoalMins > 0) {
    S.streakGoalMins = _obGoalMins;
  }
  S.onboardingDone = true;
  saveS();

  if (IS_NATIVE) {
    try { N.setOnboardingDone(); } catch (_) {}
  }

  _isFirstBoot = true;
  hideOb();
  bootApp();

  if (IS_NATIVE &&
      typeof N.hasUsagePermission === 'function' &&
      N.hasUsagePermission()) {
    setTimeout(() => { nCall('triggerBackgroundScan'); }, 500);
  }
}

function quickStart() { finishOb(); }

function hideOb() {
  const el = document.getElementById('ob-screen');
  if (!el) return;
  el.style.transition = 'opacity .4s, transform .4s';
  el.style.opacity    = '0';
  el.style.transform  = 'scale(.96)';
  setTimeout(() => { el.style.display = 'none'; }, 400);
}

function _obStartHook() {
  const step = document.getElementById('ob0');
  if (step) step.classList.add('ob-hook-ready');

  // Sounds timed to match CSS delays above
  const notes   = [587, 740, 880]; // D5, F#5, A5
  const timings = [100, 500, 900];
  timings.forEach((ms, i) => {
    setTimeout(() => {
      const ctx = _obGetAudio();
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = notes[i];
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.25);
    }, ms);
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _obEsc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Legacy stubs ──────────────────────────────────────────────────────────────
function obSaveName()   { /* replaced by obSaveNameAndNext() */ }
function obSelectGoal() { /* replaced by obGoalSelect() */ }