// Courier Companions in the game: the little friend that follows your courier about (the kinds are in
// companion-kinds.js; who owns one is the CourierCompanions contract's business, not this module's). createFollower(id)
// builds one and keeps it trotting (or floating) along just behind the courier's right shoulder, anywhere on the sphere
// of whichever world they're on. The pets, the space buddies and the legendaries are built here; the mechas and the
// anime companions come from companions-premium.js. Every model is { group (feet at y 0, facing +z), animate(dt, t,
// speed) }, cel-shaded like the rest of the world; glowing bits are opaque and unlit, so the ink pass treats them like
// any other mesh. Like the courier, the parts that don't move on their own are merged per joint (compact() from
// character.js), so a cat of forty-odd parts draws in a dozen calls: other players' companions add up.
import * as THREE from "https://esm.sh/three@0.160.0";
import { RoundedBoxGeometry } from "https://esm.sh/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js";
import { toon } from "./world.js";
import { compact } from "./character.js";
import { companionOf } from "./companion-kinds.js";
import { PREMIUM } from "./companions-premium.js";

// ---- following

const BEHIND = 1.3, SIDE = 0.8; // where a companion keeps to: this far behind the courier and off to their right (m)
const ROW = 1.25; // with several, each pair (right, then left) this much further back than the one before (m)
const SPACE = 0.9; // and they keep about this far from each other
const HOVER = 0.9; // how high floaters fly above the ground (m)
const SETTLE = 0.25; // it stops once this close to its spot...
const WAKE = 0.7; // ...and only sets off again once the spot is this far away, so it doesn't fidget as you turn
const LOST = 15; // further than this from its spot (a flight, a teleport, a long fall): it simply appears there
const PERSONAL = 0.75; // it keeps at least this far from the courier, so it never walks through them
const STIFF = 5; // how quickly it closes on its spot (1/s): a critically damped spring at this rate
const WALK_V = 3.1, RUN_V = 5.8; // the courier's walk and run (main.js), to turn a pace in m/s into 0..1

// Scratch vectors for the per-frame maths (followers update one at a time, so they can share them).
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
const _a = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

/// Where the `i`th of a courier's companions keeps to (0 is the first, and the only one when there's one): { behind,
/// side } in metres, in pairs behind the courier, to their right then their left, each pair a little further back.
export function slotOf(i) {
  const row = Math.floor(i / 2);
  return { behind: BEHIND + ROW * row, side: (i % 2 ? -1 : 1) * (SIDE + 0.15 * row) };
}

/// The tangent at unit `a` pointing toward unit `b` along the great circle, as long as the walk there is (metres on a
/// sphere of radius R): how far, and which way, from a to b.
function toward(out, a, b, R) {
  const cos = a.dot(b);
  out.copy(b).addScaledVector(a, -cos);
  const sin = out.length();
  if (sin < 1e-9) return out.set(0, 0, 0);
  return out.multiplyScalar((R * Math.atan2(sin, cos)) / sin);
}
/// The spot `m` metres from unit `d` along the great circle that sets off in unit tangent direction `t`.
function walk(out, d, t, m, R) {
  const a = m / R;
  return out.copy(d).multiplyScalar(Math.cos(a)).addScaledVector(t, Math.sin(a)).normalize();
}
/// Some tangent at unit `c`, for when there's nothing better to face.
function anyTangent(out, c) {
  out.set(Math.abs(c.x) < 0.9 ? 1 : 0, Math.abs(c.x) < 0.9 ? 0 : 1, 0);
  return out.addScaledVector(c, -out.dot(c)).normalize();
}
/// The companion's spot for a courier at unit `dir` facing `fwd`: `behind` metres back and `side` to their right, walked
/// along the sphere. False (and `out` untouched) when `fwd` gives no facing at all.
function spotBehind(out, dir, fwd, R, behind = BEHIND, side = SIDE) {
  _f.copy(fwd).addScaledVector(dir, -fwd.dot(dir));
  if (_f.lengthSq() < 1e-10) return false;
  _f.normalize();
  _r.crossVectors(_f, dir); // the courier's right hand (they face +z with +y up, so their right is local -x)
  _o.copy(_f).multiplyScalar(-behind).addScaledVector(_r, side);
  const m = _o.length();
  walk(out, dir, _o.divideScalar(m), m, R);
  return true;
}
/// A pace in m/s as the 0..1 the animations use, the same way main.js measures the courier's.
const paceOf = (v) => (v <= WALK_V ? (0.62 * v) / WALK_V : Math.min(1, 0.62 + (0.38 * (v - WALK_V)) / (RUN_V - WALK_V)));
const ease = (rate, dt) => 1 - Math.exp(-dt * rate);

