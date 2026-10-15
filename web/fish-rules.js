// Fishing in the bay: where you can fish, the timing of a bite and a fight, and how the catch is picked. Shared by the
// game (web/fishing.js) and the multiplayer room, which checks every catch. No imports beyond the species list, no DOM.
import { FISH, FISH_TIERS } from "./fish-kinds.js";

/// The bay (web/terrain.js `sea`): its centre, as a direction from the planet's middle, and its radius in radians.
export const BAY = { d: [-0.919696, 0.381059, -0.094618], r: 0.46 };
const SEA_LEVEL = -0.12; // web/terrain.js

/// The longest wait for a bite, and the shortest; how long a bite lasts before the fish lets go (the game's hook
/// window), the shortest a fight can take, and how long a cast stays good.
export const BITE_MIN_MS = 2500;
export const BITE_MAX_MS = 9000;
export const HOOK_MS = 1100;
export const FIGHT_MIN_MS = 2500;
export const CAST_MS = 60_000;
/// The least time between one cast and the next.
export const CAST_GAP_MS = 2500;

const angTo = (s, d) => Math.acos(Math.min(1, Math.max(-1, s[0] * d[0] + s[1] * d[1] + s[2] * d[2])));

/// Where a player is, as the room sees it (`s`: a unit direction, then the facing, the height of their feet, airborne,
/// speed and swimming; see cleanState), and whether they can fish from there:
/// - over the bay's water, standing above it (the pier, a bridge), or
/// - at the water's edge (on the sand, or wading in), not swimming or in the air.
export function fishingSpot(s) {
  if (!Array.isArray(s) || s.length < 10) return null;
  const off = angTo(s, BAY.d), h = s[6], air = s[7], swim = s[9];
  if (air > 0.3 || swim > 0.05) return null;
  if (off < BAY.r - 0.02 && h > SEA_LEVEL + 0.25) return "deck";
  if (off > BAY.r - 0.06 && off < BAY.r + 0.07 && h > SEA_LEVEL - 0.45 && h < SEA_LEVEL + 0.6) return "shore";
  return null;
}

/// Pick a catch: a tier by its odds, then a species in it that still has room (`room(id)`: false once a capped
/// species is out for the day or for good). A tier with no room falls to the next commoner one. `rand()` in [0, 1).
export function pickFish(rand, room = () => true) {
  let x = rand() * FISH_TIERS.reduce((n, t) => n + t.odds, 0);
  let tier = 0;
  for (; tier < FISH_TIERS.length - 1; tier++) if ((x -= FISH_TIERS[tier].odds) < 0) break;
  for (; tier >= 0; tier--) {
    const open = FISH.filter((f) => f.tier === FISH_TIERS[tier].key && room(f.id));
    if (open.length) return open[Math.floor(rand() * open.length)].id;
  }
  return null;
}
