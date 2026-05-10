package com.javikastudio.tidyapp

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout

/**
 * ScreenFilterEngine
 *
 * Renders a non-blocking full-screen overlay with two composited layers:
 *   • Warm layer  — translucent orange tint  (reduces blue light)
 *   • Dim  layer  — translucent black        (reduces overall brightness)
 *
 * Unlike the blocking overlays owned by OverlayCoordinator, this view
 * passes all touch/focus events through via FLAG_NOT_TOUCHABLE so it
 * never interferes with app use. It coexists with bedtime/focus overlays
 * and sits at its own z-index managed directly via WindowManager.
 *
 * Lifecycle: created once in AppMonitorService.onCreate(); destroyed in
 * AppMonitorService.onDestroy(). Separate from the OverlayCoordinator
 * priority queue — it is always a background layer.
 *
 * Thread-safety: all public methods must be called from the main thread.
 *
 * Gradual fade modes:
 *   • gradual=true with default stepMs (~80 ms/step) → ~20 s fast fade (manual enable)
 *   • gradual=true with a long stepMs (e.g. 18 s/step) → 30 min slow fade (bedtime wind-down)
 * The [filterProgress] property (0.0–1.0) is exposed so callers like
 * buildNotification() can render a live progress bar without coupling to internals.
 */
