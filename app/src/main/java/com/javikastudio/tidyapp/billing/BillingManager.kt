package com.javikastudio.tidyapp.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.*
import kotlinx.coroutines.*

/**
 * BillingManager — wraps Google Play Billing Library 7.x
 *
 * Single responsibility: talk to Play. Nothing else.
 * All results flow through [listener] back to AppBridge.
 *
 * Usage:
 *   val billing = BillingManager(context, listener)
 *   billing.connect()                        // call once in AppBridge init
 *   billing.onAppForegrounded()              // call in AppBridge.onResume() — detects cancellations
 *   billing.launchBillingFlow(activity)      // on user tap
 *   billing.restorePurchases()               // on restore tap
 *   billing.disconnect()                     // in AppBridge.destroy()
 *
 * Product structure (Play Console):
 *   PRODUCT_ID_SUBSCRIPTION ("tidyapp_pro") — single SUBS product with two base plans:
 *     BASE_PLAN_ANNUAL  ("annual")  + offer "annual-7day-trial"
 *     BASE_PLAN_MONTHLY ("monthly") + offer "monthly-7day-trial"
 *   PRODUCT_ID_LIFETIME ("tidyapp_pro_lifetime") — separate INAPP product
 *
 * Offer selection strategy (see _selectBestOffer):
 *   1. Free-trial offer  (first pricing phase has priceAmountMicros == 0)
 *   2. Introductory-price offer  (non-zero but discounted non-recurring first phase)
 *   3. Bare base-plan offer  (offerId == null)
 *   4. Any remaining offer
 *   When you add more offer types in Play Console, only _selectBestOffer needs updating.
 *
 * Fixes applied vs. original:
 *   - Removed stale legacy product ID references (no users; app not published)
 *   - onAppForegrounded() added — re-queries on resume so cancellations are detected mid-session
 *   - _selectBestOffer() prefers trial/intro offers; fixes wrong offer token selection
 *   - Introductory pricing (non-zero discounted first phase) now detected and exposed
 *   - Pricing loop groups by basePlanId — no more duplicate key overwrites
 *   - PENDING purchase state handled in both handlePurchase and queryExistingPurchases
 *   - null purchases on OK response now triggers queryExistingPurchases fallback
 *   - restoreCallback invoked on connection failure so UI is never left waiting
 *   - Upgrade/downgrade: activeSubsPurchaseToken stored and passed via setSubscriptionUpdateParams
 *   - setIsOfferPersonalized(false) added to BillingFlowParams (EU compliance)
 *   - @Volatile on all shared mutable fields (thread safety)
 *   - pendingLaunchActivity/Plan cleared in disconnect() to avoid leaks
 */
