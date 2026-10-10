import * as THREE from "https://esm.sh/three@0.160.0";
import { createWorld, R, UP, arc, texFromCanvas } from "./world.js";
import { SEA_LEVEL, STEP } from "./terrain.js";
import { createCharacter, COURIER } from "./character.js";
import { createRide } from "./rides.js";
import { courier } from "./traits.js";
import { connectChain, explain } from "./chain.js";
import { createMusic } from "./music.js";
import { createAmbience } from "./ambience.js";
import { createOffice } from "./office.js";
import { createDust } from "./fx.js";
import { createLife } from "./life.js";
import { createStamps, STAMPS } from "./stamps.js";

const $ = (id) => document.getElementById(id);
const W = createWorld($("c"));
const { scene, camera, world } = W;

// ---------------------------------------------------------------- words

const NAMES = [
  "Hana", "Mr. Oda", "Grandpa Ren", "Mika", "Sora", "Old Kenji", "Aiko", "Taro", "Yui", "Mrs. Mori",
  "Daichi", "Emi", "Prof. Sato", "Kaito", "Nana", "Mr. Ishii", "Rin", "Haru", "Auntie Fumi", "Jun",
];
const THANKS = [
  "A letter from my daughter! She never writes. Thank you!",
  "Finally, the seeds I ordered. Spring can start now.",
  "You're out early. Tea? ...No? Next time, then.",
  "Is that for me? It is! How exciting.",
  "Bills again... well, thank you anyway.",
  "My pen pal from the other side of the planet! You're a star.",
  "Careful on the hill road, the wind picks up there.",
  "Oh, the concert tickets! I owe you one.",
  "Thank you. Mind the cat on the wall, she bites.",
  "A postcard from the sea. I can almost smell it.",
  "You walked all this way? The planet's small, but still.",
  "Ah, my glasses came back from the repair shop. Wonderful.",
];
const POSTMASTER = [
  "Morning! Three more letters for the neighbourhood.",
  "Back already? Here's the next bundle.",
  "The town's chatty today. Off you go!",
  "Three more. One of them smells like curry.",
];
const INTRO = [
  { name: "You", text: "Overslept again... the post office opened ages ago." },
  { name: "You", text: "Three letters in the bag. Better get walking." },
  { name: "Tip", text: "WASD or arrow keys to walk, Shift to run, Space to jump, E to talk or wave, drag to look around. Follow the arrow at the top." },
];

// ---------------------------------------------------------------- characters

/// A courier and (optionally) their ride, as one group facing +z.
function rider(params, rideKey = "foot") {
  const group = new THREE.Group();
  const ch = createCharacter(params);
  const ride = rideKey === "foot" ? null : createRide(rideKey, params.accent);
  if (ride) {
    group.add(ride.group);
    ch.root.position.set(0, ride.mount.y, ride.mount.z);
    ch.setPose(ride.mount.pose);
  }
  group.add(ch.root);
  return {
    group, ch, ride,
    kind: ride ? rideKey : null,
    speed: ride ? ride.mount.speed : 1,
    /// Returns true on the frame a foot comes down.
    update(dt, moving, t, air = 0, dist = null) {
      ride?.update(dt, moving, t);
      if (ride) ch.root.position.y = ride.riderY(t);
      return ch.update(dt, ride ? (ride.mount.pedal ? moving : 0) : moving, t, air, ride ? null : dist);
    },
  };
}
function dispose(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (!o.material.userData.shared) o.material.dispose();
      if (o.isSkinnedMesh) o.skeleton.dispose();
    }
  });
}

// The courier you play as: the default look until you pick one of your NFTs.
let player = rider(COURIER);
player.group.position.set(0, R, 0);
scene.add(player.group);
let playingId = null;
let playingAccount = null;
function setPlayer(r) {
  const prev = player.group;
  player = r;
  player.group.position.copy(prev.position);
  player.group.rotation.copy(prev.rotation);
  scene.remove(prev);
  dispose(prev);
  scene.add(player.group);
}
function playAs(c, account) {
  playingId = c.id;
  setPlayer(rider(c.params, c.ride.key));
  try {
    if (account) localStorage.setItem(`courier:avatar:${account.toLowerCase()}`, String(c.id));
  } catch {}
}
/// After login, play as one of your couriers: last time's pick, else one on duty, else the first.
function autoAvatar(s) {
  const owned = s?.account && s.seed !== 0n ? s.mine ?? [] : [];
  if (playingId !== null && s?.account === playingAccount && owned.some((m) => m.id === playingId)) return;
  playingAccount = s?.account ?? null;
  if (!owned.length) {
    if (playingId !== null) {
      playingId = null;
      setPlayer(rider(COURIER));
    }
    return;
  }
  let saved = null;
  try {
    saved = Number(localStorage.getItem(`courier:avatar:${s.account.toLowerCase()}`));
  } catch {}
  const pick = owned.find((m) => m.id === saved) ?? owned.find((m) => m.onDuty) ?? owned[0];
  playAs(courier(pick.id, s.seed), s.account);
}

