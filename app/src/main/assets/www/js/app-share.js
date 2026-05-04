/* ═══════════════════════════════════════════════════════════════════════════
   app-share.js  —  Share card builders + dispatcher
   Requires: app-share-utils.js (canvas helpers, icon resolver)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   _buildStreakCard — STREAK share card
   Dark bg · purple-amber-gold gradient · Bodoni Moda hero number
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildStreakCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) ? S.streakGoalMins : 240;
  let streak = 0;
  if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE && typeof N !== 'undefined') {
    try { streak = N.getStreakDays(goalMins); } catch(_) {}
  }
  const weekDays = (typeof WEEKLY !== 'undefined') ? WEEKLY.filter(d => d.minutes > 0) : [];
  const weekAvg  = weekDays.length > 0
    ? Math.round(weekDays.reduce((s, d) => s + d.minutes, 0) / weekDays.length) : 0;

  /* ── Background ── */
  ctx.fillStyle = '#060610'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, H * 0.15, W, H * 0.95);
  bg.addColorStop(0,    'rgba(108,63,255,0.30)');
  bg.addColorStop(0.45, 'rgba(200,70,20,0.18)');
  bg.addColorStop(1,    'rgba(255,160,0,0.14)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.88, H * 0.10, 360, 'rgba(255,130,0,0.10)');
  _shareGlow(ctx, W * 0.12, H * 0.90, 300, 'rgba(108,63,255,0.16)');

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Screen Time Tracker');

  /* ── Fire glow + emoji ── */
  _shareGlow(ctx, 540, 395, 250, 'rgba(255,100,0,0.20)');
  _shareGlow(ctx, 540, 395, 120, 'rgba(255,180,0,0.12)');
  ctx.font = '150px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🔥', 540, 354);

  /* ── Hero streak number — Bodoni Moda italic, white→gold gradient ── */
  ctx.save();
  const numG = ctx.createLinearGradient(180, 440, 900, 610);
  numG.addColorStop(0,   '#FFFFFF');
  numG.addColorStop(0.6, '#FFE082');
  numG.addColorStop(1,   '#FFAA44');
  ctx.fillStyle = numG;
  const numSize = streak >= 100 ? 186 : 224;
  ctx.font = `italic 300 ${numSize}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(streak), 540, 566);
  ctx.restore();

  /* ── "DAY STREAK" label in JetBrains Mono ── */
  ctx.fillStyle = 'rgba(238,238,255,0.75)';
  ctx.font = `bold 46px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DAY  STREAK', 540, 662);

  /* ── Goal pill ── */
  const pillW = 432, pillH = 54, pillX = (W - pillW) / 2, pillY = 716;
  _shareRoundRect(ctx, pillX, pillY, pillW, pillH, 27);
  ctx.fillStyle = 'rgba(247,166,35,0.10)'; ctx.fill();
  ctx.strokeStyle = 'rgba(247,166,35,0.32)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,210,100,0.88)';
  ctx.font = `400 26px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`Under ${_fmtShare(goalMins)}/day  ✓`, W / 2, pillY + pillH / 2);

  /* ── Stat tiles ── */
  const tileY = 800, tileH = 112, tileW = 392, gap = 20;
  const t1X = (W / 2) - tileW - gap / 2;
  const t2X = (W / 2) + gap / 2;
  [t1X, t2X].forEach(tx => {
    _shareRoundRect(ctx, tx, tileY, tileW, tileH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
  });

  const todayMins = typeof TODAY_MINS !== 'undefined' ? TODAY_MINS : 0;

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#EEEEFF';
  ctx.font = `bold 40px ${FONT_M}`;
  ctx.textAlign = 'center';
  ctx.fillText(_fmtShare(todayMins), t1X + tileW / 2, tileY + 42);
  ctx.fillStyle = 'rgba(136,136,187,0.60)';
  ctx.font = `400 19px ${FONT_M}`;
  ctx.fillText("Today's screen time", t1X + tileW / 2, tileY + 82);

  ctx.fillStyle = '#EEEEFF';
  ctx.font = `bold 40px ${FONT_M}`;
  ctx.fillText(weekAvg > 0 ? _fmtShare(weekAvg) : '—', t2X + tileW / 2, tileY + 42);
  ctx.fillStyle = 'rgba(136,136,187,0.60)';
  ctx.font = `400 19px ${FONT_M}`;
  ctx.fillText('Daily average', t2X + tileW / 2, tileY + 82);

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildWeeklyCard — WEEKLY share card
   Deep indigo → cyan bg · Bodoni Moda total · rainbow bar chart
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildWeeklyCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) ? S.streakGoalMins : 240;
  const weekData  = (typeof WEEKLY !== 'undefined' && WEEKLY.length === 7) ? WEEKLY : [];
  const weekTotal = weekData.reduce((s, d) => s + (d.minutes || 0), 0);
  const weekDays  = weekData.filter(d => d.minutes > 0);
  const weekAvg   = weekDays.length > 0 ? Math.round(weekTotal / weekDays.length) : 0;
  const bestDay   = weekDays.length > 0
    ? weekDays.reduce((a, b) => b.minutes < a.minutes ? b : a, weekDays[0]) : null;

  /* ── Background ── */
  ctx.fillStyle = '#080D1C'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,    'rgba(60,40,200,0.40)');
  bg.addColorStop(0.55, 'rgba(5,70,160,0.24)');
  bg.addColorStop(1,    'rgba(5,200,232,0.18)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.82, H * 0.12, 340, 'rgba(5,200,232,0.12)');
  _shareGlow(ctx, W * 0.18, H * 0.88, 290, 'rgba(108,99,255,0.18)');

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Weekly Screen Time Report');

  /* ── "THIS WEEK" label ── */
  ctx.fillStyle = 'rgba(5,200,232,0.88)';
  ctx.font = `bold 26px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('THIS WEEK', 540, 230);

  /* ── Hero weekly total — Bodoni Moda italic, white→cyan gradient ── */
  ctx.save();
  const hg = ctx.createLinearGradient(100, 270, 980, 430);
  hg.addColorStop(0, '#FFFFFF');
  hg.addColorStop(1, '#A0E8FF');
  ctx.fillStyle = hg;
  const heroSize = weekTotal >= 6000 ? 148 : 176;
  ctx.font = `italic 300 ${heroSize}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(_fmtShare(weekTotal), 540, 364);
  ctx.restore();

  /* ── Average pill ── */
  const avgPW = 456, avgPH = 50;
  _shareRoundRect(ctx, (W - avgPW) / 2, 456, avgPW, avgPH, 25);
  ctx.fillStyle = 'rgba(5,200,232,0.09)'; ctx.fill();
  ctx.strokeStyle = 'rgba(5,200,232,0.20)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(160,232,255,0.78)';
  ctx.font = `400 22px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(
    weekAvg > 0
      ? `avg ${_fmtShare(weekAvg)}/day  ·  ${weekDays.length} active days`
      : 'Start tracking to see your average',
    540, 456 + 25
  );

  /* ── 7-day bar chart ── */
  const chartTop = 532, chartH = 210, chartL = 96, chartR = W - 96;
  const chartW   = chartR - chartL;
  const maxMins  = weekData.length ? Math.max(...weekData.map(d => d.minutes || 0), 1) : 1;
  const barCount = 7;
  const barW     = Math.floor(chartW / barCount * 0.52);
  const barGap   = Math.floor(chartW / barCount);
  const DAY_COLS = ['#7B6FFF','#F04E7A','#F5A623','#12D48A','#05C8E8','#B06EFF','#FF6B6B'];
  const DOW      = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // Baseline
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartL, chartTop + chartH);
  ctx.lineTo(chartR, chartTop + chartH);
  ctx.stroke();

  for (let i = 0; i < barCount; i++) {
    const d      = weekData[i] || { minutes: 0, isToday: false, day: DOW[i] };
    const mins   = d.minutes || 0;
    const barH   = mins > 0 ? Math.max(6, Math.round((mins / maxMins) * (chartH - 38))) : 4;
    const bx     = chartL + i * barGap + Math.floor((barGap - barW) / 2);
    const by     = chartTop + chartH - barH;
    const col    = DAY_COLS[i];
    const isToday = !!d.isToday;

    if (isToday) _shareGlow(ctx, bx + barW / 2, by + barH / 2, barW * 2.2, col + '38');
    _shareRoundRect(ctx, bx, by, barW, barH, [5, 5, 2, 2]);
    ctx.fillStyle = isToday ? col : col + '60'; ctx.fill();

    if (mins > 0 && barH > 32) {
      ctx.fillStyle = isToday ? '#FFFFFF' : 'rgba(238,238,255,0.48)';
      ctx.font      = `${isToday ? 'bold ' : '400 '}17px ${FONT_M}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(mins >= 60 ? Math.floor(mins / 60) + 'h' : mins + 'm', bx + barW / 2, by - 6);
    }
    ctx.fillStyle = isToday ? col : 'rgba(136,136,187,0.55)';
    ctx.font      = `${isToday ? 'bold ' : '400 '}18px ${FONT_M}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText((d.day || DOW[i]).slice(0, 3), bx + barW / 2, chartTop + chartH + 10);
  }

  /* ── Stat tiles ── */
  const cY = 812, cH = 100, cW = 392, cGap = 20;
  const c1X = (W / 2) - cW - cGap / 2;
  const c2X = (W / 2) + cGap / 2;
  [c1X, c2X].forEach(cx => {
    _shareRoundRect(ctx, cx, cY, cW, cH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();
  });

  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#12D48A';
  ctx.font = `bold 34px ${FONT_M}`;
  ctx.textAlign = 'center';
  ctx.fillText(
    bestDay ? `${(bestDay.day || '').slice(0, 3)}  ${_fmtShare(bestDay.minutes)}` : '—',
    c1X + cW / 2, cY + 40
  );
  ctx.fillStyle = 'rgba(136,136,187,0.58)';
  ctx.font = `400 19px ${FONT_M}`;
  ctx.fillText('Best day this week', c1X + cW / 2, cY + 74);

  const goalHit = weekDays.filter(d => d.minutes <= goalMins).length;
  ctx.fillStyle = '#F7A623';
  ctx.font = `bold 34px ${FONT_M}`;
  ctx.fillText(`${goalHit} / 7 days`, c2X + cW / 2, cY + 40);
  ctx.fillStyle = 'rgba(136,136,187,0.58)';
  ctx.font = `400 19px ${FONT_M}`;
  ctx.fillText(`Under ${_fmtShare(goalMins)} goal`, c2X + cW / 2, cY + 74);

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildReferralCard — branded referral share card (theme-aware)
   App icon hero · Bodoni Moda headline · gold "screen time." · value pills
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildReferralCard(ctx, icon, opts) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const tk      = _shareThemeTokens();
  const refCode = (opts && opts.referralCode) ? opts.referralCode : null;
  const pkgName = (typeof SELF_PKG !== 'undefined') ? SELF_PKG : 'com.javikastudio.tidyapp'; // eslint-disable-line no-unused-vars

  /* ── Background ── */
  ctx.fillStyle = tk.bg; ctx.fillRect(0, 0, W, H);
  const bgG = ctx.createLinearGradient(0, 0, W, H);
  bgG.addColorStop(0,    tk.grad0);
  bgG.addColorStop(0.55, 'rgba(0,0,0,0)');
  bgG.addColorStop(1,    tk.grad1);
  ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.82, H * 0.12, 380, tk.grad0.replace(/[\d.]+\)$/, '0.14)'));
  _shareGlow(ctx, W * 0.18, H * 0.88, 310, tk.grad1.replace(/[\d.]+\)$/, '0.10)'));

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Screen Time, Habits & Focus');

  /* ── Hero app icon + glow ── */
  const hiS = 212, hiX = (W - hiS) / 2, hiY = 226;
  _shareGlow(ctx, W / 2, hiY + hiS / 2, 240, tk.grad0.replace(/[\d.]+\)$/, '0.16)'));
  _shareDrawIcon(ctx, icon, hiX, hiY, hiS, 52);

  // Thin fading rule below icon
  const ruleY = hiY + hiS + 44;
  const ruleG = ctx.createLinearGradient(W / 2 - 220, ruleY, W / 2 + 220, ruleY);
  ruleG.addColorStop(0,   'rgba(255,255,255,0)');
  ruleG.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  ruleG.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.strokeStyle = ruleG; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 220, ruleY); ctx.lineTo(W / 2 + 220, ruleY);
  ctx.stroke();

  /* ── Headline ── */
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = tk.text;
  ctx.font = `italic 300 64px ${FONT_D}`;
  ctx.fillText('Take control of your', W / 2, 546);

  ctx.save();
  const headG = ctx.createLinearGradient(W / 2 - 220, 596, W / 2 + 220, 640);
  headG.addColorStop(0,    '#FFE082');
  headG.addColorStop(0.55, '#FFAA44');
  headG.addColorStop(1,    '#FF7020');
  ctx.fillStyle = headG;
  ctx.font = `italic 300 64px ${FONT_D}`;
  ctx.fillText('screen time.', W / 2, 622);
  ctx.restore();

  /* ── Sub-tagline ── */
  ctx.fillStyle = tk.textSub;
  ctx.font = `400 23px ${FONT_M}`;
  ctx.fillText('Automatic app organisation, screen time insights,', W / 2, 706);
  ctx.fillText('and focus tools for healthier phone habits.', W / 2, 738);

  /* ── Value prop pills ── */
  const pills   = ['🔒 PRIVATE', '📱 LOCAL', '🚫 NO SIGN-UP'];
  const pillH   = 56, pillR = 28, pillGap = 18;
  ctx.font = `bold 22px ${FONT_M}`;
  const pWidths = pills.map(p => ctx.measureText(p).width + 54);
  const totalPW = pWidths.reduce((s, w) => s + w, 0) + pillGap * (pills.length - 1);
  let px = (W - totalPW) / 2;
  const pillY = 800;
  pills.forEach((label, i) => {
    const pw = pWidths[i];
    _shareRoundRect(ctx, px, pillY, pw, pillH, pillR);
    ctx.fillStyle = tk.pill; ctx.fill();
    ctx.strokeStyle = tk.pillBorder; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = tk.text;
    ctx.font = `bold 22px ${FONT_M}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, px + pw / 2, pillY + pillH / 2);
    px += pw + pillGap;
  });

  /* ── Referral code block — shown only when referralCode is provided ── */
  if (refCode) {
    const codeY = 896, codeW = 484, codeH = 78, codeX = (W - codeW) / 2;
    _shareRoundRect(ctx, codeX, codeY, codeW, codeH, 18);
    ctx.fillStyle = tk.accent + '18'; ctx.fill();
    ctx.strokeStyle = tk.accent + '60'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = tk.textSub;
    ctx.font = `400 20px ${FONT_M}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Use my referral code', W / 2, codeY + 24);
    ctx.fillStyle = tk.accent;
    ctx.font = `bold 28px ${FONT_M}`;
    ctx.fillText(refCode, W / 2, codeY + 57);
  }

  /* ── Footer ── */
  const footY = refCode ? H - 72 : H - 82;
  _shareRoundRect(ctx, 60, footY, W - 120, 50, [0, 0, 36, 36]);
  ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.fill();
  ctx.fillStyle = tk.textSub;
  ctx.font = `400 21px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Available on Google Play', W / 2, footY + 25);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildAureloScoreCard — AURELO SCORE share card  [PREMIUM HERO REDESIGN]
   The flagship card: deep space dark · giant arch backdrop · gold gradient
   hero number · 2×2 pillar grid · multi-layer glow depth
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildAureloScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const data     = (typeof window.getAureloScoreData === 'function') ? window.getAureloScoreData() : null;
  const score    = data ? data.score        : -1;
  const sScreen  = data ? data.sScreen      : -1;
  const sFocus   = data ? data.sFocus       : -1;
  const sSleep   = data ? data.sSleep       : -1;
  const sBody    = data ? data.hcBodyScore  : -1;
  const goalMins = data ? data.goalMins     : ((typeof S !== 'undefined' && S.streakGoalMins) ? S.streakGoalMins : 240);
  const hasBody  = sBody !== null && sBody >= 0;

  const gradeColor = score >= 85 ? '#12D48A' : score >= 70 ? '#29DBA0' : score >= 55 ? '#F7A623' : '#F04E7A';
  const gradeLabel = score >= 85 ? 'EXCELLENT' : score >= 70 ? 'GREAT' : score >= 55 ? 'GOOD' : score >= 35 ? 'FAIR' : 'START';

  /* ── Background: deep space ── */
  ctx.fillStyle = '#020812'; ctx.fillRect(0, 0, W, H);

  /* Layer 1: base gradient overlay */
  const bgG = ctx.createLinearGradient(0, 0, W, H);
  bgG.addColorStop(0,    'rgba(88,60,200,0.32)');
  bgG.addColorStop(0.38, 'rgba(30,20,120,0.22)');
  bgG.addColorStop(0.70, 'rgba(10,40,130,0.16)');
  bgG.addColorStop(1,    'rgba(5,190,220,0.18)');
  ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

  /* Layer 2: radial gold aurora at top-center */
  _shareGlow(ctx, W * 0.50, H * 0.05, 620, 'rgba(220,160,30,0.09)');
  _shareGlow(ctx, W * 0.50, H * 0.05, 300, 'rgba(255,200,60,0.07)');

  /* Layer 3: corner depth glows */
  _shareGlow(ctx, W * 0.88, H * 0.14, 380, 'rgba(108,80,255,0.20)');
  _shareGlow(ctx, W * 0.12, H * 0.86, 320, 'rgba(5,200,232,0.14)');
  _shareGlow(ctx, W * 0.82, H * 0.82, 240, 'rgba(108,60,255,0.11)');

  /* ── Giant decorative Aurelo arch backdrop ── */
  ctx.save();
  ctx.translate(W / 2, 580);
  const archScale = 6.8;  // scale 108px viewbox to ~734px wide
  const archCx = 54 * archScale, archCy = 88 * archScale;
  ctx.translate(-archCx, -archCy);
  ctx.scale(archScale, archScale);
  ctx.beginPath();
  ctx.moveTo(22, 88);
  ctx.bezierCurveTo(22, 88, 30, 30, 54, 20);
  ctx.bezierCurveTo(78, 30, 86, 88, 86, 88);
  const archBgGrad = ctx.createLinearGradient(28, 20, 80, 90);
  archBgGrad.addColorStop(0,    'rgba(255,210,80,0.09)');
  archBgGrad.addColorStop(0.50, 'rgba(255,140,30,0.07)');
  archBgGrad.addColorStop(1,    'rgba(255,80,20,0.04)');
  ctx.strokeStyle = archBgGrad;
  ctx.lineWidth   = 9;
  ctx.lineCap     = 'round';
  ctx.stroke();
  ctx.restore();

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Daily Wellness Score');

  /* ── "AURELO SCORE" label above number ── */
  ctx.fillStyle = 'rgba(220,200,255,0.55)';
  ctx.font = `600 22px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('YOUR AURELO SCORE', W / 2, 228);

  /* ── Hero score glow burst ── */
  _shareGlow(ctx, W / 2, 390, 260, 'rgba(180,150,255,0.16)');
  _shareGlow(ctx, W / 2, 390, 130, 'rgba(220,200,255,0.09)');

  /* ── Hero score number — Bodoni Moda, white→gold→purple gradient ── */
  ctx.save();
  const heroG = ctx.createLinearGradient(180, 270, 900, 470);
  heroG.addColorStop(0,    '#FFFFFF');
  heroG.addColorStop(0.35, '#EDE0FF');
  heroG.addColorStop(0.65, '#FFD97D');
  heroG.addColorStop(1,    '#9B84FF');
  ctx.fillStyle = heroG;
  const numSz = score >= 100 ? 192 : 240;
  ctx.font = `italic 300 ${numSz}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(score >= 0 ? String(score) : '–', W / 2, 395);
  ctx.restore();

  /* ── Grade label ── */
  const gradeGrad = ctx.createLinearGradient(340, 510, 740, 538);
  gradeGrad.addColorStop(0, gradeColor);
  gradeGrad.addColorStop(1, gradeColor + 'BB');
  ctx.fillStyle = gradeGrad;
  ctx.font = `700 34px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(gradeLabel, W / 2, 498);

  /* ── Overall bar ── */
  const barX = 140, barY = 534, barW = W - 280, barH = 7;
  _shareRoundRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
  if (score > 0) {
    const fillPx = Math.round(barW * Math.min(score, 100) / 100);
    const barFillG = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    barFillG.addColorStop(0,    '#9B84FF');
    barFillG.addColorStop(0.50, '#FFD97D');
    barFillG.addColorStop(1,    '#05C8E8');
    _shareRoundRect(ctx, barX, barY, fillPx, barH, 4);
    ctx.fillStyle = barFillG; ctx.fill();
  }

  /* ── 2 × 2 pillar tile grid ── */
  const pillars = [
    { emoji: '📱', label: 'SCREEN',  score: sScreen, color: '#A89CFF', weight: hasBody ? '35%' : '40%' },
    { emoji: '🎯', label: 'FOCUS',   score: sFocus,  color: '#05C8E8', weight: hasBody ? '30%' : '35%' },
    { emoji: '😴', label: 'SLEEP',   score: sSleep,  color: '#B06EFF', weight: hasBody ? '20%' : '25%' },
    { emoji: '❤️', label: 'BODY',    score: sBody,   color: '#12D48A', weight: '15%',   isHC: true },
  ];

  const tW = 236, tH = 184, tGapX = 18, tGapY = 16;
  const gridW = tW * 2 + tGapX;
  const gridX = (W - gridW) / 2;
  const gridY = 565;

  pillars.forEach((p, i) => {
    const col  = i % 2;
    const row  = Math.floor(i / 2);
    const tx   = gridX + col * (tW + tGapX);
    const ty   = gridY + row * (tH + tGapY);

    /* tile bg */
    _shareRoundRect(ctx, tx, ty, tW, tH, 18);
    if (p.isHC) {
      ctx.fillStyle = 'rgba(0,200,200,0.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,200,200,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
    }

    /* emoji */
    ctx.font = '34px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, tx + tW / 2, ty + 36);

    /* score number */
    const hasData = p.score !== null && p.score >= 0;
    ctx.fillStyle = hasData ? p.color : 'rgba(255,255,255,0.22)';
    ctx.font = `700 48px ${FONT_M}`;
    ctx.fillText(hasData ? String(p.score) : '–', tx + tW / 2, ty + 96);

    /* label + weight */
    ctx.fillStyle = 'rgba(160,160,210,0.70)';
    ctx.font = `400 15px ${FONT_M}`;
    ctx.fillText(p.label + '  ' + p.weight, tx + tW / 2, ty + 130);

    /* mini bar */
    const mbX = tx + 18, mbY = ty + 154, mbW = tW - 36, mbH = 4;
    _shareRoundRect(ctx, mbX, mbY, mbW, mbH, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    if (hasData && p.score > 0) {
      const pct = Math.round(mbW * Math.min(p.score, 100) / 100);
      _shareRoundRect(ctx, mbX, mbY, pct, mbH, 2);
      ctx.fillStyle = p.color; ctx.fill();
    }

    /* HC badge on body tile */
    if (p.isHC) {
      const bdgW = 30, bdgH = 16, bdgX = tx + tW - bdgW - 10, bdgY = ty + 10;
      _shareRoundRect(ctx, bdgX, bdgY, bdgW, bdgH, 5);
      ctx.fillStyle = 'rgba(0,200,200,0.20)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,200,200,0.40)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(0,220,220,0.90)';
      ctx.font = `700 10px ${FONT_M}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('HC', bdgX + bdgW / 2, bdgY + bdgH / 2);
    }
  });

  /* ── Date + goal pill ── */
  const dateStr = new Date().toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillStyle = 'rgba(136,136,187,0.45)';
  ctx.font = `400 20px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Goal ' + _fmtShare(goalMins) + '  ·  ' + dateStr, W / 2, 995);

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildBodyScoreCard — BODY SCORE share card  [NEW]
   Health Connect powered · dark teal/emerald palette · HRV + HR + Steps
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildBodyScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const d          = (typeof window.getBodyScoreData === 'function') ? window.getBodyScoreData() : {};
  const bodyScore  = (d.bodyScore != null && d.bodyScore >= 0) ? d.bodyScore : -1;
  const steps      = d.steps      ?? null;
  const hrv        = d.hrv        ?? null;
  const avgHrv7d   = d.avgHrv7d   ?? null;
  const rhr        = d.rhr        ?? null;
  const avgRhr7d   = d.avgRhr7d   ?? null;
  const avgSteps7d = d.avgSteps7d ?? null;

  /* grade */
  const gradeColor = bodyScore >= 70 ? '#12D48A' : bodyScore >= 50 ? '#F7A623' : bodyScore >= 0 ? '#F04E7A' : '#05C8E8';
  const gradeLabel = bodyScore >= 85 ? 'EXCELLENT' : bodyScore >= 70 ? 'GREAT' : bodyScore >= 50 ? 'GOOD' : bodyScore >= 35 ? 'FAIR' : 'START';

  /* ── Background: deep health teal ── */
  ctx.fillStyle = '#021212'; ctx.fillRect(0, 0, W, H);

  const bgG = ctx.createLinearGradient(0, 0, W, H);
  bgG.addColorStop(0,    'rgba(0,160,160,0.24)');
  bgG.addColorStop(0.40, 'rgba(0,80,100,0.16)');
  bgG.addColorStop(0.72, 'rgba(0,40,80,0.14)');
  bgG.addColorStop(1,    'rgba(0,200,120,0.18)');
  ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

  /* Corner depth glows */
  _shareGlow(ctx, W * 0.88, H * 0.12, 360, 'rgba(0,200,200,0.20)');
  _shareGlow(ctx, W * 0.12, H * 0.86, 300, 'rgba(0,180,120,0.16)');
  _shareGlow(ctx, W * 0.50, H * 0.45, 380, 'rgba(0,200,180,0.08)');

  /* ── Decorative pulse-wave backdrop ── */
  const waveY = 510;
  for (let r = 0; r < 4; r++) {
    const radius = 200 + r * 90;
    const alpha  = 0.045 - r * 0.009;
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, waveY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,210,190,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Health Connect · Body Score');

  /* ── HC badge pill ── */
  const hcPillW = 140, hcPillH = 34, hcPillX = W - hcPillW - 68, hcPillY = 56;
  _shareRoundRect(ctx, hcPillX, hcPillY, hcPillW, hcPillH, 17);
  ctx.fillStyle = 'rgba(0,200,200,0.15)'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,200,200,0.40)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(0,230,230,0.92)';
  ctx.font = `700 16px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HEALTH CONNECT', hcPillX + hcPillW / 2, hcPillY + hcPillH / 2);

  /* ── "BODY SCORE" label ── */
  ctx.fillStyle = 'rgba(0,220,200,0.65)';
  ctx.font = `600 22px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('YOUR BODY SCORE', W / 2, 230);

  /* ── Hero score glow ── */
  _shareGlow(ctx, W / 2, 390, 250, 'rgba(0,210,180,0.14)');
  _shareGlow(ctx, W / 2, 390, 120, 'rgba(0,230,200,0.09)');

  /* ── Hero score number ── */
  ctx.save();
  const heroG = ctx.createLinearGradient(200, 270, 880, 470);
  heroG.addColorStop(0,    '#FFFFFF');
  heroG.addColorStop(0.40, '#B8FFEE');
  heroG.addColorStop(0.75, '#00D4B0');
  heroG.addColorStop(1,    '#00A878');
  ctx.fillStyle = heroG;
  const numSz = bodyScore >= 100 ? 192 : 240;
  ctx.font = `italic 300 ${numSz}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(bodyScore >= 0 ? String(bodyScore) : '–', W / 2, 395);
  ctx.restore();

  /* ── Grade label ── */
  ctx.fillStyle = gradeColor;
  ctx.font = `700 34px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(gradeLabel, W / 2, 495);

  /* ── Overall bar ── */
  const barX = 140, barY = 534, barW = W - 280, barH = 7;
  _shareRoundRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
  if (bodyScore > 0) {
    const fillPx = Math.round(barW * Math.min(bodyScore, 100) / 100);
    const bfG = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    bfG.addColorStop(0, '#00A878'); bfG.addColorStop(1, '#00D4D0');
    _shareRoundRect(ctx, barX, barY, fillPx, barH, 4);
    ctx.fillStyle = bfG; ctx.fill();
  }

  /* ── Three metric rows ── */
  /* Compute percentages using same logic as app-home-score.js */
  const hrvPct = (function() {
    if (hrv == null || avgHrv7d == null || avgHrv7d <= 0) return null;
    if (hrv >= avgHrv7d) return 100;
    const floor = avgHrv7d * 0.70;
    if (hrv <= floor) return 0;
    return Math.min(100, Math.max(0, Math.round(((hrv - floor) / (avgHrv7d - floor)) * 100)));
  })();

  const rhrPct = (function() {
    if (rhr == null || avgRhr7d == null || avgRhr7d <= 0) return null;
    if (rhr <= avgRhr7d) return 100;
    const ceiling = avgRhr7d * 1.40;
    if (rhr >= ceiling) return 0;
    return Math.min(100, Math.max(0,
      Math.round((1 - (rhr - avgRhr7d) / (ceiling - avgRhr7d)) * 100)));
  })();

  const stepsPct = (function() {
    if (steps == null) return null;
    const ceiling = (avgSteps7d != null && avgSteps7d > 8000) ? Math.round(avgSteps7d) : 8000;
    if (steps >= ceiling) return 100;
    if (steps <= 2000) return 0;
    return Math.min(100, Math.max(0, Math.round(((steps - 2000) / (ceiling - 2000)) * 100)));
  })();

  const metrics = [
    {
      icon: '💜', label: 'Heart Rate Variability',
      val:  hrv     != null ? hrv + ' ms'              : null,
      sub:  avgHrv7d != null ? '7-day avg ' + avgHrv7d + ' ms' : '7-day avg: –',
      pct:  hrvPct,
      col:  hrvPct  == null ? 'rgba(160,160,210,0.40)' :
            hrvPct  >= 100  ? '#12D48A' : hrvPct >= 70 ? '#F7A623' : '#F04E7A',
    },
    {
      icon: '❤️', label: 'Resting Heart Rate',
      val:  rhr     != null ? rhr + ' bpm'             : null,
      sub:  avgRhr7d != null ? '7-day avg ' + avgRhr7d + ' bpm' : '7-day avg: –',
      pct:  rhrPct,
      col:  rhrPct  == null ? 'rgba(160,160,210,0.40)' :
            rhrPct  >= 100  ? '#12D48A' : rhrPct >= 70 ? '#F7A623' : '#F04E7A',
    },
    {
      icon: '🦶', label: 'Daily Steps',
      val:  steps   != null ? steps.toLocaleString()   : null,
      sub:  (avgSteps7d != null && avgSteps7d > 8000)
              ? 'Goal: ' + Math.round(avgSteps7d).toLocaleString() + ' (your avg)'
              : 'Goal: 8,000',
      pct:  stepsPct,
      col:  stepsPct == null ? 'rgba(160,160,210,0.40)' :
            stepsPct >= 100  ? '#12D48A' : stepsPct >= 60 ? '#F7A623' : '#F04E7A',
    },
  ];

  const rowH = 110, rowGap = 14, rowX = 72, rowW = W - 144;
  const startRowY = 566;

  metrics.forEach((m, i) => {
    const ry = startRowY + i * (rowH + rowGap);

    /* row bg */
    _shareRoundRect(ctx, rowX, ry, rowW, rowH, 18);
    ctx.fillStyle = 'rgba(0,200,180,0.06)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,200,180,0.13)'; ctx.lineWidth = 1; ctx.stroke();

    /* icon */
    ctx.font = '30px serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(m.icon, rowX + 20, ry + 34);

    /* label */
    ctx.fillStyle = 'rgba(210,240,235,0.88)';
    ctx.font = `700 24px ${FONT_M}`;
    ctx.fillText(m.label, rowX + 60, ry + 34);

    /* sub-label */
    ctx.fillStyle = 'rgba(140,190,180,0.55)';
    ctx.font = `400 18px ${FONT_M}`;
    ctx.fillText(m.sub, rowX + 60, ry + 60);

    /* value (right-aligned) */
    ctx.fillStyle = m.val ? m.col : 'rgba(160,160,210,0.35)';
    ctx.font = `700 34px ${FONT_M}`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(m.val || '–', rowX + rowW - 20, ry + 44);

    /* mini progress bar */
    const pbX = rowX + 20, pbY = ry + rowH - 16, pbW = rowW - 40, pbH = 4;
    _shareRoundRect(ctx, pbX, pbY, pbW, pbH, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    if (m.pct != null && m.pct > 0) {
      _shareRoundRect(ctx, pbX, pbY, Math.round(pbW * m.pct / 100), pbH, 2);
      ctx.fillStyle = m.col; ctx.fill();
    }
  });

  /* ── Date context ── */
  const dateStr = new Date().toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillStyle = 'rgba(120,180,170,0.45)';
  ctx.font = `400 20px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(dateStr, W / 2, 995);

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Indigo-cyan bg · hero score · session / timer / mindful rows
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildFocusScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const d   = (typeof FocusTab !== 'undefined' && typeof FocusTab.loadStripData === 'function')
              ? FocusTab.loadStripData() : {};
  const res = (typeof FocusScore !== 'undefined' && typeof FocusScore.calculateFocus === 'function')
              ? FocusScore.calculateFocus(d)
              : { score: -1, sessW: 0, timerW: 0, mindfulW: 0, sessPts: 0, timerPts: 0, mindfulPts: 0,
                  sessMax: 0, timerMax: 0, mindfulMax: 0 };
  const score = res.score >= 0 ? res.score : 0;
  const gradeColor = score >= 75 ? '#12D48A' : score >= 50 ? '#F7A623' : '#05C8E8';

  /* ── Background ── */
  ctx.fillStyle = '#080D1C'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,    'rgba(5,200,232,0.22)');
  bg.addColorStop(0.55, 'rgba(40,60,200,0.16)');
  bg.addColorStop(1,    'rgba(108,99,255,0.14)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.85, H * 0.12, 340, 'rgba(5,200,232,0.12)');
  _shareGlow(ctx, W * 0.15, H * 0.88, 280, 'rgba(108,99,255,0.14)');

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Focus Score');

  /* ── Hero score ── */
  ctx.save();
  const heroG = ctx.createLinearGradient(200, 260, 880, 440);
  heroG.addColorStop(0, '#FFFFFF'); heroG.addColorStop(1, '#A0E8FF');
  ctx.fillStyle = heroG;
  ctx.font = `italic 300 ${score >= 100 ? 188 : 224}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(res.score >= 0 ? String(score) : '–', 540, 390);
  ctx.restore();

  /* ── Label ── */
  ctx.fillStyle = gradeColor;
  ctx.font = `bold 38px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText("TODAY'S  FOCUS  SCORE", 540, 490);

  /* ── Progress bar ── */
  const bX = 120, bY = 536, bW = W - 240, bH = 8;
  _shareRoundRect(ctx, bX, bY, bW, bH, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  if (score > 0) {
    const barG = ctx.createLinearGradient(bX, 0, bX + bW, 0);
    barG.addColorStop(0, '#6C63FF'); barG.addColorStop(1, '#05C8E8');
    _shareRoundRect(ctx, bX, bY, Math.round(bW * score / 100), bH, 4);
    ctx.fillStyle = barG; ctx.fill();
  }

  /* ── Component rows ── */
  const components = [];
  if (res.sessW > 0) {
    const sessData = (d.completed !== undefined)
      ? (d.completed + ' of ' + d.total + ' sessions · ' + d.rate + '% completion')
      : 'Session data unavailable';
    components.push({ label: '🎯  Sessions',     pts: res.sessPts,    max: res.sessMax    || res.sessW,    data: sessData,  color: '#05C8E8' });
  }
  if (res.timerW > 0) {
    const timerData = (d.timerTotal !== undefined)
      ? ((d.timerTotal - (d.timerOverCount || 0)) + ' of ' + d.timerTotal + ' timers respected')
      : 'Timer data unavailable';
    components.push({ label: '⏱  App Timers',    pts: res.timerPts,   max: res.timerMax   || res.timerW,   data: timerData, color: '#A89CFF' });
  }
  if (res.mindfulW > 0) {
    const mindData = (d.resistCount !== undefined)
      ? (d.resistCount + ' of ' + d.pauseCount + ' pauses resisted')
      : 'Mindful pause data unavailable';
    components.push({ label: '🧘  Mindful Pause', pts: res.mindfulPts, max: res.mindfulMax || res.mindfulW, data: mindData,  color: '#B06EFF' });
  }
  if (!components.length) {
    components.push({ label: '🎯  Focus sessions', pts: 0, max: 100, data: 'Start a session to build your score', color: '#05C8E8' });
  }

  const rowH = 100, rowGap = 14, rowX = 80, rowW = W - 160;
  const startRowY = 576;

  components.forEach((c, i) => {
    const ry = startRowY + i * (rowH + rowGap);
    _shareRoundRect(ctx, rowX, ry, rowW, rowH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#EEEEFF';
    ctx.font = `bold 26px ${FONT_M}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(c.label, rowX + 24, ry + 27);

    ctx.fillStyle = c.color;
    ctx.font = `bold 26px ${FONT_M}`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('+' + c.pts + ' pts', rowX + rowW - 24, ry + 27);

    ctx.fillStyle = 'rgba(136,136,187,0.60)';
    ctx.font = `400 21px ${FONT_M}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(c.data, rowX + 24, ry + 60);

    const pct = c.max > 0 ? Math.round(c.pts / c.max * 100) : 0;
    const pbX = rowX + 24, pbY = ry + 83, pbW = rowW - 48, pbH = 5;
    _shareRoundRect(ctx, pbX, pbY, pbW, pbH, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    if (pct > 0) {
      _shareRoundRect(ctx, pbX, pbY, Math.round(pbW * pct / 100), pbH, 3);
      ctx.fillStyle = c.color; ctx.fill();
    }
  });

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildScreenScoreCard — SCREEN SCORE share card  [NEW]
   Slate-indigo bg · goal adherence · pickup · first-use rows · HC modifier
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildScreenScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  /* Pull live data from the wellness module's already-exposed helper */
  let score = -1, goalMins = 240, todayMins = 0;
  let goalPct = 0, pickupPct = 0, firstUsePct = 0;
  let hcModifier = 0, hcLabel = null;
  let goalDataLine = '', pickupDataLine = '', firstUseDataLine = '';

  try {
    if (typeof window.calculateScreenScoreWithHealthConnect === 'function') {
      const vm = window.calculateScreenScoreWithHealthConnect();
      score     = vm.effectiveScore;
      hcModifier = (vm.hcMod && vm.hcMod.modifier) || 0;
      hcLabel    = (vm.hcMod && vm.hcMod.label) || null;
      const res  = vm.res || {};
      goalMins   = res.goalMins   || 240;
      todayMins  = res.todayMins  || 0;

      goalPct      = Math.round((res.goalAdherenceScore || 0) * 0.5);
      pickupPct    = Math.round((res.pickupScore        || 0) * 0.3);
      firstUsePct  = Math.round((res.firstUseScore      || 0) * 0.2);

      if (todayMins === 0) {
        goalDataLine = 'No screen time yet · goal ' + _fmtShare(goalMins);
      } else if (todayMins < goalMins) {
        goalDataLine = _fmtShare(todayMins) + ' of ' + _fmtShare(goalMins) + ' goal used';
      } else {
        goalDataLine = _fmtShare(todayMins) + ' used · ' + _fmtShare(todayMins - goalMins) + ' over goal';
      }

      const avg = res.avgPickups || 0;
      const pu  = res.todayPickups || 0;
      pickupDataLine = pu + ' pickups'
        + (avg > 0 ? ' · avg ' + avg + '/day' : '');

      if (!res.firstUseStr || res.firstUseStr === '–') {
        firstUseDataLine = 'No pickup recorded yet';
      } else {
        firstUseDataLine = 'First pickup at ' + res.firstUseStr;
      }
    }
  } catch (_) {}

  const safeScore  = Math.max(0, score);
  const gradeColor = safeScore >= 85 ? '#12D48A' : safeScore >= 70 ? '#29DBA0' : safeScore >= 55 ? '#F7A623' : '#F04E7A';
  const gradeLabel = safeScore >= 85 ? 'EXCELLENT' : safeScore >= 70 ? 'GREAT' : safeScore >= 55 ? 'GOOD' : safeScore >= 35 ? 'FAIR' : 'START';

  /* ── Background: deep slate-blue ── */
  ctx.fillStyle = '#050A18'; ctx.fillRect(0, 0, W, H);
  const bgG = ctx.createLinearGradient(0, 0, W, H);
  bgG.addColorStop(0,    'rgba(80,60,220,0.26)');
  bgG.addColorStop(0.45, 'rgba(20,40,160,0.18)');
  bgG.addColorStop(1,    'rgba(5,160,200,0.16)');
  ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.85, H * 0.12, 340, 'rgba(100,80,255,0.18)');
  _shareGlow(ctx, W * 0.15, H * 0.88, 280, 'rgba(5,180,220,0.12)');

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Screen Score');

  /* ── "SCREEN SCORE" label ── */
  ctx.fillStyle = 'rgba(180,170,255,0.60)';
  ctx.font = `600 22px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('TODAY\'S SCREEN SCORE', W / 2, 228);

  /* ── Hero glow + number ── */
  _shareGlow(ctx, W / 2, 390, 240, 'rgba(130,110,255,0.14)');

  ctx.save();
  const heroG = ctx.createLinearGradient(200, 270, 880, 470);
  heroG.addColorStop(0,    '#FFFFFF');
  heroG.addColorStop(0.50, '#D0C8FF');
  heroG.addColorStop(1,    '#7B70FF');
  ctx.fillStyle = heroG;
  const numSz = safeScore >= 100 ? 192 : 240;
  ctx.font = `italic 300 ${numSz}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(score >= 0 ? String(safeScore) : '–', W / 2, 395);
  ctx.restore();

  /* ── Grade ── */
  ctx.fillStyle = gradeColor;
  ctx.font = `700 34px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(gradeLabel + (hcLabel ? '  ·  HC ' + (hcModifier > 0 ? '+' : '') + hcModifier + ' pts' : ''), W / 2, 495);

  /* ── Progress bar ── */
  const barX = 140, barY = 534, barW = W - 280, barH = 7;
  _shareRoundRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
  if (safeScore > 0) {
    const fillPx = Math.round(barW * Math.min(safeScore, 100) / 100);
    const bfG = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    bfG.addColorStop(0, '#7B70FF'); bfG.addColorStop(1, '#05C8E8');
    _shareRoundRect(ctx, barX, barY, fillPx, barH, 4);
    ctx.fillStyle = bfG; ctx.fill();
  }

  /* ── Three component rows ── */
  const components = [
    { icon: '🎯', label: 'Daily Goal',     pts: goalPct,     maxPts: 50, data: goalDataLine,    col: '#A89CFF', weight: '50%' },
    { icon: '📲', label: 'Pickup Freq.',   pts: pickupPct,   maxPts: 30, data: pickupDataLine,  col: '#05C8E8', weight: '30%' },
    { icon: '🌅', label: 'First Use',      pts: firstUsePct, maxPts: 20, data: firstUseDataLine, col: '#F7A623', weight: '20%' },
  ];

  const rowH = 110, rowGap = 14, rowX = 72, rowW = W - 144;
  const startRowY = 564;

  components.forEach((c, i) => {
    const ry = startRowY + i * (rowH + rowGap);

    _shareRoundRect(ctx, rowX, ry, rowW, rowH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

    /* icon */
    ctx.font = '28px serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(c.icon, rowX + 20, ry + 32);

    /* label + weight */
    ctx.fillStyle = '#EEEEFF';
    ctx.font = `700 24px ${FONT_M}`;
    ctx.fillText(c.label, rowX + 58, ry + 32);

    ctx.fillStyle = 'rgba(140,140,200,0.55)';
    ctx.font = `400 17px ${FONT_M}`;
    ctx.fillText('weight ' + c.weight, rowX + 58, ry + 57);

    /* data line */
    ctx.fillStyle = 'rgba(160,160,220,0.65)';
    ctx.font = `400 19px ${FONT_M}`;
    ctx.fillText(c.data, rowX + 58, ry + 80);

    /* pts (right-aligned) */
    ctx.fillStyle = c.col;
    ctx.font = `700 32px ${FONT_M}`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('+' + c.pts + ' pts', rowX + rowW - 20, ry + 40);

    /* mini progress bar */
    const pct = c.maxPts > 0 ? Math.round(c.pts / c.maxPts * 100) : 0;
    const pbX = rowX + 20, pbY = ry + rowH - 14, pbW = rowW - 40, pbH = 4;
    _shareRoundRect(ctx, pbX, pbY, pbW, pbH, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    if (pct > 0) {
      _shareRoundRect(ctx, pbX, pbY, Math.round(pbW * pct / 100), pbH, 2);
      ctx.fillStyle = c.col; ctx.fill();
    }
  });

  /* ── Date ── */
  const dateStr = new Date().toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillStyle = 'rgba(130,130,190,0.45)';
  ctx.font = `400 20px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Goal ' + _fmtShare(goalMins) + '  ·  ' + dateStr, W / 2, 995);

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildSleepScoreCard — SLEEP SCORE share card
   Midnight-purple bg · hero score · bedtime / snooze / app-block tiles
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildSleepScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  /* ── Inline helper: mirrors the private _sleepDurationScore in FocusScore ── */
  function _durScore(h) {
    if (h >= 7 && h <= 9) return 100;
    if (h < 7) return Math.max(0, Math.round(((h - 4) / 3) * 100));
    return Math.max(0, Math.round((1 - (h - 9) / 2) * 100));
  }

  /* ── Step 1: base sleep result ── */
  const res = (typeof FocusScore !== 'undefined' && typeof FocusScore.calculateSleep === 'function')
              ? FocusScore.calculateSleep()
              : { score: -1, adherePts: 0, snoozePts: 0, attemptPts: 0, streakBonus: 0,
                  bedStreak: 0, lastNight: null };
  const ln       = res.lastNight || null;
  const baseScore = res.score >= 0 ? res.score : 0;

  /* ── Step 2: bedtime window config (needed for Tier 2) ── */
  const cfg = (typeof FocusBedtime !== 'undefined' && typeof FocusBedtime.getCfg === 'function')
              ? FocusBedtime.getCfg() : {};
  let aureloWindowHours = null;
  if (cfg.bedHour != null && cfg.wakeHour != null) {
    const bH  = cfg.bedHour  + (cfg.bedMinute  || 0) / 60;
    const wH  = cfg.wakeHour + (cfg.wakeMinute || 0) / 60;
    const win = wH > bH ? wH - bH : (24 - bH) + wH;
    if (win >= 3 && win <= 14) aureloWindowHours = win;
  }
  const aureloWindowKept = !!(ln && ln.bedtimeKept);

  /* ── Step 3: HC data ── */
  const hcActive = typeof HealthConnect !== 'undefined' &&
                   typeof HealthConnect.isConnected === 'function' &&
                   HealthConnect.isConnected();
  let hcSleep = null;
  if (hcActive && typeof HealthConnect.getSleepData === 'function') {
    try { hcSleep = HealthConnect.getSleepData(); } catch (_) {}
  }

  /* ── Step 4: Duration — same three-tier hierarchy as openHabitsScoreSheet ── */
  let durScore = null, durLabel = 'No data', hcContributed = false;

  if (hcSleep && hcSleep.durScore != null && aureloWindowHours != null && aureloWindowKept) {
    // Tier 1: HC wearable + bedtime kept
    durScore = hcSleep.durScore; hcContributed = true;
    const dH = hcSleep.sleepDuration != null ? Math.floor(hcSleep.sleepDuration) : null;
    const dM = hcSleep.sleepDuration != null ? Math.round((hcSleep.sleepDuration % 1) * 60) : null;
    durLabel = (dH != null ? dH + 'h' + (dM > 0 ? ' ' + dM + 'm' : '') : 'HC data')
             + ' from Health Connect (target ' + Math.floor(aureloWindowHours) + 'h)';
  } else if (aureloWindowHours != null && aureloWindowKept) {
    // Tier 2: no wearable, but bedtime window kept — derive from config
    durScore = _durScore(aureloWindowHours);
    const wHr  = Math.floor(aureloWindowHours);
    const wMin = Math.round((aureloWindowHours % 1) * 60);
    durLabel = wHr + 'h' + (wMin > 0 ? ' ' + wMin + 'm' : '') + ' from your bedtime window';
  } else if (hcSleep && hcSleep.durScore != null) {
    // Tier 3: HC only, bedtime not kept
    durScore = hcSleep.durScore; hcContributed = true;
    const dH3 = hcSleep.sleepDuration != null ? Math.floor(hcSleep.sleepDuration) : null;
    const dM3 = hcSleep.sleepDuration != null ? Math.round((hcSleep.sleepDuration % 1) * 60) : null;
    durLabel = (dH3 != null ? dH3 + 'h' + (dM3 > 0 ? ' ' + dM3 + 'm' : '') : 'HC data')
             + ' from Health Connect (bedtime not kept)';
  }

  /* ── Step 5: Overnight HRV ── */
  let oHrvScore = (hcSleep && hcSleep.oHrvScore != null) ? hcSleep.oHrvScore : null;
  if (oHrvScore != null) hcContributed = true;
  const oHrvLabel = oHrvScore != null
    ? (hcSleep.overnightHrv != null ? hcSleep.overnightHrv + 'ms overnight' : 'HC data')
      + (hcSleep.avgOHrv != null ? ' · avg ' + hcSleep.avgOHrv + 'ms' : '')
    : 'Not available · no wearable HRV data';

  /* ── Step 6: Renormalized blend — identical to openHabitsScoreSheet ── */
  const hasEnhancement = durScore != null || oHrvScore != null;
  let effectiveScore = baseScore;

  let totalNomW = 0.60;
  if (durScore  != null) totalNomW += 0.25;
  if (oHrvScore != null) totalNomW += 0.15;

  if (hasEnhancement && res.score >= 0) {
    let wgtSum = baseScore * 0.60;
    if (durScore  != null) wgtSum += durScore  * 0.25;
    if (oHrvScore != null) wgtSum += oHrvScore * 0.15;
    effectiveScore = Math.min(100, Math.max(0, Math.round(wgtSum / totalNomW)));
  }

  /* Renormalized display weights + pts */
  const effW_bed = Math.round((0.60 / totalNomW) * 100);
  const effW_dur = durScore  != null ? Math.round((0.25 / totalNomW) * 100) : 0;
  const effW_hrv = oHrvScore != null ? Math.round((0.15 / totalNomW) * 100) : 0;
  const pts_bed  = Math.round(baseScore  * (0.60 / totalNomW));
  const pts_dur  = durScore  != null ? Math.round(durScore  * (0.25 / totalNomW)) : 0;
  const pts_hrv  = oHrvScore != null ? Math.round(oHrvScore * (0.15 / totalNomW)) : 0;

  const score = effectiveScore;
  const gradeColor = score >= 85 ? '#12D48A' : score >= 70 ? '#29DBA0' : score >= 50 ? '#F7A623' : '#B06EFF';
  const gradeLabel = score >= 85 ? 'EXCELLENT' : score >= 70 ? 'GREAT' : score >= 50 ? 'GOOD' : score >= 35 ? 'FAIR' : 'START';

  /* ── Background ── */
  ctx.fillStyle = '#060614'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,    'rgba(80,40,200,0.28)');
  bg.addColorStop(0.55, 'rgba(40,20,120,0.20)');
  bg.addColorStop(1,    'rgba(176,110,255,0.16)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.80, H * 0.12, 360, 'rgba(176,110,255,0.14)');
  _shareGlow(ctx, W * 0.20, H * 0.86, 300, 'rgba(80,40,200,0.18)');

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Sleep Score');

  /* ── HC badge pill — shown when HC is connected ── */
  if (hcActive) {
    const hcPillW = 130, hcPillH = 32, hcPillX = W - hcPillW - 68, hcPillY = 58;
    _shareRoundRect(ctx, hcPillX, hcPillY, hcPillW, hcPillH, 16);
    ctx.fillStyle = 'rgba(0,200,200,0.15)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,200,200,0.40)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(0,230,230,0.92)';
    ctx.font = `700 15px ${FONT_M}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('HEALTH CONNECT', hcPillX + hcPillW / 2, hcPillY + hcPillH / 2);
  }

  /* ── "SLEEP SCORE" label ── */
  ctx.fillStyle = 'rgba(200,175,255,0.60)';
  ctx.font = `600 22px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('LAST NIGHT\'S SLEEP SCORE', W / 2, 228);

  /* ── Hero glow + number ── */
  _shareGlow(ctx, W / 2, 390, 220, 'rgba(176,110,255,0.12)');
  ctx.save();
  const heroG = ctx.createLinearGradient(200, 260, 880, 470);
  heroG.addColorStop(0, '#FFFFFF');
  heroG.addColorStop(0.55, '#E0CCFF');
  heroG.addColorStop(1, '#B06EFF');
  ctx.fillStyle = heroG;
  ctx.font = `italic 300 ${score >= 100 ? 192 : 240}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(res.score >= 0 ? String(score) : '–', W / 2, 395);
  ctx.restore();

  /* ── Grade ── */
  ctx.fillStyle = gradeColor;
  ctx.font = `700 34px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(gradeLabel, W / 2, 495);

  /* ── Progress bar ── */
  const bX = 140, bY = 534, bW = W - 280, bH = 7;
  _shareRoundRect(ctx, bX, bY, bW, bH, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
  if (score > 0) {
    const barG = ctx.createLinearGradient(bX, 0, bX + bW, 0);
    barG.addColorStop(0, '#6C63FF'); barG.addColorStop(1, '#B06EFF');
    _shareRoundRect(ctx, bX, bY, Math.round(bW * score / 100), bH, 4);
    ctx.fillStyle = barG; ctx.fill();
  }

  if (hasEnhancement && res.score >= 0) {
    /* ── Row layout: Bedtime Mode | Sleep Duration | Overnight HRV ──
       Mirrors the sheet exactly — shown whenever durScore is available
       (Tier 1 HC wearable, Tier 2 bedtime window, or Tier 3 HC-only)    ── */
    const streakDetail = (res.streakBonus || 0) > 0
      ? ' · +' + res.streakBonus + ' streak bonus' : '';
    const bedDataLine = ln && ln.hasData
      ? (ln.bedtimeKept ? 'Bedtime kept ✓' : 'Bedtime missed')
        + ' · ' + (ln.snoozeCount || 0) + ' snooze' + ((ln.snoozeCount || 0) !== 1 ? 's' : '')
        + ' · ' + (ln.appAttemptsTotal || 0) + ' blocked' + streakDetail
      : 'No bedtime data';

    const rows = [
      { icon: '🌙', label: 'Bedtime Mode',    pts: pts_bed, weight: effW_bed, data: bedDataLine, col: '#B06EFF', included: true },
      { icon: '⏱️', label: 'Sleep Duration',  pts: pts_dur, weight: effW_dur, data: durLabel,    col: '#A89CFF', included: durScore != null },
      { icon: '💜', label: 'Overnight HRV',   pts: pts_hrv, weight: effW_hrv, data: oHrvLabel,   col: '#9B84FF', included: oHrvScore != null },
    ];

    const rowH = 110, rowGap = 14, rowX = 72, rowW = W - 144, startRowY = 562;
    rows.forEach((r, i) => {
      const ry = startRowY + i * (rowH + rowGap);
      _shareRoundRect(ctx, rowX, ry, rowW, rowH, 18);
      ctx.fillStyle = r.included ? 'rgba(176,110,255,0.07)' : 'rgba(255,255,255,0.03)'; ctx.fill();
      ctx.strokeStyle = r.included ? 'rgba(176,110,255,0.18)' : 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1; ctx.stroke();

      ctx.font = '28px serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(r.icon, rowX + 20, ry + 32);

      ctx.fillStyle = r.included ? '#EEEEFF' : 'rgba(180,180,220,0.45)';
      ctx.font = `700 24px ${FONT_M}`;
      ctx.fillText(r.label, rowX + 58, ry + 32);

      ctx.fillStyle = 'rgba(150,140,210,0.55)';
      ctx.font = `400 17px ${FONT_M}`;
      ctx.fillText('weight ' + r.weight + '%' + (!r.included ? ' · not included' : ''), rowX + 58, ry + 57);

      const dataText = r.data.length > 52 ? r.data.slice(0, 50) + '…' : r.data;
      ctx.fillStyle = 'rgba(160,150,220,0.60)';
      ctx.font = `400 17px ${FONT_M}`;
      ctx.fillText(dataText, rowX + 58, ry + 80);

      ctx.fillStyle = r.included ? r.col : 'rgba(160,160,200,0.30)';
      ctx.font = `700 32px ${FONT_M}`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('+' + r.pts + ' pts', rowX + rowW - 20, ry + 40);

      const pbX = rowX + 20, pbY = ry + rowH - 14, pbW = rowW - 40, pbH = 4;
      _shareRoundRect(ctx, pbX, pbY, pbW, pbH, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
      if (r.included && r.pts > 0 && r.weight > 0) {
        _shareRoundRect(ctx, pbX, pbY, Math.round(pbW * (r.pts / r.weight)), pbH, 2);
        ctx.fillStyle = r.col; ctx.fill();
      }
    });

    /* streak pill */
    if ((res.bedStreak || 0) > 0) {
      const pillY = 950, pillW = 480, pillH = 50, pillX = (W - pillW) / 2;
      _shareRoundRect(ctx, pillX, pillY, pillW, pillH, 25);
      ctx.fillStyle = 'rgba(176,110,255,0.10)'; ctx.fill();
      ctx.strokeStyle = 'rgba(176,110,255,0.28)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(212,176,255,0.88)';
      ctx.font = `400 22px ${FONT_M}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌙 ' + res.bedStreak + '-night bedtime streak', W / 2, pillY + pillH / 2);
    }

  } else {
    /* ── Base tile layout (no duration data at all) ──
       4 tiles: Bedtime | Snooze | App Blocks | Streak Bonus               ── */
    const adhere   = ln && ln.hasData ? (ln.bedtimeKept ? 'Window kept ✓' : 'Window missed') : 'No data yet';
    const snooze   = ln && ln.hasData ? (ln.snoozeCount || 0) + ' snooze' + ((ln.snoozeCount || 0) !== 1 ? 's' : '') : 'No data yet';
    const attempts = ln && ln.hasData ? (ln.appAttemptsTotal || 0) + ' blocked' : 'No data yet';
    const streakBonusPts = res.streakBonus || 0;

    const tiles = [
      { label: '🌙 BEDTIME',   pts: res.adherePts  || 0, max: 50, data: adhere,   color: '#B06EFF' },
      { label: '⏰ SNOOZE',    pts: res.snoozePts  || 0, max: 30, data: snooze,   color: '#A89CFF' },
      { label: '📵 BLOCKED',  pts: res.attemptPts || 0, max: 20, data: attempts, color: '#7B6FFF' },
    ];

    /* 3-tile row */
    const tW = 292, tH = 188, tGap = 22;
    const tStartX = (W - (tW * 3 + tGap * 2)) / 2, tY = 566;
    tiles.forEach((t, i) => {
      const tx = tStartX + i * (tW + tGap);
      _shareRoundRect(ctx, tx, tY, tW, tH, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

      ctx.fillStyle = t.color;
      ctx.font = `700 17px ${FONT_M}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.label, tx + tW / 2, tY + 28);

      ctx.fillStyle = '#EEEEFF';
      ctx.font = `700 50px ${FONT_M}`;
      ctx.fillText(String(t.pts), tx + tW / 2, tY + 88);

      ctx.fillStyle = 'rgba(136,136,187,0.55)';
      ctx.font = `400 16px ${FONT_M}`;
      ctx.fillText('of ' + t.max + ' pts', tx + tW / 2, tY + 126);

      ctx.fillStyle = 'rgba(136,136,187,0.45)';
      ctx.font = `400 15px ${FONT_M}`;
      const dataText = t.data.length > 18 ? t.data.slice(0, 16) + '…' : t.data;
      ctx.fillText(dataText, tx + tW / 2, tY + 154);
    });

    /* streak bonus row — full-width, shown only when streak bonus > 0 */
    if (streakBonusPts > 0) {
      const sbY = tY + tH + 18, sbH = 70, sbX = tStartX, sbW = tW * 3 + tGap * 2;
      _shareRoundRect(ctx, sbX, sbY, sbW, sbH, 18);
      ctx.fillStyle = 'rgba(176,110,255,0.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(176,110,255,0.20)'; ctx.lineWidth = 1; ctx.stroke();

      ctx.fillStyle = '#D4B0FF';
      ctx.font = `700 20px ${FONT_M}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('🌙  STREAK BONUS', sbX + 20, sbY + sbH / 2);

      ctx.font = `400 17px ${FONT_M}`;
      ctx.fillStyle = 'rgba(200,175,255,0.55)';
      ctx.fillText(res.bedStreak + '-night streak · +3 pts/night (max +20)', sbX + 218, sbY + sbH / 2);

      ctx.fillStyle = '#B06EFF';
      ctx.font = `700 28px ${FONT_M}`;
      ctx.textAlign = 'right';
      ctx.fillText('+' + streakBonusPts + ' pts', sbX + sbW - 20, sbY + sbH / 2);
    }

    /* bedtime streak pill */
    if ((res.bedStreak || 0) > 0) {
      const pillY = streakBonusPts > 0 ? tY + tH + 108 : tY + tH + 22;
      const pillW = 460, pillH = 50, pillX = (W - pillW) / 2;
      _shareRoundRect(ctx, pillX, pillY, pillW, pillH, 25);
      ctx.fillStyle = 'rgba(176,110,255,0.10)'; ctx.fill();
      ctx.strokeStyle = 'rgba(176,110,255,0.28)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(212,176,255,0.88)';
      ctx.font = `400 22px ${FONT_M}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌙 ' + res.bedStreak + '-night bedtime streak', W / 2, pillY + pillH / 2);
    }
  }

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildAppDnaCard — APP DNA share card
   Gold-tinted dark bg · "Your App DNA" italic headline · top app +
   peak/best grid + time-of-day bars
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildAppDnaCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const now       = new Date();
  const monthName = now.toLocaleString('default', { month: 'long' });
  const year      = now.getFullYear();
  const goalMins  = (typeof S !== 'undefined' && S.streakGoalMins) ? S.streakGoalMins : 240;

  const monthlyData = (typeof MONTHLY_DATA !== 'undefined' && MONTHLY_DATA.length) ? MONTHLY_DATA : [];
  const monthlyApps = (typeof MONTHLY_APPS !== 'undefined' && MONTHLY_APPS.length) ? MONTHLY_APPS : [];
  const weekly      = (typeof WEEKLY !== 'undefined') ? WEEKLY : [];
  const dailyUse    = (typeof DAILY_USE !== 'undefined') ? DAILY_USE : [];
  const isMonthly   = monthlyData.length > 0;
  const dataPoints  = isMonthly ? monthlyData.filter(d => d.minutes > 0) : weekly.filter(d => d.minutes > 0);

  const peakEntry = dataPoints.length ? dataPoints.reduce((a, b) => b.minutes > a.minutes ? b : a) : null;
  const bestEntry = dataPoints.length > 1 ? dataPoints.reduce((a, b) => b.minutes < a.minutes ? b : a) : null;
  const topApp    = monthlyApps[0]
    ? { name: monthlyApps[0].name, mins: monthlyApps[0].monthlyMinutes }
    : (dailyUse[0] ? { name: dailyUse[0].name, mins: dailyUse[0].totalMinutes } : null);
  const weekAvg   = dataPoints.length ? Math.round(dataPoints.reduce((s, d) => s + (d.minutes || 0), 0) / dataPoints.length) : 0;

  /* ── Time-of-day slots ── */
  let todSlots = null;
  try {
    const hd = (typeof MONTHLY_HOURLY !== 'undefined' && MONTHLY_HOURLY && MONTHLY_HOURLY.length > 0)
      ? MONTHLY_HOURLY
      : (typeof IS_NATIVE !== 'undefined' && IS_NATIVE && typeof N !== 'undefined' && typeof N.getCachedHourly === 'function'
          ? JSON.parse(N.getCachedHourly() || '[]') : []);
    if (hd.length > 0) {
      const morn = hd.filter(x => x.hour >= 6  && x.hour <= 11).reduce((s, x) => s + (x.minutes || 0), 0);
      const aft  = hd.filter(x => x.hour >= 12 && x.hour <= 16).reduce((s, x) => s + (x.minutes || 0), 0);
      const eve  = hd.filter(x => x.hour >= 17 && x.hour <= 22).reduce((s, x) => s + (x.minutes || 0), 0);
      const ngt  = hd.filter(x => x.hour >= 23 || x.hour <= 5 ).reduce((s, x) => s + (x.minutes || 0), 0);
      const total = morn + aft + eve + ngt || 1;
      todSlots = [
        { label: 'Morning',    pct: Math.round(morn / total * 100), color: '#F7A623' },
        { label: 'Afternoon',  pct: Math.round(aft  / total * 100), color: '#5DD6F8' },
        { label: 'Evening',    pct: Math.round(eve  / total * 100), color: '#A89CFF' },
        { label: 'Late night', pct: Math.round(ngt  / total * 100), color: '#6C63FF' },
      ];
      const peakPct = Math.max(...todSlots.map(s => s.pct));
      if (peakPct < 15) todSlots = null;
    }
  } catch(_) {}

  /* ── Background — gold-tinted dark ── */
  ctx.fillStyle = '#080810'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,    'rgba(247,166,35,0.16)');
  bg.addColorStop(0.5,  'rgba(60,40,200,0.12)');
  bg.addColorStop(1,    'rgba(108,99,255,0.10)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.85, H * 0.10, 360, 'rgba(247,166,35,0.10)');
  _shareGlow(ctx, W * 0.15, H * 0.88, 300, 'rgba(108,99,255,0.14)');

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, monthName + ' ' + year + ' · Patterns');

  /* ── "Your App DNA" italic gold headline ── */
  ctx.save();
  const dnaG = ctx.createLinearGradient(W / 2 - 280, 260, W / 2 + 280, 330);
  dnaG.addColorStop(0, '#FFE082'); dnaG.addColorStop(0.55, '#FFAA44'); dnaG.addColorStop(1, '#FF7020');
  ctx.fillStyle = dnaG;
  ctx.font = `italic 300 96px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Your App DNA', 540, 292);
  ctx.restore();

  /* ── Sub-label ── */
  ctx.fillStyle = 'rgba(136,136,187,0.50)';
  ctx.font = `400 22px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(dataPoints.length + ' days tracked  ·  avg ' + _fmtShare(weekAvg) + '/day', 540, 356);

  /* ── Thin rule ── */
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(80, 390); ctx.lineTo(W - 80, 390); ctx.stroke();

  /* ── Top app tile ── */
  let nextY = 408;
  if (topApp) {
    const aTW = W - 160, aTH = 78;
    _shareRoundRect(ctx, 80, nextY, aTW, aTH, 16);
    ctx.fillStyle = 'rgba(247,166,35,0.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(247,166,35,0.18)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = 'rgba(255,210,100,0.75)';
    ctx.font = `400 18px ${FONT_M}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('📱  TOP APP', 104, nextY + 24);

    ctx.fillStyle = '#EEEEFF';
    ctx.font = `bold 28px ${FONT_M}`;
    ctx.fillText(topApp.name, 104, nextY + 58);

    ctx.fillStyle = 'rgba(136,136,187,0.65)';
    ctx.font = `400 22px ${FONT_M}`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(_fmtShare(topApp.mins) + (isMonthly ? ' this month' : ' today'), W - 104, nextY + aTH / 2);

    nextY += aTH + 14;
  }

  /* ── Peak + Best day grid ── */
  const cellW = (W - 160 - 16) / 2, cellH = 118;
  [
    { label: '📈  PEAK DAY', value: peakEntry ? (peakEntry.label || peakEntry.day || '–') : '–',
      sub: peakEntry ? _fmtShare(peakEntry.minutes) : 'No data', color: '#F04E7A' },
    { label: '✅  BEST DAY', value: bestEntry ? (bestEntry.label || bestEntry.day || '–') : '–',
      sub: bestEntry ? _fmtShare(bestEntry.minutes) : 'Need more data', color: '#12D48A' },
  ].forEach((cell, i) => {
    const cx = 80 + i * (cellW + 16);
    _shareRoundRect(ctx, cx, nextY, cellW, cellH, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = 'rgba(136,136,187,0.50)';
    ctx.font = `400 17px ${FONT_M}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(cell.label, cx + 18, nextY + 26);

    ctx.fillStyle = '#EEEEFF';
    ctx.font = `bold 30px ${FONT_M}`;
    ctx.fillText(String(cell.value).slice(0, 16), cx + 18, nextY + 66);

    ctx.fillStyle = cell.color;
    ctx.font = `bold 22px ${FONT_M}`;
    ctx.fillText(cell.sub, cx + 18, nextY + 100);
  });
  nextY += cellH + 16;

  /* ── Time-of-day bars ── */
  if (todSlots) {
    ctx.fillStyle = 'rgba(136,136,187,0.45)';
    ctx.font = `400 18px ${FONT_M}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('⏰  TIME OF DAY', 80, nextY + 14);
    nextY += 36;

    todSlots.forEach(s => {
      ctx.fillStyle = 'rgba(136,136,187,0.55)';
      ctx.font = `400 18px ${FONT_M}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, 80, nextY + 10);

      const bStartX = 230, bTW = W - 310;
      _shareRoundRect(ctx, bStartX, nextY + 4, bTW, 12, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
      if (s.pct > 0) {
        _shareRoundRect(ctx, bStartX, nextY + 4, Math.round(bTW * s.pct / 100), 12, 6);
        ctx.fillStyle = s.color; ctx.fill();
      }

      ctx.fillStyle = s.color;
      ctx.font = `bold 18px ${FONT_M}`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(s.pct + '%', W - 80, nextY + 10);

      nextY += 40;
    });
  }

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   renderShareCard — unified card renderer. Returns a PNG data URL.
   type: 'streak' | 'weekly' | 'referral' | 'aurelo' | 'body_score' | 'focus_score' | 'screen_score' | 'sleep_score' | 'appdna'
   ═══════════════════════════════════════════════════════════════════════════ */
async function renderShareCard(type, opts) {
  // Ensure Aurelo brand fonts are loaded before any canvas draw calls
  await _shareEnsureFonts();

  const icon = await _shareResolveIcon();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if      (type === 'streak')       _buildStreakCard(ctx, icon);
  else if (type === 'weekly')       _buildWeeklyCard(ctx, icon);
  else if (type === 'referral')     _buildReferralCard(ctx, icon, opts || {});
  else if (type === 'aurelo')       _buildAureloScoreCard(ctx, icon);
  else if (type === 'body_score')   _buildBodyScoreCard(ctx, icon);
  else if (type === 'focus_score')  _buildFocusScoreCard(ctx, icon);
  else if (type === 'screen_score') _buildScreenScoreCard(ctx, icon);
  else if (type === 'sleep_score')  _buildSleepScoreCard(ctx, icon);
  else if (type === 'appdna')       _buildAppDnaCard(ctx, icon);

  return canvas.toDataURL('image/png');
}

/* ── Internal: build share text for each card type ──────────────────────── */
function _shareText(type, opts) {
  const pkgName  = (typeof SELF_PKG !== 'undefined') ? SELF_PKG : 'com.javikastudio.tidyapp';
  const storeUrl = 'https://play.google.com/store/apps/details?id=' + pkgName;
  const refCode  = opts && opts.referralCode ? opts.referralCode : null;
  const goalMins = (typeof S !== 'undefined' && S.streakGoalMins) ? S.streakGoalMins : 240;

  if (type === 'referral') {
    const base = `📱 Aurelo helps you understand and manage your screen time with less friction.\n\nIt automatically organizes your apps into categories, gives you clear screen time insights, and includes features like Focus Mode and App Timers to support healthier phone habits.\n\nCheck it out 👇\n${storeUrl}`;
    return refCode ? base + `\n\nUse my code ${refCode} for a bonus when you sign up.` : base;
  }

  if (type === 'streak') {
    let streak = 0;
    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE && typeof N !== 'undefined') {
      try { streak = N.getStreakDays(goalMins); } catch(_) {}
    }
    if (streak >= 30) return `🔥 ${streak} days without going over my screen time goal! That's my longest streak yet.\n\nTracking with Aurelo — Private & No registration required 👉\n${storeUrl}`;
    if (streak >= 7)  return `🔥 ${streak}-day streak on Aurelo! Keeping daily use under ${_fmtShare(goalMins)}.\n\nBuild better habits 👇\n${storeUrl}`;
    return `📱 Starting a screen time challenge with Aurelo! ${streak > 0 ? `${streak} days in` : 'Day 1'} — goal: under ${_fmtShare(goalMins)}/day.\n\nDownload (Private & No Signup) 👇\n${storeUrl}`;
  }

  if (type === 'aurelo') {
    const data  = (typeof window.getAureloScoreData === 'function') ? window.getAureloScoreData() : null;
    const score = data ? data.score : 0;
    if (score >= 75) return `⭐ Aurelo Score: ${score}/100 today — Screen, Focus and Sleep all on track.\n\nTracking with Aurelo (Private & No Signup) 👇\n${storeUrl}`;
    if (score >= 50) return `📊 Aurelo Score: ${score}/100 today — building better habits one day at a time.\n\nTracking with Aurelo (Private & No Signup) 👇\n${storeUrl}`;
    return `📱 Working on my Aurelo Score (currently ${score}/100). Screen time, focus and sleep all in one place.\n\nTry Aurelo 👇\n${storeUrl}`;
  }

  if (type === 'focus_score') {
    const fd  = (typeof FocusTab !== 'undefined' && typeof FocusTab.loadStripData === 'function')
                ? FocusTab.loadStripData() : {};
    const frs = (typeof FocusScore !== 'undefined' && typeof FocusScore.calculateFocus === 'function')
                ? FocusScore.calculateFocus(fd) : { score: 0 };
    const sc  = frs.score >= 0 ? frs.score : 0;
    return `🎯 Focus Score: ${sc}/100 today — sessions, app timers and mindful pauses tracked with Aurelo.\n\nPrivate & No Signup 👇\n${storeUrl}`;
  }


  if (type === 'screen_score') {
    let _sc = 0;
    try {
      if (typeof window.calculateScreenScoreWithHealthConnect === 'function') {
        const _vm = window.calculateScreenScoreWithHealthConnect();
        _sc = Math.max(0, _vm.effectiveScore || 0);
      }
    } catch (_) {}
    const _goal = (typeof S !== 'undefined' && S.streakGoalMins) ? S.streakGoalMins : 240;
    if (_sc >= 80) return `📱 Screen Score: ${_sc}/100 today — staying under my ${_fmtShare(_goal)} goal with Aurelo.\\n\\nPrivate & No Signup 👇\\n${storeUrl}`;
    if (_sc >= 55) return `📊 Screen Score: ${_sc}/100 today — working on screen time habits with Aurelo.\\n\\nPrivate & No Signup 👇\\n${storeUrl}`;
    return `📱 Screen Score: ${_sc}/100 today — tracking and improving screen habits with Aurelo.\\n\\nTry Aurelo 👇\\n${storeUrl}`;
  }
  if (type === 'sleep_score') {
    let _sc = 0, _streak = 0;
    try {
      if (typeof FocusScore !== 'undefined' && typeof FocusScore.calculateSleep === 'function') {
        const _srs = FocusScore.calculateSleep();
        _streak = _srs.bedStreak || 0;
        if (_srs.score >= 0) {
          let _hcSleep = null;
          if (typeof HealthConnect !== 'undefined' && HealthConnect.isConnected &&
              HealthConnect.isConnected() && typeof HealthConnect.getSleepData === 'function') {
            try { _hcSleep = HealthConnect.getSleepData(); } catch (_e) {}
          }
          const _durScore = _hcSleep && _hcSleep.durScore != null ? _hcSleep.durScore : null;
          const _oHrv     = _hcSleep && _hcSleep.oHrvScore != null ? _hcSleep.oHrvScore : null;
          let _nomW = 0.60;
          if (_durScore != null) _nomW += 0.25;
          if (_oHrv    != null) _nomW += 0.15;
          let _wgt = _srs.score * 0.60;
          if (_durScore != null) _wgt += _durScore * 0.25;
          if (_oHrv    != null) _wgt += _oHrv    * 0.15;
          _sc = Math.min(100, Math.max(0, Math.round(_wgt / _nomW)));
        }
      }
    } catch (_e) {}
    return `🌙 Sleep Score: ${_sc}/100${_streak > 1 ? ` · ${_streak}-night bedtime streak` : ''} — tracking sleep habits with Aurelo.\\n\\nPrivate & No Signup 👇\\n${storeUrl}`;
  }

  if (type === 'body_score') {
    const bd = (typeof window.getBodyScoreData === 'function') ? window.getBodyScoreData() : {};
    const sc = (bd.bodyScore != null && bd.bodyScore >= 0) ? bd.bodyScore : 0;
    const stepsVal = bd.steps != null ? bd.steps.toLocaleString() : null;
    const grade = sc >= 85 ? 'excellent' : sc >= 70 ? 'great' : sc >= 50 ? 'good' : 'fair';
    return stepsVal
      ? `❤️ Body Score: ${sc}/100 (${grade}) — ${stepsVal} steps today, tracked via Health Connect on Aurelo.\n\nPrivate & No Signup 👇\n${storeUrl}`
      : `❤️ Body Score: ${sc}/100 (${grade}) — HRV, resting heart rate & steps via Health Connect on Aurelo.\n\nPrivate & No Signup 👇\n${storeUrl}`;
  }

  if (type === 'appdna') {
    const maArr  = (typeof MONTHLY_APPS !== 'undefined' && MONTHLY_APPS.length) ? MONTHLY_APPS : [];
    const mdArr  = (typeof MONTHLY_DATA !== 'undefined' && MONTHLY_DATA.length) ? MONTHLY_DATA : [];
    const topApp = maArr[0] ? maArr[0].name : null;
    const days   = mdArr.filter(d => d.minutes > 0).length;
    return topApp
      ? `🧬 My App DNA this month: top app is ${topApp} — ${days} days tracked with Aurelo.\n\nYour screen time patterns, beautifully visualised. Private & No Signup 👇\n${storeUrl}`
      : `🧬 Sharing my monthly App DNA from Aurelo — ${days} days tracked.\n\nPrivate & No Signup 👇\n${storeUrl}`;
  }

  // weekly
  const W = (typeof WEEKLY !== 'undefined') ? WEEKLY : [];
  const weekTotal = W.reduce((s, d) => s + (d.minutes || 0), 0);
  const active    = W.filter(d => d.minutes > 0);
  const weekAvg   = active.length ? Math.round(weekTotal / active.length) : 0;
  const cmp = weekAvg > 0 && weekAvg < goalMins
    ? `That's ${_fmtShare(goalMins - weekAvg)} under my daily goal on average 💪`
    : weekAvg > goalMins
    ? `Still working on getting under my ${_fmtShare(goalMins)}/day goal 📉`
    : 'Building better habits one week at a time 📈';
  return `📊 My screen time this week: ${_fmtShare(weekTotal)} (avg ${_fmtShare(weekAvg)}/day).\n${cmp}\n\nTracking with Aurelo (Private & No Signup) 👇\n${storeUrl}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   shareCard — the single public entry point.
   Renders the card + share text, fires the native or web share sheet.
   ═══════════════════════════════════════════════════════════════════════════ */
async function shareCard(type, opts) {
  try {
    toast('Preparing share card…', 'info', 1500);
    const dataUrl  = await renderShareCard(type, opts);
    const base64   = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const text     = _shareText(type, opts);
    const now      = new Date();
    const fileName = `aurelo-${type}-${now.toISOString().slice(0, 10)}-${now.getTime()}`;

    if (typeof IS_NATIVE !== 'undefined' && IS_NATIVE) {
      try {
        nCall('shareImageWithText', base64, fileName, text);
      } catch(_) {
        try { nCall('shareImage', base64, fileName); } catch(__) {
          toast('Could not open share sheet', 'error');
        }
      }
      return;
    }

    // Web / demo fallback
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], fileName + '.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: 'Aurelo', text, files: [file] });
    } else {
      const a = document.createElement('a');
      a.href = dataUrl; a.download = fileName + '.png'; a.click();
      toast('Image saved — share from your gallery!', 'success', 3000);
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      console.error('[shareCard]', err);
      toast('Could not share — try again', 'error');
    }
  }
}