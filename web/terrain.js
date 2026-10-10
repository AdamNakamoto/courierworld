// The lie of the land: which part of the planet is town, seaside, falls, woods or works; how high
// the ground is (down into the sea, the pond and the river); and the walkable things built on top
// of it (bridges, stairs, platforms), so the courier can climb up, walk across and fall off.
// Pure maths: world.js builds the meshes from it and main.js walks on it.
import * as THREE from "https://esm.sh/three@0.160.0";

export const SEA_LEVEL = -0.12; // the water's surface, just below the street
export const STEP = 0.42; // how high a courier can step up without jumping

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createTerrain({ R, ROADS, ROAD_HW, WALK, nearestRoad, spawnDir, spawnTan }) {
  const ang = (a, b) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  const arc = (a, b) => R * ang(a, b);
  const S = spawnDir.clone().normalize(), T = spawnTan.clone().normalize(), B = new THREE.Vector3().crossVectors(S, T);
  /// The direction θ radians from the spawn, φ round from the spawn street.
  const at = (th, ph) => S.clone().multiplyScalar(Math.cos(th))
    .add(T.clone().multiplyScalar(Math.cos(ph)).addScaledVector(B, Math.sin(ph)).multiplyScalar(Math.sin(th))).normalize();

  const ZONES = [
    { key: "sea", name: "Seaside", d: at(2.25, 0.3), r: 0.62 },
    { key: "falls", name: "Falls Hill", d: at(1.35, -0.8), r: 0.44 },
    { key: "woods", name: "Whispering Woods", d: at(1.4, 1.6), r: 0.52 },
  ];
  // The works need a big open block between the streets: the roomiest spot that keeps clear of the
  // other places and of the post office.
  {
    const r = 0.42;
    let best = null;
    for (let i = 0; i < 1200; i++) {
      const th = 1.0 + 0.7 * ((i * 0.618) % 1), ph = i * 2.399;
      const d = at(th, ph);
      if (ZONES.some((z) => ang(d, z.d) < z.r + r + 0.06)) continue;
      const room = nearestRoad(d);
      if (!best || room > best.room) best = { d, room };
    }
    ZONES.push({ key: "works", name: "Old Works", d: best ? best.d : at(1.25, 3.0), r });
  }
  const TOWN = { key: "town", name: "Main Street", d: S, r: 0 };
  const zone = (key) => ZONES.find((z) => z.key === key);
  /// The area a spot belongs to (anything outside the others is town).
  function zoneAt(d) {
    for (const z of ZONES) if (ang(d, z.d) < z.r) return z;
    return TOWN;
  }

  // ---- the sea: a round bay with a sandy shore
  const sea = zone("sea");
  const SEA_R = 0.46; // water, in radians from the bay's centre
  const seaFloor = (a) => {
    // Sand slopes down under the water from the shore, then drops away.
    const x = (SEA_R - a) * R; // distance out from the shoreline, in metres
    if (x < -1.2) return 0;
    if (x < 0.6) return -0.3 * smooth(-1.2, 0.6, x);
    return -0.3 - Math.min(2.6, (x - 0.6) * 0.45);
  };

  // ---- the falls: a pond in the most open spot, fed by waterfalls, running off to the sea
  const falls = zone("falls");
  const openest = (z, within) => {
    let best = null;
    const t1 = new THREE.Vector3().crossVectors(z.d, new THREE.Vector3(0.3, 1, 0.2)).normalize(), t2 = new THREE.Vector3().crossVectors(z.d, t1);
    for (let i = 0; i < 400; i++) {
      const a = (i * 2.399) % (Math.PI * 2), r = within * Math.sqrt(i / 400);
      const d = z.d.clone().multiplyScalar(R).addScaledVector(t1, Math.cos(a) * r * R).addScaledVector(t2, Math.sin(a) * r * R).normalize();
      const score = nearestRoad(d);
      if (!best || score > best.score) best = { d, score };
    }
    return best.d;
  };
  const pond = { d: openest(falls, 0.22), r: 3.0 };
  const pondFloor = (dist) => {
    const x = pond.r - dist;
    if (x < -0.9) return 0;
    if (x < 0.5) return -0.32 * smooth(-0.9, 0.5, x);
    return -0.32 - Math.min(1.4, (x - 0.5) * 0.6);
  };
  // The river follows the great circle from the pond to the bay.
  const river = (() => {
    const a = pond.d, b = sea.d;
    const axis = new THREE.Vector3().crossVectors(a, b).normalize();
    const total = ang(a, b);
    return { a, b, axis, total, hw: 1.1 };
  })();
  /// Where a spot sits relative to the river: how far along (radians from the pond) and across (metres).
  function riverAt(d) {
    const across = Math.asin(Math.max(-1, Math.min(1, d.dot(river.axis)))) * R;
    const flat = d.clone().addScaledVector(river.axis, -d.dot(river.axis)).normalize();
    const along = Math.atan2(new THREE.Vector3().crossVectors(river.a, flat).dot(river.axis), river.a.dot(flat));
    return { along, across };
  }
  const inRiverSpan = (along) => along > (pond.r - 0.5) / R && along < river.total - (SEA_R * 0.92);
  const riverFloor = (d) => {
    const { along, across } = riverAt(d);
    if (!inRiverSpan(along)) return 0;
    return -0.42 * (1 - smooth(river.hw * 0.7, river.hw + 0.6, Math.abs(across)));
  };

  // ---- rock plateaus round the pond, one with stairs up to the top
  const mesas = [];
  {
    const out = (() => { // which way the river leaves the pond
      const t = new THREE.Vector3().crossVectors(river.axis, pond.d).normalize();
      return t;
    })();
    const side = new THREE.Vector3().crossVectors(pond.d, out).normalize();
    const specs = [
      { r: 3.0, top: 3.4, a: Math.PI, stairs: true },
      { r: 2.2, top: 2.5, a: Math.PI - 1.9 },
      { r: 1.7, top: 4.3, a: Math.PI + 1.95 },
    ];
    for (const s of specs) {
      for (const tweak of [0, 0.35, -0.35, 0.7, -0.7]) {
        const a = s.a + tweak, dist = pond.r + s.r - 0.7;
        const dir = out.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
        const d = pond.d.clone().multiplyScalar(R).addScaledVector(dir, dist).normalize();
        if (nearestRoad(d) < s.r + ROAD_HW + WALK + 1.2) continue;
        if (mesas.some((m) => arc(m.d, d) < m.r + s.r + 0.8)) continue;
        mesas.push({ ...s, d, toPond: pond.d.clone().sub(d).addScaledVector(d, -pond.d.clone().sub(d).dot(d)).normalize() });
        break;
      }
    }
  }

  /// Ground height (metres above the plain) from the land alone: sea floor, pond, river bed.
  function landAt(d) {
    let h = 0;
    const as = ang(d, sea.d);
    if (as < SEA_R + 0.08) h = Math.min(h, seaFloor(as));
    const dp = arc(d, pond.d);
    if (dp < pond.r + 1.2) h = Math.min(h, pondFloor(dp));
    if (Math.abs(d.dot(river.axis)) * R < river.hw + 1) h = Math.min(h, riverFloor(d));
    return h;
  }
  /// The water's surface at a spot, or null if it's dry.
  function waterAt(d) {
    return landAt(d) < SEA_LEVEL - 0.02 ? SEA_LEVEL : null;
  }
  /// Whether the sand of the beach (or the pond's and river's gravel) shows here.
  function sandAt(d) {
    const as = ang(d, sea.d);
    if (as < SEA_R + 0.13) return true;
    if (arc(d, pond.d) < pond.r + 0.7) return true;
    const { along, across } = riverAt(d);
    return inRiverSpan(along) && Math.abs(across) < river.hw + 0.5;
  }

  // ---- streets: where they cross water they become bridges, ramping up from the shore
  const SAMPLES = 900;
  const decks = ROADS.map((road) => {
    const wet = [];
    for (let i = 0; i < SAMPLES; i++) wet.push(waterAt(road.point((i / SAMPLES) * Math.PI * 2)) !== null);
    // Metres to the nearest dry ground along the road, looking both ways (going round twice, so
    // the count carries over the wrap).
    const step = (Math.PI * 2 * R) / SAMPLES, fwd = new Float32Array(SAMPLES), bwd = new Float32Array(SAMPLES);
    let run = Infinity;
    for (let k = 0; k < SAMPLES * 2; k++) {
      const i = k % SAMPLES;
      run = wet[i] ? run + step : 0;
      fwd[i] = run;
    }
    run = Infinity;
    for (let k = SAMPLES * 2 - 1; k >= 0; k--) {
      const i = k % SAMPLES;
      run = wet[i] ? run + step : 0;
      bwd[i] = run;
    }
    const dry = fwd.map((f, i) => Math.min(f, bwd[i]));
    const h = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) h[i] = dry[i] > 0 ? Math.min(1.15, road.h + 0.42 * dry[i]) : 0;
    return h;
  });
  /// The bridge deck's height on road `ri` at angle t (0 where the road isn't a bridge).
  function deckAt(ri, t) {
    const x = ((((t / (Math.PI * 2)) % 1) + 1) % 1) * SAMPLES, i = Math.floor(x), k = x - i;
    const a = decks[ri][i % SAMPLES], b = decks[ri][(i + 1) % SAMPLES];
    return a && b ? a + (b - a) * k : 0;
  }
  const roadT = (road, d) => Math.atan2(d.dot(road.v), d.dot(road.u));
  const DECK_HW = ROAD_HW + WALK; // bridges carry the sidewalks across too

  // ---- other walkable things: ramps (stairs) and flat platforms, added by the builders
  const ramps = [], plates = [];
  const local = (d, o) => d.clone().sub(o).multiplyScalar(R);
  /// Stairs from `bottom` (unit vector) rising along tangent `dir` for `len` metres, from h0 to h1.
  function addRamp(bottom, dir, len, hw, h0, h1) {
    const side = new THREE.Vector3().crossVectors(bottom, dir).normalize();
    const r = { bottom, dir: dir.clone().normalize(), side, len, hw, h0, h1, cos: Math.cos((len + hw + 1) / R) };
    ramps.push(r);
    return r;
  }
  function inRamp(r, d, margin = 0) {
    if (d.dot(r.bottom) < r.cos) return null;
    const v = local(d, r.bottom), along = v.dot(r.dir), lat = v.dot(r.side);
    if (along < -margin || along > r.len + margin || Math.abs(lat) > r.hw + margin) return null;
    return r.h0 + (r.h1 - r.h0) * Math.min(1, Math.max(0, along / r.len));
  }
  /// A flat platform: a disc (r) or a rectangle (right, front, hw, hd) at height h.
  function addPlate(p) {
    const ext = p.r ?? Math.hypot(p.hw, p.hd);
    const plate = { ...p, cos: Math.cos((ext + 1) / R) };
    plates.push(plate);
    return plate;
  }
  function onPlate(p, d) {
    if (d.dot(p.d) < p.cos) return false;
    if (p.r) return arc(d, p.d) < p.r;
    const v = local(d, p.d);
    return Math.abs(v.dot(p.right)) < p.hw && Math.abs(v.dot(p.front)) < p.hd;
  }

  /// The ground under foot, ignoring anything built on top: street, sidewalk, beach, river bed...
  function baseAt(d) {
    let best = Infinity, ri = -1;
    ROADS.forEach((road, i) => {
      const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, d.dot(road.axis)))) * R);
      if (lat < best) [best, ri] = [lat, i];
    });
    if (best < ROAD_HW) return ROADS[ri].h;
    if (best < ROAD_HW + WALK && nearestRoad(d, ri) > ROAD_HW + WALK + 0.2) return 0.16;
    // In the water you wade on the shallows: never deeper than about the knee.
    return Math.max(landAt(d), SEA_LEVEL - 0.4);
  }
  /// Every height you could be standing at here: the ground, plus bridge decks, stairs and platforms.
  function heightsAt(d) {
    const hs = [baseAt(d)];
    ROADS.forEach((road, i) => {
      if (Math.abs(d.dot(road.axis)) * R < DECK_HW) {
        const h = deckAt(i, roadT(road, d));
        if (h > 0.05) hs.push(h);
      }
    });
    for (const r of ramps) {
      const h = inRamp(r, d);
      if (h !== null) hs.push(h);
    }
    for (const p of plates) if (onPlate(p, d)) hs.push(p.h);
    return hs;
  }
  /// The highest thing you can stand on here from height y (anything up to `reach` above it).
  function surfaceAt(d, y, reach = STEP) {
    let best = -Infinity;
    for (const h of heightsAt(d)) if (h <= y + reach && h > best) best = h;
    return best === -Infinity ? baseAt(d) : best;
  }

  return {
    ZONES, TOWN, zoneAt, SEA_R, sea, pond, river, riverAt, inRiverSpan, mesas,
    landAt, waterAt, sandAt, deckAt, roadT, DECK_HW, decks,
    addRamp, inRamp, addPlate, onPlate, ramps, plates, baseAt, surfaceAt,
  };
}
