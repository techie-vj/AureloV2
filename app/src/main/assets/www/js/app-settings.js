/* ═══ app-settings.js — Settings tab: theme, goal, bedtime, permissions ════
 * Widget settings panel → app-settings-widget.js (Phase 4)
 * ════════════════════════════════════════════════════════════════════════════ */

/* ═══ SETTINGS ════════════════════════════════════════ */
var APP_THEMES=[
  {key:'dark',     label:'Dark',         icon:'🌙', isPro:false},
  {key:'light',    label:'Light',        icon:'☀️', isPro:false},
  {key:'amoled',   label:'AMOLED Black', icon:'⚫', isPro:true},
  {key:'warm',     label:'Warm Sand',    icon:'🏔️', isPro:true},
  {key:'midnight', label:'Midnight',     icon:'🌌', isPro:true},
  {key:'forest',   label:'Forest',       icon:'🌿', isPro:true},
  {key:'rose',     label:'Rose',         icon:'🌸', isPro:true},
  {key:'aurelo-gold', label:'Aurelo ✨',  icon:'⚜️', isPro:true, desc:'Aurelo signature palette', swatchBg:'linear-gradient(135deg,#0C0900,#FFAA44)'},
];
function applyTheme(t){
  var keys=APP_THEMES.map(function(x){return x.key;});
  var key=keys.indexOf(t)>=0?t:'dark';
  document.documentElement.removeAttribute('data-theme');
  if(key!=='dark') document.documentElement.setAttribute('data-theme',key);
  S.theme=key;
  var sub=document.getElementById('appThemeSub');
  var th=APP_THEMES.find(function(x){return x.key===key;});
  if(sub&&th) sub.textContent=th.icon+' '+th.label;
}
function toggleTheme(){} // removed — use App Theme picker
function setAppTheme(key){
  // Phase 3: Pro-only themes are locked for free users
  var th=APP_THEMES.find(function(t){return t.key===key;});
  if(th && th.isPro && !ProTier.isPro){
    ProTier.triggerUpsell('THEME_AMOLED_PLUS');
    return;
  }
  S.theme=key; saveS();
  if(IS_NATIVE) nCall('setStringPref','app_theme',key);
  applyTheme(key); renderAppThemeList();
  if(th) toast(th.label+' theme applied','success');
}
function toggleAppThemes(){
  var list=document.getElementById('appThemeList');
  var chev=document.getElementById('appThemeChevron');
  if(!list) return;
  var open=list.style.display==='none'||!list.style.display;
  list.style.display=open?'block':'none';
  if(chev) chev.style.transform=open?'rotate(90deg)':'';
  if(open) renderAppThemeList();
}

// ── Refer a Friend ────────────────────────────────────────────────────────────
const TIDY_APP_STORE_URL='https://play.google.com/store/apps/details?id=com.javikastudio.tidyapp';
function referFriend(){
shareCard('referral');
}
function renderAppThemeList(){
  var list=document.getElementById('appThemeList');
  if(!list) return;
  var current=S.theme||'dark';
  var isPro=ProTier.isPro;
  var html='';
  APP_THEMES.forEach(function(t){
    var active=t.key===current;
    var locked=t.isPro&&!isPro;
    html+='<div data-themekey="'+t.key+'" role="option" tabindex="0" aria-selected="'+(active?'true':'false')+'" style="display:flex;align-items:center;gap:12px;padding:13px 15px;min-height:48px;background:'+(active?'rgba(108,99,255,.08)':'var(--s1)')+';border:1.5px solid '+(active?'var(--p)':'var(--border)')+';border-radius:10px;margin:0 0 6px;cursor:pointer;'+(locked?'opacity:.65':'')+'">';
    html+='<div style="font-size:20px">'+t.icon+'</div>';
    html+='<div style="flex:1"><div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--t1)">'+t.label+(locked?(typeof proBadge==='function'?proBadge(true):''):'')+'</div></div>';
    html+=active?'<div style="width:8px;height:8px;border-radius:50%;background:var(--p);flex-shrink:0"></div>':'';
    html+='</div>';
  });
  list.innerHTML=html;
  list.onclick=function(e){
    var row=e.target.closest('[data-themekey]');
    if(row) setAppTheme(row.getAttribute('data-themekey'));
  };
  var sub=document.getElementById('appThemeSub');
  var th=APP_THEMES.find(function(x){return x.key===current;});
  if(sub&&th) sub.textContent=th.icon+' '+th.label;
}
// NFU-03 FIX: Listen for OS-level dark/light mode changes and apply them at runtime.
// Only fires when user has NOT set an explicit theme preference (S.theme === 'auto').
// Existing explicit dark/light user choice is always respected.
(function initSystemThemeListener(){
  if(!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    // Only auto-apply if user hasn't explicitly chosen a theme
    if(typeof S !== 'undefined' && (S.theme === 'auto' || !S.theme)){
      applyTheme(mq.matches ? 'dark' : 'light');
    }
  };
  try { mq.addEventListener('change', apply); } catch(_) {
    try { mq.addListener(apply); } catch(__) {} // Safari <14 fallback
  }
})();
function toggleSmartAlerts(){
  const el=document.getElementById('tog-notif'); const on=el.classList.contains('on');
  const newVal=!on; setTog('tog-notif',newVal);
  S.settings.notif=newVal; saveS();
  // Persist to SharedPrefs so SmartNotificationWorker respects it immediately
  if(IS_NATIVE) try{ N.saveSmartAlertsEnabled(newVal); }catch(_){}
  toast('Smart alerts '+(newVal?'enabled':'disabled'),'info');
}
function toggleSetting(togId,key){
  const el=document.getElementById(togId); const on=el.classList.contains('on');
  setTog(togId,!on); S.settings[key]=!on; saveS();
  toast(`${key}: ${!on?'ON':'OFF'}`,'info');
}
function setTog(id,on){ const el=document.getElementById(id); if(!el) return; el.classList.toggle('on',on); el.classList.toggle('off',!on); }

