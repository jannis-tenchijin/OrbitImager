// Sensor card: thermal/visual switch, pushbroom/whiskbroom switch, FOV slider (focal-length
// model, range depends on scan type) and derived-value tiles.
// Fixed properties of the hardware are shown with a lock; derived values flash on change.

import { fmt } from './hud.js';

const TILES = [
  // [key, label, fixed?, onlyFor?]
  ['pixels', 'Pixels', true],
  ['pitch', 'Pitch', true],
  ['rows', 'Rows/sweep', true, 'whiskbroom'],
  ['focal', 'Focal', false],
  ['ifov', 'IFOV', false],
  ['gsd', 'GSD nadir', false],
  ['gsdEdge', 'GSD edge', false],
  ['swath', 'Swath', false],
  ['line', 'Line time', false],
  ['period', 'Scan period', false, 'whiskbroom'],
  ['eta', 'Earth view', false, 'whiskbroom'],
  ['rpm', 'Mirror', false, 'whiskbroom'],
  ['dwell', 'Pixel dwell', false],
];

const SCANS = [
  ['pushbroom', 'Pushbroom'],
  ['whiskbroom', 'Whiskbroom'],
];

const NOTES = {
  pushbroom: 'Detector array fixed · FOV changes the focal length · wide-field optics limit FOV',
  whiskbroom: 'Mirror sweeps the FOV through narrow optics · much wider FOV possible',
};

/**
 * container: element to fill. presets: SENSOR_PRESETS. fovRanges: { pushbroom: [min,max], whiskbroom }.
 * onChange({ presetId, fovDeg, scan }) fires on any user change.
 */
export function createSensorPanel(container, { presets, fovRanges, initialId, nativeFov, onChange }) {
  container.innerHTML = `
    <div class="card-head">
      <h2 class="card-title accent">Sensor</h2>
      <div class="segmented sensor-switch" role="group" aria-label="Sensor type"></div>
    </div>
    <div class="sensor-sub"></div>
    <div class="scan-row">
      <span class="ctl-label">Scan</span>
      <div class="segmented scan-switch" role="group" aria-label="Scan type"></div>
    </div>
    <div class="slider-row">
      <label for="fov-slider">FOV</label>
      <input id="fov-slider" type="range" step="0.1" />
      <output for="fov-slider" class="slider-value">–</output>
      <button class="icon-btn small" title="Reset to native FOV" aria-label="Reset FOV">↺</button>
    </div>
    <div class="slider-note"></div>
    <div class="hud-grid"></div>`;

  const seg = container.querySelector('.sensor-switch');
  const scanSeg = container.querySelector('.scan-switch');
  const sub = container.querySelector('.sensor-sub');
  const slider = container.querySelector('#fov-slider');
  const out = container.querySelector('.slider-value');
  const note = container.querySelector('.slider-note');
  const reset = container.querySelector('button[aria-label="Reset FOV"]');
  const grid = container.querySelector('.hud-grid');

  const els = {};
  for (const [key, label, fixed, onlyFor] of TILES) {
    const tile = document.createElement('div');
    tile.className = `hud-tile${fixed ? ' fixed' : ''}`;
    if (onlyFor) tile.dataset.only = onlyFor;
    tile.innerHTML = `<span class="hud-label">${fixed ? '🔒 ' : ''}${label}</span><span class="hud-value">–</span>`;
    grid.appendChild(tile);
    els[key] = tile;
  }

  const first = presets[initialId];
  const state = { presetId: initialId, scan: first.scan, fovDeg: nativeFov(first) };
  const clampFov = () => {
    const [lo, hi] = fovRanges[state.scan];
    state.fovDeg = Math.min(hi, Math.max(lo, state.fovDeg));
  };
  const emit = () => onChange({ ...state });

  for (const p of Object.values(presets)) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.dataset.id = p.id;
    b.addEventListener('click', () => {
      if (state.presetId === p.id) return;
      state.presetId = p.id;
      state.fovDeg = nativeFov(p); // each sensor starts at its native optics
      clampFov();
      sync();
      emit();
    });
    seg.appendChild(b);
  }
  for (const [id, label] of SCANS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.scan = id;
    b.addEventListener('click', () => {
      if (state.scan === id) return;
      state.scan = id;
      clampFov(); // pushbroom optics can't keep a whiskbroom-wide FOV
      sync();
      emit();
    });
    scanSeg.appendChild(b);
  }

  slider.addEventListener('input', () => {
    state.fovDeg = Number(slider.value);
    out.textContent = `${state.fovDeg.toFixed(1)}°`;
    emit();
  });
  reset.addEventListener('click', () => {
    state.fovDeg = nativeFov(presets[state.presetId]);
    clampFov();
    sync();
    emit();
  });

  function sync() {
    const p = presets[state.presetId];
    for (const b of seg.children) b.classList.toggle('active', b.dataset.id === p.id);
    for (const b of scanSeg.children) b.classList.toggle('active', b.dataset.scan === state.scan);
    sub.textContent = `${p.band} · like ${p.inspiredBy}`;
    const [lo, hi] = fovRanges[state.scan];
    slider.min = lo;
    slider.max = hi;
    slider.value = state.fovDeg;
    out.textContent = `${state.fovDeg.toFixed(1)}°`;
    note.textContent = `${NOTES[state.scan]} (≤ ${hi}°)`;
    for (const tile of Object.values(els)) tile.hidden = !!tile.dataset.only && tile.dataset.only !== state.scan;
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
    /** g: sensorGeometry() result (includes .timing) */
    show(g) {
      const t = g.timing;
      setText('pixels', fmt.int(g.pixelsCrossTrack));
      setText('pitch', `${g.detectorPitchUm} µm`);
      setText('focal', `${g.focalLengthMm.toFixed(0)} mm`);
      setText('ifov', fmt.urad(g.ifovUrad));
      setText('gsd', fmt.m(g.gsdNadirM));
      setText('gsdEdge', Number.isFinite(g.gsdEdgeM) ? fmt.m(g.gsdEdgeM) : 'past horizon');
      setText('swath', fmt.km(g.swathKm));
      setText('line', fmt.ms(t.lineTimeMs));
      setText('dwell', fmt.us(t.dwellUs));
      if (t.scan === 'whiskbroom') {
        setText('rows', String(t.rowsPerSweep));
        setText('period', fmt.ms(t.scanPeriodMs));
        setText('eta', `${(t.earthViewFrac * 100).toFixed(0)}% · cal ${((1 - t.earthViewFrac) * 100).toFixed(0)}%`);
        setText('rpm', `${t.mirrorRpm.toFixed(0)} rpm`);
      }
    },
  };
}
