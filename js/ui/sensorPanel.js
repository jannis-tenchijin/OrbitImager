// Sensor card: thermal/visual switch, FOV slider (focal-length model), derived-value tiles.
// Fixed properties of the detector array are shown with a lock; derived values flash on change.

import { fmt } from './hud.js';

const TILES = [
  // [key, label, fixed?]
  ['pixels', 'Pixels', true],
  ['pitch', 'Pitch', true],
  ['focal', 'Focal length', false],
  ['ifov', 'IFOV', false],
  ['gsd', 'GSD nadir', false],
  ['gsdEdge', 'GSD edge', false],
  ['swath', 'Swath', false],
];

/**
 * container: element to fill. presets: SENSOR_PRESETS. fovRange: [min, max] deg.
 * onChange({ presetId, fovDeg }) fires on any user change.
 */
export function createSensorPanel(container, { presets, fovRange, initialId, nativeFov, onChange }) {
  container.innerHTML = `
    <div class="card-head">
      <h2 class="card-title accent">Sensor</h2>
      <div class="segmented" role="group" aria-label="Sensor type"></div>
    </div>
    <div class="sensor-sub"></div>
    <div class="slider-row">
      <label for="fov-slider">FOV</label>
      <input id="fov-slider" type="range" min="${fovRange[0]}" max="${fovRange[1]}" step="0.1" />
      <output for="fov-slider" class="slider-value">–</output>
      <button class="icon-btn small" title="Reset to native FOV" aria-label="Reset FOV">↺</button>
    </div>
    <div class="slider-note">Detector array fixed · FOV changes the focal length</div>
    <div class="hud-grid"></div>`;

  const seg = container.querySelector('.segmented');
  const sub = container.querySelector('.sensor-sub');
  const slider = container.querySelector('#fov-slider');
  const out = container.querySelector('.slider-value');
  const reset = container.querySelector('button[aria-label="Reset FOV"]');
  const grid = container.querySelector('.hud-grid');

  const els = {};
  for (const [key, label, fixed] of TILES) {
    const tile = document.createElement('div');
    tile.className = `hud-tile${fixed ? ' fixed' : ''}`;
    tile.innerHTML = `<span class="hud-label">${fixed ? '🔒 ' : ''}${label}</span><span class="hud-value">–</span>`;
    grid.appendChild(tile);
    els[key] = tile;
  }

  const state = { presetId: initialId, fovDeg: nativeFov(presets[initialId]) };

  for (const p of Object.values(presets)) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.dataset.id = p.id;
    b.addEventListener('click', () => {
      state.presetId = p.id;
      state.fovDeg = nativeFov(p); // each sensor starts at its native optics
      sync();
      onChange({ ...state });
    });
    seg.appendChild(b);
  }

  slider.addEventListener('input', () => {
    state.fovDeg = Number(slider.value);
    out.textContent = `${state.fovDeg.toFixed(1)}°`;
    onChange({ ...state });
  });
  reset.addEventListener('click', () => {
    state.fovDeg = nativeFov(presets[state.presetId]);
    sync();
    onChange({ ...state });
  });

  function sync() {
    const p = presets[state.presetId];
    for (const b of seg.children) b.classList.toggle('active', b.dataset.id === p.id);
    sub.textContent = `${p.band} · ${p.scan} · like ${p.inspiredBy}`;
    slider.value = state.fovDeg;
    out.textContent = `${state.fovDeg.toFixed(1)}°`;
  }

  function setText(key, text) {
    const tile = els[key];
    const v = tile.querySelector('.hud-value');
    if (v.textContent === text) return;
    v.textContent = text;
    // Retrigger the highlight animation on derived values
    if (!tile.classList.contains('fixed')) {
      tile.classList.remove('flash');
      void tile.offsetWidth;
      tile.classList.add('flash');
    }
  }

  sync();
  return {
    state,
    /** g: sensorGeometry() result */
    show(g) {
      setText('pixels', fmt.int(g.pixelsCrossTrack));
      setText('pitch', `${g.detectorPitchUm} µm`);
      setText('focal', `${g.focalLengthMm.toFixed(0)} mm`);
      setText('ifov', fmt.urad(g.ifovUrad));
      setText('gsd', fmt.m(g.gsdNadirM));
      setText('gsdEdge', Number.isFinite(g.gsdEdgeM) ? fmt.m(g.gsdEdgeM) : 'past horizon');
      setText('swath', fmt.km(g.swathKm));
    },
  };
}
