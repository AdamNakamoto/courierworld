// Mars (mars-pick.js has its rules: size, ground, ticket, places, the day's stamps). Built the first time someone flies
// there: a red world with low dunes, a winding canyon, a sleeping volcano and an ice cap; the landing pad and the
// rocket home at its top, the Mars Post box, the colony (domes, a greenhouse, solar panels, a radio mast and the
// rover garage), the Martians, Mars's two little moons and Courier World in a butterscotch sky, dust storms, and the
// day's golden Mars stamps.
//
// Like the moon, its group sits so its top is where the planet's is, and main.js turns it under the courier the way
// it turns the planet: `ground` is what main.js walks on.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, toon, mulberry32, texFromCanvas } from "./world.js";
import { LANDING } from "./moon-pick.js";
import { MARS_R, MARS_GRAVITY, MARS_SPOTS, MARS_CRATERS, marsHeight, marsSpots, COLONY, VOLCANO, ICE, RADIO, CANYON, canyonAt, canyonFloor } from "./mars-pick.js";
import { facing, padAndRocket, postBox, createLocals, dayStamps, homePlanet } from "./space.js";
import { createRide } from "./rides.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const arr = (v) => [v.x, v.y, v.z];
const ht = (d) => marsHeight(arr(d));
const marc = (a, b) => MARS_R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
/// A direction `m` metres from `d` along the tangent `t` (a short step: straight out, then down to the ground).
const along = (d, t, m) => d.clone().multiplyScalar(MARS_R).addScaledVector(t, m).normalize();
/// The tangent at `d` pointing toward `to`.
const toward = (d, to) => to.clone().addScaledVector(d, -to.dot(d)).normalize();
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/// How thick the dust is at `ms` (0 clear … 1 a full storm): a storm blows through every seven minutes and lasts about
/// a minute and a half, at the same time for everyone.
const STORM_EVERY = 420, STORM_FOR = 85, STORM_RAMP = 15; // seconds
export function stormAt(ms = Date.now()) {
  const s = (ms / 1000 + 150) % STORM_EVERY;
  return smooth(0, STORM_RAMP, s) * (1 - smooth(STORM_FOR - STORM_RAMP, STORM_FOR, s));
}

/// The colony's sign: its name in warm orange on a dark board, and a line for visitors.
function colonySignTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const g = c.getContext("2d");
  g.fillStyle = "#2a1d1a";
  g.fillRect(0, 0, 512, 192);
  g.strokeStyle = "#f2a03d";
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 176);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "#f2a03d";
  g.shadowBlur = 16;
  g.fillStyle = "#ffd08a";
  g.font = "400 70px Bungee, Impact, sans-serif";
  g.fillText("MARS COLONY", 256, 82, 470);
  g.shadowBlur = 0;
  g.fillStyle = "#f2a03d";
  g.font = "400 26px Bungee, Impact, sans-serif";
  g.fillText("RED PLANET POST · POP. 7", 256, 148, 470);
  return texFromCanvas(c);
}

/// A Martian: a round bean of a body with one big eye, a smile, stubby arms, boots, a dust scarf and an antenna with a
/// glowing tip. Returns the group and the parts that move ({ body (turns and hops), eyes (blink), tips (glow) }).
function martianMesh(color, glowColor, scarfColor, mesh) {
  const g = new THREE.Group(), body = new THREE.Group(), eyes = [], tips = [];
  g.add(body);
  const add = (geo, col, x, y, z, sx = 1, sy = 1, sz = 1, parent = body) => {
    const m = mesh(geo, col);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  const ball = (r, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.6)));
  const belly = new THREE.Color(color).lerp(new THREE.Color(0xfff0e0), 0.4).getHex();
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.075, 0.16, 4, 8), color, s * 0.15, 0.17, 0);
    add(ball(0.11, 12), 0x3b4145, s * 0.15, 0.05, 0.05, 1, 0.55, 1.4); // boots
    const arm = add(new THREE.CapsuleGeometry(0.055, 0.22, 4, 8), color, s * 0.38, 0.7, 0.04);
    arm.rotation.set(0.2, 0, s * 0.55);
    add(ball(0.07, 10), color, s * 0.46, 0.56, 0.08);
  }
  add(new THREE.CapsuleGeometry(0.34, 0.5, 6, 18), color, 0, 0.72, 0, 1, 1, 0.9);
  add(ball(0.26), belly, 0, 0.56, 0.16, 1, 1.15, 0.6);
  add(new THREE.TorusGeometry(0.33, 0.06, 6, 22), scarfColor, 0, 0.74, 0, 1, 1, 0.92).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.1, 0.26, 0.05), scarfColor, 0.15, 0.6, 0.3).rotation.z = 0.25;
  const eye = new THREE.Group();
  eye.position.set(0, 1.08, 0.22);
  body.add(eye);
  add(ball(0.17), 0xffffff, 0, 0, 0.04, 1, 1, 0.8, eye);
  add(ball(0.08, 12), 0x1d1f27, 0, 0, 0.16, 1, 1, 1, eye);
  add(ball(0.03, 8), 0xffffff, 0.03, 0.03, 0.23, 1, 1, 1, eye); // (a glint)
  eyes.push(eye);
  const mouth = add(new THREE.TorusGeometry(0.1, 0.02, 6, 16, Math.PI), 0x5a2a3a, 0, 0.9, 0.29, 1, 0.6, 1);
  mouth.rotation.z = Math.PI; // (the lower half of a ring: a smile)
  add(new THREE.CylinderGeometry(0.018, 0.022, 0.32, 6), 0x3b4145, 0, 1.44, 0);
  const tip = new THREE.Mesh(ball(0.075, 10), new THREE.MeshBasicMaterial({ color: glowColor }));
  tip.position.set(0, 1.62, 0);
  body.add(tip);
  tips.push(tip);
  return { g, body, eyes, tips };
}

