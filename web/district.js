// The players' post offices, standing on the planet. The strongest offices on the leaderboard take the
// lots nearest the main post office; each building is as big as its tier (a kiosk up to an HQ) and its
// sign names the owner. The top three get a gold, silver or bronze star. Empty lots show a sign.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, toon, texFromCanvas } from "./world.js";
import { compact } from "./character.js";

const TIERS = ["Kiosk", "Branch", "Depot", "Hub", "HQ"];
const RED = 0xd9534a, RED_DARK = 0xb4443c, CREAM = 0xf4efe0, WALL = 0xf1e6d2, GLASS = 0x8db8c6, WOOD = 0x6c5446, STEEL = 0x8d9790, INK = 0x3b4145;
const MEDALS = [0xf2c94c, 0xd9dde0, 0xd08a4e];
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// A painted sign: a big line and a small one.
function sign(w, h, big, small, { bg = "#d9534a", fg = "#fbf6ea" } = {}) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#283033";
  g.lineWidth = 10;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `400 ${Math.round(c.height * (small ? 0.42 : 0.55))}px Bungee, Impact, sans-serif`;
  g.fillText(big, c.width / 2, c.height * (small ? 0.4 : 0.54));
  if (small) {
    g.font = `700 ${Math.round(c.height * 0.24)}px ui-monospace, Menlo, monospace`;
    g.fillText(small, c.width / 2, c.height * 0.76);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), toon(0xffffff, { map: texFromCanvas(c) }));
  return m;
}

/// A five-pointed star for the top three.
function starGeometry(r = 0.32) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }).translate(0, 0, -0.04);
}

/// One office building, facing +z. Returns its group and footprint (half width/depth, height).
function building(tier, owner, rank, mine) {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, extra) => {
    const m = new THREE.Mesh(geo, toon(color, extra));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const box = (w, h, d, color, x, y, z) => add(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  const label = mine ? "YOUR OFFICE" : short(owner);
  let hw, hd, h, signAt;
  if (tier <= 0) {
    // Kiosk: a little booth with a striped awning and a post box.
    hw = 0.95; hd = 0.75; h = 2.1;
    box(1.9, 1.9, 1.5, WALL, 0, 0.95, 0);
    box(2.0, 0.14, 1.6, RED, 0, 1.97, 0);
    box(1.2, 0.7, 0.05, INK, 0, 1.25, 0.76);
    box(1.4, 0.08, 0.35, WOOD, 0, 0.88, 0.9);
    for (let i = 0; i < 6; i++) {
      const s = box(0.33, 0.04, 0.55, i % 2 ? CREAM : RED, -0.83 + i * 0.33, 1.72, 0.98);
      s.rotation.x = 0.35;
    }
    add(new THREE.CylinderGeometry(0.18, 0.18, 0.75, 12), RED, 1.25, 0.38, 0.45);
    add(new THREE.SphereGeometry(0.18, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), RED, 1.25, 0.75, 0.45);
    signAt = [0, 2.35, 0.2, 1.8, 0.5];
  } else if (tier === 1) {
    // Branch: a small shop front.
    hw = 1.35; hd = 1.15; h = 2.9;
    box(2.7, 2.6, 2.3, WALL, 0, 1.3, 0);
    box(2.8, 0.3, 2.4, RED, 0, 2.75, 0);
    box(0.7, 1.4, 0.06, WOOD, -0.6, 0.7, 1.16);
    box(1.0, 0.8, 0.06, GLASS, 0.55, 1.2, 1.16);
    box(1.1, 0.06, 0.1, CREAM, 0.55, 0.78, 1.2);
    signAt = [0, 2.2, 1.2, 2.2, 0.5];
  } else if (tier === 2) {
    // Depot: a loading dock with a roll-up door.
    hw = 1.65; hd = 1.35; h = 3.2;
    box(3.3, 3.0, 2.7, 0xe2d4bc, 0, 1.5, 0);
    box(3.4, 0.2, 2.8, RED_DARK, 0, 3.1, 0);
    box(1.6, 1.8, 0.06, STEEL, -0.6, 0.9, 1.36);
    for (let i = 0; i < 7; i++) box(1.6, 0.03, 0.08, INK, -0.6, 0.15 + i * 0.25, 1.4);
    box(0.65, 1.4, 0.06, WOOD, 1.05, 0.7, 1.36);
    box(3.0, 0.15, 0.6, 0x9a958a, 0, 0.08, 1.65);
    signAt = [0.0, 2.45, 1.38, 2.8, 0.55];
  } else if (tier === 3) {
    // Hub: two floors, a canopy over the door and a flag on the roof.
    hw = 1.75; hd = 1.45; h = 5.2;
    box(3.5, 4.6, 2.9, WALL, 0, 2.3, 0);
    box(3.6, 0.18, 3.0, RED, 0, 2.3, 0);
    box(3.6, 0.25, 3.0, RED, 0, 4.7, 0);
    for (const y of [1.3, 3.4]) for (const x of [-1.1, 0, 1.1]) if (!(y < 2 && x === 0)) box(0.7, 0.8, 0.06, GLASS, x, y, 1.46);
    box(0.8, 1.5, 0.06, WOOD, 0, 0.75, 1.46);
    box(1.4, 0.08, 0.7, RED, 0, 1.65, 1.8);
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), STEEL, 1.4, 5.6, -1.0);
    box(0.6, 0.38, 0.02, RED, 1.72, 6.15, -1.0);
    signAt = [0, 2.85, 1.47, 3.0, 0.5];
  } else {
    // HQ: three floors, columns at the door, a clock and an antenna.
    hw = 1.85; hd = 1.55; h = 7.2;
    box(3.7, 6.6, 3.1, CREAM, 0, 3.3, 0);
    box(3.8, 0.3, 3.2, RED, 0, 6.7, 0);
    for (const y of [2.6, 4.0, 5.4]) {
      box(3.75, 0.1, 3.15, RED, 0, y - 0.6, 0);
      for (const x of [-1.2, -0.4, 0.4, 1.2]) box(0.55, 0.75, 0.06, GLASS, x, y, 1.56);
    }
    box(1.0, 1.6, 0.06, WOOD, 0, 0.8, 1.56);
    for (const x of [-0.75, 0.75]) add(new THREE.CylinderGeometry(0.1, 0.1, 1.8, 10), CREAM, x, 0.9, 1.85);
    box(2.0, 0.12, 0.7, RED, 0, 1.86, 1.85);
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 20), CREAM, 0, 6.15, 1.58).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), STEEL, -1.2, 7.7, -0.8);
    signAt = [0, 1.25, 1.6, 2.8, 0.45];
  }
  compact(g);
  const [sx, sy, sz, sw, sh] = signAt;
  const s = sign(sw, sh, TIERS[Math.min(tier, 4)].toUpperCase(), label);
  s.position.set(sx, sy, sz + 0.03);
  g.add(s);
  let star = null;
  if (rank < 3) {
    star = new THREE.Mesh(starGeometry(tier >= 3 ? 0.42 : 0.32), toon(MEDALS[rank], { emissive: MEDALS[rank], emissiveIntensity: 0.25 }));
    star.position.set(0, h + 0.7, 0);
    star.castShadow = true;
    g.add(star);
  }
  return { group: g, hw, hd, h, star };
}

