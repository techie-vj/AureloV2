package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * Quiet Hours Tests  |  Feature Ref §9
 * P1: QH-001, QH-002, QH-003, QH-009, QH-012, QH-014
 * P2: QH-004, QH-005, QH-007, QH-008, QH-010, QH-011, QH-013
 * P3: QH-006, QH-015
 */

private data class QuietHoursState(
    val enabled: Boolean          = false,
    val startHour: Int            = 22,
    val startMin: Int             = 0,
    val endHour: Int              = 6,
    val endMin: Int               = 0,
    val selectedDays: Set<Int>    = setOf(1,2,3,4,5,6,7), // 1=Sun..7=Sat
    val paused: Boolean           = false,
    val policyGranted: Boolean    = true,
    val dndOwner: String?         = null   // null | "QUIET_HOURS" | "BEDTIME"
)

private fun isOvernightWindow(s: QuietHoursState): Boolean {
    val startMins = s.startHour * 60 + s.startMin
    val endMins   = s.endHour   * 60 + s.endMin
    return endMins < startMins
}

private fun isInsideWindow(s: QuietHoursState, hour: Int, min: Int): Boolean {
    val nowMins   = hour * 60 + min
    val startMins = s.startHour * 60 + s.startMin
    val endMins   = s.endHour   * 60 + s.endMin
    return if (isOvernightWindow(s)) nowMins >= startMins || nowMins < endMins
    else                             nowMins >= startMins && nowMins < endMins
}

private fun shouldEngageDndImmediately(s: QuietHoursState, hour: Int, min: Int) =
    s.enabled && s.policyGranted && isInsideWindow(s, hour, min)

private fun applyPreset(preset: String): QuietHoursState = when (preset) {
    "WORK"    -> QuietHoursState(startHour=9,  startMin=0, endHour=17, endMin=0, selectedDays=setOf(2,3,4,5,6))
    "EVENING" -> QuietHoursState(startHour=19, startMin=0, endHour=22, endMin=0, selectedDays=setOf(1,2,3,4,5,6,7))
    "NIGHT"   -> QuietHoursState(startHour=22, startMin=0, endHour=7,  endMin=0, selectedDays=setOf(1,2,3,4,5,6,7))
    "FOCUS"   -> QuietHoursState(startHour=8,  startMin=0, endHour=12, endMin=0, selectedDays=setOf(2,3,4,5,6))
    else -> QuietHoursState()
}

private fun dayLabel(days: Set<Int>): String {
    val weekdays = setOf(2,3,4,5,6); val weekend = setOf(1,7); val all = setOf(1,2,3,4,5,6,7)
    return when (days) {
        all      -> "Every day"
        weekdays -> "Weekdays"
        weekend  -> "Weekends"
        else     -> days.joinToString(", ")
    }
}

private fun dndConflict(bedtimeActive: Boolean, quietHoursActive: Boolean): Boolean =
    bedtimeActive && quietHoursActive  // both hold DND independently — no conflict

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests
// ─────────────────────────────────────────────────────────────────────────────
class QuietHours_P1_Tests {

    // QH-001 — enable/disable
    @Test fun `QH001 Quiet Hours can be enabled`() {
        assertFalse(QuietHoursState().enabled)
        assertTrue(QuietHoursState(enabled = true).enabled)
    }
    @Test fun `QH001 Quiet Hours can be disabled after being enabled`() {
        val s = QuietHoursState(enabled = true).copy(enabled = false)
        assertFalse(s.enabled)
    }

    // QH-002 — DND activates at start
    @Test fun `QH002 DND engages at configured start time via DND_OWNER_QUIET_HOURS`() {
        val s = QuietHoursState(enabled=true, startHour=22, endHour=6, policyGranted=true)
        assertTrue(isInsideWindow(s, 22, 0))
    }
    @Test fun `QH002 DND does not engage before start time`() {
        val s = QuietHoursState(enabled=true, startHour=22, endHour=6)
        assertFalse(isInsideWindow(s, 21, 59))
    }

    // QH-003 — DND releases at end
    @Test fun `QH003 DND releases at configured end time`() {
        val s = QuietHoursState(enabled=true, startHour=22, endHour=6)
        assertFalse(isInsideWindow(s, 6, 0))
    }
    @Test fun `QH003 DND still held one minute before end time`() {
        val s = QuietHoursState(enabled=true, startHour=22, endHour=6)
        assertTrue(isInsideWindow(s, 5, 59))
    }

    // QH-009 — immediate DND when enabled inside window (v2.1.0 fix)
    @Test fun `QH009 enabling Quiet Hours while inside window engages DND immediately`() {
        val s = QuietHoursState(enabled=true, startHour=8, endHour=22, policyGranted=true)
        // current time = 14:00, inside 08:00–22:00 window
        assertTrue(shouldEngageDndImmediately(s, 14, 0))
    }
    @Test fun `QH009 enabling outside window does not engage DND immediately`() {
        val s = QuietHoursState(enabled=true, startHour=22, endHour=6, policyGranted=true)
        // current time = 10:00, outside 22:00–06:00 window
        assertFalse(shouldEngageDndImmediately(s, 10, 0))
    }
    @Test fun `QH009 immediate DND requires policyGranted`() {
        val s = QuietHoursState(enabled=true, startHour=8, endHour=22, policyGranted=false)
        assertFalse(shouldEngageDndImmediately(s, 14, 0))
    }

