package com.javikastudio.tidyapp

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope

/**
 * ReferralBridge — exposes ReferralManager to the JS layer.
 * Registered as "N" along with all other bridge controllers.
 */
class ReferralBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    /** Returns this user's unique referral link. */
    @JavascriptInterface
    fun getReferralLink(): String = ReferralManager.getReferralLink(prefs)

    /** Returns this user's 8-char referral code. */
    @JavascriptInterface
    fun getReferralCode(): String = ReferralManager.getMyReferralCode(prefs)

    /**
     * Returns a JSON object with referral stats for display on the referral screen.
     * {shareCount, totalInstalls, totalConversions, totalDaysEarned, pending,
     *  bonusDays, wasReferred, daysSinceInstall}
     */
    @JavascriptInterface
    fun getReferralStats(): String = try {
        ReferralManager.getStats(prefs).toString()
    } catch (_: Exception) { "{}" }

    /**
     * Records that the user shared their referral link (copy or share action).
     * Call this AFTER the share sheet or clipboard write succeeds.
     */
    @JavascriptInterface
    fun recordReferralShare() {
        ReferralManager.recordShareAttempt(prefs)
    }

    /**
     * Records a friend install confirmation event.
     * [friendCode] is the 8-char code extracted from the referral link — used to
     * deduplicate reinstalls so the same friend never earns the referrer a second credit.
     * Returns JSON: {daysEarned: N} — 0 if rate-limited or already credited.
     */
    @JavascriptInterface
    fun recordReferralInstall(friendCode: String = ""): String {
        val days = ReferralManager.recordFriendInstall(prefs, friendCode.takeIf { it.isNotBlank() })
        return org.json.JSONObject().apply { put("daysEarned", days) }.toString()
    }

    /**
     * Records a friend conversion for a given plan.
     * plan: "monthly" | "annual" | "lifetime"
     * Returns JSON: {daysEarned: N}
     */
    @JavascriptInterface
    fun recordReferralConversion(plan: String): String {
        val days = ReferralManager.recordFriendConversion(prefs, plan)
        return org.json.JSONObject().apply { put("daysEarned", days) }.toString()
    }

    /**
     * How many bonus Pro days this user received for being referred.
     * 0 if not referred.
     */
    @JavascriptInterface
    fun getReferralBonusDays(): Int = ReferralManager.getReferralBonusDays(prefs)

    /** True if this device was installed via a referral link. */
    @JavascriptInterface
    fun wasReferred(): Boolean = ReferralManager.wasReferred(prefs)

    /** True if a referral Pro extension is currently running. */
    @JavascriptInterface
    fun isExtensionActive(): Boolean = ReferralManager.isExtensionActive(prefs)

    /** Days remaining on the active referral extension (0 if none). */
    @JavascriptInterface
    fun getExtensionDaysRemaining(): Int = ReferralManager.getExtensionDaysRemaining(prefs)

    /**
     * Days banked but not yet activated (waiting for subscription to lapse).
     * Shown in referral screen as "X days ready to unlock when your plan ends".
     */
    @JavascriptInterface
    fun getPendingExtensionDays(): Int = ReferralManager.getPendingExtensionDays(prefs)

    /**
     * Called by BillingBridge when this user upgrades to Pro.
     * Records the conversion event on the referred side so the referrer
     * can eventually claim credit via the confirmation code flow.
     */
    fun onThisUserConvertedToPro(plan: String) {
        ReferralManager.onThisUserConverted(prefs, plan)
    }

    /**
     * Called from AppBridge when a referral reward is earned while the user is
     * on a monthly/annual plan — banks the days for extension on next lapse.
     */
    fun bankExtensionIfSubscribed(plan: String, daysEarned: Int) {
        ReferralManager.bankExtensionDays(prefs, plan, daysEarned)
    }
}