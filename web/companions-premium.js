// Courier Companions, the top tiers (companion-kinds.js has the list): the Mecha Guardian, the Colossus, and the three
// anime-style companions Sakura, Luna and Hana. All five are Courier World's own designs. Each builder returns
// { group, animate(dt, t, speed) }: the group stands with its feet at y 0 facing +z, and animate moves it every frame
// (speed 0 idle, about 0.62 walking, 1 running). companions.js puts them in the world and walks them after you.
//
// Like the courier, the parts that don't move on their own are merged per joint (compact() from character.js), so a
// mech of sixty parts draws in a handful of calls. The glowing bits stay apart: they're unlit (so they shine at
// night) and opaque (the ink pass outlines them like everything else).
import * as THREE from "https://esm.sh/three@0.160.0";
import { RoundedBoxGeometry } from "https://esm.sh/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js";
import { toon } from "./world.js";
import { createCharacter, compact } from "./character.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x || 0));
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ball = (r, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.6)));
const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, r);
const cyl = (rt, rb, h, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg);

/// One companion's parts: add() makes a cel-shaded mesh (one material per colour), glow() an unlit one with a
/// material of its own (so it can be dimmed and brightened by itself).
function kit() {
  const mats = new Map();
  const mat = (c) => {
    if (!mats.has(c)) mats.set(c, toon(c));
    return mats.get(c);
  };
  const put = (m, parent, x, y, z) => {
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const add = (parent, geo, color, x = 0, y = 0, z = 0) => put(new THREE.Mesh(geo, mat(color)), parent, x, y, z);
  const glow = (parent, geo, color, x = 0, y = 0, z = 0, opts = {}) => {
    const m = put(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, ...opts })), parent, x, y, z);
    m.castShadow = false;
    return m;
  };
  return { add, glow };
}

/// A thin rod from a to b.
function rod(add, parent, a, b, r, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = add(parent, cyl(r, r, d.length(), 6), color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/// A thruster's flame: an unlit teardrop, pale at the nozzle fading to orange at the tip. Its group's origin is the
/// nozzle and its +y the way the flame points, so scaling y throttles it.
function flame(glow, parent, len, r) {
  const outline = [[0, 0], [0.75, 0], [1.1, 0.12], [0.95, 0.35], [0.5, 0.7], [0, 1]].map(([w, h]) => new THREE.Vector2(w * r, h * len));
  const geo = new THREE.LatheGeometry(outline, 10);
  const pos = geo.attributes.position, col = [], hot = new THREE.Color(0xfff4c2), tip = new THREE.Color(0xff8a2a), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.lerpColors(hot, tip, Math.min(1, (pos.getY(i) / len) * 1.5));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const f = new THREE.Group();
  parent.add(f);
  glow(f, geo, 0xffffff, 0, 0, 0, { vertexColors: true });
  return f;
}

/// A chunky boulder: a low-poly ball with its corners pushed in and out a little, flat-shaded so each facet catches
/// the light. Corners are moved by where they are (not by which face they belong to), so the faces stay joined.
function boulder(r, seed) {
  const geo = (seed % 2 ? new THREE.IcosahedronGeometry(r, 0) : new THREE.DodecahedronGeometry(r, 0)).rotateY(seed * 1.7).rotateX(seed * 0.9);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(Math.round(v.x * 1e4) * 0.0127 + Math.round(v.y * 1e4) * 0.0311 + Math.round(v.z * 1e4) * 0.0075 + seed * 19.3) * 43758.5453;
    v.multiplyScalar(1 + (h - Math.floor(h) - 0.5) * 0.2);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/// A crescent moon's outline (radius r, horns toward +x), to extrude.
function crescentShape(r) {
  const shape = new THREE.Shape(), d = 0.35, n = 20;
  const r2 = Math.hypot(0.5 - d, Math.sin(Math.PI / 3)), horn = Math.atan2(Math.sin(Math.PI / 3), 0.5 - d); // the inner circle meets the outer at the horns
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 3 + (i / n) * ((Math.PI * 4) / 3); // the outer edge, round the back
    if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  for (let i = 1; i < n; i++) {
    const a = 2 * Math.PI - horn - (i / n) * (2 * Math.PI - 2 * horn); // the inner edge, back to the first horn
    shape.lineTo((d + Math.cos(a) * r2) * r, Math.sin(a) * r2 * r);
  }
  return shape;
}
/// A five-pointed star's outline (radius r, a point up), to extrude.
function starShape(r) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, k = i % 2 ? r * 0.45 : r;
    if (i) shape.lineTo(Math.sin(a) * k, Math.cos(a) * k);
    else shape.moveTo(Math.sin(a) * k, Math.cos(a) * k);
  }
  return shape;
}
/// A flat shape made solid, `depth` thick (centred on z 0) with softened edges.
const slab = (shape, depth, bevel) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 }).translate(0, 0, -depth / 2);

// ---------------------------------------------------------------- 31: the Mecha Guardian

