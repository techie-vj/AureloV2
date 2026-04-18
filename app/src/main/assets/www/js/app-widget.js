/* ══════════════════ WIDGET SETTINGS ══════════════════ */
const WIDGET_THEMES = [
  { key:'DEFAULT',       name:'Default',       desc:'Translucent glass',   isPro:false,
    swatch:'rgba(255,255,255,0.12)', emoji:'🪟',
    mini:{ bg:'rgba(20,20,40,0.85)', searchBg:'rgba(255,255,255,0.10)', text:'rgba(255,255,255,0.9)',  bar:'#6C63FF' } },
  { key:'DARK_AMOLED',   name:'Dark AMOLED',   desc:'Pure black · Saves battery',  isPro:true,
    swatch:'#0A0A0A', emoji:'⬛',
    mini:{ bg:'#0A0A0A', searchBg:'#111111', text:'rgba(255,255,255,0.85)', bar:'#FFFFFF' } },
  { key:'MINIMAL_MONO',  name:'Minimal Mono',  desc:'Light · Greyscale',   isPro:true,
    swatch:'#F0EDE8', emoji:'⬜',
    mini:{ bg:'#FFFFFF', searchBg:'#F5F2EE', text:'#222222', bar:'#333333' } },
  { key:'NEON_GLOW',     name:'Neon Glow',     desc:'Dark space · App glows', isPro:true,
    swatch:'linear-gradient(135deg,#06061C,#1a0060)', emoji:'✨',
    mini:{ bg:'rgba(6,6,28,0.95)', searchBg:'rgba(108,99,255,0.12)', text:'rgba(157,151,255,0.9)', bar:'#6C63FF' } },
  { key:'FROSTED_GLASS', name:'Frosted Glass', desc:'Heavy blur · Vivid wallpaper', isPro:true,
    swatch:'linear-gradient(135deg,rgba(108,99,255,0.5),rgba(18,212,138,0.4))', emoji:'🧊',
    mini:{ bg:'rgba(255,255,255,0.14)', searchBg:'rgba(255,255,255,0.22)', text:'#FFFFFF', bar:'rgba(255,255,255,0.8)' } },
  { key:'DYNAMIC_COLOR', name:'Dynamic Color', desc:'Material You · Tonal', isPro:true,
    swatch:'linear-gradient(135deg,#fce4ec,#e8eaf6,#e0f7fa)', emoji:'🎨',
    mini:{ bg:'#FFFBFE', searchBg:'#F3EDF7', text:'#1C1B1F', bar:'#6750A4' } },
];
let _wThemeKey = 'DEFAULT';
let _wApps = [];

function initWidgetSettings(){
  // Always render the theme list — it's static and doesn't need the bridge
  if(IS_NATIVE){
    try{ _wThemeKey = N.getWidgetTheme() || 'DEFAULT'; }catch(_){ _wThemeKey='DEFAULT'; }
    try{ _wApps = JSON.parse(N.getWidgetApps()||'[]'); }catch(_){ _wApps=[]; }
  }
  renderWidgetThemeList();
  renderMiniWidget();
  if(IS_NATIVE){ renderWidgetStorageStats(); updateWidgetBar(); }
}

function renderWidgetThemeList(){
  const el = document.getElementById('widgetThemeList'); if(!el) return;
  const isPro = ProTier.isPro;
  el.innerHTML = WIDGET_THEMES.map(t=>{
    const active  = t.key === _wThemeKey;
    const locked  = t.isPro && !isPro;
    return `<div class="theme-pick-row"
                 onclick="${locked ? `ProTier.triggerUpsell('WIDGET_AMOLED')` : `selectWidgetTheme('${t.key}')`}"
                 style="${locked ? 'opacity:.65;cursor:pointer' : ''}">
      <div class="theme-swatch" style="background:${t.swatch}">${t.emoji}</div>
      <div style="flex:1">
        <div class="theme-pick-name" style="display:flex;align-items:center;gap:6px">
          ${t.name}
          ${locked ? (typeof proBadge==='function' ? proBadge(true) : '') : ''}
        </div>
        <div class="theme-pick-desc">${t.desc}</div>
      </div>
      <div class="${active?'theme-check':'theme-unsel'}">${active?'✓':'○'}</div>
    </div>`;
  }).join('');
  // Update the subtitle with current theme name
  const sub = document.getElementById('widgetThemeSub');
  const active = WIDGET_THEMES.find(t=>t.key===_wThemeKey);
  if(sub && active) sub.textContent = active.name;
}

