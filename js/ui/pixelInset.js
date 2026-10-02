// Pixel close-up: a synthetic ground scene at nadir vs. what the sensor records at the current GSD.
// The scene is drawn twice with identical geometry: once in visual RGB, once as a grayscale
// temperature map (canvas anti-aliasing then blends temperatures = realistic mixed pixels).
// Recorded pixels are box averages of the ground truth, computed with summed-area tables.
//
// Acquisition animation (slow motion, loops):
//   pushbroom  - one full cross-track row appears at once, row after row.
//   whiskbroom - a k-row spot sweeps left -> right (pixel by pixel), then the mirror spends the
//                rest of its turn on calibration; the next sweep starts exactly k rows further
//                down, so there is no gap.

const PUSH_FILL_S = 5;        // real seconds to fill the scene (pushbroom)
const WHISK_SWEEP_S = 0.7;    // real seconds per visible sweep (readability)
const WHISK_CAL_MAX_S = 1.2;  // calibration pause is true-to-ratio up to this cap
const HOLD_S = 1.5;           // pause on the finished image before looping

const LEAK = { x: 1985, y: 1460, r: 22 }; // cool wet-soil patch next to a road (m)

// Land-cover classes: visual color + surface temperature (°C) on a hot summer late morning
const COVER = {
  crop:    { rgb: '#6fae4f', t: 27 },
  crop2:   { rgb: '#9cc25a', t: 29 },
  soil:    { rgb: '#b9926a', t: 38 },
  grass:   { rgb: '#c8c27a', t: 33 },
  water:   { rgb: '#3d7fc4', t: 18 },
  trees:   { rgb: '#3f8a3e', t: 24 },
  road:    { rgb: '#55575e', t: 44 },
  roofDark:{ rgb: '#7b6f6a', t: 42 },
  roofRed: { rgb: '#b5584a', t: 39 },
  roofWhite:{ rgb: '#e9ebee', t: 31 },
  factory: { rgb: '#9aa0a8', t: 47 },
  wetSoil: { rgb: '#8b6e52', t: 26 },
};

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw the scene in meters; `fill(cls)` returns the fill style for a land-cover class. */
function drawScene(ctx, fill, sizeM) {
  const rand = mulberry32(7);
  const rect = (cls, x, y, w, h) => {
    ctx.fillStyle = fill(cls);
    ctx.fillRect(x, y, w, h);
  };

  // Farmland patchwork (whole scene as base)
  const crops = ['crop', 'crop2', 'soil', 'grass', 'crop'];
  for (let y = 0; y < sizeM; y += 250) {
    for (let x = 0; x < sizeM; x += 300) {
      rect(crops[Math.floor(rand() * crops.length)], x, y, 300, 250);
    }
  }

  // Town on the right: block grid with buildings
  const town = { x: 1500, y: 250, w: 1500, h: 2500 };
  rect('grass', town.x, town.y, town.w, town.h);
  const roofs = ['roofDark', 'roofRed', 'roofWhite', 'roofDark', 'roofRed'];
  for (let by = town.y; by < town.y + town.h; by += 160) {
    for (let bx = town.x; bx < town.x + town.w; bx += 180) {
      // 2-4 buildings per block, sized 25-60 m
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const w = 25 + rand() * 35, h = 25 + rand() * 35;
        rect(roofs[Math.floor(rand() * roofs.length)], bx + 15 + rand() * (150 - w), by + 15 + rand() * (130 - h), w, h);
      }
    }
  }
  // Roads: main avenues 25 m, streets 12 m
  for (let x = town.x; x <= town.x + town.w; x += 180) rect('road', x - 6, town.y, x % 540 === 0 ? 25 : 12, town.h);
  for (let y = town.y; y <= town.y + town.h; y += 160) rect('road', town.x, y - 6, town.w, 12);
  rect('road', 0, 1440, sizeM, 25); // highway across the scene

  // Park and factory
  rect('trees', 2060, 700, 420, 330);
  rect('factory', 1560, 2240, 340, 220);
  rect('factory', 1600, 2470, 160, 90);

  // River (curvy band ~60 m wide)
  ctx.strokeStyle = fill('water');
  ctx.lineWidth = 60;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(950, -50);
  ctx.bezierCurveTo(600, 700, 1350, 1200, 900, 1900);
  ctx.bezierCurveTo(650, 2300, 1100, 2700, 1000, 3050);
  ctx.stroke();
  // Pond with tree ring
  ctx.fillStyle = fill('trees');
  ctx.beginPath();
  ctx.ellipse(420, 2300, 120, 95, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill('water');
  ctx.beginPath();
  ctx.ellipse(420, 2300, 90, 70, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Water-pipe leak: small wet, evaporatively cooled soil patch beside the highway
  ctx.fillStyle = fill('wetSoil');
  ctx.beginPath();
  ctx.ellipse(LEAK.x, LEAK.y, LEAK.r * 1.3, LEAK.r, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Summed-area table for O(1) box sums over a w x h channel. */
function buildSat(values, w, h) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += values[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  return sat;
}

function boxMean(sat, w, x0, y0, x1, y1) {
  const W = w + 1;
  const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
  return sum / ((x1 - x0) * (y1 - y0));
}

/** 256-entry RGB lookup from [t, '#rrggbb'] stops. */
function buildRamp(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < t) k++;
    const [t0, c0] = stops[k - 1], [t1, c1] = stops[k];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const a = rgb(c0), b = rgb(c1);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c] + (b[c] - a[c]) * f;
  }
  return lut;
}

