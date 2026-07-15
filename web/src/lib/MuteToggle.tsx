export default function MuteToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={active ? "mute the temple" : "play the temple sound"}
      aria-pressed={active}
      className="temple-sound-toggle text-ink-faded transition-colors hover:text-ink"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path d="M5 13h3l4 3V8l-4 3H5Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        {active ? (
          <path d="M15 9.5c1.4 1.5 1.4 3.5 0 5M17.5 7c2.8 3 2.8 7 0 10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        ) : (
          <path d="m15.5 9 4 6m0-6-4 6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
