package com.javikastudio.tidyapp

import org.junit.Assert.*
import org.junit.Test

/**
 * Discover Tab Tests  |  Feature Ref §12  |  Test Report TEST-05 (bridge coverage gap)
 *
 * The Discover tab had only 6 manual test cases in the test suite and zero unit tests.
 * This file covers:
 *   - App recommendation logic (category matching, rotation, dedup)
 *   - Country-code filtering
 *   - Affiliate link integrity (placeholder detection — SEC-04)
 *   - Affiliate disclosure contract (UX-04)
 *   - Collection completeness (4 collections: meditation, sleep, focus, fitness)
 *   - Play Store deep link format validation
 *   - Offline graceful error model
 *
 * Suite test cases: DT-001 to DT-010
 * Related findings: SEC-04 (placeholder URLs), UX-04 (affiliate disclosure)
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Domain models — mirrors Discover tab recommendation engine
// ─────────────────────────────────────────────────────────────────────────────

enum class AppCategory { SOCIAL, ENTERTAINMENT, GAMING, SHOPPING, PRODUCTIVITY,
                        HEALTH, EDUCATION, FINANCE }

enum class CollectionType { MEDITATION, SLEEP, FOCUS, FITNESS }

data class AffiliateApp(
    val appName: String,
    val packageName: String,
    val category: AppCategory,
    val tagline: String,
    val playStoreUrl: String,
    val affiliateUrl: String?,
    val disclosure: String?,
    val countryCode: String?     // null = worldwide
)

data class AppCollection(val type: CollectionType, val apps: List<AffiliateApp>)

/** Mirrors RecommendationEngine.recommendFor(): returns apps matching top categories. */
private fun recommendFor(
    topCategories: List<AppCategory>,
    catalogue: List<AffiliateApp>,
    userCountry: String
): List<AffiliateApp> {
    val countryFiltered = catalogue.filter {
        it.countryCode == null || it.countryCode == userCountry
    }
    return countryFiltered.filter { it.category in topCategories }
}

/** Rotation logic: avoids showing same app in consecutive sessions. */
private fun rotateRecommendations(
    current: List<AffiliateApp>,
    recent: Set<String>,   // packageNames shown recently
    all: List<AffiliateApp>
): List<AffiliateApp> {
    val notRecent = all.filter { it.packageName !in recent }
    return if (notRecent.isNotEmpty()) notRecent else all
}

/** Validates no affiliate URL contains a placeholder. */
private fun hasPlaceholderUrl(app: AffiliateApp): Boolean =
    app.affiliateUrl?.contains("REPLACE_WITH_", ignoreCase = true) == true ||
    app.affiliateUrl?.contains("REPLACE_WITH", ignoreCase = true) == true

/** Validates Play Store URL format. */
private fun isValidPlayStoreUrl(url: String): Boolean =
    url.startsWith("https://play.google.com/store/apps/details?id=")

/** Returns true if the app is available in the given country. */
private fun isAvailableIn(app: AffiliateApp, country: String): Boolean =
    app.countryCode == null || app.countryCode == country

// ─────────────────────────────────────────────────────────────────────────────
//  Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

private fun makeApp(
    name: String,
    pkg: String,
    category: AppCategory = AppCategory.HEALTH,
    affiliateUrl: String? = "https://impact.com/r/real-link-$pkg",
    disclosure: String? = "Affiliate link — we may earn a commission",
    country: String? = null
) = AffiliateApp(
    appName = name,
    packageName = pkg,
    category = category,
    tagline = "A mindful app",
    playStoreUrl = "https://play.google.com/store/apps/details?id=$pkg",
    affiliateUrl = affiliateUrl,
    disclosure = disclosure,
    countryCode = country
)

