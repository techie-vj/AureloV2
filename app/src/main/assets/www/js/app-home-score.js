/* ═══════════════════════════════════════════════════════
   app-home-score.js — Aurelo Score hero card + detail sheet
   v2.1 — PREMIUM REDESIGN
   Changes:
     • Ring gradient is score-based (green/teal/amber/red)
     • Card background is theme-adaptive (light = var(--s1), dark = var(--s1))
     • Score number color matches ring color
     • Unique gradient IDs to avoid SVG conflicts
     • "SCORE" ring label replaced with grade label
   Requires: fmtM(), escHtml(), activateTab(), IS_NATIVE,
             TODAY_MINS, S, DAILY_USE, CATS_MAP, ProTier,
             FocusScore (app-focus-score.js)
   ═══════════════════════════════════════════════════════ */

/* ── CSS fallback injection (Android WebView cache guard) ─ */
function _ensureAureloScoreStyles() {
  if (document.getElementById('aurelo-score-critical-css')) return;
  const st = document.createElement('style');
  st.id = 'aurelo-score-critical-css';
  st.textContent = `
:root{
  --aurelo-home-card-bg: var(--s1);
  --aurelo-home-card-border: var(--border);
  --aurelo-home-card-shadow: 0 2px 16px rgba(0,0,0,.08);
  --aurelo-home-accent: var(--p);
  --aurelo-home-accent-2: var(--c);
  --aurelo-home-muted: var(--t3);
  --aurelo-home-hc-text: var(--c);
  --aurelo-home-hc-bg: var(--s2);
  --aurelo-home-hc-border: var(--border2);
  --aurelo-home-chip-text: var(--p2);
  --aurelo-score-card-bg: var(--aurelo-home-card-bg);
  --aurelo-score-card-border: var(--aurelo-home-card-border);
  --aurelo-score-card-shadow: var(--aurelo-home-card-shadow);
  --aurelo-score-ring-track: var(--border2);
  --aurelo-score-glow: var(--aurelo-home-hc-bg);
  --aurelo-score-tile-bg: var(--s2);
  --aurelo-score-tile-border: var(--border2);
  --aurelo-score-tile-muted: var(--aurelo-home-muted);
  --aurelo-score-title: var(--t1);
  --aurelo-score-subtitle: var(--t3);
}

#home-aurelo-score { box-sizing: border-box; padding: 0 16px; margin-bottom: 12px; }
#home-aurelo-score *, .aurelo-sheet-backdrop *, .aurelo-sheet-panel * { box-sizing: border-box; }

/* ── Card ── */
.aurelo-score-card {
  width: 100%;
  border-radius: 20px;
  padding: 16px;
  border: 1px solid var(--aurelo-score-card-border);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  background: var(--aurelo-score-card-bg);
  box-shadow: var(--aurelo-score-card-shadow);
  color: var(--aurelo-score-title);
  transition: opacity .15s;
}
.aurelo-score-card:active { opacity: .9; }
.aurelo-score-card:focus-visible {
  outline: 2px solid var(--focus-ring-color, var(--p));
  outline-offset: 3px;
}
.aurelo-score-card::after {
  content: '';
  position: absolute; top: -34px; right: -26px;
  width: 118px; height: 118px; border-radius: 50%;
  background: var(--aurelo-score-glow);
  opacity: .5;
  pointer-events: none;
}

/* ── Head row ── */
.aurelo-score-head {
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 14px; position: relative; z-index: 1;
}

/* ── Ring ── */
.aurelo-score-ring-wrap {
  position: relative;
  width: 76px; height: 76px;
  min-width: 76px; min-height: 76px; flex: 0 0 76px;
}
.aurelo-score-ring-wrap svg {
  display: block; width: 76px; height: 76px;
}
.aurelo-score-ring-track { stroke: var(--aurelo-score-ring-track); }
.aurelo-score-ring-center {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; pointer-events: none;
}
.aurelo-score-number {
  font-family: var(--ff-d);
  font-size: 22px; font-weight: 800;
  line-height: 1;
  /* color set dynamically to match ring */
}
.aurelo-score-ring-label {
  font-family: var(--ff-m);
  font-size: var(--text-2xs);
  color: var(--aurelo-score-subtitle);
  text-transform: uppercase;
  letter-spacing: .55px; margin-top: 2px; line-height: 1;
}

/* ── Copy ── */
.aurelo-score-copy { flex: 1; min-width: 0; }
.aurelo-score-kicker {
  font-family: var(--ff-m);
  font-size: var(--text-2xs);
  color: var(--aurelo-score-subtitle);
  text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 2px; line-height: 1.25;
}
.aurelo-score-grade {
  font-family: var(--ff-d);
  font-size: 20px; font-weight: 600;
  margin-bottom: 3px; line-height: 1.15;
  /* color set dynamically */
}
.aurelo-score-meta {
  display: flex; align-items: center; gap: 6px;
  font-family: var(--ff-m); font-size: var(--text-2xs);
  color: var(--aurelo-score-subtitle);
  line-height: 1.25; flex-wrap: wrap;
}
.aurelo-score-hc-text { color: var(--aurelo-home-hc-text); font-weight: 700; }
.aurelo-score-dot { color: var(--aurelo-score-subtitle); }

/* ── Score history shortcut button (top-right of card header) ── */
.aurelo-score-history-btn {
  flex-shrink: 0;
  align-self: flex-start;
  width: 32px; height: 32px;
  border-radius: var(--rad-sm);
  background: var(--s2);
  border: 1px solid var(--border2);
  color: var(--t3);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.aurelo-score-history-btn:active {
  background: var(--s3);
  color: var(--t1);
  border-color: var(--border2);
}
.aurelo-pro .aurelo-score-history-btn {
  color: var(--p2);
  border-color: rgba(108,99,255,0.25);
  background: rgba(108,99,255,0.06);
}
.aurelo-pro .aurelo-score-history-btn:active {
  background: rgba(108,99,255,0.14);
}

/* ── Pillars ── */
.aurelo-pillars-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px; position: relative; z-index: 1;
}
.aurelo-pillar-tile {
  background: var(--aurelo-score-tile-bg);
  border: 1px solid var(--aurelo-score-tile-border);
  border-radius: 10px; padding: 9px 8px;
  cursor: pointer; min-height: 50px;
  display: flex; flex-direction: column; justify-content: center;
  overflow: hidden; transition: opacity .15s;
}
.aurelo-pillar-tile:active { opacity: .85; }
.aurelo-pillar-tile.is-dashed { border-style: dashed; }
.aurelo-pillar-tile.is-hc { background: var(--aurelo-home-hc-bg); border-color: var(--aurelo-home-hc-border); }
.aurelo-pillar-tile.is-empty { opacity: .82; }
.aurelo-pillar-head {
  display: flex; align-items: center; gap: 4px;
  margin-bottom: 3px; min-width: 0; flex-wrap: wrap;
}
.aurelo-pillar-label {
  font-family: var(--ff-m); font-size: var(--text-2xs);
  color: var(--aurelo-score-tile-muted);
  letter-spacing: .5px; line-height: 1.1; text-transform: uppercase;
}
.aurelo-pillar-value {
  font-family: var(--ff-m); font-size: var(--text-xs);
  font-weight: 700; line-height: 1.2; word-break: break-word;
}
.aurelo-pillar-sub {
  font-family: var(--ff-m); font-size: var(--text-2xs);
  color: var(--aurelo-score-tile-muted); margin-top: 2px; line-height: 1.25;
}
.aurelo-hc-badge {
  font-family: var(--ff-m); font-size: var(--text-2xs);
  color: var(--aurelo-home-hc-text);
  background: var(--aurelo-home-hc-bg);
  border: 1px solid var(--aurelo-home-hc-border);
  border-radius: 4px; padding: 1px 4px;
  font-weight: 600; letter-spacing: .3px;
  line-height: 1.2; display: inline-flex; align-items: center;
}
.aurelo-pillar-lock {
  display: flex; align-items: center; gap: 4px;
  color: var(--aurelo-home-chip-text);
  font-family: var(--ff-m); font-size: var(--text-2xs);
  font-weight: 700; line-height: 1.2;
}

/* ── Bottom sheet ── */
.aurelo-sheet-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.62); z-index: 9998;
  display: flex; align-items: flex-end; justify-content: center;
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  opacity: 0; pointer-events: none; transition: opacity .25s ease;
}
.aurelo-sheet-panel {
  width: 100%; max-width: 480px;
  max-height: 88vh; overflow-y: auto; scrollbar-width: none;
  box-sizing: border-box; padding: 12px 20px 44px;
  background: var(--s0, var(--bg));
  border: 1px solid var(--border2); border-bottom: none;
  border-radius: 24px 24px 0 0;
  transform: translate3d(0,100%,0); will-change: transform;
  transition: transform .3s cubic-bezier(.32,.72,0,1);
  box-shadow: 0 -16px 40px rgba(0,0,0,.35);
}
.aurelo-sheet-panel::-webkit-scrollbar { display: none; }
.aurelo-sheet-handle {
  width: 40px; height: 4px; border-radius: 2px;
  background: var(--border2); margin: 0 auto 18px;
}
.aurelo-sheet-hero {
  display: flex; align-items: center; gap: 12px; margin-bottom: 18px;
}
.aurelo-sheet-hero-copy { flex: 1; min-width: 0; }
.aurelo-sheet-title {
  font-family: var(--ff-d); font-size: var(--text-xl);
  font-weight: 700; color: var(--t1); letter-spacing: -.3px;
}
.aurelo-sheet-subtitle {
  font-family: var(--ff-m); font-size: var(--text-2xs);
  color: var(--t3); margin-top: 2px;
}
.aurelo-sheet-total { text-align: right; flex-shrink: 0; }
.aurelo-sheet-total-number {
  font-family: var(--ff-d); font-size: 32px; font-weight: 700; line-height: 1;
}
.aurelo-sheet-total-grade {
  font-family: var(--ff-m); font-size: var(--text-xs); margin-top: 1px;
}
.aurelo-sheet-pillars { display: flex; flex-direction: column; gap: 10px; }
.aurelo-sheet-pillar {
  background: var(--s2); border: 1px solid var(--border2);
  border-radius: 14px; padding: 13px 14px;
}
.aurelo-sheet-pillar.is-hc {
  background: var(--aurelo-home-hc-bg); border-color: var(--aurelo-home-hc-border);
}
.aurelo-sheet-pillar-row { display: flex; align-items: center; gap: 10px; }
.aurelo-sheet-pillar-icon { font-size: 16px; flex-shrink: 0; }
.aurelo-sheet-pillar-copy { flex: 1; min-width: 0; }
.aurelo-sheet-pillar-title {
  font-family: var(--ff-m); font-size: var(--text-sm);
  font-weight: 700; color: var(--t1);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.aurelo-sheet-pillar-desc {
  font-family: var(--ff-m); font-size: var(--text-2xs);
  color: var(--t3); margin-top: 2px; line-height: 1.4;
}
.aurelo-sheet-pillar-score { text-align: right; flex-shrink: 0; }
.aurelo-sheet-pillar-number {
  font-family: var(--ff-d); font-size: 20px; font-weight: 700; line-height: 1;
}
.aurelo-sheet-pillar-weight {
  font-family: var(--ff-m); font-size: var(--text-2xs); color: var(--t3); margin-top: 2px;
}
.aurelo-sheet-hc-badge {
  font-family: var(--ff-m); font-size: var(--text-2xs);
  color: var(--aurelo-home-hc-text); background: var(--aurelo-home-hc-bg);
  border: 1px solid var(--aurelo-home-hc-border);
  border-radius: 999px; padding: 1px 6px; font-weight: 700; letter-spacing: .4px;
}
.aurelo-sheet-bar {
  height: 5px; background: var(--border2); border-radius: 999px; overflow: hidden; margin-top: 9px;
}
.aurelo-sheet-bar-fill { height: 100%; border-radius: 999px; }
.aurelo-sheet-empty {
  font-family: var(--ff-m); font-size: var(--text-xs);
  color: var(--t3); margin-top: 9px; line-height: 1.45;
}
.aurelo-sheet-tips {
  background: rgba(247,166,35,.07);
  border: 1px solid rgba(247,166,35,.22);
  border-radius: 14px; padding: 12px; margin-top: 12px;
}
.aurelo-sheet-tips-title {
  font-family: var(--ff-m); font-size: var(--text-xs);
  font-weight: 700; color: var(--a); margin-bottom: 6px;
}
.aurelo-sheet-tip {
  font-family: var(--ff-m); font-size: var(--text-xs);
  color: var(--t2); line-height: 1.45; margin-top: 4px;
}
.aurelo-sheet-actions { display: flex; gap: 8px; margin-top: 18px; }
.aurelo-sheet-btn {
  flex: 1; padding: 12px; border-radius: 12px;
  font-family: var(--ff-m); font-size: var(--text-sm); font-weight: 600;
  border: 1px solid var(--border2); background: var(--s2);
  color: var(--t1); cursor: pointer; text-align: center;
}
.aurelo-sheet-btn.primary { background: var(--p); border-color: var(--p); color: #fff; }
`;
  document.head.appendChild(st);
}

