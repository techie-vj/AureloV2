/* ═══ app-home.js — Home tab: stats, insight banner, search, recent ════════
 * Split in Phase 4: Aurelo Score → app-home-score.js,
 *                   Sleep card   → app-home-sleep.js,
 *                   Categories   → app-categories.js
 * v2.1 PREMIUM REDESIGN changes:
 *   • Section labels injected above dynamic rows, coach card, routine row
 *   • "Based on your habits" sub-label on routine section
 *   • renderCulpritsSection() uses CSS classes (culprit-row etc.)
 *   • renderCategorySummary() uses CSS classes (cat-row etc.)
 *   • Dynamic label: "TODAY'S CULPRITS" → "TOP APPS TODAY" / "WATCH THESE" / "MOST USED"
 * ════════════════════════════════════════════════════════════════════════════ */


/* ═══ FOUC PREVENTION — font-load guard ══════════════════════════════════ */
(function initFontGuard() {
  function markReady() { document.body.classList.add('fonts-ready'); }
  if (typeof document.fonts !== 'undefined' && document.fonts.ready) {
    document.fonts.ready.then(markReady);
  } else {
    markReady();
  }
})();

/* ═══ SECTION LABEL INJECTOR ═════════════════════════════════════════════
 * Inserts a .home-section-hdr label div immediately before a target element
 * if it doesn't already exist. Idempotent — safe to call on every render.
 * ════════════════════════════════════════════════════════════════════════ */
function _ensureSectionLabel(targetId, labelId, titleText, subText, actionHtml) {
  var target = document.getElementById(targetId);
  if (!target) return;
  var existing = document.getElementById(labelId);
  if (existing) {
    // Update text in case it changed (e.g. culprits label is dynamic)
    var t = existing.querySelector('.home-section-title');
    var s = existing.querySelector('.home-section-sub');
    if (t && titleText) t.textContent = titleText;
    if (s && subText !== undefined) s.textContent = subText;
    return;
  }
  var hdr = document.createElement('div');
  hdr.id        = labelId;
  hdr.className = 'home-section-hdr';
  hdr.innerHTML =
    '<div>' +
      '<div class="home-section-title">' + (titleText || '') + '</div>' +
      (subText ? '<div class="home-section-sub">' + subText + '</div>' : '') +
    '</div>' +
    (actionHtml ? '<div>' + actionHtml + '</div>' : '');
  target.parentNode.insertBefore(hdr, target);
}

/* ═══ QUICK STATS + HOME PROGRESS STRIP ══════════════ */
let _cachedStreak = 0, _streakTs = 0;
const _ARC_LEN = Math.PI * 85;

function renderQuickStats(){
  const goalMins = S.streakGoalMins || 240;

  const todayEl   = document.getElementById('qs-today');
  const pickupsEl = document.getElementById('qs-pickups');
  const streakEl  = document.getElementById('qs-streak');
  if(todayEl)   todayEl.textContent   = fmtM(TODAY_MINS)||'–';
  if(pickupsEl) pickupsEl.textContent = PICKUPS > 0 ? PICKUPS : '–';

  const now = Date.now();
  if(IS_NATIVE && now - _streakTs > 60_000){
    try{ _cachedStreak = N.getStreakDays(goalMins); }catch(_){}
    _streakTs = now;
  }
  const streak = IS_NATIVE ? _cachedStreak : 0;
  if(streakEl) streakEl.textContent = streak > 0 ? `🔥 ${streak}` : '–';
  if (typeof renderStreakShareButton === 'function') renderStreakShareButton(streak);

  const statusEl     = document.getElementById('home-status-text');
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

  const arcEl = document.getElementById('home-arc-fill');
  const barEl = document.getElementById('home-goal-fill');
  const pctEl = document.getElementById('home-goal-pct');
  const lblEl = document.getElementById('home-goal-label');
  {
    const rawPct  = goalMins > 0 ? TODAY_MINS / goalMins : 0;
    const fillPct = Math.min(rawPct, 1);
    const filled  = fillPct * _ARC_LEN;
    const accent  = rawPct > 1   ? 'var(--r)'
                  : rawPct >= 1  ? 'var(--a)'
                  : rawPct >= .8 ? 'var(--c)'
                  : 'var(--p)';
    if(arcEl){
      arcEl.setAttribute('stroke', accent);
      arcEl.setAttribute('stroke-dasharray', filled + ' 999');
    }
    if(barEl){
      barEl.style.width      = Math.min(rawPct * 100, 100) + '%';
      barEl.style.background = accent;
    }
    if(pctEl) pctEl.textContent = Math.round(rawPct * 100) + '%';
    if(lblEl){
      if(rawPct > 1)        lblEl.textContent = 'of ' + fmtM(goalMins) + ' goal · ' + fmtM(TODAY_MINS - goalMins) + ' over';
      else if(rawPct >= .9) lblEl.textContent = 'of ' + fmtM(goalMins) + ' goal · almost there';
      else                  lblEl.textContent = 'of ' + fmtM(goalMins) + ' goal · tap for details';
    }
  }

  const totalApps = Object.values(CATS_MAP).reduce((n,a)=>n+a.length, 0);
  const badge = document.getElementById('cat-total-badge');
  if(badge){ badge.textContent = totalApps>0?totalApps+' apps':''; badge.style.display=totalApps>0?'':'none'; }
}

