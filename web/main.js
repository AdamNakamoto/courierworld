import * as THREE from "https://esm.sh/three@0.160.0";
import { createWorld, R, UP, ROAD_HW, WALK, arc, texFromCanvas } from "./world.js";
import { createCharacter, COURIER, villager } from "./character.js";
import { createRide } from "./rides.js";
import { courier } from "./traits.js";
import { connectChain, explain } from "./chain.js";
import { createMusic } from "./music.js";
import { createAmbience } from "./ambience.js";
import { createOffice } from "./office.js";
import { createDust } from "./fx.js";

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
  { name: "Tip", text: "WASD or arrow keys to walk, Shift to run, Space to jump, drag to look around. Follow the arrow at the top." },
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
      o.material.dispose();
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
  a.name = NAMES[i % NAMES.length];
  a.no = i + 1;
});

const dust = createDust(world, W.noNormals);
/// Kick up dust at the courier's feet (it stays put on the ground as they move on).
function kick(opts) {
  world.updateMatrixWorld();
  const at = world.worldToLocal(player.group.position.clone());
  dust.puff(at, at.clone().normalize(), opts);
}

// A few residents waiting by their doors.
const residents = [];
{
  const step = Math.max(1, Math.floor(W.addresses.length / 12));
  for (let i = 3; i < W.addresses.length && residents.length < 12; i += step) {
    const a = W.addresses[i];
    const npc = createCharacter(villager(i * 7919 + 13));
    npc.root.position.copy(a.dir).multiplyScalar(R + 0.16);
    npc.root.quaternion.copy(W.frameAt(a.dir, a.spin));
    npc.root.translateX(0.75);
    world.add(npc.root);
    residents.push(npc);
  }
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
    $("help").textContent = "Drag the stick to walk · tap Jump to hop · drag the world to look";
  }
  $("jumpBtn").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    jump();
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
/// Push a spot on the planet (a unit vector) out of anything solid, so you slide along walls.
function pushOut(p) {
  const v = new THREE.Vector3();
  for (let pass = 0; pass < 2; pass++) {
    for (const o of W.obstacles) {
      if (p.dot(o.d) < o.cos) continue;
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
  }
  return p;
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
  player.group.position.copy(UP).applyQuaternion(lag).multiplyScalar(R + footY + jumpY);
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
const followCam = () => ({
  pos: new THREE.Vector3(0, R + 1.0 + Math.sin(pitch) * dist, Math.cos(pitch) * dist),
  look: new THREE.Vector3(0, R + 1.05, -1.8),
});

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
let moveSpeed = 0, footY = 0.03;
// Jumping: a quick hop with a stretch on the way up and a squash on landing.
const JUMP_V = 5.6, GRAVITY = 18;
let jumpY = 0, jumpV = 0, jumpBuffer = 0, landSquash = 0, skidIn = 0;
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

function frame() {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05), t = clock.elapsedTime;
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
    // Step up onto sidewalks.
    const rd = W.nearestRoad(p);
    const groundY = rd < ROAD_HW ? 0.04 : rd < ROAD_HW + WALK ? 0.16 : 0.0;
    footY += (groundY - footY) * (1 - Math.exp(-dt * 14));
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (jumpBuffer > 0 && jumpY === 0 && !dialog) {
      jumpBuffer = 0;
      jumpV = JUMP_V;
      jumpY = 1e-4;
      sounds.jump();
    }
    if (jumpY > 0) {
      jumpV -= GRAVITY * dt;
      jumpY += jumpV * dt;
      if (jumpY <= 0) {
        jumpY = 0;
        landSquash = Math.min(1, -jumpV / JUMP_V);
        sounds.land(landSquash);
        jumpV = 0;
        landed = true;
      }
    }
    landSquash *= Math.exp(-dt * 11);
    const stretch = 1 + (jumpY > 0 ? 0.1 * Math.min(1, Math.abs(jumpV) / JUMP_V) : 0) - 0.24 * landSquash;
    player.group.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    // The view eases after the courier; faster rides pull it along a little quicker.
    world.quaternion.slerp(playerQ, 1 - Math.exp(-dt * 7 * Math.sqrt(player.speed)));
    placePlayer(dt, v, turnRate);
    // Dust: a burst on landing, and a trail when skidding round to face the other way.
    if (landed) kick({ n: 8, size: 0.4, spread: 1.4, life: 0.55 });
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

    const f = followCam();
    const k = 1 - Math.exp(-dt * 8);
    camPos.lerp(f.pos, k);
    camLook.lerp(f.look, k);
  }

  const stepped = player.update(dt, moveSpeed, t, Math.min(1, jumpY * 4), dist);
  // A puff with each running step.
  if (stepped && moveSpeed > 0.8 && mode === "play") kick({ n: 1, size: 0.3, spread: 0.4, life: 0.45 });
  dust.update(dt, 1 - 0.55 * W.night);
  for (const r of residents) r.update(dt, 0, t);
  if (mode !== "title") {
    timeOfDay += dt / DAY_SECONDS;
    stepWeather(dt);
  }
  W.setRain(weather.rain);
  W.setTimeOfDay(timeOfDay);
  sounds.update(dt, { speed: mode === "play" ? moveSpeed : 0, ride: player.kind, night: W.night, rain: weather.rain, step: stepped && mode === "play" });
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
  W.setCutaway(mode === "play" ? player.group.position.clone().multiplyScalar((R + footY + jumpY + 0.9) / (R + footY + jumpY)) : null);
  W.render(t);
  requestAnimationFrame(frame);
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
