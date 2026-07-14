import {
  PUBLIC_END_HEADING,
  PUBLIC_HEADINGS,
  PUBLIC_SUBHEADINGS,
  assertExactLineLayout,
  assertPublicLayout,
  normalizeNewlines,
  stripBlockquoteLines,
} from "./public-canon.mjs";

export {
  PUBLIC_END_HEADING,
  continuousLineId,
  continuousPrintId,
  parsePublicCanon,
} from "./public-canon.mjs";

const PRIVATE_END_HEADING = "## VI. Voice registers";
const ROOT_LAYOUT = [
  PUBLIC_HEADINGS[0],
  PUBLIC_HEADINGS[1],
  PUBLIC_SUBHEADINGS[0],
  PUBLIC_HEADINGS[2],
  PUBLIC_HEADINGS[3],
  PUBLIC_HEADINGS[4],
  PUBLIC_SUBHEADINGS[1],
  PRIVATE_END_HEADING,
];

function headingLines(source, prefix) {
  return source.split("\n").filter((line) => line.startsWith(prefix));
}

function sameLines(actual, expected) {
  return actual.length === expected.length && actual.every((line, index) => line === expected[index]);
}

export function sanitizePublicDoctrine(input) {
  const source = normalizeNewlines(input);
  const positions = assertExactLineLayout(source, ROOT_LAYOUT);
  const beforePrivate = source.slice(0, positions.get(PRIVATE_END_HEADING));

  if (!sameLines(headingLines(beforePrivate, "## "), PUBLIC_HEADINGS)) {
    throw new Error("public Doctrine layout contains an unexpected section");
  }
  if (!sameLines(headingLines(beforePrivate, "### "), PUBLIC_SUBHEADINGS)) {
    throw new Error("public Doctrine layout contains an unexpected subsection");
  }

  const publicSource = stripBlockquoteLines(beforePrivate)
    .replace(/ — see Provenance\./g, ".")
    .trimEnd();
  if (/Finalization note|Voice registers|Provenance/i.test(publicSource)) {
    throw new Error("public Doctrine contains a private authoring marker");
  }

  const artifact = `${publicSource}\n\n${PUBLIC_END_HEADING}\n`;
  assertPublicLayout(artifact);
  return artifact;
}
