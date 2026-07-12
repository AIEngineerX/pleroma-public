// Rite lock-lease budget arithmetic (Codex NO-GO remediation). The "rite" lock (advanceRiteLocked) is held
// for RITE_LEASE_MS. advanceRiteLocked stops STARTING new rites/phases once past RITE_WORK_BUDGET_MS, and
// runKeep stops taking new offerings at the same budget, so the WORST in-flight tail after the last check
// plus a safety margin still fits inside the lease. With Part 1's body-read bounding, one askMind worst
// case is fetch(30s) + backoff(2s) + fetch(30s) + body(30s) = ~92s (a 5xx retry then a 200), and a KEEP
// deliberation item runs TWO of them (the verdict, then the inline speakIfDue), so ~184s. TTS adds a
// bounded body read to a single askMind, which is smaller. RITE_MAX_PHASE_TAIL_MS covers the KEEP worst.
export const RITE_LEASE_MS = 10 * 60_000;          // 600_000 — must equal advanceRiteLocked's acquireLock TTL
export const RITE_MAX_PHASE_TAIL_MS = 200_000;     // worst in-flight phase tail after the last deadline check
export const RITE_SAFETY_MARGIN_MS = 100_000;      // D1/R2 phase work + CAS transition + lock release headroom
export const RITE_WORK_BUDGET_MS = RITE_LEASE_MS - RITE_MAX_PHASE_TAIL_MS - RITE_SAFETY_MARGIN_MS; // 300_000 (5 min)