W.addresses.forEach((a, i) => {
  if (!a.landmark) a.name = NAMES[i % NAMES.length];
  a.no = i + 1;
});

const dust = createDust(world, W.noNormals);
const splash = createDust(world, W.noNormals, 30, 0xeef8f6);
/// Water kicked up round the courier's feet (and a splash sound).
function splashAt(size, n) {
  world.updateMatrixWorld();
  const at = world.worldToLocal(player.group.position.clone());
  at.setLength(R + SEA_LEVEL + 0.02);
  splash.puff(at, at.clone().normalize(), { n, size, spread: 1.1, life: 0.45 });
  sounds.splash(n > 2 ? 1 : 0.5);
}
/// Kick up dust at the courier's feet (it stays put on the ground as they move on).
function kick(opts) {
  world.updateMatrixWorld();
  const at = world.worldToLocal(player.group.position.clone());
  dust.puff(at, at.clone().normalize(), opts);
}

// Residents by their doors and out walking, birds, cats, butterflies and fireflies.
const life = createLife(W, { onFlutter: () => sounds.flutter(), onMeow: () => sounds.meow() });
// Golden stamps to find, and the sparkle when you do.
const stamps = createStamps(W);
const sparkle = createDust(world, W.noNormals, 24, 0xffd75e);
function collected(s) {
  sounds.collect();
  sparkle.puff(s.mesh.position, s.d, { n: 14, size: 0.24, spread: 1.8, life: 0.7 });
  hud();
  toast(stamps.found === STAMPS ? "Every golden stamp on the planet!" : `Golden stamp! ${stamps.found} of ${STAMPS}`);
  if (stamps.found === STAMPS) say([{ name: "You", text: "That's all fifteen golden stamps. The whole planet, done!" }]);
}

// ---------------------------------------------------------------- envelope markers

const ENVELOPE = (() => {
  const c = document.createElement("canvas"); c.width = 128; c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#fbf8ef"; g.strokeStyle = "#283033"; g.lineWidth = 7;
  g.fillRect(8, 12, 112, 72); g.strokeRect(8, 12, 112, 72);
  g.beginPath(); g.moveTo(8, 12); g.lineTo(64, 54); g.lineTo(120, 12); g.stroke();
  g.fillStyle = "#d9534a"; g.beginPath(); g.arc(64, 54, 10, 0, 7); g.fill();
  return texFromCanvas(c);
})();
const markers = new Map(); // address index -> sprite
function showMarker(i) {
  const a = W.addresses[i];
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ENVELOPE, alphaTest: 0.5 }));
  s.scale.set(0.95, 0.72, 1);
  s.userData.base = a.markerDir.clone().multiplyScalar(R + a.markerH);
  s.userData.up = a.markerDir.clone();
  s.position.copy(s.userData.base);
  world.add(s);
  W.noNormals.push(s);
  markers.set(i, s);
}
function hideMarker(i) {
  const s = markers.get(i);
  if (!s) return;
  world.remove(s);
  W.noNormals.splice(W.noNormals.indexOf(s), 1);
  s.material.dispose();
  markers.delete(i);
}

// ---------------------------------------------------------------- dialog

let dialog = null; // { lines, i, chars, onDone }
function say(lines, onDone) {
  dialog = { lines, i: 0, chars: 0, onDone };
  $("dialog").hidden = false;
  drawDialog();
}
function drawDialog() {
  const line = dialog.lines[dialog.i];
  $("dname").textContent = line.name;
  $("dtext").textContent = line.text.slice(0, Math.floor(dialog.chars));
  $("dname").classList.toggle("you", line.name === "You" || line.name === "Tip");
}
function advance() {
  if (!dialog) return;
  const line = dialog.lines[dialog.i];
  if (dialog.chars < line.text.length) {
    dialog.chars = line.text.length;
  } else if (++dialog.i >= dialog.lines.length) {
    const done = dialog.onDone;
    dialog = null;
    $("dialog").hidden = true;
    done?.();
    return;
  } else {
    dialog.chars = 0;
  }
  drawDialog();
}
$("dialog").addEventListener("click", advance);

// ---------------------------------------------------------------- deliveries

let bag = [];
let delivered = 0;
try { delivered = Number(localStorage.getItem("courier:delivered")) || 0; } catch {}
const random = (n) => Math.floor(Math.random() * n);

