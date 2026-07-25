# Migrate to `drive.file` + Google Picker, with Docs tabs

## Goal

Drop the **restricted** `drive.readonly` scope for the **non-sensitive** `drive.file`
scope (no CASA / audit, publishable without restricted-scope verification), keeping rich
Docs rendering + comments + Drive PDFs. Add first-class support for **Google Docs tabs**
(multi-tab documents). Local PDF upload is unaffected.

## Verified facts (Google)

- `documents.get`, `comments.list`, `files.get`, `files.export` all accept `drive.file`.
- `drive.file` is **non-sensitive** (no CASA); **per-file, Picker-only** — the app only
  touches files the user explicitly picks. Grants **persist** across sessions, so the
  library re-opens a past pick without re-picking.
- `documents.get?includeTabsContent=true` (already used) returns `document.tabs[]`; each
  tab has `tabProperties` (`tabId`, `title`, `index`, `nestingLevel`) + `documentTab`
  (`body`, `lists`, `inlineObjects`) + nested `childTabs[]`.

**Verify during build**: the doc URL's `?tab=t.<id>` matches `tabProperties.tabId`; the
Picker's `DocsView.setQuery()` pre-seeds its search field.

## Resolved config

- `PICKER_ORIGIN` = `https://picker.bharatmunshi.cc` (GitHub Pages, `/docs` on `main`,
  public repo). Page + `CNAME` live in `docs/`; `appId`/`apiKey` filled in `docs/index.html`.
- Keep the toolbar action + `Ctrl+Shift+R` (both grant `activeTab`), repurposed for the
  title-prefill flow below.

## The MV3 / hosting constraint

The Picker needs Google's hosted `apis.google.com/js/api.js`; MV3 bans remote scripts in
extension pages. So the Picker runs on the hosted static page at `PICKER_ORIGIN`, opened
in a popup and driven over `postMessage`. Handshake: page → `picker-ready`; extension →
`picker-init{token, query}` (origin-verified); page → `picker-pick{fileId,mimeType,name}`
or `picker-cancel`. Token passed only via `postMessage` with a strict `targetOrigin`,
never in the URL.

## Identifiers are synthesized, never fetched

We key everything on a **doc-URL-shaped identifier** built from `(fileId, tabId)`:
`https://docs.google.com/document/d/<fileId>/edit?tab=t.<tabId>` (PDF:
`https://drive.google.com/file/d/<fileId>/view`). It is used only as (1) a storage key and
(2) a parse target for `detectSource` (extract `fileId` + `tabId`). Content is always
fetched by `fileId` via `documents.get` — we never request the docs.google.com origin
(hence dropping that host permission). This keeps `sources.js`/`detectSource` and the
`?url=` reload path unchanged.

## Title-prefill (replaces "open current tab")

`drive.file` forbids opening an arbitrary URL, and `files.list` is gone, so the in-reader
Drive search is removed — the only search is the **Picker's own**, which we pre-seed:

1. Toolbar action reads `tab.title` + `tab.url` via `activeTab` (non-sensitive; no content
   script, no docs.google.com host permission).
2. Extract `fileId` + `tabId`; clean the title (`stripGoogleSuffix`, drops
   ` - Google Docs`/`Sheets`/`Slides`/`Drive`).
3. If `fileId` matches a stored library entry (grant persists) → open the reader with the
   synthesized `?url=` (that tab) directly, no Picker.
4. Else → open the reader with `?q=<title>` (and stash `tabId`); the reader primes the
   "Open from Google Drive" button and, on click, opens the Picker with
   `setQuery(title)`. After the pick, synthesize the URL (re-attaching the stashed
   `tabId`) → existing `openUrl` path.

## Docs tabs

Today `resolveDocModel` renders only the first tab with a body; every other tab is
dropped and the viewed tab is ignored. Generalize:

