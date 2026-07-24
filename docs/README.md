# Cadence Reading — Google Picker page

Static page hosted at **https://picker.bharatmunshi.cc** (GitHub Pages). The extension
opens it in a popup and talks to it over `postMessage`; it runs the Google Picker so a
user can grant access to one Doc/PDF at a time under the `drive.file` scope.

This page is **not** part of the extension bundle — MV3 forbids the remote
`apis.google.com` script inside extension pages, so the Picker must live on its own
origin.

## Config

Fill `CONFIG` at the top of `index.html`:

- `appId` — Google Cloud **project number**.
- `apiKey` — browser API key, restricted to the **Picker API** and referrer-locked to
  `https://picker.bharatmunshi.cc/*`.
- `extensionId` — the extension's ID. Leave blank in dev (any `chrome-extension://`
  origin is accepted); set it for production to lock the handshake to one extension.

## GitHub Pages

- Repo → **Settings → Pages** → Source: **Deploy from a branch**, branch `main`, folder
  `/docs`.
- Custom domain: `picker.bharatmunshi.cc` (the `CNAME` file here pins it).
- Enable **Enforce HTTPS** once the certificate provisions.

## DNS

At the registrar for `bharatmunshi.cc`, add a `CNAME` record:

    picker  →  <github-username>.github.io.

## Google Cloud

1. Enable **Picker API**, **Docs API**, **Drive API**.
2. OAuth client (Chrome-extension type), scope `drive.file` — consent screen is
   non-sensitive, publishable without verification.
3. API key restricted to the Picker API, referrer-locked to the origin above.

## Handshake

1. Page loads `gapi`, posts `{type:'picker-ready'}` to `window.opener`.
2. Extension replies `{type:'picker-init', token, query}` (verified by origin).
3. Picker opens, pre-seeded with `query` (the current doc's title, when launched from a
   Google file).
4. On pick: `{type:'picker-pick', fileId, mimeType, name}`. On cancel/close:
   `{type:'picker-cancel'}`.
