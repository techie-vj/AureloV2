/* ═══ app-home-score.js — Aurelo Score composite metric ════════════════════
 * Phase 4 extraction from app-home.js.
 * Depends on: app-home.js globals (TODAY_MINS, S, IS_NATIVE, N, fmtM,
 *             shareCard, openFocusScoreSheet, openHabitsScoreSheet,
 *             renderScreenScoreSheet, calculateAureloScore, calculateFocusScore,
 *             calculateSleepScore, calculateScreenScore, _loadStripData, ProTier)
 * ════════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
 * AURELO SCORE — composite Screen + Focus + Sleep metric
 * ═══════════════════════════════════════════════════ */

function _calcScreenScore(todayMins, goalMins) {
  if (!goalMins || goalMins <= 0) return -1;
  const pct = todayMins / goalMins;
  if (pct > 1) return Math.max(0, Math.round(100 - (pct - 1) * 200));
  // Reward approaching but not exceeding goal; floor of 40 for zero usage
  return Math.round(40 + pct * 60);
}

function _calcSleepScore(bedEnabled, bedStreak, lastNight) {
  if (!bedEnabled) return -1;
  if (!lastNight || !lastNight.hasData) {
    // No overnight snapshot yet — use streak as proxy
    return bedStreak > 0 ? Math.min(75, 40 + bedStreak * 5) : -1;
  }
  let score = lastNight.bedtimeKept ? 80 : 25;
  score -= Math.min(20, (lastNight.snoozeCount     || 0) * 10); // each snooze  -10, cap -20
  score -= Math.min(20, (lastNight.appAttemptsTotal || 0) * 4); // each attempt  -4, cap -20
  score += Math.min(20, (bedStreak || 0) * 3);                  // streak bonus up to +20
  return Math.max(0, Math.min(100, score));
}

function _calcAureloScore(screenScore, focusScore, sleepScore) {
  const wts = [], scrs = [];
  if (screenScore >= 0) { wts.push(40); scrs.push(screenScore); }
  if (focusScore  >= 0) { wts.push(35); scrs.push(focusScore);  }
  if (sleepScore  >= 0) { wts.push(25); scrs.push(sleepScore);  }
  if (!wts.length) return -1;
  const totalW = wts.reduce((a,b)=>a+b, 0);
  const wSum   = scrs.reduce((s,v,i)=>s+v*wts[i], 0);
  return Math.round(wSum / totalW);
}

function _aureloGrade(score) {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Fair';
  return 'Needs work';
}

function _aureloColor(score) {
  if (score >= 70) return 'var(--g)';
  if (score >= 50) return 'var(--a)';
  return 'var(--r)';
}

const _AURELO_TIPS = {
  screen: [
    // poor (< 55)
    ['Use Focus Mode during your peak usage window to reduce passive scrolling.',
     'Set an App Timer on your top 2 distracting apps — even a 30-min limit helps.'],
    // fair (55–69)
    ['Try one phone-free hour before bed to pull the average down.',
     'Check your weekly view — which day pushed you over? Target that pattern.'],
  ],
  focus: [
    ['Start one 15-min Gentle session today — short sessions still build the habit.',
     'Enable Mindful Pause on Instagram or YouTube to add friction before opening.'],
    ['Increase your blocked-app count — blocking 5+ makes a real difference.',
     'Review Focus History to find which session type you complete most reliably.'],
  ],
  sleep: [
    ['Set a bedtime tonight — even a soft 10 PM cutoff improves morning clarity.',
     'Add your top 2 distraction apps to the bedtime block list.'],
    ['Each snooze fragments your wind-down — try reducing by one per night.',
     'Keep your blocked-app list current; apps you stop using slip through.'],
  ],
};

function _getAureloTips(pillarKey, score) {
  const bank = _AURELO_TIPS[pillarKey];
  if (!bank) return [];
  return score < 55 ? bank[0] : bank[1];
}

