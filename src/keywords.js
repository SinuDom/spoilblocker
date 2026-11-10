/*
 * GTA 6 Blocker - default keyword list
 * ------------------------------------
 * Loaded by the content script (and the popup, for the term count). It only
 * defines plain data on a namespace object.
 *
 * How entries are written:
 *  - Write terms in plain text. matcher.js normalizes them the same way as
 *    video text (lowercase, NFKC, no accents, look-alike letters -> plain
 *    letters, any punctuation -> a space), so "GTA 6" also matches "gta6",
 *    "GTA-6", "G.T.A. 6", "gta_6", "#GTA6", "ＧＴＡ６", "𝐆𝐓𝐀 𝟔" ...
 *  - Spaces in a term are optional in the text ("grand theft auto 6" also
 *    matches "grandtheftauto6"), and the letters of "GTA" may be spaced out.
 *  - Terms ending in a digit also match when letters follow directly
 *    ("#gta6trailer", "gta 6th"), but never when more digits follow ("gta 60fps").
 *
 * Every group has a mode:
 *  - "always"  : block whenever the term appears.
 *  - "context" : block only when a context word (see CONTEXT below) appears
 *                within ~100 characters of the term. Used for common words such
 *                as "Jason", "Lucia" or "Vice City". Context matches are also
 *                ignored when the surrounding text is about an OLDER GTA game
 *                (GTA 5 / GTA Online / San Andreas ...) and nothing 6-specific
 *                is nearby.
 *
 * Sources for names/places: Rockstar's official GTA VI trailers (Dec 2023,
 * May 2025) and the character/location pages on rockstargames.com/VI.
 */
