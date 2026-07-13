import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import './helpers.js';
import { buildParagraph, charSteps, mockHud, installRaf, LINE_H } from './helpers.js';
import { createLoop } from '../extension/src/reveal/loop.js';
import { buildBlockSteps, buildSteps } from '../extension/src/reveal/walker.js';

let raf;
let clock;

beforeEach(() => {
  raf = installRaf();
  clock = 1;
});
afterEach(() => {
  raf.restore();
});

function pump() {
  raf.frame((clock += 1));
  raf.frame((clock += 100000));
}

function makeLoop(para, extra = {}) {
  return createLoop({
    steps: charSteps(para),
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    ...extra,
  });
}

const revealedCount = (steps) => steps.filter((s) => s.el.hasAttribute('data-revealed')).length;

test('parking at a structural boundary keeps the upcoming paragraph laid out', () => {
  // The upcoming paragraph must stay measurable (not collapsed) so the parked
  // cursor is visible and the next advance can scroll it up to the anchor. A
  // heading is a structural boundary that parks the reveal (adjacent body
  // paragraphs group into one unit and would not park).
  const root = document.createElement('div');
  const p1 = buildParagraph(1, { paragraphIndex: 0 });
  const heading = buildParagraph(1, { paragraphIndex: 1 });
  heading.remove();
  const h = document.createElement('h2');
  h.className = 'dr-para';
  h.setAttribute('data-paragraph-index', '1');
  for (const c of heading.children) h.appendChild(c);
  root.append(p1, h);
  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  const loop = createLoop({ steps, settings: { charsPerSec: 1000 }, hud: mockHud(), onComment: () => {} });
  loop.play();
  pump();
  assert.equal(loop.state, 'AWAIT_KEYPRESS', 'parked at the boundary before the heading');
  assert.ok(h.classList.contains('dr-current-para'), 'the upcoming heading is kept open at the boundary');
  loop.destroy();
});

test('a grouped run of short paragraphs chunks by line count, not all at once', () => {
  const root = document.createElement('div');
  for (let i = 0; i < 12; i++) root.appendChild(buildParagraph(1, { paragraphIndex: i }));
  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  const loop = createLoop({ steps, settings: { charsPerSec: 1000 }, hud: mockHud(), onComment: () => {} });
  loop.play();
  pump();
  assert.equal(loop.state, 'AWAIT_KEYPRESS', 'paused mid-run rather than revealing every line at once');
  const revealed = revealedCount(steps);
  assert.ok(revealed > 0 && revealed < steps.length, 'revealed a line-based chunk, not the whole run');
  loop.destroy();
});

test('a grouped run prints whole rather than strand a short tail', () => {
  const root = document.createElement('div');
  root.appendChild(buildParagraph(8, { paragraphIndex: 0 }));
  root.appendChild(buildParagraph(2, { paragraphIndex: 1 }));
  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  const loop = createLoop({ steps, settings: { charsPerSec: 1000 }, hud: mockHud(), onComment: () => {} });
  loop.play();
  pump();
  assert.equal(revealedCount(steps), steps.length, 'the 2-line tail is not orphaned');
  loop.destroy();
});

test('a grouped run still chunks when the tail is substantial', () => {
  const root = document.createElement('div');
  root.appendChild(buildParagraph(7, { paragraphIndex: 0 }));
  root.appendChild(buildParagraph(5, { paragraphIndex: 1 }));
  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  const loop = createLoop({ steps, settings: { charsPerSec: 1000 }, hud: mockHud(), onComment: () => {} });
  loop.play();
  pump();
  assert.equal(loop.state, 'AWAIT_KEYPRESS', 'paused before the 5-line tail');
  assert.ok(revealedCount(steps) < steps.length);
  loop.destroy();
});

