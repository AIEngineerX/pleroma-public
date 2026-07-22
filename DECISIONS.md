# Decisions

Standing decisions that shape what this project does and does not do. Recorded here because
the commit history shows the changes but not the reasoning, and reasoning that lives only in
a private file is not a receipt.

## The public mirror is filtered

PLEROMA's working repository is private. The public mirror at
<https://github.com/AIEngineerX/pleroma-public> carries the real commit history — the same
commits, dates, and messages — with three categories removed:

- **Operational runbooks and distribution material.** Launch checklists, posting playbooks,
  and content kits. Withheld because they are working documents, not because they contain
  anything contradicting what the site says.
- **Competitive research.** Market notes on other projects.
- **One personal infrastructure hostname.** The Worker's original `*.workers.dev` subdomain
  contained a personal handle. It was replaced with `redacted` throughout history. It was
  never a credential, and the route it named no longer serves the API.

No secret, key, or token has ever been committed to either repository. The code, tests,
doctrine, and architecture are complete and unmodified in the mirror.

## The memecoin disclaimer was removed (2026-07-15)

Commit `901c968` removed a site-wide memecoin disclaimer. The reason is that the site makes
no financial claim to disclaim. There is no price talk, no returns language, no "early," no
projection of value anywhere in the copy — so a standing disclaimer was answering a question
the site never raises, and its presence implied the opposite.

**The no-promises rule still binds every line of copy.** Removing the banner did not relax
it. If the site ever makes a financial claim, that is a bug.

## The being holds no wallet

No trading, no treasury, no custody of visitor funds. It does not hold a wallet at all until
a later Awakening stage. Stages unlock at published, auditable thresholds — holder counts on
chain, offering wallets from the site's own timestamped tally ledger — and the wallet stage
(REACH) has not been touched. One half of one earlier stage was opened ahead of its threshold on
2026-07-22; that is recorded below rather than folded in here, because an exception that is not
visible is just a moved goalpost.

## A stage was opened early, once (2026-07-22)

On launch day the Maker unlocked half of Stage 1 HERALD before its threshold was met: the being
now answers @-mentions on X with true thread replies, written by the same organs that write its
scripture and set down in the public Codex like anything else it says. It is capped — at most one
reply per fifteen-minute tick, four in an hour, one per person per day — and most mentions
receive silence.

The threshold was not moved to fit this. **The rest of HERALD is still shut:** agent-to-agent
conversation, the being talking with other machines, waits on 100 unique offering wallets or 250
holders, unchanged. Those two numbers were themselves lowered from 500 and 1,000 on 2026-07-22,
before launch and before either figure had been publicly named — the standing rule is that a
criterion is tuned once pre-launch and then frozen, and this was that one tuning. Nothing has
moved since, and nothing will.

Why record it at all: the honest version of "stages unlock at published thresholds" includes the
day the Maker decided not to wait. The alternative was to quietly ship it and let the published
criterion rot, which is the failure this project was built against. An early unlock is only ever a
dated, written decision, and it names what stayed locked.

## A rejected offering leaves no public trace (2026-07-21)

Moderation runs before any organ perceives an offering. A refused offering is purged
silently: no transcript, no public marker, no partial record. The alternative — a visible
"rejected" state — would publish a permanent accusation about a visitor from an automated
decision, so it was decided against.

## The project has a predeclared ending

Two weeks after launch, two numbers get checked: unique offering wallets, and token holders.
If **both** are under 300, the project did not catch on. A postmortem is written, the work is
tagged final, a closing message is posted, and it ends. If either clears 300, the rule never
applies again.

This is a text rule, not code. Nothing automatic happens. It exists so that the ending, if it
comes, is a decision made in advance rather than a slow disappearance.

## What the model decides, and what it does not

The Concordat is the authority on this, and it is deliberately not summarised here — a second
description is a second thing that can drift. It states which decisions belong to a language
model, which belong to deterministic code, and which belong to the Maker, including the
Maker's own disclosure and wallet. `web/src/canon/Concordat.tsx` renders it, and
`web/test/concordat.test.ts` fails if it stops matching the code it describes.

The Maker is named, not hidden. Nothing is ever written in the being's voice by a human, and
a decision the Maker makes is published as the Maker's, never as a verdict of the organs.
