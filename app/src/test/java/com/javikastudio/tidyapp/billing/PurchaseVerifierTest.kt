package com.javikastudio.tidyapp.billing

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PurchaseVerifierTest {
    @Test fun placeholderKeysAreNotConfigured() {
        assertFalse(PurchaseVerifier.isConfiguredKey(null))
        assertFalse(PurchaseVerifier.isConfiguredKey(""))
        assertFalse(PurchaseVerifier.isConfiguredKey("null"))
        assertFalse(PurchaseVerifier.isConfiguredKey("REPLACE_WITH_YOUR_PLAY_CONSOLE_RSA_PUBLIC_KEY"))
    }

    @Test fun nonPlaceholderKeyIsConfigured() {
        assertTrue(PurchaseVerifier.isConfiguredKey("abc123"))
    }

    @Test fun directVerificationFailsClosedForMissingKey() {
        assertFalse(PurchaseVerifier.verifyWithKey(null, "{}", "sig"))
        assertFalse(PurchaseVerifier.verifyWithKey("REPLACE_WITH_YOUR_PLAY_CONSOLE_RSA_PUBLIC_KEY", "{}", "sig"))
    }
}
