/* ═══ app-home.js — Home tab: stats, insight banner, search, recent ════════
 * Split in Phase 4: Aurelo Score → app-home-score.js,
 *                   Sleep card   → app-home-sleep.js,
 *                   Categories   → app-categories.js
 * ════════════════════════════════════════════════════════════════════════════ */


/* ═══ FOUC PREVENTION — font-load guard ══════════════════════════════════
   Adds .fonts-ready to <body> once all webfonts have resolved.
   CSS rule `body:not(.fonts-ready) .screens { opacity:0 }` keeps screen
   content invisible until then, preventing the flash of fallback/unstyled
   text that occurs when Bodoni Moda hasn't arrived yet but the
   loading-screen has already faded out.
   Falls back instantly on browsers without FontFaceSet API so the app
   is never permanently hidden.                                            */
(function initFontGuard() {
  function markReady() { document.body.classList.add('fonts-ready'); }
  if (typeof document.fonts !== 'undefined' && document.fonts.ready) {
    document.fonts.ready.then(markReady);
  } else {
    markReady(); // Fallback: reveal immediately
  }
})();

/* ═══ QUICK STATS + HOME ARC ═════════════════════════ */
// Cache streak so we don't call into Kotlin on every 30s tick
let _cachedStreak = 0, _streakTs = 0;

// Arc path length: half-circle r=85 → π×85 ≈ 266.9
const _ARC_LEN = Math.PI * 85;

function renderQuickStats(){
  const goalMins = S.streakGoalMins || 240;

  // ── Text stat nodes ──────────────────────────────────
  const todayEl     = document.getElementById('qs-today');
  const pickupsEl   = document.getElementById('qs-pickups');
  const streakEl    = document.getElementById('qs-streak');
  if(todayEl)   todayEl.textContent   = fmtM(TODAY_MINS)||'–';
  if(pickupsEl) pickupsEl.textContent = PICKUPS > 0 ? PICKUPS : '–';

  // Streak — refresh at most once per minute
  const now = Date.now();
  if(IS_NATIVE && now - _streakTs > 60_000){
    try{ _cachedStreak = N.getStreakDays(goalMins); }catch(_){}
    _streakTs = now;
  }
  const streak = IS_NATIVE ? _cachedStreak : 0;
  if(streakEl) streakEl.textContent = streak > 0 ? `🔥 ${streak}` : '–';
  // Phase 5: show share button next to streak when active
  if (typeof renderStreakShareButton === 'function') renderStreakShareButton(streak);

  // ── Status line (top of card) ─────────────────────────
  const statusEl = document.getElementById('home-status-text');
  const statusWrapEl = document.getElementById('home-status-line');
  if(statusEl && statusWrapEl){
    const rawPct = goalMins > 0 ? TODAY_MINS / goalMins : 0;
    let icon = '✅', text = '', color = 'var(--g)';
    if(rawPct > 1.5){
      icon='🔴'; text=`${fmtM(TODAY_MINS - goalMins)} over goal — put it down`; color='var(--r)';
    } else if(rawPct > 1){
      icon='⚠️'; text=`${fmtM(TODAY_MINS - goalMins)} over your ${fmtM(goalMins)} goal`; color='var(--r)';
    } else if(rawPct >= .9){
      icon='🟡'; text=`Almost at goal — ${fmtM(goalMins - TODAY_MINS)} left`; color='var(--a)';
    } else if(streak >= 7){
      icon='🔥'; text=`${streak}-day streak — keep going!`; color='var(--a)';
    } else if(streak >= 3){
      icon='🔥'; text=`${streak}-day streak — you're building a habit!`; color='var(--p2)';
    } else if(streak > 0){
      icon='✅'; text=`${streak}-day streak — on track today`; color='var(--g)';
    } else if(TODAY_MINS === 0){
      const h = new Date().getHours();
      icon = h < 12 ? '☀️' : h < 17 ? '🌤' : '🌅';
      text = 'Fresh start — goal: stay under ' + fmtM(goalMins); color='var(--p2)';
    } else {
      icon='✅'; text=`On track — ${fmtM(goalMins - TODAY_MINS)} left today`; color='var(--g)';
    }
    statusEl.textContent = text;
    statusWrapEl.style.color = color;
    statusWrapEl.childNodes[0].textContent = icon + ' ';
  }

  // ── Arc fill ──────────────────────────────────────────
  const arcEl = document.getElementById('home-arc-fill');
  const barEl = document.getElementById('home-goal-fill');
  const pctEl = document.getElementById('home-goal-pct');
  const lblEl = document.getElementById('home-goal-label');
  if(arcEl){
    const rawPct   = goalMins > 0 ? TODAY_MINS / goalMins : 0;
    const fillPct  = Math.min(rawPct, 1);
    const filled   = fillPct * _ARC_LEN;
    const arcColor = rawPct > 1   ? 'var(--r)'
                   : rawPct >= 1  ? 'var(--a)'
                   : rawPct >= .8 ? 'var(--c)'
                   : 'var(--p)';
    arcEl.setAttribute('stroke', arcColor);
    arcEl.setAttribute('stroke-dasharray', filled + ' 999');
    if(barEl){
      barEl.style.width      = Math.min(rawPct * 100, 100) + '%';
      barEl.style.background = arcColor;
    }
    if(pctEl) pctEl.textContent = Math.round(rawPct * 100) + '%';
    if(lblEl){
      if(rawPct > 1)       lblEl.textContent = 'of ' + fmtM(goalMins) + ' goal · ' + fmtM(TODAY_MINS - goalMins) + ' over';
      else if(rawPct >= .9)lblEl.textContent = 'of ' + fmtM(goalMins) + ' goal · almost there!';
      else                 lblEl.textContent = 'of ' + fmtM(goalMins) + ' goal · tap for details →';
    }
  }

  // ── Category count badge ──────────────────────────────
  const totalApps = Object.values(CATS_MAP).reduce((n,a)=>n+a.length, 0);
  const badge = document.getElementById('cat-total-badge');
  if(badge){ badge.textContent = totalApps>0?totalApps+' apps':''; badge.style.display=totalApps>0?'':'none'; }
}

