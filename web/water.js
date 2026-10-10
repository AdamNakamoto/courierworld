// Painted water: the bay, the pond and the river as flat two-tone colour with drifting light
// patches and foam along the shore, and waterfalls as curtains of streaks pouring down.
import * as THREE from "https://esm.sh/three@0.160.0";

const NOISE = /* glsl */ `
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

/// Shared by every water surface: time and how much light there is (day, dusk, night, rain).
export const WATER = { time: { value: 0 }, light: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) } };

/// The bay or the pond: `center` (unit vector) and `radius` (radians) say where the shore is.
export function bodyMaterial({ center, radius, R, deep = 0x2b7f86, shallow = 0x4fb3ae, foam = 0xf4f6ee }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...WATER, center: { value: center.clone() }, radius: { value: radius }, planetR: { value: R },
      deep: { value: new THREE.Color(deep) }, shallow: { value: new THREE.Color(shallow) }, foam: { value: new THREE.Color(foam) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 tint;
      uniform float time, light, radius, planetR;
      uniform vec3 center, deep, shallow, foam;
      varying vec3 vPos;
      ${NOISE}
      void main() {
        vec3 n = normalize(vPos);
        float fromShore = (radius - acos(clamp(dot(n, center), -1.0, 1.0))) * planetR; // metres out from the shoreline
        vec3 c = mix(shallow, deep, smoothstep(0.5, 6.0, fromShore));
        // Drifting patches of lighter and darker water, flat like paint.
        vec3 q = vPos * 0.32 + vec3(time * 0.05, 0.0, time * 0.035);
        float m = vnoise3(q) * 0.65 + vnoise3(q * 2.3 + 7.0) * 0.35;
        c = mix(c, mix(c, shallow * 1.18, 0.55), step(0.62, m));
        c = mix(c, c * 0.82, step(m, 0.3));
        // Little glints that come and go.
        float g = vnoise3(vPos * 1.4 + vec3(0.0, time * 0.4, time * 0.25));
        c = mix(c, foam, step(0.86, g) * 0.8);
        // Foam where the water meets the sand, washing in and out.
        float wash = 0.35 + 0.3 * sin(time * 0.8 + vnoise3(vPos * 0.6) * 4.0);
        float edge = step(fromShore, wash) + step(abs(fromShore - wash - 0.55), 0.07) * 0.85;
        c = mix(c, foam, clamp(edge, 0.0, 1.0));
        gl_FragColor = vec4(c * light * tint, 1.0);
      }`,
  });
}

/// The river: uv.x runs across (0..1), uv.y runs downstream in metres.
export function riverMaterial({ deep = 0x37939a, shallow = 0x59bab3, foam = 0xf4f6ee } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...WATER, deep: { value: new THREE.Color(deep) }, shallow: { value: new THREE.Color(shallow) }, foam: { value: new THREE.Color(foam) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 tint;
      uniform float time, light;
      uniform vec3 deep, shallow, foam;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;
        vec3 c = mix(deep, shallow, smoothstep(0.2, 0.9, x));
        float s = vnoise3(vec3(vUv.x * 7.0, vUv.y * 0.7 - time * 1.1, 0.0));
        c = mix(c, shallow * 1.15, step(0.6, s) * 0.7);
        c = mix(c, foam, step(0.82, vnoise3(vec3(vUv.x * 11.0, vUv.y * 1.6 - time * 1.6, 3.0))));
        c = mix(c, foam, step(0.9, x));
        gl_FragColor = vec4(c * light * tint, 1.0);
      }`,
  });
}

/// A waterfall: a ribbon from `top` falling `drop` metres, curving out a little, `width` wide.
/// `up` is the local up (unit vector), `out` the way it pours (unit tangent).
export function waterfall({ top, up, out, width, drop }) {
  const side = new THREE.Vector3().crossVectors(up, out).normalize();
  const rows = 14, pos = [], uv = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const k = j / rows;
    // Pours out over the lip, then falls nearly straight.
    const o = 0.45 * Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) + 0.15 * k;
    for (const sx of [-0.5, 0.5]) {
      const p = top.clone().addScaledVector(out, o).addScaledVector(up, -drop * k * k * 0.15 - drop * k * 0.85).addScaledVector(side, sx * width * (1 + 0.15 * k));
      pos.push(p.x, p.y, p.z);
      uv.push(sx + 0.5, k * drop);
    }
  }
  for (let j = 0; j < rows; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.ShaderMaterial({
    uniforms: { ...WATER, base: { value: new THREE.Color(0x6cc3c0) }, dark: { value: new THREE.Color(0x3f9ea3) }, foam: { value: new THREE.Color(0xf6f8f2) } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 tint;
      uniform float time, light;
      uniform vec3 base, dark, foam;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float x = vUv.x;
        vec3 c = mix(dark, base, smoothstep(0.1, 0.5, 1.0 - abs(x - 0.5) * 2.0));
        float streak = vnoise3(vec3(x * 9.0, vUv.y * 0.9 - time * 2.4, 0.0));
        c = mix(c, foam, step(0.68, streak));
        c = mix(c, foam, step(0.84, abs(x - 0.5) * 2.0)); // bright edges
        c = mix(c, foam, step(vUv.y, 0.12)); // the lip
        gl_FragColor = vec4(c * light * tint, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  const foot = top.clone().addScaledVector(out, 0.6).addScaledVector(up, -drop);
  return { mesh, foot, side };
}
