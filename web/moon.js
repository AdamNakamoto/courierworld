// The moon (moon-pick.js has its rules: size, ground, ticket, the day's stamps). Built the first time someone flies
// there: a small grey world with craters and rocks, the landing pad and the rocket home at its top, a flag, the Moon
// Post box, the moon frogs and their base, the planet hanging in the black sky, and the day's golden moon stamps.
//
// Its group sits so the moon's top is where the planet's is (the sun, the shadows and the camera are all set up for
// that spot), and main.js turns it under the courier the way it turns the planet: `ground` is what main.js walks
// on (radius, centre, what you stand on, what's in the way, gravity).
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, toon, mulberry32, texFromCanvas } from "./world.js";
import { MOON_R, MOON_GRAVITY, LANDING, MOON_SPOTS, moonHeight, moonSpots } from "./moon-pick.js";
import { facing, padAndRocket, postBox, createLocals, dayStamps, homePlanet } from "./space.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const arr = (v) => [v.x, v.y, v.z];
const marc = (a, b) => MOON_R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
/// A direction `m` metres from `d` along the tangent `t` (a short step: straight out, then down to the ground).
const along = (d, t, m) => d.clone().multiplyScalar(MOON_R).addScaledVector(t, m).normalize();
/// A direction `m` metres from `d` round the moon the way of the tangent `t` (any distance).
const round = (d, t, m) => d.clone().multiplyScalar(Math.cos(m / MOON_R)).addScaledVector(t, Math.sin(m / MOON_R)).normalize();

/// A flag's cloth: the game's name on the courier red, with an envelope.
function flagTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "#d9534a";
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = "#fbf6ea";
  g.fillRect(28, 34, 92, 62);
  g.strokeStyle = "#d9534a";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(28, 34);
  g.lineTo(74, 70);
  g.lineTo(120, 34);
  g.stroke();
  g.font = "400 30px Bungee, Impact, sans-serif";
  g.textBaseline = "middle";
  g.fillText("COURIER", 132, 54, 116);
  g.fillText("WORLD", 132, 92, 116);
  g.font = "400 18px Bungee, Impact, sans-serif";
  g.fillText("MOON POST", 28, 128, 200);
  return texFromCanvas(c);
}

/// The moon base's sign: its name in alien green, and a line for visitors.
function baseSignTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const g = c.getContext("2d");
  g.fillStyle = "#101820";
  g.fillRect(0, 0, 512, 192);
  g.strokeStyle = "#7dff6a";
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 176);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "#7dff6a";
  g.shadowBlur = 18;
  g.fillStyle = "#b8ff9e";
  g.font = "400 76px Bungee, Impact, sans-serif";
  g.fillText("MOON BASE", 256, 82, 470);
  g.shadowBlur = 0;
  g.fillStyle = "#7dff6a";
  g.font = "400 26px Bungee, Impact, sans-serif";
  g.fillText("FROGS ONLY · COURIERS WELCOME", 256, 148, 470);
  return texFromCanvas(c);
}

