import React, { useEffect, useMemo, useState } from "react";
import {
  changeLineSize,
  getTextLines,
  normalizeLineStyles,
} from "@/lib/richTextLines";

function getLineLabel(line, index) {
  const preview = line.trim() || "(empty line)";
  return `Line ${index + 1}: ${preview.length > 36 ? `${preview.slice(0, 36)}…` : preview}`;
}

export default function LineTypographyControls({
  text = "",
  lineStyles = [],
  onChange,
  disabled = false,
}) {
  const lines = useMemo(() => getTextLines(text), [text]);
  const normalizedStyles = useMemo(
    () => normalizeLineStyles(text, lineStyles),
    [text, lineStyles]
  );

  const [selectedLineIndex, setSelectedLineIndex] = useState(0);

  useEffect(() => {
    setSelectedLineIndex((currentIndex) =>
      Math.min(Math.max(currentIndex, 0), Math.max(lines.length - 1, 0))
    );
  }, [lines.length]);

  if (!text) {
    return null;
  }

  const currentMultiplier =
    normalizedStyles[selectedLineIndex]?.sizeMultiplier ?? 1;

  const updateLineSize = (delta) => {
    onChange(
      changeLineSize(
        text,
        normalizedStyles,
        selectedLineIndex,
        delta
      )
    );
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor="text-line-selector"
        className="block text-xs font-medium text-muted-foreground"
      >
        Line size
      </label>

      <select
        id="text-line-selector"
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={selectedLineIndex}
        onChange={(event) => setSelectedLineIndex(Number(event.target.value))}
        disabled={disabled}
      >
        {lines.map((line, index) => (
          <option key={`${index}-${line}`} value={index}>
            {getLineLabel(line, index)}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-9 min-w-9 rounded-md border border-input bg-background px-3 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => updateLineSize(-0.1)}
          disabled={disabled || currentMultiplier <= 0.25}
          aria-label="Make selected line smaller"
          title="Make selected line smaller"
        >
          A−
        </button>

        <output className="min-w-16 text-center text-sm tabular-nums">
          {Math.round(currentMultiplier * 100)}%
        </output>

        <button
          type="button"
          className="h-9 min-w-9 rounded-md border border-input bg-background px-3 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => updateLineSize(0.1)}
          disabled={disabled || currentMultiplier >= 3}
          aria-label="Make selected line bigger"
          title="Make selected line bigger"
        >
          A+
        </button>

        <button
          type="button"
          className="ml-auto h-9 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onChange(
            normalizedStyles.map((style, index) =>
              index === selectedLineIndex
                ? { ...style, sizeMultiplier: 1 }
                : style
            )
          )}
          disabled={disabled || currentMultiplier === 1}
          title="Reset selected line to normal size"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
