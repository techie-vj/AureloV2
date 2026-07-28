package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * SmartNotificationWorker Tests  |  Feature Ref §14  |  Test Report FUN-06
 *
 * SN-022 — Verify SmartNotificationWorker at hour=20 twice same day sends
 * daily recap exactly once (lastRecapDate deduplication guard).
 *
 * doWork() itself requires a full WorkManager/NotificationManager/Context
 * environment and can't run on the JVM, so the pure dedup predicate
 * (SmartNotificationWorker.shouldPostDailyRecap, extracted in Phase 2)
 * is tested directly instead — this is the exact boolean doWork() branches on.
 */
class SmartNotificationWorker_Tests {

    @Test
    fun `SN022 first doWork call same day with no prior recap sent — recap should post`() {
        assertTrue(SmartNotificationWorker.shouldPostDailyRecap(lastRecapDate = "", todayStr = "2026-209", todayMins = 120L))
    }

    @Test
    fun `SN022 second doWork call same calendar day — lastRecapDate matches, recap must NOT post again`() {
        // First call would have set lastRecapDate = todayStr after posting.
        assertFalse(SmartNotificationWorker.shouldPostDailyRecap(lastRecapDate = "2026-209", todayStr = "2026-209", todayMins = 145L))
    }

    @Test
    fun `SN022 next calendar day — lastRecapDate from yesterday no longer matches — recap posts fresh`() {
        assertTrue(SmartNotificationWorker.shouldPostDailyRecap(lastRecapDate = "2026-209", todayStr = "2026-210", todayMins = 30L))
    }

    @Test
    fun `recap does not post when there is no meaningful usage data yet (todayMins = 0)`() {
        assertFalse(SmartNotificationWorker.shouldPostDailyRecap(lastRecapDate = "", todayStr = "2026-209", todayMins = 0L))
    }
}