function fillBag() {
  const picks = new Set();
  while (picks.size < Math.min(3, W.addresses.length)) picks.add(random(W.addresses.length));
  bag = [...picks];
  bag.forEach(showMarker);
  hud();
}
function deliver(i) {
  const a = W.addresses[i];
  bag = bag.filter((b) => b !== i);
  hideMarker(i);
  delivered++;
  sounds.chime();
  try { localStorage.setItem("courier:delivered", String(delivered)); } catch {}
  hud();
  const lines = [{ name: a.name, text: THANKS[random(THANKS.length)] }];
  if (!bag.length) lines.push({ name: "You", text: "That's the bag empty. Back to the post office for more." });
  say(lines);
}
function hud() {
  $("bagN").textContent = bag.length;
  $("doneN").textContent = delivered;
  $("stampN").textContent = `${stamps.found}/${STAMPS}`;
}

// ---------------------------------------------------------------- input

const music = createMusic();
const sounds = createAmbience();
function audioButtons() {
  for (const [id, a, name, key] of [["musicBtn", music, "Music", "M"], ["soundsBtn", sounds, "Sounds", "N"]]) {
    $(id).classList.toggle("off", !a.enabled);
    $(id).setAttribute("aria-pressed", String(a.enabled));
    $(id).title = `${name} ${a.enabled ? "on" : "off"} (${key})`;
  }
}
audioButtons();
$("musicBtn").addEventListener("click", () => {
  music.toggle();
  audioButtons();
});
$("soundsBtn").addEventListener("click", () => {
  sounds.toggle();
  audioButtons();
});

const keys = new Set();
const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
addEventListener("keydown", (e) => {
  if (typing(e)) return;
  if (e.key.toLowerCase() === "p" && office && mode === "play") {
    office.show($("office").hidden);
    return;
  }
  if ((e.key.toLowerCase() === "m" || e.key.toLowerCase() === "n") && mode !== "title") {
    (e.key.toLowerCase() === "m" ? music : sounds).toggle();
    audioButtons();
    return;
  }
  if (dialog && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    advance();
    return;
  }
  if (e.key.toLowerCase() === "e" && mode === "play" && !dialog) {
    if (!e.repeat) interact();
    return;
  }
  if (e.key === " " && mode === "play") {
    e.preventDefault();
    if (!e.repeat) jump();
    return;
  }
  keys.add(e.key.toLowerCase());
  if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

let pitch = 0.56, dist = 8;
const canvas = $("c");
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "play") return;
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag = { x: e.clientX, y: e.clientY };
  yaw(-dx * 0.006);
  pitch = Math.min(0.95, Math.max(0.06, pitch + dy * 0.004));
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  dist = Math.min(12, Math.max(4.5, dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });

const joy = { x: 0, y: 0, id: null };
{
  const pad = $("joy"), knob = $("knob");
  const move = (e) => {
    const r = pad.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    joy.x = x; joy.y = y;
    knob.style.transform = `translate(${x * 36}px, ${y * 36}px)`;
  };
  pad.addEventListener("pointerdown", (e) => { joy.id = e.pointerId; pad.setPointerCapture(e.pointerId); move(e); });
  pad.addEventListener("pointermove", (e) => { if (e.pointerId === joy.id) move(e); });
  const end = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; knob.style.transform = ""; };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  if (matchMedia("(pointer: coarse)").matches) {
    pad.hidden = false;
    $("jumpBtn").hidden = false;
    $("talkBtn").hidden = false;
    $("help").textContent = "Drag the stick to walk · Jump to hop · Hi to talk or wave · drag the world to look";
  }
  $("jumpBtn").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    jump();
  });
  $("talkBtn").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (mode === "play" && !dialog) interact();
  });
}

// ---------------------------------------------------------------- movement

const SPEED = 3.1, RUN = 5.8, BODY_R = 0.3;
// playerQ turns the planet so the courier stands on top with the camera behind them: it's where they
// really are. The view (world.quaternion) eases after it, so the camera follows with a little give
// instead of being bolted to the courier.
const playerQ = new THREE.Quaternion();
const vel = new THREE.Vector2(); // x: to the camera's right, y: away from it; units per second
let facing = 0; // where the courier faces, relative to the camera; 0 = away from it
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ORIGIN2 = new THREE.Vector2();

