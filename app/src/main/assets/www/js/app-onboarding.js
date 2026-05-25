/* ═══════════════════════════════════════════════════════════
   AURELO  |  ONBOARDING v3.0  |  app-onboarding-v3.js

   What's new vs v2.1:
     • Horizontal slide transitions (forward + backward)
     • obBack() — back navigation on steps 1–3
     • Top progress bar updating per step
     • Swipe-right gesture to go back
     • Keyboard-aware name step (hides mood section when KB open)
     • Full-width mood card support (emoji + label + check)
     • Blur dissolve + flash on permission grant
     • Score count-up animation tied to arc fill
     • Grade badge reveal (Excellent / Good / Fair / Start)
     • Arc glow pulse at reveal
     • Canvas confetti at reveal
     • Receipt summary (goal label, app count, Coach ready)
     • obNext() transition guard (blocks double-tap)

   Native bridge compat preserved (same signatures):
     obStep, checkPermAfterResume, updatePermBadge,
     obGrantPerm, finishOb, hideOb, quickStart,
     _finishObScan, runObScan
   ═══════════════════════════════════════════════════════════ */

// ── Module state ─────────────────────────────────────────────
let obStep          = 0;
let _obGoalMins     = 0;
let _obGoalId       = '';
let _obMoodId       = '';
let _obScanIv       = null;
let _scanBufReady   = false;
let _obTransitioning = false;   // NEW: guard against double-tap

const _OB_GOAL_LABELS = {
  light:    '2–3 hours',
  balanced: '3–4 hours',
  heavy:    '4–5 hours'
};

// Progress % per step index
const _OB_PROGRESS = [0, 22, 50, 75, 90, 100];

// ── Subtle UI sounds (Web Audio API) ─────────────────────────
let _obAudioCtx = null;

function _obGetAudio() {
  if (!_obAudioCtx) {
    try { _obAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return null; }
  }
  if (_obAudioCtx.state === 'suspended') _obAudioCtx.resume().catch(() => {});
  return _obAudioCtx;
}

function _obSound(type) {
  const ctx = _obGetAudio();
  if (!ctx) return;
  const t = ctx.currentTime;

  if (type === 'tick') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 0.07);
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.start(t); o.stop(t + 0.1);

  } else if (type === 'mood') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.start(t); o.stop(t + 0.07);

  } else if (type === 'back') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.08);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.start(t); o.stop(t + 0.11);

  } else if (type === 'success') {
    [[523, 0], [659, 0.11], [784, 0.22]].forEach(([freq, delay]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.065, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.22);
      o.start(t + delay); o.stop(t + delay + 0.25);
    });

  } else if (type === 'scan') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 659;
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.start(t); o.stop(t + 0.38);

  } else if (type === 'reveal') {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
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

// ── Progress bar ─────────────────────────────────────────────
function _obUpdateProgress(step) {
  const bar  = document.getElementById('ob-progress-bar');
  const fill = document.getElementById('ob-progress-fill');
  if (!bar || !fill) return;

  if (step === 0) {
    bar.classList.remove('ob-bar-visible');
    return;
  }
  bar.classList.add('ob-bar-visible');
  fill.style.width = (_OB_PROGRESS[step] || 0) + '%';
}

// ── Navigation core ───────────────────────────────────────────
function _obTransition(fromStep, toStep, direction) {
  // direction: 'forward' | 'backward'
  const fromEl = document.getElementById('ob' + fromStep);
  const toEl   = document.getElementById('ob' + toStep);
  if (!toEl) { _obTransitioning = false; return; }

  const exitCls  = direction === 'forward' ? 'ob-exit'       : 'ob-exit-back';
  const enterCls = direction === 'forward' ? 'ob-enter'      : 'ob-enter-back';

  // Exit the current step
  if (fromEl) {
    fromEl.classList.remove('active');
    fromEl.classList.add(exitCls);
    setTimeout(() => fromEl.classList.remove(exitCls), 340);
  }

  // Enter the new step
  toEl.classList.add('active', enterCls);
  setTimeout(() => {
    toEl.classList.remove(enterCls);
    _obTransitioning = false;
  }, 400);

  // Update progress bar
  _obUpdateProgress(toStep);

  // Focus first interactive element
  const first = toEl.querySelector('button:not(.ob-back-btn), input, [tabindex="0"]');
  if (first) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch(_) {} }, 80);
}

