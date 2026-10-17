// Frenpet World (fren-pick.js has its rules: size, ticket, pets, friendship). Built the first time someone flies there:
// a small green village in Frenpet's pixel-art style (the post pass draws it in chunky pixels and Frenpet's four
// greens: world.js), with the landing pad and the rocket home at its top, a pet statue on the plaza, a log cabin,
// fences, blocky trees, a windmill, houses, a pond, a sprout field, a forest round the far side, the stone tower where
// IMD was born (ADAM, IMD's founder, waits at its door), a floating island and blocky clouds. The pets (Frenpet's own
// designs, fren-art.js) wander near their homes as camera-facing sprites; sit by one and pat it (main.js).
//
// Its group sits so the world's top is where the planet's is, as the moon's does (moon.js), and `ground` is what
// main.js walks on.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, toon, mulberry32, texFromCanvas } from "./world.js";
import { FREN_R, FREN_GRAVITY, LANDING, PLACES, PETS, ADAM, fromPad } from "./fren-pick.js";
import { PET_ART, ADAM_ART, HEART_ART, pixelCanvas } from "./fren-art.js";
import { facing, padAndRocket, createLocals } from "./space.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D = (a) => V(a[0], a[1], a[2]);
const farc = (a, b) => FREN_R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
/// A direction `m` metres from `d` along the tangent `t` (a short step).
const along = (d, t, m) => d.clone().multiplyScalar(FREN_R).addScaledVector(t, m).normalize();
/// A place's direction (fren-pick.js PLACES), turned `turn` radians and `dm` metres further from the pad.
const placeAt = (key, turn = 0, dm = 0) => {
  const [az, m] = PLACES[key];
  return D(fromPad(az + turn, m + dm));
};
/// The tangent at `d` pointing toward the pad (and its right-hand neighbour).
const toPadAt = (d) => {
  const top = D(LANDING), t = top.clone().addScaledVector(d, -top.dot(d));
  return t.lengthSq() < 1e-8 ? V(0, 0, 1) : t.normalize();
};

/// A crisp pixel-art texture of a grid (fren-art.js).
function pixelTex(rows, opts) {
  const t = new THREE.CanvasTexture(pixelCanvas(rows, opts));
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/// A speech bubble in Frenpet's style (a white box with a black border, black text): a texture and its aspect.
function bubbleTex(text) {
  const c = document.createElement("canvas"), g = c.getContext("2d"), font = "600 30px ui-monospace, Menlo, monospace";
  g.font = font;
  const words = String(text).split(/\s+/), lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > 420 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3), w = Math.min(460, Math.max(...shown.map((l) => g.measureText(l).width))) + 40, h = shown.length * 38 + 30;
  c.width = Math.ceil(w);
  c.height = h + 14;
  g.fillStyle = "#151a16";
  g.fillRect(0, 0, c.width, h);
  g.fillStyle = "#ffffff";
  g.fillRect(4, 4, c.width - 8, h - 8);
  g.fillStyle = "#151a16";
  g.fillRect(c.width / 2 - 9, h, 18, 6);
  g.fillRect(c.width / 2 - 4, h + 6, 8, 8);
  g.font = font;
  g.textBaseline = "top";
  shown.forEach((l, i) => g.fillText(l, 20, 16 + i * 38));
  const t = texFromCanvas(c);
  t.magFilter = THREE.NearestFilter;
  return { t, aspect: c.width / c.height };
}

