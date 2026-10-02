// Swath recorder: the single source of recorded-swath data for the map and globe.
// Every `step` of sim time it stores one cross-track row of the swath (9 points, 8 cells) with a
// STATUS stamped AT ACQUISITION TIME (day / night / cloud / not recorded). Renderers only draw
// what is stored, so moving clouds or later FOV changes never rewrite recorded data.
//
// Modes: 'live'      rolling window of the last orbit
//        'recording' accumulate from the press of Record until the cycle completes
//        'complete'  frozen result + coverage stats (until cleared / re-recorded)

import { propagate, elementsAt, eciToEcef, ecefToLatLon, swathEdgesEci } from '../physics/orbit.js';
import { sunEci } from '../physics/time.js';

export const STATUS = { NONE: 0, DAY: 1, NIGHT: 2, CLOUD: 3 };
export const CROSS_CELLS = 8;
const VERTS = CROSS_CELLS + 1;
const SAMPLES_PER_ORBIT = 300;
const GRID_DEG = 0.5;               // coverage grid resolution
const GRID_W = 360 / GRID_DEG, GRID_H = 180 / GRID_DEG;
const DEG = Math.PI / 180;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function nlerp(a, b, f) {
  const v = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
const wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

export class SwathRecorder {
  /**
   * orbit: createOrbit() result. clouds: { isCloudy(u, tMs) } or null.
   * minSunElevDeg: sun elevation needed by sensors that do NOT record at night.
   */
  constructor(orbit, { clouds = null, minSunElevDeg = 5 } = {}) {
    this.orbit = orbit;
    this.R = orbit.planet.radiusKm;
    this.clouds = clouds;
    this.sinMinElev = Math.sin(minSunElevDeg * DEG);
    this.periodMs = orbit.nodalPeriodS * 1000;
    this.stepMs = this.periodMs / SAMPLES_PER_ORBIT;
    this.sensor = { swathKm: 0, sensorId: 'thermal', recordsAtNight: true };
    this.samples = [];
    this.version = 0;      // bumps whenever samples are removed (renderers do a full redraw)
    this.mode = 'live';
    this.grid = new Uint8Array(GRID_W * GRID_H);
    this.rowArea = Float64Array.from({ length: GRID_H }, (_, j) => Math.cos((90 - (j + 0.5) * GRID_DEG) * DEG));
    this.totalArea = this.rowArea.reduce((a, b) => a + b, 0) * GRID_W;
  }

  /** Sensor parameters applied to FUTURE samples (past rows keep what they were recorded with). */
  configure({ swathKm, sensorId, recordsAtNight }) {
    this.sensor = { swathKm, sensorId, recordsAtNight };
  }

  /** Live mode, back-filled with the last orbit (the cloud field is a pure function of time). */
  resetLive(tMs) {
    this.mode = 'live';
    this.samples = [];
    this.version++;
    this.lastT = tMs - this.periodMs - this.stepMs;
    this.advance(tMs);
  }

  /** Start a new recording at tMs (clears everything). */
  startRecording(tMs) {
    this.mode = 'recording';
    this.samples = [];
    this.version++;
    this.grid.fill(0);
    this.stats = { usableArea: 0, cloudOnlyArea: 0, imagedArea: 0, orbits: 0, reason: null };
    const sub = this.subPoint(tMs);
    const el = elementsAt(this.orbit, tMs);
    this.start = { tMs, u0: el.argp + el.M, p0: sub.u, lastCrossLon: sub.lonDeg, shiftSum: 0, k: 0 };
    // Estimated cycle length: orbits until the same-phase crossing has walked 360 deg around
    const shiftPerOrbit = Math.abs(this.crossingShiftDeg());
    this.start.expectedOrbits = Math.ceil(360 / shiftPerOrbit);
    this.lastT = tMs - this.stepMs;
    this.addSample(tMs);
    this.lastT = tMs;
  }

  /** Westward shift (deg) of the ground track per nodal orbit: Earth turns under the orbit plane. */
  crossingShiftDeg() {
    const p = this.orbit.planet;
    const earthRate = (2 * Math.PI) / p.siderealDayS - this.orbit.raanDot; // rad/s relative to plane
    return -(earthRate * this.orbit.nodalPeriodS) / DEG;
  }

  /** Progress through the expected cycle, 0..1 (recording) */
  progress(tMs) {
    if (this.mode === 'complete') return 1;
    if (this.mode !== 'recording') return 0;
    return Math.min(1, (tMs - this.start.tMs) / (this.start.expectedOrbits * this.periodMs));
  }

  subPoint(tMs) {
    const st = propagate(this.orbit, tMs);
    const r = Math.hypot(...st.pos);
    const u = eciToEcef(st.pos.map((x) => x / r), st.theta);
    const g = ecefToLatLon(u, 1);
    return { u, latDeg: g.latDeg, lonDeg: g.lonDeg };
  }

  /** Advance to tMs, storing samples on the fixed step grid. */
  advance(tMs) {
    if (this.mode === 'complete') return;
    while (this.lastT + this.stepMs <= tMs) {
      const tb = this.lastT + this.stepMs;
      if (this.mode === 'recording' && this.checkCompletion(this.lastT, tb)) return;
      this.addSample(tb);
      this.lastT = tb;
    }
    if (this.mode === 'live') {
      const cutoff = tMs - this.periodMs;
      let drop = 0;
      while (drop < this.samples.length && this.samples[drop].tMs < cutoff) drop++;
      if (drop) {
        this.samples.splice(0, drop);
        this.version++;
      }
    }
  }

  /**
   * Same-phase crossings (argument of latitude = u0 + 2*pi*k) between ta and tb.
   * Completes when the crossing is within half a swath of the start point ('back at start'),
   * or when crossings have walked 360 deg around the globe ('circled globe').
   */
  checkCompletion(ta, tb) {
    const s = this.start;
    const u = (t) => {
      const el = elementsAt(this.orbit, t);
      return el.argp + el.M;
    };
    const target = s.u0 + 2 * Math.PI * (s.k + 1);
    const ua = u(ta), ub = u(tb);
    if (ub < target) return false;
    const tc = ta + ((target - ua) / (ub - ua)) * (tb - ta); // u(t) is linear in t
    const sub = this.subPoint(tc);
    s.k++;
    s.shiftSum += wrap180(sub.lonDeg - s.lastCrossLon);
    s.lastCrossLon = sub.lonDeg;
    this.stats.orbits = s.k;
    const distKm = angle(sub.u, s.p0) * this.R;
    let reason = null;
    if (distKm <= this.sensor.swathKm / 2) reason = 'back at start';
    else if (Math.abs(s.shiftSum) >= 360) reason = 'circled globe';
    if (!reason) return false;
    this.addSample(tc);
    this.lastT = tc;
    this.mode = 'complete';
    this.stats.reason = reason;
    this.stats.completedAt = tc;
    return true;
  }

  /** Status of one planet-fixed point given the sun direction (planet-fixed). */
  status(u, sun, tMs) {
    const sinElev = dot(u, sun);
    if (!this.sensor.recordsAtNight && sinElev < this.sinMinElev) return STATUS.NONE;
    if (this.clouds && this.clouds.isCloudy(u, tMs)) return STATUS.CLOUD;
    return sinElev >= 0 ? STATUS.DAY : STATUS.NIGHT;
  }

  /** Build one swath row at tMs (not stored). */
  makeSample(tMs) {
    const st = propagate(this.orbit, tMs);
    const lam = Number.isFinite(this.sensor.swathKm) ? this.sensor.swathKm / (2 * this.R) : 0;
    const { left, right } = swathEdgesEci(st.pos, st.vel, Math.cos(lam), Math.sin(lam));
    const sun = eciToEcef(sunEci(tMs).dir, st.theta);
    const pts = [], lat = new Float32Array(VERTS), lon = new Float32Array(VERTS);
    const vst = new Uint8Array(VERTS), cst = new Uint8Array(CROSS_CELLS);
    for (let c = 0; c < VERTS; c++) {
      const p = eciToEcef(nlerp(left, right, c / CROSS_CELLS), st.theta);
      pts.push(p);
      const g = ecefToLatLon(p, 1);
      lat[c] = g.latDeg;
      lon[c] = g.lonDeg;
      vst[c] = this.status(p, sun, tMs);
    }
    for (let c = 0; c < CROSS_CELLS; c++) cst[c] = this.status(nlerp(pts[c], pts[c + 1], 0.5), sun, tMs);
    return { tMs, pts, lat, lon, vst, cst, sensorId: this.sensor.sensorId };
  }

  addSample(tMs) {
    const s = this.makeSample(tMs);
    const prev = this.samples[this.samples.length - 1];
    this.samples.push(s);
    if (this.mode === 'recording' && prev) this.markCoverage(prev, s);
  }

  /** Provisional row at "now" so the drawn swath reaches the scan line between samples. */
  tail(tMs) {
    if (this.mode === 'complete' || !this.samples.length) return null;
    return this.makeSample(tMs);
  }

  /**
   * Mark the coverage grid for the cells between two rows. A grid cell counts only if its CENTER
   * lies inside the swath cell (spherical point-in-quad) — unbiased, unlike "touched" marking,
   * which dilates every stripe by ~half a grid cell per side.
   */
  markCoverage(a, b) {
    for (let c = 0; c < CROSS_CELLS; c++) {
      const st = b.cst[c];
      if (st !== STATUS.NONE) this.markQuad([a.pts[c], a.pts[c + 1], b.pts[c + 1], b.pts[c]], st === STATUS.CLOUD ? 2 : 1);
    }
  }

  markQuad(V, bit) {
    const lats = V.map((v) => Math.asin(v[2]) / DEG);
    const lon0 = Math.atan2(V[0][1], V[0][0]) / DEG;
    const lons = V.map((v) => lon0 + wrap180(Math.atan2(v[1], v[0]) / DEG - lon0));
    const latMax = Math.max(...lats), latMin = Math.min(...lats);
    const r0 = Math.max(0, Math.floor((90 - latMax) / GRID_DEG)), r1 = Math.min(GRID_H - 1, Math.floor((90 - latMin) / GRID_DEG));
    // Near a pole the longitude span is ill-defined: scan all columns in the row band
    const polar = Math.max(Math.abs(latMax), Math.abs(latMin)) > 80;
    const c0 = polar ? 0 : Math.floor((Math.min(...lons) + 180) / GRID_DEG);
    const c1 = polar ? GRID_W - 1 : Math.floor((Math.max(...lons) + 180) / GRID_DEG);
    const n = V.map((v, i) => cross(v, V[(i + 1) % 4])); // edge plane normals
    for (let r = r0; r <= r1; r++) {
      const lat = (90 - (r + 0.5) * GRID_DEG) * DEG, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let cc = c0; cc <= c1; cc++) {
        const col = ((cc % GRID_W) + GRID_W) % GRID_W;
        const lon = (-180 + (col + 0.5) * GRID_DEG) * DEG;
        const P = [cl * Math.cos(lon), cl * Math.sin(lon), sl];
        const s0 = dot(n[0], P), s1 = dot(n[1], P), s2 = dot(n[2], P), s3 = dot(n[3], P);
        const inside = (s0 >= 0 && s1 >= 0 && s2 >= 0 && s3 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0 && s3 <= 0);
        if (inside) this.markIndex(r * GRID_W + col, r, bit);
      }
    }
  }

  markIndex(idx, row, bit) {
    const old = this.grid[idx];
    const nu = old | bit;
    if (nu === old) return;
    this.grid[idx] = nu;
    const area = this.rowArea[row];
    const st = this.stats;
    if (!old) st.imagedArea += area;
    if (nu & 1 && !(old & 1)) {
      st.usableArea += area;
      if (old === 2) st.cloudOnlyArea -= area; // a clear look later rescues a cloudy cell
    } else if (nu === 2 && !old) {
      st.cloudOnlyArea += area;
    }
  }

  /** Coverage summary (percent). */
  summary() {
    const s = this.stats;
    if (!s) return null;
    return {
      orbits: s.orbits,
      reason: s.reason,
      usablePct: (100 * s.usableArea) / this.totalArea,
      cloudyPct: s.imagedArea ? (100 * s.cloudOnlyArea) / s.imagedArea : 0,
    };
  }
}