/* ─── Inject section labels for dynamic rows + coach card ─ */
function _renderHomeSectionLabels() {
  // 1. Handle "Active Reminders" (Focus OR Habits)
  var focusDyn  = document.getElementById('home-focus-dynamic');
  var habitsDyn = document.getElementById('home-habits-dynamic');
  var remindersLabelId = 'home-reminders-sec-label';

  // Check if Focus exists and has children
  var hasFocus = focusDyn && focusDyn.children.length > 0;
  // Check if Habits exists and has children
  var hasHabits = habitsDyn && habitsDyn.children.length > 0;

  if (hasFocus || hasHabits) {
    // We inject above focus-dynamic specifically as it's the top-most row
    _ensureSectionLabel(
      'home-focus-dynamic',
      remindersLabelId,
      'Active Reminders',
      ''
    );
  } else {
    _removeSectionLabel(remindersLabelId);
  }

  // 2. Handle "Coach Insight"
  var coachCard = document.getElementById('coach-home-insight');
  var coachLabelId = 'home-coach-sec-label';

  var hasCoachContent = coachCard &&
                        coachCard.style.display !== 'none' &&
                        coachCard.innerText.trim().length > 0;

  if (hasCoachContent) {
    _ensureSectionLabel(
      'coach-home-insight',
      coachLabelId,
      'Coach Insight',
      ''
    );
  } else {
    _removeSectionLabel(coachLabelId);
  }
}

/**
 * Helper to remove a label if it exists
 */
function _removeSectionLabel(labelId) {
  var label = document.getElementById(labelId);
  if (label) label.remove();
}

