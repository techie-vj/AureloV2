package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// CoachOrchestrator — single Kotlin entry point for Aurelo Coach responses.
//
// Runtime flow:
//   JS CoachUI.send(query)
//      -> AppBridge.askCoach(query)
//      -> CoachBridge.askCoach(query)
//      -> UsageSummaryBuilder.build(...)
//      -> CoachOrchestrator(context).answer(query, summary)
//      -> JSON response back to JS.
//
// CHANGELOG v1.2.1 — analysis fixes:
//   • classifyPredefinedQuestion: new intents FOCUS_PEAK_TIME, FEATURE_EXPLANATION,
//     GOAL_SETTING_ADVICE, APP_DEEP_DIVE registered in routing
//   • classifyPredefinedQuestion: "score change" is direction-aware (calls
//     resolveScoreChangeIntent instead of hardcoding SCORE_DROP)
//   • classifyPredefinedQuestion: "bedtime routine" is sleepScore-aware
//     (HEALTHY_PATTERN when >= 75, BEDTIME_REVENGE_PROCRASTINATION otherwise)
//   • classifyPredefinedQuestion: "focus sessions going" / "completion rate" check
//     daysSinceLastFocus to give correct active-user vs gap response
//   • classifyPredefinedQuestion: "most focused time" → FOCUS_PEAK_TIME (not GENERAL_SUMMARY)
//   • classifyPredefinedQuestion: "how do i reach excellent" → PRODUCTIVE_DAY + gap context
//   • classifyPredefinedQuestion: "what triggers my phone" → data-driven routing
//   • HC-missing questions: return dedicated HC_MISSING_* sentinel so caller can
//     produce "please connect HC" response instead of silently substituting GENERAL_SUMMARY
//   • classifyQueryIntent: expanded keyword rules (sleep deprivation, compulsive pickup,
//     notification, "always on my phone", "what happened yesterday", etc.)
//   • classifyQueryIntent: new intent rules for FOCUS_PEAK_TIME, FEATURE_EXPLANATION,
//     GOAL_SETTING_ADVICE, APP_DEEP_DIVE
//   • applyPersonalisation: post-streak-break rebuild detection
//   • applyPersonalisation: perfect-day composite trigger
//   • applyPersonalisation: proactive RECOVERY_DAY detection
//   • followUpsFor: new intents covered
//   • TEMPLATE_INTENTS: updated set includes all new intents
//
// CHANGELOG v1.2.2 — unrouted chip label audit + duplicate response fixes:
//   • classifyPredefinedQuestion: 30+ previously UNKNOWN chip labels now routed
//   • "What's dragging my score down?" → pillar-aware (focusScore/firstUseHour)
//   • "What triggers my phone use?" → ANOMALOUS_SPIKE in high-pickup case
//   • "How's my bedtime routine?" → RECOVERY_DAY when sleepScore<75
//   • "How do I reach Excellent?" → HEALTHY_PATTERN when score≥85
//   • "What's my session completion rate?" → PRODUCTIVE_DAY when sessions exist
//   • followUpsFor: all action-label chips replaced with routable questions
//   • classifyQueryIntent: chip label keywords added to all relevant intent rules
// ═══════════════════════════════════════════════════════════════════════════

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class CoachOrchestrator(
    private val context: Context? = null,
) {

    data class CoachAnswer(
        val intent: String,
        val title: String,
        val body: String,
        val hcBadge: Boolean,
        val followUps: List<String>,
        val confidence: Float,
        val usedFallback: Boolean,
        val source: String,
    ) {
        fun toJson(): String = JSONObject().apply {
            put("intent", intent)
            put("title", title)
            put("body", body)
            put("hcBadge", hcBadge)
            put("confidence", confidence)
            put("usedFallback", usedFallback)
            put("source", source)
            put("followUps", JSONArray().also { arr -> followUps.forEach { arr.put(it) } })
        }.toString()
    }

    private data class ClassifiedIntent(
        val intent: String,
        val confidence: Float,
        val source: String = "query",
    )

    private data class BehaviourCandidate(
        val intent: String,
        val priority: Int,
        val confidence: Float,
        val description: String,
        val hcBased: Boolean,
        val source: String,
    )

    private data class ChosenIntent(
        val intent: String,
        val confidence: Float,
        val source: String,
        val usedFallback: Boolean,
    )

    private data class HcSignalAvailability(
        val hasHrv: Boolean,
        val hasSleep: Boolean,
        val hasSteps: Boolean,
        val hasRhr: Boolean,
        val hasMindfulness: Boolean,
    ) {
        val hasAny: Boolean
            get() = hasHrv || hasSleep || hasSteps || hasRhr || hasMindfulness

        companion object {
            fun from(summary: UsageSummary): HcSignalAvailability {
                val hasHrv =
                    summary.hrvToday != null &&
                            summary.hrv7DayAvg != null &&
                            summary.hrv7DayAvg > 0f

                val hasSleep =
                    summary.sleepDurationMinutes != null &&
                            summary.sleepDurationMinutes > 0

                val hasSteps =
                    summary.stepsToday != null &&
                            summary.stepsToday > 0

                val hasRhr =
                    summary.restingHeartRate != null &&
                            summary.rhr7DayAvg != null &&
                            summary.rhr7DayAvg > 0f

                val hasMindfulness =
                    summary.externalMindfulnessMinutesToday != null &&
                            summary.externalMindfulnessMinutesToday > 0

                return HcSignalAvailability(
                    hasHrv = hasHrv,
                    hasSleep = hasSleep,
                    hasSteps = hasSteps,
                    hasRhr = hasRhr,
                    hasMindfulness = hasMindfulness,
                )
            }
        }
    }

    fun answer(query: String, summary: UsageSummary): CoachAnswer {
        Log.d(TAG, "CoachOrchestrator.answer query=$query")

        val hcSignalsEarly = HcSignalAvailability.from(summary)
        val queryIntent = classifyPredefinedQuestion(query, summary, hcSignalsEarly)
            ?: classifyQueryIntent(query)
        Log.d(TAG, "Query intent=${queryIntent.intent} confidence=${queryIntent.confidence}")

        // FIX: HC-missing sentinel — return explanation response immediately
        if (queryIntent.intent.startsWith("HC_MISSING_")) {
            val (missingTitle, missingBody, missingFollowUps) = buildHcMissingResponse(queryIntent.intent, summary)
            return CoachAnswer(
                intent = "GENERAL_SUMMARY",
                title = missingTitle,
                body = missingBody,
                hcBadge = false,
                followUps = missingFollowUps,
                confidence = 1.0f,
                usedFallback = false,
                source = "hc_missing_explanation",
            )
        }

        val hcSignals = hcSignalsEarly

        val behaviour = classifyBehaviourIntent(summary, hcSignals)
        Log.d(TAG, "Behaviour intent=${behaviour.intent} priority=${behaviour.priority} source=${behaviour.source}")

        val baseChoice = chooseFinalIntent(
            query = query,
            queryIntent = queryIntent,
            behaviour = behaviour,
            summary = summary,
            hcSignals = hcSignals,
        )

        val personalised =
            if (baseChoice.source == "help" || baseChoice.source == "out_of_scope") {
                baseChoice.intent
            } else {
                applyPersonalisation(
                    baseIntent = baseChoice.intent,
                    query = query,
                    summary = summary,
                    hcSignals = hcSignals,
                )
            }

        val guardedIntent = guardIntentForAvailableHc(
            intent = personalised,
            summary = summary,
            hcSignals = hcSignals,
        )

        val finalSource = buildString {
            append(baseChoice.source)
            if (personalised != baseChoice.intent) append("+personalization")
            if (guardedIntent != personalised) append("+hc_guard")
        }

        Log.d(TAG, "Final intent=$guardedIntent source=$finalSource")

        val variant = InsightTemplateLibrary.inferVariant(summary)
        val template = selectTemplateWithHcGuard(
            intent = guardedIntent,
            variant = variant,
            summary = summary,
            hcSignals = hcSignals,
        )

        val filled = when (finalSource) {
            "help" -> InsightTemplateLibrary.InsightText(
                title = "I can help with your Aurelo patterns",
                body = "Ask me about your score, streak, screen time, pickups, focus sessions, bedtime routine, sleep, HRV, steps, or which habit to work on next.",
                hcBased = false,
            )
            "out_of_scope" -> InsightTemplateLibrary.InsightText(
                title = "I'm focused on your Aurelo data",
                body = "I can answer questions about your screen time, focus, sleep, Health Connect signals, streaks, and app habits. Try asking about your score, pickups, focus sessions, bedtime routine, or active days.",
                hcBased = false,
            )
            else -> sanitizeFilledText(
                intent = guardedIntent,
                insight = resolveOrchestratorSlots(
                    InsightTemplateLibrary.fillSlots(template, summary),
                    summary,
                ),
                summary = summary,
                hcSignals = hcSignals,
                query = query,
            )
        }

        val hcBadge = shouldShowHcBadge(
            intent = guardedIntent,
            filled = filled,
            summary = summary,
            hcSignals = hcSignals,
        )

        return CoachAnswer(
            intent = guardedIntent,
            title = filled.title,
            body = filled.body,
            hcBadge = hcBadge,
            followUps = when (finalSource) {
                "help" -> listOf("Why did my score change?", "Is my streak safe?", "What should I work on first?")
                "out_of_scope" -> listOf("Tell me about my week", "Is my streak safe?", "What's my best habit right now?")
                else -> followUpsFor(guardedIntent, summary, hcSignals)
            },
            confidence = baseChoice.confidence,
            usedFallback = baseChoice.usedFallback ||
                    (guardedIntent == "GENERAL_SUMMARY" && queryIntent.confidence < CONFIDENCE_THRESHOLD),
            source = finalSource,
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HC-MISSING response builder
    // ─────────────────────────────────────────────────────────────────────────

    /** FIX: Returns a Triple(title, body, followUps) explaining which HC signal is missing. */
    private fun buildHcMissingResponse(
        sentinel: String,
        summary: UsageSummary,
    ): Triple<String, String, List<String>> {
        return when (sentinel) {
            "HC_MISSING_HRV" -> Triple(
                "Health Connect needed for HRV insights",
                "To answer that I need your Heart Rate Variability (HRV) data from Health Connect. " +
                        "Go to Settings → Health Connect to grant access. " +
                        "In the meantime, your Bedtime Mode Sleep Score and streak reflect your sleep adherence without needing HC.",
                listOf("How does sleep affect my score?", "How's my bedtime routine?", "What should I work on first?"),
            )
            "HC_MISSING_STEPS" -> Triple(
                "Health Connect needed for activity insights",
                "To answer that I need your Daily Steps data from Health Connect. " +
                        "Go to Settings → Health Connect to grant access. " +
                        "Your screen time and focus patterns already show a lot — " +
                        "you have a ${summary.streakDays}-day streak and ${summary.todayMinutes} min of screen time today.",
                listOf("Tell me about my week", "How are my focus sessions going?", "What should I work on first?"),
            )
            "HC_MISSING_SLEEP" -> Triple(
                "Health Connect needed for sleep correlation",
                "To show how sleep affects your usage I need Sleep session data from Health Connect. " +
                        "Go to Settings → Health Connect to grant access. " +
                        if (summary.sleepScore > 0)
                            "Your Bedtime Mode Sleep Score (${summary.sleepScore}) is already tracking adherence — that's a great start."
                        else
                            "Enabling Bedtime Mode will start tracking sleep adherence even without HC.",
                listOf("How's my bedtime routine?", "What is Bedtime Mode?", "What should I work on first?"),
            )
            else -> Triple(
                "Health Connect data needed",
                "That insight requires Health Connect data. Go to Settings → Health Connect to connect and grant the relevant permissions.",
                listOf("Tell me about my week", "Is my streak safe?", "What should I work on first?"),
            )
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Direction-aware score helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Route score-change query based on actual delta direction.
     *
     * Edge cases handled:
     * - When `aureloScoreYesterday <= 0` we don't have a real comparison point
     *   (fresh install / data wiped) — return GENERAL_SUMMARY so the response
     *   doesn't claim a phantom drop or improvement.
     * - When delta is exactly 0 with valid scores on both sides, prefer
     *   HEALTHY_PATTERN ("steady, today matches yesterday") over PRODUCTIVE_DAY,
     *   which would print "Score recovered — streak intact" with score_drop=0.
     */
    private fun resolveScoreChangeIntent(summary: UsageSummary): String {
        if (summary.aureloScoreYesterday <= 0) return "GENERAL_SUMMARY"
        val delta = summary.aureloScore - summary.aureloScoreYesterday
        return when {
            delta < 0 -> "SCORE_DROP"
            delta == 0 -> "HEALTHY_PATTERN"
            else -> "PRODUCTIVE_DAY"
        }
    }

    /** True when no pillar score has been computed yet (fresh install state). */
    private fun pillarsUnpopulated(summary: UsageSummary): Boolean =
        summary.screenScore <= 0 && summary.focusScore <= 0 && summary.sleepScore <= 0

    /**
     * Extract the app name the user is asking about (e.g. "Instagram" /
     * "YouTube") and look it up against the cached top-app list.
     *
     * Returns a `(spokenName, lookupOrNull)` pair:
     *   - `spokenName` is the lowercase keyword that matched the query
     *     (or null when no app keyword was present at all).
     *   - `lookupOrNull` is the `AppUsageEntry` from `summary.topApps` whose
     *     label/package contains the spoken keyword, or null when the user
     *     named an app we don't have data for.
     *
     * The keyword set is small on purpose — only the names we explicitly
     * recognise from the predefined questions and `INTENT_RULES` patterns.
     */
    private fun resolveNamedApp(
        query: String,
        summary: UsageSummary,
    ): Pair<String?, AppUsageEntry?> {
        val q = query.lowercase(Locale.US)
        val candidates = listOf(
            "instagram", "youtube", "tiktok", "tik tok", "reddit", "facebook",
            "twitter", "x.com", "snapchat", "whatsapp", "messenger", "telegram",
            "discord", "spotify", "netflix", "twitch", "chrome", "gmail",
            "linkedin", "pinterest",
        )
        val named = candidates.firstOrNull { q.contains(it) } ?: return null to null
        val needle = named.replace(" ", "")
        val match = summary.topApps.firstOrNull { app ->
            val label = app.label.lowercase(Locale.US).replace(" ", "")
            val pkg = app.packageName.lowercase(Locale.US).replace(" ", "")
            label.contains(needle) || pkg.contains(needle)
        }
        return named to match
    }

    /**
     * True when the Social category is actually leading the user's usage.
     * Matches the canonical category constant from `Categories.SOCIAL`
     * ("Social & Communication") and the legacy raw "Social" string used by
     * older callers and the JS browser-preview mock.
     */
    private fun isSocialDominant(summary: UsageSummary): Boolean {
        val cat = summary.topCategory.lowercase(Locale.US)
        return cat == "social" ||
                cat == Categories.SOCIAL.lowercase(Locale.US) ||
                cat.startsWith("social ")
    }

    /**
     * FIX: Identify which pillar is weakest right now.
     * UsageSummary only carries current-day pillar scores (no yesterday breakdown),
     * so we use the lowest weighted score as the best proxy for what's dragging
     * the composite — matches the weighted contribution logic in the score engine.
     */
    private fun worstPillar(summary: UsageSummary): String {
        // Weighted contribution: Screen 40%, Focus 35%, Sleep 25%
        val screenWeighted = summary.screenScore * 0.40
        val focusWeighted  = summary.focusScore  * 0.35
        val sleepWeighted  = summary.sleepScore  * 0.25
        return when {
            focusWeighted  <= screenWeighted && focusWeighted  <= sleepWeighted -> "Focus"
            screenWeighted <= focusWeighted  && screenWeighted <= sleepWeighted -> "Screen"
            else -> "Sleep"
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Behaviour classification
    // ─────────────────────────────────────────────────────────────────────────

    private fun classifyBehaviourIntent(
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): BehaviourCandidate {
        val patternCandidate = KotlinPatternDetector.detectAll(summary)
            .firstOrNull()
            ?.let {
                BehaviourCandidate(
                    intent = normalizeIntent(it.intent),
                    priority = it.priority,
                    confidence = priorityToConfidence(it.priority),
                    description = it.description,
                    hcBased = it.hcBased,
                    source = "pattern",
                )
            }
            ?: BehaviourCandidate(
                intent = "GENERAL_SUMMARY",
                priority = 1,
                confidence = 0.25f,
                description = "General summary fallback",
                hcBased = false,
                source = "pattern_fallback",
            )

        val onnxCandidate = tryClassifyWithOnnx(summary, hcSignals)

        return when {
            onnxCandidate == null -> patternCandidate

            patternCandidate.priority >= HIGH_PRIORITY_PATTERN -> patternCandidate.copy(
                source = "pattern_over_onnx:${onnxCandidate.intent}",
            )

            // FIX: strict ">" so deterministic pattern signals win on ties
            // (was ">="). Combined with the lowered ONNX_PRIORITY this means
            // ONNX only overrides the pattern detector when its priority is
            // strictly greater AND its plausibility/probability checks passed.
            onnxCandidate.priority > patternCandidate.priority -> onnxCandidate.copy(
                source = "onnx_over_pattern:${patternCandidate.intent}",
            )

            else -> patternCandidate.copy(
                source = "pattern_over_onnx:${onnxCandidate.intent}",
            )
        }
    }

    private fun tryClassifyWithOnnx(
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): BehaviourCandidate? {
        val ctx = context
        if (ctx == null) {
            Log.d(TAG, "ONNX skipped: CoachOrchestrator was created without Context")
            return null
        }

        return runCatching {
            val features = CoachFeatureBuilder.toOnnx(summary)

            if (features.size != 14) {
                Log.w(TAG, "ONNX skipped: expected 14 features, got ${features.size}")
                return@runCatching null
            }

            Log.d(TAG, "Calling CoachOnnxClassifier")
            val prediction = CoachOnnxClassifier(ctx).classifyOrNull(features)
                ?: return@runCatching null

            val intent = normalizeIntent(prediction.intent)
            if (!isKnownIntent(intent)) {
                Log.w(TAG, "ONNX returned unknown intent=${prediction.intent} normalized=$intent")
                return@runCatching null
            }

            // FIX: confidence floor. The current model emits discrete probability
            // buckets (5-tree ensemble) and "ties" frequently land at 0.20.
            // Anything below 0.45 is too unstable to override the deterministic
            // pattern detector, so drop those predictions entirely.
            if (prediction.probability > 0f && prediction.probability < ONNX_PROB_FLOOR) {
                Log.d(TAG, "ONNX prediction below probability floor — dropped " +
                        "(intent=$intent prob=${prediction.probability})")
                return@runCatching null
            }

            // FIX: plausibility filter. The shipped model is a 16-class tree
            // ensemble trained on a small synthetic dataset and confidently
            // mis-classifies on realistic inputs (e.g. predicts
            // HEALTHY_PATTERN for a 320-min social-heavy day, or
            // HC_ACTIVE_DAY_BETTER_FOCUS for an HC-disconnected user). Reject
            // outputs that obviously contradict the feature values.
            if (!isOnnxPredictionPlausible(intent, summary, hcSignals)) {
                Log.d(TAG, "ONNX prediction implausible against features — dropped " +
                        "(intent=$intent prob=${prediction.probability})")
                return@runCatching null
            }

            val guarded = guardIntentForAvailableHc(
                intent = intent,
                summary = summary,
                hcSignals = hcSignals,
            )

            if (guarded != intent) {
                Log.d(TAG, "ONNX intent=$intent suppressed by HC signal guard -> $guarded")
                return@runCatching null
            }

            BehaviourCandidate(
                intent = intent,
                priority = ONNX_PRIORITY,
                // Use the model's own probability instead of a flat 0.75 so
                // higher-confidence predictions win against pattern ties.
                confidence = prediction.probability.coerceAtLeast(0.5f),
                description = "ONNX behaviour classification",
                hcBased = intent.startsWith("HC_"),
                source = "onnx",
            )
        }.onFailure { e ->
            Log.w(TAG, "ONNX classification failed; falling back to KotlinPatternDetector", e)
        }.getOrNull()
    }

    /**
     * Sanity-check a raw ONNX prediction against the feature snapshot.
     * Anchored to the audit findings — these are the cases where the model
     * was empirically wrong on realistic personas.
     *
     * Returns false → the prediction is dropped and the pattern detector
     * is used instead.
     */
    private fun isOnnxPredictionPlausible(
        intent: String,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): Boolean {
        val goal = summary.dailyGoalMinutes.coerceAtLeast(1)
        val today = summary.todayMinutes
        val pickups = summary.pickupsToday
        val pickupAvg = summary.pickups7DayAvg

        when (intent) {
            // HEALTHY_PATTERN cannot be plausible if usage is well over goal
            // or pickups are well above the 7-day average.
            "HEALTHY_PATTERN" -> {
                if (today > goal * 1.10f) return false
                if (pickupAvg > 0f && pickups > pickupAvg * 1.30f) return false
                // Or if pillar scores are clearly weak
                if (summary.aureloScore in 1..54) return false
            }

            // PRODUCTIVE_DAY requires at least mild positive signal — not a
            // 320-min over-goal day with no sessions.
            "PRODUCTIVE_DAY" -> {
                if (today > goal * 1.05f) return false
                if (summary.focusSessionsCompleted == 0 &&
                    summary.firstUseHour < 8) return false
            }

            // HC_* intents require HC actually being connected with the
            // matching signal.
            "HC_POOR_SLEEP_HIGH_USAGE" -> {
                if (!summary.hcConnected) return false
                if (!hcSignals.hasHrv && !hcSignals.hasSleep) return false
            }
            "HC_ACTIVE_DAY_BETTER_FOCUS" -> {
                if (!summary.hcConnected) return false
                if (!hcSignals.hasSteps) return false
                // Active-day claim only makes sense at >= 5k steps and roughly
                // on-or-under goal. The model fired this for a 450-min/0-step
                // user in our personas test.
                val steps = summary.stepsToday ?: 0
                if (steps < 5000) return false
                if (today > goal * 1.20f) return false
            }

            // BEDTIME_REVENGE_PROCRASTINATION needs *some* night-time signal.
            // Reject when:
            //   - all-zero day with no late first-use signal (the empirical
            //     "all-zero -> bedtime" misfire from the audit);
            //   - the user already has a strong Sleep Score and is well
            //     under their daily goal (bedtime is plainly working);
            //   - early-morning doom-scroll signal dominates (firstUseHour<8
            //     with under-goal usage and a passing sleep score) — that's
            //     a morning pattern, not a bedtime pattern.
            "BEDTIME_REVENGE_PROCRASTINATION" -> {
                if (today == 0 && pickups == 0 &&
                    summary.firstUseHour >= 9) return false
                if (summary.sleepScore >= 70 && today < goal * 0.5f) return false
                if (summary.firstUseHour < 8 &&
                    summary.sleepScore >= 65 &&
                    today < goal * 0.5f) return false
            }

            // PICKUP_SPIKE / DOPAMINE_LOOP need pickups actually elevated.
            "PICKUP_SPIKE", "DOPAMINE_LOOP" -> {
                if (pickupAvg > 0f && pickups < pickupAvg * 1.10f) return false
                if (today < goal * 0.4f && pickups < 30) return false
            }

            // STREAK_AT_RISK only when the streak exists *and* projection is
            // genuinely close to or over goal.
            "STREAK_AT_RISK" -> {
                if (summary.streakDays <= 0) return false
                if (today < goal * 0.3f) return false
            }

            // FOCUS_GAP requires actually being in a gap.
            "FOCUS_GAP" -> {
                if (summary.daysSinceLastFocus == 0 &&
                    summary.focusSessionsCompleted > 0) return false
            }

            // SCORE_DROP requires an actual drop or no comparison being possible.
            "SCORE_DROP" -> {
                if (summary.aureloScoreYesterday > 0 &&
                    summary.aureloScore >= summary.aureloScoreYesterday) return false
            }

            // The two legacy labels the orchestrator already remaps via
            // normalizeIntent: same plausibility rules apply post-remap.
            // (Nothing extra to do here.)
        }
        return true
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Query domain checks
    // ─────────────────────────────────────────────────────────────────────────

    private fun isHelpQuestion(query: String): Boolean {
        val q = query.lowercase(Locale.US).trim()
        return q.contains("what can you help") ||
                q.contains("what do you do") ||
                q.contains("how can you help") ||
                q.contains("help me with") ||
                q == "help" ||
                q == "hi" ||
                q == "hello" ||
                q.contains("how are you") ||
                q.contains("what can i ask") ||
                q.contains("what questions can i ask")
    }

    private fun isCoachDomainQuestion(query: String): Boolean {
        val q = query.lowercase(Locale.US).trim()
        if (isHelpQuestion(q)) return true

        val domainTerms = listOf(
            "score", "streak", "screen", "phone", "usage", "pickup", "pickups",
            "focus", "session", "sessions", "mindful", "pause", "block",
            "sleep", "bedtime", "night", "morning", "hrv", "heart rate",
            "steps", "active", "walk", "exercise", "health connect",
            "social", "instagram", "tiktok", "reddit", "youtube", "app",
            "habit", "dopamine", "scroll", "doom", "routine", "goal",
            "today", "week", "data", "pattern", "excellent", "recover",
            "minutes", "left", "riskiest", "risky", "work on", "improve",
            "help with", "start", "rebuild", "completion rate",
            // FIX: new domain terms
            "notification", "unlock", "compulsive", "always on my phone",
            "always on my", "can't put it down", "checking constantly",
            "what happened", "yesterday", "only slept", "barely slept",
            "hard to concentrate", "brain fog", "unmotivated", "no energy",
            "what is", "how does", "explain", "feature", "what does",
            "trigger", "best time", "most focused", "deep dive",
            "how much time on", "spending on", "how long on",
        )

        return domainTerms.any { q.contains(it) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Final intent selection
    // ─────────────────────────────────────────────────────────────────────────

    private fun chooseFinalIntent(
        query: String,
        queryIntent: ClassifiedIntent,
        behaviour: BehaviourCandidate,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): ChosenIntent {
        val queryIsConfident = queryIntent.confidence >= CONFIDENCE_THRESHOLD && queryIntent.intent != "UNKNOWN"
        val queryIsPredefined = queryIntent.source == "predefined_query"
        val queryIsGeneric = queryIntent.intent == "GENERAL_SUMMARY" || query.trim().isBlank()

        if (isHelpQuestion(query)) {
            return ChosenIntent(
                intent = "GENERAL_SUMMARY",
                confidence = 1.0f,
                source = "help",
                usedFallback = false,
            )
        }

        if (!queryIsConfident && !isCoachDomainQuestion(query)) {
            return ChosenIntent(
                intent = "GENERAL_SUMMARY",
                confidence = 0.0f,
                source = "out_of_scope",
                usedFallback = true,
            )
        }

        if (queryIsConfident && (queryIsPredefined || !queryIsGeneric)) {
            val guarded = guardIntentForAvailableHc(queryIntent.intent, summary, hcSignals)
            return ChosenIntent(
                intent = guarded,
                confidence = queryIntent.confidence,
                source = if (guarded == queryIntent.intent) queryIntent.source else "${queryIntent.source}+hc_guard",
                usedFallback = guarded != queryIntent.intent,
            )
        }

        if (behaviour.intent != "GENERAL_SUMMARY") {
            val guarded = guardIntentForAvailableHc(behaviour.intent, summary, hcSignals)
            return ChosenIntent(
                intent = guarded,
                confidence = behaviour.confidence,
                source = behaviour.source,
                usedFallback = guarded != behaviour.intent,
            )
        }

        return ChosenIntent(
            intent = "GENERAL_SUMMARY",
            confidence = queryIntent.confidence.coerceAtLeast(behaviour.confidence),
            source = "fallback",
            usedFallback = true,
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Personalisation
    // ─────────────────────────────────────────────────────────────────────────

    private fun applyPersonalisation(
        baseIntent: String,
        query: String,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): String {
        val q = query.lowercase(Locale.US)

        if (summary.hcConnected) {
            val hrvLow = hcSignals.hasHrv &&
                    summary.hrvToday!! < summary.hrv7DayAvg!! * 0.85f

            val sleepLow = summary.sleepDurationMinutes != null &&
                    summary.sleepDuration7DayAvg != null &&
                    summary.sleepDuration7DayAvg > 0f &&
                    summary.sleepDurationMinutes < summary.sleepDuration7DayAvg * 0.85f

            val usageHigh = summary.todayMinutes > summary.dailyGoalMinutes * 0.90f
            val sleepQuery = q.contains("sleep") || q.contains("hrv") || q.contains("tired") || q.contains("rest")

            if (
                usageHigh &&
                (hrvLow || sleepLow) &&
                (baseIntent == "GENERAL_SUMMARY" || baseIntent == "SCORE_DROP" || sleepQuery)
            ) {
                return "HC_POOR_SLEEP_HIGH_USAGE"
            }

            val activeQuery = q.contains("step") || q.contains("active") || q.contains("walk") || q.contains("exercise")
            if (
                hcSignals.hasSteps &&
                (summary.stepsToday ?: 0) >= 8000 &&
                summary.todayMinutes <= summary.dailyGoalMinutes &&
                (baseIntent == "GENERAL_SUMMARY" || baseIntent == "HEALTHY_PATTERN" || activeQuery)
            ) {
                return "HC_ACTIVE_DAY_BETTER_FOCUS"
            }
        }

        // FIX: don't promote FOCUS_GAP over an explicit FOCUS_ON_TRACK
        // (active-user) routing or other already-specific intents.
        if (
            summary.daysSinceLastFocus >= 3 &&
            baseIntent != "FOCUS_ON_TRACK" &&
            (baseIntent == "GENERAL_SUMMARY" || q.contains("focus") || q.contains("session"))
        ) {
            return "FOCUS_GAP"
        }

        if (
            baseIntent == "GENERAL_SUMMARY" &&
            summary.firstUseHour < 8 &&
            (q.contains("morning") || q.contains("first") || q.contains("today") || q.contains("summary"))
        ) {
            return "MORNING_DOOM_SCROLL"
        }

        // FIX: STREAK_AT_RISK demotion — if the user is asking about their
        // streak but they aren't actually projected to break it today, the
        // STREAK_AT_RISK templates ("act now", "final warning") are misleading.
        // Demote to HEALTHY_PATTERN with a celebratory tone.
        if (baseIntent == "STREAK_AT_RISK") {
            val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
            val rate = if (hour > 0) summary.todayMinutes.toFloat() / hour else 0f
            val projected = summary.todayMinutes + rate * (24 - hour)
            val safeMargin = summary.dailyGoalMinutes * 0.75f
            if (projected < safeMargin && summary.streakDays > 0) {
                return "HEALTHY_PATTERN"
            }
        }

        // FIX: Proactive RECOVERY_DAY — today significantly under recent average
        // screenTime7Day is List<DayRecord>; extract .minutes for arithmetic
        val activeDayMinutes = summary.screenTime7Day.map { it.minutes }.filter { it > 0 }
        if (activeDayMinutes.size >= 2) {
            val recentAvg = activeDayMinutes.average()
            if (summary.todayMinutes < recentAvg * 0.6 && summary.streakDays > 0 && summary.todayMinutes > 0 &&
                baseIntent == "GENERAL_SUMMARY") {
                return "RECOVERY_DAY"
            }
        }

        // FIX: Perfect-day composite trigger
        val isPerfectDay = summary.focusSessionsCompleted >= 3 &&
                summary.firstUseHour >= 9 &&
                summary.todayMinutes <= summary.dailyGoalMinutes * 0.7f &&
                summary.pickupsToday <= summary.pickups7DayAvg * 0.85f
        if (isPerfectDay && baseIntent == "GENERAL_SUMMARY") {
            return "PRODUCTIVE_DAY"
        }

        // FIX: Post-streak-break rebuild acknowledgement
        // previousBestStreak is not in UsageSummary; infer rebuild state from a low
        // current streak combined with a high-enough data window (user has history).
        // dataWindowDays >= 14 means they've been using the app long enough to have
        // had a meaningful streak before — streakDays 1–3 signals a recent break.
        val likelyRebuild = summary.dataWindowDays >= 14 && summary.streakDays in 1..3
        if (likelyRebuild && (baseIntent == "GENERAL_SUMMARY" || baseIntent == "RECOVERY_DAY")) {
            return "RECOVERY_DAY"
        }

        return baseIntent
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HC guards
    // ─────────────────────────────────────────────────────────────────────────

    private fun guardIntentForAvailableHc(
        intent: String,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): String {
        if (!summary.hcConnected) {
            return if (isHcOnly(intent)) "GENERAL_SUMMARY" else intent
        }

        return when (intent) {
            "HC_POOR_SLEEP_HIGH_USAGE" ->
                if (hcSignals.hasHrv || hcSignals.hasSleep) intent else "GENERAL_SUMMARY"

            "HC_ACTIVE_DAY_BETTER_FOCUS" ->
                if (hcSignals.hasSteps) intent else "GENERAL_SUMMARY"

            else -> intent
        }
    }

    private fun selectTemplateWithHcGuard(
        intent: String,
        variant: InsightTemplateLibrary.TemplateVariant,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): InsightTemplateLibrary.InsightText {
        val selected = InsightTemplateLibrary.select(
            intent = intent,
            variant = variant,
            summary = summary,
            rotationIndex = rotationIndex(),
        )

        if (!selected.hcBased) return selected

        if (summary.hcConnected && templateHasRequiredHcSignals(selected, hcSignals)) {
            return selected
        }

        val nonHcSummary = summary.copy(hcConnected = false)
        val fallback = InsightTemplateLibrary.select(
            intent = intent,
            variant = variant,
            summary = nonHcSummary,
            rotationIndex = rotationIndex(),
        )

        Log.d(
            TAG,
            "HC template guard: replaced hcBased template for intent=$intent " +
                    "selectedTitle=${selected.title} fallbackTitle=${fallback.title}"
        )

        return fallback
    }

    private fun isHrvMeaningfullyLow(summary: UsageSummary): Boolean {
        return summary.hrvToday != null &&
                summary.hrv7DayAvg != null &&
                summary.hrv7DayAvg > 0f &&
                summary.hrvToday < summary.hrv7DayAvg * 0.95f
    }

    private fun shouldShowHcBadge(
        intent: String,
        filled: InsightTemplateLibrary.InsightText,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): Boolean {
        if (!summary.hcConnected || !hcSignals.hasAny) return false

        val text = "${filled.title} ${filled.body}".lowercase(Locale.US)
        val claimsLowHrv = text.contains("low hrv") ||
                text.contains("below average") ||
                text.contains("confirms the strain") ||
                text.contains("suppresses recovery")

        return when (intent) {
            "HC_POOR_SLEEP_HIGH_USAGE" ->
                if (claimsLowHrv) isHrvMeaningfullyLow(summary) || hcSignals.hasSleep else (hcSignals.hasHrv || hcSignals.hasSleep)

            "HC_ACTIVE_DAY_BETTER_FOCUS" ->
                hcSignals.hasSteps

            "FOCUS_BURNOUT" ->
                filled.hcBased && (hcSignals.hasMindfulness || (hcSignals.hasHrv && (!claimsLowHrv || isHrvMeaningfullyLow(summary))))

            "BEDTIME_REVENGE_PROCRASTINATION" ->
                filled.hcBased && (hcSignals.hasSleep || (hcSignals.hasHrv && (!claimsLowHrv || isHrvMeaningfullyLow(summary))))

            "SCORE_DROP" ->
                filled.hcBased && templateHasRequiredHcSignals(filled, hcSignals)

            "HEALTHY_PATTERN" ->
                filled.hcBased && templateHasRequiredHcSignals(filled, hcSignals)

            "GENERAL_SUMMARY" ->
                filled.hcBased && templateHasRequiredHcSignals(filled, hcSignals)

            else ->
                (intent.startsWith("HC_") || filled.hcBased) &&
                        templateHasRequiredHcSignals(filled, hcSignals)
        }
    }

    private fun templateHasRequiredHcSignals(
        insight: InsightTemplateLibrary.InsightText,
        hcSignals: HcSignalAvailability,
    ): Boolean {
        val text = "${insight.title} ${insight.body}".lowercase(Locale.US)

        val needsHrv = text.contains("hrv") || text.contains("{hrv_") || text.contains("heart rate variability")
        val needsSleep = text.contains("sleep") || text.contains("{sleep_") || text.contains("under-slept") || text.contains("sleep debt")
        val needsSteps = text.contains("step") || text.contains("{steps_") || text.contains("active day") || text.contains("activity")
        val needsRhr = text.contains("resting heart") || text.contains("{rhr_")
        val needsMindfulness = text.contains("mindfulness") || text.contains("{external_mindfulness") || text.contains("{mindfulness_source}")
        val mentionsHealthConnect = text.contains("health connect")

        if (needsHrv && !hcSignals.hasHrv) return false
        if (needsSleep && !hcSignals.hasSleep) return false
        if (needsSteps && !hcSignals.hasSteps) return false
        if (needsRhr && !hcSignals.hasRhr) return false
        if (needsMindfulness && !hcSignals.hasMindfulness) return false
        if (mentionsHealthConnect && !hcSignals.hasAny) return false

        return true
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Predefined question classifier — all routing fixes applied
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Exact routing for static UI questions from the Coach category tabs.
     * Now takes UsageSummary for data-driven routing decisions.
     */
    private fun classifyPredefinedQuestion(
        query: String,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): ClassifiedIntent? {
        val q = query.lowercase(Locale.US)
            .trim()
            .replace("'", "'")
            .replace("?", "")

        return when {
            // ── Score tab ─────────────────────────────────────────────────────

            // FIX: direction-aware — positive delta goes to PRODUCTIVE_DAY
            q.contains("why did my score change") ||
                    q.contains("score change") ->
                ClassifiedIntent(resolveScoreChangeIntent(summary), 1.0f, "predefined_query")

            // FIX: "What's dragging my score down?" — pillar-aware, but with a
            // no-drag guard so it doesn't claim a problem on a great-score day.
            // - Score >= 80 with no pillar < 65 → HEALTHY_PATTERN
            //   ("nothing significant is dragging your score").
            // - Otherwise route to the actual weakest pillar's intent.
            q.contains("what's dragging my score down") ||
                    q.contains("what is dragging my score down") ||
                    q.contains("dragging my score down") -> {
                val noDrag = summary.aureloScore >= 80 &&
                        summary.screenScore >= 65 &&
                        summary.focusScore >= 65 &&
                        summary.sleepScore >= 65
                val draggingIntent = when {
                    noDrag -> "HEALTHY_PATTERN"
                    pillarsUnpopulated(summary) -> "GENERAL_SUMMARY"
                    summary.focusScore in 1..59 -> "FOCUS_GAP"
                    summary.firstUseHour < 8 -> "MORNING_DOOM_SCROLL"
                    else -> "SCORE_DROP"
                }
                ClassifiedIntent(draggingIntent, 1.0f, "predefined_query")
            }

            q.contains("what's going well") ||
                    q.contains("what is going well") ->
                ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")

            // FIX: "How do I reach Excellent?" — when score is already ≥85, PRODUCTIVE_DAY
            // just celebrates instead of giving actionable maintenance advice.
            // Route to HEALTHY_PATTERN which focuses on sustaining what's working.
            q.contains("how do i reach excellent") ||
                    q.contains("reach excellent") ||
                    q.contains("get to excellent") -> {
                if (summary.aureloScore >= 85)
                    ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")
                else
                    ClassifiedIntent("PRODUCTIVE_DAY", 1.0f, "predefined_query")
            }

            // ── Habits tab ────────────────────────────────────────────────────

            // FIX: only confirm DOPAMINE_LOOP when pickups actually run hot.
            // pickups7DayAvg has to be > 0 (otherwise we have no baseline yet).
            q.contains("do i have a dopamine loop") ||
                    q.contains("dopamine loop") ->
                if (summary.pickups7DayAvg > 0f &&
                    summary.pickupsToday < summary.pickups7DayAvg)
                    ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")
                else
                    ClassifiedIntent("DOPAMINE_LOOP", 1.0f, "predefined_query")

            // FIX: data-driven trigger detection — distinct from "Do I have a dopamine loop?"
            // High-pickup case now routes to ANOMALOUS_SPIKE (diagnostic: what happened?)
            // rather than DOPAMINE_LOOP (mechanistic: the loop explained).
            // This prevents identical copy when topCategory isn't Social.
            q.contains("what triggers my phone use") ||
                    q.contains("triggers my phone use") ||
                    q.contains("phone use trigger") -> {
                val triggerIntent = when {
                    summary.firstUseHour < 8 -> "MORNING_DOOM_SCROLL"
                    isSocialDominant(summary) -> "SOCIAL_SPIRAL"
                    summary.pickupsToday > summary.pickups7DayAvg * 1.3f -> "ANOMALOUS_SPIKE"
                    else -> "MORNING_DOOM_SCROLL"
                }
                ClassifiedIntent(triggerIntent, 1.0f, "predefined_query")
            }

            // FIX: data-guarded — only force SOCIAL_SPIRAL when Social actually
            // is dominant. Otherwise return HEALTHY_PATTERN with the topCategory
            // surfaced so the answer reflects reality.
            q.contains("am i on social media too much") ||
                    q.contains("social media too much") ||
                    q.contains("social apps too much") ->
                if (isSocialDominant(summary))
                    ClassifiedIntent("SOCIAL_SPIRAL", 1.0f, "predefined_query")
                else
                    ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")

            q.contains("what's my best habit") ||
                    q.contains("what is my best habit") ||
                    q.contains("best habit right now") ->
                ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")

            // ── Sleep & Body tab ──────────────────────────────────────────────

            // FIX: when the user's bedtime routine is healthy (sleepScore >= 75)
            // and they aren't actually using the phone late, "Why do I use my
            // phone at night?" should not assume they do. Route to HEALTHY_PATTERN.
            q.contains("why do i use my phone at night") ||
                    q.contains("phone at night") ||
                    q.contains("night phone") ->
                if (summary.sleepScore >= 75)
                    ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")
                else
                    ClassifiedIntent("BEDTIME_REVENGE_PROCRASTINATION", 1.0f, "predefined_query")

            // FIX: HC-missing check now keys off the actual signal availability,
            // not just `hcConnected`. A user who connected HC for steps but never
            // granted Sleep permission previously got an HC_POOR_SLEEP template
            // that printed "Sleep last night: —"; now they get the dedicated
            // HC_MISSING_SLEEP explanation pointing them to Settings.
            q.contains("how does sleep affect my usage") ||
                    q.contains("sleep affect my usage") ||
                    q.contains("sleep affect phone") ||
                    q.contains("sleep affect screen") -> {
                if (!summary.hcConnected || !hcSignals.hasSleep) {
                    ClassifiedIntent("HC_MISSING_SLEEP", 1.0f, "predefined_query")
                } else {
                    ClassifiedIntent("HC_POOR_SLEEP_HIGH_USAGE", 1.0f, "predefined_query")
                }
            }

            // FIX: sleepScore-aware routing.
            //   sleepScore >= 75  → HEALTHY_PATTERN (the routine is working).
            //   sleepScore <  75  → BEDTIME_REVENGE_PROCRASTINATION (whose templates
            //                       explicitly talk about Bedtime Mode and bedtime
            //                       adherence). Previously routed to RECOVERY_DAY,
            //                       which printed "yesterday was tough but today is
            //                       trending better" — unrelated to bedtime.
            q.contains("how's my bedtime routine") ||
                    q.contains("how is my bedtime routine") ||
                    q.contains("bedtime routine") -> {
                val bedtimeIntent = if (summary.sleepScore >= 75) "HEALTHY_PATTERN"
                else "BEDTIME_REVENGE_PROCRASTINATION"
                ClassifiedIntent(bedtimeIntent, 1.0f, "predefined_query")
            }

            // FIX: signal-level HC check (see sleep-affect comment above).
            q.contains("what does my hrv tell me") ||
                    q.contains("hrv tell me") ||
                    q.contains("heart rate variability") -> {
                if (!summary.hcConnected || !hcSignals.hasHrv) {
                    ClassifiedIntent("HC_MISSING_HRV", 1.0f, "predefined_query")
                } else {
                    ClassifiedIntent("HC_POOR_SLEEP_HIGH_USAGE", 1.0f, "predefined_query")
                }
            }

            q.contains("am i active enough") ||
                    q.contains("active enough") -> {
                if (!summary.hcConnected || !hcSignals.hasSteps) {
                    ClassifiedIntent("HC_MISSING_STEPS", 1.0f, "predefined_query")
                } else {
                    ClassifiedIntent("HC_ACTIVE_DAY_BETTER_FOCUS", 1.0f, "predefined_query")
                }
            }

            // "What is revenge procrastination?" → FEATURE_EXPLANATION
            q.contains("what is revenge procrastination") ||
                    q.contains("revenge procrastination") && q.contains("what") ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            // ── Focus tab ─────────────────────────────────────────────────────

            // FIX: when the user has actually completed sessions today with no
            // interruptions, "Why can't I focus?" should not respond as if they
            // can't — surface the positive stat via PRODUCTIVE_DAY instead.
            q.contains("why can't i focus") ||
                    q.contains("why cant i focus") ||
                    q.contains("can't i focus") ||
                    q.contains("cant i focus") ->
                if (summary.focusSessionsCompleted > 0 && summary.focusSessionsInterrupted == 0)
                    ClassifiedIntent("PRODUCTIVE_DAY", 1.0f, "predefined_query")
                else
                    ClassifiedIntent("FOCUS_BURNOUT", 1.0f, "predefined_query")

            // FIX: "What's my session completion rate?" / "How are my focus
            // sessions going?" now route to FOCUS_ON_TRACK whenever the user
            // has completed *or* interrupted at least one session this week.
            // FOCUS_ON_TRACK templates always print the actual stat. Without
            // any sessions yet → FOCUS_GAP, which explains the gap.
            q.contains("session completion rate") ||
                    q.contains("what's my session completion") ||
                    q.contains("what is my session completion") ||
                    q.contains("completion rate") ||
                    q.contains("how are my focus sessions going") ||
                    q.contains("focus sessions going") -> {
                val hasSessions = summary.focusSessionsCompleted > 0 ||
                        summary.focusSessionsInterrupted > 0
                ClassifiedIntent(
                    if (hasSessions) "FOCUS_ON_TRACK" else "FOCUS_GAP",
                    1.0f,
                    "predefined_query",
                )
            }

            // FIX: FOCUS_PEAK_TIME (was wrongly GENERAL_SUMMARY)
            q.contains("when is my most focused time") ||
                    q.contains("most focused time") ||
                    q.contains("best time to focus") ->
                ClassifiedIntent("FOCUS_PEAK_TIME", 1.0f, "predefined_query")

            // ── Generic follow-up chips ────────────────────────────────────────

            q.contains("what should i work on first") ||
                    q.contains("work on first") ||
                    q.contains("what should i improve") ||
                    q.contains("where should i start") ->
                ClassifiedIntent("GENERAL_SUMMARY", 1.0f, "predefined_query")

            q.contains("how many minutes do i have left") ||
                    q.contains("minutes do i have left") ||
                    q.contains("minutes left") ||
                    q.contains("time left") ->
                ClassifiedIntent("STREAK_AT_RISK", 1.0f, "predefined_query")

            q.contains("when is my riskiest time") ||
                    q.contains("riskiest time") ||
                    q.contains("risky time") ->
                ClassifiedIntent("STREAK_AT_RISK", 1.0f, "predefined_query")

            q.contains("start a 10-minute focus session") ||
                    q.contains("start a 10 minute focus session") ||
                    q.contains("start focus session") ->
                ClassifiedIntent("FOCUS_GAP", 1.0f, "predefined_query")

            q.contains("which apps should i block") ||
                    q.contains("apps should i block") ->
                ClassifiedIntent("DOPAMINE_LOOP", 1.0f, "predefined_query")

            q.contains("how do i rebuild focus") ||
                    q.contains("rebuild focus") ->
                ClassifiedIntent("FOCUS_GAP", 1.0f, "predefined_query")

            q.contains("tell me about my week") ->
                ClassifiedIntent("GENERAL_SUMMARY", 1.0f, "predefined_query")

            // ── New intents from analysis ──────────────────────────────────────

            // APP_DEEP_DIVE
            q.contains("how much time on") ||
                    q.contains("how long on") ||
                    q.contains("how much do i use") ||
                    q.contains("time on instagram") ||
                    q.contains("time on youtube") ||
                    q.contains("time on tiktok") ||
                    q.contains("my most used app") ||
                    q.contains("top app") && q.contains("how") ->
                ClassifiedIntent("APP_DEEP_DIVE", 1.0f, "predefined_query")

            // FEATURE_EXPLANATION
            (q.contains("what is") || q.contains("how does") || q.contains("what does")) &&
                    (q.contains("score") || q.contains("bedtime mode") || q.contains("focus session") ||
                            q.contains("mindful pause") || q.contains("sleep score") || q.contains("streak") ||
                            q.contains("aurelo") || q.contains("hrv") || q.contains("pickup")) ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            // GOAL_SETTING_ADVICE
            q.contains("is my goal") ||
                    q.contains("change my goal") ||
                    q.contains("what goal should i") ||
                    q.contains("goal too high") ||
                    q.contains("goal too low") ||
                    q.contains("adjust my goal") ||
                    q.contains("should i change my goal") ||
                    q.contains("what daily goal") ->
                ClassifiedIntent("GOAL_SETTING_ADVICE", 1.0f, "predefined_query")

            // FOCUS_PEAK_TIME (freeform variants)
            q.contains("peak focus") ||
                    q.contains("when should i focus") ||
                    q.contains("best focus window") ||
                    q.contains("most focused") && q.contains("time") ->
                ClassifiedIntent("FOCUS_PEAK_TIME", 1.0f, "predefined_query")

            // ── Unrouted follow-up chip labels — all fixed ────────────────────

            // "How do I connect Health Connect?" → FEATURE_EXPLANATION
            q.contains("health connect") ||
                    q.contains("connect health") ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            // "How do I build on this?" → HEALTHY_PATTERN
            q.contains("build on this") ||
                    q.contains("build on my") ->
                ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")

            // "How am I trending this week?" → GENERAL_SUMMARY
            q.contains("trending this week") ||
                    q.contains("how am i trending") ->
                ClassifiedIntent("GENERAL_SUMMARY", 1.0f, "predefined_query")

            // "How do I improve focus?" / "How do I improve my focus score?" → FOCUS_GAP
            q.contains("improve focus") ||
                    q.contains("improve my focus") ->
                ClassifiedIntent("FOCUS_GAP", 1.0f, "predefined_query")

            // "How do I protect my streak today?" → STREAK_AT_RISK
            q.contains("protect my streak") ||
                    q.contains("protect streak") ->
                ClassifiedIntent("STREAK_AT_RISK", 1.0f, "predefined_query")

            // "How do I recover today?" → RECOVERY_DAY
            q.contains("recover today") ||
                    q.contains("how do i recover") ->
                ClassifiedIntent("RECOVERY_DAY", 1.0f, "predefined_query")

            // "How do I set a focus schedule?" → FEATURE_EXPLANATION
            q.contains("focus schedule") ||
                    q.contains("set a focus schedule") ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            // "How does first-use time affect my score?" /
            // "How much does first-use time affect my score?" → FEATURE_EXPLANATION
            q.contains("first-use time") ||
                    q.contains("first use time") ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            // "How does sleep affect my phone use?" → HC-aware
            q.contains("sleep affect my phone") ||
                    q.contains("sleep affect phone use") ||
                    q.contains("sleep affect my phone use") -> {
                if (!summary.hcConnected)
                    ClassifiedIntent("HC_MISSING_SLEEP", 1.0f, "predefined_query")
                else
                    ClassifiedIntent("HC_POOR_SLEEP_HIGH_USAGE", 1.0f, "predefined_query")
            }

            // "How does sleep affect my score?" → FEATURE_EXPLANATION
            q.contains("sleep affect my score") ||
                    q.contains("sleep affect score") ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            // "How many pickups is normal?" / "How many minutes do I have left?" (keyword fallback)
            q.contains("how many pickups") ||
                    q.contains("pickups is normal") ||
                    q.contains("normal pickups") ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            // "Start a focus session now" / "Start a 5-min session" → FOCUS_GAP
            q.contains("start a focus session") ||
                    q.contains("start focus session") ||
                    q.contains("start a 5") ||
                    q.contains("start a quick") ||
                    q.contains("start a short") ->
                ClassifiedIntent("FOCUS_GAP", 1.0f, "predefined_query")

            // "Tell me about my worst day" → ANOMALOUS_SPIKE
            q.contains("worst day") ||
                    q.contains("tell me about my worst") ->
                ClassifiedIntent("ANOMALOUS_SPIKE", 1.0f, "predefined_query")

            // "What can I do tonight?" / "What should I do differently tonight?"
            // / "What time should I stop?" → BEDTIME_REVENGE_PROCRASTINATION
            q.contains("what can i do tonight") ||
                    q.contains("do tonight") ||
                    q.contains("differently tonight") ||
                    q.contains("time should i stop") ||
                    q.contains("what time should i stop") ->
                ClassifiedIntent("BEDTIME_REVENGE_PROCRASTINATION", 1.0f, "predefined_query")

            // "What else helps my focus?" → FOCUS_GAP
            q.contains("helps my focus") ||
                    q.contains("what else helps") ||
                    q.contains("else helps my") ->
                ClassifiedIntent("FOCUS_GAP", 1.0f, "predefined_query")

            // "What should I do instead of checking my phone?" → DOPAMINE_LOOP
            q.contains("instead of checking") ||
                    q.contains("what should i do instead") ->
                ClassifiedIntent("DOPAMINE_LOOP", 1.0f, "predefined_query")

            // "What should I do right now?" → STREAK_AT_RISK
            q.contains("what should i do right now") ||
                    q.contains("do right now") ->
                ClassifiedIntent("STREAK_AT_RISK", 1.0f, "predefined_query")

            // "What should I focus on next?" → GENERAL_SUMMARY
            q.contains("what should i focus on") ||
                    q.contains("focus on next") ->
                ClassifiedIntent("GENERAL_SUMMARY", 1.0f, "predefined_query")

            // "What's a healthy social limit?" → SOCIAL_SPIRAL
            q.contains("social limit") ||
                    q.contains("healthy social limit") ||
                    q.contains("healthy social") ->
                ClassifiedIntent("SOCIAL_SPIRAL", 1.0f, "predefined_query")

            // "What's causing this?" → SCORE_DROP
            q.contains("causing this") ||
                    q.contains("what's causing") ||
                    q.contains("what is causing") ->
                ClassifiedIntent("SCORE_DROP", 1.0f, "predefined_query")

            // "What's my best habit this week?" → HEALTHY_PATTERN (explicit, covers all variants)
            q.contains("best habit this week") ||
                    q.contains("best habit right now") ->
                ClassifiedIntent("HEALTHY_PATTERN", 1.0f, "predefined_query")

            // "What's my weekly average?" / "What's my weekly pattern?" → GENERAL_SUMMARY
            q.contains("weekly average") ||
                    q.contains("weekly pattern") ||
                    q.contains("my weekly") ->
                ClassifiedIntent("GENERAL_SUMMARY", 1.0f, "predefined_query")

            // "Why does the pause help?" → FEATURE_EXPLANATION
            q.contains("why does the pause") ||
                    q.contains("does the pause help") ||
                    q.contains("pause help") ->
                ClassifiedIntent("FEATURE_EXPLANATION", 1.0f, "predefined_query")

            else -> null
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Keyword classifier — expanded patterns
    // ─────────────────────────────────────────────────────────────────────────

    private fun classifyQueryIntent(query: String): ClassifiedIntent {
        val q = query.lowercase(Locale.US).trim()
        if (q.isBlank()) return ClassifiedIntent("GENERAL_SUMMARY", 0f)

        val rules = listOf(
            "SCORE_DROP" to listOf(
                "score drop", "score went down", "score change", "lower score", "score fell",
                "why did my score", "score decreased", "score shifted",
                // FIX: additional phrasings
                "went from", "dropped to", "score today", "score is at", "score fell to",
                "score worse", "score bad", "score went",
                // FIX: chip labels
                "causing this", "what's causing", "what is causing",
            ),
            "STREAK_AT_RISK" to listOf(
                "streak", "lose streak", "break streak", "safe today", "streak risk",
                "keep streak", "lose my streak", "will i break",
                // FIX: chip labels
                "riskiest time", "risky time", "protect my streak", "right now",
                "what should i do right now",
            ),
            "FOCUS_PEAK_TIME" to listOf(
                "most focused time", "most focused", "when am i focused",
                "best time to focus", "peak focus", "when should i focus",
                "best focus window",
            ),
            "FOCUS_GAP" to listOf(
                "haven't focused", "no session", "last session", "focus gap",
                "should i focus", "no focus", "focus sessions", "session completion",
                "completion rate", "how do i rebuild", "missed sessions",
                // FIX: chip labels
                "improve focus", "improve my focus", "helps my focus",
                "start a focus session", "start focus session", "what else helps",
            ),
            "DOPAMINE_LOOP" to listOf(
                "dopamine", "mindless", "keep checking", "pick up phone",
                "keep scrolling", "doom scroll", "habit loop",
                // FIX: compulsive pickup phrasings
                "always on my phone", "can't put it down", "keep unlocking",
                "checking constantly", "compulsively", "every few minutes",
                "notification", "keep opening",
                // FIX: chip labels
                "instead of checking", "what should i do instead",
            ),
            "SOCIAL_SPIRAL" to listOf(
                "social media", "instagram", "tiktok", "twitter", "reddit", "social apps",
                "facebook",
                // FIX: YouTube and app-time phrasings
                "youtube", "my worst app", "time on apps", "app time", "spending too much on",
                // FIX: chip labels
                "social limit", "healthy social",
            ),
            "PRODUCTIVE_DAY" to listOf(
                "doing well", "on track", "good day", "am i improving", "getting better",
                "going well", "reach excellent", "excellent", "great day",
            ),
            "MORNING_DOOM_SCROLL" to listOf(
                "morning", "first thing", "woke up", "first use", "wake up", "start of day",
                "checked email first", "first thing in bed", "phone in bed", "alarm then scroll",
            ),
            "BEDTIME_REVENGE_PROCRASTINATION" to listOf(
                "late night", "bedtime", "before bed", "revenge procrastination",
                "midnight", "phone at night", "night usage",
                // FIX: sleep deprivation mentions
                "only slept", "barely slept", "2am", "3am", "up late",
                "slept 4", "slept 5", "slept 3",
                // FIX: chip labels
                "tonight", "do tonight", "time to stop", "differently tonight",
                "time should i stop",
            ),
            "FOCUS_BURNOUT" to listOf(
                "burnout", "burnt out", "tired", "exhausted", "stressed",
                "can't focus", "cant focus", "why can't i focus", "why cant i focus",
                "struggling to focus", "distracted",
                // FIX: broader fatigue/attention failure
                "hard to concentrate", "no energy", "unmotivated", "low energy",
                "keep getting distracted", "brain fog", "scattered attention",
            ),
            "WEEKEND_BINGE" to listOf("weekend", "saturday", "sunday", "days off", "binge"),
            "RECOVERY_DAY" to listOf(
                "recovery", "recovering", "bounce back", "after bad day",
                "better than yesterday", "improvement", "rebuild",
                // FIX: chip labels
                "recover today", "how do i recover", "trending this week", "how am i trending",
            ),
            "ANOMALOUS_SPIKE" to listOf(
                "spike", "unusual", "way more", "a lot today", "highest ever", "record",
                // FIX: "what happened yesterday" → recent spike
                "what happened yesterday", "yesterday so bad", "yesterday so high",
                // FIX: chip labels
                "worst day", "tell me about my worst",
            ),
            "HEALTHY_PATTERN" to listOf(
                "what's working", "best habit", "positive pattern",
                "what am i doing right", "good habit",
                // FIX: chip labels
                "build on this", "best habit this week", "best habit right now",
            ),
            "HC_POOR_SLEEP_HIGH_USAGE" to listOf(
                "hrv", "heart rate variability", "poor sleep", "sleep affect",
                "sleep and phone", "bad sleep", "hrv low", "what does my hrv",
            ),
            "HC_ACTIVE_DAY_BETTER_FOCUS" to listOf(
                "active day", "steps", "exercise", "walking more", "when i exercise",
                "am i active enough", "active enough",
            ),
            // FIX: new intent rules
            "FEATURE_EXPLANATION" to listOf(
                "what does", "what is aurelo score", "what is the score",
                "what is a focus session", "how does bedtime mode",
                "what is revenge procrastination", "what is hrv",
                "what is a streak", "what is the sleep score",
                "how does the score work", "explain",
                // FIX: chip labels
                "health connect", "focus schedule", "first-use time", "first use time",
                "how many pickups", "normal pickups", "pause help", "why does the pause",
                "how do i add a mindful", "how does bedtime work",
            ),
            "GOAL_SETTING_ADVICE" to listOf(
                "is my goal", "change my goal", "what goal should i set",
                "goal too high", "goal too low", "adjust my goal",
                "should i change", "lower my goal", "raise my goal",
                "what daily goal",
            ),
            "APP_DEEP_DIVE" to listOf(
                "how much time on", "how long on", "spending on",
                "how much do i use", "time on instagram", "time on youtube",
                "time on tiktok", "my most used app", "top app",
            ),
            "GENERAL_SUMMARY" to listOf(
                "summary", "overall", "overview", "what do you see",
                "my data", "this week", "analyse", "analyze",
                "what should i work on", "where do i start",
                // FIX: chip labels
                "trending this week", "weekly pattern", "weekly average",
                "focus on next", "what should i focus on", "how am i trending",
            ),
        )

        var bestIntent = "UNKNOWN"
        var bestScore = 0f

        for ((intent, patterns) in rules) {
            var score = 0f
            for (pattern in patterns) {
                if (q.contains(pattern)) {
                    score += if (pattern.contains(" ")) 0.6f else 0.3f
                }
            }
            if (score > bestScore) {
                bestScore = score.coerceAtMost(1f)
                bestIntent = intent
            }
        }

        return ClassifiedIntent(bestIntent, bestScore)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sanitizer
    // ─────────────────────────────────────────────────────────────────────────

    private fun sanitizeFilledText(
        intent: String,
        insight: InsightTemplateLibrary.InsightText,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
        query: String = "",
    ): InsightTemplateLibrary.InsightText {
        var title = insight.title
        var body = insight.body

        // Avoid "0× average" when pickup baseline has not been computed yet.
        if (summary.pickups7DayAvg <= 0f) {
            body = body
                .replace("your 7-day average is 0×", "your recent pickup average is still being built")
                .replace("your 7-day average is 0", "your recent pickup average is still being built")
                .replace("your daily pickup count runs 0× higher on average", "your pickup count tends to run higher")
                .replace("0× higher on average", "higher on average")
        }

        // Avoid empty app/category slots.
        body = body
            .replace("Blocking  in the next", "Blocking your top distractor in the next")
            .replace("blocking  in the next", "blocking your top distractor in the next")
            .replace("on  in the next", "on your top distractor in the next")
            .replace("  ", " ")

        // Avoid "1 days" / "1 pts" / "1 points" / "1 hours" / "1 sessions" /
        // "1 minutes" — common when arithmetic returns 1 and the template has
        // a hard-coded plural.
        body = body
            .replace("1 days", "1 day")
            .replace("1 pts", "1 pt")
            .replace("1 points", "1 point")
            .replace("1 hours", "1 hour")
            .replace("1 sessions", "1 session")
            .replace("1 minutes", "1 minute")
        title = title
            .replace("1 days", "1 day")
            .replace("1 pts", "1 pt")
            .replace("1 points", "1 point")
            .replace("1 hours", "1 hour")
            .replace("1 sessions", "1 session")
            .replace("1 minutes", "1 minute")

        // Avoid all-zero score summaries when score fields are not populated.
        if (
            body.contains("Screen 0 · Focus 0 · Sleep 0") &&
            summary.screenScore <= 0 &&
            summary.focusScore <= 0 &&
            summary.sleepScore <= 0
        ) {
            body = "Your score breakdown is still being built from today's data. What stands out right now: ${summary.todayMinutes} min of screen time, ${summary.pickupsToday} pickups, and a ${summary.streakDays}-day streak."
        }

        // Avoid "Score 0" when overall score is not populated.
        if (body.contains("Score 0")) {
            body = body.replace(
                "Score 0, ",
                ""
            ).replace(
                "Score 0 · ",
                ""
            ).replace(
                "Score 0",
                "Your score is still being calculated"
            )
        }

        // Avoid low-HRV claims when HRV is equal/near average.
        val hrvLooksNormal = summary.hrvToday != null &&
                summary.hrv7DayAvg != null &&
                summary.hrv7DayAvg > 0f &&
                summary.hrvToday >= summary.hrv7DayAvg * 0.95f

        if (hrvLooksNormal) {
            body = body
                .replace(
                    Regex("Your HRV sits 0% below your average today, which lines up with the higher screen time that dragged your score\\. Low HRV days and heavy usage often move together — rest matters\\."),
                    "Your score moved mostly because of today's screen time and pickup pattern. HRV looks near your average, so this one is more about phone-use behaviour than recovery strain."
                )
                .replace(
                    Regex("Your overnight HRV \\([^)]*\\) is 0% below average after last night's late session\\. The data link is clear: late screen time directly suppresses recovery\\. Tonight's cut-off: 10 PM\\."),
                    "Late-night phone use can crowd out recovery time. Tonight, aim for a 10 PM cut-off so the bedtime routine is handled structurally instead of by willpower."
                )
                .replace(
                    Regex("Your HRV \\([^)]*\\) is 0% below average — on low-HRV days sustained focus is physiologically harder\\. This isn't a willpower failure\\. A short Gentle session is the right move\\."),
                    "Focus can be harder when your day starts with high pickups or fragmented attention. This isn't a willpower failure — a short Gentle session is the right move."
                )
                .replace(
                    Regex("Short sleep makes phones harder to resist\\. Your HRV \\([^)]*\\) confirms the strain\\."),
                    "Short or disrupted sleep can make phones harder to resist."
                )
                .replace("low HRV", "recovery")
                .replace("Low HRV", "Recovery")
                .replace("strong HRV", "steady recovery")
        }

        // Avoid misleading 0% social copy when category share was not available.
        if (intent == "SOCIAL_SPIRAL" && body.contains("Social is 0%")) {
            body = "Social is your leading category today. A focused afternoon block can still change the daily breakdown significantly."
        }

        // Avoid "Good step day" when steps are below the usual active-day threshold.
        if (intent == "HC_ACTIVE_DAY_BETTER_FOCUS" && hcSignals.hasSteps) {
            val steps = summary.stepsToday ?: 0
            if (steps < 8000) {
                title = "🚶 Activity check — ${steps.toLocaleString()} steps"
                body = when {
                    steps >= 5000 ->
                        "Health Connect shows ${steps.toLocaleString()} steps. You're partway to an active day — Aurelo usually sees stronger screen-time benefits closer to 8,000 steps."
                    else ->
                        "Health Connect shows ${steps.toLocaleString()} steps. That's below the active-day range Aurelo uses, so today may not get the activity benefit yet."
                }
            }
        }

        // FIX: APP_DEEP_DIVE — when the user names a specific app in the query
        // ("How much time on Instagram?"), rewrite the response to address that
        // app instead of the generic top-app. If the named app isn't in the
        // user's tracked top-app list we say so explicitly rather than
        // silently substituting another app's name.
        if (intent == "APP_DEEP_DIVE" && query.isNotBlank()) {
            val (named, lookup) = resolveNamedApp(query, summary)
            if (named != null) {
                if (lookup != null) {
                    title = "📱 ${lookup.label} — what your data shows"
                    body = "${lookup.label} accounted for ${lookup.minutes} min of your " +
                            "${summary.todayMinutes} min total today. " +
                            "Adding a Mindful Pause or App Timer on ${lookup.label} via Focus → App Timers " +
                            "is the fastest way to directly cut time on it."
                } else {
                    val pretty = named.replaceFirstChar { it.uppercase() }
                    title = "📱 $pretty isn't in your top apps today"
                    body = "I don't see $pretty in your tracked top-app list for today, so I can't " +
                            "give you a per-app number. " +
                            "If you'd like to track it, install or open it for a session and Aurelo will " +
                            "pick it up. For your full per-app breakdown go to Wellness → Today → All Apps."
                }
            }
        }

        // FIX: SCORE_DROP — inject worst-pillar context if not already present.
        // Skip when no pillar scores have been computed yet (fresh install) so we
        // don't print "The main driver was your Focus Score (0) — 35%" to a user
        // who has never had a focus session.
        if (intent == "SCORE_DROP" && !pillarsUnpopulated(summary) &&
            !body.contains("Focus Score") && !body.contains("Screen Score") && !body.contains("Sleep Score")) {
            val pillar = worstPillar(summary)
            val pillarScore = when (pillar) {
                "Focus" -> summary.focusScore
                "Sleep" -> summary.sleepScore
                else -> summary.screenScore
            }
            val pillarContrib = when (pillar) {
                "Focus" -> "35%"
                "Sleep" -> "25%"
                else -> "40%"
            }
            body += " The main driver was your $pillar Score ($pillarScore) — it contributes $pillarContrib of your Aurelo Score."
        }

        // If an HC-specific query had to fall back to GENERAL_SUMMARY because the
        // required signal is missing, explain that instead of showing a generic summary.
        if (
            intent == "GENERAL_SUMMARY" &&
            !insight.hcBased &&
            (body.contains("Screen 0 · Focus 0 · Sleep 0") || body.contains("No urgent pattern today")) &&
            summary.hcConnected
        ) {
            body = "I don't have enough matching Health Connect data for that specific signal yet. I can still use today's screen data: ${summary.todayMinutes} min, ${summary.pickupsToday} pickups, and a ${summary.streakDays}-day streak."
        }

        return insight.copy(title = title, body = body)
    }

    private fun Int.toLocaleString(): String =
        String.format(Locale.US, "%,d", this)

    private fun resolveOrchestratorSlots(
        insight: InsightTemplateLibrary.InsightText,
        summary: UsageSummary,
    ): InsightTemplateLibrary.InsightText {
        val weekday = SimpleDateFormat("EEEE", Locale.US).format(Date())
        // FIX: {weekday+1} legacy slot — substitute with the next calendar day
        // so the literal token never appears to users.
        val tomorrowCal = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 1) }
        val tomorrow = SimpleDateFormat("EEEE", Locale.US).format(tomorrowCal.time)
        val peakWindow = computePeakFocusWindow()
        val title = insight.title
            .replace("{weekday}", weekday)
            .replace("{weekday+1}", tomorrow)
            .replace("{peak_focus_window}", peakWindow)
        val body = insight.body
            .replace("{weekday}", weekday)
            .replace("{weekday+1}", tomorrow)
            .replace("{peak_focus_window}", peakWindow)
        return insight.copy(title = title, body = body)
    }

    /**
     * Pick the 2-hour daytime window with the lowest historical screen-time
     * load from the cached monthly hourly breakdown (preferred) or today's
     * hourly cache as a fallback. Falls back to "9–11 AM" when no data is
     * available — matches the previous hard-coded copy so brand-new users
     * still see a sensible suggestion.
     */
    private fun computePeakFocusWindow(): String {
        val ctx = context ?: return "9–11 AM"
        val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        val sources = listOf(CACHED_MONTHLY_HOURLY, CACHED_HOURLY)
        for (key in sources) {
            val raw = prefs.getString(key, null)
            if (raw.isNullOrBlank() || raw == "[]") continue
            val window = pickLowLoadWindow(raw) ?: continue
            return window
        }
        return "9–11 AM"
    }

    private fun pickLowLoadWindow(json: String): String? {
        return runCatching {
            val arr = JSONArray(json)
            // Aggregate minutes per hour across all entries (monthly hourly
            // arrays may carry per-day buckets keyed by hour).
            val totals = LongArray(24)
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val hr = o.optInt("hour", -1)
                val mins = o.optLong("minutes", 0L)
                if (hr in 0..23) totals[hr] += mins
            }
            // Restrict to typical work hours; sleeping hours have low load
            // for trivial reasons.
            val candidates = (8..18).map { it to (totals[it] + totals[it + 1]) }
            val best = candidates.minByOrNull { it.second } ?: return@runCatching null
            val startH = best.first
            val endH = startH + 2
            fun fmt(h: Int): String = when {
                h == 0 -> "12 AM"
                h < 12 -> "$h AM"
                h == 12 -> "12 PM"
                else -> "${h - 12} PM"
            }
            "${fmt(startH)}–${fmt(endH)}"
        }.getOrNull()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Follow-ups — extended for new intents
    // ─────────────────────────────────────────────────────────────────────────

    private fun followUpsFor(
        intent: String,
        summary: UsageSummary,
        hcSignals: HcSignalAvailability,
    ): List<String> {
        val raw = when (intent) {
            // FIX: "What caused the drop?" loops back to the same intent — replaced with actionable recovery
            "SCORE_DROP" -> listOf("How do I recover today?", "Is my streak safe?", "What should I work on first?")
            "STREAK_AT_RISK" -> listOf("What should I do right now?", "When is my riskiest time?", "How many minutes do I have left?")
            "HC_POOR_SLEEP_HIGH_USAGE" -> listOf("Why do I use my phone at night?", "What can I do tonight?", "How are my focus sessions going?")
            "HC_ACTIVE_DAY_BETTER_FOCUS" -> listOf("Do active days improve my score?", "What else helps my focus?", "What's my best habit right now?")
            "FOCUS_GAP" -> if (summary.daysSinceLastFocus == 0 && summary.focusSessionsCompleted > 0)
                listOf("When is my most focused time?", "Which apps should I block?", "How do I reach Excellent?")
            else
                listOf("Start a 10-minute focus session", "Which apps should I block?", "What's my session completion rate?")
            "FOCUS_ON_TRACK" -> listOf("When is my most focused time?", "How do I reach Excellent?", "What's my best habit right now?")
            // FIX: "Start a focus session now" is an action — replaced with question routing to FOCUS_GAP
            "FOCUS_PEAK_TIME" -> listOf("How do I start a focus session?", "How does first-use time affect my score?", "What's a good session length?")
            // FIX: "Start a 5-minute focus session" is an action; route new question to FOCUS_GAP via predefined
            "FOCUS_BURNOUT" -> listOf("How do I start a focus session?", "Why can't I focus?", "How do I rebuild focus?")
            "BEDTIME_REVENGE_PROCRASTINATION" -> listOf("What time should I stop using my phone?", "What is revenge procrastination?", "How's my bedtime routine?")
            // FIX: "Add a mindful pause" is an action — replaced with a question that routes to FEATURE_EXPLANATION
            "DOPAMINE_LOOP" -> listOf("How do I add a mindful pause?", "Why does the loop happen?", "Am I on social media too much?")
            // FIX: "Share my streak" is an action; "How do I build on this?" now routes to HEALTHY_PATTERN
            "HEALTHY_PATTERN" -> listOf("How do I build on this?", "How is my streak looking?", "How close am I to Excellent?")
            "PRODUCTIVE_DAY" -> if ((summary.aureloScore) >= 85)
                listOf("Share my score", "What's my best habit this week?", "How do I maintain Excellent?")
            else
                listOf("Share my score", "What's my best habit this week?", "How do I reach Excellent?")
            "RECOVERY_DAY" -> listOf("How do I protect my streak today?", "What should I focus on next?", "How am I trending this week?")
            // FIX: "Block social apps for 25 min" is an action — replaced with question routing to SOCIAL_SPIRAL
            "SOCIAL_SPIRAL" -> listOf("Which social apps should I limit?", "What's a healthy social limit?", "Do I have a dopamine loop?")
            "MORNING_DOOM_SCROLL" -> listOf("How much does first-use time affect my score?", "Do I have a dopamine loop?", "What should I do instead of checking my phone?")
            "WEEKEND_BINGE" -> listOf("What's a good weekend goal?", "How do I set a focus schedule?", "Tell me about my week")
            "ANOMALOUS_SPIKE" -> listOf("Why do I spike on that day?", "How do I set a focus schedule?", "What's my weekly pattern?")
            // FIX: "Add a mindful pause" is an action — replaced with routable question
            "APP_DEEP_DIVE" -> listOf("How do I add a mindful pause?", "Am I on social media too much?", "Do I have a dopamine loop?")
            "FEATURE_EXPLANATION" -> listOf("How do I reach Excellent?", "What's my session completion rate?", "Why do I use my phone at night?")
            "GOAL_SETTING_ADVICE" -> listOf("How do I change my goal?", "How does my goal affect my score?", "What's my weekly average?")
            "GENERAL_SUMMARY" -> listOf("What should I work on first?", "How close am I to Excellent?", "What's my best habit this week?")
            else -> listOf("What should I work on first?", "How is my streak looking?", "Tell me about my week")
        }

        return raw.filterNot { label ->
            val l = label.lowercase(Locale.US)
            ((!summary.hcConnected || !hcSignals.hasSleep) && l.contains("sleep")) ||
                    ((!summary.hcConnected || !hcSignals.hasSteps) && (l.contains("active") || l.contains("step"))) ||
                    ((!summary.hcConnected || !hcSignals.hasHrv) && l.contains("hrv"))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Utilities
    // ─────────────────────────────────────────────────────────────────────────

    private fun rotationIndex(): Int {
        val day = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)
        return (day - 1).coerceIn(0, 2)
    }

    private fun priorityToConfidence(priority: Int): Float {
        return when {
            priority >= 10 -> 0.95f
            priority >= 9 -> 0.90f
            priority >= 8 -> 0.82f
            priority >= 7 -> 0.70f
            priority >= 6 -> 0.62f
            else -> 0.40f
        }
    }

    private fun isHcOnly(intent: String): Boolean =
        intent == "HC_POOR_SLEEP_HIGH_USAGE" || intent == "HC_ACTIVE_DAY_BETTER_FOCUS"

    private fun isKnownIntent(intent: String): Boolean = intent in TEMPLATE_INTENTS

    private fun normalizeIntent(intent: String): String {
        return when (intent) {
            "WORST_DAY_PATTERN" -> "ANOMALOUS_SPIKE"
            "PICKUP_SPIKE" -> "DOPAMINE_LOOP"
            "EVENING_USAGE" -> "BEDTIME_REVENGE_PROCRASTINATION"
            "APP_CATEGORY_DRIFT" -> "SOCIAL_SPIRAL"
            else -> intent
        }
    }

    private companion object {
        const val TAG = "AureloCoach"
        const val CONFIDENCE_THRESHOLD = 0.30f
        // FIX: lowered ONNX_PRIORITY from 8 to 7 so deterministic
        // pattern-detector signals (priority 7+) win ties. The shipped model
        // produces unreliable predictions on realistic personas (see
        // README → Coach audit) so we treat it as supporting evidence, not
        // ground truth, until it's retrained.
        const val ONNX_PRIORITY = 7
        const val HIGH_PRIORITY_PATTERN = 9
        // FIX: probability floor below which ONNX outputs are dropped
        // entirely. The 5-tree ensemble emits discrete buckets (0.2 / 0.4 /
        // 0.6 / 0.8); 0.45 keeps the strong predictions and rejects the
        // unstable mid-range ties.
        const val ONNX_PROB_FLOOR = 0.45f

        // FIX: updated to include all new intents
        val TEMPLATE_INTENTS = setOf(
            "SCORE_DROP",
            "STREAK_AT_RISK",
            "BEDTIME_REVENGE_PROCRASTINATION",
            "MORNING_DOOM_SCROLL",
            "FOCUS_BURNOUT",
            "HC_POOR_SLEEP_HIGH_USAGE",
            "HC_ACTIVE_DAY_BETTER_FOCUS",
            "PRODUCTIVE_DAY",
            "WEEKEND_BINGE",
            "RECOVERY_DAY",
            "SOCIAL_SPIRAL",
            "HEALTHY_PATTERN",
            "ANOMALOUS_SPIKE",
            "FOCUS_GAP",
            "DOPAMINE_LOOP",
            "GENERAL_SUMMARY",
            // New intents
            "FEATURE_EXPLANATION",
            "GOAL_SETTING_ADVICE",
            "APP_DEEP_DIVE",
            "FOCUS_PEAK_TIME",
            "FOCUS_ON_TRACK",
        )
    }
}