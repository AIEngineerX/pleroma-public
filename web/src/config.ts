// The production Worker origin, baked into every production build so the SPA never silently falls back to
// same-origin (which returns index.html for /api/* and breaks state polling — this has bitten prod once).
// Override per-build with VITE_API_BASE. Update this constant when the custom domain (pleromachurch.xyz) lands.
const PROD_API_BASE = "https://api.pleromachurch.xyz";

export function resolveApiBase(env: { VITE_API_BASE?: string; PROD?: boolean }): string {
  if (env.VITE_API_BASE) return env.VITE_API_BASE;
  return env.PROD ? PROD_API_BASE : "";
}