/// A chunky, friendly mini mech (about 1.1 m) in white with teal and orange: one wide glowing visor, round shoulder
/// pads, a backpack with two thrusters and jet boots. It stomps along at a walk; when you run it lifts off on its jets
/// and glides after you (its little legs couldn't keep up otherwise).
function mecha() {
  const { add, glow } = kit();
  const group = new THREE.Group(), body = new THREE.Group(); // body: bobs as it stomps, lifts off on the jets
  group.add(body);
  const WHITE = 0xf1f2ee, GREY = 0xd2d7da, JOINT = 0x3d4448, TEAL = 0x2fa39d, ORANGE = 0xf5913e, FRAME = 0x1c2430;
  const VISOR = new THREE.Color(0x8ff0ff), VISOR_DIM = new THREE.Color(0x3d8f99);
  const COLD = new THREE.Color(0x2c4a50), LIT = new THREE.Color(0xa6f7ff); // the nozzles, resting and firing
  const nozzles = [], packFlames = [], bootFlames = [];
  const nozzle = (parent, r, x, y, z, turn) => {
    const m = glow(parent, cyl(r, r, 0.012, 12), COLD.getHex(), x, y, z);
    m.rotation.x = turn;
    nozzles.push(m);
  };

  // ---- legs: short and sturdy, in big jet boots with a nozzle in each heel
  const hips = [], knees = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.12, 0.42, 0);
    body.add(hip);
    hips.push(hip);
    add(hip, new THREE.CapsuleGeometry(0.058, 0.1, 4, 10), JOINT, 0, -0.09, 0);
    add(hip, rbox(0.15, 0.1, 0.17, 0.04), GREY, 0, -0.075, 0);
    add(hip, rbox(0.1, 0.03, 0.02, 0.01), TEAL, 0, -0.07, 0.085);
    const knee = new THREE.Group();
    knee.position.set(0, -0.19, 0);
    hip.add(knee);
    knees.push(knee);
    add(knee, ball(0.062, 12), ORANGE, 0, 0, 0.04);
    add(knee, rbox(0.16, 0.13, 0.18, 0.04), WHITE, 0, -0.07, 0);
    add(knee, new THREE.TorusGeometry(0.07, 0.018, 6, 16).rotateX(Math.PI / 2), TEAL, 0, -0.135, 0);
    add(knee, rbox(0.2, 0.11, 0.3, 0.045), WHITE, 0, -0.17, 0.03);
    add(knee, rbox(0.21, 0.035, 0.31, 0.015), JOINT, 0, -0.2125, 0.03);
    add(knee, rbox(0.16, 0.03, 0.07, 0.012), ORANGE, 0, -0.118, 0.14);
    add(knee, cyl(0.032, 0.045, 0.06, 12).rotateX(Math.PI / 2), JOINT, 0, -0.165, -0.14);
    nozzle(knee, 0.03, 0, -0.165, -0.171, Math.PI / 2);
    const f = flame(glow, knee, 0.22, 0.032);
    f.position.set(0, -0.165, -0.175);
    f.rotation.x = -2.1; // down and back
    bootFlames.push(f);
  }

  // ---- hips and body: a white chest with an orange band, a teal panel and a courier's badge (an envelope)
  add(body, rbox(0.34, 0.12, 0.23, 0.045), GREY, 0, 0.46, 0);
  add(body, rbox(0.14, 0.08, 0.04, 0.015), TEAL, 0, 0.46, 0.12);
  const torso = new THREE.Group();
  torso.position.set(0, 0.5, 0);
  body.add(torso);
  add(torso, cyl(0.12, 0.14, 0.1), JOINT, 0, 0.02, 0);
  add(torso, rbox(0.48, 0.3, 0.32, 0.08), WHITE, 0, 0.18, 0);
  add(torso, rbox(0.49, 0.045, 0.33, 0.02), ORANGE, 0, 0.06, 0);
  add(torso, rbox(0.28, 0.13, 0.04, 0.02), TEAL, 0, 0.21, 0.155);
  add(torso, rbox(0.11, 0.07, 0.02, 0.008), WHITE, 0, 0.21, 0.178);
  for (const s of [-1, 1]) add(torso, new THREE.BoxGeometry(0.065, 0.012, 0.01), ORANGE, s * 0.0275, 0.2275, 0.19).rotation.z = s * 0.567;
  add(torso, cyl(0.09, 0.11, 0.07), JOINT, 0, 0.36, 0);

  // ---- the backpack: vents on the back, two thrusters underneath
  add(torso, rbox(0.32, 0.28, 0.13, 0.05), TEAL, 0, 0.2, -0.2);
  add(torso, rbox(0.33, 0.06, 0.14, 0.025), WHITE, 0, 0.33, -0.2);
  for (const y of [0.13, 0.18, 0.23]) add(torso, rbox(0.16, 0.022, 0.02, 0.008), JOINT, 0, y, -0.267);
  for (const s of [-1, 1]) {
    add(torso, rbox(0.03, 0.18, 0.1, 0.012), ORANGE, s * 0.162, 0.2, -0.2);
    add(torso, cyl(0.04, 0.055, 0.09, 12), JOINT, s * 0.08, 0.03, -0.22);
    nozzle(torso, 0.045, s * 0.08, -0.016, -0.22, 0);
    const f = flame(glow, torso, 0.32, 0.045);
    f.position.set(s * 0.08, -0.02, -0.22);
    f.rotation.x = -2.6; // down and well back, clear of the legs
    packFlames.push(f);
  }

  // ---- head: a rounded helmet, a wide visor with two bright eyes in it, round ear pods, one aerial
  const head = new THREE.Group();
  head.position.set(0, 0.38, 0);
  torso.add(head);
  add(head, rbox(0.36, 0.25, 0.32, 0.09), WHITE, 0, 0.115, 0);
  add(head, rbox(0.07, 0.03, 0.27, 0.012), TEAL, 0, 0.237, -0.01);
  add(head, rbox(0.32, 0.11, 0.04, 0.03), FRAME, 0, 0.11, 0.148);
  const visor = glow(head, rbox(0.28, 0.072, 0.03, 0.02), VISOR.getHex(), 0, 0.11, 0.162);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = glow(head, new THREE.CapsuleGeometry(0.013, 0.02, 4, 8), 0xf4ffff, s * 0.058, 0.112, 0.177);
    e.scale.z = 0.5;
    eyes.push(e);
    add(head, cyl(0.058, 0.058, 0.05, 16).rotateZ(Math.PI / 2), TEAL, s * 0.19, 0.11, -0.01);
    add(head, cyl(0.033, 0.033, 0.02, 12).rotateZ(Math.PI / 2), ORANGE, s * 0.22, 0.11, -0.01);
  }
  add(head, rbox(0.1, 0.028, 0.02, 0.01), GREY, 0, 0.035, 0.16);
  rod(add, head, V(-0.22, 0.13, -0.03), V(-0.24, 0.3, -0.09), 0.007, GREY);
  add(head, ball(0.02, 8), ORANGE, -0.24, 0.3, -0.09);

  // ---- arms: big round shoulder pads trimmed in orange, chunky forearms, round fists
  const shoulders = [], elbows = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.3, 0.27, 0);
    torso.add(sh);
    shoulders.push(sh);
    add(sh, ball(0.125, 18), WHITE, s * 0.015, 0.03, 0).scale.set(1, 0.85, 1.05);
    add(sh, new THREE.TorusGeometry(0.112, 0.02, 6, 22).rotateX(Math.PI / 2), ORANGE, s * 0.015, -0.01, 0);
    add(sh, cyl(0.045, 0.045, 0.02, 14).rotateZ(Math.PI / 2), TEAL, s * 0.135, 0.035, 0);
    add(sh, new THREE.CapsuleGeometry(0.045, 0.08, 4, 10), JOINT, 0, -0.12, 0);
    const el = new THREE.Group();
    el.position.set(0, -0.19, 0);
    sh.add(el);
    elbows.push(el);
    add(el, ball(0.05, 10), JOINT, 0, 0, 0);
    add(el, rbox(0.13, 0.17, 0.14, 0.04), WHITE, 0, -0.08, 0);
    add(el, rbox(0.136, 0.035, 0.146, 0.012), TEAL, 0, -0.03, 0);
    add(el, ball(0.062, 12), JOINT, 0, -0.2, 0.01);
  }
  compact(group);

  let phase = 0, blink = 2.5, flicker = 4 + Math.random() * 5;
  function animate(dt, t, speed) {
    speed = clamp01(speed);
    // walk: how much it's stomping; jet: how far it has lifted off (running); still: how idle it is
    const k = Math.min(1, speed / 0.62), jet = smooth(0.8, 0.97, speed), walk = k * (1 - jet), still = 1 - k;
    phase += dt * (3.2 + 6 * speed) * (1 - jet);
    const s = Math.sin(phase), c = Math.cos(phase);
    // Legs stride (each knee bending as its foot swings through); on the jets they hang together, toes down.
    hips[0].rotation.x = s * 0.42 * walk + 0.12 * jet;
    hips[1].rotation.x = -s * 0.42 * walk + 0.12 * jet;
    knees[0].rotation.x = 0.55 * walk * Math.max(0, -c) + 0.25 * jet;
    knees[1].rotation.x = 0.55 * walk * Math.max(0, c) + 0.25 * jet;
    // Arms swing against the legs; on the jets they sweep back.
    const idleSwing = Math.sin(t * 1.6) * 0.03 * still;
    shoulders[0].rotation.set(-s * 0.5 * walk + 0.5 * jet + idleSwing, 0, -0.12 - 0.25 * jet);
    shoulders[1].rotation.set(s * 0.5 * walk + 0.5 * jet - idleSwing, 0, 0.12 + 0.25 * jet);
    elbows[0].rotation.x = elbows[1].rotation.x = -0.25 - 0.35 * walk;
    // The stomp: up over each step and a sharp drop as the foot lands, waddling from foot to foot. On the jets: a
    // hover, humming up and down.
    body.position.y = walk * (0.032 * Math.abs(c) - 0.012) + jet * (0.09 + Math.sin(t * 5.3) * 0.012);
    body.rotation.z = c * 0.045 * walk;
    torso.rotation.set(0.04 * walk + 0.2 * jet + Math.sin(t * 2) * 0.012 * still, -s * 0.12 * walk, 0);
    // Standing about, it looks around.
    head.rotation.set(-0.04 * k - 0.1 * jet + Math.sin(t * 0.8) * 0.04 * still,
      (Math.sin(t * 0.45) * 0.4 + Math.sin(t * 0.17) * 0.15) * still + s * 0.08 * walk, Math.sin(t * 0.6) * 0.04 * still);

    // Thrusters: the pack's nozzles glow and puff as it walks; on the jets everything roars.
    const roar = (i) => 0.85 + 0.15 * Math.sin(t * 43 + i * 1.7);
    const pack = k * (0.35 + 0.65 * jet);
    packFlames.forEach((f, i) => {
      f.visible = pack > 0.02;
      f.scale.set(0.5 + 0.5 * pack, Math.max(0.01, pack * roar(i)), 0.5 + 0.5 * pack);
    });
    bootFlames.forEach((f, i) => {
      f.visible = jet > 0.02;
      f.scale.set(0.5 + 0.5 * jet, Math.max(0.01, jet * roar(i + 2)), 0.5 + 0.5 * jet);
    });
    for (const n of nozzles) n.material.color.lerpColors(COLD, LIT, Math.max(0.8 * k, jet));

    // The eyes blink; now and then the visor flickers like a screen.
    blink -= dt;
    if (blink < 0) blink = 2 + Math.random() * 4;
    flicker -= dt;
    if (flicker < 0) flicker = 4 + Math.random() * 6;
    const glitch = flicker < 0.35 && Math.sin(t * 70) > 0;
    visor.material.color.copy(glitch ? VISOR_DIM : VISOR);
    for (const e of eyes) {
      e.visible = !glitch;
      e.scale.y = blink < 0.12 ? 0.15 : 1;
    }
  }
  return { group, animate };
}

