# ════════════════════════════════════════════════════════════════════════════
# Aurelo — ProGuard / R8 rules
# Keep this file in the same directory as build.gradle (app module root).
#
# WHY these rules exist:
#   minifyEnabled=true activates R8 which renames, inlines, and removes classes
#   and methods that it believes are unreferenced from compiled Kotlin/Java code.
#   JavaScript→Kotlin calls go through WebView.addJavascriptInterface() — R8
#   cannot see those call-sites (they live in index.html), so it silently strips
#   every @JavascriptInterface method. The result is a release build that works
#   fine in debug but crashes or silently returns nothing in production.
# ════════════════════════════════════════════════════════════════════════════


# ── 1. AppBridge — primary JS↔Kotlin bridge ──────────────────────────────────
# Registered as "AppBridge" via webView.addJavascriptInterface(bridge, "AppBridge")
# Keep the class name AND all its members so JS can call N.methodName() reliably.
-keep class com.javikastudio.tidyapp.AppBridge {
    public *;
    # Keep all @JavascriptInterface-annotated methods regardless of visibility
    @android.webkit.JavascriptInterface *;
}
# Also keep any inner/companion classes AppBridge might use at runtime
-keep class com.javikastudio.tidyapp.AppBridge$* { *; }


# ── 2. NativeBridge — anonymous inline bridge for direct uninstall ────────────
# Registered as "NativeBridge" via webView.addJavascriptInterface(object : Any() {...}, "NativeBridge")
# Anonymous objects get generated class names; keep by annotation instead.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}


# ── 3. MainActivity — referenced by WebViewClient callbacks ──────────────────
-keep class com.javikastudio.tidyapp.MainActivity {
    public *;
}


# ── 4. WebView infrastructure ─────────────────────────────────────────────────
# Android's own WebView rules are usually included via the Gradle plugin, but
# explicitly keep JavascriptInterface so R8 treats it as an entry-point marker.
-keepattributes JavascriptInterface

# Keep the annotation itself so R8 recognises it during shrinking
-keep @interface android.webkit.JavascriptInterface


# ── 5. JSON (org.json) ───────────────────────────────────────────────────────
# AppBridge uses JSONObject / JSONArray extensively; R8 can inline these away.
-keep class org.json.** { *; }


# ── 7. Kotlin metadata & coroutines ──────────────────────────────────────────
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes SourceFile,LineNumberTable   # preserves stack traces in crash reports
-keepattributes Exceptions

# Kotlin reflection (used by lazy delegates, companion objects, etc.)
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.**


# ── 8. AndroidX / AppCompat ───────────────────────────────────────────────────
-keep class androidx.appcompat.**    { *; }
-keep class androidx.core.**         { *; }
-keep class androidx.webkit.**       { *; }
-dontwarn androidx.**


# ── 9. Notification / BroadcastReceiver ──────────────────────────────────────
# packageReceiver is registered programmatically — keep it.
#-keep class com.javikastudio.tidyapp.** implements android.content.BroadcastReceiver { *; }


# ── 10. Suppress harmless warnings from transitive dependencies ───────────────
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**


# ── 11. Widget classes ────────────────────────────────────────────────────────
# AppWidgetProvider subclass — Android instantiates it by name via the Manifest
# <receiver> entry. R8 must not rename or remove it.
-keep class com.javikastudio.tidyapp.AureloWidgetProvider { *; }

# WidgetTheme enum — referenced by name from SharedPrefs key (WidgetTheme.fromKey).
# Enum values() is called reflectively by Kotlin; keep all enum members.
-keep enum com.javikastudio.tidyapp.WidgetTheme {
    public static **[] values();
    public static ** valueOf(java.lang.String);
    *;
}

# WidgetThemeManager and WidgetUpdater are Kotlin objects accessed from
# AppBridge and AureloWidgetProvider — keep them and all their methods.
-keep class com.javikastudio.tidyapp.WidgetThemeManager { *; }
-keep class com.javikastudio.tidyapp.WidgetUpdater      { *; }

