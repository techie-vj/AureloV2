/* ═══ TABS ════════════════════════════════════════════ */

/* ═══ SWIPE TO CHANGE TABS ════════════════════════════════════════════════ */
(function initSwipeTabs(){
  // Only 3 tabs in the swipe cycle — settings is accessible via profile icon only
  const TAB_ORDER  = ['home','wellness','focus'];
  const THRESHOLD  = 52;
  const ANGLE_MAX  = 0.65;
  const EDGE_GUARD = 28;

  // Tracks the current swipe gesture
  let sw = null; // { x0, y0, tabIdx, incoming, dir, rejected }

  function _isBlocked(e){
    // Don't swipe when a panel, modal, drag or pick-mode is active
    if(document.querySelector('.panel.open'))   return true;
    if(document.querySelector('.modal-bg.open'))return true;
    if(document.querySelector('#digest.open'))  return true;
    if(_tdrag || window._cpPickDragging)        return true;
    if(pickedApp)                               return true;
    // Block when touch starts inside any horizontally-scrollable container
    // (widget theme scroller, discover tracks, recent-row, etc.)
    if(e && e.target){
      let el = e.target;
      while(el && el !== document.body){
        const ox = window.getComputedStyle(el).overflowX;
        if(ox === 'auto' || ox === 'scroll') return true;
        el = el.parentElement;
      }
    }
    return false;
  }

  function _tabEl(name){ return document.getElementById('screen-'+name); }

  function _navPct(fromIdx, toIdx, pct){
    // Slide the active nav indicator between fromIdx and toIdx by pct
    const ind = document.getElementById('swipe-indicator');
    const navW = document.querySelector('.bottom-nav').offsetWidth;
    const items = document.querySelectorAll('.nav-item');
    if(!items[fromIdx] || !items[toIdx]) return;
    const rF = items[fromIdx].getBoundingClientRect();
    const rT = items[toIdx].getBoundingClientRect();
    const navRect = document.querySelector('.bottom-nav').getBoundingClientRect();
    const fromCx = rF.left - navRect.left + rF.width/2;
    const toCx   = rT.left - navRect.left + rT.width/2;
    const cx = fromCx + (toCx - fromCx) * pct;
    const w  = rF.width * (1-pct) + rT.width * pct;
    ind.style.left      = (cx - w/2) + 'px';
    ind.style.width     = w + 'px';
    ind.classList.add('visible');
  }

  function _navReset(){
    document.getElementById('swipe-indicator').classList.remove('visible');
  }

  function _slide(el, dx, instant){
    el.style.transition = instant ? 'none' : 'transform .3s cubic-bezier(.25,.46,.45,.94)';
    el.style.transform  = dx === 0 ? '' : `translateX(${dx}px)`;
  }

  const screens_container = document.querySelector('.screens');

  screens_container.addEventListener('touchstart', e=>{
    if(_isBlocked(e) || e.touches.length > 1) return;
    const t = e.touches[0];
    // Ignore touches starting within the edge guard (Android system swipe zones)
    if(t.clientX < EDGE_GUARD || t.clientX > window.innerWidth - EDGE_GUARD) return;
    const tabIdx = TAB_ORDER.indexOf(_activeTab);
    if(tabIdx < 0) return;
    sw = { x0:t.clientX, y0:t.clientY, tabIdx, incoming:null, dir:0, rejected:false };
  }, { passive:true });

  screens_container.addEventListener('touchmove', e=>{
    if(!sw || sw.rejected) return;
    const t  = e.touches[0];
    const dx = t.clientX - sw.x0;
    const dy = t.clientY - sw.y0;

    // Reject if scroll is more vertical than horizontal
    if(sw.dir === 0 && Math.abs(dx) > 6){
      if(Math.abs(dy) / Math.abs(dx) > ANGLE_MAX){ sw.rejected = true; return; }
      sw.dir = dx > 0 ? -1 : 1; // -1 = swiping right (going to prev tab)
    }
    if(sw.dir === 0) return;

    // Determine which neighbour is incoming
    const { tabIdx } = sw;
    const nextIdx = tabIdx + sw.dir;
    if(nextIdx < 0 || nextIdx >= TAB_ORDER.length){ sw.rejected = true; return; }

    if(!sw.incoming){
      sw.incoming = TAB_ORDER[nextIdx];
      const inc = _tabEl(sw.incoming);
      // Position incoming screen offscreen
      const offX = sw.dir > 0 ? window.innerWidth : -window.innerWidth;
      inc.style.display    = 'block';
      inc.style.transition = 'none';
      inc.style.transform  = `translateX(${offX}px)`;
    }

    // Clamp drag so it can't exceed one screen width
    const W    = window.innerWidth;
    const travel = Math.max(-W, Math.min(W, dx));
    const cur  = _tabEl(TAB_ORDER[tabIdx]);
    const inc  = _tabEl(sw.incoming);
    const offX = sw.dir > 0 ? W : -W;

    _slide(cur, travel, true);
    _slide(inc, travel + offX, true);

    // Update nav indicator
    const pct = Math.abs(travel) / W;
    _navPct(tabIdx, nextIdx, Math.min(pct, 1));
  }, { passive:true });

  screens_container.addEventListener('touchend', e=>{
    if(!sw) return;
    const t    = e.changedTouches[0];
    const dx   = t.clientX - sw.x0;
    const W    = window.innerWidth;
    const commit = !sw.rejected && sw.incoming && Math.abs(dx) >= THRESHOLD;

    if(sw.incoming){
      const cur = _tabEl(TAB_ORDER[sw.tabIdx]);
      const inc = _tabEl(sw.incoming);
      if(commit){
        const offX = sw.dir > 0 ? -W : W;
        // Fly current out, fly incoming to centre
        cur.style.transition = 'transform .28s cubic-bezier(.25,.46,.45,.94)';
        cur.style.transform  = `translateX(${offX}px)`;
        inc.style.transition = 'transform .28s cubic-bezier(.25,.46,.45,.94)';
        inc.style.transform  = '';
        cur.classList.add('swipe-transitioning');
        inc.classList.add('swipe-transitioning');
        setTimeout(()=>{
          cur.classList.remove('active','swipe-transitioning');
          cur.style.transform  = '';
          cur.style.transition = '';
          cur.style.display    = '';
          inc.classList.remove('swipe-transitioning');
          inc.style.transition = '';
          // Use activateTab to fire all side effects (renderWellness, loadDiscover, etc.)
          activateTab(sw.incoming);
          _navReset();
          sw = null;
        }, 290);
      } else {
        // Snap back
        cur.style.transition = 'transform .25s cubic-bezier(.25,.46,.45,.94)';
        cur.style.transform  = '';
        inc.style.transition = 'transform .25s cubic-bezier(.25,.46,.45,.94)';
        const offX = sw.dir > 0 ? W : -W;
        inc.style.transform = `translateX(${offX}px)`;
        setTimeout(()=>{
          inc.style.display    = '';
          inc.style.transform  = '';
          inc.style.transition = '';
          cur.style.transition = '';
          _navReset();
          sw = null;
        }, 260);
      }
    } else {
      _navReset();
      sw = null;
    }
  }, { passive:true });

  screens_container.addEventListener('touchcancel', ()=>{
    if(!sw) return;
    if(sw.incoming){
      const cur = _tabEl(TAB_ORDER[sw.tabIdx]);
      const inc = _tabEl(sw.incoming);
      cur.style.transform = ''; cur.style.transition = '';
      inc.style.transform = ''; inc.style.transition = '';
      inc.style.display   = '';
    }
    _navReset();
    sw = null;
  }, { passive:true });
})();

