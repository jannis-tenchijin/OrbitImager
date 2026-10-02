# Orbit Imager

**▶ Open the live app: [jannis-tenchijin.github.io/OrbitImager](https://jannis-tenchijin.github.io/OrbitImager/)** — runs in the browser, nothing to install.

A stylized, browser-based simulation of how an Earth-imaging satellite captures images.
The goal is to make the imaging geometry visible: how altitude, field of view and pixel size (IFOV)
change swath width and ground resolution, and how pushbroom vs whiskbroom sensors differ in
*when* each pixel is recorded.

**Version 1:** 3D globe + 2D ground-track map of a sun-synchronous satellite; real presets (Landsat 8/9,
GCOM-C, Sentinel-1/2, constellr, SatVu, ALOS-2/4) with pushbroom, whiskbroom, framing and SAR sensors;
FOV and altitude sliders that drive swath, GSD and timing; a pixel close-up showing how each scan type records;
drifting clouds that make recorded cells unusable; and **Record** with coverage + per-place revisit statistics.

## Run locally
```bash
python3 serve.py
```
Open http://localhost:8000/ — physics tests at http://localhost:8000/tests/.
(Needs an HTTP server; opening the file directly won't load ES modules.)

## Controls
- Drag / scroll on the globe to rotate / zoom
- Space or ⏸ to pause, time-warp buttons for speed, **Now** to jump to real time
- **View:** *Space* (Earth rotates beneath), *Earth* (camera rotates with Earth — stay over one country), *Satellite* (follow)
- **Sensor:** pick a satellite (Landsat 8/9, GCOM-C, Sentinel-1/2, constellr, SatVu, ALOS-2/4, Custom) and instrument; optical: Pushbroom / Whiskbroom / Framing + **FOV**; SAR: **Mode** (IW/EW/SM, StripMap/ScanSAR…)
- **Orbit:** altitude slider (300–1200 km) — speed, period, SSO inclination, swath, GSD and the close-up follow; ↺ returns to the satellite's real altitude
- **● Record** (Results card, under the 3D view): accumulate swaths until **Stop** (result is held; **Clear** resets); try `10k×` or `50k×`
- **Results** (under the 3D view): Earth covered % and usable (cloud-free) %; **📍 Pick place** on the map → images, cloudy, "1 image every X days"
- **SatVu** images only 80 tasked cities (3.5 × 4.5 km frames within ±30° off-nadir), no continuous strip

## Project docs
- [docs/backlog.md](docs/backlog.md) — what's next
- [docs/decisions.md](docs/decisions.md) — why things are the way they are
- [docs/rejected.md](docs/rejected.md) — ideas we dropped

## Credits
- Land data: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC)
- [three.js](https://threejs.org/) (MIT), [d3-geo](https://github.com/d3/d3-geo) (ISC), [topojson-client](https://github.com/topojson/topojson-client) (ISC)
