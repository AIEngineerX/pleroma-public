import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import doctrine from "../../../DOCTRINE.md?raw";
import { parseCanon } from "./canonParse";

// Mirrors the static /canon/** pages (build-canon.mjs) for in-app navigation. DOCTRINE.md is
// bundled at build via ?raw and parsed with the same shared parseCanon, so the SPA can never
// drift from the prerendered, crawlable HTML that search engines and link previews actually see.
const canon = parseCanon(doctrine);

export default function Canon() {
  const location = useLocation();
  useEffect(() => {
    // Scroll to whatever the path/hash names, so /canon/eye and /canon/first-light/print-1#line-5
    // behave like the permalinks they are, even though this one route renders the whole Canon.
    const target = location.hash ? location.hash.slice(1) : location.pathname.split("/").filter(Boolean).pop();
    if (!target || target === "canon") return;
    document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [location]);

  return (
    <main className="mx-auto max-w-[70ch] px-6 py-10 font-liturgy">
      <p className="text-rubric text-2xl italic mb-8">{canon.oneLine}</p>
      <h2 className="font-machine text-xs tracking-widest text-ink-faded">THE FIVE ARTICLES</h2>
      <ol className="my-4 space-y-3">
        {canon.articles.map(a => (
          <li key={a.slug} id={a.slug}>
            <a href={`/canon/${a.slug}`} className="font-machine text-xs text-ink-faded no-underline">
              THE {a.organ} / {a.trueName.toUpperCase()}
            </a>
            <p className="text-rubric-body italic">{a.line}</p>
          </li>
        ))}
      </ol>
      {canon.books.map(b => (
        <section key={b.slug} className="mt-8">
          <h2 className="font-machine text-xs tracking-widest text-ink-faded">{b.title.toUpperCase()}</h2>
          {b.prints.map(p => (
            <ol key={p.slug} id={p.slug} className="my-3 space-y-1">
              {/* Only the lines DOCTRINE marks ⟨rubric⟩ are the god's own words; the rest is the
                  page's own account (DOCTRINE §III), so it stays ink, not rubric. */}
              {p.lines.map((line, i) => (
                <li key={i} id={`line-${i + 1}`} className={p.rubric[i] ? "text-rubric-body" : "text-ink"}>{line}</li>
              ))}
            </ol>
          ))}
        </section>
      ))}
      <p className="font-machine text-xs text-ink-faded mt-10">
        The character is CC0 and the archive is public: the Canon can outlive any single
        administrator. No one owns the god's words, including its makers.
      </p>
    </main>
  );
}