function toggleWidgetThemes(){
  const list = document.getElementById('widgetThemeList');
  const chev = document.getElementById('widgetThemeChevron');
  if(!list) return;
  const isOpen = list.style.maxHeight && list.style.maxHeight !== '0px';
  if(isOpen){
    list.style.maxHeight = '0px';
    list.style.opacity   = '0';
    if(chev) chev.style.transform = '';
  } else {
    // Render content first so scrollHeight is correct
    renderWidgetThemeList();
    list.style.display   = 'block';
    list.style.maxHeight = list.scrollHeight + 'px';
    list.style.opacity   = '1';
    if(chev) chev.style.transform = 'rotate(90deg)';
  }
}

function renderMiniWidget(){
  const t = WIDGET_THEMES.find(x=>x.key===_wThemeKey)||WIDGET_THEMES[0];
  const card = document.getElementById('miniWidgetPreview'); if(!card) return;
  card.style.background = t.mini.bg;
  const insight = document.getElementById('mwInsightBar');
  if(insight){ insight.style.background=t.mini.searchBg; }
  const textVal = t.mini.text||'';
  const dark = textVal.includes('255') || textVal==='#FFFFFF' || textVal.startsWith('rgba(255');
  const subColor = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';

  // Time-based slot name + glow dot color — mirrors Kotlin TimeSlot enum exactly
  const h = new Date().getHours();
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName  = dayNames[new Date().getDay()];
  let slotName, dotColor, dotGlow, nameColor;
  let insightMsg;
  if      (h>=6  && h<=8)  { slotName=`${dayName} ☀️ Morning`;   dotColor='#F7A623'; dotGlow='rgba(247,166,35,.55)';  nameColor='#F7A623'; insightMsg='🌅 Rise & shine! Make today count'; }
  else if (h>=9  && h<=10) { slotName=`${dayName} 🚌 Commute`;   dotColor='#5DD6F8'; dotGlow='rgba(93,214,248,.55)';  nameColor='#5DD6F8'; insightMsg='📊 Deep work mode — fewer pickups = better focus'; }
  else if (h>=11 && h<=13) { slotName=`${dayName} 🌤 Midday`;    dotColor='#12D48A'; dotGlow='rgba(18,212,138,.55)';  nameColor='#12D48A'; insightMsg='⏱ Halfway through — pacing well'; }
  else if (h>=14 && h<=16) { slotName=`${dayName} 🌞 Afternoon`; dotColor='#5DD6F8'; dotGlow='rgba(93,214,248,.55)';  nameColor='#5DD6F8'; insightMsg='📈 Check your pacing — goal in sight'; }
  else if (h>=17 && h<=20) { slotName=`${dayName} 🌅 Evening`;   dotColor='#F7A623'; dotGlow='rgba(247,166,35,.55)';  nameColor='#F7A623'; insightMsg='🌅 Wind down — you did great today'; }
  else                      { slotName=`${dayName} 🌙 Night`;     dotColor='#A89CFF'; dotGlow='rgba(168,156,255,.55)'; nameColor='#A89CFF'; insightMsg='😴 Screens off soon for better sleep'; }

  const dot = document.getElementById('mwGlowDot');
  if(dot){ dot.style.background=dotColor; dot.style.boxShadow=`0 0 5px 2px ${dotGlow}`; }
  const sn = document.getElementById('mwSlotName');
  if(sn){ sn.textContent=slotName; sn.style.color=nameColor; }

  // Insight bar — contextual message matching current time slot
  if(insight){ insight.style.color=nameColor; }

  // Learning badge — always ≥1 day
  const badge = document.getElementById('mwLearnBadge');
  if(badge){
    let days = 1;
    if(IS_NATIVE){ try{ days = Math.max(1, N.getWidgetLearningDays ? N.getWidgetLearningDays() : 1); }catch(_){} }
    badge.textContent = days>=21 ? `Based on ${days} days` : days>=7 ? `Learnt · ${days} days` : `Learning… ${days} day${days===1?'':'s'}`;
    badge.style.color = nameColor;
    badge.style.fontSize = '9px';
  }

  // Apps
  const wrap = document.getElementById('miniWidgetApps'); if(!wrap) return;
  const apps = _wApps.length>0 ? _wApps.slice(0,5)
    : ['📷','🎵','💬','▶️','🗺️'].map((e,i)=>({name:'App '+(i+1),iconUrl:null,_emoji:e}));
  wrap.innerHTML = apps.map(a=>`<div class="mw-app">
    <div class="mw-app-icon" style="background:${t.mini.searchBg}">
      ${a.iconUrl ? '<img src="' + a.iconUrl + '" onerror="this.parentElement.innerHTML=&#x27;📱&#x27;">' : (a._emoji || '📱')}
    </div>
    <div class="mw-app-lbl" style="color:${subColor}">${(a.name||'').split(' ')[0].substring(0,7)}</div>
  </div>`).join('')+`<div class="mw-app">
    <div class="mw-app-icon" style="background:${t.mini.searchBg};font-size:12px;color:${subColor}">···</div>
    <div class="mw-app-lbl" style="color:${subColor}">More</div>
  </div>`;
}

