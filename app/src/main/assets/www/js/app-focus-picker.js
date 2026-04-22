'use strict';
/* ═══════════════════════════════════════════════════════════════
 * APP PICKER MODULE — app-focus-picker.js
 *
 * CHANGES:
 *  • Filter pills: "All" / "Selected (N)" — one tap to see only
 *    apps you've already added, categories auto-expanded.
 *  • Selected-count badge on Save button updates live.
 *  • openPicker() accepts optional openInSelectedView param so
 *    tappable +X overflow chips land directly in selected view.
 * ═══════════════════════════════════════════════════════════════ */
window.FocusPicker = (function () {

  /* ── State ────────────────────────────────────────────────── */
  var _pickerUsageMap = {};
  var _pickerMaxMins  = 1;
  var _pickerFilter   = 'all'; // 'all' | 'selected'
  var _pickerPrevPkgs = new Set(); // snapshot of selected pkgs when picker opened

  /* ── Smart save toast ─────────────────────────────────────────
   * Shows a specific message based on what actually changed:
   *   single add   → "YouTube added to Mindful Pause"
   *   multi add    → "3 apps added to Mindful Pause"
   *   single remove→ "1 app removed"
   *   multi remove → "3 apps removed"
   *   mixed        → "Apps updated"
   *   no change    → "Apps updated"
   * ─────────────────────────────────────────────────────────── */
  function _buildSaveToast(label, newApps, prevPkgs) {
    var newPkgSet  = new Set(newApps.map(function (a) { return a.packageName; }));
    var added      = newApps.filter(function (a) { return !prevPkgs.has(a.packageName); });
    var removedCt  = Array.from(prevPkgs).filter(function (p) { return !newPkgSet.has(p); }).length;
    if (added.length > 0 && removedCt === 0) {
      var msg = added.length === 1
        ? added[0].name + ' added to ' + label
        : added.length + ' apps added to ' + label;
      toast(msg, 'success');
    } else if (removedCt > 0 && added.length === 0) {
      toast(removedCt === 1 ? '1 app removed from ' + label : removedCt + ' apps removed from ' + label, 'info');
    } else if (added.length > 0 && removedCt > 0) {
      toast('Apps updated', 'success'); // mixed
    }
    // no change → silent
  }

  /* ═══════════════════════════════════════════════════════════
   * SCHEDULE TEMPLATES
   * ═══════════════════════════════════════════════════════════ */
  var FOCUS_SCHEDULE_TEMPLATES = [
    { id:'tpl_morning',  emoji:'🌅', name:'Morning Focus', days:[1,2,3,4,5], startHour:8,  startMin:0, durationMins:60,  difficulty:'firm', categoryNames:['Social','Entertainment','Social & Communication','Entertainment & Video'] },
    { id:'tpl_deepwork', emoji:'💼', name:'Deep Work',     days:[1,2,3,4,5], startHour:14, startMin:0, durationMins:90,  difficulty:'deep', categoryNames:['Social','Gaming','Entertainment','Social & Communication','Entertainment & Video'] },
    { id:'tpl_winddown', emoji:'🌙', name:'Wind Down',     days:[0,1,2,3,4,5,6], startHour:21, startMin:0, durationMins:60, difficulty:'firm', categoryNames:['Social','Gaming','Social & Communication'] },
    { id:'tpl_study',    emoji:'🎓', name:'Study Block',   days:[1,2,3,4,5], startHour:16, startMin:0, durationMins:45,  difficulty:'deep', categoryNames:['Social','Gaming','Entertainment','Social & Communication','Entertainment & Video'] },
  ];

  function _resolveTemplateApps(tpl) {
    var apps = [], seen = new Set();
    tpl.categoryNames.forEach(function (catName) {
      (CATS_MAP[catName] || []).forEach(function (a) {
        if (!seen.has(a.packageName)) { seen.add(a.packageName); apps.push({ packageName: a.packageName, name: a.name }); }
      });
    });
    return apps;
  }

  function activateTemplate(tplId) {
    var tpl = FOCUS_SCHEDULE_TEMPLATES.find(function (t) { return t.id === tplId; });
    if (!tpl) return;
    if (!ProTier.isPro) { ProTier.triggerUpsell('FOCUS_SCHEDULE'); return; }
    var resolvedApps = _resolveTemplateApps(tpl);
    var prefill = { name: tpl.name, emoji: tpl.emoji, difficulty: tpl.difficulty, days: tpl.days, startHour: tpl.startHour, startMin: tpl.startMin, durationMins: tpl.durationMins, blockedApps: resolvedApps, templateId: tpl.id };
    if (typeof FocusRoutine !== 'undefined') FocusRoutine.openRoutinePicker(null, prefill);
    else if (typeof openRoutinePicker === 'function') openRoutinePicker(null, prefill);
  }

  /* ═══════════════════════════════════════════════════════════
   * FILTER PILLS
   * ═══════════════════════════════════════════════════════════ */

  /* Update the "All / Selected (N)" pill UI and apply the filter */
  function _setFilter(filter) {
    _pickerFilter = filter;
    var pillAll  = document.getElementById('fp-filter-all');
    var pillSel  = document.getElementById('fp-filter-selected');
    var sel      = FocusTab.getPickerSelected();
    var selCount = sel.size;

    if (pillAll) {
      var on = filter === 'all';
      pillAll.style.background    = on ? 'var(--p)' : 'transparent';
      pillAll.style.color         = on ? '#fff'     : 'var(--t3)';
      pillAll.style.borderColor   = on ? 'var(--p)' : 'var(--border2)';
    }
    if (pillSel) {
      var on2 = filter === 'selected';
      pillSel.textContent         = 'Selected' + (selCount > 0 ? ' (' + selCount + ')' : '');
      pillSel.style.background    = on2 ? 'var(--p)' : 'transparent';
      pillSel.style.color         = on2 ? '#fff'      : 'var(--t3)';
      pillSel.style.borderColor   = on2 ? 'var(--p)'  : 'var(--border2)';
    }
    _applyFilter();
  }

  /* Show/hide rows based on the active filter */
  function _applyFilter() {
    var listEl = document.getElementById('focus-picker-list');
    if (!listEl) return;
    var sel    = FocusTab.getPickerSelected();
    var groups = listEl.querySelectorAll('.cat-pick-group');

    if (_pickerFilter === 'all') {
      // Restore all rows, collapse categories (search may have opened them)
      groups.forEach(function (group) {
        group.style.display = '';
        group.querySelectorAll('.app-sel-row').forEach(function (row) { row.style.display = ''; });
      });
    } else {
      // Selected filter: show only selected apps, auto-expand their categories
      groups.forEach(function (group) {
        var rows    = group.querySelectorAll('.app-sel-row');
        var anyOn   = false;
        rows.forEach(function (row) {
          var pkg    = row.getAttribute('data-pkg');
          var isOn   = pkg ? sel.has(pkg) : false;
          row.style.display = isOn ? '' : 'none';
          if (isOn) anyOn = true;
        });
        group.style.display = anyOn ? '' : 'none';
        if (anyOn) {
          // Auto-expand this category
          var catName = group.getAttribute('data-cat') || '';
          var catId   = 'catpick_' + catName.replace(/[^a-zA-Z0-9]/g, '_');
          var appsEl  = document.getElementById('catapps_' + catId);
          var arrowEl = document.getElementById('catarrow_' + catId);
          if (appsEl) appsEl.style.display = 'block';
          if (arrowEl) arrowEl.classList.add('open');
        }
      });
    }
  }

  /* Update the live selected-count badge on pill + Save button */
  function _updateSelectionUI() {
    var sel      = FocusTab.getPickerSelected();
    var selCount = sel.size;
    var pillSel  = document.getElementById('fp-filter-selected');
    if (pillSel) pillSel.textContent = 'Selected' + (selCount > 0 ? ' (' + selCount + ')' : '');
    var saveBtn  = document.getElementById('fp-save-btn');
    if (saveBtn) saveBtn.textContent = selCount > 0 ? 'Save (' + selCount + ')' : 'Save';
  }

  /* ═══════════════════════════════════════════════════════════
   * PICKER HTML BUILDERS
   * ═══════════════════════════════════════════════════════════ */

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
    var sel = FocusTab.getPickerSelected();
    var selCount = catApps.filter(function (a) { return sel.has(a.packageName); }).length;
    if (selCount === catApps.length) return 'all';
    return selCount > 0 ? 'partial' : 'none';
  }

  function _pickerAppRow(a, idPrefix) {
    var mins   = _pickerUsageMap[a.packageName] || 0;
    var pct    = Math.round((mins / _pickerMaxMins) * 100);
    var isOn   = FocusTab.getPickerSelected().has(a.packageName);
    var safeId = (idPrefix + a.packageName).replace(/[^a-zA-Z0-9_]/g, '_');
    return '<div class="app-sel-row" data-name="' + escAttr(a.name) + '" data-pkg="' + escAttr(a.packageName) + '"' +
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
      var selInCat = catApps.filter(function(a){ return FocusTab.getPickerSelected().has(a.packageName); }).length;
      html +=
        '<div class="cat-pick-group" data-cat="' + escAttr(catName) + '">' +
          '<div class="cat-pick-hdr" onclick="FocusPicker.toggleCatExpand(\'' + escAttr(catName) + '\')">' +
            '<div class="app-sel-check' + chkCls + '" id="catcheck_' + catId + '"' +
            ' onclick="event.stopPropagation();FocusPicker.toggleCategory(\'' + escAttr(catName) + '\')"></div>' +
            '<div style="font-size:18px;flex-shrink:0">' + icon + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div class="app-sel-name">' + escHtml(catName) + '</div>' +
              '<div class="app-sel-sub">' + catApps.length + ' app' + (catApps.length !== 1 ? 's' : '') +
              (selInCat > 0 ? ' · <span style="color:var(--p)">' + selInCat + ' selected</span>' : '') +
              (catMins ? ' · ' + fmtM(catMins) + ' today' : '') + '</div>' +
            '</div>' +
            '<div class="cat-pick-arrow" id="catarrow_' + catId + '">▶</div>' +
          '</div>' +
          '<div class="cat-pick-apps" id="catapps_' + catId + '" style="display:none">' +
            catApps.map(function (a) { return _pickerAppRow(a, 'fpick_'); }).join('') +
          '</div>' +
        '</div>';
    });
    return html;
  }

  /* ═══════════════════════════════════════════════════════════
   * PICKER OPEN
   * ═══════════════════════════════════════════════════════════ */

  /**
   * openPicker(mode, openInSelectedView)
   *   mode              — 'block' | 'intention' | 'bedtime' | 'routine'
   *   openInSelectedView — if true, start in Selected filter (used by +X chips)
   */
  function openPicker(mode, openInSelectedView) {
    mode = mode || 'block';
    _pickerFilter = openInSelectedView ? 'selected' : 'all';
    if (typeof FocusTab !== 'undefined') FocusTab.setPickerMode(mode);

    var title, currentPkgs;
    if (mode === 'intention') {
      title       = 'Mindful Pause Apps';
      currentPkgs = new Set((typeof FocusMindful !== 'undefined' ? FocusMindful.getApps() : []).map(function (a) { return a.packageName; }));
    } else if (mode === 'bedtime') {
      title       = 'Block During Bedtime';
      var _btLive = (window._btBlockedApps && window._btBlockedApps.length)
        ? window._btBlockedApps
        : (typeof FocusBedtime !== 'undefined' ? (FocusBedtime.getCfg().blockedApps || []) : []);
      currentPkgs = new Set(_btLive.map(function (a) { return a.packageName; }));
    } else {
      title       = 'Block During Session';
      currentPkgs = new Set(typeof FocusTab !== 'undefined' ? FocusTab.getBlockedApps().map(function (a) { return a.packageName; }) : []);
    }

    FocusTab.setPickerSelected(currentPkgs);
    _pickerPrevPkgs = new Set(currentPkgs); // snapshot for delta toast at save time

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

    // Render filter pills
    var filterRow = document.getElementById('fp-filter-row');
    if (filterRow) {
      filterRow.innerHTML =
        '<button id="fp-filter-all" onclick="FocusPicker.setFilter(\'all\')"' +
        ' style="padding:5px 14px;border-radius:99px;border:1px solid var(--p);background:var(--p);' +
        'color:#fff;font-family:var(--ff-m);font-size:11px;font-weight:700;cursor:pointer">All</button>' +
        '<button id="fp-filter-selected" onclick="FocusPicker.setFilter(\'selected\')"' +
        ' style="padding:5px 14px;border-radius:99px;border:1px solid var(--border2);background:transparent;' +
        'color:var(--t3);font-family:var(--ff-m);font-size:11px;font-weight:700;cursor:pointer">Selected</button>';
    }

    // Apply initial filter (updates pill styles + potentially filters list)
    _setFilter(_pickerFilter);
    _updateSelectionUI();

    if (typeof openPanel === 'function') openPanel('focus-picker-panel');
  }

  function setFilter(f) { _setFilter(f); }

  /* ═══════════════════════════════════════════════════════════
   * EXPAND / TOGGLE
   * ═══════════════════════════════════════════════════════════ */

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
      if (selectAll) sel.add(a.packageName); else sel.delete(a.packageName);
      var safeId = ('fpick_' + a.packageName).replace(/[^a-zA-Z0-9_]/g, '_');
      var chk    = document.getElementById(safeId);
      if (chk) chk.classList.toggle('on', selectAll);
    });
    var catId  = 'catpick_' + catName.replace(/[^a-zA-Z0-9]/g, '_');
    var catChk = document.getElementById('catcheck_' + catId);
    if (catChk) { catChk.classList.toggle('on', selectAll); catChk.classList.remove('partial'); }
    // Refresh category sub-label
    var listEl = document.getElementById('focus-picker-list');
    if (listEl) {
      var group   = listEl.querySelector('[data-cat="' + catName + '"]');
      var subEl   = group && group.querySelector('.cat-pick-hdr .app-sel-sub');
      if (subEl) {
        var selCount = catApps.filter(function(a){ return sel.has(a.packageName); }).length;
        var catMins  = catApps.reduce(function(s,a){ return s + (_pickerUsageMap[a.packageName]||0); }, 0);
        subEl.innerHTML = catApps.length + ' app' + (catApps.length !== 1 ? 's' : '') +
          (selCount > 0 ? ' · <span style="color:var(--p)">' + selCount + ' selected</span>' : '') +
          (catMins ? ' · ' + fmtM(catMins) + ' today' : '');
      }
    }
    _updateSelectionUI();
    if (_pickerFilter === 'selected') _applyFilter();
  }

  function togglePick(pkg, name, row) {
    var sel = FocusTab.getPickerSelected();
    if (sel.has(pkg)) sel.delete(pkg); else sel.add(pkg);
    var safeId = ('fpick_' + pkg).replace(/[^a-zA-Z0-9_]/g, '_');
    var chk    = document.getElementById(safeId);
    if (chk) chk.classList.toggle('on', sel.has(pkg));
    // Update category header state + sub-label
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
      var listEl = document.getElementById('focus-picker-list');
      if (listEl) {
        var group   = listEl.querySelector('[data-cat="' + catName + '"]');
        var subEl   = group && group.querySelector('.cat-pick-hdr .app-sel-sub');
        if (subEl) {
          var catApps  = CATS_MAP[catName] || [];
          var selCount = catApps.filter(function(a){ return sel.has(a.packageName); }).length;
          var catMins  = catApps.reduce(function(s,a){ return s + (_pickerUsageMap[a.packageName]||0); }, 0);
          subEl.innerHTML = catApps.length + ' app' + (catApps.length !== 1 ? 's' : '') +
            (selCount > 0 ? ' · <span style="color:var(--p)">' + selCount + ' selected</span>' : '') +
            (catMins ? ' · ' + fmtM(catMins) + ' today' : '');
        }
      }
    }
    _updateSelectionUI();
    // In selected view, hide a row that was just de-selected
    if (_pickerFilter === 'selected' && !sel.has(pkg) && row) row.style.display = 'none';
    // If the routine inline picker is open, sync its list + update Done badge
    var inlinePicker = document.getElementById('rp-inline-picker');
    if (inlinePicker) {
      var stdList    = document.getElementById('focus-picker-list');
      var inlineList = document.getElementById('rp-picker-list-inline');
      if (stdList && inlineList) inlineList.innerHTML = stdList.innerHTML;
      if (typeof window._rpOnInlinePickToggle === 'function') window._rpOnInlinePickToggle();
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * SEARCH — respects active filter
   * ═══════════════════════════════════════════════════════════ */

  function filterSearch(query) {
    var q      = (query || '').toLowerCase().trim();
    var groups = document.querySelectorAll('#focus-picker-list .cat-pick-group');
    var sel    = FocusTab.getPickerSelected();
    groups.forEach(function (group) {
      var catName  = (group.getAttribute('data-cat') || '').toLowerCase();
      var catMatch = catName.includes(q);
      var appRows  = group.querySelectorAll('.app-sel-row');
      var anyApp   = false;
      appRows.forEach(function (row) {
        var nm      = (row.getAttribute('data-name') || '').toLowerCase();
        var pkg     = row.getAttribute('data-pkg') || '';
        var matchQ  = !q || catMatch || nm.includes(q);
        var matchSel= _pickerFilter !== 'selected' || sel.has(pkg);
        var show    = matchQ && matchSel;
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

  /* ═══════════════════════════════════════════════════════════
   * SAVE
   * ═══════════════════════════════════════════════════════════ */

  function savePick() {
    var mode = typeof FocusTab !== 'undefined' ? FocusTab.getPickerMode() : 'block';
    _pickerFilter = 'all'; // reset for next open

    if (FocusTab.getPickerReturnTarget() === 'routine') {
      if (typeof FocusRoutine !== 'undefined') FocusRoutine.handlePickerSave();
      return;
    }

    var all = IS_NATIVE
      ? (function () { try { return JSON.parse(N.getAllApps() || '[]'); } catch (_) { return []; } })()
      : Object.values(CATS_MAP).flat();
    var appMap = {};
    all.forEach(function (a) { appMap[a.packageName] = a; });
    var apps = Array.from(FocusTab.getPickerSelected()).map(function (pkg) {
      return { packageName: pkg, name: (appMap[pkg] && appMap[pkg].name) || pkg.split('.').pop() };
    });

    if (mode === 'bedtime') {
      FocusTab.setPickerMode('block');
      if (typeof window._btOnBlockPickerSave === 'function') window._btOnBlockPickerSave(apps);
      if (typeof closePanel === 'function') closePanel('focus-picker-panel');
      _buildSaveToast('Bedtime', apps, _pickerPrevPkgs);
      return;
    }
    if (mode === 'intention') {
      if (!ProTier.isPro && apps.length > ProTier.getLimit('MINDFUL_OPENING_UNLIMITED')) {
        if (typeof closePanel === 'function') closePanel('focus-picker-panel');
        ProTier.triggerUpsell('MINDFUL_OPENING_UNLIMITED');
        return;
      }
      if (IS_NATIVE) { try { N.saveIntentionPromptApps(JSON.stringify(apps)); } catch (_) {} }
      if (typeof closePanel === 'function') closePanel('focus-picker-panel');
      if (typeof FocusMindful !== 'undefined') FocusMindful.render();
      _buildSaveToast('Mindful Pause', apps, _pickerPrevPkgs);
      return;
    }
    if (!ProTier.isPro && apps.length > ProTier.getLimit('FOCUS_APPS_UNLIMITED')) {
      if (typeof closePanel === 'function') closePanel('focus-picker-panel');
      ProTier.triggerUpsell('FOCUS_APPS_UNLIMITED');
      return;
    }
    FocusTab.setBlockedApps(apps);
    FocusTab.saveBlockedApps();
    FocusTab.refreshChips();
    if (typeof closePanel === 'function') closePanel('focus-picker-panel');
    var ss = FocusTab.getSessionState();
    if (ss.active && IS_NATIVE) {
      try { N.updateFocusSession(JSON.stringify(apps), Date.now() + (ss.secs * 1000), ss.difficulty); } catch (_) {}
    }
    _buildSaveToast('Focus Session', apps, _pickerPrevPkgs);
  }

  /* ── Global shims ─────────────────────────────────────────── */
  function openFocusAppPicker(mode, inSelected) { FocusPicker.openPicker(mode, inSelected); }
  function saveFocusPick()                       { FocusPicker.savePick(); }
  function toggleFocusPick(pkg, name, row)       { FocusPicker.togglePick(pkg, name, row); }
  function toggleFocusPickCategory(cat)          { FocusPicker.toggleCategory(cat); }
  function togglePickCatExpand(cat)              { FocusPicker.toggleCatExpand(cat); }
  function filterPickerSearch(q)                 { FocusPicker.filterSearch(q); }
  function activateTemplate(id)                  { FocusPicker.activateTemplate(id); }
  window.openFocusAppPicker      = openFocusAppPicker;
  window.saveFocusPick           = saveFocusPick;
  window.toggleFocusPick         = toggleFocusPick;
  window.toggleFocusPickCategory = toggleFocusPickCategory;
  window.togglePickCatExpand     = togglePickCatExpand;
  window.filterPickerSearch      = filterPickerSearch;
  window.activateTemplate        = activateTemplate;

  return {
    openPicker:          openPicker,
    savePick:            savePick,
    togglePick:          togglePick,
    toggleCategory:      toggleCategory,
    toggleCatExpand:     toggleCatExpand,
    filterSearch:        filterSearch,
    setFilter:           setFilter,
    activateTemplate:    activateTemplate,
    buildPickerHTML:     buildPickerHTML,
    buildPickerUsageMap: buildPickerUsageMap,
    TEMPLATES:           FOCUS_SCHEDULE_TEMPLATES,
  };
})();