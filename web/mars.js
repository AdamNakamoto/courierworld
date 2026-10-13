// Mars (mars-pick.js has its rules: size, ground, ticket, places, the day's stamps). Built the first time someone flies
// there: a red world as big as Courier World. At its top the spaceport (the landing pad with the rocket home, tall
// rockets, a launch tower, the Mars Post box and the rover garage); beside it Mars City (a big glass plaza dome you
// can walk into, greenhouse and living domes joined by tubes, pools, farms and a ring road); red mountains beyond; a
// winding canyon, a big sleeping volcano and an ice cap; Martians and astronaut colonists; a shuttle overhead, Mars's
// two little moons and Courier World in a butterscotch sky; dust storms; and the day's golden Mars stamps.
//
// Like the moon, its group sits so its top is where the planet's is, and main.js turns it under the courier the way
// it turns the planet: `ground` is what main.js walks on. Everything that stands still is merged into one mesh.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeVertices, mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { R, toon, mulberry32, texFromCanvas, Batch } from "./world.js";
import { LANDING } from "./moon-pick.js";
import { MARS_R, MARS_GRAVITY, MARS_SPOTS, MARS_CRATERS, MOUNTAINS, marsHeight, marsSpots, CITY, VOLCANO, ICE, RADIO, CANYON, canyonAt, canyonFloor } from "./mars-pick.js";
import { facing, padAndRocket, postBox, missionBoard, createLocals, dayStamps, homePlanet } from "./space.js";
import { createRide } from "./rides.js";
import { createCharacter } from "./character.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const arr = (v) => [v.x, v.y, v.z];
const ht = (d) => marsHeight(arr(d));
const marc = (a, b) => MARS_R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
/// A direction `m` metres from `d` round Mars the way of the tangent `t`.
const round = (d, t, m) => d.clone().multiplyScalar(Math.cos(m / MARS_R)).addScaledVector(t, Math.sin(m / MARS_R)).normalize();
/// The tangent at `d` pointing toward `to`.
const toward = (d, to) => to.clone().addScaledVector(d, -to.dot(d)).normalize();
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const deg = (a) => (a * Math.PI) / 180;

/// How thick the dust is at `ms` (0 clear … 1 a full storm): a storm blows through every seven minutes and lasts about
/// a minute and a half, at the same time for everyone.
const STORM_EVERY = 420, STORM_FOR = 85, STORM_RAMP = 15; // seconds
export function stormAt(ms = Date.now()) {
  const s = (ms / 1000 + 150) % STORM_EVERY;
  return smooth(0, STORM_RAMP, s) * (1 - smooth(STORM_FOR - STORM_RAMP, STORM_FOR, s));
}

/// The city's sign: its name in warm orange on a dark board, and a line for visitors.
function citySignTexture() {
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
  g.font = "400 76px Bungee, Impact, sans-serif";
  g.fillText("MARS CITY", 256, 82, 470);
  g.shadowBlur = 0;
  g.fillStyle = "#f2a03d";
  g.font = "400 26px Bungee, Impact, sans-serif";
  g.fillText("RED PLANET POST · WELCOME, COURIER", 256, 148, 470);
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

/// An astronaut colonist: a courier-style character in a white suit, a life-support pack in their team colour (`team`),
/// and a glass helmet with a light on top. Returns the same moving parts as a Martian, plus `tick` for the idle sway.
function astronautMesh(seed, team, W) {
  const r = mulberry32(seed), pick = (a) => a[Math.floor(r() * a.length)];
  const ch = createCharacter({
    skin: pick([0xf3d2bb, 0xe8bfa0, 0xd9a47f, 0xf6dcc8, 0xc98d68, 0x8d5a3b]), hair: pick([0x3a2a2c, 0x5a3b2c, 0x1f1c1e, 0x8a6a4a]),
    hairStyle: pick(["bob", "bun", "pony"]), headwear: "none", shirt: 0xf2f0ea, accent: team, bottoms: 0xe6e3dc, bottomsStyle: "pants",
    socks: 0xe6e3dc, shoes: 0x8d9790, bag: "backpack", height: 0.95 + r() * 0.1,
  });
  const g = new THREE.Group(), body = new THREE.Group(); // (body turns, hops and breathes; the character keeps its height)
  g.add(body);
  body.add(ch.root);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.25, depthWrite: false }));
  glass.position.set(0, 0.16, 0.02);
  ch.head.add(glass);
  W.noNormals.push(glass);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 6, 24), toon(0xe6e3dc));
  rim.position.set(0, 0.17, 0.12);
  ch.head.add(rim);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 6, 20), toon(0xc9ced6));
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, -0.08, 0);
  ch.head.add(collar);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: team }));
  tip.position.set(0.12, 0.42, 0);
  ch.head.add(tip);
  return { g, body, eyes: [], tips: [tip], tick: (dt, t) => ch.update(dt, 0, t) };
}

