# Cadence Reading

Chrome (MV3) extension that rebuilds a Google Doc or PDF as clean DOM in a
full-screen overlay and reveals it character-by-character, with paragraph/section
pauses and comments sliding in from the gutter.

> **Why re-render?** Google Docs paints body text as a bitmap on `<canvas>` with
> no parallel DOM, so the Docs API is the only reliable source of text+structure.

Implements [`plan-rerender-with-comments-reader.md`](./plan-rerender-with-comments-reader.md).

## Sources

- **Google Docs** — `docs.google.com/document/d/{id}` (full formatting + comments). OAuth.
- **Drive PDFs** — `drive.google.com/file/d/{id}/view` (no comments). OAuth. See [`plan-pdf-reader.md`](./plan-pdf-reader.md).
- **Local PDFs** — drag/drop or pick a file in the reader page. In-browser only: **no upload, no OAuth.**

Docs/Drive are detected by tab URL; the local reader opens from the toolbar icon
on any other page. All sources build the same `.dr-char` / `.dr-para` DOM and
feed the shared reveal machinery. The reader landing page also lets you **paste a
link, drop a PDF, or browse your Google Drive** (a native file list via the Drive API —
Docs + PDFs, searchable), and lists recently-opened documents (title, note count, last
read) to resume or forget.

## Fidelity

The reader imposes its own typography (font, size, line height) but borrows the
author's *structure* from the document's visual layout, not from assumed conventions:

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

## Layout

```
extension/
  manifest.json
  vendor/pdfjs/          vendored PDF.js ESM build (pdf.mjs + worker)
  src/
    background.js        OAuth + Docs/Drive/PDF fetch RPC; toolbar trigger
    content.js           thin bootstrap; lazily imports session.js
    session.js           orchestrates a reading session
    sources.js           source detection + Docs / Drive-PDF / local-PDF strategies
    rpc.js               promise wrapper over chrome.runtime messaging
    settings.js          chrome.storage.sync settings + defaults
    overlay.js           builds overlay chrome (content column, gutter, HUD); theme
    dom.js               shared el() DOM-element helper
    bytes.js             base64 <-> Uint8Array
    api/docs.js          documents.get
    api/drive.js         comments.list (paged)
    api/pdf.js           Drive media fetch -> base64
    api/http.js          shared fetch helper (safeText)
    render/builder.js    Docs JSON -> overlay DOM; borrows the author's spacing/headings/indents
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
  reader/                local-PDF drop-zone page (no auth)
  styles/overlay.css
  options/               settings page
```

PDF.js (`vendor/pdfjs/`, pinned **4.10.38**, Apache-2.0) is vendored prebuilt, so
there's no build step. Its worker loads from a web-accessible URL; on CSP block
it falls back to main-thread parsing.

## OAuth setup (Docs / Drive only)

`chrome.identity.getAuthToken` needs a Google Cloud OAuth client tied to the
extension ID. Local PDFs work without any of this.

1. Load the unpacked extension to get its ID (or pin one via a `"key"` in `manifest.json`).
2. In [Google Cloud Console](https://console.cloud.google.com/): enable the **Docs** and **Drive** APIs, configure the OAuth consent screen (add yourself as a test user), and create an **OAuth client ID** (type *Chrome App / Extension*) with that ID.
3. Put the client ID in `manifest.json` → `oauth2.client_id`.

Scope `drive.readonly` covers both Docs reads and Drive comments; add
`documents.readonly` if the Docs API rejects it.

## Load it

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → the `extension/` dir.
2. **Doc / Drive PDF**: open it, click the toolbar icon or press **Ctrl/Cmd+Shift+R** (needs OAuth).
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
| `Esc` | End session |

`Cmd`/`Ctrl` shortcuts pass through (so `Cmd+F` / `Cmd+C` still work). Links —
in the doc body, comments, or notes — open on `Cmd`/`Ctrl`+click; a plain click
never navigates (it shows the comment, flashes the note card, or does nothing).

## Notes & highlights

A collapsible side panel of **highlight cards**:

- **Snippet cards** — select revealed text and click the **snip** button; the quote becomes a card with a focused note field, and its source stays highlighted in the doc.
- **Note cards** — free notes, inserted anywhere via the hover **`+`** between cards.

Notes edit in place with markdown-as-you-type (`**bold**`, `_italic_`, `` `code` ``,
`[text](url)`, `#`, `-`/`1.`) plus `Cmd/Ctrl+B/I/U`; links open on modifier-click.
Editing/snipping/deleting are undoable (`Cmd/Ctrl+Z`, `+Shift+Z`); delete needs a
confirming second click.

Card↔doc links are **two-way**: click a card to scroll+flash its source; click a
highlight to flash its card. Everything (cards, note text, caret) persists per URL
in `chrome.storage.local`; highlights re-anchor by matching the stored quote on
reload, including snippets that span several paragraphs or a list.

## Settings

Options page, persisted to `chrome.storage.sync`: `charsPerSec` (default 150),
`pauseAt`, `showResolvedComments`, `theme`, `fontFamily`. Changes apply live. A
**Stored page data** section lists every page with saved data — notes, highlights,
or just a reading position — and can delete one or clear all (with confirmation).

## Reading position

Reveal position resumes where you left off, saved continuously as you read (not only
at pauses, so a reload mid-reveal doesn't lose progress):

- **Docs / Drive PDFs** — saved per URL in `chrome.storage.local`; persists across reloads, tabs, and reopens.
- **Local PDFs** — saved by file name, so re-dropping the same file resumes. The file *bytes* live only in per-tab `sessionStorage` (a dropped file has no durable handle), so each tab is independent and you re-drop after closing it.

> `sessionStorage`'s ~5 MB quota means a PDF over ~3.5 MB may not survive a
> same-tab refresh (re-open it); the position itself is always saved.

## Tests

`npm test` runs `node --test` over `test/*.test.js` in jsdom — no build step.
Coverage: reveal layer (`loop`/`walker`/`chunker`/`scroller`/`focus`/`input`), PDF
pipeline (`extract`/`geometry`/`encodings`/`pdf-builder`), Docs render
(`builder`/`styles`/`lists`), notes, comments + sanitizer, shared utils, and two
e2e flows (full reveal chain; notes snip→persist→reload). Canvas/network/SW paths
(`pdf/loader`, `pdf/figures`, `api/*`, `rpc`, `background`) are verified by loading
a real document.

```
npm install   # once — installs jsdom
npm test
```

## Known limitations

- **Large docs.** One span per character. PDFs build lazily; a Doc builds its whole DOM up front, so ~50k-word docs create a lot at once.
- The doc renders on a light "paper" card in any theme (keeps authored colors faithful); theme controls surrounding chrome.
- Comment anchoring is by quoted-text match; duplicates resolve in document order.
- Equations/drawings (Docs) render as Google's flattened image; suggestions preview without markup.
- **PDFs**: bold/italic, headings, multi-column order, head/foot stripping, footnotes, sub/superscripts, and unmapped-glyph recovery are handled; figures/equations/tables are snapshotted inline. Scanned (no text layer) PDFs are refused — no OCR. Reading order is heuristic.
