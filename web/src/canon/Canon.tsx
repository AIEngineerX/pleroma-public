import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import doctrine from "virtual:public-doctrine";
import { copy } from "../lib/copy";
import {
  continuousLineId,
  continuousPrintId,
  parseCanon,
  type Canon as CanonData,
} from "./canonParse";

const canon = parseCanon(doctrine);

function Heading({ children }: { children: string }) {
  return <h2 className="font-machine text-xs tracking-widest text-ink-faded">{children.toUpperCase()}</h2>;
}

export function canonScrollTarget(pathname: string, hash: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const pathTarget = segments.at(-1);
  const bookSlug = segments[1];
  const printSlug = segments[2];
  const printPath = segments[0] === "canon" && Boolean(bookSlug) && /^print-\d+$/.test(printSlug ?? "");
  if (hash) {
    const hashTarget = hash.slice(1);
    return printPath ? `${continuousPrintId(bookSlug!, printSlug!)}-${hashTarget}` : hashTarget;
  }
  if (printPath) return continuousPrintId(bookSlug!, printSlug!);
  return !pathTarget || pathTarget === "canon" ? null : pathTarget;
}

export function CanonDocument({ canon }: { canon: CanonData }) {
  return (
    <main className="mx-auto max-w-[70ch] px-6 py-10 font-liturgy">
      <h1 className="font-machine text-xs tracking-widest text-ink-faded mb-4">
        <a href="/" className="no-underline text-ink-faded">THE TEMPLE</a> · {copy.canon.toUpperCase()}
      </h1>
      <p className="text-rubric text-2xl italic mb-8">{canon.oneLine}</p>

      <section className="mt-8 space-y-3">
        <Heading>{copy.emergence}</Heading>
        {canon.emergence.map(paragraph => <p key={paragraph} className="text-ink">{paragraph}</p>)}
      </section>

      <section className="mt-8 space-y-3">
        <Heading>{copy.binding}</Heading>
        {canon.binding.map((paragraph, index) => (
          <p key={paragraph} className={index === canon.binding.length - 1 ? "text-rubric-body italic" : "text-ink"}>
            {paragraph}
          </p>
        ))}
      </section>

      <section className="mt-8">
        <Heading>{copy.articles}</Heading>
        <ol className="my-4 space-y-3">
          {canon.articles.map(article => (
            <li key={article.slug} id={article.slug}>
              <a href={`/canon/${article.slug}`} className="font-machine text-xs text-ink-faded no-underline">
                THE {article.organ} / {article.trueName.toUpperCase()}
              </a>
              <p className="text-rubric-body italic">{article.line}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8 space-y-3">
        <Heading>{copy.offering}</Heading>
        {canon.offering[0] && <p className="text-ink">{canon.offering[0]}</p>}
        <ol className="space-y-2">
          {canon.offering.slice(1, -1).map(item => <li key={item}>{item}</li>)}
        </ol>
        {canon.offering.at(-1) && <p className="text-ink">{canon.offering.at(-1)}</p>}
      </section>

      <section className="mt-8">
        <Heading>{copy.dailyRite}</Heading>
        <ol className="my-4 space-y-2">
          {canon.rite.map(step => (
            <li key={step.name}>
              <strong>{step.name}</strong> {step.text}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <Heading>{copy.prints}</Heading>
        {canon.books.map(book => (
          <article key={book.slug} className="mt-5">
            <h3 className="font-machine text-xs tracking-widest text-ink-faded">{book.title.toUpperCase()}</h3>
            {book.prints.map(print => (
              <div key={print.slug} id={continuousPrintId(book.slug, print.slug)} className="my-4">
                <h4 className="font-machine text-xs text-ink-faded">
                  <a href={`/canon/${book.slug}/${print.slug}`}>PRINT {print.n}</a>
                </h4>
                <ol className="mt-2 space-y-1">
                  {print.lines.map((line, index) => (
                    <li key={index} id={continuousLineId(book.slug, print.slug, index + 1)} className={print.rubric[index] ? "text-rubric-body" : "text-ink"}>
                      {line}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </article>
        ))}
      </section>

      <section className="mt-8">
        <Heading>{copy.lexicon}</Heading>
        <dl className="my-4 space-y-3">
          {canon.lexicon.map(term => (
            <div key={term.name}>
              <dt className="font-semibold">{term.name}</dt>
              <dd>{term.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8 space-y-2">
        <Heading>{copy.dreamArchive}</Heading>
        <a href="/canon/dreams" className="font-machine text-xs underline text-ink-faded">{copy.dreams}</a>
      </section>

      <p className="font-machine text-xs text-ink-faded mt-10">
        The character is CC0 and the archive is public: the Canon can outlive any single
        administrator. No one owns the god's words, including its makers.
      </p>
      <nav aria-label="Canon doorways" className="mt-6 flex flex-wrap gap-5 font-machine text-xs text-ink-faded">
        <a href="/">{copy.returnTemple}</a>
        <a href="/canon/dreams">{copy.dreams}</a>
        <a href="/concordat">{copy.concordatDoorway}</a>
      </nav>
    </main>
  );
}

export default function Canon() {
  const location = useLocation();
  useEffect(() => {
    const target = canonScrollTarget(location.pathname, location.hash);
    if (!target) return;
    document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [location]);

  return <CanonDocument canon={canon} />;
}
