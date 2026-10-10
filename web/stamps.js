// Golden stamps hidden around the planet: some float at arm's height, others only a jump reaches.
// Which ones you've found is remembered in this browser.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, ROAD_HW, WALK, arc, toon, mulberry32, texFromCanvas, nearestRoad } from "./world.js";

const STORE = "courier:stamps2"; // the planet grew new places, so the stamps moved
export const STAMPS = 15;

function loadFound() {
  try { return new Set(JSON.parse(localStorage.getItem(STORE) || "[]")); } catch { return new Set(); }
}
function saveFound(found) {
  try { localStorage.setItem(STORE, JSON.stringify([...found])); } catch {}
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

export function createStamps(W) {
  const rng = mulberry32(777); // its own stream, so the town keeps its layout
  const found = loadFound();
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
  const stamps = [];
  const place = (d, ground, high) => {
    const mesh = stampMesh();
    const halo = new THREE.Sprite(glow);
    halo.scale.set(1.3, 1.3, 1);
    mesh.add(halo);
    mesh.scale.setScalar(1.5);
    W.noNormals.push(halo);
    const id = stamps.length, y = ground + (high ? 1.75 : 0.85);
    mesh.visible = !found.has(id);
    mesh.position.copy(d).multiplyScalar(R + y);
    mesh.quaternion.copy(W.frameAt(d, rng() * 6));
    W.world.add(mesh);
    stamps.push({ id, d, mesh, base: mesh.position.clone(), y, ph: rng() * 6 });
  };
  // A few are up high: on the shrine hill, the end of the pier, the works catwalk, the footbridge.
  for (const s of W.stampSpots.slice(0, 5)) place(s.d.clone().normalize(), s.y, false);
  for (let tries = 0; stamps.length < STAMPS && tries < 6000; tries++) {
    const d = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    const nr = nearestRoad(d);
    // In the open (not up in a tree), and spread out round the planet.
    if (nr < ROAD_HW + 0.3 || W.blocked(d, 1.6) || arc(d, W.spawn.dir) < 10 || stamps.some((s) => arc(s.d, d) < 7)) continue;
    place(d, W.terrain.baseAt(d), stamps.length % 5 >= 3); // two in five need a jump
  }
  return {
    get found() { return found.size; },
    /// Spin and bob; collect any stamp the courier reaches. Returns the stamp collected, if any.
    update(dt, t, { me, chest, active }) {
      let got = null;
      for (const s of stamps) {
        if (!s.mesh.visible) continue;
        s.mesh.rotateY(dt * 1.8);
        s.mesh.position.copy(s.base).addScaledVector(s.d, Math.sin(t * 2.2 + s.ph) * 0.08);
        if (active && !got && arc(s.d, me) < 0.75 && Math.abs(chest - s.y) < 0.75) {
          s.mesh.visible = false;
          found.add(s.id);
          saveFound(found);
          got = s;
        }
      }
      return got;
    },
  };
}