function obNext() {
  if (_obTransitioning) return;
  _obTransitioning = true;

  const from = obStep;
  obStep++;

  _obTransition(from, obStep, 'forward');

  if (obStep === 3) _obUpdatePermBadge();
  if (obStep === 4) runObScan();
  if (obStep === 5) _obInitReveal();
}

function obBack() {
  if (_obTransitioning || obStep <= 0) return;
  _obTransitioning = true;
  _obSound('back');

  const from = obStep;
  obStep--;

  _obTransition(from, obStep, 'backward');
}

// ── Swipe gesture (right = back) ─────────────────────────────
function _obSetupSwipe() {
  const screen = document.getElementById('ob-screen');
  if (!screen) return;

  let sx = 0, sy = 0, swiping = false;

  screen.addEventListener('touchstart', e => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    swiping = false;
  }, { passive: true });

  screen.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiping = true;
    }
  }, { passive: true });

  screen.addEventListener('touchend', e => {
    if (!swiping) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    // Swipe right to go back — min 65px, must be more horizontal than vertical
    if (dx > 65 && Math.abs(dy) < Math.abs(dx) * 0.6) {
      // Only allow back on steps 1–3 (not scan/reveal)
      if (obStep >= 1 && obStep <= 3) obBack();
    }
  }, { passive: true });
}

// ── Keyboard-aware name step ──────────────────────────────────
function _obSetupKeyboard() {
  // Use visualViewport if available (most modern WebViews)
  const vv = window.visualViewport;
  if (!vv) return;

  vv.addEventListener('resize', () => {
    const step2 = document.getElementById('ob2');
    if (!step2 || !step2.classList.contains('active')) return;

    // If visible height is < 70% of full height, keyboard is likely open
    const ratio = vv.height / (window.screen.height || window.innerHeight);
    step2.classList.toggle('ob-kb-open', ratio < 0.68);
  });
}

// ── Step 1 — Goal ─────────────────────────────────────────────
function obGoalSelect(id, mins) {
  ['light', 'balanced', 'heavy'].forEach(g => {
    const card = document.getElementById('ob-gc-' + g);
    const arc  = document.getElementById('ob-arc-' + g);
    if (card) { card.classList.remove('ob-goal-card--selected'); card.setAttribute('aria-checked', 'false'); }
    if (arc)  arc.style.display = 'none';
  });

  const card = document.getElementById('ob-gc-' + id);
  const arc  = document.getElementById('ob-arc-' + id);
  if (card) { card.classList.add('ob-goal-card--selected'); card.setAttribute('aria-checked', 'true'); }
  if (arc)  arc.style.display = 'flex';

  _obGoalId   = id;
  _obGoalMins = mins;

  S.streakGoalMins = mins;
  saveS();

  _obSound('tick');

  const btn = document.getElementById('ob1-next-btn');
  if (btn) {
    btn.disabled = false;
    btn.setAttribute('aria-disabled', 'false');
    btn.classList.remove('ob-btn--disabled');
    btn.textContent = 'Lock in ' + (_OB_GOAL_LABELS[id] || '') + ' →';
  }
}

function obGoalNext() {
  if (!_obGoalId) return;
  obNext();
}

