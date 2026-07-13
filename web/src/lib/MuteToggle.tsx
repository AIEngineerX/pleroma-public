// The one honest audio control: a fixed, unobtrusive Courier toggle. Sound is opt-in via the wake gesture,
// so this mostly serves the reader who wants silence back. Sits inside the tractor rail, in thumb reach.
export default function MuteToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={muted ? "unmute the temple" : "mute the temple"}
      aria-pressed={muted}
      className="fixed bottom-4 right-5 z-40 font-machine text-[0.6rem] tracking-[0.3em] text-ink-faded/70 hover:text-ink transition-colors"
    >
      {muted ? "SILENT" : "SOUND"}
    </button>
  );
}
