// Mars: a red world as big as Courier World, which couriers fly to from the neon district's rocket for a ticket paid
// in $STAMP to the Courier World treasury (twice the moon's: it's further). Gravity between the moon's and the
// planet's; a domed city by the spaceport; red mountains beyond it; a winding canyon; a big sleeping volcano; an ice
// cap at the bottom; and dust storms.
//
// Shared by the game and the multiplayer server (no imports beyond moon-pick.js, so both can load it): Mars's size
// and ground, the ticket and where its places are. Directions are [x, y, z] unit vectors in Mars's own frame; the
// spaceport's landing pad (and the rocket home) is at its top.
import { MOON_TREASURY, LANDING, rng, dot, unit, randomDir } from "./moon-pick.js";

export const MARS_R = 34; // metres, the same as Courier World
export const MARS_PRICE = 200n * 10n ** 18n; // a ticket, in $STAMP's smallest units (18 decimals)
export const MARS_PRICE_TEXT = "200";
export const MARS_TREASURY = MOON_TREASURY; // where tickets go
export const MARS_SECS = 3600; // how long a ticket lasts
export const MARS_GRAVITY = 0.55; // of the planet's: jumps go nearly twice as high

const CANDIDATES = 48; // spots the scenery keeps clear of (MARS_SPOTS)