// ── #15: Clear all data ─────────────────────────────────────────────────────
function confirmClearData(){
  showConfirm('Clear All Data?','Resets all categories, limits, locked/hidden apps, timers, goals and settings.',()=>{
    nCall('clearAllData');       // clear Kotlin SharedPreferences
    localStorage.clear();        // clear JS localStorage
    nCall('saveStreakGoalMins', 240); // reset goal pref in Kotlin
    S = defaultState();
    CATS_MAP={}; DAILY_USE=[]; WEEKLY=[]; TODAY_MINS=0; PICKUPS=0; GHOSTS=[]; _allAppsCache=null; _catAppOrderCache=null;
    if(IS_NATIVE){ try{ buildCatsMap(JSON.parse(N.refreshApps()||'[]')); }catch(e){} }
    renderAll();
    toast('All data cleared','warn');
  });
}

// ── #13: Streak goal setting ────────────────────────────────────────────────
let selectedGoalMins = null;

/* ── Goal modal open / close helpers (self-contained, no CSS-class dependency) ── */
function _closeGoalModal() {
  var el = document.getElementById('streak-goal-modal');
  if (el) el.remove();          // remove from DOM entirely so it can't bleed across tabs
}

function _ensureGoalModal() {
  // Always remove any stale instance first so re-opening is always clean
  _closeGoalModal();

  var presets = [
    { mins: 60,  label: '1h' },

    { mins: 120, label: '2h' },
    { mins: 180, label: '3h' },
    { mins: 240, label: '4h' },
    { mins: 300, label: '5h' },
    { mins: 360, label: '6h' },
  ];
  var btnHtml = presets.map(function(p) {
    return '<div class="dur-btn" onclick="selGoal(' + p.mins + ',this)">' + p.label + '</div>';
  }).join('');

  var el = document.createElement('div');
  el.id = 'streak-goal-modal';
  // Inline styles guarantee correct overlay behaviour regardless of external CSS
  el.style.cssText = [
    'position:fixed','inset:0','z-index:9999',
    'background:rgba(0,0,0,.65)',
    'display:flex','align-items:flex-end','justify-content:center',
    'padding:0 0 env(safe-area-inset-bottom,0) 0',
  ].join(';');

  el.innerHTML =
    '<div class="modal-sheet" style="width:100%;max-width:480px;' +
        'background:var(--bg,#0f0f1a);border-radius:20px 20px 0 0;' +
        'padding:16px 20px 28px;box-shadow:0 -8px 40px rgba(0,0,0,.5)">' +
      '<div class="modal-handle" style="width:36px;height:4px;border-radius:2px;' +
          'background:var(--border,rgba(255,255,255,.15));margin:0 auto 18px"></div>' +
      '<div style="font-family:var(--ff-d);font-size:18px;font-weight:700;' +
          'color:var(--t1);margin-bottom:6px">Daily Screen Time Goal</div>' +
      '<div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);' +
          'margin-bottom:18px">Choose how much daily screen time you\'re aiming for</div>' +
      '<div id="goal-grid" style="display:grid;grid-template-columns:repeat(3,1fr);' +
          'gap:8px;margin-bottom:20px">' +
        btnHtml +
      '</div>' +
      '<button type="button" onclick="saveStreakGoal()" style="width:100%;padding:14px;border-radius:14px;' +
          'border:none;background:linear-gradient(135deg,var(--p),var(--c));color:#fff;' +
          'font-family:var(--ff-d);font-size:15px;font-weight:700;cursor:pointer">' +
          'Set Goal</button>' +
      '<button type="button" onclick="_closeGoalModal()" style="width:100%;padding:12px;border-radius:14px;' +
          'border:1px solid var(--border2,rgba(255,255,255,.12));background:transparent;' +
          'color:var(--t2);font-family:var(--ff-m);font-size:13px;cursor:pointer;' +
          'margin-top:8px">Cancel</button>' +
    '</div>';

  document.body.appendChild(el);
  // Backdrop tap closes the modal
  el.addEventListener('click', function(e) { if (e.target === el) _closeGoalModal(); });
}

