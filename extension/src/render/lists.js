const PT_TO_PX = 96 / 72;
const DEFAULT_NESTING_INDENT_PT = 36;

export function createListContext(lists) {
  const countersByList = new Map();

  function countersFor(listId) {
    let counters = countersByList.get(listId);
    if (!counters) {
      counters = [];
      countersByList.set(listId, counters);
    }
    return counters;
  }

  return {
    glyphFor(bullet) {
      if (!bullet || !bullet.listId) return null;
      const listProperties = lists?.[bullet.listId]?.listProperties;
      const levels = listProperties?.nestingLevels || [];
      const level = bullet.nestingLevel || 0;
      const levelProps = levels[level] || {};

      const indentPx = nestingIndentPx(levelProps, level);

      if (!isOrdered(levelProps)) {
        return { text: levelProps.glyphSymbol || '•', indentPx, ordered: false };
      }

      const counters = countersFor(bullet.listId);
      const startNumber = typeof levelProps.startNumber === 'number' ? levelProps.startNumber : 1;
      counters[level] = (counters[level] == null ? startNumber - 1 : counters[level]) + 1;
      for (let deeper = level + 1; deeper < counters.length; deeper++) counters[deeper] = null;

      const text = formatGlyph(levelProps.glyphFormat || `%${level}.`, counters, levels);
      return { text, indentPx, ordered: true };
    },
  };
}

function isOrdered(levelProps) {
  // A bullet glyph means unordered; otherwise a type, format, or start number means ordered.
  if (levelProps.glyphSymbol) return false;
  const glyphType = levelProps.glyphType;
  if (glyphType && glyphType !== 'GLYPH_TYPE_UNSPECIFIED' && glyphType !== 'NONE') return true;
  if (levelProps.glyphFormat) return true;
  return typeof levelProps.startNumber === 'number';
}

function formatGlyph(format, counters, levels) {
  return format.replace(/%(\d+)/g, (_, levelDigits) => {
    const level = Number(levelDigits);
    const value = counters[level];
    if (value == null) return '';
    return formatNumber(value, levels[level]?.glyphType);
  });
}

function formatNumber(value, glyphType) {
  switch (glyphType) {
    case 'ALPHA':
      return toAlpha(value).toLowerCase();
    case 'UPPER_ALPHA':
      return toAlpha(value).toUpperCase();
    case 'ROMAN':
      return toRoman(value).toLowerCase();
    case 'UPPER_ROMAN':
      return toRoman(value).toUpperCase();
    case 'DECIMAL':
    case 'ZERO_DECIMAL':
    default:
      return glyphType === 'ZERO_DECIMAL' && value < 10 ? `0${value}` : String(value);
  }
}

function toAlpha(value) {
  let result = '';
  let remaining = value;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    result = String.fromCharCode(97 + remainder) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result || 'a';
}

function toRoman(value) {
  if (value <= 0) return String(value);
  const numerals = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let remaining = value;
  let result = '';
  for (const [amount, symbol] of numerals) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}

function nestingIndentPx(levelProps, level) {
  const indent = levelProps.indentStart;
  if (indent && typeof indent.magnitude === 'number') {
    return Math.round(indent.magnitude * PT_TO_PX);
  }
  return Math.round((level + 1) * DEFAULT_NESTING_INDENT_PT * PT_TO_PX);
}
