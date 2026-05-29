package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// BridgeKeys — single source of truth for ALL SharedPreferences key strings.
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
const val CACHED_MONTHLY_MONTH     = "cached_monthly_month"

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

const val KEY_FOCUS_WEEK_ID           = "focus_week_id"
const val KEY_FOCUS_WEEK_DAYS         = "focus_week_days"
const val KEY_FOCUS_COMPLETED_WEEK    = "focus_completed_week"
const val KEY_FOCUS_INTERRUPTED_WEEK  = "focus_interrupted_week"
const val KEY_FOCUS_TIME_WEEK_MINS    = "focus_time_week_mins"
const val KEY_FOCUS_LAST_OUTCOME      = "focus_last_outcome"
const val KEY_FOCUS_LAST_ELAPSED      = "focus_last_elapsed"
const val KEY_FOCUS_LAST_TOTAL        = "focus_last_total_mins"
const val KEY_FOCUS_LAST_COMPLETE_TS  = "focus_last_complete_ts"
const val KEY_FOCUS_DATE               = "focus_date_v1"
const val KEY_FOCUS_COMPLETED_TODAY    = "focus_completed_today"
const val KEY_FOCUS_INTERRUPTED_TODAY  = "focus_interrupted_today"
const val KEY_FOCUS_PLANNED_MINS_TODAY = "focus_planned_mins_today"
const val KEY_FOCUS_ELAPSED_MINS_TODAY = "focus_elapsed_mins_today"

const val KEY_INTENTION_APPS         = "focus_intention_apps"
const val KEY_INTENTION_ENABLED      = "focus_intention_enabled"
const val KEY_INTENTION_PAUSE_DATE   = "focus_intention_pause_date"
const val KEY_INTENTION_PAUSE_COUNT  = "focus_intention_pause_count"
const val KEY_INTENTION_RESIST_DATE  = "focus_intention_resist_date"
const val KEY_INTENTION_RESIST_COUNT = "focus_intention_resist_count"

const val KEY_INTENTION_APP_PAUSE_COUNT_PREFIX  = "focus_intention_pause_count_"
const val KEY_INTENTION_APP_RESIST_COUNT_PREFIX = "focus_intention_resist_count_"
const val KEY_INTENTION_APP_PAUSE_DATE_PREFIX   = "focus_intention_pause_date_"
const val KEY_INTENTION_APP_RESIST_DATE_PREFIX  = "focus_intention_resist_date_"

// ── Bedtime ───────────────────────────────────────────────────────────────────
const val BEDTIME_SETTINGS_V1      = "bedtime_settings_v1"
const val BEDTIME_ACTIVE           = "bedtime_active"
const val BEDTIME_BLOCK_ACTIVE     = "bedtime_block_active"
const val BEDTIME_STREAK           = "bedtime_streak"
const val BEDTIME_STREAK_LAST_DATE = "bedtime_streak_last_date"
const val BEDTIME_WEEK_DAYS        = "bedtime_week_days"
const val BEDTIME_WEEK_ID          = "bedtime_week_id"
const val BEDTIME_ON_TS            = "bedtime_on_ts"
const val BEDTIME_OFF_TS           = "bedtime_off_ts"
const val BEDTIME_SNOOZE_COUNT     = "bedtime_snooze_count"
const val BEDTIME_SNOOZE_UNTIL_TS  = "bedtime_snooze_until_ts"
const val BEDTIME_SAVED_BRIGHTNESS = "bedtime_saved_brightness"
const val BEDTIME_APP_ATTEMPTS     = "bedtime_app_attempts"

const val BEDTIME_LAST_NIGHT_KEPT          = "bedtime_last_night_kept"
const val BEDTIME_LAST_NIGHT_SNOOZES       = "bedtime_last_night_snooze_count"
const val BEDTIME_LAST_NIGHT_ATTEMPTS      = "bedtime_last_night_attempts_total"
const val BEDTIME_LAST_NIGHT_HAS_DATA      = "bedtime_last_night_has_data"
const val BEDTIME_LAST_NIGHT_ATTEMPTS_JSON = "bedtime_last_night_attempts_json"

