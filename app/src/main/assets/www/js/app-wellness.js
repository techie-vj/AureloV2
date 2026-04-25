/* ═══ WELLNESS ═══════════════════════════════════════ */
let chartMode='today'; // default to hourly breakdown
/* ════ DONUT CHART (Android-native style) ═══════════════ */
function describeArc(cx,cy,ro,ri,startDeg,endDeg){
  const r=Math.PI/180;
  const s1=startDeg*r, e1=endDeg*r;
  const x1=cx+ro*Math.cos(s1), y1=cy+ro*Math.sin(s1);
  const x2=cx+ro*Math.cos(e1), y2=cy+ro*Math.sin(e1);
  const x3=cx+ri*Math.cos(e1), y3=cy+ri*Math.sin(e1);
  const x4=cx+ri*Math.cos(s1), y4=cy+ri*Math.sin(s1);
  const la=(endDeg-startDeg)>180?1:0;
  return `M${x1},${y1} A${ro},${ro},0,${la},1,${x2},${y2} L${x3},${y3} A${ri},${ri},0,${la},0,${x4},${y4}Z`;
}

function fmtMNative(m){
  if(!m||m<=0) return '0 min';
  const h=Math.floor(m/60),mn=m%60;
  if(h>0&&mn>0) return `${h} hr, ${mn} min`;
  if(h>0) return `${h} hr`;
  return `${mn} min`;
}

function renderDonutChart(){
  const wrap=document.getElementById('donut-wrap');
  if(!wrap) return;
  // If TODAY_MINS is 0 but DAILY_USE has data (e.g. boot before first bgExecutor tick),
  // sum app minutes so the donut renders correctly instead of producing NaN arcs.
  const total = TODAY_MINS > 0
    ? TODAY_MINS
    : DAILY_USE.reduce((s, a) => s + (a.totalMinutes || 0), 0);
  const goal=S.streakGoalMins||240;
  const goaldiff=goal-total;

  // Build segments from DAILY_USE
  const use=[...DAILY_USE];
  // Merge tail into Other
  const MAX_SEGS=7;
  let segs=[];
  if(!use.length){
    const hasPermission = IS_NATIVE && N.hasUsagePermission && N.hasUsagePermission();
    wrap.innerHTML=`<div style="padding:32px;text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3)">
      ${hasPermission ? '📭 No app usage recorded yet today' : 'Grant Usage Access to see real screen time'}</div>
      <div id="arc-goal" style="font-size:13px;color:var(--t3);margin-top:4px">–</div>`;
    return;
  }
  const topUse=use.slice(0,MAX_SEGS);
  const appMins=use.reduce((s,a)=>s+a.totalMinutes,0);
  const otherAppMins=use.slice(MAX_SEGS).reduce((s,a)=>s+a.totalMinutes,0);
  // System time = total (incl. launcher/SystemUI) minus all user-app minutes
  const systemMins=Math.max(0, total - appMins);
  topUse.forEach(a=>segs.push({name:a.name,mins:a.totalMinutes}));
  // Combine tail apps + system/other time into one "Other" slice
  const combinedOther = otherAppMins + systemMins;
  if(combinedOther>0) segs.push({name:'Other',mins:combinedOther});

  // Color palette: rosy/warm tones matching Android DW style
  const PALETTE=['#E8A4B8','#C9A8D8','#A8B8D8','#E8C9A4','#A8D0B8','#D4A8A8','#B8C8E0','#C8B4D8'];
  const OTHER_COL='#C0B4CC';

  const W=320, CX=W/2, CY=W/2, RO=118, RI=76, GAP=1.8;
  let paths=[], labels=[];
  let angle=-90; // start from top

  const legendItems=[];
  segs.forEach((seg,i)=>{
    const sweep=(seg.mins/total)*360;
    if(!isFinite(sweep)||sweep<1){ angle+=sweep||0; return; }
    const sa=angle+GAP/2, ea=angle+sweep-GAP/2;
    const color=i<segs.length-1?PALETTE[i%PALETTE.length]:OTHER_COL;
    // FUN-05 FIX: App names injected directly into onclick="" broke with special chars
    // (apostrophes, quotes). Now stored in data-attributes and read in the handler.
    const safeName = seg.name.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    paths.push(`<path d="${describeArc(CX,CY,RO,RI,sa,ea)}" fill="${color}"
      data-seg-name="${safeName}"
      data-seg-time="${fmtM(seg.mins)}"
      onclick="showDonutTip(this.dataset.segName,this.dataset.segTime)"
      style="cursor:pointer;transition:opacity .2s,filter .2s,transform .2s"/>`);
    // No floating labels — legend below has all names
    legendItems.push({color, name:seg.name, mins:seg.mins, pct:Math.round(sweep/3.6)});
    angle+=sweep;
  });

  const totalStr=fmtMNative(total);
  const goalColor=goaldiff>=0?'#12D48A':'#F04E7A';
  const goalStr=goaldiff>=0?`${fmtMNative(goaldiff)} under your ${fmtMNative(goal)} goal`:`${fmtMNative(-goaldiff)} over your ${fmtMNative(goal)} goal`;

  // Build compact legend
  const legendHtml = legendItems.slice(0,5).map(li=>`
    <div style="display:flex;align-items:center;gap:5px;white-space:nowrap;overflow:hidden">
      <div style="width:8px;height:8px;border-radius:2px;flex-shrink:0;background:${li.color}"></div>
      <span style="font-size:12px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;max-width:80px">${li.name}</span>
      <span style="font-family:var(--ff-m);font-size:11px;color:var(--t3);flex-shrink:0">${fmtM(li.mins)}</span>
    </div>`).join('');

  wrap.innerHTML=`
    <svg viewBox="0 0 ${W} ${W}" width="100%" style="max-width:${W}px;display:block">
      ${paths.join('')}
      <text id="donut-center-today" x="${CX}" y="${CY-16}" text-anchor="middle" fill="var(--t3)" font-size="13" font-family="system-ui">Today</text>
      <text x="${CX}" y="${CY+14}" text-anchor="middle" fill="var(--t1)" font-size="28" font-weight="800" font-family="system-ui,-apple-system">${totalStr}</text>
      <text id="donut-center-name" x="${CX}" y="${CY-12}" text-anchor="middle" fill="var(--t1)" font-size="14" font-weight="700" font-family="system-ui" style="display:none"></text>
      <text id="donut-center-time" x="${CX}" y="${CY+10}" text-anchor="middle" fill="var(--t2)" font-size="12" font-family="system-ui" style="display:none"></text>
    </svg>
    <div id="arc-goal" style="font-size:13px;color:${goalColor};margin-top:-6px;font-family:var(--ff-m);margin-bottom:10px">${goaldiff>=0?'✓':'⚠'} ${goalStr}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;padding:0 16px 4px;width:100%;max-width:${W}px">${legendHtml}</div>`;
}

// Donut segment tap — dim others, show label in SVG center, auto-revert
let _donutTipTimer = null;
function showDonutTip(name, time){
  const wrap = document.getElementById('donut-wrap');
  if(!wrap) return;
  // Clear any running timer
  if(_donutTipTimer){ clearTimeout(_donutTipTimer); _donutTipTimer=null; }
  // Get all paths in donut SVG
  const svg = wrap.querySelector('svg');
  if(!svg) return;
  const paths = svg.querySelectorAll('path');
  // If clicking same seg again → reset immediately
  const cur = svg.dataset.activeSeg;
  if(cur === name){
    _resetDonutHighlight(svg, paths);
    return;
  }
  svg.dataset.activeSeg = name;
  // Dim all paths, find and brighten the clicked one
  paths.forEach(p => {
    const pName = p.dataset.segName;
    if(pName === name){
      p.style.opacity = '1';
      p.style.filter = 'drop-shadow(0 0 8px rgba(255,255,255,.5)) brightness(1.18)';
      p.style.transform = 'scale(1.04)';
      p.style.transformOrigin = '160px 160px';
    } else {
      p.style.opacity = '0.35';
      p.style.filter = '';
      p.style.transform = '';
    }
  });
  // Update center text with app name and time
  const centerName = svg.querySelector('#donut-center-name');
  const centerTime = svg.querySelector('#donut-center-time');
  const centerToday = svg.querySelector('#donut-center-today');
  if(centerName) { centerName.textContent = name; centerName.style.display=''; }
  if(centerTime) { centerTime.textContent = time; centerTime.style.display=''; }
  if(centerToday) centerToday.style.display='none';
  // Auto-revert after 2.5s
  _donutTipTimer = setTimeout(()=>{ _resetDonutHighlight(svg, paths); }, 2500);
}
function _resetDonutHighlight(svg, paths){
  if(!svg) return;
  svg.dataset.activeSeg = '';
  paths.forEach(p=>{ p.style.opacity='1'; p.style.filter=''; p.style.transform=''; });
  const centerName = svg.querySelector('#donut-center-name');
  const centerTime = svg.querySelector('#donut-center-time');
  const centerToday = svg.querySelector('#donut-center-today');
  if(centerName) centerName.style.display='none';
  if(centerTime) centerTime.style.display='none';
  if(centerToday) centerToday.style.display='';
}

var _SCREEN_SCORE_KEY = 'screen_score_history';


/* ═══════════════════════════════════════════════════════════════════
 * SCREEN SCORE
 * Three components: Goal adherence 50%, Pickup frequency 30%, First use 20%.
 * All data sourced from globals already available on the wellness/home refresh.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * calculateScreenScore()
 * Returns {score, goalAdherenceScore, pickupScore, firstUseScore,
 *          goalMins, todayMins, todayPickups, avgPickups, firstUseStr}
 * score is always 0–100 (never -1) because screen time data is always present.
 */
