/* ═══════════════════════════════════════════════════════════
   AURELO  |  ONBOARDING v2  |  app-onboarding.js
   Replaces: js/app-onboarding.js

   6-step flow:
     0  Hook        — emotional urgency, no escape hatch
     1  Goal        — writes S.streakGoalMins directly (was userGoals[] never read)
     2  Name        — optional, writes S.userName, personalises Coach
     3  Permission  — grant Usage Access
     4  Scan        — deterministic, no Math.random()
     5  Reveal      — score baseline cliffhanger + Coach nudge

   Native bridge compatibility preserved:
     obStep               — read by app-core.js (onPageReady / onScanComplete)
     checkPermAfterResume — called by native on Activity.onResume
     updatePermBadge      — alias called by native
     obGrantPerm          — alias called by native
     finishOb             — unchanged behaviour
     hideOb               — unchanged
     quickStart           — unchanged
     _finishObScan        — called by app-core.js onScanComplete when obStep === 4
     runObScan            — called by obNext when entering step 4
   ═══════════════════════════════════════════════════════════ */

// ── Module state ─────────────────────────────────────────────────────────────
let obStep       = 0;    // current step index (0-5) — read by app-core.js
let _obGoalMins  = 0;    // goal selected in step 1 (minutes)
let _obGoalId    = '';   // 'light' | 'balanced' | 'heavy'
let _obScanIv    = null; // interval handle for scan progress animation
let _scanBufReady= false;// true if CATS_MAP arrived before user reached step 4

// Goal id → display label map (used for CTA text)
const _OB_GOAL_LABELS = { light:'1–2 hours', balanced:'2–3 hours', heavy:'3–4 hours' };

