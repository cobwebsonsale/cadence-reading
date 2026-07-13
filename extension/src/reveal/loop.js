import { planChunks, TARGET_LINES, MIN_TAIL_LINES } from './chunker.js';
import { createScroller } from './scroller.js';
import { createFocus } from './focus.js';

const BOOST_MULTIPLIER = 6;
const MAX_CHARS_PER_FRAME = 2000;
const BUILD_LOOKAHEAD = 3000;
const POSITION_SAVE_MS = 1000;
const RUNWAY_SPAN = 0.84;

export function createLoop(cfg) {
  const { steps, hud, onComment, onEnd, onRewind, onPosition, onNeedMore } = cfg;
  const startIndex = cfg.startIndex || 0;
  let charsPerSec = cfg.settings.charsPerSec;

  function ensureAhead() {
    onNeedMore?.(stepIndex + BUILD_LOOKAHEAD);
  }

  const scroller = createScroller();
  const focus = createFocus(cfg.root || null);
  const contentEl = cfg.root?.querySelector('.dr-content') || null;

  let stepIndex = 0;
  let state = 'AWAIT_KEYPRESS';
  let rafId = 0;
  let lastTimestamp = 0;
  let charBudget = 0;
  let boost = false;
  let lastRevealedEl = null;
  let currentLineTop = -1;
  let linesSincePause = 0;
  let lastPositionAt = 0;

  let currentPara = null;
  let openParaEl = null;
  let pauseBeforeChars = new Set();
  let lastRewindStart = -1;
  let endMark = null;

  const cursor = document.createElement('span');
  cursor.className = 'dr-cursor';

  function play() {
    if (state === 'ENDED' || state === 'PLAYING') return;
    state = 'PLAYING';
    clearEndMark();
    ensureAhead();
    hideCursor();
    focus.startRender();
    lastTimestamp = 0;
    charBudget = 0;
    linesSincePause = 0;
    hud.setStatus('');
    rafId = requestAnimationFrame(tick);
  }

  function enterAwait(step) {
    state = 'AWAIT_KEYPRESS';
    cancelAnimationFrame(rafId);
    clearEndMark();
    ensureAhead();
    openPara(nextCharEl()?.closest('.dr-para'));
    showCursor();
    hud.setStatus(step.boundary === 'section' ? 'Section break' : '');
    hud.setHidden(false);
    updateHud();
    onPosition?.(stepIndex, false);
  }

  function start() {
    if (startIndex > 0) seekTo(startIndex);
    else play();
  }

  function seekTo(index) {
    const clamped = Math.max(0, Math.min(index, steps.length));
    for (let j = 0; j < clamped; j++) {
      if (steps[j].kind === 'char') {
        steps[j].el.setAttribute('data-revealed', 'true');
        lastRevealedEl = steps[j].el;
      }
    }
    stepIndex = clamped;
    currentPara = null;
    currentLineTop = -1;
    pauseBeforeChars = new Set();
    litFrontierChunk();
    if (lastRevealedEl) scroller.frontierIntoView(lastRevealedEl);
    if (stepIndex >= steps.length) {
      endPlayback(false);
    } else {
      enterAwait({ boundary: 'sentence' });
    }
  }

  function advance() {
    if (state !== 'AWAIT_KEYPRESS') return;
    lastRewindStart = -1;
    ensureAhead();
    hideCursor();
    scroller.toAnchor(nextCharEl(), () => play());
  }

  function litFrontierChunk() {
    for (let j = focusSectionStart(stepIndex); j < stepIndex; j++) {
      if (steps[j].kind === 'char') focus.mark(steps[j].el);
    }
  }

  function openPara(para) {
    if (para === openParaEl) return;
    openParaEl?.classList.remove('dr-current-para');
    openParaEl = para;
    openParaEl?.classList.add('dr-current-para');
    updateRunway(para);
  }

  function updateRunway(para) {
    if (!contentEl || !para) return;
    const viewport = contentEl.closest('.dr-stage')?.clientHeight || 0;
    const runway = Math.max(0, RUNWAY_SPAN * viewport - para.offsetHeight);
    contentEl.style.paddingBottom = `${runway}px`;
  }

  function collapseRunway() {
    if (!contentEl) return;
    contentEl.classList.add('dr-content-tail');
    contentEl.style.paddingBottom = '';
  }

  // Wrapped lines left in the run, laying out still-collapsed paragraphs to measure them.
  function runTailLines(fromStep) {
    const paras = [];
    const seen = new Set();
    for (let j = fromStep; j < steps.length; j++) {
      if (steps[j].kind === 'pause') break;
      if (steps[j].kind !== 'char') continue;
      const para = steps[j].el.closest('.dr-para');
      if (para && !para.closest('.dr-cell') && !seen.has(para)) {
        seen.add(para);
        paras.push(para);
      }
    }
    const collapsed = paras.filter((p) => p.offsetHeight === 0);
    for (const p of collapsed) p.style.display = 'block';
    let lines = 0;
    for (const p of paras) lines += wrappedLineCount(p);
    for (const p of collapsed) p.style.display = '';
    return lines;
  }

  function tick(timestamp) {
    if (state !== 'PLAYING') return;
    if (!lastTimestamp) lastTimestamp = timestamp;
    const effectiveCps = charsPerSec * (boost ? BOOST_MULTIPLIER : 1);
    charBudget += (timestamp - lastTimestamp) * (effectiveCps / 1000);
    lastTimestamp = timestamp;

    let processed = 0;
    while (charBudget >= 1 && stepIndex < steps.length && processed++ < MAX_CHARS_PER_FRAME) {
      const step = steps[stepIndex];
      if (step.kind === 'char') {
        const el = step.el;
        const para = el.closest('.dr-para');
        if (para !== currentPara) {
          openPara(para);
          currentPara = para;
          currentLineTop = -1;
          // A table row reveals as one unit; don't chunk within its cells.
          const inCell = !!para?.closest('.dr-cell');
          pauseBeforeChars = para && !inCell ? planChunks(para) : new Set();
          // Chunk a grouped run like planChunks does one paragraph, but never strand a short tail.
          if (
            !boost &&
            !inCell &&
            linesSincePause >= TARGET_LINES &&
            runTailLines(stepIndex) >= MIN_TAIL_LINES
          ) {
            linesSincePause = 0;
            return enterAwait({ boundary: 'sentence' });
          }
        }
        if (el.offsetTop !== currentLineTop) {
          currentLineTop = el.offsetTop;
          // Bullets/objects box-align a few px off the text but share its line.
          if (!step.instant) linesSincePause++;
          scroller.pinFrontier(el);
        }
        if (!boost && pauseBeforeChars.has(el)) {
          pauseBeforeChars.delete(el);
          return enterAwait({ boundary: 'sentence' });
        }
        charBudget -= 1;
        revealChar(el);
        stepIndex++;
      } else if (step.kind === 'comment') {
        onComment(step.commentId);
        stepIndex++;
      } else if (step.kind === 'pause') {
        stepIndex++;
        lastRewindStart = -1;
        if (boost) {
          updateHud();
          continue;
        }
        return enterAwait(step);
      }
    }

    updateHud();

    // Boost never parks, so persist mid-play or lose progress since the last stop.
    if (timestamp - lastPositionAt >= POSITION_SAVE_MS) {
      lastPositionAt = timestamp;
      onPosition?.(stepIndex, false);
    }

    if (stepIndex >= steps.length) {
      ensureAhead();
      if (stepIndex >= steps.length) {
        endPlayback();
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function revealChar(el) {
    el.setAttribute('data-revealed', 'true');
    focus.mark(el);
    lastRevealedEl = el;
  }

  function showCursor() {
    const next = nextCharEl();
    cursor.classList.toggle('dr-cursor-list', !!next?.classList.contains('dr-bullet'));
    if (next) next.before(cursor);
    else if (lastRevealedEl) lastRevealedEl.after(cursor);
    else if (steps[0]?.el) steps[0].el.before(cursor);
  }

  function hideCursor() {
    cursor.remove();
  }

  function endPlayback(persist = true) {
    state = 'ENDED';
    hideCursor();
    collapseRunway();
    showEndMark();
    hud.setHidden(false);
    if (persist) onPosition?.(stepIndex, true);
    onEnd?.();
  }

  function showEndMark() {
    if (!contentEl) return;
    if (!endMark) {
      endMark = document.createElement('div');
      endMark.className = 'dr-end-mark';
      endMark.textContent = '❧';
      endMark.setAttribute('aria-hidden', 'true');
    }
    if (!endMark.isConnected) contentEl.appendChild(endMark);
  }

  function clearEndMark() {
    endMark?.remove();
    contentEl?.classList.remove('dr-content-tail');
  }

  function unrevealRange(from, to) {
    const paras = new Set();
    for (let j = from; j < to && j < steps.length; j++) {
      if (steps[j].kind !== 'char') continue;
      steps[j].el.removeAttribute('data-revealed');
      steps[j].el.classList.remove('dr-current-chunk');
      const para = steps[j].el.closest('.dr-para');
      if (para) paras.add(para);
    }
    return paras;
  }

  function rewind() {
    let target = sectionStartStepBefore(stepIndex);
    if (target === lastRewindStart) target = sectionStartStepBefore(target);
    lastRewindStart = target;

    unrevealRange(target, stepIndex);
    focus.reset();
    const targetPara = steps[target]?.el?.closest?.('.dr-para');
    if (targetPara) onRewind?.(targetPara);

    stepIndex = target;
    const targetEl = steps[target]?.kind === 'char' ? steps[target].el : null;
    currentPara = targetEl ? targetEl.closest('.dr-para') : null;
    openPara(currentPara);
    pauseBeforeChars = currentPara ? planChunks(currentPara) : new Set();
    if (targetEl) pauseBeforeChars.delete(targetEl);
    currentLineTop = targetEl ? targetEl.offsetTop : -1;
    state = 'AWAIT_KEYPRESS';
    cancelAnimationFrame(rafId);
    hideCursor();

    const firstChar = nextCharEl();
    if (firstChar) scroller.ensureVisible(firstChar);
    play();
  }

  // Navigate by chunk (grouped reveal units), not raw paragraphs, via step boundaries.
  function goToParagraph(delta) {
    if (delta > 0) {
      if (state === 'ENDED') return;
      goToStep(nextChunkStep(stepIndex));
    } else {
      goToStep(chunkStartStep(chunkStartStep(stepIndex) - 1));
    }
  }

  function chunkStartStep(from) {
    let j = Math.min(from, steps.length) - 1;
    while (j >= 0 && steps[j].kind !== 'pause') j--;
    return j + 1;
  }

  function nextChunkStep(from) {
    let j = from;
    while (j < steps.length && steps[j].kind !== 'pause') j++;
    while (j < steps.length && steps[j].kind === 'pause') j++;
    return j;
  }

  function goToStep(index) {
    cancelAnimationFrame(rafId);
    const clamped = Math.max(0, Math.min(index, steps.length));
    if (clamped > stepIndex) {
      for (let j = stepIndex; j < clamped; j++) {
        if (steps[j].kind === 'char') steps[j].el.setAttribute('data-revealed', 'true');
      }
    } else if (clamped < stepIndex) {
      for (const para of unrevealRange(clamped, stepIndex)) onRewind?.(para);
    }

    focus.reset();
    stepIndex = clamped;
    lastRewindStart = -1;
    currentPara = null;
    currentLineTop = -1;
    pauseBeforeChars = new Set();
    lastRevealedEl = null;
    for (let j = clamped - 1; j >= 0; j--) {
      if (steps[j].kind === 'char') {
        lastRevealedEl = steps[j].el;
        break;
      }
    }
    hideCursor();
    litFrontierChunk();

    if (stepIndex >= steps.length) {
      endPlayback();
      return;
    }
    const nextEl = nextCharEl();
    openPara(nextEl?.closest('.dr-para'));
    if (nextEl) scroller.ensureVisible(nextEl);
    enterAwait({ boundary: 'sentence' });
  }

  function sectionStartStepBefore(step) {
    let lastChar = -1;
    for (let j = Math.min(step, steps.length) - 1; j >= 0; j--) {
      if (steps[j].kind === 'char') {
        lastChar = j;
        break;
      }
    }
    if (lastChar < 0) return 0;
    const para = steps[lastChar].el.closest('.dr-para');
    if (!para) return 0;
    const paraStart = firstStepIndexForParagraph(steps, para);
    const boundaries = planChunks(para);
    let start = paraStart;
    for (let j = paraStart; j <= lastChar; j++) {
      if (steps[j].kind === 'char' && boundaries.has(steps[j].el)) start = j;
    }
    return start;
  }

  function focusSectionStart(step) {
    const start = sectionStartStepBefore(step);
    const para = steps[start]?.el?.closest?.('.dr-para');
    if (!para) return start;
    const paraStart = firstStepIndexForParagraph(steps, para);
    const blockStart = chunkStartStep(paraStart + 1);
    return paraStart > blockStart ? blockStart : start;
  }

  function nextCharEl() {
    for (let j = stepIndex; j < steps.length; j++) {
      if (steps[j].kind === 'char') return steps[j].el;
    }
    return null;
  }

  function setSpeed(n) {
    charsPerSec = n;
    hud.setSpeed(n);
  }

  function setBoost(on) {
    const wasBoosting = boost;
    boost = on;
    if (on && !wasBoosting && state === 'AWAIT_KEYPRESS') play();
  }

  function setFocus(on) {
    focus.setEnabled(on);
  }

  function updateHud() {
    hud.setSpeed(charsPerSec);
  }

  function destroy() {
    state = 'ENDED';
    cancelAnimationFrame(rafId);
    hideCursor();
    focus.destroy();
  }

  return {
    play,
    start,
    advance,
    rewind,
    goToParagraph,
    setSpeed,
    setBoost,
    setFocus,
    destroy,
    position: () => stepIndex,
    get state() {
      return state;
    },
  };
}

function wrappedLineCount(para) {
  let lines = 0;
  let prevTop = null;
  for (const el of para.querySelectorAll('.dr-char')) {
    if (el.hasAttribute('data-instant')) continue;
    const top = el.offsetTop;
    if (top !== prevTop) {
      lines++;
      prevTop = top;
    }
  }
  return lines || 1;
}

function firstStepIndexForParagraph(steps, para) {
  for (let j = 0; j < steps.length; j++) {
    const step = steps[j];
    if (step.kind === 'char' && step.el.closest('.dr-para') === para) return j;
  }
  return -1;
}
