// The Post Office panel: open an office, mint couriers, put them on duty, train
// them, collect $STAMP. Re-rendered every second from the chain snapshot.
import { formatEther, isAddress } from "https://esm.sh/viem@2";
import { courier, SUPPLY } from "./traits.js";
import { renderStamp } from "./portrait.js";
import { explain } from "./chain.js";
import { createTrade } from "./trade.js";

const TIER_NAMES = ["Kiosk", "Branch", "Depot", "Hub", "HQ"];
const RARITY_INK = { Common: "#5f6b6e", Uncommon: "#5e9f57", Rare: "#3f6fbf", Epic: "#8d5a99", Legendary: "#c9962a" };
const ZERO = "0x0000000000000000000000000000000000000000";
const BLOCKS_PER_DAY = 86_400_000n / 1_100n;

const fmt = (wei, d = 2) => Number(formatEther(wei)).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const powerAt = (base, level) => Math.floor((base * (100 + 12 * (level - 1))) / 100);

function duration(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${secs % 60}s`;
}

export function createOffice(chain, { onPlayAs, onSnapshot, toast }) {
  const $ = (id) => document.getElementById(id);
  const panel = $("office");
  let snap = null, busy = null, qty = 1, refreshing = false;
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
    if (s.account) {
      html += `<span class="bal"><b>${fmt(s.eth, 3)}</b> ETH</span>`;
      if (s.game) {
        if (s.imd != null) html += `<span class="bal"><b>${fmt(s.imd)}</b> IMD</span>`;
        html += `<span class="bal"><b>${fmt(s.stamp)}</b> $STAMP</span>`;
      }
    }
    html += `</div>`;

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

    // ---- mint
    html += `<section><h3>Mint couriers</h3>
      <div class="meter"><span>Minted</span><div class="bar"><div style="width:${(s.minted / SUPPLY) * 100}%"></div></div><span>${s.minted.toLocaleString()}/${SUPPLY.toLocaleString()}</span></div>`;
    if (s.saleOpen && s.minted < SUPPLY) {
      html += `<div class="mintrow"><button class="pbtn" data-act="qty" data-d="-1">−</button><b>${qty}</b><button class="pbtn" data-act="qty" data-d="1">+</button>
        <button class="pbtn primary" data-act="mint" ${busy ? "disabled" : ""}>Mint ${qty} · ${fmt(s.price * BigInt(qty), 3)} ETH</button></div>
        <p class="note">Rides are revealed after the mint: 45% on foot, 25% skateboard, 17% bicycle, 9% moped, 4% paper plane.</p>`;
    } else {
      html += `<p class="note">${revealed ? "The mint is over and the couriers are revealed. Find more on the secondary market." : "The mint is closed."}</p>`;
    }
    html += `</section>`;

    // ---- dev tools on the local chain
    if (s.local) {
      html += `<section class="dev"><h3>Local chain</h3><div class="mintrow">
        ${s.browserWallet && s.account ? `<button class="pbtn" data-act="fund" ${busy ? "disabled" : ""}>+10 play ETH</button>` : ""}
        ${s.browserWallet && s.account && revealed && !s.saleOpen ? `<button class="pbtn" data-act="gift" ${busy ? "disabled" : ""}>+3 couriers</button>` : ""}
        ${revealed ? "" : `<button class="pbtn" data-act="reveal" ${busy ? "disabled" : ""}>Close mint &amp; reveal</button>`}
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
    }
    if (force || html !== lastMore) {
      lastMore = html;
      $("officeMore").innerHTML = html;
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
      case "open":
        if (invite && !isAddress(invite)) return toast("That invite address isn't valid.", "error");
        return run("Opening your post office", () => chain.openOffice(snap, invite || ZERO));
      case "claim": return run("Collecting $STAMP", () => chain.claim());
      case "upgrade": return run("Upgrading the post office", () => chain.upgrade(snap));
      case "assign": return run(`Courier #${id} heading out`, () => chain.assign(id));
      case "unassign": return run(`Courier #${id} coming back`, () => chain.unassign(id));
      case "level": return run(`Training courier #${id}`, () => chain.levelUp(snap, id, Number(b.dataset.level)));
      case "play": return onPlayAs(courier(id, snap.seed));
      case "qty": qty = Math.min(10, Math.max(1, qty + Number(b.dataset.d))); return draw(true);
      case "mint": return run(`Minting ${qty} courier${qty > 1 ? "s" : ""}`, () => chain.mint(snap, qty));
      case "reveal": return run("Revealing the collection", () => chain.devReveal());
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
    get snap() { return snap; },
  };
}