test('an instant bullet does not count as its own wrapped line', () => {
  // A bullet's offsetTop sits a few px off the text on the same visual line; it
  // must count as one line, else a short list hits the line cap and splits mid-run.
  const bulletItem = (paragraphIndex, top) => {
    const p = document.createElement('p');
    p.className = 'dr-para dr-list-item';
    p.setAttribute('data-paragraph-index', String(paragraphIndex));
    const bullet = document.createElement('span');
    bullet.className = 'dr-char dr-bullet';
    bullet.setAttribute('data-instant', 'true');
    bullet.textContent = '● ';
    Object.defineProperty(bullet, 'offsetTop', { value: top - 3, configurable: true });
    p.appendChild(bullet);
    for (const ch of 'word') {
      const s = document.createElement('span');
      s.className = 'dr-char';
      s.textContent = ch;
      Object.defineProperty(s, 'offsetTop', { value: top, configurable: true });
      p.appendChild(s);
    }
    return p;
  };

  const root = document.createElement('div');
  for (let i = 0; i < 6; i++) root.appendChild(bulletItem(i, (i + 1) * LINE_H));
  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  const loop = createLoop({ steps, settings: { charsPerSec: 1000 }, hud: mockHud(), onComment: () => {} });
  loop.play();
  pump();
  assert.equal(revealedCount(steps), steps.length, 'the whole 6-line list revealed without a phantom-line split');
  loop.destroy();
});

test('start() with a saved position restores it instead of replaying from the start', () => {
  const para = buildParagraph(5);
  const steps = charSteps(para);
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    startIndex: 10,
  });
  loop.start();
  assert.equal(revealedCount(steps), 10, 'revealed exactly up to the saved index, not 0');
  assert.equal(loop.state, 'AWAIT_KEYPRESS');
  assert.equal(loop.position(), 10);
  loop.destroy();
});

test('holding to boost still persists progress mid-play', () => {
  const root = document.createElement('div');
  for (let i = 0; i < 12; i++) root.appendChild(buildParagraph(2, { paragraphIndex: i }));
  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  let lastSaved = -1;
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    // Boost skips every park, so before the periodic save this stayed unset.
    onPosition: (index, done) => {
      if (!done) lastSaved = index;
    },
  });
  loop.setBoost(true);
  loop.play();
  pump();
  assert.ok(lastSaved > 0, 'position was saved during boosted play');
  loop.destroy();
});

test('a table row reveals as one unit, not chunked across its cells', () => {
  const root = document.createElement('div');
  const tr = document.createElement('tr');
  // 4 cells of 3 lines each: crossing into a later cell would trip the 8-line cap.
  for (let c = 0; c < 4; c++) {
    const td = document.createElement('td');
    td.className = 'dr-cell';
    td.appendChild(buildParagraph(3, { paragraphIndex: c }));
    tr.appendChild(td);
  }
  root.appendChild(tr);
  const steps = buildSteps(root, { pauseAt: 'paragraph' });
  const loop = createLoop({ steps, settings: { charsPerSec: 1000 }, hud: mockHud(), onComment: () => {} });
  loop.play();
  pump();
  const chars = steps.filter((s) => s.kind === 'char').length;
  assert.equal(revealedCount(steps), chars, 'the whole row revealed without a mid-row chunk pause');
  loop.destroy();
});

test('starts parked in AWAIT_KEYPRESS', () => {
  const loop = makeLoop(buildParagraph(3));
  assert.equal(loop.state, 'AWAIT_KEYPRESS');
  loop.destroy();
});

test('play reveals a whole short paragraph and ends', () => {
  const para = buildParagraph(3);
  const steps = charSteps(para);
  let ended = false;
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    onEnd: () => {
      ended = true;
    },
  });
  loop.play();
  assert.equal(loop.state, 'PLAYING');
  pump();
  assert.equal(loop.state, 'ENDED');
  assert.ok(ended, 'onEnd fired');
  assert.equal(revealedCount(steps), steps.length, 'all chars revealed');
  loop.destroy();
});

test('pauses at a planned chunk boundary and resumes on advance', () => {
  const para = buildParagraph(14, { sentenceEnds: [6] });
  const steps = charSteps(para);
  const loop = makeLoop(para);
  loop.play();
  pump();
  assert.equal(loop.state, 'AWAIT_KEYPRESS', 'parked at the chunk boundary');
  const atPause = revealedCount(steps);
  assert.ok(atPause > 0 && atPause < steps.length, 'revealed a chunk, not all');

  loop.advance();
  pump();
  assert.equal(loop.state, 'ENDED');
  assert.equal(revealedCount(steps), steps.length);
  loop.destroy();
});

