// Your name on the planet: pick one in the Post Office panel, your wallet signs for it (free, no
// transaction), and you show by it instead of your wallet address. The room gives back a token, kept here
// per wallet, so later visits show the name without signing again.
import { cleanName } from "./name-rules.js";
import { nameOf } from "./names.js";

const tokenKey = (wallet) => `courier:name:${wallet.toLowerCase()}`;

/// `net`: the room (checkName, setName, unname). `chain()`: the chain, for the logged-in wallet and
/// signing. `onChange()` redraws.
export function createUsername({ net, chain, onChange }) {
  let mine = null; // { name, wallet }: the name the room shows you with
  let answered = null; // the wallet (lower case) the room last told us about

  const token = (wallet) => {
    try {
      return wallet ? localStorage.getItem(tokenKey(wallet)) : null;
    } catch {
      return null;
    }
  };
  const wallet = () => chain()?.account ?? null;

  return {
    /// Your name, if the room shows you with one for the wallet you're logged in with.
    get mine() {
      const w = wallet();
      return mine && w && mine.wallet === w.toLowerCase() ? mine : null;
    },
    /// Whether the room is still checking this device's token for your wallet (so your name may be on its way).
    get waiting() {
      const w = wallet();
      return !!w && !!token(w) && answered !== w.toLowerCase();
    },
    /// The name your wallet has, if it has one but this device doesn't show it yet (sign to use it here).
    get elsewhere() {
      const w = wallet();
      return !this.mine && w ? nameOf(w) : null;
    },
    /// The token the room gave this wallet, if any.
    token,
    /// Take `raw` as your name: checked, signed with your wallet, and set by the room.
    async save(raw) {
      const c = chain(), w = wallet();
      if (!w) throw new Error("Log in with your wallet first.");
      const r = cleanName(raw);
      if (r.error) throw new Error(r.error);
      if (r.name !== mine?.name) {
        const check = await net.checkName(r.name);
        if (!check.free) throw new Error(check.why ?? "That name is taken. Pick another.");
      }
      const info = await net.setName(r.name, w, (message) => c.signMessage(message));
      try {
        localStorage.setItem(tokenKey(w), info.token);
      } catch {}
      mine = { name: info.name, wallet: info.wallet };
      onChange();
    },
    /// Back to showing your wallet address.
    remove() {
      net.unname();
      mine = null;
      onChange();
    },
    /// The room told us your name (or that you have none).
    named(info) {
      mine = info ? { name: info.name, wallet: info.wallet } : null;
      answered = wallet()?.toLowerCase() ?? null;
      onChange();
    },
  };
}
