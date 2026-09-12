import { forwardRef } from "react";
import { fontStack, useBrandFonts } from "@/lib/fonts";

// A one-page, printable brand guideline — the "quick reference" sheet a
// brand kit's own scattered fields (colors, fonts, voice, logo) don't
// otherwise assemble into anything you could actually hand to a designer or
// partner. Modeled on a standard one-page brand-guidelines layout: logo
// usage, color palette, type hierarchy, imagery/icon direction, and voice —
// with a plain white "paper" background regardless of the kit's own
// dark/light theme, since that's how a printed guideline reads.
//
// Sized against an 850px-wide reference page (roughly US-letter
// proportions) — `scale` shrinks the whole thing uniformly for a sidebar
// preview without changing any of the numbers below.
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "";
}

const SectionLabel = ({ n, title, f }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: f(8), marginTop: f(18), marginBottom: f(8) }}>
    <span style={{ fontSize: f(10), fontWeight: 800, color: "#9ca3af", letterSpacing: "0.05em" }}>{n}</span>
    <span style={{ fontSize: f(12), fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#141414" }}>{title}</span>
    <span style={{ flex: 1, borderBottom: "1px solid #e5e7eb" }} />
  </div>
);

const Swatch = ({ label, hex, f }) => (
  <div style={{ textAlign: "center", width: f(56) }}>
    <div style={{ width: f(44), height: f(44), borderRadius: f(8), background: hex || "#e5e7eb", border: "1px solid rgba(0,0,0,0.08)", margin: "0 auto" }} />
    <div style={{ fontSize: f(8), marginTop: f(4), color: "#374151", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: f(7), fontFamily: "monospace", color: "#9ca3af" }}>{(hex || "").toUpperCase()}</div>
    <div style={{ fontSize: f(6.5), fontFamily: "monospace", color: "#c1c5cc" }}>{hexToRgb(hex)}</div>
  </div>
);

export const BrandGuidelineDoc = forwardRef(function BrandGuidelineDoc({ brand, scale = 1 }, ref) {
  useBrandFonts(brand?.fonts);
  const displayFont = fontStack(brand?.fonts?.display);
  const bodyFont = fontStack(brand?.fonts?.body);
  const g = brand?.guideline || {};
  const dark = brand?.colors?.dark || {};
  const light = brand?.colors?.light || {};
  const f = (n) => `${n * scale}px`;
  const hasName = brand?.name && brand.name !== "Default brand" && brand.name !== "New brand kit";

  return (
    <div ref={ref} style={{ width: f(850), background: "#ffffff", color: "#141414", fontFamily: bodyFont, padding: f(44), boxSizing: "border-box" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #141414", paddingBottom: f(14) }}>
        <div style={{ display: "flex", alignItems: "center", gap: f(14) }}>
          <div style={{ width: f(52), height: f(52), flexShrink: 0, borderRadius: f(8), border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", overflow: "hidden" }}>
            {brand?.logo_url ? (
              <img src={brand.logo_url} alt="" style={{ maxWidth: "82%", maxHeight: "82%", objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: f(8), color: "#c1c5cc" }}>LOGO</span>
            )}
          </div>
          <div>
            <div style={{ fontFamily: displayFont, fontWeight: 800, fontSize: f(24), lineHeight: 1.1 }}>{hasName ? brand.name : "[Your Brand Name]"}</div>
            <div style={{ fontSize: f(10), letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7280", marginTop: f(2) }}>Brand Guidelines — Quick Reference</div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: f(9.5), color: "#6b7280", lineHeight: 1.6 }}>
          <div>One page · {g.version || "v1.0"}</div>
          {brand?.handle && <div>{brand.handle}</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: f(32) }}>
        {/* Left column */}
        <div>
          <SectionLabel n="01" title="Logo Usage" f={f} />
          <div style={{ display: "flex", gap: f(12), alignItems: "flex-start" }}>
            <div style={{ width: f(60), height: f(60), flexShrink: 0, borderRadius: f(8), border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", overflow: "hidden" }}>
              {brand?.logo_url ? (
                <img src={brand.logo_url} alt="" style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} />
              ) : (
                <span style={{ fontSize: f(8), color: "#c1c5cc" }}>No logo</span>
              )}
            </div>
            <div style={{ fontSize: f(9.5), lineHeight: 1.6, color: "#4b5563" }}>
              <div><strong>Clear space:</strong> {g.logo_clear_space || "—"}</div>
              <div><strong>Min size:</strong> {g.logo_min_size || "—"}</div>
            </div>
          </div>
          {(g.logo_dos?.length > 0 || g.logo_donts?.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: f(10), marginTop: f(10), fontSize: f(9) }}>
              <div>
                <div style={{ fontWeight: 800, color: "#15803d" }}>Do</div>
                {(g.logo_dos || []).map((d, i) => <div key={i} style={{ color: "#4b5563" }}>• {d}</div>)}
              </div>
              <div>
                <div style={{ fontWeight: 800, color: "#b91c1c" }}>Don't</div>
                {(g.logo_donts || []).map((d, i) => <div key={i} style={{ color: "#4b5563" }}>• {d}</div>)}
              </div>
            </div>
          )}

          <SectionLabel n="02" title="Color Palette" f={f} />
          <div style={{ fontSize: f(8.5), color: "#9ca3af", marginBottom: f(6) }}>Dark theme</div>
          <div style={{ display: "flex", gap: f(8), flexWrap: "wrap" }}>
            <Swatch label="Background" hex={dark.bg} f={f} />
            <Swatch label="Text" hex={dark.fg} f={f} />
            <Swatch label="Accent" hex={dark.accent} f={f} />
            <Swatch label="Muted" hex={dark.sub} f={f} />
          </div>
          <div style={{ fontSize: f(8.5), color: "#9ca3af", margin: `${f(10)} 0 ${f(6)}` }}>Light theme</div>
          <div style={{ display: "flex", gap: f(8), flexWrap: "wrap" }}>
            <Swatch label="Background" hex={light.bg} f={f} />
            <Swatch label="Text" hex={light.fg} f={f} />
            <Swatch label="Accent" hex={light.accent} f={f} />
            <Swatch label="Muted" hex={light.sub} f={f} />
          </div>

          <SectionLabel n="04" title="Imagery & Icons" f={f} />
          <div style={{ fontSize: f(9.5), lineHeight: 1.6, color: "#4b5563" }}>
            <div><strong>Mood:</strong> {g.imagery_mood || "—"}</div>
            <div><strong>Color:</strong> {g.imagery_color || "—"}</div>
            <div><strong>Icons:</strong> {g.icon_style || "—"}</div>
          </div>
        </div>

        {/* Right column */}
        <div>
          <SectionLabel n="03" title="Typography" f={f} />
          <div style={{ fontFamily: displayFont, fontWeight: 800, fontSize: f(22), lineHeight: 1.2 }}>Aa</div>
          <div style={{ fontSize: f(8), color: "#9ca3af" }}>Header / H1 — {brand?.fonts?.display || "Inter"} Bold</div>
          <div style={{ fontFamily: displayFont, fontWeight: 700, fontSize: f(16), marginTop: f(8), lineHeight: 1.2 }}>Aa</div>
          <div style={{ fontSize: f(8), color: "#9ca3af" }}>Subhead / H2 — {brand?.fonts?.display || "Inter"} Bold</div>
          <div style={{ fontFamily: bodyFont, fontWeight: 600, fontSize: f(12.5), marginTop: f(8), lineHeight: 1.2 }}>Aa</div>
          <div style={{ fontSize: f(8), color: "#9ca3af" }}>Subhead / H3 — {brand?.fonts?.body || "Inter"} SemiBold</div>
          <div style={{ fontFamily: bodyFont, fontWeight: 400, fontSize: f(10), marginTop: f(8), lineHeight: 1.3 }}>Aa Bb Cc</div>
          <div style={{ fontSize: f(8), color: "#9ca3af" }}>Body text — {brand?.fonts?.body || "Inter"} Regular</div>
          <div style={{ fontFamily: bodyFont, fontWeight: 400, fontSize: f(8.5), marginTop: f(8), color: "#6b7280" }}>AA BB</div>
          <div style={{ fontSize: f(8), color: "#9ca3af" }}>Caption</div>

          <SectionLabel n="05" title="Voice & Messaging" f={f} />
          {(g.voice_attributes?.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: f(6), marginBottom: f(8) }}>
              {g.voice_attributes.map((a, i) => (
                <span key={i} style={{ fontSize: f(9), fontWeight: 700, padding: `${f(3)} ${f(8)}`, borderRadius: f(999), background: "#f3f4f6", color: "#141414" }}>{a}</span>
              ))}
            </div>
          )}
          {brand?.voice && <div style={{ fontSize: f(9.5), lineHeight: 1.6, color: "#4b5563", marginBottom: f(8) }}>{brand.voice}</div>}
          {(g.voice_do || g.voice_dont) && (
            <div style={{ fontSize: f(9), lineHeight: 1.6 }}>
              {g.voice_do && <div style={{ color: "#15803d" }}><strong>Do:</strong> "{g.voice_do}"</div>}
              {g.voice_dont && <div style={{ color: "#b91c1c", marginTop: f(3) }}><strong>Don't:</strong> "{g.voice_dont}"</div>}
            </div>
          )}
          <div style={{ fontSize: f(9), lineHeight: 1.7, color: "#4b5563", marginTop: f(8) }}>
            {brand?.audience && <div><strong>Audience:</strong> {brand.audience}</div>}
            {brand?.cta && <div><strong>Default CTA:</strong> {brand.cta}</div>}
            {brand?.hashtags?.length > 0 && <div><strong>Hashtags:</strong> {brand.hashtags.join(" ")}</div>}
            {brand?.banned_words?.length > 0 && <div><strong>Avoid:</strong> {brand.banned_words.join(", ")}</div>}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: f(20), paddingTop: f(10), borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", fontSize: f(8), color: "#9ca3af" }}>
        <span>
          {g.doc_owner ? `Document owner: ${g.doc_owner} · ` : ""}
          Last updated: {brand?.updated_at ? new Date(brand.updated_at).toLocaleDateString() : "—"}
        </span>
        <span>Confidential — Internal &amp; Partner Use</span>
      </div>
    </div>
  );
});
