package com.javikastudio.tidyapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.work.*
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * NotificationBridge — owns in-app notification list, smart alert dispatch,
 * system notification posting, and WorkManager scheduling.
 * Phase 3: extracted from AppBridge.kt.
 */
class NotificationBridge(
    private val context: Context,
    private val webView: WebView,
    private val prefs: android.content.SharedPreferences,
    private val securePrefs: android.content.SharedPreferences,
    private val bridgeScope: CoroutineScope,
    private val usageBridge: UsageStatsBridge,
    private val timerBridge: AppTimerBridge
) : AppBridgeController {

    @JavascriptInterface fun refreshNotifications(): String = getNotifications()

    @JavascriptInterface fun getNotifications(): String {
        val result = JSONArray()
        if (!usageBridge.hasUsagePermission()) {
            result.put(j("icon","📊","title","Grant Usage Access","body","Enable screen time tracking for personalized notifications.","time","Now","type","info")); return result.toString()
        }
        val todayMins = usageBridge.getTotalScreenTimeToday(); val pickups = usageBridge.getPickupCountToday()
        val daily = JSONArray(usageBridge.getCachedDailyUsage())
        val goalMins = prefs.getInt(STREAK_GOAL_MINS, 240).toLong()
        val streak = usageBridge.getStreakDays(goalMins.toInt()); val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        when {
            todayMins > goalMins * 1.75 -> result.put(j("icon","🔴","title","High Screen Time","body","${usageBridge.fmtM(todayMins)} today — ${usageBridge.fmtM(todayMins-goalMins)} over your ${usageBridge.fmtM(goalMins)} goal.","time","Just now","type","warn"))
            todayMins > goalMins        -> result.put(j("icon","⚠️","title","Goal Exceeded","body","${usageBridge.fmtM(todayMins)} today — ${usageBridge.fmtM(todayMins-goalMins)} over your ${usageBridge.fmtM(goalMins)} goal.","time","Just now","type","warn"))
            todayMins > goalMins * 0.75 -> result.put(j("icon","📊","title","Screen Time Update","body","${usageBridge.fmtM(todayMins)} used today. ${usageBridge.fmtM(goalMins-todayMins)} left under your goal.","time","Today","type","info"))
        }
        val limits = timerBridge.limitsMap()
        for (i in 0 until minOf(daily.length(),5)) {
            val app=daily.getJSONObject(i); val pkg=app.getString("packageName"); val name=app.getString("name"); val m=app.getLong("totalMinutes")
            val lim=limits[pkg] ?: continue; val pct=(m*100/lim).toInt()
            when {
                m >= lim -> result.put(j("icon","🚫","title","Limit Reached: $name","body","You've hit your ${usageBridge.fmtM(lim.toLong())} daily limit.","time","Today","type","warn"))
                pct >= 80 -> result.put(j("icon","⏱️","title","Approaching Limit: $name","body","At ${usageBridge.fmtM(m)} — ${pct}% of your ${usageBridge.fmtM(lim.toLong())} limit.","time","Today","type","info"))
            }
        }
        if (daily.length() > 0) {
            val top=daily.getJSONObject(0); val pkg=top.getString("packageName"); val name=top.getString("name"); val m=top.getLong("totalMinutes")
            if (!limits.containsKey(pkg) && m > 90) result.put(j("icon","📱","title","Top App: $name","body","${usageBridge.fmtM(m)} today — your #1 app. Consider setting a daily limit.","time","Today","type","info"))
        }
        when {
            pickups > 80 -> result.put(j("icon","📲","title","Very High Pickups","body","${pickups} phone pickups today — nearly once a minute over 8h.","time","Today","type","warn"))
            pickups > 50 -> result.put(j("icon","🔔","title","Frequent Pickups","body","${pickups} checks today. Batching phone use helps maintain focus.","time","Today","type","info"))
        }
        when (streak) {
            3,7,14,21,30 -> result.put(j("icon","🔥","title","${streak}-Day Streak!","body","$streak consecutive days under your screen time goal!","time","Today","type","success"))
            in 4..6 -> result.put(j("icon","🔥","title","Streak: $streak days","body","${7-streak} more days to a 7-day streak!","time","Today","type","success"))
        }
        if (hour in 20..23 && todayMins > 0) result.put(j("icon","🌙","title","Evening Summary","body","${usageBridge.fmtM(todayMins)} screen time, $pickups pickups today. Put it down before bed.","time","Tonight","type","success"))
        if (result.length() == 0) result.put(j("icon","✅","title","All Good Today!","body","You're on track with your screen time. Keep the great habits going!","time","Today","type","success"))
        return result.toString()
    }

    @JavascriptInterface fun getNotificationHistory(): String {
        return prefs.getString(NOTIF_HISTORY_KEY, "[]") ?: "[]"
    }

    @JavascriptInterface fun cancelAllNotifications() {
        runCatching {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(1000); nm.cancel(4000)
            for (id in 0x2000..0x2FFF) nm.cancel(id)
            for (id in 0x3000..0x3FFF) nm.cancel(id)
        }
        prefs.edit().putLong(NOTIF_CLEARED_TS, System.currentTimeMillis()).apply()
    }

    @JavascriptInterface fun scheduleBackgroundNotifications() {
        runCatching {
            val request = PeriodicWorkRequestBuilder<SmartNotificationWorker>(2, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(false).build()).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("tidy_smart_notifs", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }

    @JavascriptInterface fun saveSmartAlertsEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(SMART_ALERTS_ENABLED, enabled).apply()
    }

    @JavascriptInterface fun markNotificationsRead() {
        val key = NOTIF_HISTORY_KEY
        runCatching {
            val arr = org.json.JSONArray(prefs.getString(key, "[]") ?: "[]")
            for (i in 0 until arr.length()) arr.getJSONObject(i).put("read", true)
            prefs.edit().putString(key, arr.toString()).apply()
        }
    }

    @JavascriptInterface fun getUnreadNotificationCount(): Int {
        return runCatching {
            val arr = org.json.JSONArray(prefs.getString(NOTIF_HISTORY_KEY, "[]") ?: "[]")
            var count = 0
            for (i in 0 until arr.length()) {
                if (!arr.getJSONObject(i).optBoolean("read", false)) count++
            }
            count
        }.getOrElse { 0 }
    }

    @JavascriptInterface fun postSmartAlertNotifications() {
        if (!usageBridge.hasUsagePermission()) return
        runCatching {
            val clearedTs = prefs.getLong(NOTIF_CLEARED_TS, 0L)
            if (System.currentTimeMillis() - clearedTs < 6 * 60 * 60_000L) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                nm.createNotificationChannel(NotificationChannel(NOTIF_CHANNEL_ID,"Aurelo Smart Alerts",NotificationManager.IMPORTANCE_HIGH).apply { description="Screen time and usage alerts"; lockscreenVisibility=android.app.Notification.VISIBILITY_PUBLIC; enableVibration(true); setShowBadge(true) })
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            val pendingIntent = if (launchIntent!=null) android.app.PendingIntent.getActivity(context,0,launchIntent,pendingFlags) else null
            val tips = JSONArray(usageBridge.getSmartTips())
            var bestTip: JSONObject? = null
            for (i in 0 until tips.length()) { val tip=tips.getJSONObject(i); if (bestTip==null||tip.optString("type")=="warn") { bestTip=tip; if(tip.optString("type")=="warn") break } }
            val tip = bestTip ?: return
            val type=tip.optString("type","info"); val title=tip.optString("title"); val body=tip.optString("body")
            val (smallIcon,color)=when(type){"warn"->android.R.drawable.ic_dialog_alert to 0xFFF04E7A.toInt();"success"->android.R.drawable.ic_dialog_info to 0xFF12D48A.toInt();else->android.R.drawable.ic_dialog_info to 0xFF6C63FF.toInt()}
            val priority=if(type=="warn") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT
            val stableId=2000+((title+body).hashCode() and 0x0FFF)
            val notif=NotificationCompat.Builder(context,NOTIF_CHANNEL_ID).setSmallIcon(smallIcon).setColor(color).setContentTitle(title).setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setPriority(priority).setAutoCancel(true)
                .setCategory(if(type=="warn") NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
                .apply { if(pendingIntent!=null) setContentIntent(pendingIntent) }.build()
            nm.notify(stableId, notif)

            // Write to history
            runCatching {
                val existing = prefs.getString(NOTIF_HISTORY_KEY, "[]") ?: "[]"
                val arr = JSONArray(existing)
                val obj = JSONObject()
                obj.put("id", "$title|$body")
                obj.put("type", type)
                obj.put("title", title)
                obj.put("body", body)
                obj.put("timestamp", System.currentTimeMillis())
                obj.put("read", false)
                val cutoff = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000
                val newArr = JSONArray()
                newArr.put(obj)
                for (i in 0 until arr.length()) {
                    val entry = arr.getJSONObject(i)
                    if (entry.optLong("timestamp", 0L) > cutoff) newArr.put(entry)
                }
                prefs.edit().putString(NOTIF_HISTORY_KEY, newArr.toString()).apply()
            }

        }
    }

    @JavascriptInterface fun postInAppNotificationsToSystem() {
        if (!usageBridge.hasUsagePermission()) return
        runCatching {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                nm.createNotificationChannel(NotificationChannel(NOTIF_CHANNEL_ID,"Aurelo Smart Alerts",NotificationManager.IMPORTANCE_DEFAULT).apply { description="Screen time and usage alerts"; lockscreenVisibility=android.app.Notification.VISIBILITY_PUBLIC; setShowBadge(true) })
            val launchIntent=context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pendingFlags=if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            val pendingIntent=if(launchIntent!=null) android.app.PendingIntent.getActivity(context,0,launchIntent,pendingFlags) else null
            val items=JSONArray(getNotifications()); var posted=0
            for (i in 0 until items.length()) {
                if (posted>=5) break
                val n=items.getJSONObject(i); val type=n.optString("type","info"); val title=n.optString("title",""); val body=n.optString("body","")
                if (title.isBlank()) continue
                val stableId=3000+((title+body).hashCode() and 0x7FFF)
                val (smallIcon,color,priority)=when(type){"warn"->Triple(android.R.drawable.ic_dialog_alert,0xFFF04E7A.toInt(),NotificationCompat.PRIORITY_HIGH);"success"->Triple(android.R.drawable.ic_dialog_info,0xFF12D48A.toInt(),NotificationCompat.PRIORITY_DEFAULT);else->Triple(android.R.drawable.ic_dialog_info,0xFF6C63FF.toInt(),NotificationCompat.PRIORITY_DEFAULT)}
                val notif=NotificationCompat.Builder(context,NOTIF_CHANNEL_ID).setSmallIcon(smallIcon).setColor(color).setContentTitle(title).setContentText(body)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setPriority(priority).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setCategory(if(type=="warn") NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER).setAutoCancel(true)
                    .apply { if(pendingIntent!=null) setContentIntent(pendingIntent) }.build()
                nm.notify(stableId, notif)
                posted++

                // Write to history
                runCatching {
                    val existing = prefs.getString(NOTIF_HISTORY_KEY, "[]") ?: "[]"
                    val arr = JSONArray(existing)
                    val obj = JSONObject()
                    obj.put("id", "$title|$body")
                    obj.put("type", type)
                    obj.put("title", title)
                    obj.put("body", body)
                    obj.put("timestamp", System.currentTimeMillis())
                    obj.put("read", false)
                    val cutoff = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000
                    val newArr = JSONArray()
                    newArr.put(obj)
                    for (i in 0 until arr.length()) {
                        val entry = arr.getJSONObject(i)
                        if (entry.optLong("timestamp", 0L) > cutoff) newArr.put(entry)
                    }
                    prefs.edit().putString(NOTIF_HISTORY_KEY, newArr.toString()).apply()
                }
            }
        }
    }

    private fun j(vararg pairs: Any): JSONObject { val obj=JSONObject(); var i=0; while(i+1<pairs.size){obj.put(pairs[i].toString(),pairs[i+1]);i+=2}; return obj }
}