/// A companion of kind `id` that follows a courier: null for a kind this game doesn't know (or can't build).
/// { id, group, at, setSlot(i), place(dir, fwd, R, groundAt), update(dt, t, dir, fwd, R, groundAt, speed, others),
/// dispose() }: add `group` to the world group the courier walks on; `dir` and `fwd` are the courier's unit direction
/// from the world's centre and their facing, in that group's frame; R is the world's radius; groundAt(d) is the
/// ground's height above R at unit d; speed is the courier's pace, 0 (idle) to 1 (running). With several following
/// one courier, each has its own slot (slotOf), and `others` are the rest of them, which it keeps clear of; `at` is
/// its unit direction from the world's centre.
export function createFollower(id) {
  const kind = companionOf(id);
  const build = kind && (MODELS[id] ?? PREMIUM?.[id]);
  if (!build) return null;
  let model;
  try {
    model = build();
  } catch (e) {
    console.warn(`Companion ${id} could not be built`, e);
    return null;
  }
  if (!model?.group) return null;

  // group: where it stands on the sphere, turned to face its way. lean: floaters tip into their motion about their
  // middle, up at hover height. Inside that, the model animates itself.
  const group = new THREE.Group(), lean = new THREE.Group();
  group.add(lean);
  lean.add(model.group);
  const floats = kind.floats;
  if (floats) {
    lean.position.y = HOVER + kind.height / 2;
    model.group.position.y = -kind.height / 2;
  }

  const c = new THREE.Vector3(0, 1, 0); // its own unit direction from the world's centre
  const vel = new THREE.Vector3(); // its velocity, a tangent at c (m/s)
  const heading = new THREE.Vector3(0, 0, 1); // the way it faces, a unit tangent at c
  const spot = new THREE.Vector3(); // where it's heading for
  const lastLeader = new THREE.Vector3(), leaderVel = new THREE.Vector3(); // the courier, a frame ago, and their velocity
  let y = 0; // the ground under it (m above R), eased so it doesn't jump at every kerb
  let resting = true, placed = false, lastR = 0, pitch = 0, roll = 0, pace = 0;
  let slot = slotOf(0);

  /// Write c, heading and y into the group's position and orientation (up = c, forward = heading).
  function pose(R) {
    heading.addScaledVector(c, -heading.dot(c));
    if (heading.lengthSq() < 1e-10) anyTangent(heading, c);
    heading.normalize();
    _r.crossVectors(c, heading);
    group.quaternion.setFromRotationMatrix(_m.makeBasis(_r, c, heading));
    group.position.copy(c).multiplyScalar(R + y);
  }

  function place(dir, fwd, R, groundAt) {
    if (!spotBehind(spot, dir, fwd, R, slot.behind, slot.side)) spot.copy(dir); // (no facing: drop it on the courier and let it step aside)
    c.copy(spot);
    heading.copy(fwd);
    vel.set(0, 0, 0);
    leaderVel.set(0, 0, 0);
    lastLeader.copy(dir);
    y = groundAt(c);
    resting = placed = true;
    lastR = R;
    pitch = roll = pace = 0;
    lean.rotation.set(0, 0, 0);
    pose(R);
  }

  function update(dt, t, dir, fwd, R, groundAt, speed, others = null) {
    if (!placed || R !== lastR) return place(dir, fwd, R, groundAt); // (a new world: start beside the courier)
    dt = Math.min(dt, 0.1); // (after a stall, catch up calmly rather than in one leap)
    if (!(dt > 0)) return;

    // How fast the courier is going, measured from where they were: it rides along at their pace, so it doesn't lag
    // behind its spot. A jump cut (a teleport) isn't a velocity.
    toward(_d, lastLeader, dir, R);
    if (_d.lengthSq() > 9) _d.set(0, 0, 0);
    else _d.divideScalar(dt);
    leaderVel.lerp(_d, ease(10, dt));
    lastLeader.copy(dir);
    const leaderSpeed = leaderVel.length();
    const leaderMoving = leaderSpeed > 0.3 || speed > 0.05;

    spotBehind(spot, dir, fwd, R, slot.behind, slot.side); // (no facing this frame: keep the spot it had)
    // (The further back its slot, the further its spot swings when the courier turns round.)
    if (toward(_d, c, spot, R).length() > Math.max(LOST, 2 * Math.hypot(slot.behind, slot.side) + 2)) return place(dir, fwd, R, groundAt);

    // Fast enough to catch up with a running courier, or one on a ride.
    const maxV = Math.max(4.5, leaderSpeed * 1.3 + 2.5);
    const steps = Math.ceil(dt / (1 / 30)), h = dt / steps; // (small steps keep the spring steady)
    for (let i = 0; i < steps; i++) {
      const gap = toward(_d, c, spot, R).length();
      if (resting && (gap > WAKE || leaderMoving)) resting = false;
      else if (!resting && !leaderMoving && gap < SETTLE && vel.length() < 0.8) resting = true;
      if (resting) vel.multiplyScalar(Math.exp(-h * 10));
      else {
        // A critically damped spring toward the spot, moving with the courier's velocity (seen from where it is).
        _w.copy(leaderVel).addScaledVector(c, -leaderVel.dot(c)).sub(vel);
        _a.copy(_d).multiplyScalar(STIFF * STIFF).addScaledVector(_w, 2 * STIFF);
        vel.addScaledVector(_a, h);
      }
      // Out from underfoot: pushed away from the courier when it's too close (say they turned round onto it), and
      // slid round them sideways, so it can't get stuck pushing straight at them toward a spot on their far side.
      const near = toward(_w, c, dir, R).length();
      if (near < PERSONAL && near > 1e-4) {
        const push = (PERSONAL - near) / near;
        _a.crossVectors(c, _w);
        vel.addScaledVector(_w, -push * 30 * h).addScaledVector(_a, (vel.dot(_a) < 0 ? -push : push) * 20 * h);
      }
      // And clear of the courier's other companions (gently: their slots keep them apart once they settle).
      if (others) for (const o of others) {
        if (o === api) continue;
        const near2 = toward(_s, c, o.at, R).length();
        if (near2 < SPACE && near2 > 1e-4) vel.addScaledVector(_s, (-(SPACE - near2) / near2) * 12 * h);
      }
      let v = vel.length();
      if (v > maxV) {
        vel.multiplyScalar(maxV / v);
        v = maxV;
      }
      if (v >= 1e-5) {
        // Along the great circle it's heading on: the new spot, and its heading there (the same circle, turned on).
        const a = (v * h) / R, ca = Math.cos(a), sa = Math.sin(a);
        _u.copy(vel).divideScalar(v);
        vel.copy(_u).multiplyScalar(ca).addScaledVector(c, -sa).multiplyScalar(v);
        c.multiplyScalar(ca).addScaledVector(_u, sa).normalize();
        heading.addScaledVector(c, -heading.dot(c)).normalize(); // (carry its facing over to the new spot)
      }
      // The push above is gentle, and a sharp turn can still carry it into the courier: wherever it ended up, it's
      // never nearer than PERSONAL. It's set back out (straight away from them) and stops pressing inward.
      const apart = toward(_w, dir, c, R).length();
      if (apart < PERSONAL) {
        if (apart > 1e-6) _w.divideScalar(apart);
        else anyTangent(_w, dir);
        walk(c, dir, _w, PERSONAL, R);
        const inward = toward(_u, c, dir, R).length();
        if (inward > 1e-6) {
          const into = vel.dot(_u.divideScalar(inward));
          if (into > 0) vel.addScaledVector(_u, -into);
        }
        vel.addScaledVector(c, -vel.dot(c));
        heading.addScaledVector(c, -heading.dot(c)).normalize();
      }
    }

    // Facing: the way it's going; standing about, it turns to watch the courier.
    const v = vel.length();
    let rate = 9;
    if (v > 0.35) _w.copy(vel).divideScalar(v);
    else {
      rate = 2.5;
      if (toward(_w, c, dir, R).lengthSq() > 1e-6) _w.normalize();
      else _w.copy(heading);
    }
    const turn = Math.atan2(_a.crossVectors(heading, _w).dot(c), heading.dot(_w)) * ease(rate, dt);
    _a.crossVectors(c, heading);
    heading.multiplyScalar(Math.cos(turn)).addScaledVector(_a, Math.sin(turn));

    // Height: walkers step up onto things quickly and drop a little slower; floaters drift up and down gently, but
    // never let a slope rise into them.
    const ground = groundAt(c);
    if (floats) y = Math.max(y + (ground - y) * ease(3, dt), ground - 0.4);
    else y += (ground - y) * ease(ground > y ? 20 : 12, dt);
    pose(R);

    // Floaters tip forward as they speed along and bank into their turns (+x is their left: a turn that way rolls
    // them over toward it).
    if (floats) {
      _r.crossVectors(c, heading);
      const along = vel.dot(heading), across = vel.dot(_r), turnRate = turn / dt;
      const wantPitch = THREE.MathUtils.clamp(along * 0.07, -0.4, 0.4);
      const wantRoll = THREE.MathUtils.clamp(-(across + turnRate * v * 0.35) * 0.07, -0.45, 0.45);
      pitch += (wantPitch - pitch) * ease(5, dt);
      roll += (wantRoll - roll) * ease(5, dt);
      lean.rotation.set(pitch, 0, roll);
    }

    pace += ((resting && v < 0.2 ? 0 : paceOf(v)) - pace) * ease(8, dt);
    model.animate(dt, t, pace < 0.01 ? 0 : pace);
  }

  /// Free what's this companion's own. Its materials' textures are never freed: the only one they have is the toon
  /// gradient every material in the game shares (world.js).
  function dispose() {
    const geos = new Set(), mats = new Set();
    group.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) for (const m of [].concat(o.material)) mats.add(m);
      if (o.isSkinnedMesh) o.skeleton?.dispose(); // (the anime companions: their bone texture)
      if (o.isInstancedMesh) o.dispose(); // (its instance buffer)
    });
    for (const g of geos) g.dispose();
    for (const m of mats) if (!m.userData.shared) m.dispose(); // (the merged parts' material belongs to every character)
    group.removeFromParent();
  }

  /// Its place among the courier's companions (slotOf).
  function setSlot(i) {
    slot = slotOf(i);
  }

  const api = { id, group, at: c, setSlot, place, update, dispose };
  return api;
}

