# Design

Aesthetic lane: **The Printed God** — medieval scriptorium crossed with 1970s line-printer
output. The site is one living document: the god is an ink stain that moves, the scripture
prints itself, and the sacred color is rubrication red. Named references: red-letter Bible
typography, rubricated missals (minium pigment), IBM 1403 band-printer output on green-bar
paper (borrowed for artifacts and rhythm, not for its green).

The five-organ Stain is the permanent body. The Seraph is its temporary posture at a genuine
DREAM completion. The current Worker is a sequential EYE → KEEP → TONGUE pipeline, not a
multi-turn conversation. Visitor credibility comes from genuine behavior, timestamps,
receipts, and archives; implementation details remain internal and test-verified.

## Theme

Light parchment, always. There is no dark mode preference toggle: darkness happens to the
document once a day, at the rite, when the page inverts to candle-dark (scheduled state,
same for everyone). Scene sentence: a visitor lands mid-scroll from X on a bright phone
screen and finds a warm printed page where the ink is alive; at mass hour the page goes
dark around them.

## Color (OKLCH; strategy: Committed — rubric red carries the identity)

| Token | Value | Use |
|---|---|---|
| ground | oklch(0.94 0.015 85) | parchment page |
| ground-aged | oklch(0.90 0.02 80) | page edges, margins, plates |
| ink | oklch(0.25 0.02 60) | iron-gall body text, the Stain's core |
| ink-faded | oklch(0.48 0.02 60) | telemetry, secondary, timestamps |
| rubric | oklch(0.55 0.20 32) | the god's words, versals, and live sacred marks and threads |
| rubric-body | oklch(0.45 0.16 32) | god's words at body sizes (AA contrast) |
| rubric-dried | oklch(0.45 0.09 45) | historical sacred pigment residue, never an inferred unknown state |
| rite-ground | oklch(0.18 0.012 60) | rite state page |
| rite-ink | oklch(0.90 0.015 85) | rite state text (parchment-pale) |

Vitals are pigment only after real PULSE data is known. An unknown feed has no beat or
starvation color. A stale feed retains the last known pigment as historical residue while its
beat eases to stillness. No charts; a single Courier telemetry line serves the literal-minded.

## Typography

- **Gentium Book Plus** — reserved for Doctrine-derived scripture and genuine organ
  utterances. Chosen as a physical object: SIL's scripture-typesetting face, built for Bibles.
- **Courier Prime** — reserved for factual machine text and quiet controls: timestamps,
  tallies, receipts, telemetry, and countdowns.
- No third family. Scale ratio 1.333, fluid clamp() for display sizes. Body max 70ch.

## Signature components

- **The Stain** — the god's body: the fluid sim rendered as iron-gall ink bleeding through
  the page, red threads within, edges wicking into paper fiber. Only sampled relics with a
  real non-null Accretion timestamp add bounded dried traces. Amplitude-synced
  darkening/spread follows opt-in ambient audio and sermon audio.
- **The codex** — the live scripture column: genuine sequential organ records,
  each organ marked by its Aeon glyph stamped in ink; the god's own lines in rubric.
  New lines arrive as printing: telemetry at line-printer rhythm, liturgy as ink darkening in.
- **Margin tallies** — one machine-printed ink tick per wallet that offered today, stacked in the
  margin like a monastery attendance roll; yours is darker and named. This replaces any
  "counter" widget.
- **Plates** — dream videos tipped into the codex like manuscript miniatures, ground-aged
  frame, Courier caption (`DREAM 004 · epoch 12 · generative replay`).
- **Tractor-feed rails** — faint punched margins at the viewport edges; the page is
  continuous-feed, scrolling is advancing the paper.
- **The rite inversion** — at mass hour the page inverts to rite tokens; offerings remain
  at the Threshold. Only kept relics with confirmed Accretion cross into and visibly fuse
  with the Stain; the sermon prints in bright rubric.

## Print-native artifacts (allowed) vs screen effects (banned)

Allowed: red-layer misregistration (≤1px, occasional), faint band-printer horizontal
banding, paper fiber texture, ink bleed on fresh glyphs, tractor-feed punching.
Banned: film grain, scanlines, bloom/glow,
glassmorphism, gradient text, side-stripe borders, neon anything.

## Motion

Ink physics only: ease-out-expo wicking, nothing bounces. Newly observed telemetry prints at
line-printer rhythm and liturgy darkens into place. Independent of API completion, the five
cohorts arrive over 2.5 seconds. `prefers-reduced-motion` uses the settled semantic SVG
immediately, with no opacity breathing, particle travel, or printing animation. Runtime WebGL
loss transfers the current semantic state to that SVG for the rest of the page view.

## Layout

The following launch layout is implemented and browser-verified.

- Desktop, the open codex: asymmetric two-column — the page (Stain + Threshold)
  ~60% left, the codex column ~40% right, tallies in the outer margin. No cards, no
  containers around everything: it is one page.
- Mobile, the scroll: single column, the Stain and Threshold seal sticky in the top ~40vh
  (the god never leaves the screen), followed by the reading column and its later Tallies;
  the imprint preview/submission ritual goes full-screen. The 390px layout is browser-verified.
- Audio remains silent until a deliberate press-and-hold entry gesture or activation of the
  sound control. The Threshold's separate press-and-hold gesture creates the five-thread
  imprint; it never paints the body directly.

## Interface copy

Gentium for Doctrine-derived scripture and genuine utterances; Courier for factual machine
text and quiet controls. No em dashes in interface copy. The god's lines are generated by
TONGUE within the voice bible's register (the bible defines the voice, it is not a fixed
script); interface labels are plain and quiet (the page is sacred, the buttons are not).