/// Turn the camera about the courier (the planet turns under them).
function yaw(phi) {
  playerQ.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, phi));
  facing = wrap(facing - phi);
  vel.rotateAround(ORIGIN2, phi);
}
function localPos() {
  return UP.clone().applyQuaternion(playerQ.clone().invert());
}
/// Whether an obstacle stops you at height y here (railings only up on the deck, cliffs only below
/// their top, and never on the stairs cut into them).
const solidAt = (o, p, y) => !((o.y1 !== undefined && y >= o.y1) || (o.y0 !== undefined && y < o.y0) || (o.except && W.terrain.inRamp(o.except, p, 0.2) !== null));
/// Push a spot on the planet (a unit vector) out of anything solid at height y, so you slide along walls.
function pushOut(p, y = bodyY) {
  const v = new THREE.Vector3();
  for (let pass = 0; pass < 2; pass++) {
    for (const o of W.obstacles) {
      if (p.dot(o.d) < o.cos || !solidAt(o, p, y)) continue;
      if (o.kind === "circle") {
        const gap = arc(p, o.d) - (o.r + BODY_R);
        if (gap >= 0) continue;
        v.subVectors(p, o.d);
        v.addScaledVector(p, -v.dot(p));
        if (v.lengthSq() < 1e-12) continue;
        p.addScaledVector(v.normalize(), -gap / R).normalize();
      } else {
        v.subVectors(p, o.d).multiplyScalar(R);
        const x = v.dot(o.right), z = v.dot(o.front);
        const ex = o.hw + BODY_R - Math.abs(x), ez = o.hd + BODY_R - Math.abs(z);
        if (ex <= 0 || ez <= 0) continue;
        if (ex < ez) p.addScaledVector(o.right, ((Math.sign(x) || 1) * ex) / R);
        else p.addScaledVector(o.front, ((Math.sign(z) || 1) * ez) / R);
        p.normalize();
      }
    }
    for (const b of life.bodies) {
      const gap = arc(p, b.d) - (b.r + BODY_R);
      if (gap >= 0 || b.d.dot(p) < 0.99 || Math.abs((b.y ?? 0) - y) > 1.2) continue;
      v.subVectors(p, b.d);
      v.addScaledVector(p, -v.dot(p));
      if (v.lengthSq() < 1e-12) continue;
      p.addScaledVector(v.normalize(), -gap / R).normalize();
    }
  }
  return p;
}
/// Talk to whoever is close by, or wave if nobody is.
let waveT = 0;
function interact() {
  const me = localPos();
  const who = life.nearest(me, 2.4, bodyY);
  if (!who) {
    waveT = 1.6;
    life.waveBack(me);
    return;
  }
  // Turn to face them.
  const v = who.up.clone().applyQuaternion(playerQ);
  facing = Math.atan2(v.x, -v.z);
  facingCamera = false;
  life.talking(who, true);
  say([{ name: who.name, text: life.chat(who, { night: W.night, rain: weather.rain }) }], () => life.talking(who, false));
}
/// Move by the velocity for dt, sliding along anything in the way. Returns the distance covered.
function step(dt) {
  if (vel.lengthSq() < 1e-8) return 0;
  const inv = playerQ.clone().invert();
  const from = UP.clone().applyQuaternion(inv);
  // The step in the camera's frame at the top of the planet (forward is -z), then onto the planet.
  const d = new THREE.Vector3(vel.x, 0, -vel.y).multiplyScalar(dt / R).applyQuaternion(inv);
  const want = from.clone().add(d).normalize();
  const to = pushOut(want.clone());
  const push = to.clone().sub(want);
  if (push.lengthSq() > 1e-14) {
    // Lose the part of the velocity that runs into the wall; keep the part along it.
    push.applyQuaternion(playerQ);
    const n = new THREE.Vector2(push.x, -push.z).normalize();
    const into = vel.dot(n);
    if (into < 0) vel.addScaledVector(n, -into);
  }
  // Roll the planet the shortest way to bring the new spot to the top (the camera keeps its heading).
  playerQ.premultiply(new THREE.Quaternion().setFromUnitVectors(to.clone().applyQuaternion(playerQ), UP));
  return arc(from, to);
}
/// Where the courier stands in the scene: on top of the planet, offset by however far the view still
/// lags behind, leaning into turns and into speeding up or slowing down.
let leanSide = 0, leanFwd = 0, lastV = 0;
const leanE = new THREE.Euler(0, 0, 0, "YXZ");
function placePlayer(dt, v, turnRate) {
  const lag = world.quaternion.clone().multiply(playerQ.clone().invert());
  player.group.position.copy(UP).applyQuaternion(lag).multiplyScalar(R + bodyY);
  const accel = (v - lastV) / Math.max(dt, 1e-3);
  lastV = v;
  const wheels = player.ride ? 1.8 : 1;
  leanSide += (clamp(turnRate * Math.min(1, v / SPEED) * 0.045 * wheels, -0.3, 0.3) - leanSide) * (1 - Math.exp(-dt * 8));
  leanFwd += (clamp(accel * 0.012, -0.1, 0.14) - leanFwd) * (1 - Math.exp(-dt * 6));
  leanE.set(leanFwd, facingCamera ? 0 : Math.PI - facing, leanSide);
  player.group.quaternion.copy(lag).multiply(new THREE.Quaternion().setFromEuler(leanE));
}

