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
                    color:var(--t1);margin-bottom:6px">
          Unlock Pro for Life —<br>Friend by Friend.
        </div>

        <div style="font-family:var(--ff-m);font-size:13px;color:var(--t2);line-height:1.65;margin:0 0 14px">
          Gift a friend <strong style="color:var(--t1)">21 days of Pro</strong> to help them
          build better habits. For every friend who upgrades, you earn up to
          <strong style="color:var(--t1)">3 months of Pro</strong> for yourself.
          With <strong style="color:var(--t1)">no limit on rewards</strong>,
          your Pro access can stay active forever.
        </div>

        <div style="display:inline-block;font-family:var(--ff-m);font-size:11px;
                    color:var(--accent);background:rgba(18,212,138,.1);
                    border:1px solid rgba(18,212,138,.25);border-radius:20px;
                    padding:5px 14px;letter-spacing:.04em">
          ✦ UNLIMITED REWARDS WHEN FRIENDS GO PRO
        </div>
      </div>

      <!-- Referral link box -->
      <div style="margin:0 16px 20px;border-radius:14px;
                  background:var(--s1);border:1px solid var(--border2);padding:14px">
        <div style="font-family:var(--ff-m);font-size:var(--text-2xs);
                    letter-spacing:1.5px;text-transform:uppercase;color:var(--t3);
                    margin-bottom:8px">Your referral link</div>
        <div style="display:flex;gap:8px;align-items:flex-start;">
          <div id="ref-link-text" style="flex:1;font-family:var(--ff-m);
               font-size:11px;color:var(--t2);
               white-space:normal;word-break:break-all;background:var(--s2);border:1px solid var(--border);
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
        ${_statPill('shares',     '📢', _stats.shareCount || 0, 'Shared')}
        ${_statPill('installed',  '👥', installed,              'Installed')}
        ${_statPill('converted',  '⚡', converted,              'Joined Pro')}
        ${_statPill('daysEarned', '✦', totalDays + ' days',    'Pro earned')}
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
          // BUG-07 FIX: copy previously said "when your plan renews" which implies
          // extension stacks on top of an active sub. Extension only activates on
          // lapse (setProUser(false)), so the correct framing is "if your subscription ends".
          return `<div style="margin:0 16px 20px;border-radius:12px;
              background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.2);
              padding:12px 14px;display:flex;align-items:center;gap:10px">
            <div style="font-size:18px">💎</div>
            <div style="font-family:var(--ff-m);font-size:12px;color:var(--p);flex:1">
              <strong>${extBanked} day${extBanked !== 1 ? 's' : ''} banked</strong>
              — will activate automatically if your subscription ends, keeping Pro alive at no cost.
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
        ${_tierRow('📲', 'New Member Bonus',      '+3 days Pro',   'Up to 3 per month')}
        ${_tierRow('📅', 'Monthly Habit Reward',   '+1 month Pro',  'On their first payment')}
        ${_tierRow('📆', 'Annual Growth Bonus',    '+2 months Pro', 'On their first payment')}
        ${_tierRow('♾️', 'Lifetime Legacy Reward', '+3 months Pro', 'On their first payment')}
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
            They'll receive a 7-day trial + 14 bonus days —
            <strong style="color:var(--t1)">a full 3 weeks of Pro.</strong>
              It’s a powerful headstart on better habits, gifted by you.
              <br><br>
              <em>Standard Google Play trial terms apply.</em>
          </div>
      </div>

      <!-- Bottom spacer -->
      <div style="height:32px"></div>
    `;
  }

  // BUG-10 FIX: statKey param added — data-stat attribute enables in-place update by
  // _afterShare() without replacing root.innerHTML (which resets scroll position).
  function _statPill(statKey, icon, value, label) {
    return `<div style="flex:1;border-radius:12px;background:var(--s1);
              border:1px solid var(--border2);padding:12px 8px;text-align:center">
      <div style="font-size:16px;margin-bottom:4px">${icon}</div>
      <div data-stat="${statKey}" style="font-family:var(--ff-d);font-size:18px;font-weight:700;
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

  async function shareLink() {
    if (!_link) return;
    const shareText = `I gifted you 21 days of Aurelo Pro! 🎁.\nIt’s the perfect headstart to build better screen time habits and actually stick to them.\n👉 ${_link}`;

    // BUG-09 FIX: previously called N.shareText() — plain text only, no branded card.
    // Feature Reference §12.10 and §13.1 specify a "visually designed share card".
    // Now we render a canvas card and share it as an image + text via N.shareImageWithText().
    if (IS_NATIVE && typeof N.shareImageWithText === 'function') {
      await _renderShareCard(shareText);
    } else if (IS_NATIVE && typeof N.shareText === 'function') {
      N.shareText(shareText);
      _afterShare();
    } else if (navigator.share) {
      navigator.share({ title: 'Try Aurelo — Digital Wellbeing', text: shareText, url: _link })
        .then(_afterShare).catch(() => {});
    } else {
      copyLink();
    }
  }

  /**
   * BUG-09 FIX: Render the referral share card on a canvas element and share
   * as a 1080×1080 image + caption, matching the style of other Aurelo score cards
   * described in Feature Reference §13.1.
   * Uses _shareDrawHeader / _shareDrawFooter from app-share-utils.js for consistency.
   */
  async function _renderShareCard(shareText) {
    const SIZE = 1080;
    const FONT_M = "'Bodoni Moda', Georgia, serif";
    const canvas = document.createElement('canvas');
    canvas.width  = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    // Background gradient — indigo-to-emerald matching the referral green/purple palette
    const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    bg.addColorStop(0,   '#1A0A3C');
    bg.addColorStop(0.5, '#0D2B3A');
    bg.addColorStop(1,   '#0A2A1A');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // ── Header: resolve icon + use shared wordmark utility ──────────────────
    const icon = (typeof _shareResolveIcon === 'function') ? await _shareResolveIcon() : null;
    if (typeof _shareDrawHeader === 'function') {
      _shareDrawHeader(ctx, icon, 'Refer a Friend');
    } else {
      // Fallback if utils not loaded yet
      ctx.font        = `bold 48px ${FONT_M}`;
      ctx.fillStyle   = '#FFFFFF';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AURELO', SIZE / 2, 90);
    }

    // ── Referral gift icon ───────────────────────────────────────────────────
    ctx.font         = '150px serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎁', SIZE / 2, 330);

    // ── Headline ─────────────────────────────────────────────────────────────
    ctx.font      = `bold 68px ${FONT_M}`;
    ctx.fillStyle = '#12D48A';
    ctx.fillText('Try 21 days free', SIZE / 2, 470);

    // ── Sub-headline ─────────────────────────────────────────────────────────
    ctx.font      = `400 36px ${FONT_M}`;
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.fillText('Build better digital habits', SIZE / 2, 540);
    ctx.fillText('with Aurelo Pro', SIZE / 2, 586);

    // ── Referral code block (extracted from link) ────────────────────────────
    // BUG-C2 FIX: the previous regexes (/[?&]referral[_=]/ and /[?&]ref=/)
    // never matched the actual link format:
    //   https://play.google.com/…?id=…&referrer=aurelo_ref_XXXXXXXX
    // The code block was therefore always blank on the share card.
    // Match directly on the aurelo_ref_ prefix which is unique and stable.
    const codeMatch = _link ? _link.match(/aurelo_ref_([A-Z0-9]{8})/) : null;
    const refCode = codeMatch ? codeMatch[1] : null;

    if (refCode) {
      const codeBoxW = 500, codeBoxH = 80, codeBoxX = (SIZE - codeBoxW) / 2, codeBoxY = 636;
      _roundRect(ctx, codeBoxX, codeBoxY, codeBoxW, codeBoxH, 18);
      ctx.fillStyle = 'rgba(18,212,138,0.12)'; ctx.fill();
      ctx.strokeStyle = 'rgba(18,212,138,0.40)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle   = 'rgba(160,220,200,0.65)';
      ctx.font        = `400 22px ${FONT_M}`;
      ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Use my referral code', SIZE / 2, codeBoxY + 26);
      ctx.fillStyle = '#12D48A';
      ctx.font      = `bold 30px ${FONT_M}`;
      ctx.fillText(refCode, SIZE / 2, codeBoxY + 60);
    }

    // ── Link box — full URL, wrapped across two lines if needed ──────────────
    const linkBoxPad = 60, linkBoxY = refCode ? 748 : 660, linkBoxH = 80;
    const linkBoxW   = SIZE - linkBoxPad * 2;
    _roundRect(ctx, linkBoxPad, linkBoxY, linkBoxW, linkBoxH, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();

    // Split link into two lines at the '?' boundary so params wrap cleanly
    ctx.font      = `400 26px ${FONT_M}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const qIdx = _link ? _link.indexOf('?') : -1;
    if (qIdx > -1 && _link.length > 50) {
      const part1 = _link.slice(0, qIdx);
      const part2 = _link.slice(qIdx);
      ctx.fillText(part1, SIZE / 2, linkBoxY + 28);
      ctx.fillText(part2, SIZE / 2, linkBoxY + 58);
    } else {
      ctx.fillText(_link || '', SIZE / 2, linkBoxY + linkBoxH / 2);
    }

    // ── Footer: use shared utility for consistency ───────────────────────────
    if (typeof _shareDrawFooter === 'function') {
      _shareDrawFooter(ctx, SIZE);
    } else {
      ctx.font      = `400 28px ${FONT_M}`;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Available on Google Play', SIZE / 2, SIZE - 48);
    }

    const base64 = canvas.toDataURL('image/png').split(',')[1];
    if (base64) {
      N.shareImageWithText(base64, 'aurelo_referral_card', shareText);
      _afterShare();
    } else {
      // Fallback to text if canvas export fails
      N.shareText(shareText);
      _afterShare();
    }
  }

  /** Helper: draw a rounded rectangle path (no fill/stroke — caller does that). */
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function _afterShare() {
    if (IS_NATIVE && typeof N.recordReferralShare === 'function') {
      try { N.recordReferralShare(); } catch (_) {}
    }
    // BUG-10 FIX: previously called _load() which replaces root.innerHTML entirely,
    // throwing the user back to the top of the panel. Now update only the share-count
    // stat pill in-place. _stats.shareCount is incremented locally so the update is
    // instant without an extra bridge round-trip.
    if (_stats) _stats.shareCount = (_stats.shareCount || 0) + 1;
    const pills = document.querySelectorAll('#referral-panel-body [data-stat]');
    if (pills.length > 0) {
      // Update in-place if rendered pills are present
      pills.forEach(el => {
        if (el.dataset.stat === 'shareCount') el.textContent = _stats.shareCount;
      });
    } else {
      // Fallback: full reload only if the panel was not yet rendered
      setTimeout(_load, 400);
    }
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