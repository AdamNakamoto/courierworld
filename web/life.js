// Life around town: residents who wait by their doors or stroll the sidewalks, look round at you and
// wave; birds that peck about and scatter when you come close; cats; and butterflies by day and
// fireflies at night. It all lives on the planet (in W.world), so it stays put as you walk on.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { R, ROADS, ROAD_HW, WALK, arc, toon, mulberry32, texFromCanvas, offsetOnSphere, nearestRoad } from "./world.js";
import { createCharacter, villager, compact } from "./character.js";

const WALKER_NAMES = ["Mr. Abe", "Koko", "Granny Sue", "Ken", "Mai", "Mr. Fuji", "Lulu", "Hiro", "Mrs. Tan", "Bo", "Nori", "Uncle Teo", "Saki", "Gen"];
const HELLO = {
  day: ["Morning!", "Hi there!", "Nice day!", "Hello!", "Busy day?", "Hey!"],
  night: ["Evening!", "Late round?", "Night!", "Still working?"],
  rain: ["Stay dry!", "Brr, rain!", "Wet one!"],
};
const CHAT = {
  any: [
    "Have you seen a ginger cat? She wanders off every afternoon.",
    "The bakery on the far side does melon bread on Thursdays.",
    "My nephew wants to be a courier too. Says you get to see the whole planet.",
    "I walk this street every day. Round the planet and back by lunch!",
    "If you jump on the spot, the birds think you're one of them. Probably.",
    "The post office used to be a noodle shop, you know.",
    "Somebody's been leaving golden stamps around town. Strange, isn't it?",
    "My knees say rain's coming. My knees are usually right.",
  ],
  day: ["Lovely light today. The whole street looks freshly painted.", "The butterflies are out by the parks. Go and look!"],
  night: ["The fireflies come out in the parks after dark. Worth a detour.", "Can't sleep, so I count street lamps. Forty-one so far."],
  rain: ["Rain's good for the trees. Bad for the post, though!", "I like the sound on the roofs. Very calming."],
};

const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];

/// Point an object up `up` (a unit vector, its local +y) and facing `forward` (its local +z).
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _z = new THREE.Vector3();
function orient(obj, up, forward) {
  _z.copy(forward).addScaledVector(up, -forward.dot(up)).normalize();
  _x.crossVectors(up, _z);
  _m.makeBasis(_x, up, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}
/// Signed angle from `forward` to `to` around `up`, positive toward the object's local +x (its left).
function turnTo(up, forward, to) {
  _x.crossVectors(up, forward);
  return Math.atan2(to.dot(_x), to.dot(forward));
}
const tangent = (from, to) => to.clone().sub(from).addScaledVector(from, -to.clone().sub(from).dot(from));

// ---------------------------------------------------------------- speech bubbles

function bubbleTexture(text) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d");
  g.font = "700 30px system-ui, -apple-system, sans-serif";
  const w = Math.min(240, g.measureText(text).width + 40), x = (256 - w) / 2;
  g.fillStyle = "#fbf8ef";
  g.strokeStyle = "#283033";
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(x, 8, w, 56, 18);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(116, 61);
  g.lineTo(128, 86);
  g.lineTo(142, 61);
  g.fill();
  g.stroke();
  g.fillRect(118, 55, 22, 8);
  g.fillStyle = "#283033";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 37);
  return texFromCanvas(c);
}

function createBubbles(world, noNormals) {
  const cache = new Map();
  const pool = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    s.visible = false;
    s.renderOrder = 2;
    world.add(s);
    noNormals.push(s);
    pool.push({ s, life: 0, max: 1, who: null, h: 2 });
  }
  return {
    /// A bubble over `who` (an Object3D on the planet) for a couple of seconds.
    say(who, text, h = 2.1) {
      let b = pool.find((p) => p.who === who) ?? pool.find((p) => p.life <= 0) ?? pool.reduce((a, p) => (p.life < a.life ? p : a));
      if (!cache.has(text)) cache.set(text, bubbleTexture(text));
      b.s.material.map = cache.get(text);
      b.s.material.needsUpdate = true;
      b.who = who;
      b.h = h;
      b.life = b.max = 2.6;
      b.s.visible = true;
    },
    update(dt) {
      for (const b of pool) {
        if (b.life <= 0) continue;
        b.life -= dt;
        if (b.life <= 0) {
          b.s.visible = false;
          b.who = null;
          continue;
        }
        const age = b.max - b.life;
        // Pop in with a little overshoot, fade out at the end.
        const pop = age < 0.25 ? 1 + 0.25 * Math.sin((age / 0.25) * Math.PI) * (age / 0.25) : 1;
        const k = Math.min(1, age / 0.12) * pop;
        b.s.scale.set(1.5 * k, 0.56 * k, 1);
        b.s.material.opacity = Math.min(1, b.life / 0.3);
        const up = b.who.position.clone().normalize();
        b.s.position.copy(b.who.position).addScaledVector(up, b.h);
      }
    },
  };
}

