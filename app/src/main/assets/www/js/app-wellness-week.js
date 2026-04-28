/* ═══ app-wellness-week.js — Week view: bars, top apps, insights ═══════════
 * Phase 4 extraction from app-wellness-views.js.
 * Depends on: app-wellness-views.js shared state (_weekChartMode, WEEKLY,
 *             _getWeeklyApps, _buildCatMinsFromWeekly),
 *             app-wellness.js (renderWeeklyBars, fmtM, escHtml, appIco,
 *             DAILY_USE, TODAY_MINS, S, shareCard, CATS_MAP)
 * ════════════════════════════════════════════════════════════════════════════ */

/* ── Phase 5: Share button rendered below weekly insights ───────────────── */
function _renderWeekShareButton() {
  // Reuse or create the share row so re-renders don't duplicate it
  let row = document.getElementById('ww-share-row');
  if (!row) {
    const insights = document.getElementById('ww-insights');
    if (!insights) return;
    row = document.createElement('div');
    row.id = 'ww-share-row';
    row.style.cssText = 'display:flex;justify-content:center;padding:12px 16px 4px';
    insights.insertAdjacentElement('afterend', row);
  }
  row.innerHTML = `
    <button type="button" onclick="shareCard('weekly')"
      style="display:inline-flex;align-items:center;gap:7px;padding:10px 22px;border-radius:999px;
             border:1px solid rgba(108,99,255,.35);background:rgba(108,99,255,.1);
             font-family:var(--ff-m);font-size:12px;font-weight:700;color:var(--p2);cursor:pointer">
      📤 Share your week
    </button>`;
}

/* ═══ WEEK VIEW ═══════════════════════════════════════════════════════════ */
function renderWeekView() {
  const total     = WEEKLY.reduce((s,d) => s + (d.minutes||0), 0);
  const validDays = WEEKLY.filter(d => d.minutes > 0);
  const avg       = validDays.length > 0 ? Math.round(total / validDays.length) : 0;

  const goalMins  = S.streakGoalMins || 240;
  const daysUnder = WEEKLY.filter(d=>d.minutes>0&&d.minutes<=goalMins).length;
  const tracked   = validDays.length;
  const wwTotal  = document.getElementById('ww-total');
  const wwAvg    = document.getElementById('ww-avg');
  const wwStreak = document.getElementById('ww-streak');
  if(wwTotal)  wwTotal.textContent  = fmtM(total) || '–';
  if(wwAvg)    wwAvg.textContent    = avg > 0 ? fmtM(avg) : '–';
  if(wwStreak) wwStreak.textContent = tracked > 0 ? daysUnder+'/'+tracked : '–';

  // Chart uses WEEKLY (already in memory) — fast, no bridge call
  renderWeekChart(_weekChartMode);
  _renderWeekShareButton();
  // renderWeekTopApps + renderWeekInsights are deferred by the caller
  // (switchWellnessView RAF) via setTimeout so the chart paints first
}

