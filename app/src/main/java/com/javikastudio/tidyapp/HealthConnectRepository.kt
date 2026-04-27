package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// HealthConnectRepository — queries for sleep, HRV, steps, resting HR, and
// mindfulness sessions. All reads are suspend funs; no writes ever occur.
// Spec §2.1, §4-7.
// ═══════════════════════════════════════════════════════════════════════════

import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.MindfulnessSessionRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Mindfulness session as surfaced to the UI layer. */
data class HCMindfulnessSession(
    val appPackage: String,
    val appLabel: String,
    val type: String,
    val durationMinutes: Int,
    /** Points awarded at 50% credit rate. */
    val pts: Int,
)

/** All HC signals for a single day, sourced from HealthConnectRepository. */
data class HCDailyData(
    val isAvailable: Boolean = false,
    // Today
    val stepsToday: Int = 0,
    val hrvToday: Float? = null,           // RMSSD ms, latest record
    val restingHrToday: Int? = null,       // bpm, latest record
    // Sleep — last night
    val sleepDurationHours: Float? = null,
    val overnightHrvMs: Float? = null,     // avg RMSSD during last sleep session
    // F-14: Session window metadata for bedtime-window filtering in HealthConnectBridge.
    // Decimal hours (0-24 range). Null when the wearable doesn't provide session timestamps.
    val sleepSessionStartHour: Float? = null,
    val sleepSessionEndHour: Float? = null,
    // 7-day personal averages
    val avgHrv7d: Float? = null,
    val avgRhr7d: Float? = null,
    val avgSleepDuration7d: Float? = null,
    val avgOvernightHrv7d: Float? = null,
    val avgSteps7d: Float? = null,
    // Mindfulness today
    val mindfulnessSessions: List<HCMindfulnessSession> = emptyList(),
    /** Epoch millis of last successful repository read. */
    val lastSyncTs: Long = 0L,
)

class HealthConnectRepository(private val manager: HealthConnectManager) {

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * Read all HC data for today + last 7 days.
     * Returns [HCDailyData.isAvailable] = false if HC is not connected or any
     * critical read fails. Partial data is used if only some permissions are granted.
     * Spec §9: corrupt / out-of-range values are clamped, never crash.
     */
    suspend fun readDailyData(): HCDailyData {
        if (!manager.isAvailable() || !manager.hasAnyPermission()) {
            return HCDailyData(isAvailable = false)
        }
        val client = manager.client()
        val now = Instant.now()

        // ── Time windows ───────────────────────────────────────────────────
        val todayStart = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant()
        val sevenDaysAgo = now.minus(Duration.ofDays(7))
        val todayRange = TimeRangeFilter.between(todayStart, now)
        val weekRange  = TimeRangeFilter.between(sevenDaysAgo, now)

        // ── Steps today ───────────────────────────────────────────────────
        val stepsToday = runCatching {
            client.aggregate(
                AggregateRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = todayRange,
                )
            )[StepsRecord.COUNT_TOTAL]?.toInt() ?: 0
        }.getOrElse { 0 }