/// An alien moon frog: green, big-eyed, with a wide smile, a silver belt and two glowing antennae. Returns the
/// group and the parts that move ({ body (turns and hops), eyes (blink), tips (glow) }).
function frogMesh(color, glowColor, mesh) {
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
  const belly = new THREE.Color(color).lerp(new THREE.Color(0xfff4c8), 0.45).getHex();
  add(ball(0.42), color, 0, 0.5, 0, 1, 1.05, 0.9);
  add(ball(0.3), belly, 0, 0.45, 0.19, 1, 1.1, 0.62);
  add(new THREE.TorusGeometry(0.4, 0.035, 6, 24), 0xc9ced6, 0, 0.58, 0).rotation.x = Math.PI / 2;
  add(ball(0.4), color, 0, 0.98, 0.04, 1.12, 0.72, 0.95);
  const mouth = add(new THREE.TorusGeometry(0.15, 0.024, 6, 20, Math.PI), 0x6a2a3a, 0, 0.965, 0.41, 1, 0.55, 1);
  mouth.rotation.z = Math.PI; // (the lower half of a ring, flattened: a smile)
  for (const s of [-1, 1]) {
    add(ball(0.15), color, s * 0.18, 1.17, 0.1);
    const eye = new THREE.Group();
    eye.position.set(s * 0.18, 1.2, 0.17);
    body.add(eye);
    add(ball(0.115), 0xffffff, 0, 0, 0.03, 1, 1, 1, eye);
    add(ball(0.055, 10), 0x1d1f27, 0, 0, 0.13, 1, 1, 1, eye);
    eyes.push(eye);
    add(ball(0.12, 12), color, s * 0.2, 0.06, 0.12, 1.1, 0.45, 1.6);
    const arm = add(new THREE.CapsuleGeometry(0.06, 0.18, 4, 8), color, s * 0.42, 0.56, 0.08);
    arm.rotation.set(0.25, 0, s * 0.7);
    const stalk = add(new THREE.CylinderGeometry(0.018, 0.022, 0.34, 6), 0x3b4145, s * 0.12, 1.36, 0);
    stalk.rotation.z = -s * 0.35;
    const tip = new THREE.Mesh(ball(0.06, 10), new THREE.MeshBasicMaterial({ color: glowColor }));
    tip.position.set(s * 0.18, 1.52, 0);
    body.add(tip);
    tips.push(tip);
  }
  return { g, body, eyes, tips };
}