const clamp = (x, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/// The direction `polar` radians from the top, turned `az` radians round from +x toward +z.
const dirAt = (polar, az) => [Math.sin(polar) * Math.cos(az), Math.cos(polar), Math.sin(polar) * Math.sin(az)];
/// Metres along Mars's surface between two directions.
export const marsArc = (a, b) => MARS_R * Math.acos(clamp(dot(a, b)));

/// Mars City: domes round a big glass plaza dome, a ring road and the farms, east of the spaceport. `r`: how far it
/// spreads (metres from its middle; the ground there is flat), `ring`: the ring road's radius, `domes`: how far out the
/// domes stand.
export const CITY = { d: dirAt(29 / MARS_R, 0), r: 24, ring: 21, domes: 13 };
/// The red mountains, a range beyond the city: each peak's direction, how far its slopes reach and how high.
export const MOUNTAINS = (() => {
  const rnd = rng(6262), out = [];
  for (let k = 0; k < 11; k++) {
    const az = -1.05 + k * 0.21 + (rnd() - 0.5) * 0.1, polar = (69 + (rnd() - 0.5) * 4) / MARS_R;
    out.push({ d: dirAt(polar, az), r: 10 + rnd() * 2.5, h: 7 + rnd() * 4 });
  }
  return out;
})();
/// The sleeping volcano, round the far side: its peak, how far its slopes reach and how high, and the crater on top.
export const VOLCANO = { d: dirAt(71 / MARS_R, 2.0), r: 15, h: 7, crater: 3, deep: 1.4 };
/// The ice cap at the bottom, and the radio station beside it.
export const ICE = { d: [0, -1, 0], r: 15 };
export const RADIO = dirAt(83 / MARS_R, -Math.PI / 2);

/// The canyon: a long winding gorge on the west side, along the great circle through `c` heading `t`, `half` metres
/// each way from its middle, `depth` deep, its floor `floor` metres wide each side of the middle line and its walls
/// out to `wall`.
const CANYON_C = dirAt(53 / MARS_R, Math.PI * 1.1);
const CANYON_T = unit(cross([0, 1, 0], CANYON_C));
const CANYON_N = cross(CANYON_C, CANYON_T);
export const CANYON = { c: CANYON_C, t: CANYON_T, n: CANYON_N, half: 30, depth: 3, floor: 2.4, wall: 6.5 };
const wind = (s) => 2.2 * Math.sin(s * 0.12); // (how far the middle line winds off the great circle)
/// Where `d` is by the canyon: `s` metres along from its middle and `l` metres off its winding middle line (null on
/// the far side of Mars from it).
export function canyonAt(d) {
  const x = dot(d, CANYON_C);
  if (x < 0.3) return null;
  const s = MARS_R * Math.atan2(dot(d, CANYON_T), x);
  return { s, l: MARS_R * Math.asin(clamp(dot(d, CANYON_N))) - wind(s) };
}
/// The middle of the canyon's floor, `s` metres along from its middle.
export function canyonFloor(s) {
  const a = s / MARS_R, lat = wind(s) / MARS_R;
  return unit([0, 1, 2].map((k) => (CANYON_C[k] * Math.cos(a) + CANYON_T[k] * Math.sin(a)) * Math.cos(lat) + CANYON_N[k] * Math.sin(lat)));
}

/// Craters: { d, r (metres), depth }, kept off the spaceport, the city and the other places.
export const MARS_CRATERS = (() => {
  const rnd = rng(5150), out = [];
  for (let i = 0; i < 2000 && out.length < 18; i++) {
    const d = randomDir(rnd), r = 1.5 + rnd() * 2.3, depth = 0.25 + rnd() * 0.35;
    if (marsArc(d, LANDING) < r * 1.5 + 8 || marsArc(d, CITY.d) < CITY.r + r + 3 || marsArc(d, VOLCANO.d) < VOLCANO.r + r + 2) continue;
    if (marsArc(d, RADIO) < r + 5 || marsArc(d, ICE.d) < ICE.r + r || MOUNTAINS.some((m) => marsArc(d, m.d) < m.r + r)) continue;
    const cy = canyonAt(d);
    if (cy && Math.abs(cy.s) < CANYON.half + r + 3 && Math.abs(cy.l) < CANYON.wall + r + 2) continue;
    if (out.some((c) => marsArc(c.d, d) < (c.r + r) * 1.2)) continue;
    out.push({ d, r, depth });
  }
  return out;
})();

/// The ground's height (metres, about 0) at direction d: low dunes, craters, the mountains, the volcano and the
/// canyon. Flat at the spaceport and in the city.
export function marsHeight(d) {
  // Dunes: gentle swells, smoothed away round the spaceport and the city.
  const calm = smooth(5, 11, marsArc(d, LANDING)) * smooth(CITY.r, CITY.r + 5, marsArc(d, CITY.d));
  let h = calm * 0.18 * Math.sin(d[0] * 11.3 + d[2] * 5.9 + 1.1) * Math.sin(d[1] * 9.1 - d[0] * 6.7);
  for (const c of MARS_CRATERS) {
    const u = marsArc(d, c.d) / c.r;
    if (u > 1.7) continue;
    if (u < 1) h -= c.depth * (1 - u * u);
    h += c.depth * 0.35 * Math.exp(-(((u - 1) / 0.22) ** 2));
  }
  // The mountains: peaks with soft feet and a little roughness on their flanks (where two meet, the higher one).
  let peak = 0;
  for (const m of MOUNTAINS) {
    const u = marsArc(d, m.d) / m.r;
    if (u < 1) peak = Math.max(peak, m.h * (1 - u) ** 1.5 * (1 + 0.12 * Math.sin(d[0] * 41 + d[1] * 37) * Math.sin(d[2] * 43 - d[1] * 29) * u));
  }
  h += peak;
  // The volcano: a cone with soft feet, and a bowl in its top.
  const V = VOLCANO, vr = marsArc(d, V.d);
  if (vr < V.r) {
    const cone = (r) => V.h * (1 - r / V.r) ** 1.4;
    h += vr > V.crater ? cone(vr) : cone(V.crater) - V.deep * (1 - (vr / V.crater) ** 2);
  }
  // The canyon: down to its floor, the walls sloping up to a low lip, fading out at both ends.
  const cy = canyonAt(d);
  if (cy) {
    const ends = 1 - smooth(CANYON.half - 5, CANYON.half + 1, Math.abs(cy.s)), l = Math.abs(cy.l);
    if (ends > 0) h += ends * (0.18 * Math.exp(-(((l - CANYON.wall - 0.6) / 0.7) ** 2)) - CANYON.depth * (1 - smooth(CANYON.floor, CANYON.wall, l)));
  }
  return h;
}

/// The spots where the Mars stamps used to be (retired 2026-10-15): { d, h (its height above Mars's radius) }. Kept
/// so Mars looks the same: the locals out in the wild (mars.js's settle) and the rocks keep clear of them.
export const MARS_SPOTS = (() => {
  const rnd = rng(7171), out = [];
  for (let i = 0; i < 5000 && out.length < CANDIDATES; i++) {
    const d = randomDir(rnd);
    if (marsArc(d, LANDING) < 6 || marsArc(d, CITY.d) < CITY.r + 1 || marsArc(d, RADIO) < 3.6) continue;
    if (out.some((s) => marsArc(s.d, d) < 6)) continue;
    out.push({ d: unit(d), h: marsHeight(d) + (out.length % 3 === 2 ? 2.6 : 0.95) });
  }
  return out;
})();
