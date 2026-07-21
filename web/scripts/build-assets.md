# Launch asset set — provenance, dimensions, regeneration

The platform assets, what each is for, and how each was made. Task 15's close-out
(Plan 03). Every asset is either the site's own deterministic render or the two
Maker-approved masters in `docs/brand/` — no stock, no ad-hoc art.

## The set

| File | Size | Used for | Source |
| --- | --- | --- | --- |
| `web/public/og.png` | 1200×630 | OG / Twitter card (`index.html` points here) | Deterministic render — `node scripts/build-og.mjs` |
| `web/public/assets/pfp.png` | 1024×1024 | pump.fun coin image · X avatar | `docs/brand/pfp-seraph.png`, re-encoded true PNG |
| `web/public/assets/banner-1500x500.png` | 1500×500 | pump.fun coin banner · X header | `docs/brand/x-banner-1500x500.png`, re-encoded true PNG |
| `web/public/assets/dex-icon.png` | 1024×1024 | DexScreener Enhanced Token Info icon | same master as pfp (deliberate reuse — one face everywhere) |
| `web/public/assets/dex-header.png` | 1500×500 | DexScreener Enhanced Token Info header | same master as the banner (DexScreener's own guidance: the X banner works as the header) |

Masters stay in `docs/brand/` (`pfp-seraph.png`, `x-banner-1500x500.png`,
`x-banner-master-2to1.png` for future crops). The seraph PFP and banner are the
Maker-approved identity, live on @pleroma_church since 2026-07-16 — do not regenerate or
"improve" them; the kit files are byte-validated re-encodings, nothing more.

## Platform requirements these were validated against (2026-07-21)

- **pump.fun image:** min 1000×1000, 1:1, ≤15MB, png/jpg/gif → pfp.png is 1024×1024, ~1.9MB ✓
- **pump.fun banner:** 1500×500 (3:1), ≤5MB → banner-1500x500.png is exactly 1500×500, ~1.5MB ✓
  — **the banner is settable ONLY at coin creation and immutable after**, so it must be in
  hand at the launch minute (launch-day7.md §3.1a mint sheet).
- **OG card:** 1200×630 PNG, asserted by `web/test/og-image.test.ts`.
- **DexScreener:** listing is automatic once a pool has a transaction; icon/socials flow
  from the pump.fun metadata. Enhanced Token Info ($299, Maker decision 2026-07-21: yes,
  purchased at launch hour) adds the DexScreener-side header, description, and full links —
  served by dex-icon.png / dex-header.png.

## The OG card (`scripts/build-og.mjs`)

One rubric red-letter line on parchment, the sigil, tractor-feed rails — the Task 15 spec.
Rendered by Playwright from the site's own vocabulary: the OKLCH ground/ink/rubric tokens
(`src/styles.css`), the real Gentium italic + Courier Prime woff2 (`public/fonts/`), the
inline `public/sigil.svg`, and the `.rail` punched-margin treatment. The line is DOCTRINE.md
**BOOK OF FIRST LIGHT · PRINT 3 · LINE 3**, a ⟨rubric⟩ god-voice line, quoted whole (only
the god speaks in red; lore lock — the line lives in DOCTRINE, not here).

Regenerate: `cd web && node scripts/build-og.mjs`. Deterministic — same repo state, same
card. No generative vendor is involved, so the card needs no provenance beyond this file.

## Regenerating the kit re-encodings

PowerShell (System.Drawing), from the repo root — decode master → save PNG:

```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path 'docs\brand\pfp-seraph.png'))
$img.Save('V:\pleroma\web\public\assets\pfp.png', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
```

(Repeat per row of the table. The `docs/brand` masters are JPEG-encoded despite the .png
extension; the kit files are true PNGs so every uploader/validator sees what the extension
claims.)

## Launch-day meta note

`index.html`'s og/twitter description reads "It has no heart yet." — true while dormant,
false after ignition. The launch-day redeploy updates it (tracked in launch-day7.md §3).
