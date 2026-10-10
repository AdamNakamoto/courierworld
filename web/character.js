// Characters with a soft, skinned body (so knees, elbows and the waist bend smoothly and straps
// lie flat on it) and a head built from simple shapes, all cel-shaded so the ink pass outlines them
// like the rest of the world. Faces +z; feet at the origin; about 1.6 tall.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "https://esm.sh/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js";
import { toon, mulberry32 } from "./world.js";

// One vertex-coloured material shared by every character's merged parts.
const SHARED = toon(0xffffff, { vertexColors: true });
SHARED.userData.shared = true;

/// Fewer draw calls: the meshes hanging off each joint of a rig become one vertex-coloured mesh, so
/// the joints still move but each draws once. Meshes in `keep` (animated on their own) stay apart.
export function compact(root, keep = new Set()) {
  const joints = [];
  root.traverse((o) => {
    if (!o.isMesh) joints.push(o);
  });
  for (const j of joints) {
    const parts = j.children.filter((c) => c.isMesh && !c.isSkinnedMesh && !keep.has(c) && !c.children.length && c.material.emissive?.getHex() === 0);
    if (parts.length < 2) continue;
    let geos = parts.map((m) => {
      m.updateMatrix();
      const g = m.geometry.clone().applyMatrix4(m.matrix);
      const c = m.material.color, n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
      return g;
    });
    if (!geos.every((g) => g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = new THREE.Mesh(mergeGeometries(geos), SHARED);
    merged.castShadow = merged.receiveShadow = true;
    for (const m of parts) {
      j.remove(m);
      m.geometry.dispose();
    }
    j.add(merged);
  }
}

/// The default courier, used before you pick one of your own.
export const COURIER = {
  skin: 0xf3d2bb, hair: 0x3a2a2c, hairStyle: "pony", headwear: "cap",
  shirt: 0xf4efe0, accent: 0x2f8088, bottoms: 0x34476b, bottomsStyle: "shorts",
  socks: 0xf4f1ea, shoes: 0x2b2b2e, bag: "satchel",
};

const SKINS = [0xf3d2bb, 0xe8bfa0, 0xd9a47f, 0xf6dcc8, 0xc98d68];
const HAIRS = [0x3a2a2c, 0x5a3b2c, 0x1f1c1e, 0x8a6a4a, 0xb9b3ad, 0x6b4a6e];
const SHIRTS = [0xe46f5f, 0x5d8fd1, 0xf2c94c, 0x7cc2b5, 0xf4efe0, 0x8d7299, 0x9cc46f];
const BOTTOMS = [0x34476b, 0x4e5a67, 0x8a6a4a, 0x2f3a3f, 0xc0504a, 0x6b8f72];

/// A random villager look, seeded so a house always gets the same resident.
export function villager(seed) {
  const r = mulberry32(seed);
  const p = (arr) => arr[Math.floor(r() * arr.length)];
  return {
    skin: p(SKINS), hair: p(HAIRS), hairStyle: p(["bob", "bun", "pony", "long", "bob"]),
    headwear: r() < 0.25 ? p(["cap", "bucket", "beanie"]) : "none",
    shirt: p(SHIRTS), accent: p(SHIRTS), bottoms: p(BOTTOMS), bottomsStyle: p(["shorts", "skirt", "pants", "pants"]),
    socks: 0xf4f1ea, shoes: p([0x2b2b2e, 0x6c5446, 0xf4f1ea]), bag: "none", height: 0.92 + r() * 0.14,
  };
}

// ---------------------------------------------------------------- soft body

// One vertex-coloured, skinned material shared by every character's body.
const SKIN = toon(0xffffff, { vertexColors: true });
SKIN.userData.shared = true;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/// Radii of a ring profile [{ y, rx, rz }] (top to bottom) at height y.
function radiiAt(rings, y) {
  if (y >= rings[0].y) return [rings[0].rx, rings[0].rz];
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1], b = rings[i];
    if (y >= b.y) {
      const k = (y - b.y) / (a.y - b.y);
      return [b.rx + (a.rx - b.rx) * k, b.rz + (a.rz - b.rz) * k];
    }
  }
  const z = rings[rings.length - 1];
  return [z.rx, z.rz];
}

