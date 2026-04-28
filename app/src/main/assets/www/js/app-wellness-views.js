/* ═══ app-wellness-views.js — Shared state, helpers + tab switcher ══════════
 * Week view → app-wellness-week.js
 * Month view → app-wellness-month.js
 * ════════════════════════════════════════════════════════════════════════════ */

/* ═══ WELLNESS VIEW SWITCHING ════════════════════════════════════════════════ */
//let _wellnessView    = 'today';
let _weekChartMode   = 'time';
let _monthChartMode  = 'time';
let _weekRendered    = false;
let _monthRendered   = false;
// Tracks whether month stats have ever been successfully populated.
// Prevents the stats row from flashing "…" every time the user switches back to Month tab.
let _monthStatsLoaded = false;
let _monthLoading     = false;
let _monthCacheDay    = '';

function switchWellnessView(view, btn) {
  // Pro gate — delegates to setWellnessView which goes through the defineProperty
  // setter in app-wellness.js. That setter blocks the assignment and triggers the
  // upsell sheet if the user isn't Pro. Do NOT duplicate the gate check here with
  // a direct _wellnessView assignment — that bypasses the setter entirely.
  setWellnessView(view);
  // If the view didn't change (gate blocked it), stop here
  if (_wellnessView !== view) return;
  document.querySelectorAll('.w-tpb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  ['today','week','month'].forEach(v => {
    const el = document.getElementById('w-view-' + v);
    if(el) el.style.display = v === view ? '' : 'none';
  });
  const scr = document.getElementById('screen-wellness');
  if(scr) scr.scrollTop = 0;

  // FIX-2: Paint a shimmer skeleton into the chart sub-container SYNCHRONOUSLY
  // so something visible appears before any bridge calls run. We target the
  // specific empty sub-containers (not the whole view) so named child IDs
  // used by the render functions are never wiped.
  var _skeletonBars =
    '<div style="padding:16px 0 8px;display:flex;flex-direction:column;gap:12px;pointer-events:none">' +
      '<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding:0 8px">' +
        [1,0.65,0.85,0.45,0.95,0.7,0.55].map(function(h,i){
          return '<div style="flex:1;border-radius:6px 6px 0 0;background:var(--s3);height:'+Math.round(h*100)+'%;animation:skeleton-pulse 1.4s ease-in-out infinite '+( i*0.08).toFixed(2)+'s"></div>';
        }).join('') +
      '</div>' +
      '<div style="height:3px;background:var(--border);margin:0 8px;border-radius:2px"></div>' +
    '</div>';

  if (view === 'week' && !_weekRendered) {
    var _chartArea = document.getElementById('ww-chart-area');
    if (_chartArea) _chartArea.innerHTML = _skeletonBars;
    // Also show a loading state in top apps so there's no blank gap
    var _topList = document.getElementById('ww-top-apps-list');
    if (_topList) _topList.innerHTML =
      '<div style="padding:14px 16px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);' +
      'display:flex;align-items:center;gap:8px">' +
      '<div style="width:14px;height:14px;border-radius:50%;border:2px solid var(--border2);' +
      'border-top-color:var(--p);animation:spin .8s linear infinite;flex-shrink:0"></div>' +
      'Loading top apps…</div>';
  }
  if (view === 'month') {
    var _chartArea = document.getElementById('wm-chart-area');
    if (_chartArea) _chartArea.innerHTML = _skeletonBars;
  }

  requestAnimationFrame(() => {
    if(view === 'today') {
      renderWellness();
      _loadMonthlyData(false); // prefetch in background so month tab is instant
    } else if(view === 'week') {
      _invalidateWeeklyAppsCache();
      _catMinsCache = null;
      if(!_weekRendered) {
        renderWeekView(); // fast: stats + chart from WEEKLY (in memory)
        _weekRendered = true;
        // Defer the slow N.getWeeklyAppUsage() bridge call so chart paints first
        setTimeout(function() {
          renderWeekTopApps();
          if (typeof renderWeekCoachInsight === 'function') renderWeekCoachInsight();
          else if (typeof renderWeekInsights === 'function') renderWeekInsights();
        }, 0);
      } else {
        // Re-visit: restore correct chart tab highlight and re-render chart
        // (also overwrites any skeleton that was painted synchronously above)
        document.querySelectorAll('#w-view-week .ctab').forEach(b=>b.classList.remove('on'));
        const _wb=document.getElementById('ww-ctab-'+_weekChartMode);
        if(_wb) _wb.classList.add('on');
        renderWeekChart(_weekChartMode);
      }
      _loadMonthlyData(false); // prefetch in background so month tab is instant
    } else if(view === 'month') {
      _catMinsCache = null;
      const todayStr = new Date().toISOString().slice(0, 10);
      if (_monthCacheDay && _monthCacheDay !== todayStr) _invalidateMonthlyCache();
      renderMonthView();
      _monthRendered = true;
    }
  });
}

/* ─── Shared helpers ────────────────────────────────────────────────────── */

// Cached weekly app data — avoids slow live query on every tab switch
let _weeklyAppsData = null;
let _weeklyAppsTs   = 0;
const _WEEKLY_APPS_TTL = 5 * 60 * 1000; // 5 minutes

// Monthly data arrays — populated from bgExecutor cache, never blocking
let MONTHLY_DATA    = [];  // [{day, date, minutes, isToday}]
let MONTHLY_APPS    = [];  // [{packageName, name, iconUrl, monthlyMinutes}]
let MONTHLY_PICKUPS = {};  // { "M/D": count } — real per-day pickup counts
let MONTHLY_HOURLY  = [];  // [{hour, minutes}] — average across tracked days

