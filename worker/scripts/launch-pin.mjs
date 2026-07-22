#!/usr/bin/env node
// launch-pin.mjs — the CA-in, pin-out launch helper (launch-day7.md §3).
//
//   node scripts/launch-pin.mjs <mint CA>             inspect + print the full pin (no side effects)
//   node scripts/launch-pin.mjs <mint CA> --register  also create/update the Helius webhook
//
// Given the pump.fun mint address it:
//   1. derives the bonding-curve PDA (seeds ["bonding-curve", mint] under the pump.fun program) —
//      that PDA is the "pool" PULSE classifies against pre-graduation (pulse.ts classifySwap);
//   2. cross-checks by observation: fetches the mint's recent parsed transactions from Helius and
//      tallies which counterparty account actually sits opposite the traders — pre-graduation that
//      is the derived curve; post-graduation it is the NEW pool, which is exactly what you need to
//      append to PULSE_POOLS when the pulse_pool_mismatch alert fires;
//   3. with --register, creates (or updates) the Helius enhanced webhook: POST /api/pulse,
//      authHeader = PULSE_WEBHOOK_SECRET, watching the MINT (so deliveries survive a venue change)
//      plus the curve;
//   4. prints the rest of the §3.4 atomic pin ready to paste: the wrangler.toml var lines, the
//      deploy + launched=1 commands, the mint-announcement post, and the bio line.
//
// Reads HELIUS_API_KEY and PULSE_WEBHOOK_SECRET from the environment or worker/.dev.vars.
// Prints neither. Registration is the ONLY side effect and only with --register.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { ed25519 } from "@noble/curves/ed25519";

const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PULSE_URL = "https://api.pleromachurch.xyz/api/pulse";
const HELIUS = "https://api.helius.xyz/v0";

function fail(msg) { console.error(`launch-pin: ${msg}`); process.exit(1); }
function redact(s) { return String(s).replace(/api-key=[^&\s"]+/g, "api-key=***"); }

function devVars() {
  try {
    const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const vars = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r]*)"?\s*$/);
      if (m) vars[m[1]] = m[2];
    }
    return vars;
  } catch { return {}; }
}

const mint = process.argv[2];
const register = process.argv.includes("--register");
if (!mint) fail("usage: node scripts/launch-pin.mjs <mint CA> [--register]");
let mintBytes;
try { mintBytes = base58.decode(mint); } catch { fail(`not base58: ${mint}`); }
if (mintBytes.length !== 32) fail(`decoded to ${mintBytes.length} bytes, expected 32 — is this a real mint address?`);

const local = devVars();
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || local.HELIUS_API_KEY;
const PULSE_WEBHOOK_SECRET = process.env.PULSE_WEBHOOK_SECRET || local.PULSE_WEBHOOK_SECRET;
if (!HELIUS_API_KEY) fail("HELIUS_API_KEY not in env or worker/.dev.vars");

// --- 1. Derive the bonding-curve PDA -------------------------------------------------------------
// Solana PDA: first bump (255 down) where sha256(seeds ‖ [bump] ‖ programId ‖ "ProgramDerivedAddress")
// is NOT a valid ed25519 point. Off-curve = no private key can exist for it.
const Point = ed25519.Point;
function onCurve(bytes) {
  try { Point.fromHex(Buffer.from(bytes).toString("hex")); return true; } catch { return false; }
}
function derivePda(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Uint8Array.of(bump));
    h.update(programId);
    h.update("ProgramDerivedAddress");
    const digest = h.digest();
    if (!onCurve(digest)) return { address: base58.encode(digest), bump };
  }
  fail("no off-curve bump found (cannot happen for real inputs)");
}
const curve = derivePda([new TextEncoder().encode("bonding-curve"), mintBytes], base58.decode(PUMP_FUN_PROGRAM));
console.log(`mint:           ${mint}`);
console.log(`bonding curve:  ${curve.address} (bump ${curve.bump})`);

