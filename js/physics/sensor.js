// Imaging geometry for a nadir-looking line scanner (pushbroom or whiskbroom).
// Focal-length model: the detector array is FIXED (N pixels of physical pitch p). Choosing a
// FOV sets the focal length f, and every pixel sees IFOV = FOV / N = p / f.
//   GSD (nadir) = altitude * IFOV            (wider FOV -> coarser pixels)
//   Swath       = ground arc spanned by FOV  (higher altitude or wider FOV -> wider swath)
// Uses a spherical planet, so swath grows faster than the flat-earth 2*h*tan(FOV/2).
//
// Timing (circular orbit, ground speed v_g):
//   line time        = GSD / v_g                      (time to advance one row along track)
//   pushbroom dwell  = line time                      (every detector stares for a whole row)
//   whiskbroom: a double-sided rotating mirror sweeps k rows per sweep. No-gap condition:
//   scan period T = k * line time. Only the Earth-view arc (eta = FOV / 180 deg) records;
//   the rest is calibration / space view. dwell = eta * T / N.
//   framing (staring 2-D array, e.g. SatVu): a whole frame of F rows at once; no-gap frame
//   period = F * line time; every pixel can integrate up to the frame period.
//
// SAR (side-looking radar) is different: resolution comes from bandwidth and antenna length,
// NOT from FOV/IFOV, so it does not change with altitude; the fixed antenna look angles set
// the swath, which does grow with altitude.

import { lookToCentral } from './instruments.js';

const DEG = Math.PI / 180;

/**
 * Ground swath (km) for a nadir-centered fan of half-angle `halfAngle` (rad).
 * Earth central angle to the swath edge: lambda = asin(((R+h)/R) sin(eta)) - eta.
 * Returns NaN if the fan reaches past the horizon.
 */
export function swathWidth(radiusKm, altitudeKm, halfAngle) {
  const s = ((radiusKm + altitudeKm) / radiusKm) * Math.sin(halfAngle);
  if (s >= 1) return NaN;
  return 2 * radiusKm * (Math.asin(s) - halfAngle);
}

/** Off-nadir look angle (rad) at which the line of sight grazes the horizon. */
export function horizonHalfAngle(radiusKm, altitudeKm) {
  return Math.asin(radiusKm / (radiusKm + altitudeKm));
}

/**
 * Cross-track ground size (m) of one pixel seen at look angle eta (rad).
 * = R * IFOV * d(lambda)/d(eta); equals altitude * IFOV at nadir and grows toward the edge.
 */
export function crossTrackGsd(radiusKm, altitudeKm, ifovRad, eta) {
  const k = (radiusKm + altitudeKm) / radiusKm;
  const s = k * Math.sin(eta);
  if (s >= 1) return NaN;
  return radiusKm * 1000 * ifovRad * ((k * Math.cos(eta)) / Math.sqrt(1 - s * s) - 1);
}

/** Native FOV (deg) of a preset: pixel count x native IFOV. */
export function nativeFovDeg(preset) {
  return (preset.pixelsCrossTrack * preset.nativeIfovUrad * 1e-6) / DEG;
}

/** Ground-track speed (km/s) of a circular orbit at altitudeKm. */
export function groundSpeedKmS(planet, altitudeKm) {
  const r = planet.radiusKm + altitudeKm;
  return Math.sqrt(planet.mu / r) * (planet.radiusKm / r);
}

/** Acquisition timing for a scan type, given nadir GSD (m) and FOV (rad). */
export function scanTiming(planet, altitudeKm, preset, scan, gsdM, fovRad) {
  const vg = groundSpeedKmS(planet, altitudeKm) * 1000; // m/s
  const lineS = gsdM / vg;
  if (scan === 'framing') {
    const frameS = (preset.frameRows ?? 512) * lineS;
    return { scan, groundSpeedMS: vg, lineTimeMs: lineS * 1e3, frameRows: preset.frameRows ?? 512, framePeriodMs: frameS * 1e3, dwellUs: frameS * 1e6 };
  }
  if (scan !== 'whiskbroom') {
    return { scan: 'pushbroom', groundSpeedMS: vg, lineTimeMs: lineS * 1e3, dwellUs: lineS * 1e6 };
  }
  const k = preset.whiskRowsPerSweep ?? 10;
  const periodS = k * lineS;                          // no-gap: k rows cover one full scan period
  const eta = Math.min(1, fovRad / Math.PI);          // Earth-view share of a half mirror turn
  return {
    scan: 'whiskbroom',
    groundSpeedMS: vg,
    lineTimeMs: lineS * 1e3,
    rowsPerSweep: k,
    scanPeriodMs: periodS * 1e3,
    earthViewFrac: eta,
    calibrationMs: (1 - eta) * periodS * 1e3,
    mirrorRpm: 60 / (2 * periodS),                    // double-sided: two sweeps per turn
    dwellUs: ((eta * periodS) / preset.pixelsCrossTrack) * 1e6,
  };
}

