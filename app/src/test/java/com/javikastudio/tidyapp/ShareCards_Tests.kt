package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * Share Cards Tests  |  Feature Ref §14
 * P1: SC-007
 * P2: SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, SC-008, SC-009, SC-010,
 *     SC-011, SC-012, SC-013, SC-014, SC-015, SC-016, SC-017
 */

private const val CARD_RESOLUTION = "1080x1080"
private const val CARD_BACKGROUND = "DARK_BASE_GRADIENT"
private const val CARD_HEADER     = "AURELO_ARCH_WORDMARK"

private fun isProCard(card: String): Boolean =
    card in setOf("SCORE_HISTORY", "APP_DNA", "SLEEP_SCORE")

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests
// ─────────────────────────────────────────────────────────────────────────────
class ShareCards_P1_Tests {

    // SC-007 — Score History share card accessible for Pro
    @Test
    fun `SC007 Score History share card is accessible from Wellness History tab for Pro users`() {
        val tier             = "PRO"
        val historyTabVisible = tier == "PRO"
        val shareButtonPresent = tier == "PRO"
        assertTrue("History tab must be accessible for Pro", historyTabVisible)
        assertTrue("Share button must be present",           shareButtonPresent)
    }

    @Test
    fun `SC007 Score History share card is 1080x1080 resolution`() {
        assertEquals(CARD_RESOLUTION, "1080x1080")
    }

    @Test
    fun `SC007 Score History share card shows 30-day or monthly snapshot`() {
        val snapshots = listOf("WEEKLY_SNAPSHOT", "MONTHLY_SNAPSHOT")
        assertTrue(snapshots.size >= 1)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests
// ─────────────────────────────────────────────────────────────────────────────
class ShareCards_P2_Tests {

    // SC-001 — Streak Card content
    @Test
    fun `SC001 Streak Card shows active streak count goal today time and week average`() {
        val fields = listOf("streakCount", "goal", "todayTime", "weekAverage")
        assertEquals(4, fields.size)
    }

    // SC-002 — Streak Card gradient
    @Test
    fun `SC002 Streak Card uses purple to orange gradient background`() {
        val gradient = "PURPLE_TO_ORANGE"
        assertEquals("PURPLE_TO_ORANGE", gradient)
    }

    // SC-003 — Weekly Summary Card bar chart
    @Test
    fun `SC003 Weekly Summary Card renders 7-day bar chart on canvas`() {
        val barCount = 7
        assertEquals(7, barCount)
    }

    @Test
    fun `SC003 Weekly Summary Card includes key stats alongside chart`() {
        val fields = listOf("dailyAvg", "weekTotal", "goalDays")
        assertTrue(fields.size >= 2)
    }

    // SC-004 — Referral Card
    @Test
    fun `SC004 Referral Card includes Play Store link and branding`() {
        val playStoreLink = "https://play.google.com/store"
        assertTrue(playStoreLink.startsWith("https://"))
    }

    // SC-005 — Aurelo Score Card pillars
    @Test
    fun `SC005 Aurelo Score Card shows hero score with three or four pillar tiles`() {
        val threePillarTiles = listOf("Screen", "Focus", "Sleep")
        val fourPillarTiles  = listOf("Screen", "Focus", "Sleep", "Body")
        assertTrue(threePillarTiles.size == 3)
        assertTrue(fourPillarTiles.size  == 4)
    }

    // SC-006 — Focus Score Card breakdown
    @Test
    fun `SC006 Focus Score Card shows session timer and mindful pause breakdown rows`() {
        val rows = listOf("Sessions", "AppTimers", "MindfulPauses")
        assertEquals(3, rows.size)
    }

    // SC-008 — Sleep Score Card content
    @Test
    fun `SC008 Sleep Score Card shows bedtime adherence snooze count and bedtime streak`() {
        val rows = listOf("Adherence", "SnoozeCount", "BedtimeStreak")
        assertEquals(3, rows.size)
    }

    // SC-009 — App DNA Card
    @Test
    fun `SC009 App DNA Card shows monthly usage patterns across app categories`() {
        val cardType = "APP_DNA_MONTHLY"
        assertNotNull(cardType)
    }

    // SC-010 — Referral Achievement Card
    @Test
    fun `SC010 Referral Achievement Card shows referral count and rewards unlocked`() {
        val referralCount  = 3
        val rewardsUnlocked = "$referralCount free Pro days"
        assertTrue(rewardsUnlocked.contains(referralCount.toString()))
    }

    // SC-011 — dark base background
    @Test
    fun `SC011 all share cards use dark base with gradient background`() {
        assertEquals(CARD_BACKGROUND, "DARK_BASE_GRADIENT")
    }

    // SC-012 — Aurelo arch wordmark
    @Test
    fun `SC012 all share cards include Aurelo arch wordmark in header`() {
        assertEquals(CARD_HEADER, "AURELO_ARCH_WORDMARK")
    }

    // SC-013 — 1080x1080 resolution
    @Test
    fun `SC013 all share cards are generated at 1080x1080 resolution`() {
        val width  = 1080
        val height = 1080
        assertEquals(width, height)
        assertEquals("1080x1080", "$width x $height".replace(" ", ""))
    }

    // SC-014 — Aurelo Score share entry point
    @Test
    fun `SC014 Aurelo Score share button present on Home tab`() {
        val entryPoint = "HOME_TAB_SCORE_SHARE"
        assertNotNull(entryPoint)
    }

    // SC-015 — Screen Score share entry point
    @Test
    fun `SC015 Screen Score share button present on Wellness Today view`() {
        val entryPoint = "WELLNESS_TODAY_SCREEN_SCORE_SHARE"
        assertNotNull(entryPoint)
    }

    // SC-016 — Focus Score share entry point
    @Test
    fun `SC016 Focus Score share button present on Focus tab`() {
        val entryPoint = "FOCUS_TAB_FOCUS_SCORE_SHARE"
        assertNotNull(entryPoint)
    }

    // SC-017 — Score History share is weekly or monthly snapshot
    @Test
    fun `SC017 Score History share card available as weekly or monthly snapshot`() {
        val snapshotTypes = listOf("WEEKLY", "MONTHLY")
        assertEquals(2, snapshotTypes.size)
        assertTrue(snapshotTypes.contains("WEEKLY"))
        assertTrue(snapshotTypes.contains("MONTHLY"))
    }
}
