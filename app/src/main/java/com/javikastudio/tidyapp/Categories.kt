package com.javikastudio.tidyapp

import android.content.pm.ApplicationInfo
import android.os.Build

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Categories — Single source of truth for the app taxonomy              │
 * │                                                                         │
 * │  To rename a category:                                                  │
 * │    1. Change the constant value below (e.g. SOCIAL = "Social 2.0")     │
 * │    2. Add the OLD value to MIGRATION_MAP                                │
 * │    That's it. AppBridge, PlayStoreFetcher and the JS UI all follow.     │
 * │                                                                         │
 * │  To add a category:                                                     │
 * │    1. Add a new const val                                               │
 * │    2. Add to ALL, ICONS, PRIORITY                                       │
 * │    3. Add CategoryDef in AppBridge.CATEGORY_DEFS                        │
 * │    4. Optionally map Play Store genreIds in PLAY_TO_LOCAL               │
 * │                                                                         │
 * │  To remove / merge a category:                                          │
 * │    1. Delete or leave the const val (harmless to keep)                  │
 * │    2. Remove from ALL, ICONS, PRIORITY                                  │
 * │    3. Add migration entry:  "OldName" to REPLACEMENT_CAT                │
 * │    Keep MIGRATION_MAP entries forever — they protect users who          │
 * │    haven't opened the app since before the change.                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
object Categories {

    // ── Canonical category name constants ────────────────────────────────────
    // Change the string value here and nowhere else.
    const val GAMES         = "Games"
    const val SOCIAL        = "Social & Communication"
    const val ENTERTAINMENT = "Entertainment & Video"
    const val MUSIC         = "Music & Audio"
    const val CREATIVE      = "Creative Tools"
    const val PRODUCTIVITY  = "Productivity & Business"
    const val FINANCE       = "Finance"
    const val TOOLS         = "Tools & Utilities"
    const val HEALTH        = "Health & Wellness"
    const val EDUCATION     = "Education & Books"
    const val NEWS          = "News & Magazines"
    const val TRAVEL        = "Travel & Navigation"
    const val SHOPPING      = "Shopping"
    const val LIFESTYLE     = "Lifestyle & Home"
    const val FOOD          = "Food & Drink"
    const val SPORTS        = "Sports"
    const val UNASSIGNED    = "Unassigned"

    // ── All valid categories (used for validation and JS export) ─────────────
    val ALL: Set<String> = setOf(
        GAMES, SOCIAL, ENTERTAINMENT, MUSIC, CREATIVE, PRODUCTIVITY,
        FINANCE, TOOLS, HEALTH, EDUCATION, NEWS, TRAVEL,
        SHOPPING, LIFESTYLE, FOOD, SPORTS
    )

    // ── Display icons ─────────────────────────────────────────────────────────
    val ICONS: Map<String, String> = mapOf(
        GAMES         to "🎮",
        SOCIAL        to "📱",
        ENTERTAINMENT to "🎬",
        MUSIC         to "🎵",
        CREATIVE      to "🎨",
        PRODUCTIVITY  to "💼",
        FINANCE       to "💰",
        TOOLS         to "🔧",
        HEALTH        to "🏥",
        EDUCATION     to "🎓",
        NEWS          to "📰",
        TRAVEL        to "✈️",
        SHOPPING      to "🛒",
        LIFESTYLE     to "🏡",
        FOOD          to "🍔",
        SPORTS        to "⚽",
    )

    // ── Priority for deterministic tie-breaking in the categorizer ───────────
    // Higher priority = listed earlier. Finance beats Productivity; broad
    // buckets (Tools) come last.
    val PRIORITY: List<String> = listOf(
        FINANCE, HEALTH, GAMES, SPORTS, SOCIAL, ENTERTAINMENT,
        MUSIC, CREATIVE, TRAVEL, EDUCATION, FOOD, SHOPPING,
        NEWS, PRODUCTIVITY, LIFESTYLE, TOOLS, UNASSIGNED
    )

