import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PLATFORM_LIST } from "@/lib/platforms";
import { Plug, ExternalLink } from "lucide-react";

export default function Connections() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/connections").then(({ data }) => setConnections(data)).finally(() => setLoading(false));
  }, []);

  const statusOf = (key) => (connections.find((c) => c.platform === key) || {}).status || "not_connected";

  return (
    <div data-testid="connections-page">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">Connections</div>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Where posts actually go</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
        Nothing is connected yet, so scheduled posts sit in the calendar until a platform is wired up here.
        Each one needs its own developer app registered on that platform before CreateOS can publish to it —
        that's a one-time setup only you can do, since it requires your own accounts and credentials.
      </p>

      {!loading && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_LIST.map((p) => {
            const status = statusOf(p.key);
            const connected = status === "connected";
            const I = p.icon;
            return (
              <div key={p.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#121212] p-4" data-testid={`connection-${p.key}`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#0A0A0A]">
                    <I size={18} style={{ color: p.color }} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{p.name}</div>
                    <div className={`mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${connected ? "text-lime" : "text-zinc-600"}`}>
                      {connected ? "Connected" : "Not connected"}
                    </div>
                  </div>
                </div>
                <button
                  disabled
                  title="Publishing needs a developer app registered on this platform first — ask in chat to set one up."
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-500 opacity-60"
                >
                  <Plug size={13} /> Connect
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-white/10 bg-[#121212] p-5">
        <ExternalLink size={18} className="mt-0.5 flex-shrink-0 text-zinc-500" />
        <div className="text-sm leading-relaxed text-zinc-400">
          <span className="font-semibold text-white">Want to connect one now?</span> Ask to set up publishing for a
          specific platform — X and LinkedIn are usually the fastest to register. You'll create a developer app on
          that platform's own site and paste back a client ID and secret, the same way the PoYo and Cloudflare keys
          were added.
        </div>
      </div>
    </div>
  );
}