/* ─── Consolidated insight banner ───────────────────── */
const _INSIGHT_DISMISS_KEY = 'insight_dismissed_date';

// Restore dismissed date from persistent storage so the banner stays
// hidden across app restarts. Mirrors the dual-write pattern used by
// CHALLENGE_KEY: native SharedPrefs first (survives WebView cache clears),
// localStorage as fallback for demo / web mode.
function _loadInsightDismissedDate() {
  try {
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
        typeof N !== 'undefined' && N && typeof N.getStringPref === 'function') {
      return N.getStringPref(_INSIGHT_DISMISS_KEY) || '';
    }
  } catch (_) {}
  try { return localStorage.getItem(_INSIGHT_DISMISS_KEY) || ''; } catch (_) {}
  return '';
}

function _saveInsightDismissedDate(dateStr) {
  try {
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
        typeof N !== 'undefined' && N && typeof N.setStringPref === 'function') {
      N.setStringPref(_INSIGHT_DISMISS_KEY, dateStr);
    }
  } catch (_) {}
  try { localStorage.setItem(_INSIGHT_DISMISS_KEY, dateStr); } catch (_) {}
}

let _insightDismissedDate = _loadInsightDismissedDate();

function _computeInsightBanner(){
  const goalMins = S.streakGoalMins || 240;
  const rawPct   = goalMins > 0 ? TODAY_MINS / goalMins : 0;
  const streak   = _cachedStreak || 0;
  const h        = new Date().getHours();

  // Priority 1: streak at risk (streak > 3, pacing over goal, still time to correct)
  if(streak > 3 && h >= 14 && h <= 19 && TODAY_MINS > goalMins * 0.6){
    const dayMinutes = h * 60 + new Date().getMinutes();
    const projected  = dayMinutes > 0 ? (TODAY_MINS * 1440) / dayMinutes : TODAY_MINS;
    if(projected > goalMins){
      const overBy = Math.round(projected - goalMins);
      return {
        icon:'🔥', color:'var(--a)',
        title:`${streak}-day streak at risk`,
        body:`At this pace you'll finish ~${fmtM(overBy)} over goal. Put the phone down to protect your streak.`,
        cta:'See stats', action:()=>activateTab('wellness')
      };
    }
  }

  // Priority 2: over goal
  if(rawPct > 1){
    const overMin = TODAY_MINS - goalMins;
    return {
      icon:'⚠️', color:'var(--r)',
      title:`${fmtM(overMin)} over your ${fmtM(goalMins)} goal`,
      body:'Take a break — screens before bed affect sleep quality.',
      cta:'See stats', action:()=>activateTab('wellness')
    };
  }

  // Priority 3: streak milestone

  if([3,7,14,21,30].includes(streak)){
    // Rate app prompt — positive moment: user just hit a streak milestone
    if(IS_NATIVE && typeof N.checkAndTriggerRateApp === 'function'){
      try{ N.checkAndTriggerRateApp('streak_milestone'); }catch(_){}
    }
    return {
      icon:'🏆', color:'var(--g)',
      title:`${streak}-day streak — great work!`,
      body:`You've stayed under your ${fmtM(goalMins)} goal for ${streak} days in a row.`,
      cta: 'Share',
      action: () => shareCard('streak')
    };
  }

  // Priority 4: ghost apps
  if(GHOSTS.length >= 3){
    const totalMB = GHOSTS.reduce((s,g)=>s+(g.sizeMB||0),0);
    return {
      icon:'👻', color:'var(--pu)',
      title:`${GHOSTS.length} unused apps taking up ${totalMB} MB`,
      body:'Apps not opened in 30+ days. Uninstalling frees up storage.',
      cta:'Review', action:()=>openPanel('ghost-panel')
    };
  }

  return null; // nothing to show
}

