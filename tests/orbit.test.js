// In-browser physics tests. Open tests/index.html via the local HTTP server.
// Results render on the page and are exposed on window.__testResults for automation.

import { PLANETS, DEFAULT_ORBIT, DEFAULT_SENSOR } from '../js/config.js';
import { julianDate, rotationAngle, sunEci } from '../js/physics/time.js';
import {
  createOrbit, orbitalPeriod, sunSyncInclination, propagate, eciToEcef,
  ecefToLatLon, latLonToEcef, groundTrack, orbitNumber, subSatellitePoint,
} from '../js/physics/orbit.js';
import { swathWidth, sensorGeometry, horizonHalfAngle } from '../js/physics/sensor.js';

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

test('Descending node local solar time ≈ 10:30', () => {
  // Find descending node in first orbit: lat crosses 0 going south
  const half = epoch + (orbit.nodalPeriodS * 1000) / 2;
  const st = subSatellitePoint(orbit, half);
  near(st.latDeg, 0, 0.5, 'lat at half orbit');
  const sunEcef = eciToEcef(sunEci(half).dir, st.theta);
  const sunLon = Math.atan2(sunEcef[1], sunEcef[0]) / DEG;
  const lst = ((((st.lonDeg - sunLon) / 15 + 12) % 24) + 24) % 24;
  near(lst, 10.5, 0.1);
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
const geo = (alt, s = {}) => sensorGeometry(earth, alt, { ...DEFAULT_SENSOR, ...s });

test('Landsat check: 705 km, 15° FOV -> 185 km swath', () => {
  near(swathWidth(earth.radiusKm, 705, 7.5 * DEG), 185.8, 0.5);
});

test('Default sensor ≈ 10 m GSD, ≈ 23° FOV, ≈ 285 km swath at 700 km', () => {
  const g = geo(700);
  near(g.gsdNadirM, 10.0, 0.05, 'GSD');
  near(g.fovDeg, 22.94, 0.01, 'FOV');
  near(g.swathKm, 284.8, 0.5, 'swath');
});

test('Higher altitude -> wider swath and coarser GSD', () => {
  const lo = geo(500), hi = geo(900);
  if (!(hi.swathKm > lo.swathKm)) throw new Error('swath did not grow');
  if (!(hi.gsdNadirM > lo.gsdNadirM)) throw new Error('GSD did not grow');
});

test('Wider FOV (more pixels, same IFOV) -> wider swath, same GSD', () => {
  const a = geo(700), b = geo(700, { pixelsCrossTrack: DEFAULT_SENSOR.pixelsCrossTrack * 2 });
  if (!(b.swathKm > a.swathKm)) throw new Error('swath did not grow');
  near(b.gsdNadirM, a.gsdNadirM, 1e-9, 'GSD');
});

test('Finer resolution (smaller IFOV, same pixels) -> narrower swath', () => {
  const a = geo(700), b = geo(700, { ifovUrad: DEFAULT_SENSOR.ifovUrad / 2 });
  if (!(b.swathKm < a.swathKm)) throw new Error('swath did not shrink');
  near(b.gsdNadirM, a.gsdNadirM / 2, 1e-9, 'GSD halves');
});

test('Spherical swath > flat-earth swath; FOV past horizon -> NaN', () => {
  const g = geo(700);
  if (!(g.swathKm > g.swathFlatKm)) throw new Error('curvature should widen swath');
  const hz = horizonHalfAngle(earth.radiusKm, 700);
  if (!Number.isNaN(swathWidth(earth.radiusKm, 700, hz + 0.01))) throw new Error('expected NaN');
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
