import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.WheelEvent = dom.window.WheelEvent;
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame ||= () => 0;
globalThis.cancelAnimationFrame ||= () => {};

export const LINE_H = 20;

export function buildParagraph(numLines, opts = {}) {
  const sentenceEnds = new Set(opts.sentenceEnds || []);
  const para = document.createElement('p');
  para.className = 'dr-para';
  para.setAttribute('data-paragraph-index', String(opts.paragraphIndex ?? 0));

  for (let line = 0; line < numLines; line++) {
    let text = 'word word';
    if (sentenceEnds.has(line)) text += '.';
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'dr-char';
      span.textContent = ch;
      Object.defineProperty(span, 'offsetTop', { value: line * LINE_H, configurable: true });
      para.appendChild(span);
    }
  }
  return para;
}

export const lineOf = (el) => el.offsetTop / LINE_H;

export function charSteps(para) {
  return [...para.querySelectorAll('.dr-char')].map((el) => ({ kind: 'char', el }));
}

export function buildStage({ top = 0, height = 1000, scrollHeight = 5000, scrollTop = 0 } = {}) {
  const stage = document.createElement('div');
  stage.className = 'dr-stage';
  document.body.appendChild(stage);
  stage.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0 });
  Object.defineProperty(stage, 'scrollHeight', { value: scrollHeight, configurable: true });
  let currentScrollTop = scrollTop;
  Object.defineProperty(stage, 'scrollTop', {
    get: () => currentScrollTop,
    set: (value) => {
      currentScrollTop = value;
    },
    configurable: true,
  });
  return stage;
}

export function childOf(stage, { top = 0, bottom = top }) {
  const el = document.createElement('span');
  stage.appendChild(el);
  el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0 });
  return el;
}

export function dispatchWheel(deltaY) {
  let event;
  try {
    event = new window.WheelEvent('wheel', { deltaY });
  } catch {
    event = new window.Event('wheel');
  }
  if (event.deltaY !== deltaY) {
    try {
      Object.defineProperty(event, 'deltaY', { value: deltaY, configurable: true });
    } catch {
      void 0;
    }
  }
  window.dispatchEvent(event);
}

export function mockHud() {
  const calls = { speed: [], para: [], status: [], hidden: [] };
  return {
    calls,
    setSpeed: (charsPerSec) => calls.speed.push(charsPerSec),
    setParagraph: (index, total) => calls.para.push([index, total]),
    setStatus: (text) => calls.status.push(text),
    setHidden: (hidden) => calls.hidden.push(hidden),
  };
}

export function installRaf() {
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  let queue = [];
  globalThis.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  return {
    frame(ts) {
      const pending = queue;
      queue = [];
      for (const cb of pending) cb(ts);
    },
    restore() {
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCancel;
    },
  };
}
