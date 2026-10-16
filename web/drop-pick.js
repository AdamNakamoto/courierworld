// Where the day's coins are, shared by the game and the multiplayer server (no imports beyond hunt-pick.js, so both
// can load it). Each day the spots in hunt-spots.json are shuffled (hunt-pick.js): the first 24 once held the golden
// stamps and stay empty, so no coin ever moves (finds are stored by spot). There are two TokenDrops contracts, and
// each has its own block of the shuffle after those: the first contract (the Launchpad's tokens) the next 60, the
// second (partner tokens, such as $MINE) the rest. Each token drop running that day takes the next `spots` of its
// contract's block, oldest drop first. A drop started later in the day only takes spots after everyone else's, and
// never the other contract's, so nobody's coins move. $STAMP drops (the companion bonus's among them) put no coins out.
import { HUNT_STAMPS, shuffleSpots } from "./hunt-pick.js";

/// The second contract's drop k is drop DROPS2_BASE + k in the game and the room (the first's keep their own
/// numbers), so the two never share a number.
export const DROPS2_BASE = 1000;
/// Where the second contract's block of the shuffle starts: the first's is [HUNT_STAMPS, DROPS2_FROM).
export const DROPS2_FROM = HUNT_STAMPS + 60;
/// Which contract a drop number is on (0: the first, 1: the second) and its number there.
export const dropLane = (id) => (id >= DROPS2_BASE ? 1 : 0);
export const dropNumber = (id) => (id >= DROPS2_BASE ? id - DROPS2_BASE : id);
/// How many coins a contract's drops can have out on one day, together.
export const laneSpots = (lane, total) => (lane ? Math.max(0, total - DROPS2_FROM) : DROPS2_FROM - HUNT_STAMPS);

/// `drops`: the drops running on `day` (TokenDrops.activeDrops, the second contract's numbered from DROPS2_BASE),
/// oldest first, each { id, spots, isStamp }.
/// Returns { coins: [{ drop, spots }], owner: Map(spot -> drop id, or "golden" for the old golden stamps' spots) }.
export function layDrops(day, total, drops) {
  const order = shuffleSpots(day, total);
  const reserved = order.slice(0, HUNT_STAMPS);
  const owner = new Map(reserved.map((s) => [s, "golden"]));
  const coins = [];
  const next = [HUNT_STAMPS, DROPS2_FROM], end = [DROPS2_FROM, total];
  for (const d of drops) {
    if (d.isStamp) continue;
    const l = dropLane(d.id);
    const spots = order.slice(next[l], Math.min(end[l], next[l] + d.spots)).sort((a, b) => a - b);
    next[l] += spots.length;
    for (const s of spots) owner.set(s, d.id);
    coins.push({ drop: d.id, spots });
  }
  return { coins, owner };
}
