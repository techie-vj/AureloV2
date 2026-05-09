package com.javikastudio.tidyapp

import android.app.Activity
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope

/**
 * BillingBridge — owns Pro subscription status, billing flow launch, pricing
 * retrieval, and purchase restoration.
 * Delegates to existing BillingManager and EntitlementRepository.
 * Phase 3: extracted from AppBridge.kt.
 */
class BillingBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val billingManager: com.javikastudio.tidyapp.billing.BillingManager,
    private val entitlementRepo: com.javikastudio.tidyapp.billing.EntitlementRepository,
    private val restoreHandler: com.javikastudio.tidyapp.billing.PurchaseRestoreHandler,
    private val referralBridge: ReferralBridge? = null
) : AppBridgeController {

    // BUG-03 FIX: stores the last plan confirmed by BillingManager so setProUser(true)
    // can forward the real plan to the referral system instead of a hardcoded "monthly".
    @Volatile private var _activatedPlan: String = "monthly"

    /** Called by AppBridge’s BillingListener.onPlanActivated — keeps _activatedPlan in sync. */
    fun recordActivatedPlan(plan: String) {
        _activatedPlan = plan
        // Persist so the value survives process death between billing confirmation and
        // the next setProUser(true) call (e.g. when JS reads IS_PRO_USER on restart).
        prefs.edit().putString(BILLING_ACTIVE_PLAN, plan).apply()
    }

    @JavascriptInterface fun isProUser(): Boolean = entitlementRepo.isPro

    fun setProUser(isPro: Boolean) {
        entitlementRepo.setProStatus(isPro)

        if (isPro) {
            WidgetUpdater.updateAll(context)
            // Cancel any pending extension-expiry task — user has re-subscribed (BUG-06).
            ReferralExtensionWorker.cancel(context)
            // BUG-03 FIX: was hardcoded "monthly"; now reads the actual plan stored by
            // recordActivatedPlan() which BillingManager calls before onProStatusChanged.
            val plan = prefs.getString(BILLING_ACTIVE_PLAN, null) ?: _activatedPlan
            referralBridge?.onThisUserConvertedToPro(plan)
        } else {
            // Subscription has lapsed — check if referral extension days have been banked.
            val extensionDays = ReferralManager.activateExtensionOnLapse(prefs)
            if (extensionDays > 0) {
                // Extension activated — keep IS_PRO_USER = true for the extension period.
                prefs.edit().putBoolean(IS_PRO_USER, true).apply()
                android.util.Log.d("AureloReferral",
                    "Subscription lapsed — referral extension activated: $extensionDays days")

                // BUG-06 FIX: schedule a one-time worker that fires when the extension
                // expires and revokes Pro access. Without this, the extension runs
                // indefinitely until the user opens the app and billing re-queries.
                ReferralExtensionWorker.scheduleExpiry(context)

                // Notify JS so it can refresh Pro UI with extension banner
                val js = "if(typeof window.onReferralExtensionActivated==='function')" +
                        "window.onReferralExtensionActivated($extensionDays);"
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    webView.evaluateJavascript(js, null)
                }
            }
        }
    }

    /**
     * Called by BillingBridge when Pro is granted for a specific plan.
     * Banks referral extension days for monthly/annual users.
     * @param plan  "monthly" | "annual" | "lifetime"
     * @param daysEarned  Referral days just earned that should be banked
     */
    fun bankReferralExtension(plan: String, daysEarned: Int) {
        if (daysEarned > 0) {
            ReferralManager.bankExtensionDays(prefs, plan, daysEarned)
        }
    }

    // Kept for JS backward-compatibility; now delegates to the same source as isProUser().
    @JavascriptInterface fun getProStatus(): Boolean = entitlementRepo.isPro

    @JavascriptInterface fun getProPricing() {
        billingManager.getProPricing { json ->
            val escaped = json.replace("\\","\\\\").replace("'","\\'")
            webView.post { webView.evaluateJavascript("if(typeof window.onProPricingLoaded==='function') window.onProPricingLoaded('$escaped')", null) }
        }
    }

    @JavascriptInterface fun launchBillingFlow(plan: String) {
        val activity = context as? Activity ?: return
        activity.runOnUiThread {
            if (plan.isBlank()) billingManager.launchBillingFlow(activity)
            else billingManager.launchBillingFlow(activity, plan)
        }
    }

    @JavascriptInterface fun restorePurchase() { restoreHandler.restore() }

    override fun onDestroy() { billingManager.disconnect() }
}