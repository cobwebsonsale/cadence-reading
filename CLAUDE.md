# Cadence Reading — contributor notes

**Cadence Reading** is a Chrome MV3 extension that re-renders Google Docs and
PDFs into a full-screen overlay and reveals them character-by-character. See
`README.md` for the full architecture and `extension/` layout.

## Code style

- **Do not add code comments.** Convey intent through precise names for
  functions, variables, and constants — not prose. Do not explain the *why* in a
  comment; put rationale in the commit message or PR. Add a comment only when
  explicitly asked to, and never one that restates what the code does.
- **Never reference test files or specific sample documents** in names (or in a
  comment, on the rare occasion one is requested). Code must read as
  general-purpose.
- Match the surrounding style: pure ESM, no build step, no framework.

## Docs

- **Keep `README.md` and other docs crisp, not verbose.** State each fact once,
  in the fewest words that stay accurate; prefer terse bullets over prose
  paragraphs. Cut hedging, restatement, and marketing tone. When updating docs,
  tighten rather than append.

## Tests

`npm test` runs `node --test` over `test/*.js` (jsdom). Extraction logic is
factored into pure, exported functions so it is testable without a browser;
rasterization/canvas work is browser-only and verified by loading a PDF.
