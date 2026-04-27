/* ═══ app-wellness-month.js — Month view: calendar, DNA, streak grid ═══════
 * Phase 4 extraction from app-wellness-views.js.
 * Depends on: app-wellness-views.js shared state (MONTHLY_DATA, MONTHLY_APPS,
 *             MONTHLY_PICKUPS, MONTHLY_HOURLY, _monthChartMode,
 *             _buildMonthCalendarData, _monthStatsLoaded),
 *             app-wellness.js + app-core.js globals (fmtM, escHtml, appIco,
 *             WEEKLY, DAILY_USE, TODAY_MINS, S, CATS_MAP, CAT_ICONS, shareCard)
 * ════════════════════════════════════════════════════════════════════════════ */

/* ═══ MONTH VIEW ══════════════════════════════════════════════════════════ */

function renderMonthView() {
  // FIX-2: Mark container so skeleton isn't re-injected on repeat renders
  var _wc = document.getElementById('wellness-content');
  if (_wc) _wc.dataset.wvLoaded = 'month';

  if (MONTHLY_DATA.length) {
    // Cache hit — render everything instantly, no placeholders
    _updateMonthStats();
    renderMonthChart(_monthChartMode);
    renderAppDNA();
    renderMonthStreakGrid();
    renderMonthTopApps();
    // Only re-fetch if the cache might be stale (day changed or first load of session).
    // bgExecutor already rebuilds the monthly cache every 5 min — no need to fetch again
    // on every tab re-entry, which causes a second DOM render and scroll flicker.
    if (!_monthStatsLoaded) _loadMonthlyData(false);
  } else {
    // First open — show skeleton loader so the user knows data is coming
    _showMonthSkeleton();
  }
}

