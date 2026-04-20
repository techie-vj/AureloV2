/* ═══ APP SELECTION PANELS ════════════════════════════ */

/* ── Shared: panel filter state ────────────────────── */
var _panelFilters = { lock: 'all', hide: 'all', timer: 'all' };

/**
 * Toggle All / Selected filter pills for lock, hide, timer panels.
 * 'selected' filter: hides rows that aren't checked, auto-expands categories.
 */
function setPanelFilter(panel, filter) {
  _panelFilters[panel] = filter;
  var listId   = panel + '-list';
  var allBtn   = document.getElementById(panel + '-filter-all');
  var selBtn   = document.getElementById(panel + '-filter-selected');
  var saveBtn  = document.getElementById(panel + '-save-btn');

  // Update pill styles
  if (allBtn) {
    var onAll = filter === 'all';
    allBtn.style.background  = onAll ? 'var(--p)' : 'transparent';
    allBtn.style.color       = onAll ? '#fff'     : 'var(--t3)';
    allBtn.style.borderColor = onAll ? 'var(--p)' : 'var(--border2)';
  }
  if (selBtn) {
    var onSel = filter === 'selected';
    selBtn.style.background  = onSel ? 'var(--p)' : 'transparent';
    selBtn.style.color       = onSel ? '#fff'      : 'var(--t3)';
    selBtn.style.borderColor = onSel ? 'var(--p)'  : 'var(--border2)';
  }

  var list = document.getElementById(listId);
  if (!list) return;

  if (filter === 'all') {
    list.querySelectorAll('.cat-pick-group').forEach(function(g) {
      g.style.display = '';
      g.querySelectorAll('.app-sel-row').forEach(function(r) { r.style.display = ''; });
    });
  } else {
    // Selected filter: for timer panel use data-has-timer; others use .app-sel-check.on
    var isTimer = (panel === 'timer');
    list.querySelectorAll('.cat-pick-group').forEach(function(g) {
      var rows = g.querySelectorAll('.app-sel-row');
      var anyOn = false;
      rows.forEach(function(row) {
        var isOn = isTimer
          ? row.getAttribute('data-has-timer') === '1'
          : !!(row.querySelector('.app-sel-check') && row.querySelector('.app-sel-check').classList.contains('on'));
        row.style.display = isOn ? '' : 'none';
        if (isOn) anyOn = true;
      });
      g.style.display = anyOn ? '' : 'none';
      if (anyOn) {
        var catName = g.getAttribute('data-cat') || '';
        var safeKey = listId + '_' + catName.replace(/[^a-zA-Z0-9]/g,'_');
        var appsEl  = document.getElementById('pcap_' + safeKey);
        var arrow   = document.getElementById('pcar_' + safeKey);
        if (appsEl) appsEl.style.display = 'block';
        if (arrow)  arrow.classList.add('open');
      }
    });
  }
}

/* Helper: update save button with selected count */
function _updatePanelSaveBtn(panel, count) {
  var btn = document.getElementById(panel + '-save-btn');
  var labels = { lock: 'Save', hide: 'Save' };
  if (btn) btn.textContent = count > 0 ? (labels[panel] || 'Save') + ' (' + count + ')' : (labels[panel] || 'Save');
}

/* ── Shared: category-aware search + expand/collapse ── */
function filterPanelListCat(listId, query) {
  const q = (query || '').toLowerCase().trim();
  const list = document.getElementById(listId);
  if (!list) return;
  list.querySelectorAll('.cat-pick-group').forEach(group => {
    const catName = (group.getAttribute('data-cat') || '').toLowerCase();
    const catMatch = catName.includes(q);
    const rows = group.querySelectorAll('.app-sel-row');
    let anyApp = false;
    rows.forEach(row => {
      const name = (row.getAttribute('data-name') || '').toLowerCase();
      const panel = listId.replace('-list','');
      const filter = _panelFilters[panel] || 'all';
      const chk    = row.querySelector('.app-sel-check');
      const isOn   = chk && chk.classList.contains('on');
      const matchQ   = !q || catMatch || name.includes(q);
      const matchSel = filter !== 'selected' || isOn;
      const show = matchQ && matchSel;
      row.style.display = show ? '' : 'none';
      if (show) anyApp = true;
    });
    if (q && (catMatch || anyApp)) {
      const safeKey = listId + '_' + group.getAttribute('data-cat').replace(/[^a-zA-Z0-9]/g,'_');
      const appsEl  = document.getElementById('pcap_' + safeKey);
      const arrow   = document.getElementById('pcar_' + safeKey);
      if (appsEl) appsEl.style.display = 'block';
      if (arrow)  arrow.classList.add('open');
    }
    group.style.display = (!q || catMatch || anyApp) ? '' : 'none';
  });
}