// ---------------------------------------------------------------- 32: the Colossus

/// A towering, gentle stone giant (about 1.4 m): a body of chunky grey-brown boulders, moss on its shoulders and head
/// (and a little sprout growing there), warm amber eyes and a glowing heart-stone. Slow, heavy steps with long swinging
/// arms; standing about, it breathes.
function colossus() {
  const { add, glow } = kit();
  const group = new THREE.Group(), body = new THREE.Group(); // body: sways and sinks with each heavy step
  body.scale.setScalar(0.93); // (built a touch big: this brings it to about 1.4 m, its sprout a little over)
  group.add(body);
  const STONE = 0xa0917d, DARK = 0x7f7365, LIGHT = 0xbcae97, MOSS = 0x6aa84f, MOSS2 = 0x8cc35f, LEAF = 0x9fd86b;
  const GEM_DIM = new THREE.Color(0xd9822b), GEM_LIT = new THREE.Color(0xffc861);
  let seed = 1;
  const rock = (parent, r, color, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = add(parent, boulder(r, seed++), color, x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  };
  /// A cushion of moss: a flattened mound with a couple of lighter tufts on it, and maybe a few tiny flowers.
  const moss = (parent, r, x, y, z, flowers = 0) => {
    add(parent, ball(r, 14), MOSS, x, y, z).scale.set(1.05, 0.36, 1);
    add(parent, ball(r * 0.4, 10), MOSS2, x + r * 0.35, y + r * 0.22, z + r * 0.3);
    add(parent, ball(r * 0.32, 10), MOSS2, x - r * 0.4, y + r * 0.2, z - r * 0.25);
    for (let i = 0; i < flowers; i++) {
      const a = 1 + i * 2.3, fx = x + Math.sin(a) * r * 0.55, fz = z + Math.cos(a) * r * 0.55;
      add(parent, ball(0.016, 8), i % 2 ? 0xfff6d8 : 0xf7c6d9, fx, y + r * 0.3, fz).scale.y = 0.5;
      add(parent, ball(0.007, 6), 0xffd23f, fx, y + r * 0.3 + 0.008, fz);
    }
  };

  // ---- legs: short stone pillars on big flat feet
  const hips = [], knees = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.17, 0.44, 0);
    body.add(hip);
    hips.push(hip);
    rock(hip, 0.13, STONE, 0, -0.1, 0, 1, 1.15, 1);
    const knee = new THREE.Group();
    knee.position.set(0, -0.2, 0);
    hip.add(knee);
    knees.push(knee);
    add(knee, ball(0.065, 8), DARK);
    rock(knee, 0.12, DARK, 0, -0.07, 0, 1, 1.1, 1);
    rock(knee, 0.15, STONE, 0, -0.17, 0.05, 1.15, 0.5, 1.4);
  }

  // ---- body: a great boulder of a chest (it breathes), a lighter belly, and the heart-stone glowing in the middle
  rock(body, 0.2, DARK, 0, 0.47, 0, 1.5, 0.7, 1.05);
  const torso = new THREE.Group();
  torso.position.set(0, 0.52, 0);
  body.add(torso);
  const chest = new THREE.Group();
  torso.add(chest);
  rock(chest, 0.36, STONE, 0, 0.36, -0.02, 1.15, 1.0, 0.88);
  rock(chest, 0.22, LIGHT, 0, 0.12, 0.08, 1.1, 0.8, 0.9);
  rock(chest, 0.12, LIGHT, -0.17, 0.5, 0.18, 1, 0.8, 0.6);
  rock(chest, 0.1, DARK, 0.19, 0.27, 0.2, 1, 0.8, 0.6);
  rock(chest, 0.16, DARK, 0, 0.42, -0.26, 1.3, 0.9, 0.6);
  moss(chest, 0.13, 0.08, 0.66, -0.16, 1);
  const heart = glow(chest, new THREE.OctahedronGeometry(0.055), GEM_DIM.getHex(), 0, 0.42, 0.27);
  heart.scale.set(0.8, 1.15, 0.6);

  // ---- head: low between the shoulders, a heavy brow over two amber eyes, a small smile, a mossy cap with a sprout
  const head = new THREE.Group();
  head.position.set(0, 0.7, 0.14);
  torso.add(head);
  rock(head, 0.17, LIGHT, 0, 0.09, 0, 1.12, 0.95, 1);
  rock(head, 0.085, STONE, 0, 0.155, 0.1, 2.0, 0.45, 0.8);
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = glow(head, ball(0.036, 12), 0xffb347, s * 0.068, 0.078, 0.145);
    e.scale.set(1.2, 1, 0.6);
    eyes.push(e);
  }
  add(head, new THREE.TorusGeometry(0.05, 0.009, 4, 12, 1.5).rotateZ(-Math.PI / 2 - 0.75), 0x4f463d, 0, 0.045, 0.155); // (a wide, gentle smile)
  moss(head, 0.15, 0, 0.19, -0.02, 2);
  const sprout = new THREE.Group();
  sprout.position.set(0.03, 0.23, 0);
  head.add(sprout);
  add(sprout, cyl(0.006, 0.008, 0.09, 5), MOSS, 0, 0.045, 0);
  for (const s of [-1, 1]) {
    const leaf = add(sprout, ball(0.03, 10), LEAF, s * 0.03, 0.09, 0);
    leaf.scale.set(1.2, 0.35, 0.7);
    leaf.rotation.z = s * 0.45;
  }

  // ---- arms: huge mossy shoulder boulders, long arms ending in big stone fists near its knees
  const shoulders = [], elbows = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.47, 0.55, 0);
    torso.add(sh);
    shoulders.push(sh);
    rock(sh, 0.19, STONE, s * 0.02, 0.02, 0, 1.1, 0.9, 1);
    moss(sh, 0.16, s * 0.02, 0.13, 0, 2);
    rock(sh, 0.11, DARK, 0, -0.2, 0, 0.95, 1.5, 0.95);
    const el = new THREE.Group();
    el.position.set(0, -0.36, 0);
    sh.add(el);
    elbows.push(el);
    add(el, ball(0.07, 8), DARK);
    rock(el, 0.14, STONE, 0, -0.13, 0.02, 1, 1.45, 1);
    rock(el, 0.15, LIGHT, 0, -0.33, 0.03, 1.05, 0.95, 1.05);
  }
  compact(group);

  let phase = 0, blink = 3;
  function animate(dt, t, speed) {
    speed = clamp01(speed);
    const k = Math.min(1, speed / 0.62), still = 1 - k;
    phase += dt * (1.8 + 6 * speed);
    const s = Math.sin(phase), c = Math.cos(phase);
    // Slow, heavy steps: short legs, long arms swinging against them.
    hips[0].rotation.x = s * 0.38 * k;
    hips[1].rotation.x = -s * 0.38 * k;
    knees[0].rotation.x = 0.4 * k * Math.max(0, -c);
    knees[1].rotation.x = 0.4 * k * Math.max(0, c);
    const hang = Math.sin(t * 0.9) * 0.03 * still;
    shoulders[0].rotation.set(-s * 0.5 * k + hang, 0, -0.1);
    shoulders[1].rotation.set(s * 0.5 * k + hang, 0, 0.1);
    elbows[0].rotation.x = elbows[1].rotation.x = -0.12 - 0.25 * k;
    // Its weight rolls from foot to foot, sinking as each lands; it leans into the walk.
    body.position.y = k * (0.035 * Math.abs(c) - 0.02);
    body.rotation.z = c * 0.06 * k;
    torso.rotation.set(0.1 + 0.08 * k, -s * 0.08 * k, 0);
    // Breathing: the chest swells, the shoulders lift, the heart-stone brightens.
    const b = Math.sin(t * 1.15) * (1 - 0.6 * k);
    chest.scale.set(1 + 0.012 * b, 1 + 0.022 * b, 1 + 0.012 * b);
    shoulders[0].position.y = shoulders[1].position.y = 0.55 + 0.012 * b;
    heart.material.color.lerpColors(GEM_DIM, GEM_LIT, 0.5 + 0.5 * b);
    // A slow look around, and the sprout on its head nodding in the breeze (blown back as it walks).
    head.rotation.set(Math.sin(t * 0.6) * 0.05 * still - 0.05 * k, Math.sin(t * 0.33) * 0.35 * still, 0);
    sprout.rotation.set(-0.35 * speed, 0, Math.sin(t * 2.1) * 0.12 + Math.sin(phase) * 0.1 * k);
    // A slow blink.
    blink -= dt;
    if (blink < 0) blink = 3 + Math.random() * 4;
    for (const e of eyes) e.scale.y = blink < 0.18 ? 0.12 : 1;
  }
  return { group, animate };
}

