import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roundHalfPt, dominantSize, median, isRotated, isMatrixItalic, columnEdges } from '../extension/src/pdf/geometry.js';

test('roundHalfPt snaps to the nearest half point', () => {
  assert.equal(roundHalfPt(9.2), 9);
  assert.equal(roundHalfPt(9.3), 9.5);
  assert.equal(roundHalfPt(10), 10);
});

test('dominantSize returns the highest-count key, 0 when empty', () => {
  assert.equal(dominantSize(new Map([[9, 3], [10, 5], [12, 1]])), 10);
  assert.equal(dominantSize(new Map()), 0);
  assert.equal(dominantSize(null), 0);
});

test('median handles odd, even, and empty inputs', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('isRotated detects a non-trivial b component', () => {
  assert.equal(isRotated([1, 0, 0, 1, 0, 0]), false);
  assert.equal(isRotated([0, 1, -1, 0, 0, 0]), true);
  assert.equal(isRotated(null), false);
});

test('isMatrixItalic detects shear without rotation', () => {
  assert.equal(isMatrixItalic([1, 0, 0.3, 1, 0, 0]), true);
  assert.equal(isMatrixItalic([1, 0, 0, 1, 0, 0]), false);
});

test('columnEdges returns one edge for a single column and falls back below 8 lines', () => {
  const at = (x0) => ({ x0 });
  assert.deepEqual(columnEdges([at(50)], 600), [50]); // <8 lines → first x
  const oneColumn = Array.from({ length: 10 }, () => at(72));
  assert.deepEqual(columnEdges(oneColumn, 600), [72]);
});

test('columnEdges finds two edges for a two-column page', () => {
  const at = (x0) => ({ x0 });
  const left = Array.from({ length: 8 }, () => at(72));
  const right = Array.from({ length: 8 }, () => at(320));
  const edges = columnEdges([...left, ...right], 600);
  assert.deepEqual(edges, [72, 320]);
});