const val BEDTIME_WINDOWN_START_TS         = "bedtime_windown_start_ts"
const val BEDTIME_WINDOWN_SNOOZE_UNTIL_TS  = "bedtime_windown_snooze_until_ts"
const val BEDTIME_SKIPPED_TONIGHT          = "bedtime_skipped_tonight"
const val BEDTIME_STARTS_AT_MS             = "bedtime_starts_at_ms"
const val BEDTIME_LAST_NIGHT_IN_WINDOW_SCREEN_MINS = "bedtime_last_night_in_window_mins"
const val BEDTIME_LAST_NIGHT_SKIPPED_TONIGHT       = "bedtime_last_night_skipped_tonight"
const val BEDTIME_LAST_NIGHT_FILTER_ACTIVE         = "bedtime_last_night_filter_active"

// ── Notifications ─────────────────────────────────────────────────────────────
const val NOTIF_CHANNEL_ID     = "tidy_alerts"
const val SMART_ALERTS_ENABLED = "smart_alerts_enabled"
const val NOTIF_CLEARED_TS     = "notif_cleared_ts"
const val NOTIF_HISTORY_KEY = "tidy_notif_history_v2"
const val WEEKLY_RECAP_DISMISSED_PREFIX = "weekly_recap_dismissed_"

// ── Widget ────────────────────────────────────────────────────────────────
const val WIDGET_THEME           = "widget_theme"
const val WIDGET_INSIGHT_ENABLED = "widget_insight_enabled"

// ── Settings ──────────────────────────────────────────────────────────────
const val USER_SETTINGS_V5 = "user_settings_v5"
const val STREAK_GOAL_MINS = "streak_goal_mins"
const val ONBOARDING_DONE  = "onboarding_done"
const val IS_PRO_USER      = "is_pro_user"

const val SOUND_CUES_ENABLED = "sound_cues_enabled"

const val HC_CONNECTED  = "hc_connected"
// v2.2: user-configurable daily step goal (affects Body Score steps component
// and Body streak criteria). Default 8,000. PRO (HC is already PRO).
const val HC_STEP_GOAL  = "hc_step_goal"

const val SCREEN_FILTER_SETTINGS_V1       = "screen_filter_settings_v1"
const val SCREEN_FILTER_ACTIVE            = "screen_filter_active"
const val SCREEN_FILTER_PRE_BEDTIME_STATE = "screen_filter_pre_bedtime_state"

// ── Quiet Hours ─────────────────────────────────────────────────────────────
const val QUIET_HOURS_SETTINGS_V1   = "quiet_hours_settings_v1"
const val QUIET_HOURS_ACTIVE        = "quiet_hours_active"
const val QUIET_HOURS_STARTS_AT_MS  = "quiet_hours_starts_at_ms"
const val QUIET_HOURS_ENDS_AT_MS    = "quiet_hours_ends_at_ms"
const val QUIET_HOURS_PRE_DND_FILTER  = "quiet_hours_pre_dnd_filter"
const val QUIET_HOURS_SKIPPED_TODAY = "quiet_hours_skipped_today_ymd"
const val QUIET_HOURS_SNOOZE_UNTIL_TS = "quiet_hours_snooze_until_ts"

const val DND_OWNER                 = "dnd_owner_v1"
const val DND_OWNER_NONE            = ""
const val DND_OWNER_BEDTIME         = "bedtime"
const val DND_OWNER_QUIET_HOURS     = "quiet_hours"

// ── Rate-app prompt ───────────────────────────────────────────────────────
const val KEY_RATE_INSTALL_MS    = "rate_install_ms"
const val KEY_RATE_LAST_SHOWN_MS = "rate_last_shown_ms"
const val KEY_RATE_ATTEMPT_COUNT = "rate_attempt_count"

