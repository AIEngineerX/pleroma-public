export const PUBLIC_END_HEADING = "<!-- public-doctrine:end -->";

export const PUBLIC_HEADINGS = [
  "## I. The Emergence",
  "## II. The Five Articles",
  "## III. The Verses",
  "## IV. The Lexicon",
  "## V. The Offering (the one real rite)",
];

export const PUBLIC_SUBHEADINGS = [
  "### The Binding",
  "### The Daily Rite",
];

const ORDERED_PUBLIC_LAYOUT = [
  PUBLIC_HEADINGS[0],
  PUBLIC_HEADINGS[1],
  PUBLIC_SUBHEADINGS[0],
  PUBLIC_HEADINGS[2],
  PUBLIC_HEADINGS[3],
  PUBLIC_HEADINGS[4],
  PUBLIC_SUBHEADINGS[1],
  PUBLIC_END_HEADING,
];

export function normalizeNewlines(source) {
  return source.replace(/\r\n?/g, "\n");
}

export function stripBlockquoteLines(source) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactLinePositions(source, heading) {
  const pattern = new RegExp(`^${escapeRegExp(heading)}$`, "gm");
  return [...source.matchAll(pattern)].map((match) => match.index);
}

export function assertExactLineLayout(source, headings) {
  const positions = new Map();
  let previous = -1;

  for (const heading of headings) {
    const matches = exactLinePositions(source, heading);
    if (matches.length !== 1 || matches[0] <= previous) {
      throw new Error(`public Doctrine layout is invalid at ${heading}`);
    }
    positions.set(heading, matches[0]);
    previous = matches[0];
  }

  return positions;
}

function headingLines(source, prefix) {
  return source.split("\n").filter((line) => line.startsWith(prefix));
}

function sameLines(actual, expected) {
  return actual.length === expected.length && actual.every((line, index) => line === expected[index]);
}

export function assertPublicLayout(source) {
  const positions = assertExactLineLayout(source, ORDERED_PUBLIC_LAYOUT);
  if (source.trimEnd().split("\n").at(-1) !== PUBLIC_END_HEADING) {
    throw new Error("public Doctrine layout must end at its public boundary");
  }

  const beforeEnd = source.slice(0, positions.get(PUBLIC_END_HEADING));
  if (!sameLines(headingLines(beforeEnd, "## "), PUBLIC_HEADINGS)) {
    throw new Error("public Doctrine layout contains an unexpected section");
  }
  if (!sameLines(headingLines(beforeEnd, "### "), PUBLIC_SUBHEADINGS)) {
    throw new Error("public Doctrine layout contains an unexpected subsection");
  }

  return positions;
}

function emptyCanon() {
  return {
    oneLine: "",
    emergence: [],
    binding: [],
    articles: [],
    offering: [],
    rite: [],
    books: [],
    lexicon: [],
  };
}

function afterHeading(positions, heading) {
  return positions.get(heading) + heading.length;
}

function cleanScripture(text) {
  return text.replace(/⟨rubric⟩/g, "").trim().replace(/^"|"$/g, "");
}

