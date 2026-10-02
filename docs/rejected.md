# Rejected ideas

Things we considered and dropped. Format: `## Title (YYYY-MM-DD)` + **Why rejected** + optional **Revisit if**.

## Vite / npm build pipeline (2026-10-02)
**Why rejected:** Node isn't installed on the dev machine, and a build step is one more thing to break during the event. Plain ES modules + importmap run directly from `python3 -m http.server` and deploy to GitHub Pages unchanged.
**Revisit if:** we need npm-only packages or TypeScript.

## Python backend (Flask/FastAPI) for orbit math (2026-10-02)
**Why rejected:** GitHub Pages only serves static files. Orbit/sensor math is cheap enough to run per frame in the browser.
**Revisit if:** we need heavy processing (e.g. real satellite imagery tiles, SGP4 on thousands of objects).

## Photorealistic Earth textures (Blue Marble etc.) (2026-10-02)
**Why rejected:** Goal is "visually appealing, not realistic". A stylized painted texture from vector land data is lighter (545 KB), shares one painter with the 2D map, and keeps focus on the imaging geometry.

## Naive canvas fill of world-atlas polygons (2026-10-02)
**Why rejected:** The TopoJSON uses d3's *spherical* polygon convention — Chukotka, Fiji and Antarctica cross ±180°, and Antarctica wraps the pole. Filling raw lon/lat rings smears horizontal streaks across the map. We use `d3-geo` projection + clipping instead (see decisions.md).

## Real-scale satellite model (2026-10-02)
**Why rejected:** A ~5 m satellite at 700 km altitude is sub-pixel at any useful zoom. Model is exaggerated on purpose (see decisions.md).