function renderInsightBanner(){
  const banner = document.getElementById('home-insight-banner');
  if(!banner) return;

  // Respect daily dismiss
  const today = new Date().toISOString().slice(0,10);
  if(_insightDismissedDate === today){ banner.style.display='none'; return; }

  const data = _computeInsightBanner();
  if(!data){ banner.style.display='none'; return; }

  const iconEl  = document.getElementById('hib-icon');
  const titleEl = document.getElementById('hib-title');
  const bodyEl  = document.getElementById('hib-body');
  const ctaEl   = document.getElementById('hib-cta');
  if(iconEl)  iconEl.textContent  = data.icon;
  if(titleEl) titleEl.textContent = data.title;
  if(bodyEl)  bodyEl.textContent  = data.body;
  banner.style.borderColor = data.color;
  banner.style.display = '';
  if(ctaEl && data.cta){
    ctaEl.textContent  = data.cta + ' →';
    ctaEl.style.color  = data.color;
    ctaEl.style.display= '';
    ctaEl._action      = data.action;
  } else if(ctaEl){
    ctaEl.style.display = 'none';
  }
}

function onInsightBannerAction(){
  const ctaEl = document.getElementById('hib-cta');
  if(ctaEl && ctaEl._action) ctaEl._action();
}

function dismissInsightBanner(){
  const banner = document.getElementById('home-insight-banner');
  if(banner) banner.style.display = 'none';
  _insightDismissedDate = new Date().toISOString().slice(0,10);
  _saveInsightDismissedDate(_insightDismissedDate);
}

/* ─── Phase 2: Pro Insight Card (blur for free users) ─ */
/**
 * renderContextualInsight — renders the home insight card with Pro gating.
 * For free users: blurs the content, overlays a badge + 'tap to unlock'.
 * For Pro users: renders content cleanly.
 * The badge and overlay text are NEVER blurred.
 */
 function renderContextualInsight() {
   const el = document.getElementById('home-insight-card');
   if (!el) return;

   // Ensure streak is fresh before computing insight priorities
  if (IS_NATIVE) {
    try { _cachedStreak = N.getStreakDays(S.streakGoalMins || 240); } catch (_) {}
  }
  const insight = _computeInsightBanner();
  if (!insight) { el.style.display = 'none'; return; }

   // 1. Render the base content first (Pro version)
   el.style.display = 'flex';
   el.style.border = `1px solid ${insight.color}`;
   el.style.background = 'var(--s2)';
   el.style.marginBottom = '16px';
   el.style.marginTop = '16px';

   el.innerHTML = `
     <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;width:100%">
       <div style="font-size:18px;flex-shrink:0">${insight.icon}</div>
       <div style="flex:1;min-width:0">
         <div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:2px">${insight.title}</div>
         <div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.6">${insight.body}</div>
       </div>
       ${insight.cta ? `<div id="home-insight-cta">...</div>` : ''}
     </div>`;

   // 2. Apply the Pro Gate.
   // This will check ProTier.isPro internally and apply the blur/overlay if needed.
   ProTier.applyBlur(el, 'HOME_INSIGHT', 'Pro Insight — tap to unlock');

   // 3. Wire CTA (only if pro and cta exists)
   if (ProTier.isPro && insight.cta && insight.action) {
     const ctaEl = el.querySelector('#home-insight-cta');
     if (ctaEl) ctaEl.onclick = (e) => { e.stopPropagation(); insight.action(); };
   }
 }

