'use strict';
/* ═══════════════════════════════════════════════════════════════════
 * DISCOVER TAB — v2
 * Sections:
 *   1. Based on Your Habits   — curated alternatives, opens Play Store
 *   2. Weekly Challenge       — local data, no backend
 *   3. Apps You Might Like    — curated collections, opens Play Store
 * ═══════════════════════════════════════════════════════════════════ */

// ── State
let _discLoaded     = false;
let _affiliateData  = null;
let _shownAppIds    = [];
const SHOWN_KEY     = 'disc_shown_v1';

// ═══ BOOT ═══════════════════════════════════════════════════════════
function loadDiscover() {
  if(_discLoaded) return;
  _discLoaded = true;
  _loadAffiliateData().then(() => _renderDiscover());
}

function refreshDiscover() {
  _discLoaded=false; _affiliateData=null;
  _loadAffiliateData().then(() => _renderDiscover());
}

function _loadAffiliateData() {
  if(_affiliateData) return Promise.resolve();
  try {
    const raw = IS_NATIVE && N.loadAssetFile
      ? N.loadAssetFile('www/affiliate_links.json')
      : null;
    if(raw) {
      _affiliateData = JSON.parse(raw);
      // load seen rotation...
      return Promise.resolve();
    }
  } catch(_) {}
  // fallback for browser preview
  return fetch('affiliate_links.json')
    .then(r => r.json())
    .then(data => { _affiliateData = data; })
    .catch(() => { _affiliateData = {apps:[],collections:[],replacements:{},noReplaceMessage:{}}; });
}

function _saveShown(id) {
  const cutoff=Date.now()-7*86400000;
  const next=[{id,ts:Date.now()},..._shownAppIds.filter(x=>x!==id).map(x=>({id:x,ts:Date.now()})).filter(e=>e.ts>cutoff)].slice(0,40);
  _shownAppIds=next.map(e=>e.id);
  try{const json=JSON.stringify(next);if(IS_NATIVE&&N.setStringPref)N.setStringPref(SHOWN_KEY,json);else localStorage.setItem(SHOWN_KEY,json);}catch(_){}
}

// ═══ MASTER RENDER ══════════════════════════════════════════════════
function _renderDiscover() {
  const feed=document.getElementById('disc-ad-feed');
  if(!feed) return;
  feed.innerHTML=_buildHabitsSection()+_buildCollectionsSection();
}

// ═══ SECTION 1 — BASED ON YOUR HABITS ═══════════════════════════════
function _buildHabitsSection() {
  const cc=_countryCode();
  let topCats=_getTopCategories();
  // No usage data yet — show a default curated set so tab isn't empty
  if(!topCats.length) topCats=['social','entertainment','gaming'];
  const cards=[];
  topCats.forEach(cat=>{
    const repIds=(_affiliateData.replacements||{})[cat];
    if(!repIds){
      const msg=(_affiliateData.noReplaceMessage||{})[cat];
      if(msg) cards.push(_buildNoReplaceCard(cat,msg));
      return;
    }
    const app=_pickApp(repIds,cc,cat);
    if(app){ cards.push(_buildHabitCard(app,cat,_getTopAppForCategory(cat))); _saveShown(app.id); }
  });
  if(!cards.length) return '';
  return `
    <div style="padding:18px 20px 6px;display:flex;align-items:baseline;justify-content:space-between">
      <div>
        <div style="font-family:var(--ff-d);font-size:16px;font-weight:700">Based on Your Habits</div>
        <div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px;letter-spacing:.5px">YOUR TOP APPS · BETTER ALTERNATIVES</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;padding:0 20px 4px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch">${cards.join('')}</div>`;
}

function _buildHabitCard(app,cat,topApp) {
  const timeStr=topApp?fmtM(topApp.totalMinutes):'';
  const bg=_hexToRgba(app.accentColor,0.08);
  const border=_hexToRgba(app.accentColor,0.25);
  const pkg=app.playStorePkg||app.pkg||'';
  return `<div onclick="if(IS_NATIVE)nCall('openPlayStore','${pkg}')" style="flex:0 0 140px;background:${bg};border:1px solid ${border};border-radius:18px;padding:14px 12px 12px;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent" ontouchstart="this.style.transform='scale(.96)'" ontouchend="this.style.transform=''">
    <div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-bottom:8px;display:flex;align-items:center;gap:4px">Replace <span style="background:rgba(240,90,122,.12);border:1px solid rgba(240,90,122,.2);color:var(--r);padding:1px 6px;border-radius:99px;font-size:10px">${timeStr?timeStr+' of '+_shortCat(cat):_shortCat(cat)}</span></div>
    <div style="width:44px;height:44px;border-radius:13px;background:var(--s2);display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:8px">${app.emoji}</div>
    <div style="font-size:13px;font-weight:700;margin-bottom:3px;color:var(--t1)">${app.name}</div>
    <div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);line-height:1.5;margin-bottom:10px">${app.tagline}</div>
    <button type="button" onclick="event.stopPropagation();if(IS_NATIVE)nCall('openPlayStore','${pkg}')" style="width:100%;padding:7px 0;border-radius:9px;border:none;background:rgba(124,111,255,.15);color:var(--p2);font-family:var(--ff-m);font-size:10px;font-weight:600;cursor:pointer">View →</button>
  </div>`;
}

