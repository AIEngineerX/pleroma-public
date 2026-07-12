export interface Env {
  DB: D1Database;
  RELICS: R2Bucket;
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  ANTHROPIC_API_KEY: string;
  // Plan 02 additions (secrets injected via wrangler secret / .dev.vars; vars from wrangler.toml):
  VOICE_VENDOR: string;          // "xai" | "elevenlabs" | "" (silent)
  ELEVENLABS_VOICE_ID: string;
  XAI_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  HELIUS_API_KEY: string;
  PULSE_WEBHOOK_SECRET: string;
  PULSE_MINT: string;
  PULSE_POOLS: string;
}
