# Plan B — Re-rendered Reader with Comments for Google Docs

A Chrome extension that fetches a Google Doc through the Docs and Drive
APIs, builds its own DOM rendition of the doc inside a full-screen
overlay, and reveals it character-by-character with paragraph pauses.
Comments are fetched separately and surfaced as the highlighted text
they anchor to is revealed.

## Goals

- True per-character reveal, not a pixel wipe.
- Pause at paragraph and section boundaries until the user presses a key.
- Preserve meaningful formatting: headings, bold/italic/underline,
  links, lists (nested + ordered), indentation, tables, inline images,
  text colors.
- Surface comments as their anchored text is revealed: a callout slides
  in next to the paragraph showing author and comment body. Multiple
  comments on the same range stack.
- Never write to the doc.

## Non-goals

- Exact pixel-fidelity with Google's rendering. The result looks like a
  well-formatted document, not a screenshot of *this* doc.
- Live collaboration. Session reads a snapshot at start.
- Rendering Drawings / equations beyond the flattened image Google
  provides.

## Requirements

### Functional

1. Activate only on `https://docs.google.com/document/*` URLs. Extract
   the `docId` from the URL.
2. First-run flow: OAuth via `chrome.identity.getAuthToken` requesting
   `drive.readonly`. Token cached.
3. User triggers a session via toolbar icon or `Ctrl+Shift+R` /
   `Cmd+Shift+R`.
4. On trigger:
   - Fetch the doc via Docs API.
   - Fetch comments via Drive API.
   - Build DOM in an overlay.
   - Begin char-by-char reveal in reading order.
5. Reveal cadence: configurable chars/sec (default 35). Speed up while
   key is held (auto-advance through current paragraph).
6. Pause at paragraph and section boundaries; await `Space`/`Enter`/`→`.
7. When the last character of a comment-anchored range is revealed, a
   callout for that comment animates in. Callouts stack and persist
   until the user dismisses them with `C` or until end of session.
8. Controls:
   - `Space` / `Enter` / `→` — continue past pause.
   - `←` — replay previous paragraph (re-hides + re-reveals).
   - `C` — toggle comment callouts visibility.
   - `[` / `]` — slower / faster reveal.
   - `Esc` — end session.
9. Session end restores the underlying Docs tab fully.

### Non-functional

- No edits to the doc.
- All network calls authenticated, no data leaves the user's browser.
- Initial paint < 1.5s on a 5,000-word doc (build DOM lazily if needed).
- Handles docs up to ~50,000 words without locking the main thread.

## Architecture

```
extension/
  manifest.json
  src/
    background.js           # OAuth, API fetches (kept off content origin)
    content.js              # entry; orchestrates session in the tab
    api/
      docs.js               # documents.get + parsing
      drive.js              # comments.list
    render/
      builder.js            # Docs JSON → overlay DOM
      styles.js             # textStyle → inline CSS
      lists.js              # list nesting + glyph resolution
      tables.js
      objects.js            # inline images, drawings
      comments.js           # anchor matching + callout DOM
    reveal/
      walker.js             # ordered iterator of char-spans + boundaries
      loop.js               # state machine + rAF
      input.js              # keypress handlers
    settings.js
  styles/
    overlay.css
  options/
    options.html
    options.js
```

### OAuth

In `manifest.json`:

```json
{
  "oauth2": {
    "client_id": "<TO_FILL>.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/drive.readonly"
    ]
  },
  "permissions": ["identity", "storage", "activeTab"],
  "host_permissions": [
    "https://docs.google.com/*",
    "https://www.googleapis.com/*"
  ]
}
```

`drive.readonly` is enough to read both the doc structure (via Docs API)
and comments (via Drive API). Confirm during implementation; fall back
to `documents.readonly` + `drive.readonly` if the Docs API rejects the
single scope.

Background worker handles token acquisition and refresh, exposes a
message-passing RPC to the content script (`fetchDoc(docId)`,
`fetchComments(docId)`).

## Implementation details

### 1. Fetch (`api/docs.js`, `api/drive.js`)

**Doc:**
```
GET https://docs.google.com/v1/documents/{docId}
    ?suggestionsViewMode=PREVIEW_WITHOUT_SUGGESTIONS
    &includeTabsContent=true
Authorization: Bearer {token}
```

Returns a JSON document with `body.content[]` of structural elements
(paragraphs, tables, sectionBreaks, tableOfContents) and lookup maps
(`lists`, `inlineObjects`, `namedStyles`, `footnotes`).

**Comments:**
```
GET https://www.googleapis.com/drive/v3/files/{docId}/comments
    ?fields=comments(id,content,htmlContent,author(displayName,photoLink),createdTime,resolved,anchor,quotedFileContent,replies(content,author,createdTime))
    &includeDeleted=false
    &pageSize=100
Authorization: Bearer {token}
```

Page through `nextPageToken`. Filter out `resolved=true` unless the user
opts in.

