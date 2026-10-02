// Simulation tests: acquisition timing, swath recorder, cloud field.

import { describe, test, near, assert } from './harness.js';
import { PLANETS, DEFAULT_ORBIT, SENSOR_PRESETS, SATELLITES, CLOUDS } from '../js/config.js';
import { createOrbit, retargetOrbit, subSatellitePoint, orbitalPeriod } from '../js/physics/orbit.js';
import { sensorGeometry, groundSpeedKmS, instrumentGeometry, nativeFovDeg, swathWidth } from '../js/physics/sensor.js';
import { resolveCatalog, fromPublished } from '../js/physics/instruments.js';
import { SwathRecorder, STATUS, quadContains } from '../js/sim/recorder.js';
import { TARGETS } from '../js/geo/targets.js';
import { createCloudField } from '../js/geo/clouds.js';

const earth = PLANETS.earth;
const TIR = SENSOR_PRESETS.thermal, VIS = SENSOR_PRESETS.visual;
const H = 3.6e6;
const DEG = Math.PI / 180;
const epoch = Date.UTC(2026, 9, 2, 0, 0, 0);
const CAT = resolveCatalog(earth, SATELLITES); // simulator-ready instruments

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

const CYCLE_H = 24.72; // 15 orbits at 700 km

function runRecording(preset, clouds = null, hours = CYCLE_H) {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const rec = new SwathRecorder(orbit, { clouds });
  const g = sensorGeometry(earth, 700, preset);
  rec.configure({ edges: g.edges, kind: preset.kind, recordsAtNight: preset.recordsAtNight });
  rec.startRecording(epoch);
  rec.advance(epoch + hours * H);
  return { orbit, rec };
}

const thermalRun = runRecording(TIR);

test('Recording keeps going past one cycle until stop(), then holds', () => {
  const { rec } = runRecording(TIR, null, 30);
  assert(rec.mode === 'recording', `mode ${rec.mode}`);
  near(rec.summary().orbits, 18, 0, 'orbits flown in 30 h');
  const n = rec.samples.length;
  rec.stop();
  rec.advance(epoch + 40 * H);
  assert(rec.mode === 'stopped' && rec.samples.length === n, 'stopped recorder must not grow');
});

test('Thermal daily usable coverage is 12–22% of the globe (186 km swath, day + night)', () => {
  const { usablePct, cloudyPct } = thermalRun.rec.summary();
  assert(usablePct > 12 && usablePct < 22, `usable ${usablePct.toFixed(2)}%`);
  near(cloudyPct, 0, 0, 'no clouds -> 0% cloudy');
});

test('Coverage keeps growing with more days (3 d > 1 d)', () => {
  const three = runRecording(TIR, null, 3 * CYCLE_H).rec.summary().usablePct;
  assert(three > thermalRun.rec.summary().usablePct * 1.8, `3 days only ${three.toFixed(1)}%`);
});

test('Visual records only in daylight: night rows are NONE, coverage < 60% of thermal', () => {
  const { orbit, rec } = runRecording(VIS);
  const nightRow = rec.makeSample(epoch + (orbit.nodalPeriodS * 1000) / 2); // ascending node, 22:30
  assert(Array.from(nightRow.cst).every((s) => s === STATUS.NONE), 'night row should be NONE');
  const vis = rec.summary().usablePct, tir = thermalRun.rec.summary().usablePct;
  assert(vis > 4 && vis < 0.6 * tir, `visual ${vis.toFixed(2)}% vs thermal ${tir.toFixed(2)}%`);
});

test('Thermal night rows are recorded (NIGHT status, same color as day)', () => {
  const { orbit, rec } = thermalRun;
  const nightRow = rec.makeSample(epoch + (orbit.nodalPeriodS * 1000) / 2);
  assert(Array.from(nightRow.cst).every((s) => s === STATUS.NIGHT), 'expected NIGHT');
});

test('Fully clouded planet: every recorded cell is CLOUD, usable coverage 0%', () => {
  const { rec } = runRecording(TIR, { isCloudy: () => true }, 3);
  assert(rec.samples.every((s) => Array.from(s.cst).every((c) => c === STATUS.CLOUD)), 'all CLOUD');
  near(rec.summary().usablePct, 0, 0, 'usable');
  near(rec.summary().cloudyPct, 100, 1e-9, 'cloudy');
});