/* ─── Consolidated insight banner ───────────────────── */
const _INSIGHT_DISMISS_KEY = 'insight_dismissed_date';

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

  // ── Priority 0: Sunday Weekly Recap banner (PRO only) ──────────────────
  // Highest priority — only fires once per week on Sunday, dismissing it
  // permanently for the week via WeeklyRecapBridge.setWeeklyRecapDismissed().
  if (IS_NATIVE && typeof ProTier !== 'undefined' && ProTier.isPro) {
    try {
      if (typeof N !== 'undefined' &&
          typeof N.shouldShowWeeklyBanner === 'function' &&
          N.shouldShowWeeklyBanner()) {
        return {
          icon: '🏁',
          color: 'var(--p)',
          title: 'Your week is ready',
          body: 'See your Aurelo Score average, top apps, and your weekly summary.',
          cta: 'View recap',
          action: () => {
            if (typeof WeeklyRecap !== 'undefined') WeeklyRecap.open();
          },
          onDismiss: () => {
            try {
              if (typeof N.getCurrentIsoWeekYear === 'function' &&
                  typeof N.setWeeklyRecapDismissed === 'function') {
                N.setWeeklyRecapDismissed(N.getCurrentIsoWeekYear());
              }
            } catch(_) {}
          }
        };
      }
    } catch(_) {}
  }

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

  if(rawPct > 1){
    const overMin = TODAY_MINS - goalMins;
    return {
      icon:'⚠️', color:'var(--r)',
      title:`${fmtM(overMin)} over your ${fmtM(goalMins)} goal`,
      body:'Take a break — screens before bed affect sleep quality.',
      cta:'See stats', action:()=>activateTab('wellness')
    };
  }

  if([3,7,14,21,30].includes(streak)){
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

  if(GHOSTS.length >= 3){
    const totalMB = GHOSTS.reduce((s,g)=>s+(g.sizeMB||0),0);
    return {
      icon:'👻', color:'var(--pu)',
      title:`${GHOSTS.length} unused apps taking up ${totalMB} MB`,
      body:'Apps not opened in 30+ days. Uninstalling frees up storage.',
      cta:'Review', action:()=>openPanel('ghost-panel')
    };
  }

  // Priority 4: Referral nudge — shown to both free AND Pro users, max once per week
  // Pro users are the best advocates so we extend the banner to them too.
  if (typeof Referral !== 'undefined' && Referral.shouldShowHomeBanner()) {
    const isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    // For free users: don't compete with other high-priority banners shown above
    // For Pro users: they won't see the other banners so referral is always eligible
    if (isPro || true) { // always eligible when no other banner matched above
      return {
        icon:'🎁', color:'var(--g)',
        title: isPro ? 'Enjoying Pro? Give a friend 21 days free →' : 'Know someone who\'d love Aurelo?',
        body: isPro
          ? 'Share your referral link — your friend gets 21 days Pro free, you earn when they subscribe.'
          : 'Your friend gets 21 free Pro days. You earn Pro time when they subscribe.',
        cta:'Share link',
        action: () => {
          Referral.markBannerShown();
          Referral.open();
        }
      };
    }
  }

  return null;
}

function renderInsightBanner(){
  const banner = document.getElementById('home-insight-banner');
  if(!banner) return;

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

  // Softer amber border for advisory, red for over-goal
  const borderColor = data.color === 'var(--r)'
    ? 'rgba(240,78,122,.3)'
    : 'rgba(247,166,35,.3)';
  banner.style.borderColor = borderColor;
  banner.style.display = '';
  banner._action = typeof data.action === 'function' ? data.action : null;
  banner._onDismiss = typeof data.onDismiss === 'function' ? data.onDismiss : null;
  banner.setAttribute('role', banner._action ? 'button' : 'status');
  banner.setAttribute('tabindex', banner._action ? '0' : '-1');
  banner.setAttribute('aria-label', data.cta
    ? (data.title + '. ' + data.body + '. ' + data.cta)
    : (data.title + '. ' + data.body));
  banner.classList.toggle('is-clickable', !!banner._action);
  banner.style.setProperty('--hib-accent', data.color || 'var(--p)');

  if(ctaEl) ctaEl.style.display = 'none';
}

function onInsightBannerAction(){
  const banner = document.getElementById('home-insight-banner');
  if(banner && banner._action) banner._action();
}

function onInsightBannerKeydown(ev){
  if(ev.key === 'Enter' || ev.key === ' '){
    ev.preventDefault();
    onInsightBannerAction();
  }
}

function dismissInsightBanner(){
  const banner = document.getElementById('home-insight-banner');
  if(banner) {
    // Fire type-specific dismiss callback (e.g. weekly recap sets native dismiss flag)
    if(typeof banner._onDismiss === 'function') {
      try { banner._onDismiss(); } catch(_) {}
    }
    banner.style.display = 'none';
  }
  _insightDismissedDate = new Date().toISOString().slice(0,10);
  _saveInsightDismissedDate(_insightDismissedDate);
}

