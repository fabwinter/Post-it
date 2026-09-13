import { Home, CalendarDays, Images, PenLine, Palette } from "lucide-react";

// Single source of truth for app navigation — both the desktop Sidebar and
// the mobile menu render from this, so a new page only needs adding here
// once instead of drifting between two hand-kept lists.
//
// Five screens, matching how the app is actually used: see where things
// stand (Home), make something (Create), schedule it (Plan), reuse an
// asset (Library), or tune the brand/publishing setup behind everything
// (Brand — Connections lives there as a tab now, since publishing setup
// is brand setup, not a destination of its own).
export const NAV = [
  { to: "/", label: "Home", icon: Home, testid: "nav-dashboard" },
  { to: "/composer", label: "Create", icon: PenLine, testid: "nav-composer" },
  { to: "/calendar", label: "Plan", icon: CalendarDays, testid: "nav-calendar" },
  { to: "/library", label: "Library", icon: Images, testid: "nav-library" },
  { to: "/brand", label: "Brand", icon: Palette, testid: "nav-brand" },
];
