package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// HealthConnectBridge — @JavascriptInterface bridge exposing Health Connect
// data to the WebView layer. Follows the same pattern as BedtimeBridge,
// FocusSessionBridge, etc. Registered in AppBridge.kt.
//
// JS entry points consumed by app-health-connect.js:
//   AppBridge.getHCStatus()          → {status, connected, permGranted{…}}
//   AppBridge.getHCData()            → HCDailyData as JSON
//   AppBridge.requestHCPermissions() → triggers permission launcher
//   AppBridge.disconnectHC()         → revokes all HC permissions
//   AppBridge.syncHCData()           → force-read and cache fresh data
//   AppBridge.getHCBodyScore()       → Int (0-100 or -1)
//   AppBridge.getHCActivityModifier()→ {modifier, label, steps}
//   AppBridge.getHCSleepData()       → {durScore, oHrvScore, …}
//   AppBridge.getHCUsageSummary()    → merged UsageSummary JSON
//   AppBridge.openHCPlayStore()      → launches Play Store for HC app (API 26–33)
//   AppBridge.openHCSettings()       → opens HC system settings (API 34+) or Play Store
// ═══════════════════════════════════════════════════════════════════════════

import android.app.Activity
import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

class HealthConnectBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
) : AppBridgeController {

    internal val manager    = HealthConnectManager(context)
    private val repository  = HealthConnectRepository(manager)
    internal val summaryBuilder = UsageSummaryBuilder(context, prefs)

    // In-memory cache — refreshed by syncHCData() or on app foreground
    @Volatile private var _cachedData: HCDailyData = HCDailyData(isAvailable = false)

    // FIX (Issue 3): Reference to CoachBridge so we can invalidate tab insight caches
    // when HC connects/disconnects — preventing stale non-HC coach cards without restart.
    // Injected by AppBridge after both bridges are constructed.
    internal var coachBridge: CoachBridge? = null

    // ── Status ────────────────────────────────────────────────────────────────

    /**
     * Returns JSON:
     * { status: "AVAILABLE"|"NEEDS_INSTALL"|"NOT_SUPPORTED",
     *   connected: Boolean,  // true if HC connected and permission granted
     *   lastSyncTs: Long }
     */
    @JavascriptInterface
    fun getHCStatus(): String {
        val availability = manager.availability()
        val connected    = prefs.getString(HC_CONNECTED, "0") == "1"
        return JSONObject().apply {
            put("status",     availability.name)
            put("connected",  connected)
            put("lastSyncTs", _cachedData.lastSyncTs)
        }.toString()
    }

    // ── Data read ─────────────────────────────────────────────────────────────

    /**
     * Returns the cached HCDailyData as JSON matching the shape of _getMockData()
     * in app-health-connect.js so the JS layer needs no structural changes.
     */
    @JavascriptInterface
    fun getHCData(): String {
        val d = _cachedData
        return JSONObject().apply {
            put("available",        d.isAvailable)
            put("steps",            d.stepsToday)
            put("hrv",              d.hrvToday ?: JSONObject.NULL)
            put("restingHR",        d.restingHrToday ?: JSONObject.NULL)
            put("sleepDuration",    d.sleepDurationHours ?: JSONObject.NULL)
            put("overnightHrv",     d.overnightHrvMs ?: JSONObject.NULL)
            put("avgHrv7d",         d.avgHrv7d ?: JSONObject.NULL)
            put("avgRhr7d",         d.avgRhr7d ?: JSONObject.NULL)
            put("avgSteps7d",       d.avgSteps7d ?: JSONObject.NULL)  // BUG-02 FIX: was never serialized — JS always read null, causing the Body Score steps bar to always use the fixed 8,000 ceiling instead of the user's personal average
            put("avgOvernightHrv7d",d.avgOvernightHrv7d ?: JSONObject.NULL)
            put("lastSyncTs",       d.lastSyncTs)
            put("mindfulnessSessions", JSONArray().also { arr ->
                d.mindfulnessSessions.forEach { s ->
                    arr.put(JSONObject().apply {
                        put("app",      s.appLabel)
                        put("pkg",      s.appPackage)
                        put("type",     s.type)
                        put("duration", s.durationMinutes)
                        put("pts",      s.pts)
                    })
                }
            })
        }.toString()
    }

    // ── Scores delegated to calculator objects ────────────────────────────────
    /**
     * Internal accessor used by AureloScoreBridge to read HC data without going
     * through JSON serialization. Safe to call from any thread — _cachedData is
     * @Volatile and written atomically by refreshCachedData().
     */
    internal fun getCachedData(): HCDailyData = _cachedData



    /** Body pillar score 0–100, or -1 if HC not connected / data missing. */
    @JavascriptInterface
    fun getHCBodyScore(): Int = BodyScoreCalculator.compute(_cachedData)

    /**
     * Activity modifier for Screen Score.
     * Returns JSON: { modifier: Int, label: String|null, steps: Int }
     */
    @JavascriptInterface
    fun getHCActivityModifier(): String {
        val m = ScreenScoreEnhancer.modifier(_cachedData)
        return JSONObject().apply {
            put("modifier", m.modifier)
            put("label",    m.label ?: JSONObject.NULL)
            put("steps",    m.steps)
        }.toString()
    }

    /**
     * Enhanced sleep data for Sleep Score panel.
     * Returns JSON: { sleepDuration, overnightHrv, avgOHrv, durScore, oHrvScore }
     */
    @JavascriptInterface
    fun getHCSleepData(): String {
        val d = _cachedData
        if (!d.isAvailable) return JSONObject().put("available", false).toString()
        return JSONObject().apply {
            put("available",     true)
            put("sleepDuration", d.sleepDurationHours ?: JSONObject.NULL)
            put("overnightHrv",  d.overnightHrvMs     ?: JSONObject.NULL)
            put("avgOHrv",       d.avgOvernightHrv7d  ?: JSONObject.NULL)
            put("durScore",      SleepScoreEnhancer.sleepDurationScore(d) ?: JSONObject.NULL)
            put("oHrvScore",     SleepScoreEnhancer.overnightHrvScore(d)  ?: JSONObject.NULL)
        }.toString()
    }

    /**
     * F-14: Variant of getHCSleepData that filters the sleep session to only
     * those overlapping the user's configured bedtime window (bedHour–wakeHour).
     * Prevents afternoon naps from inflating the bedtime sleep duration component.
     *
     * If the cached data has no sleepSessionStart/End metadata (older data or
     * wearable types that don't track session timestamps), falls back to the
     * unfiltered getHCSleepData() so the score degrades gracefully.
     *
     * @param bedHour  decimal hour of bedtime (e.g. 22.5 = 10:30 PM)
     * @param wakeHour decimal hour of wake time (e.g. 7.0 = 7:00 AM)
     */
    @JavascriptInterface
    fun getHCSleepDataForWindow(bedHour: Double, wakeHour: Double): String {
        val d = _cachedData
        if (!d.isAvailable) return JSONObject().put("available", false).toString()

        // If the cached data carries session timing, filter by overlap with the window.
        // sleepSessionStartHour and sleepSessionEndHour are decimal hours (0-24 range).
        val sessionStart = d.sleepSessionStartHour
        val sessionEnd   = d.sleepSessionEndHour
        if (sessionStart != null && sessionEnd != null) {
            // Normalise overnight window: bedHour may be > wakeHour (e.g. 22 → 7)
            val windowSpansMidnight = bedHour > wakeHour
            val sessionSpansMidnight = sessionStart > sessionEnd
            // A session overlaps the window if they share any hour range.
            val overlaps = if (!windowSpansMidnight && !sessionSpansMidnight) {
                sessionStart < wakeHour && sessionEnd > bedHour
            } else {
                // At least one spans midnight — use complement logic
                !(sessionEnd <= bedHour && sessionStart >= wakeHour)
            }
            if (!overlaps) {
                // Session does not overlap bedtime window — return no duration data
                // but still include overnight HRV if available.
                return JSONObject().apply {
                    put("available",     true)
                    put("sleepDuration", JSONObject.NULL)   // filtered out
                    put("durScore",      JSONObject.NULL)
                    put("overnightHrv",  d.overnightHrvMs     ?: JSONObject.NULL)
                    put("avgOHrv",       d.avgOvernightHrv7d  ?: JSONObject.NULL)
                    put("oHrvScore",     SleepScoreEnhancer.overnightHrvScore(d)  ?: JSONObject.NULL)
                }.toString()
            }
        }
        // No session metadata or session overlaps — fall through to standard data
        return getHCSleepData()
    }

    /** Full merged UsageSummary as JSON — used by Coach JS pipeline. */
    @JavascriptInterface
    fun getHCUsageSummary(): String {
        val summary = summaryBuilder.build(_cachedData)
        return summaryBuilder.toJson(summary)
    }

    // ── Permission flow ───────────────────────────────────────────────────────

    /**
     * Triggers the HC permission launcher (registered in MainActivity).
     * Result arrives via [onPermissionsResult] callback then fires
     * `window.onHCPermissionsResult(granted: Boolean)` in the WebView.
     */
    @JavascriptInterface
    fun requestHCPermissions() {
        // ActivityResultLauncher.launch() must be called on the main/UI thread.
        // @JavascriptInterface methods run on a background JS thread, so posting
        // to the main thread via runOnUiThread() is required to avoid a silent
        // failure (the permission dialog simply never appears).
        (context as? Activity)?.runOnUiThread {
            manager.requestPermissionsForFeature(HCFeature.ALL)
        } ?: manager.requestPermissionsForFeature(HCFeature.ALL)
    }

    /** Called by MainActivity's ActivityResultLauncher callback. */
    fun onPermissionsResult(granted: Set<String>) {
        // Issue 2 fix: use manager.allPermissions which is now device-aware —
        // READ_MINDFULNESS is only included on API 35+ where the HC SDK supports it.
        // On older devices the permission sheet never shows it, so it would never appear
        // in `granted`, making containsAll() always false despite everything being granted.
        val required    = manager.allPermissions
        val missing     = required - granted
        val allGranted  = missing.isEmpty()

        Log.d("HC_DEBUG", "Required:  ${required.joinToString()}")
        Log.d("HC_DEBUG", "Granted:   ${granted.joinToString()}")
        Log.d("HC_DEBUG", "Missing:   ${missing.joinToString()}")

        if (allGranted) {
            prefs.edit().putString(HC_CONNECTED, "1").apply()
            // Immediately fetch fresh data so the UI can update without waiting.
            // FIX (Issue 3): also invalidate ALL tab insight caches (today/week/month/home)
            // after connecting so that coach cards on every tab regenerate with the new
            // HC data immediately — without requiring an app restart.
            syncInBackground { fresh ->
                _cachedData = fresh
                val bodyScore = BodyScoreCalculator.compute(fresh)
                // Invalidate cached tab insights so the next tab visit re-generates
                // with HC-aware data (Body Score pillar now active, HC signals fed in).
                coachBridge?.clearTabInsightCache()
                webView.post {
                    webView.evaluateJavascript(
                        "if(typeof window.onHCPermissionsResult==='function') " +
                                "window.onHCPermissionsResult(true, $bodyScore, false, '[]')",
                        null,
                    )
                    // Notify JS to also invalidate its in-memory coach caches and
                    // re-render whatever coach card is currently visible.
                    webView.evaluateJavascript(
                        "try { " +
                                "if(typeof window.AppBridge==='object' && window.AppBridge && " +
                                "typeof window.AppBridge.invalidateTabInsightCache==='function') " +
                                "window.AppBridge.invalidateTabInsightCache('all'); " +
                                "if(typeof window.renderCoachHomeInsight==='function') " +
                                "setTimeout(window.renderCoachHomeInsight,400); " +
                                "} catch(_){}",
                        null,
                    )
                }
            }
        } else {
            // Issue 3 fix: convert missing HC permission strings to human-readable labels
            // and pass them as a JSON array so JS can show exactly what is missing.
            val missingLabels = missing.map { permissionToLabel(it) }
            val missingJson   = org.json.JSONArray(missingLabels).toString()
                .replace("'", "\\'")   // safe for JS string literal embedding

            webView.post {
                webView.evaluateJavascript(
                    "if(typeof window.onHCPermissionsResult==='function') " +
                            "window.onHCPermissionsResult(false, -1, false, '$missingJson')",
                    null,
                )
            }
        }
    }

    /**
     * Maps a Health Connect permission string to a short human-readable label
     * shown in the "Permissions needed" dialog (Issue 3).
     */
    private fun permissionToLabel(permission: String): String = when {
        permission.contains("SleepSession",        ignoreCase = true) -> "Sleep"
        permission.contains("HeartRateVariability", ignoreCase = true) -> "HRV"
        permission.contains("Steps",               ignoreCase = true) -> "Steps"
        permission.contains("RestingHeartRate",    ignoreCase = true) -> "Resting Heart Rate"
        permission.contains("Mindfulness",         ignoreCase = true) -> "Mindfulness"
        else -> permission.substringAfterLast('.').replace("Record", "")
    }

    // ── Disconnect ────────────────────────────────────────────────────────────

    @JavascriptInterface
    fun disconnectHC() {
        prefs.edit().putString(HC_CONNECTED, "0").apply()
        _cachedData = HCDailyData(isAvailable = false)
        // FIX (Issue 3): invalidate tab caches on disconnect so coach cards
        // immediately revert to non-HC variants rather than showing stale HC data.
        coachBridge?.clearTabInsightCache()
        bridgeScope.launch {
            manager.revokeAllPermissions()
        }
        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onHCDisconnected==='function') window.onHCDisconnected()",
                null,
            )
        }
    }

    // ── Sync ──────────────────────────────────────────────────────────────────

    /**
     * Force-read fresh HC data. On success, fires
     * `window.onHCSyncComplete(data: String)` in the WebView.
     * Spec §8: "Sync now" button.
     */
    @JavascriptInterface
    fun syncHCData() {
        val connected = prefs.getString(HC_CONNECTED, "0") == "1"
        if (!connected || !manager.isAvailable()) return
        syncInBackground { fresh ->
            _cachedData = fresh
            val json = getHCData()
            webView.post {
                webView.evaluateJavascript(
                    "if(typeof window.onHCSyncComplete==='function') window.onHCSyncComplete($json)",
                    null,
                )
            }
        }
    }

    /**
     * Called from AppBridge when the app resumes so data stays fresh.
     * Also reconciles the HC_CONNECTED flag against the permissions actually
     * granted in Health Connect — handles the case where the user manually
     * granted (or revoked) permissions inside the HC settings app without
     * going through Aurelo's own permission launcher.
     * Spec §9: "HC data read timeout (>5s) → use cached data".
     */
    fun refreshOnForeground() {
        if (!manager.isAvailable()) return

        bridgeScope.launch {
            // 1. Check current permission state on IO thread
            val grantedList = withContext(Dispatchers.IO) { manager.grantedPermissions() }
            val actuallyGranted = grantedList.containsAll(manager.allPermissions)
            val storedConnected = prefs.getString(HC_CONNECTED, "0") == "1"

            // 2. Reconciliation Logic
            when {
                // Case A: User granted permissions manually in System Settings
                actuallyGranted && !storedConnected -> {
                    handleConnectionChange(isConnected = true)
                }
                // Case B: User revoked permissions manually in System Settings
                !actuallyGranted && storedConnected -> {
                    handleConnectionChange(isConnected = false)
                }
                // Case C: State matches, just refresh data if we are connected
                storedConnected -> {
                    refreshCachedData()
                    // Notify JS so it can re-render body-dependent UI and save
                    // body_score_history. Without this callback the home card has
                    // already rendered with stale _cachedData (body = -1), the
                    // BUG-11 save in renderAureloScore() is skipped, and the
                    // Score History chart stays empty for the body pillar.
                    val json = getHCData()
                    webView.post {
                        webView.evaluateJavascript(
                            "if(typeof window.onHCDataRefreshed==='function')" +
                                    " window.onHCDataRefreshed($json)",
                            null,
                        )
                    }
                }
            }
        }
    }

    /**
     * Updates the connection preference, refreshes cache, and notifies JS.
     */
    private suspend fun handleConnectionChange(isConnected: Boolean) {
        val stateStr = if (isConnected) "1" else "0"
        prefs.edit().putString(HC_CONNECTED, stateStr).apply()

        if (isConnected) {
            refreshCachedData()
            val bodyScore = BodyScoreCalculator.compute(_cachedData)
            notifyJsPermissionResult(granted = true, score = bodyScore)
        } else {
            _cachedData = HCDailyData(isAvailable = false)
            notifyJsDisconnected()
        }
    }

    /**
     * Fetches fresh data with a 5s safety timeout.
     */
    private suspend fun refreshCachedData() {
        _cachedData = withTimeoutOrNull(5_000L) {
            withContext(Dispatchers.IO) { repository.readDailyData() }
        } ?: _cachedData
    }

