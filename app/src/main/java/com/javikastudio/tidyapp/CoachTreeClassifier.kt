package com.javikastudio.tidyapp

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * CoachTreeClassifier
 *
 * Pure-Kotlin drop-in replacement for CoachOnnxClassifier.
 * Loads app/src/main/assets/aurelo_coach_tree.json and walks the
 * decision tree entirely on the JVM — no native .so, no ONNX Runtime,
 * no 16 KB page-alignment issues.
 *
 * JSON asset produced by scripts/export_coach_tree.py.
 *
 * Public API is identical to CoachOnnxClassifier so CoachOrchestrator
 * needs zero changes — just swap the instantiation site.
 *
 * Feature vector contract (must match CoachFeatureBuilder.toOnnx):
 *   0  todayMinutes
 *   1  pickupsToday
 *   2  topCategoryEncoded
 *   3  currentHour
 *   4  focusSessionsCompleted
 *   5  streakDays
 *   6  pickupDeltaVsAvg
 *   7  firstUseHour
 *   8  dayOfWeek
 *   9  hrvDeltaVsAvg        (0 when HC off)
 *  10  stepsToday           (0 when HC off)
 *  11  sleepDurationHours   (0 when HC off)
 *  12  rhrDeltaVsAvg        (0 when HC off)
 *  13  externalMindfulnessMinutesToday (0 when HC off)
 *  14  dailyGoalMinutes
 */
class CoachTreeClassifier(
    private val context: Context,
    private val assetName: String = "aurelo_coach_tree.json"
) {

    companion object {
        private const val TAG = "AureloCoach"

        /**
         * Must mirror LABELS in export_coach_tree.py and
         * CoachOnnxClassifier.LABELS — same order, same strings.
         */
        val LABELS = arrayOf(
            "STREAK_AT_RISK",                   // 0
            "HC_POOR_SLEEP_HIGH_USAGE",         // 1
            "HC_ACTIVE_DAY_BETTER_FOCUS",       // 2
            "BEDTIME_REVENGE_PROCRASTINATION",  // 3
            "FOCUS_BURNOUT",                    // 4
            "DOPAMINE_LOOP",                    // 5
            "SOCIAL_SPIRAL",                    // 6
            "FOCUS_GAP",                        // 7
            "FOCUS_ON_TRACK",                   // 8
            "MORNING_DOOM_SCROLL",              // 9
            "WEEKEND_BINGE",                    // 10
            "ANOMALOUS_SPIKE",                  // 11
            "PRODUCTIVE_DAY",                   // 12
            "RECOVERY_DAY",                     // 13
            "HEALTHY_PATTERN",                  // 14
            "GENERAL_SUMMARY",                  // 15
        )

        private const val FALLBACK_INTENT = "GENERAL_SUMMARY"
    }

    // ── Prediction result — identical shape to CoachOnnxClassifier.Prediction ──

    data class Prediction(val intent: String, val probability: Float)

    // ── Internal tree node representation ────────────────────────────────────

    private sealed class Node
    private data class Leaf(val labelIndex: Int) : Node()
    private data class Branch(
        val featureIndex: Int,
        val threshold: Float,
        val left: Node,   // feature[f] <= threshold
        val right: Node,  // feature[f] >  threshold
    ) : Node()

    // ── Lazy-loaded tree ──────────────────────────────────────────────────────

    private val root: Node by lazy { loadTree() }

    private fun loadTree(): Node {
        Log.d(TAG, "CoachTreeClassifier loading $assetName")
        val json = context.assets.open(assetName).use { stream ->
            stream.bufferedReader().readText()
        }
        val payload = JSONObject(json)
        val featureCount = payload.getInt("feature_count")
        require(featureCount == CoachFeatureBuilder.FEATURE_COUNT) {
            "Tree asset expects $featureCount features; " +
                    "CoachFeatureBuilder emits ${CoachFeatureBuilder.FEATURE_COUNT}"
        }
        val tree = parseNode(payload.getJSONObject("tree"))
        Log.d(TAG, "CoachTreeClassifier tree loaded OK")
        return tree
    }

    private fun parseNode(obj: JSONObject): Node {
        // Leaf: {"l": <index>}
        if (obj.has("l")) return Leaf(obj.getInt("l"))

        // Branch: {"f": <feat>, "t": <thresh>, "L": {...}, "R": {...}}
        return Branch(
            featureIndex = obj.getInt("f"),
            threshold    = obj.getDouble("t").toFloat(),
            left         = parseNode(obj.getJSONObject("L")),
            right        = parseNode(obj.getJSONObject("R")),
        )
    }

    // ── Inference ─────────────────────────────────────────────────────────────

    private fun walk(node: Node, features: FloatArray): Int {
        var current = node
        while (current is Branch) {
            current = if (features[current.featureIndex] <= current.threshold) {
                current.left
            } else {
                current.right
            }
        }
        return (current as Leaf).labelIndex
    }

    // ── Public API — identical to CoachOnnxClassifier ─────────────────────────

    fun classifyIntent(features: FloatArray): String =
        classifyWithProbability(features).intent

    fun classifyWithProbability(features: FloatArray): Prediction {
        require(features.size == CoachFeatureBuilder.FEATURE_COUNT) {
            "CoachTreeClassifier expected ${CoachFeatureBuilder.FEATURE_COUNT} " +
                    "features, got ${features.size}"
        }
        Log.d(TAG, "CoachTreeClassifier classify features=" +
                features.joinToString(prefix = "[", postfix = "]"))

        val labelIndex = walk(root, features)
        val intent = LABELS.getOrElse(labelIndex) { FALLBACK_INTENT }

        // Decision trees produce hard 0/1 probabilities per leaf in sklearn's
        // default config. We return 1.0 to signal "confident" so any
        // downstream confidence-floor check in CoachOrchestrator passes.
        // If you export leaf probabilities in the JSON in a future retrain
        // you can plumb them through here.
        Log.d(TAG, "CoachTreeClassifier predicted labelIndex=$labelIndex intent=$intent")
        return Prediction(intent, 1.0f)
    }

    fun classifyIntentOrNull(features: FloatArray): String? =
        runCatching { classifyIntent(features) }
            .onFailure { Log.w(TAG, "CoachTreeClassifier inference failed; falling back", it) }
            .getOrNull()

    fun classifyOrNull(features: FloatArray): Prediction? =
        runCatching { classifyWithProbability(features) }
            .onFailure { Log.w(TAG, "CoachTreeClassifier inference failed; falling back", it) }
            .getOrNull()

    /** No-op — kept for API compatibility with CoachOnnxClassifier. */
    fun close() = Unit
}