// ---- building blocks

const ball = (r, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.6)));
const capsule = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg);
const capsuleZ = (r, len, seg = 12) => capsule(r, len, seg).rotateX(Math.PI / 2); // (lying along z, like a body)
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
const lighten = (c, by = 0.4) => new THREE.Color(c).lerp(new THREE.Color(0xfff4e6), by).getHex();
const lerp = THREE.MathUtils.lerp;
/// Eyes shut for a blink about every `every` seconds.
const blinking = (t, every, ph = 0) => (t + ph) % every < 0.13;

/// One model's parts. Materials are shared within the model (one per colour) but never with another, so dispose()
/// frees only this companion's. add(): a cel-shaded mesh; glow(): an opaque unlit one; pivot(): a joint to turn.
function kit() {
  const mats = new Map();
  const mat = (color, extra) => {
    const key = extra ? `${color}:${JSON.stringify(extra)}` : color;
    if (!mats.has(key)) mats.set(key, toon(color, extra));
    return mats.get(key);
  };
  const glows = new Map();
  const glowMat = (color) => {
    if (!glows.has(color)) glows.set(color, new THREE.MeshBasicMaterial({ color }));
    return glows.get(color);
  };
  const put = (parent, m, x, y, z, sx, sy, sz) => {
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  return {
    add(parent, geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, extra) {
      const m = new THREE.Mesh(geo, mat(color, extra));
      m.castShadow = m.receiveShadow = true;
      return put(parent, m, x, y, z, sx, sy, sz);
    },
    glow(parent, geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
      return put(parent, new THREE.Mesh(geo, glowMat(color)), x, y, z, sx, sy, sz);
    },
    pivot(parent, x = 0, y = 0, z = 0) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    },
  };
}

/// A pair of eyes: a dark oval with a glint each, on joints that squash for a blink. Returns the joints.
function eyePair(add, pivot, parent, x, y, z, r, color = 0x1d1f27) {
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = pivot(parent, s * x, y, z);
    add(e, ball(r, 10), color, 0, 0, 0, 1, 1.2, 0.6);
    add(e, ball(r * 0.32, 6), 0xffffff, r * 0.3, r * 0.4, r * 0.5);
    eyes.push(e);
  }
  return eyes;
}
/// A smile: the lower half of a thin ring, flattened.
function smile(add, parent, r, tube, color, x, y, z) {
  const m = add(parent, new THREE.TorusGeometry(r, tube, 6, 16, Math.PI), color, x, y, z, 1, 0.6, 1);
  m.rotation.z = Math.PI;
  return m;
}

/// The four-legged walk the cat and the dog share. Legs swing in diagonal pairs, quicker and wider the faster they go,
/// and the body bobs. After `sitAfter` seconds standing still they sit: the torso tips back on its pivot at the
/// shoulders (so the rear goes down) and the hind legs fold forward under it. step(dt, speed) updates { ph (the gait's
/// phase), amp (0 standing to 1 striding), sit (0 to 1) }.
function fourLegs({ bob, torso, front, rear, lift, sitAfter, tilt = 0.5 }) {
  const st = { ph: 0, amp: 0, sit: 0, still: 0 };
  st.step = (dt, speed) => {
    const moving = speed > 0.04;
    st.still = moving ? 0 : st.still + dt;
    const sitting = st.still > sitAfter;
    st.amp += ((moving ? Math.min(1, 0.35 + speed) : 0) - st.amp) * ease(8, dt);
    st.ph += dt * (7 + 11 * speed);
    st.sit += ((sitting ? 1 : 0) - st.sit) * ease(sitting ? 3 : 10, dt);
    const swing = Math.sin(st.ph) * 0.7 * st.amp;
    front[0].rotation.x = swing;
    rear[1].rotation.x = swing - 1.0 * st.sit;
    front[1].rotation.x = -swing;
    rear[0].rotation.x = -swing - 1.0 * st.sit;
    torso.rotation.x = -tilt * st.sit;
    bob.position.y = Math.abs(Math.cos(st.ph)) * lift * st.amp;
  };
  return st;
}

