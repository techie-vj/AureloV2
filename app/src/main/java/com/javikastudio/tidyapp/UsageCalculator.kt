package com.javikastudio.tidyapp

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import java.util.Calendar

/**
 * UsageCalculator — single source of truth for "today's screen time" from raw
 * UsageEvents.
 *
 * Extracted after the 12h/22h/34h+ notification bug: UsageStatsBridge.buildUsageSnapshot()
 * and two separate copies of the same logic in AureloWidgetUpdateWorker (refreshCaches()
 * and refreshCachesStatic()) had each been patched independently for the same underlying
 * bugs (orphaned-session capping, per-session cap, day-elapsed ceiling) and drifted out of
 * sync — one path got fixed, the others didn't, which is exactly why the notification kept
 * showing impossible totals after the first fix. All three now delegate here.
 */
object UsageCalculator {

    /** Any single foreground session is capped at this length. */
    const val MAX_SESSION_MS = 4 * 60 * 60_000L

    data class Result(
        val timeMap: Map<String, Long>,  // packageName -> foreground ms today (unfiltered)
        val hourMins: LongArray,          // 24 buckets, minutes per hour-of-day (session start hour)
        val totalMins: Long,              // sum(timeMap) for known-user packages, clamped to elapsed time
        val pickups: Int,
        val firstPickupTs: Long
    )

    /**
     * Scans UsageEvents from [dayStart] to [now], reconstructing foreground sessions,
     * capping orphaned (still-open) sessions at the next screen-lock event instead of
     * running them to [now], capping every session at [MAX_SESSION_MS], and clamping
     * the final total so it can never exceed the actual elapsed time since [dayStart].
     *
     * @param isKnownUserPackage caller-supplied filter — each call site keeps its own
     *   system-app exclusion list; only affects totalMins, not pickups/firstPickupTs
     *   which are package-independent (KEYGUARD_HIDDEN is a global event).
     */
    @Suppress("DEPRECATION")
    fun computeToday(
        context: Context,
        usm: UsageStatsManager,
        dayStart: Long,
        now: Long,
        isKnownUserPackage: (String) -> Boolean
    ): Result {
        val events  = usm.queryEvents(dayStart, now)
        val ev      = UsageEvents.Event()
        val timeMap = mutableMapOf<String, Long>()
        val fgStart = mutableMapOf<String, Long>()
        val hourMins = LongArray(24)
        val screenOffs = mutableListOf<Long>()
        var pickups = 0
        var firstPickupTs = 0L

        while (events.hasNextEvent()) {
            events.getNextEvent(ev)
            if (ev.packageName == context.packageName) continue
            when (ev.eventType) {
                UsageEvents.Event.KEYGUARD_HIDDEN -> {
                    pickups++
                    if (firstPickupTs == 0L) firstPickupTs = ev.timeStamp
                }
                UsageEvents.Event.KEYGUARD_SHOWN -> screenOffs.add(ev.timeStamp)
                UsageEvents.Event.MOVE_TO_FOREGROUND -> fgStart[ev.packageName] = ev.timeStamp
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    val start = fgStart.remove(ev.packageName) ?: continue
                    val ms = (ev.timeStamp - start).coerceIn(0L, MAX_SESSION_MS)
                    timeMap[ev.packageName] = (timeMap[ev.packageName] ?: 0L) + ms
                    hourMins[hourOf(start)] += ms / 60_000L
                }
            }
        }
        screenOffs.sort()
        fgStart.forEach { (pkg, start) ->
            val end = capOrphanedSessionEnd(start, now, screenOffs)
            val ms = (end - start).coerceIn(0L, MAX_SESSION_MS)
            timeMap[pkg] = (timeMap[pkg] ?: 0L) + ms
            hourMins[hourOf(start)] += ms / 60_000L
        }

        val rawTotalMins = timeMap.filter { isKnownUserPackage(it.key) }.values.sum() / 60_000L
        val elapsedMinsToday = ((now - dayStart) / 60_000L).coerceAtLeast(0L)
        val totalMins = rawTotalMins.coerceAtMost(elapsedMinsToday)

        return Result(timeMap, hourMins, totalMins, pickups, firstPickupTs)
    }

    /**
     * An "orphaned" foreground session (MOVE_TO_FOREGROUND with no matching
     * MOVE_TO_BACKGROUND before [boundary]) is capped at the next screen-lock
     * (KEYGUARD_SHOWN) after it started, rather than assumed open until [boundary].
     */
    fun capOrphanedSessionEnd(start: Long, boundary: Long, sortedScreenOffs: List<Long>): Long {
        val lockAfterStart = sortedScreenOffs.firstOrNull { it > start && it < boundary }
        return lockAfterStart ?: boundary
    }

    private fun hourOf(tsMillis: Long): Int =
        Calendar.getInstance().apply { timeInMillis = tsMillis }.get(Calendar.HOUR_OF_DAY)
}
