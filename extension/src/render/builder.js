import { textStyleToCss, paragraphStyleToCss, linkUrlOf, dimToPx } from './styles.js';
import { createListContext } from './lists.js';
import { buildInlineObject } from './objects.js';
import { buildTable } from './tables.js';
import { resolveTabContent } from './tabs-model.js';

const NEWLINE = 0x0a;
const VERTICAL_TAB = 0x0b;
const FORM_FEED = 0x0c;
const PARA_GAP_BREAK_PX = 7;

const edgeMargin = (node, prop) => parseFloat(node.style[prop]) || 0;

export function buildDocument(doc, { mount, settings, tabId }) {
  const { content, lists, inlineObjects } = resolveTabContent(doc, tabId);

  const ctx = {
    settings,
    lists: lists || {},
    inlineObjects: inlineObjects || {},
    listContext: createListContext(lists || {}),
    paragraphIndex: 0,
    bodyFontSize: bodyFontSize(content || []),
  };

  if (settings?.fontFamily) {
    mount.style.fontFamily = settings.fontFamily;
  }

  buildContent(content || [], mount, ctx);
}

function bodyFontSize(content) {
  const counts = new Map();
  const visit = (elements) => {
    for (const el of elements || []) {
      if (el.paragraph) {
        for (const e of el.paragraph.elements || []) {
          const size = e.textRun?.textStyle?.fontSize?.magnitude;
          const len = (e.textRun?.content || '').replace(/\s/g, '').length;
          if (size && len) counts.set(size, (counts.get(size) || 0) + len);
        }
      } else if (el.table) {
        for (const row of el.table.tableRows || []) {
          for (const cell of row.tableCells || []) visit(cell.content);
        }
      }
    }
  };
  visit(content);
  let dominant = 11;
  let best = 0;
  for (const [size, n] of counts) {
    if (n > best) {
      best = n;
      dominant = size;
    }
  }
  return dominant;
}

export function buildContent(content, parent, ctx) {
  let prevPara = null;
  let sawBreak = false;
  for (const element of content) {
    if (element.paragraph) {
      const node = buildParagraph(element.paragraph, ctx);
      if (!node) {
        sawBreak = true;
        continue;
      }
      if (prevPara) {
        // Google collapses spacing between consecutive same-list items; drop the gap it invents.
        if (prevPara.dataset.listId && prevPara.dataset.listId === node.dataset.listId) {
          prevPara.style.marginBottom = '';
          node.style.marginTop = '';
        }
        const gap = Math.max(edgeMargin(prevPara, 'marginBottom'), edgeMargin(node, 'marginTop'));
        const firstLineIndent = edgeMargin(node, 'textIndent');
        if (sawBreak || gap >= PARA_GAP_BREAK_PX || firstLineIndent >= PARA_GAP_BREAK_PX) {
          prevPara.classList.add('dr-break-after');
        } else if (prevPara.tagName === 'P' && node.tagName === 'P') {
          prevPara.classList.add('dr-tight');
        }
      }
      parent.appendChild(node);
      prevPara = node;
      sawBreak = false;
    } else if (element.table) {
      parent.appendChild(buildTable(element.table, ctx, buildContent));
      prevPara = null;
    } else if (element.sectionBreak) {
      parent.appendChild(makeMarker('dr-section-break'));
      prevPara = null;
    } else if (element.tableOfContents) {
      const toc = makeMarker('dr-toc');
      buildContent(element.tableOfContents.content || [], toc, ctx);
      parent.appendChild(toc);
      prevPara = null;
    }
  }
}

