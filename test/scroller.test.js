import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import './helpers.js';
import { buildStage, childOf, installRaf } from './helpers.js';
import { createScroller } from '../extension/src/reveal/scroller.js';

let raf;
beforeEach(() => {
  raf = installRaf();
  globalThis.matchMedia = () => ({ matches: false });
});
afterEach(() => raf.restore());
const settle = () => {
  raf.frame(0);
  raf.frame(10000);
};

test('pinFrontier nudges up when a line dips below the safety line', () => {
  const stage = buildStage({ height: 1000, scrollTop: 0 });
  const el = childOf(stage, { top: 940, bottom: 970 });
  createScroller().pinFrontier(el);
  assert.equal(stage.scrollTop, 20);
});

test('pinFrontier is a no-op while the frontier is above the safety line', () => {
  const stage = buildStage({ height: 1000, scrollTop: 0 });
  const el = childOf(stage, { top: 870, bottom: 900 });
  createScroller().pinFrontier(el);
  assert.equal(stage.scrollTop, 0);
});

test('toAnchor smooth-flips the next text up to the anchor when at the bottom', () => {
  const stage = buildStage({ height: 1000, scrollTop: 0, scrollHeight: 5000 });
  const next = childOf(stage, { top: 900 });
  let done = false;
  createScroller().toAnchor(next, () => {
    done = true;
  });
  raf.frame(0);
  assert.equal(done, false);
  raf.frame(130);
  assert.ok(stage.scrollTop > 0 && stage.scrollTop < 750);
  raf.frame(10000);
  assert.equal(stage.scrollTop, 750);
  assert.ok(done);
});

test('the flip uses a scrollTop tween, not scrollTo', () => {
  const stage = buildStage({ height: 1000, scrollTop: 0, scrollHeight: 5000 });
  let usedScrollTo = false;
  stage.scrollTo = () => {
    usedScrollTo = true;
  };
  const next = childOf(stage, { top: 900 });
  createScroller().toAnchor(next, () => {});
  settle();
  assert.equal(stage.scrollTop, 750);
  assert.equal(usedScrollTo, false);
});

test('toAnchor does not scroll when there is still room', () => {
  const stage = buildStage({ height: 1000, scrollTop: 0 });
  const next = childOf(stage, { top: 500 });
  let done = false;
  createScroller().toAnchor(next, () => {
    done = true;
  });
  assert.equal(stage.scrollTop, 0);
  assert.ok(done);
});

test('toAnchor clamps the target to the max scroll position', () => {
  const stage = buildStage({ height: 1000, scrollTop: 0, scrollHeight: 2000 });
  const next = childOf(stage, { top: 5000 });
  createScroller().toAnchor(next, () => {});
  settle();
  assert.equal(stage.scrollTop, 1000);
});

test('toAnchor resolves immediately when there is no next element', () => {
  let done = false;
  createScroller().toAnchor(null, () => {
    done = true;
  });
  assert.ok(done);
});

test('reduced motion flips instantly (no animation frames)', () => {
  globalThis.matchMedia = () => ({ matches: true });
  const stage = buildStage({ height: 1000, scrollTop: 0, scrollHeight: 5000 });
  const next = childOf(stage, { top: 900 });
  let done = false;
  createScroller().toAnchor(next, () => {
    done = true;
  });
  assert.equal(stage.scrollTop, 750);
  assert.ok(done);
});
