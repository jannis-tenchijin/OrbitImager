# Backlog — ideas to implement

**North star:** show how orbit + sensor parameters change *how images are recorded* —
altitude/FOV/IFOV → swath & GSD, and pushbroom vs whiskbroom → *when* each pixel in the swath is acquired.

Format: `- [ ] **Title** — one-line why/what (added YYYY-MM-DD)`

## Next up (imaging core)
- [ ] **Pixel-timing view** — close-up colored by acquisition time; makes pushbroom vs whiskbroom difference obvious. (2026-10-02)
- [ ] **Bow-tie effect** — whiskbroom pixels grow off-nadir so consecutive sweeps overlap at the swath edge (MODIS-style). (2026-10-02)
- [ ] **Revisit statistics per AOI** — from a recording: how often and at what local time each AOI was seen clear. (2026-10-02)
- [ ] **Cloud-free composite** — over several cycles, show where at least one clear look exists. (2026-10-02)
- [ ] **Band selection per instrument** — e.g. OLI pan 15 m, MSI 20/60 m, SGLI 1 km channels. (2026-10-02)
- [ ] **Revisit heatmap** — color the map by images per place (or days between usable images) from a recording. (2026-10-02)
- [ ] **Agility / slew limits for tasked imaging** — SatVu currently images every target in reach; real slew time limits back-to-back targets. (2026-10-02)
- [ ] **Left-looking SAR toggle + InSAR repeat-pass hint** — ALOS can look left; show repeat-cycle geometry. (2026-10-02)
- [ ] **LTDN slider** — explore dawn-dusk vs 10:30 vs noon orbits (presets already set it). (2026-10-02)
- [ ] **Edge-GSD visualization** — show pixel stretch toward swath edge (bow-tie for whiskbroom); tile already shows `GSD edge`. (2026-10-02)

## Orbit & planet
- [ ] **Editable orbit elements** — altitude, inclination (or "SSO" toggle), LTDN, eccentricity. (2026-10-02)
- [ ] **Planet switcher** — Mars/Moon presets in `PLANETS`; needs per-planet land/texture data and sun model. (2026-10-02)
- [ ] **Multiple satellites** — constellation / phasing comparison. (2026-10-02)
- [ ] **Revisit / coverage calculation** — how many days until an AOI is seen again for a given swath. (2026-10-02)
- [ ] **Yaw steering toggle** — rotate the scan line to compensate Earth rotation (swath currently uses the inertial cross-track axis, see decisions.md). (2026-10-02)

## Visuals & UX
- [ ] **Day/night terminator on the 2D map** (sun position already computed). (2026-10-02)
- [ ] **AOI markers** — `Globe.addMarker` / `Map2D.addMarker` already exist; add UI + highlight when swath covers an AOI. (2026-10-02)
- [ ] **Off-nadir pointing / roll** — tilt the sensor, swath shifts and GSD degrades toward the edge. (2026-10-02)
- [ ] **Close-up from real location** — sample the actual ground under the satellite instead of the synthetic scene (needs real land-cover / LST tiles). (2026-10-02)

## Infra
- [ ] **Vendor Three.js locally** for offline demos (CDN failure = blank page). (2026-10-02)
- [ ] **GitHub Pages deploy** — push repo, enable Pages from `main` / root. Install `gh` (`brew install gh`) first. (2026-10-02)

## Done
- [x] Project scaffold, docs folder, git repo (2026-10-02)
- [x] 3D globe + satellite + orbit line + 2D ground track, time warp (2026-10-02)
- [x] Sensor geometry module with tests (FOV/GSD/swath) (2026-10-02)
- [x] Thermal (TIRS-like) / Visual (OLI-like) presets + FOV slider, focal-length model (2026-10-02)
- [x] Swath band on map + globe, FOV fan + scan line (2026-10-02)
- [x] Pixel close-up: synthetic scene, ground truth vs recorded at GSD (2026-10-02)
- [x] LTDN fixed to mean solar time (10:30 year-round), Local time + LTDN tiles (2026-10-02)
- [x] View modes: Space / Earth / Satellite (2026-10-02)
- [x] Record mode: swaths accumulate until back at start / circled globe, coverage stats (2026-10-02)
- [x] Drifting, evolving clouds; swath cells recorded under cloud marked unusable (2026-10-02)
- [x] Visual records only in daylight; thermal day + night (2026-10-02)
- [x] Pushbroom row-by-row and whiskbroom sweep + calibration animation in the close-up (2026-10-02)
- [x] Whiskbroom scan type: rotating mirror model, 3D beam, timing tiles, wider FOV limit (2026-10-02)
- [x] No-cache dev server `serve.py` (2026-10-02)
- [x] Satellite presets: Landsat 8/9, GCOM-C, Sentinel-1/2, constellr, SatVu, ALOS-2/4 (+ Custom) (2026-10-02)
- [x] SAR sensor class (side-looking, modes, speckle close-up, sees through clouds) (2026-10-02)
- [x] Framing scan type (SatVu) (2026-10-02)
- [x] Altitude slider with SSO re-targeting (2026-10-02)
- [x] Record until Stop (hold + Clear), big Record button, 10000× warp (2026-10-02)
- [x] Record button moved into the Results card; map REC badge removed (duplicate stats); 50k× warp (2026-10-02)
- [x] Results card: Earth covered %, usable %, pick a place → images / cloudy / 1 image every X days (2026-10-02)
- [x] SatVu tasked imaging of 80 cities (no strip), framing pyramid in 3D, periodic close-up (2026-10-02)
- [x] One-window layout without page scrollbar (Orbit + Results under the 3D view) (2026-10-02)