        // ── 7-day average steps ───────────────────────────────────────────
        val avgSteps7d = runCatching {
            val daily = mutableListOf<Long>()
            for (d in 0L until 7L) {
                val dayStart = LocalDate.now().minusDays(d).atStartOfDay(ZoneId.systemDefault()).toInstant()
                val dayEnd   = dayStart.plus(Duration.ofDays(1)).coerceAtMost(now)
                val count = client.aggregate(
                    AggregateRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(dayStart, dayEnd),
                    )
                )[StepsRecord.COUNT_TOTAL] ?: 0L
                daily += count
            }
            if (daily.isEmpty()) null else daily.average().toFloat()
        }.getOrElse { null }

        // ── HRV today (latest RMSSD record) ───────────────────────────────
        val hrvToday = runCatching {
            client.readRecords(
                ReadRecordsRequest(
                    HeartRateVariabilityRmssdRecord::class,
                    timeRangeFilter = todayRange,
                )
            ).records
                .lastOrNull()
                ?.heartRateVariabilityMillis
                ?.toFloat()
                ?.coerceIn(5f, 200f)   // physiologically plausible — spec §9
        }.getOrElse { null }

        // ── 7-day average HRV ─────────────────────────────────────────────
        val avgHrv7d = runCatching {
            val records = client.readRecords(
                ReadRecordsRequest(
                    HeartRateVariabilityRmssdRecord::class,
                    timeRangeFilter = weekRange,
                )
            ).records.map { it.heartRateVariabilityMillis.toFloat().coerceIn(5f, 200f) }
            if (records.isEmpty()) null else records.average().toFloat()
        }.getOrElse { null }

        // ── Resting HR today ──────────────────────────────────────────────
        val restingHrToday = runCatching {
            client.readRecords(
                ReadRecordsRequest(
                    RestingHeartRateRecord::class,
                    timeRangeFilter = todayRange,
                )
            ).records
                .lastOrNull()
                ?.beatsPerMinute
                ?.toInt()
                ?.coerceIn(30, 220)
        }.getOrElse { null }

        // ── 7-day average RHR ─────────────────────────────────────────────
        val avgRhr7d = runCatching {
            val records = client.readRecords(
                ReadRecordsRequest(
                    RestingHeartRateRecord::class,
                    timeRangeFilter = weekRange,
                )
            ).records.map { it.beatsPerMinute.toInt().coerceIn(30, 220).toFloat() }
            if (records.isEmpty()) null else records.average().toFloat()
        }.getOrElse { null }

        // ── Sleep last night ───────────────────────────────────────────────
        // Look back 36 h to catch users who sleep past midnight.
        val sleepWindow = TimeRangeFilter.between(now.minus(Duration.ofHours(36)), now)
        val (sleepDurationHours, overnightHrvMs) = runCatching {
            val sessions = client.readRecords(
                ReadRecordsRequest(SleepSessionRecord::class, timeRangeFilter = sleepWindow)
            ).records
            val latest = sessions.maxByOrNull { it.endTime } ?: return@runCatching Pair(null, null)
            val durationHours = Duration.between(latest.startTime, latest.endTime).toMinutes() / 60f
            val clamped = durationHours.coerceIn(0f, 24f)

            // Overnight HRV: average HRV during the sleep session window
            val sleepHrvRecords = client.readRecords(
                ReadRecordsRequest(
                    HeartRateVariabilityRmssdRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(latest.startTime, latest.endTime),
                )
            ).records
            val avgOvernight = if (sleepHrvRecords.isEmpty()) null
            else sleepHrvRecords.map { it.heartRateVariabilityMillis.toFloat().coerceIn(5f, 200f) }
                .average().toFloat()
            Pair(clamped, avgOvernight)
        }.getOrElse { Pair(null, null) }

        // ── 7-day average sleep duration ──────────────────────────────────
        val avgSleepDuration7d = runCatching {
            val sessions = client.readRecords(
                ReadRecordsRequest(SleepSessionRecord::class, timeRangeFilter = weekRange)
            ).records
            if (sessions.isEmpty()) null
            else sessions.map { Duration.between(it.startTime, it.endTime).toMinutes() / 60f }
                .average().toFloat()
        }.getOrElse { null }

        // ── 7-day average overnight HRV ───────────────────────────────────
        val avgOvernightHrv7d = runCatching {
            val sessions = client.readRecords(
                ReadRecordsRequest(SleepSessionRecord::class, timeRangeFilter = weekRange)
            ).records
            val allOvernightHrv = sessions.flatMap { session ->
                client.readRecords(
                    ReadRecordsRequest(
                        HeartRateVariabilityRmssdRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(session.startTime, session.endTime),
                    )
                ).records.map { it.heartRateVariabilityMillis.toFloat().coerceIn(5f, 200f) }
            }
            if (allOvernightHrv.isEmpty()) null else allOvernightHrv.average().toFloat()
        }.getOrElse { null }

        // ── Mindfulness sessions today ─────────────────────────────────────
        val mindfulnessSessions = runCatching {
            client.readRecords(
                ReadRecordsRequest(MindfulnessSessionRecord::class, timeRangeFilter = todayRange)
            ).records
                // Spec §6.3: exclude sessions < 1 minute
                .filter { Duration.between(it.startTime, it.endTime).toMinutes() >= 1L }
                .map { record ->
                    val pkg = record.metadata.dataOrigin.packageName
                    val durationMins = Duration.between(record.startTime, record.endTime).toMinutes().toInt()
                    // 50% credit: roughly 1 pt per 2 min, capped sensibly
                    val pts = (durationMins / 2).coerceIn(1, 30)
                    HCMindfulnessSession(
                        appPackage    = pkg,
                        appLabel      = labelForPackage(pkg),
                        type          = record.title ?: "Mindfulness",
                        durationMinutes = durationMins,
                        pts           = pts,
                    )
                }
                // Spec §6.3: deduplicate against Aurelo-native (handled JS side by timestamp)
        }.getOrElse { emptyList() }

        return HCDailyData(
            isAvailable         = true,
            stepsToday          = stepsToday,
            hrvToday            = hrvToday,
            restingHrToday      = restingHrToday,
            sleepDurationHours  = sleepDurationHours,
            overnightHrvMs      = overnightHrvMs,
            avgHrv7d            = avgHrv7d,
            avgRhr7d            = avgRhr7d,
            avgSleepDuration7d  = avgSleepDuration7d,
            avgOvernightHrv7d   = avgOvernightHrv7d,
            avgSteps7d          = avgSteps7d,
            mindfulnessSessions = mindfulnessSessions,
            lastSyncTs          = System.currentTimeMillis(),
        )
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun labelForPackage(pkg: String): String = when {
        pkg.contains("headspace", true) -> "Headspace"
        pkg.contains("calm",      true) -> "Calm"
        pkg.contains("insight",   true) -> "Insight Timer"
        else -> pkg.substringAfterLast('.').replaceFirstChar { it.uppercaseChar() }
    }
}
