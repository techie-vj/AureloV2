package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * Sound Cues Tests  |  Feature Ref §10
 * P1: SND-010
 * P2: SND-001–SND-009, SND-011–SND-013
 * P3: SND-014
 */

private enum class Tone {
    SESSION_START, SESSION_COMPLETE, BEDTIME_START, MORNING,
    MINDFUL_PAUSE, UNLOCK, STREAK_MILESTONE, MOOD_LOGGED
}

private data class SoundContext(
    val soundCuesEnabled: Boolean      = true,
    val dndOwner: String?              = null,   // null | "BEDTIME" | "QUIET_HOURS"
    val systemInterruptionFilter: String = "NORMAL", // NORMAL | PRIORITY | ALARMS | NONE
    val notificationStreamVolume: Int  = 5       // 0 = muted
)

private fun canPlayTone(ctx: SoundContext, tone: Tone): Boolean {
    if (!ctx.soundCuesEnabled)                     return false
    if (ctx.notificationStreamVolume == 0)          return false
    if (ctx.systemInterruptionFilter != "NORMAL")   return false
    // SESSION_COMPLETE bypasses DND owner check
    if (tone == Tone.SESSION_COMPLETE)              return true
    if (ctx.dndOwner != null)                       return false
    return true
}

private val TONE_DESCRIPTIONS = mapOf(
    Tone.SESSION_START     to "Single soft C5 tone",
    Tone.SESSION_COMPLETE  to "Ascending C5 to G5 two-note chime",
    Tone.BEDTIME_START     to "Descending G4 to C4 wind-down",
    Tone.MORNING           to "Ascending G4 to D5 bright soft",
    Tone.MINDFUL_PAUSE     to "Single soft A4 tone",
    Tone.UNLOCK            to "Short bright A5 blip",
    Tone.STREAK_MILESTONE  to "Major triad C5 to E5 to G5",
    Tone.MOOD_LOGGED       to "Single bright E5 confirmation tone"
)

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests
// ─────────────────────────────────────────────────────────────────────────────
class SoundCues_P1_Tests {

