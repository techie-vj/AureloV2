package com.javikastudio.tidyapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurityValidatorsTest {
    @Test fun assetAllowlistBlocksTraversal() {
        assertTrue(SecurityValidators.isAllowedAssetPath("www/templates/home.html"))
        assertFalse(SecurityValidators.isAllowedAssetPath("../pkg_db.json"))
        assertFalse(SecurityValidators.isAllowedAssetPath("aurelo_coach.onnx"))
    }

    @Test fun packageNamesAreStrict() {
        assertTrue(SecurityValidators.isValidPackageName("com.example.app"))
        assertFalse(SecurityValidators.isValidPackageName("bad package"))
        assertFalse(SecurityValidators.isValidPackageName("1bad.package"))
    }

    @Test fun plainPreferenceKeysAreAllowlisted() {
        assertTrue(SecurityValidators.isAllowedPublicPrefKey("app_theme"))
        assertFalse(SecurityValidators.isAllowedPublicPrefKey(BEDTIME_SETTINGS_V1))
        assertFalse(SecurityValidators.isAllowedPublicPrefKey("is_pro_user"))
    }
}