function _buildNoReplaceCard(cat,msg) {
  return `<div style="flex:0 0 140px;background:var(--s1);border:1px dashed var(--border);border-radius:18px;padding:14px 12px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px">
    <div style="font-size:26px;opacity:.4">${CAT_ICONS[_normalizeCat(cat)]||'📱'}</div>
    <div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);line-height:1.55">${msg}</div>
  </div>`;
}

// ═══ SECTION 2 — WEEKLY CHALLENGE ═══════════════════════════════════
// All challenge logic has been moved to app-focus.js:
//   CHALLENGE_KEY, CHALLENGE_POOL, _weekNumber, _getLateNightMins, _pickChallenge,
//   _buildChallengeSection, _buildChallengeSkippedSection, _getNextMondayDateStr,
//   _buildChallengeContext, _getChallengeProgress, _saveChallengeProgress,
//   _initChallengeState, _autoCheckChallenge, _checkChallengeProgress, _skipChallenge
// app-focus.js must be loaded before app-discover.js.


// ═══ SECTION 3 — APPS YOU MIGHT LIKE ════════════════════════════════
function _buildCollectionsSection() {
  const cc=_countryCode();
  const colls=(_affiliateData.collections||[]).map(coll=>{
    const apps=(coll.appIds||[]).map(id=>(_affiliateData.apps||[]).find(a=>a.id===id)).filter(a=>a&&_appAvailable(a,cc));
    return{...coll,apps};
  }).filter(c=>c.apps.length>=2);
  if(!colls.length) return ''; // no collections available for this country
  const cards=colls.map(coll=>{
    const bg=_hexToRgba(coll.accentColor,0.12);
    const border=_hexToRgba(coll.accentColor,0.28);
    const icons=coll.apps.slice(0,4).map(a=>`<div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:14px">${a.emoji}</div>`).join('');
    return `<div onclick="_openCollection('${coll.id}')" style="flex:0 0 200px;border-radius:18px;padding:14px;cursor:pointer;overflow:hidden;background:linear-gradient(135deg,${bg},transparent);border:1px solid ${border};flex-shrink:0" ontouchstart="this.style.transform='scale(.97)'" ontouchend="this.style.transform=''">
      <span style="font-size:28px;margin-bottom:8px;display:block">${coll.emoji}</span>
      <div style="font-size:13px;font-weight:700;line-height:1.35;margin-bottom:3px;color:var(--t1)">${coll.title}</div>
      <div style="font-family:var(--ff-m);font-size:11px;color:rgba(255,255,255,.45);margin-bottom:10px">${coll.apps.length} apps</div>
      <div style="display:flex;gap:4px">${icons}</div>
    </div>`;
  }).join('');
  return `
    <div style="padding:18px 20px 10px;display:flex;align-items:baseline;justify-content:space-between">
      <div>
        <div style="font-family:var(--ff-d);font-size:16px;font-weight:700">Apps You Might Like</div>
        <div style="font-family:var(--ff-m);font-size:11px;color:var(--t3);margin-top:2px;letter-spacing:.5px">WELLNESS &amp; PRODUCTIVITY ONLY</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;padding:0 20px 4px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch">${cards}</div>`;
}

