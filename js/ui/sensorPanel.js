// Sensor card: satellite preset, instrument, then either
//   optical: scan type (pushbroom / whiskbroom / framing) + FOV slider (focal-length model), or
//   SAR:     radar mode (resolution + swath from the mode, not from FOV)
// plus derived-value tiles. Hardware values show a lock; derived values flash on change.

import { fmt } from './hud.js';

// [key, label, fixed?, onlyFor] — onlyFor: scan type ('whiskbroom'|'framing'), 'optical' or 'sar'
const TILES = [
  ['pixels', 'Pixels', true, 'optical'],
  ['pitch', 'Pitch', true, 'optical'],
  ['rows', 'Rows/sweep', true, 'whiskbroom'],
  ['frameRows', 'Frame rows', true, 'framing'],
  ['look', 'Look side', true, 'sar'],
  ['res', 'Resolution', true, 'sar'],
  ['looks', 'Looks', true, 'sar'],
  ['focal', 'Focal', false, 'optical'],
  ['ifov', 'IFOV', false, 'optical'],
  ['gsd', 'GSD nadir', false, 'optical'],
  ['gsdEdge', 'GSD edge', false, 'optical'],
  ['inc', 'Incidence', false, 'sar'],
  ['lookAng', 'Look angle', false, 'sar'],
  ['swath', 'Swath', false],
  ['gap', 'Nadir gap', false, 'sar'],
  ['line', 'Line time', false],
  ['period', 'Scan period', false, 'whiskbroom'],
  ['eta', 'Earth view', false, 'whiskbroom'],
  ['rpm', 'Mirror', false, 'whiskbroom'],
  ['framePeriod', 'Frame period', false, 'framing'],
  ['dwell', 'Pixel dwell', false, 'optical'],
];

const SCANS = [
  ['pushbroom', 'Pushbroom'],
  ['whiskbroom', 'Whiskbroom'],
  ['framing', 'Framing'],
];

const NOTES = {
  pushbroom: 'Detector array fixed · FOV changes the focal length · wide-field optics limit FOV',
  whiskbroom: 'Mirror sweeps the FOV through narrow optics · much wider FOV possible',
  framing: 'Staring 2-D array exposes whole frames · narrow FOV',
};

/**
 * container: element to fill. catalog: resolved SATELLITES. fovRanges: per scan [min, max].
 * initial: { satId, instId }. onChange(state, what) fires on any user change
 * (what = 'satellite' | 'instrument' | 'scan' | 'fov' | 'mode').
 */