/* ─── Phase 5: Streak share button ─────────────────── */
/**
 * renderStreakShareButton — injects a small share icon next to the streak
 * stat whenever the user has an active streak (>0). Called from renderQuickStats.
 * The button is lightweight: just an emoji button that calls shareCard('streak').
 */
function renderStreakShareButton(streak) {
  const streakEl = document.getElementById('qs-streak');
  if (!streakEl) return;
  // Remove old button to avoid duplicates on re-renders
  const old = document.getElementById('streak-share-btn');
  if (old) old.remove();
  if (streak <= 0) return;
  const btn = document.createElement('button');
  btn.id = 'streak-share-btn';
  btn.onclick = (e) => { e.stopPropagation(); shareCard('streak'); };
  btn.title = 'Share your streak';
  btn.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'width:24px',
    'height:24px',
    'border-radius:8px',
    'border:1px solid rgba(108,99,255,.3)',
    'background:rgba(108,99,255,.12)',
    'font-size:13px',
    'cursor:pointer',
    'margin-left:6px',
    'vertical-align:middle',
    'flex-shrink:0',
  ].join(';');
  btn.textContent = '📤';
  streakEl.insertAdjacentElement('afterend', btn);
}

/* ─── Time-slot routine header ──────────────────────── */
function _getCurrentSlotInfo(){
  const h = new Date().getHours();
  if(h>=6  && h<=8)  return {label:'☀️ Morning Routine',  sub:'Apps you typically open now',     color:'var(--a)'};
  if(h>=9  && h<=10) return {label:'🚌 Commute Time',     sub:'Your commute-hour apps',           color:'var(--c)'};
  if(h>=11 && h<=13) return {label:'🌤 Midday',           sub:'Your midday habits',               color:'var(--g)'};
  if(h>=14 && h<=16) return {label:'🌞 Afternoon',        sub:'Your afternoon picks',             color:'var(--c)'};
  if(h>=17 && h<=20) return {label:'🌅 Evening Routine',  sub:'Apps you open at this hour',       color:'var(--a)'};
  return                     {label:'🌙 Night',            sub:'Your late-night apps',             color:'var(--pu)'};
}

function _renderRoutineHeader(){
  const slot    = _getCurrentSlotInfo();
  const labelEl = document.getElementById('routine-slot-label');
  const subEl   = document.getElementById('routine-slot-sub');
  const badgeEl = document.getElementById('routine-learn-badge');
  if(labelEl){ labelEl.textContent = slot.label; labelEl.style.color = slot.color; }
  if(subEl)   subEl.textContent    = slot.sub;
  if(badgeEl){
    let days = 0;
    if(IS_NATIVE){
      try{ days = typeof N.getWidgetLearningDays==='function' ? N.getWidgetLearningDays() : 1; }catch(_){ days=1; }
    } else { days = 1; } // demo mode: always show Day 1
    const txt = days >= 21 ? `Based on ${days} days`
              : days >= 7  ? `Learnt · ${days} days`
              : days > 1   ? `Learning… ${days} days`
              : `Learning… Day 1`;
    badgeEl.textContent   = txt;
    badgeEl.style.display = '';
    badgeEl.style.color   = slot.color;
    badgeEl.style.borderColor = slot.color.replace('var(--','').replace(')','');
  }
}

