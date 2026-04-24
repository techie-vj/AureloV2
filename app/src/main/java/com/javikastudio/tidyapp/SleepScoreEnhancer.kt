package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// SleepScoreEnhancer — blends the existing Bedtime Mode score with HC sleep
// signals (sleep duration + overnight HRV).
//
// Spec §7.1 weighting:
//   HC active  → Bedtime 60% + HC Sleep Duration 25% + HC Overnight HRV 15%
//   HC inactive→ Bedtime 100% (unchanged)
// ═══════════════════════════════════════════════════════════════════════════

data class EnhancedSleepScore(
    val score: Int,
    val isHCEnhanced: Boolean,
    /** 0-100 sub-score from Bedtime Mode alone. */
    val bedtimeComponent: Int,
    /** 0-100 sub-score from HC sleep duration (null when HC inactive). */
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

        // Partial data: weight only what is available.
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
    // 100 at 7–9 h, linear to 0 at <4 h or >10 h. — spec §7.1

    fun sleepDurationScore(data: HCDailyData): Int? {
        val h = data.sleepDurationHours ?: return null
        return when {
            h in 7f..9f  -> 100
            h < 7f       -> (((h - 4f) / (7f - 4f)) * 100f).toInt().coerceIn(0, 100)
            else         -> ((1f - (h - 9f)) * 100f).toInt().coerceIn(0, 100)
        }
    }

    // ── Overnight HRV sub-score ──────────────────────────────────────────────
    // 100 when overnight HRV >= personal nightly average.
    // Linear from 0 at 40% below average to 100 at average. — spec §7.1

    fun overnightHrvScore(data: HCDailyData): Int? {
        val hrv = data.overnightHrvMs    ?: return null
        val avg = data.avgOvernightHrv7d ?: return null
        if (avg <= 0f) return null
        if (hrv >= avg) return 100
        val floor = avg * 0.60f   // 40% below avg = floor
        return (((hrv - floor) / (avg - floor)) * 100f).toInt().coerceIn(0, 100)
    }
}
