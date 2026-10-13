// What the moon and Mars share (moon.js, mars.js): the landing pad with the rocket home on it, the post box that
// hands out letters for the locals, the locals themselves (they breathe, blink, glow and turn to watch you, and hop
// while they talk), and the day's golden stamps.
import * as THREE from "https://esm.sh/three@0.160.0";
import { toon, texFromCanvas } from "./world.js";
import { huntDay } from "./hunt-pick.js";
import { stampMesh, stampGlow } from "./stamps.js";

/// A quaternion standing an object up at `d` (local +y) and facing it toward `target` (local +z).
export function facing(d, target) {
  const up = d.clone().normalize(), f = target.clone().addScaledVector(up, -target.dot(up)).normalize();
  const x = new THREE.Vector3().crossVectors(up, f).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, f));
}

/// The landing pad, and the rocket home that stands on it: { pad, rocket }, each with its base at y 0.
export function padAndRocket(mesh) {
  const pad = new THREE.Group();
  pad.add(mesh(new THREE.CylinderGeometry(2.1, 2.2, 0.1, 32), 0x5a5f6e));
  const ring = mesh(new THREE.TorusGeometry(1.9, 0.05, 4, 40), 0xf2c94c);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  pad.add(ring);
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
  return { pad, rocket };
}

/// Courier World as it looks from space, `r` metres across the middle: blue sea, green land, sand and a few clouds.
export function homePlanet(r) {
  const geo = new THREE.SphereGeometry(r, 40, 28);
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
  return new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
}

/// A post box on a post: a red box with a slot, a little flag, and a plate saying whose post it is (`label`, such
/// as "MOON POST"). Its base at y 0, its front (the slot) toward +z.
export function postBox(mesh, label) {
  const g = new THREE.Group();
  const post = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8), 0x3b4145);
  post.position.y = 0.4;
  g.add(post);
  const box = mesh(new THREE.BoxGeometry(0.5, 0.42, 0.62), 0xd9534a);
  box.position.y = 1.0;
  g.add(box);
  const lid = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.62, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), 0xd9534a); // (a rounded top)
  lid.position.y = 1.21;
  g.add(lid);
  const slot = mesh(new THREE.BoxGeometry(0.26, 0.04, 0.02), 0x1b1c1f);
  slot.position.set(0, 1.08, 0.315);
  g.add(slot);
  const flag = mesh(new THREE.BoxGeometry(0.03, 0.22, 0.12), 0xf2c94c);
  flag.position.set(0.27, 1.22, -0.1);
  g.add(flag);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const x = c.getContext("2d");
  x.fillStyle = "#fbf6ea";
  x.fillRect(0, 0, 256, 96);
  x.fillStyle = "#283033";
  x.font = "400 40px Bungee, Impact, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(label, 128, 50, 236);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.165), new THREE.MeshBasicMaterial({ map: texFromCanvas(c) }));
  plate.position.set(0, 0.89, 0.312);
  g.add(plate);
  return g;
}

/// The MOON Missions board, where couriers pick up MOON letters (missions.js): a signboard on two posts under a little
/// roof, with a glowing full moon on top. Its base at y 0, its face toward +z. Returns { g, moon } (the moon, to pulse).
export function missionBoard(mesh) {
  const g = new THREE.Group();
  for (const x of [-0.95, 0.95]) {
    const post = mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.2, 8), 0x3b4145);
    post.position.set(x, 1.1, 0);
    g.add(post);
  }
  const back = mesh(new THREE.BoxGeometry(2.1, 1.2, 0.08), 0x2a2340);
  back.position.set(0, 1.45, -0.05);
  g.add(back);
  const roof = mesh(new THREE.BoxGeometry(2.4, 0.1, 0.55), 0xf2c94c);
  roof.position.set(0, 2.15, 0.05);
  g.add(roof);
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 288;
  const x = c.getContext("2d");
  x.fillStyle = "#2a2340";
  x.fillRect(0, 0, 512, 288);
  x.strokeStyle = "#f2c94c";
  x.lineWidth = 10;
  x.strokeRect(10, 10, 492, 268);
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.shadowColor = "#ffe9a8";
  x.shadowBlur = 18;
  x.fillStyle = "#ffe9a8";
  x.font = "400 64px Bungee, Impact, sans-serif";
  x.fillText("🌕 MOON", 256, 92, 400);
  x.fillText("MISSIONS", 256, 160, 400);
  x.shadowBlur = 0;
  x.fillStyle = "#f2c94c";
  x.font = "400 26px Bungee, Impact, sans-serif";
  x.fillText("LETTERS THAT PAY MOON", 256, 234, 400);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.1), new THREE.MeshBasicMaterial({ map: texFromCanvas(c) }));
  face.position.set(0, 1.45, 0.0);
  g.add(face);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a8, side: THREE.DoubleSide }));
  moon.position.set(0, 2.72, 0.05);
  g.add(moon);
  const ring = mesh(new THREE.TorusGeometry(0.46, 0.05, 6, 32), 0xf2c94c);
  ring.position.copy(moon.position);
  g.add(ring);
  const stem = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), 0x3b4145);
  stem.position.set(0, 2.25, 0.05);
  g.add(stem);
  return { g, moon };
}