/// A body made of rings of vertices stacked along the bones and skinned to them, so knees, elbows,
/// waist and neck bend smoothly instead of hinging between separate parts.
class Skin {
  constructor() {
    this.pos = []; this.col = []; this.si = []; this.sw = []; this.idx = []; this.n = 0;
  }
  vertex(x, y, z, color, weights) {
    this.pos.push(x, y, z);
    this.col.push(color.r, color.g, color.b);
    // Up to four bones, strongest first, weights summing to 1.
    const w = weights.filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = w.reduce((s, [, v]) => s + v, 0) || 1;
    for (let i = 0; i < 4; i++) {
      this.si.push(w[i] ? w[i][0] : 0);
      this.sw.push(w[i] ? w[i][1] / sum : 0);
    }
    return this.n++;
  }
  /// A tube through rings [{ y, rx, rz }] (top to bottom) around (cx, cz).
  tube(rings, hex, weigh, { cx = 0, cz = 0, segs = 14, capTop = false, capBottom = false } = {}) {
    const color = new THREE.Color(hex), start = this.n;
    for (const r of rings) {
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = cx + r.rx * Math.sin(a), z = cz + r.rz * Math.cos(a);
        this.vertex(x, r.y, z, color, weigh(r.y, x));
      }
    }
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < segs; i++) {
        const a = start + j * segs + i, b = start + j * segs + ((i + 1) % segs);
        const c = a + segs, d = b + segs;
        this.idx.push(a, c, b, b, c, d);
      }
    }
    const cap = (j, y, flip) => {
      const mid = this.vertex(cx, y, cz, color, weigh(y, cx));
      for (let i = 0; i < segs; i++) {
        const a = start + j * segs + i, b = start + j * segs + ((i + 1) % segs);
        if (flip) this.idx.push(mid, b, a);
        else this.idx.push(mid, a, b);
      }
    };
    if (capTop) cap(0, rings[0].y + Math.min(rings[0].rx, rings[0].rz) * 0.4, false);
    if (capBottom) cap(rings.length - 1, rings[rings.length - 1].y - Math.min(rings[rings.length - 1].rx, rings[rings.length - 1].rz) * 0.4, true);
  }
  /// A flat band through `points` (closed loop if `loop`), lying on the surface whose outward
  /// direction at each point is `out`: a strap hugging the body.
  band(points, out, width, thick, hex, weigh, loop = true) {
    const color = new THREE.Color(hex), start = this.n, n = points.length;
    const t = new THREE.Vector3(), w = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const next = points[loop ? (i + 1) % n : Math.min(n - 1, i + 1)], prev = points[loop ? (i - 1 + n) % n : Math.max(0, i - 1)];
      t.subVectors(next, prev).normalize();
      w.crossVectors(t, out[i]).normalize().multiplyScalar(width / 2);
      for (const [side, lift] of [[1, thick], [-1, thick], [-1, 0], [1, 0]]) {
        p.copy(points[i]).addScaledVector(w, side).addScaledVector(out[i], lift);
        this.vertex(p.x, p.y, p.z, color, weigh(p.y, p.x));
      }
    }
    const segsN = loop ? n : n - 1;
    for (let i = 0; i < segsN; i++) {
      const a = start + i * 4, b = start + ((i + 1) % n) * 4;
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        this.idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2);
      }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/// A loop round the torso through two points on its front-to-back midline: a strap's path.
function strapLoop(torso, from, to, inset = 0.016, n = 44) {
  // The plane through the line from→to that also runs front to back.
  const slope = (to.y - from.y) / (to.x - from.x);
  const pts = [], out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let y = 1.0, x = 0, z = 0;
    for (let k = 0; k < 10; k++) {
      const [rx, rz] = radiiAt(torso, y);
      x = (rx + inset) * Math.sin(a);
      z = (rz + inset) * Math.cos(a);
      y = 0.5 * y + 0.5 * Math.min(torso[0].y - 0.01, Math.max(torso[torso.length - 1].y, from.y + slope * (x - from.x)));
    }
    const [rx, rz] = radiiAt(torso, y);
    pts.push(new THREE.Vector3(x, y, z));
    out.push(new THREE.Vector3(x / (rx * rx), 0, z / (rz * rz)).normalize());
  }
  return { pts, out };
}
/// A strap looping up over one shoulder (x = sx), from the chest to the back.
function shoulderLoop(torso, sx, low, n = 28) {
  const pts = [], out = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI; // 0 front, π back
    let y = low + (torso[0].y - 0.03 - low) * Math.sin(a);
    const [rx, rz] = radiiAt(torso, Math.min(y, torso[1].y));
    const zr = (rz + 0.018) * Math.sqrt(Math.max(0, 1 - (sx * sx) / ((rx + 0.018) * (rx + 0.018))));
    const z = zr * Math.cos(a);
    pts.push(new THREE.Vector3(sx, y + 0.02 * Math.sin(a), z));
    out.push(new THREE.Vector3(0, Math.sin(a), Math.cos(a)).normalize());
  }
  return { pts, out };
}

