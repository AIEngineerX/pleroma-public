// Prerender the public Canon from a validated, sanitized view of root DOCTRINE.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  continuousLineId,
  continuousPrintId,
  parsePublicCanon,
  sanitizePublicDoctrine,
} from "./public-doctrine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const rootDoctrine = readFileSync(resolve(here, "../../DOCTRINE.md"), "utf8");
const publicDoctrine = sanitizePublicDoctrine(rootDoctrine);
const canon = parsePublicCanon(publicDoctrine);
const {
  oneLine: one,
  emergence,
  binding,
  articles,
  offering,
  rite,
  books,
  lexicon,
} = canon;

const expectedOrgans = ["EYE", "KEEP", "TONGUE", "PULSE", "DREAM"];
const expectedRite = ["Offertory", "Deliberation", "Accretion", "Sermon", "Dream"];
const validShape = Boolean(one)
  && expectedOrgans.every((organ, index) => articles[index]?.organ === organ)
  && expectedRite.every((name, index) => rite[index]?.name === name)
  && books.length > 0
  && books.every((book) => book.prints.length > 0 && book.prints.every((print) => print.lines.length > 0));
if (!validShape) {
  throw new Error("public Doctrine content shape is invalid");
}
for (const book of books) {
  const printSlugs = book.prints.map((print) => print.slug);
  if (new Set(printSlugs).size !== printSlugs.length) {
    throw new Error(`public Doctrine repeats a Print within ${book.title}`);
  }
}

const distCanon = resolve(here, "../dist/canon");
const esc = (text) => text
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// display:inline-block (not <br>) so each glyph+label wraps as one unit -- a <br> forces a hard
// break across the WHOLE inline flow regardless of which anchor contains it, stacking every glyph
// on its own line instead of wrapping only between them.
const glyphMark = (label, href) => `<a href="${href}" download style="display:inline-block;text-align:center;margin:0 1.25rem 1rem 0"><img src="${href}" alt="${esc(label)} glyph, download" width="40" height="40" style="display:block;margin:0 auto" /><span class="m">${esc(label)}</span></a>`;
const remixKitHtml = `<section><h2 class="m">THE MARKS</h2>
<p>Free to use, remix, or repost. No permission needed, no attribution required.</p>
<p>${articles.map((article) => glyphMark(article.organ, `/glyphs/${article.slug}.svg`)).join("")}${glyphMark("SIGIL", "/sigil.svg")}</p></section>`;

// Self-hosted (web/public/fonts/, copied from the same @fontsource packages main.tsx imports for
// the SPA), not a Google Fonts CDN link -- a visitor landing directly on this static shell (no JS,
// no SPA) previously depended on an external stylesheet for its one locked typeface pair; if that
// CDN was ever slow, blocked, or down, the fallback was a generic serif/monospace, silently
// breaking the typography rule for exactly the visitors this shell exists to serve well.
// Colors: the hex values are a same-tone fallback for browsers predating oklch(); the oklch()
// declaration right after each is the real token value and wins in every browser that supports it.
const page = (title, bodyHtml, path) => `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} · PLEROMA</title>
<link rel="canonical" href="https://pleromachurch.xyz${path}" />
<meta name="theme-color" content="#f0ead6" />
<meta property="og:title" content="${title} · PLEROMA" /><meta property="og:description" content="${esc(one)}" />
<meta property="og:image" content="/og.png" /><meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title} · PLEROMA" /><meta name="twitter:description" content="${esc(one)}" />
<meta name="twitter:image" content="/og.png" />
<style>
@font-face{font-family:"Gentium Book Plus";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/gentium-book-plus-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Gentium Book Plus";font-style:italic;font-weight:400;font-display:swap;src:url(/fonts/gentium-book-plus-latin-400-italic.woff2) format("woff2")}
@font-face{font-family:"Gentium Book Plus";font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/gentium-book-plus-latin-700-normal.woff2) format("woff2")}
@font-face{font-family:"Courier Prime";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/courier-prime-latin-400-normal.woff2) format("woff2")}
body{background:#f0ead6;background:oklch(0.94 0.015 85);color:#3a352c;color:oklch(0.25 0.02 60);font-family:"Gentium Book Plus",serif;max-width:70ch;margin:2rem auto;padding:0 1.25rem;line-height:1.6}
.r{color:#9a3b2e;color:oklch(0.45 0.16 32)}
.m{font-family:"Courier Prime",monospace;font-size:.8rem;color:#6b6357;color:oklch(0.48 0.02 60)}
section{margin-top:2rem}a{color:inherit}
</style>
</head><body>${bodyHtml}
${remixKitHtml}
<p class="m">The character is CC0 and the archive is public: the Canon can outlive any single administrator. No one owns the god's words, including its makers.</p>
<nav class="m" aria-label="Canon doorways"><a href="/">return to the temple</a> · <a href="/canon/dreams">the dreams</a> · <a href="/canon/codex">the codex</a> · <a href="/concordat">the Concordat</a></nav>
</body></html>`;