/* ─── Phase 2: Pro Insight Card ──────────────────────── */
function renderContextualInsight() {
  const el = document.getElementById('home-insight-card');
  if (!el) return;

  if (IS_NATIVE) {
    try { _cachedStreak = N.getStreakDays(S.streakGoalMins || 240); } catch (_) {}
  }
  const insight = _computeInsightBanner();
  if (!insight) { el.style.display = 'none'; return; }

  el.style.display = 'flex';
  el.style.border  = `1px solid ${insight.color}`;
  el.style.background = 'var(--s2)';
  el.style.marginBottom = '16px';
  el.style.marginTop    = '16px';

  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;width:100%">
      <div style="font-size:18px;flex-shrink:0">${insight.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:2px">${insight.title}</div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);line-height:1.6">${insight.body}</div>
      </div>
      ${insight.cta ? `<div id="home-insight-cta">...</div>` : ''}
    </div>`;

  ProTier.applyBlur(el, 'HOME_INSIGHT', 'Pro Insight — tap to unlock');

  if (ProTier.isPro && insight.cta && insight.action) {
    const ctaEl = el.querySelector('#home-insight-cta');
    if (ctaEl) ctaEl.onclick = (e) => { e.stopPropagation(); insight.action(); };
  }
}

/* ─── Phase 5: Streak share button ─────────────────── */
function renderStreakShareButton(streak) {
  const streakEl = document.getElementById('qs-streak');
  if (!streakEl) return;
  const old = document.getElementById('streak-share-btn');
  if (old) old.remove();
  if (streak <= 0) return;
  const btn = document.createElement('button');
  btn.id = 'streak-share-btn';
  btn.onclick = (e) => { e.stopPropagation(); shareCard('streak'); };
  btn.title = 'Share your streak';
  btn.style.cssText = [
    'display:inline-flex','align-items:center','justify-content:center',
    'width:24px','height:24px','border-radius:8px',
    'border:1px solid rgba(108,99,255,.3)','background:rgba(108,99,255,.12)',
    'font-size:13px','cursor:pointer','margin-left:6px',
    'vertical-align:middle','flex-shrink:0',
  ].join(';');
  btn.textContent = '📤';
  streakEl.insertAdjacentElement('afterend', btn);
}

/* ─── Time-slot routine header ──────────────────────── */
function _getCurrentSlotInfo(){
  const h = new Date().getHours();
  if(h>=6  && h<=8)  return {label:'☀️ Morning Routine', sub:'Your morning habits',       color:'var(--a)'};
  if(h>=9  && h<=10) return {label:'🚌 Commute Time',    sub:'Your commute-hour apps',     color:'var(--c)'};
  if(h>=11 && h<=13) return {label:'🌤 Midday',          sub:'Your midday habits',         color:'var(--g)'};
  if(h>=14 && h<=16) return {label:'🌞 Afternoon',       sub:'Your afternoon picks',       color:'var(--c)'};
  if(h>=17 && h<=20) return {label:'🌅 Evening Routine', sub:'Your evening habits',        color:'var(--a)'};
  return                    {label:'🌙 Night',           sub:'Your late-night apps',       color:'var(--pu)'};
}

function _renderRoutineHeader(){
  const slot    = _getCurrentSlotInfo();
  const labelEl = document.getElementById('routine-slot-label');
  const subEl   = document.getElementById('routine-slot-sub');
  const badgeEl = document.getElementById('routine-learn-badge');

  if(labelEl){ labelEl.textContent = slot.label; labelEl.style.color = slot.color; }

  // v2.1: sub shows time-slot description AND "based on your habits" hint
  if(subEl){
    subEl.textContent = slot.sub;
  }

  if(badgeEl){
    let days = 0;
    if(IS_NATIVE){
      try{ days = typeof N.getWidgetLearningDays==='function' ? N.getWidgetLearningDays() : 1; }catch(_){ days=1; }
    } else { days = 1; }
    const txt = days >= 21 ? `Based on your habits`
              : days >= 7  ? `Learnt · ${days} days`
              : days > 1   ? `Learning… ${days} days`
              : `Learning… Day 1`;
    badgeEl.textContent   = txt;
    badgeEl.style.display = '';
    badgeEl.style.color   = slot.color;
    // Set border via inline style using the CSS variable value
    badgeEl.style.borderColor = 'currentColor';
    badgeEl.style.opacity     = '0.85';
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
let _allAppsCache = null;
function getAllAppsForSearch(){
  if(!_allAppsCache){
    _allAppsCache = IS_NATIVE ? (() => { try{ return JSON.parse(N.getAllApps()||'[]'); }catch(e){ return []; } })() : Object.values(CATS_MAP).flat();
  }
  return _allAppsCache;
}

function clearSearch(){
  const inp  = document.getElementById('search-input');
  const drop = document.getElementById('search-drop');
  if(inp)  inp.value='';
  if(drop) drop.style.display='none';
  _allAppsCache = null;
}

let _tdrag = null;

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

document.addEventListener('touchend', e => {
  if (!_tdrag && !window._cpPickDragging) return;
  const t = e.changedTouches[0];
  const onTile = document.elementFromPoint(t.clientX, t.clientY)?.closest('.cat-exp-card[data-cat],.cat-col-card[data-cat],.cat-row[data-cat]');
  if (!onTile) _cancelCrossMove(true);
}, { passive: true });

document.addEventListener('touchstart', e => {
  if (!_tdrag && !window._cpPickDragging) return;
  if (e.touches.length > 1) { _cancelCrossMove(true); }
}, { passive: true });

function attachTouchDragToSearchRow(row, pkg, name){
  let pressTimer=null, dragging=false;

  row.addEventListener('touchstart', e=>{
    const t=e.touches[0];
    pressTimer=setTimeout(()=>{
      dragging=true;
      navigator.vibrate&&navigator.vibrate(30);
      const ghost=document.createElement('div');
      ghost.style.cssText='position:fixed;z-index:9999;pointer-events:none;'
        +'background:var(--s1);border:2px solid var(--p);border-radius:12px;padding:8px 14px;'
        +'font-size:13px;font-weight:600;color:var(--t1);box-shadow:0 8px 24px rgba(0,0,0,.5);'
        +'white-space:nowrap;opacity:.92;transition:none';
      ghost.textContent='📦 '+name;
      document.body.appendChild(ghost);
      positionGhost(ghost, t.clientX, t.clientY);
      _tdrag={pkg,name,ghost};
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

  const usageMap={};
  DAILY_USE.forEach(u=>{ usageMap[u.packageName]=u.totalMinutes||0; });
  const totalUsageToday=Math.max(TODAY_MINS||1,1);

  const matches=all
    .filter(a=>!hidden.has(a.packageName)&&a.name.toLowerCase().includes(q))
    .map(a=>{
      const n=a.name.toLowerCase();
      const startBonus=n.startsWith(q)?200:0;
      const wordBonus=n.split(/\W/).some(w=>w.startsWith(q))?100:0;
      const usageMins=usageMap[a.packageName]||0;
      const usageBonus=Math.min(usageMins,180);
      return {...a, _score:startBonus+wordBonus+usageBonus, _usageMins:usageMins};
    })
    .sort((a,b)=>b._score-a._score);

  if(!matches.length){ drop.style.display='none'; return; }
  drop.style.display='block';

  function hlName(name){
    const safe  = escHtml(name);
    const safeQ = escHtml(q);
    const idx   = safe.toLowerCase().indexOf(safeQ.toLowerCase());
    if(idx<0) return safe;
    return safe.slice(0,idx)
      +'<span style="color:var(--acc,#7C6FFF);font-weight:700">'+safe.slice(idx,idx+safeQ.length)+'</span>'
      +safe.slice(idx+safeQ.length);
  }

  function usageLbl(mins){
    if(!mins) return '';
    const h=Math.floor(mins/60),m=mins%60;
    const t=h>0?(m>0?h+'h '+m+'m':h+'h'):m+'m';
    return '<span style="color:#12D48A">'+t+' today</span>';
  }

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
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);display:flex;align-items:center;gap:2px;margin-top:1px">
          ${usageLbl(a._usageMins)}${freqLbl(a._usageMins)}
          ${!a._usageMins?'<span style="color:var(--t3)">Not used today</span>':''}
        </div>
      </div>
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);padding:0 4px">⠿</div>
    </div>`).join('');

  drop.querySelectorAll('.sdr[data-pkg]').forEach(row=>{
    attachTouchDragToSearchRow(row, row.dataset.pkg, row.dataset.name);
  });
  if(val.length===1) _allAppsCache=null;
}
document.addEventListener('click',e=>{ if(!e.target.closest('#search-drop')&&!e.target.closest('#search-input')){ clearSearch(); } });

