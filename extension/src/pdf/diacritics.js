// Recompose a base letter + overprinted spacing accent (dotless i/j map back to i/j).
const SPACING_TO_COMBINING = {
  '¨': '̈', // diaeresis
  '´': '́', // acute
  'ˆ': '̂', // circumflex
  '˜': '̃', // tilde
  '¯': '̄', // macron
  '˚': '̊', // ring above
  '¸': '̧', // cedilla
  'ˇ': '̌', // caron
};
const DIACRITIC_RE = /([A-Za-zıȷ])([¨´ˆ˜¯˚¸ˇ])/g;

export function composeDiacritics(text) {
  return text.replace(DIACRITIC_RE, (_, base, accent) => {
    const letter = base === 'ı' ? 'i' : base === 'ȷ' ? 'j' : base;
    return (letter + SPACING_TO_COMBINING[accent]).normalize('NFC');
  });
}
