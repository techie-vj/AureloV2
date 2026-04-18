package com.javikastudio.tidyapp

import android.content.Context
import android.graphics.Color

// ─────────────────────────────────────────────────────────────────────────────
//  Widget theme definitions
//  Each theme carries all the colours needed by AureloWidgetProvider.applyTheme()
// ─────────────────────────────────────────────────────────────────────────────
enum class WidgetTheme(
    val key:         String,
    val displayName: String,
    val isPro:       Boolean,
    // Background of the widget card
    val bgColor:     Int,
    // Background of the search row inside the card
    val searchBg:    Int,
    // Primary text (app names, screen time value)
    val textPrimary: Int,
    // Dim text (goal, hint)
    val textDim:     Int,
    // Progress bar fill colour
    val progressFill:Int,
    // Progress bar track colour
    val progressBg:  Int
) {
    DEFAULT(
        key          = "DEFAULT",
        displayName  = "Default",
        isPro        = false,
        bgColor      = Color.parseColor("#CC141428"),   // 80% dark navy
        searchBg     = Color.parseColor("#33FFFFFF"),
        textPrimary  = Color.WHITE,
        textDim      = Color.parseColor("#99FFFFFF"),
        progressFill = Color.parseColor("#6C63FF"),
        progressBg   = Color.parseColor("#33FFFFFF")
    ),
    DARK_AMOLED(
        key          = "DARK_AMOLED",
        displayName  = "Dark AMOLED",
        isPro        = true,
        bgColor      = Color.parseColor("#FF0A0A0A"),
        searchBg     = Color.parseColor("#FF111111"),
        textPrimary  = Color.parseColor("#DDFFFFFF"),
        textDim      = Color.parseColor("#66FFFFFF"),
        progressFill = Color.WHITE,
        progressBg   = Color.parseColor("#FF1A1A1A")
    ),
    MINIMAL_MONO(
        key          = "MINIMAL_MONO",
        displayName  = "Minimal Mono",
        isPro        = true,
        bgColor      = Color.parseColor("#FFFFFFFF"),
        searchBg     = Color.parseColor("#FFF5F2EE"),
        textPrimary  = Color.parseColor("#FF222222"),
        textDim      = Color.parseColor("#FF999999"),
        progressFill = Color.parseColor("#FF333333"),
        progressBg   = Color.parseColor("#FFEDE9E2")
    ),
    NEON_GLOW(
        key          = "NEON_GLOW",
        displayName  = "Neon Glow",
        isPro        = true,
        bgColor      = Color.parseColor("#EE06061C"),   // near-black, slight opacity
        searchBg     = Color.parseColor("#196C63FF"),   // 10% purple
        textPrimary  = Color.parseColor("#CC9D97FF"),
        textDim      = Color.parseColor("#669D97FF"),
        progressFill = Color.parseColor("#6C63FF"),
        progressBg   = Color.parseColor("#196C63FF")
    ),
    FROSTED_GLASS(
        key          = "FROSTED_GLASS",
        displayName  = "Frosted Glass",
        isPro        = true,
        bgColor      = Color.parseColor("#33FFFFFF"),   // 20% white — lets wallpaper bleed
        searchBg     = Color.parseColor("#44FFFFFF"),
        textPrimary  = Color.WHITE,
        textDim      = Color.parseColor("#AAFFFFFF"),
        progressFill = Color.parseColor("#CCFFFFFF"),
        progressBg   = Color.parseColor("#33FFFFFF")
    ),
    DYNAMIC_COLOR(
        key          = "DYNAMIC_COLOR",
        displayName  = "Dynamic Color",
        isPro        = true,
        bgColor      = Color.parseColor("#FFFBFBFE"),   // Material You surface — overridden at runtime
        searchBg     = Color.parseColor("#FFF3EDF7"),
        textPrimary  = Color.parseColor("#FF1C1B1F"),
        textDim      = Color.parseColor("#FF79747E"),
        progressFill = Color.parseColor("#FF6750A4"),
        progressBg   = Color.parseColor("#FFECE6F0")
    );

    companion object {
        fun fromKey(key: String?): WidgetTheme =
            values().firstOrNull { it.key == key } ?: DEFAULT
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  WidgetThemeManager — persistence
// ─────────────────────────────────────────────────────────────────────────────
object WidgetThemeManager {

    private const val PREF_FILE  = "tidyapp_v6"   // same prefs as AppBridge
    // WIDGET_THEME migrated to BridgeKeys.WIDGET_THEME (Phase 3)

    fun getTheme(context: Context): WidgetTheme {
        val key = context
            .getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
            .getString(WIDGET_THEME, WidgetTheme.DEFAULT.key)
        return WidgetTheme.fromKey(key)
    }

    fun setTheme(context: Context, theme: WidgetTheme) {
        context
            .getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
            .edit()
            .putString(WIDGET_THEME, theme.key)
            .apply()
        // Push update to all active widgets immediately
        WidgetUpdater.updateAll(context)
    }

    fun setThemeByKey(context: Context, key: String) =
        setTheme(context, WidgetTheme.fromKey(key))
}

// ─────────────────────────────────────────────────────────────────────────────
//  WidgetUpdater — broadcasts an update to all active Aurelo widgets
// ─────────────────────────────────────────────────────────────────────────────
object WidgetUpdater {
    fun updateAll(context: Context) {
        val manager = android.appwidget.AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(
            android.content.ComponentName(context, AureloWidgetProvider::class.java)
        )
        if (ids.isEmpty()) return
        val intent = android.content.Intent(context, AureloWidgetProvider::class.java).apply {
            action = android.appwidget.AppWidgetManager.ACTION_APPWIDGET_UPDATE
            putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        }
        context.sendBroadcast(intent)
    }
}
