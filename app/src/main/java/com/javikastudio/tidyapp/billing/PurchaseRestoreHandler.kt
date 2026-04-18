package com.javikastudio.tidyapp.billing

import android.content.Context
import android.webkit.WebView

/**
 * PurchaseRestoreHandler — handles "Restore Purchase" user action.
 *
 * Called when JS invokes AppBridge.restorePurchase().
 * Re-queries Play via BillingManager and notifies JS of the result.
 *
 * Covers:
 *   - Reinstall (purchase exists in Play, local cache is empty)
 *   - New device (same Google account, purchase transfers automatically)
 *   - Cache corruption / EncryptedSharedPrefs Keystore reset
 */
class PurchaseRestoreHandler(
    private val context: Context,
    private val webView: WebView,
    private val billingManager: BillingManager,
    private val entitlementRepository: EntitlementRepository
) {
    /**
     * Initiates a restore. BillingManager.queryExistingPurchases() will call
     * BillingListener.onProStatusChanged() which AppBridge handles to update
     * both the local cache and the JS layer.
     *
     * This method just triggers the flow — the result comes back async via
     * AppBridge.onProStatusChanged().
     */
    fun restore() {
        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onRestoreStarted==='function') window.onRestoreStarted()",
                null
            )
        }
        // Pass a callback — if restore completes with no purchase, notify JS directly
        billingManager.restorePurchases { hasPro ->
            if (!hasPro) {
                notifyNoPurchaseFound()   // fires window.onRestoreNoPurchase()
            }
            // hasPro=true is already fully handled by onProStatusChanged() in AppBridge
        }
    }

    /**
     * Called by AppBridge after BillingManager confirms no Pro purchase found.
     * Notifies JS so UI can show "No purchase found" message.
     */
    fun notifyNoPurchaseFound() {
        webView.post {
            webView.evaluateJavascript(
                "if(typeof window.onRestoreNoPurchase==='function') window.onRestoreNoPurchase()",
                null
            )
        }
    }
}
