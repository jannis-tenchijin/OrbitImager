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

// Sun-synchronous. inclinationDeg: null => computed for SSO. Satellite presets override
// altitudeKm / ltdnHours; the altitude slider re-targets the orbit (js/physics/orbit.js).
export const DEFAULT_ORBIT = {
  altitudeKm: 700,
  eccentricity: 0,
  inclinationDeg: null,
  ltdnHours: 10.5,       // local MEAN solar time of descending node, 10:30 (sets RAAN at epoch)
  argPerigeeDeg: 0,
  meanAnomalyDeg: 180,   // start at the descending node => daylight imaging pass at 10:30
};

// Generic line-scanner sensors (the "Custom" satellite). The detector array (pixel count +
// pitch) is FIXED; the FOV slider changes focal length, so IFOV = FOV / pixels. FOV, IFOV, GSD
// and swath are DERIVED in js/physics/sensor.js and never stored.
export const SENSOR_PRESETS = {
  thermal: {
    id: 'thermal',
    kind: 'thermal',          // thermal | visual | sar  (drives colors, night + cloud rules)
    label: 'Thermal (LST)',
    band: 'TIR 10.6–12.5 µm',
    scan: 'pushbroom',        // default scan; user can toggle pushbroom | whiskbroom | framing
    pixelsCrossTrack: 1850,   // detector elements (pushbroom) or samples per sweep (whiskbroom)
    whiskRowsPerSweep: 10,    // whiskbroom: along-track detectors = rows recorded per mirror sweep
    recordsAtNight: true,     // emitted IR: LST is measured day and night
    detectorPitchUm: 25,      // physical detector size
    nativeIfovUrad: 142.5,    // IFOV at the native focal length (~100 m GSD at 700 km)
  },
  visual: {
    id: 'visual',
    kind: 'visual',
    label: 'Visual',
    band: 'VNIR 0.43–0.88 µm',
    scan: 'pushbroom',
    pixelsCrossTrack: 6200,
    detectorPitchUm: 36,
    nativeIfovUrad: 42.6,     // ~30 m GSD at 700 km
    whiskRowsPerSweep: 16,
    recordsAtNight: false,    // reflected sunlight: needs the sun above VISUAL_MIN_SUN_ELEV_DEG
  },
};

