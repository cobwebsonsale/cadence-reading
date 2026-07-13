import { test } from 'node:test';
import assert from 'node:assert/strict';

import { base64FromBytes, bytesFromBase64 } from '../extension/src/bytes.js';

test('base64FromBytes encodes to standard base64', () => {
  assert.equal(base64FromBytes(new Uint8Array([0x41, 0x42, 0x43])), 'QUJD'); // "ABC"
  assert.equal(base64FromBytes(new Uint8Array([])), '');
});

test('bytesFromBase64 decodes back to the original bytes', () => {
  assert.deepEqual([...bytesFromBase64('QUJD')], [0x41, 0x42, 0x43]);
});

test('base64 round-trips arbitrary bytes, including chunk boundaries', () => {
  const bytes = new Uint8Array(0x8000 + 500);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
  assert.deepEqual([...bytesFromBase64(base64FromBytes(bytes))], [...bytes]);
});
