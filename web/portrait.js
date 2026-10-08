// NFT art: each courier drawn as a postage stamp. The 3D character is rendered with
// the same cel shading and ink pass as the game, then framed on a perforated stamp
// with the courier's number and its delivery power as the stamp's value.
import * as THREE from "https://esm.sh/three@0.160.0";
import { createCharacter } from "./character.js";
import { createRide } from "./rides.js";

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor, tNormal, tDepth;
  uniform vec2 res;
  uniform float near, far, thickness;
  uniform vec3 bg, bg2, ink;
  varying vec2 vUv;
  float invZ(vec2 uv) { return 1.0 / -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
  vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
  void main() {
    vec2 px = thickness / res;
    float zc = invZ(vUv);
    float lap = abs(invZ(vUv - vec2(px.x, 0.0)) + invZ(vUv + vec2(px.x, 0.0)) + invZ(vUv - vec2(0.0, px.y)) + invZ(vUv + vec2(0.0, px.y)) - 4.0 * zc) / max(zc, 1e-4);
    vec3 nc = nrm(vUv);
    float nd = max(max(1.0 - dot(nc, nrm(vUv - vec2(px.x, 0.0))), 1.0 - dot(nc, nrm(vUv + vec2(px.x, 0.0)))),
                   max(1.0 - dot(nc, nrm(vUv - vec2(0.0, px.y))), 1.0 - dot(nc, nrm(vUv + vec2(0.0, px.y)))));
    float edge = max(smoothstep(0.01, 0.028, lap), smoothstep(0.3, 0.5, nd));
    // Background: flat colour with a soft halftone, like printed stamp paper.
    vec2 cell = fract(gl_FragCoord.xy / (9.0 * thickness)) - 0.5;
    float dots = step(length(cell), 0.18 * (1.0 - vUv.y * 0.6));
    vec3 back = mix(bg, bg2, dots * 0.55);
    vec3 base = texture2D(tDepth, vUv).x >= 0.99999 ? back : texture2D(tColor, vUv).rgb;
    gl_FragColor = vec4(mix(base, ink, edge * 0.92), 1.0);
    #include <colorspace_fragment>
  }`;

// One renderer for every stamp (browsers only allow a handful of WebGL contexts).
let ctx = null;
function setup(w, h) {
  if (ctx) {
    if (ctx.w !== w || ctx.h !== h) {
      ctx.gl.setSize(w, h, false);
      ctx.colorRT.setSize(w, h);
      ctx.normalRT.setSize(w, h);
      ctx.post.uniforms.res.value.set(w, h);
      ctx.post.uniforms.thickness.value = Math.max(1, w / 420);
      ctx.camera.aspect = w / h;
      ctx.camera.updateProjectionMatrix();
      Object.assign(ctx, { w, h });
    }
    return ctx;
  }
  const canvas = document.createElement("canvas");
  const gl = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  gl.setPixelRatio(1);
  gl.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeef8f4, 0x9aa98f, 1.3));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.3);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
  const colorRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
  const normalRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
  const post = new THREE.ShaderMaterial({
    vertexShader: POST_VERT,
    fragmentShader: POST_FRAG,
    uniforms: {
      tColor: { value: colorRT.texture }, tNormal: { value: normalRT.texture }, tDepth: { value: colorRT.depthTexture },
      res: { value: new THREE.Vector2(w, h) }, near: { value: camera.near }, far: { value: camera.far },
      thickness: { value: Math.max(1, w / 420) },
      bg: { value: new THREE.Color() }, bg2: { value: new THREE.Color() }, ink: { value: new THREE.Color(0x283033) },
    },
    depthTest: false, depthWrite: false,
  });
  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0x283033, transparent: true, opacity: 0.18, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.002;
  scene.add(blob);
  ctx = { w, h, canvas, gl, scene, camera, colorRT, normalRT, post, postScene, postCam, blob, normalMat: new THREE.MeshNormalMaterial() };
  return ctx;
}

const FRAMING = {
  foot: { d: 3.0, y: 0.84 }, skate: { d: 3.2, y: 0.9 }, bike: { d: 4.1, y: 0.8 },
  moped: { d: 4.1, y: 0.82 }, plane: { d: 5.6, y: 1.0 },
};

/// Render courier `c` (from traits.courier): just the 3D art, w×h pixels.
function renderArt(c, w, h) {
  const k = setup(w, h);
  const subject = new THREE.Group();
  const ch = createCharacter(c.params);
  const ride = c.ride.key === "foot" ? null : createRide(c.ride.key, c.params.accent);
  if (ride) {
    subject.add(ride.group);
    ch.root.position.set(0, ride.mount.y, ride.mount.z);
    ch.setPose(ride.mount.pose);
    ride.update(0, 0, 0.6);
  }
  subject.add(ch.root);
  ch.update(0.001, 0, 0.6);
  subject.rotation.y = -0.55;
  k.scene.add(subject);
  k.blob.scale.setScalar(ride ? (c.ride.key === "plane" ? 2.6 : 1.7) : 0.9);

  const f = FRAMING[c.ride.key];
  k.camera.position.set(0, f.y + 0.4, f.d);
  k.camera.lookAt(0, f.y, 0);
  const bg = new THREE.Color(c.background);
  k.post.uniforms.bg.value.copy(bg);
  k.post.uniforms.bg2.value.copy(bg).offsetHSL(0, 0.02, 0.06);

  k.gl.setRenderTarget(k.colorRT);
  k.gl.render(k.scene, k.camera);
  k.blob.visible = false;
  k.scene.overrideMaterial = k.normalMat;
  k.gl.setRenderTarget(k.normalRT);
  k.gl.render(k.scene, k.camera);
  k.scene.overrideMaterial = null;
  k.blob.visible = true;
  k.gl.setRenderTarget(null);
  k.gl.render(k.postScene, k.postCam);

  k.scene.remove(subject);
  subject.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return k.canvas;
}

const RARITY_INK = { Common: "#5f6b6e", Uncommon: "#5e9f57", Rare: "#3f6fbf", Epic: "#8d5a99", Legendary: "#c9962a" };

/// The finished stamp for courier `c`, drawn into a new 2D canvas of `size` pixels.
export async function renderStamp(c, size = 512) {
  await document.fonts.load(`${Math.round(size * 0.06)}px Bungee`);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const g = out.getContext("2d");
  const u = size / 512;

  // Envelope-paper backdrop, then the stamp with perforated edges.
  g.fillStyle = "#e9e1cf";
  g.fillRect(0, 0, size, size);
  const m = 34 * u, W = size - 2 * m, r = 9 * u, step = 26 * u;
  g.save();
  g.shadowColor = "rgba(40,48,51,0.35)";
  g.shadowOffsetX = 5 * u;
  g.shadowOffsetY = 6 * u;
  g.fillStyle = "#fbf8ef";
  g.fillRect(m, m, W, W);
  g.restore();
  g.globalCompositeOperation = "destination-out";
  for (let x = m; x <= m + W + 0.5; x += step) {
    for (const y of [m, m + W]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  }
  for (let y = m; y <= m + W + 0.5; y += step) {
    for (const x of [m, m + W]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  }
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = "#e9e1cf";
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "source-over";

  // Art window.
  const p = m + 24 * u, A = W - 48 * u, labelH = 54 * u, artH = A - labelH;
  const art = renderArt(c, Math.round(A), Math.round(artH));
  g.drawImage(art, p, p, A, artH);
  g.lineWidth = 4 * u;
  g.strokeStyle = "#283033";
  g.strokeRect(p, p, A, A);
  g.beginPath(); g.moveTo(p, p + artH); g.lineTo(p + A, p + artH); g.stroke();

  // Label band: name and number, value in the corner like a stamp's denomination.
  g.fillStyle = "#fbf8ef";
  g.fillRect(p + 2 * u, p + artH + 2 * u, A - 4 * u, labelH - 4 * u);
  g.fillStyle = "#283033";
  g.font = `${Math.round(26 * u)}px Bungee`;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText("COURIER", p + 14 * u, p + artH + labelH / 2 + 2 * u);
  g.textAlign = "right";
  g.fillText(`No.${String(c.id).padStart(4, "0")}`, p + A - 14 * u, p + artH + labelH / 2 + 2 * u);

  const vx = p + A - 16 * u, vy = p + 16 * u;
  g.font = `${Math.round(30 * u)}px Bungee`;
  g.textAlign = "right";
  g.textBaseline = "top";
  g.lineWidth = 7 * u;
  g.strokeStyle = "#fbf8ef";
  g.strokeText(String(c.ride.power), vx, vy);
  g.fillStyle = RARITY_INK[c.ride.rarity];
  g.fillText(String(c.ride.power), vx, vy);
  g.font = `${Math.round(13 * u)}px Bungee`;
  g.lineWidth = 5 * u;
  g.strokeText(c.ride.rarity.toUpperCase(), vx, vy + 34 * u);
  g.fillText(c.ride.rarity.toUpperCase(), vx, vy + 34 * u);
  return out;
}
