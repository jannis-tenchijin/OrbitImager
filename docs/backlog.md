# Backlog — ideas to implement

**North star:** show how orbit + sensor parameters change *how images are recorded* —
altitude/FOV/IFOV → swath & GSD, and pushbroom vs whiskbroom → *when* each pixel in the swath is acquired.

Format: `- [ ] **Title** — one-line why/what (added YYYY-MM-DD)`

## Next up (imaging core)
- [ ] **Pushbroom row-by-row fill in the close-up** — recorded image builds up one full cross-track row at a time as the scan line passes. (2026-10-02)
- [ ] **Whiskbroom instrument model + animation** — rotating scan-mirror drum on the satellite; pixels in a row light up one by one across track (mirror sweep), so each pixel has its own timestamp. (2026-10-02)
- [ ] **Pixel-timing view** — close-up colored by acquisition time; makes pushbroom vs whiskbroom difference obvious. (2026-10-02)
- [ ] **Visual sensor records only in daylight** — thermal records day + night (LST night passes at 22:30 LTAN); visual swath should be blank on the night side. (2026-10-02)
- [ ] **Altitude slider** — same panel as FOV; altitude changes swath *and* GSD together. Needs orbit re-creation on change. (2026-10-02)
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