function calculateScreenScore() {
  var goalMins      = (typeof S !== 'undefined' && S.streakGoalMins) || 240;
  var todayMins     = (typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0) || 0;
  var todayPickups  = (typeof PICKUPS    !== 'undefined' ? PICKUPS    : 0) || 0;
  var firstUseStr   = (IS_NATIVE && typeof N.getFirstPickupTime === 'function')
                        ? N.getFirstPickupTime() : null;

  // ── 7-day pickup average from WEEKLY ────────────────────────────
  var pickupDays = [];
  if (typeof WEEKLY !== 'undefined' && Array.isArray(WEEKLY)) {
    WEEKLY.forEach(function(d) {
      if (d.isToday) {
        pickupDays.push(todayPickups);
      } else if (d.pickups !== undefined && d.pickups > 0) {
        pickupDays.push(d.pickups);
      }
    });
  }
  if (!pickupDays.length) pickupDays.push(todayPickups);
  var avgPickups = Math.round(
    pickupDays.reduce(function(a, b) { return a + b; }, 0) / pickupDays.length
  );

  // ── Component 1: Goal adherence (50%) ───────────────────────────
  var goalAdherenceScore;
  if (todayMins < goalMins) {
    goalAdherenceScore = 100;
  } else if (goalMins > 0 && todayMins <= goalMins * 1.5) {
    goalAdherenceScore = Math.max(0, Math.round(100 - ((todayMins - goalMins) / (goalMins * 0.5)) * 100));
  } else {
    goalAdherenceScore = 0;
  }

  // ── Component 2: Pickup frequency (30%) ─────────────────────────
  var pickupScore;
  if (avgPickups <= 0 || todayPickups <= avgPickups) {
    pickupScore = 100;
  } else if (todayPickups <= avgPickups * 1.5) {
    pickupScore = Math.max(0, Math.round(100 - ((todayPickups - avgPickups) / (avgPickups * 0.5)) * 50));
  } else {
    var excess = todayPickups - avgPickups * 1.5;
    var range  = Math.max(1, avgPickups * 1.5);
    pickupScore = Math.max(0, Math.round(50 - (excess / range) * 50));
  }

  // ── Component 3: First use of day (20%) ─────────────────────────
  var firstUseScore = 100; // default: no pickup yet = day not started
  var firstUseHour  = -1;
  if (firstUseStr && firstUseStr !== '–' && firstUseStr !== '--') {
    try {
      var m = firstUseStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (m) {
        var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
        var isPM = m[3].toUpperCase() === 'PM';
        if (isPM  && h !== 12) h += 12;
        if (!isPM && h === 12) h  = 0;
        firstUseHour = h + min / 60;
      }
    } catch(_) {}
    if (firstUseHour >= 0) {
      firstUseScore = firstUseHour >= 9 ? 100
                    : firstUseHour >= 8 ? 75
                    : firstUseHour >= 7 ? 50
                    : 25;
    }
  }

  var score = Math.round(goalAdherenceScore * 0.5 + pickupScore * 0.3 + firstUseScore * 0.2);
  return { score: score, goalAdherenceScore: goalAdherenceScore,
           pickupScore: pickupScore, firstUseScore: firstUseScore,
           goalMins: goalMins, todayMins: todayMins,
           todayPickups: todayPickups, avgPickups: avgPickups,
           firstUseStr: firstUseStr || null };
}



/**
 * Shared Screen Score view-model.
 * Keeps compact rows, Aurelo composite, and the detail sheet on the same
 * Health Connect-adjusted number.
 */
function _getScreenScoreWithHealthConnect() {
  var res = calculateScreenScore();
  var hcConnected = typeof HealthConnect !== 'undefined' && HealthConnect.isConnected();
  var hcMod = { modifier: 0, label: null };
  if (hcConnected && typeof HealthConnect.getActivityModifier === 'function') {
    try { hcMod = HealthConnect.getActivityModifier() || hcMod; } catch (_) {}
  }
  var effectiveScore = Math.min(100, Math.max(0, res.score + (hcMod.modifier || 0)));
  return { res: res, hcConnected: hcConnected, hcMod: hcMod, effectiveScore: effectiveScore };
}

function _readHealthConnectScreenData() {
  var raw = {};
  try {
    var str = (window.AppBridge && typeof window.AppBridge.getHCData === 'function')
      ? window.AppBridge.getHCData()
      : null;
    if (str) raw = JSON.parse(str) || {};
  } catch (_) {}
  return raw;
}

window.calculateScreenScoreWithHealthConnect = _getScreenScoreWithHealthConnect;

/** Grade label + colour for a screen score value. */
function _screenScoreGrade(score) {
  if (score >= 90) return { label: 'Excellent', color: '#6ec97a' };
  if (score >= 75) return { label: 'Good',      color: '#05c8e8' };
  if (score >= 60) return { label: 'Fair',       color: '#f7c948' };
  if (score >= 40) return { label: 'Low',        color: '#ffaa50' };
  return                  { label: 'Poor',       color: '#ff6a6a' };
}

/**
 * renderScreenScoreSheet()
 * Opens a bottom sheet with the full Screen score breakdown.
 * Uses the identical _buildScoreSheet / _openScoreSheet mechanism as
 * openFocusScoreSheet() and openHabitsScoreSheet().
 */
function renderScreenScoreSheet() {
  var screenVm = _getScreenScoreWithHealthConnect();
  var res = screenVm.res;
  var hcMod = screenVm.hcMod;
  var hcConnected = screenVm.hcConnected;
  var effectiveScore = screenVm.effectiveScore;
  _saveScoreForToday(_SCREEN_SCORE_KEY, effectiveScore);

  var fmtGoal    = fmtM(res.goalMins);
  var fmtToday   = fmtM(res.todayMins);
  var goalPts    = Math.round(res.goalAdherenceScore * 0.5);
  var pickupPts  = Math.round(res.pickupScore        * 0.3);
  var firstUsePts= Math.round(res.firstUseScore      * 0.2);

  // ── Component data lines ─────────────────────────────────────────
  var goalDataLine;
  if (res.todayMins === 0) {
    goalDataLine = 'No screen time recorded yet · goal is ' + fmtGoal;
  } else if (res.todayMins < res.goalMins) {
    goalDataLine = fmtToday + ' of ' + fmtGoal + ' goal used today';
  } else {
    goalDataLine = fmtToday + ' used · ' + fmtM(res.todayMins - res.goalMins) + ' over your ' + fmtGoal + ' goal';
  }

  var pickupRelative = res.todayPickups <= res.avgPickups
    ? 'below your daily average'
    : (res.todayPickups <= Math.round(res.avgPickups * 1.2) ? 'near your daily average' : 'above your daily average');
  var pickupDataLine = res.todayPickups + ' pickups · ' + pickupRelative + ' (' + res.avgPickups + ' avg)';

  var firstUseLabel, firstUseDataLine;
  if (!res.firstUseStr || res.firstUseStr === '–' || res.firstUseStr === '--') {
    firstUseDataLine = 'No pickup yet today';
    firstUseLabel    = 'good start';
  } else {
    firstUseLabel    = res.firstUseScore >= 100 ? 'great start'
                     : res.firstUseScore >= 75  ? 'good start'
                     : res.firstUseScore >= 50  ? 'fair start'
                     : 'late start';
    firstUseDataLine = 'First pickup at ' + res.firstUseStr + ' · ' + firstUseLabel;
  }

  var components = [
    { label: 'Daily goal adherence', weight: 50, pts: goalPts,     maxPts: 50, dataLine: goalDataLine    },
    { label: 'Pickup frequency',     weight: 30, pts: pickupPts,   maxPts: 30, dataLine: pickupDataLine   },
    { label: 'First use of day',     weight: 20, pts: firstUsePts, maxPts: 20, dataLine: firstUseDataLine },
  ];

  // ── How to improve — up to 2 suggestions ────────────────────────
  var candidates = [];

  // Time remaining today (rough: assume day ends at midnight)
  var nowH  = new Date().getHours() + new Date().getMinutes() / 60;
  var timeLeft = nowH < 23.5; // still some of the day left

  if (res.goalAdherenceScore < 80 && timeLeft) {
    var goalGain = Math.round((100 - res.goalAdherenceScore) * 0.5 * 0.6);
    candidates.push({ score: res.goalAdherenceScore, text: 'Stay under your ' + fmtGoal + ' goal today', impact: goalGain });
  }
  if (res.pickupScore < 70) {
    var puGain = Math.round((100 - res.pickupScore) * 0.3 * 0.6);
    candidates.push({ score: res.pickupScore, text: 'Reduce pickups below your ' + res.avgPickups + ' daily average', impact: puGain });
  }
  if (res.firstUseScore < 75) {
    var fuGain = Math.round((100 - res.firstUseScore) * 0.2 * 0.6);
    candidates.push({ score: res.firstUseScore, text: 'Delay first use past 9 AM tomorrow', impact: fuGain });
  }

  // Sort by lowest component score first (biggest improvement opportunity)
  candidates.sort(function(a, b) { return a.score - b.score; });
  var improvements = candidates.slice(0, 2).map(function(c) {
    return { text: c.text, impact: Math.max(1, c.impact) };
  });

  // BUG-06 fix: _openScoreSheet and _buildScoreSheet are private to the FocusScore
  // IIFE. Call them through the public API instead of as bare globals.
  var sheetHtml = FocusScore.buildScoreSheet({
    title:        'Screen score',
    score:        effectiveScore,
    scoreKey:     _SCREEN_SCORE_KEY,
    components:   components,
    improvements: improvements,
  });

  if (hcConnected) {
    var hcTitleBadge =
      '<span style="font-size:var(--text-2xs);color:var(--hc);background:var(--hc-dim);' +
      'border:1px solid var(--hc-border);border-radius:5px;padding:1px 6px;' +
      'font-weight:700;letter-spacing:.3px;margin-left:8px;vertical-align:middle">HC</span>';
    sheetHtml = sheetHtml.replace('Screen score</div>', 'Screen score' + hcTitleBadge + '</div>');

    var hcRaw = _readHealthConnectScreenData();
    var hasSteps = hcRaw && hcRaw.steps != null && hcRaw.steps >= 0;
    var hcScreenRows = hasSteps
      ? '<div style="display:flex;align-items:center;gap:10px;padding:8px 0">' +
          '<div style="flex:1">' +
            '<div style="font-size:var(--text-sm);font-weight:600;color:var(--t1)">Daily Steps</div>' +
            '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">' +
              Number(hcRaw.steps).toLocaleString() + ' steps from Health Connect' +
            '</div>' +
          '</div>' +
          '<div style="font-family:var(--ff-m);font-size:var(--text-xs);font-weight:700;color:' +
            ((hcMod.modifier || 0) >= 0 ? 'var(--g)' : 'var(--r)') + '">' +
            ((hcMod.modifier || 0) > 0 ? '+' : '') + (hcMod.modifier || 0) + ' pts' +
          '</div>' +
        '</div>'
      : '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);padding:10px 2px">No Health Connect screen-time activity data recorded today.</div>';
    var hcScreenSection =
      '<div style="margin-bottom:16px">' +
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">' +
          '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:.8px">HEALTH CONNECT · ACTIVITY</span>' +
          '<span style="font-size:var(--text-2xs);color:var(--hc);background:var(--hc-dim);border:1px solid var(--hc-border);border-radius:5px;padding:1px 5px;font-weight:600;letter-spacing:.3px">HC</span>' +
        '</div>' +
        '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:4px 14px;margin-bottom:8px">' +
          hcScreenRows +
        '</div>' +
      '</div>';
    sheetHtml = sheetHtml.replace('HOW THIS IS CALCULATED', hcScreenSection + 'HOW THIS IS CALCULATED');
  }

  // ── Inject HC modifier banner into sheet HTML if applicable ──────
  if (hcConnected && hcMod.label) {
    var bannerColor = hcMod.modifier > 0 ? 'var(--g)' : 'var(--r)';
    var bannerBg    = hcMod.modifier > 0 ? 'rgba(18,212,138,.07)' : 'rgba(240,78,122,.07)';
    var bannerBorder= hcMod.modifier > 0 ? 'rgba(18,212,138,.25)' : 'rgba(240,78,122,.25)';
    var hcBanner =
      '<div style="background:' + bannerBg + ';border:1px solid ' + bannerBorder + ';' +
      'border-radius:12px;padding:10px 13px;margin-bottom:14px;display:flex;align-items:center;gap:8px">' +
      '<span style="font-size:10px;color:var(--hc);background:var(--hc-dim);border:1px solid var(--hc-border);' +
      'border-radius:5px;padding:1px 6px;font-weight:700;letter-spacing:.3px;flex-shrink:0">HC</span>' +
      '<span style="font-family:var(--ff-m);font-size:var(--text-xs);color:' + bannerColor + ';font-weight:600">' +
      hcMod.label + '</span>' +
      '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-left:auto">Includes Health Connect step data</span>' +
      '</div>';
    // Inject just before the HOW THIS IS CALCULATED label
    sheetHtml = sheetHtml.replace('HOW THIS IS CALCULATED', hcBanner + 'HOW THIS IS CALCULATED');
  }

  FocusScore.openScoreSheet(sheetHtml);
}

