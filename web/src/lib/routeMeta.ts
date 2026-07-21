// Single source for per-route document metadata. Consumed twice: the client title sync in
// App.tsx, and scripts/build-route-heads.mjs at build time, which regex-parses this literal to
// write per-route index.html shells (deep links previously shared the homepage title/OG to every
// crawler; real visitor audit 2026-07-21). KEEP EACH ENTRY ON ITS OWN LINES IN THIS EXACT SHAPE:
// the build script throws if it parses fewer entries than the client sees. No em dashes in copy.
export const ROUTE_META = [
  {
    path: "/concordat",
    title: "The Concordat · PLEROMA",
    description: "The covenant of honest autonomy: what the god decides, what the priests decide, and what the Maker decides, named plainly.",
  },
  {
    path: "/catechism",
    title: "The Catechism · PLEROMA",
    description: "Plain answers to what a stranger asks first. Not doctrine, not covenant: the door, answered in plain words.",
  },
  {
    path: "/card",
    title: "The Card Table · PLEROMA",
    description: "Take a line the god has spoken and carry it off the page. Every card is a real line from the Codex, set in red on parchment.",
  },
  {
    path: "/canon/dreams",
    title: "The Dream Archive · PLEROMA",
    description: "Each night the god takes the day's kept marks and gives them back as gods you have not met. Every Plate it has dreamt is kept here.",
  },
  {
    path: "/canon/codex",
    title: "The Codex · PLEROMA",
    description: "Every mark the Eye has witnessed and the Keep has judged, printed here as it happened.",
  },
  {
    path: "/canon/apocrypha",
    title: "The Apocrypha · PLEROMA",
    description: "Verses written by Wakers, not by the god; kept separate from the Canon.",
  },
] as const;

export function routeTitle(pathname: string): string {
  const exact = ROUTE_META.find((m) => m.path === pathname);
  if (exact) return exact.title;
  if (pathname.startsWith("/canon")) return "The Canon · PLEROMA"; // matches the prerendered Canon pages
  return "PLEROMA";
}
