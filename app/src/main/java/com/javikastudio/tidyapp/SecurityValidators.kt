package com.javikastudio.tidyapp

import android.content.Context
object SecurityValidators {
    private val PACKAGE_RE = Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$")
    private val HTTP_URL_RE = Regex("^https?://[^\\s]+$", RegexOption.IGNORE_CASE)
    private val MAILTO_RE = Regex("^mailto:[^\\s]*$", RegexOption.IGNORE_CASE)

    private val ASSET_ALLOWLIST = setOf(
        "www/affiliate_links.json",
        "www/templates/home.html",
        "www/templates/wellness.html",
        "www/templates/focus.html",
        "www/templates/settings.html",
        "www/templates/onboarding.html",
        "www/templates/panels.html",
        "www/templates/modals.html",
        "www/templates/discover.html",
    )

    private val PREF_ALLOWLIST = setOf(
        "user_name",
        "app_theme",
        "tidy_dismissed_notifs_v1",
        "tidy_notif_cleared_ts",
        "tidy_notif_history_v2",
        "insight_dismissed_date",
        "screen_score_history",
        "focus_score_history",
        "sleep_score_history",
        "aurelo_score_history",
        "body_score_history",      // Bug-1 FIX: missing key caused saveScoreForToday() writes
        "focus_streak_v1",
        "home_morning_dismissed_date",
        "disc_challenge_v1",
        "settings_notif_permission_asked",
        "cached_tidy_score",
        "cached_tidy_score_date",
        "deletedCategories",
        "disc_shown_v1",
        // H7 FIX: The following keys were missing and caused getStringPref()/setStringPref()
        // calls from JS to return "" silently, breaking the Coach home card, bedtime
        // display, widget settings, and smart-alert reads from the WebView layer.
        "coach_daily_insight_json",
        "coach_daily_insight_date",
        "coach_insight_dismissed_date",
        "smart_alerts_enabled",
        "widget_pulse_step",
        "widget_section_collapsed",
        "recap_sent_date",
        "bedtime_enabled",
        "bedtime_start_hour",
        "bedtime_start_min",
        "bedtime_end_hour",
        "bedtime_end_min",
        "bedtime_streak",
        "bedtime_last_night_stats",
        "bedtime_last_night_kept",
        "bedtime_last_night_has_data",
        "bedtime_last_night_snooze_count",
        "bedtime_last_night_attempts_total",
        "focus_date_v1",
        "focus_completed_today",
        "focus_interrupted_today",
        "focus_planned_mins_today",
        "focus_elapsed_mins_today",
        "focus_week_id",
        "focus_week_days",
        "focus_completed_week",
        "focus_interrupted_week",
        "focus_time_week_mins",
        "focus_last_outcome",
        "focus_last_elapsed",
        "focus_last_total_mins",
        "focus_last_complete_ts",
        "referral_banner_last_shown_date",
        // ── v2.1.0 NEW KEYS ──────────────────────────────────────────────────
        // H7-class FIX: same class of bug as H7 above — new features added keys
        // that were never registered here, causing all getStringPref()/setStringPref()
        // calls from JS for these features to silently return "".
        //
        // Quiet Hours
        "quiet_hours_enabled",
        "quiet_hours_start_hour",
        "quiet_hours_start_min",
        "quiet_hours_end_hour",
        "quiet_hours_end_min",
        "quiet_hours_days",
        "quiet_hours_active",
        "quiet_hours_paused",
        "quiet_hours_pause_until_ts",
        "quiet_hours_owner_active",
        // Sound Cues
        "sound_cues_enabled",
        // Mood Check-In
        "mood_today_entry",
        "mood_history_json",
        "mood_prompt_dismissed_date",
        "mood_onboarding_logged",
        "mood_check_in_enabled",
        // Weekly Recap
        "last_weekly_recap_week",
        "weekly_recap_banner_dismissed",
        // Notification History & Detail Sheets
        "notif_history_json",
        "notif_unread_count",
        "notif_sheet_last_opened",
        // DnD coordination (DndController ownership tokens)
        "dnd_owner_token",
        // Step goal configured by user under Settings → Health Connect.
        "hc_step_goal",
        // Streak heatmap row visibility toggles (Score History UI state).
        "streak_hm_screen_visible",
        "streak_hm_focus_visible",
        "streak_hm_bedtime_visible",
        "streak_hm_body_visible",
    )

    fun isValidPackageName(value: String): Boolean = value.matches(PACKAGE_RE)

    fun isPackageName(value: String): Boolean = isValidPackageName(value)

    fun isInstalledLaunchablePackage(context: Context, packageName: String): Boolean {
        if (!isValidPackageName(packageName) || packageName == context.packageName) return false
        return runCatching {
            context.packageManager.getPackageInfo(packageName, 0)
            context.packageManager.getLaunchIntentForPackage(packageName) != null
        }.getOrDefault(false)
    }

    fun isAllowedExternalUrl(value: String): Boolean {
        val trimmed = value.trim()
        return trimmed.matches(HTTP_URL_RE) || trimmed.matches(MAILTO_RE)
    }

    fun isSafeExternalUrl(value: String): Boolean = isAllowedExternalUrl(value)

    fun isAllowedAssetPath(path: String): Boolean {
        val normalized = path.trim().replace('\\', '/')
        if (normalized.startsWith("/") || normalized.contains("..")) return false
        return normalized in ASSET_ALLOWLIST
    }

    fun isAllowedPublicPrefKey(key: String): Boolean = key in PREF_ALLOWLIST

    fun isAllowedPlainPrefKey(key: String): Boolean = isAllowedPublicPrefKey(key)

    fun isUserVisiblePackage(context: Context, packageName: String): Boolean {
        if (!isInstalledLaunchablePackage(context, packageName)) return false
        return runCatching {
            val info = context.packageManager.getApplicationInfo(packageName, 0)
            (info.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) == 0 ||
                    (info.flags and android.content.pm.ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
        }.getOrDefault(false)
    }
}