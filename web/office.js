// The Post Office panel: open an office, mint couriers, put them on duty, train
// them, collect $STAMP. Re-rendered every second from the chain snapshot.
import { formatEther, isAddress, parseEther } from "https://esm.sh/viem@2";
import { huntDay, HUNT_STAMPS } from "./hunt-pick.js";
import { courier, SUPPLY } from "./traits.js";
import { SKINS, SKIN_SUPPLY } from "./skins.js";
import { renderStamp } from "./portrait.js";
import { explain } from "./chain.js";
import { createTrade } from "./trade.js";
import { displayName, namesOn } from "./names.js";

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

/// `hunt`: the golden stamp hunt's side in the game ({ state(), signIn(), voucher() }), when it's running.
/// `onWearSkin(skin)` dresses you in a revealed skin ({ id, design }), or back in your courier (null);
/// `wearing()` is the id of the skin you have on, if any. `xname`: names from X (xname.js), when the game has them.
export function createOffice(chain, { onPlayAs, onWearSkin = () => {}, wearing = () => null, onSnapshot, toast, hunt = null, xname = null }) {
  const $ = (id) => document.getElementById(id);
  const panel = $("office");
  let snap = null, busy = null, qty = 1, skinQty = 1, refreshing = false;
  let skinSecret = ""; // the reveal secret while the owner types it; never stored
  let admin = null, adminAt = 0, adminFor = null, newFeeWallet = ""; // the admin view, for the wallet the contracts pay
  let board = null; // every office, strongest first (from main.js, every 20 s)
  let huntInfo = null, huntAt = 0, huntAmount = "", huntReward = ""; // the StampHunt contract, read every few seconds
  let invite = new URLSearchParams(location.search).get("ref") ?? "";
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
      // The admin view, for the wallet the contracts pay; refreshed every few seconds while the panel is open.
      if (chain.admin && snap.account && !panel.hidden) {
        if (adminFor !== snap.account) [admin, adminFor, adminAt] = [null, snap.account, 0];
        if (Date.now() - adminAt > 4000) {
          adminAt = Date.now();
          admin = (await chain.admin.isAdmin(snap.account)) ? await chain.admin.stats() : null;
        }
      } else if (!snap.account) admin = adminFor = null;
      if (chain.hunt && hunt && !panel.hidden && Date.now() - huntAt > 5000) {
        huntAt = Date.now();
        huntInfo = await chain.hunt.info(huntDay());
      }
      draw();
    } catch (e) {
      console.error(e);
    } finally {
      refreshing = false;
    }
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
    // Names from X: your @handle instead of your wallet address, on the planet.
    if (s.account && xname && namesOn()) {
      const mine = xname.mine;
      html += mine
        ? `<span class="xname" title="Your name on the planet">@${esc(mine.handle)}</span><button class="pbtn" data-act="xUnlink" ${busy ? "disabled" : ""}>Unlink X</button>`
        : `<button class="pbtn" data-act="xClaim" ${busy ? "disabled" : ""}>𝕏 Claim your name</button>`;
    }
    if (s.account) {
      html += `<span class="bal"><b>${fmt(s.eth, 3)}</b> ETH</span>`;
      if (s.game) {
        if (s.imd != null) html += `<span class="bal"><b>${fmt(s.imd)}</b> IMD</span>`;
        html += `<span class="bal"><b>${fmt(s.stamp)}</b> $STAMP</span>`;
      }
    }
    html += `</div>`;
    const claim = xname?.pending;
    if (claim) {
      const h = esc(claim.handle);
      html += `<section class="xclaim"><h3>Claim @${h}</h3>
        <p>Sign with your wallet to show up as <b>@${h}</b> on the planet: on your name tag, in chat, on your post office and on the
        leaderboard, instead of your wallet address. Anyone will be able to see which wallet @${h} belongs to.</p>
        ${s.account
          ? `<button class="pbtn primary wide" data-act="xSign" ${busy ? "disabled" : ""}>Sign & claim @${h}</button>
             <p class="note">Signing is free and sends no transaction. You'll show as @${h} with ${short(s.account)}.</p>`
          : `<p class="note">Log in with the wallet you play with first.</p>`}
        <button class="pbtn wide" data-act="xCancel" ${busy ? "disabled" : ""}>Not now</button></section>`;
    }

    // ---- admin: only for the wallet the contracts pay
    if (admin) {
      const a = admin, m = a.market, usd = (n) => (m ? ` (≈ $${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })})` : "");
      const fees = Number(formatEther(a.pendingFees)), price = m ? m.stampUsd : 0;
      const days = Math.floor(a.halvingIn / 86400), hours = Math.floor((a.halvingIn % 86400) / 3600);
      const link = (addr) => (s.explorer ? `<a href="${s.explorer}/address/${addr}" target="_blank" rel="noopener">${short(addr)}</a>` : short(addr));
      html += `<section class="admin"><h3>Admin <span class="muted">your wallet runs the treasury</span></h3>
        <div class="pending"><b>${fmt(a.pendingFees, 4)}</b><span>IMD in trading fees${usd(m ? fees * m.imdUsd : 0)}</span></div>
        <button class="pbtn primary wide" data-act="collectFees" ${a.pendingFees === 0n || busy ? "disabled" : ""}>Collect fees to ${short(a.feeRecipient)}</button>
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

    // ---- the golden stamp hunt
    if (s.game && chain.hunt && hunt && huntInfo) {
      // The room's view of you counts only if it's for the wallet logged in now.
      const h = huntInfo, st0 = hunt.state(), st = st0?.wallet && s.account && st0.wallet.toLowerCase() === s.account.toLowerCase() ? st0 : null;
      const found = st?.found.length ?? 0, toClaim = Math.max(0, Math.min(found, h.maxPerDay) - h.claimed);
      const afford = h.reward ? Number(h.pool / h.reward) : 0, pay = BigInt(Math.min(toClaim, afford)) * h.reward;
      html += `<section class="hunt"><h3>Golden stamp hunt <span class="muted">${fmt(h.reward, 0)} $STAMP each</span></h3>
        <div class="kv"><span>Found today</span><b>${st ? `${found}/${HUNT_STAMPS}` : "–"}</b></div>
        <div class="kv"><span>Claimed today</span><b>${h.claimed}</b></div>
        <div class="kv"><span>Left in the pool</span><b>${fmt(h.pool, 0)} $STAMP</b></div>`;
      if (!s.account) html += `<p class="note">Log in, open a post office and sign in to earn $STAMP for the golden stamps you find.</p>`;
      else if (!s.office?.open) html += `<p class="note">Open a post office to redeem golden stamps for $STAMP.</p>`;
      else if (!st?.wallet) html += `<button class="pbtn primary wide" data-act="huntSignIn" ${busy ? "disabled" : ""}>Sign in to hunt</button>
        <p class="note">One signature proves this wallet is yours. It costs nothing and can't move anything. Stamps you find after signing in count toward $STAMP.</p>`;
      else if (toClaim) html += `<button class="pbtn primary wide" data-act="huntClaim" ${!pay || busy ? "disabled" : ""}>${pay ? `Claim ${fmt(pay, 0)} $STAMP` : "The pool is empty: check back soon"}</button>`;
      else html += `<p class="note">${found >= HUNT_STAMPS ? "You found every stamp today!" : "Find more golden stamps: they're hidden all over the planet."} New spots every day at 00:00 UTC.</p>`;
      if (h.isOwner) {
        html += `<div class="admin-hunt"><h4>Pool <span class="muted">you run the hunt</span></h4>
          <label class="field">$STAMP to add or take out<input data-act="huntAmount" value="${huntAmount}" inputmode="decimal" placeholder="e.g. 5000"></label>
          <div class="row2"><button class="pbtn" data-act="huntDeposit" ${busy ? "disabled" : ""}>Deposit</button><button class="pbtn" data-act="huntWithdraw" ${busy ? "disabled" : ""}>Withdraw</button></div>
          <label class="field">Reward per stamp<input data-act="huntReward" value="${huntReward}" inputmode="decimal" placeholder="${fmt(h.reward, 0)}"></label>
          <button class="pbtn wide" data-act="huntSetReward" ${busy ? "disabled" : ""}>Change the reward</button>
          <p class="note">Paid out today: ${fmt(h.paidToday, 0)} $STAMP. Each wallet is paid for up to ${h.maxPerDay} stamps a day.</p></div>`;
      }
      html += `</section>`;
    }

    // ---- the leaderboard
    if (s.game) {
      html += `<section><h3>Leaderboard <span class="muted">${board ? `${board.count.toLocaleString()} post office${board.count === 1 ? "" : "s"} open` : "loading…"}</span></h3>`;
      if (board?.count) html += `<p class="earned-all"><b>${fmt(board.totalEarned, 0)}</b> $STAMP earned by all players so far</p>`;
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
          <button class="pbtn primary" data-act="mintSkins" ${!s.account || busy ? "disabled" : ""}>Mint ${skinQty} · ${fmt(k.price * BigInt(skinQty), 3)} ETH</button></div>
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
    }
    if (force || html !== lastMore) {
      lastMore = html;
      $("officeMore").innerHTML = html;
      const sec = $("skinSecret");
      if (sec) sec.value = skinSecret;
    }
    trade?.update(s);
  }

  const trade = chain.trade
    ? createTrade(chain, $("trade"), { run, isBusy: () => !!busy, onLogin: () => run("Logging in", () => chain.login()) })
    : null;

  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    const id = Number(b.dataset.id);
    switch (b.dataset.act) {
      case "connect": return run("Logging in", () => chain.login());
      case "xClaim": return xname.start();
      case "xSign": return run("Claiming your name", () => xname.sign());
      case "xCancel": return xname.cancel();
      case "xUnlink":
        if (!confirm(`Stop showing @${xname.mine?.handle} as your name? You'll show as your wallet address again.`)) return;
        return xname.unlink();
      case "open":
        if (invite && !isAddress(invite)) return toast("That invite address isn't valid.", "error");
        return run("Opening your post office", () => chain.openOffice(snap, invite || ZERO));
      case "claim": return run("Collecting $STAMP", () => chain.claim());
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
      case "huntClaim": return run("Claiming golden stamps", async () => {
        await chain.hunt.claim(await hunt.voucher());
        huntAt = 0;
      });
      case "huntDeposit":
      case "huntWithdraw": {
        let amount;
        try { amount = parseEther(huntAmount || "0"); } catch { amount = 0n; }
        if (amount <= 0n) return toast("Enter how much $STAMP.", "error");
        const deposit = b.dataset.act === "huntDeposit";
        return run(deposit ? "Adding $STAMP to the pool" : "Taking $STAMP out of the pool", async () => {
          await (deposit ? chain.hunt.deposit(amount) : chain.hunt.withdraw(amount));
          huntAmount = "";
          huntAt = 0;
        });
      }
      case "huntSetReward": {
        let wei;
        try { wei = parseEther(huntReward || "0"); } catch { wei = 0n; }
        if (wei <= 0n) return toast("Enter the new reward per stamp.", "error");
        return run("Changing the reward", async () => {
          await chain.hunt.setReward(wei);
          huntReward = "";
          huntAt = 0;
        });
      }
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
      case "wear": {
        const m = snap.skins?.mine?.find((x) => x.id === id);
        if (m && m.design != null) onWearSkin(m);
        return draw(true);
      }
      case "unwear":
        onWearSkin(null);
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
      case "fund": return run("Adding 10 play ETH", () => chain.devFund());
      case "gift": return run("Handing you 3 couriers", () => chain.devCouriers(3));
      case "warp": return run(`Skipping ${duration(Number(b.dataset.s))}`, () => chain.devWarp(Number(b.dataset.s)));
    }
  });
  panel.addEventListener("change", (e) => {
    if (e.target.dataset.act === "account") {
      chain.setAccount(e.target.value);
      lastHtml = lastMore = "";
      refresh();
    }
  });
  panel.addEventListener("input", (e) => {
    if (e.target.dataset.act === "invite") invite = e.target.value.trim();
    if (e.target.dataset.act === "feeWallet") newFeeWallet = e.target.value.trim();
    if (e.target.dataset.act === "huntAmount") huntAmount = e.target.value.trim();
    if (e.target.dataset.act === "huntReward") huntReward = e.target.value.trim();
    if (e.target.dataset.act === "skinSecret") skinSecret = e.target.value;
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
