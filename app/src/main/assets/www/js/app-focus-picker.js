'use strict';
/* ═══════════════════════════════════════════════════════════════
 * APP PICKER MODULE — app-focus-picker.js
 * Phase 2 extract from app-focus.js
 *
 * Owns: Focus schedule templates, shared app-picker panel (block /
 *       intention / bedtime / routine modes), blocked-app chip
 *       management.
 *
 * Depends on globals: FocusTab, FocusRoutine, FocusMindful,
 *   FocusBedtime, ProTier, S, IS_NATIVE, N, CATS_MAP, CAT_ICONS,
 *   DAILY_USE, toast, escAttr, escHtml, fmtM, appIco, proBadge,
 *   openPanel, closePanel, buildCatsMap
 *
 * Public API (via FocusPicker.*):
 *   openPicker(mode)           — open panel ('block'|'intention'|
 *                                 'bedtime'|'routine')
 *   savePick()                 — commit selection
 *   togglePick(pkg,name,row)   — flip one app
 *   toggleCategory(catName)    — select/deselect whole category
 *   toggleCatExpand(catName)   — collapse/expand category
 *   filterSearch(query)        — search within picker
 *   activateTemplate(tplId)    — open routine editor from template
 *   buildPickerHTML()          — returns HTML string (for FocusTab delegation)
 *   buildPickerUsageMap()      — populate usage data before building HTML
 * ═══════════════════════════════════════════════════════════════ */
