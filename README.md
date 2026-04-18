# Aurelo — Android Build & Developer Guide

**Version 1.2.0** · `com.javikastudio.tidyapp` · Android 8.0+ (API 26–36)

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
┌─────────────────────────────────────────────────────────┐
│                     WebView UI Layer                     │
│  index.html + app.css + 14 JS modules (≈14,500 lines)   │
│  Tabs: Home · Wellness · Focus · Apps · Discover        │
└────────────────────┬────────────────────────────────────┘
                     │  window.AppBridge  (168 @JavascriptInterface methods)
┌────────────────────▼────────────────────────────────────┐
│              AppBridge.kt  (Kotlin native layer)        │
│  UsageStatsManager · PackageManager · AlarmManager      │
│  WindowManager overlays · EncryptedSharedPreferences    │
│  SQLCipher (LaunchTracker) · Google Play Billing        │
└─────────────────────────────────────────────────────────┘
```

The WebView is loaded from `assets/www/index.html` — a bundled asset, never a remote URL. JavaScript calls native methods via `window.AppBridge` (or `window.N` as a short alias). The bridge exposes 168 `@JavascriptInterface` methods covering every feature area.

When running in a browser (no bridge present), all JS modules fall back to demo/stub data so the UI can be previewed without a device.

---

## 2. Project Structure

```
Aurelo/
├── app/
│   ├── build.gradle                          # Dependencies, signing config
│   ├── proguard-rules.pro                    # R8 keep rules inc. SQLCipher
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/
│       │   ├── pkg_db.json                   # 869 KB offline app category DB (~85-90% coverage)
│       │   └── www/
│       │       ├── index.html                # Single-page app shell
│       │       ├── css/app.css               # All UI styles
│       │       ├── affiliate_links.json      # Discover tab app recommendations
│       │       ├── pro-gate.js               # Pro feature gating logic
│       │       ├── pro-upsell.js             # Upsell sheet UI
│       │       └── js/
│       │           ├── app-core.js           # Init, bridge utils, shared helpers
│       │           ├── app-home.js           # Home dashboard, goal arc, insight banner
│       │           ├── app-wellness.js       # Screen time charts, donut, week/month views
│       │           ├── app-wellness-views.js # Wellness sub-views (hourly, top apps, month)
│       │           ├── app-focus.js          # Focus sessions, timers, mindful pause, bedtime
│       │           ├── app-focus-schedule-patch.js  # Routine scheduling engine
│       │           ├── app-panels.js         # Locked/hidden apps, category panels
│       │           ├── app-settings.js       # Settings screen, data management
│       │           ├── app-discover.js       # Discover tab, app recommendations
│       │           ├── app-share.js          # Share card generation (streak, weekly, referral)
│       │           ├── app-nav.js            # Tab navigation, deep-link routing
│       │           ├── app-notifications.js  # In-app notification panel
│       │           ├── app-onboarding.js     # First-run setup flow
│       │           └── app-widget.js         # Widget settings screen
│       ├── java/com/javikastudio/tidyapp/
│       │   ├── MainActivity.kt               # Activity host, WebView setup, lifecycle
│       │   ├── AppBridge.kt                  # All @JavascriptInterface methods (168 total)
│       │   ├── AppCategorizer.kt             # 5-layer app categorisation engine
│       │   ├── AppMonitorService.kt          # Foreground service: focus blocking, overlays
│       │   ├── LaunchTracker.kt              # SQLCipher DB: per-app launch history for widget ML
│       │   ├── AureloWidgetProvider.kt         # AppWidgetProvider: widget rendering
│       │   ├── AureloWidgetUpdateWorker.kt     # WorkManager: periodic widget refresh
│       │   ├── SmartNotificationWorker.kt    # WorkManager: intelligent usage notifications
│       │   ├── RoutineAlarmReceiver.kt       # AlarmManager: scheduled focus routines
│       │   ├── BedTimeReceiver.kt            # AlarmManager: bedtime mode alarms
│       │   ├── BootReceiver.kt               # BOOT_COMPLETED: reschedule bedtime alarms
│       │   ├── Categories.kt                 # Category constants + migration helpers
│       │   ├── PlayStoreFetcher.kt           # jsoup/gplayscrapper: Play Store categorisation
│       │   ├── WidgetThemeManager.kt         # Widget theme resolution
│       │   └── billing/
│       │       ├── BillingManager.kt         # Google Play Billing Library 7.1.1
│       │       ├── EntitlementRepository.kt  # Pro status cache (EncryptedSharedPreferences)
│       │       ├── PurchaseVerifier.kt       # Client-side RSA signature verification
│       │       └── PurchaseRestoreHandler.kt # Restore previous purchases
│       └── res/
│           ├── layout/widget_tidy.xml        # Home screen widget layout (4×2 cells)
│           ├── xml/
│           │   ├── tidy_widget_info.xml      # Widget metadata + preview
│           │   └── accessibility_service_config.xml
│           ├── drawable/
│           │   ├── widget_preview.xml        # Widget picker preview (replace with screenshot for release)
│           │   └── widget_dot_*.xml          # Animated dot drawables (9 variants: 3 states × 3 colours)
│           └── values/
│               ├── strings.xml · colors.xml · styles.xml
├── build.gradle
├── settings.gradle
├── gradle.properties
└── local.properties                          # SDK path + signing secrets — NOT in VCS
```

---

## 3. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Android Studio | Hedgehog (2023.1.1)+ | Ladybug or newer recommended |
| JDK | 17 | Bundled with Android Studio |
| Android SDK | API 26–36 | Install via SDK Manager |
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

1. Enable **Developer Options** on your phone: Settings → About Phone → tap Build Number 7 times
2. Enable **USB Debugging**: Settings → Developer Options → USB Debugging ON
3. Connect via USB and accept the prompt

```bash
./gradlew installDebug
# or click ▶ Run in Android Studio
```

### Debug build (emulator)

Use an emulator with **Google Play** (not plain AOSP) so `UsageStatsManager` and Play Billing return real data. API 26+ image required.

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

### 4. Widget preview image (before Play Store submission)

Replace `res/drawable/widget_preview.xml` with a pixel-accurate screenshot of the widget at 4×2 cells captured on a real device:

```
res/drawable/widget_preview.webp   (~284×148 dp at mdpi)
```

The `android:previewLayout="@layout/widget_tidy"` in `tidy_widget_info.xml` provides a live dynamic preview on API 31+ regardless, so the static image only matters for API 26–30.

---

## 6. Permissions

| Permission | Grant path | Required for |
|---|---|---|
| `PACKAGE_USAGE_STATS` | Settings → Apps → Special app access → Usage access | Screen time charts, top apps, ghost detection, app timers, widget stats |
| `SYSTEM_ALERT_WINDOW` | Settings → Apps → Aurelo → Display over other apps | Focus mode overlay, app lock overlay, mindful pause screen |
| `ACCESS_NOTIFICATION_POLICY` | Settings → Notifications → Do Not Disturb access | Bedtime Mode DND |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Settings → Apps → Alarms & Reminders (API 31+) | Focus routines, bedtime alarms |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Prompted in-app | Widget and notification reliability |
| `POST_NOTIFICATIONS` | System prompt (Android 13+) | Smart notifications, focus session alerts |
| `QUERY_ALL_PACKAGES` | Automatic (declared in manifest) | Full app list, ghost app detection |

All permissions are optional at install — features degrade gracefully when denied.

---

## 7. Native Layer Reference

### `MainActivity.kt`

Activity host. Responsibilities:
- Creates `WebView`, registers `AppBridge` as `addJavascriptInterface(bridge, "AppBridge")`
- Manages `bgExecutor` (`ScheduledExecutorService`) — calls `bridge.refreshUsageStats()` every 10 seconds while foregrounded; **paused in `onPause()`, restarted in `onResume()`**
- Handles widget and notification deep-links via `onNewIntent()`
- Registers `packageReceiver` for `ACTION_PACKAGE_ADDED/REPLACED/REMOVED` — triggers `bridge.preScan()` via `bridge.bridgeScope` (lifecycle-safe, no raw threads)
- Implements `onTrimMemory()` — clears WebView cache when OS signals `TRIM_MEMORY_RUNNING_CRITICAL`

### `AppBridge.kt`

The complete native API surface — 168 `@JavascriptInterface` methods:

| Group | Key methods |
|---|---|
| App scanning | `preScan`, `getCachedApps`, `refreshApps` |
| Usage stats | `refreshUsageStats`, `refreshUsageData`, `getTotalScreenTimeToday`, `getDailyUsageStats`, `getWeeklyBreakdown`, `getMonthlyBreakdown` |
| Focus sessions | `startFocusSession`, `endFocusSession`, `getFocusSessionState`, `getFocusRoutines`, `saveFocusRoutines` |
| App management | `getLockedApps`, `setLockedApps`*, `getHiddenApps`, `setHiddenApps`* |
| App timers | `getAppLimits`, `setAppLimit`, `removeAppLimit` |
| Categories | `getCategoryOverrides`, `saveCategoryOverrides`, `getAppCategoryMap`, `saveAppCategoryMap` |
| Settings | `getSettings`, `saveSettings`, `isOnboardingDone`, `setOnboardingDone` |
| Billing | `launchBillingFlow`, `restorePurchases`, `getProStatus` |
| Data reset | `clearAllData`, `clearAllDataFull` |
| Security | `isSecureStorageAvailable` |
| Utilities | `openUrl`, `openPlayStore`, `uninstallApp`, `shareText`, `getAppVersion` |

\* `setLockedApps()` and `setHiddenApps()` are no-ops when `isSecureStorageAvailable()` returns `false`.

**Key internal patterns:**

`bridgeScope` — `CoroutineScope(SupervisorJob() + Dispatchers.Main)`, `internal` visibility so `MainActivity` can use it. Cancelled in `destroy()` called from `MainActivity.onDestroy()`. All async work runs here — no `GlobalScope`, no raw `Thread`.

`securePrefs` — Lazy `EncryptedSharedPreferences` (AES256-GCM, Android Keystore). On failure, falls back to plaintext and sets `_secureStorageAvailable = false`. JS is notified via `window.onSecureStorageUnavailable()`.

`catCache` — Plain `SharedPreferences` (`tidyapp_cat_cache_v1`). Intentionally unencrypted — app category strings are not sensitive.

### `AppCategorizer.kt`

5-layer pipeline for assigning a category to each installed app:

1. **`pkg_db.json`** — deterministic lookup, ~85–90% coverage; 869 KB asset, parsed lazily via `by lazy`
2. **Android OS API** — `ApplicationInfo.category` (Play Store-enforced, API 26+)
3. **Finance pre-check** — prevents banking apps being mis-tagged
4. **Keyword scoring** — package name and label matching against category keyword lists
5. **Unassigned** — honest fallback

Play Store scraping (`PlayStoreFetcher.kt`, jsoup + gplayscrapper) is a Pro-only async layer on top, results cached in `catCache`.

### `AppMonitorService.kt`

`ForegroundService` running during active focus sessions. Polls `UsageStatsManager.queryEvents()` on a `Handler` loop to detect blocked app foreground events, then shows a `WindowManager` overlay with the configured difficulty:

- **Gentle** — reminder overlay, dismissible immediately
- **Firm** — 30-second countdown before access
- **Deep** — full block, no bypass

Handles session timer, confetti animation on completion, and `notifyJsSessionEnded()` via `webView.evaluateJavascript()`.

### `LaunchTracker.kt`

SQLCipher-encrypted SQLite database (`tidyapp_launches.db`) storing per-app launch events bucketed into 6 time slots × 7 days-of-week over a 60-day rolling window. Powers the widget's Smart Routine feature.

Passphrase: 32-byte random key generated on first run, stored in `EncryptedSharedPreferences` (`tidyapp_launch_key_v1`). Falls back to an `ANDROID_ID`-derived constant if the Keystore is unavailable.

### `RoutineAlarmReceiver.kt`

`AlarmManager` callbacks for scheduled focus routines. On `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED`, reads routines from `EncryptedSharedPreferences` directly (no plaintext mirror) and re-registers all active alarms. Gracefully skips if the Keystore is unavailable at boot.

---

## 8. JavaScript Layer Reference

`index.html` imports all JS modules as inline `<script>` tags — no bundler or module system.

| Module | Lines | Responsibility |
|---|---|---|
| `app-core.js` | 749 | Bridge detection (`IS_NATIVE`), `loadNativeData()` boot sequence, shared utilities |
| `app-home.js` | 1,670 | Goal arc SVG, quick stats, week chart, insight banner, focus/mindful strip |
| `app-wellness.js` | 1,014 | Donut chart, top apps list, date range selector, Smart Tips |
| `app-wellness-views.js` | 1,059 | Hourly bars, week view, month heatmap, App DNA panel |
| `app-focus.js` | 3,840 | Focus sessions, orbit animation, timers, mindful pause, bedtime mode, weekly challenge |
| `app-focus-schedule-patch.js` | 1,344 | `_secsUntilRoutine()`, `_routineActiveStatus()`, alarm coordination |
| `app-panels.js` | 399 | Locked/hidden apps panel, category management |
| `app-settings.js` | 1,139 | Settings screen, theme picker, data reset, widget config |
| `app-discover.js` | 171 | Habit-based app recommendations with Play Store deep links |
| `app-share.js` | 466 | Canvas-rendered share cards (streak, weekly summary, referral) |
| `app-nav.js` | 335 | Tab switching, deep-link routing |
| `app-notifications.js` | 308 | In-app notification panel |
| `app-onboarding.js` | 172 | First-run permission walkthrough |
| `app-widget.js` | 519 | Widget settings: slots, theme, learning history |
| `pro-gate.js` | 453 | `isPro()` check, feature gating, Pro status sync |
| `pro-upsell.js` | 866 | Upsell sheet UI, plan cards, billing flow initiation |

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
| `securePrefs` | `tidyapp_secure_v1` | AES-256-GCM (Keystore) | Locked/hidden apps, limits, settings, Pro status, focus routines, onboarding state |
| `prefs` | `tidyapp_v6` | None | Usage caches, streak, daily history, widget config, bedtime settings, scan timestamps |
| `catCache` | `tidyapp_cat_cache_v1` | None | App category results from Play Store scraping |
| `LaunchTracker DB` | `tidyapp_launches.db` | SQLCipher AES-256 | Per-app launch events by time slot / day-of-week (60-day window) |
| `LaunchTracker key` | `tidyapp_launch_key_v1` | AES-256-GCM (Keystore) | 32-byte random SQLCipher passphrase |

### Encryption fallback

If the Android Keystore is inaccessible (some rooted devices / custom ROMs):
- `_secureStorageAvailable = false`; `window.onSecureStorageUnavailable()` fires in JS
- `setLockedApps()` and `setHiddenApps()` become no-ops
- Other reads/writes continue via plaintext fallback (`tidyapp_secure_fallback_v1`)
- `LaunchTracker` uses an `ANDROID_ID`-derived passphrase instead of the Keystore key

### Data reset methods

| Method | Clears |
|---|---|
| `clearAllData()` (soft reset) | `prefs`, `securePrefs` (preserves `onboarding_done`), `catCache`, `LaunchTracker` DB |
| `clearAllDataFull()` (factory reset) | All of the above including `onboarding_done` — user re-enters setup flow |

---

## 10. Billing & Subscriptions

Google Play Billing Library 7.1.1. All payment processing is handled by Google.

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
4. `window.onProStatusChanged(true)` fires in JS; `pro-gate.js` unlocks Pro features

Pro status is re-verified on every cold start via `BillingManager.queryExistingPurchases()`. `PENDING` purchases do **not** grant access.

---

## 11. Background Work

### `bgExecutor` — foreground only

`ScheduledExecutorService`, 10-second interval. Calls `bridge.refreshUsageStats()` which does a single incremental `UsageStatsManager.queryEvents(lastScanTs, now)` and updates all usage caches. Paused in `onPause()`, restarted in `onResume()`.

### `SmartNotificationWorker` (WorkManager, periodic)

Reads cached usage stats, fires personalised notifications:
- Over-goal warning (free + Pro)
- High pickup frequency alert (free + Pro)
- Streak-at-risk warning — fires 2–7 PM when on track to exceed goal with an active streak (Pro only)
- Personal best celebration (Pro only)

Controlled by the "Smart Alerts" toggle in Settings.

### `AureloWidgetUpdateWorker` (WorkManager, ~15 min)

Calls `AureloWidgetProvider.pushUpdate()` to refresh widget data. The widget's `android:updatePeriodMillis` is 1,800,000 ms (OS minimum). During Doze mode, intervals stretch — the widget displays a staleness indicator ("Updated X min ago") coloured grey → amber → red as data ages beyond 2 min / 30 min / 60 min respectively.

### `RoutineAlarmReceiver` (AlarmManager exact alarms)

Scheduled focus routines use `AlarmManager.setExactAndAllowWhileIdle()`. On `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`, reads all active routines from `EncryptedSharedPreferences` and reschedules. Requires `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` on API 31+.

### `BedtimeReceiver` + `BootReceiver` (AlarmManager exact alarms)

Three alarms per bedtime schedule: wind-down (30 min before bedtime), bedtime start, and wake-up. `BootReceiver` reschedules these on `BOOT_COMPLETED`.

---

## 12. Home Screen Widget

4×2 cell `AppWidgetProvider`. Updated by both the OS `updatePeriodMillis` interval and `AureloWidgetUpdateWorker`.

### Smart Routine ML

`LaunchTracker` records every app open (fed from the 10 s `UsageEvents` scan) by time slot and day-of-week. Top apps for the current slot are scored via exponential decay:

```
score(app) = Σ  0.95 ^ daysAgo   for each launch in last 60 days
```

After data accumulates, the highest-scoring apps for the current time slot appear in the widget. Frequency rings (low / mid / high) reflect Laplace-smoothed open probability.

### Themes

| Theme | Availability | Accent colours |
|---|---|---|
| Default dark | Free | Cyan, Amber, Purple |
| AMOLED / premium | Pro | Cyan, Amber, Purple |

### Staleness indicator

The bottom of the widget shows "Updated X min ago" sourced from `cached_usage_ts` written by `refreshUsageStats()` after each scan. Colour thresholds: grey (< 30 min), amber (30–60 min), red (> 60 min).

### Widget preview (UI-03)

`tidy_widget_info.xml` references `@drawable/widget_preview` (a dark-panel placeholder) and `@layout/widget_tidy` (live preview on API 31+). Replace `res/drawable/widget_preview.xml` with a real device screenshot before Play Store submission.

---

## 13. Security Model

### Protected at rest

| Data | Protection mechanism |
|---|---|
| Locked/hidden app lists, per-app limits | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |
| Focus routines (schedule + blocked apps) | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |
| App launch history | SQLCipher AES-256, Keystore-stored random passphrase |
| Pro entitlement flag | AES-256-GCM, Android Keystore (`EncryptedSharedPreferences`) |

### Not encrypted (not sensitive)

Usage cache totals, hourly breakdowns, streak counts, widget config, last-scan timestamps — aggregated values with no personally identifying content.

### Rooted device behaviour

- Keystore unavailable → `_secureStorageAvailable = false`
- `setLockedApps()` / `setHiddenApps()` become no-ops; JS shows warning banner
- `LaunchTracker` uses `ANDROID_ID`-derived fallback passphrase

### WebView hardening

- `allowFileAccess = false` — JS cannot read device files via `file://`
- `mixedContentMode = NEVER_ALLOW` — no HTTP sub-resources
- `textZoom = 100` — immune to accessibility font-scale layout breaks
- Content Security Policy `<meta>` in `index.html` restricts inline scripts and external connections

