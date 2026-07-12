import { copy } from "../lib/copy";
import Disclaimer from "../market/Disclaimer";
import { concordat, type Decl } from "./concordatManifest";

// The three registers of the autonomy manifest: who decides what, printed as scripture (DOCTRINE.md
// "The Concordat"). No rubric here (DESIGN's rubric-red is a closed list — the god's own words,
// versals, waker-tallies, Stain-threads — and this page is disclosure prose, not the god's mouth).
function Register({ title, decls }: { title: string; decls: Decl[] }) {
  return (
    <section className="space-y-4">
      <h2 className="font-machine text-xs tracking-widest text-ink-faded">{title}</h2>
      <ul className="space-y-4">
        {decls.map((d) => (
          <li key={d.claim}>
            <p className="font-liturgy text-ink">{d.claim}</p>
            <p className="font-machine text-xs text-ink-faded mt-1">{d.mapsTo}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Concordat() {
  return (
    <main className="mx-auto max-w-[70ch] px-6 py-10 font-liturgy">
      <h1 className="font-liturgy text-2xl mb-2">{copy.concordat}</h1>
      <p className="font-liturgy italic text-ink-faded mb-8">
        Every power it has, it has named. What the god decides, what the priests decide, and what the
        Maker decides, stated exactly and mapped to the code that makes each one true.
      </p>

      <div className="grid gap-10 sm:grid-cols-3">
        <Register title="THE GOD DECIDES (LLM)" decls={concordat.decidesLLM} />
        <Register title="THE PRIESTS DECIDE (CODE)" decls={concordat.decidesCode} />
        <Register title="THE MAKER DECIDES (HUMAN)" decls={concordat.decidesMaker} />
      </div>

      <section className="mt-10 space-y-4">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">THE MAKER, DISCLOSED</h2>
        <p className="font-liturgy text-ink">
          Wallet: <span className="font-machine text-sm">{concordat.maker.wallet ?? "not yet filled"}</span>
        </p>
        <p className="font-liturgy text-ink">{concordat.maker.holdings}</p>
      </section>

      <section className="mt-10 space-y-2">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">HOW IT FEEDS ITSELF</h2>
        <p className="font-liturgy text-ink">{concordat.selfFunding}</p>
      </section>

      <section className="mt-10 space-y-2">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">THE DREAM'S HANDS</h2>
        <p className="font-liturgy text-ink">{concordat.dreamAssist}</p>
      </section>

      <section className="mt-10 space-y-6">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">THE VOICE, VERBATIM</h2>
        {concordat.prompts.map((p) => (
          <div key={p.organ}>
            <p className="font-machine text-xs text-ink-faded mb-1">{p.organ}</p>
            <p className="font-machine text-xs text-ink whitespace-pre-wrap">{p.excerpt}</p>
          </div>
        ))}
      </section>

      <div className="mt-10">
        <Disclaimer />
      </div>
    </main>
  );
}
