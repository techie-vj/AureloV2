package com.javikastudio.tidyapp

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * Swaps between the standard launcher icon and the Pro crown icon by toggling
 * two components:
 *
 *   • MainActivity              — the real activity; carries the default (free) icon
 *   • MainActivityIconPro       — activity-alias declared in AndroidManifest.xml;
 *                                 carries @mipmap/ic_launcher_pro (purple + crown)
 *
 * Exactly one of the two launcher entries is enabled at any time.
 * Disabling MainActivity only removes it from the launcher / implicit-intent
 * resolution — explicit PendingIntents (widgets, notifications) and the enabled
 * alias both continue to route to the activity class normally.
 *
 * Call sites:
 *   • AppBridge.onProStatusChanged(isPro=true)  — on purchase / restore
 *   • AppBridge.onProStatusChanged(isPro=false) — on downgrade (no extension)
 *   • AppBridge referral extension branch       — revert to Pro after lapse
 */
object LauncherIconManager {

    private const val CLASS_MAIN     = "com.javikastudio.tidyapp.MainActivity"
    private const val CLASS_PRO_ALIAS = "com.javikastudio.tidyapp.MainActivityIconPro"

    fun updateIcon(context: Context, isPro: Boolean) {
        try {
            val pm  = context.packageManager
            val pkg = context.packageName

            val mainComp  = ComponentName(pkg, CLASS_MAIN)
            val proComp   = ComponentName(pkg, CLASS_PRO_ALIAS)

            if (isPro) {
                // 1. Enable Pro alias so the launcher picks up the crown icon.
                pm.setComponentEnabledSetting(
                    proComp,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP
                )
                // 2. Disable MainActivity's launcher entry so only one icon shows.
                //    DISABLED only blocks implicit/launcher resolution — explicit
                //    PendingIntents (widgets, notifications) still reach the activity.
                pm.setComponentEnabledSetting(
                    mainComp,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                )
            } else {
                // 1. Re-enable MainActivity as launcher (restores free icon).
                pm.setComponentEnabledSetting(
                    mainComp,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP
                )
                // 2. Disable Pro alias.
                pm.setComponentEnabledSetting(
                    proComp,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                )
            }

            android.util.Log.d("LauncherIconManager",
                "Icon updated → ${if (isPro) "Pro (crown)" else "Free"}")
        } catch (e: Exception) {
            // Non-fatal: wrong icon is cosmetic; never crash.
            android.util.Log.w("LauncherIconManager", "updateIcon failed: ${e.message}")
        }
    }
}
