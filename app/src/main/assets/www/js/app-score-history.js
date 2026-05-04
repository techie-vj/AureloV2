/* ═══════════════════════════════════════════════════════════════
   app-score-history.js  —  Score History bottom sheet
   ---------------------------------------------------------------
   Opens a draggable bottom sheet showing score trend charts for
   any pillar: Aurelo, Screen, Focus, Sleep, Body.

   Entry points (called externally):
     ScoreHistory.open(pillarId?)   — opens sheet, optional pillar
     ScoreHistory.close()           — dismisses sheet

   Internal helpers exposed for inline onclick:
     ScoreHistory._setPillar(id)
     ScoreHistory._setWin(id)

   Dependencies:
     ProTier, IS_NATIVE, N (bridge), FocusScore.closeScoreSheet,
     closeAureloScoreSheet (optional — used when navigating to history
     from a parent sheet)
   ═══════════════════════════════════════════════════════════════ */

var ScoreHistory = (function () {
  'use strict';

  /* ── SVG chart geometry ──────────────────────────────────────── */
  var SVG_W = 375;

  // Horizontal range stays the same
  var DX0 = 0, DX1 = 375;

  // Give a bit more space above and below the plotted line
  var DY0 = 4;     // was 6
  var DY1 = 132;   // stays similar, adjust if needed

  // Overall SVG height and label baseline moved down
  var SVG_H = 160; // was 148
  var LABEL_Y = 150; // was ~142

  function toY(v) {
    return DY1 - (v / 100) * (DY1 - DY0);
  }

  /* ── Pillar config ───────────────────────────────────────────── */
  var PILLARS = [
    { id:'aurelo', label:'Aurelo',  key:'aurelo_score_history', cssVar:'--p'  },
    { id:'screen', label:'Screen',  key:'screen_score_history', cssVar:'--c'  },
    { id:'focus',  label:'Focus',   key:'focus_score_history',  cssVar:'--g'  },
    { id:'sleep',  label:'Sleep',   key:'sleep_score_history',  cssVar:'--pu' },
    { id:'body',   label:'Body ✦',  key:'body_score_history',   cssVar:'--a'  },
  ];

  var WINDOWS = [
    { id:'7D',  days:7,   weekly:false, pro:false },
    { id:'30D', days:30,  weekly:false, pro:true  },
    { id:'90D', days:90,  weekly:false, pro:true  },
    { id:'1Y',  days:365, weekly:true,  pro:true  },
  ];

  var ZONES = [
    { lo:85, hi:101, cssVar:'--g', label:'Excellent' },
    { lo:70, hi:85,  cssVar:'--c', label:'Good'      },
    { lo:55, hi:70,  cssVar:'--a', label:'Fair'      },
    { lo:0,  hi:55,  cssVar:'--r', label:'Start'     },
  ];

  /* ── Module state ────────────────────────────────────────────── */
  var _pillar     = 'aurelo';
  var _win        = '7D';
  var _scrub      = null;
  var _isDragging = false;
  var _pts        = [];
  var _n          = 0;

  /* ── Color helpers ───────────────────────────────────────────── */
  function _css(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  /* Resolve a CSS var to rgba(r,g,b,alpha) for use in SVG attributes */
  function _rgba(cssVarName, alpha) {
    var raw = _css(cssVarName);
    var m;
    if ((m = raw.match(/^#([0-9a-f]{6})$/i))) {
      return 'rgba(' + parseInt(m[1].slice(0,2),16) + ','
                     + parseInt(m[1].slice(2,4),16) + ','
                     + parseInt(m[1].slice(4,6),16) + ',' + alpha + ')';
    }
    if ((m = raw.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/))) {
      return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + alpha + ')';
    }
    return 'rgba(108,99,255,' + alpha + ')'; // safe fallback
  }

  function _pCfg()  { return PILLARS.find(function(p){ return p.id === _pillar; }); }
  function _wCfg()  { return WINDOWS.find(function(w){ return w.id === _win;    }); }
  function _color() { return 'var(' + _pCfg().cssVar + ')'; }
  function _colorRaw() { return _css(_pCfg().cssVar); }

  function _grade(v) {
    if (v === null || v === undefined) return { label:'—',        color:'var(--t3)' };
    if (v >= 85) return { label:'Excellent', color:'var(--g)' };
    if (v >= 70) return { label:'Good',      color:'var(--c)' };
    if (v >= 55) return { label:'Fair',      color:'var(--a)' };
    return          { label:'Start',     color:'var(--r)' };
  }

  /* ── Data helpers ────────────────────────────────────────────── */
  function _loadRaw(key) {
    try {
      var s = (typeof IS_NATIVE !== 'undefined' && IS_NATIVE &&
               typeof N !== 'undefined' && N.getStringPref)
        ? N.getStringPref(key)
        : localStorage.getItem(key);
      return JSON.parse(s || '{}');
    } catch (_) { return {}; }
  }

  function _getData(pillarId, days) {
    var p = PILLARS.find(function(x){ return x.id === pillarId; });
    if (!p) return [];
    var hist  = _loadRaw(p.key);
    var today = new Date();
    var out   = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      var k = d.toISOString().slice(0, 10);
      out.push(hist[k] !== undefined ? hist[k] : null);
    }
    return out;
  }

  function _toWeekly(data) {
    var out = [];
    for (var i = 0; i < data.length; i += 7) {
      var chunk = data.slice(i, i + 7).filter(function(v){ return v !== null; });
      out.push(chunk.length >= 3
        ? Math.round(chunk.reduce(function(a,b){return a+b;},0) / chunk.length)
        : null);
    }
    return out;
  }

  /* ── Chart bezier path builder ───────────────────────────────── */
  function _buildPaths(pts) {
    var T = 0.28, segs = [], cur = [];
    pts.forEach(function(p) {
      if (p.v !== null) { cur.push(p); }
      else { if (cur.length) { segs.push(cur); cur = []; } }
    });
    if (cur.length) segs.push(cur);

    var line = '', area = '';
    segs.forEach(function(seg) {
      if (seg.length < 2) return;
      var d = 'M' + seg[0].x.toFixed(1) + ',' + seg[0].y.toFixed(1);
      for (var i = 1; i < seg.length; i++) {
        var p0 = seg[Math.max(0,i-2)], p1 = seg[i-1], p2 = seg[i];
        var p3 = seg[Math.min(seg.length-1,i+1)];
        var c1x=(p1.x+(p2.x-p0.x)*T).toFixed(1), c1y=(p1.y+(p2.y-p0.y)*T).toFixed(1);
        var c2x=(p2.x-(p3.x-p1.x)*T).toFixed(1), c2y=(p2.y-(p3.y-p1.y)*T).toFixed(1);
        d += ' C'+c1x+','+c1y+' '+c2x+','+c2y+' '+p2.x.toFixed(1)+','+p2.y.toFixed(1);
      }
      line += d + ' ';
      area += d+' L'+seg[seg.length-1].x+','+DY1+' L'+seg[0].x+','+DY1+' Z ';
    });
    return { line: line.trim(), area: area.trim() };
  }

  /* ── X-axis label config ─────────────────────────────────────── */
  var _MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var _DA = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  function _xLabels(winId, n) {
    var today = new Date();
    if (winId === '7D') return [0,1,2,3,4,5,6].map(function(i){
      var d = new Date(today); d.setDate(today.getDate()-(6-i));
      return { i:i, label: i===6?'Today':_DA[d.getDay()] };
    });
    if (winId === '30D') return [0,7,14,21,29].map(function(i){
      var d = new Date(today); d.setDate(today.getDate()-(29-i));
      return { i:i, label: d.getDate()+'/'+(d.getMonth()+1) };
    });
    if (winId === '90D') {
      var res = [];
      for (var m = 2; m >= 0; m--) {
        var d = new Date(today); d.setDate(1); d.setMonth(today.getMonth()-m);
        var diff = Math.round((today - d) / 86400000);
        res.push({ i: Math.min(89, Math.max(0, 89-diff)), label: _MO[d.getMonth()] });
      }
      return res;
    }
    if (winId === '1Y') {
      var out = [];
      for (var mm = 0; mm < 12; mm++) out.push({ i: Math.floor(mm*n/12), label: _MO[mm] });
      return out;
    }
    return [];
  }

  function _dateLabel(winId, idx, n) {
    var today = new Date();
    var daFull = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    if (winId === '7D') {
      var d = new Date(today); d.setDate(today.getDate()-(n-1-idx));
      return idx===n-1 ? 'Today' : daFull[d.getDay()]+' '+d.getDate()+' '+_MO[d.getMonth()];
    }
    if (winId === '30D' || winId === '90D') {
      var d2 = new Date(today); d2.setDate(today.getDate()-(n-1-idx));
      return d2.getDate()+' '+_MO[d2.getMonth()];
    }
    if (winId === '1Y') {
      var d3 = new Date(today); d3.setDate(today.getDate()-(n-1-idx)*7);
      return 'Wk of '+d3.getDate()+' '+_MO[d3.getMonth()];
    }
    return '';
  }

  /* ── Ring gauge SVG ──────────────────────────────────────────── */
  function _ringGaugeSvg(score, colorRaw, size) {
    size = size || 108;
    var r      = size * 0.352;
    var circ   = 2 * Math.PI * r;
    var cx     = size / 2, cy = size / 2;
    var strokeW = size * 0.051;
    var fill   = (score !== null && score >= 0) ? (score / 100) * circ : 0;
    var g      = _grade(score);
    var num    = (score !== null && score >= 0) ? score : '—';
    var grLbl  = (score !== null && score >= 0) ? g.label : '';
    var grCol  = (score !== null && score >= 0) ? g.color : 'var(--t3)';
    var strokeColor = colorRaw || _colorRaw();

    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size
      +'" style="overflow:visible;display:block;flex-shrink:0">'
      +'<defs>'
        +'<filter id="sh-rg-glow" x="-30%" y="-30%" width="160%" height="160%">'
          +'<feGaussianBlur stdDeviation="3" result="b"/>'
          +'<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
        +'</filter>'
      +'</defs>'
      +'<circle cx="'+cx+'" cy="'+cy+'" r="'+r.toFixed(1)+'" fill="none"'
        +' stroke="var(--border2)" stroke-width="'+strokeW.toFixed(1)+'"/>'
      +'<circle cx="'+cx+'" cy="'+cy+'" r="'+r.toFixed(1)+'" fill="none"'
        +' stroke="'+strokeColor+'" stroke-width="'+strokeW.toFixed(1)+'"'
        +' stroke-dasharray="'+fill.toFixed(2)+' '+circ.toFixed(2)+'"'
        +' stroke-linecap="round"'
        +' transform="rotate(-90 '+cx+' '+cy+')"'
        +' filter="url(#sh-rg-glow)"'
        +' style="transition:stroke-dasharray 0.85s cubic-bezier(0.34,1.4,0.64,1)"/>'
      +'<text x="'+cx+'" y="'+(cy-4)+'" text-anchor="middle"'
        +' font-family="var(--ff-m)" font-size="'+(size*0.185).toFixed(1)+'" font-weight="700"'
        +' fill="'+strokeColor+'" letter-spacing="-1">'+num+'</text>'
      +'<text x="'+cx+'" y="'+(cy+13)+'" text-anchor="middle"'
        +' font-family="var(--ff-d)" font-style="italic" font-size="'+(size*0.083).toFixed(1)+'"'
        +' fill="'+grCol+'">'+grLbl+'</text>'
      +'</svg>';
  }

  /* ── Main chart SVG ──────────────────────────────────────────── */
  function _chartSvg(paths, pts, labels, bestPt, lastPt, bestIdx, colorRaw) {
    var n = pts.length;
    var cssVar = _pCfg().cssVar;
    var colorA22 = _rgba(cssVar, 0.22);
    var solidColor = colorRaw || _colorRaw();

    // Background horizontal threshold lines
    var threshLines = [85, 70, 55].map(function (t) {
      var y = toY(t).toFixed(1);
      return '<line x1="' + DX0 + '" y1="' + y +
             '" x2="' + DX1 + '" y2="' + y +
             '" stroke="var(--border)" stroke-width="0.8" stroke-dasharray="3,12" />';
    }).join('');

    // X-axis labels with dynamic text-anchor so edge labels don't overflow
    var labelItems = labels.map(function (lbl) {
      var x;
      if (n <= 1) {
        x = DX0 + (DX1 - DX0) / 2;
      } else {
        x = DX0 + (lbl.i / (n - 1)) * (DX1 - DX0);
      }

      var anchor;
      if (lbl.i === 0) {
        anchor = 'start';
      } else if (lbl.i === n - 1) {
        anchor = 'end';
      } else {
        anchor = 'middle';
      }

      var isLast = (lbl.i === n - 1);
      var fontSize = isLast ? 8.5 : 7.5;
      var fontWeight = isLast ? 700 : 400;
      var fill = isLast ? solidColor : 'var(--t3)';

      return '<text x="' + x.toFixed(1) + '" y="' + LABEL_Y +
             '" text-anchor="' + anchor +
             '" fill="' + fill +
             '" font-size="' + fontSize +
             '" font-weight="' + fontWeight +
             '" font-family="var(--ff-b)">' +
             lbl.label +
             '</text>';
    }).join('');

    // BEST marker (only if best index is not today to avoid clutter)
    var bestMark = '';
    if (bestPt && bestPt.y != null && bestIdx !== n - 1) {
      bestMark =
        '<line x1="' + bestPt.x.toFixed(1) +
        '" y1="' + (DY0 - 6) +
        '" x2="' + bestPt.x.toFixed(1) +
        '" y2="' + (bestPt.y - 7).toFixed(1) +
        '" stroke="' + solidColor +
        '" stroke-width="1" stroke-opacity="0.15" stroke-dasharray="2,4" />' +

        '<circle cx="' + bestPt.x.toFixed(1) +
        '" cy="' + bestPt.y.toFixed(1) +
        '" r="5.5" fill="' + solidColor +
        '" fill-opacity="0.10" />' +

        '<circle cx="' + bestPt.x.toFixed(1) +
        '" cy="' + bestPt.y.toFixed(1) +
        '" r="2.5" fill="' + solidColor +
        '" />' +

        '<text x="' + bestPt.x.toFixed(1) +
        '" y="' + (bestPt.y - 10).toFixed(1) +
        '" text-anchor="middle" fill="' + solidColor +
        '" fill-opacity="0.55" font-size="6" font-family="var(--ff-m)" ' +
        'letter-spacing="0.1em">BEST</text>';
    }

    // TODAY dot on the last data point (if present)
    var todayDot = '';
    if (lastPt && lastPt.y != null) {
      todayDot =
        '<circle cx="' + lastPt.x.toFixed(1) +
        '" cy="' + lastPt.y.toFixed(1) +
        '" r="8" fill="' + solidColor +
        '" fill-opacity="0.12" />' +

        '<circle cx="' + lastPt.x.toFixed(1) +
        '" cy="' + lastPt.y.toFixed(1) +
        '" r="3.5" fill="' + solidColor +
        '" filter="url(#sh-dg)" />';
    }

    // Slightly extend clipPath above DY0 so the curve/headroom is never clipped
    var clipPadTop = 8;
    var clipY = DY0 - clipPadTop;
    var clipH = (DY1 - DY0) + clipPadTop;

    return (
      '<svg id="sh-svg" viewBox="0 0 ' + SVG_W + ' ' + SVG_H +
      '" width="100%" style="display:block;cursor:crosshair;touch-action:none" ' +
      'preserveAspectRatio="none">' +

      '<defs>' +
        '<linearGradient id="sh-grad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + colorA22 + '"/>' +
          '<stop offset="1" stop-color="' + _rgba(cssVar, 0) + '"/>' +
        '</linearGradient>' +

        '<clipPath id="sh-cc">' +
          '<rect x="' + DX0 +
          '" y="' + clipY +
          '" width="' + (DX1 - DX0) +
          '" height="' + clipH + '"/>' +
        '</clipPath>' +

        '<filter id="sh-lg">' +
          '<feGaussianBlur stdDeviation="1.5" result="b"/>' +
          '<feMerge>' +
            '<feMergeNode in="b"/>' +
            '<feMergeNode in="SourceGraphic"/>' +
          '</feMerge>' +
        '</filter>' +

        '<filter id="sh-dg">' +
          '<feGaussianBlur stdDeviation="3" result="b"/>' +
          '<feMerge>' +
            '<feMergeNode in="b"/>' +
            '<feMergeNode in="SourceGraphic"/>' +
          '</feMerge>' +
        '</filter>' +
      '</defs>' +

      // Background zone lines and filled area
      '<g clip-path="url(#sh-cc)">' +
        threshLines +
        (paths.area
          ? '<path d="' + paths.area +
            '" fill="url(#sh-grad)"/>'
          : '') +
        (paths.line
          ? '<path d="' + paths.line +
            '" fill="none" stroke="' + solidColor +
            '" stroke-width="1.8" stroke-linecap="round" filter="url(#sh-lg)"/>'
          : '') +
      '</g>' +

      '<g id="sh-crosshair-g"></g>' +
      bestMark +
      todayDot +
      '<g>' + labelItems + '</g>' +

      '<rect id="sh-touch" x="' + DX0 +
      '" y="' + DY0 +
      '" width="' + (DX1 - DX0) +
      '" height="' + (DY1 - DY0) +
      '" fill="transparent" style="cursor:crosshair"/>' +
      '</svg>'
    );
  }

  /* ── Pro gate overlay ────────────────────────────────────────── */
  function _proGateHtml(winId, colorRaw) {
    return '<div style="position:relative;margin-top:12px">'
      +'<div style="filter:blur(5px);pointer-events:none;opacity:0.35">'
        +'<svg viewBox="0 0 375 148" width="100%" style="display:block" preserveAspectRatio="none">'
          +'<path d="M0,95 C60,85 110,72 160,65 C210,58 250,72 290,55 C320,43 355,50 375,42 L375,128 L0,128 Z"'
            +' fill="'+_rgba(_pCfg().cssVar,0.15)+'"/>'
          +'<path d="M0,95 C60,85 110,72 160,65 C210,58 250,72 290,55 C320,43 355,50 375,42"'
            +' fill="none" stroke="'+colorRaw+'" stroke-width="1.8"/>'
        +'</svg>'
      +'</div>'
      +'<div class="sh-pro-gate">'
        +'<div class="sh-pro-gate-eyebrow">PRO FEATURE</div>'
        +'<div class="sh-pro-gate-title">Unlock '+winId+' history</div>'
        +'<button class="sh-pro-gate-btn" style="border-color:'+_rgba(_pCfg().cssVar,0.4)+';color:'+colorRaw+'"'
          +' onclick="typeof ProTier!==\'undefined\'&&ProTier.triggerUpsell&&ProTier.triggerUpsell(\'SCORE_HISTORY\')">'
          +'Upgrade to Pro ✦'
        +'</button>'
      +'</div>'
      +'</div>';
  }

  /* ── Build & inject full sheet ───────────────────────────────── */
  function _render() {
    var isPro    = typeof ProTier !== 'undefined' ? ProTier.isPro : true;
    var pc       = _pCfg();
    var wc       = _wCfg();
    var colorRaw = _colorRaw();
    var colorA12 = _rgba(pc.cssVar, 0.12);
    var colorA06 = _rgba(pc.cssVar, 0.06);

    /* ── Compute data ── */
    var rawData  = _getData(_pillar, wc.days);
    var data     = wc.weekly ? _toWeekly(rawData) : rawData;
    _n = data.length;

    var valid   = data.filter(function(v){ return v !== null; });
    var avg     = valid.length
      ? Math.round(valid.reduce(function(a,b){return a+b;},0)/valid.length) : null;
    var best    = valid.length ? Math.max.apply(null, valid) : null;
    var bestIdx = best !== null ? data.lastIndexOf(best) : -1;

    var half     = Math.floor(valid.length / 2);
    var trendVal = (half >= 1)
      ? Math.round(valid.slice(half).reduce(function(a,b){return a+b;},0) / (valid.length-half))
        - Math.round(valid.slice(0,half).reduce(function(a,b){return a+b;},0) / half)
      : 0;
    var above70 = valid.filter(function(v){return v>=70;}).length;

    /* ── Points ── */
    _pts = data.map(function(v,i){
      return {
        x: DX0 + (_n>1 ? i/(_n-1) : 0.5)*(DX1-DX0),
        y: v!==null ? toY(v) : null,
        v: v,
      };
    });

    var paths  = _buildPaths(_pts);
    var lastPt = null;
    for (var i = _pts.length-1; i>=0; i--) { if (_pts[i].v!==null){lastPt=_pts[i];break;} }
    var bestPt = (bestIdx>=0 && _pts[bestIdx]) ? _pts[bestIdx] : null;

    var labels = _xLabels(_win, _n);
    var g      = _grade(avg);
    var showProGate = wc.pro && !isPro;

    /* ── Trend badge ── */
    var trendDir   = trendVal === 0 ? 'flat' : trendVal > 0 ? 'up' : 'down';
    var trendColor = trendVal === 0 ? 'var(--t3)' : trendVal > 0 ? 'var(--g)' : 'var(--r)';
    var trendText  = trendVal === 0 ? '→ flat' : trendVal > 0 ? '↑ +'+trendVal+' pts' : '↓ '+trendVal+' pts';
    var trendBgRgba   = trendVal===0 ? _rgba('--t3',0.07) : trendVal>0 ? _rgba('--g',0.08) : _rgba('--r',0.08);
    var trendBordRgba = trendVal===0 ? _rgba('--t3',0.18) : trendVal>0 ? _rgba('--g',0.22) : _rgba('--r',0.22);

    /* ── Pillar chips ── */
    var chipsHtml = PILLARS.map(function(p){
      var on = p.id === _pillar;
      var cv = _css(p.cssVar);
      var chipBg  = on ? _rgba(p.cssVar, 0.14) : 'transparent';
      var chipBor = on ? cv : _css('--border2');
      return '<button class="sh-chip'+(on?' sh-chip-on':'')+'" data-pillar="'+p.id+'"'
        +' onclick="ScoreHistory._setPillar(\''+p.id+'\')"'
        +' style="outline-color:'+chipBor+';background:'+chipBg+';color:'+(on?cv:'var(--t3)')+'">'
        +p.label+'</button>';
    }).join('');

    /* ── Window tabs ── */
    var winTabsHtml = WINDOWS.map(function(w){
      var on     = w.id === _win;
      var locked = w.pro && !isPro;
      var col    = on ? colorRaw : 'var(--t2)';
      var bg     = on ? _rgba(pc.cssVar, 0.10) : 'transparent';
      var bord   = on ? colorRaw : 'transparent';
      return '<button class="sh-win-tab'+(on?' sh-win-tab-on':'')+(locked?' sh-win-tab-locked':'')+'"'
        +' data-win="'+w.id+'"'
        +(locked ? '' : ' onclick="ScoreHistory._setWin(\''+w.id+'\')"')
        +' style="color:'+(locked?'var(--t3)':col)+';border-bottom:1.5px solid '+bord+';background:'+bg+'">'
        +w.id
        +(w.pro ? '<span class="sh-pro-badge">PRO</span>' : '')
        +'</button>';
    }).join('');

    /* ── Zone rows ── */
    var zonesHtml = ZONES.map(function(z){
      var active = avg !== null && avg >= z.lo && avg < z.hi;
      var dotCol = active ? _css(z.cssVar) : _rgba(z.cssVar, 0.4);
      return '<div class="sh-zone-row'+(active?' sh-zone-row-on':'')+'">'
        +'<div class="sh-zone-dot" style="background:'+dotCol+';box-shadow:'+(active?'0 0 8px '+dotCol:'none')+'"></div>'
        +'<span class="sh-zone-lo">'+z.lo+'+</span>'
        +'<span class="sh-zone-lbl">'+z.label+'</span>'
        +'</div>';
    }).join('');

    /* ── Chart area ── */
    var chartSection;
    if (valid.length === 0) {
      chartSection = '<div class="sh-empty">'
        +'<div class="sh-empty-icon" style="color:'+colorRaw+'">—</div>'
        +'<div class="sh-empty-title">History is building</div>'
        +'<div class="sh-empty-sub">Aurelo saves a data point each day. Come back tomorrow to see your first trend line.</div>'
        +'</div>';
    } else if (showProGate) {
      chartSection = _proGateHtml(_win, colorRaw);
    } else {
      chartSection = '<div class="sh-chart-wrap" id="sh-chart-wrap">'
        +_chartSvg(paths, _pts, labels, bestPt, lastPt, bestIdx, colorRaw)
        +'<div class="sh-drag-hint" id="sh-drag-hint">drag to scrub</div>'
        +'<div id="sh-tt" class="sh-tooltip" style="display:none"></div>'
        +'</div>';
    }

    /* ── Stats cards ── */
    var statsHtml = [
      {
        label:   'Period avg',
        num:     avg !== null ? avg : '—',
        numCol:  avg !== null ? g.color : 'var(--t3)',
        serif:   avg !== null ? g.label : 'No data yet',
        sub:     valid.length ? above70+' of '+valid.length+' days ≥ Good' : 'Collect more data',
      },
      {
        label:   'All-time best',
        num:     best !== null ? best : '—',
        numCol:  best !== null ? colorRaw : 'var(--t3)',
        serif:   best !== null ? _dateLabel(_win, bestIdx, _n) : '—',
        sub:     trendVal !== 0 ? (trendVal>0?'↑':'↓')+' '+Math.abs(trendVal)+' pts vs prior half' : '→ stable',
      },
    ].map(function(s){
      return '<div class="sh-stat-card">'
        +'<div class="sh-stat-label">'+s.label+'</div>'
        +'<div class="sh-stat-num" style="color:'+s.numCol+'">'+s.num+'</div>'
        +'<div class="sh-stat-serif">'+s.serif+'</div>'
        +'<div class="sh-stat-sub">'+s.sub+'</div>'
        +'</div>';
    }).join('');

    /* ── Body pillar notice ── */
    var bodyNotice = (_pillar === 'body')
      ? '<div class="sh-body-notice" style="border-color:'+_rgba('--a',0.18)+';background:'+_rgba('--a',0.04)+'">'
          +'<span style="color:var(--a)">✦</span>'
          +'<span style="color:var(--t3)">Body Score history begins from when Health Connect was first connected.</span>'
        +'</div>'
      : '';

    /* ── Insight block ── */
    var insightHtml = valid.length > 2
      ? '<div class="sh-insight" style="border-left-color:'+colorRaw+';border-color:'+_rgba(pc.cssVar,0.18)+'">'
          +'<div class="sh-insight-title">'+_pillarInsightTitle(trendDir, pc.id, avg)+'</div>'
          +'<div class="sh-insight-body">'+_pillarInsightBody(pc.id, trendVal, valid.length, above70)+'</div>'
        +'</div>'
      : '';

    /* ── Coach CTA ── */
    var coachHtml = (isPro)
      ? '<div class="sh-coach-card">'
          +'<div class="sh-coach-hdr">'
            +'<div class="sh-coach-icon" style="background:linear-gradient(135deg,var(--p),var(--c))">✦</div>'
            +'<span class="sh-coach-name">Aurelo Coach</span>'
            +'<span class="sh-coach-priv">on-device · private</span>'
          +'</div>'
          +'<div class="sh-coach-body">Ask Coach about your '+pc.label+' trends and get personalised insight from your actual usage data.</div>'
          +'<button class="sh-coach-btn" style="border-color:'+_rgba('--p',0.24)+';background:'+_rgba('--p',0.08)+';color:var(--p2)"'
            +' onclick="ScoreHistory.close();typeof CoachUI.open(null)===\'function\'&&CoachUI.open(null)">Ask Coach →</button>'
        +'</div>'
      : '';

    /* ── Share button label ── */
    var shareKey = { aurelo:'aurelo_score', screen:'screen_score', focus:'focus_score', sleep:'sleep_score', body:'body_score' }[_pillar] || 'aurelo_score';

    /* ── Assemble full HTML ── */
    var html = '<div id="sh-backdrop" class="modal-bg" role="dialog" aria-modal="true" aria-label="Score History"'
      +' onclick="if(event.target===this)ScoreHistory.close()">'
      +'<div id="sh-sheet" class="sheet sh-sheet">'
        +'<div class="sheet-handle"></div>'

        /* Header */
        +'<div class="sh-hdr">'
          +'<div>'
            +'<div class="sh-hdr-eyebrow">SCORE HISTORY</div>'
            +'<div class="sh-hdr-title" id="sh-hdr-title">'+pc.label+' Score</div>'
          +'</div>'
          +'<div class="sh-hdr-actions">'
            +'<button class="sh-share-btn" onclick="shareCard && shareCard(\''+shareKey+'\')" aria-label="Share score">↗ Share</button>'
            +'<button class="sh-close-btn" onclick="ScoreHistory.close()" aria-label="Close">✕</button>'
          +'</div>'
        +'</div>'

        /* Pillar chips */
        +'<div class="sh-chips-row" id="sh-chips-row">'+chipsHtml+'</div>'

        /* Scrollable body */
        +'<div class="sh-body" id="sh-body">'

          /* 1. Ring + trend */
          +'<div class="sh-ring-row">'
            +'<div class="sh-ring-left">'
              +'<div class="sh-trend-badge" style="background:'+trendBgRgba+';border:1px solid '+trendBordRgba+'">'
                +'<span style="font-family:var(--ff-m);font-size:var(--text-xs);font-weight:700;color:'+trendColor+'">'+trendText+'</span>'
              +'</div>'
              +'<div class="sh-period-label" id="sh-period-label">'+wc.days+'-day period average</div>'
              +'<div class="sh-delta-row" id="sh-delta-row">'
                +'vs prior: <span style="font-family:var(--ff-m);font-weight:700;color:'+trendColor+'">'
                +(trendVal>0?'+':'')+trendVal+' pts</span>'
              +'</div>'
              +'<div class="sh-zones" id="sh-zones">'+zonesHtml+'</div>'
            +'</div>'
            +'<div id="sh-ring-wrap">'+_ringGaugeSvg(avg, colorRaw)+'</div>'
          +'</div>'

          /* 2. Insight block */
          + insightHtml

          /* 3. Chart */
          + chartSection

          /* 4. Window tabs */
          +'<div class="sh-win-tabs"><div class="sh-win-tabs-inner">'+winTabsHtml+'</div></div>'

          /* 5. Body pillar notice */
          + bodyNotice

          /* 6. Stats */
          +'<div class="sh-stats">'+statsHtml+'</div>'

          /* 7. Coach */
          + coachHtml

          +'<div style="height:52px"></div>'
        +'</div>' /* sh-body */
      +'</div>' /* sh-sheet */
      +'</div>'; /* sh-backdrop */

    /* ── Inject into DOM ── */
    var existing = document.getElementById('sh-backdrop');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.body.insertAdjacentHTML('beforeend', html);

    /* ── Animate in ── */
    requestAnimationFrame(function(){
      var bd = document.getElementById('sh-backdrop');
      var sh = document.getElementById('sh-sheet');
      if (!bd) return;
      bd.classList.add('open');
      if (sh) sh.style.transform = 'translate3d(0,0,0)';
      _bindScrub();
      _updateZoneHighlights(avg);
    });
  }

  /* ── Insight copy generators ─────────────────────────────────── */
  function _pillarInsightTitle(dir, pillarId, avg) {
    var map = {
      aurelo: { up:'Building momentum', flat:'Holding steady', down:'Room to improve' },
      screen: { up:'Solid screen habits', flat:'Consistent performance', down:'One habit to fix' },
      focus:  { up:'Focus is strengthening', flat:'Sessions on track', down:'Mid-week slip' },
      sleep:  { up:'Sleep improving', flat:'Bedtime consistent', down:'Weekend drift' },
      body:   { up:'Steps up, HRV trending', flat:'Activity holding', down:'Steps need attention' },
    };
    var labels = map[pillarId] || map.aurelo;
    return labels[dir] || labels.flat;
  }

  function _pillarInsightBody(pillarId, trendVal, total, above70) {
    var pct = total > 0 ? Math.round((above70/total)*100) : 0;
    var baseCopy = {
      aurelo: 'You scored Good or above on '+above70+' of '+total+' days ('+pct+'%). Keep your streak alive by hitting your screen goal and completing at least one focus session today.',
      screen: 'Goal adherence and late-night pickup frequency are your biggest levers. Every night you put the phone down before 10 PM is worth roughly 5 extra pts.',
      focus:  'Session completion rate is the core driver. Two completed Deep sessions per week can lift your Focus Score by 8–12 pts.',
      sleep:  'Bedtime consistency is your strongest pillar Mon–Fri. Weekend bedtimes drifting later than 30 min costs roughly 8 pts each night.',
      body:   'Steps and HRV are the two signals tracked here. Hitting 8k steps on 5+ days this week is the fastest way to move your Body Score.',
    };
    return baseCopy[pillarId] || baseCopy.aurelo;
  }

  /* ── Zone highlight update ────────────────────────────────────── */
  function _updateZoneHighlights(score) {
    var rows = document.querySelectorAll('.sh-zone-row');
    rows.forEach(function(row, idx){
      var z = ZONES[idx];
      var active = score !== null && score >= z.lo && score < z.hi;
      row.classList.toggle('sh-zone-row-on', active);
      var dot = row.querySelector('.sh-zone-dot');
      if (dot) {
        var cv = _css(z.cssVar);
        dot.style.background  = active ? cv : _rgba(z.cssVar, 0.35);
        dot.style.boxShadow   = active ? '0 0 8px '+cv : 'none';
      }
    });
  }

  /* ── Scrub/crosshair ─────────────────────────────────────────── */
  function _bindScrub() {
    var svg = document.getElementById('sh-svg');
    if (!svg) return;
    svg.addEventListener('pointerdown', function(e){
      _isDragging = true;
      try { svg.setPointerCapture(e.pointerId); } catch(_){}
      _doScrub(e.clientX);
    });
    svg.addEventListener('pointermove', function(e){
      if (!_isDragging) return;
      _doScrub(e.clientX);
    });
    svg.addEventListener('pointerup', function(){
      _isDragging = false;
      setTimeout(function(){ _clearScrub(); }, 2500);
    });
    svg.addEventListener('pointercancel', function(){
      _isDragging = false; _clearScrub();
    });
  }

  function _doScrub(clientX) {
    var svg = document.getElementById('sh-svg');
    if (!svg || _n < 2) return;
    var rect = svg.getBoundingClientRect();
    var svgX = ((clientX - rect.left) / rect.width) * SVG_W;
    var clamped = Math.max(DX0, Math.min(DX1, svgX));
    var frac = (clamped - DX0) / (DX1 - DX0);
    var idx  = Math.round(frac * (_n - 1));
    var pt   = _pts[idx];
    if (!pt || pt.v === null) { _clearScrub(); return; }
    _scrub = { idx:idx, x:pt.x, y:pt.y, v:pt.v, date:_dateLabel(_win, idx, _n), frac:frac };
    _updateScrubUI();
  }

  function _clearScrub() {
    _scrub = null;
    _updateScrubUI();
  }

  function _updateScrubUI() {
    var ringWrap = document.getElementById('sh-ring-wrap');
    var periodLbl = document.getElementById('sh-period-label');
    var hint      = document.getElementById('sh-drag-hint');
    var tt        = document.getElementById('sh-tt');
    var pc        = _pCfg();
    var wc        = _wCfg();
    var colorRaw  = _colorRaw();
    var displayScore = _scrub
      ? _scrub.v
      : (function(){
          var v = _pts.filter(function(p){return p.v!==null;});
          return v.length ? Math.round(v.reduce(function(a,p){return a+p.v;},0)/v.length) : null;
        })();

    /* Ring update */
    if (ringWrap) ringWrap.innerHTML = _ringGaugeSvg(displayScore, colorRaw);

    /* Period label */
    if (periodLbl) {
      periodLbl.textContent = _scrub ? _scrub.date : (wc.days+'-day period average');
      periodLbl.style.color = _scrub ? colorRaw : '';
    }

    /* Drag hint */
    if (hint) hint.style.opacity = _scrub ? '0' : '1';

    /* Crosshair in SVG */
    var chg = document.getElementById('sh-crosshair-g');
    if (chg) {
      if (!_scrub) {
        chg.innerHTML = '';
      } else {
        var col = colorRaw;
        chg.innerHTML =
          '<line x1="'+_scrub.x.toFixed(1)+'" y1="'+DY0+'" x2="'+_scrub.x.toFixed(1)+'" y2="'+DY1+'"'
            +' stroke="'+col+'" stroke-width="1" stroke-opacity="0.35" stroke-dasharray="3,6"/>'
          +'<line x1="'+DX0+'" y1="'+_scrub.y.toFixed(1)+'" x2="'+DX1+'" y2="'+_scrub.y.toFixed(1)+'"'
            +' stroke="'+col+'" stroke-width="0.7" stroke-opacity="0.14"/>'
          +'<circle cx="'+_scrub.x.toFixed(1)+'" cy="'+_scrub.y.toFixed(1)+'" r="10" fill="'+col+'" fill-opacity="0.1"/>'
          +'<circle cx="'+_scrub.x.toFixed(1)+'" cy="'+_scrub.y.toFixed(1)+'" r="4" fill="'+col+'" filter="url(#sh-dg)"/>'
          +'<circle cx="'+_scrub.x.toFixed(1)+'" cy="'+_scrub.y.toFixed(1)+'" r="2" fill="var(--s0)" fill-opacity="0.9"/>';
      }
    }

    /* Floating tooltip */
    if (tt) {
      if (!_scrub) {
        tt.style.display = 'none';
      } else {
        var g = _grade(_scrub.v);
        tt.style.display = 'block';
        tt.style.left  = _scrub.frac > 0.65 ? 'auto' : ((_scrub.frac*100).toFixed(1)+'%');
        tt.style.right = _scrub.frac > 0.65 ? (((1-_scrub.frac)*100).toFixed(1)+'%') : 'auto';
        tt.style.transform = _scrub.frac > 0.65 ? 'none' : 'translateX(-50%)';
        tt.innerHTML =
          '<div class="sh-tt-date">'+_scrub.date+'</div>'
          +'<div class="sh-tt-score" style="color:'+colorRaw+'">'+_scrub.v+'</div>'
          +'<div class="sh-tt-grade" style="color:'+g.color+'">'+g.label+'</div>';
      }
    }

    /* Zone highlights update */
    _updateZoneHighlights(displayScore);
  }

  /* ── Public API ──────────────────────────────────────────────── */
  function open(pillarId) {
    _pillar     = pillarId || 'aurelo';
    _win        = '7D';
    _scrub      = null;
    _isDragging = false;
    _render();
  }

  function close() {
    var bd = document.getElementById('sh-backdrop');
    if (!bd) return;
    var sh = document.getElementById('sh-sheet');
    bd.style.opacity    = '0';
    bd.style.visibility = 'hidden';
    if (sh) sh.style.transform = 'translate3d(0,100%,0)';
    setTimeout(function(){
      if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
    }, 320);
  }

  function _setPillar(id) {
    _pillar = id; _scrub = null; _isDragging = false;
    _render();
  }

  function _setWin(id) {
    var isPro = typeof ProTier !== 'undefined' ? ProTier.isPro : true;
    var wc    = WINDOWS.find(function(w){ return w.id === id; });
    if (wc && wc.pro && !isPro) {
      if (typeof ProTier !== 'undefined' && ProTier.triggerUpsell) ProTier.triggerUpsell('SCORE_HISTORY');
      return;
    }
    _win = id; _scrub = null; _isDragging = false;
    _render();
  }

  return { open:open, close:close, _setPillar:_setPillar, _setWin:_setWin };

})();

window.ScoreHistory = ScoreHistory;
