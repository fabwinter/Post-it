import { useLayoutEffect, useRef, useState } from "react";

// Explicit newlines define lines. Sizes belong to their line index so editing
// a line never changes the styles of the other lines in the same text box.
export function lineSettings(element) {
  return String(element.text || "").split("\n").map((_, index) => ({
    size: element.lineSizes?.[index] ?? element.fontSize ?? 16,
    fit: Boolean(element.fitLines?.[index]),
  }));
}

export function StyledText({ element, scale, style }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [fontVersion, setFontVersion] = useState(0);
  const sourceLines = String(element.text || "").split("\n");

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => { setWidth(node.clientWidth); setHeight(node.clientHeight); };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    document.fonts?.ready.then(() => { measure(); setFontVersion((value) => value + 1); });
    return () => observer?.disconnect();
  }, []);

  const settings = lineSettings(element);
  // Recalculate canvas metrics when a web font finishes loading.
  void fontVersion;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = (size) => `${element.fontStyle === "italic" ? "italic " : ""}${element.fontWeight || 600} ${size}px ${style.fontFamily}`;
  const lines = element.fitAllLines && width && context
    ? sourceLines.flatMap((sourceLine, sourceIndex) => {
      if (!sourceLine.trim()) return [{ text: "", setting: settings[sourceIndex] }];
      const words = sourceLine.trim().split(/\s+/);
      const wrapped = [];
      let current = "";
      context.font = font(settings[sourceIndex].size * scale);
      words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (current && context.measureText(candidate).width > width * 0.98) {
          wrapped.push({ text: current, setting: settings[sourceIndex] });
          current = word;
        } else current = candidate;
      });
      wrapped.push({ text: current, setting: settings[sourceIndex] });
      return wrapped;
    })
    : sourceLines.map((text, index) => ({ text, setting: settings[index] }));
  const sizes = lines.map(({ text, setting }) => {
    const fit = element.fitAllLines || setting.fit;
    if (!fit || !width || !text.trim() || !context) return setting.size * scale;
    context.font = font(100);
    const measured = context.measureText(text).width;
    return measured ? Math.min(240 * scale, (width * 0.98 * 100) / measured) : setting.size * scale;
  });
  // Fit-to-width lines also respect the box's height as a group.
  const leading = element.lineHeight || 1.2;
  const total = sizes.reduce((sum, size) => sum + size * leading, 0);
  const heightScale = (element.fitAllLines || settings.some((line) => line.fit)) && height && total > height ? height / total : 1;

  return (
    <div ref={ref} style={{ ...style, width: "100%", height: "100%" }}>
      {lines.map(({ text, setting }, index) => (
        <div key={index} style={{ fontSize: sizes[index] * heightScale, lineHeight: leading, whiteSpace: "pre", overflow: element.fitAllLines || setting.fit ? "hidden" : "visible" }}>
          {text || "\u00a0"}
        </div>
      ))}
    </div>
  );
}
