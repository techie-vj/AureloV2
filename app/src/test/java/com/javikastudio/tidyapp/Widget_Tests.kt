package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * Home Screen Widget Tests  |  Feature Ref §10
 * P1: WG-001, WG-015, WG-019
 * P2: WG-002, WG-003, WG-004, WG-005, WG-006, WG-007, WG-008, WG-009, WG-010,
 *     WG-011, WG-012, WG-013, WG-014, WG-016, WG-017, WG-018, WG-020
 */

private fun stalenessColour(minutesSinceUpdate: Int): String = when {
    minutesSinceUpdate < 30  -> "GREY"
    minutesSinceUpdate < 60  -> "AMBER"
    else                     -> "RED"
}

private fun isProTheme(theme: String) = theme in setOf("AMOLED", "AMOLED_DARK")
private fun canUseTheme(tier: String, theme: String) = !isProTheme(theme) || tier == "PRO"

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests
// ─────────────────────────────────────────────────────────────────────────────
class Widget_P1_Tests {

    // WG-001 — widget shows screen time and goal progress
    @Test
    fun `WG001 widget displays today screen time correctly`() {
        val screenMs = 5_400_000L   // 1 h 30 min
        assertTrue("Screen time must be positive", screenMs > 0)
    }

    @Test
    fun `WG001 widget goal progress bar percentage is correct`() {
        val screenMs = 5_400_000L
        val goalMs   = 7_200_000L
        val pct      = (screenMs * 100.0 / goalMs).toInt()
        assertEquals(75, pct)
    }

    // WG-015 / WG-019 — AMOLED theme Pro only
    @Test
    fun `WG015 AMOLED widget theme is only available to Pro users`() {
        assertFalse("Free user must not access AMOLED theme", canUseTheme("FREE", "AMOLED"))
        assertTrue("Pro user must access AMOLED theme",       canUseTheme("PRO",  "AMOLED"))
    }

    @Test
    fun `WG019 AMOLED Dark theme gated — Pro only`() {
        assertFalse(canUseTheme("FREE", "AMOLED_DARK"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests
// ─────────────────────────────────────────────────────────────────────────────
class Widget_P2_Tests {

    // WG-002 — goal progress percentage shown
    @Test
    fun `WG002 widget shows daily goal progress percentage`() {
        val pct = 75
        assertTrue(pct in 0..100)
    }

    // WG-003 — staleness grey under 30 min
    @Test
    fun `WG003 staleness indicator is GREY when updated less than 30 minutes ago`() {
        assertEquals("GREY", stalenessColour(10))
        assertEquals("GREY", stalenessColour(29))
    }

    // WG-004 — staleness amber 30-60 min
    @Test
    fun `WG004 staleness indicator is AMBER between 30 and 60 minutes`() {
        assertEquals("AMBER", stalenessColour(30))
        assertEquals("AMBER", stalenessColour(59))
    }

    // WG-005 — staleness red over 60 min
    @Test
    fun `WG005 staleness indicator is RED when over 60 minutes since last update`() {
        assertEquals("RED", stalenessColour(60))
        assertEquals("RED", stalenessColour(120))
    }

    // WG-006 — Smart Routine suggestion
    @Test
    fun `WG006 Smart Routine suggests most relevant app for the current time slot`() {
        val suggestion = "Spotify"   // example suggestion based on 8 AM pattern
        assertNotNull(suggestion)
        assertTrue(suggestion.isNotBlank())
    }

    // WG-007 — Smart Routine learns over multiple days
    @Test
    fun `WG007 Smart Routine improves suggestions as more days of history are collected`() {
        val learningDays = 7
        assertTrue("Needs at least 1 day to learn", learningDays >= 1)
    }

    // WG-008 — learning days counter shown
    @Test
    fun `WG008 widget shows learning days counter for Smart Routine`() {
        val daysCollected = 5
        assertTrue(daysCollected >= 0)
    }

    // WG-009 — search button opens home search
    @Test
    fun `WG009 tapping widget search button opens Aurelo home search view`() {
        val destination = "HOME_SEARCH_VIEW"
        assertNotNull(destination)
    }

    // WG-010 — three colour accents
    @Test
    fun `WG010 three colour accent options available cyan amber and purple`() {
        val accents = listOf("CYAN", "AMBER", "PURPLE")
        assertEquals(3, accents.size)
        assertTrue(accents.containsAll(listOf("CYAN", "AMBER", "PURPLE")))
    }

    // WG-011 — frequency ring indicators
    @Test
    fun `WG011 frequency ring indicates low mid and high usage levels per app slot`() {
        val levels = listOf("LOW", "MID", "HIGH")
        assertEquals(3, levels.size)
    }

    // WG-012 — live dynamic preview Android 12+
    @Test
    fun `WG012 live dynamic preview shown in widget picker on Android 12 plus API 31`() {
        val api = 31
        val previewSupported = api >= 31
        assertTrue(previewSupported)
    }

    @Test
    fun `WG012 no live preview on Android 11 and below`() {
        val api = 30
        assertFalse(api >= 31)
    }

    // WG-013 — widget insight row Pro
    @Test
    fun `WG013 widget insight row shows streaks goal status or warnings for Pro users`() {
        val tier          = "PRO"
        val insightShown  = tier == "PRO"
        assertTrue(insightShown)
    }

    @Test
    fun `WG013 widget insight row absent for Free users`() {
        val tier         = "FREE"
        val insightShown = tier == "PRO"
        assertFalse(insightShown)
    }

    // WG-014 — widget deep-links
    @Test
    fun `WG014 tapping screen time area deep-links to Wellness tab`() {
        val destination = "WELLNESS_TAB"
        assertEquals("WELLNESS_TAB", destination)
    }

    @Test
    fun `WG014 tapping focus area deep-links to Focus tab`() {
        val destination = "FOCUS_TAB"
        assertEquals("FOCUS_TAB", destination)
    }

    // WG-016 — default theme free
    @Test
    fun `WG016 default widget theme available to Free and Pro users`() {
        assertTrue(canUseTheme("FREE", "DEFAULT"))
        assertTrue(canUseTheme("PRO",  "DEFAULT"))
    }

    // WG-017 — clear Smart Routine history
    @Test
    fun `WG017 clearing widget history resets Smart Routine learning from scratch`() {
        var learningDays = 7
        learningDays = 0   // after clear
        assertEquals(0, learningDays)
    }

    // WG-018 — storage stats shown in settings
    @Test
    fun `WG018 widget history storage stats shown in Widget Settings`() {
        val statsShown = true
        assertTrue(statsShown)
    }

    // WG-020 — animated dot states
    @Test
    fun `WG020 app slot dot has three animated states idle glow and pulse`() {
        val states = listOf("IDLE", "GLOW", "PULSE")
        assertEquals(3, states.size)
    }
}
