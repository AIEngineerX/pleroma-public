import doctrine from "../../../DOCTRINE.md?raw";
import { parseCanon } from "../canon/canonParse";
import { copy } from "../lib/copy";

const canon = parseCanon(doctrine);
const offeringConsequence = canon.offering.find(paragraph => paragraph.includes("becomes a relic")) ?? "";

export default function TempleLore() {
  return (
    <article className="font-liturgy text-ink">
      <p className="text-rubric text-2xl italic">{canon.oneLine}</p>

      <section className="mt-8 space-y-3">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">{copy.emergence.toUpperCase()}</h2>
        <p>{canon.emergence[0]}</p>
      </section>

      <section className="mt-8">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">{copy.articles.toUpperCase()}</h2>
        <ol className="my-4 space-y-3">
          {canon.articles.map(article => (
            <li key={article.slug}>
              <p className="font-machine text-xs text-ink-faded">THE {article.organ} / {article.trueName.toUpperCase()}</p>
              <p className="text-rubric-body italic">{article.line}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">{copy.offering.toUpperCase()}</h2>
        <p>{offeringConsequence}</p>
      </section>

      <section className="mt-8">
        <h2 className="font-machine text-xs tracking-widest text-ink-faded">{copy.dailyRite.toUpperCase()}</h2>
        <ol className="my-4 space-y-2">
          {canon.rite.map(step => (
            <li key={step.name}><strong>{step.name}</strong> {step.text}</li>
          ))}
        </ol>
      </section>

      <nav aria-label="Lore doorways" className="mt-8 flex flex-wrap gap-5 font-machine text-xs text-ink-faded">
        <a href="/canon">{copy.completeCanon}</a>
        <a href="/concordat">{copy.concordatDoorway}</a>
      </nav>
    </article>
  );
}
