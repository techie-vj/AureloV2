/* ═══ app-categories.js — Category grid, list, popup & management ══════════
 * Phase 4 extraction from app-home.js.
 * Depends on: app-core.js (CATS_MAP, CAT_ICONS, CAT_COLOR, DEMO_EMOJI, S,
 *             IS_NATIVE, N, nCall, saveS, buildCatsMap, assignAppToCategory,
 *             scheduleGridRefresh, DAILY_USE, TODAY_MINS),
 *             app-home.js (appIco, icoDiv, clearSearch, ICON_SET, fmtM,
 *             escHtml, escAttr, openModal, closeModal, openPanel, closePanel,
 *             toast, showConfirm, proTap, ProTier)
 * ════════════════════════════════════════════════════════════════════════════ */

/* ═══ CATEGORIES ══════════════════════════════════════ */
function buildIconGrid(){
  const el = document.getElementById('ecm-icons');
  if (!el) return; // guard: element lives in a template, may not exist yet
  el.innerHTML = ICON_SET.map(ic=>`<div class="icon-btn" onclick="selIcon(this)">${ic}</div>`).join('');
}
function selIcon(btn){
  document.querySelectorAll('.icon-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

function getCatOrder(){
  const all=Object.keys(CATS_MAP);
  const stored=S.catOrder.filter(c=>all.includes(c));
  return [...stored,...all.filter(c=>!stored.includes(c))];
}

function renderCategoryGrid(){
  // Defer heavy DOM work until after the current frame paints
  if(typeof requestAnimationFrame!=='undefined'){
    requestAnimationFrame(_renderCategoryGridImpl);
    return;
  }
  _renderCategoryGridImpl();
}
function _renderCategoryGridImpl(){
  const container = document.getElementById('cat-grid-view');
  if(!container) return;

  // Build per-app usage map
  const usageMap = {};
  DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes || 0; });
  const totalScreenMins = Math.max(TODAY_MINS || 1, 1);
  const hasUsageData = DAILY_USE.length > 0 && TODAY_MINS > 0;

  // Compute per-category totals, sort by usage desc then app count
  const allCats = getEffectiveCatOrder().map(cat => {
    const apps = CATS_MAP[cat] || [];
    const catMins = apps.reduce((s, a) => s + (usageMap[a.packageName] || 0), 0);
    return { cat, apps, catMins };
  }).filter(c => c.apps.length > 0);  // also strip any truly empty shells

  // Top 5 in user's preferred order (or usage order if no preference)
  const expanded = allCats.slice(0, 5);
  const expandedSet = new Set(expanded.map(c => c.cat));
  const rest        = allCats.filter(c => !expandedSet.has(c.cat));

  const inPickMode = !!pickedApp;

  // ── Expanded card ────────────────────────────────────
  function expandedCard({ cat, apps, catMins }) {
    const ico      = CAT_ICONS[cat] || '📱';
    const col      = CAT_COLOR[cat] || '6C63FF';
    const rgb      = _hexToRgb(col);
    const pct      = hasUsageData && totalScreenMins > 0
                     ? Math.round((catMins / totalScreenMins) * 100) : 0;
    const barW     = Math.min(pct, 100);
    const isSource = inPickMode && pickedApp.fromCat === cat;
    const pickStyle = inPickMode && !isSource ? 'border-color:rgba(108,99,255,.5);' : '';
    const clickFn   = inPickMode
      ? (isSource ? 'cancelPickMode()' : `depositPickedApp('${cat}')`)
      : `openCatPopup('${cat}')`;

    // Top apps sorted by usage (up to 5 shown)
    const topApps = [...apps]
      .sort((a, b) => (usageMap[b.packageName] || 0) - (usageMap[a.packageName] || 0))
      .slice(0, 5);

    const iconStrip = topApps.map(a => {
      const mins = usageMap[a.packageName] || 0;
      const timeLabel = mins > 0 ? fmtM(mins) : '–';
      const timeClass = mins > 0 ? 'cat-exp-app-time has-usage' : 'cat-exp-app-time';
      return `<div class="cat-exp-app-wrap">
        <div class="cat-exp-app-ico">${appIco(a.packageName, 34, 9)}</div>
        <div class="${timeClass}">${timeLabel}</div>
      </div>`;
    }).join('');

    const moreCount = apps.length > 5
      ? `<div class="cat-exp-more">+${apps.length - 5}</div>` : '';

    // Right column — always time + %; show '–' when no usage data yet
    const timeStr = hasUsageData && catMins > 0 ? fmtM(catMins) : '–';
    const pctStr  = hasUsageData ? `${pct}% of today` : '0% of today';

    return `<div class="cat-exp-card" data-cat="${cat}" style="${pickStyle}"
      onclick="${clickFn}"
      ondragover="event.preventDefault();this.style.borderColor='rgba(108,99,255,.6)'"
      ondragleave="this.style.borderColor=''"
      ondrop="event.preventDefault();this.style.borderColor='';dropAppOnCat('${cat}',event)">
      <div class="cat-exp-hdr">
        <div class="cat-exp-ico" style="background:rgba(${rgb},.15)">${ico}</div>
        <div class="cat-exp-meta">
          <div class="cat-exp-name">${cat}${inPickMode && !isSource ? ' <span class="cat-pick-hint">TAP TO DROP</span>' : ''}</div>
          <div class="cat-exp-count">${apps.length} app${apps.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="cat-exp-time-col">
          <div class="cat-exp-time">${timeStr}</div>
          <div class="cat-exp-pct">${pctStr}</div>
        </div>
      </div>
      <div class="cat-exp-bar-track">
        <div class="cat-exp-bar-fill" style="width:${barW}%;background:#${col}"></div>
      </div>
      <div class="cat-exp-icons">${iconStrip}${moreCount}</div>
    </div>`;
  }

  // ── Collapsed card (rest — same card shell, header + bar, no icon strip) ──
  function collapsedCard({ cat, apps, catMins }) {
    const ico      = CAT_ICONS[cat] || '📱';
    const col      = CAT_COLOR[cat] || '6C63FF';
    const rgb      = _hexToRgb(col);
    const pct      = hasUsageData ? Math.round((catMins / totalScreenMins) * 100) : 0;
    const isSource = inPickMode && pickedApp.fromCat === cat;
    const pickStyle = inPickMode && !isSource ? 'border-color:rgba(108,99,255,.5);' : '';
    const clickFn   = inPickMode
      ? (isSource ? 'cancelPickMode()' : `depositPickedApp('${cat}')`)
      : `openCatPopup('${cat}')`;
    const barHtml = hasUsageData && catMins > 0
      ? `<div class="cat-col-bar-track"><div class="cat-col-bar-fill" style="width:${Math.min(pct,100)}%;background:#${col}"></div></div>`
      : `<div class="cat-col-bar-track"><div class="cat-col-bar-fill" style="width:0%"></div></div>`;
    const rightHtml = hasUsageData && catMins > 0
      ? `<div class="cat-col-time-col"><div class="cat-col-time">${fmtM(catMins)}</div><div class="cat-col-pct">${pct}% of today</div></div>`
      : `<div class="cat-col-time-col"><div class="cat-col-pct" style="margin-top:4px">–</div></div>`;
    return `<div class="cat-col-card" data-cat="${cat}" style="${pickStyle}"
      onclick="${clickFn}"
      ondragover="event.preventDefault();this.style.borderColor='rgba(108,99,255,.6)'"
      ondragleave="this.style.borderColor=''"
      ondrop="event.preventDefault();this.style.borderColor='';dropAppOnCat('${cat}',event)">
      <div class="cat-col-hdr">
        <div class="cat-col-ico" style="background:rgba(${rgb},.15)">${ico}</div>
        <div class="cat-col-meta">
          <div class="cat-col-name">${cat}${inPickMode && !isSource ? ' <span class="cat-pick-hint">TAP</span>' : ''}</div>
          <div class="cat-col-count">${apps.length} app${apps.length !== 1 ? 's' : ''}</div>
        </div>
        ${rightHtml}
      </div>
      ${barHtml}
    </div>`;
  }

  // ── Assemble — single unified section, no sub-labels ────
  let html = '';
  html += expanded.map(expandedCard).join('');
  if(rest.length > 0){
    html += rest.map(collapsedCard).join('');
  }
  html += `<div class="cat-row cat-row-new" onclick="openAddCatModal()">
    <div style="font-size:18px;color:var(--t3)">＋</div>
    <div class="cat-row-meta"><div class="cat-row-name" style="color:var(--t3)">New Category</div></div>
  </div>`;

  container.innerHTML = html;
}

