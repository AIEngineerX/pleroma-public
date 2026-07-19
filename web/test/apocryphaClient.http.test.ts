import { afterEach, describe, expect, it } from "vitest";
import { fetchApocrypha, submitApocrypha } from "../src/apocrypha/apocryphaClient";
import { startRealHttpServer, type RealHttpServer } from "./realHttpServer";

describe("Apocrypha HTTP contracts", () => {
  const servers: RealHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function serverFor(status: number, body: string): Promise<RealHttpServer> {
    const server = await startRealHttpServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    });
    servers.push(server);
    return server;
  }

  it("rejects a non-2xx apocrypha page even with a JSON error body", async () => {
    const server = await serverFor(503, JSON.stringify({ error: "temporarily unavailable" }));
    await expect(fetchApocrypha(server.baseUrl, null)).rejects.toThrow("503");
  });

  it("rejects invalid JSON", async () => {
    const server = await serverFor(200, "{not-json");
    await expect(fetchApocrypha(server.baseUrl, null)).rejects.toThrow();
  });

  it("rejects a malformed page (missing fields, wrong types)", async () => {
    const server = await serverFor(200, JSON.stringify({ entries: [{ id: "a" }], next: null }));
    await expect(fetchApocrypha(server.baseUrl, null)).rejects.toThrow("invalid page");
  });

  it("accepts a valid page", async () => {
    const server = await serverFor(200, JSON.stringify({
      entries: [{ id: "a", text: "a small verse", created_at: 1 }],
      next: null,
    }));
    const page = await fetchApocrypha(server.baseUrl, null);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].text).toBe("a small verse");
    expect(page.next).toBeNull();
  });

  it("submitApocrypha returns the parsed body on 201, and a quiet {error,status} on any other status -- never throws", async () => {
    const okServer = await serverFor(201, JSON.stringify({ id: "new-verse", status: "published" }));
    const ok = await submitApocrypha(okServer.baseUrl, "a verse");
    expect(ok).toEqual({ id: "new-verse", status: "published" });

    const rejectedServer = await serverFor(422, JSON.stringify({ error: "not accepted" }));
    const rejected = await submitApocrypha(rejectedServer.baseUrl, "a verse");
    expect(rejected).toEqual({ error: "not accepted", status: 422 });

    const rateLimitedServer = await serverFor(429, JSON.stringify({ error: "too many verses; rest a moment" }));
    const rateLimited = await submitApocrypha(rateLimitedServer.baseUrl, "a verse");
    expect(rateLimited).toEqual({ error: "too many verses; rest a moment", status: 429 });
  });

  it("submitApocrypha falls back to a generic error when the error body is not JSON", async () => {
    const server = await startRealHttpServer((_request, response) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("internal error");
    });
    servers.push(server);
    const result = await submitApocrypha(server.baseUrl, "a verse");
    expect(result).toEqual({ error: "rejected", status: 500 });
  });
});