function updateWidgetBar(){
  if(!IS_NATIVE) return;
  try{
    const total   = N.getTotalScreenTimeToday ? N.getTotalScreenTimeToday() : 0;
    const pickups = N.getPickupCountToday ? N.getPickupCountToday() : 0;
    const streak  = N.getStreakDays ? N.getStreakDays() : 0;
    const sv  = document.getElementById('mwStValue');
    const sp  = document.getElementById('mwPickups');
    const ss  = document.getElementById('mwStreak');
    const sfp = document.getElementById('mwFirstPickup');
    if(sv)  sv.textContent  = fmtM(total);
    if(sp)  sp.textContent  = pickups > 0 ? pickups.toString() : '–';
    if(ss)  ss.textContent  = streak  > 0 ? streak+'🔥' : '–';
    if(sfp) sfp.textContent = (N.getFirstPickupTime ? N.getFirstPickupTime() : '–') || '–';

    // Phase 3 (#2): Gate insight bar data for free users — pass nothing so native
    // widget renders blurred/empty. Pro users get the full insight text pushed.
    const insightBar = document.getElementById('mwInsightBar');
    if(!ProTier.isPro){
      // Stop insight text from being written to the native widget
      if(typeof nCall === 'function'){
        try{ nCall('setWidgetInsightEnabled', false); }catch(_){}
      }
      if(insightBar){ insightBar.style.filter='blur(3px)'; insightBar.style.cursor='pointer'; insightBar.onclick=()=>ProTier.triggerUpsell('WIDGET_STATS_INSIGHT'); }
    } else {
      if(typeof nCall === 'function'){
        try{ nCall('setWidgetInsightEnabled', true); }catch(_){}
      }
      if(insightBar){ insightBar.style.filter=''; insightBar.style.cursor=''; insightBar.onclick=null; }
    }
  }catch(_){}
}

