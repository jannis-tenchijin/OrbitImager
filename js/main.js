// App entry: wires physics -> recorder -> globe + map + panels in a single animation loop.

import {
  PLANETS, DEFAULT_PLANET, DEFAULT_ORBIT, SATELLITES, DEFAULT_SATELLITE, DEFAULT_INSTRUMENT,
  FOV_RANGE_DEG, ALTITUDE_RANGE_KM, MAX_RECORD_ROWS, CLOSEUP, CLOUDS, VISUAL_MIN_SUN_ELEV_DEG,
  PALETTE, TIME_WARPS, DEFAULT_WARP, SATELLITE_MODEL_SCALE,
} from './config.js';
import {
  createOrbit, retargetOrbit, subSatellitePoint, groundTrack, swathTrack, orbitPath, orbitNumber,
  frameFootprint, latLonToEcef,
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
import { createResultsPanel } from './ui/resultsPanel.js';
import { TARGETS } from './geo/targets.js';

const TRACK_SAMPLES = 300;     // per half (past / future)
const MAX_REAL_DT = 0.1;       // s; clamp after tab switches so the sim doesn't jump
const GLOBE_TEXTURE_WIDTH = 4096;
const WHISK_VISUAL_SWEEP_S = 1.6; // real seconds per mirror sweep in the 3D/map views (cartoon rate)
const SHOT_S = 1.0;               // real seconds a tasked-frame "shot" stays visible in 3D/map
const RESULTS_HZ = 2;             // place statistics refresh rate while recording
const SNAP_KM = 150;              // picked places snap to a listed city within this distance
const SHOT_DISPLAY_KM = 60;       // tasked-frame pyramid footprint drawn at least this long (real ~4.5 km)

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
globe.setTargets(TARGETS);

// Picked place for revisit statistics (map click); stats are cached per data version
let place = null;
let placeCache = { key: null, stats: null };
const results = createResultsPanel(document.getElementById('results'), {
  onPickStart: () => map.startPicking((latDeg, lonDeg) => {
    // Snap to a listed city within ~150 km: a map pixel is ~50 km, a SatVu frame only ~4 km
    const u = latLonToEcef(latDeg, lonDeg, 1);
    let best = null, bestDot = Math.cos(SNAP_KM / planet.radiusKm);
    for (const t of TARGETS) {
      const d = u[0] * t.u[0] + u[1] * t.u[1] + u[2] * t.u[2];
      if (d > bestDot) [best, bestDot] = [t, d];
    }
    place = best
      ? { latDeg: best.latDeg, lonDeg: best.lonDeg, u: best.u, name: best.name }
      : { latDeg, lonDeg, u, name: null };
    map.setPin(place);
    globe.setPin(place);
    placeCache.key = null;
    results.pickDone();
  }),
  onClearPlace: () => {
    place = null;
    map.setPin(null);
    globe.setPin(null);
  },
});
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
    const wasTargeted = recorder.targeted;
    applySensor();
    // A different instrument (or imaging mode) means different data: restart / refill
    if (what === 'satellite' || what === 'instrument' || recorder.targeted !== wasTargeted) {
      if (recorder.mode === 'recording') recorder.startRecording(clock.simMs);
      else if (recorder.mode === 'live') recorder.resetLive(clock.simMs);
    }
  },
});

function currentInstrument() {
  return catalog[panel.state.satId].instruments[panel.state.instId];
}

/** Tasked (SatVu) imaging applies to its framing camera; a what-if scan switch makes it a strip. */
const isTargeted = () => geom.imaging === 'targeted' && geom.scan === 'framing';

/** Recompute derived sensor geometry (depends on altitude) and push it everywhere. */
function applySensor() {
  const inst = currentInstrument();
  geom = instrumentGeometry(planet, orbit.altitudeKm, inst, panel.state);
  const targeted = isTargeted();
  recorder.configure({
    edges: geom.edges, kind: inst.kind, recordsAtNight: inst.recordsAtNight, seesThroughClouds: inst.kind === 'sar',
    imaging: targeted ? 'targeted' : 'strip', targets: TARGETS, accessLam: geom.accessLam, frameKm: geom.frameKm,
  });
  panel.show(geom);
  inset.set(inst.kind, geom.gsdXM, geom.gsdYM, geom.timing, geom.looks ?? 1, { targeted });
  recCtl.setLegend(inst, { targeted });
  const sensorKey = `${panel.state.satId}:${panel.state.instId}:${panel.state.scan}`;
  if (sensorKey !== lastSensorKey) globe.setSensor(inst, panel.state.scan); // rebuild model only on change
  lastSensorKey = sensorKey;
  placeCache.key = null;
}
let lastSensorKey = null;

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