// Real missions (sourced 2026-10-02, see docs/decisions.md "Satellite presets").
// Optical instruments give PUBLISHED nadir GSD + swath at the mission altitude; js/physics/
// instruments.js derives native IFOV + pixel count from them. `approx` lists inferred fields.
// SAR modes give center incidence + swath at the mission altitude (antenna look angles are
// derived from those and stay fixed if the altitude changes) + range x azimuth resolution.
export const SATELLITES = {
  landsat89: {
    name: 'Landsat 8/9', operator: 'USGS / NASA',
    orbit: { altitudeKm: 705, ltdnHours: 10.0 },
    instruments: {
      oli: { kind: 'visual', label: 'OLI', band: 'VNIR/SWIR 0.43–2.30 µm', scan: 'pushbroom', gsdM: 30, swathKm: 185, detectorPitchUm: 37.7, whiskRowsPerSweep: 16, recordsAtNight: false, approx: ['pitch'] },
      tirs: { kind: 'thermal', label: 'TIRS', band: 'TIR 10.6–12.5 µm', scan: 'pushbroom', gsdM: 100, swathKm: 185, detectorPitchUm: 25, whiskRowsPerSweep: 10, recordsAtNight: true },
    },
  },
  gcomc: {
    name: 'GCOM-C', operator: 'JAXA',
    orbit: { altitudeKm: 798, ltdnHours: 10.5 },
    instruments: {
      vnr: { kind: 'visual', label: 'SGLI-VNR', band: 'VNIR 0.38–0.87 µm', scan: 'pushbroom', gsdM: 250, swathKm: 1150, detectorPitchUm: null, maxFovDeg: 80, whiskRowsPerSweep: 16, recordsAtNight: false, note: '3 telescopes × 24°' },
      irs: { kind: 'thermal', label: 'SGLI-IRS', band: 'TIR 10.8 / 12.0 µm', scan: 'whiskbroom', gsdM: 250, swathKm: 1400, detectorPitchUm: 140, whiskRowsPerSweep: 20, recordsAtNight: true, note: 'rotating scan mirror, 20 rows/sweep' },
    },
  },
  sentinel1: {
    name: 'Sentinel-1', operator: 'ESA / Copernicus',
    orbit: { altitudeKm: 693, ltdnHours: 6.0 }, // dawn-dusk: LTAN 18:00
    instruments: {
      csar: {
        kind: 'sar', label: 'C-SAR', band: 'C-band 5.405 GHz', lookSide: 'right', defaultMode: 'IW', recordsAtNight: true,
        modes: {
          IW: { label: 'IW', incCenterDeg: 37.55, swathKm: 250, resRangeM: 5, resAzM: 20, looks: 5 },
          EW: { label: 'EW', incCenterDeg: 32.95, swathKm: 410, resRangeM: 20, resAzM: 40, looks: 10 },
          SM: { label: 'SM', incCenterDeg: 32.5, swathKm: 80, resRangeM: 5, resAzM: 5, looks: 4 },
        },
        approx: ['looks', 'SM beam incidence'],
      },
    },
  },
  sentinel2: {
    name: 'Sentinel-2', operator: 'ESA / Copernicus',
    orbit: { altitudeKm: 786, ltdnHours: 10.5 },
    instruments: {
      msi: { kind: 'visual', label: 'MSI', band: 'VNIR/SWIR 0.44–2.19 µm', scan: 'pushbroom', gsdM: 10, swathKm: 290, detectorPitchUm: 7.5, whiskRowsPerSweep: 16, recordsAtNight: false },
    },
  },
  constellr: {
    name: 'constellr HiVE', operator: 'constellr',
    orbit: { altitudeKm: 510, ltdnHours: 10.5 },
    instruments: {
      tir: { kind: 'thermal', label: 'TIR', band: 'TIR 8.6–11.75 µm (4 bands)', scan: 'pushbroom', gsdM: 28.9, swathKm: 18.5, detectorPitchUm: 15, whiskRowsPerSweep: 10, recordsAtNight: true, note: 'push-frame', approx: ['pitch', 'LTDN'] },
      vnir: { kind: 'visual', label: 'VNIR', band: 'VNIR 0.44–0.95 µm', scan: 'pushbroom', gsdM: 5, swathKm: 21, detectorPitchUm: null, whiskRowsPerSweep: 16, recordsAtNight: false, approx: ['GSD (5 m native vs 10 m product)', 'LTDN'] },
    },
  },
  satvu: {
    name: 'SatVu HotSat', operator: 'Satellite Vu',
    orbit: { altitudeKm: 530, ltdnHours: 10.5 },
    instruments: {
      mwir: {
        kind: 'thermal', label: 'MWIR', band: 'MWIR 3.7–5 µm', scan: 'framing', gsdM: 3.5, swathKm: 3.5, detectorPitchUm: 8,
        frameRows: 1290, whiskRowsPerSweep: 10, recordsAtNight: true,
        imaging: 'targeted', maxOffNadirDeg: 30, // tasked frames of TARGETS only, agile ±30° off-nadir
        note: 'tasked 3.5 × 4.5 km frames of 80 cities', approx: ['altitude', 'LTDN', 'frame size', 'agility ±30°'],
      },
    },
  },
  alos2: {
    name: 'ALOS-2', operator: 'JAXA',
    orbit: { altitudeKm: 628, ltdnHours: 12.0 },
    instruments: {
      palsar2: {
        kind: 'sar', label: 'PALSAR-2', band: 'L-band 1.2 GHz', lookSide: 'right', defaultMode: 'UF', recordsAtNight: true,
        modes: {
          SPT: { label: 'Spotlight', incCenterDeg: 35, swathKm: 25, resRangeM: 3, resAzM: 1, looks: 1 },
          UF: { label: 'Ultrafine', incCenterDeg: 35, swathKm: 50, resRangeM: 3, resAzM: 3, looks: 1 },
          FINE: { label: 'Fine', incCenterDeg: 35, swathKm: 70, resRangeM: 10, resAzM: 10, looks: 2 },
          SCAN: { label: 'ScanSAR', incCenterDeg: 38, swathKm: 350, resRangeM: 100, resAzM: 100, looks: 8 },
        },
        approx: ['beam center incidence', 'looks'],
      },
    },
  },
  alos4: {
    name: 'ALOS-4', operator: 'JAXA',
    orbit: { altitudeKm: 628, ltdnHours: 12.0 },
    instruments: {
      palsar3: {
        kind: 'sar', label: 'PALSAR-3', band: 'L-band 1.2 GHz', lookSide: 'right', defaultMode: 'SM', recordsAtNight: true,
        modes: {
          SPT: { label: 'Spotlight', incCenterDeg: 37, swathKm: 35, resRangeM: 3, resAzM: 1, looks: 1 },
          SM: { label: 'Stripmap', incCenterDeg: 37, swathKm: 200, resRangeM: 3, resAzM: 3, looks: 1 },
          SCAN: { label: 'ScanSAR', incCenterDeg: 40, swathKm: 700, resRangeM: 25, resAzM: 25, looks: 4 },
        },
        approx: ['ScanSAR center incidence', 'looks'],
      },
    },
  },
  custom: {
    name: 'Custom (generic)', operator: 'sandbox',
    orbit: { altitudeKm: 700, ltdnHours: 10.5 },
    instruments: SENSOR_PRESETS,
  },
};
export const DEFAULT_SATELLITE = 'landsat89';
export const DEFAULT_INSTRUMENT = 'tirs';

