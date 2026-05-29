package com.javikastudio.tidyapp

import android.content.Context
import java.util.concurrent.ConcurrentHashMap
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

    // FIX: per-name atomics for tryBeginRefresh(). The previous implementation
    // called shouldRun(lastUsageRefreshMs, ...) regardless of `name`, meaning every
    // named caller shared and clobbered the single usage-refresh timestamp. A
    // ConcurrentHashMap of AtomicLongs gives each caller its own independent clock
    // without any lock contention — computeIfAbsent is atomic on ConcurrentHashMap.
    private val namedRefreshAtomics = ConcurrentHashMap<String, AtomicLong>()

    fun shouldRefreshUsage(now: Long = System.currentTimeMillis()): Boolean =
        shouldRun(lastUsageRefreshMs, now, MIN_USAGE_REFRESH_MS)

    fun tryBeginRefresh(name: String, minIntervalMs: Long, now: Long = System.currentTimeMillis()): Boolean {
        val atomic = namedRefreshAtomics.computeIfAbsent(name) { AtomicLong(0L) }
        return shouldRun(atomic, now, minIntervalMs)
    }

    fun tryBegin(context: Context, name: String, minIntervalMs: Long, now: Long = System.currentTimeMillis()): Boolean {
        val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        val key = "refresh_${name}_ts"
        val persistedLast = prefs.getLong(key, 0L)
        if (now - persistedLast < minIntervalMs) return false
        if (!shouldRun(lastWidgetCacheRefreshMs, now, minIntervalMs)) return false
        prefs.edit().putLong(key, now).apply()
        return true
    }

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