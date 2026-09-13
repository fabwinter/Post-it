import { forwardRef, useEffect } from "react";
import { Twitter, BadgeCheck, Loader2 } from "lucide-react";
import { activeColors } from "@/lib/useBrand";
import { fontStack, useBrandFonts, ensureFontLoaded } from "@/lib/fonts";
import { elementBoxStyle } from "@/lib/slideElements";
import { normalizeClip, filterCss } from "@/lib/videoClip";
import { ICON_MAP } from "@/lib/elementLibrary";

// One card = one spec. Keeping the renderer a pure function of a small spec
// object is what lets a post store a ten-slide carousel as a few hundred bytes
// of JSON instead of ten base64 PNGs, and lets slides be edited, reordered and
// re-themed after the fact.
export const THEMES = {
  midnight: { key: "midnight", label: "Midnight", bg: "#0A0A0A", fg: "#FFFFFF", sub: "#a1a1aa", accent: "#E2FF3D", pattern: "dots" },
  whiteboard: { key: "whiteboard", label: "Whiteboard", bg: "#F7F7F2", fg: "#141414", sub: "#4b5563", accent: "#E2FF3D", pattern: "grid" },
  chalkboard: { key: "chalkboard", label: "Chalkboard", bg: "#12211C", fg: "#F4F1E9", sub: "#9db5a8", accent: "#E2FF3D", pattern: "chalk" },
  gradient: { key: "gradient", label: "Gradient", bg: "linear-gradient(135deg,#1a1a2e 0%,#0A0A0A 60%)", fg: "#FFFFFF", sub: "#C4B5FD", accent: "#E2FF3D", pattern: "none" },
};

export const THEME_LIST = Object.values(THEMES);

