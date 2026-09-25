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
  const lines = String(element.text || "").split("\n");

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
  const sizes = settings.map(({ size, fit }, index) => {
    if (!fit || !width || !lines[index].trim()) return size * scale;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return size * scale;
    context.font = `${element.fontStyle === "italic" ? "italic " : ""}${element.fontWeight || 600} 100px ${style.fontFamily}`;
    const measured = context.measureText(lines[index]).width;
    return measured ? Math.min(240 * scale, (width * 0.98 * 100) / measured) : size * scale;
  });
  // Fit-to-width lines also respect the box's height as a group.
  const leading = element.lineHeight || 1.2;
  const total = sizes.reduce((sum, size) => sum + size * leading, 0);
  const heightScale = settings.some((line) => line.fit) && height && total > height ? height / total : 1;

  return (
    <div ref={ref} style={{ ...style, width: "100%", height: "100%" }}>
      {lines.map((line, index) => (
        <div key={index} style={{ fontSize: sizes[index] * heightScale, lineHeight: leading, whiteSpace: "pre", overflow: settings[index].fit ? "hidden" : "visible" }}>
          {line || "\u00a0"}
        </div>
      ))}
    </div>
  );
}
