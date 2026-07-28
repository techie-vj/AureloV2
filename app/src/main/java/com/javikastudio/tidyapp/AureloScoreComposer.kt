package com.javikastudio.tidyapp

/**
 * AureloScoreComposer — pure weight-table + weighted-average logic for the
 * composite Aurelo Score.
 *
 * Extracted from AureloScoreBridge.getAureloScore() (Phase 2 test-quality fix)
 * so this logic can be unit-tested directly without Android dependencies
 * (SharedPreferences, HealthConnectBridge). No behaviour change — identical
 * math, identical results; AureloScoreBridge now delegates to this object.
 *
 * Weight table (F-23: Body raised to 15%):
 *   4-pillar (HC + Sleep):    Screen 35% + Focus 30% + Sleep 20% + Body 15%
 *   3-pillar (Sleep, no HC):  Screen 40% + Focus 35% + Sleep 25%
 *   2-pillar (HC, no Sleep):  Screen 46% + Focus 39% + Body 15%
 *   2-pillar (neither):       Screen 55% + Focus 45%
 */
object AureloScoreComposer {

    data class Weights(val screen: Int, val focus: Int, val sleep: Int, val body: Int) {
        fun sum() = screen + focus + sleep + body
    }

    data class Result(val score: Int, val weights: Weights)

    fun weights(hcActive: Boolean, sleepEnabled: Boolean): Weights {
        return if (hcActive) {
            Weights(
                sleep  = if (sleepEnabled) 20 else 0,
                screen = if (sleepEnabled) 35 else 46,
                focus  = if (sleepEnabled) 30 else 39,
                body   = 15,
            )
        } else {
            Weights(
                sleep  = if (sleepEnabled) 25 else 0,
                screen = if (sleepEnabled) 40 else 55,
                focus  = if (sleepEnabled) 35 else 45,
                body   = 0,
            )
        }
    }

    fun compose(
        screenScore: Int,
        focusScore: Int,
        sleepScore: Int,
        sleepEnabled: Boolean,
        bodyScore: Int,
        hcActive: Boolean,
    ): Result {
        val w = weights(hcActive, sleepEnabled)

        data class Part(val score: Int, val weight: Int)
        val parts = buildList {
            if (screenScore >= 0) add(Part(screenScore, w.screen))
            if (focusScore  >= 0) add(Part(focusScore,  w.focus))
            if (sleepEnabled)     add(Part(sleepScore,  w.sleep))
            if (hcActive)         add(Part(bodyScore,   w.body))
        }

        val totalW = parts.sumOf { it.weight }
        val composite = if (totalW == 0) -1
        else (parts.sumOf { it.score * it.weight }.toFloat() / totalW)
            .toInt().coerceIn(0, 100)

        return Result(composite, w)
    }
}
