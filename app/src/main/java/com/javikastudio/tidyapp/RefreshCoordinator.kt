package com.javikastudio.tidyapp

import android.content.Context
import java.util.concurrent.atomic.AtomicLong

/**
 * Process-local throttle for expensive usage/widget refreshes that can be
 * triggered by foreground polling, WorkManager, AlarmManager, and JS actions.
 */
object RefreshCoordinator {
    internal const val MIN_USAGE_REFRESH_MS = 8_000L
    internal const val MIN_WIDGET_CACHE_REFRESH_MS = 60_000L

    private val lastUsageRefreshMs = AtomicLong(0L)
    private val lastWidgetCacheRefreshMs = AtomicLong(0L)

    fun shouldRefreshUsage(now: Long = System.currentTimeMillis()): Boolean =
        shouldRun(lastUsageRefreshMs, now, MIN_USAGE_REFRESH_MS)

    fun shouldRefreshWidgetCaches(context: Context, now: Long = System.currentTimeMillis()): Boolean {
        val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        val persistedLast = prefs.getLong("widget_cache_refresh_ts", 0L)
        if (now - persistedLast < MIN_WIDGET_CACHE_REFRESH_MS) return false
        if (!shouldRun(lastWidgetCacheRefreshMs, now, MIN_WIDGET_CACHE_REFRESH_MS)) return false
        prefs.edit().putLong("widget_cache_refresh_ts", now).apply()
        return true
    }

    internal fun shouldRun(last: AtomicLong, now: Long, minIntervalMs: Long): Boolean {
        while (true) {
            val prev = last.get()
            if (now - prev < minIntervalMs) return false
            if (last.compareAndSet(prev, now)) return true
        }
    }
}