export function createMoon(W) {
  const group = new THREE.Group();
  group.position.set(0, R - MOON_R, 0);
  group.visible = false;
  W.scene.add(group);
  const rnd = mulberry32(31337);
  const top = V(...LANDING), east = V(1, 0, 0), north = V(0, 0, 1);
  const place = (obj, d, h = 0, spin = 0) => {
    obj.position.copy(d).multiplyScalar(MOON_R + h);
    obj.quaternion.copy(W.frameAt(d, spin));
    group.add(obj);
    return obj;
  };
  const mesh = (geo, color, extra) => {
    const m = new THREE.Mesh(geo, toon(color, extra));
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const obstacles = [];
  const circle = (d, r, opts = {}) => obstacles.push({ d, kind: "circle", r, ...opts, cos: Math.cos((r + 1) / MOON_R) });
  const blinkers = []; // glowing bits that blink: { m (mesh), every (seconds), on (seconds lit), ph }

  // ---- the ground: a faceted grey ball, pressed in where the craters are
  {
    const geo = new THREE.IcosahedronGeometry(MOON_R, 24);
    const pos = geo.attributes.position, col = [], v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const h = moonHeight(arr(v));
      pos.setXYZ(i, v.x * (MOON_R + h), v.y * (MOON_R + h), v.z * (MOON_R + h));
      const grain = 0.04 * Math.sin(v.x * 37 + v.y * 23) * Math.sin(v.z * 31 - v.x * 17);
      c.setRGB(0.74 + grain, 0.73 + grain, 0.7 + grain);
      if (h < -0.05) c.multiplyScalar(0.86 + 0.1 * Math.min(1, -h / 0.5)); // crater floors, darker
      else if (h > 0.04) c.multiplyScalar(1.07); // rims catch the light
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    ground.receiveShadow = true;
    group.add(ground);
  }

  // ---- the landing pad, with the rocket home on it
  const { pad, rocket } = padAndRocket(mesh);
  place(pad, top, 0.02);
  place(rocket, top, 0.07, 0.6);
  circle(top.clone(), 0.75, { y1: 4.8 });
  // You step out beside the pad with the rocket off to one side (so the camera behind you isn't looking through
  // it), facing the planet in the sky; the Moon Post box is just ahead.
  const arrive = along(top, north, 2.8);

  // ---- the Moon Post box, where the letters for the moon frogs are
  const postD = along(along(top, east, -3.2), north, 1.2);
  {
    const box = postBox(mesh, "MOON POST");
    box.position.copy(postD).multiplyScalar(MOON_R + moonHeight(arr(postD)));
    box.quaternion.copy(facing(postD, arrive.clone().sub(postD)));
    group.add(box);
    circle(postD.clone(), 0.35, { y1: 1.5 });
  }

  // ---- a flag by the pad
  {
    const g = new THREE.Group();
    const pole = mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6), 0xd9dde0);
    pole.position.y = 1.15;
    g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.68), new THREE.MeshBasicMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
    cloth.position.set(0.58, 1.9, 0);
    g.add(cloth);
    const d = along(top, north, -3.2);
    place(g, d, moonHeight(arr(d)), 1.2);
    circle(d, 0.14);
  }

  // ---- the moon base: a domed station on legs, where the moon frogs live; and the frogs themselves. Kept off the
  // stamp spots (the server knows where those are) and the pad, on ground flat enough to stand on.
  const keepOut = [{ d: top, r: 4.6 }]; // (rocks stay clear of these)
  const locals = createLocals(MOON_R), residents = []; // (residents: the frogs who get letters)
  const spotDirs = MOON_SPOTS.map((s) => V(...s.d));
  let baseD = null;
  {
    let best = -Infinity;
    for (let i = 0; i < 600; i++) {
      const a = i * 2.39996, m = 6.2 + (i % 9) * 0.45, tan = east.clone().multiplyScalar(Math.cos(a)).addScaledVector(north, Math.sin(a));
      const d = along(top, tan, m), clear = Math.min(...spotDirs.map((p) => marc(p, d)));
      if (clear < 4.3) continue;
      const t1 = new THREE.Vector3().crossVectors(d, east).normalize(), t2 = new THREE.Vector3().crossVectors(d, t1);
      let rough = 0;
      for (let k = 0; k < 10; k++) {
        const q = along(d, t1.clone().multiplyScalar(Math.cos(k * 0.63)).addScaledVector(t2, Math.sin(k * 0.63)), 2.6);
        rough = Math.max(rough, Math.abs(moonHeight(arr(q)) - moonHeight(arr(d))));
      }
      const score = clear - rough * 12 - Math.abs(m - 7.5) * 0.3;
      if (score > best) [best, baseD] = [score, d];
    }
  }
  const frogAt = (d, name, lines, color, glowColor, look) => {
    const f = frogMesh(color, glowColor, mesh);
    f.g.position.copy(d).multiplyScalar(MOON_R + moonHeight(arr(d)));
    f.g.quaternion.copy(facing(d, look));
    group.add(f.g);
    circle(d.clone(), 0.42, { y1: moonHeight(arr(d)) + 1.5 });
    keepOut.push({ d, r: 1.1 });
    locals.add(f, d, name, lines, rnd() * 6);
    residents.push({ name, d });
  };
  /// The flattest spot about `m` metres round from the pad (toward `az`, give or take `spread` radians), at least
  /// `clear` metres from every stamp spot and clear of what's already here.
  const spotNear = (m, az, spread, clear) => {
    let best = null, score = -Infinity;
    for (let i = 0; i < 400; i++) {
      const a = az + ((i * 0.618) % 1 - 0.5) * 2 * spread, mm = m + ((i % 5) - 2) * 0.5;
      const d = round(top, east.clone().multiplyScalar(Math.cos(a)).addScaledVector(north, Math.sin(a)), mm);
      const near = Math.min(...spotDirs.map((p) => marc(p, d)));
      if (near < clear || keepOut.some((k) => marc(k.d, d) < k.r + 2)) continue;
      const t1 = new THREE.Vector3().crossVectors(d, east).normalize(), t2 = new THREE.Vector3().crossVectors(d, t1);
      let rough = 0;
      for (let k = 0; k < 8; k++) rough = Math.max(rough, Math.abs(moonHeight(arr(along(d, t1.clone().multiplyScalar(Math.cos(k * 0.785)).addScaledVector(t2, Math.sin(k * 0.785)), 2))) - moonHeight(arr(d))));
      const sc = Math.min(near, 5) - rough * 14;
      if (sc > score) [score, best] = [sc, d];
    }
    return best;
  };
  if (baseD) {
    const h = moonHeight(arr(baseD)), toPad = top.clone().addScaledVector(baseD, -top.dot(baseD)).normalize();
    const base = new THREE.Group();
    const add = (geo, col, x, y, z) => {
      const m = mesh(geo, col);
      m.position.set(x, y, z);
      base.add(m);
      return m;
    };
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, leg = add(new THREE.CylinderGeometry(0.08, 0.12, 1.1, 8), 0x8d9790, Math.sin(a) * 2.05, 0.45, Math.cos(a) * 2.05);
      leg.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
      add(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 12), 0x5a5f6e, Math.sin(a) * 2.2, 0.04, Math.cos(a) * 2.2);
    }
    add(new THREE.CylinderGeometry(2.45, 2.3, 0.32, 32), 0x9aa3ad, 0, 0.98, 0);
    add(new THREE.SphereGeometry(2.05, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), 0xbfe9e4, 0, 1.12, 0);
    add(new THREE.TorusGeometry(2.06, 0.06, 6, 40), 0x8d9790, 0, 1.2, 0).rotation.x = Math.PI / 2;
    const windows = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, el = 0.42;
      if (Math.abs(Math.sin(a / 2)) < 0.18) continue; // (the door's there)
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8ffcff }));
      w.position.set(Math.sin(a) * 2.07 * Math.cos(el), 1.12 + 2.07 * Math.sin(el), Math.cos(a) * 2.07 * Math.cos(el));
      base.add(w);
      windows.push(w);
    }
    // The door (toward the pad), a ramp down to it, and the antenna with its blinking light.
    add(new THREE.BoxGeometry(0.85, 1.15, 0.4), 0x2a2f3a, 0, 1.68, 1.9);
    const frame = add(new THREE.TorusGeometry(0.5, 0.06, 6, 20, Math.PI), 0x7dff6a, 0, 2.18, 2.08);
    frame.material.emissive?.setHex(0x2a8020);
    const ramp = add(new THREE.BoxGeometry(0.9, 0.08, 1.5), 0x8d9790, 0, 0.55, 2.95);
    ramp.rotation.x = 0.55;
    add(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 6), 0xc9ced6, 0, 3.7, 0);
    const dish = add(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), 0xd9dde0, 0.0, 4.1, 0);
    dish.rotation.x = Math.PI * 0.8;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
    beacon.position.set(0, 4.35, 0);
    base.add(beacon);
    // The sign out front, on two posts.
    const sign = new THREE.Group();
    for (const x of [-0.85, 0.85]) {
      const post = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), 0x3b4145);
      post.position.set(x, 0.65, 0);
      sign.add(post);
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.72), new THREE.MeshBasicMaterial({ map: baseSignTexture(), side: THREE.DoubleSide }));
    board.position.set(0, 1.4, 0.03);
    sign.add(board);
    base.position.copy(baseD).multiplyScalar(MOON_R + h - 0.05);
    base.quaternion.copy(facing(baseD, toPad));
    group.add(base);
    const right = new THREE.Vector3().crossVectors(baseD, toPad).normalize();
    const signD = along(along(baseD, toPad, 4.3), right, -2.0);
    sign.position.copy(signD).multiplyScalar(MOON_R + moonHeight(arr(signD)));
    sign.quaternion.copy(facing(signD, top.clone().addScaledVector(signD, -top.dot(signD))));
    group.add(sign);
    circle(baseD.clone(), 2.55, { wall: { h: 4.4 } });
    circle(signD, 0.95, { y1: moonHeight(arr(signD)) + 1.8 });
    keepOut.push({ d: baseD, r: 3.9 }, { d: signD, r: 1.4 });
    blinkers.push({ m: beacon, every: 1.2, on: 0.35 }, ...windows.map((w, i) => ({ m: w, every: 3 + (i % 4) * 0.7, on: 2.6, ph: i })));
    // Frogs by the door, and one at the pad who greets new arrivals.
    const door = along(baseD, toPad, 3.7);
    frogAt(along(door, right, 1.25), "Captain Gloop", [
      "That saucer up there is our delivery ship. Faster than you, courier. Don't tell your Postmaster.",
      "We've been sending letters home for a thousand years. Not one reply. Maybe the address is wrong.",
      "Welcome to Moon Base. Wipe your boots. Moon dust gets into everything. Everything.",
    ], 0x5cbf4a, 0xff5cd1, top);
    frogAt(along(door, right, -1.3), "Blib", [
      "We came for the cheese. There is no cheese. We stayed for the view.",
      "The big blue planet? You call it Courier World. We call it the night light.",
      "My antennae pick up your planet's radio. Mostly people asking where their letter is.",
    ], 0x4fae5f, 0x8ffcff, top);
    frogAt(along(along(baseD, right, 3.4), toPad, 1.2), "Kiki", [
      "Jump! Jump higher! On the moon everyone is a basketball star.",
      "I saw a golden stamp floating up high. I left it for you. I'm a very generous frog.",
      "Ribbit means hello. Ribbit ribbit means hello twice. You're welcome.",
    ], 0x7ccf3f, 0xffe066, top);
  }
  frogAt(along(top, east, 3.7), "Officer Zorp", [
    "Welcome to the moon, courier. Any fruit, plants or overdue letters to declare?",
    "Your ticket checks out. Enjoy the low gravity, and mind the craters.",
    "The moon stamps are golden, like on your planet, but floatier. Some only a big jump reaches.",
    "Moon Base is that way. Tell Captain Gloop that Zorp sent you. He'll pretend he knows me.",
    "Got moon mail? The Moon Post box by the pad has letters for the frogs. Some of them live a long hop away.",
  ], 0x5cbf4a, 0x7dff6a, along(top, north, 2.8));

  // ---- further out: Professor Tadwick at his telescope, and Old Croak in his stone hut on the far side
  const baseAz = baseD ? Math.atan2(baseD.dot(north), baseD.dot(east)) : 0;
  const scopeD = spotNear(17, baseAz + Math.PI, 1.2, 2.6);
  if (scopeD) {
    const t1 = new THREE.Vector3().crossVectors(scopeD, north).normalize();
    const at = along(scopeD, t1, 1.0), scope = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2, leg = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5), 0x3b4145);
      leg.position.set(Math.sin(a) * 0.22, 0.56, Math.cos(a) * 0.22);
      leg.rotation.set(Math.cos(a) * 0.38, 0, -Math.sin(a) * 0.38);
      scope.add(leg);
    }
    const tube = mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.2, 14), 0xd9dde0);
    tube.position.set(0, 1.28, 0.1);
    tube.rotation.x = -0.55;
    scope.add(tube);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), new THREE.MeshBasicMaterial({ color: 0x8ffcff }));
    lens.position.set(0, 1.79, -0.21); // (the far end of the tube)
    scope.add(lens);
    scope.position.copy(at).multiplyScalar(MOON_R + moonHeight(arr(at)));
    scope.quaternion.copy(W.frameAt(at, 0.4));
    group.add(scope);
    circle(at, 0.32, { y1: moonHeight(arr(at)) + 1.8 });
    keepOut.push({ d: at, r: 0.9 });
    frogAt(scopeD, "Professor Tadwick", [
      "I'm mapping every star in the sky. I've done eleven. There are rather a lot.",
      "Through this telescope your planet looks tiny. You can almost see the post office. Almost.",
      "A letter? For me? Is it from the Royal Society of Frogs? It's never from the Royal Society of Frogs.",
    ], 0x6fbf5a, 0x8fb8ff, top);
  }
  const hutD = spotNear(30, baseAz + Math.PI / 2, Math.PI, 4.4) ?? spotNear(28, baseAz + Math.PI / 2, Math.PI, 3.6); // (room for the hut too)
  if (hutD) {
    const away = top.clone().addScaledVector(hutD, -top.dot(hutD)).normalize().negate(), at = along(hutD, away, 2.0);
    const hut = new THREE.Group();
    hut.add(mesh(new THREE.SphereGeometry(1.15, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x9b968b));
    const door = mesh(new THREE.CircleGeometry(0.36, 16), 0x2a2f3a);
    door.position.set(0, 0.36, 1.13);
    hut.add(door);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd75e }));
    lamp.position.set(0.5, 0.82, 0.95);
    hut.add(lamp);
    blinkers.push({ m: lamp, every: 2.4, on: 2.0 });
    hut.position.copy(at).multiplyScalar(MOON_R + moonHeight(arr(at)) - 0.06);
    hut.quaternion.copy(facing(at, hutD.clone().sub(at)));
    group.add(hut);
    circle(at, 1.15, { wall: { h: 1.2 } });
    keepOut.push({ d: at, r: 1.8 });
    frogAt(hutD, "Old Croak", [
      "Nobody comes round the far side. That's why I live here. And yet, here you are.",
      "Back in my day we delivered letters by tongue. Very sticky. Very fast.",
      "From up here the planet's always below the hill. I prefer the quiet. Don't tell anyone where I live.",
    ], 0x4e9a4a, 0xffb35c, top);
  }

  // ---- rocks, kept off the pad, the stamp spots and each other
  {
    const spots = MOON_SPOTS.map((s) => V(...s.d)), rocks = [];
    for (let i = 0; i < 600 && rocks.length < 26; i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), d = V(s * Math.cos(t), z, s * Math.sin(t));
      const size = 0.25 + rnd() * rnd() * 0.75;
      if (keepOut.some((k) => marc(k.d, d) < k.r + size) || spots.some((p) => marc(p, d) < 1.4 + size) || rocks.some((r) => marc(r.d, d) < r.size + size + 0.9)) continue;
      const rock = mesh(new THREE.DodecahedronGeometry(size, 0), rnd() < 0.5 ? 0x8d897f : 0xa39f95);
      rock.scale.set(1, 0.7, 1.1);
      const g = new THREE.Group();
      rock.position.y = size * 0.45;
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      g.add(rock);
      const h = moonHeight(arr(d));
      place(g, d, h - size * 0.12, rnd() * 6);
      rocks.push({ d, size });
      circle(d, size * 0.85, { y1: h + size * 0.85 }); // (a moon jump clears it)
    }
  }

  // ---- the planet, hanging in the sky over the landing site
  const planet = homePlanet(20);
  planet.position.copy(V(-0.86, 0.42, -0.3).normalize()).multiplyScalar(82);
  group.add(planet);

  // ---- a flying saucer, circling the moon over the pad and the base, its lights blinking and its beam pulsing
  const ufo = new THREE.Group();
  {
    const hull = new THREE.LatheGeometry([V(0, -0.2, 0), V(0.95, -0.13, 0), V(1.45, 0, 0), V(1.0, 0.14, 0), V(0.5, 0.2, 0), V(0, 0.22, 0)].map((p) => new THREE.Vector2(p.x, p.y)), 32);
    ufo.add(mesh(hull, 0xc9ced6));
    const cab = mesh(new THREE.SphereGeometry(0.55, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x8ff0e0);
    cab.position.y = 0.18;
    ufo.add(cab);
    const pilot = frogMesh(0x5cbf4a, 0xff5cd1, mesh); // (someone has to fly it)
    pilot.g.scale.setScalar(0.42);
    pilot.g.position.y = 0.12;
    ufo.add(pilot.g);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, l = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x7dff6a : 0xff5cd1 }));
      l.position.set(Math.sin(a) * 1.22, 0.03, Math.cos(a) * 1.22);
      ufo.add(l);
      blinkers.push({ m: l, every: 0.5, on: 0.25, ph: (i % 2) * 0.25 });
    }
    const under = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: 0xb8ff9e }));
    under.rotation.x = Math.PI / 2;
    under.position.y = -0.21;
    ufo.add(under);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.5, 5.6, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9dff7a, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = -3.0;
    ufo.add(beam);
    W.noNormals.push(beam);
    ufo.userData.beam = beam;
    group.add(ufo);
  }
  const ufoU = top.clone(), ufoV = (baseD ?? along(top, east, 7)).clone().addScaledVector(top, -(baseD ?? along(top, east, 7)).dot(top)).normalize();

  // ---- the day's golden moon stamps
  const stamps = dayStamps(W, group, place, { R: MOON_R, spots: MOON_SPOTS, pick: moonSpots }, rnd);

  return {
    group,
    /// What main.js walks on here.
    ground: {
      key: "moon", R: MOON_R, center: group.position.clone(), group, gravity: MOON_GRAVITY, obstacles,
      terrain: { surfaceAt: (d) => moonHeight(arr(d)), baseAt: (d) => moonHeight(arr(d)), waterAt: () => null, ramps: [], inRamp: () => null },
    },
    /// Where you step out (beside the pad, facing away from it) and the rocket home (stand within `reach`).
    arrival: { d: arrive, tangent: east.clone().negate() },
    rocket: { d: top.clone(), reach: 2.9 },
    /// The Moon Post box (stand within `reach` with an empty bag for letters), and who the letters are for.
    post: { d: postD, reach: 1.8, name: "Moon Post box" },
    residents,
    thanks: [
      "A letter! Nobody ever writes to the moon.",
      "Ribbit! It even has a real stamp on it.",
      "All the way from Courier World? I'll stick it on the window.",
      "Mail on the moon. Best day this century.",
      "You hopped all this way for me? Ribbit ribbit.",
    ],
    /// Moon stamps found today (the server's record, for signed-in couriers).
    setFound: (d, ids) => stamps.setFound(d, ids),
    get found() { return stamps.found; },
    get out() { return stamps.out; },
    /// The moon frog within `reach` metres of `me`, nearest first, to talk to: { name, line(), talk(on) }, or null.
    nearestLocal: (me, reach) => locals.nearest(me, reach),
    /// The frogs and the saucer, and the stamps: they spin and bob, and any the courier reaches (`me`: where they
    /// are, moon-local; `chest`: how high) is picked up. Returns the spot picked up, or null.
    update(dt, t, { me, chest, active }) {
      locals.update(dt, t, me);
      for (const b of blinkers) b.m.visible = (t + (b.ph ?? 0)) % b.every < b.on;
      // The saucer: round the moon over the pad and the base, bobbing and spinning, its beam pulsing.
      const a = t * ((Math.PI * 2) / 55), dir = ufoU.clone().multiplyScalar(Math.cos(a)).addScaledVector(ufoV, Math.sin(a)).normalize();
      ufo.position.copy(dir).multiplyScalar(MOON_R + 6.4 + Math.sin(t * 0.9) * 0.45);
      ufo.quaternion.copy(W.frameAt(dir, t * 0.7));
      ufo.userData.beam.material.opacity = 0.08 + 0.09 * (0.5 + 0.5 * Math.sin(t * 2.6));
      return stamps.update(dt, t, me, chest, active);
    },
  };
}
