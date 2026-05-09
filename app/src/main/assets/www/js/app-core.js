'use strict';

/* ═══ SECURITY UTILITIES ══════════════════════════════
 * SEC-07 FIX: Global HTML-escaping helpers.
 * ALL app names, package names, and user-typed strings sourced from native
 * APIs (PackageManager, SharedPreferences) must be escaped before insertion
 * into innerHTML template literals to prevent XSS injection.
 *
 * Usage:
 *   innerHTML = `<div>${escHtml(a.name)}</div>`         // element text
 *   innerHTML = `<div data-pkg="${escAttr(a.pkg)}">`    // HTML attributes
 * ════════════════════════════════════════════════════ */
function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
function escAttr(str) {
  // For use inside HTML attribute values (double-quoted). Escapes the same
  // set as escHtml so attribute injection via crafted strings is blocked.
  return escHtml(str);
}

/* ═══ APP CONFIG ═════════════════════════════════════ */
// ── Update version here to change it everywhere in the app ──
const APP_CONFIG = {
  version:  'v1.2.0',
  name:     'Aurelo',
  buildDate: '2026-04-20',
};

/* ═══ PRO TIER — BILLING-BACKED GATE SYSTEM ═════════
 *
 * ProTier (pro-gate.js) is the single source of truth for Pro status.
 * It reads from AppBridge.getProStatus() which is backed by Google Play
 * Billing — not localStorage.
 *
 * ProGate has been removed. All call sites should use:
 *   ProTier.isPro                          → boolean status
 *   ProTier.canAccess('FEATURE_KEY')       → true/false
 *   ProTier.getLimit('FEATURE_KEY')        → number or Infinity
 *   ProTier.triggerUpsell('FEATURE_KEY')   → opens upsell sheet
 *   ProTier.applyBlur/Lock/Ceiling/Teaser  → gate renderers
 *
 * Feature key → ProTier FEATURES registry mapping (for call-site migration):
 *   focus_apps / mindful_apps  → FOCUS_APPS_UNLIMITED / MINDFUL_OPENING_UNLIMITED  (limit: 3)
 *   locked                     → LOCKED_APPS_UNLIMITED       (limit: 3)
 *   hidden                     → HIDDEN_APPS_UNLIMITED        (limit: 3)
 *   categories                 → UNLIMITED_CATEGORIES
 *   monthly                    → MONTHLY_CALENDAR / MONTHLY_APP_DNA / MONTHLY_STREAK_GRID
 *   weekly_challenge            → WEEKLY_CHALLENGE
 *   bedtime                    → BEDTIME_MODE
 *   themes                     → THEME_AMOLED_PLUS
 *   focus_history              → FOCUS_HISTORY
 *   focus_schedule             → FOCUS_SCHEDULE
 *   widget_theme               → WIDGET_AMOLED
 *   insight                    → HOME_INSIGHT
 * ════════════════════════════════════════════════════ */

/**
 * proBadge — inline Pro badge HTML. Use the .pg-pro-badge CSS class
 * (injected by pro-upsell.js) rather than inline styles where possible.
 * Kept for backward-compat with any call sites in tab JS files.
 */
function proBadge(small = false) {
  const sz = small ? 'font-size:var(--text-2xs);padding:1px 6px' : 'font-size:var(--text-2xs);padding:2px 8px';
  return `<span class="pg-pro-badge" style="${sz}">✦ PRO</span>`;
}

/**
 * proTap — legacy upsell trigger. Delegates to ProTier.triggerUpsell()
 * using a stable key-mapping so existing call sites keep working without
 * a bulk find-replace. New code should call ProTier.triggerUpsell() directly.
 */
function proTap(featureKey) {
  // Map legacy app-core keys → ProTier FEATURES registry keys
  const KEY_MAP = {
    focus_apps:       'FOCUS_APPS_UNLIMITED',
    mindful_apps:     'MINDFUL_OPENING_UNLIMITED',
    widget_theme:     'WIDGET_AMOLED',
    insight:          'HOME_INSIGHT',
    timers:           'TIMER_APPS_UNLIMITED',
    locked:           'LOCKED_APPS_UNLIMITED',
    hidden:           'HIDDEN_APPS_UNLIMITED',
    categories:       'UNLIMITED_CATEGORIES',
    monthly:          'MONTHLY_CALENDAR',
    weekly_challenge: 'WEEKLY_CHALLENGE',
    bedtime:          'BEDTIME_MODE',
    themes:           'THEME_AMOLED_PLUS',
    focus_history:    'FOCUS_HISTORY',
    focus_schedule:   'FOCUS_SCHEDULE',
    coach_upgrade:    'AURELO_COACH',
    health_connect:   'HEALTH_CONNECT',
    tidy_score_pillars:'GENERIC',
  };
  const mappedKey = KEY_MAP[featureKey] || featureKey;
  if (window.ProTier) {
    ProTier.triggerUpsell(mappedKey);
  } else {
    console.warn('[proTap] ProTier not ready — ensure pro-gate.js loads before app-core.js');
  }
}

/**
 * refreshAllProGates — re-renders every Pro-aware UI element.
 * Delegates to ProTier for the gate layer; handles app-specific
 * re-renders (insight card, widget picker, etc.) that live in tab files.
 * Called on app startup and whenever Pro status changes.
 */
function refreshAllProGates() {
  const isPro = window.ProTier ? ProTier.isPro : false;
  // Re-render gated sections defined in their respective tab JS files.
  // renderInsightBanner must be here: boot renders it before ProTier.init()
  // so it always renders as free-tier first. This call corrects it once
  // Pro status is known.
  if (typeof renderInsightBanner      === 'function') renderInsightBanner();
  if (typeof renderContextualInsight  === 'function') renderContextualInsight();
  if (typeof renderWidgetThemePicker  === 'function') renderWidgetThemePicker();
  if (typeof renderWidgetInsightBar   === 'function') renderWidgetInsightBar(isPro);
}

/* ════════════════════════════════════════════════════ */

