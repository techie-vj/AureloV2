/* ═══ GHOST PANEL ════════════════════════════════════ */
function renderGhostPanel(){
  const list=document.getElementById('ghost-list'), empty=document.getElementById('ghost-empty');
  if(!GHOSTS.length){ list.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  const ghosts_sorted = [...GHOSTS].sort((a,b)=>(b.daysSinceUse||0)-(a.daysSinceUse||0));
  list.innerHTML=ghosts_sorted.map(g=>{
    const safePkg  = g.packageName.replace(/"/g,'&quot;');
    const safeName = (g.name||'').replace(/"/g,'&quot;');
    return `
    <div class="ghost-row" id="gr-${g.packageName.replace(/\./g,'-')}"
         data-pkg="${safePkg}" data-name="${safeName}">
      <div class="ghost-ico">${appIco(g.packageName,46,13)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600">${g.name||''}</div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">Last used ${g.daysSinceUse} days ago · ${g.sizeMB||0} MB</div>
      </div>
      <button class="ghost-del" onclick="event.stopPropagation();window._ghostUninstall(this.closest('.ghost-row').dataset.pkg,this.closest('.ghost-row').dataset.name)">Uninstall</button>
    </div>`;
  }).join('');
}

function doUninstall(pkg,name){
  pendingUninstall=pkg;
  try {
    if(IS_NATIVE && typeof NativeBridge !== 'undefined' && typeof NativeBridge.uninstallAppDirect === 'function') {
      NativeBridge.uninstallAppDirect(pkg);
    } else if(IS_NATIVE && N && typeof N.uninstallApp === 'function') {
      N.uninstallApp(pkg);
    } else {
      nCall('uninstallApp', pkg);
    }
  } catch(e) {
    console.error('uninstall error:', e);
    toast('Could not open uninstall dialog', 'error');
    pendingUninstall = null;
    return;
  }
  const row=document.getElementById('gr-'+pkg.replace(/\./g,'-'));
  if(row){ row.style.opacity='.45'; row.style.pointerEvents='none'; }
  toast('Opening uninstall dialog…','info');
}
window._ghostUninstall = doUninstall;

let pendingUninstall=null;

window.openSearchTab   = function(){ activateTab('home');     setTimeout(()=>{ const s=document.getElementById('search-input'); if(s){s.focus();s.dispatchEvent(new Event('input'));} },300); };
window.openHomeTab     = function(){ activateTab('home'); };
window.openWellnessTab = function(){ activateTab('wellness'); };

window.onAppResume = function(){
  updatePermUI();
  if(_waitingForWidgetPin){
    _waitingForWidgetPin = false;
    if(_widgetPinTimeout){ clearTimeout(_widgetPinTimeout); _widgetPinTimeout=null; }
    const added = IS_NATIVE && typeof N.isWidgetAdded==='function' && N.isWidgetAdded();
    if(added){
      toast('Widget added to your home screen ✓','success');
    } else {
      toast('Long-press your home screen → Widgets → Aurelo','info',4000);
    }
    return;
  }
  checkPermAfterResume();
  if(pendingUninstall&&IS_NATIVE){
    const stillInstalled=nCall('isAppInstalled',pendingUninstall);
    if(!stillInstalled){
      GHOSTS=GHOSTS.filter(g=>g.packageName!==pendingUninstall);
      renderGhostPanel(); renderGhostBanner();
      toast('App uninstalled successfully','success');
    } else {
      toast('Uninstall cancelled','info');
    }
    pendingUninstall=null;
  }
  if(IS_NATIVE){
    clearTimeout(_refreshTimer);
    _lastRefreshTs = 0;
    _refreshTimer = setTimeout(refreshUsage, 150);
  }
  if(IS_NATIVE && S.settings.bedtime){
    const hasDnd = typeof N.hasDndPermission==='function' && N.hasDndPermission();
    if(hasDnd){
      const isBlockActive  = typeof N.isBedtimeBlockActive === 'function' && !!N.isBedtimeBlockActive();
      const isSkipped      = typeof N.isBedtimeSkippedTonight === 'function' && !!N.isBedtimeSkippedTonight();
      const snoozeEndsAt   = typeof N.getBedtimeSnoozeEndsAt === 'function' ? (+(N.getBedtimeSnoozeEndsAt())||0) : 0;
      const isSnoozed      = snoozeEndsAt > Date.now();
      if(isBlockActive && !isSnoozed && !isSkipped){
        try { N.setBedtimeDnd(true); } catch(e){}
      }
    }
  }
  // Refresh bell badge on resume so it stays accurate
  updateBellBadge();
};

function checkGhostEmpty(){
  document.getElementById('ghost-empty').style.display=GHOSTS.length?'none':'block';
}

function confirmUninstallAll(){
  if(!GHOSTS.length){ toast('No ghost apps to remove','info'); return; }
  const totalMB=GHOSTS.reduce((s,g)=>s+(g.sizeMB||0),0);
  showConfirm(`Uninstall ${GHOSTS.length} ghost apps?`,`Free up ~${totalMB}MB. You'll confirm each one in Android's dialog.`,()=>{
    let i=0;
    function nextUninstall(){
      if(i>=GHOSTS.length) return;
      const g=GHOSTS[i++];
      nCall('uninstallApp',g.packageName);
      setTimeout(nextUninstall,2500);
    }
    nextUninstall();
    toast(`Uninstall dialogs will open one by one…`,'warn');
  });
}

/* ═══ SMART ALERT DISPATCH ════════════════════════════════════ */
const NOTIF_COPY = {
  streakAtRisk: {
    free: null,
    pro:  '⚡ Your {n}-day streak is at risk. One session away from losing it.',
  },
  personalBest: {
    free: null,
    pro:  '🏆 New personal best — {time} today. You\'re in top form.',
  },
};

function dispatchSmartAlert(type, params = {}) {
  if (!ProTier.isPro) return;
  const copy = NOTIF_COPY[type];
  if (!copy || !copy.pro) return;
  let body = copy.pro;
  if (params.n    !== undefined) body = body.replace('{n}', params.n);
  if (params.time !== undefined) body = body.replace('{time}', params.time);
  // Persist to in-app history immediately
  const icon  = _typeDefaultIcon(type);
  const title = { streakAtRisk:'Streak at Risk', personalBest:'Personal Best' }[type] || 'Alert';
  window.addNotifToHistory(type, title, body);
  if (IS_NATIVE && typeof nCall === 'function') {
    try { nCall('postSmartNotification', JSON.stringify({ type, body })); } catch(_) {}
  }
}

/* ═══ NOTIFICATION HISTORY SYSTEM ═════════════════════════════════════
 * Source of truth: SharedPrefs key "tidy_notif_history_v2"
 *   • Written by SmartNotificationWorker.kt on every system notification post
 *   • Written by window.addNotifToHistory() from JS (dispatchSmartAlert etc.)
 *   • NEVER merged with N.getNotifications() — that returns live-generated data
 *     that changes on every call and would flood history with duplicates
 *
 * Notifications swiped from the system tray stay UNREAD in-app.
 * Tapping a card inside the app marks it as READ.
 * Groups: Today · Yesterday · This Week · Earlier
 * ═══════════════════════════════════════════════════════════════════ */

const NOTIF_HISTORY_KEY    = 'tidy_notif_history_v2';
const NOTIF_CLEARED_TS_KEY = 'tidy_notif_cleared_ts'; // kept for compat
const NOTIF_HISTORY_DAYS   = 30;

let _notifFilter = 'all'; // 'all' | 'unread'

/* ── Type → colour accent ── */
const NOTIF_TYPE_ACCENT = {
  warn:    '#F7A623',
  info:    '#05C8E8',
  success: '#12D48A',
  streak:  '#B06EFF',
  goal:    '#12D48A',
  pickup:  '#F04E7A',
  coach:   '#6C63FF',
};

/* ── Type → subtle background tint ── */
const NOTIF_TYPE_BG = {
  warn:    'rgba(247,166,35,0.07)',
  info:    'rgba(5,200,232,0.07)',
  success: 'rgba(18,212,138,0.07)',
  streak:  'rgba(176,110,255,0.07)',
  goal:    'rgba(18,212,138,0.07)',
  pickup:  'rgba(240,78,122,0.07)',
  coach:   'rgba(108,99,255,0.07)',
};

/* ── Storage helpers ── */
function _nhGet(){
  try {
    const raw = (IS_NATIVE && N && typeof N.getStringPref === 'function')
      ? N.getStringPref(NOTIF_HISTORY_KEY)
      : localStorage.getItem(NOTIF_HISTORY_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(_){ return []; }
}

function _nhSet(arr){
  try {
    const json = JSON.stringify(arr);
    if(IS_NATIVE && N && typeof N.setStringPref === 'function'){
      N.setStringPref(NOTIF_HISTORY_KEY, json);
    } else {
      localStorage.setItem(NOTIF_HISTORY_KEY, json);
    }
  } catch(_){}
}

/* ── Prune entries older than 30 days ── */
function _nhPrune(arr){
  const cutoff = Date.now() - NOTIF_HISTORY_DAYS * 86400000;
  return arr.filter(n => (n.timestamp || 0) > cutoff);
}

/* ── Infer notification type from title/body text ── */
function _inferType(n){
  if(n.type && n.type !== 'info') return n.type;
  const t = ((n.title||'') + ' ' + (n.body||'')).toLowerCase();
  if(/streak at risk|streak.*risk/.test(t))     return 'streak';
  if(/personal best|new best|this week/.test(t)) return 'success';
  if(/streak!\s*$|🔥.*day/.test(t))             return 'streak';
  if(/goal.*exceeded|over.*goal|high screen/.test(t)) return 'warn';
  if(/goal achieved|under.*goal|great.*habit/.test(t)) return 'goal';
  if(/pickup|pick up|unlock|checks/.test(t))    return 'pickup';
  if(/coach|insight/.test(t))                   return 'coach';
  if(/over|exceeded|too much|limit.*reached/.test(t)) return 'warn';
  return 'info';
}

function _typeDefaultIcon(type){
  const MAP = {warn:'⚠️',info:'📱',success:'✅',streak:'🔥',goal:'🎯',pickup:'📲',coach:'🤖'};
  return MAP[type] || '🔔';
}

function _typeLbl(type){
  const MAP = {warn:'Alert',info:'Info',success:'Achievement',streak:'Streak',
               goal:'Goal',pickup:'Pickups',coach:'Coach'};
  return MAP[type] || 'Notification';
}

/* ── Mark one notification as read ── */
function markNotifRead(id){
  const h = _nhGet();
  const idx = h.findIndex(n => n.id === id);
  if(idx !== -1 && !h[idx].read){
    h[idx].read = true;
    _nhSet(h);
    updateBellBadge();
  }
}

/* ── Mark all as read ── */
function markAllNotifRead(){
  const h = _nhGet();
  let changed = false;
  h.forEach(n => { if(!n.read){ n.read = true; changed = true; } });
  if(changed){ _nhSet(h); updateBellBadge(); }
  renderNotifHistory();
}

/* ── Count unread in history array ── */
function _unreadCount(h){ return h.filter(n => !n.read).length; }

/* ── Update the bell badge ── */
function updateBellBadge(){
  const badge = document.getElementById('notif-unread-badge');
  if(!badge) return;
  if(S.settings.notif === false){ badge.style.display = 'none'; return; }
  const h = _nhPrune(_nhGet());
  const count = _unreadCount(h);
  if(count > 0){
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
  const dot = document.getElementById('notif-dot');
  if(dot) dot.style.display = count > 0 ? '' : 'none';
  // Keep Unread tab pill in sync if panel is open
  const pill = document.getElementById('nh-unread-count');
  if(pill){
    if(count > 0){ pill.textContent = String(count); pill.style.display = 'inline-flex'; }
    else { pill.style.display = 'none'; }
  }
}

/* ── Group history entries by date bucket ── */
function _groupHistory(arr){
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yest  = today - 86400000;
  const week  = today - 6 * 86400000;
  const groups = { today:[], yesterday:[], week:[], earlier:[] };
  for(const n of arr){
    const ts = n.timestamp || 0;
    if(ts >= today)     groups.today.push(n);
    else if(ts >= yest) groups.yesterday.push(n);
    else if(ts >= week) groups.week.push(n);
    else                groups.earlier.push(n);
  }
  return groups;
}

/* ── Format a timestamp as relative time ── */
function _relTime(ts){
  if(!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if(mins < 1) return 'Just now';
  const date = new Date(ts);
  const timeStr = date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  if(mins < 60) return timeStr;
  const hrs = Math.floor(mins / 60);
  if(hrs < 24) return timeStr; // show clock time within today
  const days = Math.floor(hrs / 24);
  if(days < 7) return days === 1 ? 'Yesterday' : `${days}d ago`;
  return date.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

/* ── Render one notification card ── */
function _renderNotifCard(n, idx){
  const accent = NOTIF_TYPE_ACCENT[n.type] || NOTIF_TYPE_ACCENT.info;
  const bg     = NOTIF_TYPE_BG[n.type]     || NOTIF_TYPE_BG.info;
  const unread = !n.read;
  return `<div class="nh-card ${unread ? 'nh-unread' : 'nh-read'}"
               id="nhc-${idx}" data-idx="${idx}"
               style="--nh-accent:${accent};--nh-bg:${bg};">
    <div class="nh-accent-bar"></div>
    <div class="nh-icon-wrap">
      <span class="nh-icon">${n.icon || _typeDefaultIcon(n.type)}</span>
      ${unread ? '<span class="nh-unread-dot"></span>' : ''}
    </div>
    <div class="nh-content">
      <div class="nh-title">${escHtml ? escHtml(n.title||'') : (n.title||'')}</div>
      <div class="nh-body">${escHtml ? escHtml(n.body||'') : (n.body||'')}</div>
      <div class="nh-meta">
        <span class="nh-type-badge" style="color:${accent};background:${bg};border-color:${accent}22">${_typeLbl(n.type)}</span>
        <span class="nh-time">${_relTime(n.timestamp)}</span>
      </div>
    </div>
  </div>`;
}

/* ── Render a date group section ── */
function _renderGroup(label, items, startIdx){
  if(!items.length) return { html:'', nextIdx: startIdx };
  let html = `<div class="nh-group-label">${label}</div>`;
  items.forEach((n, i) => { html += _renderNotifCard(n, startIdx + i); });
  return { html, nextIdx: startIdx + items.length };
}

/* ── MAIN RENDER: reads from stored history, groups, renders ── */
function renderNotifHistory(){
  const container = document.getElementById('notif-list');
  if(!container) return;

  // Smart alerts off
  if(S.settings.notif === false){
    container.innerHTML = `<div class="nh-empty"><div class="nh-empty-icon">🔕</div><div class="nh-empty-title">Alerts are off</div><div class="nh-empty-sub">Enable Smart Alerts in Settings to receive notifications</div></div>`;
    updateBellBadge();
    return;
  }

  // Read from SharedPrefs — source of truth written by SmartNotificationWorker & addNotifToHistory
  let history = _nhPrune(_nhGet());

  // In browser demo mode, seed with demo data so the panel isn't empty
  if(!IS_NATIVE && history.length === 0){
    history = _buildDemoHistory();
    _nhSet(history);
  }

  updateBellBadge();

  // Apply filter tab
  const filtered = _notifFilter === 'unread'
    ? history.filter(n => !n.read)
    : history;

  if(!filtered.length){
    const msg = _notifFilter === 'unread'
      ? `<div class="nh-empty"><div class="nh-empty-icon">✓</div><div class="nh-empty-title">All caught up</div><div class="nh-empty-sub">No unread notifications</div></div>`
      : `<div class="nh-empty"><div class="nh-empty-icon">🔔</div><div class="nh-empty-title">No notifications yet</div><div class="nh-empty-sub">Smart alerts from the past 30 days appear here</div></div>`;
    container.innerHTML = msg;
    return;
  }

  const groups = _groupHistory(filtered);
  let html = '';
  let idx = 0;

  const r0 = _renderGroup('Today', groups.today, idx);       html += r0.html; idx = r0.nextIdx;
  const r1 = _renderGroup('Yesterday', groups.yesterday, idx); html += r1.html; idx = r1.nextIdx;
  const r2 = _renderGroup('This Week', groups.week, idx);    html += r2.html; idx = r2.nextIdx;
  const r3 = _renderGroup('Earlier', groups.earlier, idx);   html += r3.html; idx = r3.nextIdx;

  container.innerHTML = html;
  _attachCardHandlers(filtered);
}

/* ── Attach tap handlers to rendered cards ── */
function _attachCardHandlers(filteredHistory){
  document.querySelectorAll('.nh-card').forEach(card => {
    card.addEventListener('pointerup', function(e){
      window._nhTap(parseInt(this.dataset.idx));
    });
  });
}

/* ── Tap: mark read, update visual ── */
window._nhTap = function(idx){
  const history  = _nhPrune(_nhGet());
  const filtered = _notifFilter === 'unread' ? history.filter(n => !n.read) : history;
  const n = filtered[idx];
  if(!n) return;
  if(!n.read){
    markNotifRead(n.id);
    const card = document.querySelector('.nh-card[data-idx="'+idx+'"]');
    if(card){
      card.classList.remove('nh-unread');
      card.classList.add('nh-read');
      const dot = card.querySelector('.nh-unread-dot');
      if(dot) dot.style.opacity = '0'; // fade out dot
      setTimeout(() => dot && dot.remove(), 300);
    }
  }
};

/* ── Set filter tab ── */
function setNotifFilter(f){
  _notifFilter = f;
  document.querySelectorAll('.nh-tab').forEach(el => {
    const isActive = el.dataset.f === f;
    el.classList.toggle('nh-tab--active', isActive);
    el.setAttribute('aria-selected', String(isActive));
  });
  renderNotifHistory();
}

/* ── Public: load and render history (called when opening panel) ── */
function loadNotifHistory(){
  _notifFilter = 'all'; // reset to All tab on each open
  document.querySelectorAll('.nh-tab').forEach(el => {
    el.classList.toggle('nh-tab--active', el.dataset.f === 'all');
    el.setAttribute('aria-selected', el.dataset.f === 'all' ? 'true' : 'false');
  });
  renderNotifHistory();
}

/* ── Public: add a notification to in-app history (called from Kotlin or JS) ──
 * Kotlin: window.addNotifToHistory(type, title, body) via evaluateJavascript
 * JS:     dispatchSmartAlert() calls this before postSmartNotification
 */
window.addNotifToHistory = function(type, title, body){
  if(!title && !body) return;
  const inferredType = _inferType({ type, title, body });
  const icon  = _typeDefaultIcon(inferredType);
  const id    = (title || '') + '|' + (body || '');
  const h     = _nhPrune(_nhGet());
  // Deduplicate: don't add if same id already exists and is less than 10 mins old
  const recent = h.find(n => n.id === id && (Date.now() - (n.timestamp||0)) < 600000);
  if(recent) return;
  h.unshift({ id, type: inferredType, icon, title: title||'', body: body||'', timestamp: Date.now(), read: false });
  _nhSet(h.slice(0, 200)); // cap at 200 entries
  updateBellBadge();
};

/* ── Clear all notifications from history ── */
function clearNotifications(){
  _nhSet([]);
  updateBellBadge();
  if(IS_NATIVE){ try{ nCall('cancelAllNotifications'); }catch(_){} }
  toast('All notifications cleared', 'info');
  renderNotifHistory();
}

/* ── Legacy: loadNotifications (called on boot — just updates badge) ── */
let NOTIFS = [];
function loadNotifications(){
  updateBellBadge();
}

/* ── Legacy: updateNotifDot ── */
function updateNotifDot(){
  updateBellBadge();
}

/* ── Demo history for browser preview ── */
function _buildDemoHistory(){
  const now = Date.now();
  return [
    { id:'High Screen Time|2h 45m on your phone today.',               type:'warn',    icon:'⚠️', title:'High Screen Time',      body:'2h 45m on your phone today.',                                  timestamp: now - 1800000,   read: false },
    { id:'Top App: Instagram|1h 12m today — your #1 app.',             type:'info',    icon:'📱', title:'Top App: Instagram',     body:'1h 12m today — your #1 app. Consider setting a daily limit.',  timestamp: now - 3600000,   read: false },
    { id:'Frequent Pickups|63 phone pickups today.',                    type:'pickup',  icon:'📲', title:'Frequent Pickups',       body:'63 checks today. Batching phone use helps maintain focus.',     timestamp: now - 7200000,   read: true  },
    { id:'Goal Achieved|You stayed under your goal yesterday!',         type:'success', icon:'✅', title:'Goal Achieved',          body:'You stayed under your screen time goal yesterday!',             timestamp: now - 86400000,  read: true  },
    { id:'7-Day Streak!|7 consecutive days under your goal!',           type:'streak',  icon:'🔥', title:'7-Day Streak!',          body:'7 consecutive days under your screen time goal!',               timestamp: now - 172800000, read: true  },
    { id:'Personal Best This Week|Lower than every other day.',         type:'success', icon:'🏆', title:'Personal Best This Week',body:'1h 20m — lower than every other day this week.',                timestamp: now - 432000000, read: true  },
  ];
}

/* ── Demo notifications (legacy compat for non-history callers) ── */
function getDemoNotifs(){
  return _buildDemoHistory().map(n => ({ icon:n.icon, title:n.title, body:n.body, time:'', type:n.type }));
}
