package com.javikastudio.tidyapp

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import androidx.activity.OnBackPressedCallback
import kotlinx.coroutines.launch
import com.google.android.play.core.review.ReviewManagerFactory

class MainActivity : AppCompatActivity() {

    internal lateinit var webView: WebView
    private lateinit var bridge: AppBridge
    @Volatile private var scanDone = false

    companion object {
        const val ACTION_WIDGET_PLACED = "com.javikastudio.tidyapp.WIDGET_FIRST_PLACED"
    }

    // Background executor for periodic usage scans — keeps caches warm
    // so JS calls are instant (reads from SharedPrefs, no live queryEvents)
    private lateinit var bgExecutor: ScheduledExecutorService

    // Listens for app installs/uninstalls and triggers a re-scan
    // Fired by AureloWidgetProvider.onEnabled() the first time the widget is placed.
    // Prompts for battery optimisation exemption at the right moment — user has just
    // added the widget, so they understand why reliable background access matters.
    // Never fires during onboarding because the widget hasn't been placed yet.
    private val widgetPlacedReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action != ACTION_WIDGET_PLACED) return
            if (!::bridge.isInitialized) return
            if (bridge.isBatteryOptimizationExempt()) return
            webView.post {
                webView.evaluateJavascript(
                    "if(typeof window.showBatteryOptPrompt==='function')" +
                            " window.showBatteryOptPrompt();" +
                            " else AppBridge.requestBatteryOptimizationExempt();",
                    null
                )
            }
        }
    }

    private val packageReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val pkg = intent.data?.schemeSpecificPart ?: return
            // FUN-12 FIX: PACKAGE_REPLACED fires for every GMS/system framework update,
            // triggering an expensive preScan on each. Skip if it's a system package
            // the user would never see in Aurelo's app list.
            if (intent.action == Intent.ACTION_PACKAGE_REPLACED) {
                try {
                    val info = packageManager.getApplicationInfo(pkg, 0)
                    val isSystem = (info.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0
                    val isUpdatedSystem = (info.flags and android.content.pm.ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
                    // Only rescan if it's a pure user-installed app (not a system component)
                    if (isSystem && !isUpdatedSystem) return
                } catch (_: Exception) { return }
            }
            bridge.bridgeScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                // When an app is added/removed, we DO need a full preScan (app list changed)
                bridge.preScan()
                scanDone = true
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    // BUG-08 FIX: jsString() JSON-encodes and quotes both values so a
                    // crafted broadcast action cannot inject arbitrary JavaScript.
                    webView.evaluateJavascript(
                        "if(typeof window.onAppsChanged==='function') window.onAppsChanged(${jsString(intent.action ?: "")},${jsString(pkg)})", null
                    )
                }
                // uses the pkg already resolved above
                if (intent.action == Intent.ACTION_PACKAGE_REMOVED) {
                    bridge.clearCatCacheEntry(pkg)
                }

                if (intent.action != Intent.ACTION_PACKAGE_REMOVED) {
                    // PERF-02 FIX: already on bridgeScope IO dispatcher — no nested scope needed
                    bridge.playFetcher.invalidate(pkg)   // force re-fetch even if cached
                    bridge.playFetcher.syncAll(listOf(pkg))
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Full-screen colours — set before setContentView so they apply to the first frame
        window.statusBarColor     = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        // NOTE: BUG-07 fullscreen/insets setup is applied AFTER setContentView() below,
        // because WindowInsetsController requires the DecorView to be attached first.

        webView = WebView(this).apply {
            settings.apply {
                javaScriptEnabled      = true
                domStorageEnabled      = true
                databaseEnabled        = true
                // SEC-06 FIX: disallow JS from reading local files via file:// URIs.
                // index.html is loaded from assets (file:///android_asset/) which still works;
                // only cross-origin file:// access is blocked.
                allowFileAccess        = false
                setSupportZoom(false)
                useWideViewPort        = true
                loadWithOverviewMode   = true
                // SEC-05 FIX: COMPATIBILITY_MODE silently allows mixed HTTP content.
                // NEVER_ALLOW blocks all HTTP sub-resources to prevent data leakage.
                mixedContentMode       = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode              = WebSettings.LOAD_DEFAULT
                // A11Y-01 FIX: textZoom=100 override REMOVED.
                // Previously suppressed system font-scale (85–200%) which blocked
                // Accessibility > Font Size for visually impaired users (WCAG 1.4.4).
                // CSS layouts now use flexible units (var(--text-*) tokens) instead
                // of fixed px, so they accommodate system font scaling correctly.
            }
        }
        // ISSUE-06 FIX: MobileAds.initialize() triggers GMS IPC and can block ~400ms on first
        // run. Move to a background thread so it doesn't delay WebView load.
        // thread { com.google.android.gms.ads.MobileAds.initialize(this) }
        setContentView(webView)

        // BUG-07 FIX: SYSTEM_UI_FLAG_* removed in API 35 (Android 15).
        // CRASH FIX: window.insetsController is only non-null AFTER setContentView() attaches
        // the DecorView. Moving it before setContentView() caused a NullPointerException
        // (crash log: "Attempt to invoke virtual method on a null object reference" at line 60).
        // decorView.post{} defers one frame as an extra safety net on any device where
        // the controller is still initialising synchronously.
        // UI-05 FIX: setDecorFitsSystemWindows is backwards-compatible via androidx.core
        // and must be called on ALL API levels (21+) to enable edge-to-edge correctly.
        // Previously it was inside the API >= R branch, so Android 10 (API 29) devices
        // got a coloured strip at the top/bottom instead of true edge-to-edge.
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.decorView.post {
                window.insetsController?.let { ctrl ->
                    ctrl.hide(android.view.WindowInsets.Type.statusBars())
                    ctrl.systemBarsBehavior =
                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                }
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE          or
                            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN      or
                            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                            View.SYSTEM_UI_FLAG_FULLSCREEN
                    )
        }

        bridge = AppBridge(this, webView)
        webView.addJavascriptInterface(bridge, "AppBridge")

        // ── Health Connect permission launcher ───────────────────────────────
        // Health Connect permissions (android.permission.health.*) are NOT
        // standard Android runtime permissions on any API level — they are
        // managed exclusively by the HC SDK's PermissionController contract.
        //
        // Using ActivityResultContracts.RequestMultiplePermissions() for HC
        // permissions is incorrect on ALL API levels including Android 14+:
        // the OS sees unfamiliar permission strings, skips any dialog, and
        // immediately returns an empty granted map — which was causing the
        // spurious "permanently denied" state on first connect.
        //
        // The PermissionController contract works correctly on API 28–34+:
        //   • API 28–33: drives the HC app's custom permission sheet
        //   • API 34+  : drives the built-in OS Health Connect permission UI
        //
        // Android 8.x (API 26–27): HC is not supported; launcher is never invoked.
        bridge.healthConnect.manager.permissionLauncher =
            registerForActivityResult(
                androidx.health.connect.client.PermissionController
                    .createRequestPermissionResultContract()
            ) { granted: Set<String> ->
                bridge.healthConnect.onPermissionsResult(granted)
            }

        // Schedule background notifications immediately so the WorkManager
        // periodic task exists even before the WebView finishes loading.
        // JS also calls scheduleBackgroundNotifications() on init as a second
        // safety net; ExistingPeriodicWorkPolicy.KEEP makes both calls idempotent.
        bridge.scheduleBackgroundNotifications()
        // Schedule background widget refresh (15-min WorkManager task, runs even when app is closed)
        AureloWidgetUpdateWorker.schedule(this)
        // Schedule daily Coach insight notification (Aurelo Coach Phase 1 — spec §18.1)
        CoachInsightWorker.schedule(this)

        // SEC-03 FIX: NativeBridge removed — it exposed uninstallAppDirect() with no
        // package validation, allowing any JS to uninstall any app silently.
        // Uninstall is now handled exclusively through AppBridge.uninstallApp()
        // which validates the package name before issuing the system intent.

        // ── Modern Back Navigation ──────────────────────────────────────────
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(typeof window.onBackPressed === 'function' && window.onBackPressed()) || false"
                ) { result ->
                    if (result != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                // Hide error overlay if a reload succeeds
                errorView?.visibility = View.GONE
                runOnUiThread {
                    // FIX-02: Hourly chart bar — move hour label below the bar column.
                    // The weekly chart already renders day labels (Mon/Tue…) below each bar
                    // using flex-direction:column. Hourly bars were rendered with the label
                    // inside or above the bar. This CSS sets the same column layout so the
                    // numeric hour label (0–23) sits beneath its bar, matching the weekly view.
                    val hourlyLabelCss = """
                        (function(){
                          var s=document.createElement('style');
                          s.textContent='.hr-bar-wrap{display:flex;flex-direction:column;align-items:center}'
                            +'.hr-bar-col{display:flex;flex-direction:column-reverse;align-items:center}'
                            +'.hr-lbl{order:2;margin-top:3px;margin-bottom:0}'
                            +'.hr-bar{order:1}';
                          document.head.appendChild(s);
                        })();
                    """.trimIndent()
                    view.evaluateJavascript(hourlyLabelCss, null)

                    view.evaluateJavascript(
                        "if(typeof window.onPageReady==='function') window.onPageReady($scanDone)", null
                    )
                    // Handle widget deep-link on cold start (page wasn't ready at onCreate time)
                    handleWidgetIntent(intent)
                }
            }

            // ISSUE-04 FIX: Show a native error view if the HTML asset fails to load
            // (e.g. APK extraction failure on some OEM devices). Without this the user
            // sees a permanent blank white screen with no recovery path.
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.url.scheme == "app-icon") return   // icon errors are always silent
                if (!request.isForMainFrame) return            // sub-resource errors are non-fatal
                super.onReceivedError(view, request, error)
                runOnUiThread { showNativeErrorView() }
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.url.scheme == "app-icon") {
                    val pkg = request.url.host ?: return null
                    return bridge.serveIcon(pkg)
                }
                return super.shouldInterceptRequest(view, request)
            }
        }

        webView.loadUrl("file:///android_asset/www/index.html")

        bridge.bridgeScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            // PERF-02 FIX: bridgeScope is lifecycle-aware and cancelled in onDestroy(),
            // preventing the Activity/WebView reference from leaking on config changes.
            // Initial load requires a full scan
            bridge.preScan()
            scanDone = true
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                webView.evaluateJavascript(
                    "if(typeof window.onScanComplete==='function') window.onScanComplete()", null
                )
            }
        }

        // Watch for app installs and uninstalls
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REPLACED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addDataScheme("package")
        }
        registerReceiver(packageReceiver, filter)

        // Battery optimisation prompt — triggered when user places the widget
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(widgetPlacedReceiver, IntentFilter(ACTION_WIDGET_PLACED),
                Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(widgetPlacedReceiver, IntentFilter(ACTION_WIDGET_PLACED))
        }

        // ── Periodic background usage refresh ──────────────────────────────
        // PERF-04 FIX: bgExecutor is now started/stopped in onResume()/onPause()
        // so it only runs while the app is in the foreground. Initial start happens
        // via onResume() which is always called after onCreate().
    }

    // BUG-01 FIX: onPause() was completely missing.
    // Without it the WebView's JavaScript, timers, and canvas animations kept running
    // in the background whenever another app came to the foreground — wasting CPU/battery.
    override fun onPause() {
        super.onPause()
        webView.onPause()
        webView.pauseTimers()
        // PERF-04 FIX: pause background usage refresh while app is not visible.
        // Stats updates are invisible to the user when backgrounded; this reduces
        // unnecessary CPU wakeups during foreground service monitoring.
        if (::bgExecutor.isInitialized && !bgExecutor.isShutdown) {
            bgExecutor.shutdownNow()
        }
    }

    override fun onResume() {
        super.onResume()
        bridge.notifyForeground()
        bridge.healthConnect.refreshOnForeground()   // refresh HC cache on resume
        webView.onResume()
        webView.resumeTimers()

        // PERF-04 FIX: restart the background usage refresh that was paused in onPause().
        if (!::bgExecutor.isInitialized || bgExecutor.isShutdown || bgExecutor.isTerminated) {
            bgExecutor = Executors.newSingleThreadScheduledExecutor { r ->
                Thread(r, "aurelo-usage-refresh").also { it.isDaemon = true }
            }
            bgExecutor.scheduleWithFixedDelay({
                try {
                    bridge.refreshUsageStats()
                    runOnUiThread {
                        webView.evaluateJavascript(
                            "if(typeof window.onBgScanComplete==='function') window.onBgScanComplete()", null
                        )
                    }
                } catch (_: Exception) {}
            }, 10L, 10L, TimeUnit.SECONDS)
        }

        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onAppResume==='function') window.onAppResume()", null
            )
            // Check for a routine that fired while the app was backgrounded
            consumePendingRoutineIntent()
            // COMPAT-01 FIX: check exact alarm permission on resume — show banner in JS if missing
            checkExactAlarmPermission()
        }
    }

    // COMPAT-01 FIX: On API 31+, SCHEDULE_EXACT_ALARM can be revoked by the user.
    // Call this on every resume so the JS layer can show an in-app banner if needed.
    private fun checkExactAlarmPermission() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return
        val am = getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
        if (!am.canScheduleExactAlarms()) {
            webView.evaluateJavascript(
                "if(typeof window.onExactAlarmPermissionMissing==='function') window.onExactAlarmPermissionMissing()",
                null
            )
        }
    }

    private fun consumePendingRoutineIntent() {
        val pendingRoutine = intent?.getStringExtra("pending_routine_json")
        if (pendingRoutine.isNullOrBlank()) return

        // FIX 3 (double-start): consume the extras immediately so a subsequent
        // onResume() call (e.g. from a config change) cannot re-fire the same trigger.
        intent.removeExtra("pending_routine_json")
        val sessionAlreadyActive = intent?.getBooleanExtra("session_already_active", false) == true
        intent.removeExtra("session_already_active")

        if (sessionAlreadyActive) {
            // The service started the session in the background — the prefs now reflect
            // an active session.  JS _syncSessionState() will pick it up via onAppResume.
            // We only need to navigate to the focus tab so the user sees the active ring.
            webView.post {
                webView.evaluateJavascript(
                    "if(typeof activateTab==='function') activateTab('focus')", null
                )
            }
            return
        }

        // FIX 3 (double-start): check prefs directly — if the service already started the
        // session while the app was backgrounded (and prefs were correctly written by the
        // fixed startFocusServiceDirectly()), skip re-triggering onRoutineTriggered().
        val prefs = getSharedPreferences(RoutineAlarmReceiver.PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_FOCUS_ACTIVE, false)) {
            webView.post {
                webView.evaluateJavascript(
                    "if(typeof activateTab==='function') activateTab('focus')", null
                )
            }
            return
        }

        // Session not yet running — let JS handle it (app was foregrounded before service started,
        // or this is a pre-session notification tap that should open the routine dialog).
        val escaped = pendingRoutine.replace("\\", "\\\\").replace("'", "\\'")
        webView.post {
            webView.evaluateJavascript("onRoutineTriggered('$escaped')", null)
        }
    }

    /**
     * Launches the native Play Store In-App Review dialog.
     * Called by AppBridge.checkAndTriggerRateApp() once all conditions are met.
     * ReviewManager handles its own throttling on top of ours — it may silently
     * no-op if the user has already rated or if Play's own quota is exceeded.
     * Must be called on the main thread.
     */
    fun triggerInAppReview() {
        val manager = ReviewManagerFactory.create(this)
        manager.requestReviewFlow().addOnCompleteListener { request ->
            if (request.isSuccessful) {
                manager.launchReviewFlow(this, request.result)
                    .addOnCompleteListener { /* flow finished — success or silently skipped */ }
            }
            // If request fails we do nothing — Play handles the fallback silently
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(packageReceiver)
        runCatching { unregisterReceiver(widgetPlacedReceiver) }
        if (::bgExecutor.isInitialized) bgExecutor.shutdownNow()
        if (::bridge.isInitialized) bridge.destroy()
    }

    // PERF-05 FIX: Release WebView cache when the OS signals memory pressure.
    // Without this the app gives the OS nothing to reclaim gracefully on low-RAM
    // devices (2–3 GB), causing abrupt process kill and loss of unsaved state.
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
            if (::webView.isInitialized) webView.clearCache(false)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 9001) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
            webView.post {
                webView.evaluateJavascript(
                    "if(typeof window.onNotifPermResult==='function') window.onNotifPermResult($granted)", null
                )
            }
        }
    }

    // BUG-08 FIX: Escape package name and intent action before embedding in JS string literals.
    // Raw string interpolation allows a crafted broadcast to inject arbitrary JavaScript.
    private fun jsString(s: String): String =
        org.json.JSONObject.quote(s)  // wraps in quotes and escapes all special chars

    // ISSUE-04 FIX: Displayed when file:///android_asset/www/index.html fails to load.
    // Inflated lazily the first time an error occurs.
    private var errorView: android.widget.TextView? = null
    private fun showNativeErrorView() {
        if (errorView == null) {
            errorView = android.widget.TextView(this).apply {
                text = "Aurelo couldn't load.\nTap to try again."
                textSize = 16f
                gravity = android.view.Gravity.CENTER
                setTextColor(android.graphics.Color.WHITE)
                setBackgroundColor(android.graphics.Color.parseColor("#1A1A2E"))
                setOnClickListener {
                    visibility = View.GONE
                    webView.reload()
                }
            }
            (webView.parent as? android.view.ViewGroup)?.addView(
                errorView,
                android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
        }
        errorView?.visibility = View.VISIBLE
    }

    // ── Widget deep-link routing ──────────────────────────────────────────────
    // Called when app is already running and widget fires FLAG_ACTIVITY_SINGLE_TOP
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleWidgetIntent(intent)
        // FIX 3: also handle routine notification taps when app is already open.
        // onResume() fires after onNewIntent() and will call consumePendingRoutineIntent()
        // which reads from this.intent — setIntent(intent) above ensures it reads the new one.
    }

    // Also called on cold start (intent is already set in onCreate via getIntent())
    private fun handleWidgetIntent(intent: Intent?) {
        val action = intent?.action ?: return
        val js = when (action) {
            AureloWidgetProvider.ACTION_OPEN_SEARCH   -> "if(typeof window.openSearchTab==='function') window.openSearchTab()"
            AureloWidgetProvider.ACTION_OPEN_HOME     -> "if(typeof window.openHomeTab==='function') window.openHomeTab()"
            AureloWidgetProvider.ACTION_OPEN_WELLNESS -> "if(typeof window.openWellnessTab==='function') window.openWellnessTab()"
            "com.javikastudio.tidyapp.WIDGET_PINNED" ->
                "if(typeof window.onWidgetPinned==='function') window.onWidgetPinned()"
            else -> return
        }
        // Clear the action immediately so subsequent onPageFinished calls (which also
        // read getIntent()) cannot re-fire the same callback. Without this, onNewIntent
        // sets the intent then onPageFinished fires again with the same intent —
        // producing a double toast for WIDGET_PINNED and double deep-link navigation.
        intent.action = null
        webView.post { webView.evaluateJavascript(js, null) }
    }
}