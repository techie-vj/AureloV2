package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// BridgeKeys — single source of truth for ALL SharedPreferences key strings.
// Phase 3: each domain controller imports only the constants it owns.
// Never use raw string literals for prefs keys elsewhere in the project.
// ═══════════════════════════════════════════════════════════════════════════

// ── Prefs files ───────────────────────────────────────────────────────────
const val PREFS_FILE           = "tidyapp_v6"
const val SECURE_PREFS_FILE    = "tidyapp_secure_v1"
const val CAT_CACHE_FILE       = "tidyapp_cat_cache_v1"

// ── Usage stats cache ─────────────────────────────────────────────────────
const val CACHED_DAILY_USAGE       = "cached_daily_usage"
const val CACHED_HOURLY            = "cached_hourly"
const val CACHED_WEEKLY            = "cached_weekly"
const val CACHED_WEEKLY_TS         = "cached_weekly_ts"
const val CACHED_TOTAL_MINS        = "cached_total_mins"
const val CACHED_PICKUPS           = "cached_pickups"
const val CACHED_FIRST_PICKUP_TS   = "cached_first_pickup_ts"
const val CACHED_GHOSTS            = "cached_ghosts"
const val CACHED_GHOSTS_TS         = "cached_ghosts_ts"
const val CACHED_GHOST_COUNT       = "cached_ghost_count"
const val CACHED_APPS_V5           = "cached_apps_v5"
const val CACHED_TRACKER_SCAN_TS   = "cached_tracker_scan_ts"
const val CACHED_STREAK_DAYS       = "cached_streak_days"
const val CACHED_USAGE_TS          = "cached_usage_ts"
const val CACHED_MONTHLY_BREAKDOWN = "cached_monthly_breakdown"
const val CACHED_MONTHLY_PICKUPS   = "cached_monthly_pickups"
const val CACHED_MONTHLY_HOURLY    = "cached_monthly_hourly"
const val CACHED_MONTHLY_APP_USAGE = "cached_monthly_app_usage"
const val CACHED_MONTHLY_TS        = "cached_monthly_ts"

// ── Daily history ─────────────────────────────────────────────────────────
const val DAILY_HIST_MAP      = "daily_hist_map"
const val DAILY_HIST_LAST_DAY = "daily_hist_last_day"

// ── App management ────────────────────────────────────────────────────────
const val LOCKED_APPS_V4   = "locked_apps_v4"
const val HIDDEN_APPS_V4   = "hidden_apps_v4"
const val CAT_OVERRIDES_V4 = "cat_overrides_v4"
const val CAT_APP_ORDER_V1 = "cat_app_order_v1"
const val APP_CAT_MAP_V1   = "app_cat_map_v1"
const val USER_CATS_V1     = "user_cats_v1"

// ── App timers ────────────────────────────────────────────────────────────
const val APP_LIMITS_V5        = "app_limits_v5"
const val TIMERBLOCK_PKGS_MAP  = "timerblock_pkgs_map"
const val TIMER_IGNORE_STATS_V1 = "timer_ignore_stats_v1"

// ── Focus session ─────────────────────────────────────────────────────────
const val KEY_FOCUS_ACTIVE         = "focus_session_active"
const val KEY_FOCUS_DIFFICULTY     = "focus_session_difficulty"
const val KEY_FOCUS_END_TS         = "focus_session_end_ts"
const val KEY_FOCUS_BLOCKED_APPS   = "focus_blocked_apps"
const val KEY_FOCUS_ROUTINES       = "focus_routines"
const val KEY_FOCUS_ACTIVE_ROUTINE = "focus_active_routine_id"

// ── Focus weekly stats ────────────────────────────────────────────────────
const val KEY_FOCUS_WEEK_ID          = "focus_week_id"
const val KEY_FOCUS_WEEK_DAYS        = "focus_week_days"
const val KEY_FOCUS_COMPLETED_WEEK   = "focus_completed_week"
const val KEY_FOCUS_INTERRUPTED_WEEK = "focus_interrupted_week"
const val KEY_FOCUS_TIME_WEEK_MINS   = "focus_time_week_mins"
const val KEY_FOCUS_LAST_OUTCOME     = "focus_last_outcome"
const val KEY_FOCUS_LAST_ELAPSED     = "focus_last_elapsed"
const val KEY_FOCUS_LAST_TOTAL       = "focus_last_total_mins"
// F-06: daily session counters (reset at midnight) for use in Focus Score daily Aurelo composite
const val KEY_FOCUS_DATE              = "focus_date_v1"
const val KEY_FOCUS_COMPLETED_TODAY   = "focus_completed_today"
const val KEY_FOCUS_INTERRUPTED_TODAY = "focus_interrupted_today"
const val KEY_FOCUS_PLANNED_MINS_TODAY = "focus_planned_mins_today"
const val KEY_FOCUS_ELAPSED_MINS_TODAY = "focus_elapsed_mins_today" 

