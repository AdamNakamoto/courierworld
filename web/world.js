// A tiny planet town drawn like an anime background: cel shading, hand-inked
// outlines from a post pass over depth and normals, and a teal sky with flat clouds.
// Everything static is baked into one vertex-coloured mesh so the town stays cheap.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { createTerrain, SEA_LEVEL, KERB } from "./terrain.js";
import { buildBiomes } from "./biomes.js";
import { WATER } from "./water.js";
import { createDust } from "./fx.js";

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
  sign: [0x5d8fd1, 0xe46f5f], pot: 0xb5734f, bin: 0x4f86c6, lamp: 0xfff1c9,
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

// Cutaway: anything between the camera and the courier is cut through along the line of sight, so
// trees and walls never hide them. Shared by every material (and the normal pass) so the ink outlines
// agree; the ground and anything near it are never cut.
// Leaves sway in the wind the same way (by a per-vertex "sway" weight only foliage has).
const CUT = {
  cutCam: { value: new THREE.Vector3() }, cutTarget: { value: new THREE.Vector3() }, cutR: { value: 0 }, windTime: { value: 0 },
};
function cutaway(material) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, CUT);
    // Declared just before main(): not every built-in shader includes <common> (the normal one doesn't).
    sh.vertexShader = sh.vertexShader
      .replace("void main() {", "varying vec3 vCutWorld;\nattribute float sway;\nuniform float windTime;\nvoid main() {")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        if (sway > 0.0) {
          float ph = dot(transformed, vec3(0.37, 0.21, 0.29));
          vec3 n = normalize(transformed);
          vec3 ta = normalize(cross(n, vec3(0.0, 1.0, 0.3))), tb = cross(n, ta);
          transformed += (ta * sin(windTime * 1.5 + ph) + tb * 0.6 * sin(windTime * 1.1 + ph * 1.7)) * 0.07 * sway;
        }`)
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec4 cutW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutW = instanceMatrix * cutW;
        #endif
        vCutWorld = (modelMatrix * cutW).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("void main() {", `varying vec3 vCutWorld;
      uniform vec3 cutCam, cutTarget;
      uniform float cutR;
      void main() {
        if (cutR > 0.0 && length(vCutWorld) > ${(R + 0.3).toFixed(2)}) {
          vec3 ab = cutTarget - cutCam;
          float h = dot(vCutWorld - cutCam, ab) / dot(ab, ab);
          float r = cutR * smoothstep(0.06, 0.3, h) * (1.0 - smoothstep(0.66, 0.84, h));
          if (length(vCutWorld - cutCam - ab * clamp(h, 0.0, 1.0)) < r) discard;
        }`);
  };
  return material;
}
export const toon = (color, extra = {}) => cutaway(new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, ...extra }));

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
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.sway = []; this.idx = []; this.n = 0; }
  /// leafy: the mesh sways in the wind, the more the higher it is off the ground.
  add(geo, matrix, color, leafy = false) {
    const p = geo.attributes.position, nAttr = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      this.sway.push(leafy ? 0.2 + 0.8 * Math.min(1, Math.max(0, (v.length() - R - 1.5) / 2)) : 0);
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
      this.sway.push(0);
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
    if (this.sway.some((w) => w > 0)) g.setAttribute("sway", new THREE.Float32BufferAttribute(this.sway, 1));
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
  uniform float stars, overcast;
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
    // Stars, fixed to the planet's sky, fading in at night behind the clouds.
    c = mix(c, vec3(1.0, 0.96, 0.86), step(0.9978, hash3(floor(dL * 240.0))) * stars);
    vec3 q = dL * vec3(1.7, 3.6, 1.7) + vec3(time * 0.008, 0.0, time * 0.004);
    float n = fbm3(q) + 0.06 * fbm3(q * 4.0);
    // More cloud higher up, clear near the horizon, like a painted backdrop.
    float cover = 0.53 - 0.06 * smoothstep(0.0, 0.6, dW.y) - 0.16 * overcast;
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
    // Over the sky the colour pass is black except for additive rain streaks, which show through.
    if (raw >= 0.99999) base = sky(vUv) + texture2D(tColor, vUv).rgb;
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
  const hemi = new THREE.HemisphereLight(0xe4f6f2, 0x8aa982, 1.25);
  scene.add(hemi);
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
  // About two windows in three light up at night; they're baked into their own mesh so they can glow.
  // A separate random stream, so the town's layout stays exactly the same.
  const litBatch = new Batch();
  const litRng = mulberry32(4041);
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
      if (!o.isMesh) return;
      const lit = o.material === tm(C.lamp) || (o.material === tm(C.glass) && litRng() < 0.65);
      (lit ? litBatch : batch).add(o.geometry, o.matrixWorld, o.material.color, C.leaf.some((c) => o.material === tm(c)));
    });
    g.traverse((o) => o.geometry?.dispose());
  }
  /// A solid footprint; buildings also say how tall they are and how deep the walls really are
  /// (hd includes the doorstep), so the camera can keep clear of them.
  /// opts: { y0, y1 } solid only for feet between those heights (railings up on a deck, cliffs
  /// below their top); except: a staircase cut through it; wall: as above, for circles.
  function addRect(dir, spin, hw, hd, wall = null, opts = {}) {
    const q = frameAt(dir, spin);
    obstacles.push({
      d: dir, kind: "rect", hw, hd, wall, ...opts,
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(q), front: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
      cos: Math.cos((Math.hypot(hw, hd) + 1) / R),
    });
  }
  function addCircle(dir, r, opts = {}) {
    obstacles.push({ d: dir, kind: "circle", r, ...opts, cos: Math.cos((r + 1) / R) });
  }
  const clearOf = (d, r) => taken.every((t) => arc(d, t.d) > t.r + r);

  // The post office goes on the quietest stretch of the first street, and the other places are laid
  // out round it, so find it first.
  const spawnSpot = (() => {
    const road = ROADS[0];
    let best = null;
    for (let i = 0; i < 360; i++) {
      const t = (i / 360) * Math.PI * 2, p = road.point(t);
      const score = nearestRoad(p, 0);
      if (!best || score > best.score) best = { t, p, score };
    }
    return { ...best, tan: road.tangent(best.t) };
  })();
  const terrain = createTerrain({ R, ROADS, ROAD_HW, WALK, nearestRoad, spawnDir: spawnSpot.p, spawnTan: spawnSpot.tan });
  /// Whether a spot (with room r round it) is taken by something solid, or under water.
  function blocked(d, r) {
    if (terrain.waterAt(d) !== null) return true;
    return obstacles.some((o) => {
      if (d.dot(o.d) < o.cos) return false;
      if (o.kind === "circle") return arc(d, o.d) < o.r + r;
      const v = d.clone().sub(o.d).multiplyScalar(R);
      return Math.abs(v.dot(o.right)) < o.hw + r && Math.abs(v.dot(o.front)) < o.hd + r;
    });
  }
  /// Whether there's sand or water within r of a spot (no houses or parks there).
  const wetNear = (d, r) => {
    if (terrain.sandAt(d)) return true;
    const t1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0.3, 1, 0.2)).normalize(), t2 = new THREE.Vector3().crossVectors(d, t1);
    for (let i = 0; i < 6; i++) {
      const p = d.clone().multiplyScalar(R).addScaledVector(t1, Math.cos(i) * r).addScaledVector(t2, Math.sin(i) * r).normalize();
      if (terrain.sandAt(p)) return true;
    }
    return false;
  };
  const inTown = (d) => terrain.zoneAt(d).key === "town";
  // The footbridge goes on the nearest long, quiet stretch of a town street (chosen now, so the
  // street lamps leave room for it).
  const footbridge = (() => {
    let best = null;
    ROADS.forEach((road, ri) => {
      for (let i = 0; i < 720; i++) {
        const t = (i / 720) * Math.PI * 2, p = road.point(t), far = arc(p, spawnSpot.p);
        if (far < 8 || far > 32 || nearestRoad(p, ri) < 9.5 || !inTown(p) || terrain.deckAt(ri, t) > 0) continue;
        if (!best || far < best.far) best = { ri, t, p, far };
      }
    });
    return best;
  })();

  // ---- ground
  {
    const geo = new THREE.IcosahedronGeometry(R, 48);
    const pos = geo.attributes.position, col = [];
    const v = new THREE.Vector3(), c = new THREE.Color();
    const g1 = new THREE.Color(C.grass), g2 = new THREE.Color(C.grass2);
    const sand = new THREE.Color(0xeadcb4), wetSand = new THREE.Color(0xd6c497), seabed = new THREE.Color(0xc4b48c);
    const woods1 = new THREE.Color(0x5f9a52), woods2 = new THREE.Color(0x4f8946), dirt = new THREE.Color(0x9c8460);
    const concrete = new THREE.Color(0xb8bab1), dryGrass = new THREE.Color(0xa3b878);
    const patch = (p) => Math.sin(p.x * 9.1 + 1.7) * Math.sin(p.y * 8.7 + 0.3) * Math.sin(p.z * 9.3 + 2.1)
      + 0.5 * Math.sin(p.x * 23.3) * Math.sin(p.y * 21.1 + 1) * Math.sin(p.z * 22.7 + 0.5);
    const m = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      // Colour per face so the cel bands stay flat; patches come from low-frequency noise.
      m.set(0, 0, 0);
      for (let k = 0; k < 3; k++) m.add(v.fromBufferAttribute(pos, i + k));
      m.normalize();
      const n = patch(m), zone = terrain.zoneAt(m).key;
      if (terrain.sandAt(m)) {
        const h = terrain.landAt(m);
        c.copy(h < SEA_LEVEL - 0.05 ? seabed : h < -0.04 ? wetSand : sand);
      } else if (zone === "woods") c.copy(n > 0.55 ? dirt : n > 0.1 ? woods2 : woods1);
      else if (zone === "works") c.copy(n > -0.1 ? concrete : dryGrass);
      else c.copy(n > 0.15 ? g2 : g1);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    // Down into the sea, the pond and the river.
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      v.multiplyScalar(R + terrain.landAt(v));
      pos.setXYZ(i, v.x, v.y, v.z);
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
  const lamps = []; // where each street lamp hangs (unit vectors)
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
        // Over water the street becomes a bridge, ramping up from just before the shore.
        const d0 = terrain.deckAt(ri, t0), d1 = terrain.deckAt(ri, t1), bridge = d0 > road.h + 0.005 || d1 > road.h + 0.005;
        const h0 = bridge ? Math.max(road.h, d0) : road.h, h1 = bridge ? Math.max(road.h, d1) : road.h;
        // Asphalt, in narrow strips so the flat quads follow the planet's curve.
        for (let k = 0; k < 4; k++) {
          const a = -ROAD_HW + (k * ROAD_HW) / 2, b = a + ROAD_HW / 2;
          batch.quad(at(p0, s0, a, h0), at(p0, s0, b, h0), at(p1, s1, b, h1), at(p1, s1, a, h1), asphalt);
        }
        const near = nearestRoad(p0, ri);
        const zone = terrain.zoneAt(p0).key;
        if (bridge) {
          // The deck carries kerb-high walkways across (level with the sidewalks it starts from),
          // with a railing each side once it's off the ground, and piers down to the water.
          const k0 = h0 + KERB, k1 = h1 + KERB, railed = Math.max(h0, h1) > road.h + 0.15;
          for (const sg of [1, -1]) {
            const a = ROAD_HW * sg, b = (ROAD_HW + WALK) * sg;
            batch.quad(at(p0, s0, a, k0), at(p0, s0, b, k0), at(p1, s1, b, k1), at(p1, s1, a, k1), walkC);
            batch.quad(at(p0, s0, a, h0), at(p0, s0, a, k0), at(p1, s1, a, k1), at(p1, s1, a, h1), curbC, s0.clone().multiplyScalar(-sg));
            batch.quad(at(p0, s0, b, h0 - 0.4), at(p0, s0, b, k0), at(p1, s1, b, k1), at(p1, s1, b, h1 - 0.4), curbC, s0.clone().multiplyScalar(sg));
            if (railed) {
              const r = ROAD_HW + WALK - 0.06;
              batch.quad(at(p0, s0, r * sg, k0 + 0.9), at(p0, s0, (r - 0.1) * sg, k0 + 0.9), at(p1, s1, (r - 0.1) * sg, k1 + 0.9), at(p1, s1, r * sg, k1 + 0.9), curbC);
              batch.quad(at(p0, s0, r * sg, k0 + 0.45), at(p0, s0, (r - 0.08) * sg, k0 + 0.45), at(p1, s1, (r - 0.08) * sg, k1 + 0.45), at(p1, s1, r * sg, k1 + 0.45), curbC);
              if (i % 3 === 0) {
                const post = new THREE.Group();
                box(post, 0.08, 0.9, 0.08, C.curb, 0, 0.45, 0);
                bake(post, offsetOnSphere(p0, s0, r * sg), 0, k0);
                // Solid while you're on the deck, but a jump clears it.
                const rail = offsetOnSphere(p0, s0, r * sg);
                addRect(rail, spinToward(rail, offsetOnSphere(p1, s1, r * sg)), 0.08, 0.6, null, { y0: h0 - 0.3, y1: k0 + 0.5 });
              }
            }
          }
          if (i % 8 === 4 && h0 > 0.35) {
            for (const sg of [1, -1]) {
              const d = offsetOnSphere(p0, s0, (ROAD_HW + 0.6) * sg), floor = terrain.landAt(d);
              const pier = new THREE.Group();
              part(pier, new THREE.CylinderGeometry(0.22, 0.26, h0 - floor, 8), C.concrete, 0, (h0 - floor) / 2 - 0.2, 0);
              bake(pier, d, 0, floor);
              addCircle(d, 0.26, { y1: h0 - 0.4 }); // in the way of anyone swimming underneath
            }
          }
        } else if (near > ROAD_HW + WALK + 0.2) {
          // Sidewalks stop where another street crosses.
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
          batch.quad(at(p0, s0, -0.08, h0 + 0.01), at(p0, s0, 0.08, h0 + 0.01), at(p1, s1, 0.08, h1 + 0.01), at(p1, s1, -0.08, h1 + 0.01), paint);
        }
        // Zebra crossing on the approach to each junction.
        const X = ROAD_HW + WALK + 1.6;
        if (!bridge && ((lastNear > X && near <= X) || (lastNear <= X && near > X))) {
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
        // Utility poles every few metres on one side, wired together (in town and at the works).
        const poleSpot = offsetOnSphere(p0, s0, ROAD_HW + WALK - 0.25);
        const byFootbridge = footbridge && arc(p0, footbridge.p) < 3.2;
        if (i % 14 === 7) {
          if (near > ROAD_HW + WALK + 2.5 && !bridge && !byFootbridge && (zone === "town" || zone === "works") && !wetNear(poleSpot, 1.5)) {
            const d = poleSpot;
            const spin = spinToward(d, p1); // crossarm (local x) spans across the street
            bake(pole(), d, spin);
            addCircle(d, 0.2);
            // A street lamp reaching out over the road; at night it lights a pool on the ground.
            const arm = offsetOnSphere(p0, s0, ROAD_HW + WALK - 0.7), head = offsetOnSphere(p0, s0, ROAD_HW + WALK - 1.15);
            const ga = new THREE.Group();
            box(ga, 0.07, 0.07, 0.95, C.concrete, 0, 0, 0);
            bake(ga, arm, spinToward(arm, p0), 4.75);
            const gh = new THREE.Group();
            box(gh, 0.26, 0.1, 0.4, 0x4e5a67, 0, 0, 0);
            box(gh, 0.2, 0.04, 0.32, C.lamp, 0, -0.06, 0);
            bake(gh, head, spinToward(head, p0), 4.72);
            lamps.push(head);
            taken.push({ d, r: 0.4 });
            const top = d.clone().multiplyScalar(R + 6.25);
            const across = new THREE.Vector3(1, 0, 0).applyQuaternion(frameAt(d, spin));
            const tops = [-0.7, 0, 0.7].map((x) => top.clone().addScaledVector(across, x));
            if (poleRun) for (let k = 0; k < 3; k++) wireSegs.push([poleRun[k], tops[k]]);
            poleRun = tops;
          } else poleRun = null;
        }
        if (i % 37 === 11 && near > ROAD_HW + WALK + 3 && !bridge && !byFootbridge && zone === "town") {
          const d = offsetOnSphere(p0, s0, -(ROAD_HW + WALK - 0.3));
          if (!wetNear(d, 1)) {
            bake(streetSign(), d, spinToward(d, p0.clone().addScaledVector(road.tangent(t0), -1)));
            addCircle(d, 0.12);
            taken.push({ d, r: 0.4 });
          }
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
    const best = spawnSpot;
    const tan = best.tan, side = new THREE.Vector3().crossVectors(best.p, tan).normalize();
    const spec = { w: 6, d: 4.6 };
    const d = offsetOnSphere(best.p, side, ROAD_HW + WALK + 0.45 + spec.d / 2);
    const spin = spinToward(d, best.p);
    const { g, doorX } = postOffice(spec);
    bake(g, d, spin);
    addRect(d, spin, spec.w / 2, spec.d / 2, { h: 4.2, hd: spec.d / 2 });
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
    spawn = { dir: offsetOnSphere(best.p, side, -0.4), tangent: tan, post: door, postSpin: spin, office: { d, spin, hd: spec.d / 2 } };
  }

  // ---- the seaside, Falls Hill, the woods, the works and the footbridge (before the houses, so
  // the houses keep out of their way)
  const npcs = [], stampSpots = [], animators = [], ambient = {};
  const spray = createDust(world, noNormals, 70, 0xffffff);
  const smoke = createDust(world, noNormals, 40, 0xd9d5cc);
  buildBiomes({
    R, C, ROADS, ROAD_HW, WALK, terrain, world, noNormals, spawn, footbridge, rng: mulberry32(1357),
    part, box, tm, toon, texFromCanvas, bake, frameAt, spinToward, offsetOnSphere, nearestRoad,
    addRect, addCircle, taken, clearOf, blocked, ambient,
    /// Bake a group whose parts are already placed in planet space.
    bakeAt(g) {
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        if (o.isMesh) batch.add(o.geometry, o.matrixWorld, o.material.color);
      });
      g.traverse((o) => o.geometry?.dispose());
    },
    landmark(a) {
      addresses.push({ ...a, landmark: true });
    },
    npc: (spot) => npcs.push(spot),
    stampSpot: (d, y) => stampSpots.push({ d, y }),
    ramp: (...a) => terrain.addRamp(...a),
    plate: (p) => terrain.addPlate(p),
    animate: (fn) => animators.push(fn),
    spray: (pos, up) => spray.puff(pos, up, { n: 1, size: 0.5, spread: 0.9, life: 0.8 }),
    smoke: (pos, up) => smoke.puff(pos, up, { n: 1, size: 1.1, spread: 0.2, life: 4, rise: 1.1, grow: 2.4 }),
  });

  // ---- Adam and his dog, outside the main post office
  {
    const { d, spin, hd } = spawn.office, q = frameAt(d, spin);
    const at = (x, z) => d.clone().multiplyScalar(R).add(new THREE.Vector3(x, 0, z).applyQuaternion(q)).normalize();
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const adam = at(-2.1, hd + 0.75), dog = at(-2.85, hd + 0.95); // the other side of the door from the post box
    npcs.push({
      d: adam, y: terrain.surfaceAt(adam, 1.5), face, name: "Adam", own: true, hi: ["gm!", "gm, courier!", "Hey!"],
      look: { skin: 0xf1dcc0, hair: 0x3d2a22, hairStyle: "bob", headwear: "bandana", accent: 0x5fb2dd, collar: 0xf4f1ea, glasses: "shades", earring: true,
        shirt: 0xf4f1ea, bottoms: 0x4b5d7a, bottomsStyle: "pants", shoes: 0xf4f1ea, bag: "none", height: 1 },
      lines: [
        "gm, courier! Every letter on this planet finds its way home. Yours just get there faster.",
        "Everyone here has an identity. Mine's mostly sunglasses.",
        "Small planet, big ideas. I like it here.",
        "Every time someone opens a post office, the town grows a little. Have you seen the new lots?",
        "DOg PEt follows me everywhere. Well. Sits next to me everywhere.",
      ],
    });
    npcs.push({
      d: dog, y: terrain.surfaceAt(dog, 1.5), face, name: "DOg PEt", kind: "dog", own: true, hi: ["Woof!", "Arf!", "Woof woof!"],
      lines: [
        "Woof! (DOg PEt sniffs your bag. One of the letters smells of biscuits.)",
        "Arf! (It sits up very straight, guarding the post office. Good dog.)",
        "Woof woof! (It nudges your hand for a pat. Its tail goes even faster.)",
        "(DOg PEt yawns, turns round twice and flops down by Adam's feet.)",
      ],
    });
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
          if (nearestRoad(dir, ri) > ROAD_HW + WALK + 0.3 + r && clearOf(dir, r * 0.92) && inTown(dir) && !wetNear(dir, r + 0.6)) {
            const spin = spinToward(dir, p);
            const b = k.f(spec);
            bake(b.g, dir, spin);
            addRect(dir, spin, spec.w / 2 + 0.05, spec.d / 2 + 0.6, { h: b.h, hd: spec.d / 2 + 0.1 });
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

  // ---- lots for the players' post offices: paved clearings facing a street, nearest the main post office
  // first. The strongest offices on the leaderboard move in (district.js builds them); empty ones get a sign.
  const lots = [];
  let stage = null;
  /// The spin that turns a spot to face its nearest street.
  const faceStreet = (d) => {
    let near = null;
    for (const road of ROADS) {
      const lat = Math.abs(d.dot(road.axis));
      if (!near || lat < near.lat) near = { lat, road };
    }
    return spinToward(d, d.clone().addScaledVector(near.road.axis, -d.dot(near.road.axis)).normalize());
  };
  {
    const lr = mulberry32(4242); // its own stream, so the rest of the town keeps its layout
    const cands = [];
    for (let i = 0; i < 20000; i++) {
      const d = new THREE.Vector3(lr() * 2 - 1, lr() * 2 - 1, lr() * 2 - 1).normalize();
      const far = arc(d, spawnSpot.p), nr = nearestRoad(d);
      if (far > 60 || nr < ROAD_HW + WALK + 1.7 || nr > ROAD_HW + WALK + 6) continue;
      if (!inTown(d) || wetNear(d, 3) || !clearOf(d, 1.9) || blocked(d, 1.9)) continue;
      cands.push({ d, far });
    }
    cands.sort((a, b) => a.far - b.far);
    for (const c of cands) {
      if (lots.length >= 30) break;
      if (lots.some((l) => arc(l.d, c.d) < 4.6) || !clearOf(c.d, 1.9)) continue;
      const spin = faceStreet(c.d);
      lots.push({ d: c.d, spin });
      taken.push({ d: c.d, r: 2.3 });
      const g = new THREE.Group();
      box(g, 3.8, 0.06, 3.8, C.walk, 0, 0.03, 0);
      bake(g, c.d, spin);
    }
  }

  // ---- a little stage by a street, where Donal Trum makes speeches to anyone passing
  {
    const sr = mulberry32(777); // its own stream, so the rest of the town keeps its layout
    let best = null;
    for (let i = 0; i < 20000; i++) {
      const d = new THREE.Vector3(sr() * 2 - 1, sr() * 2 - 1, sr() * 2 - 1).normalize();
      const far = arc(d, spawnSpot.p);
      if (far < 9 || far > 40) continue;
      const nr = nearestRoad(d);
      if (nr < ROAD_HW + WALK + 1.3 || nr > ROAD_HW + WALK + 2.8) continue;
      if (!inTown(d) || wetNear(d, 2.5) || !clearOf(d, 2.2) || blocked(d, 2.2)) continue;
      if (!best || Math.abs(far - 15) < Math.abs(best.far - 15)) best = { d, far };
    }
    if (best) {
      const d = best.d, spin = faceStreet(d), q = frameAt(d, spin);
      const at = (x, z) => d.clone().multiplyScalar(R).add(new THREE.Vector3(x, 0, z).applyQuaternion(q)).normalize();
      const NAVY = 0x2c3e6b, GOLD = 0xe2b844, CREAM = 0xf4efe0, RED = 0xd9534a, INK = 0x2f3538;
      const g = new THREE.Group();
      box(g, 1.3, 0.03, 2.5, 0xc0504a, 0, 0.015, 0.75); // red carpet out to the street
      box(g, 0.62, 1.0, 0.42, NAVY, 0, 0.5, 0.55); // the podium
      box(g, 0.7, 0.06, 0.5, 0x23345a, 0, 1.03, 0.53, -0.15);
      part(g, new THREE.CylinderGeometry(0.17, 0.17, 0.02, 24), GOLD, 0, 0.62, 0.765, Math.PI / 2);
      box(g, 0.15, 0.1, 0.02, CREAM, 0, 0.62, 0.78);
      for (const s of [-1, 1]) {
        part(g, new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), INK, s * 0.08, 1.18, 0.48, 0.5, 0, -s * 0.25);
        part(g, new THREE.CapsuleGeometry(0.028, 0.05, 4, 8), INK, s * 0.12, 1.32, 0.4, 1.0, 0, -s * 0.25);
        part(g, new THREE.CylinderGeometry(0.04, 0.045, 2.7, 8), CREAM, s * 1.5, 1.35, -0.9);
        part(g, new THREE.SphereGeometry(0.07, 10, 8), GOLD, s * 1.5, 2.74, -0.9);
      }
      box(g, 2.9, 0.75, 0.04, CREAM, 0, 2.2, -0.93); // the banner's back
      box(g, 3.0, 0.015, 0.015, INK, 0, 2.66, -0.9); // bunting string
      for (let i = 0; i < 11; i++) part(g, new THREE.ConeGeometry(0.075, 0.17, 3), [RED, CREAM, NAVY][i % 3], -1.35 + i * 0.27, 2.57, -0.88, Math.PI);
      bake(g, d, spin);
      const c = document.createElement("canvas"); c.width = 512; c.height = 128;
      const bg = c.getContext("2d");
      bg.fillStyle = "#2c3e6b"; bg.fillRect(0, 0, 512, 128);
      bg.fillStyle = "#d9534a"; bg.fillRect(0, 0, 512, 14); bg.fillRect(0, 114, 512, 14);
      bg.fillStyle = "#fbf6ea"; bg.font = "700 58px Bungee, Impact, sans-serif"; bg.textAlign = "center"; bg.textBaseline = "middle";
      bg.fillText("THE BEST POST", 256, 68);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshBasicMaterial({ map: texFromCanvas(c) }));
      banner.position.copy(d).multiplyScalar(R);
      banner.quaternion.copy(q);
      banner.translateY(2.2); banner.translateZ(-0.905);
      world.add(banner);
      addRect(at(0, 0.55), spin, 0.33, 0.23, { h: 1.1, hd: 0.23 });
      for (const s of [-1, 1]) addCircle(at(s * 1.5, -0.9), 0.08);
      taken.push({ d, r: 2.6 });
      const spot = at(0, 0.05);
      npcs.push({
        d: spot, y: terrain.surfaceAt(spot, 1.5), face: new THREE.Vector3(0, 0, 1).applyQuaternion(q), name: "Donal Trum",
        own: true, fixed: true, hi: ["Tremendous!", "Fantastic!", "Believe me!", "Huge!"],
        look: { head: "frog", skin: 0x7bb661, hair: 0xf0c75e, shirt: NAVY, collar: 0xf4f1ea, accent: NAVY, tie: RED, sleeves: "long",
          bottoms: NAVY, bottomsStyle: "pants", socks: NAVY, shoes: 0x2b2b2e, bag: "none", height: 1.06 },
        lines: [
          "This is the greatest post office in the history of post offices. Maybe ever. Everybody says so.",
          "Tremendous letters. The best letters. Nobody delivers letters like you, believe me.",
          "Some people say this planet is small. It's not small. It's huge. Very round, very huge.",
          "I know stamps. I have the best stamps. Golden ones. Many people are looking for them.",
          "You're doing a fantastic job, courier. Fantastic. People are talking about it.",
        ],
      });
      stage = { d, spot };
    }
  }

  // ---- parks: trees, bushes and benches fill the blocks between streets
  for (let n = 0, placed = 0; placed < 260 && n < 9000; n++) {
    const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    if (nearestRoad(d) < ROAD_HW + WALK + 0.9 || !clearOf(d, 0.9) || !inTown(d) || wetNear(d, 1.2)) continue;
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

  // Pools of warm light under the street lamps, faded in at night.
  const pools = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const disc = new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2);
    const parts = lamps.map((d) => disc.clone().applyQuaternion(frameAt(d, 0)).translate(...d.clone().multiplyScalar(R + 0.19).toArray()));
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({
      map: texFromCanvas(c), color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    world.add(m);
    noNormals.push(m);
    return m;
  })();

  const town = batch.build(toon(0xffffff, { vertexColors: true }));
  world.add(town);
  const litWindows = litBatch.build(toon(0xffffff, { vertexColors: true, emissive: 0xffc46b, emissiveIntensity: 0 }));
  world.add(litWindows);

  // ---- grass tufts: tiny instanced blades that the ink pass turns into hatching
  {
    const N = 6000;
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.24, 3), toon(C.tuft), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
    let n = 0;
    for (let tries = 0; n < N && tries < N * 4; tries++) {
      const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      if (nearestRoad(d) < ROAD_HW + WALK + 0.15 || !clearOf(d, 0.05) || terrain.sandAt(d)) continue;
      if (terrain.zoneAt(d).key === "works" && rng() < 0.6) continue;
      const lift = terrain.landAt(d);
      for (let b = 0; b < 3 && n < N; b++, n++) {
        q.setFromUnitVectors(UP, d).multiply(new THREE.Quaternion().setFromEuler(e.set((rng() - 0.5) * 0.9, rng() * 6, (rng() - 0.5) * 0.9)));
        const k = range(0.7, 1.3);
        m.compose(d.clone().multiplyScalar(R + lift + 0.08), q, sc.set(k, k * range(0.8, 1.4), k));
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
  const normalMat = cutaway(new THREE.MeshNormalMaterial());
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
      thickness: { value: dpr * 1.4 },
      invProj: { value: new THREE.Matrix4() },
      camRot: { value: new THREE.Matrix3() },
      worldInv: { value: new THREE.Matrix3() },
      horizon: { value: new THREE.Color(0xa9ded2) },
      zenith: { value: new THREE.Color(0x6fbcbc) },
      cloudShade: { value: new THREE.Color(0x93d2c8) },
      cloudLight: { value: new THREE.Color(0xd5efe6) },
      ink: { value: new THREE.Color(0x283033) },
      stars: { value: 0 },
      overcast: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let quality = 1; // drawn at this fraction of the screen's pixel ratio; lowered when frames run slow
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight, px = dpr * quality;
    gl.setPixelRatio(px);
    gl.setSize(w, h, false);
    colorRT.setSize(Math.round(w * px), Math.round(h * px));
    normalRT.setSize(Math.round(w * px), Math.round(h * px));
    post.uniforms.res.value.set(Math.round(w * px), Math.round(h * px));
    post.uniforms.thickness.value = px * 1.4;
    camera.aspect = w / h;
    // Keep a fair width of view on tall phone screens; wide screens use a narrower, flatter lens.
    camera.fov = Math.min(70, Math.max(40, (2 * Math.atan(Math.tan(0.49) / camera.aspect) * 180) / Math.PI));
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------------------------------------------------------------- time of day

  // Sky, light and window glow at each point of the day (0 midnight, 0.5 noon), blended in between.
  const LOOKS = {
    night: { horizon: 0x33466b, zenith: 0x161f3a, cloudShade: 0x2a3654, cloudLight: 0x415275,
      hemiSky: 0x6075a6, hemiGround: 0x26333c, hemiI: 0.62, sun: 0x9fb0ff, sunI: 0.55, glow: 1, stars: 1 },
    dawn: { horizon: 0xf5c9a6, zenith: 0x88a9c8, cloudShade: 0xe4ad96, cloudLight: 0xffe4cc,
      hemiSky: 0xffdcc0, hemiGround: 0x7c8c70, hemiI: 0.95, sun: 0xffb27a, sunI: 1.5, glow: 0.35, stars: 0.15 },
    day: { horizon: 0xa9ded2, zenith: 0x6fbcbc, cloudShade: 0x93d2c8, cloudLight: 0xd5efe6,
      hemiSky: 0xe4f6f2, hemiGround: 0x8aa982, hemiI: 1.25, sun: 0xfff0d6, sunI: 2.4, glow: 0, stars: 0 },
    dusk: { horizon: 0xf2a27e, zenith: 0x6b6595, cloudShade: 0xc98c8c, cloudLight: 0xf7c8a8,
      hemiSky: 0xf3c2a6, hemiGround: 0x6e7864, hemiI: 0.85, sun: 0xff9860, sunI: 1.4, glow: 0.6, stars: 0.2 },
  };
  const DAY_KEYS = [
    [0, "night"], [0.16, "night"], [0.24, "dawn"], [0.32, "day"], [0.68, "day"], [0.76, "dusk"], [0.84, "night"], [1, "night"],
  ];
  const ca = new THREE.Color(), cb = new THREE.Color();
  const blend = (a, b, k, key, out) => out.copy(ca.setHex(a[key])).lerp(cb.setHex(b[key]), k);
  const mixN = (a, b, k, key) => a[key] + (b[key] - a[key]) * k;
  let night = 0;
  /// Set the time of day, 0..1 (0 midnight, 0.25 dawn, 0.5 noon, 0.75 dusk).
  function setTimeOfDay(f) {
    f = ((f % 1) + 1) % 1;
    let i = 0;
    while (f > DAY_KEYS[i + 1][0]) i++;
    const [fa, na] = DAY_KEYS[i], [fb, nb] = DAY_KEYS[i + 1];
    const x = (f - fa) / (fb - fa), k = x * x * (3 - 2 * x);
    const a = LOOKS[na], b = LOOKS[nb], u = post.uniforms;
    for (const key of ["horizon", "zenith", "cloudShade", "cloudLight"]) blend(a, b, k, key, u[key].value);
    blend(a, b, k, "hemiSky", hemi.color);
    blend(a, b, k, "hemiGround", hemi.groundColor);
    hemi.intensity = mixN(a, b, k, "hemiI");
    blend(a, b, k, "sun", sun.color);
    sun.intensity = mixN(a, b, k, "sunI");
    litWindows.material.emissiveIntensity = mixN(a, b, k, "glow");
    pools.material.opacity = 0.42 * mixN(a, b, k, "glow");
    // Water takes the sky's light: dimmer and bluer at night, warmer at dusk.
    WATER.light.value = 0.15 + 0.85 * Math.pow(mixN(a, b, k, "hemiI") / 1.25, 1.5);
    WATER.tint.value.copy(hemi.color).multiplyScalar(1 / Math.max(hemi.color.r, hemi.color.g, hemi.color.b));
    pools.visible = pools.material.opacity > 0.01;
    u.stars.value = mixN(a, b, k, "stars");
    night = mixN(a, b, k, "glow");
    // Rain: an overcast sky, greyer and a little darker, and no stars.
    if (rain > 0.001) {
      for (const key of ["horizon", "zenith", "cloudShade", "cloudLight"]) {
        const c = u[key].value, grey = (c.r + c.g + c.b) / 3 * 0.86;
        c.lerp(ca.setRGB(grey, grey * 1.02, grey * 1.06), 0.65 * rain);
      }
      hemi.intensity *= 1 - 0.22 * rain;
      sun.intensity *= 1 - 0.55 * rain;
      u.stars.value *= 1 - rain;
      WATER.light.value *= 1 - 0.2 * rain;
    }
    u.overcast.value = rain;
  }

  // ---------------------------------------------------------------- rain

  // Streaks in a box around the courier (who always stands at the top of the planet in scene space).
  const RAIN_N = 1400, RAIN_BOX = 16, RAIN_TOP = 14, DROP = 0.55;
  const drops = new Float32Array(RAIN_N * 3); // x, y, z of each drop's foot
  const dropSpeed = new Float32Array(RAIN_N), dropFloor = new Float32Array(RAIN_N);
  const rainPos = new Float32Array(RAIN_N * 6);
  const respawn = (i, top) => {
    drops[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX;
    drops[i * 3 + 1] = R + (top ? RAIN_TOP : Math.random() * RAIN_TOP);
    drops[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX;
    dropSpeed[i] = 13 + Math.random() * 5;
    // Where the planet's surface is under this drop: it curves away from the courier.
    const x = drops[i * 3], z = drops[i * 3 + 2];
    dropFloor[i] = Math.sqrt(Math.max(0, R * R - x * x - z * z)) - 0.1;
  };
  for (let i = 0; i < RAIN_N; i++) respawn(i, false);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
    color: 0x7f939c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  rainLines.frustumCulled = false;
  rainLines.visible = false;
  scene.add(rainLines);
  noNormals.push(rainLines);
  let rain = 0, lastT = 0;
  function stepRain(t) {
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    rainLines.visible = rain > 0.01;
    if (!rainLines.visible) return;
    rainLines.material.opacity = Math.min(1, rain * 1.1);
    // Lighter rain falls in fewer streaks.
    const n = Math.floor(RAIN_N * (0.35 + 0.65 * rain));
    rainGeo.setDrawRange(0, n * 2);
    for (let i = 0; i < n; i++) {
      drops[i * 3 + 1] -= dropSpeed[i] * dt;
      if (drops[i * 3 + 1] < dropFloor[i]) respawn(i, true);
      const x = drops[i * 3], y = drops[i * 3 + 1], z = drops[i * 3 + 2], j = i * 6;
      rainPos[j] = x; rainPos[j + 1] = y; rainPos[j + 2] = z;
      rainPos[j + 3] = x + 0.06; rainPos[j + 4] = y + DROP; rainPos[j + 5] = z + 0.03;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  setTimeOfDay(0.42);

  const rot4 = new THREE.Matrix4();
  let lastFrame = 0;
  function render(t) {
    const dt = Math.min(0.05, Math.max(0, t - lastFrame));
    lastFrame = t;
    WATER.time.value = t;
    for (const fn of animators) fn(t, night, dt);
    spray.update(dt, 1 - 0.5 * night);
    smoke.update(dt, 1 - 0.55 * night);
    stepRain(t);
    camera.updateMatrixWorld();
    world.updateMatrixWorld();
    post.uniforms.time.value = t;
    CUT.windTime.value = t;
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

  return {
    scene, camera, world, render, obstacles, addresses, spawn, noNormals, frameAt, nearestRoad, setTimeOfDay,
    /// Whether a spot on the planet (with this much room around it) is inside something solid or under water.
    blocked,
    /// Lots for the players' post offices ({ d, spin }), nearest the main post office first.
    lots,
    stage,
    /// The lie of the land: places, ground and water heights, what you can stand on.
    terrain,
    /// People who live out in the places (beach, pier, shrine, cabin, works), golden-stamp spots up
    /// high, and where the loud things are (the sea, the falls, the works) for the ambience.
    npcs, stampSpots, ambient,
    /// Draw at this fraction (0.5..1) of the screen's full resolution.
    setQuality(q) {
      quality = q;
      resize();
    },
    /// Cut a see-through path from the camera to this point (world space), or pass null to stop.
    setCutaway(target) {
      CUT.cutR.value = target ? 0.85 : 0;
      if (target) {
        CUT.cutTarget.value.copy(target);
        CUT.cutCam.value.copy(camera.position);
      }
    },
    /// How hard it's raining, 0..1 (applied with the next setTimeOfDay).
    setRain(r) { rain = r; },
    /// How dark it is, 0 (day) to 1 (night).
    get night() { return night; },
  };
}
