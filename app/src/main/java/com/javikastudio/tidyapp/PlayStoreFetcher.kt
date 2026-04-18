package com.javikastudio.tidyapp

import android.content.Context
import android.content.SharedPreferences
import com.kdroid.gplayscrapper.services.getGooglePlayApplicationInfo
import kotlinx.coroutines.*

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PlayStoreFetcher                                                       │
 * │                                                                         │
 * │  Fetches the authoritative Google Play Store category for each          │
 * │  installed app and persists results in SharedPreferences so that        │
 * │  AppCategorizer can use them as LAYER 0 — the highest-confidence        │
 * │  signal available, sourced directly from Google's own taxonomy.         │
 * │                                                                         │
 * │  Dependency (build.gradle / libs.versions.toml):                       │
 * │    implementation("io.github.kdroidfilter:gplayscrapper:0.1.6")        │
 * │                                                                         │
 * │  Manifest:                                                              │
 * │    <uses-permission android:name="android.permission.INTERNET" />      │
 * │                                                                         │
 * │  Usage:                                                                 │
 * │    val fetcher = PlayStoreFetcher(context)                              │
 * │    fetcher.syncAll(installedPackages)          // one-shot background   │
 * │    val cat = fetcher.getCategory("com.spotify.music")  // "Music & Audio"
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Design notes
 * ────────────
 * • syncAll() is designed to be called ONCE per app session (or on new-app
 *   install broadcast). It skips packages already in cache.
 * • Rate-limiting: 1 request / 300 ms to avoid Play Store soft-bans.
 * • Failures are silently skipped — AppCategorizer falls through to its
 *   own Layers 1-10 for any package that couldn't be fetched.
 * • PLAY_TO_LOCAL maps every known Play Store genreId → our taxonomy label.
 */