// ── Intention prompt ──────────────────────────────────────────────────────
// IMPORTANT: ALL key values here must match the literal strings used in
// IntentionEngine.kt exactly.  A mismatch means the bridge reads from a
// different prefs entry than the engine writes → counts always read as 0.
//
// BUG FIX: pause/resist date+count keys were missing the "focus_" prefix,
// so IntentionPromptBridge.getIntentionPauseCount() / getIntentionResistCount()
// always returned 0 even after real pauses were recorded.
const val KEY_INTENTION_APPS         = "focus_intention_apps"
const val KEY_INTENTION_ENABLED      = "focus_intention_enabled"
const val KEY_INTENTION_PAUSE_DATE   = "focus_intention_pause_date"   // was "intention_pause_date"
const val KEY_INTENTION_PAUSE_COUNT  = "focus_intention_pause_count"  // was "intention_pause_count"
const val KEY_INTENTION_RESIST_DATE  = "focus_intention_resist_date"  // was "intention_resist_date"
const val KEY_INTENTION_RESIST_COUNT = "focus_intention_resist_count" // was "intention_resist_count"

// Per-app pause/resist counts — stored by IntentionEngine alongside the aggregates.
// Pattern: "focus_intention_pause_count_{packageName}" / "focus_intention_resist_count_{packageName}"
// Date guards follow the same pattern: "focus_intention_pause_date_{packageName}"
const val KEY_INTENTION_APP_PAUSE_COUNT_PREFIX  = "focus_intention_pause_count_"
const val KEY_INTENTION_APP_RESIST_COUNT_PREFIX = "focus_intention_resist_count_"
const val KEY_INTENTION_APP_PAUSE_DATE_PREFIX   = "focus_intention_pause_date_"
const val KEY_INTENTION_APP_RESIST_DATE_PREFIX  = "focus_intention_resist_date_"

// ── Bedtime ───────────────────────────────────────────────────────────────
const val BEDTIME_SETTINGS_V1         = "bedtime_settings_v1"
const val BEDTIME_ACTIVE              = "bedtime_active"
const val BEDTIME_BLOCK_ACTIVE        = "bedtime_block_active"
const val BEDTIME_STREAK              = "bedtime_streak"
const val BEDTIME_STREAK_LAST_DATE    = "bedtime_streak_last_date"
const val BEDTIME_WEEK_DAYS           = "bedtime_week_days"
const val BEDTIME_WEEK_ID             = "bedtime_week_id"
const val BEDTIME_ON_TS               = "bedtime_on_ts"
const val BEDTIME_OFF_TS              = "bedtime_off_ts"
const val BEDTIME_SNOOZE_COUNT        = "bedtime_snooze_count"
const val BEDTIME_SNOOZE_UNTIL_TS     = "bedtime_snooze_until_ts"
const val BEDTIME_SAVED_BRIGHTNESS    = "bedtime_saved_brightness"
const val BEDTIME_APP_ATTEMPTS        = "bedtime_app_attempts"
const val BEDTIME_LAST_NIGHT_KEPT     = "bedtime_last_night_kept"
const val BEDTIME_LAST_NIGHT_SNOOZES  = "bedtime_last_night_snooze_count"
const val BEDTIME_LAST_NIGHT_ATTEMPTS = "bedtime_last_night_attempts_total"
const val BEDTIME_LAST_NIGHT_HAS_DATA = "bedtime_last_night_has_data"

// ── Notifications ─────────────────────────────────────────────────────────
const val NOTIF_CHANNEL_ID    = "tidy_alerts"
const val SMART_ALERTS_ENABLED = "smart_alerts_enabled"
const val NOTIF_CLEARED_TS    = "notif_cleared_ts"

// ── Widget ────────────────────────────────────────────────────────────────
const val WIDGET_THEME           = "widget_theme"
const val WIDGET_INSIGHT_ENABLED = "widget_insight_enabled"

// ── Settings ──────────────────────────────────────────────────────────────
const val USER_SETTINGS_V5 = "user_settings_v5"
const val STREAK_GOAL_MINS = "streak_goal_mins"
const val ONBOARDING_DONE  = "onboarding_done"
const val IS_PRO_USER      = "is_pro_user"

// ── Health Connect ────────────────────────────────────────────────────────
const val HC_CONNECTED = "hc_connected"   // "1" = connected, "0" / absent = disconnected

// ── Rate-app prompt ───────────────────────────────────────────────────────
const val KEY_RATE_INSTALL_MS    = "rate_install_ms"
const val KEY_RATE_LAST_SHOWN_MS = "rate_last_shown_ms"
const val KEY_RATE_ATTEMPT_COUNT = "rate_attempt_count"