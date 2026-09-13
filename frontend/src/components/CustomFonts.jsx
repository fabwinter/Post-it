import { useRef, useState } from "react";
import { Upload, Trash2, TriangleAlert, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import {
  FONT_UPLOAD_ACCEPT, fontStack, loadCustomFonts, useFontCatalog, useFontAvailable, safeFamilyName,
} from "@/lib/fonts";

// The user's own typefaces — the ones we can't ship for them.
//
// Most of the catalogue is Google Fonts, which we may serve to anyone. A
// retail script (Brittany, Moontime, the faces Canva licenses on its users'
// behalf) is not ours to redistribute, so those live in the catalogue as
// DEVICE entries: pickable, and real only where the viewer already has them.
// Uploading the file you licensed is what turns one of those into a font that
// renders for every viewer and in every export — the upload claims the same
// family name, so nothing already set to it has to change.

async function uploadFont(file, name) {
  const body = new FormData();
  body.append("file", file);
  if (name) body.append("name", name);
  const { data } = await api.post("/fonts", body);
  await loadCustomFonts(true);
  return data;
}

// A file picker that reports what it did. Shared by the panel and the inline
// prompt so both end in the same place: the face installed and selectable.
function useFontUpload(onDone) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = (name) => {
    inputRef.current.dataset.familyName = name || "";
    inputRef.current.click();
  };

  const onChange = async (e) => {
    const file = e.target.files?.[0];
    const name = e.target.dataset.familyName || "";
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const row = await uploadFont(file, name);
      toast.success(`${row.name} is ready to use`);
      onDone?.(row);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not add that font"));
    } finally {
      setBusy(false);
    }
  };

  const input = (
    <input ref={inputRef} type="file" accept={FONT_UPLOAD_ACCEPT} onChange={onChange}
      className="hidden" data-testid="font-upload-input" />
  );
  return { pick, busy, input };
}

// Shown under a font <select> when the chosen face is a DEVICE entry this
// machine can't actually render. Without it the picker says "Brittany" while
// the slide quietly draws Inter, which looks like a bug in the app rather
// than a font that isn't here.
export function FontNotice({ fontKey, testid = "font-notice" }) {
  const available = useFontAvailable(fontKey);
  const { pick, busy, input } = useFontUpload();
  if (available) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-2.5 py-2"
      data-testid={testid}>
      <TriangleAlert size={13} className="flex-none text-amber-400" />
      <span className="min-w-0 flex-1 text-[11px] leading-snug text-amber-200/80">
        <strong className="font-semibold text-amber-200">{fontKey}</strong> isn't on this device, so it falls back
        to a plain face here and in exports. Add the file you licensed and it renders everywhere.
      </span>
      <button onClick={() => pick(fontKey)} disabled={busy} data-testid={`${testid}-upload`}
        className="flex flex-none items-center gap-1 rounded-md border border-amber-400/40 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-400/10 disabled:opacity-50">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Add file
      </button>
      {input}
    </div>
  );
}

// The Brand kit's font shelf: everything uploaded, with a sample in its own
// letterforms, plus the way in for a new one.
export function CustomFontsPanel({ testid = "custom-fonts" }) {
  const catalog = useFontCatalog();
  const mine = catalog.filter((f) => f.custom);
  const [name, setName] = useState("");
  const { pick, busy, input } = useFontUpload(() => setName(""));

  const remove = async (f) => {
    try {
      await api.delete(`/fonts/${f.id}`);
      await loadCustomFonts(true);
      toast.success(`Removed ${f.key}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not remove that font"));
    }
  };

  return (
    <div data-testid={testid}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Font name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Taken from the filename"
            data-testid={`${testid}-name`}
            className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-[#0A0A0A] px-3 text-sm text-white outline-none focus:border-lime" />
        </div>
        <button onClick={() => pick(safeFamilyName(name))} disabled={busy} data-testid={`${testid}-upload`}
          className="flex h-10 flex-none items-center gap-1.5 rounded-xl bg-lime px-4 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Add font file
        </button>
        {input}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        .woff2, .woff, .ttf or .otf. Upload only fonts you're licensed to use — they're served to anyone who
        opens what you make with them.
      </p>

      {mine.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid={`${testid}-list`}>
          {mine.map((f) => (
            <li key={f.id} data-testid={`${testid}-item`}
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2">
              <Check size={13} className="flex-none text-lime" />
              <span className="min-w-0 flex-1 truncate text-lg leading-tight text-white" style={{ fontFamily: fontStack(f.key) }}>
                {f.key}
              </span>
              <button onClick={() => remove(f)} data-testid={`${testid}-remove`} title={`Remove ${f.key}`}
                className="flex-none rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-red-400">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