// Helper: convert hex color to RGB for rgba() usage
function _hexToRgb(hex){
  const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
  return isNaN(r)?'108,99,255':`${r},${g},${b}`;
}

function dropAppOnCat(cat, event){
  let pkg  = event.dataTransfer.getData('pkg');
  let name = event.dataTransfer.getData('name');
  // Fallback: dragged from popup (popup closed before drop, so dataTransfer may be empty)
  if(!pkg && window._crossCatDragPkg){
    pkg  = window._crossCatDragPkg;
    name = window._crossCatDragName || pkg.split('.').pop();
  }
  window._crossCatDragPkg = null; window._crossCatDragName = null;
  if(!pkg) return;
  assignAppToCategory(pkg, cat);
  scheduleGridRefresh();
  document.getElementById('search-input').value='';
  document.getElementById('search-drop').style.display='none';
  toast(`${name} → ${cat}`, 'success');
}

function renderCategoryList(){
  const el = document.getElementById('cat-list-view');
  if (!el) return;
  const cats = getEffectiveCatOrder();
  el.innerHTML = cats.map(cat => {
    const apps = CATS_MAP[cat], ico = CAT_ICONS[cat] || '📱';
    return `<div class="cat-list-row" onclick="openCatPopup('${cat}')">
      <div style="font-size:22px;flex-shrink:0">${ico}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:600">${cat}</div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">${apps.length} apps</div>
      </div>
      <span style="color:var(--t3)">›</span>
    </div>`;
  }).join('') + `<div class="cat-list-row" style="border-style:dashed;border-color:var(--border2);justify-content:center;gap:8px" onclick="openAddCatModal()">
    <span style="font-size:20px;color:var(--t3)">＋</span>
    <span style="font-size:13px;color:var(--t3)">New Category</span>
  </div>`;
}

function getEffectiveCatOrder() {
  const userHasCustomOrder = S.catOrder && S.catOrder.length > 0;
  if (!userHasCustomOrder) {
    const usageMap = {};
    DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes || 0; });
    return getCatOrder().sort((a, b) => {
      const aMin = (CATS_MAP[a] || []).reduce((s, app) => s + (usageMap[app.packageName] || 0), 0);
      const bMin = (CATS_MAP[b] || []).reduce((s, app) => s + (usageMap[app.packageName] || 0), 0);
      return bMin - aMin || (CATS_MAP[b] || []).length - (CATS_MAP[a] || []).length;
    });
  }
  return getCatOrder();
}

function setCatView(mode){
  const grid=document.getElementById('cat-grid-view'), list=document.getElementById('cat-list-view');
  const btnGrid=document.getElementById('vt-grid'), btnList=document.getElementById('vt-list');
  if(btnGrid) btnGrid.classList.toggle('on',mode==='grid');
  if(btnList) btnList.classList.toggle('on',mode==='list');
  if(grid) grid.style.display=mode==='grid'?'':'none';
  if(list) list.style.display=mode==='list'?'':'none';
  if(S.catView!==mode){ S.catView=mode; saveS(); }
}

/* ═══ ALL CATEGORIES PANEL ═════════════════════════ */
function openAllCatsPanel() {
  renderAllCatsPanel();
  openPanel('all-cats-panel');
}

function renderAllCatsPanel() {
  const container = document.getElementById('all-cats-list');
  const countEl   = document.getElementById('all-cats-count');
  if (!container) return;

  const usageMap = {};
  DAILY_USE.forEach(u => { usageMap[u.packageName] = u.totalMinutes || 0; });
  const totalScreenMins = Math.max(TODAY_MINS || 1, 1);
  const hasUsageData    = DAILY_USE.length > 0 && TODAY_MINS > 0;

  const allCats = getEffectiveCatOrder()
    .map(cat => {
      const apps    = CATS_MAP[cat] || [];
      const catMins = apps.reduce((s, a) => s + (usageMap[a.packageName] || 0), 0);
      return { cat, apps, catMins };
    })
    .filter(c => c.apps.length > 0);

  const totalApps = allCats.reduce((s, c) => s + c.apps.length, 0);
  if (countEl) countEl.textContent = totalApps + ' apps';

  container.innerHTML = allCats.map(({ cat, apps, catMins }) => {
    const ico     = CAT_ICONS[cat] || '📱';
    const col     = CAT_COLOR[cat] || '6C63FF';
    const rgb     = _hexToRgb(col);
    const pct     = hasUsageData ? Math.round((catMins / totalScreenMins) * 100) : 0;
    const barW    = Math.min(pct, 100);
    const timeStr = hasUsageData && catMins > 0 ? fmtM(catMins) : '–';
    const pctStr  = hasUsageData ? pct + '% of today' : '0% of today';

    const topApps = [...apps]
      .sort((a, b) => (usageMap[b.packageName] || 0) - (usageMap[a.packageName] || 0))
      .slice(0, 5);

    const iconStrip = topApps.map(a => {
      const mins      = usageMap[a.packageName] || 0;
      const timeLabel = mins > 0 ? fmtM(mins) : '–';
      const timeCls   = mins > 0 ? 'cat-exp-app-time has-usage' : 'cat-exp-app-time';
      return `<div class="cat-exp-app-wrap">
        <div class="cat-exp-app-ico">${appIco(a.packageName, 34, 9)}</div>
        <div class="${timeCls}">${timeLabel}</div>
      </div>`;
    }).join('');

    const moreCount = apps.length > 5
      ? `<div class="cat-exp-more">+${apps.length - 5}</div>` : '';

    return `<div class="cat-exp-card" onclick="openCatPopup('${cat}')" style="margin-bottom:10px;cursor:pointer">
      <div class="cat-exp-hdr">
        <div class="cat-exp-ico" style="background:rgba(${rgb},.15)">${ico}</div>
        <div class="cat-exp-meta">
          <div class="cat-exp-name">${cat}</div>
          <div class="cat-exp-count">${apps.length} app${apps.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="cat-exp-time-col">
          <div class="cat-exp-time">${timeStr}</div>
          <div class="cat-exp-pct">${pctStr}</div>
        </div>
      </div>
      <div class="cat-exp-bar-track">
        <div class="cat-exp-bar-fill" style="width:${barW}%;background:#${col}"></div>
      </div>
      <div class="cat-exp-icons">${iconStrip}${moreCount}</div>
    </div>`;
  }).join('');
}

/* ═══ CAT POPUP ════════════════════════════════════ */
let currentCat=null;
function openCatPopup(cat){
  currentCat=cat;
  renderCatPopupContent(cat);
  openModal('cat-popup');
}

// Load and apply cat-app custom order
// In-memory cache so we don't hit SharedPrefs on every popup open

function loadCatAppOrder(cat){
  if(!_catAppOrderCache){
    _catAppOrderCache = {};
    if(IS_NATIVE){ try{ _catAppOrderCache=JSON.parse(N.getCatAppOrder()||'{}'); }catch(e){} }
  }
  return _catAppOrderCache[cat]||null;
}
function saveCatAppOrder(cat, pkgList){
  if(!_catAppOrderCache) _catAppOrderCache={};
  _catAppOrderCache[cat]=pkgList;
  if(IS_NATIVE) nCall('saveCatAppOrder',JSON.stringify(_catAppOrderCache));
}
function getSortedApps(cat){
  const apps=[...(CATS_MAP[cat]||[])];
  const order=loadCatAppOrder(cat);
  if(!order) return apps;
  // Sort by saved order, unknown pkgs go to end
  const idx=pkg=>{ const i=order.indexOf(pkg); return i>=0?i:99999; };
  return apps.sort((a,b)=>idx(a.packageName)-idx(b.packageName));
}

