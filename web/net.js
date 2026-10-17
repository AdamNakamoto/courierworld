// Other couriers on the planet, live. The game tells the multiplayer room who you are (your
// courier's look and ride, and your wallet address if you're logged in) and, while you move, where
// you are. Everyone else shows up as their own courier with a name tag, walking, jumping, swimming
// and waving as they do. Positions are just for show: nothing here is on-chain.
import * as THREE from "https://esm.sh/three@0.160.0";
import { R, arc, texFromCanvas } from "./world.js";
import { STEP } from "./terrain.js";
import { authMessage } from "./hunt-pick.js";
import { fishOf } from "./fish-kinds.js";
import { CAST_MS } from "./fish-rules.js";
import { WORLDS } from "./trips.js";
import { nameMessage, nameShown } from "./name-rules.js";
import { SKINS } from "./skins.js";
import { createFollower } from "./companions.js";
import { COMPANION_IDS } from "./companion-kinds.js";
import { CAR_IDS } from "./car-kinds.js";

/// What you can show the players around you: an emoji, or an emoji and a few words. It pops up
/// over your head (keys 1-9 and 0, or the emote buttons). The order matters: the room sends the index.
export const EMOTES = [
  { e: "😊" }, { e: "👋", t: "Hey!" }, { e: "🔥", t: "LFG!" }, { e: "🎉", t: "Have fun!" }, { e: "😂" },
  { e: "❤️" }, { e: "👍", t: "GG!" }, { e: "☀️", t: "gm!" }, { e: "🙏", t: "Thanks!" }, { e: "📮", t: "Follow me!" },
];
// Position updates are what the room is billed for (Cloudflare's free plan counts 20 incoming messages as one
// request, 100,000 a day), so they go out only when your movement changes (start, stop, turn, jump, swim), or every
// couple of seconds while you keep going the same way; everyone else's game carries you on in between, from the
// velocity and turn each update gives.
const MIN_GAP = 0.4; // seconds: the soonest a change goes out after the last update
const HEARTBEAT = 2.0; // seconds: while you keep moving the same way
const AHEAD = 2.5; // seconds: the longest anyone is carried on past their last update
const DRIFT = 0.5; // metres from where the others predict you before an update goes out early
const PING_EVERY = 45; // seconds: keeps the connection open (Cloudflare drops sockets quiet for 100 s)
const AWAY = 60_000; // ms: a tab hidden this long leaves the room (and comes back when it's shown again)
const SEEN = 22; // how far away (in metres) other couriers are drawn

const ENUMS = {
  hairStyle: ["pony", "bun", "bob", "twin", "long"],
  headwear: ["none", "cap", "bucket", "beanie", "headphones", "goggles", "hardhat"],
  bottomsStyle: ["shorts", "skirt", "pants"],
  bag: ["satchel", "backpack", "tote", "sack", "golden", "none"],
};
const COLOURS = ["skin", "hair", "shirt", "accent", "bottoms", "socks", "shoes"];
const RIDES = ["foot", "skate", "bike", "moped", "plane", "rover"];
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

/// A name tag: the player's name, short address or "Guest", and their post office tier under it.
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
  g.fillText(name, 128, sub ? 32 : 33, 236);
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

/// An emote's picture: a big emoji on its own, or an emoji and words in a bold bubble.
function emoteTexture({ e, t }) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const emojiFont = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  if (!t) {
    c.width = c.height = 192;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(40, 48, 51, 0.45)";
    g.shadowBlur = 10;
    g.shadowOffsetY = 4;
    g.font = `140px ${emojiFont}`;
    g.fillText(e, 96, 104);
  } else {
    c.width = 512;
    c.height = 160;
    g.font = "800 58px system-ui, -apple-system, sans-serif";
    const w = Math.min(500, g.measureText(t).width + 150), x = (512 - w) / 2;
    g.fillStyle = "#fbf8ef";
    g.strokeStyle = "#283033";
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(x, 10, w, 104, 30);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(236, 111);
    g.lineTo(256, 148);
    g.lineTo(278, 111);
    g.fill();
    g.stroke();
    g.fillRect(238, 102, 38, 12);
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.font = `64px ${emojiFont}`;
    g.fillText(e, x + 22, 64);
    g.fillStyle = "#283033";
    g.font = "800 58px system-ui, -apple-system, sans-serif";
    g.fillText(t, x + 108, 66);
  }
  return texFromCanvas(c);
}

