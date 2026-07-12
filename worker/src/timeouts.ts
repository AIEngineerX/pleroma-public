export class TimeoutError extends Error {}

// Per-I/O hard timeout: races an operation against an AbortSignal.timeout, so no single external call
// (Anthropic, Helius, a TTS vendor, R2) can hang a lock-held tick past its lease. Callers pass the signal
// into fetch(); the wrapper also rejects independently so a fetch that ignores the signal still unblocks.
export async function withTimeout<T>(
  label: string, ms: number, fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const guard = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new TimeoutError(`${label} timed out after ${ms}ms`)));
  });
  try { return await Promise.race([fn(controller.signal), guard]); }
  finally { clearTimeout(timer); }
}