---

## 14. Dependencies

| Library | Version | Purpose |
|---|---|---|
| `androidx.appcompat` | 1.7.1 | Activity, theme compat |
| `androidx.webkit` | 1.15.0 | `WebViewCompat` |
| `androidx.core:core-ktx` | 1.17.0 | Kotlin extensions |
| `androidx.lifecycle:lifecycle-runtime-ktx` | 2.7.0 | `lifecycleScope` |
| `androidx.work:work-runtime-ktx` | 2.9.1 | Background workers |
| `androidx.startup:startup-runtime` | 1.1.1 | WorkManager initialisation |
| `androidx.security:security-crypto` | 1.1.0 | `EncryptedSharedPreferences`, `MasterKey` |
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

**Routine alarms not firing after reboot**
```
Settings → Apps → Special app access → Alarms & Reminders → Aurelo → ON
RoutineAlarmReceiver reschedules all active routines on BOOT_COMPLETED.
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

### v1.2.0 (current)

**Security**
- `SEC-06` — Encryption fallback now disables `setLockedApps()` / `setHiddenApps()` when the Keystore is unavailable, preventing sensitive data from being written to plaintext. `isSecureStorageAvailable()` bridge method exposed to JS.
- `SEC-08` — Focus routines no longer written to a plaintext `SharedPreferences` mirror. `RoutineAlarmReceiver` reads routines directly from `EncryptedSharedPreferences` on boot.
- `SEC-09` — `LaunchTracker` database migrated from unencrypted SQLite to SQLCipher AES-256. Passphrase generated on first run, stored in `EncryptedSharedPreferences`.

**Functional**
- `FUN-05` — `clearAllData()` and `clearAllDataFull()` now wipe all stores: `prefs`, `securePrefs`, `catCache`, and the `LaunchTracker` database.
- `FUN-07` — `_syncSessionState()` called at the top of the `onAppResume` patch, resolving stuck focus session UI caused by OS process kill during an active session.
- `FUN-08` — All return paths of `_secsUntilRoutine()` clamped to `Math.max(1, ...)` to prevent zero/negative return when a routine is scheduled exactly at midnight.
- `FUN-09` — Widget now shows "Updated X min ago" staleness indicator (grey < 30 min, amber 30–60 min, red > 60 min) so users understand when Doze mode has delayed a refresh.

**Performance**
- `PERF-01` — `GlobalScope` in `startPlaySync()` replaced with `bridgeScope` (lifecycle-scoped, cancelled in `onDestroy()`).
- `PERF-02` — Raw `thread {}` blocks in `MainActivity` replaced with `bridge.bridgeScope.launch(Dispatchers.IO)`. Inner `GlobalScope.launch` removed. `runOnUiThread` replaced with `withContext(Dispatchers.Main)`.

**UI**
- `UI-03` — Widget picker now shows a dark-panel preview drawable instead of the app launcher icon. `android:previewLayout="@layout/widget_tidy"` added for API 31+ live preview. Replace `res/drawable/widget_preview.xml` with a real device screenshot before Play Store submission.

### v1.1.0

- Initial public release