// ── JS Notification Helpers ───────────────────────────────────────────────

    private fun notifyJsPermissionResult(granted: Boolean, score: Int) {
        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onHCPermissionsResult==='function') " +
                        "window.onHCPermissionsResult($granted, $score, false, '[]')",
                null
            )
        }
    }

    private fun notifyJsDisconnected() {
        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onHCDisconnected==='function') window.onHCDisconnected()",
                null
            )
        }
    }

    // ── Play Store ────────────────────────────────────────────────────────────

    /** Opens Play Store to install Health Connect app (Android 9-13). */
    @JavascriptInterface
    fun openHCPlayStore() = manager.openPlayStoreForHealthConnect()

    /**
     * Opens the Health Connect system settings on Android 14+ so the user can
     * manually grant permanently-denied permissions.  Falls back to the Play
     * Store on Android 9–13 (HC app not part of OS).
     */
    @JavascriptInterface
    fun openHCSettings() = manager.openHealthConnectSettings()

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun syncInBackground(onComplete: suspend (HCDailyData) -> Unit) {
        bridgeScope.launch {
            // Spec §9: timeout >5 s → fall back to cached data
            val fresh = withTimeoutOrNull(5_000L) {
                withContext(Dispatchers.IO) { repository.readDailyData() }
            } ?: _cachedData
            onComplete(fresh)
        }
    }
}