// ── Step 2 — Mood ─────────────────────────────────────────────
function obMoodSelect(mood, emoji) {
  ['chill', 'motivated', 'frustrated', 'zen'].forEach(m => {
    const btn = document.getElementById('ob-mood-' + m);
    if (!btn) return;
    btn.classList.remove('selected');
    // Reset check mark text
    const chk = btn.querySelector('.ob-mood-check');
    if (chk) chk.textContent = '';
  });

  const btn = document.getElementById('ob-mood-' + mood);
  if (btn) {
    btn.classList.add('selected');
    const chk = btn.querySelector('.ob-mood-check');
    if (chk) chk.textContent = '✓';
  }

  _obMoodId = mood;
  S.onboardingMood = mood;
  saveS();

  _obSound('mood');

  const name = (document.getElementById('ob-name-input') || {}).value || '';
  obUpdateNamePreview(name);
}

// ── Step 2 — Name ─────────────────────────────────────────────
const _OB_MOOD_LINES = {
  chill:       'Take it easy — your score builds automatically.',
  motivated:   'That energy shows. Let\'s channel it into your score.',
  frustrated:  'Totally valid. Aurelo will show you exactly what\'s draining you.',
  zen:         'Perfect headspace. Your focus score will love this.',
};

function obUpdateNamePreview(val) {
  const el  = document.getElementById('ob-coach-preview-txt');
  const btn = document.getElementById('ob2-next-btn');
  if (!el) return;

  const name     = val.trim();
  const moodLine = _obMoodId
    ? _OB_MOOD_LINES[_obMoodId]
    : 'Your score is building — check in tomorrow for your first insight.';

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

// ── Step 3 — Permission ───────────────────────────────────────
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
  badge.className = 'ob-usage-badge ' +
    (granted ? 'ob-usage-badge--granted' : 'ob-usage-badge--pending');
  badge.textContent = granted ? 'Granted ✓' : 'Tap to grant';
  btn.textContent   = granted ? 'Continue →' : 'Grant & unlock my data';

  const card = document.getElementById('ob-perm-usage');
  if (card) card.style.borderColor = granted ? 'rgba(18,212,138,.35)' : '';

  if (granted) {
    _obSound('success');
    _obPermReveal();
  }
}

function _obPermReveal() {
  const blur    = document.querySelector('#ob3 .ob-perm-blur-content');
  const overlay = document.querySelector('#ob3 .ob-perm-overlay');
  const flash   = document.querySelector('#ob3 .ob-perm-flash');

  if (blur)    blur.classList.add('ob-perm-revealed');
  if (overlay) overlay.classList.add('ob-perm-hidden');
  if (flash) {
    // Tiny delay so the blur transition starts first
    setTimeout(() => flash.classList.add('ob-perm-flash-active'), 80);
  }
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

// ── Step 4 — Scan ─────────────────────────────────────────────
function runObScan() {
  const fill = document.getElementById('ob-scan-fill');
  const txt  = document.getElementById('ob-scan-txt');
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
      clearInterval(_obScanIv); _obScanIv = null;
      txt.textContent = 'Waiting for scan…';
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
        if (a[0] === 'Unassigned') return 1;
        if (b[0] === 'Unassigned') return -1;
        return b[1] - a[1];
      });

    entries.forEach(([name, n], i) => {
      setTimeout(() => {
        const icon = (typeof CAT_ICONS !== 'undefined' && CAT_ICONS[name]) || '📱';
        const row  = document.createElement('div');
        row.className = 'scan-row';
        row.setAttribute('role', 'listitem');
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
      }, i * 200);
    });

    setTimeout(() => {
      if (btn && btn.style.display === 'none') btn.style.display = '';
    }, 3500);
  }
}