// ---------------------------------------------------------------- intro

const spawnQ = (() => {
  const q1 = new THREE.Quaternion().setFromUnitVectors(W.spawn.dir, UP);
  const tan = W.spawn.tangent.clone().applyQuaternion(q1);
  tan.y = 0;
  tan.normalize();
  const q2 = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(tan.x, -tan.z));
  return q2.multiply(q1);
})();
const TITLE_CAM = { pos: new THREE.Vector3(0, 6, 74), look: new THREE.Vector3(0, 0, 0) };
// The camera you asked for (pitch, dist) and the one in use, which lifts over buildings that would
// get in the way, or comes in closer, and eases back once the view is clear.
let camPitch = 0.56, camDist = 8, camDodge = 0, camLift = 0; // camLift rises and falls with the courier
const followCam = () => ({
  pos: new THREE.Vector3(0, R + camLift + 1.0 + Math.sin(camPitch) * camDist, Math.cos(camPitch) * camDist),
  look: new THREE.Vector3(0, R + camLift + 1.05, -1.8),
});
/// Whether the view from this camera to the courier is clear of buildings (and tanks and cliffs).
function camClear(walls, inv, p, d) {
  const from = new THREE.Vector3(0, R + camLift + 1.0, 0), to = new THREE.Vector3(0, R + camLift + 1.0 + Math.sin(p) * d, Math.cos(p) * d);
  const q = new THREE.Vector3(), v = new THREE.Vector3();
  for (let s = 0.1; s <= 1.0001; s += 0.075) {
    q.lerpVectors(from, to, s).applyQuaternion(inv);
    const len = q.length(), h = len - R;
    q.divideScalar(len);
    for (const o of walls) {
      if (h > o.wall.h + 0.35 || q.dot(o.d) < o.cos) continue;
      if (o.kind === "circle") {
        if (arc(q, o.d) < o.r + 0.3) return false;
        continue;
      }
      v.subVectors(q, o.d).multiplyScalar(R);
      if (Math.abs(v.dot(o.right)) < o.hw + 0.3 && Math.abs(v.dot(o.front)) < o.wall.hd + 0.3) return false;
    }
  }
  return true;
}
function steerCamera(dt) {
  const me = localPos();
  const walls = W.obstacles.filter((o) => o.wall && me.dot(o.d) > Math.cos((dist + 6) / R));
  const inv = playerQ.clone().invert();
  const tries = [[pitch, dist], [pitch + 0.3, dist], [pitch + 0.55, dist * 0.92], [Math.min(1.3, pitch + 0.8), dist * 0.82],
    [Math.min(1.3, pitch + 0.8), dist * 0.62], [Math.min(1.3, pitch + 0.8), dist * 0.45]];
  const pickd = tries.find(([p, d]) => camClear(walls, inv, p, d)) ?? tries[tries.length - 1];
  const [p, d] = pickd;
  // Get out of the way quickly and settle back slowly; otherwise just follow your own camera moves.
  camDodge = pickd === tries[0] ? Math.max(0, camDodge - dt) : 2.5;
  const back = camDodge > 0 ? 1.5 : 10;
  camPitch += (p - camPitch) * (1 - Math.exp(-dt * (p > camPitch ? 5 : back)));
  camDist += (d - camDist) * (1 - Math.exp(-dt * (d < camDist ? 5 : back)));
}

