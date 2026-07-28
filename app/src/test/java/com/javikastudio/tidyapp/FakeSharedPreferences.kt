package com.javikastudio.tidyapp

import android.content.SharedPreferences

/**
 * FakeSharedPreferences — minimal in-memory SharedPreferences for JVM unit tests.
 *
 * SharedPreferences (and its nested Editor) are plain interfaces in the Android
 * SDK, so this requires no mocking library and no Robolectric. apply()/commit()
 * write synchronously — fine for single-threaded unit tests.
 *
 * Used by ReferralManager_Tests.kt (Phase 2 test-quality fix) to call the real
 * com.javikastudio.tidyapp.ReferralManager functions directly instead of mirroring
 * their logic locally.
 */
class FakeSharedPreferences(initial: Map<String, Any?> = emptyMap()) : SharedPreferences {

    private val map = LinkedHashMap<String, Any?>(initial)

    override fun getAll(): MutableMap<String, *> = map.toMutableMap()
    override fun getString(key: String?, defValue: String?): String? = map[key] as? String ?: defValue

    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        (map[key] as? Set<String>)?.toMutableSet() ?: defValues

    override fun getInt(key: String?, defValue: Int): Int = map[key] as? Int ?: defValue
    override fun getLong(key: String?, defValue: Long): Long = map[key] as? Long ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = map[key] as? Float ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean = map[key] as? Boolean ?: defValue
    override fun contains(key: String?): Boolean = map.containsKey(key)
    override fun edit(): SharedPreferences.Editor = FakeEditor()
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    private inner class FakeEditor : SharedPreferences.Editor {
        private val pending = LinkedHashMap<String, Any?>()
        private val toRemove = mutableSetOf<String>()
        private var clearAll = false

        override fun putString(key: String?, value: String?) = apply { if (key != null) pending[key] = value }
        override fun putStringSet(key: String?, values: MutableSet<String>?) = apply { if (key != null) pending[key] = values }
        override fun putInt(key: String?, value: Int) = apply { if (key != null) pending[key] = value }
        override fun putLong(key: String?, value: Long) = apply { if (key != null) pending[key] = value }
        override fun putFloat(key: String?, value: Float) = apply { if (key != null) pending[key] = value }
        override fun putBoolean(key: String?, value: Boolean) = apply { if (key != null) pending[key] = value }
        override fun remove(key: String?) = apply { if (key != null) toRemove.add(key) }
        override fun clear() = apply { clearAll = true }
        override fun commit(): Boolean { flush(); return true }
        override fun apply() { flush() }

        private fun flush() {
            if (clearAll) map.clear()
            toRemove.forEach { map.remove(it) }
            map.putAll(pending)
        }
    }
}
