package com.javikastudio.tidyapp.billing

import android.util.Base64
import android.util.Log
import com.javikastudio.tidyapp.BuildConfig
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * PurchaseVerifier — verifies Play purchase signatures locally.
 *
 * No network required. Uses your app's RSA public key from Play Console.
 *
 * HOW TO GET YOUR KEY:
 *   Play Console → Your app → Monetise → Monetisation setup → Licensing
 *   Copy the "Base64-encoded RSA public key" string
 *   Paste it as BASE64_PUBLIC_KEY below (replace the placeholder)
 *
 * SECURITY NOTE: This is client-side verification only. It prevents
 * casual tampering but not determined attackers. For Aurelo's
 * privacy-first, no-backend model, this is the correct trade-off.
 * If you add a backend later, move verification server-side.
 */
object PurchaseVerifier {

    private const val TAG = "AureloVerifier"
    private const val KEY_FACTORY_ALGORITHM  = "RSA"
    private const val SIGNATURE_ALGORITHM    = "SHA1withRSA"

    // ── REPLACE THIS with your actual key from Play Console ───────
    // Play Console → Monetise → Monetisation setup → Licensing
    private const val BASE64_PUBLIC_KEY = BuildConfig.RSA_KEY

    // ─────────────────────────────────────────────────────────────

    /**
     * Verifies that [signedData] was signed by Google Play using your app's key.
     * Returns true only if the signature is cryptographically valid.
     *
     * @param signedData  purchase.originalJson from the Purchase object
     * @param signature   purchase.signature from the Purchase object
     */
    fun verify(signedData: String, signature: String): Boolean {
        if (!isConfiguredKey(BASE64_PUBLIC_KEY)) {
            if (BuildConfig.DEBUG) {
                Log.w(TAG, "Debug billing verification bypass: Play RSA key is not configured")
                return true
            }
            Log.e(TAG, "Play RSA key is not configured; failing purchase verification closed")
            return false
        }

        if (signedData.isBlank() || signature.isBlank()) {
            Log.e(TAG, "Missing purchase data or signature")
            return false
        }

        return try {
            val publicKey = generatePublicKey(BASE64_PUBLIC_KEY.trim())
            verify(publicKey, signedData, signature)
        } catch (e: Exception) {
            Log.e(TAG, "Verification exception: ${e.message}")
            false
        }
    }

    internal fun isConfiguredKey(key: String?): Boolean {
        val normalized = key?.trim().orEmpty()
        if (normalized.isEmpty() ||
            normalized.equals("null", ignoreCase = true) ||
            normalized == "REPLACE_WITH_YOUR_PLAY_CONSOLE_RSA_PUBLIC_KEY") {
            return false
        }
        return true
    }

    /**
     * Testable verification entry point that never applies the debug bypass.
     */
    internal fun verifyWithKey(base64PublicKey: String?, signedData: String, signature: String): Boolean {
        if (!isConfiguredKey(base64PublicKey) || signedData.isBlank() || signature.isBlank()) {
            return false
        }
        return try {
            val publicKey = generatePublicKey(base64PublicKey!!.trim())
            verify(publicKey, signedData, signature)
        } catch (e: Exception) {
            Log.e(TAG, "Verification exception: ${e.message}")
            false
        }
    }

    private fun generatePublicKey(encodedPublicKey: String): PublicKey {
        val decodedKey = Base64.decode(encodedPublicKey, Base64.DEFAULT)
        val keyFactory = KeyFactory.getInstance(KEY_FACTORY_ALGORITHM)
        return keyFactory.generatePublic(X509EncodedKeySpec(decodedKey))
    }

    private fun verify(publicKey: PublicKey, signedData: String, signature: String): Boolean {
        val signatureBytes = try {
            Base64.decode(signature, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "Base64 decode failed for signature")
            return false
        }
        return try {
            val sig = Signature.getInstance(SIGNATURE_ALGORITHM)
            sig.initVerify(publicKey)
            sig.update(signedData.toByteArray())
            sig.verify(signatureBytes)
        } catch (e: Exception) {
            Log.e(TAG, "Signature verification failed: ${e.message}")
            false
        }
    }
}
