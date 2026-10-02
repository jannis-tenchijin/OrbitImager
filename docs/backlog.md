# Backlog — ideas to implement

**North star:** show how orbit + sensor parameters change *how images are recorded* —
altitude/FOV/IFOV → swath & GSD, and pushbroom vs whiskbroom → *when* each pixel in the swath is acquired.

Format: `- [ ] **Title** — one-line why/what (added YYYY-MM-DD)`

## Next up (imaging core)
- [ ] **Swath footprint on map + globe** — shaded band along the ground track, width from `sensorGeometry().swathKm`. First visible link between parameters and imaging. (2026-10-02)
- [ ] **Parameter panel** — sliders for altitude, IFOV, pixel count (→ FOV), sensor type; HUD already shows derived FOV/GSD/swath. Decide which pair is "primary" (see decisions.md: *Sensor parameterization*). (2026-10-02)
- [ ] **Pushbroom acquisition animation** — a whole cross-track line of pixels lights up at once, rows advance with along-track motion. (2026-10-02)
- [ ] **Whiskbroom instrument model + animation** — rotating scan-mirror drum on the satellite; pixels in a row light up one by one across track (mirror sweep), so each pixel has its own timestamp. (2026-10-02)
- [ ] **Pixel-timing view** — close-up panel/inset showing the swath as a pixel grid colored by acquisition time; makes pushbroom vs whiskbroom difference obvious. (2026-10-02)
- [ ] **Visual pixel downsampling** — real sensors have ~10⁴ pixels across; render a representative subset (e.g. 32–64 "display pixels") and say so in the UI. (2026-10-02)

## Orbit & planet
- [ ] **Editable orbit elements** — altitude, inclination (or "SSO" toggle), LTDN, eccentricity. (2026-10-02)
- [ ] **Planet switcher** — Mars/Moon presets in `PLANETS`; needs per-planet land/texture data and sun model. (2026-10-02)
- [ ] **Multiple satellites** — constellation / phasing comparison. (2026-10-02)
- [ ] **Revisit / coverage calculation** — how many days until an AOI is seen again for a given swath. (2026-10-02)

## Visuals & UX
- [ ] **Day/night terminator on the 2D map** (sun position already computed). (2026-10-02)
- [ ] **AOI markers** — `Globe.addMarker` / `Map2D.addMarker` already exist; add UI + highlight when swath covers an AOI. (2026-10-02)
- [ ] **Off-nadir pointing / roll** — tilt the sensor, swath shifts and GSD degrades toward the edge. (2026-10-02)
- [ ] **Swath edge GSD** — show how pixels stretch off-nadir (bow-tie effect for whiskbroom). (2026-10-02)

## Infra
- [ ] **Vendor Three.js locally** for offline demos (CDN failure = blank page). (2026-10-02)
- [ ] **GitHub Pages deploy** — push repo, enable Pages from `main` / root. Install `gh` (`brew install gh`) first. (2026-10-02)

## Done
- [x] Project scaffold, docs folder, git repo (2026-10-02)
- [x] 3D globe + satellite + orbit line + 2D ground track, time warp, follow cam (2026-10-02)
- [x] Sensor geometry module with tests (FOV/GSD/swath), shown in HUD (2026-10-02)
