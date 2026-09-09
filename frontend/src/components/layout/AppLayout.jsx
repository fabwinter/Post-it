import { Sidebar } from "./Sidebar";
import { NavLink } from "react-router-dom";
import { Sparkles } from "lucide-react";

export const AppLayout = ({ children }) => {
  return (
    <div className="min-h-screen bg-[#0A0A0A] grain-bg text-white">
      <Sidebar />
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-white/10 bg-[#0A0A0A]/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime text-[#0A0A0A]">
          <Sparkles size={16} strokeWidth={2.5} />
        </div>
        <span className="font-display text-base font-bold">CreateOS</span>
        <div className="ml-auto flex gap-1 font-mono text-[11px]">
          <NavLink to="/studio" className="rounded-md px-2 py-1 text-zinc-400">Studio</NavLink>
          <NavLink to="/calendar" className="rounded-md px-2 py-1 text-zinc-400">Calendar</NavLink>
        </div>
      </div>
      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12">{children}</div>
      </main>
    </div>
  );
};
