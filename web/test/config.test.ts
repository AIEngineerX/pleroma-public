import { describe, expect, it } from "vitest";
import { resolveApiBase } from "../src/config";

describe("resolveApiBase", () => {
  it("prefers an explicit VITE_API_BASE override, regardless of PROD", () => {
    expect(resolveApiBase({ VITE_API_BASE: "https://x" })).toBe("https://x");
    expect(resolveApiBase({ VITE_API_BASE: "https://x", PROD: false })).toBe("https://x");
  });

  it("defaults to the pinned production Worker origin in a production build", () => {
    expect(resolveApiBase({ PROD: true })).toBe("https://pleroma-worker-production.redacted.workers.dev");
  });

  it("falls back to same-origin (empty string) outside of production", () => {
    expect(resolveApiBase({ PROD: false })).toBe("");
    expect(resolveApiBase({})).toBe("");
  });
});
