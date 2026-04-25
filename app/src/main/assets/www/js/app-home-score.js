/* ═══════════════════════════════════════════════════════
   app-home-score.js — Aurelo Score hero card + detail sheet
   Split from app-home.js (Phase 4).
   Requires: fmtM(), escHtml(), activateTab(), IS_NATIVE,
             TODAY_MINS, S, DAILY_USE, CATS_MAP, ProTier
   ═══════════════════════════════════════════════════════ */

/* ── Grade helper ─────────────────────────────────────── */
function _aureloGrade(score) {
  if (score >= 90) return { label: 'Excellent',   color: 'var(--g)'  };
  if (score >= 75) return { label: 'Great Day',   color: 'var(--c)'  };
  if (score >= 60) return { label: 'Good Day',    color: 'var(--p2)' };
  if (score >= 45) return { label: 'Fair',         color: 'var(--a)'  };
  return               { label: 'Needs Work',   color: 'var(--r)'  };
}

/* ── Pillar score calculators ─────────────────────────── */
function _screenPillarScore() {
  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) || 240;
  const used     = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0);
  const ratio    = goalMins > 0 ? used / goalMins : 0;
  // 100 at 0 usage → 0 at 2× goal. Linear, clamped.
  return Math.round(Math.max(0, Math.min(100, (1 - Math.min(ratio, 2) / 2) * 100)));
}

function _focusPillarScore() {
  // Use FOCUS_SCORE if available from focus-sessions module, else null (no data)
  if (typeof FOCUS_SCORE !== 'undefined' && FOCUS_SCORE !== null) return FOCUS_SCORE;
  return null;
}

function _sleepPillarScore() {
  if (typeof HC_SLEEP_SCORE !== 'undefined' && HC_SLEEP_SCORE !== null) return HC_SLEEP_SCORE;
  return null;
}

function _bodyPillarScore() {
  if (typeof HC_BODY_SCORE !== 'undefined' && HC_BODY_SCORE !== null) return HC_BODY_SCORE;
  return null;
}

/* ── Overall score: weighted average of available pillars ─ */
function _computeAureloScore() {
  const screen = _screenPillarScore();  // always available
  const focus  = _focusPillarScore();   // null if no focus data
  const sleep  = _sleepPillarScore();   // null if HC not connected
  const body   = _bodyPillarScore();    // null if HC not connected

  const weights = [
    { score: screen, weight: 40 },
    { score: focus,  weight: 20 },
    { score: sleep,  weight: 25 },
    { score: body,   weight: 15 },
  ];

  const available = weights.filter(p => p.score !== null);
  if (!available.length) return { overall: screen, screen, focus, sleep, body };

  const totalWeight  = available.reduce((s, p) => s + p.weight, 0);
  const weightedSum  = available.reduce((s, p) => s + p.score * p.weight, 0);
  const overall      = Math.round(weightedSum / totalWeight);

  return { overall, screen, focus, sleep, body };
}

/* ── Ring SVG helper ──────────────────────────────────── */
function _scoreRingHTML(score, size, strokeW) {
  const r = (size / 2) - (strokeW * 1.2);
  const C = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(score, 100)) / 100) * C;
  return `<svg viewBox="0 0 ${size} ${size}" fill="none" style="width:${size}px;height:${size}px">
    <defs>
      <linearGradient id="asGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--p)"/>
        <stop offset="100%" stop-color="var(--c)"/>
      </linearGradient>
    </defs>
    <circle class="aurelo-score-ring-track" cx="${size/2}" cy="${size/2}" r="${r}"
      stroke-width="${strokeW}" fill="none"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}"
      stroke="url(#asGrad)" stroke-width="${strokeW}" fill="none"
      stroke-linecap="round"
      stroke-dasharray="${filled.toFixed(2)} ${C.toFixed(2)}"
      transform="rotate(-90 ${size/2} ${size/2})"/>
  </svg>`;
}

/* ── Pillar tile builder ───────────────────────────────── */
function _pillarTileHTML(cfg) {
  const { label, icon, cls, value, sub, isHC, onTap } = cfg;
  const hasData  = value !== null && value !== undefined;
  const isDashed = isHC && !hasData;
  const pGrade   = hasData ? _aureloGrade(value) : null;

  const tileClass = [
    'aurelo-pillar-tile',
    cls,
    isDashed  ? 'is-dashed'  : '',
    isHC      ? 'is-hc'      : '',
    !hasData  ? 'score-empty is-empty' : '',
  ].filter(Boolean).join(' ');

  const tapAttr = onTap ? `onclick="${escAttr ? escAttr(onTap) : onTap}"` : '';

  return `<div class="${tileClass}" ${tapAttr}>
    <div class="aurelo-pillar-head">
      <span style="font-size:11px;line-height:1">${icon}</span>
      <span class="aurelo-pillar-label">${label.toUpperCase()}</span>
      ${isHC ? '<span class="aurelo-hc-badge">HC</span>' : ''}
    </div>
    <div class="aurelo-pillar-value"${pGrade ? ` style="color:${pGrade.color}"` : ''}>
      ${hasData ? value : '–'}
    </div>
    <div class="aurelo-pillar-sub">${escHtml ? escHtml(sub) : sub}</div>
  </div>`;
}

