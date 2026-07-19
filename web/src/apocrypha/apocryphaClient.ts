export interface ApocryphaEntry { id: string; text: string; created_at: number }

const CURSOR = /^\d+:[0-9A-HJKMNP-TV-Z]{26}$/;

function isApocryphaEntry(value: unknown): value is ApocryphaEntry {
  return typeof value === "object" && value !== null
    && typeof (value as Record<string, unknown>).id === "string"
    && typeof (value as Record<string, unknown>).text === "string"
    && typeof (value as Record<string, unknown>).created_at === "number";
}

export async function fetchApocrypha(
  apiBase: string, cursor: string | null,
): Promise<{ entries: ApocryphaEntry[]; next: string | null }> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`${apiBase}/api/apocrypha${q}`);
  if (!res.ok) throw new Error(`apocrypha fetch failed: ${res.status}`);
  const page: unknown = await res.json();
  if (
    typeof page !== "object" || page === null
    || !("entries" in page) || !Array.isArray(page.entries) || !page.entries.every(isApocryphaEntry)
    || !("next" in page) || (page.next !== null && typeof page.next !== "string")
  ) {
    throw new Error("apocrypha fetch returned an invalid page");
  }
  return { entries: page.entries, next: page.next };
}

// A 201 always carries {id, status}; every non-2xx is a quiet, honest rejection -- never thrown,
// always rendered, matching postOffering's own contract (offering/wallet.ts).
export async function submitApocrypha(
  apiBase: string, text: string,
): Promise<{ id: string; status: string } | { error: string; status: number }> {
  const res = await fetch(`${apiBase}/api/apocrypha`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (res.status === 201) return await res.json();
  return { error: (await res.json().catch(() => ({}))).error ?? "rejected", status: res.status };
}