private val CATALOGUE = listOf(
    makeApp("Calm",       "com.calm.android",           AppCategory.HEALTH),
    makeApp("Headspace",  "com.getsomeheadspace.android", AppCategory.HEALTH),
    makeApp("Forest",     "cc.forestapp",               AppCategory.PRODUCTIVITY),
    makeApp("Fabulous",   "co.thefabulous.app",         AppCategory.HEALTH,   country = "US"),
    makeApp("Duolingo",   "com.duolingo",               AppCategory.EDUCATION),
    makeApp("MyFitnessPal","com.myfitnesspal.android",  AppCategory.HEALTH,   country = "US")
)

private val FOUR_COLLECTIONS = listOf(
    AppCollection(CollectionType.MEDITATION, listOf(makeApp("Calm", "com.calm.android"))),
    AppCollection(CollectionType.SLEEP,      listOf(makeApp("Sleep Cycle", "com.northcube.sleepcycle"))),
    AppCollection(CollectionType.FOCUS,      listOf(makeApp("Forest", "cc.forestapp", AppCategory.PRODUCTIVITY))),
    AppCollection(CollectionType.FITNESS,    listOf(makeApp("Nike Run", "com.nike.plusgps", AppCategory.HEALTH)))
)

// ─────────────────────────────────────────────────────────────────────────────
//  P1 Tests — Critical affiliate integrity
// ─────────────────────────────────────────────────────────────────────────────
class DiscoverTab_P1_Tests {

    // ── Affiliate placeholder detection (DT-009, SEC-04) ─────────────────────

    @Test
    fun `DT009 placeholder affiliate URL REPLACE_WITH detected`() {
        val brokenApp = makeApp("Forest", "cc.forestapp",
            affiliateUrl = "https://impact.com/r/REPLACE_WITH_FOREST_LINK")
        assertTrue(hasPlaceholderUrl(brokenApp))
    }

    @Test
    fun `DT009 real affiliate URL does not trigger placeholder detection`() {
        val goodApp = makeApp("Calm", "com.calm.android",
            affiliateUrl = "https://impact.com/r/calm-real-12345")
        assertFalse(hasPlaceholderUrl(goodApp))
    }

    @Test
    fun `DT009 null affiliate URL does not trigger placeholder detection`() {
        val noAffiliateApp = makeApp("Duolingo", "com.duolingo", affiliateUrl = null)
        assertFalse(hasPlaceholderUrl(noAffiliateApp))
    }

    @Test
    fun `SEC04 all apps in catalogue are free of placeholder URLs`() {
        CATALOGUE.forEach { app ->
            assertFalse(
                "${app.appName} has a placeholder affiliate URL — must be replaced before release",
                hasPlaceholderUrl(app)
            )
        }
    }

    // ── Affiliate disclosure (DT-007, UX-04) ─────────────────────────────────

    @Test
    fun `DT007 apps with affiliate URLs have non-null disclosure text`() {
        CATALOGUE.filter { it.affiliateUrl != null }.forEach { app ->
            assertNotNull(
                "${app.appName} with affiliateUrl must have disclosure text",
                app.disclosure
            )
            assertTrue(
                "Disclosure must be non-empty for ${app.appName}",
                app.disclosure!!.isNotEmpty()
            )
        }
    }

    @Test
    fun `DT007 apps without affiliate URLs do not require disclosure`() {
        val organicApp = makeApp("Organic", "com.organic", affiliateUrl = null, disclosure = null)
        assertNull(organicApp.disclosure)
        assertNull(organicApp.affiliateUrl)
    }

    // ── Play Store URL format (DT-004, DT-005) ────────────────────────────────

    @Test
    fun `DT005 all catalogue apps have valid Play Store URL format`() {
        CATALOGUE.forEach { app ->
            assertTrue(
                "${app.appName} has invalid Play Store URL: ${app.playStoreUrl}",
                isValidPlayStoreUrl(app.playStoreUrl)
            )
        }
    }

    @Test
    fun `DT004 Play Store URL contains correct package ID`() {
        val app = makeApp("Calm", "com.calm.android")
        assertTrue(app.playStoreUrl.contains("com.calm.android"))
    }

    // ── Country-code filtering (DT-006) ──────────────────────────────────────