/** All derived numbers for the UI / visualization at a chosen FOV and scan type. */
export function sensorGeometry(planet, altitudeKm, preset, fovDeg = nativeFovDeg(preset), scan = preset.scan) {
  const fov = fovDeg * DEG;
  const ifov = fov / preset.pixelsCrossTrack;
  const half = fov / 2;
  const swathKm = swathWidth(planet.radiusKm, altitudeKm, half);
  const gsdNadirM = altitudeKm * 1000 * ifov;
  const lam = Number.isFinite(swathKm) ? swathKm / (2 * planet.radiusKm) : 0;
  const k = (planet.radiusKm + altitudeKm) / planet.radiusKm;
  // Targeted imagers (SatVu): discrete frames of tasked targets within the agility limit
  const imaging = preset.imaging ?? 'strip';
  const accessLam = preset.maxOffNadirDeg ? lookToCentral(preset.maxOffNadirDeg * DEG, k) : 0;
  return {
    id: preset.id,
    kind: preset.kind,
    scan,
    imaging,
    accessLam,
    accessKm: accessLam * planet.radiusKm,
    frameKm: { cross: swathKm, along: ((preset.frameRows ?? 512) * gsdNadirM) / 1000 },
    edges: { left: lam, right: -lam },        // signed Earth-central edge angles (+ = left)
    gsdXM: gsdNadirM, gsdYM: gsdNadirM,       // pixel footprint cross-/along-track (square)
    timing: scanTiming(planet, altitudeKm, preset, scan, gsdNadirM, fov),
    pixelsCrossTrack: preset.pixelsCrossTrack,
    detectorPitchUm: preset.detectorPitchUm,
    fovDeg,
    halfAngle: half,
    ifovUrad: ifov * 1e6,
    focalLengthMm: preset.detectorPitchUm ? (preset.detectorPitchUm * 1e-3) / ifov : NaN, // f = p / IFOV
    gsdNadirM,
    gsdEdgeM: crossTrackGsd(planet.radiusKm, altitudeKm, ifov, half),
    swathKm,
    swathFlatKm: 2 * altitudeKm * Math.tan(half),
    exceedsHorizon: Number.isNaN(swathKm),
  };
}

/**
 * Side-looking SAR geometry for a mode at the current altitude.
 * Look angles are fixed by the antenna (see sarLookAngles); incidence and swath follow altitude.
 */
export function sarGeometry(planet, altitudeKm, inst, modeId) {
  const mode = inst.modes[modeId] ?? Object.values(inst.modes)[0];
  const R = planet.radiusKm;
  const k = (R + altitudeKm) / R;
  const lamNear = lookToCentral(mode.lookNear, k), lamFar = lookToCentral(mode.lookFar, k);
  const sign = inst.lookSide === 'left' ? 1 : -1; // right of track = -n
  const edges = sign < 0 ? { left: -lamNear, right: -lamFar } : { left: lamFar, right: lamNear };
  const vg = groundSpeedKmS(planet, altitudeKm) * 1000;
  return {
    id: inst.id,
    kind: 'sar',
    scan: 'sar',
    mode: mode.id,
    modeLabel: mode.label,
    edges,
    swathKm: (lamFar - lamNear) * R,
    nadirGapKm: lamNear * R,
    lookNearDeg: mode.lookNear / DEG,
    lookFarDeg: mode.lookFar / DEG,
    incNearDeg: (mode.lookNear + lamNear) / DEG,
    incFarDeg: (mode.lookFar + lamFar) / DEG,
    resRangeM: mode.resRangeM,
    resAzM: mode.resAzM,
    looks: mode.looks,
    gsdXM: mode.resRangeM, gsdYM: mode.resAzM, // range x azimuth pixel (independent of altitude)
    gsdNadirM: Math.max(mode.resRangeM, mode.resAzM),
    timing: { scan: 'sar', groundSpeedMS: vg, lineTimeMs: (mode.resAzM / vg) * 1e3 },
    exceedsHorizon: !Number.isFinite(lamFar),
  };
}

/** Geometry for any instrument: optical (FOV + scan) or SAR (mode). */
export function instrumentGeometry(planet, altitudeKm, inst, { fovDeg, scan, modeId } = {}) {
  return inst.kind === 'sar'
    ? sarGeometry(planet, altitudeKm, inst, modeId)
    : sensorGeometry(planet, altitudeKm, inst, fovDeg ?? nativeFovDeg(inst), scan ?? inst.scan);
}