/* ── Grade helper ─────────────────────────────────────── */
function _aureloGrade(score) {
  // F-18: unified grade system — all four score surfaces share identical labels.
  // Delegates to FocusScore._unifiedGrade when available (single source of truth).
  if (typeof FocusScore !== 'undefined' && typeof FocusScore.unifiedGrade === 'function') {
    return FocusScore.unifiedGrade(score);
  }
  if (score >= 85) return { label: 'Excellent', color: 'var(--g)' };
  if (score >= 70) return { label: 'Good',      color: 'var(--c)' };
  if (score >= 55) return { label: 'Fair',      color: 'var(--a)' };
  return               { label: 'Start',      color: 'var(--r)' };
}

/* ── Score → ring color pair ──────────────────────────── */
function _scoreRingColors(score) {
  if (score >= 90) return { start: '#22C55E', end: '#16A34A' };   // green
  if (score >= 75) return { start: '#06B6D4', end: '#0284C7' };   // teal/cyan
  if (score >= 60) return { start: '#818CF8', end: '#6366F1' };   // indigo (matches --p2)
  if (score >= 45) return { start: '#F59E0B', end: '#D97706' };   // amber
  return                  { start: '#F87171', end: '#DC2626' };   // red
}

/* ── Backward-compat: _aureloColor() ─────────────────── */
function _aureloColor(score) { return _aureloGrade(score).color; }

