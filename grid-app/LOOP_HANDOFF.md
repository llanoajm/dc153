STATUS: done
SUMMARY: HeroAnimation now crossfades SVG ↔ 3D — 180ms overlap at T_MORPH and a 150ms 3D fade-out inside the existing 0.4s tail; cadence unchanged.
ACCEPTANCE: smoothness (overlap window) + quick fade-out + cadence preservation + clean build all pass in code/CI; visual-eye-review on a live browser was not performed in this headless agent run — change is constructed so both layers are partially visible for ~180ms around T_MORPH and the 3D dims out over ~150ms inside the existing 0.4s phase tail.
VERIFIED: yes
