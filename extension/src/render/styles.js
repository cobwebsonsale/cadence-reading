export function textStyleToCss(textStyle) {
  if (!textStyle) return '';
  const decls = [];

  if (textStyle.bold) decls.push('font-weight:700');
  if (textStyle.italic) decls.push('font-style:italic');

  const decorations = [];
  if (textStyle.underline) decorations.push('underline');
  if (textStyle.strikethrough) decorations.push('line-through');
  if (decorations.length) decls.push(`text-decoration:${decorations.join(' ')}`);

  if (textStyle.smallCaps) decls.push('font-variant:small-caps');

  const color = colorOf(textStyle.foregroundColor);
  if (color) decls.push(`color:${color}`);

  const background = colorOf(textStyle.backgroundColor);
  if (background) decls.push(`background-color:${background}`);

  switch (textStyle.baselineOffset) {
    case 'SUPERSCRIPT':
      decls.push('vertical-align:super', 'font-size:0.75em');
      break;
    case 'SUBSCRIPT':
      decls.push('vertical-align:sub', 'font-size:0.75em');
      break;
  }

  return decls.join(';');
}

// Keep the author's structural choices (alignment, direction, spacing); impose our own font/size/leading.
export function paragraphStyleToCss(paragraphStyle) {
  if (!paragraphStyle) return '';
  const decls = [];

  switch (paragraphStyle.alignment) {
    case 'CENTER':
      decls.push('text-align:center');
      break;
    case 'END':
      decls.push('text-align:right');
      break;
    case 'JUSTIFIED':
      decls.push('text-align:justify');
      break;
  }

  const spaceAbove = dimToPx(paragraphStyle.spaceAbove);
  if (spaceAbove != null) decls.push(`margin-top:${spaceAbove}px`);
  const spaceBelow = dimToPx(paragraphStyle.spaceBelow);
  if (spaceBelow != null) decls.push(`margin-bottom:${spaceBelow}px`);

  if (paragraphStyle.direction === 'RIGHT_TO_LEFT') decls.push('direction:rtl');

  return decls.join(';');
}

const PT_TO_PX = 96 / 72;
export function dimToPx(dimension) {
  if (!dimension || typeof dimension.magnitude !== 'number') return null;
  return Math.round(dimension.magnitude * PT_TO_PX * 100) / 100;
}

export function colorOf(optionalColor) {
  const rgb = optionalColor?.color?.rgbColor;
  if (!rgb) return null;
  const r = Math.round((rgb.red || 0) * 255);
  const g = Math.round((rgb.green || 0) * 255);
  const b = Math.round((rgb.blue || 0) * 255);
  return `rgb(${r},${g},${b})`;
}

export function linkUrlOf(textStyle) {
  const link = textStyle?.link;
  if (!link) return null;
  if (link.url) return link.url;
  if (link.headingId) return `#heading-${link.headingId}`;
  if (link.bookmarkId) return `#bookmark-${link.bookmarkId}`;
  return null;
}