let mode = "title"; // title | intro | play
let intro = null;
$("begin").addEventListener("click", async () => {
  if (mode !== "title") return;
  // First, while the click still counts as permission to play sound.
  music.start();
  sounds.start();
  // On a real chain you log in with your wallet before playing.
  const chain = await chainReady;
  if (chain && chain.browserWallet && !chain.account) {
    try {
      if (!(await chain.login())) return;
    } catch (e) {
      toast(explain(e), "error");
      return;
    }
    office?.refresh();
  }
  mode = "intro";
  intro = { k: 0, from: world.quaternion.clone() };
  $("title").classList.add("gone");
});

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
const camPos = TITLE_CAM.pos.clone(), camLook = TITLE_CAM.look.clone();
const spin = new THREE.Vector3(0.2, 1, 0.12).normalize();
let moveSpeed = 0;
// Height: bodyY is where the feet are (metres above the plain); footY what's underfoot (street,
// stairs, deck, river bed) and jumpY how far above it you are. Jumping is a quick hop with a stretch
// on the way up and a squash on landing; walk off an edge and you fall.
const JUMP_V = 5.6, GRAVITY = 18;
let bodyY = 0.04, footY = 0.04, jumpY = 0, jumpV = 0, jumpBuffer = 0, landSquash = 0, skidIn = 0, wading = false, splashIn = 0;
function jump() {
  // Remember the press for a moment, so pressing just before landing still jumps again.
  if (mode === "play" && !dialog) jumpBuffer = 0.15;
}
// Weather: now and then a light shower rolls over for a minute or two (?rain=1 starts in one).
const weather = { rain: 0, target: 0, next: 0 };
{
  const q = new URLSearchParams(location.search).get("rain");
  if (q !== null) weather.rain = weather.target = Math.min(1, Number.parseFloat(q) || 0);
  weather.next = weather.target ? 90 : 60 + Math.random() * 150;
}
function stepWeather(dt) {
  weather.next -= dt;
  if (weather.next <= 0) {
    if (weather.target > 0) {
      weather.target = 0;
      weather.next = 150 + Math.random() * 210;
    } else if (Math.random() < 0.45) {
      weather.target = 0.5 + Math.random() * 0.4;
      weather.next = 60 + Math.random() * 90;
    } else weather.next = 90 + Math.random() * 120;
  }
  // Showers take about ten seconds to come and go.
  weather.rain += Math.max(-dt / 10, Math.min(dt / 10, weather.target - weather.rain));
}
// A full day and night every 12 minutes of play, starting late morning (?tod=0.9 starts at night).
const DAY_SECONDS = 720;
let timeOfDay = Number.parseFloat(new URLSearchParams(location.search).get("tod")) || 0.42;
let facingCamera = true; // she greets the camera until you first move
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// Keep it smooth: if frames run slow for a couple of seconds, draw at a lower resolution, and step
// back up once there's room again.
let quality = 1, slowFor = 0, fastFor = 0, avgFrame = 1 / 60;
function adapt(raw) {
  if (raw > 0.25) return; // a hitch or a hidden tab, not a trend
  avgFrame += (raw - avgFrame) * 0.05;
  if (avgFrame > 1 / 48) [slowFor, fastFor] = [slowFor + raw, 0];
  else if (avgFrame < 1 / 57) [slowFor, fastFor] = [0, fastFor + raw];
  else slowFor = fastFor = 0;
  if (slowFor > 2 && quality > 0.5) {
    quality = Math.max(0.5, quality - 0.15);
    W.setQuality(quality);
    slowFor = 0;
    avgFrame = 1 / 60;
  } else if (fastFor > 8 && quality < 1) {
    quality = Math.min(1, quality + 0.1);
    W.setQuality(quality);
    fastFor = 0;
  }
}