/* ═══ FIRST-RUN SNAPSHOT CARD ════════════════════════ */
function renderFirstRunCard() {
  const card = document.getElementById('first-run-card');
  if (!card) return;
  if (S.firstRunCardDone) { card.style.display = 'none'; return; }

  const iconEl  = document.getElementById('frc-icon');
  const titleEl = document.getElementById('frc-title');
  const bodyEl  = document.getElementById('frc-body');

  card.onclick = () => {
    if (typeof ProUpsell !== 'undefined') {
      ProUpsell.show('upgrade_pro');
    } else {
      openPanel('settings-panel');
    }
  };

  if (DAILY_USE.length > 0) {
    const top = DAILY_USE[0];
    iconEl.textContent  = '💎';
    titleEl.textContent = 'Unlock Deep Insights';
    bodyEl.textContent  = `${top.name} is leading your trends today. Unlock Pro to see your Monthly View, analyze your App DNA, and use Hard Mode to stay intentional`;
  } else {
    iconEl.textContent  = '🚀';
    titleEl.textContent = 'Supercharge Your Focus';
    bodyEl.textContent  = 'Take total control of your digital space. Upgrade to Pro for custom categories, smart widgets, and advanced focus tools designed for deep work.';
  }

  card.style.display    = 'flex';
  card.style.cursor     = 'pointer';
  card.style.border     = '1px dashed var(--p)';
  card.style.background = 'linear-gradient(135deg, rgba(108,99,255,0.08), transparent)';
}