test('shows the cursor while parked and removes it on resume', () => {
  const para = buildParagraph(14, { sentenceEnds: [6] });
  const loop = makeLoop(para);
  loop.play();
  pump();
  assert.ok(para.querySelector('.dr-cursor'), 'cursor present at the pause');
  loop.advance();
  assert.equal(para.querySelector('.dr-cursor'), null, 'cursor removed on resume');
  loop.destroy();
});

test('boost skips pauses and reveals straight through', () => {
  const para = buildParagraph(14, { sentenceEnds: [6] });
  const steps = charSteps(para);
  const loop = makeLoop(para);
  loop.play();
  loop.setBoost(true);
  pump();
  assert.equal(loop.state, 'ENDED', 'no pause while boosting');
  assert.equal(revealedCount(steps), steps.length);
  loop.destroy();
});

test('setBoost resumes a parked loop', () => {
  const loop = makeLoop(buildParagraph(14, { sentenceEnds: [6] }));
  loop.play();
  pump();
  assert.equal(loop.state, 'AWAIT_KEYPRESS');
  loop.setBoost(true);
  assert.equal(loop.state, 'PLAYING');
  loop.destroy();
});

test('setSpeed reports the new speed to the HUD', () => {
  const hud = mockHud();
  const loop = createLoop({
    steps: charSteps(buildParagraph(3)),
    settings: { charsPerSec: 1000 },
    hud,
    onComment: () => {},
  });
  loop.setSpeed(45);
  assert.ok(hud.calls.speed.includes(45));
  loop.destroy();
});

test('rewind re-hides the section it is in', () => {
  const para = buildParagraph(10);
  const steps = charSteps(para);
  const loop = makeLoop(para, { onRewind: () => {} });
  loop.play();
  pump();
  assert.ok(revealedCount(steps) > 0, 'some chars revealed before rewind');
  loop.rewind();
  assert.equal(revealedCount(steps), 0, 'all chars in the single section re-hidden');
  loop.destroy();
});

test('rewind re-hides only the current section, not the whole paragraph', () => {
  const para = buildParagraph(14, { sentenceEnds: [6] });
  const steps = charSteps(para);
  const loop = makeLoop(para, { onRewind: () => {} });
  loop.play();
  loop.setBoost(true);
  pump();
  assert.equal(revealedCount(steps), steps.length, 'whole paragraph revealed');
  loop.rewind();
  const remaining = revealedCount(steps);
  assert.ok(remaining > 0, 'the earlier section stays revealed');
  assert.ok(remaining < steps.length, 'the current section is re-hidden');
  loop.destroy();
});

test('rewind to a mid-paragraph section renders it instead of stalling on its boundary', () => {
  const para = buildParagraph(14, { sentenceEnds: [6] });
  const steps = charSteps(para);
  const loop = makeLoop(para, { onRewind: () => {} });
  loop.play();
  loop.setBoost(true);
  pump();
  assert.equal(revealedCount(steps), steps.length, 'whole paragraph revealed');
  loop.setBoost(false);

  loop.rewind();
  pump();
  assert.equal(
    revealedCount(steps),
    steps.length,
    'the mid-paragraph section re-rendered rather than parking on its first char'
  );
  loop.destroy();
});

test('a completed paragraph render resets the back-press chain', () => {
  const first = buildParagraph(3, { paragraphIndex: 0 });
  const second = buildParagraph(3, { paragraphIndex: 1 });
  const third = buildParagraph(3, { paragraphIndex: 2 });
  const steps = [
    ...charSteps(first),
    { kind: 'pause', boundary: 'paragraph' },
    ...charSteps(second),
    { kind: 'pause', boundary: 'paragraph' },
    ...charSteps(third),
  ];
  const firstCount = first.querySelectorAll('.dr-char').length;
  const revealedIn = (para) =>
    [...para.querySelectorAll('.dr-char')].filter((c) => c.hasAttribute('data-revealed')).length;
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
  });

  loop.play();
  loop.setBoost(true);
  pump();
  loop.setBoost(false);

  loop.rewind();
  loop.rewind();
  pump();

  loop.rewind();
  pump();
  assert.equal(
    revealedIn(first),
    firstCount,
    'first paragraph stays revealed — the completed render cleared the chain'
  );
  loop.destroy();
});