function frame() {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05), t = clock.elapsedTime;
  adapt(raw);
  let dist = 0, turnRate = 0, landed = false;

  if (mode === "title") {
    world.rotateOnWorldAxis(spin, dt * 0.07);
    camPos.copy(TITLE_CAM.pos);
    camLook.copy(TITLE_CAM.look);
  } else if (mode === "intro") {
    intro.k = Math.min(1, intro.k + Math.min(raw, 0.25) / 3.0); // wall-clock, so slow frames don't drag it out
    const e = ease(intro.k);
    world.quaternion.slerpQuaternions(intro.from, spawnQ, e);
    const f = followCam();
    camPos.lerpVectors(TITLE_CAM.pos, f.pos, e);
    camLook.lerpVectors(TITLE_CAM.look, f.look, e);
    if (intro.k >= 1) {
      mode = "play";
      playerQ.copy(spawnQ);
      $("hud").hidden = false;
      fillBag();
      say(INTRO);
    }
  } else {
    let ix = 0, iy = 0;
    if (!dialog) {
      if (keys.has("w") || keys.has("arrowup")) iy += 1;
      if (keys.has("s") || keys.has("arrowdown")) iy -= 1;
      if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
      if (keys.has("d") || keys.has("arrowright")) ix += 1;
      if (joy.id !== null) { ix += joy.x; iy -= joy.y; }
    }
    const mag = Math.min(1, Math.hypot(ix, iy));
    const run = keys.has("shift") || mag > 0.95 && joy.id !== null;
    const steering = mag > 0.05;
    const want = new THREE.Vector2();
    if (steering) {
      facingCamera = false;
      want.set(ix, iy).setLength(mag * (run ? RUN : SPEED) * player.speed);
    }
    // Quick to get going and quicker to stop; heavier on wheels, and only a little steering in mid-air.
    const heavy = player.ride ? 0.45 : 1;
    if (wading) want.multiplyScalar(0.7); // slower through the water
    vel.lerp(want, 1 - Math.exp(-dt * (steering ? 9 : 12) * heavy * (jumpY > 0 ? 0.35 : 1)));
    dist = step(dt);
    const v = vel.length();
    // Turn to face where you're steering (or, coasting, where you're going).
    turnRate = 0;
    if (steering || v > 0.4) {
      const aim = steering ? Math.atan2(ix, iy) : Math.atan2(vel.x, vel.y);
      const before = facing;
      facing = wrap(facing + wrap(aim - facing) * (1 - Math.exp(-dt * 14 * heavy)));
      turnRate = wrap(facing - before) / Math.max(dt, 1e-3);
    }
    // The camera swings in behind the courier when heading away from it.
    if (v > 0.3 && !drag) {
      const a = Math.atan2(vel.x, vel.y);
      yaw(a * Math.max(0, Math.cos(a)) * Math.min(1, dt * 2.2) * Math.min(1, v / SPEED));
    }
    // Animation pace from the real speed: 0.62 at a walk, 1 at a run.
    const u = v / player.speed;
    moveSpeed = u <= SPEED ? (0.62 * u) / SPEED : Math.min(1, 0.62 + (0.38 * (u - SPEED)) / (RUN - SPEED));

    const p = localPos();
    // What's underfoot: the highest thing you can stand on from here (in the air, only what you're above).
    let air = jumpV !== 0 || bodyY > footY + 0.02;
    const ground = W.terrain.surfaceAt(p, bodyY, air ? 0.05 : STEP);
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (jumpBuffer > 0 && !air && !dialog) {
      jumpBuffer = 0;
      jumpV = JUMP_V;
      air = true;
      sounds.jump();
    }
    // Walked off an edge: fall.
    if (!air && ground < bodyY - 0.3) air = true;
    if (air) {
      jumpV -= GRAVITY * dt;
      bodyY += jumpV * dt;
      if (bodyY <= ground) {
        landSquash = Math.min(1, -jumpV / JUMP_V);
        if (landSquash > 0.15) {
          sounds.land(landSquash);
          landed = true;
        }
        bodyY = ground;
        jumpV = 0;
      }
    } else bodyY += (ground - bodyY) * (1 - Math.exp(-dt * 14)); // kerbs and stairs
    footY = ground;
    jumpY = Math.max(0, bodyY - ground);
    // Feet in the water: slower, and splashing.
    const water = W.terrain.waterAt(p);
    wading = water !== null && bodyY < water + 0.05;
    splashIn -= dt;
    if (wading && v > 0.6 && splashIn <= 0) {
      splashAt(0.22, 1);
      splashIn = 0.18;
    }
    if (landed && water !== null && bodyY < water + 0.05) splashAt(0.4, 8);
    camLift += (bodyY - camLift) * (1 - Math.exp(-dt * 5));
    landSquash *= Math.exp(-dt * 11);
    const stretch = 1 + (jumpY > 0 ? 0.1 * Math.min(1, Math.abs(jumpV) / JUMP_V) : 0) - 0.24 * landSquash;
    player.group.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    // The view eases after the courier; faster rides pull it along a little quicker.
    world.quaternion.slerp(playerQ, 1 - Math.exp(-dt * 7 * Math.sqrt(player.speed)));
    placePlayer(dt, v, turnRate);
    // Dust: a burst on landing, and a trail when skidding round to face the other way.
    if (landed && !wading) kick({ n: 8, size: 0.4, spread: 1.4, life: 0.55 });
    skidIn -= dt;
    if (steering && v > 2 && want.dot(vel) < 0 && skidIn <= 0 && jumpY === 0) {
      kick({ n: 2, size: 0.26, spread: 0.7, life: 0.4 });
      skidIn = 0.05;
    }

    // Deliveries and the post office.
    if (!dialog) {
      for (const i of bag) {
        if (arc(p, W.addresses[i].dir) < 1.4) {
          deliver(i);
          break;
        }
      }
      if (!bag.length && !dialog && arc(p, W.spawn.post) < 1.8) {
        fillBag();
        say([{ name: "Postmaster", text: POSTMASTER[random(POSTMASTER.length)] }]);
      }
    }
    compass(p);
    placeTitle(p, dt);

    steerCamera(dt);
    const f = followCam();
    const k = 1 - Math.exp(-dt * 8);
    camPos.lerp(f.pos, k);
    camLook.lerp(f.look, k);
  }

  const stepped = player.update(dt, moveSpeed, t, Math.min(1, jumpY * 4), dist);
  // A puff with each running step.
  if (stepped && moveSpeed > 0.8 && mode === "play" && !wading) kick({ n: 1, size: 0.3, spread: 0.4, life: 0.45 });
  dust.update(dt, 1 - 0.55 * W.night);
  sparkle.update(dt);
  splash.update(dt, 1 - 0.5 * W.night);
  const got = stamps.update(dt, t, { me: localPos(), chest: bodyY + 0.85, active: mode === "play" && !dialog });
  if (got) collected(got);
  life.update(dt, t, { me: localPos(), speed: mode === "play" ? moveSpeed : 0, night: W.night, rain: weather.rain, active: mode === "play" });
  waveT = Math.max(0, waveT - dt);
  player.ch.setWave(waveT > 0 ? Math.min(1, waveT * 3, (1.6 - waveT) * 6) : 0);
  if (mode !== "title") {
    timeOfDay += dt / DAY_SECONDS;
    stepWeather(dt);
  }
  W.setRain(weather.rain);
  W.setTimeOfDay(timeOfDay);
  sounds.update(dt, {
    speed: mode === "play" ? moveSpeed : 0, ride: player.kind, night: W.night, rain: weather.rain, step: stepped && mode === "play" && !wading,
    ...(mode === "play" ? nearby(localPos()) : {}),
  });
  for (const s of markers.values()) s.position.copy(s.userData.base).addScaledVector(s.userData.up, Math.sin(t * 3) * 0.18);
  if (dialog) {
    const line = dialog.lines[dialog.i];
    if (dialog.chars < line.text.length) {
      dialog.chars = Math.min(line.text.length, dialog.chars + dt * 48);
      drawDialog();
    }
  }

  camera.position.copy(camPos);
  camera.lookAt(camLook);
  W.setCutaway(mode === "play" ? player.group.position.clone().multiplyScalar((R + bodyY + 0.9) / (R + bodyY)) : null);
  W.render(t);
  requestAnimationFrame(frame);
}