/**
 * renderStatsScreenScoreRow()
 * Renders the compact score pill into #stats-screen-score-row on the
 * Stats Today subtab. Tapping it opens the full renderScreenScoreSheet().
 */
function renderStatsScreenScoreRow() {
  var el = document.getElementById('stats-screen-score-row');
  if (!el) return;
  var screenVm = _getScreenScoreWithHealthConnect();
  var res = screenVm.res;
  var hcMod = screenVm.hcMod;
  var hcConnected = screenVm.hcConnected;
  var displayScore = screenVm.effectiveScore;
  _saveScoreForToday(_SCREEN_SCORE_KEY, displayScore);

  var grade = _screenScoreGrade(displayScore);

  var yScore   = _getYesterdayScore(_SCREEN_SCORE_KEY);
  var deltaHtml = '';
  if (yScore !== null) {
    var diff = displayScore - yScore;
    if (diff !== 0) {
      var dCol  = diff > 0 ? '#6ec97a' : '#ff6a6a';
      var dSign = diff > 0 ? '↑' : '↓';
      deltaHtml = '<div style="font-size:10px;color:' + dCol + ';flex-shrink:0">'
                + dSign + Math.abs(diff) + '</div>';
    }
  }

  var hcChipHtml = hcConnected
    ? '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">'
        + '<span style="font-size:9px;color:var(--hc);background:var(--hc-dim);'
        + 'border:1px solid var(--hc-border);border-radius:4px;padding:1px 5px;'
        + 'font-weight:700;letter-spacing:.3px;font-family:var(--ff-m)">HC</span>'
        + ((hcMod.modifier || 0) !== 0
          ? '<span style="font-family:var(--ff-m);font-size:10px;font-weight:600;color:'
            + (hcMod.modifier > 0 ? 'var(--g)' : 'var(--r)') + '">'
            + (hcMod.modifier > 0 ? '+' : '') + hcMod.modifier
            + '</span>'
          : '')
      + '</div>'
    : '';

  el.innerHTML =
    '<div onclick="renderScreenScoreSheet()"'
    + ' style="background:var(--s2);border:0.5px solid var(--border2);border-radius:14px;'
    + 'padding:10px 14px;display:flex;align-items:center;gap:10px;cursor:pointer">'
    + '<div style="font-size:11px;color:var(--t3);flex-shrink:0">SCREEN SCORE</div>'
    + '<div style="font-size:16px;font-weight:600;color:var(--p2);flex-shrink:0">' + displayScore + '</div>'
    + '<div style="flex:1;height:3px;background:var(--border2);border-radius:99px;overflow:hidden">'
    + '<div style="height:100%;width:' + displayScore + '%;background:linear-gradient(90deg,var(--p),var(--c));border-radius:99px"></div>'
    + '</div>'
    + hcChipHtml
    + '<div style="font-size:11px;font-weight:500;color:' + grade.color + ';flex-shrink:0">' + grade.label + '</div>'
    + deltaHtml
    + '</div>';
}

/* expose for use from app-home.js Screen pillar tap and app-wellness.js */
window.renderScreenScoreSheet  = renderScreenScoreSheet;
window.renderStatsScreenScoreRow = renderStatsScreenScoreRow;

/**
 * setWellnessView — single entry point for all tab switches.
 * Gates the monthly view BEFORE _wellnessView is assigned so no month
 * content ever renders and nothing is visible on paywall dismiss.
 * HTML tab buttons must call this instead of assigning _wellnessView directly.
 *
 * For cases where HTML still assigns _wellnessView directly, we also intercept
 * via Object.defineProperty so the gate fires regardless of call site.
 */
let _wellnessViewInternal = 'today';
(function _installWellnessViewGate() {
  Object.defineProperty(window, '_wellnessView', {
    get: function() { return _wellnessViewInternal; },
    set: function(v) {
      if (v === 'month' && !ProTier.isPro) {
        ProTier.triggerUpsell('MONTHLY_CALENDAR');
        return; // block the assignment — _wellnessViewInternal stays unchanged
      }
      _wellnessViewInternal = v;
    },
    configurable: true,
  });
})();

function setWellnessView(view) {
  // Delegates to the property setter above which handles the Pro gate
    _wellnessView = view;  // ✅ triggers the defineProperty setter, which calls ProTier.triggerUpsell() if not pro
}

function renderWellness(){
  // NFU-04 FIX: Show persistent permission banner when usage access not granted
  const permBanner = document.getElementById('usage-perm-banner');
  if(permBanner){
    const hasUsage = IS_NATIVE && N.hasUsagePermission();
    permBanner.style.display = hasUsage ? 'none' : 'block';
  }

  // Route to the correct view renderer
  if(_wellnessView === 'week')  { renderWeekView();  return; }
  if(_wellnessView === 'month') { renderMonthView(); return; }

  // ── TODAY VIEW ────────────────────────────────────────────────────────────
  // Only re-render donut when TODAY_MINS changed — it's the most expensive part
  // Re-render donut when TODAY_MINS changes OR when DAILY_USE gains/loses entries.
  // The second condition catches the boot window where TODAY_MINS stays 0 but cached
  // DAILY_USE arrives — without it the guard sees 0===0 and skips the render entirely.
  if(_lastWellnessMins !== TODAY_MINS || _lastDailyUseLen !== DAILY_USE.length){
    _lastWellnessMins = TODAY_MINS;
    _lastDailyUseLen  = DAILY_USE.length;
    renderDonutChart();
  }

  // Stats
  const wp=document.getElementById('w-pickups'); if(wp) wp.textContent=PICKUPS>0?PICKUPS:'–';
  const wt=document.getElementById('w-top'); if(wt){ wt.textContent=DAILY_USE[0]?.name||'–'; wt.style.fontSize=DAILY_USE[0]?'13px':'18px'; }
  const first=IS_NATIVE?N.getFirstPickupTime():'–';
  const wf=document.getElementById('w-first'); if(wf){ wf.textContent=first||'–'; wf.style.fontSize='13px'; }

  // Screen score row — sits between goal/chart area and Top Apps list
  renderStatsScreenScoreRow();

  // Chart
  renderChart(chartMode);

  // Top apps
  renderTopApps();

  // Hide ad slot (recommendations removed)
  const adSlot = document.getElementById('wellness-ad-slot');
  if(adSlot) adSlot.style.display = 'none';

  // Smart tips (rule-based, shown to free users; hidden for Pro by renderTodayCoachInsight)
  renderSmartTips();

  // Coach insight card (Pro only) — replaces smart-tips section
  if (typeof renderTodayCoachInsight === 'function') renderTodayCoachInsight();
}