// ── Navigation ────────────────────────────────────────────────────────────────
function obNext() {
  const cur = document.getElementById('ob' + obStep);
  if (cur) cur.classList.remove('active');

  obStep++;

  const nxt = document.getElementById('ob' + obStep);
  if (nxt) {
    nxt.classList.add('active');
    // Focus the first focusable child for accessibility
    const first = nxt.querySelector('button,input,[tabindex="0"]');
    if (first) { setTimeout(() => { try { first.focus({ preventScroll: true }); } catch(_) {} }, 50); }
  }

  // Per-step init hooks
  if (obStep === 3) _obUpdatePermBadge();
  if (obStep === 4) runObScan();
  if (obStep === 5) _obInitReveal();
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Goal commitment
// Writes S.streakGoalMins immediately — this is real functional data,
// not the old userGoals[] array that was saved but never consumed anywhere.
// ─────────────────────────────────────────────────────────────────────────────
function obGoalSelect(id, mins) {
  // Deselect all cards
  ['light', 'balanced', 'heavy'].forEach(g => {
    const card = document.getElementById('ob-gc-' + g);
    const arc  = document.getElementById('ob-arc-' + g);
    if (card) {
      card.classList.remove('ob-goal-card--selected');
      card.setAttribute('aria-checked', 'false');
    }
    if (arc) arc.style.display = 'none';
  });

  // Select chosen card
  const card = document.getElementById('ob-gc-' + id);
  const arc  = document.getElementById('ob-arc-' + id);
  if (card) {
    card.classList.add('ob-goal-card--selected');
    card.setAttribute('aria-checked', 'true');
  }
  if (arc) arc.style.display = 'flex';

  _obGoalId   = id;
  _obGoalMins = mins;

  // ── Write to state immediately (not on finish) ──
  // This is the key fix: the old flow saved to userGoals[] which was never
  // read anywhere in the codebase. This writes directly to the field that
  // the Home arc, streak, and Aurelo Score actually use.
  S.streakGoalMins = mins;
  saveS();

  // Unlock and label CTA
  const btn = document.getElementById('ob1-next-btn');
  if (btn) {
    btn.disabled = false;
    btn.setAttribute('aria-disabled', 'false');
    btn.classList.remove('ob-btn--disabled');
    btn.textContent = 'Lock in ' + (_OB_GOAL_LABELS[id] || '') + ' →';
  }
}

function obGoalNext() {
  if (!_obGoalId) return; // guard: CTA should already be disabled, but be safe
  obNext();
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Name (optional)
// Writes S.userName. Old obSaveName() was a dead stub — name input had been
// removed but the field was still used by Coach greeting and personalisation.
// ─────────────────────────────────────────────────────────────────────────────
function obUpdateNamePreview(val) {
  const el   = document.getElementById('ob-coach-preview-txt');
  const btn  = document.getElementById('ob2-next-btn');
  const name = val.trim();
  if (!el) return;

  if (name) {
    el.innerHTML =
      'Good morning, <strong style="color:var(--p2)">' + _obEsc(name) + '</strong>. ' +
      'Your score is building — you had a good focus day yesterday.';
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Permission
// ─────────────────────────────────────────────────────────────────────────────
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
  btn.textContent   = granted ? 'Continue →' : 'Grant Access & Unblur →';

  const card = document.getElementById('ob-perm-usage');
  if (card) card.style.borderColor = granted ? 'rgba(18,212,138,.35)' : '';
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

// Called by native (Activity.onResume) after user returns from Android Settings
function checkPermAfterResume() {
  if (obStep !== 3) return;
  _obUpdatePermBadge();
  if (_obHasPerm()) { setTimeout(obNext, 700); }
}

// Native bridge aliases (called directly by Kotlin/Java in some builds)
function updatePermBadge() { _obUpdatePermBadge(); }
function obGrantPerm()     { obGrantUsage(); }

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Scan
//
// KEY FIX: The old implementation used Math.random() * 7 + 2 and capped
// at 85% waiting for real data. This created a fake progress bar that
// users (especially power users) noticed.
//
// New approach:
//  - If CATS_MAP is already populated (alreadyDone path or fast device),
//    finish the scan immediately with a brief animation.
//  - Otherwise, animate smoothly to 82% then hold — no random jumps.
//    When app-core.js fires onScanComplete → _finishObScan(), the bar
//    completes and results render.
//
// Note: app-core.js checks `if (obStep === 3) _finishObScan()` (old step
// numbering). That check now evaluates while user is on the permission
// step. _finishObScan() guards against this with the step check below.
// ─────────────────────────────────────────────────────────────────────────────
function runObScan() {
  const fill    = document.getElementById('ob-scan-fill');
  const txt     = document.getElementById('ob-scan-txt');
  const countEl = document.getElementById('ob-scan-count');
  if (!fill) return;

  // Data already available (alreadyDone / buffered from earlier step)
  if (scanReadyForOnboarding || _scanBufReady) {
    txt.textContent = 'Analysing apps…';
    fill.style.transition = 'width 0.55s ease';
    fill.style.width = '100%';
    setTimeout(_finishObScan, 700);
    return;
  }

  // Animate to 82% deterministically (no random) then hold for real data
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
      // _finishObScan() will be called by app-core.js onScanComplete
    }
  }, 100);
}

function _finishObScan() {
  // Buffer: if called before user reaches step 4 (e.g. from app-core.js
  // onPageReady when obStep===3 = permission step), store the flag and
  // return. runObScan() checks _scanBufReady when step 4 loads.
  if (obStep !== 4) {
    _scanBufReady = true;
    return;
  }

  if (_obScanIv) { clearInterval(_obScanIv); _obScanIv = null; }

  const fill    = document.getElementById('ob-scan-fill');
  const txt     = document.getElementById('ob-scan-txt');
  const rows    = document.getElementById('ob-scan-rows');
  const btn     = document.getElementById('ob4-done-btn');
  const countEl = document.getElementById('ob-scan-count');
  if (!fill) return;

  // Complete the progress bar
  fill.style.transition = 'width 0.4s ease';
  fill.style.width = '100%';

  const catsMap = CATS_MAP || {};
  const catKeys = Object.keys(catsMap);
  const total   = Object.values(catsMap).reduce((n, a) => n + a.length, 0);

  txt.textContent = 'Found ' + total + ' apps in ' + catKeys.length + ' categories ✓';
  if (countEl) {
    countEl.textContent = 'Found ' + total + ' apps across ' + catKeys.length + ' categories';
  }

  // Render category rows — fixed 220ms interval (not random)
  if (rows) {
    rows.innerHTML = '';
    rows.style.display = 'flex';

    const entries = catKeys
      .map(c => [c, catsMap[c].length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => {
        // Always push Unassigned to the bottom — showing it first was demotivating
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
      }, i * 220);
    });

    // Safety fallback: always show CTA after 3.5 s regardless of CATS_MAP size
    setTimeout(() => {
      if (btn && btn.style.display === 'none') btn.style.display = '';
    }, 3500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Reveal
// Arc animation + personalised Coach nudge using S.userName
// ─────────────────────────────────────────────────────────────────────────────
function _obInitReveal() {
  // Animate arc from offset 182 → 155 (small partial fill showing "just started")
  requestAnimationFrame(() => {
    setTimeout(() => {
      const arc = document.getElementById('ob-arc-fill');
      if (arc) {
        arc.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
        arc.style.strokeDashoffset = '155';
      }
      // Bounce the score card in
      const card = document.querySelector('#ob5 .ob-score-card');
      if (card) {
        card.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease';
        card.style.transform = 'scale(1.04)';
        setTimeout(() => { card.style.transform = 'scale(1)'; }, 120);
      }
    }, 300);
  });

  // Personalise Coach nudge with entered name
  const name  = (S.userName || '').trim();
  const nudge = document.getElementById('ob-coach-nudge-txt');
  if (nudge && name) {
    nudge.innerHTML =
      'Hey <strong style="color:var(--p2)">' + _obEsc(name) + '</strong>, ' +
      'your first personalised insight will be ready tomorrow morning.';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Finish & teardown
// ─────────────────────────────────────────────────────────────────────────────
function finishOb() {
  // Ensure goal is persisted (may have been skipped via 'I'll set this up later')
  if (_obGoalMins > 0) {
    S.streakGoalMins = _obGoalMins;
  }
  S.onboardingDone = true;
  saveS();

  if (IS_NATIVE) {
    try { N.setOnboardingDone(); } catch (_) {}
  }

  _isFirstBoot = true; // tells loadNativeData to skip battery optimisation dialog
  hideOb();
  bootApp();

  // Trigger a fresh background scan now that usage permission may have been granted
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

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function _obEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy stubs — kept so any Kotlin bridge calls that reference these by name
// do not throw ReferenceError. Bodies are intentionally empty.
// ─────────────────────────────────────────────────────────────────────────────
function obSaveName()       { /* replaced by obSaveNameAndNext() */ }
function obSelectGoal()     { /* replaced by obGoalSelect() */ }