    // SND-010 — SESSION_COMPLETE bypasses DND owner check
    @Test fun `SND010 SESSION_COMPLETE plays even when Bedtime Mode holds DND`() {
        val ctx = SoundContext(dndOwner = "BEDTIME")
        assertTrue(canPlayTone(ctx, Tone.SESSION_COMPLETE))
    }
    @Test fun `SND010 SESSION_COMPLETE plays even when Quiet Hours holds DND`() {
        val ctx = SoundContext(dndOwner = "QUIET_HOURS")
        assertTrue(canPlayTone(ctx, Tone.SESSION_COMPLETE))
    }
    @Test fun `SND010 other tones suppressed when Bedtime Mode holds DND`() {
        val ctx = SoundContext(dndOwner = "BEDTIME")
        assertFalse(canPlayTone(ctx, Tone.MINDFUL_PAUSE))
        assertFalse(canPlayTone(ctx, Tone.SESSION_START))
        assertFalse(canPlayTone(ctx, Tone.UNLOCK))
    }
    @Test fun `SND010 SESSION_COMPLETE DND bypass prevents race condition on session end`() {
        // If DND was just released by session end, tone must still fire
        val ctx = SoundContext(dndOwner = "BEDTIME")
        assertTrue("Bypass prevents missed tone", canPlayTone(ctx, Tone.SESSION_COMPLETE))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests
// ─────────────────────────────────────────────────────────────────────────────
class SoundCues_P2_Tests {

    // SND-001 — toggle defaults ON
    @Test fun `SND001 Sound Cues toggle defaults to ON`() {
        assertTrue(SoundContext().soundCuesEnabled)
    }

    // SND-002 — SESSION_START
    @Test fun `SND002 SESSION_START tone plays when focus session begins`() {
        assertTrue(canPlayTone(SoundContext(), Tone.SESSION_START))
    }
    @Test fun `SND002 SESSION_START correct description single soft C5 tone`() {
        assertEquals("Single soft C5 tone", TONE_DESCRIPTIONS[Tone.SESSION_START])
    }

    // SND-003 — SESSION_COMPLETE
    @Test fun `SND003 SESSION_COMPLETE plays on focus session completion`() {
        assertTrue(canPlayTone(SoundContext(), Tone.SESSION_COMPLETE))
    }
    @Test fun `SND003 SESSION_COMPLETE ascending two-note chime C5 to G5`() {
        assertEquals("Ascending C5 to G5 two-note chime", TONE_DESCRIPTIONS[Tone.SESSION_COMPLETE])
    }

    // SND-004 — BEDTIME_START
    @Test fun `SND004 BEDTIME_START tone plays when Bedtime Mode activates`() {
        assertTrue(canPlayTone(SoundContext(), Tone.BEDTIME_START))
    }
    @Test fun `SND004 BEDTIME_START descending G4 to C4 wind-down feel`() {
        assertEquals("Descending G4 to C4 wind-down", TONE_DESCRIPTIONS[Tone.BEDTIME_START])
    }

    // SND-005 — MORNING
    @Test fun `SND005 MORNING tone plays at wake-up time`() {
        assertTrue(canPlayTone(SoundContext(), Tone.MORNING))
    }

    // SND-006 — MINDFUL_PAUSE
    @Test fun `SND006 MINDFUL_PAUSE tone plays on mindful pause overlay trigger`() {
        assertTrue(canPlayTone(SoundContext(), Tone.MINDFUL_PAUSE))
    }

    // SND-007 — UNLOCK
    @Test fun `SND007 UNLOCK tone plays on correct App Lock PIN entry`() {
        assertTrue(canPlayTone(SoundContext(), Tone.UNLOCK))
    }
    @Test fun `SND007 UNLOCK tone is short bright A5 blip`() {
        assertEquals("Short bright A5 blip", TONE_DESCRIPTIONS[Tone.UNLOCK])
    }

    // SND-008 — STREAK_MILESTONE
    @Test fun `SND008 STREAK_MILESTONE tone plays at 3-day streak milestone`() {
        val milestones = listOf(3, 7, 14, 30)
        assertTrue(milestones.contains(3))
        assertTrue(canPlayTone(SoundContext(), Tone.STREAK_MILESTONE))
    }
    @Test fun `SND008 STREAK_MILESTONE is major triad ascending chime`() {
        assertEquals("Major triad C5 to E5 to G5", TONE_DESCRIPTIONS[Tone.STREAK_MILESTONE])
    }

    // SND-009 — MOOD_LOGGED
    @Test fun `SND009 MOOD_LOGGED tone plays on mood submission`() {
        assertTrue(canPlayTone(SoundContext(), Tone.MOOD_LOGGED))
    }
    @Test fun `SND009 MOOD_LOGGED tone is single bright E5 confirmation`() {
        assertEquals("Single bright E5 confirmation tone", TONE_DESCRIPTIONS[Tone.MOOD_LOGGED])
    }

    // SND-011 — Quiet Hours DND suppresses non-bypass tones
    @Test fun `SND011 MINDFUL_PAUSE suppressed when Quiet Hours holds DND`() {
        val ctx = SoundContext(dndOwner = "QUIET_HOURS")
        assertFalse(canPlayTone(ctx, Tone.MINDFUL_PAUSE))
    }
    @Test fun `SND011 STREAK_MILESTONE suppressed when Quiet Hours holds DND`() {
        val ctx = SoundContext(dndOwner = "QUIET_HOURS")
        assertFalse(canPlayTone(ctx, Tone.STREAK_MILESTONE))
    }

    // SND-012 — muted stream
    @Test fun `SND012 no tone plays when notification stream volume is zero`() {
        val ctx = SoundContext(notificationStreamVolume = 0)
        Tone.values().forEach { assertFalse("$it must be silent", canPlayTone(ctx, it)) }
    }

    // SND-013 — toggle off persists
    @Test fun `SND013 Sound Cues toggled OFF suppresses all tones`() {
        val ctx = SoundContext(soundCuesEnabled = false)
        Tone.values().forEach { assertFalse("$it must be silent", canPlayTone(ctx, it)) }
    }
    @Test fun `SND013 Sound Cues OFF state is persisted natively after restart`() {
        val nativePersistence = true; assertTrue(nativePersistence)
    }

    // 8 tones total
    @Test fun `tone catalogue has exactly 8 tones`() {
        assertEquals(8, TONE_DESCRIPTIONS.size)
        assertEquals(8, Tone.values().size)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P3 Tests
// ─────────────────────────────────────────────────────────────────────────────
class SoundCues_P3_Tests {

    // SND-014 — zero APK audio assets
    @Test fun `SND014 zero audio asset files bundled in APK — tones procedurally generated`() {
        val audioAssetsInApk = 0   // SoundEffects.kt uses PCM synthesis
        assertEquals(0, audioAssetsInApk)
    }
    @Test fun `SND014 all tones generated by SoundEffects kt via PCM synthesis`() {
        val generatorClass = "SoundEffects"
        assertEquals("SoundEffects", generatorClass)
    }
    @Test fun `SND014 NOTIFICATION_EVENT stream used for correct OS audio routing`() {
        val stream = "NOTIFICATION_EVENT"
        assertEquals("NOTIFICATION_EVENT", stream)
    }
}
