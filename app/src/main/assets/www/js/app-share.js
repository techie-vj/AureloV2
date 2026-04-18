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
   _buildAureloScoreCard — AURELO SCORE share card
   Navy-purple bg · Bodoni Moda hero score · three pillar tiles
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildAureloScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const data    = (typeof window.getAureloScoreData === 'function') ? window.getAureloScoreData() : null;
  const score   = data ? data.score   : -1;
  const sScreen = data ? data.sScreen : -1;
  const sFocus  = data ? data.sFocus  : -1;
  const sSleep  = data ? data.sSleep  : -1;
  const goalMins = data ? data.goalMins : ((typeof S !== 'undefined' && S.streakGoalMins) ? S.streakGoalMins : 240);
  const gradeColor = score >= 75 ? '#12D48A' : score >= 55 ? '#F7A623' : '#F04E7A';
  const grade    = score >= 90 ? 'ELITE' : score >= 75 ? 'GREAT' : score >= 55 ? 'GOOD' : score >= 35 ? 'FAIR' : 'START';

  /* ── Background ── */
  ctx.fillStyle = '#08091A'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,    'rgba(108,99,255,0.28)');
  bg.addColorStop(0.55, 'rgba(5,70,160,0.18)');
  bg.addColorStop(1,    'rgba(5,200,232,0.14)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  _shareGlow(ctx, W * 0.85, H * 0.12, 360, 'rgba(108,99,255,0.18)');
  _shareGlow(ctx, W * 0.15, H * 0.88, 300, 'rgba(5,200,232,0.10)');

  /* ── Header ── */
  _shareDrawHeader(ctx, icon, 'Screen · Focus · Sleep');

  /* ── Hero score — Bodoni Moda italic, white→purple gradient ── */
  ctx.save();
  const heroG = ctx.createLinearGradient(200, 270, 880, 450);
  heroG.addColorStop(0, '#FFFFFF');
  heroG.addColorStop(0.6, '#C4B5FF');
  heroG.addColorStop(1, '#6C63FF');
  ctx.fillStyle = heroG;
  ctx.font = `italic 300 ${score >= 100 ? 188 : 224}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(score >= 0 ? String(score) : '–', 540, 390);
  ctx.restore();

  /* ── Grade + label ── */
  ctx.fillStyle = gradeColor;
  ctx.font = `bold 38px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(grade + '  ·  AURELO SCORE', 540, 492);

  /* ── Overall bar ── */
  const barX = 120, barY = 538, barW = W - 240, barH = 8;
  _shareRoundRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  if (score > 0) {
    const fillW = Math.round(barW * score / 100);
    const barG = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    barG.addColorStop(0, '#6C63FF'); barG.addColorStop(1, '#05C8E8');
    _shareRoundRect(ctx, barX, barY, fillW, barH, 4);
    ctx.fillStyle = barG; ctx.fill();
  }

  /* ── Three pillar tiles ── */
  const pillars = [
    { emoji: '📱', label: 'SCREEN',  score: sScreen, color: '#A89CFF', weight: '40%' },
    { emoji: '🎯', label: 'FOCUS',   score: sFocus,  color: '#05C8E8', weight: '35%' },
    { emoji: '🌙', label: 'SLEEP',   score: sSleep,  color: '#B06EFF', weight: '25%' },
  ];
  const cW = 292, cH = 196, cGap = 22;
  const startX = (W - (cW * 3 + cGap * 2)) / 2;
  const cY = 572;

  pillars.forEach((p, i) => {
    const cx = startX + i * (cW + cGap);
    _shareRoundRect(ctx, cx, cY, cW, cH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.font = '40px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, cx + cW / 2, cY + 44);

    ctx.fillStyle = p.score >= 0 ? p.color : 'rgba(255,255,255,0.25)';
    ctx.font = `bold 44px ${FONT_M}`;
    ctx.fillText(p.score >= 0 ? String(p.score) : '–', cx + cW / 2, cY + 104);

    ctx.fillStyle = 'rgba(136,136,187,0.60)';
    ctx.font = `400 17px ${FONT_M}`;
    ctx.fillText(p.label + '  ' + p.weight, cx + cW / 2, cY + 138);

    /* Mini bar */
    const mbX = cx + 20, mbY = cY + 162, mbW = cW - 40, mbH = 4;
    _shareRoundRect(ctx, mbX, mbY, mbW, mbH, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    if (p.score > 0) {
      _shareRoundRect(ctx, mbX, mbY, Math.round(mbW * p.score / 100), mbH, 2);
      ctx.fillStyle = p.color; ctx.fill();
    }
  });

  /* ── Goal + date context ── */
  ctx.fillStyle = 'rgba(136,136,187,0.50)';
  ctx.font = `400 21px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const dateStr = new Date().toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillText('Daily goal · ' + _fmtShare(goalMins) + '  ·  ' + dateStr, 540, 810);

  /* ── Footer ── */
  _shareDrawFooter(ctx, H);
}

/* ═══════════════════════════════════════════════════════════════════════════
   _buildFocusScoreCard — FOCUS SCORE share card
   Indigo-cyan bg · hero score · session / timer / mindful rows
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildFocusScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const d   = (typeof _loadStripData === 'function') ? _loadStripData() : {};
  const res = (typeof calculateFocusScore === 'function') ? calculateFocusScore(d)
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
   _buildSleepScoreCard — SLEEP SCORE share card
   Midnight-purple bg · hero score · bedtime / snooze / app-block tiles
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildSleepScoreCard(ctx, icon) {
  const W = 1080, H = 1080;
  const FONT_D = "'Bodoni Moda', Georgia, serif";
  const FONT_M = "'JetBrains Mono', monospace";

  const res = (typeof calculateSleepScore === 'function') ? calculateSleepScore()
    : { score: -1, adherePts: 0, snoozePts: 0, attemptPts: 0, bedStreak: 0, lastNight: null };
  const score = res.score >= 0 ? res.score : 0;
  const gradeColor = score >= 75 ? '#12D48A' : score >= 50 ? '#F7A623' : '#B06EFF';
  const ln = res.lastNight || null;

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

  /* ── Subtle moon glow behind hero ── */
  _shareGlow(ctx, 540, 390, 200, 'rgba(176,110,255,0.10)');

  /* ── Hero score ── */
  ctx.save();
  const heroG = ctx.createLinearGradient(200, 260, 880, 440);
  heroG.addColorStop(0, '#FFFFFF'); heroG.addColorStop(1, '#D4B0FF');
  ctx.fillStyle = heroG;
  ctx.font = `italic 300 ${score >= 100 ? 188 : 224}px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(res.score >= 0 ? String(score) : '–', 540, 390);
  ctx.restore();

  /* ── Label ── */
  ctx.fillStyle = gradeColor;
  ctx.font = `bold 38px ${FONT_M}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SLEEP  SCORE', 540, 490);

  /* ── Progress bar ── */
  const bX = 120, bY = 536, bW = W - 240, bH = 8;
  _shareRoundRect(ctx, bX, bY, bW, bH, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  if (score > 0) {
    const barG = ctx.createLinearGradient(bX, 0, bX + bW, 0);
    barG.addColorStop(0, '#6C63FF'); barG.addColorStop(1, '#B06EFF');
    _shareRoundRect(ctx, bX, bY, Math.round(bW * score / 100), bH, 4);
    ctx.fillStyle = barG; ctx.fill();
  }

  /* ── Three component tiles ── */
  const adhere = (ln && ln.hasData) ? (ln.bedtimeKept ? 'Window respected ✓' : 'Window missed') : 'No data yet';
  const snooze = (ln && ln.hasData) ? ((ln.snoozeCount || 0) + ' snooze' + ((ln.snoozeCount || 0) !== 1 ? 's' : '') + ' last night') : 'No data yet';
  const attempts = (ln && ln.hasData) ? ((ln.appAttemptsTotal || 0) + ' attempt' + ((ln.appAttemptsTotal || 0) !== 1 ? 's' : '') + ' blocked') : 'No data yet';

  const tiles = [
    { label: '🌙  BEDTIME',    pts: res.adherePts  || 0, max: 50, data: adhere,   color: '#B06EFF' },
    { label: '⏰  SNOOZE',     pts: res.snoozePts  || 0, max: 30, data: snooze,   color: '#A89CFF' },
    { label: '📵  APP BLOCKS', pts: res.attemptPts || 0, max: 20, data: attempts, color: '#7B6FFF' },
  ];
  const tW = 292, tH = 192, tGap = 22;
  const tStartX = (W - (tW * 3 + tGap * 2)) / 2;
  const tY = 572;

  tiles.forEach((t, i) => {
    const tx = tStartX + i * (tW + tGap);
    _shareRoundRect(ctx, tx, tY, tW, tH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = t.color;
    ctx.font = `bold 20px ${FONT_M}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.label, tx + tW / 2, tY + 30);

    ctx.fillStyle = '#EEEEFF';
    ctx.font = `bold 52px ${FONT_M}`;
    ctx.fillText(String(t.pts), tx + tW / 2, tY + 92);

    ctx.fillStyle = 'rgba(136,136,187,0.55)';
    ctx.font = `400 18px ${FONT_M}`;
    ctx.fillText('of ' + t.max + ' pts', tx + tW / 2, tY + 132);

    ctx.fillStyle = 'rgba(136,136,187,0.45)';
    ctx.font = `400 16px ${FONT_M}`;
    const dataText = t.data.length > 22 ? t.data.slice(0, 20) + '…' : t.data;
    ctx.fillText(dataText, tx + tW / 2, tY + 162);
  });

  /* ── Bedtime streak pill ── */
  if ((res.bedStreak || 0) > 0) {
    const pillW = 460, pillH = 56, pillY = 800;
    const pillX = (W - pillW) / 2;
    _shareRoundRect(ctx, pillX, pillY, pillW, pillH, 28);
    ctx.fillStyle = 'rgba(176,110,255,0.10)'; ctx.fill();
    ctx.strokeStyle = 'rgba(176,110,255,0.28)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(212,176,255,0.88)';
    ctx.font = `400 24px ${FONT_M}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🌙 ' + res.bedStreak + '-night bedtime streak', W / 2, pillY + pillH / 2);
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
   type: 'streak' | 'weekly' | 'referral' | 'aurelo' | 'focus_score' | 'sleep_score' | 'appdna'
   ═══════════════════════════════════════════════════════════════════════════ */
async function renderShareCard(type, opts) {
  // Ensure Aurelo brand fonts are loaded before any canvas draw calls
  await _shareEnsureFonts();

  const icon = await _shareResolveIcon();
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if      (type === 'streak')      _buildStreakCard(ctx, icon);
  else if (type === 'weekly')      _buildWeeklyCard(ctx, icon);
  else if (type === 'referral')    _buildReferralCard(ctx, icon, opts || {});
  else if (type === 'aurelo')      _buildAureloScoreCard(ctx, icon);
  else if (type === 'focus_score') _buildFocusScoreCard(ctx, icon);
  else if (type === 'sleep_score') _buildSleepScoreCard(ctx, icon);
  else if (type === 'appdna')      _buildAppDnaCard(ctx, icon);

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
    const fd  = (typeof _loadStripData === 'function') ? _loadStripData() : {};
    const frs = (typeof calculateFocusScore === 'function') ? calculateFocusScore(fd) : { score: 0 };
    const sc  = frs.score >= 0 ? frs.score : 0;
    return `🎯 Focus Score: ${sc}/100 today — sessions, app timers and mindful pauses tracked with Aurelo.\n\nPrivate & No Signup 👇\n${storeUrl}`;
  }

  if (type === 'sleep_score') {
    const srs    = (typeof calculateSleepScore === 'function') ? calculateSleepScore() : { score: 0, bedStreak: 0 };
    const sc     = srs.score >= 0 ? srs.score : 0;
    const streak = srs.bedStreak || 0;
    return `🌙 Sleep Score: ${sc}/100${streak > 1 ? ` · ${streak}-night bedtime streak` : ''} — tracking sleep habits with Aurelo.\n\nPrivate & No Signup 👇\n${storeUrl}`;
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