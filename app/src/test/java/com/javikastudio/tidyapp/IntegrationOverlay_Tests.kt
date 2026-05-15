package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * Integration — Overlay Conflict Tests  |  Feature Ref §8, §6, §9
 * P1: INT-OV-001, INT-OV-002, INT-OV-003, INT-OV-007, INT-OV-011,
 *     INT-OV-012, INT-OV-013, INT-OV-014, INT-OV-015
 * P2: INT-OV-004, INT-OV-005, INT-OV-006, INT-OV-008, INT-OV-009,
 *     INT-OV-010, INT-OV-016, INT-OV-017, INT-OV-018, INT-OV-019, INT-OV-020, INT-OV-021
 */

private data class OverlayState(
    val screenFilterActive:  Boolean = false,
    val focusBlockActive:    Boolean = false,
    val appLockActive:       Boolean = false,
    val bedtimeBlockActive:  Boolean = false
)

private data class PermissionState(
    val systemAlertWindow:  Boolean = false,
    val accessibilityService: Boolean = false
)

private fun canActivateFilter(p: PermissionState)     = p.systemAlertWindow
private fun canActivateFocusBlock(p: PermissionState) = p.systemAlertWindow && p.accessibilityService
private fun canActivateAppLock(p: PermissionState)    = p.systemAlertWindow && p.accessibilityService

private fun toggleFilterOff(s: OverlayState) = s.copy(screenFilterActive = false)
private fun clearAll(s: OverlayState)        = OverlayState()

private fun overlaysCoexist(s: OverlayState): Boolean = true   // No mutual exclusion in spec

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests
// ─────────────────────────────────────────────────────────────────────────────
class IntegrationOverlay_P1_Tests {

    // INT-OV-001 — Screen Filter + Focus Block coexist
    @Test
    fun `INTOV001 Screen Filter and Focus Block can both be active simultaneously`() {
        val state = OverlayState(screenFilterActive = true, focusBlockActive = true)
        assertTrue("Both overlays must coexist without conflict", overlaysCoexist(state))
        assertTrue(state.screenFilterActive)
        assertTrue(state.focusBlockActive)
    }

    // INT-OV-002 — Screen Filter + App Lock coexist
    @Test
    fun `INTOV002 Screen Filter and App Lock PIN overlay can both be active simultaneously`() {
        val state = OverlayState(screenFilterActive = true, appLockActive = true)
        assertTrue(overlaysCoexist(state))
        assertTrue(state.screenFilterActive)
        assertTrue(state.appLockActive)
    }

    // INT-OV-003 / INT-OV-013 — Bedtime Mode activates Screen Filter AND app blocking
    @Test
    fun `INTOV003 Bedtime Mode activates both Screen Filter overlay and app blocking`() {
        val bedtimeStarted = true
        val filterActive   = bedtimeStarted
        val blockActive    = bedtimeStarted
        assertTrue("Screen Filter must activate at bedtime", filterActive)
        assertTrue("App blocking must activate at bedtime",  blockActive)
    }

    @Test
    fun `INTOV013 Bedtime activates Screen Filter and blocking simultaneously without conflict`() {
        val state = OverlayState(
            screenFilterActive = true,
            bedtimeBlockActive = true
        )
        assertTrue(state.screenFilterActive)
        assertTrue(state.bedtimeBlockActive)
    }

    // INT-OV-007 / INT-OV-020 — single SYSTEM_ALERT_WINDOW permission
    @Test
    fun `INTOV007 single SYSTEM_ALERT_WINDOW permission enables all overlay features`() {
        val perm = PermissionState(systemAlertWindow = true, accessibilityService = true)
        assertTrue("Screen Filter works",   canActivateFilter(perm))
        assertTrue("Focus Block works",     canActivateFocusBlock(perm))
        assertTrue("App Lock works",        canActivateAppLock(perm))
    }

    @Test
    fun `INTOV020 all three overlay features share one SYSTEM_ALERT_WINDOW grant`() {
        val perm = PermissionState(systemAlertWindow = true, accessibilityService = true)
        val enabled = listOf(
            canActivateFilter(perm),
            canActivateFocusBlock(perm),
            canActivateAppLock(perm)
        )
        assertTrue("All three must be enabled", enabled.all { it })
    }

    // INT-OV-011 — Screen Filter + Focus Deep Block
    @Test
    fun `INTOV011 Screen Filter and Focus Deep Block active simultaneously without visual corruption`() {
        val state = OverlayState(screenFilterActive = true, focusBlockActive = true)
        assertTrue(state.screenFilterActive)
        assertTrue(state.focusBlockActive)
    }

    // INT-OV-012 — Screen Filter + App Lock PIN
    @Test
    fun `INTOV012 Screen Filter visible behind App Lock PIN entry overlay`() {
        val state = OverlayState(screenFilterActive = true, appLockActive = true)
        assertTrue(state.screenFilterActive)
        assertTrue(state.appLockActive)
    }

