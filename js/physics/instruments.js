// Turn published instrument specs (GSD + swath at the mission altitude) into the simulator's
// hardware model, and side-looking SAR geometry helpers.
//
// Optical: invert the spherical swath formula. For Earth-central half-angle λ = swath / 2R
// and k = (R+h)/R, the nadir half-angle is  tan η = sin λ / (k − cos λ).
// Then IFOV = GSD / h, pixels across N = 2η / IFOV, so native FOV/GSD/swath reproduce the
// published numbers at the published altitude.

const DEG = Math.PI / 180;

/** Look (off-nadir) angle η for a ground point at Earth-central angle λ. */
export function centralToLook(lam, k) {
  return Math.atan2(Math.sin(lam), k - Math.cos(lam));
}

/** Earth-central angle λ for look angle η (NaN past the horizon). Incidence θ = η + λ. */
export function lookToCentral(eta, k) {
  const s = k * Math.sin(eta);
  return s >= 1 ? NaN : Math.asin(s) - eta;
}

/** Earth-central angle λ for a local incidence angle θ. */
export function incidenceToCentral(theta, k) {
  return theta - Math.asin(Math.sin(theta) / k);
}

/** Native IFOV (µrad) and pixel count from published nadir GSD (m) + swath (km). */
export function fromPublished(radiusKm, altitudeKm, gsdM, swathKm) {
  const k = (radiusKm + altitudeKm) / radiusKm;
  const eta = centralToLook(swathKm / (2 * radiusKm), k);
  const ifov = gsdM / (altitudeKm * 1000);
  return { nativeIfovUrad: ifov * 1e6, pixelsCrossTrack: Math.round((2 * eta) / ifov) };
}

/**
 * SAR mode -> fixed antenna look angles. Published modes give a center incidence and a swath
 * at the mission altitude; the beam's look angles stay fixed if the altitude changes.
 */
export function sarLookAngles(radiusKm, nominalAltKm, mode) {
  const k = (radiusKm + nominalAltKm) / radiusKm;
  const lamC = incidenceToCentral(mode.incCenterDeg * DEG, k);
  const half = mode.swathKm / (2 * radiusKm);
  return { lookNear: centralToLook(lamC - half, k), lookFar: centralToLook(lamC + half, k) };
}

/**
 * Resolve the raw SATELLITES config into simulator-ready instruments (adds nativeIfovUrad,
 * pixelsCrossTrack for optical; look angles per mode for SAR). Explicit hardware values in the
 * config (e.g. the Custom presets) are kept as-is.
 */
export function resolveCatalog(planet, satellites) {
  const out = {};
  for (const [satId, sat] of Object.entries(satellites)) {
    const instruments = {};
    for (const [instId, raw] of Object.entries(sat.instruments)) {
      const inst = { ...raw, id: instId, satId, nominalAltKm: sat.orbit.altitudeKm };
      if (inst.kind === 'sar') {
        inst.modes = Object.fromEntries(Object.entries(raw.modes).map(([mId, m]) => (
          [mId, { ...m, id: mId, ...sarLookAngles(planet.radiusKm, sat.orbit.altitudeKm, m) }]
        )));
      } else if (inst.nativeIfovUrad == null) {
        Object.assign(inst, fromPublished(planet.radiusKm, sat.orbit.altitudeKm, raw.gsdM, raw.swathKm));
      }
      instruments[instId] = inst;
    }
    out[satId] = { ...sat, id: satId, instruments };
  }
  return out;
}
