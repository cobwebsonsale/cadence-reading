const GUTTER_GAP = 12;
const nextFreeYByGutter = new WeakMap();

export function anchorComments(contentRoot, rawComments) {
  const records = new Map();
  if (!rawComments || !rawComments.length) return records;

  const spans = [];
  for (const el of contentRoot.querySelectorAll('.dr-char')) {
    if (el.hasAttribute('data-instant')) continue;
    spans.push(el);
  }

  let text = '';
  const spanIndexAt = [];
  let prevPara = null;
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex++) {
    // A paragraph break reads as a space in a quote; insert one so a cross-break quote matches.
    const para = spans[spanIndex].closest('.dr-para');
    if (prevPara && para !== prevPara) {
      text += ' ';
      spanIndexAt.push(spanIndex);
    }
    prevPara = para;
    const spanText = spans[spanIndex].textContent || '';
    for (let k = 0; k < spanText.length; k++) spanIndexAt.push(spanIndex);
    text += spanText;
  }

  let searchFrom = 0;
  for (const comment of rawComments) {
    const record = makeRecord(comment);
    records.set(comment.id, record);

    // A missing or stale quote can't be placed; leave it unanchored, not dumped at the start.
    const quote = normalizeQuote(comment.quotedFileContent?.value);
    if (!quote) continue;

    let matchIndex = text.indexOf(quote, searchFrom);
    if (matchIndex < 0) matchIndex = text.indexOf(quote);
    if (matchIndex < 0) continue;

    const startSpan = spanIndexAt[matchIndex];
    const endSpan = spanIndexAt[matchIndex + quote.length - 1];
    for (let i = startSpan; i <= endSpan; i++) {
      spans[i].classList.add('dr-commented');
      const prior = spans[i].getAttribute('data-comment-id');
      spans[i].setAttribute('data-comment-id', prior ? `${prior},${comment.id}` : comment.id);
    }
    // Anchor at the range start so the callout appears as the commented text begins.
    tagEnd(spans[startSpan], comment.id);
    record.endSpanIndex = startSpan;
    searchFrom = matchIndex + quote.length;
  }

  return records;
}

function tagEnd(span, id) {
  if (!span) return;
  const existing = span.getAttribute('data-comment-end');
  span.setAttribute('data-comment-end', existing ? `${existing},${id}` : id);
  span.classList.add('dr-comment-anchor');
}

function makeRecord(comment) {
  return {
    id: comment.id,
    author: comment.author?.displayName || 'Unknown',
    photo: comment.author?.photoLink || '',
    createdTime: comment.createdTime || '',
    html: comment.htmlContent || '',
    text: comment.content || '',
    resolved: !!comment.resolved,
    replies: (comment.replies || []).map((reply) => ({
      author: reply.author?.displayName || 'Unknown',
      photo: reply.author?.photoLink || '',
      createdTime: reply.createdTime || '',
      html: reply.htmlContent || '',
      text: reply.content || '',
    })),
    endSpanIndex: -1,
    node: null,
  };
}

// Normalize like the builder does so a stored quote matches the rendered spans.
function normalizeQuote(value) {
  if (!value) return '';
  return value
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCallout(record) {
  const aside = document.createElement('aside');
  aside.className = 'dr-comment';
  aside.setAttribute('data-comment-id', record.id);
  if (record.resolved) aside.classList.add('dr-comment-resolved');

  aside.appendChild(commentHeader(record));

  const body = document.createElement('div');
  body.className = 'dr-comment-body';
  setRichText(body, record.html, record.text);
  aside.appendChild(body);

  if (record.replies.length) {
    const list = document.createElement('ol');
    list.className = 'dr-comment-replies';
    for (const reply of record.replies) {
      const item = document.createElement('li');
      item.appendChild(commentHeader(reply));
      const replyBody = document.createElement('div');
      replyBody.className = 'dr-comment-body';
      setRichText(replyBody, reply.html, reply.text);
      item.appendChild(replyBody);
      list.appendChild(item);
    }
    aside.appendChild(list);
  }

  return aside;
}

function commentHeader(record) {
  const header = document.createElement('header');
  header.className = 'dr-comment-header';
  header.appendChild(avatar(record));

  const name = document.createElement('span');
  name.className = 'dr-comment-author';
  name.textContent = record.author;
  header.appendChild(name);

  if (record.resolved) {
    const chip = document.createElement('span');
    chip.className = 'dr-comment-resolved-chip';
    chip.textContent = 'Resolved';
    header.appendChild(chip);
  }

  if (record.createdTime) {
    const time = document.createElement('time');
    time.className = 'dr-comment-time';
    time.dateTime = record.createdTime;
    time.textContent = record.createdTime.slice(0, 10);
    header.appendChild(time);
  }

  return header;
}

function avatar(record) {
  if (record.photo) {
    const img = document.createElement('img');
    img.className = 'dr-comment-avatar';
    img.src = record.photo;
    img.alt = '';
    // Google profile photos 403 when a referrer is sent; fall back to initials if the load still fails.
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(initialsAvatar(record)));
    return img;
  }
  return initialsAvatar(record);
}

