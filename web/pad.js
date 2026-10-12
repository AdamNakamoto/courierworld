// The Launchpad, in Times Square: any player with a post office launches their own token (CourierPad). The
// panel lists every token (newest, or biggest), shows one with its trade box, and has the launch form. Each
// view is built once when it opens and only its numbers change after, so typing is never interrupted.
import { formatEther, parseEther } from "https://esm.sh/viem@2";
import { explain } from "./chain.js";
import { createTrade } from "./trade.js";
import { displayName } from "./names.js";
import {
  NAME_MAX, DESCRIPTION_MAX, IMAGE_SIZE, IMAGE_MAX_BYTES, launchProblem, tokenShown, imageMessage, buildMeta, parseMeta,
} from "./pad-rules.js";

const SUPPLY = 1_000_000_000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n) => (Number.isFinite(n) ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n) : "—");
const whole = (wei) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 0 });
const tokens = (wei) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(Number(formatEther(wei)));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
function ago(secs) {
  const s = Math.max(0, Date.now() / 1000 - secs);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
/// A token with no picture: its symbol's first letters on a colour from its address.
function badge(t, size) {
  const hue = parseInt(t.address.slice(2, 6), 16) % 360;
  return `<span class="pad-badge" style="width:${size}px;height:${size}px;background:hsl(${hue} 55% 52%)">${esc(String(t.symbol).slice(0, 3))}</span>`;
}
const picture = (t, size) => (t.meta.image ? `<img class="pad-img" src="${esc(t.meta.image)}" width="${size}" height="${size}" alt="" loading="lazy" crossorigin="anonymous">` : badge(t, size));

/// Square, at most IMAGE_SIZE px, as a JPEG small enough to upload.
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = c.height = IMAGE_SIZE;
  const g = c.getContext("2d");
  const s = Math.max(IMAGE_SIZE / bmp.width, IMAGE_SIZE / bmp.height), w = bmp.width * s, h = bmp.height * s;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  g.drawImage(bmp, (IMAGE_SIZE - w) / 2, (IMAGE_SIZE - h) / 2, w, h);
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= IMAGE_MAX_BYTES) return blob;
  }
  throw new Error("That picture is too detailed to upload. Try another.");
}
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const httpsOrEmpty = (u) => {
  if (!u.trim()) return true;
  try {
    return new URL(u.trim()).protocol === "https:";
  } catch {
    return false;
  }
};
/// The start tick (tokens per IMD) for a market cap of `mcapImd` IMD across the whole supply, on the tick spacing.
function tickFor(mcapImd) {
  const t = Math.floor(Math.log(SUPPLY / mcapImd) / Math.log(1.0001));
  return t - (((t % 200) + 200) % 200);
}
const mcapAt = (tick) => SUPPLY / 1.0001 ** tick; // IMD