// FOV limits by scan type: a pushbroom needs wide-field optics (single telescopes rarely exceed
// ~20-40 deg); a whiskbroom's mirror sweeps the FOV through narrow optics, so it can go much
// wider; framing (staring) arrays are narrow. Per-instrument maxFovDeg overrides (e.g. GCOM-C
// VNR uses 3 telescopes). Horizon limit at 700 km is ~128 deg.
export const FOV_RANGE_DEG = { pushbroom: [2, 40], whiskbroom: [2, 110], framing: [0.2, 20] };

// Altitude slider range for "what if" orbits (km). Presets set the mission altitude.
export const ALTITUDE_RANGE_KM = [300, 1200];

// Recording safety cap: rows of swath (300 per orbit) => ~18 days at 700 km.
export const MAX_RECORD_ROWS = 80000;

// Optical (visual) imaging needs sunlight; thermal records day and night.
export const VISUAL_MIN_SUN_ELEV_DEG = 5;

// Drifting, evolving cloud field (js/geo/clouds.js). Deterministic for a given seed.
export const CLOUDS = {
  seed: 11,
  systems: 320,
  lifetimeH: [8, 20],      // each system forms, lives, dissipates, respawns elsewhere
  puffs: [4, 9],           // puffs per system
  puffRadiusKm: [70, 230],
  spreadKm: 260,           // max puff offset from the system center
  altitudeKm: 70,          // render height above the surface (exaggerated)
  tropicalWindKmH: -30,    // easterlies (westward) for |lat| < 25
  midlatWindKmH: 50,       // westerlies (eastward) for |lat| > 35
};

// Pixel close-up sample scene: fixed ground window and texel size
export const CLOSEUP = { sizeM: 3000, texelM: 5, tempRangeC: [15, 45] };

// Scene scale: 1 Three.js unit = 1000 km.
export const SCENE_KM_PER_UNIT = 1000;

// Exaggeration factor for the satellite model (real size would be invisible).
export const SATELLITE_MODEL_SCALE = 1.0;

export const TIME_WARPS = [1, 10, 60, 300, 1000, 5000, 10000, 50000];
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
  swath: { thermal: '#ff9f43', visual: '#3fd8c2', sar: '#6aa8ff' }, // one color per kind, day = night
  cloudMask: '#3f4555',    // recorded-under-cloud cells: dark slate (distinct from white clouds)
  cloudMaskHatch: '#e9edf5', // light diagonal stripes on the map = "unusable" 
  cloudMap: 'rgba(255, 255, 255, 0.55)',
  // LST colormap (cool -> hot) for the thermal close-up: [t in 0..1, color]
  thermalRamp: [
    [0, '#2c3e9e'], [0.25, '#2fa7d8'], [0.5, '#8fd16b'],
    [0.7, '#f6d544'], [0.85, '#f2843a'], [1, '#d93a2b'],
  ],
};