export function createMars(W) {
  const group = new THREE.Group();
  group.position.set(0, R - MARS_R, 0);
  group.visible = false;
  W.scene.add(group);
  const statics = new THREE.Group(); // what stands still: merged into one mesh at the end
  group.add(statics);
  const rnd = mulberry32(4242);
  const top = V(...LANDING), east = V(1, 0, 0), north = V(0, 0, 1);
  const place = (obj, d, h = 0, spin = 0, parent = statics) => {
    obj.position.copy(d).multiplyScalar(MARS_R + h);
    obj.quaternion.copy(W.frameAt(d, spin));
    parent.add(obj);
    return obj;
  };
  /// Stand `obj` on the ground at `d` (sunk `sink` metres in), its front toward the tangent `look`.
  const stand = (obj, d, look, sink = 0, parent = statics) => {
    obj.position.copy(d).multiplyScalar(MARS_R + ht(d) - sink);
    obj.quaternion.copy(facing(d, look));
    parent.add(obj);
    return obj;
  };
  const mesh = (geo, color, extra) => {
    const m = new THREE.Mesh(geo, toon(color, extra));
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const glowing = (geo, color) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  const glass = (geo, color = 0xc9f0f7, opacity = 0.22) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    W.noNormals.push(m);
    return m;
  };
  const obstacles = [];
  const circle = (d, r, opts = {}) => obstacles.push({ d, kind: "circle", r, ...opts, cos: Math.cos((r + 1) / MARS_R) });
  const keepOut = [{ d: top, r: 9 }]; // (rocks and the locals out in the wild stay clear of these)
  const blinkers = []; // glowing bits that blink ({ m, every, on, ph }) or pulse ({ m, pulse: true })
  const spotDirs = MARS_SPOTS.map((s) => V(...s.d));
  /// The nearest spot to `d0` (within `within` metres) at least `clear` metres from every stamp spot and clear of
  /// what's already here; `d0` itself if there's none.
  const settle = (d0, clear, within = 4) => {
    const t1 = new THREE.Vector3().crossVectors(d0, Math.abs(d0.y) < 0.9 ? top : east).normalize(), t2 = new THREE.Vector3().crossVectors(d0, t1);
    for (let i = 0; i < 400; i++) {
      const a = i * 2.39996, d = round(d0, t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)), within * Math.sqrt(i / 400));
      if (spotDirs.every((p) => marc(p, d) >= clear) && keepOut.every((k) => marc(k.d, d) >= k.r)) return d;
    }
    return d0;
  };

  // ---- the ground: a faceted red ball with dunes, mountains, the canyon (its walls in bands), the dark volcano and
  // the ice cap (heights worked out once per corner, then split into flat facets)
  {
    let geo = new THREE.IcosahedronGeometry(MARS_R, 56);
    geo.deleteAttribute("normal");
    geo.deleteAttribute("uv");
    geo = mergeVertices(geo);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), v = new THREE.Vector3(), c = new THREE.Color();
    const rust = new THREE.Color(0xc4683f), dune = new THREE.Color(0xdc8f5c), wall = new THREE.Color(0x9a4d33), basalt = new THREE.Color(0x5b3a31);
    const ice = new THREE.Color(0xf2f5f7), rock = new THREE.Color(0x8e4630), cityGround = new THREE.Color(0xd99a6c);
    const volD = V(...VOLCANO.d), iceD = V(...ICE.d), cityD = V(...CITY.d), mountains = MOUNTAINS.map((m) => ({ ...m, v: V(...m.d) }));
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const a = arr(v), h = marsHeight(a);
      pos.setXYZ(i, v.x * (MARS_R + h), v.y * (MARS_R + h), v.z * (MARS_R + h));
      c.copy(rust).lerp(dune, smooth(0.03, 0.15, h)); // (dune crests catch the light)
      const cy = canyonAt(a);
      if (cy && Math.abs(cy.s) < CANYON.half + 1 && Math.abs(cy.l) < CANYON.wall + 0.3 && h < -0.15) {
        c.copy(wall).lerp(dune, 0.45 * (0.5 + 0.5 * Math.sin(h * 7))); // layers of old dust
        if (h < -CANYON.depth + 0.2) c.copy(wall).multiplyScalar(0.9);
      } else if (h < -0.05) c.multiplyScalar(0.86); // crater floors, darker
      for (const m of mountains) {
        const u = marc(v, m.v) / m.r;
        if (u < 1) c.lerp(rock, Math.min(0.85, (1 - u) * 1.6)).lerp(dune, smooth(0.75, 1, h / m.h) * 0.4); // (darker rock, sunlit tops)
      }
      const vu = marc(v, volD) / VOLCANO.r;
      if (vu < 1) c.lerp(basalt, (1 - vu) ** 1.5);
      const cu = marc(v, cityD);
      if (cu < CITY.r + 2) c.lerp(cityGround, 0.5 * (1 - smooth(CITY.r - 2, CITY.r + 2, cu))); // (swept sand round the city)
      const iu = marc(v, iceD) + 1.4 * Math.sin(v.x * 23) * Math.sin(v.z * 19); // (a ragged edge)
      if (iu < ICE.r) c.lerp(ice, smooth(ICE.r, ICE.r - 2, iu));
      const grain = 1 + 0.07 * Math.sin(v.x * 71 + v.y * 47) * Math.sin(v.z * 59 - v.x * 37);
      col.set([c.r * grain, c.g * grain, c.b * grain], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    ground.receiveShadow = true;
    group.add(ground);
  }

  // ---- the spaceport: the landing pad with the rocket home, two tall rockets and a launch tower, the Mars Post box
  // and the rover garage. You step out beside the pad, facing the city.
  const { pad, rocket } = padAndRocket(mesh);
  place(pad, top, 0.02);
  place(rocket, top, 0.07, 0.6);
  circle(top.clone(), 0.75, { y1: 4.8 });
  const arrive = round(top, north, 2.8);
  const postD = round(round(top, east, 3.0), north, 0.6);
  stand(postBox(mesh, "MARS POST"), postD, arrive.clone().sub(postD));
  circle(postD.clone(), 0.35, { y1: 1.5 });
  // The MOON Missions board, ahead and to the right as you step out, by the way into the city.
  const boardD = round(round(top, east, 4.0), north, 4.8), board = missionBoard(mesh);
  stand(board.g, boardD, arrive.clone().sub(boardD), 0, group);
  circle(boardD.clone(), 0.6, { y1: 2.4 });
  /// A tall silver rocket on its stand.
  const bigRocket = (d) => {
    const g = new THREE.Group();
    const ring = mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.25, 24), 0x5a5f6e);
    ring.position.y = 0.12;
    g.add(ring);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, leg = mesh(new THREE.BoxGeometry(0.16, 1.0, 0.16), 0x8d9790);
      leg.position.set(Math.sin(a) * 0.95, 0.6, Math.cos(a) * 0.95);
      leg.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
      g.add(leg);
    }
    const body = mesh(new THREE.CylinderGeometry(0.8, 0.8, 6.2, 24), 0xd9dde0);
    body.position.y = 4.0;
    g.add(body);
    const tiles = mesh(new THREE.CylinderGeometry(0.81, 0.81, 6.0, 24, 1, true, Math.PI * 0.6, Math.PI * 0.8), 0x2a2a35);
    tiles.position.y = 4.0;
    g.add(tiles);
    const nose = mesh(new THREE.ConeGeometry(0.8, 2.2, 24), 0xd9dde0);
    nose.position.y = 8.2;
    g.add(nose);
    for (const s of [-1, 1]) {
      const flap = mesh(new THREE.BoxGeometry(0.08, 1.4, 0.7), 0x8d9790);
      flap.position.set(s * 0.85, 6.4, 0);
      g.add(flap);
      const fin = mesh(new THREE.BoxGeometry(0.08, 1.6, 0.9), 0x8d9790);
      fin.position.set(s * 0.85, 1.9, 0);
      g.add(fin);
    }
    stand(g, d, east);
    circle(d.clone(), 1.6, { wall: { h: 9 } });
    keepOut.push({ d, r: 2.4 });
  };
  const rocketN = round(top, north, 7), rocketS = round(round(top, north, -7), east, -1);
  bigRocket(rocketN);
  bigRocket(rocketS);
  {
    const tower = new THREE.Group(), towerD = round(rocketS, north, -3.2);
    const mast = mesh(new THREE.BoxGeometry(0.9, 10, 0.9), 0x5a5f6e);
    mast.position.y = 5;
    tower.add(mast);
    for (let y = 1; y < 10; y += 1.2) {
      const band = mesh(new THREE.BoxGeometry(1.0, 0.08, 1.0), 0x8d9790);
      band.position.y = y;
      tower.add(band);
    }
    const arm = mesh(new THREE.BoxGeometry(0.3, 0.3, 2.2), 0xf2a03d);
    arm.position.set(0, 7.5, 1.4);
    tower.add(arm);
    const light = glowing(new THREE.SphereGeometry(0.14, 10, 8), 0xff3b3b);
    light.position.y = 10.2;
    tower.add(light);
    blinkers.push({ m: light, every: 1.2, on: 0.4 });
    stand(tower, towerD, toward(towerD, rocketS));
    circle(towerD, 0.7, { wall: { h: 10 } });
    keepOut.push({ d: towerD, r: 1.4 });
  }
  // The rover garage, on the way to the city.
  const garageD = round(round(top, east, 8), north, -5.5);
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
    const look = toward(garageD, top);
    stand(g, garageD, look);
    const right = new THREE.Vector3().crossVectors(garageD, look).normalize();
    for (const [x, z] of [[-1.25, -1.1], [1.25, -1.1], [-1.25, 1.1], [1.25, 1.1]]) circle(round(round(garageD, right, x), look, z), 0.12);
    for (const x of [-0.9, 0, 0.9]) circle(round(round(garageD, right, x), look, -1.15), 0.45, { wall: { h: 1.9 } });
    keepOut.push({ d: garageD, r: 2.6 });
  }

  // ---- Mars City, laid out round its middle: `at(x, y)` is x metres from the middle toward the spaceport and y to
  // the side (and `onCity` presses a shape drawn on that plan onto the ground)
  const cityD = V(...CITY.d), toPad = toward(cityD, top), side = new THREE.Vector3().crossVectors(cityD, toPad).normalize();
  const at = (x, y) => {
    const m = Math.hypot(x, y);
    return m < 1e-6 ? cityD.clone() : round(cityD, toPad.clone().multiplyScalar(x / m).addScaledVector(side, y / m), m);
  };
  /// The point `r` metres from the middle of the city, `a` round from the way to the spaceport.
  const polar = (r, a) => at(r * Math.cos(a), r * Math.sin(a));
  /// A flat shape drawn in the city's plan (x toward the spaceport, z to the side; y ignored) laid on the ground,
  /// `lift` metres up, in one colour.
  const onCity = (geo, color, lift = 0.03) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const d = at(p.getX(i), p.getZ(i)), r = MARS_R + ht(d) + lift;
      p.setXYZ(i, d.x * r, d.y * r, d.z * r);
    }
    // (The plan's x and z land on the ground mirrored, so each triangle is turned back to face up.)
    for (let i = 0; i < geo.index.count; i += 3) {
      const t = geo.index.getX(i + 1);
      geo.index.setX(i + 1, geo.index.getX(i + 2));
      geo.index.setX(i + 2, t);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, toon(color));
    m.receiveShadow = true;
    statics.add(m);
    return m;
  };
  const flat = (geo) => geo.rotateX(-Math.PI / 2); // (from the x/y plane to the plan's x/z)
  keepOut.push({ d: cityD, r: CITY.r + 1 });
  // The ring road, its dashed middle line, and the paths: in from the spaceport to the plaza's door, and to each dome.
  onCity(flat(new THREE.RingGeometry(CITY.ring - 0.95, CITY.ring + 0.95, 160, 1)), 0x4a4448);
  onCity(mergeGeometries(Array.from({ length: 40 }, (_, k) => flat(new THREE.RingGeometry(CITY.ring - 0.06, CITY.ring + 0.06, 2, 1, (k / 40) * Math.PI * 2, Math.PI / 60)))), 0xf2c94c, 0.045);
  const path = (x0, x1, width, angle = 0) => {
    const g = flat(new THREE.PlaneGeometry(x1 - x0, width, Math.ceil((x1 - x0) / 0.8), 1)).translate((x0 + x1) / 2, 0, 0).rotateY(-angle);
    onCity(g, 0xd9b48c, 0.07); // (over the ring road where they cross)
  };
  path(6.8, CITY.r + 1, 2.2);
  const DOMES = [30, 90, 150, 210, 270, 330].map((a, i) => ({ a: deg(a), kind: i % 2 ? "home" : "green" }));
  for (const d of DOMES) path(6.6, CITY.domes - 3.1, 1.6, d.a);

  // The plaza: a big glass dome you can walk into, with a garden and a fountain inside.
  const PLAZA = 6.5;
  {
    const g = new THREE.Group();
    const base = mesh(new THREE.TorusGeometry(PLAZA, 0.22, 6, 64), 0xd9d4ca);
    base.rotation.x = Math.PI / 2;
    base.position.y = 0.15;
    g.add(base);
    for (let i = 0; i < 6; i++) {
      const rib = mesh(new THREE.TorusGeometry(PLAZA, 0.06, 4, 40, Math.PI), 0xeceae4);
      rib.rotation.y = (i / 6) * Math.PI;
      g.add(rib);
    }
    for (const el of [0.45, 0.95]) {
      const ring = mesh(new THREE.TorusGeometry(PLAZA * Math.cos(el), 0.06, 4, 48), 0xeceae4);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = PLAZA * Math.sin(el);
      g.add(ring);
    }
    const arch = mesh(new THREE.TorusGeometry(1.15, 0.12, 6, 20, Math.PI), 0xf2a03d);
    arch.position.set(0, 0.2, PLAZA - 0.05);
    g.add(arch);
    const beacon = glowing(new THREE.SphereGeometry(0.22, 12, 8), 0xffd79a);
    beacon.position.y = PLAZA + 0.25;
    g.add(beacon);
    stand(g, cityD, toPad);
    stand(glass(new THREE.SphereGeometry(PLAZA, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2)), cityD, toPad, 0, group);
    // The garden inside: grass, a fountain, trees, benches.
    onCity(flat(new THREE.RingGeometry(0, PLAZA - 0.3, 64, 10)), 0x7cb35a, 0.04); // (in rings, so it follows the ground)
    const fountain = new THREE.Group();
    const basin = mesh(new THREE.TorusGeometry(1.25, 0.18, 8, 28), 0xd9d4ca);
    basin.rotation.x = Math.PI / 2;
    basin.position.y = 0.2;
    fountain.add(basin);
    const water = mesh(new THREE.CircleGeometry(1.2, 28), 0x5fb8de);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.22;
    fountain.add(water);
    const spout = mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.0, 10), 0xd9d4ca);
    spout.position.y = 0.6;
    fountain.add(spout);
    const bowl = mesh(new THREE.SphereGeometry(0.42, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xd9d4ca);
    bowl.position.y = 1.15;
    fountain.add(bowl);
    stand(fountain, cityD, toPad);
    circle(cityD.clone(), 1.4, { y1: 1.3 });
    for (const a of [45, 135, 225, 315].map(deg)) {
      const d = polar(4.0, a), tree = new THREE.Group();
      const trunk = mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.2, 8), 0x7a5a3a);
      trunk.position.y = 0.6;
      tree.add(trunk);
      for (const [y, r] of [[1.5, 0.8], [2.2, 0.6]]) {
        const leaves = mesh(new THREE.ConeGeometry(r, 1.1, 10), 0x4f9e3f);
        leaves.position.y = y;
        tree.add(leaves);
      }
      stand(tree, d, toPad);
      circle(d, 0.3, { y1: 2.8 });
      const benchD = polar(4.0, a + 0.42), bench = new THREE.Group();
      const seat = mesh(new THREE.BoxGeometry(1.1, 0.08, 0.4), 0xb0784a);
      seat.position.y = 0.45;
      bench.add(seat);
      for (const x of [-0.45, 0.45]) {
        const leg = mesh(new THREE.BoxGeometry(0.08, 0.45, 0.36), 0x3b4145);
        leg.position.set(x, 0.22, 0);
        bench.add(leg);
      }
      stand(bench, benchD, toward(benchD, cityD));
      circle(benchD, 0.45, { y1: 0.5 });
    }
    // Its wall: the glass all round, but for the doorway toward the spaceport.
    for (let k = 0; k < 74; k++) {
      const a = (k / 74) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.22) continue;
      circle(polar(PLAZA, a), 0.32, { wall: { h: PLAZA } });
    }
  }
  // The domes round the plaza: greenhouses full of plants, and homes; tubes join each greenhouse to the home after it.
  const DOME_R = 3.1;
  for (const d of DOMES) {
    const c = polar(CITY.domes, d.a), g = new THREE.Group(), look = toward(c, cityD);
    const base = mesh(new THREE.CylinderGeometry(DOME_R + 0.1, DOME_R + 0.2, 0.35, 32), 0xd9d4ca);
    base.position.y = 0.17;
    g.add(base);
    if (d.kind === "green") {
      // Rows of plants under glass, and a soft grow-light.
      for (let row = -2; row <= 2; row++) {
        const bed = mesh(new THREE.BoxGeometry(0.5, 0.25, Math.sqrt(Math.max(0, (DOME_R - 0.4) ** 2 - (row * 0.95) ** 2)) * 2), 0x6e3f2a);
        bed.position.set(row * 0.95, 0.47, 0);
        g.add(bed);
        for (let z = -2; z <= 2; z++) {
          if (Math.hypot(row * 0.95, z * 0.9) > DOME_R - 0.6) continue;
          const plant = (row + z) % 2 ? mesh(new THREE.SphereGeometry(0.24, 10, 8), 0x6fbf4f) : mesh(new THREE.ConeGeometry(0.2, 0.6, 8), 0x4f9e3f);
          plant.position.set(row * 0.95, 0.85, z * 0.9);
          g.add(plant);
        }
      }
      for (let i = 0; i < 4; i++) {
        const rib = mesh(new THREE.TorusGeometry(DOME_R, 0.04, 4, 28, Math.PI), 0xd9d4ca);
        rib.position.y = 0.35;
        rib.rotation.y = (i / 4) * Math.PI;
        g.add(rib);
      }
      const lamp = glowing(new THREE.SphereGeometry(0.12, 10, 8), 0xd6ffcf);
      lamp.position.y = DOME_R + 0.2;
      g.add(lamp);
      stand(g, c, look);
      const pane = glass(new THREE.SphereGeometry(DOME_R, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xc9f7dc, 0.2);
      pane.position.y = 0.35;
      const holder = new THREE.Group();
      holder.add(pane);
      stand(holder, c, look, 0, group);
    } else {
      // A home: a white dome with warm windows, an orange band, and a door toward the plaza.
      const shell = mesh(new THREE.SphereGeometry(DOME_R, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xeee9df);
      shell.position.y = 0.35;
      g.add(shell);
      const band = mesh(new THREE.TorusGeometry(DOME_R + 0.01, 0.06, 6, 36), 0xf2a03d);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.8;
      g.add(band);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8, el = 0.55;
        const w = glowing(new THREE.SphereGeometry(0.15, 10, 8), 0xffd79a);
        w.position.set(Math.sin(a) * DOME_R * Math.cos(el), 0.35 + DOME_R * Math.sin(el), Math.cos(a) * DOME_R * Math.cos(el));
        g.add(w);
      }
      const door = mesh(new THREE.BoxGeometry(0.9, 1.25, 0.5), 0x3b2f2a);
      door.position.set(0, 0.95, DOME_R - 0.2);
      g.add(door);
      stand(g, c, look);
    }
    circle(c, DOME_R + 0.1, { wall: { h: DOME_R + 0.4 } });
  }
  for (let k = 0; k < 3; k++) {
    // A tube from each greenhouse to the home after it, low enough on Mars to jump over.
    const a = polar(CITY.domes, DOMES[k * 2].a), b = polar(CITY.domes, DOMES[k * 2 + 1].a);
    for (let i = 0; i <= 9; i++) {
      const d = a.clone().lerp(b, 0.27 + (0.46 * i) / 9).normalize();
      circle(d, 0.45, { y1: ht(d) + 1.05 });
    }
    const mid = a.clone().add(b).normalize(), len = marc(a, b) - 2 * DOME_R + 0.4;
    const tube = new THREE.Group();
    const pipe = mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 16), 0xe6e3dc);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.y = 0.55;
    tube.add(pipe);
    for (const x of [-len / 3, 0, len / 3]) {
      const hoop = mesh(new THREE.TorusGeometry(0.44, 0.05, 6, 16), 0xf2a03d);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(x, 0.55, 0);
      tube.add(hoop);
    }
    stand(tube, mid, new THREE.Vector3().crossVectors(toward(mid, b), mid)); // (its length along the way from a to b)
  }
  // Farms and pools between the domes, outside them: rows of crops, and blue pools with a white rim.
  for (const a of [60, 180, 300].map(deg)) {
    for (let row = 0; row < 6; row++) {
      const r0 = CITY.domes + 3.6 + row * 0.55;
      onCity(flat(new THREE.RingGeometry(r0, r0 + 0.5, 24, 1, a - deg(16), deg(32))), row % 2 ? 0x6fbf4f : 0x4f9e3f, 0.04);
    }
  }
  const pools = [120, 240].map((a) => polar(CITY.domes + 5.0, deg(a)));
  for (const d of pools) {
    const p = new THREE.Group();
    const water = mesh(new THREE.CircleGeometry(1.7, 28), 0x5fb8de);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.05;
    p.add(water);
    const rim = mesh(new THREE.TorusGeometry(1.75, 0.12, 6, 32), 0xf4f1ea);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.08;
    p.add(rim);
    stand(p, d, toPad);
    circle(d, 1.75, { y1: 0.3 });
  }
  // The sign at the city's edge, where the path from the spaceport comes in.
  {
    const sign = new THREE.Group();
    for (const x of [-0.85, 0.85]) {
      const post = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), 0x3b4145);
      post.position.set(x, 0.65, 0);
      sign.add(post);
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.72), new THREE.MeshBasicMaterial({ map: citySignTexture(), side: THREE.DoubleSide }));
    board.position.set(0, 1.4, 0.03);
    sign.add(board);
    const d = at(CITY.r + 0.5, 2.6);
    stand(sign, d, toward(d, top));
    circle(d, 0.95, { y1: ht(d) + 1.8 });
  }
  // The rover, parked in the garage until someone takes it (and wherever they leave it after).
  const roverMesh = createRide("rover");
  const roverBlock = { d: garageD.clone(), kind: "circle", r: 0.95, y1: 1.3, cos: Math.cos(2 / MARS_R) };
  obstacles.push(roverBlock);
  let roverAt = garageD.clone(), roverTaken = false;
  /// Park the rover at `d`, its front toward `look` (a direction along the ground).
  function parkRover(d, look) {
    roverAt = d.clone();
    stand(roverMesh.group, d, look, 0, group);
    roverMesh.group.visible = true;
    Object.assign(roverBlock, { d: d.clone(), y1: ht(d) + 1.3, cos: Math.cos(2 / MARS_R) });
    roverTaken = false;
  }
  const parkHome = () => parkRover(garageD, toward(garageD, top));
  parkHome();

  // ---- the locals: Martians and astronaut colonists, in the city and out where the exploring is. Each gets letters.
  const locals = createLocals(MARS_R), residents = [];
  const add = (f, d, name, lines, look = top) => {
    f.g.position.copy(d).multiplyScalar(MARS_R + ht(d));
    f.g.quaternion.copy(facing(d, toward(d, look)));
    group.add(f.g);
    circle(d.clone(), 0.42, { y1: ht(d) + 1.7 });
    keepOut.push({ d, r: 1.2 });
    locals.add(f, d, name, lines, rnd() * 6);
    residents.push({ name, d });
  };
  const martian = (d, name, lines, colors, look) => add(martianMesh(...colors, mesh), d, name, lines, look);
  let crew = 0;
  const astronaut = (d, name, lines, team, look) => add(astronautMesh(9100 + 37 * crew++, team, W), d, name, lines, look);
  const doorOf = (a, out = 1.1) => polar(CITY.domes - DOME_R - out, a); // (just in front of a dome's door)

  martian(at(3.0, 1.6), "Mayor Zibble", [
    "Welcome to Mars City! Population twenty. Twenty-one with you. Twenty-two if you count the rover. We count the rover.",
    "Mail used to take seven months to reach us. Then you showed up with a rocket.",
    "Our motto: dust off and carry on. It's also our cleaning schedule.",
    "The Mars Post box by the spaceport has letters for all of us. Some of us live a very long walk away.",
  ], [0x3fb7a8, 0xffe066, 0xf2a03d], top);
  astronaut(at(-3.4, -1.0), "Commander Ada", [
    "I run this city. Mostly that means reminding everyone the dome door is not a window.",
    "The plaza dome holds a whole park. Breathe deep. It's the only grass for a very long way.",
    "Beyond the ring road it's all red. Take the rover if you're going far, and come back before your ticket runs out.",
  ], 0x5d8fd1, cityD);
  astronaut(at(-1.0, 3.5), "Chef Marco", [
    "Tonight's special: rusty potatoes, grown next door. They taste like home. A very red home.",
    "Cooking in low gravity is easy. Keeping the soup in the pot is the hard part.",
    "A letter for the chef? Put it with the others. I use them for recipes. Kidding. Mostly.",
  ], 0xd9534a, cityD);
  astronaut(doorOf(DOMES[0].a), "Botanist Mei", [
    "Every plant in this greenhouse has a name. That one's Gerald. Gerald is a tomato.",
    "Red dirt, a little water, a lot of light, and patience. Mars grows things if you ask nicely.",
    "Mind the glass. Last week a courier walked into it. They're fine. The glass is also fine.",
  ], 0x7cc36a, polar(CITY.domes, DOMES[0].a));
  martian(doorOf(DOMES[2].a), "Dr. Rusta", [
    "I grow potatoes in red dirt. They taste a little rusty. I call them rusties.",
    "The greenhouses glow at night. The plants like it. I like it. The rover is jealous.",
    "Mind the dust storms. When the sky goes orange, keep walking. It's only dust. Probably.",
  ], [0x9a7fd1, 0x8ffcff, 0xf2c94c], polar(CITY.domes, DOMES[2].a));
  astronaut(polar(CITY.domes + 5.0, deg(180)), "Farmer Ollie", [
    "First farm on Mars. Second if you count Rusta's window box. I don't.",
    "Rows of beans, rows of greens, rows of red dust between them. I sweep a lot.",
    "Plants out here grow tall in the low gravity. My beans are taller than me now.",
  ], 0xf2c94c, cityD);
  astronaut(doorOf(DOMES[1].a), "Medic Ines", [
    "Bumped your helmet? Twisted an ankle on a big Mars jump? The clinic's open all night.",
    "Remember: drink water, wear your suit, and don't lick the ice cap. Tula did. Once.",
    "Thank you for the letters. The post is the best medicine out here.",
  ], 0xf4f1ea, cityD);
  astronaut(doorOf(DOMES[5].a), "Teacher Lena", [
    "We have three pupils and one rover. The rover is the best behaved.",
    "Today's lesson: why the sky is orange and the sunsets are blue. Mars does everything backwards.",
    "If you're ever lost, follow the ring road. It always brings you back. That's the point of a ring.",
  ], 0x8d7299, cityD);
  astronaut(round(pools[0], toward(pools[0], cityD), 2.3), "Lifeguard Tom", [
    "Best pool on Mars. Only pool on Mars. Apart from that one over there.",
    "No running, no diving, no throwing rocks in. You'd be amazed.",
    "The water came from the ice cap. It's had a very long trip, like you.",
  ], 0x5fb8de, pools[0]);
  astronaut(round(rocketN, toward(rocketN, top), 2.4), "Pilot Sam", [
    "I fly the shuttle you see going over. Same route every day. Nice view, though.",
    "These big rockets are ours. Your little one's cute. Very good for letters.",
    "Landing on Mars is easy. You just need to stop before the ground does it for you.",
  ], 0xf2a03d, top);
  astronaut(round(rocketS, toward(rocketS, top), 2.4), "Engineer Rosa", [
    "I keep the rockets, the tower and the domes running. Mostly with tape.",
    "Pip looks after the rover. I look after everything Pip breaks fixing the rover.",
    "Got a letter? Leave it on the toolbox. I'll read it on my break. My break is next year.",
  ], 0xe46f5f, top);
  martian(round(garageD, toward(garageD, top), 2.3), "Pip", [
    "That's our rover. Six wheels, no brakes worth mentioning. Hop in (E) and take it for a spin.",
    "Drive it to the canyon, up the volcano, round to the ice cap. Bring it back. Mostly in one piece.",
    "I fixed the rover with a spoon. Don't ask which part.",
  ], [0x7fd1a0, 0xff7a5c, 0xfbf6ea], top);
  // Out in the wild, clear of the stamp spots.
  martian(settle(V(...canyonFloor(-8)), 2.4, 3), "Geo", [
    "This canyon is very old. Older than your postcode.",
    "Every stripe in these walls is a different century of dust. I've read most of them.",
    "I came down here to find rare rocks. Mostly I find more canyon.",
  ], [0x6fa8dc, 0xb8ff9e, 0xd9534a], V(...canyonFloor(0)));
  astronaut(settle(V(...canyonFloor(9)), 2.4, 3), "Geologist Ravi", [
    "Geo and I disagree about everything. Except that this canyon is beautiful.",
    "These layers are a history book of Mars. Every page is red.",
    "If you see a shiny rock, tell me. If you see a shiny stamp, keep it.",
  ], 0x8a6a4a, V(...canyonFloor(0)));
  const volD = V(...VOLCANO.d), upVol = toward(volD, top);
  const ozzyD = settle(round(volD, upVol, VOLCANO.crater + 1.4), 3.2, 3);
  {
    const sideV = new THREE.Vector3().crossVectors(ozzyD, toward(ozzyD, top)).normalize(), tentD = round(ozzyD, sideV, 1.6);
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
    const glow = new THREE.Mesh(new THREE.CircleGeometry(2.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(glow);
    place(holder, volD, ht(volD) + 0.05, 0, group);
    W.noNormals.push(glow);
    blinkers.push({ m: glow, pulse: true });
  }
  martian(ozzyD, "Old Ozzy", [
    "I live on top of the volcano. It's asleep. I check every morning.",
    "Best view on Mars. You can see the city's domes shining from up here.",
    "When the ground goes warm, I go for a walk. A long walk. Toward the ice.",
  ], [0xb48ad9, 0xff5cd1, 0x3fb7a8], top);
  astronaut(settle(round(volD, upVol, VOLCANO.r + 1.5), 2.4, 3), "Hiker Bo", [
    "I'm climbing the volcano today. I said that yesterday too. It's a big volcano.",
    "Low gravity makes the climb easy. It's the coming down that's bouncy.",
    "Ozzy lives at the top. Bring him a letter. He'll pretend he doesn't want it.",
  ], 0x9cc46f, volD);
  {
    const peak = MOUNTAINS.reduce((a, b) => (b.h > a.h ? b : a)), pd = V(...peak.d);
    astronaut(settle(round(pd, toward(pd, top), peak.r * 0.45), 2.4, 3), "Climber Juno", [
      "These are the Red Ridge mountains. I've climbed every one. Twice. On Mars that's not even hard.",
      "From up here you can see the whole city, the spaceport, and a shuttle going over.",
      "A letter, all the way up here? You're my favourite courier. Don't tell the others.",
    ], 0xe46f5f, cityD);
  }
  {
    const radioD = V(...RADIO), out = toward(radioD, top).negate(), sideV = new THREE.Vector3().crossVectors(radioD, out).normalize();
    const dishD = round(radioD, out, 1.8), hutD = round(radioD, sideV, -2.0);
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
    keepOut.push({ d: dishD, r: 1.7 }, { d: hutD, r: 1.5 });
    martian(radioD, "Tula", [
      "I run the radio out here by the ice. Mostly I listen to dust storms. They hum.",
      "Courier World's radio is all music and traffic. Ours is all wind. I prefer the wind.",
      "The ice cap is the only cold drink on Mars. Don't lick it. Trust me.",
    ], [0x4fc3c9, 0xffb35c, 0xd9534a], top);
    const iceD = V(...ICE.d);
    astronaut(settle(round(radioD, toward(radioD, iceD), 6), 2.4, 3), "Scientist Noor", [
      "This ice is older than anything on Courier World. I'm counting the layers. Slowly.",
      "Every drink of water in the city started here. You're welcome.",
      "Careful on the ice. Low gravity, no grip: it's a slide, not a walk.",
    ], 0x5d8fd1, iceD);
  }
  {
    const c = MARS_CRATERS.reduce((a, b) => (marc(V(...b.d), top) < marc(V(...a.d), top) ? b : a), MARS_CRATERS[0]); // (the nearest crater)
    const cd = V(...c.d);
    martian(settle(round(cd, toward(cd, top), c.r + 1.0), 2.4, 3), "Nix", [
      "I race the dust devils. They always win, but I'm getting closer.",
      "Mum says don't play in the craters. This isn't a crater. It's a very big hole.",
      "Is that a real paper letter? Can I keep the envelope too?",
    ], [0x8c9eff, 0x7dff6a, 0xf2c94c], cd);
  }

  // ---- rocks, and chunks of ice by the cap, kept off the places, the stamp spots and each other
  {
    const iceD = V(...ICE.d), rocks = [];
    for (let i = 0; i < 4000 && rocks.length < 80; i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), d = V(s * Math.cos(t), z, s * Math.sin(t));
      const onIce = marc(d, iceD) < ICE.r - 1.5, size = onIce ? 0.2 + rnd() * 0.3 : 0.25 + rnd() * rnd() * 1.0;
      if (keepOut.some((k) => marc(k.d, d) < k.r + size) || spotDirs.some((p) => marc(p, d) < 1.4 + size) || rocks.some((r) => marc(r.d, d) < r.size + size + 1.2)) continue;
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

  // ---- the sky: a shuttle going over, Mars's two little moons going round, and Courier World far off
  const shuttle = new THREE.Group();
  {
    const body = mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.2, 16), 0xd9dde0);
    body.rotation.x = Math.PI / 2;
    shuttle.add(body);
    const nose = mesh(new THREE.ConeGeometry(0.5, 1.2, 16), 0xd9dde0);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 2.2;
    shuttle.add(nose);
    for (const s of [-1, 1]) {
      const wing = mesh(new THREE.BoxGeometry(1.6, 0.08, 1.2), 0x8d9790);
      wing.position.set(s * 0.9, 0, -0.6);
      shuttle.add(wing);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -2.4;
    shuttle.add(flame);
    W.noNormals.push(flame);
    group.add(shuttle);
  }
  const lump = (r, color, seed) => {
    const geo = new THREE.DodecahedronGeometry(r, 1), pos = geo.attributes.position, v = new THREE.Vector3(), jr = mulberry32(seed);
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, ...v.fromBufferAttribute(pos, i).multiplyScalar(0.82 + 0.3 * jr()).toArray());
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, toon(color));
  };
  const moons = [
    { m: lump(4.5, 0x8d847a, 7), r: 120, every: 110, ph: 0.5, tilt: 0.42 },
    { m: lump(2.8, 0xa39a8f, 11), r: 170, every: 260, ph: 2.4, tilt: 0.3 },
  ];
  for (const o of moons) group.add(o.m);
  const home = homePlanet(9);
  home.position.copy(V(-0.6, 0.7, 0.4).normalize()).multiplyScalar(280);
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
  const stamps = dayStamps(W, group, (obj, d, h, spin) => place(obj, d, h, spin, group), { R: MARS_R, spots: MARS_SPOTS, pick: marsSpots }, rnd);

  // ---- everything that stands still, merged into one mesh (glass, lights, signs and anything that glows stay apart)
  {
    const batch = new Batch(), merged = [];
    group.updateMatrixWorld(true);
    const inv = group.matrixWorld.clone().invert(), m4 = new THREE.Matrix4();
    statics.traverse((o) => {
      const mat = o.material;
      if (!o.isMesh || !mat?.isMeshToonMaterial || mat.transparent || mat.map || mat.vertexColors || (mat.emissive && mat.emissive.getHex() !== 0) || mat.side === THREE.DoubleSide) return;
      batch.add(o.geometry, m4.multiplyMatrices(inv, o.matrixWorld), mat.color);
      merged.push(o);
    });
    for (const o of merged) o.parent.remove(o);
    group.add(batch.build(toon(0xffffff, { vertexColors: true })));
  }

  const shuttleU = cityD.clone(), shuttleV = toward(cityD, V(...VOLCANO.d));
  return {
    group,
    /// What main.js walks on here.
    ground: {
      key: "mars", R: MARS_R, center: group.position.clone(), group, gravity: MARS_GRAVITY, obstacles,
      terrain: { surfaceAt: (d) => ht(d), baseAt: (d) => ht(d), waterAt: () => null, ramps: [], inRamp: () => null },
    },
    /// Where you step out (beside the pad, facing the city) and the rocket home (stand within `reach`).
    arrival: { d: arrive, tangent: east.clone() },
    rocket: { d: top.clone(), reach: 2.9 },
    /// The Mars Post box (stand within `reach` with an empty bag for letters), and who the letters are for.
    post: { d: postD, reach: 1.8, name: "Mars Post box" },
    /// The MOON Missions board (stand within `reach` and press E to pick up a MOON letter).
    board: { d: boardD, reach: 2.2 },
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
    /// The local within `reach` metres of `me`, nearest first, to talk to: { name, line(), talk(on) }, or null.
    nearestLocal: (me, reach) => locals.nearest(me, reach),
    /// How thick the dust is right now (0 … 1).
    get dust() { return dust; },
    /// Leaving Mars: the dust stops blowing past.
    leave() {
      motes.visible = false;
      dust = 0;
    },
    /// The locals, the lights, the shuttle, the moons, the dust, and the stamps: they spin and bob, and any the
    /// courier reaches (`me`: where they are, Mars-local; `chest`: how high) is picked up. Returns the spot picked up,
    /// or null.
    update(dt, t, { me, chest, active }) {
      locals.update(dt, t, me);
      board.moon.scale.setScalar(1 + 0.06 * Math.sin(t * 2.2));
      for (const b of blinkers) {
        if (b.pulse) b.m.material.opacity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.3));
        else b.m.visible = (t + (b.ph ?? 0)) % b.every < b.on;
      }
      // The shuttle: round Mars over the city and the volcano, nose first.
      const a = t * ((Math.PI * 2) / 80), dir = shuttleU.clone().multiplyScalar(Math.cos(a)).addScaledVector(shuttleV, Math.sin(a)).normalize();
      const ahead = shuttleU.clone().multiplyScalar(-Math.sin(a)).addScaledVector(shuttleV, Math.cos(a)).normalize();
      shuttle.position.copy(dir).multiplyScalar(MARS_R + 22 + Math.sin(t * 0.4) * 2);
      shuttle.quaternion.copy(facing(dir, ahead));
      for (const o of moons) {
        const s = (t / o.every) * Math.PI * 2 + o.ph;
        o.m.position.set(Math.cos(s) * o.r, o.r * (o.tilt + 0.25 * Math.sin(s)), Math.sin(s) * o.r);
        o.m.rotation.y = s * 0.5;
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
