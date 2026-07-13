# Migrate off `drive.readonly` → `drive.file` + Google Picker

## Goal

Keep rich Google Docs (Docs API structure) + comments + Drive PDFs, but drop the
**restricted** `drive.readonly` scope for the **non-sensitive** `drive.file` scope —
no CASA / security assessment / annual audit, publishable without restricted-scope
verification. Local PDF upload is unaffected.

## Verified facts (Google docs)

- `documents.get`, `comments.list`, `files.get`, `files.export` **all accept `drive.file`**.
- `drive.file` is **non-sensitive** (no CASA).
- `drive.file` is **per-file, Picker-only**: the app can only touch files the user
  explicitly opens via the Google Picker. No arbitrary URL/ID access; `files.list`
  returns only app-opened files.
- **Grants persist**: once a user picks a file, the app keeps access to it across
  sessions — so the recent-docs library can re-open a past file **without** re-picking.
  The Picker is only needed for *new* files.

## What stays / what goes

**Stays**: Docs rendering (`render/*`), comments, PDF pipeline, reveal engine, notes,
local PDF drop/pick + library, the Docs/Drive-PDF source strategies in `sources.js`
(they work unchanged on a picked file), the recent-docs library (re-opens past picks).

**Goes** (all depend on broad access the `drive.file` model forbids):
- Paste-a-link box (can't open an arbitrary URL).
- "Open the doc I'm currently viewing" — the `docs.google.com` content script + the
  action/`Cmd+Shift+R` URL-sniffing trigger.
- The custom Drive browser modal (`files.list` / `listDriveFiles`).

## The MV3 constraint

The Picker needs Google's hosted JS (`apis.google.com/js/api.js`); MV3 bans remote
scripts in extension pages. So the Picker must run on a **separately hosted static
page** (e.g. GitHub Pages — no backend needed) that the extension opens in a popup and
talks to via `postMessage`. Requires a **Google API key** in addition to the OAuth
client.

## Architecture — the Picker page (hosted, static, NOT bundled)

A standalone HTML page at a stable HTTPS origin `PICKER_ORIGIN`:
1. Loads `gapi` + `google.picker`.
2. `postMessage({type:'picker-ready'})` to `window.opener`.
3. Receives `{type:'picker-init', token, apiKey, appId}` (verify `event.origin` is the
   extension origin), builds a Picker for Docs + PDFs, shows it.
4. On pick, `postMessage({type:'picker-pick', fileId, mimeType, name})` back; on cancel,
   `{type:'picker-cancel'}`. Then closes.

Token is passed via `postMessage` with a strict `targetOrigin` — **never** in the URL.

## Extension changes

- **`manifest.json`**
  - `oauth2.scopes`: `drive.readonly` → `drive.file`.
  - Remove `content_scripts` (docs/drive) and the docs/drive `web_accessible_resources`
    `matches`.
  - `host_permissions`: keep `docs.googleapis.com`, `www.googleapis.com`; drop
    `docs.google.com`, `drive.google.com`. Add `PICKER_ORIGIN` if needed.
  - Repurpose the `start-session` command + action to just open the reader (no URL
    sniffing), or drop.
- **`src/background.js`**
  - `getToken` now yields a `drive.file` token.
  - Remove the `listDriveFiles` handler + `listFiles` import.
  - Keep `fetchDoc` / `fetchComments` / `fetchDocText` / `fetchPdfBytes` (work on picked
    files).
  - Add a `getAuthToken` RPC so the reader can obtain a token to hand the Picker page.
  - `startSessionInActiveTab` → open the bare reader.
- **`src/rpc.js`**: drop `listDriveFiles`; add `getAuthToken`.
- **`src/api/drive.js`**: remove `listFiles`; keep `fetchComments` / `fetchDocText` and
  the mime constants (used to synthesize the file URL).
- **`src/content.js`**: delete.
- **`src/sources.js`**: unchanged. Picker result (`fileId` + `mimeType`) is turned into
  the same `docs.google.com` / `drive.google.com` URL the browser used, then fed to the
  existing `detectSource` path.
- **`reader/reader.js` + `reader/reader.html`**
  - Remove the paste-a-link form and the custom Drive browser modal
    (`driveModal`, `renderDriveFiles`, `loadDriveFiles`, `openDriveModal`, related CSS).
  - Add an **"Open from Google Drive"** button → Picker flow: RPC `getAuthToken` →
    open `PICKER_ORIGIN` popup → handshake → on pick, synthesize URL → `openUrl(...)`.
  - Keep local PDF drop/pick + library. Library rows re-open past picks directly
    (grant persists) with a graceful re-pick fallback if access was revoked.

## Google Cloud setup (user)

1. Enable **Picker API**, **Docs API**, **Drive API**.
2. OAuth client (Chrome-extension type) — scope `drive.file`; consent screen is
   non-sensitive, publishable without verification.
3. API key restricted to the **Picker API**, referrer-locked to `PICKER_ORIGIN`.
4. Host the Picker page at `PICKER_ORIGIN`.

## Tradeoffs / losses

Paste-link, open-current-tab, and browse-all-files are gone; opening a *new* Google
file always goes through the Picker. Re-opening a previously-picked file (via the
library) needs no Picker. One external static page is now part of the system (the
extension was previously fully self-contained).

## Open questions

- Where to host `PICKER_ORIGIN` (GitHub Pages vs a domain)?
- Keep or drop the keyboard command / toolbar action once URL-sniffing is gone?
- Revoked-grant UX: detect `403` on a library re-open and prompt to re-pick.

## Verification

- Pick a Doc → rich render + comments; pick a Drive PDF → renders; local PDF unchanged;
  a library entry re-opens without the Picker.
- Confirm the OAuth consent shows only `drive.file` and no restricted-scope warning.
- Tests: add URL-synthesis-from-picked-id unit tests; remove the `drive.js` `listFiles`
  tests.
