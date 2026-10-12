// The treasure hunt: golden stamps and the treasury's token drops, hidden around the planet. Some float at
// arm's height, others only a jump reaches. They move every day: the spots in hunt-spots.json are shuffled
// each UTC day (drop-pick.js, the same way the multiplayer server does): 24 golden stamps, then each running
// token drop's coins, with the token's picture on them. Finds are remembered in this browser; signed-in players
// with a post office also have them checked by the server, which signs vouchers the TokenDrops contract pays.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, ROAD_HW, arc, toon, mulberry32, texFromCanvas, nearestRoad } from "./world.js";
import { HUNT_STAMPS, huntDay } from "./hunt-pick.js";
import { layDrops } from "./drop-pick.js";

export const STAMPS = HUNT_STAMPS;
const store = (day) => `courier:hunt:${day}`;
const coinStore = (day) => `courier:coins:${day}`;
function loadFound(day) {
  try { return new Set(JSON.parse(localStorage.getItem(store(day)) || "[]")); } catch { return new Set(); }
}
function saveFound(day, found) {
  try { localStorage.setItem(store(day), JSON.stringify([...found])); } catch {}
}
function loadCoins(day) {
  try { return new Set(JSON.parse(localStorage.getItem(coinStore(day)) || "[]")); } catch { return new Set(); }
}
function saveCoins(day, found) {
  try { localStorage.setItem(coinStore(day), JSON.stringify([...found])); } catch {}
}

/// A coin's face: the token's picture in a gold ring, or its symbol on its colour.
function coinFace(info) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#e8b93a";
  g.fillRect(0, 0, 256, 256);
  g.save();
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.clip();
  if (info.picture) g.drawImage(info.picture, 24, 24, 208, 208);
  else {
    g.fillStyle = `hsl(${parseInt(info.token.slice(2, 6), 16) % 360} 55% 52%)`;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#ffffff";
    g.font = "400 64px Bungee, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(info.symbol.slice(0, 4), 128, 132, 190);
  }
  g.restore();
  g.lineWidth = 10;
  g.strokeStyle = "#fff3c4";
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  return texFromCanvas(c);
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
  let day = huntDay(), found = loadFound(day), coinsFound = loadCoins(day), stamps = [];
  let running = []; // the token drops with coins out today: [{ id, token, symbol, picture }]
  const rim = toon(0xe8b93a, { emissive: 0x4a3300 });
  const faces = new Map(); // drop id -> its coin face material

  function coinMesh(info) {
    if (!faces.has(info.id)) faces.set(info.id, new THREE.MeshBasicMaterial({ map: coinFace(info) }));
    const face = faces.get(info.id);
    // A coin standing on its edge: its round faces look along local z.
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 28).rotateX(Math.PI / 2), [rim, face, face]);
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }

  /// Put out the day's stamps and coins (taking in the last ones).
  function layOut() {
    for (const s of stamps) {
      W.world.remove(s.mesh);
      W.noNormals.splice(W.noNormals.indexOf(s.halo), 1);
    }
    const lay = layDrops(day, spots.length, running.map((d) => ({ id: d.id, spots: d.spots, isStamp: false })));
    const put = (i, kind, drop) => {
      const sp = spots[i], d = new THREE.Vector3(sp.x, sp.y, sp.z).normalize();
      const mesh = kind === "golden" ? stampMesh() : coinMesh(running.find((r) => r.id === drop));
      const halo = new THREE.Sprite(glow);
      halo.scale.set(1.3, 1.3, 1);
      mesh.add(halo);
      mesh.scale.setScalar(1.5);
      W.noNormals.push(halo);
      mesh.visible = !(kind === "golden" ? found : coinsFound).has(i);
      mesh.position.copy(d).multiplyScalar(R + sp.h);
      mesh.quaternion.copy(W.frameAt(d, rng() * 6));
      W.world.add(mesh);
      return { id: i, kind, drop, d, mesh, halo, base: mesh.position.clone(), y: sp.h, ph: rng() * 6 };
    };
    stamps = [...lay.golden.spots.map((i) => put(i, "golden", null)), ...lay.coins.flatMap((c) => c.spots.map((i) => put(i, "coin", c.drop)))];
  }
  layOut();

  return {
    /// Golden stamps found today.
    get found() { return stamps.filter((s) => s.kind === "golden" && found.has(s.id)).length; },
    /// A token drop's coins found today, and how many it has out.
    coins(drop) {
      const mine = stamps.filter((s) => s.kind === "coin" && s.drop === drop);
      return { found: mine.filter((s) => coinsFound.has(s.id)).length, out: mine.length };
    },
    get day() { return day; },
    /// The token drops running today, oldest first ({ id, token, symbol, spots, picture }): their coins go out.
    setDrops(d, list) {
      if (d !== day) return;
      const key = (l) => l.map((x) => `${x.id}:${x.spots}:${x.picture ? 1 : 0}`).join(",");
      if (key(list) === key(running)) return;
      for (const x of list) if (running.find((r) => r.id === x.id)?.picture !== x.picture) faces.delete(x.id);
      running = list;
      layOut();
    },
    /// The server's record of what you've found today (signed-in hunters): it wins over the browser's.
    setFound(d, ids, coinIds = {}) {
      if (d !== day) return;
      found = new Set(ids);
      coinsFound = new Set(Object.values(coinIds).flat());
      saveFound(day, found);
      saveCoins(day, coinsFound);
      for (const s of stamps) s.mesh.visible = !(s.kind === "golden" ? found : coinsFound).has(s.id);
    },
    /// Spin and bob; collect any stamp or coin the courier reaches. Returns what was collected, if anything:
    /// { id (its spot), kind ("golden" or "coin"), drop (a coin's drop id), mesh, d }.
    update(dt, t, { me, chest, active }) {
      // A new day: everything moves (main.js sends the day's drops again).
      if (huntDay() !== day) {
        day = huntDay();
        found = loadFound(day);
        coinsFound = loadCoins(day);
        running = [];
        layOut();
      }
      let got = null;
      for (const s of stamps) {
        if (!s.mesh.visible) continue;
        s.mesh.rotateY(dt * 1.8);
        s.mesh.position.copy(s.base).addScaledVector(s.d, Math.sin(t * 2.2 + s.ph) * 0.08);
        if (active && !got && arc(s.d, me) < 0.75 && Math.abs(chest - s.y) < 0.75) {
          s.mesh.visible = false;
          if (s.kind === "golden") {
            found.add(s.id);
            saveFound(day, found);
          } else {
            coinsFound.add(s.id);
            saveCoins(day, coinsFound);
          }
          got = s;
        }
      }
      return got;
    },
  };
}