// ---- the pets

/// A ginger post-office cat: stripes, a red collar with a bell, a tail that sways (carried high on the move, curled
/// round when it sits), ears that twitch.
function cat() {
  const { add, pivot } = kit();
  const GINGER = 0xe8954a, CREAM = 0xfbe6c8, STRIPE = 0xc4682c, PINK = 0xf0a0a8;
  const group = new THREE.Group(), bob = pivot(group);
  const torso = pivot(bob, 0, 0.18, 0.12); // (pivots at the shoulders: sitting tips the rear down)
  add(torso, capsuleZ(0.1, 0.2), GINGER, 0, 0.03, -0.12);
  add(torso, ball(0.085), CREAM, 0, -0.02, -0.1, 1, 0.8, 1.9); // belly
  for (const z of [-0.04, -0.12, -0.2]) add(torso, new THREE.TorusGeometry(0.1, 0.014, 6, 16, Math.PI), STRIPE, 0, 0.03, z);
  const front = [], rear = [];
  for (const s of [-1, 1]) {
    const hip = pivot(torso, s * 0.06, -0.02, -0.24);
    add(hip, ball(0.055), GINGER, 0, -0.02, 0.01, 0.8, 1.1, 1.1); // haunch
    add(hip, capsule(0.032, 0.1), GINGER, 0, -0.07, 0);
    add(hip, ball(0.036, 10), CREAM, 0, -0.135, 0.01, 1, 0.7, 1.2);
    rear.push(hip);
    const shoulder = pivot(bob, s * 0.06, 0.16, 0.12);
    add(shoulder, capsule(0.03, 0.1), GINGER, 0, -0.07, 0);
    add(shoulder, ball(0.034, 10), CREAM, 0, -0.135, 0.01, 1, 0.7, 1.2);
    front.push(shoulder);
  }
  const head = pivot(bob, 0, 0.33, 0.22);
  add(head, ball(0.105), GINGER, 0, 0, 0, 1.12, 0.95, 1);
  add(head, ball(0.05), CREAM, 0, -0.035, 0.075, 1.3, 0.8, 0.9); // muzzle
  add(head, ball(0.017, 8), PINK, 0, -0.012, 0.115); // nose
  for (const x of [-0.022, 0, 0.022]) add(head, new THREE.BoxGeometry(0.011, x ? 0.03 : 0.042, 0.012), STRIPE, x, 0.07, 0.07).rotation.x = -0.75; // (brow stripes)
  const eyes = eyePair(add, pivot, head, 0.045, 0.018, 0.092, 0.02, 0x2a3a1d);
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = pivot(head, s * 0.058, 0.075, -0.005);
    ear.rotation.z = -s * 0.32;
    add(ear, cone(0.042, 0.075, 10), GINGER, 0, 0.03, 0);
    add(ear, cone(0.026, 0.05, 8), PINK, 0, 0.022, 0.012);
    ears.push(ear);
    for (const k of [-1, 1]) add(head, new THREE.BoxGeometry(0.075, 0.004, 0.004), 0xfbf6ea, s * 0.075, -0.03 + k * 0.009, 0.09).rotation.z = s * k * 0.15;
  }
  add(bob, new THREE.TorusGeometry(0.075, 0.013, 6, 18), 0xd9534a, 0, 0.265, 0.19).rotation.x = -0.94; // collar
  add(bob, ball(0.02, 10), 0xf2c94c, 0, 0.218, 0.255); // its bell
  // The tail: four joints, so a sway runs down it like a wave.
  const tail = [];
  let joint = pivot(torso, 0, 0.06, -0.3);
  for (let i = 0; i < 4; i++) {
    if (i) joint = pivot(joint, 0, 0.075, 0);
    add(joint, capsule(0.024 - i * 0.002, 0.055, 8), i === 3 ? STRIPE : GINGER, 0, 0.04, 0);
    tail.push(joint);
  }
  const legs = fourLegs({ bob, torso, front, rear, lift: 0.018, sitAfter: 2.5 });
  compact(group);
  return {
    group,
    animate(dt, t, speed) {
      legs.step(dt, speed);
      const { ph, amp, sit } = legs;
      torso.scale.y = 1 + 0.03 * Math.sin(t * 2.4) * (1 - amp); // (breathing)
      head.position.y = 0.33 + 0.03 * sit + Math.sin(ph * 2) * 0.006 * amp;
      head.rotation.z = Math.sin(t * 0.6) * 0.14 * (1 - amp); // a curious head tilt, standing about
      head.rotation.x = -0.12 * sit;
      tail[0].rotation.x = lerp(-0.55 - 0.15 * amp, -1.3, sit);
      for (let i = 0; i < tail.length; i++) {
        tail[i].rotation.z = Math.sin(t * (1.6 + 2 * amp) - i * 0.7) * (0.25 + 0.08 * i) * (1 - 0.6 * sit) + 0.35 * sit;
        if (i) tail[i].rotation.x = 0.3 * (1 - sit);
      }
      ears[0].rotation.x = t % 5.3 < 0.16 ? -0.4 : 0; // a twitch now and then
      ears[1].rotation.x = (t + 2.1) % 7.9 < 0.16 ? -0.4 : 0;
      const shut = blinking(t, 4.1);
      for (const e of eyes) e.scale.y = shut ? 0.12 : 1;
    },
  };
}

