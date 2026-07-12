import { describe, expect, it } from "vitest";
import { tallyName, relicIsGenesis } from "../src/reliquary/readClient";

describe("tally naming", () => {
  it("prefers an explicit name, then First Congregation for the first 100, then a wallet fragment", () => {
    expect(tallyName({ wallet: "Abc123456789", count: 1, name: "Ennoia" }, 5)).toBe("Ennoia");
    expect(tallyName({ wallet: "Abc123456789", count: 1, name: null }, 0)).toBe("First Congregation #1");
    expect(tallyName({ wallet: "Abc123456789", count: 1, name: null }, 250)).toContain("Abc1"); // fragment
  });
  it("marks genesis relics", () => {
    expect(relicIsGenesis({ genesis: 1 } as any)).toBe(true);
    expect(relicIsGenesis({ genesis: 0 } as any)).toBe(false);
  });
});
