# Plan C — PDF Reader (char-by-char) for Drive-hosted PDFs

Extends the re-rendered reader (Plan B) to PDFs. A PDF is fetched, parsed
with PDF.js, and reconstructed into the **same `.dr-char` / `.dr-para` DOM**
the Docs builder produces — so the entire reveal stack (walker, loop, input,
overlay, HUD, settings) is reused unchanged. Only the *source* and the
*builder* are new.

## Scope (agreed)

- **In:** accurate text extraction, char-by-char reveal, pause every
  paragraph. Headings recognized as headings (for structure only — exact
  level / font / size not reproduced). **Bold and italic preserved.** Tables
  and figures emitted **as cropped image snippets** in reading position.
- **Out:** highlights, comments/annotations. Exact heading strength, font
  face, font size. Editable tables. OCR of scanned (image-only) PDFs.

## Goals

- Reuse the existing reveal machinery verbatim; add a PDF path behind a
  source-detection seam in the session.
- Extract text accurately for digitally-authored PDFs (embedded text layer),
  including word spacing, line joins, and de-hyphenation across line breaks.
- Segment into paragraphs and detect headings from layout heuristics.
- Preserve bold/italic from font information.
- Render figures and tables as image snippets cropped from a rasterized page,
  inserted as single instant reveal steps (same mechanism as Docs inline
  images).

## Non-goals

- Pixel-fidelity to the original PDF layout.
- Reconstructing table structure as real tables (we snapshot the region).
- Multi-column perfection. Best-effort 1–2 column ordering; complex layouts
  may read out of order.
- Reading scanned/image-only PDFs (no text layer → graceful message).

## What is reused as-is

Everything downstream of the built DOM is source-agnostic — it operates on
`.dr-char` spans inside `.dr-para` containers:

- `reveal/walker.js`, `reveal/loop.js`, `reveal/input.js`
- `overlay.js`, `styles/overlay.css`, `settings.js`, `options/`
- `render/comments.js` is simply not invoked for PDFs (out of scope); the
  gutter stays empty / hidden.

`session.js` gains a small seam: detect source from the URL → choose fetcher
+ builder. ~80% unchanged.

## Source & auth

PDFs in scope are **Drive-hosted PDFs** opened in Drive's viewer:
`https://drive.google.com/file/d/{fileId}/view`. This:

- Runs on `drive.google.com`, a normal HTML page where our overlay can mount.
- Reuses the **existing `drive.readonly` OAuth scope** — no new consent.
- Fetches bytes via the Drive media endpoint:
  `GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`.

The fetch happens in the **background** worker (extension origin bypasses CORS
via `host_permissions`), then the bytes are handed to the content script. To
avoid messaging-serialization pitfalls with `ArrayBuffer`, the background
returns the bytes **base64-encoded** over the existing RPC; the content script
decodes to a `Uint8Array` for PDF.js. (Acceptable ~33% transfer overhead; see
Risks for the large-file note.)