/* ═══ RECENT / ROUTINE CHIPS ══════════════════════════ */
function renderRecent(){
  _renderRoutineHeader();
  const wrap = document.getElementById('recent-row');
  if(!wrap) return;
  const hidden = new Set(S.hiddenPkgs || []);

  const usageMap = {};
  DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes || 0; });

  const usageFiltered = DAILY_USE.filter(a => !hidden.has(a.packageName));
  const allCatApps    = Object.values(CATS_MAP).flat().filter(a => !hidden.has(a.packageName));
  const source = usageFiltered.length
    ? usageFiltered.slice(0, 8)
    : allCatApps.slice(0, 8).map(a => ({name:a.name, packageName:a.packageName, totalMinutes:0}));

  const limits = S.limits || {};

  wrap.innerHTML = source.map(a => {
    const mins    = usageMap[a.packageName] || a.totalMinutes || 0;
    const timeStr = mins > 0 ? fmtM(mins) : '';
    const limit   = limits[a.packageName];
    const isAtLimit  = limit && (usageMap[a.packageName] || 0) >= limit;
    const isNearLimit = limit && !isAtLimit && (usageMap[a.packageName] || 0) >= limit * 0.8;

    // v2.1: show timer pip on icon if app has a limit
    const timerPip = isAtLimit
      ? `<div class="app-icon-timer">${fmtM((usageMap[a.packageName]||0) - limit)} over</div>`
      : isNearLimit
        ? `<div class="app-icon-timer" style="background:var(--a)">${fmtM(limit - (usageMap[a.packageName]||0))} left</div>`
        : '';

    return `<div class="rc" onclick="launchApp('${escAttr(a.packageName)}','${escAttr(a.name)}')">
      <div class="rc-icon" style="position:relative">
        ${appIco(a.packageName, 52, 14)}
        ${timerPip}
      </div>
      <div class="rc-lbl">${escHtml(a.name)}</div>
      ${timeStr ? `<div class="rc-time">${timeStr}</div>` : '<div class="rc-time" style="opacity:0">·</div>'}
    </div>`;
  }).join('');
}

/* ═══ GHOST BANNER → INSIGHT BANNER ═════════════════ */
function renderGhostBanner(){
  const stub = document.getElementById('ghost-banner');
  if(stub) stub.style.display='none';

  renderCulpritsSection();
  renderCategorySummary();

  const ghostOrgSub = document.getElementById('ghost-org-sub');
  if (ghostOrgSub && GHOSTS && GHOSTS.length > 0) {
    ghostOrgSub.textContent = `${GHOSTS.length} app${GHOSTS.length !== 1 ? 's' : ''} unused 30+ days`;
  }
}

/* ═══ CULPRITS / MOST USED SECTION ════════════════════════════════════════
 * v2.1: Uses CSS classes (culprit-row, culprit-ico, culprit-bar etc.)
 *        Dynamic label toned down: "TODAY'S CULPRITS" only when over goal.
 * ═══════════════════════════════════════════════════════════════════════ */