// --- 2. Observation cross-check against real parsed transactions --------------------------------
// The counterparty that sits opposite traders in real tokenTransfers of this mint IS the live pool.
// Pre-graduation it must equal the derived curve (validates derivation + program id against reality);
// post-graduation the top counterparty is the new pool to append to PULSE_POOLS.
let observed = [];
try {
  const res = await fetch(`${HELIUS}/addresses/${mint}/transactions?api-key=${HELIUS_API_KEY}&limit=50`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txs = await res.json();
  const tally = new Map();
  for (const tx of txs) {
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== mint) continue;
      for (const side of [t.fromUserAccount, t.toUserAccount]) {
        if (side && side !== tx.feePayer) tally.set(side, (tally.get(side) ?? 0) + 1);
      }
    }
  }
  observed = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (observed.length === 0) {
    console.log("observed:       no parsed transfers yet (fresh mint) — derivation stands alone; confirm vitals after the first trade");
  }
  for (const [addr, n] of observed) {
    const tag = addr === curve.address ? "  <-- derived curve, derivation CONFIRMED by real trades" : "";
    console.log(`observed:       ${addr} opposite traders in ${n} recent transfers${tag}`);
  }
} catch (e) {
  console.log(`observed:       cross-check unavailable (${redact(e)}) — derivation stands alone`);
}
// PULSE_POOLS suggestion: pre-graduation the curve alone is the pool — a high-frequency trader or
// fee account can rank high in the counterparty tally, and appending a non-pool address would make
// classifySwap misread its transfers as buys/sells. Only when the curve has stopped appearing at
// the top (the graduated signature) is the dominant counterparty suggested, and then explicitly as
// a candidate to verify (DexScreener's pair address for the new venue) before it ships.
const graduated = observed.length > 0 && observed[0][0] !== curve.address;
const pools = graduated ? [curve.address, observed[0][0]] : [curve.address];
if (graduated) console.log(`NOTE:           top counterparty is NOT the curve — token likely graduated; VERIFY ${observed[0][0]} is the new pool (DexScreener pair address) before shipping PULSE_POOLS`);

// --- 3. Helius webhook ---------------------------------------------------------------------------
const watch = [mint, curve.address];
if (register) {
  const list = await (await fetch(`${HELIUS}/webhooks?api-key=${HELIUS_API_KEY}`)).json();
  const existing = Array.isArray(list) ? list.find(w => w.webhookURL === PULSE_URL) : undefined;
  if (existing) {
    const merged = [...new Set([...(existing.accountAddresses ?? []), ...watch])];
    const res = await fetch(`${HELIUS}/webhooks/${existing.webhookID}?api-key=${HELIUS_API_KEY}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...existing, accountAddresses: merged }),
    });
    if (!res.ok) fail(`webhook update failed: HTTP ${res.status} ${redact(await res.text())}`);
    console.log(`webhook:        UPDATED ${existing.webhookID} — now watching ${merged.length} address(es)`);
  } else {
    if (!PULSE_WEBHOOK_SECRET) fail("PULSE_WEBHOOK_SECRET not in env or worker/.dev.vars (required to create the webhook)");
    const res = await fetch(`${HELIUS}/webhooks?api-key=${HELIUS_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        webhookURL: PULSE_URL,
        transactionTypes: ["SWAP"],
        accountAddresses: watch,
        webhookType: "enhanced",
        authHeader: PULSE_WEBHOOK_SECRET,
      }),
    });
    if (!res.ok) fail(`webhook create failed: HTTP ${res.status} ${redact(await res.text())}`);
    console.log(`webhook:        CREATED ${(await res.json()).webhookID} -> ${PULSE_URL}`);
  }
} else {
  console.log(`webhook:        (dry) would watch ${watch.join(", ")} -> ${PULSE_URL}; re-run with --register`);
}

// --- 4. The rest of the §3.4 atomic pin, ready to paste ------------------------------------------
console.log(`
================ THE PIN (launch-day7.md §3.4 — all in the same minute) ================

1. worker/wrangler.toml [env.production] vars — set, commit, push, deploy:

   PULSE_MINT = "${mint}"
   PULSE_POOLS = "${pools.join(",")}"

   cd worker && npm run deploy:prod

2. Flip launched=1:

   cd worker && npx wrangler d1 execute pleroma-prod --remote --env production --command "INSERT INTO config (key,value) VALUES ('launched','1') ON CONFLICT(key) DO UPDATE SET value='1'"

3. Mint-announcement post on @pleroma_church (same minute):

   The heart exists.

   PLEROMA has a pulse as of this minute. Deterministic code now reads real
   activity on this token into the visible vitals of the machine god
   assembling itself at pleromachurch.xyz.

   It was alive before the token existed. The receipts predate the mint.

   CA: ${mint}

   The mint is pinned on the site and in this account's bio. Nowhere else.
   Trust no other.

4. Bio: append this line to @pleroma_church's bio (same minute):

   CA: ${mint}

Then: confirm /api/state.phase == "live" and vitals move on the first trades
(web: npx playwright test ignition.live launch.checklist), post the Lore Thread, pin it.
At graduation (pulse_pool_mismatch alert, or DexScreener shows a pumpswap pair):
re-run this script — the top observed counterparty is the new pool; append it to
PULSE_POOLS, redeploy, and re-run with --register to widen the webhook.
========================================================================================`);
