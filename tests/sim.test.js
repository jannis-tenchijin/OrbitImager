// Simulation tests: acquisition timing, swath recorder, cloud field.

import { describe, test, near, assert } from './harness.js';
import { PLANETS, DEFAULT_ORBIT, SENSOR_PRESETS, CLOUDS } from '../js/config.js';
import { createOrbit } from '../js/physics/orbit.js';
import { sensorGeometry, groundSpeedKmS } from '../js/physics/sensor.js';
import { SwathRecorder, STATUS } from '../js/sim/recorder.js';
import { createCloudField } from '../js/geo/clouds.js';

const earth = PLANETS.earth;
const TIR = SENSOR_PRESETS.thermal, VIS = SENSOR_PRESETS.visual;
const H = 3.6e6;
const epoch = Date.UTC(2026, 9, 2, 0, 0, 0);

describe('Acquisition timing');

test('Ground speed at 700 km ≈ 6.762 km/s; thermal line time ≈ 14.75 ms', () => {
  near(groundSpeedKmS(earth, 700), 6.7622, 0.0005, 'v_g');
  near(sensorGeometry(earth, 700, TIR).timing.lineTimeMs, 14.751, 0.005, 'line time');
});

test('Pushbroom dwell = line time (each detector stares a full row)', () => {
  const t = sensorGeometry(earth, 700, TIR, undefined, 'pushbroom').timing;
  near(t.dwellUs, t.lineTimeMs * 1000, 1e-9);
});

test('Whiskbroom: scan period = k·line time (no gap), η = FOV/180°, dwell ≈ 6.7 µs, ≈ 203 rpm', () => {
  const g = sensorGeometry(earth, 700, TIR, undefined, 'whiskbroom');
  const t = g.timing;
  near(t.scanPeriodMs, 10 * t.lineTimeMs, 1e-9, 'period');
  // No-gap: k rows of GSD cover exactly the ground advanced during one scan period
  near(t.rowsPerSweep * g.gsdNadirM, t.groundSpeedMS * t.scanPeriodMs / 1000, 1e-6, 'no gap');
  near(t.earthViewFrac, g.fovDeg / 180, 1e-12, 'eta');
  near(t.dwellUs, 6.691, 0.005, 'dwell');
  near(t.mirrorRpm, 203.4, 0.1, 'rpm');
});

test('Whiskbroom dwell grows with FOV (more of each mirror turn sees Earth)', () => {
  const a = sensorGeometry(earth, 700, TIR, 15, 'whiskbroom').timing;
  const b = sensorGeometry(earth, 700, TIR, 90, 'whiskbroom').timing;
  assert(b.earthViewFrac > a.earthViewFrac && b.dwellUs > a.dwellUs, 'expected longer dwell at wider FOV');
  assert(b.calibrationMs / b.scanPeriodMs < a.calibrationMs / a.scanPeriodMs, 'calibration share should shrink');
});

describe('Swath recorder');

function runCycle(preset, clouds = null, hours = 26) {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const rec = new SwathRecorder(orbit, { clouds });
  rec.configure({
    swathKm: sensorGeometry(earth, 700, preset).swathKm,
    sensorId: preset.id,
    recordsAtNight: preset.recordsAtNight,
  });
  rec.startRecording(epoch);
  rec.advance(epoch + hours * H);
  return { orbit, rec };
}

const thermalRun = runCycle(TIR);

test('Thermal cycle completes by circling the globe after 15 orbits (≈ 24.72 h)', () => {
  const { orbit, rec } = thermalRun;
  assert(rec.mode === 'complete', `mode ${rec.mode}`);
  assert(rec.stats.reason === 'circled globe', `reason ${rec.stats.reason}`);
  near(rec.stats.orbits, 15, 0, 'orbits');
  near((rec.stats.completedAt - epoch) / H, (15 * orbit.nodalPeriodS) / 3600, 1e-6, 'completion time');
  near(rec.progress(rec.stats.completedAt), 1, 0, 'progress');
});

