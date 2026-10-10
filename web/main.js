import * as THREE from "https://esm.sh/three@0.160.0";
import { createWorld, R, UP, ROAD_HW, WALK, arc, texFromCanvas } from "./world.js";
import { createCharacter, COURIER, villager } from "./character.js";
import { createRide } from "./rides.js";
import { courier } from "./traits.js";
import { connectChain, explain } from "./chain.js";
import { createMusic } from "./music.js";
import { createOffice } from "./office.js";

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
  { name: "Tip", text: "WASD or arrow keys to walk, Shift to run, drag to look around. Follow the arrow at the top." },
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
    speed: ride ? ride.mount.speed : 1,
    update(dt, moving, t) {
      ride?.update(dt, moving, t);
      if (ride) ch.root.position.y = ride.riderY(t);
      ch.update(dt, ride ? (ride.mount.pedal ? moving : 0) : moving, t);
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
function musicButton() {
  $("musicBtn").classList.toggle("off", !music.enabled);
  $("musicBtn").setAttribute("aria-pressed", String(music.enabled));
  $("musicBtn").title = music.enabled ? "Music on (M)" : "Music off (M)";
}
musicButton();
$("musicBtn").addEventListener("click", () => {
  music.toggle();
  musicButton();
});

const keys = new Set();
const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
addEventListener("keydown", (e) => {
  if (typing(e)) return;
  if (e.key.toLowerCase() === "p" && office && mode === "play") {
    office.show($("office").hidden);
    return;
  }
  if (e.key.toLowerCase() === "m" && mode !== "title") {
    music.toggle();
    musicButton();
    return;
  }
  if (dialog && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    advance();
    return;
  }
  keys.add(e.key.toLowerCase());
  if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

let pitch = 0.36, dist = 5.6;
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
  dist = Math.min(10, Math.max(3, dist * Math.exp(e.deltaY * 0.001)));
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
    $("help").textContent = "Drag the stick to walk · drag the world to look";
  }
}

// ---------------------------------------------------------------- movement

const SPEED = 3.4, RUN = 6.2, BODY_R = 0.3;
let heading = 0; // courier's facing relative to the camera; 0 = away from it
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/// Turn the planet about the vertical axis (the camera orbits the courier).
function yaw(phi) {
  world.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, phi));
  heading = wrap(heading - phi);
}
function localPos() {
  return UP.clone().applyQuaternion(world.quaternion.clone().invert());
}
function blocked() {
  const p = localPos();
  for (const o of W.obstacles) {
    if (p.dot(o.d) < o.cos) continue;
    if (o.kind === "circle") {
      if (arc(p, o.d) < o.r + BODY_R) return true;
    } else {
      const v = p.clone().sub(o.d).multiplyScalar(R);
      if (Math.abs(v.dot(o.right)) < o.hw + BODY_R && Math.abs(v.dot(o.front)) < o.hd + BODY_R) return true;
    }
  }
  return false;
}
/// Walk `step` along `h` by rolling the planet under the courier.
function tryMove(h, step) {
  const dir = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
  const axis = dir.clone().cross(UP).normalize();
  const prev = world.quaternion.clone();
  world.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, step / R));
  if (blocked()) {
    world.quaternion.copy(prev);
    return false;
  }
  return true;
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
  music.start(); // first, while the click still counts as permission to play sound
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
let facingCamera = true; // she greets the camera until you first move
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function frame() {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05), t = clock.elapsedTime;

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
    if (mag > 0.05) {
      facingCamera = false;
      const target = Math.atan2(ix, iy);
      heading = wrap(heading + wrap(target - heading) * (1 - Math.exp(-dt * 10)));
      const step = (run ? RUN : SPEED) * mag * dt * player.speed;
      if (!tryMove(heading, step)) {
        for (const off of [0.5, -0.5, 1.0, -1.0, 1.4, -1.4]) if (tryMove(heading + off, step * Math.cos(off))) break;
      }
      // The camera swings in behind the courier when walking away from it.
      yaw(heading * Math.max(0, Math.cos(target)) * Math.min(1, dt * 2.2));
    }
    const want = mag > 0.05 ? (run ? 1 : 0.62) * mag : 0;
    moveSpeed += (want - moveSpeed) * (1 - Math.exp(-dt * 10));

    const p = localPos();
    // Step up onto sidewalks.
    const rd = W.nearestRoad(p);
    const groundY = rd < ROAD_HW ? 0.04 : rd < ROAD_HW + WALK ? 0.16 : 0.0;
    footY += (groundY - footY) * (1 - Math.exp(-dt * 14));
    player.group.position.y = R + footY;
    const yawWant = facingCamera ? 0 : Math.PI - heading;
    player.group.rotation.y += wrap(yawWant - player.group.rotation.y) * (1 - Math.exp(-dt * 12));

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

  player.update(dt, moveSpeed, t);
  for (const r of residents) r.update(dt, 0, t);
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