function selectWidgetTheme(key){
  // Phase 3: block Pro-only themes for free users
  const theme = WIDGET_THEMES.find(t => t.key === key);
  if(theme && theme.isPro && !ProTier.isPro){
    ProTier.triggerUpsell('WIDGET_AMOLED');
    return;
  }
  _wThemeKey = key;
  try{ N.setWidgetTheme(key); }catch(_){}
  renderWidgetThemeList();
  renderMiniWidget();
  // Collapse the list after selection
  const list = document.getElementById('widgetThemeList');
  const chev = document.getElementById('widgetThemeChevron');
  if(list){ list.style.display='none'; }
  if(chev){ chev.style.transform=''; }
}

function renderWidgetStorageStats(){
  if(!IS_NATIVE) return;
  try{
    const s = JSON.parse(N.getWidgetStorageStats()||'{}');
    const el = document.getElementById('widgetStorageSub');
    if(el) el.textContent = `${s.launchDbKb||0} KB · ${s.totalRows||0} launch events · Auto-cleared after ${s.maxAgeDays||60} days`;
  }catch(_){}
}

function clearWidgetHistory(){
  showConfirm('Clear widget history?','Smart Routine suggestions will restart from scratch. This cannot be undone.',()=>{
    try{ N.clearWidgetHistory(); }catch(e){ toast('Could not clear: '+e,'warn'); return; }
    _wApps=[];
    renderMiniWidget();
    // Re-read stats immediately — clear is now synchronous
    renderWidgetStorageStats();
    toast('Widget history cleared','info');
  });
}