The `anchor` field is a Drive-format JSON string. For Docs it contains a
revision id and a list of `kix.*` range descriptors. The cleaner route
for range anchoring is to use the `quotedFileContent.value` to match
against the doc text — exact text match, scanning left-to-right. If the
same quote appears multiple times, we use the Nth occurrence based on
sibling ordering in the API response. Implementation note: maintain a
running cursor while assigning comments in document order to ensure
duplicate quotes don't fight.

### 2. Build DOM (`render/builder.js`)

Walk `body.content[]` in order. For each element:

**Paragraph:**
- Create a container element. If `paragraphStyle.namedStyleType` is
  `HEADING_1..HEADING_6`, use `<h1>..<h6>`. Else `<p>`.
- Tag with `data-paragraph-index="{i}"` for the reveal walker.
- Apply `paragraphStyle.indentStart`, `alignment`, `lineSpacing`,
  `spaceAbove/Below` as inline styles.
- If `bullet` is present, route through `render/lists.js`.
- For each `element` in `paragraph.elements`:
  - `textRun`: split `content` into characters; wrap each in
    `<span class="char" style="...">`. Style derived from `textStyle`
    (bold → font-weight 700; italic → font-style; underline →
    text-decoration; foregroundColor → color; backgroundColor → bg;
    link.url → wrap span in `<a>`).
  - `inlineObjectElement`: render via `render/objects.js`; create a
    `<span class="char inline-object" data-instant="true">` so the
    walker still treats it as one step but it appears instantly.
  - `pageBreak`, `horizontalRule`, `columnBreak`: render as visible
    markers; treat as paragraph end + section break.
  - `footnoteReference`: render as superscript; defer footnote body.

**Table:** build `<table>` with cells; each cell's contents recurse
into the same builder.

**SectionBreak:** marks a section. Insert a `<section-break>` marker
node so the walker emits a section-pause.

**Lists (`render/lists.js`):**
- A paragraph's `bullet.listId` resolves to `document.lists[listId]`.
- `bullet.nestingLevel` (0-based) picks the glyph from
  `lists[listId].listProperties.nestingLevels[level].glyphSymbol` /
  `glyphFormat`.
- Render as a leading `<span class="bullet">` plus indentation; do not
  use `<ul>/<ol>` because Docs encodes lists as paragraphs with bullet
  metadata, and nesting + numbering across paragraph types is easier
  to reproduce with explicit glyph rendering.
- Compute numbered list counters in a single pre-pass.

**Inline objects (`render/objects.js`):**
- `embeddedObject.imageProperties.contentUri` is a Google-hosted URL.
- Render `<img>` with that URL. CORS works because we already auth'd.
- For drawings/charts, the same image URL is provided as a flattened
  PNG.

### 3. Comment anchoring (`render/comments.js`)

Two-pass:

1. **Index comments by quoted text** in order of API response (which is
   document order for non-resolved comments).
2. **Walk the built DOM** in reading order, accumulating revealed text.
   For each comment in order, find the next occurrence of its
   `quotedFileContent.value` after the current cursor, then:
   - Tag the spans covering that range with
     `data-comment-id="{id}"` and `data-comment-end="true"` on the last
     char's span.
   - Append the comment record to `comments[id]`.

Why not use the structural index? The Docs API doesn't return start/end
offsets for comments in `documents.get` — those live only in the Drive
API anchor blob, which is unstable to parse. Quoted-text matching is
robust enough in practice.

Callout DOM:

```html
<aside class="dr-comment" data-comment-id="...">
  <header>
    <img class="avatar" src="..."> <span class="author">Name</span>
    <time>2026-05-12</time>
  </header>
  <div class="body">…htmlContent…</div>
  <ol class="replies">…</ol>
</aside>
```

Position: absolute, anchored to the right margin of the overlay's
content column, vertically aligned with the bottom of the commented
range. Multiple callouts at the same Y offset stack downward with a
small gap. CSS transition slides them in from the right when revealed.

### 4. Reveal loop (`reveal/walker.js`, `reveal/loop.js`)

**Walker:** pre-builds an ordered array of reveal steps:

```
type Step =
  | { kind: 'char',     el: HTMLSpanElement, instant?: boolean }
  | { kind: 'pause',    boundary: 'paragraph' | 'section' }
  | { kind: 'comment',  commentId: string }
```

Built by walking the overlay DOM in document order. At the end of each
paragraph, emit a `pause`. At each `<section-break>`, emit a `pause`
with `boundary: 'section'`. After the last char of any commented range,
emit a `comment` step before the natural paragraph pause.

**Loop:** state machine:

```
PLAYING → PLAYING (char step: set span.style.opacity = 1; advance)
PLAYING → COMMENT_REVEAL (comment step: mount callout, run animation, advance)
PLAYING → AWAIT_KEYPRESS (pause step)
AWAIT_KEYPRESS → PLAYING (on key)
```

