# Orbit Imager — hackathon project

Browser simulation of how a generic Earth-imaging satellite records images.
**North star:** make visible how orbit + sensor parameters change image capture —
altitude / FOV / IFOV → swath & GSD; pushbroom vs whiskbroom → *when* each pixel is acquired.
Style: low-poly cartoon, appealing, not realistic — but every part must be recognizable.

## Run
- Serve: `python3 -m http.server 8000` from repo root (or the `web` config in `.claude/launch.json`).
- App: http://localhost:8000/ · Tests: http://localhost:8000/tests/ (page title shows `✅ N/N tests`).
- Opening `index.html` via `file://` does NOT work (ES modules + fetch need HTTP).

## Stack (no build step)
- Plain ES modules, Three.js + d3-geo + topojson-client via the importmap in `index.html`.
- CDN versions are pinned exactly. Never use `@latest`. Bump deliberately and re-run tests.
- No Node/npm in this project. Do not add `package.json` or a bundler without logging it in `docs/decisions.md`.
- All paths relative (no leading `/`) so GitHub Pages works under `/<repo>/`.

## Layout
```
index.html            importmap + DOM layout
css/style.css         layout + theme tokens (:root vars)
js/config.js          planets, default orbit/sensor, palette, time warps
js/main.js            app loop: physics -> globe + map + HUD
js/physics/time.js    Julian date, planet rotation (GMST), sun direction
js/physics/orbit.js   Keplerian + J2 propagation, frames, ground track
js/physics/sensor.js  focal-length sensor model: FOV -> IFOV, GSD, swath
js/geo/land.js        land data loading + shared equirectangular painter
js/scene/globe.js     Three.js scene (planet, atmosphere, satellite, orbit viz)
js/scene/satelliteModel.js  satellite mesh + swappable instrument slot
js/map/map2d.js       2D canvas map + ground track
js/ui/hud.js          orbit telemetry tiles (+ shared fmt helpers)
js/ui/sensorPanel.js  thermal/visual switch, FOV slider, sensor tiles
js/ui/pixelInset.js   pixel close-up: synthetic scene, truth vs recorded
tests/                in-browser physics tests
data/land-50m.json    Natural Earth land (TopoJSON, vendored)
docs/                 backlog / rejected / decisions
```

## Conventions
- Units: km, seconds, radians inside physics. Degrees only at boundaries, named `*Deg`.
- Physics functions are pure and take a `planet` object — never hard-code Earth constants outside `config.js`.
- Frames: ECI (Z = north) in physics; `toScene()` in `globe.js` maps to Three.js Y-up. Read `docs/decisions.md` before touching frames.
- Sensor presets store hardware only (pixels, pitch, native IFOV). FOV slider = focal length; IFOV, GSD, swath are derived in `sensor.js`, never stored.
- Local times / LTDN are MEAN solar time (UTC + lon/15). Never use the apparent sun for RAAN.
- Colors live in `PALETTE` (`config.js`) or CSS `:root` vars — no stray hex values in new code.
- Comments: brief, explain the *why* / the math. Match the existing density.
- New physics => add a test in `tests/orbit.test.js` with a known reference value.

## Docs discipline
- New idea → `docs/backlog.md`. Dropped idea → `docs/rejected.md` with reason.
- Anything non-obvious that would break if "cleaned up" → `docs/decisions.md` (What / Why / Breaks if).
- Use the `/log-idea` skill for the format.

## Verify before committing
Use the `/verify-app` skill. Minimum bar: tests page all PASS, app loads with no console errors.

## Git
- Branch `main`; remote not set up yet (push to GitHub when ready; `gh` not installed).
- Never commit secrets or API keys. Satellite data clients and keys stay out of this repo.
