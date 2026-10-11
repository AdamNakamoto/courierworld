// Golden stamps hidden around the planet: some float at arm's height, others only a jump reaches.
// They move every day: 24 of the spots in hunt-spots.json are out each UTC day (hunt-pick.js
// chooses them, the same way the multiplayer server does). Finds are remembered in this browser;
// signed-in players with a post office also have them checked by the server, which pays $STAMP
// for them through the StampHunt contract.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, ROAD_HW, arc, toon, mulberry32, texFromCanvas, nearestRoad } from "./world.js";
import { HUNT_STAMPS, huntDay, pickSpots } from "./hunt-pick.js";

export const STAMPS = HUNT_STAMPS;
const store = (day) => `courier:hunt:${day}`;
function loadFound(day) {
  try { return new Set(JSON.parse(localStorage.getItem(store(day)) || "[]")); } catch { return new Set(); }
}
function saveFound(day, found) {
  try { localStorage.setItem(store(day), JSON.stringify([...found])); } catch {}
}

/// Every spot a golden stamp can be out at (what hunt-spots.json holds): the high places the biomes
/// mark, then spots in the open spread round the planet, two in five only a jump reaches. Run once
/// on the finished world to write the file; the game and the server both read that.
export function huntCandidates(W, total = 120) {
  const rng = mulberry32(777);
  const spots = [];
  const add = (d, ground, high) => {
    const p = d.clone().normalize();
    spots.push({ x: +p.x.toFixed(6), y: +p.y.toFixed(6), z: +p.z.toFixed(6), h: +(ground + (high ? 1.75 : 0.85)).toFixed(3), high: high || ground > 0.5 });
  };
  for (const s of W.stampSpots) add(s.d, s.y, false);
  for (let tries = 0; spots.length < total && tries < 60000; tries++) {
    const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    // In the open (not up in a tree), clear of the start, and spread out round the planet.
    if (nearestRoad(d) < ROAD_HW + 0.3 || W.blocked(d, 1.6) || arc(d, W.spawn.dir) < 8) continue;
    if (spots.some((s) => arc(new THREE.Vector3(s.x, s.y, s.z), d) < 4.5)) continue;
    add(d, W.terrain.baseAt(d), spots.length % 5 >= 3);
  }
  return spots;
}

function stampMesh() {
  const g = new THREE.Group();
  const part = (geo, color, z, extra) => {
    const m = new THREE.Mesh(geo, toon(color, extra));
    m.position.z = z;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  part(new THREE.BoxGeometry(0.36, 0.44, 0.035), 0xe8b93a, 0, { emissive: 0x4a3300 });
  for (const s of [-1, 1]) {
    part(new THREE.BoxGeometry(0.26, 0.32, 0.01), 0xfbf6ea, s * 0.021);
    part(new THREE.CircleGeometry(0.07, 14), 0xd9534a, s * 0.027).rotation.y = s < 0 ? Math.PI : 0;
  }
  return g;
}

export function createStamps(W, spots) {
  const rng = mulberry32(777);
  const glow = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,230,140,0.9)");
    grad.addColorStop(1, "rgba(255,200,80,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.SpriteMaterial({ map: texFromCanvas(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  })();
  let day = huntDay(), found = loadFound(day), stamps = [];

  /// Put out the day's stamps (taking in the last day's).
  function layOut() {
    for (const s of stamps) {
      W.world.remove(s.mesh);
      W.noNormals.splice(W.noNormals.indexOf(s.halo), 1);
    }
    stamps = pickSpots(day, spots.length).map((i) => {
      const sp = spots[i], d = new THREE.Vector3(sp.x, sp.y, sp.z).normalize();
      const mesh = stampMesh();
      const halo = new THREE.Sprite(glow);
      halo.scale.set(1.3, 1.3, 1);
      mesh.add(halo);
      mesh.scale.setScalar(1.5);
      W.noNormals.push(halo);
      mesh.visible = !found.has(i);
      mesh.position.copy(d).multiplyScalar(R + sp.h);
      mesh.quaternion.copy(W.frameAt(d, rng() * 6));
      W.world.add(mesh);
      return { id: i, d, mesh, halo, base: mesh.position.clone(), y: sp.h, ph: rng() * 6 };
    });
  }
  layOut();

  return {
    get found() { return stamps.filter((s) => found.has(s.id)).length; },
    get day() { return day; },
    /// The server's record of what you've found today (signed-in hunters): it wins over the browser's.
    setFound(d, ids) {
      if (d !== day) return;
      found = new Set(ids);
      saveFound(day, found);
      for (const s of stamps) s.mesh.visible = !found.has(s.id);
    },
    /// Spin and bob; collect any stamp the courier reaches. Returns the stamp collected, if any.
    update(dt, t, { me, chest, active }) {
      // A new day: the stamps move.
      if (huntDay() !== day) {
        day = huntDay();
        found = loadFound(day);
        layOut();
      }
      let got = null;
      for (const s of stamps) {
        if (!s.mesh.visible) continue;
        s.mesh.rotateY(dt * 1.8);
        s.mesh.position.copy(s.base).addScaledVector(s.d, Math.sin(t * 2.2 + s.ph) * 0.08);
        if (active && !got && arc(s.d, me) < 0.75 && Math.abs(chest - s.y) < 0.75) {
          s.mesh.visible = false;
          found.add(s.id);
          saveFound(day, found);
          got = s;
        }
      }
      return got;
    },
  };
}