/// The locals on a world of radius `R` (moon frogs, Martians, astronauts): `add` each one once it's built and placed
/// ({ g, body, eyes, tips, tick? }: the group, the part that turns and hops, the eyes that blink, the bits that glow,
/// and anything else it does each frame), with where it stands, its name and what it says.
export function createLocals(R) {
  const all = [];
  const arcOn = (a, b) => R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  return {
    all,
    add(f, d, name, lines, ph) {
      all.push({ ...f, d, name, lines, ph, inv: f.g.quaternion.clone().invert(), home: 0, talk: false });
    },
    /// The local within `reach` metres of `me`, nearest first, to talk to: { name, line(), talk(on) }, or null.
    nearest(me, reach = 2.4) {
      let best = null;
      for (const f of all) {
        const dd = arcOn(f.d, me);
        if (dd < reach && (!best || dd < best.dd)) best = { f, dd };
      }
      if (!best) return null;
      const f = best.f;
      return { name: f.name, line: () => f.lines[Math.floor(Math.random() * f.lines.length)], talk: (on) => (f.talk = on) };
    },
    /// Breathe, blink, glow, and turn to watch the courier (at `me`) when they're near, hopping while they talk.
    update(dt, t, me) {
      const mp = me.clone().multiplyScalar(R + 1), v = new THREE.Vector3();
      for (const f of all) {
        const near = arcOn(f.d, me) < 7;
        let yaw = f.home + 0.35 * Math.sin(t * 0.3 + f.ph);
        if (near) {
          v.copy(mp).sub(f.g.position).applyQuaternion(f.inv);
          yaw = Math.atan2(v.x, v.z);
        }
        let dy = yaw - f.body.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        f.body.rotation.y += dy * (1 - Math.exp(-dt * 4));
        f.body.position.y = f.talk ? Math.abs(Math.sin(t * 6 + f.ph)) * 0.18 : 0;
        f.body.scale.y = 1 + 0.035 * Math.sin(t * 2.6 + f.ph);
        const shut = (t + f.ph) % 4.3 < 0.14;
        for (const e of f.eyes) e.scale.y = shut ? 0.12 : 1;
        for (const tp of f.tips) tp.scale.setScalar(1 + 0.3 * Math.sin(t * 4 + f.ph));
        f.tick?.(dt, t); // (anything else it does, like an astronaut's idle sway)
      }
    },
  };
}

/// The day's golden stamps on a world of radius `R`: `spots` is every spot one can be out at ({ d, h }), `pick(day)`
/// today's, laid out with `place(obj, d, h, spin)`. They spin and bob, and `update` picks up any the courier reaches.
export function dayStamps(W, group, place, { R, spots, pick }, rnd) {
  let day = -1, found = new Set(), stamps = [];
  const glow = stampGlow();
  const arcOn = (a, b) => R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  function layOut() {
    for (const s of stamps) {
      group.remove(s.mesh);
      W.noNormals.splice(W.noNormals.indexOf(s.halo), 1);
    }
    day = huntDay();
    stamps = pick(day).map((i) => {
      const sp = spots[i], d = new THREE.Vector3(...sp.d), m = stampMesh(), halo = new THREE.Sprite(glow);
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
  return {
    /// Stamps found today (the server's record, for signed-in couriers).
    setFound(d, ids) {
      if (d !== day) return;
      found = new Set(ids);
      for (const s of stamps) s.mesh.visible = !found.has(s.id);
    },
    get found() { return stamps.filter((s) => found.has(s.id)).length; },
    get out() { return stamps.length; },
    /// `me`: where the courier is (a direction in the world's frame); `chest`: how high. Returns the spot picked up,
    /// or null.
    update(dt, t, me, chest, active) {
      if (huntDay() !== day) {
        found = new Set();
        layOut();
      }
      let got = null;
      for (const s of stamps) {
        if (!s.mesh.visible) continue;
        s.mesh.rotateY(dt * 1.8);
        s.mesh.position.copy(s.base).addScaledVector(s.d, Math.sin(t * 2.2 + s.ph) * 0.1);
        if (active && got === null && arcOn(s.d, me) < 0.85 && Math.abs(chest - s.h) < 0.85) {
          s.mesh.visible = false;
          found.add(s.id);
          got = s.id;
        }
      }
      return got;
    },
  };
}