test('SAR sees through clouds and records at night', () => {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const rec = new SwathRecorder(orbit, { clouds: { isCloudy: () => true } });
  const g = instrumentGeometry(earth, 700, CAT.sentinel1.instruments.csar, { modeId: 'IW' });
  rec.configure({ edges: g.edges, kind: 'sar', recordsAtNight: true, seesThroughClouds: true });
  rec.startRecording(epoch);
  rec.advance(epoch + 3 * H);
  assert(rec.samples.every((s) => Array.from(s.cst).every((c) => c === STATUS.DAY || c === STATUS.NIGHT)), 'no CLOUD/NONE');
  near(rec.summary().cloudyPct, 0, 0, 'cloudy');
});

test('Safety cap stops the recording ("buffer full")', () => {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const rec = new SwathRecorder(orbit, { maxRows: 500 });
  rec.configure({ swathKm: 186 });
  rec.startRecording(epoch);
  rec.advance(epoch + 10 * H);
  assert(rec.mode === 'stopped' && rec.stats.reason === 'buffer full' && rec.samples.length === 500, `${rec.mode} ${rec.samples.length}`);
});

test('Changing the orbit mid-recording keeps recorded rows', () => {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const rec = new SwathRecorder(orbit);
  rec.configure({ swathKm: 186 });
  rec.startRecording(epoch);
  rec.advance(epoch + 2 * H);
  const n = rec.samples.length, first = rec.samples[0].tMs;
  rec.setOrbit(retargetOrbit(orbit, epoch + 2 * H, { altitudeKm: 900, ltdnHours: 10.5 }));
  rec.advance(epoch + 4 * H);
  assert(rec.samples[0].tMs === first && rec.samples.length > n, 'rows kept and extended');
});

test('Live mode keeps a rolling window of one orbit', () => {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const rec = new SwathRecorder(orbit);
  rec.configure({ swathKm: 186, kind: 'thermal', recordsAtNight: true });
  rec.resetLive(epoch + 5 * H);
  rec.advance(epoch + 8 * H);
  const span = rec.samples.at(-1).tMs - rec.samples[0].tMs;
  assert(span <= orbit.nodalPeriodS * 1000 && span > 0.98 * orbit.nodalPeriodS * 1000, `span ${span}`);
});

describe('Orbit changes (altitude slider / presets)');

test('Retargeted orbit continues smoothly: shift ≤ the SSO inclination change', () => {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const t = epoch + 1.3 * H; // high latitude (~74°N): worst case for an inclination change
  const next = retargetOrbit(orbit, t, { altitudeKm: 900, ltdnHours: 10.5 });
  const a = subSatellitePoint(orbit, t), b = subSatellitePoint(next, t);
  const dInc = Math.abs(next.i - orbit.i) * 180 / Math.PI; // 700 -> 900 km SSO: ~0.8°
  const dist = Math.acos(Math.min(1, Math.sin(a.latDeg * DEG) * Math.sin(b.latDeg * DEG)
    + Math.cos(a.latDeg * DEG) * Math.cos(b.latDeg * DEG) * Math.cos((b.lonDeg - a.lonDeg) * DEG))) / DEG;
  assert(dist <= dInc + 0.01, `moved ${dist.toFixed(3)}° > Δi ${dInc.toFixed(3)}°`);
  near(b.altKm, 900, 1e-6, 'altitude');
  const eq = subSatellitePoint(retargetOrbit(orbit, epoch, { altitudeKm: 900, ltdnHours: 10.5 }), epoch);
  near(eq.latDeg, 0, 1e-6, 'at the node the position is unchanged');
});

test('Higher orbit: longer period, slower speed, wider swath, coarser GSD; SAR resolution unchanged', () => {
  const lo = createOrbit(earth, { ...DEFAULT_ORBIT, altitudeKm: 500 }, epoch);
  const hi = createOrbit(earth, { ...DEFAULT_ORBIT, altitudeKm: 900 }, epoch);
  assert(hi.nodalPeriodS > lo.nodalPeriodS && groundSpeedKmS(earth, 900) < groundSpeedKmS(earth, 500), 'period/speed');
  near(orbitalPeriod(earth, earth.radiusKm + 900) / 60, 102.99, 0.01, 'Kepler period at 900 km');
  const gl = sensorGeometry(earth, 500, TIR), gh = sensorGeometry(earth, 900, TIR);
  assert(gh.swathKm > gl.swathKm && gh.gsdNadirM > gl.gsdNadirM, 'optical scales with altitude');
  const sar = CAT.sentinel1.instruments.csar;
  const sl = instrumentGeometry(earth, 500, sar, { modeId: 'IW' }), sh = instrumentGeometry(earth, 900, sar, { modeId: 'IW' });
  assert(sl.resRangeM === sh.resRangeM && sl.resAzM === sh.resAzM, 'SAR resolution independent of altitude');
  assert(sh.swathKm > sl.swathKm, 'SAR swath grows with altitude');
});