function togglePanelCatExpand(listId, catName) {
  const safeKey = listId + '_' + catName.replace(/[^a-zA-Z0-9]/g,'_');
  const appsEl  = document.getElementById('pcap_' + safeKey);
  const arrowEl = document.getElementById('pcar_' + safeKey);
  if (!appsEl) return;
  const isOpen = appsEl.style.display !== 'none';
  appsEl.style.display = isOpen ? 'none' : 'block';
  if (arrowEl) arrowEl.classList.toggle('open', !isOpen);
}

/* Groups any app list into category sections with usage totals */
function _buildPanelCatHTML(listId, apps, rowBuilder) {
  const usageMap = {};
  DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes; });
  const grouped  = {};
  // Use same order as home screen — user's custom order first, then unordered alphabetically
  const _allCatKeys = Object.keys(CATS_MAP);
  const _stored     = (typeof S !== 'undefined' && S.catOrder || []).filter(c => _allCatKeys.includes(c));
  const catOrder    = [..._stored, ..._allCatKeys.filter(c => !_stored.includes(c))];
  catOrder.forEach(cat => { grouped[cat] = []; });
  apps.forEach(a => {
    const cat = catOrder.find(k => CATS_MAP[k].some(x => x.packageName === a.packageName)) || 'Unassigned';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(a);
  });
  let html = '';
  catOrder.forEach(catName => {
    const catApps = grouped[catName];
    if (!catApps.length) return;
    const icon    = (typeof CAT_ICONS !== 'undefined' && CAT_ICONS[catName]) || '📱';
    const catMins = catApps.reduce((s, a) => s + (usageMap[a.packageName] || 0), 0);
    const safeKey = listId + '_' + catName.replace(/[^a-zA-Z0-9]/g,'_');
    html += `
      <div class="cat-pick-group" data-cat="${escAttr(catName)}">
        <div class="cat-pick-hdr" onclick="togglePanelCatExpand('${escAttr(listId)}','${escAttr(catName)}')">
          <div style="font-size:18px;flex-shrink:0">${icon}</div>
          <div style="flex:1;min-width:0">
            <div class="app-sel-name">${escHtml(catName)}</div>
            <div class="app-sel-sub">${catApps.length} app${catApps.length!==1?'s':''}${catMins?' · '+fmtM(catMins)+' today':''}</div>
          </div>
          <div class="cat-pick-arrow" id="pcar_${safeKey}">▶</div>
        </div>
        <div class="cat-pick-apps" id="pcap_${safeKey}" style="display:none">
          ${catApps.map(a => rowBuilder(a, usageMap)).join('')}
        </div>
      </div>`;
  });
  return html;
}

