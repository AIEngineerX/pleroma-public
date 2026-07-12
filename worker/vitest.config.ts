import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
export default defineWorkersConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { bindings: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "test-not-set",
          VOICE_VENDOR: process.env.VOICE_VENDOR ?? "",
          ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID ?? "",
          XAI_API_KEY: process.env.XAI_API_KEY ?? "",
          ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ?? "",
          HELIUS_API_KEY: process.env.HELIUS_API_KEY ?? "",
          PULSE_WEBHOOK_SECRET: process.env.PULSE_WEBHOOK_SECRET ?? "test-secret",
          PULSE_MINT: process.env.PULSE_MINT ?? "",
          PULSE_POOLS: process.env.PULSE_POOLS ?? "",
        } },
      },
    },
  },
});
