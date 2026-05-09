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

        // Fade-in/out step cadence (ms)
        private const val FADE_STEP_MS = 80L
        // Total gradual fade duration = FADE_STEPS * FADE_STEP_MS = ~20 s (250 steps)
        private const val FADE_STEPS   = 250
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
    private var isSuspended  = false  // true while view is detached for overlay coexistence
    // isStopping: set true the instant stop() is called, cleared only in removeView().
    // Makes isActive() return false immediately so the poll loop stops managing the filter
    // and neither resumeFilter() nor update() can reattach/repaint the view during the
    // fade-out window (which keeps isShown=true for up to 20 s).
    private var isStopping   = false

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Show the filter overlay. If [gradual] is true, the warm and dim layers
     * fade from 0 to their target values over ~20 seconds (mimicking f.lux).
     */
    fun start(warmAlpha: Int, dimAlpha: Int, gradual: Boolean = false) {
        // Clear any in-progress fade-out so re-enabling during the fade works correctly.
        handler.removeCallbacksAndMessages(null)
        isStopping = false

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
        // No-op when suspended (view detached) or stopping (fade in progress).
        // Without the isStopping guard, the 500 ms poll loop would call update()
        // with the saved alpha values and cancel the fade-out immediately.
        if (!isShown || isSuspended || isStopping) return
        handler.removeCallbacksAndMessages(null)
        targetWarm  = warmAlpha.coerceIn(0, 100)
        targetDim   = dimAlpha.coerceIn(0, 100)
        currentWarm = targetWarm
        currentDim  = targetDim
        applyLayers(currentWarm, currentDim)
    }

    /**
     * BUG 3 FIX: Detach the filter view from WindowManager while a blocking
     * overlay (Focus / Bedtime / Timer / MindfulPause) is on screen.
     *
     * Setting alpha=0 and relying on FLAG_NOT_TOUCHABLE is insufficient on
     * some Android versions: even a fully transparent TYPE_APPLICATION_OVERLAY
     * window can disrupt touch routing to the interactive overlay above it,
     * making buttons on the focus/bedtime card unresponsive. Detaching the view
     * entirely guarantees zero interference.
     */
    fun suspend() {
        if (!isShown || isSuspended) return
        isSuspended = true
        handler.removeCallbacksAndMessages(null)
        filterView?.let { runCatching { wm.removeView(it) } }
    }

    /**
     * Re-attach the filter view after [suspend] and restore the last applied alpha.
     * The caller should immediately follow with [update] to set the correct values.
     */
    fun resumeFilter() {
        // isStopping guard: if stop() was called while the filter was suspended
        // (e.g. during a focus session), we must NOT reattach the view when the
        // focus overlay is dismissed — that would make a "disabled" filter reappear.
        if (!isShown || !isSuspended || isStopping) return
        isSuspended = false
        filterView?.let {
            runCatching { wm.addView(it, overlayParams()) }
            applyLayers(currentWarm, currentDim)
        }
    }

    /**
     * Remove the filter overlay with optional fade-out over 5 seconds.
     */
    fun stop(fadeOut: Boolean = true) {
        handler.removeCallbacksAndMessages(null)
        prefs.edit().putBoolean(FILTER_ACTIVE_KEY, false).apply()

        if (!isShown) return

        // Mark logically inactive NOW — before the fade — so isActive() returns false
        // immediately and the poll loop stops calling update()/resumeFilter() on this
        // engine. Without this, the poll loop would call update() with the saved alpha
        // values on the very next 500 ms tick, resetting the alpha to full and cancelling
        // the fade. Also prevents resumeFilter() from reattaching the view after a focus
        // session ends while the filter is in the middle of fading out.
        isStopping = true

        // Only run a visible fade when the view is actually attached to WM.
        // If suspended (already detached by a blocking overlay), go straight to removeView().
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
        if (filterView != null) return     // already attached

        // Guard: TYPE_APPLICATION_OVERLAY requires SYSTEM_ALERT_WINDOW permission.
        // Without it wm.addView() throws SecurityException, silently swallowed by
        // callers but leaving isShown=true with no actual view — causing the
        // "filter enabled but nothing visible" bug (Issue 6).
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

    /** Convert 0–100 slider value to an 8-bit alpha (0–255). [maxFraction] caps the top. */
    private fun alphaFor(value: Int, maxFraction: Float): Int =
        (value / 100f * maxFraction * 255).toInt().coerceIn(0, 255)

    // Gradual fade-in: increments by 1 each step
    private fun scheduleFadeStep() {
        handler.postDelayed({
            if (!isShown) return@postDelayed
            val warmStep = (targetWarm - currentWarm).coerceAtLeast(0)
            val dimStep  = (targetDim  - currentDim ).coerceAtLeast(0)
            if (warmStep == 0 && dimStep == 0) return@postDelayed   // reached target

            currentWarm = (currentWarm + 1).coerceAtMost(targetWarm)
            currentDim  = (currentDim  + 1).coerceAtMost(targetDim)
            applyLayers(currentWarm, currentDim)
            scheduleFadeStep()
        }, FADE_STEP_MS)
    }

    // Gradual fade-out: decrements by 1 each step then removes view
    private fun scheduleFadeOutStep() {
        handler.postDelayed({
            // isStopping is the correct cancellation guard here — isShown stays true
            // until removeView() is called at the very end of the fade, so it cannot
            // serve as a cancellation signal (e.g. if start() is called mid-fade).
            if (!isStopping) return@postDelayed
            if (currentWarm <= 0 && currentDim <= 0) { removeView(); return@postDelayed }
            currentWarm = (currentWarm - 1).coerceAtLeast(0)
            currentDim  = (currentDim  - 1).coerceAtLeast(0)
            applyLayers(currentWarm, currentDim)
            scheduleFadeOutStep()
        }, FADE_STEP_MS)
    }

    private fun removeView() {
        // Always attempt wm.removeView() — don't skip when isSuspended.
        // runCatching absorbs the harmless "not attached" exception when the view
        // was already removed by suspend(). Clears isStopping so the engine can
        // be restarted cleanly.
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
            // Non-blocking: passes all touches through, never steals focus
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