/// A board's face: a few words in big pixel letters, black on mint.
function signTex(lines, w = 512, h = 192) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#151a16";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#dcfde6";
  g.fillRect(10, 10, w - 20, h - 20);
  g.fillStyle = "#151a16";
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach(([text, size], i) => {
    g.font = `400 ${size}px Bungee, Impact, sans-serif`;
    g.fillText(text, w / 2, (h / (lines.length + 1)) * (i + 1), w - 40);
  });
  const t = texFromCanvas(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function createFren(W) {
  const group = new THREE.Group();
  group.position.set(0, R - FREN_R, 0);
  group.visible = false;
  W.scene.add(group);
  const rnd = mulberry32(5150);
  const top = D(LANDING), east = V(1, 0, 0), north = V(0, 0, 1);
  const place = (obj, d, h = 0, spin = 0) => {
    obj.position.copy(d).multiplyScalar(FREN_R + h);
    obj.quaternion.copy(W.frameAt(d, spin));
    group.add(obj);
    return obj;
  };
  /// Stand `obj` at `d` facing `look` (a direction on the ground: it faces toward it).
  const placeFacing = (obj, d, look, h = 0) => {
    obj.position.copy(d).multiplyScalar(FREN_R + h);
    obj.quaternion.copy(facing(d, look.clone().sub(d)));
    group.add(obj);
    return obj;
  };
  const mesh = (geo, color, extra) => {
    const m = new THREE.Mesh(geo, toon(color, extra));
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const box = (w, h, d, color, x = 0, y = 0, z = 0, parent = null) => {
    const m = mesh(new THREE.BoxGeometry(w, h, d), color);
    m.position.set(x, y, z);
    parent?.add(m);
    return m;
  };
  const obstacles = [];
  const circle = (d, r, opts = {}) => obstacles.push({ d, kind: "circle", r, ...opts, cos: Math.cos((r + 1) / FREN_R) });
  const keepOut = [{ d: top, r: 3.2 }]; // (trees and tufts stay clear of these)
  const free = (d, r) => !keepOut.some((k) => farc(k.d, d) < k.r + r);
  for (const p of PETS) keepOut.push({ d: D(p.home), r: 1.6 }); // (nothing grows where a pet lives)

  // Colours, before the post pass folds them into four greens (by brightness: light, mid, dark, ink).
  const C = { grass: 0xcdeed6, path: 0xf4fff7, wood: 0x98ab92, woodDark: 0x6f8170, roof: 0x5c6d5f, ink: 0x27312a, canopy: 0x3a4a3e, trunk: 0x56483a, stone: 0xb3bcb2, light: 0xe9f5ea, water: 0x86b2a6, red: 0xc9443a };

  // ---- the paths: pad to plaza and on to the cabin and the houses, round to the windmill and the field, down to the
  // pond, and the long way round to the tower
  const routes = [
    [top, placeAt("plaza"), placeAt("cabin", -0.15, -1.5)],
    [placeAt("plaza"), placeAt("houses", 0, -2.2), placeAt("pond", -0.12, -2.4)],
    [top, placeAt("windmill", 0.2, -2.2), placeAt("field", 0.15, -2.5)],
    [top, D(fromPad(Math.PI * 0.92, 5)), D(fromPad(Math.PI * 0.98, 8.5)), placeAt("tower", 0, -2.6)],
  ];
  const pathPts = [];
  for (const r of routes) for (let i = 0; i + 1 < r.length; i++) {
    const n = Math.max(2, Math.ceil(farc(r[i], r[i + 1]) / 0.4));
    for (let k = 0; k <= n; k++) pathPts.push(r[i].clone().lerp(r[i + 1], k / n).normalize());
  }
  const toPath = (d) => {
    let best = Infinity;
    for (const p of pathPts) best = Math.min(best, 1 - p.dot(d));
    return FREN_R * Math.acos(Math.min(1, Math.max(-1, 1 - best)));
  };

  // ---- the ground: a mint ball with lighter paths and a light plaza, and darker grass here and there
  {
    const geo = new THREE.IcosahedronGeometry(FREN_R, 22);
    const pos = geo.attributes.position, col = [], v = new THREE.Vector3(), c = new THREE.Color(), plaza = placeAt("plaza");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      pos.setXYZ(i, v.x * FREN_R, v.y * FREN_R, v.z * FREN_R);
      const onPath = toPath(v) < 0.75 || farc(v, plaza) < 2.4 || farc(v, top) < 2.6;
      const patch = Math.sin(v.x * 41 + v.z * 29) * Math.sin(v.y * 37 - v.x * 23) > 0.86; // (small, scattered: Frenpet's ground is mostly clean)
      c.setHex(onPath ? C.path : patch ? 0xa9cdb2 : C.grass);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    ground.receiveShadow = true;
    group.add(ground);
  }

  // ---- the landing pad, with the rocket home on it, and a sign welcoming you
  const { pad, rocket } = padAndRocket(mesh);
  place(pad, top, 0.02);
  place(rocket, top, 0.07, 0.6);
  circle(top.clone(), 0.75, { y1: 4.8 });
  const arrive = along(top, east, 3.6); // (out of the rocket's reach, so E on arrival pats or talks, not flies home)
  {
    const sign = new THREE.Group();
    for (const x of [-0.8, 0.8]) box(0.1, 1.3, 0.1, C.woodDark, x, 0.65, 0, sign);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.72), new THREE.MeshBasicMaterial({ map: signTex([["FRENPET WORLD", 64], ["WHERE IMD WAS BORN", 26]]), side: THREE.DoubleSide }));
    board.position.set(0, 1.35, 0.06);
    board.rotation.y = Math.PI; // (its face toward the pad side, where you arrive)
    sign.add(board);
    const d = along(along(top, east, 3.3), north, -1.6);
    placeFacing(sign, d, arrive);
    circle(d, 0.9, { y1: 1.8 });
  }

  // ---- the plaza: a statue of a pet on a stone plinth
  {
    const d = placeAt("plaza"), g = new THREE.Group();
    box(1.3, 0.7, 1.3, C.stone, 0, 0.35, 0, g);
    box(1.0, 0.12, 1.0, C.light, 0, 0.76, 0, g);
    const cat = new THREE.Sprite(new THREE.SpriteMaterial({ map: pixelTex(PET_ART.cat, { palette: { k: "#3a443d", g: "#c8d2c9", l: "#eef4ef" } }), alphaTest: 0.5 }));
    cat.center.set(0.5, 0);
    cat.scale.set(1.5 * (23 / 21), 1.5, 1);
    cat.position.y = 0.82;
    g.add(cat);
    W.noNormals.push(cat);
    W.flatNormals?.(cat); // (outlined as itself, not the plinth behind it)
    place(g, d);
    circle(d, 0.95, { y1: 2.3 });
    keepOut.push({ d, r: 2.6 });
  }

  // ---- the log cabin: walls of logs, a pitched roof, a chimney, a door and two windows (Frenpet's own house)
  {
    const d = placeAt("cabin"), g = new THREE.Group(), w = 3.4, dep = 2.4, hgt = 1.9;
    box(w, hgt, dep, C.wood, 0, hgt / 2, 0, g);
    for (let y = 0.14; y < hgt; y += 0.27) {
      for (const z of [-dep / 2, dep / 2]) {
        const log = mesh(new THREE.CylinderGeometry(0.12, 0.12, w + 0.3, 8), C.woodDark);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, y, z);
        g.add(log);
      }
    }
    const gable = mesh(new THREE.CylinderGeometry(1.25, 1.25, dep, 3), C.wood); // (a three-sided cylinder: a prism)
    gable.rotation.x = Math.PI / 2;
    gable.rotation.z = Math.PI / 2;
    gable.scale.set(1, 1, 0.62);
    gable.position.set(0, hgt + 0.36, 0);
    g.add(gable);
    for (const s of [-1, 1]) {
      const roof = box(w + 0.5, 0.14, 1.65, C.roof, 0, hgt + 0.55, s * 0.7, g);
      roof.rotation.x = s * 0.58;
    }
    box(0.42, 1.0, 0.42, C.stone, 1.0, hgt + 0.9, -0.4, g);
    box(0.5, 0.1, 0.5, C.ink, 1.0, hgt + 1.42, -0.4, g);
    box(0.7, 1.15, 0.08, C.ink, 0, 0.58, dep / 2 + 0.06, g);
    box(0.84, 0.1, 0.1, C.light, 0, 1.2, dep / 2 + 0.08, g);
    for (const x of [-1.05, 1.05]) {
      box(0.62, 0.55, 0.08, C.ink, x, 1.05, dep / 2 + 0.06, g);
      box(0.08, 0.6, 0.1, C.light, x, 1.05, dep / 2 + 0.09, g);
      box(0.66, 0.08, 0.1, C.light, x, 1.05, dep / 2 + 0.09, g);
    }
    placeFacing(g, d, top);
    circle(d, 2.0, { wall: { h: 3.2 } });
    keepOut.push({ d, r: 3.0 });
    // Fences either side of the cabin, like the picture postcard.
    const right = new THREE.Vector3().crossVectors(d, toPadAt(d)).normalize();
    for (const s of [-1, 1]) fence(along(d, right, s * 2.6), along(along(d, right, s * 5.4), toPadAt(d), 0.2));
  }

  /// A wooden fence from `a` to `b`: posts every metre or so and two rails.
  function fence(a, b) {
    const n = Math.max(1, Math.round(farc(a, b) / 1.1));
    const pts = Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n).normalize());
    for (const p of pts) {
      const post = new THREE.Group();
      box(0.12, 0.75, 0.12, C.wood, 0, 0.37, 0, post);
      box(0.16, 0.06, 0.16, C.woodDark, 0, 0.77, 0, post);
      place(post, p);
      circle(p, 0.12, { y1: 0.8 });
    }
    for (let i = 0; i < n; i++) {
      const m = pts[i].clone().add(pts[i + 1]).normalize(), len = farc(pts[i], pts[i + 1]);
      const rails = new THREE.Group();
      for (const y of [0.32, 0.6]) box(len, 0.07, 0.06, C.light, 0, y, 0, rails);
      const dir = pts[i + 1].clone().sub(pts[i]);
      rails.position.copy(m).multiplyScalar(FREN_R);
      rails.quaternion.copy(facing(m, dir));
      rails.rotateY(Math.PI / 2);
      group.add(rails);
    }
  }

  /// A blocky tree (dark square canopy with drips, like Frenpet's) or a round one.
  function tree(d, size = 1, round = false) {
    const g = new THREE.Group();
    box(0.18 * size, 1.0 * size, 0.18 * size, C.trunk, 0, 0.5 * size, 0, g);
    if (round) {
      const c = mesh(new THREE.IcosahedronGeometry(0.85 * size, 0), C.canopy);
      c.position.y = 1.55 * size;
      g.add(c);
    } else {
      box(1.35 * size, 1.05 * size, 1.35 * size, C.canopy, 0, 1.55 * size, 0, g);
      for (let i = 0; i < 5; i++) box(0.12 * size, (0.18 + (i % 3) * 0.1) * size, 0.12 * size, C.canopy, (-0.5 + i * 0.25) * size, 0.95 * size, 0.66 * size, g);
    }
    place(g, d, 0, rnd() * 6);
    circle(d, 0.22 * size, { y1: 2.2 * size });
    keepOut.push({ d, r: 0.9 * size });
  }

  // ---- the windmill: a tapering wooden tower, a cap and four turning sails
  const sails = new THREE.Group();
  {
    const d = placeAt("windmill"), g = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(0.75, 1.15, 3.6, 8), C.wood);
    body.position.y = 1.8;
    g.add(body);
    const cap = mesh(new THREE.ConeGeometry(1.0, 1.0, 8), C.roof);
    cap.position.y = 4.1;
    g.add(cap);
    box(0.6, 0.95, 0.06, C.ink, 0, 0.5, 1.12, g);
    sails.position.set(0, 3.3, 0.95);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      box(0.1, 2.2, 0.06, C.woodDark, 0, 1.1, 0, arm);
      box(0.55, 1.7, 0.03, C.light, 0.3, 1.25, 0, arm);
      sails.add(arm);
    }
    box(0.22, 0.22, 0.3, C.ink, 0, 0, -0.1, sails);
    g.add(sails);
    placeFacing(g, d, top);
    circle(d, 1.2, { wall: { h: 4.5 } });
    keepOut.push({ d, r: 2.2 });
  }

  // ---- the houses: two-storey wooden houses with pitched roofs
  for (const [turn, dm, w, h] of [[-0.24, 0, 2.6, 2.6], [0.26, 0.5, 2.2, 3.1]]) {
    const d = placeAt("houses", turn, dm), g = new THREE.Group(), dep = 2.0;
    box(w, h, dep, C.wood, 0, h / 2, 0, g);
    box(w + 0.1, 0.12, dep + 0.1, C.woodDark, 0, h * 0.5, 0, g);
    const gable = mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.42, dep, 3), C.wood);
    gable.rotation.x = Math.PI / 2;
    gable.rotation.z = Math.PI / 2;
    gable.scale.set(1, 1, 0.75);
    gable.position.set(0, h + 0.3, 0);
    g.add(gable);
    for (const s of [-1, 1]) box(w + 0.4, 0.13, dep * 0.72, C.roof, 0, h + 0.48, s * dep * 0.31, g).rotation.x = s * 0.7;
    box(0.6, 1.0, 0.08, C.ink, -w * 0.22, 0.5, dep / 2 + 0.05, g);
    for (const [x, y] of [[w * 0.22, 0.75], [-w * 0.22, h * 0.75], [w * 0.22, h * 0.75]]) {
      box(0.5, 0.45, 0.08, C.ink, x, y, dep / 2 + 0.05, g);
      box(0.56, 0.06, 0.1, C.light, x, y, dep / 2 + 0.08, g);
    }
    placeFacing(g, d, placeAt("plaza"));
    circle(d, w * 0.62, { wall: { h: h + 1 } });
    keepOut.push({ d, r: w * 0.9 });
  }

  // ---- the pond, with stones round it, reeds and a little dock
  {
    const d = placeAt("pond"), g = new THREE.Group(), r = 2.4;
    const water = new THREE.Mesh(new THREE.CircleGeometry(r, 28), toon(C.water));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.03;
    g.add(water);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2, s = mesh(new THREE.DodecahedronGeometry(0.17 + (i % 3) * 0.05, 0), i % 2 ? C.stone : C.light);
      s.position.set(Math.cos(a) * (r + 0.1), 0.06, Math.sin(a) * (r + 0.1));
      g.add(s);
    }
    for (let i = 0; i < 6; i++) {
      const a = 2.2 + i * 0.32, reed = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.8, 4), C.canopy);
      reed.position.set(Math.cos(a) * (r - 0.25), 0.4, Math.sin(a) * (r - 0.25));
      g.add(reed);
    }
    for (const [x, z] of [[0.6, -0.5], [-0.8, 0.4], [0.2, 0.9]]) {
      const pad = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 10), C.canopy);
      pad.position.set(x, 0.05, z);
      g.add(pad);
    }
    box(0.7, 0.08, 1.6, C.wood, 0, 0.12, r - 0.3, g);
    placeFacing(g, d, top);
    circle(d, r, { wall: { h: 0.4 } });
    keepOut.push({ d, r: r + 1 });
  }

  // ---- the sprout field: rows of sprouts in dark soil, fenced
  {
    const d = placeAt("field"), g = new THREE.Group();
    box(3.4, 0.06, 2.6, C.trunk, 0, 0.03, 0, g);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
      const s = mesh(new THREE.ConeGeometry(0.1, 0.32, 5), C.canopy);
      s.position.set(-1.35 + j * 0.54, 0.2, -0.95 + i * 0.63);
      g.add(s);
    }
    placeFacing(g, d, top);
    circle(d, 1.6, { y1: 0.3 });
    keepOut.push({ d, r: 2.4 });
  }

  // ---- the stone tower, where IMD was born: four storeys with balconies, a red pagoda roof and a flag
  let towerD;
  {
    const d = (towerD = placeAt("tower")), g = new THREE.Group();
    let y = 0;
    const tiers = [[1.7, 2.0], [1.5, 1.7], [1.35, 1.6], [1.2, 1.5]];
    tiers.forEach(([r, h], i) => {
      const tier = mesh(new THREE.CylinderGeometry(r * 0.94, r, h, 10), C.stone);
      tier.position.y = y + h / 2;
      g.add(tier);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + (i % 2) * 0.4;
        const win = box(0.32, 0.5, 0.08, C.ink, Math.sin(a) * r * 0.96, y + h * 0.55, Math.cos(a) * r * 0.96, g);
        win.rotation.y = a;
      }
      if (i > 0) {
        const deck = mesh(new THREE.CylinderGeometry(r + 0.35, r + 0.35, 0.12, 12), C.woodDark);
        deck.position.y = y + 0.06;
        g.add(deck);
        const rail = mesh(new THREE.TorusGeometry(r + 0.3, 0.035, 4, 24), C.light);
        rail.rotation.x = Math.PI / 2;
        rail.position.y = y + 0.42;
        g.add(rail);
      }
      y += h;
    });
    box(0.7, 1.15, 0.12, C.ink, 0, 0.58, 1.66, g); // the door, toward the pad
    const roof = mesh(new THREE.ConeGeometry(1.95, 1.5, 10), C.red);
    roof.position.y = y + 0.72;
    g.add(roof);
    const eave = mesh(new THREE.TorusGeometry(1.75, 0.09, 5, 20), C.red);
    eave.rotation.x = Math.PI / 2;
    eave.position.y = y + 0.06;
    g.add(eave);
    box(0.05, 1.1, 0.05, C.ink, 0, y + 1.9, 0, g);
    box(0.5, 0.3, 0.03, C.red, 0.27, y + 2.25, 0, g);
    placeFacing(g, d, top);
    circle(d, 1.75, { wall: { h: 9 } });
    keepOut.push({ d, r: 3.2 });
    const r2 = new THREE.Vector3().crossVectors(d, toPadAt(d)).normalize();
    tree(along(along(d, r2, 3.4), toPadAt(d), -0.6), 1.15, true);
    tree(along(along(d, r2, -3.6), toPadAt(d), -0.4), 1.2);
  }

  // ---- trees and bushes: a forest round the far side, and a few about the village
  for (let i = 0; i < 1400; i++) {
    const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), d = V(s * Math.cos(t), z, s * Math.sin(t));
    const far = farc(d, top), forest = farc(d, placeAt("forest")) < 9 || far > 34;
    if (!forest && (far < 7 || rnd() > 0.06)) continue;
    if (toPath(d) < 1.6 || !free(d, 1.0)) continue;
    tree(d, 0.85 + rnd() * 0.45, rnd() < 0.3);
    if (keepOut.length > 90) break;
  }
  // Grass tufts and little white flowers scattered over the grass (instanced: hundreds for the cost of two meshes).
  {
    const tuftGeo = new THREE.ConeGeometry(0.07, 0.24, 4), flowerGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const tufts = new THREE.InstancedMesh(tuftGeo, toon(C.canopy), 260), flowers = new THREE.InstancedMesh(flowerGeo, toon(0xffffff), 90);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(1, 1, 1);
    let nt = 0, nf = 0;
    for (let i = 0; i < 4000 && (nt < 260 || nf < 90); i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), d = V(s * Math.cos(t), z, s * Math.sin(t));
      if (toPath(d) < 0.9 || !free(d, 0.2)) continue;
      q.copy(W.frameAt(d, rnd() * 6));
      if (nt < 260) {
        m4.compose(d.clone().multiplyScalar(FREN_R + 0.1), q, sc);
        tufts.setMatrixAt(nt++, m4);
      } else if (nf < 90) {
        m4.compose(d.clone().multiplyScalar(FREN_R + 0.06), q, sc);
        flowers.setMatrixAt(nf++, m4);
      }
    }
    tufts.count = nt;
    flowers.count = nf;
    group.add(tufts, flowers);
  }

  // ---- up in the sky: a floating island with a little tower and a waterfall, and blocky clouds going round
  const sky = new THREE.Group();
  {
    const isle = new THREE.Group();
    const rock = mesh(new THREE.ConeGeometry(2.2, 3.0, 7), C.stone);
    rock.rotation.x = Math.PI;
    rock.position.y = -1.5;
    isle.add(rock);
    const lawn = mesh(new THREE.CylinderGeometry(2.25, 2.2, 0.35, 7), C.grass);
    isle.add(lawn);
    const t = mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.6, 8), C.light);
    t.position.set(0.5, 0.95, 0);
    isle.add(t);
    const tr = mesh(new THREE.ConeGeometry(0.62, 0.6, 8), C.red);
    tr.position.set(0.5, 2.05, 0);
    isle.add(tr);
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4.5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    fall.position.set(-1.6, -2.0, 0.6);
    isle.add(fall);
    W.noNormals.push(fall);
    const d = D(fromPad(2.7, 19));
    place(isle, d, 10, 0.4);
  }
  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Group();
    for (let k = 0; k < 3; k++) box(1.4 + rnd() * 1.4, 0.6 + rnd() * 0.4, 1.0 + rnd() * 0.6, 0xffffff, k * 1.1 - 1.1, rnd() * 0.3, rnd() * 0.4, cloud);
    const z = rnd() * 1.6 - 0.8, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), d = V(s * Math.cos(t), z, s * Math.sin(t));
    cloud.position.copy(d).multiplyScalar(FREN_R + 9 + rnd() * 4);
    cloud.quaternion.copy(W.frameAt(d, rnd() * 6));
    sky.add(cloud);
  }
  group.add(sky);

  // ---- the pets: sprites that wander near their homes, hop as they walk, face the way they go, and stop to be patted
  const petTex = {};
  for (const k of Object.keys(PET_ART)) petTex[k] = [pixelTex(PET_ART[k]), pixelTex(PET_ART[k], { flip: true })];
  // (A small pixel shadow under each pet sits it on the ground, and stays put while it hops.)
  const shadowGeo = new THREE.CircleGeometry(1, 10), shadowMat = new THREE.MeshBasicMaterial({ color: 0x8aa491 });
  const pets = PETS.map((p, i) => {
    const art = PET_ART[p.kind], tall = p.kind === "dragon" ? 1.3 : 1.15;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: petTex[p.kind][0], alphaTest: 0.5 }));
    spr.center.set(0.5, 0);
    spr.scale.set(tall * (art[0].length / art.length), tall, 1);
    group.add(spr);
    W.noNormals.push(spr);
    const twin = W.flatNormals?.(spr) ?? null;
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.scale.set(spr.scale.x * 0.42, spr.scale.x * 0.42, 1);
    group.add(shadow);
    const home = D(p.home);
    return { ...p, spr, twin, shadow, tall, homeV: home, at: home.clone(), to: home.clone(), mode: "idle", wait: 1 + (i % 5), ph: i * 1.7, right: i % 2 === 0, patters: new Map(), look: null };
  });
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const placePet = (p, hop) => {
    p.spr.position.copy(p.at).multiplyScalar(FREN_R + hop);
    p.shadow.position.copy(p.at).multiplyScalar(FREN_R + 0.015);
    p.shadow.quaternion.copy(W.frameAt(p.at, 0)).multiply(flat);
  };

  // Hearts that float up from a patted pet (a small pool), and the bubbles pets say things in.
  const heartTex = pixelTex(HEART_ART);
  const hearts = Array.from({ length: 18 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
    s.scale.set(0.32, 0.27, 1);
    s.visible = false;
    group.add(s);
    W.noNormals.push(s);
    return { s, life: 0, d: null, h: 0, dx: 0 };
  });
  function burst(p, n = 3) {
    for (let i = 0; i < n; i++) {
      const h = hearts.find((x) => x.life <= 0);
      if (!h) return;
      Object.assign(h, { life: 1.3 + i * 0.15, d: p.at.clone(), h: p.tall * 0.95, dx: (i - (n - 1) / 2) * 0.28 });
      h.s.visible = true;
    }
  }
  let bubble = null; // { s (sprite), pet, left (seconds) }
  function petSay(p, text, secs = 4.5) {
    if (bubble) {
      if (bubble.twin) W.dropFlatNormals?.(bubble.twin);
      W.noNormals.splice(W.noNormals.indexOf(bubble.s) >>> 0, 1);
      group.remove(bubble.s);
      bubble.s.material.map.dispose();
      bubble.s.material.dispose();
    }
    const { t, aspect } = bubbleTex(text), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.center.set(0.5, 0);
    s.scale.set(0.85 * aspect, 0.85, 1); // (big enough to read through the chunky pixels)
    s.renderOrder = 5;
    group.add(s);
    W.noNormals.push(s);
    const twin = W.flatNormals?.(s, { depthTest: false }) ?? null; // (no lines through the words)
    bubble = { s, twin, pet: p, left: secs };
  }

  // ADAM, IMD's founder, at the tower door: someone to talk to (E), like the moon's frogs.
  const locals = createLocals(FREN_R);
  {
    const g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: pixelTex(ADAM_ART), alphaTest: 0.5 }));
    spr.center.set(0.5, 0);
    spr.scale.set(1.75 * (20 / 23), 1.75, 1);
    body.add(spr);
    W.noNormals.push(spr);
    W.flatNormals?.(spr);
    const d = D(ADAM.home);
    g.position.copy(d).multiplyScalar(FREN_R);
    g.quaternion.copy(facing(d, top.clone().sub(d)));
    group.add(g);
    circle(d.clone(), 0.35, { y1: 1.7 });
    locals.add({ g, body, eyes: [], tips: [] }, d, ADAM.name, [
      "Welcome to Frenpet World. This is where IMD was born.",
      "Sit down by a pet and give it a pat. They remember everyone who comes back.",
      "Every pet here has a name. Pat one every day and you'll be friends for life.",
      "This tower is where it all started. A few frens, a few pets, and a lot of late nights.",
      "Say something nice to them while you pat. They're good listeners.",
    ], 0.4);
  }

  const cam = new THREE.Vector3(), camRight = new THREE.Vector3(), tmp = new THREE.Vector3();
  return {
    group,
    /// What main.js walks on here.
    ground: {
      key: "fren", R: FREN_R, center: group.position.clone(), group, gravity: FREN_GRAVITY, obstacles,
      terrain: { surfaceAt: () => 0, baseAt: () => 0, waterAt: () => null, ramps: [], inRamp: () => null },
    },
    /// Where you step out (beside the pad, facing the sign) and the rocket home (stand within `reach`).
    arrival: { d: arrive, tangent: north.clone() },
    rocket: { d: top.clone(), reach: 2.9 },
    /// Where ADAM and the tower are (for the map).
    places: { tower: towerD, adam: D(ADAM.home) },
    /// ADAM, within `reach` metres of `me`: { name, line(), talk(on) }, or null.
    nearestLocal: (me, reach) => locals.nearest(me, reach),
    /// The pet within `reach` metres of `me` (where it is now), nearest first: its pet record, or null.
    nearestPet(me, reach = 1.6) {
      let best = null, bd = reach;
      for (const p of pets) {
        const dd = farc(p.at, me);
        if (dd < bd) [best, bd] = [p, dd];
      }
      return best;
    },
    /// Courier `who` (an id, or "me") sits by pet `id` at `me` (a direction): it stops, turns to them and is happy.
    /// `front` (yours): where in front of you it hops to, to be patted (never further than a short hop from its home).
    /// (Others' pats wear off after a while if no word comes that they got up: a lost connection, say.)
    patStart(id, me, who = "me", front = null) {
      const p = pets.find((x) => x.id === id);
      if (!p) return;
      p.patters.set(who, who === "me" ? Infinity : performance.now() + 60_000);
      if (me) p.look = me.clone();
      if (front && farc(front, p.homeV) < p.wander + 1.5) p.at.copy(front);
      p.mode = "pat";
      p.wait = 0;
      burst(p, 3);
    },
    patEnd(id, who = "me") {
      const p = pets.find((x) => x.id === id);
      if (!p) return;
      p.patters.delete(who);
      if (!p.patters.size && p.mode === "pat") {
        p.mode = "idle";
        p.wait = 1.5;
      }
    },
    /// A few more hearts (a pat), and a line from the pet in a bubble.
    hearts: (id, n = 2) => {
      const p = pets.find((x) => x.id === id);
      if (p) burst(p, n);
    },
    say(id, text, secs) {
      const p = pets.find((x) => x.id === id);
      if (p) petSay(p, text, secs);
    },
    /// The pets (wander, hop, face their way, hearts and bubbles), ADAM, the windmill and the clouds.
    update(dt, t, { me }) {
      locals.update(dt, t, me);
      sails.rotation.z -= dt * 0.8;
      sky.rotation.y += dt * 0.006;
      const camera = W.camera;
      if (camera) {
        camera.getWorldPosition(cam);
        camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      }
      for (const p of pets) {
        let hop = 0;
        if (p.mode === "pat") {
          for (const [who, until] of p.patters) if (performance.now() > until) p.patters.delete(who);
          if (!p.patters.size) [p.mode, p.wait] = ["idle", 1.5];
          // Turned to whoever's patting, bouncing happily now and then.
          if (p.look) p.right = tmp.copy(p.look).sub(p.at).dot(camRight) > 0;
          hop = Math.max(0, Math.sin(t * 7 + p.ph)) * 0.06;
        } else if (p.mode === "walk") {
          const left = farc(p.at, p.to), step = Math.min(left, dt * 0.9);
          if (left < 0.05) {
            p.mode = "idle";
            p.wait = 2 + rnd() * 5;
          } else {
            const dir = p.to.clone().sub(p.at);
            p.right = dir.dot(camRight) > 0;
            p.at.lerp(p.to, step / left).normalize();
            hop = Math.abs(Math.sin(t * 9 + p.ph)) * 0.18;
          }
        } else {
          p.wait -= dt;
          if (p.wait <= 0) {
            // Somewhere new near home (never further than its roam, which the room allows for).
            const a = rnd() * Math.PI * 2, r = 0.4 + rnd() * (p.wander - 0.4);
            const t1 = new THREE.Vector3().crossVectors(p.homeV, east).normalize(), t2 = new THREE.Vector3().crossVectors(p.homeV, t1);
            p.to = along(p.homeV, t1.multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)), r);
            p.mode = "walk";
          }
        }
        placePet(p, hop);
        const want = petTex[p.kind][p.right ? 0 : 1];
        if (p.spr.material.map !== want) {
          p.spr.material.map = want;
          if (p.twin) p.twin.material.map = want;
        }
        // Breathing when still, squash on landing when hopping.
        const sq = p.mode === "walk" ? 1 - 0.06 * Math.max(0, Math.cos(t * 18 + p.ph * 2)) : 1 + 0.02 * Math.sin(t * 2.4 + p.ph);
        p.spr.scale.y = p.tall * sq;
      }
      for (const h of hearts) {
        if (h.life <= 0) continue;
        h.life -= dt;
        const k = Math.max(0, h.life);
        h.s.visible = h.life > 0 && h.life < 1.3;
        const rise = (1.3 - Math.min(1.3, k)) * 1.0;
        h.s.position.copy(h.d).multiplyScalar(FREN_R + h.h + rise);
        tmp.copy(camRight).multiplyScalar(h.dx + Math.sin((t + h.dx) * 5) * 0.06);
        h.s.position.add(tmp);
        h.s.material.opacity = Math.min(1, k * 2);
      }
      if (bubble) {
        bubble.left -= dt;
        bubble.s.position.copy(bubble.pet.at).multiplyScalar(FREN_R + bubble.pet.tall + 0.35);
        if (bubble.left <= 0) {
          if (bubble.twin) W.dropFlatNormals?.(bubble.twin);
          W.noNormals.splice(W.noNormals.indexOf(bubble.s) >>> 0, 1);
          group.remove(bubble.s);
          bubble.s.material.map.dispose();
          bubble.s.material.dispose();
          bubble = null;
        }
      }
    },
  };
}
