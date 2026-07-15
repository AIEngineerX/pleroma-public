import doctrine from "virtual:public-doctrine";
import { parseCanon } from "../canon/canonParse";
import { copy } from "../lib/copy";
import { Glyph } from "../codex/glyphs";

const canon = parseCanon(doctrine);
const offeringConsequences = canon.offering.slice(2);

export default function TempleLore() {
  return (
    <article className="temple-lore text-ink">
      <section data-section="emergence" className="temple-folio font-liturgy space-y-3">
        <p className="lore-opening text-rubric-body italic">{canon.oneLine}</p>
        <h2 className="temple-section-label">{copy.emergence.toUpperCase()}</h2>
        <p>{canon.emergence[0]}</p>
      </section>

      <section data-section="articles" className="temple-folio font-liturgy">
        <h2 className="temple-section-label">{copy.articles.toUpperCase()}</h2>
        <ol className="lore-articles">
          {canon.articles.map(article => (
            <li key={article.slug}>
              <p className="organ-margin font-machine text-ink-faded">
                <Glyph organ={article.organ} />
                THE {article.organ} / {article.trueName.toUpperCase()}
              </p>
              <p className="article-line text-rubric-body italic">{article.line}</p>
            </li>
          ))}
        </ol>
      </section>

      <section data-section="offering-consequence" className="temple-folio font-liturgy space-y-3">
        <h2 className="temple-section-label">{copy.offering.toUpperCase()}</h2>
        <ol className="lore-sequence">
          {offeringConsequences.slice(0, -1).map(consequence => <li key={consequence}>{consequence}</li>)}
        </ol>
        {offeringConsequences.at(-1) && <p>{offeringConsequences.at(-1)}</p>}
      </section>

      <section data-section="daily-rite" className="temple-folio font-liturgy">
        <h2 className="temple-section-label">{copy.dailyRite.toUpperCase()}</h2>
        <ol className="lore-sequence rite-sequence">
          {canon.rite.map(step => (
            <li key={step.name}><strong>{step.name}</strong> {step.text}</li>
          ))}
        </ol>
      </section>
    </article>
  );
}