// ── Step 5 — Reveal ───────────────────────────────────────────
function _obInitReveal() {
  _obSound('reveal');

  // Personalise title
  const name  = (S.userName || '').trim();
  const title = document.getElementById('ob-reveal-title');
  if (title) {
    title.textContent = name ? 'You\'re all set, ' + name + '.' : 'You\'re all set.';
  }

  // Show arc glow
  const glow = document.getElementById('ob-arc-glow-ring');
  if (glow) setTimeout(() => glow.classList.add('ob-glow-fire'), 300);

  // Default partial fill while we wait for real score
  const arcFill = document.getElementById('ob-arc-fill');
  const scoreEl = document.getElementById('ob-score-num');

  // Launch confetti slightly after reveal enters
  setTimeout(_obConfetti, 450);

  // Show receipt rows with stagger
  document.querySelectorAll('#ob5 .ob-receipt-row').forEach(r => {
    r.classList.add('ob-row-show');
  });

  // Populate receipt summary
  const goalLabel   = _OB_GOAL_LABELS[_obGoalId] || '—';
  const receiptGoal = document.getElementById('ob-receipt-goal');
  if (receiptGoal) receiptGoal.textContent = goalLabel + ' daily limit';

  const catsMap   = typeof CATS_MAP !== 'undefined' ? CATS_MAP : {};
  const totalApps = Object.values(catsMap).reduce((n, a) => n + a.length, 0);
  const catCount  = Object.keys(catsMap).length;
  const receiptApps = document.getElementById('ob-receipt-apps');
  if (receiptApps && totalApps > 0) {
    receiptApps.textContent = totalApps + ' apps across ' + catCount + ' categories';
  }

  // Compute score and fill arc — use same path as Home so values match
  let screenScore = 72; // fallback

  if (IS_NATIVE && _obHasPerm()) {
    try {
      // Prefer the real composite Aurelo Score (same as Home card)
      if (typeof _computeAureloScore === 'function') {
        const a = _computeAureloScore();
        if (a && a.overall >= 0) screenScore = a.overall;
      } else if (typeof FocusScore !== 'undefined' &&
                 typeof FocusScore.calculateAurelo === 'function') {
        const a = FocusScore.calculateAurelo();
        if (a && a.score >= 0) screenScore = a.score;
      }

      const totalMins = (typeof N.getTotalScreenTimeToday === 'function')
        ? (N.getTotalScreenTimeToday() || 0) : 0;
      const pickups   = (typeof N.getPickupCountToday === 'function')
        ? (N.getPickupCountToday() || 0)    : 0;

      // Update subtitle
      const hh = Math.floor(totalMins / 60), mm = totalMins % 60;
      const timeStr = hh > 0 ? hh + 'h ' + mm + 'm' : (mm > 0 ? mm + 'm' : '—');
      const basEl = document.querySelector('#ob5 .ob-score-baseline');
      if (basEl) basEl.textContent = 'Screen Score · ' + timeStr + ' used · ' + pickups + ' pickups';

      // Top app
      try {
        const usageRaw = N.getDailyUsageStats ? N.getDailyUsageStats() : '[]';
        const usage    = JSON.parse(usageRaw);
        if (usage && usage.length) {
          const tiles = document.querySelectorAll('#ob5 .ob-pillar-tile');
          if (tiles[0]) tiles[0].querySelector('.ob-pillar-val').textContent = timeStr;
          if (tiles[1]) tiles[1].querySelector('.ob-pillar-val').textContent = pickups + ' picks';
          if (tiles[2]) {
            tiles[2].querySelector('.ob-pillar-val').textContent  = '📱';
            tiles[2].querySelector('.ob-pillar-name').textContent = usage[0].name.split(' ')[0];
            tiles[2].querySelector('.ob-pillar-sub').textContent  = 'today';
          }
        }
      } catch(e) {}
    } catch(e) { /* stays at fallback */ }
  }

  // Count-up score number + arc fill simultaneously
  scoreEl && setTimeout(() => {
    scoreEl.classList.add('ob-score-counting');
    _obCountUp(scoreEl, screenScore, 1500, pct => {
      if (arcFill) {
        arcFill.style.strokeDashoffset = String(Math.round(182 - (pct / 100) * 182));
      }
    });
    // Show grade badge near the end
    setTimeout(() => _obShowGrade(screenScore), 900);
  }, 380);

  // Personalise Coach nudge
  const nudge = document.getElementById('ob-coach-nudge-txt');
  if (nudge && name) {
    nudge.innerHTML =
      'Hey <strong style="color:var(--p2)">' + _obEsc(name) + '</strong>, ' +
      'your first personalised insight will be ready tomorrow morning.';
  }
}

