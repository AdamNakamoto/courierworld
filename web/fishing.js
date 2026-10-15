// Fishing in the bay: stand on the pier, a bridge over the bay or the water's edge, face the water and press E (or tap
// Hi). The room picks when a fish bites; hook it when the bobber dips, then keep the line's tension in the green until
// it's reeled in. The room checks the timing and that you stayed put, picks the species and keeps the catch, which you
// mint as a Courier Fish NFT in the Post Office panel (free; gas only). The fight runs here and only its end is sent,
// so fishing costs the room about four messages a fish (a position and the request, at the cast and at the landing).
import * as THREE from "https://esm.sh/three@0.160.0";
import { SEA_LEVEL } from "./terrain.js";
import { fishingSpot, BAY, HOOK_MS, CAST_GAP_MS } from "./fish-rules.js";
import { fishOf, tierOf, FISH_PER_DAY } from "./fish-kinds.js";
import { fishSvg } from "./fish-art.js";
import { huntDay } from "./hunt-pick.js";

const CAST_M = 4; // how far out the bobber lands
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/// `canAct()`: playing on the planet, on foot, not talking. `state()`: what the room is sent about you (netState).
/// `signedIn()` / `signIn()`: the treasure hunt's sign-in (fishing uses the same). `onCaught(id)` after a catch.
/// `needs()`: why you can't keep fish yet, if the game already knows (no post office), or null.
export function createFishing({ W, R, net, toast, sounds, player, me, ahead, state, canAct, signedIn, signIn, needs = () => null, onCaught = () => {} }) {
  const T = W.terrain;
  // ---- the bobber and the line
  const bobber = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe8453c }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.091, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  bobber.add(ball, cap);
  bobber.visible = false;
  W.world.add(bobber);
  const lineGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(3 * 12), 3));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.8 }));
  line.frustumCulled = false;
  line.visible = false;
  W.world.add(line);
  W.noNormals?.push?.(line);

  // ---- the card at the bottom of the screen: what's happening, the tension bar, the reel-in bar
  const ui = document.createElement("div");
  ui.className = "fish-ui card";
  ui.hidden = true;
  ui.innerHTML = `<div class="fish-say"></div><div class="fish-bars" hidden>
    <div class="fish-tension"><i class="zone"></i><i class="mark"></i></div>
    <div class="fish-reel"><i></i></div></div>`;
  document.getElementById("hud")?.append(ui);
  const say = ui.querySelector(".fish-say"), bars = ui.querySelector(".fish-bars");
  const zoneEl = ui.querySelector(".zone"), markEl = ui.querySelector(".mark"), reelEl = ui.querySelector(".fish-reel i");
  // The catch card.
  const card = document.createElement("div");
  card.className = "fish-card card";
  card.hidden = true;
  document.body.append(card);
  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) card.hidden = true;
  });

  // phase: idle | casting (asking the room) | waiting (for the bite) | bite (hook it!) | fight | landing (asking the room)
  let phase = "idle", cast = null, holding = false, lastCastAt = 0;
  let tension = 0.5, zone = 0.35, zoneW = 0.3, zoneV = 0.12, reel = 0.3, pull = 0, hookBy = 0, strain = 0;
  let fishState = null; // the room's ["fstate"]: { on, day, today, max, days }
  let hinted = false, hintIn = 0, awayFor = 0, signing = false;

  const busy = () => phase !== "idle";
  const show = (text) => {
    ui.hidden = false;
    say.innerHTML = text;
  };
  function end(text, kind = "ok") {
    phase = "idle";
    cast = null;
    holding = false;
    bobber.visible = line.visible = false;
    bars.hidden = true;
    player.ch.setFish?.(0, 0);
    if (text) {
      show(text);
      setTimeout(() => phase === "idle" && (ui.hidden = true), 2200);
    } else ui.hidden = true;
    if (kind === "error" && text) sounds.splash?.(0.3);
  }

  /// Where the bobber would land from where you stand, if it's the bay's water there.
  function castPoint() {
    const p = me(), out = p.clone().multiplyScalar(R).addScaledVector(ahead(), CAST_M).normalize();
    const inBay = Math.acos(Math.min(1, out.x * BAY.d[0] + out.y * BAY.d[1] + out.z * BAY.d[2])) < BAY.r - 0.02;
    return inBay && T.waterAt(out) !== null ? out : null;
  }
  /// The room's view of where you are (as it checks it), from what's sent about you.
  function roomState() {
    const s = state();
    return [s.p.x, s.p.y, s.p.z, s.f.x, s.f.y, s.f.z, s.h, s.air, s.spd, s.swim];
  }
  /// Whether pressing E here starts fishing (you're where the room allows it, facing the water).
  function canFish() {
    return canAct() && !!fishingSpot(roomState()) && !!castPoint();
  }

  async function startCast() {
    if (Date.now() - lastCastAt < CAST_GAP_MS + 400 || signing) return;
    if (fishState && !fishState.on) return toast("Fishing opens soon.", "error");
    const why = needs();
    if (why) return toast(why, "error");
    if (!signedIn()) {
      show("Sign in with your wallet to keep what you catch…");
      signing = true;
      try {
        await signIn();
      } catch (e) {
        return end(esc(e?.message ?? "Sign-in didn't go through."), "error");
      } finally {
        signing = false;
      }
      if (!signedIn()) return end();
    }
    const at = castPoint();
    if (!at) return end();
    lastCastAt = Date.now();
    phase = "casting";
    cast = { at, dir: at.clone() };
    bobber.position.copy(at).multiplyScalar(R + SEA_LEVEL + 0.04);
    orient(bobber, at);
    bobber.visible = line.visible = true;
    player.ch.setFish?.(1, 0);
    sounds.splash?.(0.4);
    show("Casting…");
    try {
      const { id, biteIn } = await net.fishCast();
      if (phase !== "casting") return;
      cast.id = id;
      cast.biteAt = performance.now() + biteIn;
      phase = "waiting";
      show("Waiting for a bite… <span class=\"muted\">press E again when the float dips</span>");
    } catch (e) {
      end(esc(e.message), "error");
    }
  }
  function hook() {
    phase = "fight";
    strain = 0;
    [tension, zone, zoneW, zoneV, reel, pull] = [0.5, 0.35 + Math.random() * 0.2, 0.26 + Math.random() * 0.1, (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.12), 0.3, 0];
    bars.hidden = false;
    show("Hooked! <b>Hold E</b> to reel, let go to give it line: keep the marker in the green.");
    sounds.collect?.();
  }
  async function land() {
    phase = "landing";
    bars.hidden = true;
    show("Landing it…");
    try {
      const got = await net.fishLand(cast.id);
      const k = fishOf(got.species);
      end();
      if (!k) return;
      if (fishState && got.day === fishState.day) fishState.today = got.today;
      sounds.collect?.();
      showCard(k, got);
      onCaught(k.id);
    } catch (e) {
      end(esc(e.message), "error");
    }
  }
  function showCard(k, got) {
    const t = tierOf(k.tier);
    card.innerHTML = `<div class="fish-pic">${fishSvg(k.id, 240)}</div>
      <h3>${esc(k.name)}</h3><p class="fish-tier" style="color:${t.ink}">${k.tier}</p><p class="note">${esc(k.blurb)}</p>
      <p class="note">${got.today}/${got.max} fish today. Mint your catch as Courier Fish in the Post Office panel (P): free, just gas.</p>
      <button class="pbtn primary" data-close>Nice!</button>`;
    card.hidden = false;
  }

  const orient = (obj, d) => obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  const tip = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  /// Draw the line from the rod's tip to the bobber, sagging a little.
  function drawLine() {
    if (!line.visible) return;
    W.world.updateMatrixWorld();
    if (player.ch.rodTip) {
      player.ch.rodTip.getWorldPosition(tip);
      W.world.worldToLocal(tip);
    } else tip.copy(me()).multiplyScalar(R + 1.6);
    const pos = lineGeo.attributes.position;
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      a.lerpVectors(tip, bobber.position, u);
      const sag = Math.sin(u * Math.PI) * (phase === "fight" ? 0.05 : 0.35);
      b.copy(a).normalize().multiplyScalar(-sag);
      pos.setXYZ(i, a.x + b.x, a.y + b.y, a.z + b.z);
    }
    pos.needsUpdate = true;
  }

  return {
    busy,
    canFish,
    /// The fishing state from the room (["fstate"]).
    setState(s) {
      fishState = s;
    },
    get state() { return fishState; },
    /// E (or Hi): cast, hook, or (in a fight) reel. Returns false if it didn't do anything (so E can talk or wave).
    press() {
      if (phase === "idle") {
        if (!canFish()) return false;
        if (fishState && fishState.day === huntDay() && fishState.today >= (fishState.max ?? FISH_PER_DAY)) {
          toast(`That's today's ${fishState.max ?? FISH_PER_DAY} fish. More bite from 00:00 UTC.`, "error");
          return true;
        }
        startCast();
        return true;
      }
      if (phase === "waiting") {
        end("Too soon: the fish swam off. Cast again.", "error");
        return true;
      }
      if (phase === "bite") {
        hook();
        holding = true;
        return true;
      }
      if (phase === "fight") holding = true;
      return true;
    },
    release() {
      holding = false;
    },
    /// Walking off reels the line in.
    cancel() {
      if (phase === "casting" || phase === "waiting" || phase === "bite" || phase === "fight") end("You reeled in.");
    },
    tick(dt, t) {
      if (phase === "idle") {
        // The first time you stand where you can fish, say how (again once you've been away from the water a while).
        hintIn -= dt;
        if (hintIn <= 0) {
          hintIn = 0.5;
          const here = canAct() && !!fishingSpot(roomState());
          if (here && !hinted) {
            hinted = true;
            toast(`🎣 You can fish here: face the water and ${matchMedia("(pointer: coarse)").matches ? "tap Hi" : "press E"}.`);
          }
          awayFor = here ? 0 : awayFor + 0.5;
          if (awayFor > 30) hinted = false;
        }
        return;
      }
      // The bobber bobs, and dips when a fish bites.
      if (cast?.at && bobber.visible) {
        const now = performance.now();
        if (phase === "waiting" && cast.biteAt && now >= cast.biteAt) {
          phase = "bite";
          hookBy = now + HOOK_MS;
          show("<b>Bite!</b> Press E now!");
          sounds.splash?.(1);
        }
        if (phase === "bite" && now > hookBy) return end("It got away. Cast again.", "error");
        const dip = phase === "bite" ? -0.22 + Math.sin(t * 30) * 0.05 : phase === "fight" ? -0.1 + Math.sin(t * 18) * 0.06 : Math.sin(t * 2.4) * 0.03;
        bobber.position.copy(cast.at).multiplyScalar(R + SEA_LEVEL + 0.04 + dip);
      }
      if (phase === "fight") {
        // The fish pulls this way and that; holding E reels (tension up), letting go gives it line (down).
        pull += (Math.random() - 0.5) * dt * 6;
        pull *= Math.exp(-dt * 1.5);
        tension += ((holding ? 0.85 : -0.75) + pull * 0.6) * dt;
        tension = Math.max(0, Math.min(1, tension));
        zone += zoneV * dt;
        if (zone < 0.05 || zone + zoneW > 0.95) zoneV = -zoneV;
        const inZone = tension >= zone && tension <= zone + zoneW;
        reel += (inZone ? 0.28 : -0.16) * dt;
        player.ch.setFish?.(1, inZone ? 0.4 : 1);
        zoneEl.style.left = `${(zone * 100).toFixed(1)}%`;
        zoneEl.style.width = `${(zoneW * 100).toFixed(1)}%`;
        markEl.style.left = `${(tension * 100).toFixed(1)}%`;
        reelEl.style.width = `${(Math.max(0, Math.min(1, reel)) * 100).toFixed(1)}%`;
        bars.classList.toggle("ok", inZone);
        // Held at full tension for half a second, the line snaps; reeled out to nothing, the fish is gone.
        strain = tension >= 0.99 ? strain + dt : 0;
        if (strain > 0.5) return end("Snap! The line broke. Cast again.", "error");
        if (reel <= 0) return end("It got away. Cast again.", "error");
        if (reel >= 1) land();
      }
      drawLine();
    },
  };
}