export function createSensorPanel(container, { catalog, fovRanges, initial, nativeFov, onChange }) {
  container.innerHTML = `
    <div class="card-head">
      <h2 class="card-title accent">Sensor</h2>
      <span class="whatif" hidden>what-if</span>
    </div>
    <div class="preset-row">
      <label class="select-wrap"><span class="ctl-label">Satellite</span><select class="sat-select" aria-label="Satellite preset"></select></label>
      <div class="segmented inst-switch" role="group" aria-label="Instrument"></div>
    </div>
    <div class="sensor-sub"></div>
    <div class="optical-only">
      <div class="scan-row">
        <span class="ctl-label">Scan</span>
        <div class="segmented scan-switch" role="group" aria-label="Scan type"></div>
      </div>
      <div class="slider-row">
        <label for="fov-slider">FOV</label>
        <input id="fov-slider" type="range" />
        <output for="fov-slider" class="slider-value">–</output>
        <button class="icon-btn small" title="Reset to the instrument's native FOV" aria-label="Reset FOV">↺</button>
      </div>
      <div class="slider-note"></div>
    </div>
    <div class="sar-only scan-row" hidden>
      <span class="ctl-label">Mode</span>
      <div class="segmented mode-switch" role="group" aria-label="SAR mode"></div>
    </div>
    <div class="sar-only slider-note" hidden>Radar resolution comes from bandwidth + antenna, not FOV — it does not change with altitude. Sees through clouds, day and night.</div>
    <div class="hud-grid"></div>`;

  const $ = (sel) => container.querySelector(sel);
  const satSel = $('.sat-select'), instSeg = $('.inst-switch'), scanSeg = $('.scan-switch'), modeSeg = $('.mode-switch');
  const sub = $('.sensor-sub'), slider = $('#fov-slider'), out = $('.slider-value'), note = $('.slider-note');
  const whatif = $('.whatif'), grid = $('.hud-grid');

  const els = {};
  for (const [key, label, fixed, onlyFor] of TILES) {
    const tile = document.createElement('div');
    tile.className = `hud-tile${fixed ? ' fixed' : ''}`;
    if (onlyFor) tile.dataset.only = onlyFor;
    tile.innerHTML = `<span class="hud-label">${fixed ? '🔒 ' : ''}${label}</span><span class="hud-value">–</span>`;
    grid.appendChild(tile);
    els[key] = tile;
  }

  for (const [id, sat] of Object.entries(catalog)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = sat.name;
    satSel.appendChild(o);
  }
  for (const [id, label] of SCANS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.scan = id;
    b.addEventListener('click', () => {
      if (state.scan === id) return;
      state.scan = id;
      clampFov(); // e.g. pushbroom optics can't keep a whiskbroom-wide FOV
      sync();
      onChange({ ...state }, 'scan');
    });
    scanSeg.appendChild(b);
  }

  const state = {};
  const inst = () => catalog[state.satId].instruments[state.instId];

  /** FOV slider range for the current instrument + scan type (always includes the native FOV). */
  function fovRange() {
    const i = inst(), native = nativeFov(i);
    const [lo0, hi0] = fovRanges[state.scan];
    const hi = state.scan === i.scan && i.maxFovDeg ? i.maxFovDeg : hi0;
    return [Math.min(lo0, native / 2), Math.max(hi, state.scan === i.scan ? native * 1.1 : 0)];
  }
  function clampFov() {
    const [lo, hi] = fovRange();
    state.fovDeg = Math.min(hi, Math.max(lo, state.fovDeg));
  }

  /** Select an instrument: its native scan, FOV and (SAR) default mode. */
  function selectInstrument(satId, instId) {
    state.satId = satId;
    state.instId = instId ?? Object.keys(catalog[satId].instruments)[0];
    const i = inst();
    state.scan = i.kind === 'sar' ? 'sar' : i.scan;
    state.fovDeg = i.kind === 'sar' ? null : nativeFov(i);
    state.modeId = i.kind === 'sar' ? i.defaultMode : null;
    buildInstrumentButtons();
    buildModeButtons();
    sync();
  }

  function buildInstrumentButtons() {
    instSeg.innerHTML = '';
    for (const [id, i] of Object.entries(catalog[state.satId].instruments)) {
      const b = document.createElement('button');
      b.textContent = i.label;
      b.dataset.id = id;
      b.title = i.band;
      b.addEventListener('click', () => {
        if (state.instId === id) return;
        selectInstrument(state.satId, id);
        onChange({ ...state }, 'instrument');
      });
      instSeg.appendChild(b);
    }
  }

  function buildModeButtons() {
    modeSeg.innerHTML = '';
    const i = inst();
    if (i.kind !== 'sar') return;
    for (const [id, m] of Object.entries(i.modes)) {
      const b = document.createElement('button');
      b.textContent = m.label;
      b.dataset.mode = id;
      b.title = `${m.resRangeM} × ${m.resAzM} m · ${m.swathKm} km`;
      b.addEventListener('click', () => {
        if (state.modeId === id) return;
        state.modeId = id;
        sync();
        onChange({ ...state }, 'mode');
      });
      modeSeg.appendChild(b);
    }
  }

  satSel.addEventListener('change', () => {
    selectInstrument(satSel.value);
    onChange({ ...state }, 'satellite');
  });
  slider.addEventListener('input', () => {
    state.fovDeg = Number(slider.value);
    out.textContent = fmtFov(state.fovDeg);
    updateWhatIf();
    onChange({ ...state }, 'fov');
  });
  $('button[aria-label="Reset FOV"]').addEventListener('click', () => {
    state.fovDeg = nativeFov(inst());
    clampFov();
    sync();
    onChange({ ...state }, 'fov');
  });

  const fmtFov = (d) => `${d < 10 ? d.toFixed(2) : d.toFixed(1)}°`;
  let altModified = false;
  function updateWhatIf() {
    const i = inst();
    const changed = i.kind !== 'sar' && (state.scan !== i.scan || Math.abs(state.fovDeg - nativeFov(i)) > 1e-6);
    whatif.hidden = !(changed || altModified);
  }

  function sync() {
    const i = inst(), sat = catalog[state.satId], sar = i.kind === 'sar';
    satSel.value = state.satId;
    for (const b of instSeg.children) b.classList.toggle('active', b.dataset.id === state.instId);
    for (const b of scanSeg.children) b.classList.toggle('active', b.dataset.scan === state.scan);
    for (const b of modeSeg.children) b.classList.toggle('active', b.dataset.mode === state.modeId);
    const approx = i.approx?.length ? ` · ≈ ${i.approx.join(', ')}` : '';
    sub.textContent = `${i.band} · ${sat.operator}${i.note ? ` · ${i.note}` : ''}${approx}`;
    container.querySelectorAll('.optical-only').forEach((e) => (e.hidden = sar));
    container.querySelectorAll('.sar-only').forEach((e) => (e.hidden = !sar));
    if (!sar) {
      const [lo, hi] = fovRange();
      slider.min = lo;
      slider.max = hi;
      slider.step = (hi - lo) / 1000;
      slider.value = state.fovDeg;
      out.textContent = fmtFov(state.fovDeg);
      note.textContent = `${NOTES[state.scan]} (≤ ${hi.toFixed(0)}°)`;
    }
    for (const tile of Object.values(els)) {
      const only = tile.dataset.only;
      tile.hidden = !!only && !(only === state.scan || (only === 'optical' && !sar) || (only === 'sar' && sar));
    }
    updateWhatIf();
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

  selectInstrument(initial.satId, initial.instId);
  return {
    state,
    /** Flag "what-if" when the altitude differs from the preset. */
    setAltitudeModified(on) {
      altModified = on;
      updateWhatIf();
    },
    /** Programmatic selection (e.g. from tests / console). */
    select(satId, instId) {
      selectInstrument(satId, instId);
      onChange({ ...state }, 'satellite');
    },
    /** g: instrumentGeometry() result */
    show(g) {
      const t = g.timing;
      setText('swath', fmt.km(g.swathKm));
      setText('line', fmt.ms(t.lineTimeMs));
      if (g.kind === 'sar') {
        setText('look', inst().lookSide === 'left' ? 'Left' : 'Right');
        setText('res', `${g.resRangeM} × ${g.resAzM} m`);
        setText('looks', String(g.looks));
        setText('inc', `${g.incNearDeg.toFixed(1)}–${g.incFarDeg.toFixed(1)}°`);
        setText('lookAng', `${g.lookNearDeg.toFixed(1)}–${g.lookFarDeg.toFixed(1)}°`);
        setText('gap', fmt.km(g.nadirGapKm));
        return;
      }
      setText('pixels', fmt.int(g.pixelsCrossTrack));
      setText('pitch', g.detectorPitchUm ? `${g.detectorPitchUm} µm` : 'n/a');
      setText('focal', Number.isFinite(g.focalLengthMm) ? `${g.focalLengthMm.toFixed(0)} mm` : 'n/a');
      setText('ifov', fmt.urad(g.ifovUrad));
      setText('gsd', fmt.m(g.gsdNadirM));
      setText('gsdEdge', Number.isFinite(g.gsdEdgeM) ? fmt.m(g.gsdEdgeM) : 'past horizon');
      setText('dwell', fmt.us(t.dwellUs));
      if (t.scan === 'whiskbroom') {
        setText('rows', String(t.rowsPerSweep));
        setText('period', fmt.ms(t.scanPeriodMs));
        setText('eta', `${(t.earthViewFrac * 100).toFixed(0)}% · cal ${((1 - t.earthViewFrac) * 100).toFixed(0)}%`);
        setText('rpm', `${t.mirrorRpm.toFixed(0)} rpm`);
      }
      if (t.scan === 'framing') {
        setText('frameRows', fmt.int(t.frameRows));
        setText('framePeriod', fmt.ms(t.framePeriodMs));
      }
    },
  };
}