/* ═══ renderAureloScore — main entry point ════════════ */
function renderAureloScore() {
  const el = document.getElementById('home-aurelo-score');
  if (!el) return;

  const { overall, screen, focus, sleep, body } = _computeAureloScore();
  const g = _aureloGrade(overall);

  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) || 240;
  const usedMins = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0);

  const hcConnected = (typeof HealthConnect !== 'undefined' &&
                       typeof HealthConnect.isConnected === 'function' &&
                       HealthConnect.isConnected());

  const hcTap = hcConnected
    ? "typeof openAureloScoreSheet==='function'&&openAureloScoreSheet()"
    : "typeof openSettingsWithHC==='function'?openSettingsWithHC():activateTab('settings')";

  const pillarsHTML = [
    {
      label: 'Screen', icon: '📱', cls: 'score-screen',
      value: screen, isHC: false,
      sub: fmtM(usedMins) + ' of ' + fmtM(goalMins),
      onTap: "activateTab('wellness')",
    },
    {
      label: 'Focus', icon: '🎯', cls: 'score-focus',
      value: focus, isHC: false,
      sub: focus !== null ? 'Focus sessions' : 'Set a goal',
      onTap: "activateTab('wellness')",
    },
    {
      label: 'Sleep', icon: '😴', cls: 'score-sleep',
      value: sleep, isHC: true,
      sub: sleep !== null ? 'From Health Connect' : 'Connect to unlock',
      onTap: hcTap,
    },
    {
      label: 'Body', icon: '❤️', cls: 'score-body',
      value: body, isHC: true,
      sub: body !== null ? 'Steps & heart rate' : 'Connect to unlock',
      onTap: hcTap,
    },
  ].map(_pillarTileHTML).join('');

  const dateStr = new Date().toLocaleDateString('en', {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  const activePillars = [screen, focus, sleep, body].filter(v => v !== null).length;

  el.innerHTML = `
    <div class="aurelo-score-card" onclick="typeof openAureloScoreSheet==='function'&&openAureloScoreSheet()" role="button" tabindex="0" aria-label="Aurelo Score: ${overall}. ${g.label}. Tap for details.">
      <div class="aurelo-score-head">
        <div class="aurelo-score-ring-wrap">
          ${_scoreRingHTML(overall, 64, 6)}
          <div class="aurelo-score-ring-center">
            <div class="aurelo-score-number">${overall}</div>
            <div class="aurelo-score-ring-label">SCORE</div>
          </div>
        </div>
        <div class="aurelo-score-copy">
          <div class="aurelo-score-kicker">AURELO SCORE</div>
          <div class="aurelo-score-grade" style="color:${g.color}">${g.label}</div>
          <div class="aurelo-score-meta">
            <span>${dateStr}</span>
            <span class="aurelo-score-dot">·</span>
            <span class="aurelo-score-hc-text">${activePillars} pillar${activePillars !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
      <div class="aurelo-pillars-grid">${pillarsHTML}</div>
    </div>`;
}

/* ═══ openAureloScoreSheet — bottom sheet with pillar detail ══ */
let _scoreSheetOpen = false;

function openAureloScoreSheet() {
  if (_scoreSheetOpen) return;
  _scoreSheetOpen = true;

  const { overall, screen, focus, sleep, body } = _computeAureloScore();
  const g = _aureloGrade(overall);
  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) || 240;
  const usedMins = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0);

  const hcConnected = (typeof HealthConnect !== 'undefined' &&
                       typeof HealthConnect.isConnected === 'function' &&
                       HealthConnect.isConnected());

  function pillarRow(icon, title, value, desc, barColor, weight, isHC, isEmpty) {
    const hasData = value !== null && value !== undefined;
    const pGrade  = hasData ? _aureloGrade(value) : null;
    const barPct  = hasData ? value : 0;
    const cls     = ['aurelo-sheet-pillar', isHC ? 'is-hc' : '', !hasData && !isHC ? '' : '', isEmpty ? '' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}">
      <div class="aurelo-sheet-pillar-row">
        <div class="aurelo-sheet-pillar-icon">${icon}</div>
        <div class="aurelo-sheet-pillar-copy">
          <div class="aurelo-sheet-pillar-title">
            ${title}
            ${isHC ? '<span class="aurelo-sheet-hc-badge">HC</span>' : ''}
          </div>
          <div class="aurelo-sheet-pillar-desc">${desc}</div>
        </div>
        <div class="aurelo-sheet-pillar-score">
          <div class="aurelo-sheet-pillar-number" style="color:${hasData ? pGrade.color : 'var(--t3)'}">
            ${hasData ? value : '–'}
          </div>
          <div class="aurelo-sheet-pillar-weight">${weight}% weight</div>
        </div>
      </div>
      <div class="aurelo-sheet-bar">
        <div class="aurelo-sheet-bar-fill" style="width:${barPct}%;background:${hasData ? pGrade.color : 'var(--border2)'}"></div>
      </div>
      ${!hasData ? `<div class="aurelo-sheet-empty">${isHC ? 'Connect Health Connect to unlock this pillar.' : 'No data yet — set a focus goal to start tracking.'}</div>` : ''}
    </div>`;
  }

  // Tips: highlight weakest scored pillar
  const available = [{v:screen,lbl:'screen time'},{v:focus,lbl:'focus'},{v:sleep,lbl:'sleep'},{v:body,lbl:'body activity'}]
    .filter(p => p.v !== null).sort((a,b) => a.v - b.v);
  const weakest = available[0];
  const tipsHTML = weakest && weakest.v < 60
    ? `<div class="aurelo-sheet-tips">
        <div class="aurelo-sheet-tips-title">💡 Improvement Tips</div>
        <div class="aurelo-sheet-tip"><span>›</span>Your ${weakest.lbl} score is pulling your overall down.</div>
        ${weakest.lbl === 'screen time' ? `<div class="aurelo-sheet-tip"><span>›</span>You're ${fmtM(usedMins - goalMins)} over goal — put the phone down earlier tonight.</div>` : ''}
        ${!hcConnected ? `<div class="aurelo-sheet-tip"><span>›</span>Connect Health Connect to unlock Sleep & Body pillars for a fuller picture.</div>` : ''}
      </div>` : '';

  const backdrop = document.createElement('div');
  backdrop.className = 'aurelo-sheet-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Aurelo Score Details');

  backdrop.innerHTML = `
    <div class="aurelo-sheet-panel" id="aureloSheetPanel">
      <div class="aurelo-sheet-handle"></div>
      <div class="aurelo-sheet-hero">
        <div class="aurelo-sheet-hero-copy">
          <div class="aurelo-sheet-title">Aurelo Score</div>
          <div class="aurelo-sheet-subtitle">How your digital wellbeing stacks up today</div>
        </div>
        <div class="aurelo-sheet-total">
          <div class="aurelo-sheet-total-number" style="color:${g.color}">${overall}</div>
          <div class="aurelo-sheet-total-grade" style="color:${g.color}">${g.label}</div>
        </div>
      </div>
      <div class="aurelo-sheet-pillars">
        ${pillarRow('📱','Screen Time', screen, `${fmtM(usedMins)} used of ${fmtM(goalMins)} goal`, 'var(--p)', 40, false)}
        ${pillarRow('🎯','Focus',       focus,  focus !== null ? 'Based on your focus session data' : 'Start a focus session to begin tracking', 'var(--c)', 20, false)}
        ${pillarRow('😴','Sleep',       sleep,  sleep !== null ? 'Pulled from Health Connect overnight data' : 'Health Connect not connected', 'var(--pu)', 25, true)}
        ${pillarRow('❤️','Body',        body,   body  !== null ? 'Steps and heart rate from Health Connect' : 'Health Connect not connected', 'var(--g)', 15, true)}
      </div>
      ${tipsHTML}
      <div class="aurelo-sheet-actions">
        <button class="aurelo-sheet-btn primary" onclick="activateTab('wellness');closeAureloScoreSheet()">See Full Stats</button>
        ${!hcConnected
          ? `<button class="aurelo-sheet-btn secondary" onclick="closeAureloScoreSheet();openSettingsWithHC()">Connect HC</button>`
          : `<button class="aurelo-sheet-btn secondary" onclick="closeAureloScoreSheet()">Done</button>`}
      </div>
    </div>`;

  document.body.appendChild(backdrop);

  // Animate in
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    backdrop.style.pointerEvents = 'auto';
    const panel = document.getElementById('aureloSheetPanel');
    if (panel) panel.style.transform = 'translate3d(0,0,0)';
  });

  // Close on backdrop tap
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeAureloScoreSheet();
  });

  // Swipe-down to close
  let _ty = 0, _startY = 0;
  const panel = document.getElementById('aureloSheetPanel');
  if (panel) {
    panel.addEventListener('touchstart', e => { _startY = e.touches[0].clientY; }, { passive: true });
    panel.addEventListener('touchmove',  e => {
      _ty = Math.max(0, e.touches[0].clientY - _startY);
      panel.style.transform = `translate3d(0,${_ty}px,0)`;
    }, { passive: true });
    panel.addEventListener('touchend', () => {
      if (_ty > 120) { closeAureloScoreSheet(); }
      else { panel.style.transform = 'translate3d(0,0,0)'; _ty = 0; }
    });
  }
}

function closeAureloScoreSheet() {
  const backdrop = document.querySelector('.aurelo-sheet-backdrop');
  if (!backdrop) return;
  backdrop.style.opacity = '0';
  const panel = document.getElementById('aureloSheetPanel');
  if (panel) panel.style.transform = 'translate3d(0,100%,0)';
  setTimeout(() => { backdrop.remove(); _scoreSheetOpen = false; }, 300);
}