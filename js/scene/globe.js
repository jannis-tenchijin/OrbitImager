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
import { latLonToEcef, swathEdgesEci } from '../physics/orbit.js';

const SWATH_CROSS_SEGMENTS = 8; // subdivisions across the swath so wide strips hug the sphere
const FAN_SEGMENTS = 16;        // subdivisions of the ground scan arc under the FOV fan
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** ECI or ECEF km vector -> scene units (Y-up). */
export function toScene(v, out = new THREE.Vector3()) {
  return out.set(v[0], v[2], -v[1]).divideScalar(SCENE_KM_PER_UNIT);
}

export class Globe {
  constructor(container, planet, palette, { satelliteScale = 1, sensor } = {}) {
    this.container = container;
    this.planet = planet;
    this.palette = palette;
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

    this.sat = createSatelliteModel({ scale: satelliteScale, instrument: sensor.scan, band: sensor.id });
    this.scene.add(this.sat.object);
    this.applySatelliteEnvMap();
    this.setSensor(sensor);
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

    this.clouds = this.buildClouds();
    this.planetGroup.add(this.clouds);
  }

  /** Puffy low-poly cloud clusters floating above the surface. */
  buildClouds() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x5a6a9a, emissiveIntensity: 0.35,
      roughness: 1, flatShading: true, transparent: true, opacity: 0.88,
    });
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 34; k++) {
      const cluster = new THREE.Group();
      const puffs = 3 + Math.floor(rnd() * 4);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(puffGeo, mat);
        const s = 0.06 + rnd() * 0.07;
        m.scale.set(s * 1.3, s * 0.55, s);
        m.position.set((p - puffs / 2) * 0.09 + rnd() * 0.04, rnd() * 0.04, (rnd() - 0.5) * 0.12);
        m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        cluster.add(m);
      }
      // Place on the sphere at a random lat (biased away from poles) / lon
      const lat = (rnd() - 0.5) * 140, lon = rnd() * 360 - 180;
      const p = toScene(latLonToEcef(lat, lon, this.planet.radiusKm + 70));
      cluster.position.copy(p);
      cluster.lookAt(p.clone().multiplyScalar(2));
      cluster.rotateX(Math.PI / 2); // cluster's Y axis -> local up
      cluster.rotateY(rnd() * Math.PI);
      group.add(cluster);
    }
    return group;
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
    // Recorded swath: triangle strip draped in the planet-fixed frame
    const cols = SWATH_CROSS_SEGMENTS + 1;
    this.swathMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide,
    });
    this.swathStrip = new THREE.Mesh(new THREE.BufferGeometry(), this.swathMat);
    this.swathStrip.frustumCulled = false;
    this.swathStrip.userData.cols = cols;
    this.planetGroup.add(this.swathStrip);

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
  }

  /** Recolor swath/fan and swap the instrument model for a sensor preset. */
  setSensor(preset) {
    const color = new THREE.Color(this.palette.swath[preset.id]);
    this.swathMat.color.copy(color);
    this.fanMat.color.copy(color);
    this.rayMat.color.copy(color);
    this.sat.setInstrument(preset.scan, preset.id);
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

  /** Rebuild the draped swath strip from swathTrack() samples (planet-fixed lat/lon). */
  updateSwathStrip(track) {
    const cols = this.swathStrip.userData.cols;
    const geo = this.swathStrip.geometry;
    const n = track.length;
    let pos = geo.getAttribute('position');
    if (!pos || pos.count !== n * cols) {
      pos = new THREE.BufferAttribute(new Float32Array(n * cols * 3), 3);
      geo.setAttribute('position', pos);
      const idx = [];
      for (let i = 1; i < n; i++) {
        for (let c = 1; c < cols; c++) {
          const a = (i - 1) * cols + c - 1, b = i * cols + c - 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      geo.setIndex(idx);
    }
    const r = (this.planet.radiusKm + 12) / SCENE_KM_PER_UNIT; // just above the faceted surface
    const L = new THREE.Vector3(), Rv = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      toScene(latLonToEcef(track[i].left.latDeg, track[i].left.lonDeg, 1000), L);
      toScene(latLonToEcef(track[i].right.latDeg, track[i].right.lonDeg, 1000), Rv);
      for (let c = 0; c < cols; c++) {
        v.lerpVectors(L, Rv, c / (cols - 1)).setLength(r); // normalized lerp across the swath
        pos.setXYZ(i * cols + c, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
  }

  /** FOV fan + ground scan line for the current state (inertial frame). */
  updateFan(p, pos, vel, swathKm) {
    const lam = Number.isFinite(swathKm) ? swathKm / (2 * this.planet.radiusKm) : 0;
    const { left, right } = swathEdgesEci(pos, vel, Math.cos(lam), Math.sin(lam));
    const L = toScene(left.map((x) => x * 1000)), Rv = toScene(right.map((x) => x * 1000));
    const fanPos = this.fan.geometry.attributes.position;
    fanPos.setXYZ(0, p.x, p.y, p.z);
    const arc = [];
    const v = new THREE.Vector3();
    for (let j = 0; j <= FAN_SEGMENTS; j++) {
      v.lerpVectors(L, Rv, j / FAN_SEGMENTS).setLength(this.R * 1.002);
      fanPos.setXYZ(j + 1, v.x, v.y, v.z);
      v.setLength(this.R * 1.004);
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
    this.scanLine.geometry.setPositions(arc);
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
   *          past (swathTrack samples), swathKm, nowMs }
   */
  update({ pos, vel, theta, sunDir, orbitPath, past, swathKm, nowMs }) {
    // Planet rotation (ECEF -> ECI is +theta about the pole, i.e. +theta about scene Y)
    this.planetGroup.rotation.y = theta;
    this.clouds.rotation.y = (nowMs / 3.6e6) * 0.15; // slow extra drift for life

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
    for (const g of past) {
      toScene(latLonToEcef(g.latDeg, g.lonDeg, this.planet.radiusKm + 18), tmp);
      trail.push(tmp.x, tmp.y, tmp.z);
    }
    this.groundTrail.geometry.setPositions(trail);

    // Recorded swath (planet-fixed) and live FOV fan (inertial)
    this.updateSwathStrip(past);
    this.updateFan(p, pos, vel, swathKm);

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
