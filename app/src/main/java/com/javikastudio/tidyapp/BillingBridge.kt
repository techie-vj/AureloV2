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
    private val restoreHandler: com.javikastudio.tidyapp.billing.PurchaseRestoreHandler
) : AppBridgeController {

    @JavascriptInterface fun isProUser(): Boolean = prefs.getBoolean(IS_PRO_USER, false)

    @JavascriptInterface fun setProUser(isPro: Boolean) {
        prefs.edit().putBoolean(IS_PRO_USER, isPro).apply()
        if (isPro) WidgetUpdater.updateAll(context)
    }

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