// ── Locked Apps ──────────────────────────────────────
let tempLocked=new Set();
function openPanel_lock(){
  tempLocked=new Set(S.lockedPkgs);
  _panelFilters.lock = 'all';
  setPanelFilter('lock','all');
  renderLockList();
  _updatePanelSaveBtn('lock', tempLocked.size);
}
function renderLockList(){
  const all=Object.values(CATS_MAP).flat();
  document.getElementById('lock-list').innerHTML = _buildPanelCatHTML('lock-list', all, (a, usageMap) => `
    <div class="app-sel-row" data-name="${escAttr(a.name)}"
         onclick="toggleTempLock('${escAttr(a.packageName)}','${escAttr(a.name)}',this)">
      <div class="app-sel-ico">${appIco(a.packageName,40,11)}</div>
      <div style="flex:1;min-width:0">
        <div class="app-sel-name">${escHtml(a.name)}</div>
        ${usageMap[a.packageName]?`<div class="app-sel-sub">${fmtM(usageMap[a.packageName])} today</div>`:''}
      </div>
      <div class="app-sel-check${tempLocked.has(a.packageName)?' on':''}" id="chk-lock-${a.packageName.replace(/\./g,'_')}"></div>
    </div>`);
}
function toggleTempLock(pkg,name,row){
  const chk=document.getElementById('chk-lock-'+pkg.replace(/\./g,'_'));
  if(tempLocked.has(pkg)){
    tempLocked.delete(pkg); chk?.classList.remove('on');
    if(_panelFilters.lock==='selected' && row) row.style.display='none';
  } else {
    if(!ProTier.isPro && tempLocked.size >= ProTier.getLimit('LOCKED_APPS_UNLIMITED')){
      ProTier.triggerUpsell('LOCKED_APPS_UNLIMITED'); return;
    }
    tempLocked.add(pkg); chk?.classList.add('on');
  }
  _updatePanelSaveBtn('lock', tempLocked.size);
}
function saveLockedApps(){
  S.lockedPkgs=[...tempLocked]; saveS();
  nCall('setLockedApps',JSON.stringify(S.lockedPkgs));
  updateLockedSub(); closePanel('lock-panel'); toast(`${S.lockedPkgs.length} apps locked`,'success');
}
function updateLockedSub(){
  document.getElementById('locked-sub').textContent=S.lockedPkgs.length?`${S.lockedPkgs.length} app${S.lockedPkgs.length!==1?'s':''} locked`:'Tap to configure';
}

// ── Hidden Apps ───────────────────────────────────────
let tempHidden=new Set();
function openPanel_hide(){
  tempHidden=new Set(S.hiddenPkgs);
  _panelFilters.hide = 'all';
  setPanelFilter('hide','all');
  renderHideList();
  _updatePanelSaveBtn('hide', tempHidden.size);
}
function renderHideList(){
  let all = [];
  if(IS_NATIVE){ try{ all = JSON.parse(N.getAllApps()||'[]'); }catch(e){} }
  if(!all.length) all = Object.values(CATS_MAP).flat();
  document.getElementById('hide-list').innerHTML = _buildPanelCatHTML('hide-list', all, (a, usageMap) => `
    <div class="app-sel-row" data-name="${escAttr(a.name)}"
         onclick="toggleTempHide('${escAttr(a.packageName)}',this)">
      <div class="app-sel-ico">${appIco(a.packageName,40,11)}</div>
      <div style="flex:1;min-width:0">
        <div class="app-sel-name">${escHtml(a.name)}</div>
        <div class="app-sel-sub" style="${tempHidden.has(a.packageName)?'color:var(--r)':''}">
          ${tempHidden.has(a.packageName)?'Hidden':(usageMap[a.packageName]?fmtM(usageMap[a.packageName])+' today':'')}
        </div>
      </div>
      <div class="app-sel-check${tempHidden.has(a.packageName)?' on':''}" id="chk-hide-${a.packageName.replace(/\./g,'_')}"></div>
    </div>`);
}
function toggleTempHide(pkg,row){
  const chk=document.getElementById('chk-hide-'+pkg.replace(/\./g,'_'));
  if(tempHidden.has(pkg)){
    tempHidden.delete(pkg); chk?.classList.remove('on');
    if(_panelFilters.hide==='selected' && row) row.style.display='none';
  } else {
    if(!ProTier.isPro && tempHidden.size >= ProTier.getLimit('HIDDEN_APPS_UNLIMITED')){
      ProTier.triggerUpsell('HIDDEN_APPS_UNLIMITED'); return;
    }
    tempHidden.add(pkg); chk?.classList.add('on');
  }
  _updatePanelSaveBtn('hide', tempHidden.size);
}
function saveHiddenApps(){
  S.hiddenPkgs=[...tempHidden]; saveS();
  nCall('setHiddenApps',JSON.stringify(S.hiddenPkgs));
  updateHiddenSub();
  if(IS_NATIVE){ buildCatsMap(JSON.parse(N.refreshApps()||'[]')); renderCategoryGrid(); renderCategoryList(); }
  closePanel('hide-panel'); toast(`${S.hiddenPkgs.length} apps hidden`,'success');
}
function updateHiddenSub(){
  document.getElementById('hidden-sub').textContent=S.hiddenPkgs.length?`${S.hiddenPkgs.length} app${S.hiddenPkgs.length!==1?'s':''} hidden`:'Hide from categories';
}

