import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { NavLink, useLocation } from "react-router-dom";
import { Sparkles, Menu } from "lucide-react";
import { NAV } from "@/lib/nav";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export const AppLayout = ({ children }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#0A0A0A] grain-bg text-white">
      <Sidebar />
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-white/10 bg-[#0A0A0A]/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime text-[#0A0A0A]">
          <Sparkles size={16} strokeWidth={2.5} />
        </div>
        <span className="font-display text-base font-bold">CreateOS</span>
        <button onClick={() => setMenuOpen(true)} data-testid="mobile-menu-open"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:text-white">
          <Menu size={18} />
        </button>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 border-white/10 bg-[#0A0A0A] p-0 text-white">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex items-center gap-3 px-6 py-7">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime text-[#0A0A0A]">
              <Sparkles size={18} strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display text-lg font-bold leading-none tracking-tight">CreateOS</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Everywhere engine</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1 px-3">
            {NAV.map((item) => {
              const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)} data-testid={`mobile-${item.testid}`}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "border border-white/10 bg-white/[0.06] text-white" : "text-zinc-400"}`}>
                  <Icon size={18} className={active ? "text-lime" : "text-zinc-500"} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-12">{children}</div>
      </main>
    </div>
  );
};
