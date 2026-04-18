/* ═══════════════════════════════════════════════════════════════════
 * bridge.js  —  Platform Abstraction Layer
 * v1.0 — Phase 1 (Android + iOS stub + Demo mode)
 *
 * LOAD ORDER: Must be the first JS file loaded (before app-core.js).
 *
 * All native bridge calls across every module go through:
 *   Bridge.call(method, ...args)       — synchronous (Android-style)
 *   Bridge.callAsync(method, args)     — Promise-based (required for iOS)
 *   Bridge.on(event, handler)          — subscribe to native-pushed events
 *   Bridge.isNative()                  — true on Android and iOS
 *   Bridge.platform()                  — 'android' | 'ios' | 'demo'
 *
 * Existing code that uses N.method() or window.AppBridge.method() continues
 * to work unmodified — N is re-exported as a proxy through Bridge so there
 * is zero call-site churn in Phase 1.  Migrate call sites to Bridge.call()
 * progressively in Phases 2–4.
 * ═══════════════════════════════════════════════════════════════════ */

const Bridge = (function () {
  'use strict';

  /* ── 1. Platform detection ──────────────────────────────────────── */
  function _detectPlatform() {
    if (window.AppBridge && typeof window.AppBridge.isNativeApp === 'function') {
      try { if (window.AppBridge.isNativeApp()) return 'android'; } catch (_) {}
    }
    if (window.AppBridge) return 'android';
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.aurelo) {
      return 'ios';
    }
    return 'demo';
  }

  const _platform = _detectPlatform();
  const _isNative = _platform === 'android' || _platform === 'ios';

  /* ── 2. Pending iOS callbacks ───────────────────────────────────── */
  let _callbackSeq = 0;
  const _pending   = {};   // callbackId → { resolve, reject, timer }

  /* Called by the iOS WKWebView native layer to resolve a pending callAsync */
  function _resolve(callbackId, resultJson) {
    const cb = _pending[callbackId];
    if (!cb) return;
    clearTimeout(cb.timer);
    delete _pending[callbackId];
    try { cb.resolve(typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson); }
    catch (_) { cb.resolve(resultJson); }
  }

  function _reject(callbackId, errorMsg) {
    const cb = _pending[callbackId];
    if (!cb) return;
    clearTimeout(cb.timer);
    delete _pending[callbackId];
    cb.reject(new Error(errorMsg || 'Bridge error'));
  }

  /* ── 3. Android sync call ───────────────────────────────────────── */
  function _callAndroid(method, args) {
    const bridge = window.AppBridge;
    if (!bridge || typeof bridge[method] !== 'function') {
      console.warn('[Bridge] Android: unknown method', method);
      return null;
    }
    try { return bridge[method](...args); }
    catch (e) { console.error('[Bridge] Android call failed:', method, e); return null; }
  }

  /* ── 4. iOS async call ──────────────────────────────────────────── */
  function _callIos(method, args) {
    return new Promise((resolve, reject) => {
      const id    = 'cb_' + (++_callbackSeq);
      const timer = setTimeout(() => {
        delete _pending[id];
        reject(new Error('[Bridge] iOS timeout: ' + method));
      }, 10000);
      _pending[id] = { resolve, reject, timer };
      try {
        window.webkit.messageHandlers.aurelo.postMessage(
          JSON.stringify({ method, args: args || [], callbackId: id })
        );
      } catch (e) {
        clearTimeout(timer);
        delete _pending[id];
        reject(e);
      }
    });
  }

  /* ── 5. Demo mode stubs ─────────────────────────────────────────── */
  const _demoStubs = {
    isNativeApp:           () => false,
    getTotalScreenTimeToday: () => 127,
    getStreakDays:         () => 5,
    getDailyUsageStats:    () => '[]',
    getWeeklyBreakdown:    () => '[]',
    getHourlyBreakdownToday: () => '[]',
    getFocusSessionState:  () => 'null',
    getSettings:           () => '{}',
    getBedtimeSettings:    () => '{}',
    getFocusRoutines:      () => '[]',
    isProUser:             () => false,
    hasUsagePermission:    () => false,
    hasOverlayPermission:  () => false,
    hasAccessibilityPermission: () => false,
  };

  function _callDemo(method) {
    const stub = _demoStubs[method];
    return typeof stub === 'function' ? stub() : null;
  }

  /* ── 6. Event bus (native → JS) ────────────────────────────────── */
  const _listeners = {};   // eventName → [handler, ...]

  function _emit(event, data) {
    (_listeners[event] || []).forEach(h => { try { h(data); } catch (_) {} });
  }

  /* ── 7. Public API ──────────────────────────────────────────────── */

  /**
   * Synchronous call (Android semantics).
   * On iOS this still dispatches but returns undefined — migrate to callAsync.
   */
  function call(method) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (_platform === 'android') return _callAndroid(method, args);
    if (_platform === 'ios')     { _callIos(method, args); return undefined; }
    return _callDemo(method, args);
  }

  /**
   * Async call — always returns a Promise.
   * Use this for all new call sites; required for iOS compatibility.
   */
  function callAsync(method, args) {
    if (_platform === 'android') {
      return Promise.resolve(_callAndroid(method, args || []));
    }
    if (_platform === 'ios') return _callIos(method, args);
    return Promise.resolve(_callDemo(method));
  }

  /** Subscribe to native-pushed events (e.g. 'focusSessionEnded', 'appResume') */
  function on(event, handler) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(handler);
  }

  function off(event, handler) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(h => h !== handler);
  }

  function isNative() { return _isNative; }
  function platform() { return _platform; }

  const publicAPI = { call, callAsync, on, off, isNative, platform, _resolve, _reject, _emit };

  /* ── 8. Backward-compat: expose N as bridge proxy ──────────────── */
  // Existing code uses N.method() (N is set to window.AppBridge in app-core.js).
  // We leave that assignment alone.  New code should use Bridge.call() instead.
  // This comment serves as the migration marker — grep for "N\." to find sites.

  return publicAPI;
})();

/* Make Bridge globally available */
window.Bridge = Bridge;
