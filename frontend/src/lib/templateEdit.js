// Turns a saved template (an abstracted outline plus a role-based layout —
// see backend/server.py's _apply_template_layouts/_fill_layout, which this
// mirrors) into a real, fully editable Composer deck: one asset per outline
// slide, each carrying literal freeform elements instead of role
// placeholders. Editing that deck and saving it back (PUT
// /templates/custom/:id) is how a saved template's colors, fonts, layout
// and slide count all become editable after the fact.
const genId = () => `el_${Math.random().toString(36).slice(2, 9)}`;

function fillRoleText(el, outline, index) {
  const role = el.role;
  if (role === "title") return outline.heading || outline.title || "";
  if (role === "heading") return outline.heading || outline.title || "";
  if (role === "body") return outline.body || "";
  if (role === "number") return String(index);
  if (role === "step") return `STEP ${index}`;
  return "";
}

function fillLayout(layout, outline, index) {
  return (layout || [])
    .map((src) => {
      const el = { ...src, id: genId() };
      if (el.type === "text" && el.text === undefined) el.text = fillRoleText(el, outline, index);
      return el;
    })
    .filter((el) => el.type !== "text" || (el.text || "").trim());
}

// A template with no real layout (e.g. an image-only conversion) has
// nothing freeform to edit — the caller falls back to letting the plain
// heading/body fields carry the outline instead.
export function materializeTemplateSlides(tpl) {
  const outline = tpl.slides && tpl.slides.length ? tpl.slides : [{ heading: tpl.name || "", body: "" }];
  const layouts = tpl.layouts || {};
  const bgColors = tpl.bg_colors || {};
  const clips = tpl.clips || {};
  // A reel has no "cover" slide (a scene never carries template: "cover" —
  // see _plan_to_assets), so a reel template's slides materialize as
  // `type: "scene"` throughout: that's what makes VideoClipEditor render for
  // them, exactly as it does for a freshly generated reel.
  const isReel = tpl.format === "reel";
  const hasCover = !isReel && !!layouts.cover;
  const last = outline.length - 1;

  return outline.map((s, i) => {
    const isCover = i === 0 && hasCover;
    const isOutro = !isCover && i === last && last > 0 && (layouts.outro || bgColors.outro || clips.outro);
    const key = isCover ? "cover" : (isOutro ? "outro" : "slide");
    const layout = layouts[key] || layouts.slide || layouts.cover;
    const elements = layout ? fillLayout(layout, s, hasCover ? i : i + 1) : undefined;
    const bg = bgColors[key] || bgColors.slide || bgColors.cover;
    // Independent of `elements`/layout for the same reason it's saved that
    // way: a scene can carry a clip with nothing else customized.
    const clip = clips[key] || clips.slide || clips.cover;
    return {
      type: isReel ? "scene" : "visual", caption: "",
      spec: {
        template: isCover ? "cover" : "slide", theme: tpl.theme || "midnight",
        index: hasCover ? i : i + 1, total: outline.length, coverCounts: hasCover,
        title: s.heading || s.title || "", heading: s.heading || "", body: s.body || "",
        ...(elements ? { elements } : {}),
        ...(bg ? { bg_color: bg } : {}),
        ...(clip ? { clip, video_url: clip.url || "" } : {}),
      },
    };
  });
}