// The Docs API omits dropdown values and unassigned person chips; recover them from the text export.
export function reconcileChips(mount, exportText) {
  if (!exportText) return;
  const lines = exportText
    .split('\n')
    .map((raw) => raw.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const values = new Map();
  for (const line of lines) {
    const sep = line.indexOf(': ');
    if (sep > 0) values.set(line.slice(0, sep), line.slice(sep + 2));
  }
  for (const para of mount.querySelectorAll('.dr-para')) {
    const text = para.textContent.replace(/\s+/g, ' ').trim();

    const label = text.match(/^(.+?):$/)?.[1]?.trim();
    if (label) {
      const value = values.get(label);
      if (value) appendChip(para, ` ${value}`);
    } else if (text.startsWith(':')) {
      const source = lines.find((line) => line.length > text.length && line.endsWith(text));
      if (source) prependChip(para, source.slice(0, source.length - text.length).trim());
    }
  }
}

function buildParagraph(paragraph, ctx) {
  const paragraphStyle = paragraph.paragraphStyle || {};
  const heading =
    HEADING_STYLES[paragraphStyle.namedStyleType] ||
    (!paragraph.bullet && detectAuthorHeading(paragraph, ctx.bodyFontSize));
  const node = document.createElement(heading?.tag || 'p');
  node.className = 'dr-para';
  if (heading) node.classList.add(heading.cls);

  const inlineCss = paragraphStyleToCss(paragraphStyle);
  if (inlineCss) node.style.cssText = inlineCss;
  if (!paragraph.bullet && !heading) applyIndent(node, paragraphStyle);

  if (paragraph.bullet) {
    const glyph = ctx.listContext.glyphFor(paragraph.bullet);
    if (glyph) {
      node.classList.add('dr-list-item');
      if (paragraph.bullet.listId) node.dataset.listId = paragraph.bullet.listId;
      const level = paragraph.bullet.nestingLevel || 0;
      if (level) node.style.marginInlineStart = `${level * 1.4}em`;
      const bullet = document.createElement('span');
      bullet.className = 'dr-char dr-bullet';
      bullet.setAttribute('data-instant', 'true');
      bullet.textContent = glyph.text + ' ';
      node.appendChild(bullet);
    }
  }

  for (const element of paragraph.elements || []) {
    if (element.textRun) {
      appendTextRun(node, element.textRun);
    } else if (element.inlineObjectElement) {
      appendInlineObject(node, element.inlineObjectElement, ctx);
    } else if (element.pageBreak || element.columnBreak) {
      node.appendChild(makeMarker('dr-page-break'));
    } else if (element.horizontalRule) {
      node.appendChild(makeMarker('dr-hr'));
    } else if (element.footnoteReference) {
      appendFootnoteRef(node, element.footnoteReference);
    } else if (element.person) {
      const p = element.person.personProperties || {};
      appendChip(node, p.name || p.email);
    } else if (element.richLink) {
      const p = element.richLink.richLinkProperties || {};
      appendChip(node, p.title || p.uri, p.uri);
    } else if (element.dateElement) {
      appendChip(node, element.dateElement.dateElementProperties?.displayText);
    } else {
      const kind = Object.keys(element).find((k) => k !== 'startIndex' && k !== 'endIndex');
      if (kind) console.debug('[cadence] unhandled paragraph element:', kind);
    }
  }

  collapseWhitespace(node);
  trimEdgeBreaks(node);

  // Contiguous indices only; paragraph navigation lands on gaps otherwise.
  const hasContent =
    node.textContent.trim().length > 0 ||
    node.querySelector('.dr-inline-object, .dr-hr, .dr-page-break, .dr-bullet, .dr-footnote-ref');
  if (!hasContent) return null;
  node.setAttribute('data-paragraph-index', String(ctx.paragraphIndex++));

  return node;
}

function appendTextRun(node, textRun) {
  const textStyle = textRun.textStyle || {};
  const charCss = textStyleToCss(textStyle);
  const url = linkUrlOf(textStyle);

  const container = url ? document.createElement('a') : node;
  if (url) {
    container.className = 'dr-link';
    container.href = url;
    container.target = '_blank';
    container.rel = 'noopener noreferrer';
  }

  for (const ch of textRun.content || '') {
    const code = ch.charCodeAt(0);
    if (code === NEWLINE) continue;
    if (code === VERTICAL_TAB || code === FORM_FEED) {
      container.appendChild(document.createElement('br'));
      continue;
    }
    const span = document.createElement('span');
    span.className = 'dr-char';
    if (charCss) span.style.cssText = charCss;
    span.textContent = ch;
    container.appendChild(span);
  }

  if (url) node.appendChild(container);
}

function appendInlineObject(node, element, ctx) {
  const objectNode = buildInlineObject(element.inlineObjectId, ctx.inlineObjects);
  objectNode.classList.add('dr-char');
  objectNode.setAttribute('data-instant', 'true');
  node.appendChild(objectNode);
}

function collapseWhitespace(node) {
  let prevSpace = true;
  for (const el of [...node.querySelectorAll('.dr-char')]) {
    if (el.hasAttribute('data-instant')) {
      prevSpace = false;
      continue;
    }
    // Private-use glyphs are chip/icon placeholders with no readable text.
    const code = el.textContent.codePointAt(0) || 0;
    if (code >= 0xe000 && code <= 0xf8ff) {
      el.remove();
      continue;
    }
    if (/^\s+$/.test(el.textContent)) {
      if (prevSpace) el.remove();
      else el.textContent = ' ';
      prevSpace = true;
    } else {
      prevSpace = false;
    }
  }
  const chars = [...node.querySelectorAll('.dr-char')];
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i].hasAttribute('data-instant')) break;
    if (/^\s*$/.test(chars[i].textContent)) chars[i].remove();
    else break;
  }
}

