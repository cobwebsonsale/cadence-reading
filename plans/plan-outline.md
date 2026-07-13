# Outline / Table-of-Contents

## Context

Long documents have no structural navigation — you can only move forward/back one
chunk at a time. Headings are already identified and rendered as real `h1`–`h6`
elements (Docs named styles + author-styled detection in `render/builder.js`) and
`.dr-pdf-heading` (PDFs), each carrying a contiguous `data-paragraph-index`. This adds
a **table of contents**: a "contents" button in the HUD opens a small popover listing
every heading; clicking one seeks the reveal to that section. Read headings show solid,
still-to-come ones faded (like the app logo's fading bars), with an amber caret marking
the section you're in.

Decisions:
- **Jump = reveal up to it.** Clicking a heading ahead reveals everything up to it and
  parks there (reuses the existing seek). Clicking a heading behind rewinds to it
  (unreveals later text) — consistent with the existing rewind/up-navigation.
- **UI = a HUD "contents" button + anchored popover** (not a side panel). Read = darker,
  unread = lighter, amber caret at the current section.
- **Scope = Docs + PDF** (same DOM code path; PDF headings are flat and, under lazy
  build, the list reflects built headings and grows as you read).

## Design

A HUD button centered in the bottom bar opens a popover (anchored above it, like the
existing `.dr-hud-help` → `.dr-hud-keys` popover). The popover lists headings in
document order, indented by level, each a clickable row. State per row:
- **read**: the heading's text has been revealed (`.dr-char[data-revealed]` present) → solid `--dr-chrome-fg`.
- **unread**: not yet → faded `--dr-chrome-dim`.
- **current**: the section containing the reveal frontier → an amber caret (`--dr-highlight-strong`) before the row.

The popover renders fresh each time it opens (enumerate + read-state), so no live
observers are needed and lazy-PDF growth is handled naturally.

## Files to change

### `extension/src/reveal/loop.js` — expose an absolute jump
`goToStep(index)` (private, bidirectional) and `firstStepIndexForParagraph(steps, para)`
(module fn) already exist. Add a public method and export it in the returned object
(the API list ~line 424):
```js
function goToElement(paraEl) {
  const index = firstStepIndexForParagraph(steps, paraEl);
  if (index >= 0) goToStep(index);
}
```
Forward `goToStep` reveals every step up to the heading's first char and parks with the
heading as the frontier (about to reveal) — exactly "jump to this section." Backward
unreveals via `unrevealRange` + `onRewind` (same as `rewind`).

### `extension/src/outline.js` — NEW module `createOutline({ hudEl, contentEl, onJump })`
Self-contained button + popover, mounted into the HUD (`hudEl` is `position:relative`,
so an absolutely-centered button + upward popover anchor cleanly):
- Build `<button class="dr-outline-btn">` (a stacked-lines "contents" icon) and
  `<div class="dr-outline-pop">`; append both to `hudEl`.
- `render()` — enumerate headings in order:
  `contentEl.querySelectorAll('h1,h2,h3,h4,h5,h6,.dr-pdf-heading')` (querySelectorAll is
  document order = `data-paragraph-index` order). For each: level from tag (`h2`→2; PDF
  flat = one level), text = `el.textContent.replace(/\s+/g,' ').trim()`, read =
  `!!el.querySelector('.dr-char[data-revealed]')`. Current section = the last heading at
  or before the reveal frontier (`contentEl.querySelector('.dr-char:not([data-revealed])')`,
  compared via `compareDocumentPosition`). Build one clickable row per heading (indent by
  level, read/unread class, amber-caret class on current); row click → `onJump(el)` then `close()`.
  Empty state: a muted "No headings" line.
- `open()/close()/toggle()` toggle a `dr-outline-open` class; **`render()` runs on open**.
  Open on button click and on the `O` key; close on re-click, outside-click, `Esc`, or
  selecting a row. (Hover-to-open is a nice-to-have; click-toggle is the reliable core.)
- `destroy()` removes listeners + nodes.
Reuse `el()` from `extension/src/dom.js`.

### `extension/src/session.js` — wire it in `run()`
After the notes panel is created (~line 130), unconditionally:
```js
this.outline = createOutline({
  hudEl: this.overlay.hud.el,
  contentEl: this.overlay.content,
  onJump: (el) => this.jumpToHeading(el),
});
```
Add `toggleOutline()` → `this.outline?.toggle()`, and
`jumpToHeading(el)` → `this.loop.goToElement(el)` (the popover closes itself on select).
Destroy it in the session teardown alongside `this.notes?.destroy()`. No mutual-exclusion
with comments/notes — the popover is transient and doesn't shift layout.

### `extension/src/reveal/input.js` — key binding
Add `case 'o': case 'O':` → `session.toggleOutline(); swallow(e);` (o is unused; the
`ignore(e)` guard already lets Cmd/Ctrl and note-editing through).

### `extension/src/overlay.js` — key legend
Add `['O', 'Outline']` to `HUD_KEYS`.

### `extension/styles/overlay.css` — styles (mirror `.dr-hud-help`/`.dr-hud-keys`)
- `.dr-outline-btn`: centered in the HUD via `position:absolute; left:50%; transform:translateX(-50%)`, small icon button (match `.dr-hud-help-btn` styling).
- `.dr-outline-pop`: `position:absolute; bottom:30px; left:50%; transform`, `max-height:52vh; overflow:auto`, chrome-bg + border + `--dr-shadow-2`, hidden by default, shown via the `dr-outline-open` class (opacity/visibility/transform transition like `.dr-hud-keys`); a downward `::after` pointer to the button.
- `.dr-outline-item`: block, padding, `--dr-chrome-dim` (unread); `.is-read` → `--dr-chrome-fg`; `.is-current` → amber caret (`--dr-highlight-strong`) via a `::before`; `:hover` uses `--dr-hover`. Indent by level (inline `padding-left` or a `data-level` rule). z-index within the HUD (HUD is z-index 6, above notes).

### Tests
- `test/outline.test.js` (jsdom): build a `.dr-content` with named + author-styled Docs headings and a `.dr-pdf-heading`; assert enumeration order, level, text; read vs unread from `data-revealed`; current = frontier section; a row click calls `onJump` with the right element; empty-state when no headings.
- `test/loop.test.js`: add a `goToElement` case — jumping forward reveals up to the heading and parks (`state==='AWAIT_KEYPRESS'`, revealed count == steps before the heading); jumping backward unreveals. Reuse `buildParagraph`/`buildSteps`/`createLoop`.

## Edge cases
- **No headings** → popover shows "No headings"; button stays (harmless).
- **Lazy PDF** → only built headings are listed; render-on-open picks up new ones as you read. Jumping works for any listed (built) heading since all preceding steps are built.
- **Headings inside tables/TOC blocks** also match the selector; acceptable (they're real sub-headings). Filter to direct `.dr-content` children only if they prove noisy.
- **Author-styled vs named headings** share `h2/h3/h4` — fine, level-by-tag is all we need.
- **Backward jump unreveals** later text (rewind) — matches existing `rewind`/`ArrowUp`.

## Verification
- `npm test` green (new outline + goToElement tests).
- Live (CDP clone): open a Docs doc with many headings, click the HUD contents button →
  popover lists headings, early ones solid, later ones faded, amber caret on the current
  section. Click a heading ahead → reveal jumps to it (parks at that heading); click one
  behind → rewinds. Repeat on a PDF to confirm `.dr-pdf-heading` rows appear and jump.
  Confirm `O` toggles the popover and `Esc`/outside-click closes it.
