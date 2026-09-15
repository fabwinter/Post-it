import { Home, FolderOpen, CalendarDays, Images, PenLine, Palette } from "lucide-react";

// Single source of truth for app navigation — both the desktop Sidebar and
// the mobile menu render from this, so a new page only needs adding here
// once instead of drifting between two hand-kept lists.
//
// Six screens: see where things stand (Home), make something (Create),
// find anything you've already built (Projects — every draft, scheduled
// and published post, browsable and reopenable, not just the handful Home
// previews), schedule it (Plan), reuse an asset (Library), or tune the
// brand/publishing setup behind everything (Brand — Connections lives
// there as a tab now, since publishing setup is brand setup, not a
// destination of its own). Was five; Projects earned its own screen once
// "find and reopen something you already built" stopped being a thing Home
// could do in passing.
export const NAV = [
  { to: "/", label: "Home", icon: Home, testid: "nav-dashboard" },
  { to: "/composer", label: "Create", icon: PenLine, testid: "nav-composer" },
  { to: "/projects", label: "Projects", icon: FolderOpen, testid: "nav-projects" },
  { to: "/calendar", label: "Plan", icon: CalendarDays, testid: "nav-calendar" },
  { to: "/library", label: "Library", icon: Images, testid: "nav-library" },
  { to: "/brand", label: "Brand", icon: Palette, testid: "nav-brand" },
];