describe('Satellite presets');


test('Every optical preset reproduces its published swath and GSD at the mission altitude (≤ 1%)', () => {
  for (const sat of Object.values(SATELLITES)) {
    for (const [id, raw] of Object.entries(sat.instruments)) {
      if (raw.kind === 'sar' || raw.gsdM == null) continue;
      const inst = CAT[Object.keys(SATELLITES).find((k) => SATELLITES[k] === sat)].instruments[id];
      const g = sensorGeometry(earth, sat.orbit.altitudeKm, inst);
      near(g.swathKm / raw.swathKm, 1, 0.01, `${sat.name} ${raw.label} swath`);
      near(g.gsdNadirM / raw.gsdM, 1, 1e-9, `${sat.name} ${raw.label} GSD`);
    }
  }
});

test('Landsat TIRS: derived pixels ≈ 1850, focal ≈ 177 mm (published 176.7 mm)', () => {
  const inst = CAT.landsat89.instruments.tirs;
  near(inst.pixelsCrossTrack, 1850, 20, 'pixels');
  near(sensorGeometry(earth, 705, inst).focalLengthMm, 176.7, 2, 'focal');
});

test('GCOM-C SGLI-IRS: whiskbroom, FOV ≈ 80°, focal ≈ 448 mm (140 µm pitch)', () => {
  const inst = CAT.gcomc.instruments.irs;
  const g = sensorGeometry(earth, 798, inst);
  near(g.fovDeg, 80, 0.6, 'FOV');
  near(g.focalLengthMm, 448, 3, 'focal');
  assert(g.scan === 'whiskbroom' && g.timing.rowsPerSweep === 20, 'scan type');
});

test('Sentinel-1 IW: right-looking, nadir gap, 250 km swath, incidence ≈ 29–46°', () => {
  const g = instrumentGeometry(earth, 693, CAT.sentinel1.instruments.csar, { modeId: 'IW' });
  assert(g.edges.left < 0 && g.edges.right < 0, 'both edges right of track');
  assert(g.nadirGapKm > 200, `nadir gap ${g.nadirGapKm.toFixed(0)} km`);
  near(g.swathKm, 250, 0.5, 'swath');
  near(g.incNearDeg, 29.1, 1.5, 'near incidence');
  near(g.incFarDeg, 46.0, 1.5, 'far incidence');
});

test('ALOS-4 Stripmap: 200 km swath within the published 30–44° incidence band', () => {
  const g = instrumentGeometry(earth, 628, CAT.alos4.instruments.palsar3, { modeId: 'SM' });
  near(g.swathKm, 200, 0.5, 'swath');
  assert(g.incNearDeg > 28 && g.incFarDeg < 46, `incidence ${g.incNearDeg.toFixed(1)}–${g.incFarDeg.toFixed(1)}`);
});

test('fromPublished inverts the spherical swath formula', () => {
  const { nativeIfovUrad, pixelsCrossTrack } = fromPublished(earth.radiusKm, 798, 250, 1400);
  const fov = nativeIfovUrad * 1e-6 * pixelsCrossTrack;
  near(swathWidth(earth.radiusKm, 798, fov / 2), 1400, 1, 'swath');
});

test('Framing camera (SatVu): frame period = frame rows × line time, dwell = frame period', () => {
  const g = sensorGeometry(earth, 530, CAT.satvu.instruments.mwir);
  near(g.timing.framePeriodMs, 1290 * g.timing.lineTimeMs, 1e-9, 'frame period');
  near(g.timing.dwellUs, g.timing.framePeriodMs * 1000, 1e-6, 'dwell');
});

describe('Results: coverage + place statistics');

const unitOf = (lat, lon) => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];

test('Summary: Earth covered ≥ usable; all-cloud → covered > 0, usable 0', () => {
  const s = thermalRun.rec.summary();
  assert(s.coveredPct >= s.usablePct, `${s.coveredPct} < ${s.usablePct}`);
  const c = runRecording(TIR, { isCloudy: () => true }, 3).rec.summary();
  assert(c.coveredPct > 0 && c.usablePct === 0, `covered ${c.coveredPct}, usable ${c.usablePct}`);
});