/// A loyal pup with a tiny mailbag (a letter poking out), a teal collar with a gold tag, floppy ears, a tongue out
/// when it's been running, and a tail that never stops wagging.
function dog() {
  const { add, pivot } = kit();
  const COAT = 0xd9a46a, WHITE = 0xfbf3e4, EAR = 0x8a5a3a, PATCH = 0xb07a48, INK = 0x1d1f27;
  const group = new THREE.Group(), bob = pivot(group);
  const torso = pivot(bob, 0, 0.24, 0.13);
  add(torso, capsuleZ(0.12, 0.2), COAT, 0, 0.03, -0.15);
  add(torso, ball(0.1), WHITE, 0, 0.0, 0.02, 0.9, 1, 0.7); // chest
  add(torso, ball(0.09), PATCH, 0.03, 0.11, -0.18, 1, 0.6, 1.1); // a patch on its back
  // The mailbag on its left side, a strap round its middle, and a letter for someone.
  add(torso, new THREE.TorusGeometry(0.125, 0.012, 6, 24), 0x6e4a2c, 0, 0.03, -0.06).rotation.y = 0.2;
  add(torso, new THREE.BoxGeometry(0.055, 0.1, 0.13), 0x6e4a2c, 0.15, -0.01, -0.14);
  add(torso, new THREE.BoxGeometry(0.008, 0.055, 0.075), 0xfbf6ea, 0.14, 0.06, -0.165).rotation.x = 0.15;
  add(torso, new THREE.BoxGeometry(0.009, 0.016, 0.016), 0xd9534a, 0.145, 0.07, -0.185);
  add(torso, new THREE.BoxGeometry(0.06, 0.045, 0.135), 0x8a5e38, 0.152, 0.03, -0.14); // flap
  add(torso, new THREE.BoxGeometry(0.01, 0.02, 0.025), 0xf2c94c, 0.183, 0.01, -0.14); // buckle
  const front = [], rear = [];
  for (const s of [-1, 1]) {
    const hip = pivot(torso, s * 0.07, -0.02, -0.29);
    add(hip, ball(0.065), COAT, 0, -0.02, 0.01, 0.8, 1.1, 1.1);
    add(hip, capsule(0.04, 0.13), COAT, 0, -0.105, 0);
    add(hip, ball(0.045, 10), WHITE, 0, -0.205, 0.012, 1, 0.6, 1.3);
    rear.push(hip);
    const shoulder = pivot(bob, s * 0.07, 0.22, 0.12);
    add(shoulder, capsule(0.04, 0.13), COAT, 0, -0.105, 0);
    add(shoulder, ball(0.045, 10), WHITE, 0, -0.205, 0.012, 1, 0.6, 1.3);
    front.push(shoulder);
  }
  const head = pivot(bob, 0, 0.43, 0.22);
  add(head, ball(0.12), COAT);
  add(head, ball(0.065), WHITE, 0, -0.035, 0.1, 1, 0.8, 1.15); // snout
  add(head, ball(0.026, 10), INK, 0, -0.012, 0.17); // nose
  for (const s of [-1, 1]) add(head, ball(0.012, 8), EAR, s * 0.045, 0.075, 0.085); // eyebrows
  const eyes = eyePair(add, pivot, head, 0.05, 0.035, 0.103, 0.022);
  const tongue = add(head, capsule(0.018, 0.03, 8), 0xe8707a, 0.01, -0.085, 0.13, 1, 1, 0.5);
  tongue.rotation.x = 0.3;
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = pivot(head, s * 0.095, 0.06, -0.01);
    add(ear, ball(0.065), EAR, 0, -0.065, 0, 0.35, 1, 0.65);
    ears.push(ear);
  }
  add(bob, new THREE.TorusGeometry(0.08, 0.016, 6, 20), 0x2f8088, 0, 0.335, 0.19).rotation.x = -0.9; // collar
  add(bob, new THREE.CylinderGeometry(0.022, 0.022, 0.008, 12).rotateX(Math.PI / 2), 0xf2c94c, 0, 0.279, 0.262); // tag
  const tail = pivot(torso, 0, 0.09, -0.36), tailTip = pivot(tail, 0, 0.08, 0);
  add(tail, capsule(0.026, 0.07, 8), COAT, 0, 0.045, 0);
  add(tailTip, capsule(0.024, 0.05, 8), COAT, 0, 0.035, 0);
  add(tailTip, ball(0.028, 8), WHITE, 0, 0.075, 0);
  tailTip.rotation.x = 0.3;
  const legs = fourLegs({ bob, torso, front, rear, lift: 0.025, sitAfter: 1.5, tilt: 0.45 });
  let pant = 0;
  compact(group, new Set([tongue]));
  return {
    group,
    animate(dt, t, speed) {
      legs.step(dt, speed);
      const { ph, amp, sit } = legs;
      torso.scale.y = 1 + 0.035 * Math.sin(t * 2.2) * (1 - amp);
      head.position.y = 0.43 + 0.03 * sit + Math.sin(ph * 2) * 0.008 * amp;
      const tilt = Math.sin(t * 0.45);
      head.rotation.z = tilt * tilt * tilt * 0.25 * (1 - amp); // now and then, the head tilt
      // Panting for a while after a run.
      pant = speed > 0.3 ? Math.min(1, pant + dt) : Math.max(0, pant - dt * 0.25);
      tongue.visible = pant > 0.2;
      tongue.scale.y = 1 + 0.25 * Math.sin(t * 14);
      tail.rotation.x = lerp(-0.35, -1.35, sit); // (sitting, it sweeps the ground)
      tail.rotation.z = Math.sin(t * (11 + 6 * amp)) * (0.45 + 0.15 * amp);
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        ears[i].rotation.z = s * 0.2;
        ears[i].rotation.x = 0.5 * amp * speed + Math.sin(ph * 2 + i) * 0.2 * amp; // (flying back at a run)
      }
      const shut = blinking(t, 3.7, 1.3);
      for (const e of eyes) e.scale.y = shut ? 0.12 : 1;
    },
  };
}