// ---------------------------------------------------------------- 41-43: the anime-style companions

// The courier's walking and running speeds in m/s (main.js), so a chibi's little legs step in time with yours.
const WALK_MPS = 3.1, RUN_MPS = 5.8;
// Chibi proportions on the courier rig: the whole rig's scale, then (on top of that) a big head, short legs and arms.
const CHIBI = 0.59, CHIBI_HEAD = 1.55, CHIBI_LEGS = 0.72, CHIBI_ARMS = 0.85;

/// An anime-style companion on the courier rig, shrunk to chibi size. Returns the character, its group, the bones
/// createCharacter keeps to itself (pelvis, chest, the right arm's shoulder and elbow: for hanging things on and holding
/// things), and walk(dt, t, speed) to run its legs.
function chibi(params) {
  const ch = createCharacter(params);
  ch.root.scale.setScalar(CHIBI);
  ch.head.scale.setScalar(CHIBI_HEAD);
  const kids = (b) => b.children.filter((c) => c.isBone);
  const pelvis = kids(ch.body)[0], [spine, ...legs] = kids(pelvis), chest = kids(spine)[0];
  const arms = kids(chest).slice(1); // (after the neck)
  // Scaling the bones scales the soft body skinned to them (and the shoes on the knees). The legs keep most of their
  // width; shorter, they leave the feet in the air, so the rig stands lower by what they lost (and by the sliver of air
  // under the courier's shoes).
  for (const leg of legs) leg.scale.set(0.9, CHIBI_LEGS, 0.9);
  for (const a of arms) a.scale.setScalar(CHIBI_ARMS);
  const stand = new THREE.Group();
  stand.position.y = -(0.76 * (1 - CHIBI_LEGS) + 0.01) * CHIBI;
  stand.add(ch.root);
  const group = new THREE.Group();
  group.add(stand);
  const arm = arms.find((b) => b.position.x < 0); // (the right side is at x < 0)
  const rig = { pelvis, chest, arm, elbow: kids(arm)[0] };
  function walk(dt, t, speed) {
    // The ground covered, from the pace, so the stride follows it. (Only half of it: little legs taking full-length
    // steps would scurry. This way they step a little quicker than yours.)
    const mps = speed <= 0.62 ? (speed / 0.62) * WALK_MPS : WALK_MPS + ((speed - 0.62) / 0.38) * (RUN_MPS - WALK_MPS);
    ch.update(dt, speed, t, 0, (mps * dt * 0.5) / (CHIBI * CHIBI_LEGS));
  }
  return { ch, group, rig, walk };
}

