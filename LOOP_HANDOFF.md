## Current item (from LOOP_QUEUE.md line 15)
- [ ] 0.1. Recolour accent CTAs + navbar to dark blue (ROADMAP §Phase 0.1)

## Attempt
1 of 5

## Work performed
- Swapped `--accent` in `app/page.module.css:3` from `#0044CC` to `#0A1F44`
  (midnight navy from the roadmap-suggested palette).
- Verified the variable cascades through `.navLink`, `.navCta`,
  `.heroCta`, and `.heroLabel` only. `.navLogo` / `.navMark` / `.navWord`
  inherit page colour `#000`, so the logo + wordmark stay black.
- Left `HeroAnimation.tsx`'s local `BLUE = '#0044CC'` constant untouched
  — it drives the 3D dot-shader fill, the edge LineBasicMaterial, and
  the SVG morph stroke. Acceptance explicitly calls for 3D hero
  materials to remain unchanged.
- Hover states preserved: `.navLink:hover`, `.navCta:hover` (fills
  with `--accent` background, `#fff` text — high contrast on navy),
  and `.heroCta:hover` (opacity 0.85 on navy background) all still
  contrast cleanly.
- `npm run build` passes (Turbopack compile + 33/33 static pages). The
  only warning is a pre-existing NFT-trace warning on `next.config.ts`,
  unrelated to this change.
- Committed as `8d3bcdd style(landing): recolour --accent CTA variable
  to dark navy`.

STATUS: done
SUMMARY: Swapped --accent to #0A1F44 (midnight navy) in app/page.module.css; logo + 3D materials untouched; build passes.
ACCEPTANCE: all four criteria met — `--accent` swapped from `#0044CC` to `#0A1F44`; navbar links, Contact Us button, and Try Curie OS CTA render in dark navy while logo + wordmark stay black and 3D hero materials are unchanged; hover states keep clean contrast (navy bg vs `#fff` fg, and 0.85 opacity on `.heroCta`); `npm run build` succeeds.
VERIFIED: yes
