package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// HealthConnectManager — availability checks, permission management.
// Spec §2.1, §3.1. Called by HealthConnectBridge; holds the only reference
// to the HealthConnectClient so the rest of the codebase stays SDK-agnostic.
// ═══════════════════════════════════════════════════════════════════════════

import android.content.Context
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.MindfulnessSessionRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord

/** Availability of Health Connect on this device. */
enum class HcAvailability {
    /** Android 9-13 and the Health Connect app is not installed. */
    NEEDS_INSTALL,
    /** Android 8.0-8.1 — SDK is not supported at all. */
    NOT_SUPPORTED,
    /** HC is present and ready. */
    AVAILABLE,
}

/** Feature granularity so we only request what a screen actually needs. */
enum class HCFeature {
    BODY_PILLAR,       // HRV + RHR + Steps
    SCREEN_SCORE,      // Steps only
    SLEEP_SCORE,       // Sleep duration + overnight HRV
    FOCUS_SCORE,       // Mindfulness sessions
    ALL,               // Every permission at once (settings connect flow)
}


class HealthConnectManager(private val context: Context) {

    // ── Permissions ──────────────────────────────────────────────────────────
    // MindfulnessSessionRecord was added in Health Connect SDK 1.1 / Android API 35.
    // On API 26–34 the OS silently drops it from the permission sheet, so
    // containsAll(allPermissions) always returns false even when the user grants
    // everything that was actually shown.  We must only require the permissions
    // that the current device's HC SDK actually supports.

    private val basePermissions: Set<String> = setOf(
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
    )

    private val mindfulnessPermission: String =
        HealthPermission.getReadPermission(MindfulnessSessionRecord::class)

    /** True on API 35+ where MindfulnessSessionRecord is part of the HC SDK. */
    val supportsMindfulness: Boolean
        get() = Build.VERSION.SDK_INT >= 35   // Build.VERSION_CODES.VANILLA_ICE_CREAM

    /**
     * The set of permissions this device can actually grant.
     * On API 34 and below this excludes READ_MINDFULNESS (not in the HC SDK on those
     * API levels) so that containsAll() checks and the permission sheet both work correctly.
     */
    val allPermissions: Set<String>
        get() = if (supportsMindfulness) basePermissions + mindfulnessPermission
        else basePermissions

    private fun permissionsForFeature(feature: HCFeature): Set<String> = when (feature) {
        HCFeature.BODY_PILLAR  -> setOf(
            HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
            HealthPermission.getReadPermission(RestingHeartRateRecord::class),
            HealthPermission.getReadPermission(StepsRecord::class),
        )
        HCFeature.SCREEN_SCORE -> setOf(HealthPermission.getReadPermission(StepsRecord::class))
        HCFeature.SLEEP_SCORE  -> setOf(
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        )
        HCFeature.FOCUS_SCORE  -> setOf(HealthPermission.getReadPermission(MindfulnessSessionRecord::class))
        HCFeature.ALL          -> allPermissions
    }

    // ── Launcher ──────────────────────────────────────────────────────────────
    // HC permissions MUST use the PermissionController contract from the Health
    // Connect SDK on ALL API levels (26+), including Android 14+ (API 34+).
    //
    // Using ActivityResultContracts.RequestMultiplePermissions() for HC health
    // permissions is incorrect: the OS treats those strings as standard runtime
    // permissions, considers them "never requested via the correct contract",
    // and immediately returns an empty granted set — causing the spurious
    // "permanently denied" state.  The HC SDK contract is the only supported
    // path on every Android version we target.

    var permissionLauncher: ActivityResultLauncher<Set<String>>? = null

    fun requestPermissionsForFeature(feature: HCFeature) {
        val permissions = permissionsForFeature(feature)
        permissionLauncher?.launch(permissions)
            ?: android.util.Log.w("HCManager",
                "permissionLauncher not registered — call registerForActivityResult(" +
                        "PermissionController.createRequestPermissionResultContract()) in MainActivity")
    }

    // ── Availability ─────────────────────────────────────────────────────────