test('buildBlockSteps yields one block\'s char steps plus a trailing pause', () => {
  const para = buildParagraph(2);
  const steps = buildBlockSteps(para, { pauseAt: 'paragraph' });
  const chars = steps.filter((s) => s.kind === 'char').length;
  assert.equal(chars, para.querySelectorAll('.dr-char').length);
  assert.equal(steps[steps.length - 1].kind, 'pause', 'trailing paragraph pause included');
});

test('onNeedMore extends the step list on demand (windowed build) and still ends', () => {
  const windows = [0, 1, 2].map((i) => [
    ...charSteps(buildParagraph(3, { paragraphIndex: i })),
    { kind: 'pause', boundary: 'paragraph' },
  ]);
  const steps = [...windows[0]]; // start with only the first paragraph built
  let built = 1;
  let needMoreCalls = 0;
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    totalParagraphs: 3,
    onNeedMore: (target) => {
      needMoreCalls++;
      while (steps.length < target && built < windows.length) {
        for (const s of windows[built]) steps.push(s);
        built++;
      }
    },
  });

  loop.play();
  loop.setBoost(true);
  pump();

  assert.ok(needMoreCalls > 0, 'the loop asked for more steps');
  assert.equal(built, 3, 'all windows were built on demand');
  assert.equal(loop.state, 'ENDED', 'reveal completes across the extended steps');
  const chars = steps.filter((s) => s.kind === 'char');
  assert.equal(chars.filter((s) => s.el.hasAttribute('data-revealed')).length, chars.length);
  loop.destroy();
});

test('goToParagraph jumps forward and back by whole paragraphs, parked at the start', () => {
  const first = buildParagraph(3, { paragraphIndex: 0 });
  const second = buildParagraph(3, { paragraphIndex: 1 });
  const third = buildParagraph(3, { paragraphIndex: 2 });
  const steps = [
    ...charSteps(first),
    { kind: 'pause', boundary: 'paragraph' },
    ...charSteps(second),
    { kind: 'pause', boundary: 'paragraph' },
    ...charSteps(third),
  ];
  const full = first.querySelectorAll('.dr-char').length;
  const revealedIn = (para) =>
    [...para.querySelectorAll('.dr-char')].filter((c) => c.hasAttribute('data-revealed')).length;
  const loop = createLoop({ steps, settings: { charsPerSec: 1000 }, hud: mockHud(), onComment: () => {} });

  loop.goToParagraph(1); // reveal para 0, park at start of para 1
  assert.equal(loop.state, 'AWAIT_KEYPRESS');
  assert.equal(revealedIn(first), full);
  assert.equal(revealedIn(second), 0);

  loop.goToParagraph(1); // reveal para 1, park at start of para 2
  assert.equal(revealedIn(second), full);
  assert.equal(revealedIn(third), 0);

  loop.goToParagraph(-1); // re-hide para 1, park at its start
  assert.equal(revealedIn(second), 0);
  assert.equal(revealedIn(first), full, 'earlier paragraphs stay revealed');
  loop.destroy();
});

test('focus keeps a whole grouped run (list) opaque, not just its last line', () => {
  const item1 = buildParagraph(1, { paragraphIndex: 0 });
  const item2 = buildParagraph(1, { paragraphIndex: 1 });
  const item3 = buildParagraph(1, { paragraphIndex: 2 });
  const next = buildParagraph(1, { paragraphIndex: 3 });
  const steps = [
    ...charSteps(item1),
    ...charSteps(item2),
    ...charSteps(item3),
    { kind: 'pause', boundary: 'paragraph' },
    ...charSteps(next),
  ];
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    root: document.createElement('div'),
  });
  loop.setFocus(true);
  loop.goToParagraph(1); // reveal the grouped run, park at the next block

  const allLit = (para) =>
    [...para.querySelectorAll('.dr-char')].every((c) => c.classList.contains('dr-current-chunk'));
  assert.ok(allLit(item1) && allLit(item2) && allLit(item3), 'every line of the run stays opaque');
  loop.destroy();
});

