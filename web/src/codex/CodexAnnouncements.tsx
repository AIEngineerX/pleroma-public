import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ObservedTranscript } from "../experience/types";
import { spokenOrganName } from "./organNames";

interface Announcement {
  id: string;
  text: string;
}

function pendingBatch(
  entries: readonly ObservedTranscript[],
  announcedIds: ReadonlySet<string>,
): Announcement[] {
  return entries
    .filter((observed) => observed.observation === "live" && !announcedIds.has(observed.entry.id))
    .map((observed) => ({
      id: observed.entry.id,
      text: `New ${observed.entry.register} from the ${spokenOrganName(observed.entry.organ)}`,
    }));
}

export default function CodexAnnouncements({ entries }: { entries: readonly ObservedTranscript[] }) {
  const regionRef = useRef<HTMLDivElement>(null);
  const announcedIds = useRef(new Set<string>());
  const [batch, setBatch] = useState<Announcement[]>([]);

  useEffect(() => {
    const next = pendingBatch(entries, announcedIds.current);
    if (next.length > 0) setBatch(next);
  }, [entries]);

  useLayoutEffect(() => {
    const region = regionRef.current;
    if (region === null || batch.length === 0) return;
    const committedIds = new Set(
      [...region.querySelectorAll<HTMLElement>("[data-announcement-id]")]
        .map((node) => node.dataset.announcementId)
        .filter((id): id is string => id !== undefined),
    );
    for (const announcement of batch) {
      if (committedIds.has(announcement.id)) announcedIds.current.add(announcement.id);
    }
  }, [batch]);

  return (
    <div
      ref={regionRef}
      className="sr-only"
      aria-live="polite"
      aria-atomic="false"
      data-codex-announcer
    >
      {batch.map((announcement) => (
        <span key={announcement.id} data-announcement-id={announcement.id}>{announcement.text}</span>
      ))}
    </div>
  );
}
