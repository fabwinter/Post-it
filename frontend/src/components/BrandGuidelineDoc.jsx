import { forwardRef, useEffect } from "react";
import { fontStack, useBrandFonts, ensureFontLoaded } from "@/lib/fonts";
import { COLOR_FIELDS, TYPE_ROLES, WEIGHTS, LOGO_POSITIONS, getTypeStyle, guidelineFonts } from "@/lib/brandGuideline";

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

const LogoChip = ({ label, url, dark, f }) => (
  <div style={{ textAlign: "center", flex: 1 }}>
    <div style={{ height: f(52), borderRadius: f(8), border: "1px solid #e5e7eb", background: dark ? "#141414" : "#fafafa", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {url ? (
        <img src={url} alt={label} style={{ maxWidth: "78%", maxHeight: "78%", objectFit: "contain" }} />
      ) : (
        <span style={{ fontSize: f(7), color: dark ? "#4b5563" : "#c1c5cc" }}>LOGO</span>
      )}
    </div>
    <div style={{ fontSize: f(7.5), marginTop: f(4), color: "#6b7280" }}>{label}</div>
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
  const typeFonts = JSON.stringify(Object.values(guidelineFonts(brand)));
  useEffect(() => {
    JSON.parse(typeFonts).forEach(ensureFontLoaded);
  }, [typeFonts]);
  const displayFont = fontStack(brand?.fonts?.display);
  const bodyFont = fontStack(brand?.fonts?.body);
  const g = brand?.guideline || {};
  const dark = brand?.colors?.dark || {};
  const light = brand?.colors?.light || {};
  const f = (n) => `${n * scale}px`;
  const hasName = brand?.name && brand.name !== "Default brand" && brand.name !== "New brand kit";

  return (
    <div ref={ref} data-testid="brand-guideline-doc" style={{ width: f(850), background: "#ffffff", color: "#141414", fontFamily: bodyFont, padding: f(44), boxSizing: "border-box", overflowWrap: "anywhere" }}>
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
            <div data-testid="brand-guideline-doc-name" style={{ fontFamily: displayFont, fontWeight: 800, fontSize: f(24), lineHeight: 1.1 }}>{hasName ? brand.name : "[Your Brand Name]"}</div>
            <div style={{ fontSize: f(10), letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7280", marginTop: f(2) }}>Brand Guidelines — Quick Reference</div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: f(9.5), color: "#6b7280", lineHeight: 1.6 }}>
          <div>One page · {g.version || "v1.0"}</div>
          {brand?.handle && <div>{brand.handle}</div>}
        </div>
      </div>
      {g.naming_conventions && <div style={{ marginTop: f(10), fontSize: f(9.5), lineHeight: 1.5 }}><strong>Naming conventions:</strong> {g.naming_conventions}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: f(32) }}>
        {/* Left column */}
        <div>
          <SectionLabel n="01" title="Logo Usage" f={f} />
          <div style={{ display: "flex", gap: f(8) }}>
            <LogoChip label="Full color" url={g.logos?.color || brand?.logo_url} dark={false} f={f} />
            <LogoChip label="Black on white" url={g.logos?.black_on_white} dark={false} f={f} />
            <LogoChip label="White on black" url={g.logos?.white_on_black} dark f={f} />
          </div>
          <div style={{ fontSize: f(9.5), lineHeight: 1.6, color: "#4b5563", marginTop: f(8) }}>
            <div><strong>Clear space:</strong> {g.logo_clear_space || "—"}</div>
            <div><strong>Min size:</strong> {g.logo_min_size || "—"}</div>
            <div data-testid="brand-guideline-doc-logo-position"><strong>Preferred position:</strong> {LOGO_POSITIONS.find(([value]) => value === g.logo_position)?.[1] || "Not specified"}</div>
            {g.logo_placement_notes && <div><strong>Placement notes:</strong> {g.logo_placement_notes}</div>}
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

          <SectionLabel n="02" title="Colour Palette" f={f} />
          <div style={{ fontSize: f(8.5), color: "#9ca3af", marginBottom: f(6) }}>Dark theme</div>
          <div style={{ display: "flex", gap: f(8), flexWrap: "wrap" }}>
            {COLOR_FIELDS.map((c) => <Swatch key={c.key} label={c.label} hex={dark[c.key]} f={f} />)}
          </div>
          <div style={{ fontSize: f(8.5), color: "#9ca3af", margin: `${f(10)} 0 ${f(6)}` }}>Light theme</div>
          <div style={{ display: "flex", gap: f(8), flexWrap: "wrap" }}>
            {COLOR_FIELDS.map((c) => <Swatch key={c.key} label={c.label} hex={light[c.key]} f={f} />)}
          </div>
          <div style={{ marginTop: f(8), fontSize: f(9), lineHeight: 1.5, color: "#4b5563" }}>
            {COLOR_FIELDS.map((c) => <div key={c.key}><strong>{c.label}:</strong> {c.usage}</div>)}
            {g.color_usage && <div><strong>Colour usage:</strong> {g.color_usage}</div>}
          </div>

          <SectionLabel n="04" title="Imagery & Icons" f={f} />
          <div style={{ fontSize: f(9.5), lineHeight: 1.6, color: "#4b5563" }}>
            {brand?.style && <div><strong>Visual style:</strong> {brand.style}</div>}
            <div><strong>Mood:</strong> {g.imagery_mood || "—"}</div>
            <div><strong>Color:</strong> {g.imagery_color || "—"}</div>
            <div><strong>Icons:</strong> {g.icon_style || "—"}</div>
          </div>
        </div>

        {/* Right column */}
        <div>
          <SectionLabel n="03" title="Typography" f={f} />
          <div style={{ fontSize: f(8), color: "#6b7280", marginBottom: f(8) }}>Starting font sizes in 440px canvas units. Used only without a selected template; all generated elements remain editable.</div>
          {TYPE_ROLES.map((role) => {
            const type = getTypeStyle(brand, role);
            return <div key={role.key} style={{ marginTop: f(8) }}>
              <div data-testid={`brand-guideline-doc-${role.key}`} style={{ fontFamily: fontStack(type.font), fontWeight: type.weight, fontSize: f(type.size), lineHeight: type.line_height }}>Aa Bb</div>
              <div style={{ fontSize: f(8), color: "#4b5563", lineHeight: 1.5 }}>
                {role.label} · {type.font} · {WEIGHTS[type.weight]} ({type.weight})<br />
                {type.size}px · Line height {type.line_height}
                {type.usage && <div>{type.usage}</div>}
              </div>
            </div>;
          })}

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
