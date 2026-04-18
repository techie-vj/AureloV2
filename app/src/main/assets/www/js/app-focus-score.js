'use strict';
/* ═══════════════════════════════════════════════════════════════
 * FOCUS SCORE MODULE — app-focus-score.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Focus/Sleep/Aurelo score calculations, score history,
 *       focus streak, static rows (7-day calendar), dynamic
 *       event rows, score-detail bottom sheets.
 *
 * Public API (via FocusScore.*):
 *   calculateFocus()          → {score, sessPts, timerPts, …}
 *   calculateSleep()          → {score, adherePts, …, bedStreak}
 *   calculateAurelo()         → {score, screenScore, …}
 *   renderFocusStaticRow()    — renders #focus-static-row
 *   renderHabitsStaticRow()   — renders #habits-static-row
 *   renderFocusDynamicRow()   — renders #focus-dynamic-row
 *   renderHabitsDynamicRow()  — renders #habits-dynamic-row
 *   openFocusScoreSheet()
 *   openHabitsScoreSheet()
 *   maybeEarnFocusStreak(d)
 *   getFocusStreak()          → {count, lastDate, earnedDates}
 * ═══════════════════════════════════════════════════════════════ */
window.FocusScore = (function () {

  /* ── Constants ─────────────────────────────────────────────── */
  var _FOCUS_SCORE_KEY  = 'focus_score_history';
  var _SLEEP_SCORE_KEY  = 'sleep_score_history';
  var _FOCUS_STREAK_KEY = 'focus_streak_v1';
  var _STRIP_CACHE_TTL  = 2000;

  /* ── Sleep score cache ─────────────────────────────────────── */
  var _sleepScoreCache   = null;
  var _sleepScoreCacheTs = 0;

  /* ── Score calculations ────────────────────────────────────── */
  function calculateFocus(d) {
    d = d || (typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {});
    var totalW=0, earned=0, sessW=0, timerW=0, mindfulW=0, sessPts=0, timerPts=0, mindfulPts=0;
    if (d.total > 0)      { sessW=40;    sessPts=Math.round((d.completed/d.total)*40);                                totalW+=sessW;    earned+=sessPts; }
    if (d.timerTotal > 0) { timerW=35;   timerPts=Math.round(((d.timerTotal-d.timerOverCount)/d.timerTotal)*35);     totalW+=timerW;   earned+=timerPts; }
    if (d.pauseCount > 0) { mindfulW=25; mindfulPts=Math.round((d.resistCount/d.pauseCount)*25);                     totalW+=mindfulW; earned+=mindfulPts; }
    var score = totalW===0 ? -1 : Math.round((earned/totalW)*100);
    return { score, sessPts, timerPts, mindfulPts, sessW, timerW, mindfulW, sessMax:sessW, timerMax:timerW, mindfulMax:mindfulW };
  }

  function calculateSleep() {
    var now = Date.now();
    if (_sleepScoreCache && (now - _sleepScoreCacheTs) < _STRIP_CACHE_TTL) return _sleepScoreCache;
    var bedStreak = 0;
    if (IS_NATIVE) { try { bedStreak = (JSON.parse(N.getBedtimeStreak()||'{}') || {}).streak || 0; } catch(_){} }
    var cfg   = typeof FocusBedtime !== 'undefined' ? FocusBedtime.getCfg() : {};
    var nowH  = new Date().getHours() + new Date().getMinutes()/60;
    var wakeH = (cfg.wakeHour!=null?cfg.wakeHour:7)  + (cfg.wakeMinute||0)/60;
    var bedH  = (cfg.bedHour !=null?cfg.bedHour :22) + (cfg.bedMinute ||0)/60;
    var pastWake = bedH > wakeH ? (nowH >= wakeH && nowH < bedH) : (nowH >= wakeH || nowH < bedH);
    if (!pastWake) { var r0={score:-1,bedStreak}; _sleepScoreCache=r0; _sleepScoreCacheTs=now; return r0; }
    var lastNight = null;
    if (IS_NATIVE) { try { if (typeof N.getBedtimeLastNightStats==='function') lastNight=JSON.parse(N.getBedtimeLastNightStats()||'{}'); } catch(_){} }
    var result;
    if (!lastNight||!lastNight.hasData) {
      result = { score:-1, bedStreak };
    } else {
      var adherePts  = lastNight.bedtimeKept ? 50 : 0;
      var snoozePts  = lastNight.snoozeCount===0 ? 30 : lastNight.snoozeCount===1 ? 15 : 0;
      var attemptPts = Math.max(0, 20 - (lastNight.appAttemptsTotal||0)*5);
      result = { score:adherePts+snoozePts+attemptPts, adherePts, snoozePts, attemptPts, adhereW:50, snoozeW:30, attemptW:20, lastNight, bedStreak };
    }
    _sleepScoreCache=result; _sleepScoreCacheTs=now; return result;
  }

  function calculateAurelo() {
    var d         = typeof FocusTab !== 'undefined' ? FocusTab.loadStripData() : {};
    var focusRes  = calculateFocus(d);
    var sleepRes  = calculateSleep();
    var screenScore = typeof calculateScreenScore==='function' ? calculateScreenScore().score : -1;
    var sleepEnabled = sleepRes.score >= 0;
    var swScreen = sleepEnabled?40:55, swFocus=sleepEnabled?35:45, swSleep=sleepEnabled?25:0;
    var parts=[], weights=[];
    if (screenScore>=0)  { parts.push(screenScore*swScreen); weights.push(swScreen); }
    if (focusRes.score>=0){ parts.push(focusRes.score*swFocus);  weights.push(swFocus); }
    if (sleepEnabled)    { parts.push(sleepRes.score*swSleep);  weights.push(swSleep); }
    var totalW = weights.reduce(function(a,b){return a+b;},0);
    var score  = totalW===0 ? -1 : Math.round(parts.reduce(function(a,b){return a+b;},0)/totalW);
    return { score, screenScore, focusScore:focusRes.score, sleepScore:sleepRes.score, swScreen, swFocus, swSleep, sleepEnabled };
  }

  /* ── Score persistence ─────────────────────────────────────── */
  function saveScoreForToday(key, score) {
    if (score < 0) return;
    var today = new Date().toISOString().slice(0,10);
    var raw = {};
    try { var s=IS_NATIVE&&N.getStringPref?N.getStringPref(key):localStorage.getItem(key); raw=JSON.parse(s||'{}'); } catch(_){}
    if (raw[today]===score) return;
    raw[today]=score;
    var keys=Object.keys(raw).sort(); if(keys.length>8){var trim={};keys.slice(-8).forEach(function(k){trim[k]=raw[k];});raw=trim;}
    try { if(IS_NATIVE&&N.setStringPref)N.setStringPref(key,JSON.stringify(raw));else localStorage.setItem(key,JSON.stringify(raw)); } catch(_){}
  }

  function getYesterdayScore(key) {
    var yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    var yStr = yesterday.toISOString().slice(0,10);
    try { var s=IS_NATIVE&&N.getStringPref?N.getStringPref(key):localStorage.getItem(key); var raw=JSON.parse(s||'{}'); return raw[yStr]!==undefined?raw[yStr]:null; } catch(_){ return null; }
  }

  /* ── Focus streak ──────────────────────────────────────────── */
  function getFocusStreak() {
    try { var s=IS_NATIVE&&N.getStringPref?N.getStringPref(_FOCUS_STREAK_KEY):localStorage.getItem(_FOCUS_STREAK_KEY); return JSON.parse(s||'{"count":0,"lastDate":""}'); } catch(_){ return {count:0,lastDate:''}; }
  }

  function maybeEarnFocusStreak(d) {
    var earned = (d.completed>0)||(d.timerTotal>0&&d.timerOverCount===0)||(d.pauseCount>=3&&d.resistCount>0);
    if (!earned) return;
    var today=new Date().toISOString().slice(0,10), cur=getFocusStreak();
    if (cur.lastDate===today) return;
    var yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
    var yStr=yesterday.toISOString().slice(0,10);
    var newCount=(cur.lastDate===yStr)?cur.count+1:1;
    var earnedDates=Array.isArray(cur.earnedDates)?cur.earnedDates.slice():[];
    if (earnedDates.indexOf(today)===-1) earnedDates.push(today);
    var cutoff=new Date(); cutoff.setDate(cutoff.getDate()-6);
    earnedDates=earnedDates.filter(function(ed){return ed>=cutoff.toISOString().slice(0,10);});
    var updated={count:newCount,lastDate:today,earnedDates};
    try { if(IS_NATIVE&&N.setStringPref)N.setStringPref(_FOCUS_STREAK_KEY,JSON.stringify(updated));else localStorage.setItem(_FOCUS_STREAK_KEY,JSON.stringify(updated)); } catch(_){}
  }

  /* ── Static row builder ────────────────────────────────────── */
  function _buildStaticRowHtml(opts) {
    var todayIdx=new Date().getDay(), dayLetters=['S','M','T','W','T','F','S'], orderIdx=[1,2,3,4,5,6,0];
    var squares=orderIdx.map(function(i){
      var isToday=i===todayIdx, filled=opts.days7&&opts.days7[i];
      var bg,border,textCol;
      if(filled){bg='var(--p)';border='none';textCol='#fff';}
      else if(isToday){bg='rgba(108,99,255,.15)';border='1px solid rgba(108,99,255,.45)';textCol='var(--p2)';}
      else{bg='var(--s2)';border='1px solid var(--border2)';textCol='var(--t3)';}
      var inner=filled?'✓':(isToday?'–':'·');
      return '<div style="width:22px;height:22px;border-radius:6px;background:'+bg+';border:'+border+';display:flex;align-items:center;justify-content:center;flex-direction:column;flex-shrink:0">'+
        '<div style="font-family:var(--ff-m);font-size:7px;color:'+textCol+';opacity:.7;letter-spacing:.3px">'+dayLetters[i]+'</div>'+
        '<div style="font-family:var(--ff-m);font-size:9px;color:'+textCol+';line-height:1">'+inner+'</div>'+
      '</div>';
    }).join('');
    var scoreColor=opts.score>=70?'var(--g)':opts.score>=50?'var(--a)':opts.score>=0?'var(--r)':'var(--t3)';
    var scoreDisp=opts.score>=0?opts.score:'–';
    return '<div style="background:var(--s2);border:1px solid var(--border2);border-radius:14px;padding:11px 13px;overflow:hidden">'+
      '<div style="display:flex;align-items:center;gap:6px">'+squares+
      '<div style="flex:1"></div>'+
      '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">'+
        '<span style="font-size:14px">🔥</span>'+
        '<div><div style="font-family:var(--ff-m);font-size:14px;font-weight:700;color:var(--a);line-height:1">'+(opts.streak||0)+'</div>'+
        '<div style="font-family:var(--ff-m);font-size:8px;color:var(--t3);margin-top:1px">'+(opts.streakLabel||'days')+'</div></div></div>'+
      '<div onclick="'+opts.onScoreTap+'" style="cursor:pointer;text-align:right;flex-shrink:0;'+
        'padding:4px 8px;border-radius:8px;background:rgba(108,99,255,.1);border:1px solid rgba(108,99,255,.2);min-width:52px;max-width:60px;box-sizing:border-box">'+
        '<div style="font-family:var(--ff-m);font-size:9px;color:var(--p2);letter-spacing:.5px">SCORE</div>'+
        '<div style="font-family:var(--ff-d);font-size:18px;font-weight:700;color:'+scoreColor+';line-height:1">'+scoreDisp+'</div>'+
      '</div></div>'+
      (opts.streakEarnLine?'<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);margin-top:8px;line-height:1.4">'+opts.streakEarnLine+'</div>':'')+
    '</div>';
  }

  function renderFocusStaticRow() {
    var el=document.getElementById('focus-static-row'); if(!el) return;
    var d   = typeof FocusTab!=='undefined' ? FocusTab.loadStripData() : {};
    var res = calculateFocus(d);
    maybeEarnFocusStreak(d);
    saveScoreForToday(_FOCUS_SCORE_KEY, res.score);
    var streak = getFocusStreak();
    if (Array.isArray(streak.earnedDates)) {
      streak.earnedDates.forEach(function(dateStr){var dow=new Date(dateStr+'T00:00:00').getDay(); if(d.focusDays) d.focusDays[dow]=true;});
    }
    el.innerHTML = _buildStaticRowHtml({ days7:d.focusDays, streak:streak.count, streakLabel:'day streak', score:res.score, onScoreTap:'FocusScore.openFocusScoreSheet()', streakEarnLine:'Complete sessions, respect timers & resist pauses today' });
  }

  function renderHabitsStaticRow() {
    var el=document.getElementById('habits-static-row'); if(!el) return;
    var res=calculateSleep();
    if (res.score>=0) saveScoreForToday(_SLEEP_SCORE_KEY, res.score);
    var d = typeof FocusTab!=='undefined' ? FocusTab.loadStripData() : {};
    var habitsBedtimeDays = (d.bedtimeDays||[false,false,false,false,false,false,false]).slice();
    try {
      var cfg2=typeof FocusBedtime!=='undefined'?FocusBedtime.getCfg():{};
      var nowH2=new Date().getHours()+new Date().getMinutes()/60;
      var wakeH2=(cfg2.wakeHour!=null?cfg2.wakeHour:7)+(cfg2.wakeMinute||0)/60;
      var bedH2 =(cfg2.bedHour !=null?cfg2.bedHour :22)+(cfg2.bedMinute ||0)/60;
      var pastWake2=bedH2>wakeH2?(nowH2>=wakeH2&&nowH2<bedH2):(nowH2>=wakeH2||nowH2<bedH2);
      if (!pastWake2) habitsBedtimeDays[new Date().getDay()]=false;
    } catch(_){}
    el.innerHTML = _buildStaticRowHtml({ days7:habitsBedtimeDays, streak:res.bedStreak||0, streakLabel:'night streak', score:res.score, onScoreTap:'FocusScore.openHabitsScoreSheet()', streakEarnLine:'Respect bedtime, no snoozes & keep blocked apps closed' });
  }

  /* ── Format helpers ────────────────────────────────────────── */
  function _fmtStripTimer(secsLeft) {
    if (secsLeft < 3600) {
      var m = Math.floor(secsLeft / 60), s = secsLeft % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    var h = Math.floor(secsLeft / 3600), mm = Math.floor((secsLeft % 3600) / 60);
    return mm > 0 ? h + 'h ' + mm + 'm' : h + 'h';
  }

  function _fmt12h(h, m) {
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  /* ── Dynamic row event collectors ─────────────────────────── */
  function _collectFocusEvents() {
    var events=[], d=typeof FocusTab!=='undefined'?FocusTab.loadStripData():{};
    var now=new Date();
    var ss=typeof FocusTab!=='undefined'?FocusTab.getSessionState():{};
    if (ss.active) {
      var secsLeft=Math.max(0,ss.secs||0);
      var diff=typeof FOCUS_DIFF!=='undefined'?(FOCUS_DIFF[ss.difficulty]||FOCUS_DIFF.gentle):{color:'var(--p)',label:'🌿 Gentle'};
      var blockedApps=ss.blockedApps||[];
      var chips=blockedApps.slice(0,3).map(function(a){
        return '<span style="background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.25);'+
          'border-radius:6px;padding:2px 7px;font-family:var(--ff-m);font-size:9px;color:var(--p2)">'+
          a.name.split(' ')[0]+'</span>';
      }).join('');
      events.push({tier:1,id:'session',html:
        '<div style="background:var(--s2);border:1px solid '+diff.color+';border-radius:14px;padding:11px 13px">'+
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:'+(chips?'8':'0')+'px">'+
        '<div style="width:8px;height:8px;border-radius:50%;background:'+diff.color+';animation:fs-pulse 2s ease-in-out infinite;flex-shrink:0"></div>'+
        '<div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--t1)">Focus Mode Active</div>'+
        '<div style="font-family:var(--ff-m);font-size:9px;color:var(--t2);margin-top:1px">'+diff.label+'</div></div>'+
        '<div class="fs-live-timer" style="font-family:var(--ff-m);font-size:20px;font-weight:700;color:'+diff.color+';letter-spacing:-1px">'+_fmtStripTimer(secsLeft)+'</div>'+
        '</div>'+
        (chips?'<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">'+chips+'</div>':'')+
        '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">'+
        '<div class="fs-live-bar" style="height:100%;background:linear-gradient(90deg,var(--p),var(--c));border-radius:2px"></div></div>'+
        '<div style="text-align:right;margin-top:6px"><span onclick="stopFocusSession()" style="font-family:var(--ff-m);font-size:10px;color:var(--r);cursor:pointer;padding:3px 8px;border-radius:6px;background:rgba(240,78,122,.1);border:1px solid rgba(240,78,122,.2)">Stop session</span></div>'+
        '</div>'
      });
    }
    var limits=S.limits||{}, usageMap={};
    if (typeof DAILY_USE!=='undefined') DAILY_USE.forEach(function(u){usageMap[u.packageName]=u.totalMinutes||0;});
    Object.keys(limits).forEach(function(pkg){
      if ((usageMap[pkg]||0)>=limits[pkg]) {
        var name=(DAILY_USE&&DAILY_USE.find(function(u){return u.packageName===pkg;})||{}).name||pkg.split('.').pop();
        events.push({tier:1,id:'timer_over_'+pkg,html:'<div style="background:rgba(240,78,122,.07);border:1px solid rgba(240,78,122,.3);border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px"><div style="width:7px;height:7px;border-radius:50%;background:var(--r);flex-shrink:0"></div><div style="flex:1;font-size:12px;font-weight:600;color:var(--t1)">'+name+' limit reached today</div><div style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:var(--r)">+'+fmtM((usageMap[pkg]||0)-limits[pkg])+'</div></div>'});
      }
    });
    if (events.some(function(e){return e.tier===1;})) return events;
    Object.keys(limits).forEach(function(pkg){ var used=usageMap[pkg]||0,lim=limits[pkg],pct=lim>0?used/lim:0; if(pct>=0.8&&pct<1){var name=(DAILY_USE&&DAILY_USE.find(function(u){return u.packageName===pkg;})||{}).name||pkg.split('.').pop(); events.push({tier:2,id:'timer_warn_'+pkg,html:'<div style="background:rgba(247,166,35,.07);border:1px solid rgba(247,166,35,.25);border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px"><div style="width:7px;height:7px;border-radius:50%;background:var(--a);flex-shrink:0"></div><div style="flex:1;font-size:12px;font-weight:600;color:var(--t1)">'+name+'</div><div style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:var(--a)">'+fmtM(lim-used)+' left today</div></div>'}); }});

    // Tier 2: scheduled routine starting within 60 min
    if (!events.some(function(e){return e.tier===2;})) {
      var routines=typeof FocusRoutine!=='undefined'?FocusRoutine.getRoutines():[];
      var nowMins=now.getHours()*60+now.getMinutes();
      routines.forEach(function(r){
        if(!r.enabled) return;
        var sMins=(r.hour||0)*60+(r.minute||0), diff2=sMins-nowMins;
        if(diff2>0&&diff2<=60){
          events.push({tier:2,id:'routine_soon_'+r.id,html:
            '<div style="background:rgba(108,99,255,.07);border:1px solid rgba(108,99,255,.25);border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px;cursor:pointer" onclick="activateTab(\'focus\')">'+
            '<div style="width:7px;height:7px;border-radius:50%;background:var(--p);flex-shrink:0"></div>'+
            '<div style="flex:1;font-size:12px;font-weight:600;color:var(--t1)">Your '+_fmt12h(r.hour||0,r.minute||0)+' focus session starts soon</div>'+
            '<div style="font-family:var(--ff-m);font-size:10px;color:var(--p2)">Start early \u2192</div>'+
            '</div>'
          });
        }
      });
    }

    if (events.some(function(e){return e.tier===2;})) return events;

    // Tier 3: post-session summary (10 min window)
    var lt=typeof FocusTab!=='undefined'?FocusTab.getLastState():{};
    if (lt.state&&lt.ts&&(Date.now()-lt.ts)<600000) {
      var color3=lt.state==='completed'?'var(--g)':'var(--a)',icon3=lt.state==='completed'?'🔥':'⏸';
      var txt3=lt.state==='completed'?'Session complete! '+fmtM(lt.totalMins)+' focused':'Ended early \u00b7 '+fmtM(lt.elapsedMins)+' of '+fmtM(lt.totalMins);
      events.push({tier:3,id:'post_session',html:
        '<div style="background:rgba(18,212,138,.06);border:1px solid '+color3+'44;border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px">'+
        '<div style="font-size:18px">'+icon3+'</div>'+
        '<div style="flex:1;font-size:12px;font-weight:600;color:var(--t1)">'+txt3+'</div>'+
        '</div>'
      });
    }

    // Tier 3: weekly challenge almost done
    if (d.challengeLabel&&d.challengeDone!==undefined) {
      var remaining=(d.challengeTarget-d.challengeDone);
      if(remaining<=1&&remaining>0) {
        events.push({tier:3,id:'challenge_close',html:
          '<div style="background:rgba(247,201,72,.07);border:1px solid rgba(247,201,72,.25);border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px">'+
          '<div style="font-size:14px">🏆</div>'+
          '<div style="flex:1;font-family:var(--ff-m);font-size:11px;color:var(--t1)">'+d.challengeDone+'/'+d.challengeTarget+' \u2014 '+remaining+' more to complete this week\'s challenge</div>'+
          '</div>'
        });
      }
    }

    return events;
  }

  function _collectHabitsEvents() {
    var events=[], now=new Date(), nowH=now.getHours()+now.getMinutes()/60;
    var cfg=typeof FocusBedtime!=='undefined'?FocusBedtime.getCfg():{};
    var bedH=(cfg.bedHour||22)+(cfg.bedMinute||0)/60, wakeH=(cfg.wakeHour||7)+(cfg.wakeMinute||0)/60;
    var inWindow=bedH>wakeH?(nowH>=bedH||nowH<wakeH):(nowH>=bedH&&nowH<wakeH);

    // Tier 1: bedtime window active
    if (cfg.enabled&&inWindow) {
      var blockedCount=Array.isArray(cfg.blockedApps)?cfg.blockedApps.length:0;
      // Snooze state
      var snoozeEndsAt=0;
      try { if(IS_NATIVE&&typeof N.getBedtimeSnoozeEndsAt==='function') snoozeEndsAt=N.getBedtimeSnoozeEndsAt()||0; } catch(_){}
      var snoozeActive=snoozeEndsAt>Date.now(), snoozeMins=snoozeActive?Math.ceil((snoozeEndsAt-Date.now())/60000):0;
      var snoozeBtn=snoozeActive
        ? '<span style="font-family:var(--ff-m);font-size:10px;color:var(--t3);padding:3px 9px;border-radius:6px;background:var(--s3);pointer-events:none;opacity:.6">\u23f1 '+snoozeMins+'m left</span>'
        : '<span onclick="snoozeBedtimePrompt()" style="font-family:var(--ff-m);font-size:10px;color:var(--p2);cursor:pointer;padding:3px 9px;border-radius:6px;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.2)">Snooze</span>';
      var fmt12=function(dec){var h24=Math.floor(dec%24),mm=Math.round((dec%1)*60),h12=h24%12||12;return h12+':'+(mm<10?'0':'')+mm+' '+(h24<12?'AM':'PM');};
      events.push({tier:1,id:'bedtime_active',html:
        '<div style="background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.3);border-radius:14px;padding:11px 13px;display:flex;align-items:center;gap:10px">'+
        '<div style="font-size:16px">🌙</div>'+
        '<div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--t1)">Bedtime mode on</div>'+
        '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t2);margin-top:1px">'+blockedCount+' app'+(blockedCount!==1?'s':'')+' blocked \u00b7 ends at '+fmt12(wakeH)+'</div></div>'+
        snoozeBtn+'</div>'
      });
      return events;
    }

    // Tier 2: bedtime approaching within 60 min
    if (cfg.enabled&&!inWindow) {
      var minsU=(bedH-nowH)*60; if(minsU<0) minsU+=1440;
      if(minsU<=60&&minsU>0) {
        var fmt12b=function(dec){var h24=Math.floor(dec%24),mm=Math.round((dec%1)*60),h12=h24%12||12;return h12+':'+(mm<10?'0':'')+mm+' '+(h24<12?'AM':'PM');};
        events.push({tier:2,id:'wind_down',html:
          '<div style="background:rgba(168,156,255,.07);border:1px solid rgba(168,156,255,.25);border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px">'+
          '<div style="font-size:14px">🌙</div>'+
          '<div style="flex:1;font-size:12px;font-weight:600;color:var(--t1)">Bedtime in '+Math.round(minsU)+'m</div>'+
          '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">Apps block at '+fmt12b(bedH)+'</div>'+
          '</div>'
        });
      }
    }

    // Tier 2: weekly challenge at risk
    var d=typeof FocusTab!=='undefined'?FocusTab.loadStripData():{};
    if(!events.length&&d.challengeLabel&&d.challengeDone!==undefined) {
      var daysLeft=7-new Date().getDay(), needed=d.challengeTarget-d.challengeDone;
      if(needed>0&&needed>=daysLeft) {
        events.push({tier:2,id:'challenge_risk',html:
          '<div style="background:rgba(247,166,35,.07);border:1px solid rgba(247,166,35,.3);border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px">'+
          '<div style="font-size:14px">\u26a0\ufe0f</div>'+
          '<div style="flex:1;font-family:var(--ff-m);font-size:11px;color:var(--a)">'+daysLeft+' days left \u00b7 need '+needed+' more to complete this week\'s challenge</div>'+
          '</div>'
        });
      }
    }

    if (events.some(function(e){return e.tier===2;})) return events;

    // Tier 3: morning summary (6am–11am)
    var h=now.getHours();
    if (h>=6&&h<11) {
      var sr=calculateSleep();
      if (sr.lastNight&&sr.lastNight.hasData) {
        var ln=sr.lastNight, warmTxt=ln.bedtimeKept?'Bedtime kept \u2713':'Bedtime missed';
        if(ln.snoozeCount>0) warmTxt+=' \u00b7 '+ln.snoozeCount+' snooze'+(ln.snoozeCount>1?'s':'');
        if(ln.appAttemptsTotal===0) warmTxt+=' \u00b7 0 app attempts';
        events.push({tier:3,id:'morning_summary',html:
          '<div style="background:rgba(5,200,232,.06);border:1px solid rgba(5,200,232,.2);border-radius:14px;padding:11px 13px;display:flex;align-items:center;gap:10px">'+
          '<div style="font-size:16px">\u2600\ufe0f</div>'+
          '<div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--t1)">Last night</div>'+
          '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t2);margin-top:1px">'+warmTxt+'</div></div>'+
          (sr.bedStreak>0?'<div style="font-family:var(--ff-m);font-size:10px;font-weight:700;color:var(--pu);padding:3px 8px;background:rgba(80,100,255,.12);border-radius:99px">\uD83D\uDD25 streak</div>':'')+
          '</div>'
        });
      }
    }

    // Tier 3: challenge milestone
    if (d.challengeLabel&&d.challengeDone!==undefined&&d.challengeDone>0) {
      events.push({tier:3,id:'challenge_milestone',html:
        '<div style="background:rgba(18,212,138,.06);border:1px solid rgba(18,212,138,.2);border-radius:14px;padding:10px 13px;display:flex;align-items:center;gap:9px">'+
        '<div style="font-size:14px">🏆</div>'+
        '<div style="flex:1;font-family:var(--ff-m);font-size:11px;color:var(--t1)">'+d.challengeDone+' of '+d.challengeTarget+' \u00b7 on track to complete this week\'s challenge</div>'+
        '</div>'
      });
    }

    return events;
  }

  function _showQueuedEvents(elId) {
    var el=document.getElementById(elId);
    if(!el||!el._queuedEvents||!el._queuedEvents.length) return;
    var items=el._queuedEvents.map(function(e){return e.html;}).join('<div style="height:8px"></div>');
    if(typeof showConfirm==='function'){
      showConfirm('Other active events','\u00a0',function(){},'Close',null);
      var body=document.getElementById('cdlg-body');
      if(body) body.innerHTML=items;
    }
  }

  function _renderDynamicRow(elId, events) {
    var el=document.getElementById(elId); if(!el) return;
    if(!events.length){el.innerHTML='';el.style.display='none';return;}
    el.style.display='';
    var top=events[0], moreCount=events.length-1;
    var moreBadge=moreCount>0?'<div onclick="FocusScore.showQueuedEvents(\''+elId+'\')" style="position:absolute;top:6px;right:6px;font-family:var(--ff-m);font-size:9px;color:var(--t2);background:var(--s1);border:1px solid var(--border2);border-radius:6px;padding:2px 6px;cursor:pointer">+'+moreCount+' more</div>':'';
    el.innerHTML='<div style="position:relative">'+top.html+moreBadge+'</div>';
    el._queuedEvents=events.slice(1);
  }

  function renderFocusDynamicRow() { _renderDynamicRow('focus-dynamic-row',_collectFocusEvents()); }
  function renderHabitsDynamicRow() { _renderDynamicRow('habits-dynamic-row',_collectHabitsEvents()); }

  /* ── Score sheets ──────────────────────────────────────────── */
  function _buildScoreSheet(opts) {
    var yScore=getYesterdayScore(opts.scoreKey), deltaHtml='';
    if (yScore!==null&&opts.score>=0) { var diff=opts.score-yScore,dCol=diff>=0?'var(--g)':'var(--r)',dSign=diff>=0?'↑':'↓'; deltaHtml='<span style="font-family:var(--ff-m);font-size:12px;font-weight:700;color:'+dCol+';margin-left:8px">'+dSign+Math.abs(diff)+' from yesterday</span>'; }
    var gradeColor=opts.score>=70?'var(--g)':opts.score>=50?'var(--a)':'var(--r)';
    var componentsHtml=opts.components.map(function(c){
      var bf=c.maxPts>0?Math.round((c.pts/c.maxPts)*100):0, cColor=bf>=70?'var(--g)':bf>=40?'var(--a)':'var(--r)';
      return '<div style="margin-bottom:16px"><div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3px"><div style="font-size:13px;font-weight:700;color:var(--t1)">'+c.label+'</div><div style="font-family:var(--ff-m);font-size:10px;color:var(--t3)">weighted '+c.weight+'%</div></div><div style="font-family:var(--ff-m);font-size:11px;color:var(--t2);margin-bottom:6px">'+c.dataLine+'</div><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+bf+'%;background:'+cColor+';border-radius:3px;transition:width .4s"></div></div><div style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:'+cColor+';flex-shrink:0">+'+c.pts+' pts</div></div></div>';
    }).join('');
    var improvHtml=opts.improvements.length?'<div style="height:1px;background:var(--border);margin:4px 0 16px"></div><div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:12px">HOW TO IMPROVE</div>'+opts.improvements.map(function(im){return'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px"><div style="font-family:var(--ff-m);font-size:12px;color:var(--t2);flex:1;line-height:1.5">'+im.text+'</div><div style="font-family:var(--ff-m);font-size:11px;font-weight:700;color:var(--g);flex-shrink:0;white-space:nowrap">+'+im.impact+' pts</div></div>';}).join(''):'';
    return '<div id="score-sheet-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:9998;display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .25s;pointer-events:none" onclick="if(event.target===this)FocusScore.closeScoreSheet()">'+
      '<div id="score-sheet" style="width:100%;max-width:480px;background:#16181f;border-radius:24px 24px 0 0;border:1px solid #353849;border-bottom:none;padding:12px 20px 44px;padding-bottom:max(44px,calc(env(safe-area-inset-bottom,0px) + 24px));box-sizing:border-box;transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);max-height:88vh;overflow-y:auto">'+
      '<div style="width:40px;height:4px;background:#353849;border-radius:2px;margin:0 auto 18px"></div>'+
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px"><div>'+
        '<div style="font-family:var(--ff-d);font-size:20px;font-weight:800;color:var(--t1);letter-spacing:-.3px">'+opts.title+'</div>'+
        '<div style="display:flex;align-items:center;margin-top:4px"><span style="font-family:var(--ff-d);font-size:32px;font-weight:800;color:'+gradeColor+';line-height:1">'+(opts.score>=0?opts.score:'–')+'</span>'+deltaHtml+'</div>'+
      '</div></div>'+
      '<div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:20px"><div style="height:100%;width:'+Math.max(0,opts.score)+'%;background:linear-gradient(90deg,var(--p),var(--c));border-radius:3px;transition:width .4s"></div></div>'+
      '<div style="font-family:var(--ff-m);font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:14px">HOW THIS IS CALCULATED</div>'+componentsHtml+improvHtml+
      '<div style="display:flex;gap:8px;margin-top:4px">'+
        '<button onclick="shareCard(\''+(opts.scoreKey===_SLEEP_SCORE_KEY?'sleep_score':'focus_score')+'\');" style="flex:1;padding:14px;border-radius:14px;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.30);color:var(--p2);font-family:var(--ff-m);font-size:13px;font-weight:600;cursor:pointer">📤 Share</button>'+
        '<button onclick="FocusScore.closeScoreSheet()" style="flex:1;padding:14px;border-radius:14px;background:var(--s2);border:1px solid var(--border2);color:var(--t2);font-family:var(--ff-m);font-size:13px;font-weight:600;cursor:pointer">Close</button>'+
      '</div></div></div>';
  }

  function closeScoreSheet() {
    var backdrop=document.getElementById('score-sheet-backdrop'), sheet=document.getElementById('score-sheet');
    if(!backdrop) return;
    backdrop.style.opacity='0'; if(sheet) sheet.style.transform='translateY(100%)';
    setTimeout(function(){ backdrop&&backdrop.remove(); }, 320);
  }

  function _openScoreSheet(html) {
    document.getElementById('score-sheet-backdrop')&&document.getElementById('score-sheet-backdrop').remove();
    document.body.insertAdjacentHTML('beforeend', html);
    requestAnimationFrame(function(){
      var backdrop=document.getElementById('score-sheet-backdrop'), sheet=document.getElementById('score-sheet');
      if(backdrop){backdrop.style.opacity='1';backdrop.style.pointerEvents='all';} if(sheet) sheet.style.transform='translateY(0)';
    });
  }

  function openFocusScoreSheet() {
    var d=typeof FocusTab!=='undefined'?FocusTab.loadStripData():{}, res=calculateFocus(d);
    if(res.score<0){toast('No focus data yet — start a session to build your score','info');return;}
    var improvements=[];
    if(res.sessW>0&&res.sessPts<res.sessW) improvements.push({text:'Complete your next focus session without interruption',impact:Math.round((res.sessW-res.sessPts)*.5)});
    if(res.timerW>0&&res.timerPts<res.timerW) improvements.push({text:'Respect all active app timers for the rest of today',impact:Math.round((res.timerW-res.timerPts)*.6)});
    if(res.mindfulW>0&&res.mindfulPts<res.mindfulW) improvements.push({text:'Resist the next mindful pause instead of proceeding',impact:Math.round((res.mindfulW-res.mindfulPts)*.5)});
    var components=[];
    if(res.sessW>0) components.push({label:'Sessions',weight:res.sessW,pts:res.sessPts,maxPts:res.sessMax,dataLine:d.completed+' of '+d.total+' sessions completed today ('+d.rate+'%)'});
    if(res.timerW>0) components.push({label:'App Timers',weight:res.timerW,pts:res.timerPts,maxPts:res.timerMax,dataLine:(d.timerTotal-d.timerOverCount)+' of '+d.timerTotal+' timers respected today'});
    if(res.mindfulW>0) components.push({label:'Mindful Pause',weight:res.mindfulW,pts:res.mindfulPts,maxPts:res.mindfulMax,dataLine:d.resistCount+' of '+d.pauseCount+' pauses resisted today'});
    _openScoreSheet(_buildScoreSheet({title:'Focus Score',score:res.score,scoreKey:_FOCUS_SCORE_KEY,components,improvements:improvements.slice(0,3)}));
  }

  function openHabitsScoreSheet() {
    var res=calculateSleep();
    if(res.score<0){toast('Enable Bedtime Mode to start tracking your sleep score','info');return;}
    var ln=res.lastNight, improvements=[];
    if(res.adherePts===0) improvements.push({text:'Respect your bedtime window tonight — no manual disable',impact:50});
    if(res.snoozePts<30) improvements.push({text:'Avoid snoozing bedtime — each snooze costs 15 pts',impact:30-res.snoozePts});
    if(res.attemptPts<20) improvements.push({text:'Keep your blocked apps closed during the bedtime window',impact:20-res.attemptPts});
    var components=[
      {label:'Bedtime Adherence',weight:50,pts:res.adherePts,maxPts:50,dataLine:ln&&ln.hasData?(ln.bedtimeKept?'Bedtime window respected last night':'Bedtime window was not respected'):'No data yet'},
      {label:'Snooze Count',weight:30,pts:res.snoozePts,maxPts:30,dataLine:ln&&ln.hasData?(ln.snoozeCount+' snooze'+(ln.snoozeCount!==1?'s':'')+' last night'):'No data'},
      {label:'App Attempts Blocked',weight:20,pts:res.attemptPts,maxPts:20,dataLine:ln&&ln.hasData?((ln.appAttemptsTotal||0)+' blocked app attempt'+((ln.appAttemptsTotal||0)!==1?'s':'')+' last night'):'No data'},
    ];
    _openScoreSheet(_buildScoreSheet({title:'Sleep Score',score:res.score,scoreKey:_SLEEP_SCORE_KEY,components,improvements:improvements.slice(0,3)}));
  }

  /* ── Public API ────────────────────────────────────────────── */
  var api = {
    calculateFocus, calculateSleep, calculateAurelo,
    saveScoreForToday, getYesterdayScore,
    getFocusStreak, maybeEarnFocusStreak,
    renderFocusStaticRow, renderHabitsStaticRow,
    renderFocusDynamicRow, renderHabitsDynamicRow,
    openFocusScoreSheet, openHabitsScoreSheet,
    closeScoreSheet,
    // BUG-06: expose sheet helpers so app-wellness.js can call them for Screen Score
    buildScoreSheet: _buildScoreSheet,
    openScoreSheet:  _openScoreSheet,
    // showQueuedEvents: rendered into score-sheet HTML as FocusScore.showQueuedEvents(elId)
    showQueuedEvents: _showQueuedEvents,
    invalidateSleepCache: function () { _sleepScoreCache=null; _sleepScoreCacheTs=0; },
    FOCUS_SCORE_KEY: _FOCUS_SCORE_KEY,
    SLEEP_SCORE_KEY: _SLEEP_SCORE_KEY,
  };

  // Expose on window for onclick= handlers and FocusTab backward-compat
  window.openFocusScoreSheet  = function () { api.openFocusScoreSheet(); };
  window.openHabitsScoreSheet = function () { api.openHabitsScoreSheet(); };
  window._closeScoreSheet     = function () { api.closeScoreSheet(); };

  return api;
})();