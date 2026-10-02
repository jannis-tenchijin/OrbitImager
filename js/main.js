// App entry: wires physics -> recorder -> globe + map + panels in a single animation loop.

import {
  PLANETS, DEFAULT_PLANET, DEFAULT_ORBIT, SATELLITES, DEFAULT_SATELLITE, DEFAULT_INSTRUMENT,
  FOV_RANGE_DEG, ALTITUDE_RANGE_KM, MAX_RECORD_ROWS, CLOSEUP, CLOUDS, VISUAL_MIN_SUN_ELEV_DEG,
  PALETTE, TIME_WARPS, DEFAULT_WARP, SATELLITE_MODEL_SCALE,
} from './config.js';
import {
  createOrbit, retargetOrbit, subSatellitePoint, groundTrack, swathTrack, orbitPath, orbitNumber,
} from './physics/orbit.js';
import { sunEci, meanLocalTime } from './physics/time.js';
import { instrumentGeometry, nativeFovDeg } from './physics/sensor.js';
import { resolveCatalog } from './physics/instruments.js';
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
const catalog = resolveCatalog(planet, SATELLITES);
const clock = { simMs: Date.now(), warp: DEFAULT_WARP, playing: true };
const clouds = createCloudField(CLOUDS, planet.radiusKm);

// Orbit: starts at the default satellite's real orbit; presets + the altitude slider retarget it
const firstSat = catalog[DEFAULT_SATELLITE];
let orbit = createOrbit(planet, { ...DEFAULT_ORBIT, ...firstSat.orbit }, clock.simMs);
let orbitBase = 0; // orbits flown on previous orbit objects (keeps "Orbit #" counting)

// Sensor state lives in the panel ({ satId, instId, scan, fovDeg, modeId }); geometry is derived
let geom = null;
const recorder = new SwathRecorder(orbit, { clouds, minSunElevDeg: VISUAL_MIN_SUN_ELEV_DEG, maxRows: MAX_RECORD_ROWS });

const globe = new Globe(document.getElementById('globe'), planet, PALETTE, {
  satelliteScale: SATELLITE_MODEL_SCALE,
  sensor: firstSat.instruments[DEFAULT_INSTRUMENT],
  scan: firstSat.instruments[DEFAULT_INSTRUMENT].scan,
  clouds,
});
const map = new Map2D(document.getElementById('map'), PALETTE);
const inset = new PixelInset(document.getElementById('closeup-host'), PALETTE, CLOSEUP);
const hud = createHud(document.getElementById('hud'), {
  altRange: ALTITUDE_RANGE_KM,
  onAltitude: (km) => setOrbit({ altitudeKm: km, ltdnHours: orbit.ltdnHours }),
  onResetAltitude: () => setOrbit({ ...catalog[panel.state.satId].orbit }),
});
const recCtl = createRecordControl(
  { buttonHost: document.getElementById('rec-host'), badge: document.getElementById('rec-badge'), legend: document.getElementById('map-legend') },
  PALETTE,
  {
    onRecord: () => recorder.startRecording(clock.simMs),
    onStop: () => recorder.stop(),
    onClear: () => recorder.resetLive(clock.simMs),
    getMode: () => recorder.mode,
  },
);
const panel = createSensorPanel(document.getElementById('sensor-panel'), {
  catalog,
  fovRanges: FOV_RANGE_DEG,
  initial: { satId: DEFAULT_SATELLITE, instId: DEFAULT_INSTRUMENT },
  nativeFov: nativeFovDeg,
  onChange: (state, what) => {
    if (what === 'satellite') setOrbit({ ...catalog[state.satId].orbit }, { refill: false });
    if (what === 'satellite' || what === 'instrument' || what === 'scan') globe.setSensor(currentInstrument(), state.scan);
    applySensor();
    // A different instrument means different data: restart recording / refill the live window
    if (what === 'satellite' || what === 'instrument') {
      if (recorder.mode === 'recording') recorder.startRecording(clock.simMs);
      else if (recorder.mode === 'live') recorder.resetLive(clock.simMs);
    }
  },
});

function currentInstrument() {
  return catalog[panel.state.satId].instruments[panel.state.instId];
}

/** Recompute derived sensor geometry (depends on altitude) and push it everywhere. */
function applySensor() {
  const inst = currentInstrument();
  geom = instrumentGeometry(planet, orbit.altitudeKm, inst, panel.state);
  recorder.configure({ edges: geom.edges, kind: inst.kind, recordsAtNight: inst.recordsAtNight, seesThroughClouds: inst.kind === 'sar' });
  panel.show(geom);
  inset.set(inst.kind, geom.gsdXM, geom.gsdYM, geom.timing, geom.looks ?? 1);
  recCtl.setLegend(inst);
}

/**
 * Re-target the orbit (altitude slider or preset): same position along the orbit, new altitude
 * / LTDN; period, speed and SSO inclination follow. Recorded rows are kept.
 */
function setOrbit({ altitudeKm, ltdnHours }, { refill = true } = {}) {
  if (altitudeKm === orbit.altitudeKm && ltdnHours === orbit.ltdnHours) return;
  orbitBase += orbitNumber(orbit, clock.simMs) - 1;
  orbit = retargetOrbit(orbit, clock.simMs, { altitudeKm, ltdnHours });
  recorder.setOrbit(orbit);
  hud.setAltitude(altitudeKm);
  const preset = catalog[panel.state.satId].orbit;
  panel.setAltitudeModified(Math.abs(altitudeKm - preset.altitudeKm) > 0.5);
  applySensor();
  if (refill && recorder.mode === 'live') recorder.resetLive(clock.simMs);
}

applySensor();
hud.setAltitude(orbit.altitudeKm);
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
  b.textContent = w >= 1000 ? `${w / 1000}k×` : `${w}×`;
  b.title = `${w.toLocaleString('en-US')}× real time`;
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
  if (geom.scan !== 'whiskbroom') return null;
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
  const future = swathTrack(orbit, t, t + periodMs, TRACK_SAMPLES, geom.edges);
  const beam = whiskBeam(now);
  const inst = currentInstrument();

  globe.update({
    pos: sub.pos, vel: sub.vel, theta: sub.theta,
    sunDir: sunEci(t).dir,
    orbitPath: orbitPath(orbit, t, 256),
    pastTrack, edges: geom.edges, beam, recorder, tail, cloudSystems,
  });
  map.render({
    sub, pastTrack, future, nowMs: t, swathColor: PALETTE.swath[inst.kind],
    recorder, tail, cloudSystems, beam,
  });
  inset.tick(dt);
  recCtl.update(recorder);
  hud.update({
    utc: fmt.utc(t),
    local: fmt.hhmm(meanLocalTime(sub.lonDeg, t)),
    ltdn: fmt.hhmm(orbit.ltdnHours),
    lat: fmt.lat(sub.latDeg),
    lon: fmt.lon(sub.lonDeg),
    alt: fmt.km(sub.altKm),
    speed: fmt.kms(sub.speedKmS),
    period: fmt.min(orbit.nodalPeriodS),
    inc: fmt.deg((orbit.i * 180) / Math.PI),
    orbit: String(orbitBase + orbitNumber(orbit, t)),
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for the console / automated checks
window.__app = {
  clock, sensor: panel.state, globe, map, inset, recorder, clouds, planet, catalog, panel,
  get orbit() { return orbit; },
  get geom() { return geom; },
  setOrbit,
};