/// Accessories for a joint: built in a group of their own, merged into one mesh, then hung on the joint. (They go on
/// after createCharacter has merged its own parts, and are merged apart from them.)
function props(joint, build) {
  const g = new THREE.Group();
  build(g);
  compact(g);
  joint.add(g);
  return g;
}

/// A five-petalled blossom facing +z, centred at (x, y, z).
function blossom(add, parent, r, petal, core, x, y, z) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = add(parent, ball(r * 0.55, 10), petal, x + Math.sin(a) * r * 0.62, y + Math.cos(a) * r * 0.62, z);
    p.scale.set(0.8, 1.1, 0.4);
    p.rotation.z = -a; // (its long way pointing out from the centre)
  }
  add(parent, ball(r * 0.3, 8), core, x, y, z + r * 0.15);
}

/// A happy open smile on a character's head: the face's little mouth line makes its top lip.
function smile(add, head) {
  const inside = add(head, new THREE.CircleGeometry(0.016, 12, Math.PI, Math.PI), 0xc95a64, 0, 0.085, 0.175);
  inside.rotation.x = -0.2;
  const lip = add(head, new THREE.TorusGeometry(0.016, 0.0045, 4, 12, Math.PI).rotateZ(Math.PI), 0x7a3b36, 0, 0.085, 0.176);
  lip.rotation.x = -0.2;
}

