# Decisions — good ideas that need explanation

Read this before refactoring. Each entry: **What**, **Why**, **Breaks if**.

## Coordinate frames & axis mapping (2026-10-02)
**What:** Physics runs in ECI (km, Z = north pole). Three.js is Y-up, so `toScene()` in `js/scene/globe.js` maps ECI `(x, y, z)` → scene `(x, z, −y)` / 1000.
With this mapping a stock `SphereGeometry` + equirectangular texture (lon −180→180 left→right) already lines up with the planet-fixed frame — no texture offset needed. The planet group rotates about scene Y by the rotation angle (GMST for Earth).
**Why:** One mapping function, zero magic offsets.
**Breaks if:** you change the axis mapping, flip the texture, or rotate the planet mesh independently of `planetGroup`. Verify with the Tokyo check: `__app.globe.addMarker(35.68, 139.69, 0xff00ff)` must sit on Tokyo.

## Satellite + orbit line are inertial; ground trail + clouds are planet-fixed (2026-10-02)
**What:** Satellite, orbit ellipse, nadir line, sub-point ring live in the scene root (ECI). The draped ground trail, clouds and markers are children of `planetGroup` and get their rotation for free.
**Breaks if:** you parent the ground trail to the scene root (it will slide across the surface).

## Planet is a parameter (2026-10-02)
**What:** `orbit.js` / `time.js` / `sensor.js` take a `planet` object (`radiusKm`, `mu`, `J2`, `siderealDayS`, `tropicalYearS`, `primeMeridianJ2000Deg`). No Earth constants are hard-coded in physics.
**Exception:** `sunEci()` is Earth-specific (Almanac formula). Planet switching needs a per-planet sun model.

## Sun-synchronous default is computed, not typed (2026-10-02)
**What:** `inclinationDeg: null` → `sunSyncInclination()` (≈ 98.19° at 700 km). J2 secular drift (RAAN, arg. of perigee, mean motion) is applied. The sat starts at the descending node (M = 180°) so the first pass is in daylight.
**Breaks if:** you remove the J2 terms — at high time warp the orbit stops tracking the sun.

## LTDN is MEAN solar time (2026-10-02)
**What:** RAAN = `meanSunRa(epoch)` + (LTAN − 12 h)·15°, with LTAN = LTDN + 12 h. Local time shown in the HUD is `meanLocalTime()` = UTC + lon/15.
**Why:** SSO planes precess at the *mean* sun rate, and mission LTDN/LTAN values are quoted in mean solar time. The first version used the *apparent* sun, so the node read ~10:20 (UTC + lon/15) in October and drifted ±16 min over the year (equation of time).
**Breaks if:** someone swaps back to `sunEci().ra`. Test: *"LTDN = 10:30 mean solar time … in every season"*.

## Sensor model: fixed detector array, FOV slider = focal length (2026-10-02)
**What:** `SENSOR_PRESETS` store the *hardware*: pixel count N, detector pitch p, native IFOV. The FOV slider changes the focal length, so
`IFOV = FOV/N`, `f = p/IFOV`, `GSD = h·IFOV`, `swath = 2R·(asin((R+h)/R·sin(FOV/2)) − FOV/2)`. All derived in `sensorGeometry()`.
Presets are Landsat 8/9-like: thermal ≈ TIRS (1850 px, 25 µm, 142.5 µrad → ~100 m), visual ≈ OLI (6200 px, 36 µm, 42.6 µrad → ~30 m). Both give ~186 km swath at native FOV, so switching shows *same swath, different resolution*.
**Why:** Decided with Jannis: changing FOV must change resolution while the focal-plane array stays the same. Wider FOV → wider swath *and* coarser pixels; pixels always touch (no gaps).
**Breaks if:** someone stores `swathKm`, `fovDeg` or `gsd` in config, or keeps IFOV fixed while FOV changes (contradiction: FOV = N·IFOV).

