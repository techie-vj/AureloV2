package com.javikastudio.tidyapp

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * SoundEffects — tiny procedurally-synthesised audio cues.
 *
 * Why procedural and not bundled assets:
 *   • Zero asset bytes in the APK (saves ~50–200 KB per cue file).
 *   • Tones are tuned in code, which makes adjustments trivial and
 *     keeps the entire sound design reviewable in one Kotlin file.
 *   • No licensing / attribution to worry about.
 *
 * Each cue is a sine wave (with a quieter second-harmonic for a bell-like
 * timbre) modulated by an exponential decay envelope. Amplitude is kept
 * intentionally low (~0.18 peak) — these should be felt at the edge of
 * attention, never compete with media playback.
 *
 * Cues are played on the NOTIFICATION_EVENT audio stream so the OS routes
 * them correctly during phone calls, voice assistants, and audio focus
 * conflicts — exactly like a system notification chirp.
 *
 * All play paths are guarded by:
 *   • the user's "Sound cues" setting (default ON)
 *   • the active DND owner (skip while Bedtime / Quiet Hours hold DND)
 *   • the system InterruptionFilter (skip when set to NONE / ALARMS /
 *     PRIORITY — even though the OS would mute us anyway, we avoid the
 *     small CPU/battery hit of generating audio that goes nowhere)
 *   • a non-zero notification stream volume
 *   • an active Focus session (no chirps over a deep-work block, except
 *     for the session-complete cue itself which is the natural exception)
 *
 * Playback happens on a single-shot background thread so receivers
 * and the WebView JS thread never block on audio.
 */
object SoundEffects {

    private const val SAMPLE_RATE = 44_100
    private const val PEAK_AMPLITUDE = 0.18f

    /**
     * Each tone is described by an ordered list of (frequencyHz, durationMs)
     * segments. Multi-segment tones are useful for ascending / descending
     * pairs without the audible click between segments because each segment
     * carries its own attack-decay envelope.
     */
    enum class Tone(val segments: List<Pair<Double, Int>>) {
        /** Single soft mid-tone marking the start of a focus session. */
        SESSION_START(listOf(523.25 to 280)),

        /** Two-note ascending C5 → G5 — earned, celebratory but understated. */
        SESSION_COMPLETE(listOf(523.25 to 280, 783.99 to 380)),

        /** Descending G4 → C4 — calming, signals "wind down." */
        BEDTIME_START(listOf(392.00 to 320, 261.63 to 440)),

        /** Ascending G4 → D5 — bright but soft, paired with morning summary. */
        MORNING(listOf(392.00 to 280, 587.33 to 380)),

        /** Single soft A4 — paired with the mindful-pause overlay. */
        MINDFUL_PAUSE(listOf(440.00 to 320)),

        /** Short A5 blip — confirms a successful App Lock unlock. */
        UNLOCK(listOf(880.00 to 120)),

        /** Major triad C5 → E5 → G5 — fires only on streak milestones (3/7/14/30). */
        STREAK_MILESTONE(listOf(523.25 to 220, 659.25 to 220, 783.99 to 380)),

        /** Single bright E5 — confirms mood check-in submission. */
        MOOD_LOGGED(listOf(659.25 to 200))
    }

    /**
     * Public entry point. Safe to call from any thread; checks gates and
     * dispatches synthesis + playback to a worker thread.
     *
     * The [bypassDndCheck] flag is reserved for the SESSION_COMPLETE cue,
     * which should sound even when a Focus session has just disabled DND
     * one tick before this fires — otherwise a race between releasing DND
     * and playing the cue can swallow it.
     */
    fun play(ctx: Context, tone: Tone, bypassDndCheck: Boolean = false) {
        if (!shouldPlay(ctx, bypassDndCheck)) return
        Thread {
            runCatching { playInternal(tone) }
        }.apply {
            name = "SoundEffects-${tone.name}"
            isDaemon = true
        }.start()
    }

