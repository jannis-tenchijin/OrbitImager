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
**What:** `inclinationDeg: null` → `sunSyncInclination()` (≈ 98.19° at 700 km). RAAN is set from LTDN 10:30 using the sun's right ascension at epoch, and J2 secular drift (RAAN, arg. of perigee, mean motion) is applied. The sat starts at the descending node (M = 180°) so the first pass is in daylight.
**Breaks if:** you remove the J2 terms — at high time warp the orbit stops tracking the sun.

## Sensor parameterization: IFOV × pixel count → FOV (2026-10-02)
**What:** `DEFAULT_SENSOR` stores **IFOV** and **pixelsCrossTrack**. FOV, GSD and swath are always *derived* in `js/physics/sensor.js`:
`FOV = N·IFOV`, `GSD = h·IFOV`, `swath = 2R·(asin((R+h)/R·sin(FOV/2)) − FOV/2)` (spherical planet).
**Why:** It encodes the relationships the sim exists to show: higher altitude → wider swath + coarser GSD; wider FOV → wider swath; smaller IFOV with the same detector count → finer GSD *and* narrower swath. These are unit-tested in `tests/orbit.test.js`.
**Open question:** when a UI slider changes "FOV", do we change N (keep resolution) or IFOV (keep detector)? Decide when building the parameter panel.
**Breaks if:** someone stores `swathKm` or `fovDeg` directly in config — they'll go stale when altitude changes.

## Spherical planet, geocentric latitude (2026-10-02)
**What:** Lat/lon are geocentric on a sphere of the equatorial radius. Max error vs. WGS-84 geodetic latitude ≈ 0.19°.
**Why:** Simple, planet-agnostic, invisible at this visual scale.

## Exaggerated satellite size (2026-10-02)
**What:** Model unit = 0.06 scene units (~60 km) × `SATELLITE_MODEL_SCALE`. A sprite "beacon" keeps it findable when zoomed out.
**Why:** Real size would be invisible. Don't "fix" it.

## Satellite attitude frame (2026-10-02)
**What:** Model local axes: +X along-track, +Y zenith, +Z cross-track. Instrument slot is on the −Y (nadir) face; wings pivot about Z to track the sun. `satellite.setInstrument(type)` swaps the instrument mesh (pushbroom now, whiskbroom next).
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
