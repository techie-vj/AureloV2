package com.javikastudio.tidyapp

import android.content.ContentValues
import android.content.Context
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteOpenHelper
import android.util.Log
import java.text.SimpleDateFormat
import java.util.*

// ─────────────────────────────────────────────────────────────────────────────
//  Time slots — 6 buckets that cover the waking day
// ─────────────────────────────────────────────────────────────────────────────
enum class TimeSlot {
    MORNING,    // 06:00–08:59
    COMMUTE,    // 09:00–10:59
    MIDDAY,     // 11:00–13:59
    AFTERNOON,  // 14:00–16:59
    EVENING,    // 17:00–20:59
    NIGHT;      // 21:00–05:59

    companion object {
        fun current(): TimeSlot {
            val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
            return when (hour) {
                in 6..8   -> MORNING
                in 9..10  -> COMMUTE
                in 11..13 -> MIDDAY
                in 14..16 -> AFTERNOON
                in 17..20 -> EVENING
                else      -> NIGHT
            }
        }

        fun label(slot: TimeSlot): String = when (slot) {
            MORNING   -> "Morning"
            COMMUTE   -> "Commute"
            MIDDAY    -> "Midday"
            AFTERNOON -> "Afternoon"
            EVENING   -> "Evening"
            NIGHT     -> "Night"
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQLite schema
// ─────────────────────────────────────────────────────────────────────────────
private const val DB_NAME         = "tidyapp_launches.db"
private const val DB_VERSION      = 3  // P1-05: v3 adds score_history table (was in plain prefs)
private const val TABLE           = "launch_events"
private const val SCORE_HIST_TABLE = "score_history"

/**
 * SEC-09 FIX: Updated for SQLCipher 4.6.1.
 * The passphrase is now passed to the super constructor.
 */
private class LaunchDatabase(ctx: Context, passphrase: ByteArray)
    : SQLiteOpenHelper(
    ctx,
    DB_NAME,
    passphrase,
    null,
    DB_VERSION,
    DB_VERSION, // This is the 'minimumSupportedVersion' argument I missed!
    null,
    null,
    false
){
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $TABLE (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                package_name TEXT    NOT NULL,
                time_slot    TEXT    NOT NULL,
                launch_date  TEXT    NOT NULL,
                day_of_week  INTEGER NOT NULL,
                timestamp    INTEGER NOT NULL
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_slot_pkg ON $TABLE(time_slot, package_name)")
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_ts ON $TABLE(timestamp)")
        // P1-05: score history stored in SQLCipher instead of plain SharedPreferences
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS $SCORE_HIST_TABLE (
                pref_key    TEXT    PRIMARY KEY NOT NULL,
                value       TEXT    NOT NULL,
                updated_at  INTEGER NOT NULL
            )
        """.trimIndent())
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("DROP TABLE IF EXISTS $TABLE")
            onCreate(db)
            return
        }
        if (oldVersion < 3) {
            // P1-05: add score_history table without wiping existing launch_events data
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS $SCORE_HIST_TABLE (
                    pref_key    TEXT    PRIMARY KEY NOT NULL,
                    value       TEXT    NOT NULL,
                    updated_at  INTEGER NOT NULL
                )
            """.trimIndent())
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LaunchTracker — public API
// ─────────────────────────────────────────────────────────────────────────────
class LaunchTracker private constructor(context: Context) {

    private val db      : SQLiteDatabase = openEncryptedDb(context)
    private val fmt     = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val context = context.applicationContext

    companion object {
        @Volatile private var instance: LaunchTracker? = null
        fun get(ctx: Context): LaunchTracker =
            instance ?: synchronized(this) {
                instance ?: LaunchTracker(ctx).also { instance = it }
            }

        private const val PREFS_PASSPHRASE = "tidyapp_launch_key_v1"
        private const val KEY_PASSPHRASE   = "db_passphrase"
    }

    // ── Encrypted DB open ─────────────────────────────────────────────────────
    private fun openEncryptedDb(context: Context): SQLiteDatabase {
        val appCtx = context.applicationContext
        val passphrase = derivePassphrase(appCtx)
        try {
            // FIX: loadLibs() is removed in SQLCipher 4.5+.
            // We use System.loadLibrary to manually trigger the native load
            // and resolve the "No implementation found" runtime error.
            System.loadLibrary("sqlcipher")
        } catch (e: UnsatisfiedLinkError) {
            Log.e("LaunchTracker", "SQLCipher native library not found", e)
        }
        return try {
            // In 4.6.1, we pass the passphrase to the constructor and call writableDatabase
            LaunchDatabase(appCtx, passphrase).writableDatabase
        } finally {
            // Security: Clear the sensitive byte array from memory
            passphrase.fill(0)
        }
    }

    /**
     * Derives (or generates on first run) a stable 32-byte passphrase.
     */
    private fun derivePassphrase(context: Context): ByteArray {
        return try {
            val masterKey = androidx.security.crypto.MasterKey.Builder(context)
                .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                .build()
            val prefs = androidx.security.crypto.EncryptedSharedPreferences.create(
                context,
                PREFS_PASSPHRASE,
                masterKey,
                androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            val existing = prefs.getString(KEY_PASSPHRASE, null)
            if (existing != null) {
                android.util.Base64.decode(existing, android.util.Base64.NO_WRAP)
            } else {
                val key = ByteArray(32)
                java.security.SecureRandom().nextBytes(key)
                prefs.edit()
                    .putString(KEY_PASSPHRASE, android.util.Base64.encodeToString(key, android.util.Base64.NO_WRAP))
                    .commit()
                key
            }
        } catch (e: Exception) {
            Log.w("LaunchTracker", "Keystore unavailable, using fallback passphrase", e)
            val seed = android.provider.Settings.Secure.getString(
                context.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID
            ) ?: "tidyapp_fallback"
            ("tidyapp_launch_v2_$seed").toByteArray(Charsets.UTF_8).copyOf(32)
        }
    }

    // ── Record a launch ───────────────────────────────────────────────────────
    fun recordLaunch(packageName: String) = recordLaunch(packageName, System.currentTimeMillis())

    fun recordLaunch(packageName: String, timestamp: Long) {
        if (packageName == context.packageName) return
        val cal  = Calendar.getInstance().apply { timeInMillis = timestamp }
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        val slot = when (hour) {
            in 6..8   -> TimeSlot.MORNING
            in 9..10  -> TimeSlot.COMMUTE
            in 11..13 -> TimeSlot.MIDDAY    // Added TimeSlot.
            in 14..16 -> TimeSlot.AFTERNOON // Added TimeSlot.
            in 17..20 -> TimeSlot.EVENING   // Added TimeSlot.
            else      -> TimeSlot.NIGHT
        }
        val dateStr    = fmt.format(Date(timestamp))
        val dayOfWeek  = cal.get(Calendar.DAY_OF_WEEK)

        val already = db.rawQuery(
            "SELECT 1 FROM $TABLE WHERE package_name=? AND time_slot=? AND launch_date=? AND timestamp>=? LIMIT 1",
            arrayOf(packageName, slot.name, dateStr, (timestamp - 300_000L).toString())
        ).use { it.moveToFirst() }
        if (already) return

        val cv = ContentValues().apply {
            put("package_name", packageName)
            put("time_slot",    slot.name)
            put("launch_date",  dateStr)
            put("day_of_week",  dayOfWeek)
            put("timestamp",    timestamp)
        }
        db.insert(TABLE, null, cv)
    }

    // ── Top apps for a given slot ─────────────────────────────────────────────
    fun getTopAppsForSlot(
        slot: TimeSlot = TimeSlot.current(),
        topN: Int = 5,
        dayOfWeek: Int = -1
    ): List<String> {
        val now    = System.currentTimeMillis()
        val cutoff = now - 60L * 24 * 60 * 60 * 1000L

        val (query, args) = if (dayOfWeek in 1..7) {
            """
            SELECT package_name, timestamp
            FROM   $TABLE
            WHERE  time_slot = ? AND day_of_week = ? AND timestamp >= ?
            ORDER  BY timestamp DESC
            """.trimIndent() to arrayOf(slot.name, dayOfWeek.toString(), cutoff.toString())
        } else {
            """
            SELECT package_name, timestamp
            FROM   $TABLE
            WHERE  time_slot = ? AND timestamp >= ?
            ORDER  BY timestamp DESC
            """.trimIndent() to arrayOf(slot.name, cutoff.toString())
        }

        val scores = mutableMapOf<String, Double>()
        db.rawQuery(query, args).use {
            while (it.moveToNext()) {
                val pkg     = it.getString(0)
                val ts      = it.getLong(1)
                val daysAgo = (now - ts) / 86_400_000.0
                scores[pkg] = (scores[pkg] ?: 0.0) + Math.pow(0.95, daysAgo)
            }
        }

        return scores.entries
            .sortedByDescending { it.value }
            .map { it.key }
            .distinct()
            .take(topN)
    }

    fun getRoutineSummary(): Map<TimeSlot, List<String>> =
        TimeSlot.values().associateWith { getTopAppsForSlot(it, 6) }

    fun pruneOldData() {
        val cutoff = System.currentTimeMillis() - 60L * 24 * 60 * 60 * 1000L
        db.delete(TABLE, "timestamp < ?", arrayOf(cutoff.toString()))
    }

    fun dbSizeKb(context: Context): Long {
        val file = context.getDatabasePath(DB_NAME)
        return if (file.exists()) file.length() / 1024L else 0L
    }

    // In LaunchTracker.kt
    fun totalRows(): Long {
        // FIX: Use .use {} to automatically close the statement after execution
        return db.compileStatement("SELECT COUNT(*) FROM $TABLE").use { statement ->
            statement.simpleQueryForLong()
        }
    }

    fun clearAll() {
        db.delete(TABLE, null, null)
        runCatching { db.execSQL("VACUUM") }
    }

    fun getSlotFrequencyPercent(
        packageName: String,
        slot: TimeSlot,
        dayOfWeek: Int = -1
    ): Int {
        val since = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000L

        // FIX Issue 11 (SEC-02): use parameterized binds instead of string
        // interpolation. dayOfWeek is a typed Int so SQL injection is impossible,
        // but interpolation is still a code-smell and makes the boundary behaviour
        // (0 and 8 → no day filter) invisible to static analysis. Separate arg
        // arrays make the two paths explicit and compile-time checkable.
        val dayClause: String
        val totalArgs: Array<String>
        val appArgs:   Array<String>
        if (dayOfWeek in 1..7) {
            dayClause = " AND day_of_week = ?"
            totalArgs = arrayOf(slot.name, since.toString(), dayOfWeek.toString())
            appArgs   = arrayOf(slot.name, packageName, since.toString(), dayOfWeek.toString())
        } else {
            dayClause = ""          // boundary values 0 and 8 intentionally drop the filter
            totalArgs = arrayOf(slot.name, since.toString())
            appArgs   = arrayOf(slot.name, packageName, since.toString())
        }

        val totalSessions = db.rawQuery(
            "SELECT COUNT(DISTINCT date(timestamp/1000,'unixepoch')) FROM $TABLE " +
                    "WHERE time_slot = ? AND timestamp > ?$dayClause",
            totalArgs
        ).use { if (it.moveToFirst()) it.getLong(0) else 0L }

        if (totalSessions < 3L) return 0

        val appSessions = db.rawQuery(
            "SELECT COUNT(DISTINCT date(timestamp/1000,'unixepoch')) FROM $TABLE " +
                    "WHERE time_slot = ? AND package_name = ? AND timestamp > ?$dayClause",
            appArgs
        ).use { if (it.moveToFirst()) it.getLong(0) else 0L }

        val smoothed = (appSessions + 1f) / (totalSessions + 2f)
        return (smoothed * 100f).toInt().coerceIn(0, 99)
    }

    fun getDaysOfData(): Int =
        db.rawQuery(
            "SELECT COUNT(DISTINCT date(timestamp/1000,'unixepoch')) FROM $TABLE", null
        ).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    fun getDaysOfDataForDay(dayOfWeek: Int): Int =
        db.rawQuery(
            "SELECT COUNT(DISTINCT date(timestamp/1000,'unixepoch')) FROM $TABLE " +
                    "WHERE day_of_week = ?",
            arrayOf(dayOfWeek.toString())
        ).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    // ── Score History (P1-05 FIX: encrypted SQLCipher, was plain SharedPreferences) ──

    fun getScoreHistory(key: String): String =
        db.rawQuery(
            "SELECT value FROM $SCORE_HIST_TABLE WHERE pref_key = ?",
            arrayOf(key)
        ).use { if (it.moveToFirst()) it.getString(0) else "" }

    fun saveScoreHistory(key: String, value: String) {
        val cv = ContentValues().apply {
            put("pref_key",   key)
            put("value",      value)
            put("updated_at", System.currentTimeMillis())
        }
        db.insertWithOnConflict(SCORE_HIST_TABLE, null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }
}