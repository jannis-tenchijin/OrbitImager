// In-browser physics tests. Open tests/index.html via the local HTTP server.
// Results render on the page and are exposed on window.__testResults for automation.

import { PLANETS, DEFAULT_ORBIT, SENSOR_PRESETS } from '../js/config.js';
import { julianDate, rotationAngle, sunEci, meanLocalTime } from '../js/physics/time.js';
import {
  createOrbit, orbitalPeriod, sunSyncInclination, propagate,
  ecefToLatLon, latLonToEcef, groundTrack, orbitNumber, subSatellitePoint, swathTrack,
} from '../js/physics/orbit.js';
import {
  swathWidth, sensorGeometry, horizonHalfAngle, crossTrackGsd, nativeFovDeg,
} from '../js/physics/sensor.js';

const earth = PLANETS.earth;
const DEG = Math.PI / 180;
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, msg: err.message });
  }
}

function near(actual, expected, tol, label = '') {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${label} expected ${expected} ± ${tol}, got ${actual}`);
  }
}

// --- Time ---
test('Julian date of Unix epoch is 2440587.5', () => near(julianDate(0), 2440587.5, 1e-9));

test('GMST at J2000 epoch ≈ 280.46°', () => {
  const j2000Ms = Date.UTC(2000, 0, 1, 12, 0, 0);
  near(rotationAngle(earth, j2000Ms) / DEG, 280.46061837, 1e-6);
});

test('GMST at 2024-01-01 00:00 UTC ≈ 100.15° (almanac)', () => {
  near(rotationAngle(earth, Date.UTC(2024, 0, 1)) / DEG, 100.1526, 0.01);
});

test('Sun near vernal equinox (2024-03-20 03:06 UTC) has RA ≈ 0° and dec ≈ 0°', () => {
  const { dir, ra } = sunEci(Date.UTC(2024, 2, 20, 3, 6));
  const raDeg = ra / DEG;
  near(Math.min(raDeg, 360 - raDeg), 0, 0.1, 'RA');
  near(Math.asin(dir[2]) / DEG, 0, 0.1, 'dec');
});

test('Sun at June solstice has declination ≈ +23.44°', () => {
  const { dir } = sunEci(Date.UTC(2024, 5, 20, 20, 51));
  near(Math.asin(dir[2]) / DEG, 23.44, 0.05);
});

// --- Orbit ---
test('Keplerian period at 700 km ≈ 98.77 min', () => {
  near(orbitalPeriod(earth, earth.radiusKm + 700) / 60, 98.773, 0.01);
});

test('Sun-synchronous inclination at 700 km ≈ 98.19°', () => {
  near(sunSyncInclination(earth, 700), 98.188, 0.01);
});

const epoch = Date.UTC(2026, 9, 2, 0, 0, 0);
// Start at the ascending node (M = 0) so node-based checks are simple
const orbit = createOrbit(earth, { ...DEFAULT_ORBIT, meanAnomalyDeg: 0 }, epoch);

test('SSO RAAN drift ≈ +0.9856°/day', () => {
  near((orbit.raanDot * 86400) / DEG, 0.9856, 0.0005);
});

test('Satellite radius stays at 700 km altitude (circular)', () => {
  for (let k = 0; k < 50; k++) {
    const st = propagate(orbit, epoch + k * 137000);
    near(Math.hypot(...st.pos), earth.radiusKm + 700, 1e-6);
  }
});

test('Speed at 700 km ≈ 7.50 km/s', () => {
  near(subSatellitePoint(orbit, epoch).speedKmS, 7.504, 0.005);
});

test('Starts at ascending node: lat ≈ 0 and moving north', () => {
  const a = subSatellitePoint(orbit, epoch);
  const b = subSatellitePoint(orbit, epoch + 10000);
  near(a.latDeg, 0, 1e-6);
  if (!(b.latDeg > a.latDeg)) throw new Error('latitude not increasing');
});

test('Ground track |lat| never exceeds 180° − i', () => {
  const maxLat = 180 - orbit.i / DEG;
  const track = groundTrack(orbit, epoch, epoch + 86400000, 2000);
  const peak = Math.max(...track.map((p) => Math.abs(p.latDeg)));
  if (peak > maxLat + 1e-6) throw new Error(`peak ${peak} > ${maxLat}`);
  near(peak, maxLat, 0.1, 'peak reaches bound');
});

test('Successive ascending nodes shift west by ≈ 24.7°', () => {
  const lon = (t) => subSatellitePoint(orbit, t).lonDeg;
  const shift = ((lon(epoch + orbit.nodalPeriodS * 1000) - lon(epoch) + 540) % 360) - 180;
  near(shift, -24.7, 0.3);
});

test('LTDN = 10:30 mean solar time (UTC + lon/15) in every season', () => {
  // Apparent-sun RAAN would drift by the equation of time (up to ±16 min); mean sun must not.
  for (const ep of [Date.UTC(2026, 1, 11), Date.UTC(2026, 6, 26), Date.UTC(2026, 9, 2), Date.UTC(2026, 10, 3)]) {
    const o = createOrbit(earth, { ...DEFAULT_ORBIT, meanAnomalyDeg: 0 }, ep);
    const tNode = ep + (o.nodalPeriodS * 1000) / 2; // descending node half an orbit later
    const st = subSatellitePoint(o, tNode);
    near(st.latDeg, 0, 0.05, 'lat at descending node');
    near(meanLocalTime(st.lonDeg, tNode), 10.5, 2 / 60, `LTDN at ${new Date(ep).toISOString().slice(0, 10)}`);
  }
});

test('lat/lon → ECEF → lat/lon round-trip', () => {
  for (const [la, lo] of [[35.7, 139.7], [-33.9, 18.4], [0, -179.9], [89, 10]]) {
    const g = ecefToLatLon(latLonToEcef(la, lo, earth.radiusKm), earth.radiusKm);
    near(g.latDeg, la, 1e-9, 'lat');
    near(g.lonDeg, lo, 1e-9, 'lon');
  }
});

test('Orbit number increments after one nodal period', () => {
  if (orbitNumber(orbit, epoch) !== 1) throw new Error('should start at 1');
  if (orbitNumber(orbit, epoch + orbit.nodalPeriodS * 1000 + 1) !== 2) throw new Error('should be 2');
});

test('Default orbit starts at descending node (daylight pass)', () => {
  const o = createOrbit(earth, DEFAULT_ORBIT, epoch);
  const a = subSatellitePoint(o, epoch), b = subSatellitePoint(o, epoch + 10000);
  near(a.latDeg, 0, 1e-6);
  if (!(b.latDeg < a.latDeg)) throw new Error('latitude not decreasing');
  if (orbitNumber(o, epoch) !== 1) throw new Error('orbit # should start at 1');
});

// --- Sensor geometry (the relationships the sim is meant to show) ---
const TIR = SENSOR_PRESETS.thermal, VIS = SENSOR_PRESETS.visual;
const geo = (alt, preset = TIR, fov) => sensorGeometry(earth, alt, preset, fov);

test('Landsat check: 705 km, 15° FOV -> 185 km swath', () => {
  near(swathWidth(earth.radiusKm, 705, 7.5 * DEG), 185.8, 0.5);
});

test('Thermal preset (TIRS-like) at 700 km: ~100 m GSD, 15.1° FOV, ~186 km swath, f ≈ 175 mm', () => {
  const g = geo(700);
  near(g.gsdNadirM, 99.75, 0.01, 'GSD');
  near(g.fovDeg, 15.105, 0.005, 'FOV');
  near(g.swathKm, 185.8, 0.2, 'swath');
  near(g.focalLengthMm, 175.4, 0.1, 'focal length');
});

test('Visual preset (OLI-like) at 700 km: ~30 m GSD, same ~186 km swath', () => {
  const g = geo(700, VIS);
  near(g.gsdNadirM, 29.82, 0.01, 'GSD');
  near(g.swathKm, 186.15, 0.2, 'swath');
});

test('Wider FOV, same detector array -> wider swath, coarser GSD, shorter focal length', () => {
  const a = geo(700), b = geo(700, TIR, 30);
  near(b.pixelsCrossTrack, a.pixelsCrossTrack, 0, 'pixel count fixed');
  near(b.ifovUrad, 283.03, 0.05, 'IFOV = FOV / N');
  near(b.gsdNadirM, 198.1, 0.1, 'GSD');
  near(b.swathKm, 376.7, 0.3, 'swath');
  if (!(b.focalLengthMm < a.focalLengthMm)) throw new Error('focal length should shrink');
});

test('Higher altitude -> wider swath and coarser GSD', () => {
  const lo = geo(500), hi = geo(900);
  if (!(hi.swathKm > lo.swathKm)) throw new Error('swath did not grow');
  if (!(hi.gsdNadirM > lo.gsdNadirM)) throw new Error('GSD did not grow');
});

test('Edge GSD = nadir GSD at η→0 and grows toward the swath edge', () => {
  const ifov = 142.5e-6;
  near(crossTrackGsd(earth.radiusKm, 700, ifov, 1e-9), 700 * 1000 * ifov, 1e-6, 'nadir');
  near(geo(700).gsdEdgeM, 101.8, 0.1, 'native edge');
  near(geo(700, TIR, 110).gsdEdgeM, 3492, 2, '110° edge');
});

test('Spherical swath > flat-earth swath; FOV past horizon -> NaN', () => {
  const g = geo(700);
  if (!(g.swathKm > g.swathFlatKm)) throw new Error('curvature should widen swath');
  const hz = horizonHalfAngle(earth.radiusKm, 700);
  if (!Number.isNaN(swathWidth(earth.radiusKm, 700, hz + 0.01))) throw new Error('expected NaN');
  near(nativeFovDeg(TIR), 15.105, 0.005, 'native FOV');
});

test('Swath edges: left↔right great-circle distance = swath, midpoint = nadir', () => {
  const swathKm = geo(700, TIR, 30).swathKm;
  const pts = swathTrack(orbit, epoch, epoch + 3e6, 7, swathKm);
  const toVec = (p) => latLonToEcef(p.latDeg, p.lonDeg, 1);
  const angle = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  for (const p of pts) {
    const l = toVec(p.left), r = toVec(p.right), c = toVec(p);
    near(angle(l, r) * earth.radiusKm, swathKm, 1e-6, 'edge distance');
    near(angle(l, c), angle(r, c), 1e-9, 'symmetric about nadir');
  }
});

// --- Render results ---
window.__testResults = results;
const passed = results.filter((r) => r.ok).length;
const list = document.getElementById('results');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ' — ' + r.msg}`;
  list.appendChild(li);
}
document.getElementById('summary').textContent = `${passed}/${results.length} passed`;
document.title = `${passed === results.length ? '✅' : '❌'} ${passed}/${results.length} tests`;
