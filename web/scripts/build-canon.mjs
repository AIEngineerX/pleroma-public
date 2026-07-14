// Prerender /canon/** into static HTML from the single source (root DOCTRINE.md), so the Canon is
// crawlable and LLM-indexable without SSR. Must run AFTER `vite build` (package.json's `build`
// script order: tsc --noEmit && vite build && this script) -- Vite's default emptyOutDir wipes
// dist/ on every build, so writing dist/canon/** any earlier would just get deleted. The React
// <Canon/> route (src/canon/Canon.tsx) mirrors these pages for in-app navigation.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(here, "../../DOCTRINE.md"), "utf8");

// Inline a copy of canonParse.ts's regexes (same structure, same slugging) to avoid a TS import in
// this .mjs build step. Any change to the DOCTRINE.md structure must update both this and canonParse.ts.
// clean() strips ONLY the ⟨rubric⟩ marker (and surrounding quotes) and trims -- no markdown-strip or
// whitespace-collapse, so a scripture line that ever used "*"/"_" or meaningful multi-space
// deliberately renders verbatim instead of being silently rewritten (keep in sync with canonParse.ts).
const clean = (s) => s.replace(/⟨rubric⟩/g, "").trim().replace(/^"|"$/g, "");
const one = (/before all others:\s*\n+\s*⟨rubric⟩\s*\*\*"([^"]+)"\*\*/.exec(md) || [])[1] || "";
const articles = [...md.matchAll(/^\d+\.\s+\*\*THE ([A-Z]+) \/ ([A-Z]+)\*\*\s+[—-]\s+⟨rubric⟩\s*\*"([^"]+)"\*/gm)]
  .map((m) => ({
    slug: m[1].toLowerCase().trim(),
    organ: m[1],
    trueName: m[2].toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    line: clean(m[3]),
  }));