// A brand's own picked colors can end up too close to each other — a dark
// primary next to a dark secondary is a real palette people ship. This is
// the one guardrail on top of "use whatever the kit says": body and heading
// text stays legible against its own background, whatever the palette,
// falling back to plain black or white (whichever contrasts more) rather
// than silently rendering unreadable text.
function _hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
function _relativeLuminance([r, g, b]) {
  const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function _contrastRatio(hexA, hexB) {
  const a = _hexToRgb(hexA), b = _hexToRgb(hexB);
  if (!a || !b) return 21; // not a plain hex (e.g. a gradient) — nothing to check, leave it alone
  const [l1, l2] = [_relativeLuminance(a), _relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
export function readableColor(hex, bgHex, minRatio = 4.5) {
  if (_contrastRatio(hex, bgHex) >= minRatio) return hex;
  return _contrastRatio("#FFFFFF", bgHex) >= _contrastRatio("#000000", bgHex) ? "#FFFFFF" : "#000000";
}

// The brand kit becomes a fifth theme, so "on brand" is one click rather than a
// palette the user has to re-key into every graphic. Its colors come from
// whichever of the kit's two palettes (dark/light) is currently active, and it
// carries the kit's picked fonts along so text actually renders in them.
export function themeFor(key, brand) {
  if (key === "brand" && brand?.colors) {
    const c = activeColors(brand);
    return {
      key: "brand", label: brand.name || "Brand",
      bg: c.bg, fg: readableColor(c.fg, c.bg), sub: readableColor(c.sub, c.bg), accent: c.accent, pattern: "dots",
      fonts: brand.fonts,
    };
  }
  return THEMES[key] || THEMES.midnight;
}

export function patternStyle(theme) {
  if (theme.pattern === "grid") return { backgroundImage: "linear-gradient(rgba(0,0,0,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.06) 1px,transparent 1px)", backgroundSize: "28px 28px" };
  if (theme.pattern === "dots") return { backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)", backgroundSize: "26px 26px" };
  if (theme.pattern === "chalk") return { backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)", backgroundSize: "30px 30px" };
  return {};
}

// Aspect ratios are per-platform (see lib/platformSpecs) — the card fills
// whatever box it is given rather than assuming a square.
export const ASPECT_CLASS = {
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-video",
  "1.91:1": "aspect-[1.91/1]",
};

// The same ratios as a number (height / width), for the places that have to
// size a card in real pixels — the full-screen canvas fits the card to the
// stage, which a CSS aspect class can't do on its own.
export const ASPECT_RATIO = {
  "1:1": 1,
  "4:5": 5 / 4,
  "9:16": 16 / 9,
  "16:9": 9 / 16,
  "1.91:1": 1 / 1.91,
};

const wordmark = (brand) => (brand?.handle || brand?.name || "CREATEOS").toUpperCase();

export const VisualCard = forwardRef(function VisualCard(
  { spec, brand, loading = false, scale = 1, className = "", videoRef, videoControlled = false }, ref
) {
  const theme = themeFor(spec?.theme, brand);
  const base = { background: theme.bg, color: theme.fg };
  const patt = patternStyle(theme);
  // Whatever sits behind the words. A clip carries its own grade, framing
  // and how far it sits behind the overlays (lib/videoClip.js); a still
  // keeps the plain dim it always had. Both render branches below share
  // this — they used to hold separate copies, and the one every reel scene
  // actually goes through kept a hardcoded 0.45 that no clip setting could
  // move. Left looping on its own as a preview; ReelPlayer passes
  // videoControlled to drive currentTime/playbackRate itself instead.
  const clip = spec?.video_url ? normalizeClip({ ...spec.clip, url: spec.video_url }) : null;
  const backdrop = clip ? (
    <video ref={videoRef} src={spec.video_url} muted playsInline
      loop={!videoControlled} autoPlay={!videoControlled}
      className="absolute inset-0 h-full w-full"
      style={{ opacity: clip.opacity, objectFit: clip.fit, filter: filterCss(clip.effects) }} />
  ) : spec?.image_url ? (
    <img src={spec.image_url} alt="" crossOrigin="anonymous"
      className="absolute inset-0 h-full w-full object-cover" style={{ opacity: 0.45 }} />
  ) : null;
  // Type sizes are expressed against a 440px-wide reference card so the same
  // spec renders identically in a 120px strip thumbnail and a full preview.
  const f = (n) => `${n * scale}px`;
  // Only the brand theme carries picked fonts — every other theme keeps the
  // app's default type rather than silently reverting mid-deck.
  useBrandFonts(theme.fonts);
  // A freeform text element can pick its OWN font, independent of the brand
  // theme (see the Composer's element property panel) — that choice needs
  // its own webfont <link> too, or the font-family just falls back to
  // whatever's already loaded instead of the one actually picked.
  const elementFonts = (spec?.elements || []).map((el) => el.fontFamily).filter(Boolean).join(",");
  useEffect(() => {
    elementFonts.split(",").filter(Boolean).forEach(ensureFontLoaded);
  }, [elementFonts]);
  const displayFont = theme.fonts?.display ? fontStack(theme.fonts.display) : undefined;
  const bodyFont = theme.fonts?.body ? fontStack(theme.fonts.body) : undefined;

  if (loading) {
    return (
      <div ref={ref} className={`flex h-full w-full items-center justify-center ${className}`} style={base}>
        <Loader2 className="animate-spin" style={{ color: theme.accent }} />
      </div>
    );
  }
  if (!spec) {
    return (
      <div ref={ref} className={`flex h-full w-full items-center justify-center text-center ${className}`} style={base}>
        <span style={{ color: theme.sub, fontSize: f(13), padding: f(24) }}>Nothing to render yet</span>
      </div>
    );
  }

  // A slide with a freeform layout renders its elements array directly,
  // bypassing the fixed template branches below entirely — "Edit layout" in
  // the Composer is a one-way door into this mode per slide (see
  // lib/slideElements.js for how a template's fields become the starting
  // elements). Positions are percentages of the card box, so the same
  // numbers hold at any card size (a 68px strip thumbnail or a full preview).
  if (spec.elements) {
    const bg = spec.bg_color ? { background: spec.bg_color, color: theme.fg } : base;
    return (
      <div ref={ref} className={`relative h-full w-full overflow-hidden ${className}`} style={bg}>
        {backdrop}
        {spec.elements.map((el) => {
          const box = elementBoxStyle(el);
          // Starter templates reference the palette and the brand's fonts by
          // role rather than by value, so they re-theme themselves; anything
          // the user has since set explicitly wins over the role.
          const roleColor = el.color || theme[el.colorRole] || theme.fg;
          const family = el.fontFamily || (el.fontKind && theme.fonts?.[el.fontKind]) || undefined;
          if (el.type === "text") {
            return (
              // A text box imported from a design tool is sized to hug the
              // text it was authored with, and those tools let a line spill
              // past the box rather than cutting it off. Clipping here threw
              // away the tail of anything even slightly larger — a swapped-in
              // font measuring wider, or fresh copy longer than the original.
              // The card itself still clips, so nothing escapes the slide.
              <div key={el.id} style={{ ...box, fontFamily: fontStack(family), fontSize: f(el.fontSize || 16),
                fontWeight: el.fontWeight || 600, color: roleColor, textAlign: el.align || "left",
                lineHeight: el.lineHeight || 1.2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {el.text}
              </div>
            );
          }
          if (el.type === "image") {
            return el.url ? (
              <img key={el.id} src={el.url} alt="" crossOrigin="anonymous"
                style={{ ...box, objectFit: el.fit || "cover" }} />
            ) : (
              <div key={el.id} style={{ ...box, border: "1px dashed rgba(150,150,150,0.4)" }} />
            );
          }
          if (el.type === "video") {
            return el.url ? (
              <video key={el.id} src={el.url} muted loop autoPlay playsInline
                style={{ ...box, objectFit: el.fit || "cover", filter: filterCss(el.effects) }} />
            ) : (
              <div key={el.id} style={{ ...box, border: "1px dashed rgba(150,150,150,0.4)" }} />
            );
          }
          if (el.type === "icon") {
            const IconCmp = ICON_MAP[el.name] || ICON_MAP.star;
            return <IconCmp key={el.id} style={box} color={el.color || theme.accent} absoluteStrokeWidth strokeWidth={el.strokeWidth || 2} />;
          }
          return <div key={el.id} style={{ ...box, background: el.color || theme[el.colorRole] || theme.accent, borderRadius: el.shape === "ellipse" ? "50%" : `${f(4)}` }} />;
        })}
      </div>
    );
  }

  const t = spec.template;
  const pad = { padding: f(36) };

  if (t === "quote") {
    return (
      <div ref={ref} className={`relative flex h-full w-full flex-col justify-between ${className}`} style={{ ...base, ...pad }}>
        <div className="absolute inset-0" style={patt} />
        <div className="relative font-display" style={{ fontSize: f(64), lineHeight: 1, color: theme.accent }}>&ldquo;</div>
        <p className="relative font-display" style={{ fontSize: f(28), fontWeight: 700, lineHeight: 1.25, fontFamily: displayFont }}>{spec.quote}</p>
        <div className="relative flex items-center justify-between">
          <span style={{ color: theme.sub, fontSize: f(14), fontWeight: 600, fontFamily: bodyFont }}>— {spec.author}</span>
          <span style={{ color: theme.accent, fontSize: f(11), fontFamily: "JetBrains Mono, monospace", letterSpacing: f(2) }}>{wordmark(brand)}</span>
        </div>
      </div>
    );
  }

  if (t === "tweet") {
    return (
      <div ref={ref} className={`flex h-full w-full flex-col justify-center ${className}`} style={{ ...base, ...pad }}>
        <div className="flex items-center" style={{ gap: f(12) }}>
          <div style={{ height: f(52), width: f(52), borderRadius: 999, background: `linear-gradient(135deg,${theme.accent},#C4B5FD)` }} />
          <div>
            <div className="flex items-center" style={{ fontSize: f(17), fontWeight: 700, gap: f(4) }}>
              {spec.name}<BadgeCheck size={16 * scale} style={{ color: "#1DA1F2" }} />
            </div>
            <div style={{ color: theme.sub, fontSize: f(14) }}>{spec.handle}</div>
          </div>
          <Twitter size={22 * scale} className="ml-auto" style={{ color: theme.sub }} />
        </div>
        <p className="font-display" style={{ marginTop: f(20), fontSize: f(25), lineHeight: 1.35, fontWeight: 500, fontFamily: bodyFont }}>{spec.text}</p>
        <div style={{ marginTop: f(24), color: theme.sub, fontSize: f(13) }}>9:41 AM · {wordmark(brand)}</div>
      </div>
    );
  }

  if (t === "infographic") {
    return (
      <div ref={ref} className={`relative flex h-full w-full flex-col ${className}`} style={{ ...base, ...pad }}>
        <div className="absolute inset-0" style={patt} />
        <div className="relative font-mono" style={{ color: theme.accent, fontSize: f(11), letterSpacing: f(3) }}>INFOGRAPHIC</div>
        <h2 className="relative font-display" style={{ marginTop: f(12), fontSize: f(34), fontWeight: 800, lineHeight: 1.05, fontFamily: displayFont }}>{spec.title}</h2>
        <div className="relative flex flex-1 flex-col justify-center" style={{ marginTop: f(24), gap: f(12) }}>
          {(spec.points || []).map((p, i) => (
            <div key={i} className="flex items-start" style={{ gap: f(12) }}>
              <span className="flex-shrink-0 font-display" style={{ background: theme.accent, color: "#0A0A0A", fontWeight: 800, width: f(30), height: f(30), borderRadius: f(8), display: "flex", alignItems: "center", justifyContent: "center", fontSize: f(15) }}>{i + 1}</span>
              <span style={{ fontSize: f(17), lineHeight: 1.3, fontWeight: 500, fontFamily: bodyFont }}>{p}</span>
            </div>
          ))}
        </div>
        <div className="relative font-mono" style={{ color: theme.sub, fontSize: f(11), letterSpacing: f(2) }}>{wordmark(brand)}</div>
      </div>
    );
  }

  // cover / slide — the two halves of a carousel, and the storyboard frame for
  // a reel scene.
  const isCover = t === "cover";
  const total = spec.total || 1;
  // A carousel's cover is slide 0 of N+1; a reel storyboard has no cover, so
  // its scenes are 1..N. `coverCounts` says which numbering this card is in.
  const hasCover = spec.coverCounts !== false;
  const dot = hasCover ? (spec.index || 0) : (spec.index || 1) - 1;
  return (
    <div ref={ref} className={`relative flex h-full w-full flex-col justify-between ${className}`} style={{ ...base, ...pad }}>
      {backdrop}
      <div className="absolute inset-0" style={patt} />
      <div className="relative flex items-center justify-between font-mono" style={{ color: theme.accent, fontSize: f(11), letterSpacing: f(2) }}>
        <span>{isCover ? "SWIPE →" : total > 1 ? `${spec.index}/${hasCover ? total - 1 : total}` : ""}</span>
        <span style={{ color: theme.sub }}>{wordmark(brand)}</span>
      </div>
      <div className="relative flex flex-1 flex-col justify-center">
        {isCover ? (
          <h2 className="font-display" style={{ fontSize: f(40), fontWeight: 800, lineHeight: 1.05, fontFamily: displayFont }}>{spec.title}</h2>
        ) : (
          <>
            <h3 className="font-display" style={{ fontSize: f(30), fontWeight: 800, lineHeight: 1.1, fontFamily: displayFont }}>{spec.heading}</h3>
            {spec.body && <p style={{ marginTop: f(16), fontSize: f(18), lineHeight: 1.4, color: theme.sub, fontFamily: bodyFont }}>{spec.body}</p>}
          </>
        )}
      </div>
      {total > 1 && (
        <div className="relative flex" style={{ gap: f(6) }}>
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} style={{ height: f(4), flex: 1, borderRadius: f(4), background: i === dot ? theme.accent : "rgba(150,150,150,0.3)" }} />
          ))}
        </div>
      )}
    </div>
  );
});