test('rewind at a paragraph boundary steps back, never forward into the next paragraph', () => {
  const first = buildParagraph(3, { paragraphIndex: 0 });
  const second = buildParagraph(3, { paragraphIndex: 1 });
  const secondSteps = charSteps(second);
  const steps = [
    ...charSteps(first),
    { kind: 'pause', boundary: 'paragraph' },
    ...secondSteps,
  ];
  const firstCount = first.querySelectorAll('.dr-char').length;
  const revealed = () =>
    steps.filter((s) => s.el && s.el.hasAttribute('data-revealed')).length;
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
  });
  loop.play();
  pump();
  assert.equal(loop.state, 'AWAIT_KEYPRESS', 'parked at the paragraph boundary');
  assert.equal(revealed(), firstCount, 'first paragraph revealed, second not');

  loop.rewind();
  pump();
  assert.ok(
    secondSteps.every((s) => !s.el.hasAttribute('data-revealed')),
    'the next paragraph stays hidden'
  );
  assert.ok(revealed() <= firstCount, 'did not advance past the boundary');
  loop.destroy();
});

test('repeated rewind steps back through previous paragraphs', () => {
  const first = buildParagraph(3, { paragraphIndex: 0 });
  const second = buildParagraph(3, { paragraphIndex: 1 });
  const steps = [...charSteps(first), ...charSteps(second)];
  const firstCount = first.querySelectorAll('.dr-char').length;
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    onRewind: () => {},
  });
  loop.play();
  loop.setBoost(true);
  pump();
  assert.equal(revealedCount(steps), steps.length, 'everything revealed');

  loop.rewind();
  assert.equal(revealedCount(steps), firstCount, 'first back re-hides only the current paragraph');

  loop.rewind();
  assert.equal(revealedCount(steps), 0, 'second back steps into the previous paragraph');
  loop.destroy();
});

test('destroy stops the loop', () => {
  const loop = makeLoop(buildParagraph(3));
  loop.play();
  loop.destroy();
  assert.equal(loop.state, 'ENDED');
});

test('keeps the HUD visible while reading', () => {
  const hud = mockHud();
  const loop = createLoop({
    steps: charSteps(buildParagraph(14, { sentenceEnds: [6] })),
    settings: { charsPerSec: 1000 },
    hud,
    onComment: () => {},
  });
  loop.play();
  pump();
  assert.equal(loop.state, 'AWAIT_KEYPRESS');
  assert.ok(!hud.calls.hidden.includes(true), 'HUD is never auto-hidden');
  loop.destroy();
});

test('start() with a startIndex seeks: reveals up to it and parks', () => {
  const para = buildParagraph(5);
  const steps = charSteps(para);
  const half = Math.floor(steps.length / 2);
  const loop = createLoop({
    steps,
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    startIndex: half,
  });
  loop.start();
  assert.equal(loop.state, 'AWAIT_KEYPRESS');
  assert.equal(revealedCount(steps), half);

  loop.advance();
  pump();
  assert.equal(loop.state, 'ENDED');
  assert.equal(revealedCount(steps), steps.length);
  loop.destroy();
});

test('reports position at each pause and signals done on completion', () => {
  const positions = [];
  let done = false;
  const para = buildParagraph(14, { sentenceEnds: [6] });
  const loop = createLoop({
    steps: charSteps(para),
    settings: { charsPerSec: 1000 },
    hud: mockHud(),
    onComment: () => {},
    onPosition: (index, finished) => (finished ? (done = true) : positions.push(index)),
  });
  loop.start();
  pump();
  assert.ok(positions.length >= 1, 'position reported at the pause');
  loop.advance();
  pump();
  assert.ok(done, 'done signalled at the end');
  loop.destroy();
});
