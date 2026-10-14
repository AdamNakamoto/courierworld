// The companion bonus: extra $STAMP for time spent actually playing with your Courier Companion following you.
// Shared by the game and the multiplayer room (no imports beyond companion-kinds.js, so both can load it).
//
// It's paid by a $STAMP drop in the TokenDrops contract that the treasury funds from its share of what players spend
// in the game (nothing is minted, and post office earnings are untouched: the PostOffice can't change). The room
// counts your active minutes, checks at random times through the day that your wallet still holds the companion that
// earned them, and once the day is over signs each wallet's share of that day's pool. A day's bonus is claimed the
// next day or the one after (TokenDrops' claim window), with the treasure hunt's "Claim" button.
import { companionOf } from "./companion-kinds.js";

/// The TokenDrops ids of the companion bonus drops, one per season, oldest first: none (no bonus) until the treasury
/// creates the first. Add each new season's drop here, with the room and the site deployed, before its first day; a
/// season's drop stays listed until its last pay day can't be claimed any more (two days after it ends), so seasons
/// can follow on from each other.
export const BONUS_DROPS = [];
/// Whether the treasury's panel shows the form that starts a season's drop: off while the bonus is paused.
export const BONUS_POOL_FORM = false;
/// Whether drop `id` is a companion bonus drop (and so never pays the golden stamps).
export const isBonusDrop = (id) => BONUS_DROPS.includes(Number(id));

/// The most active minutes a day that count.
export const BONUS_MINUTES = 120;
/// The most $STAMP a day each tier earns, for BONUS_MINUTES of play (the drop pays 1 $STAMP a coin).
export const BONUS_CAP = { Pet: 6, "Space buddy": 9, Legendary: 12, Mecha: 18, Anime: 24 };
/// A $STAMP drop pays a wallet at most 24 coins a day (TokenDrops.GOLDEN_SPOTS).
export const BONUS_MAX_COINS = 24;
/// What makes a minute count: you moved at least this far (metres, along the ground) since your last counted one...
export const BONUS_MOVE_M = 3;
/// ...and you've been moving about in this connection for at least this long (ms).
export const BONUS_WARMUP_MS = 60_000;

/// The most $STAMP a day companion `kind` earns (0 for an unknown kind).
export const bonusCap = (kind) => BONUS_CAP[companionOf(kind)?.tier] ?? 0;

/// A minute with companion `kind` earns `bonusCap(kind)` units; BONUS_MINUTES minutes' worth of units is one day's cap.
/// `minutes`: { kind: minutes } for one wallet's day, without the kinds that left the wallet that day.
/// Returns the coins that day earned before any sharing of the pool.
export function bonusCoins(minutes) {
  let units = 0;
  for (const [kind, m] of Object.entries(minutes)) units += bonusCap(Number(kind)) * m;
  return Math.min(BONUS_MAX_COINS, Math.floor(units / BONUS_MINUTES));
}

/// A wallet's coins for a day, once the day is over: what it earned, or its share of the pool (`pool` coins) if
/// everyone together (`total`) earned more than the pool holds. Never more than the pool in all.
export function bonusShare(coins, total, pool) {
  if (!(coins > 0) || !(pool > 0)) return 0;
  return total > pool ? Math.floor((coins * pool) / total) : coins;
}

/// The TokenDrops day a day's bonus is paid under: the day after it was earned, so it can be claimed that day and
/// the next (and only once the day is over and every wallet's share is known).
export const bonusPayDay = (playDay) => playDay + 1;
