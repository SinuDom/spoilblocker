/*
 * GTA 6 Blocker - background service worker
 * Only job: keep the "blocked this session" counter. Each tab reports the
 * video ids it covered; we store the distinct ids in chrome.storage.session,
 * which is cleared when the browser closes. Nothing leaves your computer.
 */
'use strict';

var queue = Promise.resolve();

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'gta6-blocked' || !Array.isArray(msg.ids)) return;
  // Serialize updates so two tabs can't overwrite each other's counts.
  queue = queue.then(function () {
    return chrome.storage.session.get({ blockedIds: [] }).then(function (data) {
      var set = new Set(data.blockedIds);
      msg.ids.forEach(function (id) { if (typeof id === 'string' && id.length <= 20) set.add(id); });
      var ids = Array.from(set).slice(-20000);
      return chrome.storage.session.set({ blockedIds: ids, blockedCount: ids.length });
    });
  }).catch(function () {});
  sendResponse({ ok: true });
});
