import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";
import Dashboard from "@/pages/Dashboard";
import Studio from "@/pages/Studio";
import Repurpose from "@/pages/Repurpose";
import Composer from "@/pages/Composer";
import CalendarPage from "@/pages/CalendarPage";
import Library from "@/pages/Library";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/repurpose" element={<Repurpose />} />
            <Route path="/composer" element={<Composer />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/library" element={<Library />} />
          </Routes>
        </AppLayout>
        <Toaster position="top-right" theme="dark" />
      </BrowserRouter>
    </div>
  );
}

export default App;