function renderCatPopupContent(cat){
  const apps=getSortedApps(cat), ico=CAT_ICONS[cat]||'📱';
  document.getElementById('cp-ico').textContent=ico;
  document.getElementById('cp-title').textContent=cat;
  document.getElementById('cp-cnt').textContent=apps.length+' app'+(apps.length!==1?'s':'');
  const usageMap={};
  DAILY_USE.forEach(u=>{ usageMap[u.packageName]=u.totalMinutes; });
  const locked=new Set(S.lockedPkgs);
  const appsHtml = apps.map(a=>{
    const t=usageMap[a.packageName]; const ts=t?fmtM(t):'';
    return `<div class="cp-card" data-pkg="${escAttr(a.packageName)}" data-name="${escAttr(a.name)}"
      draggable="true"
      ondragstart="event.dataTransfer.setData('pkg','${escAttr(a.packageName)}');event.dataTransfer.setData('name','${escAttr(a.name)}');setTimeout(clearSearch,0)"
      onclick="launchApp('${escAttr(a.packageName)}','${escAttr(a.name)}')">
      <div class="cp-app-ico">${appIco(a.packageName,46,13)}</div>
      <div class="cp-app-name">${escHtml(a.name)}${locked.has(a.packageName)?' 🔒':''}</div>
      <div class="cp-app-time">${ts}</div>
      <div class="cp-drag-hint">⠿</div>
    </div>`;
  }).join('') || `<div style="grid-column:1/-1;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);text-align:center;padding:20px">No apps in this category.</div>`;
  const addTile = `<div class="cp-card" onclick="openAddAppsToCat('${cat}')" style="border:1px dashed var(--border2);background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
    <div style="font-size:22px;color:var(--t3)">＋</div>
    <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3)">Add apps</div>
  </div>`;
  document.getElementById('cp-grid').innerHTML = appsHtml + addTile;

  // ── Desktop/mouse drag-to-reorder inside popup ──────────────────────────
  let draggedCard=null;
  // Track drag leaving the popup — close popup so cat-tiles become droppable
  const cpModal = document.getElementById('cat-popup');
  if(cpModal){
    cpModal.addEventListener('dragleave', e=>{
      if(draggedCard && !cpModal.contains(e.relatedTarget)){
        // Drag left the popup — close it so cat-tiles underneath are droppable
        const pkg  = draggedCard.dataset.pkg;
        const name = draggedCard.dataset.name;
        draggedCard.style.opacity='1';
        draggedCard=null;
        // Set data in a global so dropAppOnCat can pick it up (HTML5 getData only works in drop)
        window._crossCatDragPkg  = pkg;
        window._crossCatDragName = name;
        closeModal('cat-popup');
      }
    });
  }
  document.querySelectorAll('#cp-grid .cp-card[data-pkg]').forEach(card=>{
    card.addEventListener('dragstart', e=>{
      draggedCard=card; card.style.opacity='.4';
      e.dataTransfer.setData('pkg', card.dataset.pkg);
      e.dataTransfer.setData('name', card.dataset.name);
    });
    card.addEventListener('dragend', ()=>{ if(draggedCard){ draggedCard.style.opacity='1'; draggedCard=null; } });
    card.addEventListener('dragover', e=>{ e.preventDefault(); card.style.background='var(--s2)'; });
    card.addEventListener('dragleave', ()=>{ card.style.background=''; });
    card.addEventListener('drop', e=>{
      e.preventDefault(); card.style.background='';
      if(!draggedCard||draggedCard===card) return;
      // Check if drop is within same popup (same-cat reorder)
      const fromPkg=e.dataTransfer.getData('pkg');
      if(!fromPkg||!apps.find(a=>a.packageName===fromPkg)) return; // cross-cat drop
      const grid=document.getElementById('cp-grid');
      const cards=[...grid.querySelectorAll('.cp-card[data-pkg]')];
      const toIdx=cards.indexOf(card);
      grid.insertBefore(draggedCard, card);
      // Save new order
      const newOrder=[...grid.querySelectorAll('.cp-card[data-pkg]')].map(c=>c.dataset.pkg).filter(Boolean);
      saveCatAppOrder(currentCat, newOrder);
      // Apply order to CATS_MAP
      const pkgSet=new Set(newOrder);
      const ordered=newOrder.map(pkg=>apps.find(a=>a.packageName===pkg)).filter(Boolean);
      const rest=apps.filter(a=>!pkgSet.has(a.packageName));
      CATS_MAP[currentCat]=[...ordered,...rest];
      toast('Reordered','success');
    });
  });

  // ── Touch drag to reorder (anywhere on card) + long-press for pick mode ──
  // State shared across all card listeners in this popup render
  let cpDrag={active:false,el:null,ghost:null,sx:0,sy:0,timer:null,hasMoved:false,crossTimer:null};

  function _cpReset(){
    if(cpDrag.ghost) cpDrag.ghost.remove();
    if(cpDrag.el) cpDrag.el.style.opacity='1';
    document.querySelectorAll('#cp-grid .cp-card[data-pkg]').forEach(c2=>{
      c2.style.outline=''; c2.style.transform='';
    });
    clearTimeout(cpDrag.timer); clearTimeout(cpDrag.crossTimer);
    cpDrag={active:false,el:null,ghost:null,sx:0,sy:0,timer:null,hasMoved:false,crossTimer:null};
  }

  function _cpStartGhost(card){
    const r=card.getBoundingClientRect();
    const g=card.cloneNode(true);
    g.style.cssText='position:fixed;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;z-index:9999;opacity:.88;pointer-events:none;box-shadow:0 14px 44px rgba(0,0,0,.6);border-radius:18px;transform:scale(1.08);transition:transform .12s';
    document.body.appendChild(g);
    cpDrag.ghost=g;
    card.style.opacity='.25';
    cpDrag.active=true;
    navigator.vibrate&&navigator.vibrate(18);
  }

  document.querySelectorAll('#cp-grid .cp-card[data-pkg]').forEach(card=>{
    // ── Long-press (400ms) → cross-category ghost drag, identical to search drag ──
    let cpPickTimer=null, cpPickDragging=false, cpPickGhost=null;

    card.addEventListener('touchstart', e=>{
      if(cpDrag.active) return;
      const t=e.touches[0];
      const pkg=card.dataset.pkg, name=card.dataset.name;
      const fromCat=currentCat;

      // Reorder drag state
      cpDrag.el=card; cpDrag.sx=t.clientX; cpDrag.sy=t.clientY; cpDrag.hasMoved=false;

      // 400ms hold → cross-category ghost drag (same pattern as search result drag)
      cpPickTimer=setTimeout(()=>{
        if(!pkg||!name||cpDrag.active) return;
        cpPickDragging=true;
        window._cpPickDragging = true; // expose for PTR check
        navigator.vibrate&&navigator.vibrate([30,15,50]);
        // Reset reorder state so it doesn't interfere
        clearTimeout(cpDrag.timer);
        cpDrag.el=null;
        // Build a compact floating ghost label (matches search drag style)
        cpPickGhost=document.createElement('div');
        cpPickGhost.style.cssText='position:fixed;z-index:9999;pointer-events:none;'
          +'background:var(--s1);border:2px solid var(--p);border-radius:12px;padding:8px 14px;'
          +'font-size:13px;font-weight:600;color:var(--t1);box-shadow:0 8px 24px rgba(0,0,0,.5);'
          +'white-space:nowrap;opacity:.92';
        cpPickGhost.textContent='📦 '+name;
        document.body.appendChild(cpPickGhost);
        positionGhost(cpPickGhost, t.clientX, t.clientY);
        // Close popup and go home so tiles are visible
        closeModal('cat-popup');
        activateTab('home');
        // Highlight all other tiles as drop targets
        document.querySelectorAll('.cat-exp-card[data-cat],.cat-row[data-cat]').forEach(tile=>{
          if(tile.dataset.cat!==fromCat){
            tile.style.boxShadow='inset 0 0 0 2.5px var(--p)';
            tile.dataset.tdHighlight='1';
          }
        });
        toast('Drop on a category to move '+name,'info');
      }, 400);
    },{passive:true});

    card.addEventListener('touchmove', e=>{
      // If cross-cat drag is active, move ghost and highlight tile under finger
      if(cpPickDragging && cpPickGhost){
        e.preventDefault();
        const t=e.touches[0];
        positionGhost(cpPickGhost, t.clientX, t.clientY);
        highlightCatUnder(t.clientX, t.clientY);
        _asUpdate(t.clientY, document.getElementById('screen-home'));
        return;
      }

      if(!cpDrag.el || cpDrag.el!==card) return;
      const t=e.touches[0];
      const dx=t.clientX-cpDrag.sx, dy=t.clientY-cpDrag.sy;
      const dist=Math.sqrt(dx*dx+dy*dy);

      if(!cpDrag.active){
        if(dist > 16){
          if(Math.abs(dy) > Math.abs(dx) * 1.4){
            // Vertical scroll — cancel everything
            clearTimeout(cpPickTimer);
            clearTimeout(cpDrag.timer);
            cpDrag.el=null;
            return;
          }
          // Horizontal drag → start reorder ghost; cancel pick timer
          clearTimeout(cpPickTimer);
          cpDrag.hasMoved=true;
          clearTimeout(cpDrag.timer);
          _cpStartGhost(card);
        }
        return;
      }

      e.preventDefault();
      const r=card.getBoundingClientRect();
      cpDrag.ghost.style.left=(t.clientX-r.width/2)+'px';
      cpDrag.ghost.style.top=(t.clientY-r.height/2)+'px';
      // Highlight target card for reorder
      cpDrag.ghost.style.visibility='hidden';
      const under=document.elementFromPoint(t.clientX,t.clientY);
      cpDrag.ghost.style.visibility='visible';
      const target=under&&under.closest('#cp-grid .cp-card[data-pkg]');
      document.querySelectorAll('#cp-grid .cp-card[data-pkg]').forEach(c2=>{
        c2.style.outline=c2===target&&c2!==card?'2px solid var(--p)':'';
      });
    },{passive:false});

    card.addEventListener('touchend', e=>{
      clearTimeout(cpPickTimer);

      // ── Cross-cat drop ──
      if(cpPickDragging){
        cpPickDragging=false;
        window._cpPickDragging = false;
        if(cpPickGhost){ cpPickGhost.remove(); cpPickGhost=null; }
        clearCatHighlights();
        const t=e.changedTouches[0];
        const cat=findCatAt(t.clientX, t.clientY);
        const pkg=card.dataset.pkg, name=card.dataset.name;
        if(cat && cat!==currentCat){
          assignAppToCategory(pkg, cat);
          scheduleGridRefresh();
          toast(name+' → '+cat,'success');
        } else if(!cat) {
          toast('Move cancelled','info',1000);
        }
        return;
      }

      // ── Reorder drop ──
      if(cpDrag.active&&cpDrag.el){
        const ghost=cpDrag.ghost; const draggedCard=cpDrag.el;
        ghost&&(ghost.style.visibility='hidden');
        const t=e.changedTouches[0];
        const under=document.elementFromPoint(t.clientX,t.clientY);
        ghost&&(ghost.style.visibility='visible');
        const target=under&&under.closest('#cp-grid .cp-card[data-pkg]');
        _cpReset();
        if(target&&target!==draggedCard){
          const grid=document.getElementById('cp-grid');
          const cards=[...grid.querySelectorAll('.cp-card[data-pkg]')];
          const fi=cards.indexOf(draggedCard), ti=cards.indexOf(target);
          if(fi<ti) grid.insertBefore(draggedCard, target.nextSibling);
          else grid.insertBefore(draggedCard, target);
          const newOrder=[...grid.querySelectorAll('.cp-card[data-pkg]')].map(c2=>c2.dataset.pkg).filter(Boolean);
          saveCatAppOrder(currentCat, newOrder);
          CATS_MAP[currentCat]=newOrder.map(pkg=>(CATS_MAP[currentCat]||[]).find(a=>a.packageName===pkg)).filter(Boolean);
          toast('Reordered ✓','success',1000);
        }
      } else {
        _cpReset();
      }
    },{passive:true});

    card.addEventListener('touchcancel', ()=>{
      clearTimeout(cpPickTimer);
      cpPickDragging=false;
      window._cpPickDragging = false;
      if(cpPickGhost){ cpPickGhost.remove(); cpPickGhost=null; }
      clearCatHighlights();
      _cpReset();
    },{passive:true});
  });
}