function _loadMonthlyData(force) {
  if (_monthLoading && !force) return;
  if (!IS_NATIVE || !N.hasUsagePermission()) return;
  if (typeof N.getMonthlyBreakdown !== 'function') return;
  _monthLoading = true;
  setTimeout(() => {
    try {
      MONTHLY_DATA  = JSON.parse(N.getMonthlyBreakdown() || '[]');
      MONTHLY_APPS  = JSON.parse(N.getMonthlyAppUsage()  || '[]');
      // Real per-day pickups and monthly hourly average (new cache keys)
      if (typeof N.getMonthlyPickupBreakdown === 'function') {
        const pickupArr = JSON.parse(N.getMonthlyPickupBreakdown() || '[]');
        MONTHLY_PICKUPS = {};
        pickupArr.forEach(p => { MONTHLY_PICKUPS[p.date] = p.pickups; });
      }
      if (typeof N.getMonthlyHourlyBreakdown === 'function') {
        MONTHLY_HOURLY = JSON.parse(N.getMonthlyHourlyBreakdown() || '[]');
      }
      _monthCacheDay = new Date().toISOString().slice(0, 10);
      _renderMonthAfterLoad();
    } catch(e) { console.error('_loadMonthlyData:', e); }
    _monthLoading = false;
  }, 0);
}

function _invalidateMonthlyCache() {
  MONTHLY_DATA    = [];
  MONTHLY_APPS    = [];
  MONTHLY_PICKUPS = {};
  MONTHLY_HOURLY  = [];
  _monthCacheDay   = '';
  _monthStatsLoaded = false;
}

function _renderMonthAfterLoad() {
  // Save scroll position before any DOM rebuild — async renders fire after the user
  // may have scrolled down, and replaceChild/innerHTML resets the layout.
  const scr = document.getElementById('screen-wellness');
  const savedScroll = scr ? scr.scrollTop : 0;

  _updateMonthStats();
  renderMonthChart(_monthChartMode);
  renderAppDNA();
  renderMonthStreakGrid();
  renderMonthTopApps();

  // Coach insight card for Pro users — added above Top Apps
  if (typeof renderMonthCoachInsight === 'function') renderMonthCoachInsight();

  // Restore scroll position after DOM settles (one rAF is enough for layout to flush)
  if (scr && savedScroll > 0) {
    requestAnimationFrame(() => { scr.scrollTop = savedScroll; });
  }
}

function _getWeeklyApps() {
  const now = Date.now();
  if(_weeklyAppsData && now - _weeklyAppsTs < _WEEKLY_APPS_TTL) return _weeklyAppsData;
  if(IS_NATIVE && typeof N.getWeeklyAppUsage === 'function'){
    try {
      _weeklyAppsData = JSON.parse(N.getWeeklyAppUsage()||'[]');
      _weeklyAppsTs   = now;
      return _weeklyAppsData;
    } catch(_){}
  }
  return _weeklyAppsData || [];
}

// Invalidate cache on tab switch so first open always gets fresh data
function _invalidateWeeklyAppsCache() {
  _weeklyAppsData = null;
  _weeklyAppsTs   = 0;
}

// Cached category mins — avoids recalculating on every chart tab switch
let _catMinsCache = null;
let _catMinsTs    = 0;

function _buildCatMinsFromWeekly(weeklyApps) {
  const now = Date.now();
  if(_catMinsCache && now - _catMinsTs < 5 * 60 * 1000) return _catMinsCache;
  const pkgToCat = {};
  Object.entries(CATS_MAP).forEach(([cat,apps])=>apps.forEach(a=>{ pkgToCat[a.packageName]=cat; }));
  const catMins = {};
  if(weeklyApps.length) {
    weeklyApps.forEach(a => {
      const cat = pkgToCat[a.packageName] || 'Other';
      catMins[cat] = (catMins[cat]||0) + (a.weeklyMinutes||0);
    });
  } else {
    DAILY_USE.forEach(a => {
      const cat = pkgToCat[a.packageName]||'Other';
      catMins[cat] = (catMins[cat]||0) + (a.totalMinutes||0);
    });
  }
  _catMinsCache = catMins;
  _catMinsTs    = now;
  return catMins;
}

// Build per-day calendar cells from MONTHLY_DATA only.
// No WEEKLY fallback — we show only what queryEvents returned, no flicker.
function _buildMonthCalendarData() {
  const now      = new Date();
  const today    = now.getDate();
  const goalMins = S.streakGoalMins || 240;

  const byDay = {};
  MONTHLY_DATA.forEach(d => {
    const parts = (d.date || '').split('/');
    if (parts.length === 2) {
      const day = parseInt(parts[1]);
      byDay[day] = d.isToday ? Math.max(d.minutes || 0, TODAY_MINS) : (d.minutes || 0);
    }
  });

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const hasDayData = Object.prototype.hasOwnProperty.call(byDay, d);
    const mins       = hasDayData ? byDay[d] : 0;
    cells.push({
      day:      d,
      mins,
      isReal:   !!(hasDayData && mins > 0 && (d < today || (d === today && TODAY_MINS > 0))),
      isFuture: d > today,
      isToday:  d === today,
      isUnder:  hasDayData && mins > 0 && mins <= goalMins,
      isOver:   hasDayData && mins > goalMins,
    });
  }
  return cells;
}