function setWeekChart(mode, btn) {
  _weekChartMode = mode;
  document.querySelectorAll('#w-view-week .ctab').forEach(b => b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderWeekChart(mode);
}

function renderWeekChart(mode) {
  const area = document.getElementById('ww-chart-area');
  if(!area) return;
  if(!WEEKLY.length) {
    area.innerHTML = '<div style="text-align:center;padding:20px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">No data yet</div>';
    return;
  }
  if(mode === 'time') { renderWeeklyBarsInto(area); return; }
  if(mode === 'cats') { renderWeekCategoryChart(area); return; }
  _renderWeekPickupsChart(area);
}

// FIX 4: Pickups bar — real value for today, honest "~" estimates for past days
function _renderWeekPickupsChart(area) {
  const GOAL_PU = 100;
  const BAR_H   = 110;

  // Use today's real pickup rate only if we have enough data to make it reliable.
  // If app was just opened (low screen time), fall back to a conservative default.
  const todayRef     = WEEKLY.find(d => d.isToday);
  const todayRealMin = TODAY_MINS || (todayRef&&todayRef.minutes) || 0;
  const pickRate     = (PICKUPS > 0 && todayRealMin >= 30)
    ? PICKUPS / todayRealMin    // real ratio from today
    : 0.28;                     // conservative fallback (~67 pickups in 4h session)

  // Sort WEEKLY so today is rightmost
  const DOW_ORDER    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  let data           = [...WEEKLY];
  const todayDowName = (todayRef ? todayRef.day||'' : DOW_ORDER[(new Date().getDay()+6)%7]).slice(0,3);
  const todayDowIdx  = DOW_ORDER.indexOf(todayDowName);
  if(todayDowIdx >= 0){
    const rot=[];
    for(let i=1;i<=7;i++){const n=DOW_ORDER[(todayDowIdx+i)%7];const m=data.find(d=>(d.day||'').slice(0,3)===n);if(m)rot.push(m);}
    if(rot.length===data.length) data=rot;
  }

  const dayPU = data.map(d => {
    if (d.isToday) return { day:d.day, v:PICKUPS, isToday:true, real:true };
    if (!d.minutes || d.minutes === 0) return { day:d.day, v:0, isToday:false, real:false };
    // Use real pickups from weekly breakdown when available (buildWeeklyBreakdown sets this)
    if (d.pickups !== undefined && d.pickups > 0)
      return { day:d.day, v:d.pickups, isToday:false, real:true };
    // Fallback: estimate from screen time (only for old cached entries without the field)
    return { day:d.day, v:Math.max(1, Math.round(d.minutes * pickRate)), isToday:false, real:false };
  });

  const maxV = Math.max(...dayPU.map(d=>d.v), 1);

  const cols = dayPU.map(d => {
    const bH     = Math.max(d.v>0?14:2, Math.round((d.v/maxV)*BAR_H));
    const isOver = d.v > GOAL_PU;
    const bC     = d.isToday
      ? (isOver ? 'linear-gradient(to top,#F04E7A,#F7A623)' : 'linear-gradient(to top,#6C63FF,#05C8E8)')
      : (isOver ? 'rgba(240,78,122,0.5)' : 'rgba(18,212,138,0.4)');
    const dC     = d.isToday ? (isOver?'#F04E7A':'#6C63FF') : (isOver?'rgba(240,78,122,.7)':'var(--t3)');
    // Real number for today, "~N" for estimates so users know the difference
    const label  = d.v > 0 && bH >= 28
      ? '<span style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:#fff;opacity:.9;text-shadow:0 1px 2px rgba(0,0,0,.4)">'
        + (d.real ? d.v : '~'+d.v) + '</span>'
      : '';
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center">'
      +'<div style="height:'+BAR_H+'px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:100%">'
      +'<div style="width:88%;height:'+bH+'px;background:'+bC+';border-radius:5px 5px 0 0;'
      +(d.isToday?'border-top:2px solid '+(isOver?'#F04E7A':'#6C63FF')+';':'')
      +'display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:height .5s cubic-bezier(.34,1.56,.64,1)">'
      +label+'</div>'
      +'</div>'
      +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:'+dC+';font-weight:'+(d.isToday?700:400)+';margin-top:4px">'
      +(d.day.slice?d.day.slice(0,3):d.day)+'</div>'
      +'</div>';
  }).join('');

  area.innerHTML = '<div style="display:flex;gap:2px;align-items:flex-end;width:100%;padding:0 4px;box-sizing:border-box">'+cols+'</div>'
    +'<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">'
    +'<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:8px;height:8px;border-radius:2px;background:rgba(18,212,138,0.4)"></div>Under '+GOAL_PU+'/day</div>'
    +'<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:8px;height:8px;border-radius:2px;background:rgba(240,78,122,0.5)"></div>Over '+GOAL_PU+'/day</div>'
    +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-left:auto">~ = estimated</div>'
    +'</div>';
}

// FIX 2: Week categories — real weekly data
function renderWeekCategoryChart(area) {
  const weeklyApps = _getWeeklyApps();
  const catMins    = _buildCatMinsFromWeekly(weeklyApps);
  const total      = Object.values(catMins).reduce((s,v)=>s+v,0) || 1;
  const sorted     = Object.entries(catMins).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const isEstimate = !weeklyApps.length;
  if(!sorted.length){
    area.innerHTML='<div style="text-align:center;padding:20px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">No category data yet</div>';
    return;
  }
  const colors = ['#F04E7A','#6C63FF','#05C8E8','#F7A623','#12D48A'];
  area.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">'
    +sorted.map(([cat,mins],i)=>{
      const pct=Math.round((mins/total)*100);
      return '<div style="display:flex;align-items:center;gap:8px">'
        +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+cat+'</div>'
        +'<div style="flex:1;height:8px;background:var(--s2);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+colors[i]+';border-radius:4px;transition:width .5s"></div></div>'
        +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);width:52px;text-align:right">'+fmtM(mins)+' '+pct+'%</div>'
        +'</div>';
    }).join('')
    +'</div>'
    +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:6px">'
    +(isEstimate?'Based on today\'s usage · weekly breakdown builds over time':'Based on this week\'s real usage')
    +'</div>';
}

