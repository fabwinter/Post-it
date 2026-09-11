import { useRef, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { useKnowledge, KNOWLEDGE_KINDS, kindLabel } from "@/lib/useKnowledge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  BookOpen, Loader2, Plus, Pin, PinOff, Trash2, Upload, Link as LinkIcon,
  FileText, Presentation, Search, X, Eye, EyeOff,
} from "lucide-react";

const SOURCES = [
  { key: "paste", label: "Write / paste", icon: Plus },
  { key: "pdf", label: "PDF", icon: FileText, accept: ".pdf,application/pdf" },
  { key: "pptx", label: "Deck", icon: Presentation, accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { key: "url", label: "Web page", icon: LinkIcon },
];

// Everything a brand knows, paired to one kit. The kit says how it sounds;
// this says what it believes, has done, and must never claim.
export function KnowledgeBase({ brandKitId, brandName }) {
  const { docs, loading, reload } = useKnowledge(brandKitId);
  const [source, setSource] = useState("paste");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("values");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [probe, setProbe] = useState("");
  const [probeResult, setProbeResult] = useState(null);
  const [probing, setProbing] = useState(false);
  const fileRef = useRef(null);

  const resetForm = () => { setTitle(""); setContent(""); setUrl(""); setPinned(false); };

  const add = async (file) => {
    setSaving(true);
    try {
      let body = { brand_kit_id: brandKitId || undefined, title: title || undefined, kind, pinned };
      if (source === "paste") {
        if (!content.trim()) { toast.error("Write or paste something first."); setSaving(false); return; }
        body = { ...body, source_type: "paste", content };
      } else if (source === "url") {
        if (!url.trim()) { toast.error("Paste a URL first."); setSaving(false); return; }
        body = { ...body, source_type: "url", source_url: url.trim() };
      } else {
        if (!file) { setSaving(false); return; }
        const form = new FormData();
        form.append("file", file);
        const { data: up } = await api.post("/upload", form);
        body = { ...body, source_type: source, source_url: up.url };
      }
      await api.post("/knowledge", body);
      resetForm();
      await reload();
      toast.success("Added to the knowledge base");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't add that.")); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const patch = async (doc, changes) => {
    setBusyId(doc.id);
    try {
      await api.put(`/knowledge/${doc.id}`, changes);
      await reload();
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't update that.")); }
    finally { setBusyId(null); }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"? This can't be undone.`)) return;
    setBusyId(doc.id);
    try {
      await api.delete(`/knowledge/${doc.id}`);
      await reload();
      toast.success("Deleted");
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't delete that.")); }
    finally { setBusyId(null); }
  };

  // Shows exactly what a generation on this topic would be handed — the
  // retrieval is inspectable rather than a black box.
  const runProbe = async () => {
    if (!probe.trim()) { toast.error("Type a topic to test."); return; }
    setProbing(true); setProbeResult(null);
    try {
      const { data } = await api.post("/knowledge/search", { brand_kit_id: brandKitId || undefined, query: probe });
      setProbeResult(data);
    } catch (e) { toast.error(apiErrorMessage(e, "Couldn't run that.")); }
    finally { setProbing(false); }
  };

  const activeSource = SOURCES.find((s) => s.key === source);

  return (
    <section className="rounded-xl border border-white/10 bg-[#121212] p-5" data-testid="knowledge-base">
      <h3 className="flex items-center gap-2 font-display text-base font-semibold">
        <BookOpen size={15} className="text-lime" /> Knowledge base
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
        The kit above says how {brandName || "the brand"} sounds. This is what it <em>knows</em> — values,
        philosophy, previous work, inspiration, house rules. Pinned entries go into every generation;
        everything else is pulled in when it's relevant to what you're writing about.
      </p>

      {/* Add */}
      <div className="mt-4 rounded-lg border border-white/10 bg-[#0A0A0A] p-3">
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            return (
              <button key={s.key} onClick={() => setSource(s.key)} data-testid={`knowledge-source-${s.key}`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${source === s.key ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                <Icon size={11} /> {s.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="knowledge-title"
            placeholder={source === "paste" ? "Title (e.g. Pricing philosophy)" : "Title (optional — taken from the file)"}
            className="rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-lime" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="knowledge-kind"
            className="rounded-lg border border-white/10 bg-[#121212] px-2.5 py-2 text-xs text-white outline-none focus:border-lime [color-scheme:dark]">
            {KNOWLEDGE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>

        {source === "paste" && (
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} data-testid="knowledge-content"
            placeholder="Paste the real thing — a values doc, a case study write-up, notes on what you believe about your craft…"
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-lime" />
        )}
        {source === "url" && (
          <input value={url} onChange={(e) => setUrl(e.target.value)} data-testid="knowledge-url"
            placeholder="https://yoursite.com/about"
            className="mt-2 w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-lime" />
        )}
        {(source === "pdf" || source === "pptx") && (
          <input ref={fileRef} type="file" accept={activeSource?.accept} className="hidden"
            data-testid="knowledge-file-input" onChange={(e) => add(e.target.files?.[0])} />
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => setPinned(!pinned)} data-testid="knowledge-pin-toggle"
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${pinned ? "border-lime bg-lime/10 text-lime" : "border-white/10 text-zinc-500 hover:text-white"}`}>
            <Pin size={11} /> Always include
          </button>
          <Button onClick={() => (source === "pdf" || source === "pptx" ? fileRef.current?.click() : add())}
            disabled={saving} data-testid="knowledge-add"
            className="h-8 gap-1.5 rounded-lg bg-lime px-3 text-xs font-semibold text-[#0A0A0A] hover:bg-lime-hover">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {saving ? "Reading…" : source === "pdf" || source === "pptx" ? "Upload" : "Add"}
          </Button>
          <span className="text-[11px] text-zinc-600">
            {pinned ? "Goes into every post." : "Pulled in when relevant."}
          </span>
        </div>
      </div>

      {/* Library */}
      {loading ? (
        <div className="mt-4 flex justify-center py-6"><Loader2 size={16} className="animate-spin text-zinc-600" /></div>
      ) : docs.length === 0 ? (
        <p className="mt-4 text-xs text-zinc-600">Nothing here yet. Start with what you believe and what you've made.</p>
      ) : (
        <div className="mt-4 space-y-2" data-testid="knowledge-list">
          {docs.map((d) => (
            <div key={d.id} data-testid={`knowledge-item-${d.id}`}
              className={`rounded-lg border p-3 ${d.enabled ? "border-white/10 bg-[#0A0A0A]" : "border-white/5 bg-[#0A0A0A]/50"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`truncate text-sm font-medium ${d.enabled ? "text-white" : "text-zinc-500"}`}>{d.title}</span>
                    {d.pinned && (
                      <span className="flex flex-none items-center gap-0.5 rounded-full border border-lime/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-lime">
                        <Pin size={8} /> Always
                      </span>
                    )}
                    {!d.brand_kit_id && (
                      <span className="flex-none rounded-full border border-white/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">All kits</span>
                    )}
                  </div>
                  {d.summary && <p className="mt-1 text-xs leading-relaxed text-zinc-400">{d.summary}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-600">
                    <span className="uppercase tracking-wider">{kindLabel(d.kind)}</span>
                    <span>· {d.chars.toLocaleString()} chars · {d.source_kind}</span>
                  </div>
                  {d.tags?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.tags.slice(0, 6).map((t) => (
                        <span key={t} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-none items-center gap-1">
                  {busyId === d.id ? <Loader2 size={13} className="animate-spin text-zinc-600" /> : (
                    <>
                      <button onClick={() => patch(d, { pinned: !d.pinned })} title={d.pinned ? "Stop always including" : "Always include"}
                        data-testid={`knowledge-pin-${d.id}`} className="text-zinc-600 hover:text-lime">
                        {d.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                      </button>
                      <button onClick={() => patch(d, { enabled: !d.enabled })} title={d.enabled ? "Mute" : "Unmute"}
                        data-testid={`knowledge-toggle-${d.id}`} className="text-zinc-600 hover:text-white">
                        {d.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button onClick={() => remove(d)} title="Delete" data-testid={`knowledge-delete-${d.id}`}
                        className="text-zinc-600 hover:text-magic"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Retrieval probe */}
      {docs.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3" data-testid="knowledge-probe">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-600">Test retrieval</span>
            <input value={probe} onChange={(e) => setProbe(e.target.value)} data-testid="knowledge-probe-input"
              onKeyDown={(e) => { if (e.key === "Enter") runProbe(); }}
              placeholder="a topic you might post about…"
              className="min-w-[160px] flex-1 rounded-lg border border-white/10 bg-[#0A0A0A] px-2.5 py-1.5 text-xs text-white outline-none focus:border-lime" />
            <Button variant="secondary" onClick={runProbe} disabled={probing} data-testid="knowledge-probe-run"
              className="h-7 gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white hover:bg-white/10">
              {probing ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Test
            </Button>
          </div>
          {probeResult && (
            <div className="mt-2 rounded-lg border border-white/10 bg-[#0A0A0A] p-3" data-testid="knowledge-probe-result">
              {probeResult.used.length === 0 ? (
                <p className="text-xs text-zinc-500">Nothing matched — a post on that topic would be written from the brand kit alone.</p>
              ) : (
                <>
                  <p className="text-[11px] text-zinc-500">Writing about that would be given {probeResult.used.length} entr{probeResult.used.length === 1 ? "y" : "ies"} ({probeResult.chars.toLocaleString()} chars):</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {probeResult.used.map((u) => (
                      <span key={u.id} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${u.pinned ? "border-lime/40 text-lime" : "border-white/15 text-zinc-300"}`}>
                        {u.pinned && <Pin size={9} />}{u.title}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <button onClick={() => setProbeResult(null)} className="mt-2 flex items-center gap-1 text-[10px] text-zinc-600 hover:text-white">
                <X size={10} /> close
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
