package com.javikastudio.tidyapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicLong

class RefreshCoordinatorTest {
    @Test
    fun shouldRunAllowsFirstRunAndThrottlesNextRun() {
        val state = AtomicLong(0L)

        assertTrue(RefreshCoordinator.shouldRun(state, now = 10_000L, minIntervalMs = 1_000L))
        assertFalse(RefreshCoordinator.shouldRun(state, now = 10_500L, minIntervalMs = 1_000L))
        assertTrue(RefreshCoordinator.shouldRun(state, now = 11_000L, minIntervalMs = 1_000L))
    }
}
