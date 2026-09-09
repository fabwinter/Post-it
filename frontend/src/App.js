import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";
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

function App() {
  return (
    <div className="App">
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
    </div>
  );
}

export default App;
