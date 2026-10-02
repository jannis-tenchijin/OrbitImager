// App entry: wires physics -> globe + map + HUD in a single animation loop.

import {
  PLANETS, DEFAULT_PLANET, DEFAULT_ORBIT, DEFAULT_SENSOR, PALETTE,
  TIME_WARPS, DEFAULT_WARP, SATELLITE_MODEL_SCALE,
} from './config.js';
import { createOrbit, subSatellitePoint, groundTrack, orbitPath, orbitNumber } from './physics/orbit.js';
import { sunEci } from './physics/time.js';
import { sensorGeometry } from './physics/sensor.js';
import { loadLand, paintToCanvas } from './geo/land.js';
import { Globe } from './scene/globe.js';
import { Map2D } from './map/map2d.js';
import { createHud, fmt } from './ui/hud.js';

const TRACK_SAMPLES = 300;   // per half (past / future)
const MAX_REAL_DT = 0.1;     // s; clamp after tab switches so the sim doesn't jump
const GLOBE_TEXTURE_WIDTH = 4096;

const planet = PLANETS[DEFAULT_PLANET];
const clock = { simMs: Date.now(), warp: DEFAULT_WARP, playing: true };
const orbit = createOrbit(planet, DEFAULT_ORBIT, clock.simMs);
const sensor = { ...DEFAULT_SENSOR };

const globe = new Globe(document.getElementById('globe'), planet, PALETTE, {
  satelliteScale: SATELLITE_MODEL_SCALE,
  instrument: sensor.type,
});
const map = new Map2D(document.getElementById('map'), PALETTE);
const hud = createHud(document.getElementById('hud'));

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

// --- Controls ---
const playBtn = document.getElementById('play');
const warpGroup = document.getElementById('warp');

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

playBtn.addEventListener('click', () => setPlaying(!clock.playing));
document.getElementById('now').addEventListener('click', () => (clock.simMs = Date.now()));
document.getElementById('follow').addEventListener('change', (e) => globe.setFollow(e.target.checked));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    setPlaying(!clock.playing);
  }
});
setWarp(clock.warp);
setPlaying(true);

// --- Main loop ---
let lastReal = performance.now();
function frame(now) {
  const dt = Math.min((now - lastReal) / 1000, MAX_REAL_DT);
  lastReal = now;
  if (clock.playing) clock.simMs += dt * 1000 * clock.warp;

  const t = clock.simMs;
  const periodMs = orbit.nodalPeriodS * 1000;
  const sub = subSatellitePoint(orbit, t);
  const past = groundTrack(orbit, t - periodMs, t, TRACK_SAMPLES);
  const future = groundTrack(orbit, t, t + periodMs, TRACK_SAMPLES);

  globe.update({
    pos: sub.pos, vel: sub.vel, theta: sub.theta,
    sunDir: sunEci(t).dir,
    orbitPath: orbitPath(orbit, t, 256),
    past, nowMs: t,
  });
  map.render({ sub, past, future, nowMs: t });
  const sg = sensorGeometry(planet, sub.altKm, sensor);
  hud.update({
    utc: fmt.utc(t),
    lat: fmt.lat(sub.latDeg),
    lon: fmt.lon(sub.lonDeg),
    alt: fmt.km(sub.altKm),
    speed: fmt.kms(sub.speedKmS),
    period: fmt.min(orbit.nodalPeriodS),
    inc: fmt.deg((orbit.i * 180) / Math.PI),
    orbit: String(orbitNumber(orbit, t)),
    sensor: fmt.cap(sg.type),
    pixels: fmt.int(sg.pixelsCrossTrack),
    ifov: fmt.urad(sg.ifovUrad),
    fov: fmt.deg(sg.fovDeg),
    gsd: fmt.m(sg.gsdNadirM),
    swath: fmt.km(sg.swathKm),
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for the console / automated checks
window.__app = { clock, orbit, sensor, globe, map, planet };
