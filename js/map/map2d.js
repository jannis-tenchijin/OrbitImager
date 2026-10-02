// 2D equirectangular map: cached land layer, drifting clouds, recorded swath layer (status-colored,
// cloud-hatched), ground track and satellite icon.

import { paintEquirect } from '../geo/land.js';
import { STATUS, CROSS_CELLS } from '../sim/recorder.js';

const SWATH_ALPHA = 0.55; // the opaque swath layer is composited at this alpha
const KM_PER_DEG = 111.32;

const PAD = 14; // px padding around the map inside its panel
const HEADER_H = 32; // room for the panel label + record controls

export class Map2D {
  constructor(canvas, palette) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.palette = palette;
    this.geo = null;
    this.markers = [];
    this.layer = document.createElement('canvas'); // cached painted world
    this.swathLayer = document.createElement('canvas'); // recorded swath (opaque, incremental)
    this.swathCtx = this.swathLayer.getContext('2d');
    this.swathState = { version: -1, count: 0, dirty: true };
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.pin = null;        // picked place { latDeg, lonDeg }
    this.onPick = null;     // set while picking: (latDeg, lonDeg) => void
    canvas.addEventListener('click', (e) => this.handleClick(e));
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  setLand(geo) {
    this.geo = geo;
    this.repaintLayer();
  }

  /** Static markers (e.g. future AOIs). */
  addMarker(latDeg, lonDeg, color = '#ffffff', label = '') {
    this.markers.push({ latDeg, lonDeg, color, label });
  }

  resize() {
    const parent = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cw = parent.clientWidth, ch = parent.clientHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.dpr = dpr;

    // Largest 2:1 rectangle that fits, centered (CSS px)
    const availW = cw - 2 * PAD, availH = ch - PAD - HEADER_H;
    const w = Math.max(10, Math.min(availW, availH * 2));
    const h = w / 2;
    this.rect = { x: (cw - w) / 2, y: HEADER_H + (ch - HEADER_H - PAD - h) / 2, w, h };
    this.repaintLayer();
  }

  repaintLayer() {
    const { w, h } = this.rect;
    const dpr = this.dpr || 1;
    this.layer.width = Math.round(w * dpr);
    this.layer.height = Math.round(h * dpr);
    paintEquirect(this.layer.getContext('2d'), this.layer.width, this.layer.height, this.geo, this.palette);
    this.swathLayer.width = this.layer.width;
    this.swathLayer.height = this.layer.height;
    this.swathState.dirty = true;
    this.hatch = null;
  }

  /** Arm picking: the next click on the map calls cb(latDeg, lonDeg). */
  startPicking(cb) {
    this.onPick = cb;
    this.canvas.style.cursor = 'crosshair';
  }

  stopPicking() {
    this.onPick = null;
    this.canvas.style.cursor = '';
  }

  setPin(place) {
    this.pin = place;
  }

  /** CSS px -> lat/lon (null outside the map). */
  fromPx(px, py) {
    const { x, y, w, h } = this.rect;
    if (px < x || px > x + w || py < y || py > y + h) return null;
    return { latDeg: 90 - ((py - y) / h) * 180, lonDeg: ((px - x) / w) * 360 - 180 };
  }

  handleClick(e) {
    if (!this.onPick) return;
    const r = this.canvas.getBoundingClientRect();
    const ll = this.fromPx(e.clientX - r.left, e.clientY - r.top);
    if (!ll) return;
    const cb = this.onPick;
    this.stopPicking();
    cb(ll.latDeg, ll.lonDeg);
  }

  /** Map-local px (origin at the map's top-left corner). */
  toLocal(latDeg, lonDeg) {
    const { w, h } = this.rect;
    return [((lonDeg + 180) / 360) * w, ((90 - latDeg) / 180) * h];
  }

