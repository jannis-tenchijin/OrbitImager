// Results card: recording statistics (Earth covered %, usable %) and a place picker that reports
// how often one place was imaged ("1 image every X days", "1 usable image every Y days").

import { fmt } from './hud.js';

const GLOBAL = [
  ['days', 'Duration'],
  ['orbits', 'Orbits'],
  ['covered', 'Earth covered'],
  ['usable', 'Usable (clear)'],
];
const PLACE = [
  ['images', 'Images'],
  ['cloudy', 'Cloudy'],
  ['clear', 'Usable'],
  ['every', '1 image every'],
  ['everyUsable', '1 usable every'],
];

const pct = fmt.pct;
const daysText = (d) => (Number.isFinite(d) ? `${d < 10 ? d.toFixed(1) : d.toFixed(0)} days` : '—');

/**
 * container: card element. onPickStart(): arm map picking. onClearPlace(): remove the pin.
 */
export function createResultsPanel(container, { onPickStart, onClearPlace }) {
  container.innerHTML = `
    <div class="card-head">
      <h2 class="card-title accent">Results <span class="hint results-state"></span></h2>
      <div class="rec-host"></div>
    </div>
    <div class="results-empty">Press <b>● Record</b> to collect coverage and revisit statistics until you press Stop.</div>
    <div class="results-body" hidden>
      <div class="hud-grid global"></div>
      <div class="place-row">
        <button class="text-btn small pick-btn" type="button" title="Click a place on the map to see how often it was imaged">📍 Pick place</button>
        <span class="place-name">no place selected</span>
        <button class="icon-btn small clear-place" type="button" title="Remove the pin" aria-label="Clear place" hidden>✕</button>
      </div>
      <div class="hud-grid place" hidden></div>
      <div class="place-note"></div>
    </div>`;
  const $ = (s) => container.querySelector(s);
  const make = (grid, fields) => Object.fromEntries(fields.map(([k, label]) => {
    const tile = document.createElement('div');
    tile.className = 'hud-tile';
    tile.innerHTML = `<span class="hud-label">${label}</span><span class="hud-value">–</span>`;
    grid.appendChild(tile);
    return [k, tile.querySelector('.hud-value')];
  }));
  const g = make($('.global'), GLOBAL);
  const p = make($('.place'), PLACE);
  const set = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };

  const pickBtn = $('.pick-btn');
  pickBtn.addEventListener('click', () => {
    pickBtn.classList.add('armed');
    pickBtn.textContent = '📍 Click the map…';
    onPickStart();
  });
  $('.clear-place').addEventListener('click', onClearPlace);

  return {
    /** Where the Record / Stop / Clear buttons live. */
    recHost: $('.rec-host'),

    /** Picking finished (place chosen or cancelled). */
    pickDone() {
      pickBtn.classList.remove('armed');
      pickBtn.textContent = '📍 Pick place';
    },

    /**
     * mode: recorder mode; summary: recorder.summary(); place: { latDeg, lonDeg } | null;
     * stats: recorder.placeStats() | null; targeted: SatVu-style instrument.
     */
    update({ mode, summary, place, stats, targeted }) {
      const active = mode !== 'live' && summary;
      $('.results-empty').hidden = !!active;
      $('.results-body').hidden = !active;
      set($('.results-state'), mode === 'recording' ? 'recording…' : mode === 'stopped' ? 'final' : '');
      if (!active) return;
      set(g.days, `${summary.days.toFixed(2)} d`);
      set(g.orbits, String(summary.orbits));
      set(g.covered, pct(summary.coveredPct));
      set(g.usable, pct(summary.usablePct));

      $('.clear-place').hidden = !place;
      $('.place').hidden = !place || !stats;
      const coords = place ? `${fmt.lat(place.latDeg)}, ${fmt.lon(place.lonDeg)}` : '';
      set($('.place-name'), place ? (place.name ? `${place.name} · ${coords}` : coords) : 'no place selected');
      if (!place || !stats) {
        set($('.place-note'), '');
        return;
      }
      set(p.images, String(stats.images));
      set(p.cloudy, String(stats.cloudy));
      set(p.clear, String(stats.usable));
      set(p.every, daysText(stats.everyDays));
      set(p.everyUsable, daysText(stats.usableEveryDays));
      const notes = [];
      if (stats.nightNoData) notes.push(`${stats.nightNoData} night pass${stats.nightNoData > 1 ? 'es' : ''} not recorded (no sunlight)`);
      if (targeted && !stats.images) notes.push('not one of the 80 tasked cities — SatVu only images its targets');
      set($('.place-note'), notes.join(' · '));
    },
  };
}
