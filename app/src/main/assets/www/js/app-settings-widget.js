/* ═══ app-settings-widget.js — Widget settings panel collapse/expand ════════
 * Phase 4 extraction from app-settings.js.
 * Depends on: app-settings.js boot hooks (called after DOM ready),
 *             IS_NATIVE, nCall
 * ════════════════════════════════════════════════════════════════════════════ */

// ── Widget section collapse ──────────────────────────────────────────────────
function toggleWidgetSection(){
  const body=document.getElementById('widget-section-body');
  const chev=document.getElementById('widget-section-chev');
  if(!body) return;
  const isCollapsed=body.style.display==='none';
  body.style.display=isCollapsed?'block':'none';
  if(chev) chev.style.transform=isCollapsed?'rotate(90deg)':'rotate(0deg)';
  try{ if(IS_NATIVE) nCall('setStringPref','widget_section_collapsed',isCollapsed?'':'1'); }catch(_){}
}
function _initWidgetSection(){
    // Always collapsed on every visit — reset both widget section and inner settings
    const body = document.getElementById('widget-section-body');
    const chev = document.getElementById('widget-section-chev');
    if(!body) return;
    body.style.display = 'none';
    if(chev) chev.style.transform = 'rotate(0deg)';
    const wsBody = document.getElementById('widget-settings-body');
    const wsChev = document.getElementById('widget-settings-chev');
    if(wsBody) wsBody.style.display = 'none';
    if(wsChev) wsChev.style.transform = 'rotate(0deg)';
}

function toggleWidgetSettings() {
  const body = document.getElementById('widget-settings-body');
  const chev = document.getElementById('widget-settings-chev');
  if (!body) return;
  const isCollapsed = body.style.display === 'none';
  body.style.display = isCollapsed ? 'block' : 'none';
  if (chev) chev.style.transform = isCollapsed ? 'rotate(90deg)' : 'rotate(0deg)';
}

function initWidgetSettings() {
  const body = document.getElementById('widget-settings-body');
  const chev = document.getElementById('widget-settings-chev');
  if (!body) return;
  body.style.display = 'none'; // collapsed by default
  if (chev) chev.style.transform = 'rotate(0deg)';
}

/* ── Boot: initialise widget section state ──────────────────────────────── */
_initWidgetSection();
initWidgetSettings();

// ── Collapse widget section whenever user leaves Settings ────────────────────
(function(){
    var _origActivateTab = window.activateTab;
    window.activateTab = function(tab){
        if(tab !== 'settings'){
            var body = document.getElementById('widget-section-body');
            var chev = document.getElementById('widget-section-chev');
            if(body) body.style.display = 'none';
            if(chev) chev.style.transform = 'rotate(0deg)';
            var wsBody = document.getElementById('widget-settings-body');
            var wsChev = document.getElementById('widget-settings-chev');
            if(wsBody) wsBody.style.display = 'none';
            if(wsChev) wsChev.style.transform = 'rotate(0deg)';
        // In app-settings.js, the activateTab wrapper else-branch should be:
       }
        if(typeof _origActivateTab === 'function') return _origActivateTab.apply(this, arguments);
    };
})();

