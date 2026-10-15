// The map (G, or the 🗺 button): the camera pulls back from your courier to the whole world as a globe you can spin
// (drag) and zoom (scroll, pinch, +/−), with its places named, you marked and everyone else as dots. main.js moves the
// camera and turns the world; this works out the places and draws the labels over it. The treasure hunt's spots are
// never on it.
import * as THREE from "https://esm.sh/three@0.160.0";
import { SEA_LEVEL } from "./terrain.js";
import { CITY, VOLCANO, ICE, RADIO, CANYON, MOUNTAINS } from "./mars-pick.js";

const vec = (d) => (d?.isVector3 ? d.clone() : new THREE.Vector3(...d)).normalize();

/// The planet's places: { d (a direction in the planet's frame), name, kind: "zone" (a whole area) | "spot" | "mine" }.
/// `board` and `account`: the leaderboard (each office stands on its lot), to mark your own post office.
export function planetPlaces(W, { board = null, account = null } = {}) {
  const out = [], T = W.terrain;
  const add = (d, name, kind = "spot") => d && out.push({ d: vec(d), name, kind });
  add(T.TOWN?.d, "Main Street", "zone");
  for (const z of T.ZONES ?? []) add(z.d, z.name, "zone");
  if (W.square) add(W.square.d, W.square.name ?? "Times Square", "zone");
  add(W.spawn?.office?.d, "📮 Post office");
  add(W.square?.pad?.d, "📈 Launchpad");
  add(W.orb?.d, "🔮 The Orb");
  add(W.rocket?.d, "🚀 Space Express");
  add(T.plates?.find((p) => Math.abs(p.h - (SEA_LEVEL + 0.5)) < 1e-6)?.d, "🎣 Fishing pier");
  const landmark = (kind, name) => add(W.addresses?.find((a) => a.landmark && a.kind === kind)?.markerDir, name);
  landmark("lighthouse", "Lighthouse");
  landmark("shrine", "Shrine");
  landmark("cabin", "Ranger's cabin");
  add(T.pond?.d, "Pond");
  add(W.stage?.d, "🎤 Stage");
  // Your post office: the leaderboard's office i stands on lot i.
  const i = account && board?.list ? board.list.findIndex((o) => o.owner.toLowerCase() === account.toLowerCase()) : -1;
  if (i >= 0 && W.lots?.[i]) add(W.lots[i].d, "🏠 Your post office", "mine");
  return out;
}

/// Mars's places (mars-pick.js); its spaceport is at the top, where the rocket lands.
export function marsPlaces() {
  return [
    { d: vec([0, 1, 0]), name: "🚀 Spaceport", kind: "spot" },
    { d: vec(CITY.d), name: "Mars City", kind: "zone" },
    { d: vec(VOLCANO.d), name: "🌋 Volcano", kind: "spot" },
    { d: vec(ICE.d), name: "Ice cap", kind: "zone" },
    { d: vec(RADIO), name: "📻 Radio station", kind: "spot" },
    { d: vec(CANYON.c), name: "Canyon", kind: "zone" },
    ...(MOUNTAINS[0] ? [{ d: vec(MOUNTAINS[0].d), name: "Red Ridge", kind: "zone" }] : []),
  ];
}

/// The moon's: the rocket at the top.
export function moonPlaces() {
  return [{ d: vec([0, 1, 0]), name: "🚀 Rocket home", kind: "spot" }];
}

/// The labels and dots over the globe, in `root` (#map): `.map-labels` for the names and you, a canvas for everyone else.
export function createMapOverlay(root) {
  const layer = root.querySelector(".map-labels"), dots = root.querySelector(".map-dots"), g = dots.getContext("2d");
  let labels = [];
  const you = document.createElement("div");
  you.className = "map-you";
  you.innerHTML = `<i></i><span>You</span>`;
  layer.append(you);
  const p = new THREE.Vector3(), toCam = new THREE.Vector3(), n = new THREE.Vector3();
  /// Where direction `d` (in the ground's frame), `h` above its surface, is on screen, and how much it faces the camera
  /// (above 0: on the near side).
  function screen(d, h, { camera, ground, group, w, hgt }) {
    p.copy(d).multiplyScalar(ground.R + h).applyQuaternion(group.quaternion).add(ground.center);
    n.copy(p).sub(ground.center).normalize();
    const facing = n.dot(toCam.copy(camera.position).sub(p).normalize());
    p.project(camera);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * hgt, facing };
  }
  return {
    setPlaces(places) {
      for (const l of labels) l.el.remove();
      labels = places.map((pl) => {
        const el = document.createElement("div");
        el.className = `map-label ${pl.kind}`;
        el.textContent = pl.name;
        layer.append(el);
        return { ...pl, el };
      });
    },
    /// Every frame while the map shows: `me` { d, h }: you; `others`: everyone else's directions on this world.
    update(view, me, others) {
      const w = root.clientWidth, hgt = root.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
      const v = { ...view, w, hgt };
      for (const l of labels) {
        const s = screen(l.d, l.kind === "zone" ? 3 : 1.5, v);
        const show = s.facing > 0.12;
        l.el.style.opacity = show ? String(Math.min(1, (s.facing - 0.12) * 4)) : "0";
        if (show) l.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
      }
      const m = screen(me.d, me.h + 0.5, v);
      you.style.opacity = m.facing > 0.05 ? "1" : "0"; // (on the far side: spin the world to find yourself)
      you.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      if (dots.width !== Math.round(w * dpr) || dots.height !== Math.round(hgt * dpr)) {
        dots.width = Math.round(w * dpr);
        dots.height = Math.round(hgt * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hgt);
      g.lineWidth = 2;
      g.strokeStyle = "#283033";
      g.fillStyle = "#5ea9dd";
      for (const d of others) {
        const s = screen(d, 0.5, v);
        if (s.facing <= 0.05) continue;
        g.beginPath();
        g.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    },
  };
}
