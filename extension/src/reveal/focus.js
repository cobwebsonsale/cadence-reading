// Tier classes from brightest (frontier) to dimmest; text past the last tier sits at the floor.
const TIERS = ['dr-current-chunk', 'dr-recent-1', 'dr-recent-2'];

export function createFocus(root) {
  let enabled = false;
  let chunks = TIERS.map(() => []);

  const onWheel = (e) => {
    if (enabled && root && e.deltaY) root.classList.add('dr-focus-suspend');
  };
  window.addEventListener('wheel', onWheel, { passive: true });

  function setEnabled(on) {
    enabled = on;
    if (!root) return;
    root.classList.toggle('dr-focus', on);
    if (!on) root.classList.remove('dr-focus-suspend');
  }

  function mark(el) {
    el.classList.add(TIERS[0]);
    chunks[0].push(el);
  }

  // Age the trail one step: current chunk fades to recent, and the oldest drops to the floor.
  function age() {
    const last = TIERS.length - 1;
    for (const el of chunks[last]) el.classList.remove(TIERS[last]);
    for (let t = last; t > 0; t--) {
      for (const el of chunks[t - 1]) {
        el.classList.replace(TIERS[t - 1], TIERS[t]);
      }
    }
    chunks = [[], ...chunks.slice(0, last)];
  }

  function startRender() {
    age();
    if (root) root.classList.remove('dr-focus-suspend');
  }

  function reset() {
    for (let t = 0; t < TIERS.length; t++) {
      for (const el of chunks[t]) el.classList.remove(TIERS[t]);
    }
    chunks = TIERS.map(() => []);
  }

  function destroy() {
    window.removeEventListener('wheel', onWheel);
  }

  return { setEnabled, mark, startRender, reset, destroy };
}
