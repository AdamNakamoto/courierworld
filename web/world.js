// A tiny planet town drawn like an anime background: cel shading, hand-inked
// outlines from a post pass over depth and normals, and a teal sky with flat clouds.
// Everything static is baked into one vertex-coloured mesh so the town stays cheap.
import * as THREE from "https://esm.sh/three@0.160.0";

export const R = 24;
export const UP = new THREE.Vector3(0, 1, 0);
export const ROAD_HW = 1.5; // asphalt half-width
export const WALK = 0.9; // sidewalk width

const C = {
  grass: 0x9ccb76, grass2: 0x86b964, tuft: 0x6fa957,
  asphalt: 0x8b949a, paint: 0xf3f0e4, walk: 0xc9c5b8, curb: 0xb3afa3,
  leaf: [0x5e9f57, 0x6db062, 0x4f8c4c, 0x7bb86a], trunk: 0x7a5b45,
  concrete: 0xa9aca6, block: 0xc8c2b4, wire: 0x2b3134,
  walls: [0xf1ebdc, 0xe2d4bc, 0xd3ddd9, 0xead1bf, 0xdbe2cb, 0xf2e3c5, 0xe6e1d8],
  roofs: [0x5f7d8d, 0xa9614d, 0x6b8f72, 0x4e5a67, 0x8d7299, 0xc28a4a, 0x3f6f8f],
  glass: 0x8db8c6, frame: 0xf6f3ea, door: 0x6c5446, metal: 0xd9d8d2,
  vend: [0x7cc2b5, 0xe46f5f, 0x5d8fd1, 0xf2c94c],
  awning: [[0xe46f5f, 0xfbf6ea], [0x5d8fd1, 0xfbf6ea], [0x6b9f6f, 0xfbf6ea], [0xf2c94c, 0x4e5a67]],
  sign: [0x5d8fd1, 0xe46f5f], pot: 0xb5734f, bin: 0x4f86c6,
};

// ---------------------------------------------------------------- helpers

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(2718);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const range = (a, b) => a + rng() * (b - a);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
export const arc = (a, b) => R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));

// Two-band cel shading.
const GRADIENT = (() => {
  const t = new THREE.DataTexture(new Uint8Array([125, 255]), 2, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, ...extra });

// Builders only use materials as colour carriers before baking; share them.
const matCache = new Map();
const tm = (color) => {
  if (!matCache.has(color)) matCache.set(color, toon(color));
  return matCache.get(color);
};
function part(g, geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, tm(color));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}
const box = (g, w, h, d, color, x, y, z, rx, ry, rz) => part(g, new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);

export function texFromCanvas(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/// Accumulates many meshes into one vertex-coloured geometry.
class Batch {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.n = 0; }
  add(geo, matrix, color) {
    const p = geo.attributes.position, nAttr = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nAttr, i).applyMatrix3(nm).normalize();
      this.nrm.push(v.x, v.y, v.z);
      this.col.push(color.r, color.g, color.b);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(this.n + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(this.n + i);
    this.n += p.count;
  }
  /// A flat quad a-b-c-d, wound so its normal points along `out` (default: away
  /// from the planet centre).
  quad(a, b, c, d, color, out) {
    let n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    let pts = [a, b, c, d];
    if (n.dot(out ?? a.clone().add(c)) < 0) {
      n.negate();
      pts = [a, d, c, b];
    }
    for (const p of pts) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
    }
    this.idx.push(this.n, this.n + 1, this.n + 2, this.n, this.n + 2, this.n + 3);
    this.n += 4;
  }
  build(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

// ---------------------------------------------------------------- roads

// Four great-circle streets; every pair crosses twice, giving twelve intersections.
export const ROADS = [v3(0.15, 1, 0.1), v3(1, 0.1, 0.2), v3(0.1, 0.25, 1), v3(0.75, -0.55, -0.6)].map((axis, i) => {
  const u = new THREE.Vector3(1, 0, 0).sub(axis.clone().multiplyScalar(axis.x)).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return {
    axis, u, v, h: 0.04 + i * 0.006,
    point: (t) => u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t)),
    tangent: (t) => u.clone().multiplyScalar(-Math.sin(t)).addScaledVector(v, Math.cos(t)),
  };
});
const roadDist = (d, r) => Math.abs(Math.asin(Math.min(1, Math.max(-1, d.dot(r.axis))))) * R;
export const nearestRoad = (d, skip = -1) => {
  let best = Infinity;
  ROADS.forEach((r, i) => { if (i !== skip) best = Math.min(best, roadDist(d, r)); });
  return best;
};
/// Point at `dir` pushed sideways by `off` world units and back onto the sphere.
export const offsetOnSphere = (dir, side, off) => dir.clone().multiplyScalar(R).addScaledVector(side, off).normalize();