- **Model helpers (pure, tested)** in `render/tabs-model.js`:
  - `listTabs(doc)` → flattened, ordered `[{ tabId, title, level }]` (walks `childTabs`).
  - `resolveTabContent(doc, tabId)` → `{ content, lists, inlineObjects }` for `tabId`,
    falling back to first-with-body (today's behavior).
- **Selection** rides in the identifier's `?tab=` query param. `positionKey`/`notesKey`
  strip only the `#` fragment, so **per-tab position + notes fall out automatically**
  (required for correctness: each tab is distinct text; highlights re-anchor per tab).
- **Recents**: one entry per visited tab, title disambiguated as `Doc title — Tab name`
  (compose in `saveDocEntry`).
- **HUD switcher** (Docs, >1 tab only): a compact "current tab" pill at the **left of the
  HUD**, hover/`focus-within` opening an upward popover list (reuses the `.dr-hud-help`
  pattern), child-tabs indented. Selecting a tab calls `session.switchTab(tabId)`.
- **`switchTab(tabId)`** (mid-read, no network — the full doc is already in memory from
  the initial `includeTabsContent` fetch): flush current position → rebuild the content
  column via `resolveTabContent` → rebuild reveal steps/loop → re-point position save +
  notes panel to the new tab's key → derive the new `?tab=` identifier and
  `history.replaceState` it → update the HUD pill. Requires the session to own the
  current doc identifier (so position/notes re-key on switch).
- **Comments caveat**: comments are per-file, anchored by quoted-text match; comments
  whose text is in a different tab than the one shown simply don't anchor.

## Extension changes

- **`manifest.json`**: scope `drive.readonly` → `drive.file`; remove `content_scripts` and
  the `web_accessible_resources` block; drop `docs.google.com`/`drive.google.com` and
  `scripting` (verify unused); keep `docs.googleapis.com`, `www.googleapis.com`,
  `identity`, `storage`, `activeTab`.
- **`src/background.js`**: remove `listFiles`/`listDriveFiles`; add `getAuthToken` RPC;
  rewrite the action handler for the title-prefill flow (library-match → `?url=`, else
  `?q=`); keep `fetchDoc`/`fetchComments`/`fetchDocText`/`fetchPdfBytes`.
- **`src/rpc.js`**: drop `listDriveFiles`; add `getAuthToken`.
- **`src/api/drive.js`**: remove `listFiles`/`driveList`; keep `fetchComments`,
  `fetchDocText`, mime constants.
- **`src/content.js`**: delete (dead — nothing sends its `startSession` message — and its
  host is gone).
- **`src/sources.js`**: `detectSource` parses `fileId` + `tabId`; `docsSource(docId, tabId)`
  threads `tabId` into `buildDocument`; add pure `synthesizeUrl(fileId, mimeType, tabId)`.
- **`src/render/builder.js`**: `buildDocument(doc, { mount, settings, tabId })` uses
  `resolveTabContent`; expose `listTabs` for the switcher.
- **`src/session.js`**: own the current doc identifier; add `switchTab`; disambiguated
  `docTitle`; per-tab position/notes re-keying.
- **`src/overlay.js` + `styles/overlay.css`**: the HUD tab pill + popover.
- **`reader/reader.js` + `reader.html`**: remove the paste-link form and Drive modal; add
  "Open from Google Drive" → `reader/picker.js` (RPC `getAuthToken` → popup → handshake →
  synthesize URL → `openUrl`); handle `?q=` (prime picker with title) and keep `?url=`
  (reopen granted files / library / tab switch); revoked-grant `403/404` → re-pick prompt.
- **`reader/picker.js`** (new): the popup handshake client.

## Hosted Picker page (`docs/`, done)

`docs/index.html` (handshake + `DocsView.setQuery`), `docs/CNAME`, `docs/README.md`.
Remaining: user fills `appId`/`apiKey`; set `extensionId` for production.

## Google Cloud setup (user)

Enable Picker/Docs/Drive APIs; OAuth client (Chrome-extension) scope `drive.file`; API key
restricted to Picker API + referrer-locked to `PICKER_ORIGIN`.

## Build order

1. Pure helpers + tests: `synthesizeUrl`, `stripGoogleSuffix`, `parseDocRef`
   (`fileId`+`tabId`), `listTabs`, `resolveTabContent`.
2. Manifest + background + rpc + drive.js; delete content.js.
3. Docs render: `buildDocument` renders the selected tab; disambiguated titles.
4. HUD switcher + `session.switchTab` (mid-read rebuild + re-key).
5. Picker page config + `picker.js` + reader wiring (remove paste-link/modal).
6. Revoked-grant handling; docs (README/plan).

## Tradeoffs / losses

Paste-link, open-current-tab, browse-all-files go; a *new* file always goes through the
Picker (re-opening a picked file/tab does not). One external static page is now part of
the system.

## Verification

- Pick a Doc → rich render + comments; multi-tab doc → switcher lists tabs, switching
  rebuilds; pick a Drive PDF → renders; local PDF unchanged; a library entry (per tab)
  re-opens without the Picker; title-prefill seeds the Picker search.
- OAuth consent shows only `drive.file`, no restricted-scope warning.
- Tests: URL synthesis, title cleaning, ref parsing, `listTabs`/`resolveTabContent`;
  remove `drive.js` `listFiles` tests.
