package com.javikastudio.tidyapp

import android.content.Context
import android.util.Log
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer

/**
 * CoachOnnxClassifier
 *
 * Loads app/src/main/assets/aurelo_coach.onnx and runs on-device intent/pattern inference.
 *
 * Expected ONNX input:
 *   name:  "input"
 *   shape: [1, 14]
 *   type:  float32
 *
 * Expected ONNX outputs from skl2onnx TreeEnsembleClassifier:
 *   output[0] = label tensor, usually LongArray
 *   output[1] = probabilities, not required here
 *
 * Important:
 * - The label order MUST match the order used when the ONNX model was exported.
 * - HC features must be zero when Health Connect is disconnected.
 */
class CoachOnnxClassifier(
    private val context: Context,
    private val modelAssetName: String = "aurelo_coach.onnx"
) {

    companion object {
        private const val TAG = "AureloCoach"

        /**
         * Numeric label index -> Coach intent string.
         *
         * This matches the 16-label ONNX export order we validated:
         * 0..15.
         */
        private val LABELS = arrayOf(
            "SCORE_DROP",
            "HC_POOR_SLEEP_HIGH_USAGE",
            "HC_ACTIVE_DAY_BETTER_FOCUS",
            "BEDTIME_REVENGE_PROCRASTINATION",
            "FOCUS_BURNOUT",
            "DOPAMINE_LOOP",
            "STREAK_AT_RISK",
            "FOCUS_GAP",
            "HEALTHY_PATTERN",
            "RECOVERY_DAY",
            "WORST_DAY_PATTERN",
            "PICKUP_SPIKE",
            "ANOMALOUS_SPIKE",
            "EVENING_USAGE",
            "APP_CATEGORY_DRIFT",
            "GENERAL_SUMMARY"
        )
    }

    private val env: OrtEnvironment by lazy {
        OrtEnvironment.getEnvironment()
    }

    private val session: OrtSession by lazy {
        Log.d(TAG, "CoachOnnxClassifier loading model from assets/$modelAssetName")

        val modelBytes = context.assets.open(modelAssetName).use { input ->
            input.readBytes()
        }

        Log.d(TAG, "CoachOnnxClassifier model bytes=${modelBytes.size}")

        env.createSession(modelBytes)
    }

    /**
     * Run ONNX inference and return the predicted intent name.
     *
     * This returns String instead of CoachIntent enum so it can work with either:
     * - Kotlin code that uses String intents, or
     * - Kotlin code that converts later via CoachIntent.valueOf(...)
     */
    /** Result of an ONNX inference — exposes top probability so callers can
     *  apply a confidence floor and reject low-confidence predictions. */
    data class Prediction(val intent: String, val probability: Float)

    fun classifyIntent(features: FloatArray): String =
        classifyWithProbability(features).intent

    fun classifyWithProbability(features: FloatArray): Prediction {
        require(features.size == 14) {
            "Coach ONNX expected 14 features, got ${features.size}"
        }

        Log.d(TAG, "CoachOnnxClassifier classify called")
        Log.d(TAG, "CoachOnnxClassifier features=${features.joinToString(prefix = "[", postfix = "]")}")

        val inputName = session.inputNames.firstOrNull() ?: "input"
        val shape = longArrayOf(1L, 14L)

        OnnxTensor.createTensor(env, FloatBuffer.wrap(features), shape).use { tensor ->
            session.run(mapOf(inputName to tensor)).use { results ->
                val rawLabel = results[0].value
                val labelIndex = extractLabelIndex(rawLabel)
                val intent = LABELS.getOrElse(labelIndex) { "GENERAL_SUMMARY" }
                val prob = extractTopProbability(
                    if (results.size() > 1) results[1].value else null,
                    labelIndex.toLong(),
                )

                Log.d(TAG, "CoachOnnxClassifier predicted labelIndex=$labelIndex " +
                        "intent=$intent prob=$prob")

                return Prediction(intent, prob)
            }
        }
    }

    /**
     * Same as classifyIntent(...), but safe:
     * returns null instead of throwing, so CoachOrchestrator can fall back to KotlinPatternDetector.
     */
    fun classifyIntentOrNull(features: FloatArray): String? {
        return try {
            classifyIntent(features)
        } catch (e: Exception) {
            Log.w(TAG, "CoachOnnxClassifier inference failed; falling back", e)
            null
        }
    }

    /** Same as classifyIntentOrNull but exposes the top probability. */
    fun classifyOrNull(features: FloatArray): Prediction? {
        return try {
            classifyWithProbability(features)
        } catch (e: Exception) {
            Log.w(TAG, "CoachOnnxClassifier inference failed; falling back", e)
            null
        }
    }

    /**
     * Extract the probability for [predictedLabel] from the ZipMap output of
     * skl2onnx TreeEnsembleClassifier. The wire format is a list of maps
     * keyed by class id (Long) with Float probability values. Returns 0f
     * when the structure can't be interpreted — callers must fall back to
     * a conservative threshold check rather than trust 1.0.
     */
    private fun extractTopProbability(value: Any?, predictedLabel: Long): Float {
        return runCatching {
            when (value) {
                is List<*> -> {
                    val first = value.firstOrNull() as? Map<*, *> ?: return@runCatching 0f
                    val raw = first[predictedLabel] ?: first[predictedLabel.toInt()]
                    when (raw) {
                        is Float -> raw
                        is Double -> raw.toFloat()
                        is Number -> raw.toFloat()
                        else -> 0f
                    }
                }
                is Map<*, *> -> {
                    val raw = value[predictedLabel] ?: value[predictedLabel.toInt()]
                    (raw as? Number)?.toFloat() ?: 0f
                }
                else -> 0f
            }
        }.getOrDefault(0f)
    }

    private fun extractLabelIndex(rawLabel: Any?): Int {
        return when (rawLabel) {
            is LongArray -> rawLabel.firstOrNull()?.toInt()
            is IntArray -> rawLabel.firstOrNull()
            is Array<*> -> {
                val first = rawLabel.firstOrNull()
                when (first) {
                    is Long -> first.toInt()
                    is Int -> first
                    is Number -> first.toInt()
                    else -> 15
                }
            }
            is Long -> rawLabel.toInt()
            is Int -> rawLabel
            is Number -> rawLabel.toInt()
            else -> {
                Log.w(TAG, "CoachOnnxClassifier unknown label output type=${rawLabel?.javaClass?.name}")
                15
            }
        } ?: 15
    }

    /**
     * Optional cleanup. Usually not required if this classifier is kept for app/session lifetime.
     */
    fun close() {
        try {
            session.close()
        } catch (_: Exception) {
        }
    }
}