const tokyo = unitOf(35.68, 139.69);
const tirs16 = (() => {
  const inst = CAT.landsat89.instruments.tirs;
  const orbit = createOrbit(earth, { ...DEFAULT_ORBIT, ...SATELLITES.landsat89.orbit }, epoch);
  const rec = new SwathRecorder(orbit, { clouds: createCloudField(CLOUDS, earth.radiusKm), maxRows: 1e6 });
  const g = sensorGeometry(earth, 705, inst);
  rec.configure({ edges: g.edges, kind: 'thermal', recordsAtNight: true });
  rec.startRecording(epoch);
  rec.advance(epoch + 16 * 24 * H);
  return rec;
})();

test('Landsat TIRS, 16 days over Tokyo: day + night images, cloudy + usable = images', () => {
  const p = tirs16.placeStats(tokyo);
  assert(p.images >= 2 && p.images <= 8, `images ${p.images}`); // 16-day repeat: ~1 day + ~1 night pass (+ edge overlaps)
  near(p.cloudy + p.usable, p.images, 0, 'cloudy + usable');
  near(p.everyDays, p.days / p.images, 1e-9, 'every X days');
  near(p.days, 16, 0.01, 'duration');
});

test('Visual records the day pass only; the night pass counts as "no data"', () => {
  const orbit = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const mk = (preset) => {
    const rec = new SwathRecorder(orbit);
    // 110° whiskbroom (~2300 km swath): every near-equator point gets day AND night passes daily
    rec.configure({ edges: sensorGeometry(earth, 700, preset, 110, 'whiskbroom').edges, kind: preset.kind, recordsAtNight: preset.recordsAtNight });
    rec.startRecording(epoch);
    rec.advance(epoch + 3 * 24 * H);
    return rec;
  };
  // A point right under the first descending (day) pass
  const p0 = subSatellitePoint(orbit, epoch);
  const u = unitOf(p0.latDeg, p0.lonDeg);
  const t = mk(TIR).placeStats(u), v = mk(VIS).placeStats(u);
  assert(t.images > v.images && v.nightNoData > 0 && t.nightNoData === 0, `thermal ${t.images}, visual ${v.images} (+${v.nightNoData} night)`);
});

describe('SatVu: tasked frames (no strip)');

const satvu = (() => {
  const inst = CAT.satvu.instruments.mwir;
  const orbit = createOrbit(earth, { ...DEFAULT_ORBIT, ...SATELLITES.satvu.orbit }, epoch);
  const rec = new SwathRecorder(orbit);
  const g = sensorGeometry(earth, 530, inst);
  rec.configure({ edges: g.edges, kind: 'thermal', recordsAtNight: true, imaging: g.imaging, targets: TARGETS, accessLam: g.accessLam, frameKm: g.frameKm });
  rec.startRecording(epoch);
  rec.advance(epoch + 2 * 24 * H);
  return { rec, g };
})();

test('80 fixed targets; 2 days → frames only at targets, no strip rows, off-nadir ≤ 30°', () => {
  near(TARGETS.length, 80, 0, 'targets');
  const { rec, g } = satvu;
  assert(rec.samples.length === 0, 'no strip rows');
  assert(rec.frames.length > 20, `frames ${rec.frames.length}`);
  near(g.frameKm.along, 4.5, 0.05, 'frame length');
  for (const f of rec.frames) {
    assert(f.offNadirDeg <= 30.01, `${f.name} off-nadir ${f.offNadirDeg}`);
    assert(quadContains(f.corners, TARGETS[f.targetId].u), `${f.name} frame misses its target`);
  }
});

test('A tasked city gets images; a random non-target place gets none', () => {
  const imaged = satvu.rec.frames[0];
  assert(satvu.rec.placeStats(TARGETS[imaged.targetId].u).images >= 1, 'target imaged');
  near(satvu.rec.placeStats(unitOf(-20, -140)).images, 0, 0, 'mid-Pacific'); // no city there
  const s = satvu.rec.summary();
  assert(s.coveredPct > 0 && s.coveredPct < 0.01, `covered ${s.coveredPct}%`); // 80 × 16 km² ≪ Earth
});

describe('Cloud field');

const field = createCloudField(CLOUDS, earth.radiusKm);
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
