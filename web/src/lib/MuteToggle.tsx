export default function MuteToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={active ? "mute the temple" : "play the temple sound"}
      aria-pressed={active}
      className="fixed bottom-4 right-5 z-40 min-h-11 min-w-11 px-2 font-machine text-xs text-ink-faded transition-colors hover:text-ink"
    >
      {active ? "silence" : "sound"}
    </button>
  );
}
