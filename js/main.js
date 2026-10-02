// App entry: wires physics -> globe + map + panels in a single animation loop.

import {
  PLANETS, DEFAULT_PLANET, DEFAULT_ORBIT, SENSOR_PRESETS, DEFAULT_SENSOR_ID, FOV_RANGE_DEG,
  CLOSEUP, PALETTE, TIME_WARPS, DEFAULT_WARP, SATELLITE_MODEL_SCALE,
} from './config.js';
import { createOrbit, subSatellitePoint, swathTrack, orbitPath, orbitNumber } from './physics/orbit.js';
import { sunEci, meanLocalTime } from './physics/time.js';
import { sensorGeometry, nativeFovDeg } from './physics/sensor.js';
import { loadLand, paintToCanvas } from './geo/land.js';
import { Globe } from './scene/globe.js';
import { Map2D } from './map/map2d.js';
import { createHud, fmt } from './ui/hud.js';
import { createSensorPanel } from './ui/sensorPanel.js';
import { PixelInset } from './ui/pixelInset.js';

const TRACK_SAMPLES = 300;   // per half (past / future)
const MAX_REAL_DT = 0.1;     // s; clamp after tab switches so the sim doesn't jump
const GLOBE_TEXTURE_WIDTH = 4096;

const planet = PLANETS[DEFAULT_PLANET];
const clock = { simMs: Date.now(), warp: DEFAULT_WARP, playing: true };
const orbit = createOrbit(planet, DEFAULT_ORBIT, clock.simMs);

// Sensor state: preset + FOV. Geometry is recomputed only when these change.
const sensor = { preset: SENSOR_PRESETS[DEFAULT_SENSOR_ID], fovDeg: nativeFovDeg(SENSOR_PRESETS[DEFAULT_SENSOR_ID]) };
let geom = sensorGeometry(planet, DEFAULT_ORBIT.altitudeKm, sensor.preset, sensor.fovDeg);

const globe = new Globe(document.getElementById('globe'), planet, PALETTE, {
  satelliteScale: SATELLITE_MODEL_SCALE,
  sensor: sensor.preset,
});
const map = new Map2D(document.getElementById('map'), PALETTE);
const hud = createHud(document.getElementById('hud'));
const inset = new PixelInset(document.getElementById('closeup-host'), PALETTE, CLOSEUP);
const panel = createSensorPanel(document.getElementById('sensor-panel'), {
  presets: SENSOR_PRESETS,
  fovRange: FOV_RANGE_DEG,
  initialId: DEFAULT_SENSOR_ID,
  nativeFov: nativeFovDeg,
  onChange: ({ presetId, fovDeg }) => {
    const changedPreset = presetId !== sensor.preset.id;
    sensor.preset = SENSOR_PRESETS[presetId];
    sensor.fovDeg = fovDeg;
    if (changedPreset) globe.setSensor(sensor.preset);
    applySensor();
  },
});

/** Recompute derived sensor geometry and push it to the panels. */
function applySensor() {
  geom = sensorGeometry(planet, DEFAULT_ORBIT.altitudeKm, sensor.preset, sensor.fovDeg);
  panel.show(geom);
  inset.set(sensor.preset.id, geom.gsdNadirM);
}
applySensor();

// Land data: paint once, share between globe texture and map
const status = document.getElementById('status');
loadLand(planet.landData)
  .then((geo) => {
    globe.setLandTexture(paintToCanvas(GLOBE_TEXTURE_WIDTH, geo, PALETTE));
    map.setLand(geo);
    status.hidden = true;
  })
  .catch((err) => {
    console.error(err);
    status.textContent = 'Could not load land data — is the page served over http:// ?';
  });

// --- Header controls ---
const playBtn = document.getElementById('play');
const warpGroup = document.getElementById('warp');
const viewGroup = document.getElementById('view');

function setPlaying(on) {
  clock.playing = on;
  playBtn.classList.toggle('paused', !on);
  playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

for (const w of TIME_WARPS) {
  const b = document.createElement('button');
  b.textContent = `${w}×`;
  b.dataset.warp = w;
  b.addEventListener('click', () => setWarp(w));
  warpGroup.appendChild(b);
}
function setWarp(w) {
  clock.warp = w;
  for (const b of warpGroup.children) b.classList.toggle('active', Number(b.dataset.warp) === w);
}

for (const b of viewGroup.children) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
function setView(mode) {
  globe.setViewMode(mode);
  for (const b of viewGroup.children) b.classList.toggle('active', b.dataset.view === mode);
}

playBtn.addEventListener('click', () => setPlaying(!clock.playing));
document.getElementById('now').addEventListener('click', () => (clock.simMs = Date.now()));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    setPlaying(!clock.playing);
  }
});
setWarp(clock.warp);
setPlaying(true);
setView('space');

// --- Main loop ---
let lastReal = performance.now();
function frame(now) {
  const dt = Math.min((now - lastReal) / 1000, MAX_REAL_DT);
  lastReal = now;
  if (clock.playing) clock.simMs += dt * 1000 * clock.warp;

  const t = clock.simMs;
  const periodMs = orbit.nodalPeriodS * 1000;
  const sub = subSatellitePoint(orbit, t);
  const past = swathTrack(orbit, t - periodMs, t, TRACK_SAMPLES, geom.swathKm);
  const future = swathTrack(orbit, t, t + periodMs, TRACK_SAMPLES, geom.swathKm);

  globe.update({
    pos: sub.pos, vel: sub.vel, theta: sub.theta,
    sunDir: sunEci(t).dir,
    orbitPath: orbitPath(orbit, t, 256),
    past, swathKm: geom.swathKm, nowMs: t,
  });
  map.render({ sub, past, future, nowMs: t, swathColor: PALETTE.swath[sensor.preset.id] });
  hud.update({
    utc: fmt.utc(t),
    local: fmt.hhmm(meanLocalTime(sub.lonDeg, t)),
    ltdn: fmt.hhmm(DEFAULT_ORBIT.ltdnHours),
    lat: fmt.lat(sub.latDeg),
    lon: fmt.lon(sub.lonDeg),
    alt: fmt.km(sub.altKm),
    speed: fmt.kms(sub.speedKmS),
    period: fmt.min(orbit.nodalPeriodS),
    inc: fmt.deg((orbit.i * 180) / Math.PI),
    orbit: String(orbitNumber(orbit, t)),
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for the console / automated checks
window.__app = { clock, orbit, sensor, globe, map, inset, planet, get geom() { return geom; } };
