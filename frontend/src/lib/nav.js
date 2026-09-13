import { LayoutGrid, CalendarDays, Images, PenLine, Plug, Palette } from "lucide-react";

// Single source of truth for app navigation — both the desktop Sidebar and
// the mobile menu render from this, so a new page only needs adding here
// once instead of drifting between two hand-kept lists.
//
// Content Studio, Visual Studio, Repurpose, and Batch (formerly Viral
// Templates) each generated something and handed off to the Composer —
// they're modes inside it now (the switcher above its topic/build
// controls), not destinations of their own, so they're gone from here too.
export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, testid: "nav-dashboard" },
  { to: "/composer", label: "Composer", icon: PenLine, testid: "nav-composer" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, testid: "nav-calendar" },
  // Designs (saved layouts) and Elements (saved slide elements) live as
  // tabs inside Library now, not their own nav entries — Library owns
  // every reusable asset in one place.
  { to: "/library", label: "Library", icon: Images, testid: "nav-library" },
  { to: "/brand", label: "Brand Kit", icon: Palette, testid: "nav-brand" },
  { to: "/connections", label: "Connections", icon: Plug, testid: "nav-connections" },
];