function _getAureloScoreData() {
  const goalMins = S.streakGoalMins || 240;
  const focusD   = typeof _loadStripData   === 'function' ? _loadStripData()         : {};
  const fScore = typeof calculateFocusScore === 'function' ? calculateFocusScore(focusD).score : -1;
  const bedEnabled = !!(S.settings && S.settings.bedtime);
  let bedStreak = 0, lastNight = null;
  if (IS_NATIVE) {
    try { bedStreak = (JSON.parse(N.getBedtimeStreak() || '{}') || {}).streak || 0; } catch(_){}
    try {
      if (typeof N.getBedtimeLastNightStats === 'function')
        lastNight = JSON.parse(N.getBedtimeLastNightStats() || '{}');
    } catch(_){}
  }
  const sScreen = (typeof calculateScreenScore === 'function')
    ? calculateScreenScore().score : _calcScreenScore(TODAY_MINS, goalMins);
  const sSleep = typeof calculateSleepScore === 'function' ? calculateSleepScore().score : _calcSleepScore(bedEnabled, bedStreak, lastNight);
  const score    = _calcAureloScore(sScreen, fScore, sSleep);
  return { goalMins, focusD, sScreen, sFocus: fScore, sSleep, score,
           bedEnabled, bedStreak, lastNight };
}

function renderAureloScore() {
  const el = document.getElementById('home-aurelo-score');
  if (!el) return;

  // calculateAureloScore lives in app-focus.js — fall back gracefully if focus tab not loaded yet
  const aureloRes = typeof calculateAureloScore === 'function'
    ? calculateAureloScore()
    : null;
  if (!aureloRes || aureloRes.score < 0) { el.style.display = 'none'; return; }
  el.style.display = '';

  // Persist today's Aurelo Score for the home screen widget to read
  if (IS_NATIVE && typeof N.setStringPref === 'function') {
    var _aureloToday = new Date().toISOString().slice(0, 10);
    N.setStringPref('cached_tidy_score',      String(aureloRes.score));
    N.setStringPref('cached_tidy_score_date', _aureloToday);
  }

  const { score: score, screenScore: sScreen, focusScore: sFocus, sleepScore: sSleep,
          swScreen, swFocus, swSleep, hcBodyScore, hcActive } = aureloRes;

  const grade    = _aureloGrade(score);
  const gradeCol = _aureloColor(score);
  const isPro    = typeof ProTier !== 'undefined' && ProTier.isPro;
  const hcConn   = typeof HealthConnect !== 'undefined' && HealthConnect.isConnected();

  const pillars = [
    { key:'screen', label:'SCREEN', score:sScreen, color:'var(--p2)',  tap:'_onAureloPillarTap(\'screen\')', wt:swScreen },
    { key:'focus',  label:'FOCUS',  score:sFocus,  color:'var(--c)',   tap:'_onAureloPillarTap(\'focus\')',  wt:swFocus  },
    { key:'sleep',  label:'SLEEP',  score:sSleep,  color:'var(--pu)',  tap:'_onAureloPillarTap(\'sleep\')',  wt:swSleep  },
  ].filter(p => p.wt > 0);

  const regularPillarsHtml = pillars.map(p => {
    const disp = p.score >= 0 ? p.score : '–';
    const col  = p.score >= 0 ? p.color : 'var(--t3)';
    return `<div onclick="event.stopPropagation();${p.tap}"
      role="button" tabindex="0" style="flex:1;background:rgba(255,255,255,.04);border-radius:8px;padding:8px 7px;cursor:pointer;min-height:44px;display:flex;flex-direction:column;justify-content:center;">
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.5px;margin-bottom:2px">${p.label}</div>
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:${col}">${disp}</div>
    </div>`;
  }).join('');

  // ── Body pillar tile — always rendered; state: locked / connect / active ──
  let bodyTileHtml;
  if (!isPro) {
    // Free user: show lock prompt → pro upsell
    bodyTileHtml = `<div onclick="event.stopPropagation();_onAureloPillarTap('body')"
      role="button" tabindex="0"
      style="flex:1;border:1px dashed rgba(108,99,255,.35);border-radius:8px;padding:8px 7px;
             cursor:pointer;min-height:44px;display:flex;flex-direction:column;justify-content:center;
             background:rgba(108,99,255,.04);">
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.5px;margin-bottom:3px">BODY</div>
      <div style="display:flex;align-items:center;gap:3px">
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="1.5" stroke="var(--p2)" stroke-width="1.2"/><path d="M4.5 6V4a2.5 2.5 0 015 0v2" stroke="var(--p2)" stroke-width="1.2" stroke-linecap="round"/></svg>
        <span style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:var(--p2)">Pro</span>
      </div>
    </div>`;
  } else if (!hcConn) {
    // Pro, HC not connected: invite to connect
    bodyTileHtml = `<div onclick="event.stopPropagation();_onAureloPillarTap('body')"
      role="button" tabindex="0"
      style="flex:1;border:1px dashed var(--hc-border);border-radius:8px;padding:8px 7px;
             cursor:pointer;min-height:44px;display:flex;flex-direction:column;justify-content:center;
             background:var(--hc-dim);">
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.5px;margin-bottom:3px">BODY</div>
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:var(--hc)">Connect →</div>
    </div>`;
  } else {
    // Pro + HC connected: show body score
    const bDisp  = (hcBodyScore != null && hcBodyScore >= 0) ? hcBodyScore : '–';
    const bColor = (hcBodyScore != null && hcBodyScore >= 70) ? 'var(--g)' : (hcBodyScore >= 50 ? 'var(--a)' : 'var(--hc)');
    bodyTileHtml = `<div onclick="event.stopPropagation();_onAureloPillarTap('body')"
      role="button" tabindex="0"
      style="flex:1;background:rgba(255,255,255,.04);border-radius:8px;padding:8px 7px;
             cursor:pointer;min-height:44px;display:flex;flex-direction:column;justify-content:center;
             border:1px solid var(--hc-border);">
      <div style="display:flex;align-items:center;gap:3px;margin-bottom:2px">
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.5px">BODY</div>
        <div style="font-size:8px;color:var(--hc);background:var(--hc-dim);border:1px solid var(--hc-border);
                    border-radius:4px;padding:1px 4px;font-weight:600;letter-spacing:.3px;line-height:1.4">HC</div>
      </div>
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:${bColor}">${bDisp}</div>
    </div>`;
  }

  el.innerHTML = `
    <div style="background:rgba(108,99,255,.10);border:1px solid rgba(108,99,255,.22);
                border-radius:12px;padding:9px 11px;margin-top:10px">
      <div onclick="event.stopPropagation();_onAureloScoreRowTap()"
           role="button" tabindex="0"
           style="display:flex;align-items:center;gap:10px;cursor:pointer;min-height:44px">
        <span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p2);letter-spacing:.5px;flex-shrink:0">AURELO SCORE</span>
        <span style="font-family:var(--ff-d);font-size:18px;font-weight:600;color:var(--t1);flex-shrink:0;line-height:1">${score}</span>
        <div style="flex:1;height:4px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${score}%;background:linear-gradient(90deg,var(--p),var(--c));border-radius:99px"></div>
        </div>
        <span style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;color:${gradeCol};flex-shrink:0">${grade}</span>
      </div>
      <div style="display:flex;gap:5px;margin-top:7px">${regularPillarsHtml}${bodyTileHtml}</div>
    </div>`;
}

