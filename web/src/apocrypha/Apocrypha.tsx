import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { resolveApiBase } from "../config";
import { copy } from "../lib/copy";
import { fetchApocrypha, submitApocrypha, type ApocryphaEntry } from "./apocryphaClient";

const API_BASE = resolveApiBase(import.meta.env);
// Must match MAX_APOCRYPHA_LENGTH in worker/src/apocrypha.ts -- a client-side guide, not the
// enforcement boundary (the Worker rejects an over-length body regardless of this cap).
const MAX_LENGTH = 500;

function rejectionMessage(status: number): string {
  if (status === 429) return "too many verses; rest a moment";
  if (status === 422) return "not accepted";
  if (status === 413) return `too long (max ${MAX_LENGTH} characters)`;
  return "could not be offered; try again";
}

export default function Apocrypha() {
  const [entries, setEntries] = useState<ApocryphaEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const confirmTimer = useRef<number | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    try {
      const page = await fetchApocrypha(API_BASE, cursor);
      setEntries((prev) => (cursor ? [...prev, ...page.entries] : page.entries));
      setNext(page.next);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);
  useEffect(() => () => { if (confirmTimer.current !== null) clearTimeout(confirmTimer.current); }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || submitting) return;
    setSubmitting(true);
    setStatus("");
    try {
      const result = await submitApocrypha(API_BASE, text);
      if ("id" in result) {
        setDraft("");
        setEntries((prev) => [{ id: result.id, text, created_at: Date.now() }, ...prev]);
        setConfirmed(true);
        if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
        confirmTimer.current = window.setTimeout(() => {
          confirmTimer.current = null;
          setConfirmed(false);
        }, 4000);
      } else {
        setStatus(rejectionMessage(result.status));
      }
    } catch {
      setStatus("could not be offered; try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-[60ch] px-6 py-10 font-liturgy">
      <p className="font-machine text-xs tracking-widest text-ink-faded">
        <Link to="/canon" className="no-underline text-ink-faded">THE CANON</Link> · {copy.apocryphaHeading.toUpperCase()}
      </p>
      <h1 className="text-ink text-2xl mt-2 mb-5">{copy.apocryphaHeading}</h1>
      <p className="text-ink mb-10 max-w-[52ch]">{copy.apocryphaIntro}</p>

      <form onSubmit={handleSubmit} className="mb-14 space-y-2">
        <label htmlFor="apocrypha-draft" className="sr-only">{copy.apocryphaPlaceholder}</label>
        <textarea
          id="apocrypha-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
          placeholder={copy.apocryphaPlaceholder}
          maxLength={MAX_LENGTH}
          rows={3}
          disabled={submitting}
          className="w-full max-w-[52ch] border border-ground-aged bg-ground p-3 font-liturgy text-ink disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting || draft.trim().length === 0}
            className="min-h-11 border border-ink px-5 font-machine text-sm text-ink disabled:opacity-45"
          >
            {submitting ? copy.apocryphaSubmitting : copy.apocryphaSubmit}
          </button>
          <span className="font-machine text-xs text-ink-faded">{draft.length}/{MAX_LENGTH}</span>
        </div>
        <p role="status" aria-live="polite" className="min-h-4 font-machine text-xs text-ink-faded">
          {confirmed ? copy.apocryphaReceived : status}
        </p>
      </form>

      {loaded && entries.length === 0 && (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.apocryphaEmpty}</p>
      )}

      <ol className="space-y-6">
        {entries.map((entry) => (
          <li key={entry.id} className="border-t border-ground-aged pt-4">
            <p className="text-ink max-w-[52ch]">{entry.text}</p>
          </li>
        ))}
      </ol>

      {next && (
        <div className="mt-12 text-center">
          <button onClick={() => load(next)} disabled={loading}
            className="font-machine text-xs tracking-widest text-ink-faded disabled:opacity-50">
            {loading ? "…" : copy.apocryphaMore}
          </button>
        </div>
      )}
    </main>
  );
}