// Open sheet to add apps to a category
function openAddAppsToCat(cat){
  closeModal('cat-popup');
  // Use the existing lock-panel UI but repurposed for adding to a category
  openAddAppsToCatPanel(cat);
}

let addToCatTarget = null;
let tempAddToCat = new Set();
let _atcAllApps = []; // cached for search

function filterAddToCatList(query){
  const q = query.trim().toLowerCase();
  const filtered = q ? _atcAllApps.filter(a=>a.name.toLowerCase().includes(q)||a.packageName.toLowerCase().includes(q)) : _atcAllApps;
  const cat = addToCatTarget;
  document.getElementById('add-to-cat-list').innerHTML = filtered.map(a=>{
    const curCat = Object.keys(CATS_MAP).find(k=>CATS_MAP[k].some(x=>x.packageName===a.packageName))||'';
    return `<div class="app-sel-row" onclick="toggleTempAddToCat('${escAttr(a.packageName)}',this)">
      <div class="app-sel-ico">${appIco(a.packageName,40,11)}</div>
      <div style="flex:1"><div class="app-sel-name">${escHtml(a.name)}</div><div class="app-sel-sub">${escHtml(curCat)}</div></div>
      <div class="app-sel-check${tempAddToCat.has(a.packageName)?' on':''}" id="chk-atc-${a.packageName.replace(/\./g,'_')}"></div>
    </div>`;
  }).join('') || '<div style="font-family:var(--ff-m);font-size:12px;color:var(--t3);padding:20px;text-align:center">No apps match "'+escHtml(q)+'"</div>';
}

