// 3D view: stylized planet, atmosphere, stars, sun, satellite, orbit line, ground trail,
// swath strip + sensor FOV fan.
// Physics is ECI (Z = north). Three.js is Y-up, so ECI (x, y, z) -> scene (x, z, -y).
// The planet group rotates about Y by the planet rotation angle (GMST for Earth).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SCENE_KM_PER_UNIT } from '../config.js';
import { createSatelliteModel } from './satelliteModel.js';
import { latLonToEcef, crossTrackPointEci } from '../physics/orbit.js';
import { STATUS, CROSS_CELLS } from '../sim/recorder.js';

const SWATH_VERTS = CROSS_CELLS + 1; // recorder rows: 9 points across (8 cells)
const FAN_SEGMENTS = 16;        // subdivisions of the ground scan arc under the FOV fan
const WHISK_BEAM_HALF = 0.025;    // beam half-width as a fraction of the swath (for visibility)
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const MAX_FRAME_MARKERS = 6000;
const FRAME_MARKER_KM = 45;   // targeted frames are drawn at least this big (real: ~4 km)
const TILE_OUTLINES = 5;      // previous framing exposures shown tiled along the track
/** Planet-fixed unit vector -> planetGroup-local scene position at radius r (scene units). */
const fixedToLocal = (u, r, out = new THREE.Vector3()) => out.set(u[0] * r, u[2] * r, -u[1] * r);

/** ECI or ECEF km vector -> scene units (Y-up). */
export function toScene(v, out = new THREE.Vector3()) {
  return out.set(v[0], v[2], -v[1]).divideScalar(SCENE_KM_PER_UNIT);
}

export class Globe {
  constructor(container, planet, palette, { satelliteScale = 1, sensor, scan, clouds } = {}) {
    this.container = container;
    this.planet = planet;
    this.palette = palette;
    this.cloudField = clouds;
    this.R = planet.radiusKm / SCENE_KM_PER_UNIT;
    this.viewMode = 'space'; // 'space' | 'earth' | 'satellite'
    this.lastTheta = null;

    // Renderer / camera / controls
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 3000);
    this.camera.position.set(14, 9, 16);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = this.R * 1.25;
    this.controls.maxDistance = this.R * 14;

    this.buildLights();
    this.buildStars();
    this.buildSun();
    this.buildPlanet();
    this.buildAtmosphere();
    this.buildOrbitViz();
    this.buildSwathViz();

    this.sat = createSatelliteModel({ scale: satelliteScale, instrument: scan, band: sensor.kind });
    this.scene.add(this.sat.object);
    this.applySatelliteEnvMap();
    this.setSensor(sensor, scan);
    this.satBeacon = this.makeBeacon();
    this.scene.add(this.satBeacon);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  buildLights() {
    this.sunLight = new THREE.DirectionalLight(0xfff1dc, 3.0);
    this.scene.add(this.sunLight);
    // Cool ambient keeps the night side readable (cartoon, not realistic)
    this.scene.add(new THREE.HemisphereLight(0x9cbcff, 0x2a3570, 1.25));
  }

