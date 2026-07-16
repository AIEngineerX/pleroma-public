import { afterEach, describe, expect, it } from "vitest";
import { talliesAfterRefresh } from "../src/reliquary/Tallies";
import { fetchRelics, fetchTallies, type TallyPage } from "../src/reliquary/readClient";
import type { Tally } from "../src/state/types";
import { startRealHttpServer, type RealHttpServer } from "./realHttpServer";

describe("Reliquary HTTP contracts", () => {
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

  it("rejects non-2xx relic and tally responses even when their error bodies are JSON", async () => {
    const server = await serverFor(503, JSON.stringify({ error: "temporarily unavailable" }));
    await expect(fetchRelics(server.baseUrl, null)).rejects.toThrow("503");
    await expect(fetchTallies(server.baseUrl, "2030-01-02")).rejects.toThrow("503");
  });

  it("rejects invalid JSON from both read boundaries", async () => {
    const server = await serverFor(200, "{not-json");
    await expect(fetchRelics(server.baseUrl, null)).rejects.toThrow();
    await expect(fetchTallies(server.baseUrl, "2030-01-02")).rejects.toThrow();
  });

  it("rejects malformed relic and tally pages", async () => {
    const relicServer = await serverFor(200, JSON.stringify({ entries: [{}], next: null }));
    await expect(fetchRelics(relicServer.baseUrl, null)).rejects.toThrow("invalid page");

    const tallyServer = await serverFor(200, JSON.stringify({
      date: "2030-01-02",
      marks: 1,
      communicants: 1,
      tallies: [{ wallet: "wallet-a", count: "1", name: null }],
    }));
    await expect(fetchTallies(tallyServer.baseUrl, "2030-01-02")).rejects.toThrow("invalid page");
  });

  it("accepts valid real responses and preserves the previous UI state after a failed refresh", async () => {
    const validServer = await startRealHttpServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url?.startsWith("/api/relics") ? {
        entries: [{
          id: "relic-a",
          offering_id: "offering-a",
          wallet: "wallet-a",
          summary: "a retained mark",
          rite_id: "2030-01-02",
          kept_at: 1,
          genesis: 0,
          accreted_at: null,
        }],
        next: null,
      } : {
        date: "2030-01-02",
        marks: 1,
        communicants: 1,
        tallies: [{ wallet: "wallet-a", count: 1, name: null }],
      }));
    });
    servers.push(validServer);
    expect((await fetchRelics(validServer.baseUrl, null)).entries).toHaveLength(1);
    const validTallies = await fetchTallies(validServer.baseUrl, "2030-01-02");
    expect(validTallies.tallies).toHaveLength(1);

    const failingServer = await serverFor(500, JSON.stringify({ error: "unavailable" }));
    const previous: Tally[] = [{ wallet: "wallet-a", count: 1, name: null }];
    let refresh: TallyPage | null = null;
    try {
      refresh = await fetchTallies(failingServer.baseUrl, "2030-01-02");
    } catch {
      // The UI boundary receives null on failure and keeps its last safe state.
    }
    expect(talliesAfterRefresh(previous, refresh)).toBe(previous);
  });
});