window.FocusPicker = (function () {

  /* ── Picker state ────────────────────────────────────────────── */
  var _pickerUsageMap = {};
  var _pickerMaxMins  = 1;

  /* ═══════════════════════════════════════════════════════════════
   * SCHEDULE TEMPLATES
   * ═══════════════════════════════════════════════════════════════ */
  var FOCUS_SCHEDULE_TEMPLATES = [
    { id:'tpl_morning',  emoji:'🌅', name:'Morning Focus', days:[1,2,3,4,5], startHour:8,  startMin:0, durationMins:60,  difficulty:'firm',  categoryNames:['Social','Entertainment','Social & Communication','Entertainment & Video'] },
    { id:'tpl_deepwork', emoji:'💼', name:'Deep Work',     days:[1,2,3,4,5], startHour:14, startMin:0, durationMins:90,  difficulty:'deep',  categoryNames:['Social','Gaming','Entertainment','Social & Communication','Entertainment & Video'] },
    { id:'tpl_winddown', emoji:'🌙', name:'Wind Down',     days:[0,1,2,3,4,5,6], startHour:21, startMin:0, durationMins:60, difficulty:'firm', categoryNames:['Social','Gaming','Social & Communication'] },
    { id:'tpl_study',    emoji:'🎓', name:'Study Block',   days:[1,2,3,4,5], startHour:16, startMin:0, durationMins:45,  difficulty:'deep',  categoryNames:['Social','Gaming','Entertainment','Social & Communication','Entertainment & Video'] },
  ];

  function _resolveTemplateApps(tpl) {
    var apps = [], seen = new Set();
    tpl.categoryNames.forEach(function (catName) {
      (CATS_MAP[catName] || []).forEach(function (a) {
        if (!seen.has(a.packageName)) {
          seen.add(a.packageName);
          apps.push({ packageName: a.packageName, name: a.name });
        }
      });
    });
    return apps;
  }

  function activateTemplate(tplId) {
    var tpl = FOCUS_SCHEDULE_TEMPLATES.find(function (t) { return t.id === tplId; });
    if (!tpl) return;
    if (!ProTier.isPro) { ProTier.triggerUpsell('FOCUS_SCHEDULE'); return; }
    var resolvedApps = _resolveTemplateApps(tpl);
    var prefill = {
      name: tpl.name, emoji: tpl.emoji, difficulty: tpl.difficulty,
      days: tpl.days, startHour: tpl.startHour, startMin: tpl.startMin,
      durationMins: tpl.durationMins, blockedApps: resolvedApps, templateId: tpl.id,
    };
    if (typeof FocusRoutine !== 'undefined') FocusRoutine.openRoutinePicker(null, prefill);
    else if (typeof openRoutinePicker === 'function') openRoutinePicker(null, prefill);
  }

  /* ═══════════════════════════════════════════════════════════════
   * PICKER HTML BUILDERS
   * ═══════════════════════════════════════════════════════════════ */

  function buildPickerUsageMap() {
    _pickerUsageMap = {};
    _pickerMaxMins  = 1;
    if (typeof DAILY_USE !== 'undefined') {
      DAILY_USE.forEach(function (u) {
        _pickerUsageMap[u.packageName] = u.totalMinutes || 0;
        if (u.totalMinutes > _pickerMaxMins) _pickerMaxMins = u.totalMinutes;
      });
    }
  }

  function _catPickState(catApps) {
    if (!catApps.length) return 'none';
    var sel = catApps.filter(function (a) {
      return FocusTab.getPickerSelected().has(a.packageName);
    }).length;
    if (sel === catApps.length) return 'all';
    return sel > 0 ? 'partial' : 'none';
  }

  function _pickerAppRow(a, idPrefix) {
    var mins   = _pickerUsageMap[a.packageName] || 0;
    var pct    = Math.round((mins / _pickerMaxMins) * 100);
    var isOn   = FocusTab.getPickerSelected().has(a.packageName);
    var safeId = (idPrefix + a.packageName).replace(/[^a-zA-Z0-9_]/g, '_');
    return '<div class="app-sel-row" data-name="' + escAttr(a.name) + '"' +
      ' onclick="FocusPicker.togglePick(\'' + escAttr(a.packageName) + '\',\'' + escAttr(a.name) + '\',this)">' +
      '<div class="app-sel-ico">' + appIco(a.packageName, 40, 11) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="app-sel-name">' + escHtml(a.name) + '</div>' +
        (mins ? '<div class="picker-usage-bar"><div class="picker-usage-fill" style="width:' + pct + '%"></div></div>' +
                '<div class="app-sel-sub">' + fmtM(mins) + ' today</div>' : '') +
      '</div>' +
      '<div class="app-sel-check' + (isOn ? ' on' : '') + '" id="' + safeId + '"></div>' +
      '</div>';
  }

  function buildPickerHTML() {
    var allCatKeys = Object.keys(CATS_MAP);
    var stored     = (S.catOrder || []).filter(function (c) { return allCatKeys.includes(c); });
    var cats       = stored.concat(allCatKeys.filter(function (c) { return !stored.includes(c); }));
    var html       = '';
    cats.forEach(function (catName) {
      var catApps = CATS_MAP[catName] || [];
      if (!catApps.length) return;
      var state  = _catPickState(catApps);
      var chkCls = state === 'all' ? ' on' : state === 'partial' ? ' partial' : '';
      var icon   = (typeof CAT_ICONS !== 'undefined' && CAT_ICONS[catName]) || '📱';
      var catMins= catApps.reduce(function (s, a) { return s + (_pickerUsageMap[a.packageName] || 0); }, 0);
      var catId  = 'catpick_' + catName.replace(/[^a-zA-Z0-9]/g, '_');
      html +=
        '<div class="cat-pick-group" data-cat="' + escAttr(catName) + '">' +
          '<div class="cat-pick-hdr" onclick="FocusPicker.toggleCatExpand(\'' + escAttr(catName) + '\')">' +
            '<div class="app-sel-check' + chkCls + '" id="catcheck_' + catId + '"' +
            ' onclick="event.stopPropagation();FocusPicker.toggleCategory(\'' + escAttr(catName) + '\')"></div>' +
            '<div style="font-size:18px;flex-shrink:0">' + icon + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div class="app-sel-name">' + escHtml(catName) + '</div>' +
              '<div class="app-sel-sub">' + catApps.length + ' app' + (catApps.length !== 1 ? 's' : '') +
              (catMins ? ' \u00b7 ' + fmtM(catMins) + ' today' : '') + '</div>' +
            '</div>' +
            '<div class="cat-pick-arrow" id="catarrow_' + catId + '">\u25b6</div>' +
          '</div>' +
          '<div class="cat-pick-apps" id="catapps_' + catId + '" style="display:none">' +
            catApps.map(function (a) { return _pickerAppRow(a, 'fpick_'); }).join('') +
          '</div>' +
        '</div>';
    });
    return html;
  }

  /* ═══════════════════════════════════════════════════════════════
   * PICKER OPEN / INTERACTIONS
   * ═══════════════════════════════════════════════════════════════ */

  function openPicker(mode) {
    mode = mode || 'block';
    if (typeof FocusTab !== 'undefined') FocusTab.setPickerMode(mode);

    var title, currentPkgs;
    if (mode === 'intention') {
      title       = 'Intention Prompt Apps';
      currentPkgs = new Set((typeof FocusMindful !== 'undefined' ? FocusMindful.getApps() : []).map(function (a) { return a.packageName; }));
    } else if (mode === 'bedtime') {
      title = 'Block During Bedtime';
      // Prefer the live in-memory list (_btBlockedApps) over the persisted cfg so that
      // unsaved picker selections survive reopening the picker before hitting Save.
      // Fall back to cfg.blockedApps only on first open when _btBlockedApps is empty.
      var _btLive = (window._btBlockedApps && window._btBlockedApps.length)
        ? window._btBlockedApps
        : (typeof FocusBedtime !== 'undefined' ? (FocusBedtime.getCfg().blockedApps || []) : []);
      currentPkgs = new Set(_btLive.map(function (a) { return a.packageName; }));
    } else {
      title       = 'Block During Session';
      currentPkgs = new Set(typeof FocusTab !== 'undefined' ? FocusTab.getBlockedApps().map(function (a) { return a.packageName; }) : []);
    }

    FocusTab.setPickerSelected(currentPkgs);

    // Ensure CATS_MAP is populated
    if (typeof CATS_MAP !== 'undefined' && !Object.keys(CATS_MAP).length && IS_NATIVE) {
      try { buildCatsMap(JSON.parse(N.getCachedApps() || '[]')); } catch (_) {}
    }

    buildPickerUsageMap();

    var titleEl  = document.getElementById('focus-picker-title');
    var listEl   = document.getElementById('focus-picker-list');
    var searchEl = document.getElementById('focus-picker-search');
    if (titleEl)  titleEl.textContent = title;
    if (listEl)   listEl.innerHTML    = buildPickerHTML();
    if (searchEl) { searchEl.value = ''; searchEl.oninput = function () { filterSearch(searchEl.value); }; }
    if (typeof openPanel === 'function') openPanel('focus-picker-panel');
  }

  function toggleCatExpand(catName) {
    var catId  = 'catpick_' + catName.replace(/[^a-zA-Z0-9]/g, '_');
    var appsEl = document.getElementById('catapps_' + catId);
    var arrowEl= document.getElementById('catarrow_' + catId);
    if (!appsEl) return;
    var isOpen = appsEl.style.display !== 'none';
    appsEl.style.display = isOpen ? 'none' : 'block';
    if (arrowEl) arrowEl.classList.toggle('open', !isOpen);
  }

  function toggleCategory(catName) {
    var catApps  = CATS_MAP[catName] || [];
    var state    = _catPickState(catApps);
    var selectAll= state !== 'all';
    var sel      = FocusTab.getPickerSelected();
    catApps.forEach(function (a) {
      if (selectAll) sel.add(a.packageName);
      else           sel.delete(a.packageName);
      var safeId = ('fpick_' + a.packageName).replace(/[^a-zA-Z0-9_]/g, '_');
      var chk    = document.getElementById(safeId);
      if (chk) chk.classList.toggle('on', selectAll);
    });
    var catId  = 'catpick_' + catName.replace(/[^a-zA-Z0-9]/g, '_');
    var catChk = document.getElementById('catcheck_' + catId);
    if (catChk) { catChk.classList.toggle('on', selectAll); catChk.classList.remove('partial'); }
  }

  function togglePick(pkg, name, row) {
    var sel = FocusTab.getPickerSelected();
    if (sel.has(pkg)) sel.delete(pkg); else sel.add(pkg);
    var safeId = ('fpick_' + pkg).replace(/[^a-zA-Z0-9_]/g, '_');
    var chk    = document.getElementById(safeId);
    if (chk) chk.classList.toggle('on', sel.has(pkg));
    var catName = Object.keys(CATS_MAP).find(function (k) {
      return CATS_MAP[k].some(function (a) { return a.packageName === pkg; });
    });
    if (catName) {
      var catId  = 'catpick_' + catName.replace(/[^a-zA-Z0-9]/g, '_');
      var catChk = document.getElementById('catcheck_' + catId);
      if (catChk) {
        var st = _catPickState(CATS_MAP[catName]);
        catChk.classList.toggle('on',      st === 'all');
        catChk.classList.toggle('partial', st === 'partial');
      }
    }
  }

  function filterSearch(query) {
    var q      = (query || '').toLowerCase().trim();
    var groups = document.querySelectorAll('#focus-picker-list .cat-pick-group');
    groups.forEach(function (group) {
      var catName  = (group.getAttribute('data-cat') || '').toLowerCase();
      var catMatch = catName.includes(q);
      var appRows  = group.querySelectorAll('.app-sel-row');
      var anyApp   = false;
      appRows.forEach(function (row) {
        var nm  = (row.getAttribute('data-name') || '').toLowerCase();
        var show= !q || catMatch || nm.includes(q);
        row.style.display = show ? '' : 'none';
        if (show) anyApp = true;
      });
      if (q && (catMatch || anyApp)) {
        var catId  = 'catpick_' + group.getAttribute('data-cat').replace(/[^a-zA-Z0-9]/g, '_');
        var appsEl = document.getElementById('catapps_' + catId);
        var arrow  = document.getElementById('catarrow_' + catId);
        if (appsEl) appsEl.style.display = 'block';
        if (arrow)  arrow.classList.add('open');
      }
      group.style.display = (!q || catMatch || anyApp) ? '' : 'none';
    });
  }

  /* ═══════════════════════════════════════════════════════════════
   * SAVE PICK
   * ═══════════════════════════════════════════════════════════════ */

  function savePick() {
    var mode = typeof FocusTab !== 'undefined' ? FocusTab.getPickerMode() : 'block';

    // Routine mode — delegate to FocusRoutine
    if (FocusTab.getPickerReturnTarget() === 'routine') {
      if (typeof FocusRoutine !== 'undefined') FocusRoutine.handlePickerSave();
      return;
    }

    // Build apps array
    var all = IS_NATIVE
      ? (function () { try { return JSON.parse(N.getAllApps() || '[]'); } catch (_) { return []; } })()
      : Object.values(CATS_MAP).flat();
    var appMap = {};
    all.forEach(function (a) { appMap[a.packageName] = a; });
    var apps = Array.from(FocusTab.getPickerSelected()).map(function (pkg) {
      return { packageName: pkg, name: (appMap[pkg] && appMap[pkg].name) || pkg.split('.').pop() };
    });

    // Bedtime mode
    if (mode === 'bedtime') {
      FocusTab.setPickerMode('block');
      if (typeof window._btOnBlockPickerSave === 'function') window._btOnBlockPickerSave(apps);
      if (typeof closePanel === 'function') closePanel('focus-picker-panel');
      toast('Apps updated', 'success');
      return;
    }

    // Intention mode
    if (mode === 'intention') {
      if (!ProTier.isPro && apps.length > ProTier.getLimit('MINDFUL_OPENING_UNLIMITED')) {
        if (typeof closePanel === 'function') closePanel('focus-picker-panel');
        ProTier.triggerUpsell('MINDFUL_OPENING_UNLIMITED');
        return;
      }
      if (IS_NATIVE) { try { N.saveIntentionPromptApps(JSON.stringify(apps)); } catch (_) {} }
      if (typeof closePanel === 'function') closePanel('focus-picker-panel');
      if (typeof FocusMindful !== 'undefined') FocusMindful.render();
      toast('Apps updated', 'success');
      return;
    }

    // Block mode (default)
    if (!ProTier.isPro && apps.length > ProTier.getLimit('FOCUS_APPS_UNLIMITED')) {
      if (typeof closePanel === 'function') closePanel('focus-picker-panel');
      ProTier.triggerUpsell('FOCUS_APPS_UNLIMITED');
      return;
    }
    FocusTab.setBlockedApps(apps);
    FocusTab.saveBlockedApps();
    FocusTab.refreshChips();
    if (typeof closePanel === 'function') closePanel('focus-picker-panel');

    // Update native session if running
    var ss = FocusTab.getSessionState();
    if (ss.active && IS_NATIVE) {
      try {
        var newEndTs = Date.now() + (ss.secs * 1000);
        N.updateFocusSession(JSON.stringify(apps), newEndTs, ss.difficulty);
      } catch (_) {}
    }
    toast('Apps updated', 'success');
  }

  /* ── Global shims ─────────────────────────────────────────────── */
  function openFocusAppPicker(mode) { FocusPicker.openPicker(mode); }
  function saveFocusPick()          { FocusPicker.savePick(); }
  function toggleFocusPick(pkg, name, row) { FocusPicker.togglePick(pkg, name, row); }
  function toggleFocusPickCategory(cat)    { FocusPicker.toggleCategory(cat); }
  function togglePickCatExpand(cat)        { FocusPicker.toggleCatExpand(cat); }
  function filterPickerSearch(q)           { FocusPicker.filterSearch(q); }
  function activateTemplate(id)            { FocusPicker.activateTemplate(id); }
  window.openFocusAppPicker     = openFocusAppPicker;
  window.saveFocusPick          = saveFocusPick;
  window.toggleFocusPick        = toggleFocusPick;
  window.toggleFocusPickCategory= toggleFocusPickCategory;
  window.togglePickCatExpand    = togglePickCatExpand;
  window.filterPickerSearch     = filterPickerSearch;
  window.activateTemplate       = activateTemplate;

  /* ── Public API ──────────────────────────────────────────────── */
  return {
    openPicker:          openPicker,
    savePick:            savePick,
    togglePick:          togglePick,
    toggleCategory:      toggleCategory,
    toggleCatExpand:     toggleCatExpand,
    filterSearch:        filterSearch,
    activateTemplate:    activateTemplate,
    buildPickerHTML:     buildPickerHTML,
    buildPickerUsageMap: buildPickerUsageMap,
    TEMPLATES:           FOCUS_SCHEDULE_TEMPLATES,
  };
})();