Char visibility: build all `.char` spans with `opacity: 0` (not
`display: none`, so layout is stable from the start). Revealing is just
`span.style.opacity = 1` plus a 60ms fade if desired.

Cadence: `setInterval` is too coarse and drifts. Use rAF with an
accumulator:

```js
let acc = 0;
function tick(ts) {
  acc += (ts - last) * (charsPerSec / 1000);
  while (acc >= 1 && steps.length) {
    acc -= 1;
    const step = steps.shift();
    if (step.kind === 'char') step.el.style.opacity = 1;
    else if (step.kind === 'pause') return enterAwait(step);
    else if (step.kind === 'comment') return revealComment(step);
  }
  if (steps.length) requestAnimationFrame(tick);
}
```

Instant chars (inline-object spans) decrement the accumulator like normal
chars so cadence feels natural around images.

### 5. Overlay UI (`styles/overlay.css`)

- Fixed full-viewport container, z-index `2147483600`.
- Center column 720px wide for the rendered doc.
- Right gutter 320px for comment callouts.
- Dark theme by default; respect `prefers-color-scheme`.
- HUD at the bottom: speed, "Press Space to continue" hint, current
  paragraph index.

### 6. Input (`reveal/input.js`)

Same capture-phase pattern as Plan A. Key map:

- `Space` / `Enter` / `→` — `loop.advance()`
- `←` — `loop.rewindParagraph()` (reset all `.char` opacities in that
  paragraph to 0, rebuild step queue from its start)
- `C` — toggle `.dr-comment` visibility class on the overlay root
- `[` / `]` — `settings.charsPerSec += -5 / +5`
- `Esc` — `session.end()`

### 7. Underlying tab handling

Unlike Plan A, we are not revealing the real page, so we don't need to
lock its scroll precisely. But we still:

- Blur the doc's active element to stop the cursor blink showing through
  any translucent overlay region.
- Set `body { overflow: hidden }` on the doc to prevent accidental
  scrolling by errant keystrokes that leak through.

Both are reverted on session end.

### 8. Settings

Persisted in `chrome.storage.sync`:

- `charsPerSec` (default 35)
- `pauseAt` (`paragraph` | `section`)
- `showResolvedComments` (default false)
- `theme` (`auto` | `dark` | `light`)
- `fontFamily` override (default: match Docs default for the doc when
  available, else system serif)

## Test plan

1. Auth flow — fresh install, OAuth prompt appears, token cached.
2. Plain doc — paragraphs render, char-by-char reveal works, pauses fire.
3. Doc with headings — `<h1..6>` styles correct, section pauses at each.
4. Doc with nested lists — glyphs and indentation match Docs visually.
5. Doc with table — rows/columns/cell text reveal in correct order.
6. Doc with inline images — images appear in place, instant-step cadence.
7. Doc with three comments on three different ranges — each callout
   appears at the correct moment and in the right vertical position.
8. Doc with two comments on identical quoted text — ordering preserved.
9. Doc with a resolved comment — hidden by default, surfaced after
   toggling setting.
10. 50k-word doc — initial paint under target; no jank during reveal.
11. Replay (`←`) on a paragraph with a comment — comment callout is
    re-animated.
12. Esc cleanly tears down overlay, restores body overflow, removes
    listeners.

## Risks & open questions

- **OAuth setup.** The Google Cloud project / client_id needs to be
  registered before this is usable. Document the setup step in README.
- **Quoted-text matching ambiguity.** If a quote spans formatting
  boundaries (bold across word boundaries), the API value is plain text
  while our DOM text content includes nothing extra — should still
  match. Confirm with edge cases.
- **Tabs feature.** Newer Docs have multi-tab support
  (`includeTabsContent=true`); the JSON shape changes to nest content
  under `tabs[]`. Builder must handle both top-level `body.content` and
  `tabs[].documentTab.body.content`. Default to first tab; expose tab
  switcher in HUD if multiple.
- **Fonts.** Docs uses Google Fonts; if the doc specifies a font we
  haven't loaded, browser fallback shows. Acceptable for v1.
- **Suggestion-mode content.** We requested
  `PREVIEW_WITHOUT_SUGGESTIONS`. If the user wants to read suggestions,
  add a setting later.
- **Equations / drawings.** Inline as flattened images via
  `contentUri`. Math fidelity acceptable but not editable; fine for a
  reader.

## Milestones

1. M1 — OAuth + fetch + raw text dump in overlay.
2. M2 — Paragraph/heading/list rendering; no reveal yet.
3. M3 — Tables + inline images.
4. M4 — Reveal walker + char animation + paragraph pauses.
5. M5 — Comments fetch + anchoring + callouts.
6. M6 — Settings, HUD, replay/rewind.
7. M7 — Performance pass on large docs.
8. M8 — Polish, edge cases (tabs, suggestions toggle).
