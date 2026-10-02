// Drifting, evolving cloud field — a deterministic PURE FUNCTION of sim time.
// The recorder (cloud masking), globe (3D puffs) and map (2D blobs) all query the same field,
// so what you see is exactly what the swath was masked with at acquisition time.
//
// Each system lives for L hours (forms -> peaks -> dissipates), then respawns elsewhere.
// Position/shape of a system's generation g come from a seeded hash of (system, g).
// Systems drift with prevailing winds: westward in the tropics, eastward at mid-latitudes.

const DEG = Math.PI / 180;
const KM_PER_DEG = 111.32;
// Cloud positions are evaluated on a 2-min time grid: drift in 2 min is <= ~1.7 km (invisible,
// far below puff sizes) and consecutive 20 s swath rows share one evaluation (50k× warp).
const TIME_QUANTUM_MS = 120000;
const BAND_DEG = 10; // latitude bands for the isCloudy lookup index

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Relative cloudiness by latitude: ITCZ near 5°N, storm tracks near ±50°, dry subtropics. */
function latWeight(lat) {
  const itcz = Math.exp(-(((lat - 5) / 9) ** 2));
  const storm = 0.9 * Math.exp(-(((Math.abs(lat) - 50) / 11) ** 2));
  return 0.25 + itcz + storm;
}

/** Zonal wind (km/h, + = eastward) blended between tropical easterlies and mid-lat westerlies. */
function windKmH(lat, cfg) {
  const a = Math.abs(lat);
  if (a <= 25) return cfg.tropicalWindKmH;
  if (a >= 35) return cfg.midlatWindKmH;
  const f = (a - 25) / 10;
  return cfg.tropicalWindKmH * (1 - f) + cfg.midlatWindKmH * f;
}

function unit(latDeg, lonDeg) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

export function createCloudField(cfg, radiusKm) {
  const rnd = mulberry32(cfg.seed);
  const lerp = ([a, b], f) => a + (b - a) * f;
  const systems = Array.from({ length: cfg.systems }, () => ({
    lifetimeH: lerp(cfg.lifetimeH, rnd()),
    phase: rnd(), // de-synchronizes lifecycles
  }));
  const maxW = latWeight(5) + 0.1;
  const shapeCache = new Map();

  /** Birth location + puff layout for generation `gen` of system `i` (cached). */
  function shape(i, gen) {
    const key = i * 1e6 + gen;
    let s = shapeCache.get(key);
    if (s) return s;
    const r = mulberry32((cfg.seed * 7919) ^ (i * 104729) ^ (gen * 1299709));
    // Area-uniform latitude proposal, accepted by climatological weight
    let lat;
    do {
      lat = Math.asin(2 * r() - 1) / DEG;
    } while (Math.abs(lat) > 72 || r() * maxW > latWeight(lat));
    const lon = r() * 360 - 180;
    const n = Math.round(lerp(cfg.puffs, r()));
    const puffs = [];
    for (let k = 0; k < n; k++) {
      const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * cfg.spreadKm;
      puffs.push({ dx: Math.cos(ang) * d, dy: Math.sin(ang) * d * 0.7, r: lerp(cfg.puffRadiusKm, r()), spin: r() * Math.PI });
    }
    s = { lat, lon, puffs };
    shapeCache.set(key, s);
    if (shapeCache.size > 4 * cfg.systems) shapeCache.delete(shapeCache.keys().next().value);
    return s;
  }

  let lastT = NaN, lastSystems = null, lastBands = null;

  /**
   * Cloud systems at tMs: [{ latDeg, lonDeg, scale, center, boundCos,
   *   puffs: [{ latDeg, lonDeg, rKm, u, cosR, spin }] }]  (u = unit ECEF)
   */
  function systemsAt(tMsRaw) {
    const tMs = Math.floor(tMsRaw / TIME_QUANTUM_MS) * TIME_QUANTUM_MS; // still a pure function of time
    if (tMs === lastT) return lastSystems;
    const tH = tMs / 3.6e6;
    const out = [];
    for (let i = 0; i < systems.length; i++) {
      const sys = systems[i];
      const x = tH / sys.lifetimeH + sys.phase;
      const gen = Math.floor(x), age = x - gen;
      const scale = Math.sin(Math.PI * age) ** 0.6; // form -> peak -> dissipate
      if (scale < 0.12) continue;
      const sh = shape(i, gen);
      const ageH = age * sys.lifetimeH;
      const cosLat = Math.cos(sh.lat * DEG);
      const lonC = sh.lon + (windKmH(sh.lat, cfg) * ageH) / (KM_PER_DEG * cosLat);
      const puffs = sh.puffs.map((p) => {
        const latDeg = sh.lat + p.dy / KM_PER_DEG;
        const lonDeg = lonC + p.dx / (KM_PER_DEG * cosLat);
        const rKm = p.r * scale;
        return { latDeg, lonDeg, rKm, u: unit(latDeg, lonDeg), cosR: Math.cos(rKm / radiusKm), spin: p.spin };
      });
      const boundAng = (cfg.spreadKm + cfg.puffRadiusKm[1] * scale) / radiusKm;
      out.push({ id: i, gen, latDeg: sh.lat, lonDeg: lonC, scale, center: unit(sh.lat, lonC), boundCos: Math.cos(boundAng), puffs });
    }
    lastT = tMs;
    lastSystems = out;
    // Index systems by every latitude band their bounding cap touches
    lastBands = Array.from({ length: 180 / BAND_DEG }, () => []);
    for (const sys of out) {
      const r = Math.acos(sys.boundCos) / DEG;
      const b0 = Math.max(0, Math.floor((sys.latDeg - r + 90) / BAND_DEG));
      const b1 = Math.min(lastBands.length - 1, Math.floor((sys.latDeg + r + 90) / BAND_DEG));
      for (let b = b0; b <= b1; b++) lastBands[b].push(sys);
    }
    return out;
  }

  /** True if the planet-fixed unit vector u is under a cloud at tMs. */
  function isCloudy(u, tMs) {
    systemsAt(tMs);
    const lat = Math.asin(Math.max(-1, Math.min(1, u[2]))) / DEG;
    const band = lastBands[Math.min(lastBands.length - 1, Math.floor((lat + 90) / BAND_DEG))];
    for (const s of band) {
      const c = s.center;
      if (u[0] * c[0] + u[1] * c[1] + u[2] * c[2] < s.boundCos) continue;
      for (const p of s.puffs) {
        if (u[0] * p.u[0] + u[1] * p.u[1] + u[2] * p.u[2] >= p.cosR) return true;
      }
    }
    return false;
  }

  return { systemsAt, isCloudy, maxPuffs: cfg.systems * cfg.puffs[1], altitudeKm: cfg.altitudeKm };
}