// ─── Pro status change — update settings identity card ───────────────────────
// onProStatusChanged is called by Kotlin whenever Pro status changes (purchase,
// restore, or revocation). We hook it here to keep the settings card in sync.
(function () {
  const _prev = window.onProStatusChanged;
  // In app-settings.js, change the onProStatusChanged wrapper to:
  window.onProStatusChanged = function (isPro) {
    _updateSettingsIdentityCard(isPro);

    // Sync settings-pro-pill (inline pill next to Aurelo name)
    const settingsPill = document.getElementById('settings-pro-pill');
    if (settingsPill) settingsPill.style.display = isPro ? 'inline-flex' : 'none';

    // Sync #pro-pill (home tab) and all .pro-pill-clone spans (other tabs)
    const homePill = document.getElementById('pro-pill');
    if (homePill) homePill.style.display = isPro ? 'inline-flex' : 'none';
    document.querySelectorAll('.pro-pill-clone').forEach(function(el) {
      el.style.display = isPro ? 'inline-flex' : 'none';
    });

    // Refresh all Pro-gated UI so nothing is stale after purchase
    if (typeof refreshAllProGates === 'function') refreshAllProGates();
    if (typeof _prev === 'function') _prev(isPro);
  };
})();
/* ═══ COMPAT-02 FIX: OEM Battery Whitelist Prompts ════════════════════════════
 * On Xiaomi/MIUI, Oppo/ColorOS, OnePlus, Huawei, Samsung, and Vivo devices,
 * aggressive battery killers terminate AppMonitorService silently, disabling
 * Focus Mode and Bedtime blocking. We detect the OEM via AppBridge.getManufacturer()
 * and show a targeted prompt guiding the user to the correct settings page.
 * ═══════════════════════════════════════════════════════════════════════════ */
