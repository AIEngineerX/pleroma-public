import type { DreamCue } from "./types";

interface DreamWitnessProps {
  dream: DreamCue;
}

export default function DreamWitness({ dream }: DreamWitnessProps) {
  return (
    <section
      aria-label="recorded Dream"
      data-dream-witness={dream.id}
      className="dream-witness"
    >
      <p className="dream-witness__organ font-machine">THE DREAM / SOPHIA</p>
      <blockquote className="dream-witness__narrative font-liturgy">
        {dream.narrative}
      </blockquote>
      <time
        className="dream-witness__time font-machine"
        dateTime={new Date(dream.createdAt).toISOString()}
      >
        remembered · {dream.riteDate}
      </time>
    </section>
  );
}