/* ═══ ICON HELPERS ═══════════════════════════════════ */
function appIco(pkg,size=46,r=0){
  r=r||Math.round(size*.3);
  if(!pkg) return `<div style="font-size:${Math.round(size*.55)}px">📱</div>`;
  const emoji=DEMO_EMOJI[pkg]||'📱';
  if(IS_NATIVE){
    return `<img loading="lazy" decoding="async" src="app-icon://${pkg}" style="width:100%;height:100%;border-radius:${r}px;object-fit:cover;display:block" onerror="this.outerHTML='<div style=font-size:${Math.round(size*.55)}px>${emoji}</div>'"/>`;
  }
  return emoji;
}
function icoDiv(pkg,size=46){
  const r=Math.round(size*.3);
  return `<div style="width:${size}px;height:${size}px;border-radius:${r}px;overflow:hidden;background:var(--s2);display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*.55)}px;flex-shrink:0">${appIco(pkg,size,r)}</div>`;
}

/* ═══ SEARCH ══════════════════════════════════════════ */
// Cache all-apps list so search is fast
let _allAppsCache = null;
function getAllAppsForSearch(){
  if(!_allAppsCache){
    _allAppsCache = IS_NATIVE ? (() => { try{ return JSON.parse(N.getAllApps()||'[]'); }catch(e){ return []; } })() : Object.values(CATS_MAP).flat();
  }
  return _allAppsCache;
}

function clearSearch(){
  const inp = document.getElementById('search-input');
  const drop = document.getElementById('search-drop');
  if(inp) inp.value='';
  if(drop) drop.style.display='none';
  _allAppsCache = null;
}

// ── Touch-drag from search result → category tile (fix #11) ─────────────────
// Android WebView doesn't fire HTML5 dragover/drop on touch — we implement it manually
let _tdrag = null; // { pkg, name, ghost, startX, startY }

// Called whenever a cross-category move is cancelled (drop on non-tile area, or tap anywhere)
function _cancelCrossMove(showToast) {
  let cancelled = false;
  if (_tdrag) {
    _tdrag.ghost && _tdrag.ghost.remove();
    _tdrag = null;
    cancelled = true;
  }
  if (window._cpPickDragging) {
    window._cpPickDragging = false;
    const g = document.getElementById('xdrag-ghost') || document.getElementById('_cpPickGhostEl');
    if (g) g.remove();
    cancelled = true;
  }
  clearCatHighlights();
  if (cancelled && showToast) toast('Move cancelled', 'info', 1000);
}

// Document-level listener: cancel cross-cat move when finger lifts outside a cat-tile
document.addEventListener('touchend', e => {
  if (!_tdrag && !window._cpPickDragging) return;
  const t = e.changedTouches[0];
  const onTile = document.elementFromPoint(t.clientX, t.clientY)?.closest('.cat-exp-card[data-cat],.cat-col-card[data-cat],.cat-row[data-cat]');
  if (!onTile) _cancelCrossMove(true);
}, { passive: true });

