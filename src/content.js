/*
 * GTA 6 Blocker - content script (isolated world)
 * -----------------------------------------------
 * Receives classification results from the page script (interceptor.js),
 * watches the DOM with ONE MutationObserver, and covers blocked cards and
 * players synchronously - in the same frame the element appears.
 *
 * Hiding is done by setting data attributes; the stylesheet does the rest.
 * Every entry point is wrapped so an error here never breaks YouTube.
 */
(function () {
  'use strict';
  var NS = globalThis.__GTA6B;
  if (!NS || NS.contentLoaded || !NS.buildMatcher) return;
  NS.contentLoaded = true;

  /* =====================================================================
   * 1. SELECTOR CONFIG - everything YouTube-specific lives here.
   *    YouTube renames elements often; update these lists when it does.
   *    Cards are found mainly by walking UP from a /watch or /shorts link,
   *    so a missing tag name here only costs a slower fallback.
   * ===================================================================== */
  var CONFIG = {
    // Links that identify a video.
    videoLink: 'a[href*="/watch?v="], a[href*="/shorts/"]',

    // Known card containers. The nearest one around a video link is the card.
    cards: [
      // desktop (current and older renderers)
      'yt-lockup-view-model', 'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
      'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
      'ytd-grid-video-renderer', 'ytd-reel-item-renderer', 'ytd-playlist-video-renderer',
      'ytd-playlist-panel-video-renderer', 'ytd-movie-renderer', 'ytd-compact-movie-renderer',
      'ytd-notification-renderer', 'ytd-promoted-video-renderer', 'ytd-compact-autoplay-renderer',
      'ytd-structured-description-video-lockup-renderer', 'ytd-reel-video-renderer[data-gta6-vid]',
      'ytd-watch-card-compact-video-renderer', 'ytd-watch-card-hero-video-renderer',
      'ytd-video-masthead-ad-primary-video-renderer', 'ytd-channel-video-player-renderer',
      // m.youtube.com
      'ytm-video-with-context-renderer', 'ytm-compact-video-renderer', 'ytm-reel-item-renderer',
      'ytm-rich-item-renderer', 'ytm-playlist-video-renderer', 'ytm-playlist-panel-video-renderer',
      'ytm-media-item', 'ytm-video-card-renderer', 'ytm-compact-autoplay-renderer'
    ],

    // Links that ARE the whole card (player end screen, autoplay "up next").
    selfCards: [
      '.ytp-videowall-still', '.ytp-modern-videowall-still', '.ytp-autonav-endscreen-link-container',
      '.ytp-ce-covering-overlay', '.ytp-suggestion-link', 'a.ytp-ce-link'
    ],

    // Upcoming Shorts in the full-screen player: plain divs whose CSS
    // background-image URL (i.ytimg.com/vi/<id>/...) is the only id we get.
    // Blocked ones simply lose their background image (no overlay element).
    shortsSeqThumb: ['.reel-video-in-sequence-thumbnail'],

    // Hover previews / inline players: hidden completely while showing a blocked video.
    previews: ['ytd-video-preview', '#video-preview', '#inline-preview-player', 'ytd-moving-thumbnail-renderer'],

    // Cards whose overlay goes on the card itself (not on an inner thumbnail).
    cardIsHost: ['ytd-watch-card-hero-video-renderer'],

    // Cards without a video link (ads, promos): matched on their visible text.
    textCards: [
      'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-search-pyv-renderer',
      'ytd-promoted-sparkles-web-renderer', 'ytd-display-ad-renderer', 'ytd-statement-banner-renderer',
      'ytm-promoted-sparkles-web-renderer', 'ad-slot-renderer'
    ],

    // Links inside these areas are not cards (descriptions, comments, menus, player title).
    ignore: [
      '.gta6-overlay', '#description', 'ytd-text-inline-expander', 'ytd-comment-thread-renderer',
      'ytd-comment-view-model', 'ytd-comment-renderer', '#content-text', 'ytd-watch-metadata',
      'ytd-guide-renderer', 'tp-yt-app-drawer', 'ytm-comment-renderer', '.ytp-chrome-top',
      '.ytp-title', 'ytd-video-secondary-info-renderer', 'ytm-expandable-video-description-body-renderer'
    ],

    // Where the overlay goes inside a card (first match wins).
    thumbnail: [
      'ytd-thumbnail', 'yt-thumbnail-view-model', '.yt-lockup-view-model__content-image',
      '.yt-lockup-view-model-wiz__content-image', '.shortsLockupViewModelHostThumbnailParentContainer',
      '.shortsLockupViewModelHostThumbnailContainer', 'a.reel-item-endpoint', '#thumbnail',
      'ytm-thumbnail-cover', '.media-item-thumbnail-container', '.video-thumbnail-container-large',
      '.compact-media-item-image', '.video-card-image', '#player-container', '.player-container'
    ],

    // Title text inside a card: read for fallback matching, hidden while blocked.
    title: [
      '#video-title', '#video-title-link', '.yt-lockup-metadata-view-model__title',
      '.yt-lockup-metadata-view-model-wiz__title', '.shortsLockupViewModelHostMetadataTitle',
      '.shortsLockupViewModelHostOutsideMetadataTitle', '.ytp-videowall-still-info-title',
      '.ytp-modern-videowall-still-info-title', '.ytp-autonav-endscreen-upnext-title',
      '.ytp-ce-video-title', '.media-item-headline', '.compact-media-item-headline',
      '.video-card-title', '#watch-card-title', '.title-wrapper', '.title-container', 'h3', 'h4'
    ],

    // Other text in a card hidden while blocked (channel, views, snippet).
    meta: [
      '#channel-name', '#byline-container', 'ytd-channel-name', '#metadata-line', '#description-text',
      '.metadata-snippet-container', '.yt-lockup-metadata-view-model__metadata',
      '.yt-content-metadata-view-model', '.yt-content-metadata-view-model-wiz',
      '.shortsLockupViewModelHostMetadataSubhead', '.shortsLockupViewModelHostOutsideMetadataSubhead',
      '.ytp-videowall-still-info-author', '.ytp-autonav-endscreen-video-info',
      '.media-item-byline', '.compact-media-item-byline', '.video-card-byline', '#avatar',
      '.text-wrapper', '#meta', '#details', '#channel-info', '#expandable-metadata',
      '.yt-lockup-view-model__metadata', 'yt-lockup-metadata-view-model', '.watch-card-hero-text',
      '#metadata-container', '.details', 'ytd-badge-supported-renderer'
    ],

    // Video players (desktop + mobile all use this class).
    player: '.html5-video-player',
    // A player inside one of these is the main watch-page player.
    watchScope: 'ytd-watch-flexy, ytd-watch-grid, ytd-miniplayer, #player-container-id, ytm-watch, #ytd-player',
    // A player inside one of these plays Shorts.
    shortsScope: 'ytd-shorts, ytd-reel-video-renderer, ytm-shorts-player-renderer, ytm-reel-player-renderer, #shorts-player',
    // The container of one Short in the full-screen Shorts player.
    shortsReel: 'ytd-reel-video-renderer, ytm-reel',

    // Watch page text hidden while the current video is blocked.
    watchText: [
      'ytd-watch-metadata #title', 'ytd-watch-metadata #description', 'ytd-watch-metadata #owner',
      '#above-the-fold #title', 'ytd-video-primary-info-renderer .title', 'ytd-video-secondary-info-renderer',
      'ytd-miniplayer .miniplayer-title', 'ytd-miniplayer #owner-name', 'ytd-miniplayer .title',
      '.ytp-title-text', '.ytp-title-channel', '.ytp-title-expanded-overlay', '.ytp-chapter-title',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-structured-description"] #content',
      '.slim-video-information-title', '.slim-video-metadata-header', 'ytm-slim-video-information-renderer',
      'ytm-video-description-header-renderer', '.slim-owner-icon-and-title',
      'ytd-comments#comments', 'ytm-comment-section-renderer'
    ],
    // Title of the Short being watched (fallback matching) and its text overlay.
    shortsTitle: [
      '.ytShortsVideoTitleViewModelShortsVideoTitle', 'yt-shorts-video-title-view-model',
      'ytd-reel-player-header-renderer h2', '.reel-player-header-renderer-title', 'h2.title'
    ],
    shortsText: [
      'ytd-reel-player-header-renderer', 'yt-reel-metapanel-view-model', '.ytReelMetapanelViewModelHost',
      'yt-shorts-video-title-view-model', '.ytShortsVideoTitleViewModelShortsVideoTitle',
      '.metadata-container', 'reel-player-header-renderer', '.reel-player-overlay-metadata'
    ],
    // Watch page title (fallback matching when no data was intercepted).
    watchTitle: ['ytd-watch-metadata #title h1', 'h1.ytd-watch-metadata', '.slim-video-information-title', 'h1.title'],
    // "Next Short" button, used by the auto-skip option.
    shortsNext: [
      '#navigation-button-down button', '#navigation-button-down ytd-button-renderer',
      '.navigation-button-down button', 'ytd-shorts [aria-label="Next video"]'
    ]
  };

  /* ---------- derived selectors ---------- */
  var SEL_CARD = CONFIG.previews.concat(CONFIG.cards).join(',');
  var SEL_SELF = CONFIG.selfCards.join(',');
  var SEL_IGNORE = CONFIG.ignore.join(',');
  var SEL_THUMB = CONFIG.thumbnail.join(',');
  var SEL_TITLE = CONFIG.title.join(',');
  var SEL_HOSTCARD = CONFIG.selfCards.concat(CONFIG.cardIsHost).join(',');
  var SEL_TEXTCARD = CONFIG.textCards.join(',');
  var SEL_SEQ = CONFIG.shortsSeqThumb.join(',');
  var SEL_LINK_OR_PLAYER = CONFIG.videoLink + ',' + CONFIG.player + ',ytd-reel-video-renderer[data-gta6-vid],' + SEL_TEXTCARD + ',' + SEL_SEQ;
  var RE_THUMB_ID = /\/vi(?:_webp)?\/([\w-]{11})\//;

  var ATTR = 'data-gta6-blocked';       // on cards: "1" (hidden) or "title" (title revealed)
  var ATTR_HOST = 'data-gta6-host';     // on the element that holds an overlay
  var ATTR_WATCH = 'data-gta6-watch';   // on <html> while the watch-page video is blocked
  var ATTR_REEL = 'data-gta6-reel';     // on a Shorts reel while its video is blocked
  var ATTR_VID = 'data-gta6-vid';       // set by the page script: id a player/reel holds
  var EVT = NS.EVT;

  /* ---------- state ---------- */
  var DEFAULTS = {
    enabled: true, useBuiltin: true, shortsMode: 'overlay',
    customKeywords: [], allowKeywords: [], allowChannels: [], debug: false
  };
  var settings = Object.assign({}, DEFAULTS);
  var matcher = NS.buildMatcher(settings);   // used for DOM-text fallback
  var results = new Map();                   // videoId -> { b, t, ti, ch, at }
  var byId = new Map();                      // videoId -> Set<card element>
  var cardState = new WeakMap();             // card -> { id, overlay, host, domText, domRes, logged }
  var playerState = new WeakMap();           // player -> { id, blocked, pausedByUs }
  var pending = new Set();                   // cards decided from DOM text only (no data yet)
  var reveals = loadReveals();               // videoId -> "title" | "video" (this tab session)
  var counted = new Set();
  var countQueue = [];
  var skipped = new Map();

  function log() {
    if (!settings.debug) return;
    try { console.log.apply(console, ['%c[GTA 6 Blocker]', 'color:#e5484d;font-weight:bold'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function safe(fn) {
    return function () {
      try { return fn.apply(this, arguments); } catch (e) { if (settings.debug) console.warn('[GTA 6 Blocker]', e); }
    };
  }

  /* ---------- helpers ---------- */
  var RE_WATCH = /[?&]v=([\w-]{11})/;
  var RE_SHORTS = /\/shorts\/([\w-]{11})/;

  function idFromHref(href) {
    if (!href) return null;
    var m = RE_WATCH.exec(href) || RE_SHORTS.exec(href);
    return m ? m[1] : null;
  }
  function urlWatchId() {
    if (location.pathname !== '/watch') return null;
    var m = RE_WATCH.exec(location.search);
    return m ? m[1] : null;
  }
  function urlShortsId() {
    var m = /^\/shorts\/([\w-]{11})/.exec(location.pathname);
    return m ? m[1] : null;
  }
  function firstText(root, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return '';
  }

  function loadReveals() {
    try { return JSON.parse(sessionStorage.getItem('gta6blocker-reveals') || '{}') || {}; } catch (e) { return {}; }
  }
  function saveReveals() {
    try { sessionStorage.setItem('gta6blocker-reveals', JSON.stringify(reveals)); } catch (e) {}
  }

  /* =====================================================================
   * 2. STYLES generated from CONFIG so selectors stay in one place.
   *    (Overlay looks are in content.css.)
   * ===================================================================== */
  function injectStyles() {
    var hideCard = CONFIG.title.concat(CONFIG.meta).map(function (s) { return '[' + ATTR + '="1"] ' + s; });
    var hideThumb = CONFIG.thumbnail.map(function (s) {
      return '[' + ATTR + '] ' + s + ' img, [' + ATTR + '] ' + s + ' video';
    });
    var css =
      ':where(' + hideCard.join(',') + '){visibility:hidden!important}\n' +
      ':where(' + hideThumb.join(',') + '){opacity:0!important}\n' +
      ':where(' + CONFIG.watchText.map(function (s) { return 'html[' + ATTR_WATCH + '="1"] ' + s; }).join(',') + '){visibility:hidden!important}\n' +
      ':where(' + CONFIG.shortsText.map(function (s) { return '[' + ATTR_REEL + '="1"] ' + s; }).join(',') + '){visibility:hidden!important}\n' +
      ':where(' + CONFIG.textCards.map(function (s) { return s + '[' + ATTR + '="1"]'; }).join(',') + ') ' +
        ':is(h1,h2,h3,h4,p,#title,#description,[class*="title" i],[class*="headline" i],[class*="description" i],' +
        '[class*="body-text" i],[class*="metadata" i],[class*="attributedstring" i])' +
        ':not(.gta6-overlay, .gta6-overlay *){visibility:hidden!important}\n' +
      ':where(' + CONFIG.previews.map(function (s) { return s + '[' + ATTR + ']'; }).join(',') + '){visibility:hidden!important}\n' +
      ':where(' + CONFIG.shortsSeqThumb.map(function (s) { return s + '[' + ATTR + ']'; }).join(',') + ')' +
        '{background-image:none!important;background-color:#202024!important}\n' +
      '[' + ATTR_HOST + ']{position:relative!important}\n';
    var style = document.createElement('style');
    style.id = 'gta6-blocker-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* =====================================================================
   * 3. OVERLAY - built once, cloned for each blocked item.
   * ===================================================================== */
  var template = null;
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function buildTemplate() {
    var ov = el('div', 'gta6-overlay');
    ov.setAttribute('role', 'group');
    ov.setAttribute('aria-label', 'Blocked by GTA 6 Blocker');
    var box = el('div', 'gta6-box');
    var icon = el('div', 'gta6-icon');
    icon.setAttribute('aria-hidden', 'true');
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    var c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '9');
    var l = document.createElementNS(svgNS, 'path');
    l.setAttribute('d', 'M5.7 5.7l12.6 12.6');
    svg.appendChild(c); svg.appendChild(l); icon.appendChild(svg);
    var real = el('div', 'gta6-real');
    real.appendChild(el('div', 'gta6-real-title'));
    real.appendChild(el('div', 'gta6-real-channel'));
    var btns = el('div', 'gta6-btns');
    var bt = el('button', 'gta6-btn', 'Reveal title');
    bt.type = 'button'; bt.setAttribute('data-gta6-act', 'title');
    var bv = el('button', 'gta6-btn gta6-btn--primary', 'Reveal video');
    bv.type = 'button'; bv.setAttribute('data-gta6-act', 'video');
    btns.appendChild(bt); btns.appendChild(bv);
    box.appendChild(icon);
    box.appendChild(el('div', 'gta6-head', 'Blocked by GTA 6 Blocker'));
    box.appendChild(el('div', 'gta6-term'));
    box.appendChild(real);
    box.appendChild(btns);
    ov.appendChild(box);
    return ov;
  }
  function newOverlay(isPlayer) {
    if (!template) template = buildTemplate();
    var ov = template.cloneNode(true);
    if (isPlayer) ov.classList.add('gta6-overlay--player');
    return ov;
  }

  function fillOverlay(ov, id, res, fallbackTitle) {
    var rv = reveals[id];
    if (ov.getAttribute('data-vid') !== id) ov.setAttribute('data-vid', id);
    var term = res && res.t ? 'Matched: ' + res.t : 'Matched a GTA 6 keyword';
    var termEl = ov.querySelector('.gta6-term');
    if (termEl.textContent !== term) termEl.textContent = term;
    var showTitle = rv === 'title';
    ov.classList.toggle('gta6-title-shown', showTitle);
    if (showTitle) {
      var r = results.get(id);
      ov.querySelector('.gta6-real-title').textContent = (r && r.ti) || fallbackTitle || 'Title unavailable';
      ov.querySelector('.gta6-real-channel').textContent = (r && r.ch) || '';
    }
  }

  /* =====================================================================
   * 4. CARDS
   * ===================================================================== */

  // Finds the card element for a video link (walks UP from the link).
  function findCard(a) {
    if (a.matches(SEL_SELF)) return a;
    if (a.closest(SEL_IGNORE)) return null;
    var card = a.closest(SEL_CARD) || a.closest(SEL_TEXTCARD);
    if (card) return card;
    // Unknown layout: only thumbnail-like links count, then climb while the
    // ancestor still contains only links to this same video.
    if (!a.querySelector('img, yt-image, [class*="thumbnail"], [id*="thumbnail"]')) return null;
    var id = idFromHref(a.getAttribute('href'));
    var node = a;
    for (var i = 0; i < 4; i++) {
      var p = node.parentElement;
      if (!p || p === document.body || p === document.documentElement) break;
      var links = p.querySelectorAll(CONFIG.videoLink);
      var same = true;
      for (var j = 0; j < links.length; j++) {
        if (idFromHref(links[j].getAttribute('href')) !== id) { same = false; break; }
      }
      if (!same) break;
      node = p;
    }
    return node;
  }

  function thumbHost(card) {
    if (card.matches(SEL_HOSTCARD)) return card;
    if (card.matches(SEL_TEXTCARD)) {
      var img = card.querySelector('img');
      return card.querySelector(SEL_THUMB) || (img && img.parentElement) || card;
    }
    return card.querySelector(SEL_THUMB) || card;
  }

  function cardText(card, link) {
    var t = card.matches(SEL_SELF) || card.matches(SEL_TEXTCARD) ? card.textContent : firstText(card, CONFIG.title);
    var extra = link ? (link.getAttribute('title') || link.getAttribute('aria-label') || '') : '';
    return (t + ' ' + extra).trim();
  }

  function index(id, card) {
    var set = byId.get(id);
    if (!set) byId.set(id, (set = new Set()));
    set.add(card);
  }
  function unindex(id, card) {
    var set = byId.get(id);
    if (set) { set.delete(card); if (!set.size) byId.delete(id); }
  }

  function handleLink(a, t0) {
    var id = idFromHref(a.getAttribute('href'));
    if (!id) return;
    var card = findCard(a);
    if (card) evaluate(card, id, a, t0);
  }

  // Decides whether one card is blocked and applies the result.
  function evaluate(card, id, link, t0) {
    var st = cardState.get(card);
    if (!st) { st = {}; cardState.set(card, st); }
    if (st.id !== id) {
      if (st.id) unindex(st.id, card);
      st.id = id; st.domText = null; st.domRes = null; st.logged = false;
      index(id, card);
    }
    var res = results.get(id);
    var src = 'intercepted data';
    if (!res) {
      // No data yet: match the visible title right now, re-check when data arrives.
      src = 'visible title (fallback)';
      var text = cardText(card, link || card.querySelector(CONFIG.videoLink));
      if (text !== st.domText) { st.domText = text; st.domRes = text ? matcher.match(text, '') : null; }
      res = st.domRes;
      if (!card.matches(SEL_SEQ)) pending.add(card);
    } else {
      pending.delete(card);
    }
    applyCard(card, st, id, res, src, t0);
  }

  function applyCard(card, st, id, res, src, t0) {
    var rv = reveals[id];
    // Upcoming Shorts: YouTube often sends their metadata only when they become
    // active, so an unclassified one stays hidden until its data arrives.
    if (!res && settings.enabled && rv !== 'video' && card.matches(SEL_SEQ)) {
      if (card.getAttribute(ATTR) !== 'pending') card.setAttribute(ATTR, 'pending');
      return;
    }
    if (settings.enabled && res && res.b && rv !== 'video') {
      var mode = rv === 'title' ? 'title' : '1';
      if (card.getAttribute(ATTR) !== mode) card.setAttribute(ATTR, mode);
      if (card.matches(SEL_SEQ)) { countBlocked(id); return; }   // CSS does the hiding
      var host = st.host && st.host.isConnected && card.contains(st.host) ? st.host : thumbHost(card);
      if (!st.overlay || st.overlay.parentNode !== host) {
        if (st.overlay) st.overlay.remove();
        st.overlay = newOverlay(false);
        st.host = host;
        if (host !== card || !card.matches(SEL_SELF)) host.setAttribute(ATTR_HOST, '');
        host.appendChild(st.overlay);
      }
      fillOverlay(st.overlay, id, res, st.domText || cardText(card, null));
      countBlocked(id);
      if (settings.debug && !st.logged) {
        st.logged = true;
        var r = results.get(id);
        var now = performance.now();
        log('blocked ' + id + ' in ' + (t0 ? (now - t0).toFixed(2) : '0.00') + ' ms via ' + src +
            (r && r.at && t0 ? ' (data was ready ' + Math.max(0, t0 - r.at).toFixed(0) + ' ms before the card appeared)' : '') +
            ' - matched "' + (res.t || '?') + '"', card);
      }
    } else {
      clearCard(card, st);
    }
  }

  function clearCard(card, st) {
    if (card.hasAttribute(ATTR)) card.removeAttribute(ATTR);
    if (st && st.overlay) { st.overlay.remove(); st.overlay = null; }
    if (st && st.host) { st.host.removeAttribute(ATTR_HOST); st.host = null; }
  }

  function reevaluateId(id, t0) {
    var set = byId.get(id);
    if (!set) return;
    set.forEach(function (card) {
      if (!card.isConnected) { set.delete(card); pending.delete(card); return; }
      evaluate(card, id, null, t0);
    });
    if (!set.size) byId.delete(id);
  }

  function recheckPending(t0) {
    pending.forEach(function (card) {
      if (!card.isConnected) { pending.delete(card); return; }
      var st = cardState.get(card);
      if (st && st.id) evaluate(card, st.id, null, t0);
    });
  }

  /* =====================================================================
   * 5. PLAYERS (watch page, Shorts, hover preview, miniplayer)
   *    Blocked -> covered, paused and muted. Media events are caught in the
   *    capture phase, so a blocked video is paused when play() is called,
   *    before any sound is produced.
   * ===================================================================== */

  // Which video a player shows. For the watch-page and Shorts players the URL
  // is the most up-to-date source (the player API can lag ~50 ms behind when
  // YouTube switches videos); other players (hover preview, miniplayer on a
  // non-watch page) use the id the page script read from the player API.
  function playerIds(p) {
    var ids = [];
    var u = isShortsPlayer(p) ? urlShortsId() : isWatchPlayer(p) ? urlWatchId() : null;
    if (u) ids.push(u);
    var v = p.getAttribute(ATTR_VID);
    if (v && v !== u) ids.push(v);
    if (!ids.length) {
      var a = p.querySelector('a.ytp-title-link');
      var t = a && idFromHref(a.getAttribute('href'));
      if (t) ids.push(t);
    }
    return ids;
  }
  // The id to act on: a blocked one if ANY source says blocked (sources can
  // lag each other by a few ms while YouTube switches videos), else the URL id.
  function playerId(p) {
    var ids = playerIds(p);
    for (var i = 0; i < ids.length; i++) {
      var r = results.get(ids[i]);
      if (settings.enabled && r && r.b && reveals[ids[i]] !== 'video') return ids[i];
    }
    return ids[0] || null;
  }

  function isWatchPlayer(p) { return p.id === 'movie_player' || !!p.closest(CONFIG.watchScope); }
  function isShortsPlayer(p) { return !!p.closest(CONFIG.shortsScope); }

  // Result for a video id, falling back to the visible title for players.
  function resultFor(id, p) {
    var r = results.get(id);
    if (r) return r;
    var text = '';
    if (p && isShortsPlayer(p)) {
      var reel = p.closest(CONFIG.shortsReel);
      text = firstText(reel || document, CONFIG.shortsTitle);
    } else if (p && isWatchPlayer(p) && id === urlWatchId()) {
      text = firstText(document, CONFIG.watchTitle);
    }
    return text ? matcher.match(text, '') : null;
  }

  function updatePlayer(p, reason) {
    var id = playerId(p);
    var st = playerState.get(p);
    if (!st) { st = { id: null, blocked: false, pausedByUs: false }; playerState.set(p, st); }
    var res = id ? resultFor(id, p) : null;
    var rv = id ? reveals[id] : null;
    var blocked = !!(settings.enabled && res && res.b && rv !== 'video');
    var videos = p.querySelectorAll('video');

    if (blocked) {
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        if (!v.paused) { v.pause(); st.pausedByUs = true; }
        if (!v.muted) { v.muted = true; v.setAttribute('data-gta6-muted', '1'); }
      }
      if (!st.overlay || st.overlay.parentNode !== p) {
        if (st.overlay) st.overlay.remove();
        st.overlay = newOverlay(true);
        p.appendChild(st.overlay);
      }
      var fb = isShortsPlayer(p) ? firstText(p.closest(CONFIG.shortsReel) || document, CONFIG.shortsTitle)
                                 : firstText(document, CONFIG.watchTitle);
      fillOverlay(st.overlay, id, res, fb);
      var reel = p.closest(CONFIG.shortsReel);
      if (reel) reel.setAttribute(ATTR_REEL, rv === 'title' ? 'title' : '1');
      if (!st.blocked || st.id !== id) {
        countBlocked(id);
        log('player blocked ' + id + ' (' + (reason || 'check') + ') - matched "' + (res.t || '?') + '"');
        if (isShortsPlayer(p) && settings.shortsMode === 'skip') skipShort(id);
      }
    } else {
      if (st.overlay) { st.overlay.remove(); st.overlay = null; }
      var reel2 = p.closest(CONFIG.shortsReel);
      if (reel2 && reel2.hasAttribute(ATTR_REEL)) reel2.removeAttribute(ATTR_REEL);
      // Undo our mute (set here or by the page script), and resume playback we
      // paused if the user revealed this video or the player moved on to an
      // allowed video.
      var resume = st.pausedByUs;
      for (var j = 0; j < videos.length; j++) {
        var w = videos[j];
        if (w.getAttribute('data-gta6-muted')) { w.muted = false; w.removeAttribute('data-gta6-muted'); }
        if ((resume || (reason === 'reveal' && st.blocked)) && w.paused) {
          var pr = w.play(); if (pr && pr.catch) pr.catch(function () {});
        }
      }
      st.pausedByUs = false;
    }
    st.blocked = blocked;
    st.id = id;
    if (isWatchPlayer(p)) updateWatchState(blocked ? id : null);
  }

  function updateAllPlayers(reason) {
    var players = document.querySelectorAll(CONFIG.player);
    for (var i = 0; i < players.length; i++) updatePlayer(players[i], reason);
    if (!players.length) updateWatchState(null);
  }

  // Hides the watch page title/description while its video is blocked.
  function updateWatchState(playerBlockedId) {
    var id = urlWatchId();
    var blockedId = playerBlockedId;
    if (!blockedId && id) {
      var r = results.get(id);
      if (settings.enabled && r && r.b && reveals[id] !== 'video') blockedId = id;
    }
    var root = document.documentElement;
    if (blockedId) {
      var mode = reveals[blockedId] === 'title' ? 'title' : '1';
      if (root.getAttribute(ATTR_WATCH) !== mode) root.setAttribute(ATTR_WATCH, mode);
    } else if (root.hasAttribute(ATTR_WATCH)) {
      root.removeAttribute(ATTR_WATCH);
    }
  }

  // Auto-skip option for Shorts: go to the next Short.
  function skipShort(id) {
    var tries = skipped.get(id) || 0;
    if (tries >= 3) return;
    skipped.set(id, tries + 1);
    setTimeout(safe(function () {
      if (urlShortsId() !== id) return;
      var btn = null;
      for (var i = 0; i < CONFIG.shortsNext.length && !btn; i++) btn = document.querySelector(CONFIG.shortsNext[i]);
      if (btn) btn.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
      log('auto-skipped Short ' + id);
      setTimeout(safe(function () { if (urlShortsId() === id) skipShort(id); }), 700);
    }), 120);
  }

  // Media events don't bubble, but capture listeners on document still see them.
  ['play', 'playing', 'loadstart', 'loadedmetadata', 'timeupdate', 'volumechange'].forEach(function (type) {
    document.addEventListener(type, safe(function (e) {
      var v = e.target;
      if (!v || v.tagName !== 'VIDEO') return;
      var p = v.closest(CONFIG.player);
      if (!p) return;
      var st = playerState.get(p);
      // Cheap path for frequent events on videos that are not blocked.
      if ((type === 'timeupdate' || type === 'volumechange') && st && !st.blocked && st.id === playerId(p)) return;
      updatePlayer(p, type);
    }), true);
  });

  /* =====================================================================
   * 6. USER ACTIONS on overlays (delegated, capture phase on window so
   *    YouTube never sees the click and never opens the video).
   * ===================================================================== */
  function act(action, ov) {
    var id = ov.getAttribute('data-vid');
    if (!id) return;
    reveals[id] = action === 'video' ? 'video' : 'title';
    saveReveals();
    syncBlocked([id], false);
    log('revealed ' + action + ' for ' + id);
    reevaluateId(id);
    updateAllPlayers('reveal');
  }

  var STOP_EVENTS = ['click', 'auxclick', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu'];
  STOP_EVENTS.forEach(function (type) {
    window.addEventListener(type, safe(function (e) {
      var t = e.target;
      var ov = t && t.closest ? t.closest('.gta6-overlay') : null;
      if (!ov) return;
      e.stopPropagation();
      if (type === 'click' || type === 'auxclick' || type === 'dblclick' || type === 'mousedown' || type === 'contextmenu') e.preventDefault();
      if (type === 'click') {
        var b = t.closest('[data-gta6-act]');
        if (b) act(b.getAttribute('data-gta6-act'), ov);
      }
    }), { capture: true, passive: false });
  });

  // Block hover previews (inline playback) on blocked cards.
  ['mouseover', 'mouseenter', 'pointerover', 'pointerenter', 'mousemove', 'pointermove', 'focusin'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      try {
        var t = e.target;
        if (t && t.closest && t.closest('[' + ATTR + ']')) e.stopPropagation();
      } catch (err) {}
    }, true);
  });

  /* =====================================================================
   * 7. DATA from the page script -> keyword match -> results Map
   *    The page script dispatches this event synchronously as soon as it has
   *    read a YouTube response, so classification happens right there,
   *    before YouTube renders anything from that response.
   * ===================================================================== */
  var recs = new Map();   // videoId -> { title, channel, text }
  // For troubleshooting from the content-script console only (not visible to the page).
  NS.state = { results: results, recs: recs, reveals: function () { return reveals; } };

  // Keeps the page script's "refuse play()" list equal to what is blocked now.
  var sentBlocked = new Set();
  function effectiveBlocked(id) {
    var r = results.get(id);
    return !!(settings.enabled && r && r.b && reveals[id] !== 'video');
  }
  function syncBlocked(ids, reset) {
    var add = [], remove = [];
    if (reset) {
      sentBlocked.clear();
      results.forEach(function (r, id) { if (effectiveBlocked(id)) { sentBlocked.add(id); add.push(id); } });
    } else {
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i], b = effectiveBlocked(id);
        if (b && !sentBlocked.has(id)) { sentBlocked.add(id); add.push(id); }
        else if (!b && sentBlocked.has(id)) { sentBlocked.delete(id); remove.push(id); }
      }
    }
    if (!reset && !add.length && !remove.length) return;
    try {
      document.dispatchEvent(new CustomEvent(EVT.block, { detail: JSON.stringify({ reset: !!reset, add: add, remove: remove }) }));
    } catch (e) {}
  }

  function classify(id, rec) {
    var res = matcher.match(rec.text, rec.channel);
    var prev = results.get(id);
    var r = { b: res.b ? 1 : 0, t: res.t || '', ti: rec.title, ch: rec.channel, at: prev ? prev.at : performance.now() };
    results.set(id, r);
    return !prev || prev.b !== r.b || prev.t !== r.t || prev.ti !== r.ti;
  }

  document.addEventListener(EVT.data, safe(function (e) {
    var t0 = performance.now();
    var msg = JSON.parse(e.detail);
    if (msg.reset) { recs.clear(); results.clear(); }
    var items = msg.items || [];
    var changed = [];
    var blocked = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var rec = recs.get(it.id);
      if (!rec) {
        rec = { title: '', channel: '', text: '' };
        recs.set(it.id, rec);
        if (recs.size > 8000) { var old = recs.keys().next().value; recs.delete(old); results.delete(old); }
      }
      if (it.ti) rec.title = it.ti;
      if (it.ch) rec.channel = it.ch;
      if (it.p && it.p.length) rec.text += it.p.join('\n') + '\n';
      if (classify(it.id, rec)) changed.push(it.id);
      if (settings.debug && results.get(it.id).b) blocked.push(it.id + ' (' + results.get(it.id).t + ')');
    }
    if (settings.debug && items.length) {
      log('classified ' + items.length + ' videos from ' + (msg.source || '?') + ' in ' + (performance.now() - t0).toFixed(2) + ' ms' +
          (blocked.length ? ' - blocked: ' + blocked.join(', ') : ''));
    }
    syncBlocked(changed, !!msg.reset);
    if (!document.documentElement) return;
    if (msg.reset) { rescanAll(t0); return; }
    for (var j = 0; j < changed.length; j++) reevaluateId(changed[j], t0);
    // A player may be waiting for this data.
    var players = document.querySelectorAll(CONFIG.player);
    for (var k = 0; k < players.length; k++) {
      var pid = playerId(players[k]);
      if (pid && results.has(pid)) updatePlayer(players[k], 'data');
    }
    updateWatchState(null);
  }));

  document.addEventListener(EVT.ready, function () { sendSettings(); });
  document.addEventListener(EVT.url, safe(function () { updateAllPlayers('url'); }));

  // Page script only needs the debug flag; "hello" asks it to resend all data.
  function sendSettings() {
    try {
      document.dispatchEvent(new CustomEvent(EVT.settings, { detail: JSON.stringify({ debug: !!settings.debug }) }));
      document.dispatchEvent(new CustomEvent(EVT.hello));
    } catch (e) {}
    syncBlocked(null, true);
  }

  /* =====================================================================
   * 8. DOM WATCHING - one MutationObserver, processed synchronously.
   *    Mutation callbacks run before the browser paints, so a card is
   *    covered in the same frame it is inserted.
   * ===================================================================== */
  // Ads/promos have no video id: key them by their element, decide from text.
  var textCardSeq = 0;
  function handleTextCard(card, t0) {
    var st = cardState.get(card);
    evaluate(card, (st && st.id) || 'ad-' + (++textCardSeq), null, t0);
  }

  function handleSeqThumb(el, t0) {
    var m = RE_THUMB_ID.exec(el.style.backgroundImage || '');
    if (m) evaluate(el, m[1], null, t0);
    else if (el.hasAttribute(ATTR)) clearCard(el, cardState.get(el));
  }

  function handleNode(n, t0) {
    if (n.tagName === 'A') { handleLink(n, t0); return; }
    if (n.matches(SEL_SEQ)) { handleSeqThumb(n, t0); return; }
    if (n.matches(SEL_TEXTCARD)) { handleTextCard(n, t0); return; }
    if (n.tagName === 'IMG' || n.tagName === 'YT-IMAGE') {
      // A thumbnail image appeared: its link may now qualify as a card.
      var la = n.closest(CONFIG.videoLink);
      if (la) handleLink(la, t0);
      return;
    }
    if (n.matches(CONFIG.player)) { updatePlayer(n, 'added'); return; }
    if (n.hasAttribute(ATTR_VID) && n.matches(SEL_CARD)) { evaluate(n, n.getAttribute(ATTR_VID), null, t0); return; }
    if (!n.firstElementChild) return;
    var list = n.querySelectorAll(SEL_LINK_OR_PLAYER);
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x.tagName === 'A') handleLink(x, t0);
      else if (x.matches(SEL_TEXTCARD)) handleTextCard(x, t0);
      else if (x.matches(SEL_SEQ)) handleSeqThumb(x, t0);
      else if (x.hasAttribute(ATTR_VID) && !x.matches(CONFIG.player)) evaluate(x, x.getAttribute(ATTR_VID), null, t0);
      else updatePlayer(x, 'added');
    }
  }

  var observer = new MutationObserver(safe(function (mutations) {
    var t0 = performance.now();
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'attributes') {
        var tg = m.target;
        if (m.attributeName === 'href') {
          if (tg.tagName === 'A') handleLink(tg, t0);
        } else if (m.attributeName === 'style') {
          if (tg.matches(SEL_SEQ)) handleSeqThumb(tg, t0);
        } else if (m.attributeName === ATTR_VID) {
          if (tg.matches(CONFIG.player)) updatePlayer(tg, 'video changed');
          else if (tg.matches(SEL_CARD)) evaluate(tg, tg.getAttribute(ATTR_VID), null, t0);
        }
        continue;
      }
      var added = m.addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1 || (n.classList && n.classList.contains('gta6-overlay'))) continue;
        handleNode(n, t0);
        // YouTube sometimes rebuilds a blocked card's thumbnail: put the overlay back.
        var bc = n.closest('[' + ATTR + ']');
        if (bc) {
          var st = cardState.get(bc);
          if (st && st.overlay && !st.overlay.isConnected) { st.overlay = null; evaluate(bc, st.id, null, t0); }
        }
      }
    }
    if (pending.size) recheckPending(t0);
    if (settings.debug) {
      var dt = performance.now() - t0;
      if (dt > 4) log('mutation batch took ' + dt.toFixed(2) + ' ms (' + mutations.length + ' mutations)');
    }
  }));

  function rescanAll(t0) {
    t0 = t0 || performance.now();
    var links = document.querySelectorAll(CONFIG.videoLink);
    for (var i = 0; i < links.length; i++) handleLink(links[i], t0);
    var seq = document.querySelectorAll(SEL_SEQ);
    for (var q = 0; q < seq.length; q++) handleSeqThumb(seq[q], t0);
    var ads = document.querySelectorAll(SEL_TEXTCARD);
    for (var a = 0; a < ads.length; a++) handleTextCard(ads[a], t0);
    var reels = document.querySelectorAll('[' + ATTR_VID + ']');
    for (var j = 0; j < reels.length; j++) {
      if (!reels[j].matches(CONFIG.player) && reels[j].matches(SEL_CARD)) evaluate(reels[j], reels[j].getAttribute(ATTR_VID), null, t0);
    }
    // Cards whose link disappeared or that are now allowed.
    var marked = document.querySelectorAll('[' + ATTR + ']');
    for (var k = 0; k < marked.length; k++) {
      var st = cardState.get(marked[k]);
      if (!st || !st.id) clearCard(marked[k], st);
      else evaluate(marked[k], st.id, null, t0);
    }
    updateAllPlayers('rescan');
    if (settings.debug) log('full page scan: ' + links.length + ' links in ' + (performance.now() - t0).toFixed(2) + ' ms');
  }

  /* =====================================================================
   * 9. SETTINGS (chrome.storage.sync) - applied instantly, no reload.
   * ===================================================================== */
  function applySettings(s) {
    var t0 = performance.now();
    var debugChanged = !!settings.debug !== !!(s && s.debug);
    settings = Object.assign({}, DEFAULTS, s || {});
    matcher = NS.buildMatcher(settings);
    recs.forEach(function (rec, id) { classify(id, rec); });   // re-check everything we know
    syncBlocked(null, true);
    if (debugChanged) sendSettings();
    log('settings applied: ' + matcher.size + ' terms, re-checked ' + recs.size + ' videos in ' + (performance.now() - t0).toFixed(1) + ' ms');
    if (document.documentElement) rescanAll();
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULTS, function (s) {
        if (chrome.runtime.lastError) return;
        safe(applySettings)(s);
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync') return;
        chrome.storage.sync.get(DEFAULTS, function (s) { safe(applySettings)(s); });
      });
    } catch (e) {}
  }

  /* ---------- session counter (sent to the background worker) ---------- */
  var countTimer = 0;
  function countBlocked(id) {
    if (counted.has(id)) return;
    counted.add(id);
    countQueue.push(id);
    if (!countTimer) {
      countTimer = setTimeout(function () {
        countTimer = 0;
        var ids = countQueue.splice(0);
        try { chrome.runtime.sendMessage({ type: 'gta6-blocked', ids: ids }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      }, 1000);
    }
  }

  /* =====================================================================
   * 10. START
   * ===================================================================== */
  function start() {
    injectStyles();
    observer.observe(document, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['href', 'style', ATTR_VID]
    });
    sendSettings();       // defaults first, so blocking works before storage answers
    loadSettings();

    // YouTube is a single-page app: re-scan on its navigation events.
    document.addEventListener('yt-navigate-start', safe(function () { updateAllPlayers('navigate-start'); }));
    document.addEventListener('yt-navigate-finish', safe(function () {
      try { document.dispatchEvent(new CustomEvent(EVT.annotate)); } catch (e) {}
      rescanAll();
    }));
    window.addEventListener('popstate', safe(function () { updateAllPlayers('popstate'); }));
    document.addEventListener('DOMContentLoaded', safe(function () { rescanAll(); }));
  }

  try { start(); } catch (e) { /* never break YouTube */ }
})();