## Swath edges use the inertial cross-track axis (2026-10-02)
**What:** `swathTrack()` / `swathEdgesEci()` place edges at `cos λ·r̂ ± sin λ·n̂` (n̂ = orbit normal), i.e. perpendicular to the orbit plane, which is how a nadir-pointing, non-yaw-steered instrument sees. Earth rotation makes the scan line slightly skewed vs. the ground track — real, not a bug.
**Breaks if:** edges are computed perpendicular to the *ground track* instead; then yaw steering is implied without being modeled (see backlog).

## Swath rendering details (2026-10-02)
**What:** Map: past swath is one path of per-segment quads filled once (no alpha seams); antimeridian quads are drawn at ±360°; quads spanning > 90° lon (edge over a pole at huge FOV) are skipped. Globe: swath strip has 8 subdivisions across so wide swaths hug the sphere instead of cutting through it.
**Breaks if:** you fill each quad separately (visible seams) or drop the cross subdivisions (strip disappears inside the planet for FOV ≳ 40°).

## Pixel close-up is a synthetic sample scene (2026-10-02)
**What:** `js/ui/pixelInset.js` draws a fixed 3 × 3 km scene (fields, river, town, factory, pond, a cool wet-soil "leak" next to the highway) at 5 m texels, twice: RGB and temperature (gray-encoded). Recorded pixels = box mean via summed-area tables at the current nadir GSD. It is NOT the ground under the satellite.
**Why:** Shows how GSD changes what can be resolved (e.g. the leak) without needing real imagery. Canvas anti-aliasing in the temperature pass produces realistic mixed pixels.
**Breaks if:** the two draw passes diverge in geometry (truth RGB and temperature stop lining up).

## View modes (2026-10-02)
**What:** `Globe.setViewMode('space' | 'earth' | 'satellite')`. Earth mode rotates the camera about scene Y by Δθ (planet rotation since last frame), so OrbitControls dragging still works.
**Breaks if:** the planet rotation is moved off `planetGroup.rotation.y` without updating the Δθ logic.

## Spherical planet, geocentric latitude (2026-10-02)
**What:** Lat/lon are geocentric on a sphere of the equatorial radius. Max error vs. WGS-84 geodetic latitude ≈ 0.19°.
**Why:** Simple, planet-agnostic, invisible at this visual scale.

## Exaggerated satellite size (2026-10-02)
**What:** Model unit = 0.06 scene units (~60 km) × `SATELLITE_MODEL_SCALE`. A sprite "beacon" keeps it findable when zoomed out.
**Why:** Real size would be invisible. Don't "fix" it.

## Satellite attitude frame (2026-10-02)
**What:** Model local axes: +X along-track, +Y zenith, +Z cross-track. Instrument slot is on the −Y (nadir) face; wings pivot about Z to track the sun. `satellite.setInstrument(scan, band)` swaps the instrument mesh (pushbroom visual / thermal now — thermal adds a black cryo-radiator fin + cryocooler; whiskbroom next).
**Breaks if:** you build new instrument meshes in a different local frame — they'll point the wrong way.

## One land painter for globe + map (2026-10-02)
**What:** `paintEquirect()` in `js/geo/land.js` paints both the 4096-px globe texture and the 2D map layer, via `d3-geo` (`geoEquirectangular` + `geoPath`). Coastlines are stroked from `topojson.mesh()` (arcs only), fills from `topojson.feature()`.
**Why:** Identical look in both views; d3 handles antimeridian clipping and Antarctica's pole ring (see rejected.md). Stroking the mesh avoids drawing fake coast along the ±180° cut.

## Map track splitting at the antimeridian (2026-10-02)
**What:** `Map2D.splitTrack()` cuts the polyline when |Δlon| > 180° and interpolates the crossing latitude, so lines reach both map edges.
**Breaks if:** track sampling gets so sparse that a real step exceeds 180° of longitude (not possible for LEO at 300 samples/orbit).