// NFU-07 FIX: Global error boundary — catches real JS errors with source info.
// "Script error." is an opaque browser signal for cross-origin or evaluateJavascript()
// errors — it has no source/line/col and is not actionable, so we log it silently only.
window.error = function(msg, src, line, col, err){
  if(msg === 'Script error.' || (!src && !line)) {
    // Opaque cross-origin or eval error — log only, no user toast
    console.log('[Aurelo] Opaque script error (cross-origin/eval)', err ? err.toString() : '(no detail)');
    return true;
  }
  console.error('[Aurelo Error]', msg, src+':'+line+':'+col, err||'');
  try { if(typeof toast === 'function') toast('Something went wrong — tap to reload','error'); } catch(_){}
  return true;
};
window.addEventListener('unhandledrejection', function(e){
  console.error('[Aurelo Promise]', e.reason);
});

/* ═══ BRIDGE ════════════════════════════════════════ */
const N = window.AppBridge || null;
const IS_NATIVE = !!N;

// FIX: Don't hardcode package name — debug builds use "com.javikastudio.tidyapp.debug"
// Read the actual runtime package name from the bridge.
const SELF_PKG = (IS_NATIVE && typeof N.getPackageName === 'function')
    ? N.getPackageName()
    : 'com.javikastudio.tidyapp';

/* ═══ STATE ═════════════════════════════════════════ */
const SK = 'tidy_state_v4';
let S = defaultState();
function defaultState(){ return { onboardingDone:false, restoreWelcomeShown: false, theme:'dark', catView:'grid', settings:{notif:true,bedtime:false,bedtimeHour:22}, catOrder:[], lockedPkgs:[], hiddenPkgs:[], limits:{}, streakGoalMins:240, userName:'', userGoal:'', widgetNudgeDone:false, firstRunCardDone:false }; }
function loadS(){
  let base = defaultState();
  try { base = {...base, ...JSON.parse(localStorage.getItem(SK)||'{}')}; } catch(_){}
  // onboardingDone is authoritative from AppBridge SharedPreferences (survives cache clears)
  if (IS_NATIVE) {
    try { base.onboardingDone = N.isOnboardingDone(); } catch(_){}
  }
  return base;
}
function saveS(){
  try { localStorage.setItem(SK, JSON.stringify(S)); } catch(_){}
}
S = loadS();

/* ═══ LIVE DATA ══════════════════════════════════════ */
let CATS_MAP   = {};  // { catName: [app,...] }
let DAILY_USE  = [];  // sorted by totalMinutes desc
let WEEKLY     = [];  // 7 days
let GHOSTS     = [];
let TODAY_MINS = 0;
let _isFirstBoot = false; // set true by finishOb so battery dialog skips first session
let PICKUPS    = 0;

const CAT_ICONS = {'Social':'👥','Entertainment':'🎬','Productivity':'⚡','Health & Fitness':'❤️','Gaming':'🎮','Shopping':'🛒','Finance':'💰','Education':'📚','Travel & Maps':'🗺️','Photography':'📷','Utilities':'🔧','Other':'📱','Music & Audio':'🎵','News':'📰','Food & Drink':'🍔','Communication':'💬'};
const CAT_COLOR = {'Social':'E1306C','Entertainment':'FF6B35','Productivity':'4285F4','Health & Fitness':'FC4C02','Gaming':'9B59B6','Shopping':'27AE60','Finance':'2ECC71','Education':'FF9900','Travel & Maps':'3498DB','Photography':'E91E63','Utilities':'607D8B','Other':'6C63FF','Music & Audio':'9C27B0','News':'00BCD4','Food & Drink':'FF5722','Communication':'26A69A'};

const ICON_SET = ['👥','🎬','⚡','❤️','📚','🎮','💰','🎨','📷','🗺️','🔧','📱','🛒','💼','🧘','🐦','📧','🎵','🌐','📰','🍔','💬','🏠','✈️','🎓','💻','🌍','🎯'];

const DEMO_EMOJI = {'com.instagram.android':'📸','com.google.android.youtube':'▶️','com.whatsapp':'💬','com.spotify.music':'🎵','com.android.chrome':'🌐','com.google.android.gm':'📧','com.zhiliaoapp.musically':'🎵','com.netflix.mediaclient':'📺','com.twitter.android':'🐦','notion.id':'📝','com.getsomeheadspace.android':'🧘','com.duolingo':'🎓','com.ubercab':'🚗','com.Slack':'💬','com.facebook.katana':'👤','com.snapchat.android':'👻','com.linkedin.android':'💼','com.tiktok':'🎵'};

// ── Icon grid (used in DOMContentLoaded init, must be defined before DOMContentLoaded fires)
let _catAppOrderCache = null;   // ← move from app-categories.js line 221

/* ═══ CLOCK ══════════════════════════════════════════ */