/// A little green frog that hops after you: a leap is take-off, flight and landing, and a leap once started finishes,
/// so it never stops in mid-air. Standing about, its throat puffs.
function frog() {
  const { add, pivot } = kit();
  const GREEN = 0x6cc04a, BELLY = 0xeef3b6, SPOT = 0x4f9a35;
  const group = new THREE.Group(), body = pivot(group);
  group.scale.setScalar(1.15); // (drawn a touch small; this brings it up to its height)
  add(body, ball(0.13), GREEN, 0, 0.13, 0, 1.15, 0.85, 1.05);
  add(body, ball(0.1), BELLY, 0, 0.1, 0.08, 1, 0.8, 0.6);
  const throat = add(body, ball(0.055, 12), BELLY, 0, 0.09, 0.11, 1.2, 0.7, 0.6);
  for (const [x, y, z] of [[0.05, 0.215, -0.06], [-0.06, 0.225, -0.02], [0.0, 0.19, -0.11]]) add(body, ball(0.022, 8), SPOT, x, y, z, 1, 0.5, 1);
  for (const s of [-1, 1]) {
    add(body, ball(0.055, 12), GREEN, s * 0.065, 0.24, 0.05);
    add(body, ball(0.02, 8), 0xf2a0a0, s * 0.095, 0.16, 0.11, 1, 0.6, 0.5); // cheeks
  }
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = pivot(body, s * 0.065, 0.255, 0.075);
    add(e, ball(0.04, 12), 0xffffff);
    add(e, ball(0.022, 8), 0x1d1f27, 0, 0, 0.03);
    eyes.push(e);
  }
  smile(add, body, 0.06, 0.008, 0x3a6a2a, 0, 0.15, 0.135);
  const thighs = [];
  for (const s of [-1, 1]) {
    const thigh = pivot(body, s * 0.1, 0.07, -0.04);
    add(thigh, ball(0.06), GREEN, 0, 0, 0, 0.8, 0.7, 1.4);
    add(thigh, ball(0.045, 10), GREEN, 0, -0.06, 0.06, 1.1, 0.3, 1.5);
    thighs.push(thigh);
    add(body, capsule(0.022, 0.05, 8), GREEN, s * 0.07, 0.04, 0.09);
    add(body, ball(0.03, 8), GREEN, s * 0.075, 0.008, 0.11, 1.2, 0.3, 1.2);
  }
  let hp = 0; // the leap's progress, 0..1 (0: sat on the ground)
  compact(group, new Set([throat]));
  return {
    group,
    animate(dt, t, speed) {
      const moving = speed > 0.04;
      if (moving || hp > 0) {
        hp += dt * (2 + 2.6 * speed);
        if (hp >= 1) hp = moving ? hp - 1 : 0;
      }
      const AIR = 0.62; // (the first part of a leap is in the air, the rest gathering for the next)
      if (hp > 0 && hp < AIR) {
        const a = hp / AIR, arc = Math.sin(a * Math.PI);
        body.position.y = arc * (0.07 + 0.11 * Math.min(1, speed));
        body.rotation.x = -0.35 * Math.cos(a * Math.PI); // nose up taking off, down coming in to land
        body.scale.set(0.95, 1.08, 0.95);
        for (const th of thighs) th.rotation.x = 1.1 * arc; // (legs kicked out behind)
      } else {
        const squash = hp > 0 ? Math.sin(((hp - AIR) / (1 - AIR)) * Math.PI) * 0.12 : 0;
        body.position.y = 0;
        body.rotation.x = 0;
        body.scale.set(1 + squash, 1 - squash + (hp > 0 ? 0 : 0.025 * Math.sin(t * 2.4)), 1 + squash);
        for (const th of thighs) th.rotation.x = 0;
      }
      const puff = !moving && t % 3.2 < 1.1 ? Math.max(0, Math.sin(t * 9)) : 0;
      throat.scale.set(1.2 + 0.4 * puff, 0.7 + 0.3 * puff, 0.6 + 0.6 * puff);
      const shut = blinking(t, 3.3, 0.7);
      for (const e of eyes) e.scale.y = shut ? 0.15 : 1;
    },
  };
}

// ---- the space buddies

/// A pocket flying saucer: a silver hull that slowly spins, a ring of lights chasing round its rim, a blinking
/// beacon and a pulsing tractor-beam emitter underneath.
function ufo() {
  const { add, glow, pivot } = kit();
  const group = new THREE.Group(), drift = pivot(group), hull = pivot(drift);
  add(hull, ball(0.26, 24), 0xc9ced6, 0, 0.16, 0, 1, 0.3, 1);
  add(hull, ball(0.16, 18), 0x8d9790, 0, 0.11, 0, 1, 0.35, 1);
  add(hull, new THREE.TorusGeometry(0.26, 0.025, 6, 32), 0x5a5f6e, 0, 0.16, 0).rotation.x = Math.PI / 2;
  add(hull, new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x9fe3f0, 0, 0.2, 0);
  add(hull, ball(0.025, 8), 0xffffff, 0.05, 0.31, 0.06); // a highlight on the dome
  add(hull, new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), 0x5a5f6e, 0, 0.36, 0);
  const beacon = glow(hull, ball(0.018, 8), 0xff3b3b, 0, 0.4, 0);
  const COLORS = [0xff4fa0, 0xffd23f, 0x5ff3ff];
  const lights = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, x = Math.sin(a) * 0.285, z = Math.cos(a) * 0.285;
    add(hull, ball(0.016, 8), 0x3b4145, x, 0.16, z); // (the bulb's socket, seen when it's off)
    lights.push(glow(hull, ball(0.022, 8), COLORS[i % 3], x, 0.16, z));
  }
  const beam = glow(hull, new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), 0x9dff9a, 0, 0.055, 0);
  compact(group);
  return {
    group,
    animate(dt, t, speed) {
      drift.position.y = Math.sin(t * 2) * 0.05;
      drift.rotation.z = Math.sin(t * 1.3) * 0.06;
      hull.rotation.y += dt * (1.2 + 2 * speed);
      const chase = Math.floor(t * (5 + 6 * speed));
      for (let i = 0; i < lights.length; i++) lights[i].visible = (i + chase) % 3 !== 0;
      beacon.visible = t % 1.1 < 0.55;
      beam.scale.setScalar(0.8 + 0.25 * Math.sin(t * 5));
    },
  };
}