function _openCollection(collId) {
  const coll=(_affiliateData.collections||[]).find(c=>c.id===collId); if(!coll) return;
  const cc=_countryCode();
  const apps=(coll.appIds||[]).map(id=>(_affiliateData.apps||[]).find(a=>a.id===id)).filter(a=>a&&_appAvailable(a,cc));
  const rows=apps.map(a=>{const pkg=a.playStorePkg||a.pkg||'';return`<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)"><div style="width:44px;height:44px;border-radius:13px;background:var(--s2);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">${a.emoji}</div><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;margin-bottom:2px">${a.name}</div><div style="font-family:var(--ff-m);font-size:10px;color:var(--t2)">${a.tagline}</div></div><button type="button" onclick="if(IS_NATIVE)nCall('openPlayStore','${pkg}')" style="padding:8px 14px;border-radius:10px;border:none;background:var(--p);color:#fff;font-family:var(--ff-m);font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0">Get →</button></div>`}).join('');
  showConfirm(`${coll.emoji} ${coll.title}`,coll.description,null,'Close',null);
  setTimeout(()=>{
    const body=document.getElementById('cdlg-body');
    if(body) body.innerHTML=`<div style="font-size:12px;color:var(--t2);line-height:1.6;margin-bottom:12px">${coll.description}</div><div style="border-top:1px solid var(--border)">${rows}</div>`;
    const ok=document.getElementById('cdlg-ok');if(ok){ok.textContent='Close';ok.style.background='var(--s2)';ok.style.color='var(--t2)';}
    const cancel=document.querySelector('.confirm-btn.cancel');if(cancel)cancel.style.display='none';
  },50);
}

// ═══ HELPERS ══════════════════════════════════════════════════════════
function _countryCode(){if(IS_NATIVE&&typeof N.getCountryCode==='function')return N.getCountryCode().toUpperCase();return 'US';}
function _appAvailable(app,cc){if(!app.countries)return false;if(app.countries.includes('*'))return true;return app.countries.includes(cc);}
function _pickApp(appIds,cc){if(!_affiliateData||!appIds)return null;const candidates=appIds.map(id=>(_affiliateData.apps||[]).find(a=>a.id===id)).filter(a=>a&&_appAvailable(a,cc)&&!_shownAppIds.includes(a.id));const all=appIds.map(id=>(_affiliateData.apps||[]).find(a=>a.id===id)).filter(a=>a&&_appAvailable(a,cc));return(candidates.length?candidates:all)[0]||null;}
function _getTopCategories(){const ACTIONABLE=new Set(['social','entertainment','gaming','news','productivity','communication','finance','fitness','education','music','shopping','photography','travel','utilities']);const pkgToCat={};Object.entries(CATS_MAP).forEach(([cat,apps])=>apps.forEach(a=>{pkgToCat[a.packageName]=cat;}));const seen=new Set();const cats=[];[...DAILY_USE].forEach(a=>{const cat=pkgToCat[a.packageName]||'';if(!cat||seen.has(cat))return;seen.add(cat);const key=_catToKey(cat);if(ACTIONABLE.has(key))cats.push(key);});return cats.slice(0,4);}
function _catToKey(cat){const m={'Social':'social','Entertainment':'entertainment','Gaming':'gaming','Music & Audio':'music','News':'news','Productivity':'productivity','Communication':'communication','Finance':'finance','Shopping':'shopping','Health & Fitness':'fitness','Education':'education','Photography':'photography','Travel & Maps':'travel','Food & Drink':'food','Utilities':'utilities','Other':'other'};return m[cat]||cat.toLowerCase().replace(/[^a-z]/g,'');}
function _normalizeCat(k){const m={social:'Social',entertainment:'Entertainment',gaming:'Gaming',music:'Music & Audio',news:'News',productivity:'Productivity',communication:'Communication',finance:'Finance',shopping:'Shopping',fitness:'Health & Fitness',education:'Education',photography:'Photography',travel:'Travel & Maps',food:'Food & Drink',utilities:'Utilities'};return m[k]||k;}
function _shortCat(cat){const m={social:'Social',entertainment:'Video',gaming:'Gaming',news:'News',productivity:'Work',communication:'Chat',music:'Music',finance:'Finance',fitness:'Fitness',education:'Learning'};return m[cat]||(cat.charAt(0).toUpperCase()+cat.slice(1));}
function _getTopAppForCategory(catKey){const pkgToCat={};Object.entries(CATS_MAP).forEach(([cat,apps])=>apps.forEach(a=>{pkgToCat[a.packageName]=_catToKey(cat);}));return DAILY_USE.find(a=>pkgToCat[a.packageName]===catKey)||null;}
// _weekNumber() moved to app-focus.js
function _hexToRgba(hex,alpha){if(!hex||hex==='#000000'||hex.length<7)return`rgba(100,100,100,${alpha})`;const r=parseInt(hex.slice(1,3),16);const g=parseInt(hex.slice(3,5),16);const b=parseInt(hex.slice(5,7),16);return`rgba(${r},${g},${b},${alpha})`;}