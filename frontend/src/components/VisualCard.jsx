import { forwardRef } from "react";
import { Twitter, BadgeCheck, Loader2 } from "lucide-react";

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

// The brand kit becomes a fifth theme, so "on brand" is one click rather than a
// palette the user has to re-key into every graphic.
export function themeFor(key, brand) {
  if (key === "brand" && brand?.colors) {
    const c = brand.colors;
    return {
      key: "brand", label: brand.name || "Brand",
      bg: c.bg || "#0A0A0A", fg: c.fg || "#FFFFFF",
      sub: c.sub || "#a1a1aa", accent: c.accent || "#E2FF3D", pattern: "dots",
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

const wordmark = (brand) => (brand?.handle || brand?.name || "CREATEOS").toUpperCase();

export const VisualCard = forwardRef(function VisualCard(
  { spec, brand, loading = false, scale = 1, className = "" }, ref
) {
  const theme = themeFor(spec?.theme, brand);
  const base = { background: theme.bg, color: theme.fg };
  const patt = patternStyle(theme);
  // Type sizes are expressed against a 440px-wide reference card so the same
  // spec renders identically in a 120px strip thumbnail and a full preview.
  const f = (n) => `${n * scale}px`;

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

  const t = spec.template;
  const pad = { padding: f(36) };

  if (t === "quote") {
    return (
      <div ref={ref} className={`relative flex h-full w-full flex-col justify-between ${className}`} style={{ ...base, ...pad }}>
        <div className="absolute inset-0" style={patt} />
        <div className="relative font-display" style={{ fontSize: f(64), lineHeight: 1, color: theme.accent }}>&ldquo;</div>
        <p className="relative font-display" style={{ fontSize: f(28), fontWeight: 700, lineHeight: 1.25 }}>{spec.quote}</p>
        <div className="relative flex items-center justify-between">
          <span style={{ color: theme.sub, fontSize: f(14), fontWeight: 600 }}>— {spec.author}</span>
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
        <p className="font-display" style={{ marginTop: f(20), fontSize: f(25), lineHeight: 1.35, fontWeight: 500 }}>{spec.text}</p>
        <div style={{ marginTop: f(24), color: theme.sub, fontSize: f(13) }}>9:41 AM · {wordmark(brand)}</div>
      </div>
    );
  }

  if (t === "infographic") {
    return (
      <div ref={ref} className={`relative flex h-full w-full flex-col ${className}`} style={{ ...base, ...pad }}>
        <div className="absolute inset-0" style={patt} />
        <div className="relative font-mono" style={{ color: theme.accent, fontSize: f(11), letterSpacing: f(3) }}>INFOGRAPHIC</div>
        <h2 className="relative font-display" style={{ marginTop: f(12), fontSize: f(34), fontWeight: 800, lineHeight: 1.05 }}>{spec.title}</h2>
        <div className="relative flex flex-1 flex-col justify-center" style={{ marginTop: f(24), gap: f(12) }}>
          {(spec.points || []).map((p, i) => (
            <div key={i} className="flex items-start" style={{ gap: f(12) }}>
              <span className="flex-shrink-0 font-display" style={{ background: theme.accent, color: "#0A0A0A", fontWeight: 800, width: f(30), height: f(30), borderRadius: f(8), display: "flex", alignItems: "center", justifyContent: "center", fontSize: f(15) }}>{i + 1}</span>
              <span style={{ fontSize: f(17), lineHeight: 1.3, fontWeight: 500 }}>{p}</span>
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
      {spec.image_url && (
        <img src={spec.image_url} alt="" crossOrigin="anonymous"
          className="absolute inset-0 h-full w-full object-cover" style={{ opacity: 0.45 }} />
      )}
      <div className="absolute inset-0" style={patt} />
      <div className="relative flex items-center justify-between font-mono" style={{ color: theme.accent, fontSize: f(11), letterSpacing: f(2) }}>
        <span>{isCover ? "SWIPE →" : total > 1 ? `${spec.index}/${hasCover ? total - 1 : total}` : ""}</span>
        <span style={{ color: theme.sub }}>{wordmark(brand)}</span>
      </div>
      <div className="relative flex flex-1 flex-col justify-center">
        {isCover ? (
          <h2 className="font-display" style={{ fontSize: f(40), fontWeight: 800, lineHeight: 1.05 }}>{spec.title}</h2>
        ) : (
          <>
            <h3 className="font-display" style={{ fontSize: f(30), fontWeight: 800, lineHeight: 1.1 }}>{spec.heading}</h3>
            {spec.body && <p style={{ marginTop: f(16), fontSize: f(18), lineHeight: 1.4, color: theme.sub }}>{spec.body}</p>}
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
