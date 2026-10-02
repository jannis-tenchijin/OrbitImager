// Record control (map panel header): Record / Stop / Clear + live status and cycle summary.
// Also renders the swath legend, which depends on the sensor (visual has no night data).

export function createRecordControl(container, legendEl, palette, { onRecord, onStop, getMode }) {
  container.innerHTML = `
    <span class="rec-status" aria-live="polite"></span>
    <button class="rec-btn" type="button"></button>
    <button class="text-btn small rec-clear" type="button" hidden>Clear</button>`;
  const status = container.querySelector('.rec-status');
  const btn = container.querySelector('.rec-btn');
  const clear = container.querySelector('.rec-clear');
  let mode = null;

  // Decide from the recorder's current mode (not the last-rendered one) so fast clicks behave
  btn.addEventListener('click', () => (getMode() === 'recording' ? onStop() : onRecord()));
  clear.addEventListener('click', () => onStop());

  let last = 0;
  return {
    /** Refresh button + status from the recorder (text throttled to ~5 Hz). */
    update(rec, tMs, force = false) {
      if (rec.mode !== mode) {
        mode = rec.mode;
        container.dataset.mode = mode;
        btn.innerHTML = mode === 'recording'
          ? '<span class="rec-square"></span>Stop'
          : `<span class="rec-dot"></span>${mode === 'complete' ? 'Record again' : 'Record'}`;
        btn.title = mode === 'recording'
          ? 'Stop recording and return to the live last-orbit swath'
          : 'Accumulate swaths until the satellite is back over its start point or has circled the globe';
        clear.hidden = mode !== 'complete';
        force = true;
      }
      const now = performance.now();
      if (!force && now - last < 200) return;
      last = now;
      let text = '', title = '';
      if (mode === 'recording') {
        const s = rec.summary();
        text = `REC ${s.orbits + 1}/${rec.start.expectedOrbits} · ${Math.round(rec.progress(tMs) * 100)}% · usable ${s.usablePct.toFixed(1)}%`;
        title = `Recording orbit ${s.orbits + 1} of ~${rec.start.expectedOrbits}; usable (cloud-free) coverage so far ${s.usablePct.toFixed(1)}% of the globe`;
      } else if (mode === 'complete') {
        const s = rec.summary();
        text = `Done · ${s.orbits} orbits · usable ${s.usablePct.toFixed(1)}% · cloudy ${s.cloudyPct.toFixed(0)}%`;
        title = `Cycle complete (${s.reason}) after ${s.orbits} orbits. Usable coverage: ${s.usablePct.toFixed(1)}% of the globe. ${s.cloudyPct.toFixed(1)}% of the imaged area was only seen under cloud.`;
      }
      status.textContent = text;
      status.title = title;
    },

    /** Swath legend for the active sensor. */
    setLegend(preset) {
      const day = palette.swath[preset.id];
      const items = [
        `<i class="sw sw-box" style="background:${day}"></i>${preset.recordsAtNight ? 'day' : 'recorded'}`,
        preset.recordsAtNight
          ? `<i class="sw sw-box" style="background:${palette.swathNight}"></i>night`
          : '<i class="sw sw-box sw-none"></i>night: no data',
        '<i class="sw sw-box sw-hatch"></i>cloud · unusable',
        '<i class="sw sw-past"></i>track',
      ];
      legendEl.innerHTML = items.join('');
    },
  };
}
