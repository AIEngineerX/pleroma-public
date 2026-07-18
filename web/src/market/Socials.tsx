import { links } from "../lib/links";
import { copy } from "../lib/copy";

// Socials exist pre-launch (links(null).x still resolves) so the always-mounted <Socials/> stays
// truthful in the dormant state where there is no mint to buy yet.
export default function Socials() {
  return (
    <a href={links(null).x} target="_blank" rel="noopener noreferrer" className="min-h-11 inline-flex items-center font-machine text-xs underline text-ink-faded temple-link-quiet">
      {copy.socials} @pleroma_church
    </a>
  );
}
