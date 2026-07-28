package com.javikastudio.tidyapp.billing

/**
 * OfferSelector — picks the best subscription offer from a set of offers on the
 * same base plan.
 *
 * Extracted from BillingManager._selectBestOffer() (Phase 2 test-quality fix).
 * Operates on the plain [OfferSignature] data class instead of the real Play
 * Billing `ProductDetails.SubscriptionOfferDetails` (a library-internal type that
 * cannot be constructed directly in a JVM unit test), so this decision logic can
 * be tested with real fixtures instead of a duplicated mirror. BillingManager maps
 * real SDK offers to [OfferSignature] and delegates here — no behaviour change.
 *
 * Priority order:
 *  1. Free-trial offer     — any pricing phase has zero price
 *  2. Intro-price offer    — first phase priced but non-zero and non-recurring
 *  3. Bare base-plan offer — offerId == null (no promotional offer attached)
 *  4. Fallback             — first offer in the list
 */
object OfferSelector {

    // ProductDetails.RecurrenceMode.NON_RECURRING (int @IntDef — not directly importable)
    const val RECURRENCE_NON_RECURRING = 3

    data class OfferSignature(
        val offerId: String?,
        val hasZeroPricePhase: Boolean,
        val firstPhasePriceMicros: Long?,
        val firstPhaseRecurrenceMode: Int?,
    )

    /** Returns the index of the best offer in [offers], or null if the list is empty. */
    fun selectBestIndex(offers: List<OfferSignature>): Int? {
        if (offers.isEmpty()) return null

        offers.indexOfFirst { it.hasZeroPricePhase }
            .takeIf { it >= 0 }?.let { return it }

        offers.indexOfFirst { offer ->
            offer.firstPhasePriceMicros != null &&
                offer.firstPhasePriceMicros > 0L &&
                offer.firstPhaseRecurrenceMode == RECURRENCE_NON_RECURRING
        }.takeIf { it >= 0 }?.let { return it }

        offers.indexOfFirst { it.offerId == null }
            .takeIf { it >= 0 }?.let { return it }

        return 0
    }
}
