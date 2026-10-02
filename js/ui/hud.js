// Orbit card: altitude slider (what-if orbits) + telemetry tiles.
// Tile text updates are throttled to avoid layout churn every frame.

const FIELDS = [
  ['utc', 'UTC time', 'wide'],
  ['local', 'Local time'],
  ['ltdn', 'LTDN'],
  ['orbit', 'Orbit #'],
  ['lat', 'Latitude'],
  ['lon', 'Longitude'],
  ['alt', 'Altitude'],
  ['speed', 'Speed'],
  ['period', 'Period'],
  ['inc', 'Inclination'],
];

/**
 * altRange: [min, max] km. onAltitude(km) fires while dragging; onResetAltitude() restores the
 * preset altitude.
 */
export function createHud(container, { altRange, onAltitude, onResetAltitude }) {
  container.innerHTML = `
    <div class="card-head"><h2 class="card-title">Orbit</h2><span class="hint">sun-synchronous · inclination auto</span></div>
    <div class="slider-row">
      <label for="alt-slider">Altitude</label>
      <input id="alt-slider" type="range" min="${altRange[0]}" max="${altRange[1]}" step="5" />
      <output for="alt-slider" class="slider-value">–</output>
      <button class="icon-btn small" title="Back to the satellite's real altitude" aria-label="Reset altitude">↺</button>
    </div>
    <div class="slider-note">Higher orbit → slower, longer period, wider swath; optical GSD coarsens, SAR resolution doesn't</div>
    <div class="hud-grid"></div>`;
  const grid = container.querySelector('.hud-grid');
  const alt = container.querySelector('#alt-slider');
  const altOut = container.querySelector('.slider-value');
  alt.addEventListener('input', () => {
    altOut.textContent = `${alt.value} km`;
    onAltitude(Number(alt.value));
  });
  container.querySelector('button[aria-label="Reset altitude"]').addEventListener('click', onResetAltitude);
  const els = {};
  for (const [key, label, cls] of FIELDS) {
    const tile = document.createElement('div');
    tile.className = `hud-tile${cls ? ' ' + cls : ''}`;
    tile.innerHTML = `<span class="hud-label">${label}</span><span class="hud-value">–</span>`;
    grid.appendChild(tile);
    els[key] = tile.querySelector('.hud-value');
  }

  let last = 0;
  return {
    /** Reflect the current altitude on the slider (e.g. after a preset change). */
    setAltitude(km) {
      alt.value = km;
      altOut.textContent = `${Math.round(km)} km`;
    },
    /** values: { key: displayString } for any keys in FIELDS */
    update(values, force = false) {
      const now = performance.now();
      if (!force && now - last < 100) return;
      last = now;
      for (const k in values) if (els[k] && els[k].textContent !== values[k]) els[k].textContent = values[k];
    },
  };
}

export const fmt = {
  utc: (ms) => new Date(ms).toISOString().replace('T', '  ').slice(0, 20),
  lat: (d) => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? 'N' : 'S'}`,
  lon: (d) => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? 'E' : 'W'}`,
  km: (x) => (Number.isFinite(x) ? `${x.toFixed(x < 100 ? 1 : 0)} km` : 'past horizon'),
  kms: (x) => `${x.toFixed(2)} km/s`,
  m: (x) => (x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${x.toFixed(1)} m`),
  min: (s) => `${(s / 60).toFixed(1)} min`,
  deg: (d) => `${d.toFixed(2)}°`,
  int: (n) => n.toLocaleString('en-US'),
  urad: (u) => `${u.toFixed(1)} µrad`,
  /** milliseconds with sensible precision */
  ms: (x) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x >= 10 ? `${x.toFixed(1)} ms` : `${x.toFixed(2)} ms`),
  /** microseconds, switching to ms when large */
  us: (x) => (x >= 1000 ? `${(x / 1000).toFixed(2)} ms` : x >= 10 ? `${x.toFixed(1)} µs` : `${x.toFixed(2)} µs`),
  /** decimal hours -> "HH:MM" */
  hhmm: (h) => {
    const m = Math.round(h * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  },
};