/// `chain`: connectChain(). `snap()`: the latest chain snapshot (the post office panel keeps it fresh).
/// `imageApi`: the multiplayer server, which hosts the pictures; `imageHosts`: picture URL prefixes to trust.
/// `onTokens(list)`: the shown tokens changed (newest first), for the screens in Times Square.
export function createPad(chain, { toast, snap, onLogin, openOffice, imageApi, imageHosts, onTokens = () => {} }) {
  const P = chain.pad;
  const $ = (id) => document.getElementById(id);
  const panel = $("pad"), body = $("padBody");
  let view = "list", sort = "new", search = "", current = null; // current: the token shown
  let info = null, list = [], caps = new Map(), imdUsd = NaN, hidden = new Set();
  let infoAt = 0, capsAt = 0, usdAt = 0, hiddenAt = 0, lastShown = "";
  let busy = null, trade = null, held = null, heldAt = 0;
  let pic = null; // { blob, url (object URL for the preview), uploaded (its URL once uploaded) }
  let r = {}; // the open view's elements, by data-r
  let listHtml = "";

  const shown = () => list.filter((t) => tokenShown(t, hidden));
  const mcapUsd = (t) => (caps.has(t.address) ? (Number(caps.get(t.address)) / 1e18) * imdUsd : NaN);

  async function refresh() {
    if (!P) return;
    const now = Date.now();
    try {
      if (now - hiddenAt > 60_000) {
        hiddenAt = now;
        const j = await fetch(`pad-hidden.json?t=${Math.floor(now / 60_000)}`).then((x) => x.json()).catch(() => null);
        if (Array.isArray(j?.hidden)) hidden = new Set(j.hidden.map((a) => String(a).toLowerCase()));
      }
      if (now - infoAt > 8_000) {
        infoAt = now;
        info = await P.info();
        if (list.length < info.count) {
          list = (await P.tokens(info.count)).map((t) => ({ ...t, meta: parseMeta(t.metadata, imageHosts) }));
          capsAt = 0;
        }
      }
      if (now - usdAt > 30_000) {
        usdAt = now;
        imdUsd = await P.imdUsd().catch(() => imdUsd);
      }
      if (now - capsAt > 15_000 && list.length) {
        capsAt = now;
        const s = shown().map((t) => t.address);
        const m = await P.marketCaps(s);
        s.forEach((a, i) => caps.set(a, m[i]));
      }
      const visible = shown().slice().reverse();
      const key = visible.map((t) => `${t.address}:${caps.get(t.address) ?? ""}`).join(",") + imdUsd;
      if (key !== lastShown) {
        lastShown = key;
        onTokens(visible.map((t) => ({ ...t, mcapUsd: mcapUsd(t) })));
      }
      if (view === "token" && current && now - heldAt > 4_000) {
        heldAt = now;
        held = await P.balanceOf(current.address);
      }
    } catch (e) {
      console.warn("launchpad refresh failed", e);
    }
    update();
  }

  async function run(label, fn) {
    if (busy) return;
    busy = label;
    update();
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
      infoAt = capsAt = heldAt = 0;
      refresh();
    }
  }

  // ---------------------------------------------------------------- views

  function open(v, token = null) {
    view = v;
    current = token;
    held = null;
    heldAt = 0;
    trade = null;
    if (v === "list") {
      listHtml = "";
      body.innerHTML = `<div class="pad-top">
          <div class="seg" role="group" aria-label="Sort"><button data-sort="new">New</button><button data-sort="top">Top</button></div>
          <button class="pbtn primary" data-act="toLaunch">＋ Launch a token</button></div>
        <input class="pad-search" data-r="search" placeholder="Search by name or symbol" autocomplete="off" spellcheck="false" value="${esc(search)}">
        <div class="pad-list" data-r="list"></div>
        <p class="note">Tokens are made by players, not by Courier World. Anyone with a post office can launch one, and most go to zero: do your own research.</p>`;
    } else if (v === "token") {
      const t = token;
      const links = [["website", "Website"], ["x", "X"], ["telegram", "Telegram"]]
        .filter(([k]) => t.meta[k]).map(([k, label]) => `<a class="pbtn" href="${esc(t.meta[k])}" target="_blank" rel="noopener noreferrer nofollow">${label} ↗</a>`).join("");
      const explorer = chain.explorer ?? snap()?.explorer;
      body.innerHTML = `<button class="link-btn" data-act="back">← All tokens</button>
        <div class="pad-head">${picture(t, 72)}<div><h3>${esc(t.name)} <span class="muted">$${esc(t.symbol)}</span></h3>
          <p class="muted">by ${esc(displayName(t.creator))} · ${ago(t.createdAt)} ago</p></div></div>
        ${t.meta.description ? `<p class="pad-desc">${esc(t.meta.description)}</p>` : ""}
        <div class="kv"><span>Market cap</span><b data-r="mc">—</b></div>
        <div class="kv"><span>You hold</span><b data-r="held">—</b></div>
        <div class="pad-links">${links}
          ${explorer ? `<a class="pbtn" href="${esc(explorer)}/token/${t.address}" target="_blank" rel="noopener">Explorer ↗</a>` : ""}
          <button class="pbtn" data-act="copy" title="${t.address}">Copy address</button></div>
        <section class="trade" data-r="trade"></section>
        <p class="note">Made by a player, not by Courier World. 95% of the supply is locked in its pool for good and 5% went to the Courier World treasury for drops to post offices. Every trade pays 4% to Courier World.</p>`;
    } else {
      body.innerHTML = `<button class="link-btn" data-act="back">← All tokens</button>
        <h3>Launch your token</h3>
        <div class="pad-form">
          <label class="pad-pic" title="Picture"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-r="file" hidden>
            <img data-r="preview" alt="" hidden><span data-r="picHint">＋ Picture</span></label>
          <div class="pad-fields">
            <label class="field"><span>Name</span><input data-r="name" maxlength="${NAME_MAX}" placeholder="Letter Cat" autocomplete="off"></label>
            <label class="field"><span>Symbol</span><input data-r="symbol" maxlength="12" placeholder="LCAT" autocomplete="off" spellcheck="false"></label>
          </div>
        </div>
        <label class="field"><span>Description <span class="muted" data-r="left"></span></span><textarea data-r="desc" maxlength="${DESCRIPTION_MAX}" rows="2" placeholder="What's it about?"></textarea></label>
        <label class="field"><span>Website <span class="muted">(optional)</span></span><input data-r="website" placeholder="https://" autocomplete="off" spellcheck="false"></label>
        <div class="pad-fields">
          <label class="field"><span>X <span class="muted">(optional)</span></span><input data-r="x" placeholder="@handle" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Telegram <span class="muted">(optional)</span></span><input data-r="telegram" placeholder="group" autocomplete="off" spellcheck="false"></label>
        </div>
        <ul class="pad-facts">
          <li><b>1,000,000,000</b> tokens: 95% locked in its pool against IMD for good, so it can always be traded</li>
          <li><b>5%</b> to the Courier World treasury, for drops to post offices</li>
          <li>Every trade pays <b>4%</b> to Courier World</li>
          <li>Starts at a market cap of about <b data-r="start">—</b></li>
          <li>Launching burns <b data-r="fee">—</b> $STAMP</li>
        </ul>
        <p class="note warn" data-r="problem"></p>
        <button class="pbtn primary wide" data-r="go">Launch</button>
        <div data-r="admin"></div>`;
    }
    r = Object.fromEntries([...body.querySelectorAll("[data-r]")].map((n) => [n.dataset.r, n]));
    if (v === "token") {
      trade = createTrade(chain, r.trade, {
        run, isBusy: () => !!busy, onLogin,
        token: {
          symbol: `$${token.symbol}`, supply: SUPPLY, balance: (s) => s.tokenBalance,
          quote: (side, asset, amt) => P.quote(token.address, side, asset, amt),
          market: () => P.market(token.address),
          execute: (args) => P.trade(token.address, args),
          note: "Every trade pays 4% of its IMD side to Courier World. The pool started with tokens only, so sells fill once buyers have brought IMD in.",
        },
      });
    }
    if (v === "launch") {
      if (pic) showPic();
      adminBox();
    }
    update();
    body.scrollTop = 0;
    panel.scrollTop = 0;
  }

  /// The owner's settings, in the launch view.
  function adminBox() {
    if (!info?.isOwner || !r.admin) {
      if (r.admin) r.admin.innerHTML = "";
      return;
    }
    r.admin.innerHTML = `<div class="admin"><h3>Owner</h3>
      <p class="note">Launch fee now <b>${whole(info.stampFee)}</b> $STAMP · new launches start at <b>${usd(mcapAt(info.startTick) * imdUsd)}</b> (${Math.round(mcapAt(info.startTick)).toLocaleString()} IMD).</p>
      <div class="mintrow"><input data-r="feeIn" inputmode="decimal" placeholder="$STAMP per launch"><button class="pbtn" data-act="setFee">Set fee</button></div>
      <div class="mintrow"><input data-r="mcapIn" inputmode="decimal" placeholder="Start market cap, US$"><button class="pbtn" data-act="setMcap">Set start</button></div></div>`;
    r.feeIn = r.admin.querySelector("[data-r=feeIn]");
    r.mcapIn = r.admin.querySelector("[data-r=mcapIn]");
  }

  function showPic() {
    r.preview.src = pic.url;
    r.preview.hidden = false;
    r.picHint.hidden = true;
  }

  function formProblem(s) {
    if (!s?.account) return "Log in to launch.";
    if (!s.office?.open) return "Open a post office first: only post office owners can launch.";
    const name = r.name.value.trim(), symbol = r.symbol.value.trim();
    if (!name && !symbol) return "";
    const p = launchProblem(name, symbol);
    if (p) return p;
    if (!httpsOrEmpty(r.website.value)) return "The website needs to start with https://";
    if (info && s.stamp != null && s.stamp < info.stampFee) return `You need ${whole(info.stampFee)} $STAMP to launch (you have ${whole(s.stamp)}).`;
    return null;
  }

  function update() {
    if (panel.hidden) return;
    const s = snap();
    if (view === "list" && r.list) {
      for (const b of body.querySelectorAll("[data-sort]")) b.classList.toggle("on", b.dataset.sort === sort);
      const q = search.trim().toLowerCase();
      let rows = shown().filter((t) => !q || t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q));
      rows = sort === "new" ? rows.slice().reverse() : rows.slice().sort((a, b) => (Number(caps.get(b.address) ?? 0n) - Number(caps.get(a.address) ?? 0n)));
      const html = !P ? `<p class="note">The launchpad opens soon.</p>`
        : !info ? `<p class="note">Loading…</p>`
        : !rows.length ? `<p class="note">${q ? "No token matches that." : "No tokens yet. Be the first to launch one!"}</p>`
        : rows.slice(0, 100).map((t) => `<button class="pad-row" data-token="${t.address}">${picture(t, 40)}
            <span class="pad-name"><b>${esc(t.name)}</b><span class="muted">$${esc(t.symbol)} · ${ago(t.createdAt)} · ${esc(displayName(t.creator))}</span></span>
            <span class="pad-mc">${usd(mcapUsd(t))}</span></button>`).join("");
      if (listHtml !== html || !r.list.firstChild) {
        listHtml = html;
        r.list.innerHTML = html;
      }
    }
    if (view === "token" && current) {
      r.mc.textContent = usd(mcapUsd(current));
      r.held.textContent = held == null ? "—" : `${tokens(held)} $${current.symbol}`;
      if (s) trade?.update({ ...s, tokenBalance: held });
    }
    if (view === "launch" && r.go) {
      r.fee.textContent = info ? whole(info.stampFee) : "—";
      r.start.textContent = info ? usd(mcapAt(info.startTick) * imdUsd) : "—";
      r.left.textContent = `${r.desc.value.length}/${DESCRIPTION_MAX}`;
      const p = formProblem(s);
      r.problem.textContent = p ?? "";
      const symbol = r.symbol.value.trim();
      r.go.textContent = !s?.account ? "Log in to launch" : !s.office?.open ? "Open a post office" : symbol ? `Launch $${symbol}` : "Launch";
      r.go.disabled = !!busy || (s?.account && s.office?.open ? p !== null : false);
    }
  }

  // ---------------------------------------------------------------- actions

  async function upload(account) {
    if (pic.uploaded) return pic.uploaded;
    const bytes = new Uint8Array(await pic.blob.arrayBuffer());
    const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
    const time = Math.floor(Date.now() / 1000);
    const signature = await chain.signMessage(imageMessage(account, hash, time));
    const res = await fetch(`${imageApi}/pad/image`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: account, time, type: "image/jpeg", data: base64(bytes), signature }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.url) throw new Error(j.error ?? "The picture didn't upload. Try again.");
    pic.uploaded = j.url;
    return j.url;
  }

  async function launch() {
    const s = snap();
    if (!s?.account) return onLogin();
    if (!s.office?.open) return openOffice();
    if (!info) return toast("Still loading the launchpad. Try again in a moment.");
    const name = r.name.value.trim(), symbol = r.symbol.value.trim();
    const fields = { description: r.desc.value, website: r.website.value, x: r.x.value, telegram: r.telegram.value };
    const shown = { fee: info.stampFee, startTick: info.startTick }; // what the form showed: the launch can't cost more or start elsewhere
    await run(`Launching $${symbol}`, async () => {
      const image = pic ? await upload(s.account) : null;
      const metadata = buildMeta({ image, ...fields });
      if (new TextEncoder().encode(metadata).length > 2048) throw new Error("The description and links are too long together.");
      const address = await P.launch({ name, symbol, metadata, ...shown });
      const t = { address, name, symbol, metadata, creator: s.account, createdAt: Math.floor(Date.now() / 1000), meta: parseMeta(metadata, imageHosts) };
      if (!list.some((x) => x.address.toLowerCase() === address.toLowerCase())) list.push(t);
      pic = null;
      toast(`🚀 $${symbol} is live! 5% went to the treasury for drops; buy the first tokens below.`);
      open("token", t);
    });
  }

  body.addEventListener("click", async (e) => {
    const b = e.target.closest("button, [data-token]");
    if (!b || b.disabled) return;
    if (b.dataset.sort) {
      sort = b.dataset.sort;
      return update();
    }
    if (b.dataset.token) {
      const t = list.find((x) => x.address === b.dataset.token);
      if (t) open("token", t);
      return;
    }
    switch (b.dataset.act) {
      case "toLaunch": return open("launch");
      case "back": return open("list");
      case "copy":
        try {
          await navigator.clipboard.writeText(current.address);
          toast("Address copied");
        } catch {
          toast(current.address);
        }
        return;
      case "setFee": {
        const v = r.feeIn?.value.trim().replace(",", ".");
        if (!/^\d+(\.\d+)?$/.test(v ?? "")) return toast("Enter the fee in $STAMP, like 500", "error");
        return run(`Setting the launch fee to ${v} $STAMP`, () => P.admin.setStampFee(parseEther(v)));
      }
      case "setMcap": {
        const v = Number(r.mcapIn?.value.trim().replace(/[$,]/g, ""));
        if (!(v > 0) || !Number.isFinite(imdUsd)) return toast("Enter the starting market cap in US dollars, like 5000", "error");
        const tick = tickFor(v / imdUsd);
        if (tick < -300_000 || tick > 400_000) return toast("That's outside what the launchpad allows.", "error");
        return run(`Starting new launches at ${usd(v)}`, () => P.admin.setStartTick(tick));
      }
    }
    if (b === r.go) return launch();
  });
  body.addEventListener("input", (e) => {
    if (e.target === r.search) {
      search = r.search.value;
      return update();
    }
    if (e.target === r.symbol) {
      const pos = r.symbol.selectionStart;
      r.symbol.value = r.symbol.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      r.symbol.setSelectionRange(pos, pos);
    }
    update();
  });
  body.addEventListener("change", async (e) => {
    if (e.target !== r.file || !r.file.files[0]) return;
    try {
      const blob = await shrink(r.file.files[0]);
      if (pic?.url) URL.revokeObjectURL(pic.url);
      pic = { blob, url: URL.createObjectURL(blob), uploaded: null };
      showPic();
    } catch (err) {
      toast(err.message ?? "That picture didn't work. Try another.", "error");
    }
    r.file.value = "";
  });
  body.addEventListener("error", (e) => {
    // A picture that doesn't load (taken down): show the token's badge instead.
    if (e.target.classList?.contains("pad-img")) e.target.replaceWith(Object.assign(document.createElement("span"), { className: "pad-badge", textContent: "?" }));
  }, true);
  $("padClose").addEventListener("click", () => show(false));

  function show(on) {
    panel.hidden = !on;
    if (on) {
      if (!r.list && view === "list") open("list");
      else update();
      infoAt = 0;
      refresh();
    }
  }

  refresh();
  setInterval(() => {
    if (!panel.hidden) refresh();
  }, 2000);
  // The screens in Times Square keep up even with the panel closed.
  setInterval(() => {
    if (panel.hidden) {
      infoAt = 0;
      refresh();
    }
  }, 60_000);

  return {
    show,
    get open() { return !panel.hidden; },
    /// Open the panel at a token (from a link or a screen), or at the launch form.
    showToken(address) {
      const t = list.find((x) => x.address.toLowerCase() === String(address).toLowerCase());
      show(true);
      if (t) open("token", t);
    },
    showLaunch() {
      show(true);
      open("launch");
    },
  };
}
