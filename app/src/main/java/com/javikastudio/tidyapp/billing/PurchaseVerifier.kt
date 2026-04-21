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
        // In debug builds or if key not configured, skip verification
        // Remove this check before release — or it defeats the purpose
        if (BASE64_PUBLIC_KEY == "REPLACE_WITH_YOUR_PLAY_CONSOLE_RSA_PUBLIC_KEY") {
            Log.w(TAG, "WARNING: Using dev bypass — replace public key before release!")
            return true
        }

        return try {
            val publicKey = generatePublicKey(BASE64_PUBLIC_KEY)
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