class ScreenFilterEngine(
    private val context: Context,
    private val wm: WindowManager,
    private val prefs: SharedPreferences
) {

    companion object {
        // Pref keys (also declared in BridgeKeys.kt)
        const val FILTER_SETTINGS_KEY = "screen_filter_settings_v1"
        const val FILTER_ACTIVE_KEY   = "screen_filter_active"

        // Default fast fade cadence (ms per alpha step) — ~20 s total for warm=80
        private const val FADE_STEP_MS_DEFAULT = 80L
        // Fade-out uses the same default fast cadence regardless of fade-in speed
        private const val FADE_OUT_STEP_MS = 80L
    }

    private var filterView: FrameLayout? = null
    private var warmLayer: View? = null
    private var dimLayer: View? = null
    private val handler = Handler(Looper.getMainLooper())

    // Current applied alpha values (0–100 scale)
    private var currentWarm  = 0
    private var currentDim   = 0
    private var targetWarm   = 0
    private var targetDim    = 0
    private var isShown      = false
    private var isSuspended  = false
    // isStopping: set true the instant stop() is called, cleared only in removeView().
    private var isStopping   = false

    // Per-start fade cadence — set by start() to support both fast and slow fades.
    // The fast default (80 ms) gives ~20 s for warm=80; the bedtime wind-down passes
    // stepMs = 30*60*1000 / maxOf(warm, dim) so the full fade fills exactly 30 minutes.
    private var fadeStepMs: Long = FADE_STEP_MS_DEFAULT

    // ── Public read-only state ────────────────────────────────────────────────

    /**
     * Fraction of the target alpha that has been applied so far (0.0 – 1.0).
     * During a gradual fade-in this increases from 0 to 1; during normal operation
     * it is 1.0.  Returns 0.0 when the filter is inactive.
     * Used by AppMonitorService.buildNotification() to draw a live progress bar
     * during the bedtime wind-down phase without coupling to engine internals.
     */
    val filterProgress: Float
        get() {
            if (!isShown || isStopping) return 0f
            val maxTarget = maxOf(targetWarm, targetDim)
            if (maxTarget == 0) return 1f
            val maxCurrent = maxOf(currentWarm, currentDim)
            return (maxCurrent.toFloat() / maxTarget).coerceIn(0f, 1f)
        }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Show the filter overlay.
     *
     * @param warmAlpha  0–100 warm (orange) intensity
     * @param dimAlpha   0–100 dim (black) intensity
     * @param gradual    if true, alpha fades from 0 to target gradually
     * @param stepMs     ms per alpha-unit increment during gradual fade.
     *                   Default (~80 ms) → fast ~20 s fade (user-triggered).
     *                   Pass [30*60*1000 / maxOf(warm,dim)] for a 30-min bedtime fade.
     */
    fun start(warmAlpha: Int, dimAlpha: Int, gradual: Boolean = false, stepMs: Long = FADE_STEP_MS_DEFAULT) {
        // Clear any in-progress fade-out so re-enabling during the fade works correctly.
        handler.removeCallbacksAndMessages(null)
        isStopping = false
        fadeStepMs = stepMs.coerceAtLeast(1L)

        targetWarm = warmAlpha.coerceIn(0, 100)
        targetDim  = dimAlpha.coerceIn(0, 100)

        if (!isShown) {
            buildView()
            if (filterView == null) return   // permission missing — buildView() bailed
            isShown = true
        }

        if (gradual) {
            currentWarm = 0
            currentDim  = 0
            applyLayers(0, 0)
            scheduleFadeStep()
        } else {
            currentWarm = targetWarm
            currentDim  = targetDim
            applyLayers(currentWarm, currentDim)
        }

        prefs.edit().putBoolean(FILTER_ACTIVE_KEY, true).apply()
    }

    /**
     * Update alpha values on a running filter. No fade — applies immediately.
     */
    fun update(warmAlpha: Int, dimAlpha: Int) {
        if (!isShown || isSuspended || isStopping) return
        handler.removeCallbacksAndMessages(null)
        targetWarm  = warmAlpha.coerceIn(0, 100)
        targetDim   = dimAlpha.coerceIn(0, 100)
        currentWarm = targetWarm
        currentDim  = targetDim
        applyLayers(currentWarm, currentDim)
    }

    /**
     * Detach the filter view from WindowManager while a blocking overlay is on screen.
     */
    fun suspend() {
        if (!isShown || isSuspended) return
        isSuspended = true
        handler.removeCallbacksAndMessages(null)
        filterView?.let { runCatching { wm.removeView(it) } }
    }

    /**
     * Re-attach the filter view after [suspend] and restore the last applied alpha.
     */
    fun resumeFilter() {
        if (!isShown || !isSuspended || isStopping) return
        isSuspended = false
        filterView?.let {
            runCatching { wm.addView(it, overlayParams()) }
            applyLayers(currentWarm, currentDim)
        }
    }

    /**
     * Remove the filter overlay with optional fade-out over ~5 seconds (fast cadence).
     */
    fun stop(fadeOut: Boolean = true) {
        handler.removeCallbacksAndMessages(null)
        prefs.edit().putBoolean(FILTER_ACTIVE_KEY, false).apply()

        if (!isShown) return

        isStopping = true

        if (fadeOut && !isSuspended && (currentWarm > 0 || currentDim > 0)) {
            targetWarm = 0
            targetDim  = 0
            scheduleFadeOutStep()
        } else {
            removeView()
        }
    }

    fun isActive(): Boolean = isShown && !isStopping

    fun restoreFromPrefs() {
        val wasActive = prefs.getBoolean(FILTER_ACTIVE_KEY, false)
        if (!wasActive) return
        val cfg = readSettings()
        if (cfg.optBoolean("enabled", false)) {
            start(cfg.optInt("warmAlpha", 60), cfg.optInt("dimAlpha", 30), gradual = false)
        }
    }

    fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        removeView()
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun buildView() {
        if (filterView != null) return

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M &&
            !android.provider.Settings.canDrawOverlays(context)) {
            android.util.Log.w("ScreenFilterEngine", "canDrawOverlays=false — filter skipped")
            return
        }

        val warm = View(context).apply {
            setBackgroundColor(Color.argb(0, 255, 100, 0))
        }
        val dim = View(context).apply {
            setBackgroundColor(Color.argb(0, 0, 0, 0))
        }
        val frame = FrameLayout(context).apply {
            addView(warm, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
            addView(dim, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
        }

        warmLayer  = warm
        dimLayer   = dim
        filterView = frame

        wm.addView(frame, overlayParams())
    }

    private fun applyLayers(warm: Int, dim: Int) {
        warmLayer?.setBackgroundColor(Color.argb(alphaFor(warm, 0.55f), 255, 100, 0))
        dimLayer?.setBackgroundColor(Color.argb(alphaFor(dim,  0.75f),   0,   0, 0))
    }

    private fun alphaFor(value: Int, maxFraction: Float): Int =
        (value / 100f * maxFraction * 255).toInt().coerceIn(0, 255)

    // Gradual fade-in: uses fadeStepMs so the same logic handles both fast (80ms)
    // and slow (bedtime wind-down, e.g. ~18,000 ms/step) fades.
    private fun scheduleFadeStep() {
        handler.postDelayed({
            if (!isShown) return@postDelayed
            if (currentWarm >= targetWarm && currentDim >= targetDim) return@postDelayed

            currentWarm = (currentWarm + 1).coerceAtMost(targetWarm)
            currentDim  = (currentDim  + 1).coerceAtMost(targetDim)
            applyLayers(currentWarm, currentDim)
            scheduleFadeStep()
        }, fadeStepMs)
    }

    // Fast fade-out always uses FADE_OUT_STEP_MS — independent of the fade-in speed.
    private fun scheduleFadeOutStep() {
        handler.postDelayed({
            if (!isStopping) return@postDelayed
            if (currentWarm <= 0 && currentDim <= 0) { removeView(); return@postDelayed }
            currentWarm = (currentWarm - 1).coerceAtLeast(0)
            currentDim  = (currentDim  - 1).coerceAtLeast(0)
            applyLayers(currentWarm, currentDim)
            scheduleFadeOutStep()
        }, FADE_OUT_STEP_MS)
    }

    private fun removeView() {
        filterView?.let { runCatching { wm.removeView(it) } }
        filterView  = null
        warmLayer   = null
        dimLayer    = null
        isShown     = false
        isSuspended = false
        isStopping  = false
    }

    private fun overlayParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT

        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START }
    }

    private fun readSettings(): org.json.JSONObject =
        try { org.json.JSONObject(prefs.getString(FILTER_SETTINGS_KEY, "{}") ?: "{}") }
        catch (_: Exception) { org.json.JSONObject() }
}