function openStreakGoalPicker(){
  _ensureGoalModal();   // always creates fresh; modal is now in the DOM
  selectedGoalMins = S.streakGoalMins || 240;
  document.querySelectorAll('#goal-grid .dur-btn').forEach(btn=>{
    const v=parseInt(btn.getAttribute('onclick').match(/selGoal\((\d+)/)?.[1]);
    btn.classList.toggle('on', v===selectedGoalMins);
  });
  // Modal is already visible (position:fixed display:flex) — no openModal() needed
}
function selGoal(mins,btn){
  selectedGoalMins=mins;
  document.querySelectorAll('#goal-grid .dur-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}
function openEditNameModal(){
  document.getElementById('settings-name-input').value = S.userName||'';
  openModal('edit-name-modal');
  setTimeout(()=>document.getElementById('settings-name-input').focus(), 350);
}
function saveUserName(){
  const val=(document.getElementById('settings-name-input').value||'').trim();
  S.userName = val;
  saveS();
  updateNameUI();
  updateGreeting();
  closeModal('edit-name-modal');
  toast(val?`Hi, ${val}!`:'Name removed','success');
}
function clearUserName(){
  S.userName='';
  saveS();
  document.getElementById('settings-name-input').value='';
  updateNameUI();
  updateGreeting();
  closeModal('edit-name-modal');
  toast('Name removed','info');
}
function updateNameUI(){
  const name=S.userName||'';
  const sub=document.getElementById('name-sub');
  const disp=document.getElementById('name-display');
  if(sub) sub.textContent=name?'Tap to change':'Tap to add your name';
  if(disp) disp.textContent=name;
}

function saveStreakGoal(){
  S.streakGoalMins = selectedGoalMins || 240;
  saveS();
  // Sync to Android SharedPrefs so Kotlin getSmartTips() / getNotifications() see the real goal
  if(IS_NATIVE) nCall('saveStreakGoalMins', S.streakGoalMins);
  updateStreakGoalSub();
  _closeGoalModal();
  toast(`Goal set to ${fmtM(S.streakGoalMins)}/day`,'success');
  // Contextual notification ask: user just set a goal → offer alerts for when they hit it
  _maybeAskNotifPerm('goal');
}
function updateStreakGoalSub(){
  const mins = S.streakGoalMins || 240;
  const sub = document.getElementById('streak-goal-sub');
  if(sub) sub.textContent = fmtM(mins)+' per day';
}


// ── #14: Bedtime setting ────────────────────────────────────────────────────
/* ── Bedtime config helpers ─────────────────────────────────────────────────── */

/**
 * _getBedtimeCfg — reads the persisted bedtime configuration.
 * Defined here so it is available regardless of app-focus.js load order.
 * If app-focus.js defines its own version later, that will silently win via
 * the function-hoisting / reassignment order; this acts as the safe fallback.
 */
if (typeof _getBedtimeCfg === 'undefined') {
  function _getBedtimeCfg() {
    // 1. Try native bridge first — single source of truth
    if (IS_NATIVE && typeof N !== 'undefined' && typeof N.getBedtimeSettings === 'function') {
      try {
        const raw = N.getBedtimeSettings();
        if (raw) return JSON.parse(raw);
      } catch (_) {}
    }
    // 2. Fall back to JS state
    return {
      bedHour:       S.settings.bedtimeHour   || 22,
      bedMinute:     S.settings.bedtimeMinute  || 0,
      wakeHour:      S.settings.wakeHour       || 7,
      wakeMinute:    S.settings.wakeMinute      || 0,
      blockedApps:   S.settings.bedtimeBlocked || [],
      enabled:       !!S.settings.bedtime,
      windDown:      S.settings.bedtimeWindDown       !== false,
      morningSummary:S.settings.bedtimeMorningSummary !== false,
    };
  }
}

// BUG 6 FIX: the previous version always output ':00' for minutes and did not
// handle decimal hours (e.g. 7.75 rendered as "7.75:00 PM" instead of "7:45 PM").
// app-settings.js is loaded AFTER app-focus.js (see index.html script order), so
// this definition was silently overwriting the correct version in app-focus.js.
// Now both files share the same implementation.
function _fmt12(h) {
  const hh  = Math.floor(h);
  const mm  = Math.round((h - hh) * 60);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return h12 + ':' + String(mm).padStart(2, '0') + ' ' + (hh >= 12 ? 'PM' : 'AM');
}

/* Picker local state (reset on each open) */
const _btPickerState = {};
let   _btBlockedApps = [];   // working copy while picker is open

/* ── Bedtime streak helpers ─────────────────────────────────────────────────── */

/* ── Main picker ────────────────────────────────────────────────────────────── */
/* Routes to Focus tab inline card — no duplicate modal needed.               */

function openBedtimePicker() {
  if (!ProTier.isPro) { ProTier.triggerUpsell('BEDTIME_MODE'); return; }
  activateTab('focus');
  setTimeout(() => {
    // ✅ Switch to Habits subtab where the bedtime card lives
    if (typeof _switchFocusSubTab === 'function') _switchFocusSubTab('habits');
    setTimeout(() => {
      const strip = document.getElementById('focus-bedtime-strip');
      if (strip) strip.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, 120);
}

/* (legacy picker HTML removed — openBedtimePicker now routes to Focus tab) */

/* ── Picker helpers ─────────────────────────────────────────────────────────── */

function _bedtimeToggle(key) {
  _btPickerState[key] = !(_btPickerState[key]);
  const togMap = {
    grayscale: 'bt-tog-gray', windDown: 'bt-tog-wind',
    dimBrightness: 'bt-tog-dim', morningSummary: 'bt-tog-morning'
  };
  const tog = document.getElementById(togMap[key]);
  if (tog) tog.className = 'tog ' + (_btPickerState[key] ? 'on' : 'off');
}

function _bedtimePreview() {
  const bedH  = parseInt(document.getElementById('bt-bed-hour')?.value  ?? 22);
  const wakeH = parseInt(document.getElementById('bt-wake-hour')?.value ?? 7);
  const el    = document.getElementById('bt-duration-preview');
  if (!el) return;
  let mins = (wakeH - bedH) * 60;
  if (mins <= 0) mins += 1440;
  const h = Math.floor(mins / 60), m = mins % 60;
  el.textContent = `${h}h${m > 0 ? ' ' + m + 'm' : ''} sleep window · DND lifts at ${_fmt12(wakeH)}`;
}

function _btRequestWriteSettings() {
  if (IS_NATIVE && typeof N.requestWriteSettingsPermission === 'function') {
    N.requestWriteSettingsPermission();
    toast('Grant "Modify system settings", then reopen Bedtime settings', 'info', 3500);
  }
}

/* ── Bedtime blocked-app picker ─────────────────────────────────────────────── */

/* _btOpenBlockPicker is now handled inline by _btInlineOpenBlockPicker() in app-focus.js.
 * This stub is kept so any legacy call sites don't throw. */


/* Legacy chip refresh — targets the old panel chip container.
 * Kept for backwards compat; inline card uses _btRefreshInlineChips() instead. */
function _btRefreshBlockedChips() {
  const wrap = document.getElementById('bt-blocked-chips');
  if (!wrap) return;
  const chips = _btBlockedApps.slice(0, 5).map(a => `
    <div class="focus-app-chip blocked" style="margin-bottom:4px">
      <div class="focus-chip-ico">${appIco(a.packageName, 20, 5)}</div>
      <span>${a.name.split(' ')[0]}</span>
      <span onclick="event.stopPropagation();_btRemoveBlockedApp('${a.packageName}')"
            style="opacity:.45;font-size:12px;margin-left:2px;cursor:pointer">×</span>
    </div>`).join('');
  const overflow = _btBlockedApps.length > 5
    ? `<div class="focus-app-chip" style="background:var(--s2);border-color:var(--border2);
         color:var(--t3);font-family:var(--ff-m);font-size:10px;cursor:default">
         +${_btBlockedApps.length - 5}</div>` : '';
  const addBtn = `<div onclick="_btInlineOpenBlockPicker()"
       style="font-family:var(--ff-m);font-size:11px;color:var(--p);cursor:pointer;
              white-space:nowrap">+ Add</div>`;
  wrap.innerHTML = chips + overflow + (_btBlockedApps.length < 10 ? addBtn : '');
}

/* Called by saveFocusPick() when picker mode === 'bedtime'.
 * Receives the final apps array; delegates to FocusBedtime which owns the
 * internal _btBlockedApps list and the chip refresh logic.
 *
 * BUG FIX: the previous version of this function in app-settings.js set a
 * LOCAL _btBlockedApps variable (not the one inside FocusBedtime's IIFE) and
 * called _btRefreshInlineChips() which is NOT a global — it lives inside the
 * IIFE.  That meant chips never updated and the "apps updated" toast appeared
 * with nothing shown.  Now we delegate entirely to FocusBedtime.onBlockPickerSave
 * which has the correct scope. */

/* ── Save ───────────────────────────────────────────────────────────────────── */

function _saveBedtimePicker() {
  const cfg       = _getBedtimeCfg();
  const bedHour   = parseInt(document.getElementById('bt-bed-hour')?.value  ?? cfg.bedHour);
  const wakeHour  = parseInt(document.getElementById('bt-wake-hour')?.value ?? cfg.wakeHour);

  const newCfg = {
    bedHour,
    wakeHour,
    windDown:       _btPickerState.windDown        ?? (cfg.windDown ?? true),
    // grayscale removed — Google API no longer supports it
    // dimBrightness removed — requires WRITE_SETTINGS, not exposed in UI
    morningSummary: _btPickerState.morningSummary  ?? (cfg.morningSummary ?? true),
    blockedApps:    _btBlockedApps,
    enabled:        true,
  };

  if (IS_NATIVE) {
    const hasDnd = typeof N.hasDndPermission === 'function' && N.hasDndPermission();
    if (!hasDnd) {
      const modal = document.getElementById('bedtime-modal');
      if (modal) closeModal('bedtime-modal');
      else closePanel('bedtime-picker-panel');
      showConfirm(
        'Do Not Disturb access needed',
        'Bedtime Mode silences calls and notifications at night. Tap Grant to allow it.',
        () => {
          try { N.openDndSettings(); } catch (_) { try { nCall('openDndSettings'); } catch (e) {} }
          window._pendingBedtimeEnable = newCfg;
          setTimeout(updatePermUI, 1500);
        },
        'Grant Permission', 'Cancel'
      );
      return;
    }
  }

  _applyBedtimeConfig(newCfg);
  Object.keys(_btPickerState).forEach(k => delete _btPickerState[k]);
  _btBlockedApps = [];
  const modal = document.getElementById('bedtime-modal');
  if (modal) closeModal('bedtime-modal');
  else closePanel('bedtime-picker-panel');
}

/* ── Apply config ───────────────────────────────────────────────────────────── */

/* ── Disable ────────────────────────────────────────────────────────────────── */

/* ── Bedtime blocked-app calming overlay ─────────────────────────────────── */
/**
 * Called by native (AppBridge) when user tries to open a bedtime-blocked app.
 * Also callable from JS for demo / overlay-permission-missing scenarios.
 *   Native (Kotlin): webView.evaluateJavascript(
 *     "if(window.onBedtimeAppBlocked) window.onBedtimeAppBlocked('${appName}');", null)
 */
window.onBedtimeAppBlocked = function(appName) {
  const cfg     = _getBedtimeCfg();
  const wakeStr = typeof _fmt12 === 'function' ? _fmt12(cfg.wakeHour || 7) : '7:00 AM';

  // Remove any existing overlay
  document.getElementById('bedtime-block-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'bedtime-block-overlay';
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:9999',
    'background:linear-gradient(160deg,#0a0a18 0%,#0d1022 60%,#070b14 100%)',
    'display:flex','flex-direction:column',
    'align-items:center','justify-content:center',
    'padding:32px 28px'
  ].join(';');

  overlay.innerHTML = `
    <div style="font-size:56px;margin-bottom:16px;
                filter:drop-shadow(0 0 18px rgba(108,99,255,.5))">🌙</div>
    <div style="font-family:var(--ff-d,sans-serif);font-size:22px;font-weight:700;
                color:#e8e6ff;text-align:center;margin-bottom:10px;line-height:1.3">
      Time to rest
    </div>
    <div style="font-family:var(--ff-m,sans-serif);font-size:14px;
                color:rgba(255,255,255,.55);text-align:center;line-height:1.7;
                margin-bottom:6px;max-width:280px">
      <strong style="color:rgba(255,255,255,.8)">${appName || 'This app'}</strong>
      is blocked during your bedtime window.
    </div>
    <div style="font-family:var(--ff-m,sans-serif);font-size:12px;
                color:rgba(108,99,255,.8);margin-bottom:40px">
      Lifts at ${wakeStr}
    </div>
    <!-- Breathing ring -->
    <div id="bt-breathe-ring" style="width:72px;height:72px;border-radius:50%;
                border:2px solid rgba(108,99,255,.35);
                box-shadow:0 0 24px rgba(108,99,255,.25);
                display:flex;align-items:center;justify-content:center;
                margin-bottom:40px">
      <div style="width:48px;height:48px;border-radius:50%;
                  background:rgba(108,99,255,.15)"></div>
    </div>
    <button type="button" onclick="_bedtimeSnooze(15);document.getElementById('bedtime-block-overlay')?.remove()"
      style="width:100%;max-width:280px;padding:14px;border-radius:14px;
             border:1px solid rgba(108,99,255,.35);background:rgba(108,99,255,.12);
             color:#c4c0ff;font-family:var(--ff-m,sans-serif);
             font-size:13px;font-weight:700;cursor:pointer;margin-bottom:10px">
      Just 15 more minutes
    </button>
    <button type="button" onclick="document.getElementById('bedtime-block-overlay')?.remove()"
      style="width:100%;max-width:280px;padding:12px;border-radius:14px;
             border:none;background:transparent;color:rgba(255,255,255,.3);
             font-family:var(--ff-m,sans-serif);font-size:12px;cursor:pointer">
      Back to Aurelo
    </button>
  `;

  // Inject breathing keyframes once
  if (!document.getElementById('bt-block-keyframes')) {
    const s = document.createElement('style');
    s.id = 'bt-block-keyframes';
    s.textContent = `
      @keyframes bt-breathe {
        0%,100% { transform:scale(1);    opacity:.7; }
        50%      { transform:scale(1.18); opacity:1;  }
      }
      #bt-breathe-ring           { animation:bt-breathe 4s ease-in-out infinite; }
      #bt-breathe-ring > div     { animation:bt-breathe 4s ease-in-out infinite reverse; }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);
};

// In app-settings.js or app-focus.js
window.onBedtimeSnoozeEnded = function() {
  if (typeof _renderBedtimeStrip === 'function') _renderBedtimeStrip();
  toast('Bedtime mode resumed 🌙', 'info');
};

/**
 * Returns true if the given packageName is bedtime-blocked right now.
 * Use to dim/badge blocked app icons in the grid during bedtime.
 */
function _isBedtimeBlocked(packageName) {
  if (!S.settings.bedtime) return false;
  const cfg    = _getBedtimeCfg();
  const nowDec = new Date().getHours() + new Date().getMinutes() / 60;
  const bedDec = cfg.bedHour  + (cfg.bedMinute  || 0) / 60;
  const wakeDec= cfg.wakeHour + (cfg.wakeMinute || 0) / 60;
  const inWin  = bedDec > wakeDec
    ? nowDec >= bedDec || nowDec < wakeDec
    : nowDec >= bedDec && nowDec < wakeDec;
  if (!inWin) return false;
  return Array.isArray(cfg.blockedApps) &&
    cfg.blockedApps.some(a => a.packageName === packageName);
}

/* ── Resume handler — complete pending bedtime enable after DND grant ─────── */
(function _patchResumeForBedtime() {
  const _orig = window.onAppResume;
  window.onAppResume = function () {
    if (typeof _orig === 'function') _orig();
    if (window._pendingBedtimeEnable && IS_NATIVE) {
      const cfg = window._pendingBedtimeEnable;
      window._pendingBedtimeEnable = null;
      const hasDnd = typeof N.hasDndPermission === 'function' && N.hasDndPermission();
      if (hasDnd) {
        _applyBedtimeConfig(cfg);
      } else {
        toast('DND permission not granted — bedtime not enabled', 'warn');
      }
    }
  };
})();

/* ── Background poller (minute-level boundary detection) ─────────────────── */
let _bedtimePoller = null;
function scheduleBedtimeCheck() {
  clearInterval(_bedtimePoller);
  if (!IS_NATIVE || !S.settings.bedtime) return;
  window._bedtimeWindowActive = null;

  function checkBedtime() {
    if (!S.settings.bedtime) { clearInterval(_bedtimePoller); return; }
    const hasDnd = typeof N.hasDndPermission === 'function' && N.hasDndPermission();
    if (!hasDnd) return;
    const cfg    = _getBedtimeCfg();
    const nowDec = new Date().getHours() + new Date().getMinutes() / 60;
    const bedDec = cfg.bedHour  + (cfg.bedMinute  || 0) / 60;
    const wakeDec= cfg.wakeHour + (cfg.wakeMinute || 0) / 60;
    const inWindow = bedDec > wakeDec
      ? nowDec >= bedDec || nowDec < wakeDec
      : nowDec >= bedDec && nowDec < wakeDec;

    const wasActive = window._bedtimeWindowActive;
    window._bedtimeWindowActive = inWindow;

    try { N.setBedtimeDnd(inWindow); } catch (_) {}

    if (inWindow && wasActive === false) {
        try { N.setBedtimeDnd(true); } catch (_) {}
        try {
            const cfg2 = _getBedtimeCfg();
            N.startBedtimeBlock(JSON.stringify(cfg2.blockedApps || []));
        } catch (_) {}
        if (typeof _renderBedtimeStrip === 'function') _renderBedtimeStrip();
    } else if (!inWindow && wasActive === true) {
        try { N.recordBedtimeOff(); } catch (_) {}
        try { N.stopBedtimeBlock(); } catch (_) {}
        if (typeof _renderBedtimeStrip === 'function') _renderBedtimeStrip();
    }
  }

  checkBedtime();
  _bedtimePoller = setInterval(checkBedtime, 60_000);
}

/* Immediate boundary check on app resume */
(function _patchResumeForBedtimeCheck() {
  const _orig = window.onAppResume;
  window.onAppResume = function () {
    if (typeof _orig === 'function') _orig();
    if (IS_NATIVE && S.settings.bedtime) {
      const cfg    = _getBedtimeCfg();
      const nowDec = new Date().getHours() + new Date().getMinutes() / 60;
      const bedDec = cfg.bedHour  + (cfg.bedMinute  || 0) / 60;
      const wakeDec= cfg.wakeHour + (cfg.wakeMinute || 0) / 60;
      const inWindow = bedDec > wakeDec
        ? nowDec >= bedDec || nowDec < wakeDec
        : nowDec >= bedDec && nowDec < wakeDec;
      try { N.setBedtimeDnd(inWindow); } catch (_) {}
      if (!inWindow) {
        // grayscale removed — Google API no longer supports it
        try { N.recordBedtimeOff(); } catch (_) {}
        window._bedtimeWindowActive = false;
        if (typeof _renderBedtimeStrip === 'function') _renderBedtimeStrip();
      }
    }
  };
})();

/* ── updateBedtimeSub ───────────────────────────────────────────────────────── */

function updateBedtimeSub() {
  const sub = document.getElementById('bedtime-sub');
  if (!sub) return;
  if (S.settings.bedtime) {
    if (typeof _getBedtimeCfg !== 'function') { sub.textContent = 'Enabled'; return; }
    const cfg = _getBedtimeCfg();
    function decStr(h, m) {
      const mm = m || 0;
      const am = h < 12;
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return h12 + ':' + String(mm).padStart(2, '0') + ' ' + (am ? 'AM' : 'PM');
    }
    sub.textContent = decStr(cfg.bedHour, cfg.bedMinute) + ' → ' + decStr(cfg.wakeHour, cfg.wakeMinute);
  } else {
    sub.textContent = 'Disabled';
  }
}

// ── #1: Onboarding permission helpers ───────────────────────────────────────
function obGrantUsage(){ if(IS_NATIVE) N.requestUsagePermission(); }
function obGrantAcc(){ if(IS_NATIVE) N.requestAccessibilitySettings(); }

// ── #2: Handle new app install / uninstall ──────────────────────────────────
window.onAppsChanged = function(action, pkg){
  // Re-read cached apps (preScan ran in background) and rebuild categories
  if(IS_NATIVE){
    try{
      const apps = JSON.parse(N.getCachedApps()||'[]');
      buildCatsMap(apps);
      if(typeof renderCategoryGrid === 'function') renderCategoryGrid();
      if(typeof renderCategoryList === 'function') renderCategoryList();
      if(action==='android.intent.action.PACKAGE_ADDED'){
        toast('New app detected — categories updated','info');
      }
    }catch(e){}
  }
};

// ── #12: Country-aware discover ─────────────────────────────────────────────
// (getDiscoverSuggestions in AppBridge already returns suggestions; here we augment UI)

/* ════════════════════════════════════════════════════ */

function applySettings(){
  setTog('tog-notif', S.settings.notif!==false);
  // setTog('tog-theme', S.theme!=='light');
  updateStreakGoalSub();
  updateBedtimeSub();
    // Defer so ProTier.init() has run before we read isPro
    setTimeout(function() {
     if (typeof _updateProUI === 'function') _updateProUI();
    }, 0);
}

// ── Settings identity card — dual-purpose for free vs Pro users ──────────────
// Free: shows upgrade CTA below the app name in the identity card.
// Pro:  shows gold ✦ PRO pill, matching the main header behaviour.
function _updateSettingsIdentityCard(isPro) {
  const proSlot = document.getElementById('settings-pro-slot');
  if (!proSlot) return;
  if (isPro) {
    proSlot.innerHTML = '';
  } else {
    proSlot.innerHTML = `
      <div onclick="event.stopPropagation();ProUpsell.show('upgrade_pro')"
        style="display:flex;align-items:center;gap:8px;
        margin-top:10px;padding:10px 14px;border-radius:12px;
        background:linear-gradient(135deg,rgba(124,111,247,.15),rgba(155,111,255,.08));
        border:1px solid rgba(124,111,247,.3);cursor:pointer;
        transition:opacity .2s" onmousedown="this.style.opacity='.8'" onmouseup="this.style.opacity='1'">
        <span style="font-size:14px">✦</span>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:#c4c0ff;line-height:1.2">Upgrade to Pro</div>
          <div style="font-family:var(--ff-m);font-size:10px;color:#7c6ff7;margin-top:1px">Unlock all features · tap to see plans</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c6ff7" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }
}

// Also update updatePermBadge to refresh onboarding perm badges
function updatePermBadge(){
  const usageBadge=document.getElementById('ob-usage-badge');
  if(usageBadge && IS_NATIVE){
    const granted=N.hasUsagePermission();
    usageBadge.textContent=granted?'Granted ✓':'Tap to grant';
    usageBadge.style.background=granted?'rgba(18,212,138,.15)':'rgba(240,78,122,.15)';
    usageBadge.style.borderColor=granted?'rgba(18,212,138,.3)':'rgba(240,78,122,.3)';
    usageBadge.style.color=granted?'var(--g)':'var(--r)';
    document.getElementById('ob-perm-usage').style.borderColor=granted?'rgba(18,212,138,.3)':'rgba(108,99,255,.2)';
  }
  const notifBadge=document.getElementById('ob-notif-badge');
  if(notifBadge && IS_NATIVE){
    const granted=typeof N.hasNotificationPermission==='function'&&N.hasNotificationPermission();
    if(granted){
      notifBadge.textContent='Granted ✓'; notifBadge.style.background='rgba(18,212,138,.15)';
      notifBadge.style.borderColor='rgba(18,212,138,.3)'; notifBadge.style.color='var(--g)';
      const row=document.getElementById('ob-perm-notif');
      if(row) row.style.borderColor='rgba(18,212,138,.3)';
    }
  }
}
function obGrantNotif(){ if(IS_NATIVE){ try { N.requestNotificationPermission(); } catch(e){ try { N.openNotificationSettings(); } catch(_){} } } }

// ── Permission prompts go directly to Android system dialogs ──────────────
function maybePromptMissingPerms(){
  if(!IS_NATIVE) return;
  // Check live permission — if already granted, do nothing.
  const hasNotif = typeof N.hasNotificationPermission==='function' ? N.hasNotificationPermission() : true;
  if(hasNotif) return;
  // Use SharedPreferences via AppBridge to reliably persist the "already asked" flag.
  // localStorage is not reliably persistent in this Android WebView context.
  const ASKED_FLAG = 'notif_perm_asked_v1';
  try{
    if(typeof N.getStringPref==='function' && N.getStringPref(ASKED_FLAG)) return;
    if(typeof N.setStringPref==='function') N.setStringPref(ASKED_FLAG, '1');
  }catch(_){}
  setTimeout(()=>{ try{ nCall('requestNotificationPermission'); }catch(_){} }, 800);
}

// Called by MainActivity when notification runtime permission result returns
window.onNotifPermResult = function(granted){
  const badge=document.getElementById('ob-notif-badge');
  if(badge){
    badge.textContent=granted?'Granted ✓':'Tap to allow';
    badge.style.background=granted?'rgba(18,212,138,.15)':'rgba(108,99,255,.15)';
    badge.style.borderColor=granted?'rgba(18,212,138,.3)':'rgba(108,99,255,.25)';
    badge.style.color=granted?'var(--g)':'var(--t2)';
    const row=document.getElementById('ob-perm-notif');
    if(row) row.style.borderColor=granted?'rgba(18,212,138,.3)':'rgba(108,99,255,.2)';
  }
  if(granted) toast('Notifications enabled ✓','success');
};

/* ═══ CONFIRM ═════════════════════════════════════════ */
let confirmCb=null;
function showConfirm(title,body,cb,okLabel,cancelLabel){
  document.getElementById('cdlg-title').textContent=title;
  document.getElementById('cdlg-body').textContent=body;
  confirmCb=cb;
  const okBtn=document.getElementById('cdlg-ok');
  const cancelBtn=document.querySelector('#confirm-dlg .confirm-btn.cancel');
  if(okBtn) okBtn.textContent=okLabel||'Confirm';
  if(cancelBtn) cancelBtn.textContent=cancelLabel||'Cancel';
  document.getElementById('confirm-dlg').classList.add('open');
}
function closeConfirm(){ document.getElementById('confirm-dlg').classList.remove('open'); confirmCb=null; }
document.getElementById('cdlg-ok').addEventListener('click',()=>{ const _cb=confirmCb; closeConfirm(); if(_cb) _cb(); });

/* ═══ TOAST ═══════════════════════════════════════════ */
function toast(msg,type='info',duration){
  const w=document.getElementById('toast-wrap');
  if(!w) return; // toast-wrap not in DOM yet — silently ignore
  const t=document.createElement('div');
  t.className=`toast toast-${type}`; t.textContent=msg; w.appendChild(t);
  const ms=duration||(type==='success'?1800:type==='warn'?2000:msg.includes('efresh')?900:2200);
  setTimeout(()=>{ t.style.transition='opacity .3s,transform .3s'; t.style.opacity='0'; t.style.transform='translateY(-4px)'; setTimeout(()=>t.remove(),300); },ms);
}

/* ═══ UTILS ═══════════════════════════════════════════ */
function fmtM(m){ if(!m||m<=0) return ''; const h=Math.floor(m/60),mn=m%60; return h>0?(mn>0?`${h}h ${mn}m`:`${h}h`):`${mn}m`; }
function nCall(method,...args){ try{ if(N&&typeof N[method]==='function') return N[method](...args); }catch(e){ console.error('[Bridge]',method,e); } return null; }

/* ═══ BOOT ════════════════════════════════════════════ */
applySettings();
setCatView(S.catView);