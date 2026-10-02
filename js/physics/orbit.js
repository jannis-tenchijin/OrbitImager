// Orbit propagation: Keplerian elements + J2 secular drift, frame conversions, ground track.
// Frames: ECI (inertial, Z = north pole) and planet-fixed (ECEF-like). Units: km, s, rad.

import { rotationAngle, meanSunRa, wrapTwoPi } from './time.js';

const DEG = Math.PI / 180;

/** Keplerian period (s) for semi-major axis a (km). */
export function orbitalPeriod(planet, a) {
  return 2 * Math.PI * Math.sqrt(a ** 3 / planet.mu);
}

/** Inclination (deg) giving a sun-synchronous orbit at the given altitude. NaN if impossible. */
export function sunSyncInclination(planet, altitudeKm, e = 0) {
  const a = planet.radiusKm + altitudeKm;
  const p = a * (1 - e * e);
  const n = Math.sqrt(planet.mu / a ** 3);
  const raanRateRequired = (2 * Math.PI) / planet.tropicalYearS; // one turn per year
  const cosI = -raanRateRequired / (1.5 * n * planet.J2 * (planet.radiusKm / p) ** 2);
  return Math.abs(cosI) <= 1 ? Math.acos(cosI) / DEG : NaN;
}

/** RAAN (rad) that places the ascending node at local MEAN solar time ltanHours. */
export function raanFromLtan(sunRa, ltanHours) {
  return wrapTwoPi(sunRa + (ltanHours - 12) * 15 * DEG);
}

/**
 * Build an orbit object from config-style elements at epochMs.
 * Resolves SSO inclination (inclinationDeg: null) and RAAN from LTDN (mean sun).
 */
export function createOrbit(planet, cfg, epochMs) {
  const a = planet.radiusKm + cfg.altitudeKm;
  const e = cfg.eccentricity;
  const incDeg = cfg.inclinationDeg ?? sunSyncInclination(planet, cfg.altitudeKm, e);
  const i = incDeg * DEG;
  const ltanHours = (cfg.ltdnHours + 12) % 24; // ascending node is 12 h opposite descending
  const raan0 = cfg.raanDeg != null ? cfg.raanDeg * DEG : raanFromLtan(meanSunRa(epochMs), ltanHours);

  // Secular J2 rates (Vallado eqs.): node regression, apsidal rotation, mean-motion correction
  const n = Math.sqrt(planet.mu / a ** 3);
  const p = a * (1 - e * e);
  const k = planet.J2 * (planet.radiusKm / p) ** 2;
  const cosI = Math.cos(i);
  const raanDot = -1.5 * n * k * cosI;
  const argpDot = 0.75 * n * k * (5 * cosI * cosI - 1);
  const mDot = n * (1 + 0.75 * k * Math.sqrt(1 - e * e) * (3 * cosI * cosI - 1));

  return {
    planet, epochMs, a, e, i,
    raan0, argp0: cfg.argPerigeeDeg * DEG, m0: cfg.meanAnomalyDeg * DEG,
    n, raanDot, argpDot, mDot,
    nodalPeriodS: (2 * Math.PI) / (mDot + argpDot), // ascending node to ascending node
  };
}

/** Solve Kepler's equation M = E - e sin E (Newton iteration). */
function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 15; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Elements (with J2 drift applied) at time tMs. */
export function elementsAt(orbit, tMs) {
  const dt = (tMs - orbit.epochMs) / 1000;
  return {
    raan: orbit.raan0 + orbit.raanDot * dt,
    argp: orbit.argp0 + orbit.argpDot * dt,
    M: orbit.m0 + orbit.mDot * dt,
  };
}

/** ECI position/velocity for given orbit shape and angles. */
function stateFromElements(orbit, raan, argp, M) {
  const { a, e, i, planet } = orbit;
  const E = solveKepler(wrapTwoPi(M), e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const sq = Math.sqrt(1 - e * e);
  const r = a * (1 - e * cosE);

  // Perifocal coordinates
  const xp = a * (cosE - e), yp = a * sq * sinE;
  const vf = Math.sqrt(planet.mu * a) / r;
  const vxp = -vf * sinE, vyp = vf * sq * cosE;

  // Rotation perifocal -> ECI: columns P, Q
  const cO = Math.cos(raan), sO = Math.sin(raan);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(i), si = Math.sin(i);
  const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];

  return {
    pos: [0, 1, 2].map((k) => xp * P[k] + yp * Q[k]),
    vel: [0, 1, 2].map((k) => vxp * P[k] + vyp * Q[k]),
  };
}

/** Full state at tMs: ECI pos/vel (km, km/s) + planet rotation angle. */
export function propagate(orbit, tMs) {
  const { raan, argp, M } = elementsAt(orbit, tMs);
  const { pos, vel } = stateFromElements(orbit, raan, argp, M);
  return { tMs, pos, vel, theta: rotationAngle(orbit.planet, tMs) };
}

/** Rotate an ECI vector into the planet-fixed frame by rotation angle theta. */
export function eciToEcef(v, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}