// ---------------------------------------------------------------- props

function windowsRow(g, w, y, z, count, size = 0.55) {
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * (w / count);
    box(g, size + 0.14, size + 0.14, 0.06, C.frame, x, y, z);
    box(g, size, size, 0.08, C.glass, x, y, z + 0.01);
    box(g, 0.04, size, 0.09, C.frame, x, y, z + 0.02);
  }
}
function blockWall(g, w, d, doorX) {
  // Low block wall along the front with a gap for the gate, like a Japanese street.
  const z = d / 2 + 0.45, gap = 1.1;
  const left = doorX - gap / 2 + w / 2, right = w / 2 - (doorX + gap / 2);
  if (left > 0.2) box(g, left, 0.85, 0.18, C.block, -w / 2 + left / 2, 0.42, z);
  if (right > 0.2) box(g, right, 0.85, 0.18, C.block, w / 2 - right / 2, 0.42, z);
}
function pottedPlant(g, x, z) {
  part(g, new THREE.CylinderGeometry(0.16, 0.12, 0.3, 8), C.pot, x, 0.15, z);
  part(g, new THREE.SphereGeometry(0.22, 8, 6), pick(C.leaf), x, 0.42, z);
}
function vending(g, x, z, ry = 0) {
  const v = new THREE.Group();
  box(v, 0.9, 1.8, 0.72, pick(C.vend), 0, 0.9, 0);
  box(v, 0.72, 0.85, 0.06, C.frame, 0, 1.2, 0.36);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) box(v, 0.1, 0.18, 0.05, pick([0xe46f5f, 0x5d8fd1, 0xf2c94c, 0x7cc2b5]), -0.24 + c * 0.16, 0.95 + r * 0.26, 0.39);
  box(v, 0.5, 0.14, 0.06, 0x3b4145, 0, 0.35, 0.37);
  v.position.set(x, 0, z);
  v.rotation.y = ry;
  g.add(v);
}

function house(spec) {
  const g = new THREE.Group();
  const { w, d } = spec, floors = spec.floors, h = floors * 2.3;
  box(g, w, h + 0.4, d, pick(C.walls), 0, (h - 0.4) / 2, 0);
  const roof = new THREE.Shape();
  roof.moveTo(-d / 2 - 0.35, 0); roof.lineTo(d / 2 + 0.35, 0); roof.lineTo(0, 1.25); roof.closePath();
  const rg = new THREE.ExtrudeGeometry(roof, { depth: w + 0.5, bevelEnabled: false });
  rg.rotateY(Math.PI / 2); rg.translate(-(w + 0.5) / 2, 0, 0);
  part(g, rg, pick(C.roofs), 0, h, 0);
  for (let f = 0; f < floors; f++) windowsRow(g, w * 0.85, f * 2.3 + 1.35, d / 2 + 0.01, floors > 1 && f === 0 ? 1 : 2);
  const doorX = floors > 1 ? w * 0.22 : -w * 0.25;
  box(g, 0.9, 1.75, 0.08, C.door, doorX, 0.88, d / 2 + 0.02);
  box(g, 1.1, 0.08, 0.5, C.metal, doorX, 2.0, d / 2 + 0.25); // door canopy
  if (rng() < 0.7) box(g, 0.7, 0.5, 0.35, C.metal, -w / 2 - 0.2, 0.9, d / 4); // AC unit
  if (rng() < 0.5) box(g, 0.35, 1.0, 0.35, 0x9c8a7a, w * 0.25, h + 0.9, -0.3); // chimney
  blockWall(g, w, d, doorX);
  if (rng() < 0.6) pottedPlant(g, doorX + 0.8, d / 2 + 0.2);
  return { g, doorX, h: h + 1.25 };
}