test('Thermal daily usable coverage is 12–22% of the globe (186 km swath, day + night)', () => {
  const { usablePct, cloudyPct } = thermalRun.rec.summary();
  assert(usablePct > 12 && usablePct < 22, `usable ${usablePct.toFixed(2)}%`);
  near(cloudyPct, 0, 0, 'no clouds -> 0% cloudy');
});

test('Visual records only in daylight: night rows are NONE, coverage < 60% of thermal', () => {
  const { orbit, rec } = runCycle(VIS);
  const nightRow = rec.makeSample(epoch + (orbit.nodalPeriodS * 1000) / 2); // ascending node, 22:30
  assert(Array.from(nightRow.cst).every((s) => s === STATUS.NONE), 'night row should be NONE');
  const vis = rec.summary().usablePct, tir = thermalRun.rec.summary().usablePct;
  assert(vis > 4 && vis < 0.6 * tir, `visual ${vis.toFixed(2)}% vs thermal ${tir.toFixed(2)}%`);
});

test('Thermal night rows are recorded as NIGHT', () => {
  const { orbit, rec } = thermalRun;
  const nightRow = rec.makeSample(epoch + (orbit.nodalPeriodS * 1000) / 2);
  assert(Array.from(nightRow.cst).every((s) => s === STATUS.NIGHT), 'expected NIGHT');
});

test('Fully clouded planet: every recorded cell is CLOUD, usable coverage 0%', () => {
  const { rec } = runCycle(TIR, { isCloudy: () => true }, 3);
  assert(rec.samples.every((s) => Array.from(s.cst).every((c) => c === STATUS.CLOUD)), 'all CLOUD');
  near(rec.summary().usablePct, 0, 0, 'usable');
  near(rec.summary().cloudyPct, 100, 1e-9, 'cloudy');
});

test('Live mode keeps a rolling window of one orbit', () => {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const rec = new SwathRecorder(orbit);
  rec.configure({ swathKm: 186, sensorId: 'thermal', recordsAtNight: true });
  rec.resetLive(epoch + 5 * H);
  rec.advance(epoch + 8 * H);
  const span = rec.samples.at(-1).tMs - rec.samples[0].tMs;
  assert(span <= orbit.nodalPeriodS * 1000 && span > 0.98 * orbit.nodalPeriodS * 1000, `span ${span}`);
});

describe('Cloud field');

const field = createCloudField(CLOUDS, earth.radiusKm);
const DEG = Math.PI / 180;
function samplePoints(n) {
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => {
    const lat = Math.asin(2 * r() - 1), lon = r() * 2 * Math.PI;
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  });
}

test('Deterministic: same seed + time -> same answer', () => {
  const other = createCloudField(CLOUDS, earth.radiusKm);
  const pts = samplePoints(300);
  assert(pts.every((p) => field.isCloudy(p, epoch) === other.isCloudy(p, epoch)), 'fields disagree');
});

test('Global cloud fraction between 5% and 30%', () => {
  const pts = samplePoints(4000);
  const frac = pts.filter((p) => field.isCloudy(p, epoch)).length / pts.length;
  assert(frac > 0.05 && frac < 0.3, `fraction ${(frac * 100).toFixed(1)}%`);
});

test('Systems drift with the wind and evolve (scale changes) over 2 h', () => {
  const a = field.systemsAt(epoch), b = field.systemsAt(epoch + 2 * H);
  let moved = 0, checked = 0;
  for (const s of a) {
    const t = b.find((x) => x.id === s.id && x.gen === s.gen);
    if (!t) continue;
    checked++;
    const dLon = t.lonDeg - s.lonDeg;
    const expectEast = Math.abs(s.latDeg) >= 35, expectWest = Math.abs(s.latDeg) <= 25;
    if ((expectEast && dLon > 0) || (expectWest && dLon < 0) || (!expectEast && !expectWest)) moved++;
    assert(t.scale !== s.scale, 'scale should evolve');
  }
  assert(checked > 50 && moved === checked, `moved ${moved}/${checked}`);
});