function _showMonthSkeleton() {
  // Stats: show "…" placeholders
  ['wm-total','wm-vs','wm-streak'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '…';
  });
  // Chart area: spinner
  const area = document.getElementById('wm-chart-area');
  if (area) area.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0;gap:12px">
      <div style="width:32px;height:32px;border-radius:50%;border:3px solid var(--border2);border-top-color:var(--p);animation:spin .8s linear infinite"></div>
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Loading month data…</div>
    </div>`;
  // DNA card
  const dna = document.getElementById('wm-dna-card');
  if (dna) dna.innerHTML = '';
  // Top apps
  const list = document.getElementById('wm-top-apps-list');
  if (list) list.innerHTML = `<div style="padding:20px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);text-align:center">Loading…</div>`;
  // Force load on first open
  _loadMonthlyData(true);
}

// Update the 3 stat boxes from real MONTHLY_DATA — no WEEKLY fallback
function _updateMonthStats() {
  const goalMins = S.streakGoalMins || 240;
  // Only count days with ≥10 min to avoid background-noise days inflating average
  const usedDays     = MONTHLY_DATA.filter(d => d.minutes >= 10);
  const monthTotal   = usedDays.reduce((s, d) => s + (d.minutes || 0), 0);
  const trackedCount = usedDays.length;
  const daysUnder    = usedDays.filter(d => d.minutes <= goalMins).length;
  const dailyAvg     = trackedCount > 0 ? Math.round(monthTotal / trackedCount) : 0;

  const wmTotal    = document.getElementById('wm-total');
  const wmVs       = document.getElementById('wm-vs');
  const wmStreak   = document.getElementById('wm-streak');
  const wmStreakLbl= document.getElementById('wm-streak-lbl');

  if (wmTotal)     wmTotal.textContent    = monthTotal > 0 ? fmtM(monthTotal) : '–';
  if (wmVs)        wmVs.textContent       = dailyAvg  > 0 ? fmtM(dailyAvg)   : '–';
  if (wmStreak)    wmStreak.textContent   = trackedCount > 0 ? daysUnder + '/' + trackedCount : '–';
  if (wmStreakLbl) wmStreakLbl.textContent = 'UNDER GOAL';
  if (monthTotal > 0 || trackedCount > 0) _monthStatsLoaded = true;
}

function setMonthChart(mode, btn) {
  _monthChartMode = mode;
  document.querySelectorAll('#w-view-month .ctab').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderMonthChart(mode);
}

function renderMonthChart(mode) {
  const area = document.getElementById('wm-chart-area');
  if(!area) return;
  if(mode === 'cats')    { renderMonthCategoryChart(area); return; }
  if(mode === 'pickups') { _renderMonthPickupsCalendar(area); return; }
  _renderMonthCalendar(area);
}

// Simple 2-color: green = under/at goal, red = over goal. Darker so easy to distinguish.
function _dayColor(mins, goalMins) {
  if (!mins || mins <= 0) return null;
  return mins <= goalMins
    ? { bg:'rgba(0,200,100,0.28)',  border:'rgba(0,200,100,0.85)',  text:'#00C864' }   // dark green
    : { bg:'rgba(230,50,80,0.28)',  border:'rgba(230,50,80,0.85)',  text:'#E63250' };  // dark red
}

function _renderMonthCalendar(area) {
  const now       = new Date();
  const goalMins  = S.streakGoalMins || 240;
  const cells     = _buildMonthCalendarData();
  const monthName = now.toLocaleString('default',{month:'long'});
  const realCount = cells.filter(c=>c.isReal&&!c.isFuture).length;
  const pastCount = cells.filter(c=>!c.isFuture).length;
  const firstDow  = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const DOW_LABELS= ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let html = '<div style="margin-bottom:10px">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:var(--t2)">'+monthName+' '+now.getFullYear()+'</div>'
    +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">'+realCount+' of '+pastCount+' days tracked</div>'
    +'</div>';

  const pct = Math.round((realCount/Math.max(pastCount,1))*100);
  html += '<div style="height:3px;background:var(--s2);border-radius:2px;overflow:hidden;margin-bottom:10px">'
    +'<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,rgba(0,200,100,0.8),var(--p));border-radius:2px;transition:width .5s"></div>'
    +'</div>';

  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:3px">';
  DOW_LABELS.forEach(l => { html += '<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);text-align:center">'+l+'</div>'; });
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';
  for(let i=0;i<firstDow;i++) html += '<div></div>';

  cells.forEach(c => {
    const clr = _dayColor(c.mins, goalMins);
    let bg, color, border, fw = 400, extra = '';

    if (c.isFuture) {
      bg = 'transparent'; color = 'var(--border2)'; border = '1px dashed var(--border)';
    } else if (!c.isReal) {
      bg = 'rgba(255,255,255,0.04)'; color = 'var(--t3)'; border = '1px solid var(--border)';
    } else {
      bg = clr.bg; color = clr.text; border = '1px solid ' + clr.border;
    }
    if (c.isToday) {
      if (clr) { bg = clr.bg; color = clr.text; }
      border = '2px solid var(--p)';
      extra  = 'box-shadow:0 0 0 2px rgba(108,99,255,0.5),0 0 10px rgba(108,99,255,0.3);';
      fw     = 800;
    }

    const titleAttr = c.isReal ? 'title="'+fmtM(c.mins)+(c.isUnder?' · under goal':' · over goal')+'"' : '';
    const timeStr   = c.isReal && c.mins > 0
      ? (c.mins >= 60
          ? Math.floor(c.mins/60)+'h'+(c.mins%60>0?' '+c.mins%60+'m':'')
          : c.mins+'m')
      : '';
    html += '<div '+titleAttr+' style="aspect-ratio:1;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:var(--ff-m);color:'+color+';background:'+bg+';border:'+border+';'+extra+'position:relative">'
      + '<div style="font-size:var(--text-2xs);font-weight:'+fw+'">'+c.day+'</div>'
      + (timeStr ? '<div style="font-size:var(--text-2xs);opacity:.9;line-height:1.1;font-weight:600;text-align:center;padding:0 1px">'+timeStr+'</div>' : '')
      + '</div>';
  });

  html += '</div>';

  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">'
    + '<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:10px;height:10px;border-radius:2px;background:rgba(0,200,100,0.28);border:1px solid rgba(0,200,100,0.85)"></div>Under goal</div>'
    + '<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:10px;height:10px;border-radius:2px;background:rgba(230,50,80,0.28);border:1px solid rgba(230,50,80,0.85)"></div>Over goal</div>'
    + '<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:10px;height:10px;border-radius:2px;border:2px solid var(--p);box-shadow:0 0 0 1px rgba(108,99,255,0.4)"></div>Today</div>'
    + '</div>';

  if (realCount === 0) {
    html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.2);border-radius:8px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p2)">📈 Data loads as days pass. Check back tomorrow!</div>';
  } else if (realCount < 7) {
    html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(108,99,255,0.08);border:1px solid rgba(108,99,255,0.2);border-radius:8px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--p2)">📈 '+(7-realCount)+' more day'+(7-realCount!==1?'s':'')+' until a full week of data.</div>';
  }
  html += '</div>';
  area.innerHTML = html;
}
function _renderMonthPickupsCalendar(area) {
  const now       = new Date();
  const cells     = _buildMonthCalendarData();
  const monthName = now.toLocaleString('default',{month:'long'});
  const firstDow  = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const DOW_LABELS= ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const GOAL_PU   = 100;
  const pickRate  = (PICKUPS>0&&TODAY_MINS>=30) ? PICKUPS/TODAY_MINS : 0.28;

  let html = '<div style="margin-bottom:10px">'
    +'<div style="font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:700;color:var(--t2);margin-bottom:8px">'+monthName+' Pickups</div>'
    +'<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:3px">';
  DOW_LABELS.forEach(l=>{ html+='<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);text-align:center">'+l+'</div>'; });
  html += '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';
  for(let i=0;i<firstDow;i++) html+='<div></div>';

  cells.forEach(c=>{
    let pu='', bg, color, border, fw=400, extra='';
    if(c.isFuture){
      bg='transparent'; color='var(--border2)'; border='1px dashed var(--border)';
    } else if(c.isToday){
      pu=PICKUPS;
      const over=pu>GOAL_PU;
      bg=over?'rgba(230,50,80,0.28)':'rgba(0,200,100,0.28)';
      color=over?'#E63250':'#00C864';
      border='2px solid var(--p)';
      extra='box-shadow:0 0 0 2px rgba(108,99,255,0.5),0 0 10px rgba(108,99,255,0.3);';
      fw=800;
    } else if(c.isReal&&c.mins>0){
      // Use real per-day pickup count if available; fall back to estimate
      const dateKey = (now.getMonth()+1)+'/'+c.day;
      const realPu  = MONTHLY_PICKUPS[dateKey];
      pu = (realPu !== undefined) ? realPu : Math.max(1, Math.round(c.mins * pickRate));
      const isReal  = realPu !== undefined;
      const over=pu>GOAL_PU;
      bg=over?'rgba(230,50,80,0.28)':'rgba(0,200,100,0.28)';
      color=over?'#E63250':'#00C864';
      border='1px solid '+(over?'rgba(230,50,80,0.85)':'rgba(0,200,100,0.85)');
      const titleAttrInner = 'title="'+(isReal?'':'~')+pu+' pickups"';
      html+='<div '+titleAttrInner+' style="aspect-ratio:1;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:var(--ff-m);color:'+color+';background:'+bg+';border:'+border+';overflow:hidden">'
        +'<div style="font-size:var(--text-2xs);font-weight:'+fw+'">'+c.day+'</div>'
        +'<div style="font-size:var(--text-2xs);opacity:.9;font-weight:600">'+(isReal?'':'~')+pu+'</div>'
        +'</div>';
      return; // skip the default html+= below
    } else {
      bg='rgba(255,255,255,0.04)'; color='var(--t3)'; border='1px solid var(--border)';
    }
    const titleAttr = pu!=='' ? 'title="'+(c.isToday?'':'~')+pu+' pickups"' : '';
    html+='<div '+titleAttr+' style="aspect-ratio:1;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:var(--ff-m);color:'+color+';background:'+bg+';border:'+border+';'+extra+'overflow:hidden">'
      +'<div style="font-size:var(--text-2xs);font-weight:'+fw+'">'+c.day+'</div>'
      +(pu!==''?'<div style="font-size:var(--text-2xs);opacity:.9;font-weight:600">'+(c.isToday?'':'~')+pu+'</div>':'')
      +'</div>';
  });

  html += '</div></div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:6px">today = real · other days = estimated from screen time</div>';
  area.innerHTML = html;
}

// Month category chart — uses real monthly app totals when available
function renderMonthCategoryChart(area) {
  const pkgToCat = {};
  Object.entries(CATS_MAP).forEach(([cat, apps]) => apps.forEach(a => { pkgToCat[a.packageName] = cat; }));

  const catMins = {};
  let isEstimate = false;

  if (MONTHLY_APPS.length) {
    // Real monthly data
    MONTHLY_APPS.forEach(a => {
      const cat = pkgToCat[a.packageName] || 'Other';
      catMins[cat] = (catMins[cat] || 0) + (a.monthlyMinutes || 0);
    });
  } else {
    // Fallback: weekly apps or daily use
    const weeklyApps = _getWeeklyApps();
    isEstimate = true;
    if (weeklyApps.length) {
      weeklyApps.forEach(a => {
        const cat = pkgToCat[a.packageName] || 'Other';
        catMins[cat] = (catMins[cat] || 0) + (a.weeklyMinutes || 0);
      });
    } else {
      DAILY_USE.forEach(a => {
        const cat = pkgToCat[a.packageName] || 'Other';
        catMins[cat] = (catMins[cat] || 0) + (a.totalMinutes || 0);
      });
    }
  }

  const total  = Object.values(catMins).reduce((s, v) => s + v, 0) || 1;
  const sorted = Object.entries(catMins).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const colors = ['#F04E7A','#6C63FF','#05C8E8','#F7A623','#12D48A'];
  area.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">'
    + sorted.map(([cat, mins], i) => {
        const pct = Math.round((mins / total) * 100);
        return `<div style="display:flex;align-items:center;gap:8px">
          <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cat}</div>
          <div style="flex:1;height:8px;background:var(--s2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${colors[i]};border-radius:4px;transition:width .5s"></div></div>
          <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);width:44px;text-align:right">${fmtM(mins)}</div>
        </div>`;
      }).join('')
    + '</div>'
    + `<div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:8px">${isEstimate ? 'Loading monthly data…' : 'This month\'s real usage'}</div>`;
}