export class PixelInset {
  constructor(host, palette, cfg) {
    this.host = host;
    this.cfg = cfg;
    this.canvas = document.createElement('canvas');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ramp = buildRamp(palette.thermalRamp);
    this.mode = 'thermal';
    this.gsdM = 100;
    this.scan = 'pushbroom';
    this.timing = null;
    this.animT = 0;
    this.buildTruth();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  /** Rasterize the scene at texel resolution into temperature + RGB channels and their SATs. */
  buildTruth() {
    const { sizeM, texelM, tempRangeC } = this.cfg;
    const n = Math.round(sizeM / texelM);
    this.n = n;
    const [tMin, tMax] = tempRangeC;
    const off = document.createElement('canvas');
    off.width = off.height = n;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / texelM, 0, 0, 1 / texelM, 0, 0);

    // Temperature pass: encode °C as gray level
    drawScene(g, (cls) => {
      const v = Math.round(((COVER[cls].t - tMin) / (tMax - tMin)) * 255);
      return `rgb(${v},${v},${v})`;
    }, sizeM);
    const tData = g.getImageData(0, 0, n, n).data;
    // Visual pass
    drawScene(g, (cls) => COVER[cls].rgb, sizeM);
    const vData = g.getImageData(0, 0, n, n).data;

    // Channels with a little deterministic texture noise
    const rand = mulberry32(99);
    const temp = new Float32Array(n * n), r = new Float32Array(n * n), gg = new Float32Array(n * n), b = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const noise = (rand() - 0.5) * 2;
      temp[i] = tMin + (tData[i * 4] / 255) * (tMax - tMin) + noise * 0.8;
      r[i] = vData[i * 4] + noise * 8;
      gg[i] = vData[i * 4 + 1] + noise * 8;
      b[i] = vData[i * 4 + 2] + noise * 8;
    }
    this.channels = { temp, r, g: gg, b };
    this.sats = { temp: buildSat(temp, n, n), r: buildSat(r, n, n), g: buildSat(gg, n, n), b: buildSat(b, n, n) };

