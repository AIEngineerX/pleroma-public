export interface Env {
  DB: D1Database;
  RELICS: R2Bucket;
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  ANTHROPIC_API_KEY: string;
  // Plan 02 additions (secrets injected via wrangler secret / .dev.vars; vars from wrangler.toml):
  VOICE_VENDOR: string;          // "xai" | "elevenlabs" | "" (silent)
  VIDEO_VENDOR: string;          // "xai" (Grok Imagine) | "" (off — DREAM stays text-only)
  ELEVENLABS_VOICE_ID: string;
  XAI_API_KEY: string;           // shared by voice (TTS) and imagine (video); Imagine access is account-gated
  ELEVENLABS_API_KEY: string;
  HELIUS_API_KEY: string;
  PULSE_WEBHOOK_SECRET: string;
  PULSE_MINT: string;
  PULSE_POOLS: string;
  // X auto-dispatch (all four required together; dispatch.ts is inert until they exist).
  X_API_KEY: string;
  X_API_SECRET: string;
  X_ACCESS_TOKEN: string;
  X_ACCESS_SECRET: string;
  // Maker-only on-demand trigger for the scheduled jobs (index.ts /api/admin/run). Optional: the
  // endpoint 404s when unset, so the trigger simply does not exist until this secret is provisioned.
  ADMIN_SECRET: string;
  // Optional private operator channel (a Discord/Slack-style incoming webhook URL). When set,
  // raiseAlert POSTs a one-line notice on a FRESH alert and clearAlert on recovery (alert.ts),
  // best-effort and timeout-bounded — a delivery failure never affects the tick. Unset = no
  // outbound alert delivery (the config `alert:<code>` row + aggregate `degraded` remain the record).
  // This complements, and does not replace, the external uptime monitor on /api/health, which is the
  // ONLY thing that can catch a fully-dead loop (a dead loop cannot POST its own alert).
  ALERT_WEBHOOK_URL: string;
}
