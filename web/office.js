// The Post Office panel: open an office, mint couriers, put them on duty, train
// them, collect $STAMP. Re-rendered every second from the chain snapshot.
import { formatEther, isAddress, parseEther } from "https://esm.sh/viem@2";
import { huntDay, newSpotsIn } from "./hunt-pick.js";
import { courier, SUPPLY } from "./traits.js";
import { SKINS, SKIN_SUPPLY } from "./skins.js";
import { COMPANIONS, TIERS, companionOf } from "./companion-kinds.js";
import { BONUS_DROPS, BONUS_MINUTES, BONUS_POOL_FORM, bonusCap, isBonusDrop } from "./bonus-rules.js";
import { renderStamp } from "./portrait.js";
import { planetLook } from "./planet-looks.js";
import { explain } from "./chain.js";
import { createTrade } from "./trade.js";
import { displayName } from "./names.js";

const TIER_NAMES = ["Kiosk", "Branch", "Depot", "Hub", "HQ"];
const RARITY_INK = { Common: "#5f6b6e", Uncommon: "#5e9f57", Rare: "#3f6fbf", Epic: "#8d5a99", Legendary: "#c9962a" };
const ZERO = "0x0000000000000000000000000000000000000000";
const SOURCE_URL = "https://github.com/AdamNakamoto/courierworld";
const BLOCKS_PER_DAY = 86_400_000n / 1_100n;