class PlayStoreFetcher(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("play_category_cache", Context.MODE_PRIVATE)

    // ── Public API ────────────────────────────────────────────────────────────

    /** Returns the cached Play Store category for [pkg], or null on cache miss. */
    fun getCategory(pkg: String): String? = prefs.getString(pkg, null)
        ?.let { Categories.migrate(it) }

    /** True if [pkg] has already been fetched (success or permanent failure). */
    fun isCached(pkg: String): Boolean = prefs.contains(pkg)

    /**
     * Fetches Play Store categories for every package in [packages] that is
     * not yet cached.  Runs on [Dispatchers.IO] with [RATE_LIMIT_MS] between
     * requests.  Safe to call from a ViewModel / WorkManager task.
     *
     * @param packages    List of packageName strings (from PackageManager).
     * @param lang        BCP-47 language code (default "en").
     * @param country     ISO 3166-1 alpha-2 country code (default "us").
     * @param onProgress  Optional callback: (fetched, total) for UI progress.
     */
    suspend fun syncAll(
        packages: List<String>,
        lang: String = "en",
        country: String = "us",
        onProgress: ((fetched: Int, total: Int) -> Unit)? = null,
    ) = withContext(Dispatchers.IO) {
        val pending = packages.filter { !isCached(it) }
        val editor  = prefs.edit()
        var fetched = 0

        for (pkg in pending) {
            try {
                val info = getGooglePlayApplicationInfo(pkg, lang, country)
                // categories is List<GooglePlayCategory>; use first non-null genreId
                val genreId = info.categories.firstOrNull()?.id
                    ?: info.genre?.let { nameToGenreId(it) }
                val localCat = genreId?.let { PLAY_TO_LOCAL[it] }
                // Store mapped category, or "_unknown_" sentinel to avoid re-fetching
                editor.putString(pkg, localCat ?: SENTINEL_UNKNOWN)
            } catch (_: Exception) {
                // App not on Play Store, network error, rate-limited — skip silently
                editor.putString(pkg, SENTINEL_UNKNOWN)
            }
            editor.apply()
            fetched++
            onProgress?.invoke(fetched, pending.size)
            delay(RATE_LIMIT_MS)
        }
    }

    /**
     * Remove [pkg] from cache so the next syncAll() re-fetches it.
     * Useful after a user-initiated "refresh" or after an app update.
     */
    fun invalidate(pkg: String) = prefs.edit().remove(pkg).apply()

    /** Wipe the entire cache (e.g. on locale change or full re-sync). */
    fun clearAll() = prefs.edit().clear().apply()

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun nameToGenreId(name: String): String? =
        NAME_TO_GENRE_ID[name.lowercase().trim()]

    companion object {
        private const val RATE_LIMIT_MS    = 300L
        private const val SENTINEL_UNKNOWN = "__unknown__"

        // ── Play Store genreId → our AppCategorizer label ─────────────────────
        // Source: google-play-scraper genreId constants + Play Console category list
        val PLAY_TO_LOCAL: Map<String, String> get() = Categories.PLAY_TO_LOCAL

        // Fallback: map display name → genreId for when only `genre` string is available
        private val NAME_TO_GENRE_ID: Map<String, String> = mapOf(
            "communication"      to "COMMUNICATION",
            "social"             to "SOCIAL",
            "entertainment"      to "ENTERTAINMENT",
            "music & audio"      to "MUSIC_AND_AUDIO",
            "productivity"       to "PRODUCTIVITY",
            "finance"            to "FINANCE",
            "shopping"           to "SHOPPING",
            "health & fitness"   to "HEALTH_AND_FITNESS",
            "education"          to "EDUCATION",
            "travel & local"     to "TRAVEL_AND_LOCAL",
            "maps & navigation"  to "MAPS_AND_NAVIGATION",
            "photography"        to "PHOTOGRAPHY",
            "news & magazines"   to "NEWS_AND_MAGAZINES",
            "food & drink"       to "FOOD_AND_DRINK",
            "sports"             to "SPORTS",
            "weather"            to "WEATHER",
            "auto & vehicles"    to "AUTO_AND_VEHICLES",
            "medical"            to "MEDICAL",
            "personalization"    to "PERSONALIZATION",
            "tools"              to "TOOLS",
            "business"           to "BUSINESS",
            "lifestyle"          to "LIFESTYLE",
            "dating"             to "DATING",
            "books & reference"  to "BOOKS_AND_REFERENCE",
            "art & design"       to "ART_AND_DESIGN",
            "comics"             to "COMICS",
            "events"             to "EVENTS",
            "house & home"       to "HOUSE_AND_HOME",
            "parenting"          to "PARENTING",
            "video players & editors" to "VIDEO_PLAYERS",
            "libraries & demo"   to "LIBRARIES_AND_DEMO",
        )
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// HOW TO WIRE PlayStoreFetcher INTO AppCategorizer AS LAYER 0
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. In your ViewModel / AppCategorizerService, hold both objects:
//
//    private val playFetcher   = PlayStoreFetcher(context)
//    private val appCategorizer = AppCategorizer()     // your existing object
//
// 2. On startup, trigger a background sync for all installed apps:
//
//    viewModelScope.launch {
//        val packages = packageManager
//            .getInstalledApplications(PackageManager.GET_META_DATA)
//            .map { it.packageName }
//        playFetcher.syncAll(packages) { done, total ->
//            _progress.value = done.toFloat() / total   // optional progress bar
//        }
//        refreshGroups()   // re-categorise after sync completes
//    }
//
// 3. In your categorisation call, check Layer 0 first:
//
//    fun getCategory(info: ApplicationInfo, name: String,
//                    permissions: Array<String>? = null): String {
//        // Layer 0 — authoritative Play Store signal
//        playFetcher.getCategory(info.packageName)
//            ?.takeIf { it != "__unknown__" }
//            ?.let { return it }
//
//        // Layers 1-10 — offline pipeline
//        return categorize(info, name, permissions)
//    }
//
// 4. Register a BroadcastReceiver for new installs so fresh apps are fetched:
//
//    val receiver = object : BroadcastReceiver() {
//        override fun onReceive(ctx: Context, intent: Intent) {
//            val pkg = intent.data?.schemeSpecificPart ?: return
//            scope.launch { playFetcher.syncAll(listOf(pkg)) }
//        }
//    }
//    registerReceiver(receiver,
//        IntentFilter(Intent.ACTION_PACKAGE_ADDED).apply { addDataScheme("package") })
//
// ─────────────────────────────────────────────────────────────────────────────