Direct `.pdf` URLs in Chrome's built-in PDF plugin are **out of scope** for v1
(content scripts don't run in the native viewer) — noted as a stretch.

## PDF.js

Vendor the prebuilt ESM build of `pdfjs-dist` into
`extension/vendor/pdfjs/` (`pdf.mjs` + `pdf.worker.mjs`) so the project keeps
its **no-build-step, pure-ESM** property.

- `GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs')`.
- Add `vendor/pdfjs/*` to `web_accessible_resources`.

PDF.js gives us, per page:

- `page.getTextContent()` → text items: `{ str, transform:[a,b,c,d,e,f],
  width, height, fontName, hasEOL }` and a `styles` map. Position is
  `x = e`, `y = f`; font size ≈ `sqrt(a²+b²)` (≈ `d`).
- `page.commonObjs.get(fontName)` / the PostScript font name → bold/italic.
- `page.getOperatorList()` → image-draw ops (`paintImageXObject`) with
  transforms (figure bounding boxes), and path ops (ruling lines / vector
  density) for table/figure region detection.
- `page.render({ canvasContext, viewport })` → rasterize for cropping.

## Architecture

```
extension/
  vendor/pdfjs/            pdf.mjs, pdf.worker.mjs (vendored)
  src/
    api/pdf.js             background: fetch Drive media bytes -> base64
    pdf/
      loader.js            init PDF.js, load document from bytes
      extract.js           per-page: text items + image/vector ops
      layout.js            lines -> paragraphs, headings, columns, block order
      snippets.js          rasterize page, crop figure/table regions to <img>
      pdf-builder.js       ordered blocks -> .dr-char/.dr-para DOM
    session.js             + source detection seam (Docs vs PDF)
```

The PDF builder's contract is identical to the Docs builder: it fills the
overlay content column with `.dr-para` blocks of `.dr-char` spans (real text
chars normal; figures/tables as one `data-instant` char), tagged with
`data-paragraph-index`. The walker/loop then work with no changes.

## Implementation details

### 1. Fetch (`api/pdf.js`)

`fetchPdfBytes(fileId)` in the background: `withToken` → GET media endpoint →
`arrayBuffer()` → base64 string. New RPC handler + `rpc.js` wrapper. Session
detects the Drive URL, extracts `fileId`, calls it, decodes to `Uint8Array`.

### 2. Load (`pdf/loader.js`)

Import vendored `pdf.mjs`, set `workerSrc`, `getDocument({ data: bytes })`.
If `getTextContent()` yields effectively no text across the first N pages →
**image-only PDF**; show a HUD message ("No text layer — scanned PDF") and
stop. (No OCR.)

### 3. Extract (`pdf/extract.js`)

Per page, return:
- `items[]`: `{ str, x, y, w, fontSize, bold, italic, eol }` in the page's
  raw order (y from `transform`, converted top-down via the page viewport).
  - `bold = /bold|black|heavy|semibold/i.test(fontName)`
  - `italic = /italic|oblique/i.test(fontName)`
  - (font descriptor flags used too if cheaply available; name string is the
    primary, robust signal.)
- `images[]`: `{ bbox }` from `paintImageXObject` transforms.
- `vectorRegions[]`: bounding boxes of dense path-op clusters (table ruling
  lines / vector drawings), best-effort.

### 4. Layout (`pdf/layout.js`) — the heuristic core

Per page:

1. **Lines.** Sort items by y (top→down); cluster items whose baselines are
   within `~0.5 × fontSize` into a line; sort each line's items by x.
2. **Spaces.** Use `hasEOL` for line ends. Within a line, insert a space when
   the x-gap to the next item exceeds `~0.25 × fontSize` (PDF.js often omits
   spaces).
3. **De-hyphenation.** If a line ends in `-` and the next line continues a
   word, join without the hyphen.
4. **Columns.** Histogram line x-starts; if two non-overlapping x clusters
   dominate, treat as 2 columns and order col-1 top→down, then col-2.
   Otherwise single column. (Guarded; complex layouts may misorder.)
5. **Paragraphs.** Break between lines when the vertical gap exceeds the
   median line spacing by a margin (extra leading), or on a clear first-line
   indent change. Consecutive lines otherwise join with a space.
6. **Headings.** Compute body font size = mode of item sizes across the doc.
   A line whose size is `> ~1.2 ×` body (optionally also bold + short) becomes
   a heading block. Mapped to a single generic heading style — we do **not**
   reproduce the level/size.
7. **Header/footer stripping.** Drop lines near the top/bottom margin whose
   text repeats at the same y across pages (running heads, page numbers).
   v1: optional, behind a simple repeat detector.

Output: an ordered list of **blocks** per page —
`{ kind: 'paragraph', lines, heading?: bool }` and
`{ kind: 'image', bbox }` (figures) / `{ kind: 'table', bbox }` (vector
regions) — each with a y (and column) so blocks interleave in true reading
order.

### 5. Snippets (`pdf/snippets.js`)

Rasterize each page once to an offscreen canvas at a chosen scale
(`page.render`). For each image/table block, crop its `bbox` (page coords →
canvas pixels) into a small canvas → `toDataURL('image/png')`. Returns an
`<img>` sized to the block's layout box.

### 6. Build (`pdf/pdf-builder.js`)

For the ordered blocks across all pages:

- **paragraph block** → a `.dr-para` (`<h2>`-ish class `dr-pdf-heading` if a
  heading, else `<p>`), `data-paragraph-index` incremented. Each character →
  `<span class="dr-char">`, adding `dr-bold` / `dr-italic` classes per the
  item's flags. Spaces are normal chars.
- **image / table block** → a `.dr-para` containing the cropped `<img>` wrapped
  in `<span class="dr-char dr-inline-object" data-instant="true">` — revealed
  as one instant step, exactly like Docs inline images.
- **page boundary** → insert a `dr-section-break` marker (subtle divider +
  optional stronger pause).

The walker then emits a paragraph pause after every block (free), satisfying
"wait for a prompt every paragraph."

### 7. Session seam (`session.js`)

```
docs.google.com/document/d/{id}  -> Docs path  (existing)
drive.google.com/file/d/{id}     -> PDF path   (new)
```

Detect, pick fetcher + builder, then run the shared overlay/walker/loop/input
exactly as today. For PDFs, skip comment anchoring and hide the gutter.

### 8. Manifest changes

- Content-script `matches`: add `https://drive.google.com/file/*`.
- `web_accessible_resources`: add `vendor/pdfjs/*` and `src/pdf/*.js`.
- `host_permissions`: already covers `www.googleapis.com` (media fetch).
- Background `startSessionInActiveTab` URL guard: also match Drive file URLs.

## Test plan

1. Single-column text PDF — paragraphs segment, accurate text, char reveal,
   pause each paragraph.
2. Headings (size jumps) — recognized and visually distinct.
3. Bold/italic runs — styled correctly.
4. Embedded figure — cropped image appears in reading position, instant step.
5. Table — snapshot image inserted in place (best-effort).
6. Multi-page — page-break dividers; reveal continues across pages.
7. Two-column PDF — reading order correct for simple cases (note limits).
8. Hyphenated line breaks — words rejoined, no stray hyphens.
9. Scanned/image-only PDF — graceful "no text layer" message, no crash.
10. Large PDF (e.g. 100+ pages) — initial paint acceptable; consider lazy
    per-page build (see Risks).

## Risks & open questions

- **Reading order in complex/multi-column layouts** — heuristic and the main
  accuracy risk. v1 handles 1–2 column; documents with sidebars, footnotes, or
  rotated text may misorder.
- **Table/vector region detection** — best-effort via path-op density. When it
  fails, table text flows as (possibly jumbled) paragraph text instead of a
  snapshot. Reliable table detection is out of scope.
- **Bold/italic from font names** — usually reliable; subset-embedded fonts
  with opaque names (e.g. `ABCDEF+F1`) can defeat the regex. Fall back to
  descriptor flags where available.
- **Scanned PDFs** — no text layer; detected and refused (no OCR).
- **Bytes transfer** — base64 over RPC is simple and robust but memory-heavy
  for very large PDFs; if it bites, switch to a `chrome.runtime.connect` port
  with chunked/structured-clone transfer.
- **Large docs / performance** — building every page up front mirrors the Docs
  builder's per-char span cost. If needed, build pages lazily as the reveal
  approaches them (the walker would need page-at-a-time extension).
- **PDF.js worker under extension CSP** — set `workerSrc` to the web-accessible
  vendored worker; verify it loads on the `drive.google.com` origin.

## Milestones

1. **P1** — Vendor PDF.js; source-detection seam; fetch bytes; load doc; dump
   naive line-joined text into the overlay and reveal it (proves the reuse).
2. **P2** — Line grouping, spaces, de-hyphenation, paragraph segmentation →
   accurate prose with correct paragraph pauses.
3. **P3** — Bold/italic + heading detection.
4. **P4** — Figures (embedded images) cropped as snippets, placed in order.
5. **P5** — Table/vector region snapshots; page-break dividers.
6. **P6** — 1–2 column ordering, header/footer stripping, scanned-PDF guard,
   polish + perf (lazy page build if required).
