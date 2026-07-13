import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createListContext } from '../extension/src/render/lists.js';

const lists = (levels) => ({ L1: { listProperties: { nestingLevels: levels } } });
const bullet = (nestingLevel = 0) => ({ listId: 'L1', nestingLevel });

test('unordered list yields the bullet glyph', () => {
  const ctx = createListContext(lists([{ glyphSymbol: '◦' }]));
  assert.deepEqual(ctx.glyphFor(bullet()), { text: '◦', indentPx: 48, ordered: false });
});

test('unordered list falls back to a default bullet', () => {
  const ctx = createListContext(lists([{}]));
  assert.equal(ctx.glyphFor(bullet()).text, '•');
});

test('an untyped level with a start number is ordered (defaults to decimal)', () => {
  const ctx = createListContext(lists([{ glyphType: 'GLYPH_TYPE_UNSPECIFIED', startNumber: 1 }]));
  const first = ctx.glyphFor(bullet());
  assert.equal(first.text, '1.');
  assert.equal(first.ordered, true);
  assert.equal(ctx.glyphFor(bullet()).text, '2.');
});

test('a bullet glyph is never treated as ordered even with a start number', () => {
  const ctx = createListContext(lists([{ glyphSymbol: '●', startNumber: 1 }]));
  assert.equal(ctx.glyphFor(bullet()).ordered, false);
  assert.equal(ctx.glyphFor(bullet()).text, '●');
});

test('decimal list increments across calls', () => {
  const ctx = createListContext(lists([{ glyphType: 'DECIMAL', glyphFormat: '%0.' }]));
  assert.equal(ctx.glyphFor(bullet()).text, '1.');
  assert.equal(ctx.glyphFor(bullet()).text, '2.');
  assert.equal(ctx.glyphFor(bullet()).text, '3.');
});

test('alpha and roman formats', () => {
  const alpha = createListContext(lists([{ glyphType: 'ALPHA', glyphFormat: '%0)' }]));
  assert.equal(alpha.glyphFor(bullet()).text, 'a)');
  assert.equal(alpha.glyphFor(bullet()).text, 'b)');

  const roman = createListContext(lists([{ glyphType: 'UPPER_ROMAN', glyphFormat: '%0.' }]));
  assert.equal(roman.glyphFor(bullet()).text, 'I.');
  assert.equal(roman.glyphFor(bullet()).text, 'II.');
  assert.equal(roman.glyphFor(bullet()).text, 'III.');
  assert.equal(roman.glyphFor(bullet()).text, 'IV.');
});

test('startNumber offsets the first value', () => {
  const ctx = createListContext(lists([{ glyphType: 'DECIMAL', glyphFormat: '%0.', startNumber: 5 }]));
  assert.equal(ctx.glyphFor(bullet()).text, '5.');
  assert.equal(ctx.glyphFor(bullet()).text, '6.');
});

test('nested levels compose and a deeper counter restarts when re-entered', () => {
  const ctx = createListContext(
    lists([
      { glyphType: 'DECIMAL', glyphFormat: '%0.' },
      { glyphType: 'DECIMAL', glyphFormat: '%0.%1.' },
    ])
  );
  assert.equal(ctx.glyphFor(bullet(0)).text, '1.');
  assert.equal(ctx.glyphFor(bullet(1)).text, '1.1.');
  assert.equal(ctx.glyphFor(bullet(1)).text, '1.2.');
  assert.equal(ctx.glyphFor(bullet(0)).text, '2.', 'shallower level increments');
  assert.equal(ctx.glyphFor(bullet(1)).text, '2.1.', 'deeper level restarts under the new parent');
});

test('a null bullet or unknown list yields no glyph', () => {
  const ctx = createListContext(lists([{ glyphType: 'DECIMAL', glyphFormat: '%0.' }]));
  assert.equal(ctx.glyphFor(null), null);
  assert.equal(ctx.glyphFor({ listId: 'missing', nestingLevel: 0 }).text, '•');
});