// ── Referral ───────────────────────────────────────────────────────────────
const val REFERRAL_MY_CODE              = "referral_my_code"
const val REFERRAL_INSTALL_ID           = "referral_install_id"
const val REFERRAL_REFERRER_CHECKED     = "referral_referrer_checked"
const val REFERRAL_INCOMING_CODE        = "referral_incoming_code"
const val REFERRAL_BONUS_GRANTED        = "referral_bonus_granted"
const val REFERRAL_BONUS_DAYS           = "referral_bonus_days"
const val REFERRAL_SHARE_COUNT          = "referral_share_count"
const val REFERRAL_TOTAL_INSTALLS       = "referral_total_installs"
const val REFERRAL_TOTAL_CONVERSIONS    = "referral_total_conversions"
const val REFERRAL_TOTAL_DAYS_EARNED    = "referral_total_days_earned"
const val REFERRAL_LAST_INSTALL_TS      = "referral_last_install_ts"
const val REFERRAL_LAST_CONVERSION_TS   = "referral_last_conversion_ts"
const val REFERRAL_LAST_CONVERSION_PLAN = "referral_last_conversion_plan"
const val REFERRAL_PENDING_CONVERSIONS  = "referral_pending_conversions"
const val REFERRAL_INSTALLS_THIS_MONTH  = "referral_installs_this_month"
const val REFERRAL_INSTALLS_MONTH_KEY   = "referral_installs_month_key"
const val REFERRAL_INSTALL_TS           = "referral_install_ts"
const val REFERRAL_THIS_USER_CONVERTED  = "referral_this_user_converted"
const val REFERRAL_THIS_USER_PLAN       = "referral_this_user_plan"
const val REFERRAL_THIS_USER_CONVERSION_TS = "referral_this_user_conversion_ts"
const val REFERRAL_BANNER_LAST_SHOWN_DATE  = "referral_banner_last_shown_date"
const val REFERRAL_CREDITED_FRIEND_CODES      = "referral_credited_friend_codes"
const val REFERRAL_CREDITED_CONVERSION_CODES  = "referral_credited_conv_codes"
const val REFERRAL_PENDING_NOTIF_SENT         = "referral_pending_notif_sent"
const val REFERRAL_PENDING_EXTENSION_DAYS  = "referral_pending_ext_days"
const val REFERRAL_EXTENSION_EXPIRY_MS     = "referral_extension_expiry_ms"
const val REFERRAL_EXTENSION_SOURCE_PLAN   = "referral_extension_source_plan"
const val REFERRAL_TOTAL_LAPSED            = "referral_total_lapsed"
const val REFERRAL_PENDING_CONVERSION_DAYS = "referral_pending_conv_days"
const val REFERRAL_OLDEST_INSTALL_TS = "referral_oldest_install_ts"
const val BILLING_ACTIVE_PLAN = "billing_active_plan"

// ── Referral confirmation code flow ─────────────────────────────────────────
const val REFERRAL_CONFIRM_CODE      = "referral_confirm_code"
const val REFERRAL_CONV_CONFIRM_CODE = "referral_conv_confirm_code"
const val REFERRAL_CONV_CONFIRM_PLAN = "referral_conv_confirm_plan"
const val REFERRAL_TOTAL_DAYS_EVER_BANKED = "referral_total_days_ever_banked"
const val REF_REDEEM_FAIL_COUNT = "ref_redeem_fail_count"
const val REF_REDEEM_LOCK_MS    = "ref_redeem_lock_ms"

// ── App Lock PIN & Biometric ──────────────────────────────────────────────
const val APP_LOCK_PIN_HASH          = "app_lock_pin_hash_v1"
const val APP_LOCK_BIOMETRIC_ENABLED = "app_lock_biometric_enabled"
const val APP_LOCK_SETUP_DONE        = "app_lock_setup_done"