  buildStars() {
    const n = 2200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(900 + Math.random() * 400);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.55 + Math.random() * 0.15, 0.6, 0.75 + Math.random() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9 });
    this.scene.add(new THREE.Points(geo, mat));
  }

  buildSun() {
    // Glowing sprite far away in the sun direction
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.2, 'rgba(255,230,150,0.9)');
    grad.addColorStop(0.5, 'rgba(255,190,90,0.25)');
    grad.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.setScalar(90);
    this.scene.add(this.sunSprite);
  }

  buildPlanet() {
    this.planetGroup = new THREE.Group(); // rotates with the planet (planet-fixed frame)
    this.scene.add(this.planetGroup);

    // Faceted sphere; texture is painted later by setLandTexture()
    this.planetMat = new THREE.MeshStandardMaterial({ color: 0x3f8fd2, roughness: 0.9, metalness: 0, flatShading: true });
    this.planetMesh = new THREE.Mesh(new THREE.SphereGeometry(this.R, 96, 64), this.planetMat);
    this.planetGroup.add(this.planetMesh);

    this.clouds = this.buildClouds(this.cloudField.maxPuffs);
    this.planetGroup.add(this.clouds);
  }

  /** One InstancedMesh of flattened low-poly puffs, positioned from the cloud field each frame. */
  buildClouds(maxPuffs) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x5a6a9a, emissiveIntensity: 0.35,
      roughness: 1, flatShading: true, transparent: true, opacity: 0.9,
    });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, maxPuffs);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  /** Place cloud puffs (planet-fixed) for the current cloud systems. */
  updateClouds(systems) {
    const mesh = this.clouds;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), spin = new THREE.Quaternion();
    const n = new THREE.Vector3(), scl = new THREE.Vector3(), pos = new THREE.Vector3();
    const r = (this.planet.radiusKm + this.cloudField.altitudeKm) / SCENE_KM_PER_UNIT;
    let k = 0;
    for (const sys of systems) {
      for (const p of sys.puffs) {
        if (k >= mesh.instanceMatrix.count) break;
        n.set(p.u[0], p.u[2], -p.u[1]); // planet-fixed unit -> scene axes
        q.setFromUnitVectors(Y_AXIS, n).multiply(spin.setFromAxisAngle(Y_AXIS, p.spin));
        const rr = p.rKm / SCENE_KM_PER_UNIT;
        m.compose(pos.copy(n).multiplyScalar(r), q, scl.set(rr, rr * 0.42, rr * 0.8));
        mesh.setMatrixAt(k++, m);
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
  }

  buildAtmosphere() {
    // Back-side shell: glow peaks at the planet limb, fades to zero at the shell edge,
    // and dims on the night side.
    const shellR = this.R * 1.14;
    this.atmoUniforms = {
      uColor: { value: new THREE.Color(...this.palette.atmosphere) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uLimb: { value: Math.sqrt(1 - (this.R / shellR) ** 2) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vNormalV; varying vec3 vViewDir; varying vec3 vNormalW;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uSunDir; uniform float uLimb;
        varying vec3 vNormalV; varying vec3 vViewDir; varying vec3 vNormalW;
        void main() {
          float d = -dot(normalize(vNormalV), normalize(vViewDir));   // 0 at shell edge
          float glow = pow(clamp(d / uLimb, 0.0, 1.0), 2.2);
          float day = 0.25 + 0.75 * smoothstep(-0.35, 0.4, dot(normalize(vNormalW), uSunDir));
          gl_FragColor = vec4(uColor * glow * day * 1.3, glow * day);
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(shellR, 64, 48), mat));

    // Thin front-side fresnel haze over the planet limb
    const hazeMat = new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vNormalV; varying vec3 vViewDir; varying vec3 vNormalW;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uSunDir;
        varying vec3 vNormalV; varying vec3 vViewDir; varying vec3 vNormalW;
        void main() {
          float f = pow(1.0 - max(dot(normalize(vNormalV), normalize(vViewDir)), 0.0), 3.0);
          float day = 0.2 + 0.8 * smoothstep(-0.3, 0.4, dot(normalize(vNormalW), uSunDir));
          gl_FragColor = vec4(uColor * f * day, f * day * 0.9);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(this.R * 1.012, 96, 64), hazeMat));
  }

  makeFatLine(color, width, { dashed = false, opacity = 1 } = {}) {
    const mat = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, dashed, dashSize: 0.15, gapSize: 0.12 });
    const line = new Line2(new LineGeometry(), mat);
    line.frustumCulled = false;
    this.lineMaterials = this.lineMaterials || [];
    this.lineMaterials.push(mat);
    return line;
  }

  buildOrbitViz() {
    this.orbitLine = this.makeFatLine(new THREE.Color(this.palette.orbitLine), 1.6, { opacity: 0.7 });
    this.scene.add(this.orbitLine);

    // Ground trail lives in the planet-fixed frame so it rotates with the surface
    this.groundTrail = this.makeFatLine(new THREE.Color(this.palette.trackPast), 2.4);
    this.planetGroup.add(this.groundTrail);

    // Nadir line from satellite to the sub-satellite point
    const nadirGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.nadirLine = new THREE.Line(nadirGeo, new THREE.LineDashedMaterial({
      color: this.palette.nadir, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.9,
    }));
    this.nadirLine.frustumCulled = false;
    this.scene.add(this.nadirLine);

    // Sub-satellite ring marker on the surface
    this.subMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.07, 0.11, 24),
      new THREE.MeshBasicMaterial({ color: this.palette.nadir, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    this.scene.add(this.subMarker);
  }

  buildSwathViz() {
    // Recorded swath: strip draped in the planet-fixed frame, colored per vertex by STATUS
    this.swathMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.swathGeo = new THREE.BufferGeometry();
    this.swathStrip = new THREE.Mesh(this.swathGeo, this.swathMat);
    this.swathStrip.frustumCulled = false;
    this.planetGroup.add(this.swathStrip);
    this.swathCap = 0;
    this.swathDrawn = { version: -1, count: 0 };
    this.ensureSwathCapacity(700);

    // FOV fan: satellite apex + ground scan arc (inertial frame)
    const fanGeo = new THREE.BufferGeometry();
    fanGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FAN_SEGMENTS + 2) * 3), 3));
    const idx = [];
    for (let j = 1; j <= FAN_SEGMENTS; j++) idx.push(0, j, j + 1);
    fanGeo.setIndex(idx);
    this.fanMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.fan = new THREE.Mesh(fanGeo, this.fanMat);
    this.fan.frustumCulled = false;
    this.scene.add(this.fan);

    // Fan edge rays (satellite -> swath edges)
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    this.rayMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 });
    this.fanRays = new THREE.LineSegments(rayGeo, this.rayMat);
    this.fanRays.frustumCulled = false;
    this.scene.add(this.fanRays);

    // Bright scan line on the ground = the detector array's current footprint
    this.scanLine = this.makeFatLine(new THREE.Color(0xffffff), 3);
    this.scene.add(this.scanLine);
    this.buildFramingViz();
  }

  /**
   * Framing camera visuals (planet-fixed group so footprints stay on the ground):
   * a square pyramid from the satellite to the frame footprint, footprint outlines of previous
   * exposures, recorded tasked frames, target dots and the picked-place pin.
   */
  buildFramingViz() {
    const pg = this.planetGroup;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
    fg.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]);
    this.frustumMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.frustum = new THREE.Mesh(fg, this.frustumMat);
    this.frustum.frustumCulled = false;
    pg.add(this.frustum);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.frustumEdges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.frustumEdges.frustumCulled = false;
    pg.add(this.frustumEdges);

    this.tiles = Array.from({ length: TILE_OUTLINES }, () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
      const loop = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      loop.frustumCulled = false;
      pg.add(loop);
      return loop;
    });

    this.frameMarkers = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      MAX_FRAME_MARKERS
    );
    this.frameMarkers.count = 0;
    this.frameMarkers.frustumCulled = false;
    pg.add(this.frameMarkers);
    this.frameMarkerVersion = -1;

    this.pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff4d6d }));
    head.position.y = 0.16;
    const stem = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 10), new THREE.MeshBasicMaterial({ color: 0xff4d6d }));
    stem.rotation.x = Math.PI;
    stem.position.y = 0.07;
    this.pin.add(head, stem);
    this.pin.visible = false;
    pg.add(this.pin);
  }

  /** Faint dots for the tasked targets (built once, toggled per instrument). */
  setTargets(targets) {
    if (!this.targetDots) {
      const pos = new Float32Array(targets.length * 3);
      const v = new THREE.Vector3();
      targets.forEach((t, i) => fixedToLocal(t.u, this.R * 1.003, v).toArray(pos, i * 3));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.targetDots = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.75 }));
      this.planetGroup.add(this.targetDots);
    }
  }

  /** Picked place pin (planet-fixed) or null. */
  setPin(place) {
    this.pin.visible = !!place;
    if (!place) return;
    const u = latLonToEcef(place.latDeg, place.lonDeg, 1);
    const n = fixedToLocal(u, 1);
    this.pin.position.copy(n).multiplyScalar(this.R * 1.002);
    this.pin.quaternion.setFromUnitVectors(Y_AXIS, n);
  }

  /** Rebuild recorded tasked-frame markers when the recorder's frames changed. */
  syncFrameMarkers(rec, kind) {
    if (rec.frameVersion === this.frameMarkerVersion) return;
    this.frameMarkerVersion = rec.frameVersion;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), n = new THREE.Vector3(), s = new THREE.Vector3();
    const day = new THREE.Color(this.palette.swath[kind]), cloud = new THREE.Color(this.palette.cloudMask);
    const size = FRAME_MARKER_KM / SCENE_KM_PER_UNIT;
    let k = 0;
    for (const f of rec.frames) {
      if (f.status === STATUS.NONE || k >= MAX_FRAME_MARKERS) continue;
      fixedToLocal(f.u, 1, n);
      q.setFromUnitVectors(Z_AXIS, n);
      m.compose(n.clone().multiplyScalar(this.R * 1.003), q, s.set(size, size, 1));
      this.frameMarkers.setMatrixAt(k, m);
      this.frameMarkers.setColorAt(k, f.status === STATUS.CLOUD ? cloud : day);
      k++;
    }
    this.frameMarkers.count = k;
    this.frameMarkers.instanceMatrix.needsUpdate = true;
    if (this.frameMarkers.instanceColor) this.frameMarkers.instanceColor.needsUpdate = true;
  }

  /**
   * framing: { corners (4 planet-fixed units) | null, flash 0..1, tiles: [corners...] }.
   * Draws the pyramid from the satellite (world p) to the footprint, plus tiled outlines.
   */
  updateFraming(p, framing) {
    const show = !!(framing && framing.corners);
    this.frustum.visible = this.frustumEdges.visible = show;
    for (let i = 0; i < this.tiles.length; i++) {
      const c = framing?.tiles?.[i];
      this.tiles[i].visible = !!c;
      if (!c) continue;
      const pos = this.tiles[i].geometry.attributes.position;
      const v = new THREE.Vector3();
      c.forEach((u, j) => pos.setXYZ(j, ...fixedToLocal(u, this.R * 1.004, v).toArray()));
      pos.needsUpdate = true;
      this.tiles[i].material.opacity = 0.55 - i * 0.09;
    }
    if (!show) return;
    this.planetGroup.updateMatrixWorld();
    const apex = this.planetGroup.worldToLocal(p.clone());
    const base = framing.corners.map((u) => fixedToLocal(u, this.R * 1.004));
    const fp = this.frustum.geometry.attributes.position;
    fp.setXYZ(0, apex.x, apex.y, apex.z);
    base.forEach((b, j) => fp.setXYZ(j + 1, b.x, b.y, b.z));
    fp.needsUpdate = true;
    const ep = this.frustumEdges.geometry.attributes.position;
    let k = 0;
    for (let j = 0; j < 4; j++) {
      ep.setXYZ(k++, apex.x, apex.y, apex.z);
      ep.setXYZ(k++, base[j].x, base[j].y, base[j].z);
      ep.setXYZ(k++, base[j].x, base[j].y, base[j].z);
      ep.setXYZ(k++, base[(j + 1) % 4].x, base[(j + 1) % 4].y, base[(j + 1) % 4].z);
    }
    ep.needsUpdate = true;
    this.frustumMat.opacity = 0.12 + 0.5 * framing.flash;
    this.frustumEdges.material.opacity = 0.45 + 0.55 * framing.flash;
  }

  /** Recolor fan/rays and swap the instrument model (scan type + kind; SAR gets an antenna). */
  setSensor(inst, scan) {
    const color = new THREE.Color(this.palette.swath[inst.kind]);
    this.fanMat.color.copy(color);
    this.rayMat.color.copy(color);
    this.frustumMat.color.copy(color);
    this.targeted = inst.imaging === 'targeted';
    if (this.targetDots) this.targetDots.visible = this.targeted;
    this.frameMarkers.visible = this.targeted;
    this.scan = inst.kind === 'sar' ? 'sar' : scan;
    this.sat.setInstrument(this.scan, inst.kind, { lookSide: inst.lookSide });
  }

  /** Grow the swath buffers (doubling) and rebuild the index; forces a full rewrite. */
  ensureSwathCapacity(rows) {
    if (rows <= this.swathCap) return;
    const cap = Math.max(rows, this.swathCap * 2);
    const pos = new THREE.BufferAttribute(new Float32Array(cap * SWATH_VERTS * 3), 3);
    const col = new THREE.BufferAttribute(new Float32Array(cap * SWATH_VERTS * 4), 4);
    pos.setUsage(THREE.DynamicDrawUsage);
    col.setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint32Array((cap - 1) * CROSS_CELLS * 6);
    let k = 0;
    for (let i = 1; i < cap; i++) {
      for (let c = 0; c < CROSS_CELLS; c++) {
        const a = (i - 1) * SWATH_VERTS + c, b = i * SWATH_VERTS + c;
        idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
        idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1;
      }
    }
    this.swathGeo.setAttribute('position', pos);
    this.swathGeo.setAttribute('color', col);
    this.swathGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.swathCap = cap;
    this.swathDrawn.version = -1;
  }

  /** RGBA for a recorded status (cached per sensor kind). Day and night share one color. */
  statusRgba(kind, st) {
    this.rgbaCache = this.rgbaCache || {};
    const key = kind + st;
    if (!this.rgbaCache[key]) {
      const pal = this.palette;
      const [hex, a] = {
        [STATUS.DAY]: [pal.swath[kind], 0.45],
        [STATUS.NIGHT]: [pal.swath[kind], 0.45],
        [STATUS.CLOUD]: [pal.cloudMask, 0.8],
        [STATUS.NONE]: ['#000000', 0],
      }[st];
      const c = new THREE.Color(hex);
      this.rgbaCache[key] = [c.r, c.g, c.b, a];
    }
    return this.rgbaCache[key];
  }

  writeSwathRow(i, row) {
    const pos = this.swathGeo.attributes.position.array, col = this.swathGeo.attributes.color.array;
    const r = (this.planet.radiusKm + 12) / SCENE_KM_PER_UNIT; // just above the faceted surface
    for (let c = 0; c < SWATH_VERTS; c++) {
      const p = row.pts, o = (i * SWATH_VERTS + c) * 3, q = 3 * c;
      pos[o] = p[q] * r; pos[o + 1] = p[q + 2] * r; pos[o + 2] = -p[q + 1] * r; // planet-fixed -> scene axes
      const rgba = this.statusRgba(row.kind, row.vst[c]), oc = (i * SWATH_VERTS + c) * 4;
      col[oc] = rgba[0]; col[oc + 1] = rgba[1]; col[oc + 2] = rgba[2]; col[oc + 3] = rgba[3];
    }
  }

  /** Sync the draped strip with the recorder: append-only unless rows were removed. */
  syncSwath(rec, tail) {
    const n = rec.samples.length, total = n + (tail ? 1 : 0);
    this.ensureSwathCapacity(total + 1);
    const from = rec.version === this.swathDrawn.version ? this.swathDrawn.count : 0;
    for (let i = from; i < n; i++) this.writeSwathRow(i, rec.samples[i]);
    if (tail) this.writeSwathRow(n, tail);
    const pos = this.swathGeo.attributes.position, col = this.swathGeo.attributes.color;
    const start = Math.min(from, n), end = total;
    if (end > start) {
      pos.clearUpdateRanges();
      col.clearUpdateRanges();
      pos.addUpdateRange(start * SWATH_VERTS * 3, (end - start) * SWATH_VERTS * 3);
      col.addUpdateRange(start * SWATH_VERTS * 4, (end - start) * SWATH_VERTS * 4);
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
    this.swathDrawn = { version: rec.version, count: n };
    this.swathGeo.setDrawRange(0, Math.max(0, total - 1) * CROSS_CELLS * 6);
  }

  /**
   * Camera reference frame:
   *  space     - camera fixed in inertial space, Earth rotates beneath
   *  earth     - camera co-rotates with Earth (stays over the same country)
   *  satellite - camera looks down on the satellite
   */
  setViewMode(mode) {
    this.viewMode = mode;
  }

  /**
   * FOV visualization (inertial frame).
   * Pushbroom: full fan + full scan line (all detectors image at once).
   * Whiskbroom: narrow beam sweeping across the swath during the Earth-view share (eta) of each
   * mirror cycle, then nothing while the mirror views the calibration targets.
   */
  updateFan(p, pos, vel, edges, beam) {
    const fin = (x) => (Number.isFinite(x) ? x : 0);
    const left = crossTrackPointEci(pos, vel, fin(edges.left));
    const right = crossTrackPointEci(pos, vel, fin(edges.right));
    const L = toScene(left.map((x) => x * 1000)), Rv = toScene(right.map((x) => x * 1000));
    if (this.scan === 'sar') this.sat.animate({ pulse: 0.5 + 0.5 * Math.sin(performance.now() / 90) });

    let a0 = 0, a1 = 1, line1 = 1, active = true;
    const whisk = !!beam;
    if (whisk) {
      active = beam.active;
      a0 = Math.max(0, beam.sweep - WHISK_BEAM_HALF);
      a1 = Math.min(1, beam.sweep + WHISK_BEAM_HALF);
      line1 = beam.sweep;
      this.sat.animate({ mirrorAngle: beam.phase * Math.PI, calibrating: !active });
    }
    this.fan.visible = active;
    this.scanLine.visible = active;
    // SAR: radar "pulse" shimmer on the side-looking beam
    this.fanMat.opacity = whisk ? 0.55 : this.scan === 'sar' ? 0.12 + 0.14 * (0.5 + 0.5 * Math.sin(performance.now() / 90)) : 0.22;
    this.rayMat.opacity = whisk ? 0.35 : 0.85;

    const fanPos = this.fan.geometry.attributes.position;
    fanPos.setXYZ(0, p.x, p.y, p.z);
    const arc = [];
    const v = new THREE.Vector3();
    for (let j = 0; j <= FAN_SEGMENTS; j++) {
      v.lerpVectors(L, Rv, a0 + ((a1 - a0) * j) / FAN_SEGMENTS).setLength(this.R * 1.002);
      fanPos.setXYZ(j + 1, v.x, v.y, v.z);
      v.lerpVectors(L, Rv, (line1 * j) / FAN_SEGMENTS).setLength(this.R * 1.004);
      arc.push(v.x, v.y, v.z);
    }
    fanPos.needsUpdate = true;
    this.fan.geometry.computeBoundingSphere();

    const rays = this.fanRays.geometry.attributes.position;
    const e0 = L.setLength(this.R * 1.002), e1 = Rv.setLength(this.R * 1.002);
    rays.setXYZ(0, p.x, p.y, p.z);
    rays.setXYZ(1, e0.x, e0.y, e0.z);
    rays.setXYZ(2, p.x, p.y, p.z);
    rays.setXYZ(3, e1.x, e1.y, e1.z);
    rays.needsUpdate = true;
    if (active) this.scanLine.geometry.setPositions(arc);
  }

  /**
   * Metallic materials render black without something to reflect, so the satellite
   * (only) gets a soft studio environment map. The planet stays purely sun-lit.
   */
  applySatelliteEnvMap() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.sat.object.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (m.isMeshStandardMaterial) {
          m.envMap = env;
          m.envMapIntensity = 0.9;
          m.needsUpdate = true;
        }
      }
    });
    this.sat.envMap = env; // used by setInstrument() for swapped-in instruments
  }

  /** Small always-visible glow so the satellite can be found when zoomed out. */
  makeBeacon() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,220,120,0.9)');
    grad.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sprite.scale.setScalar(0.045);
    return sprite;
  }

  /** Use the painted equirectangular canvas as the planet texture. */
  setLandTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.planetMat.map = tex;
    this.planetMat.color.set(0xffffff);
    this.planetMat.needsUpdate = true;
  }

  /** Surface marker in the planet-fixed frame (e.g. future AOIs). */
  addMarker(latDeg, lonDeg, color = 0xffffff) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(toScene(latLonToEcef(latDeg, lonDeg, this.planet.radiusKm)));
    this.planetGroup.add(m);
    return m;
  }

  /**
   * Per-frame update.
   * state: { pos, vel (ECI km), theta (rad), sunDir (ECI unit), orbitPath (ECI km[]),
   *          pastTrack [{latDeg, lonDeg}], edges {left, right} (rad), beam, recorder, tail, cloudSystems }
   *  beam: null for pushbroom, { active, sweep, phase } for whiskbroom.
   */
  update({ pos, vel, theta, sunDir, orbitPath, pastTrack, edges, beam, recorder, tail, cloudSystems, framing, kind }) {
    // Planet rotation (ECEF -> ECI is +theta about the pole, i.e. +theta about scene Y)
    this.planetGroup.rotation.y = theta;
    this.updateClouds(cloudSystems);

    // Sun light + sprite + atmosphere
    const sun = toScene(sunDir).normalize().multiplyScalar(SCENE_KM_PER_UNIT);
    this.sunLight.position.copy(sun).multiplyScalar(0.05);
    this.sunSprite.position.copy(sun).multiplyScalar(0.8);
    this.atmoUniforms.uSunDir.value.copy(sun).normalize();

    // Satellite position + nadir-pointing attitude (X along-track, Y zenith, Z cross-track)
    const p = toScene(pos);
    const up = p.clone().normalize();
    const v = toScene(vel);
    const along = v.sub(up.clone().multiplyScalar(v.dot(up))).normalize();
    const cross = new THREE.Vector3().crossVectors(along, up);
    const satObj = this.sat.object;
    satObj.position.copy(p);
    satObj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, up, cross));
    this.satBeacon.position.copy(p);

    // Solar wings track the sun
    const localSun = this.atmoUniforms.uSunDir.value.clone().applyQuaternion(satObj.quaternion.clone().invert());
    this.sat.trackSun(localSun);

    // Nadir line + surface marker
    const surface = up.clone().multiplyScalar(this.R * 1.002);
    const nadirPos = this.nadirLine.geometry.attributes.position;
    nadirPos.setXYZ(0, p.x, p.y, p.z);
    nadirPos.setXYZ(1, surface.x, surface.y, surface.z);
    nadirPos.needsUpdate = true;
    this.nadirLine.computeLineDistances();
    this.subMarker.position.copy(up.clone().multiplyScalar(this.R * 1.004));
    this.subMarker.lookAt(up.clone().multiplyScalar(this.R * 2));
    const pulse = 1 + 0.25 * Math.sin(performance.now() / 250);
    this.subMarker.scale.setScalar(pulse);

    // Orbit ellipse (inertial) and draped ground trail (planet-fixed)
    const flat = [];
    const tmp = new THREE.Vector3();
    for (const q of orbitPath) {
      toScene(q, tmp);
      flat.push(tmp.x, tmp.y, tmp.z);
    }
    flat.push(flat[0], flat[1], flat[2]); // close the loop
    this.orbitLine.geometry.setPositions(flat);

    const trail = [];
    for (const g of pastTrack) {
      toScene(latLonToEcef(g.latDeg, g.lonDeg, this.planet.radiusKm + 18), tmp);
      trail.push(tmp.x, tmp.y, tmp.z);
    }
    this.groundTrail.geometry.setPositions(trail);

    // Recorded swath (planet-fixed) and live FOV fan / whisk beam (inertial)
    this.syncSwath(recorder, tail);
    this.updateFan(p, pos, vel, edges, beam);
    // Framing cameras: pyramid + footprints instead of the pushbroom fan / scan line
    const isFraming = this.scan === 'framing';
    if (isFraming) this.fan.visible = this.scanLine.visible = this.fanRays.visible = false;
    else this.fanRays.visible = true;
    this.updateFraming(p, isFraming ? framing : null);
    if (this.targeted) this.syncFrameMarkers(recorder, kind);

    // First frame: put the camera above the satellite, slightly ahead and north
    if (!this.framed) {
      this.framed = true;
      const dir = up.clone().multiplyScalar(0.85).add(along.clone().multiplyScalar(0.35)).add(new THREE.Vector3(0, 0.3, 0));
      this.camera.position.copy(dir.setLength(this.R * 4.3));
    }

    // Earth-fixed view: rotate the camera with the planet by the change in rotation angle
    if (this.viewMode === 'earth' && this.lastTheta !== null) {
      const d = Math.atan2(Math.sin(theta - this.lastTheta), Math.cos(theta - this.lastTheta));
      this.camera.position.applyAxisAngle(Y_AXIS, d);
    }
    this.lastTheta = theta;

    // Satellite view: swing the camera to look down on the satellite, keeping zoom distance
    if (this.viewMode === 'satellite') {
      const dist = this.camera.position.length();
      const target = up.clone().multiplyScalar(dist);
      this.camera.position.lerp(target, 0.08).setLength(dist);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials || []) m.resolution.set(w, h);
  }
}