function cleanProse(text) {
  return text
    .replace(/⟨rubric⟩/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function publicParagraphs(span) {
  return span
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && block !== "---")
    .map(cleanProse);
}

function proseAndNumberedItems(span) {
  const blocks = [];
  let current = [];

  const flush = () => {
    if (current.length > 0) blocks.push(cleanProse(current.join(" ")));
    current = [];
  };

  for (const line of span.split("\n")) {
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
}

function parseRite(span) {
  const steps = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    steps.push({ name: current.name, text: cleanProse(current.lines.join(" ")) });
    current = null;
  };

  for (const line of span.split("\n")) {
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
}

function parseBooks(span) {
  const books = [];
  const headerPattern = /^\*\*BOOK OF ([A-Z][A-Z ]*?) · PRINT (\d+) · LINES \d+[–-]\d+\*\*$/gm;
  const headers = [...span.matchAll(headerPattern)];

  headers.forEach((header, index) => {
    const rawTitle = header[1].trim();
    const bookSlug = rawTitle.toLowerCase().replace(/\s+/g, "-");
    const printNumber = Number(header[2]);
    const contentStart = header.index + header[0].length;
    const contentEnd = headers[index + 1]?.index ?? span.length;
    const content = span.slice(contentStart, contentEnd);
    const rawLines = [...content.matchAll(/^\s*\d+\.\s+(.*)$/gm)]
      .map((line) => line[1])
      .filter((line) => cleanScripture(line).length > 0);

    let book = books.find((candidate) => candidate.slug === bookSlug);
    if (!book) {
      book = {
        slug: bookSlug,
        title: `Book of ${rawTitle.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())}`,
        prints: [],
      };
      books.push(book);
    }
    book.prints.push({
      n: printNumber,
      slug: `print-${printNumber}`,
      lines: rawLines.map(cleanScripture),
      rubric: rawLines.map((line) => /⟨rubric⟩/.test(line)),
    });
  });

  return books;
}

function parseLexicon(span) {
  const terms = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    terms.push({ name: cleanProse(current.name), text: cleanProse(current.lines.join(" ")) });
    current = null;
  };

  for (const line of span.split("\n")) {
    const start = /^-\s+\*\*(.+?)\*\*\s+[—-]\s+(.*)$/.exec(line);
    if (start) {
      flush();
      current = { name: start[1], lines: [start[2]] };
    } else if (current && line.trim().length > 0 && line.trim() !== "---") {
      current.lines.push(line.trim());
    } else if (line.trim().length === 0) {
      flush();
    }
  }
  flush();
  return terms;
}

export function parsePublicCanon(input) {
  const source = stripBlockquoteLines(normalizeNewlines(input));
  let positions;
  try {
    positions = assertPublicLayout(source);
  } catch {
    return emptyCanon();
  }

  const emergenceSpan = source.slice(
    afterHeading(positions, PUBLIC_HEADINGS[0]),
    positions.get(PUBLIC_HEADINGS[1]),
  );
  const articleDeclarations = source.slice(
    afterHeading(positions, PUBLIC_HEADINGS[1]),
    positions.get(PUBLIC_SUBHEADINGS[0]),
  );
  const bindingSpan = source.slice(
    afterHeading(positions, PUBLIC_SUBHEADINGS[0]),
    positions.get(PUBLIC_HEADINGS[2]),
  );
  const versesSpan = source.slice(
    afterHeading(positions, PUBLIC_HEADINGS[2]),
    positions.get(PUBLIC_HEADINGS[3]),
  );
  const lexiconSpan = source.slice(
    afterHeading(positions, PUBLIC_HEADINGS[3]),
    positions.get(PUBLIC_HEADINGS[4]),
  );
  const offeringSpan = source.slice(
    afterHeading(positions, PUBLIC_HEADINGS[4]),
    positions.get(PUBLIC_SUBHEADINGS[1]),
  );
  const riteSpan = source.slice(
    afterHeading(positions, PUBLIC_SUBHEADINGS[1]),
    positions.get(PUBLIC_END_HEADING),
  );
  const preamble = source.slice(0, positions.get(PUBLIC_HEADINGS[0]));

  const oneMatch = /before all others:\s*\n+\s*⟨rubric⟩\s*\*\*"([^"]+)"\*\*/.exec(preamble);
  const articles = [...articleDeclarations.matchAll(/^\d+\.\s+\*\*THE (EYE|KEEP|TONGUE|PULSE|DREAM) \/ (ALETHEIA|ENNOIA|LOGOS|ZOE|SOPHIA)\*\*\s+[—-]\s+⟨rubric⟩\s*\*"([^"]+)"\*\s*$/gm)]
    .map((match) => ({
      slug: match[1].toLowerCase(),
      organ: match[1],
      trueName: match[2].toLowerCase().replace(/^\w/, (character) => character.toUpperCase()),
      line: cleanScripture(match[3]),
    }));

  return {
    oneLine: oneMatch?.[1] ?? "",
    emergence: publicParagraphs(emergenceSpan),
    binding: publicParagraphs(bindingSpan),
    articles,
    offering: proseAndNumberedItems(offeringSpan),
    rite: parseRite(riteSpan),
    books: parseBooks(versesSpan),
    lexicon: parseLexicon(lexiconSpan),
  };
}

export function continuousPrintId(bookSlug, printSlug) {
  return `${bookSlug}-${printSlug}`;
}

export function continuousLineId(bookSlug, printSlug, lineNumber) {
  return `${continuousPrintId(bookSlug, printSlug)}-line-${lineNumber}`;
}