  /** Diagonal hatch = "recorded under cloud, unusable". */
  hatchPattern(ctx) {
    if (!this.hatch) {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const g = c.getContext('2d');
      g.fillStyle = this.palette.cloudMask;
      g.fillRect(0, 0, 8, 8);
      g.strokeStyle = this.palette.cloudMaskHatch;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-2, 10); g.lineTo(10, -2);
      g.moveTo(-2, 2); g.lineTo(2, -2);
      g.moveTo(6, 10); g.lineTo(10, 6);
      g.stroke();
      this.hatch = ctx.createPattern(c, 'repeat');
    }
    return this.hatch;
  }

  /**
   * Draw recorder rows [from, to) as per-cell quads batched by status (one path per status, so
   * no seams inside a batch). Quads crossing ±180° are drawn at ±w too; pole-spanning quads skipped.
   */
  drawRows(ctx, rows, from, to, prev = null) {
    const { w } = this.rect;
    const paths = new Map();
    for (let i = Math.max(from, prev ? 0 : 1); i < to; i++) {
      const a = i === 0 ? prev : rows[i - 1], b = rows[i];
      if (!a) continue;
      for (let c = 0; c < CROSS_CELLS; c++) {
        const st = b.cst[c];
        if (st === STATUS.NONE) continue;
        const lat = [a.lat[c], a.lat[c + 1], b.lat[c + 1], b.lat[c]];
        const lon = [a.lon[c], a.lon[c + 1], b.lon[c + 1], b.lon[c]];
        for (let k = 1; k < 4; k++) lon[k] += 360 * Math.round((lon[0] - lon[k]) / 360);
        const min = Math.min(...lon), max = Math.max(...lon);
        if (max - min > 90) continue;
        const key = st === STATUS.CLOUD ? 'cloud' : b.kind; // day and night share one color
        let path = paths.get(key);
        if (!path) paths.set(key, (path = new Path2D()));
        const pts = lat.map((la, k) => this.toLocal(la, lon[k]));
        const offsets = [0];
        if (min < -180) offsets.push(w);
        if (max > 180) offsets.push(-w);
        for (const dx of offsets) {
          path.moveTo(pts[0][0] + dx, pts[0][1]);
          for (let k = 1; k < 4; k++) path.lineTo(pts[k][0] + dx, pts[k][1]);
          path.closePath();
        }
      }
    }
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    for (const [key, path] of paths) {
      const style = key === 'cloud' ? this.hatchPattern(ctx) : this.palette.swath[key];
      ctx.fillStyle = style;
      ctx.strokeStyle = style; // thin same-color stroke hides anti-aliasing seams between batches
      ctx.fill(path);
      ctx.stroke(path);
    }
  }

  /** Keep the offscreen swath layer in sync with the recorder (append-only when possible). */
  syncSwathLayer(rec) {
    const st = this.swathState, g = this.swathCtx;
    let from = st.count;
    if (st.dirty || rec.version !== st.version) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.swathLayer.width, this.swathLayer.height);
      from = 1;
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawRows(g, rec.samples, from, rec.samples.length);
    this.swathState = { version: rec.version, count: rec.samples.length, dirty: false };
  }

  /** Clouds as one union path of ellipses (no alpha stacking where puffs overlap). */
  drawClouds(ctx, systems) {
    const { x, y, w, h } = this.rect;
    const pxPerDeg = h / 180;
    const path = new Path2D();
    for (const s of systems) {
      for (const p of s.puffs) {
        const [cx, cy] = this.toPx(p.latDeg, ((p.lonDeg + 540) % 360) - 180);
        const ry = (p.rKm / KM_PER_DEG) * pxPerDeg;
        const rx = ry / Math.max(0.2, Math.cos((p.latDeg * Math.PI) / 180));
        const offsets = [0];
        if (cx - rx < x) offsets.push(w); // wraps past the left edge
        if (cx + rx > x + w) offsets.push(-w);
        for (const dx of offsets) {
          path.moveTo(cx + dx + rx, cy);
          path.ellipse(cx + dx, cy, rx, ry, 0, 0, Math.PI * 2);
        }
      }
    }
    ctx.fillStyle = this.palette.cloudMap;
    ctx.fill(path);
  }

  /** Lat/lon (deg) -> CSS px inside the canvas. */
  toPx(latDeg, lonDeg) {
    const { x, y, w, h } = this.rect;
    return [x + ((lonDeg + 180) / 360) * w, y + ((90 - latDeg) / 180) * h];
  }

  /**
   * Split a track into drawable runs, cutting at the antimeridian and
   * interpolating the crossing so lines reach the map edge on both sides.
   */
  splitTrack(track) {
    const runs = [];
    let run = [];
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (i > 0) {
        const q = track[i - 1];
        const dLon = p.lonDeg - q.lonDeg;
        if (Math.abs(dLon) > 180) {
          // Crossing: q is near +/-180, p on the other side
          const sign = dLon < 0 ? 1 : -1; // east-going crossing jumps from +180 to -180
          const lonP = p.lonDeg + sign * 360;
          const f = (sign * 180 - q.lonDeg) / (lonP - q.lonDeg);
          const latX = q.latDeg + f * (p.latDeg - q.latDeg);
          run.push({ latDeg: latX, lonDeg: sign * 180, tMs: p.tMs });
          runs.push(run);
          run = [{ latDeg: latX, lonDeg: -sign * 180, tMs: p.tMs }];
        }
      }
      run.push(p);
    }
    if (run.length) runs.push(run);
    return runs;
  }

  /**
   * pastTrack: groundTrack() samples (last orbit). future: swathTrack() samples (next orbit).
   * recorder/tail: recorded swath rows. beam: null (pushbroom) or { active, sweep } (whiskbroom).
   */
  /**
   * targeted: { targets, flashFrame, flashAge } for SatVu-style tasked imaging (else null) —
   * then `future` holds the agility corridor instead of swath edges and no scan line is drawn.
   */
  render({ sub, pastTrack, future, nowMs, swathColor, recorder, tail, cloudSystems, beam, targeted = null }) {
    const ctx = this.ctx;
    const { x, y, w, h } = this.rect;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // World layer with rounded corners and soft shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 18;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, w, h, 10);
    ctx.clip();
    ctx.drawImage(this.layer, x, y, w, h);
    if (cloudSystems) this.drawClouds(ctx, cloudSystems);

    // Recorded swath: offscreen opaque layer + live tail, both composited at SWATH_ALPHA
    this.syncSwathLayer(recorder);
    ctx.globalAlpha = SWATH_ALPHA;
    ctx.drawImage(this.swathLayer, x, y, w, h);
    if (tail && recorder.samples.length) {
      ctx.save();
      ctx.translate(x, y);
      this.drawRows(ctx, [tail], 0, 1, recorder.samples[recorder.samples.length - 1]);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    this.drawAxisLabels(ctx);

    // Upcoming swath edges: thin dashed lines
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = withAlpha(swathColor, 0.5);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    for (const side of ['left', 'right']) {
      for (const run of this.splitTrack(future.map((p) => ({ ...p[side], tMs: p.tMs })))) this.strokeRun(ctx, run);
    }
    ctx.setLineDash([]);
    this.drawMarkers(ctx);

    // Future track: dashed white
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = this.palette.trackFuture;
    ctx.lineWidth = 1.5;
    for (const run of this.splitTrack(future)) this.strokeRun(ctx, run);
    ctx.setLineDash([]);

    // Past track: coral, fading toward the oldest point (drawn segment by segment)
    const t0 = pastTrack[0].tMs, span = nowMs - t0 || 1;
    for (const run of this.splitTrack(pastTrack)) {
      for (let i = 1; i < run.length; i++) {
        const age = (run[i].tMs - t0) / span; // 0 = oldest, 1 = now
        const [ax, ay] = this.toPx(run[i - 1].latDeg, run[i - 1].lonDeg);
        const [bx, by] = this.toPx(run[i].latDeg, run[i].lonDeg);
        ctx.globalAlpha = 0.08 + 0.92 * age ** 1.6;
        ctx.strokeStyle = this.palette.trackPast;
        ctx.lineWidth = 1.5 + 2 * age;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Current scan line (pushbroom: whole line; whiskbroom: swept part of the current sweep)
    if (targeted) this.drawTargeted(ctx, recorder, targeted, swathColor);
    else if (!beam || beam.active) this.drawScanLine(ctx, future[0], swathColor, beam ? beam.sweep : 1);
    this.drawPin(ctx);

    this.drawSatellite(ctx, sub, future[1] ?? sub, nowMs);
    ctx.restore();
  }

  drawScanLine(ctx, p, color, frac = 1) {
    if (!p) return;
    const [ax, ay] = this.toPx(p.left.latDeg, p.left.lonDeg);
    let [bx, by] = this.toPx(p.right.latDeg, p.right.lonDeg);
    if (Math.abs(bx - ax) > this.rect.w / 2) return; // straddles ±180°: skip this frame
    bx = ax + (bx - ax) * frac;
    by = ay + (by - ay) * frac;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  strokeRun(ctx, run) {
    ctx.beginPath();
    run.forEach((p, i) => {
      const [px, py] = this.toPx(p.latDeg, p.lonDeg);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }

  drawAxisLabels(ctx) {
    const { x, y, w, h } = this.rect;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.textBaseline = 'bottom';
    for (let lon = -120; lon <= 120; lon += 60) {
      const [px] = this.toPx(0, lon);
      ctx.fillText(`${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 ? 'E' : ''}`, px + 3, y + h - 3);
    }
    ctx.textBaseline = 'middle';
    for (let lat = -60; lat <= 60; lat += 30) {
      const [, py] = this.toPx(lat, 0);
      ctx.fillText(`${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}`, x + 4, py - 7);
    }
  }

  /** Tasked targets (faint diamonds), recorded frames (small squares), flash on the newest. */
  drawTargeted(ctx, rec, { targets, flashFrame, flashAge }, color) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (const t of targets) {
      const [px, py] = this.toPx(t.latDeg, t.lonDeg);
      ctx.beginPath();
      ctx.moveTo(px, py - 3); ctx.lineTo(px + 3, py); ctx.lineTo(px, py + 3); ctx.lineTo(px - 3, py);
      ctx.fill();
    }
    const pxPerKm = this.rect.h / 180 / 111.32;
    for (const f of rec.frames) {
      if (f.status === STATUS.NONE) continue;
      const [px, py] = this.toPx(f.latDeg, f.lonDeg);
      const size = Math.max(7, 4.5 * pxPerKm); // real frames are sub-pixel at map scale
      ctx.fillStyle = f.status === STATUS.CLOUD ? this.hatchPattern(ctx) : color;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 1;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
      ctx.strokeRect(px - size / 2, py - size / 2, size, size);
    }
    if (flashFrame && flashAge < 1) {
      const [px, py] = this.toPx(flashFrame.latDeg, flashFrame.lonDeg);
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - flashAge})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 6 + flashAge * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Picked place: classic map pin. */
  drawPin(ctx) {
    if (!this.pin) return;
    const [px, py] = this.toPx(this.pin.latDeg, this.pin.lonDeg);
    ctx.save();
    ctx.fillStyle = '#ff4d6d';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py - 12, 6, Math.PI, 0);
    ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py - 12, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawMarkers(ctx) {
    for (const m of this.markers) {
      const [px, py] = this.toPx(m.latDeg, m.lonDeg);
      ctx.fillStyle = m.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.label) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(m.label, px + 6, py);
      }
    }
  }

  /** Little top-down satellite glyph, rotated to the direction of travel. */
  drawSatellite(ctx, sub, next, nowMs) {
    const [px, py] = this.toPx(sub.latDeg, sub.lonDeg);
    let [nx, ny] = this.toPx(next.latDeg, next.lonDeg);
    // Next point wrapped across the antimeridian: unwrap so the heading stays correct
    if (nx - px > this.rect.w / 2) nx -= this.rect.w;
    else if (px - nx > this.rect.w / 2) nx += this.rect.w;
    const heading = Math.atan2(ny - py, nx - px);

    // Pulsing halo
    const pulse = (nowMs / 1000) % 1.6 / 1.6;
    ctx.strokeStyle = `rgba(255, 209, 102, ${0.7 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 6 + pulse * 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(heading);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    // Solar wings (perpendicular to travel)
    ctx.fillStyle = '#2a4a9a';
    ctx.strokeStyle = '#cfd8ff';
    ctx.lineWidth = 1;
    for (const s of [-1, 1]) {
      ctx.fillRect(-3.5, s > 0 ? 5 : -13, 7, 8);
      ctx.strokeRect(-3.5, s > 0 ? 5 : -13, 7, 8);
    }
    // Bus
    ctx.fillStyle = this.palette.satelliteIcon;
    ctx.fillRect(-4.5, -4.5, 9, 9);
    ctx.strokeStyle = 'rgba(60, 40, 0, 0.8)';
    ctx.strokeRect(-4.5, -4.5, 9, 9);
    ctx.restore();
  }
}

/** '#rrggbb' -> 'rgba(r,g,b,a)' */
function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
