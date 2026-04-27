package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// SleepScoreEnhancer — blends the existing Bedtime Mode score with HC sleep
// signals (sleep duration + overnight HRV).
//
// Spec §7.1 weighting:
//   HC active  → Bedtime 60% + HC Sleep Duration 25% + HC Overnight HRV 15%
//   HC inactive→ Bedtime 100% (unchanged)
//
// FIX F-16: Oversleep ceiling extended from 10h to 11h.
//           ((1 - (h-9)) * 100) reached 0 at exactly 10h, treating 10h sleep
//           the same as clinically short sleep (4h). Most research classifies
//           9.5–10.5h as recovery/healthy sleep. New formula:
//           ((1 - (h-9)/2) * 100) reaches 0 at 11h, scoring 10h at ~50 pts.
//
// FIX F-25: Overnight HRV floor tightened from 40% below avg (0.60f) to
//           30% below avg (0.70f). Overnight HRV is more stable than daytime;
//           a tighter floor is physiologically appropriate.
//
// FIX F-02 (Kotlin side): partial-data re-normalization already correct here —
//           totalWeight is accumulated only for available signals, so
//           (weighted / totalWeight) always produces a valid 0-100 result
//           regardless of which HC sub-signals are present.
// ═══════════════════════════════════════════════════════════════════════════

data class EnhancedSleepScore(
    val score: Int,
    val isHCEnhanced: Boolean,
    /** 0-100 sub-score from Bedtime Mode alone. */
    val bedtimeComponent: Int,
    /** 0-100 sub-score from sleep duration (HC or Aurelo window proxy). */
    val durationComponent: Int?,
    /** 0-100 sub-score from HC overnight HRV (null when HC inactive). */
    val overnightHrvComponent: Int?,
)

object SleepScoreEnhancer {

    /**
     * Blend [bedtimeModeScore] with HC sleep signals.
     *
     * Falls back to [bedtimeModeScore] unmodified when HC data is not
     * available — spec §7.2 "HC not available → Bedtime Mode formula only".
     *
     * Partial-data re-normalization: weights accumulate only for available
     * signals, so the final division is always by the actual total weight
     * (never by a fixed 1.0 that assumes all signals are present).
     */
    fun blend(bedtimeModeScore: Int, data: HCDailyData): EnhancedSleepScore {
        if (!data.isAvailable) {
            return EnhancedSleepScore(
                score                = bedtimeModeScore,
                isHCEnhanced         = false,
                bedtimeComponent     = bedtimeModeScore,
                durationComponent    = null,
                overnightHrvComponent = null,
            )
        }

        val durScore = sleepDurationScore(data)
        val hRvScore = overnightHrvScore(data)

        // If both HC sub-scores are unavailable, fall back to Bedtime only.
        if (durScore == null && hRvScore == null) {
            return EnhancedSleepScore(
                score                = bedtimeModeScore,
                isHCEnhanced         = false,
                bedtimeComponent     = bedtimeModeScore,
                durationComponent    = null,
                overnightHrvComponent = null,
            )
        }

        // F-02 (Kotlin): Partial data — weight only what is available.
        // This correctly re-normalizes so max achievable score stays 100.
        var totalWeight = 0.60f
        var weighted    = bedtimeModeScore * 0.60f

        if (durScore != null) { weighted += durScore * 0.25f; totalWeight += 0.25f }
        if (hRvScore != null) { weighted += hRvScore * 0.15f; totalWeight += 0.15f }

        val blended = (weighted / totalWeight).toInt().coerceIn(0, 100)
        return EnhancedSleepScore(
            score                = blended,
            isHCEnhanced         = true,
            bedtimeComponent     = bedtimeModeScore,
            durationComponent    = durScore,
            overnightHrvComponent = hRvScore,
        )
    }

    // ── Sleep duration sub-score ─────────────────────────────────────────────
    // 100 at 7–9 h, linear to 0 at <4 h.
    // F-16: linear from 100 at 9h to 0 at 11h (was: 0 at 10h).
    // Formula: (1 - (h-9)/2) * 100 → 100 at 9h, 50 at 10h, 0 at 11h.

    fun sleepDurationScore(data: HCDailyData): Int? {
        val h = data.sleepDurationHours ?: return null
        return when {
            h in 7f..9f  -> 100
            h < 7f       -> (((h - 4f) / (7f - 4f)) * 100f).toInt().coerceIn(0, 100)
            // F-16: was ((1f - (h - 9f)) * 100f) → reaches 0 at 10h
            // Fixed:  ((1f - (h - 9f) / 2f) * 100f) → reaches 0 at 11h
            else         -> ((1f - (h - 9f) / 2f) * 100f).toInt().coerceIn(0, 100)
        }
    }

    // ── Overnight HRV sub-score ──────────────────────────────────────────────
    // 100 when overnight HRV >= personal nightly average.
    // F-25: floor tightened to avg * 0.70 (30% below avg) from avg * 0.60
    // (40% below avg). Overnight HRV is more stable than daytime HRV.

    fun overnightHrvScore(data: HCDailyData): Int? {
        val hrv = data.overnightHrvMs    ?: return null
        val avg = data.avgOvernightHrv7d ?: return null
        if (avg <= 0f) return null
        if (hrv >= avg) return 100
        // F-25: tightened floor from 60% to 70% of average
        val floor = avg * 0.70f
        if (hrv <= floor) return 0
        return (((hrv - floor) / (avg - floor)) * 100f).toInt().coerceIn(0, 100)
    }
}