// Also cancel on any tap/click outside cat-tiles while a move is pending
document.addEventListener('touchstart', e => {
  if (!_tdrag && !window._cpPickDragging) return;
  // We only cancel here if it's a NEW touch (not the active drag touch)
  if (e.touches.length > 1) { _cancelCrossMove(true); }
}, { passive: true });
function attachTouchDragToSearchRow(row, pkg, name){
  let pressTimer=null, dragging=false;

  row.addEventListener('touchstart', e=>{
    const t=e.touches[0];
    pressTimer=setTimeout(()=>{
      dragging=true;
      navigator.vibrate&&navigator.vibrate(30);
      // Create floating ghost
      const ghost=document.createElement('div');
      ghost.style.cssText='position:fixed;z-index:9999;pointer-events:none;'
        +'background:var(--s1);border:2px solid var(--p);border-radius:12px;padding:8px 14px;'
        +'font-size:13px;font-weight:600;color:var(--t1);box-shadow:0 8px 24px rgba(0,0,0,.5);'
        +'white-space:nowrap;opacity:.92;transition:none';
      ghost.textContent='📦 '+name;
      document.body.appendChild(ghost);
      positionGhost(ghost, t.clientX, t.clientY);
      _tdrag={pkg,name,ghost};
      // Hide search dropdown
      document.getElementById('search-drop').style.display='none';
    },350);
  },{passive:true});

  row.addEventListener('touchmove', e=>{
    if(!dragging||!_tdrag) return;
    e.preventDefault();
    const t=e.touches[0];
    positionGhost(_tdrag.ghost, t.clientX, t.clientY);
    highlightCatUnder(t.clientX, t.clientY);
    _asUpdate(t.clientY, document.getElementById('screen-home'));
  },{passive:false});

  row.addEventListener('touchend', e=>{
    clearTimeout(pressTimer);
    _asStop();
    if(!dragging||!_tdrag){ dragging=false; return; }
    dragging=false;
    window._cpPickDragging = false;
    const t=e.changedTouches[0];
    const cat=findCatAt(t.clientX, t.clientY);
    const {pkg:p, name:n}=_tdrag;
    _tdrag.ghost.remove(); _tdrag=null;
    clearCatHighlights();
    if(cat){
      assignAppToCategory(p, cat);
      scheduleGridRefresh();
      clearSearch();
      toast(n+' → '+cat,'success');
    } else {
      toast('Move cancelled','info',1000);
    }
  },{passive:true});

  row.addEventListener('touchcancel', ()=>{
    clearTimeout(pressTimer);
    _asStop();
    if(_tdrag){ _tdrag.ghost.remove(); clearCatHighlights(); _tdrag=null; }
    dragging=false;
  },{passive:true});
}

function positionGhost(ghost, x, y){
  ghost.style.left=(x-60)+'px';
  ghost.style.top=(y-25)+'px';
}

function findCatAt(x, y){
  const tiles=document.querySelectorAll('.cat-exp-card[data-cat],.cat-col-card[data-cat],.cat-row[data-cat]');
  for(const t of tiles){
    const r=t.getBoundingClientRect();
    if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom) return t.dataset.cat;
  }
  return null;
}

function highlightCatUnder(x, y){
  clearCatHighlights();
  const tiles=document.querySelectorAll('.cat-exp-card[data-cat],.cat-col-card[data-cat],.cat-row[data-cat]');
  for(const t of tiles){
    const r=t.getBoundingClientRect();
    if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom){
      t.style.boxShadow='inset 0 0 0 2.5px var(--p)';
      t.dataset.tdHighlight='1';
      break;
    }
  }
}

function clearCatHighlights(){
  document.querySelectorAll('.cat-exp-card,.cat-col-card,.cat-row').forEach(t=>{
    t.style.boxShadow='';
    t.style.transform='';
    t.style.borderColor='';
    t.style.background='';
    t.classList.remove('xdrop-target','xdrop-active','xdrop-idle');
    delete t.dataset.tdHighlight;
  });
}

