/* ═══════════════════════════════════════════════════════════════
   app-weekly-recap.js — "Your Week in Apps" bottom sheet
   ---------------------------------------------------------------
   Entry points:
     WeeklyRecap.open(isoWeekYear?)  — opens sheet for that week
     WeeklyRecap.close()             — dismisses sheet

   PRO-only. Follows the ScoreHistory sheet pattern.
   Dependencies: ProTier, IS_NATIVE, N (bridge), fmtM, appIco,
                 shareCard, toast
   ═══════════════════════════════════════════════════════════════ */

var WeeklyRecap = (function () {
  'use strict';

  var _currentWeek = '';

  // ── Color helpers ─────────────────────────────────────────────
  function _css(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }
  function _rgba(cssVar, a) {
    var raw = _css(cssVar);
    var m;
    if ((m = raw.match(/^#([0-9a-f]{6})$/i))) {
      return 'rgba('+parseInt(m[1].slice(0,2),16)+','+parseInt(m[1].slice(2,4),16)+','+parseInt(m[1].slice(4,6),16)+','+a+')';
    }
    if ((m = raw.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/))) {
      return 'rgba('+m[1]+','+m[2]+','+m[3]+','+a+')';
    }
    return 'rgba(108,99,255,'+a+')';
  }

  // ── Score helpers ─────────────────────────────────────────────
  function _gradeColor(avg) {
    if (avg >= 70) return 'var(--g)';
    if (avg >= 50) return 'var(--a)';
    return 'var(--r)';
  }

  // ── Bar chart SVG (7-day screen time) ─────────────────────────
  function _barChartSvg(days, goalMins) {
    var W = 310, H = 72, PAD_L = 0, PAD_R = 0;
    var BAR_AREA_W = W - PAD_L - PAD_R;
    var n = 7;
    var slotW = BAR_AREA_W / n;
    var barW  = Math.max(4, slotW * 0.55);
    var maxV  = Math.max(goalMins * 1.5, Math.max.apply(null, days.map(function(d){ return d||0; })));
    if (maxV <= 0) maxV = 240;

    var LABELS = ['M','T','W','T','F','S','S'];
    var today  = new Date().getDay(); // 0=Sun
    var todayIdx = today === 0 ? 6 : today - 1; // convert to Mon=0 index

    var bars = days.map(function(v, i) {
      var x   = PAD_L + i * slotW + slotW / 2;
      var pct = v > 0 ? Math.min(v / maxV, 1) : 0;
      var barH = Math.max(2, pct * (H - 20));
      var y   = H - 14 - barH;
      var isOver = v > goalMins;
      var isToday = i === todayIdx;
      var col = isOver
        ? _rgba('--r', 0.75)
        : isToday
          ? _rgba('--p', 0.9)
          : _rgba('--p', 0.45);
      return { x:x, y:y, barH:barH, col:col, v:v, label:LABELS[i], isToday:isToday };
    });

    // Goal reference line Y
    var goalPct = Math.min(goalMins / maxV, 1);
    var goalY   = (H - 14) - goalPct * (H - 20);

    var barsSvg = bars.map(function(b) {
      return '<rect x="'+(b.x - barW/2).toFixed(1)+'" y="'+b.y.toFixed(1)+'"'
        +' width="'+barW.toFixed(1)+'" height="'+b.barH.toFixed(1)+'"'
        +' rx="3" fill="'+b.col+'"'
        +(b.isToday ? ' filter="url(#wr-glow)"' : '')
        +'/>';
    }).join('');

    var labelsSvg = bars.map(function(b, i) {
      var fw = b.isToday ? 700 : 400;
      var fill = b.isToday ? _rgba('--p', 0.9) : 'var(--t3)';
      return '<text x="'+b.x.toFixed(1)+'" y="'+(H-2)+'"'
        +' text-anchor="middle" fill="'+fill+'"'
        +' font-size="8" font-weight="'+fw+'" font-family="var(--ff-m)">'+b.label+'</text>';
    }).join('');

    return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block;overflow:visible">'
      +'<defs>'
        +'<filter id="wr-glow" x="-40%" y="-40%" width="180%" height="180%">'
          +'<feGaussianBlur stdDeviation="3" result="b"/>'
          +'<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
        +'</filter>'
      +'</defs>'
      // Goal line
      +'<line x1="'+PAD_L+'" y1="'+goalY.toFixed(1)+'" x2="'+(W-PAD_R)+'" y2="'+goalY.toFixed(1)+'"'
        +' stroke="'+_rgba('--t3', 0.3)+'" stroke-width="1" stroke-dasharray="4,6"/>'
      +'<text x="'+(W-PAD_R-2)+'" y="'+(goalY-3).toFixed(1)+'"'
        +' text-anchor="end" fill="var(--t3)" font-size="7" font-family="var(--ff-m)">goal</text>'
      + barsSvg
      + labelsSvg
      +'</svg>';
  }

  // ── Ring gauge SVG (score) ─────────────────────────────────────
  function _ringGaugeSvg(score, grade, gradeColor, size) {
    size = size || 88;
    var r     = size * 0.36;
    var circ  = 2 * Math.PI * r;
    var cx    = size/2, cy = size/2;
    var sw    = size * 0.055;
    var fill  = score >= 0 ? (score/100) * circ : 0;
    var col   = score >= 0 ? _gradeColor(score) : 'var(--t3)';
    var num   = score >= 0 ? score : '–';

    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">'
      +'<circle cx="'+cx+'" cy="'+cy+'" r="'+r.toFixed(1)+'" fill="none"'
        +' stroke="var(--border2)" stroke-width="'+sw.toFixed(1)+'"/>'
      +'<circle cx="'+cx+'" cy="'+cy+'" r="'+r.toFixed(1)+'" fill="none"'
        +' stroke="'+col+'" stroke-width="'+sw.toFixed(1)+'"'
        +' stroke-dasharray="'+fill.toFixed(2)+' '+circ.toFixed(2)+'"'
        +' stroke-linecap="round" transform="rotate(-90 '+cx+' '+cy+')"'
        +' style="transition:stroke-dasharray 0.7s cubic-bezier(.34,1.4,.64,1)"/>'
      +'<text x="'+cx+'" y="'+(cy-2)+'" text-anchor="middle"'
        +' font-family="var(--ff-d)" font-size="'+(size*0.22).toFixed(1)+'" font-weight="700"'
        +' fill="'+col+'">'+num+'</text>'
      +(grade ? '<text x="'+cx+'" y="'+(cy+11)+'" text-anchor="middle"'
        +' font-family="var(--ff-d)" font-style="italic" font-size="'+(size*0.09).toFixed(1)+'"'
        +' fill="'+gradeColor+'">'+grade+'</text>' : '')
      +'</svg>';
  }

  // ── Main render ───────────────────────────────────────────────
  function _render(isoWeekYear, data) {
    var isPro = typeof ProTier !== 'undefined' ? ProTier.isPro : true;
    if (!isPro) return;

    var avg          = data.weeklyAvg || -1;
    var gradeLabel   = data.gradeLabel || '';
    var gradeColor   = _gradeColor(avg);
    var delta        = data.scoreDelta || 0;
    var hasDelta     = !!data.hasDelta;
    var dateRange    = data.dateRange || '';
    var screenDays   = data.screenTimeDays || [];
    var goalMins     = data.goalMins || 240;
    var avgMins      = data.avgDailyMins || 0;
    var goalMet      = data.goalMetCount || 0;
    var streak       = data.streak || 0;
    var topApps      = data.topApps || [];
    var coach        = data.coachOneLiner || '';
    var isPartial    = !!data.isPartial;
    var isCurrentWk  = !!data.isCurrentWeek;

    // ── Hero section ──────────────────────────────────────────
    var ringHtml = _ringGaugeSvg(avg, gradeLabel, gradeColor);

    var gradeBadge = avg >= 0
      ? '<span class="wr-grade-badge" style="background:'+_rgba(avg>=70?'--g':avg>=50?'--a':'--r',0.12)
          +';border-color:'+_rgba(avg>=70?'--g':avg>=50?'--a':'--r',0.3)
          +';color:'+gradeColor+'">'+gradeLabel+'</span>'
      : '';

    var deltaHtml = '';
    if (hasDelta) {
      var dSign  = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
      var dColor = delta > 0 ? 'var(--g)' : delta < 0 ? 'var(--r)' : 'var(--t3)';
      var dAbs   = Math.abs(delta);
      deltaHtml = '<div class="wr-delta" style="color:'+dColor+'">'
        +dSign+(delta !== 0 ? ' '+dAbs+' pts' : ' flat')+' vs last week</div>';
    }

    // ── Bar chart ─────────────────────────────────────────────
    var chartHtml = '';
    if (isCurrentWk && screenDays.some(function(v){ return v > 0; })) {
      chartHtml = '<div class="wr-chart-wrap">' + _barChartSvg(screenDays, goalMins) + '</div>';
    } else if (!isCurrentWk) {
      chartHtml = '<div class="wr-chart-unavail">Screen time chart available for the current week only</div>';
    }

    // ── Stats pills ───────────────────────────────────────────
    var avgStr = fmtM ? fmtM(avgMins) : Math.round(avgMins/60)+'h';
    var statsPills = [
      { icon:'🔥', label: streak > 0 ? streak+'-day streak' : 'No streak' },
      { icon:'🎯', label: goalMet+' of 7 goals met' },
      { icon:'📱', label: (isCurrentWk && avgMins > 0) ? avgStr+' avg/day' : 'Tracking…' },
    ].map(function(p) {
      return '<div class="wr-stat-pill">'
        +'<span class="wr-stat-icon">'+p.icon+'</span>'
        +'<span class="wr-stat-label">'+p.label+'</span>'
        +'</div>';
    }).join('');

    // ── Top apps ──────────────────────────────────────────────
    var topAppsHtml = '';
    if (topApps.length > 0 && isCurrentWk) {
      topAppsHtml = '<div class="wr-section-label">TOP APPS THIS WEEK</div>'
        +'<div class="wr-apps-list">'
        + topApps.map(function(app, i) {
            var mins = app.totalMins || 0;
            var timeStr = fmtM ? fmtM(mins) : Math.round(mins/60)+'h';
            var iconHtml = (typeof appIco === 'function')
              ? appIco(app.packageName, 32, 8)
              : '<div class="wr-app-ico-fb">'+(app.name||'?').charAt(0)+'</div>';
            return '<div class="wr-app-row">'
              +'<div class="wr-app-ico">'+iconHtml+'</div>'
              +'<div class="wr-app-name">'+(app.name||app.packageName||'Unknown')+'</div>'
              +'<div class="wr-app-time">'+timeStr+'</div>'
              +'</div>';
          }).join('')
        +'</div>';
    }

    // ── Coach one-liner ───────────────────────────────────────
    var coachHtml = (coach && isPro)
      ? '<div class="wr-coach-line">'
          +'<span class="wr-coach-badge">Coach ✦</span>'
          +'<span class="wr-coach-text">'+_escHtml(coach)+'</span>'
        +'</div>'
      : '';

    // ── Partial data notice ───────────────────────────────────
    var partialHtml = isPartial
      ? '<div class="wr-partial-note">'
          +'📊 Still building your picture — your first full weekly recap arrives after 5+ days of data.'
        +'</div>'
      : '';

    // ── Assemble HTML ─────────────────────────────────────────
    var html = '<div id="wr-backdrop" class="modal-bg" role="dialog" aria-modal="true" aria-label="Your Week in Apps"'
      +' onclick="if(event.target===this)WeeklyRecap.close()">'
      +'<div id="wr-sheet" class="sheet wr-sheet">'
        +'<div class="sheet-handle"></div>'

        // Header
        +'<div class="wr-hdr">'
          +'<div>'
            +'<div class="wr-eyebrow">YOUR WEEK</div>'
            +'<div class="wr-date-range">'+dateRange+'</div>'
          +'</div>'
          +'<button class="wr-close-btn" onclick="WeeklyRecap.close()" aria-label="Close">✕</button>'
        +'</div>'

        // Scrollable body
        +'<div class="wr-body">'

          // Hero row: ring + grade/delta
          +'<div class="wr-hero-row">'
            +'<div class="wr-ring-wrap">'+ringHtml+'</div>'
            +'<div class="wr-hero-right">'
              +'<div class="wr-hero-label">Aurelo Score avg</div>'
              + gradeBadge
              + deltaHtml
              +(avg < 0 ? '<div class="wr-no-data">Not enough data yet</div>' : '')
            +'</div>'
          +'</div>'

          // Bar chart
          + chartHtml

          // Stats pills
          +'<div class="wr-stats-row">'+statsPills+'</div>'

          // Top apps
          + topAppsHtml

          // Coach line
          + coachHtml

          // Partial notice
          + partialHtml

          // Share CTA
          +'<button class="wr-share-btn" onclick="WeeklyRecap._share(\''
            +_escAttr(isoWeekYear)+'\')">↗ Share my week</button>'

          +'<div style="height:40px"></div>'
        +'</div>' // wr-body
      +'</div>' // wr-sheet
      +'</div>'; // wr-backdrop

    // ── Inject & animate ──────────────────────────────────────
    var existing = document.getElementById('wr-backdrop');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.body.insertAdjacentHTML('beforeend', html);

    requestAnimationFrame(function() {
      var bd = document.getElementById('wr-backdrop');
      var sh = document.getElementById('wr-sheet');
      if (!bd) return;
      bd.classList.add('open');
      if (sh) {
        sh.classList.add('wr-animating');
        sh.style.transform = 'translate3d(0,0,0)';
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────
  function _escHtml(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function _escAttr(s) {
    return (s||'').replace(/'/g,"\\'");
  }

  // ── Public API ────────────────────────────────────────────────

  function open(isoWeekYear) {
    var isPro = typeof ProTier !== 'undefined' ? ProTier.isPro : true;
    if (!isPro) {
      if (typeof ProTier !== 'undefined' && ProTier.triggerUpsell) {
        ProTier.triggerUpsell('WEEKLY_RECAP');
      }
      return;
    }

    // Get current week if not specified
    if (!isoWeekYear && IS_NATIVE && typeof N !== 'undefined' &&
        typeof N.getCurrentIsoWeekYear === 'function') {
      isoWeekYear = N.getCurrentIsoWeekYear();
    }
    if (!isoWeekYear) {
      // Fallback: compute in JS
      isoWeekYear = _currentWeekKey();
    }
    _currentWeek = isoWeekYear;

    // Fetch data from bridge
    var data = {};
    if (IS_NATIVE && typeof N !== 'undefined' &&
        typeof N.getWeeklyRecapData === 'function') {
      try {
        var raw = N.getWeeklyRecapData(isoWeekYear);
        data = JSON.parse(raw || '{}');
      } catch(_) {}
    }

    // Fallback demo data for browser preview
    if (!IS_NATIVE) {
      data = _demoData(isoWeekYear);
    }

    _render(isoWeekYear, data);
  }

  function close() {
    var bd = document.getElementById('wr-backdrop');
    if (!bd) return;
    var sh = document.getElementById('wr-sheet');
    bd.style.opacity    = '0';
    bd.style.visibility = 'hidden';
    if (sh) sh.style.transform = 'translate3d(0,100%,0)';
    setTimeout(function() {
      if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
    }, 320);
  }

  function _share(isoWeekYear) {
    if (typeof shareCard === 'function') {
      shareCard('weekly', { isoWeekYear: isoWeekYear || _currentWeek });
    }
    close();
  }

  // ── Current week key (JS fallback) ────────────────────────────
  function _currentWeekKey() {
    var now  = new Date();
    var day  = now.getDay(); // 0=Sun
    var diff = day === 0 ? -6 : 1 - day; // shift to Monday
    var mon  = new Date(now); mon.setDate(now.getDate() + diff);
    var year = mon.getFullYear();
    // Simple week number (ISO approximate)
    var startOfYear = new Date(year, 0, 1);
    var weekNo = Math.ceil(((mon - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return year + '-W' + String(weekNo).padStart(2, '0');
  }

  // ── Demo data (browser preview only) ─────────────────────────
  function _demoData(key) {
    return {
      isoWeekYear:    key,
      dateRange:      'May 12 – 18',
      weeklyAvg:      74,
      gradeLabel:     'Good',
      scoreDelta:     +6,
      hasDelta:       true,
      dailyScores:    [68, 72, 75, 80, 71, 66, 78],
      screenTimeDays: [145, 132, 118, 105, 155, 190, 110],
      avgDailyMins:   136,
      goalMins:       180,
      goalMetCount:   5,
      streak:         8,
      topApps: [
        { name:'Instagram',  packageName:'com.instagram.android',    totalMins:210 },
        { name:'YouTube',    packageName:'com.google.android.youtube',totalMins:165 },
        { name:'WhatsApp',   packageName:'com.whatsapp',             totalMins:98  },
      ],
      coachOneLiner: 'Good week — goal hit 5 of 7 days and an 8-day streak building. Consistency is your strongest habit right now.',
      isPartial:      false,
      isCurrentWeek:  true,
    };
  }

  return { open:open, close:close, _share:_share };

})();

window.WeeklyRecap = WeeklyRecap;