// §III Books/Prints/Lines: "**BOOK OF FIRST LIGHT · PRINT 1 · LINES 1–5**" then numbered "N. ..." lines.
// Each book gathers its prints; each print keeps its ordered lines so we can emit id="line-N" anchors
// for per-verse permalinks (/canon/<book>/<print>#line-N, DOCTRINE's Provenance contract). `rubric`
// is parallel to `lines`: only lines DOCTRINE marks ⟨rubric⟩ are the god's own words (the rest is
// "the page's own account", DOCTRINE §III) -- same distinction canonParse.ts keeps.
const books = [];
const printRe = /\*\*BOOK OF ([A-Z ]+?) · PRINT (\d+) · LINES [\d–\-]+\*\*\s*([\s\S]*?)(?=\n\*\*BOOK OF|\n##|\n---|$)/g;
for (const m of md.matchAll(printRe)) {
  const rawTitle = m[1].trim();
  const bookSlug = rawTitle.toLowerCase().replace(/\s+/g, "-");        // "FIRST LIGHT" -> "first-light"
  const n = Number(m[2]);
  const rawLines = [...m[3].matchAll(/^\s*\d+\.\s+(.*)$/gm)].map((l) => l[1]).filter((l) => clean(l).length > 0);
  const lines = rawLines.map(clean);
  const rubric = rawLines.map((l) => /⟨rubric⟩/.test(l));
  let book = books.find((b) => b.slug === bookSlug);
  if (!book) { book = { slug: bookSlug, title: `Book of ${rawTitle.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}`, prints: [] }; books.push(book); }
  book.prints.push({ n, slug: `print-${n}`, lines, rubric });
}

const distCanon = resolve(here, "../dist/canon");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Plain inline CSS approximating the Tailwind theme tokens (styles.css @theme): parchment ground,
// rubric red for the god's own lines, machine mono for interface chrome. No build step touches
// these files after this script runs, so the styling has to be self-contained. Same fonts/meta
// pattern as index.html (theme-color, og/twitter tags, canonical link).
const page = (title, bodyHtml, path) => `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} · PLEROMA</title>
<link rel="canonical" href="https://pleroma.church${path}" />
<meta name="theme-color" content="#f0ead6" />
<meta property="og:title" content="${title} · PLEROMA" /><meta property="og:description" content="${esc(one)}" />
<meta property="og:image" content="/og.png" /><meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title} · PLEROMA" /><meta name="twitter:description" content="${esc(one)}" />
<meta name="twitter:image" content="/og.png" />
<link href="https://fonts.googleapis.com/css2?family=Gentium+Book+Plus:ital@0;1&family=Courier+Prime&display=swap" rel="stylesheet" />
<style>body{background:#f0ead6;color:#3a352c;font-family:"Gentium Book Plus",serif;max-width:70ch;margin:2rem auto;padding:0 1.25rem;line-height:1.6}.r{color:#9a3b2e}.m{font-family:"Courier Prime",monospace;font-size:.8rem;color:#6b6357}a{color:inherit}</style>
</head><body>${bodyHtml}<p class="m">The character is CC0 and the archive is public: the Canon can outlive any single administrator. No one owns the god's words, including its makers.</p>
<p class="m"><a href="/">return to the temple</a></p></body></html>`;

mkdirSync(distCanon, { recursive: true });

// /canon (index): the one line, the five Articles, and a link into each Book/Print.
const indexBody = `<p class="r" style="font-size:1.5rem;font-style:italic">${esc(one)}</p>
<h2 class="m">THE FIVE ARTICLES</h2>
<ol>${articles.map((a) => `<li id="${a.slug}"><a class="m" href="/canon/${a.slug}">THE ${a.organ} / ${a.trueName.toUpperCase()}</a><p class="r" style="font-style:italic">${esc(a.line)}</p></li>`).join("")}</ol>
${books.map((b) => `<h2 class="m">${b.title.toUpperCase()}</h2><ul>${b.prints.map((p) => `<li><a class="m" href="/canon/${b.slug}/${p.slug}">Print ${p.n}</a></li>`).join("")}</ul>`).join("")}`;
writeFileSync(resolve(distCanon, "index.html"), page("The Canon", indexBody, "/canon"));

// /canon/<article>: one Article per page (permalink target /canon/eye).
for (const a of articles) {
  const label = `THE ${a.organ} / ${a.trueName.toUpperCase()}`;
  mkdirSync(resolve(distCanon, a.slug), { recursive: true });
  writeFileSync(resolve(distCanon, a.slug, "index.html"),
    page(label, `<p class="m"><a href="/canon">The Canon</a></p><h1 id="${a.slug}">${label}</h1><p class="r" style="font-size:1.4rem;font-style:italic">${esc(a.line)}</p>`, `/canon/${a.slug}`));
}

// /canon/<book>/<print>: one Print per page, each line an <li id="line-N"> so a single verse is
// linkable as /canon/first-light/print-1#line-5 (the DOCTRINE Provenance permalink contract).
// Only the lines DOCTRINE marks ⟨rubric⟩ get class="r" -- the rest is the page's own account, in ink.
let printCount = 0;
for (const b of books) {
  for (const p of b.prints) {
    mkdirSync(resolve(distCanon, b.slug, p.slug), { recursive: true });
    const body = `<p class="m"><a href="/canon">The Canon</a></p>
<h1>${b.title}</h1><h2 class="m">PRINT ${p.n}</h2>
<ol>${p.lines.map((line, i) => `<li id="line-${i + 1}"${p.rubric[i] ? ' class="r"' : ""}>${esc(line)}</li>`).join("")}</ol>`;
    writeFileSync(resolve(distCanon, b.slug, p.slug, "index.html"), page(`${b.title} · Print ${p.n}`, body, `/canon/${b.slug}/${p.slug}`));
    printCount++;
  }
}
console.log(`prerendered /canon: index + ${articles.length} articles + ${printCount} prints`);
