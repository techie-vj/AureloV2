/* ═══════════════════════════════════════════════════════════════════════════
   app-share-utils.js — Canvas utilities, icon resolution and shared drawing
   primitives. Loaded before app-share.js.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   app-share.js  —  Centralised share-card renderer + dispatcher
   ═══════════════════════════════════════════════════════════════════════════

   Load order: after app-core.js (needs IS_NATIVE, N, S, nCall, toast, SELF_PKG)
               before app-wellness.js and app-settings.js (they call into it)

   ── Public API ─────────────────────────────────────────────────────────────

     shareCard(type, opts?)
       type  'streak' | 'weekly' | 'referral'
       opts  { referralCode?: string }   (future referral programme)

   ── Call sites ─────────────────────────────────────────────────────────────

     app-home.js      renderStreakShareButton  →  shareCard('streak')
     app-wellness.js  shareStats(type)         →  shareCard(type)       [thin alias]
     app-settings.js  referFriend()            →  shareCard('referral')

   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Internal: time formatter (no DOM dependency) ────────────────────────── */
function _fmtShare(m) {
  if (!m || m <= 0) return '0m';
  const h = Math.floor(m / 60), mn = m % 60;
  if (h > 0 && mn > 0) return `${h}h ${mn}m`;
  if (h > 0) return `${h}h`;
  return `${mn}m`;
}

/* ── Polyfill ctx.roundRect for older Android WebViews ──────────────────── */
(function _polyfillRoundRect() {
  const proto = CanvasRenderingContext2D.prototype;
  if (proto.roundRect) return; // already supported

  proto.roundRect = function(x, y, w, h, radii) {
    let tl, tr, br, bl;
    if (typeof radii === 'number') {
      tl = tr = br = bl = radii;
    } else if (Array.isArray(radii)) {
      [tl = 0, tr = tl, br = tl, bl = tr] = radii;
    } else {
      tl = tr = br = bl = 0;
    }
    // Clamp radii so they don't exceed half the box
    const maxR = Math.min(w, h) / 2;
    tl = Math.min(tl, maxR); tr = Math.min(tr, maxR);
    br = Math.min(br, maxR); bl = Math.min(bl, maxR);

    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    this.arcTo(x + w, y,         x + w, y + tr,         tr);
    this.lineTo(x + w, y + h - br);
    this.arcTo(x + w, y + h,     x + w - br, y + h,     br);
    this.lineTo(x + bl, y + h);
    this.arcTo(x,     y + h,     x,         y + h - bl, bl);
    this.lineTo(x,     y + tl);
    this.arcTo(x,     y,         x + tl,    y,          tl);
    this.closePath();
  };
})();

/* ── Module-level icon cache ─────────────────────────────────────────────── */
let _cachedShareIcon = null;