/// "Your post office here": the sign on an empty lot.
function lotSign() {
  const g = new THREE.Group();
  for (const x of [-0.55, 0.55]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), toon(WOOD));
    post.position.set(x, 0.65, 0);
    post.castShadow = true;
    g.add(post);
  }
  const s = sign(1.5, 0.75, "YOUR POST", "OFFICE HERE", { bg: "#f2c94c", fg: "#283033" });
  s.position.set(0, 1.15, 0.03);
  g.add(s);
  const back = s.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.03;
  g.add(back);
  return g;
}

const dispose = (o) => o.traverse((m) => {
  if (!m.isMesh) return;
  m.geometry.dispose();
  if (!m.material.userData.shared) {
    m.material.map?.dispose();
    m.material.dispose();
  }
});

export function createDistrict(W) {
  const lots = W.lots.map((lot) => {
    const q = W.frameAt(lot.d, lot.spin);
    const empty = lotSign();
    empty.position.copy(lot.d).multiplyScalar(R + 0.06);
    empty.quaternion.copy(q);
    empty.translateZ(0.9);
    W.world.add(empty);
    return { ...lot, q, empty, key: null, built: null, obstacle: null };
  });

  function clear(lot) {
    if (lot.built) {
      W.world.remove(lot.built.group);
      dispose(lot.built.group);
      lot.built = null;
    }
    if (lot.obstacle) {
      W.obstacles.splice(W.obstacles.indexOf(lot.obstacle), 1);
      lot.obstacle = null;
    }
  }

  return {
    /// Fill the lots from the leaderboard (strongest first); `me` is the logged-in wallet, if any.
    update(list, me) {
      lots.forEach((lot, i) => {
        const o = list[i];
        const mine = !!(o && me && o.owner.toLowerCase() === me.toLowerCase());
        const key = o ? `${o.owner}:${o.tier}:${Math.min(i, 3)}:${mine}` : null;
        if (key === lot.key) return;
        lot.key = key;
        clear(lot);
        lot.empty.visible = !o;
        if (!o) return;
        const b = building(o.tier, o.owner, i, mine);
        b.group.position.copy(lot.d).multiplyScalar(R + 0.06);
        b.group.quaternion.copy(lot.q);
        W.world.add(b.group);
        lot.built = b;
        // Solid, and the camera keeps clear of it like any other building.
        lot.obstacle = {
          d: lot.d, kind: "rect", hw: b.hw + 0.05, hd: b.hd + 0.05, wall: { h: b.h, hd: b.hd + 0.05 },
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(lot.q), front: new THREE.Vector3(0, 0, 1).applyQuaternion(lot.q),
          cos: Math.cos((Math.hypot(b.hw, b.hd) + 1) / R),
        };
        W.obstacles.push(lot.obstacle);
      });
    },
    /// Spin the stars.
    tick(t) {
      for (const lot of lots) if (lot.built?.star) lot.built.star.rotation.y = t * 1.5;
    },
    get lots() { return lots; },
  };
}
