export const DEFAULT_LINE_SIZE_MULTIPLIER = 1;

export function getTextLines(text = "") {
  return String(text).split("\n");
}

export function normalizeLineStyles(text, lineStyles = []) {
  const lineCount = getTextLines(text).length;

  return Array.from({ length: lineCount }, (_, index) => {
    const style = lineStyles[index] || {};

    return {
      sizeMultiplier: clampNumber(
        style.sizeMultiplier,
        0.25,
        3,
        DEFAULT_LINE_SIZE_MULTIPLIER
      ),
    };
  });
}

export function resizeLineStyles(text, lineStyles = []) {
  return normalizeLineStyles(text, lineStyles);
}

export function updateLineStyle(text, lineStyles, lineIndex, patch) {
  const nextStyles = normalizeLineStyles(text, lineStyles);

  if (lineIndex < 0 || lineIndex >= nextStyles.length) {
    return nextStyles;
  }

  nextStyles[lineIndex] = {
    ...nextStyles[lineIndex],
    ...patch,
  };

  return normalizeLineStyles(text, nextStyles);
}

export function changeLineSize(text, lineStyles, lineIndex, delta) {
  const currentStyles = normalizeLineStyles(text, lineStyles);
  const currentSize = currentStyles[lineIndex]?.sizeMultiplier
    ?? DEFAULT_LINE_SIZE_MULTIPLIER;

  return updateLineStyle(text, currentStyles, lineIndex, {
    sizeMultiplier: clampNumber(currentSize + delta, 0.25, 3, 1),
  });
}

export function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}