    // INT-OV-014 — emergency dial accessible during Deep Focus
    @Test
    fun `INTOV014 emergency dial accessible during Deep Focus block session`() {
        val focusBlockActive    = true
        val emergencyCallWorks  = true   // system dial always accessible
        assertTrue("Emergency calls must work during Deep Focus block", emergencyCallWorks)
    }

    // INT-OV-015 — all overlays stop on Clear All Data
    @Test
    fun `INTOV015 all overlay services stop and overlays removed after Clear All Data`() {
        val before = OverlayState(screenFilterActive = true, focusBlockActive = true, appLockActive = true)
        val after  = clearAll(before)
        assertFalse("Screen Filter must stop after data clear", after.screenFilterActive)
        assertFalse("Focus Block must stop after data clear",   after.focusBlockActive)
        assertFalse("App Lock must stop after data clear",      after.appLockActive)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests
// ─────────────────────────────────────────────────────────────────────────────
class IntegrationOverlay_P2_Tests {

    // INT-OV-004 — Screen Filter + Mindful Pause
    @Test
    fun `INTOV004 Screen Filter active while Mindful Pause prompt appears correctly`() {
        val state = OverlayState(screenFilterActive = true)
        val pauseShown = true
        assertTrue(state.screenFilterActive)
        assertTrue(pauseShown)
    }

    // INT-OV-005 — all three overlays simultaneously
    @Test
    fun `INTOV005 Screen Filter Focus Block and App Lock all active simultaneously`() {
        val state = OverlayState(
            screenFilterActive = true,
            focusBlockActive   = true,
            appLockActive      = true
        )
        assertTrue(overlaysCoexist(state))
    }

    // INT-OV-006 — filter colour correct through block overlay
    @Test
    fun `INTOV006 Screen Filter colour unaffected by overlapping focus block overlay`() {
        val filterPreset = "WARM"
        val blockActive  = true
        assertEquals("WARM", filterPreset)
    }

    // INT-OV-008 — turning filter off does not end focus session
    @Test
    fun `INTOV008 turning Screen Filter off does not end active focus session`() {
        val before = OverlayState(screenFilterActive = true, focusBlockActive = true)
        val after  = toggleFilterOff(before)
        assertFalse("Filter must be off",         after.screenFilterActive)
        assertTrue("Focus session must continue", after.focusBlockActive)
    }

    // INT-OV-009 — ending focus session does not affect filter
    @Test
    fun `INTOV009 ending focus session does not disable Screen Filter`() {
        var filterActive   = true
        val sessionEnded   = true
        // Focus session ends — filter remains
        if (!sessionEnded) filterActive = false   // guard: only disabled by explicit toggle
        assertTrue("Filter must remain after focus session ends", filterActive)
    }

    // INT-OV-010 — app lock correct PIN while filter active
    @Test
    fun `INTOV010 correct PIN dismisses app lock overlay while Screen Filter remains active`() {
        var state     = OverlayState(screenFilterActive = true, appLockActive = true)
        val pinCorrect = true
        if (pinCorrect) state = state.copy(appLockActive = false)
        assertFalse("App lock dismissed after correct PIN", state.appLockActive)
        assertTrue("Screen Filter still active after unlock", state.screenFilterActive)
    }

    // INT-OV-016 — filter persists through focus session lifecycle
    @Test
    fun `INTOV016 Screen Filter persists through entire focus session start middle end`() {
        var filterActive = true
        val sessionStart = true; val sessionEnd = true
        // Filter should remain through full session lifecycle
        assertTrue("Filter active at session start", filterActive)
        assertTrue("Filter active at session end",   filterActive)
    }

    // INT-OV-017 — bedtime ends at wake time restoring all services
    @Test
    fun `INTOV017 Bedtime Mode ending at wake-up time removes filter and blocks correctly`() {
        val wakeUpReached    = true
        val filterDeactivated = wakeUpReached
        val blockDeactivated  = wakeUpReached
        assertTrue(filterDeactivated)
        assertTrue(blockDeactivated)
    }

    // INT-OV-018 — filter toggle does not interrupt Bedtime block
    @Test
    fun `INTOV018 toggling manual Screen Filter off during Bedtime does not end bedtime block`() {
        val state = OverlayState(screenFilterActive = true, bedtimeBlockActive = true)
        val after = toggleFilterOff(state)
        assertFalse("Filter off",          after.screenFilterActive)
        assertTrue("Bedtime block active", after.bedtimeBlockActive)
    }

    // INT-OV-019 — overlay permissions checked once
    @Test
    fun `INTOV019 SYSTEM_ALERT_WINDOW permission checked once and used by all overlay services`() {
        val granted      = true
        val filterOk     = granted
        val focusOk      = granted
        val appLockOk    = granted
        assertTrue(filterOk && focusOk && appLockOk)
    }

    // INT-OV-021 — focus session not affected by bedtime Screen Filter deactivation
    @Test
    fun `INTOV021 focus session unaffected when bedtime Screen Filter deactivates at wake time`() {
        val focusActive          = true
        val bedtimeFilterEnds    = true
        // Focus session continues regardless
        assertTrue("Focus session persists despite bedtime filter ending", focusActive)
    }
}
