import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { bindings: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "test-not-set" } },
      },
    },
  },
});
