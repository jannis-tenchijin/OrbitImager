// Imaging geometry for a nadir-looking line scanner (pushbroom or whiskbroom).
// Model: N cross-track pixels, each with angular size IFOV  =>  FOV = N * IFOV.
//   GSD (nadir) = altitude * IFOV            (smaller IFOV -> finer resolution)
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

/** All derived numbers for the HUD / visualization. */
export function sensorGeometry(planet, altitudeKm, sensor) {
  const ifov = sensor.ifovUrad * 1e-6;
  const fov = ifov * sensor.pixelsCrossTrack;
  const swathKm = swathWidth(planet.radiusKm, altitudeKm, fov / 2);
  return {
    type: sensor.type,
    ifovUrad: sensor.ifovUrad,
    pixelsCrossTrack: sensor.pixelsCrossTrack,
    fovDeg: fov / DEG,
    gsdNadirM: altitudeKm * 1000 * ifov,
    swathKm,
    swathFlatKm: 2 * altitudeKm * Math.tan(fov / 2),
    exceedsHorizon: Number.isNaN(swathKm),
  };
}
