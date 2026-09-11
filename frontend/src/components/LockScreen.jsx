import { useState } from "react";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Lock, Loader2 } from "lucide-react";

// Shown whenever the backend demands an access code and this browser
// doesn't have a working one stored yet. Unlocking is just proving the code
// works — a real request to a real endpoint, not client-side validation
// against a value baked into the bundle (there isn't one; the backend never
// ships the token to the frontend).
export function LockScreen({ onUnlock }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    setToken(value.trim());
    try {
      await api.get("/stats");
      onUnlock();
    } catch (err) {
      setToken("");
      setError(err?.response?.status === 401 ? "That code doesn't match." : "Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-4" data-testid="lock-screen">
      <form onSubmit={submit} className="w-full max-w-xs rounded-2xl border border-white/10 bg-[#121212] p-6">
        <div className="flex items-center gap-2 text-lime">
          <Lock size={16} />
          <span className="font-mono text-[11px] uppercase tracking-[0.25em]">Locked</span>
        </div>
        <h1 className="mt-3 font-display text-xl font-semibold tracking-tight text-white">Access code</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
          This workspace needs the access code to continue.
        </p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="lock-screen-input"
          placeholder="Enter code"
          className="mt-4 w-full rounded-lg border border-white/10 bg-[#0A0A0A] px-3 py-2.5 text-sm text-white outline-none focus:border-lime"
        />
        {error && <p className="mt-2 text-xs text-magic" data-testid="lock-screen-error">{error}</p>}
        <Button
          type="submit"
          disabled={busy || !value.trim()}
          data-testid="lock-screen-submit"
          className="mt-4 w-full gap-1.5 rounded-lg bg-lime text-[#0A0A0A] hover:bg-lime-hover"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
