// Frenpet World: a small green pixel-art world, the home of the Frenpet pets (where IMD was born), that couriers fly
// to from the neon district's rocket for a ticket paid in $STAMP to the Courier World treasury. Its pets wander about
// near their homes; sit down by one and pat its head, and it remembers you (a friendship level per wallet, kept by
// the multiplayer room, that grows once a UTC day you pat that pet).
//
// Shared by the game and the multiplayer server (no imports, so both can load it): the world's size, the ticket, the
// pets and where they live, and the friendship rules. Directions are [x, y, z] unit vectors in the world's own frame;
// the landing pad (and the rocket home) is at its top.

export const FREN_R = 15; // metres
export const FREN_PRICE = 300n * 10n ** 18n; // a ticket, in $STAMP's smallest units (18 decimals)
export const FREN_PRICE_TEXT = "300";
export const FREN_SECS = 3600; // how long a ticket lasts
export const FREN_GRAVITY = 0.85; // of the planet's: a little floaty
export const LANDING = [0, 1, 0];

/// A direction `m` metres round the world from the landing pad, toward compass angle `az` (0 east, PI/2 north).
export function fromPad(az, m) {
  const a = m / FREN_R, s = Math.sin(a);
  return [s * Math.cos(az), Math.cos(a), s * Math.sin(az)];
}
export const frenArc = (a, b) => FREN_R * Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/// The places (fren.js builds them; the pets live near them): [az, metres from the pad].
export const PLACES = {
  plaza: [0.15, 6.5], // the pet statue
  cabin: [1.35, 10.5], // the log cabin with its chimney
  tower: [Math.PI, 13], // the stone tower, where IMD was born
  windmill: [-1.45, 12],
  houses: [0.55, 15.5],
  pond: [2.25, 15],
  field: [-2.35, 13.5],
  forest: [-0.6, 30], // round the far side
};

/// How far round each place its building (or pond, or field) reaches, in metres: pets live just outside.
const YARD = { plaza: 2.6, cabin: 3.0, tower: 3.2, windmill: 2.2, houses: 3.0, pond: 3.4, field: 2.4, forest: 0 };
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/// `m` metres from `d` toward `to` (any direction on the world), then `side` metres to the right of that way.
function stepToward(d, to, m, side = 0) {
  const k = d[0] * to[0] + d[1] * to[1] + d[2] * to[2];
  const t = norm([to[0] - d[0] * k, to[1] - d[1] * k, to[2] - d[2] * k]), a = m / FREN_R;
  const p = norm(d.map((v, i) => v * Math.cos(a) + t[i] * Math.sin(a)));
  if (!side) return p;
  const r = norm([p[1] * t[2] - p[2] * t[1], p[2] * t[0] - p[0] * t[2], p[0] * t[1] - p[1] * t[0]]), b = side / FREN_R;
  return norm(p.map((v, i) => v * Math.cos(b) + r[i] * Math.sin(b)));
}

/// The pets: { id, kind (fren-art.js PET_ART), name, home (a direction), wander (metres from home they roam) }.
/// Each lives just outside its place on the side toward the pad (or, `far`, the side away from it: the plaza's pets,
/// so they're not under the rocket) ([place, metres to the side, far]), never in a building or the pond. Ids never
/// change (friendship is stored by them); add new pets at the end.
export const PETS = [
  ["mochi", "cat", "Mochi", "plaza", 1.2, true],
  ["biscuit", "dog", "Biscuit", "cabin", -1.4],
  ["ember", "dragon", "Ember", "tower", 1.6],
  ["bao", "panda", "Bao", "pond", -1.8],
  ["waddles", "penguin", "Waddles", "pond", 1.8],
  ["hopper", "frog", "Hopper", "pond", 0],
  ["wooly", "sheep", "Wooly", "field", 0.8],
  ["momo", "monkey", "Momo", "windmill", -1.0],
  ["pixel", "cat", "Pixel", "houses", -0.8],
  ["nugget", "dog", "Nugget", "plaza", -1.6, true],
  ["tofu", "panda", "Tofu", "forest", 2.0],
  ["smokey", "dragon", "Smokey", "forest", -2.0],
].map(([id, kind, name, place, side, far = false]) => {
  const [az, m] = PLACES[place];
  return { id, kind, name, place, home: stepToward(fromPad(az, m), far ? LANDING.map((v) => -v) : LANDING, YARD[place] + 1.4, side), wander: 1.8 };
});
export const PET_IDS = PETS.map((p) => p.id);
export const petById = (id) => PETS.find((p) => p.id === id) ?? null;

/// ADAM, IMD's founder, by the tower's door.
export const ADAM = { name: "ADAM", home: fromPad(Math.PI - 0.12, 10.6) };

/// How close a courier has to be to a pet's home to sit and pat it (its roam plus arm's reach), in metres.
export const PAT_REACH = 1.8 + 2.4;

/// Friendship: one more each UTC day you pat a pet (patting again the same day is just for fun).
/// A level's name, and how many hearts it shows (out of 5).
export const FRIEND_TIERS = [
  [0, "Stranger", 0],
  [1, "New friend", 1],
  [3, "Friend", 2],
  [7, "Good friend", 3],
  [14, "Best friend", 4],
  [30, "Family", 5],
];
export function friendTier(n) {
  let t = FRIEND_TIERS[0];
  for (const x of FRIEND_TIERS) if (n >= x[0]) t = x;
  return { name: t[1], hearts: t[2], next: FRIEND_TIERS.find((x) => x[0] > n)?.[0] ?? null };
}
