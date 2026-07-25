# Cadence Reading

Chrome (MV3) extension that rebuilds a Google Doc or PDF as clean DOM in a
full-screen overlay and reveals it character-by-character, with paragraph/section
pauses and comments sliding in from the gutter.

> **Why re-render?** Google Docs paints body text as a bitmap on `<canvas>` with
> no parallel DOM, so the Docs API is the only reliable source of text+structure.

Implements [`plan-rerender-with-comments-reader.md`](./plan-rerender-with-comments-reader.md).

## Sources

- **Google Docs** — full formatting + comments + multi-tab docs.
- **Drive PDFs** — no comments. See [`plan-pdf-reader.md`](./plan-pdf-reader.md).
- **Local PDFs** — drag/drop or pick a file. In-browser only: **no upload, no OAuth.**

Google files open through the **Google Picker** under the non-sensitive `drive.file`
scope — the app only ever touches files you explicitly pick. Clicking the toolbar icon on
a Google Doc opens the reader with that doc's title primed in the Picker search; a
file you've opened before re-opens straight from **Recent** with no Picker (the grant
persists). The landing page also lets you **open from Google Drive** or **drop a PDF**,
and lists recently-opened documents (title, note count, last read) to resume or forget.
All sources build the same `.dr-char` / `.dr-para` DOM and feed the shared reveal
machinery. See [`plan-drive-file-picker.md`](./plan-drive-file-picker.md).

## Fidelity

The reader imposes its own typography (configurable font, width, line height, and paper
colours) but borrows the author's *structure* from the document's visual layout, not from
assumed conventions:

- **Chunking** follows visual gaps: a blank line or real paragraph spacing pauses; a
  tight run (metadata, list items Google renders flush) reveals as one unit. Long
  runs chunk dynamically (~7 wrapped lines, at sentence ends, never stranding a short tail).
- **Headings** — named styles, plus short paragraphs the author only sized up or bolded.
- **Indentation** — left indents (block quotes / nesting) and first-line indents carry
  through; a first-line indent also delimits a paragraph.
- **Lists** — bullet vs numbered inferred from the doc; spacing between items collapsed
  as Google renders it.
- **Tables** — the author's column widths (or even distribution), scrolling horizontally
  when wider than the paper.
- **Tabs** — a multi-tab Doc reads one tab at a time; a switcher in the HUD lists them,
  and each tab keeps its own reading position and notes.

## Layout

```
extension/
  manifest.json
  vendor/pdfjs/          vendored PDF.js ESM build (pdf.mjs + worker)
  src/
    background.js        OAuth (drive.file) + fetch RPC + Picker token; toolbar opens the reader
    session.js           orchestrates a reading session
    sources.js           source detection + Docs / Drive-PDF / local-PDF strategies
    gdocs.js             Google-file URL parse/synthesis + title cleanup (pure)
    rpc.js               promise wrapper over chrome.runtime messaging
    settings.js          chrome.storage.sync settings + defaults
    overlay.js           overlay chrome (content column, gutter, HUD + tab switcher); theme
    dom.js               shared el() DOM-element helper
    bytes.js             base64 <-> Uint8Array
    api/docs.js          documents.get (with tab content)
    api/drive.js         comments.list (paged) + text export + files.get name
    api/pdf.js           Drive media fetch -> base64
    api/http.js          shared fetch helper (safeText)
    render/builder.js    Docs JSON -> overlay DOM; borrows the author's spacing/headings/indents
    render/tabs-model.js Docs tabs -> the selected tab's content (pure)
    render/styles.js     textStyle/paragraphStyle -> inline CSS
    render/lists.js      bullet vs numbered glyph + numbering
    render/tables.js     <table> rendering; borrows the doc's column widths
    render/objects.js    inline images / drawings
    render/comments.js   quoted-text anchoring + callout DOM + allowlist sanitizer
    notes/panel.js       highlight-cards side panel (snips + notes + doc links)
    notes/snip.js        floating snip button tracking the reader selection
    notes/editing.js     contenteditable helpers (markdown, caret, formatting)
    notes/model.js       notes-model parse + undo/redo history
    notes/storage.js     per-doc notes + reveal-position persistence (chrome.storage.local)
    notes/markdown.js    markdown-as-you-type matchers (pure, testable)
    pdf/loader.js        PDF.js init
    pdf/extract.js       text items -> lines -> paragraphs (orchestrator)
    pdf/geometry.js      shared font/column/rotation numeric helpers
    pdf/glyphs.js        control-char remap + unmapped-glyph cropping
    pdf/regions.js       equation / rotated-table / upright-table detection
    pdf/figures-layout.js figure<->caption matching, image regions, inline placement
    pdf/diacritics.js    recompose overprinted spacing accents
    pdf/figures.js       page rasterizer + image-region ops (canvas)
    pdf/encodings.js     font glyph-name -> unicode map
    pdf/pdf-builder.js   blocks -> .dr-char/.dr-para DOM
    reveal/walker.js     ordered reveal-step list
    reveal/loop.js       rAF state machine (orchestrator)
    reveal/chunker.js    dynamic reveal chunking by the doc's visual line rhythm
    reveal/scroller.js   how the view follows the text
    reveal/focus.js      focus-mode dimming
    reveal/input.js      keyboard controls
  reader/                landing page: Drive Picker + PDF drop-zone + recents
    picker.js            popup handshake with the hosted Google Picker page
    handles.js           File System Access handles to re-open local PDFs (IndexedDB)
  styles/overlay.css
  options/               settings page (live preview)
docs/                    hosted Google Picker page (GitHub Pages; not bundled)
```