function apartment(spec) {
  const g = new THREE.Group();
  const { w, d } = spec, floors = spec.floors, fh = 2.2, h = floors * fh;
  box(g, w, h + 0.4, d, pick(C.walls), 0, (h - 0.4) / 2, 0);
  box(g, w + 0.15, 0.25, d + 0.15, C.metal, 0, h + 0.12, 0); // parapet
  for (let f = 0; f < floors; f++) {
    windowsRow(g, w * 0.9, f * fh + 1.25, d / 2 + 0.01, 3, 0.5);
    if (f > 0) {
      box(g, w * 0.92, 0.12, 0.7, C.metal, 0, f * fh + 0.05, d / 2 + 0.35); // balcony slab
      box(g, w * 0.92, 0.55, 0.06, C.frame, 0, f * fh + 0.38, d / 2 + 0.68); // rail
      if (rng() < 0.5) box(g, 0.6, 0.45, 0.3, C.metal, w * 0.36, f * fh + 0.35, d / 2 + 0.45); // AC on balcony
    }
  }
  part(g, new THREE.CylinderGeometry(0.5, 0.5, 0.9, 10), 0xd8d0bc, w * 0.25, h + 0.7, -d * 0.2); // water tank
  box(g, 0.9, 1.8, 0.08, C.door, -w * 0.32, 0.9, d / 2 + 0.02);
  if (rng() < 0.5) part(g, new THREE.CylinderGeometry(0.28, 0.25, 0.7, 8), C.bin, w / 2 - 0.4, 0.35, d / 2 + 0.6);
  return { g, doorX: -w * 0.32, h: h + 1.1 };
}

function shop(spec) {
  const g = new THREE.Group();
  const { w, d } = spec, h = 3.1;
  box(g, w, h + 0.4, d, pick(C.walls), 0, (h - 0.4) / 2, 0);
  box(g, w + 0.15, 0.22, d + 0.15, C.metal, 0, h + 0.1, 0);
  const band = pick(C.sign);
  box(g, w * 0.9, 0.6, 0.1, band, 0, h - 0.45, d / 2 + 0.05); // shop sign band
  box(g, w * 0.6, 0.25, 0.04, C.frame, 0, h - 0.45, d / 2 + 0.11);
  box(g, w * 0.78, 1.6, 0.08, C.glass, 0, 1.1, d / 2 + 0.02); // shop window
  for (let i = 0; i <= 3; i++) box(g, 0.06, 1.6, 0.1, C.frame, -w * 0.39 + (i * w * 0.78) / 3, 1.1, d / 2 + 0.03);
  // Striped awning, as alternating slats.
  const [a, b] = pick(C.awning), n = 10;
  for (let i = 0; i < n; i++) {
    box(g, (w * 0.95) / n, 0.06, 1.0, i % 2 ? b : a, -w * 0.475 + (w * 0.95 * (i + 0.5)) / n, 2.15, d / 2 + 0.45, 0.32);
  }
  vending(g, w / 2 + 0.6, d / 2 - 0.45, 0);
  if (rng() < 0.6) vending(g, w / 2 + 0.6, d / 2 - 1.5, 0);
  return { g, doorX: 0, h: h + 0.3, vend: true };
}

function postOffice(spec) {
  const g = new THREE.Group();
  const { w, d } = spec, h = 3.4;
  box(g, w, h + 0.4, d, 0xf3efe3, 0, (h - 0.4) / 2, 0);
  box(g, w + 0.2, 0.35, d + 0.2, 0xd9534a, 0, h + 0.15, 0);
  box(g, w * 0.8, 1.7, 0.08, C.glass, 0, 1.15, d / 2 + 0.02);
  box(g, 1.2, 2.0, 0.1, 0xd9534a, 0, 1.0, d / 2 + 0.05);
  part(g, new THREE.CylinderGeometry(0.3, 0.3, 1.2, 12), 0xd9534a, w / 2 - 0.6, 0.6, d / 2 + 0.9); // postbox
  part(g, new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xd9534a, w / 2 - 0.6, 1.2, d / 2 + 0.9);
  box(g, 0.34, 0.06, 0.1, 0x3b4145, w / 2 - 0.6, 1.0, d / 2 + 1.2);
  return { g, doorX: 0, h };
}