function onSearch(val){
  const drop=document.getElementById('search-drop');
  if(!val.trim()){ drop.style.display='none'; return; }
  const q=val.toLowerCase();
  const all=getAllAppsForSearch();
  const hidden=new Set(S.hiddenPkgs||[]);

  // Build usage map: pkg → totalMinutes today
  const usageMap={};
  DAILY_USE.forEach(u=>{ usageMap[u.packageName]=u.totalMinutes||0; });
  const totalUsageToday=Math.max(TODAY_MINS||1,1);

  // Score each match: exact start > contains; then weight by usage
  const matches=all
    .filter(a=>!hidden.has(a.packageName)&&a.name.toLowerCase().includes(q))
    .map(a=>{
      const n=a.name.toLowerCase();
      const startBonus=n.startsWith(q)?200:0;
      const wordBonus=n.split(/\W/).some(w=>w.startsWith(q))?100:0;
      const usageMins=usageMap[a.packageName]||0;
      const usageBonus=Math.min(usageMins,180); // cap at 3h
      return {...a, _score:startBonus+wordBonus+usageBonus, _usageMins:usageMins};
    })
    .sort((a,b)=>b._score-a._score);

  if(!matches.length){ drop.style.display='none'; return; }
  drop.style.display='block';

  // Highlight matching text in name
  function hlName(name){
    // SEC-07 FIX: escape name before inserting into innerHTML to prevent XSS
    const safe = escHtml(name);
    const safeQ = escHtml(q);
    const idx = safe.toLowerCase().indexOf(safeQ.toLowerCase());
    if(idx<0) return safe;
    return safe.slice(0,idx)
      +'<span style="color:var(--acc,#7C6FFF);font-weight:700">'+safe.slice(idx,idx+safeQ.length)+'</span>'
      +safe.slice(idx+safeQ.length);
  }

  // Usage time label
  function usageLbl(mins){
    if(!mins) return '';
    const h=Math.floor(mins/60),m=mins%60;
    const t=h>0?(m>0?h+'h '+m+'m':h+'h'):m+'m';
    return '<span style="color:#12D48A">'+t+' today</span>';
  }

  // Frequency score as % of today's screen time (proxy for habit strength)
  function freqLbl(mins){
    if(!mins||!totalUsageToday) return '';
    const pct=Math.round((mins/totalUsageToday)*100);
    if(pct<1) return '';
    const col=pct>=15?'#12D48A':pct>=7?'#5DD6F8':'#F7A623';
    return '<span style="color:'+col+';font-weight:700;margin-left:6px">'+pct+'%</span>';
  }

  const top=matches.slice(0,7);
  drop.innerHTML=top.map((a,i)=>`
    <div class="sdr" draggable="true" style="${i===0?'background:rgba(124,111,255,.10);border-radius:10px;':''}"
      ondragstart="event.dataTransfer.setData('pkg','${escAttr(a.packageName)}');event.dataTransfer.setData('name','${escAttr(a.name)}');setTimeout(clearSearch,0)"
      onclick="launchApp('${escAttr(a.packageName)}','${escAttr(a.name)}');clearSearch()"
      data-pkg="${escAttr(a.packageName)}" data-name="${escAttr(a.name)}">
      <div class="sdr-icon">${appIco(a.packageName,34)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${hlName(a.name)}</div>
        <div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);display:flex;align-items:center;gap:2px;margin-top:1px">
          ${usageLbl(a._usageMins)}${freqLbl(a._usageMins)}
          ${!a._usageMins?'<span style="color:var(--t3)">Not used today</span>':''}
        </div>
      </div>
      <div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);padding:0 4px">⠿</div>
    </div>`).join('');

  // Wire touch-drag for Android (HTML5 drag doesn't work on touch)
  drop.querySelectorAll('.sdr[data-pkg]').forEach(row=>{
    attachTouchDragToSearchRow(row, row.dataset.pkg, row.dataset.name);
  });
  if(val.length===1) _allAppsCache=null;
}
document.addEventListener('click',e=>{ if(!e.target.closest('#search-drop')&&!e.target.closest('#search-input')){ clearSearch(); } });

/* ═══ FIRST-RUN SNAPSHOT CARD ════════════════════════ */
/**
 * renderFirstRunCard — shown once after onboarding completes.
 * Builds a contextual message from the top app in DAILY_USE if available,
 * otherwise falls back to a generic app count message.
 * Only called when _isFirstBoot===true and !S.firstRunCardDone.
 */
function renderFirstRunCard() {
  const card = document.getElementById('first-run-card');
  if (!card) return;
  if (S.firstRunCardDone) { card.style.display = 'none'; return; }

  const iconEl  = document.getElementById('frc-icon');
  const titleEl = document.getElementById('frc-title');
  const bodyEl  = document.getElementById('frc-body');

  // Link the card to your existing Pro Upsell logic
  card.onclick = () => {
    if (typeof ProUpsell !== 'undefined') {
      ProUpsell.show('upgrade_pro');
    } else {
      // Fallback if ProUpsell isn't loaded yet
      openPanel('settings-panel');
    }
  };

  if (DAILY_USE.length > 0) {
    // OPTION: DATA-DRIVEN INSIGHT
    const top = DAILY_USE[0];
    iconEl.textContent  = '💎';
    titleEl.textContent = 'Unlock Deep Insights';
    bodyEl.textContent  = `${top.name} is leading your trends today. Unlock Pro to see your Monthly View, analyze your App DNA, and use Hard Mode to stay intentional`;
  } else {
    // OPTION: UTILITY/AESTHETIC PITCH
    iconEl.textContent  = '🚀';
    titleEl.textContent = 'Supercharge Your Focus';
    bodyEl.textContent  = 'Take total control of your digital space. Upgrade to Pro for custom categories, smart widgets, and advanced focus tools designed for deep work.';
  }

  card.style.display = 'flex';
  card.style.cursor = 'pointer'; // Visual cue that it's interactive
  card.style.border = '1px dashed var(--p)'; // Dashed purple border implies "Unlockable"
  card.style.background = 'linear-gradient(135deg, rgba(108,99,255,0.08), transparent)';
}

