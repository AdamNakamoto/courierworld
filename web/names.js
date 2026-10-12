// Names players have claimed with X (wallet -> @handle), from the multiplayer server, for the post office
// signs and the leaderboard. Name tags and chat get each player's name from the room itself.
import { X_HANDLE } from "./x-claim.js";

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
let names = new Map(), on = false;
const listeners = new Set();

/// Read the names from the server at `base` (its http address); calls the onNames listeners if they changed.
export async function loadNames(base) {
  try {
    const r = await (await fetch(`${base}/names`, { cache: "no-store" })).json();
    const next = new Map(Object.entries(r.names ?? {}).filter(([w, h]) => /^0x[0-9a-f]{40}$/.test(w) && X_HANDLE.test(h)));
    const changed = !!r.on !== on || next.size !== names.size || [...next].some(([w, h]) => names.get(w) !== h);
    [names, on] = [next, !!r.on];
    if (changed) for (const f of listeners) f();
  } catch {}
}
/// The X handle a wallet has claimed, if any.
export const nameOf = (addr) => (addr ? names.get(addr.toLowerCase()) ?? null : null);
/// How to show a wallet: "@handle" if it has claimed one, otherwise its short address.
export const displayName = (addr) => (nameOf(addr) ? `@${nameOf(addr)}` : short(addr));
/// Whether claiming names is open on the server.
export const namesOn = () => on;
export const onNames = (f) => listeners.add(f);
