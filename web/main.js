import * as THREE from "https://esm.sh/three@0.160.0";
import { createWorld, R, UP, arc, texFromCanvas } from "./world.js";
import { SEA_LEVEL, STEP, SWIM } from "./terrain.js";
import { createCharacter, COURIER } from "./character.js";
import { createRide } from "./rides.js";
import { SKINS, SKIN_SUPPLY } from "./skins.js";
import { createNet, EMOTES } from "./net.js";
import { createChat } from "./chat.js";
import { createOrbAds, domainOf } from "./orb.js";
import { courier } from "./traits.js";
import { connectChain, explain } from "./chain.js";
import { createMusic } from "./music.js";
import { createAmbience } from "./ambience.js";
import { createOffice } from "./office.js";
import { createPad } from "./pad.js";
import { createDust } from "./fx.js";
import { createLife } from "./life.js";
import { createStamps, STAMPS } from "./stamps.js";
import { huntDay, newSpotsIn } from "./hunt-pick.js";
import { parseMeta } from "./pad-rules.js";
import { createDistrict } from "./district.js";
import { loadNames, onNames } from "./names.js";
import { createUsername } from "./username.js";

const $ = (id) => document.getElementById(id);
// Golden stamp spots (fixed, see stamps.js): loaded first, so the Orb keeps clear of every one.
const HUNT_SPOTS = await fetch("./hunt-spots.json").then((r) => r.json());
const W = createWorld($("c"), { keepClear: HUNT_SPOTS });
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