/// A hovering helper bot: a white rounded body, a big screen face with glowing eyes that blink (and a smile), a
/// rotor on top and little arms that dangle and swing.
function drone() {
  const { add, glow, pivot } = kit();
  const WHITE = 0xf2f0ea, TEAL = 0x2f8088, FACE = 0x5ff3ff;
  const group = new THREE.Group(), drift = pivot(group);
  add(drift, new RoundedBoxGeometry(0.3, 0.24, 0.22, 3, 0.06), WHITE, 0, 0.2, 0);
  add(drift, new RoundedBoxGeometry(0.24, 0.16, 0.02, 2, 0.008), 0x1b1c1f, 0, 0.21, 0.105);
  const eyes = [];
  for (const s of [-1, 1]) eyes.push(glow(drift, capsule(0.017, 0.022, 8), FACE, s * 0.055, 0.228, 0.118, 1, 1, 0.3));
  glow(drift, new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), FACE, 0, 0.185, 0.118, 1, 0.7, 0.4).rotation.z = Math.PI;
  for (const s of [-1, 1]) add(drift, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16).rotateZ(Math.PI / 2), TEAL, s * 0.155, 0.2, 0);
  add(drift, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6), 0x5a5f6e, 0, 0.345, 0);
  const rotor = pivot(drift, 0, 0.372, 0);
  add(rotor, ball(0.02, 8), TEAL);
  for (const r of [0, Math.PI / 2]) add(rotor, new THREE.BoxGeometry(0.32, 0.008, 0.035), 0x3b4145).rotation.y = r;
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = pivot(drift, s * 0.12, 0.12, 0.02);
    add(arm, capsule(0.018, 0.06, 8), TEAL, 0, -0.045, 0);
    add(arm, ball(0.024, 8), WHITE, 0, -0.09, 0);
    arms.push(arm);
  }
  const jet = glow(drift, new THREE.TorusGeometry(0.045, 0.01, 6, 16), FACE, 0, 0.075, 0);
  jet.rotation.x = Math.PI / 2;
  compact(group);
  return {
    group,
    animate(dt, t, speed) {
      drift.position.y = Math.sin(t * 2.4) * 0.04;
      drift.rotation.z = Math.sin(t * 1.1) * 0.05;
      rotor.rotation.y += dt * (28 + 14 * speed);
      arms[0].rotation.x = Math.sin(t * 2.2) * 0.25 + 0.6 * speed; // (trailing back at speed)
      arms[1].rotation.x = Math.sin(t * 2.2 + 1.4) * 0.25 + 0.6 * speed;
      const shut = blinking(t, 3.6), look = Math.sin(t * 0.7) * 0.012;
      for (let i = 0; i < 2; i++) {
        eyes[i].scale.y = shut ? 0.15 : 1;
        eyes[i].position.x = (i ? 1 : -1) * 0.055 + look; // (glancing about)
      }
      jet.scale.setScalar(0.9 + 0.15 * Math.sin(t * 9));
    },
  };
}

/// A young Martian on their first trip off Mars: the townsfolk of Mars City (mars.js martianMesh) at under half the
/// size, with legs that step and arms that swing, and a dust scarf whose tail flutters out behind.
function martian() {
  const { add, glow, pivot } = kit();
  const SKIN = 0x8fd16a, GLOW = 0xff7ad9, SCARF = 0xe0653a, BOOT = 0x3b4145;
  const group = new THREE.Group(), small = pivot(group), body = pivot(small);
  small.scale.setScalar(0.42); // (built at Mars City's size, in its units)
  const belly = lighten(SKIN);
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, s * 0.15, 0.3, 0);
    add(hip, capsule(0.075, 0.16, 8), SKIN, 0, -0.13, 0);
    add(hip, ball(0.11, 12), BOOT, 0, -0.25, 0.05, 1, 0.55, 1.4);
    legs.push(hip);
    const arm = pivot(body, s * 0.32, 0.8, 0.04);
    add(arm, capsule(0.055, 0.22, 8), SKIN, s * 0.06, -0.1, 0).rotation.z = s * 0.55;
    add(arm, ball(0.07, 10), SKIN, s * 0.14, -0.24, 0.04);
    arms.push(arm);
  }
  add(body, capsule(0.34, 0.5, 18), SKIN, 0, 0.72, 0, 1, 1, 0.9);
  add(body, ball(0.26), belly, 0, 0.56, 0.16, 1, 1.15, 0.6);
  add(body, new THREE.TorusGeometry(0.33, 0.06, 6, 22), SCARF, 0, 0.74, 0, 1, 1, 0.92).rotation.x = Math.PI / 2;
  const scarf = pivot(body, 0.12, 0.76, -0.31);
  add(scarf, new THREE.BoxGeometry(0.1, 0.28, 0.05), SCARF, 0, -0.13, 0);
  const eye = pivot(body, 0, 1.08, 0.22);
  add(eye, ball(0.17), 0xffffff, 0, 0, 0.04, 1, 1, 0.8);
  add(eye, ball(0.08, 12), 0x1d1f27, 0, 0, 0.16);
  add(eye, ball(0.03, 8), 0xffffff, 0.03, 0.03, 0.23); // (a glint)
  smile(add, body, 0.1, 0.02, 0x5a2a3a, 0, 0.9, 0.29);
  add(body, new THREE.CylinderGeometry(0.018, 0.022, 0.32, 6), BOOT, 0, 1.44, 0);
  const tip = glow(body, ball(0.075, 10), GLOW, 0, 1.62, 0);
  let ph = 0, amp = 0;
  compact(group);
  return {
    group,
    animate(dt, t, speed) {
      const moving = speed > 0.04;
      amp += ((moving ? Math.min(1, 0.4 + speed) : 0) - amp) * ease(8, dt);
      ph += dt * (6 + 9 * speed);
      const swing = Math.sin(ph) * 0.6 * amp;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      arms[0].rotation.x = -swing * 0.8;
      arms[1].rotation.x = swing * 0.8;
      body.position.y = Math.abs(Math.sin(ph)) * 0.07 * amp; // a little hop in every step
      body.rotation.z = Math.sin(ph) * 0.08 * amp; // and a waddle
      body.scale.y = 1 + 0.035 * Math.sin(t * 2.6) * (1 - amp);
      scarf.rotation.x = 0.15 + 1.1 * speed + Math.sin(t * 11) * 0.12 * speed; // (out behind it on the move)
      scarf.rotation.z = Math.sin(t * 7) * 0.1 * speed;
      eye.scale.y = blinking(t, 4.3, 0.4) ? 0.12 : 1;
      tip.scale.setScalar(1 + 0.3 * Math.sin(t * 4));
    },
  };
}

// ---- the legendaries