// ── Native Recommendations — Persona-driven + Country-aware ─────────────────
// Detects user persona from actual device behavior and serves targeted recs.
// Each rule can match multiple personas. 3+ variations per category.

// Country-specific app overrides { countryCode → { appPkg, appName } }
const COUNTRY_APPS = {
  IN: { social_alt:{pkg:'in.sharechat.chat',name:'ShareChat'}, music:{pkg:'com.gaana',name:'Gaana'}, news:{pkg:'com.dailyhunt',name:'DailyHunt'}, notes:{pkg:'com.notion.id',name:'Notion'} },
  GB: { social_alt:{pkg:'com.nextdoor',name:'Nextdoor'}, music:{pkg:'com.bbc.sounds',name:'BBC Sounds'}, news:{pkg:'uk.co.theguardian',name:'Guardian'} },
  AU: { news:{pkg:'com.abc.au',name:'ABC News AU'} },
  DE: { music:{pkg:'de.deezer.android',name:'Deezer'} },
  BR: { music:{pkg:'com.deezer.android',name:'Deezer'}, social_alt:{pkg:'com.kwai.video',name:'Kwai'} },
  JP: { social_alt:{pkg:'jp.naver.line.android',name:'LINE'}, music:{pkg:'com.apple.android.music',name:'Amazon Music'} },
};

function countryApp(key, defPkg, defName){
  const cc = IS_NATIVE&&typeof N.getCountryCode==='function' ? N.getCountryCode() : 'US';
  const ovr = (COUNTRY_APPS[cc]||{})[key];
  return ovr || {pkg:defPkg, name:defName};
}

// ── PERSONA RULES ─────────────────────────────────────────────────────────────
// Each rule: { id, detect(dailyUse,todayMins,pickups,goalMins)→bool, recs:[...] }
// recs items: { pkg, appName, title, body, cta }
// Multiple recs per rule → one is picked based on day-of-week rotation
const PERSONA_RULES = [

  // ── ① PRODUCTIVITY & FOCUS ──────────────────────────────────────────────────
  {
    id:'focus_overworked',
    detect:(u,t,p,g)=>u.some(a=>/(slack|teams|outlook|gmail|work)/.test((a.packageName+a.name).toLowerCase())&&a.totalMinutes>90),
    recs:[
      { pkg:'cc.forestapp', appName:'Forest',
        title:'Overworked? Plant a Tree 🌲',
        body:(u,t,p,g)=>`You've had ${fmtM(t)} of work app use today. Forest blocks distractions while growing a real tree — take a 25-min break.`,
        cta:'Grow with Forest' },
      { pkg:'com.focuslypro.app', appName:'Focusly Pro',
        title:'Deep Work Mode 🎯',
        body:(u,t,p,g)=>`Work apps are dominating your screen. Try AI-driven deep work sessions to boost productivity and protect your focus time.`,
        cta:'Try Focusly Free' },
      { pkg:'com.tatkovlab.pomodorolite', appName:'Pomodoro Timer',
        title:'Batch Your Focus ⏱️',
        body:(u,t,p,g)=>`${p} pickups today means fragmented attention. The Pomodoro method keeps you in the zone with 25-min focused sprints.`,
        cta:'Start Pomodoro' },
    ]
  },

  {
    id:'focus_high_pickups',
    detect:(u,t,p,g)=>p>70,
    recs:[
      { pkg:'com.focuslypro.app', appName:'Focusly Pro',
        title:'${p} Phone Unlocks 📲',
        body:(u,t,p,g)=>`${p} unlocks today — your phone is stealing your attention every few minutes. Try a 2-hour focus block to reclaim your time.`,
        cta:'Block Distractions' },
      { pkg:'cc.forestapp', appName:'Forest',
        title:'Phone Overuse Alert 🌱',
        body:(u,t,p,g)=>`Picking up your phone ${p} times breaks concentration. Forest makes staying off your phone into a rewarding game.`,
        cta:'Plant a Focus Tree' },
      { pkg:'com.tatkovlab.pomodorolite', appName:'Pomodoro Timer',
        title:'Tame the Scroll Habit ⏰',
        body:(u,t,p,g)=>`${p} phone checks today. A Pomodoro timer creates structured breaks so you check intentionally, not reflexively.`,
        cta:'Try Pomodoro' },
    ]
  },

  {
    id:'productivity_note_taker',
    detect:(u,t,p,g)=>u.some(a=>/(notion|evernote|obsidian|bear|onenote|keep)/.test((a.packageName+a.name).toLowerCase())&&a.totalMinutes>30),
    recs:[
      { pkg:'notion.id', appName:'Notion',
        title:'Level Up Your Notes 📝',
        body:(u,t,p,g)=>`You're already building a knowledge base. Notion combines notes, tasks and databases into one beautiful workspace.`,
        cta:'Try Notion Free' },
      { pkg:'md.obsidian', appName:'Obsidian',
        title:'Build Your Second Brain 💎',
        body:(u,t,p,g)=>`Heavy note-taker? Obsidian links ideas together — building a personal wiki that gets smarter as you use it.`,
        cta:'Download Obsidian' },
      { pkg:'com.ticktick.task', appName:'TickTick',
        title:'Notes + Habits = Magic ✅',
        body:(u,t,p,g)=>`Pair your note-taking with habit tracking. TickTick combines smart tasks, habit streaks and a built-in Pomodoro timer.`,
        cta:'Get TickTick' },
    ]
  },

  // ── ② DIGITAL WELLNESS & HEALTH ─────────────────────────────────────────────
  {
    id:'wellness_over_goal',
    detect:(u,t,p,g)=>t>g,
    recs:[
      { pkg:'cc.forestapp', appName:'Forest',
        title:'Over Your ${g}h Goal 🌳',
        body:(u,t,p,g)=>`${fmtM(t)} today — ${fmtM(t-g)} over your daily goal. A 20-min focus session with Forest can help you reset before tonight.`,
        cta:'Start Focus Session' },
      { pkg:'com.getsomeheadspace.android', appName:'Headspace',
        title:'Time for a Mental Reset 🧘',
        body:(u,t,p,g)=>`You've exceeded your daily screen time goal. A 10-minute Headspace meditation can clear your mind and reduce phone urges.`,
        cta:'Meditate Now' },
      { pkg:'com.calm.android', appName:'Calm',
        title:'Screen Time Goal Broken 💤',
        body:(u,t,p,g)=>`${fmtM(t)} of screen time vs your ${fmtM(g)} goal. Calm's breathing exercises and sleep sounds help you wind down properly.`,
        cta:'Open Calm' },
    ]
  },

  {
    id:'wellness_social_heavy',
    detect:(u,t,p,g)=>{
      const socialMins=u.filter(a=>/(instagram|tiktok|snapchat|facebook|twitter|reddit)/.test((a.packageName+a.name).toLowerCase())).reduce((s,a)=>s+a.totalMinutes,0);
      return socialMins>75;
    },
    recs:[
      { pkg:'cc.bereal', appName:'BeReal',
        title:'Social, but Make it Real 📸',
        body:(u,t,p,g)=>{
          const n=u.find(a=>/(instagram|tiktok|snapchat)/.test((a.packageName+a.name).toLowerCase()));
          return `Heavy ${n?.name||'social'} use today. BeReal shows authentic, unfiltered moments — no algorithms, no pressure.`;
        },
        cta:'Try BeReal' },
      { pkg:'com.jour.app', appName:'Jour Journal',
        title:'Scroll Less, Reflect More 📓',
        body:(u,t,p,g)=>`Replace some scroll time with 5 minutes of journaling. Jour prompts you with smart questions that improve clarity and mood.`,
        cta:'Start Journaling' },
      { pkg:'com.getsomeheadspace.android', appName:'Headspace',
        title:'Social Media Stress? 🧡',
        body:(u,t,p,g)=>`High social media use is linked to anxiety. Headspace has a specific course for managing digital overwhelm.`,
        cta:'Find Your Calm' },
    ]
  },

  {
    id:'wellness_video_binge',
    detect:(u,t,p,g)=>u.some(a=>/(youtube|netflix|twitch|hulu|prime)/.test((a.packageName+a.name).toLowerCase())&&a.totalMinutes>80),
    recs:[
      { pkg:'com.audible.application', appName:'Audible',
        title:'Rest Your Eyes 👀',
        body:(u,t,p,g)=>{
          const a=u.find(x=>/(youtube|netflix)/.test((x.packageName+x.name).toLowerCase()));
          return `${fmtM(a?.totalMinutes||0)} of ${a?.name||'video'} today. Give your eyes a break — switch to an audiobook while you commute or cook.`;
        },
        cta:'Try Audible Free' },
      { pkg:'com.mubi.android', appName:'MUBI',
        title:'Quality Over Quantity 🎞️',
        body:(u,t,p,g)=>`Instead of autoplay rabbit holes, MUBI curates one great film a day — less time, better cinema.`,
        cta:'Watch Smarter' },
      { pkg:'com.spotify.music', appName:'Spotify',
        title:'Audio is Gentler 🎵',
        body:(u,t,p,g)=>`Heavy video use drains battery and attention. Switch to Spotify — music or podcasts while your eyes take a break.`,
        cta:'Open Spotify' },
    ]
  },

  {
    id:'wellness_night_owl',
    detect:(u,t,p,g)=>new Date().getHours()>=21&&t>60,
    recs:[
      { pkg:'com.calm.android', appName:'Calm',
        title:'Late Night? Wind Down 🌙',
        body:(u,t,p,g)=>`It's late and you've had ${fmtM(t)} of screen time. Calm's Sleep Stories and breathing exercises help signal to your brain it's time to rest.`,
        cta:'Wind Down with Calm' },
      { pkg:'com.getsomeheadspace.android', appName:'Headspace',
        title:'Blue Light Before Bed 💤',
        body:(u,t,p,g)=>`Late phone use disrupts melatonin. Try Headspace's 3-minute sleepcasts — they beat doomscrolling as a bedtime habit.`,
        cta:'Try Headspace Sleep' },
      { pkg:'cc.forestapp', appName:'Forest',
        title:'Phone-Free Bedtime 🌲',
        body:(u,t,p,g)=>`Plant a Forest tree now and put your phone down. You'll wake up with a grown tree and actually rested!`,
        cta:'Plant & Sleep' },
    ]
  },

  // ── ③ UTILITY & PERFORMANCE ─────────────────────────────────────────────────
  {
    id:'utility_photographer',
    detect:(u,t,p,g)=>u.some(a=>/(camera|vsco|lightroom|snapseed|instagram|picsart)/.test((a.packageName+a.name).toLowerCase())&&a.totalMinutes>45),
    recs:[
      { pkg:'com.adobe.lrmobile', appName:'Lightroom',
        title:'Level Up Your Photos 📷',
        body:(u,t,p,g)=>`You spend serious time on photos. Adobe Lightroom gives you pro-level editing that makes every shot look intentional.`,
        cta:'Get Lightroom Free' },
      { pkg:'com.vsco.cam', appName:'VSCO',
        title:'Find Your Visual Style 🎨',
        body:(u,t,p,g)=>`Spend less time filtering, more time creating. VSCO's curated presets give your photos a consistent, professional look.`,
        cta:'Try VSCO' },
      { pkg:'com.picsart.studio', appName:'PicsArt',
        title:'Create, Not Just Capture 🖼️',
        body:(u,t,p,g)=>`Take your visual content further with PicsArt — AI-powered editing, collages and creative tools in one place.`,
        cta:'Download PicsArt' },
    ]
  },

  {
    id:'utility_fitness',
    detect:(u,t,p,g)=>u.some(a=>/(strava|garmin|nike|adidas|myfitnesspal|fitbit|google.*fit)/.test((a.packageName+a.name).toLowerCase())&&a.totalMinutes>20),
    recs:[
      { pkg:'com.strava', appName:'Strava',
        title:'Active User Detected 🏃',
        body:(u,t,p,g)=>`You're tracking fitness — Strava connects your runs and rides to a global community that keeps you motivated.`,
        cta:'Join Strava' },
      { pkg:'com.nike.ntc', appName:'Nike Training Club',
        title:'Train Smarter 💪',
        body:(u,t,p,g)=>`Level up your fitness with Nike Training Club — free expert workouts from 15 minutes to full programs.`,
        cta:'Start Training Free' },
      { pkg:'com.getsomeheadspace.android', appName:'Headspace',
        title:'Mind + Body Wellness 🧘',
        body:(u,t,p,g)=>`Physical fitness is great — mental fitness matters too. Headspace has mindful movement sessions designed for active people.`,
        cta:'Add Mindfulness' },
    ]
  },

  // ── ④ LIFESTYLE & DISCOVERY ─────────────────────────────────────────────────
  {
    id:'lifestyle_learner',
    detect:(u,t,p,g)=>u.some(a=>/(duolingo|coursera|udemy|brilliant|khan|edx)/.test((a.packageName+a.name).toLowerCase())&&a.totalMinutes>20),
    recs:[
      { pkg:'com.duolingo', appName:'Duolingo',
        title:'You\'re a Learner 📚',
        body:(u,t,p,g)=>`You already invest time in learning apps. Duolingo turns language learning into a daily 5-minute habit that actually sticks.`,
        cta:'Learn a Language' },
      { pkg:'com.brilliant.android', appName:'Brilliant',
        title:'Go Deeper 🔭',
        body:(u,t,p,g)=>`Expand beyond your current courses. Brilliant makes maths, science and CS interactive — learning you can actually feel.`,
        cta:'Try Brilliant' },
      { pkg:'com.blinkist.android', appName:'Blinkist',
        title:'More Books, Less Time ⚡',
        body:(u,t,p,g)=>`Complement your learning with Blinkist — key ideas from 7,000+ nonfiction books in 15 minutes each.`,
        cta:'Get Blinkist' },
    ]
  },

  {
    id:'lifestyle_music_fan',
    detect:(u,t,p,g)=>u.some(a=>/(spotify|music|podcast|soundcloud|apple.*music|deezer)/.test((a.packageName+a.name).toLowerCase())&&a.totalMinutes>40),
    recs:[
      ...([countryApp('music','com.spotify.music','Spotify')].map(ca=>({
        pkg:ca.pkg, appName:ca.name,
        title:'Your Soundtrack Awaits 🎵',
        body:(u,t,p,g)=>`You clearly love audio. ${ca.name} blends music, podcasts and audiobooks into one experience — explore recommendations built around your taste.`,
        cta:`Open ${ca.name}`
      }))),
      { pkg:'com.pocket.casts', appName:'Pocket Casts',
        title:'Level Up Your Listening 🎙️',
        body:(u,t,p,g)=>`Turn commute time into learning time. Pocket Casts is the most powerful podcast player on Android.`,
        cta:'Get Pocket Casts' },
      { pkg:'com.shazam.android', appName:'Shazam',
        title:'Never Miss a Song 🎶',
        body:(u,t,p,g)=>`Capture every song you love automatically. Shazam identifies music around you and syncs to your streaming library.`,
        cta:'Add Shazam' },
    ]
  },
];

