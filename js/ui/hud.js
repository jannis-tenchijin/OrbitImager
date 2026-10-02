// Telemetry panel: grouped tiles. Text updates are throttled to avoid layout churn every frame.

const GROUPS = [
  {
    title: 'Orbit',
    fields: [
      ['utc', 'UTC time', 'wide'],
      ['orbit', 'Orbit #'],
      ['lat', 'Latitude'],
      ['lon', 'Longitude'],
      ['alt', 'Altitude'],
      ['speed', 'Speed'],
      ['period', 'Period'],
      ['inc', 'Inclination'],
    ],
  },
  {
    title: 'Sensor',
    accent: true,
    fields: [
      ['sensor', 'Type'],
      ['pixels', 'Pixels across'],
      ['ifov', 'IFOV'],
      ['fov', 'FOV'],
      ['gsd', 'GSD (nadir)'],
      ['swath', 'Swath'],
    ],
  },
];

export function createHud(container) {
  const els = {};
  for (const group of GROUPS) {
    const section = document.createElement('section');
    section.className = `hud-group${group.accent ? ' accent' : ''}`;
    section.innerHTML = `<h2 class="hud-title">${group.title}</h2><div class="hud-grid"></div>`;
    const grid = section.querySelector('.hud-grid');
    for (const [key, label, cls] of group.fields) {
      const tile = document.createElement('div');
      tile.className = `hud-tile${cls ? ' ' + cls : ''}`;
      tile.innerHTML = `<span class="hud-label">${label}</span><span class="hud-value">–</span>`;
      grid.appendChild(tile);
      els[key] = tile.querySelector('.hud-value');
    }
    container.appendChild(section);
  }

  let last = 0;
  return {
    /** values: { key: displayString } for any keys defined in GROUPS */
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
  m: (x) => `${x.toFixed(1)} m`,
  min: (s) => `${(s / 60).toFixed(1)} min`,
  deg: (d) => `${d.toFixed(2)}°`,
  int: (n) => n.toLocaleString('en-US'),
  urad: (u) => `${u.toFixed(1)} µrad`,
  cap: (s) => s.charAt(0).toUpperCase() + s.slice(1),
};