function trimEdgeBreaks(node) {
  let first = node.firstChild;
  if (first?.nodeType === 1 && first.classList?.contains('dr-bullet')) first = first.nextSibling;
  while (first?.nodeName === 'BR') {
    const next = first.nextSibling;
    first.remove();
    first = next;
  }
  while (node.lastChild?.nodeName === 'BR') node.removeChild(node.lastChild);
}

function chipEl(text, url) {
  const container = document.createElement(url ? 'a' : 'span');
  container.className = url ? 'dr-link dr-chip' : 'dr-chip';
  if (url) {
    container.href = url;
    container.target = '_blank';
    container.rel = 'noopener noreferrer';
  }
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = 'dr-char';
    span.textContent = ch;
    container.appendChild(span);
  }
  return container;
}

function charEl(text) {
  const span = document.createElement('span');
  span.className = 'dr-char';
  span.textContent = text;
  return span;
}

function appendChip(node, text, url) {
  if (!text) return;
  node.appendChild(chipEl(text, url));
}

function prependChip(node, text) {
  if (!text) return;
  node.insertBefore(charEl(' '), node.firstChild);
  node.insertBefore(chipEl(text), node.firstChild);
}

function appendFootnoteRef(node, footnoteRef) {
  const sup = document.createElement('sup');
  sup.className = 'dr-char dr-footnote-ref';
  sup.setAttribute('data-instant', 'true');
  sup.textContent = footnoteRef.footnoteNumber || '*';
  node.appendChild(sup);
}

const AUTO_HEADING_MAX_CHARS = 100;

function detectAuthorHeading(paragraph, bodyFontSize) {
  const runs = (paragraph.elements || []).map((e) => e.textRun).filter((r) => r?.content);
  if (!runs.length || !bodyFontSize) return null;

  let text = '';
  let chars = 0;
  let boldChars = 0;
  const sizeChars = new Map();
  for (const run of runs) {
    text += run.content;
    const len = run.content.replace(/\s/g, '').length;
    if (!len) continue;
    chars += len;
    if (run.textStyle?.bold) boldChars += len;
    const size = run.textStyle?.fontSize?.magnitude || bodyFontSize;
    sizeChars.set(size, (sizeChars.get(size) || 0) + len);
  }
  const trimmed = text.trim();
  if (chars < 2 || trimmed.length > AUTO_HEADING_MAX_CHARS) return null;

  let domSize = bodyFontSize;
  let best = 0;
  for (const [size, n] of sizeChars) {
    if (n > best) {
      best = n;
      domSize = size;
    }
  }
  const ratio = domSize / bodyFontSize;
  const allBold = boldChars >= chars * 0.8;
  const endsSentence = /[.!?]$/.test(trimmed);
  if (ratio >= 1.5) return { tag: 'h2', cls: 'dr-h2' };
  if (ratio >= 1.25 && !endsSentence) return { tag: 'h3', cls: 'dr-h3' };
  if (allBold && ratio >= 1.05 && !endsSentence) return { tag: 'h4', cls: 'dr-h4' };
  return null;
}

function applyIndent(node, paragraphStyle) {
  const start = dimToPx(paragraphStyle.indentStart);
  if (start) node.style.marginInlineStart = `${start}px`;
  const firstLine = dimToPx(paragraphStyle.indentFirstLine);
  if (firstLine != null) {
    const indent = Math.round((firstLine - (start || 0)) * 100) / 100;
    if (indent > 0) node.style.textIndent = `${indent}px`;
  }
}

const HEADING_STYLES = {
  TITLE: { tag: 'h1', cls: 'dr-title' },
  SUBTITLE: { tag: 'h2', cls: 'dr-subtitle' },
  HEADING_1: { tag: 'h1', cls: 'dr-h1' },
  HEADING_2: { tag: 'h2', cls: 'dr-h2' },
  HEADING_3: { tag: 'h3', cls: 'dr-h3' },
  HEADING_4: { tag: 'h4', cls: 'dr-h4' },
  HEADING_5: { tag: 'h5', cls: 'dr-h5' },
  HEADING_6: { tag: 'h6', cls: 'dr-h6' },
};

function makeMarker(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}
