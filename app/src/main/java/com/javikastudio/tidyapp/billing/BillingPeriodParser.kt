package com.javikastudio.tidyapp.billing

/**
 * BillingPeriodParser — parses Play Billing ISO 8601 period strings to days.
 *
 * Extracted from BillingManager.parsePeriodToDays() (Phase 2 test-quality fix)
 * so the H6 regex-parsing fix can be regression-tested directly. Pure function,
 * no Android dependencies.
 */
object BillingPeriodParser {

    /**
     * Parses an ISO 8601 period string ("P7D", "P1W", "P1M", "P1Y") to approximate days.
     * Compound periods (e.g. P2W3D) are not issued by Play Console UI so this simple
     * parser covers all currently issued billing periods. "PT..." (time-only, e.g. "PT0S")
     * returns 0 since there's no day component (this was the H6 bug: the previous
     * drop(1).dropLast(1).toInt() implementation threw on "PT0S" and silently returned 0
     * for ALL periods, not just time-only ones).
     */
    fun parseToDays(period: String): Int {
        if (period.isBlank()) return 0
        return try {
            val upper = period.uppercase()
            if (upper.startsWith("PT")) return 0
            val years  = Regex("(\\d+)Y").find(upper)?.groupValues?.get(1)?.toIntOrNull() ?: 0
            val months = Regex("(\\d+)M").find(upper)?.groupValues?.get(1)?.toIntOrNull() ?: 0
            val weeks  = Regex("(\\d+)W").find(upper)?.groupValues?.get(1)?.toIntOrNull() ?: 0
            val days   = Regex("(\\d+)D").find(upper)?.groupValues?.get(1)?.toIntOrNull() ?: 0
            years * 365 + months * 30 + weeks * 7 + days
        } catch (e: Exception) { 0 }
    }
}
