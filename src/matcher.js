/*
 * GTA 6 Blocker - text normalization and keyword matching
 * -------------------------------------------------------
 * Loaded by the content script. Exposes:
 *   __GTA6B.normalize(text)          -> plain, comparable text
 *   __GTA6B.buildMatcher(settings)   -> { match(text, channel) }
 *
 * All keywords are compiled into ONE regular expression (one capture group
 * per term) when the matcher is built, so checking a video is a single regex
 * scan, not a loop over keywords.
 */
(function () {
  'use strict';
  var NS = (globalThis.__GTA6B = globalThis.__GTA6B || {});

  // Event names used between the page script and the content script.
  // The random suffix keeps them from clashing with anything on YouTube.
  NS.EVT = {
    data: 'gta6blocker-q7k2:data',         // page -> content: classification results
    settings: 'gta6blocker-q7k2:settings', // content -> page: new settings
    hello: 'gta6blocker-q7k2:hello',       // content -> page: "send me everything"
    ready: 'gta6blocker-q7k2:ready',       // page -> content: page script started
    url: 'gta6blocker-q7k2:url',           // page -> content: URL changed (pushState)
    annotate: 'gta6blocker-q7k2:annotate', // content -> page: re-tag players/reels
    block: 'gta6blocker-q7k2:block'        // content -> page: ids whose playback must be refused
  };

  /* ---------- Normalization ---------- */

  // Invisible characters people insert to break filters (zero-width spaces,
  // soft hyphens, bidi marks, variation selectors, tag characters ...).
  var INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|\uDB40[\uDC00-\uDDEF]/g;

  // Accents / combining marks to drop after NFD (Latin, Arabic harakat, keycaps ...).
  var MARKS = /[̀-ͯ҃-҉ً-ٰٟ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

  // Look-alike letters that NFKC does not fold (Cyrillic, Greek, small caps ...).
  var CONFUSABLES = {
    'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
    'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ї': 'i',
    'ј': 'j', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ѵ': 'v', 'ү': 'y', 'һ': 'h', 'ӏ': 'l',
    'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
    'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y', 'ϲ': 'c', 'ı': 'i', 'ℓ': 'l',
    'ɡ': 'g', 'ɢ': 'g', 'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f',
    'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o',
    'ᴘ': 'p', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y',
    'ᴢ': 'z', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe'
  };
  var CONFUSABLE_RE = new RegExp('[' + Object.keys(CONFUSABLES).join('') + ']', 'g');

  // Emoji letters: 🅐-🅩 (negative circled), 🅰-🆉 (negative squared), 🇦-🇿 (regional indicators).
  var EMOJI_LETTERS = /[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{1F1E6}-\u{1F1FF}]/gu;
  function emojiLetter(ch) {
    var c = ch.codePointAt(0);
    var base = c >= 0x1F1E6 ? 0x1F1E6 : c >= 0x1F170 ? 0x1F170 : 0x1F150;
    return String.fromCharCode(97 + c - base) + ' ';
  }

  // Non-ASCII decimal digits (Arabic-Indic, Persian, Devanagari, Bengali).
  var DIGITS = /[٠-٩۰-۹०-९০-৯]/g;
  function asciiDigit(ch) {
    var c = ch.charCodeAt(0);
    var base = c >= 0x09E6 ? 0x09E6 : c >= 0x0966 ? 0x0966 : c >= 0x06F0 ? 0x06F0 : 0x0660;
    return String(c - base);
  }

  // Everything that is not a letter, mark or digit becomes a single space
  // (spaces, dots, dashes, underscores, #, emoji, punctuation ...).
  var SEPARATORS = /[^\p{L}\p{M}\p{N}]+/gu;

  function normalize(input) {
    if (!input) return '';
    var s = String(input).replace(INVISIBLE, '');
    s = s.normalize('NFKC').toLowerCase();
    s = s.normalize('NFD').replace(MARKS, '').normalize('NFC');
    s = s.replace(CONFUSABLE_RE, function (ch) { return CONFUSABLES[ch]; });
    s = s.replace(EMOJI_LETTERS, emojiLetter).replace(DIGITS, asciiDigit);
    s = s.replace(SEPARATORS, ' ');
    // Join spaced-out single letters ("g t a 6") is handled in the pattern.
    return s;
  }
  NS.normalize = normalize;

  /* ---------- Pattern compilation ---------- */

  // Letters of "word" scripts. Used for word boundaries so that "gta 6" does
  // not match inside "gta 60" and "lucia" does not match inside "lucian".
  // CJK / Thai / Hangul etc. are left out on purpose: those languages glue
  // words together ("GTA6来了"), so no boundary is required there.
  var WORD = '\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{N}';
  var WORD_CHAR = new RegExp('[' + WORD + ']', 'u');
  var DIGIT_CHAR = /\p{N}/u;

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Acronyms whose letters may be spaced out ("g t a", "g.t.a.", "г т а").
  var SPACED_ACRONYMS = /^(gta|гta)(.*)$/;

  function tokenPattern(tok) {
    var m = SPACED_ACRONYMS.exec(tok);
    if (!m) return escapeRe(tok);
    var letters = m[1].split('').map(escapeRe).join(' ?');
    return m[2] ? letters + ' ?' + escapeRe(m[2]) : letters;
  }

  // Turns one keyword into a regex source string (or null if empty).
  function termPattern(term) {
    var n = normalize(term).trim();
    if (!n) return null;
    var body = n.split(' ').map(tokenPattern).join(' ?');
    var first = n.charAt(0);
    var last = n.charAt(n.length - 1);
    var pre = WORD_CHAR.test(first) ? '(?<![' + WORD + '])' : '';
    var post = DIGIT_CHAR.test(last) ? '(?!\\p{N})' : WORD_CHAR.test(last) ? '(?![' + WORD + '])' : '';
    return pre + body + post;
  }
  NS.termPattern = termPattern;

  // Compiles a plain list of words into one non-global "does any appear" regex.
  function anyOf(list) {
    var parts = [];
    (list || []).forEach(function (t) { var p = termPattern(t); if (p) parts.push(p); });
    return parts.length ? new RegExp(parts.join('|'), 'u') : null;
  }

  function cleanList(list) {
    return (Array.isArray(list) ? list : [])
      .map(function (s) { return String(s || '').trim(); })
      .filter(function (s) { return s && s.length <= 200; })
      .slice(0, 500);
  }

  var CONTEXT_WINDOW = 100; // characters on each side of a "context" match

  /*
   * settings: { useBuiltin, customKeywords[], allowKeywords[], allowChannels[] }
   */
  function buildMatcher(settings) {
    settings = settings || {};
    var entries = [];        // { label, mode, ctx, pattern }
    var seen = Object.create(null);

    function add(label, mode, ctx) {
      var p = termPattern(label);
      if (!p || seen[p]) return;
      seen[p] = true;
      entries.push({ label: label, mode: mode, ctx: ctx || null, pattern: p });
    }

    if (settings.useBuiltin !== false) {
      (NS.KEYWORD_GROUPS || []).forEach(function (g) {
        g.terms.forEach(function (t) { add(t, g.mode, g.context); });
      });
    }
    cleanList(settings.customKeywords).forEach(function (t) { add(t, 'always'); });

    // Longest patterns first so the most specific term is reported.
    entries.sort(function (a, b) { return b.pattern.length - a.pattern.length; });

    var re = entries.length
      ? new RegExp(entries.map(function (e) { return '(' + e.pattern + ')'; }).join('|'), 'gu')
      : null;

    var ctx = {};
    Object.keys(NS.CONTEXT || {}).forEach(function (k) { ctx[k] = anyOf(NS.CONTEXT[k]); });
    var older = anyOf(NS.OLDER_GTA);
    var allowRe = anyOf(cleanList(settings.allowKeywords));
    var allowChannels = cleanList(settings.allowChannels).map(normalize).map(function (s) { return s.trim(); }).filter(Boolean);

    function contextOk(text, index, length, ctxName) {
      var cre = ctx[ctxName] || ctx.gta;
      if (!cre) return false;
      // Look around the match, but not at the match itself.
      var around = text.slice(Math.max(0, index - CONTEXT_WINDOW), index) + ' | ' +
                   text.slice(index + length, index + length + CONTEXT_WINDOW);
      if (!cre.test(around)) return false;
      if (older && older.test(around) && !(ctx.gta6 && ctx.gta6.test(around))) return false;
      return true;
    }

    /*
     * match(text, channel) -> { b: true, t: "GTA VI" } | { b: false }
     * text: everything we know about the video (title, description, tags ...).
     */
    function match(text, channel) {
      if (!re || !text) return { b: false };
      var n = normalize(text);
      if (!n.trim()) return { b: false };

      if (allowChannels.length && channel) {
        var ch = normalize(channel).trim();
        for (var i = 0; i < allowChannels.length; i++) {
          if (ch === allowChannels[i] || (allowChannels[i].length > 3 && ch.indexOf(allowChannels[i]) !== -1)) {
            return { b: false, allowed: true };
          }
        }
      }
      if (allowRe && allowRe.test(n)) return { b: false, allowed: true };

      re.lastIndex = 0;
      var m, contextHit = null;
      while ((m = re.exec(n)) !== null) {
        var idx = 1;
        while (idx < m.length && m[idx] === undefined) idx++;
        var e = entries[idx - 1];
        if (e.mode === 'always') return { b: true, t: e.label };
        if (!contextHit && contextOk(n, m.index, m[0].length, e.ctx)) contextHit = e;
        if (m[0].length === 0) re.lastIndex++;
      }
      return contextHit ? { b: true, t: contextHit.label } : { b: false };
    }

    return { match: match, size: entries.length };
  }
  NS.buildMatcher = buildMatcher;

  NS.builtinCount = function () {
    var n = 0;
    (NS.KEYWORD_GROUPS || []).forEach(function (g) { n += g.terms.length; });
    return n;
  };
})();