function renderWeeklyBarsInto(container) {
  let data = WEEKLY.length ? WEEKLY : [];
  if(!data.length) { container.innerHTML=''; return; }
  const DOW_ORDER    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const todayEntry   = data.find(d=>d.isToday);
  const todayDowName = todayEntry ? (todayEntry.day||'').slice(0,3) : DOW_ORDER[(new Date().getDay()+6)%7];
  const todayDowIdx  = DOW_ORDER.indexOf(todayDowName);
  if(todayDowIdx >= 0){
    const rotated=[];
    for(let i=1;i<=7;i++){const name=DOW_ORDER[(todayDowIdx+i)%7];const match=data.find(d=>(d.day||'').slice(0,3)===name);if(match)rotated.push(match);}
    if(rotated.length===data.length) data=rotated;
  }
  data = data.map(d => d.isToday && TODAY_MINS > (d.minutes||0) ? {...d, minutes:TODAY_MINS} : d);
  const BAR_H    = 110;
  const max      = Math.max(...data.map(d=>d.minutes||0), 1);
  const goalMins = S.streakGoalMins || 240;
  const DAY_COLORS=['#6C63FF','#F04E7A','#F7A623','#12D48A','#05C8E8','#B06EFF','#FF6B6B'];
  const dayIdx   = {Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6};
  const cols = data.map((d,i)=>{
    const col      = DAY_COLORS[dayIdx[d.day]!==undefined?dayIdx[d.day]:i%7];
    const barH     = Math.max(14, Math.round((d.minutes/max)*BAR_H));
    const isToday  = !!d.isToday;
    const isUnder  = d.minutes<=goalMins && d.minutes>0;
    const barColor = isUnder&&!isToday?'rgba(18,212,138,0.35)':(isToday?col:col+'99');
    const labelH   = d.minutes>=60?Math.floor(d.minutes/60)+'h'+(d.minutes%60>0?d.minutes%60+'m':''):d.minutes>0?d.minutes+'m':'';
    const timeEl   = labelH&&barH>=28?'<span style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:#fff;opacity:.95;text-shadow:0 1px 2px rgba(0,0,0,.4)">'+labelH+'</span>':'';
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center">'
      +'<div style="height:'+BAR_H+'px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:100%">'
      +'<div style="width:88%;height:'+barH+'px;background:'+barColor+';border-radius:5px 5px 0 0;'+(isToday?'border-top:2px solid '+col+';':'')+';display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:height .5s cubic-bezier(.34,1.56,.64,1)">'+timeEl+'</div>'
      +'</div>'
      +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:'+(isToday?col:'var(--t3)')+';font-weight:'+(isToday?700:400)+';margin-top:4px;text-align:center">'+(d.day.slice?d.day.slice(0,3):d.day)+'</div>'
      +'</div>';
  }).join('');
  container.innerHTML='<div style="display:flex;gap:2px;align-items:flex-end;width:100%;padding:0 4px;box-sizing:border-box">'+cols+'</div>';
}