function tree(s = 1) {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.13 * s, 0.2 * s, 2.2 * s, 7), C.trunk, 0, 1.1 * s, 0);
  const leaf = pick(C.leaf);
  const blobs = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng();
    part(g, new THREE.SphereGeometry(range(0.8, 1.15) * s, 9, 7), leaf, Math.cos(a) * 0.6 * s, range(2.3, 3.0) * s, Math.sin(a) * 0.6 * s);
  }
  part(g, new THREE.SphereGeometry(0.95 * s, 9, 7), leaf, 0, 3.4 * s, 0);
  return g;
}
function bush(s = 1) {
  const g = new THREE.Group();
  const c = pick(C.leaf);
  for (let i = 0; i < 3; i++) part(g, new THREE.SphereGeometry(range(0.4, 0.55) * s, 8, 6), c, (i - 1) * 0.45 * s, 0.35 * s, (rng() - 0.5) * 0.3 * s);
  return g;
}
function pole() {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.11, 0.15, 6.6, 7), C.concrete, 0, 3.3, 0);
  box(g, 1.6, 0.1, 0.12, C.concrete, 0, 6.1, 0);
  box(g, 1.1, 0.1, 0.12, C.concrete, 0, 5.6, 0);
  if (rng() < 0.4) part(g, new THREE.CylinderGeometry(0.25, 0.25, 0.6, 8), 0x9aa3a0, 0.32, 4.9, 0);
  for (const x of [-0.7, 0, 0.7]) part(g, new THREE.CylinderGeometry(0.04, 0.04, 0.12, 5), 0xf3f0e4, x, 6.2, 0);
  return g;
}
function streetSign() {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), C.metal, 0, 1.15, 0);
  part(g, new THREE.CylinderGeometry(0.32, 0.32, 0.05, 16), pick(C.sign), 0, 2.2, 0, Math.PI / 2);
  part(g, new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16), 0xf3f0e4, 0, 2.2, 0.01, Math.PI / 2);
  return g;
}
function bench() {
  const g = new THREE.Group();
  box(g, 1.4, 0.08, 0.45, 0xb98d5f, 0, 0.45, 0);
  box(g, 1.4, 0.4, 0.06, 0xb98d5f, 0, 0.7, -0.2);
  for (const x of [-0.6, 0.6]) box(g, 0.06, 0.45, 0.4, 0x4e5a67, x, 0.22, 0);
  return g;
}

