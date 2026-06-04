package com.javikastudio.tidyapp

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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
 * ISSUE-21 FIX: Some Android OEM variants (Samsung, Xiaomi, OnePlus) kill the
 * foreground process when its launcher-entry component is disabled, even with
 * DONT_KILL_APP. scheduleRelaunch() fires a 600ms AlarmManager PendingIntent
 * BEFORE the component swap so the app reopens automatically if the OS kills it.
 *
 * Call sites:
 *   • AppBridge.onProStatusChanged(isPro=true)  — on purchase / restore
 *   • AppBridge.onProStatusChanged(isPro=false) — on downgrade (no extension)
 *   • AppBridge referral extension branch       — revert to Pro after lapse
 */
object LauncherIconManager {

    private const val CLASS_MAIN      = "com.javikastudio.tidyapp.MainActivity"
    private const val CLASS_PRO_ALIAS = "com.javikastudio.tidyapp.MainActivityIconPro"

    // Unique request code so we never stack multiple relaunches
    private const val RELAUNCH_REQUEST_CODE = 9977

    fun updateIcon(context: Context, isPro: Boolean) {
        try {
            val pm  = context.packageManager
            val pkg = context.packageName

            val mainComp = ComponentName(pkg, CLASS_MAIN)
            val proComp  = ComponentName(pkg, CLASS_PRO_ALIAS)

            // ISSUE-21 FIX: Schedule auto-relaunch BEFORE disabling any component.
            // setComponentEnabledSetting(..., DISABLED, DONT_KILL_APP) can still kill
            // the foreground process on certain OEM builds.  The AlarmManager intent
            // fires 600 ms later so the app reopens transparently without user action.
            scheduleRelaunch(context)

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

    /**
     * Schedules a relaunch of MainActivity 600 ms from now via AlarmManager.
     * If the OS kills the process during the component swap, this intent fires
     * and brings the app back automatically.  If the process is NOT killed
     * (most modern Android builds), the intent fires harmlessly to an already-
     * running foreground activity which simply comes to the front (FLAG_ACTIVITY_SINGLE_TOP).
     */
    private fun scheduleRelaunch(context: Context) {
        try {
            val launchIntent = context.packageManager
                .getLaunchIntentForPackage(context.packageName) ?: return
            launchIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
            val pi = PendingIntent.getActivity(
                context,
                RELAUNCH_REQUEST_CODE,
                launchIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.set(AlarmManager.RTC, System.currentTimeMillis() + 600L, pi)
        } catch (e: Exception) {
            android.util.Log.w("LauncherIconManager", "scheduleRelaunch failed: ${e.message}")
        }
    }
}