(function () {
  'use strict';
  var NS = (globalThis.__GTA6B = globalThis.__GTA6B || {});

  /* Context word lists used by "context" groups. */
  NS.CONTEXT = {
    // Anything that says "this is about GTA".
    gta: [
      'gta', 'grand theft auto', 'rockstar', 'rockstar games', 'rockstar north',
      'take two', 'take 2 interactive', 'leonida', 'vice city', 'jason duval',
      'lucia caminos', 'гта', 'グラセフ', '侠盗猎车手', '俠盜獵車手', '侠盗飞车',
      'قراند', 'جراند', 'جي تي اي', 'जीटीए', '그타', 'trailer 2', 'trailer 3'
    ],
    // Something that points at the NEW game specifically (used for "Vice City",
    // because "GTA Vice City" on its own is the 2002 game).
    gta6: [
      'leonida', 'lucia', 'jason', 'duval', 'caminos', '2025', '2026', '2027',
      'trailer 2', 'trailer 3', 'next gta', 'new gta', 'upcoming gta',
      'gta 6', 'gta vi', 'grand theft auto vi', 'boobie ike', 'real dimez',
      'port gellhorn', 'grassrivers', 'kalaga'
    ],
    // GTA words plus general gaming words (used for place names).
    game: [
      'gta', 'grand theft auto', 'rockstar', 'take two', 'vice city',
      'lucia', 'jason', 'trailer', 'gameplay', 'game', 'map', 'leak', 'leaked',
      'open world', 'ps5', 'xbox', 'mission', 'easter egg', 'gamer', 'gaming'
    ]
  };

  /* Text about older games. Context matches near these are ignored unless a
     "gta6" context word is also nearby. Always-block terms are NOT affected. */
  NS.OLDER_GTA = [
    'gta 5', 'gta v', 'gtav', 'gta five', 'gta online', 'gta 4', 'gta iv',
    'gta 3', 'gta iii', 'san andreas', 'vice city stories', 'liberty city stories',
    'definitive edition', 'gta trilogy', 'chinatown wars', 'gta rp', 'fivem',
    'grand theft auto v', 'grand theft auto iv', 'grand theft auto 5', 'gta 2',
    '2002', 'remaster', 'remastered'
  ];

  NS.KEYWORD_GROUPS = [
    /* ---------- 1. The name itself ---------- */
    {
      group: 'Name - spellings',
      mode: 'always',
      terms: [
        'GTA 6', 'GTA VI', 'GTA Six', 'GTA 6ix',
        'Grand Theft Auto 6', 'Grand Theft Auto VI', 'Grand Theft Auto Six',
        'Grand Theft Auto VI Trailer', 'GTA Online 2', 'GTA VI Online'
        // Covered automatically by normalization: GTA6, GTAVI, GTA-6, GTA_6,
        // G.T.A. 6, G T A 6, GTA.VI, GrandTheftAuto6, ＧＴＡ６, GTA Ⅵ, GTA ⑥ ...
      ]
    },
    {
      group: 'Name - common topics',
      mode: 'always',
      terms: [
        'GTA 6 trailer', 'GTA 6 trailer 2', 'GTA 6 trailer 3', 'GTA 6 leak',
        'GTA 6 leaks', 'GTA 6 leaked', 'GTA 6 gameplay', 'GTA 6 release date',
        'GTA 6 map', 'GTA 6 price', 'GTA 6 PS5', 'GTA 6 PC', 'GTA 6 Xbox',
        'GTA 6 delay', 'GTA 6 delayed', 'GTA 6 pre order', 'GTA 6 preorder',
        'GTA 6 news', 'GTA 6 countdown', 'GTA 6 reaction', 'GTA 6 trailer reaction',
        'GTA 6 online', 'GTA 6 characters', 'GTA 6 story', 'GTA 6 ending',
        'GTA 6 spoilers', 'GTA VI release date', 'GTA VI gameplay', 'GTA VI leak'
      ]
    },
    {
      group: 'Name - hashtags (glued words)',
      mode: 'always',
      terms: [
        '#GTA6', '#GTAVI', '#GTA6Trailer', '#GTA6Leaks', '#GTA6News',
        '#GTA6Gameplay', '#GTAVITrailer', '#GTAVINews', '#GTAVIOnline',
        '#GrandTheftAutoVI', '#GrandTheftAuto6', '#GTA6Online', '#GTA6Map',
        '#GTA6Update', '#GTA6PS5', '#RockstarGTA6', '#NewGTA6', '#GTA6Hype'
      ]
    },
    {
      group: 'Name - misspellings',
      mode: 'always',
      terms: [
        'GTA VL', 'Grand Theft Auto VL', 'Grand Thef Auto 6', 'Grand Theif Auto 6',
        'Grand Thief Auto 6', 'Grand Theft Otto 6', 'Gran Theft Auto 6',
        'Grand Theft Autos 6', 'Grand Theft Auto 6ix', 'Grande Theft Auto 6',
        'GTA 6 trailer leak'
      ]
    },

    /* ---------- 2. Filter-dodging tricks ---------- */
    {
      group: 'Tricks - numbers and letters',
      mode: 'always',
      terms: [
        // Unicode look-alikes (𝐆𝐓𝐀 𝟔, ɢᴛᴀ ᴠɪ, Cyrillic "GТА", 🅖🅣🅐, 🇬🇹🇦 ...) and
        // zero-width characters are handled by normalization in matcher.js.
        'GTA six', 'GTA sixx', 'GTA siks', 'GTA 6 six', 'G T A six',
        'GTA б', 'GTA Ⅵ', 'GTA 5 plus 1', 'GTA five plus one'
      ]
    },

    /* ---------- 3. Characters (official) ---------- */
    {
      group: 'Characters - full names (distinctive)',
      mode: 'always',
      terms: [
        'Jason Duval', 'Lucia Caminos', 'Boobie Ike', "Dre'Quan Priest",
        'DreQuan Priest', 'Real Dimez', 'Bae-Luxe', 'Bae Luxe and Roxy',
        'Jason and Lucia Duval', 'Jason and Lucia', 'Lucia and Jason', 'Jason & Lucia'
      ]
    },
    {
      group: 'Characters - need context',
      mode: 'context',
      context: 'gta',
      terms: [
        'Jason', 'Lucia',
        'Cal Hampton', 'Raul Bautista', 'Raul Batista', 'Brian Heder',
        "Dre'Quan", 'Boobie', 'Lucia trailer', 'Jason trailer'
      ]
    },

    /* ---------- 4. Places (official) ---------- */
    {
      group: 'Places - fictional names (distinctive)',
      mode: 'always',
      terms: [
        'Leonida Keys', 'State of Leonida', 'Leonida Man', 'Port Gellhorn',
        'Grassrivers', 'Mount Kalaga', 'Mount Kalaga National Park',
        'Kalaga National Park', 'Vice City 2026', 'Welcome to Leonida'
      ]
    },
    {
      group: 'Places - need context',
      mode: 'context',
      context: 'game',
      terms: ['Leonida', 'Kalaga', 'Grass Rivers', 'Ambrosia', 'Vice Beach']
    },
    {
      group: 'Vice City - only with GTA 6 context',
      mode: 'context',
      context: 'gta6',
      terms: ['Vice City', 'New Vice City', 'Modern Vice City', 'Vice City return', 'Vice City map']
    },

    /* ---------- 5. Trailer / in-game content ---------- */
    {
      group: 'Trailer and in-game content - need context',
      mode: 'context',
      context: 'gta',
      terms: [
        'Love Is A Long Road',   // Trailer 1 song (Tom Petty)
        'Hot Together',          // Trailer 2 song (The Pointer Sisters)
        'Only Raw Records',      // Boobie Ike / Dre'Quan record label
        'Jack of Hearts',        // Boobie Ike's club
        'Leonida trailer', 'trailer 3', 'new trailer', 'third trailer',
        'second trailer', 'launch trailer', 'release date', 'Rockstar new game'
      ]
    },

    /* ---------- 6. Translations and transliterations ---------- */
    {
      group: 'Translations - European languages',
      mode: 'always',
      terms: [
        'GTA sechs',            // German
        'GTA seis',             // Spanish / Portuguese
        'GTA sei',              // Italian
        'GTA zes',              // Dutch
        'GTA sześć',            // Polish
        'GTA altı',             // Turkish
        'GTA šest',             // Czech / Slovak / Croatian
        'Grand Theft Auto sechs', 'Grand Theft Auto seis'
      ]
    },
    {
      group: 'Translations - Russian / Ukrainian',
      mode: 'always',
      terms: [
        'ГТА 6', 'ГТА VI', 'ГТА шесть', 'ГТА шість', 'Гранд Тефт Авто 6',
        'Гранд Тефт Ауто 6', 'Гранд Тэфт Авто 6', 'Grand Theft Auto 6 трейлер'
      ]
    },
    {
      group: 'Translations - Arabic / Persian',
      mode: 'always',
      terms: [
        'جي تي اي 6', 'جي تي أي 6', 'جي تي ايه 6', 'قراند 6', 'جراند 6',
        'قراند ثفت اوتو 6', 'جراند ثفت أوتو 6', 'جراند ثيفت أوتو 6',
        'جی تی ای 6', 'جی تی ای ۶', 'قراند ٦'
      ]
    },
    {
      group: 'Translations - Hindi',
      mode: 'always',
      terms: ['जीटीए 6', 'जी टी ए 6', 'जीटीए सिक्स', 'ग्रैंड थेफ्ट ऑटो 6', 'ग्रैंड थेफ़्ट ऑटो 6']
    },
    {
      group: 'Translations - Japanese',
      mode: 'always',
      terms: [
        'グラセフ6', 'グラセフVI', 'グラセフ 6', 'グランド・セフト・オート6',
        'グランドセフトオート6', 'グランド・セフト・オートVI', 'グラセフ新作'
      ]
    },
    {
      group: 'Translations - Korean',
      mode: 'always',
      terms: ['그타 6', '그타6', '그타 VI', '지티에이 6', '그랜드 테프트 오토 6', '그랜드 세프트 오토 6', 'GTA 식스']
    },
    {
      group: 'Translations - Chinese',
      mode: 'always',
      terms: [
        '侠盗猎车手6', '侠盗猎车手VI', '俠盜獵車手6', '俠盜獵車手VI',
        '侠盗飞车6', '俠盜飛車6', '侠盗猎车6', '侠盗猎车手 6 预告'
      ]
    },
    {
      group: 'Translations - other scripts',
      mode: 'always',
      terms: ['จีทีเอ 6', 'জিটিএ 6', 'ஜிடிஏ 6', 'גי טי איי 6']
    }
  ];
})();
