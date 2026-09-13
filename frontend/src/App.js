import "@/App.css";
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import { LockScreen } from "@/components/LockScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { api } from "@/lib/api";
import Dashboard from "@/pages/Dashboard";
import Studio from "@/pages/Studio";
import Visuals from "@/pages/Visuals";
import Repurpose from "@/pages/Repurpose";
import Templates from "@/pages/Templates";
import Designs from "@/pages/Designs";
import Composer from "@/pages/Composer";
import CalendarPage from "@/pages/CalendarPage";
import Library from "@/pages/Library";
import Connections from "@/pages/Connections";
import BrandKit from "@/pages/BrandKit";

// Gates the whole app behind the shared access code — but only if the
// backend actually asks for one. A lightweight authenticated call decides:
// 200 means either a stored code is valid or no code is required at all
// (the backend enforces nothing when APP_ACCESS_TOKEN isn't set, so this
// stays invisible until that's configured); 401 means show the lock screen.
// Any other failure (offline, 500) is not treated as "locked" — that would
// misdiagnose a connectivity problem as an access problem.
function AuthGate({ children }) {
  const [state, setState] = useState("checking");

  useEffect(() => {
    let cancelled = false;
    const check = () => api.get("/stats")
      .then(() => { if (!cancelled) setState("unlocked"); })
      .catch((e) => { if (!cancelled) setState(e?.response?.status === 401 ? "locked" : "unlocked"); });
    check();
    const onUnauthorized = () => setState("locked");
    window.addEventListener("postit:unauthorized", onUnauthorized);
    return () => { cancelled = true; window.removeEventListener("postit:unauthorized", onUnauthorized); };
  }, []);

  if (state === "checking") return <div className="min-h-screen bg-[#0A0A0A]" />;
  if (state === "locked") return <LockScreen onUnlock={() => setState("unlocked")} />;
  return children;
}

// A render crash on one page shouldn't need a hard reload to recover from —
// keying the boundary by path remounts it (clearing the error) the moment
// the user navigates anywhere else, so the sidebar/nav from AppLayout stays
// usable the whole time instead of vanishing under a white screen.
function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>;
}

// Test-only: ?__boom=1 forces a real render-phase crash so the boundary
// above it can be verified end-to-end instead of trusted on inspection —
// see probe22.js. Harmless outside that: it only ever crashes the tab that
// opts in via this exact query string, and it renders nothing otherwise.
function Boom() {
  if (new URLSearchParams(window.location.search).get("__boom") === "1") {
    throw new Error("Intentional test crash (?__boom=1)");
  }
  return null;
}

// Without a catch-all, an unknown path rendered nothing at all — on desktop
// that at least left the sidebar to navigate from, but on a phone (where the
// sidebar is hidden) it was a blank screen with no way out but the back
// button. A mistyped or stale link deserves an actual answer.
function NotFound() {
  const location = useLocation();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center" data-testid="not-found">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-500">404</div>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">This page doesn't exist</h1>
      <p className="mt-2 max-w-md text-sm text-zinc-500">
        Nothing lives at <span className="break-all font-mono text-zinc-400">{location.pathname}</span>.
        It may have been renamed, or the link that sent you here is out of date.
      </p>
      <Link to="/" data-testid="not-found-home"
        className="mt-6 rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition-colors hover:bg-lime-hover">
        Back to the dashboard
      </Link>
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <ErrorBoundary level="app">
        <AuthGate>
          <BrowserRouter>
            <AppLayout>
              <RouteErrorBoundary>
                <Boom />
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/studio" element={<Studio />} />
                  <Route path="/visuals" element={<Visuals />} />
                  <Route path="/repurpose" element={<Repurpose />} />
                  <Route path="/templates" element={<Templates />} />
                  <Route path="/designs" element={<Designs />} />
                  <Route path="/composer" element={<Composer />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="/brand" element={<BrandKit />} />
                  <Route path="/connections" element={<Connections />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </RouteErrorBoundary>
            </AppLayout>
            <Toaster position="top-right" theme="dark" />
          </BrowserRouter>
        </AuthGate>
      </ErrorBoundary>
    </div>
  );
}

export default App;