    fun availability(): HcAvailability {
        // Health Connect SDK requires Android 9 (API 28) minimum when Health Connect
        // is delivered as a standalone app.  On Android 14+ (API 34+) HC is built
        // into the OS, so the SDK works there too.  API 26–27 (Android 8.x) is the
        // only range where the SDK itself is not supported.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return HcAvailability.NOT_SUPPORTED
        return when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_UNAVAILABLE                             -> HcAvailability.NOT_SUPPORTED
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED   -> HcAvailability.NEEDS_INSTALL
            else                                                             -> HcAvailability.AVAILABLE
        }
    }

    fun isAvailable(): Boolean = availability() == HcAvailability.AVAILABLE

    // ── Client access ─────────────────────────────────────────────────────────
    // Callers should guard with isAvailable() before calling client().

    fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    // ── Granted permissions ───────────────────────────────────────────────────

    suspend fun grantedPermissions(): Set<String> {
        if (!isAvailable()) return emptySet()
        return runCatching { client().permissionController.getGrantedPermissions() }
            .getOrElse { emptySet() }
    }

    suspend fun hasPermission(permission: String): Boolean =
        grantedPermissions().contains(permission)

    suspend fun hasAllPermissions(): Boolean =
        grantedPermissions().containsAll(allPermissions)

    suspend fun hasAnyPermission(): Boolean =
        grantedPermissions().any { it in allPermissions }

    // ── Revoke all ────────────────────────────────────────────────────────────

    suspend fun revokeAllPermissions() {
        if (!isAvailable()) return
        runCatching {
            client().permissionController.revokeAllPermissions()
        }
    }

    // ── Play Store deep-link (Android 9-13, app not installed) ──────────────

    fun openPlayStoreForHealthConnect() {
        val pkg = "com.google.android.apps.healthdata"
        runCatching {
            context.startActivity(
                android.content.Intent(android.content.Intent.ACTION_VIEW,
                    android.net.Uri.parse("market://details?id=$pkg"))
                    .apply { flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK }
            )
        }
    }

    // ── Settings deep-link ────────────────────────────────────────────────────
    // Opens Aurelo's own Health Connect permissions page directly.
    //
    // On Android 14+ (API 34+) Health Connect is part of the OS.
    //   Primary:  MANAGE_HEALTH_PERMISSIONS + EXTRA_PACKAGE_NAME → Aurelo's HC page
    //   Fallback: HEALTH_CONNECT_SETTINGS   → HC main settings screen
    //
    // On API 26–33 Health Connect is a separate app; the Play Store link is the
    // only entry point when the app is not installed. When it IS installed the
    // primary intent still works because the HC app registers the same action.

    fun openHealthConnectSettings() {
        // openHCSettings() is called from a @JavascriptInterface method which runs on a
        // background JS thread.  Calling context.startActivity() with FLAG_ACTIVITY_NEW_TASK
        // from a non-Activity context on API 34+ silently fails for protected HC intents —
        // the ActivityManager drops the request without throwing, so runCatching{}.isSuccess
        // returns true but nothing opens.
        //
        // Fix: always dispatch via Activity.runOnUiThread() so the intent is launched from
        // the correct foreground task. FLAG_ACTIVITY_NEW_TASK is kept as a fallback for the
        // rare case where context is not an Activity.
        val activity = context as? android.app.Activity

        fun startIntent(intent: android.content.Intent): Boolean {
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            return if (activity != null) {
                // UI-thread dispatch is the key fix — avoids silent drop on API 34+
                var succeeded = false
                runCatching {
                    activity.runOnUiThread {
                        runCatching { activity.startActivity(intent) }
                            .onSuccess { succeeded = true }
                    }
                }
                // runOnUiThread posts and returns immediately; treat as success if no exception
                // was thrown posting to the handler (the actual start is async on the UI thread)
                true
            } else {
                runCatching { context.startActivity(intent) }.isSuccess
            }
        }

        // Primary: jump directly to Aurelo's own permission page inside HC
        if (startIntent(
                android.content.Intent("android.health.connect.action.MANAGE_HEALTH_PERMISSIONS")
                    .putExtra(android.content.Intent.EXTRA_PACKAGE_NAME, context.packageName)
            )
        ) return

        // Fallback 1: HC main settings screen (API 34+ OS-level HC)
        if (startIntent(
                android.content.Intent("android.health.connect.action.HEALTH_CONNECT_SETTINGS")
            )
        ) return

        // Fallback 2: Play Store (API 28–33, HC app not installed)
        openPlayStoreForHealthConnect()
    }
}