/** Spherical (geocentric) lat/lon in degrees, altitude above the sphere in km. */
export function ecefToLatLon(v, radiusKm) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return {
    latDeg: Math.asin(v[2] / r) / DEG,
    lonDeg: Math.atan2(v[1], v[0]) / DEG,
    altKm: r - radiusKm,
  };
}

/** Inverse of ecefToLatLon on the sphere surface (plus optional altitude). */
export function latLonToEcef(latDeg, lonDeg, radiusKm) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  return [radiusKm * Math.cos(la) * Math.cos(lo), radiusKm * Math.cos(la) * Math.sin(lo), radiusKm * Math.sin(la)];
}

/** Sub-satellite point and derived telemetry at tMs. */
export function subSatellitePoint(orbit, tMs) {
  const st = propagate(orbit, tMs);
  const geo = ecefToLatLon(eciToEcef(st.pos, st.theta), orbit.planet.radiusKm);
  return { ...st, ...geo, speedKmS: Math.hypot(...st.vel) };
}

/** Sampled ground track between t0Ms and t1Ms: [{tMs, latDeg, lonDeg}] */
export function groundTrack(orbit, t0Ms, t1Ms, samples) {
  const out = new Array(samples);
  for (let k = 0; k < samples; k++) {
    const t = t0Ms + ((t1Ms - t0Ms) * k) / (samples - 1);
    const st = propagate(orbit, t);
    const g = ecefToLatLon(eciToEcef(st.pos, st.theta), orbit.planet.radiusKm);
    out[k] = { tMs: t, latDeg: g.latDeg, lonDeg: g.lonDeg };
  }
  return out;
}

/**
 * Swath edges along the track. The scan line is perpendicular to the orbit plane (the
 * instrument's cross-track axis = orbit normal), so edge directions are
 * p± = cos(λ)·r̂ ± sin(λ)·n̂, with λ = swath / (2R) the Earth-central half-angle.
 * Returns [{tMs, latDeg, lonDeg, left:{latDeg, lonDeg}, right:{latDeg, lonDeg}}].
 * "left" is on the +n̂ side (left of travel for a prograde view from above).
 */
export function swathTrack(orbit, t0Ms, t1Ms, samples, swathKm) {
  const R = orbit.planet.radiusKm;
  const lam = Number.isFinite(swathKm) ? swathKm / (2 * R) : 0;
  const cl = Math.cos(lam), sl = Math.sin(lam);
  const out = new Array(samples);
  for (let k = 0; k < samples; k++) {
    const t = t0Ms + ((t1Ms - t0Ms) * k) / (samples - 1);
    const st = propagate(orbit, t);
    const { left, right, center } = swathEdgesEci(st.pos, st.vel, cl, sl);
    const g = ecefToLatLon(eciToEcef(center, st.theta), 1);
    const gl = ecefToLatLon(eciToEcef(left, st.theta), 1);
    const gr = ecefToLatLon(eciToEcef(right, st.theta), 1);
    out[k] = {
      tMs: t, latDeg: g.latDeg, lonDeg: g.lonDeg,
      left: { latDeg: gl.latDeg, lonDeg: gl.lonDeg },
      right: { latDeg: gr.latDeg, lonDeg: gr.lonDeg },
    };
  }
  return out;
}

/** Unit vectors (ECI) of nadir and the two swath edges for one state vector. */
export function swathEdgesEci(pos, vel, cosLam, sinLam) {
  const r = Math.hypot(...pos);
  const u = pos.map((x) => x / r);
  // Orbit normal n = r x v (normalized)
  const n = [
    pos[1] * vel[2] - pos[2] * vel[1],
    pos[2] * vel[0] - pos[0] * vel[2],
    pos[0] * vel[1] - pos[1] * vel[0],
  ];
  const nl = Math.hypot(...n);
  const nh = n.map((x) => x / nl);
  return {
    center: u,
    left: [0, 1, 2].map((k) => cosLam * u[k] + sinLam * nh[k]),
    right: [0, 1, 2].map((k) => cosLam * u[k] - sinLam * nh[k]),
  };
}

/** Closed orbit ellipse in ECI with elements frozen at tMs (for drawing the orbit line). */
export function orbitPath(orbit, tMs, samples) {
  const { raan, argp } = elementsAt(orbit, tMs);
  const pts = [];
  for (let k = 0; k < samples; k++) {
    pts.push(stateFromElements(orbit, raan, argp, (2 * Math.PI * k) / samples).pos);
  }
  return pts;
}

/** Orbit number since epoch (1-based); increments at each ascending node crossing. */
export function orbitNumber(orbit, tMs) {
  // Argument of latitude u = argp + M (exact for circular orbits) crosses 2*pi*k at the node
  const turns = (ms) => {
    const el = elementsAt(orbit, ms);
    return Math.floor((el.argp + el.M) / (2 * Math.PI));
  };
  return turns(tMs) - turns(orbit.epochMs) + 1;
}