/* ── Internal: resolve the app icon from whatever DOM element has it ──────── */
async function _shareResolveIcon() {
  // Return cached icon if already resolved
  if (_cachedShareIcon) return _cachedShareIcon;

  // 0. Use the global base64 icon if available (safest, no canvas tainting)
  const b64 = window.AURELO_ICON_B64;
  if (b64 && typeof b64 === 'string' && b64.startsWith('data:image/') && b64.length > 200) {
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('B64 Load Failed'));
        i.src = window.AURELO_ICON_B64;
      });
      if (img.naturalWidth > 0) {
        _cachedShareIcon = img;
        return img;
      }
    } catch (e) {

      console.warn('[share] AURELO_ICON_B64 resolve failed, trying SVG path', e);
    }
  }

  // 1. Serialise #ls-logo SVG to raster — always in DOM, no native dependency.
  //    Uses base64 data URL to avoid Blob URL security restrictions in WebView.
  const svgEl = document.querySelector('#ls-logo svg') || document.querySelector('.ls-mark svg');
  if (svgEl) {
    try {
      const svgStr = new XMLSerializer().serializeToString(svgEl);
      // encodeURIComponent → unescape ensures multi-byte chars survive btoa
      const encoded = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('SVG raster failed'));
        i.src = encoded;
      });
      if (img.naturalWidth > 0) {
        _cachedShareIcon = img;
        return img;
      }
    } catch (e) {
      console.warn('[share] SVG serialise path failed, falling back to DOM imgs', e);
    }
  }

  // 2. Remaining DOM img fallbacks
  return new Promise(resolve => {
    const tryResolveFromImg = (img) => {
      if (!img || !img.src) return false;

      // Already loaded and valid
      if (img.complete && img.naturalWidth > 0) {
        _cachedShareIcon = img;
        resolve(img);
        return true;
      }

      // Has a data: src — create a fresh Image to ensure it loads
      if (img.src.startsWith('data:')) {
        const fresh = new Image();
        fresh.onload = () => { _cachedShareIcon = fresh; resolve(fresh); };
        fresh.onerror = () => resolve(null);
        fresh.src = img.src;
        return true;
      }

      // Has a non-data src but browser says it's loaded
      if (img.complete && img.src) {
        _cachedShareIcon = img;
        resolve(img);
        return true;
      }

      return false;
    };

    // Settings icon (set by onPageReady via app-icon:// bridge)
    const si = document.getElementById('settings-app-icon');
    if (tryResolveFromImg(si)) return;

    // Broad fallback: any img with a data: src anywhere in the DOM
    const allImgs = Array.from(document.querySelectorAll('img[src^="data:"]'));
    for (const img of allImgs) {
      if (img.naturalWidth > 0 && tryResolveFromImg(img)) return;
    }

    // Nothing found — will draw the "A" lettermark fallback
    resolve(null);
  });
}

/* ── Internal: ensure Aurelo brand fonts are loaded before canvas draws ─────
   Canvas will silently fall back to system-ui if fonts aren't available,
   so this is best-effort — never throws.                                     */
async function _shareEnsureFonts() {
  if (!document.fonts || typeof document.fonts.load !== 'function') return;
  try {
    await Promise.all([
      document.fonts.load("300 48px 'Bodoni Moda'"),
      document.fonts.load("italic 300 48px 'Bodoni Moda'"),
      document.fonts.load("bold 24px 'JetBrains Mono'"),
      document.fonts.load("400 24px 'JetBrains Mono'"),
    ]);
  } catch (_) { /* silent — will fall back to system fonts */ }
}

