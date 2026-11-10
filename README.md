# GTA 6 Blocker

A Chrome extension that hides **GTA 6** videos, Shorts and spoilers on YouTube.

It checks each video's **title, description, tags, channel name and hashtags**. Matching videos are covered by a "Blocked by GTA 6 Blocker" overlay, with buttons to reveal the title or the video. GTA 5, GTA Online and older GTA games are **not** blocked.

Works on: home feed, search, the sidebar on watch pages, Shorts shelves, the full-screen Shorts player, channel pages, playlists, end screens, hover previews and the miniplayer. If you open a GTA 6 video directly, the player is covered and stays paused and muted.

> **Privacy:** everything runs locally in your browser. No tracking, no analytics, no remote code, and no network requests of its own. It only reads the data YouTube already sends to your browser.

---

## Install (about 1 minute)

1. On this GitHub page, click the green **Code** button → **Download ZIP**.
2. **Unzip** the downloaded file (right-click → *Extract All…* on Windows, double-click on Mac).
3. Open Chrome and type `chrome://extensions` in the address bar, then press Enter.
4. Turn on **Developer mode** (switch in the top-right corner).
5. Click **Load unpacked**.
6. Select the unzipped folder, the one that contains `manifest.json`.
7. Done. Open or reload YouTube. Click the puzzle-piece icon in Chrome's toolbar and pin **GTA 6 Blocker** to reach its settings quickly.

Keep the folder where it is. Chrome loads the extension from that folder, so deleting it removes the extension.

## Update

1. Download the new ZIP from this page and unzip it **over the old folder**, replacing the files (or into the same place).
2. Go to `chrome://extensions` and click the **reload icon** (↻) on the GTA 6 Blocker card.
3. Reload any open YouTube tabs.

Your settings are kept.

## Settings (click the extension icon)

- **On/off switch:** pause blocking without uninstalling.
- **Videos blocked this session:** a counter that resets when Chrome closes.
- **Shorts:** show the overlay (default), or skip blocked Shorts automatically.
- **Use the built-in list:** about 190 terms (spellings, characters, places, translations, filter tricks). Turn it off to use only your own words.
- **Extra words to block / Never block videos containing / Never block these channels:** one entry per line.
- **Advanced → Debug mode:** logs per-video detection times to the YouTube tab's console (press F12).

Changes apply instantly, with no need to reload YouTube. Settings sync through your Chrome account.

## How it works (short version)

- A small script reads the JSON that YouTube's own page loads (feeds, search, Shorts, player data) as it arrives, so videos are classified **before** they are drawn on screen. It never changes or delays YouTube's data.
- Each video is checked against one precompiled pattern, after normalizing the text: lowercase, accents removed, look-alike and "fancy font" letters folded, and dots, dashes and underscores treated like spaces.
- Words like "Jason", "Lucia" or "Vice City" only count when GTA-related words are nearby. "GTA Vice City" on its own (the 2002 game) is not blocked.
- Blocked cards are covered in the same frame they appear. Blocked videos are refused playback, so no sound starts.

The keyword list lives in [`src/keywords.js`](src/keywords.js), and all YouTube selectors are in one `CONFIG` object at the top of [`src/content.js`](src/content.js).

## Troubleshooting

- **Nothing is blocked:** reload the YouTube tab after installing or updating. Check that the switch in the popup is on, and that the extension is enabled in `chrome://extensions`.
- **"Manifest file is missing or unreadable":** you selected the wrong folder. Pick the folder that directly contains `manifest.json` (unzipping sometimes creates a folder inside a folder).
- **A video is blocked by mistake:** click **Reveal video** for a one-time view, or add the channel or a word to the "Never block" lists.
- **Something GTA 6 slipped through:** add the word under "Extra words to block". YouTube changes its page often; if whole sections stop being covered, please open an issue with the page URL.
- **Chrome shows a "Developer mode extensions" warning:** that's normal for extensions installed with Load unpacked. Click to dismiss it.
- **YouTube looks broken:** turn the extension off in the popup and reload. If that fixes it, please open an issue. The extension is built to fail safely and leave YouTube untouched.

## Permissions

- `storage`: saves your settings and the session counter.
- Access to `www.youtube.com` and `m.youtube.com` only.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. "Grand Theft Auto" and "GTA" are trademarks of their owners and are used here only to describe what the extension filters.