export function createMars(W) {
  const group = new THREE.Group();
  group.position.set(0, R - MARS_R, 0);
  group.visible = false;
  W.scene.add(group);
  const rnd = mulberry32(4242);
  const top = V(...LANDING), east = V(1, 0, 0), north = V(0, 0, 1);
  const place = (obj, d, h = 0, spin = 0) => {
    obj.position.copy(d).multiplyScalar(MARS_R + h);
    obj.quaternion.copy(W.frameAt(d, spin));
    group.add(obj);
    return obj;
  };
  /// Stand `obj` on the ground at `d` (sunk `sink` metres in), its front toward the tangent `look`.
  const stand = (obj, d, look, sink = 0) => {
    obj.position.copy(d).multiplyScalar(MARS_R + ht(d) - sink);
    obj.quaternion.copy(facing(d, look));
    group.add(obj);
    return obj;
  };
  const mesh = (geo, color, extra) => {
    const m = new THREE.Mesh(geo, toon(color, extra));
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const glowing = (geo, color) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  const obstacles = [];
  const circle = (d, r, opts = {}) => obstacles.push({ d, kind: "circle", r, ...opts, cos: Math.cos((r + 1) / MARS_R) });
  const keepOut = [{ d: top, r: 4.6 }]; // (rocks and Martians stay clear of these)
  const blinkers = []; // glowing bits that blink: { m (mesh), every (seconds), on (seconds lit), ph }
  const spotDirs = MARS_SPOTS.map((s) => V(...s.d));
  /// The nearest spot to `d0` (within `within` metres) at least `clear` metres from every stamp spot and clear of
  /// what's already here; `d0` itself if there's none.
  const settle = (d0, clear, within = 3) => {
    const t1 = new THREE.Vector3().crossVectors(d0, Math.abs(d0.y) < 0.9 ? top : east).normalize(), t2 = new THREE.Vector3().crossVectors(d0, t1);
    for (let i = 0; i < 300; i++) {
      const a = i * 2.39996, d = along(d0, t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)), within * Math.sqrt(i / 300));
      if (spotDirs.every((p) => marc(p, d) >= clear) && keepOut.every((k) => marc(k.d, d) >= k.r)) return d;
    }
    return d0;
  };

  // ---- the ground: a faceted red ball with dunes, the canyon (its walls in bands), the dark volcano and the ice cap
  {
    const geo = new THREE.IcosahedronGeometry(MARS_R, 40);
    const pos = geo.attributes.position, col = [], v = new THREE.Vector3(), c = new THREE.Color();
    const rust = new THREE.Color(0xc4683f), dune = new THREE.Color(0xdc8f5c), wall = new THREE.Color(0x9a4d33), basalt = new THREE.Color(0x5b3a31), ice = new THREE.Color(0xf2f5f7);
    const volD = V(...VOLCANO.d), iceD = V(...ICE.d);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const a = arr(v), h = marsHeight(a);
      pos.setXYZ(i, v.x * (MARS_R + h), v.y * (MARS_R + h), v.z * (MARS_R + h));
      c.copy(rust).lerp(dune, smooth(0.02, 0.12, h)); // (dune crests catch the light)
      const cy = canyonAt(a);
      if (cy && Math.abs(cy.s) < CANYON.half + 1 && Math.abs(cy.l) < CANYON.wall + 0.2 && h < -0.1) {
        c.copy(wall).lerp(dune, 0.45 * (0.5 + 0.5 * Math.sin(h * 11))); // layers of old dust
        if (h < -CANYON.depth + 0.12) c.copy(wall).multiplyScalar(0.9);
      } else if (h < -0.05) c.multiplyScalar(0.86); // crater floors, darker
      const vu = marc(v, volD) / VOLCANO.r;
      if (vu < 1) c.lerp(basalt, (1 - vu) ** 1.5);
      const iu = marc(v, iceD) + 0.8 * Math.sin(v.x * 23) * Math.sin(v.z * 19); // (a ragged edge)
      if (iu < ICE.r) c.lerp(ice, smooth(ICE.r, ICE.r - 1.4, iu));
      const grain = 1 + 0.07 * Math.sin(v.x * 41 + v.y * 27) * Math.sin(v.z * 33 - v.x * 19);
      col.push(c.r * grain, c.g * grain, c.b * grain);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    ground.receiveShadow = true;
    group.add(ground);
  }

  // ---- the landing pad with the rocket home, and the Mars Post box. You step out beside the pad facing the colony.
  const { pad, rocket } = padAndRocket(mesh);
  place(pad, top, 0.02);
  place(rocket, top, 0.07, 0.6);
  circle(top.clone(), 0.75, { y1: 4.8 });
  const arrive = along(top, north, 2.8);
  const postD = along(along(top, east, 3.0), north, 0.6);
  stand(postBox(mesh, "MARS POST"), postD, arrive.clone().sub(postD));
  circle(postD.clone(), 0.35, { y1: 1.5 });
  keepOut.push({ d: postD, r: 1.2 });

  // ---- the colony, laid out facing the pad: `at(x, y)` is x metres from its middle toward the pad, y to the side
  const colonyD = V(...COLONY), toPad = toward(colonyD, top), side = new THREE.Vector3().crossVectors(colonyD, toPad).normalize();
  const at = (x, y) => along(along(colonyD, toPad, x), side, y);
  const build = (g, x, y, sink = 0.05) => stand(g, at(x, y), toward(at(x, y), top), sink);
  keepOut.push({ d: colonyD, r: 6.8 });
  const locals = createLocals(MARS_R), residents = []; // (residents: the Martians who get letters)
  const martianAt = (d, name, lines, color, glowColor, scarf, look = top) => {
    const f = martianMesh(color, glowColor, scarf, mesh);
    f.g.position.copy(d).multiplyScalar(MARS_R + ht(d));
    f.g.quaternion.copy(facing(d, toward(d, look)));
    group.add(f.g);
    circle(d.clone(), 0.42, { y1: ht(d) + 1.6 });
    keepOut.push({ d, r: 1.2 });
    locals.add(f, d, name, lines, rnd() * 6);
    residents.push({ name, d });
  };
  // The big dome, where the colonists live: warm windows, a door toward the pad, a dish on top.
  {
    const g = new THREE.Group();
    const base = mesh(new THREE.CylinderGeometry(2.45, 2.55, 0.5, 32), 0xd9d4ca);
    base.position.y = 0.25;
    g.add(base);
    const dome = mesh(new THREE.SphereGeometry(2.3, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), 0xeee9df);
    dome.position.y = 0.5;
    g.add(dome);
    const stripe = mesh(new THREE.TorusGeometry(2.31, 0.06, 6, 40), 0xf2a03d);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 0.95;
    g.add(stripe);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, el = 0.5;
      if (Math.abs(Math.sin(a / 2)) < 0.2) continue; // (the door's there)
      const w = glowing(new THREE.SphereGeometry(0.14, 10, 8), 0xffd79a);
      w.position.set(Math.sin(a) * 2.3 * Math.cos(el), 0.5 + 2.3 * Math.sin(el), Math.cos(a) * 2.3 * Math.cos(el));
      g.add(w);
    }
    const door = mesh(new THREE.BoxGeometry(0.9, 1.2, 0.4), 0x3b2f2a);
    door.position.set(0, 1.1, 2.2);
    g.add(door);
    const arch = mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 20, Math.PI), 0xf2a03d, { emissive: 0x7a3a00 });
    arch.position.set(0, 1.68, 2.36);
    g.add(arch);
    const mast = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 6), 0xc9ced6);
    mast.position.set(0.8, 2.85, -0.7);
    g.add(mast);
    const dish = mesh(new THREE.SphereGeometry(0.34, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), 0xd9dde0);
    dish.position.set(0.8, 3.2, -0.7);
    dish.rotation.x = Math.PI * 0.75;
    g.add(dish);
    build(g, -0.5, 0);
    circle(at(-0.5, 0), 2.5, { wall: { h: 2.8 } });
  }
  // The greenhouse: a glass dome full of plants, glowing a little green.
  {
    const g = new THREE.Group();
    const base = mesh(new THREE.CylinderGeometry(1.6, 1.65, 0.3, 28), 0xd9d4ca);
    base.position.y = 0.15;
    g.add(base);
    const bed = mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.25, 24), 0x6e3f2a);
    bed.position.y = 0.42;
    g.add(bed);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 0.85 : 0.55;
      const plant = i % 3 === 0 ? mesh(new THREE.ConeGeometry(0.2, 0.7, 8), 0x4f9e3f) : mesh(new THREE.SphereGeometry(0.24, 10, 8), 0x6fbf4f);
      plant.position.set(Math.sin(a) * r, i % 3 === 0 ? 0.88 : 0.68, Math.cos(a) * r);
      g.add(plant);
    }
    const tall = mesh(new THREE.ConeGeometry(0.28, 1.0, 10), 0x3f8a3a);
    tall.position.y = 1.05;
    g.add(tall);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.55, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc9f7dc, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    glass.position.y = 0.3;
    g.add(glass);
    W.noNormals.push(glass);
    for (let i = 0; i < 4; i++) {
      const rib = mesh(new THREE.TorusGeometry(1.56, 0.035, 4, 24, Math.PI), 0xd9d4ca);
      rib.position.y = 0.3;
      rib.rotation.y = (i / 4) * Math.PI;
      g.add(rib);
    }
    const lamp = glowing(new THREE.SphereGeometry(0.1, 10, 8), 0xd6ffcf);
    lamp.position.y = 1.75;
    g.add(lamp);
    build(g, 0.8, 4.2);
    circle(at(0.8, 4.2), 1.65, { wall: { h: 1.9 } });
  }
  // A habitat module on its side, joined to the dome by a tube.
  {
    const g = new THREE.Group();
    const body = mesh(new THREE.CapsuleGeometry(0.75, 2.4, 6, 18), 0xe7e2d8);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.9;
    g.add(body);
    for (const z of [-0.65, 0.65]) {
      const band = mesh(new THREE.TorusGeometry(0.76, 0.05, 6, 24), 0xf2a03d);
      band.position.set(0, 0.9, z);
      g.add(band);
    }
    for (const z of [-0.9, 0, 0.9]) {
      const w = glowing(new THREE.SphereGeometry(0.12, 10, 8), 0xffd79a);
      w.position.set(-0.73, 1.0, z);
      g.add(w);
    }
    for (const [x, z] of [[-0.45, -1.1], [0.45, -1.1], [-0.45, 1.1], [0.45, 1.1]]) {
      const leg = mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), 0x8d9790);
      leg.position.set(x, 0.2, z);
      g.add(leg);
    }
    const tube = mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.1, 14), 0xd9d4ca);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(1.1, 0.85, 0);
    g.add(tube);
    build(g, -0.6, -3.9);
    for (const x of [-1.7, -0.6, 0.5]) circle(at(x, -3.9), 0.85, { wall: { h: 1.7 } });
    circle(at(-0.6, -2.85), 0.4, { wall: { h: 1.3 } });
  }
  // Solar panels behind the dome.
  for (const y of [-2.2, 0, 2.2]) {
    const g = new THREE.Group();
    const post = mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 6), 0x8d9790);
    post.position.y = 0.5;
    g.add(post);
    const panel = mesh(new THREE.BoxGeometry(1.5, 0.05, 0.95), 0x2a3b66);
    panel.position.y = 1.05;
    panel.rotation.x = -0.45;
    g.add(panel);
    const frame = mesh(new THREE.BoxGeometry(1.56, 0.03, 1.0), 0xc9ced6);
    frame.position.y = 1.02;
    frame.rotation.x = -0.45;
    g.add(frame);
    build(g, -4.4, y, 0);
    circle(at(-4.4, y), 0.75);
  }
  // The radio mast, its light blinking.
  {
    const g = new THREE.Group();
    const mast = mesh(new THREE.CylinderGeometry(0.06, 0.16, 4.2, 8), 0x5a5f6e);
    mast.position.y = 2.1;
    g.add(mast);
    for (let i = 1; i <= 4; i++) {
      const ring = mesh(new THREE.TorusGeometry(0.17 - i * 0.02, 0.025, 4, 12), 0x8d9790);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = i * 0.85;
      g.add(ring);
    }
    const dish = mesh(new THREE.SphereGeometry(0.42, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), 0xd9dde0);
    dish.position.set(0.2, 3.2, 0);
    dish.rotation.z = -Math.PI * 0.6;
    g.add(dish);
    const beacon = glowing(new THREE.SphereGeometry(0.1, 10, 8), 0xff3b3b);
    beacon.position.y = 4.32;
    g.add(beacon);
    blinkers.push({ m: beacon, every: 1.3, on: 0.4 });
    build(g, -3.2, 4.4, 0);
    circle(at(-3.2, 4.4), 0.3, { wall: { h: 4.2 } });
  }
  // The rover garage: an open shed, its back wall hung with tools, and the rover parked in it.
  const garageD = at(2.8, -4.0);
  {
    const g = new THREE.Group();
    for (const [x, z] of [[-1.25, -1.1], [1.25, -1.1], [-1.25, 1.1], [1.25, 1.1]]) {
      const post = mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.95, 6), 0x8d9790);
      post.position.set(x, 0.97, z);
      g.add(post);
    }
    const roof = mesh(new THREE.BoxGeometry(2.8, 0.1, 2.6), 0xb8b2a6);
    roof.position.y = 2.0;
    g.add(roof);
    const trim = mesh(new THREE.BoxGeometry(2.84, 0.12, 0.06), 0xf2a03d);
    trim.position.set(0, 2.0, 1.31);
    g.add(trim);
    const back = mesh(new THREE.BoxGeometry(2.6, 1.9, 0.08), 0xd9d4ca);
    back.position.set(0, 0.95, -1.15);
    g.add(back);
    for (const [x, y, c] of [[-0.8, 1.25, 0xd9534a], [-0.4, 1.35, 0x5a5f6e], [0.1, 1.2, 0xf2c94c]]) {
      const tool = mesh(new THREE.BoxGeometry(0.08, 0.45, 0.04), c);
      tool.position.set(x, y, -1.09);
      g.add(tool);
    }
    const bench = mesh(new THREE.BoxGeometry(0.9, 0.55, 0.4), 0x6e5a4a);
    bench.position.set(0.8, 0.27, -0.85);
    g.add(bench);
    build(g, 2.8, -4.0);
    for (const [x, y] of [[1.7, -5.25], [1.7, -2.75], [3.9, -5.25], [3.9, -2.75]]) circle(at(x, y), 0.12);
    for (const y of [-4.9, -4.0, -3.1]) circle(at(1.65, y), 0.45, { wall: { h: 1.9 } });
  }
  // The sign out front, on two posts, and stepping stones from the pad to the dome's door.
  {
    const sign = new THREE.Group();
    for (const x of [-0.85, 0.85]) {
      const post = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), 0x3b4145);
      post.position.set(x, 0.65, 0);
      sign.add(post);
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.72), new THREE.MeshBasicMaterial({ map: colonySignTexture(), side: THREE.DoubleSide }));
    board.position.set(0, 1.4, 0.03);
    sign.add(board);
    build(sign, 5.0, 1.8, 0);
    circle(at(5.0, 1.8), 0.95, { y1: ht(at(5.0, 1.8)) + 1.8 });
    for (const m of [4.3, 5.2, 6.1]) {
      const stone = mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.06, 10), 0xd9b48c);
      stone.receiveShadow = true;
      place(stone, along(top, east, m), ht(along(top, east, m)) + 0.01, m);
    }
  }
  // The rover, parked in the garage until someone takes it (and wherever they leave it after).
  const roverMesh = createRide("rover");
  const roverBlock = { d: garageD.clone(), kind: "circle", r: 0.95, y1: 1.3, cos: Math.cos(2 / MARS_R) };
  obstacles.push(roverBlock);
  let roverAt = garageD.clone(), roverTaken = false;
  /// Park the rover at `d`, its front toward `look` (a direction along the ground).
  function parkRover(d, look) {
    roverAt = d.clone();
    stand(roverMesh.group, d, look);
    roverMesh.group.visible = true;
    Object.assign(roverBlock, { d: d.clone(), y1: ht(d) + 1.3, cos: Math.cos(2 / MARS_R) });
    roverTaken = false;
  }
  const parkHome = () => parkRover(garageD, toward(garageD, top));
  parkHome();

  // ---- the Martians: three at the colony, and the rest out where the exploring is
  martianAt(at(2.6, 0.9), "Mayor Zibble", [
    "Welcome to Mars Colony! Population seven. Eight with you. Nine if you count the rover. We count the rover.",
    "Mail used to take seven months to reach us. Then you showed up with a rocket.",
    "Our motto: dust off and carry on. It's also our cleaning schedule.",
    "Letters from the Mars Post box go all over the planet. Geo's in the canyon, Ozzy's up the volcano, Tula's by the ice.",
  ], 0x3fb7a8, 0xffe066, 0xf2a03d);
  martianAt(at(2.8, 3.3), "Dr. Rusta", [
    "I grow potatoes in red dirt. They taste a little rusty. I call them rusties.",
    "The greenhouse glows at night. The plants like it. I like it. The rover is jealous.",
    "Mind the dust storms. When the sky goes orange, keep walking. It's only dust. Probably.",
  ], 0x9a7fd1, 0x8ffcff, 0xf2c94c);
  martianAt(at(2.3, -2.2), "Pip", [
    "That's our rover. Six wheels, no brakes worth mentioning. Hop in (E) and take it for a spin.",
    "Drive it to the canyon, up the volcano, round to the ice cap. Bring it back. Mostly in one piece.",
    "I fixed the rover with a spoon. Don't ask which part.",
  ], 0x7fd1a0, 0xff7a5c, 0xfbf6ea);
  const geoD = settle(V(...canyonFloor(-4)), 2.4, 2.5);
  martianAt(geoD, "Geo", [
    "This canyon is very old. Older than your postcode.",
    "Every stripe in these walls is a different century of dust. I've read most of them.",
    "I came down here to find rare rocks. Mostly I find more canyon.",
  ], 0x6fa8dc, 0xb8ff9e, 0xd9534a, V(...canyonFloor(4)));
  const volD = V(...VOLCANO.d), up = toward(volD, top);
  const ozzyD = settle(along(volD, up, VOLCANO.crater + 0.9), 3.2, 3);
  {
    const sideV = new THREE.Vector3().crossVectors(ozzyD, toward(ozzyD, top)).normalize(), tentD = along(ozzyD, sideV, 1.5);
    const tent = new THREE.Group();
    const cloth = mesh(new THREE.ConeGeometry(0.75, 1.15, 4), 0xf2a03d);
    cloth.position.y = 0.57;
    cloth.rotation.y = Math.PI / 4;
    tent.add(cloth);
    const flap = mesh(new THREE.BoxGeometry(0.36, 0.5, 0.02), 0x5a2a1a);
    flap.position.set(0, 0.25, 0.52);
    tent.add(flap);
    stand(tent, tentD, toward(tentD, ozzyD), 0.05);
    circle(tentD, 0.7, { wall: { h: 1.2 } });
    keepOut.push({ d: tentD, r: 1.3 });
    // A warm glow down in the crater: the volcano's asleep, not gone.
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(glow);
    place(holder, volD, ht(volD) + 0.04);
    W.noNormals.push(glow);
    blinkers.push({ m: glow, pulse: true });
  }
  martianAt(ozzyD, "Old Ozzy", [
    "I live on top of the volcano. It's asleep. I check every morning.",
    "Best view on Mars. You can see the whole colony from here. All seven of us.",
    "When the ground goes warm, I go for a walk. A long walk. Toward the ice.",
  ], 0xb48ad9, 0xff5cd1, 0x3fb7a8, top);
  {
    const radioD = V(...RADIO), out = toward(radioD, top).negate(), sideV = new THREE.Vector3().crossVectors(radioD, out).normalize();
    const dishD = along(radioD, out, 1.7), hutD = along(radioD, sideV, -1.9);
    const dish = new THREE.Group();
    const stem = mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.2, 8), 0x5a5f6e);
    stem.position.y = 0.6;
    dish.add(stem);
    const bowl = mesh(new THREE.SphereGeometry(1.0, 22, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), 0xe7e2d8, { side: THREE.DoubleSide });
    bowl.position.y = 1.7;
    bowl.rotation.x = Math.PI * 0.8;
    dish.add(bowl);
    const feed = glowing(new THREE.SphereGeometry(0.08, 8, 6), 0xff3b3b);
    feed.position.set(0, 1.45, 0.4);
    dish.add(feed);
    blinkers.push({ m: feed, every: 2.0, on: 0.6 });
    stand(dish, dishD, toward(dishD, radioD));
    circle(dishD, 1.0, { wall: { h: 2.2 } });
    const hut = new THREE.Group();
    hut.add(mesh(new THREE.SphereGeometry(0.9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xe7e2d8));
    const door = mesh(new THREE.CircleGeometry(0.3, 14), 0x3b2f2a);
    door.position.set(0, 0.3, 0.89);
    hut.add(door);
    stand(hut, hutD, toward(hutD, radioD), 0.05);
    circle(hutD, 0.9, { wall: { h: 0.95 } });
    keepOut.push({ d: dishD, r: 1.6 }, { d: hutD, r: 1.5 });
    martianAt(radioD, "Tula", [
      "I run the radio out here by the ice. Mostly I listen to dust storms. They hum.",
      "Courier World's radio is all music and traffic. Ours is all wind. I prefer the wind.",
      "The ice cap is the only cold drink on Mars. Don't lick it. Trust me.",
    ], 0x4fc3c9, 0xffb35c, 0xd9534a, top);
  }
  {
    const c = MARS_CRATERS.reduce((a, b) => (marc(V(...b.d), top) < marc(V(...a.d), top) ? b : a), MARS_CRATERS[0]); // (the nearest crater)
    const cd = V(...c.d), nixD = settle(along(cd, toward(cd, top), c.r + 0.9), 2.4, 3);
    martianAt(nixD, "Nix", [
      "I race the dust devils. They always win, but I'm getting closer.",
      "Mum says don't play in the craters. This isn't a crater. It's a very big hole.",
      "Is that a real paper letter? Can I keep the envelope too?",
    ], 0x8c9eff, 0x7dff6a, 0xf2c94c, cd);
  }

  // ---- rocks, and chunks of ice by the cap, kept off the places, the stamp spots and each other
  {
    const iceD = V(...ICE.d), rocks = [];
    for (let i = 0; i < 1200 && rocks.length < 34; i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), d = V(s * Math.cos(t), z, s * Math.sin(t));
      const onIce = marc(d, iceD) < ICE.r - 1, size = onIce ? 0.18 + rnd() * 0.25 : 0.25 + rnd() * rnd() * 0.8;
      if (keepOut.some((k) => marc(k.d, d) < k.r + size) || spotDirs.some((p) => marc(p, d) < 1.4 + size) || rocks.some((r) => marc(r.d, d) < r.size + size + 0.9)) continue;
      const rock = mesh(new THREE.DodecahedronGeometry(size, 0), onIce ? 0xdff1f7 : rnd() < 0.5 ? 0x8a4a35 : 0xa45a3c);
      rock.scale.set(1, 0.7, 1.1);
      const g = new THREE.Group();
      rock.position.y = size * 0.45;
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      g.add(rock);
      const h = ht(d);
      place(g, d, h - size * 0.12, rnd() * 6);
      rocks.push({ d, size });
      circle(d, size * 0.85, { y1: h + size * 0.85 }); // (a Mars jump clears it)
    }
  }

  // ---- the sky: Mars's two little moons going round, and Courier World far off
  const lump = (r, color, seed) => {
    const geo = new THREE.DodecahedronGeometry(r, 1), pos = geo.attributes.position, v = new THREE.Vector3(), jr = mulberry32(seed);
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, ...v.fromBufferAttribute(pos, i).multiplyScalar(0.82 + 0.3 * jr()).toArray());
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, toon(color));
  };
  const moons = [
    { m: lump(2.6, 0x8d847a, 7), r: 62, every: 90, ph: 0.5, tilt: 0.42 },
    { m: lump(1.6, 0xa39a8f, 11), r: 88, every: 220, ph: 2.4, tilt: 0.3 },
  ];
  for (const o of moons) group.add(o.m);
  const home = homePlanet(5);
  home.position.copy(V(-0.6, 0.7, 0.4).normalize()).multiplyScalar(150);
  group.add(home);

  // ---- dust storms: the sky goes thick and orange (world.js), and dust blows past the courier (in the scene, round
  // the top, where the courier always is)
  const DUST_N = 1200, BOX = 18, TALL = 8;
  const dpos = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i++) dpos.set([(rnd() * 2 - 1) * BOX, R - 0.5 + rnd() * TALL, (rnd() * 2 - 1) * BOX], i * 3);
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  const puff = document.createElement("canvas");
  puff.width = puff.height = 32;
  {
    const x = puff.getContext("2d"), grad = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = grad;
    x.fillRect(0, 0, 32, 32);
  }
  const motes = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: 0xd99a68, size: 0.12, map: texFromCanvas(puff), transparent: true, opacity: 0, depthWrite: false }));
  motes.frustumCulled = false;
  motes.visible = false;
  W.scene.add(motes);
  W.noNormals.push(motes);
  let dust = 0;

  // ---- the day's golden Mars stamps
  const stamps = dayStamps(W, group, place, { R: MARS_R, spots: MARS_SPOTS, pick: marsSpots }, rnd);

  return {
    group,
    /// What main.js walks on here.
    ground: {
      key: "mars", R: MARS_R, center: group.position.clone(), group, gravity: MARS_GRAVITY, obstacles,
      terrain: { surfaceAt: (d) => ht(d), baseAt: (d) => ht(d), waterAt: () => null, ramps: [], inRamp: () => null },
    },
    /// Where you step out (beside the pad, facing the colony) and the rocket home (stand within `reach`).
    arrival: { d: arrive, tangent: east.clone() },
    rocket: { d: top.clone(), reach: 2.9 },
    /// The Mars Post box (stand within `reach` with an empty bag for letters), and who the letters are for.
    post: { d: postD, reach: 1.8, name: "Mars Post box" },
    residents,
    thanks: [
      "Mail! The last letter took seven months. You took seven minutes.",
      "Real paper! It even smells like Courier World.",
      "A letter, on Mars. I'm framing it. Then I'm framing the envelope.",
      "You came all the way to the red planet for this? Legend.",
      "Thank you, courier. Mind the dust on your way out.",
    ],
    /// The rover: where it's parked (stand within `reach` to hop in), taken while someone drives it, and parked
    /// again where they hop out (`look`: the way they face) or back in the garage.
    rover: {
      reach: 2.2,
      near: (me) => !roverTaken && marc(roverAt, me) < 2.2,
      get taken() { return roverTaken; },
      take() {
        roverTaken = true;
        roverMesh.group.visible = false;
        roverBlock.cos = 2; // (in nobody's way)
      },
      park: parkRover,
      home: parkHome,
    },
    /// Mars stamps found today (the server's record, for signed-in couriers).
    setFound: (d, ids) => stamps.setFound(d, ids),
    get found() { return stamps.found; },
    get out() { return stamps.out; },
    /// The Martian within `reach` metres of `me`, nearest first, to talk to: { name, line(), talk(on) }, or null.
    nearestLocal: (me, reach) => locals.nearest(me, reach),
    /// How thick the dust is right now (0 … 1).
    get dust() { return dust; },
    /// Leaving Mars: the dust stops blowing past.
    leave() {
      motes.visible = false;
      dust = 0;
    },
    /// The Martians, the lights, the moons, the dust, and the stamps: they spin and bob, and any the courier reaches
    /// (`me`: where they are, Mars-local; `chest`: how high) is picked up. Returns the spot picked up, or null.
    update(dt, t, { me, chest, active }) {
      locals.update(dt, t, me);
      for (const b of blinkers) {
        if (b.pulse) b.m.material.opacity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.3));
        else b.m.visible = (t + (b.ph ?? 0)) % b.every < b.on;
      }
      for (const o of moons) {
        const a = (t / o.every) * Math.PI * 2 + o.ph;
        o.m.position.set(Math.cos(a) * o.r, o.r * (o.tilt + 0.25 * Math.sin(a)), Math.sin(a) * o.r);
        o.m.rotation.y = a * 0.5;
      }
      dust = stormAt();
      motes.visible = dust > 0.01;
      if (motes.visible) {
        motes.material.opacity = 0.8 * dust;
        for (let i = 0; i < DUST_N; i++) {
          const k = i * 3;
          dpos[k] += (6 + 3 * Math.sin(i * 1.7)) * dt;
          dpos[k + 1] += Math.sin(t * 1.3 + i) * 0.4 * dt;
          dpos[k + 2] += 1.2 * dt;
          if (dpos[k] > BOX) dpos[k] -= 2 * BOX;
          if (dpos[k + 2] > BOX) dpos[k + 2] -= 2 * BOX;
        }
        dgeo.attributes.position.needsUpdate = true;
      }
      return stamps.update(dt, t, me, chest, active);
    },
  };
}
