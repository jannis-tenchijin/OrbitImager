# Orbit Imager

A stylized, browser-based simulation of how an Earth-imaging satellite captures images.
The goal is to make the imaging geometry visible: how altitude, field of view and pixel size (IFOV)
change swath width and ground resolution, and how pushbroom vs whiskbroom sensors differ in
*when* each pixel is recorded.

**Current:** 3D globe with a sun-synchronous satellite (700 km, ~98.2°, LTDN 10:30 mean solar time),
2D ground-track map with the recorded swath, thermal (Landsat TIRS-like) and visual (OLI-like) sensor presets,
an FOV slider (fixed detector array → focal length changes), live FOV/IFOV/GSD/swath, and a pixel close-up
comparing ground truth with what the sensor records — animated row by row (pushbroom) or sweep by sweep
with calibration pauses (whiskbroom). **Record** accumulates a full day of swaths with drifting clouds:
cells imaged under cloud are marked unusable, the visual sensor records only in daylight, thermal and SAR also at night,
and SAR sees through clouds with a side-looking swath and nadir gap.

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
- **● Record** (header): accumulate swaths until **Stop** (result is held; **Clear** resets); try `10k×`
- **Results** (under the 3D view): Earth covered % and usable (cloud-free) %; **📍 Pick place** on the map → images, cloudy, "1 image every X days"
- **SatVu** images only 80 tasked cities (3.5 × 4.5 km frames within ±30° off-nadir), no continuous strip

## Project docs
- [docs/backlog.md](docs/backlog.md) — what's next
- [docs/decisions.md](docs/decisions.md) — why things are the way they are
- [docs/rejected.md](docs/rejected.md) — ideas we dropped

## Credits
- Land data: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC)
- [three.js](https://threejs.org/) (MIT), [d3-geo](https://github.com/d3/d3-geo) (ISC), [topojson-client](https://github.com/topojson/topojson-client) (ISC)
