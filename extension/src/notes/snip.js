import { el } from '../dom.js';
import { icon } from './icons.js';

// Flatten spans to a normalized quote plus a per-character map back to each source span.
export function mapSpans(spans) {
  let text = '';
  let prevSpace = true;
  const at = [];
  for (const span of spans) {
    for (const ch of span.textContent) {
      if (/\s/.test(ch)) {
        if (prevSpace) continue;
        text += ' ';
        prevSpace = true;
      } else {
        text += ch;
        prevSpace = false;
      }
      at.push(span);
    }
  }
  while (text.endsWith(' ')) {
    text = text.slice(0, -1);
    at.pop();
  }
  return { text, at };
}

// One line per source paragraph, so a list keeps each item on its own line.
export function spansToDisplay(spans) {
  let out = '';
  let prevPara = null;
  for (const span of spans) {
    const para = span.closest('.dr-para');
    if (prevPara && para !== prevPara) out += '\n';
    prevPara = para;
    // The document's list glyph is oversized on a card; use a plain small bullet.
    out += span.classList.contains('dr-bullet') ? '• ' : span.textContent;
  }
  return out
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export function createSnipButton({ contentEl, mount, onSnip }) {
  const snipBtn = el('button', 'dr-snip-btn');
  snipBtn.type = 'button';
  snipBtn.innerHTML = `${icon('snip')}<span>Snip</span>`;
  snipBtn.hidden = true;
  mount.appendChild(snipBtn);

  let pending = null;
  const hideSnip = () => {
    snipBtn.hidden = true;
    pending = null;
  };
  const clipRect = () => (contentEl.closest('.dr-stage') || document.documentElement).getBoundingClientRect();
  const snipVisible = (spans) => {
    if (!spans.length || !spans[0].isConnected) return false;
    const clip = clipRect();
    const first = spans[0].getBoundingClientRect();
    const last = spans[spans.length - 1].getBoundingClientRect();
    return last.bottom > clip.top && first.top < clip.bottom;
  };
  const placeSnip = (endEl) => {
    const rect = endEl.getBoundingClientRect();
    const clip = clipRect();
    snipBtn.style.top = `${Math.min(Math.max(rect.bottom + 2, clip.top + 6), clip.bottom - 34)}px`;
    snipBtn.style.left = `${Math.min(window.innerWidth - 80, Math.max(8, rect.right + 2))}px`;
  };
  const updateSnip = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSnip();
    const range = sel.getRangeAt(0);
    const revealed = [...contentEl.querySelectorAll('.dr-char[data-revealed]')].filter(
      (s) => range.intersectsNode(s) && !s.classList.contains('dr-inline-object')
    );
    if (!revealed.length) return hideSnip();
    const quote = mapSpans(revealed).text;
    if (!quote.trim() || !snipVisible(revealed)) return hideSnip();
    const endEl = revealed[revealed.length - 1];
    const paraAttr = revealed[0].closest('.dr-para')?.getAttribute('data-paragraph-index');
    pending = {
      text: spansToDisplay(revealed),
      spans: revealed,
      para: paraAttr != null ? Number(paraAttr) : null,
      quote,
      rect: endEl.getBoundingClientRect(),
    };
    placeSnip(endEl);
    snipBtn.hidden = false;
  };
  const repositionSnip = () => {
    if (!pending?.spans) return;
    if (snipVisible(pending.spans)) {
      placeSnip(pending.spans[pending.spans.length - 1]);
      snipBtn.hidden = false;
    } else {
      snipBtn.hidden = true;
    }
  };
  const onMouseUp = () => setTimeout(updateSnip, 0);
  const onSelectionChange = () => {
    if (window.getSelection()?.isCollapsed) hideSnip();
  };
  let repositionRaf = 0;
  const reposition = () => {
    cancelAnimationFrame(repositionRaf);
    repositionRaf = requestAnimationFrame(repositionSnip);
  };
  snipBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (pending) onSnip(pending);
    window.getSelection()?.removeAllRanges();
    hideSnip();
  });
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  return {
    updateSnip,
    hideSnip,
    destroy() {
      cancelAnimationFrame(repositionRaf);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      snipBtn.remove();
    },
  };
}