let _activeTab = 'home';
function activateTab(tab){
  clearSearch();
  const prev = _activeTab; _activeTab = tab;

  // Collapse any expanded settings sections when leaving settings
  if(prev === 'settings' && tab !== 'settings'){
    const wtList = document.getElementById('widgetThemeList');
    const wtChev = document.getElementById('widgetThemeChevron');
    if(wtList){ wtList.style.maxHeight='0px'; wtList.style.opacity='0'; }
    if(wtChev){ wtChev.style.transform=''; }
    const atList = document.getElementById('appThemeList');
    const atChev = document.getElementById('appThemeChevron');
    if(atList){ atList.style.display='none'; }
    if(atChev){ atChev.style.transform=''; }
  }

  ['home','wellness','focus','settings'].forEach(t=>{
    const el = document.getElementById('screen-'+t);
    el.style.display    = '';
    el.style.transform  = '';
    el.style.transition = '';
    el.classList.remove('swipe-transitioning');
    el.classList.toggle('active', t===tab);
    // nav-settings is hidden (display:none) — only update the 3 visible tabs
    const navEl = document.getElementById('nav-'+t);
    if(navEl && navEl.style.display !== 'none') navEl.classList.toggle('active', t===tab);
  });

  if(tab==='wellness'){
    if(_wellnessView !== 'today'){
      _wellnessView='today';
      ['today','week','month'].forEach(v=>{
        const el=document.getElementById('w-view-'+v);
        if(el) el.style.display=v==='today'?'':'none';
      });
    }
    ['wtb-today','wtb-week','wtb-month'].forEach(id=>{
      const b=document.getElementById(id); if(b) b.classList.remove('on');
    });
    const tpbEl=document.getElementById('wtb-today');
    if(tpbEl) tpbEl.classList.add('on');
    renderWellness();
  }
  if(tab==='focus'){
    if(typeof initFocusTab==='function') initFocusTab();
    else if(typeof onFocusTabVisible==='function') onFocusTabVisible();
  }
  // Discover tab hidden — loadDiscover() kept in app-discover.js for future re-enable
  if(tab==='wellness' && _wellnessDirty){ _wellnessDirty=false; renderWellness(); }
  if(tab==='home' && _homeDirty){
    _homeDirty=false;
    renderQuickStats();
    renderRecent();
    renderGhostBanner();
    if(_ghostDirty){ _ghostDirty=false; refreshAndRenderGhosts(); }
  }
  if(tab==='settings'){
    if(prev !== 'settings'){
      updatePermUI();
      if(typeof updateCatsSub  === 'function') updateCatsSub();
      updateTimersSub();
      updateLockedSub(); updateHiddenSub(); updateNameUI(); initWidgetSettings();
    }
  }
  setCatView(S.catView);
}