// ── Count-up helper ───────────────────────────────────────────
function _obCountUp(el, target, durationMs, onTick) {
  if (!el || target == null) return;
  const start = performance.now();

  const step = now => {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / durationMs, 1);
    // Ease-out cubic
    const eased   = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * eased);
    el.textContent = current;
    if (onTick) onTick(current);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target;
  };

  requestAnimationFrame(step);
}

// ── Grade badge helper ────────────────────────────────────────
function _obShowGrade(score) {
  const badge = document.getElementById('ob-grade-badge');
  if (!badge) return;

  let text, cls;
  if      (score >= 85) { text = '⭐ Excellent start'; cls = 'ob-badge-excellent'; }
  else if (score >= 70) { text = '✓ Good start';       cls = 'ob-badge-good'; }
  else if (score >= 55) { text = '→ Fair';              cls = 'ob-badge-fair'; }
  else                  { text = '↑ Building';          cls = 'ob-badge-start'; }

  badge.textContent = text;
  badge.className   = '';              // clear
  badge.classList.add(cls, 'ob-badge-show');
}

// ── Canvas confetti ───────────────────────────────────────────
function _obConfetti() {
  const canvas = document.getElementById('ob-confetti-canvas');
  if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('ob-confetti-active');

  const ctx    = canvas.getContext('2d');
  const colors = ['#6c63ff','#9b94ff','#05c8e8','#12d48a','#f7a623','#f04e7a','#ffffff'];
  const pieces = [];

  for (let i = 0; i < 68; i++) {
    pieces.push({
      x:     Math.random() * canvas.width,
      y:     -12 - Math.random() * 60,
      r:     2.5 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx:    (Math.random() - 0.5) * 3.2,
      vy:    2.2 + Math.random() * 4.5,
      rot:   Math.random() * 360,
      rotV:  (Math.random() - 0.5) * 9,
      alpha: 1,
      shape: Math.random() > 0.45 ? 'rect' : 'circle'
    });
  }

  let frame = 0;
  const MAX_FRAMES = 130;

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let anyAlive = false;

    pieces.forEach(p => {
      if (p.alpha <= 0) return;
      anyAlive = true;
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += 0.09;                    // gravity
      p.rot += p.rotV;
      if (p.y > canvas.height * 0.65) p.alpha -= 0.022;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.r * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    frame++;
    if (anyAlive && frame < MAX_FRAMES) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.remove('ob-confetti-active');
    }
  };

  requestAnimationFrame(draw);
}

// ── Finish & teardown ─────────────────────────────────────────
function finishOb() {
  if (_obGoalMins > 0) S.streakGoalMins = _obGoalMins;
  S.onboardingDone = true;
  saveS();

  if (IS_NATIVE) {
    try { N.setOnboardingDone(); } catch(_) {}
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
  setTimeout(() => { el.style.display = 'none'; }, 420);
}

// ── Hook entrance ─────────────────────────────────────────────
function _obStartHook() {
  const step = document.getElementById('ob0');
  if (step) step.classList.add('ob-hook-ready');

  const notes   = [587, 740, 880];
  const timings = [100, 500, 900];
  timings.forEach((ms, i) => {
    setTimeout(() => {
      const ctx = _obGetAudio();
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = notes[i];
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.start(t); o.stop(t + 0.25);
    }, ms);
  });

  // Init swipe and keyboard listeners on first display
  _obSetupSwipe();
  _obSetupKeyboard();
}

// ── Utilities ─────────────────────────────────────────────────
function _obEsc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Legacy stubs ──────────────────────────────────────────────
function obSaveName()   { /* replaced by obSaveNameAndNext() */ }
function obSelectGoal() { /* replaced by obGoalSelect() */ }