/**
 * Framing visuals. Targeted: the newest tasked frame for SHOT_S real seconds. Strip framing: the
 * current exposure (frames start every framePeriod of sim time) + the previous few, tiled.
 */
let lastShot = null, lastShotAt = -1e9;
/** Real frames (~4 km) are needle-thin at globe scale: draw the shot's footprint scaled up. */
function enlarge(frame, f) {
  const c = frame.u;
  return frame.corners.map((p) => {
    const v = [0, 1, 2].map((k) => c[k] + Math.max(1, f) * (p[k] - c[k]));
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  });
}
function framingState(t, nowReal) {
  if (geom.scan !== 'framing') return null;
  if (isTargeted()) {
    if (recorder.lastFrame !== lastShot) {
      lastShot = recorder.lastFrame;
      lastShotAt = nowReal;
    }
    const age = (nowReal - lastShotAt) / 1000 / SHOT_S;
    return { corners: lastShot && age < 1 ? enlarge(lastShot, SHOT_DISPLAY_KM / geom.frameKm.along) : null, flash: Math.max(0, 1 - age), tiles: [], age };
  }
  const P = geom.timing.framePeriodMs;
  const k = Math.floor(t / P);
  const fp = (j) => frameFootprint(orbit, j * P, geom.edges, geom.frameKm.along);
  // Flash per exposure when frames are slow enough to see; steady glow at high warp
  const realPeriodS = P / clock.warp / 1000;
  const flash = realPeriodS > 0.25 ? Math.max(0, 1 - (t - k * P) / (0.35 * P)) : 0.4;
  return { corners: fp(k), flash, tiles: [1, 2, 3, 4, 5].map((i) => fp(k - i)) };
}

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
  const targeted = isTargeted();
  // Targeted: show the agility corridor instead of swath edges
  const future = swathTrack(orbit, t, t + periodMs, TRACK_SAMPLES,
    targeted ? { left: geom.accessLam, right: -geom.accessLam } : geom.edges);
  const beam = whiskBeam(now);
  const inst = currentInstrument();
  const framing = framingState(t, now);

  globe.update({
    pos: sub.pos, vel: sub.vel, theta: sub.theta,
    sunDir: sunEci(t).dir,
    orbitPath: orbitPath(orbit, t, 256),
    pastTrack, edges: geom.edges, beam, recorder, tail, cloudSystems, framing, kind: inst.kind,
  });
  map.render({
    sub, pastTrack, future, nowMs: t, swathColor: PALETTE.swath[inst.kind],
    recorder, tail, cloudSystems, beam,
    targeted: targeted ? { targets: TARGETS, flashFrame: lastShot, flashAge: framing?.age ?? 1 } : null,
  });
  inset.tick(dt);
  recCtl.update(recorder);
  updateResults(now);
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

/** Results card: global stats every frame (cheap); place stats only when the data changed. */
let lastResults = 0;
function updateResults(nowReal) {
  const summary = recorder.summary();
  let stats = null;
  if (place && recorder.mode !== 'live') {
    const key = `${recorder.version}:${recorder.samples.length}:${recorder.frameVersion}:${place.latDeg}:${place.lonDeg}`;
    const stale = placeCache.key !== key;
    if (stale && (recorder.mode === 'stopped' || placeCache.key === null || nowReal - lastResults > 1000 / RESULTS_HZ)) {
      placeCache = { key, stats: recorder.placeStats(place.u) };
      lastResults = nowReal;
    }
    stats = placeCache.stats;
  }
  results.update({ mode: recorder.mode, summary, place, stats, targeted: isTargeted() });
}

// Debug handle for the console / automated checks
window.__app = {
  clock, sensor: panel.state, globe, map, inset, recorder, clouds, planet, catalog, panel, results,
  get place() { return place; },
  get orbit() { return orbit; },
  get geom() { return geom; },
  setOrbit,
};
