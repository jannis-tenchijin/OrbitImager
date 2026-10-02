// App entry: wires physics -> recorder -> globe + map + panels in a single animation loop.

import {
  PLANETS, DEFAULT_PLANET, DEFAULT_ORBIT, SENSOR_PRESETS, DEFAULT_SENSOR_ID, FOV_RANGE_DEG,
  CLOSEUP, CLOUDS, VISUAL_MIN_SUN_ELEV_DEG, PALETTE, TIME_WARPS, DEFAULT_WARP, SATELLITE_MODEL_SCALE,
} from './config.js';
import { createOrbit, subSatellitePoint, groundTrack, swathTrack, orbitPath, orbitNumber } from './physics/orbit.js';
import { sunEci, meanLocalTime } from './physics/time.js';
import { sensorGeometry, nativeFovDeg } from './physics/sensor.js';
import { loadLand, paintToCanvas } from './geo/land.js';
import { createCloudField } from './geo/clouds.js';
import { SwathRecorder } from './sim/recorder.js';
import { Globe } from './scene/globe.js';
import { Map2D } from './map/map2d.js';
import { createHud, fmt } from './ui/hud.js';
import { createSensorPanel } from './ui/sensorPanel.js';
import { PixelInset } from './ui/pixelInset.js';
import { createRecordControl } from './ui/recordControl.js';

const TRACK_SAMPLES = 300;     // per half (past / future)
const MAX_REAL_DT = 0.1;       // s; clamp after tab switches so the sim doesn't jump
const GLOBE_TEXTURE_WIDTH = 4096;
const WHISK_VISUAL_SWEEP_S = 1.6; // real seconds per mirror sweep in the 3D/map views (cartoon rate)

const planet = PLANETS[DEFAULT_PLANET];
const clock = { simMs: Date.now(), warp: DEFAULT_WARP, playing: true };
const orbit = createOrbit(planet, DEFAULT_ORBIT, clock.simMs);
const clouds = createCloudField(CLOUDS, planet.radiusKm);

// Sensor state: preset + FOV + scan type. Geometry is recomputed only when these change.
const first = SENSOR_PRESETS[DEFAULT_SENSOR_ID];
const sensor = { preset: first, fovDeg: nativeFovDeg(first), scan: first.scan };
let geom = sensorGeometry(planet, DEFAULT_ORBIT.altitudeKm, sensor.preset, sensor.fovDeg, sensor.scan);

const recorder = new SwathRecorder(orbit, { clouds, minSunElevDeg: VISUAL_MIN_SUN_ELEV_DEG });

const globe = new Globe(document.getElementById('globe'), planet, PALETTE, {
  satelliteScale: SATELLITE_MODEL_SCALE,
  sensor: sensor.preset,
  scan: sensor.scan,
  clouds,
});
const map = new Map2D(document.getElementById('map'), PALETTE);
const hud = createHud(document.getElementById('hud'));
const inset = new PixelInset(document.getElementById('closeup-host'), PALETTE, CLOSEUP);
const recCtl = createRecordControl(document.getElementById('rec-ctl'), document.getElementById('map-legend'), PALETTE, {
  onRecord: () => recorder.startRecording(clock.simMs),
  onStop: () => recorder.resetLive(clock.simMs),
  getMode: () => recorder.mode,
});
const panel = createSensorPanel(document.getElementById('sensor-panel'), {
  presets: SENSOR_PRESETS,
  fovRanges: FOV_RANGE_DEG,
  initialId: DEFAULT_SENSOR_ID,
  nativeFov: nativeFovDeg,
  onChange: ({ presetId, fovDeg, scan }) => {
    const changedPreset = presetId !== sensor.preset.id;
    const changedScan = scan !== sensor.scan;
    Object.assign(sensor, { preset: SENSOR_PRESETS[presetId], fovDeg, scan });
    if (changedPreset || changedScan) globe.setSensor(sensor.preset, sensor.scan);
    applySensor();
    // A different instrument means different data: restart recording / refill the live window
    if (changedPreset) {
      if (recorder.mode === 'recording') recorder.startRecording(clock.simMs);
      else if (recorder.mode === 'live') recorder.resetLive(clock.simMs);
    }
  },
});

/** Recompute derived sensor geometry and push it to the recorder and panels. */
function applySensor() {
  geom = sensorGeometry(planet, DEFAULT_ORBIT.altitudeKm, sensor.preset, sensor.fovDeg, sensor.scan);
  recorder.configure({ swathKm: geom.swathKm, sensorId: sensor.preset.id, recordsAtNight: sensor.preset.recordsAtNight });
  panel.show(geom);
  inset.set(sensor.preset.id, geom.gsdNadirM, geom.timing);
  recCtl.setLegend(sensor.preset);
}
applySensor();
recorder.resetLive(clock.simMs);

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
document.getElementById('now').addEventListener('click', () => {
  clock.simMs = Date.now();
  recorder.resetLive(clock.simMs); // time jump: recorded data no longer continuous
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    setPlaying(!clock.playing);
  }
});
setWarp(clock.warp);
setPlaying(true);
setView('space');

/** Whiskbroom mirror state shared by globe + map (real-time cartoon rate, true Earth-view share). */
function whiskBeam(nowRealMs) {
  if (sensor.scan !== 'whiskbroom') return null;
  const phase = (nowRealMs / 1000 / WHISK_VISUAL_SWEEP_S) % 1;
  const eta = geom.timing.earthViewFrac;
  return { phase, active: phase < eta, sweep: Math.min(1, phase / eta) };
}

// --- Main loop ---
let lastReal = performance.now();
function frame(now) {
  const dt = Math.min((now - lastReal) / 1000, MAX_REAL_DT);
  lastReal = now;
  if (clock.playing) clock.simMs += dt * 1000 * clock.warp;

  const t = clock.simMs;
  const periodMs = orbit.nodalPeriodS * 1000;
  recorder.advance(t);
  const tail = recorder.tail(t);
  const cloudSystems = clouds.systemsAt(t);
  const sub = subSatellitePoint(orbit, t);
  const pastTrack = groundTrack(orbit, t - periodMs, t, TRACK_SAMPLES);
  const future = swathTrack(orbit, t, t + periodMs, TRACK_SAMPLES, geom.swathKm);
  const beam = whiskBeam(now);

  globe.update({
    pos: sub.pos, vel: sub.vel, theta: sub.theta,
    sunDir: sunEci(t).dir,
    orbitPath: orbitPath(orbit, t, 256),
    pastTrack, swathKm: geom.swathKm, beam, recorder, tail, cloudSystems,
  });
  map.render({
    sub, pastTrack, future, nowMs: t, swathColor: PALETTE.swath[sensor.preset.id],
    recorder, tail, cloudSystems, beam,
  });
  inset.tick(dt);
  recCtl.update(recorder, t);
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
window.__app = {
  clock, orbit, sensor, globe, map, inset, recorder, clouds, planet,
  get geom() { return geom; },
};
