import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDocRef,
  synthesizeUrl,
  stripGoogleSuffix,
  DRIVE_DOC_MIME,
  DRIVE_PDF_MIME,
} from '../extension/src/gdocs.js';

test('parseDocRef reads a doc id and its tab', () => {
  const ref = parseDocRef('https://docs.google.com/document/d/ABC123_x-y/edit?tab=t.7');
  assert.deepEqual(ref, { kind: 'doc', fileId: 'ABC123_x-y', tabId: 't.7' });
});

test('parseDocRef returns a null tab when none is present', () => {
  const ref = parseDocRef('https://docs.google.com/document/d/ABC/edit');
  assert.deepEqual(ref, { kind: 'doc', fileId: 'ABC', tabId: null });
});

test('parseDocRef reads a Drive PDF id', () => {
  assert.deepEqual(parseDocRef('https://drive.google.com/file/d/XYZ789/view'), {
    kind: 'pdf',
    fileId: 'XYZ789',
    tabId: null,
  });
});

test('parseDocRef returns null for unsupported URLs', () => {
  assert.equal(parseDocRef('https://example.com/x'), null);
  assert.equal(parseDocRef('https://docs.google.com/spreadsheets/d/ABC/edit'), null);
});

test('synthesizeUrl builds a doc URL, with and without a tab', () => {
  assert.equal(synthesizeUrl('ABC', DRIVE_DOC_MIME), 'https://docs.google.com/document/d/ABC/edit');
  assert.equal(
    synthesizeUrl('ABC', DRIVE_DOC_MIME, 't.7'),
    'https://docs.google.com/document/d/ABC/edit?tab=t.7'
  );
});

test('synthesizeUrl builds a Drive PDF URL', () => {
  assert.equal(synthesizeUrl('XYZ', DRIVE_PDF_MIME), 'https://drive.google.com/file/d/XYZ/view');
});

test('synthesizeUrl round-trips through parseDocRef', () => {
  const url = synthesizeUrl('ABC', DRIVE_DOC_MIME, 't.7');
  assert.deepEqual(parseDocRef(url), { kind: 'doc', fileId: 'ABC', tabId: 't.7' });
});

test('stripGoogleSuffix removes the product suffix', () => {
  assert.equal(stripGoogleSuffix('Quarterly Plan - Google Docs'), 'Quarterly Plan');
  assert.equal(stripGoogleSuffix('Budget - Google Sheets'), 'Budget');
  assert.equal(stripGoogleSuffix('Deck - Google Slides'), 'Deck');
  assert.equal(stripGoogleSuffix('report.pdf - Google Drive'), 'report.pdf');
});

test('stripGoogleSuffix leaves an unsuffixed title alone', () => {
  assert.equal(stripGoogleSuffix('Just a title'), 'Just a title');
  assert.equal(stripGoogleSuffix(''), '');
});