    // ── Android OS ApplicationInfo.category → our category ───────────────────
    // Returns null for unmapped values (e.g. CATEGORY_PRODUCTIVITY, which we
    // intentionally skip so Finance apps aren't mis-tagged).
    fun fromAppInfoCategory(appInfoCategory: Int): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        return when (appInfoCategory) {
            ApplicationInfo.CATEGORY_GAME          -> GAMES
            ApplicationInfo.CATEGORY_AUDIO         -> MUSIC
            ApplicationInfo.CATEGORY_VIDEO         -> ENTERTAINMENT
            ApplicationInfo.CATEGORY_IMAGE         -> CREATIVE
            ApplicationInfo.CATEGORY_SOCIAL        -> SOCIAL
            ApplicationInfo.CATEGORY_NEWS          -> NEWS
            ApplicationInfo.CATEGORY_MAPS          -> TRAVEL
            ApplicationInfo.CATEGORY_ACCESSIBILITY -> TOOLS
            else                                   -> null
        }
    }

    // ── Play Store genreId → our category ────────────────────────────────────
    val PLAY_TO_LOCAL: Map<String, String> = mapOf(
        "SOCIAL"                to SOCIAL,
        "COMMUNICATION"         to SOCIAL,
        "DATING"                to SOCIAL,
        "ENTERTAINMENT"         to ENTERTAINMENT,
        "VIDEO_PLAYERS"         to ENTERTAINMENT,
        "COMICS"                to ENTERTAINMENT,
        "MUSIC_AND_AUDIO"       to MUSIC,
        "PRODUCTIVITY"          to PRODUCTIVITY,
        "BUSINESS"              to PRODUCTIVITY,
        "FINANCE"               to FINANCE,
        "GAME"                  to GAMES,
        "GAME_ACTION"           to GAMES,
        "GAME_ADVENTURE"        to GAMES,
        "GAME_ARCADE"           to GAMES,
        "GAME_BOARD"            to GAMES,
        "GAME_CARD"             to GAMES,
        "GAME_CASINO"           to GAMES,
        "GAME_CASUAL"           to GAMES,
        "GAME_EDUCATIONAL"      to GAMES,
        "GAME_MUSIC"            to GAMES,
        "GAME_PUZZLE"           to GAMES,
        "GAME_RACING"           to GAMES,
        "GAME_ROLE_PLAYING"     to GAMES,
        "GAME_SIMULATION"       to GAMES,
        "GAME_SPORTS"           to GAMES,
        "GAME_STRATEGY"         to GAMES,
        "GAME_TRIVIA"           to GAMES,
        "GAME_WORD"             to GAMES,
        "SHOPPING"              to SHOPPING,
        "BEAUTY"                to LIFESTYLE,
        "HOUSE_AND_HOME"        to LIFESTYLE,
        "HEALTH_AND_FITNESS"    to HEALTH,
        "PARENTING"             to LIFESTYLE,
        "EDUCATION"             to EDUCATION,
        "BOOKS_AND_REFERENCE"   to EDUCATION,
        "LIBRARIES_AND_DEMO"    to EDUCATION,
        "TRAVEL_AND_LOCAL"      to TRAVEL,
        "MAPS_AND_NAVIGATION"   to TRAVEL,
        "EVENTS"                to TRAVEL,
        "PHOTOGRAPHY"           to CREATIVE,
        "ART_AND_DESIGN"        to CREATIVE,
        "NEWS_AND_MAGAZINES"    to NEWS,
        "FOOD_AND_DRINK"        to FOOD,
        "SPORTS"                to SPORTS,
        "WEATHER"               to TOOLS,
        "AUTO_AND_VEHICLES"     to LIFESTYLE,
        "MEDICAL"               to HEALTH,
        "PERSONALIZATION"       to TOOLS,
        "TOOLS"                 to TOOLS,
        "LIFESTYLE"             to LIFESTYLE,
    )

    // ── Migration map: old name → current canonical name ─────────────────────
    // APPEND-ONLY — never delete entries. They protect users on old installs
    // who have stale category strings in SharedPreferences or pkg_db.json.
    //
    // Format:  "OldExactString"  to  CONSTANT
    //
    // v1 taxonomy (original)
    private val MIGRATION_MAP: Map<String, String> = mapOf(
        "Social"                to SOCIAL,
        "Entertainment"         to ENTERTAINMENT,
        "Productivity"          to PRODUCTIVITY,
        "Gaming"                to GAMES,
        "Health & Fitness"      to HEALTH,
        "Education"             to EDUCATION,
        "Travel & Maps"         to TRAVEL,
        "Photography"           to CREATIVE,
        "News"                  to NEWS,
        "Weather"               to TOOLS,
        "Auto & Vehicles"       to LIFESTYLE,
        "Medical"               to HEALTH,
        "Personalization"       to TOOLS,
        "Utilities"             to TOOLS,
        // v2 taxonomy (if you rename again, add entries here)
    )

    /**
     * Normalise any persisted category string to the current canonical name.
     * Safe to call on values that are already current — returns them unchanged.
     * Call this whenever reading from pkg_db.json, catCache, or appCatMap.
     */
    fun migrate(raw: String): String = MIGRATION_MAP[raw] ?: raw

    /**
     * Returns true if [cat] is a recognised category in the current taxonomy.
     * Useful for validating user-supplied category assignments.
     */
    fun isValid(cat: String): Boolean = cat in ALL
}