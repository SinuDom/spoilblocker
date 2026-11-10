/*
 * GTA 6 Blocker - popup
 * Reads/writes settings in chrome.storage.sync. Open YouTube tabs listen for
 * storage changes and apply them instantly (no reload needed).
 */
(function () {
  'use strict';

  var DEFAULTS = {
    enabled: true, useBuiltin: true, shortsMode: 'overlay',
    customKeywords: [], allowKeywords: [], allowChannels: [], debug: false
  };
  var $ = function (id) { return document.getElementById(id); };
  var LISTS = ['customKeywords', 'allowKeywords', 'allowChannels'];
  var savedTimer = 0;

  function linesOf(text) {
    var seen = Object.create(null);
    return String(text || '').split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) {
        var k = s.toLowerCase();
        if (!s || seen[k]) return false;
        seen[k] = true;
        return true;
      })
      .slice(0, 500);
  }

  function save(patch) {
    chrome.storage.sync.set(patch, function () {
      var el = $('saved');
      if (chrome.runtime.lastError) {
        el.textContent = 'Could not save: ' + chrome.runtime.lastError.message;
        return;
      }
      el.textContent = 'Saved';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(function () { el.textContent = ''; }, 1200);
    });
  }

  function render(s) {
    $('enabled').checked = s.enabled;
    $('status').textContent = s.enabled ? 'Active on YouTube' : 'Paused - nothing is hidden';
    document.body.classList.toggle('off', !s.enabled);
    $('useBuiltin').checked = s.useBuiltin;
    $('debug').checked = s.debug;
    var radios = document.querySelectorAll('input[name="shortsMode"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === s.shortsMode;
    LISTS.forEach(function (k) {
      if (document.activeElement !== $(k)) $(k).value = (s[k] || []).join('\n');
    });
  }

  function renderCount() {
    try {
      chrome.storage.session.get({ blockedCount: 0 }, function (d) {
        if (!chrome.runtime.lastError) $('count').textContent = String(d.blockedCount || 0);
      });
    } catch (e) {}
  }

  // Built-in term count.
  var n = 0;
  ((globalThis.__GTA6B && globalThis.__GTA6B.KEYWORD_GROUPS) || []).forEach(function (g) { n += g.terms.length; });
  $('builtinCount').textContent = String(n);

  chrome.storage.sync.get(DEFAULTS, render);
  renderCount();

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'session') renderCount();
    if (area === 'sync') chrome.storage.sync.get(DEFAULTS, render);
  });

  $('enabled').addEventListener('change', function (e) { save({ enabled: e.target.checked }); });
  $('useBuiltin').addEventListener('change', function (e) { save({ useBuiltin: e.target.checked }); });
  $('debug').addEventListener('change', function (e) { save({ debug: e.target.checked }); });
  document.querySelectorAll('input[name="shortsMode"]').forEach(function (r) {
    r.addEventListener('change', function (e) { if (e.target.checked) save({ shortsMode: e.target.value }); });
  });

  // Lists save shortly after typing stops (and when the field loses focus).
  LISTS.forEach(function (k) {
    var timer = 0;
    var commit = function () { clearTimeout(timer); var p = {}; p[k] = linesOf($(k).value); save(p); };
    $(k).addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(commit, 500); });
    $(k).addEventListener('blur', commit);
  });
})();