PDF.js (`vendor/pdfjs/`, pinned **4.10.38**, Apache-2.0) is vendored prebuilt, so
there's no build step. Its worker loads from the extension; on CSP block it falls back to
main-thread parsing.

The **Picker page** (`docs/`, served at `picker.bharatmunshi.cc` via GitHub Pages) is not
part of the extension bundle — MV3 forbids the remote Picker script in extension pages, so
the extension opens it in a popup and talks to it over `postMessage`. See
[`docs/README.md`](./docs/README.md).

## Google setup (Docs / Drive only)

Local PDFs need none of this. Google files use `chrome.identity` (OAuth client, scope
`drive.file` — **non-sensitive**, publishable without verification) plus the Google Picker.

1. Load the unpacked extension to get its ID (or pin one via a `"key"` in `manifest.json`).
2. In [Google Cloud Console](https://console.cloud.google.com/): enable the **Picker**,
   **Docs**, and **Drive** APIs; create an **OAuth client** (Chrome-extension type) for that
   ID with scope `drive.file`; create an **API key** restricted to the Picker API and
   referrer-locked to the Picker origin.
3. Put the client ID in `manifest.json` → `oauth2.client_id`; the API key + project number
   in `docs/index.html`; and set `PICKER_ORIGIN` in `reader/picker.js` to the hosted origin.
4. Host `docs/` (GitHub Pages).

See [`plan-drive-file-picker.md`](./plan-drive-file-picker.md).

## Load it

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → the `extension/` dir.
2. **Google Doc / Drive PDF**: on the doc, click the toolbar icon or press
   **Ctrl/Cmd+Shift+R** — the reader opens with the doc's title primed; pick it from the
   Picker. Or open the reader and click **Open from Google Drive**. Re-opening a past file
   is one click from **Recent** (no Picker).
3. **Local PDF**: click the toolbar icon on any other page, then drop/pick a PDF (no OAuth).

## Controls

| Key | Action |
| --- | --- |
| `Space` / `Enter` / `→` | Continue past a pause (hold to fast-forward) |
| `←` | Replay the current paragraph |
| `↓` / `↑` | Next / previous paragraph |
| `F` | Line focus (dim read text) |
| `B` | Bionic reading (embolden word starts) |
| `C` | Toggle comment callouts |
| `[` / `]` | Slower / faster |
| `Esc` | End session (back to the landing page) |

Multi-tab Docs get a tab switcher at the left of the HUD. `Cmd`/`Ctrl` shortcuts pass
through (so `Cmd+F` / `Cmd+C` still work). Links — in the doc body, comments, or notes —
open on `Cmd`/`Ctrl`+click; a plain click never navigates (it shows the comment, flashes
the note card, or does nothing).

## Notes & highlights

A collapsible side panel of **highlight cards**:

- **Snippet cards** — select revealed text and click the **snip** button; the quote becomes a card with a focused note field, and its source stays highlighted in the doc.
- **Note cards** — free notes, inserted anywhere via the hover **`+`** between cards.

Notes edit in place with markdown-as-you-type (`**bold**`, `_italic_`, `` `code` ``,
`[text](url)`, `#`, `-`/`1.`) plus `Cmd/Ctrl+B/I/U`; links open on modifier-click.
Editing/snipping/deleting are undoable (`Cmd/Ctrl+Z`, `+Shift+Z`); delete needs a
confirming second click.

Card↔doc links are **two-way**: click a card to scroll+flash its source; click a
highlight to flash its card. Everything (cards, note text, caret) persists per doc+tab
in `chrome.storage.local`; highlights re-anchor by matching the stored quote on
reload, including snippets that span several paragraphs or a list.

## Settings

Options page, persisted to `chrome.storage.sync`, applied live, with a live preview of the
reading surface:

- **Reveal** — `charsPerSec` (default 150); default state of **Focus**, **Bionic**, and
  **Comments** (keys still toggle them per session).
- **Appearance** — `theme` (auto/light/dark), a `fontFamily` override, line width, line
  height, and paper background/text colours — a separate colour pair for light and dark.

A **Stored page data** section lists every page with saved data — notes, highlights, or
just a reading position — and can delete one or clear all (with confirmation).

## Reading position

Reveal position resumes where you left off, saved continuously as you read (not only at
pauses, so a reload mid-reveal doesn't lose progress), keyed per document **and tab**:

- **Docs / Drive PDFs** — saved per canonical file id in `chrome.storage.local`; persists
  across reloads, tabs, and reopens. Re-fetching a picked file needs no re-pick (the
  `drive.file` grant persists).
- **Local PDFs** — saved by file name. On a supporting browser the file is remembered via a
  **File System Access handle** (in IndexedDB), so a **Recent** re-opens it from disk after a
  one-click permission grant; otherwise re-drop the file. Bytes for the current tab also
  live in `sessionStorage` for same-tab reloads.

## Tests

`npm test` runs `node --test` over `test/*.test.js` in jsdom — no build step.
Coverage: reveal layer (`loop`/`walker`/`chunker`/`scroller`/`focus`/`input`), PDF
pipeline (`extract`/`geometry`/`encodings`/`pdf-builder`), Docs render
(`builder`/`styles`/`lists`/`tabs-model`), Google-file helpers (`gdocs`/`sources`), notes,
comments + sanitizer, settings, shared utils, and two e2e flows (full reveal chain; notes
snip→persist→reload). Canvas/network/SW/Picker paths (`pdf/loader`, `pdf/figures`, `api/*`,
`rpc`, `background`, `reader/picker`, `reader/handles`) are verified by loading a real
document.

```
npm install   # once — installs jsdom
npm test
```

## Known limitations

- **Large docs.** One span per character. PDFs build lazily; a Doc builds its whole DOM up front, so ~50k-word docs create a lot at once.
- **Google Picker** is required to open a *new* file — paste-a-link and browse-all-files are gone under `drive.file`; re-opening a picked file/tab is not. The Picker runs on a separately hosted page.
- **Multi-tab Docs** open at the first tab (the Picker returns a file, not a tab); switch from the HUD. Comments anchor only within the shown tab.
- **Re-opening a local PDF** from Recent needs the File System Access API (Chromium); elsewhere, re-drop it.
- Comment anchoring is by quoted-text match; duplicates resolve in document order.
- Equations/drawings (Docs) render as Google's flattened image; suggestions preview without markup.
- **PDFs**: bold/italic, headings, multi-column order, head/foot stripping, footnotes, sub/superscripts, and unmapped-glyph recovery are handled; figures/equations/tables are snapshotted inline. Scanned (no text layer) PDFs are refused — no OCR. Reading order is heuristic.
```
