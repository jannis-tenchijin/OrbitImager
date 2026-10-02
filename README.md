# Orbit Imager

A stylized, browser-based simulation of how an Earth-imaging satellite captures images.
The goal is to make the imaging geometry visible: how altitude, field of view and pixel size (IFOV)
change swath width and ground resolution, and how pushbroom vs whiskbroom sensors differ in
*when* each pixel is recorded.

**v0:** 3D globe with a sun-synchronous satellite (700 km, ~98.2°, 10:30 descending node), a 2D map
with the ground track, time warp, follow camera, and live orbit + sensor telemetry (FOV, GSD, swath).

## Run locally
```bash
python3 -m http.server 8000
```
Open http://localhost:8000/ — physics tests at http://localhost:8000/tests/.
(Needs an HTTP server; opening the file directly won't load ES modules.)

## Controls
- Drag / scroll on the globe to rotate / zoom
- Space or ⏸ to pause, time-warp buttons for speed, **Now** to jump to real time
- **Follow** keeps the camera above the satellite

## Project docs
- [docs/backlog.md](docs/backlog.md) — what's next
- [docs/decisions.md](docs/decisions.md) — why things are the way they are
- [docs/rejected.md](docs/rejected.md) — ideas we dropped

## Credits
- Land data: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC)
- [three.js](https://threejs.org/) (MIT), [d3-geo](https://github.com/d3/d3-geo) (ISC), [topojson-client](https://github.com/topojson/topojson-client) (ISC)
