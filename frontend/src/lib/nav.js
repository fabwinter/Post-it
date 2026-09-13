import { LayoutGrid, Sparkles, Repeat, CalendarDays, Images, PenLine, Shapes, Flame, Plug, Palette, LayoutTemplate } from "lucide-react";

// Single source of truth for app navigation — both the desktop Sidebar and
// the mobile menu render from this, so a new page only needs adding here
// once instead of drifting between two hand-kept lists.
export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, testid: "nav-dashboard" },
  { to: "/studio", label: "Content Studio", icon: Sparkles, testid: "nav-studio" },
  { to: "/visuals", label: "Visual Studio", icon: Shapes, testid: "nav-visuals" },
  { to: "/repurpose", label: "Repurpose", icon: Repeat, testid: "nav-repurpose" },
  { to: "/templates", label: "Batch", icon: Flame, testid: "nav-templates" },
  { to: "/composer", label: "Composer", icon: PenLine, testid: "nav-composer" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, testid: "nav-calendar" },
  { to: "/library", label: "Library", icon: Images, testid: "nav-library" },
  { to: "/designs", label: "Designs", icon: LayoutTemplate, testid: "nav-designs" },
  { to: "/brand", label: "Brand Kit", icon: Palette, testid: "nav-brand" },
  { to: "/connections", label: "Connections", icon: Plug, testid: "nav-connections" },
];