/* ── Pillar score calculators ─────────────────────────── */
function _screenPillarScore() {
  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) || 240;
  const used     = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0);
  const ratio    = goalMins > 0 ? used / goalMins : 0;
  return Math.round(Math.max(0, Math.min(100, (1 - Math.min(ratio, 2) / 2) * 100)));
}

function _focusPillarScore() {
  try {
    if (typeof FocusScore !== 'undefined' && typeof FocusScore.calculateFocus === 'function') {
      const d   = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
      const res = FocusScore.calculateFocus(d);
      return (res && res.score >= 0) ? res.score : null;
    }
  } catch (_) {}
  return null;
}

function _sleepPillarScore() {
  try {
    if (typeof FocusScore !== 'undefined' && typeof FocusScore.calculateSleep === 'function') {
      const res = FocusScore.calculateSleep();
      if (!res || res.score < 0) return null;
      try {
        if (typeof HealthConnect !== 'undefined' &&
            typeof HealthConnect.isConnected === 'function' &&
            HealthConnect.isConnected() &&
            typeof HealthConnect.getSleepData === 'function') {
          const hcSleep = HealthConnect.getSleepData();
          if (hcSleep) {
            // Re-normalise: only accumulate weight for signals that are actually
            // present. Zero-substituting null signals (old formula) silently capped
            // users at ~85% whenever wearable HRV was unavailable — the same F-02
            // bug that was fixed in _getEffectiveSleepScore but not here.
            const dur = hcSleep.durScore;
            const hrv = hcSleep.oHrvScore;
            let totalW = 0.60, wgtSum = res.score * 0.60;
            if (dur != null) { wgtSum += dur * 0.25; totalW += 0.25; }
            if (hrv != null) { wgtSum += hrv * 0.15; totalW += 0.15; }
            return Math.min(100, Math.max(0, Math.round(wgtSum / totalW)));
          }
        }
      } catch (_) {}
      return res.score;
    }
  } catch (_) {}
  return null;
}

function _bodyPillarScore() {
  try {
    if (typeof HealthConnect !== 'undefined' &&
        typeof HealthConnect.isConnected === 'function' &&
        HealthConnect.isConnected() &&
        typeof HealthConnect.getBodyScore === 'function') {
      const s = HealthConnect.getBodyScore();
      return s >= 0 ? s : null;
    }
  } catch (_) {}
  return null;
}

function _computeAureloScore() {
  if (typeof FocusScore !== 'undefined' &&
      typeof FocusScore.calculateAurelo === 'function') {
    try {
      const a = FocusScore.calculateAurelo();
      if (a && a.score >= 0) {
        return {
          overall:  a.score,
          screen:   a.screenScore   >= 0 ? a.screenScore   : _screenPillarScore(),
          focus:    a.focusScore    >= 0 ? a.focusScore    : null,
          sleep:    a.sleepScore    >= 0 ? a.sleepScore    : null,
          body:     a.hcBodyScore   >= 0 ? a.hcBodyScore   : null,
          swScreen: a.swScreen, swFocus: a.swFocus,
          swSleep:  a.swSleep,  swBody:  a.swBody,
          hcActive: a.hcActive,
        };
      }
    } catch (_) {}
  }

  const screen = _screenPillarScore();
  const focus  = _focusPillarScore();
  const sleep  = _sleepPillarScore();
  const body   = _bodyPillarScore();
  // F-01: weights now match FocusScore.calculateAurelo() canonical weights.
  // Without HC: Screen 40%, Focus 35%, Sleep 25%.
  // With HC body: Screen 35%, Focus 30%, Sleep 20%, Body 15% (F-23).
  // BUG-04 FIX: When HC is active but sleep is disabled, the old fallback used
  // { screen:35, focus:30, sleep:0, body:15 } which after renorm made screen=70%.
  // The canonical calculateAurelo() uses screen=46%, focus=39%, body=15% in that case.
  const hcBodyAvail = body !== null;
  const sleepAvail  = sleep !== null;
  const _sw = hcBodyAvail
    ? { screen: sleepAvail ? 35 : 46, focus: sleepAvail ? 30 : 39, sleep: sleepAvail ? 20 : 0, body: 15 }
    : { screen: sleepAvail ? 40 : 55, focus: sleepAvail ? 35 : 45, sleep: sleepAvail ? 25 : 0, body: 0 };
  const weights = [
    { score: screen, weight: _sw.screen },
    { score: focus,  weight: _sw.focus  },
    { score: sleep,  weight: _sw.sleep  },
    { score: body,   weight: _sw.body   },
  ];
  const available = weights.filter(p => p.score !== null && p.weight > 0);
  if (!available.length) return { overall: screen, screen, focus, sleep, body };
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  const weightedSum = available.reduce((s, p) => s + p.score * p.weight, 0);
  const overall     = Math.round(weightedSum / totalWeight);
  return { overall, screen, focus, sleep, body,
           swScreen: _sw.screen, swFocus: _sw.focus, swSleep: _sw.sleep, swBody: _sw.body,
           hcActive: hcBodyAvail };
}

