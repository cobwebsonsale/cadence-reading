import { clampSpeed, saveSettings, LIMITS } from '../settings.js';

const ADVANCE_KEYS = new Set([' ', 'Spacebar', 'Enter', 'ArrowRight']);

export function attachInput(loop, session) {
  // Ignore browser shortcuts (Cmd/Ctrl/Alt) and any keystroke while editing notes.
  const ignore = (e) => e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target);

  const onKeyDown = (e) => {
    if (ignore(e)) return;

    const key = e.key;

    if (ADVANCE_KEYS.has(key)) {
      swallow(e);
      // Boost engages only on auto-repeat (a real hold), so a tap can't skip a short section.
      if (e.repeat) loop.setBoost(true);
      else loop.advance();
      return;
    }

    switch (key) {
      case 'ArrowLeft':
        swallow(e);
        loop.rewind();
        return;
      case 'ArrowDown':
        swallow(e);
        loop.goToParagraph(1);
        return;
      case 'ArrowUp':
        swallow(e);
        loop.goToParagraph(-1);
        return;
      case 'c':
      case 'C':
        swallow(e);
        session.toggleComments();
        return;
      case 'f':
      case 'F':
        swallow(e);
        session.toggleFocus();
        return;
      case 'b':
      case 'B':
        swallow(e);
        session.toggleBionic();
        return;
      case 'n':
      case 'N':
        swallow(e);
        session.toggleNotes();
        return;
      case '[':
        swallow(e);
        changeSpeed(loop, session, -LIMITS.speedStep);
        return;
      case ']':
        swallow(e);
        changeSpeed(loop, session, +LIMITS.speedStep);
        return;
      case 'Escape':
        swallow(e);
        session.end();
        return;
    }
  };

  const onKeyUp = (e) => {
    if (ignore(e)) return;
    if (ADVANCE_KEYS.has(e.key)) {
      swallow(e);
      loop.setBoost(false);
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
  };
}

function changeSpeed(loop, session, delta) {
  const next = clampSpeed(session.settings.charsPerSec + delta);
  session.settings.charsPerSec = next;
  loop.setSpeed(next);
  saveSettings({ charsPerSec: next }).catch(() => {});
}

function isEditableTarget(target) {
  if (!target || !target.tagName) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

function swallow(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}
