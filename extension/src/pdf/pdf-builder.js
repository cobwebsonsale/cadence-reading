const BIONIC_PREFIX_RATIO = 0.4;

// Build one block's DOM; the rasterizer (if given) fills its images on demand.
export function buildBlock(block, index, rasterizer = null) {
  if (block.kind === 'image') return buildFigure(block, index, rasterizer);
  if (block.kind === 'paragraph' || block.kind === 'footnote') {
    return buildParagraph(block, index, rasterizer);
  }
  return null;
}

function setImageSource(img, block, rasterizer) {
  if (block.dataURL) {
    img.src = block.dataURL;
  } else if (rasterizer && block.page && block.bbox) {
    rasterizer.crop(block.page, block.bbox).then((url) => {
      if (url) img.src = url;
    });
  }
}

function buildFigure(block, index, rasterizer) {
  const node = document.createElement('p');
  node.className = 'dr-para dr-figure';
  node.setAttribute('data-paragraph-index', String(index));
  // data-instant → the walker reveals the whole figure in one step.
  const span = document.createElement('span');
  span.className = 'dr-char dr-inline-object';
  span.setAttribute('data-instant', 'true');
  const img = document.createElement('img');
  img.alt = 'Figure';
  img.loading = 'eager';
  img.decoding = 'async';
  span.appendChild(img);
  setImageSource(img, block, rasterizer);
  node.appendChild(span);
  return node;
}

function buildParagraph(block, index, rasterizer) {
  const node = document.createElement(block.heading ? 'h2' : 'p');
  let className = 'dr-para';
  if (block.heading) className += ' dr-pdf-heading';
  if (block.kind === 'footnote') className += ' dr-footnote';
  node.className = className;
  node.setAttribute('data-paragraph-index', String(index));
  for (const run of block.runs || []) appendRun(node, run, rasterizer);
  return node;
}

function appendRun(node, run, rasterizer) {
  const target = run.script ? document.createElement(run.script === 'super' ? 'sup' : 'sub') : node;

  if (run.glyph) {
    target.appendChild(buildGlyphChar(run, rasterizer));
    if (target !== node) node.appendChild(target);
    return;
  }
  let baseClass = 'dr-char';
  if (run.bold) baseClass += ' dr-bold';
  if (run.italic) baseClass += ' dr-italic';

  const chars = Array.from(run.text);
  const bionicStrong = bionicMask(chars);
  for (let k = 0; k < chars.length; k++) {
    const span = document.createElement('span');
    span.className = bionicStrong[k] ? baseClass + ' dr-bionic-strong' : baseClass;
    span.textContent = chars[k];
    target.appendChild(span);
  }
  if (target !== node) node.appendChild(target);
}

// An unencodable glyph: its cropped image as one .dr-char, or a box if unavailable.
function buildGlyphChar(run, rasterizer) {
  const span = document.createElement('span');
  let className = 'dr-char dr-glyph';
  if (run.bold) className += ' dr-bold';
  if (run.italic) className += ' dr-italic';
  span.className = className;
  if (run.glyph.dataURL || (rasterizer && run.glyph.page && run.glyph.bbox)) {
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'dr-glyph-img';
    span.appendChild(img);
    setImageSource(img, run.glyph, rasterizer);
  } else {
    span.textContent = '□';
  }
  return span;
}

function bionicMask(chars) {
  const mask = new Array(chars.length).fill(false);
  let i = 0;
  while (i < chars.length) {
    if (!isLetter(chars[i])) {
      i++;
      continue;
    }
    let wordEnd = i;
    while (wordEnd < chars.length && isLetter(chars[wordEnd])) wordEnd++;
    const wordLength = wordEnd - i;
    const prefixLength = Math.min(wordLength, Math.max(1, Math.round(wordLength * BIONIC_PREFIX_RATIO)));
    for (let k = i; k < i + prefixLength; k++) mask[k] = true;
    i = wordEnd;
  }
  return mask;
}

function isLetter(ch) {
  return /\p{L}/u.test(ch);
}
