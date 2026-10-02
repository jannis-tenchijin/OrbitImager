// Land data loading + the single equirectangular painter shared by the globe texture and 2D map.
// d3-geo handles antimeridian clipping and Antarctica's pole-wrapping ring (see docs/decisions.md).

import { feature, mesh } from 'topojson-client';
import { geoEquirectangular, geoPath, geoGraticule } from 'd3-geo';

let landPromise = null;

/** Load TopoJSON once; returns { land: Feature, coast: MultiLineString }. */
export function loadLand(url) {
  if (!landPromise) {
    landPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
        return r.json();
      })
      .then((topo) => ({
        land: feature(topo, topo.objects.land),
        coast: mesh(topo, topo.objects.land), // coastline arcs only, no antimeridian cut edges
      }));
  }
  return landPromise;
}

/** Equirectangular projection filling a w x h (2:1) box at offset (x0, y0). */
export function equirect(w, h, x0 = 0, y0 = 0) {
  return geoEquirectangular()
    .scale(w / (2 * Math.PI))
    .translate([x0 + w / 2, y0 + h / 2])
    .precision(0.1);
}

/** Linear gradient along y from a list of [latDeg, color] stops. */
function latGradient(ctx, h, y0, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  for (const [lat, color] of stops) g.addColorStop((90 - lat) / 180, color);
  return g;
}

/** Small deterministic PRNG so the speckle texture is identical every load. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paint the stylized world into ctx over a w x h (2:1) rectangle.
 * Layers: ocean gradient -> shallow-shelf glow -> sandy rim -> biome-banded land
 * -> speckle texture -> thin coastline -> graticule.
 */
export function paintEquirect(ctx, w, h, geo, palette, { x0 = 0, y0 = 0, graticule = true } = {}) {
  const k = w / 2048; // line widths are tuned for a 2048 px wide map
  const proj = equirect(w, h, x0, y0);
  const path = geoPath(proj, ctx);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();

  // Ocean: icy poles, deep mid-latitudes, brighter tropics
  ctx.fillStyle = latGradient(ctx, h, y0, [
    [90, palette.seaIce], [80, '#9cc4e4'], [72, palette.oceanDeep], [40, palette.oceanMid],
    [0, '#49a7db'], [-40, palette.oceanMid], [-65, palette.oceanDeep], [-75, '#9cc4e4'], [-90, palette.seaIce],
  ]);
  ctx.fillRect(x0, y0, w, h);

  if (geo) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Shallow continental shelf glow around coasts
    ctx.strokeStyle = palette.shelfGlow;
    for (const lw of [9, 5]) {
      ctx.lineWidth = lw * k;
      ctx.beginPath();
      path(geo.coast);
      ctx.stroke();
    }

    // Sandy rim (outer half stays visible after the land fill)
    ctx.strokeStyle = palette.coast;
    ctx.lineWidth = 2.6 * k;
    ctx.beginPath();
    path(geo.coast);
    ctx.stroke();

    // Land fill with latitude "biome" bands
    ctx.fillStyle = latGradient(ctx, h, y0, palette.landBands);
    ctx.beginPath();
    path(geo.land);
    ctx.fill();

    // Speckle texture clipped to land (gives the flat fill some life)
    ctx.save();
    ctx.beginPath();
    path(geo.land);
    ctx.clip();
    const rand = mulberry32(42);
    const count = Math.round((w * h) / 900);
    for (let i = 0; i < count; i++) {
      const x = x0 + rand() * w, y = y0 + rand() * h;
      const r = (0.8 + rand() * 2.2) * k;
      ctx.fillStyle = rand() < 0.6 ? 'rgba(30, 70, 30, 0.10)' : 'rgba(255, 255, 230, 0.10)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Crisp coastline
    ctx.strokeStyle = palette.coastLine;
    ctx.lineWidth = 0.7 * k;
    ctx.beginPath();
    path(geo.coast);
    ctx.stroke();
  }

  if (graticule) {
    ctx.strokeStyle = palette.graticule;
    ctx.lineWidth = 0.8 * k;
    ctx.beginPath();
    path(geoGraticule().step([30, 30])());
    ctx.stroke();
  }

  ctx.restore();
}

/** Convenience: paint into a new offscreen canvas (used for the globe texture). */
export function paintToCanvas(width, geo, palette, opts) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = width / 2;
  paintEquirect(canvas.getContext('2d'), canvas.width, canvas.height, geo, palette, opts);
  return canvas;
}
