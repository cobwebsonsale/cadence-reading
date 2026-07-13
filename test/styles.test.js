import { test } from 'node:test';
import assert from 'node:assert/strict';

import { textStyleToCss, paragraphStyleToCss, colorOf, linkUrlOf } from '../extension/src/render/styles.js';

test('textStyleToCss maps weight, style, and decorations', () => {
  const css = textStyleToCss({ bold: true, italic: true, underline: true, strikethrough: true });
  assert.ok(css.includes('font-weight:700'));
  assert.ok(css.includes('font-style:italic'));
  assert.ok(css.includes('text-decoration:underline line-through'));
});

test('textStyleToCss maps color and superscript but drops the document font/size', () => {
  const css = textStyleToCss({
    foregroundColor: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } },
    fontSize: { magnitude: 14, unit: 'PT' },
    weightedFontFamily: { fontFamily: 'Arial' },
    baselineOffset: 'SUPERSCRIPT',
  });
  assert.ok(css.includes('color:rgb(255,0,0)'));
  assert.ok(css.includes('vertical-align:super'));
  assert.ok(!/font-size:14pt/.test(css), 'the document font size is not carried over');
  assert.ok(!/font-family/.test(css), 'the document font is not carried over');
});

test('textStyleToCss returns empty string for missing/empty style', () => {
  assert.equal(textStyleToCss(null), '');
  assert.equal(textStyleToCss({}), '');
});

test('paragraphStyleToCss keeps alignment, direction, and paragraph spacing but drops indent/line-height', () => {
  const css = paragraphStyleToCss({
    alignment: 'CENTER',
    indentStart: { magnitude: 36 },
    lineSpacing: 150,
    spaceBelow: { magnitude: 12 },
    direction: 'RIGHT_TO_LEFT',
  });
  assert.ok(css.includes('text-align:center'));
  assert.ok(css.includes('direction:rtl'));
  assert.ok(css.includes('margin-bottom:16px'), 'paragraph spacing is respected (12pt → 16px)');
  assert.ok(!/margin-inline-start/.test(css), 'the document indent is not carried over');
  assert.ok(!/line-height/.test(css), 'the document line spacing is not carried over');
});

test('colorOf rounds rgb channels and handles absence', () => {
  assert.equal(colorOf({ color: { rgbColor: { red: 0.5, green: 1, blue: 0 } } }), 'rgb(128,255,0)');
  assert.equal(colorOf(null), null);
  assert.equal(colorOf({ color: {} }), null);
});

test('linkUrlOf resolves url, heading, and bookmark links', () => {
  assert.equal(linkUrlOf({ link: { url: 'https://x.io' } }), 'https://x.io');
  assert.equal(linkUrlOf({ link: { headingId: 'h1' } }), '#heading-h1');
  assert.equal(linkUrlOf({ link: { bookmarkId: 'b1' } }), '#bookmark-b1');
  assert.equal(linkUrlOf({}), null);
});
