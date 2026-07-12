// Anti-decoy: every money link is a pure function of the mint the caller passes in. No hardcoded
// mint, no fallback source. Social links exist pre-launch (the being has an X presence before it
// has a heartbeat); money links are null until a mint exists.
const X_HANDLE = "https://x.com/pleroma_church";

export function links(mint: string | null) {
  if (!mint) return { pump: null as string | null, dexscreener: null as string | null, dexEmbed: null as string | null, x: X_HANDLE };
  return {
    pump: `https://pump.fun/coin/${mint}`,
    dexscreener: `https://dexscreener.com/solana/${mint}`,
    dexEmbed: `https://dexscreener.com/solana/${mint}?embed=1&theme=light&info=0`,
    x: X_HANDLE,
  };
}
