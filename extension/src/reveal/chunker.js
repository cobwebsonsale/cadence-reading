export const TARGET_LINES = 7;
export const MIN_TAIL_LINES = 3;

const ABBREVIATIONS = new Set([
  'etc', 'al', 'et', 'eg', 'ie', 'cf', 'vs', 'fig', 'figs', 'no', 'nos', 'vol',
  'vols', 'pp', 'ch', 'sec', 'eq', 'ref', 'refs', 'approx', 'dr', 'mr', 'mrs',
  'ms', 'prof', 'st', 'jr', 'sr', 'inc', 'ltd', 'dept',
]);

export function planChunks(para) {
  const { totalLines, sentenceEnds } = measureParagraph(para);
  const pauseBeforeChars = new Set();
  let chunkStartLine = 0;
  while (chunkStartLine + TARGET_LINES < totalLines) {
    const targetLine = chunkStartLine + TARGET_LINES;
    const sentenceEnd = sentenceEnds.find(
      (end) => end.line >= targetLine && end.line < totalLines
    );
    if (!sentenceEnd) break;
    if (totalLines - sentenceEnd.line < MIN_TAIL_LINES) break;
    pauseBeforeChars.add(sentenceEnd.el);
    chunkStartLine = sentenceEnd.line;
  }
  return pauseBeforeChars;
}

function measureParagraph(para) {
  const chars = para.querySelectorAll('.dr-char');
  const lineOfChar = new Array(chars.length);
  let totalLines = 0;
  let prevTop = null;
  for (let k = 0; k < chars.length; k++) {
    if (!chars[k].hasAttribute('data-instant')) {
      const top = chars[k].offsetTop;
      if (top !== prevTop) {
        totalLines++;
        prevTop = top;
      }
    }
    lineOfChar[k] = Math.max(0, totalLines - 1);
  }

  const sentenceEnds = [];
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[k].textContent;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    if (ch === '.' && isAbbreviationPeriod(chars, k)) continue;
    const nextIsSameLineWord =
      k + 1 < chars.length &&
      lineOfChar[k + 1] === lineOfChar[k] &&
      !/\s/.test(chars[k + 1].textContent);
    if (nextIsSameLineWord) continue;
    let nextSentenceStart = k + 1;
    while (
      nextSentenceStart < chars.length &&
      /\s/.test(chars[nextSentenceStart].textContent)
    ) {
      nextSentenceStart++;
    }
    if (nextSentenceStart >= chars.length) continue;
    sentenceEnds.push({
      line: lineOfChar[nextSentenceStart],
      el: chars[nextSentenceStart],
    });
  }

  return { totalLines: totalLines || 1, sentenceEnds };
}

function isAbbreviationPeriod(chars, k) {
  let word = '';
  for (let i = k - 1; i >= 0 && /[A-Za-z]/.test(chars[i].textContent); i--) {
    word = chars[i].textContent + word;
  }
  if (!word) return false;
  return word.length === 1 || ABBREVIATIONS.has(word.toLowerCase());
}
