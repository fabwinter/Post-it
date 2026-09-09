import { platformOf } from "@/lib/platforms";
import { Heart, MessageCircle, Repeat2, Bookmark } from "lucide-react";

export const PostPreview = ({ platformKey, content, mediaUrl, mediaType }) => {
  const p = platformOf(platformKey);
  const Icon = p.icon;
  const over = p.limit && content ? content.length - p.limit : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#121212]" data-testid={`preview-${platformKey}`}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: p.color }} />
          <span className="text-sm font-semibold">{p.name}</span>
        </div>
        <span className={`font-mono text-[11px] ${over > 0 ? "text-magic" : "text-zinc-500"}`}>
          {content ? content.length : 0}{p.limit ? `/${p.limit}` : ""}
        </span>
      </div>

      <div className="p-4">
        <div className="flex gap-3">
          <div className="h-10 w-10 flex-shrink-0 rounded-full bg-gradient-to-br from-lime/70 to-iris/70" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-white">{p.handle}</span>
              <span className="text-xs text-zinc-500">· now</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-zinc-200">
              {content || <span className="text-zinc-600">Your post will appear here…</span>}
            </p>

            {mediaUrl && (
              <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
                {mediaType === "video" ? (
                  <video src={mediaUrl} controls className="w-full" />
                ) : mediaType === "music" || mediaType === "audio" ? (
                  <audio src={mediaUrl} controls className="w-full" />
                ) : (
                  <img src={mediaUrl} alt="attachment" className="w-full object-cover" />
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-6 text-zinc-600">
              <Heart size={15} />
              <MessageCircle size={15} />
              <Repeat2 size={15} />
              <Bookmark size={15} className="ml-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
