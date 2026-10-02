// Central configuration: planets, default orbit/sensor, and visual palette.
// Units: km, seconds, degrees at this boundary (converted to radians inside physics).

export const PLANETS = {
  earth: {
    id: 'earth',
    name: 'Earth',
    radiusKm: 6378.137,          // equatorial radius (J2 is defined against this)
    mu: 398600.4418,             // gravitational parameter, km^3/s^2
    J2: 1.08263e-3,              // oblateness coefficient (drives RAAN drift)
    siderealDayS: 86164.0905,    // one full rotation relative to the stars
    tropicalYearS: 365.2421897 * 86400, // used for sun-synchronous RAAN rate
    primeMeridianJ2000Deg: 280.46061837, // GMST at J2000 epoch
    landData: 'data/land-50m.json',
  },
};

export const DEFAULT_PLANET = 'earth';

// Sun-synchronous. inclinationDeg: null => computed for SSO.
export const DEFAULT_ORBIT = {
  altitudeKm: 700,
  eccentricity: 0,
  inclinationDeg: null,
  ltdnHours: 10.5,       // local MEAN solar time of descending node, 10:30 (sets RAAN at epoch)
  argPerigeeDeg: 0,
  meanAnomalyDeg: 180,   // start at the descending node => daylight imaging pass at 10:30
};

// Line-scanner sensor presets. The detector array (pixel count + pitch) is FIXED; the FOV
// slider changes focal length, so IFOV = FOV / pixels. FOV, IFOV, GSD and swath are DERIVED in
// js/physics/sensor.js and never stored. Native values give ~186 km swath at 700 km for both.
export const SENSOR_PRESETS = {
  thermal: {
    id: 'thermal',
    label: 'Thermal (LST)',
    band: 'TIR 10.6–12.5 µm',
    scan: 'pushbroom',        // 'pushbroom' | 'whiskbroom' (whiskbroom model is backlog)
    pixelsCrossTrack: 1850,   // detector elements across track
    detectorPitchUm: 25,      // physical detector size
    nativeIfovUrad: 142.5,    // IFOV at the native focal length (~100 m GSD at 700 km)
    inspiredBy: 'Landsat 8/9 TIRS',
  },
  visual: {
    id: 'visual',
    label: 'Visual',
    band: 'VNIR 0.43–0.88 µm',
    scan: 'pushbroom',
    pixelsCrossTrack: 6200,
    detectorPitchUm: 36,
    nativeIfovUrad: 42.6,     // ~30 m GSD at 700 km
    inspiredBy: 'Landsat 8/9 OLI',
  },
};
export const DEFAULT_SENSOR_ID = 'thermal';
export const FOV_RANGE_DEG = [2, 110]; // horizon limit at 700 km is ~128 deg

// Pixel close-up sample scene: fixed ground window and texel size
export const CLOSEUP = { sizeM: 3000, texelM: 5, tempRangeC: [15, 45] };

// Scene scale: 1 Three.js unit = 1000 km.
export const SCENE_KM_PER_UNIT = 1000;

// Exaggeration factor for the satellite model (real size would be invisible).
export const SATELLITE_MODEL_SCALE = 1.0;

export const TIME_WARPS = [1, 10, 60, 300, 1000];
export const DEFAULT_WARP = 60;

// Shared palette so the globe texture and 2D map look identical.
export const PALETTE = {
  space: '#0b1026',
  oceanDeep: '#2f6db5',
  oceanMid: '#3f8fd2',
  oceanShallow: '#7cc6e8',
  shelfGlow: 'rgba(160, 225, 245, 0.55)',
  seaIce: '#e8f3fb',
  coast: '#f3dfa2',
  coastLine: 'rgba(40, 70, 60, 0.55)',
  // Latitude-banded "cartoon biomes" for land fill: [latDeg, color]
  landBands: [
    [90, '#f7fbff'],
    [72, '#eef5f7'],
    [64, '#a7b98a'],
    [55, '#6fae5c'],
    [40, '#7dbb57'],
    [30, '#d9c27a'],
    [18, '#e3c983'],
    [10, '#62a94c'],
    [0, '#4f9d45'],
    [-10, '#5ea64a'],
    [-20, '#d6b874'],
    [-32, '#c9b26e'],
    [-42, '#78b45a'],
    [-55, '#9fb889'],
    [-62, '#eef5f7'],
    [-90, '#f7fbff'],
  ],
  graticule: 'rgba(255, 255, 255, 0.16)',
  trackPast: '#ff7a59',
  trackFuture: 'rgba(255, 255, 255, 0.75)',
  orbitLine: '#ffd166',
  nadir: '#ffd166',
  satelliteIcon: '#ffd166',
  atmosphere: [0.45, 0.75, 1.0],
  swath: { thermal: '#ff9f43', visual: '#3fd8c2' },
  // LST colormap (cool -> hot) for the thermal close-up: [t in 0..1, color]
  thermalRamp: [
    [0, '#2c3e9e'], [0.25, '#2fa7d8'], [0.5, '#8fd16b'],
    [0.7, '#f6d544'], [0.85, '#f2843a'], [1, '#d93a2b'],
  ],
};
