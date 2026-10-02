// Pixel close-up: a fixed 3 x 3 km synthetic ground scene at nadir (one pass) vs. what the
// instrument records. The scene is drawn three times with identical geometry: visual RGB,
// temperature (gray-encoded) and SAR backscatter (gray-encoded dB). Canvas anti-aliasing blends
// edge texels = realistic mixed pixels. Recorded pixels are box means of the ground truth via
// summed-area tables; pixels may be rectangular (SAR range x azimuth).
//
// Acquisition animation (slow motion, loops):
//   pushbroom  - one full cross-track row at once, row after row.
//   whiskbroom - a k-row spot sweeps left -> right (pixel by pixel), then the mirror calibrates;
//                the next sweep starts exactly k rows further down (no gap).
//   framing    - a whole 2-D frame (F rows) is exposed at once, frame after frame.
//   SAR        - azimuth lines appear after SAR processing (row by row), speckled.

const FILL_S = 5;             // real seconds to fill the scene (row-based scans)
const WHISK_CYCLE_MAX_S = 1.9; // real seconds per whisk cycle when there are few sweeps
const WHISK_MIN_SWEEP = 0.35; // readability floor for the visible sweep share of a cycle
const FRAME_S = 1.4;          // real seconds per frame (framing)
const HOLD_S = 1.5;           // pause on the finished image before looping
const SAR_DB_RANGE = [-25, 5];

const LEAK = { x: 1985, y: 1460, r: 22 }; // wet-soil patch next to a road (m)

// Land-cover classes: visual color, surface temperature (°C, hot summer late morning) and
// radar backscatter sigma0 (dB). Urban double-bounce is bright, calm water/roads are dark,
// wet soil is brighter than dry soil (higher dielectric constant) - what L-band leak work uses.
const COVER = {
  crop:      { rgb: '#6fae4f', t: 27, db: -12 },
  crop2:     { rgb: '#9cc25a', t: 29, db: -11 },
  soil:      { rgb: '#b9926a', t: 38, db: -15 },
  grass:     { rgb: '#c8c27a', t: 33, db: -13 },
  water:     { rgb: '#3d7fc4', t: 18, db: -24 },
  trees:     { rgb: '#3f8a3e', t: 24, db: -8 },
  road:      { rgb: '#55575e', t: 44, db: -19 },
  roofDark:  { rgb: '#7b6f6a', t: 42, db: 0 },
  roofRed:   { rgb: '#b5584a', t: 39, db: -1 },
  roofWhite: { rgb: '#e9ebee', t: 31, db: -2 },
  factory:   { rgb: '#9aa0a8', t: 47, db: 3 },
  wetSoil:   { rgb: '#8b6e52', t: 26, db: -6 },
};