/* ═══ GREETING ═══════════════════════════════════════ */
function updateGreeting(){
  const h=new Date().getHours(), now=new Date();
  // These elements are removed from home header but may exist in other screens
  const greetEl = document.getElementById('greeting');
  const dateSub  = document.getElementById('date-sub');
  if(greetEl){
    const greet=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
    const name=(S.userName||'').trim();
    greetEl.textContent = name ? `${greet}, ${name} 👋` : `${greet} 👋`;
  }
  if(dateSub){
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    dateSub.textContent=`${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
  }
}

/* ═══ TEMPLATE LOADER (Phase 5) ══════════════════════════════════════════
 * Fetches HTML template partials and injects them before bootApp() runs.
 * Uses loadAssetFile() on native (reads from assets/) or fetch() in browser.
 * All JS init functions that query DOM run only after all templates resolve.
 * ════════════════════════════════════════════════════════════════════════ */
const TemplateLoader = (function () {
  // Maps template name → injection target ID + insert mode
  const TEMPLATES = [
    { file: 'templates/home.html',        target: 'screens-root',    method: 'append' },
    { file: 'templates/wellness.html',    target: 'screens-root',    method: 'append' },
    { file: 'templates/focus.html',       target: 'screens-root',    method: 'append' },
    { file: 'templates/discover.html',    target: 'screens-root',    method: 'append' },
    { file: 'templates/settings.html',    target: 'screens-root',    method: 'append' },
    { file: 'templates/panels.html',      target: 'panels-root',     method: 'append' },
    { file: 'templates/modals.html',      target: 'modals-root',     method: 'append' },
    { file: 'templates/onboarding.html',  target: 'onboarding-root', method: 'append' },
  ];

  function _loadOne(tpl) {
    return new Promise(function (resolve, reject) {
      if (typeof N !== 'undefined' && N && typeof N.loadAssetFile === 'function') {
        // Native path: read from Android assets/ folder
        try {
          const html = N.loadAssetFile('www/' + tpl.file);
          _inject(tpl, html);
          resolve();
        } catch (e) { reject(e); }
      } else {
        // Browser/demo path: use fetch
        fetch(tpl.file)
          .then(function (r) { return r.text(); })
          .then(function (html) { _inject(tpl, html); resolve(); })
          .catch(reject);
      }
    });
  }

  function _inject(tpl, html) {
    const target = document.getElementById(tpl.target);
    if (!target) { console.warn('[TemplateLoader] target not found:', tpl.target); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) { target.appendChild(tmp.firstChild); }
  }

  return {
    /**
     * Load all templates in parallel, resolve when every one is injected.
     * Safe to call multiple times — after first load the DOM already has the
     * elements so nothing breaks, but prefer calling once.
     */
    loadAll: function () {
      return Promise.all(TEMPLATES.map(_loadOne));
    }
  };
})();

/* ═══ INIT ═══════════════════════════════════════════ */
let scanReadyForOnboarding = false;

document.addEventListener('DOMContentLoaded', () => {
  // Phase 5: inject all HTML templates before any DOM-dependent init runs
  TemplateLoader.loadAll().then(function () {
    // Set version badge from APP_CONFIG so it never needs manual HTML edits
    const vBadge = document.getElementById('app-version-badge');
    const vBadge2 = document.getElementById('app-version-badge2');
    let liveVer = APP_CONFIG.version;
    if(IS_NATIVE){ try{ liveVer = N.getAppVersion() || liveVer; }catch(_){} }
    if(vBadge)  vBadge.textContent  = liveVer;
    if(vBadge2) vBadge2.textContent = liveVer;
    var _bt=IS_NATIVE&&N.getStringPref?N.getStringPref('app_theme')||S.theme||'dark':S.theme||'dark';
    S.theme=_bt;
    // Wrap post-template init in try/catch so a non-fatal throw (e.g. a missing
    // DOM element in buildIconGrid or applyTheme) does not reject the Promise and
    // incorrectly surface as a TemplateLoader failure in the .catch() block.
    try { applyTheme(_bt); } catch(e) { console.warn('[TemplateLoader] applyTheme error:', e); }
    try { buildIconGrid(); } catch(e) { console.warn('[TemplateLoader] buildIconGrid error:', e); }
    // Register coach FAB drag handlers as soon as the template DOM is available.
    if (typeof CoachUI !== 'undefined') {
      try { CoachUI._initFabDrag(); } catch(e) { console.warn('[TemplateLoader] CoachUI._initFabDrag error:', e); }
    }
    try {
      if (!IS_NATIVE) {
        if (S.onboardingDone) { loadDemoData(); showApp(); }
        else { document.getElementById('ob-screen').style.display='flex'; }
      } else if (S.onboardingDone) {
        bootApp();
      } else {
        document.getElementById('ob-screen').style.display='flex';
      }
    } catch(e) { console.warn('[TemplateLoader] boot error:', e); bootApp(); }
  }).catch(function (err) {
    // Only reaches here if template LOADING itself fails (fetch/asset error), not post-init throws.
    console.error('[TemplateLoader] Failed to load templates, booting anyway:', err);
    bootApp();
  });
});

// onPageReady / onScanComplete: mark scan data available and feed the onboarding scan screen
window.onPageReady = function(alreadyDone) {
  // 1. ProTier.init() reads billing status from AppBridge and registers its own
  //    window.onProStatusChanged handler. Must happen first.
  ProTier.init();

  // 2. Capture Pro status synchronously right after init — before any async
  //    billing callback fires. Used below to distinguish a cached-Pro session
  //    (already Pro at init = not a restore event) from a silent restore
  //    (Pro becomes true via async callback after init returned false).
  const _proAtInit = ProTier.isPro;

  // Only show the restore welcome once per app session, even if
  // onProStatusChanged fires multiple times.
  let _restoreWelcomeShown = false;

  // 3. Extend onProStatusChanged NOW — ProTier.init() has just registered it so
  //    window.onProStatusChanged is guaranteed to exist at this point.
  //    Doing this at parse time (IIFE) was too early — the handler was undefined.
  const _proTierHandler = window.onProStatusChanged;
  window.onProStatusChanged = function(isPro) {
      if (typeof _proTierHandler === 'function') _proTierHandler(isPro);
      _updateProUI();
      refreshAllProGates();
      if (isPro && typeof clearDiscoverAds === 'function') clearDiscoverAds();
      // Re-render all Pro-gated DOM content. Without this, blur/lock/ceiling/teaser
      // overlays stamped during the initial renderAll() (when isPro was false) are
      // never removed — the user sees free-tier UI until the next cold start.
      if (typeof renderAll === 'function' && S && S.onboardingDone) renderAll();

      // Notify focus-tab modules (FocusBedtime, FocusChallenge) so they unlock
      // immediately after purchase without requiring a manual tab switch.
      // The listener in app-focus.js depends on this dispatch — the event was
      // registered there but never fired, which was the root cause of Bedtime Mode
      // and Weekly Challenge not unlocking until the user left and re-entered the tab.
      window.dispatchEvent(new CustomEvent('aurelo-pro-changed', { detail: { isPro: isPro } }));

      // ── Referral extension activation callback ─────────────────────────────
      // Fired by BillingBridge when a subscription lapses but referral extension
      // days were banked — keeps the user Pro without any Play transaction.
      window.onReferralExtensionActivated = function(days) {
        // Re-read Pro status — BillingBridge has already set IS_PRO_USER = true
        ProTier.init();
        _updateProUI();
        if (typeof toast === 'function') {
          toast('🎁 Your referral reward is keeping Pro alive — ' + days + ' day' + (days !== 1 ? 's' : '') + ' extension activated!', 'success');
        }
        if (typeof Referral !== 'undefined') Referral.open();
      };

      // ── Silent restore detection ───────────────────────────────────────────
      // Fires when Play Billing automatically restores a subscription on
      // reinstall or a new device — no user action required. In this path,
      // only onProStatusChanged fires; PurchaseRestoreHandler is never called.
      //
      // Conditions to show the welcome snackbar:
      //   1. Pro just became true via this async callback (not already true at init)
      //   2. Upsell sheet is NOT open (fresh purchases are handled by onPurchaseSuccess)
      //   3. Haven't shown it yet this session
      const isNewRestore = isPro && (!_proAtInit || !S.onboardingDone);
      if (isNewRestore && !_restoreWelcomeShown) {
              const sheetOpen = document.getElementById('pu-backdrop') &&
                               document.getElementById('pu-backdrop').classList.contains('pu-visible');
              if (!sheetOpen) {
                  _restoreWelcomeShown = true;
                  if (typeof ProUpsell !== 'undefined') {
                      // This will set a internal "pending" flag if S.onboardingDone is false
                      ProUpsell.triggerRestoreWelcome();
                  }
              }
          }else {
                   // Reset the flag if they are no longer Pro (e.g., subscription expired)
                   // This allows the welcome to show again if they resubscribe later.
                   if (_restoreWelcomeShown) {
                       _restoreWelcomeShown = false;
                       saveS();
                   }
               }
  };

  // If native billing fired onProStatusChanged before this handler was registered,
  // the value was stashed in __pendingProStatus. Consume it now and re-sync if it
  // disagrees with what ProTier.init() just read from entitlementRepo.
  if (typeof window.__pendingProStatus !== 'undefined') {
      var _pending = window.__pendingProStatus;
      delete window.__pendingProStatus;
      if (_pending !== ProTier.isPro) window.onProStatusChanged(_pending);
  };

  _updateProUI();
  // If AppBridge.getProStatus() already returned true synchronously inside
  // ProTier.init(), ProTier.isPro is already correct right now — but the async
  // onProStatusChanged callback may never fire (billing cache hit). Call
  // refreshAllProGates() here so Pro-gated UI (including the insight banner)
  // is corrected immediately without waiting for an async callback that may
  // not come.
  refreshAllProGates();
  if (alreadyDone) {
    scanReadyForOnboarding = true;
    if (IS_NATIVE) { try { buildCatsMap(JSON.parse(N.getCachedApps() || '[]')); } catch(e) {} }
    if (obStep === 3) _finishObScan();
  }
  // FIX: Set self-app icon src now that bridge is ready and package name is known
    const selfIconSrc = 'app-icon://' + SELF_PKG;
    const si1 = document.getElementById('settings-app-icon');
    const si2 = document.getElementById('widget-preview-app-icon');
    const si3 = document.getElementById('app-top-logo');
    const si4 = document.getElementById('nav-home-icon');
    if (si1) { si1.style.display=''; si1.style.visibility=''; si1.src = selfIconSrc; }
    if (si2) { si2.style.display=''; si2.style.visibility=''; si2.src = selfIconSrc; }
    if (si3) { si3.style.display=''; si3.style.visibility=''; si3.src = selfIconSrc; }
    if (si4) { si4.style.display=''; si4.style.visibility=''; si4.src = selfIconSrc; }
    // Sync icon to cloned logo images in Stats, Discover, Settings tabs
    document.querySelectorAll('.app-logo-clone').forEach(el => {
      el.src = selfIconSrc; el.style.display = '';
    });
    // Pre-warm the share icon cache as early as possible
    _shareResolveIcon().catch(() => {});
};
window.onScanComplete = function() {
  scanReadyForOnboarding = true;
  // Always build CATS_MAP regardless of which screen is showing
  if (IS_NATIVE) { try { buildCatsMap(JSON.parse(N.getCachedApps() || '[]')); } catch(e) {} }
  if (obStep === 3) { _finishObScan(); return; }
  if (document.getElementById('app').style.display !== 'none') {
    try { scheduleGridRefresh(); } catch(e) {}
  }
};

// _updateProUI — app-core-specific Pro UI touches that complement ProTier's own
// header/settings logic (ProTier handles pill via _updateHeader; we handle the
// header gradient tint and settings row visibility as a belt-and-suspenders pass).
function _updateProUI() {
    const isPro = ProTier.isPro;
    // Header pill
    const pill = document.getElementById('pro-pill');
    const settingsPill = document.getElementById('settings-pro-pill');
    if (settingsPill) settingsPill.style.display = isPro ? 'inline-flex' : 'none';
    if (pill) pill.style.display = isPro ? 'inline-flex' : 'none';
    document.querySelectorAll('.pro-pill-clone').forEach(function(el) {
            el.style.display = isPro ? 'inline-flex' : 'none';
        });
    // Settings rows
    const upgradeRow   = document.getElementById('upgrade-row');
    const proStatusRow = document.getElementById('pro-status-row');
    if (upgradeRow)   upgradeRow.style.display   = isPro ? 'none' : 'flex';
    if (proStatusRow) proStatusRow.style.display = isPro ? 'flex' : 'none';
    // Pro header tint
    // A11Y: Never set a hardcoded dark gradient — it breaks light/warm/aurelo-gold themes.
    // Instead toggle a CSS class that themes.css overrides per-theme.
    document.querySelectorAll('.app-top-bar').forEach(function(bar) {
        if (isPro) bar.classList.add('app-top-bar--pro');
        else        bar.classList.remove('app-top-bar--pro');
    });
}

function bootApp() {
  document.getElementById('loading-screen').classList.remove('hidden');
  if (!IS_NATIVE) { loadDemoData(); return; }
  loadNativeData();
}

function loadNativeData() {
  _allAppsCache    = null;
  _catAppOrderCache = null;
  _weekRendered    = false;  // force week/month to re-render with fresh data
  _monthRendered   = false;
  try {
    buildCatsMap(JSON.parse(N.getCachedApps() || '[]'));
    // Load cached values first so UI paints instantly with last-known data
    DAILY_USE    = JSON.parse(N.getCachedDailyUsage() || '[]');
    WEEKLY       = JSON.parse(N.getCachedWeeklyData() || '[]');
    // Don't trust cached_total_mins on first paint — the widget's background scan can
    // write an inflated value to SharedPrefs (INTERVAL_BEST bug, now fixed, but old
    // installs may still have a stale write). Start with PICKUPS from cache (it's always
    // accurate) but leave TODAY_MINS = 0 so the UI shows '–' until the live scan lands
    // in < 1 second rather than showing a wrong number for 300ms.
    TODAY_MINS   = 0;
    PICKUPS      = (IS_NATIVE && N.getCachedPickupCount ? N.getCachedPickupCount() : 0);
    GHOSTS       = JSON.parse(N.getCachedGhosts() || '[]');
    S.limits     = JSON.parse(N.getLimits() || '{}');
    S.lockedPkgs = JSON.parse(N.getLockedApps() || '[]');
    S.hiddenPkgs = JSON.parse(N.getHiddenApps() || '[]');
    nCall('saveStreakGoalMins', S.streakGoalMins || 240);
  } catch(e) { console.error('loadNativeData:', e); }
  hideLoading();
  showApp();
  // Sync focus session state before first render so home strip is correct on launch
  if (typeof window._syncFocusStateOnBoot === 'function') window._syncFocusStateOnBoot();
  renderAll();
  // Paint the UI first with cached data (instant), then refresh live in background.
  // We use 0ms to yield to the renderer, then 300ms for the scan itself.
  // This eliminates the "stale flash then jump" — cached numbers appear instantly
  // and quietly update once the live scan finishes.
  _lastRefreshTs = 0;
  _refreshTimer = setTimeout(refreshUsage, 50);  // yield one frame then scan immediately
  // Recurring refresh every 30 seconds (bgExecutor supplements this at 10s)
  setInterval(refreshUsage, 30_000);
  if(IS_NATIVE && N.hasUsagePermission()) try{ nCall('scheduleBackgroundNotifications'); }catch(_){}
  if(IS_NATIVE) try{ N.saveSmartAlertsEnabled(S.settings.notif !== false); }catch(_){}
  // Day-2 widget nudge — fires once when user has real data and hasn't been nudged yet
  if(S.onboardingDone) setTimeout(_maybeShowWidgetNudge, 4000);
  _isFirstBoot = false; // reset so subsequent sessions (app kills/reopens) see it

  // Consume any restore welcome that was deferred because billing responded
  // before the loading screen had been dismissed. By this point home is painted
  // and visible, so the snackbar will appear correctly.
  setTimeout(function() {
    if (typeof ProUpsell !== 'undefined') ProUpsell.consumePendingWelcome();
  }, 500);
}

function loadDemoData(){
  buildCatsMap([
    {name:'Instagram',packageName:'com.instagram.android',category:'Social'},
    {name:'YouTube',packageName:'com.google.android.youtube',category:'Entertainment'},
    {name:'WhatsApp',packageName:'com.whatsapp',category:'Social'},
    {name:'Spotify',packageName:'com.spotify.music',category:'Music & Audio'},
    {name:'Chrome',packageName:'com.android.chrome',category:'Utilities'},
    {name:'Gmail',packageName:'com.google.android.gm',category:'Productivity'},
    {name:'TikTok',packageName:'com.zhiliaoapp.musically',category:'Entertainment'},
    {name:'Netflix',packageName:'com.netflix.mediaclient',category:'Entertainment'},
    {name:'Twitter',packageName:'com.twitter.android',category:'Social'},
    {name:'Notion',packageName:'notion.id',category:'Productivity'},
    {name:'Headspace',packageName:'com.getsomeheadspace.android',category:'Health & Fitness'},
    {name:'Duolingo',packageName:'com.duolingo',category:'Education'},
    {name:'Uber',packageName:'com.ubercab',category:'Travel & Maps'},
    {name:'Slack',packageName:'com.Slack',category:'Productivity'}
  ]);
  DAILY_USE=[{name:'Instagram',packageName:'com.instagram.android',totalMinutes:140},{name:'YouTube',packageName:'com.google.android.youtube',totalMinutes:94},{name:'Twitter',packageName:'com.twitter.android',totalMinutes:52},{name:'Chrome',packageName:'com.android.chrome',totalMinutes:28},{name:'TikTok',packageName:'com.zhiliaoapp.musically',totalMinutes:22}];
  WEEKLY=[{day:'Mon',minutes:240,isToday:false,date:'2/17'},{day:'Tue',minutes:312,isToday:false,date:'2/18'},{day:'Wed',minutes:198,isToday:false,date:'2/19'},{day:'Thu',minutes:410,isToday:false,date:'2/20'},{day:'Fri',minutes:328,isToday:false,date:'2/21'},{day:'Sat',minutes:360,isToday:false,date:'2/22'},{day:'Sun',minutes:202,isToday:true,date:'2/23'}];
  TODAY_MINS=202; PICKUPS=47;
  GHOSTS=[{name:'Snapchat',packageName:'com.snapchat.android',daysSinceUse:47,sizeMB:218},{name:'LinkedIn',packageName:'com.linkedin.android',daysSinceUse:62,sizeMB:145}];
  hideLoading(); showApp(); renderAll();
}

function buildCatsMap(apps){
  // Load saved app->category overrides and custom category icons
  let appCatMap = {};
  let savedIcons = {};
  if(IS_NATIVE){
    try{ appCatMap = JSON.parse(N.getAppCategoryMap()||'{}'); }catch(e){}
    try{ savedIcons = JSON.parse(N.getCategoryOverrides()||'{}'); }catch(e){}
  }
  Object.assign(CAT_ICONS, savedIcons);

  CATS_MAP = {};
  apps.forEach(a => {
    const cat = appCatMap[a.packageName] || a.category || 'Other';
    if(!CATS_MAP[cat]) CATS_MAP[cat] = [];
    CATS_MAP[cat].push(a);
  });

  // Ensure user-created categories persist even when empty (fix #3)
  if(IS_NATIVE){
    try{
      const userCats = JSON.parse(N.getUserCategories()||'[]');
      userCats.forEach(cat=>{ if(!CATS_MAP[cat]) CATS_MAP[cat]=[]; });
    }catch(e){}
  }

  // Remove truly empty categories that aren't user-created
  if(IS_NATIVE){
    let userCats=[];
    try{ userCats=JSON.parse(N.getUserCategories()||'[]'); }catch(e){}
    const userSet=new Set(userCats);
    Object.keys(CATS_MAP).forEach(cat=>{
      if(CATS_MAP[cat].length===0 && !userSet.has(cat)) delete CATS_MAP[cat];
    });
  } else {
    Object.keys(CATS_MAP).forEach(cat=>{ if(CATS_MAP[cat].length===0) delete CATS_MAP[cat]; });
  }
}

// Save an app's category assignment and persist it
function assignAppToCategory(pkg, newCat){
  let appCatMap = {};
  if(IS_NATIVE){ try{ appCatMap = JSON.parse(N.getAppCategoryMap()||'{}'); }catch(e){} }

  // Find app object FIRST (before removing from CATS_MAP)
  let appObj = null;
  Object.values(CATS_MAP).forEach(list => list.forEach(a => { if(a.packageName===pkg) appObj=a; }));
  // Fallback to allApps search (handles drag from search results)
  if(!appObj){
    const searchPool = getAllAppsForSearch();
    appObj = searchPool.find(a => a.packageName===pkg) || null;
  }
  if(!appObj && IS_NATIVE){
    try{ appObj = JSON.parse(N.getAllApps()||'[]').find(a=>a.packageName===pkg); }catch(e){}
  }
  // If still not found, create a minimal placeholder so the move still happens
  if(!appObj) appObj = {name: pkg.split('.').pop(), packageName: pkg, category: newCat, iconUrl: 'app-icon://'+pkg};

  // Now remove from all categories
  Object.keys(CATS_MAP).forEach(cat => {
    CATS_MAP[cat] = CATS_MAP[cat].filter(a => a.packageName !== pkg);
  });

  if(!CATS_MAP[newCat]) CATS_MAP[newCat] = [];
  CATS_MAP[newCat].push({...appObj, category: newCat});

  appCatMap[pkg] = newCat;
  if(IS_NATIVE) nCall('saveAppCategoryMap', JSON.stringify(appCatMap));
}

let _lastRenderHash = '';
let _catRefreshTimer = null;
// Debounced: prevents multiple back-to-back calls from hammering the DOM
function scheduleGridRefresh(){
  clearTimeout(_catRefreshTimer);
  _catRefreshTimer = setTimeout(()=>{
    if(typeof renderCategoryGrid  === 'function') renderCategoryGrid();
    if(typeof renderCategoryList  === 'function') renderCategoryList();
    if(typeof updateCatsSub       === 'function') updateCatsSub();
  }, 50);
}
function renderAll(){
  try { updateGreeting(); } catch(e) { console.warn('[renderAll] updateGreeting:', e); }
  if(typeof scheduleBedtimeCheck === 'function') try { scheduleBedtimeCheck(); } catch(e) {}
  // Invalidate bridge-data caches at start of each full render cycle
  if(typeof _invalidateStripCache === 'function') _invalidateStripCache();
  // Always update stats (cheap text writes)
  if(typeof renderQuickStats === 'function') try { renderQuickStats();renderHomeSectionLabelsDeferred(); } catch(e) { console.warn('[renderAll] renderQuickStats:', e); }
  // Refresh tab-level Pro-gated UI on every full render
  try { refreshAllProGates(); } catch(e) {}
  // Only render sections for the active tab, mark others dirty
  if(_activeTab==='home'){
    if(typeof renderRecent === 'function') try { renderRecent(); } catch(e) {}
    if(typeof renderGhostBanner === 'function') try { renderGhostBanner(); } catch(e) {}
    if(typeof renderContextualInsight === 'function') try { renderContextualInsight(); } catch(e) {}
    if(typeof renderFocusStrip === 'function') try { renderFocusStrip(); } catch(e) {}
    if(typeof renderAureloScore  === 'function') try { renderAureloScore(); } catch(e) {}
    if(typeof HealthConnect !== 'undefined') try { HealthConnect.renderHomeBanner(); } catch(e) {}
    if(typeof renderCoachHomeInsight === 'function') try { renderCoachHomeInsight(); } catch(e) {}
    if(typeof renderSleepCard  === 'function') try { renderSleepCard(); } catch(e) {}
    if(typeof renderTimerAlert === 'function') try { renderTimerAlert(); } catch(e) {}
    if(typeof checkStreakIncrements       === 'function') try { checkStreakIncrements(); } catch(e) {}
    if(typeof renderHomeFocusDynamicRow   === 'function') try { renderHomeFocusDynamicRow(); } catch(e) {}
    if(typeof renderHomeHabitsDynamicRow  === 'function') try { renderHomeHabitsDynamicRow(); } catch(e) {}
    // Only re-render cat grid when cats changed
    const catHash = JSON.stringify(Object.keys(CATS_MAP).sort());
    if(catHash !== _lastRenderHash){
      _lastRenderHash = catHash;
      if(typeof renderCategoryGrid  === 'function') try { renderCategoryGrid(); } catch(e) {}
      if(typeof renderCategoryList  === 'function') try { renderCategoryList(); } catch(e) {}
      if(typeof renderManageCats    === 'function') try { renderManageCats(); } catch(e) {}
      if(typeof updateCatsSub       === 'function') try { updateCatsSub(); } catch(e) {}
    } else { _catsDirty = false; }
    if(typeof renderGhostPanel === 'function') try { renderGhostPanel(); } catch(e) {}
    _homeDirty = false;
    _ghostDirty = false;
  } else {
    _homeDirty = true;
  }
  if(_activeTab==='wellness') {
    if(typeof renderWellness === 'function') try { renderWellness(); } catch(e) {}
    _wellnessDirty = false;
  } else _wellnessDirty = true;
  if(_activeTab==='settings'){
    if(typeof updateTimersSub === 'function') try { updateTimersSub(); } catch(e) {}
    if(typeof updateLockedSub === 'function') try { updateLockedSub(); } catch(e) {}
    if(typeof updateHiddenSub === 'function') try { updateHiddenSub(); } catch(e) {}
    if(typeof updatePermUI    === 'function') try { updatePermUI(); } catch(e) {}
    if(typeof HealthConnect !== 'undefined') try { HealthConnect.renderSettingsCard(); } catch(e) {}
  }
  if(typeof updateNotifDot === 'function') try { updateNotifDot(); } catch(e) {}
}

function refreshAndRenderGhosts() {
  if (!IS_NATIVE || !N.hasUsagePermission()) return;
  try {
        // FIX (Ghost stale list): Use forceGetGhostApps() which always rebuilds from
        // UsageStats, bypassing the 24h cache. getGhostApps() was serving a cached list
        // so uninstalled apps kept appearing and newly-unused apps never appeared until
        // the next day. forceGetGhostApps() also persists the result so background reads
        // (banner counts etc.) stay in sync after the panel is opened.
        const fn = (typeof N.forceGetGhostApps === 'function') ? 'forceGetGhostApps' : 'getGhostApps';
        GHOSTS = JSON.parse(N[fn](30) || '[]');
  } catch(e) { console.error('refreshAndRenderGhosts:', e); }
  renderGhostBanner();
  renderGhostPanel();
}

// Called by MainActivity's 10s bgExecutor after it has already written fresh
// values to SharedPrefs — grab the updated cache and refresh only visible numbers.
// This is intentionally lightweight: no queryEvents scan, no DOM rebuild.
window.onBgScanComplete = function(){
  if(!IS_NATIVE || !N.hasUsagePermission()) return;
  try{
    // getCachedTotalMins / getCachedPickups read directly from SharedPrefs —
    // essentially free, no usage-stats query.
    const mins    = IS_NATIVE && N.getCachedTotalMins    ? N.getCachedTotalMins()    : TODAY_MINS;
    const pickups = IS_NATIVE && N.getCachedPickupCount  ? N.getCachedPickupCount()  : PICKUPS;
    const changed = mins !== TODAY_MINS || pickups !== PICKUPS;
    TODAY_MINS = mins;
    PICKUPS    = pickups;
    if(changed){
      // Fast path: only touch the 2-3 text nodes that show these numbers
      const qsT = document.getElementById('qs-today');
      const qsP = document.getElementById('qs-pickups');
      if(qsT) qsT.textContent = fmtM(TODAY_MINS)||'–';
      if(qsP) qsP.textContent = PICKUPS>0?PICKUPS:'–';
      if(_activeTab==='wellness') renderQuickStats();
    }
  }catch(_){}
};
let _wellnessDirty = false;
let _lastWellnessMins = -1; // cache donut chart render
let _lastDailyUseLen  = -1; // cache donut re-render on DAILY_USE change
let _homeDirty      = false;  // quick stats + recent need refresh
let _catsDirty      = false;  // category grid/list need refresh
let _ghostDirty     = false;  // ghost panel needs refresh

let _refreshTimer = null;
let _lastRefreshTs = 0;
function refreshUsage(){
  if(!IS_NATIVE || !N.hasUsagePermission()) return;
  // Debounce: skip if called within 8s to avoid piling up scans.
  // _lastRefreshTs=0 bypasses this (set on boot and resume for immediate refresh).
  const now = Date.now();
  if(_lastRefreshTs !== 0 && now - _lastRefreshTs < 8000) return;
  _lastRefreshTs = now;
  // Invalidate bridge-data caches so renders read fresh values this cycle
  if(typeof _invalidateStripCache === 'function') _invalidateStripCache();
  try {
    const snap = JSON.parse(N.refreshUsageData() || '{}');
    if(snap.topApps && snap.topApps.length >= 0){
      DAILY_USE  = snap.topApps;
      TODAY_MINS = snap.totalMins || 0;
      PICKUPS    = snap.pickups   || 0;
      if(snap.hourly) try{ window._hourlyCache = snap.hourly; }catch(_){}
    }
  } catch(e){ console.error('refreshUsage:', e); }
  // Only render what's currently visible — skip off-screen tabs entirely
  if(typeof renderQuickStats === 'function') renderQuickStats();
  if(typeof renderRecent === 'function') renderRecent();
  if(typeof renderAureloScore  === 'function') renderAureloScore();
  if(typeof renderTimerAlert === 'function') renderTimerAlert();
  if(typeof checkStreakIncrements       === 'function') checkStreakIncrements();
  if(typeof renderHomeFocusDynamicRow   === 'function') renderHomeFocusDynamicRow();
  if(typeof renderHomeHabitsDynamicRow  === 'function') renderHomeHabitsDynamicRow();
  if(_activeTab==='wellness') renderWellness();
  else _wellnessDirty = true;
  updateNotifDot();
}

function dismissFirstRunCard() {
    // Mark as done in the state object
    if (typeof S !== 'undefined') {
        S.firstRunCardDone = true;
        saveS(); // Persist to localStorage
    }

    // Remove the card from the UI if it exists
    const card = document.getElementById('first-run-card');
    if (card) {
        card.style.display = 'none';
    }

    // Refresh the UI to fill the gap left by the card
    if (typeof renderAll === 'function') {
        renderAll();
    }
}

function showApp(){
  document.getElementById('app').style.display='flex';
  initPullToRefresh();
  initDragScroll();
  // Prompt for notification/DND if missing (only once after onboarding)
  if(IS_NATIVE && typeof N.isOnboardingDone==='function' && N.isOnboardingDone()){
    maybePromptMissingPerms();
  }

   // First-boot only: staggered entrance animation + first-run snapshot card
  const isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    if(_isFirstBoot && !S.firstRunCardDone && !isPro){
      _runFirstBootEntrance();
    }

  // This will show the "Welcome Back" message if it was queued during
    // the boot/onboarding process.
    if (typeof ProUpsell !== 'undefined') {
      ProUpsell.consumePendingWelcome();
    }

  renderAll();
}

// Staggered entrance animation on first boot.
// Elements slide up sequentially so the screen feels like it's being
// revealed rather than just appearing. Runs after renderAll() has painted.
function _runFirstBootEntrance(){
  const targets = [
    document.querySelector('.home-goal-card'),
    document.getElementById('home-focus-strip'),
    document.getElementById('first-run-card'),
    document.getElementById('recent-row'),
    document.getElementById('cat-grid-view'),
  ].filter(Boolean);

  // Apply initial hidden state to all targets immediately
  targets.forEach(el => el.classList.add('boot-enter'));

  // Stagger visibility — 80ms apart so it feels fluid not choppy
  targets.forEach((el, i) => {
    setTimeout(() => {
      el.classList.add('boot-visible');
      // Show first-run card at the same step it animates in
      if(el.id === 'first-run-card'){
        if(typeof renderFirstRunCard === 'function') renderFirstRunCard();
      }
    }, 120 + i * 80);
  });

  // Clean up transition classes after animation completes
  setTimeout(() => {
    targets.forEach(el => {
      el.classList.remove('boot-enter', 'boot-visible');
    });
  }, 120 + targets.length * 80 + 450);
}
function hideLoading(){
  const bar = document.getElementById('ls-bar');
  if(bar){ bar.style.transition='width .28s ease'; bar.style.width='100%'; }
  setTimeout(()=>{
    const ls = document.getElementById('loading-screen');
    if(ls) ls.classList.add('hidden');
  }, 100);
}


// ── Auto-scroll shared state (used by all drag implementations) ──────────────
let _asRAF = null, _asDY = 0, _asEl = null;

function _asStart(el) {
  _asEl = el;
  if (_asRAF) return;
  (function loop() {
    if (_asDY && _asEl) _asEl.scrollBy(0, _asDY);
    _asRAF = requestAnimationFrame(loop);
  })();
}
function _asStop() {
  if (_asRAF) { cancelAnimationFrame(_asRAF); _asRAF = null; }
  _asDY = 0; _asEl = null;
}
function _asUpdate(clientY, el) {
  const ZONE = 100, MAX = 14, h = window.innerHeight;
  if (clientY < ZONE)       { _asDY = -MAX * Math.pow(1 - clientY / ZONE, 1.6); _asStart(el); }
  else if (clientY > h - ZONE) { _asDY =  MAX * Math.pow(1 - (h - clientY) / ZONE, 1.6); _asStart(el); }
  else _asDY = 0;
}

function initDragScroll(){
  // Clear category highlights when user taps outside category tiles
  document.addEventListener('touchstart', e => {
    if(!_tdrag && !window._cpPickDragging) return;
    if(!e.target.closest('.cat-tile[data-cat]')) clearCatHighlights();
  }, {passive:true});

  document.addEventListener('click', e => {
    if(_tdrag || window._cpPickDragging) return;
    if(!e.target.closest('.cat-tile[data-cat]')) clearCatHighlights();
  }, {passive:true});

  // Auto-scroll home screen when dragging near top/bottom
  const homeScreen = document.getElementById('screen-home');
  if(!homeScreen) return;
  let scrollInterval = null;
  homeScreen.addEventListener('dragover', e=>{
    e.preventDefault(); // allow drop anywhere on home
    const rect = homeScreen.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    clearInterval(scrollInterval);
    if(y < 80)      scrollInterval = setInterval(()=>homeScreen.scrollBy(0,-8),16);
    else if(y>h-80) scrollInterval = setInterval(()=>homeScreen.scrollBy(0,8),16);
  });
  homeScreen.addEventListener('dragleave', ()=>clearInterval(scrollInterval));
  homeScreen.addEventListener('drop', ()=>clearInterval(scrollInterval));
}

function initPullToRefresh(){
  // Guard: only ever run once — multiple showApp() calls must not re-attach listeners
  if(initPullToRefresh._done) return;
  initPullToRefresh._done = true;

  document.querySelectorAll('.screen').forEach(screen=>{
    let startY=0, pulling=false, indicator=null;

    function cleanup(){
      if(indicator){
        // Smooth fade-out to avoid abrupt flicker when pull is released without triggering
        var ind = indicator;
        indicator = null; // null immediately so no re-entry
        if (ind.parentNode) {
          ind.style.transition = 'opacity .18s ease, transform .18s ease';
          ind.style.opacity = '0';
          ind.style.transform = 'translateY(-12px)';
          setTimeout(function(){ if(ind.parentNode) ind.remove(); }, 200);
        }
      }
      startY=0; pulling=false;
    }

    screen.addEventListener('touchstart',e=>{
      if(pickedApp || _tdrag || window._cpPickDragging) return;
      // Always clean up any stale indicator from a cancelled previous touch
      if(indicator){ indicator.remove(); indicator=null; }
      if(screen.scrollTop===0) startY=e.touches[0].clientY;
      else startY=0;
    },{passive:true});

    screen.addEventListener('touchmove',e=>{
      if(!startY || pickedApp || _tdrag || window._cpPickDragging) return;
      const dy=e.touches[0].clientY-startY;
      if(dy>20&&!indicator){
        indicator=document.createElement('div');
        indicator.style.cssText='position:sticky;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:10px;gap:8px;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);background:var(--bg)';indicator.setAttribute('role','status');indicator.setAttribute('aria-label','Pull to refresh');
        indicator.innerHTML='<div style="width:20px;height:20px;border-radius:50%;border:2px solid var(--border2);border-top-color:var(--p);animation:spin .8s linear infinite;flex-shrink:0"></div>Pull to refresh';
        screen.prepend(indicator);
      }
      if(indicator){
        const pct=Math.min(dy/80,1);
        indicator.style.opacity=pct;
        indicator.style.transform=`translateY(${(pct-1)*20}px)`;
      }
      if(dy>80&&!pulling){ pulling=true; if(indicator) indicator.querySelector('div').style.borderTopColor='var(--g)'; }
    },{passive:true});

    screen.addEventListener('touchend',()=>{
      if(pulling){
        // Dismiss indicator immediately — doFullRefresh() is synchronous and can
        // block for 200-800ms on large installs. Calling cleanup() first means the
        // spinner never appears frozen waiting for bridge calls to return.
        cleanup();
        if(screen.id === 'screen-discover'){
          if(typeof refreshDiscover === 'function') refreshDiscover();
          toast('Refreshing…','info');
        } else {
          doFullRefresh();
          toast('Refreshing…','info');
        }
      } else {
        cleanup();
      }
    },{passive:true});

    // touchcancel fires when the OS intercepts the touch (incoming call, tab swipe, etc.)
    // Without this, stale indicators accumulate across cancelled gestures
    screen.addEventListener('touchcancel', cleanup, {passive:true});
  });
}

function doFullRefresh(){
  if(!IS_NATIVE||!N.hasUsagePermission()) return;
  // Cancel any active drag modes and clear highlights before refreshing
  if(_tdrag){ _tdrag.ghost&&_tdrag.ghost.remove(); _tdrag=null; }
  if(pickedApp){ cancelPickMode(); }
  clearCatHighlights();
  // Clear stale notification panel immediately so it doesn't linger
  document.getElementById('notif-list').innerHTML='<div style="text-align:center;font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t3);padding:20px">Refreshing…</div>';
  document.getElementById('notif-dot') && (document.getElementById('notif-dot').style.display='none');
  DAILY_USE  = JSON.parse(N.getDailyUsageStats()||'[]');
  WEEKLY     = JSON.parse(N.getCachedWeeklyData()||'[]');
  TODAY_MINS = N.getTotalScreenTimeToday()||0;
  PICKUPS    = N.getPickupCountToday()||0;
  GHOSTS     = JSON.parse(N.getGhostApps(30)||'[]');
  _allAppsCache=null;
  _catAppOrderCache=null;
  if(typeof _invalidateMonthlyCache==='function') _invalidateMonthlyCache();
  buildCatsMap(JSON.parse(N.refreshApps()||'[]'));
  renderAll();
  // Re-check notif dot after refresh
  setTimeout(updateNotifDot, 300);
}
function skipPerm(){ document.getElementById('perm-screen').classList.add('hidden'); loadDemoData(); }