function detectPersona(goalMins){
  for(const rule of PERSONA_RULES){
    if(rule.detect(DAILY_USE, TODAY_MINS, PICKUPS, goalMins)) return rule;
  }
  // Default — fallback rule
  return PERSONA_RULES.find(r=>r.id==='wellness_over_goal') || PERSONA_RULES[0];
}

function renderNativeRecs(){
  _renderWellnessFallback();
}

function _renderWellnessFallback(){
  const slot = document.getElementById('wellness-ad-slot');
  if(!slot) return;
  if(!DAILY_USE.length && TODAY_MINS===0){ slot.innerHTML=''; slot.style.display='none'; return; }
  const goalMins = S.streakGoalMins || 240;
  const rule = detectPersona(goalMins);
  if(!rule||!rule.recs.length){ slot.innerHTML=''; slot.style.display='none'; return; }
  const recIdx = Math.floor(Date.now()/86400000) % rule.recs.length;
  const rec = rule.recs[recIdx];
  const bodyText = typeof rec.body==='function' ? rec.body(DAILY_USE,TODAY_MINS,PICKUPS,goalMins) : rec.body;
  const titleText = rec.title.replace('${p}',PICKUPS).replace('${g}h',fmtM(goalMins));
  slot.innerHTML = `<div style="background:var(--s1);border:2px solid var(--p);border-radius:16px;padding:14px 16px;margin-bottom:10px;position:relative;cursor:pointer" onclick="if(typeof nCall==='function')nCall('openPlayStore','${escAttr(rec.pkg)}')">
    <div style="display:flex;align-items:center;gap:11px;margin-bottom:8px">
      <div style="width:44px;height:44px;border-radius:12px;overflow:hidden;background:var(--s2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px">${appIco(rec.pkg,44,11)}</div>
      <div style="font-size:14px;font-weight:700;line-height:1.25;color:var(--t1)">${titleText}</div>
    </div>
    <div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.55;margin-bottom:12px">${bodyText}</div>
    <button style="display:inline-flex;align-items:center;gap:5px;padding:9px 18px;border-radius:999px;background:var(--t1);border:none;font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--bg);cursor:pointer">${rec.cta} →</button>
    <div style="position:absolute;bottom:10px;right:12px;font-family:var(--ff-m);font-size:9px;color:var(--t3);letter-spacing:.5px">Based on your usage</div>
  </div>`;
  slot.style.display = '';
}

function renderChart(mode){
  chartMode=mode;
  const area=document.getElementById('chart-area');
  if(mode==='week'){ renderWeeklyBars(area); }
  else{ renderHourlyBars(area); }
}

// 7 vivid day colors — Mon through Sun
const DAY_COLORS=['#6C63FF','#F04E7A','#F5A623','#12D48A','#05C8E8','#B06EFF','#FF6B6B'];

