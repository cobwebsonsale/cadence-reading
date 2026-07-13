const BOTTOM_BAND = 0.85;
const FRONTIER_LIMIT = 0.95;
const ANCHOR_TOP = 0.15;
const FLIP_DURATION_MS = 500;

export function createScroller() {
  let scroller = null;
  let tweenId = 0;

  const resolve = (el) => {
    if (!scroller && el) scroller = el.closest('.dr-stage');
    return scroller;
  };

  function pinFrontier(el) {
    const sc = resolve(el);
    if (!sc) return;
    const scRect = sc.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const overflow = elRect.bottom - (scRect.top + FRONTIER_LIMIT * scRect.height);
    if (overflow > 1) sc.scrollTop += overflow;
  }

  function frontierIntoView(el) {
    const sc = resolve(el);
    if (!sc || !el) return;
    const scRect = sc.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetY = scRect.top + 0.6 * scRect.height;
    const maxTop = sc.scrollHeight - scRect.height;
    sc.scrollTop = Math.max(0, Math.min(sc.scrollTop + (elRect.bottom - targetY), maxTop));
  }

  function ensureVisible(el, done = () => {}) {
    const sc = resolve(el);
    if (!sc || !el) {
      done();
      return;
    }
    const scRect = sc.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = elRect.top - scRect.top;
    if (top >= ANCHOR_TOP * scRect.height && top <= BOTTOM_BAND * scRect.height) {
      done();
      return;
    }
    const anchorY = scRect.top + ANCHOR_TOP * scRect.height;
    const maxTop = sc.scrollHeight - scRect.height;
    const target = Math.max(0, Math.min(sc.scrollTop + (elRect.top - anchorY), maxTop));
    tweenScrollTop(sc, target, done);
  }

  function toAnchor(nextEl, done = () => {}) {
    const sc = resolve(nextEl);
    if (!sc || !nextEl) {
      done();
      return;
    }
    const scRect = sc.getBoundingClientRect();
    const elRect = nextEl.getBoundingClientRect();
    const atBottom = elRect.top >= scRect.top + BOTTOM_BAND * scRect.height;
    if (!atBottom) {
      done();
      return;
    }
    const anchorY = scRect.top + ANCHOR_TOP * scRect.height;
    const maxTop = sc.scrollHeight - scRect.height;
    const target = Math.min(sc.scrollTop + (elRect.top - anchorY), maxTop);
    tweenScrollTop(sc, target, done);
  }

  function tweenScrollTop(sc, target, done) {
    cancelAnimationFrame(tweenId);
    const prefersReducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = sc.scrollTop;
    const distance = target - start;
    if (prefersReducedMotion || Math.abs(distance) < 1) {
      sc.scrollTop = target;
      done();
      return;
    }
    let startTs = null;
    const step = (ts) => {
      if (startTs === null) startTs = ts;
      const progress = Math.min(1, (ts - startTs) / FLIP_DURATION_MS);
      sc.scrollTop = start + distance * (1 - Math.pow(1 - progress, 3));
      if (progress < 1) {
        tweenId = requestAnimationFrame(step);
      } else {
        sc.scrollTop = target;
        done();
      }
    };
    tweenId = requestAnimationFrame(step);
  }

  return { pinFrontier, frontierIntoView, toAnchor, ensureVisible };
}