// ---------------------------------------------------------------- birds

function birdGeometry() {
  const paint = (g, hex) => {
    const c = new THREE.Color(hex), a = [];
    for (let i = 0; i < g.attributes.position.count; i++) a.push(c.r, c.g, c.b);
    g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
    return g;
  };
  return mergeGeometries([
    paint(new THREE.SphereGeometry(0.09, 8, 6).scale(1, 0.85, 1.45).translate(0, 0.09, 0), 0xffffff),
    paint(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.17, 0.11), 0xd8d0c8),
    paint(new THREE.ConeGeometry(0.022, 0.07, 5).rotateX(Math.PI / 2).translate(0, 0.165, 0.19), 0xe8a83a),
    paint(new THREE.BoxGeometry(0.07, 0.016, 0.12).translate(0, 0.1, -0.17), 0x9a9088),
  ]);
}

// ---------------------------------------------------------------- cats

const CAT_COATS = [
  { body: 0xe0954f, dark: 0xb86e33 }, { body: 0x8d9399, dark: 0x6b7178 }, { body: 0x38383d, dark: 0x26262a },
  { body: 0xf1ece2, dark: 0xd9cdb8 }, { body: 0xd8c3a5, dark: 0x8a6a4a },
];
function makeCat(coat) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const add = (parent, geo, color, x, y, z) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // Sitting up: a pear of a body, paws in front, head on top.
  add(body, new THREE.SphereGeometry(0.16, 10, 8), coat.body, 0, 0.15, -0.03).scale.set(0.9, 1.15, 1);
  add(body, new THREE.SphereGeometry(0.11, 10, 8), coat.body, 0, 0.3, 0.03);
  for (const s of [-1, 1]) add(body, new THREE.SphereGeometry(0.04, 6, 5), coat.dark, s * 0.06, 0.03, 0.11);
  const head = new THREE.Group();
  head.position.set(0, 0.42, 0.04);
  body.add(head);
  add(head, new THREE.SphereGeometry(0.1, 10, 8), coat.body, 0, 0, 0).scale.set(1.1, 0.95, 1);
  for (const s of [-1, 1]) {
    const ear = add(head, new THREE.ConeGeometry(0.04, 0.08, 4), coat.dark, s * 0.06, 0.09, -0.01);
    ear.rotation.z = -s * 0.25;
  }
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.014, 5, 4), 0x283033, s * 0.04, 0.01, 0.09);
  add(head, new THREE.SphereGeometry(0.012, 5, 4), 0xd77a8a, 0, -0.02, 0.1);
  // The tail curls round on the ground; each segment hangs off the last so it can sway.
  const tail = [];
  let parent = body;
  const t0 = new THREE.Group();
  t0.position.set(0, 0.04, -0.17);
  body.add(t0);
  parent = t0;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    if (i) seg.position.set(0, 0, -0.09);
    parent.add(seg);
    const m = add(seg, new THREE.CylinderGeometry(0.025, 0.028, 0.1, 6), i === 3 ? coat.dark : coat.body, 0, 0, -0.045);
    m.rotation.x = Math.PI / 2;
    seg.rotation.y = 0.35;
    tail.push(seg);
    parent = seg;
  }
  compact(root);
  return { root, body, head, tail };
}

// ---------------------------------------------------------------- DOg PEt, the dog by the post office