/// A golden stamp come to life: perforated edges, a face on its front, little arms, a wisp of a tail, and sparkles
/// circling round it.
function spirit() {
  const { add, glow, pivot } = kit();
  const GOLD = 0xe8b93a, SHINE = { emissive: 0x4a3300 }, CREAM = 0xfbf6ea, INK = 0x2a1f1a;
  const group = new THREE.Group(), drift = pivot(group, 0, 0.36, 0), body = pivot(drift);
  add(body, new THREE.BoxGeometry(0.32, 0.4, 0.04), GOLD, 0, 0, 0, 1, 1, 1, SHINE);
  // Perforations: a row of little bumps round every edge, the way a stamp's edge looks. (Only the plate glows warm like
  // the hunt's golden stamps: glowing parts can't be merged, and there are thirty of these.)
  for (let i = 0; i < 7; i++) for (const y of [-0.2, 0.2]) add(body, ball(0.021, 8), GOLD, -0.15 + i * 0.05, y, 0);
  for (let i = 1; i < 8; i++) for (const x of [-0.16, 0.16]) add(body, ball(0.021, 8), GOLD, x, -0.2 + i * 0.05, 0);
  add(body, new THREE.BoxGeometry(0.24, 0.3, 0.01), CREAM, 0, 0, 0.022);
  add(body, new THREE.BoxGeometry(0.24, 0.3, 0.01), CREAM, 0, 0, -0.022);
  add(body, new THREE.CircleGeometry(0.07, 16), 0xd9534a, 0, 0.02, -0.028).rotation.y = Math.PI; // (the back is a stamp's)
  const eyes = eyePair(add, pivot, body, 0.055, 0.035, 0.03, 0.028, INK);
  smile(add, body, 0.035, 0.008, INK, 0, -0.03, 0.03);
  for (const s of [-1, 1]) add(body, ball(0.022, 8), 0xf2a0a0, s * 0.088, -0.015, 0.028, 1, 0.6, 0.3);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = pivot(body, s * 0.17, -0.02, 0);
    add(arm, capsule(0.022, 0.06, 8), GOLD, s * 0.02, -0.04, 0).rotation.z = s * 0.5;
    arms.push(arm);
  }
  const wisp = pivot(body, 0, -0.21, 0);
  add(wisp, cone(0.07, 0.17).rotateX(Math.PI), GOLD, 0, -0.085, 0, 1, 1, 0.6);
  add(wisp, ball(0.022, 8), GOLD, 0.03, -0.17, 0);
  const sparkles = [];
  for (let i = 0; i < 5; i++) {
    const m = glow(drift, new THREE.OctahedronGeometry(0.028), i % 2 ? 0xffe08a : 0xfff2b0);
    sparkles.push({ m, r: 0.27 + 0.04 * (i % 3), w: 1.3 + 0.35 * i, ph: (i / 5) * Math.PI * 2 });
  }
  compact(group);
  return {
    group,
    animate(dt, t, speed) {
      drift.position.y = 0.36 + Math.sin(t * 2.1) * 0.05;
      body.rotation.z = Math.sin(t * 1.4) * 0.08;
      body.rotation.y = Math.sin(t * 0.8) * 0.2;
      wisp.rotation.z = Math.sin(t * 2.6 + 1) * 0.35;
      wisp.rotation.x = 0.5 * speed; // (streaming out behind)
      arms[0].rotation.z = -0.2 + Math.sin(t * 3) * 0.25;
      arms[1].rotation.z = 0.2 - Math.sin(t * 3 + 0.8) * 0.25;
      const spin = 1 + 1.5 * speed;
      for (const s of sparkles) {
        const a = s.ph + t * s.w * spin;
        s.m.position.set(Math.cos(a) * s.r, Math.sin(t * 1.3 + s.ph) * 0.14, Math.sin(a) * s.r);
        s.m.rotation.y = t * 3 + s.ph;
        s.m.scale.setScalar(0.6 + 0.6 * Math.abs(Math.sin(t * 4 + s.ph * 2)));
      }
      const shut = blinking(t, 4.6, 2);
      for (const e of eyes) e.scale.y = shut ? 0.12 : 1;
    },
  };
}

/// A tiny rocket, white and red like the one on the landing pad, with a pair of eyes peering out of its porthole and
/// a flickering flame that grows as it speeds up.
function rocket() {
  const { add, glow, pivot } = kit();
  const WHITE = 0xf2f2f5, RED = 0xd9534a;
  const group = new THREE.Group(), ship = pivot(group, 0, 0.18, 0), hull = pivot(ship);
  add(hull, new THREE.CylinderGeometry(0.045, 0.06, 0.05, 14), 0x2a2a35, 0, 0.025, 0);
  add(hull, new THREE.CylinderGeometry(0.09, 0.09, 0.34, 18), WHITE, 0, 0.22, 0);
  add(hull, new THREE.CylinderGeometry(0.092, 0.092, 0.04, 18), RED, 0, 0.33, 0);
  add(hull, cone(0.09, 0.18, 18), RED, 0, 0.48, 0);
  add(hull, new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16).rotateX(Math.PI / 2), 0x8db8c6, 0, 0.22, 0.088);
  add(hull, new THREE.TorusGeometry(0.042, 0.008, 6, 18), 0xc9ced6, 0, 0.22, 0.092);
  const eyes = eyePair(add, pivot, hull, 0.013, 0.222, 0.099, 0.009);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 3 + (i / 3) * Math.PI * 2; // (one fin straight back, none over the porthole)
    add(hull, new THREE.BoxGeometry(0.012, 0.11, 0.08), RED, Math.sin(a) * 0.1, 0.1, Math.cos(a) * 0.1).rotation.y = a;
  }
  // The flame: a short yellow cone at the nozzle with a longer orange one through it, so the tip burns orange.
  const flame = pivot(ship);
  glow(flame, cone(0.046, 0.09).rotateX(Math.PI), 0xfff2b0, 0, -0.045, 0);
  glow(flame, cone(0.034, 0.17).rotateX(Math.PI), 0xff8a2a, 0, -0.085, 0);
  compact(group);
  return {
    group,
    animate(dt, t, speed) {
      ship.position.y = 0.18 + Math.sin(t * 2.3) * 0.04;
      hull.rotation.y = Math.sin(t * 0.9) * 0.25;
      hull.rotation.z = Math.sin(t * 1.5) * 0.04;
      const flicker = Math.sin(t * 31) * 0.5 + Math.sin(t * 47 + 1) * 0.3 + Math.sin(t * 13) * 0.2;
      flame.scale.set(1 + 0.08 * flicker, 1 + 0.22 * flicker + 0.5 * speed, 1 + 0.08 * flicker);
      const shut = blinking(t, 3.9, 1.1);
      for (const e of eyes) e.scale.y = shut ? 0.12 : 1;
    },
  };
}

/// The builders made here, by kind id (the premium ones are in companions-premium.js).
const MODELS = { 1: cat, 2: dog, 3: frog, 11: ufo, 12: drone, 13: martian, 21: spirit, 22: rocket };
