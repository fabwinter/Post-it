import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { NAV } from "@/lib/nav";

export const Sidebar = () => {
  const location = useLocation();
  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-64 flex-col border-r border-white/10 bg-[#0A0A0A] lg:flex" data-testid="app-sidebar">
      <div className="flex items-center gap-3 px-6 py-7">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-lime text-[#0A0A0A]">
          <Sparkles size={18} strokeWidth={2.5} />
        </div>
        <div>
          <div className="font-display text-lg font-bold leading-none tracking-tight">CreateOS</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Everywhere engine</div>
        </div>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.testid}
              className="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150"
            >
              {active && (
                <motion.div
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg border border-white/10 bg-white/[0.06]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon size={18} className={`relative z-10 transition-colors ${active ? "text-lime" : "text-zinc-500 group-hover:text-zinc-300"}`} />
              <span className={`relative z-10 transition-colors ${active ? "text-white" : "text-zinc-400 group-hover:text-white"}`}>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="m-3 rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Powered by</div>
        <div className="mt-1 font-display text-sm font-semibold text-white">PoYo.ai models</div>
        <div className="mt-2 text-xs leading-relaxed text-zinc-500">Chat, image, video & music from one engine.</div>
      </div>
    </aside>
  );
};