    // Pre-render ground-truth images for both modes
    this.truthImg = { thermal: this.renderGrid(1, n), visual: null };
    this.mode = 'visual';
    this.truthImg.visual = this.renderGrid(1, n);
    this.mode = 'thermal';
  }

  /** Render a cells x cells image where each cell averages `step` texels (fractional ok). */
  renderGrid(step, cells) {
    const n = this.n;
    const c = document.createElement('canvas');
    c.width = c.height = cells;
    const img = c.getContext('2d').createImageData(cells, cells);
    const { tempRangeC: [tMin, tMax] } = this.cfg;
    const edges = Array.from({ length: cells + 1 }, (_, i) => Math.min(n, Math.round(i * step)));
    for (let j = 0; j < cells; j++) {
      const y0 = edges[j], y1 = Math.max(y0 + 1, edges[j + 1]);
      for (let i = 0; i < cells; i++) {
        const x0 = edges[i], x1 = Math.max(x0 + 1, edges[i + 1]);
        const o = (j * cells + i) * 4;
        if (x0 >= n || y0 >= n) continue;
        if (this.mode === 'thermal') {
          const t = boxMean(this.sats.temp, n, x0, y0, Math.min(n, x1), Math.min(n, y1));
          const k = Math.max(0, Math.min(255, Math.round(((t - tMin) / (tMax - tMin)) * 255))) * 3;
          img.data[o] = this.ramp[k];
          img.data[o + 1] = this.ramp[k + 1];
          img.data[o + 2] = this.ramp[k + 2];
        } else {
          img.data[o] = boxMean(this.sats.r, n, x0, y0, Math.min(n, x1), Math.min(n, y1));
          img.data[o + 1] = boxMean(this.sats.g, n, x0, y0, Math.min(n, x1), Math.min(n, y1));
          img.data[o + 2] = boxMean(this.sats.b, n, x0, y0, Math.min(n, x1), Math.min(n, y1));
        }
        img.data[o + 3] = 255;
      }
    }
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  /**
   * mode: 'thermal' | 'visual'; gsdM: nadir GSD (m); timing: sensorGeometry().timing.
   * Any change restarts the acquisition animation.
   */
  set(mode, gsdM, timing) {
    const sameImage = mode === this.mode && Math.abs(gsdM - this.gsdM) < 1e-6 && this.pixelsAcross;
    this.timing = timing;
    this.scan = timing?.scan ?? 'pushbroom';
    this.animT = 0;
    if (!sameImage) {
      this.mode = mode;
      this.gsdM = gsdM;
      const { sizeM, texelM } = this.cfg;
      const step = gsdM / texelM; // texels per recorded pixel
      this.pixelsAcross = Math.ceil(sizeM / gsdM);
      this.recorded = step <= 1 ? null : this.renderGrid(step, this.pixelsAcross);
    }
    this.draw();
  }

  /** Advance the acquisition animation by dtS real seconds. */
  tick(dtS) {
    this.animT += dtS;
    this.draw();
  }

  /**
   * Where the acquisition is at animT: rows fully done, the active group being swept,
   * columns done in that group, and whether the whisk mirror is calibrating.
   */
  acquisitionState() {
    const rows = this.pixelsAcross;
    if (this.scan !== 'whiskbroom') {
      if (this.animT > PUSH_FILL_S + HOLD_S) this.animT = 0;
      const done = Math.min(rows, Math.floor((this.animT / PUSH_FILL_S) * rows));
      return { doneRows: done, g0: done, g1: done, cols: 0, calibrating: false, finished: done >= rows };
    }
    const k = this.timing.rowsPerSweep, eta = this.timing.earthViewFrac;
    const cal = Math.min(WHISK_CAL_MAX_S, (WHISK_SWEEP_S * (1 - eta)) / eta);
    this.calCapped = (WHISK_SWEEP_S * (1 - eta)) / eta > WHISK_CAL_MAX_S;
    const cycle = WHISK_SWEEP_S + cal;
    const sweeps = Math.ceil(rows / k);
    if (this.animT > sweeps * cycle + HOLD_S) this.animT = 0;
    const idx = Math.min(sweeps, Math.floor(this.animT / cycle));
    if (idx >= sweeps) return { doneRows: rows, g0: rows, g1: rows, cols: 0, calibrating: false, finished: true };
    const f = this.animT - idx * cycle;
    const g0 = idx * k, g1 = Math.min(rows, g0 + k);
    if (f >= WHISK_SWEEP_S) return { doneRows: g1, g0: g1, g1, cols: 0, calibrating: true, finished: false };
    return { doneRows: g0, g0, g1, cols: Math.floor((f / WHISK_SWEEP_S) * rows), calibrating: false, finished: false };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    this.draw();
  }

  /** Bright marker for what the detectors see right now, on both views. */
  drawFootprint(ctx, acq, xs, top, S, px) {
    if (acq.finished || acq.calibrating) return;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    for (const ox of xs) {
      ctx.save(); // clip per view (clips intersect otherwise)
      ctx.beginPath();
      ctx.rect(ox, top, S, S);
      ctx.clip();
      if (this.scan === 'whiskbroom') {
        // k-row tall spot at the mirror's current column + faint band for the whole sweep
        ctx.globalAlpha = 0.18;
        ctx.fillRect(ox, top + acq.g0 * px, S, (acq.g1 - acq.g0) * px);
        ctx.globalAlpha = 1;
        ctx.fillRect(ox + acq.cols * px, top + acq.g0 * px, Math.max(2, px), (acq.g1 - acq.g0) * px);
      } else {
        // Whole detector line across the scene
        ctx.fillRect(ox, top + acq.doneRows * px, S, Math.max(2, px));
      }
      ctx.restore();
    }
    ctx.restore();
  }

  draw() {
    if (!this.dpr || !this.truthImg) return;
    const ctx = this.ctx;
    const W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const gap = 14, top = 18, bottom = this.mode === 'thermal' ? 34 : 20;
    const S = Math.max(40, Math.min((W - gap) / 2, H - top - bottom));
    const x0 = (W - (2 * S + gap)) / 2, x1 = x0 + S + gap;
    const { sizeM, texelM } = this.cfg;

    // Labels
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(230, 236, 255, 0.85)';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Ground truth · ${texelM} m`, x0, top - 4);
    const gsdLabel = this.gsdM >= 10 ? this.gsdM.toFixed(0) : this.gsdM.toFixed(1);
    ctx.fillText(`Recorded · ${gsdLabel} m GSD`, x1, top - 4);

    // Ground truth
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.truthImg[this.mode], x0, top, S, S);

    // Recorded: nearest-neighbor upscale, revealed as the acquisition progresses
    const acq = this.acquisitionState();
    const px = (this.gsdM / sizeM) * S;
    ctx.fillStyle = '#0d1330';
    ctx.fillRect(x1, top, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x1, top, S, Math.min(S, acq.doneRows * px));
    if (acq.cols) ctx.rect(x1, top + acq.g0 * px, Math.min(S, acq.cols * px), (acq.g1 - acq.g0) * px);
    ctx.clip();
    if (this.recorded) {
      ctx.imageSmoothingEnabled = false;
      const drawn = (this.pixelsAcross * this.gsdM / sizeM) * S;
      ctx.drawImage(this.recorded, x1, top, drawn, drawn);
      const px = (this.gsdM / sizeM) * S;
      if (px >= 6) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 1; k < this.pixelsAcross; k++) {
          const o = Math.round(k * px) + 0.5;
          ctx.moveTo(x1 + o, top);
          ctx.lineTo(x1 + o, top + S);
          ctx.moveTo(x1, top + o);
          ctx.lineTo(x1 + S, top + o);
        }
        ctx.stroke();
      }
    } else {
      ctx.drawImage(this.truthImg[this.mode], x1, top, S, S);
    }
    ctx.restore();
    this.drawFootprint(ctx, acq, [x0, x1], top, S, px);

    // Leak annotation on both views
    for (const ox of [x0, x1]) {
      const cx = ox + (LEAK.x / sizeM) * S, cy = top + (LEAK.y / sizeM) * S;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(7, (LEAK.r * 3 / sizeM) * S), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textBaseline = 'middle';
    ctx.fillText('leak', x0 + (LEAK.x / sizeM) * S + 10, top + (LEAK.y / sizeM) * S - 12);

    // Whiskbroom calibration notice (true share of the mirror cycle)
    if (acq.calibrating) {
      const pct = Math.round((1 - this.timing.earthViewFrac) * 100);
      ctx.fillStyle = 'rgba(11, 16, 38, 0.82)';
      ctx.fillRect(x1 + 6, top + S - 26, S - 12, 20);
      ctx.fillStyle = '#ffb27a';
      ctx.font = '600 10.5px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`calibrating · ${pct}% of mirror cycle${this.calCapped ? ' (shortened)' : ''}`, x1 + 12, top + S - 16);
    }

    // Frames
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.strokeRect(x0 + 0.5, top + 0.5, S - 1, S - 1);
    ctx.strokeRect(x1 + 0.5, top + 0.5, S - 1, S - 1);

    // Footer: scale bar (1 km) + pixel count + thermal legend
    const yb = top + S + 10;
    const kmPx = (1000 / sizeM) * S;
    ctx.fillStyle = 'rgba(230, 236, 255, 0.85)';
    ctx.fillRect(x0, yb - 1, kmPx, 3);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('1 km', x0 + kmPx + 5, yb);
    const count = this.recorded ? `${this.pixelsAcross} × ${this.pixelsAcross} px` : 'finer than scene detail';
    const how = this.scan === 'whiskbroom'
      ? `whiskbroom · ${this.timing.rowsPerSweep} rows/sweep`
      : 'pushbroom · row by row';
    ctx.fillText(`${count} · ${how} · slow-mo`, x1, yb);

    // Thermal legend under the ground-truth view: "15°C [ramp] 45°C"
    if (this.mode === 'thermal') {
      const [tMin, tMax] = this.cfg.tempRangeC;
      const ly = yb + 15, lx = x0 + 34, lw = Math.max(20, S - 68);
      for (let i = 0; i < lw; i++) {
        const k = Math.round((i / (lw - 1)) * 255) * 3;
        ctx.fillStyle = `rgb(${this.ramp[k]},${this.ramp[k + 1]},${this.ramp[k + 2]})`;
        ctx.fillRect(lx + i, ly - 3, 1, 6);
      }
      ctx.fillStyle = 'rgba(230, 236, 255, 0.75)';
      ctx.fillText(`${tMin}°C`, x0, ly);
      ctx.fillText(`${tMax}°C`, lx + lw + 4, ly);
    }
  }
}
