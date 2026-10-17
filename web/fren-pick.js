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

/// The pets: { id, kind (fren-art.js PET_ART), name, home (a direction), wander (metres from home they roam) }.
/// Ids never change (friendship is stored by them); add new pets at the end.
export const PETS = [
  ["mochi", "cat", "Mochi", "plaza", 0.9, 1.6],
  ["biscuit", "dog", "Biscuit", "cabin", -0.7, 2.2],
  ["ember", "dragon", "Ember", "tower", 0.6, 3.2],
  ["bao", "panda", "Bao", "pond", -0.5, 2.6],
  ["waddles", "penguin", "Waddles", "pond", 0.7, 2.8],
  ["hopper", "frog", "Hopper", "pond", 0, 3.4],
  ["wooly", "sheep", "Wooly", "field", 0.4, 2.0],
  ["momo", "monkey", "Momo", "windmill", -0.6, 2.4],
  ["pixel", "cat", "Pixel", "houses", -0.5, 2.0],
  ["nugget", "dog", "Nugget", "plaza", -0.9, 2.4],
  ["tofu", "panda", "Tofu", "forest", 0.5, 2.5],
  ["smokey", "dragon", "Smokey", "forest", -0.6, 3.0],
].map(([id, kind, name, place, turn, off]) => {
  const [az, m] = PLACES[place];
  return { id, kind, name, place, home: fromPad(az + turn * (off / m), m + (turn >= 0 ? 0.6 : -0.6)), wander: 1.8 };
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