export function createCharacter(p) {
  const root = new THREE.Group();
  const mats = new Map();
  const mat = (c, extra) => {
    const key = extra ? `${c}:${JSON.stringify(extra)}` : c;
    if (!mats.has(key)) mats.set(key, toon(c, extra));
    return mats.get(key);
  };
  const add = (parent, geo, color, x = 0, y = 0, z = 0, extra) => {
    const m = new THREE.Mesh(geo, mat(color, extra));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const pants = p.bottomsStyle === "pants", skirt = p.bottomsStyle === "skirt";

  // ---- skeleton (feet at the origin, facing +z; index 0 of each pair is the right side, x < 0)
  const bone = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent?.add(b);
    return b;
  };
  const body = bone(null, 0, 0, 0);
  const pelvis = bone(body, 0, 0.8, 0);
  const spine = bone(pelvis, 0, 0.14, 0);
  const chest = bone(spine, 0, 0.14, 0);
  const neck = bone(chest, 0, 0.13, 0);
  const head = bone(neck, 0, 0.06, 0);
  const arms = [], elbows = [], legs = [], knees = [];
  for (const s of [-1, 1]) {
    const sh = bone(chest, s * 0.19, 0.06, 0);
    arms.push(sh);
    elbows.push(bone(sh, 0, -0.22, 0));
  }
  for (const s of [-1, 1]) {
    const hip = bone(pelvis, s * 0.085, -0.04, 0);
    legs.push(hip);
    knees.push(bone(hip, 0, -0.36, 0));
  }
  const bones = [body, pelvis, spine, chest, neck, head, arms[0], elbows[0], arms[1], elbows[1], legs[0], knees[0], legs[1], knees[1]];
  const B = (b) => bones.indexOf(b);

  // ---- how each part follows the bones
  const torsoW = (y) => {
    const wp = 1 - smooth(0.84, 0.98, y), wc = smooth(0.98, 1.12, y), wn = smooth(1.2, 1.3, y);
    return [[B(pelvis), wp * (1 - wn)], [B(spine), Math.max(0, 1 - wp - wc) * (1 - wn)], [B(chest), wc * (1 - wn)], [B(neck), wn]];
  };
  const neckW = (y) => [[B(chest), 1 - smooth(1.2, 1.3, y)], [B(neck), smooth(1.2, 1.3, y) * (1 - smooth(1.3, 1.36, y))], [B(head), smooth(1.3, 1.36, y)]];
  // Legs bend at the knee; their tops lean a little toward the hips (hidden under the shorts).
  const legW = (i, hips = 0.3) => (y) => {
    const t = smooth(0.33, 0.47, y), top = smooth(0.66, 0.82, y) * hips;
    return [[B(pelvis), top], [B(legs[i]), t * (1 - top)], [B(knees[i]), (1 - t) * (1 - top)]];
  };
  const armW = (i) => (y) => {
    const t = smooth(0.86, 0.98, y);
    return [[B(arms[i]), t], [B(elbows[i]), 1 - t]];
  };
  const only = (b) => () => [[B(b), 1]];

  // ---- the soft body: torso, shorts, legs, socks, arms and hands, sleeves, neck
  const sk = new Skin();
  const ring = (y, rx, rz = rx) => ({ y, rx, rz });
  // A loose shirt: soft sloping shoulders, flaring out a little to the hem.
  const torso = [ring(1.245, 0.045, 0.042), ring(1.228, 0.095, 0.078), ring(1.205, 0.132, 0.1), ring(1.17, 0.152, 0.112), ring(1.12, 0.156, 0.118),
    ring(1.04, 0.152, 0.118), ring(0.95, 0.153, 0.12), ring(0.86, 0.168, 0.13), ring(0.79, 0.182, 0.142)];
  sk.tube(torso, p.shirt, torsoW, { segs: 18 });
  sk.tube([ring(1.36, 0.044), ring(1.27, 0.045), ring(1.19, 0.05)], p.skin, neckW, { segs: 10 });
  if (skirt) {
    sk.tube([ring(0.87, 0.14, 0.11), ring(0.8, 0.168, 0.135), ring(0.58, 0.26, 0.23)], p.bottoms, only(pelvis), { segs: 18 });
  } else {
    sk.tube([ring(0.87, 0.135, 0.105), ring(0.8, 0.155, 0.122), ring(0.72, 0.17, 0.134), ring(0.66, 0.16, 0.126), ring(0.625, 0.105, 0.085)],
      p.bottoms, only(pelvis), { segs: 18, capBottom: true });
  }
  [-1, 1].forEach((s, i) => {
    const cx = s * 0.085, w = legW(i);
    if (pants) {
      // Loose trousers down to the ankle, with a turned-up cuff.
      sk.tube([ring(0.76, 0.09), ring(0.6, 0.088), ring(0.4, 0.082), ring(0.2, 0.078), ring(0.13, 0.08)], p.bottoms, w, { cx });
      sk.tube([ring(0.15, 0.087), ring(0.11, 0.087)], p.bottoms, w, { cx });
      sk.tube([ring(0.13, 0.045), ring(0.06, 0.041)], p.socks, w, { cx, segs: 10, capBottom: true });
    } else {
      // Bare legs; shorts flare out over the thighs.
      sk.tube([ring(0.74, 0.06), ring(0.6, 0.056), ring(0.47, 0.05), ring(0.4, 0.049), ring(0.33, 0.048), ring(0.22, 0.047), ring(0.12, 0.041), ring(0.07, 0.039)],
        p.skin, w, { cx, segs: 12, capBottom: true });
      sk.tube([ring(0.165, 0.051), ring(0.06, 0.049)], p.socks, w, { cx, segs: 12 });
      // The shorts' legs go wholly with the thighs, so they swing instead of stretching.
      if (!skirt) sk.tube([ring(0.8, 0.094), ring(0.66, 0.104), ring(0.52, 0.116)], p.bottoms, legW(i, 0), { cx: cx * 1.15, segs: 16 });
    }
  });
  [-1, 1].forEach((s, i) => {
    const cx = s * 0.19, w = armW(i);
    // Upper arm, elbow, forearm, then a mitten of a hand (flat, palm inward).
    sk.tube([ring(1.18, 0.05), ring(1.05, 0.048), ring(0.92, 0.043), ring(0.82, 0.04), ring(0.745, 0.036),
      ring(0.72, 0.034, 0.048), ring(0.68, 0.04, 0.056), ring(0.64, 0.034, 0.05), ring(0.61, 0.016, 0.022)], p.skin, w, { cx, segs: 12 });
    if (p.sleeves === "long") {
      // A jacket's sleeves, down to the wrist; they bend at the elbow with the arm.
      sk.tube([ring(1.215, 0.066), ring(1.13, 0.07), ring(1.0, 0.064), ring(0.9, 0.058), ring(0.8, 0.055), ring(0.755, 0.055)], p.shirt, w, { cx: s * 0.192, segs: 16, capTop: true });
    } else {
      // Short, roomy sleeves.
      sk.tube([ring(1.215, 0.068), ring(1.13, 0.078), ring(1.0, 0.088, 0.082)], p.shirt, only(arms[i]), { cx: s * 0.195, segs: 16, capTop: true });
    }
  });

  // ---- bags: straps lie flat on the body (part of the soft body); the bag itself hangs off a bone
  let bag = null;
  const rb = (w, h, d, r = 0.025) => new RoundedBoxGeometry(w, h, d, 2, r);
  const satchelLoop = (hex) => {
    const { pts, out } = strapLoop(torso, new THREE.Vector3(-0.13, 1.22, 0), new THREE.Vector3(0.16, 0.84, 0));
    sk.band(pts, out, 0.05, 0.014, hex, torsoW);
  };
  if (p.bag === "satchel" || p.bag === "golden") {
    const gold = p.bag === "golden";
    const leather = gold ? 0xe8b93a : 0xa0693c, flap = gold ? 0xc9962a : 0x7e5230;
    satchelLoop(gold ? 0xb88a22 : 0x6e4a2c);
    bag = new THREE.Group();
    bag.position.set(0.2, 0.05, 0.02);
    pelvis.add(bag);
    const extra = gold ? { emissive: 0x3a2800 } : undefined;
    add(bag, rb(0.1, 0.22, 0.26, 0.035), leather, 0, -0.1, 0, extra);
    add(bag, rb(0.112, 0.1, 0.27, 0.03), flap, 0, -0.02, 0, extra);
    add(bag, rb(0.118, 0.045, 0.05, 0.012), gold ? 0xfff2b0 : 0xe2c46a, 0, -0.07, 0.06);
  } else if (p.bag === "backpack") {
    for (const s of [-1, 1]) {
      const { pts, out } = shoulderLoop(torso, s * 0.085, 0.93);
      sk.band(pts, out, 0.042, 0.014, 0x4e5a67, torsoW, false);
    }
    bag = new THREE.Group();
    bag.position.set(0, -0.1, -0.2);
    chest.add(bag);
    add(bag, rb(0.28, 0.34, 0.14, 0.05), p.accent, 0, 0, 0);
    add(bag, rb(0.22, 0.14, 0.05, 0.02), 0xf4efe0, 0, -0.06, -0.08);
    add(bag, rb(0.29, 0.06, 0.15, 0.025), 0x3b4145, 0, 0.14, 0);
  } else if (p.bag === "tote") {
    const { pts, out } = shoulderLoop(torso, 0.1, 0.86);
    sk.band(pts, out, 0.04, 0.012, 0xd8cdb0, torsoW, false);
    bag = new THREE.Group();
    bag.position.set(0.17, -0.04, 0.06);
    pelvis.add(bag);
    add(bag, rb(0.06, 0.28, 0.26, 0.02), 0xeee4c8, 0, 0, 0);
    add(bag, rb(0.065, 0.08, 0.12, 0.015), p.accent, 0, 0.02, 0);
  } else if (p.bag === "sack") {
    satchelLoop(0x8a6a4a);
    bag = new THREE.Group();
    bag.position.set(0.1, 0.0, -0.2);
    chest.add(bag);
    const sack = add(bag, new THREE.SphereGeometry(0.2, 14, 12), 0xd2b48c, 0, 0, 0);
    sack.scale.set(1, 1.15, 0.8);
    add(bag, new THREE.CylinderGeometry(0.05, 0.08, 0.1, 10), 0xb8986e, 0.06, 0.24, 0.02);
    add(bag, new THREE.BoxGeometry(0.12, 0.08, 0.02), 0xf4efe0, 0, -0.02, -0.16); // envelope peeking out
  }

  const skin = new THREE.SkinnedMesh(sk.build(), SKIN);
  skin.add(body);
  skin.bind(new THREE.Skeleton(bones));
  skin.castShadow = skin.receiveShadow = true;
  skin.frustumCulled = false;
  root.add(skin);

  // ---- collar and chunky rounded shoes
  const collar = add(chest, new THREE.TorusGeometry(0.07, 0.024, 8, 16), p.collar ?? p.accent, 0, 0.115, 0.004);
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1.05, 0.85, 1);
  for (const k of knees) {
    add(k, new THREE.SphereGeometry(0.08, 14, 10), p.shoes, 0, -0.335, 0.055).scale.set(0.95, 0.62, 1.3);
    add(k, new THREE.SphereGeometry(0.065, 12, 9), p.shoes, 0, -0.33, -0.015).scale.set(0.95, 0.72, 1);
  }

  if (p.tie) {
    // An open jacket: a white shirt front in a V, and a long tie.
    const v = new THREE.Shape();
    v.moveTo(0, 0);
    v.lineTo(0.06, 0.235);
    v.lineTo(-0.06, 0.235);
    v.closePath();
    add(chest, new THREE.ShapeGeometry(v), 0xf4f1ea, 0, -0.08, 0.122).rotation.x = -0.15;
    add(chest, new THREE.BoxGeometry(0.044, 0.036, 0.02), p.tie, 0, 0.125, 0.1);
    add(chest, new THREE.BoxGeometry(0.038, 0.17, 0.012), p.tie, 0, 0.025, 0.124).rotation.x = -0.08;
    const tip = add(chest, new THREE.ConeGeometry(0.027, 0.04, 4), p.tie, 0, -0.075, 0.125);
    tip.rotation.set(Math.PI, Math.PI / 4, 0);
    tip.scale.z = 0.4;
  }

  // ---- head
  const eyes = [], tails = []; // tails: swinging hair pieces
  if (p.head === "frog") {
    // A frog: a wide, flat head, big round eyes up top, a long smile and a golden swoop of hair.
    const top = add(head, new THREE.SphereGeometry(0.2, 22, 16), p.skin, 0, 0.16, 0.01);
    top.scale.set(1.22, 0.8, 1.02);
    add(head, new THREE.SphereGeometry(0.17, 18, 12), 0xc5df9a, 0, 0.09, 0.035).scale.set(1.18, 0.5, 0.98);
    const smile = new THREE.TorusGeometry(0.197, 0.011, 6, 28, 1.5).rotateX(Math.PI / 2).rotateY(0.75 - Math.PI / 2).scale(1.22, 1, 1.02);
    add(head, smile, 0x3b5a2e, 0, 0.13, 0.01);
    for (const s of [-1, 1]) {
      add(head, new THREE.SphereGeometry(0.078, 14, 10), p.skin, s * 0.1, 0.25, 0.12);
      add(head, new THREE.SphereGeometry(0.062, 14, 10), 0xffffff, s * 0.1, 0.255, 0.155);
      const e = add(head, new THREE.SphereGeometry(0.03, 10, 8), 0x231d20, s * 0.1, 0.255, 0.21);
      e.scale.set(1, 1.1, 0.5);
      eyes.push(e);
      add(head, new THREE.SphereGeometry(0.009, 6, 4), 0xffffff, s * 0.09, 0.27, 0.226);
      add(head, new THREE.SphereGeometry(0.03, 8, 6), 0xf0a49a, s * 0.16, 0.13, 0.15).scale.set(1, 0.5, 0.3);
      add(head, new THREE.SphereGeometry(0.01, 6, 4), 0x3b5a2e, s * 0.03, 0.2, 0.207);
    }
    add(head, new THREE.SphereGeometry(0.17, 16, 12), p.hair, 0, 0.26, -0.09).scale.set(1.25, 0.6, 1.0);
    const sweep = add(head, new THREE.SphereGeometry(0.13, 16, 12), p.hair, 0.02, 0.33, -0.02);
    sweep.scale.set(1.45, 0.48, 1.1);
    sweep.rotation.z = -0.12;
    const quiff = add(head, new THREE.SphereGeometry(0.08, 12, 10), p.hair, -0.06, 0.36, 0.0);
    quiff.scale.set(1.5, 0.6, 1.0);
    quiff.rotation.z = 0.25;
  } else {
    const skull = add(head, new THREE.SphereGeometry(0.19, 20, 16), p.skin, 0, 0.17, 0);
    skull.scale.set(1, 1.04, 0.97);
    for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.034, 8, 6), p.skin, s * 0.185, 0.15, 0);

    // Face: tall dark eyes with a catch-light, brows, a small mouth, blush.
    for (const s of [-1, 1]) {
      const e = add(head, new THREE.CapsuleGeometry(0.021, 0.032, 4, 8), 0x231d20, s * 0.068, 0.165, 0.168);
      e.scale.set(1, 1, 0.45);
      eyes.push(e);
      add(head, new THREE.SphereGeometry(0.008, 6, 4), 0xffffff, s * 0.062, 0.18, 0.18);
      const brow = add(head, new THREE.BoxGeometry(0.06, 0.012, 0.012), p.hair, s * 0.07, 0.235, 0.17);
      brow.rotation.z = -s * 0.12;
      const blush = add(head, new THREE.SphereGeometry(0.028, 8, 6), 0xf0a49a, s * 0.11, 0.115, 0.15);
      blush.scale.set(1, 0.5, 0.3);
    }
    add(head, new THREE.BoxGeometry(0.03, 0.008, 0.01), 0x7a3b36, 0, 0.085, 0.182);

    // ---- hair: a cap over the top and back, bangs, then the style
    const hairCap = add(head, new THREE.SphereGeometry(0.205, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), p.hair, 0, 0.18, -0.01);
    hairCap.rotation.x = -0.32;
    const backHair = add(head, new THREE.SphereGeometry(0.188, 16, 12), p.hair, 0, 0.13, -0.045);
    backHair.scale.set(1.02, 1, 0.9);
    for (const [x, y, z] of [[-0.085, 0.29, 0.13], [0, 0.305, 0.145], [0.085, 0.29, 0.13]]) {
      const b = add(head, new THREE.SphereGeometry(0.075, 10, 8), p.hair, x, y, z);
      b.scale.set(1.1, 0.72, 0.55);
    }
    const tailAt = (x, y, z, len, rx, rz = 0) => {
      const t = new THREE.Group();
      t.position.set(x, y, z);
      t.rotation.set(rx, 0, rz);
      t.userData.rest = rx;
      head.add(t);
      add(t, new THREE.CapsuleGeometry(0.055, len, 4, 10), p.hair, 0, -len / 2 - 0.03, -0.02);
      const tie = add(t, new THREE.TorusGeometry(0.038, 0.015, 6, 10), p.accent, 0, 0, 0);
      tie.rotation.x = Math.PI / 2;
      tails.push(t);
    };
    const sideLocks = (len) => {
      for (const s of [-1, 1]) add(head, new THREE.CapsuleGeometry(0.035, len, 4, 8), p.hair, s * 0.165, 0.17 - len / 2, 0.05);
    };
    switch (p.hairStyle) {
      case "pony":
        sideLocks(0.12);
        tailAt(0, 0.24, -0.17, 0.2, 0.55);
        break;
      case "bun":
        sideLocks(0.1);
        add(head, new THREE.SphereGeometry(0.085, 12, 10), p.hair, 0, 0.37, -0.08);
        break;
      case "bob": {
        for (const s of [-1, 1]) {
          const side = add(head, new THREE.SphereGeometry(0.11, 12, 10), p.hair, s * 0.15, 0.1, 0.0);
          side.scale.set(0.7, 1.15, 1.25);
        }
        break;
      }
      case "twin":
        sideLocks(0.1);
        for (const s of [-1, 1]) tailAt(s * 0.17, 0.25, -0.08, 0.22, 0.3, s * 0.5);
        break;
      case "long": {
        sideLocks(0.2);
        const back = add(head, new THREE.CapsuleGeometry(0.15, 0.26, 4, 12), p.hair, 0, -0.02, -0.11);
        back.scale.set(1.05, 1, 0.55);
        break;
      }
    }

    // ---- headwear
    switch (p.headwear) {
      case "cap": {
        const crown = add(head, new THREE.SphereGeometry(0.212, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), p.accent, 0, 0.2, -0.01);
        crown.scale.y = 0.9;
        const brim = add(head, new THREE.CylinderGeometry(0.13, 0.13, 0.016, 16), p.accent, 0, 0.3, 0.17);
        brim.scale.z = 0.75;
        brim.rotation.x = 0.16;
        add(head, new THREE.BoxGeometry(0.05, 0.04, 0.02), 0xf2c94c, 0, 0.36, 0.18);
        break;
      }
      case "bucket": {
        add(head, new THREE.CylinderGeometry(0.17, 0.2, 0.14, 16), p.accent, 0, 0.36, -0.01);
        const brim = add(head, new THREE.CylinderGeometry(0.29, 0.29, 0.02, 20), p.accent, 0, 0.29, -0.01);
        brim.rotation.x = 0.08;
        add(head, new THREE.CylinderGeometry(0.205, 0.205, 0.035, 16), 0xf4efe0, 0, 0.31, -0.01);
        break;
      }
      case "beanie": {
        const cap = add(head, new THREE.SphereGeometry(0.215, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), p.accent, 0, 0.21, -0.02);
        cap.rotation.x = -0.2;
        const fold = add(head, new THREE.TorusGeometry(0.19, 0.035, 6, 20), p.accent, 0, 0.28, 0.0);
        fold.rotation.x = Math.PI / 2 - 0.2;
        add(head, new THREE.SphereGeometry(0.06, 10, 8), 0xf4efe0, 0, 0.45, -0.06);
        break;
      }
      case "headphones": {
        const band = add(head, new THREE.TorusGeometry(0.215, 0.022, 6, 20, Math.PI), 0x3b4145, 0, 0.17, 0);
        band.rotation.z = 0;
        for (const s of [-1, 1]) {
          const cup = add(head, new THREE.CylinderGeometry(0.065, 0.065, 0.05, 14), p.accent, s * 0.205, 0.16, 0);
          cup.rotation.z = Math.PI / 2;
        }
        break;
      }
      case "hardhat": {
        const dome = add(head, new THREE.SphereGeometry(0.218, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), 0xf4f1ea, 0, 0.21, -0.01);
        dome.scale.y = 0.85;
        const brim = add(head, new THREE.CylinderGeometry(0.25, 0.25, 0.02, 20), 0xf4f1ea, 0, 0.215, 0.02);
        brim.scale.z = 1.08;
        add(head, new THREE.BoxGeometry(0.03, 0.08, 0.36), 0xe8b93a, 0, 0.36, -0.01);
        break;
      }
      case "goggles": {
        const strapG = add(head, new THREE.TorusGeometry(0.2, 0.018, 6, 24), 0x6c5446, 0, 0.27, 0);
        strapG.rotation.x = Math.PI / 2 - 0.25;
        for (const s of [-1, 1]) {
          const lens = add(head, new THREE.CylinderGeometry(0.048, 0.048, 0.04, 14), 0xc9962a, s * 0.06, 0.31, 0.155);
          lens.rotation.x = Math.PI / 2 - 0.5;
          const glass = add(head, new THREE.CylinderGeometry(0.036, 0.036, 0.045, 14), 0x8db8c6, s * 0.06, 0.31, 0.158);
          glass.rotation.x = Math.PI / 2 - 0.5;
        }
        break;
      }
      case "bandana": {
        // A cloth tied over the top of the head, knotted at the back.
        const cloth = add(head, new THREE.SphereGeometry(0.214, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.4), p.accent, 0, 0.19, -0.015);
        cloth.rotation.x = -0.28;
        const hem = add(head, new THREE.TorusGeometry(0.198, 0.018, 6, 24), p.accent, 0, 0.255, 0);
        hem.rotation.x = Math.PI / 2 - 0.28;
        add(head, new THREE.SphereGeometry(0.045, 8, 6), p.accent, 0, 0.2, -0.2);
        for (const s of [-1, 1]) add(head, new THREE.BoxGeometry(0.05, 0.12, 0.015), p.accent, s * 0.03, 0.14, -0.2).rotation.z = s * 0.3;
        break;
      }
    }

    if (p.glasses === "shades") {
      // Black sunglasses that wrap round a little, with gold hinges.
      for (const s of [-1, 1]) {
        add(head, rb(0.105, 0.075, 0.02, 0.012), 0x1b1c1f, s * 0.07, 0.172, 0.19).rotation.y = s * 0.22;
        add(head, new THREE.BoxGeometry(0.06, 0.016, 0.014), 0x1b1c1f, s * 0.15, 0.19, 0.176);
        add(head, new THREE.BoxGeometry(0.012, 0.016, 0.16), 0x1b1c1f, s * 0.178, 0.19, 0.095);
        add(head, new THREE.BoxGeometry(0.016, 0.012, 0.03), 0xe2c46a, s * 0.181, 0.19, 0.15);
      }
      add(head, new THREE.BoxGeometry(0.04, 0.014, 0.014), 0x1b1c1f, 0, 0.19, 0.198);
    }
    if (p.earring) {
      // Two silver studs joined by a little chain, and a cross hanging from the right ear.
      const silver = 0xc9ced3;
      add(head, new THREE.SphereGeometry(0.012, 6, 5), silver, -0.205, 0.13, 0.012);
      add(head, new THREE.SphereGeometry(0.01, 6, 5), silver, -0.212, 0.168, 0.0);
      add(head, new THREE.CapsuleGeometry(0.004, 0.03, 2, 4), silver, -0.212, 0.149, 0.006);
      add(head, new THREE.BoxGeometry(0.008, 0.055, 0.008), silver, -0.207, 0.09, 0.012);
      add(head, new THREE.BoxGeometry(0.03, 0.008, 0.008), silver, -0.207, 0.1, 0.012);
    }
  }

  if (p.height) root.scale.setScalar(p.height);

  // ---- poses and animation
  let pose = "walk"; // walk | sit (bike, moped) | stand (skateboard, plane)
  let phase = 0, blink = 2 + Math.random() * 3, wave = 0, swim = 0;
  function setPose(next) {
    pose = next;
  }
  /// 0..1: how far the right hand is up, waving.
  function setWave(k) {
    wave = k;
  }
  /// 0..1: treading water.
  function setSwim(k) {
    swim = k;
  }
  /// speed: 0 idle, 0.62 walking, 1 running (or how hard she's pedalling). air: 0 on the ground … 1 mid-jump.
  /// dist: ground covered this frame; when given, the stride follows it so the feet don't skate.
  /// Returns true on the frame a foot comes down.
  function update(dt, speed, t, air = 0, dist = null) {
    const stepBefore = Math.floor((phase - Math.PI / 2) / Math.PI);
    const run = Math.min(1, Math.max(0, (speed - 0.62) / 0.38));
    const k = Math.min(1, speed / 0.62); // 0 standing … 1 at walking pace and up
    const amp = 0.5 + 0.32 * run;
    if (dist !== null && pose === "walk") {
      // One step covers the legs' reach, longer when running (both feet leave the ground).
      phase += (dist / (2 * 0.76 * Math.sin(amp) * (1 + 0.45 * run))) * Math.PI;
    } else phase += dt * (3 + 8.5 * speed);
    const s = Math.sin(phase), c = Math.cos(phase);
    if (pose === "walk") {
      legs[0].rotation.set(s * amp * k, 0, 0);
      legs[1].rotation.set(-s * amp * k, 0, 0);
      // Each knee bends as its foot swings through, more when running.
      const bend = (0.5 + 0.8 * run) * k;
      knees[0].rotation.x = 0.04 + bend * Math.max(0, -c);
      knees[1].rotation.x = 0.04 + bend * Math.max(0, c);
      const swing = (0.42 + 0.3 * run) * k;
      arms[0].rotation.set(-s * swing, 0, -0.1);
      arms[1].rotation.set(s * swing, 0, 0.1);
      elbows[0].rotation.x = elbows[1].rotation.x = -0.1 - (0.25 + 1.0 * run) * k;
      // The hips swing with the legs and the chest turns against them; the waist bends between.
      pelvis.rotation.set(0, s * (0.09 + 0.06 * run) * k, c * 0.035 * k);
      chest.rotation.set((0.04 + 0.1 * run) * k, -s * (0.14 + 0.08 * run) * k, -c * 0.03 * k);
      spine.rotation.x = 0.06 * run * k;
      body.position.y = Math.abs(c) * (0.03 + 0.05 * run) * k + Math.sin(t * 2.1) * 0.004 * (1 - k);
      body.rotation.x = (0.03 + 0.1 * run) * k;
      // Breathing, when standing about.
      chest.rotation.x += Math.sin(t * 2.1) * 0.015 * (1 - k);
      if (air > 0) {
        // Mid-jump: one knee tucked up, arms flung out.
        const to = (o, v) => o + (v - o) * air;
        legs[0].rotation.x = to(legs[0].rotation.x, -0.75);
        legs[1].rotation.x = to(legs[1].rotation.x, 0.25);
        knees[0].rotation.x = to(knees[0].rotation.x, 1.3);
        knees[1].rotation.x = to(knees[1].rotation.x, 0.45);
        for (const a of arms) a.rotation.x *= 1 - air;
        arms[0].rotation.z = to(arms[0].rotation.z, -1.15);
        arms[1].rotation.z = to(arms[1].rotation.z, 1.15);
        elbows[0].rotation.x = elbows[1].rotation.x = to(elbows[0].rotation.x, -0.35);
        chest.rotation.x = to(chest.rotation.x, -0.12);
        body.position.y *= 1 - air;
      }
    } else if (pose === "sit") {
      // Seated, hands forward on the bars, legs pedalling.
      legs[0].rotation.set(-1.15 + s * 0.35 * speed, 0, 0);
      legs[1].rotation.set(-1.15 - s * 0.35 * speed, 0, 0);
      knees[0].rotation.x = 1.25 - s * 0.3 * speed;
      knees[1].rotation.x = 1.25 + s * 0.3 * speed;
      arms[0].rotation.set(-1.0, 0, -0.12);
      arms[1].rotation.set(-1.0, 0, 0.12);
      elbows[0].rotation.x = elbows[1].rotation.x = -0.3;
      pelvis.rotation.set(0, 0, 0);
      spine.rotation.x = 0.12;
      chest.rotation.set(0.1, 0, 0);
      body.position.y = 0;
      body.rotation.x = 0.05;
    } else {
      // Riding stance: sideways-ish, knees soft, arms out for balance.
      legs[0].rotation.set(0.02, 0, 0.12);
      legs[1].rotation.set(-0.22, 0, -0.12);
      knees[0].rotation.x = knees[1].rotation.x = 0.3;
      arms[0].rotation.set(0, 0, -0.55 + Math.sin(t * 2) * 0.05);
      arms[1].rotation.set(0, 0, 0.55 - Math.sin(t * 2) * 0.05);
      elbows[0].rotation.x = elbows[1].rotation.x = -0.25;
      // Turned a little sideways on the deck, swaying to keep balance.
      pelvis.rotation.set(0, 0.25, 0);
      spine.rotation.x = 0.06;
      chest.rotation.set(0.04, -0.15, Math.sin(t * 2) * 0.04);
      body.position.y = -0.05 + Math.sin(t * 3) * 0.008;
      body.rotation.x = 0.05;
    }
    if (swim > 0.01 && pose === "walk") {
      // Treading water: arms sweeping wide at the surface, legs kicking slowly below it.
      const s2 = Math.sin(t * 3.2), c2 = Math.cos(t * 3.2), to = (o, v) => o + (v - o) * swim;
      arms[0].rotation.x = to(arms[0].rotation.x, -0.9 + s2 * 0.35);
      arms[1].rotation.x = to(arms[1].rotation.x, -0.9 - s2 * 0.35);
      arms[0].rotation.z = to(arms[0].rotation.z, -0.95 + c2 * 0.25);
      arms[1].rotation.z = to(arms[1].rotation.z, 0.95 - c2 * 0.25);
      elbows[0].rotation.x = elbows[1].rotation.x = to(elbows[0].rotation.x, -0.6);
      legs[0].rotation.x = to(legs[0].rotation.x, s2 * 0.4 - 0.2);
      legs[1].rotation.x = to(legs[1].rotation.x, -s2 * 0.4 - 0.2);
      knees[0].rotation.x = knees[1].rotation.x = to(knees[0].rotation.x, 0.55);
      pelvis.rotation.y = to(pelvis.rotation.y, 0);
      chest.rotation.y = to(chest.rotation.y, 0);
      chest.rotation.x = to(chest.rotation.x, 0.15);
      body.position.y = to(body.position.y, Math.sin(t * 2.2) * 0.04);
    }
    if (wave > 0 && pose === "walk") {
      const osc = Math.sin(t * 11);
      arms[0].rotation.x *= 1 - wave;
      arms[0].rotation.z += (-2.55 + osc * 0.28 - arms[0].rotation.z) * wave;
      elbows[0].rotation.x += (-0.5 + osc * 0.3 - elbows[0].rotation.x) * wave;
    }
    head.rotation.x = -0.05 * k + Math.sin(t * 1.1) * 0.025 * (1 - k);
    for (const tl of tails) tl.rotation.x = tl.userData.rest + Math.sin(phase * 2) * 0.14 * speed + Math.sin(t * 1.7) * 0.03;
    if (bag) bag.rotation.x = Math.sin(phase) * 0.1 * speed;
    blink -= dt;
    const closed = blink < 0.12;
    for (const e of eyes) e.scale.y = closed ? 0.15 : 1;
    if (blink < 0) blink = 2 + Math.random() * 4;
    return pose === "walk" && k > 0.15 && air === 0 && Math.floor((phase - Math.PI / 2) / Math.PI) !== stepBefore;
  }

  compact(root, new Set(eyes));
  return { root, body, head, update, setPose, setWave, setSwim };
}