## Metal needs an environment map (2026-10-02)
**What:** Satellite materials get a `RoomEnvironment` PMREM map (`Globe.applySatelliteEnvMap`). The planet does not.
**Breaks if:** removed — gold foil and silver parts render nearly black.

## Pinned CDN versions + relative paths (2026-10-02)
**What:** three@0.186.1, topojson-client@3.1.0, d3-geo@3.1.1 pinned in the `index.html` importmap. All asset paths are relative (no leading `/`).
**Why:** `@latest` can break mid-event; relative paths make GitHub Pages work under `/<repo>/`.

## Swath recorder: status stamped at acquisition time (2026-10-02)
**What:** `js/sim/recorder.js` (`SwathRecorder`) stores one cross-track row every nodal/300 s (~20 s sim): 9 planet-fixed points (Float32Array) + per-vertex/per-cell STATUS (`NONE` not recorded, `DAY`, `NIGHT`, `CLOUD`). Map and globe draw only stored rows (+ a per-frame `tail` to "now"). Modes: `live` (rolling last orbit, back-filled on reset), `recording` (until **Stop**), `stopped` (held + stats, **Clear** → live). Safety cap `MAX_RECORD_ROWS` = 80k rows (~18 days at 700 km) auto-stops with "buffer full".
**Why:** Recorded data must not change afterwards — clouds move and FOV can change, but past rows keep what they saw. Also keeps rendering append-only (map: offscreen layer; globe: growable buffers with update ranges).
**Breaks if:** renderers recompute past swath from the orbit (old approach) — cloud flags and FOV history would be wrong.

## Recording runs until Stop (2026-10-02, supersedes the auto-completing cycle)
**What:** Jannis wanted recording to continue over many days (revisit build-up), so the "back at start / circled globe" auto-end was removed. Orbits are counted by accumulating Δ(argument of latitude) per row, which survives orbit changes mid-recording.

## Coverage % uses grid-cell CENTERS inside swath cells (2026-10-02)
**What:** 0.5° grid, cos-lat weighted; a grid cell counts if its center lies inside a swath cell (spherical point-in-quad via edge-plane signs). Thermal 186 km: ~18% usable/day; visual ~10% (day only); 110° whisk ~98%.
**Why:** The first version marked any touched grid cell → +~55 km per stripe → 24.5% > the 21.9% no-overlap ceiling. Center test is unbiased.

## Cloud field is a pure function of time (2026-10-02)
**What:** `js/geo/clouds.js`: ~320 systems; each generation's position/shape = seeded hash(system, generation); lifetime 8–20 h with `scale = sin(π·age)^0.6`; drift −30 km/h (tropics) / +50 km/h (mid-lat). `systemsAt(t)` memoizes the last t. Global cloud fraction ≈ 10% (measured 9.7–11%).
**Why:** Recorder, globe and map must agree exactly; deterministic → back-fill and tests work.
**Breaks if:** anything random (Math.random) or stateful is added to the cloud field.

## Whiskbroom timing model (2026-10-02)
**What:** Double-sided rotating scan mirror, k along-track detectors (`whiskRowsPerSweep`: thermal 10, visual 16). No-gap: scan period `T = k · line time`. Earth-view share `η = FOV/180°`; rest = calibration/space view. Dwell = η·T/N (thermal native: 6.7 µs vs 14.75 ms pushbroom). Wider FOV → higher η → longer dwell.
**Display:** 3D/map beam sweeps at a cartoon rate (1.6 s/sweep) with true η. Close-up sweeps take 0.7 s; calibration pause is true-to-ratio up to 1.2 s and labeled with the real % when shortened.

## FOV limits per scan type (2026-10-02)
**What:** Pushbroom 2–40° (single wide-field telescope), whiskbroom 2–110° (mirror does the scanning). Switching to pushbroom clamps the FOV.