window.showOemBatteryPrompt = function() {
  if (typeof AppBridge === 'undefined') return;
  // Only show if not already exempt
  if (AppBridge.isBatteryOptimizationExempt && AppBridge.isBatteryOptimizationExempt()) return;

  const mfr = (AppBridge.getManufacturer ? AppBridge.getManufacturer() : '').toLowerCase();

  let title = 'Allow background activity';
  let body  = 'To keep Focus Mode and Bedtime reliable, allow Aurelo to run in the background.';
  let btnLabel = 'Open Battery Settings';
  let showOemBtn = false;

  if (mfr.includes('xiaomi')) {
    title = 'MIUI Battery Settings';
    body  = 'On Xiaomi devices, go to Battery Saver → No restrictions for Aurelo. Otherwise Focus Mode may stop working when your screen is off.';
    showOemBtn = true;
  } else if (mfr.includes('oppo') || mfr.includes('oneplus') || mfr.includes('realme')) {
    title = 'Background App Management';
    body  = 'On your device, set Aurelo to "Allow background activity" in Battery → App Battery Management to keep Focus Mode running.';
    showOemBtn = true;
  } else if (mfr.includes('huawei') || mfr.includes('honor')) {
    title = 'Huawei Battery Settings';
    body  = 'On Huawei devices, open Phone Manager → App Launch → Aurelo and enable "Run in background" manually.';
    showOemBtn = true;
  } else if (mfr.includes('samsung')) {
    title = 'Samsung Battery Settings';
    body  = 'On Samsung devices, go to Battery → Background usage limits and make sure Aurelo is not listed as a sleeping app.';
    showOemBtn = true;
  } else if (mfr.includes('vivo')) {
    title = 'Vivo Background Settings';
    body  = 'On Vivo devices, open i Manager → Software Manager → Autostart and enable Aurelo to keep Focus Mode active.';
    showOemBtn = true;
  }

  // Build modal
  const existing = document.getElementById('_oem-battery-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = '_oem-battery-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--s1,#16181f);border-radius:24px 24px 0 0;padding:24px 20px 32px;width:100%;max-width:480px;box-shadow:0 -4px 40px rgba(0,0,0,.4)">
      <div style="width:40px;height:4px;background:var(--border2,#2a2d3a);border-radius:2px;margin:0 auto 20px"></div>
      <div style="font-size:18px;font-weight:700;color:var(--t1,#e8eaf0);margin-bottom:10px">${escHtml(title)}</div>
      <div style="font-size:13px;color:var(--t2,#9da3b4);line-height:1.6;margin-bottom:20px">${escHtml(body)}</div>
      <button onclick="AppBridge.requestBatteryOptimizationExempt();document.getElementById('_oem-battery-modal').remove()"
        style="width:100%;padding:14px;border-radius:14px;background:var(--p,#6c63ff);color:#fff;font-size:15px;font-weight:700;border:none;cursor:pointer;margin-bottom:10px">${escHtml(btnLabel)}</button>
      ${showOemBtn ? `<button onclick="AppBridge.openOemBatterySettings();document.getElementById('_oem-battery-modal').remove()"
        style="width:100%;padding:14px;border-radius:14px;background:var(--s2,#1e2030);color:var(--t2,#9da3b4);font-size:14px;font-weight:600;border:1px solid var(--border2,#2a2d3a);cursor:pointer;margin-bottom:10px">Open ${escHtml(mfr.includes('xiaomi')?'MIUI':mfr.includes('huawei')||mfr.includes('honor')?'Huawei':'Samsung')} Settings</button>` : ''}
      <button onclick="document.getElementById('_oem-battery-modal').remove()"
        style="width:100%;padding:12px;border-radius:14px;background:transparent;color:var(--t3,#5c6070);font-size:13px;border:none;cursor:pointer">Not now</button>
    </div>`;
  document.body.appendChild(modal);
};

/* ═══ COMPAT-01 FIX: Exact Alarm Permission Dialog ════════════════════════════
 * On Android 12+ (API 31+), SCHEDULE_EXACT_ALARM requires user approval.
 * Show a one-time dialog when the user saves a routine and the permission
 * is missing, rather than silently failing to schedule the alarm.
 * Also exposed as window.onExactAlarmPermissionMissing() for MainActivity
 * to call on every resume when the permission has been revoked.
 * ═══════════════════════════════════════════════════════════════════════════ */
window.showExactAlarmPermissionDialog = function() {
  const existing = document.getElementById('_exact-alarm-modal');
  if (existing) return; // already showing

  const modal = document.createElement('div');
  modal.id = '_exact-alarm-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--s1,#16181f);border-radius:20px;padding:24px 20px;width:100%;max-width:340px;box-shadow:0 8px 40px rgba(0,0,0,.5)">
      <div style="font-size:32px;text-align:center;margin-bottom:14px">⏰</div>
      <div style="font-size:17px;font-weight:700;color:var(--t1,#e8eaf0);text-align:center;margin-bottom:10px">Enable Precise Scheduling</div>
      <div style="font-size:13px;color:var(--t2,#9da3b4);line-height:1.6;text-align:center;margin-bottom:20px">
        Android requires permission to schedule Focus routines and Bedtime alarms at exact times. Without it, your routines may not fire on time.
      </div>
      <button onclick="AppBridge.openExactAlarmSettings();document.getElementById('_exact-alarm-modal').remove()"
        style="width:100%;padding:14px;border-radius:14px;background:var(--p,#6c63ff);color:#fff;font-size:15px;font-weight:700;border:none;cursor:pointer;margin-bottom:10px">Grant Permission</button>
      <button onclick="document.getElementById('_exact-alarm-modal').remove()"
        style="width:100%;padding:12px;border-radius:14px;background:transparent;color:var(--t3,#5c6070);font-size:13px;border:none;cursor:pointer">Not now</button>
    </div>`;
  document.body.appendChild(modal);
};

// Called by MainActivity.checkExactAlarmPermission() on every resume
window.onExactAlarmPermissionMissing = function() {
  // Only show once per session — don't nag on every resume
  if (window._exactAlarmDialogShownThisSession) return;
  window._exactAlarmDialogShownThisSession = true;
  window.showExactAlarmPermissionDialog();
};

// Hook into routine save: after saving, check alarm permission
(function() {
  const _origSave = window.saveRoutine;
  if (typeof _origSave === 'function') {
    window.saveRoutine = function() {
      const result = _origSave.apply(this, arguments);
      // Check after save — if no exact alarm permission, show dialog
      if (typeof AppBridge !== 'undefined' && AppBridge.canScheduleExactAlarms &&
          !AppBridge.canScheduleExactAlarms()) {
        window.showExactAlarmPermissionDialog();
      }
      return result;
    };
  }
})();