/* ── Ring SVG helper ──────────────────────────────────── */
/* v2.1: gradId is unique per render to avoid DOM conflicts */
function _scoreRingHTML(score, size, strokeW, gradId) {
  const id     = gradId || 'asGrad_' + Date.now();
  const r      = (size / 2) - (strokeW * 1.2);
  const C      = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(score, 100)) / 100) * C;
  const cols   = _scoreRingColors(score);
  return `<svg viewBox="0 0 ${size} ${size}" fill="none"
    style="width:${size}px;height:${size}px" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stop-color="${cols.start}"/>
        <stop offset="100%" stop-color="${cols.end}"/>
      </linearGradient>
    </defs>
    <circle class="aurelo-score-ring-track" cx="${size/2}" cy="${size/2}" r="${r}"
      stroke-width="${strokeW}" fill="none"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}"
      stroke="url(#${id})" stroke-width="${strokeW}" fill="none"
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
    isDashed ? 'is-dashed'            : '',
    isHC     ? 'is-hc'                : '',
    !hasData ? 'score-empty is-empty' : '',
  ].filter(Boolean).join(' ');

  const tapAttr = onTap
    ? `onclick="event.stopPropagation();${onTap}" role="button" tabindex="0"`
    : '';

  const safeLabel = label ? label.toUpperCase() : '';
  const safeSub   = (typeof escHtml === 'function') ? escHtml(sub || '') : (sub || '');

  return `<div class="${tileClass}" ${tapAttr}>
    <div class="aurelo-pillar-head">
      <span style="font-size: var(--text-2xs);line-height:1" aria-hidden="true">${icon || ''}</span>
      <span class="aurelo-pillar-label">${safeLabel}</span>
      ${isHC ? '<span class="aurelo-hc-badge">HC</span>' : ''}
    </div>
    <div class="aurelo-pillar-value"${pGrade ? ` style="color:${pGrade.color}"` : ''}>
      ${hasData ? value : '\u2013'}
    </div>
    ${safeSub ? `<div class="aurelo-pillar-sub">${safeSub}</div>` : ''}
  </div>`;
}

/* ═══ renderAureloScore — main entry point ════════════════ */
function renderAureloScore() {
  _ensureAureloScoreStyles();

  const el = document.getElementById('home-aurelo-score');
  if (!el) return;

  const scores = _computeAureloScore();
  const { overall, screen, focus, sleep, body, hcActive } = scores;
  const g    = _aureloGrade(overall);
  const cols = _scoreRingColors(overall);
  const gradId = 'asGrad_' + overall + '_' + Date.now();

  // Persist for Android home-screen widget
  if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
      typeof N !== 'undefined' && N &&
      typeof N.setStringPref === 'function') {
    N.setStringPref('cached_tidy_score',      String(overall));
    N.setStringPref('cached_tidy_score_date', new Date().toISOString().slice(0, 10));
  }

  // F-09: Persist Aurelo Score to history so delta ("↑3 vs yesterday") is accurate.
  // Without this save, yesterdayScore never has a real stored value to diff against.
  if (overall >= 0 && typeof FocusScore !== 'undefined' &&
      typeof FocusScore.saveScoreForToday === 'function') {
    FocusScore.saveScoreForToday(FocusScore.AURELO_SCORE_KEY, overall);
  }

  // BUG-11 FIX: Body score history was only saved when the user tapped the body tile
  // (_showBodyScoreSheet). Days without a tap had gaps in the history chart.
  // Save body score here on every render so trends are always populated.
  if (body !== null && body >= 0 && typeof FocusScore !== 'undefined' &&
      typeof FocusScore.saveScoreForToday === 'function') {
    FocusScore.saveScoreForToday('body_score_history', body);
  }

  const goalMins    = (typeof S !== 'undefined' && S.streakGoalMins) || 240;
  const usedMins    = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0);
  const hcConnected = (typeof HealthConnect !== 'undefined' &&
                       typeof HealthConnect.isConnected === 'function' &&
                       HealthConnect.isConnected());
  const isPro = typeof ProTier !== 'undefined' && ProTier.isPro;

  // F-09: Trend delta — now reads from persisted Aurelo Score history (accurate).
  // Was: relied on S.yesterdayScore which is a runtime prop never reliably populated.
  let trendHTML = '';
  try {
    if (typeof FocusScore !== 'undefined' && typeof FocusScore.getYesterdayScore === 'function') {
      const yScore = FocusScore.getYesterdayScore(FocusScore.AURELO_SCORE_KEY);
      if (yScore !== null && overall >= 0) {
        const delta = overall - yScore;
        const sign  = delta >= 0 ? '+' : '';
        const col   = delta >= 0 ? 'var(--g)' : 'var(--r)';
        trendHTML   = `<span class="aurelo-score-dot">·</span>
                       <span style="color:${col};font-weight:700">${sign}${delta} vs yesterday</span>`;
      }
    }
  } catch (_) {}

  const regularPillarsHTML = [
    _pillarTileHTML({
      label: 'Screen', icon: '📱', cls: 'score-screen',
      value: screen, isHC: false,
      sub:   (typeof fmtM === 'function') ? fmtM(usedMins) + ' of ' + fmtM(goalMins) : '',
      onTap: "_onAureloPillarTap('screen')",
    }),
    _pillarTileHTML({
      label: 'Focus', icon: '🎯', cls: 'score-focus',
      value: focus, isHC: false,
      sub:   focus !== null ? 'Focus sessions' : 'No session yet',
      onTap: "_onAureloPillarTap('focus')",
    }),
    _pillarTileHTML({
      label: 'Sleep', icon: '😴', cls: 'score-sleep',
      value: sleep, isHC: false,
      sub: (function() {
        if (sleep !== null) return hcConnected ? 'HC enhanced' : 'Bedtime tracking';
        // FIX B9: during pre-wake period show "Check back after HH:MM"
        // instead of the generic "No data yet" which implies nothing is configured.
        try {
          if (typeof FocusScore !== 'undefined' &&
              typeof FocusScore.calculateSleep === 'function') {
            var _sr = FocusScore.calculateSleep();
            if (_sr && _sr.preWakeReason) return _sr.preWakeReason;
          }
        } catch (_) {}
        return 'No data yet';
      })(),
      onTap: "_onAureloPillarTap('sleep')",
    }),
  ].join('');

  let bodyTileHTML;
  if (!isPro) {
    bodyTileHTML = `<div class="aurelo-pillar-tile is-dashed"
        onclick="event.stopPropagation();_onAureloPillarTap('body')"
        role="button" tabindex="0">
      <div class="aurelo-pillar-label">BODY</div>
      <div class="aurelo-pillar-lock">
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="2" y="6" width="10" height="7" rx="1.5"
                stroke="currentColor" stroke-width="1.2"/>
          <path d="M4.5 6V4a2.5 2.5 0 015 0v2"
                stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>Pro</span>
      </div>
    </div>`;
  } else if (!hcConnected) {
    bodyTileHTML = `<div class="aurelo-pillar-tile is-dashed is-hc"
        onclick="event.stopPropagation();_onAureloPillarTap('body')"
        role="button" tabindex="0">
      <div class="aurelo-pillar-head">
        <span style="font-size: var(--text-2xs)" aria-hidden="true">❤️</span>
        <span class="aurelo-pillar-label">BODY</span>
        <span class="aurelo-hc-badge">HC</span>
      </div>
      <div class="aurelo-pillar-value" style="color:var(--aurelo-home-hc-text)">Connect →</div>
    </div>`;
  } else {
    bodyTileHTML = _pillarTileHTML({
      label: 'Body', icon: '❤️', cls: 'score-body',
      value: body, isHC: true,
      sub:   body !== null ? 'Steps & heart rate' : 'No data yet',
      onTap: "_onAureloPillarTap('body')",
    });
  }

  const dateStr = new Date().toLocaleDateString('en', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const hcLine = hcConnected
    ? `<span class="aurelo-score-hc-text">HC enhanced</span><span class="aurelo-score-dot">·</span><span>${dateStr}</span>${trendHTML}`
    : `<span>${dateStr}</span>${trendHTML}`;

  el.innerHTML = `
    <div class="aurelo-score-card"
         onclick="event.stopPropagation();_onAureloScoreRowTap()"
         role="button" tabindex="0"
         aria-label="Aurelo Score: ${overall}. ${g.label}. Tap for details.">
      <div class="aurelo-score-head">
        <div class="aurelo-score-ring-wrap">
          ${_scoreRingHTML(overall, 76, 6, gradId)}
          <div class="aurelo-score-ring-center">
            <div class="aurelo-score-number" style="color:${cols.start}">${overall}</div>
            <div class="aurelo-score-ring-label">SCORE</div>
          </div>
        </div>
        <div class="aurelo-score-copy">
          <div class="aurelo-score-kicker">AURELO SCORE</div>
          <div class="aurelo-score-grade" style="color:${g.color}">${g.label}</div>
          <div class="aurelo-score-meta">${hcLine}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;align-self:flex-start">
          <button class="aurelo-score-history-btn"
                  onclick="event.stopPropagation();shareCard('aurelo')"
                  aria-label="Share Aurelo Score"
                  title="Share Score">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="1.8"/>
              <circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
              <circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="1.8"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="aurelo-score-history-btn"
                  onclick="event.stopPropagation();ScoreHistory.open('aurelo')"
                  aria-label="View Aurelo Score history"
                  title="Score History">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <polyline points="1,11 5,5 8,8 11,3 15,3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="11,3 15,3 15,7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="aurelo-pillars-grid">
        ${regularPillarsHTML}
        ${bodyTileHTML}
      </div>
    </div>`;
}

/* ═══ _onAureloScoreRowTap / _onAureloPillarTap ═══════════ */
function _onAureloScoreRowTap() { openAureloScoreSheet(); }

function _onAureloPillarTap(pillar) {
  const isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
  if (!isPro) {
    if (pillar === 'focus') { ProTier.triggerUpsell('FOCUS_SCHEDULE'); return; }
    if (pillar === 'sleep') { ProTier.triggerUpsell('BEDTIME_MODE');   return; }
    if (pillar === 'body')  { ProTier.triggerUpsell('HEALTH_CONNECT'); return; }
  }
  if (pillar === 'body') {
    const hcOk = typeof HealthConnect !== 'undefined' &&
                 typeof HealthConnect.isConnected === 'function' &&
                 HealthConnect.isConnected();
    if (!hcOk) { typeof openSettingsWithHC==='function' ? openSettingsWithHC() : activateTab('settings'); }
    else { _showBodyScoreSheet(); }
    return;
  }
  if (pillar === 'focus') { if (typeof FocusScore!=='undefined') { FocusScore.openFocusScoreSheet(); return; } }
  if (pillar === 'sleep') { if (typeof FocusScore!=='undefined') { FocusScore.openHabitsScoreSheet(); return; } }
  if (typeof renderScreenScoreSheet==='function') { renderScreenScoreSheet(); return; }
  activateTab('wellness');
}

/* ═══ openAureloScoreSheet — bottom sheet ════════════════════ */
let _scoreSheetOpen = false;

function openAureloScoreSheet() {
  if (typeof ProTier !== 'undefined' && !ProTier.isPro) {
      if (typeof ProTier.triggerUpsell === 'function') ProTier.triggerUpsell('TIDY_SCORE_PILLARS');
      return;
    }
    if (_scoreSheetOpen) return;
  _scoreSheetOpen = true;

  const scores   = _computeAureloScore();
  const { overall, screen, focus, sleep, body } = scores;
  const swScreen = scores.swScreen || 40;
  const swFocus  = scores.swFocus  || 35;  // FIX B6: was 20 — not a valid weight for any combination
  const swSleep  = scores.swSleep  || 25;
  const swBody   = scores.swBody   || 15;
  const g        = _aureloGrade(overall);
  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) || 240;
  const usedMins = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0);
  const hcConn   = (typeof HealthConnect !== 'undefined' &&
                    typeof HealthConnect.isConnected === 'function' &&
                    HealthConnect.isConnected());
  const fmtSafe  = typeof fmtM === 'function' ? fmtM : m => m + ' min';

  function pillarRow(icon, title, value, desc, weight, isHC) {
    const hasData = value !== null && value !== undefined;
    const pGrade  = hasData ? _aureloGrade(value) : null;
    const barPct  = hasData ? value : 0;
    const cls     = 'aurelo-sheet-pillar' + (isHC ? ' is-hc' : '');
    return `<div class="${cls}">
      <div class="aurelo-sheet-pillar-row">
        <div class="aurelo-sheet-pillar-icon" aria-hidden="true">${icon}</div>
        <div class="aurelo-sheet-pillar-copy">
          <div class="aurelo-sheet-pillar-title">
            ${title}
            ${isHC ? '<span class="aurelo-sheet-hc-badge">HC</span>' : ''}
          </div>
          <div class="aurelo-sheet-pillar-desc">${desc}</div>
        </div>
        <div class="aurelo-sheet-pillar-score">
          <div class="aurelo-sheet-pillar-number"
               style="color:${hasData ? pGrade.color : 'var(--t3)'}">
            ${hasData ? value : '\u2013'}
          </div>
          <div class="aurelo-sheet-pillar-weight">${weight}% weight</div>
        </div>
      </div>
      <div class="aurelo-sheet-bar">
        <div class="aurelo-sheet-bar-fill"
             style="width:${barPct}%;background:${hasData ? pGrade.color : 'var(--border2)'}">
        </div>
      </div>
      ${!hasData ? `<div class="aurelo-sheet-empty">${
        isHC
          ? 'Connect Health Connect to unlock this pillar.'
          : 'No data yet \u2014 complete an activity to start tracking.'
      }</div>` : ''}
    </div>`;
  }

  const available = [
    { v: screen, lbl: 'screen time'   },
    { v: focus,  lbl: 'focus'         },
    { v: sleep,  lbl: 'sleep'         },
    { v: body,   lbl: 'body activity' },
  ].filter(p => p.v !== null).sort((a, b) => a.v - b.v);

  const weakest  = available[0];
  const tipsHTML = weakest
    ? `<div class="aurelo-sheet-tips">
        <div class="aurelo-sheet-tips-title">💡 Improvement Tips</div>
        <div class="aurelo-sheet-tip"><span>›</span> Your ${weakest.lbl} score is pulling your overall down.</div>
        ${weakest.lbl === 'screen time' && usedMins > goalMins
          ? `<div class="aurelo-sheet-tip"><span>›</span> You're ${fmtSafe(usedMins - goalMins)} over goal — put the phone down earlier tonight.</div>`
          : ''}
        ${!hcConn
          ? `<div class="aurelo-sheet-tip"><span>›</span> Connect Health Connect to unlock Body pillar for a fuller picture.</div>`
          : ''}
      </div>`
    : '';

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
          <div class="aurelo-sheet-total-grade"  style="color:${g.color}">${g.label}</div>
        </div>
      </div>
      <div class="aurelo-sheet-pillars">
        ${pillarRow('📱','Screen Time', screen,
            fmtSafe(usedMins) + ' used of ' + fmtSafe(goalMins) + ' goal',
            swScreen, false)}
        ${pillarRow('🎯','Focus', focus,
            focus !== null
              ? 'Based on your focus session data'
              : 'Start a focus session to begin tracking',
            swFocus, false)}
        ${pillarRow('😴','Sleep', sleep,
            sleep !== null
              ? (hcConn ? 'Bedtime tracking + HC enhanced' : 'Based on your bedtime tracking')
              : 'No sleep data yet — set up Bedtime to begin',
            swSleep, false)}
        ${pillarRow('❤️','Body', body,
            body !== null
              ? 'Steps and heart rate from Health Connect'
              : 'Health Connect not connected',
            swBody, true)}
      </div>
      ${tipsHTML}
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="aurelo-sheet-btn"
                style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px"
                onclick="closeAureloScoreSheet();ScoreHistory.open('aurelo')">
          &#128200; View History
        </button>
        <button class="aurelo-sheet-btn"
                style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;
                       background:rgba(108,99,255,.12);border-color:rgba(108,99,255,.30);color:var(--p2)"
                onclick="shareCard('aurelo')">
          📤 Share
        </button>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:20px;padding-bottom:4px">
        <button onclick="activateTab('wellness');closeAureloScoreSheet()"
                style="background:none;border:none;padding:4px 0;cursor:pointer;
                       font-family:var(--ff-m);font-size:var(--text-xs);font-weight:600;
                       color:var(--t3);display:flex;align-items:center;gap:5px">
          <span style="font-size:14px">📊</span> Full Stats
        </button>
        ${!hcConn
          ? `<span style="width:1px;height:14px;background:var(--border2);display:inline-block"></span>
             <button onclick="closeAureloScoreSheet();typeof openSettingsWithHC==='function'?openSettingsWithHC():activateTab('settings')"
                     style="background:none;border:none;padding:4px 0;cursor:pointer;
                            font-family:var(--ff-m);font-size:var(--text-xs);font-weight:600;
                            color:var(--hc,var(--c));display:flex;align-items:center;gap:5px">
               <span style="font-size:14px">⚡</span> Connect HC
             </button>`
          : ''}</div>
    </div>`;

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    backdrop.style.opacity       = '1';
    backdrop.style.pointerEvents = 'auto';
    const panel = document.getElementById('aureloSheetPanel');
    if (panel) panel.style.transform = 'translate3d(0,0,0)';
  });
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeAureloScoreSheet();
  });
  let _ty = 0, _startY = 0;
  const panel = document.getElementById('aureloSheetPanel');
  if (panel) {
    panel.addEventListener('touchstart', e => { _startY = e.touches[0].clientY; }, { passive: true });
    panel.addEventListener('touchmove',  e => {
      _ty = Math.max(0, e.touches[0].clientY - _startY);
      panel.style.transform = `translate3d(0,${_ty}px,0)`;
    }, { passive: true });
    panel.addEventListener('touchend', () => {
      if (_ty > 120) closeAureloScoreSheet();
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

/* ═══ _showBodyScoreSheet — unchanged from v2.0 ══════════════ */
function _showBodyScoreSheet() {
  document.getElementById('body-score-sheet-backdrop')?.remove();
  if (typeof HealthConnect === 'undefined' || !HealthConnect.isConnected()) return;

  const bodyScore  = HealthConnect.getBodyScore();
  // Save to history so ScoreHistory chart can show Body trends over time
  if (bodyScore >= 0 && typeof _saveScoreForToday === 'function') {
    _saveScoreForToday('body_score_history', bodyScore);
  }
  const gradeColor = bodyScore >= 70 ? 'var(--g)' : bodyScore >= 50 ? 'var(--a)' : 'var(--hc,var(--c))';
  const gradeLabel = bodyScore >= 85 ? 'Excellent' : bodyScore >= 70 ? 'Good' : bodyScore >= 55 ? 'Fair' : bodyScore >= 0 ? 'Start' : '';

  let _hcRaw = {};
  try {
    const _hcStr = window.AppBridge?.getHCData?.();
    if (_hcStr) { const _p = JSON.parse(_hcStr); if (_p) _hcRaw = _p; }
  } catch (_) {}

  const live = {
    steps:     (_hcRaw.steps    != null && _hcRaw.steps    >= 0) ? _hcRaw.steps    : null,
    hrv:       _hcRaw.hrv       ?? null,
    avgHrv7d:  _hcRaw.avgHrv7d  ?? null,
    rhr:       _hcRaw.restingHR ?? null,
    avgRhr7d:  _hcRaw.avgRhr7d  ?? null,
    avgSteps7d: _hcRaw.avgSteps7d ?? null,  // FIX B3: personal step avg for dynamic ceiling
  };

  // FIX B4: floor-based HRV bar matching BodyScoreCalculator.kt F-25
  // Old: hrv / avgHrv7d * 100 (simple ratio)
  // New: proportional between (avg * 0.70) floor and avg ceiling
  const hrvPct = (function() {
    if (live.hrv == null || live.avgHrv7d == null || live.avgHrv7d <= 0) return null;
    if (live.hrv >= live.avgHrv7d) return 100;
    const floor = live.avgHrv7d * 0.70;
    if (live.hrv <= floor) return 0;
    return Math.min(100, Math.max(0,
      Math.round(((live.hrv - floor) / (live.avgHrv7d - floor)) * 100)));
  })();

  // FIX B2: percentage-based RHR ceiling matching BodyScoreCalculator.kt F-28
  // Old: (1 - (rhr - avg) / 20) * 100 (absolute +20 bpm)
  // New: ceiling = avg * 1.40 (40% above personal 7-day average)
  const rhrPct = (function() {
    if (live.rhr == null || live.avgRhr7d == null || live.avgRhr7d <= 0) return null;
    if (live.rhr <= live.avgRhr7d) return 100;
    const ceiling = live.avgRhr7d * 1.40;
    if (live.rhr >= ceiling) return 0;
    return Math.min(100, Math.max(0,
      Math.round((1 - (live.rhr - live.avgRhr7d) / (ceiling - live.avgRhr7d)) * 100)));
  })();

  // FIX B3: personal avg ceiling for steps matching BodyScoreCalculator.kt F-24
  // Old: (steps - 2000) / 6000 * 100 (fixed 8 000 ceiling)
  // New: ceiling = personal 7-day avg when > 8 000, else 8 000
  const stepsPct = (function() {
    if (live.steps == null) return null;
    const ceiling = (live.avgSteps7d != null && live.avgSteps7d > 8000)
      ? Math.round(live.avgSteps7d) : 8000;
    if (live.steps >= ceiling) return 100;
    if (live.steps <= 2000) return 0;
    return Math.min(100, Math.max(0,
      Math.round(((live.steps - 2000) / (ceiling - 2000)) * 100)));
  })();

  const _noData = '<span style="color:var(--t3);font-size:var(--text-xs)">No data</span>';
  const rows = [
    {
      label: 'Heart Rate Variability', icon: '💜',
      val:  live.hrv  != null ? live.hrv  + ' ms' : _noData,
      sub:  live.avgHrv7d != null ? '7-day avg: ' + live.avgHrv7d + ' ms' : '7-day avg: \u2013',
      pct:  hrvPct,
      col:  hrvPct == null ? 'var(--t3)' : hrvPct >= 100 ? 'var(--g)' : hrvPct >= 70 ? 'var(--a)' : 'var(--r)',
    },
    {
      label: 'Resting Heart Rate', icon: '❤️',
      val:  live.rhr  != null ? live.rhr  + ' bpm' : _noData,
      sub:  live.avgRhr7d != null ? '7-day avg: ' + live.avgRhr7d + ' bpm' : '7-day avg: \u2013',
      pct:  rhrPct,
      col:  rhrPct == null ? 'var(--t3)' : rhrPct >= 100 ? 'var(--g)' : rhrPct >= 70 ? 'var(--a)' : 'var(--r)',
    },
    {
      label: 'Daily Steps', icon: '🦶',
      val:  live.steps != null ? live.steps.toLocaleString() : _noData,
      sub:  (live.avgSteps7d != null && live.avgSteps7d > 8000)
              ? 'Goal: ' + Math.round(live.avgSteps7d).toLocaleString() + ' (your avg)'
              : 'Goal: 8,000 steps',  // FIX B3+B5: personalised below
      pct:  stepsPct,
      col:  stepsPct == null ? 'var(--t3)' : stepsPct >= 100 ? 'var(--g)' : stepsPct >= 60 ? 'var(--a)' : 'var(--r)',
    },
  ];

  const rowsHtml = rows.map(r => `
    <div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;
                padding:13px 14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:16px">${r.icon}</span>
        <div style="flex:1">
          <div style="font-size:var(--text-sm);font-weight:700;color:var(--t1)">${r.label}</div>
          <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">${r.sub}</div>
        </div>
        <div style="font-family:var(--ff-d);font-size:var(--text-2xl);font-weight:700;
                    color:${r.col};line-height:1;text-align:right">
          <div>${r.val}</div>
          ${r.weight != null ? `<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">${r.weight}% weight</div>` : ''}
        </div>
      </div>
      <div style="height:4px;background:var(--border2);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${r.pct != null ? r.pct : 0}%;
                    background:${r.col};border-radius:2px;transition:width .4s"></div>
      </div>
    </div>`).join('');

  const html = `
    <div id="body-score-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Body Score"
         style="position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);
                -webkit-backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:flex-end;
                justify-content:center;opacity:0;transition:opacity .25s;pointer-events:none"
         onclick="if(event.target===this)_closeBodyScoreSheet()">
      <div id="body-score-sheet"
           style="width:100%;max-width:480px;background:var(--s0);border-radius:24px 24px 0 0;
                  border:1px solid var(--border2);border-bottom:none;
                  padding:12px 20px 44px;
                  box-sizing:border-box;transform:translate3d(0,100%,0);will-change:transform;
                  transition:transform .3s cubic-bezier(.32,.72,0,1);max-height:88vh;overflow-y:auto">
        <div style="width:40px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 18px"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-family:var(--ff-d);font-size:var(--text-xl);font-weight:700;
                        color:var(--t1);letter-spacing:-.3px">Body Score</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
              <span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">via Health Connect</span>
              <span style="font-size:var(--text-2xs);color:var(--hc,var(--c));
                           background:var(--hc-dim,rgba(0,200,200,.1));
                           border:1px solid var(--hc-border,rgba(0,200,200,.3));
                           border-radius:5px;padding:1px 6px;font-weight:600;letter-spacing:.3px">HC</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-family:var(--ff-d);font-size:var(--text-3xl);font-weight:700;
                        color:${gradeColor};line-height:1">${bodyScore >= 0 ? bodyScore : '\u2013'}</div>
            ${gradeLabel ? `<div style="font-family:var(--ff-m);font-size:13px;font-weight:600;
                                        color:${gradeColor};margin-top:4px;text-align:right">${gradeLabel}</div>` : ''}
          </div>
        </div>
        <div style="height:6px;background:var(--border2);border-radius:3px;overflow:hidden;margin-bottom:20px">
          <div style="height:100%;width:${Math.max(0, bodyScore >= 0 ? bodyScore : 0)}%;
                      background:linear-gradient(90deg,var(--hc,var(--c)),var(--g));
                      border-radius:3px;transition:width .4s"></div>
        </div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);
                    letter-spacing:.8px;margin-bottom:14px">HOW THIS IS CALCULATED</div>
        ${rowsHtml}
        <div style="background:var(--hc-dim,rgba(0,200,200,.07));
                    border:1px solid var(--hc-border,rgba(0,200,200,.22));
                    border-radius:12px;padding:10px 13px;font-family:var(--ff-m);
                    font-size:var(--text-xs);color:var(--t3);line-height:1.55;margin-bottom:16px">
          Each signal scored 0–100 against your personal 7-day baseline.
          Weights: Steps 40% · HRV 35% · Resting HR 25%.
          Missing signals are excluded and remaining weights are renormalized.
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <button type="button" onclick="_closeBodyScoreSheet();ScoreHistory.open('body')"
                  style="flex:1;padding:12px 14px;border-radius:14px;background:transparent;
                         border:1px solid var(--border2);color:var(--t2);font-family:var(--ff-m);
                         font-size:var(--text-sm);font-weight:600;cursor:pointer;display:flex;
                         align-items:center;justify-content:center;gap:8px">&#128200; View History</button>
          <button type="button" onclick="shareCard('body_score')"
                  style="flex:1;padding:12px 14px;border-radius:14px;background:rgba(0,200,200,.10);
                         border:1px solid rgba(0,200,200,.30);color:var(--hc,var(--c));font-family:var(--ff-m);
                         font-size:var(--text-sm);font-weight:600;cursor:pointer;display:flex;
                         align-items:center;justify-content:center;gap:8px">📤 Share</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  requestAnimationFrame(() => {
    const bd = document.getElementById('body-score-sheet-backdrop');
    const sh = document.getElementById('body-score-sheet');
    if (!bd) return;
    void bd.offsetHeight;
    bd.style.opacity      = '1';
    bd.style.pointerEvents = 'all';
    if (sh) sh.style.transform = 'translate3d(0,0,0)';
  });
}

function _closeBodyScoreSheet() {
  const bd = document.getElementById('body-score-sheet-backdrop');
  const sh = document.getElementById('body-score-sheet');
  if (!bd) return;
  bd.style.opacity = '0';
  if (sh) sh.style.transform = 'translate3d(0,100%,0)';
  setTimeout(() => bd?.remove(), 320);
}

/* ── HC data-ready handlers ──────────────────────────── */
// onHCDataRefreshed: fired by HealthConnectBridge after a foreground refresh
// (Case C in refreshOnForeground). Without this callback the home card had
// already rendered once with empty _cachedData (body = null), the BUG-11 body
// history save was skipped, and Score History stayed empty even though the body
// tile showed a live score (which reads HC data via a later synchronous call).
window.onHCDataRefreshed = function () {
  try { renderAureloScore(); } catch (_) {}
};

// Wrap onHCSyncComplete so a forced sync (Settings → Re-sync) also triggers a
// re-render + history save, regardless of what other JS listens on that hook.
(function () {
  var _prevSync = window.onHCSyncComplete;
  window.onHCSyncComplete = function (data) {
    if (typeof _prevSync === 'function') { try { _prevSync(data); } catch (_) {} }
    try { renderAureloScore(); } catch (_) {}
  };
})();

/* ── Backward-compat shims ────────────────────────────── */
function _onAureloScoreRowTap()    { openAureloScoreSheet(); }
function _showAureloScoreSheet()   { openAureloScoreSheet(); }

function _isAureloSleepConfigured() {
  try {
    if (typeof FocusBedtime !== 'undefined' && FocusBedtime.getCfg) {
      const cfg = FocusBedtime.getCfg() || {};
      if (cfg.enabled !== undefined) return !!cfg.enabled;
    }
  } catch (_) {}
  try { return !!(typeof S !== 'undefined' && S.settings && S.settings.bedtime); }
  catch (_) { return false; }
}

function _getAureloScoreData() {
  const { overall, screen, focus, sleep, body } = _computeAureloScore();
  return {
    score:       overall,
    sScreen:     screen,
    sFocus:      focus,
    sSleep:      sleep,
    hcBodyScore: body,
    goalMins:    (typeof S !== 'undefined' && S.streakGoalMins) || 240,
  };
}

/* ── Expose score data accessors for share cards ─────── */
window.getAureloScoreData = _getAureloScoreData;

window.getBodyScoreData = function() {
  let bodyScore = -1;
  try {
    if (typeof HealthConnect !== 'undefined' && HealthConnect.isConnected &&
        HealthConnect.isConnected() && typeof HealthConnect.getBodyScore === 'function') {
      bodyScore = HealthConnect.getBodyScore();
    }
  } catch (_) {}

  let live = { steps: null, hrv: null, avgHrv7d: null, rhr: null, avgRhr7d: null, avgSteps7d: null };
  try {
    const _hcStr = window.AppBridge?.getHCData?.();
    if (_hcStr) {
      const _p = JSON.parse(_hcStr);
      if (_p) {
        live.steps      = (_p.steps     != null && _p.steps     >= 0) ? _p.steps     : null;
        live.hrv        = _p.hrv        ?? null;
        live.avgHrv7d   = _p.avgHrv7d   ?? null;
        live.rhr        = _p.restingHR  ?? null;
        live.avgRhr7d   = _p.avgRhr7d   ?? null;
        live.avgSteps7d = _p.avgSteps7d ?? null;
      }
    }
  } catch (_) {}
  return { bodyScore, ...live };
};