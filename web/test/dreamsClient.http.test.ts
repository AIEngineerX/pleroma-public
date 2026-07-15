import { afterEach, describe, expect, it } from "vitest";
import {
  DreamPlateIdentityCache,
  fetchDreams,
  type DreamPage,
} from "../src/canon/dreamsClient";
import type { BodyCommand } from "../src/experience/types";
import type { DreamView } from "../src/state/types";
import { startRealHttpServer, type RealHttpServer } from "./realHttpServer";

const plate: DreamView = {
  narrative: "A real hanging archive request must remain cancellable.",
  video_key: null,
  wakers: [],
  created_at: Date.UTC(2030, 0, 2, 3, 4, 5),
};

const command: BodyCommand = {
  id: "converge:live-http-boundary",
  kind: "converge",
  dream: {
    id: "live-http-boundary",
    riteDate: "2030-01-02",
    narrative: plate.narrative,
    createdAt: plate.created_at,
    source: "live",
  },
};

const page: DreamPage = {
  entries: [{
    id: "01JH0000000000000000000001",
    rite_date: "2030-01-02",
    narrative: plate.narrative,
    video_key: null,
    wakers: [],
    status: "composed",
    created_at: plate.created_at,
  }],
  next: null,
};

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, milliseconds = 500): Promise<T | "timed-out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), milliseconds);
  });
  const result = await Promise.race([promise, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

function writePage(response: import("node:http").ServerResponse): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(page));
}

describe("DREAM archive HTTP ownership", () => {
  const servers: RealHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("aborts the real fetch promptly when the last cache consumer leaves, then evicts it", async () => {
    const firstStarted = deferred();
    const firstClosed = deferred();
    let requests = 0;
    const server = await startRealHttpServer((request, response) => {
      requests += 1;
      if (requests === 1) {
        request.once("close", firstClosed.resolve);
        firstStarted.resolve();
        return;
      }
      writePage(response);
    });
    servers.push(server);

    const identities = new DreamPlateIdentityCache((apiBase, cursor, signal) => (
      fetchDreams(apiBase, cursor, { signal, timeoutMs: 2_000 })
    ));
    const controller = new AbortController();
    const pending = identities.confirm(server.baseUrl, plate, command, controller.signal);
    await firstStarted.promise;
    controller.abort();

    expect(await within(pending)).toBe("unavailable");
    expect(await within(firstClosed.promise)).not.toBe("timed-out");
    expect(await identities.confirm(server.baseUrl, plate, command)).toBe("confirmed");
    expect(requests).toBe(2);
  });

  it("keeps one real shared request alive when only one of two consumers aborts", async () => {
    const started = deferred();
    let response: import("node:http").ServerResponse | null = null;
    let requestClosed = false;
    let requests = 0;
    const server = await startRealHttpServer((request, currentResponse) => {
      requests += 1;
      response = currentResponse;
      request.once("close", () => { requestClosed = true; });
      started.resolve();
    });
    servers.push(server);

    const identities = new DreamPlateIdentityCache((apiBase, cursor, signal) => (
      fetchDreams(apiBase, cursor, { signal, timeoutMs: 2_000 })
    ));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = identities.confirm(server.baseUrl, plate, command, firstController.signal);
    const second = identities.confirm(server.baseUrl, plate, command, secondController.signal);
    await started.promise;
    firstController.abort();

    expect(await within(first)).toBe("unavailable");
    expect(requestClosed).toBe(false);
    if (response === null) throw new Error("DREAM test server did not retain its response");
    writePage(response);
    expect(await second).toBe("confirmed");
    expect(requests).toBe(1);
  });

  it("times out a real hung request and evicts it so the next request can recover", async () => {
    const firstClosed = deferred();
    let requests = 0;
    const server = await startRealHttpServer((request, response) => {
      requests += 1;
      if (requests === 1) {
        request.once("close", firstClosed.resolve);
        return;
      }
      writePage(response);
    });
    servers.push(server);

    const identities = new DreamPlateIdentityCache((apiBase, cursor, signal) => (
      fetchDreams(apiBase, cursor, { signal, timeoutMs: 75 })
    ));
    expect(await within(identities.confirm(server.baseUrl, plate, command), 1_000))
      .toBe("unavailable");
    expect(await within(firstClosed.promise)).not.toBe("timed-out");
    expect(await identities.confirm(server.baseUrl, plate, command)).toBe("confirmed");
    expect(requests).toBe(2);
  });
});
