import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectSource } from '../extension/src/sources.js';

test('detectSource recognizes a Google Doc URL', () => {
  const s = detectSource('https://docs.google.com/document/d/ABC123_x-y/edit?tab=t.0');
  assert.equal(s?.type, 'docs');
});

test('detectSource recognizes a Drive PDF URL', () => {
  const s = detectSource('https://drive.google.com/file/d/XYZ789/view');
  assert.equal(s?.type, 'pdf');
});

test('detectSource returns null for unsupported URLs', () => {
  assert.equal(detectSource('https://example.com/whatever'), null);
  assert.equal(detectSource('https://docs.google.com/spreadsheets/d/ABC/edit'), null);
});
