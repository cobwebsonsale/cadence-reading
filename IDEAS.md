# Next ideas

Backlog of high-leverage work, with enough context to pick up cold. Grouped by kind.

## Code

### Virtualize per-character spans
Every glyph is a live `.dr-char` span, and a Google Doc builds its **whole** DOM up
front (only PDFs build lazily, via `session.setupLazyBuild`). A ~50k-word doc creates
hundreds of thousands of nodes at once — the main scaling limit. Keep spans live only
near the reveal frontier; flatten far-behind revealed text to plain text (or one span
per line), and re-materialize on rewind. Also extend lazy building to Docs. Watch:
`chunker.js`/`planChunks`, `scroller`, and note/comment anchoring all read `.dr-char`
`offsetTop`/positions, so measurement near the frontier must stay intact and spans must
be restored when rewinding or re-anchoring.

### Integration tests for the session seams
`session.js`, `sources.js`, `background.js`, and `reader.js` have essentially no
tests — the notes-vanish-on-reload regression slipped through because the e2e only
covered a single-paragraph snip. Add jsdom tests that wire `source.prepare → build →
loop → notes panel`: multi-paragraph/list snips re-anchoring, position save/restore
round-trips (including boost/mid-play saves), and doc-key normalization so a URL that
gains a query param (e.g. `?tab=t.0`) doesn't split stored notes/position.

## UI polish

### Wide-table scroll affordance
`.dr-table-wrap` is `overflow: auto`, but a table wider than the paper gives no visual
hint that it scrolls sideways. Add an edge shadow/gradient (or a chevron) shown only
when `scrollWidth > clientWidth`, updated on scroll. Pure CSS plus a class toggle.

### Real loading + error states
Loading is a bare "Loading…" string (`overlay.hud.setStatus`), and failures surface
mainly in the console (`session.showFatal`). Add a skeleton/spinner while fetching and
building, and turn OAuth/fetch errors into a visible, retryable message.

## Reading

### Outline / table-of-contents navigation
Headings are already identified (named styles plus author-styled detection in
`builder.js`). Build a collapsible outline (in the gutter or a panel) that shows the
document structure and jumps to a heading on click by seeking the loop to that
heading's step. Natural companion to an in-document search.

## Features

### Text-to-speech synced to the reveal
Narrate the text as it reveals, with the highlight following the voice — a strong
accessibility and hands-free win that fits the character-by-character model. Web Speech
API (`speechSynthesis`) is the zero-dependency start; tie its rate to `charsPerSec` and
drive it from the reveal frontier, with play/pause in the HUD.

### AI layer (summaries, Q&A, flashcards)
The reader already holds the full structured text (`.dr-para` text + the user's
snippets). Add per-section summaries, "explain this paragraph," Q&A over the document,
and auto-generated spaced-repetition flashcards from highlighted snippets.

### ~~Reader library (recents + resume)~~ — built
Shipped: the reader landing page lists recently-opened docs (title, note count, last
read) from a `dr-doc:` index, joined with `dr-pos:`/`dr-notes:`. Click to reopen+resume;
× to forget. Follow-ups worth doing: reopen local PDFs (needs durable bytes, e.g.
IndexedDB or the File System Access API), and a real progress % (persist a fraction, not
just the raw step index).
