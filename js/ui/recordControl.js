// Record control: big red Record / Stop button + Clear (in the Results card) and the swath
// legend on the map (depends on the sensor kind). Statistics live in the Results card only.

export function createRecordControl({ buttonHost, legend }, palette, { onRecord, onStop, onClear, getMode }) {
  buttonHost.innerHTML = `
    <button class="rec-main" type="button"></button>
    <button class="text-btn small rec-clear" type="button" hidden title="Clear the recorded swaths and return to the live last-orbit view">Clear</button>`;
  const btn = buttonHost.querySelector('.rec-main');
  const clear = buttonHost.querySelector('.rec-clear');
  let mode = null;

  // Decide from the recorder's current mode (not the last-rendered one) so fast clicks behave
  btn.addEventListener('click', () => (getMode() === 'recording' ? onStop() : onRecord()));
  clear.addEventListener('click', onClear);

  return {
    /** Refresh the button for the recorder mode. */
    update(rec) {
      if (rec.mode === mode) return;
      mode = rec.mode;
      buttonHost.dataset.mode = mode;
      btn.innerHTML = mode === 'recording'
        ? '<span class="rec-square"></span>Stop'
        : `<span class="rec-dot"></span>${mode === 'stopped' ? 'Record new' : 'Record'}`;
      btn.title = mode === 'recording'
        ? 'Stop recording and keep the result on screen'
        : 'Record every swath until you press Stop';
      clear.hidden = mode !== 'stopped';
    },

    /** Swath legend for the active instrument kind. Day and night share one color. */
    setLegend(inst, { targeted = false } = {}) {
      const color = palette.swath[inst.kind];
      if (targeted) {
        legend.innerHTML = [
          '<i class="sw sw-diamond"></i>80 tasked cities',
          `<i class="sw sw-box" style="background:${color}"></i>frame`,
          '<i class="sw sw-box sw-hatch"></i>cloudy',
          '<i class="sw sw-future"></i>±30° access',
        ].join('');
        return;
      }
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