class BillingManager(
    private val context: Context,
    private val listener: BillingListener
) {
    interface BillingListener {
        fun onProStatusChanged(isPro: Boolean)
        fun onBillingError(code: Int, message: String)
        fun onBillingReady()
    }

    companion object {
        private const val TAG = "AureloBilling"

        // Single subscription product containing monthly + annual as base plans
        const val PRODUCT_ID_SUBSCRIPTION = "tidyapp_pro"
        // Lifetime remains a separate one-time INAPP product
        const val PRODUCT_ID_LIFETIME = "tidyapp_pro_lifetime"

        // Base plan IDs — must match exactly what is set in Play Console
        const val BASE_PLAN_MONTHLY = "monthly"
        const val BASE_PLAN_ANNUAL  = "annual"

        // Maps JS plan name → base plan ID (for subs) used by launchBillingFlow(plan)
        val PLAN_BASE_PLAN_MAP = mapOf(
            "monthly" to BASE_PLAN_MONTHLY,
            "annual"  to BASE_PLAN_ANNUAL
        )

        // All product IDs that grant Pro status.
        val PRO_PRODUCT_IDS = setOf(
            PRODUCT_ID_SUBSCRIPTION,
            PRODUCT_ID_LIFETIME
        )

        // ProductDetails.RecurrenceMode constants (int @IntDef — not directly importable)
        private const val RECURRENCE_NON_RECURRING = 3
    }

    private var billingClient: BillingClient? = null

    // @Volatile ensures cross-thread visibility for all shared mutable state.
    // Billing callbacks may fire on a Play-owned background thread while the main
    // thread also reads/writes these fields.
    @Volatile private var isConnected = false
    @Volatile private var pendingLaunchActivity: Activity? = null
    @Volatile private var pendingLaunchPlan: String? = null
    @Volatile private var restoreCallback: ((Boolean) -> Unit)? = null
    @Volatile private var pendingPricingCallback: ((String) -> Unit)? = null

    /**
     * Tracks the active subscription purchase token so upgrade/downgrade flows can
     * pass the existing token to Play via setSubscriptionUpdateParams().
     * Null when the user has no active subscription.
     */
    @Volatile private var activeSubsPurchaseToken: String? = null

    // ── Connection ────────────────────────────────────────────────

    fun connect() {
        if (isConnected) return
        billingClient = BillingClient.newBuilder(context)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .enablePrepaidPlans()
                    .build()
            )
            .build()

        billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    isConnected = true
                    Log.d(TAG, "Billing connected")
                    listener.onBillingReady()
                    queryExistingPurchases()

                    // Flush any pending pricing request that arrived before connection
                    pendingPricingCallback?.let { cb ->
                        pendingPricingCallback = null
                        _doGetProPricing(cb)
                    }

                    // Flush any pending billing flow launch
                    pendingLaunchActivity?.let { activity ->
                        val plan = pendingLaunchPlan
                        pendingLaunchActivity = null
                        pendingLaunchPlan     = null
                        if (plan != null) launchBillingFlow(activity, plan)
                        else              launchBillingFlow(activity)
                    }
                } else {
                    Log.w(TAG, "Billing setup failed: ${result.debugMessage}")
                    // FIX: invoke restoreCallback on failure so the UI is never left waiting
                    restoreCallback?.invoke(false)
                    restoreCallback = null
                    listener.onBillingError(result.responseCode, result.debugMessage)
                }
            }

            override fun onBillingServiceDisconnected() {
                isConnected = false
                Log.w(TAG, "Billing disconnected — will reconnect on next action")
                // Play recommends reconnecting on next user action rather than retrying
                // immediately, to avoid hammering the service.
            }
        })
    }

    fun disconnect() {
        billingClient?.endConnection()
        isConnected = false
        // Clean up all pending state to avoid leaks after the host is destroyed
        restoreCallback    = null
        pendingPricingCallback = null
        pendingLaunchActivity  = null
        pendingLaunchPlan      = null
    }

    /**
     * Call this from AppBridge.onResume() (or equivalent lifecycle hook).
     *
     * WHY: When a user cancels a subscription from the Play Store, the sub stays active
     * until the billing period ends — after which Play stops returning it in
     * queryPurchasesAsync. Without this call, the app has no way to detect the expiry
     * mid-session and would keep granting Pro indefinitely until the next cold start.
     */
    fun onAppForegrounded() {
        if (isConnected) {
            queryExistingPurchases()
        } else {
            connect() // connect() calls queryExistingPurchases() on success
        }
    }

    // ── Purchase flow ─────────────────────────────────────────────

    /**
     * Launches the Play billing UI with no plan specified.
     * Defaults to the annual base plan.
     */
    fun launchBillingFlow(activity: Activity) {
        launchBillingFlow(activity, "annual")
    }

    /**
     * Launches the Play billing UI for a specific plan.
     * Called from AppBridge when JS passes a plan string ("monthly", "annual", "lifetime").
     *
     * Monthly and annual are base plans on PRODUCT_ID_SUBSCRIPTION.
     * Lifetime is a separate INAPP product (PRODUCT_ID_LIFETIME).
     */
    fun launchBillingFlow(activity: Activity, plan: String) {
        val normalizedPlan = plan.lowercase().trim()

        if (!isConnected) {
            Log.w(TAG, "Not connected — queuing plan launch: $normalizedPlan")
            // Only the latest pending launch is kept; multiple queued launches are unusual
            // and the last user action is the most relevant one.
            pendingLaunchActivity = activity
            pendingLaunchPlan     = normalizedPlan
            connect()
            return
        }

        when (normalizedPlan) {
            "lifetime" -> _launchLifetime(activity)
            else       -> _launchSubscription(activity, normalizedPlan)
        }
    }

    /** Queries the lifetime INAPP product and launches the billing flow. */
    private fun _launchLifetime(activity: Activity) {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_ID_LIFETIME)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            )).build()

        billingClient?.queryProductDetailsAsync(params) { result, list ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK && list.isNotEmpty()) {
                _launchWithDetails(activity, list.first(), basePlanId = null)
            } else {
                Log.w(TAG, "Lifetime product query failed: ${result.debugMessage}")
                listener.onBillingError(result.responseCode, "Could not load lifetime details")
            }
        }
    }

    /**
     * Queries the single subscription product and selects the correct base plan offer.
     * @param plan "monthly" or "annual" — must be a key in PLAN_BASE_PLAN_MAP
     */
    private fun _launchSubscription(activity: Activity, plan: String) {
        val basePlanId = PLAN_BASE_PLAN_MAP[plan]
        if (basePlanId == null) {
            Log.w(TAG, "Unknown subscription plan '$plan'")
            listener.onBillingError(-1, "Unknown plan: $plan")
            return
        }

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_ID_SUBSCRIPTION)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            )).build()

        billingClient?.queryProductDetailsAsync(params) { result, list ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK || list.isEmpty()) {
                Log.w(TAG, "Subscription product query failed for '$plan': ${result.debugMessage}")
                listener.onBillingError(result.responseCode, "Could not load plan details")
                return@queryProductDetailsAsync
            }
            _launchWithDetails(activity, list.first(), basePlanId = basePlanId)
        }
    }

    // ── Pricing ───────────────────────────────────────────────────

    /**
     * Queries Play for pricing of all Pro plans and returns a JSON string.
     * Called from AppBridge.getProPricing() which is called by JS on paywall open.
     *
     * Shape returned:
     * {
     *   "monthly":  { "price": "$2.99",  "perMonth": "$2.99",  "trialDays": 7,  "hasIntro": false },
     *   "annual":   { "price": "$17.99", "perMonth": "$1.49",  "trialDays": 7,  "hasIntro": false },
     *   "lifetime": { "price": "$29.99", "perMonth": null,     "trialDays": 0,  "hasIntro": false }
     * }
     *
     * When an introductory price exists (hasIntro: true), two extra fields are added:
     *   "introPrice": "$0.99"   — formatted intro period price
     *   "introDays":  30        — intro period length in days
     *
     * monthly + annual are sourced from base plans on PRODUCT_ID_SUBSCRIPTION.
     * lifetime is sourced from PRODUCT_ID_LIFETIME (INAPP).
     * callback receives the final JSON string.
     */
    fun getProPricing(callback: (String) -> Unit) {
        if (!isConnected) {
            pendingPricingCallback = callback
            connect()
            return
        }
        _doGetProPricing(callback)
    }

    private fun _doGetProPricing(callback: (String) -> Unit) {
        val result  = org.json.JSONObject()
        var pending = 2  // one subs query + one inapp query

        fun annualPerMonth(micros: Long, currencyCode: String): String {
            return try {
                val symbol = java.util.Currency.getInstance(currencyCode).symbol
                val amount = micros / 12 / 1_000_000.0
                "$symbol${"%.2f".format(amount)}"
            } catch (e: Exception) { "" }
        }

        // ── Subscription product ──────────────────────────────────────────────
        val subsParams = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_ID_SUBSCRIPTION)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            )).build()

        billingClient?.queryProductDetailsAsync(subsParams) { _, subsList ->
            val offerDetails = subsList.firstOrNull()?.subscriptionOfferDetails.orEmpty()

            // FIX: Group by basePlanId so each base plan is processed exactly once.
            // Previously the forEach iterated all offers (including trial offers),
            // causing multiple writes to the same plan key — the last write won,
            // which was non-deterministic and could show wrong pricing.
            offerDetails
                .groupBy { it.basePlanId }
                .forEach { (basePlanId, offersForPlan) ->
                    val planKey = when (basePlanId) {
                        BASE_PLAN_MONTHLY -> "monthly"
                        BASE_PLAN_ANNUAL  -> "annual"
                        else -> return@forEach // skip unrecognised base plans
                    }

                    // Pick the best offer for this base plan (trial > intro > base > any)
                    val bestOffer = _selectBestOffer(offersForPlan) ?: return@forEach

                    // Recurring price is always the last pricing phase
                    val recurringPhase = bestOffer.pricingPhases.pricingPhaseList.lastOrNull()
                        ?: return@forEach
                    val priceStr   = recurringPhase.formattedPrice
                    val priceMicro = recurringPhase.priceAmountMicros
                    val currency   = recurringPhase.priceCurrencyCode

                    // Inspect the first phase to detect trial or intro-price periods.
                    // The phases list is ordered: [optional intro/trial phase, recurring phase].
                    // When there is only one phase, firstOrNull == lastOrNull (pure base plan).
                    val phases     = bestOffer.pricingPhases.pricingPhaseList
                    val firstPhase = if (phases.size > 1) phases.first() else null

                    // Free trial: first phase costs nothing
                    val isTrial = firstPhase != null && firstPhase.priceAmountMicros == 0L

                    // Introductory price: first phase costs something but is non-recurring
                    // (e.g. "$0.99 for the first month"). recurrenceMode 3 == NON_RECURRING.
                    val isIntro = firstPhase != null
                            && !isTrial
                            && firstPhase.recurrenceMode == RECURRENCE_NON_RECURRING

                    val obj = org.json.JSONObject()
                    obj.put("price", priceStr)
                    obj.put(
                        "perMonth",
                        if (basePlanId == BASE_PLAN_ANNUAL && priceMicro > 0)
                            annualPerMonth(priceMicro, currency)
                        else
                            priceStr
                    )
                    obj.put("trialDays",
                        if (isTrial) parsePeriodToDays(firstPhase!!.billingPeriod) else 0
                    )
                    obj.put("hasIntro", isIntro)
                    if (isIntro && firstPhase != null) {
                        // Extra fields so the JS paywall can display the intro badge
                        obj.put("introPrice", firstPhase.formattedPrice)
                        obj.put("introDays",  parsePeriodToDays(firstPhase.billingPeriod))
                    }

                    result.put(planKey, obj)
                    Log.d(TAG, "Pricing — $planKey: $priceStr trialDays=${obj.optInt("trialDays")} hasIntro=$isIntro")
                }

            pending--
            if (pending == 0) callback(result.toString())
        }

        // ── Lifetime INAPP product ────────────────────────────────────────────
        val inappParams = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_ID_LIFETIME)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            )).build()

        billingClient?.queryProductDetailsAsync(inappParams) { _, inappList ->
            inappList.firstOrNull()?.let { detail ->
                val obj = org.json.JSONObject()
                obj.put("price",     detail.oneTimePurchaseOfferDetails?.formattedPrice ?: "")
                obj.put("perMonth",  org.json.JSONObject.NULL)
                obj.put("trialDays", 0)
                obj.put("hasIntro",  false)
                result.put("lifetime", obj)
                Log.d(TAG, "Pricing — lifetime: ${detail.oneTimePurchaseOfferDetails?.formattedPrice}")
            }
            pending--
            if (pending == 0) callback(result.toString())
        }
    }

    /**
     * Selects the best offer from a list of offers that all belong to the same base plan.
     *
     * Priority order:
     *  1. Free-trial offer       — first phase priceAmountMicros == 0
     *  2. Intro-price offer      — non-zero, non-recurring first phase
     *  3. Bare base-plan offer   — offerId == null (no promotional offer)
     *  4. Any remaining offer    — fallback
     *
     * This is the single place to update when you add new offer types in Play Console.
     * It is used both for launching billing flow (to pass the right offerToken to Play)
     * and for pricing display (to show the right trial/intro info on the paywall).
     */
    private fun _selectBestOffer(
        offers: List<ProductDetails.SubscriptionOfferDetails>
    ): ProductDetails.SubscriptionOfferDetails? {
        if (offers.isEmpty()) return null

        // 1. Free trial — any phase has zero price
        offers.firstOrNull { offer ->
            offer.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L }
        }?.let { return it }

        // 2. Introductory price — first phase is discounted but non-zero and non-recurring
        offers.firstOrNull { offer ->
            val first = offer.pricingPhases.pricingPhaseList.firstOrNull()
            first != null
                    && first.priceAmountMicros > 0L
                    && first.recurrenceMode == RECURRENCE_NON_RECURRING
        }?.let { return it }

        // 3. Base plan offer (no promotional offer ID attached)
        offers.firstOrNull { it.offerId == null }?.let { return it }

        // 4. Fallback — take whatever is first
        return offers.first()
    }

    /**
     * Parses ISO 8601 period string to approximate days.
     * Handles: P7D (7 days), P1W (7 days), P1M (30 days), P1Y (365 days).
     * Compound periods (e.g. P2W3D) are not handled by Play Console UI so
     * this simple parser covers all currently issued billing periods.
     */
    private fun parsePeriodToDays(period: String): Int {
        return try {
            when {
                period.endsWith("D") -> period.drop(1).dropLast(1).toInt()
                period.endsWith("W") -> period.drop(1).dropLast(1).toInt() * 7
                period.endsWith("M") -> period.drop(1).dropLast(1).toInt() * 30
                period.endsWith("Y") -> period.drop(1).dropLast(1).toInt() * 365
                else -> 0
            }
        } catch (e: Exception) { 0 }
    }

    // ── Private helpers ───────────────────────────────────────────

    /**
     * Builds and launches the Play billing flow for a resolved ProductDetails.
     *
     * For subscriptions:
     *  - Picks the best available offer via [_selectBestOffer] (trial > intro > base).
     *  - If [activeSubsPurchaseToken] is set (user already has an active sub), attaches
     *    SubscriptionUpdateParams so Play replaces the old plan instead of stacking a new one.
     *    This handles monthly→annual and annual→monthly upgrades/downgrades correctly.
     *
     * @param basePlanId  The base plan ID for subscriptions. Pass null for INAPP (lifetime).
     */
    private fun _launchWithDetails(
        activity: Activity,
        productDetails: ProductDetails,
        basePlanId: String?
    ) {
        val paramsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(productDetails)

        if (basePlanId != null) {
            // Filter to only the offers for this base plan, then pick the best one
            val offersForPlan = productDetails.subscriptionOfferDetails
                ?.filter { it.basePlanId == basePlanId }
                .orEmpty()

            val bestOffer = _selectBestOffer(offersForPlan)
            if (bestOffer == null) {
                Log.w(TAG, "No offer found for basePlanId='$basePlanId'")
                listener.onBillingError(-1, "Plan offer not available")
                return
            }
            Log.d(TAG, "Selected offer: basePlan=$basePlanId offerId=${bestOffer.offerId}")
            paramsBuilder.setOfferToken(bestOffer.offerToken)
        }

        val flowParamsBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(paramsBuilder.build()))
            // FIX: Required in some regions (e.g. EU) to disclose personalised pricing.
            // Set to true only if you serve different prices to different users.
            .setIsOfferPersonalized(false)

        // FIX: Upgrade / downgrade — if the user already has an active subscription,
        // pass the existing purchase token so Play replaces it rather than stacking
        // a second subscription on top. Without this, switching monthly→annual opens
        // a second active sub and billing clients can reject the purchase entirely.
        val existingToken = activeSubsPurchaseToken
        if (basePlanId != null && existingToken != null) {
            Log.d(TAG, "Existing sub token found — launching as upgrade/downgrade")
            flowParamsBuilder.setSubscriptionUpdateParams(
                BillingFlowParams.SubscriptionUpdateParams.newBuilder()
                    .setOldPurchaseToken(existingToken)
                    // WITH_TIME_PRORATION: credits unused time on the old plan and
                    // charges the new plan immediately, pro-rated. Change to CHARGE_FULL_PRICE
                    // or DEFERRED if your pricing strategy requires it.
                    .setSubscriptionReplacementMode(
                        BillingFlowParams.SubscriptionUpdateParams.ReplacementMode.WITH_TIME_PRORATION
                    )
                    .build()
            )
        }

        val billingFlowParams = flowParamsBuilder.build()

        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) {
                Log.w(TAG, "Activity gone before billing flow could launch")
                return@runOnUiThread
            }
            val flowResult = billingClient?.launchBillingFlow(activity, billingFlowParams)
            if (flowResult?.responseCode != BillingClient.BillingResponseCode.OK) {
                listener.onBillingError(
                    flowResult?.responseCode ?: -1,
                    flowResult?.debugMessage ?: "Could not launch billing"
                )
            }
        }
    }

    // ── Restore ───────────────────────────────────────────────────

    /**
     * Re-queries purchases from Play — handles reinstall, device switch, restore tap.
     *
     * If billing isn't connected yet, connect() is called. The restoreCallback will be
     * invoked once queryExistingPurchases() completes — or immediately with false if
     * the connection itself fails (so the UI is never left in a waiting state).
     */
    fun restorePurchases(onComplete: ((Boolean) -> Unit)? = null) {
        restoreCallback = onComplete
        if (!isConnected) { connect(); return }
        queryExistingPurchases()
    }

    // ── Internal ──────────────────────────────────────────────────

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                if (purchases.isNullOrEmpty()) {
                    // FIX: purchases can legitimately be null/empty on OK (e.g. billing flow
                    // completed but there's no new purchase to report). Re-query to ensure
                    // local state stays in sync rather than silently doing nothing.
                    queryExistingPurchases()
                } else {
                    purchases.forEach { handlePurchase(it) }
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                Log.d(TAG, "User cancelled purchase")
                // No error — user chose not to buy
            }
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                // Edge case: user already has it but local cache missed it
                queryExistingPurchases()
            }
            else -> {
                listener.onBillingError(result.responseCode, result.debugMessage)
            }
        }
    }

    private fun queryExistingPurchases() {
        val inappParams = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()
        val subsParams = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()

        billingClient?.queryPurchasesAsync(inappParams) { inappResult, inappPurchases ->
            billingClient?.queryPurchasesAsync(subsParams) { subsResult, subsPurchases ->
                val allPurchases = mutableListOf<Purchase>()
                if (inappResult.responseCode == BillingClient.BillingResponseCode.OK)
                    allPurchases.addAll(inappPurchases)
                if (subsResult.responseCode == BillingClient.BillingResponseCode.OK)
                    allPurchases.addAll(subsPurchases)

                // FIX: Keep activeSubsPurchaseToken up-to-date so upgrade/downgrade flows
                // always have the current token ready without a separate query.
                activeSubsPurchaseToken = subsPurchases
                    .firstOrNull { purchase ->
                        purchase.products.any { it in PRO_PRODUCT_IDS } &&
                                purchase.purchaseState == Purchase.PurchaseState.PURCHASED
                    }?.purchaseToken

                // isPro = any Pro purchase is PURCHASED state only.
                // SEC-11 FIX: Removed PENDING state from Pro grant. A PENDING purchase
                // (cash kiosk, carrier billing) is not a completed transaction. Granting
                // access for PENDING opens a bypass: user initiates a payment designed
                // to fail, gets Pro features, then cancels. Access granted on PURCHASED only.
                val hasPro = allPurchases.any { purchase ->
                    purchase.products.any { it in PRO_PRODUCT_IDS } &&
                            purchase.purchaseState == Purchase.PurchaseState.PURCHASED
                }

                // Acknowledge any unacknowledged PURCHASED Pro purchases.
                // Never acknowledge PENDING — only acknowledge once PURCHASED.
                allPurchases.filter { purchase ->
                    purchase.products.any { it in PRO_PRODUCT_IDS } &&
                            purchase.purchaseState == Purchase.PurchaseState.PURCHASED &&
                            !purchase.isAcknowledged
                }.forEach { acknowledgePurchase(it) }

                Log.d(TAG, "Queried purchases — isPro: $hasPro | activeSubToken: $activeSubsPurchaseToken")
                listener.onProStatusChanged(hasPro)
                restoreCallback?.invoke(hasPro)
                restoreCallback = null
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        if (!purchase.products.any { it in PRO_PRODUCT_IDS }) return

        // FIX: handle all purchase states explicitly instead of only PURCHASED.
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                val valid = PurchaseVerifier.verify(
                    purchase.originalJson,
                    purchase.signature
                )

                if (valid) {
                    // Update active sub token for upgrade/downgrade support
                    if (purchase.products.any { it == PRODUCT_ID_SUBSCRIPTION }) {
                        activeSubsPurchaseToken = purchase.purchaseToken
                    }
                    listener.onProStatusChanged(true)
                    if (!purchase.isAcknowledged) acknowledgePurchase(purchase)
                } else {
                    Log.w(TAG, "Purchase signature invalid — not granting Pro")
                    listener.onBillingError(-2, "Purchase verification failed")
                }
            }
            Purchase.PurchaseState.PENDING -> {
                // SEC-11 FIX: Do NOT grant Pro access for PENDING purchases.
                // Log only. When the payment completes, Play will call onPurchasesUpdated
                // with PURCHASED state and Pro access will be granted then.
                Log.d(TAG, "Purchase PENDING — waiting for payment to complete before granting Pro")
                // Do NOT call listener.onProStatusChanged(true) here.
            }
            else -> {
                Log.d(TAG, "Purchase in unexpected state: ${purchase.purchaseState}")
            }
        }
    }

    private fun acknowledgePurchase(purchase: Purchase) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()

        billingClient?.acknowledgePurchase(params) { result ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(TAG, "Purchase acknowledged: ${purchase.purchaseToken.take(12)}…")
            } else {
                Log.w(TAG, "Acknowledgement failed: ${result.debugMessage}")
            }
        }
    }
}