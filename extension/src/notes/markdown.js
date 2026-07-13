// Pure text matchers (no DOM) so the editor's markdown logic is testable without a browser.

const INLINE_RULES = [
  { re: /\[([^\]\n]+)\]\(([^)\s]+)\)$/, build: (m) => ({ tag: 'a', text: m[1], href: m[2] }) },
  { re: /\*\*([^*\n]+)\*\*$/, build: (m) => ({ tag: 'strong', text: m[1] }) },
  { re: /__([^_\n]+)__$/, build: (m) => ({ tag: 'strong', text: m[1] }) },
  { re: /`([^`\n]+)`$/, build: (m) => ({ tag: 'code', text: m[1] }) },
  { re: /(?<![*\w])\*([^*\s][^*\n]*?)\*$/, build: (m) => ({ tag: 'em', text: m[1] }) },
  { re: /(?<![_\w])_([^_\s][^_\n]*?)_$/, build: (m) => ({ tag: 'em', text: m[1] }) },
];

export function matchInlineMarkdown(text) {
  for (const { re, build } of INLINE_RULES) {
    const m = re.exec(text);
    if (m) return { start: m.index, raw: m[0], ...build(m) };
  }
  return null;
}

export function matchBlockShortcut(text) {
  const heading = /^(#{1,6})\s+/.exec(text);
  if (heading) return { type: `h${heading[1].length}`, strip: heading[0].length };
  const ordered = /^(\d+)\.\s+/.exec(text);
  if (ordered) return { type: 'ol', strip: ordered[0].length };
  const unordered = /^([-*+])\s+/.exec(text);
  if (unordered) return { type: 'ul', strip: unordered[0].length };
  return null;
}