function renderWeeklyBars(container){
  // Use demo data when WEEKLY is empty (no permission or demo mode)
  let data = WEEKLY.length ? WEEKLY : (()=>{
    const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const todayIdx = (new Date().getDay()+6)%7; // 0=Mon
    return DOW.map((d,i)=>({
      day:d, minutes:30+Math.round(Math.random()*150+i*20), isToday:i===todayIdx
    }));
  })();
  if(!data.length) data = [{day:'Mon',minutes:60,isToday:true}];

  // ── Sort so today is always the rightmost bar ─────────────────────────────
  const DOW_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const todayEntry = data.find(d=>d.isToday);
  const todayDowName = todayEntry ? (todayEntry.day||'').slice(0,3) : DOW_ORDER[(new Date().getDay()+6)%7];
  const todayDowIdx  = DOW_ORDER.indexOf(todayDowName);
  if(todayDowIdx >= 0){
    // Rotate so today is last
    const rotated = [];
    for(let i=1; i<=7; i++){
      const name = DOW_ORDER[(todayDowIdx+i)%7];
      const match = data.find(d=>(d.day||'').slice(0,3)===name);
      if(match) rotated.push(match);
    }
    if(rotated.length === data.length) data = rotated;
  }

  // ── Today: use whichever value is higher (live vs cached) ────────────────
  data = data.map(d=>{
    if(d.isToday && typeof TODAY_MINS!=='undefined' && TODAY_MINS > (d.minutes||0))
      return {...d, minutes: TODAY_MINS};
    return d;
  });

  const BAR_H = 110;
  // Scale purely to actual usage — don't inflate with goalMins
  const max = Math.max(...data.map(d=>d.minutes||0), 1);
  const dayIdx = {Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};

  // Build HTML using absolute pixel heights — all bars start from same bottom line
  const cols = data.map((d,i)=>{
    const col = DAY_COLORS[dayIdx[d.day] !== undefined ? dayIdx[d.day] : i%7];
    const barH = Math.max(14, Math.round((d.minutes/max)*BAR_H));
    const labelH = d.minutes>=60 ? Math.floor(d.minutes/60)+'h'+(d.minutes%60>0?d.minutes%60+'m':'') : d.minutes>0 ? d.minutes+'m' : '';
    const isToday = !!d.isToday;
    const barColor = isToday ? col : col+'99';
    const borderTop = isToday ? `border-top:2px solid ${col}` : '';
    // Time label: inside bar if bar >= 28px, rotated text
    const timeEl = labelH ? (barH >= 28
      ? `<span style="font-family:var(--ff-m);font-size:8px;font-weight:700;color:#fff;opacity:.95;writing-mode:horizontal-tb;line-height:1;padding:0 1px;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.4)">${labelH}</span>`
      : '') : '';
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">
      <div style="height:${BAR_H}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:100%">
        <div style="width:88%;height:${barH}px;background:${barColor};border-radius:5px 5px 0 0;${borderTop};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:height .5s cubic-bezier(.34,1.56,.64,1)">
          ${timeEl}
        </div>
      </div>
      <div style="font-family:var(--ff-m);font-size:9px;color:${isToday?col:'var(--t3)'};font-weight:${isToday?700:400};margin-top:4px;text-align:center">${d.day.slice?d.day.slice(0,3):d.day}</div>
    </div>`;
  }).join('');

  container.innerHTML = `<div style="display:flex;gap:2px;align-items:flex-end;width:100%;padding:0 4px;box-sizing:border-box">${cols}</div>`;
}

function renderHourlyBars(container){
  let data=[];
  if(IS_NATIVE&&N.hasUsagePermission()){ try{ data=JSON.parse(N.getHourlyBreakdownToday()||'[]'); }catch(_){} }
  if(!data.length){
    data=Array.from({length:24},(_,h)=>({hour:h,minutes:h>=8&&h<=22?Math.max(0,Math.floor(Math.sin((h-8)/14*Math.PI)*40+Math.random()*15)):0}));
  }
  // Show ALL 24 hours — 12am–5am were previously hidden
  const active = data.length===24 ? data : Array.from({length:24},(_,h)=>data.find(d=>d.hour===h)||{hour:h,minutes:0});
  const max=Math.max(...active.map(d=>d.minutes),1);
  const peakEntry=active.reduce((a,b)=>b.minutes>a.minutes?b:a,{hour:12,minutes:0});

  function barColor(h){
    if(h>=0&&h<6)  return '#6C63FF';   // 12am-5am — indigo
    if(h>=6&&h<12) return '#F7A623';   // morning — amber
    if(h>=12&&h<17) return '#5DD6F8';  // afternoon — cyan
    if(h>=17&&h<21) return '#12D48A';  // evening — green
    return '#A89CFF';                   // night — purple
  }
  function timeLabel(h){
    const labels={0:'12am',3:'3am',6:'6am',9:'9am',12:'12pm',15:'3pm',18:'6pm',21:'9pm'};
    return labels[h]||'';
  }
  function hrStr(h){ return h===0?'12am':h<12?h+'am':h===12?'12pm':(h-12)+'pm'; }

  container.innerHTML=`
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      ${[['#6C63FF','12am–5am'],['#F7A623','6am–11am'],['#5DD6F8','12pm–4pm'],['#12D48A','5pm–8pm'],['#A89CFF','9pm+']].map(([c,l])=>`<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:9px;color:var(--t3)"><div style="width:8px;height:8px;border-radius:2px;background:${c}"></div>${l}</div>`).join('')}
    </div>
    <div class="hour-chart"><div class="hc-bars">${active.map(d=>{
      const barH=Math.max(d.minutes>0?3:1,Math.round((d.minutes/max)*68));
      const isPeak=d.hour===peakEntry.hour&&d.minutes>0;
      const lbl=timeLabel(d.hour);
      return `<div class="hc-bar-wrap" title="${d.minutes>0?d.minutes+'m at '+hrStr(d.hour):'No usage at '+hrStr(d.hour)}">
        <div class="hc-bar-area">
          <div class="hc-bar" style="height:${barH}px;background:${d.minutes>0?barColor(d.hour):'rgba(255,255,255,.05)'}">
            ${isPeak?`<div style="position:absolute;bottom:calc(100%+2px);left:50%;transform:translateX(-50%);background:var(--p);color:#fff;font-family:var(--ff-m);font-size:8px;padding:2px 5px;border-radius:4px;white-space:nowrap;z-index:5">${d.minutes}m ▲</div>`:''}
          </div>
        </div>
        <div class="hc-lbl" style="${lbl?'color:var(--t2);font-weight:600;font-size:9px':'opacity:.25'}">${lbl||'·'}</div>
      </div>`;
    }).join('')}</div></div>
    <div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);margin-top:6px;text-align:center">
      ${peakEntry.minutes>0?`📍 Peak usage at <strong style="color:var(--t2)">${hrStr(peakEntry.hour)}</strong> — ${fmtM(peakEntry.minutes)}`:'No usage recorded yet today'}
    </div>`;
}

function setChart(mode,btn){
  document.querySelectorAll('.ctab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderChart(mode);
}

/* ── Home tab inline week chart ─────────────────────── */
let _homeWeekOpen = false;
function toggleHomeWeekChart(){
  const panel = document.getElementById('home-week-panel');
  const btn   = document.getElementById('home-week-btn');
  if(!panel) return;
  _homeWeekOpen = !_homeWeekOpen;
  if(_homeWeekOpen){
    panel.style.display = 'block';
    // Refresh weekly data if available
    if(IS_NATIVE && N.hasUsagePermission()){
      try{ WEEKLY = JSON.parse(N.getCachedWeeklyData() || '[]'); }catch(_){}
    }
    renderWeeklyBars(document.getElementById('home-week-chart'));
    if(btn){ btn.style.background='rgba(108,99,255,.2)'; btn.style.color='var(--p2)'; }
  } else {
    panel.style.display = 'none';
    if(btn){ btn.style.background=''; btn.style.color=''; }
  }
}

function renderTopApps(){
  const list=document.getElementById('top-apps-list');
  if(!DAILY_USE.length){
    // Distinguish: permission missing vs permission granted but no data yet
    const hasPermission = IS_NATIVE && N.hasUsagePermission && N.hasUsagePermission();
    list.innerHTML=`<div style="padding:20px;font-family:var(--ff-m);font-size:11px;color:var(--t3);text-align:center">${
      hasPermission
        ? '📭 No app usage recorded yet today'
        : 'Grant Usage Access to see real screen time.'
    }</div>`; return; }
  const max=Math.max(...DAILY_USE.map(a=>a.totalMinutes),1);
  const colors=['var(--a)','var(--r)','var(--p)','var(--c)','var(--g)'];
  const limits=S.limits;
  list.innerHTML=DAILY_USE.slice(0,6).map((a,i)=>`
    <div class="ta-row">
      <div class="ta-ico">${appIco(a.packageName,36,10)}</div>
      <div class="ta-info">
        <div class="ta-name">${escHtml(a.name)}</div>
        <div class="ta-bar"><div class="ta-bar-fill" style="width:${(a.totalMinutes/max*100).toFixed(0)}%;background:${colors[i]||'var(--p)'}"></div></div>
      </div>
      <div class="ta-time">${fmtM(a.totalMinutes)}</div>
      <button class="limit-btn${limits[a.packageName]?' set':''}" onclick="openTimerForApp('${a.packageName}','${escHtml(a.name)}',${a.totalMinutes})" id="lb-${a.packageName.replace(/\./g,'_')}">
        ${limits[a.packageName]?fmtM(limits[a.packageName])+'✓':'Limit'}
      </button>
    </div>`).join('');
}

/* ── All Apps Panel ─────────────────────────────────── */
let _aaSort = 'today';
let _weeklyAppCache = null;
let _weeklyFetching = false;

function openAllApps(){
  // Open with sort matching the current wellness view tab
  const defaultSort = _wellnessView === 'month' ? 'month'
                    : _wellnessView === 'week'  ? 'week'
                    : 'today';
  _aaSort = defaultSort;
  const searchEl = document.getElementById('all-apps-search');
  if(searchEl) searchEl.value = '';
  setAllAppsSort(defaultSort, true); // true = skip re-render, openPanel triggers it
  openPanel('all-apps-panel');
  // Pre-fetch weekly data in background while user browses
  _prefetchWeeklyApps();
}

function setAllAppsSort(sort, skipRender){
  // Phase 3: Week and Month sort are Pro-only features
  if((sort === 'week' || sort === 'month') && !ProTier.isPro){
    ProTier.triggerUpsell('monthly'); return;
  }
  _aaSort = sort;
  ['today','week','month','az'].forEach(s => {
    const btn = document.getElementById('aa-sort-'+s);
    if(!btn) return;
    btn.style.background = s===sort ? 'var(--p)' : 'transparent';
    btn.style.color      = s===sort ? '#fff'     : 'var(--t2)';
    // Show Pro badge on locked sort buttons for free users
    const isLocked = (s === 'week' || s === 'month') && !ProTier.isPro;
    const existingBadge = btn.querySelector('.pro-sort-badge');
    if(isLocked && !existingBadge){
      const badge = document.createElement('span');
      badge.className = 'pro-sort-badge';
      badge.style.cssText = 'margin-left:4px;vertical-align:middle';
      badge.innerHTML = typeof proBadge === 'function' ? proBadge(true) : '';
      btn.appendChild(badge);
    } else if(!isLocked && existingBadge){
      existingBadge.remove();
    }
  });
  if(!skipRender) renderAllAppsPanel();
}

function _prefetchWeeklyApps(){
  if(_weeklyFetching || _weeklyAppCache) return;
  // Use the shared cached _getWeeklyApps() from app-wellness-views.js (5-min TTL)
  _weeklyFetching = true;
  setTimeout(()=>{
    try{
      const wa = typeof _getWeeklyApps==='function' ? _getWeeklyApps() : [];
      _weeklyAppCache = {};
      wa.forEach(a => { _weeklyAppCache[a.packageName] = a.weeklyMinutes||0; });
    }catch(_){ _weeklyAppCache = {}; }
    _weeklyFetching = false;
  }, 100); // faster since _getWeeklyApps uses its own cache
}

function renderAllAppsPanel(){
  const list    = document.getElementById('all-apps-list');
  const countEl = document.getElementById('all-apps-count');
  const sort    = _aaSort || 'today';
  const isWeek  = sort === 'week';
  const isMonth = sort === 'month';
  const query   = ((document.getElementById('all-apps-search')||{}).value||'').toLowerCase().trim();

  const usageToday = {};
  DAILY_USE.forEach(u => { usageToday[u.packageName] = u.totalMinutes||0; });

  // Build month usage map from MONTHLY_APPS — same source as Month tab "Top Apps This Month".
  // This ensures Sort by Month and the Month tab always rank apps identically.
  const usageMonth = {};
  const hasMonthData = typeof MONTHLY_APPS !== 'undefined' && MONTHLY_APPS.length > 0;
  if (hasMonthData) {
    MONTHLY_APPS.forEach(a => { usageMonth[a.packageName] = a.monthlyMinutes || 0; });
  }

  if (isWeek && !_weeklyAppCache) {
    if(_weeklyFetching){
      list.innerHTML = `<div style="padding:40px 20px;text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3)">Loading data…</div>`;
      if(countEl) countEl.textContent = '';
      setTimeout(()=>{ const p=document.getElementById('all-apps-panel'); if(p&&p.classList.contains('open')) renderAllAppsPanel(); }, 400);
      return;
    }
    _prefetchWeeklyApps();
    list.innerHTML = `<div style="padding:40px 20px;text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3)">Loading data…</div>`;
    if(countEl) countEl.textContent = '';
    setTimeout(()=>{ const p=document.getElementById('all-apps-panel'); if(p&&p.classList.contains('open')) renderAllAppsPanel(); }, 600);
    return;
  }
  if (isMonth && !hasMonthData && !_weeklyAppCache) {
    if(_weeklyFetching){
      list.innerHTML = `<div style="padding:40px 20px;text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3)">Loading data…</div>`;
      if(countEl) countEl.textContent = '';
      setTimeout(()=>{ const p=document.getElementById('all-apps-panel'); if(p&&p.classList.contains('open')) renderAllAppsPanel(); }, 400);
      return;
    }
    _prefetchWeeklyApps();
    list.innerHTML = `<div style="padding:40px 20px;text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3)">Loading data…</div>`;
    if(countEl) countEl.textContent = '';
    setTimeout(()=>{ const p=document.getElementById('all-apps-panel'); if(p&&p.classList.contains('open')) renderAllAppsPanel(); }, 600);
    return;
  }
  const usageWeek = _weeklyAppCache || {};

  const appCatMap = {};
  Object.entries(CATS_MAP).forEach(([cat,apps]) => apps.forEach(a => { appCatMap[a.packageName]=cat; }));

  // monthMins: real MONTHLY_APPS data wins; fall back to weekly estimate only if not loaded yet
  const getMonthMins = pkg =>
    hasMonthData ? (usageMonth[pkg] || 0)
                 : Math.round((usageWeek[pkg]||0) * 4.3);

  let all = getAllAppsForSearch().map(a => ({
    packageName: a.packageName,
    name:        a.name || a.packageName.split('.').pop(),
    todayMins:   usageToday[a.packageName] || 0,
    weekMins:    usageWeek[a.packageName]  || 0,
    monthMins:   getMonthMins(a.packageName),
    category:    appCatMap[a.packageName]  || a.category || ''
  }));
  const seen = new Set(all.map(a => a.packageName));
  DAILY_USE.forEach(u => {
    if(!seen.has(u.packageName)) all.push({
      packageName: u.packageName, name: u.name,
      todayMins:   u.totalMinutes||0,
      weekMins:    usageWeek[u.packageName]||0,
      monthMins:   getMonthMins(u.packageName),
      category:    appCatMap[u.packageName]||''
    });
  });
  // For week sort: surface apps that have weekly data but aren't in CATS_MAP yet
  if (isWeek) {
    const seen2 = new Set(all.map(a=>a.packageName));
    Object.entries(usageWeek).forEach(([pkg,mins])=>{
      if(!seen2.has(pkg)&&mins>0) all.push({
        packageName:pkg, name:pkg.split('.').pop(),
        todayMins:0, weekMins:mins,
        monthMins:getMonthMins(pkg),
        category:appCatMap[pkg]||''
      });
    });
  }
  // For month sort: surface apps that have monthly data but aren't in CATS_MAP yet
  if (isMonth && hasMonthData) {
    const seen3 = new Set(all.map(a=>a.packageName));
    MONTHLY_APPS.forEach(a => {
      if(!seen3.has(a.packageName) && a.monthlyMinutes > 0) all.push({
        packageName: a.packageName, name: a.name,
        todayMins:0, weekMins:usageWeek[a.packageName]||0,
        monthMins:a.monthlyMinutes,
        category:appCatMap[a.packageName]||''
      });
    });
  }

  if(query) all = all.filter(a => a.name.toLowerCase().includes(query)||(a.category||'').toLowerCase().includes(query));

  if(sort==='today') all.sort((a,b)=>b.todayMins-a.todayMins);
  else if(sort==='week') all.sort((a,b)=>b.weekMins-a.weekMins);
  else if(sort==='month') all.sort((a,b)=>b.monthMins-a.monthMins);
  else all.sort((a,b)=>a.name.localeCompare(b.name));

  if(countEl) countEl.textContent = all.length+' apps';

  if(!all.length){
    list.innerHTML=`<div style="padding:40px 20px;text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3)">${query?`No apps match "${escHtml(query)}"`:'No apps found'}</div>`;
    return;
  }

  // Bar width: relative to top app; percentage: relative to total
  const maxMins    = isMonth ? Math.max(...all.map(a=>a.monthMins),1)
                   : isWeek  ? Math.max(...all.map(a=>a.weekMins),1)
                   :           Math.max(...all.map(a=>a.todayMins),1);
  const totalForPct = isMonth
    ? Math.max(all.reduce((s,a)=>s+a.monthMins,0), 1)
    : isWeek
    ? Math.max(all.reduce((s,a)=>s+a.weekMins,0), 1)
    : Math.max(TODAY_MINS || all.reduce((s,a)=>s+a.todayMins,0), 1);
  const colors  = ['var(--a)','var(--r)','var(--p)','var(--c)','var(--g)'];
  const limits  = S.limits||{};

  list.innerHTML = all.map((a,i)=>{
    const mins    = isMonth ? a.monthMins : isWeek ? a.weekMins : a.todayMins;
    const barPct  = maxMins>0 ? Math.round((mins/maxMins)*100) : 0;
    const pct     = totalForPct>0 ? Math.round((mins/totalForPct)*100) : 0;
    const barCol  = colors[i%colors.length];
    const cat     = a.category||'';
    const hasLim  = !!limits[a.packageName];
    const suffix  = isMonth ? (hasMonthData ? ' /mo' : ' ~est') : isWeek ? ' /wk' : '';
    const timeLabel = mins>0
      ? `${fmtM(mins)}<span style="font-size:9px;opacity:.6">${suffix}</span> · ${pct}%`
      : `<span style="color:var(--t3)">–</span>`;
    return `<div style="display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border)">
      <div style="width:38px;height:38px;border-radius:11px;overflow:hidden;background:var(--s2);display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0">${appIco(a.packageName,38,11)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</div>
        <div style="margin-top:2px">${cat
          ?`<span style="font-family:var(--ff-m);font-size:9px;background:var(--s2);border:1px solid var(--border2);border-radius:5px;padding:1px 5px;color:var(--t3)">${CAT_ICONS[cat]||''} ${cat}</span>`
          :`<span style="font-family:var(--ff-m);font-size:9px;color:var(--t3);opacity:.45">Uncategorised</span>`}
        </div>
        ${mins>0?`<div style="margin-top:5px;height:3px;background:var(--s2);border-radius:2px;overflow:hidden"><div style="height:100%;width:${barPct}%;background:${barCol};border-radius:2px"></div></div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0;min-width:62px">
        <div style="font-family:var(--ff-m);font-size:11px;color:var(--t2)">${timeLabel}</div>
        <button type="button" onclick="openTimerForApp('${a.packageName}','${a.name.replace(/'/g,"\\'")}',${a.todayMins})"
          style="margin-top:4px;padding:3px 8px;border-radius:7px;border:1px solid ${hasLim?'rgba(247,166,35,.3)':'var(--border2)'};background:${hasLim?'rgba(247,166,35,.1)':'var(--s2)'};font-family:var(--ff-m);font-size:9px;color:${hasLim?'var(--a)':'var(--t3)'};cursor:pointer">
          ${hasLim?fmtM(limits[a.packageName])+'✓':'Limit'}
        </button>
      </div>
    </div>`;
  }).join('');
}

function renderSmartTips(){
  const el=document.getElementById('smart-tips');
  let tips=[];
  if(IS_NATIVE&&N.hasUsagePermission()){ tips=JSON.parse(N.getSmartTips()||'[]'); }
  else {
    if(DAILY_USE[0]) tips.push({icon:'💡',title:'Top App',body:`${DAILY_USE[0].name} is your most-used app at ${fmtM(DAILY_USE[0].totalMinutes)} today.`,type:'info'});
    if(PICKUPS>40) tips.push({icon:'📲',title:'Frequent Pickups',body:`You've unlocked your phone ${PICKUPS} times today. Try batching phone use every 30 minutes.`,type:'warn'});
    const _goal=S.streakGoalMins||240;
    if(TODAY_MINS>_goal) tips.push({icon:'⏰',title:'Goal Exceeded',body:`You've used your phone for ${fmtM(TODAY_MINS)} today — ${fmtM(TODAY_MINS-_goal)} over your ${fmtM(_goal)} goal. Time for a break!`,type:'warn'});
    else if(TODAY_MINS>_goal*.75) tips.push({icon:'📊',title:'Approaching Goal',body:`${fmtM(TODAY_MINS)} used today. You have ${fmtM(_goal-TODAY_MINS)} left before hitting your ${fmtM(_goal)} goal.`,type:'info'});
    if(!tips.length) tips.push({icon:'✅',title:'Looking Good!',body:'Your screen time looks healthy today. Keep it up!',type:'success'});
  }
  el.innerHTML=tips.map(t=>`
    <div class="tip-card">
      <div class="tip-ico">${t.icon}</div>
      <div>
        <div style="font-size:12px;font-weight:700;margin-bottom:3px;color:var(--t1)">${t.title||''}</div>
        <div class="tip-txt">${t.body||t.text||''}</div>
      </div>
    </div>`).join('');
}

/* ═══ SOCIAL SHARING — delegated to app-share.js ══════ */
// renderShareCard, shareStats, shareCard, _fmtMShare and referFriend all live
// in app-share.js (loaded before this file). Nothing to define here.
// Kept as a named alias so any HTML onclick="shareStats(...)" attributes
// that haven't been migrated to shareCard() yet continue to work.
async function shareStats(type) { return shareCard(type); }

// Inline formatter still used by the weekly digest section below.
function _fmtMShare(m) {
  if (!m || m <= 0) return '0m';
  const h = Math.floor(m / 60), mn = m % 60;
  if (h > 0 && mn > 0) return `${h}h ${mn}m`;
  if (h > 0) return `${h}h`;
  return `${mn}m`;
}

/* ═══ WEEKLY DIGEST ════════════════════════════════════ */
function switchDigestChart(mode){
  const area = document.getElementById('dg-chart-area');
  if(!area) return;
  const hBtn = document.getElementById('dg-tab-hourly');
  const wBtn = document.getElementById('dg-tab-week');
  if(hBtn && wBtn){
    if(mode==='hourly'){
      hBtn.style.background='var(--p)'; hBtn.style.color='#fff';
      wBtn.style.background='transparent'; wBtn.style.color='var(--t2)';
    } else {
      wBtn.style.background='var(--p)'; wBtn.style.color='#fff';
      hBtn.style.background='transparent'; hBtn.style.color='var(--t2)';
    }
  }
  if(mode==='hourly') renderHourlyBars(area);
  else renderWeeklyBars(area);
}

function openDigest(initialMode){
  // Use cached weekly data for instant render — preScan keeps it fresh every 30s.
  // Kick off an async refresh in the background so next open gets updated data.
  if(IS_NATIVE&&N.hasUsagePermission()){
    try{ WEEKLY=JSON.parse(N.getCachedWeeklyData()||'[]'); }catch(_){}
    // Async refresh: run after dialog is visible so it doesn't block open animation
    setTimeout(()=>{
      try{
        const fresh=JSON.parse(N.getCachedWeeklyData()||'[]');
        if(fresh.length){ WEEKLY=fresh; }
      }catch(_){}
    }, 400);
  }
  const validDays=WEEKLY.filter(d=>d.minutes>0);
  const total=WEEKLY.reduce((s,d)=>s+d.minutes,0);
  const avg=validDays.length>0?Math.round(total/validDays.length):0;
  const todayMins=WEEKLY.find(d=>d.isToday)?.minutes||TODAY_MINS;

  document.getElementById('dg-total').textContent=fmtM(total)||'–';
  document.getElementById('dg-daily').textContent=avg>0?fmtM(avg):'–';
  document.getElementById('dg-pickups').textContent=PICKUPS>0?PICKUPS:'–';
  document.getElementById('dg-top').textContent=DAILY_USE[0]?.name||'–';
  document.getElementById('dg-first').textContent=(IS_NATIVE&&N.hasUsagePermission())?N.getFirstPickupTime():'–';

  // Trend: today vs weekly average
  const tEl=document.getElementById('dg-trend');
  if(avg>0){
    const diff=todayMins-avg;
    const pct=Math.abs(Math.round(diff/avg*100));
    if(diff>0){ tEl.textContent=`↑ ${pct}% above your daily average`; tEl.style.background='rgba(240,78,122,.12)'; tEl.style.color='var(--r)'; tEl.style.borderColor='rgba(240,78,122,.25)'; }
    else if(diff<0){ tEl.textContent=`↓ ${pct}% below your daily average`; tEl.style.background='rgba(18,212,138,.12)'; tEl.style.color='var(--g)'; tEl.style.borderColor='rgba(18,212,138,.25)'; }
    else { tEl.textContent='On par with your daily average'; tEl.style.background='rgba(108,99,255,.1)'; tEl.style.color='var(--p2)'; tEl.style.borderColor='rgba(108,99,255,.25)'; }
  } else { tEl.textContent='Not enough data yet'; tEl.style.background='rgba(108,99,255,.08)'; tEl.style.color='var(--t3)'; tEl.style.borderColor='rgba(108,99,255,.15)'; }

  // Render charts via switchDigestChart — default to 'week' if called from Week button
  switchDigestChart(initialMode || 'week');

  // Dynamic tips based on real data
  const tips=[];
  const peakDay=WEEKLY.length?WEEKLY.reduce((a,b)=>b.minutes>a.minutes?b:a,{day:'',minutes:0}):null;
  const bestDay=validDays.length?validDays.reduce((a,b)=>b.minutes<a.minutes?b:a,validDays[0]):null;
  if(DAILY_USE[0]&&DAILY_USE[0].totalMinutes>30) tips.push(`📱 ${DAILY_USE[0].name} is your most-used app today at ${fmtM(DAILY_USE[0].totalMinutes)}. ${S.limits[DAILY_USE[0].packageName]?'Timer set ✓':'Consider setting a daily limit.'}`);
  if(peakDay?.day&&peakDay.minutes>0) tips.push(`📊 ${peakDay.day} was your busiest screen-time day this week at ${fmtM(peakDay.minutes)}.`);
  if(bestDay?.day&&validDays.length>1) tips.push(`✅ ${bestDay.day} was your best day at just ${fmtM(bestDay.minutes)} — ${avg>0?Math.round((avg-bestDay.minutes)/avg*100)+'% below average':''}.`);
  if(total>0&&avg>0) tips.push(`📈 ${avg<180?'Great discipline':'Room to improve'}: your 7-day average is ${fmtM(avg)}/day. Goal: stay under ${fmtM(240)}.`);
  if(!tips.length) tips.push('Grant Usage Access to unlock weekly insights.');
  document.getElementById('dg-tips').innerHTML=tips.map((t,i)=>`<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid ${i===tips.length-1?'transparent':'var(--border)'}"><div style="width:22px;height:22px;border-radius:7px;flex-shrink:0;background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.3);display:flex;align-items:center;justify-content:center;font-family:var(--ff-m);font-size:10px;color:var(--p2);margin-top:2px">${i+1}</div><div style="font-size:13px;color:var(--t2);line-height:1.6">${t}</div></div>`).join('');

  document.getElementById('digest').classList.add('open');
}