/// A courier and (optionally) their ride, as one group facing +z. The ride takes the outfit's accent
/// colour unless `rideColour` says otherwise (the skins' scooter and supercars have their own).
function rider(params, rideKey = "foot", rideColour = null) {
  const group = new THREE.Group();
  const ch = createCharacter(params);
  const ride = rideKey === "foot" ? null : createRide(rideKey, rideColour ?? params.accent);
  if (ride) {
    group.add(ride.group);
    ch.root.position.set(0, ride.mount.y, ride.mount.z);
    ch.setPose(ride.mount.pose);
  }
  group.add(ch.root);
  return {
    group, ch, ride, params, rideKey,
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
  if (mode === "play") introduce();
}
function playAs(c, account) {
  playingId = c.id;
  if (skinWorn) forgetSkin(account);
  setPlayer(rider(c.params, c.ride.key));
  try {
    if (account) localStorage.setItem(`courier:avatar:${account.toLowerCase()}`, String(c.id));
  } catch {}
}
// The Courier Skin you have on ({ id, design }), if any. Skins are cosmetic: they only change how you look.
let skinWorn = null;
let lastSnap = null;
const skinKey = (account) => `courier:skin:${account.toLowerCase()}`;
function wearSkin(m, account) {
  skinWorn = m;
  const k = SKINS[m.design];
  setPlayer(rider(k.params, k.ride ?? "foot", k.rideColour));
  try {
    if (account) localStorage.setItem(skinKey(account), String(m.id));
  } catch {}
}
function forgetSkin(account) {
  skinWorn = null;
  try {
    if (account) localStorage.removeItem(skinKey(account));
  } catch {}
}
/// Back to your courier (or the default look).
function takeOffSkin(account) {
  forgetSkin(account);
  playingId = null;
  setPlayer(rider(COURIER));
  if (lastSnap) autoAvatar(lastSnap);
}

/// After login, wear the skin you had on last time if you still own it; otherwise play as one of your
/// couriers: last time's pick, else one on duty, else the first.
function autoAvatar(s) {
  lastSnap = s;
  const skins = s?.account && s.skins?.seed ? (s.skins.mine ?? []).filter((m) => m.design != null) : [];
  if (skinWorn) {
    if (s?.account && s.account === playingAccount && skins.some((m) => m.id === skinWorn.id)) return;
    // Sold, or another wallet logged in.
    skinWorn = null;
    playingId = null;
    setPlayer(rider(COURIER));
  }
  if (skins.length) {
    let saved = null;
    try {
      saved = Number(localStorage.getItem(skinKey(s.account)));
    } catch {}
    const m = skins.find((x) => x.id === saved);
    if (m) {
      playingAccount = s.account;
      wearSkin(m, s.account);
      return;
    }
  }
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
// The players' post offices, standing on the lots near the main post office (filled from the leaderboard).
const district = createDistrict(W);
let board = null, boardTiers = "";
async function refreshBoard(chain) {
  try {
    board = await chain.leaderboard();
    if (!board) return;
    district.update(board.list, chain.account);
    office?.setBoard(board);
    // Name tags show each player's tier, so redraw them when a tier changes.
    const tiers = board.list.map((o) => `${o.owner}:${o.tier}`).join();
    if (tiers !== boardTiers) {
      boardTiers = tiers;
      net.retag();
    }
    const earned = Number(board.totalEarned / 10n ** 18n);
    $("live").textContent = `📮 ${board.count.toLocaleString()} post office${board.count === 1 ? "" : "s"} open · ${earned.toLocaleString()} $STAMP earned`;
    $("live").hidden = false;
  } catch (e) {
    console.warn(e);
  }
}

// Golden stamps to find, and the sparkle when you do.
// ---------------------------------------------------------------- other players

// The multiplayer room (multiplayer/ in the repo, on Cloudflare). ?mp=ws://… points the game at
// another one, such as `wrangler dev` on your own machine.
const MP_URL = new URLSearchParams(location.search).get("mp") ?? "wss://courier-world-mp.courier-world-mp.workers.dev/ws";
const MP_HTTP = MP_URL.replace(/^ws/, "http").replace(/\/ws$/, "");
// Token pictures are hosted by the multiplayer server (this one, or the live one for tokens launched there).
const PICTURE_HOSTS = [...new Set([`${MP_HTTP}/pad/image/`, "https://courier-world-mp.courier-world-mp.workers.dev/pad/image/"])];
const TIERS = ["Kiosk", "Branch", "Depot", "Hub", "HQ"];
let chainRef = null;
const net = createNet(W, {
  url: MP_URL, makeRider: rider, dispose,
  tier(addr) {
    const o = board?.list.find((x) => x.owner.toLowerCase() === addr.toLowerCase());
    return o ? TIERS[Math.min(o.tier, 4)] : null;
  },
  // The treasure hunt: the room's view of you (signed in? what you've found today, golden stamps and coins).
  onHunt(state) {
    huntState = state;
    paintTicker();
    if (state?.wallet) stamps.setFound(state.day, state.found, state.coins);
    office?.huntChanged();
    hud();
  },
  onFound(day, spot, count, owner) {
    if (huntState && huntState.day === day) {
      const list = owner === "golden" ? huntState.found : (huntState.coins[owner] ??= []);
      if (!list.includes(spot)) list.push(spot);
    }
    paintTicker();
    office?.huntChanged();
  },
  onNope(spot, why) {
    toast(why, "error");
  },
  onCount(n) {
    $("online").hidden = n === null;
    if (n !== null) $("onlineN").textContent = n.toLocaleString();
  },
  // Chat: lines from everyone on the planet (see chat.js).
  onChat: (line) => chatUI.add(line),
  onChatHistory: (lines) => chatUI.history(lines),
  onChatError: (why) => chatUI.error(why),
  // Names (see username.js).
  nameToken: (addr) => username.token(addr),
  onNamed: (info) => username.named(info),
});
const chatUI = createChat(net, { toast, me: () => chainRef?.account ?? null, myName: () => username.mine?.name ?? null });

// ---------------------------------------------------------------- names

// Your name on the planet: picked in the Post Office panel, signed for by your wallet.
const username = createUsername({
  net, chain: () => chainRef,
  onChange() {
    office?.refresh();
    loadNames(MP_HTTP);
  },
});
// Everyone's names, for the post office signs and the leaderboard.
onNames(() => {
  if (board) district.update(board.list, chainRef?.account);
  office?.refresh();
});
loadNames(MP_HTTP);
setInterval(() => loadNames(MP_HTTP), 300_000); // (names change rarely; each poll is a request to the server)

// ---------------------------------------------------------------- the Orb's ads

const orbAds = W.orb ? createOrbAds(W.orb) : null;
const orbRay = new THREE.Raycaster();
let squareAd = null; // the ad Times Square's screens are showing
/// The card for the ad on the Orb right now: what it is, where its links go, and that it's an ad.
function showAd() {
  const ad = orbAds?.current();
  if (!ad) return;
  $("orbImg").hidden = !ad.image;
  if (ad.image) $("orbImg").src = ad.image;
  $("orbName").textContent = ad.name;
  $("orbText").textContent = ad.text ?? "";
  const site = $("orbSite"), chart = $("orbChart");
  site.hidden = !ad.url;
  if (ad.url) site.href = ad.url;
  site.textContent = ad.house ? "DM us on X ↗" : "Visit website ↗";
  chart.hidden = !ad.chart;
  if (ad.chart) chart.href = ad.chart;
  chart.classList.toggle("primary", !ad.url); // the main button when it's the only link
  $("orbDomain").textContent = ad.house ? "" : [ad.url && `Opens ${domainOf(ad.url)}`, ad.chart && `chart on ${domainOf(ad.chart)}`].filter(Boolean).join(" · ");
  $("orbImg").style.background = ad.color ?? "";
  $("orbNote").hidden = !!ad.house;
  $("orbCard").hidden = false;
}
const hideAd = () => ($("orbCard").hidden = true);
$("orbClose").addEventListener("click", hideAd);
for (const a of [$("orbSite"), $("orbChart")]) a.addEventListener("click", () => setTimeout(hideAd, 0));
/// Tell the room who you are: your courier, and your wallet if you're logged in.
function introduce() {
  net.hello(player.params, player.rideKey, chainRef?.account ?? null, skinWorn?.id ?? null);
}
/// The facts the room passes on about you each frame, in planet space.
function netState() {
  const f = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, facingCamera ? 0 : Math.PI - facing).applyQuaternion(playerQ.clone().invert());
  return { p: localPos(), f, h: bodyY, air: jumpY, spd: moveSpeed, swim: swimK };
}
/// How many are playing, on the title screen (from the room, every half minute).
const countUrl = `${MP_HTTP}/count`;
async function titleCount() {
  if (mode !== "title") return;
  try {
    const { online } = await (await fetch(countUrl)).json();
    $("onlineTitle").textContent = `👥 ${online.toLocaleString()} courier${online === 1 ? "" : "s"} online`;
    $("onlineTitle").hidden = !online;
  } catch {}
}
/// Emotes: a bar of buttons (on screens with a mouse), the chat button's menu (on phones), and keys
/// 1-9 and 0. A short wait between them, so nobody can flood the planet.
let emoteAt = 0;
function emote(i) {
  if (mode !== "play" || performance.now() - emoteAt < 700) return;
  emoteAt = performance.now();
  net.say(i);
}
EMOTES.forEach(({ e, t }, i) => {
  const key = i < 9 ? String(i + 1) : "0";
  const bar = document.createElement("button");
  bar.innerHTML = `<span>${e}</span><kbd>${key}</kbd>`;
  bar.title = `${t ?? e} (${key})`;
  bar.setAttribute("aria-label", t ?? e);
  bar.addEventListener("click", () => emote(i));
  $("emoteBar").append(bar);
  const menu = document.createElement("button");
  menu.innerHTML = `<span>${e}</span>${t ? ` ${t}` : ""}`;
  menu.addEventListener("click", () => {
    emote(i);
    $("phrases").hidden = true;
    $("chatBtn").setAttribute("aria-expanded", "false");
  });
  $("phrases").append(menu);
});
$("chatBtn").addEventListener("click", () => {
  $("phrases").hidden = !$("phrases").hidden;
  $("chatBtn").setAttribute("aria-expanded", String(!$("phrases").hidden));
});

// Every spot a golden stamp can be out at (the multiplayer server reads the same file).
const stamps = createStamps(W, HUNT_SPOTS);
let huntState = null, huntHinted = false;
const sparkle = createDust(world, W.noNormals, 24, 0xffd75e);
function collected(s) {
  sounds.collect();
  sparkle.puff(s.mesh.position, s.d, { n: 14, size: 0.24, spread: 1.8, life: 0.7 });
  hud();
  const drop = s.kind === "coin" ? droppingToday.find((d) => d.id === s.drop) : null;
  if (drop) {
    const c = stamps.coins(drop.id);
    toast(`🪙 $${drop.symbol} coin! ${c.found} of ${c.out} today`);
  } else toast(stamps.found === STAMPS ? "Every golden stamp on the planet!" : `Golden stamp! ${stamps.found} of ${STAMPS}`);
  // Signed-in hunters have the room count it (and pay for it); everyone else gets a hint, once.
  if (huntState?.wallet) net.grab(s.id);
  else if (chainRef?.drops && !huntHinted && (drop || goldenPays)) {
    huntHinted = true;
    setTimeout(() => toast("Treasure pays out: open the Post Office panel (P) and sign in to hunt."), 1800);
  }
  if (!drop && stamps.found === STAMPS) say([{ name: "You", text: `That's all ${STAMPS} golden stamps. The whole planet, done!` }]);
}

// The treasury's token drops running today: their coins go out round the planet, with the token's picture.
let droppingToday = [], goldenPays = false, dropsDay = -1;
const coinPictures = new Map(); // picture URL -> Image (null while loading)
async function refreshDrops() {
  const chain = chainRef;
  if (!chain?.drops) return;
  const day = huntDay();
  try {
    const running = await chain.drops.running(day);
    if (day !== huntDay()) return;
    goldenPays = running.some((d) => d.isStamp && d.left >= d.perCoin);
    const tokens = running.filter((d) => !d.isStamp);
    for (const d of tokens) {
      d.empty = d.left < d.perCoin; // paid out: its coins stay off the map (their spots stay reserved, so nothing moves)
      const url = parseMeta(d.metadata, PICTURE_HOSTS).image;
      d.pictureUrl = url ?? null;
      if (url && !coinPictures.has(url)) {
        coinPictures.set(url, null);
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => {
          coinPictures.set(url, im);
          refreshDrops();
        };
        im.src = url;
      }
      d.picture = url ? coinPictures.get(url) : null;
    }
    droppingToday = tokens;
    dropsDay = day;
    stamps.setDrops(day, tokens);
    W.square?.showDrops?.(tokens.filter((d) => !d.empty).map((d) => ({ symbol: d.symbol, picture: d.picture })));
    paintTicker();
  } catch (e) {
    console.warn("drops: couldn't read today's", e);
  }
}
setInterval(() => {
  if (huntDay() !== dropsDay) refreshDrops();
}, 15_000);
setInterval(refreshDrops, 60_000);

// The treasure hunt's running line across the top while a token drop is on: the coins out today (and how many you've
// found), how many are left to claim today, what they pay, and when the next ones come out. Tap it for the panel.
const ticker = $("huntTicker"), tickerTrack = ticker.querySelector(".track");
let tickerLine = "", tickerNext = null;
const tickEsc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const tickNum = (wei, compact = false) =>
  new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }).format(Number(wei) / 1e18);
