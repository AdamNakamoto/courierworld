// Claim your name with X: sign in to X, sign a message with your wallet, and you show on the planet as
// your @handle instead of your wallet address. X sign-in opens in a popup (or this tab if popups are
// blocked); x.html, where X sends you back, leaves the result in localStorage for the game to pick up,
// then closes the popup (or, in this tab, comes back to the game).
// The room gives back a token, kept here per wallet, so later visits show the name without signing.
import { X_HANDLE, claimMessage } from "./x-claim.js";

const PENDING = "courier:xclaim", RETURN = "courier:xreturn"; // (RETURN: where x.html goes back to, signing in in this tab)
const tokenKey = (wallet) => `courier:xname:${wallet.toLowerCase()}`;
const WAIT_MS = 10 * 60_000; // how long an X sign-in's claim lasts on the server

/// `base`: the multiplayer server's http address. `net`: the room (claimName, unname). `chain()`: the
/// chain, for the logged-in wallet and signing. `onChange(arrived)` redraws (arrived: an X sign-in just
/// came back, to show the claim).
export function createXName({ base, net, chain, toast, onChange }) {
  let pending = null; // { claim, handle }: back from X, waiting for the wallet's signature
  let mine = null; // { handle, wallet }: the name the room shows you with

  // (It stays in localStorage until it's signed or dismissed, so a reload in between doesn't lose it.)
  const forget = () => {
    try {
      localStorage.removeItem(PENDING);
    } catch {}
  };
  function pickUp() {
    let p = null;
    try {
      p = JSON.parse(localStorage.getItem(PENDING));
    } catch {}
    if (!p || p.claim === pending?.claim) return;
    if (!(Date.now() - p.at < WAIT_MS)) return forget();
    if (p.error) {
      forget();
      return toast(p.error === "cancelled" ? "X sign-in cancelled." : "X sign-in didn't work. Try again in a moment.", "error");
    }
    if (!/^[0-9a-f]{32}$/.test(p.claim) || !X_HANDLE.test(p.handle)) return forget();
    pending = { claim: p.claim, handle: p.handle };
    onChange(true);
  }
  // The popup writes the result from another window; a phone may only tell us when the game is back in view.
  addEventListener("storage", (e) => e.key === PENDING && e.newValue && pickUp());
  addEventListener("focus", pickUp);
  document.addEventListener("visibilitychange", () => !document.hidden && pickUp());
  setTimeout(pickUp); // (back from X in this tab: once the game around us is set up)

  const token = (wallet) => {
    try {
      return wallet ? localStorage.getItem(tokenKey(wallet)) : null;
    } catch {
      return null;
    }
  };

  return {
    get pending() { return pending; },
    /// Your name, if the room shows you with one for the wallet you're logged in with.
    get mine() {
      const w = chain()?.account;
      return mine && w && mine.wallet === w.toLowerCase() ? mine : null;
    },
    /// The token the room gave this wallet, if any.
    token,
    /// Off to X to sign in (call it straight from a click, so the popup isn't blocked).
    start() {
      const url = `${base}/x/login?back=${encodeURIComponent(location.origin)}`;
      try {
        localStorage.removeItem(RETURN);
      } catch {}
      if (open(url, "courier-x", "popup,width=560,height=760")) return;
      // No popups here: sign in in this tab, and have x.html bring you back.
      try {
        localStorage.setItem(RETURN, JSON.stringify({ url: location.href, at: Date.now() }));
      } catch {}
      location.href = url;
    },
    /// Sign the claim with the logged-in wallet; the room checks it and names you.
    async sign() {
      const c = chain(), wallet = c?.account;
      if (!pending || !wallet) throw new Error("Log in with your wallet first.");
      const { claim, handle } = pending;
      const signature = await c.signMessage(claimMessage(wallet, handle, claim));
      const info = await net.claimName(claim, wallet, signature).catch((e) => {
        if (/expired/i.test(e.message)) this.cancel(); // too late: sign in to X again
        throw e;
      });
      try {
        localStorage.setItem(tokenKey(wallet), info.token);
      } catch {}
      forget();
      pending = null;
      mine = { handle: info.handle, wallet: info.wallet };
      onChange(false);
    },
    cancel() {
      forget();
      pending = null;
      onChange(false);
    },
    /// Back to showing your wallet address.
    unlink() {
      const w = chain()?.account;
      if (w) {
        try {
          localStorage.removeItem(tokenKey(w));
        } catch {}
      }
      net.unname();
      mine = null;
      onChange(false);
    },
    /// The room told us your name (or that you have none).
    named(info) {
      mine = info ? { handle: info.handle, wallet: info.wallet } : null;
      onChange(false);
    },
  };
}
