// Other couriers on the planet, live. The game tells the multiplayer room who you are (your
// courier's look and ride, and your wallet address if you're logged in) and, while you move, where
// you are. Everyone else shows up as their own courier with a name tag, walking, jumping, swimming
// and waving as they do. Positions are just for show: nothing here is on-chain.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, arc, texFromCanvas } from "./world.js";

/// What you can say to the players around you (keys 1-8, or the chat button).
export const PHRASES = ["gm!", "Hi!", "Nice!", "Follow me!", "Race you!", "GG!", "Thanks!", "Wow!"];
const SEND_EVERY = 0.15; // seconds between position updates while you move
const SEEN = 22; // how far away (in metres) other couriers are drawn

const ENUMS = {
  hairStyle: ["pony", "bun", "bob", "twin", "long"],
  headwear: ["none", "cap", "bucket", "beanie", "headphones", "goggles", "hardhat"],
  bottomsStyle: ["shorts", "skirt", "pants"],
  bag: ["satchel", "backpack", "tote", "sack", "golden", "none"],
};
const COLOURS = ["skin", "hair", "shirt", "accent", "bottoms", "socks", "shoes"];
const RIDES = ["foot", "skate", "bike", "moped", "plane"];
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// A look someone else sent, kept to the keys and values the character builder knows.
function cleanLook(src = {}) {
  const look = {};
  for (const k of COLOURS) {
    const v = src[k];
    if (Number.isInteger(v) && v >= 0 && v <= 0xffffff) look[k] = v;
    else if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) look[k] = parseInt(v.slice(1), 16);
  }
  for (const [k, ok] of Object.entries(ENUMS)) if (ok.includes(src[k])) look[k] = src[k];
  if (typeof src.height === "number" && src.height >= 0.85 && src.height <= 1.1) look.height = src.height;
  return look;
}

