package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// AppBridge — Phase 3 coordinator.
// All @JavascriptInterface methods delegate to domain controllers.
// This file should stay ~150 lines of pure delegation + infrastructure.
// Business logic belongs in domain controller files (see BridgeKeys.kt).
// ═══════════════════════════════════════════════════════════════════════════

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.javikastudio.tidyapp.billing.BillingManager
import com.javikastudio.tidyapp.billing.EntitlementRepository
import com.javikastudio.tidyapp.billing.PurchaseRestoreHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

class AppBridge(private val context: Context, private val webView: WebView) {

    // ── Infrastructure ────────────────────────────────────────────────────────
    internal val bridgeScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
    private val catCache = context.getSharedPreferences("tidyapp_cat_cache_v1", Context.MODE_PRIVATE)

    @Volatile private var _secureStorageAvailable = true
    private val securePrefs: android.content.SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            val p = EncryptedSharedPreferences.create(context,"tidyapp_secure_v1",masterKey,EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
            _secureStorageAvailable = true; p
        } catch (e: Exception) {
            _secureStorageAvailable = false
            android.util.Log.w("AppBridge","EncryptedSharedPreferences unavailable, falling back",e)
            webView.post { webView.evaluateJavascript("if(typeof window.onSecureStorageUnavailable==='function') window.onSecureStorageUnavailable()",null) }
            context.getSharedPreferences("tidyapp_secure_fallback_v1",Context.MODE_PRIVATE)
        }
    }

    private val pm: PackageManager = context.packageManager
    private val entitlementRepo = EntitlementRepository(context)
    private val billingManager = BillingManager(context, object : BillingManager.BillingListener {
        override fun onProStatusChanged(isPro: Boolean) {
            // ── Grace-period guard (DOWNGRADE-FIX) ───────────────────────────────
            // queryExistingPurchases() fires on every cold start and on every
            // onAppForegrounded() call. Google Play can return an empty purchase list
            // transiently during Play service warm-up, after a reboot, or when offline.
            // Without a guard this emits onProStatusChanged(false) while wasPro=true,
            // immediately triggering handleProDowngrade() and nuking bedtime alarms,
            // Health Connect, routines, and app-list ceilings for a confirmed Pro user.
            //
            // If billing says "not Pro" but we positively confirmed Pro within the last
            // 72 h (REVOCATION_GRACE_MS), treat this as a transient Play miss: skip the
            // cache write, skip the JS notification, and skip all downgrade cleanup.
            // Billing will call us again on the next foreground event; if the subscription
            // is genuinely lapsed it will confirm false again once the grace window expires.
            if (!isPro && entitlementRepo.isPro && entitlementRepo.isWithinRevocationGrace()) {
                android.util.Log.d("AureloBilling",
                    "onProStatusChanged(false) suppressed — within 72 h revocation grace window. " +
                            "lastProConfirmed=${entitlementRepo.lastProConfirmedMs}")
                return
            }
            // ── End grace-period guard ────────────────────────────────────────────

            // Capture previous state BEFORE updating so we can detect the Pro→Free transition.
            val wasPro = entitlementRepo.isPro
            entitlementRepo.setProStatus(isPro)

            // BUG FIX (Screen Filter / Bedtime gate): BedtimeReceiver.BEDTIME_ON and
            // startWindDownFilter() gate on IS_PRO_USER in tidyapp_v6, not on
            // entitlementRepo (tidyapp_entitlement_v1). This key was never written when
            // Pro was granted, so the filter check always saw false and blocked activation.
            // Write the grant here; the revocation paths below handle the false write.
            if (isPro) prefs.edit().putBoolean(IS_PRO_USER, true).apply()

            webView.post { webView.evaluateJavascript("window.__pendingProStatus=$isPro;if(typeof window.onProStatusChanged==='function') window.onProStatusChanged($isPro)",null) }

            // ── Downgrade handling (billing-detection path) ───────────────────────
            // Fires when Play billing confirms the subscription has lapsed: plan expired,
            // revoked via Play Console, refunded, or any other cancellation mechanism.
            //
            // Two jobs:
            //   1. Activate any banked referral extension days (keeps user Pro temporarily).
            //   2. If no extension, run the full native downgrade cleanup so features like
            //      bedtime alarms, focus routines, Health Connect, and app-list ceilings
            //      are always reset — even if the WebView isn't ready or JS fails to call
            //      window.AppBridge.handleProDowngrade() (e.g. cold-start billing race or
            //      JS wasPro already false from a prior session).
            //
            // This complements pro-gate.js _handleProDowngrade() — both paths are safe
            // to run because handleProDowngrade() is fully idempotent.
            if (wasPro && !isPro) {
                // activateExtensionOnLapse() is idempotent: clears pending days and writes
                // the expiry timestamp. Returns 0 if no days were banked.
                val extensionDays = ReferralManager.activateExtensionOnLapse(prefs)
                if (extensionDays > 0) {
                    // Referral extension activated — keep user Pro for the extension period.
                    prefs.edit().putBoolean(IS_PRO_USER, true).apply()
                    android.util.Log.d("AureloBilling",
                        "Billing lapse — referral extension activated: $extensionDays days")
                    // BUG-06 FIX: schedule the expiry worker so Pro is revoked automatically
                    // when the extension window closes, even if the user never reopens the app.
                    ReferralExtensionWorker.scheduleExpiry(context)
                    // Tell JS to show the extension banner
                    val jsExt = "if(typeof window.onReferralExtensionActivated==='function')" +
                            "window.onReferralExtensionActivated($extensionDays);"
                    webView.post { webView.evaluateJavascript(jsExt, null) }
                } else {
                    // No extension days banked — perform full native downgrade cleanup.
                    // Runs on main thread; AlarmManager and some bridge methods require it.
                    // Clear IS_PRO_USER in tidyapp_v6 so BedtimeReceiver / startWindDownFilter()
                    // immediately see the revoked state (complements the entitlementRepo write above).
                    prefs.edit().putBoolean(IS_PRO_USER, false).apply()
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        try {
                            this@AppBridge.handleProDowngrade()
                        } catch (e: Exception) {
                            android.util.Log.w("AureloBilling",
                                "Native downgrade cleanup failed: ${e.message}")
                        }
                    }
                }
            }
        }
        override fun onBillingError(code: Int, message: String) {
            webView.post { webView.evaluateJavascript("if(typeof window.onBillingError==='function') window.onBillingError($code,${org.json.JSONObject.quote(message)})",null) }
        }
        override fun onBillingReady() {}
        // BUG-03 FIX: forward the confirmed plan to BillingBridge so setProUser(true)
        // passes the real plan (monthly/annual/lifetime) to the referral system instead
        // of the previously hardcoded "monthly".
        override fun onPlanActivated(plan: String) {
            prefs.edit().putString(BILLING_ACTIVE_PLAN, plan).apply()
        }
    })

    // ── Domain controllers ────────────────────────────────────────────────────
    internal val playFetcher = PlayStoreFetcher(context)
    internal val appManagement = AppManagementBridge(context,webView,prefs,securePrefs,bridgeScope,pm,playFetcher,AppCategorizer(context),catCache,{ _secureStorageAvailable })
    internal val usage = UsageStatsBridge(context,webView,prefs,securePrefs,bridgeScope,pm,appManagement)
    private val timer = AppTimerBridge(context,webView,prefs,securePrefs,bridgeScope,usage)
    private val focusSession = FocusSessionBridge(context,webView,prefs,securePrefs,bridgeScope)
    private val focusRoutine = FocusRoutineBridge(context,webView,prefs,securePrefs,bridgeScope)
    private val intention = IntentionPromptBridge(context,webView,prefs,securePrefs,bridgeScope)
    private val bedtime = BedtimeBridge(context,webView,prefs,securePrefs,bridgeScope)
    private val notification = NotificationBridge(context,webView,prefs,securePrefs,bridgeScope,usage,timer)
    private val widget = WidgetBridge(context,webView,prefs,securePrefs,bridgeScope,pm,appManagement)
    private val share = ShareBridge(context,webView,prefs,securePrefs,bridgeScope)
    private val settings = SettingsBridge(context,webView,prefs,securePrefs,bridgeScope,{ _secureStorageAvailable })
    private val permission = PermissionBridge(context,webView,prefs,securePrefs,bridgeScope)
    internal val referral = ReferralBridge(context,webView,prefs,securePrefs,bridgeScope)
    private val billing = BillingBridge(context,webView,prefs,securePrefs,bridgeScope,billingManager,entitlementRepo,PurchaseRestoreHandler(context,webView,billingManager,entitlementRepo),referral)
    internal val healthConnect = HealthConnectBridge(context,webView,prefs,securePrefs,bridgeScope)
    internal val coach = CoachBridge(context,webView,prefs,securePrefs,bridgeScope)

    private val pendingLaunchActivity: Activity? = null

    init {
        billingManager.connect()
        // FIX (Issue 3): wire CoachBridge reference into HealthConnectBridge so it
        // can invalidate tab insight caches on HC connect — ensuring coach cards
        // reflect HC data immediately without requiring an app restart.
        healthConnect.coachBridge = coach
    }

    fun notifyForeground() { billingManager.onAppForegrounded() }

    fun destroy() { bridgeScope.cancel(); billing.onDestroy() }

    fun clearCatCacheEntry(pkg: String) { appManagement.clearCatCacheEntry(pkg) }

    fun preScan() { appManagement.preScan(); usage.preScan { appManagement.buildInstalledAppsList() } }

    fun refreshUsageStats() {
        if (!RefreshCoordinator.shouldRefreshUsage()) return
        usage.refreshUsageStats()
        timer.checkTimerThresholds()
    }

    fun serveIcon(packageName: String): android.webkit.WebResourceResponse? {
        return try {
            val icon = pm.getApplicationIcon(packageName)
            val bitmap = if (icon is android.graphics.drawable.BitmapDrawable) icon.bitmap else {
                val b = android.graphics.Bitmap.createBitmap(icon.intrinsicWidth.coerceAtLeast(1),icon.intrinsicHeight.coerceAtLeast(1),android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(b); icon.setBounds(0,0,canvas.width,canvas.height); icon.draw(canvas); b
            }
            val bos = java.io.ByteArrayOutputStream(); bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,bos)
            android.webkit.WebResourceResponse("image/png","UTF-8",java.io.ByteArrayInputStream(bos.toByteArray()))
        } catch (e: Exception) { null }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DELEGATION — every @JavascriptInterface method is a one-liner here.
    // All logic lives in the domain controller files above.
    // ═══════════════════════════════════════════════════════════════════════

    // ── Permission ─────────────────────────────────────────────────────────
    @JavascriptInterface fun hasUsagePermission()              = permission.hasUsagePermission()
    @JavascriptInterface fun requestUsagePermission()          = permission.requestUsagePermission()
    @JavascriptInterface fun hasOverlayPermission()            = permission.hasOverlayPermission()
    @JavascriptInterface fun requestOverlayPermission()        = permission.requestOverlayPermission()
    @JavascriptInterface fun hasAccessibilityPermission()      = permission.hasAccessibilityPermission()
    @JavascriptInterface fun requestAccessibilitySettings()    = permission.requestAccessibilitySettings()
    @JavascriptInterface fun hasNotificationPermission()       = permission.hasNotificationPermission()
    @JavascriptInterface fun openNotificationSettings()        = permission.openNotificationSettings()
    @JavascriptInterface fun requestNotificationPermission()   = permission.requestNotificationPermission()
    @JavascriptInterface fun hasDndPermission()                = bedtime.hasDndPermission()
    @JavascriptInterface fun openDndSettings()                 = bedtime.openDndSettings()
    @JavascriptInterface fun isBatteryOptimizationExempt()     = permission.isBatteryOptimizationExempt()
    @JavascriptInterface fun requestBatteryOptimizationExempt()= permission.requestBatteryOptimizationExempt()
    @JavascriptInterface fun getManufacturer()                 = permission.getManufacturer()
    @JavascriptInterface fun openOemBatterySettings()          = permission.openOemBatterySettings()
    @JavascriptInterface fun openExactAlarmSettings()          = permission.openExactAlarmSettings()
    @JavascriptInterface fun canScheduleExactAlarms()          = permission.canScheduleExactAlarms()
    @JavascriptInterface fun canWriteSettings()                = settings.canWriteSettings()
    @JavascriptInterface fun requestWriteSettingsPermission()  = settings.requestWriteSettingsPermission()
    @JavascriptInterface fun hasSecureSettingsPermission()     = bedtime.hasSecureSettingsPermission()
    @JavascriptInterface fun isSecureStorageAvailable()        = settings.isSecureStorageAvailable()

    // ── Settings ───────────────────────────────────────────────────────────
    @JavascriptInterface fun isOnboardingDone()                = settings.isOnboardingDone()
    @JavascriptInterface fun setOnboardingDone()               = settings.setOnboardingDone()
    @JavascriptInterface fun getSettings()                     = settings.getSettings()
    @JavascriptInterface fun saveSettings(json: String)        = settings.saveSettings(json)
    @JavascriptInterface fun saveStreakGoalMins(mins: Int)     = settings.saveStreakGoalMins(mins)
    @JavascriptInterface fun getStreakGoalMinsBridge()         = settings.getStreakGoalMinsBridge()
    @JavascriptInterface fun getStringPref(key: String)        = settings.getStringPref(key)
    @JavascriptInterface fun setStringPref(k: String, v: String) = settings.setStringPref(k,v)
    @JavascriptInterface fun getDeviceModel()                  = settings.getDeviceModel()
    @JavascriptInterface fun getCountryCode()                  = settings.getCountryCode()
    @JavascriptInterface fun getPackageName()                  = settings.getPackageName()
    @JavascriptInterface fun getAppVersion()                   = settings.getAppVersion()
    @JavascriptInterface fun loadAssetFile(path: String)       = settings.loadAssetFile(path)
    @JavascriptInterface fun clearAllData()                    = settings.clearAllData()
    @JavascriptInterface fun clearAllDataFull()                = settings.clearAllDataFull()
    @JavascriptInterface fun checkAndTriggerRateApp(t: String) = settings.checkAndTriggerRateApp(t)
    @JavascriptInterface fun saveSmartAlertsEnabled(e: Boolean)= notification.saveSmartAlertsEnabled(e)

    // ── App Management ─────────────────────────────────────────────────────
    @JavascriptInterface fun getCachedApps()                   = appManagement.getCachedApps()
    @JavascriptInterface fun refreshApps()                     = appManagement.refreshApps()
    @JavascriptInterface fun getCategoryDefinitions()          = appManagement.getCategoryDefinitions()
    @JavascriptInterface fun getAllApps()                       = appManagement.getAllApps()
    @JavascriptInterface fun getLockedApps()                   = appManagement.getLockedApps()
    @JavascriptInterface fun setLockedApps(json: String)       = appManagement.setLockedApps(json)
    @JavascriptInterface fun getHiddenApps()                   = appManagement.getHiddenApps()
    @JavascriptInterface fun setHiddenApps(json: String)       = appManagement.setHiddenApps(json)
    @JavascriptInterface fun getCategoryOverrides()            = appManagement.getCategoryOverrides()
    @JavascriptInterface fun saveCategoryOverrides(j: String)  = appManagement.saveCategoryOverrides(j)
    @JavascriptInterface fun getAppCategoryMap()               = appManagement.getAppCategoryMap()
    @JavascriptInterface fun saveAppCategoryMap(j: String)     = appManagement.saveAppCategoryMap(j)
    @JavascriptInterface fun getCatAppOrder()                  = appManagement.getCatAppOrder()
    @JavascriptInterface fun saveCatAppOrder(json: String)     = appManagement.saveCatAppOrder(json)
    @JavascriptInterface fun getUserCategories()               = appManagement.getUserCategories()
    @JavascriptInterface fun saveUserCategories(j: String)     = appManagement.saveUserCategories(j)
    @JavascriptInterface fun isAppInstalled(pkg: String)       = appManagement.isAppInstalled(pkg)
    @JavascriptInterface fun openApp(pkg: String)              = appManagement.openApp(pkg)
    @JavascriptInterface fun openUrl(url: String)              = appManagement.openUrl(url)
    @JavascriptInterface fun openPlayStore(pkg: String)        = appManagement.openPlayStore(pkg)
    @JavascriptInterface fun openEmail(to:String,sub:String,body:String) = appManagement.openEmail(to,sub,body)
    @JavascriptInterface fun uninstallApp(pkg: String)         = appManagement.uninstallApp(pkg)
    @JavascriptInterface fun triggerBackgroundScan()           = appManagement.triggerBackgroundScan()
    @JavascriptInterface fun startPlaySync()                   = appManagement.startPlaySync()
    @JavascriptInterface fun onAdSearchClicked(q: String)      = appManagement.onAdSearchClicked(q)
    @JavascriptInterface fun finishApp()                       = (context as? Activity)?.finish()

    // ── Usage Stats ────────────────────────────────────────────────────────
    @JavascriptInterface fun getCachedDailyUsage()             = usage.getCachedDailyUsage()
    @JavascriptInterface fun getCachedWeeklyData()             = usage.getCachedWeeklyData()
    @JavascriptInterface fun getCachedHourly()                 = usage.getCachedHourly()
    @JavascriptInterface fun getCachedTotalMins()              = usage.getCachedTotalMins()
    @JavascriptInterface fun getCachedPickupCount()            = usage.getCachedPickupCount()
    @JavascriptInterface fun getDailyUsageStats()              = usage.getDailyUsageStats()
    @JavascriptInterface fun getWeeklyBreakdown()              = usage.getWeeklyBreakdown()
    @JavascriptInterface fun getHourlyBreakdownToday()         = usage.getHourlyBreakdownToday()
    @JavascriptInterface fun getTotalScreenTimeToday()         = usage.getTotalScreenTimeToday()
    @JavascriptInterface fun getFirstPickupTime()              = usage.getFirstPickupTime()
    @JavascriptInterface fun getPickupCountToday()             = usage.getPickupCountToday()
    @JavascriptInterface fun getStreakDays()                   = usage.getStreakDays()
    @JavascriptInterface fun getStreakDays(goalMinutes: Int)   = usage.getStreakDays(goalMinutes)
    @JavascriptInterface fun refreshUsageData()                = usage.refreshUsageData()
    @JavascriptInterface fun getWeeklyAppUsage()               = usage.getWeeklyAppUsage()
    @JavascriptInterface fun getMonthlyBreakdown()             = usage.getMonthlyBreakdown()
    @JavascriptInterface fun getMonthlyPickupBreakdown()       = usage.getMonthlyPickupBreakdown()
    @JavascriptInterface fun getMonthlyHourlyBreakdown()       = usage.getMonthlyHourlyBreakdown()
    @JavascriptInterface fun getMonthlyAppUsage()              = usage.getMonthlyAppUsage()
    @JavascriptInterface fun getCachedGhosts()                 = usage.getCachedGhosts()
    @JavascriptInterface fun getGhostApps(days: Int)           = usage.getGhostApps(days)
    @JavascriptInterface fun forceGetGhostApps(days: Int)      = usage.forceGetGhostApps(days)
    @JavascriptInterface fun getSmartTips()                    = usage.getSmartTips()
    @JavascriptInterface fun getDiscoverSuggestions()          = usage.getDiscoverSuggestions()
    @JavascriptInterface fun getDiscoverSuggestionsRefresh()   = usage.getDiscoverSuggestionsRefresh()

    // ── App Timers ─────────────────────────────────────────────────────────
    @JavascriptInterface fun getLimits()                       = timer.getLimits()
    @JavascriptInterface fun setAppLimit(pkg:String,mins:Int)  = timer.setAppLimit(pkg,mins)
    @JavascriptInterface fun removeAppLimit(pkg: String)       = timer.removeAppLimit(pkg)
    @JavascriptInterface fun checkAppLimitReached(pkg:String)  = timer.checkAppLimitReached(pkg)
    @JavascriptInterface fun recordTimerIgnore(pkg: String)    = timer.recordTimerIgnore(pkg)
    @JavascriptInterface fun getTimerIgnoreStats()             = timer.getTimerIgnoreStats()
    @JavascriptInterface fun postTimerWarningNotification(pkg:String,name:String,lim:Int,used:Int) = timer.postTimerWarningNotification(pkg,name,lim,used)
    @JavascriptInterface fun startTimerSoftBlock(pkg:String,name:String,used:Int,lim:Int) = timer.startTimerSoftBlock(pkg,name,used,lim)

    // ── Focus Session ──────────────────────────────────────────────────────
    @JavascriptInterface fun getFocusSessionState()            = focusSession.getFocusSessionState()
    @JavascriptInterface fun startFocusSession(apps:String,mins:Int,diff:String) = focusSession.startFocusSession(apps,mins,diff)
    @JavascriptInterface fun stopFocusSession()                = focusSession.stopFocusSession()
    @JavascriptInterface fun updateFocusSession(apps:String,endTs:Long,diff:String) = focusSession.updateFocusSession(apps,endTs,diff)
    @JavascriptInterface fun updateFocusTimer(mins: Int)       = focusSession.updateFocusTimer(mins)
    @JavascriptInterface fun getFocusStats()                   = focusSession.getFocusStats()
    // ROOT CAUSE FIX: getFocusDailyStats() existed in FocusSessionBridge but was never
    // delegated here. calculateFocus() in JS checks `typeof N.getFocusDailyStats === 'function'`
    // before calling it — since this delegation was missing, the check always returned false,
    // daily = {} always, totalSessions = 0 always. The weekly fallback (now removed as BUG-1)
    // was the only thing that ever surfaced session scores. Now daily session data flows through.
    @JavascriptInterface fun getFocusDailyStats()              = focusSession.getFocusDailyStats()
    @JavascriptInterface fun getFocusWeekDays()                = focusSession.getFocusWeekDays()
    @JavascriptInterface fun getAndClearLastFocusOutcome()     = focusSession.getAndClearLastFocusOutcome()
    @JavascriptInterface fun recordFocusComplete(m: Int)       = focusSession.recordFocusComplete(m)
    @JavascriptInterface fun recordFocusInterrupt(m: Int)      = focusSession.recordFocusInterrupt(m)
    @JavascriptInterface fun getFocusBlockedApps()             = focusSession.getFocusBlockedApps()
    @JavascriptInterface fun saveFocusBlockedApps(j: String)   = focusSession.saveFocusBlockedApps(j)

    // ── Focus Routines ─────────────────────────────────────────────────────
    @JavascriptInterface fun getFocusRoutines()                = focusRoutine.getFocusRoutines()
    @JavascriptInterface fun saveFocusRoutines(json: String)   = focusRoutine.saveFocusRoutines(json)
    @JavascriptInterface fun scheduleRoutineAlarm(json: String)= focusRoutine.scheduleRoutineAlarm(json)
    @JavascriptInterface fun cancelRoutineAlarm(id: String)    = focusRoutine.cancelRoutineAlarm(id)

    // ── Intention Prompt ───────────────────────────────────────────────────
    @JavascriptInterface fun getIntentionPromptApps()          = intention.getIntentionPromptApps()
    @JavascriptInterface fun saveIntentionPromptApps(j:String) = intention.saveIntentionPromptApps(j)
    @JavascriptInterface fun saveIntentionPromptEnabled(e:Boolean) = intention.saveIntentionPromptEnabled(e)
    @JavascriptInterface fun isIntentionPromptEnabled()        = intention.isIntentionPromptEnabled()
    @JavascriptInterface fun getIntentionPauseCount()          = intention.getIntentionPauseCount()
    @JavascriptInterface fun getIntentionResistCount()         = intention.getIntentionResistCount()
    @JavascriptInterface fun recordIntentionPause()            = intention.recordIntentionPause()
    @JavascriptInterface fun recordIntentionResist()           = intention.recordIntentionResist()
    @JavascriptInterface fun recordIntentionAppPause(pkg: String)  = intention.recordIntentionAppPause(pkg)
    @JavascriptInterface fun recordIntentionAppResist(pkg: String) = intention.recordIntentionAppResist(pkg)
    @JavascriptInterface fun getIntentionAppStats()                = intention.getIntentionAppStats()
    @JavascriptInterface fun getIntentionAppPauseCount(pkg:String) = intention.getIntentionAppPauseCount(pkg)
    @JavascriptInterface fun getIntentionAppResistCount(pkg:String)= intention.getIntentionAppResistCount(pkg)

    // ── Bedtime ────────────────────────────────────────────────────────────
    @JavascriptInterface fun getBedtimeSettings()              = bedtime.getBedtimeSettings()
    @JavascriptInterface fun saveBedtimeSettings(j: String)    = bedtime.saveBedtimeSettings(j)
    @JavascriptInterface fun saveBedtimeBlockedApps(j: String) = bedtime.saveBedtimeBlockedApps(j)
    @JavascriptInterface fun getBedtimeBlockedApps()           = bedtime.getBedtimeBlockedApps()
    @JavascriptInterface fun getBedtimeStreak()                = bedtime.getBedtimeStreak()
    @JavascriptInterface fun getBedtimeLastNightStats()        = bedtime.getBedtimeLastNightStats()
    @JavascriptInterface fun getBedtimeWeekDays()              = bedtime.getBedtimeWeekDays()
    @JavascriptInterface fun scheduleBedtimeAlarms(bH:Int,bM:Int,wH:Int,wM:Int,wd:Boolean) = bedtime.scheduleBedtimeAlarms(bH,bM,wH,wM,wd)
    @JavascriptInterface fun cancelBedtimeAlarms()             = bedtime.cancelBedtimeAlarms()
    @JavascriptInterface fun startBedtimeBlock(apps: String)   = bedtime.startBedtimeBlock(apps)
    @JavascriptInterface fun updateBedtimeBlock(apps: String)  = bedtime.updateBedtimeBlock(apps)
    @JavascriptInterface fun stopBedtimeBlock()                = bedtime.stopBedtimeBlock()
    @JavascriptInterface fun isBedtimeBlockActive()            = bedtime.isBedtimeBlockActive()
    @JavascriptInterface fun isInBedtimeWindow()               = bedtime.isInBedtimeWindow()
    @JavascriptInterface fun snoozeBedtime(mins: Int)          = bedtime.snoozeBedtime(mins)
    @JavascriptInterface fun recordBedtimeOff()                = bedtime.recordBedtimeOff()
    @JavascriptInterface fun getBedtimeSnoozeEndsAt()          = bedtime.getBedtimeSnoozeEndsAt()
    @JavascriptInterface fun setBedtimeDnd(enable: Boolean)    = bedtime.setBedtimeDnd(enable)
    @JavascriptInterface fun isDndPolicyGranted()              = bedtime.isDndPolicyGranted()
    @JavascriptInterface fun setBedtimeGrayscale(enable:Boolean)= bedtime.setBedtimeGrayscale(enable)
    // ── Screen Filter delegations ──────────────────────────────────────────────
    @JavascriptInterface fun getScreenFilterSettings()             = bedtime.getScreenFilterSettings()
    @JavascriptInterface fun saveScreenFilterSettings(j: String)   = bedtime.saveScreenFilterSettings(j)
    @JavascriptInterface fun applyScreenFilter(w: Int, d: Int, gradual: Boolean = false) = bedtime.applyScreenFilter(w, d, gradual)
    @JavascriptInterface fun removeScreenFilter()                   = bedtime.removeScreenFilter()
    @JavascriptInterface fun isScreenFilterActive()                = bedtime.isScreenFilterActive()
    // startScreenFilterSchedule / stopScreenFilterSchedule are called by the JS
    // schedule engine for sun-based and custom-time modes (Pro). In v1 the filter
    // is started/stopped by BedtimeReceiver alarms, so these are no-ops that keep
    // the JS bridge calls safe without throwing. Implement scheduling logic here in v2.
    @JavascriptInterface fun startScreenFilterSchedule(json: String) = bedtime.startScreenFilterSchedule(json)
    @JavascriptInterface fun stopScreenFilterSchedule()              = bedtime.stopScreenFilterSchedule()
    /** Reverse-geocodes lat/lon to a city name via Android Geocoder for the sun-schedule label. */
    @JavascriptInterface fun reverseGeocodeCity(lat: Double, lon: Double): String = bedtime.reverseGeocodeCity(lat, lon)

    // ── Notifications ──────────────────────────────────────────────────────
    @JavascriptInterface fun getNotifications()                = notification.getNotifications()
    @JavascriptInterface fun refreshNotifications()            = notification.refreshNotifications()
    @JavascriptInterface fun cancelAllNotifications()          = notification.cancelAllNotifications()
    @JavascriptInterface fun scheduleBackgroundNotifications() = notification.scheduleBackgroundNotifications()
    @JavascriptInterface fun postSmartAlertNotifications()     = notification.postSmartAlertNotifications()
    @JavascriptInterface fun postInAppNotificationsToSystem()  = notification.postInAppNotificationsToSystem()

    // ── Widget ─────────────────────────────────────────────────────────────
    @JavascriptInterface fun getWidgetTheme()                  = widget.getWidgetTheme()
    @JavascriptInterface fun setWidgetTheme(key: String)       = widget.setWidgetTheme(key)
    @JavascriptInterface fun getWidgetThemes()                 = widget.getWidgetThemes()
    @JavascriptInterface fun getWidgetApps()                   = widget.getWidgetApps()
    @JavascriptInterface fun getRoutineSummary()               = widget.getRoutineSummary()
    @JavascriptInterface fun getRoutineSummaryForDay(d: Int)   = widget.getRoutineSummaryForDay(d)
    @JavascriptInterface fun getWidgetStorageStats()           = widget.getWidgetStorageStats()
    @JavascriptInterface fun clearWidgetHistory()              = widget.clearWidgetHistory()
    @JavascriptInterface fun getWidgetLearningDays()           = widget.getWidgetLearningDays()
    @JavascriptInterface fun getWidgetLearningDaysForDay(d:Int)= widget.getWidgetLearningDaysForDay(d)
    @JavascriptInterface fun refreshWidgets()                  = widget.refreshWidgets()
    @JavascriptInterface fun setWidgetInsightEnabled(e:Boolean)= widget.setWidgetInsightEnabled(e)
    @JavascriptInterface fun recordAppLaunch(pkg: String)      = widget.recordAppLaunch(pkg)
    @JavascriptInterface fun requestPinWidget()                = widget.requestPinWidget()
    @JavascriptInterface fun canPinWidget()                    = widget.canPinWidget()
    @JavascriptInterface fun isWidgetAdded()                   = widget.isWidgetAdded()

    // ── Share ──────────────────────────────────────────────────────────────
    @JavascriptInterface fun shareText(text: String)           = share.shareText(text)
    @JavascriptInterface fun shareImage(b64:String,fn:String)  = share.shareImage(b64,fn)
    @JavascriptInterface fun saveImageToGallery(b64:String,fn:String) = share.saveImageToGallery(b64,fn)
    @JavascriptInterface fun shareImageWithText(b64:String,fn:String,txt:String) = share.shareImageWithText(b64,fn,txt)

    // ── Billing ────────────────────────────────────────────────────────────
    @JavascriptInterface fun isProUser()                       = billing.isProUser()
    @JavascriptInterface fun setProUser(isPro: Boolean)        = billing.setProUser(isPro)
    @JavascriptInterface fun getProStatus()                    = billing.getProStatus()
    @JavascriptInterface fun getProPricing()                   = billing.getProPricing()
    @JavascriptInterface fun launchBillingFlow(plan: String)   = billing.launchBillingFlow(plan)
    @JavascriptInterface fun restorePurchase()                 = billing.restorePurchase()

    // ── Health Connect ─────────────────────────────────────────────────────
    @JavascriptInterface fun getHCStatus()                     = healthConnect.getHCStatus()
    @JavascriptInterface fun getHCData()                       = healthConnect.getHCData()
    @JavascriptInterface fun requestHCPermissions()            = healthConnect.requestHCPermissions()
    @JavascriptInterface fun disconnectHC()                    = healthConnect.disconnectHC()
    @JavascriptInterface fun syncHCData()                      = healthConnect.syncHCData()
    @JavascriptInterface fun getHCBodyScore()                  = healthConnect.getHCBodyScore()
    @JavascriptInterface fun getHCActivityModifier()           = healthConnect.getHCActivityModifier()
    @JavascriptInterface fun getHCSleepData()                  = healthConnect.getHCSleepData()
    @JavascriptInterface fun getHCUsageSummary()               = healthConnect.getHCUsageSummary()
    @JavascriptInterface fun openHCPlayStore()                 = healthConnect.openHCPlayStore()

    // ── Aurelo Coach ───────────────────────────────────────────────────────
    @JavascriptInterface fun getCoachQueryCount()                              = coach.getCoachQueryCount()
    @JavascriptInterface fun incrementCoachQueryCount()                        = coach.incrementCoachQueryCount()
    @JavascriptInterface fun getDailyCoachInsight()                            = coach.getDailyCoachInsight()
    @JavascriptInterface fun getCoachChips()                                   = coach.getCoachChips()
    @JavascriptInterface fun askCoach(query: String)                           = coach.askCoach(query)
    @JavascriptInterface fun getTabCoachInsight(tab: String, ctx: String)      = coach.getTabCoachInsight(tab, ctx)
    @JavascriptInterface fun getCoachInsightDismissed()                        = coach.getCoachInsightDismissed()
    @JavascriptInterface fun setCoachInsightDismissed()                        = coach.setCoachInsightDismissed()

    // ── Referral ────────────────────────────────────────────────────────────
    @JavascriptInterface fun getReferralLink()                                 = referral.getReferralLink()
    @JavascriptInterface fun getReferralCode()                                 = referral.getReferralCode()
    @JavascriptInterface fun getReferralStats()                                = referral.getReferralStats()
    @JavascriptInterface fun recordReferralShare()                             = referral.recordReferralShare()
    // BUG-05 FIX: Kotlin default parameters do NOT generate a JVM no-arg overload on
    // @JavascriptInterface methods. A JS call with no argument fails silently (unresolved
    // method). Explicit two-overload pattern guarantees both call sites work.
    @JavascriptInterface fun recordReferralInstall()                           = referral.recordReferralInstall("")
    @JavascriptInterface fun recordReferralInstall(friendCode: String)         = referral.recordReferralInstall(friendCode)
    @JavascriptInterface fun recordReferralConversion(plan: String)            = referral.recordReferralConversion(plan)
    @JavascriptInterface fun getReferralBonusDays()                           = referral.getReferralBonusDays()
    @JavascriptInterface fun wasReferred()                                     = referral.wasReferred()
    @JavascriptInterface fun isExtensionActive()                               = referral.isExtensionActive()
    @JavascriptInterface fun getExtensionDaysRemaining()                       = referral.getExtensionDaysRemaining()
    @JavascriptInterface fun getPendingExtensionDays()                         = referral.getPendingExtensionDays()

    /**
     * handleProDowngrade — called by pro-gate.js (JS side) when the Pro
     * subscription has expired or been revoked.
     *
     * Also called natively from AppBridge's billing listener when the billing
     * detection path (onProStatusChanged false) fires and no referral extension
     * is active — this ensures cleanup runs even if the WebView is not ready or
     * JS wasPro is already false (cold-start race after offline expiry).
     *
     * Resets native-side Pro features to free-tier defaults:
     *   • Widget theme → DEFAULT (free)
     *   • Bedtime alarms cancelled, active block stopped, DND cleared
     *   • Health Connect disconnected (permissions revoked, cache cleared)
     *   • All Focus Routine alarms cancelled
     *   • Locked apps trimmed to FREE_LIMIT (3)
     *   • Hidden apps trimmed to FREE_LIMIT (3)
     *   • Mindful-pause (intention) apps trimmed to FREE_LIMIT (3)
     *   • App timers trimmed to FREE_LIMIT (3)
     *   • Focus blocked apps trimmed to FREE_LIMIT (3)
     *   • Screen filter schedule reset to 'none', excluded apps trimmed to FREE_LIMIT (3)
     *
     * This method is idempotent — safe to call multiple times. Every step is
     * individually try-caught so a failure in one area does not prevent the rest.
     */
    @JavascriptInterface
    fun handleProDowngrade() {
        val FREE_LIMIT = 3

        // 1. Widget theme → DEFAULT
        try {
            WidgetThemeManager.setTheme(context, WidgetTheme.DEFAULT)
        } catch (e: Exception) {
            android.util.Log.w("AureloDowngrade", "Widget theme reset failed: ${e.message}")
        }

        // 2. Bedtime — cancel alarms, stop block, clear DND
        try { bedtime.cancelBedtimeAlarms() }  catch (e: Exception) { android.util.Log.w("AureloDowngrade", "cancelBedtimeAlarms: ${e.message}") }
        try { bedtime.stopBedtimeBlock() }      catch (e: Exception) { android.util.Log.w("AureloDowngrade", "stopBedtimeBlock: ${e.message}") }
        try { bedtime.setBedtimeDnd(false) }    catch (e: Exception) { android.util.Log.w("AureloDowngrade", "setBedtimeDnd: ${e.message}") }
        // Persist disabled state into bedtime settings
        try {
            val json = bedtime.getBedtimeSettings()
            val obj  = org.json.JSONObject(if (json.isNullOrBlank()) "{}" else json)
            obj.put("enabled", false)
            bedtime.saveBedtimeSettings(obj.toString())
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "saveBedtimeSettings: ${e.message}") }

        // 3. Health Connect — revoke permissions and clear cached data
        try { healthConnect.disconnectHC() } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "disconnectHC: ${e.message}") }

        // 4. Focus Routines — cancel all alarms and disable every routine
        try {
            val routinesJson = focusRoutine.getFocusRoutines()
            val arr = org.json.JSONArray(if (routinesJson.isNullOrBlank()) "[]" else routinesJson)
            for (i in 0 until arr.length()) {
                val r = arr.getJSONObject(i)
                val id = r.optString("id", "")
                if (id.isNotBlank()) {
                    try { focusRoutine.cancelRoutineAlarm(id) } catch (_: Exception) {}
                }
                r.put("enabled", false)
            }
            focusRoutine.saveFocusRoutines(arr.toString())
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "cancelRoutines: ${e.message}") }

        // 5. Locked apps — trim to FREE_LIMIT
        try {
            val lockedJson = appManagement.getLockedApps()
            val arr = org.json.JSONArray(if (lockedJson.isNullOrBlank()) "[]" else lockedJson)
            if (arr.length() > FREE_LIMIT) {
                val trimmed = org.json.JSONArray()
                for (i in 0 until FREE_LIMIT) trimmed.put(arr.get(i))
                appManagement.setLockedApps(trimmed.toString())
            }
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "trimLockedApps: ${e.message}") }

        // 6. Hidden apps — trim to FREE_LIMIT
        try {
            val hiddenJson = appManagement.getHiddenApps()
            val arr = org.json.JSONArray(if (hiddenJson.isNullOrBlank()) "[]" else hiddenJson)
            if (arr.length() > FREE_LIMIT) {
                val trimmed = org.json.JSONArray()
                for (i in 0 until FREE_LIMIT) trimmed.put(arr.get(i))
                appManagement.setHiddenApps(trimmed.toString())
            }
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "trimHiddenApps: ${e.message}") }

        // 7. Mindful-pause (intention) apps — trim to FREE_LIMIT
        try {
            val intentionJson = prefs.getString(KEY_INTENTION_APPS, "[]") ?: "[]"
            val arr = org.json.JSONArray(if (intentionJson.isBlank()) "[]" else intentionJson)
            if (arr.length() > FREE_LIMIT) {
                val trimmed = org.json.JSONArray()
                for (i in 0 until FREE_LIMIT) trimmed.put(arr.get(i))
                prefs.edit().putString(KEY_INTENTION_APPS, trimmed.toString()).apply()
                // Notify AppMonitorService that intention app list changed
                try {
                    context.sendBroadcast(
                        android.content.Intent("${context.packageName}.INTENTION_APPS_CHANGED")
                    )
                } catch (_: Exception) {}
            }
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "trimIntentionApps: ${e.message}") }

        // 8. App timers — trim to FREE_LIMIT (stored as JSONObject pkg→mins in securePrefs)
        try {
            val timersJson = securePrefs.getString(APP_LIMITS_V5, "{}") ?: "{}"
            val obj = org.json.JSONObject(if (timersJson.isBlank()) "{}" else timersJson)
            if (obj.length() > FREE_LIMIT) {
                val trimmed = org.json.JSONObject()
                var count = 0
                val keys = obj.keys()
                while (keys.hasNext() && count < FREE_LIMIT) {
                    val key = keys.next()
                    trimmed.put(key, obj.getInt(key))
                    count++
                }
                securePrefs.edit().putString(APP_LIMITS_V5, trimmed.toString()).apply()
            }
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "trimTimerApps: ${e.message}") }

        // 9. Focus blocked apps — trim to FREE_LIMIT (stored as JSONArray in prefs)
        try {
            val blockedJson = prefs.getString(KEY_FOCUS_BLOCKED_APPS, "[]") ?: "[]"
            val arr = org.json.JSONArray(if (blockedJson.isBlank()) "[]" else blockedJson)
            if (arr.length() > FREE_LIMIT) {
                val trimmed = org.json.JSONArray()
                for (i in 0 until FREE_LIMIT) trimmed.put(arr.get(i))
                prefs.edit().putString(KEY_FOCUS_BLOCKED_APPS, trimmed.toString()).apply()
            }
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "trimFocusBlockedApps: ${e.message}") }

        // 10. Screen Filter — reset schedule to 'none' and trim excludedApps to FREE_LIMIT.
        //     Bug 1 fix: 'sun' / 'custom' schedule modes are Pro-only; a downgraded user
        //     must fall back to 'none' (Manual / Always On) so the radio button does not
        //     remain stuck on a Pro selection in the UI.
        //     Bug 2 fix: excludedApps must be capped at FREE_LIMIT to match every other
        //     app-list feature that enforces the 3-item ceiling on the free tier.
        try {
            val sfJson = bedtime.getScreenFilterSettings()
            val sfObj  = org.json.JSONObject(if (sfJson.isNullOrBlank()) "{}" else sfJson)
            // Reset schedule
            sfObj.put("schedule", "none")
            // Trim excluded apps (non-camera only; camera is always auto-excluded)
            val excludedArr = sfObj.optJSONArray("excludedApps")
            if (excludedArr != null && excludedArr.length() > FREE_LIMIT) {
                val trimmed = org.json.JSONArray()
                for (i in 0 until FREE_LIMIT) trimmed.put(excludedArr.get(i))
                sfObj.put("excludedApps", trimmed)
            }
            bedtime.saveScreenFilterSettings(sfObj.toString())
        } catch (e: Exception) { android.util.Log.w("AureloDowngrade", "resetScreenFilterOnDowngrade: ${e.message}") }

        android.util.Log.i("AureloDowngrade", "Pro downgrade cleanup complete")
    }
}