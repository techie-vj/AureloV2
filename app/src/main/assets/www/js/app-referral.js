/* ═══ app-referral.js — Referral screen: link sharing, stats, reward tiers ══
 * Opens as a full-screen panel via openPanel('referral-panel').
 * Driven by ReferralBridge @JavascriptInterface methods.
 * ════════════════════════════════════════════════════════════════════════════ */

const Referral = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let _stats = null;
  let _link  = '';

  // ── Public API ─────────────────────────────────────────────────────────────

  function open() {
    openPanel('referral-panel');
    _load();
  }

  function _load() {
    _link  = IS_NATIVE && typeof N.getReferralLink === 'function'
      ? (N.getReferralLink() || '')
      : 'https://play.google.com/store/apps/details?id=com.javikastudio.tidyapp';

    _stats = { shareCount: 0, totalInstalls: 0, totalConversions: 0,
               totalDaysEarned: 0, pending: 0 };

    if (IS_NATIVE && typeof N.getReferralStats === 'function') {
      try { _stats = JSON.parse(N.getReferralStats() || '{}'); } catch (_) {}
    }

    _render();
  }

  function _render() {
    const root = document.getElementById('referral-panel-body');
    if (!root) return;

    const isPro = typeof ProTier !== 'undefined' && ProTier.isPro;
    const totalDays = _stats.totalDaysEarned || 0;
    const pending   = _stats.pending || 0;
    const installed = _stats.totalInstalls || 0;
    const converted = _stats.totalConversions || 0;

    root.innerHTML = `

      <!-- Hero header -->
      <div style="text-align:center;padding:24px 20px 16px">
        <div style="font-size:44px;margin-bottom:10px;
                    filter:drop-shadow(0 0 18px rgba(18,212,138,.4))">🎁</div>
        <div style="font-family:var(--ff-d);font-size:22px;font-weight:700;
                    color:var(--t1);margin-bottom:6px">Give 21 days, earn Pro</div>
        <div style="font-family:var(--ff-m);font-size:13px;color:var(--t2);
                    line-height:1.65;max-width:310px;margin:0 auto">
          Share your link — your friend gets 21 days of Pro free.
          You earn when they stick around.
        </div>
      </div>

      <!-- Referral link box -->
      <div style="margin:0 16px 20px;border-radius:14px;
                  background:var(--s1);border:1px solid var(--border2);padding:14px">
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);
                    letter-spacing:1.5px;text-transform:uppercase;color:var(--t3);
                    margin-bottom:8px">Your referral link</div>
        <div style="display:flex;gap:8px;align-items:center">
          <div id="ref-link-text" style="flex:1;font-family:var(--ff-m);
               font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;
               white-space:nowrap;background:var(--s2);border:1px solid var(--border);
               border-radius:8px;padding:8px 10px">${_escLink(_link)}</div>
          <button onclick="Referral.copyLink()"
            style="flex-shrink:0;padding:8px 14px;border-radius:10px;border:none;
                   background:var(--p);color:#fff;font-family:var(--ff-m);
                   font-size:12px;font-weight:700;cursor:pointer" id="ref-copy-btn">
            Copy
          </button>
        </div>
        <button onclick="Referral.shareLink()"
          style="width:100%;margin-top:10px;padding:12px;border-radius:12px;border:none;
                 background:linear-gradient(135deg,var(--p),var(--c));color:#fff;
                 font-family:var(--ff-d);font-size:14px;font-weight:700;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;gap:8px">
          <span>📤</span> Share with a friend
        </button>
      </div>

      <!-- Stats row -->
      <div style="display:flex;gap:8px;margin:0 16px 20px">
        ${_statPill('👥', installed, 'Installed')}
        ${_statPill('⚡', converted, 'Converted')}
        ${_statPill('✦', totalDays + ' days', 'Pro earned')}
      </div>

      ${pending > 0 ? `
      <!-- Pending counter -->
      <div style="margin:0 16px 20px;border-radius:12px;
                  background:rgba(247,166,35,.08);border:1px solid rgba(247,166,35,.2);
                  padding:12px 14px;display:flex;align-items:center;gap:10px">
        <div style="font-size:18px">⏳</div>
        <div style="font-family:var(--ff-m);font-size:12px;color:var(--a);flex:1">
          <strong>${pending} friend${pending !== 1 ? 's' : ''} trying Pro</strong>
          — you'll earn when they subscribe.
        </div>
      </div>` : ''}

      ${(() => {
        const extLeft    = _stats.extensionDaysLeft || 0;
        const extBanked  = _stats.pendingExtDays || 0;
        const extActive  = _stats.extensionActive || false;

        if (extActive && extLeft > 0) {
          // Active extension running right now
          return `<div style="margin:0 16px 20px;border-radius:12px;
              background:rgba(18,212,138,.1);border:1px solid rgba(18,212,138,.3);
              padding:14px 16px;display:flex;align-items:center;gap:12px">
            <div style="font-size:22px">🟢</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:700;color:var(--g);margin-bottom:2px">
                Referral extension active
              </div>
              <div style="font-family:var(--ff-m);font-size:var(--text-2xs);color:var(--t2);line-height:1.5">
                Your subscription lapsed but your referral reward is keeping Pro alive.
                <strong>${extLeft} day${extLeft !== 1 ? 's' : ''} remaining.</strong>
              </div>
            </div>
          </div>`;
        }

        if (extBanked > 0) {
          // Days banked, waiting for subscription to lapse
          return `<div style="margin:0 16px 20px;border-radius:12px;
              background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.2);
              padding:12px 14px;display:flex;align-items:center;gap:10px">
            <div style="font-size:18px">💎</div>
            <div style="font-family:var(--ff-m);font-size:12px;color:var(--p);flex:1">
              <strong>${extBanked} day${extBanked !== 1 ? 's' : ''} banked</strong>
              — will extend your Pro automatically when your plan renews.
            </div>
          </div>`;
        }

        return '';
      })()}

      <!-- Reward tiers -->
      <div style="margin:0 16px 20px">
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);
                    letter-spacing:1.5px;text-transform:uppercase;color:var(--t3);
                    margin-bottom:10px">What you earn</div>
        ${_tierRow('📲', 'Friend installs', '+3 days Pro', 'Up to 3 installs per month')}
        ${_tierRow('📅', 'Friend goes monthly', '+1 month Pro', 'On their first payment')}
        ${_tierRow('📆', 'Friend goes annual', '+2 months Pro', 'On their first payment')}
        ${_tierRow('♾️', 'Friend goes lifetime', '+3 months Pro', 'On their first payment')}
      </div>

      <!-- What your friend gets -->
      <div style="margin:0 16px 20px;border-radius:14px;
                  background:rgba(18,212,138,.07);border:1px solid rgba(18,212,138,.18);
                  padding:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:20px">🌱</span>
          <div style="font-family:var(--ff-d);font-size:14px;font-weight:700;
                      color:var(--g)">Your friend gets 21 days free</div>
        </div>
        <div style="font-family:var(--ff-m);font-size:12px;color:var(--t2);line-height:1.65">
          They get 7 days standard trial + 14 bonus days — no credit card needed.
          That's 3 weeks to build better habits with Aurelo Pro.
        </div>
      </div>

      <!-- Bottom spacer -->
      <div style="height:32px"></div>
    `;
  }

  function _statPill(icon, value, label) {
    return `<div style="flex:1;border-radius:12px;background:var(--s1);
              border:1px solid var(--border2);padding:12px 8px;text-align:center">
      <div style="font-size:16px;margin-bottom:4px">${icon}</div>
      <div style="font-family:var(--ff-d);font-size:18px;font-weight:700;
                  color:var(--t1);margin-bottom:2px">${value}</div>
      <div style="font-family:var(--ff-m);font-size:var(--text-2xs);
                  color:var(--t3)">${label}</div>
    </div>`;
  }

  function _tierRow(icon, title, reward, sub) {
    return `<div style="display:flex;align-items:center;gap:12px;
              padding:12px 14px;border-radius:12px;background:var(--s1);
              border:1px solid var(--border2);margin-bottom:8px">
      <div style="font-size:20px;flex-shrink:0">${icon}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:var(--t1)">${title}</div>
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);
                    color:var(--t3);margin-top:1px">${sub}</div>
      </div>
      <div style="font-family:var(--ff-m);font-size:12px;font-weight:700;
                  color:var(--g);flex-shrink:0;white-space:nowrap">${reward}</div>
    </div>`;
  }

  function _escLink(url) {
    return url.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function copyLink() {
    if (!_link) return;
    try {
      navigator.clipboard.writeText(_link).then(() => {
        _afterShare();
        const btn = document.getElementById('ref-copy-btn');
        if (btn) { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
        if (typeof toast === 'function') toast('Link copied to clipboard', 'success');
      }).catch(() => _fallbackCopy());
    } catch (_) { _fallbackCopy(); }
  }

  function _fallbackCopy() {
    if (!_link) return;
    const ta = document.createElement('textarea');
    ta.value = _link;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    _afterShare();
    if (typeof toast === 'function') toast('Link copied to clipboard', 'success');
  }

  function shareLink() {
    if (!_link) return;
    const shareText = `I've been using Aurelo to build better screen time habits. Try it free for 21 days with my link:\n${_link}`;
    if (IS_NATIVE && typeof N.shareText === 'function') {
      N.shareText(shareText);
      _afterShare();
    } else if (navigator.share) {
      navigator.share({ title: 'Try Aurelo — Digital Wellbeing', text: shareText, url: _link })
        .then(_afterShare).catch(() => {});
    } else {
      copyLink();
    }
  }

  function _afterShare() {
    if (IS_NATIVE && typeof N.recordReferralShare === 'function') {
      try { N.recordReferralShare(); } catch (_) {}
    }
    // Reload stats so share count updates
    setTimeout(_load, 400);
  }

  // ── Home banner helper ─────────────────────────────────────────────────────

  function shouldShowHomeBanner() {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const lastShown = IS_NATIVE && typeof N.getStringPref === 'function'
        ? N.getStringPref('referral_banner_last_shown_date') : '';
      return lastShown !== today;
    } catch (_) { return true; }
  }

  function markBannerShown() {
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (IS_NATIVE && typeof N.setStringPref === 'function') {
        N.setStringPref('referral_banner_last_shown_date', today);
      }
    } catch (_) {}
  }

  return { open, copyLink, shareLink, shouldShowHomeBanner, markBannerShown };
})();

// ── Global entry point (called from settings referFriend row) ─────────────
function referFriend() {
  Referral.open();
}