/**
 * pro-gate.js — Aurelo Pro tier gate system
 *
 * Drop into assets/www/ and load via <script src="pro-gate.js"></script>
 * in index.html BEFORE any tab JS files.
 *
 * Exposes a single global: window.ProTier
 *
 * Usage:
 *   ProTier.init()                        // call on app load
 *   ProTier.isPro                         // boolean, read anywhere
 *   ProTier.canAccess('MONTHLY_CALENDAR') // true/false
 *   ProTier.triggerUpsell('FOCUS_SCHEDULE') // shows bottom sheet
 *   ProTier.applyBlur(element, featureKey)  // wraps element in blur gate
 *   ProTier.applyLock(element, featureKey)  // dims + shows lock badge
 *   ProTier.applyCeiling(count, limit, featureKey, onAtLimit) // ceiling nudge
 *   ProTier.applyTeaser(container, featureKey, icon, label, desc) // ghost row
 */

(function(window) {
  'use strict';

  // ── FEATURE REGISTRY ──────────────────────────────────────────
  // Maps feature key → { tier, gate, upsell, limit? }
  const FEATURES = {
    // Screen Time
    TODAY_TOP_APPS_UNLIMITED:  { tier:'pro', gate:'blur',    upsell:'unlimited_apps_list' },
    HOME_INSIGHT:              { tier:'free', gate:'blur',    upsell:'home_insight' },
    MONTHLY_CALENDAR:          { tier:'pro', gate:'lock',    upsell:'monthly_depth' },
    MONTHLY_APP_DNA:           { tier:'pro', gate:'blur',    upsell:'monthly_depth' },
    MONTHLY_STREAK_GRID:       { tier:'pro', gate:'lock',    upsell:'monthly_depth' },
    ALL_APPS_WEEK_MONTH:       { tier:'pro', gate:'lock',    upsell:'history_depth' },
    TIDY_SCORE_PILLARS:        { tier:'pro', gate:'lock',    upsell:'tidy_score_pillars' },
    // Categories
    UNLIMITED_CATEGORIES:      { tier:'pro', gate:'lock',    upsell:'categories' },
    PLAY_STORE_SYNC:           { tier:'pro', gate:'lock',    upsell:'categories' },
    // Widget
    WIDGET_AMOLED:             { tier:'pro', gate:'lock',    upsell:'widget_themes' },
    WIDGET_STATS_INSIGHT:      { tier:'pro', gate:'blur',    upsell:'widget_insight' },
    // Goals
    STREAK_CALENDAR:           { tier:'pro', gate:'lock',    upsell:'streak_depth' },
    // Focus
    FOCUS_APPS_UNLIMITED:      { tier:'pro', gate:'ceiling', upsell:'focus_unlimited', limit:3 },
    FOCUS_SCHEDULE:            { tier:'pro', gate:'teaser',  upsell:'focus_schedule' },
    FOCUS_HISTORY:             { tier:'pro', gate:'teaser',  upsell:'focus_history' },
    WEEKLY_CHALLENGE:          { tier:'pro', gate:'blur',    upsell:'weekly_challenge' },

    // App Management
    LOCKED_APPS_UNLIMITED:     { tier:'pro', gate:'ceiling', upsell:'app_mgmt', limit:3 },
    HIDDEN_APPS_UNLIMITED:     { tier:'pro', gate:'ceiling', upsell:'app_mgmt', limit:3 },
    MINDFUL_OPENING_UNLIMITED: { tier:'pro', gate:'ceiling', upsell:'mindful_unlimited', limit:3 },
    TIMER_APPS_UNLIMITED:     { tier:'pro', gate:'ceiling', upsell:'timer_unlimited', limit:3 },
    // Appearance
    BEDTIME_MODE:              { tier:'pro', gate:'blur',    upsell:'bedtime' },
    THEME_AMOLED_PLUS:         { tier:'pro', gate:'lock',    upsell:'themes' },
    // Monetisation
    AD_FREE:                   { tier:'pro', gate:'lock',    upsell:'ad_free' },
  };

  // ── STATE ──────────────────────────────────────────────────────
  // SEC-04 FIX: _isPro is stored in a closure variable and never exposed on window.
  // External JS cannot set ProTier.isPro directly (it is a read-only getter on the export).
  // All mutations must go through _setIsPro() which validates the call comes from
  // the expected native bridge callback or the init path, not arbitrary JS.
  let _isPro = false;
  let _proInitialised = false;  // true once native billing has responded at least once

  function _setIsPro(val, source) {
    // Only accept boolean values from recognised sources
    if (typeof val !== 'boolean') return;
    _isPro = val;
    _proInitialised = true;
  }

  // ── INIT ───────────────────────────────────────────────────────
  function init() {
    // Read from native cache first — instant, no Play query needed
    try {
      _setIsPro(!!AppBridge.getProStatus(), 'init-native');
    } catch(e) {
      _setIsPro(false, 'init-fallback');
    }
    _applyProClass();

    // Pro status callback from BillingManager (fires async after Play connects)
    window.onProStatusChanged = function(isPro) {
      _setIsPro(!!isPro, 'billing-callback');
      _applyProClass();

      if (isPro) {
        // If upsell sheet is open — show success state before closing
        if (window.ProUpsell) window.ProUpsell.onPurchaseSuccess();
        // Update settings rows
        _updateSettingsRows(true);
      } else {
        _updateSettingsRows(false);
      }

      // Re-run all existing gate checks in the current view
      _refreshAllGates();
      // Update header pill
      _updateHeader();
    };

    window.onBillingError = function(code, message) {
      console.warn('[ProGate] Billing error ' + code + ': ' + message);
      // ProUpsell will pick this up if the sheet is open
      if (window.ProUpsell) window.ProUpsell.onBillingError(message);
    };

    // NOTE: onRestoreStarted and onRestoreNoPurchase are owned by pro-upsell.js
    // which manages _restoreInProgress and _clearRestoreTimeout internally.

    _updateHeader();
    _updateSettingsRows(_isPro);
  }

  // ── CORE API ───────────────────────────────────────────────────
  function canAccess(featureKey) {
    const f = FEATURES[featureKey];
    if (!f || f.tier === 'free') return true;
    return _isPro;
  }

  function getGate(featureKey) {
    const f = FEATURES[featureKey];
    if (!f || f.tier === 'free' || _isPro) return 'free';
    return f.gate;
  }

  function getLimit(featureKey) {
    if (_isPro) return Infinity;
    return FEATURES[featureKey]?.limit ?? Infinity;
  }

  function triggerUpsell(featureKey, context) {
    if (_isPro) return;
    const f = FEATURES[featureKey];
    if (!f) return;
    if (window.ProUpsell) {
      window.ProUpsell.show(f.upsell, context || null);
    }
  }

  // ── GATE RENDERERS ─────────────────────────────────────────────

  /**
   * A — Blur gate. Wraps element content, overlays Pro badge.
   * @param {HTMLElement} el — the element to gate
   * @param {string} featureKey
   * @param {string} [label] — optional overlay label
   */
  function applyBlur(el, featureKey, label) {
    if (canAccess(featureKey)) { _clearGate(el); return; }
    label = label || 'Pro feature — tap to unlock';
    el.classList.add('pg-blur-wrap');
    el.dataset.pgFeature = featureKey;
    el.dataset.pgGate = 'blur';
    el.innerHTML =
      '<div class="pg-blur-content">' + el.innerHTML + '</div>' +
      '<div class="pg-blur-overlay" role="button" tabindex="0">' +
        '<span class="pg-pro-badge">✦ PRO</span>' +
        '<span class="pg-blur-hint">' + _esc(label) + '</span>' +
      '</div>';
    el.querySelector('.pg-blur-overlay').onclick = function() {
      triggerUpsell(featureKey);
    };
  }

  /**
   * B — Lock gate. Dims element, adds lock + Pro chip.
   * @param {HTMLElement} el
   * @param {string} featureKey
   */
  function applyLock(el, featureKey) {
    if (canAccess(featureKey)) { _clearGate(el); return; }
    el.classList.add('pg-lock-wrap');
    el.dataset.pgFeature = featureKey;
    el.dataset.pgGate = 'lock';
    const badge = document.createElement('div');
    badge.className = 'pg-lock-badge';
    badge.innerHTML = '<span class="pg-lock-icon">🔒</span><span class="pg-pro-chip">✦ Pro</span>';
    el.style.position = 'relative';
    el.appendChild(badge);
    el.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      triggerUpsell(featureKey);
    };
  }

  /**
   * C — Ceiling gate. Call when user tries to add item beyond limit.
   * Inserts a nudge element after `afterEl`.
   * @param {number} count — current item count
   * @param {string} featureKey — must have .limit defined
   * @param {HTMLElement} afterEl — nudge inserted after this element
   * @param {string} [context] — optional context variant ('work' etc.)
   * @returns {boolean} true if at ceiling (nudge shown), false if allowed
   */
  function applyCeiling(count, featureKey, afterEl, context) {
    const limit = getLimit(featureKey);
    if (_isPro || count < limit) {
      // Remove any existing nudge
      const existing = afterEl.parentNode
        ? afterEl.parentNode.querySelector('.pg-ceiling-nudge[data-feature="' + featureKey + '"]')
        : null;
      if (existing) existing.remove();
      return false;
    }

    // Already at ceiling — show nudge if not already showing
    if (afterEl.nextSibling && afterEl.nextSibling.classList &&
        afterEl.nextSibling.classList.contains('pg-ceiling-nudge')) {
      return true; // nudge already visible
    }

    const nudge = document.createElement('div');
    nudge.className = 'pg-ceiling-nudge';
    nudge.dataset.feature = featureKey;
    nudge.innerHTML =
      '<span class="pg-ceiling-star">✦</span>' +
      '<span>' + count + '/' + limit + ' · Unlock unlimited with Pro</span>';
    nudge.onclick = function() { triggerUpsell(featureKey, context); };

    if (afterEl.nextSibling) {
      afterEl.parentNode.insertBefore(nudge, afterEl.nextSibling);
    } else {
      afterEl.parentNode.appendChild(nudge);
    }
    return true;
  }

  /**
   * D — Teaser row. Inserts a greyed ghost row into `container`.
   * If user is Pro, renders nothing (the real feature should already be shown).
   * @param {HTMLElement} container — parent element to append teaser into
   * @param {string} featureKey
   * @param {string} icon — emoji or text icon
   * @param {string} label — row title
   * @param {string} [desc] — optional subtitle
   */
  function applyTeaser(container, featureKey, icon, label, desc) {
    if (canAccess(featureKey)) return; // Pro sees real content, not teaser

    const row = document.createElement('div');
    row.className = 'pg-teaser-row';
    row.dataset.pgFeature = featureKey;
    row.dataset.pgGate = 'teaser';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.innerHTML =
      '<div class="pg-teaser-icon">' + _esc(icon) + '</div>' +
      '<div class="pg-teaser-text" style="display:flex;flex-direction:column;flex:1;min-width:0">' +
        '<span class="pg-teaser-label">' + _esc(label) + '</span>' +
        (desc ? '<span class="pg-teaser-desc">' + _esc(desc) + '</span>' : '') +
      '</div>' +
      '<div class="pg-teaser-right">' +
        '<span class="pg-pro-chip">✦ Pro</span>' +
        '<span class="pg-lock-icon-sm">🔒</span>' +
      '</div>';
    row.onclick = function() { triggerUpsell(featureKey); };
    container.appendChild(row);
  }

  // ── SETTINGS ROWS ─────────────────────────────────────────────
  function _updateSettingsRows(isPro) {
    var upgradeRow   = document.getElementById('upgrade-row');
    var proStatusRow = document.getElementById('pro-status-row');
    var restoreRow   = document.getElementById('restore-row');

    if (upgradeRow)   upgradeRow.style.display   = isPro ? 'none' : 'flex';
    if (proStatusRow) proStatusRow.style.display = isPro ? 'flex' : 'none';
    // Hide restore once Pro is confirmed — no need to restore what's active
    if (restoreRow)   restoreRow.style.display   = isPro ? 'none' : 'flex';

    // Update the settings identity card (upgrade CTA vs Pro pill)
    if (typeof _updateSettingsIdentityCard === 'function') {
      _updateSettingsIdentityCard(isPro);
    }
  }

  // ── HEADER (Option E) ─────────────────────────────────────────
  function _updateHeader() {
    const header = document.querySelector('.aurelo-header, [data-aurelo-header], #app-header');
    if (!header) return;

    if (_isPro) {
      header.classList.add('aurelo-header--pro');
      // Add Pro pill if not already there
      if (!header.querySelector('.pg-pro-pill')) {
        const titleEl = header.querySelector('.aurelo-header-title, h1, [data-header-title]');
        if (titleEl) {
          const pill = document.createElement('span');
          pill.className = 'pg-pro-pill';
          pill.innerHTML = '<span class="pg-pill-star">✦</span><span class="pg-pill-text">PRO</span>';
          titleEl.insertAdjacentElement('afterend', pill);
        }
      }
    } else {
      header.classList.remove('aurelo-header--pro');
      const pill = header.querySelector('.pg-pro-pill');
      if (pill) pill.remove();
    }
  }

  // ── INTERNAL ───────────────────────────────────────────────────
  function _applyProClass() {
    document.documentElement.classList.toggle('aurelo-pro', _isPro);
    document.documentElement.classList.toggle('aurelo-free', !_isPro);
  }

  /**
   * After a tier change (upgrade/downgrade), refresh all gated elements
   * that are currently in the DOM so they re-evaluate their state.
   */
  function _refreshAllGates() {
    // Remove all existing gate wrappers — the underlying views will re-apply
    // their own gate on next render cycle. This is safe because each tab
    // re-renders on focus in Aurelo's architecture.
    document.querySelectorAll('[data-pg-gate]').forEach(function(el) {
      _clearGate(el);
    });
    document.querySelectorAll('.pg-ceiling-nudge').forEach(function(el) {
      el.remove();
    });
    document.querySelectorAll('.pg-teaser-row').forEach(function(el) {
      el.remove();
    });
    _updateHeader();
  }

  function _clearGate(el) {
    el.classList.remove('pg-blur-wrap', 'pg-lock-wrap');
    delete el.dataset.pgFeature;
    delete el.dataset.pgGate;
    el.onclick = null;
    // If blur gate, restore inner content
    const content = el.querySelector('.pg-blur-content');
    if (content) {
      el.innerHTML = content.innerHTML;
    }
    // Remove lock badge
    const badge = el.querySelector('.pg-lock-badge');
    if (badge) badge.remove();
  }


  function _esc(str) {
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ── INJECT GATE CSS (at parse time, not lazily) ───────────────
  (function _injectGateCSS() {
    if (document.getElementById('pg-gate-css')) return;
    const s = document.createElement('style');
    s.id = 'pg-gate-css';
    s.textContent = `
      .pg-blur-wrap { position: relative; border-radius: 14px; overflow: hidden; cursor: pointer; }
      .pg-blur-content {
        filter: blur(2px);
        user-select: none;
        pointer-events: none;
        opacity: 1;
      }
      .pg-blur-overlay {
        position: absolute; inset: 0; border-radius: 14px;
        background: transparent;   /* was transparent — subtle dark wash */
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
        border: 1px solid rgba(124,111,247,0.15); transition: background 0.2s;
      }
      .pg-blur-overlay:hover { background: rgba(14,15,19,0.1); }
      .pg-blur-hint { font-size: 10px; color: rgba(255,255,255,0.4); font-family: monospace; }
      .pg-pro-badge {
        display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 40px;
        background: linear-gradient(135deg,#7c6ff7,#9b6fff);
        color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; font-family: monospace;
      }
      .pg-pro-chip {
        display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 40px;
        background: rgba(247,201,72,0.12); border: 1px solid rgba(247,201,72,0.25);
        color: #f7c948; font-size: 10px; font-weight: 700; font-family: monospace;
      }
      .pg-lock-wrap { position: relative; cursor: pointer; }
      .pg-lock-wrap > *:not(.pg-lock-badge) { opacity: 0.4; pointer-events: none; }
      .pg-lock-badge {
        position: absolute; top: 50%; right: 14px; transform: translateY(-50%);
        display: flex; align-items: center; gap: 6px;
      }
      .pg-lock-icon { font-size: 14px; opacity: 0.7; }
      .pg-ceiling-nudge {
        display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-top: 6px;
        border-radius: 8px; background: rgba(78,205,196,0.08); border: 1px solid rgba(78,205,196,0.2);
        color: #4ecdc4; font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .pg-ceiling-star { font-size: 10px; opacity: 0.75; }
      .pg-teaser-row {
        display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-radius: 14px;
        background: var(--s0); border: 1px solid #2a2d3a;
        cursor: pointer; opacity: 0.65; transition: opacity 0.2s, border-color 0.2s;
      }
      .pg-teaser-row:hover { opacity: 0.85; border-color: rgba(247,201,72,0.25); }
      .pg-teaser-icon {
        width: 34px; height: 34px; border-radius: 9px; background: #252836;
        display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
      }
      .pg-teaser-text { flex: 1; min-width: 0; }
      .pg-teaser-label { display: block; font-size: 13.5px; font-weight: 600; color: #e8eaf0; }
      .pg-teaser-desc  { display: block; font-size: 11px; color: #5c6070; margin-top: 2px; }
      .pg-teaser-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .pg-lock-icon-sm { font-size: 11px; opacity: 0.5; }
    `;
    document.head.appendChild(s);
  })();

  // ── EXPOSE ────────────────────────────────────────────────────
  // SEC-04 FIX: Re-verify Pro status when app returns to foreground.
  // This closes the window where a Frida hook sets _isPro=true during backgrounding
  // and the app never re-queries the billing client.
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && _proInitialised) {
      try {
        // Re-read from native cache (fast, synchronous). BillingManager will also
        // fire onProStatusChanged async once Play billing reconnects.
        const nativeStatus = !!AppBridge.getProStatus();
        _setIsPro(nativeStatus, 'foreground-reverify');
        _applyProClass();
        _refreshAllGates();
      } catch(e) { /* AppBridge not available in web preview */ }
    }
  });

  window.ProTier = {
    init,
    get isPro() { return _isPro; },  // SEC-04: read-only getter, _isPro closure is not externally accessible
    canAccess,
    getGate,
    getLimit,
    triggerUpsell,
    applyBlur,
    applyLock,
    applyCeiling,
    applyTeaser,
  };

})(window);