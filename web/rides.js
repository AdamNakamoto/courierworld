// Rides: the trait that sets a courier's delivery power. Each faces +z with its
// base on the ground, and says where and how the rider sits on it.
import * as THREE from "https://esm.sh/three@0.160.0";
import { toon } from "./world.js";

function kit() {
  const mats = new Map();
  const mat = (c, extra) => {
    const key = `${c}:${extra ? JSON.stringify(extra) : ""}`;
    if (!mats.has(key)) mats.set(key, toon(c, extra));
    return mats.get(key);
  };
  return (parent, geo, color, x = 0, y = 0, z = 0, extra) => {
    const m = new THREE.Mesh(geo, mat(color, extra));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
}

/// A thin rod from a to b.
function rod(add, parent, a, b, r, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = add(parent, new THREE.CylinderGeometry(r, r, d.length(), 6), color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function wheel(add, parent, r, tube, z, y, color = 0x2b3134, hub = 0xd9d8d2) {
  const w = new THREE.Group();
  w.position.set(0, y, z);
  parent.add(w);
  const tyre = add(w, new THREE.TorusGeometry(r, tube, 8, 24), color);
  tyre.rotation.y = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const spoke = add(w, new THREE.CylinderGeometry(0.008, 0.008, r * 2, 4), hub);
    spoke.rotation.x = (i * Math.PI) / 3;
  }
  const h = add(w, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), hub);
  h.rotation.z = Math.PI / 2;
  return w;
}

export function createRide(key, accent = 0x2f8088) {
  const add = kit();
  const group = new THREE.Group();
  const wheels = [];
  let mount = { y: 0, z: 0, pose: "walk", pedal: false, speed: 1 };
  let float = null;

  if (key === "skate") {
    add(group, new THREE.BoxGeometry(0.26, 0.035, 0.86), accent, 0, 0.1, 0);
    for (const z of [-0.43, 0.43]) {
      const kick = add(group, new THREE.BoxGeometry(0.26, 0.035, 0.12), accent, 0, 0.13, z * 1.08);
      kick.rotation.x = z > 0 ? -0.45 : 0.45;
    }
    for (const z of [-0.3, 0.3]) {
      add(group, new THREE.BoxGeometry(0.2, 0.03, 0.05), 0xd9d8d2, 0, 0.07, z);
      for (const x of [-0.1, 0.1]) {
        const wh = add(group, new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), 0xf2c94c, x, 0.04, z);
        wh.rotation.z = Math.PI / 2;
        wheels.push(wh);
      }
    }
    mount = { y: 0.12, z: 0, pose: "stand", pedal: false, speed: 1.35 };
  } else if (key === "bike") {
    const frameC = accent;
    wheels.push(wheel(add, group, 0.3, 0.028, -0.5, 0.33), wheel(add, group, 0.3, 0.028, 0.5, 0.33));
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const rear = P(0, 0.33, -0.5), front = P(0, 0.33, 0.5), crank = P(0, 0.36, -0.04), seat = P(0, 0.84, -0.2), head = P(0, 0.86, 0.36);
    rod(add, group, rear, crank, 0.022, frameC);
    rod(add, group, rear, seat, 0.022, frameC);
    rod(add, group, crank, seat, 0.026, frameC);
    rod(add, group, crank, head, 0.026, frameC);
    rod(add, group, seat, head, 0.024, frameC);
    rod(add, group, head, front, 0.022, frameC);
    rod(add, group, head, P(0, 1.02, 0.33), 0.02, 0x3b4145);
    add(group, new THREE.BoxGeometry(0.52, 0.035, 0.035), 0x3b4145, 0, 1.03, 0.33);
    add(group, new THREE.BoxGeometry(0.14, 0.05, 0.26), 0x3b4145, 0, 0.9, -0.22);
    const crankArm = add(group, new THREE.CylinderGeometry(0.08, 0.08, 0.03, 10), 0xd9d8d2, 0, 0.36, -0.04);
    crankArm.rotation.z = Math.PI / 2;
    wheels.push(crankArm);
    // Front basket with letters in it.
    const basket = new THREE.Group();
    basket.position.set(0, 0.86, 0.58);
    group.add(basket);
    add(basket, new THREE.BoxGeometry(0.34, 0.2, 0.26), 0xc49a6c, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const env = add(basket, new THREE.BoxGeometry(0.22, 0.03, 0.15), i === 1 ? 0xf2e3c5 : 0xfbf8ef, 0, 0.12 + i * 0.02, -0.02 + i * 0.02);
      env.rotation.set(0.3 - i * 0.2, i * 0.4, 0);
    }
    mount = { y: 0.14, z: -0.14, pose: "sit", pedal: true, speed: 1.7 };
  } else if (key === "moped") {
    wheels.push(wheel(add, group, 0.2, 0.065, -0.52, 0.22), wheel(add, group, 0.2, 0.065, 0.55, 0.22));
    add(group, new THREE.BoxGeometry(0.3, 0.07, 0.62), 0x3b4145, 0, 0.3, 0.02); // footboard
    const rearBody = add(group, new THREE.CapsuleGeometry(0.2, 0.3, 4, 12), accent, 0, 0.5, -0.33);
    rearBody.rotation.x = Math.PI / 2;
    rearBody.scale.set(1, 1, 0.85);
    add(group, new THREE.BoxGeometry(0.3, 0.08, 0.5), 0x3b4145, 0, 0.72, -0.26); // seat
    const shield = add(group, new THREE.BoxGeometry(0.38, 0.62, 0.08), accent, 0, 0.6, 0.36);
    shield.rotation.x = -0.18;
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    rod(add, group, P(0, 0.85, 0.42), P(0, 1.02, 0.38), 0.03, 0xd9d8d2);
    rod(add, group, P(0, 0.22, 0.55), P(0, 0.85, 0.42), 0.025, 0xd9d8d2);
    add(group, new THREE.BoxGeometry(0.56, 0.04, 0.04), 0x3b4145, 0, 1.04, 0.38);
    add(group, new THREE.SphereGeometry(0.07, 10, 8), 0xfff2b0, 0, 0.92, 0.47, { emissive: 0x554400 });
    // Delivery box on the rear rack.
    add(group, new THREE.BoxGeometry(0.4, 0.34, 0.36), 0xd9534a, 0, 0.9, -0.62);
    add(group, new THREE.BoxGeometry(0.2, 0.12, 0.02), 0xfbf8ef, 0, 0.92, -0.81);
    mount = { y: 0.0, z: -0.16, pose: "sit", pedal: false, speed: 2.0 };
  } else if (key === "plane") {
    // A giant folded paper plane that floats along with the courier riding it.
    float = new THREE.Group();
    group.add(float);
    const g = new THREE.BufferGeometry();
    const nose = [0, 0, 1.5], tl = [-1.05, 0.12, -1.0], tr = [1.05, 0.12, -1.0], tail = [0, 0.02, -1.0], keel = [0, -0.36, -1.0];
    const tri = [...nose, ...tail, ...tl, ...nose, ...tr, ...tail, ...nose, ...keel, ...tail, ...nose, ...tail, ...keel];
    g.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
    g.computeVertexNormals();
    add(float, g, 0xfbf8ef, 0, 0, 0, { side: THREE.DoubleSide });
    // Fold lines and a stamp on the wing.
    add(float, new THREE.BoxGeometry(0.02, 0.01, 2.4), 0xd8d2c2, 0, 0.025, 0.25);
    const stamp = add(float, new THREE.BoxGeometry(0.28, 0.01, 0.34), accent, 0.55, 0.075, -0.55);
    stamp.rotation.z = -0.1;
    float.position.y = 0.55;
    mount = { y: 0.6, z: -0.2, pose: "stand", pedal: false, speed: 2.2, floats: true };
  }

  function update(dt, speed, t) {
    for (const w of wheels) w.rotation.x += dt * speed * (key === "bike" ? 9 : 14);
    if (float) {
      float.position.y = 0.55 + Math.sin(t * 1.8) * 0.08;
      float.rotation.z = Math.sin(t * 1.1) * 0.06;
    }
  }
  /// How high the rider is right now (the plane bobs).
  const riderY = (t) => mount.y + (float ? Math.sin(t * 1.8) * 0.08 : 0);

  return { group, mount, update, riderY, key };
}