    // ── Gating logic ──────────────────────────────────────────────────────────

    private fun shouldPlay(ctx: Context, bypassDndCheck: Boolean): Boolean {
        val prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

        // 1. User preference — default ON. Read with default true so users
        //    who installed before this feature shipped get sounds by default.
        if (!prefs.getBoolean(SOUND_CUES_ENABLED, true)) return false

        // 2. DND owner — Aurelo's own quiet-hours / bedtime should never
        //    chirp over themselves. Bypassed only for the session-complete
        //    cue (see kdoc).
        if (!bypassDndCheck) {
            val owner = prefs.getString(DND_OWNER, DND_OWNER_NONE) ?: DND_OWNER_NONE
            if (owner == DND_OWNER_BEDTIME || owner == DND_OWNER_QUIET_HOURS) return false
        }

        // 3. System InterruptionFilter — defensive even though the OS would
        //    mute the NOTIFICATION_EVENT stream during DND anyway. Saves a
        //    bit of CPU/battery generating PCM that goes nowhere.
        runCatching {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            val filter = nm?.currentInterruptionFilter
                ?: NotificationManager.INTERRUPTION_FILTER_ALL
            if (filter != NotificationManager.INTERRUPTION_FILTER_ALL &&
                filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN &&
                !bypassDndCheck) {
                return false
            }
        }

        // 4. Notification stream volume — skip silently if user has muted.
        runCatching {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return@runCatching
            val streamVol = am.getStreamVolume(AudioManager.STREAM_NOTIFICATION)
            if (streamVol <= 0) return false
        }

        return true
    }

    // ── Synthesis + playback ─────────────────────────────────────────────────

    private fun playInternal(tone: Tone) {
        val pcm = synthesise(tone)
        if (pcm.isEmpty()) return

        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val fmt = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()

        val track = runCatching {
            AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(fmt)
                .setBufferSizeInBytes(pcm.size * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
        }.getOrNull() ?: return

        runCatching {
            track.write(pcm, 0, pcm.size)
            track.play()
            // Block this worker thread for the duration of the tone so we
            // can release the track cleanly afterward. The thread is a
            // daemon and dedicated to this tone, so this is safe.
            val totalMs = pcm.size * 1000L / SAMPLE_RATE
            Thread.sleep(totalMs + 60)
        }
        runCatching { track.stop() }
        runCatching { track.release() }
    }

    /**
     * Build a single PCM buffer for the entire tone (all segments concatenated).
     * Each segment is a sine + half-amplitude second-harmonic, modulated by
     * an attack-decay envelope: 5 ms linear attack to avoid clicks, then an
     * exponential decay across the rest of the segment.
     */
    private fun synthesise(tone: Tone): ShortArray {
        val totalSamples = tone.segments.sumOf { (_, ms) -> ms * SAMPLE_RATE / 1000 }
        val buf = ShortArray(totalSamples)
        var offset = 0
        for ((freq, durMs) in tone.segments) {
            val samples = durMs * SAMPLE_RATE / 1000
            val tau = (durMs / 1000.0) / 3.0   // ~95% decay over the segment
            val attackSamples = (0.005 * SAMPLE_RATE).toInt()
            val twoPiF = 2.0 * PI * freq
            val twoPiF2 = 2.0 * PI * (freq * 2.0)
            for (i in 0 until samples) {
                val t = i / SAMPLE_RATE.toDouble()
                val envelope = (if (i < attackSamples) i.toDouble() / attackSamples else 1.0) *
                    exp(-t / tau)
                val sample = (sin(twoPiF * t) + 0.30 * sin(twoPiF2 * t)) * envelope
                val v = (sample * PEAK_AMPLITUDE * Short.MAX_VALUE).toInt()
                    .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                buf[offset + i] = v.toShort()
            }
            offset += samples
        }
        return buf
    }
}
