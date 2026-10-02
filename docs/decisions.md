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
