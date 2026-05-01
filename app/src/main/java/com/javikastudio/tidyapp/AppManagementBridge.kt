package com.javikastudio.tidyapp

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * AppManagementBridge — owns installed-app list, app categories, locked/hidden
 * apps, ghost-app management, and discover-pool integration.
 * Phase 3: extracted from AppBridge.kt.
 */
class AppManagementBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val pm: PackageManager,
    internal val playFetcher: PlayStoreFetcher,
    internal val categorizer: AppCategorizer,
    private val catCache: android.content.SharedPreferences,
    private val secureStorageAvailable: () -> Boolean
) : AppBridgeController {

    // ── Installed apps ────────────────────────────────────────────────────────
    @JavascriptInterface fun getCachedApps(): String = prefs.getString(CACHED_APPS_V5, "[]") ?: "[]"

    @JavascriptInterface fun refreshApps(): String =
        buildInstalledAppsList().also { prefs.edit().putString(CACHED_APPS_V5, it).apply() }

    @JavascriptInterface fun getCategoryDefinitions(): String {
        val arr = JSONArray()
        Categories.PRIORITY.filter { it != Categories.UNASSIGNED }.forEach { cat ->
            arr.put(JSONObject().apply { put("name", cat); put("icon", Categories.ICONS[cat] ?: "📱") })
        }
        return arr.toString()
    }

    @JavascriptInterface fun getAllApps(): String {
        val appCatMap = safeJson(prefs.getString(APP_CAT_MAP_V1, "{}"))
        val result = JSONArray()
        pm.getInstalledApplications(0 /* PERF-01 FIX: was GET_META_DATA — only getApplicationLabel() is
                   called on the result, so loading full manifest metadata is
                   unnecessary and adds significant latency on devices with 80+ apps */)
            .filter { it.packageName != context.packageName && isUserApp(it) }
            .sortedBy { pm.getApplicationLabel(it).toString().lowercase() }
            .forEach { info ->
                runCatching {
                    val name = pm.getApplicationLabel(info).toString(); val pkg = info.packageName
                    val cat = if (appCatMap.has(pkg)) Categories.migrate(appCatMap.getString(pkg))
                    else {
                        val pkgL = pkg.lowercase()
                        categorizer.getDbCategory(pkgL)
                            ?: playFetcher.getCategory(pkg)?.takeIf { it != "__unknown__" }
                            ?: catCache.getString(pkgL, null)?.let { Categories.migrate(it) }?.takeIf { Categories.isValid(it) }
                            ?: categorizer.categorize(info, name)
                    }
                    result.put(JSONObject().apply { put("name",name); put("packageName",pkg); put("category",cat); put("iconUrl","app-icon://$pkg") })
                }
            }
        return result.toString()
    }

    fun buildInstalledAppsList(): String {
        val overrides = safeJson(prefs.getString(CAT_OVERRIDES_V4, "{}"))
        val appCatMap = safeJson(prefs.getString(APP_CAT_MAP_V1, "{}"))
        val hidden = hiddenSet(); val result = JSONArray()
        pm.getInstalledApplications(0 /* PERF-01 FIX: was GET_META_DATA — only getApplicationLabel() is
                   called on the result, so loading full manifest metadata is
                   unnecessary and adds significant latency on devices with 80+ apps */)
            .filter { it.packageName != context.packageName && !hidden.contains(it.packageName) && isUserApp(it) }
            .sortedBy { pm.getApplicationLabel(it).toString().lowercase() }
            .forEach { info ->
                runCatching {
                    val name = pm.getApplicationLabel(info).toString(); val pkg = info.packageName
                    val cat = when {
                        appCatMap.has(pkg) -> Categories.migrate(appCatMap.getString(pkg))
                        overrides.has(pkg) -> Categories.migrate(overrides.getString(pkg))
                        else -> {
                            val pkgL = pkg.lowercase()
                            val dbCat = categorizer.getDbCategory(pkgL)
                            if (dbCat != null) { catCache.edit().putString(pkgL, dbCat).apply(); dbCat }
                            else {
                                val playCat = playFetcher.getCategory(pkg)?.takeIf { it != "__unknown__" }
                                if (playCat != null) { catCache.edit().putString(pkgL, playCat).apply(); playCat }
                                else catCache.getString(pkgL, null) ?: categorizer.categorize(info, name)
                            }
                        }
                    }
                    result.put(JSONObject().apply { put("name",name); put("packageName",pkg); put("category",cat); put("iconUrl","app-icon://$pkg") })
                }
            }
        return result.toString()
    }

    // ── Play Store sync ───────────────────────────────────────────────────────
    @JavascriptInterface fun startPlaySync() {
        bridgeScope.launch(Dispatchers.IO) {
            val allPkgs = pm.getInstalledApplications(0 /* PERF-01 FIX: was GET_META_DATA — only getApplicationLabel() is
                   called on the result, so loading full manifest metadata is
                   unnecessary and adds significant latency on devices with 80+ apps */)
                .filter { it.packageName != context.packageName && isUserApp(it) }
            val needsPlay = allPkgs.filter { info ->
                val pkg = info.packageName; val pkgL = pkg.lowercase()
                if (categorizer.getDbCategory(pkgL) != null) return@filter false
                val playCat = playFetcher.getCategory(pkg)
                if (playCat != null && playCat != "__unknown__") return@filter false
                val cached = catCache.getString(pkgL, null)?.let { Categories.migrate(it) }
                cached == null || cached == Categories.UNASSIGNED
            }.map { it.packageName }

            if (needsPlay.isEmpty()) {
                (context as? android.app.Activity)?.runOnUiThread {
                    (context as? MainActivity)?.webView?.evaluateJavascript("if(typeof window.onPlaySyncComplete==='function') window.onPlaySyncComplete(0)", null)
                }; return@launch
            }
            var updatedCount = 0
            playFetcher.syncAll(packages = needsPlay, onProgress = { done, total ->
                (context as? android.app.Activity)?.runOnUiThread {
                    (context as? MainActivity)?.webView?.evaluateJavascript("if(typeof window.onPlaySyncProgress==='function') window.onPlaySyncProgress($done,$total)", null)
                }
                val cat = playFetcher.getCategory(needsPlay[done - 1])
                if (cat != null && cat != "__unknown__") updatedCount++
            })
            refreshApps()
            val count = updatedCount
            (context as? android.app.Activity)?.runOnUiThread {
                (context as? MainActivity)?.webView?.evaluateJavascript("if(typeof window.onPlaySyncComplete==='function') window.onPlaySyncComplete($count)", null)
            }
        }
    }

    // ── Lock / hide apps ──────────────────────────────────────────────────────
    @JavascriptInterface fun getLockedApps(): String = securePrefs.getString(LOCKED_APPS_V4, "[]") ?: "[]"
    @JavascriptInterface fun setLockedApps(json: String) {
        if (!secureStorageAvailable()) return
        securePrefs.edit().putString(LOCKED_APPS_V4, json).apply()
    }
    @JavascriptInterface fun getHiddenApps(): String = securePrefs.getString(HIDDEN_APPS_V4, "[]") ?: "[]"
    @JavascriptInterface fun setHiddenApps(json: String) {
        if (!secureStorageAvailable()) return
        securePrefs.edit().putString(HIDDEN_APPS_V4, json).apply()
    }

    // ── Category overrides ────────────────────────────────────────────────────
    @JavascriptInterface fun getCategoryOverrides(): String  = securePrefs.getString(CAT_OVERRIDES_V4, "{}") ?: "{}"
    @JavascriptInterface fun saveCategoryOverrides(json: String) { securePrefs.edit().putString(CAT_OVERRIDES_V4, json).apply() }
    @JavascriptInterface fun getAppCategoryMap(): String     = securePrefs.getString(APP_CAT_MAP_V1, "{}") ?: "{}"
    @JavascriptInterface fun saveAppCategoryMap(json: String) { securePrefs.edit().putString(APP_CAT_MAP_V1, json).apply() }
    @JavascriptInterface fun getCatAppOrder(): String        = prefs.getString(CAT_APP_ORDER_V1, "{}") ?: "{}"
    @JavascriptInterface fun saveCatAppOrder(json: String)   { prefs.edit().putString(CAT_APP_ORDER_V1, json).apply() }
    @JavascriptInterface fun getUserCategories(): String     = prefs.getString(USER_CATS_V1, "[]") ?: "[]"
    @JavascriptInterface fun saveUserCategories(json: String) { prefs.edit().putString(USER_CATS_V1, json).commit() }

    // ── App utilities ─────────────────────────────────────────────────────────
    @JavascriptInterface fun isAppInstalled(pkg: String): Boolean =
        runCatching { pm.getPackageInfo(pkg, 0); true }.getOrDefault(false)

    @JavascriptInterface fun openApp(pkg: String): Boolean =
        runCatching { val i = pm.getLaunchIntentForPackage(pkg)?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) } ?: return false; context.startActivity(i); true }.getOrDefault(false)

    @JavascriptInterface fun openUrl(url: String) {
        val trimmed = url.trim()
        if (!SecurityValidators.isSafeExternalUrl(trimmed)) return
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, android.net.Uri.parse(trimmed))
                    .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
            )
        }
    }

    @JavascriptInterface fun openPlayStore(pkg: String) {
        val validPkg = Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$")
        if (!pkg.matches(validPkg)) return
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=$pkg")).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }) }
            .onFailure { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://play.google.com/store/apps/details?id=$pkg")).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }) } }
    }

    @JavascriptInterface fun openEmail(to: String, subject: String, body: String) {
        runCatching {
            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SENDTO).apply {
                data = android.net.Uri.parse("mailto:"); putExtra(Intent.EXTRA_EMAIL, arrayOf(to)); putExtra(Intent.EXTRA_SUBJECT, subject)
                if (body.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, body); flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }, "Send feedback").apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK })
        }
    }

    @JavascriptInterface fun onAdSearchClicked(query: String) {
        (context as? android.app.Activity)?.runOnUiThread {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("market://search?q=${android.net.Uri.encode(query)}&c=apps")).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }) }
                .onFailure { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://play.google.com/store/search?q=${android.net.Uri.encode(query)}&c=apps")).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }) } }
        }
    }

    @Suppress("DEPRECATION")
    @JavascriptInterface fun uninstallApp(pkg: String) {
        if (!SecurityValidators.isPackageName(pkg)) return
        if (!isAppInstalled(pkg)) return
        val uri = android.net.Uri.parse("package:$pkg")
        val intent = Intent(Intent.ACTION_DELETE, uri).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        val activity = context as? android.app.Activity
        if (activity != null) activity.runOnUiThread { activity.startActivity(intent) }
        else runCatching { context.startActivity(intent) }
    }

    @JavascriptInterface fun triggerBackgroundScan() {
        Thread {
            preScan(); val wv = webView
            (context as? android.app.Activity)?.runOnUiThread {
                wv.evaluateJavascript("if(typeof window.onScanComplete==='function') window.onScanComplete()", null)
            }
        }.start()
    }

    fun preScan() { prefs.edit().putString(CACHED_APPS_V5, buildInstalledAppsList()).commit() }

    /** Clear catCache entry when app uninstalled. Called from MainActivity. */
    fun clearCatCacheEntry(pkg: String) {
        catCache.edit().remove(pkg.lowercase()).apply()
        categorizer.clearCache()
    }

    // ── isUserApp — shared by UsageStatsBridge and others ────────────────────
    internal fun isUserApp(info: ApplicationInfo): Boolean {
        val pkg = info.packageName
        if (pm.getLaunchIntentForPackage(pkg) == null) return false
        val isSystem = (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0
        val isUpdatedSystem = (info.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
        if (!isSystem) return true
        val systemPrefixes = listOf("android","com.android.systemui","com.android.launcher","com.android.settings","com.android.providers","com.android.server","com.android.phone","com.android.dialer","com.android.contacts","com.android.mms","com.android.packageinstaller","com.android.managedprovisioning","com.android.inputmethod","com.android.nfc","com.android.bluetooth","com.android.wifi","com.android.connectivity","com.android.hotspot2","com.google.android.gms","com.google.android.gsf","com.google.android.inputmethod","com.google.android.googlequicksearchbox","com.google.android.tts","com.google.android.syncadapters","com.google.android.backuptransport","com.google.android.configupdater","com.google.android.partnersetup","com.google.android.setupwizard","com.google.android.onetimeinitializer","com.google.android.packageinstaller","com.google.android.permissioncontroller","com.google.android.printservice","com.google.android.networkstack","com.google.android.accessibility","com.google.android.apps.accessibility","com.android.accessibility","com.google.android.apps.enterprise","com.google.android.apps.work","com.android.enterprise","com.google.android.apps.safetyhub","com.google.android.apps.emergencyassist","com.google.android.apps.restore","com.google.android.apps.setupwizard","com.android.theme","com.android.overlay","com.samsung.android.theme","com.oneplus.theme","com.google.android.apps.vpn","com.android.vpndialogs")
        if (systemPrefixes.any { pkg == it || pkg.startsWith("$it.") }) return false
        val systemExact = setOf("com.google.android.dialer","com.google.android.contacts","com.google.android.calculator","com.google.android.GoogleCamera","com.google.android.deskclock","com.google.android.apps.turbo","com.google.android.apps.wallpaper","com.google.android.apps.photos.scanner","com.google.android.apps.pixel.launcher","com.google.android.apps.work.oobe","com.google.android.apps.devicelockcontroller","com.google.android.devicelockcontroller","com.samsung.android.app.camera","com.samsung.android.calculator","com.samsung.android.app.clockpack","com.samsung.android.gallery3d","com.samsung.android.contacts","com.oneplus.camera","com.oneplus.dialer","com.oneplus.deskclock","com.oppo.camera","com.realme.camera","com.miui.camera","com.miui.calculator","com.miui.clock","com.coloros.calculator","com.coloros.camera2")
        if (pkg in systemExact) return false
        if (isUpdatedSystem) {
            val allowedUpdatedSystem = setOf("com.android.chrome","com.google.android.apps.messaging","com.google.android.apps.photos","com.google.android.apps.maps","com.google.android.youtube","com.google.android.gm","com.google.android.apps.docs","com.google.android.apps.sheets","com.google.android.apps.slides","com.google.android.keep","com.google.android.calendar","com.google.android.apps.meet","com.google.android.apps.subscriptions.red","com.google.android.music","com.google.android.play.games","com.google.android.apps.recorder","com.google.android.apps.wellbeing","com.google.android.apps.chromecast.app","com.google.android.apps.nbu.files","com.google.android.apps.cloudprint","com.samsung.android.email.provider","com.samsung.android.calendar","com.samsung.android.browser","com.samsung.android.messaging")
            return pkg in allowedUpdatedSystem
        }
        return false
    }

    internal fun hiddenSet(): Set<String> = try {
        val arr = JSONArray(securePrefs.getString(HIDDEN_APPS_V4, "[]") ?: "[]")
        (0 until arr.length()).map { arr.getString(it) }.toSet()
    } catch (_: Exception) { emptySet() }

    private fun safeJson(s: String?): JSONObject = try { JSONObject(s ?: "{}") } catch (_: Exception) { JSONObject() }
}
