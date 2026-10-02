// Record control: big red Record / Stop button (header), Clear after stopping, a REC status
// badge on the map, and the swath legend (depends on the sensor kind).

export function createRecordControl({ buttonHost, badge, legend }, palette, { onRecord, onStop, onClear, getMode }) {
  buttonHost.innerHTML = `
    <button class="rec-main" type="button"></button>
    <button class="text-btn rec-clear" type="button" hidden title="Clear the recorded swaths and return to the live last-orbit view">Clear</button>`;
  const btn = buttonHost.querySelector('.rec-main');
  const clear = buttonHost.querySelector('.rec-clear');
  let mode = null;

  // Decide from the recorder's current mode (not the last-rendered one) so fast clicks behave
  btn.addEventListener('click', () => (getMode() === 'recording' ? onStop() : onRecord()));
  clear.addEventListener('click', onClear);

  let last = 0;
  return {
    /** Refresh button + badge from the recorder (text throttled to ~5 Hz). */
    update(rec, force = false) {
      if (rec.mode !== mode) {
        mode = rec.mode;
        buttonHost.dataset.mode = mode;
        badge.dataset.mode = mode;
        btn.innerHTML = mode === 'recording'
          ? '<span class="rec-square"></span>Stop'
          : `<span class="rec-dot"></span>${mode === 'stopped' ? 'Record new' : 'Record'}`;
        btn.title = mode === 'recording'
          ? 'Stop recording and keep the result on screen'
          : 'Record every swath until you press Stop';
        clear.hidden = mode !== 'stopped';
        badge.hidden = mode === 'live';
        force = true;
      }
      const now = performance.now();
      if (!force && now - last < 200) return;
      last = now;
      const s = rec.summary();
      if (!s) return;
      const core = `${s.days.toFixed(1)} d · ${s.orbits} orbits · usable ${s.usablePct.toFixed(1)}%`;
      if (mode === 'recording') {
        badge.innerHTML = `<span class="rec-live"></span>REC · ${core}`;
        badge.title = `Recording for ${s.days.toFixed(2)} days (${s.orbits} orbits). Usable (cloud-free) coverage: ${s.usablePct.toFixed(1)}% of the globe.`;
      } else if (mode === 'stopped') {
        const why = s.reason === 'buffer full' ? ' · buffer full' : '';
        badge.textContent = `Stopped · ${core} · cloudy ${s.cloudyPct.toFixed(0)}%${why}`;
        badge.title = `${s.days.toFixed(2)} days, ${s.orbits} orbits. Usable coverage ${s.usablePct.toFixed(1)}% of the globe; ${s.cloudyPct.toFixed(1)}% of the imaged area was only seen under cloud.${why ? ' Recording stopped at the memory cap.' : ''}`;
      }
    },

    /** Swath legend for the active instrument kind. Day and night share one color. */
    setLegend(inst) {
      const color = palette.swath[inst.kind];
      const items = [`<i class="sw sw-box" style="background:${color}"></i>recorded`];
      if (!inst.recordsAtNight) items.push('<i class="sw sw-box sw-none"></i>night: no data');
      items.push(inst.kind === 'sar'
        ? '<i class="sw sw-box sw-none"></i>clouds: no effect'
        : '<i class="sw sw-box sw-hatch"></i>cloud · unusable');
      items.push('<i class="sw sw-past"></i>track');
      legend.innerHTML = items.join('');
    },
  };
}
