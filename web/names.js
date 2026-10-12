// The names players have picked (wallet -> name), from the multiplayer server, for the post office signs
// and the leaderboard. Name tags and chat get each player's name from the room itself.
import { nameShown } from "./name-rules.js";

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
let names = new Map();
const listeners = new Set();

/// Read the names from the server at `base` (its http address); calls the onNames listeners if they changed.
export async function loadNames(base) {
  try {
    const r = await (await fetch(`${base}/names`, { cache: "no-store" })).json();
    const next = new Map(Object.entries(r.names ?? {}).filter(([w, n]) => /^0x[0-9a-f]{40}$/.test(w) && nameShown(n)));
    const changed = next.size !== names.size || [...next].some(([w, n]) => names.get(w) !== n);
    names = next;
    if (changed) for (const f of listeners) f();
  } catch {}
}
/// The name a wallet has picked, if any.
export const nameOf = (addr) => (addr ? names.get(addr.toLowerCase()) ?? null : null);
/// How to show a wallet: its name if it has one, otherwise its short address.
export const displayName = (addr) => nameOf(addr) ?? short(addr);
export const onNames = (f) => listeners.add(f);
