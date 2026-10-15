// The treasure hunt's day and its shuffle of the coin spots. Shared by the game and the multiplayer server (no
// imports, so both can load it), and keyed to the same day number as the StampHunt contract.

/// The first HUNT_STAMPS spots of each day's shuffle held the golden stamps (retired 2026-10-15). They stay empty,
/// so the coins after them never move: finds are stored by spot.
export const HUNT_STAMPS = 24;

/// The hunt's day number: days since 1 January 1970, UTC (the contract's `today()`).
export const huntDay = (ms = Date.now()) => Math.floor(ms / 86_400_000);
/// How long until the next day's spots come out (00:00 UTC), as "3h 12m" (or "12m", or "under a minute").
export function newSpotsIn(ms = Date.now()) {
  const mins = Math.floor(((huntDay(ms) + 1) * 86_400_000 - ms) / 60_000), h = Math.floor(mins / 60);
  return mins < 1 ? "under a minute" : h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/// All `total` spots for `day`, in a shuffle that's the same everywhere: the first HUNT_STAMPS stay empty, and the
/// drops' coins (drop-pick.js) take the ones after.
export function shuffleSpots(day, total) {
  let a = (day * 2654435761) >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ids = Array.from({ length: total }, (_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/// What a hunter signs to prove the wallet is theirs (the game asks the wallet; the server checks it).
export const authMessage = (wallet, code) =>
  `Courier World: sign in to the treasure hunt.\n\nThis only proves this wallet is yours. It costs nothing and can't move anything.\n\nWallet: ${wallet}\nCode: ${code}`;
/// The wording games loaded before 2026-10-15 still sign; the server accepts it too, so their sign-in keeps working.
export const authMessageBefore = (wallet, code) =>
  `Courier World: sign in to the golden stamp hunt.\n\nThis only proves this wallet is yours. It costs nothing and can't move anything.\n\nWallet: ${wallet}\nCode: ${code}`;