# LaunchTracker singleton + TimeSlot enum — used by AureloWidgetProvider and
# AppBridge @JavascriptInterface methods. R8 would otherwise inline/remove these.
-keep class com.javikastudio.tidyapp.LaunchTracker { *; }
-keep enum  com.javikastudio.tidyapp.TimeSlot {
    public static **[] values();
    public static ** valueOf(java.lang.String);
    *;
}


# ── 12. Scheduled focus mode ─────────────────────────────────────────────────────────
-keep class com.javikastudio.tidyapp.RoutineAlarmReceiver { *; }
-keep class com.javikastudio.tidyapp.WebViewHolder { *; }
-keepclassmembers class com.javikastudio.tidyapp.AppMonitorService {
    public static final java.lang.String ACTION_FOCUS_START;
}
-keep public class * extends android.content.BroadcastReceiver

# WorkManager worker — instantiated by class name at runtime by WorkManager.
# Without this rule the release build silently drops background notifications.
-keep class com.javikastudio.tidyapp.SmartNotificationWorker { *; }

# ── 13. New v1.2.0 engine classes  [OTH-01 FIX] ──────────────────────────────
# These four classes are instantiated by AppMonitorService at runtime via
# direct constructor calls that R8 cannot trace from Kotlin/Java call-sites
# (the service holds them as interface references). Without these rules the
# release build strips the concrete implementations and the service crashes
# silently on first use.
-keep class com.javikastudio.tidyapp.BedtimeBlockingEngine { *; }
-keep class com.javikastudio.tidyapp.FocusBlockingEngine   { *; }
-keep class com.javikastudio.tidyapp.IntentionEngine       { *; }
-keep class com.javikastudio.tidyapp.TimerBlockingEngine   { *; }

# AppWidgetProvider base class — keep so the system can call onUpdate etc.
-keep class android.appwidget.AppWidgetProvider { *; }

# SEC-07: Keep EncryptedSharedPreferences classes from being stripped by R8
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }

# PER-01: Keep WebView @JavascriptInterface methods — R8 would strip them
# since they look unreachable from Kotlin/Java perspective
-keepclassmembers class com.javikastudio.tidyapp.AppBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# proguard-rules.pro

# For WorkManager (and its internal Room database)
# Keep all public methods and fields of WorkManager related classes.
-keep class androidx.work.** { *; }

# Keep specific WorkManager internal classes and their constructors.
# This is crucial for the framework to create instances via reflection.
-keep class * extends androidx.work.ListenableWorker { *; }
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.RxWorker { *; }
-keep class * extends androidx.work.CoroutineWorker { *; }

# Keep WorkManager's internal components, especially the WorkDatabase.
-keep class androidx.work.impl.** { *; }
-keep class androidx.work.impl.WorkDatabase { *; }

# Don't warn about missing classes/members in WorkManager (often related to optional dependencies or reflection).
-dontwarn androidx.work.**
-dontwarn android.database.sqlite.**

# For Room (which WorkManager uses internally)
# Keep Room's internal implementation details
-keep class androidx.room.RoomDatabase {
    <init>(...);
}
-keep class * extends androidx.room.migration.Migration {
    <init>(...);
}
-keep class * implements androidx.room.IMultiInstanceInvalidationService { *; }
-keep class androidx.room.DatabaseConfiguration {
    <init>(...);
}
-keep class androidx.room.CoroutinesRoom {
    <init>();
}
-keep class androidx.room.RxRoom {
    <init>();
}
-keep class androidx.room.SQLiteCopyOpenHelperFactory {
    <init>();
}
-keep class androidx.room.TypeConverter {
    <init>();
}
-keep class androidx.room.AutoMigrationCallback {
    <init>();
}
# Preserve all fields and methods of Room-generated classes for database access
-keep class * extends androidx.room.GeneratedAppDatabase { *; }
-keep class * extends androidx.room.RoomMasterTable { *; }
# SEC-09 FIX: SQLCipher — keep all classes so R8 doesn't strip the JNI bridge
# that loads the native encryption library at runtime.
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }
