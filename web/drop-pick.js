// Where the day's coins are, shared by the game and the multiplayer server (no imports beyond hunt-pick.js, so both
// can load it). Each day the spots in hunt-spots.json are shuffled (hunt-pick.js): the first 24 once held the golden
// stamps and stay empty, so no coin ever moves (finds are stored by spot), and each token drop running that day takes
// the next `spots` of them, oldest drop first. A drop started later in the day only takes spots after everyone else's,
// so nobody's coins move. $STAMP drops (the companion bonus's among them) put no coins out.
import { HUNT_STAMPS, shuffleSpots } from "./hunt-pick.js";

/// `drops`: the drops running on `day` (TokenDrops.activeDrops), oldest first, each { id, spots, isStamp }.
/// Returns { coins: [{ drop, spots }], owner: Map(spot -> drop id, or "golden" for the old golden stamps' spots) }.
export function layDrops(day, total, drops) {
  const order = shuffleSpots(day, total);
  const reserved = order.slice(0, HUNT_STAMPS);
  const owner = new Map(reserved.map((s) => [s, "golden"]));
  const coins = [];
  let next = HUNT_STAMPS;
  for (const d of drops) {
    if (d.isStamp) continue;
    const spots = order.slice(next, Math.min(total, next + d.spots)).sort((a, b) => a - b);
    next += spots.length;
    for (const s of spots) owner.set(s, d.id);
    coins.push({ drop: d.id, spots });
  }
  return { coins, owner };
}