function paintTicker() {
  const live = droppingToday.filter((d) => !d.empty && dropsDay === huntDay());
  const on = live.length > 0;
  document.body.classList.toggle("ticking", on);
  ticker.hidden = !on;
  if (!on) return;
  // Drops of the same token read as one hunt: their coins, claims and tokens added up.
  const byToken = new Map();
  for (const d of live) byToken.set(d.token, [...(byToken.get(d.token) ?? []), d]);
  const sum = (ds, f) => ds.reduce((n, d) => n + f(d), 0);
  const parts = [];
  for (const ds of byToken.values()) {
    const sym = `$${tickEsc(ds[0].symbol)}`, daily = sum(ds, (d) => Number(d.dailyCoins));
    const left = sum(ds, (d) => Math.max(0, Number(d.dailyCoins) - Number(d.paid ?? 0)));
    const mine = huntState?.wallet && huntState.day === dropsDay ? sum(ds, (d) => huntState.coins?.[d.id]?.length ?? 0) : null;
    const pays = [...new Set(ds.map((d) => d.perCoin))].sort((a, b) => (a < b ? -1 : 1)).map((v) => tickNum(v));
    const start = Math.min(...ds.map((d) => d.startDay)), end = Math.max(...ds.map((d) => d.endDay));
    parts.push(`🪙 THE ${sym} TREASURE HUNT IS ON`);
    parts.push(`<b>${sum(ds, (d) => d.spots)}</b> ${sym} COINS HIDDEN ROUND THE PLANET TODAY${mine !== null ? ` · YOU'VE FOUND <b>${mine}</b>` : ""}`);
    parts.push(left > 0 ? `<b>${left} OF ${daily}</b> COINS LEFT TO CLAIM TODAY · FIRST COME, FIRST SERVED`
      : `<span class="hot">TODAY'S ${daily} COINS ARE ALL CLAIMED</span>`);
    parts.push(`<b>${pays.join("–")}</b> ${sym} A COIN · UP TO ${sum(ds, (d) => d.maxPerWallet)} A WALLET A DAY`);
    parts.push(`DAY ${dropsDay - start + 1} OF ${end - start + 1} · ${tickNum(ds.reduce((n, d) => n + d.left, 0n), true)} ${sym} LEFT TO HUNT`);
  }
  parts.push(`NEW COINS IN <b>${newSpotsIn().toUpperCase()}</b> (00:00 UTC)`);
  parts.push("OPEN A POST OFFICE TO REDEEM · PRESS P");
  let line = parts.join(" ★ ") + " ★";
  // Long enough to fill a wide screen, so the two copies run round without a gap; about 80 px a second.
  const chars = line.replace(/<[^>]+>/g, "").length;
  line = Array(Math.max(1, Math.ceil(240 / chars))).fill(line).join(" ");
  if (line === tickerLine || line === tickerNext) return;
  // A new line takes over where the old one comes round again, so it never jumps mid-sentence.
  if (!tickerLine) setTicker(line);
  else tickerNext = line;
}
function setTicker(line) {
  tickerLine = line;
  tickerNext = null;
  for (const s of tickerTrack.children) s.innerHTML = line;
  tickerTrack.style.setProperty("--secs", `${Math.round(line.replace(/<[^>]+>/g, "").length * 0.13)}s`);
}
tickerTrack.addEventListener("animationiteration", () => tickerNext && setTicker(tickerNext));
ticker.addEventListener("click", () => office && showOffice(true));
setInterval(paintTicker, 30_000);

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
  $("emoteBar").classList.add("away");
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
    $("emoteBar").classList.remove("away");
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
  // Every house still standing (the ones cleared for the Orb's plaza get no letters).
  const open = W.addresses.flatMap((a, i) => (a.cleared ? [] : [i]));
  while (picks.size < Math.min(3, open.length)) picks.add(open[random(open.length)]);
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
  // Photo mode: C in and out, Space takes the picture, Escape steps back; walking and emotes still work.
  if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && mode === "play" && !dialog) {
    photoMode(!photo);
    return;
  }
  if (photo) {
    if (e.key === "Escape") {
      if (!$("photoCard").hidden) closePhoto();
      else photoMode(false);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) shoot();
      return;
    }
    if (["p", "t", "e", "enter"].includes(e.key.toLowerCase())) return;
  }
  if (e.key === "Escape" && !$("orbCard").hidden) {
    hideAd();
    return;
  }
  if (e.key === "Escape" && launchpad?.open) {
    launchpad.show(false);
    return;
  }
  if (e.key.toLowerCase() === "p" && office && mode === "play") {
    showOffice($("office").hidden);
    return;
  }
  if (e.key.toLowerCase() === "l" && launchpad && mode === "play") {
    showPad(!launchpad.open);
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
  if ((e.key === "Enter" || (e.key.toLowerCase() === "t" && !e.metaKey && !e.ctrlKey)) && mode === "play") {
    e.preventDefault();
    chatUI.open();
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
  if (e.key.toLowerCase() === "f" && mode !== "title" && canFullscreen) {
    if (!e.repeat) toggleFullscreen();
    return;
  }
  if (/^[0-9]$/.test(e.key) && mode === "play" && !dialog) {
    if (!e.repeat) emote(e.key === "0" ? 9 : Number(e.key) - 1);
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
let tap = null; // where and when a press began, to tell a tap from a drag
const presses = new Map(); // pointer id -> where it is, for pinching to zoom in photo mode
let pinch = null;
canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "play") return;
  drag = { x: e.clientX, y: e.clientY };
  tap = { x: e.clientX, y: e.clientY, t: performance.now() };
  presses.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (presses.has(e.pointerId)) presses.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (photo && presses.size === 2) {
    const [a, b] = [...presses.values()], apart = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) photoZoom(pinch / apart);
    pinch = apart;
    tap = null;
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag = { x: e.clientX, y: e.clientY };
  yaw(-dx * 0.006);
  if (photo) photo.pitch = Math.min(1.5, Math.max(-1.35, photo.pitch + dy * 0.004));
  else pitch = Math.min(0.95, Math.max(0.06, pitch + dy * 0.004));
});
canvas.addEventListener("pointercancel", (e) => {
  presses.delete(e.pointerId);
  pinch = null;
});
canvas.addEventListener("pointerup", (e) => {
  presses.delete(e.pointerId);
  pinch = null;
  drag = null;
  // A quick tap (not a drag to look round) on the Orb, or on one of Times Square's ad screens, opens the ad;
  // on the Launchpad's sign, the Launchpad.
  if (tap && performance.now() - tap.t < 400 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) {
    const r = canvas.getBoundingClientRect();
    orbRay.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), W.camera);
    const signs = launchpad ? W.square?.pad?.meshes ?? [] : [];
    const [hit] = orbRay.intersectObjects([...(W.orb ? [W.orb.mesh] : []), ...(W.square?.adMeshes ?? []), ...signs]);
    if (hit) signs.includes(hit.object) ? showPad(true) : showAd();
  }
  tap = null;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (photo) return photoZoom(Math.exp(e.deltaY * 0.0015));
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
    $("help").textContent = "Drag the stick to walk · Jump to hop · Hi to talk or wave · drag the world to look · 📷 for photos";
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
/// their top, and never on the stairs cut into them). The blocks under a staircase only keep things from
/// being put there: what keeps you out from under it is in pushOut.
const solidAt = (o, p, y) => !(o.under || (o.y1 !== undefined && y >= o.y1) || (o.y0 !== undefined && y < o.y0) || (o.except && W.terrain.inRamp(o.except, p, 0.2) !== null));
/// Push a spot on the planet (a unit vector) out of anything solid at height y (by default where your feet
/// are: the step you're on while you rise to it, or higher in a jump), so you slide along walls.
function pushOut(p, y = Math.max(bodyY, footY)) {
  const v = new THREE.Vector3();
  for (let pass = 0; pass < 2; pass++) {
    // Never in under a staircase (inside its steps, or under a flight): out to the nearer side.
    for (const r of W.terrain.ramps) {
      const h = W.terrain.inRamp(r, p, BODY_R);
      if (h === null || y >= h - STEP) continue;
      const lat = p.clone().sub(r.bottom).multiplyScalar(R).dot(r.side);
      p.addScaledVector(r.side, ((Math.sign(lat) || 1) * (r.hw + BODY_R - Math.abs(lat))) / R).normalize();
    }
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
  if (!who && W.orb && arc(me, W.orb.d) < W.orb.reach) {
    showAd();
    return;
  }
  if (!who && launchpad && W.square?.pad && arc(me, W.square.pad.d) < W.square.pad.reach) {
    showPad(true);
    return;
  }
  if (!who) {
    waveT = 1.6;
    life.waveBack(me);
    net.say(-1);
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
const TITLE_CAM = { pos: new THREE.Vector3(0, 6, 74).multiplyScalar(R / 24), look: new THREE.Vector3(0, 0, 0) };
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

// ---------------------------------------------------------------- photo mode

// Look round freely and take a picture. The camera leaves its spot behind the courier and circles them
// at any height (from overhead down to the ground, looking up at the sky) and any distance (out to the
// planet's curve, or right in, through their eyes). The buttons and panels step aside, the clock can be
// turned to any hour, and the shutter saves the view (with the game's address in the corner).
let photo = null; // { pitch, dist, hide, time, shoot } while in photo mode
const PHOTO_FAR = 45;
let photoUrl = null;
const HINT_KEYS = "Drag to look around · scroll to zoom (all the way in to see through your courier's eyes) · WASD to walk · Space for a photo · C or Esc when you're done";
const HINT_TOUCH = "Drag to look around · pinch or +/− to zoom (all the way in to see through your courier's eyes) · the stick to walk";
function photoMode(on) {
  if (on && (photo || mode !== "play" || dialog)) return;
  if (on) {
    photo = { pitch: camPitch, dist: camDist, hide: false, time: ((timeOfDay % 1) + 1) % 1, shoot: 0 };
    chatUI.close();
    office?.show(false);
    hideAd();
    $("photoTime").value = photo.time;
    photoClock();
    $("photoMe").setAttribute("aria-pressed", "false");
    $("photoHint").textContent = matchMedia("(pointer: coarse)").matches ? HINT_TOUCH : HINT_KEYS;
    $("photoHint").style.animation = "none";
    void $("photoHint").offsetWidth; // (restart its fade)
    $("photoHint").style.animation = "";
  } else {
    if (!photo) return;
    closePhoto();
    photo = null;
    player.group.visible = true;
  }
  document.body.classList.toggle("photo-on", !!photo);
  $("photo").hidden = !photo;
}
/// Zoom by `f` (above 1: out). All the way in is the view through the courier's eyes.
function photoZoom(f) {
  if (!photo) return;
  if (photo.dist === 0) photo.dist = f > 1 ? 0.9 : 0;
  else photo.dist = Math.min(PHOTO_FAR, photo.dist * f);
  if (photo.dist < 0.8 && f < 1) photo.dist = 0;
}
/// The photo camera, in the courier's frame (they stand at the top of the planet).
function photoCam() {
  const base = R + camLift;
  if (photo.dist === 0) {
    // Through their eyes: drag down to look down, up to look up at the sky.
    const head = new THREE.Vector3(0, base + 1.3, 0), up = -photo.pitch;
    return { pos: head, look: head.clone().add(new THREE.Vector3(0, Math.sin(up), -Math.cos(up))) };
  }
  const p = photo.pitch, d = photo.dist, target = new THREE.Vector3(0, base + 1.0, 0);
  const pos = target.clone().add(new THREE.Vector3(0, Math.sin(p) * d, Math.cos(p) * d));
  // No lower than just above the ground; from down there, look up past the courier into the sky.
  const under = pos.clone().normalize().applyQuaternion(world.quaternion.clone().invert()); // (on the planet itself)
  const floor = R + Math.min(camLift, W.terrain.surfaceAt(under, camLift + 0.5)) + 0.35;
  if (pos.length() < floor) pos.setLength(floor);
  const look = target.clone();
  if (p < 0) look.y += -Math.sin(p) * d * 1.1;
  return { pos, look };
}
function shoot() {
  if (!photo || photo.shoot) return;
  // Draw the picture at full resolution (Auto may have lowered it), then put it back.
  W.setQuality(1);
  photo.shoot = 2;
  sounds.shutter();
}
/// Right after a frame is drawn: copy it, with the game's address in the corner, and show it.
function capture() {
  W.setQuality(quality);
  const w = canvas.width, h = canvas.height, c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.drawImage(canvas, 0, 0);
  const s = Math.max(14, Math.round(h * 0.03));
  g.font = `400 ${s}px Bungee, Impact, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "bottom";
  g.fillStyle = "rgba(40, 48, 51, 0.55)";
  g.fillText("courierworld.fun", w - s * 0.75 + s * 0.08, h - s * 0.55 + s * 0.08);
  g.fillStyle = "#fbf8ef";
  g.fillText("courierworld.fun", w - s * 0.75, h - s * 0.55);
  $("photoFlash").classList.remove("go");
  void $("photoFlash").offsetWidth;
  $("photoFlash").classList.add("go");
  // The card comes up at once; the picture fills in when it's ready.
  const img = $("photoImg"), save = $("photoSave");
  img.removeAttribute("src");
  img.style.aspectRatio = `${w} / ${h}`;
  save.classList.add("busy");
  save.textContent = "Developing…";
  $("photoShare").hidden = true;
  $("photoCard").hidden = false;
  c.toBlob((blob) => {
    if (!blob) {
      closePhoto();
      return toast("Couldn't take that photo. Try again.", "error");
    }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const file = new File([blob], `courier-world-${stamp}.jpg`, { type: "image/jpeg" });
    img.src = photoUrl;
    save.href = photoUrl;
    save.download = file.name;
    save.textContent = "⬇ Save photo";
    save.classList.remove("busy");
    $("photoShare").hidden = !navigator.canShare?.({ files: [file] });
    $("photoShare").onclick = () => navigator.share({ files: [file], text: "A picture from Courier World 📮 courierworld.fun" }).catch(() => {});
  }, "image/jpeg", 0.92);
}
function closePhoto() {
  $("photoCard").hidden = true;
}
$("photoBtn").addEventListener("click", () => photoMode(true));
$("photoExit").addEventListener("click", () => photoMode(false));
$("photoShoot").addEventListener("click", shoot);
$("photoClose").addEventListener("click", closePhoto);
$("photoIn").addEventListener("click", () => photoZoom(0.8));
$("photoOut").addEventListener("click", () => photoZoom(1.25));
$("photoMe").addEventListener("click", () => {
  if (!photo) return;
  photo.hide = !photo.hide;
  $("photoMe").setAttribute("aria-pressed", String(photo.hide));
});
$("photoTime").addEventListener("input", (e) => {
  if (photo) photo.time = Number(e.target.value);
  photoClock();
});
/// The hour the time slider is at (the day starts at midnight).
function photoClock() {
  const m = Math.round(Number($("photoTime").value) * 24 * 60) % (24 * 60);
  $("photoClock").textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

let mode = "title"; // title | intro | play
let intro = null;
/// Leave the title for the planet (logging in first on a real chain). True if the game started.
async function begin() {
  if (mode !== "title") return false;
  // First, while the click still counts as permission to play sound.
  music.start();
  sounds.start();
  // On a real chain you log in with your wallet before playing.
  const chain = await chainReady;
  if (chain && chain.browserWallet && !chain.account) {
    try {
      if (!(await chain.login())) return false;
    } catch (e) {
      toast(explain(e), "error");
      return false;
    }
    office?.refresh();
  }
  mode = "intro";
  intro = { k: 0, from: world.quaternion.clone() };
  $("title").classList.add("gone");
  return true;
}
$("begin").addEventListener("click", begin);
// The skins mint, from the title (into the game, then the mint) or the corner of the screen.
$("skinMint").addEventListener("click", async () => {
  if (await begin()) office?.showSkins();
});
$("skinMintHud").addEventListener("click", () => office?.showSkins());
/// Show the mint buttons only while the skins sale is on.
function skinButtons(s) {
  const on = !!s?.skins?.saleOpen && s.skins.minted < SKIN_SUPPLY;
  $("skinMint").hidden = !on;
  $("skinMintHud").hidden = !on;
}

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
let swimming = false, swimK = 0; // out of your depth: treading water, slowly
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
  if (settings.gfx !== "auto" || raw > 0.25) return; // fixed by the player; or a hitch or a hidden tab, not a trend
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

// ---------------------------------------------------------------- settings: graphics, frame rate, fullscreen

// Graphics presets. Auto starts high and lowers the resolution when frames run slow (and raises it
// again when there's room); the others hold still.
const GFX = {
  auto: { quality: 1, maxDpr: 2, shadows: "high", tufts: true },
  high: { quality: 1, maxDpr: 2, shadows: "high", tufts: true },
  medium: { quality: 0.85, maxDpr: 1.5, shadows: "low", tufts: true },
  low: { quality: 0.65, maxDpr: 1, shadows: "off", tufts: false },
};
const settings = { gfx: "auto", fps: 0, showFps: false, chat: true }; // fps: 0 is as fast as the screen refreshes
try { Object.assign(settings, JSON.parse(localStorage.getItem("courier:settings")) ?? {}); } catch {}
if (!GFX[settings.gfx]) settings.gfx = "auto";
function applySettings() {
  const g = GFX[settings.gfx];
  quality = g.quality;
  W.setQuality(quality);
  W.setGraphics(g);
  $("fps").hidden = !settings.showFps;
  chatUI.setEnabled(settings.chat !== false);
  for (const b of $("settings").querySelectorAll("button[data-k]")) b.classList.toggle("on", String(settings[b.dataset.k]) === b.dataset.v);
  try { localStorage.setItem("courier:settings", JSON.stringify(settings)); } catch {}
}
$("settings").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-k]");
  if (!b) return;
  const { k, v } = b.dataset;
  settings[k] = k === "gfx" ? v : k === "fps" ? Number(v) : v === "true";
  applySettings();
});
$("chatUnmute").addEventListener("click", () => {
  chatUI.unmuteAll();
  toast("Everyone in chat is unmuted");
});
$("setBtn").addEventListener("click", () => {
  $("settings").hidden = !$("settings").hidden;
  $("setBtn").setAttribute("aria-expanded", String(!$("settings").hidden));
});
// Fullscreen, where the browser allows it (iPhones don't, for pages): the button, or F.
const fsEl = () => document.fullscreenElement ?? document.webkitFullscreenElement;
const canFullscreen = document.fullscreenEnabled || document.webkitFullscreenEnabled;
function toggleFullscreen() {
  if (fsEl()) (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
  else {
    const el = document.documentElement;
    (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
  }
}
$("fullBtn").hidden = !canFullscreen;
$("fullBtn").addEventListener("click", toggleFullscreen);
for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) {
  document.addEventListener(ev, () => {
    $("fullBtn").classList.toggle("on", !!fsEl());
    $("fullBtn").title = fsEl() ? "Exit fullscreen (F)" : "Fullscreen (F)";
  });
}
// The frame rate limit, and the counter.
let lastFrame = 0, fpsFrames = 0, fpsSince = performance.now();
function tick(now) {
  if (settings.fps && now - lastFrame < 1000 / settings.fps - 2) {
    requestAnimationFrame(tick);
    return;
  }
  lastFrame = now;
  if (settings.showFps && ++fpsFrames && now - fpsSince > 500) {
    $("fps").textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} FPS`;
    [fpsFrames, fpsSince] = [0, now];
  }
  frame();
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
      introduce();
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
    if (swimming) want.multiplyScalar(0.5);
    else if (wading) want.multiplyScalar(0.7); // slower through the water
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
    // (On foot, from the step you're standing on, not the height you're still easing up to: on a fast ride you'd
    // fall behind a staircase and through it. And up the stairs, as far as you've come up them this frame.)
    const ground = W.terrain.surfaceAt(p, air ? bodyY : Math.max(bodyY, footY), air ? 0.05 : STEP, air ? 0 : dist * 0.7);
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (jumpBuffer > 0 && !air && !dialog && !swimming) {
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
    // Feet in the water: slower, and splashing; out of your depth, you swim.
    const water = W.terrain.waterAt(p);
    wading = water !== null && bodyY < water + 0.05;
    swimming = wading && !air && ground <= SWIM + 0.02;
    splashIn -= dt;
    if (wading && splashIn <= 0 && (v > 0.6 || swimming)) {
      splashAt(swimming ? 0.3 : 0.22, swimming && v > 0.4 ? 2 : 1);
      splashIn = swimming ? (v > 0.4 ? 0.42 : 1.1) : 0.18;
    }
    swimK += ((swimming ? 1 : 0) - swimK) * (1 - Math.exp(-dt * 6));
    player.ch.setSwim(swimK);
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
    padHint(p);

    let f;
    if (photo) f = photoCam();
    else {
      steerCamera(dt);
      f = followCam();
    }
    const k = 1 - Math.exp(-dt * (photo ? 12 : 8));
    camPos.lerp(f.pos, k);
    camLook.lerp(f.look, k);
    if (photo) player.group.visible = !photo.hide && photo.dist > 0;
  }

  const stepped = player.update(dt, moveSpeed, t, Math.min(1, jumpY * 4), dist);
  // A puff with each running step.
  if (stepped && moveSpeed > 0.8 && mode === "play" && !wading) kick({ n: 1, size: 0.3, spread: 0.4, life: 0.45 });
  dust.update(dt, 1 - 0.55 * W.night);
  sparkle.update(dt);
  district.tick(t);
  splash.update(dt, 1 - 0.5 * W.night);
  const got = stamps.update(dt, t, { me: localPos(), chest: bodyY + 0.85, active: mode === "play" && !dialog });
  if (got) collected(got);
  life.update(dt, t, { me: localPos(), speed: mode === "play" ? moveSpeed : 0, night: W.night, rain: weather.rain, active: mode === "play" });
  orbAds?.update(dt);
  // Times Square's big screens show the Orb's ad too.
  if (W.square && orbAds && orbAds.current() !== squareAd) {
    squareAd = orbAds.current();
    W.square.showAd(squareAd, orbAds.pictureOf(squareAd));
  }
  net.update(dt, t, mode === "play" ? netState() : null, localPos(), mode !== "play");
  waveT = Math.max(0, waveT - dt);
  player.ch.setWave(waveT > 0 ? Math.min(1, waveT * 3, (1.6 - waveT) * 6) : 0);
  if (mode !== "title") {
    if (!photo) timeOfDay += dt / DAY_SECONDS; // (photo mode holds the clock where you set it)
    stepWeather(dt);
  }
  W.setRain(weather.rain);
  W.setTimeOfDay(photo ? photo.time : timeOfDay);
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
  W.setCutaway(mode === "play" && !photo ? player.group.position.clone().multiplyScalar((R + bodyY + 0.9) / (R + bodyY)) : null);
  W.render(t);
  if (photo?.shoot && --photo.shoot === 0) capture();
  requestAnimationFrame(tick);
}

/// The name of the place you're in, shown big for a few seconds when you arrive (once you've been
/// there for a moment, so walking along a border doesn't flicker).
let place = null, placeNext = null, placeFor = 0;
function placeTitle(p, dt) {
  const z = W.square && arc(p, W.square.d) < W.square.r ? W.square : W.terrain.zoneAt(p);
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
  // The neon district hums too, a little quieter.
  if (A.neon) out.works = Math.max(out.works, 0.6 * (1 - Math.min(1, Math.max(0, (arc(p, A.neon.d) - A.neon.r) / 12))));
  // And Times Square, the city's busiest corner.
  if (W.square) out.works = Math.max(out.works, 0.5 * (1 - Math.min(1, Math.max(0, (arc(p, W.square.d) - W.square.r) / 12))));
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

let office = null, launchpad = null;
/// The post office panel and the Launchpad share the right-hand side: opening one closes the other.
function showOffice(on) {
  if (on) launchpad?.show(false);
  office?.show(on);
}
function showPad(on) {
  if (on) office?.show(false);
  launchpad?.show(on);
}
/// Near the Launchpad's door, once per visit: how to walk in.
let padHinted = false;
function padHint(p) {
  const door = launchpad && W.square?.pad;
  if (!door) return;
  const d = arc(p, door.d);
  if (!padHinted && d < door.reach + 0.6) {
    padHinted = true;
    toast(`🚀 The Launchpad: ${matchMedia("(pointer: coarse)").matches ? "tap Hi" : "press E"} to walk in and launch your own token`);
  } else if (padHinted && d > door.reach + 6) padHinted = false;
}
const chainReady = connectChain()
  .then(async (chain) => {
    if (!chain) return null;
    chainRef = chain;
    if (chain.browserWallet) {
      $("begin").textContent = "Log in & play";
      $("wallets").querySelector(".note").textContent =
        `Pick a wallet to play. Courier runs on ${chain.chainName}; your wallet will be asked to switch to it.`;
      await chain.resume().catch(() => false);
      if (chain.account) $("begin").textContent = "Begin";
      chain.onAccountChange(() => {
        huntState = null; // a different wallet signs in afresh
        office?.refresh();
        if (mode === "play") introduce();
        if (board) district.update(board.list, chain.account);
      });
    }
    $("officeBtn").hidden = false;
    office = createOffice(chain, {
      toast,
      hunt: chain.drops ? {
        state: () => huntState,
        running: () => droppingToday,
        async signIn() {
          await net.huntSignIn(chain.account, (message) => chain.drops.sign(message));
        },
        vouchers: () => net.vouchers(),
      } : null,
      onSnapshot(s) {
        autoAvatar(s);
        skinButtons(s);
      },
      wearing: () => skinWorn?.id ?? null,
      username,
      onWearSkin(m) {
        if (!m) {
          takeOffSkin(chain.account);
          toast("Back in your courier's clothes");
          return;
        }
        playingAccount = chain.account;
        wearSkin(m, chain.account);
        toast(`Now wearing ${SKINS[m.design].name}`);
      },
      onPlayAs(c) {
        playAs(c, chain.account);
        toast(`Now playing as ${c.name}, ${c.ride.name.toLowerCase()}`);
      },
      onLaunchpad: chain.pad ? () => showPad(true) : null,
    });
    if (chain.pad) {
      launchpad = createPad(chain, {
        toast,
        snap: () => office.snap,
        onLogin: () => chain.login().then(() => office.refresh(), (e) => toast(explain(e), "error")),
        openOffice: () => showOffice(true),
        imageApi: MP_HTTP,
        imageHosts: PICTURE_HOSTS,
        onTokens: (list) => W.square?.showLaunches(list),
      });
      if (!matchMedia("(pointer: coarse)").matches) $("help").textContent = $("help").textContent.replace(" · drag to look", " · L for the Launchpad · drag to look");
      const linked = new URLSearchParams(location.search).get("token");
      if (linked) setTimeout(() => launchpad.showToken(linked), 4000);
    }
    refreshBoard(chain);
    setInterval(() => refreshBoard(chain), 20_000);
    refreshDrops();
    return chain;
  })
  .catch((e) => {
    console.error(e);
    return null;
  });
$("officeBtn").addEventListener("click", () => showOffice($("office").hidden));
$("officeClose").addEventListener("click", () => office?.show(false));

hud();
applySettings();
titleCount();
setInterval(titleCount, 30_000);
requestAnimationFrame(tick);
