export function parseModel(raw) {
  if (!raw) return { cards: [], cursor: null, title: '' };
  try {
    const m = JSON.parse(raw);
    if (m && Array.isArray(m.cards)) return { cards: m.cards, cursor: m.cursor || null, title: m.title || '' };
  } catch {
    void 0;
  }
  return { cards: [{ id: 'c0', kind: 'note', note: raw }], cursor: null, title: '' };
}

export function createModelHistory(snapshot, restore, limit = 100) {
  const stack = [];
  let index = -1;
  return {
    push() {
      const snap = snapshot();
      if (index >= 0 && stack[index] === snap) return;
      stack.length = index + 1;
      stack.push(snap);
      if (stack.length > limit) stack.shift();
      index = stack.length - 1;
    },
    reset() {
      stack.length = 0;
      index = -1;
      this.push();
    },
    undo() {
      if (index <= 0) return;
      restore(stack[--index]);
    },
    redo() {
      if (index >= stack.length - 1) return;
      restore(stack[++index]);
    },
  };
}
