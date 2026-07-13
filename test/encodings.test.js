import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDifferences,
  extractEncodingsFromObjects,
  parseObjectStream,
  glyphToUnicode,
} from '../extension/src/pdf/encodings.js';

test('parseDifferences maps codes to glyph names, honoring code resets', () => {
  const map = parseDifferences('1 /H11015 /H11005 /H11002 5 /H11006');
  assert.equal(map.get(1), 'H11015');
  assert.equal(map.get(2), 'H11005');
  assert.equal(map.get(3), 'H11002');
  assert.equal(map.get(5), 'H11006');
});

test('glyphToUnicode returns null for unknown names (so they fall back to a box)', () => {
  assert.equal(glyphToUnicode('H11006'), '±');
  assert.equal(glyphToUnicode('H99999'), null);
});

test('extractEncodingsFromObjects resolves indirect Encoding refs per BaseFont', () => {
  const objects = new Map([
    [10, '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Universal-GreekwithMathPi /Encoding 11 0 R >>'],
    [11, '<< /Type /Encoding /Differences [1 /H11015 /H11005 /H11002 /H11021 /H11006] >>'],
  ]);
  const map = extractEncodingsFromObjects(objects);
  const font = map.get('ABCDEF+Universal-GreekwithMathPi');
  assert.deepEqual(
    [font.get(1), font.get(2), font.get(3), font.get(4), font.get(5)],
    ['≈', '=', '−', '<', '±']
  );
});

test('extractEncodingsFromObjects keeps identical codes distinct across fonts', () => {
  // code 1 is ≈ in the math font but | in the symbol font.
  const objects = new Map([
    [1, '<< /Type /Font /BaseFont /AAA+Universal-GreekwithMathPi /Encoding 2 0 R >>'],
    [2, '<< /Type /Encoding /Differences [1 /H11015] >>'],
    [3, '<< /Type /Font /BaseFont /BBB+MathematicalPi-Three /Encoding 4 0 R >>'],
    [4, '<< /Type /Encoding /Differences [1 /H20841] >>'],
  ]);
  const map = extractEncodingsFromObjects(objects);
  assert.equal(map.get('AAA+Universal-GreekwithMathPi').get(1), '≈');
  assert.equal(map.get('BBB+MathematicalPi-Three').get(1), '|');
});

test('extractEncodingsFromObjects handles an inline /Encoding dictionary', () => {
  const objects = new Map([
    [7, '<< /Type /Font /BaseFont /XYZ+Sym /Encoding << /Type /Encoding /Differences [4 /H11021] >> >>'],
  ]);
  assert.equal(extractEncodingsFromObjects(objects).get('XYZ+Sym').get(4), '<');
});

test('parseObjectStream slices numbered objects from an ObjStm body', () => {
  // header: "10 0 11 20" → obj 10 at offset 0, obj 11 at offset 20 (relative to first).
  const first = 12; // length of "10 0 11 20 " padded
  const header = '10 0 11 20  ';
  const body = 'AAAAAAAAAAAAAAAAAAAABBBBBBBB';
  const content = header.slice(0, first) + body;
  const objects = new Map();
  parseObjectStream(content, 2, first, objects);
  assert.equal(objects.get(10), 'AAAAAAAAAAAAAAAAAAAA');
  assert.equal(objects.get(11), 'BBBBBBBB');
});