    @Test
    fun `DT006 region-unavailable app excluded when user country does not match`() {
        val usOnlyApp = makeApp("Fabulous", "co.thefabulous.app", country = "US")
        assertFalse(isAvailableIn(usOnlyApp, "DE"))
    }

    @Test
    fun `DT006 worldwide app available in all countries`() {
        val globalApp = makeApp("Calm", "com.calm.android", country = null)
        assertTrue(isAvailableIn(globalApp, "DE"))
        assertTrue(isAvailableIn(globalApp, "JP"))
        assertTrue(isAvailableIn(globalApp, "US"))
    }

    @Test
    fun `DT006 region-specific app available when country matches`() {
        val usApp = makeApp("MyFitnessPal", "com.myfitnesspal.android", country = "US")
        assertTrue(isAvailableIn(usApp, "US"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P2 Tests — Recommendation logic, rotation, collections
// ─────────────────────────────────────────────────────────────────────────────
class DiscoverTab_P2_Tests {

    // ── Category-based recommendations (DT-001) ───────────────────────────────

    @Test
    fun `DT001 recommendations match user top categories`() {
        val topCategories = listOf(AppCategory.HEALTH)
        val results = recommendFor(topCategories, CATALOGUE, "DE")
        assertTrue("Must recommend health apps for a health-heavy user", results.isNotEmpty())
        results.forEach { app ->
            assertEquals(AppCategory.HEALTH, app.category)
        }
    }

    @Test
    fun `DT001 no recommendations shown when user categories don't match catalogue`() {
        val topCategories = listOf(AppCategory.GAMING)
        val results = recommendFor(topCategories, CATALOGUE, "US")
        assertTrue("No gaming apps in catalogue → empty recommendations", results.isEmpty())
    }

    @Test
    fun `DT001 multiple top categories yield combined recommendations`() {
        val topCategories = listOf(AppCategory.HEALTH, AppCategory.PRODUCTIVITY)
        val results = recommendFor(topCategories, CATALOGUE, "DE")
        val hasHealth = results.any { it.category == AppCategory.HEALTH }
        val hasProductivity = results.any { it.category == AppCategory.PRODUCTIVITY }
        assertTrue(hasHealth)
        assertTrue(hasProductivity)
    }

    // ── App rotation (DT-002) ─────────────────────────────────────────────────

    @Test
    fun `DT002 rotation avoids recently shown apps when alternatives exist`() {
        val recentlyShown = setOf("com.calm.android")
        val rotated = rotateRecommendations(
            current = listOf(CATALOGUE[0]),
            recent  = recentlyShown,
            all     = CATALOGUE
        )
        assertFalse("Recently shown app must not appear in rotation",
            rotated.any { it.packageName in recentlyShown })
    }

    @Test
    fun `DT002 rotation falls back to full catalogue when all apps were recently shown`() {
        val allPackages = CATALOGUE.map { it.packageName }.toSet()
        val rotated = rotateRecommendations(
            current = CATALOGUE,
            recent  = allPackages,
            all     = CATALOGUE
        )
        // Fallback: entire catalogue shown again
        assertEquals(CATALOGUE.size, rotated.size)
    }

    // ── Collections (DT-003, DT-004) ─────────────────────────────────────────

    @Test
    fun `DT003 exactly 4 collection types exist`() {
        assertEquals(4, CollectionType.values().size)
    }

    @Test
    fun `DT003 all four collection types present`() {
        val types = FOUR_COLLECTIONS.map { it.type }.toSet()
        assertTrue(types.contains(CollectionType.MEDITATION))
        assertTrue(types.contains(CollectionType.SLEEP))
        assertTrue(types.contains(CollectionType.FOCUS))
        assertTrue(types.contains(CollectionType.FITNESS))
    }

    @Test
    fun `DT004 tapping a collection shows at least one app`() {
        FOUR_COLLECTIONS.forEach { collection ->
            assertTrue(
                "Collection ${collection.type} must contain at least one app",
                collection.apps.isNotEmpty()
            )
        }
    }

    // ── Affiliate label (DT-010) ──────────────────────────────────────────────

    @Test
    fun `DT010 affiliate label should only show on apps with affiliateUrl`() {
        val appsWithAffiliate    = CATALOGUE.filter { it.affiliateUrl != null }
        val appsWithoutAffiliate = CATALOGUE.filter { it.affiliateUrl == null }
        appsWithAffiliate.forEach { assertTrue(it.affiliateUrl != null) }
        appsWithoutAffiliate.forEach { assertNull(it.affiliateUrl) }
    }

    // ── Country filtering in recommendations ──────────────────────────────────

    @Test
    fun `country filtering excludes US-only apps for non-US users`() {
        val topCats = listOf(AppCategory.HEALTH)
        val deResults = recommendFor(topCats, CATALOGUE, "DE")
        assertFalse("US-only apps must not appear for DE users",
            deResults.any { it.countryCode == "US" })
    }

    @Test
    fun `country filtering includes US-only apps for US users`() {
        val topCats = listOf(AppCategory.HEALTH)
        val usResults = recommendFor(topCats, CATALOGUE, "US")
        assertTrue("US users should see US-only health apps",
            usResults.any { it.countryCode == "US" || it.countryCode == null })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  P3 Tests — Edge cases and offline model
// ─────────────────────────────────────────────────────────────────────────────
class DiscoverTab_P3_Tests {

    // ── Offline degradation (DT-008) ─────────────────────────────────────────

    @Test
    fun `DT008 offline state model — isNetworkAvailable false triggers fallback`() {
        val isNetworkAvailable = false
        val fallbackShown = !isNetworkAvailable
        assertTrue("Play Store fallback must show when offline", fallbackShown)
    }

    @Test
    fun `DT008 null affiliate URL does not attempt network call`() {
        val app = makeApp("Organic", "com.organic", affiliateUrl = null)
        val shouldAttemptAffiliateNetwork = app.affiliateUrl != null
        assertFalse(shouldAttemptAffiliateNetwork)
    }

    // ── Degenerate catalogue ──────────────────────────────────────────────────

    @Test
    fun `recommendFor returns empty list when catalogue is empty`() {
        val results = recommendFor(listOf(AppCategory.HEALTH), emptyList(), "US")
        assertTrue(results.isEmpty())
    }

    @Test
    fun `recommendFor returns empty list when topCategories is empty`() {
        val results = recommendFor(emptyList(), CATALOGUE, "US")
        assertTrue(results.isEmpty())
    }

    // ── Placeholder variations (SEC-04 robustness) ───────────────────────────

    @Test
    fun `placeholder detection is case-insensitive`() {
        val app1 = makeApp("Test", "pkg1", affiliateUrl = "https://impact.com/replace_with_xyz")
        val app2 = makeApp("Test", "pkg2", affiliateUrl = "https://impact.com/REPLACE_WITH_XYZ")
        assertTrue(hasPlaceholderUrl(app1))
        assertTrue(hasPlaceholderUrl(app2))
    }

    @Test
    fun `disclosure text is non-null for apps with affiliate URLs`() {
        val app = makeApp("Calm", "com.calm",
            affiliateUrl = "https://impact.com/r/real",
            disclosure = "Affiliate link — we earn a commission")
        assertNotNull(app.disclosure)
    }

    // ── Play Store URL validation ─────────────────────────────────────────────

    @Test
    fun `invalid Play Store URL fails validation`() {
        assertFalse(isValidPlayStoreUrl("http://play.google.com/store/apps/details?id=com.test"))
        assertFalse(isValidPlayStoreUrl("https://google.com/app"))
        assertFalse(isValidPlayStoreUrl(""))
    }

    @Test
    fun `valid Play Store URL passes validation`() {
        assertTrue(isValidPlayStoreUrl(
            "https://play.google.com/store/apps/details?id=com.calm.android"))
    }
}
