/* ═══ ONBOARDING ══════════════════════════════════════ */
/* ═══ ONBOARDING (4-step) ══════════════════════════════ */
let obStep = 0;
let _obGoal = ''; // kept for legacy compat
let _obGoals = []; // multiselect array

function obSelectGoal(goal, el){
  const idx = _obGoals.indexOf(goal);
  if(idx === -1){
    _obGoals.push(goal);
    el.classList.add('selected');
  } else {
    _obGoals.splice(idx, 1);
    el.classList.remove('selected');
  }
  _obGoal = _obGoals[0] || ''; // legacy compat
  S.userGoal  = _obGoal;
  S.userGoals = _obGoals.slice();
  saveS();
}

function obNext() {
  // New 4 steps: 0=welcome, 1=goal, 2=permission, 3=scan
  if (obStep >= 3) { finishOb(); return; }
  document.getElementById('ob' + obStep).classList.remove('active');
  obStep++;
  const next = document.getElementById('ob' + obStep);
  if (next) next.classList.add('active');
  // On reaching permission step, update badge
  if (obStep === 2) { _obUpdatePermBadge(); }
  // On reaching scan step, kick off scan
  if (obStep === 3) runObScan();
}

function _obHasPerm(){
  return IS_NATIVE && typeof N.hasUsagePermission==='function' && N.hasUsagePermission();
}

function _obUpdatePermBadge(){
  const badge = document.getElementById('ob-usage-badge');
  const btn   = document.getElementById('ob3-grant-btn');
  if(!badge || !btn) return;
  const granted = _obHasPerm();
  badge.textContent = granted ? 'Granted ✓' : 'Tap to grant';
  badge.style.background   = granted ? 'rgba(18,212,138,.15)' : 'rgba(240,78,122,.15)';
  badge.style.borderColor  = granted ? 'rgba(18,212,138,.3)'  : 'rgba(240,78,122,.3)';
  badge.style.color        = granted ? 'var(--g)' : 'var(--r)';
  // Also visually confirm the card border
  const card = document.getElementById('ob-perm-usage');
  if(card) card.style.borderColor = granted ? 'rgba(18,212,138,.3)' : 'rgba(108,99,255,.2)';
  btn.textContent = granted ? 'Continue →' : 'Grant Access →';
}

function obGrantUsage(){
  if(IS_NATIVE && typeof N.requestUsagePermission==='function') N.requestUsagePermission();
}

function obHandlePermStep(){
  if(_obHasPerm()){ obNext(); }
  else { obGrantUsage(); }
}

function checkPermAfterResume() {
  if (obStep !== 2) return;
  _obUpdatePermBadge();
  if(_obHasPerm()){ setTimeout(obNext, 700); }
}

// ── Scan step ─────────────────────────────────────────────────────────────────
let _obScanIv = null;

function runObScan() {
  const fill = document.getElementById('ob-scan-fill');
  const txt  = document.getElementById('ob-scan-txt');
  if (!fill) return;
  if (scanReadyForOnboarding) { _finishObScan(); return; }
  let pct = 0;
  if (_obScanIv) { clearInterval(_obScanIv); _obScanIv = null; }
  _obScanIv = setInterval(() => {
    const cap = scanReadyForOnboarding ? 100 : 85;
    pct += Math.random() * 7 + 2;
    if (pct >= cap) {
      pct = cap;
      if (scanReadyForOnboarding) { clearInterval(_obScanIv); _obScanIv = null; _finishObScan(); return; }
      txt.textContent = 'Analysing your apps…';
    } else {
      txt.textContent = 'Scanning apps…';
    }
    fill.style.width = pct + '%';
  }, 100);
}

function _finishObScan() {
  if (_obScanIv) { clearInterval(_obScanIv); _obScanIv = null; }
  const fill = document.getElementById('ob-scan-fill');
  const txt  = document.getElementById('ob-scan-txt');
  const rows = document.getElementById('ob-scan-rows');
  const btn  = document.getElementById('ob4-done-btn');
  if (!fill) return;

  fill.style.transition = 'width 0.35s ease';
  fill.style.width = '100%';

  const cats  = Object.keys(CATS_MAP);
  const total = Object.values(CATS_MAP).reduce((n, a) => n + a.length, 0);
  txt.textContent = 'Found ' + total + ' apps in ' + cats.length + ' categories ✓';

  rows.innerHTML = '';
  cats
    .map(c => [c, CATS_MAP[c].length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, n], i) => {
      const row = document.createElement('div');
      row.className = 'scan-row';
      row.style.animationDelay = (i * 0.08) + 's';
      row.innerHTML = '<div class="scan-tick">✓</div>'
        + '<div class="scan-name">' + name + '</div>'
        + '<div class="scan-n">' + n + ' app' + (n !== 1 ? 's' : '') + '</div>';
      rows.appendChild(row);
    });
  rows.style.display = 'flex';

  // ── First insight ──────────────────────────────────────────────────────────
  // Show a genuine stat if usage permission was granted, otherwise show app count
  setTimeout(() => {
    const insightWrap = document.getElementById('ob-first-insight');
    const insightText = document.getElementById('ob-insight-text');
    if(insightWrap && insightText){
      let insight = '';
      if(IS_NATIVE && N.hasUsagePermission && N.hasUsagePermission() && DAILY_USE.length){
        const top = DAILY_USE[0];
        insight = `Your most-used app today is <strong>${top.name}</strong> — ${fmtM(top.totalMinutes)}`;
      } else if(DAILY_USE.length){
        insight = `Your most-used app is <strong>${DAILY_USE[0].name}</strong>`;
      } else {
        insight = `Found <strong>${total} apps</strong> across <strong>${cats.length} categories</strong> — ready to explore`;
      }
      insightText.innerHTML = insight;
      insightWrap.style.display = 'block';
    }
    if(btn) btn.style.display = 'block';
  }, 900);
}

// ── Finish & battery ──────────────────────────────────────────────────────────
function obSaveName(){ /* legacy — name input removed, kept for safety */ }

function updatePermBadge(){ _obUpdatePermBadge(); }

function obGrantPerm(){ obGrantUsage(); }

function finishOb(){
  S.onboardingDone = true;
  saveS();
  if (IS_NATIVE) { try { N.setOnboardingDone(); } catch(_){} }
  _isFirstBoot = true; // tells loadNativeData this is a brand-new session — skip battery dialog
  hideOb();
  bootApp();

  // Fresh scan if usage was just granted during onboarding
  if(IS_NATIVE && N.hasUsagePermission && typeof N.hasUsagePermission==='function' && N.hasUsagePermission()){
    setTimeout(()=>{ nCall('triggerBackgroundScan'); }, 500);
  }
}

function quickStart(){ finishOb(); }
function hideOb(){
  const el=document.getElementById('ob-screen');
  el.style.transition='opacity .4s,transform .4s';
  el.style.opacity='0'; el.style.transform='scale(.96)';
  setTimeout(()=>el.style.display='none', 400);
}