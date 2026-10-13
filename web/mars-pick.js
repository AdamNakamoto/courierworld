// Mars: a red world couriers fly to from the neon district's rocket, for a ticket paid in $STAMP to the Courier World
// treasury (twice the moon's: it's further). Gravity between the moon's and the planet's, a winding canyon, a sleeping
// volcano, an ice cap at the bottom, dust storms, and golden Mars stamps that count with the golden stamps (paid by
// the treasury's $STAMP drop, when one is running).
//
// Shared by the game and the multiplayer server (no imports beyond moon-pick.js and hunt-pick.js, so both can load
// it): Mars's size and ground, the ticket, where its places are, and where the day's Mars stamps are. Directions are
// [x, y, z] unit vectors in Mars's own frame; the landing pad (and the rocket home) is at its top.
import { shuffleSpots } from "./hunt-pick.js";
import { MOON_TREASURY, LANDING, rng, dot, unit, randomDir } from "./moon-pick.js";

export const MARS_R = 16; // metres
export const MARS_PRICE = 200n * 10n ** 18n; // a ticket, in $STAMP's smallest units (18 decimals)
export const MARS_PRICE_TEXT = "200";
export const MARS_TREASURY = MOON_TREASURY; // where tickets go
export const MARS_SECS = 3600; // how long a ticket lasts
export const MARS_STAMPS = 12; // golden Mars stamps out each day
export const MARS_GRAVITY = 0.55; // of the planet's: jumps go nearly twice as high
export const MARS_REACH = 2.4, MARS_REACH_UP = 1.8; // how close a find has to be (metres)

const CANDIDATES = 36; // spots a Mars stamp can be out at; each day takes MARS_STAMPS of them

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

/// The colony (domes, a greenhouse, the rover garage), a short walk east of the pad, and how far it spreads (metres).
export const COLONY = dirAt(8.5 / MARS_R, 0);
export const COLONY_R = 6.5;
/// The sleeping volcano, round the far side: its peak, how far its slopes reach and how high, and the crater on top.
export const VOLCANO = { d: dirAt(33 / MARS_R, 1.25), r: 7.5, h: 3.6, crater: 1.7, deep: 0.8 };
/// The ice cap at the bottom, and the radio station beside it.
export const ICE = { d: [0, -1, 0], r: 7 };
export const RADIO = dirAt(40 / MARS_R, -Math.PI / 2);

/// The canyon: a winding gorge on the west side, along the great circle through `c` heading `t`, `half` metres each
/// way from its middle, `depth` deep, its floor `floor` metres wide each side of the middle line and its walls out to
/// `wall`.
const CANYON_C = dirAt(23 / MARS_R, Math.PI * 1.1);
const CANYON_T = unit(cross([0, 1, 0], CANYON_C));
const CANYON_N = cross(CANYON_C, CANYON_T);
export const CANYON = { c: CANYON_C, t: CANYON_T, n: CANYON_N, half: 15, depth: 1.8, floor: 1.5, wall: 4.0 };
const wind = (s) => 1.1 * Math.sin(s * 0.22); // (how far the middle line winds off the great circle)
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

/// A few small craters: { d, r (metres), depth }, kept off the pad, the colony and the other places.
export const MARS_CRATERS = (() => {
  const rnd = rng(5150), out = [];
  for (let i = 0; i < 600 && out.length < 8; i++) {
    const d = randomDir(rnd), r = 1.0 + rnd() * 1.1, depth = 0.2 + rnd() * 0.2;
    if (marsArc(d, LANDING) < r * 1.5 + 5 || marsArc(d, COLONY) < COLONY_R + r + 2 || marsArc(d, VOLCANO.d) < VOLCANO.r + r + 2) continue;
    if (marsArc(d, RADIO) < r + 4 || marsArc(d, ICE.d) < ICE.r + r) continue;
    const cy = canyonAt(d);
    if (cy && Math.abs(cy.s) < CANYON.half + r + 3 && Math.abs(cy.l) < CANYON.wall + r + 2) continue;
    if (out.some((c) => marsArc(c.d, d) < (c.r + r) * 1.2)) continue;
    out.push({ d, r, depth });
  }
  return out;
})();

/// The ground's height (metres, about 0) at direction d: low dunes, the craters, the volcano and the canyon.
export function marsHeight(d) {
  // Dunes: gentle swells, smoothed away round the pad and the colony.
  const calm = smooth(4, 9, marsArc(d, LANDING)) * smooth(COLONY_R, COLONY_R + 4, marsArc(d, COLONY));
  let h = calm * 0.14 * Math.sin(d[0] * 6.3 + d[2] * 2.9 + 1.1) * Math.sin(d[1] * 5.1 - d[0] * 3.7);
  for (const c of MARS_CRATERS) {
    const u = marsArc(d, c.d) / c.r;
    if (u > 1.7) continue;
    if (u < 1) h -= c.depth * (1 - u * u);
    h += c.depth * 0.35 * Math.exp(-(((u - 1) / 0.22) ** 2));
  }
  // The volcano: a cone with soft feet, and a bowl in its top.
  const V = VOLCANO, vr = marsArc(d, V.d);
  if (vr < V.r) {
    const cone = (r) => V.h * (1 - r / V.r) ** 1.4;
    h += vr > V.crater ? cone(vr) : cone(V.crater) - V.deep * (1 - (vr / V.crater) ** 2);
  }
  // The canyon: down to its floor, the walls sloping up to a low lip, fading out at both ends.
  const cy = canyonAt(d);
  if (cy) {
    const ends = 1 - smooth(CANYON.half - 3, CANYON.half + 1, Math.abs(cy.s)), l = Math.abs(cy.l);
    if (ends > 0) h += ends * (0.12 * Math.exp(-(((l - CANYON.wall - 0.4) / 0.5) ** 2)) - CANYON.depth * (1 - smooth(CANYON.floor, CANYON.wall, l)));
  }
  return h;
}

/// Every spot a Mars stamp can be out at: { d, h (its height above Mars's radius) }. A third of them float high, for
/// a Mars jump.
export const MARS_SPOTS = (() => {
  const rnd = rng(7171), out = [];
  for (let i = 0; i < 3000 && out.length < CANDIDATES; i++) {
    const d = randomDir(rnd);
    if (marsArc(d, LANDING) < 4.5 || marsArc(d, COLONY) < COLONY_R + 0.5 || marsArc(d, RADIO) < 3.2) continue;
    if (out.some((s) => marsArc(s.d, d) < 3.4)) continue;
    out.push({ d: unit(d), h: marsHeight(d) + (out.length % 3 === 2 ? 2.6 : 0.95) });
  }
  return out;
})();

/// The Mars stamps out on `day`: indexes into MARS_SPOTS (a shuffle of its own, so they don't follow the moon's).
export const marsSpots = (day) => shuffleSpots(day + 60_000, MARS_SPOTS.length).slice(0, MARS_STAMPS);