/* ── Internal: draw icon or gradient fallback + "A" lettermark ───────────── */
function _shareDrawIcon(ctx, icon, x, y, size, radius) {
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, size, size, radius); ctx.clip();
  if (icon) {
    ctx.drawImage(icon, x, y, size, size);
  } else {
    // Fallback: Aurelo gold gradient + "A" in Bodoni Moda
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, '#FFE082'); g.addColorStop(0.55, '#FFAA44'); g.addColorStop(1, '#FF7020');
    ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = `italic 300 ${Math.round(size * 0.58)}px 'Bodoni Moda', Georgia, serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('A', x + size / 2, y + size / 2 + Math.round(size * 0.03));
  }
  ctx.restore();
}

/* ── Internal: shared canvas helpers ─────────────────────────────────────── */
function _shareRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function _shareGlow(ctx, cx, cy, radius, color) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
}

/* ── Internal: shared branded header (arch logo + URELO wordmark + subtitle) ─
   Draws the same wordmark as the app header: Canvas-rendered arch + apex dot
   beside "URELO" in Bodoni Moda light with gold gradient.
   Divider lands at y≈172. Caller should save/restore if needed.             */
function _shareDrawHeader(ctx, _icon, subtitle) {
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  ctx.save();

  // ── Arch logo — rendered from SVG path (viewBox 0 0 108 108) ────────────
  // M 22 88 C 22 88 30 30 54 20 C 78 30 86 88 86 88
  const logoX = 80, logoY = 62, logoSz = 78;
  const scale  = logoSz / 108;

  ctx.save();
  ctx.translate(logoX, logoY);
  ctx.scale(scale, scale);

  // Arch path
  ctx.beginPath();
  ctx.moveTo(22, 88);
  ctx.bezierCurveTo(22, 88, 30, 30, 54, 20);
  ctx.bezierCurveTo(78, 30, 86, 88, 86, 88);

  // Gold gradient in un-scaled (SVG) coordinates — honours the translate+scale
  const archGrad = ctx.createLinearGradient(28, 20, 80, 90);
  archGrad.addColorStop(0,    '#FFE082');
  archGrad.addColorStop(0.55, '#FFAA44');
  archGrad.addColorStop(1,    '#FF7020');

  ctx.strokeStyle = archGrad;
  ctx.lineWidth   = 7.5;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Thin outer glow stroke (50% alpha)
  ctx.globalAlpha = 0.5;
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Apex dot
  const dotGrad = ctx.createRadialGradient(54, 20, 0, 54, 20, 5.5);
  dotGrad.addColorStop(0, '#FFF3C0');
  dotGrad.addColorStop(1, '#FFD060');
  ctx.fillStyle = dotGrad;
  ctx.beginPath();
  ctx.arc(54, 20, 5.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore(); // undo translate + scale

  // ── "URELO" text — right of logo, baseline-aligned with arch feet ───────
  // Derive positions from actual SVG path extents (viewBox 0 0 108 108):
  //   arch right edge x=86, arch baseline (feet) y=88
  // Scaling these into canvas space avoids the bounding-box gap and the
  // em-square misalignment that 'middle' + logoSz/2 caused.
  const archRightSVG = 86;             // rightmost x in the bezier path
  const archBaseSVG  = 88;             // y of the arch feet (baseline)
  const textX = logoX + archRightSVG * scale + 6;   // tight gap after arch (~148 px)
  const textY = logoY + archBaseSVG  * scale;        // shared baseline (~125 px)

  const goldG = ctx.createLinearGradient(textX, textY - 52, textX + 250, textY + 4);
  goldG.addColorStop(0,    '#FFE082');
  goldG.addColorStop(0.55, '#FFAA44');
  goldG.addColorStop(1,    '#FF7020');

  ctx.fillStyle    = goldG;
  ctx.font         = `300 52px ${FONT_D}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';     // baseline = arch feet, not em-square mid
  ctx.fillText('URELO', textX, textY);

  // ── Subtitle ─────────────────────────────────────────────────────────────
  ctx.fillStyle    = 'rgba(136,136,187,0.80)';
  ctx.font         = `400 20px ${FONT_M}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(subtitle, textX, logoY + logoSz + 22);

  // ── Divider rule ─────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(80, logoY + logoSz + 48);
  ctx.lineTo(1000, logoY + logoSz + 48);
  ctx.stroke();

  ctx.restore();
}

/* ── Internal: shared privacy footer strip ───────────────────────────────── */
function _shareDrawFooter(ctx, H) {
  const FONT_M = "'JetBrains Mono', monospace";
  _shareRoundRect(ctx, 60, H - 82, 960, 50, [0, 0, 36, 36]);
  ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fill();
  ctx.fillStyle = 'rgba(136,136,187,0.55)';
  ctx.font = `400 20px ${FONT_M}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔒 PRIVATE  ·  📱 LOCAL  ·  🚫 NO SIGN-UP', 540, H - 57);
}

/* ── Internal: map S.theme key → canvas colour tokens ───────────────────── */
function _shareThemeTokens() {
  const theme = (typeof S !== 'undefined' && S.theme) ? S.theme : 'dark';
  if (theme === 'light') {
    return {
      bg:         '#F2F4FA',
      grad0:      'rgba(108,99,255,0.08)',
      grad1:      'rgba(5,200,232,0.05)',
      text:       '#101223',
      textSub:    'rgba(16,18,35,0.48)',
      accent:     '#6C63FF',
      pill:       'rgba(108,99,255,0.07)',
      pillBorder: 'rgba(108,99,255,0.22)',
    };
  }
  // dark / amoled
  return {
    bg:         '#0A0A18',
    grad0:      'rgba(108,99,255,0.14)',
    grad1:      'rgba(5,200,232,0.09)',
    text:       '#EEEEFF',
    textSub:    'rgba(238,238,255,0.40)',
    accent:     '#6C63FF',
    pill:       'rgba(255,255,255,0.07)',
    pillBorder: 'rgba(108,99,255,0.30)',
  };
}