// ── Back gesture handler — called by MainActivity via evaluateJavascript ──
// MainActivity evaluates: (typeof window.onBackPressed === 'function' && window.onBackPressed()) || false
// Return true  → back was handled internally (do NOT exit)
// Return false → let Android minimise / exit the app
window.onBackPressed = function () {
  // 1. Cancel any active touch-drag
  if (typeof _tdrag !== 'undefined' && _tdrag) {
    _tdrag.ghost && _tdrag.ghost.remove();
    if (typeof clearCatHighlights === 'function') clearCatHighlights();
    _tdrag = null;
    return true;
  }
  // 2. Cancel pick mode
  if (typeof pickedApp !== 'undefined' && pickedApp) {
    if (typeof cancelPickMode === 'function') cancelPickMode();
    return true;
  }
  // 3. Close search dropdown
  var drop = document.getElementById('search-drop');
  if (drop && drop.style.display !== 'none') { clearSearch(); return true; }
  // 4. Close Smart Routine modal (custom overlay — not a .modal-bg)
  var routineModal = document.getElementById('_routineModal');
  if (routineModal) { routineModal.remove(); return true; }
  // 5. Close score-sheet backdrop (Focus / Screen / Sleep score panels)
  var scoreSheet = document.getElementById('score-sheet-backdrop');
  if (scoreSheet) { scoreSheet.remove(); return true; }
  // 6. Close any open modal
  var openModal = document.querySelector('.modal-bg.open');
  if (openModal) { openModal.classList.remove('open'); return true; }
  // 7. Close any open panel
  var openPanel = document.querySelector('.panel.open');
  if (openPanel) { openPanel.classList.remove('open'); return true; }
  // 8. If on a non-home tab — navigate home, do not exit
  if (_activeTab !== 'home') { activateTab('home'); return true; }
  // 9. Already on home tab — show exit confirmation instead of closing immediately
  showConfirm(
    'Exit Aurelo?',
    'Your streak and progress are saved.',
    function () {
      try { AppBridge.finishApp(); } catch (_) {
        window.onBackPressed = function () { return false; };
        history.go(-1);
      }
    },
    'Exit', 'Stay'
  );
  return true; // block native back while dialog is shown
};