function _onAureloScoreRowTap() {
  if (typeof ProTier !== 'undefined' && !ProTier.isPro) {
    ProTier.triggerUpsell('TIDY_SCORE_PILLARS'); return;
  }
  _showAureloScoreSheet(null);
}

function _onAureloPillarTap(pillar) {
  if (typeof ProTier !== 'undefined' && !ProTier.isPro) {
    ProTier.triggerUpsell('TIDY_SCORE_PILLARS'); return;
  }
  // Body pillar — HC routing
  if (pillar === 'body') {
    if (typeof HealthConnect === 'undefined' || !HealthConnect.isConnected()) {
      if (typeof HealthConnect !== 'undefined') HealthConnect.openSettings();
    } else {
      _showBodyScoreSheet();
    }
    return;
  }
  // Focus and Sleep pillars deep-link to their respective score sheets
  if (pillar === 'focus') {
    if (typeof openFocusScoreSheet === 'function') openFocusScoreSheet();
    return;
  }
  if (pillar === 'sleep') {
    if (typeof openHabitsScoreSheet === 'function') openHabitsScoreSheet();
    return;
  }
  // Screen pillar opens the dedicated Screen score sheet
  if (typeof renderScreenScoreSheet === 'function') renderScreenScoreSheet();
}

function _showAureloScoreSheet(focusPillar) {
  document.getElementById('aurelo-score-sheet-backdrop')?.remove();

  // ── Step 1: get scores from the canonical source (same as home card)
    const aureloRes = typeof calculateAureloScore === 'function'
      ? calculateAureloScore()
      : null;
    if (!aureloRes || aureloRes.score < 0) return;

    const { score, screenScore: sScreen, focusScore: sFocus, sleepScore: sSleep,
            hcBodyScore, swScreen, swFocus, swSleep, swBody, hcActive } = aureloRes;

    // ── Step 2: fetch extra context needed for pillar descriptions only
    const goalMins = S.streakGoalMins || 240;
    const focusD   = typeof _loadStripData === 'function' ? _loadStripData() : {};

    const bedEnabled  = !!(S.settings && S.settings.bedtime);
    let bedStreak = 0, lastNight = null;
    if (IS_NATIVE) {
      try { bedStreak = (JSON.parse(N.getBedtimeStreak() || '{}') || {}).streak || 0; } catch(_){}
      try {
        if (typeof N.getBedtimeLastNightStats === 'function')
          lastNight = JSON.parse(N.getBedtimeLastNightStats() || '{}');
      } catch(_){}
    }

    // HC mindfulness — shown in Focus pillar when HC is connected
    const _hcConnSheet = typeof HealthConnect !== 'undefined' && HealthConnect.isConnected();
    const _mindfulSessions = _hcConnSheet ? (HealthConnect.getMindfulnessSessions() || []) : [];
    const _mindfulMins = _mindfulSessions.reduce((s, m) => s + (m.duration || 0), 0);

  if (score < 0) return;
  const grade      = _aureloGrade(score);
  const gradeColor = _aureloColor(score);

  // Dynamic weight labels based on HC activity
  const wScreen = (swScreen || 0) + '%';
  const wFocus  = (swFocus  || 0) + '%';
  const wSleep  = (swSleep  || 0) + '%';
  const wBody   = (swBody   || 0) + '%';
  const subtitle = hcActive ? 'Screen · Focus · Sleep · Body' : 'Screen · Focus · Sleep';

  const pillars = [
    {
      key:'screen', label:'Screen Time', icon:'📱', score:sScreen, color:'var(--p2)', weight:wScreen,
      desc: sScreen >= 0
        ? (TODAY_MINS > goalMins
            ? `${fmtM(TODAY_MINS - goalMins)} over your ${fmtM(goalMins)} goal`
            : `${fmtM(TODAY_MINS)} of ${fmtM(goalMins)} goal`)
        : 'No data yet',
    },
    {
      key:'focus', label:'Focus', icon:'🎯', score:sFocus, color:'var(--c)', weight:wFocus,
      hcBadge: _hcConnSheet && _mindfulSessions.length > 0,
      desc: (() => {
        const parts = [];
        if (focusD.total > 0)
          parts.push(`${focusD.completed}/${focusD.total} sessions · ${focusD.rate}% completion`);
        else if (_mindfulSessions.length === 0)
          parts.push('No sessions today');
        if (_mindfulSessions.length > 0)
          parts.push(`${_mindfulSessions.length} mindful session${_mindfulSessions.length > 1 ? 's' : ''} · ${_mindfulMins} min via HC`);
        return parts.join(' · ') || 'No sessions today';
      })(),
    },
    {
      key:'sleep', label:'Sleep', icon:'🌙', score:sSleep, color:'var(--pu)', weight:wSleep,
      desc: !bedEnabled
        ? 'Bedtime mode off'
        : (lastNight && lastNight.hasData
            ? (lastNight.bedtimeKept ? 'Bedtime kept ✓' : 'Bedtime missed')
              + (lastNight.snoozeCount > 0
                  ? ` · ${lastNight.snoozeCount} snooze${lastNight.snoozeCount > 1 ? 's' : ''}`
                  : '')
              + (lastNight.appAttemptsTotal > 0
                  ? ` · ${lastNight.appAttemptsTotal} app attempt${lastNight.appAttemptsTotal > 1 ? 's' : ''}`
                  : '')
            : `${bedStreak}-night streak`),
    },
  ];

  // Add Body pillar when HC is active
  if (hcActive && hcBodyScore != null && hcBodyScore >= 0) {
    pillars.push({
      key:'body', label:'Body', icon:'💚', score:hcBodyScore, color:'var(--hc)', weight:wBody,
      desc:'HRV · Steps · Resting HR via Health Connect', hcBadge:true,
    });
  }

  // Weakest active pillar drives the tips section
  const tipsKey = focusPillar || (() => {
    const active = pillars.filter(p => p.score >= 0);
    if (!active.length) return 'screen';
    return active.sort((a,b) => a.score - b.score)[0].key;
  })();
  const tipsPillar = pillars.find(p => p.key === tipsKey) || pillars[0];
  const tips       = _getAureloTips(tipsKey, tipsPillar.score);

  const pillarsHtml = pillars.map(p => {
    const isWeak  = p.key === tipsKey && p.score >= 0 && p.score < 70;
    const barW    = p.score >= 0 ? p.score : 0;
    const col     = p.score >= 0 ? p.color : 'var(--t3)';
    const border  = isWeak ? '1px solid rgba(247,166,35,.3)' : p.hcBadge ? '1px solid var(--hc-border)' : '1px solid var(--border2)';
    const bg      = isWeak ? 'rgba(247,166,35,.06)' : p.hcBadge ? 'var(--hc-dim)' : 'var(--s2)';
    const hcTag   = p.hcBadge
      ? `<span style="font-size:9px;color:var(--hc);background:var(--hc-dim);border:1px solid var(--hc-border);
                      border-radius:5px;padding:1px 5px;font-weight:600;letter-spacing:.3px;margin-left:5px">HC</span>`
      : '';
    return `<div style="background:${bg};border:${border};border-radius:14px;padding:13px 14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:16px">${p.icon}</span>
        <div style="flex:1">
          <div style="font-size:var(--text-sm);font-weight:700;color:var(--t1);display:flex;align-items:center">${p.label}${hcTag}</div>
          <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:1px">${p.desc}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--ff-d);font-size:var(--text-2xl);font-weight:700;color:${col};line-height:1">${p.score >= 0 ? p.score : '–'}</div>
          <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:1px">weight ${p.weight}</div>
        </div>
      </div>
      ${p.score >= 0 ? `<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${barW}%;background:${col};border-radius:2px;transition:width .4s"></div>
      </div>` : ''}
    </div>`;
  }).join('');

  const tipsHtml = tips.length ? `
    <div style="background:rgba(247,166,35,.07);border:1px solid rgba(247,166,35,.2);
                border-radius:14px;padding:12px 14px;margin-bottom:16px">
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--a);letter-spacing:.5px;margin-bottom:8px">💡 TIPS TO IMPROVE</div>
      ${tips.map(t => `
        <div style="display:flex;gap:8px;margin-bottom:6px">
          <span style="color:var(--t3);flex-shrink:0">·</span>
          <div style="font-family:var(--ff-m);font-size:var(--text-xs);color:var(--t2);line-height:1.5">${t}</div>
        </div>`).join('')}
    </div>` : '';

  const html = `
    <div id="aurelo-score-sheet-backdrop"
         role="presentation"
         style="position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);
                -webkit-backdrop-filter:blur(4px);z-index:9998;display:flex;
                align-items:flex-end;justify-content:center;
                opacity:0;transition:opacity .25s;pointer-events:none"
         onclick="if(event.target===this)_closeAureloScoreSheet()">
      <div id="aurelo-score-sheet"
           style="width:100%;max-width:480px;background:var(--s0);border-radius:24px 24px 0 0;
                  border:1px solid var(--border2);border-bottom:none;
                  padding:12px 20px 44px;padding-bottom:max(44px,calc(env(safe-area-inset-bottom,0px) + 24px));
                  box-sizing:border-box;transform:translateY(100%);
                  transition:transform .3s cubic-bezier(.32,.72,0,1);
                  max-height:88vh;overflow-y:auto">
        <div style="width:40px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 18px"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="flex:1">
            <div style="font-family:var(--ff-d);font-size:var(--text-xl);font-weight:700;color:var(--t1);letter-spacing:-.3px">Aurelo Score</div>
            <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">${subtitle}</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--ff-d);font-size:var(--text-3xl);font-weight:700;color:${gradeColor};line-height:1">${score}</div>
            <div style="font-family:var(--ff-m);font-size:var(--text-xs);color:${gradeColor};margin-top:1px">${grade}</div>
          </div>
        </div>
        ${pillarsHtml}
        ${tipsHtml}
        <div style="display:flex;gap:8px;margin-top:4px">
          <button type="button" onclick="shareCard('aurelo');_closeAureloScoreSheet()"
                  type="button" style="flex:1;padding:14px;border-radius:14px;background:rgba(108,99,255,.12);
                         border:1px solid rgba(108,99,255,.30);color:var(--p2);
                         font-family:var(--ff-m);font-size:var(--text-sm);font-weight:600;cursor:pointer">📤 Share</button>
          <button type="button" onclick="_closeAureloScoreSheet()"
                  type="button" style="flex:1;padding:14px;border-radius:14px;background:var(--s2);
                         border:1px solid var(--border2);color:var(--t2);
                         font-family:var(--ff-m);font-size:var(--text-sm);font-weight:600;cursor:pointer">Close</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  // FIX: Force a layout reflow before starting the slide-up transition.
  // Reading offsetHeight flushes pending style calculations synchronously,
  // guaranteeing the browser has committed the initial translateY(100%)
  // state before we set translateY(0).  This prevents the "flash at final
  // position" flicker seen on Android WebView with double-rAF.
  requestAnimationFrame(function () {
    var backdrop = document.getElementById('aurelo-score-sheet-backdrop');
    var sheet    = document.getElementById('aurelo-score-sheet');
    if (!backdrop) return;
    void backdrop.offsetHeight; // force layout flush
    backdrop.style.opacity       = '1';
    backdrop.style.pointerEvents = 'all';
    if (sheet) sheet.style.transform = 'translateY(0)';
  });
}

function _closeAureloScoreSheet() {
  const backdrop = document.getElementById('aurelo-score-sheet-backdrop');
  const sheet    = document.getElementById('aurelo-score-sheet');
  if (!backdrop) return;
  backdrop.style.opacity = '0';
  if (sheet) sheet.style.transform = 'translateY(100%)';
  setTimeout(() => backdrop?.remove(), 320);
}

/* expose for app-share.js _buildAureloScoreCard */
window.getAureloScoreData = _getAureloScoreData;

/* ═══════════════════════════════════════════════════════
 * _showBodyScoreSheet
 * Bottom sheet showing HRV · Steps · RHR breakdown (spec §4.2)
 * ═══════════════════════════════════════════════════════ */
function _showBodyScoreSheet() {
  document.getElementById('body-score-sheet-backdrop')?.remove();
  if (typeof HealthConnect === 'undefined' || !HealthConnect.isConnected()) return;

  const bodyScore  = HealthConnect.getBodyScore();
  const gradeColor = bodyScore >= 70 ? 'var(--g)' : bodyScore >= 50 ? 'var(--a)' : 'var(--hc)';

  // Fetch real HC data from the bridge; fall back to safe defaults only when unavailable.
  let _hcRaw = {};
  try {
    const _hcStr = window.AppBridge?.getHCData?.();
    if (_hcStr) {
    const _parsed = JSON.parse(_hcStr);
    if (_parsed ) _hcRaw = _parsed; }
  } catch (_) {}
  const live = {
    steps:    (_hcRaw.steps    != null && _hcRaw.steps    >= 0) ? _hcRaw.steps    : null,
    hrv:      _hcRaw.hrv      ?? null,
    avgHrv7d: _hcRaw.avgHrv7d ?? null,
    rhr:      _hcRaw.restingHR ?? null,
    avgRhr7d: _hcRaw.avgRhr7d  ?? null,
  };

  const hrvPct   = (live.hrv != null && live.avgHrv7d != null && live.avgHrv7d > 0)
    ? Math.min(100, Math.round(live.hrv / live.avgHrv7d * 100)) : null;
  const rhrPct   = (live.rhr != null && live.avgRhr7d != null && live.avgRhr7d > 0)
    ? (live.rhr <= live.avgRhr7d ? 100 : Math.max(0, Math.round((1 - (live.rhr - live.avgRhr7d) / 20) * 100))) : null;
  const stepsPct = live.steps != null
    ? Math.min(100, Math.round(Math.max(0, (live.steps - 2000) / 6000 * 100))) : null;

  const _noData = '<span style="color:var(--t3);font-size:var(--text-xs)">No data</span>';
  const rows = [
    {
      label: 'Heart Rate Variability', icon: '💜',
      val: live.hrv != null ? live.hrv + 'ms' : _noData,
      sub: live.avgHrv7d != null ? '7-day avg: ' + live.avgHrv7d + 'ms' : '7-day avg: –',
      pct: hrvPct, col: hrvPct == null ? 'var(--t3)' : hrvPct >= 100 ? 'var(--g)' : hrvPct >= 70 ? 'var(--a)' : 'var(--r)',
    },
    {
      label: 'Resting Heart Rate', icon: '❤️',
      val: live.rhr != null ? live.rhr + ' bpm' : _noData,
      sub: live.avgRhr7d != null ? '7-day avg: ' + live.avgRhr7d + ' bpm' : '7-day avg: –',
      pct: rhrPct, col: rhrPct == null ? 'var(--t3)' : rhrPct >= 100 ? 'var(--g)' : rhrPct >= 70 ? 'var(--a)' : 'var(--r)',
    },
    {
      label: 'Daily Steps', icon: '🦶',
      val: live.steps != null ? live.steps.toLocaleString() : _noData,
      sub: 'Goal: 8,000 steps',
      pct: stepsPct, col: stepsPct == null ? 'var(--t3)' : stepsPct >= 100 ? 'var(--g)' : stepsPct >= 60 ? 'var(--a)' : 'var(--r)',
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
                    color:${r.col};line-height:1">${r.val}</div>
      </div>
      <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${r.pct != null ? r.pct : 0}%;background:${r.col};border-radius:2px;transition:width .4s"></div>
      </div>
    </div>`).join('');

  const html = `
    <div id="body-score-sheet-backdrop" role="presentation"
         style="position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);
                -webkit-backdrop-filter:blur(4px);z-index:9998;display:flex;
                align-items:flex-end;justify-content:center;
                opacity:0;transition:opacity .25s;pointer-events:none"
         onclick="if(event.target===this)_closeBodyScoreSheet()">
      <div id="body-score-sheet"
           style="width:100%;max-width:480px;background:var(--s0);border-radius:24px 24px 0 0;
                  border:1px solid var(--border2);border-bottom:none;
                  padding:12px 20px 44px;padding-bottom:max(44px,calc(env(safe-area-inset-bottom,0px)+24px));
                  box-sizing:border-box;transform:translateY(100%);
                  transition:transform .3s cubic-bezier(.32,.72,0,1);max-height:88vh;overflow-y:auto">
        <div style="width:40px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 18px"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-family:var(--ff-d);font-size:var(--text-xl);font-weight:700;color:var(--t1);letter-spacing:-.3px">Body Score</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
              <span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">via Health Connect</span>
              <span style="font-size:var(--text-2xs);color:var(--hc);background:var(--hc-dim);
                           border:1px solid var(--hc-border);border-radius:5px;
                           padding:1px 6px;font-weight:600;letter-spacing:.3px">HC</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-family:var(--ff-d);font-size:var(--text-3xl);font-weight:700;
                        color:${gradeColor};line-height:1">${bodyScore >= 0 ? bodyScore : '–'}</div>
          </div>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:20px">
          <div style="height:100%;width:${Math.max(0, bodyScore)}%;
                      background:linear-gradient(90deg,var(--hc),var(--g));border-radius:3px;transition:width .4s"></div>
        </div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);
                    letter-spacing:.8px;margin-bottom:14px">HOW THIS IS CALCULATED</div>
        ${rowsHtml}
        <div style="background:var(--hc-dim);border:1px solid var(--hc-border);border-radius:12px;
                    padding:10px 13px;font-family:var(--ff-m);font-size:var(--text-xs);
                    color:var(--t3);line-height:1.55;margin-bottom:16px">
          Each signal scored 0–100 against your personal 7-day baseline.
          Body Score is the average. Equal 33% weight per signal.
        </div>
        <button type="button" onclick="_closeBodyScoreSheet()"
                style="width:100%;padding:14px;border-radius:14px;background:var(--s2);
                       border:1px solid var(--border2);color:var(--t2);
                       font-family:var(--ff-m);font-size:var(--text-sm);font-weight:600;cursor:pointer">Close</button>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  requestAnimationFrame(function () {
    var backdrop = document.getElementById('body-score-sheet-backdrop');
    var sheet    = document.getElementById('body-score-sheet');
    if (!backdrop) return;
    void backdrop.offsetHeight;
    backdrop.style.opacity       = '1';
    backdrop.style.pointerEvents = 'all';
    if (sheet) sheet.style.transform = 'translateY(0)';
  });
}

function _closeBodyScoreSheet() {
  const backdrop = document.getElementById('body-score-sheet-backdrop');
  const sheet    = document.getElementById('body-score-sheet');
  if (!backdrop) return;
  backdrop.style.opacity = '0';
  if (sheet) sheet.style.transform = 'translateY(100%)';
  setTimeout(() => backdrop?.remove(), 320);
}