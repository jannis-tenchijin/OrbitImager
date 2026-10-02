// Orbit telemetry tiles. Text updates are throttled to avoid layout churn every frame.

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

export function createHud(container) {
  container.innerHTML = '<h2 class="card-title">Orbit</h2><div class="hud-grid"></div>';
  const grid = container.querySelector('.hud-grid');
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
  km: (x) => (Number.isFinite(x) ? `${x.toFixed(0)} km` : 'past horizon'),
  kms: (x) => `${x.toFixed(2)} km/s`,
  m: (x) => (x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${x.toFixed(1)} m`),
  min: (s) => `${(s / 60).toFixed(1)} min`,
  deg: (d) => `${d.toFixed(2)}°`,
  int: (n) => n.toLocaleString('en-US'),
  urad: (u) => `${u.toFixed(1)} µrad`,
  /** decimal hours -> "HH:MM" */
  hhmm: (h) => {
    const m = Math.round(h * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  },
};