function openRoutineDetail(){
  if(!IS_NATIVE){ toast('Smart Routine data available on device','info',2000); return; }

  // Phase 3 (#4): Smart Routine is Pro-only — open the modal but show a blurred
  // preview with a Pro lock overlay instead of redirecting to the paywall directly.
  // This lets the user see what they're missing before being asked to upgrade.
  if(!ProTier.isPro){
    const blurBody = `
      <div style="position:relative;border-radius:16px;overflow:hidden;cursor:pointer" onclick="ProTier.triggerUpsell('WIDGET_STATS_INSIGHT')">
        <div style="filter:blur(5px);pointer-events:none;padding:4px 0">
          <div style="display:flex;gap:2px;margin-bottom:14px;padding-bottom:2px">
            ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>`
              <div style="padding:5px 10px;border-radius:99px;font-size:11px;font-weight:${i===new Date().getDay()?700:400};
                background:${i===new Date().getDay()?'rgba(108,99,255,.25)':'transparent'};
                color:${i===new Date().getDay()?'#A89CFF':'var(--t3)'};">${d}</div>`).join('')}
          </div>
          <div style="margin-bottom:12px">
            <div style="font-size:11px;font-weight:700;color:#F7A623;margin-bottom:6px">☀️ Morning</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${['Instagram','YouTube','Spotify'].map(n=>`
                <div style="display:flex;align-items:center;gap:6px;background:var(--s2);border-radius:10px;padding:5px 9px">
                  <div style="width:20px;height:20px;border-radius:5px;background:var(--border)"></div>
                  <span style="font-size:11px;color:var(--t2)">${n}</span>
                </div>`).join('')}
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#5DD6F8;margin-bottom:6px">🌤 Midday</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${['WhatsApp','Gmail','Chrome'].map(n=>`
                <div style="display:flex;align-items:center;gap:6px;background:var(--s2);border-radius:10px;padding:5px 9px">
                  <div style="width:20px;height:20px;border-radius:5px;background:var(--border)"></div>
                  <span style="font-size:11px;color:var(--t2)">${n}</span>
                </div>`).join('')}
            </div>
          </div>
        </div>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,.2)">
          ${typeof proBadge==='function' ? proBadge() : ''}
          <div style="font-family:var(--ff-m);font-size:12px;color:var(--t1);font-weight:600">Unlock Smart Routine</div>
          <div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);text-align:center;max-width:220px;line-height:1.5">See which apps you actually use at each time of day, learned from your real habits.</div>
          <button onclick="event.stopPropagation();ProTier.triggerUpsell('WIDGET_STATS_INSIGHT')" style="margin-top:4px;padding:10px 24px;border-radius:12px;border:none;background:linear-gradient(135deg,var(--p),var(--c));color:#fff;font-family:var(--ff-m);font-size:12px;font-weight:700;cursor:pointer">Upgrade to Pro →</button>
        </div>
      </div>`;
    showModal('Smart Routine', blurBody);
    return;
  }

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayDow  = new Date().getDay(); // 0=Sun..6=Sat
  const toAndroid = d => d + 1;         // Calendar.DAY_OF_WEEK is 1=Sun..7=Sat

  const slotMeta = [
    {key:'MORNING',   label:'☀️ Morning',   time:'6–9am',    color:'#F7A623'},
    {key:'COMMUTE',   label:'🚌 Commute',   time:'9–11am',   color:'#5DD6F8'},
    {key:'MIDDAY',    label:'🌤 Midday',    time:'11am–2pm', color:'#12D48A'},
    {key:'AFTERNOON', label:'🌞 Afternoon', time:'2–5pm',    color:'#5DD6F8'},
    {key:'EVENING',   label:'🌅 Evening',   time:'5–9pm',    color:'#F7A623'},
    {key:'NIGHT',     label:'🌙 Night',     time:'9pm–6am',  color:'#A89CFF'},
  ];

  function buildContent(dow){
    let summary = {};
    try{ summary = JSON.parse(N.getRoutineSummaryForDay(toAndroid(dow))||'{}'); }catch(_){}
    const dayCount = (function(){
      try{ return N.getWidgetLearningDaysForDay ? N.getWidgetLearningDaysForDay(toAndroid(dow)) : 0; }
      catch(_){ return 0; }
    })();
    const isToday  = dow === todayDow;
    const dayLabel = isToday ? 'Today ('+DAY_NAMES[dow]+')' : DAY_NAMES[dow];
    const badgeTxt = dayCount >= 8
      ? 'Based on '+dayCount+' '+DAY_NAMES[dow]+'s'
      : dayCount > 0
        ? 'Learning… '+dayCount+' '+DAY_NAMES[dow]+(dayCount===1?'':'s')
        : 'No '+DAY_NAMES[dow]+' data yet';
    const hasAnyData = slotMeta.some(s => (summary[s.key]||[]).length > 0);

    let html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
      + '<div style="flex:1">'
      + '<div style="font-size:15px;font-weight:700">'+dayLabel+'\u2019s Routine</div>'
      + '<div style="font-size:11px;color:var(--t3);margin-top:2px">'+badgeTxt+'</div>'
      + '</div>'
      + '<div style="font-family:var(--ff-m);font-size:10px;padding:3px 9px;border-radius:99px;background:rgba(168,156,255,.15);color:#A89CFF">'+(dayCount>0?dayCount+'×':'–')+'</div>'
      + '</div>';

    if(!hasAnyData){
      html += '<div style="text-align:center;padding:20px 0;color:var(--t3);font-size:13px">'
        + '<div style="font-size:28px;margin-bottom:8px">🌱</div>'
        + '<div>No data for '+DAY_NAMES[dow]+'s yet.</div>'
        + '<div style="font-size:11px;margin-top:4px">Data builds up after a few '+DAY_NAMES[dow]+'s of use.</div>'
        + '</div>';
    } else {
      slotMeta.forEach(function(s){
        const apps = summary[s.key] || [];
        if(!apps.length) return;
        html += '<div style="margin-bottom:12px">'
          + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'
          + '<div style="font-size:11px;font-weight:700;color:'+s.color+'">'+s.label+'</div>'
          + '<div style="font-size:11px;color:var(--t3);font-family:var(--ff-m)">'+s.time+'</div>'
          + '</div><div style="display:flex;gap:8px;flex-wrap:wrap">';
        apps.forEach(function(a){
          html += '<div style="display:flex;align-items:center;gap:6px;background:var(--s2);border-radius:10px;padding:5px 9px">'
            + '<img src="'+a.iconUrl+'" style="width:20px;height:20px;border-radius:5px" onerror="this.style.display=\'none\'">'
            + '<span style="font-size:11px;color:var(--t2)">'+a.name+'</span>'
            + '</div>';
        });
        html += '</div></div>';
      });
    }
    return html;
  }

  let selectedDow = todayDow;

  function buildPills(){
    return DAY_SHORT.map(function(d,i){
      const active = i === selectedDow;
      return '<div onclick="window._routineDayPick('+i+')" style="'
        + 'padding:5px 10px;border-radius:99px;font-size:11px;'
        + 'font-weight:'+(active?700:400)+';cursor:pointer;white-space:nowrap;'
        + 'background:'+(active?'rgba(108,99,255,.25)':'transparent')+';'
        + 'color:'+(active?'#A89CFF':'var(--t3)')+';">'+d+'</div>';
    }).join('');
  }

  function render(){
    const body = '<div style="overflow-x:auto;display:flex;gap:2px;margin-bottom:16px;padding-bottom:2px;scrollbar-width:none">'
      + buildPills()
      + '</div><div id="_routineContent">'
      + buildContent(selectedDow)
      + '</div>';
    showModal('Smart Routine', body);
    window._routineDayPick = function(dow){
      selectedDow = dow;
      document.querySelectorAll('#_routineModal [onclick^="window._routineDayPick"]').forEach(function(el,i){
        const active = i === selectedDow;
        el.style.fontWeight  = active ? 700 : 400;
        el.style.background  = active ? 'rgba(108,99,255,.25)' : 'transparent';
        el.style.color       = active ? '#A89CFF' : 'var(--t3)';
      });
      const c = document.getElementById('_routineContent');
      if(c) c.innerHTML = buildContent(selectedDow);
    };
  }

  render();
}

