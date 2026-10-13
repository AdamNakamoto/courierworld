// The moon (moon-pick.js has its rules: size, ground, ticket, the day's stamps). Built the first time someone flies
// there: a small grey world with craters and rocks, the landing pad and the rocket home at its top, a flag, the
// planet hanging in the black sky, and the day's golden moon stamps.
//
// Its group sits so the moon's top is where the planet's is (the sun, the shadows and the camera are all set up for
// that spot), and main.js turns it under the courier the way it turns the planet: `ground` is what main.js walks
// on (radius, centre, what you stand on, what's in the way, gravity).
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, toon, mulberry32, texFromCanvas } from "./world.js";
import { huntDay } from "./hunt-pick.js";
import { MOON_R, MOON_GRAVITY, LANDING, MOON_SPOTS, moonHeight, moonSpots } from "./moon-pick.js";
import { stampMesh, stampGlow } from "./stamps.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const arr = (v) => [v.x, v.y, v.z];
const marc = (a, b) => MOON_R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
/// A direction `m` metres from `d` along the tangent `t`.
const along = (d, t, m) => d.clone().multiplyScalar(MOON_R).addScaledVector(t, m).normalize();

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
  const pad = new THREE.Group();
  pad.add(mesh(new THREE.CylinderGeometry(2.1, 2.2, 0.1, 32), 0x5a5f6e));
  const ring = mesh(new THREE.TorusGeometry(1.9, 0.05, 4, 40), 0xf2c94c);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  pad.add(ring);
  place(pad, top, 0.02);
  const rocket = new THREE.Group();
  const part = (geo, color, x, y, z, rx = 0, ry = 0) => {
    const m = mesh(geo, color);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    rocket.add(m);
  };
  part(new THREE.CylinderGeometry(0.34, 0.45, 0.4, 16), 0x2a2a35, 0, 0.3, 0);
  part(new THREE.CylinderGeometry(0.45, 0.45, 3.4, 20), 0xf2f2f5, 0, 2.2, 0);
  part(new THREE.CylinderGeometry(0.46, 0.46, 0.26, 20), 0xd9534a, 0, 3.0, 0);
  part(new THREE.ConeGeometry(0.45, 1.1, 20), 0xd9534a, 0, 4.45, 0);
  part(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), 0x8db8c6, 0, 3.5, 0.45, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2, fin = mesh(new THREE.BoxGeometry(0.05, 0.95, 0.65), 0xd9534a);
    fin.position.set(Math.sin(a) * 0.55, 0.85, Math.cos(a) * 0.55);
    fin.rotation.y = a;
    rocket.add(fin);
  }
  place(rocket, top, 0.07, 0.6);
  circle(top.clone(), 0.75, { y1: 4.8 });

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

  // ---- rocks, kept off the pad, the stamp spots and each other
  {
    const spots = MOON_SPOTS.map((s) => V(...s.d)), rocks = [];
    for (let i = 0; i < 600 && rocks.length < 26; i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z), d = V(s * Math.cos(t), z, s * Math.sin(t));
      const size = 0.25 + rnd() * rnd() * 0.75;
      if (marc(d, top) < 4.6 || spots.some((p) => marc(p, d) < 1.4 + size) || rocks.some((r) => marc(r.d, d) < r.size + size + 0.9)) continue;
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
  {
    const geo = new THREE.SphereGeometry(20, 40, 28);
    const pos = geo.attributes.position, col = [], v = new THREE.Vector3(), c = new THREE.Color();
    const sea = new THREE.Color(0x4fa3c7), land = new THREE.Color(0x7cc36a), sand = new THREE.Color(0xe8d8a0), cloud = new THREE.Color(0xf4f8f6);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const n = Math.sin(v.x * 4.1 + 1.3) * Math.sin(v.y * 3.7 - 0.4) * Math.sin(v.z * 4.6 + 2.1) + 0.35 * Math.sin(v.x * 9 + v.z * 7);
      const cl = Math.sin(v.x * 7 - v.y * 5 + 0.7) * Math.sin(v.z * 6 + v.y * 4);
      c.copy(n > 0.12 ? land : n > 0.05 ? sand : sea);
      if (cl > 0.55) c.lerp(cloud, 0.85);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const planet = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
    planet.position.copy(V(-0.86, 0.42, -0.3).normalize()).multiplyScalar(82);
    group.add(planet);
  }

  // ---- the day's golden moon stamps
  let day = -1, found = new Set(), stamps = [];
  const glow = stampGlow();
  function layOut() {
    for (const s of stamps) {
      group.remove(s.mesh);
      W.noNormals.splice(W.noNormals.indexOf(s.halo), 1);
    }
    day = huntDay();
    stamps = moonSpots(day).map((i) => {
      const sp = MOON_SPOTS[i], d = V(...sp.d), m = stampMesh(), halo = new THREE.Sprite(glow);
      halo.scale.set(1.3, 1.3, 1);
      m.add(halo);
      m.scale.setScalar(1.6);
      W.noNormals.push(halo);
      place(m, d, sp.h, rnd() * 6);
      m.visible = !found.has(i);
      return { id: i, d, h: sp.h, mesh: m, halo, base: m.position.clone(), ph: rnd() * 6 };
    });
  }
  layOut();

  // You step out beside the pad with the rocket off to one side (so the camera behind you isn't looking through
  // it), facing the planet in the sky.
  const arrive = along(top, north, 2.8);
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
    /// Moon stamps found today (the server's record, for signed-in couriers).
    setFound(d, ids) {
      if (d !== day) return;
      found = new Set(ids);
      for (const s of stamps) s.mesh.visible = !found.has(s.id);
    },
    get found() { return stamps.filter((s) => found.has(s.id)).length; },
    get out() { return stamps.length; },
    /// Spin and bob the stamps, and pick up any the courier reaches (`me`: where they are, moon-local; `chest`:
    /// how high). Returns the spot picked up, or null.
    update(dt, t, { me, chest, active }) {
      if (huntDay() !== day) {
        found = new Set();
        layOut();
      }
      let got = null;
      for (const s of stamps) {
        if (!s.mesh.visible) continue;
        s.mesh.rotateY(dt * 1.8);
        s.mesh.position.copy(s.base).addScaledVector(s.d, Math.sin(t * 2.2 + s.ph) * 0.1);
        if (active && got === null && marc(s.d, me) < 0.85 && Math.abs(chest - s.h) < 0.85) {
          s.mesh.visible = false;
          found.add(s.id);
          got = s.id;
        }
      }
      return got;
    },
  };
}
