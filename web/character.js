// Characters built from simple shapes and cel-shaded, so the ink pass outlines
// them like the rest of the world. Faces +z; feet at the origin; about 1.6 tall.
import * as THREE from "https://esm.sh/three@0.160.0";
import { toon, mulberry32 } from "./world.js";

/// The default courier, used before you pick one of your own.
export const COURIER = {
  skin: 0xf3d2bb, hair: 0x3a2a2c, hairStyle: "pony", headwear: "cap",
  shirt: 0xf4efe0, accent: 0x2f8088, bottoms: 0x34476b, bottomsStyle: "shorts",
  socks: 0xf4f1ea, shoes: 0x2b2b2e, bag: "satchel",
};

const SKINS = [0xf3d2bb, 0xe8bfa0, 0xd9a47f, 0xf6dcc8, 0xc98d68];
const HAIRS = [0x3a2a2c, 0x5a3b2c, 0x1f1c1e, 0x8a6a4a, 0xb9b3ad, 0x6b4a6e];
const SHIRTS = [0xe46f5f, 0x5d8fd1, 0xf2c94c, 0x7cc2b5, 0xf4efe0, 0x8d7299, 0x9cc46f];
const BOTTOMS = [0x34476b, 0x4e5a67, 0x8a6a4a, 0x2f3a3f, 0xc0504a, 0x6b8f72];

/// A random villager look, seeded so a house always gets the same resident.
export function villager(seed) {
  const r = mulberry32(seed);
  const p = (arr) => arr[Math.floor(r() * arr.length)];
  return {
    skin: p(SKINS), hair: p(HAIRS), hairStyle: p(["bob", "bun", "pony", "long", "bob"]),
    headwear: r() < 0.25 ? p(["cap", "bucket", "beanie"]) : "none",
    shirt: p(SHIRTS), accent: p(SHIRTS), bottoms: p(BOTTOMS), bottomsStyle: p(["shorts", "skirt", "pants", "pants"]),
    socks: 0xf4f1ea, shoes: p([0x2b2b2e, 0x6c5446, 0xf4f1ea]), bag: "none", height: 0.92 + r() * 0.14,
  };
}

