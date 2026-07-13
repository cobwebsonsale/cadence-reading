// Recover symbols from subset fonts with an /Encoding /Differences but no toUnicode CMap:
// read the Differences from the PDF bytes and map glyph names to characters per BaseFont.
const GLYPH_UNICODE = {
  H11001: '+',
  H11002: '−',
  H11003: '×',
  H11005: '=',
  H11006: '±',
  H11011: '∼',
  H11015: '≈',
  H11021: '<',
  H11022: '>',
  H20841: '|',
  H20862: '/',
  minus: '−',
};

export function glyphToUnicode(name) {
  return GLYPH_UNICODE[name] ?? null;
}

// Parse the body of a /Differences [ code /name /name ... ] array.
export function parseDifferences(body) {
  const tokens = body.match(/\d+|\/[A-Za-z][A-Za-z0-9]*/g) || [];
  const map = new Map();
  let code = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) code = Number(token);
    else map.set(code++, token.slice(1));
  }
  return map;
}

export function extractEncodingsFromObjects(objects) {
  const diffByNum = new Map();
  for (const [num, text] of objects) {
    const match = /\/Differences\s*\[([^\]]*)\]/.exec(text);
    if (match) diffByNum.set(num, parseDifferences(match[1]));
  }

  const byBaseFont = new Map();
  for (const [, text] of objects) {
    if (!/\/Type\s*\/Font/.test(text)) continue;
    const base = /\/BaseFont\s*\/([^\s/<>\[\]]+)/.exec(text);
    if (!base) continue;

    let codeToName = null;
    const inline = /\/Differences\s*\[([^\]]*)\]/.exec(text);
    const ref = /\/Encoding\s+(\d+)\s+\d+\s+R/.exec(text);
    if (inline) codeToName = parseDifferences(inline[1]);
    else if (ref && diffByNum.has(Number(ref[1]))) codeToName = diffByNum.get(Number(ref[1]));
    if (!codeToName) continue;

    const codeToChar = new Map();
    for (const [code, name] of codeToName) {
      const char = glyphToUnicode(name);
      if (char != null) codeToChar.set(code, char);
    }
    if (codeToChar.size) byBaseFont.set(base[1], codeToChar);
  }
  return byBaseFont;
}


export async function buildEncodingMap(bytes) {
  try {
    const raw = new TextDecoder('latin1').decode(bytes);
    const objects = new Map();
    collectTopLevelObjects(raw, objects);
    await collectObjectStreams(bytes, raw, objects);
    return extractEncodingsFromObjects(objects);
  } catch {
    return new Map();
  }
}

function collectTopLevelObjects(raw, objects) {
  const re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let m;
  while ((m = re.exec(raw))) {
    if (!objects.has(Number(m[1]))) objects.set(Number(m[1]), m[2]);
  }
}

async function collectObjectStreams(bytes, raw, objects) {
  const re = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const dict = m[2];
    if (!/\/Type\s*\/ObjStm/.test(dict)) continue;
    const count = Number((/\/N\s+(\d+)/.exec(dict) || [])[1]);
    const first = Number((/\/First\s+(\d+)/.exec(dict) || [])[1]);
    if (!count || !first) continue;

    let start = m.index + m[0].length;
    let end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    while (end > start && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;

    const inflated = await inflate(bytes.subarray(start, end));
    if (!inflated) continue;
    const content = new TextDecoder('latin1').decode(inflated);
    parseObjectStream(content, count, first, objects);
  }
}

export function parseObjectStream(content, count, first, objects) {
  const header = content.slice(0, first).trim().split(/\s+/).map(Number);
  for (let i = 0; i < count; i++) {
    const num = header[i * 2];
    const offset = header[i * 2 + 1];
    const nextOffset = i + 1 < count ? header[i * 2 + 3] : content.length - first;
    if (!Number.isFinite(num) || !Number.isFinite(offset)) continue;
    if (!objects.has(num)) objects.set(num, content.slice(first + offset, first + nextOffset));
  }
}

async function inflate(bytes) {
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      /* try next format */
    }
  }
  return null;
}