// ---------------------------------------------------------------- post: ink outlines + painted sky

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const POST_FRAG = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor, tNormal, tDepth;
  uniform vec2 res;
  uniform float near, far, time, thickness;
  uniform mat4 invProj;
  uniform mat3 camRot, worldInv;
  uniform vec3 horizon, zenith, cloudShade, cloudLight, ink;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise3(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  float invZ(vec2 uv) { return 1.0 / -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
  vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

  // Sky: a teal gradient with flat painted cloud shapes. Clouds live in the planet's
  // frame, so they drift past as you walk and turn.
  vec3 sky(vec2 uv) {
    vec4 v = invProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dW = normalize(camRot * (v.xyz / v.w));
    vec3 dL = worldInv * dW;
    vec3 c = mix(horizon, zenith, smoothstep(-0.15, 0.7, dW.y));
    vec3 q = dL * vec3(1.7, 3.6, 1.7) + vec3(time * 0.008, 0.0, time * 0.004);
    float n = fbm3(q) + 0.06 * fbm3(q * 4.0);
    // More cloud higher up, clear near the horizon, like a painted backdrop.
    float cover = 0.53 - 0.06 * smoothstep(0.0, 0.6, dW.y);
    c = mix(c, cloudShade, step(cover, n));
    c = mix(c, cloudLight, step(cover + 0.05, n + 0.04 * fbm3(q * 9.0)));
    float h = hash(floor(uv * res / (5.0 * thickness)) + floor(time * 0.25));
    c = mix(c, vec3(1.0), step(0.9991, h) * 0.5);
    return c;
  }

  void main() {
    vec2 px = thickness / res;
    vec2 wob = (vec2(vnoise(vUv * res / 30.0), vnoise(vUv * res / 30.0 + 19.0)) - 0.5) * px * 1.8;
    vec2 uv = vUv + wob;

    float zc = invZ(uv);
    float zl = invZ(uv - vec2(px.x, 0.0)), zr = invZ(uv + vec2(px.x, 0.0));
    float zd = invZ(uv - vec2(0.0, px.y)), zu = invZ(uv + vec2(0.0, px.y));
    // 1/z is affine across a plane, so its Laplacian only fires at silhouettes and creases.
    float lap = abs(zl + zr + zd + zu - 4.0 * zc) / max(zc, 1e-4);
    float depthEdge = smoothstep(0.01, 0.028, lap);

    vec3 nc = nrm(uv);
    float nd = max(max(1.0 - dot(nc, nrm(uv - vec2(px.x, 0.0))), 1.0 - dot(nc, nrm(uv + vec2(px.x, 0.0)))),
                   max(1.0 - dot(nc, nrm(uv - vec2(0.0, px.y))), 1.0 - dot(nc, nrm(uv + vec2(0.0, px.y)))));
    float normalEdge = smoothstep(0.3, 0.5, nd);

    float dist = 1.0 / max(zc, 1e-4);
    float edge = max(depthEdge, normalEdge) * mix(1.0, 0.4, smoothstep(22.0, 70.0, dist));

    float raw = texture2D(tDepth, vUv).x;
    vec3 base;
    if (raw >= 0.99999) base = sky(vUv);
    else base = mix(texture2D(tColor, vUv).rgb, horizon, smoothstep(30.0, 95.0, dist) * 0.45);
    gl_FragColor = vec4(mix(base, ink, edge * 0.9), 1.0);
    #include <colorspace_fragment>
  }`;

// ---------------------------------------------------------------- world

export function createWorld(canvas) {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: false });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  gl.setPixelRatio(dpr);
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  gl.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xe4f6f2, 0x8aa982, 1.25));
  // The sun is fixed relative to the camera (the planet turns under it), so its
  // shadow map only has to cover the neighbourhood around the player.
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  sun.position.set(-16, R + 22, 10);
  sun.target.position.set(0, R, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const world = new THREE.Group(); // the planet and everything on it; walking rotates this
  scene.add(world);
  const noNormals = []; // hidden from the normal pass: sprites, lines, soft shadows
  const batch = new Batch();
  const obstacles = []; // { d, cos, kind: "circle", r } | { d, cos, kind: "rect", right, front, hw, hd }
  const addresses = []; // doors: { dir, markerDir, spin, kind }
  const taken = []; // { d, r } footprint circles, for placement

  const frameAt = (dir, spin) => {
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin));
    return q;
  };
  function spinToward(dir, toward) {
    const t = toward.clone().sub(dir.clone().multiplyScalar(dir.dot(toward)));
    if (t.lengthSq() < 1e-10) return 0;
    t.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    return Math.atan2(t.dot(right), t.dot(front));
  }
  /// Bake a prop group into the town mesh at `dir`.
  function bake(g, dir, spin = 0, lift = 0) {
    g.position.copy(dir).multiplyScalar(R + lift);
    g.quaternion.copy(frameAt(dir, spin));
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (o.isMesh) batch.add(o.geometry, o.matrixWorld, o.material.color);
    });
    g.traverse((o) => o.geometry?.dispose());
  }
  function addRect(dir, spin, hw, hd) {
    const q = frameAt(dir, spin);
    obstacles.push({
      d: dir, kind: "rect", hw, hd,
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(q), front: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
      cos: Math.cos((Math.hypot(hw, hd) + 1) / R),
    });
  }
  function addCircle(dir, r) {
    obstacles.push({ d: dir, kind: "circle", r, cos: Math.cos((r + 1) / R) });
  }
  const clearOf = (d, r) => taken.every((t) => arc(d, t.d) > t.r + r);

  // ---- ground
  {
    const geo = new THREE.IcosahedronGeometry(R, 48);
    const pos = geo.attributes.position, col = [];
    const v = new THREE.Vector3(), c = new THREE.Color();
    const g1 = new THREE.Color(C.grass), g2 = new THREE.Color(C.grass2);
    const patch = (p) => Math.sin(p.x * 9.1 + 1.7) * Math.sin(p.y * 8.7 + 0.3) * Math.sin(p.z * 9.3 + 2.1)
      + 0.5 * Math.sin(p.x * 23.3) * Math.sin(p.y * 21.1 + 1) * Math.sin(p.z * 22.7 + 0.5);
    for (let i = 0; i < pos.count; i += 3) {
      // Colour per face so the cel bands stay flat; patches come from low-frequency noise.
      v.fromBufferAttribute(pos, i).normalize();
      c.copy(patch(v) > 0.15 ? g2 : g1);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    // Smooth normals: a sphere's normal is just its position.
    const nrm = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      nrm.push(v.x, v.y, v.z);
    }
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    const ground = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    ground.receiveShadow = true;
    world.add(ground);
  }

  // ---- streets: asphalt, raised sidewalks with curbs, lane dashes, crosswalks
  const wireSegs = [];
  {
    const asphalt = new THREE.Color(C.asphalt), paint = new THREE.Color(C.paint), walkC = new THREE.Color(C.walk), curbC = new THREE.Color(C.curb);
    const SEG = 480;
    ROADS.forEach((road, ri) => {
      let poleRun = null, lastNear = Infinity;
      for (let i = 0; i < SEG; i++) {
        const t0 = (i / SEG) * Math.PI * 2, t1 = ((i + 1) / SEG) * Math.PI * 2;
        const p0 = road.point(t0), p1 = road.point(t1);
        const s0 = new THREE.Vector3().crossVectors(p0, road.tangent(t0)).normalize();
        const s1 = new THREE.Vector3().crossVectors(p1, road.tangent(t1)).normalize();
        const at = (p, s, off, h) => offsetOnSphere(p, s, off).multiplyScalar(R + h);
        // Asphalt, in narrow strips so the flat quads follow the planet's curve.
        for (let k = 0; k < 4; k++) {
          const a = -ROAD_HW + (k * ROAD_HW) / 2, b = a + ROAD_HW / 2;
          batch.quad(at(p0, s0, a, road.h), at(p0, s0, b, road.h), at(p1, s1, b, road.h), at(p1, s1, a, road.h), asphalt);
        }
        const near = nearestRoad(p0, ri);
        // Sidewalks stop where another street crosses.
        if (near > ROAD_HW + WALK + 0.2) {
          for (const sg of [1, -1]) {
            const a = ROAD_HW * sg, b = (ROAD_HW + WALK) * sg, top = 0.16;
            batch.quad(at(p0, s0, a, top), at(p0, s0, b, top), at(p1, s1, b, top), at(p1, s1, a, top), walkC);
            // Curb faces: one toward the road, one toward the yards.
            batch.quad(at(p0, s0, a, 0), at(p0, s0, a, top), at(p1, s1, a, top), at(p1, s1, a, 0), curbC, s0.clone().multiplyScalar(-sg));
            batch.quad(at(p0, s0, b, -0.05), at(p0, s0, b, top), at(p1, s1, b, top), at(p1, s1, b, -0.05), curbC, s0.clone().multiplyScalar(sg));
          }
        }
        // Lane dashes, kept out of junctions.
        if (i % 4 < 2 && near > ROAD_HW + WALK + 2.2) {
          batch.quad(at(p0, s0, -0.08, road.h + 0.01), at(p0, s0, 0.08, road.h + 0.01), at(p1, s1, 0.08, road.h + 0.01), at(p1, s1, -0.08, road.h + 0.01), paint);
        }
        // Zebra crossing on the approach to each junction.
        const X = ROAD_HW + WALK + 1.6;
        if ((lastNear > X && near <= X) || (lastNear <= X && near > X)) {
          const mid = p0.clone().add(p1).normalize(), s = s0;
          const tan = road.tangent(t0);
          for (let k = -4; k <= 4; k++) {
            const c = offsetOnSphere(mid, s, k * 0.34);
            const a = c.clone().multiplyScalar(R).addScaledVector(tan, -0.55), b = c.clone().multiplyScalar(R).addScaledVector(tan, 0.55);
            const n = s.clone().multiplyScalar(0.1);
            const lift = (p) => p.normalize().multiplyScalar(R + road.h + 0.012);
            batch.quad(lift(a.clone().sub(n)), lift(a.clone().add(n)), lift(b.clone().add(n)), lift(b.clone().sub(n)), paint);
          }
        }
        lastNear = near;
        // Utility poles every few metres on one side, wired together.
        if (i % 14 === 7) {
          if (near > ROAD_HW + WALK + 2.5) {
            const d = offsetOnSphere(p0, s0, ROAD_HW + WALK - 0.25);
            const spin = spinToward(d, p1); // crossarm (local x) spans across the street
            bake(pole(), d, spin);
            addCircle(d, 0.2);
            taken.push({ d, r: 0.4 });
            const top = d.clone().multiplyScalar(R + 6.25);
            const across = new THREE.Vector3(1, 0, 0).applyQuaternion(frameAt(d, spin));
            const tops = [-0.7, 0, 0.7].map((x) => top.clone().addScaledVector(across, x));
            if (poleRun) for (let k = 0; k < 3; k++) wireSegs.push([poleRun[k], tops[k]]);
            poleRun = tops;
          } else poleRun = null;
        }
        if (i % 37 === 11 && near > ROAD_HW + WALK + 3) {
          const d = offsetOnSphere(p0, s0, -(ROAD_HW + WALK - 0.3));
          bake(streetSign(), d, spinToward(d, p0.clone().addScaledVector(road.tangent(t0), -1)));
          addCircle(d, 0.12);
          taken.push({ d, r: 0.4 });
        }
      }
    });
  }
  // Wires sag toward the planet between poles; one line-segments mesh for all.
  {
    const pts = [];
    for (const [a, b] of wireSegs) {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const sag = mid.clone().normalize().multiplyScalar(mid.length() - 0.6);
      const curve = new THREE.QuadraticBezierCurve3(a, sag, b).getPoints(10);
      for (let i = 0; i < curve.length - 1; i++) pts.push(curve[i], curve[i + 1]);
    }
    const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: C.wire }));
    world.add(wires);
    noNormals.push(wires);
  }

  // ---- spawn and post office: a quiet stretch of the first street
  let spawn;
  {
    const road = ROADS[0];
    let best = null;
    for (let i = 0; i < 360; i++) {
      const t = (i / 360) * Math.PI * 2, p = road.point(t);
      const score = nearestRoad(p, 0);
      if (!best || score > best.score) best = { t, p, score };
    }
    const tan = road.tangent(best.t), side = new THREE.Vector3().crossVectors(best.p, tan).normalize();
    const spec = { w: 6, d: 4.6 };
    const d = offsetOnSphere(best.p, side, ROAD_HW + WALK + 0.45 + spec.d / 2);
    const spin = spinToward(d, best.p);
    const { g, doorX } = postOffice(spec);
    bake(g, d, spin);
    addRect(d, spin, spec.w / 2, spec.d / 2);
    taken.push({ d, r: 3.6 });
    // A sign the ink pass can outline, kept as its own textured mesh.
    const c = document.createElement("canvas"); c.width = 256; c.height = 64;
    const sg = c.getContext("2d");
    sg.fillStyle = "#d9534a"; sg.fillRect(0, 0, 256, 64);
    sg.fillStyle = "#fbf6ea"; sg.font = "700 40px Bungee, Impact, sans-serif"; sg.textAlign = "center"; sg.textBaseline = "middle";
    sg.fillText("POST", 128, 35);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: texFromCanvas(c) }));
    sign.position.copy(d).multiplyScalar(R);
    sign.quaternion.copy(frameAt(d, spin));
    sign.translateY(3.0); sign.translateZ(spec.d / 2 + 0.06);
    world.add(sign);
    const q = frameAt(d, spin);
    const door = d.clone().multiplyScalar(R).add(new THREE.Vector3(doorX, 0, spec.d / 2 + 1.3).applyQuaternion(q)).normalize();
    spawn = { dir: offsetOnSphere(best.p, side, -0.4), tangent: tan, post: door, postSpin: spin };
  }

  // ---- buildings along every street
  {
    const kinds = [
      { f: house, w: [3.6, 4.4], d: [3.4, 3.8], floors: [1, 2], p: 0.42 },
      { f: apartment, w: [4.6, 5.4], d: [3.8, 4.2], floors: [2, 3], p: 0.28 },
      { f: shop, w: [4.2, 4.8], d: [3.6, 3.8], floors: [1, 1], p: 0.3 },
    ];
    const pickKind = () => {
      let r = rng();
      for (const k of kinds) if ((r -= k.p) <= 0) return k;
      return kinds[0];
    };
    ROADS.forEach((road, ri) => {
      for (const sg of [1, -1]) {
        let s = rng() * 3;
        const L = Math.PI * 2 * R;
        while (s < L) {
          const t = s / R, p = road.point(t), tan = road.tangent(t);
          const side = new THREE.Vector3().crossVectors(p, tan).normalize().multiplyScalar(sg);
          const k = pickKind();
          const spec = { w: range(...k.w), d: range(...k.d), floors: Math.round(range(k.floors[0], k.floors[1])) };
          const extra = k.f === shop ? 1.3 : 0; // room for vending machines
          const dir = offsetOnSphere(p, side, ROAD_HW + WALK + 0.65 + spec.d / 2);
          const r = Math.hypot(spec.w + extra, spec.d) / 2;
          if (nearestRoad(dir, ri) > ROAD_HW + WALK + 0.3 + r && clearOf(dir, r * 0.92)) {
            const spin = spinToward(dir, p);
            const b = k.f(spec);
            bake(b.g, dir, spin);
            addRect(dir, spin, spec.w / 2 + 0.05, spec.d / 2 + 0.6);
            if (extra) {
              const q = frameAt(dir, spin);
              addCircle(dir.clone().multiplyScalar(R).add(new THREE.Vector3(spec.w / 2 + 0.6, 0, spec.d / 2 - 0.9).applyQuaternion(q)).normalize(), 0.65);
            }
            taken.push({ d: dir, r });
            const q = frameAt(dir, spin);
            const doorLocal = new THREE.Vector3(b.doorX, 0, spec.d / 2 + 1.25);
            addresses.push({
              dir: dir.clone().multiplyScalar(R).add(doorLocal.clone().applyQuaternion(q)).normalize(),
              markerDir: dir.clone().multiplyScalar(R).add(new THREE.Vector3(b.doorX, 0, spec.d / 2 + 0.3).applyQuaternion(q)).normalize(),
              markerH: Math.min(b.h, 4.2) + 0.9,
              spin, kind: k.f.name,
            });
            s += spec.w + extra + range(0.5, 1.4);
          } else s += 1.3;
        }
      }
    });
  }

  // ---- parks: trees, bushes and benches fill the blocks between streets
  for (let n = 0, placed = 0; placed < 260 && n < 9000; n++) {
    const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    if (nearestRoad(d) < ROAD_HW + WALK + 0.9 || !clearOf(d, 0.9)) continue;
    const roll = rng();
    if (roll < 0.62) {
      const s = range(0.8, 1.2);
      bake(tree(s), d, rng() * 6);
      addCircle(d, 0.3 * s);
      taken.push({ d, r: 1.1 * s });
    } else if (roll < 0.94) {
      bake(bush(range(0.8, 1.3)), d, rng() * 6);
      taken.push({ d, r: 0.8 });
    } else {
      const sp = rng() * 6;
      bake(bench(), d, sp);
      addRect(d, sp, 0.75, 0.3);
      taken.push({ d, r: 0.9 });
    }
    placed++;
  }

  const town = batch.build(toon(0xffffff, { vertexColors: true }));
  world.add(town);

  // ---- grass tufts: tiny instanced blades that the ink pass turns into hatching
  {
    const N = 6000;
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.24, 3), toon(C.tuft), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
    let n = 0;
    for (let tries = 0; n < N && tries < N * 4; tries++) {
      const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      if (nearestRoad(d) < ROAD_HW + WALK + 0.15 || !clearOf(d, 0.05)) continue;
      for (let b = 0; b < 3 && n < N; b++, n++) {
        q.setFromUnitVectors(UP, d).multiply(new THREE.Quaternion().setFromEuler(e.set((rng() - 0.5) * 0.9, rng() * 6, (rng() - 0.5) * 0.9)));
        const k = range(0.7, 1.3);
        m.compose(d.clone().multiplyScalar(R + 0.08), q, sc.set(k, k * range(0.8, 1.4), k));
        tufts.setMatrixAt(n, m);
      }
    }
    tufts.count = n;
    tufts.receiveShadow = true;
    world.add(tufts);
  }

  // ---------------------------------------------------------------- rendering

  const colorRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
  const normalRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const normalMat = new THREE.MeshNormalMaterial();
  const post = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: POST_FRAG,
    uniforms: {
      tColor: { value: colorRT.texture },
      tNormal: { value: normalRT.texture },
      tDepth: { value: colorRT.depthTexture },
      res: { value: new THREE.Vector2(1, 1) },
      near: { value: camera.near },
      far: { value: camera.far },
      time: { value: 0 },
      thickness: { value: dpr * 1.15 },
      invProj: { value: new THREE.Matrix4() },
      camRot: { value: new THREE.Matrix3() },
      worldInv: { value: new THREE.Matrix3() },
      horizon: { value: new THREE.Color(0xa9ded2) },
      zenith: { value: new THREE.Color(0x6fbcbc) },
      cloudShade: { value: new THREE.Color(0x93d2c8) },
      cloudLight: { value: new THREE.Color(0xd5efe6) },
      ink: { value: new THREE.Color(0x283033) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    gl.setSize(w, h, false);
    colorRT.setSize(Math.round(w * dpr), Math.round(h * dpr));
    normalRT.setSize(Math.round(w * dpr), Math.round(h * dpr));
    post.uniforms.res.value.set(Math.round(w * dpr), Math.round(h * dpr));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const rot4 = new THREE.Matrix4();
  function render(t) {
    camera.updateMatrixWorld();
    world.updateMatrixWorld();
    post.uniforms.time.value = t;
    post.uniforms.invProj.value.copy(camera.projectionMatrixInverse);
    post.uniforms.camRot.value.setFromMatrix4(rot4.extractRotation(camera.matrixWorld));
    post.uniforms.worldInv.value.setFromMatrix4(rot4.extractRotation(world.matrixWorld)).transpose();

    // 1) colour + depth (with shadows), 2) view-space normals, 3) ink + sky composite.
    gl.shadowMap.needsUpdate = true;
    gl.setRenderTarget(colorRT);
    gl.render(scene, camera);
    for (const o of noNormals) o.visible = false;
    scene.overrideMaterial = normalMat;
    gl.setRenderTarget(normalRT);
    gl.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of noNormals) o.visible = true;
    gl.setRenderTarget(null);
    gl.render(postScene, postCam);
  }

  return { scene, camera, world, render, obstacles, addresses, spawn, noNormals, frameAt, nearestRoad };
}