const CHAT_FONT = '600 34px system-ui, -apple-system, "Segoe UI", "Noto Sans", "PingFang SC", "Hiragino Sans", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/// A chat line as a speech bubble: wrapped into at most three lines, any script. Returns the texture
/// and its size in metres.
function bubbleTexture(text) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  g.font = CHAT_FONT;
  const maxW = 440, lineH = 42;
  // Break between words where the language has spaces, between characters where it doesn't.
  const parts = typeof Intl !== "undefined" && Intl.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)].map((x) => x.segment)
    : text.split(/(\s+)/);
  const lines = [];
  let line = "";
  for (const part of parts) {
    if (g.measureText(line + part).width <= maxW) {
      line += part;
      continue;
    }
    if (line.trim()) lines.push(line.trim());
    line = "";
    for (const ch of part) {
      if (g.measureText(line + ch).width > maxW) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = lines[2].slice(0, -1) + "…";
  }
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 44;
  c.width = Math.ceil(w) + 12;
  c.height = lines.length * lineH + 54;
  const bh = lines.length * lineH + 24, x = 6, cx = c.width / 2;
  g.fillStyle = "#fbf8ef";
  g.strokeStyle = "#283033";
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(x, 4, c.width - 12, bh, 18);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(cx - 13, bh + 2);
  g.lineTo(cx, bh + 24);
  g.lineTo(cx + 14, bh + 2);
  g.fill();
  g.stroke();
  g.fillRect(cx - 12, bh - 4, 25, 8);
  g.fillStyle = "#283033";
  g.font = CHAT_FONT;
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText(l, cx, 16 + lineH / 2 + i * lineH));
  const k = 0.0045; // metres per pixel
  return { tex: texFromCanvas(c), w: c.width * k, h: c.height * k };
}