function renderCulpritsSection() {
  const section = document.getElementById('home-culprits-section');
  const labelEl = document.getElementById('home-culprits-label');
  const listEl  = document.getElementById('home-culprits-list');
  if (!section || !listEl) return;

  const hidden  = new Set(S.hiddenPkgs || []);
  const top3    = DAILY_USE.filter(a => !hidden.has(a.packageName)).slice(0, 3);
  if (!top3.length) { section.style.display = 'none'; return; }

  const goalMins = S.streakGoalMins || 240;
  const rawPct   = goalMins > 0 ? TODAY_MINS / goalMins : 0;
  const maxMins  = top3[0].totalMinutes || 1;

  // v2.1: less judgmental labelling
  let label, accentColor;
  if (rawPct > 1) {
    label = "TODAY'S CULPRITS"; accentColor = 'var(--r)';
  } else if (rawPct >= 0.9) {
    label = 'WATCH THESE TODAY'; accentColor = 'var(--a)';
  } else {
    label = 'TOP APPS TODAY';    accentColor = 'var(--t3)';
  }
  if (labelEl) { labelEl.textContent = label; labelEl.style.color = accentColor; }

  // v2.1: CSS classes instead of wall-of-inline-styles
  listEl.innerHTML = top3.map(a => {
    const mins   = a.totalMinutes || 0;
    const barPct = maxMins > 0 ? Math.round((mins / maxMins) * 100) : 0;
    // Bar colour matches status: red when leading while over goal, else gradient
    const barColor = (rawPct > 1 && a === top3[0])
      ? 'var(--r)'
      : 'linear-gradient(90deg, var(--p), var(--c))';

    return `<div class="culprit-row">
      <div class="culprit-ico">${appIco(a.packageName, 32)}</div>
      <div class="culprit-info">
        <div class="culprit-name">${escHtml(a.name)}</div>
        <div class="culprit-bar-wrap">
          <div class="culprit-bar" style="width:${barPct}%;background:${barColor}"></div>
        </div>
      </div>
      <div class="culprit-time" style="color:${accentColor}">${fmtM(mins)}</div>
    </div>`;
  }).join('');

  section.style.display = '';
}

/* ═══ CATEGORY SUMMARY STRIP ══════════════════════════════════════════════
 * v2.1: Uses CSS classes (cat-row, cat-dot, cat-bar etc.)
 *        Proportional bar widths for clearer visual comparison.
 * ═══════════════════════════════════════════════════════════════════════ */
function renderCategorySummary() {
  const section = document.getElementById('home-cat-summary');
  const listEl  = document.getElementById('home-cat-summary-list');
  if (!section || !listEl) return;

  const hidden   = new Set(S.hiddenPkgs || []);
  const usageMap = {};
  DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes || 0; });

  const catTotals = {};
  Object.entries(CATS_MAP).forEach(([cat, apps]) => {
    const total = apps
      .filter(a => !hidden.has(a.packageName))
      .reduce((sum, a) => sum + (usageMap[a.packageName] || 0), 0);
    if (total > 0) catTotals[cat] = total;
  });

  const sorted = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (!sorted.length) { section.style.display = 'none'; return; }

  const maxCatMins = sorted[0][1] || 1;
  const CAT_COLORS = ['var(--p)', 'var(--c)', 'var(--a)', 'var(--g)', 'var(--r)'];

  listEl.innerHTML = sorted.map(([cat, mins], i) => {
    const barPct = Math.round((mins / maxCatMins) * 100);
    const color  = CAT_COLORS[i % CAT_COLORS.length];
    return `<div class="cat-row">
      <div class="cat-dot" style="background:${color}"></div>
      <div class="cat-name">${escHtml(cat)}</div>
      <div class="cat-bar-wrap">
        <div class="cat-bar" style="width:${barPct}%;background:${color}"></div>
      </div>
      <div class="cat-time">${fmtM(mins)}</div>
    </div>`;
  }).join('');

  section.style.display = '';
}

/* ═══ SECTION LABELS POST-RENDER HOOK ════════════════
 * Called after all home render functions complete so labels
 * can be injected after dynamic content has been painted.
 * ════════════════════════════════════════════════════ */
function renderHomeSectionLabelsDeferred() {
  // Small delay so coach card (async) has time to appear
  setTimeout(_renderHomeSectionLabels, 200);
  // Mood morning prompt — fires once per morning window, once per day
  if (typeof Mood !== 'undefined') {
    setTimeout(function () { Mood.checkMorningPrompt(); }, 800);
  }
}