function renderWeekTopApps() {
  const list = document.getElementById('ww-top-apps-list');
  if(!list) return;
  const apps = _getWeeklyApps();
  if(!apps.length){
    list.innerHTML='<div style="padding:16px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);text-align:center">Weekly app data loading…</div>';
    return;
  }
  const max    = Math.max(...apps.map(a=>a.weeklyMinutes||0), 1);
  const colors = ['var(--a)','var(--r)','var(--p)','var(--c)','var(--g)'];
  list.innerHTML = apps.slice(0,6).map((a,i)=>`
    <div class="ta-row">
      <div class="ta-ico">${appIco(a.packageName,36,10)}</div>
      <div class="ta-info">
        <div class="ta-name">${escHtml(a.name)}</div>
        <div class="ta-bar"><div class="ta-bar-fill" style="width:${Math.round((a.weeklyMinutes/max)*100)}%;background:${colors[i]||'var(--p)'}"></div></div>
      </div>
      <div class="ta-time">${fmtM(a.weeklyMinutes)}</div>
    </div>`).join('');
}

function renderWeekInsights() {
  const el = document.getElementById('ww-insights');
  if(!el) return;
  if(!WEEKLY.length){ el.innerHTML=''; return; }
  const validDays = WEEKLY.filter(d=>d.minutes>0);
  const avg       = validDays.length ? Math.round(WEEKLY.reduce((s,d)=>s+(d.minutes||0),0)/validDays.length) : 0;
  const peakDay   = validDays.length ? validDays.reduce((a,b)=>b.minutes>a.minutes?b:a,validDays[0]) : null;
  const bestDay   = validDays.length>1 ? validDays.reduce((a,b)=>b.minutes<a.minutes?b:a,validDays[0]) : null;
  const goalMins  = S.streakGoalMins || 240;
  const daysUnder = WEEKLY.filter(d=>d.minutes>0&&d.minutes<=goalMins).length;
  const tips = [];
  if(peakDay)  tips.push({icon:'📈',title:`${peakDay.day} was your heaviest day`,body:`${fmtM(peakDay.minutes)} — ${peakDay.minutes>goalMins?fmtM(peakDay.minutes-goalMins)+' over your goal':'within your goal'}. Notice what made it different.`,type:'warn'});
  if(bestDay&&validDays.length>1) tips.push({icon:'✅',title:`${bestDay.day} was your best`,body:`Just ${fmtM(bestDay.minutes)} — ${avg>0?Math.round((avg-bestDay.minutes)/avg*100)+'% below your weekly average':'your lightest day'}. What helped?`,type:'success'});
  if(daysUnder>0) tips.push({icon:'🎯',title:`${daysUnder} of ${validDays.length} days under goal`,body:`You hit your ${fmtM(goalMins)} goal on ${daysUnder} day${daysUnder!==1?'s':''} this week. ${daysUnder>=5?'Excellent discipline!':daysUnder>=3?'Solid progress.':'Keep building the habit.'}`,type:daysUnder>=5?'success':'info'});
  if(avg>0) tips.push({icon:'📊',title:'Weekly average',body:`${fmtM(avg)}/day this week vs your ${fmtM(goalMins)} goal. ${avg<=goalMins?'Averaging under goal — great trend.':'Averaging over goal. Focus on consistency.'}`,type:avg<=goalMins?'success':'info'});
  el.innerHTML=tips.map(t=>`
    <div class="tip-card">
      <div class="tip-ico">${t.icon}</div>
      <div><div style="font-size:12px;font-weight:700;margin-bottom:3px;color:var(--t1)">${t.title}</div><div class="tip-txt">${t.body}</div></div>
    </div>`).join('');
}