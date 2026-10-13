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
  scooter: { d: 3.6, y: 0.9 }, hoverboard: { d: 3.6, y: 1.0 }, neonbike: { d: 4.4, y: 0.78 }, supercar: { d: 5.4, y: 0.6 },
};
const BLOB = { plane: 2.6, supercar: 2.4, neonbike: 1.9, hoverboard: 1.3 };

/// Draw the scene as it stands onto the canvas: colour, then normals, then the ink pass over a `background` halftone.
function shoot(k, background) {
  const bg = new THREE.Color(background);
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
}

/// Render courier `c` (from traits.courier): just the 3D art, w×h pixels. `rideColour` paints the ride
/// (skins), otherwise it takes the courier's accent.
function renderArt(c, w, h, rideColour = null, headroom = false) {
  const k = setup(w, h);
  const subject = new THREE.Group();
  const ch = createCharacter(c.params);
  const ride = c.ride.key === "foot" ? null : createRide(c.ride.key, rideColour ?? c.params.accent);
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
  k.blob.scale.setScalar(ride ? BLOB[c.ride.key] ?? 1.7 : 0.9);

  // Skins wear tall hats (a chef's, a crown, a helmet): frame them with more room above.
  const f = headroom && c.ride.key === "foot" ? { d: 3.55, y: 1.0 } : FRAMING[c.ride.key];
  k.camera.position.set(0, f.y + 0.4, f.d);
  k.camera.lookAt(0, f.y, 0);
  shoot(k, c.background);

  k.scene.remove(subject);
  subject.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (!o.material.userData?.shared) o.material.dispose();
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

/// A perforated stamp on envelope paper, drawn into a new canvas; returns { out, g, u, p, A }, the art
/// window's corner p and side A.
function stampBase(size) {
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const g = out.getContext("2d");
  const u = size / 512;
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
  for (let x = m; x <= m + W + 0.5; x += step) for (const y of [m, m + W]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  for (let y = m; y <= m + W + 0.5; y += step) for (const x of [m, m + W]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.globalCompositeOperation = "destination-over";
  g.fillStyle = "#e9e1cf";
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "source-over";
  return { out, g, u, p: m + 24 * u, A: W - 48 * u };
}

/// A skin's stamp: the skin worn (or ridden) by a courier, its name on the label and its rarity in the
/// corner, and how many of it there are. `skin`: { name, rarity, supply, params, ride, rideColour, background }.
export async function renderSkinStamp(skin, size = 512) {
  await document.fonts.load(`${Math.round(size * 0.06)}px Bungee`);
  const { out, g, u, p, A } = stampBase(size);
  const labelH = 54 * u, artH = A - labelH;
  const art = renderArt({ params: skin.params, ride: { key: skin.ride ?? "foot" }, background: skin.background }, Math.round(A), Math.round(artH), skin.rideColour, true);
  g.drawImage(art, p, p, A, artH);
  g.lineWidth = 4 * u;
  g.strokeStyle = "#283033";
  g.strokeRect(p, p, A, A);
  g.beginPath(); g.moveTo(p, p + artH); g.lineTo(p + A, p + artH); g.stroke();
  g.fillStyle = "#fbf8ef";
  g.fillRect(p + 2 * u, p + artH + 2 * u, A - 4 * u, labelH - 4 * u);
  g.fillStyle = "#283033";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = `${Math.round(26 * u)}px Bungee`;
  g.fillText("SKIN", p + 14 * u, p + artH + labelH / 2 + 2 * u);
  g.textAlign = "right";
  let fs = 22;
  g.font = `${Math.round(fs * u)}px Bungee`;
  while (g.measureText(skin.name.toUpperCase()).width > A - 120 * u && fs > 12) g.font = `${Math.round(--fs * u)}px Bungee`;
  g.fillText(skin.name.toUpperCase(), p + A - 14 * u, p + artH + labelH / 2 + 2 * u);
  const vx = p + A - 16 * u, vy = p + 16 * u;
  g.font = `${Math.round(15 * u)}px Bungee`;
  g.textAlign = "right";
  g.textBaseline = "top";
  g.lineWidth = 6 * u;
  g.strokeStyle = "#fbf8ef";
  g.fillStyle = RARITY_INK[skin.rarity];
  g.strokeText(skin.rarity.toUpperCase(), vx, vy);
  g.fillText(skin.rarity.toUpperCase(), vx, vy);
  if (skin.supply) {
    const ed = `One of ${skin.supply}`;
    g.font = `${Math.round(12 * u)}px Bungee`;
    g.fillStyle = "#283033";
    g.strokeText(ed, vx, vy + 22 * u);
    g.fillText(ed, vx, vy + 22 * u);
  }
  return out;
}

/// A skin before the reveal: a sealed envelope on the stamp, the same for every token.
export async function renderSealedStamp(size = 512) {
  await document.fonts.load(`${Math.round(size * 0.06)}px Bungee`);
  const { out, g, u, p, A } = stampBase(size);
  const labelH = 54 * u, artH = A - labelH;
  // Night sky with a few stars.
  const sky = g.createLinearGradient(0, p, 0, p + artH);
  sky.addColorStop(0, "#1b2a3a");
  sky.addColorStop(1, "#2c3e6b");
  g.fillStyle = sky;
  g.fillRect(p, p, A, artH);
  let a = 7;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "rgba(251,248,239,0.7)";
  for (let i = 0; i < 40; i++) g.fillRect(p + rnd() * A, p + rnd() * artH * 0.9, 2.5 * u, 2.5 * u);
  // The envelope, tilted a little, with a wax seal.
  const cx = p + A / 2, cy = p + artH * 0.52, w = A * 0.62, h = w * 0.64;
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.08);
  g.shadowColor = "rgba(0,0,0,0.35)";
  g.shadowOffsetY = 8 * u;
  g.fillStyle = "#f4ead2";
  g.fillRect(-w / 2, -h / 2, w, h);
  g.shadowColor = "transparent";
  g.lineWidth = 4 * u;
  g.strokeStyle = "#283033";
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.beginPath();
  g.moveTo(-w / 2, -h / 2);
  g.lineTo(0, h * 0.08);
  g.lineTo(w / 2, -h / 2);
  g.moveTo(-w / 2, h / 2);
  g.lineTo(-w * 0.12, -h * 0.02);
  g.moveTo(w / 2, h / 2);
  g.lineTo(w * 0.12, -h * 0.02);
  g.stroke();
  g.fillStyle = "#c9384a";
  g.beginPath();
  g.arc(0, h * 0.08, 30 * u, 0, 7);
  g.fill();
  g.stroke();
  g.fillStyle = "#fbf8ef";
  g.font = `${Math.round(34 * u)}px Bungee`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("?", 0, h * 0.08 + 2 * u);
  g.restore();
  g.lineWidth = 4 * u;
  g.strokeStyle = "#283033";
  g.strokeRect(p, p, A, A);
  g.beginPath(); g.moveTo(p, p + artH); g.lineTo(p + A, p + artH); g.stroke();
  g.fillStyle = "#fbf8ef";
  g.fillRect(p + 2 * u, p + artH + 2 * u, A - 4 * u, labelH - 4 * u);
  g.fillStyle = "#283033";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = `${Math.round(26 * u)}px Bungee`;
  g.fillText("SKIN", p + 14 * u, p + artH + labelH / 2 + 2 * u);
  g.textAlign = "right";
  g.font = `${Math.round(22 * u)}px Bungee`;
  g.fillText("SEALED", p + A - 14 * u, p + artH + labelH / 2 + 2 * u);
  g.font = `${Math.round(15 * u)}px Bungee`;
  g.textBaseline = "top";
  g.lineWidth = 6 * u;
  g.strokeStyle = "#283033";
  g.fillStyle = "#fbf8ef";
  g.strokeText("REVEALED SOON", p + A - 16 * u, p + 16 * u);
  g.fillText("REVEALED SOON", p + A - 16 * u, p + 16 * u);
  return out;
}

const TIER_INK = { Pet: "#5e9f57", "Space buddy": "#3f6fbf", Legendary: "#c9962a", Mecha: "#8d5a99", Anime: "#c4577f" };

/// Any ready-made `subject` (feet at y 0, facing +z), turned a little and framed to fit, w×h pixels. The caller
/// builds it and disposes of it.
function renderSubject(subject, w, h, background, blob, zoom = 1) {
  const k = setup(w, h);
  const yaw = subject.rotation.y;
  subject.rotation.y = yaw - 0.55;
  k.scene.add(subject);
  subject.updateMatrixWorld(true);
  // (Only what shows: models park hidden sparkles and flames out of the way.)
  const box = new THREE.Box3().expandByPoint(new THREE.Vector3(0, 0, 0)), part = new THREE.Box3();
  subject.traverseVisible((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const t = Math.tan(THREE.MathUtils.degToRad(k.camera.fov) / 2);
  const d = Math.max(size.y / 2 / t, Math.max(size.x, size.z) / 2 / t / k.camera.aspect) * 1.2 / zoom + Math.max(size.x, size.z) / 2;
  k.camera.position.set(mid.x, mid.y + d * 0.16, mid.z + d);
  k.camera.lookAt(mid.x, mid.y, mid.z);
  k.camera.far = Math.max(50, d * 3);
  k.camera.updateProjectionMatrix();
  k.blob.scale.setScalar(blob);
  shoot(k, background);
  k.camera.far = 50;
  k.camera.updateProjectionMatrix();
  k.scene.remove(subject);
  subject.rotation.y = yaw;
  return k.canvas;
}

/// A companion's stamp: the companion (`subject`, built by the game's own code), its name on the label, its tier in
/// the corner and how many of it there are. `c`: { name, tier, supply, background, subject, blob (its shadow, m),
/// zoom (closer than the fit, for a group) }.
export async function renderCompanionStamp(c, size = 512) {
  await document.fonts.load(`${Math.round(size * 0.06)}px Bungee`);
  const { out, g, u, p, A } = stampBase(size);
  const labelH = 54 * u, artH = A - labelH;
  g.drawImage(renderSubject(c.subject, Math.round(A), Math.round(artH), c.background, c.blob ?? 0.9, c.zoom), p, p, A, artH);
  g.lineWidth = 4 * u;
  g.strokeStyle = "#283033";
  g.strokeRect(p, p, A, A);
  g.beginPath(); g.moveTo(p, p + artH); g.lineTo(p + A, p + artH); g.stroke();
  g.fillStyle = "#fbf8ef";
  g.fillRect(p + 2 * u, p + artH + 2 * u, A - 4 * u, labelH - 4 * u);
  g.fillStyle = "#283033";
  g.textBaseline = "middle";
  g.textAlign = "center";
  const name = c.name.toUpperCase();
  let fs = 26;
  g.font = `${Math.round(fs * u)}px Bungee`;
  while (g.measureText(name).width > A - 28 * u && fs > 12) g.font = `${Math.round(--fs * u)}px Bungee`;
  g.fillText(name, p + A / 2, p + artH + labelH / 2 + 2 * u);
  const vx = p + A - 16 * u, vy = p + 16 * u;
  g.textAlign = "right";
  g.textBaseline = "top";
  g.lineWidth = 6 * u;
  g.strokeStyle = "#fbf8ef";
  if (c.tier) {
    g.font = `${Math.round(15 * u)}px Bungee`;
    g.fillStyle = TIER_INK[c.tier] ?? "#283033";
    g.strokeText(c.tier.toUpperCase(), vx, vy);
    g.fillText(c.tier.toUpperCase(), vx, vy);
  }
  if (c.supply) {
    const ed = `One of ${c.supply}`;
    g.font = `${Math.round(12 * u)}px Bungee`;
    g.fillStyle = "#283033";
    g.strokeText(ed, vx, vy + 22 * u);
    g.fillText(ed, vx, vy + 22 * u);
  }
  return out;
}
