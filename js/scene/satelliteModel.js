// Low-poly but recognizable satellite model.
// Local frame (matches main orientation code): +X = along-track (velocity), +Y = zenith (away
// from planet), +Z = cross-track. The instrument slot sits on the nadir (-Y) face.

import * as THREE from 'three';

const MODEL_UNIT = 0.06; // scene units per model unit (see SATELLITE_MODEL_SCALE in config)

/** Canvas texture of solar cells: dark blue cells separated by silver bus bars. */
function solarCellTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c9d2e6';
  g.fillRect(0, 0, 128, 128);
  const cells = 6, gap = 2, size = (128 - gap * (cells + 1)) / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = gap + i * (size + gap), y = gap + j * (size + gap);
      const grad = g.createLinearGradient(x, y, x + size, y + size);
      grad.addColorStop(0, '#2b4fa8');
      grad.addColorStop(1, '#18306e');
      g.fillStyle = grad;
      g.fillRect(x, y, size, size);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Box with jittered inner vertices + flat shading = crinkled gold MLI foil look. */
function foilBox(w, h, d, material) {
  const geo = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const onEdge = [Math.abs(v.x) / (w / 2), Math.abs(v.y) / (h / 2), Math.abs(v.z) / (d / 2)]
      .filter((r) => r > 0.999).length > 1;
    if (!onEdge) v.addScalar((Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.04);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

const MAT = {
  gold: new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 0.55, roughness: 0.4, flatShading: true }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 0.1, roughness: 0.6, flatShading: true }),
  silver: new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.7, roughness: 0.3, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1e26, metalness: 0.2, roughness: 0.7, flatShading: true }),
  panelBack: new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.2, roughness: 0.7 }),
};

/** Slit glow per band: visual = blue, thermal = warm orange. */
const SLIT_GLOW = { visual: 0x3aa0ff, thermal: 0xff7a2a };

/** Thermal extras that make TIR instruments recognizable: cryo-radiator fin + cryocooler. */
function addThermalExtras(g) {
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.55), MAT.dark);
  fin.position.set(0, -0.2, 0.68);
  fin.rotation.x = -0.35;
  g.add(fin);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.3), MAT.silver);
  strut.position.set(0, -0.25, 0.48);
  g.add(strut);
  const cooler = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.38, 10), MAT.gold);
  cooler.rotation.z = Math.PI / 2;
  cooler.position.set(-0.55, -0.3, -0.2);
  g.add(cooler);
}

/** Pushbroom imager: telescope housing with a long cross-track detector slit (its signature). */
function buildPushbroom(band = 'visual') {
  const g = new THREE.Group();
  g.name = `instrument:pushbroom:${band}`;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.8), band === 'thermal' ? MAT.silver : MAT.white);
  housing.position.y = -0.27;
  g.add(housing);
  // Baffle hood around the aperture
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.25, 8, 1, true), MAT.dark);
  hood.material = hood.material.clone();
  hood.material.side = THREE.DoubleSide;
  hood.position.y = -0.66;
  g.add(hood);
  // Detector line: long and thin across track
  const slit = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.02, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x0a1030, emissive: SLIT_GLOW[band] ?? SLIT_GLOW.visual, emissiveIntensity: 1.6 })
  );
  slit.position.y = -0.56;
  g.add(slit);
  if (band === 'thermal') addThermalExtras(g);
  return g;
}

/**
 * Whiskbroom imager: housing + a double-sided scan mirror spinning about the along-track (X)
 * axis inside an open cross-track scan cavity, plus a calibration blackbody that the mirror
 * views between Earth sweeps (it glows while calibrating).
 */
function buildWhiskbroom(band = 'visual') {
  const g = new THREE.Group();
  g.name = `instrument:whiskbroom:${band}`;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.62), band === 'thermal' ? MAT.silver : MAT.white);
  housing.position.y = -0.2;
  g.add(housing);
  // Scan cavity: dark half-cylinder shell open toward nadir, axis along-track
  const cavityMat = MAT.dark.clone();
  cavityMat.side = THREE.DoubleSide;
  const cavity = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.62, 14, 1, true, Math.PI / 2, Math.PI), cavityMat);
  cavity.rotation.z = Math.PI / 2;
  cavity.position.y = -0.42;
  g.add(cavity);
  // Rotating mirror drum: shaft + double-sided mirror plate (spins about X)
  const rotor = new THREE.Group();
  rotor.position.y = -0.48;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), MAT.silver);
  shaft.rotation.z = Math.PI / 2;
  rotor.add(shaft);
  const mirror = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.03, 0.44),
    new THREE.MeshStandardMaterial({ color: 0xdfe8ff, metalness: 1, roughness: 0.05, emissive: SLIT_GLOW[band] ?? SLIT_GLOW.visual, emissiveIntensity: 0.25 })
  );
  rotor.add(mirror);
  g.add(rotor);
  // Calibration blackbody beside the cavity (cross-track side)
  const bbMat = new THREE.MeshStandardMaterial({ color: 0x15161c, emissive: 0xff5a1f, emissiveIntensity: 0, roughness: 0.9 });
  const blackbody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.08), bbMat);
  blackbody.position.set(0, -0.36, -0.36);
  g.add(blackbody);
  if (band === 'thermal') addThermalExtras(g);
  g.userData.animate = ({ mirrorAngle, calibrating }) => {
    rotor.rotation.x = mirrorAngle;
    bbMat.emissiveIntensity = calibrating ? 1.4 : 0;
  };
  return g;
}