function initialsAvatar(record) {
  const span = document.createElement('span');
  span.className = 'dr-comment-avatar dr-comment-avatar-fallback';
  span.textContent = initials(record.author);
  span.style.background = avatarColor(record.author);
  return span;
}

function initials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  const first = parts[0]?.[0] || '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hash}, 52%, 45%)`;
}

export function positionCallout(record, overlay) {
  const { gutter } = overlay;
  const node = record.node;
  if (!node) return;

  const gutterRect = gutter.getBoundingClientRect();
  const anchorSpan = findAnchorSpan(overlay.content, record);
  const anchorRect = anchorSpan ? anchorSpan.getBoundingClientRect() : { bottom: gutterRect.top };

  let top = anchorRect.bottom - gutterRect.top + gutter.scrollTop;

  const nextFreeY = nextFreeYByGutter.get(gutter) || 0;
  if (top < nextFreeY) top = nextFreeY;

  node.style.top = `${Math.max(0, top)}px`;
  node.style.zIndex = '';

  const height = node.offsetHeight || 80;
  nextFreeYByGutter.set(gutter, top + height + GUTTER_GAP);
}

// Re-stack revealed callouts from scratch; positions computed while hidden are unreliable.
export function layoutCallouts(records, overlay) {
  nextFreeYByGutter.delete(overlay.gutter);
  for (const record of records.values()) {
    if (record.node?.classList.contains('dr-comment-revealed')) positionCallout(record, overlay);
  }
}

function findAnchorSpan(content, record) {
  for (const el of content.querySelectorAll('[data-comment-end]')) {
    const ids = (el.getAttribute('data-comment-end') || '').split(',');
    if (ids.includes(record.id)) return el;
  }
  return null;
}

function setRichText(container, html, plain) {
  if (!html) {
    container.textContent = plain || '';
    return;
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(parsed.body);
  container.append(...parsed.body.childNodes);
}

// Comment HTML is author-controlled; allowlist safe tags rather than blocklist dangerous ones.
const ALLOWED_TAGS = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'BR', 'P', 'SPAN',
  'DIV', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'BLOCKQUOTE', 'SUP', 'SUB',
]);
const CONTENT_IS_CODE = new Set(['SCRIPT', 'STYLE']);
const SAFE_URL = /^(https?:|mailto:)/i;

export function sanitizeNode(node) {
  for (const el of [...node.children]) sanitizeElement(el);
}

function sanitizeElement(el) {
  const tag = el.tagName;
  if (CONTENT_IS_CODE.has(tag)) {
    el.remove();
    return;
  }
  // Recurse first so a disallowed wrapper's contents are cleaned before it's unwrapped.
  for (const child of [...el.children]) sanitizeElement(child);
  if (ALLOWED_TAGS.has(tag)) {
    sanitizeAttributes(el, tag);
  } else {
    unwrap(el);
  }
}

function sanitizeAttributes(el, tag) {
  for (const attr of [...el.attributes]) {
    const keep = attr.name.toLowerCase() === 'href' && tag === 'A' && SAFE_URL.test(attr.value.trim());
    if (!keep) el.removeAttribute(attr.name);
  }
  if (tag === 'A' && el.hasAttribute('href')) {
    el.setAttribute('rel', 'noopener noreferrer');
    el.setAttribute('target', '_blank');
  }
}

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}