/// The name of the place you're in, shown big for a few seconds when you arrive (once you've been
/// there for a moment, so walking along a border doesn't flicker).
let place = null, placeNext = null, placeFor = 0;
function placeTitle(p, dt) {
  const z = W.terrain.zoneAt(p);
  if (z.key === place) return void (placeNext = null);
  if (z.key !== placeNext) [placeNext, placeFor] = [z.key, 0];
  placeFor += dt;
  if (placeFor < 0.8 && place !== null) return;
  place = z.key;
  const el = $("place");
  el.textContent = z.name;
  el.classList.remove("show");
  void el.offsetWidth; // restart the animation
  el.classList.add("show");
}
/// How loud the sea, the falls and the works are from here (0 far … 1 right there).
function nearby(p) {
  const A = W.ambient, out = { sea: 0, falls: 0, works: 0, woods: W.terrain.zoneAt(p).key === "woods" ? 1 : 0 };
  if (A.sea) out.sea = 1 - Math.min(1, Math.max(0, (arc(p, A.sea.d) - A.sea.r * R) / 16));
  if (A.falls?.length) out.falls = 1 - Math.min(1, Math.max(0, (Math.min(...A.falls.map((f) => arc(p, f))) - 2) / 16));
  if (A.works) out.works = 1 - Math.min(1, Math.max(0, (arc(p, A.works.d) - A.works.r) / 12));
  return out;
}

/// Arrow toward the nearest letter's door, or back to the post office.
function compass(p) {
  let best = null;
  const targets = bag.length ? bag.map((i) => ({ d: W.addresses[i].dir, name: `${W.addresses[i].name} · No. ${W.addresses[i].no}` }))
    : [{ d: W.spawn.post, name: "post office", post: true }];
  for (const tgt of targets) {
    const dd = arc(p, tgt.d);
    if (!best || dd < best.dd) best = { ...tgt, dd };
  }
  const w = best.d.clone().applyQuaternion(world.quaternion);
  $("arrow").style.transform = `rotate(${Math.atan2(w.x, -w.z)}rad)`;
  $("target").textContent = `${best.post ? "Pick up letters at the" : "Deliver to"} ${best.name} · ${Math.round(best.dd)}m`;
}

// ---------------------------------------------------------------- the post office (on-chain)

function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast card ${kind}`;
  el.textContent = msg;
  $("toasts").append(el);
  if (kind !== "busy") setTimeout(() => el.remove(), kind === "error" ? 6000 : 3500);
  return el;
}

let office = null;
const chainReady = connectChain()
  .then(async (chain) => {
    if (!chain) return null;
    if (chain.browserWallet) {
      $("begin").textContent = "Log in & play";
      $("wallets").querySelector(".note").textContent =
        `Pick a wallet to play. Courier runs on ${chain.chainName}; your wallet will be asked to switch to it.`;
      await chain.resume().catch(() => false);
      if (chain.account) $("begin").textContent = "Begin";
      chain.onAccountChange(() => office?.refresh());
    }
    $("officeBtn").hidden = false;
    office = createOffice(chain, {
      toast,
      onSnapshot: autoAvatar,
      onPlayAs(c) {
        playAs(c, chain.account);
        toast(`Now playing as ${c.name}, ${c.ride.name.toLowerCase()}`);
      },
    });
    return chain;
  })
  .catch((e) => {
    console.error(e);
    return null;
  });
$("officeBtn").addEventListener("click", () => office?.show($("office").hidden));
$("officeClose").addEventListener("click", () => office?.show(false));

hud();
requestAnimationFrame(frame);