## Visual needs sun ≥ 5°, thermal + SAR record at night; one color per sensor (2026-10-02)
**What:** `recordsAtNight` per instrument; `VISUAL_MIN_SUN_ELEV_DEG = 5` (checked per point at acquisition). Night rows are stored as `NIGHT` but drawn in the **same color** as day (Jannis: one color for LST). Visual night rows are `NONE` (not drawn, legend "night: no data"). SAR ignores clouds (`seesThroughClouds`).

## Dev server must disable caching (2026-10-02)
**What:** Use `python3 serve.py` (sends `Cache-Control: no-store`), not `python3 -m http.server`.
**Why:** Without cache headers the browser mixed a fresh `recordControl.js` with a stale cached `main.js` → `getMode is not a function`. Hard to diagnose mid-event.

## Satellite presets: published values → simulator hardware (2026-10-02)
**What:** `SATELLITES` in `js/config.js` (Landsat 8/9, GCOM-C, Sentinel-1/2, constellr HiVE, SatVu HotSat, ALOS-2/4, Custom). Optical instruments store the **published nadir GSD + swath** at the mission altitude; `fromPublished()` (`js/physics/instruments.js`) inverts the spherical swath formula (`tan η = sin λ / (k − cos λ)`) → native IFOV and pixel count, so native swath/GSD reproduce the published numbers (tested ≤ 1%). Detector pitch is used for the focal-length tile; where not public it is `null` ("n/a") or flagged in `approx` (shown as "≈ …" in the UI).
**Cross-checks (tests):** TIRS → 1,838 px / 176 mm (published 1,850 / 176.7 mm); SGLI-IRS → 80° FOV / 447 mm (published 80° / 448 mm); MSI → 590 mm (≈ 600); OLI → 886 mm (886).
**Sources (research 2026-10-02):** USGS/NASA (Landsat), JAXA EORC + SPIE 2014 (SGLI), SentiWiki (Sentinel-1/2), ESA eoGateway + eoPortal (constellr, SatVu), JAXA EORC (PALSAR-2/3). Status notes: Sentinel-1A ended 2026-06-30 (1C/1D active); SatVu HotSat-1 failed 2023, HotSat-2 operational since 2026-06-29.
**Approximations:** constellr pitch + LTDN, SatVu altitude (500–536 km) / LTDN / frame size, SAR beam-center incidences and looks. SatVu images targeted scenes; the sim shows a continuous strip.

## Presets set the orbit; altitude slider re-targets it (2026-10-02)
**What:** Selecting a satellite sets its altitude + LTDN. `retargetOrbit()` builds the new orbit at the current time with the **same argument of latitude** (and the same plane if LTDN is unchanged); the SSO inclination is recomputed, so near the turning latitudes the satellite can shift by up to Δi (~0.8° for 700 → 900 km) — physical, tested. Recorded rows are kept (`recorder.setOrbit`).
**Effects:** optical GSD = h·IFOV and swath grow with altitude; speed/period/ground speed/line time follow; SAR resolution does not change (antenna look angles fixed → incidence and swath change).

## SAR sensor class (2026-10-02)
**What:** `kind: 'sar'` instruments have modes `{incCenterDeg, swathKm, resRangeM, resAzM, looks}` at the mission altitude → fixed look angles (`sarLookAngles`). `sarGeometry` gives signed edge angles `{left, right}` (right-looking: both negative) → **offset swath with nadir gap**. Swath edges are generic everywhere (`swathEdges`, `crossTrackPointEci`). Globe: side-looking fan + antenna panel on the look side (+Z = right in the model frame). Close-up: σ⁰ backscatter (linear power averaged), deterministic multi-look gamma speckle, rectangular range × azimuth pixels; wet soil (leak) brighter.
**Breaks if:** someone averages SAR in dB, or makes SAR resolution depend on FOV/altitude.

## Framing scan type (2026-10-02)
**What:** Staring 2-D array (SatVu): frame period = frameRows × line time (no gap), dwell up to the frame period; close-up exposes whole frames at once. Third option in the Scan switch.
