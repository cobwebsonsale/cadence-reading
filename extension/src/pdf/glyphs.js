export const UNMAPPED_GLYPH = '□';

// Replace unresolved glyph-code control chars with the recovered character, else a box.
export function remapControlChars(str, item, page, glyphMap, baseFontCache) {
  if (!hasControlChar(str)) return str;
  const base = baseFontOf(item, page, baseFontCache);
  const codeToChar = glyphMap && base ? glyphMap.get(base) : null;
  let out = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (isGlyphControlCode(code)) {
      const mapped = codeToChar ? codeToChar.get(code) : undefined;
      out += mapped != null ? mapped : UNMAPPED_GLYPH;
    } else {
      out += ch;
    }
  }
  return out;
}

function hasControlChar(str) {
  for (const ch of str) if (isGlyphControlCode(ch.charCodeAt(0))) return true;
  return false;
}

// Any unresolvable glyph → crop the whole (symbol-font) item as one image.
export function itemGlyphImage(item, page, glyphMap, baseFontCache, pageNum, x, y, fontSize) {
  let base;
  let hasUnresolved = false;
  for (const ch of item.str) {
    const code = ch.charCodeAt(0);
    if (!isGlyphControlCode(code)) continue;
    if (base === undefined) base = baseFontOf(item, page, baseFontCache);
    const mapped = glyphMap && base ? glyphMap.get(base)?.get(code) : undefined;
    if (mapped == null) {
      hasUnresolved = true;
      break;
    }
  }
  if (!hasUnresolved) return null;
  const width = item.width || fontSize * 0.6;
  return {
    page: pageNum,
    bbox: { x0: x, x1: x + width, y0: y - fontSize * 0.25, y1: y + fontSize * 0.85 },
  };
}

export function isGlyphControlCode(code) {
  return code >= 1 && code <= 31 && code !== 9 && code !== 10 && code !== 13;
}

function baseFontOf(item, page, cache) {
  const key = item.fontName;
  if (!key) return null;
  if (cache && cache.has(key)) return cache.get(key);
  let name = null;
  if (page) {
    try {
      name = page.commonObjs.get(key)?.name || null;
    } catch {
      name = null;
    }
  }
  if (cache) cache.set(key, name);
  return name;
}