// Returns e.g. "21st March" from a day number string and month name
function _ordinalDay(dayStr, monthName) {
  const n = parseInt(dayStr);
  if (!n) return '–';
  const s = n === 11 || n === 12 || n === 13 ? 'th'
           : n % 10 === 1 ? 'st'
           : n % 10 === 2 ? 'nd'
           : n % 10 === 3 ? 'rd' : 'th';
  return n + s + ' ' + monthName;
}

// App DNA — unique insights not shown elsewhere on the page
function renderAppDNA() {
  const card = document.getElementById('wm-dna-card');
  if (!card) return;
  const now       = new Date();
  const monthName = now.toLocaleString('default', {month: 'long'});
  const year      = now.getFullYear();
  const goalMins  = S.streakGoalMins || 240;
  const today     = now.getDate();

  // ── Data source: real monthly or weekly fallback ──────────────────────────
  let peakEntry, bestEntry, topApp, isMonthly, dataPoints;
  let longestStreak = 0, currentStreak = 0;

  if (MONTHLY_DATA.length) {
    isMonthly  = true;
    dataPoints = MONTHLY_DATA.filter(d => d.minutes > 0);
    peakEntry  = dataPoints.length ? dataPoints.reduce((a, b) => b.minutes > a.minutes ? b : a) : null;
    bestEntry  = dataPoints.length > 1 ? dataPoints.reduce((a, b) => b.minutes < a.minutes ? b : a) : null;
    if (peakEntry) peakEntry = { ...peakEntry, label: _ordinalDay((peakEntry.date || '').split('/')[1], monthName) };
    if (bestEntry) bestEntry = { ...bestEntry, label: _ordinalDay((bestEntry.date || '').split('/')[1], monthName) };
    topApp = MONTHLY_APPS[0] ? { name: MONTHLY_APPS[0].name, mins: MONTHLY_APPS[0].monthlyMinutes, packageName: MONTHLY_APPS[0].packageName } : null;
    // Compute current and longest streak from monthly calendar data
    let run = 0, best = 0, cur = 0;
    for (let d = 1; d <= today; d++) {
      const dayData = MONTHLY_DATA.find(x => {
        const parts = (x.date || '').split('/');
        return parts.length === 2 && parseInt(parts[1]) === d;
      });
      const mins = dayData ? (dayData.minutes || 0) : 0;
      if (mins > 0 && mins <= goalMins) { run++; if (run > best) best = run; if (d === today) cur = run; }
      else if (mins > goalMins) { run = 0; }
    }
    longestStreak = best;
    currentStreak = cur;
  } else {
    isMonthly  = false;
    const validDays = WEEKLY.filter(d => d.minutes > 0);
    dataPoints = validDays;
    peakEntry  = validDays.length ? { label: validDays.reduce((a,b)=>b.minutes>a.minutes?b:a).day, minutes: validDays.reduce((a,b)=>b.minutes>a.minutes?b:a).minutes } : null;
    bestEntry  = validDays.length > 1 ? { label: validDays.reduce((a,b)=>b.minutes<a.minutes?b:a).day, minutes: validDays.reduce((a,b)=>b.minutes<a.minutes?b:a).minutes } : null;
    topApp     = DAILY_USE[0] ? { name: DAILY_USE[0].name, mins: DAILY_USE[0].totalMinutes, packageName: DAILY_USE[0].packageName } : null;
    currentStreak = WEEKLY.filter(d=>d.minutes>0&&d.minutes<=goalMins).length;
    longestStreak = currentStreak;
  }

  // ── Time-of-day pattern — uses monthly average when available, falls back to today ─
  let timePattern = null;
  try {
    // Prefer MONTHLY_HOURLY (average across all tracked days) over today-only cache
    const hourlyData = (MONTHLY_HOURLY && MONTHLY_HOURLY.length > 0)
      ? MONTHLY_HOURLY
      : (IS_NATIVE && N.getCachedHourly ? JSON.parse(N.getCachedHourly() || '[]') : []);
    if (hourlyData.length > 0) {
      const morn = hourlyData.filter(x => x.hour >= 6  && x.hour <= 11).reduce((s,x)=>s+(x.minutes||0),0);
      const aft  = hourlyData.filter(x => x.hour >= 12 && x.hour <= 16).reduce((s,x)=>s+(x.minutes||0),0);
      const eve  = hourlyData.filter(x => x.hour >= 17 && x.hour <= 22).reduce((s,x)=>s+(x.minutes||0),0);
      const ngt  = hourlyData.filter(x => x.hour >= 23 || x.hour <= 5 ).reduce((s,x)=>s+(x.minutes||0),0);
      const total = morn + aft + eve + ngt || 1;
      const slots = [{label:'Morning', pct: Math.round(morn/total*100), color:'#F7A623'},
                     {label:'Afternoon', pct: Math.round(aft/total*100), color:'#5DD6F8'},
                     {label:'Evening', pct: Math.round(eve/total*100), color:'#A89CFF'},
                     {label:'Late night', pct: Math.round(ngt/total*100), color:'#6C63FF'}];
      const peak = slots.reduce((a,b) => b.pct > a.pct ? b : a);
      if (peak.pct > 15) timePattern = { peak, slots };
    }
  } catch(_) {}

  // ── Trend sentence (unique — not shown in stats row) ─────────────────────
  let trendHtml = '';
  if (currentStreak >= 3) {
    trendHtml = `<div style="padding:10px 12px;background:rgba(18,212,138,.08);border:1px solid rgba(18,212,138,.2);border-radius:10px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--g);margin-bottom:8px">
      🔥 ${currentStreak}-day goal streak — don't break it!
    </div>`;
  } else if (longestStreak > currentStreak && longestStreak >= 3) {
    trendHtml = `<div style="padding:10px 12px;background:rgba(247,166,35,.08);border:1px solid rgba(247,166,35,.2);border-radius:10px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--a);margin-bottom:8px">
      ⭐ Best run this month: ${longestStreak} days under goal
    </div>`;
  } else if (topApp) {
    trendHtml = `<div style="padding:10px 12px;background:rgba(240,78,122,.06);border:1px solid rgba(240,78,122,.18);border-radius:10px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);margin-bottom:8px">
      📱 <strong>${topApp.name}</strong> is your top app — ${fmtM(topApp.mins)} ${isMonthly ? 'this month' : 'this week'}
    </div>`;
  }

  // ── Last week vs this week + Weekday vs Weekend ──────────────────────────
  // Uses MONTHLY_DATA so we can look at real calendar weeks, not just the
  // last 7 rolling days that WEEKLY provides (which truncates "last week").
  let weekCompHtml = '';
  try {
    const now = new Date();
    // Monday of the current calendar week (Mon = week start)
    const todayDOW = (now.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - todayDOW);
    thisMonday.setHours(0, 0, 0, 0);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);

    // Helper: parse "M/D" date field into a Date object in current year/month context
    const parseDate = d => {
      const [m, day] = (d.date || '').split('/').map(Number);
      if (!m || !day) return null;
      return new Date(now.getFullYear(), m - 1, day);
    };

    // Use MONTHLY_DATA when available (best source — real tracked days back to day 1)
    // Fall back to WEEKLY for the first few days of a new month
    const source = (MONTHLY_DATA && MONTHLY_DATA.length > 0) ? MONTHLY_DATA : WEEKLY.map(d => ({
      date: d.date, minutes: d.minutes, isToday: d.isToday
    }));

    const thisWeekEntries = [];
    const lastWeekEntries = [];

    source.forEach(d => {
      if (!d.minutes || d.minutes <= 0) return;
      const dt = parseDate(d);
      if (!dt) return;
      if (dt >= thisMonday) thisWeekEntries.push(d);
      else if (dt >= lastMonday) lastWeekEntries.push(d);
    });

    const thisWeekTotal = thisWeekEntries.reduce((s, d) => s + (d.minutes || 0), 0);
    const lastWeekTotal = lastWeekEntries.reduce((s, d) => s + (d.minutes || 0), 0);
    const thisWeekAvg = thisWeekEntries.length ? Math.round(thisWeekTotal / thisWeekEntries.length) : 0;
    const lastWeekAvg = lastWeekEntries.length ? Math.round(lastWeekTotal / lastWeekEntries.length) : 0;

    // Weekday vs Weekend — also from monthly data for more complete picture
    const WEEKEND = new Set([0, 6]); // Sun=0, Sat=6 in getDay()
    const wkdayEntries = source.filter(d => {
      const dt = parseDate(d);
      return dt && !WEEKEND.has(dt.getDay()) && d.minutes > 0;
    });
    const wkendEntries = source.filter(d => {
      const dt = parseDate(d);
      return dt && WEEKEND.has(dt.getDay()) && d.minutes > 0;
    });
    const wkdayAvg = wkdayEntries.length
      ? Math.round(wkdayEntries.reduce((s, d) => s + d.minutes, 0) / wkdayEntries.length) : 0;
    const wkendAvg = wkendEntries.length
      ? Math.round(wkendEntries.reduce((s, d) => s + d.minutes, 0) / wkendEntries.length) : 0;

    // Week-vs-week cell
    let weekVsHtml = '';
    if (thisWeekAvg > 0) {
      const hasLastWeek = lastWeekAvg > 0;
      const diff       = hasLastWeek ? Math.round((thisWeekAvg - lastWeekAvg) / lastWeekAvg * 100) : 0;
      const improved   = diff <= 0;
      const arrow      = improved ? '↓' : '↑';
      const trendClr   = improved ? 'var(--g)' : 'var(--r)';
      const deltaText  = hasLastWeek
        ? `${arrow}${Math.abs(diff)}% avg/day vs last week`
        : 'No last-week data yet';

      weekVsHtml = `
        <div class="dna-cell">
          <div class="dna-cell-lbl">📅 LAST WEEK → THIS WEEK</div>
          <div style="display:flex;align-items:baseline;gap:4px;margin:4px 0 2px;overflow:hidden">
            <span style="font-size:13px;font-weight:700;color:var(--t3);opacity:.7;white-space:nowrap">${hasLastWeek ? fmtM(lastWeekAvg) : '–'}</span>
            <span style="font-size:var(--text-2xs);color:var(--t3);flex-shrink:0">→</span>
            <span style="font-size:14px;font-weight:700;color:var(--t1);white-space:nowrap">${fmtM(thisWeekAvg)}</span>
            <span style="font-size:var(--text-2xs);color:var(--t3);opacity:.6;flex-shrink:0">/day</span>
          </div>
          <div class="dna-cell-delta" style="color:${hasLastWeek ? trendClr : 'var(--t3)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${deltaText}
          </div>
        </div>`;
    }

    const wkDiff = wkdayAvg > 0 && wkendAvg > 0
      ? Math.round((wkendAvg - wkdayAvg) / wkdayAvg * 100) : 0;
    const wkVsWkendHtml = (wkdayAvg > 0 || wkendAvg > 0) ? `
        <div class="dna-cell">
          <div class="dna-cell-lbl">💼 WEEKDAY VS 🎉 WEEKEND</div>
          <div class="dna-cell-val" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${wkdayAvg > 0 ? fmtM(wkdayAvg) : '–'} <span style="font-size:var(--text-2xs);opacity:.6">/ ${wkendAvg > 0 ? fmtM(wkendAvg) : '–'}</span></div>
          <div class="dna-cell-delta" style="color:${wkendAvg > wkdayAvg ? 'var(--r)' : 'var(--g)'}">
            ${wkdayAvg > 0 && wkendAvg > 0
              ? (wkendAvg > wkdayAvg
                  ? `Weekends ${Math.abs(wkDiff)}% heavier`
                  : wkendAvg < wkdayAvg
                    ? `Weekends ${Math.abs(wkDiff)}% lighter`
                    : 'Same pace both days')
              : 'Need more data'}
          </div>
        </div>` : '';

    if (weekVsHtml || wkVsWkendHtml) {
      weekCompHtml = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        ${weekVsHtml}${wkVsWkendHtml}
      </div>`;
    }
  } catch(_) {}

  // ── Peak / Best cells ─────────────────────────────────────────────────────
  const gridHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="dna-cell">
        <div class="dna-cell-lbl">📈 PEAK DAY</div>
        <div class="dna-cell-val" style="font-size:${isMonthly?'14px':'11px'}">${peakEntry ? peakEntry.label : '–'}</div>
        <div class="dna-cell-delta" style="color:var(--r);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${peakEntry ? fmtM(peakEntry.minutes) : 'No data yet'}</div>
      </div>
      <div class="dna-cell">
        <div class="dna-cell-lbl">✅ BEST DAY</div>
        <div class="dna-cell-val" style="font-size:${isMonthly?'14px':'11px'}">${bestEntry ? bestEntry.label : '–'}</div>
        <div class="dna-cell-delta" style="color:var(--g);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${bestEntry ? fmtM(bestEntry.minutes) : dataPoints.length <= 1 ? 'Need more days' : 'No data yet'}</div>
      </div>
    </div>`;

  // ── Time-of-day bar ───────────────────────────────────────────────────────
  let timeHtml = '';
  if (timePattern) {
    const bars = timePattern.slots.map(s =>
      `<div style="display:flex;align-items:center;gap:6px">
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);width:66px">${s.label}</div>
        <div style="flex:1;height:6px;background:var(--s2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${s.pct}%;background:${s.color};border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);width:28px;text-align:right">${s.pct}%</div>
      </div>`).join('');
    timeHtml = `<div style="margin-bottom:8px">
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">⏰ Time of Day</div>
      <div style="display:flex;flex-direction:column;gap:5px">${bars}</div>
    </div>`;
  }

  // ── Top category ─────────────────────────────────────────────────────────
  let topCatHtml = '';
  try {
    const pkgToCat = {};
    Object.entries(CATS_MAP).forEach(([cat, apps]) => apps.forEach(a => { pkgToCat[a.packageName] = cat; }));
    const catMins = {};
    const appsForCat = MONTHLY_APPS.length ? MONTHLY_APPS.map(a => ({pkg: a.packageName, mins: a.monthlyMinutes}))
                                           : DAILY_USE.map(a => ({pkg: a.packageName, mins: a.totalMinutes}));
    appsForCat.forEach(({pkg, mins}) => {
      const cat = pkgToCat[pkg];
      if (cat) catMins[cat] = (catMins[cat] || 0) + mins;
    });
    const sorted = Object.entries(catMins).sort((a,b) => b[1]-a[1]);
    if (sorted.length >= 2) {
      const [topCat, topMins] = sorted[0];
      const totalCatMins = sorted.reduce((s,[,m]) => s+m, 0) || 1;
      const pct = Math.round(topMins / totalCatMins * 100);
      const icon = CAT_ICONS[topCat] || '📱';
      topCatHtml = `<div style="padding:10px 12px;background:rgba(108,99,255,.07);border:1px solid rgba(108,99,255,.18);border-radius:10px;margin-bottom:8px">
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);letter-spacing:1px;text-transform:uppercase;margin-bottom:5px">📂 TOP CATEGORY</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">${icon}</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700;color:var(--t1)">${topCat}</div>
            <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);margin-top:1px">${fmtM(topMins)} · ${pct}% of total ${isMonthly ? 'this month' : 'this week'}</div>
          </div>
        </div>
      </div>`;
    }
  } catch(_) {}

  card.innerHTML = `
    <div class="dna-pro-hdr" style="display:flex;align-items:center;justify-content:space-between">
      <div class="dna-pro-title">${monthName} ${year} · Patterns</div>
      <button type="button" onclick="shareCard('appdna')" style="background:rgba(108,99,255,.10);border:1px solid rgba(108,99,255,.25);color:var(--p2);font-family:var(--ff-m);font-size:var(--text-2xs);font-weight:600;padding:5px 11px;border-radius:8px;cursor:pointer;white-space:nowrap;flex-shrink:0">📤 Share</button>
    </div>
    <div class="dna-period">${isMonthly ? dataPoints.length + ' days tracked' : 'This week · monthly data loading…'}</div>
    ${trendHtml}
    ${topCatHtml}
    ${gridHtml}
    ${weekCompHtml}
    ${timeHtml}
    <div class="dna-refresh-txt">${isMonthly ? 'Resets 1st of each month' : 'Updates daily'}</div>`;
}

function openProUpgrade(){
  toast('Pro upgrade coming soon — stay tuned!','info',3000);
}

// FIX: Streak grid uses real calendar data — simple green/red + today glow
function renderMonthStreakGrid() {
  const grid = document.getElementById('wm-streak-grid');
  if (!grid) return;
  const cells    = _buildMonthCalendarData();
  const goalMins = S.streakGoalMins || 240;
  grid.innerHTML = '';

  cells.forEach(c => {
    const el = document.createElement('div');
    el.className   = 'wm-streak-day';
    el.textContent = c.day;

    if (c.isFuture) {
      el.style.opacity     = '0.25';
      el.style.borderColor = 'var(--border)';
      el.style.color       = 'var(--t3)';
    } else if (!c.isReal) {
      el.style.background  = 'rgba(255,255,255,0.04)';
      el.style.borderColor = 'var(--border)';
      el.style.color       = 'var(--t3)';
      el.style.opacity     = '0.4';
      el.title = 'No data yet';
    } else {
      const clr = _dayColor(c.mins, goalMins);
      el.style.background  = clr.bg;
      el.style.borderColor = clr.border;
      el.style.color       = clr.text;
      el.title = fmtM(c.mins) + (c.isUnder ? ' · ✓ under goal' : ' · over goal');
    }
    if (c.isToday) {
      el.style.fontWeight  = '800';
      el.style.borderWidth = '2px';
      el.style.borderColor = 'var(--p)';
      el.style.boxShadow   = '0 0 0 2px rgba(108,99,255,0.5),0 0 10px rgba(108,99,255,0.3)';
    }
    grid.appendChild(el);
  });

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:10px;margin-top:8px;flex-wrap:wrap';
  legend.innerHTML =
    '<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:10px;height:10px;border-radius:2px;background:rgba(0,200,100,0.28);border:1px solid rgba(0,200,100,0.85)"></div>Under goal</div>'
    + '<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:10px;height:10px;border-radius:2px;background:rgba(230,50,80,0.28);border:1px solid rgba(230,50,80,0.85)"></div>Over goal</div>'
    + '<div style="display:flex;align-items:center;gap:4px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)"><div style="width:10px;height:10px;border-radius:2px;border:2px solid var(--p);box-shadow:0 0 0 1px rgba(108,99,255,0.4)"></div>Today</div>';
  grid.appendChild(legend);
}

function renderMonthTopApps() {
  const list = document.getElementById('wm-top-apps-list');
  if (!list) return;

  // Single source of truth: MONTHLY_APPS (getMonthlyAppUsage) — already sorted by
  // monthlyMinutes desc, already user-apps only. Top 5 here = top 5 in All Apps → Month sort.
  if (!MONTHLY_APPS.length) {
    list.innerHTML = `<div style="padding:20px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);text-align:center">Loading monthly data…</div>`;
    return;
  }

  const apps   = MONTHLY_APPS.slice(0, 5);
  const max    = Math.max(...apps.map(a => a.monthlyMinutes || 0), 1);
  const colors = ['var(--a)','var(--r)','var(--p)','var(--c)','var(--g)'];
  list.innerHTML = apps.map((a, i) => `
    <div class="ta-row">
      <div class="ta-ico">${appIco(a.packageName, 36, 10)}</div>
      <div class="ta-info">
        <div class="ta-name">${escHtml(a.name)}</div>
        <div class="ta-bar"><div class="ta-bar-fill" style="width:${Math.round(((a.monthlyMinutes||0)/max)*100)}%;background:${colors[i]||'var(--p)'}"></div></div>
      </div>
      <div class="ta-time">${fmtM(a.monthlyMinutes||0)}<span style="font-size:var(--text-2xs);opacity:.6"> /mo</span></div>
    </div>`).join('');
}