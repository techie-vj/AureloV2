package com.javikastudio.tidyapp

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope

/**
 * ShareBridge — owns text and image sharing via the Android share sheet,
 * and gallery save operations.
 * Phase 3: extracted from AppBridge.kt.
 */
class ShareBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope
) : AppBridgeController {

    @JavascriptInterface fun shareText(text: String) {
        val activity = context as? android.app.Activity ?: return
        activity.runOnUiThread {
            runCatching {
                activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type="text/plain"; putExtra(Intent.EXTRA_TEXT,text); flags=Intent.FLAG_ACTIVITY_NEW_TASK }, "Share Aurelo").apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK })
            }
        }
    }

    @JavascriptInterface fun shareImage(base64: String, fileName: String) {
        val activity = context as? android.app.Activity ?: return
        activity.runOnUiThread {
            runCatching {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                val bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size) ?: return@runCatching
                val imageUri = saveToMediaStore(bitmap, fileName)
                val shareIntent = Intent(Intent.ACTION_SEND).apply { type="image/png"; if(imageUri!=null) putExtra(Intent.EXTRA_STREAM,imageUri); putExtra(Intent.EXTRA_TEXT,"Shared from Aurelo"); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK) }
                activity.startActivity(Intent.createChooser(shareIntent,"Share stats").apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK })
            }.onFailure { e -> android.util.Log.e("ShareBridge","shareImage failed",e) }
        }
    }

    @JavascriptInterface fun shareImageWithText(base64: String, fileName: String, shareText: String) {
        val activity = context as? android.app.Activity ?: return
        activity.runOnUiThread {
            runCatching {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                val bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size) ?: return@runCatching
                val imageUri = saveToMediaStore(bitmap, fileName)
                val shareIntent = Intent(Intent.ACTION_SEND).apply { type="image/png"; if(imageUri!=null) putExtra(Intent.EXTRA_STREAM,imageUri); putExtra(Intent.EXTRA_TEXT,shareText); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK) }
                activity.startActivity(Intent.createChooser(shareIntent,"Share stats").apply { flags=Intent.FLAG_ACTIVITY_NEW_TASK })
            }.onFailure { e -> android.util.Log.e("ShareBridge","shareImageWithText failed",e) }
        }
    }

    @JavascriptInterface fun saveImageToGallery(base64: String, fileName: String) {
        val activity = context as? android.app.Activity ?: return
        activity.runOnUiThread {
            runCatching {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                val bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size) ?: return@runCatching
                val saved = saveToMediaStore(bitmap, fileName) != null
                webView.post { webView.evaluateJavascript("if(typeof window.onGallerySaveResult==='function') window.onGallerySaveResult($saved)", null) }
            }.onFailure { webView.post { webView.evaluateJavascript("if(typeof window.onGallerySaveResult==='function') window.onGallerySaveResult(false)", null) } }
        }
    }

    private fun saveToMediaStore(bitmap: android.graphics.Bitmap, fileName: String): android.net.Uri? {
        val resolver = context.contentResolver
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            val values = android.content.ContentValues().apply { put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,"$fileName.png"); put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/png"); put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,"Pictures/Aurelo"); put(android.provider.MediaStore.Images.Media.IS_PENDING,1) }
            resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)?.also { uri ->
                resolver.openOutputStream(uri)?.use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
                values.clear(); values.put(android.provider.MediaStore.Images.Media.IS_PENDING,0)
                resolver.update(uri, values, null, null)
            }
        } else {
            @Suppress("DEPRECATION")
            val path = android.provider.MediaStore.Images.Media.insertImage(resolver, bitmap, fileName, "Aurelo share")
            if (path != null) android.net.Uri.parse(path) else null
        }
    }
}
