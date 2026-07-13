import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installRaf, mockHud } from './helpers.js';

import { buildBlock } from '../extension/src/pdf/pdf-builder.js';
import { buildSteps } from '../extension/src/reveal/walker.js';
import { createLoop } from '../extension/src/reveal/loop.js';

// Exercises the whole PDF reveal chain: extracted blocks -> DOM (pdf-builder) ->
// ordered step list (walker) -> rAF reveal state machine (loop), driven to the end.
test('a document of blocks builds, steps, and fully reveals through the loop', () => {
  const run = (text) => ({ text, bold: false, italic: false });
  const blocks = [
    { kind: 'paragraph', runs: [run('Hello world.')] },
    { kind: 'paragraph', heading: true, runs: [run('A Heading')] },
    { kind: 'paragraph', runs: [run('Second paragraph here.')] },
  ];

  const root = document.createElement('div');
  blocks.forEach((b, i) => root.appendChild(buildBlock(b, i)));

  const totalChars = root.querySelectorAll('.dr-char').length;
  assert.ok(totalChars > 0, 'pdf-builder produced char spans');

  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  assert.ok(steps.some((s) => s.kind === 'pause'), 'a paragraph boundary exists');

  const raf = installRaf();
  let clock = 1;
  const pump = () => {
    raf.frame((clock += 1));
    raf.frame((clock += 100000)); // huge budget so a PLAYING burst finishes in one frame
  };

  const positions = [];
  let ended = false;
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    onEnd: () => (ended = true),
    onPosition: (index) => positions.push(index),
  });

  try {
    loop.start();
    let guard = 0;
    while (loop.state !== 'ENDED' && guard++ < 200) {
      pump();
      if (loop.state === 'AWAIT_KEYPRESS') loop.advance();
    }

    assert.equal(loop.state, 'ENDED', 'loop reached the end');
    assert.ok(ended, 'onEnd fired');
    const revealed = [...root.querySelectorAll('.dr-char')].filter((s) => s.hasAttribute('data-revealed'));
    assert.equal(revealed.length, totalChars, 'every char was revealed');
    assert.equal(positions[positions.length - 1], steps.length, 'final position is the end index');
  } finally {
    loop.destroy();
    raf.restore();
  }
});