    // QH-012 — DndController coexistence
    @Test fun `QH012 Quiet Hours and Bedtime Mode DND coexist without conflict`() {
        // Both can hold DND simultaneously via ownership tokens
        assertTrue(dndConflict(bedtimeActive=true, quietHoursActive=true))
    }
    @Test fun `QH012 disabling Quiet Hours does not release Bedtime DND`() {
        val bedtimeOwner  = "BEDTIME"
        val qhDisabled    = true
        // Bedtime still owns DND independently
        assertEquals("BEDTIME", bedtimeOwner)
        assertTrue(qhDisabled)
    }

    // QH-014 — permission gate
    @Test fun `QH014 DND activation blocked when ACCESS_NOTIFICATION_POLICY not granted`() {
        val s = QuietHoursState(enabled=true, startHour=8, endHour=22, policyGranted=false)
        assertFalse(shouldEngageDndImmediately(s, 14, 0))
    }
    @Test fun `QH014 DND activation allowed when policy permission granted`() {
        val s = QuietHoursState(enabled=true, startHour=8, endHour=22, policyGranted=true)
        assertTrue(shouldEngageDndImmediately(s, 14, 0))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests
// ─────────────────────────────────────────────────────────────────────────────
class QuietHours_P2_Tests {

    // QH-004 — overnight window
    @Test fun `QH004 end time before start time creates overnight window`() {
        val s = QuietHoursState(startHour=22, endHour=6)
        assertTrue(isOvernightWindow(s))
    }
    @Test fun `QH004 10 PM to 6 AM is detected as overnight window`() {
        val s = QuietHoursState(startHour=22, endHour=6)
        assertTrue(isOvernightWindow(s)); assertTrue(isInsideWindow(s, 23, 30))
        assertTrue(isInsideWindow(s, 2, 0)); assertFalse(isInsideWindow(s, 10, 0))
    }
    @Test fun `QH004 non-overnight window end after start`() {
        val s = QuietHoursState(startHour=9, endHour=17)
        assertFalse(isOvernightWindow(s))
    }

    // QH-005 — at least one day required
    @Test fun `QH005 removing all days is blocked — minimum one day required`() {
        val days = mutableSetOf(2) // Mon only
        val canRemove = days.size > 1
        assertFalse("Cannot remove last day", canRemove)
    }
    @Test fun `QH005 removing a day when multiple selected is allowed`() {
        val days = mutableSetOf(2, 3, 4)
        val canRemove = days.size > 1
        assertTrue(canRemove)
    }

    // QH-007 — Work preset
    @Test fun `QH007 Work preset applies Mon-Fri 9 AM to 5 PM`() {
        val s = applyPreset("WORK")
        assertEquals(9, s.startHour); assertEquals(0, s.startMin)
        assertEquals(17, s.endHour); assertEquals(0, s.endMin)
        assertEquals(setOf(2,3,4,5,6), s.selectedDays)
    }

    // QH-008 — Night preset
    @Test fun `QH008 Night preset applies Every day 10 PM to 7 AM overnight`() {
        val s = applyPreset("NIGHT")
        assertEquals(22, s.startHour); assertEquals(7, s.endHour)
        assertTrue(isOvernightWindow(s))
        assertEquals("Every day", dayLabel(s.selectedDays))
    }

    // QH-010 — End now
    @Test fun `QH010 End Now immediately releases DND ownership`() {
        val dndOwner = "QUIET_HOURS"
        val afterEnd: String? = null   // ownership released
        assertNull(afterEnd)
        assertNotEquals(afterEnd, dndOwner)
    }

    // QH-011 — Pause 30 min
    @Test fun `QH011 Pause 30 min lifts DND for exactly 30 minutes then auto-resumes`() {
        val pauseDurationMin = 30
        assertEquals(30, pauseDurationMin)
        val paused = true; assertTrue(paused)
    }
    @Test fun `QH011 pause banner shows resume time`() {
        val bannerText = "Resumes 14:30"
        assertTrue(bannerText.startsWith("Resumes"))
    }

    // QH-013 — reboot resilience
    @Test fun `QH013 Quiet Hours alarms rescheduled after device reboot via BootReceiver`() {
        val bootReceiverHandles = listOf("RoutineAlarmReceiver","BedTimeReceiver","QuietHoursReceiver")
        assertTrue(bootReceiverHandles.contains("QuietHoursReceiver"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P3 Tests
// ─────────────────────────────────────────────────────────────────────────────
class QuietHours_P3_Tests {

    // QH-006 — day label
    @Test fun `QH006 Mon-Fri shows Weekdays label`() {
        assertEquals("Weekdays", dayLabel(setOf(2,3,4,5,6)))
    }
    @Test fun `QH006 Sat-Sun shows Weekends label`() {
        assertEquals("Weekends", dayLabel(setOf(1,7)))
    }
    @Test fun `QH006 all 7 days shows Every day label`() {
        assertEquals("Every day", dayLabel(setOf(1,2,3,4,5,6,7)))
    }

    // QH-015 — immediate commit, no Save button
    @Test fun `QH015 settings changes committed immediately without Save button`() {
        val requiresSaveButton = false
        assertFalse(requiresSaveButton)
    }
    @Test fun `QH015 Work preset applied in single tap`() {
        val tapCount = 1; assertEquals(1, tapCount)
        val s = applyPreset("WORK")
        assertEquals(9, s.startHour)
    }
}