// ── App Timers ────────────────────────────────────────
function renderTimerList(){
  const all=Object.values(CATS_MAP).flat();
  const limits=S.limits;
  const isPro = ProTier.isPro;
  const activeTimerCount = Object.keys(limits).length;
  document.getElementById('timer-list').innerHTML = _buildPanelCatHTML('timer-list', all, (a, usageMap) => {
    const hasLimit = !!limits[a.packageName];
    const atLimit  = !isPro && !hasLimit && activeTimerCount >= ProTier.getLimit('TIMER_APPS_UNLIMITED');
    const onclick  = atLimit
      ? `ProTier.triggerUpsell('TIMER_APPS_UNLIMITED')`
      : `openTimerForApp('${escAttr(a.packageName)}','${escHtml(a.name)}',${usageMap[a.packageName]||0})`;
    return `
    <div class="app-sel-row" data-name="${escAttr(a.name)}" data-has-timer="${hasLimit?'1':'0'}"
         onclick="${onclick}" style="${atLimit?'opacity:.55':''}">
      <div class="app-sel-ico">${appIco(a.packageName,40,11)}</div>
      <div style="flex:1;min-width:0">
        <div class="app-sel-name">${escHtml(a.name)}</div>
        ${limits[a.packageName]
          ?`<div class="app-sel-sub" style="color:var(--a)">⏱ ${fmtM(limits[a.packageName])}/day limit set</div>`
          :usageMap[a.packageName]?`<div class="app-sel-sub">${fmtM(usageMap[a.packageName])} today</div>`:''}
      </div>
      ${atLimit
        ?`<div style="display:flex;align-items:center;gap:5px">${typeof proBadge==='function'?proBadge(true):''}</div>`
        :limits[a.packageName]
          ?`<div style="font-family:var(--ff-m);font-size:10px;color:var(--a);padding:4px 8px;border-radius:8px;background:rgba(247,166,35,.1);border:1px solid rgba(247,166,35,.25)">${fmtM(limits[a.packageName])}</div>`
          :`<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">No limit</div>`}
    </div>`;
  });
  // Re-apply "Has Timer" filter if active, using data-has-timer attr
  if (_panelFilters.timer === 'selected') {
    const list = document.getElementById('timer-list');
    list && list.querySelectorAll('.cat-pick-group').forEach(function(g) {
      var rows = g.querySelectorAll('.app-sel-row');
      var anyOn = false;
      rows.forEach(function(row) {
        var has = row.getAttribute('data-has-timer') === '1';
        row.style.display = has ? '' : 'none';
        if (has) anyOn = true;
      });
      g.style.display = anyOn ? '' : 'none';
      if (anyOn) {
        var catName = g.getAttribute('data-cat') || '';
        var safeKey = 'timer-list_' + catName.replace(/[^a-zA-Z0-9]/g,'_');
        var appsEl  = document.getElementById('pcap_' + safeKey);
        var arrow   = document.getElementById('pcar_' + safeKey);
        if (appsEl) appsEl.style.display = 'block';
        if (arrow)  arrow.classList.add('open');
      }
    });
  }
}
function updateTimersSub(){
  const count=Object.keys(S.limits).length;
  document.getElementById('timers-sub').textContent=count?`${count} active limit${count!==1?'s':''}`:' Daily time limits';
}

// Timer picker modal
let timerPkg='', timerName='', timerDur=45;
function openTimerForApp(pkg,name,todayMins){
const isNew = !S.limits || !S.limits[pkg];
  if (isNew && !ProTier.isPro && Object.keys(S.limits || {}).length >= ProTier.getLimit('TIMER_APPS_UNLIMITED')) {
    ProTier.triggerUpsell('TIMER_APPS_UNLIMITED');
    return;
  }
  timerPkg=pkg; timerName=name;
  document.getElementById('timer-modal-title').textContent=`Timer: ${name}`;
  document.getElementById('timer-modal-sub').textContent=todayMins>0?`Today's usage: ${fmtM(todayMins)}`:'';
  const hasLimit=!!S.limits[pkg];
  document.getElementById('timer-remove-btn').style.display=hasLimit?'':'none';
  // Pre-select current limit or 45m
  timerDur=S.limits[pkg]||45;
  document.querySelectorAll('.dur-btn').forEach(b=>b.classList.remove('on'));
  const found=[...document.querySelectorAll('.dur-btn')].find(b=>parseInt(b.dataset.mins??b.textContent)===timerDur);
  if(found) found.classList.add('on'); else document.querySelectorAll('.dur-btn')[2].classList.add('on');
  openModal('timer-modal');
}
function selDur(mins,btn){
  timerDur=mins;
  document.querySelectorAll('.dur-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}
// FIX #1: pending flag — set when user grants overlay permission from within the
// timer modal so _doApplyTimer() completes automatically on app resume.
window._pendingTimerApply = false;

function applyTimer(){
  // FIX #1: overlay permission required for the limit enforcement overlay.
  // Mirror the same gate used by Focus Mode and Intention Prompt.
  if(IS_NATIVE){
    const hasOverlay = typeof N.hasOverlayPermission === 'function' && N.hasOverlayPermission();
    if(!hasOverlay){
      showConfirm(
        'Draw Over Apps Permission Needed',
        'App timers show a reminder screen when you reach your daily limit. Tap Grant, then return — your timer will save automatically.',
        () => {
          if(typeof N.requestOverlayPermission === 'function') N.requestOverlayPermission();
          window._pendingTimerApply = true;
        },
        'Grant Permission', 'Cancel'
      );
      return;
    }
  }
  _doApplyTimer();
}

function _doApplyTimer(){
  // Phase 3: enforce free-tier timer limit at save time (safety net for direct calls)
  const activeCount = Object.keys(S.limits).length;
  const alreadyHas  = !!S.limits[timerPkg];
  if (!alreadyHas && !ProTier.isPro && activeCount >= ProTier.getLimit('TIMER_APPS_UNLIMITED')) {
    ProTier.triggerUpsell('TIMER_APPS_UNLIMITED'); return;
  }
  S.limits[timerPkg]=timerDur;
  saveS();
  nCall('setAppLimit',timerPkg,timerDur);
  updateTimersSub(); renderTimerList(); renderTopApps();
  // FIX #2: update the top strip and focus subheader so timer count reflects immediately.
  if(typeof renderFocusStrip      === 'function') renderFocusStrip();
  if(typeof _updateFocusSubheader === 'function') _updateFocusSubheader();
  closeModal('timer-modal');
  // Pull fresh usage so bar fill + "X of Y" time are current, not stale cache.
  if(IS_NATIVE && N.hasUsagePermission && N.hasUsagePermission()){
    try{
      const snap = JSON.parse(N.refreshUsageData() || '{}');
      if(snap.topApps)        DAILY_USE  = snap.topApps;
      if(snap.totalMins!=null) TODAY_MINS = snap.totalMins;
    }catch(_){}
  }
  if(typeof FocusTimers !== 'undefined') FocusTimers.render(document.getElementById('focus-timers-wrap'));
  toast(`⏱ ${timerName} limited to ${fmtM(timerDur)}/day`,'success');
  // Contextual notification ask: user just set a limit → offer alerts for when it fires
  _maybeAskNotifPerm('limit');
}

/* ── Contextual notification permission ───────────────────────────────────────
   Called after user sets a goal or limit. Shows a simple toast-style prompt
   rather than the bare system dialog — much higher grant rates.             */
let _notifAsked = false;
function _maybeAskNotifPerm(context){
  if(!IS_NATIVE) return;
  const hasNotif = typeof N.hasNotificationPermission==='function' ? N.hasNotificationPermission() : true;
  if(hasNotif || _notifAsked) return;
  _notifAsked = true;
  const msg = context === 'goal'
    ? 'Want an alert when you hit your daily goal?'
    : 'Want a notification when you reach your app limit?';
  // Small delay so the success toast clears first
  setTimeout(()=>{
    showConfirm(msg, 'Enable alerts to stay on track. You can turn these off any time in Settings.', ()=>{
      try{ N.requestNotificationPermission(); }catch(e){ try{ N.openNotificationSettings(); }catch(_){} }
    }, 'Enable Alerts', 'Not now');
  }, 800);
}

/* ── Day-2 widget nudge ───────────────────────────────────────────────────────
   Shown once, on second app open or later, when there's real screen time data.
   At this point the widget preview shows actual numbers — far more compelling. */
let _waitingForWidgetPin = false;
let _widgetPinTimeout    = null;
let _widgetPollInterval  = null;

// Start polling isWidgetAdded() — needed on Android 16 Pixel where the
// requestPinAppWidget Activity callback may not fire when the app stays
// in the foreground during the pin dialog (no pause/resume cycle).
function _startWidgetPinPolling() {
  _stopWidgetPinPolling();
  if (!IS_NATIVE || typeof N.isWidgetAdded !== 'function') return;
  // BUG FIX: snapshot whether widget was already placed BEFORE the pin dialog
  // so we don't fire a false-positive success on the first tick.
  const wasAlreadyAdded = (() => { try { return N.isWidgetAdded(); } catch(_) { return false; } })();
  if (wasAlreadyAdded) {
    // Widget was already there — nothing to poll for
    _waitingForWidgetPin = false;
    return;
  }
  let attempts = 0;
  _widgetPollInterval = setInterval(() => {
    attempts++;
    try {
      if (N.isWidgetAdded()) {
        _stopWidgetPinPolling();
        _waitingForWidgetPin = false;
        if (_widgetPinTimeout) { clearTimeout(_widgetPinTimeout); _widgetPinTimeout = null; }
        toast('Widget added to your home screen ✓', 'success');
        return;
      }
    } catch(_) {}
    if (attempts >= 20) _stopWidgetPinPolling(); // stop after 30s
  }, 1500);
}

function _stopWidgetPinPolling() {
  if (_widgetPollInterval) { clearInterval(_widgetPollInterval); _widgetPollInterval = null; }
}

function _maybeShowWidgetNudge(){
  if(!IS_NATIVE) return;
  if(S.widgetNudgeDone) return;
  if(!TODAY_MINS && !DAILY_USE.length) return;
  try{ if(N.canPinWidget && !N.canPinWidget()) return; }catch(_){ return; }
  S.widgetNudgeDone = true; saveS();
  setTimeout(()=>{
    showConfirm(
      'Add Aurelo to your home screen?',
      'The widget shows your top apps, screen time, and first pickup — updates every 5 minutes.',
      ()=>{
          try{
              const sent = N.requestPinWidget && N.requestPinWidget();
              if(sent){
                  _waitingForWidgetPin = true;
                  _widgetPinTimeout = setTimeout(()=>{
                      _waitingForWidgetPin = false;
                      _stopWidgetPinPolling();
                      if(!N.isWidgetAdded()) {
                          toast('Long-press your home screen → Widgets → Aurelo','info',5000);
                      }
                  }, 30000);
                  _startWidgetPinPolling();
              } else {
                  // Pixel 16 or unsupported launcher — show a clear step-by-step guide
                  _showWidgetManualGuide();
              }
          }catch(_){
              _showWidgetManualGuide();
          }
      },
      'Add Widget', 'Maybe later'
    );
  }, 3000);
}
function _showWidgetManualGuide(){
    // Show a modal with visual steps instead of a plain toast.
    // Plain toasts are too brief for a 3-step process.
    showConfirm(
        'Add the Aurelo widget',
        '1. Long-press any empty area on your home screen\n2. Tap "Widgets"\n3. Find Aurelo and drag it to your home screen',
        ()=>{
            // Start polling so if they do add it we can confirm
            _waitingForWidgetPin = true;
            _startWidgetPinPolling();
            _widgetPinTimeout = setTimeout(()=>{
                _waitingForWidgetPin = false;
                _stopWidgetPinPolling();
            }, 60000); // longer timeout since they have to do it manually
        },
        'Got it',
        'Maybe later'
    );
}
function removeTimerFromModal(){
  delete S.limits[timerPkg]; saveS();
  nCall('removeAppLimit',timerPkg);
  updateTimersSub(); renderTimerList(); renderTopApps();
  // FIX #2: keep strip and subheader in sync after removal.
  if(typeof renderFocusStrip      === 'function') renderFocusStrip();
  if(typeof _updateFocusSubheader === 'function') _updateFocusSubheader();
  closeModal('timer-modal');
  // FIX #7 & #8: immediately remove row from Focus tab.
  if(typeof FocusTimers !== 'undefined') FocusTimers.render(document.getElementById('focus-timers-wrap'));
  toast(`Timer removed for ${timerName}`,'info');
}

/* ═══ LAUNCH APP ══════════════════════════════════════ */
function launchApp(pkg,name){
  if(S.lockedPkgs.includes(pkg)){ toast(`🔒 ${name} is locked`,'warn'); return; }
  if(IS_NATIVE){
    try{ N.recordAppLaunch(pkg); }catch(_){}
    const ok=N.openApp(pkg); if(!ok) toast(`Could not open ${name}`,'error');
  }
  else{ toast(`Opening ${name}…`,'info'); }
}

/* ═══ PERMISSIONS ══════════════════════════════════════ */
function tapPerm(type){
  if(type==='usage'){
    if(IS_NATIVE&&N.hasUsagePermission()) toast('Usage access granted ✓','success');
    else if(IS_NATIVE) N.requestUsagePermission();
    else toast('Grant in: Settings → Apps → Special app access → Usage access','info');
    setTimeout(updatePermUI,1500);
  } else if(type==='notif'){
    if(IS_NATIVE){
      const hasNotif = typeof N.hasNotificationPermission==='function' && N.hasNotificationPermission();
      if(hasNotif){
        // Already granted — open notification settings so user can manage channels
        nCall('openNotificationSettings');
        toast('Notification settings opened','info',1500);
      } else {
        nCall('requestNotificationPermission');
      }
    } else toast('Would open notification permission dialog','info');
    setTimeout(updatePermUI,2500);
  } else if(type==='dnd'){
    if(IS_NATIVE){
      nCall('openDndSettings');
      toast('Opening Do Not Disturb settings…','info',1500);
    } else toast('Would open Do Not Disturb settings','info');
    setTimeout(updatePermUI,1500);
  } else if(type==='overlay'){
    if(IS_NATIVE){
      const hasOverlay = typeof N.hasOverlayPermission==='function' && N.hasOverlayPermission();
      if(hasOverlay){
        toast('Display over other apps: already granted ✓','success');
      } else {
        try{ N.requestOverlayPermission(); }catch(e){
          toast('Open Settings → Apps → Aurelo → Display over other apps','info',3500);
        }
      }
    } else toast('Would open overlay permission settings','info');
    setTimeout(updatePermUI,1500);
  }
}
function updatePermUI(){
  const uEl=document.getElementById('perm-usage');
  if(!IS_NATIVE){ if(uEl){uEl.textContent='Demo';uEl.className='perm-badge';} return; }
  // Usage Access
  const ug=N.hasUsagePermission();
  if(uEl){uEl.textContent=ug?'Granted ✓':'Tap to grant';uEl.className='perm-badge '+(ug?'ok':'no');}
  // Notifications
  const nEl=document.getElementById('perm-notif');
  const hasN=typeof N.hasNotificationPermission==='function'?N.hasNotificationPermission():true;
  if(nEl){nEl.textContent=hasN?'Granted ✓':'Tap to grant';nEl.className='perm-badge '+(hasN?'ok':'no');}
  const nSub=document.getElementById('perm-notif-sub');
  if(nSub) nSub.textContent=hasN?'Smart alerts enabled':'Enable to receive goal reminders';
  // DND / Bedtime
  const dEl=document.getElementById('perm-dnd');
  const hasDnd=typeof N.hasDndPermission==='function'?N.hasDndPermission():false;
  if(dEl){dEl.textContent=hasDnd?'Granted ✓':'Tap to grant';dEl.className='perm-badge '+(hasDnd?'ok':'no');}
  const dSub=document.getElementById('perm-dnd-sub');
  if(dSub) dSub.textContent=hasDnd?'Bedtime Mode can silence calls':'Required for Bedtime Mode';
  // Display Over Other Apps
  const oEl=document.getElementById('perm-overlay');
  const hasOverlay=typeof N.hasOverlayPermission==='function'?N.hasOverlayPermission():false;
  if(oEl){oEl.textContent=hasOverlay?'Granted ✓':'Tap to grant';oEl.className='perm-badge '+(hasOverlay?'ok':'no');}
  const oSub=document.getElementById('perm-overlay-sub');
  if(oSub) oSub.textContent=hasOverlay?'Focus Mode, timers & Mindful prompts active':'Required for Focus Mode, timers & Mindful prompts';
}