function openAddAppsToCatPanel(cat){
  addToCatTarget = cat;
  const currentPkgs = new Set((CATS_MAP[cat]||[]).map(a=>a.packageName));
  tempAddToCat = new Set(currentPkgs);
  document.getElementById('add-to-cat-title').textContent = 'Add to: '+cat;
  // Clear search
  const searchEl = document.getElementById('atc-search');
  if(searchEl) searchEl.value = '';
  // Load all apps
  let all = [];
  if(IS_NATIVE){ try{ all = JSON.parse(N.getAllApps()||'[]'); }catch(e){} }
  if(!all.length) all = Object.values(CATS_MAP).flat();
  all.sort((a,b)=>a.name.localeCompare(b.name));
  _atcAllApps = all;
  filterAddToCatList(''); // render initial list
  openPanel('add-to-cat-panel');
  // Auto-focus search with delay for panel animation
  setTimeout(()=>{ searchEl&&searchEl.focus(); }, 350);
}
function toggleTempAddToCat(pkg, row){
  const chk = document.getElementById('chk-atc-'+pkg.replace(/\./g,'_'));
  if(tempAddToCat.has(pkg)){ tempAddToCat.delete(pkg); chk?.classList.remove('on'); }
  else{ tempAddToCat.add(pkg); chk?.classList.add('on'); }
}
function saveAddToCat(){
  if(!addToCatTarget) return;
  const cat = addToCatTarget;
  // Get full app objects for selected pkgs
  let all = [];
  if(IS_NATIVE){ try{ all = JSON.parse(N.getAllApps()||'[]'); }catch(e){} }
  if(!all.length) all = Object.values(CATS_MAP).flat();
  const appMap = {};
  all.forEach(a => appMap[a.packageName] = a);
  // Update CATS_MAP — remove selected apps from other cats, add to target
  let acm = {};
  if(IS_NATIVE){ try{ acm=JSON.parse(N.getAppCategoryMap()||'{}'); }catch(e){} }
  tempAddToCat.forEach(pkg => {
    // Remove from other categories
    Object.keys(CATS_MAP).forEach(c => {
      if(c!==cat) CATS_MAP[c] = CATS_MAP[c].filter(a=>a.packageName!==pkg);
    });
    // Add to target if not already there
    if(!CATS_MAP[cat]) CATS_MAP[cat] = [];
    if(!CATS_MAP[cat].some(a=>a.packageName===pkg) && appMap[pkg]){
      CATS_MAP[cat].push({...appMap[pkg], category: cat});
    }
    acm[pkg] = cat;
  });
  // Remove apps that were deselected
  const all_pkgs = all.map(a=>a.packageName);
  all_pkgs.forEach(pkg => {
    if(!tempAddToCat.has(pkg) && CATS_MAP[cat]?.some(a=>a.packageName===pkg)){
      CATS_MAP[cat] = CATS_MAP[cat].filter(a=>a.packageName!==pkg);
      // Reset to auto-category
      delete acm[pkg];
    }
  });
  nCall('saveAppCategoryMap', JSON.stringify(acm));
  scheduleGridRefresh();
  closePanel('add-to-cat-panel');
  toast('Saved','success');
  addToCatTarget = null;
}

// Move a single app to another category via long-press
// ── Pick mode for long-press drag across categories (fix #6) ───────────────

function enterPickMode(pkg, name, fromCat){
  pickedApp = { pkg, name, fromCat };
  closeModal('cat-popup');
  activateTab('home');
  // Re-render grid so tiles show pick-mode drop targets
  renderCategoryGrid();
  toast('Tap a category to move ' + name, 'info');
}

function depositPickedApp(cat){
  if(!pickedApp) return;
  const { pkg, name } = pickedApp;
  pickedApp = null;
  assignAppToCategory(pkg, cat);
  scheduleGridRefresh();
  toast(name + ' → ' + cat, 'success');
}

function cancelPickMode(){
  pickedApp = null;
  clearCatHighlights();
  renderCategoryGrid();
}

// Cancel pick mode when user taps anywhere that isn't a category tile
document.addEventListener('click', e => {
  if(!pickedApp) return;
  if(!e.target.closest('.cat-exp-card[data-cat],.cat-row[data-cat]')) cancelPickMode();
}, true);

function openMoveAppSheet(pkg, name){
  const cats = Object.keys(CATS_MAP).filter(c => !CATS_MAP[c]?.some(a=>a.packageName===pkg));
  if(!cats.length){ toast('No other categories','info'); return; }
  const html = `<div style="padding:20px 20px 40px">
    <div class="sheet-title" style="margin-bottom:14px">Move "${name}" to…</div>
    ${cats.map(c=>`<div class="cat-list-row" onclick="assignAppToCategory('${pkg}','${c}');closeModal('move-app-modal');renderCatPopupContent(currentCat);toast('Moved to ${c}','success')">
      <div style="font-size:20px">${CAT_ICONS[c]||'📱'}</div>
      <div style="flex:1;font-size:14px;font-weight:600">${c}</div>
      <span style="color:var(--t3)">›</span>
    </div>`).join('')}
  </div>`;
  document.getElementById('move-app-sheet-body').innerHTML = html;
  openModal('move-app-modal');
}
function openEditCatFromPopup(){ if(currentCat){ closeModal('cat-popup'); openEditCat(currentCat); } }

