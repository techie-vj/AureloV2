# Aurelo — Android Build & Developer Guide

**Version 2.1.0** · `com.javikastudio.tidyapp` · Android 8.0+ (API 26–36) · Target API 36 · Compile SDK API 37

Aurelo is a native Android digital wellness application built with a Kotlin backend and a WebView UI layer. All data stays on-device — no analytics SDKs, no tracking, no external servers beyond Google Play Billing.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Prerequisites](#3-prerequisites)
4. [Build Instructions](#4-build-instructions)
5. [Signing & Release](#5-signing--release)
6. [Permissions](#6-permissions)
7. [Native Layer Reference](#7-native-layer-reference)
8. [JavaScript Layer Reference](#8-javascript-layer-reference)
9. [Data Storage](#9-data-storage)
10. [Billing & Subscriptions](#10-billing--subscriptions)
11. [Background Work](#11-background-work)
12. [Home Screen Widget](#12-home-screen-widget)
13. [Security Model](#13-security-model)
14. [Dependencies](#14-dependencies)
15. [Troubleshooting](#15-troubleshooting)
16. [Changelog](#16-changelog)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       WebView UI Layer                       │
│  index.html + app.css + 38 JS modules (56+ Kotlin files)    │
│  Tabs: Home · Wellness · Focus · Apps · Discover            │
└─────────────────────┬───────────────────────────────────────┘
                      │  window.AppBridge  (230+ @JavascriptInterface methods)
┌─────────────────────▼───────────────────────────────────────┐
│               Kotlin Native Layer (56+ files)               │
│  UsageStatsManager · PackageManager · AlarmManager          │
│  WindowManager overlays · EncryptedSharedPreferences        │
│  SQLCipher (LaunchTracker) · Google Play Billing            │
│  HealthConnectManager · ONNX Runtime (Coach ML)             │
│  DndController · RefreshCoordinator · SecurityValidators    │
└─────────────────────────────────────────────────────────────┘
```

The WebView is loaded from `assets/www/index.html` — a bundled asset, never a remote URL. JavaScript calls native methods via `window.AppBridge` (or `window.N` as a short alias). The bridge exposes 230+ `@JavascriptInterface` methods across 20+ bridge groups.

When running in a browser (no bridge present), all JS modules fall back to demo/stub data so the UI can be previewed without a device.

---

## 2. Project Structure

```
Aurelo/
├── app/
│   ├── build.gradle                             # Dependencies, signing config
│   ├── proguard-rules.pro                       # R8 keep rules — MUST preserve all Bridge classes
│   │                                            # -keep class *Bridge* { @android.webkit.JavascriptInterface *; }
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/
│       │   ├── pkg_db.json                      # 869 KB offline app category DB (~85-90% coverage)
│       │   ├── aurelo_coach_tree.json           # Coach decision tree (on-device ML)
│       │   └── www/
│       │       ├── index.html                   # Single-page app shell
│       │       ├── css/app.css                  # All UI styles
│       │       ├── affiliate_links.json         # Discover tab recommendations
│       │       ├── pro-gate.js                  # Pro feature gating logic
│       │       ├── pro-upsell.js                # Upsell sheet UI
│       │       └── js/
│       │           ├── app-core.js              # Init, bridge utils, shared helpers
│       │           ├── app-home.js              # Home dashboard, goal arc, insight banner
│       │           ├── app-home-score.js        # Aurelo Score card, pillar tiles
│       │           ├── app-wellness.js          # Screen time charts, donut, week/month views
│       │           ├── app-wellness-views.js    # Hourly, top apps, month heatmap
│       │           ├── app-focus.js             # Focus sessions, orbit animation
│       │           ├── app-focus-score.js       # Focus Score calculation + breakdown
│       │           ├── app-focus-bedtime.js     # Bedtime Mode, Sleep Score
│       │           ├── app-focus-timers.js      # App Timers, soft block
│       │           ├── app-focus-mindful.js     # Mindful Pause prompts
│       │           ├── app-focus-routine.js     # Focus Schedule / Routines
│       │           ├── app-focus-schedule-patch.js  # Routine scheduling engine
│       │           ├── app-screen-filter.js     # Screen Filter overlay controls
│       │           ├── app-health-connect.js    # Health Connect UI + Body Score
│       │           ├── app-score-history.js     # Score History chart + pillar toggles
│       │           ├── app-coach.js             # Coach modal chat interface
│       │           ├── app-coach-home.js        # Coach Insight Card on Home tab
│       │           ├── app-wellness-coach.js    # Coach cards in Wellness tab
│       │           ├── app-mood.js              # Daily Mood Check-In [NEW v2.1]
│       │           ├── app-quiet-hours.js       # Quiet Hours scheduler [NEW v2.1]
│       │           ├── app-notifications.js     # In-app notification panel
│       │           ├── app-notif-sheet.js       # Notification detail bottom sheets [NEW v2.1]
│       │           ├── app-weekly-recap.js      # Weekly Recap sheet [NEW v2.1]
│       │           ├── app-referral.js          # Refer a Friend, reward tracking
│       │           ├── app-categories.js        # Category management, locked/hidden apps
│       │           ├── app-panels.js            # App management panels
│       │           ├── app-settings.js          # Settings screen, data management
│       │           ├── app-discover.js          # Discover tab, app recommendations
│       │           ├── app-share.js             # Share card generation
│       │           ├── app-share-utils.js       # Shared canvas utilities
│       │           ├── app-nav.js               # Tab navigation, deep-link routing
│       │           ├── app-onboarding.js        # First-run setup flow
│       │           └── app-widget.js            # Widget settings screen
│       ├── java/com/javikastudio/tidyapp/
│       │   ├── MainActivity.kt                  # Activity host, WebView setup, lifecycle
│       │   ├── AppBridge.kt                     # Root bridge — delegates to sub-bridges
│       │   ├── UsageStatsBridge.kt              # Usage stats, hourly, weekly, monthly data
│       │   ├── ScoreHistoryBridge.kt            # Score History read/write (LaunchTracker DB)
│       │   ├── FocusSessionBridge.kt            # Focus session lifecycle
│       │   ├── FocusRoutineBridge.kt            # Focus Schedules + alarm coordination
│       │   ├── IntentionPromptBridge.kt         # Mindful Pause
│       │   ├── AppTimerBridge.kt                # App Timers + soft block
│       │   ├── TimerBlockingEngine.kt           # Timer overlay service
│       │   ├── BedtimeBridge.kt                 # Bedtime Mode settings + alarms
│       │   ├── BedtimeBlockingEngine.kt         # Bedtime app blocking overlay
│       │   ├── FocusBlockingEngine.kt           # Focus session app blocking overlay
│       │   ├── ScreenFilterEngine.kt            # Screen Filter foreground service
│       │   ├── HealthConnectBridge.kt           # HC bridge methods (JS ↔ HC)
│       │   ├── HealthConnectManager.kt          # HC permission + sync management
│       │   ├── HealthConnectRepository.kt       # HC data access layer
│       │   ├── BodyScoreCalculator.kt           # Body Score: Steps 40% + HRV 35% + RHR 25%
│       │   ├── ScreenScoreEnhancer.kt           # Steps-based modifier, linear gradient
│       │   ├── SleepScoreEnhancer.kt            # HC sleep duration + HRV blending
│       │   ├── CoachBridge.kt                   # Coach JS bridge
│       │   ├── CoachOrchestrator.kt             # Intent routing, response assembly
│       │   ├── CoachOnnxClassifier.kt           # ONNX Runtime inference (~924 KB model)
│       │   ├── CoachFeatureBuilder.kt           # Feature vector (15 float32 signals)
│       │   ├── CoachTreeClassifier.kt           # Decision tree classifier
│       │   ├── KotlinPatternDetector.kt         # Proactive pattern detection
│       │   ├── InsightTemplateLibrary.kt        # Response template engine
│       │   ├── CoachInsightWorker.kt            # WorkManager: nightly insight generation
│       │   ├── QuietHoursBridge.kt              # Quiet Hours JS bridge [NEW v2.1]
│       │   ├── QuietHoursReceiver.kt            # AlarmManager: Quiet Hours DND [NEW v2.1]
│       │   ├── DndController.kt                 # DND ownership token model [NEW v2.1]
│       │   ├── SoundEffects.kt                  # Procedural PCM tone synthesis [NEW v2.1]
│       │   ├── MoodBridge.kt                    # Mood Check-In JS bridge [NEW v2.1]
│       │   ├── NotificationBridge.kt            # Notification history + detail sheets [NEW v2.1]
│       │   ├── WeeklyRecapBridge.kt             # Weekly Recap data aggregation [NEW v2.1]
│       │   ├── RefreshCoordinator.kt            # Throttled refresh (min 8s usage / 60s widget) [NEW v2.1]
│       │   ├── SecurityValidators.kt            # Asset path / URL / prefs key allowlists [NEW v2.1]
│       │   ├── ReferralManager.kt               # Referral codes, rate limit, self-referral guard
│       │   ├── ReferralBridge.kt                # Referral JS bridge
│       │   ├── AppManagementBridge.kt           # Locked/hidden apps, categories
│       │   ├── AppCategorizer.kt                # 5-layer categorisation engine
│       │   ├── AppMonitorService.kt             # Foreground service: focus/lock overlays
│       │   ├── LaunchTracker.kt                 # SQLCipher DB: launches, Score History, Notification History
│       │   ├── AureloWidgetProvider.kt          # AppWidgetProvider: widget rendering
│       │   ├── AureloWidgetUpdateWorker.kt      # WorkManager: periodic widget refresh
│       │   ├── SmartNotificationWorker.kt       # WorkManager: smart notification dispatch
│       │   ├── ReferralExtensionWorker.kt       # WorkManager: Pro extension on referral
│       │   ├── RoutineAlarmReceiver.kt          # AlarmManager: Focus Schedule alarms
│       │   ├── BedTimeReceiver.kt               # AlarmManager: Bedtime start/wake-up alarms
│       │   ├── BootReceiver.kt                  # BOOT_COMPLETED: reschedule all alarms
│       │   ├── WidgetThemeManager.kt            # Widget theme resolution
│       │   ├── Categories.kt                    # Category constants + migration helpers
│       │   ├── PlayStoreFetcher.kt              # jsoup/gplayscrapper: Play Store categorisation
│       │   └── billing/
│       │       ├── BillingManager.kt            # Google Play Billing Library 7.1.1
│       │       ├── BillingBridge.kt             # Billing JS bridge
│       │       ├── EntitlementRepository.kt     # Pro status cache (EncryptedSharedPreferences)
│       │       ├── PurchaseVerifier.kt          # Client-side RSA signature verification
│       │       └── PurchaseRestoreHandler.kt    # Restore previous purchases
│       └── res/
│           ├── layout/widget_tidy.xml           # Home screen widget layout (4×2 cells)
│           ├── xml/
│           │   ├── tidy_widget_info.xml         # Widget metadata + preview
│           │   └── accessibility_service_config.xml
│           ├── drawable/
│           │   ├── widget_preview.xml           # Widget picker preview (replace with screenshot for release)
│           │   └── widget_dot_*.xml             # Animated dot drawables (9 variants: 3 states × 3 colours)
│           └── values/
│               ├── strings.xml · colors.xml · styles.xml
├── build.gradle
├── settings.gradle
├── gradle.properties
└── local.properties                             # SDK path + signing secrets — NOT in VCS
```

---

## 3. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Android Studio | Hedgehog (2023.1.1)+ | Ladybug or newer recommended |
| JDK | 17 | Bundled with Android Studio |
| Android SDK | API 26–37 | Install via SDK Manager |
| Gradle | 9.1.0 | Auto-downloaded via wrapper |
| Kotlin | 1.9.x | Configured via AGP |

---

## 4. Build Instructions

### Clone and open

```bash
git clone <repo-url>
# File → Open → select the Aurelo/ folder
# Wait for Gradle sync to complete
```

### Debug build (run on device)

1. Enable **Developer Options**: Settings → About Phone → tap Build Number 7 times
2. Enable **USB Debugging**: Settings → Developer Options → USB Debugging ON
3. Connect via USB and accept the prompt

```bash
./gradlew installDebug
# or click ▶ Run in Android Studio
```

### Debug build (emulator)

Use an emulator with **Google Play** (not plain AOSP) so `UsageStatsManager` and Play Billing return real data. API 26+ image required. For Health Connect testing, use API 34+ (Android 14) where HC is pre-installed.

```bash
./gradlew assembleDebug
# Install from app/build/outputs/apk/debug/
```

---

## 5. Signing & Release

Release signing is configured via `local.properties` — **never commit credentials to version control**.

### 1. Create a production keystore (one time)

```bash
keytool -genkey -v \
  -keystore javikastudio-release.jks \
  -alias javikastudio \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

**Store the keystore file securely. Losing it means losing the ability to update the Play Store listing.**

### 2. Add signing config to `local.properties`

```properties
RELEASE_STORE_FILE=../javikastudio-release.jks
RELEASE_STORE_PASSWORD=your_keystore_password
RELEASE_KEY_ALIAS=javikastudio
RELEASE_KEY_PASSWORD=your_key_password
```

`app/build.gradle` reads these automatically via the `signingConfigs.release` block.

### 3. Build a signed release AAB / APK

```bash
# AAB (recommended for Play Store)
./gradlew bundleRelease

# APK (direct distribution / testing)
./gradlew assembleRelease
```

Output: `app/build/outputs/bundle/release/app-release.aab`

### 4. Pre-release checklist

- Replace `res/drawable/widget_preview.xml` with a real device screenshot (~284×148 dp at mdpi)
- Verify `affiliate_links.json` — no `REPLACE_WITH_*` placeholder URLs in any affiliate link (DT-009)
- Confirm ProGuard rule preserves all bridge classes: `-keep class *Bridge* { @android.webkit.JavascriptInterface *; }`

---

## 6. Permissions

| Permission | Grant path | Required for |
|---|---|---|
| `PACKAGE_USAGE_STATS` | Settings → Apps → Special app access → Usage access | Screen time charts, top apps, ghost detection, app timers, widget stats |
| `SYSTEM_ALERT_WINDOW` | Settings → Apps → Aurelo → Display over other apps | Focus block overlay, App Lock overlay, Screen Filter, Mindful Pause, App Timer soft block |
| `ACCESS_NOTIFICATION_POLICY` | Settings → Notifications → Do Not Disturb access | Bedtime Mode DND, Quiet Hours DND |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Settings → Apps → Alarms & Reminders (API 31+) | Focus Routines, Bedtime alarms, Quiet Hours alarms |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Prompted in-app | Widget and notification reliability in Doze |
| `POST_NOTIFICATIONS` | System prompt (Android 13+) | All smart notifications |
| `QUERY_ALL_PACKAGES` | Automatic (declared in manifest) | Full app list, ghost app detection |
| `REQUEST_DELETE_PACKAGES` | Automatic | Ghost app one-tap uninstall dialog |
| `RECEIVE_BOOT_COMPLETED` | Automatic | Reschedule Focus Routines, Bedtime, Quiet Hours alarms after reboot |
| `VIBRATE` | Automatic (normal protection) | Haptic feedback on interactions, Mood Check-In selection |
| `FOREGROUND_SERVICE` | Automatic | AppMonitorService, ScreenFilterEngine |
| `INTERNET` / `ACCESS_NETWORK_STATE` | Automatic | Google Play Billing only |
| `BILLING` | Automatic | Google Play in-app purchases |
| Accessibility Service | Settings → Accessibility → Aurelo | App Lock overlay, Focus block detection, Mindful Pause detection |
| `health.READ_STEPS` | Health Connect permissions dialog | Body Score, Screen Score activity modifier [PRO] |
| `health.READ_SLEEP` | Health Connect permissions dialog | Sleep Score HC enhancement [PRO] |
| `health.READ_HEART_RATE_VARIABILITY` | Health Connect permissions dialog | HRV component of Body Score and Sleep Score [PRO] |
| `health.READ_RESTING_HEART_RATE` | Health Connect permissions dialog | RHR component of Body Score [PRO] |
| `health.READ_MINDFULNESS` | Health Connect permissions dialog | Focus Score mindfulness contribution [PRO] |

All permissions are optional at install — features degrade gracefully when denied.

> **Note on `SYSTEM_ALERT_WINDOW`:** A single permission grant supports all five overlay features (Screen Filter, Focus block, Bedtime block, App Timer soft block, App Lock). `WindowManager.addView()` must always be called on the main thread — `ScreenFilterEngine` enforces this via `Handler(Looper.getMainLooper())`.

---

## 7. Native Layer Reference

### `MainActivity.kt`

Activity host. Responsibilities:
- Creates `WebView`, registers bridge delegates as `addJavascriptInterface`
- Manages `bgExecutor` (`ScheduledExecutorService`) — calls `bridge.refreshUsageStats()` every 10 seconds while foregrounded; paused in `onPause()`, restarted in `onResume()`
- Handles widget and notification deep-links via `onNewIntent()`
- Registers `packageReceiver` for `ACTION_PACKAGE_ADDED/REPLACED/REMOVED`
- Implements `onTrimMemory()` — clears WebView cache when OS signals `TRIM_MEMORY_RUNNING_CRITICAL`

### `AppBridge.kt` — Bridge architecture

The root bridge delegates to 20+ specialised sub-bridges. The full bridge surface is 230+ `@JavascriptInterface` methods:

| Bridge / Group | Key Kotlin file(s) | Responsibility |
|---|---|---|
| Usage / Stats | `UsageStatsBridge.kt` | Screen time, hourly, weekly, monthly, pickups, streak |
| Score & History | `AppBridge.kt`, `ScoreHistoryBridge.kt` | Aurelo Score pillars, Score History (30/90 day) |
| Focus / Sessions | `FocusSessionBridge.kt`, `FocusRoutineBridge.kt` | Session lifecycle, blocking, routines, alarms |
| Mindful / Timers | `IntentionPromptBridge.kt`, `AppTimerBridge.kt` | Mindful Pause, App Timers, soft block |
| Bedtime / Sleep | `BedtimeBridge.kt`, `BedtimeBlockingEngine.kt` | Bedtime settings, alarms, app blocking, DND |
| Screen Filter | `ScreenFilterEngine.kt` | Overlay toggle, intensity, colour, bedtime auto-filter |
| Health Connect | `HealthConnectBridge.kt`, `HealthConnectManager.kt` | Permissions, sync, Body Score, activity modifier |
| Aurelo Coach | `CoachBridge.kt`, `CoachOrchestrator.kt` | Intent classification, proactive patterns, ONNX inference |
| Mood Check-In | `MoodBridge.kt` | Log mood, history, morning prompt, onboarding mood |
| Quiet Hours | `QuietHoursBridge.kt`, `QuietHoursReceiver.kt` | DND scheduling, presets, pause/resume |
| Sound Cues | `SoundEffects.kt` | Procedural tone synthesis, gating logic |
| Notification History | `NotificationBridge.kt` | 30-day history, read/unread state, detail sheets |
| Weekly Recap | `WeeklyRecapBridge.kt` | ISO-week data aggregation, banner dismiss state |
| App Management | `AppManagementBridge.kt`, `AppCategorizer.kt` | Lock, hide, categories, ghost apps |
| Billing / Pro | `BillingManager.kt`, `BillingBridge.kt` | Purchase flow, restore, 72-hour grace period |
| Referral | `ReferralManager.kt`, `ReferralBridge.kt` | Codes, rate limit, self-referral guard, rewards |
| Widget | `AureloWidgetProvider.kt`, `WidgetBridge.kt` | Widget data, themes, Smart Routine, storage stats |
| Notifications | `SmartNotificationWorker.kt`, `NotificationBridge.kt` | Smart alert dispatch, deduplication |
| Settings / Share | `SettingsBridge.kt`, `ShareBridge.kt` | Settings, data reset, share card generation |
| Permissions | `PermissionBridge.kt` | Permission status checks for all runtime permissions |

**Key internal patterns:**

`bridgeScope` — `CoroutineScope(SupervisorJob() + Dispatchers.Main)`. Cancelled in `destroy()` called from `MainActivity.onDestroy()`. All async work runs here — no `GlobalScope`, no raw `Thread`.

`securePrefs` — Lazy `EncryptedSharedPreferences` (AES-256-GCM, Android Keystore). On failure, falls back to plaintext and sets `_secureStorageAvailable = false`. JS is notified via `window.onSecureStorageUnavailable()`.

`catCache` — Plain `SharedPreferences` (`tidyapp_cat_cache_v1`). Intentionally unencrypted — category strings are not sensitive.

### `AppCategorizer.kt`

5-layer pipeline: (1) `pkg_db.json` lookup, (2) Android `ApplicationInfo.category`, (3) finance pre-check, (4) keyword scoring, (5) unassigned fallback. Play Store scraping (`PlayStoreFetcher.kt`) is a Pro-only async layer — offline fallback uses `pkg_db.json` automatically when network is unavailable.

### `AppMonitorService.kt`

Foreground service. Polls `UsageStatsManager.queryEvents()` to detect blocked app foreground events and shows the appropriate overlay. `RefreshCoordinator.onUsageRead()` throttles upstream processing to a minimum of 8 seconds between refreshes.

> **Performance note (PERF-01):** `POLL_MS=500` produces ~7,200 wakeups/hour. Consider increasing to 1,500–2,000 ms in a future release.

### `ScreenFilterEngine.kt`

Foreground service using `SYSTEM_ALERT_WINDOW`. Critical constraints:
- `WindowManager.addView()` **must** run on the main thread — dispatched via `Handler(Looper.getMainLooper())`
- `suspend()` / `resumeFilter()` preserve fade opacity state — do not restart from 0%
- Filter overlay excluded from screenshot capture

### `DndController.kt` *(New in v2.1.0)*

Ownership token model that allows Bedtime Mode and Quiet Hours to coexist without DND conflicts. Each feature holds its own token (`DND_OWNER_BEDTIME`, `DND_OWNER_QUIET_HOURS`) and neither overrides the other. `SESSION_COMPLETE` sound cue bypasses the DND owner check to avoid a race condition on focus session end.

### `LaunchTracker.kt`

SQLCipher-encrypted SQLite database (`tidyapp_launches.db`) storing:
- Per-app launch events (6 time slots × 7 days-of-week, 60-day rolling window) — powers Smart Routine ML
- Score History (all 5 pillars, 30/90 day) — written by `ScoreHistoryBridge.kt`
- Notification History (30-day rolling log with read/unread state) — written by `NotificationBridge.kt`

Passphrase: 32-byte random key stored in `EncryptedSharedPreferences`. Falls back to an `ANDROID_ID`-derived constant if the Keystore is unavailable.

> **SQL boundary guard:** `getSlotFrequencyPercent()` validates `dayOfWeek` — values 0 and 8 map to empty string to prevent SQL injection at the integer boundary (PP-030).

### `SecurityValidators.kt` *(New in v2.1.0)*

Asset path allowlist, URL allowlist, and `SharedPreferences` key allowlist. Fixes H7 (missing keys caused silent empty-string returns for coach home card, bedtime display, widget settings, smart alerts) and Bug-1 (`body_score_history` key was silently dropping `saveScoreForToday()` writes).

### Score calculators

| File | Responsibility |
|---|---|
| `BodyScoreCalculator.kt` | Steps 40% + HRV 35% + RHR 25%; re-normalises weights for partial data; `stepsToday=-1` sentinel excludes Steps when absent |
| `ScreenScoreEnhancer.kt` | Steps-based modifier: +5 (≥10k), +3 (≥8k), 0 (5k–7,999), linear gradient 0→-3 (2k–4,999), -3 (<2k) |
| `SleepScoreEnhancer.kt` | Blends bedtime adherence (60%) + HC sleep duration (25%) + HC overnight HRV (15%); HRV floor at 70% of personal 7-day average |

---

## 8. JavaScript Layer Reference

`index.html` imports all JS modules as inline `<script>` tags — no bundler or module system.

| Module | Responsibility |
|---|---|
| `app-core.js` | Bridge detection (`IS_NATIVE`), `loadNativeData()` boot sequence, shared utilities |
| `app-home.js` | Goal arc SVG, quick stats bar, week chart strip, insight banner, focus/mindful strip |
| `app-home-score.js` | Aurelo Score card, pillar tiles, Body Score detail sheet |
| `app-wellness.js` | Donut chart, top apps list, today view, date range selector |
| `app-wellness-views.js` | Hourly bars, week view, month heatmap, App DNA panel |
| `app-focus.js` | Focus session start/stop, orbit animation, difficulty levels |
| `app-focus-score.js` | Focus Score breakdown (sessions, timers, mindful pauses) |
| `app-focus-bedtime.js` | Bedtime Mode settings, Sleep Score display |
| `app-focus-timers.js` | App Timers, soft block UI, ignore count |
| `app-focus-mindful.js` | Mindful Pause prompt overlay |
| `app-focus-routine.js` | Focus Schedule creation and management |
| `app-focus-schedule-patch.js` | `_secsUntilRoutine()`, `_routineActiveStatus()`, alarm coordination |
| `app-screen-filter.js` | Screen Filter toggle, intensity slider, colour presets |
| `app-health-connect.js` | HC connection flow, permissions, Body Score detail sheet |
| `app-score-history.js` | Score History line chart, pillar toggles, personal best, mood overlay |
| `app-coach.js` | Coach modal chat, intent chips, category tabs, transparency panel |
| `app-coach-home.js` | Coach Insight Card on Home tab, dismiss/reset logic |
| `app-wellness-coach.js` | Coach cards in Wellness Today, Week, Month views |
| `app-mood.js` | Mood picker, contextual tags, note field, morning prompt logic *(New v2.1)* |
| `app-quiet-hours.js` | Quiet Hours time window, day picker, presets, active state controls *(New v2.1)* |
| `app-notifications.js` | In-app notification panel, read/unread state |
| `app-notif-sheet.js` | Notification detail bottom sheets (coach, streak, success, goal, recap) *(New v2.1)* |
| `app-weekly-recap.js` | Weekly Recap sheet, score ring, bar chart, top apps, Coach one-liner *(New v2.1)* |
| `app-referral.js` | Referral code display, share card, reward tracking |
| `app-categories.js` | Category management, App Lock, Hidden Apps |
| `app-panels.js` | App management panels |
| `app-settings.js` | Settings screen, theme picker, data reset, widget config, sound cues toggle |
| `app-discover.js` | Discover tab, habit-based recommendations, affiliate disclosure |
| `app-share.js` | Share card canvas rendering |
| `app-share-utils.js` | Shared canvas utilities |
| `app-nav.js` | Tab switching, deep-link routing |
| `app-onboarding.js` | First-run permission walkthrough, Mood Check-In step |
| `app-widget.js` | Widget settings: slots, theme, learning history, storage stats |
| `pro-gate.js` | `isPro()` check, feature gating, Pro status sync |
| `pro-upsell.js` | Upsell sheet UI, plan cards, billing flow initiation |

### Bridge access pattern

```javascript
const IS_NATIVE = typeof window.AppBridge !== 'undefined';
const N = window.AppBridge;  // short alias

// Guarded call
if (IS_NATIVE && typeof N.getFocusSessionState === 'function') {
    const state = JSON.parse(N.getFocusSessionState() || 'null');
}
```

### Native → JS callbacks

| Callback | Fired by | Purpose |
|---|---|---|
| `window.onScanComplete()` | `preScan()` | App list ready, trigger full render |
| `window.onBgScanComplete()` | `bgExecutor` 10 s tick | Refresh stats displays |
| `window.onAppResume()` | `MainActivity.onResume()` | Reconcile session state, handle pending permission grants |
| `window.onProStatusChanged(isPro)` | `BillingManager` | Update Pro gate |
| `window.onSecureStorageUnavailable()` | `AppBridge.securePrefs` init | Show persistent warning banner |
| `window.onRoutineTriggered(json)` | `RoutineAlarmReceiver` | Start scheduled focus session |
| `window.onAppsChanged(action, pkg)` | `packageReceiver` | Re-render after install/uninstall |
| `window.onPlaySyncComplete(count)` | `startPlaySync()` | Update categorisation UI |

---

## 9. Data Storage

All data stored on-device. Nothing sent to external servers.

| Store | File | Encryption | Contents |
|---|---|---|---|
| `securePrefs` | `tidyapp_secure_v1` | AES-256-GCM (Keystore) | Locked/hidden apps, limits, settings, Pro status, focus routines, bedtime/quiet hours settings, onboarding, coach dismiss, mood entries, sound cues toggle |
| `prefs` | `tidyapp_v6` | None | Usage caches, streak, daily history, widget config, scan timestamps |
| `nativePrefs` | (native SharedPreferences) | None | Smart Alerts toggle, coach insight dismiss state, Pro grace period timestamp, weekly recap banner dismiss (keyed per ISO week), mood prompt dismissed date, quiet hours active/paused state |
| `catCache` | `tidyapp_cat_cache_v1` | None | App category results from Play Store scraping |
| `LaunchTracker DB` | `tidyapp_launches.db` | SQLCipher AES-256 | App launch history (Smart Routine ML), Score History (all 5 pillars, 30/90 days), Notification History (30-day rolling log) |
| `LaunchTracker key` | `tidyapp_launch_key_v1` | AES-256-GCM (Keystore) | 32-byte random SQLCipher passphrase |

> **Why two SharedPreferences stores?** `securePrefs` (encrypted) holds sensitive data. `nativePrefs` (unencrypted) holds settings that must survive WebView cache clears — the dismiss states for coach cards, weekly recap, and mood prompts are stored here intentionally so clearing WebView cache does not reset them.

### Encryption fallback

If the Android Keystore is inaccessible:
- `_secureStorageAvailable = false`; `window.onSecureStorageUnavailable()` fires in JS
- `setLockedApps()` and `setHiddenApps()` become no-ops
- `LaunchTracker` uses an `ANDROID_ID`-derived passphrase

### Data reset

| Method | Clears |
|---|---|
| `clearAllData()` | `prefs`, `securePrefs`, `catCache`, `LaunchTracker` DB. Also stops: ScreenFilterService, Focus sessions, Bedtime alarms, Quiet Hours alarms |
| `clearAllDataFull()` | All of the above + `onboarding_done` — user re-enters setup flow |

> **Note:** HC connection state is not wiped by `clearAllData()`. Revoke HC permissions manually from Android Settings → Health Connect → App permissions → Aurelo if needed.

---

## 10. Billing & Subscriptions

Google Play Billing Library 7.1.1. All payment processing is handled by Google — no card or payment data passes through the app.

### Product IDs

| Play Console product ID | Type | Plan |
|---|---|---|
| `tidyapp_pro` | SUBS | Base plan `monthly` + offer `monthly-7day-trial` |
| `tidyapp_pro` | SUBS | Base plan `annual` + offer `annual-7day-trial` |
| `tidyapp_pro_lifetime` | INAPP | One-time lifetime purchase |

### Purchase flow

1. JS calls `N.launchBillingFlow(planKey)` where `planKey` is `"monthly"`, `"annual"`, or `"lifetime"`
2. `BillingManager` resolves the product and offer token, launches the Play billing sheet
3. On `PURCHASED` state (not `PENDING`), `PurchaseVerifier` validates the RSA signature, then `EntitlementRepository.setProStatus(true)` is called
4. `window.onProStatusChanged(true)` fires in JS; `pro-gate.js` unlocks Pro features immediately — no restart required

Pro status is re-verified on every cold start via `BillingManager.queryExistingPurchases()`. `PENDING` purchases do **not** grant access.

### Grace period

A **72-hour grace period** is applied before downgrading on subscription lapse. `onProStatusChanged(false)` is suppressed for 72 hours after the last confirmed Pro status. At exactly 72h+1ms, downgrade cleanup fires and `ReferralManager.activateExtensionOnLapse()` is called if the user has earned referral extension days.

---

## 11. Background Work

### `bgExecutor` — foreground only

`ScheduledExecutorService`, 10-second interval. Calls `bridge.refreshUsageStats()` → incremental `UsageStatsManager.queryEvents(lastScanTs, now)`. Paused in `onPause()`, restarted in `onResume()`. `RefreshCoordinator` enforces a minimum 8-second gap between upstream processing calls.

### `SmartNotificationWorker` (WorkManager, periodic ~8 PM daily)

Reads cached usage stats, fires personalised notifications:
- Over-goal warning (Free + Pro)
- High pickup frequency alert (Free + Pro)
- Streak-at-risk warning — fires 2–7 PM when on track to exceed goal with active streak (Pro only)
- Personal best celebration (Pro only)
- Evening recap notification (Free + Pro)
- Weekly Recap notification — fires Sundays for Pro users (New v2.1)

All posted notifications are written to the 30-day `NotificationHistory` log in `LaunchTracker` DB. **Deduplication guard:** `lastRecapDate` check prevents the daily recap firing twice if `doWork()` is called more than once in the same calendar day (SN-022).

### `CoachInsightWorker` (WorkManager, nightly)

Pre-computes the next day's Coach Insight Card for the Home tab. Dismissed state stored in `nativePrefs` — survives WebView cache clears. Resets at midnight. Feature vector now includes mood signals from `MoodBridge`.

### `AureloWidgetUpdateWorker` (WorkManager, ~15 min)

Calls `AureloWidgetProvider.pushUpdate()` to refresh widget data. `RefreshCoordinator` enforces a minimum 60-second gap between widget cache refreshes. During Doze mode, intervals stretch — staleness indicator colours: grey (<30 min), amber (30–60 min), red (>60 min).

### `RoutineAlarmReceiver` (AlarmManager exact alarms)

Focus Schedule triggers using `AlarmManager.setExactAndAllowWhileIdle()`. Re-scheduled via `BootReceiver` on `BOOT_COMPLETED`. Alarm deduplication prevents duplicate alarms on rapid routine toggle.

### `BedTimeReceiver` (AlarmManager exact alarms)

Bedtime start alarm: activates brightness reduction, DND (via `DndController` with `DND_OWNER_BEDTIME`), app blocking, Screen Filter auto-activation. Wake-up alarm: deactivates all of the above and plays the `MORNING` sound cue. Re-scheduled after reboot. Rapid toggle race condition guard prevents duplicate alarms (BM-044).

### `QuietHoursReceiver` (AlarmManager exact alarms) *(New in v2.1.0)*

Engages and releases DND via `DndController` with `DND_OWNER_QUIET_HOURS` token. Free feature. If Quiet Hours is enabled while already inside the configured window, DND engages immediately without waiting for the next alarm cycle. Re-scheduled after reboot via `BootReceiver`.

### `ReferralExtensionWorker` (WorkManager)

Grants Pro extension days to a referrer on successful referral redemption. Also triggered by `activateExtensionOnLapse()` during the billing grace period expiry flow.

---

## 12. Home Screen Widget

4×2 cell `AppWidgetProvider`. Updated by both the OS `updatePeriodMillis` interval and `AureloWidgetUpdateWorker`.

### Smart Routine ML

`LaunchTracker` records every app open (fed from the 10 s `UsageEvents` scan) by time slot and day-of-week. Top apps for the current slot are scored via exponential decay:

```
score(app) = Σ  0.95 ^ daysAgo   for each launch in last 60 days
```

After data accumulates, the highest-scoring apps for the current time slot appear in the widget. Frequency rings (low / mid / high) reflect Laplace-smoothed open probability per app slot.

### Themes

| Theme | Availability | Accent colours |
|---|---|---|
| Default dark | Free | Cyan, Amber, Purple |
| AMOLED / premium | Pro | Cyan, Amber, Purple |

### Staleness indicator

"Updated X min ago" sourced from `cached_usage_ts`. Colour thresholds: grey (<30 min), amber (30–60 min), red (>60 min).

### Widget preview

`tidy_widget_info.xml` references `@drawable/widget_preview` (dark-panel placeholder) and `@layout/widget_tidy` (live preview on API 31+). Replace `res/drawable/widget_preview.xml` with a real device screenshot before Play Store submission.

---

## 13. Security Model

### Protected at rest

| Data | Protection mechanism |
|---|---|
| Locked/hidden app lists, per-app limits | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |
| Focus routines (schedule + blocked apps) | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |
| App launch history, Score History, Notification History | SQLCipher AES-256, Keystore-stored random passphrase |
| Mood entries | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |
| Pro entitlement flag | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |
| Bedtime, Quiet Hours, Screen Filter settings | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |

### Not encrypted (not sensitive)

Usage cache totals, hourly breakdowns, streak counts, widget config, last-scan timestamps, notification dismiss states — aggregated values with no personally identifying content.

### Rooted device behaviour

- Keystore unavailable → `_secureStorageAvailable = false`
- `setLockedApps()` / `setHiddenApps()` become no-ops; JS shows warning banner
- `LaunchTracker` uses `ANDROID_ID`-derived fallback passphrase

### WebView hardening

- `allowFileAccess = false` — JS cannot read device files via `file://`
- `mixedContentMode = NEVER_ALLOW` — no HTTP sub-resources
- `textZoom = 100` — immune to accessibility font-scale layout breaks
- Content Security Policy `<meta>` in `index.html` restricts inline scripts and external connections
- `SecurityValidators.kt` enforces asset path allowlist, URL allowlist, and `SharedPreferences` key allowlist at the bridge layer

### Referral security

`ReferralManager` enforces three guards:
- **Self-referral:** `incomingCode == myCode` → rejected
- **Monthly rate limit:** max 3 successful installs per calendar month
- **Verifier prefix:** all codes require a valid 2-char HMAC prefix — arbitrary 8-char strings do not grant days

### Privacy guarantees

- Zero outbound network traffic except Google Play Billing
- Health Connect data never leaves the device — all processing on-device
- Aurelo Coach responses generated entirely on-device via ONNX runtime
- App icons fetched via `PackageManager` on-device — never downloaded from servers
- Sound Cues generated procedurally on-device — no audio files downloaded
- Screen Filter overlay excluded from screenshot capture

---

## 14. Dependencies

| Library | Version | Purpose |
|---|---|---|
| `androidx.appcompat` | 1.7.1 | Activity, theme compat |
| `androidx.webkit` | 1.15.0 | `WebViewCompat` |
| `androidx.core:core-ktx` | 1.17.0 | Kotlin extensions |
| `androidx.lifecycle:lifecycle-runtime-ktx` | 2.7.0 | `lifecycleScope` |
| `androidx.work:work-runtime-ktx` | 2.9.1 | Background workers (WorkManager) |
| `androidx.startup:startup-runtime` | 1.1.1 | WorkManager initialisation |
| `androidx.security:security-crypto` | 1.1.0-alpha06 | `EncryptedSharedPreferences`, `MasterKey` |
| `androidx.sqlite:sqlite` | 2.4.0 | SQLCipher integration |
| `net.zetetic:android-database-sqlcipher` | 4.5.4 | Encrypted SQLite (LaunchTracker) |
| `com.android.billingclient:billing-ktx` | 7.1.1 | Google Play Billing |
| `com.google.android.material` | 1.13.0 | Material components |
| `kotlinx-coroutines-android` | 1.7.3 | Coroutines, `Dispatchers.IO` |
| `org.jsoup:jsoup` | 1.15.4 | HTML parsing for Play Store scraping |
| `io.github.kdroidfilter:gplayscrapper` | 0.1.6 | Play Store category scraping |
| `com.google.http-client:google-http-client` | 2.1.0 | HTTP transport for gplayscrapper |
| `joda-time:joda-time` | 2.14.1 | Date/time utilities |
| `org.joda:joda-convert` | 2.2.2 | Joda-time string conversion |
| `com.microsoft.onnxruntime:onnxruntime-android` | 1.25.0 | On-device ONNX inference (Aurelo Coach ML model ~924 KB) |
| `androidx.health.connect:connect-client` | 1.2.0-alpha04 | Health Connect read access (Steps, Sleep, HRV, RHR, Mindfulness) |

---

## 15. Troubleshooting

**Gradle sync fails**
```
File → Invalidate Caches → Restart
Ensure JDK 17: File → Project Structure → SDK Location → Gradle JDK
```

**`local.properties` missing signing config**
```
Add RELEASE_STORE_FILE, RELEASE_STORE_PASSWORD,
RELEASE_KEY_ALIAS, RELEASE_KEY_PASSWORD — see Section 5.
```

**Bridge methods missing on release build (NoSuchMethodError)**
```
ProGuard is stripping @JavascriptInterface methods.
Ensure proguard-rules.pro contains:
-keep class *Bridge* { @android.webkit.JavascriptInterface *; }
This is critical for every bridge class.
```

**Usage stats return zeros after granting permission**
```
Force-stop Aurelo and reopen — UsageStatsManager only
registers the permission after the app process restarts.
```

**Focus mode overlay not appearing**
```
Settings → Apps → Aurelo → Display over other apps → ON
Confirm AppMonitorService is listed under Developer Options → Running services.
```

**Screen Filter does not activate**
```
Same SYSTEM_ALERT_WINDOW permission as focus overlay.
Settings → Apps → Aurelo → Display over other apps → ON
If toggled rapidly, check that only one ScreenFilterService instance is running.
```

**Health Connect not connecting on Android 9–13**
```
Health Connect app must be installed separately from the Play Store.
On Android 14+, it is pre-installed. Aurelo automatically redirects
to the Play Store listing on older devices.
```

**Coach not responding / ONNX error in logcat**
```
Ensure aurelo_coach.onnx (~924 KB) and aurelo_coach_tree.json are present
in assets/. Check logcat for OnnxRuntimeException on first Coach open.
On devices with <1 GB RAM, watch for OutOfMemoryError during model load.
```

**Quiet Hours DND not activating**
```
Settings → Notifications → Do Not Disturb access → Aurelo → ON
Same permission as Bedtime Mode DND. If both are configured,
DndController ensures they coexist — enabling one while the other
is active does not cancel the other.
```

**Mood morning prompt not appearing**
```
Prompt fires on first Home tab activation between 7 AM and 11 AM
if no mood has been logged today. Confirm the Mood Check-In toggle
in Settings is ON and the device time is within the 7–11 AM window.
```

**Widget shows no apps ("Learning…")**
```
LaunchTracker needs ≥1 day of data. Grant Usage Access so the
10 s bgExecutor scan can feed events into LaunchTracker.
```

**"Encrypted storage unavailable" warning in app**
```
The Android Keystore is inaccessible on this device (common on rooted
devices or custom ROMs). Locked Apps and Hidden Apps are disabled.
All other features continue normally.
```

**Routine / Bedtime / Quiet Hours alarms not firing after reboot**
```
Settings → Apps → Special app access → Alarms & Reminders → Aurelo → ON
BootReceiver reschedules all active alarms on BOOT_COMPLETED.
```

**SQLCipher `UnsatisfiedLinkError` at runtime**
```
SQLiteDatabase.loadLibs(context) must be called before any
net.sqlcipher.database operation. LaunchTracker.openEncryptedDb()
does this. If you add a new code path that opens the DB directly,
call loadLibs() first.
```

**Duplicate class build error**
```groovy
configurations.all {
    resolutionStrategy.force 'androidx.core:core-ktx:1.17.0'
}
```

---

## 16. Changelog

### v2.1.0 (current)

**New Features**

- **Quiet Hours** — lightweight scheduled Do Not Disturb with configurable time window, day-of-week picker, overnight window support, and four quick presets (Work, Evening, Night, Focus). Free feature. Active-state controls: End now, Pause 30 min. `QuietHoursBridge.kt` + `QuietHoursReceiver.kt`.
- **Sound Cues** — 8 procedurally-synthesised tones for key app moments (SESSION_START, SESSION_COMPLETE, BEDTIME_START, MORNING, MINDFUL_PAUSE, UNLOCK, STREAK_MILESTONE, MOOD_LOGGED). Zero APK audio assets — all generated in `SoundEffects.kt`. Toggleable in Settings. Free feature.
- **Daily Mood Check-In** — morning mood logging with 5-point emoji scale (Rough → Great), contextual tags, optional text note, haptic feedback, and MOOD_LOGGED sound cue. Triggered automatically 7–11 AM. Mood history > 7 days is PRO. `MoodBridge.kt` + `app-mood.js`.
- **Notification History** — persistent 30-day rolling notification log with read/unread state tracking, unread count badge, and in-app history panel. `NotificationBridge.kt`.
- **Notification Detail Sheets** — tailored bottom sheets for each notification type: Coach (full insight + Ask follow-up CTA), Streak (at-risk vs milestone), Success/Personal Best (trophy + share), Goal, Recap. `app-notif-sheet.js`.
- **Weekly Recap Sheet** — "Your Week in Apps" bottom sheet with animated Aurelo Score ring, 7-day screen time bar chart, top 3 apps, stats pills, and rule-based Coach one-liner. Auto-shown to Pro users each Sunday. `WeeklyRecapBridge.kt` + `app-weekly-recap.js`. [PRO]
- **Weekly Recap Notification** — fires Sundays for Pro users via `SmartNotificationWorker`.

**Improvements**

- `DndController.kt` — ownership token model (`DND_OWNER_BEDTIME`, `DND_OWNER_QUIET_HOURS`) allows Bedtime Mode and Quiet Hours to coexist without DND conflicts
- `RefreshCoordinator.kt` — throttles usage refresh (min 8 s) and widget cache refresh (min 60 s) to reduce redundant processing
- Score History — mood emoji overlay dots on chart when Mood Check-In data is available [PRO]
- `BodyScoreCalculator.kt` — updated weights (Steps 40%, HRV 35%, RHR 25%); partial signal re-normalisation; percentage-based RHR ceiling (not flat +20 bpm)
- `SleepScoreEnhancer.kt` — HC overnight HRV floor raised to 70% of personal average (was 60%)
- `ScreenScoreEnhancer.kt` — linear gradient from 0 to -3 pts over 2,000–4,999 steps range (no cliff at 2,000); new +3 active day bonus tier at ≥8,000 steps
- Bedtime Mode morning summary notification paired with MORNING sound cue
- App Lock unlock confirmation paired with UNLOCK sound cue
- Mindful Pause trigger paired with MINDFUL_PAUSE sound cue
- Streak milestone notifications (3/7/14/30-day) paired with STREAK_MILESTONE sound cue
- Focus session start paired with SESSION_START cue; completion with SESSION_COMPLETE cue
- Discover tab — affiliate link disclosure banner above recommendations and per-card "Affiliate link" label

**Bug Fixes**

- `H7 FIX` — Missing keys in `SecurityValidators` allowlist caused `coach_home_card`, `bedtime_display`, `widget_settings`, and `smart_alerts` reads to silently return empty strings
- `Bug-1 FIX` — `body_score_history` key missing from allowlist caused `saveScoreForToday()` writes to be silently dropped
- Mood onboarding — `_obMoodId` declared with `let` (not in `window` scope); cross-module sync now uses `S.onboardingMood` as the reliable channel
- Mood morning prompt — `checkMorningPrompt()` now re-fires on tab activation and `visibilitychange`, not only on initial Home render
- Mood history gate — free-tier gate now filters by calendar-day cutoff (not entry count) so sparse loggers cannot receive older data through the 7-day window
- `ScreenFilterEngine.start()` — `WindowManager.addView()` now always dispatched to main thread to prevent `CalledFromWrongThreadException`
- `ScreenFilterEngine.suspend()` / `resumeFilter()` — fade state continuity maintained after pause/resume; does not restart from 0% or jump to 100%
- `QuietHoursReceiver` — enabling Quiet Hours while inside the configured window now engages DND immediately
- Bedtime toggle race condition — rapid ON/OFF cycling no longer schedules duplicate alarms (`BedtimeBridge` alarm deduplication)
- `SmartNotificationWorker` — daily recap deduplication guard prevents double-fire when `doWork()` called twice in the same calendar day

---

### v2.0.0

**New Features**

- **Screen Filter** — system-wide colour temperature overlay (10–90% opacity, Warm/Night/Custom presets) with Quick Settings tile, foreground service, and Bedtime Mode auto-activation. `ScreenFilterEngine.kt`.
- **Score History** — 30/90-day line chart showing all 5 score pillars, pillar toggles, personal best star badge, tap-to-drill-down. Stored in `LaunchTracker` SQLCipher DB. [PRO]
- **App Overview Sheet** — unified bottom sheet on Home tab showing all apps configured across every feature with colour-coded badges.
- **Refer a Friend** — redesigned referral programme with unique codes, reward tracking, self-referral guard, monthly rate limit (3 installs/month), and verifier prefix on codes.
- **Aurelo Coach** — on-device AI assistant powered by ONNX Runtime (~924 KB model). Intent classification with 20+ patterns, proactive detection, Home Insight Card, Wellness Coach cards. Fully on-device, works in airplane mode. [PRO]
- **Health Connect Integration** — Body Score, Sleep Score HC enhancement, Screen Score activity modifier, Focus mindfulness sessions. Read-only. Never writes to HC. [PRO]

**Bug Fixes**

- App Lock PIN overlay dismiss fixed on Samsung, OnePlus, and other OEM devices (`AM-006`)
- Sleep Score reset on Bedtime Mode toggle off → on fixed (`BM-019`)
- Widget Doze-mode staleness indicator fixed (`WG-014`)

---

### v1.2.0

**Security**

- `SEC-06` — Encryption fallback now disables `setLockedApps()` / `setHiddenApps()` when the Keystore is unavailable
- `SEC-08` — Focus routines no longer written to a plaintext `SharedPreferences` mirror
- `SEC-09` — `LaunchTracker` database migrated from unencrypted SQLite to SQLCipher AES-256

**Functional**

- `FUN-05` — `clearAllData()` now wipes all stores: `prefs`, `securePrefs`, `catCache`, and `LaunchTracker` DB
- `FUN-07` — `_syncSessionState()` called at the top of `onAppResume`, resolving stuck focus session UI after OS process kill
- `FUN-08` — `_secsUntilRoutine()` return values clamped to `Math.max(1, ...)` to prevent zero/negative returns at midnight
- `FUN-09` — Widget staleness indicator added (grey < 30 min, amber 30–60 min, red > 60 min)

**Performance**

- `PERF-01` — `GlobalScope` in `startPlaySync()` replaced with lifecycle-scoped `bridgeScope`
- `PERF-02` — Raw `thread {}` blocks replaced with `bridge.bridgeScope.launch(Dispatchers.IO)`

**UI**

- `UI-03` — Widget picker now shows a dark-panel preview drawable with API 31+ live preview support

---

### v1.1.0

- Initial public release