/// A chunky grey pup in a red scarf, built from blocks like the pixel dog it comes from. Shaped like a
/// character ({ root, head, update, setWave }), so it stands, turns and greets you like the residents.
function makeDog() {
  const COAT = 0x8f978c, DARK = 0x667066, LIGHT = 0xc2c8bd, SCARF = 0xd9534a, INK = 0x283033;
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const add = (parent, geo, color, x, y, z) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  add(body, B(0.24, 0.2, 0.4), COAT, 0, 0.29, -0.02);
  add(body, B(0.2, 0.05, 0.32), LIGHT, 0, 0.185, -0.02);
  for (const [x, z] of [[-0.075, 0.12], [0.075, 0.12], [-0.075, -0.15], [0.075, -0.15]]) {
    add(body, B(0.07, 0.2, 0.08), COAT, x, 0.1, z);
    add(body, B(0.076, 0.04, 0.09), DARK, x, 0.02, z + 0.005);
  }
  // The scarf, knotted at the front.
  add(body, B(0.27, 0.07, 0.13), SCARF, 0, 0.38, 0.15);
  add(body, new THREE.ConeGeometry(0.06, 0.12, 3), SCARF, 0.04, 0.31, 0.22).rotation.x = Math.PI;
  const head = new THREE.Group();
  head.position.set(0, 0.47, 0.17);
  body.add(head);
  add(head, B(0.26, 0.22, 0.22), COAT, 0, 0.04, 0);
  add(head, B(0.14, 0.09, 0.08), LIGHT, 0, -0.02, 0.14);
  add(head, B(0.05, 0.035, 0.03), INK, 0, 0.015, 0.185);
  add(head, B(0.08, 0.012, 0.012), INK, 0.01, -0.055, 0.181);
  for (const s of [-1, 1]) {
    const ear = add(head, new THREE.ConeGeometry(0.065, 0.13, 4), COAT, s * 0.085, 0.21, -0.02);
    ear.rotation.set(0, Math.PI / 4, -s * 0.15);
    add(head, B(0.035, 0.035, 0.02), INK, s * 0.065, 0.07, 0.112);
    add(head, B(0.045, 0.018, 0.02), DARK, s * 0.065, 0.105, 0.112).rotation.z = s * 0.2;
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.35, -0.21);
  body.add(tail);
  add(tail, B(0.05, 0.05, 0.14), COAT, 0, 0.04, -0.05).rotation.x = -0.8;
  add(tail, B(0.052, 0.052, 0.06), DARK, 0, 0.1, -0.1);
  compact(root);
  let excited = 0;
  return {
    root, head,
    setWave(k) { excited = k; },
    setPose() {},
    setSwim() {},
    update(dt, speed, t) {
      tail.rotation.y = Math.sin(t * (6 + excited * 10)) * (0.35 + excited * 0.3);
      body.position.y = Math.abs(Math.sin(t * 9)) * 0.07 * excited;
      head.rotation.z = Math.sin(t * 0.7) * 0.08;
    },
  };
}

// ---------------------------------------------------------------- the town's life