/* ═══ MANAGE CATS ════════════════════════════════════ */
let editingCat=null;
function renderManageCats(){
  const cats = getEffectiveCatOrder(), wrap=document.getElementById('mcp-rows');
  wrap.innerHTML=cats.map(cat=>{
    const apps=CATS_MAP[cat]||[], ico=CAT_ICONS[cat]||'📱';
    return `<div class="cat-list-row" draggable="true" data-cat="${cat}" style="cursor:grab">
      <span class="mcp-handle" style="color:var(--t3);font-size:22px;flex-shrink:0;padding:4px 8px 4px 0;touch-action:none">⠿</span>
      <div style="font-size:20px;flex-shrink:0">${ico}</div>
      <div style="flex:1"><div style="font-size:13px;font-weight:600">${cat}</div><div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);margin-top:2px">${apps.length} apps</div></div>
      <div style="display:flex;gap:5px">
        <button style="padding:5px 8px;border-radius:8px;border:1px solid var(--border2);background:var(--s2);font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);cursor:pointer" onclick="openEditCat('${cat}')">✎</button>
        <button style="padding:5px 8px;border-radius:8px;border:1px solid var(--border2);background:var(--s2);font-family:var(--ff-m);font-size:var(--text-2xs);cursor:pointer;color:var(--r)" onclick="confirmDelCatByName('${cat}')">🗑</button>
      </div>
    </div>`;
  }).join('');
  initDrag();
}
function initDrag(){
  const wrap = document.getElementById('mcp-rows');
  const panel = wrap.closest('.panel-body');

  // ── shared drag state ──────────────────────────────────────────────────────
  let ds = null; // { el, ghost, handleY, rows, rects, curIdx, origIdx }

  function _rows(){ return [...wrap.querySelectorAll('[data-cat]')]; }

  function _cleanup(commit){
    _asStop();
    if(!ds) return;
    const { el, ghost, rows, origIdx, curIdx } = ds;
    // Remove transforms with a settle transition
    rows.forEach(r=>{
      r.style.transition = 'transform .22s cubic-bezier(.25,.46,.45,.94)';
      r.style.transform  = '';
      r.style.willChange = '';
    });
    el.style.opacity    = '';
    el.style.visibility = '';
    el.style.transition = 'opacity .18s';

    if(commit && curIdx !== origIdx && curIdx >= 0){
      // Commit DOM order
      const after = rows[curIdx > origIdx ? curIdx : curIdx - 1];
      if(after && after !== el){
        if(curIdx > origIdx) wrap.insertBefore(el, after.nextSibling);
        else wrap.insertBefore(el, after);
      } else if(curIdx === 0){
        wrap.prepend(el);
      }
      // Animate ghost snapping to new position
      const newRect = el.getBoundingClientRect();
      ghost.style.transition = 'top .2s cubic-bezier(.25,.46,.45,.94), transform .2s, box-shadow .2s, opacity .15s .1s';
      ghost.style.top        = newRect.top + 'px';
      ghost.style.transform  = 'scale(1)';
      ghost.style.boxShadow  = '0 2px 8px rgba(0,0,0,.18)';
      ghost.style.opacity    = '0';
      setTimeout(()=>{ ghost.remove(); }, 300);
      // Persist new order
      S.catOrder = _rows().map(r=>r.dataset.cat);
      saveS(); renderCategoryGrid(); renderCategoryList();
      toast('Reordered ✓','success',1400);
    } else {
      ghost.style.transition = 'transform .18s, opacity .18s';
      ghost.style.transform  = 'scale(1)';
      ghost.style.opacity    = '0';
      setTimeout(()=>ghost.remove(), 200);
    }
    // Clean up row transitions after settle
    setTimeout(()=>{ _rows().forEach(r=>{ r.style.transition=''; }); }, 260);
    ds = null;
  }

  function _shiftRows(targetIdx){
    if(!ds) return;
    const { rows, origIdx, rects } = ds;
    const h = rects[origIdx].height + 8; // row height + margin
    rows.forEach((r, i) => {
      if(i === origIdx){ return; } // placeholder, always stays
      let shift = 0;
      if(origIdx < targetIdx){
        // Dragged down: shift rows between origIdx+1..targetIdx up
        if(i > origIdx && i <= targetIdx) shift = -h;
      } else {
        // Dragged up: shift rows between targetIdx..origIdx-1 down
        if(i >= targetIdx && i < origIdx) shift = h;
      }
      r.style.transition = 'transform .2s cubic-bezier(.25,.46,.45,.94)';
      r.style.transform  = shift ? `translateY(${shift}px)` : '';
    });
    ds.curIdx = targetIdx;
  }

  function _computeTargetIdx(ghostCenterY){
    if(!ds) return ds?.origIdx ?? 0;
    const { rows, origIdx, rects } = ds;
    // Find which row the ghost center overlaps, accounting for shifts
    let best = origIdx, bestDist = Infinity;
    const h = rects[origIdx].height + 8;
    rows.forEach((r, i) => {
      if(i === origIdx) return;
      let shift = 0;
      const prev = ds.curIdx;
      if(origIdx < prev){ if(i > origIdx && i <= prev) shift = -h; }
      else               { if(i >= prev && i < origIdx) shift = h; }
      const midY = rects[i].top + rects[i].height/2 + shift;
      const dist = Math.abs(ghostCenterY - midY);
      if(dist < bestDist){ bestDist = dist; best = i; }
    });
    return best;
  }

  // ── Touch handlers ──────────────────────────────────────────────────────────
  function attachRow(row){
    const handle = row.querySelector('.mcp-handle');
    const target = handle || row;

    target.addEventListener('touchstart', e=>{
      if(ds) return; // already dragging
      const t = e.touches[0];
      const rows = _rows();
      const origIdx = rows.indexOf(row);
      if(origIdx < 0) return;

      // Snapshot rects before any transforms
      const rects = rows.map(r => r.getBoundingClientRect());
      const rect  = rects[origIdx];

      // Build the floating ghost (full-width clone)
      const ghost = row.cloneNode(true);
      ghost.style.cssText = [
        'position:fixed',
        `left:${rect.left}px`,
        `top:${rect.top}px`,
        `width:${rect.width}px`,
        `height:${rect.height}px`,
        'z-index:9999',
        'pointer-events:none',
        'border-radius:13px',
        'background:var(--s2)',
        'border:1.5px solid var(--p)',
        'box-shadow:0 12px 40px rgba(0,0,0,.45)',
        'transform:scale(1.03)',
        'transition:box-shadow .15s, transform .15s',
        'will-change:top,transform',
        'opacity:.96',
      ].join(';');
      document.body.appendChild(ghost);

      // Dim the source row in place (acts as drop placeholder)
      row.style.opacity    = '0.25';
      row.style.willChange = 'transform';

      // Prepare sibling transitions
      rows.forEach(r=>{ if(r!==row){ r.style.willChange='transform'; } });

      ds = { el:row, ghost, handleY: t.clientY - rect.top, rows, rects, curIdx:origIdx, origIdx };
      navigator.vibrate && navigator.vibrate(12);
    }, { passive:true });

    target.addEventListener('touchmove', e=>{
      if(!ds || ds.el !== row) return;
      e.preventDefault();
      const t = e.touches[0];
      const { ghost, rects, origIdx, handleY } = ds;

      // Move ghost
      const newTop = t.clientY - handleY;
      ghost.style.top = newTop + 'px';

      // Auto-scroll panel
      _asUpdate(t.clientY, panel);

      // Determine new target index from ghost centre
      const ghostCY = newTop + rects[origIdx].height / 2;
      const newIdx  = _computeTargetIdx(ghostCY);
      if(newIdx !== ds.curIdx) _shiftRows(newIdx);
    }, { passive:false });

    target.addEventListener('touchend', ()=>{
      if(!ds || ds.el !== row) return;
      _cleanup(true);
    }, { passive:true });

    target.addEventListener('touchcancel', ()=>{
      if(!ds || ds.el !== row) return;
      _cleanup(false);
    }, { passive:true });
  }

  // ── Mouse (desktop) fallback — keep for PC preview ─────────────────────────
  let mouseSrc = null;
  wrap.querySelectorAll('[data-cat]').forEach(row=>{
    row.setAttribute('draggable','true');
    row.addEventListener('dragstart', ()=>{ mouseSrc=row; setTimeout(()=>row.style.opacity='.35',0); });
    row.addEventListener('dragend',   ()=>{ row.style.opacity='1'; mouseSrc=null; });
    row.addEventListener('dragover',  e =>{ e.preventDefault(); });
    row.addEventListener('drop', e=>{
      e.preventDefault();
      if(mouseSrc && mouseSrc!==row){
        wrap.insertBefore(mouseSrc, row);
        S.catOrder = _rows().map(r=>r.dataset.cat);
        saveS(); renderCategoryGrid(); renderCategoryList(); toast('Reordered ✓','success');
      }
    });
    attachRow(row);
  });
}
function updateCatsSub(){
  const total = Object.keys(CATS_MAP).length;
  // Use N.getAllApps() for the real installed-app count (includes auto-categorised apps
  // that may not yet appear in CATS_MAP). Falls back to CATS_MAP count in demo mode.
  let apps = Object.values(CATS_MAP).flat().length;
  if(IS_NATIVE && typeof N !== 'undefined' && typeof N.getAllApps === 'function'){
    try{ apps = JSON.parse(N.getAllApps()||'[]').length; }catch(_){}
  }
  const text = `${total} categories · ${apps} apps`;
  const el = document.getElementById('cats-sub');
  if(el) el.textContent = text;
  // Keep Settings > Organisation subtitle in sync
  const orgEl = document.getElementById('org-cats-sub');
  if(orgEl) orgEl.textContent = text;
}

/* ═══ EDIT CAT ═══════════════════════════════════════ */
function openAddCatModal(){
  // Phase 3 (#7): Creating custom categories is a Pro feature (free limit = 0)
  if(!ProTier.canAccess('UNLIMITED_CATEGORIES')){
    ProTier.triggerUpsell('UNLIMITED_CATEGORIES');
    return;
  }
  editingCat=null; document.getElementById('ecm-title').textContent='New Category'; document.getElementById('ecm-name').value=''; document.querySelectorAll('.icon-btn').forEach(b=>b.classList.remove('on')); document.getElementById('ecm-del-row').style.display='none'; openModal('edit-cat-modal');
}
function openEditCat(name){ editingCat=name; document.getElementById('ecm-title').textContent='Edit: '+name; document.getElementById('ecm-name').value=name; document.querySelectorAll('.icon-btn').forEach(b=>b.classList.toggle('on',b.textContent===(CAT_ICONS[name]||''))); document.getElementById('ecm-del-row').style.display=''; openModal('edit-cat-modal'); }
function saveEditCat(){
  const name=document.getElementById('ecm-name').value.trim();
  if(!name){ toast('Enter a name','warn'); return; }
  const ico=document.querySelector('.icon-btn.on')?.textContent||'📁';
  if(editingCat&&editingCat!==name){
    CATS_MAP[name]=CATS_MAP[editingCat]||[];
    delete CATS_MAP[editingCat];
    CAT_ICONS[name]=ico;
    delete CAT_ICONS[editingCat];
    S.catOrder=S.catOrder.map(c=>c===editingCat?name:c);
    // Update app->category map: rename all entries pointing to old name
    if(IS_NATIVE){
      try{
        const acm=JSON.parse(N.getAppCategoryMap()||'{}');
        Object.keys(acm).forEach(pkg=>{ if(acm[pkg]===editingCat) acm[pkg]=name; });
        nCall('saveAppCategoryMap',JSON.stringify(acm));
      }catch(e){}
    }
  } else if(!editingCat){
    CATS_MAP[name]=[];
    // Persist user-created category so it survives restart (fix #3)
    if(IS_NATIVE){
      try{
        const userCats=JSON.parse(N.getUserCategories()||'[]');
        if(!userCats.includes(name)){ userCats.push(name); nCall('saveUserCategories',JSON.stringify(userCats)); }
      }catch(e){}
    }
  }
  CAT_ICONS[name]=ico;
  nCall('saveCategoryOverrides',JSON.stringify(CAT_ICONS));
  saveS(); scheduleGridRefresh(); renderManageCats();
  closeModal('edit-cat-modal'); toast(editingCat?`Updated: ${name}`:`Created: ${name}`,'success'); editingCat=null;
}
function confirmDelCat(){ if(editingCat) confirmDelCatByName(editingCat); }

