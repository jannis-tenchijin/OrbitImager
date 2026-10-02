---
name: verify-app
description: Verify Orbit Imager works — run the in-browser physics tests and visually check the app (globe, map, alignment, wrap, mobile). Use before committing, after touching physics/frames/rendering, or when the user says "test it", "check it works", or /verify-app.
---

# Verify the app

## 1. Start the server
- Preferred: `preview_start` with name `web` (from `.claude/launch.json`).
- Fallback: `python3 -m http.server 8000` from repo root.

## 2. Physics tests
- Open `http://localhost:8000/tests/`.
- Read page text. Title must be `✅ N/N tests`; every line `PASS`.
- Any FAIL → fix before continuing. Don't loosen tolerances without a reference value.

## 3. App smoke test
- Open `http://localhost:8000/`, then read console errors (must be none).
- Screenshot at a desktop size (e.g. 1440×900): globe with continents, satellite beacon, gold orbit ring, coral ground trail; map with coral past track + dashed future track; HUD values filled.

## 4. Alignment check (after touching frames, textures, or projection)
Run in the page:
```js
__app.globe.addMarker(35.68, 139.69, 0xff00ff);
__app.map.addMarker(35.68, 139.69, '#ff00ff', 'Tokyo');
```
Rotate the globe to Japan. Magenta dot must sit on Tokyo in both views.

## 5. Wrap / warp check
- Click `1000×`, wait ~8 s. Orbit # increments; map track has no horizontal streaks at ±180°; successive passes shift west.

## 6. Sensor + swath checks
Run in the page and compare with the expected values:
```js
const sl = document.getElementById('fov-slider'); sl.value = 30; sl.dispatchEvent(new Event('input'));
JSON.stringify({ swath: __app.geom.swathKm, gsd: __app.geom.gsdNadirM, f: __app.geom.focalLengthMm });
```
- Thermal @ 30°: swath ≈ 377 km, GSD ≈ 198 m, focal ≈ 88 mm. Swath band on map + globe visibly wider; close-up pixels bigger.
- Click **Visual**: FOV resets to ~15.1°, GSD ≈ 29.8 m, swath ≈ 186 km, swath color turns teal.
- FOV 110° + `1000×`: no streaks at ±180° or near the poles on the map.

## 7. View modes
- **Earth** + `300×`: the point under the camera stays fixed (Japan stays centered) while the orbit sweeps.
- **Space**: the Earth rotates beneath (~15°/h sim time). **Satellite**: camera tracks the satellite.
- HUD: Local time ≈ 10:30 at the descending (daylight) equator crossing; LTDN tile = 10:30.

## 8. Mobile layout
- `resize_window` preset `mobile`, reload. Panels stack; `document.documentElement.scrollWidth === clientWidth` (no horizontal scroll).
- Reset with preset `desktop` afterward.

## Report
State what passed, what failed (with output), and anything skipped.
