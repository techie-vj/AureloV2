/* ═══ GHOST PANEL ════════════════════════════════════ */
function renderGhostPanel(){
  const list=document.getElementById('ghost-list'), empty=document.getElementById('ghost-empty');
  if(!GHOSTS.length){ list.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  const ghosts_sorted = [...GHOSTS].sort((a,b)=>(b.daysSinceUse||0)-(a.daysSinceUse||0));
  list.innerHTML=ghosts_sorted.map(g=>{
    // Escape for HTML attribute — avoids apostrophe/quote injection in onclick strings
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
  pendingUninstall=pkg; // set BEFORE launching dialog so onAppResume catches it
  // Call uninstall — tries direct NativeBridge first (reliable), then AppBridge fallback
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
  // Grey out the row immediately so UI responds
  const row=document.getElementById('gr-'+pkg.replace(/\./g,'-'));
  if(row){ row.style.opacity='.45'; row.style.pointerEvents='none'; }
  toast('Opening uninstall dialog…','info');
}
// Bound to window so HTML-injected onclick strings can always reach it
window._ghostUninstall = doUninstall;

let pendingUninstall=null;

// Called when user returns to app (after Android uninstall dialog)
// ── Widget deep-link handlers (called by MainActivity.handleWidgetIntent) ──
window.openSearchTab   = function(){ activateTab('home');     setTimeout(()=>{ const s=document.getElementById('search-input'); if(s){s.focus();s.dispatchEvent(new Event('input'));} },300); };
window.openHomeTab     = function(){ activateTab('home'); };
window.openWellnessTab = function(){ activateTab('wellness'); };

window.onAppResume = function(){
  updatePermUI();
  // Widget pin: always verify with isWidgetAdded — onAppResume fires on both
  // "placed" and "back pressed", so we can't blindly show success here.
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
  // If user is on the permission step of onboarding, check if they just granted it
  checkPermAfterResume();
  if(pendingUninstall&&IS_NATIVE){
    // Check if the app was actually uninstalled
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
  // Refresh usage data immediately on resume — reset debounce so it always runs.
  // The 150ms delay just lets any pending layout/transition settle first.
  if(IS_NATIVE && N.hasUsagePermission()){
    clearTimeout(_refreshTimer);
    _lastRefreshTs = 0; // bypass 5s debounce on resume
    _refreshTimer = setTimeout(refreshUsage, 150);
  }
  // BUG-2 FIX: Do NOT re-apply DND based purely on the clock time.
  // The previous code called N.setBedtimeDnd(h>=bh||h<5) on every resume,
  // which re-enabled DND even after the user pressed "Snooze" or "Turn Off"
  // from the bedtime notification.  DND state is now managed exclusively by
  // the native side (BedtimeReceiver / BedtimeBlockingEngine).
  // We only apply DND here for the narrow case where DND permission was just
  // granted (user came back from DND settings) AND blocking is genuinely active
  // (not snoozed, not skipped tonight).
  if(IS_NATIVE && S.settings.bedtime){
    const hasDnd = typeof N.hasDndPermission==='function' && N.hasDndPermission();
    if(hasDnd){
      // Guard: respect snooze and turn-off state before touching DND.
      const isBlockActive  = typeof N.isBedtimeBlockActive === 'function' && !!N.isBedtimeBlockActive();
      const isSkipped      = typeof N.isBedtimeSkippedTonight === 'function' && !!N.isBedtimeSkippedTonight();
      const snoozeEndsAt   = typeof N.getBedtimeSnoozeEndsAt === 'function' ? (+(N.getBedtimeSnoozeEndsAt())||0) : 0;
      const isSnoozed      = snoozeEndsAt > Date.now();
      // Only enable DND if blocking is active AND not snoozed AND not turned-off-tonight.
      if(isBlockActive && !isSnoozed && !isSkipped){
        try { N.setBedtimeDnd(true); } catch(e){}
      }
    }
  }
};

function checkGhostEmpty(){
  document.getElementById('ghost-empty').style.display=GHOSTS.length?'none':'block';
}

function confirmUninstallAll(){
  if(!GHOSTS.length){ toast('No ghost apps to remove','info'); return; }
  const totalMB=GHOSTS.reduce((s,g)=>s+(g.sizeMB||0),0);
  showConfirm(`Uninstall ${GHOSTS.length} ghost apps?`,`Free up ~${totalMB}MB. You'll confirm each one in Android's dialog.`,()=>{
    // Uninstall one at a time with delay — Android needs time between dialogs
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

/* ═══ NOTIFICATIONS ════════════════════════════════════ */

/* ── Phase 5: Pro-only notification copy ───────────────────────────────────
 * Streak-at-risk and personal-best notifications are only dispatched for
 * Pro users. Free users don't receive these — they add too much friction
 * without the motivational context Pro users unlock.
 *
 * Usage:
 *   if (ProTier.isPro) dispatchSmartAlert('streakAtRisk', { n: streak });
 */
const NOTIF_COPY = {
  streakAtRisk: {
    free: null, // free users don't get this notification
    pro:  '⚡ Your {n}-day streak is at risk. One session away from losing it.',
  },
  personalBest: {
    free: null, // free users don't get this notification
    pro:  '🏆 New personal best — {time} today. You\'re in top form.',
  },
};

/**
 * dispatchSmartAlert — dispatches a Pro-gated smart notification if eligible.
 * @param {'streakAtRisk'|'personalBest'} type
 * @param {{ n?: number, time?: string }} params  Template variables.
 */
function dispatchSmartAlert(type, params = {}) {
  if (!ProTier.isPro) return; // free users don't receive these
  const copy = NOTIF_COPY[type];
  if (!copy || !copy.pro) return;
  let body = copy.pro;
  if (params.n    !== undefined) body = body.replace('{n}', params.n);
  if (params.time !== undefined) body = body.replace('{time}', params.time);
  if (IS_NATIVE && typeof nCall === 'function') {
    try { nCall('postSmartNotification', JSON.stringify({ type, body })); } catch(_) {}
  }
}


let NOTIFS=[];
// BUG-02 FIX: Notification dismissed state was stored in localStorage which Android
// can silently clear under memory pressure or when the user clears app cache in Settings.
// All notification persistence is now routed through AppBridge.getStringPref /
// setStringPref which write to SharedPreferences — survives cache clears and reboots.
// The key names are kept identical so no migration of existing stored data is needed.
const NOTIF_DISMISSED_KEY = 'tidy_dismissed_notifs_v1';
const NOTIF_CLEARED_TS_KEY = 'tidy_notif_cleared_ts';

function getDismissedSet(){
  try {
    if (IS_NATIVE) {
      const raw = N.getStringPref(NOTIF_DISMISSED_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    }
    // Fallback for browser preview mode (no bridge available)
    return new Set(JSON.parse(localStorage.getItem(NOTIF_DISMISSED_KEY)||'[]'));
  } catch(_){ return new Set(); }
}
function saveDismissed(set){
  try {
    const json = JSON.stringify([...set]);
    if (IS_NATIVE) { N.setStringPref(NOTIF_DISMISSED_KEY, json); return; }
    localStorage.setItem(NOTIF_DISMISSED_KEY, json);
  } catch(_){}
}
function getNotifHash(n){ return n.title+'|'+n.body; }
function getClearedTs(){
  try {
    if (IS_NATIVE) { const v = N.getStringPref(NOTIF_CLEARED_TS_KEY); return v ? parseInt(v) : 0; }
    return parseInt(localStorage.getItem(NOTIF_CLEARED_TS_KEY)||'0');
  } catch(_){ return 0; }
}

function loadNotifications(){
  // If smart alerts are disabled, show empty panel
  if(S.settings.notif===false){
    NOTIFS=[];
    const list=document.getElementById('notif-list');
    if(list) list.innerHTML=`<div style="text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3);padding:40px">Smart alerts are turned off</div>`;
    document.getElementById('notif-dot').style.display='none';
    return;
  }
  const raw=IS_NATIVE&&N.hasUsagePermission()?N.getNotifications():'[]';
  let all=raw&&raw!=='[]'?JSON.parse(raw):getDemoNotifs();
  // Filter out dismissed + cleared
  const dismissed=getDismissedSet();
  const clearedTs=getClearedTs();
  // Filter out dismissed items. If a notification carries a timestamp, also
  // filter out anything generated before the last clear action.
  NOTIFS=all.filter(n=>{
    if(dismissed.has(getNotifHash(n))) return false;
    if(clearedTs && n.timestamp && n.timestamp < clearedTs) return false;
    return true;
  });
  renderNotifications();
}
function getDemoNotifs(){
  return [
    {icon:'⚠️',title:'High Screen Time',body:`You've spent ${fmtM(TODAY_MINS)} on your phone today.`,time:'Just now',type:'warn'},
    {icon:'📱',title:'Top App Alert',body:`${DAILY_USE[0]?.name||'Instagram'} was your most-used app with ${fmtM(DAILY_USE[0]?.totalMinutes||140)}.`,time:'Today',type:'info'},
    {icon:'📲',title:'Pickup Count',body:`You've unlocked your phone ${PICKUPS} times today.`,time:'Today',type:'info'},
    {icon:'✅',title:'Goal Achieved',body:'You stayed under your screen time goal yesterday!',time:'Yesterday',type:'success'}
  ];
}
function dismissNotif(hash){
  const set=getDismissedSet(); set.add(hash); saveDismissed(set);
  NOTIFS=NOTIFS.filter(n=>getNotifHash(n)!==hash);
  renderNotifications();
}
function renderNotifications(){
  const list=document.getElementById('notif-list');
  if(!NOTIFS.length){ list.innerHTML=`<div style="text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3);padding:40px">No new notifications</div>`; return; }
  list.innerHTML=NOTIFS.map((n,idx)=>{
    const hash=getNotifHash(n).replace(/['"]/g,'');
    return `<div class="notif-row" id="nr-${idx}" style="position:relative;overflow:hidden;cursor:pointer;transition:transform .25s,opacity .25s">
      <div class="notif-ico ${n.type}"><div style="font-size:18px">${n.icon}</div></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;margin-bottom:3px">${n.title}</div>
        <div style="font-size:12px;color:var(--t2);line-height:1.5">${n.body}</div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:4px">${n.time}</div>
      </div>
      <div onclick="dismissNotif('${getNotifHash(n).replace(/'/g,'')}')" style="flex-shrink:0;padding:8px;color:var(--t3);font-size:18px;cursor:pointer;border-radius:8px;transition:background .12s" onmouseenter="this.style.background='var(--s2)'" onmouseleave="this.style.background=''">×</div>
    </div>`;
  }).join('');
  // Add swipe-to-dismiss on each row
  document.querySelectorAll('.notif-row').forEach((row,idx)=>{
    if(!NOTIFS[idx]) return;
    const n=NOTIFS[idx]; const hash=getNotifHash(n);
    let sx=0,startX=0; let isDismissing=false;
    row.addEventListener('touchstart',e=>{sx=startX=e.touches[0].clientX;},{ passive:true });
    row.addEventListener('touchmove',e=>{
      const dx=e.touches[0].clientX-sx;
      if(Math.abs(dx)>5){ row.style.transform=`translateX(${dx}px)`; row.style.opacity=String(Math.max(0,1-Math.abs(dx)/120)); }
    },{ passive:true });
    row.addEventListener('touchend',e=>{
      const dx=e.changedTouches[0].clientX-startX;
      if(Math.abs(dx)>80){
        // Swipe far enough — dismiss
        row.style.transform=`translateX(${dx>0?'120%':'-120%'})`;
        row.style.opacity='0';
        setTimeout(()=>dismissNotif(hash), 250);
      } else {
        // Snap back
        row.style.transform='';
        row.style.opacity='1';
      }
    },{ passive:true });
  });
  document.getElementById('notif-dot').style.display='none';
}
function clearNotifications(){
  // BUG-02 FIX: cleared timestamp now written to SharedPrefs via AppBridge.setStringPref
  // (same fix as getDismissedSet / saveDismissed above). localStorage would be wiped on
  // cache clear, making all cleared notifications reappear on next open.
  const ts = Date.now();
  if (IS_NATIVE) {
    try { N.setStringPref(NOTIF_CLEARED_TS_KEY, String(ts)); } catch(_){}
  } else {
    try { localStorage.setItem(NOTIF_CLEARED_TS_KEY, String(ts)); } catch(_){}
  }
  // Also persist individual hashes so in-app list stays clean
  const dismissed=getDismissedSet();
  NOTIFS.forEach(n=>dismissed.add(getNotifHash(n)));
  saveDismissed(dismissed);
  NOTIFS=[];
  // Cancel ALL posted system notifications so they disappear from the shade
  if(IS_NATIVE) try{ nCall('cancelAllNotifications'); }catch(_){}
  document.getElementById('notif-list').innerHTML=`<div style="text-align:center;font-family:var(--ff-m);font-size:12px;color:var(--t3);padding:40px">No new notifications</div>`;
  document.getElementById('notif-dot').style.display='none';
  toast('All notifications cleared','info');
}
function updateNotifDot(){
  // Hide dot entirely when smart alerts are disabled
  if(S.settings.notif===false){ document.getElementById('notif-dot').style.display='none'; return; }
  try {
    if(IS_NATIVE&&N.hasUsagePermission()){
      const all=JSON.parse(N.getNotifications()||'[]');
      const dismissed=getDismissedSet();
      const unread=all.filter(n=>!dismissed.has(getNotifHash(n)));
      document.getElementById('notif-dot').style.display=unread.length>0?'':'none';
    } else {
      // No usage permission — no notifications to show
      document.getElementById('notif-dot').style.display='none';
    }
  } catch(_){ document.getElementById('notif-dot').style.display='none'; }
}