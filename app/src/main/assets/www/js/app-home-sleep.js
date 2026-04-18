/* ═══ app-home-sleep.js — Sleep card + Timer alert ════════════════════════
 * Phase 4 extraction from app-home.js.
 * Note: renderSleepCard and renderTimerAlert were commented out in v1.2.0;
 * they are preserved here as the canonical home for these features.
 * Depends on: app-home.js globals (S, IS_NATIVE, N, fmtM, activateTab,
 *             openPanel, _fmt12)
 * ════════════════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════
function renderSleepCard() {
  const el = document.getElementById('home-sleep-card');
  if (!el) return;

  const bedEnabled = !!(S.settings && S.settings.bedtime);
  if (!bedEnabled) { el.style.display = 'none'; return; }

  let bedH = 22, wakeH = 7;
  try {
    if (IS_NATIVE) {
      const cfg = JSON.parse(N.getBedtimeSettings() || '{}');
      bedH  = (cfg.bedHour  !== undefined ? cfg.bedHour  : 22) + (cfg.bedMinute  || 0) / 60;
      wakeH = (cfg.wakeHour !== undefined ? cfg.wakeHour : 7)  + (cfg.wakeMinute || 0) / 60;
    }
  } catch(_){}

  const h              = new Date().getHours();
  const inMorning      = h < 11;                          // show last-night summary until 11am
  const showAfter      = (bedH - 2 + 24) % 24;           // 2h before bedtime start
  // Evening window: bedtime is upcoming. Handle overnight: e.g. bedH=22, showAfter=20
  const inEvening      = bedH >= 12
    ? (h >= showAfter && h < bedH)                        // same-day window (e.g. 20–22)
    : (h >= showAfter || h < bedH);                       // overnight wrap (e.g. 20–00)

  if (!inMorning && !inEvening) { el.style.display = 'none'; return; }

  let bedStreak = 0, lastNight = null;
  if (IS_NATIVE) {
    try { bedStreak = (JSON.parse(N.getBedtimeStreak() || '{}') || {}).streak || 0; } catch(_){}
    try {
      if (typeof N.getBedtimeLastNightStats === 'function')
        lastNight = JSON.parse(N.getBedtimeLastNightStats() || '{}');
    } catch(_){}
  }

  let title, stat;
  if (inEvening && !inMorning) {
    // Upcoming bedtime reminder
    const bedStr = typeof _fmt12 === 'function' ? _fmt12(bedH) : `${bedH}:00`;
    title = `Bedtime at ${bedStr}`;
    stat  = bedStreak > 0 ? `${bedStreak}-night streak · wind down soon` : 'Wind down soon';
  } else {
    // Last-night summary
    if (lastNight && lastNight.hasData) {
      title = lastNight.bedtimeKept ? 'Bedtime kept ✓' : 'Bedtime missed';
      const parts = [];
      if (lastNight.appAttemptsTotal > 0)
        parts.push(`${lastNight.appAttemptsTotal} app attempt${lastNight.appAttemptsTotal > 1 ? 's' : ''}`);
      else if (lastNight.bedtimeKept)
        parts.push('0 app attempts');
      if (lastNight.snoozeCount > 0)
        parts.push(`${lastNight.snoozeCount} snooze${lastNight.snoozeCount > 1 ? 's' : ''}`);
      stat = parts.length ? parts.join(' · ') : 'Clean night';
    } else {
      title = 'Last night';
      stat  = bedStreak > 0 ? `${bedStreak}-night streak` : 'Tap to set a bedtime goal';
    }
  }

  el.style.display = '';
  el.innerHTML = `
    <div onclick="activateTab('focus')"
         style="background:var(--s2);border:1px solid rgba(80,100,255,.2);
                border-radius:16px;padding:11px 13px;
                display:flex;align-items:center;gap:10px;cursor:pointer">
      <div style="width:28px;height:28px;border-radius:8px;background:rgba(80,100,255,.12);
                  display:flex;align-items:center;justify-content:center;
                  flex-shrink:0;font-size:14px">🌙</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--t1)">${title}</div>
        <div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);
                    margin-top:1px;line-height:1.4">${stat}</div>
      </div>
      ${bedStreak > 0
        ? `<div style="font-family:var(--ff-m);font-size:10px;font-weight:600;
                       color:var(--pu);background:rgba(80,100,255,.12);
                       border-radius:99px;padding:3px 8px;flex-shrink:0">🔥 ${bedStreak}</div>`
        : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════
function renderTimerAlert() {
  const el = document.getElementById('home-timer-alert');
  if (!el) return;

  const limits = S.limits || {};
  const pkgs   = Object.keys(limits);
  if (!pkgs.length) { el.style.display = 'none'; return; }

  const usageMap = {};
  if (typeof DAILY_USE !== 'undefined')
    DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes || 0; });

  // Collect apps at ≥80% of their limit, sorted worst-first
  const alerts = pkgs.map(pkg => {
    const used = usageMap[pkg] || 0, limit = limits[pkg];
    return { pkg, used, limit, pct: limit > 0 ? used / limit : 0 };
  }).filter(a => a.pct >= 0.8).sort((a,b) => b.pct - a.pct);

  if (!alerts.length) { el.style.display = 'none'; return; }

  const w = alerts[0];
  const isOver = w.pct >= 1;

  // Resolve display name from DAILY_USE, fall back to package tail
  let appName = w.pkg.split('.').pop();
  if (typeof DAILY_USE !== 'undefined') {
    const found = DAILY_USE.find(u => u.packageName === w.pkg);
    if (found && found.name) appName = found.name;
  }

  const timeText = isOver
    ? `+${fmtM(w.used - w.limit)} over`
    : `${fmtM(Math.max(0, w.limit - w.used))} left`;
  const alertText = isOver
    ? `${appName} has exceeded daily limit`
    : `${appName} approaching daily limit`;
  const extra = alerts.length > 1 ? ` +${alerts.length - 1} more` : '';

  const dot    = isOver ? '#ff4444' : '#ff9944';
  const txt    = isOver ? 'var(--r)' : 'var(--a)';
  const bg     = isOver ? 'rgba(255,50,50,.07)'   : 'rgba(255,140,50,.07)';
  const border = isOver ? 'rgba(255,50,50,.22)'   : 'rgba(255,140,50,.22)';

  el.style.display = '';
  el.innerHTML = `
    <div onclick="_switchFocusSubTab('limits');activateTab('focus')"
         style="background:${bg};border:1px solid ${border};border-radius:14px;
                padding:9px 13px;display:flex;align-items:center;gap:9px;cursor:pointer">
      <div style="width:6px;height:6px;background:${dot};border-radius:50%;flex-shrink:0"></div>
      <div style="flex:1;font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.4">
        ${alertText}${extra ? `<span style="color:var(--t3);margin-left:4px">${extra}</span>` : ''}
      </div>
      <div style="font-family:var(--ff-m);font-size:12px;font-weight:700;
                  color:${txt};flex-shrink:0">${timeText}</div>
    </div>`;
}