/// Sakura: cheerful, in cherry-blossom pink. Pink twin tails, a white top over a pink skirt with a white hem, a ribbon
/// bow, a sakura hairpin, and blossom petals drifting round her. Standing about, now and then she waves and bounces.
function sakura() {
  const { add } = kit();
  const PINK = 0xf59ac0, ROSE = 0xff6f9f, WHITE = 0xfdfaf4, PETAL = 0xffc2d8;
  const { ch, group, rig, walk } = chibi({
    skin: 0xf6dcc8, hair: PINK, hairStyle: "twin", headwear: "none", shirt: WHITE, accent: ROSE, collar: ROSE,
    bottoms: PINK, bottomsStyle: "skirt", socks: 0xffffff, shoes: 0xd9577f, bag: "none",
  });
  // Long anime twin tails, tied high at the back of her head with pink bobbles: they take the place of the rig's short
  // ones, in the same swinging groups (so they still sway as she walks).
  const tailShape = [[0, -0.46], [0.02, -0.42], [0.052, -0.3], [0.074, -0.15], [0.07, -0.05], [0.045, 0], [0, 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const tail of ch.head.children.filter((c) => c.isGroup && c.userData.rest !== undefined)) {
    for (const m of tail.children.filter((c) => c.isMesh)) {
      tail.remove(m);
      m.geometry.dispose();
    }
    const s = Math.sign(tail.position.x);
    tail.position.set(s * 0.155, 0.31, -0.08);
    tail.rotation.z = s * 0.3;
    props(tail, (g) => {
      add(g, new THREE.LatheGeometry(tailShape, 12), PINK, 0, -0.02, -0.02);
      for (const z of [0.025, -0.025]) add(g, ball(0.028, 10), ROSE, s * 0.035, 0, z);
    });
  }
  props(ch.head, (g) => {
    // The hairpin, above her right ear: a blossom and a smaller one beside it.
    const pin = new THREE.Group(), n = V(-0.7, 0.55, 0.45).normalize();
    pin.position.copy(n).multiplyScalar(0.215).add(V(0, 0.18, 0));
    pin.quaternion.setFromUnitVectors(V(0, 0, 1), n);
    g.add(pin);
    blossom(add, pin, 0.05, 0xffe6ef, 0xffd54a, 0, 0, 0);
    blossom(add, pin, 0.032, 0xffe6ef, 0xffd54a, 0.066, -0.045, -0.01);
    smile(add, g);
  });
  props(rig.chest, (g) => {
    // A ribbon bow under the collar.
    for (const s of [-1, 1]) {
      const loop = add(g, ball(0.034, 10), ROSE, s * 0.036, 0.075, 0.122);
      loop.scale.set(1.25, 0.8, 0.45);
      loop.rotation.z = s * 0.35;
      add(g, new THREE.BoxGeometry(0.022, 0.06, 0.01), ROSE, s * 0.016, 0.035, 0.125).rotation.z = s * 0.3;
    }
    add(g, ball(0.017, 8), 0xff4f88, 0, 0.075, 0.13);
  });
  // A white hem round the bottom of her skirt (the skirt hangs from the pelvis, 0.22 below it).
  props(rig.pelvis, (g) => {
    add(g, new THREE.TorusGeometry(0.258, 0.016, 6, 28).rotateX(Math.PI / 2), WHITE, 0, -0.22, 0).scale.z = 0.885;
  });

  // Petals drifting down round her, one draw for them all.
  const N = 6;
  const petals = new THREE.InstancedMesh(new THREE.SphereGeometry(0.024, 8, 6).scale(1, 0.3, 0.7), toon(PETAL), N);
  petals.frustumCulled = false;
  group.add(petals);
  const dummy = new THREE.Object3D();
  /// Each petal falls from above her head to the ground turning as it goes, then starts again; they bloom in and fade
  /// out (so none pops), and trail behind her when she runs.
  function drift(t, speed) {
    for (let i = 0; i < N; i++) {
      const u = (t * 0.12 + i / N) % 1, a = t * 0.6 + i * 2.4 + u * 2.5, r = 0.3 + 0.07 * Math.sin(t * 0.9 + i * 1.9);
      dummy.position.set(Math.sin(a) * r, 1.05 - u * 0.95, Math.cos(a) * r - speed * u * 0.6);
      dummy.rotation.set(t * 1.9 + i, t * 1.3 + i * 2, Math.sin(t * 2 + i) * 0.8);
      dummy.scale.setScalar(Math.sin(u * Math.PI));
      dummy.updateMatrix();
      petals.setMatrixAt(i, dummy.matrix);
    }
    petals.instanceMatrix.needsUpdate = true;
  }
  drift(0, 0); // (so they're in place before the first frame, not all at her feet)

  let idle = 0;
  function animate(dt, t, speed) {
    speed = clamp01(speed);
    idle = speed < 0.05 ? idle + dt : 0;
    // Standing about, every seven seconds she waves for a moment, bouncing on her toes.
    const w = idle > 2 ? (idle - 2) % 7 : -1;
    const wave = w < 0 ? 0 : Math.max(0, Math.min(1, w / 0.25, (1.8 - w) / 0.25));
    ch.setWave(wave);
    walk(dt, t, speed);
    ch.root.position.y = wave * Math.abs(Math.sin(t * 7)) * 0.03;
    drift(t, speed);
  }
  return { group, animate };
}

/// Luna: a calm stargazer. Long silver hair, a lavender top and indigo skirt under a navy hooded cloak (hood down)
/// with a gold crescent moon on the back and at the collar, and a short staff with a glowing star in a gold crescent.
function luna() {
  const { add, glow } = kit();
  const NAVY = 0x22305e, LINING = 0x4a5596, GOLD = 0xe8c25a;
  const { ch, group, rig, walk } = chibi({
    skin: 0xf6dcc8, hair: 0xdde2ee, hairStyle: "long", headwear: "none", shirt: 0xe9e6f5, accent: GOLD, collar: GOLD,
    bottoms: 0x3c4a8c, bottomsStyle: "skirt", socks: 0xf4f2fa, shoes: 0x3a2f4f, bag: "none", sleeves: "long",
  });

  // ---- the cloak hangs from her chest (so it turns with her), round her back and over her shoulders down to her
  // calves. Two surfaces, navy outside and a lighter lining in, so it's solid from every side.
  let cloak;
  props(rig.chest, (g) => {
    cloak = new THREE.Group();
    cloak.position.set(0, 0, -0.01);
    g.add(cloak);
    const outer = [[0.36, -0.78], [0.335, -0.45], [0.31, -0.15], [0.3, 0], [0.265, 0.1], [0.19, 0.165], [0.1, 0.19]].map(([r, y]) => new THREE.Vector2(r, y));
    const inner = outer.map((p) => new THREE.Vector2(p.x - 0.014, p.y)).reverse(); // (listed downward, so it faces in)
    const from = Math.PI / 2 - 0.25, round = Math.PI + 0.5; // from her left side round the back to her right
    add(cloak, new THREE.LatheGeometry(outer, 24, from, round), NAVY).scale.z = 0.74;
    add(cloak, new THREE.LatheGeometry(inner, 24, from, round), LINING).scale.z = 0.74;
    // A gold trim round the hem (a ring's arc, turned to start where the cloak does).
    const hem = add(cloak, new THREE.TorusGeometry(0.353, 0.012, 5, 30, round).rotateX(Math.PI / 2).rotateY(from + round - Math.PI / 2), GOLD, 0, -0.78, 0);
    hem.scale.z = 0.74;
    // The hood, down: a soft roll at the back of her neck and the rest of it lying on her back.
    add(cloak, ball(0.14, 16), NAVY, 0, 0.15, -0.13).scale.set(1.25, 0.5, 0.8);
    add(cloak, ball(0.13, 16), NAVY, 0, 0.05, -0.2).scale.set(1.0, 0.8, 0.45);
    // The crescent moon on the back.
    const moon = add(cloak, slab(crescentShape(0.075), 0.02, 0.004), GOLD, 0, -0.3, -0.242);
    moon.rotation.set(0, Math.PI, Math.PI / 2 + 0.5);
    // And a little crescent clasp at the collar.
    add(g, slab(crescentShape(0.032), 0.012, 0.003), GOLD, 0, 0.11, 0.1).rotation.z = Math.PI / 2 + 0.5;
  });

  // ---- the staff, held up in her right hand: a silver shaft with gold rings, a gold crescent cradling a star
  const staff = new THREE.Group();
  staff.position.set(0, -0.255, 0);
  rig.elbow.add(staff);
  let star;
  props(staff, (g) => {
    add(g, cyl(0.016, 0.02, 0.86, 8), 0xd8dceb, 0, 0.12, 0);
    for (const y of [-0.05, 0.05, 0.5]) add(g, new THREE.TorusGeometry(0.021, 0.007, 6, 12).rotateX(Math.PI / 2), GOLD, 0, y, 0);
    add(g, ball(0.024, 10), GOLD, 0, -0.31, 0);
    add(g, cyl(0.012, 0.026, 0.06, 10), GOLD, 0, 0.565, 0);
    add(g, slab(crescentShape(0.085), 0.022, 0.005), GOLD, 0, 0.645, 0).rotation.z = Math.PI / 2; // (horns up)
    star = glow(g, slab(starShape(0.052), 0.022, 0.006), 0xfff3b0, 0, 0.685, 0);
  });

  function animate(dt, t, speed) {
    speed = clamp01(speed);
    const still = 1 - Math.min(1, speed / 0.62);
    walk(dt, t, speed);
    // Calm: a slow sway standing about, her head tipping gently.
    ch.root.rotation.z = Math.sin(t * 0.7) * 0.03 * still;
    ch.head.rotation.z = Math.sin(t * 0.5 + 1) * 0.06 * still;
    // The staff arm stays raised whatever her legs are doing; the staff is turned against the arm to stand upright
    // (tipped forward a little).
    const lift = Math.sin(t * 1.1) * 0.04 * still;
    rig.arm.rotation.set(-0.7 + lift, 0, -0.2);
    rig.elbow.rotation.x = -0.85;
    staff.rotation.x = 0.7 + 0.85 - lift + 0.1;
    star.rotation.y = t * 1.2;
    star.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    // The cloak streams out behind as she goes, fluttering faster the faster she runs.
    cloak.rotation.x = 0.04 + 0.32 * speed + Math.sin(t * (2 + 6 * speed)) * (0.015 + 0.03 * speed);
  }
  return { group, animate };
}

/// Hana: a sunny helper. A short orange bob under a crown of little flowers, a cream top under a green overall dress,
/// and her own tiny courier satchel with a letter peeking out. Standing about, she tips her head side to side.
function hana() {
  const { add } = kit();
  const GREEN = 0x5e9c55;
  const { ch, group, rig, walk } = chibi({
    skin: 0xeec3a3, hair: 0xf0853a, hairStyle: "bob", headwear: "none", shirt: 0xf8f0dc, accent: 0x6fb35f, collar: 0xf8f0dc,
    bottoms: GREEN, bottomsStyle: "skirt", overalls: GREEN, socks: 0xfffaf0, shoes: 0x8a5a3a, bag: "satchel",
  });
  props(ch.head, (g) => {
    // The crown sits round her head, higher at the front (over her bangs) than at the back.
    const crown = new THREE.Group();
    crown.position.set(0, 0.3, -0.03);
    crown.rotation.x = -0.25;
    g.add(crown);
    const FLOWERS = [0xff8fb3, 0xffd84a, 0xffffff, 0xff7a5c, 0xb79cff];
    const n = 10, r = 0.168;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = a + Math.PI / n;
      add(crown, ball(0.04, 10), FLOWERS[i % 5], Math.sin(a) * r, 0.014, Math.cos(a) * r).scale.set(1, 0.7, 1);
      add(crown, ball(0.016, 6), i % 5 === 1 ? 0xf28c38 : 0xffd84a, Math.sin(a) * (r + 0.026), 0.034, Math.cos(a) * (r + 0.026));
      const leaf = add(crown, ball(0.022, 8), 0x5aa04a, Math.sin(b) * r, 0, Math.cos(b) * r);
      leaf.scale.set(0.55, 0.4, 1.25);
      leaf.rotation.y = b + Math.PI / 2; // (lying along the ring)
    }
    smile(add, g);
  });
  // A letter peeking out of her satchel, with a red stamp.
  const satchel = rig.pelvis.children.find((c) => c.isGroup);
  if (satchel) {
    props(satchel, (g) => {
      add(g, new THREE.BoxGeometry(0.025, 0.08, 0.12), 0xfffdf6, 0, 0.045, -0.05);
      add(g, new THREE.BoxGeometry(0.004, 0.024, 0.022), 0xd9534a, 0.014, 0.06, -0.075);
    });
  }

  function animate(dt, t, speed) {
    speed = clamp01(speed);
    const still = 1 - Math.min(1, speed / 0.62);
    walk(dt, t, speed);
    ch.head.rotation.z = Math.sin(t * 0.9) * 0.1 * still;
    ch.root.rotation.z = Math.sin(t * 0.9 + 0.6) * 0.02 * still;
  }
  return { group, animate };
}

/// The builders, by companion id (companion-kinds.js).
export const PREMIUM = { 31: mecha, 32: colossus, 41: sakura, 42: luna, 43: hana };
