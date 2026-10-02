// Time utilities: Julian dates, planet rotation angle, approximate sun position.

export const J2000_JD = 2451545.0;
const MS_PER_DAY = 86400000;
const DEG = Math.PI / 180;

/** Julian date from Unix milliseconds (UTC; TT-UTC offset ignored). */
export function julianDate(ms) {
  return ms / MS_PER_DAY + 2440587.5;
}

/**
 * Rotation angle of the planet's prime meridian relative to the inertial X axis (rad).
 * For Earth this is GMST (linear IAU-82 form, error < 0.001 deg over decades).
 */
export function rotationAngle(planet, ms) {
  const days = julianDate(ms) - J2000_JD;
  // Degrees turned per solar day = 360 * (solar day / sidereal day)
  const degPerDay = 360 * (86400 / planet.siderealDayS);
  const deg = planet.primeMeridianJ2000Deg + degPerDay * days;
  return wrapTwoPi(deg * DEG);
}

/**
 * Low-precision sun direction (Astronomical Almanac), Earth-centered inertial frame.
 * Returns unit vector [x, y, z] and right ascension (rad). Accurate to ~0.01 deg.
 */
export function sunEci(ms) {
  const n = julianDate(ms) - J2000_JD;
  const L = (280.46 + 0.9856474 * n) * DEG;          // mean longitude
  const g = (357.528 + 0.9856003 * n) * DEG;         // mean anomaly
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * DEG;        // obliquity
  const dir = [
    Math.cos(lambda),
    Math.cos(eps) * Math.sin(lambda),
    Math.sin(eps) * Math.sin(lambda),
  ];
  const ra = wrapTwoPi(Math.atan2(dir[1], dir[0]));
  return { dir, ra };
}

/**
 * Right ascension of the MEAN sun (rad) = mean longitude L. Sun-synchronous orbits precess at
 * the mean-sun rate, so LTAN/LTDN are defined in mean solar time (UTC + lon/15). Using the
 * apparent sun instead would be off by the equation of time (up to +/-16 min).
 */
export function meanSunRa(ms) {
  const n = julianDate(ms) - J2000_JD;
  return wrapTwoPi((280.46 + 0.9856474 * n) * DEG);
}

/** Local mean solar time (hours, 0..24) at a longitude. */
export function meanLocalTime(lonDeg, ms) {
  const utcHours = (((ms / 3600000) % 24) + 24) % 24;
  return (((utcHours + lonDeg / 15) % 24) + 24) % 24;
}

export function wrapTwoPi(x) {
  const t = x % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}
