// Writes per-route index.html shells so deep links carry their own title/description/OG/canonical
// to crawlers (X, Discord, Telegram previews) instead of the homepage's. Each shell is the REAL
// built dist/index.html with only its head metadata swapped, so the SPA hydrates identically from
// the same hashed assets. Runs after vite build; fails loudly if the head template or the
// routeMeta literal drifts, so a silent regression cannot ship.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

// Parse the single-source literal in src/lib/routeMeta.ts (kept in a fixed shape by its comment).
const metaSource = readFileSync(resolve(webRoot, "src/lib/routeMeta.ts"), "utf8");
const entryRe = /path:\s*"([^"]+)",\s*\n\s*title:\s*"([^"]+)",\s*\n\s*description:\s*"([^"]+)",/g;
const routes = [...metaSource.matchAll(entryRe)].map(([, path, title, description]) => ({ path, title, description }));
if (routes.length < 6) {
  throw new Error(`route-meta parse drift: expected >= 6 entries, parsed ${routes.length} from src/lib/routeMeta.ts`);
}

const shellPath = resolve(webRoot, "dist/index.html");
const shell = readFileSync(shellPath, "utf8");

// Every swap targets one tag and must match exactly once; a miss means the head template moved.
const swaps = (title, description, canonical) => [
  [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
  [/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`],
  [/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`],
  [/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`],
  [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`],
  [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`],
  [/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`],
];

for (const { path, title, description } of routes) {
  let html = shell;
  for (const [pattern, replacement] of swaps(title, description, `https://pleromachurch.xyz${path}`)) {
    if (!pattern.test(html)) throw new Error(`head template drift: ${pattern} not found for ${path}`);
    html = html.replace(pattern, replacement);
  }
  if (!html.includes(`<title>${title}</title>`) || html.includes("<title>PLEROMA</title>")) {
    throw new Error(`head swap failed for ${path}`);
  }
  // Flat <route>.html, not <route>/index.html: Pages serves the flat file for the extensionless
  // URL directly, while a directory index costs every shared link a 308 to the trailing slash.
  const outFile = resolve(webRoot, `dist${path}.html`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
}
console.log(`route heads written: ${routes.map((r) => r.path).join(" ")}`);

// The sitemap is generated, never hand-maintained: the static file drifted as DOCTRINE grew
// (it omitted six live pages by 2026-07-21). Sources: the homepage, the prerendered Canon tree
// (walked from what build-canon just wrote), and the same routeMeta the heads above use.
const canonRoot = resolve(webRoot, "dist/canon");
function canonUrls(dir) {
  const urls = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) urls.push(...canonUrls(path));
    if (entry.isFile() && entry.name === "index.html") {
      const rel = relative(resolve(webRoot, "dist"), dir).replace(/\\/g, "/");
      urls.push(`/${rel}`);
    }
  }
  return urls;
}
const urls = [...new Set(["/", ...canonUrls(canonRoot), ...routes.map((r) => r.path)])].sort();
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  urls.map((u) => `  <url><loc>https://pleromachurch.xyz${u === "/" ? "/" : u}</loc></url>`).join("\n")
}\n</urlset>\n`;
if (urls.length < 15) throw new Error(`sitemap suspiciously small: ${urls.length} urls`);
writeFileSync(resolve(webRoot, "dist/sitemap.xml"), sitemap);
console.log(`sitemap written: ${urls.length} urls`);