/// Emotes popping up over people's heads: a little pool of sprites that rise, then shrink away.
function createEmotes(world, noNormals) {
  const textures = EMOTES.map(emoteTexture);
  const pool = [];
  for (let i = 0; i < 12; i++) {
    // They write depth (see-through edges don't), so the painted sky isn't laid over them.
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.35 }));
    s.visible = false;
    s.scale.setScalar(0); // the outline pass turns sprites back on, so an idle one is also shrunk to nothing
    s.renderOrder = 3;
    world.add(s);
    noNormals.push(s);
    pool.push({ s, who: null, age: 0, life: 0, h: 2.4, w: 1, ht: 1, own: null });
  }
  /// The bubbles go where you are (the planet, or the moon's group).
  const onto = (group) => pool.forEach((b) => b.s.parent !== group && group.add(b.s));
  /// The sprite for `who`: theirs if they have one up, else a free one, else the oldest. A chat bubble's
  /// own texture is freed when its sprite is reused.
  function slot(who) {
    const b = pool.find((p) => p.who === who) ?? pool.find((p) => p.life <= 0) ?? pool.reduce((a, p) => (p.age > a.age ? p : a));
    b.own?.dispose();
    b.own = null;
    return b;
  }
  return {
    onto,
    show(who, i, h = 2.4) {
      const em = EMOTES[i];
      if (!em) return;
      const b = slot(who);
      b.s.material.map = textures[i];
      b.s.material.needsUpdate = true;
      [b.who, b.age, b.life, b.h] = [who, 0, 2.6, h];
      [b.w, b.ht] = em.t ? [2.2, 0.69] : [0.95, 0.95];
      b.s.visible = true;
    },
    /// A chat line over someone's head, up longer the longer it is.
    say(who, text, h = 2.4) {
      const b = slot(who);
      const { tex, w, h: ht } = bubbleTexture(text);
      b.own = tex;
      b.s.material.map = tex;
      b.s.material.needsUpdate = true;
      [b.who, b.age, b.life, b.h] = [who, 0, Math.min(9, 4 + [...text].length / 20), h];
      [b.w, b.ht] = [w, ht];
      b.s.visible = true;
    },
    update(dt) {
      for (const b of pool) {
        if (b.life <= 0) continue;
        b.age += dt;
        if (b.age >= b.life || !b.who) {
          b.life = 0;
          b.who = null;
          b.own?.dispose();
          b.own = null;
          b.s.visible = false;
          b.s.scale.setScalar(0);
          continue;
        }
        // Pop in with a bounce, drift up, shrink away at the end.
        const a = b.age, pop = a < 0.3 ? Math.sin((a / 0.3) * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1;
        const k = Math.max(0, pop * Math.min(1, (b.life - a) / 0.35));
        b.s.scale.set(b.w * k, b.ht * k, 1);
        const up = b.who.position.clone().normalize();
        b.s.position.copy(b.who.position).addScaledVector(up, b.h + Math.min(a, 1.2) * 0.35);
      }
    },
  };
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

/// A player's facing laid flat along the ground and made unit length, in `p.ahead` (their companion follows that way).
/// False if it can't be (facing straight up or down).
function along(p) {
  p.ahead.copy(p.fwd).addScaledVector(p.pos, -p.fwd.dot(p.pos));
  if (p.ahead.lengthSq() < 1e-8) return false;
  p.ahead.normalize();
  return true;
}

/// `url`: the room's WebSocket address. `makeRider(look, ride, rideColour)` builds a courier (the same as yours),
/// `dispose(group)` frees one, `onHunt(state)`, `onFound(day, spot, count, drop)` and `onNope(spot, why)` hear
/// from the treasure hunt, `onBonus(status)` hears how the companion bonus is going (bonus-rules.js: the room's
/// { on, day, minutes, max, kind, coins, why, lost, pool, paid }, or null on a new connection),
/// `tier(address)` names their post office tier (or null), `onCount(n)` hears how many are online
/// (null while not connected). Names: `nameToken(address)` is the token the room gave that wallet when
/// it picked its name (or null), and `onNamed(info)` hears the name the room shows you with ({ name,
/// wallet }, or null).
export function createNet(W, {
  url, makeRider, dispose, tier = () => null, onCount = () => {}, onHunt = () => {}, onFound = () => {}, onNope = () => {}, onBonus = () => {},
  onChat = () => {}, onChatHistory = () => {}, onChatError = () => {}, nameToken = () => null, onNamed = () => {},
  onFish = () => {}, onFishNews = () => {}, onPets = () => {}, onPetPat = () => {}, onPetSay = () => {}, allowSay = () => true,
  myBubble = () => 2.55, // how high your own bubbles go (over a car you're driving, they go over its roof)
  world = (w) => (w === "planet" ? { group: W.world, r: R, terrain: W.terrain } : null),
}) {
  const players = new Map(); // id -> { hello, root, rider, tag, follower, pos, fwd, target, h, air, spd, swim, wave }
  const anchor = new THREE.Object3D(); // where you are on the planet, for your own emotes
  W.world.add(anchor);
  const emotes = createEmotes(W.world, W.noNormals);
  let ws = null, me = null, started = false, retry = 1, since = 0, pingIn = 0, last = null, current = null;
  let away = null, asleep = false; // leaving the room while the tab is hidden; waiting to be shown to come back
  // Which world you're on ("planet", "moon" or "mars"): others are drawn only on yours. `world(w)` gives a world's
  // group and radius (null if it isn't built yet).
  let mine = "planet", ticketWait = null;
  /// Put a player (or your emote anchor) in their world's group.
  function home(obj, w) {
    const g = world(w);
    if (g && obj.parent !== g.group) g.group.add(obj);
  }
  const vel = new THREE.Vector3(), prevP = new THREE.Vector3(); // how fast you're going (smoothed), from frame to frame
  let turn = 0; // and how fast you're turning (radians a second, anticlockwise seen from above)
  let code = null, voucherWait = null; // the room's sign-in code for this connection; a pending voucher request
  let nameWait = null, checkWait = null; // a name being set, and a name being checked, waiting for the room
  let myId = null; // the room's name for you on this connection
  const grabs = []; // coins picked up this frame: sent right after where you are, so the room checks the spot
  // Fishing (web/fishing.js): a cast or a landing waiting for the room, and what's to send right after where you are.
  let castWait = null, landWait = null, fishVoucherWait = null;
  const fishOut = [];
  // Frenpet World: a pat waiting for the room's answer (it goes out right after where you are, like a cast).
  let patWait = null;

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
      if (mine !== "planet") send(["world", mine]); // (the room asks for the ticket again once you've signed in)
    };
    ws.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data));
      } catch (err) {
        if (e.data !== "pong") console.warn(err);
      }
    };
    ws.onclose = () => {
      for (const w of [castWait, landWait, fishVoucherWait, patWait]) w?.reject(new Error("Lost the connection to the other players. Try again in a moment."));
      castWait = landWait = fishVoucherWait = patWait = null;
      for (const id of [...players.keys()]) remove(id);
      count();
      later();
    };
  }
  function later() {
    // A hidden tab waits to be shown before it knocks again.
    if (document.hidden) return (asleep = true);
    // Back off (with a little jitter, so every game doesn't knock at once) when the room isn't answering.
    setTimeout(connect, retry * 1000 * (0.75 + Math.random() * 0.5));
    retry = Math.min(retry * 2, 120);
  }

  function label(hello) {
    const addr = /^0x[0-9a-fA-F]{40}$/.test(hello.addr ?? "") ? hello.addr : null;
    const name = nameShown(hello.name) ? hello.name : addr ? short(addr) : "Guest"; // (the room only sends names it checked)
    return nameTag(name, addr ? tier(addr) : null);
  }
  function add(id, hello, s, w = "planet") {
    const was = players.get(id)?.world;
    remove(id);
    const root = new THREE.Group();
    // A skin the room has checked is theirs (its design number); otherwise their courier's look. In a Courier Car the
    // room has checked is theirs, only the car shows.
    const skin = Number.isInteger(hello.skin) ? SKINS[hello.skin] : null;
    const car = Number.isInteger(hello.car) && CAR_IDS.includes(hello.car) ? hello.car : null;
    const rider = skin
      ? makeRider(skin.params, skin.ride ?? "foot", skin.rideColour, car)
      : makeRider(cleanLook(hello.look), RIDES.includes(hello.ride) ? hello.ride : "foot", null, car);
    const tag = label(hello);
    root.add(rider.group, tag);
    // Their Courier Companions, those the room has read on chain are theirs (a room from before several could follow
    // sends just one), in their slots behind them. (root sits at the world's centre, so the followers' coordinates are
    // the world's, as companions.js expects.)
    const kinds = [...new Set(Array.isArray(hello.companions) ? hello.companions : [hello.companion])].filter((k) => COMPANION_IDS.includes(k)).sort((a, b) => a - b);
    const followers = kinds.map(createFollower).filter(Boolean);
    followers.forEach((f, i) => {
      f.setSlot(i);
      root.add(f.group);
    });
    root.visible = false;
    W.noNormals.push(tag);
    const p = { hello, root, rider, tag, followers, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), target: null, placed: false, h: 0.04, air: 0, spd: 0, swim: 0, wave: 0,
      world: WORLDS.includes(w) ? w : w === undefined && was ? was : "planet" };
    // What their companion walks on: their world's ground where it is, measured from the ground under them (their
    // height less their jump) so it follows them up onto decks; or the water's surface. (Before their world is known,
    // just the ground under them.)
    p.groundAt = (d) => {
      const y = p.h - p.air, t = p.terrain;
      if (!t) return y;
      const floor = t.surfaceAt(d, y, STEP), water = t.waterAt(d);
      return water === null ? floor : Math.max(floor, water);
    };
    p.ahead = new THREE.Vector3(0, 0, 1); // the way they face, along the ground, for their companion
    home(root, p.world);
    players.set(id, p);
    if (s) apply(p, s);
  }
  /// How high over someone their bubbles and emotes go (over a tall car, higher).
  const bubbleAt = (p) => (p.rider.ride?.mount.tag ? p.rider.ride.mount.tag + 0.85 + p.swim * 0.9 : p.rider.ride ? 3.2 : 2.85); // (a car floats)
  function remove(id) {
    const p = players.get(id);
    if (!p) return;
    if (p.patting) patUp(p); // (the pet they were patting goes back to its day)
    p.root.parent?.remove(p.root);
    W.noNormals.splice(W.noNormals.indexOf(p.tag), 1);
    p.tag.material.map.dispose();
    p.tag.material.dispose();
    dispose(p.rider.group);
    for (const f of p.followers) f.dispose();
    players.delete(id);
  }
  /// A position update: where they are, and how fast they're going and turning (older games don't say), to
  /// predict them by.
  function apply(p, s) {
    const [x, y, z, fx, fy, fz, h, air, spd, swim, vx = 0, vy = 0, vz = 0, turn = 0] = s;
    const v = new THREE.Vector3(vx, vy, vz);
    const moving = spd > 0.05 && v.lengthSq() > 0 && v.length() * R < 30;
    p.target = { p: new THREE.Vector3(x, y, z).normalize(), f: new THREE.Vector3(fx, fy, fz), h, air, spd, swim, t: performance.now() / 1000,
      vel: moving ? v : null, turn: moving ? turn : 0 };
    if (p.fishing && (spd > 0.05 || performance.now() > p.fishUntil)) rodDown(p); // (walked off, or the cast ran out)
    if (p.patting && (spd > 0.05 || performance.now() > p.patUntil)) patUp(p); // (got up and walked off)
  }
  /// Someone gets up from patting a pet.
  function patUp(p) {
    const pet = p.patting;
    p.patting = null;
    p.rider?.ch.setPat?.(0);
    onPetPat(pet, false, p.id);
  }
  /// Someone's rod goes away.
  function rodDown(p) {
    p.fishing = false;
    p.rider?.ch.setFish?.(0, 0);
  }
  /// Where an update ({ p, f, vel, turn }) puts someone `secs` after it, and which way they face: carried on
  /// along the curve its velocity and turn make (for at most AHEAD).
  function carried(u, secs) {
    if (!u.vel) return u;
    const s = Math.min(secs, AHEAD), w = u.turn, up = u.p;
    const along = Math.abs(w) < 1e-3 ? s : Math.sin(w * s) / w, aside = Math.abs(w) < 1e-3 ? 0 : (1 - Math.cos(w * s)) / w;
    const p = u.p.clone().addScaledVector(u.vel, along).addScaledVector(up.clone().cross(u.vel), aside).normalize();
    const c = Math.cos(w * s), f = u.f.clone().multiplyScalar(c).addScaledVector(up.clone().cross(u.f), Math.sin(w * s)).addScaledVector(up, up.dot(u.f) * (1 - c));
    return { p, f };
  }
  /// Send where you are now (`stop`: as standing still).
  function sendState(s, stop = false) {
    const r = (v, k = 1e4) => Math.round(v * k) / k;
    const v = !stop && s.spd > 0.05 && vel.length() * R < 25 ? vel.clone() : null, w = v && Math.abs(turn) < 10 ? turn : 0;
    const spd = stop ? 0 : s.spd;
    send(["s", r(s.p.x, 1e5), r(s.p.y, 1e5), r(s.p.z, 1e5), r(s.f.x, 1e3), r(s.f.y, 1e3), r(s.f.z, 1e3),
      r(s.h, 1e3), r(s.air, 1e3), r(spd, 1e2), r(s.swim, 1e2), r(v?.x ?? 0, 1e5), r(v?.y ?? 0, 1e5), r(v?.z ?? 0, 1e5), r(w, 1e3)]);
    last = { p: s.p.clone(), f: s.f.clone(), h: s.h, spd, swim: s.swim, air: s.air, vel: v, turn: r(w, 1e3) };
    since = 0;
  }
  // A hidden tab stops playing (no frames, so no keep-alive either): tell the others you've stopped rather than
  // let them carry you on, and after a minute leave the room, instead of being dropped and knocking again in the
  // background (every new connection is a request to the room).
  document.addEventListener("visibilitychange", () => {
    clearTimeout(away);
    if (document.hidden) {
      if (current && last?.spd > 0.05 && ws?.readyState === 1 && me) sendState(current, true);
      send("ping"); // (so a short look away doesn't run into the 100 s limit)
      pingIn = PING_EVERY;
      away = setTimeout(() => document.hidden && ws?.close(), AWAY);
    } else if (asleep) {
      asleep = false;
      retry = 1;
      connect();
    }
  });

  /// A chat line from the room: [id, name, text, time] -> { id, name, text, time, mine }.
  function chatLine([id, name, text, time]) {
    return { id: String(id), name: String(name), text: String(text), time: Number(time), mine: id === myId };
  }

  function handle(m) {
    switch (m[0]) {
      case "welcome":
        for (const [id, hello, s, w] of m[2]) add(id, hello, s, w ?? "planet");
        code = m[3] ?? null;
        myId = m[1];
        onChatHistory((m[4] ?? []).map(chatLine));
        onHunt(null); // a new connection: sign in again to hunt (or pick up where you were, below)
        onFish(null); // (and to fish)
        onBonus(null); // (and the room says again how the bonus is going once you're back in)
        resumeHunt();
        sendName();
        break;
      case "hunttoken":
        // Lets this browser pick the hunt up again on a new connection, without signing again.
        try {
          if (m[1] && me?.addr) sessionStorage.setItem(`courier:hunt:${me.addr.toLowerCase()}`, m[1]);
        } catch {}
        return;
      case "ticketok":
        ticketWait?.resolve(Number(m[2]));
        ticketWait = null;
        return;
      case "here":
        // Everyone already on the world you've just come to, where they are.
        for (const [id, s] of m[1] ?? []) {
          const p = players.get(id);
          if (p) {
            p.world = mine;
            home(p.root, mine);
            apply(p, s);
          }
        }
        return;
      case "world": {
        const p = players.get(m[1]);
        if (!p) return;
        if (p.patting) patUp(p);
        p.world = WORLDS.includes(m[2]) ? m[2] : "planet";
        [p.target, p.placed] = [null, false];
        p.root.visible = false;
        home(p.root, p.world);
        return;
      }
      case "named":
        if (m[1]?.token && nameWait) nameWait.resolve(m[1]);
        else if (!m[1] || nameShown(m[1].name)) onNamed(m[1] ? { name: m[1].name, wallet: m[1].wallet } : null);
        if (m[1]?.token) nameWait = null;
        return;
      case "nameno":
        nameWait?.reject(new Error(m[1]));
        nameWait = null;
        return;
      case "namefree":
        checkWait?.({ free: !!m[2], why: m[3] ?? null });
        checkWait = null;
        return;
      case "hunt":
        onHunt(m[1]);
        return;
      case "bonus":
        onBonus(m[1] ?? null);
        return;
      case "found":
        onFound(m[1], m[2], m[3], m[4]); // (day, spot, that drop's finds today, the drop id)
        return;
      case "vouchers":
        // (The first drops contract's vouchers, then the second's: a game loaded before there were two only reads m[1].)
        voucherWait?.resolve([...(m[1] ?? []), ...(m[2] ?? [])]);
        voucherWait = null;
        return;
      case "fcast":
        castWait?.resolve({ id: m[1], biteIn: Number(m[2]) });
        castWait = null;
        return;
      case "fcaught":
        landWait?.resolve({ species: Number(m[1]), day: Number(m[2]), today: Number(m[3]), max: Number(m[4]) });
        landWait = null;
        return;
      case "fstate":
        onFish(m[1] ?? null);
        return;
      case "fvouchers":
        fishVoucherWait?.resolve(m[1]);
        fishVoucherWait = null;
        return;
      case "fishing": {
        // Someone near you casting (1), or done (0; with the species if they caught one).
        const p = players.get(m[1]);
        if (!p) return;
        if (m[2] === 1) {
          [p.fishing, p.fishUntil] = [true, performance.now() + CAST_MS + 5000];
          p.rider.ch.setFish?.(1, 0);
        } else rodDown(p);
        const k = m[3] != null ? fishOf(m[3])?.name : null;
        if (k && p.root.visible) emotes.say(p.rider.group, `🐟 ${k}!`, bubbleAt(p));
        return;
      }
      case "pat": {
        // Someone on Frenpet World sat down by a pet to pat it (they get up when they move off).
        const p = players.get(m[1]);
        if (!p || typeof m[2] !== "string") return;
        if (p.patting && p.patting !== m[2]) patUp(p);
        const again = p.patting === m[2];
        [p.patting, p.patUntil] = [m[2], performance.now() + 45_000];
        p.rider.ch.setPat?.(1);
        if (!again) onPetPat(m[2], true, p.id, p.target?.p?.clone() ?? null); // (where they are, for the pet to face)
        return;
      }
      case "petsay": {
        // Something someone said to a pet: over their head, and the pet answers (main.js).
        const p = players.get(m[1]);
        if (!p || typeof m[3] !== "string") return;
        // (Chat's rules for what you see: chat off, or that player muted, and it isn't shown.)
        if (!allowSay({ id: String(p.id), name: p.hello?.name ?? (p.hello?.addr ? `${p.hello.addr.slice(0, 6)}…${p.hello.addr.slice(-4)}` : "Guest") })) return;
        if (p.root.visible) emotes.say(p.rider.group, m[3], bubbleAt(p));
        onPetSay(m[2], m[3], p.id);
        return;
      }
      case "petok":
        // Your pat counted: that pet's friendship with you now, and whether it grew (once a UTC day).
        patWait?.resolve({ id: m[1], n: Number(m[2]) || 0, grew: !!m[3] });
        patWait = null;
        return;
      case "pets":
        onPets(m[1] && typeof m[1] === "object" ? m[1] : {});
        return;
      case "fishnews":
        // (The wallet that caught it, as the room checked it.)
        onFishNews(/^0x[0-9a-fA-F]{40}$/.test(m[3] ?? "") ? m[3] : null, Number(m[2]));
        return;
      case "nope":
        if (m[1] === -1 && voucherWait) {
          voucherWait.reject(new Error(m[2]));
          voucherWait = null;
        } else if (m[1] === -2) {
          ticketWait?.reject(new Error(m[2]));
          ticketWait = null;
        } else if (m[1] === -4 && (castWait || landWait)) {
          (castWait ?? landWait).reject(new Error(m[2]));
          castWait = landWait = null;
        } else if (m[1] === -5 && fishVoucherWait) {
          fishVoucherWait.reject(new Error(m[2]));
          fishVoucherWait = null;
        } else if (m[1] === -6 && patWait) {
          patWait.reject(new Error(m[2]));
          patWait = null;
        } else onNope(m[1], m[2]);
        return;
      case "join":
        add(m[1], m[2], null, "planet");
        break;
      case "look": {
        const p = players.get(m[1]);
        add(m[1], m[2], p?.target ? [...p.target.p.toArray(), ...p.target.f.toArray(), p.target.h, p.target.air, p.target.spd, p.target.swim] : null, p?.world);
        break;
      }
      case "chat":
        onChat(chatLine(m.slice(1)));
        return;
      case "chatno":
        onChatError(m[1]);
        return;
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
        if (m[2] >= 0 && p.root.visible) emotes.show(p.rider.group, m[2], bubbleAt(p)); // above the name tag
        return;
      }
    }
    count();
  }

  /// A request to the room that a reply (or a ["nope"]) settles; it gives up after 15 s.
  function fishAsk(start, waiting, clear) {
    if (ws?.readyState !== 1) return Promise.reject(new Error("Not connected to the other players. Try again in a moment."));
    return new Promise((resolve, reject) => {
      start(resolve, reject);
      setTimeout(() => {
        if (waiting()?.resolve === resolve) {
          clear();
          reject(new Error("The server didn't answer. Try again."));
        }
      }, 15_000);
    });
  }

  /// On a new connection, pick the hunt up again with the token the room gave this browser when you signed in.
  function resumeHunt() {
    let token = null;
    try {
      token = me?.addr ? sessionStorage.getItem(`courier:hunt:${me.addr.toLowerCase()}`) : null;
    } catch {}
    if (token) send(["resume", me.addr, token]);
  }

  /// Show your claimed name, if this wallet has one: the room checks the token it gave the wallet.
  function sendName() {
    const token = me?.addr ? nameToken(me.addr) : null;
    if (token) send(["name", token]);
    else onNamed(null);
  }

  return {
    /// Who you are: your courier's look and ride, your wallet address if logged in, the Courier Skin
    /// you're wearing (its token id) and the Courier Companion following you (its kind; the room shows
    /// either only if that wallet owns it). Joins the room the first time it's called; afterwards it tells
    /// everyone you've changed.
    hello(look, ride, addr, skinId = null, companions = [], carId = null) {
      const was = me?.addr;
      // (`companion`, the dearest of them, for a room from before several could follow.)
      const list = addr ? [...new Set(companions)].sort((a, b) => a - b) : [];
      me = { look, ride: ride ?? "foot", ...(addr ? { addr } : {}), ...(addr && skinId ? { skinId } : {}), ...(list.length ? { companions: list, companion: list[list.length - 1] } : {}),
        ...(addr && carId ? { carId } : {}) }; // (the Courier Car you're driving: the room checks it's yours)
      if (!started) {
        started = true;
        connect();
      } else {
        send(["hi", me]);
        if (addr !== was) sendName(); // a different wallet: its own name, if it has one
      }
    },
    /// Is `name` free? Resolves with { free, why } (free if the room doesn't answer: setName decides).
    checkName(name) {
      if (ws?.readyState !== 1) return Promise.resolve({ free: true, why: null });
      return new Promise((resolve) => {
        checkWait = resolve;
        send(["namecheck", name]);
        setTimeout(() => checkWait === resolve && ((checkWait = null), resolve({ free: true, why: null })), 5000);
      });
    },
    /// Take `name` for `wallet`, signing the room's message with `sign(message)`. Resolves with
    /// { name, wallet, token }.
    async setName(name, wallet, sign) {
      if (!code || ws?.readyState !== 1) throw new Error("Not connected to the other players yet. Try again in a moment.");
      const signature = await sign(nameMessage(wallet, name, code));
      return new Promise((resolve, reject) => {
        nameWait = { resolve, reject };
        send(["setname", name, wallet, signature]);
        setTimeout(() => {
          if (nameWait?.resolve === resolve) {
            nameWait = null;
            reject(new Error("The server didn't answer. Try again."));
          }
        }, 15_000);
      });
    },
    /// Stop using your name: show your wallet address again.
    unname: () => send(["unname"]),
    /// Wave (-1) or show one of EMOTES to the players around you (and over your own head).
    say(i) {
      send(["say", i]);
      if (i >= 0) emotes.show(anchor, i, myBubble());
    },
    /// Each frame: `state` is where you are ({ p, f, h, air, spd, swim }: your direction from the
    /// planet's centre, the way you face, height, jump, speed and swim), or null when not playing.
    /// `me` is your position for deciding who to draw; `all` draws everyone (the title screen).
    update(dt, t, state, mePos, all = false) {
      const r = world(mine)?.r ?? R;
      if (state) {
        anchor.position.copy(state.p).multiplyScalar(r + state.h);
        // Your velocity across the planet, smoothed over a few frames (and forgotten after a jump across it).
        if (current && dt > 0 && arc(state.p, prevP) < 3) {
          const before = vel.clone();
          vel.lerp(state.p.clone().sub(prevP).divideScalar(dt), 1 - Math.exp(-dt * 12));
          // How fast your heading turns, while you're going faster than half a metre a second.
          if (Math.min(before.length(), vel.length()) * R > 0.5) {
            const w = Math.atan2(state.p.dot(before.clone().cross(vel)), before.dot(vel)) / dt;
            turn += (w - turn) * (1 - Math.exp(-dt * 8));
          } else turn = 0;
        } else {
          vel.set(0, 0, 0);
          turn = 0;
        }
        prevP.copy(state.p);
      }
      current = state;
      emotes.update(dt);
      if (ws?.readyState === 1 && me) {
        if ((pingIn -= dt) <= 0) {
          send("ping");
          pingIn = PING_EVERY;
        }
        // Send where you are when your movement changes, or now and then while it keeps on (see HEARTBEAT).
        since += dt;
        if (state && (since >= MIN_GAP || grabs.length || fishOut.length)) {
          const moving = state.spd > 0.05;
          // Where the others' games put you now: your last update, carried on along the curve it gave.
          const seen = last && carried(last, since);
          const changed = !last || moving !== last.spd > 0.05 || (state.air > 0) !== (last.air > 0) || state.f.dot(seen.f) < 0.94 ||
            Math.abs(state.spd - last.spd) > 0.25 || Math.abs(state.h - last.h) > 0.25 || Math.abs(state.swim - last.swim) > 0.3 ||
            arc(state.p, seen.p) > DRIFT;
          if (changed || (moving && since >= HEARTBEAT) || grabs.length || fishOut.length) sendState(state);
          while (grabs.length) send(["grab", grabs.shift()]);
          while (fishOut.length) send(fishOut.shift());
        }
      }
      // Everyone else eases toward where they should be by now: their last update, carried on along the curve
      // it gave, so they glide between the updates they send.
      const nowS = performance.now() / 1000;
      for (const p of players.values()) {
        // Only those on your world (the moon's radius on the moon).
        const pw = p.world === mine ? world(p.world) : null;
        if (!p.target || !pw) {
          p.root.visible = false;
          continue;
        }
        const pr = pw.r, dist = (a, b) => pr * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
        p.terrain = pw.terrain;
        const k = 1 - Math.exp(-dt * 8);
        const goal = carried(p.target, nowS - p.target.t);
        let moved = 0;
        if (!p.placed || dist(p.pos, goal.p) > 6) {
          p.pos.copy(goal.p);
          p.fwd.copy(goal.f);
          p.h = p.target.h;
          p.placed = true;
          if (p.followers.length && along(p)) for (const f of p.followers) f.place(p.pos, p.ahead, pr, p.groundAt);
        } else {
          const before = p.pos.clone();
          p.pos.lerp(goal.p, k).normalize();
          moved = dist(before, p.pos);
          p.fwd.lerp(goal.f, 1 - Math.exp(-dt * 8));
          p.h += (p.target.h - p.h) * (1 - Math.exp(-dt * 9));
        }
        p.air += (p.target.air - p.air) * (1 - Math.exp(-dt * 12)); // (jumps arc instead of stepping)
        p.spd += (p.target.spd - p.spd) * k;
        p.swim += (p.target.swim - p.swim) * k;
        const shown = p.root.visible;
        p.root.visible = all || dist(p.pos, mePos) < SEEN;
        if (!p.root.visible) continue;
        // Their companions: snapped behind them as they come into view (they stood still while out of it), then
        // following.
        if (p.followers.length && along(p)) {
          const all = p.followers.length > 1 ? p.followers : null;
          for (const f of p.followers) {
            if (!shown) f.place(p.pos, p.ahead, pr, p.groundAt);
            f.update(dt, t, p.pos, p.ahead, pr, p.groundAt, Math.min(1, p.spd), all);
          }
        }
        p.rider.group.position.copy(p.pos).multiplyScalar(pr + p.h);
        orient(p.rider.group, p.pos, p.fwd);
        p.tag.position.copy(p.pos).multiplyScalar(pr + p.h + (p.rider.ride?.mount.tag ?? (p.rider.ride ? 2.35 : 2.05)) + (p.rider.car ? p.swim * 0.9 : 0));
        p.rider.update(dt, p.spd, t, Math.min(1, p.air * 4), moved);
        p.rider.ch.setSwim(p.swim);
        if (p.rider.car) p.rider.ride.group.position.y = p.swim * 0.9; // (a car floats)
        p.wave = Math.max(0, p.wave - dt);
        p.rider.ch.setWave(p.wave > 0 ? Math.min(1, p.wave * 3, (1.6 - p.wave) * 6) : 0);
      }
    },
    /// Send a chat line to everyone (checked again by the room). False if not connected.
    chat(text) {
      if (ws?.readyState !== 1) return false;
      send(["chat", text]);
      return true;
    },
    /// Show a chat line as a bubble over whoever said it, if they're in view (you included).
    bubble(id, text) {
      if (id === myId) return emotes.say(anchor, text, myBubble());
      const p = players.get(id);
      if (p?.root.visible) emotes.say(p.rider.group, text, bubbleAt(p));
    },
    /// The treasure hunt (the treasury's token drops): sign in with `wallet`, signing the room's message with
    /// `sign(message)`.
    async huntSignIn(wallet, sign) {
      if (!code || ws?.readyState !== 1) throw new Error("Not connected to the other players yet. Try again in a moment.");
      const signature = await sign(authMessage(wallet, code));
      send(["auth", wallet, signature]);
    },
    huntState: () => send(["hunt"]),
    /// You just picked up the coin at `spot`: ask the room to count it.
    grab: (spot) => grabs.push(spot),
    /// Show the room a ticket to `w` ("moon" or "mars"): the hash of the transaction that paid for it. Resolves with
    /// when it runs out.
    ticket(w, hash) {
      if (ws?.readyState !== 1) return Promise.reject(new Error("Not connected to the other players. Try again in a moment."));
      return new Promise((resolve, reject) => {
        ticketWait = { resolve, reject };
        send(["ticket", w, hash]);
        setTimeout(() => {
          if (ticketWait?.resolve === resolve) {
            ticketWait = null;
            reject(new Error("The server didn't answer. Try again."));
          }
        }, 30_000);
      });
    },
    /// Off to "moon" or "mars", or back to "planet": everyone there sees you, and you them.
    setWorld(w) {
      mine = w;
      home(anchor, w);
      const g = world(w);
      if (g) emotes.onto(g.group);
      for (const p of players.values()) {
        home(p.root, p.world);
        p.placed = false;
      }
      last = null; // (where you are goes out again, on the new world)
      send(["world", w]);
    },
    get world() { return mine; },
    /// Where everyone else on your world is (unit directions in its frame), for the map.
    others: () => [...players.values()].filter((p) => p.world === mine && p.target && p.placed).map((p) => p.pos),
    /// Fishing: cast (resolves with { id, biteIn }: when the bite comes, in ms), land the fish on cast `id` (resolves
    /// with { species, day, today, max }). Both go right after where you are, so the room checks the spot.
    fishCast() {
      return fishAsk((resolve, reject) => {
        castWait = { resolve, reject };
        fishOut.push(["fcast"]);
      }, () => castWait, () => (castWait = null));
    },
    fishLand(id) {
      return fishAsk((resolve, reject) => {
        landWait = { resolve, reject };
        fishOut.push(["fland", id]);
      }, () => landWait, () => (landWait = null));
    },
    fishState: () => send(["fstate"]),
    /// Frenpet World: pat pet `id` (the room checks you're by it, signed in and on a ticket). Resolves with that pet's
    /// friendship with you ({ id, n, grew }).
    pat(id) {
      return fishAsk((resolve, reject) => {
        patWait = { resolve, reject };
        fishOut.push(["pat", id]);
      }, () => patWait, () => (patWait = null));
    },
    /// Say something to pet `id` (everyone on Frenpet World near you sees it over your head).
    petSay(id, text) {
      send(["petsay", id, text]);
      emotes.say(anchor, text, myBubble());
    },
    /// Signed vouchers for each day's catch still in the mint window, for CourierFish.mintMany.
    fishVouchers() {
      return fishAsk((resolve, reject) => {
        fishVoucherWait = { resolve, reject };
        send(["fvouchers"]);
      }, () => fishVoucherWait, () => (fishVoucherWait = null));
    },
    /// Signed vouchers for each drop's finds (today's and yesterday's), to claim with TokenDrops.claimMany.
    vouchers() {
      if (ws?.readyState !== 1) return Promise.reject(new Error("Not connected to the other players. Try again in a moment."));
      return new Promise((resolve, reject) => {
        voucherWait = { resolve, reject };
        send(["vouchers"]);
        setTimeout(() => {
          if (voucherWait?.resolve === resolve) {
            voucherWait = null;
            reject(new Error("The server didn't answer. Try again."));
          }
        }, 10_000);
      });
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