mkdirSync(distCanon, { recursive: true });

const offeringHtml = `${offering[0] ? `<p>${esc(offering[0])}</p>` : ""}
<ol>${offering.slice(1, -1).map((item) => `<li>${esc(item)}</li>`).join("")}</ol>
${offering.at(-1) ? `<p>${esc(offering.at(-1))}</p>` : ""}`;

const indexBody = `<h1 class="m">THE CANON</h1>
<p class="r" style="font-size:1.5rem;font-style:italic">${esc(one)}</p>
<section><h2 class="m">THE EMERGENCE</h2>${emergence.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</section>
<section><h2 class="m">THE BINDING</h2>${binding.map((paragraph, index) => `<p${index === binding.length - 1 ? ' class="r"' : ""}>${esc(paragraph)}</p>`).join("")}</section>
<section><h2 class="m">THE FIVE ARTICLES</h2><ol>${articles.map((article) => `<li id="${article.slug}"><a class="m" href="/canon/${article.slug}">THE ${article.organ} / ${article.trueName.toUpperCase()}</a><p class="r" style="font-style:italic">${esc(article.line)}</p></li>`).join("")}</ol></section>
<section><h2 class="m">THE OFFERING</h2>${offeringHtml}</section>
<section><h2 class="m">THE DAILY RITE</h2><ol>${rite.map((step) => `<li><strong>${step.name}</strong> ${esc(step.text)}</li>`).join("")}</ol></section>
<section><h2 class="m">THE PRINTS</h2>${books.map((book) => `<article><h3 class="m">${book.title.toUpperCase()}</h3>${book.prints.map((print) => `<div id="${continuousPrintId(book.slug, print.slug)}"><h4 class="m"><a href="/canon/${book.slug}/${print.slug}">PRINT ${print.n}</a></h4><ol>${print.lines.map((line, index) => `<li id="${continuousLineId(book.slug, print.slug, index + 1)}"${print.rubric[index] ? ' class="r"' : ""}>${esc(line)}</li>`).join("")}</ol></div>`).join("")}</article>`).join("")}</section>
<section><h2 class="m">THE LEXICON</h2><dl>${lexicon.map((term) => `<div><dt><strong>${esc(term.name)}</strong></dt><dd>${esc(term.text)}</dd></div>`).join("")}</dl></section>
<section><h2 class="m">THE DREAM ARCHIVE</h2><a class="m" href="/canon/dreams">the dreams</a></section>
<section><h2 class="m">THE CODEX</h2><a class="m" href="/canon/codex">the full diary</a></section>
<section><h2 class="m">THE APOCRYPHA</h2><a class="m" href="/canon/apocrypha">write or read the Apocrypha</a></section>`;

writeFileSync(resolve(distCanon, "index.html"), page("The Canon", indexBody, "/canon"));

for (const article of articles) {
  const label = `THE ${article.organ} / ${article.trueName.toUpperCase()}`;
  mkdirSync(resolve(distCanon, article.slug), { recursive: true });
  writeFileSync(
    resolve(distCanon, article.slug, "index.html"),
    page(label, `<p class="m"><a href="/canon">The Canon</a></p><h1 id="${article.slug}">${label}</h1><p class="r" style="font-size:1.4rem;font-style:italic">${esc(article.line)}</p>`, `/canon/${article.slug}`),
  );
}

let printCount = 0;
for (const book of books) {
  for (const print of book.prints) {
    mkdirSync(resolve(distCanon, book.slug, print.slug), { recursive: true });
    const body = `<p class="m"><a href="/canon">The Canon</a></p>
<h1>${book.title}</h1><h2 class="m">PRINT ${print.n}</h2>
<ol>${print.lines.map((line, index) => `<li id="line-${index + 1}"${print.rubric[index] ? ' class="r"' : ""}>${esc(line)}</li>`).join("")}</ol>`;
    writeFileSync(
      resolve(distCanon, book.slug, print.slug, "index.html"),
      page(`${book.title} · Print ${print.n}`, body, `/canon/${book.slug}/${print.slug}`),
    );
    printCount++;
  }
}

console.log(`prerendered /canon: index + ${articles.length} articles + ${printCount} prints`);
