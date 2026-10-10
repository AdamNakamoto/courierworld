// The places beyond the town: the seaside (beach, lighthouse, pier, boats), Falls Hill (rock
// plateaus, waterfalls, the pond and stairs up to a shrine), the woods, the old works (tanks,
// pipes, a chimney, a catwalk) and a footbridge over Main Street. Built with world.js's kit, so
// the static parts bake into the town mesh like everything else.
import * as THREE from "https://esm.sh/three@0.160.0";
import { bodyMaterial, riverMaterial, waterfall } from "./water.js";
import { SEA_LEVEL } from "./terrain.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildBiomes(k) {
  const { R, C, part, box, terrain: T, world, noNormals, ROAD_HW, WALK, nearestRoad } = k;
  const rnd = k.rng;
  const range = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const arc = (a, b) => R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  /// Two tangent directions at d.
  const basis = (d) => {
    const e1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
    return [e1, new THREE.Vector3().crossVectors(d, e1)];
  };
  /// The spot `m` metres from d along tangent `t`.
  const step = (d, t, m) => d.clone().multiplyScalar(R).addScaledVector(t, m).normalize();
  /// The spot at angle rho (radians) from c, round at azimuth a.
  const around = (c, rho, a) => {
    const [e1, e2] = basis(c);
    return c.clone().multiplyScalar(Math.cos(rho)).add(e1.multiplyScalar(Math.cos(a) * Math.sin(rho)).add(e2.multiplyScalar(Math.sin(a) * Math.sin(rho)))).normalize();
  };
  const tangentTo = (from, to) => to.clone().sub(from).addScaledVector(from, -to.clone().sub(from).dot(from)).normalize();
  const free = (d, r) => !k.blocked(d, r) && k.clearOf(d, r) && T.waterAt(d) === null;
  /// The spin that faces local +z along tangent t at d.
  const spinAlong = (d, t) => k.spinToward(d, step(d, t, 1));
  /// A rod (cylinder) between two points in the group's space.
  const rod = (g, a, b, r, color, segs = 8) => {
    const dir = b.clone().sub(a);
    const m = part(g, new THREE.CylinderGeometry(r, r, dir.length(), segs), color);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
    return m;
  };
  /// Stairs rising along +z from z0 to z0+len, from height 0 to h, width w: solid (stone, built into
  /// a hill) or open (treads on sloping side beams, with handrails).
  const stairs = (g, len, h, w, color, sideColor, { solid = true, z0 = -len / 2 } = {}) => {
    const n = Math.max(3, Math.round(h / 0.21)), d = len / n;
    if (solid) {
      for (let i = 0; i < n; i++) box(g, w, (h * (i + 1)) / n, d + 0.01, i % 2 ? color : C.curb, 0, (h * (i + 1)) / n / 2, z0 + d * (i + 0.5));
      for (const s of [-1, 1]) box(g, 0.14, h + 0.12, len, sideColor, s * (w / 2 + 0.07), (h + 0.12) / 2, z0 + len / 2);
      return;
    }
    for (let i = 0; i < n; i++) box(g, w, 0.06, d + 0.02, color, 0, (h * (i + 1)) / n - 0.03, z0 + d * (i + 0.5));
    for (const s of [-1, 1]) {
      const x = s * (w / 2 + 0.05);
      rod(g, V(x, -0.05, z0), V(x, h - 0.1, z0 + len), 0.06, sideColor, 6);
      rod(g, V(x, 0.95, z0 + d), V(x, h + 0.95, z0 + len), 0.03, sideColor, 5);
      for (let i = 0; i <= n; i += 3) {
        const y = (h * i) / n;
        rod(g, V(x, y, z0 + d * i), V(x, y + 0.95, z0 + d * i), 0.02, sideColor, 4);
      }
    }
  };
  /// Keep people from walking into the side of a staircase from below (but not up it).
  const stairSides = (ramp, parts = 4) => {
    for (let i = 1; i < parts; i++) {
      const a = (ramp.len * i) / parts, b = (ramp.len * (i + 1)) / parts;
      const mid = step(ramp.bottom, ramp.dir, (a + b) / 2);
      const h = ramp.h0 + ((ramp.h1 - ramp.h0) * i) / parts;
      // Slack for the courier's body width and for easing up each step.
      k.addRect(mid, spinAlong(mid, ramp.dir), ramp.hw, (b - a) / 2, null, { y1: h - 0.65 });
    }
  };
  /// A sign board with a painted face (kept as its own mesh so it can carry a texture).
  const signBoard = (draw, w, h, d, spin, lift, face = 0) => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = Math.round((256 * h) / w);
    draw(c.getContext("2d"), c.width, c.height);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), k.toon(0xffffff, { map: k.texFromCanvas(c) }));
    m.position.copy(d).multiplyScalar(R + lift);
    m.quaternion.copy(k.frameAt(d, spin));
    m.translateZ(face);
    world.add(m);
    return m;
  };
  const leaf = [C.leaf[2], C.leaf[0], C.leaf[1]];

  // ---------------------------------------------------------------- props

  function tallTree(s = 1) {
    const g = new THREE.Group();
    const hgt = range(4.2, 5.8) * s;
    part(g, new THREE.CylinderGeometry(0.13 * s, 0.22 * s, hgt, 7), 0x8a7f78, 0, hgt / 2, 0);
    for (let i = 0; i < 2; i++) {
      const a = rnd() * 6, y = hgt * range(0.45, 0.7);
      rod(g, V(0, y, 0), V(Math.cos(a) * 0.8 * s, y + 0.7 * s, Math.sin(a) * 0.8 * s), 0.05 * s, 0x8a7f78, 5);
    }
    const c = pick(leaf);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd(), r = range(0.4, 0.9) * s;
      part(g, new THREE.SphereGeometry(range(0.8, 1.2) * s, 9, 7), c, Math.cos(a) * r, hgt + range(-0.5, 0.7) * s, Math.sin(a) * r);
    }
    part(g, new THREE.SphereGeometry(1.0 * s, 9, 7), c, 0, hgt + 1.1 * s, 0);
    return g;
  }
  function pine(s = 1) {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.1 * s, 0.17 * s, 2.4 * s, 6), 0x7a5b45, 0, 1.2 * s, 0);
    const c = pick([0x3f7a4a, 0x4a8650, 0x37704a]);
    [[1.3, 1.6, 1.4], [1.05, 1.4, 2.4], [0.75, 1.2, 3.3]].forEach(([r, h, y]) => part(g, new THREE.ConeGeometry(r * s, h * s, 8), c, 0, y * s, 0));
    return g;
  }
  function fern() {
    const g = new THREE.Group();
    const c = pick([0x4f8c4c, 0x5e9f57]);
    for (let i = 0; i < 5; i++) {
      const m = part(g, new THREE.ConeGeometry(0.09, 0.7, 4), c, 0, 0.25, 0);
      m.rotation.set(range(0.6, 1.0), (i / 5) * Math.PI * 2, 0, "YXZ");
    }
    return g;
  }
  function mushroom() {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.04, 0.05, 0.18, 6), 0xf1ebdc, 0, 0.09, 0);
    part(g, new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xd9534a, 0, 0.17, 0);
    for (let i = 0; i < 3; i++) part(g, new THREE.SphereGeometry(0.02, 5, 4), 0xfbf6ea, Math.cos(i * 2.1) * 0.07, 0.25, Math.sin(i * 2.1) * 0.07);
    return g;
  }
  function rock(s = 1, color = 0xb9b2a3) {
    const g = new THREE.Group();
    const m = part(g, new THREE.DodecahedronGeometry(0.5 * s, 0), color, 0, 0.2 * s, 0);
    m.scale.set(range(0.8, 1.3), range(0.5, 0.8), range(0.8, 1.2));
    m.rotation.set(rnd(), rnd() * 6, rnd());
    return g;
  }
  function logPile() {
    const g = new THREE.Group();
    const m = part(g, new THREE.CylinderGeometry(0.22, 0.22, 2.2, 8), 0x7a5b45, 0, 0.22, 0);
    m.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) {
      const end = part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.02, 8), 0xd9b98a, s * 1.105, 0.22, 0);
      end.rotation.z = Math.PI / 2;
    }
    return g;
  }
  function umbrella(c1, c2) {
    const g = new THREE.Group();
    part(g, new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6), 0xf1ebdc, 0, 1.05, 0);
    for (let i = 0; i < 8; i++) {
      part(g, new THREE.ConeGeometry(1.1, 0.45, 2, 1, false, (i / 8) * Math.PI * 2, Math.PI / 4), i % 2 ? c1 : c2, 0, 2.05, 0);
    }
    box(g, 0.8, 0.02, 1.7, pick([0xe46f5f, 0x5d8fd1, 0xf2c94c, 0x7cc2b5]), 0.9, 0.02, 0.2); // towel
    return g;
  }

  // ---------------------------------------------------------------- the seaside

  {
    const c = T.sea.d, rho = T.SEA_R;
    // The lighthouse, back from the waterline where the shore is clear of streets.
    let lh = null;
    for (let i = 0; i < 48 && !lh; i++) {
      const d = around(c, rho + 0.11, (i / 48) * Math.PI * 2);
      if (nearestRoad(d) > 4.5 && free(d, 1.4)) lh = d;
    }
    if (lh) {
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const r0 = 1.0 - i * 0.1, r1 = 0.9 - i * 0.1;
        part(g, new THREE.CylinderGeometry(r1, r0, 1.4, 16), i % 2 ? 0xd9534a : 0xf4efe0, 0, 0.7 + i * 1.4, 0);
      }
      part(g, new THREE.CylinderGeometry(0.85, 0.85, 0.12, 16), 0x3b4145, 0, 7.06, 0);
      for (let i = 0; i < 12; i++) part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.45, 4), 0x3b4145, Math.cos(i * 0.52) * 0.8, 7.33, Math.sin(i * 0.52) * 0.8);
      part(g, new THREE.CylinderGeometry(0.42, 0.42, 0.7, 12), C.lamp, 0, 7.45, 0);
      part(g, new THREE.ConeGeometry(0.6, 0.6, 12), 0xd9534a, 0, 8.1, 0);
      box(g, 0.5, 0.95, 0.06, C.door, 0, 0.48, 0.98);
      const spin = spinAlong(lh, tangentTo(lh, c).negate()); // the door faces inland
      k.bake(g, lh, spin, T.landAt(lh));
      k.addCircle(lh, 1.05);
      k.taken.push({ d: lh, r: 1.8 });
      const door = step(lh, tangentTo(lh, c), -1.9);
      k.landmark({ dir: door, markerDir: step(lh, tangentTo(lh, c), -1.0), markerH: 9.4, spin, kind: "lighthouse", name: "Lighthouse keeper" });
      // A slow beam turning at night.
      const beamGeo = new THREE.ConeGeometry(1.4, 9, 16, 1, true).translate(0, -4.5, 0).rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.copy(lh).multiplyScalar(R + T.landAt(lh) + 7.45);
      beam.quaternion.copy(k.frameAt(lh, 0));
      world.add(beam);
      noNormals.push(beam);
      k.animate((t, night) => {
        beam.quaternion.copy(k.frameAt(lh, t * 0.6));
        beam.material.opacity = 0.16 * night;
        beam.visible = night > 0.05;
      });
    }

    // The pier, out from a clear stretch of beach.
    let pier = null;
    for (let i = 0; i < 64 && !pier; i++) {
      const a = (i / 64) * Math.PI * 2 + 1.3;
      const start = around(c, rho + 0.045, a), end = around(c, rho - 0.27, a);
      let ok = true;
      for (let s = 0; s <= 6; s++) if (nearestRoad(around(c, rho + 0.045 - (0.315 * s) / 6, a)) < ROAD_HW + WALK + 2.2) ok = false;
      if (ok && (!lh || arc(start, lh) > 6) && k.clearOf(start, 1)) pier = { a, start, end };
    }
    if (pier) {
      const len = arc(pier.start, pier.end), out = tangentTo(pier.start, pier.end), mid = step(pier.start, out, len / 2);
      const across = new THREE.Vector3().crossVectors(mid, tangentTo(mid, pier.end)).normalize();
      const deck = SEA_LEVEL + 0.5;
      for (let s = 0; s < len; s += 1) {
        const d = step(pier.start, out, s + 0.5), g = new THREE.Group();
        for (let p = 0; p < 2; p++) box(g, 1.7, 0.1, 0.48, p ? 0xa47c58 : 0xb98d5f, 0, -0.05, -0.25 + p * 0.5);
        for (const sx of [-0.78, 0.78]) {
          const floor = T.landAt(d) - deck;
          part(g, new THREE.CylinderGeometry(0.08, 0.08, -floor + 0.9, 6), 0x7a5b45, sx, (floor + 0.9) / 2, 0);
          box(g, 0.05, 0.05, 1.02, 0x7a5b45, sx, 0.85, 0);
        }
        k.bake(g, d, k.spinToward(d, step(d, out, 1)), deck);
      }
      const g = new THREE.Group();
      box(g, 1.4, 0.4, 0.4, 0xb98d5f, 0, 0.45, 0);
      k.bake(g, step(pier.start, out, len - 0.6), k.spinToward(pier.end, pier.start), deck);
      k.plate({ d: mid, right: across, front: tangentTo(mid, pier.end), hw: 0.85, hd: len / 2 + 0.05, h: deck });
      for (const sx of [-1, 1]) {
        const r = step(mid, across, sx * 0.86);
        k.addRect(r, spinAlong(r, out), 0.06, len / 2, null, { y0: deck - 0.2, y1: deck + 0.5 });
      }
      const endRail = step(pier.start, out, len + 0.05);
      k.addRect(endRail, spinAlong(endRail, out), 0.9, 0.06, null, { y0: deck - 0.2, y1: deck + 0.5 });
      const endSpot = step(pier.start, out, len - 1.2);
      k.npc({ d: step(endSpot, across, 0.45), y: deck, face: out, name: "Old Captain", look: { shirt: 0x5d8fd1, headwear: "bucket", accent: 0xf2c94c, bottomsStyle: "pants" },
        lines: ["Nothing biting today. The fish read the post too, I reckon.", "On a clear night you can see the lighthouse beam go right round the planet.", "I've walked off the end of this pier twice. Mind your step."] });
      k.stampSpot(step(endSpot, across, -0.4), deck);
    }

    // Umbrellas and towels, rocks, pines at the back of the beach, a sunbather.
    let umbrellas = 0;
    for (let i = 0; i < 80 && umbrellas < 7; i++) {
      const d = around(c, rho + range(0.05, 0.1), rnd() * Math.PI * 2);
      if (nearestRoad(d) < ROAD_HW + WALK + 1.2 || !free(d, 1.3)) continue;
      k.bake(umbrella(pick([0xe46f5f, 0x5d8fd1, 0xf2c94c]), 0xfbf6ea), d, rnd() * 6, T.landAt(d));
      k.addCircle(d, 0.12);
      k.taken.push({ d, r: 1.4 });
      if (umbrellas === 2) {
        k.npc({ d: step(d, basis(d)[0], 1.0), y: T.landAt(d), face: tangentTo(d, c), name: "Sunny", look: { shirt: 0xf2c94c, bottomsStyle: "shorts", headwear: "bucket" },
          lines: ["Best spot on the planet. Don't tell anyone.", "If you see a beach ball rolling round the world, it's mine.", "The water's warmer than it looks!"] });
      }
      umbrellas++;
    }
    for (let i = 0; i < 14; i++) {
      const d = around(c, rho + range(-0.01, 0.12), rnd() * Math.PI * 2);
      if (nearestRoad(d) < ROAD_HW + WALK + 0.8 || k.blocked(d, 0.5)) continue;
      k.bake(rock(range(0.7, 1.6), 0xc9bfa9), d, 0, T.landAt(d));
      k.addCircle(d, 0.35);
    }
    for (let i = 0; i < 30; i++) {
      const d = around(c, rho + range(0.13, 0.17), rnd() * Math.PI * 2);
      if (nearestRoad(d) < ROAD_HW + WALK + 1.2 || !free(d, 1.2)) continue;
      k.bake(pine(range(0.8, 1.1)), d, rnd() * 6, T.landAt(d));
      k.addCircle(d, 0.2);
      k.taken.push({ d, r: 1.2 });
    }
    // Boats and buoys bobbing on the bay.
    for (let i = 0; i < 6; i++) {
      const boat = i < 2;
      const d = around(c, rho - range(0.12, 0.3), rnd() * Math.PI * 2);
      if (nearestRoad(d) < ROAD_HW + WALK + 2) continue;
      const g = new THREE.Group();
      if (boat) {
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 2.2, 10, 1, false, 0, Math.PI), k.toon(0xf4efe0));
        hull.rotation.set(Math.PI / 2, 0, Math.PI);
        hull.scale.set(1, 1, 0.6);
        g.add(hull);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 2.0), k.toon(0x5d8fd1));
        stripe.position.y = 0.02;
        g.add(stripe);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.3), k.toon(0xb98d5f));
        seat.position.y = 0.05;
        g.add(seat);
      } else {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), k.toon(i % 2 ? 0xd9534a : 0xf4efe0));
        g.add(ball);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      world.add(g);
      const spin = rnd() * 6, ph = rnd() * 6;
      k.animate((t) => {
        g.position.copy(d).multiplyScalar(R + SEA_LEVEL + 0.04 + Math.sin(t * 1.3 + ph) * 0.05);
        g.quaternion.copy(k.frameAt(d, spin + Math.sin(t * 0.3 + ph) * 0.2));
        g.rotateX(Math.sin(t * 1.1 + ph) * 0.06);
        g.rotateZ(Math.cos(t * 0.9 + ph) * 0.05);
      });
    }

    // The water itself.
    const cap = new THREE.SphereGeometry(R + SEA_LEVEL, 96, 24, 0, Math.PI * 2, 0, rho + 0.03);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), c));
    const sea = new THREE.Mesh(cap, bodyMaterial({ center: c, radius: rho, R }));
    world.add(sea);
    k.ambient.sea = { d: c, r: rho };
  }

  // ---------------------------------------------------------------- Falls Hill

  {
    const pond = T.pond;
    const rockCol = 0xd7c9a3, rockDark = 0xb8a882, grass = 0x6aa95e;
    const falls = [];
    T.mesas.forEach((m, mi) => {
      // The plateau: an irregular rock column with darker bands and a grassy top.
      const g = new THREE.Group();
      const geo = new THREE.CylinderGeometry(m.r, m.r * 1.12, m.top + 0.6, 22, 4);
      const p = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const a = Math.atan2(v.z, v.x);
        const n = 1 + 0.06 * Math.sin(a * 3 + mi) + 0.04 * Math.sin(a * 7 + mi * 2) + 0.03 * Math.sin(v.y * 3 + a * 2);
        p.setXYZ(i, v.x * n, v.y, v.z * n);
      }
      part(g, geo, rockCol, 0, (m.top - 0.6) / 2, 0);
      for (let b = 1; b < 4; b++) {
        const y = (m.top * b) / 4;
        part(g, new THREE.CylinderGeometry(m.r * 1.02, m.r * 1.03, 0.07, 22), rockDark, 0, y, 0);
      }
      part(g, new THREE.CylinderGeometry(m.r * 1.01, m.r * 0.98, 0.3, 22), grass, 0, m.top - 0.1, 0);
      k.bake(g, m.d, 0, 0);
      const tree = tallTree(range(0.55, 0.75));
      const off = basis(m.d)[0];
      k.bake(tree, step(m.d, off, m.r * 0.45), rnd() * 6, m.top);
      // Too steep to climb, except up the stairs.
      let ramp = null;
      if (m.stairs) {
        const sideA = new THREE.Vector3().crossVectors(m.d, m.toPond).normalize();
        const len = m.top / 0.62;
        const bottomA = step(m.d, sideA, m.r + len - 0.4), bottomB = step(m.d, sideA, -(m.r + len - 0.4));
        const dir = nearestRoad(bottomA) > nearestRoad(bottomB) ? sideA : sideA.clone().negate();
        const bottom = step(m.d, dir, m.r + len - 0.4);
        const up = tangentTo(bottom, m.d);
        ramp = k.ramp(bottom, up, len + 0.4, 0.75, 0, m.top);
        const sg = new THREE.Group();
        stairs(sg, len + 0.4, m.top, 1.5, 0xcfc6ae, rockDark);
        const mid = step(bottom, up, (len + 0.4) / 2);
        k.bake(sg, mid, k.spinToward(mid, m.d), 0);
        stairSides(ramp);
        k.taken.push({ d: step(bottom, up, 1.5), r: 2.2 });
        // A little shrine on top: a gate, a stone lantern and a bench.
        const sh = new THREE.Group();
        for (const s of [-1, 1]) part(sh, new THREE.CylinderGeometry(0.09, 0.1, 2.0, 8), 0xd9534a, s * 0.75, 1.0, 0);
        box(sh, 2.1, 0.14, 0.2, 0xd9534a, 0, 2.0, 0);
        box(sh, 1.8, 0.1, 0.14, 0x3b4145, 0, 1.72, 0);
        box(sh, 0.3, 0.5, 0.3, 0xb9b2a3, 1.4, 0.25, -0.8);
        box(sh, 0.42, 0.25, 0.42, 0xb9b2a3, 1.4, 0.62, -0.8);
        box(sh, 0.24, 0.2, 0.24, C.lamp, 1.4, 0.85, -0.8);
        box(sh, 0.5, 0.12, 0.5, 0x8a8478, 1.4, 1.0, -0.8);
        const topAt = step(m.d, dir, m.r - 1.0);
        k.bake(sh, topAt, k.spinToward(topAt, step(topAt, dir, -1)), m.top);
        k.landmark({ dir: m.d.clone(), markerDir: m.d.clone(), markerH: m.top + 1.8, spin: 0, kind: "shrine", name: "Shrine keeper" });
        k.npc({ d: step(m.d, dir, -0.8), y: m.top, face: dir, name: "Shrine keeper", look: { shirt: 0xf4efe0, accent: 0xd9534a, bottomsStyle: "skirt", hairStyle: "bun", headwear: "none" },
          lines: ["You climbed all those steps with a bag of letters? Sit, rest.", "From up here you can see the waterfalls, the woods and the sea.", "People leave wishes here. Mostly about the post arriving on time."] });
        k.stampSpot(step(m.d, basis(m.d)[1], 1.0), m.top);
      }
      k.addCircle(m.d, m.r + 0.05, { y1: m.top - 0.3, except: ramp, wall: { h: m.top } });
      k.plate({ d: m.d, r: m.r - 0.05, h: m.top });
      k.taken.push({ d: m.d, r: m.r + 1.2 });
      // The waterfall pours off the edge facing the pond.
      const lip = m.d.clone().multiplyScalar(R + m.top - 0.05).addScaledVector(m.toPond, m.r * 0.98);
      const wf = waterfall({ top: lip, up: lip.clone().normalize(), out: m.toPond, width: 0.9 + m.r * 0.3, drop: m.top - SEA_LEVEL + 0.05 });
      world.add(wf.mesh);
      falls.push(wf);
    });
    k.ambient.falls = falls.map((f) => f.foot.clone().normalize());
    // Spray where the falls hit the pond.
    k.animate((t, night, dt) => {
      for (const f of falls) if (rnd() < dt * 18) k.spray(f.foot.clone().addScaledVector(f.side, (rnd() - 0.5) * 0.9), f.foot.clone().normalize());
    });
    // The pond and the river down to the sea.
    const cap = new THREE.SphereGeometry(R + SEA_LEVEL, 48, 10, 0, Math.PI * 2, 0, (pond.r + 0.6) / R);
    cap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), pond.d));
    world.add(new THREE.Mesh(cap, bodyMaterial({ center: pond.d, radius: pond.r / R, R, deep: 0x2f8f91, shallow: 0x5bbcb3 })));
    {
      const rv = T.river, pos = [], uv = [], idx = [];
      const a0 = (pond.r - 0.6) / R, a1 = rv.total - T.SEA_R + 0.02, n = Math.ceil(((a1 - a0) * R) / 0.5);
      const w = rv.hw + 0.35;
      for (let i = 0; i <= n; i++) {
        const al = a0 + ((a1 - a0) * i) / n;
        const c = rv.a.clone().applyAxisAngle(rv.axis, al);
        for (const s of [-1, 1]) {
          const p = c.clone().multiplyScalar(Math.cos(w / R)).addScaledVector(rv.axis, s * Math.sin(w / R)).normalize().multiplyScalar(R + SEA_LEVEL);
          pos.push(p.x, p.y, p.z);
          uv.push(s < 0 ? 0 : 1, al * R);
        }
      }
      for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const river = new THREE.Mesh(g, riverMaterial());
      world.add(river);
    }
    // Rocks and reeds round the pond.
    for (let i = 0; i < 16; i++) {
      const d = around(pond.d, (pond.r + range(0.2, 1.4)) / R, rnd() * Math.PI * 2);
      if (k.blocked(d, 0.4) || nearestRoad(d) < ROAD_HW + WALK + 0.5) continue;
      if (rnd() < 0.5) {
        k.bake(rock(range(0.6, 1.4), 0xcfc4a8), d, 0, T.landAt(d));
        k.addCircle(d, 0.3);
      } else {
        const g = new THREE.Group();
        for (let r = 0; r < 5; r++) part(g, new THREE.ConeGeometry(0.03, range(0.6, 1.0), 4), 0x6b8f4a, range(-0.2, 0.2), 0.35, range(-0.2, 0.2));
        k.bake(g, d, 0, T.landAt(d));
      }
    }
  }

  // ---------------------------------------------------------------- the woods

  {
    const z = T.ZONES.find((q) => q.key === "woods");
    // A ranger's cabin in a clearing.
    let cabinAt = null;
    for (let i = 0; i < 200 && !cabinAt; i++) {
      const d = around(z.d, range(0, z.r * 0.6), rnd() * Math.PI * 2);
      if (nearestRoad(d) > 6 && free(d, 3)) cabinAt = d;
    }
    if (cabinAt) {
      const g = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const y = 0.2 + i * 0.4;
        for (const [w, d, x, zz] of [[4, 0.36, 0, 1.5], [4, 0.36, 0, -1.5], [0.36, 3, 2, 0], [0.36, 3, -2, 0]]) box(g, w, 0.38, d, i % 2 ? 0x8a6448 : 0x9c7352, x, y, zz);
      }
      const roof = part(g, new THREE.CylinderGeometry(0.1, 2.6, 1.4, 4, 1), 0x5a4a44, 0, 3.0, 0);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1.15, 1, 0.9);
      box(g, 0.8, 1.5, 0.08, C.door, 0, 0.75, 1.72);
      box(g, 0.7, 0.6, 0.08, C.glass, 1.2, 1.4, 1.72);
      box(g, 0.4, 1.2, 0.4, 0x8a8478, -1.2, 3.2, -0.6);
      box(g, 1.2, 0.1, 0.6, 0xb98d5f, 0, 0.05, 2.1);
      const spin = rnd() * 6;
      k.bake(g, cabinAt, spin, 0);
      k.addRect(cabinAt, spin, 2.15, 1.7, { h: 3.6, hd: 1.7 });
      k.taken.push({ d: cabinAt, r: 3.2 });
      const q = k.frameAt(cabinAt, spin);
      const door = cabinAt.clone().multiplyScalar(R).add(V(0, 0, 2.9).applyQuaternion(q)).normalize();
      k.landmark({ dir: door, markerDir: cabinAt.clone().multiplyScalar(R).add(V(0, 0, 1.8).applyQuaternion(q)).normalize(), markerH: 4.4, spin, kind: "cabin", name: "Forest ranger" });
      k.npc({ d: cabinAt.clone().multiplyScalar(R).add(V(1.4, 0, 2.6).applyQuaternion(q)).normalize(), y: 0, face: V(0, 0, 1).applyQuaternion(q), name: "Ranger Ivy",
        look: { shirt: 0x6b8f72, accent: 0xc28a4a, headwear: "bucket", bottomsStyle: "pants", bottoms: 0x6c5446 },
        lines: ["Stay on the road after dark. The woods are friendly, but they're big.", "Those tall trees are older than the post office. Older than the planet, some say.", "Thanks for coming all this way. Nobody remembers we're out here."] });
    }
    // Trees, thick and tall, with ferns, logs, mushrooms and mossy rocks underneath.
    let n = 0;
    for (let tries = 0; tries < 5000 && n < 210; tries++) {
      const d = around(z.d, z.r * Math.sqrt(rnd()), rnd() * Math.PI * 2);
      if (nearestRoad(d) < ROAD_HW + WALK + 1.0 || !free(d, 0.8)) continue;
      const s = range(0.8, 1.2);
      if (rnd() < 0.55) {
        k.bake(tallTree(s), d, rnd() * 6, 0);
        k.addCircle(d, 0.24 * s);
      } else {
        k.bake(pine(s * 1.15), d, rnd() * 6, 0);
        k.addCircle(d, 0.18 * s);
      }
      k.taken.push({ d, r: 1.0 * s });
      n++;
    }
    for (let i = 0; i < 260; i++) {
      const d = around(z.d, z.r * Math.sqrt(rnd()), rnd() * Math.PI * 2);
      if (nearestRoad(d) < ROAD_HW + WALK + 0.4 || k.blocked(d, 0.3) || T.waterAt(d) !== null) continue;
      const r = rnd();
      if (r < 0.55) k.bake(fern(), d, rnd() * 6, 0);
      else if (r < 0.75) k.bake(mushroom(), d, rnd() * 6, 0);
      else if (r < 0.9) {
        k.bake(rock(range(0.6, 1.2), 0x9fa79a), d, 0, 0);
        k.addCircle(d, 0.28);
      } else if (k.clearOf(d, 1.3)) {
        const sp = rnd() * 6;
        k.bake(logPile(), d, sp, 0);
        k.addRect(d, sp, 1.1, 0.25);
        k.taken.push({ d, r: 1.2 });
      }
    }
  }

  // ---------------------------------------------------------------- the old works

  {
    const z = T.ZONES.find((q) => q.key === "works");
    let yard = z.d, best = -1;
    for (let i = 0; i < 300; i++) {
      const d = around(z.d, z.r * 0.5 * Math.sqrt(i / 300), i * 2.399);
      const s = nearestRoad(d);
      if (s > best) [best, yard] = [s, d];
    }
    const [e1, e2] = basis(yard);
    const at = (x, y) => yard.clone().multiplyScalar(R).addScaledVector(e1, x).addScaledVector(e2, y).normalize();
    /// The spot nearest the yard with room r around it, clear of the streets by `clear` metres.
    const roomFor = (r, clear) => {
      for (let i = 0; i < 500; i++) {
        const d = around(yard, (z.r * 0.95 * Math.sqrt(i / 500)), i * 2.399);
        if (nearestRoad(d) > clear && free(d, r)) return d;
      }
      return null;
    };
    const RED = 0xc8583f, RED_DARK = 0x9e4432, STEEL = 0x8d9790, STEEL_DARK = 0x5f6a66;
    // Big tanks with a railing round the top and a spiral stair.
    const tanks = [];
    [[1.9, 4.6, 0], [2.3, 5.6, 2.1], [1.6, 3.8, 4.2]].forEach(([r, h, a]) => {
      for (const tw of [0, 0.4, -0.4, 0.8]) {
        const d = at(Math.cos(a + tw) * 5.6, Math.sin(a + tw) * 5.6);
        if (nearestRoad(d) < r + ROAD_HW + WALK + 0.8 || !free(d, r + 0.4)) continue;
        const g = new THREE.Group();
        part(g, new THREE.CylinderGeometry(r, r, h, 24), RED, 0, h / 2, 0);
        part(g, new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.3, 24), RED_DARK, 0, 0.15, 0);
        part(g, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.12, 24), RED_DARK, 0, h * 0.55, 0);
        part(g, new THREE.SphereGeometry(r, 24, 6, 0, Math.PI * 2, 0, Math.PI * 0.18), 0xd86a4e, 0, h - r * Math.cos(Math.PI * 0.18), 0);
        const rail = part(g, new THREE.TorusGeometry(r * 0.98, 0.03, 4, 32), STEEL_DARK, 0, h + 0.85, 0);
        rail.rotation.x = Math.PI / 2;
        for (let i = 0; i < 14; i++) part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.85, 4), STEEL_DARK, Math.cos(i * 0.449) * r * 0.98, h + 0.43, Math.sin(i * 0.449) * r * 0.98);
        const steps = Math.round(h / 0.22);
        for (let i = 0; i < steps; i++) {
          const a2 = (i / steps) * Math.PI * 1.6 + a, y = (i / steps) * h;
          const st = box(g, 0.7, 0.06, 0.3, STEEL, Math.cos(a2) * (r + 0.36), y + 0.2, Math.sin(a2) * (r + 0.36));
          st.rotation.y = -a2;
          if (i % 2 === 0) part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), STEEL_DARK, Math.cos(a2) * (r + 0.7), y + 0.65, Math.sin(a2) * (r + 0.7));
        }
        k.bake(g, d, 0, 0);
        k.addCircle(d, r + 0.1, { wall: { h: h + 1 } });
        k.taken.push({ d, r: r + 1.2 });
        tanks.push({ d, r, h });
        break;
      }
    });
    // Pipes from tank to tank, held up on posts.
    for (let i = 0; i + 1 < tanks.length; i++) {
      const A = tanks[i], Bt = tanks[i + 1];
      const pa = A.d.clone().multiplyScalar(R + 3.2), pb = Bt.d.clone().multiplyScalar(R + 3.2);
      const dir = pb.clone().sub(pa).normalize();
      const a = pa.clone().addScaledVector(dir, A.r), b = pb.clone().addScaledVector(dir, -Bt.r);
      const g = new THREE.Group();
      rod(g, a, b, 0.22, 0xd86a4e, 12);
      for (const p of [a, b]) part(g, new THREE.SphereGeometry(0.3, 10, 8), RED_DARK, p.x, p.y, p.z);
      const mid = a.clone().add(b).multiplyScalar(0.5), foot = mid.clone().normalize().multiplyScalar(R);
      rod(g, foot, mid, 0.08, STEEL_DARK, 6);
      k.bakeAt(g);
      k.addCircle(foot.clone().normalize(), 0.12);
    }
    // A tall chimney, smoking.
    const chim = roomFor(1.2, ROAD_HW + WALK + 1.5);
    if (chim) {
      const g = new THREE.Group();
      for (let i = 0; i < 6; i++) part(g, new THREE.CylinderGeometry(0.7 - (i + 1) * 0.04, 0.7 - i * 0.04, 1.9, 14), i % 2 ? 0xf4efe0 : RED, 0, 0.95 + i * 1.9, 0);
      part(g, new THREE.CylinderGeometry(0.5, 0.5, 0.25, 14), 0x3b4145, 0, 11.5, 0);
      k.bake(g, chim, 0, 0);
      k.addCircle(chim, 0.75);
      k.taken.push({ d: chim, r: 1.4 });
      const top = chim.clone().multiplyScalar(R + 11.7);
      k.animate((t, night, dt) => { if (rnd() < dt * 3) k.smoke(top, chim); });
    }
    // The works shed with a sawtooth roof: the office door is a delivery address.
    const shedAt = roomFor(3.3, ROAD_HW + WALK + 3.2);
    if (shedAt) {
      const g = new THREE.Group();
      box(g, 7, 3.4, 5, 0x9fb3a8, 0, 1.7, 0);
      for (let i = 0; i < 3; i++) {
        const tooth = part(g, new THREE.CylinderGeometry(0.01, 1.2, 7.1, 3), 0x6f8580, 0, 3.4 + 0.5, -1.65 + i * 1.65);
        tooth.rotation.z = Math.PI / 2;
        tooth.scale.set(1, 1, 0.7);
      }
      box(g, 2.4, 2.6, 0.08, 0x5f6a66, -1.6, 1.3, 2.52);
      for (let i = 0; i < 6; i++) box(g, 2.3, 0.04, 0.1, 0x4e5a67, -1.6, 0.25 + i * 0.42, 2.57);
      box(g, 0.9, 1.9, 0.08, C.door, 2.0, 0.95, 2.52);
      box(g, 1.1, 0.7, 0.08, C.glass, 2.0, 2.45, 2.52);
      // Doors toward the nearest street.
      let toStreet = null, bestD = Infinity;
      for (let a = 0; a < 16; a++) {
        const d = step(shedAt, basis(shedAt)[0].applyAxisAngle(shedAt, (a / 16) * Math.PI * 2), 6);
        if (nearestRoad(d) < bestD) [bestD, toStreet] = [nearestRoad(d), d];
      }
      const spin = k.spinToward(shedAt, toStreet);
      k.bake(g, shedAt, spin, 0);
      k.addRect(shedAt, spin, 3.55, 2.55, { h: 4.6, hd: 2.55 });
      k.taken.push({ d: shedAt, r: 4.6 });
      const q = k.frameAt(shedAt, spin);
      const door = shedAt.clone().multiplyScalar(R).add(V(2.0, 0, 3.7).applyQuaternion(q)).normalize();
      k.landmark({ dir: door, markerDir: shedAt.clone().multiplyScalar(R).add(V(2.0, 0, 2.7).applyQuaternion(q)).normalize(), markerH: 5.2, spin, kind: "works", name: "Works foreman" });
      const workers = [[-1.0, 3.6, "Foreman Bo"], [0.6, 4.2, "Kit"]];
      workers.forEach(([x, zz, name], i) => k.npc({
        d: shedAt.clone().multiplyScalar(R).add(V(x, 0, zz).applyQuaternion(q)).normalize(), y: 0, face: V(i ? -1 : 1, 0, 0.4).applyQuaternion(q).normalize(), name,
        look: { shirt: 0x3f7fb3, bottoms: 0x3f7fb3, bottomsStyle: "pants", headwear: "hardhat", accent: 0xf4efe0 },
        lines: i ? ["Hard hats on past the barrier. Even couriers.", "Tank three hums a little tune at night. Honest.", "We make the paper for half the letters you carry."]
          : ["Post for the works? Leave it with me.", "The chimney's just steam these days. We went clean years ago.", "Climb the catwalk if you like the view. Mind the rail."],
      }));
      // A warning board by the door.
      signBoard((g2, w, h) => {
        g2.fillStyle = "#f4f1ea"; g2.fillRect(0, 0, w, h);
        g2.strokeStyle = "#283033"; g2.lineWidth = 6; g2.strokeRect(3, 3, w - 6, h - 6);
        g2.fillStyle = "#3f7fb3"; g2.beginPath(); g2.arc(48, 48, 30, 0, 7); g2.fill();
        g2.fillStyle = "#f4f1ea"; g2.fillRect(34, 44, 28, 12); g2.beginPath(); g2.arc(48, 46, 14, Math.PI, 0); g2.fill();
        g2.fillStyle = "#283033"; for (let i = 0; i < 3; i++) g2.fillRect(96, 26 + i * 18, 130 - i * 24, 8);
        g2.fillStyle = "#d9534a"; g2.beginPath(); g2.arc(48, 120, 26, 0, 7); g2.fill();
        g2.fillStyle = "#f4f1ea"; g2.fillRect(30, 115, 36, 10);
        g2.fillStyle = "#f2c94c"; g2.beginPath(); g2.moveTo(128, 96); g2.lineTo(160, 148); g2.lineTo(96, 148); g2.closePath(); g2.fill();
        g2.fillStyle = "#283033"; g2.fillRect(125, 112, 6, 20); g2.fillRect(125, 136, 6, 6);
        g2.fillStyle = "#3f7fb3"; g2.beginPath(); g2.arc(208, 120, 26, 0, 7); g2.fill();
      }, 1.6, 1.0, shedAt.clone().multiplyScalar(R).add(V(-3.2, 0, 2.6).applyQuaternion(q)).normalize(), spin, 1.6);
    }
    // A catwalk beside the biggest tank, with stairs up: the best view of the works.
    const catwalk = (() => {
      for (const tk of [...tanks].sort((a, b) => b.h - a.h)) {
        for (let a = 0; a < 12; a++) {
          const out = basis(tk.d)[0].applyAxisAngle(tk.d, (a / 12) * Math.PI * 2);
          for (const sgn of [1, -1]) {
            const side = new THREE.Vector3().crossVectors(tk.d, out).normalize().multiplyScalar(sgn);
            const deckAt = step(tk.d, out, tk.r + 0.9), H = 2.6, len = H / 0.6;
            const stairBottom = step(deckAt, side, len + 1.2);
            // Right beside the tank, so only real obstacles count (not the room kept round it).
            const clear = (d) => nearestRoad(d) > ROAD_HW + WALK + 0.9 && !k.blocked(d, 0.7);
            const along = [0, 1.6, len / 2 + 1, len + 1.2].map((m) => step(deckAt, side, m));
            if (along.every(clear) && k.clearOf(stairBottom, 1) && !tanks.some((o) => o !== tk && arc(o.d, deckAt) < o.r + 2)) {
              return { tk, out, side, deckAt, H, len, stairBottom };
            }
          }
        }
      }
      return null;
    })();
    if (catwalk) {
      const { out, side, deckAt, H, len, stairBottom } = catwalk;
      {
        const g = new THREE.Group();
        box(g, 3.2, 0.12, 1.6, STEEL, 0, H - 0.06, 0);
        for (const [x, zz] of [[-1.5, -0.7], [1.5, -0.7], [-1.5, 0.7], [1.5, 0.7]]) part(g, new THREE.CylinderGeometry(0.06, 0.06, H, 6), STEEL_DARK, x, H / 2, zz);
        for (const zz of [-0.8, 0.8]) {
          box(g, 3.2, 0.05, 0.05, STEEL_DARK, 0, H + 0.95, zz);
          for (let i = 0; i < 5; i++) part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.95, 4), STEEL_DARK, -1.5 + i * 0.75, H + 0.48, zz);
        }
        const spin = k.spinToward(deckAt, step(deckAt, side, 1));
        k.bake(g, deckAt, spin + Math.PI / 2, 0);
        const up = side.clone().negate();
        const ramp = k.ramp(stairBottom, up, len + 0.4, 0.6, 0, H);
        const sg = new THREE.Group();
        stairs(sg, len + 0.4, H, 1.2, STEEL, STEEL_DARK, { solid: false });
        const mid = step(stairBottom, up, (len + 0.4) / 2);
        k.bake(sg, mid, k.spinToward(mid, deckAt), 0);
        stairSides(ramp);
        k.plate({ d: deckAt, right: side, front: out, hw: 1.6, hd: 0.8, h: H });
        for (const s of [-1, 1]) {
          const r = step(deckAt, out, s * 0.82);
          k.addRect(r, spinAlong(r, side), 0.05, 1.6, null, { y0: H - 0.3, y1: H + 0.5 });
        }
        const back = step(deckAt, side, -1.62);
        k.addRect(back, spinAlong(back, out), 0.05, 0.8, null, { y0: H - 0.3, y1: H + 0.5 });
        for (const [x, zz] of [[-1.5, -0.7], [1.5, -0.7], [-1.5, 0.7], [1.5, 0.7]]) k.addCircle(step(step(deckAt, side, x), out, zz), 0.08, { y1: H - 0.3 });
        k.taken.push({ d: stairBottom, r: 1.5 });
        k.stampSpot(step(deckAt, side, -1.0), H);
      }
    }
    // Shipping containers.
    for (let i = 0, placed = 0; i < 60 && placed < 7; i++) {
      const d = at(range(-9, 9), range(-9, 9));
      if (nearestRoad(d) < ROAD_HW + WALK + 2 || !free(d, 1.8)) continue;
      placed++;
      const g = new THREE.Group(), col = pick([0x3f7fb3, 0x5aa39a, 0xd88a3d, 0xb5534a]);
      box(g, 2.6, 1.3, 1.25, col, 0, 0.65, 0);
      for (let j = 0; j < 9; j++) box(g, 0.05, 1.2, 1.28, new THREE.Color(col).multiplyScalar(0.8).getHex(), -1.2 + j * 0.3, 0.65, 0);
      const spin = rnd() * 6;
      k.bake(g, d, spin, 0);
      k.addRect(d, spin, 1.32, 0.66, { h: 1.4, hd: 0.66 });
      k.taken.push({ d, r: 1.7 });
    }
    // A fence round the yard, with a gate and a striped barrier where the road comes in.
    const ring = 10.5;
    let gate = null;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, a2 = ((i + 1) / 64) * Math.PI * 2;
      const p0 = at(Math.cos(a) * ring, Math.sin(a) * ring), p1 = at(Math.cos(a2) * ring, Math.sin(a2) * ring);
      const mid = p0.clone().add(p1).normalize();
      const near = nearestRoad(mid);
      if (near < ROAD_HW + WALK + 0.6 || k.blocked(mid, 0.3) || T.waterAt(mid) !== null) {
        if (!gate && near < ROAD_HW + WALK + 0.6 && near > ROAD_HW) gate = mid;
        continue;
      }
      if (!gate && near < ROAD_HW + WALK + 3.5) { gate = mid; continue; }
      const len = arc(p0, p1), g = new THREE.Group();
      part(g, new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), STEEL_DARK, -len / 2, 0.8, 0);
      for (const y of [0.3, 0.9, 1.5]) box(g, len, 0.035, 0.035, STEEL, 0, y, 0);
      for (let j = 0; j < 5; j++) box(g, 0.012, 1.4, 0.012, STEEL, -len / 2 + (j + 0.5) * (len / 5), 0.85, 0);
      const spin = k.spinToward(mid, p1) + Math.PI / 2;
      k.bake(g, mid, spin, 0);
      k.addRect(mid, spin, len / 2, 0.06);
    }
    if (gate) {
      const g = new THREE.Group();
      box(g, 0.18, 1.0, 0.18, 0xf2c94c, -1.6, 0.5, 0);
      box(g, 0.4, 0.08, 0.4, 0xf2c94c, -1.6, 0.04, 0);
      box(g, 0.18, 0.9, 0.18, 0xf2c94c, 1.6, 0.45, 0);
      for (let j = 0; j < 6; j++) box(g, 0.55, 0.12, 0.12, j % 2 ? 0xd9534a : 0xf4efe0, -1.3 + j * 0.55, 0.95, 0);
      k.bake(g, gate, k.spinToward(gate, yard) + Math.PI / 2, 0);
      k.taken.push({ d: gate, r: 2 });
    }
    k.ambient.works = { d: yard, r: 11 };
  }

  // ---------------------------------------------------------------- the footbridge on Main Street

  {
    for (const { ri, t } of k.footbridge ? [k.footbridge] : []) {
      const road = k.ROADS[ri], p = road.point(t);
      const tan = road.tangent(t), side = new THREE.Vector3().crossVectors(p, tan).normalize();
      const H = 4.0, len = H / 0.62, reach = T.DECK_HW + 1.0;
      const bottoms = [1, -1].map((s) => step(step(p, side, s * reach), tan, s * (len + 0.2)));
      // Deck across the street, with railings and a sign on each face.
      const teal = 0x7fcfbd, tealDark = 0x5fae9e;
      const g = new THREE.Group();
      const span = reach * 2 + 1.6;
      box(g, span, 0.3, 1.7, teal, 0, H - 0.15, 0);
      for (const zz of [-0.85, 0.85]) {
        box(g, span, 0.55, 0.06, tealDark, 0, H + 0.25, zz);
        box(g, span, 0.06, 0.1, teal, 0, H + 0.95, zz);
        for (let i = 0; i <= 12; i++) part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.95, 4), tealDark, -span / 2 + (i / 12) * span, H + 0.48, zz);
      }
      for (const s of [-1, 1]) for (const zz of [-0.7, 0.7]) part(g, new THREE.CylinderGeometry(0.14, 0.14, H, 8), tealDark, s * (T.DECK_HW + 0.35), H / 2, zz);
      const spin = k.spinToward(p, step(p, tan, 1));
      k.bake(g, p, spin, 0);
      k.plate({ d: p, right: side, front: tan, hw: reach + 0.8, hd: 0.85, h: H });
      for (const zz of [-1, 1]) {
        const r = step(p, tan, zz * 0.87);
        k.addRect(r, spinAlong(r, side), 0.06, reach + 0.8, null, { y0: H - 0.3, y1: H + 0.5 });
      }
      for (const s of [-1, 1]) {
        const r = step(p, side, s * (reach + 0.85));
        k.addRect(r, spinAlong(r, tan), 0.06, 0.85, null, { y0: H - 0.3, y1: H + 0.5 });
        for (const zz of [-0.7, 0.7]) k.addCircle(step(step(p, side, s * (T.DECK_HW + 0.35)), tan, zz), 0.16, { y1: H - 0.3 });
      }
      // Stairs down each side, along the street.
      [1, -1].forEach((s, i) => {
        const bottom = bottoms[i], up = tan.clone().multiplyScalar(-s);
        const ramp = k.ramp(bottom, up, len + 0.25, 0.7, 0, H);
        const sg = new THREE.Group();
        stairs(sg, len + 0.25, H, 1.4, teal, tealDark, { solid: false });
        const mid = step(bottom, up, (len + 0.25) / 2);
        k.bake(sg, mid, k.spinToward(mid, step(mid, up, 1)), 0);
        stairSides(ramp);
        for (let j = 0; j < 4; j++) k.taken.push({ d: step(bottom, up, j * 1.6), r: 1.4 });
      });
      for (const zz of [-1, 1]) {
        signBoard((g2, w, h) => {
          g2.fillStyle = "#5fae9e"; g2.fillRect(0, 0, w, h);
          g2.fillStyle = "#fbf6ea"; g2.font = "700 34px Bungee, Impact, sans-serif"; g2.textAlign = "center"; g2.textBaseline = "middle";
          g2.fillText("MAIN STREET", w / 2, h / 2 + 2);
        }, 3.2, 0.42, step(p, tan, zz * 0.9), spin + (zz > 0 ? 0 : Math.PI), H + 0.25, 0.02);
      }
      k.stampSpot(step(p, side, 0.6), H);
      break;
    }
  }
}