export function createLife(W, { onFlutter, onMeow } = {}) {
  const { world, noNormals } = W;
  const rng = mulberry32(9011); // its own stream, so the town itself keeps its layout
  const bubbles = createBubbles(world, noNormals);
  const bodies = []; // { d, r }: things you bump into, kept current each frame
  const people = []; // everyone you can talk to

  const blocked = (d, r) => W.blocked(d, r);

  // ---- residents by their doors (they turn to watch you go by)
  {
    const step = Math.max(1, Math.floor(W.addresses.length / 12));
    for (let i = 3, n = 0; i < W.addresses.length && n < 12; i += step, n++) {
      const a = W.addresses[i];
      if (a.landmark) continue;
      const ch = createCharacter(villager(i * 7919 + 13));
      ch.root.position.copy(a.dir).multiplyScalar(R + 0.16);
      ch.root.quaternion.copy(W.frameAt(a.dir, a.spin));
      ch.root.translateX(0.75);
      world.add(ch.root);
      const up = ch.root.position.clone().normalize();
      const home = new THREE.Vector3(0, 0, 1).applyQuaternion(ch.root.quaternion);
      const p = { kind: "door", name: a.name, ch, up, home, face: home.clone(), greetIn: 0, wave: 0, talking: false, y: 0.16, body: { d: up, r: 0.28, y: 0.16 } };
      people.push(p);
      bodies.push(p.body);
    }
  }

  // ---- people out in the other places: on the pier, at the beach, by the shrine, the cabin, the works
  // (and the special guests: `own` means they only say their own lines, `hi` is how they say hello,
  // and `fixed` keeps them facing their spot, turning only their head)
  W.npcs.forEach((s, i) => {
    const dog = s.kind === "dog";
    const ch = dog ? makeDog() : createCharacter({ ...villager(9000 + i * 977), ...s.look });
    const up = s.d.clone().normalize();
    ch.root.position.copy(up).multiplyScalar(R + s.y);
    world.add(ch.root);
    const home = s.face.clone().addScaledVector(up, -s.face.dot(up)).normalize();
    orient(ch.root, up, home);
    const p = {
      kind: "door", name: s.name, lines: s.lines, own: s.own, hi: s.hi, fixed: s.fixed, shout: s.shout, shoutIn: 2, bubble: dog ? 1.0 : undefined,
      ch, up, home, face: home.clone(), greetIn: 0, wave: 0, talking: false, y: s.y, body: { d: up, r: dog ? 0.24 : 0.28, y: s.y },
    };
    people.push(p);
    bodies.push(p.body);
  });

  // ---- people out for a walk along the sidewalks
  for (let i = 0; i < 14; i++) {
    const ri = Math.floor(rng() * ROADS.length);
    const ch = createCharacter(villager(5000 + i * 131));
    world.add(ch.root);
    const p = {
      kind: "walker", name: WALKER_NAMES[i % WALKER_NAMES.length], ch, ri, road: ROADS[ri], t: rng() * Math.PI * 2,
      side: rng() < 0.5 ? 1 : -1, dir: rng() < 0.5 ? 1 : -1, speed: 0.95 + rng() * 0.45, go: 1, pauseIn: 8 + rng() * 20, pause: 0,
      y: 0.16, face: new THREE.Vector3(), up: new THREE.Vector3(), greetIn: 0, wave: 0, talking: false, body: { d: new THREE.Vector3(), r: 0.28, y: 0.16 },
    };
    people.push(p);
    bodies.push(p.body);
  }

  // ---- cats sitting about in front gardens
  const cats = [];
  for (let i = 0, n = 0; i < W.addresses.length * 2 && n < 7; i += 3) {
    const a = W.addresses[(i * 7 + 2) % W.addresses.length];
    if (a.landmark) continue;
    const q = W.frameAt(a.dir, a.spin);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const d = offsetOnSphere(a.dir, side, rng() < 0.5 ? -1.6 : 1.6);
    if (blocked(d, 0.3) || nearestRoad(d) < ROAD_HW + 0.3 || cats.some((c) => arc(c.up, d) < 1.5)) continue;
    const cat = makeCat(CAT_COATS[n % CAT_COATS.length]);
    cat.root.position.copy(d).multiplyScalar(R + W.terrain.baseAt(d) + 0.02);
    const up = d.clone();
    const home = new THREE.Vector3(0, 0, 1).applyQuaternion(q); // facing the street
    orient(cat.root, up, home);
    cat.root.scale.setScalar(1.15);
    world.add(cat.root);
    cats.push({ ...cat, up, home, face: home.clone(), near: 0, meowIn: 0, hop: 0 });
    bodies.push({ d: up, r: 0.18, y: 0.16 });
    n++;
  }

  // ---- birds: little flocks pecking at the edges of the streets
  const FLOCKS = 9, PER = 5, N = FLOCKS * PER;
  const birdMat = toon(0xffffff, { vertexColors: true });
  const wingMat = toon(0xffffff, { side: THREE.DoubleSide });
  const birdsMesh = new THREE.InstancedMesh(birdGeometry(), birdMat, N);
  const wingGeo = new THREE.PlaneGeometry(0.17, 0.1).rotateX(-Math.PI / 2).translate(0.085, 0, 0);
  const wingL = new THREE.InstancedMesh(wingGeo, wingMat, N), wingR = new THREE.InstancedMesh(wingGeo, wingMat, N);
  const BIRD_TINTS = [0x8a7b6b, 0x7d6e60, 0x9aa3ad, 0x6b625a, 0xa58c74];
  for (const m of [birdsMesh, wingL, wingR]) {
    m.frustumCulled = false;
    m.castShadow = true;
    world.add(m);
  }
  const flocks = [];
  const flockSpot = () => {
    for (let tries = 0; tries < 400; tries++) {
      const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const nr = nearestRoad(d);
      if (nr < ROAD_HW + 0.2 || nr > ROAD_HW + WALK + 3 || blocked(d, 0.7)) continue;
      return { d, y: W.terrain.baseAt(d) };
    }
    return { d: new THREE.Vector3(0, 1, 0), y: 0 };
  };
  const birds = [];
  for (let f = 0; f < FLOCKS; f++) {
    const flock = { ...flockSpot(), state: "ground", away: 0 };
    flocks.push(flock);
    for (let b = 0; b < PER; b++) {
      const bird = { flock, i: birds.length, pos: new THREE.Vector3(), fwd: new THREE.Vector3(), vel: new THREE.Vector3(), hopT: 0, hopIn: rng() * 2, peck: 0, flap: rng() * 6 };
      birds.push(bird);
      const tint = new THREE.Color(pick(BIRD_TINTS, rng));
      birdsMesh.setColorAt(bird.i, tint);
      wingL.setColorAt(bird.i, tint.clone().multiplyScalar(0.8));
      wingR.setColorAt(bird.i, tint.clone().multiplyScalar(0.8));
    }
  }
  /// Settle a flock's birds on the ground around its spot.
  function land(flock) {
    flock.state = "ground";
    const up = flock.d;
    const t1 = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0.3, 1, 0.2)).normalize(), t2 = new THREE.Vector3().crossVectors(up, t1);
    for (const b of birds) {
      if (b.flock !== flock) continue;
      const a = rng() * Math.PI * 2, r = 0.25 + rng() * 0.7;
      b.home = up.clone().multiplyScalar(R).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
      b.pos.copy(b.home);
      b.fwd.copy(t1).applyAxisAngle(up, rng() * 6);
      b.hopT = 0;
    }
  }
  flocks.forEach(land);

  // ---- butterflies by day, fireflies by night, around the parks
  const flutterTex = (wing, spot) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = wing;
    g.strokeStyle = "#283033";
    g.lineWidth = 3;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(32 + s * 14, 24, 13, 15, s * 0.4, 0, 7);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(32 + s * 11, 44, 9, 10, -s * 0.3, 0, 7);
      g.fill();
      g.stroke();
      g.fillStyle = spot;
      g.beginPath();
      g.arc(32 + s * 15, 22, 4, 0, 7);
      g.fill();
      g.fillStyle = wing;
    }
    g.fillStyle = "#283033";
    g.fillRect(30, 14, 4, 40);
    return texFromCanvas(c);
  };
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,220,1)");
    grad.addColorStop(0.25, "rgba(230,255,140,0.9)");
    grad.addColorStop(1, "rgba(200,255,100,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return texFromCanvas(c);
  })();
  const wingMats = [["#fbf6ea", "#f2c94c"], ["#f2c94c", "#e46f5f"], ["#7cc2e8", "#283033"], ["#f4a35a", "#283033"]]
    .map(([w, s]) => new THREE.SpriteMaterial({ map: flutterTex(w, s), transparent: true, alphaTest: 0.3 }));
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flyers = [];
  for (let n = 0, tries = 0; n < 36 && tries < 4000; tries++) {
    const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    if (nearestRoad(d) < ROAD_HW + WALK + 1.2 || blocked(d, 0.6)) continue;
    const t1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0.2, 1, 0.4)).normalize(), t2 = new THREE.Vector3().crossVectors(d, t1);
    const bf = new THREE.Sprite(pick(wingMats, rng));
    const ff = new THREE.Sprite(glowMat);
    for (const s of [bf, ff]) {
      s.visible = false;
      world.add(s);
      noNormals.push(s);
    }
    flyers.push({ d, t1, t2, bf, ff, ph: rng() * 20, r1: 0.6 + rng() * 1.1, r2: 0.5 + rng() * 0.9, h: 0.6 + rng() * 0.9, w: 0.5 + rng() * 0.6 });
    n++;
  }

  // ---------------------------------------------------------------- per frame

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const birdM = new THREE.Matrix4(), wingM = new THREE.Matrix4(), hinge = new THREE.Matrix4(), rot = new THREE.Matrix4();
  const qb = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), birdObj = new THREE.Object3D();
  const hello = (rain, night) => pick(rain > 0.4 ? HELLO.rain : night > 0.5 ? HELLO.night : HELLO.day);

  /// Turn a person to face `want` (a tangent), turn their head toward `look` (a tangent or null), and wave.
  function pose(p, dt, t, want, look) {
    p.face.lerp(want, 1 - Math.exp(-dt * 5)).addScaledVector(p.up, -p.face.dot(p.up)).normalize();
    orient(p.ch.root, p.up, p.face);
    const head = look ? THREE.MathUtils.clamp(turnTo(p.up, p.face, look), -1.1, 1.1) : 0;
    p.ch.head.rotation.y += (head - p.ch.head.rotation.y) * (1 - Math.exp(-dt * 6));
    p.wave = Math.max(0, p.wave - dt);
    p.ch.setWave(Math.min(1, p.wave * 3, (1.6 - p.wave) * 6) * (p.wave > 0 ? 1 : 0));
  }

  function update(dt, t, { me, speed = 0, night = 0, rain = 0, active = true }) {
    // People.
    for (const p of people) {
      // Out of sight round the planet, skip drawing them (from the title screen, everyone shows).
      p.ch.root.visible = !active || !p.up.lengthSq() || arc(p.up, me) < 20;
      if (p.kind === "walker") {
        // Stop for a chat, for a moment's rest now and then, or when you're right in their way.
        p.pauseIn -= dt;
        if (p.pauseIn <= 0) {
          p.pause = 2 + Math.random() * 3;
          p.pauseIn = 15 + Math.random() * 25;
        }
        p.pause = Math.max(0, p.pause - dt);
        const pt = p.road.point(p.t), tan = p.road.tangent(p.t).multiplyScalar(p.dir);
        const side = new THREE.Vector3().crossVectors(pt, p.road.tangent(p.t)).normalize().multiplyScalar(p.side);
        const d = offsetOnSphere(pt, side, ROAD_HW + 0.22);
        const toMe = tangent(d, me);
        const inWay = active && arc(d, me) < 1.3 && toMe.dot(tan) > 0;
        const goWant = p.talking || p.pause > 0 || inWay ? 0 : 1;
        p.go += (goWant - p.go) * (1 - Math.exp(-dt * 6));
        const moved = p.go * p.speed * dt;
        p.t += (p.dir * moved) / R;
        p.up.copy(d);
        p.body.d.copy(d);
        // Up onto the sidewalk, down to cross the road at junctions, up and over the bridges.
        const y = W.terrain.surfaceAt(d, p.y + 0.5);
        p.y += (y - p.y) * (1 - Math.exp(-dt * 10));
        p.body.y = p.y;
        p.ch.root.position.copy(d).multiplyScalar(R + p.y);
        const near = active && arc(d, me) < 4;
        pose(p, dt, t, p.talking ? toMe.normalize() : tan, near ? toMe.normalize() : null);
        if (p.ch.root.visible) p.ch.update(dt, 0.62 * Math.min(1, p.go * 1.5), t, 0, moved);
      } else {
        const toMe = tangent(p.up, me);
        const near = active && arc(p.up, me) < 5;
        // Turn toward you when you're close by, back to the street when you've gone.
        const turn = !p.fixed && (p.talking || (near && Math.abs(turnTo(p.up, p.home, toMe)) < 2.2));
        pose(p, dt, t, turn ? toMe.clone().normalize() : p.home, near ? toMe.normalize() : null);
        if (p.ch.root.visible) p.ch.update(dt, 0, t);
      }
      // Some guests call out to anyone in earshot, so you can find them by the bubbles.
      if (p.shout && active && !p.talking && arc(p.up, me) < 16 && (p.shoutIn -= dt) <= 0) {
        p.shoutIn = 4 + Math.random() * 3;
        p.wave = 1.6;
        bubbles.say(p.ch.root, pick(p.hi), p.bubble);
      }
      // Say hello (and wave) when you come by, now and then.
      p.greetIn -= dt;
      if (active && p.greetIn <= 0 && !p.talking && arc(p.up, me) < 3.2) {
        p.greetIn = 25 + Math.random() * 20;
        p.wave = 1.6;
        bubbles.say(p.ch.root, p.hi ? pick(p.hi) : hello(rain, night), p.bubble);
      }
    }

    // Cats: watch you, meow if you stop beside them, jump if you run past.
    for (const c of cats) {
      const visible = !active || arc(c.up, me) < 20;
      c.root.visible = visible;
      if (!visible) continue;
      const toMe = tangent(c.up, me);
      const dist = arc(c.up, me);
      const look = active && dist < 6 ? THREE.MathUtils.clamp(turnTo(c.up, c.face, toMe.clone().normalize()), -1.2, 1.2) : 0;
      c.head.rotation.y += (look - c.head.rotation.y) * (1 - Math.exp(-dt * 5));
      c.tail.forEach((s, i) => (s.rotation.y = 0.35 + Math.sin(t * 1.8 + i * 0.7) * (0.12 + i * 0.05)));
      c.near = active && dist < 1.4 && speed < 0.3 ? c.near + dt : 0;
      c.meowIn -= dt;
      if (c.near > 0.8 && c.meowIn <= 0) {
        c.meowIn = 12;
        bubbles.say(c.root, pick(["Mew!", "Mrrp?", "Meow."]), 0.9);
        onMeow?.();
      }
      if (active && dist < 2.2 && speed > 0.8 && c.hop <= 0) c.hop = 0.45;
      c.hop = Math.max(0, c.hop - dt);
      c.body.position.y = Math.sin((c.hop / 0.45) * Math.PI) * 0.22;
    }

    // Birds.
    for (const f of flocks) {
      if (f.state === "ground") {
        const dist = arc(f.d, me);
        // Scatter when you come close (from further away if you're running).
        if (active && dist < (speed > 0.8 ? 4.5 : 2.8)) {
          f.state = "fly";
          f.away = 0;
          onFlutter?.();
          const awayDir = tangent(me, f.d).normalize();
          for (const b of birds) {
            if (b.flock !== f) continue;
            b.pos.multiplyScalar(R + f.y);
            b.vel.copy(awayDir).multiplyScalar(2 + Math.random() * 1.8).addScaledVector(f.d, 2.6 + Math.random() * 1.6)
              .add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4));
          }
        }
      } else if (f.state === "fly") {
        f.away += dt;
        if (f.away > 3.5) {
          f.state = "gone";
          f.away = 0;
        }
      } else {
        // Come back down somewhere you aren't, a while later.
        f.away += dt;
        if (f.away > 18) {
          const spot = flockSpot();
          if (arc(spot.d, me) > 10) {
            Object.assign(f, spot);
            land(f);
          }
        }
      }
    }
    for (const b of birds) {
      const f = b.flock;
      b.flap += dt;
      if (f.state === "gone" || (active && arc(f.d, me) > 20)) {
        birdM.makeScale(0, 0, 0);
        birdsMesh.setMatrixAt(b.i, birdM);
        wingL.setMatrixAt(b.i, birdM);
        wingR.setMatrixAt(b.i, birdM);
        continue;
      }
      let up, pos, wing;
      if (f.state === "ground") {
        // Peck, and hop a little way now and then.
        b.hopIn -= dt;
        if (b.hopIn <= 0) {
          b.hopIn = 0.5 + Math.random() * 1.8;
          if (Math.random() < 0.6) {
            b.hopT = 0.22;
            b.fwd.applyAxisAngle(b.pos, (Math.random() - 0.5) * 2);
          } else b.peck = 0.3;
        }
        if (b.hopT > 0) {
          b.hopT = Math.max(0, b.hopT - dt);
          b.pos.addScaledVector(b.fwd, (0.6 * dt) / R).normalize();
          // Don't wander off from the flock.
          if (arc(b.pos, f.d) > 1.2) b.fwd.copy(tangent(b.pos, f.d)).normalize();
        }
        b.peck = Math.max(0, b.peck - dt);
        up = b.pos;
        pos = tmp.copy(b.pos).multiplyScalar(R + f.y + Math.sin((b.hopT / 0.22) * Math.PI) * 0.06);
        wing = null;
        birdObj.position.copy(pos);
        orient(birdObj, up, b.fwd);
        if (b.peck > 0) birdObj.rotateX(Math.sin((b.peck / 0.3) * Math.PI) * 0.6);
      } else {
        b.pos.addScaledVector(b.vel, dt);
        up = tmp2.copy(b.pos).normalize();
        b.vel.addScaledVector(up, 1.2 * dt);
        pos = b.pos;
        wing = Math.sin(b.flap * 32) * 0.9;
        birdObj.position.copy(pos);
        orient(birdObj, up, b.vel);
        birdObj.rotateX(-0.35);
      }
      birdObj.scale.setScalar(1.05);
      birdObj.updateMatrix();
      birdsMesh.setMatrixAt(b.i, birdObj.matrix);
      if (wing === null) {
        // Folded along the body.
        wingM.copy(birdObj.matrix).multiply(hinge.makeTranslation(0.06, 0.13, 0.04)).multiply(rot.makeRotationY(1.45)).multiply(rot.makeScale(0.8, 1, 0.8));
        wingL.setMatrixAt(b.i, wingM);
        wingM.copy(birdObj.matrix).multiply(hinge.makeTranslation(-0.06, 0.13, 0.04)).multiply(rot.makeRotationY(Math.PI - 1.45)).multiply(rot.makeScale(0.8, 1, 0.8));
        wingR.setMatrixAt(b.i, wingM);
      } else {
        wingM.copy(birdObj.matrix).multiply(hinge.makeTranslation(0.05, 0.12, 0)).multiply(rot.makeRotationZ(wing));
        wingL.setMatrixAt(b.i, wingM);
        wingM.copy(birdObj.matrix).multiply(hinge.makeTranslation(-0.05, 0.12, 0)).multiply(rot.makeRotationY(Math.PI)).multiply(rot.makeRotationZ(wing));
        wingR.setMatrixAt(b.i, wingM);
      }
    }
    for (const m of [birdsMesh, wingL, wingR]) m.instanceMatrix.needsUpdate = true;

    // Butterflies and fireflies.
    const day = (1 - night) * (1 - rain), dark = night * (1 - rain);
    for (const f of flyers) {
      const close = arc(f.d, me) < 16;
      const tt = t * f.w + f.ph;
      tmp.copy(f.d).multiplyScalar(R + f.h + Math.sin(tt * 1.7) * 0.25)
        .addScaledVector(f.t1, Math.sin(tt) * f.r1).addScaledVector(f.t2, Math.sin(tt * 1.3 + 1) * f.r2);
      f.bf.visible = close && day > 0.05;
      f.ff.visible = close && dark > 0.05;
      if (f.bf.visible) {
        f.bf.position.copy(tmp);
        f.bf.scale.set(0.26 * (0.2 + 0.8 * Math.abs(Math.sin(t * 16 + f.ph))), 0.26, 1);
        f.bf.material.opacity = Math.min(1, day * 2);
      }
      if (f.ff.visible) {
        f.ff.position.copy(tmp).addScaledVector(f.d, -0.3);
        const blink = Math.pow(Math.max(0, Math.sin(t * 1.6 + f.ph * 3)), 3);
        const s = 0.2 + 0.25 * blink;
        f.ff.scale.set(s, s, 1);
        f.ff.material.opacity = Math.min(1, dark * 1.5);
      }
    }
    bubbles.update(dt);
  }

  return {
    update,
    bodies,
    /// The nearest person within `range` of `me` (and at about your height y), to talk to.
    nearest(me, range = 2.2, y = null) {
      let best = null, bd = range;
      for (const p of people) {
        if (y !== null && Math.abs(p.y - y) > 1.5) continue;
        const d = arc(p.up, me);
        if (d < bd) [best, bd] = [p, d];
      }
      return best;
    },
    /// Something for this person to say, given the time and weather.
    chat(p, { night = 0, rain = 0 } = {}) {
      if (p.lines && (p.own || Math.random() < 0.8)) return pick(p.lines);
      const pool = [...CHAT.any, ...(rain > 0.4 ? CHAT.rain : night > 0.5 ? CHAT.night : CHAT.day)];
      return pick(pool);
    },
    talking(p, on) {
      p.talking = on;
      if (on) p.wave = 0;
    },
    /// You waved: anyone nearby waves back.
    waveBack(me) {
      for (const p of people) {
        if (arc(p.up, me) < 7 && p.wave <= 0) {
          p.wave = 1.6;
          if (p.hi || Math.random() < 0.5) bubbles.say(p.ch.root, pick(p.hi ?? ["Hi!", "Hey!", "Yo!", "Hello!"]), p.bubble);
        }
      }
    },
    say: (obj, text, h) => bubbles.say(obj, text, h),
  };
}