export function createCharacter(p) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mats = new Map();
  const mat = (c, extra) => {
    const key = extra ? `${c}:${JSON.stringify(extra)}` : c;
    if (!mats.has(key)) mats.set(key, toon(c, extra));
    return mats.get(key);
  };
  const add = (parent, geo, color, x = 0, y = 0, z = 0, extra) => {
    const m = new THREE.Mesh(geo, mat(color, extra));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const pants = p.bottomsStyle === "pants", skirt = p.bottomsStyle === "skirt";

  // ---- legs (pivot at the hip)
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.085, 0.76, 0);
    body.add(hip);
    if (!skirt) add(hip, new THREE.CylinderGeometry(0.083, 0.076, 0.22, 10), p.bottoms, 0, -0.09, 0);
    add(hip, new THREE.CylinderGeometry(pants ? 0.066 : 0.05, pants ? 0.058 : 0.042, 0.44, 8), pants ? p.bottoms : p.skin, 0, -0.38, 0);
    if (!pants) add(hip, new THREE.CylinderGeometry(0.047, 0.046, 0.11, 8), p.socks, 0, -0.6, 0);
    const shoe = add(hip, new THREE.CapsuleGeometry(0.055, 0.1, 4, 8), p.shoes, 0, -0.705, 0.035);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.set(1, 1, 0.72);
    legs.push(hip);
  }

  // ---- hips, torso, shoulders
  const pelvis = add(body, new THREE.SphereGeometry(0.16, 14, 10), p.bottoms, 0, 0.8, 0);
  pelvis.scale.set(1.05, 0.72, 0.86);
  if (skirt) add(body, new THREE.CylinderGeometry(0.15, 0.25, 0.3, 14), p.bottoms, 0, 0.66, 0);
  add(body, new THREE.CylinderGeometry(0.135, 0.152, 0.42, 14), p.shirt, 0, 0.99, 0);
  for (const s of [-1, 1]) add(body, new THREE.SphereGeometry(0.072, 10, 8), p.shirt, s * 0.15, 1.15, 0);
  const collar = add(body, new THREE.TorusGeometry(0.074, 0.026, 6, 14), p.accent, 0, 1.19, 0);
  collar.rotation.x = Math.PI / 2;
  add(body, new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8), p.skin, 0, 1.24, 0); // neck

  // ---- bag
  let bag = null;
  const strap = (z, rz, color = 0x6e4a2c) => {
    const s = add(body, new THREE.BoxGeometry(0.045, 0.62, 0.025), color, 0, 0.98, z);
    s.rotation.z = rz;
  };
  if (p.bag === "satchel" || p.bag === "golden") {
    const gold = p.bag === "golden";
    const leather = gold ? 0xe8b93a : 0xa0693c, flap = gold ? 0xc9962a : 0x7e5230;
    strap(0.15, 0.72, gold ? 0xb88a22 : 0x6e4a2c);
    strap(-0.15, -0.72, gold ? 0xb88a22 : 0x6e4a2c);
    bag = new THREE.Group();
    bag.position.set(0.2, 0.86, 0.02);
    body.add(bag);
    const extra = gold ? { emissive: 0x3a2800 } : undefined;
    add(bag, new THREE.BoxGeometry(0.1, 0.22, 0.26), leather, 0, -0.1, 0, extra);
    add(bag, new THREE.BoxGeometry(0.11, 0.1, 0.27), flap, 0, -0.02, 0, extra);
    add(bag, new THREE.BoxGeometry(0.115, 0.04, 0.05), gold ? 0xfff2b0 : 0xe2c46a, 0, -0.07, 0.06);
  } else if (p.bag === "backpack") {
    for (const s of [-1, 1]) {
      const st = add(body, new THREE.BoxGeometry(0.04, 0.36, 0.025), 0x4e5a67, s * 0.09, 1.0, 0.145);
      st.rotation.x = -0.1;
    }
    bag = new THREE.Group();
    bag.position.set(0, 0.98, -0.2);
    body.add(bag);
    add(bag, new THREE.BoxGeometry(0.28, 0.34, 0.14), p.accent, 0, 0, 0);
    add(bag, new THREE.BoxGeometry(0.22, 0.14, 0.05), 0xf4efe0, 0, -0.06, -0.08);
    add(bag, new THREE.BoxGeometry(0.29, 0.06, 0.15), 0x3b4145, 0, 0.14, 0);
  } else if (p.bag === "tote") {
    strap(0.14, 0.2, 0xd8cdb0);
    bag = new THREE.Group();
    bag.position.set(0.17, 0.76, 0.06);
    body.add(bag);
    add(bag, new THREE.BoxGeometry(0.06, 0.28, 0.26), 0xeee4c8, 0, 0, 0);
    add(bag, new THREE.BoxGeometry(0.065, 0.08, 0.12), p.accent, 0, 0.02, 0);
  } else if (p.bag === "sack") {
    bag = new THREE.Group();
    bag.position.set(0.1, 1.08, -0.2);
    body.add(bag);
    const sk = add(bag, new THREE.SphereGeometry(0.2, 12, 10), 0xd2b48c, 0, 0, 0);
    sk.scale.set(1, 1.15, 0.8);
    add(bag, new THREE.CylinderGeometry(0.05, 0.08, 0.1, 8), 0xb8986e, 0.06, 0.24, 0.02);
    add(bag, new THREE.BoxGeometry(0.12, 0.08, 0.02), 0xf4efe0, 0, -0.02, -0.16); // envelope peeking out
    strap(0.15, 0.55, 0x8a6a4a);
  }

  // ---- arms (pivot at the shoulder)
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.19, 1.14, 0);
    sh.rotation.z = s * 0.1;
    body.add(sh);
    add(sh, new THREE.CylinderGeometry(0.06, 0.056, 0.17, 10), p.shirt, 0, -0.06, 0);
    add(sh, new THREE.CylinderGeometry(0.04, 0.035, 0.32, 8), p.skin, 0, -0.28, 0);
    add(sh, new THREE.SphereGeometry(0.046, 8, 6), p.skin, 0, -0.46, 0);
    arms.push(sh);
  }

  // ---- head
  const head = new THREE.Group();
  head.position.set(0, 1.27, 0);
  body.add(head);
  const skull = add(head, new THREE.SphereGeometry(0.19, 20, 16), p.skin, 0, 0.17, 0);
  skull.scale.set(1, 1.04, 0.97);
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.034, 8, 6), p.skin, s * 0.185, 0.15, 0);

  // Face: tall dark eyes with a catch-light, brows, a small mouth, blush.
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = add(head, new THREE.CapsuleGeometry(0.021, 0.032, 4, 8), 0x231d20, s * 0.068, 0.165, 0.168);
    e.scale.set(1, 1, 0.45);
    eyes.push(e);
    add(head, new THREE.SphereGeometry(0.008, 6, 4), 0xffffff, s * 0.062, 0.18, 0.18);
    const brow = add(head, new THREE.BoxGeometry(0.06, 0.012, 0.012), p.hair, s * 0.07, 0.235, 0.17);
    brow.rotation.z = -s * 0.12;
    const blush = add(head, new THREE.SphereGeometry(0.028, 8, 6), 0xf0a49a, s * 0.11, 0.115, 0.15);
    blush.scale.set(1, 0.5, 0.3);
  }
  add(head, new THREE.BoxGeometry(0.03, 0.008, 0.01), 0x7a3b36, 0, 0.085, 0.182);

  // ---- hair: a cap over the top and back, bangs, then the style
  const hairCap = add(head, new THREE.SphereGeometry(0.205, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), p.hair, 0, 0.18, -0.01);
  hairCap.rotation.x = -0.32;
  const backHair = add(head, new THREE.SphereGeometry(0.188, 16, 12), p.hair, 0, 0.13, -0.045);
  backHair.scale.set(1.02, 1, 0.9);
  for (const [x, y, z] of [[-0.085, 0.29, 0.13], [0, 0.305, 0.145], [0.085, 0.29, 0.13]]) {
    const b = add(head, new THREE.SphereGeometry(0.075, 10, 8), p.hair, x, y, z);
    b.scale.set(1.1, 0.72, 0.55);
  }
  const tails = []; // swinging hair pieces
  const tailAt = (x, y, z, len, rx, rz = 0) => {
    const t = new THREE.Group();
    t.position.set(x, y, z);
    t.rotation.set(rx, 0, rz);
    t.userData.rest = rx;
    head.add(t);
    add(t, new THREE.CapsuleGeometry(0.055, len, 4, 10), p.hair, 0, -len / 2 - 0.03, -0.02);
    const tie = add(t, new THREE.TorusGeometry(0.038, 0.015, 6, 10), p.accent, 0, 0, 0);
    tie.rotation.x = Math.PI / 2;
    tails.push(t);
  };
  const sideLocks = (len) => {
    for (const s of [-1, 1]) add(head, new THREE.CapsuleGeometry(0.035, len, 4, 8), p.hair, s * 0.165, 0.17 - len / 2, 0.05);
  };
  switch (p.hairStyle) {
    case "pony":
      sideLocks(0.12);
      tailAt(0, 0.24, -0.17, 0.2, 0.55);
      break;
    case "bun":
      sideLocks(0.1);
      add(head, new THREE.SphereGeometry(0.085, 12, 10), p.hair, 0, 0.37, -0.08);
      break;
    case "bob": {
      for (const s of [-1, 1]) {
        const side = add(head, new THREE.SphereGeometry(0.11, 12, 10), p.hair, s * 0.15, 0.1, 0.0);
        side.scale.set(0.7, 1.15, 1.25);
      }
      break;
    }
    case "twin":
      sideLocks(0.1);
      for (const s of [-1, 1]) tailAt(s * 0.17, 0.25, -0.08, 0.22, 0.3, s * 0.5);
      break;
    case "long": {
      sideLocks(0.2);
      const back = add(head, new THREE.CapsuleGeometry(0.15, 0.26, 4, 12), p.hair, 0, -0.02, -0.11);
      back.scale.set(1.05, 1, 0.55);
      break;
    }
  }

  // ---- headwear
  switch (p.headwear) {
    case "cap": {
      const crown = add(head, new THREE.SphereGeometry(0.212, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), p.accent, 0, 0.2, -0.01);
      crown.scale.y = 0.9;
      const brim = add(head, new THREE.CylinderGeometry(0.13, 0.13, 0.016, 16), p.accent, 0, 0.3, 0.17);
      brim.scale.z = 0.75;
      brim.rotation.x = 0.16;
      add(head, new THREE.BoxGeometry(0.05, 0.04, 0.02), 0xf2c94c, 0, 0.36, 0.18);
      break;
    }
    case "bucket": {
      add(head, new THREE.CylinderGeometry(0.17, 0.2, 0.14, 16), p.accent, 0, 0.36, -0.01);
      const brim = add(head, new THREE.CylinderGeometry(0.29, 0.29, 0.02, 20), p.accent, 0, 0.29, -0.01);
      brim.rotation.x = 0.08;
      add(head, new THREE.CylinderGeometry(0.205, 0.205, 0.035, 16), 0xf4efe0, 0, 0.31, -0.01);
      break;
    }
    case "beanie": {
      const cap = add(head, new THREE.SphereGeometry(0.215, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), p.accent, 0, 0.21, -0.02);
      cap.rotation.x = -0.2;
      const fold = add(head, new THREE.TorusGeometry(0.19, 0.035, 6, 20), p.accent, 0, 0.28, 0.0);
      fold.rotation.x = Math.PI / 2 - 0.2;
      add(head, new THREE.SphereGeometry(0.06, 10, 8), 0xf4efe0, 0, 0.45, -0.06);
      break;
    }
    case "headphones": {
      const band = add(head, new THREE.TorusGeometry(0.215, 0.022, 6, 20, Math.PI), 0x3b4145, 0, 0.17, 0);
      band.rotation.z = 0;
      for (const s of [-1, 1]) {
        const cup = add(head, new THREE.CylinderGeometry(0.065, 0.065, 0.05, 14), p.accent, s * 0.205, 0.16, 0);
        cup.rotation.z = Math.PI / 2;
      }
      break;
    }
    case "goggles": {
      const strapG = add(head, new THREE.TorusGeometry(0.2, 0.018, 6, 24), 0x6c5446, 0, 0.27, 0);
      strapG.rotation.x = Math.PI / 2 - 0.25;
      for (const s of [-1, 1]) {
        const lens = add(head, new THREE.CylinderGeometry(0.048, 0.048, 0.04, 14), 0xc9962a, s * 0.06, 0.31, 0.155);
        lens.rotation.x = Math.PI / 2 - 0.5;
        const glass = add(head, new THREE.CylinderGeometry(0.036, 0.036, 0.045, 14), 0x8db8c6, s * 0.06, 0.31, 0.158);
        glass.rotation.x = Math.PI / 2 - 0.5;
      }
      break;
    }
  }

  if (p.height) root.scale.setScalar(p.height);

  // ---- poses and animation
  let pose = "walk"; // walk | sit (bike, moped) | stand (skateboard, plane)
  let phase = 0, blink = 2 + Math.random() * 3;
  function setPose(next) {
    pose = next;
  }
  function update(dt, speed, t, air = 0) {
    // speed: 0 idle … 1 full walk (or how hard she's pedalling); air: 0 on the ground … 1 mid-jump
    phase += dt * (3 + 8.5 * speed);
    const s = Math.sin(phase);
    if (pose === "walk") {
      legs[0].rotation.set(s * 0.7 * speed, 0, 0);
      legs[1].rotation.set(-s * 0.7 * speed, 0, 0);
      arms[0].rotation.set(-s * 0.6 * speed, 0, -0.1);
      arms[1].rotation.set(s * 0.6 * speed, 0, 0.1);
      body.position.y = Math.abs(Math.cos(phase)) * 0.045 * speed + Math.sin(t * 2.1) * 0.004 * (1 - speed);
      body.rotation.x = 0.07 * speed;
      if (air > 0) {
        // Mid-jump: one knee up, arms flung out.
        legs[0].rotation.x += (-0.6 - legs[0].rotation.x) * air;
        legs[1].rotation.x += (0.3 - legs[1].rotation.x) * air;
        arms[0].rotation.x *= 1 - air;
        arms[1].rotation.x *= 1 - air;
        arms[0].rotation.z += (-1.15 - arms[0].rotation.z) * air;
        arms[1].rotation.z += (1.15 - arms[1].rotation.z) * air;
        body.position.y *= 1 - air;
      }
    } else if (pose === "sit") {
      // Seated, hands forward on the bars, legs pedalling.
      legs[0].rotation.set(-1.15 + s * 0.35 * speed, 0, 0);
      legs[1].rotation.set(-1.15 - s * 0.35 * speed, 0, 0);
      arms[0].rotation.set(-1.15, 0, -0.12);
      arms[1].rotation.set(-1.15, 0, 0.12);
      body.position.y = 0;
      body.rotation.x = 0.25;
    } else {
      // Riding stance: sideways-ish, knees soft, arms out for balance.
      legs[0].rotation.set(0.12, 0, 0.12);
      legs[1].rotation.set(-0.12, 0, -0.12);
      arms[0].rotation.set(0, 0, -0.55 + Math.sin(t * 2) * 0.05);
      arms[1].rotation.set(0, 0, 0.55 - Math.sin(t * 2) * 0.05);
      body.position.y = -0.03 + Math.sin(t * 3) * 0.008;
      body.rotation.x = 0.08;
    }
    head.rotation.x = -0.05 * speed + Math.sin(t * 1.1) * 0.025 * (1 - speed);
    for (const tl of tails) tl.rotation.x = tl.userData.rest + Math.sin(phase * 2) * 0.14 * speed + Math.sin(t * 1.7) * 0.03;
    if (bag) bag.rotation.x = Math.sin(phase) * 0.1 * speed;
    blink -= dt;
    const closed = blink < 0.12;
    for (const e of eyes) e.scale.y = closed ? 0.15 : 1;
    if (blink < 0) blink = 2 + Math.random() * 4;
  }

  return { root, body, head, update, setPose };
}
