// Imaging geometry for a nadir-looking line scanner (pushbroom or whiskbroom).
// Focal-length model: the detector array is FIXED (N pixels of physical pitch p). Choosing a
// FOV sets the focal length f, and every pixel sees IFOV = FOV / N = p / f.
//   GSD (nadir) = altitude * IFOV            (wider FOV -> coarser pixels)
//   Swath       = ground arc spanned by FOV  (higher altitude or wider FOV -> wider swath)
// Uses a spherical planet, so swath grows faster than the flat-earth 2*h*tan(FOV/2).

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

/** All derived numbers for the UI / visualization at a chosen FOV. */
export function sensorGeometry(planet, altitudeKm, preset, fovDeg = nativeFovDeg(preset)) {
  const fov = fovDeg * DEG;
  const ifov = fov / preset.pixelsCrossTrack;
  const half = fov / 2;
  const swathKm = swathWidth(planet.radiusKm, altitudeKm, half);
  return {
    id: preset.id,
    scan: preset.scan,
    pixelsCrossTrack: preset.pixelsCrossTrack,
    detectorPitchUm: preset.detectorPitchUm,
    fovDeg,
    halfAngle: half,
    ifovUrad: ifov * 1e6,
    focalLengthMm: (preset.detectorPitchUm * 1e-3) / ifov, // f = p / IFOV
    gsdNadirM: altitudeKm * 1000 * ifov,
    gsdEdgeM: crossTrackGsd(planet.radiusKm, altitudeKm, ifov, half),
    swathKm,
    swathFlatKm: 2 * altitudeKm * Math.tan(half),
    exceedsHorizon: Number.isNaN(swathKm),
  };
}