/* ══ APP LOCK — PIN SETUP & SETTINGS ════════════════════════════════════════
 * 6b: PIN setup modal — shown before user can lock any app (no PIN set yet)
 * 6c: renderAppLockSettings() — shown in the App Lock settings section
 * ========================================================================= */

/* ── 6b: PIN setup modal — custom numpad, consistent with AppLockActivity ──
 *
 * Two-step flow:
 *   Step 1 — "Enter PIN"   : user taps 4 digits → auto-advances to step 2
 *   Step 2 — "Confirm PIN" : user re-enters same 4 digits → saves
 *
 * No system keyboard. 4-dot indicator + 3×4 numpad grid.
 * Biometric toggle shown on step 2 before final save.
 * ─────────────────────────────────────────────────────────────────────────── */

/* Internal state for the numpad flow */
var _pinStep     = 1;   // 1 = enter, 2 = confirm
var _pinBuf1     = '';  // digits from step 1
var _pinBuf2     = '';  // digits from step 2
var _pinIsChange = false;

function openPinSetupModal(isChange) {
  _pinIsChange = isChange;
  _pinStep  = 1;
  _pinBuf1  = '';
  _pinBuf2  = '';

  if (!document.getElementById('pin-setup-modal')) {
    const html = `
    <div id="pin-setup-modal" class="modal-bg">
      <div class="sheet" style="max-height:92vh;overflow:hidden">
        <div class="sheet-handle"></div>
        <div class="sheet-hdr">
          <div class="sheet-title" id="pin-modal-title">Set App Lock PIN</div>
          <div onclick="closeModal('pin-setup-modal')"
               style="cursor:pointer;padding:6px 10px;color:var(--t3);font-size:18px;line-height:1">✕</div>
        </div>
        <div class="sheet-body" style="padding:0 20px 32px">

          <!-- Step label -->
          <div id="pin-step-label"
               style="text-align:center;font-family:var(--ff-m);font-size:11px;
                      letter-spacing:.12em;color:var(--t3);margin:14px 0 20px;
                      text-transform:uppercase">
            Enter a 4-digit PIN
          </div>

          <!-- Dot indicator -->
          <div id="pin-dots"
               style="display:flex;justify-content:center;gap:14px;margin-bottom:12px">
            <div class="pin-dot" data-idx="0"></div>
            <div class="pin-dot" data-idx="1"></div>
            <div class="pin-dot" data-idx="2"></div>
            <div class="pin-dot" data-idx="3"></div>
          </div>

          <!-- Error label -->
          <div id="pin-error"
               style="text-align:center;font-family:var(--ff-m);font-size:12px;
                      color:#E86B5F;min-height:18px;margin-bottom:10px;
                      visibility:hidden">
            &nbsp;
          </div>

          <!-- Numpad grid -->
          <div id="pin-numpad"
               style="display:grid;grid-template-columns:repeat(3,1fr);
                      gap:10px;max-width:264px;margin:0 auto 20px">
          </div>

          <!-- Biometric toggle — hidden until step 2 -->
          <div id="pin-bio-row"
               style="display:none;align-items:center;gap:12px;padding:13px 15px;
                      background:var(--s1);border:1px solid var(--border);
                      border-radius:12px;margin-bottom:4px">
            <div style="flex:1">
              <div style="font-size:14px;font-weight:600">Fingerprint / Face Unlock</div>
              <div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px">
                Use biometric to unlock locked apps
              </div>
            </div>
            <div id="pin-bio-tog" class="tog on" onclick="pinToggleBiometric(this)">
              <div class="tog-knob"></div>
            </div>
          </div>

        </div>
      </div>
    </div>
    <style>
      .pin-dot {
        width: 13px; height: 13px; border-radius: 50%;
        background: rgba(255,255,255,.12);
        border: 1.5px solid rgba(255,255,255,.28);
        transition: background .15s, border-color .15s, transform .1s;
      }
      .pin-dot.filled {
        background: var(--p2);
        border-color: var(--p2);
        transform: scale(1.1);
      }
      .pin-key {
        height: 62px; border-radius: 50%;
        background: rgba(255,255,255,.07);
        border: 1px solid rgba(255,255,255,.1);
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; font-weight: 700; color: var(--t1);
        cursor: pointer; user-select: none;
        transition: background .12s, transform .1s;
        -webkit-tap-highlight-color: transparent;
      }
      .pin-key:active { background: rgba(255,255,255,.18); transform: scale(.93); }
      .pin-key.del { font-size: 20px; }
      .pin-key.spacer { background: transparent; border-color: transparent; cursor: default; }
      @keyframes pinShake {
        0%,100%{ transform:translateX(0) }
        20%{ transform:translateX(-10px) }
        40%{ transform:translateX(10px) }
        60%{ transform:translateX(-6px) }
        80%{ transform:translateX(6px) }
      }
      .pin-shake { animation: pinShake .35s ease; }
    </style>`;
    document.body.insertAdjacentHTML('beforeend', html);
    _pinBuildNumpad();
  }

  // Reset state on every open
  _pinStep = 1; _pinBuf1 = ''; _pinBuf2 = '';
  _pinSyncUI();

  // Sync biometric toggle
  const bioTog = document.getElementById('pin-bio-tog');
  if (bioTog && IS_NATIVE) {
    const bioOn = N.isBiometricEnabled();
    bioTog.classList.toggle('on', bioOn);
    bioTog.classList.toggle('off', !bioOn);
  }

  openModal('pin-setup-modal');
}

function _pinBuildNumpad() {
  const grid = document.getElementById('pin-numpad');
  if (!grid) return;
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  grid.innerHTML = keys.map(k => {
    if (k === '') return `<div class="pin-key spacer"></div>`;
    if (k === '⌫') return `<div class="pin-key del" onclick="_pinKey('⌫')">⌫</div>`;
    return `<div class="pin-key" onclick="_pinKey('${k}')">${k}</div>`;
  }).join('');
}

function _pinKey(k) {
  const buf = _pinStep === 1 ? '_pinBuf1' : '_pinBuf2';
  if (k === '⌫') {
    if (_pinStep === 1) _pinBuf1 = _pinBuf1.slice(0, -1);
    else                _pinBuf2 = _pinBuf2.slice(0, -1);
    _pinClearError();
  } else {
    const cur = _pinStep === 1 ? _pinBuf1 : _pinBuf2;
    if (cur.length >= 4) return;   // max 4 digits
    if (_pinStep === 1) _pinBuf1 += k;
    else                _pinBuf2 += k;
  }
  _pinRefreshDots();

  // Auto-advance / auto-submit on 4th digit
  const len = (_pinStep === 1 ? _pinBuf1 : _pinBuf2).length;
  if (len === 4) {
    setTimeout(() => {
      if (_pinStep === 1) {
        // Advance to confirm step
        _pinStep = 2;
        _pinSyncUI();
      } else {
        // Validate & save
        _pinTrySave();
      }
    }, 150);
  }
}

function _pinRefreshDots() {
  const filled = (_pinStep === 1 ? _pinBuf1 : _pinBuf2).length;
  document.querySelectorAll('#pin-setup-modal .pin-dot').forEach((d, i) => {
    d.classList.toggle('filled', i < filled);
  });
}

function _pinSyncUI() {
  // Title
  const titleEl = document.getElementById('pin-modal-title');
  if (titleEl) titleEl.textContent = _pinIsChange ? 'Change App Lock PIN' : 'Set App Lock PIN';

  // Step label
  const lbl = document.getElementById('pin-step-label');
  if (lbl) lbl.textContent = _pinStep === 1 ? 'Enter a 4-digit PIN' : 'Confirm your PIN';

  // Dots — reset to empty
  document.querySelectorAll('#pin-setup-modal .pin-dot').forEach(d => d.classList.remove('filled'));

  // Biometric row — show only on step 2
  const bioRow = document.getElementById('pin-bio-row');
  if (bioRow) bioRow.style.display = _pinStep === 2 ? 'flex' : 'none';

  _pinClearError();
}

function _pinShowError(msg) {
  const el = document.getElementById('pin-error');
  if (!el) return;
  el.textContent = msg;
  el.style.visibility = 'visible';
  // Shake dots
  const dotsEl = document.getElementById('pin-dots');
  if (dotsEl) {
    dotsEl.classList.remove('pin-shake');
    void dotsEl.offsetWidth;  // reflow to restart animation
    dotsEl.classList.add('pin-shake');
    setTimeout(() => dotsEl.classList.remove('pin-shake'), 400);
  }
}

function _pinClearError() {
  const el = document.getElementById('pin-error');
  if (el) { el.textContent = '\u00a0'; el.style.visibility = 'hidden'; }
}

function _pinTrySave() {
  if (_pinBuf1 !== _pinBuf2) {
    _pinShowError("PINs don't match — try again");
    // Reset to step 1
    setTimeout(() => { _pinStep = 1; _pinBuf1 = ''; _pinBuf2 = ''; _pinSyncUI(); }, 600);
    return;
  }
  if (!IS_NATIVE) { toast('PIN setup requires the native app', 'warn'); return; }
  const ok = N.setPin(_pinBuf1);
  if (ok) {
    closeModal('pin-setup-modal');
    toast('App Lock PIN set ✓', 'success');
    const wrap = document.getElementById('app-lock-settings-wrap');
    if (wrap) wrap.innerHTML = renderAppLockSettings();
  } else {
    toast('Could not save PIN — secure storage unavailable', 'error');
  }
}

function pinToggleBiometric(tog) {
  const isOn = tog.classList.contains('on');
  tog.classList.toggle('on', !isOn);
  tog.classList.toggle('off', isOn);
  if (IS_NATIVE) N.setBiometricEnabled(!isOn);
}

// Keep savePinSetup as no-op alias (not called anywhere but kept for safety)
function savePinSetup() { _pinTrySave(); }

/* ── 6c: App Lock settings rows (PIN + biometric toggle) ───────────────── */
function renderAppLockSettings() {
  const pinSetup  = IS_NATIVE && N.isPinSetup();
  const biometric = IS_NATIVE && N.isBiometricEnabled();
  if (!pinSetup) {
    return `
    <div class="sr" onclick="openPinSetupModal(false)" style="border-radius:13px">
      <div class="sr-ico sr-ico--lock"></div>
      <div style="flex:1">
        <div class="sr-lbl">Set Up App Lock PIN</div>
        <div class="sr-sub">Required before locking any app</div>
      </div>
      <div class="sr-chev">›</div>
    </div>`;
  }
  return `
  <div class="sr" onclick="openChangePinModal()" style="border-radius:13px 13px 0 0">
    <div class="sr-ico sr-ico--lock"></div>
    <div style="flex:1">
      <div class="sr-lbl">Change PIN</div>
      <div class="sr-sub">Tap to change your app lock PIN</div>
    </div>
    <div class="sr-chev">›</div>
  </div>
  <div class="sr" style="border-radius:0 0 13px 13px;border-top:none">
    <div class="sr-ico" style="background:rgba(108,99,255,.12);color:var(--p2)">👆</div>
    <div style="flex:1">
      <div class="sr-lbl">Fingerprint / Face Unlock</div>
      <div class="sr-sub">Use biometric to unlock apps</div>
    </div>
    <div class="tog ${biometric ? 'on' : 'off'}" onclick="appLockToggleBiometric(this)">
      <div class="tog-knob"></div>
    </div>
  </div>`;
}

function appLockToggleBiometric(tog) {
  const isOn = tog.classList.contains('on');
  tog.classList.toggle('on', !isOn);
  tog.classList.toggle('off', isOn);
  if (IS_NATIVE) N.setBiometricEnabled(!isOn);
}

function openChangePinModal() {
  openPinSetupModal(true);
}

function openLockPanel() {
  const wrap = document.getElementById('app-lock-settings-wrap');
  if (wrap) wrap.innerHTML = renderAppLockSettings();
  openPanel('lock-panel');
}

function confirmDelCatByName(name){
  showConfirm(`Delete "${name}"?`,'Apps will move back to auto-categorized groups.',()=>{
    // ── Fix 3: record this category as user-deleted so Play Store sync never restores it ──
    try{
      let deleted=[];
      if(IS_NATIVE && typeof N.getStringPref==='function') deleted=JSON.parse(N.getStringPref('deletedCategories')||'[]');
      else deleted=JSON.parse(localStorage.getItem('deletedCategories')||'[]');
      if(!deleted.includes(name)) deleted.push(name);
      if(IS_NATIVE && typeof N.setStringPref==='function') N.setStringPref('deletedCategories',JSON.stringify(deleted));
      else localStorage.setItem('deletedCategories',JSON.stringify(deleted));
    }catch(_){}
    let acm={};
    if(IS_NATIVE){ try{ acm=JSON.parse(N.getAppCategoryMap()||'{}'); }catch(e){} }
    // Remap apps currently visible in CATS_MAP[name]
    (CATS_MAP[name]||[]).forEach(a=>{ acm[a.packageName]='Other'; });
    // Also remap anything already in appCatMap pointing to this name
    Object.keys(acm).forEach(pkg=>{ if(acm[pkg]===name) acm[pkg]='Other'; });
    // Remap auto-categorized apps from Kotlin that would recreate the category
    if(IS_NATIVE){
      try{
        JSON.parse(N.getAllApps()||'[]').filter(a=>a.category===name).forEach(a=>{
          if(!acm[a.packageName] || acm[a.packageName]===name) acm[a.packageName]='Other';
        });
      }catch(e){}
    }
    if(IS_NATIVE){
      nCall('saveAppCategoryMap',JSON.stringify(acm));
      // Remove from user-created categories list (fix #3)
      try{
        const userCats=JSON.parse(N.getUserCategories()||'[]').filter(c=>c!==name);
        nCall('saveUserCategories',JSON.stringify(userCats));
      }catch(e){}
    }
    // Update live CATS_MAP
    if(!CATS_MAP['Other']) CATS_MAP['Other']=[];
    (CATS_MAP[name]||[]).forEach(a=>{
      if(!CATS_MAP['Other'].some(x=>x.packageName===a.packageName))
        CATS_MAP['Other'].push({...a,category:'Other'});
    });
    delete CATS_MAP[name]; delete CAT_ICONS[name];
    S.catOrder=(S.catOrder||[]).filter(c=>c!==name);
    nCall('saveCategoryOverrides',JSON.stringify(CAT_ICONS));
    if(!CATS_MAP['Other']?.length) delete CATS_MAP['Other'];
    _allAppsCache=null; // invalidate search cache
    saveS(); scheduleGridRefresh(); renderManageCats();
    // Close ALL modals that might be open (cat-popup AND edit-cat-modal)
    closeModal('edit-cat-modal');
    closeModal('cat-popup');
    currentCat=null;
    toast(`Deleted "${name}"`, 'warn');
  });
}