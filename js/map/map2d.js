// 2D equirectangular map: cached land layer + ground track + satellite icon.

import { paintEquirect } from '../geo/land.js';

const PAD = 14; // px padding around the map inside its panel

export class Map2D {
  constructor(canvas, palette) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.palette = palette;
    this.geo = null;
    this.markers = [];
    this.layer = document.createElement('canvas'); // cached painted world
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
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
    const availW = cw - 2 * PAD, availH = ch - 2 * PAD - 18; // leave room for top label
    const w = Math.max(10, Math.min(availW, availH * 2));
    const h = w / 2;
    this.rect = { x: (cw - w) / 2, y: 18 + (ch - 18 - h) / 2, w, h };
    this.repaintLayer();
  }

  repaintLayer() {
    const { w, h } = this.rect;
    const dpr = this.dpr || 1;
    this.layer.width = Math.round(w * dpr);
    this.layer.height = Math.round(h * dpr);
    paintEquirect(this.layer.getContext('2d'), this.layer.width, this.layer.height, this.geo, this.palette);
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

  render({ sub, past, future, nowMs }) {
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

    this.drawAxisLabels(ctx);
    this.drawMarkers(ctx);

    // Future track: dashed white
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = this.palette.trackFuture;
    ctx.lineWidth = 1.5;
    for (const run of this.splitTrack(future)) this.strokeRun(ctx, run);
    ctx.setLineDash([]);

    // Past track: coral, fading toward the oldest point (drawn segment by segment)
    const t0 = past[0].tMs, span = nowMs - t0 || 1;
    for (const run of this.splitTrack(past)) {
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

    this.drawSatellite(ctx, sub, future[1] ?? sub, nowMs);
    ctx.restore();
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