// Generic modal helper (reuse existing if available, else create)
function showModal(title, bodyHtml){
  // Reuse the app's existing confirm/modal infrastructure if present
  let overlay = document.getElementById('_routineModal');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = '_routineModal';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9000;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)';
    overlay.onclick = e=>{ if(e.target===overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML=`<div style="background:var(--s1);border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:75vh;overflow-y:auto;padding:20px 18px 32px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:16px;font-weight:700">${title}</div>
      <button onclick="document.getElementById('_routineModal').remove()" style="background:rgba(255,255,255,.08);border:none;border-radius:99px;width:28px;height:28px;font-size:16px;color:var(--t2);cursor:pointer">×</button>
    </div>
    ${bodyHtml}
  </div>`;
  overlay.style.display='flex';
}

window.onWidgetNavigation = function(dest){
  if(dest==='search'){
    // Bring app to foreground on current tab, then focus the search bar
    const inp = document.getElementById('search-input');
    if(inp){
      inp.value = '';
      inp.focus();
      inp.dispatchEvent(new Event('input'));
      // Scroll search bar into view
      inp.scrollIntoView({behavior:'smooth', block:'center'});
    } else {
      // Fallback: switch to home tab where search bar lives
      activateTab('home');
      setTimeout(()=>{ const i=document.getElementById('search-input'); if(i){ i.value=''; i.focus(); } }, 350);
    }
  } else if(dest==='wellness'){
    activateTab('wellness');
  } else {
    activateTab('home');
  }
};
/* ══════════════════════════════════════════════════════ */

/* ── Phase 3: Widget insight bar Pro gate ────────────────────────────────────
 * The insight bar on the mini widget preview is blurred for free users.
 * Called by refreshAllProGates() in app-core.js on every Pro status change.  */
function renderWidgetInsightBar(isPro) {
  isPro = (isPro !== undefined) ? isPro : ProTier.isPro;
  const bar = document.getElementById('mwInsightBar');
  if (!bar) return;
  if (isPro) {
    bar.style.filter        = '';
    bar.style.pointerEvents = '';
    bar.onclick             = null;
    // Remove any lock badge injected earlier
    const badge = bar.querySelector('.widget-insight-lock');
    if (badge) badge.remove();
  } else {
    bar.style.filter        = 'blur(4px)';
    bar.style.pointerEvents = 'auto';
    bar.onclick             = () => ProTier.triggerUpsell('WIDGET_STATS_INSIGHT');
    // Inject badge only once
    if (!bar.querySelector('.widget-insight-lock')) {
      const badge = document.createElement('span');
      badge.className   = 'widget-insight-lock';
      badge.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:2';
      badge.innerHTML   = typeof proBadge === 'function' ? proBadge(true) : '';
      bar.style.position = 'relative';
      bar.appendChild(badge);
    }
  }
}

  /* ═══ PLAY STORE SYNC BANNER ══════════════════════════════════════════════ */

function _psbState(state) {
  document.getElementById('psb-prompt').style.display   = state === 'prompt'   ? '' : 'none';
  document.getElementById('psb-progress').style.display = state === 'progress' ? '' : 'none';
  document.getElementById('psb-done').style.display     = state === 'done'     ? 'flex' : 'none';
}

function maybeShowPlaySyncBanner() {
  if (!IS_NATIVE) return;
  // Only permanently hide after a successful sync — not just a dismiss
  if (S.playSyncSynced) return;
  document.getElementById('play-sync-banner').style.display = '';
  _psbState('prompt');
  // Phase 3 (#1): inject Pro badge into the Categorise Now button for free users
  // The button is static HTML so we patch its label here after showing the banner
  if (!ProTier.isPro) {
    const btn = document.getElementById('psb-sync-btn');
    if (btn && !btn.querySelector('.pro-sort-badge')) {
      const badge = document.createElement('span');
      badge.className = 'pro-sort-badge';
      badge.style.cssText = 'margin-left:6px;vertical-align:middle';
      badge.innerHTML = typeof proBadge === 'function' ? proBadge(true) : '';
      btn.appendChild(badge);
    }
  }
}

function dismissPlaySyncBanner() {
  document.getElementById('play-sync-banner').style.display = 'none';
}

function startPlaySyncFromSettings() {
  // Phase 3 (#5): Categorise Now / Play Sync is a Pro feature
  //if(!ProTier.isPro){ ProTier.triggerUpsell('categories'); return; }
  // Scroll home tab into view and show the banner in active state
  activateTab('home');
  const banner = document.getElementById('play-sync-banner');
  banner.style.display = '';
  _psbState('prompt');
  // Scroll banner into view
  setTimeout(() => banner.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
}

function startPlaySync() {
  // Phase 3 (#5): gate — free users see paywall
  if(!ProTier.isPro){ ProTier.triggerUpsell('PLAY_STORE_SYNC'); return; }
  if (!IS_NATIVE) return;
  _psbState('progress');

  // Progress callback: AppBridge calls window.onPlaySyncProgress(done, total)
  window.onPlaySyncProgress = function(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = document.getElementById('psb-bar');
    const txt = document.getElementById('psb-progress-txt');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = `${done} of ${total} apps checked…`;
  };

  window.onPlaySyncComplete = function(updatedCount) {
     S.playSyncSynced = true;
     saveS();
    _psbState('done');
    const txt = document.getElementById('psb-done-txt');
    if (txt) txt.textContent = updatedCount > 0
      ? `${updatedCount} app${updatedCount > 1 ? 's' : ''} updated`
      : 'All apps already categorised';
    // Auto-dismiss after 4s
    setTimeout(dismissPlaySyncBanner, 4000);
    // Refresh the category grid
    loadNativeData();
  };

  // Kick off the sync via AppBridge
  try {
    nCall('startPlaySync');
  } catch(e) {
    toast('Could not start sync — check your connection', 'error');
    _psbState('prompt');
  }
}

// Called by onAppsChanged when PLAY_SYNC_COMPLETE fires from background (if kept)
window.onAppsChanged = function(action, pkg) {
  if (action === 'PLAY_SYNC_COMPLETE') {
    loadNativeData();
    return;
  }
  // ... your existing onAppsChanged logic here ...
};