// ── Widget pinned callback — called by MainActivity.handleWidgetIntent ────
// Receives the WIDGET_PINNED activity result on Android 12+ / 16.
// Entirely separate from back navigation — do NOT put back logic here.
window.onWidgetPinned = function () {
  if (typeof _waitingForWidgetPin !== 'undefined') _waitingForWidgetPin = false;
  if (typeof _widgetPinTimeout !== 'undefined' && _widgetPinTimeout) {
    clearTimeout(_widgetPinTimeout);
    _widgetPinTimeout = null;
  }
  toast('Widget added to your home screen ✓', 'success');
};

/* ═══ PANELS ══════════════════════════════════════════ */
// Generic filter for app-sel-row panels (lock, hide, timer)
function filterPanelList(listId, searchId){
  const q=(document.getElementById(searchId)?.value||'').trim().toLowerCase();
  document.querySelectorAll('#'+listId+' .app-sel-row').forEach(row=>{
    const name=row.querySelector('.app-sel-name')?.textContent.toLowerCase()||'';
    row.style.display=!q||name.includes(q)?'':'none';
  });
}
function filterManageCategories(q){
  q=q.trim().toLowerCase();
  document.querySelectorAll('#mcp-rows .cat-list-row').forEach(row=>{
    const txt=row.textContent.toLowerCase();
    row.style.display=!q||txt.includes(q)?'':'none';
  });
}
function _clearPanelSearch(id){
  // Clear the search input when opening a panel so it always starts fresh
  const map={'lock-panel':'lock-search','hide-panel':'hide-search','timer-panel':'timer-search','manage-cats-panel':'mcp-search'};
  const el=document.getElementById(map[id]);
  if(el) el.value='';
}
function openPanel(id){
  clearSearch();
  _clearPanelSearch(id);
  document.getElementById(id).classList.add('open');
  if(id==='lock-panel') openPanel_lock();
  if(id==='hide-panel') openPanel_hide();
  if(id==='timer-panel') renderTimerList();
  if(id==='manage-cats-panel') { if(typeof renderManageCats === 'function') renderManageCats(); }
  if(id==='ghost-panel') refreshAndRenderGhosts();
  if(id==='notif-panel') loadNotifications();
  if(id==='all-apps-panel') renderAllAppsPanel();
  if(id==='privacy-panel') updatePermUI();
}

function openPrivacyDetail(){ openPanel('privacy-panel'); }

function rateApp(){
  if(IS_NATIVE){
    try{ N.openPlayStore('com.javikastudio.tidyapp'); }catch(_){
      toast('Opening Play Store…','info',2000);
    }
  } else { toast('Opens Play Store on device','info',2000); }
}

function sendFeedback(){
  const ver = (document.getElementById('app-version-badge2')?.textContent || 'v?').trim();
  const to  = 'javikastudio@gmail.com';
  const sub = 'Aurelo Feedback (' + ver + ')';
  if(IS_NATIVE){
    try{
      if(typeof N.openEmail==='function'){ N.openEmail(to, sub, ''); }
      else { toast('Email: ' + to, 'info', 3500); }
    }catch(_){ toast('Email: ' + to, 'info', 3500); }
  } else { toast('Email: ' + to, 'info', 2500); }
}
function closePanel(id){ document.getElementById(id).classList.remove('open'); }
function openModal(id){ clearSearch(); document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }