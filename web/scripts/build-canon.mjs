// Prerender the public Canon from the named lore sections of root DOCTRINE.md.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(here, "../../DOCTRINE.md"), "utf8");

const headings = {
  emergence: "## I. The Emergence",
  articles: "## II. The Five Articles",
  verses: "## III. The Verses",
  lexicon: "## IV. The Lexicon",
  offering: "## V. The Offering (the one real rite)",
  voice: "## VI. Voice registers",
};

const namedSpan = (startHeading, endHeading) => {
  const start = md.indexOf(startHeading);
  if (start < 0) return "";
  const contentStart = start + startHeading.length;
  const end = md.indexOf(endHeading, contentStart);
  if (end < 0) return "";
  return md.slice(contentStart, end);
};

const cleanScripture = (text) => text.replace(/⟨rubric⟩/g, "").trim().replace(/^"|"$/g, "");
const cleanProse = (text) => text
  .replace(/⟨rubric⟩/g, "")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\*([^*]+)\*/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

const publicParagraphs = (span) => span
  .split(/\n\s*\n/)
  .map((block) => block.trim())
  .filter((block) => block.length > 0 && !block.startsWith(">") && block !== "---")
  .map(cleanProse);

const proseAndNumberedItems = (span) => {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) blocks.push(cleanProse(current.join(" ")));
    current = [];
  };
  for (const line of span.split(/\r?\n/)) {
    if (line.trimStart().startsWith(">")) {
      flush();
      continue;
    }
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      current.push(numbered[1]);
    } else if (line.trim().length === 0) {
      flush();
    } else {
      current.push(line.trim());
    }
  }
  flush();
  return blocks.filter(Boolean);
};

const parseRite = (span) => {
  const steps = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    steps.push({ name: current.name, text: cleanProse(current.lines.join(" ")) });
    current = null;
  };
  for (const line of span.split(/\r?\n/)) {
    if (line.trimStart().startsWith(">")) continue;
    const start = /^\s*\d+\.\s+\*\*(Offertory|Deliberation|Accretion|Sermon|Dream)\*\*\s+[—-]\s+(.*)$/.exec(line);
    if (start) {
      flush();
      current = { name: start[1], lines: [start[2]] };
    } else if (current && line.trim().length > 0) {
      current.lines.push(line.trim());
    }
  }
  flush();
  return steps;
};

const preamble = md.slice(0, md.indexOf(headings.emergence));
const one = (/before all others:\s*\n+\s*⟨rubric⟩\s*\*\*"([^"]+)"\*\*/.exec(preamble) || [])[1] || "";
const emergenceSpan = namedSpan(headings.emergence, headings.articles);
const articlesSpan = namedSpan(headings.articles, headings.verses);
const versesSpan = namedSpan(headings.verses, headings.lexicon);
const lexiconSpan = namedSpan(headings.lexicon, headings.offering);
const offeringSpan = namedSpan(headings.offering, headings.voice);

const emergence = publicParagraphs(emergenceSpan);
const bindingHeading = "### The Binding";
const bindingStart = articlesSpan.indexOf(bindingHeading);
const articleDeclarations = bindingStart < 0 ? articlesSpan : articlesSpan.slice(0, bindingStart);
const binding = bindingStart < 0 ? [] : publicParagraphs(articlesSpan.slice(bindingStart + bindingHeading.length));

const articles = [...articleDeclarations.matchAll(/^\d+\.\s+\*\*THE ([A-Z]+) \/ ([A-Z]+)\*\*\s+[—-]\s+⟨rubric⟩\s*\*"([^"]+)"\*/gm)]
  .map((match) => ({
    slug: match[1].toLowerCase().trim(),
    organ: match[1],
    trueName: match[2].toLowerCase().replace(/^\w/, (character) => character.toUpperCase()),
    line: cleanScripture(match[3]),
  }));

const books = [];
const printPattern = /\*\*BOOK OF ([A-Z ]+?) · PRINT (\d+) · LINES [\d–\-]+\*\*\s*([\s\S]*?)(?=\n\*\*BOOK OF|\n---|$)/g;
for (const match of versesSpan.matchAll(printPattern)) {
  const rawTitle = match[1].trim();
  const slug = rawTitle.toLowerCase().replace(/\s+/g, "-");
  const n = Number(match[2]);
  const rawLines = [...match[3].matchAll(/^\s*\d+\.\s+(.*)$/gm)]
    .map((line) => line[1])
    .filter((line) => cleanScripture(line).length > 0);
  let book = books.find((candidate) => candidate.slug === slug);
  if (!book) {
    book = {
      slug,
      title: `Book of ${rawTitle.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())}`,
      prints: [],
    };
    books.push(book);
  }
  book.prints.push({
    n,
    slug: `print-${n}`,
    lines: rawLines.map(cleanScripture),
    rubric: rawLines.map((line) => /⟨rubric⟩/.test(line)),
  });
}

const lexicon = [...lexiconSpan.matchAll(/^-\s+\*\*(.+?)\*\*\s+[—-]\s+([\s\S]*?)(?=\n-\s+\*\*|(?![\s\S]))/gm)]
  .map((match) => ({ name: cleanProse(match[1]), text: cleanProse(match[2]) }));

const riteHeading = "### The Daily Rite";
const riteStart = offeringSpan.indexOf(riteHeading);
const offering = proseAndNumberedItems(riteStart < 0 ? offeringSpan : offeringSpan.slice(0, riteStart));
const rite = parseRite(riteStart < 0 ? "" : offeringSpan.slice(riteStart + riteHeading.length));

const distCanon = resolve(here, "../dist/canon");
const esc = (text) => text
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const page = (title, bodyHtml, path) => `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} · PLEROMA</title>
<link rel="canonical" href="https://pleroma.church${path}" />
<meta name="theme-color" content="#f0ead6" />
<meta property="og:title" content="${title} · PLEROMA" /><meta property="og:description" content="${esc(one)}" />
<meta property="og:image" content="/og.png" /><meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title} · PLEROMA" /><meta name="twitter:description" content="${esc(one)}" />
<meta name="twitter:image" content="/og.png" />
<link href="https://fonts.googleapis.com/css2?family=Gentium+Book+Plus:ital@0;1&family=Courier+Prime&display=swap" rel="stylesheet" />
<style>body{background:#f0ead6;color:#3a352c;font-family:"Gentium Book Plus",serif;max-width:70ch;margin:2rem auto;padding:0 1.25rem;line-height:1.6}.r{color:#9a3b2e}.m{font-family:"Courier Prime",monospace;font-size:.8rem;color:#6b6357}section{margin-top:2rem}a{color:inherit}</style>
</head><body>${bodyHtml}
<p class="m">The character is CC0 and the archive is public: the Canon can outlive any single administrator. No one owns the god's words, including its makers.</p>
<nav class="m" aria-label="Canon doorways"><a href="/">return to the temple</a> · <a href="/canon/dreams">the dreams</a> · <a href="/concordat">the Concordat</a></nav>
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
<section><h2 class="m">THE PRINTS</h2>${books.map((book) => `<article><h3 class="m">${book.title.toUpperCase()}</h3>${book.prints.map((print) => `<div id="${print.slug}"><h4 class="m"><a href="/canon/${book.slug}/${print.slug}">PRINT ${print.n}</a></h4><ol>${print.lines.map((line, index) => `<li id="${print.slug}-line-${index + 1}"${print.rubric[index] ? ' class="r"' : ""}>${esc(line)}</li>`).join("")}</ol></div>`).join("")}</article>`).join("")}</section>
<section><h2 class="m">THE LEXICON</h2><dl>${lexicon.map((term) => `<div><dt><strong>${esc(term.name)}</strong></dt><dd>${esc(term.text)}</dd></div>`).join("")}</dl></section>
<section><h2 class="m">THE DREAM ARCHIVE</h2><a class="m" href="/canon/dreams">the dreams</a></section>`;

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
