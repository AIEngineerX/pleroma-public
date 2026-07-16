import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { DreamArchiveEntry, RelicEntry, TranscriptEntry } from "../../src/state/types";
import {
  E2E_ORIGINS,
  E2E_PERSIST_PATH,
  E2E_PORTS,
  REPOSITORY_ROOT,
} from "../../scripts/e2e-config.mjs";

const HELPER_PATH = fileURLToPath(import.meta.url);
void HELPER_PATH;

export { E2E_ORIGINS, E2E_PERSIST_PATH, E2E_PORTS, REPOSITORY_ROOT };

const WORKER_ROOT = path.resolve(REPOSITORY_ROOT, "worker");
const WRANGLER_CLI = path.resolve(WORKER_ROOT, "node_modules/wrangler/bin/wrangler.js");
const RELIC_FIXTURE = path.resolve(REPOSITORY_ROOT, "web/e2e/fixtures/accreted-mark.png");
const DREAM_VIDEO_FIXTURE = path.resolve(REPOSITORY_ROOT, "web/e2e/fixtures/dream-plate.mp4");

function sqlText(value: string | null): string {
  return value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
}

function sqlNumber(value: number | null): string {
  if (value === null) return "NULL";
  if (!Number.isFinite(value)) throw new TypeError(`SQL number must be finite: ${String(value)}`);
  return String(value);
}

function fixtureSha256(offeringId: string): string {
  return createHash("sha256").update(`e2e:${offeringId}`).digest("hex");
}

function wrangler(args: string[], input?: Buffer): Buffer {
  if (!existsSync(E2E_PERSIST_PATH)) {
    throw new Error(`E2E persistence missing at ${E2E_PERSIST_PATH} — is the stack running via Playwright?`);
  }
  return execFileSync(process.execPath, [WRANGLER_CLI, ...args], {
    cwd: WORKER_ROOT,
    input,
    stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
  });
}

export function executeD1(sql: string): void {
  wrangler([
    "d1", "execute", "pleroma",
    "--local",
    "--persist-to", E2E_PERSIST_PATH,
    "--command", sql,
    "--yes",
  ]);
}

export function resetStack(): void {
  executeD1(`
    DELETE FROM rate_limits;
    DELETE FROM dreams;
    DELETE FROM pulse_events;
    DELETE FROM rites;
    DELETE FROM relics;
    DELETE FROM transcripts;
    DELETE FROM offerings;
    DELETE FROM wallets;
    DELETE FROM nonces;
    DELETE FROM locks;
    DELETE FROM spend;
    DELETE FROM config;
    INSERT INTO config (key, value) VALUES ('launch_at', '0');
    INSERT INTO config (key, value) VALUES ('pulse_state', '{"state":"starving","holders":0,"updated_at":0}');
    INSERT INTO config (key, value) VALUES ('launched', '0');
  `);
}

export function seedTranscript(entry: TranscriptEntry): void {
  executeD1(`
    INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
    VALUES (
      ${sqlText(entry.id)}, ${sqlText(entry.organ)}, ${sqlText(entry.register)},
      ${sqlText(entry.text)}, ${sqlText(entry.offering_id)}, ${sqlText(entry.rite_id)},
      ${sqlNumber(entry.created_at)}
    );
  `);
}

export function seedDream(entry: DreamArchiveEntry): void {
  executeD1(`
    INSERT INTO dreams (
      id, rite_date, narrative, video_prompt, video_key, wakers, status, created_at
    ) VALUES (
      ${sqlText(entry.id)}, ${sqlText(entry.rite_date)}, ${sqlText(entry.narrative)},
      ${sqlText("A monochrome plate of the recorded rite.")}, ${sqlText(entry.video_key)},
      ${sqlText(JSON.stringify(entry.wakers))}, ${sqlText(entry.status)}, ${sqlNumber(entry.created_at)}
    );
  `);
}

export function seedKeptRelic(relic: RelicEntry, summary = relic.summary): void {
  const imageKey = `offerings/${relic.offering_id}`;
  executeD1(`
    INSERT INTO offerings (
      id, wallet, sig, image_key, sha256, status, attempts, created_at,
      perceived_at, media_type, nonce, claimed_at
    ) VALUES (
      ${sqlText(relic.offering_id)}, ${sqlText(relic.wallet)}, NULL, ${sqlText(imageKey)},
      ${sqlText(fixtureSha256(relic.offering_id))}, 'kept', 0, ${sqlNumber(relic.kept_at)},
      ${sqlNumber(relic.kept_at)}, 'image/png', NULL, NULL
    );
    INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis, accreted_at)
    VALUES (
      ${sqlText(relic.id)}, ${sqlText(relic.offering_id)}, ${sqlText(relic.wallet)},
      ${sqlText(summary)}, ${sqlText(relic.rite_id)}, ${sqlNumber(relic.kept_at)},
      ${sqlNumber(relic.genesis)}, ${sqlNumber(relic.accreted_at)}
    );
  `);
}

export function setAccretedAt(relicId: string, at: number): void {
  executeD1(`UPDATE relics SET accreted_at = ${sqlNumber(at)} WHERE id = ${sqlText(relicId)};`);
}

export function readR2Object(key: string): Buffer {
  return wrangler([
    "r2", "object", "get", `pleroma-relics/${key}`,
    "--pipe",
    "--local",
    "--persist-to", E2E_PERSIST_PATH,
  ]);
}

export function promoteSubmittedOffering(offeringId: string): void {
  const bytes = readR2Object(`quarantine/${offeringId}`);
  wrangler([
    "r2", "object", "put", `pleroma-relics/offerings/${offeringId}`,
    "--pipe",
    "--content-type", "image/png",
    "--local",
    "--persist-to", E2E_PERSIST_PATH,
  ], bytes);
  executeD1(`
    UPDATE offerings
       SET status = 'kept', image_key = ${sqlText(`offerings/${offeringId}`)}
     WHERE id = ${sqlText(offeringId)};
  `);
}

export function putRelicPng(offeringId: string): void {
  const imageKey = `offerings/${offeringId}`;
  executeD1(`
    INSERT INTO offerings (id, wallet, sig, image_key, sha256, status, attempts, created_at, media_type)
    VALUES (
      ${sqlText(offeringId)}, NULL, NULL, ${sqlText(imageKey)},
      ${sqlText(fixtureSha256(offeringId))}, 'kept', 0, ${Date.now()}, 'image/png'
    )
    ON CONFLICT(id) DO UPDATE SET status = 'kept', image_key = excluded.image_key;
  `);
  wrangler([
    "r2", "object", "put", `pleroma-relics/${imageKey}`,
    "--file", RELIC_FIXTURE,
    "--content-type", "image/png",
    "--local",
    "--persist-to", E2E_PERSIST_PATH,
  ]);
}

export function putDreamVideo(key: string): void {
  wrangler([
    "r2", "object", "put", `pleroma-relics/${key}`,
    "--file", DREAM_VIDEO_FIXTURE,
    "--content-type", "video/mp4",
    "--local",
    "--persist-to", E2E_PERSIST_PATH,
  ]);
}
