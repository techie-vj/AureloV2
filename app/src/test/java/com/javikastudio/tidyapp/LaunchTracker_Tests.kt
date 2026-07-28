package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * LaunchTracker Tests  |  Feature Ref §13.2 (Widget Smart Routine)
 *
 * PP-030 — Verify LaunchTracker.getSlotFrequencyPercent() handles out-of-range
 * dayOfWeek values 0 and 8 without SQL error (SEC-02 SQL injection guard).
 *
 * NOTE: this is the REAL PP-030 test. A test previously labeled "PP030" in
 * PermissionsPrivacy_Tests.kt actually tested Screen Filter screenshot
 * exclusion — an unrelated, mislabeled case. This file covers the actual
 * PP-030 scenario: LaunchTracker.kt:277-289, day_of_week SQL filter boundary.
 *
 * The full method requires a live SQLCipher-backed Context and can't run on
 * the JVM, so the boundary decision itself (LaunchTracker.dayOfWeekFilterClause,
 * extracted in Phase 2) is tested directly here instead.
 */
class LaunchTracker_Tests {

    @Test
    fun `PP030 dayOfWeek=0 below valid range resolves to empty filter clause — no SQL error`() {
        assertEquals("", LaunchTracker.dayOfWeekFilterClause(0))
    }

    @Test
    fun `PP030 dayOfWeek=8 above valid range resolves to empty filter clause — no SQL error`() {
        assertEquals("", LaunchTracker.dayOfWeekFilterClause(8))
    }

    @Test
    fun `PP030 sentinel dayOfWeek=-1 (no filter requested) resolves to empty filter clause`() {
        assertEquals("", LaunchTracker.dayOfWeekFilterClause(-1))
    }

    @Test
    fun `dayOfWeek within valid Calendar range 1 to 7 includes the filter clause`() {
        for (day in 1..7) {
            assertEquals("Day $day should include the filter", " AND day_of_week = ?", LaunchTracker.dayOfWeekFilterClause(day))
        }
    }

    @Test
    fun `dayOfWeek far out of range — large positive and negative values — resolves to empty clause`() {
        assertEquals("", LaunchTracker.dayOfWeekFilterClause(100))
        assertEquals("", LaunchTracker.dayOfWeekFilterClause(-100))
    }
}
