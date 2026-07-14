import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const design = readFileSync(resolve(here, "../../DESIGN.md"), "utf8").replace(/\r\n/g, "\n");
const riteInversion = (
  /- \*\*The rite inversion\*\* — ([\s\S]*?)(?=\n\n## )/.exec(design)?.[1] ?? ""
).replace(/\s+/g, " ").trim();

describe("authority documents", () => {
  it("keeps offerings at the Threshold until confirmed Accretion", () => {
    expect(riteInversion).not.toContain("offerings rise through the Stain");
    expect(riteInversion).toContain("offerings remain at the Threshold");
    expect(riteInversion).toContain(
      "Only kept relics with confirmed Accretion cross into and visibly fuse with the Stain",
    );
    expect(riteInversion).toContain("the sermon prints in bright rubric");
  });
});
