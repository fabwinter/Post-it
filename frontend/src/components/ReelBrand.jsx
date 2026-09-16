import { useState } from "react";
import { TYPE_ROLES, WEIGHTS, sceneTypography, brandLogoUrls, sceneLogoLayout } from "@/lib/brandGuideline";
import { FontNotice } from "@/components/CustomFonts";

// A new key resets fallback selection when the selected kit/logo changes.
export function ReelBrandLogo({ brand, width }) {
  const urls = brandLogoUrls(brand);
  return urls.length ? <LogoImage key={JSON.stringify(urls)} urls={urls} brand={brand} width={width} /> : null;
}

function LogoImage({ urls, brand, width }) {
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState("loading");
  return <img data-reel-logo data-reel-logo-status={status} data-testid="reel-brand-logo"
    src={urls[index]} crossOrigin="anonymous" alt={`${brand?.name || "Brand"} logo`}
    style={sceneLogoLayout(brand, width)}
    onLoad={() => setStatus("ready")}
    onError={() => {
      if (index < urls.length - 1) { setStatus("loading"); setIndex(index + 1); }
      else setStatus("error");
    }} />;
}

// Controls describe the effective rule instead of offering local font fields
// whose values would immediately be overridden by the Brand Kit.
export function SceneTypographyControl({ brand, element, onChange, testid }) {
  const type = sceneTypography(brand, element);
  return <div className="mt-2 space-y-2 text-xs leading-relaxed text-zinc-300" data-testid={testid}>
    <label className="block">Brand typography role
      <select value={element.brandTypeRole || ""} data-testid={`${testid}-role`}
        className="mt-1 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-2 py-2 text-white"
        onChange={(e) => onChange({ brandTypeRole: e.target.value })}>
        <option value="">Automatic ({type.label})</option>
        {TYPE_ROLES.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
      </select>
    </label>
    <p>{type.font} · {WEIGHTS[type.weight]} · {type.size}px · Line height {type.line_height}</p>
    <p className="text-zinc-400">Uses Brand Kit guidelines at 850px reference width ({(type.size * 1080 / 850).toFixed(1)}px at 1080px wide). Edit the rule in Brand Kit to update every scene.</p>
    <FontNotice fontKey={type.font} testid={`${testid}-font-notice`} />
  </div>;
}
