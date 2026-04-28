package com.javikastudio.tidyapp

// ═══════════════════════════════════════════════════════════════════════════
// PermissionRationaleActivity — required so Aurelo appears in Health Connect.
//
// AndroidManifest.xml must declare this activity with TWO intent-filters:
//
//   <!-- API 26–33: HC SDK action -->
//   <intent-filter>
//     <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"/>
//   </intent-filter>
//
//   <!-- API 34+ (Android 14+): OS-level HC action -->
//   <intent-filter>
//     <action android:name="android.intent.action.VIEW_PERMISSION_USAGE"/>
//     <category android:name="android.intent.category.HEALTH_PERMISSIONS"/>
//   </intent-filter>
//
// Without BOTH filters this Activity is invisible in Health Connect on one
// or the other API range. On Android 14+ the SDK action is ignored entirely.
// ═══════════════════════════════════════════════════════════════════════════

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class PermissionRationaleActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity     = Gravity.CENTER_HORIZONTAL
            setPadding(72, 96, 72, 64)
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        }

        val title = TextView(this).apply {
            text     = "Aurelo · Health Connect"
            textSize = 20f
            gravity  = Gravity.CENTER
            setPadding(0, 0, 0, 32)
        }

        val body = TextView(this).apply {
            text = "Aurelo reads the following data from Health Connect to calculate " +
                    "your Body Score, enhance your Sleep Score, and award activity " +
                    "bonuses to your Screen Score:\n\n" +
                    "• Sleep sessions\n" +
                    "• Heart rate variability (HRV, overnight)\n" +
                    "• Daily step count\n" +
                    "• Resting heart rate\n" +
                    "• Mindfulness sessions (Headspace, Calm, etc.)\n\n" +
                    "Aurelo never writes to Health Connect and never sends your " +
                    "health data off-device."
            textSize = 15f
            // TextView.lineHeight requires API 28. Use setLineSpacing() for
            // API 26-27 compat (minSdk = 26).
            setLineSpacing(0f, 1.6f)
            setPadding(0, 0, 0, 48)
        }

        val btnManage = Button(this).apply {
            text = "Manage permissions"
            setOnClickListener { openHCPermissionScreen() }
        }

        val btnClose = Button(this).apply {
            text = "Close"
            setOnClickListener { finish() }
        }

        root.addView(title)
        root.addView(body)
        root.addView(btnManage, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(btnClose,  LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
            topMargin = 16
        })

        setContentView(root)
    }

    // ── Navigate to Aurelo's Health Connect permissions page ─────────────
    //
    // API 34+ (Android 14+):
    //   MANAGE_HEALTH_PERMISSIONS + EXTRA_PACKAGE_NAME opens Aurelo's own page
    //   directly inside the system Health Connect UI.
    //
    // API 26–33:
    //   Same action is registered by the HC app when installed, so the primary
    //   path works. Falls back to the Play Store if HC is not installed.

    private fun openHCPermissionScreen() {
        val opened = runCatching {
            startActivity(
                Intent("android.health.connect.action.MANAGE_HEALTH_PERMISSIONS").apply {
                    putExtra(Intent.EXTRA_PACKAGE_NAME, packageName)
                }
            )
        }.isSuccess

        if (!opened) {
            // Fallback: HC Play Store listing
            runCatching {
                startActivity(
                    Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("market://details?id=com.google.android.apps.healthdata"))
                )
            }
        }

        finish()
    }
}