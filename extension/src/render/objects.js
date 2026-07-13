const PT_TO_PX = 96 / 72;

export function buildInlineObject(objectId, inlineObjects) {
  const embedded = inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject;
  const wrap = document.createElement('span');
  wrap.className = 'dr-inline-object';

  const uri = embedded?.imageProperties?.contentUri;
  if (uri) {
    const img = document.createElement('img');
    img.src = uri;
    if (embedded.title) img.alt = embedded.title;
    if (embedded.description) img.title = embedded.description;
    applySize(img, embedded.size);
    img.loading = 'eager';
    img.decoding = 'async';
    wrap.appendChild(img);
  } else {
    wrap.textContent = embedded?.title || '⬚';
    wrap.classList.add('dr-inline-object-missing');
  }
  return wrap;
}

function applySize(img, size) {
  const width = dimToPx(size?.width);
  const height = dimToPx(size?.height);
  if (width) img.style.width = `${width}px`;
  if (height) img.style.height = `${height}px`;
  img.style.maxWidth = '100%';
}

function dimToPx(dimension) {
  if (!dimension || typeof dimension.magnitude !== 'number') return null;
  return Math.round(dimension.magnitude * PT_TO_PX);
}