const fmt = (wei, d = 2) => Number(formatEther(wei)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/// $STAMP in a few characters: 950, 12.3K, 1.23M.
const compact = (wei) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: Number(formatEther(wei)) >= 1e6 ? 2 : 1 }).format(Number(formatEther(wei)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const powerAt = (base, level) => Math.floor((base * (100 + 12 * (level - 1))) / 100);

function duration(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${secs % 60}s`;
}

/// How many skins of each rarity are in the deck.
const SKIN_RARITY = SKINS.reduce((m, k) => ((m[k.rarity] = (m[k.rarity] ?? 0) + k.supply), m), {});
/// The planets shown across the top of the planet sale.
const PLANET_STRIP = [3, 1, 27, 8];
/// The companion tiers' headings in the shop (the rest read fine as they are).
const TIER_TITLE = { Pet: "Pets", "Space buddy": "Space buddies" };
/// A companion's blurb, down to its first sentence, for the shop's one line.
const firstSentence = (text) => {
  const m = /[.!?]\s/.exec(text); // (no lookbehind: Safari before 16.4 can't even load a module that has one)
  return m ? text.slice(0, m.index + 1) : text;
};

/// The companion bonus: why your minutes aren't counting now (the room's `why`), in plain words.
const BONUS_WHY = {
  signin: "Sign in to the hunt and your minutes start counting.",
  companion: "Have one of your companions follow you: minutes count only while it does.",
  wallet: "The wallet you're logged in with isn't the one signed in to the hunt: sign in again with this one.",
  office: "You need an open post office to earn the bonus and to claim it.",
  full: `That's today's ${BONUS_MINUTES} minutes in. More count from 00:00 UTC.`,
  left: "The companion following you left your wallet today, so its minutes don't count today.",
  strikes: "Your moves looked off this session, so minutes stopped counting: reload the game.",
  warmup: "Keep moving a moment and your minutes start counting.",
  season: "No bonus season is running today.",
  checking: "Checking the chain: a moment.",
};
export const bonusWhy = (why) => (typeof BONUS_WHY[why] === "string" ? BONUS_WHY[why] : "Your minutes aren't counting right now.");
/// Names as a list: "Cat", "Cat and Dog", "Cat, Dog and Frog".
const listOf = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "");

/// `hunt`: the treasure hunt's side in the game ({ state(), running(), signIn(), vouchers(), bonus() }), once TokenDrops
/// is deployed. `bonus()` is the room's last word on the companion bonus (see net.js), or null.
/// `onWearSkin(skin)` dresses you in a revealed skin ({ id, design }), or back in your courier (null);
/// `wearing()` is the id of the skin you have on, if any. `username`: your name on the planet (username.js).
/// `onLaunchpad()` opens the Launchpad (when it's deployed).
/// `onCompanion(id, on)` has your companion of kind `id` follow you (`on`) or go home; `companionsShown()` is the kinds
/// following you (as many as you like, one of each kind you own). (Only once the Courier Companions contract is deployed.)
export function createOffice(chain, {
  onPlayAs, onWearSkin = () => {}, wearing = () => null, onSnapshot, toast, hunt = null, username = null, onLaunchpad = null,
  onCompanion = () => {}, companionsShown = () => [],
}) {
  const $ = (id) => document.getElementById(id);
  const panel = $("office");
  let snap = null, busy = null, qty = 1, skinQty = 1, refreshing = false;
  let skinSecret = ""; // the reveal secret while the owner types it; never stored
  let stampPriceIn = ""; // a new $STAMP price for skins, while the owner types it
  let planetQty = 1, planetPriceIn = ""; // planets to buy; a new planet price, while the owner types it
  let planetPriceShown = null; // the price on the buy button as last drawn
  let admin = null, adminAt = 0, adminFor = null, newFeeWallet = ""; // the admin view, for the wallet the contracts pay
  let board = null; // every office, strongest first (from main.js, every 20 s)
  let huntInfo = null, huntAt = 0; // the TokenDrops contract (today's drops, what you'd be paid, the owner), every few seconds
  // The treasury's "start a drop" form, while it's typed.
  const dropForm = { token: "", perCoin: "", spots: "10", maxPerWallet: "5", dailyCoins: "100", days: "7", amount: "", topUp: "" };
  // The treasury's "companion bonus pool" form, and the drop number of the pool last started (to add to BONUS_DROPS;
  // remembered in this browser until the game lists it).
  const bonusForm = { pool: "", days: "30", amount: "" };
  let bonusMade = null;
  try {
    const n = Number(localStorage.getItem("courier:bonusMade") ?? NaN);
    if (Number.isInteger(n) && !isBonusDrop(n)) bonusMade = n;
    else localStorage.removeItem("courier:bonusMade");
  } catch {}
  let invite = new URLSearchParams(location.search).get("ref") ?? "";
  let naming = false, nameDraft = ""; // picking a name, and what's typed so far
  let followNext = null; // a companion just bought: it joins those following you once the chain shows it's yours
  const stamps = new Map(); // `${seed}:${id}` -> data URL
  const rendering = new Set();
  let queue = Promise.resolve(); // stamp renders, one at a time
  let lastHtml = "", lastMore = "";

  function stampFor(c, seed) {
    const key = `${seed}:${c.id}`;
    if (stamps.has(key)) return stamps.get(key);
    if (!rendering.has(key)) {
      rendering.add(key);
      queue = queue.then(() => renderStamp(c, 200)).then((cv) => {
        stamps.set(key, cv.toDataURL("image/png"));
        draw();
      });
    }
    return null;
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      snap = await chain.snapshot();
      onSnapshot?.(snap);
      // (Called only once the snapshot shows it's yours, so the game, which has the snapshot first, agrees.)
      if (followNext != null && snap.companions?.owned[followNext]) {
        onCompanion(followNext, true);
        followNext = null;
      }
      // The admin view, for the wallet the contracts pay; refreshed every few seconds while the panel is open.
      if (chain.admin && snap.account && !panel.hidden) {
        if (adminFor !== snap.account) [admin, adminFor, adminAt] = [null, snap.account, 0];
        if (Date.now() - adminAt > 4000) {
          adminAt = Date.now();
          admin = (await chain.admin.isAdmin(snap.account)) ? await chain.admin.stats() : null;
        }
      } else if (!snap.account) admin = adminFor = null;
      if (chain.drops && hunt && !panel.hidden && Date.now() - huntAt > 5000) {
        huntAt = Date.now();
        huntInfo = await treasure();
      }
      draw();
    } catch (e) {
      console.error(e);
    } finally {
      refreshing = false;
    }
  }

  /// Today's drops with what you'd be paid for your finds so far, and (for the treasury) every drop and the tokens
  /// it can drop.
  async function treasure() {
    const day = huntDay(), st = hunt.state();
    const [running, own] = await Promise.all([chain.drops.running(day), chain.drops.owner()]);
    const mine = st?.wallet && snap?.account && st.wallet.toLowerCase() === snap.account.toLowerCase() ? st : null;
    for (const d of running) {
      // ($STAMP drops put no coins out, so they pay nothing for finds. The companion bonus's pays for play: below.)
      const n = d.isStamp ? 0 : mine?.coins?.[d.id]?.length ?? 0;
      d.foundToday = n;
      d.pay = n ? (await chain.drops.claimable(d.id, day, Math.min(n, 65535)))[1] : 0n;
    }
    const out = { day, running, ...own };
    // Whether a companion bonus season is running: today's play is paid tomorrow, by a listed drop with $STAMP left.
    out.bonusLive = false;
    for (const id of BONUS_DROPS) {
      const d = await chain.drops.drop(id).catch(() => null);
      if (d && d.isStamp && d.startDay <= day + 1 && day + 1 <= d.endDay && d.left >= d.perCoin) out.bonusLive = true;
    }
    // The companion bonus: the last two settled days' shares (each paid by its season's drop, under the day after it
    // was played), if they're yours.
    const paid = BONUS_DROPS.length && mine ? hunt.bonus?.()?.paid : null;
    out.bonus = [];
    for (const p of Array.isArray(paid) ? paid : []) {
      if (!isBonusDrop(p?.drop) || !Number.isInteger(p.payDay) || !Number.isInteger(p.coins) || p.coins <= 0) continue;
      const pay = (await chain.drops.claimable(p.drop, p.payDay, Math.min(p.coins, 65535)))[1];
      const claimed = !pay && Number(await chain.drops.claimedOn(p.drop, p.payDay)) >= p.coins;
      out.bonus.push({ drop: p.drop, payDay: p.payDay, coins: p.coins, pay, claimed });
    }
    if (own.isOwner) {
      out.all = await chain.drops.all(day);
      const launched = chain.pad ? await chain.pad.tokens((await chain.pad.info()).count) : [];
      out.tokens = launched.map((t) => ({ address: t.address, symbol: t.symbol })); // (a $STAMP drop would put no coins out)
    }
    return out;
  }

  /// Why your finds (the room's vouchers) would pay nothing now, in words.
  async function nothingToClaim(vouchers) {
    for (const v of vouchers) {
      const d = await chain.drops.dayOf(v.drop, v.day), when = v.day === huntDay() ? "today" : "yesterday";
      // (A companion bonus voucher is for the day before its day, and a wallet's whole share: if it's not out of
      // $STAMP, it's been claimed.)
      if (isBonusDrop(v.drop)) {
        if (d.left < d.perCoin) return "The companion bonus has paid out all its $STAMP for now.";
        continue;
      }
      if (d.left < d.perCoin) return `The $${d.symbol} drop has paid out all its tokens.`;
      if (d.mine >= d.maxPerWallet) return `You've claimed ${when}'s ${d.maxPerWallet} $${d.symbol} coins, the most a wallet gets a day. More come out at 00:00 UTC.`;
      if (d.paid >= Number(d.dailyCoins)) return `All ${d.dailyCoins} of ${when}'s $${d.symbol} coins have been claimed: each day pays a set number across everyone, first come first served. New coins come out at 00:00 UTC: claim soon after you find them.`;
    }
    const bonus = huntInfo?.bonusLive ? ", or play with your companion following you (that's paid the next day)" : "";
    return vouchers.length ? `Nothing new to claim: find more coins first${bonus}.` : `Nothing to claim yet: find a coin first${bonus}.`;
  }

  async function run(label, fn) {
    if (busy) return;
    busy = label;
    draw(true);
    const t = toast(`${label}…`, "busy");
    try {
      await fn();
      toast(`${label} ✓`);
    } catch (e) {
      console.error(e);
      toast(explain(e), "error");
    } finally {
      t.remove();
      busy = null;
      await refresh();
    }
  }

  /// The treasury's controls: start a drop, the list of drops (end, top up, withdraw), pause.
  function dropAdmin(h) {
    const f = dropForm, token = f.token || h.tokens[0]?.address;
    let html = `<div class="admin-hunt"><h4>Start a drop <span class="muted">you run the treasure hunt</span></h4>`;
    if (!h.tokens.length) html += `<p class="note">A drop's coins pay a Launchpad token: once one has launched, you can start a drop of it here.</p>`;
    else html += `<label class="field">Token<select data-act="dropToken">${h.tokens.map((t) => `<option value="${t.address}" ${t.address === token ? "selected" : ""}>$${esc(t.symbol)}</option>`).join("")}</select></label>
      <label class="field">Tokens per coin<input data-act="dropPerCoin" value="${esc(f.perCoin)}" inputmode="decimal" placeholder="e.g. 100000"></label>
      <label class="field">Coins out each day (1 to 48)<input data-act="dropSpots" value="${esc(f.spots)}" inputmode="numeric"></label>
      <label class="field">Coins one wallet is paid for, per day<input data-act="dropMax" value="${esc(f.maxPerWallet)}" inputmode="numeric"></label>
      <label class="field">Coins paid per day, everyone together (every player can collect each coin, so this caps a day)<input data-act="dropDaily" value="${esc(f.dailyCoins)}" inputmode="numeric"></label>
      <label class="field">Days (from today)<input data-act="dropDays" value="${esc(f.days)}" inputmode="numeric"></label>
      <label class="field">Tokens to put in${dropSuggest() ? ` <span class="muted">(${fmt(dropSuggest(), 0)} covers every day's limit)</span>` : ""}<input data-act="dropAmount" value="${esc(f.amount)}" inputmode="decimal" placeholder="${dropSuggest() ? formatEther(dropSuggest()) : ""}"></label>
      <button class="pbtn wide" data-act="dropCreate" ${busy ? "disabled" : ""}>Start the drop</button>`;
    // The companion bonus's pool (bonus-rules.js): a $STAMP drop at 1 $STAMP a coin, starting tomorrow, so there's
    // time to set it in the game before it runs. (Shown once the bonus is switched on: BONUS_POOL_FORM.)
    const b = bonusForm, suggest = bonusSuggest();
    if (BONUS_POOL_FORM) html += `<h4>Companion bonus pool <span class="muted">extra $STAMP for play</span></h4>
      <label class="field">$STAMP a day, everyone together (24 to 10,000)<input data-act="bonusPool" value="${esc(b.pool)}" inputmode="numeric" placeholder="e.g. 500"></label>
      <label class="field">Days (from tomorrow)<input data-act="bonusDays" value="${esc(b.days)}" inputmode="numeric"></label>
      <label class="field">$STAMP to put in${suggest ? ` <span class="muted">(${fmt(suggest, 0)} covers every day)</span>` : ""}<input data-act="bonusAmount" value="${esc(b.amount)}" inputmode="decimal" placeholder="${suggest ? formatEther(suggest) : ""}"></label>
      <button class="pbtn wide" data-act="bonusCreate" ${busy ? "disabled" : ""}>Start the bonus pool</button>
      <p class="note">It starts tomorrow (UTC): today's play is the first it pays for, so start it the day before a season. The game pays the bonus from it only once its drop number is added to BONUS_DROPS in web/bonus-rules.js and the room and the site are deployed. Do both before tomorrow, or the game won't pay it out. To follow one season with the next, start the next on the current one's last day.</p>
      ${bonusMade != null ? `<p class="note"><b>Your new pool is drop #${bonusMade}: add ${bonusMade} to BONUS_DROPS in web/bonus-rules.js and deploy the room and the site before 00:00 UTC.</b></p>` : ""}`;
    if (h.all?.length) {
      html += `<h4>Drops</h4>`;
      for (const d of h.all) {
        const live = d.startDay <= h.day && h.day <= d.endDay, over = h.day > d.endDay + 1 || d.endDay < d.startDay;
        const what = d.isBonus ? " · companion bonus" : d.id === bonusMade ? " · companion bonus (add it to BONUS_DROPS)"
          : d.isStamp && h.day < d.startDay ? " · $STAMP, not running yet" : d.isStamp ? " · $STAMP (no coins in the game: end it and withdraw)" : "";
        html += `<div class="kv"><span>#${d.id} $${esc(d.symbol)}${what} · ${fmt(d.perCoin, 0)}/coin · ${live ? `running · paid today ${d.paidToday}/${d.dailyCoins}` : over ? "over" : h.day > d.endDay ? "claims close tomorrow" : "starts soon"}</span><b>${fmt(d.left, 0)} left</b></div>
          <div class="row2">${live || h.day < d.startDay ? `<button class="pbtn" data-act="dropEnd" data-id="${d.id}" ${busy ? "disabled" : ""} ${d.isBonus ? `title="Today's play is the last it pays for (paid tomorrow)"` : ""}>End</button>` : ""}
          ${!over ? `<button class="pbtn" data-act="dropTopUp" data-id="${d.id}" data-token="${d.token}" ${busy ? "disabled" : ""}>Top up</button>` : ""}
          ${(over || h.paused) && d.left > 0n ? `<button class="pbtn" data-act="dropWithdraw" data-id="${d.id}" ${busy ? "disabled" : ""}>Withdraw</button>` : ""}</div>`;
      }
      html += `<label class="field">Tokens to top up with<input data-act="dropTopUpAmount" value="${esc(f.topUp)}" inputmode="decimal" placeholder="e.g. 50000"></label>`;
    }
    html += `<button class="pbtn wide" data-act="dropPause" ${busy ? "disabled" : ""}>${h.paused ? "Resume claims" : "Pause all claims"}</button>
      <p class="note">${h.paused ? "Claims are paused: you can withdraw any drop." : "Watch each drop's paid-today count: if it fills up unusually fast (the server's key leaked, say), pause. Claims stop at once and you can take every drop's tokens back. A drop can lose at most its daily cap a day."}</p></div>`;
    return html;
  }
  /// $STAMP that covers the companion bonus pool for all its days.
  function bonusSuggest() {
    try {
      const pool = BigInt(bonusForm.pool.replace(/,/g, "") || "0"), days = BigInt(bonusForm.days || "0");
      return pool > 0n && days > 0n ? parseEther("1") * pool * days : 0n;
    } catch {
      return 0n;
    }
  }
  /// The treasure hunt's card for the companion bonus. `b`: the room's word on it; `h`: today's drops (treasure());
  /// `st`: the room's view of you, if it's for the wallet logged in now.
  function bonusCard(b, h, st) {
    const max = Number(b.max) || BONUS_MINUTES, minutes = Math.min(max, Math.max(0, Number(b.minutes) || 0));
    const meta = companionOf(b.kind), coins = Number(b.coins) || 0, pool = Number(b.pool) || 0;
    // Out of season (or the pool has paid out), only what's still to claim.
    const shares = st && Array.isArray(h.bonus) ? h.bonus.filter((x) => x.payDay === h.day || x.payDay === h.day - 1) : [];
    const shareRows = shares.map((x) => `<div class="kv"><span>${x.payDay === h.day ? "Yesterday's bonus" : "The day before yesterday's bonus (claim today)"}</span><b>${x.pay ? `${fmt(x.pay, 0)} $STAMP to claim` : `${x.coins.toLocaleString()} $STAMP${x.claimed ? " · claimed" : ""}`}</b></div>`).join("");
    if (!b.live || b.dry) {
      return `<div class="drop-card bonus-card"><div class="kv"><span>${meta ? meta.icon : "🐾"} <b>Companion bonus</b></span></div>
        <p class="note">${b.live ? "This season's pool has paid out for now." : "No bonus season is running today."}</p>${shareRows}</div>`;
    }
    let html = `<div class="drop-card bonus-card"><div class="kv"><span>${meta ? meta.icon : "🐾"} <b>Companion bonus</b></span><b>${minutes}/${max} min</b></div>
      <div class="hunt-bar"><i style="width:${((100 * minutes) / max).toFixed(1)}%"></i><span>${minutes} of ${max} minutes played today</span></div>`;
    if (coins > 0) html += `<p class="note">About ${coins.toLocaleString()} $STAMP so far, paid tomorrow.</p>`;
    if (meta) html += `<p class="note">${esc(meta.name)} is following you: ${esc(meta.tier)} companions earn up to ${bonusCap(meta.id)} $STAMP a day.</p>`;
    // (Kinds that left the wallet today are named: that says "left" for the one following you too.)
    const lost = [...new Set(Array.isArray(b.lost) ? b.lost : [])].map((k) => companionOf(Number(k))).filter(Boolean);
    if (b.why != null && !(b.why === "left" && lost.length)) html += `<p class="note bonus-why">${esc(bonusWhy(b.why))}</p>`;
    if (lost.length) html += `<p class="note bonus-why">${esc(listOf(lost.map((c) => c.name)))} left your wallet today, so ${lost.length > 1 ? "their" : "its"} minutes don't count today.</p>`;
    if (pool > 0) html += `<p class="note">If everyone together earns more than the day's ${pool.toLocaleString()} $STAMP, it's shared in proportion to what each earned.</p>`;
    // The settled days' shares (each paid under the day after it was played), claimed with the treasure below.
    html += shareRows;
    html += `<p class="note">Minutes count while you move about with your own companion following you, signed in to the hunt. Claim each day's bonus the next day or the one after.</p></div>`;
    return html;
  }
  /// Tokens that cover a drop's daily limit for all its days.
  function dropSuggest() {
    const f = dropForm;
    try {
      const per = parseEther(f.perCoin || "0"), daily = BigInt(f.dailyCoins || "0"), days = BigInt(f.days || "0");
      return per > 0n && daily > 0n && days > 0n ? per * daily * days : 0n;
    } catch {
      return 0n;
    }
  }

  function draw(force) {
    if (!snap || panel.hidden) return;
    const s = snap, revealed = s.seed !== 0n;
    let html = "";

    // ---- who's playing
    html += `<div class="who">`;
    if (s.devAccounts) {
      html += `<select data-act="account">${s.accounts.map((a, i) => `<option value="${a}" ${a === s.account ? "selected" : ""}>${["Owner", "Treasury"][i] ?? `Player ${i - 1}`} · ${short(a)}</option>`).join("")}</select>`;
    } else if (!s.account) {
      html += `<button class="pbtn primary" data-act="connect">Log in with wallet</button>`;
    } else {
      html += `<a class="addr" href="${s.explorer ? `${s.explorer}/address/${s.account}` : "#"}" target="_blank" rel="noopener">${short(s.account)}</a>
        <button class="pbtn" data-act="connect">Switch wallet</button>`;
    }
    // Your name on the planet, instead of your wallet address.
    if (s.account && username) {
      const mine = username.mine, elsewhere = username.elsewhere;
      if (mine) html += `<span class="pname" title="Your name on the planet">${esc(mine.name)}</span><button class="pbtn" data-act="nameEdit" ${busy ? "disabled" : ""}>Change name</button>`;
      else if (username.waiting) html += elsewhere ? `<span class="pname" title="Your name on the planet">${esc(elsewhere)}</span>` : ""; // (the room is about to say)
      else if (elsewhere) html += `<span class="pname" title="Your name on the planet">${esc(elsewhere)}</span><button class="pbtn" data-act="nameUse" ${busy ? "disabled" : ""}>Use it here</button>`;
      else html += `<button class="pbtn" data-act="nameEdit" ${busy ? "disabled" : ""}>✏️ Pick a name</button>`;
    }
    if (s.account) {
      html += `<span class="bal"><b>${fmt(s.eth, 3)}</b> ETH</span>`;
      if (s.game) {
        if (s.imd != null) html += `<span class="bal"><b>${fmt(s.imd)}</b> IMD</span>`;
        html += `<span class="bal"><b>${fmt(s.stamp)}</b> $STAMP</span>`;
      }
    }
    html += `</div>`;
    if (onLaunchpad && s.game) {
      html += `<section class="padlink"><button class="pbtn wide" data-act="launchpad">🚀 Launchpad: launch your own token</button>
        <p class="note">Any post office owner can launch one, in Times Square. Burns $STAMP; 5% of each launch goes to drops for post offices.</p></section>`;
    }
    if (naming && s.account && username) {
      const mine = username.mine;
      html += `<section class="pickname"><h3>${mine ? "Change your name" : "Pick a name"}</h3>
        <div class="namerow"><input id="nameInput" data-act="nameInput" maxlength="15" placeholder="3 to 15 letters, numbers or _" spellcheck="false" autocomplete="off" autocapitalize="off">
        <button class="pbtn primary" data-act="nameSave" ${busy ? "disabled" : ""}>Save</button></div>
        <p class="note">Shown instead of your wallet address: on your name tag, in chat, on your post office and on the leaderboard.
        First come, first served, and you can change it once a day. Saving asks your wallet to sign: free, no transaction.</p>
        <div class="namerow">${mine ? `<button class="pbtn" data-act="nameRemove" ${busy ? "disabled" : ""}>Use my wallet address</button>` : ""}
        <button class="pbtn" data-act="nameCancel">Cancel</button></div></section>`;
    }

    // ---- admin: only for the wallet the contracts pay
    if (admin) {
      const a = admin, m = a.market, usd = (n) => (m ? ` (≈ $${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })})` : "");
      const fees = Number(formatEther(a.pendingFees)), price = m ? m.stampUsd : 0;
      const days = Math.floor(a.halvingIn / 86400), hours = Math.floor((a.halvingIn % 86400) / 3600);
      const link = (addr) => (s.explorer ? `<a href="${s.explorer}/address/${addr}" target="_blank" rel="noopener">${short(addr)}</a>` : short(addr));
      html += `<section class="admin"><h3>Admin <span class="muted">your wallet runs the treasury</span></h3>
        <div class="pending"><b>${fmt(a.pendingFees, 4)}</b><span>IMD in $STAMP trading fees${usd(m ? fees * m.imdUsd : 0)}</span></div>
        <button class="pbtn primary wide" data-act="collectFees" ${a.pendingFees === 0n || busy ? "disabled" : ""}>Collect $STAMP fees to ${short(a.feeRecipient)}</button>
        ${a.padFees != null ? `<div class="pending"><b>${fmt(a.padFees, 4)}</b><span>IMD in launchpad trading fees${usd(m ? Number(formatEther(a.padFees)) * m.imdUsd : 0)}</span></div>
        <button class="pbtn primary wide" data-act="collectPadFees" ${a.padFees === 0n || busy ? "disabled" : ""}>Collect launchpad fees to ${short(a.padFeeRecipient)}</button>` : ""}
        <h4>Treasury · ${link(a.treasury)}</h4>
        <div class="kv"><span>ETH</span><b>${fmt(a.treasuryEth, 4)}</b></div>
        <div class="kv"><span>IMD</span><b>${fmt(a.treasuryImd, 2)}</b></div>
        <div class="kv"><span>$STAMP</span><b>${fmt(a.treasuryStamp, 0)}</b></div>
        <h4>$STAMP</h4>
        ${m ? `<div class="kv"><span>Price</span><b>$${price.toPrecision(3)} · ${m.stampImd.toPrecision(3)} IMD</b></div>
        <div class="kv"><span>Market cap (all minted)</span><b>$${Math.round(Number(formatEther(a.supply)) * price).toLocaleString()}</b></div>
        <div class="kv"><span>Fully diluted (21M)</span><b>$${Math.round(21_000_000 * price).toLocaleString()}</b></div>` : ""}
        <div class="kv"><span>Minted</span><b>${fmt(a.minted, 0)} / 21,000,000</b></div>
        <div class="kv"><span>Earned by offices</span><b>${fmt(a.emitted, 0)}</b></div>
        <div class="kv"><span>Burned</span><b>${fmt(a.burned, 0)}</b></div>
        <div class="kv"><span>Reward per block</span><b>${fmt(a.reward, 4)}</b></div>
        <div class="kv"><span>Next halving</span><b>in ${days}d ${hours}h</b></div>
        <h4>Game</h4>
        <div class="kv"><span>Delivery power, whole planet</span><b>${Number(a.totalPower).toLocaleString()}</b></div>
        <div class="kv"><span>Office price</span><b>${fmt(s.officePrice, 3)} ETH</b></div>
        <div class="kv"><span>NFT royalty</span><b>${a.royaltyBps / 100}% to ${short(a.royaltyTo)}</b></div>
        <h4>Fee wallet</h4>
        <p class="note">Trading fees are paid to ${link(a.feeRecipient)}. You can hand that to another wallet; after that only the new one can collect fees or change it again.</p>
        <label class="field">New fee wallet<input id="feeWallet" data-act="feeWallet" placeholder="0x…" spellcheck="false" autocomplete="off"></label>
        <button class="pbtn wide" data-act="setFeeWallet" ${busy ? "disabled" : ""}>Change the fee wallet</button>
        <p class="note">Ownership of every contract is renounced, so these are the only levers left. Office sales (ETH), 25% of $STAMP spent in the game and NFT royalties reach the treasury by themselves.</p>
      </section>`;
    }

    // ---- office
    if (s.office && !s.office.open) {
      html += `<section><h3>Open a post office</h3>
        <p class="note">A ${TIER_NAMES[0]} with ${s.tiers[0].slots} desks and ${s.tiers[0].routes} routes. A trainee courier starts work right away, so you earn $STAMP even before you own a Courier.</p>
        <label class="field">Invited by (optional)<input id="invite" data-act="invite" placeholder="0x…" spellcheck="false"></label>
        <button class="pbtn primary" data-act="open" ${busy ? "disabled" : ""}>Open · ${fmt(s.officePrice, 3)} ETH</button></section>`;
    } else if (s.office) {
      const o = s.office, t = s.tiers[o.tier], next = s.tiers[o.tier + 1];
      const share = s.totalPower ? Number((o.power * 10000n) / s.totalPower) / 100 : 0;
      const perDay = s.totalPower ? (s.rewardPerBlock * BLOCKS_PER_DAY * o.power) / s.totalPower : 0n;
      const readyAt = o.lastUpgrade ? Number(o.lastUpgrade + s.cooldown) : 0;
      const waiting = readyAt > Number(s.now);
      html += `<section><h3>${TIER_NAMES[o.tier] ?? `Tier ${o.tier + 1}`} <span class="muted">post office</span></h3>
        <div class="pending"><b>${fmt(s.pending, 3)}</b><span>$STAMP ready</span></div>
        <button class="pbtn primary wide" data-act="claim" ${s.pending === 0n || busy ? "disabled" : ""}>Collect $STAMP</button>
        <div class="kv"><span>Delivery power</span><b>${Number(o.power).toLocaleString()}</b></div>
        <div class="kv"><span>Share of the planet</span><b>${share.toFixed(2)}%</b></div>
        <div class="kv"><span>Per day</span><b>≈ ${fmt(perDay)} $STAMP</b></div>
        <div class="meter"><span>Desks</span><div class="bar"><div style="width:${(o.onDuty / t.slots) * 100}%"></div></div><span>${o.onDuty}/${t.slots}</span></div>
        <div class="meter"><span>Routes</span><div class="bar"><div style="width:${(o.routesUsed / t.routes) * 100}%"></div></div><span>${o.routesUsed}/${t.routes}</span></div>
        ${next ? `<button class="pbtn wide" data-act="upgrade" ${waiting || s.stamp < next.upgradeCost || busy ? "disabled" : ""}>
            ${waiting ? `Upgrade ready in ${duration(readyAt - Number(s.now))}` : `Upgrade to ${TIER_NAMES[o.tier + 1]} (${next.slots} desks, ${next.routes} routes) · ${fmt(next.upgradeCost, 0)} $STAMP`}</button>`
          : `<p class="note">Your post office is HQ. It doesn't get bigger than this.</p>`}
        ${o.referrer !== ZERO ? `<p class="note">2.5% of what you collect goes to ${short(o.referrer)}, who invited you.</p>` : ""}
      </section>`;
    }

    // ---- the treasure hunt: the treasury's token drops (coins round the planet)
    if (s.game && chain.drops && hunt && huntInfo) {
      // The room's view of you counts only if it's for the wallet logged in now.
      const h = huntInfo, st0 = hunt.state(), st = st0?.wallet && s.account && st0.wallet.toLowerCase() === s.account.toLowerCase() ? st0 : null;
      const coins = h.running.filter((d) => !d.isStamp);
      const total = h.running.reduce((m, d) => (d.pay ? m.set(d.symbol, (m.get(d.symbol) ?? 0n) + d.pay) : m), new Map());
      // (The companion bonus's drops pay nothing for finds, so their shares are only counted here.)
      for (const x of h.bonus ?? []) if (x.pay) total.set("STAMP", (total.get("STAMP") ?? 0n) + x.pay);
      html += `<section class="hunt"><h3>Treasure hunt <span class="muted">new spots every day at 00:00 UTC</span></h3>`;
      if (coins.some((d) => d.left >= d.perCoin)) html += `<p class="on">🪙 The hunt is on! New coins in ${newSpotsIn()}</p>`;
      // Each coin drop: what you've found of today's coins, what they pay, how many of the day's are left to claim
      // (each day pays a set number across everyone, first come first served), and how far through the drop it is.
      for (const d of coins) {
        const sym = `$${esc(d.symbol)}`, daily = Number(d.dailyCoins), open = Math.max(0, daily - Number(d.paid ?? 0));
        html += `<div class="drop-card"><div class="kv"><span>🪙 <b>${sym} coins</b></span><b>${st ? `${st.coins?.[d.id]?.length ?? 0}/${d.spots} found` : `${d.spots} out today`}</b></div>
          <p class="note">${fmt(d.perCoin, 0)} ${sym} a coin · up to ${d.maxPerWallet} a wallet a day</p>`;
        if (d.left < d.perCoin) html += `<p class="note">All paid out.</p>`;
        else {
          html += `<div class="hunt-bar"><i style="width:${((100 * open) / Math.max(1, daily)).toFixed(1)}%"></i><span>${open} of ${daily} left to claim today</span></div>`;
          if (!open) html += `<p class="note">Today's coins are all claimed. New ones come out at 00:00 UTC: claim soon after you find them.</p>`;
        }
        html += `<p class="note">Day ${h.day - d.startDay + 1} of ${d.endDay - d.startDay + 1} · ${compact(d.left)} ${sym} left in the drop</p></div>`;
      }
      const bonus = BONUS_DROPS.length ? hunt.bonus?.() : null;
      if (bonus?.on && (bonus.live || h.bonus?.length)) html += bonusCard(bonus, h, st);
      if (!coins.length) html += `<p class="note">No coins out today: they appear when the treasury runs a drop.</p>`;
      if (!s.account) html += `<p class="note">Log in, open a post office and sign in to get paid for the coins you find.</p>`;
      else if (!s.office?.open) html += `<p class="note">Open a post office to claim treasure.</p>`;
      else if (!st?.wallet) html += `<button class="pbtn primary wide" data-act="huntSignIn" ${busy ? "disabled" : ""}>Sign in to hunt</button>
        <p class="note">One signature proves this wallet is yours. It costs nothing and can't move anything. What you find after signing in counts.</p>`;
      else {
        const label = total.size ? `Claim ${[...total].map(([sym, v]) => `${fmt(v, 0)} $${esc(sym)}`).join(" + ")}` : "Claim treasure";
        html += `<button class="pbtn primary wide" data-act="huntClaim" ${busy ? "disabled" : ""}>${label}</button>
          <p class="note">Claim by the end of the next day (UTC). Each drop pays a few coins per wallet a day, while its tokens last.</p>`;
      }
      if (h.isOwner) html += dropAdmin(h);
      html += `</section>`;
    }

    // ---- the leaderboard
    if (s.game) {
      html += `<section><h3>Leaderboard <span class="muted">${board ? `${board.count.toLocaleString()} post office${board.count === 1 ? "" : "s"} open` : "loading…"}</span></h3>`;
      if (board?.count) html += `<p class="earned-all"><b>${fmt(board.totalEarned, 0)}</b> $STAMP earned by post offices so far</p>`;
      if (board?.count) {
        const me = s.account?.toLowerCase();
        const row = (o, i) => {
          const share = board.totalPower ? Number((o.power * 10000n) / board.totalPower) / 100 : 0;
          const mine = me && o.owner.toLowerCase() === me;
          return `<li class="${mine ? "me" : ""}"><span class="rk">${i + 1}</span>
            <a href="${s.explorer ? `${s.explorer}/address/${o.owner}` : "#"}" target="_blank" rel="noopener">${mine ? "You" : esc(displayName(o.owner))}</a>
            <span class="tr">${TIER_NAMES[o.tier] ?? `Tier ${o.tier + 1}`}</span><span class="pw">${Number(o.power).toLocaleString()}</span>
            <span class="er" title="${fmt(o.earned)} $STAMP earned: ${fmt(o.claimed)} claimed, ${fmt(o.waiting)} waiting">${compact(o.earned)}</span><span class="sh">${share.toFixed(1)}%</span></li>`;
        };
        const mineAt = me ? board.list.findIndex((o) => o.owner.toLowerCase() === me) : -1;
        html += `<ol class="board"><li class="hd"><span></span><span>Office</span><span></span><span>Power</span><span>Earned</span><span>Share</span></li>${board.list.slice(0, 10).map(row).join("")}${mineAt >= 10 ? `<li class="gap">…</li>${row(board.list[mineAt], mineAt)}` : ""}</ol>
          <p class="note">Ranked by delivery power. Earned is all the $STAMP an office has made, claimed or waiting to be claimed (hover for the split). The strongest offices stand on the lots by the main post office, with a gold, silver or bronze star for the top three.</p>`;
      } else if (board) {
        html += `<p class="note">No post offices yet. Open the first one and take the best lot in town.</p>`;
      }
      html += `</section>`;
    }

    // ---- before the game: stage 1 of the launch is the mint alone
    if (!s.game) {
      html += `<section><h3>Post offices open soon</h3>
        <p class="note">${revealed
          ? "The mint is over and the couriers are revealed. The post offices open next: put your couriers on duty there to earn $STAMP."
          : "The couriers are being minted now. When the mint ends they're revealed, and then the post offices open: put your couriers on duty to earn $STAMP."}</p></section>`;
    }

    // ---- the trade section sits here, in its own element (see trade.js)
    const top = html;
    html = "";

    // ---- couriers
    if (s.mine) {
      html += `<section><h3>Your couriers <span class="muted">${s.mine.length}</span></h3>`;
      if (!s.mine.length) html += `<p class="note">${s.game ? "None yet. Your trainee is holding the fort." : "None yet. Mint one below."}</p>`;
      else if (!revealed) html += `<p class="note">Sealed until the mint closes and the collection is revealed.</p>`;
      html += `<div class="couriers">`;
      for (const m of s.mine) {
        if (!revealed) {
          html += `<div class="ccard sealed"><div class="env-big"></div><b>#${m.id}</b><span class="muted">Sealed</span></div>`;
          continue;
        }
        const c = courier(m.id, s.seed);
        const img = stampFor(c, s.seed);
        const power = powerAt(c.ride.power, m.level);
        const cost = s.game ? s.levelBase * BigInt(m.level) * BigInt(m.level) : 0n;
        html += `<div class="ccard ${m.onDuty ? "duty" : ""}">
          ${img ? `<img src="${img}" alt="">` : `<div class="ph"></div>`}
          <div class="cinfo"><b>#${m.id}</b> <span style="color:${RARITY_INK[c.ride.rarity]}">${c.ride.name}</span>
            <span class="muted">Lv ${m.level} · ${power} power · ${c.ride.routes} route${c.ride.routes > 1 ? "s" : ""}</span>
            ${m.onDuty ? `<span class="tag">On duty</span>` : ""}</div>
          <div class="cact">
            ${s.office?.open ? `<button class="pbtn" data-act="${m.onDuty ? "unassign" : "assign"}" data-id="${m.id}" ${busy ? "disabled" : ""}>${m.onDuty ? "Off duty" : "On duty"}</button>` : ""}
            ${s.game ? `<button class="pbtn" data-act="level" data-id="${m.id}" data-level="${m.level}" ${m.level >= 10 || s.stamp < cost || busy ? "disabled" : ""}
              title="Level ${m.level + 1}: +12% power">${m.level >= 10 ? "Max level" : `Train · ${fmt(cost, 0)}`}</button>` : ""}
            <button class="pbtn" data-act="play" data-id="${m.id}">Play as</button>
          </div></div>`;
      }
      html += `</div></section>`;
    }

    // ---- Courier Skins: a blind mint for ETH, revealed afterwards; cosmetic only
    if (s.skins) {
      const k = s.skins, sealed = k.seed === 0n, worn = wearing();
      html += `<section class="skins"><h3>Courier Skins <span class="muted">${SKIN_SUPPLY} limited outfits and rides</span></h3>
        <div class="skin-strip">${["nightrider", "astronaut", "golden", "car-violet"].map((key) => `<img src="./skins/${key}.png" alt="">`).join("")}</div>
        <div class="meter"><span>Minted</span><div class="bar"><div style="width:${(k.minted / SKIN_SUPPLY) * 100}%"></div></div><span>${k.minted}/${SKIN_SUPPLY}</span></div>`;
      if (k.saleOpen && k.minted < SKIN_SUPPLY) {
        html += `<div class="mintrow"><button class="pbtn" data-act="skinQty" data-d="-1">−</button><b>${skinQty}</b><button class="pbtn" data-act="skinQty" data-d="1">+</button>
          <button class="pbtn primary" data-act="mintSkins" ${!s.account || busy ? "disabled" : ""}>Mint ${skinQty} · ${fmt(k.price * BigInt(skinQty), 3)} ETH</button></div>`;
        // Or pay in $STAMP, from the same 999.
        const st = k.stamp;
        if (st) {
          const cost = st.price * BigInt(skinQty), ready = st.open && st.float >= k.price * BigInt(skinQty);
          const short = !!s.account && s.stamp != null && s.stamp < cost;
          html += `<button class="pbtn wide stamp-mint" data-act="mintSkinsStamp" ${!s.account || busy || !ready || short ? "disabled" : ""}>Mint ${skinQty} · ${fmt(cost, 0)} $STAMP</button>`;
          if (!st.open) html += `<p class="note">Paying in $STAMP is paused right now.</p>`;
          else if (!ready) html += `<p class="note">The $STAMP sale needs topping up. Pay in ETH for now, or check back soon.</p>`;
          else if (short) html += `<p class="note">You have ${fmt(s.stamp, 0)} $STAMP: not quite enough for ${skinQty > 1 ? `${skinQty} skins` : "a skin"}.</p>`;
        }
        html += `
          ${s.account ? "" : `<p class="note">Log in to mint.</p>`}
          <p class="note">A blind mint: every skin's design is revealed after the mint. ${SKIN_RARITY.Common} Common, ${SKIN_RARITY.Rare} Rare and ${SKIN_RARITY.Legendary} Legendary, including 39 Moonwedge supercars. Skins are cosmetic: everyone in the game sees yours, and they never change what you earn.</p>`;
      } else {
        html += `<p class="note">${sealed ? "The mint is closed. The skins are revealed soon." : "The mint is over and the skins are revealed. Find more on OpenSea."}</p>`;
      }
      html += `<p class="note">Resales pay a 5% royalty to the game, enforced by the contract: marketplaces can only sell skins in trades that pay it.</p>`;
      if (k.isOwner && sealed) {
        html += `<div class="admin-hunt"><h4>Collection <span class="muted">you own the skins contract</span></h4>
          <button class="pbtn wide" data-act="skinSale" ${busy ? "disabled" : ""}>${k.saleOpen ? "Close the sale" : "Open the sale"}</button>`;
        if (!k.saleOpen) {
          html += `<label class="field">Reveal secret<input id="skinSecret" data-act="skinSecret" type="password" autocomplete="off" spellcheck="false" placeholder="the number deploy-skins.sh printed"></label>
            <button class="pbtn primary wide" data-act="skinReveal" ${busy ? "disabled" : ""}>Reveal the skins</button>`;
        }
        html += `<p class="note">Close the sale, wait about 15 seconds, then reveal: the reveal must come in a later block than the close, so nobody can mint knowing the designs. The secret is checked against the contract before anything is sent, and the reveal ends the sale for good.</p></div>`;
      }
      // The $STAMP sale's owner: its float, price and switch.
      if (k.stamp?.isOwner) {
        const st = k.stamp;
        html += `<div class="admin-hunt"><h4>Paying in $STAMP <span class="muted">you own the sale</span></h4>
          <div class="kv"><span>Price</span><b>${fmt(st.price, 0)} $STAMP a skin</b></div>
          <div class="kv"><span>Float</span><b>${fmt(st.float, 3)} ETH · enough for ${(st.float / k.price).toString()} skins</b></div>
          <div class="row2"><button class="pbtn" data-act="stampTopUp" ${busy ? "disabled" : ""}>Top up 0.04 ETH</button>
            <button class="pbtn" data-act="stampOpen" ${busy ? "disabled" : ""}>${st.open ? "Pause it" : "Open it"}</button></div>
          <label class="field">New $STAMP price a skin<input id="stampPriceIn" data-act="stampPriceIn" inputmode="decimal" placeholder="${fmt(st.price, 0)}"></label>
          <button class="pbtn wide" data-act="stampSetPrice" ${busy ? "disabled" : ""}>Change the price</button>
          <p class="note">The float pays each skin's ETH price, which goes straight on to the skins treasury, so topping it up only moves your own ETH round. The $STAMP goes to the treasury.</p></div>`;
      }
      if (k.mine?.length) {
        html += `<h4>Your skins <span class="muted">${k.mine.length}</span></h4><div class="couriers">`;
        for (const m of k.mine) {
          const d = m.design == null ? null : SKINS[m.design], on = worn === m.id;
          html += `<div class="ccard ${on ? "duty" : ""}"><img src="./skins/${d ? d.key : "mystery"}.png" alt="">
            <div class="cinfo"><b>#${m.id}</b> ${d ? `<span style="color:${RARITY_INK[d.rarity]}">${d.name}</span><span class="muted">${d.rarity} ${d.ride ? "ride" : "outfit"}</span>` : `<span class="muted">Sealed until the reveal</span>`}
              ${on ? `<span class="tag">Wearing</span>` : ""}</div>
            <div class="cact">${d ? `<button class="pbtn" data-act="${on ? "unwear" : "wear"}" data-id="${m.id}">${on ? "Take off" : "Wear"}</button>` : ""}</div></div>`;
        }
        html += `</div>`;
      }
      html += `<p class="note">Check it yourself: ${s.explorer ? `<a href="${s.explorer}/address/${k.address}" target="_blank" rel="noopener">contract</a> · ` : ""}<a href="${SOURCE_URL}" target="_blank" rel="noopener">source code</a></p></section>`;
    }

    // ---- Courier Companions: friends that follow your courier around, bought only with $STAMP (once deployed)
    if (s.companions) {
      const c = s.companions, shown = companionsShown(), onChain = new Map(c.kinds.map((k) => [k.id, k]));
      let needStamp = false; // some kind you could buy costs more $STAMP than you have
      html += `<section class="companions"><h3>Companions <span class="muted">they follow you everywhere</span></h3>
        <p class="note">Pets, space buddies and rarer friends that walk or fly beside your courier, on the planet, the moon and Mars. Everyone in the game sees yours. Each kind is limited, and paid only in $STAMP, all of it to the treasury.</p>`;
      const bonusOn = BONUS_DROPS.length > 0 && !!huntInfo?.bonusLive;
      if (bonusOn) html += `<p class="note">While one follows you, it earns you a play bonus: extra $STAMP for the time you play (see the treasure hunt).</p>`;
      // Following you though you no longer hold one (sold, or another wallet logged in): still let you send it home.
      for (const id of shown) {
        const stray = !c.owned[id] ? companionOf(id) : null;
        if (stray) html += `<div class="kv"><span>${stray.icon} ${esc(stray.name)} is following you</span><button class="pbtn" data-act="companionHome" data-id="${stray.id}">Send home</button></div>`;
      }
      if (shown.length > 1) html += `<p class="note">${shown.length} companions are following you.</p>`;
      for (const tier of TIERS) {
        // Only kinds both on chain and in the catalogue: the game has no model for any other.
        const list = COMPANIONS.filter((x) => x.tier === tier && onChain.has(x.id));
        if (!list.length) continue;
        html += `<h4>${TIER_TITLE[tier] ?? tier}</h4><div class="comp-list">`;
        for (const meta of list) {
          const k = onChain.get(meta.id), left = Math.max(0, k.maxSupply - k.minted), own = c.owned[k.id] ?? 0;
          const capped = k.perWallet > 0 && (c.bought[k.id] ?? 0) >= k.perWallet; // (what you've bought, not what you hold)
          const poor = !!s.account && s.stamp != null && s.stamp < k.price;
          if (poor && left && k.open && !capped) needStamp = true;
          const on = shown.includes(k.id);
          html += `<div class="comp-card ${on ? "on" : ""} ${!left || !k.open ? "off" : ""}">
            <span class="comp-icon" aria-hidden="true">${meta.icon}</span>
            <div class="comp-info"><b>${esc(meta.name)}</b>
              <span class="comp-blurb" title="${esc(meta.blurb)}">${esc(firstSentence(meta.blurb))}</span>
              <span class="muted">${fmt(k.price, 0)} $STAMP · ${left ? `${left.toLocaleString()} left` : "Sold out"}${k.open ? "" : " · Closed"}${k.perWallet ? ` · ${k.perWallet} a wallet` : ""}</span>
              ${bonusOn ? `<span class="comp-bonus">Play bonus: up to ${bonusCap(k.id)} $STAMP a day</span>` : ""}
              ${own || on ? `<span class="comp-tags">${own ? `<span class="comp-tag">You own ${own}</span>` : ""}${on ? `<span class="comp-tag following">Following</span>` : ""}</span>` : ""}</div>
            <div class="comp-act">
              <button class="pbtn primary" data-act="companionBuy" data-id="${k.id}" ${!s.account || busy || !left || !k.open || capped || poor ? "disabled" : ""}
                ${capped ? `title="You've bought ${k.perWallet}, the most one wallet can"` : ""}>${capped ? "Wallet limit" : "Buy"}</button>
              ${own ? (on ? `<button class="pbtn" data-act="companionHome" data-id="${k.id}">Send home</button>` : `<button class="pbtn" data-act="companionFollow" data-id="${k.id}">Follow me</button>`) : ""}
            </div></div>`;
        }
        html += `</div>`;
      }
      if (!s.account) html += `<p class="note">Log in to buy a companion.</p>`;
      else if (needStamp) html += `<p class="note">You have ${fmt(s.stamp, 0)} $STAMP: not quite enough for the ones you can't buy.${chain.trade ? " Get more in the trade box above." : ""}</p>`;
      html += `<p class="note">One at a time, up to each kind's wallet limit (which counts what you've bought, so passing one on doesn't reset it). Every kind you own can follow you at once. ${bonusOn ? "They never change what your post office earns." : BONUS_DROPS.length ? "Companions never change what your post office earns. In bonus seasons, they also earn a play bonus." : "Companions never change what your post office earns."}</p>
        <p class="note">Check it yourself: ${s.explorer ? `<a href="${s.explorer}/address/${c.address}" target="_blank" rel="noopener">contract</a> · ` : ""}<a href="${SOURCE_URL}" target="_blank" rel="noopener">source code</a></p></section>`;
    }

    // ---- Courier Planets: 333 worlds of your own, bought with $STAMP (the worlds themselves come to the game next)
    if (s.planets) {
      const p = s.planets, left = Math.max(0, p.supply - p.minted);
      const room = p.perWallet ? Math.max(0, p.perWallet - p.bought) : 3; // (the limit counts what you've bought)
      planetQty = Math.max(1, Math.min(planetQty, 3, left || 1, room || 1));
      const cost = p.price * BigInt(planetQty), poor = !!s.account && s.stamp != null && s.stamp < cost;
      planetPriceShown = p.price; // (a buy pays at most this: a newer snapshot may land before the next draw)
      html += `<section class="planets"><h3>Planets <span class="muted">333 worlds of your own</span></h3>
        <div class="planet-strip">${PLANET_STRIP.map((id) => `<img src="./planets/${id}.svg" alt="">`).join("")}</div>
        <p class="note">Each planet will be a world of its own in Courier World: you'll explore it and build on it, and you can open it to other players for a ticket in $STAMP, with 80% of every ticket going to you (the treasury's share can never pass half). A daily treasure on your planet is planned too. ${fmt(p.price, 0)} $STAMP a planet, all of it to the treasury.</p>
        <p class="note"><b>The planet worlds aren't in the game yet: they come next.</b> Buy now and yours is waiting for you when they land.</p>
        <div class="meter"><span>Bought</span><div class="bar"><div style="width:${(p.minted / p.supply) * 100}%"></div></div><span>${p.minted}/${p.supply}</span></div>`;
      if (p.saleOpen && left) {
        if (room) {
          html += `<div class="mintrow"><button class="pbtn" data-act="planetQty" data-d="-1">−</button><b>${planetQty}</b><button class="pbtn" data-act="planetQty" data-d="1">+</button>
            <button class="pbtn primary" data-act="buyPlanets" ${!s.account || busy || poor ? "disabled" : ""}>Buy ${planetQty} · ${fmt(cost, 0)} $STAMP</button></div>`;
          if (!s.account) html += `<p class="note">Log in to buy a planet.</p>`;
          else if (poor) html += `<p class="note">You have ${fmt(s.stamp, 0)} $STAMP: not quite enough for ${planetQty > 1 ? `${planetQty} planets` : "a planet"}.${chain.trade ? " Get more in the trade box above." : ""}</p>`;
        } else html += `<p class="note">You've bought ${p.bought} planets, the most one wallet can.</p>`;
      } else {
        html += `<p class="note">${left ? "The planet sale isn't open right now." : "All 333 planets have been bought. Find one on OpenSea."}</p>`;
      }
      html += `<p class="note">Up to 3 at a time${p.perWallet ? ` and ${p.perWallet} a wallet (counting what you've bought)` : ""}, with one signature, never for more than the price you saw. Each planet's look comes from its number; every planet has the same rights in the game. Resales pay a 5% royalty to the game, enforced by the contract.</p>`;
      if (p.mine.length) {
        html += `<h4>Your planets <span class="muted">${p.mine.length}</span></h4><div class="couriers">`;
        for (const id of p.mine) {
          const L = planetLook(id);
          html += `<div class="ccard planet-card"><img src="./planets/${id}.svg" alt="">
            <div class="cinfo"><b>Planet #${id}</b> <span>${esc(L.typeName)}</span>
              <span class="muted">${L.rings === "None" ? "No rings" : `${L.rings} rings`} · ${L.moons === 1 ? "1 moon" : `${L.moons} moons`} · ${esc(L.sky)}</span></div>
            <div class="cact"><span class="muted">Its world arrives with the planet worlds.</span></div></div>`;
        }
        html += `</div>`;
      }
      // The owner (the treasury): open or close the sale, change the price.
      if (p.isOwner) {
        html += `<div class="admin-hunt"><h4>Planet sale <span class="muted">you own the planets contract</span></h4>
          <div class="kv"><span>Sale</span><b>${p.saleOpen ? "Open" : "Closed"}</b></div>
          <div class="kv"><span>Price</span><b>${fmt(p.price, 0)} $STAMP a planet</b></div>
          <button class="pbtn wide ${p.saleOpen ? "" : "primary"}" data-act="planetSale" ${busy ? "disabled" : ""}>${p.saleOpen ? "Close the planet sale" : "Open the planet sale"}</button>
          <label class="field">New price a planet ($STAMP)<input id="planetPriceIn" data-act="planetPriceIn" inputmode="decimal" placeholder="${fmt(p.price, 0)}"></label>
          <button class="pbtn wide" data-act="planetSetPrice" ${busy ? "disabled" : ""}>Change the price</button>
          <p class="note">Every planet's $STAMP goes straight from the buyer to the treasury. Buyers name the most they'll pay, so a price raise never charges anyone more than they saw.</p></div>`;
      }
      html += `<p class="note">Check it yourself: ${s.explorer ? `<a href="${s.explorer}/address/${p.address}" target="_blank" rel="noopener">contract</a> · ` : ""}<a href="${SOURCE_URL}" target="_blank" rel="noopener">source code</a></p></section>`;
    }

    // ---- mint
    html += `<section><h3>Mint couriers</h3>
      <div class="meter"><span>Minted</span><div class="bar"><div style="width:${(s.minted / SUPPLY) * 100}%"></div></div><span>${s.minted.toLocaleString()}/${SUPPLY.toLocaleString()}</span></div>`;
    if (s.saleOpen && s.minted < SUPPLY) {
      html += `<div class="mintrow"><button class="pbtn" data-act="qty" data-d="-1">−</button><b>${qty}</b><button class="pbtn" data-act="qty" data-d="1">+</button>
        <button class="pbtn primary" data-act="mint" ${busy ? "disabled" : ""}>Mint ${qty} · ${s.price === 0n ? "Free" : `${fmt(s.price * BigInt(qty), 3)} ETH`}</button></div>
        <p class="note">${s.price === 0n ? "Free to mint (you only pay gas), up to 10 at a time. Sales carry a 5% royalty. " : ""}Rides are revealed after the mint: 45% on foot, 25% skateboard, 17% bicycle, 9% moped, 4% paper plane.</p>`;
    } else {
      html += `<p class="note">${revealed ? "The mint is over and the couriers are revealed. Find more on the secondary market." : "The mint is closed."}</p>`;
    }
    html += `<p class="note">Check it yourself: ${s.explorer ? `<a href="${s.explorer}/address/${s.nft}" target="_blank" rel="noopener">contract</a> · ` : ""}<a href="${SOURCE_URL}" target="_blank" rel="noopener">source code</a></p>`;
    html += `</section>`;

    // ---- dev tools on the local chain
    if (s.local) {
      html += `<section class="dev"><h3>Local chain</h3><div class="mintrow">
        ${s.browserWallet && s.account ? `<button class="pbtn" data-act="fund" ${busy ? "disabled" : ""}>+10 play ETH</button>` : ""}
        ${s.browserWallet && s.account && revealed && !s.saleOpen ? `<button class="pbtn" data-act="gift" ${busy ? "disabled" : ""}>+3 couriers</button>` : ""}
        ${revealed ? "" : `<button class="pbtn" data-act="reveal" ${busy ? "disabled" : ""}>Close mint &amp; reveal</button>`}
        ${s.skins && s.skins.seed === 0n ? `<button class="pbtn" data-act="revealSkins" ${busy ? "disabled" : ""}>Reveal skins</button>` : ""}
        <button class="pbtn" data-act="warp" data-s="3600" ${busy ? "disabled" : ""}>+1 hour</button>
        <button class="pbtn" data-act="warp" data-s="86400" ${busy ? "disabled" : ""}>+1 day</button></div></section>`;
    }

    if (s.office?.open) {
      html += `<section><h3>Invite friends</h3><p class="note">You get 2.5% of everything the post offices you invite collect.</p>
        <input class="link" readonly value="${esc(`${location.origin}${location.pathname}?ref=${s.account}`)}"></section>`;
    }

    if (force || top !== lastHtml) {
      lastHtml = top;
      $("officeBody").innerHTML = top;
      const inp = $("invite");
      if (inp && document.activeElement !== inp) inp.value = invite;
      const fw = $("feeWallet");
      if (fw && document.activeElement !== fw) fw.value = newFeeWallet;
      const ni = $("nameInput");
      if (ni && document.activeElement !== ni) ni.value = nameDraft;
    }
    if (force || html !== lastMore) {
      lastMore = html;
      $("officeMore").innerHTML = html;
      const sec = $("skinSecret");
      if (sec) sec.value = skinSecret;
      const sp = $("stampPriceIn");
      if (sp && document.activeElement !== sp) sp.value = stampPriceIn;
      const pp = $("planetPriceIn");
      if (pp && document.activeElement !== pp) pp.value = planetPriceIn;
    }
    trade?.update(s);
  }

  const trade = chain.trade
    ? createTrade(chain, $("trade"), { run, isBusy: () => !!busy, onLogin: () => run("Logging in", () => chain.login()) })
    : null;

  const saveName = () =>
    run("Saving your name", async () => {
      await username.save(nameDraft);
      naming = false;
    });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset.act === "nameInput" && !busy) saveName();
  });

  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    const id = Number(b.dataset.id);
    switch (b.dataset.act) {
      case "connect": return run("Logging in", () => chain.login());
      case "nameEdit":
        [naming, nameDraft] = [true, username.mine?.name ?? ""];
        draw(true);
        return $("nameInput")?.focus();
      case "nameCancel":
        naming = false;
        return draw(true);
      case "nameSave": return saveName();
      case "nameUse": return run("Using your name here", () => username.save(username.elsewhere));
      case "nameRemove":
        if (!confirm(`Stop using ${username.mine?.name} as your name? You'll show as your wallet address again (you can take the name back today).`)) return;
        naming = false;
        return username.remove();
      case "open":
        if (invite && !isAddress(invite)) return toast("That invite address isn't valid.", "error");
        return run("Opening your post office", () => chain.openOffice(snap, invite || ZERO));
      case "claim": return run("Collecting $STAMP", () => chain.claim());
      case "collectPadFees": return run("Collecting launchpad fees", async () => {
        await chain.admin.collectPadFees();
        adminAt = 0;
      });
      case "collectFees": return run("Collecting trading fees", async () => {
        await chain.admin.collectFees();
        adminAt = 0;
      });
      case "setFeeWallet": {
        const to = newFeeWallet.trim();
        if (!isAddress(to) || to === ZERO) return toast("That isn't a valid wallet address.", "error");
        if (admin && to.toLowerCase() === admin.feeRecipient.toLowerCase()) return toast("That's already the fee wallet.", "error");
        if (!confirm(`Send all future trading fees to ${to}?\n\nAfter this, only that wallet can collect the fees or change the fee wallet again. Double-check the address.`)) return;
        return run("Changing the fee wallet", async () => {
          await chain.admin.setFeeWallet(to);
          newFeeWallet = "";
          adminAt = 0;
        });
      }
      case "huntSignIn": return run("Signing in to the hunt", async () => {
        await hunt.signIn();
        huntAt = 0;
      });
      case "huntClaim": return run("Claiming treasure", async () => {
        // Only ask the wallet for claims that pay: otherwise say why, rather than send a transaction that fails.
        const vouchers = await hunt.vouchers();
        const paying = [];
        for (const v of vouchers) if ((await chain.drops.claimable(v.drop, v.day, v.coins))[1] > 0n) paying.push(v);
        if (!paying.length) throw new Error(await nothingToClaim(vouchers));
        await chain.drops.claimAll(paying);
        huntAt = 0;
      });
      case "dropCreate": {
        const f = dropForm, token = f.token || huntInfo?.tokens?.[0]?.address;
        if (!token) return toast("No token has launched yet: a drop's coins pay a Launchpad token.", "error");
        let perCoin, amount;
        try {
          perCoin = parseEther(f.perCoin || "0");
          amount = parseEther(f.amount || formatEther(dropSuggest()));
        } catch {
          return toast("Enter the tokens per coin and how many to put in.", "error");
        }
        const spots = Number(f.spots), max = Number(f.maxPerWallet), daily = BigInt(f.dailyCoins || "0"), days = Number(f.days);
        if (perCoin <= 0n || amount <= 0n || !(spots >= 1 && spots <= 48) || !(max >= 1 && max <= spots) || daily < BigInt(max) || daily > 10_000n || !(days >= 1 && days <= 365)) {
          return toast("Check the drop: tokens per coin, coins out (1 to 48), a wallet's coins (up to that), coins a day for everyone (a wallet's to 10,000), days (1 to 365), and the tokens to put in.", "error");
        }
        return run(`Starting a drop`, async () => {
          await chain.drops.admin.createDrop({ token, perCoin, spots, maxPerWallet: max, dailyCoins: daily, startDay: huntDay(), days, amount });
          Object.assign(dropForm, { perCoin: "", amount: "" });
          huntAt = 0;
        });
      }
      case "bonusCreate": {
        const f = bonusForm, num = (v) => v.replace(/,/g, "");
        let pool, days, amount;
        try {
          pool = BigInt(num(f.pool) || "0");
          days = Number(f.days);
          amount = parseEther(num(f.amount) || formatEther(bonusSuggest()));
        } catch {
          return toast("Enter the $STAMP a day, the days and the $STAMP to put in.", "error");
        }
        if (pool < 24n || pool > 10_000n || !(Number.isInteger(days) && days >= 1 && days <= 365) || amount <= 0n) {
          return toast("Check the bonus pool: $STAMP a day for everyone (24 to 10,000), days (1 to 365), and the $STAMP to put in.", "error");
        }
        if (!confirm(`Put ${fmt(amount, 0)} $STAMP into a companion bonus pool of ${pool.toLocaleString()} $STAMP a day for ${days} day${days > 1 ? "s" : ""}, starting tomorrow?\n\nThe game pays the bonus from it only once its drop number is added to BONUS_DROPS in web/bonus-rules.js and the room and the site are deployed. Do both before tomorrow (00:00 UTC), or the game won't pay it out.`)) return;
        return run("Starting the companion bonus pool", async () => {
          bonusMade = await chain.drops.admin.createBonusPool({ dailyCoins: pool, startDay: huntDay() + 1, days, amount });
          try {
            localStorage.setItem("courier:bonusMade", String(bonusMade));
          } catch {}
          Object.assign(bonusForm, { pool: "", amount: "" });
          huntAt = 0;
        });
      }
      case "dropEnd": {
        // (A companion bonus drop pays for each day the next day: ending it after tomorrow still pays for today's play.)
        const id = Number(b.dataset.id), last = isBonusDrop(id) ? huntDay() + 1 : huntDay();
        return run(`Ending drop #${id} after ${isBonusDrop(id) ? "paying for today's play" : "today"}`, async () => {
          await chain.drops.admin.endDrop(id, last);
          huntAt = 0;
        });
      }
      case "dropWithdraw": return run(`Taking drop #${b.dataset.id}'s tokens back`, async () => {
        await chain.drops.admin.withdraw(Number(b.dataset.id), huntDay());
        huntAt = 0;
      });
      case "dropTopUp": {
        let amount;
        try { amount = parseEther(dropForm.topUp || "0"); } catch { amount = 0n; }
        if (amount <= 0n) return toast("Enter how many tokens to top up with.", "error");
        return run(`Topping up drop #${b.dataset.id}`, async () => {
          await chain.drops.admin.topUp(Number(b.dataset.id), b.dataset.token, amount);
          dropForm.topUp = "";
          huntAt = 0;
        });
      }
      case "dropPause": return run(huntInfo?.paused ? "Resuming claims" : "Pausing claims", async () => {
        await chain.drops.admin.setPaused(!huntInfo?.paused);
        huntAt = 0;
      });
      case "upgrade": return run("Upgrading the post office", () => chain.upgrade(snap));
      case "assign": return run(`Courier #${id} heading out`, () => chain.assign(id));
      case "unassign": return run(`Courier #${id} coming back`, () => chain.unassign(id));
      case "level": return run(`Training courier #${id}`, () => chain.levelUp(snap, id, Number(b.dataset.level)));
      case "play": return onPlayAs(courier(id, snap.seed));
      case "qty": qty = Math.min(10, Math.max(1, qty + Number(b.dataset.d))); return draw(true);
      case "mint": return run(`Minting ${qty} courier${qty > 1 ? "s" : ""}`, () => chain.mint(snap, qty));
      case "reveal": return run("Revealing the collection", () => chain.devReveal());
      case "skinQty": skinQty = Math.min(10, Math.max(1, skinQty + Number(b.dataset.d))); return draw(true);
      case "mintSkins": return run(`Minting ${skinQty} skin${skinQty > 1 ? "s" : ""}`, () => chain.mintSkins(snap, skinQty));
      case "mintSkinsStamp": return run(`Minting ${skinQty} skin${skinQty > 1 ? "s" : ""} with $STAMP`, () => chain.mintSkinsWithStamp(snap, skinQty));
      case "stampTopUp": return run("Topping up the $STAMP sale", () => chain.skinsStampAdmin.topUp(parseEther("0.04")));
      case "stampOpen": return run(snap.skins.stamp.open ? "Pausing the $STAMP sale" : "Opening the $STAMP sale", () => chain.skinsStampAdmin.setOpen(!snap.skins.stamp.open));
      case "stampSetPrice": {
        let wei;
        try { wei = parseEther(stampPriceIn.trim().replace(/,/g, "")); } catch { wei = 0n; }
        if (wei <= 0n) return toast("Type the new $STAMP price for one skin, like 150.", "error");
        if (!confirm(`Change the price to ${stampPriceIn.trim()} $STAMP a skin?`)) return;
        return run("Changing the $STAMP price", async () => {
          await chain.skinsStampAdmin.setPrice(wei);
          stampPriceIn = "";
        });
      }
      case "wear": {
        const m = snap.skins?.mine?.find((x) => x.id === id);
        if (m && m.design != null) onWearSkin(m);
        return draw(true);
      }
      case "unwear":
        onWearSkin(null);
        return draw(true);
      case "companionBuy": {
        const meta = companionOf(id);
        if (!meta) return;
        return run(`Buying ${meta.name}`, async () => {
          await chain.buyCompanion(snap, id, 1);
          // It comes along straight away, with any already following you.
          followNext = id;
        });
      }
      case "planetQty": {
        const p = snap.planets, room = p.perWallet ? Math.max(1, p.perWallet - p.bought) : 3;
        planetQty = Math.max(1, Math.min(3, room, Math.max(1, p.supply - p.minted), planetQty + Number(b.dataset.d)));
        return draw(true);
      }
      case "buyPlanets": {
        const n = planetQty, price = planetPriceShown;
        return run(`Buying ${n > 1 ? `${n} planets` : "a planet"}`, () => chain.buyPlanets(snap, n, price));
      }
      case "planetSale": {
        const open = !snap.planets.saleOpen;
        if (!confirm(open ? `Open the planet sale? Anyone can then buy planets at ${fmt(snap.planets.price, 0)} $STAMP each, up to 3 a wallet.` : "Close the planet sale? Nobody can buy a planet until you open it again.")) return;
        return run(open ? "Opening the planet sale" : "Closing the planet sale", () => chain.planetsAdmin.setSaleOpen(open));
      }
      case "planetSetPrice": {
        let wei;
        try { wei = parseEther(planetPriceIn.trim().replace(/,/g, "")); } catch { wei = 0n; }
        if (wei <= 0n) return toast("Type the new price for one planet in $STAMP, like 10000.", "error");
        if (!confirm(`Change the price to ${fmt(wei, 0)} $STAMP a planet?`)) return;
        return run("Changing the planet price", async () => {
          await chain.planetsAdmin.setPrice(wei);
          planetPriceIn = "";
        });
      }
      case "companionFollow":
        onCompanion(id, true);
        return draw(true);
      case "companionHome":
        onCompanion(id, false);
        return draw(true);
      case "revealSkins": return run("Revealing the skins", () => chain.devRevealSkins());
      case "skinSale": {
        const open = !snap.skins.saleOpen;
        return run(open ? "Opening the skins sale" : "Closing the skins sale", () => chain.skinsAdmin.setSaleOpen(open));
      }
      case "skinReveal": {
        let secret;
        try { secret = BigInt(skinSecret.trim()); } catch { secret = null; }
        if (secret === null || secret < 0n) return toast("Paste the reveal secret: the number deploy-skins.sh printed.", "error");
        return run("Revealing the skins", async () => {
          if (!(await chain.skinsAdmin.isSecret(secret))) throw new Error("That isn't this collection's reveal secret.");
          if (!confirm("Reveal the skins now? This ends the sale for good and fixes every skin's design.")) throw new Error("Reveal cancelled.");
          await chain.skinsAdmin.reveal(secret);
          skinSecret = "";
        });
      }
      case "launchpad": return onLaunchpad?.();
      case "fund": return run("Adding 10 play ETH", () => chain.devFund());
      case "gift": return run("Handing you 3 couriers", () => chain.devCouriers(3));
      case "warp": return run(`Skipping ${duration(Number(b.dataset.s))}`, () => chain.devWarp(Number(b.dataset.s)));
    }
  });
  panel.addEventListener("change", (e) => {
    if (e.target.dataset.act === "dropToken") {
      dropForm.token = e.target.value;
      return draw(true);
    }
    if (e.target.dataset.act === "account") {
      chain.setAccount(e.target.value);
      lastHtml = lastMore = "";
      refresh();
    }
  });
  panel.addEventListener("input", (e) => {
    if (e.target.dataset.act === "invite") invite = e.target.value.trim();
    if (e.target.dataset.act === "nameInput") nameDraft = e.target.value;
    if (e.target.dataset.act === "feeWallet") newFeeWallet = e.target.value.trim();
    const field = { dropPerCoin: "perCoin", dropSpots: "spots", dropMax: "maxPerWallet", dropDaily: "dailyCoins", dropDays: "days", dropAmount: "amount", dropTopUpAmount: "topUp" }[e.target.dataset.act];
    if (field) dropForm[field] = e.target.value.trim();
    const bonusField = { bonusPool: "pool", bonusDays: "days", bonusAmount: "amount" }[e.target.dataset.act];
    if (bonusField) bonusForm[bonusField] = e.target.value.trim();
    if (e.target.dataset.act === "skinSecret") skinSecret = e.target.value;
    if (e.target.dataset.act === "stampPriceIn") stampPriceIn = e.target.value;
    if (e.target.dataset.act === "planetPriceIn") planetPriceIn = e.target.value;
  });

  refresh();
  setInterval(refresh, 1000);
  return {
    refresh,
    show(on) {
      panel.hidden = !on;
      lastHtml = lastMore = "";
      draw(true);
    },
    /// Open the panel at the Courier Skins mint.
    showSkins() {
      panel.hidden = false;
      lastHtml = lastMore = "";
      draw(true);
      panel.querySelector("section.skins")?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    /// Open the panel at the Companions shop (when the contract is deployed).
    showCompanions() {
      panel.hidden = false;
      lastHtml = lastMore = "";
      draw(true);
      panel.querySelector("section.companions")?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    /// Open the panel at the planet sale (when the contract is deployed).
    showPlanets() {
      panel.hidden = false;
      lastHtml = lastMore = "";
      draw(true);
      panel.querySelector("section.planets")?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    get snap() { return snap; },
    /// The hunt changed (signed in, a find, a new day): redraw.
    huntChanged() {
      huntAt = 0;
      draw(true);
    },
    setBoard(b) {
      board = b;
      draw();
    },
  };
}