const INSTRUMENTS = { pushbroom: buildPushbroom, whiskbroom: buildWhiskbroom };

/** One solar wing: yoke + three hinged panels extending along +Z (mirrored for -Z). */
function buildWing(side, cellTex) {
  const wing = new THREE.Group();
  wing.name = `wing${side > 0 ? '+' : '-'}`;
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), MAT.silver);
  yoke.rotation.x = Math.PI / 2;
  yoke.position.z = side * 0.25;
  wing.add(yoke);

  const cellMat = new THREE.MeshStandardMaterial({ map: cellTex, metalness: 0.35, roughness: 0.35 });
  // Box face order: +x, -x, +y, -y, +z, -z  -> cells on +y (sun side), backing on -y
  const faces = [MAT.silver, MAT.silver, cellMat, MAT.panelBack, MAT.silver, MAT.silver];
  for (let k = 0; k < 3; k++) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.035, 1.1), faces);
    panel.position.z = side * (0.5 + 0.06 + 0.55 + k * 1.16);
    wing.add(panel);
  }
  return wing;
}

export function createSatelliteModel({ instrument = 'pushbroom', band = 'visual', scale = 1 } = {}) {
  const root = new THREE.Group();
  root.name = 'satellite';
  const body = new THREE.Group(); // scaled model content
  body.scale.setScalar(MODEL_UNIT * scale);
  root.add(body);

  // Bus with gold foil + white radiator on top
  const bus = foilBox(1.2, 1.0, 1.0, MAT.gold);
  body.add(bus);
  const radiator = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.9), MAT.white);
  radiator.position.y = 0.52;
  body.add(radiator);

  // Solar wings on both cross-track sides; pivot groups rotate about Z to track the sun
  const cellTex = solarCellTexture();
  const wings = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.z = side * 0.5;
    pivot.add(buildWing(side, cellTex));
    body.add(pivot);
    wings.push(pivot);
  }

  // High-gain downlink dish on the aft, angled toward the planet
  const dishProfile = [];
  for (let i = 0; i <= 6; i++) {
    const r = (i / 6) * 0.38;
    dishProfile.push(new THREE.Vector2(r, r * r * 1.2));
  }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(dishProfile, 12), MAT.white);
  dish.material = dish.material.clone();
  dish.material.side = THREE.DoubleSide;
  const dishMount = new THREE.Group();
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6), MAT.silver);
  boom.position.y = -0.17;
  dishMount.add(boom);
  dish.rotation.x = Math.PI; // open side faces -Y (nadir)
  dish.position.y = -0.36;
  dishMount.add(dish);
  dishMount.position.set(-0.45, -0.5, 0.25);
  dishMount.rotation.z = -0.5;
  body.add(dishMount);

  // Two star trackers with black baffles on the top-aft corner
  for (const z of [-0.25, 0.25]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.28, 8), MAT.dark);
    st.position.set(-0.45, 0.66, z);
    st.rotation.set(z * 1.2, 0, 0.5);
    body.add(st);
  }

  // Thruster nozzles on the aft face
  for (const [y, z] of [[0.3, 0.3], [0.3, -0.3], [-0.3, 0.3], [-0.3, -0.3]]) {
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8, 1, true), MAT.silver);
    n.rotation.z = -Math.PI / 2;
    n.position.set(-0.68, y, z);
    body.add(n);
  }

  // Swappable instrument slot on the nadir face
  const slot = new THREE.Group();
  slot.name = 'instrumentSlot';
  slot.position.set(0.1, -0.5, 0);
  body.add(slot);

  const api = {
    object: root,
    wings,
    /** Replace the instrument model (scan type + band). Unknown types fall back to pushbroom. */
    setInstrument(type, bandId = 'visual') {
      slot.clear();
      const inst = (INSTRUMENTS[type] ?? INSTRUMENTS.pushbroom)(bandId);
      if (api.envMap) {
        inst.traverse((o) => {
          if (o.material?.isMeshStandardMaterial) o.material.envMap = api.envMap;
        });
      }
      slot.add(inst);
      api.instrument = inst;
    },
    /** Animate moving instrument parts (whiskbroom mirror + calibration glow). */
    animate(state) {
      api.instrument?.userData.animate?.(state);
    },
    /** Rotate both wings about the cross-track axis so cells face the sun (dir in local frame). */
    trackSun(localSunDir) {
      const angle = Math.atan2(-localSunDir.x, localSunDir.y);
      for (const w of wings) w.rotation.z = angle;
    },
  };
  api.setInstrument(instrument, band);
  return api;
}
