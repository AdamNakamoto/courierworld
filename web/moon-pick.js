// The moon: a small grey world couriers fly to from the neon district's rocket, for a ticket paid in $STAMP to
// the Courier World treasury. Low gravity, craters and the planet hanging in a black sky.
//
// Shared by the game and the multiplayer server (no imports, so both can load it): the moon's size and ground,
// and the ticket. Directions are [x, y, z] unit vectors in the moon's own frame; the landing pad (and the rocket
// home) is at its top.

export const MOON_R = 12; // metres
export const MOON_PRICE = 100n * 10n ** 18n; // a ticket, in $STAMP's smallest units (18 decimals)
export const MOON_PRICE_TEXT = "100";
export const MOON_TREASURY = "0x72215670C2266Bc224949A12C514a77D7fD5D566"; // where tickets go
export const MOON_SECS = 3600; // how long a ticket lasts
export const MOON_GRAVITY = 0.35; // of the planet's: jumps go about three times as high
export const LANDING = [0, 1, 0];

const CANDIDATES = 30; // spots the scenery keeps clear of (MOON_SPOTS)

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/// Metres along the moon's surface between two directions.
export const moonArc = (a, b) => MOON_R * Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
export const randomDir = (rnd) => {
  const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return [s * Math.cos(t), z, s * Math.sin(t)];
};

/// The craters: { d, r (metres), depth }, kept clear of the landing pad.
export const CRATERS = (() => {
  const rnd = rng(4242), out = [];
  for (let i = 0; i < 400 && out.length < 16; i++) {
    const d = randomDir(rnd), r = 1.3 + rnd() * 2.2, depth = 0.22 + rnd() * 0.38;
    if (moonArc(d, LANDING) < r * 1.5 + 4) continue;
    if (out.some((c) => moonArc(c.d, d) < (c.r + r) * 0.9)) continue;
    out.push({ d, r, depth });
  }
  return out;
})();

/// The ground's height (metres, about 0) at direction d: bowls with low rims where the craters are.
export function moonHeight(d) {
  let h = 0;
  for (const c of CRATERS) {
    const u = moonArc(d, c.d) / c.r;
    if (u > 1.7) continue;
    if (u < 1) h -= c.depth * (1 - u * u);
    h += c.depth * 0.35 * Math.exp(-(((u - 1) / 0.22) ** 2));
  }
  return h;
}

/// The spots where the moon stamps used to be (retired 2026-10-15): { d, h (its height above the moon's radius) }.
/// Kept so the moon looks the same: Moon Base, the frogs and the rocks keep clear of them.
export const MOON_SPOTS = (() => {
  const rnd = rng(9090), out = [];
  for (let i = 0; i < 2000 && out.length < CANDIDATES; i++) {
    const d = randomDir(rnd);
    if (moonArc(d, LANDING) < 4.5) continue;
    if (out.some((s) => moonArc(s.d, d) < 3.2)) continue;
    out.push({ d: unit(d), h: moonHeight(d) + (out.length % 3 === 2 ? 2.6 : 0.95) });
  }
  return out;
})();