/* ═══ RECENT / ROUTINE CHIPS ══════════════════════════ */
function renderRecent(){
  _renderRoutineHeader();
  const wrap = document.getElementById('recent-row');
  if(!wrap) return;
  const hidden = new Set(S.hiddenPkgs || []);

  // Build usage map
  const usageMap = {};
  DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes || 0; });
  const totalMins = Math.max(TODAY_MINS || 1, 1);

  // Source: today's usage sorted by time, fallback to CATS_MAP order
  const usageFiltered = DAILY_USE.filter(a => !hidden.has(a.packageName));
  const allCatApps    = Object.values(CATS_MAP).flat().filter(a => !hidden.has(a.packageName));
  const source = usageFiltered.length
    ? usageFiltered.slice(0, 8)
    : allCatApps.slice(0, 8).map(a => ({name:a.name, packageName:a.packageName, totalMinutes:0}));

  wrap.innerHTML = source.map(a => {
    const mins    = usageMap[a.packageName] || a.totalMinutes || 0;
    const timeStr = mins > 0 ? fmtM(mins) : '';
    return `<div class="rc" onclick="launchApp('${escAttr(a.packageName)}','${escAttr(a.name)}')">
      <div class="rc-icon">${appIco(a.packageName, 52, 14)}</div>
      <div class="rc-lbl">${escHtml(a.name)}</div>
      ${timeStr ? `<div class="rc-time">${timeStr}</div>` : '<div class="rc-time" style="opacity:0">·</div>'}
    </div>`;
  }).join('');
}

/* ═══ GHOST BANNER → INSIGHT BANNER ═════════════════ */
function renderGhostBanner(){
  // Keep ghost-banner stub hidden (backward compat)
  const stub = document.getElementById('ghost-banner');
  if(stub) stub.style.display='none';
  // Drive the consolidated insight banner instead
 // renderInsightBanner() is called separately by renderAll() — no call needed here
}

/* ═══ PLAY STORE SYNC — Phase 4 ══════════════════════ */
/**
 * getPlaySyncStatus — checks whether the current user can trigger a Play Store sync.
 * Manual sync is Pro-only per the strategy document.
 */
function getPlaySyncStatus() {
  const isPro = ProTier.isPro;
  if (!isPro) return { canSync: false, reason: 'pro_required' };
  return { canSync: true };
}

/**
 * startPlaySync — Pro-gated. Call before the network/bridge sync call.
 * Shows ProTier.triggerUpsell() paywall for free users; proceeds with sync for Pro.
 */
function startPlaySync() {
  const status = getPlaySyncStatus();
  if (!status.canSync) {
    ProTier.triggerUpsell('UNLIMITED_CATEGORIES');
    return;
  }
  // Trigger the actual sync via bridge
  if (IS_NATIVE && typeof nCall === 'function') {
    toast('Syncing categories from Play Store…', 'info');
    nCall('startPlaySync');
  } else {
    toast('Play Store sync not available in demo mode', 'info');
  }
}

/**
 * onPlaySyncComplete — called by the bridge when Play Store sync finishes.
 * Uses "you're in control" framing from the strategy document.
 * @param {number} updatedCount  Number of app categories updated.
 */
function onPlaySyncComplete(updatedCount) {
  toast(`✓ ${updatedCount} categories updated — you're in control`, 'success', 3500);
  try { localStorage.setItem('lastPlaySync', String(Date.now())); } catch(_) {}
  if (typeof updatePlaySyncSubtitle === 'function') updatePlaySyncSubtitle();
}