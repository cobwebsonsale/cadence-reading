export function buildSteps(root, opts = {}) {
  const pauseAt = opts.pauseAt || 'paragraph';
  const steps = [];
  for (const child of root.children) appendBlock(steps, child, pauseAt);
  while (steps.length && steps[0].kind === 'pause') steps.shift(); // no pause before the first content
  trimTrailingPauses(steps);
  return steps;
}

export function buildBlockSteps(blockEl, opts = {}) {
  const pauseAt = opts.pauseAt || 'paragraph';
  const steps = [];
  appendBlock(steps, blockEl, pauseAt);
  return steps;
}

export function trimTrailingPauses(steps) {
  while (steps.length && steps[steps.length - 1].kind === 'pause') steps.pop();
}

function appendBlock(steps, node, pauseAt) {
  if (node.classList.contains('dr-char')) {
    pushChar(steps, node);
  } else if (node.classList.contains('dr-section-break')) {
    pushPause(steps, 'section');
  } else if (node.tagName === 'TR') {
    // A whole table row reveals together, then pauses — not cell by cell.
    for (const child of node.children) appendBlock(steps, child, pauseAt);
    if (pauseAt === 'paragraph') pushPause(steps, 'paragraph');
  } else if (node.classList.contains('dr-para')) {
    for (const child of node.children) appendBlock(steps, child, pauseAt);
    if (pauseAt === 'paragraph' && pauseAfterPara(node)) pushPause(steps, 'paragraph');
  } else {
    for (const child of node.children) appendBlock(steps, child, pauseAt);
  }
}

// Pause only at a structural boundary; adjacent lines (metadata, lists) stay one unit.
function pauseAfterPara(node) {
  if (isBlankPara(node)) return false;
  if (node.closest('.dr-cell')) return false; // table rows pause as a whole, not per cell
  const next = node.nextElementSibling;
  if (!next) return true;
  if (isHeading(node) || isHeading(next) || isBlankPara(next)) return true;
  if (node.classList.contains('dr-break-after')) return true; // a dropped blank marked a break here
  return !next.classList.contains('dr-para');
}

function isHeading(node) {
  return /^H[1-6]$/.test(node.tagName) || node.classList.contains('dr-pdf-heading');
}

function isBlankPara(node) {
  const chars = node.querySelectorAll('.dr-char');
  return chars.length === 0 || (chars.length === 1 && chars[0].classList.contains('dr-empty'));
}

function pushPause(steps, boundary) {
  const last = steps[steps.length - 1];
  if (last && last.kind === 'pause') {
    if (boundary === 'section') last.boundary = 'section';
    return;
  }
  steps.push({ kind: 'pause', boundary });
}

function pushChar(steps, el) {
  steps.push({ kind: 'char', el, instant: el.hasAttribute('data-instant') });
  const commentEnds = el.getAttribute('data-comment-end');
  if (commentEnds) {
    for (const id of commentEnds.split(',')) {
      if (id) steps.push({ kind: 'comment', commentId: id });
    }
  }
}