/** Deterministic hash -> [0, 1) for speckle. */
function hash01(i, j, seed) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Multi-look speckle: mean of `looks` unit exponentials (gamma, mean 1, variance 1/looks). */
function speckle(i, j, looks) {
  const L = Math.max(1, Math.round(looks));
  let s = 0;
  for (let k = 0; k < L; k++) s -= Math.log(1 - hash01(i, j, 17 + k * 101) * 0.999999);
  return s / L;
}

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
    this.gsdX = this.gsdY = 100;
    this.timing = null;
    this.looks = 1;
    this.animT = 0;
    this.buildTruth();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  /** Rasterize the scene at texel resolution into temperature, RGB and SAR channels + SATs. */
  buildTruth() {
    const { sizeM, texelM, tempRangeC } = this.cfg;
    const n = Math.round(sizeM / texelM);
    this.n = n;
    const [tMin, tMax] = tempRangeC;
    const [dbMin, dbMax] = SAR_DB_RANGE;
    const off = document.createElement('canvas');
    off.width = off.height = n;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / texelM, 0, 0, 1 / texelM, 0, 0);
    const gray = (v) => `rgb(${v},${v},${v})`;

    drawScene(g, (cls) => gray(Math.round(((COVER[cls].t - tMin) / (tMax - tMin)) * 255)), sizeM);
    const tData = g.getImageData(0, 0, n, n).data;
    drawScene(g, (cls) => gray(Math.round(((COVER[cls].db - dbMin) / (dbMax - dbMin)) * 255)), sizeM);
    const sData = g.getImageData(0, 0, n, n).data;
    drawScene(g, (cls) => COVER[cls].rgb, sizeM);
    const vData = g.getImageData(0, 0, n, n).data;

    // Channels with a little deterministic texture noise; SAR stored as LINEAR intensity
    // (averaging must happen in linear power, not dB)
    const rand = mulberry32(99);
    const N = n * n;
    const temp = new Float32Array(N), r = new Float32Array(N), gg = new Float32Array(N), b = new Float32Array(N), sar = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const noise = (rand() - 0.5) * 2;
      temp[i] = tMin + (tData[i * 4] / 255) * (tMax - tMin) + noise * 0.8;
      r[i] = vData[i * 4] + noise * 8;
      gg[i] = vData[i * 4 + 1] + noise * 8;
      b[i] = vData[i * 4 + 2] + noise * 8;
      const db = dbMin + (sData[i * 4] / 255) * (dbMax - dbMin) + noise * 0.6;
      sar[i] = 10 ** (db / 10);
    }
    this.sats = { temp: buildSat(temp, n, n), r: buildSat(r, n, n), g: buildSat(gg, n, n), b: buildSat(b, n, n), sar: buildSat(sar, n, n) };
    this.truthImg = {};
    for (const m of ['thermal', 'visual', 'sar']) this.truthImg[m] = this.renderGrid(m, 1, 1, n, n, 0);
  }

  /**
   * Render cols x rows cells; each cell averages stepX x stepY texels (fractional ok).
   * looks > 0 applies SAR speckle to the SAR channel.
   */
  renderGrid(mode, stepX, stepY, cols, rows, looks) {
    const n = this.n;
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const img = c.getContext('2d').createImageData(cols, rows);
    const { tempRangeC: [tMin, tMax] } = this.cfg;
    const [dbMin, dbMax] = SAR_DB_RANGE;
    const ex = Array.from({ length: cols + 1 }, (_, i) => Math.min(n, Math.round(i * stepX)));
    const ey = Array.from({ length: rows + 1 }, (_, j) => Math.min(n, Math.round(j * stepY)));
    for (let j = 0; j < rows; j++) {
      const y0 = ey[j], y1 = Math.min(n, Math.max(y0 + 1, ey[j + 1]));
      for (let i = 0; i < cols; i++) {
        const x0 = ex[i], x1 = Math.min(n, Math.max(x0 + 1, ex[i + 1]));
        const o = (j * cols + i) * 4;
        if (x0 >= n || y0 >= n) continue;
        if (mode === 'thermal') {
          const t = boxMean(this.sats.temp, n, x0, y0, x1, y1);
          const k = Math.max(0, Math.min(255, Math.round(((t - tMin) / (tMax - tMin)) * 255))) * 3;
          img.data[o] = this.ramp[k];
          img.data[o + 1] = this.ramp[k + 1];
          img.data[o + 2] = this.ramp[k + 2];
        } else if (mode === 'sar') {
          let lin = boxMean(this.sats.sar, n, x0, y0, x1, y1);
          if (looks > 0) lin *= speckle(i, j, looks);
          const db = 10 * Math.log10(Math.max(lin, 1e-6));
          const v = Math.max(0, Math.min(255, Math.round(((db - dbMin) / (dbMax - dbMin)) * 255)));
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
        } else {
          img.data[o] = boxMean(this.sats.r, n, x0, y0, x1, y1);
          img.data[o + 1] = boxMean(this.sats.g, n, x0, y0, x1, y1);
          img.data[o + 2] = boxMean(this.sats.b, n, x0, y0, x1, y1);
        }
        img.data[o + 3] = 255;
      }
    }
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  /**
   * mode: 'thermal' | 'visual' | 'sar'; gsdX/gsdY: pixel footprint cross-/along-track (m);
   * timing: geometry .timing (scan type etc.); looks: SAR looks. Restarts the animation.
   */
  set(mode, gsdX, gsdY, timing, looks = 1) {
    const same = mode === this.mode && gsdX === this.gsdX && gsdY === this.gsdY && looks === this.looks && this.cols;
    this.timing = timing;
    this.scan = timing?.scan ?? 'pushbroom';
    this.animT = 0;
    if (!same) {
      Object.assign(this, { mode, gsdX, gsdY, looks });
      const { sizeM, texelM } = this.cfg;
      const sx = gsdX / texelM, sy = gsdY / texelM; // texels per recorded pixel
      this.cols = Math.ceil(sizeM / gsdX);
      this.rows = Math.ceil(sizeM / gsdY);
      this.recorded = sx < 1 || sy < 1 ? null : this.renderGrid(mode, sx, sy, this.cols, this.rows, mode === 'sar' ? looks : 0);
    }
    this.draw();
  }

  /** Advance the acquisition animation by dtS real seconds. */
  tick(dtS) {
    this.animT += dtS;
    this.draw();
  }

  /**
   * Where the acquisition is at animT: rows fully done, the active group [g0, g1) being acquired,
   * columns done in that group, and whether the whisk mirror is calibrating.
   */
  acquisitionState() {
    const rows = this.rows;
    const done = (d) => ({ doneRows: d, g0: d, g1: d, cols: 0, calibrating: false, finished: d >= rows });
    if (this.scan === 'framing') {
      const F = Math.max(1, Math.min(rows, this.timing.frameRows ?? 512)); // rows per frame
      const frames = Math.ceil(rows / F);
      if (this.animT > frames * FRAME_S + HOLD_S) this.animT = 0;
      const f = Math.floor(this.animT / FRAME_S);
      const flash = (this.animT % FRAME_S) < 0.25 && f < frames; // exposure flash on the new frame
      const st = done(Math.min(rows, (f + (f < frames ? 1 : 0)) * F));
      st.flash = flash ? [Math.min(rows, f * F), Math.min(rows, (f + 1) * F)] : null;
      return st;
    }
    if (this.scan !== 'whiskbroom') {
      if (this.animT > FILL_S + HOLD_S) this.animT = 0;
      return done(Math.min(rows, Math.floor((this.animT / FILL_S) * rows)));
    }
    const k = this.timing.rowsPerSweep, eta = this.timing.earthViewFrac;
    const sweeps = Math.ceil(rows / k);
    const cycle = Math.min(WHISK_CYCLE_MAX_S, Math.max(0.12, (FILL_S * 1.6) / sweeps));
    const sweepShare = Math.max(eta, WHISK_MIN_SWEEP);
    this.calShortened = sweepShare > eta;
    if (this.animT > sweeps * cycle + HOLD_S) this.animT = 0;
    const idx = Math.floor(this.animT / cycle);
    if (idx >= sweeps) return done(rows);
    const f = (this.animT - idx * cycle) / cycle;
    const g0 = idx * k, g1 = Math.min(rows, g0 + k);
    if (f >= sweepShare) return { doneRows: g1, g0: g1, g1, cols: 0, calibrating: true, finished: false };
    return { doneRows: g0, g0, g1, cols: Math.floor((f / sweepShare) * this.cols), calibrating: false, finished: false };
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
  drawFootprint(ctx, acq, xs, top, S, pw, ph) {
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
        ctx.globalAlpha = 0.18;
        ctx.fillRect(ox, top + acq.g0 * ph, S, (acq.g1 - acq.g0) * ph);
        ctx.globalAlpha = 1;
        ctx.fillRect(ox + acq.cols * pw, top + acq.g0 * ph, Math.max(2, pw), (acq.g1 - acq.g0) * ph);
      } else if (this.scan === 'framing') {
        if (acq.flash) {
          ctx.globalAlpha = 0.35;
          ctx.fillRect(ox, top + acq.flash[0] * ph, S, (acq.flash[1] - acq.flash[0]) * ph);
        }
      } else {
        ctx.fillRect(ox, top + acq.doneRows * ph, S, Math.max(2, ph)); // whole detector line
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

    const gap = 14, top = 18, bottom = this.mode === 'visual' ? 20 : 34;
    const S = Math.max(40, Math.min((W - gap) / 2, H - top - bottom));
    const x0 = (W - (2 * S + gap)) / 2, x1 = x0 + S + gap;
    const { sizeM, texelM } = this.cfg;
    const fmtM = (m) => (m >= 10 ? m.toFixed(0) : m.toFixed(1));

    // Labels
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(230, 236, 255, 0.85)';
    ctx.textBaseline = 'bottom';
    ctx.fillText(this.mode === 'sar' ? `Ground truth · σ⁰ · ${texelM} m` : `Ground truth · ${texelM} m`, x0, top - 4);
    const res = this.gsdX === this.gsdY ? `${fmtM(this.gsdX)} m` : `${fmtM(this.gsdX)} × ${fmtM(this.gsdY)} m`;
    ctx.fillText(`Recorded · ${res}${this.mode === 'sar' ? ` · ${Math.round(this.looks)} look${this.looks > 1.5 ? 's' : ''}` : ' GSD'}`, x1, top - 4);

    // Ground truth
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.truthImg[this.mode], x0, top, S, S);

    // Recorded: nearest-neighbor upscale, revealed as the acquisition progresses
    const acq = this.acquisitionState();
    const pw = (this.gsdX / sizeM) * S, ph = (this.gsdY / sizeM) * S;
    ctx.fillStyle = '#0d1330';
    ctx.fillRect(x1, top, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x1, top, S, Math.min(S, acq.doneRows * ph));
    if (acq.cols) ctx.rect(x1, top + acq.g0 * ph, Math.min(S, acq.cols * pw), (acq.g1 - acq.g0) * ph);
    ctx.clip();
    if (this.recorded) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.recorded, x1, top, this.cols * pw, this.rows * ph);
      if (pw >= 6 && ph >= 6) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 1; k < this.cols; k++) {
          const o = Math.round(k * pw) + 0.5;
          ctx.moveTo(x1 + o, top);
          ctx.lineTo(x1 + o, top + S);
        }
        for (let k = 1; k < this.rows; k++) {
          const o = Math.round(k * ph) + 0.5;
          ctx.moveTo(x1, top + o);
          ctx.lineTo(x1 + S, top + o);
        }
        ctx.stroke();
      }
    } else {
      ctx.drawImage(this.truthImg[this.mode], x1, top, S, S);
    }
    ctx.restore();
    this.drawFootprint(ctx, acq, [x0, x1], top, S, pw, ph);

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
      ctx.fillText(`calibrating · ${pct}% of mirror cycle${this.calShortened ? ' (shortened)' : ''}`, x1 + 12, top + S - 16);
    }

    // Frames
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.strokeRect(x0 + 0.5, top + 0.5, S - 1, S - 1);
    ctx.strokeRect(x1 + 0.5, top + 0.5, S - 1, S - 1);

    // Footer: scale bar (1 km) + pixel count + legend
    const yb = top + S + 10;
    const kmPx = (1000 / sizeM) * S;
    ctx.fillStyle = 'rgba(230, 236, 255, 0.85)';
    ctx.fillRect(x0, yb - 1, kmPx, 3);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('1 km', x0 + kmPx + 5, yb);
    const count = this.recorded ? `${this.cols} × ${this.rows} px` : `finer than scene detail (${texelM} m)`;
    const how = {
      whiskbroom: `whiskbroom · ${this.timing?.rowsPerSweep} rows/sweep`,
      framing: 'framing · whole frames',
      sar: 'SAR · azimuth lines',
    }[this.scan] ?? 'pushbroom · row by row';
    ctx.fillText(`${count} · ${how} · slow-mo`, x1, yb);

    const ly = yb + 15, lx = x0 + 40, lw = Math.max(20, S - 80);
    if (this.mode === 'thermal' || this.mode === 'sar') {
      const [lo, hi] = this.mode === 'sar' ? SAR_DB_RANGE : this.cfg.tempRangeC;
      for (let i = 0; i < lw; i++) {
        const f = i / (lw - 1), k = Math.round(f * 255) * 3;
        ctx.fillStyle = this.mode === 'sar' ? `rgb(${Math.round(f * 255)},${Math.round(f * 255)},${Math.round(f * 255)})` : `rgb(${this.ramp[k]},${this.ramp[k + 1]},${this.ramp[k + 2]})`;
        ctx.fillRect(lx + i, ly - 3, 1, 6);
      }
      ctx.fillStyle = 'rgba(230, 236, 255, 0.75)';
      const unit = this.mode === 'sar' ? ' dB' : '°C';
      ctx.fillText(`${lo}${unit}`, x0, ly);
      ctx.fillText(`${hi}${unit}`, lx + lw + 4, ly);
    }
  }
}
