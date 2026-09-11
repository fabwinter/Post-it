import "@/App.css";
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import { LockScreen } from "@/components/LockScreen";
import { api } from "@/lib/api";
import Dashboard from "@/pages/Dashboard";
import Studio from "@/pages/Studio";
import Visuals from "@/pages/Visuals";
import Repurpose from "@/pages/Repurpose";
import Templates from "@/pages/Templates";
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

function App() {
  return (
    <div className="App">
      <AuthGate>
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/visuals" element={<Visuals />} />
              <Route path="/repurpose" element={<Repurpose />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/composer" element={<Composer />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/library" element={<Library />} />
              <Route path="/brand" element={<BrandKit />} />
              <Route path="/connections" element={<Connections />} />
            </Routes>
          </AppLayout>
          <Toaster position="top-right" theme="dark" />
        </BrowserRouter>
      </AuthGate>
    </div>
  );
}

export default App;
