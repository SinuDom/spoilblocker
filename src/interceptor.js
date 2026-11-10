/*
 * GTA 6 Blocker - page-world data interceptor
 * -------------------------------------------
 * Runs in the page's MAIN world at document_start, before any YouTube script.
 *
 * YouTube loads every list of videos (home feed, search, sidebar, Shorts ...)
 * as JSON from its internal "youtubei" API, and embeds the first page's data
 * in window.ytInitialData / window.ytInitialPlayerResponse. We read that same
 * JSON - never modifying or delaying it - and pull out, per videoId, the
 * title, description, tags (keywords), channel name and hashtags. That data
 * arrives BEFORE YouTube renders the cards.
 *
 * Each batch is handed to the content script with a synchronous CustomEvent;
 * the content script runs the keyword match immediately inside that event, so
 * the result is ready before the event returns.
 * (Matching lives in the content script because Chrome injects a script file
 * only once per page, so keywords.js cannot be loaded in both worlds.)
 *
 * Everything is wrapped in try/catch: if anything here fails, YouTube keeps
 * working exactly as if the extension were not installed.
 */
(function () {
  'use strict';
  if (window.__gta6BlockerInterceptor) return;
  try { Object.defineProperty(window, '__gta6BlockerInterceptor', { value: true }); } catch (e) { return; }

  // Must match NS.EVT in matcher.js.
  var EVT = {
    data: 'gta6blocker-q7k2:data',
    settings: 'gta6blocker-q7k2:settings',
    hello: 'gta6blocker-q7k2:hello',
    ready: 'gta6blocker-q7k2:ready',
    url: 'gta6blocker-q7k2:url',
    annotate: 'gta6blocker-q7k2:annotate',
    block: 'gta6blocker-q7k2:block'
  };
  var noop = function () {};

  // YouTube API endpoints whose responses carry video titles/descriptions/tags.
  var ENDPOINTS = /\/youtubei\/v1\/(?:browse|next|search|player|reel\/reel_item_watch|reel\/reel_watch_sequence|guide|get_watch|updated_metadata)(?:[/?#]|$)/;

  var debug = false;

  // videoId -> { id, title, channel, parts:Set<string>, len }
  // Kept so a content script that starts late (or after settings change) can
  // get everything again.
  var recs = new Map();
  var MAX_RECORDS = 8000;
  var VIDEO_ID = /^[\w-]{11}$/;

  /* ---------- Sending data to the content script ---------- */

  // items: [{ id, ti: title, ch: channel, p: [new text parts] }]
  function send(items, source, reset) {
    if (!items.length && !reset) return;
    try {
      document.dispatchEvent(new CustomEvent(EVT.data, {
        detail: JSON.stringify({ reset: !!reset, source: source || '', items: items })
      }));
    } catch (e) {}
  }

  // Adds what we learned about one video; queues only the NEW text parts.
  function record(id, title, channel, texts, out) {
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) return;
    var r = recs.get(id);
    if (!r) {
      r = { id: id, title: '', channel: '', parts: new Set(), len: 0 };
      recs.set(id, r);
      if (recs.size > MAX_RECORDS) recs.delete(recs.keys().next().value);
    }
    var item = null;
    if (title && !r.title) { r.title = String(title).slice(0, 300); item = { id: id }; }
    if (channel && !r.channel) { r.channel = String(channel).slice(0, 120); item = item || { id: id }; }
    var all = [title, channel].concat(texts || []);
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (t && typeof t === 'string' && r.len < 40000 && !r.parts.has(t)) {
        r.parts.add(t);
        r.len += t.length;
        item = item || { id: id };
        (item.p || (item.p = [])).push(t);
      }
    }
    if (item) {
      item.ti = r.title;
      item.ch = r.channel;
      out.push(item);
    }
  }

  /* ---------- Walking YouTube's JSON ---------- */

  // Text from YouTube's text objects: "str", {simpleText}, {runs:[{text}]}, {content}.
  function txt(o) {
    if (!o) return '';
    if (typeof o === 'string') return o;
    if (typeof o.simpleText === 'string') return o.simpleText;
    if (Array.isArray(o.runs)) {
      var s = '';
      for (var i = 0; i < o.runs.length; i++) s += (o.runs[i] && o.runs[i].text) || '';
      return s;
    }
    if (typeof o.content === 'string') return o.content;
    return '';
  }

  // Collects display strings (simpleText / text / content) inside an object.
  function strings(o, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (!o || typeof o !== 'object' || depth > 10 || out.length > 80) return out;
    if (Array.isArray(o)) {
      for (var i = 0; i < o.length; i++) strings(o[i], out, depth + 1);
      return out;
    }
    for (var k in o) {
      var v = o[k];
      if (typeof v === 'string') {
        if ((k === 'simpleText' || k === 'text' || k === 'content' || k === 'label') && v.length > 1) out.push(v);
      } else if (v && typeof v === 'object' && !SKIP_KEYS[k]) {
        strings(v, out, depth + 1);
      }
    }
    return out;
  }

  // Big subtrees with no titles in them; skipping them keeps the walk fast.
  var SKIP_KEYS = {
    streamingData: 1, playerAds: 1, adPlacements: 1, adSlots: 1, playbackTracking: 1,
    captions: 1, storyboards: 1, attestation: 1, responseContext: 1, thumbnail: 1,
    thumbnails: 1, loggingContext: 1, trackingParams: 1, heartbeatParams: 1,
    playerConfig: 1, annotations: 1, cards: 1, image: 1, avatar: 1, icon: 1,
    commandMetadata: 1, webCommandMetadata: 1, serviceEndpoint: 1, loggingDirectives: 1
  };

  // Renderers that describe the CURRENT video of a watch page / Short.
  var CURRENT_KEYS = [
    'videoPrimaryInfoRenderer', 'videoSecondaryInfoRenderer', 'videoDescriptionHeaderRenderer',
    'expandableVideoDescriptionBodyRenderer', 'playerMicroformatRenderer', 'reelPlayerHeaderRenderer',
    'reelMetapanelViewModel', 'shortsVideoTitleViewModel', 'slimVideoInformationRenderer',
    'slimVideoDescriptionRenderer', 'videoDescriptionHeaderViewModel'
  ];

  function walk(root, out) {
    var stack = [root, null, 0];
    var seen = 0;
    while (stack.length) {
      var depth = stack.pop();
      var ctxId = stack.pop();
      var node = stack.pop();
      if (!node || typeof node !== 'object' || depth > 80) continue;
      if (++seen > 400000) break; // safety valve

      if (Array.isArray(node)) {
        for (var i = node.length - 1; i >= 0; i--) {
          var item = node[i];
          if (item && typeof item === 'object') stack.push(item, ctxId, depth + 1);
        }
        continue;
      }

      // Which video is "current" for this subtree (watch page / Short / player response).
      var cur = ctxId;
      if (node.currentVideoEndpoint && node.currentVideoEndpoint.watchEndpoint && node.currentVideoEndpoint.watchEndpoint.videoId) {
        cur = node.currentVideoEndpoint.watchEndpoint.videoId;
      }
      if (node.replacementEndpoint && node.replacementEndpoint.reelWatchEndpoint && node.replacementEndpoint.reelWatchEndpoint.videoId) {
        cur = node.replacementEndpoint.reelWatchEndpoint.videoId;
      }
      if (node.videoDetails && node.videoDetails.videoId) cur = node.videoDetails.videoId;

      // 1) Classic renderers (videoRenderer, compactVideoRenderer, gridVideoRenderer,
      //    reelItemRenderer, playlistVideoRenderer, endScreenVideoRenderer ...) and
      //    the player's videoDetails (title, shortDescription, keywords, author).
      if (typeof node.videoId === 'string' && (node.title || node.headline || node.shortDescription || node.keywords)) {
        var texts = [txt(node.descriptionSnippet), txt(node.shortDescription)];
        if (Array.isArray(node.keywords)) texts.push(node.keywords.join(' , '));
        if (Array.isArray(node.detailedMetadataSnippets)) {
          for (var d = 0; d < node.detailedMetadataSnippets.length; d++) {
            texts.push(txt(node.detailedMetadataSnippets[d] && node.detailedMetadataSnippets[d].snippetText));
          }
        }
        if (node.title && node.title.accessibility) texts.push(strings(node.title.accessibility).join(' '));
        record(node.videoId, txt(node.title) || txt(node.headline),
          txt(node.author) || txt(node.ownerText) || txt(node.longBylineText) || txt(node.shortBylineText),
          texts, out);
      }

      // 1b) Renderers that only link to the video (watch cards in search, autoplay):
      //     title + thumbnail + navigationEndpoint.watchEndpoint.videoId.
      if (typeof node.videoId !== 'string' && node.title && node.thumbnail && node.navigationEndpoint) {
        var ne = node.navigationEndpoint;
        var nid = (ne.watchEndpoint && ne.watchEndpoint.videoId) || (ne.reelWatchEndpoint && ne.reelWatchEndpoint.videoId);
        if (nid) record(nid, txt(node.title), txt(node.subtitle) || txt(node.shortBylineText) || txt(node.byline), [txt(node.titleAccessibility)], out);
      }

      // 2) New "lockup" view models (home feed / sidebar / search, 2024+).
      if (typeof node.contentId === 'string' && typeof node.contentType === 'string' && /VIDEO|SHORT/.test(node.contentType)) {
        var md = node.metadata && node.metadata.lockupMetadataViewModel;
        var mdStrings = md ? strings(md.metadata) : [];
        record(node.contentId, md ? txt(md.title) : '', mdStrings[0] || '', mdStrings, out);
      }

      // 3) Shorts shelf items (shortsLockupViewModel).
      if (node.overlayMetadata || (typeof node.entityId === 'string' && node.entityId.indexOf('shorts-shelf-item-') === 0)) {
        var sid = (node.onTap && node.onTap.innertubeCommand && node.onTap.innertubeCommand.reelWatchEndpoint &&
                   node.onTap.innertubeCommand.reelWatchEndpoint.videoId) ||
                  (typeof node.entityId === 'string' ? node.entityId.replace('shorts-shelf-item-', '') : '');
        var om = node.overlayMetadata || {};
        record(sid, txt(om.primaryText), '', [txt(om.secondaryText), node.accessibilityText || ''], out);
      }

      // 4) Watch-page / Shorts-player renderers describing the current video.
      if (cur) {
        for (var c = 0; c < CURRENT_KEYS.length; c++) {
          var cr = node[CURRENT_KEYS[c]];
          if (cr && typeof cr === 'object') {
            var title = txt(cr.title) || txt(cr.reelTitleText);
            var owner = (cr.owner && cr.owner.videoOwnerRenderer && txt(cr.owner.videoOwnerRenderer.title)) ||
                        txt(cr.channelTitleText) || cr.ownerChannelName || '';
            record(cur, title, owner, strings(cr), out);
          }
        }
      }

      for (var k in node) {
        if (SKIP_KEYS[k]) continue;
        var v = node[k];
        if (!v || typeof v !== 'object') continue;
        var childCtx = cur;
        // A reelWatchEndpoint's own subtree (e.g. prefetched Shorts overlays) is about its videoId.
        if (k === 'reelWatchEndpoint' && typeof v.videoId === 'string') childCtx = v.videoId;
        stack.push(v, childCtx, depth + 1);
      }
    }
  }

  function processData(data, source) {
    if (!data || typeof data !== 'object') return;
    var out = [];
    walk(data, out);
    send(out, source);
  }

  function safeProcess(data, source) {
    try { processData(data, source); } catch (e) { if (debug) console.warn('[GTA 6 Blocker] parse error', e); }
  }

  function handleBody(body, url) {
    if (typeof body !== 'string' || !body) return;
    if (body.charAt(0) === ')') body = body.replace(/^\)\]\}'\s*/, ''); // XSSI prefix
    var c = body.charAt(0);
    if (c !== '{' && c !== '[') return;
    var data;
    try { data = JSON.parse(body); } catch (e) { return; }
    safeProcess(data, shortUrl(url));
  }

  function shortUrl(url) {
    var m = /\/youtubei\/v1\/([\w/]+)/.exec(url || '');
    return m ? '/' + m[1] : String(url).slice(0, 60);
  }

  /* ---------- 1. Wrap fetch (read a CLONE, return the original untouched) ---------- */
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      var wrappedFetch = function fetch(input) {
        var p = origFetch.apply(this === undefined ? window : this, arguments);
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || String(input);
          if (ENDPOINTS.test(url)) {
            p.then(function (res) {
              try {
                if (res && res.ok && !res.bodyUsed) res.clone().text().then(function (b) { handleBody(b, url); }, noop);
              } catch (e) {}
            }, noop);
          }
        } catch (e) {}
        return p;
      };
      try { wrappedFetch.toString = function () { return origFetch.toString(); }; } catch (e) {}
      window.fetch = wrappedFetch;
    }
  } catch (e) {}

  /* ---------- 2. Wrap XMLHttpRequest (older code paths, m.youtube.com) ---------- */
  try {
    var XHR = XMLHttpRequest.prototype;
    var origOpen = XHR.open;
    var origSend = XHR.send;
    XHR.open = function (method, url) {
      try { this.__gta6url = String(url); } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XHR.send = function () {
      try {
        var url = this.__gta6url;
        if (url && ENDPOINTS.test(url)) {
          this.addEventListener('load', function () {
            try {
              var rt = this.responseType;
              if (rt === '' || rt === 'text') handleBody(this.responseText, url);
              else if (rt === 'json') safeProcess(this.response, shortUrl(url));
            } catch (e) {}
          });
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  } catch (e) {}

  /* ---------- 3. First page load: ytInitialData / ytInitialPlayerResponse ----------
     YouTube assigns these in inline <script>s. A setter lets us classify the
     moment they are assigned, before the page builds any element from them. */
  function trap(name) {
    try {
      var value = window[name];
      var desc = Object.getOwnPropertyDescriptor(window, name);
      if (desc && !desc.configurable) return;
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () { return value; },
        set: function (v) { value = v; safeProcess(v, name); }
      });
      if (value) safeProcess(value, name);
    } catch (e) {}
  }
  trap('ytInitialData');
  trap('ytInitialPlayerResponse');

  // Fallback in case the trap was bypassed.
  document.addEventListener('DOMContentLoaded', function () {
    try {
      if (window.ytInitialData) safeProcess(window.ytInitialData, 'ytInitialData (DOMContentLoaded)');
      if (window.ytInitialPlayerResponse) safeProcess(window.ytInitialPlayerResponse, 'ytInitialPlayerResponse (DOMContentLoaded)');
    } catch (e) {}
    annotateAll();
  });

  // SPA navigations served from YouTube's cache carry their data in the event.
  document.addEventListener('yt-navigate-finish', function (e) {
    try { if (e && e.detail && e.detail.response) safeProcess(e.detail.response, 'yt-navigate-finish'); } catch (err) {}
    annotateAll();
  });

  /* ---------- 4. Tell the content script which video each player is playing ----------
     Only page code can call the player API (getVideoData). We store the id in
     a data attribute, which the content script can read. */
  function annotatePlayer(p) {
    try {
      if (!p || typeof p.getVideoData !== 'function') return;
      var d = p.getVideoData();
      var id = d && d.video_id;
      if (!id) return;
      if (d.title) { var out = []; record(id, d.title, d.author || '', [], out); send(out, 'player API'); }
      if (p.getAttribute('data-gta6-vid') !== id) p.setAttribute('data-gta6-vid', id);
    } catch (e) {}
  }

  // Shorts: each reel container gets the id of the Short it holds.
  function annotateReels() {
    try {
      var reels = document.querySelectorAll('ytd-reel-video-renderer');
      for (var i = 0; i < reels.length; i++) {
        var el = reels[i];
        var data = el.data || (el.__data && el.__data.data);
        var id = data && ((data.command && data.command.reelWatchEndpoint && data.command.reelWatchEndpoint.videoId) || data.videoId);
        if (id && el.getAttribute('data-gta6-vid') !== id) el.setAttribute('data-gta6-vid', id);
      }
    } catch (e) {}
  }

  function annotateAll() {
    try {
      var players = document.querySelectorAll('.html5-video-player');
      for (var i = 0; i < players.length; i++) annotatePlayer(players[i]);
      annotateReels();
    } catch (e) {}
  }

  // YouTube may call play() before switching the player to the next video, so
  // the new video can start without a new play() call. Check again on these
  // events (capture phase, before YouTube's own listeners run).
  ['loadstart', 'loadedmetadata', 'play', 'playing', 'timeupdate'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      try {
        var t = e.target;
        if (!t || t.tagName !== 'VIDEO') return;
        var p = t.closest('.html5-video-player');
        if (type !== 'timeupdate') annotatePlayer(p);
        if (p && blockedIds.size) enforce(t, p);
      } catch (err) {}
    }, true);
  });

  // URL changes without a full navigation (e.g. scrolling Shorts).
  ['pushState', 'replaceState'].forEach(function (fn) {
    try {
      var orig = history[fn];
      history[fn] = function () {
        var r = orig.apply(this, arguments);
        try { annotateAll(); document.dispatchEvent(new CustomEvent(EVT.url)); } catch (e) {}
        return r;
      };
    } catch (e) {}
  });
  window.addEventListener('popstate', function () { annotateAll(); });

  /* ---------- 5. Refuse playback of blocked videos ----------
     Media events ("play") are dispatched asynchronously, so pausing from an
     event handler can let a few milliseconds of sound through. Instead,
     play() itself checks the player's current videoId against the set of
     blocked ids (kept in sync by the content script) and refuses, exactly
     like the browser does when autoplay is not allowed. No audio can start. */
  var blockedIds = new Set();

  // The URL's video id for the main watch player / the Shorts player.
  function urlIdFor(p) {
    var m;
    if ((p.id === 'shorts-player' || p.closest('ytd-shorts, ytm-shorts-player-renderer')) &&
        (m = /^\/shorts\/([\w-]{11})/.exec(location.pathname))) return m[1];
    if ((p.id === 'movie_player' || p.closest('ytd-watch-flexy')) && location.pathname === '/watch' &&
        (m = /[?&]v=([\w-]{11})/.exec(location.search))) return m[1];
    return null;
  }

  // Returns 2 if every id source says the video is blocked, 1 if some do, 0 if none.
  function blockState(p) {
    var d = typeof p.getVideoData === 'function' ? p.getVideoData() : null;
    var ids = [d && d.video_id, urlIdFor(p)].filter(Boolean);
    var hits = ids.filter(function (id) { return blockedIds.has(id); }).length;
    return !hits ? 0 : hits === ids.length ? 2 : 1;
  }
  function muteByUs(v) {
    if (!v.muted) { try { v.muted = true; v.setAttribute('data-gta6-muted', '1'); } catch (e) {} }
  }
  // Blocked for sure: mute + pause. Unsure (sources disagree): mute only.
  function enforce(v, p) {
    var st = blockState(p);
    if (st) muteByUs(v);
    if (st === 2 && !v.paused) { try { v.pause(); } catch (e) {} }
    return st;
  }

  try {
    var MP = HTMLMediaElement.prototype;
    var origPlay = MP.play;
    var wrappedPlay = function play() {
      try {
        if (blockedIds.size) {
          var p = this.closest && this.closest('.html5-video-player');
          if (p) {
            // While YouTube switches videos the player API and the URL can
            // briefly disagree. Refuse only when every source says "blocked";
            // if they disagree, start muted and let the content script decide.
            var bs = blockState(p);
            if (bs) muteByUs(this);
            if (bs === 2) {
              annotatePlayer(p);
              if (debug) console.log('[GTA 6 Blocker] refused play() for a blocked video');
              return Promise.reject(new DOMException('Blocked by GTA 6 Blocker', 'NotAllowedError'));
            }
          }
        }
      } catch (e) {}
      return origPlay.apply(this, arguments);
    };
    try { wrappedPlay.toString = function () { return origPlay.toString(); }; } catch (e) {}
    MP.play = wrappedPlay;
  } catch (e) {}

  document.addEventListener(EVT.block, function (e) {
    try {
      var m = JSON.parse(e.detail);
      if (m.reset) blockedIds.clear();
      (m.add || []).forEach(function (id) { blockedIds.add(id); });
      (m.remove || []).forEach(function (id) { blockedIds.delete(id); });
    } catch (err) {}
  });

  /* ---------- 6. Messages from the content script ---------- */

  function sendAll() {
    var out = [];
    recs.forEach(function (r) {
      out.push({ id: r.id, ti: r.title, ch: r.channel, p: Array.from(r.parts) });
    });
    send(out, 'resend', true);
  }

  document.addEventListener(EVT.settings, function (e) {
    try { debug = !!JSON.parse(e.detail).debug; } catch (err) {}
  });

  document.addEventListener(EVT.hello, function () {
    try { sendAll(); annotateAll(); } catch (e) {}
  });
  document.addEventListener(EVT.annotate, annotateAll);

  try { document.dispatchEvent(new CustomEvent(EVT.ready)); } catch (e) {}
})();
