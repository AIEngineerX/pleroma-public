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
// The paste block below carries VERIFIED pools only (the derived curve). A counterparty-frequency
// guess never enters it: a high-frequency trader can top the tally, and a non-pool address in
// PULSE_POOLS makes classifySwap read that wallet's ordinary transfers as buys/sells — fabricated
// vitals, which the project's integrity invariants forbid. A graduation candidate is only ever
// flagged for the operator to verify (DexScreener's pair address for the new venue) and append by
// hand. Same rule for the webhook watch list: watching a non-pool wallet would deliver its
// unrelated transactions, pile up side=NULL rows, and falsely trip pulse_pool_mismatch.
const pools = [curve.address];
const candidate = observed.length > 0 && observed[0][0] !== curve.address ? observed[0][0] : null;
if (candidate) console.log(`NOTE:           top counterparty is NOT the curve — token likely graduated. VERIFY ${candidate} against DexScreener's pair address for the new venue, then append it to PULSE_POOLS by hand; it is deliberately NOT in the paste block below.`);

// --- 3. Helius webhook ---------------------------------------------------------------------------
const watch = [mint, curve.address];
if (register) {
  const listRes = await fetch(`${HELIUS}/webhooks?api-key=${HELIUS_API_KEY}`);
  // A 5xx here must fail loud, not fall through to the CREATE branch and register a duplicate
  // webhook (double deliveries; deduped downstream by signature, but wasted credits forever).
  if (!listRes.ok) fail(`webhook list failed: HTTP ${listRes.status} ${redact(await listRes.text())}`);
  const list = await listRes.json();
  if (!Array.isArray(list)) fail("webhook list: unexpected response shape");
  const existing = list.find(w => w.webhookURL === PULSE_URL);
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
re-run this script — it flags the new pool candidate. Verify it on DexScreener,
append it to PULSE_POOLS, redeploy. The webhook needs no change: it watches the
mint, so deliveries already flow from the new venue.
========================================================================================`);