/// A name tag: the player's short address (or "Guest"), and their post office tier under it.
function nameTag(name, sub) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = sub ? 92 : 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(251, 248, 239, 0.92)";
  g.strokeStyle = "#283033";
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(4, 4, 248, c.height - 8, 14);
  g.fill();
  g.stroke();
  g.fillStyle = "#283033";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 30px ui-monospace, Menlo, monospace";
  g.fillText(name, 128, sub ? 32 : 33);
  if (sub) {
    g.font = "400 24px Bungee, Impact, sans-serif";
    g.fillStyle = "#b4443c";
    g.fillText(sub, 128, 66);
  }
  // It writes depth (its see-through corners don't), so the painted sky isn't laid over it.
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFromCanvas(c), transparent: true, alphaTest: 0.5 }));
  s.scale.set(1.25, (1.25 * c.height) / 256, 1);
  s.renderOrder = 2;
  return s;
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _z = new THREE.Vector3();
/// Point an object up `up` (its local +y) and facing `forward` (its local +z).
function orient(obj, up, forward) {
  _z.copy(forward).addScaledVector(up, -forward.dot(up));
  if (_z.lengthSq() < 1e-8) return;
  _z.normalize();
  _x.crossVectors(up, _z).normalize();
  _m.makeBasis(_x, up, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

/// `url`: the room's WebSocket address. `makeRider(look, ride)` builds a courier (the same as yours),
/// `dispose(group)` frees one, `say(obj, text, h)` pops a speech bubble over something on the planet,
/// `tier(address)` names their post office tier (or null), `onCount(n)` hears how many are online
/// (null while not connected).
export function createNet(W, { url, makeRider, dispose, say, tier = () => null, onCount = () => {} }) {
  const players = new Map(); // id -> { hello, root, rider, tag, pos, fwd, target, h, air, spd, swim, wave }
  const anchor = new THREE.Object3D(); // where you are on the planet, for your own speech bubbles
  W.world.add(anchor);
  let ws = null, me = null, started = false, retry = 1, sendIn = 0, pingIn = 0, last = null;

  const count = () => onCount(ws?.readyState === 1 && me ? players.size + 1 : null);
  const send = (m) => {
    if (ws?.readyState === 1) ws.send(typeof m === "string" ? m : JSON.stringify(m));
  };

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch {
      return later();
    }
    ws.onopen = () => {
      retry = 1;
      last = null;
      if (me) send(["hi", me]);
    };
    ws.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data));
      } catch (err) {
        if (e.data !== "pong") console.warn(err);
      }
    };
    ws.onclose = () => {
      for (const id of [...players.keys()]) remove(id);
      count();
      later();
    };
  }
  function later() {
    setTimeout(connect, retry * 1000);
    retry = Math.min(retry * 2, 30);
  }

  function label(hello) {
    const addr = /^0x[0-9a-fA-F]{40}$/.test(hello.addr ?? "") ? hello.addr : null;
    return nameTag(addr ? short(addr) : "Guest", addr ? tier(addr) : null);
  }
  function add(id, hello, s) {
    remove(id);
    const root = new THREE.Group();
    const rider = makeRider(cleanLook(hello.look), RIDES.includes(hello.ride) ? hello.ride : "foot");
    const tag = label(hello);
    root.add(rider.group, tag);
    root.visible = false;
    W.world.add(root);
    W.noNormals.push(tag);
    const p = { hello, root, rider, tag, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), target: null, placed: false, h: 0.04, air: 0, spd: 0, swim: 0, wave: 0 };
    players.set(id, p);
    if (s) apply(p, s);
  }
  function remove(id) {
    const p = players.get(id);
    if (!p) return;
    W.world.remove(p.root);
    W.noNormals.splice(W.noNormals.indexOf(p.tag), 1);
    p.tag.material.map.dispose();
    p.tag.material.dispose();
    dispose(p.rider.group);
    players.delete(id);
  }
  function apply(p, s) {
    const [x, y, z, fx, fy, fz, h, air, spd, swim] = s;
    p.target = { p: new THREE.Vector3(x, y, z).normalize(), f: new THREE.Vector3(fx, fy, fz), h, air, spd, swim };
  }

  function handle(m) {
    switch (m[0]) {
      case "welcome":
        for (const [id, hello, s] of m[2]) add(id, hello, s);
        break;
      case "join":
        add(m[1], m[2], null);
        break;
      case "look": {
        const p = players.get(m[1]);
        add(m[1], m[2], p?.target ? [...p.target.p.toArray(), ...p.target.f.toArray(), p.target.h, p.target.air, p.target.spd, p.target.swim] : null);
        break;
      }
      case "leave":
        remove(m[1]);
        break;
      case "s": {
        const p = players.get(m[1]);
        if (p) apply(p, m.slice(2));
        return;
      }
      case "say": {
        const p = players.get(m[1]);
        if (!p) return;
        p.wave = 1.6;
        if (m[2] >= 0 && p.root.visible) say(p.rider.group, PHRASES[m[2]] ?? "Hi!", 2.55);
        return;
      }
    }
    count();
  }

  return {
    /// Who you are: your courier's look and ride, and your wallet address if logged in. Joins the
    /// room the first time it's called; afterwards it tells everyone you've changed.
    hello(look, ride, addr) {
      me = { look, ride: ride ?? "foot", ...(addr ? { addr } : {}) };
      if (!started) {
        started = true;
        connect();
      } else {
        send(["hi", me]);
      }
    },
    /// Wave (-1) or say one of PHRASES to the players around you.
    say(i) {
      send(["say", i]);
      if (i >= 0) say(anchor, PHRASES[i], 2.55);
    },
    /// Each frame: `state` is where you are ({ p, f, h, air, spd, swim }: your direction from the
    /// planet's centre, the way you face, height, jump, speed and swim), or null when not playing.
    /// `me` is your position for deciding who to draw; `all` draws everyone (the title screen).
    update(dt, t, state, mePos, all = false) {
      if (state) anchor.position.copy(state.p).multiplyScalar(R + state.h);
      if (ws?.readyState === 1 && me) {
        if ((pingIn -= dt) <= 0) {
          send("ping");
          pingIn = 20;
        }
        // Send where you are while it's changing (and once more when you stop).
        if (state && (sendIn -= dt) <= 0) {
          const moved = !last || arc(state.p, last.p) > 0.02 || state.f.dot(last.f) < 0.995 || Math.abs(state.h - last.h) > 0.03 ||
            Math.abs(state.spd - last.spd) > 0.05 || Math.abs(state.swim - last.swim) > 0.1 || (state.air > 0) !== (last.air > 0);
          if (moved) {
            const r = (v, k = 1e4) => Math.round(v * k) / k;
            send(["s", r(state.p.x, 1e5), r(state.p.y, 1e5), r(state.p.z, 1e5), r(state.f.x, 1e3), r(state.f.y, 1e3), r(state.f.z, 1e3),
              r(state.h, 1e3), r(state.air, 1e3), r(state.spd, 1e2), r(state.swim, 1e2)]);
            last = { p: state.p.clone(), f: state.f.clone(), h: state.h, spd: state.spd, swim: state.swim, air: state.air };
            sendIn = SEND_EVERY;
          }
        }
      }
      // Everyone else eases toward where they last said they were.
      for (const p of players.values()) {
        if (!p.target) continue;
        const k = 1 - Math.exp(-dt * 10);
        let moved = 0;
        if (!p.placed || arc(p.pos, p.target.p) > 6) {
          p.pos.copy(p.target.p);
          p.fwd.copy(p.target.f);
          p.h = p.target.h;
          p.placed = true;
        } else {
          const before = p.pos.clone();
          p.pos.lerp(p.target.p, k).normalize();
          moved = arc(before, p.pos);
          p.fwd.lerp(p.target.f, 1 - Math.exp(-dt * 12));
          p.h += (p.target.h - p.h) * (1 - Math.exp(-dt * 14));
        }
        p.air = p.target.air;
        p.spd += (p.target.spd - p.spd) * k;
        p.swim += (p.target.swim - p.swim) * k;
        p.root.visible = all || arc(p.pos, mePos) < SEEN;
        if (!p.root.visible) continue;
        p.rider.group.position.copy(p.pos).multiplyScalar(R + p.h);
        orient(p.rider.group, p.pos, p.fwd);
        p.tag.position.copy(p.pos).multiplyScalar(R + p.h + (p.rider.ride ? 2.35 : 2.05));
        p.rider.update(dt, p.spd, t, Math.min(1, p.air * 4), moved);
        p.rider.ch.setSwim(p.swim);
        p.wave = Math.max(0, p.wave - dt);
        p.rider.ch.setWave(p.wave > 0 ? Math.min(1, p.wave * 3, (1.6 - p.wave) * 6) : 0);
      }
    },
    /// Redraw the name tags (after the leaderboard changes, so tiers stay current).
    retag() {
      for (const p of players.values()) {
        const old = p.tag;
        p.tag = label(p.hello);
        p.tag.position.copy(old.position);
        p.root.remove(old);
        p.root.add(p.tag);
        W.noNormals.splice(W.noNormals.indexOf(old), 1, p.tag);
        old.material.map.dispose();
        old.material.dispose();
      }
    },
    get online() {
      return ws?.readyState === 1 && me ? players.size + 1 : null;
    },
  };
}
