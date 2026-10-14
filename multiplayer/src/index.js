// Courier World multiplayer. One Durable Object holds the planet's room: each player says who they
// are (their courier's look and ride, and a name), then sends where they are a few times a second
// while moving. The room passes that on to the players near them, and now and then to everyone
// else, so the far side of the planet still knows who's about. Waves and preset phrases go to the
// players nearby, and chat lines (text only: no links) to everyone. It also runs the treasure hunt:
// golden stamps and the treasury's token drops (coins scattered round the planet, web/drop-pick.js). A
// hunter signs in with their wallet, the room checks each find against where they've actually been, and
// signs vouchers the TokenDrops contract pays for. Positions and emotes are just for show; only the vouchers touch the chain. A player
// wearing a Courier Skin is shown in it only once the room has read on-chain that their wallet owns it.
// Players can pick a name (web/name-rules.js): their wallet signs for it, and the room shows it instead of
// their wallet address from then on. A Courier Companion following a player is shown only once the room has read
// on chain that their wallet owns one of that kind, and earns them the companion bonus (web/bonus-rules.js) for the
// minutes they spend out delivering with it.
import { DurableObject } from "cloudflare:workers";
import { verifyMessage, isAddress, getAddress, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import SPOTS from "../../web/hunt-spots.json";
import { HUNT_STAMPS, huntDay, authMessage } from "../../web/hunt-pick.js";
import { layDrops } from "../../web/drop-pick.js";
import { TRIPS, TREASURY, WORLDS } from "../../web/trips.js";
import { cleanChat, CHAT_EVERY_MS } from "../../web/chat-rules.js";
import { cleanName, nameMessage, nameShown, NAME_EVERY_MS } from "../../web/name-rules.js";
import { imageMessage, IMAGE_MAX_BYTES, IMAGE_TYPES } from "../../web/pad-rules.js";
import { COMPANION_IDS } from "../../web/companion-kinds.js";
import { BONUS_DROPS, BONUS_MINUTES, BONUS_MOVE_M, BONUS_WARMUP_MS, bonusCoins, bonusShare, bonusPayDay } from "../../web/bonus-rules.js";

const R = 34; // the planet's radius, in metres (matches web/world.js)
const NEAR = Math.cos(40 / R); // players within 40 m (a dot product of their directions) get every update
const FAR_EVERY = 8; // everyone else gets one in eight
const MAX_PLAYERS = 200;
const MAX_MSG = 2048;
const PHRASES = 16; // emotes the game can show (web/net.js EMOTES); -1 is a wave

// The game's homes: courierworld.fun, its backup on IMD's hosting, Vercel previews, and local development.
const ORIGINS = [/^https:\/\/(www\.)?courierworld\.fun$/, /^https:\/\/courierworld\.sites\.imd\.fun$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const ENUMS = {
  hairStyle: ["pony", "bun", "bob", "twin", "long"],
  headwear: ["none", "cap", "bucket", "beanie", "headphones", "goggles", "hardhat"],
  bottomsStyle: ["shorts", "skirt", "pants"],
  bag: ["satchel", "backpack", "tote", "sack", "golden", "none"],
};
const COLOURS = ["skin", "hair", "shirt", "accent", "bottoms", "socks", "shoes"];
const RIDES = ["foot", "skate", "bike", "moped", "plane", "rover"]; // (the rover only on Mars)
const SKIN_SUPPLY = 999;
const SKINS_ABI = parseAbi(["function ownerOf(uint256) view returns (address)", "function designOf(uint256) view returns (uint256)"]);
const DROPS_ABI = parseAbi([
  "function activeDrops(uint32 day) view returns (uint256[])",
  "function drop(uint256 id) view returns ((address token, uint16 spots, uint16 maxPerWallet, uint32 startDay, uint32 endDay, uint256 perCoin, uint256 dailyCoins, uint256 left))",
  "function stamp() view returns (address)",
]);
const DROPS_CHECK_MS = 60_000; // how long the running drops are trusted before they're read again
const SKIN_CHECK_MS = 60_000; // how long a skin's owner is trusted before it's read again
// Courier Companions (an ERC-1155: each kind is a token id), at COMPANIONS_ADDRESS once it's deployed.
const COMPANIONS_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
]);
const COMPANION_CHECK_MS = 3 * 60_000; // how long a wallet's companions are trusted before they're read again
const COMPANION_MISS_MS = 15_000; // ...and how long "not theirs" is, so a companion just bought shows soon
const COMPANION_RECHECK_MS = 16_000; // one more look this long after a miss (a buy the RPC hadn't seen; a hiccup)
// The companion bonus (web/bonus-rules.js). A wallet's day is kept in memory and written every few counted minutes;
// the companions that earned are all checked at once, at random times, so nobody can time handing one around.
const BONUS_SAVE_EVERY = 5; // counted minutes between writes of a wallet's day (and when its last connection closes)
const BONUS_SAMPLE_MS = 10 * 60_000; // the mean time between ownership checks (each 2 to 25 minutes after the last)
const BONUS_STATUS_EVERY = 5; // counted minutes between updates to the player
const CHAT_KEEP = 30; // chat lines kept for players who join later
const CHAT_RECENT_MS = 60 * 60_000; // ...if they're less than an hour old
const CHAT_ROOM_MAX = 20; // lines from everyone together every five seconds
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;


const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// The hunt: how close (in metres, and in height) a hunter's last reported position must be to a stamp
// for the find to count, the fastest anyone moves (paper plane, running: ~13 m/s; this allows lag),
// and how long a voucher lasts.
const REACH = 3.2, REACH_UP = 1.6, TOP_SPEED = 22, VOUCHER_SECS = 3600;
// The speed check is a travel budget in the room's time: it grows at TOP_SPEED (up to BUDGET_M saved up, 15 s of it)
// and each update spends the distance moved. So nobody averages more than TOP_SPEED, however their updates are bunched:
// updates the network held back for up to ~20 s and delivered together are paid for by what the wait saved, while a
// stream of hops faster than TOP_SPEED, or one jump further than two seconds at it, strikes. After a strike, finds and
// the bonus wait CLEAN_MS (and overspending within that time doesn't strike again).
const BUDGET_M = TOP_SPEED * 15, CLEAN_MS = 3000;
const spotDir = SPOTS.map((p) => {
  const l = Math.hypot(p.x, p.y, p.z);
  return [p.x / l, p.y / l, p.z / l];
});
const arcBetween = (a, b, r = R) => r * Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // ERC-20 Transfer(from, to, value)
const TICKET_AGE = 3 * 3600; // seconds: how old a trip ticket's transaction can be
const HUNT_TOKEN_MS = 12 * 3600_000; // how long a browser can pick the hunt up again without signing
/// Which world a player is on: "moon", "mars" (trips: everyone there is near), or the planet.
const worldOf = (a) => (TRIPS[a.world] ? a.world : "planet");
/// A wallet's bonus minutes for a day ({ kind: minutes }), without the companions that left it that day.
const keptMinutes = (v) => Object.fromEntries(Object.entries(v?.min ?? {}).filter(([k]) => !(v.lost ?? []).includes(Number(k))));

const colour = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff) || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v));
const send = (ws, m) => {
  try {
    ws.send(typeof m === "string" ? m : JSON.stringify(m));
  } catch {}
};

/// A player's hello with anything unexpected dropped: a look built only from known keys and values,
/// a ride, their wallet address if they're logged in (shown on their name tag; not checked), and the
/// Courier Skin they'd like to wear and the Courier Companions they'd like to have follow them (all
/// checked in `hi` before anyone sees them; a game from before several could follow sends just one).
function cleanHello(h) {
  if (!h || typeof h !== "object") return null;
  const src = h.look && typeof h.look === "object" ? h.look : {};
  const look = {};
  for (const k of COLOURS) if (colour(src[k])) look[k] = src[k];
  for (const [k, ok] of Object.entries(ENUMS)) if (ok.includes(src[k])) look[k] = src[k];
  if (typeof src.height === "number" && src.height >= 0.85 && src.height <= 1.1) look.height = src.height;
  const out = { look, ride: RIDES.includes(h.ride) ? h.ride : "foot" };
  if (typeof h.addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(h.addr)) out.addr = h.addr;
  if (out.addr && Number.isInteger(h.skinId) && h.skinId >= 1 && h.skinId <= SKIN_SUPPLY) out.skinId = h.skinId;
  if (out.addr) {
    const kinds = [...new Set((Array.isArray(h.companions) ? h.companions : [h.companion]).filter((k) => COMPANION_IDS.includes(k)))];
    if (kinds.length) out.companionIds = kinds.sort((x, y) => x - y);
  }
  return out;
}

/// Where a player is: ["s", x, y, z (their direction from the planet's centre), fx, fy, fz (which
/// way they face), height, jump, speed, swim, and from newer games vx, vy, vz, turn (how fast that
/// direction is changing, per second, and how fast it's turning, in radians a second, for the others to
/// predict them by between updates)], checked and with the direction made unit length. Older games'
/// updates get a velocity and turn of zero.
function cleanState(m, r = R) {
  if (m.length !== 11 && m.length !== 15) return null;
  const s = m.slice(1).map(Number);
  if (!s.every(Number.isFinite)) return null;
  const [x, y, z, fx, fy, fz, h, air, spd, swim, vx = 0, vy = 0, vz = 0, turn = 0] = s;
  const len = Math.hypot(x, y, z);
  if (len < 0.9 || len > 1.1 || Math.hypot(fx, fy, fz) > 1.1 || Math.abs(h) > 12 || air < 0 || air > 6 || spd < 0 || spd > 3 || swim < 0 || swim > 1) return null;
  const moving = Math.hypot(vx, vy, vz) * r <= TOP_SPEED && Math.abs(turn) <= 12; // (r: the radius of their world)
  return [x / len, y / len, z / len, fx, fy, fz, h, air, spd, swim, ...(moving ? [vx, vy, vz, turn] : [0, 0, 0, 0])];
}

export class Planet extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // The game's keep-alive is answered without waking the room, so a quiet planet can sleep.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.seen = new Map(); // socket -> its attachment, read once after each wake
    this.skins = new Map(); // skin id -> { at, owner, design }
    this.companions = new Map(); // "<wallet lower case>:<kind>" -> { at, owned }
  }

  info(ws) {
    if (!this.seen.has(ws)) this.seen.set(ws, ws.deserializeAttachment());
    return this.seen.get(ws);
  }
  /// Everyone who has said hello, but `but`.
  others(but) {
    return this.ctx.getWebSockets().filter((ws) => ws !== but && this.info(ws)?.hello);
  }
  /// To everyone else (`near`: only those around that spot, on the same world as `from`).
  broadcast(from, m, near = null) {
    const out = JSON.stringify(m), world = from ? worldOf(this.info(from)) : null;
    for (const ws of this.others(from)) {
      const o = this.info(ws), s = o.s;
      if (near && world !== worldOf(o)) continue;
      if (!near || !s || world !== "planet" || s[0] * near[0] + s[1] * near[1] + s[2] * near[2] > NEAR) send(ws, out);
    }
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/count") return Response.json({ online: this.others(null).length });
    if (url.pathname === "/names") return Response.json({ names: Object.fromEntries(await this.names()) });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    if (this.ctx.getWebSockets().length >= MAX_PLAYERS) return new Response("The planet is full", { status: 503 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const a = { id: crypto.randomUUID().slice(0, 8), hello: null, s: null, n: 0, code: crypto.randomUUID().replace(/-/g, "").slice(0, 16) };
    server.serializeAttachment(a);
    this.seen.set(server, a);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_MSG) return;
    const a = this.info(ws);
    // At most 40 messages every two seconds; the game sends far fewer.
    const now = Date.now();
    if (!(now - a.t0 < 2000)) [a.t0, a.msgs] = [now, 0];
    if (++a.msgs > 40) return;
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(m)) return;

    if (m[0] === "hi") return this.hi(ws, a, m[1]);
    if (!a.hello) return;

    if (m[0] === "s") {
      const s = cleanState(m, TRIPS[worldOf(a)]?.R);
      if (!s) return;
      // Faster than anyone can travel (a teleport, a script): count a strike; three, and this session's
      // finds stop counting. (On the moon or Mars, distances are on the moon or Mars.)
      const world = worldOf(a), wr = TRIPS[world]?.R ?? R;
      if (a.s && a.sAt) {
        const gap = (now - a.sAt) / 1000, step = arcBetween(a.s, s, wr);
        a.budget = Math.min(BUDGET_M, (a.budget ?? BUDGET_M) + TOP_SPEED * gap) - step;
        // (And no one update jumps further than two seconds at top speed, or its own gap: the game sends at least that
        // often while moving, held back or not.)
        if (a.budget < 0 || step > TOP_SPEED * Math.max(gap, 2)) {
          if (now >= (a.cleanAt ?? 0)) a.strikes = (a.strikes ?? 0) + 1;
          [a.cleanAt, a.budget] = [now + CLEAN_MS, 0];
        }
      } else a.budget = BUDGET_M; // (the first position isn't checked, so starting full gives nothing away)
      a.firstAt ??= now;
      a.sAt = now;
      a.s = s;
      a.n = (a.n + 1) % FAR_EVERY;
      this.bonusTick(ws, a, s, world, now);
      ws.serializeAttachment(a);
      // Only to those on the same world (everyone on the moon or Mars is near).
      const out = JSON.stringify(["s", a.id, ...s]);
      for (const o of this.others(ws)) {
        const oi = this.info(o), os = oi.s;
        if (worldOf(oi) !== world) continue;
        if (world !== "planet" || a.n === 0 || !os || os[0] * s[0] + os[1] * s[1] + os[2] * s[2] > NEAR) send(o, out);
      }
      return;
    }
    if (m[0] === "say") {
      const i = m[1];
      if (Number.isInteger(i) && i >= -1 && i < PHRASES) this.broadcast(ws, ["say", a.id, i], a.s);
      return;
    }
    if (m[0] === "chat") return this.chat(ws, a, m[1], now);
    if (m[0] === "namecheck" || m[0] === "setname" || m[0] === "name" || m[0] === "unname") return this.naming(ws, a, m);
    if (m[0] === "auth" || m[0] === "resume" || m[0] === "hunt" || m[0] === "grab" || m[0] === "vouchers" || m[0] === "wgrab" || m[0] === "mgrab") return this.hunt(ws, a, m, now);
    if (m[0] === "ticket") return this.ticket(ws, a, m[1], m[2], now);
    if (m[0] === "moon") return this.ticket(ws, a, "moon", m[1], now, true); // (from a game loaded before Mars)
    if (m[0] === "world") return this.goTo(ws, a, m[1], now);
    // (MOON letters have ended: games loaded before then still ask.)
    if (m[0] === "mission" || m[0] === "missiondrop" || m[0] === "deliver" || m[0] === "moonv") return send(ws, ["nope", -3, "MOON letters have ended.", m[0] === "missiondrop" ? "mission" : m[0]]);
  }

  // ---------------------------------------------------------------- chat

  /// The chat lines kept for newcomers: [id, name, text, time], oldest first.
  async chatLog() {
    return (this.log ??= (await this.ctx.storage.get("chat")) ?? []);
  }

  /// A line from one player to everyone on the planet, if it passes the rules (no links or wallet
  /// addresses, 140 characters) and the limits (one every two seconds, no repeats, the room not flooded).
  async chat(ws, a, raw, now) {
    const r = cleanChat(raw);
    if (r.error) return send(ws, ["chatno", r.error]);
    if (now - (a.chatAt ?? 0) < CHAT_EVERY_MS) return send(ws, ["chatno", "Slow down a little."]);
    if (r.text === a.chatLast && now - a.chatAt < 30_000) return send(ws, ["chatno", "You just said that."]);
    if (!(now - this.chatT0 < 5000)) [this.chatT0, this.chatN] = [now, 0];
    if (++this.chatN > CHAT_ROOM_MAX) return send(ws, ["chatno", "The chat is busy. Try again in a moment."]);
    [a.chatAt, a.chatLast] = [now, r.text];
    ws.serializeAttachment(a);
    const line = [a.id, a.hello.name ?? (a.hello.addr ? short(a.hello.addr) : "Guest"), r.text, now];
    const log = await this.chatLog();
    log.push(line);
    if (log.length > CHAT_KEEP) log.splice(0, log.length - CHAT_KEEP);
    await this.ctx.storage.put("chat", log);
    this.broadcast(null, ["chat", ...line]);
  }

  // ---------------------------------------------------------------- names

  /// Every name in use: wallet (lower case) -> name. (A wallet's record stays after it drops its name,
  /// with name null, so it still has to wait to pick another.)
  async names() {
    return (this.nameList ??= new Map(
      [...(await this.ctx.storage.list({ prefix: "name:" }))].filter(([, v]) => nameShown(v.name)).map(([k, v]) => [k.slice(5), v.name]),
    ));
  }
  /// Put their name on a hello, if the room knows their wallet is theirs and it has one.
  async decorate(hello, a) {
    delete hello.name;
    const name = a.named && hello.addr?.toLowerCase() === a.named ? (await this.names()).get(a.named) : null;
    if (name) hello.name = name;
  }
  /// Their name changed: update everyone's view of them.
  async renamed(ws, a) {
    if (!a.hello) return;
    await this.decorate(a.hello, a);
    ws.serializeAttachment(a);
    this.broadcast(ws, ["look", a.id, a.hello]);
  }
  /// Every session of wallet `w` but `but`: show their new name (or none), and tell them.
  async renamedAll(w, but) {
    const name = (await this.names()).get(w) ?? null;
    for (const o of this.ctx.getWebSockets()) {
      const oa = this.info(o);
      if (o === but || oa?.named !== w) continue;
      await this.renamed(o, oa);
      send(o, ["named", name ? { name, wallet: w } : null]);
    }
  }

  /// ["namecheck", name]: is it free (a hint before signing; "setname" decides)? ["setname", name, wallet,
  /// signature]: their wallet signed nameMessage for this connection's code, so the name is theirs if it's
  /// free (and they get a token, so the game can show it on later visits without signing again).
  /// ["name", token]: a later visit. ["unname"]: back to their wallet address.
  async naming(ws, a, m) {
    const S = this.ctx.storage;
    if (m[0] === "namecheck") {
      const r = cleanName(m[1]);
      if (r.error) return send(ws, ["namefree", String(m[1]).slice(0, 40), false, r.error]);
      const owner = await S.get(`taken:${r.name.toLowerCase()}`);
      const free = !owner || owner === a.hello.addr?.toLowerCase();
      return send(ws, ["namefree", r.name, free, free ? null : "That name is taken. Pick another."]);
    }
    if (m[0] === "setname") {
      const [, raw, wallet, signature] = m;
      const r = cleanName(raw);
      if (r.error) return send(ws, ["nameno", r.error]);
      if (typeof wallet !== "string" || !isAddress(wallet) || typeof signature !== "string" || signature.length > 200) return;
      let ok = false;
      try {
        ok = await verifyMessage({ address: wallet, message: nameMessage(wallet, r.name, a.code), signature });
      } catch {}
      if (!ok) return send(ws, ["nameno", "That signature didn't check out. Try again."]);
      const w = wallet.toLowerCase(), low = r.name.toLowerCase(), now = Date.now();
      const token = randomHex(32), tokKey = `tok:${hex(await sha256(token))}`;
      // Only storage from here on, so nothing else runs in between: two players can't take one name.
      // (Signing again for the name you have, say on another device, or taking back the one you just dropped,
      // doesn't count as a change.)
      const had = await S.get(`name:${w}`), same = (had?.name ?? had?.prev)?.toLowerCase() === low;
      const wait = had && !same ? had.changedAt + NAME_EVERY_MS - now : 0;
      if (wait > 0) {
        const h = Math.ceil(wait / 3_600_000);
        return send(ws, ["nameno", `You can change your name once a day. Try again in ${h} hour${h === 1 ? "" : "s"}.`]);
      }
      const owner = await S.get(`taken:${low}`);
      if (owner && owner !== w) return send(ws, ["nameno", "That name is taken. Pick another."]);
      if (had?.name && !same) await S.delete(`taken:${had.name.toLowerCase()}`);
      await S.put({ [`name:${w}`]: { name: r.name, changedAt: same ? had.changedAt : now }, [`taken:${low}`]: w, [tokKey]: w });
      this.nameList = null;
      a.named = w;
      await this.renamedAll(w, ws);
      await this.renamed(ws, a);
      return send(ws, ["named", { name: r.name, wallet: w, token }]);
    }
    if (m[0] === "name") {
      const token = m[1];
      if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return;
      const w = await S.get(`tok:${hex(await sha256(token))}`);
      const name = w ? (await this.names()).get(w) : null;
      if (w) a.named = w; // the token was given to this wallet, so it's theirs either way
      ws.serializeAttachment(a);
      if (name) await this.renamed(ws, a);
      return send(ws, ["named", name ? { name, wallet: w } : null]);
    }
    if (m[0] === "unname" && a.named) {
      const w = a.named, had = await S.get(`name:${w}`);
      if (!had?.name) return;
      await S.delete(`taken:${had.name.toLowerCase()}`);
      await S.put(`name:${w}`, { name: null, prev: had.name, changedAt: had.changedAt });
      this.nameList = null;
      await this.renamedAll(w, null);
    }
  }

  // ---------------------------------------------------------------- the golden stamp hunt

  /// Who they are: their look, the Courier Skin they asked to wear if it's theirs (its design number), and
  /// the Courier Companion they asked for if they own one of that kind.
  async hi(ws, a, raw) {
    const hello = cleanHello(raw);
    if (!hello) return;
    const seq = (a.hiSeq = (a.hiSeq ?? 0) + 1);
    const id = hello.skinId, kinds = hello.companionIds ?? [];
    delete hello.skinId;
    delete hello.companionIds;
    // Skins and companions are read from the chain (never taken on the client's word) for the wallet on their name
    // tag, the address everyone sees: a hunt sign-in may be for a wallet they've since switched from. Both at once,
    // on a client with short timeouts, so a slow chain can't hold up their arrival for long.
    // A different skin at most every two seconds, so nobody can make the room hammer the chain.
    const skinAsk = id && (id === a.skinAsked || Date.now() - (a.skinAskedAt ?? 0) > 2000);
    if (skinAsk) [a.skinAsked, a.skinAskedAt] = [id, Date.now()];
    const [design, owned] = await Promise.all([
      skinAsk ? this.skinDesign(id, hello.addr) : null,
      kinds.length ? this.ownsCompanions(kinds, hello.addr, a) : new Map(),
    ]);
    if (a.hiSeq !== seq) return; // a newer hello arrived while we were checking (or they left)
    if (design !== null) hello.skin = design;
    // Their companions: those the chain says are theirs (and, while it hasn't answered, those already shown for this
    // wallet). `companion`,
    // the dearest, is for games from before several could follow (and is the one the companion bonus counts).
    const same = a.hello?.addr?.toLowerCase() === hello.addr?.toLowerCase();
    const shownBefore = same ? a.hello?.companions ?? [] : [];
    const verified = kinds.filter((k) => owned.get(k) === true || (owned.get(k) == null && shownBefore.includes(k)));
    if (verified.length) [hello.companions, hello.companion] = [verified, verified[verified.length - 1]];
    if (kinds.some((k) => owned.get(k) === null)) {
      // Too soon after the last new check: look again once one's allowed, unless a newer hello comes first (so
      // flicking through companions in the panel still ends with the last ones showing).
      const wait = 2100 - (Date.now() - a.companionAskedAt);
      setTimeout(() => a.hiSeq === seq && this.seen.get(ws) === a && this.hi(ws, a, raw).catch(() => {}), Math.max(100, wait));
    } else if (kinds.some((k) => owned.get(k) !== true)) {
      // Some not theirs as far as the chain said (or it didn't answer): one more look in a little while, for this
      // hello only, and the room hears again only if one of them is theirs after all.
      const doubt = kinds.filter((k) => owned.get(k) !== true);
      setTimeout(async () => {
        if (a.hiSeq !== seq || this.seen.get(ws) !== a) return;
        const again = await this.ownsCompanions(doubt, hello.addr, a);
        if (doubt.some((k) => again.get(k) === true) && a.hiSeq === seq && this.seen.get(ws) === a) this.hi(ws, a, raw).catch(() => {});
      }, COMPANION_RECHECK_MS);
    }
    await this.decorate(hello, a);
    if (a.hiSeq !== seq) return;
    const first = !a.hello, followed = a.hello?.companion;
    a.hello = hello;
    ws.serializeAttachment(a);
    if (a.wallet && hello.companion !== followed) this.sendBonus(ws, a).catch(() => {}); // (the bonus follows the companion)
    if (first) {
      const recent = (await this.chatLog()).filter((l) => Date.now() - l[3] < CHAT_RECENT_MS);
      // (Everyone starts on the planet; those on the moon or Mars come with where they are only for their world.)
      send(ws, ["welcome", a.id, this.others(ws).map((o) => {
        const oi = this.info(o);
        return [oi.id, oi.hello, worldOf(oi) === worldOf(a) ? oi.s : null, worldOf(oi)];
      }), a.code, recent]);
      this.broadcast(ws, ["join", a.id, hello]);
    } else {
      this.broadcast(ws, ["look", a.id, hello]); // they switched couriers
    }
  }

  /// A skin's design if `owner` holds it, read from the CourierSkins contract (null if not theirs, not
  /// revealed yet, or the chain didn't answer).
  async skinDesign(id, owner) {
    if (!this.env.SKINS_ADDRESS || !owner) return null;
    let c = this.skins.get(id);
    if (!c || Date.now() - c.at > SKIN_CHECK_MS) {
      try {
        const read = (functionName) => this.cosmeticChain().readContract({ address: this.env.SKINS_ADDRESS, abi: SKINS_ABI, functionName, args: [BigInt(id)] });
        const [who, design] = await Promise.all([read("ownerOf"), read("designOf")]);
        c = { at: Date.now(), owner: who, design: Number(design) };
        this.skins.set(id, c);
      } catch {
        return null;
      }
    }
    return c.owner.toLowerCase() === owner.toLowerCase() ? c.design : null;
  }

  /// The chain, for what players wear and bring along: short timeouts and one retry, since nothing waits on it but
  /// how someone looks.
  cosmeticChain() {
    return (this.cosmetic ??= createPublicClient({
      transport: http(this.env.SKINS_RPC ?? this.env.PAD_RPC ?? "https://robinhood-rpc.publicnode.com", { timeout: 4000, retryCount: 1 }),
    }));
  }

  /// Whether `owner` holds a companion of each of `kinds` (a Map: kind -> answer), read from the CourierCompanions
  /// contract (ERC-1155 balanceOfBatch, one read for all of them): kept a few minutes if so, a few seconds if not.
  /// False if not (or there's no contract yet); undefined if the chain didn't answer; null if it isn't known and a new
  /// read would come sooner than two seconds after this player's last one (so nobody can make the room hammer the chain).
  async ownsCompanions(kinds, owner, a) {
    const out = new Map();
    if (!this.env.COMPANIONS_ADDRESS || !owner) {
      for (const k of kinds) out.set(k, false);
      return out;
    }
    // Known ones from what was read lately; the rest in one read (at most one every two seconds per player).
    const ask = [];
    for (const k of kinds) {
      const c = this.companions.get(`${owner.toLowerCase()}:${k}`);
      if (c && Date.now() - c.at < (c.owned ? COMPANION_CHECK_MS : COMPANION_MISS_MS)) out.set(k, c.owned);
      else ask.push(k);
    }
    if (!ask.length) return out;
    if (Date.now() - (a.companionAskedAt ?? 0) < 2000) {
      for (const k of ask) out.set(k, null);
      return out;
    }
    a.companionAskedAt = Date.now();
    try {
      const held = await this.cosmeticChain().readContract({
        address: this.env.COMPANIONS_ADDRESS, abi: COMPANIONS_ABI, functionName: "balanceOfBatch",
        args: [ask.map(() => owner.toLowerCase()), ask.map((k) => BigInt(k))],
      });
      ask.forEach((k, i) => {
        this.companions.set(`${owner.toLowerCase()}:${k}`, { at: Date.now(), owned: held[i] > 0n });
        out.set(k, held[i] > 0n);
      });
      while (this.companions.size > 3000) this.companions.delete(this.companions.keys().next().value);
    } catch {
      for (const k of ask) out.set(k, undefined);
    }
    return out;
  }

  /// The drops running on `day`, oldest first ({ id, spots, isStamp }), read from TokenDrops and kept a minute.
  /// If the chain doesn't answer, the last list (or none) is used: golden stamps keep working either way.
  async dropsOn(day) {
    this.dropCache ??= new Map();
    const c = this.dropCache.get(day);
    if (!this.env.DROPS_ADDRESS || (c && Date.now() - c.at < DROPS_CHECK_MS)) return c?.list ?? [];
    try {
      this.chain ??= createPublicClient({ transport: http(this.env.PAD_RPC ?? this.env.SKINS_RPC ?? "https://robinhood-rpc.publicnode.com") });
      const read = (functionName, args = []) => this.chain.readContract({ address: this.env.DROPS_ADDRESS, abi: DROPS_ABI, functionName, args });
      this.dropStamp ??= (await read("stamp")).toLowerCase();
      const ids = await read("activeDrops", [day]);
      const list = await Promise.all(ids.map(async (id) => {
        const d = await read("drop", [id]);
        return { id: Number(id), spots: Number(d.spots), isStamp: d.token.toLowerCase() === this.dropStamp };
      }));
      this.dropCache.set(day, { at: Date.now(), list });
      if (this.dropCache.size > 4) this.dropCache.delete(this.dropCache.keys().next().value);
      return list;
    } catch {
      return c?.list ?? [];
    }
  }

  /// A wallet's finds for one day: the golden stamps (`key` "golden") or a token drop's coins (its id).
  async finds(day, wallet, key = "golden") {
    this.found ??= new Map();
    const k = key === "golden" ? `hunt:${day}:${wallet}` : `drop:${day}:${key}:${wallet}`;
    if (!this.found.has(k)) {
      this.found.set(k, new Set((await this.ctx.storage.get(k)) ?? []));
      if (this.found.size > 2000) this.found.delete(this.found.keys().next().value);
    }
    return { key: k, set: this.found.get(k) };
  }

  async hunt(ws, a, m, now) {
    const on = !!(this.env.DROPS_KEY && this.env.DROPS_ADDRESS);
    const day = huntDay(now);
    const state = async () => {
      // (For each trip: its stamps found today, and when your ticket runs out, as `moon`, `moonUntil` and so on.)
      const away = {};
      for (const k of Object.keys(TRIPS)) [away[k], away[`${k}Until`]] = [a.wallet ? [...(await this.finds(day, a.wallet, k)).set] : [], (a.wallet && a[`${k}Until`]) || 0];
      if (!a.wallet) return ["hunt", { on, day, wallet: null, found: [], coins: {}, ...away }];
      const lay = layDrops(day, SPOTS.length, await this.dropsOn(day));
      const coins = {};
      for (const c of lay.coins) coins[c.drop] = [...(await this.finds(day, a.wallet, c.drop)).set];
      return ["hunt", { on, day, wallet: a.wallet, found: [...(await this.finds(day, a.wallet)).set], coins, ...away }];
    };

    if (m[0] === "auth") {
      // ["auth", wallet, signature]: they signed authMessage(wallet, the code we sent at welcome).
      const [, wallet, signature] = m;
      if (typeof wallet !== "string" || !isAddress(wallet) || typeof signature !== "string" || signature.length > 200) return;
      let ok = false;
      try {
        // The message carries the address as the game wrote it (wallets often report it in lower case).
        ok = await verifyMessage({ address: wallet, message: authMessage(wallet, a.code), signature });
      } catch {}
      if (!ok) return send(ws, ["nope", -1, "That signature didn't check out. Try signing in again."]);
      await this.switchWallet(a, getAddress(wallet));
      await this.tickets(a); // (tickets bought before, still good)
      ws.serializeAttachment(a);
      // A token for this browser to pick the hunt up again on a new connection (a reload, a dropped line) without
      // signing again. It only counts finds for this wallet; claiming still takes the wallet itself.
      const token = randomHex(16);
      await this.ctx.storage.put(`htok:${a.wallet}`, { token, at: now });
      send(ws, ["hunttoken", token]);
      send(ws, await state());
      return this.sendBonus(ws, a).catch(() => {});
    }
    if (m[0] === "resume") {
      // ["resume", wallet, token]: the token we gave this browser when it signed in.
      const [, wallet, token] = m;
      if (typeof wallet !== "string" || !isAddress(wallet) || typeof token !== "string" || token.length > 64) return;
      const t = await this.ctx.storage.get(`htok:${getAddress(wallet)}`);
      if (!t || t.token !== token || now - t.at > HUNT_TOKEN_MS) return;
      await this.switchWallet(a, getAddress(wallet));
      await this.tickets(a);
      ws.serializeAttachment(a);
      send(ws, await state());
      return this.sendBonus(ws, a).catch(() => {});
    }
    if (m[0] === "hunt") return send(ws, await state());
    if (!a.wallet) return send(ws, ["nope", -1, "Sign in with your wallet to hunt for treasure."]);

    if (m[0] === "grab") {
      // ["grab", spot]: they say they've just picked up the stamp or coin at that spot. Check they were there.
      const i = m[1];
      const nope = (why) => send(ws, ["nope", i, why]);
      const owner = Number.isInteger(i) ? layDrops(day, SPOTS.length, await this.dropsOn(day)).owner.get(i) : undefined;
      if (owner === undefined) return nope("Nothing is out there today.");
      const { key, set } = await this.finds(day, a.wallet, owner);
      if (set.has(i)) return send(ws, ["found", day, i, set.size, owner]);
      if ((a.strikes ?? 0) >= 3) return nope("Something looked off with your movement, so finds aren't counting this session. Reload to try again.");
      if (!a.s || now - a.sAt > 4000 || now - a.firstAt < 5000 || now < (a.cleanAt ?? 0)) return nope("Keep exploring a moment, then try again.");
      const p = SPOTS[i], far = arcBetween(a.s, spotDir[i]), up = Math.abs(a.s[6] + 0.85 - p.h);
      if (far > REACH || up > REACH_UP) return nope("You weren't close enough to that one.");
      set.add(i);
      await this.ctx.storage.put(key, [...set]);
      this.vouchersSent?.delete(ws); // (the next vouchers include it)
      return send(ws, ["found", day, i, set.size, owner]);
    }
    if (m[0] === "wgrab" || m[0] === "mgrab") {
      // ["wgrab", world, spot]: a stamp on the moon or Mars (an index into that trip's spots) picked up there, with a
      // ticket. (["mgrab", spot]: a moon stamp, from a game loaded before Mars.)
      const [k, i] = m[0] === "mgrab" ? ["moon", m[1]] : [m[1], m[2]];
      const trip = TRIPS[k];
      if (!trip) return;
      const nope = (why) => send(ws, ["nope", i, why, k]);
      if (!Number.isInteger(i) || !trip.pick(day).includes(i)) return nope("Nothing is out there today.");
      if (worldOf(a) !== k || !(a[`${k}Until`] > now)) return nope(`Those stamps count for couriers with a ticket to ${trip.name}.`);
      const { key, set } = await this.finds(day, a.wallet, k);
      if (set.has(i)) return send(ws, ["found", day, i, set.size, k]);
      if ((a.strikes ?? 0) >= 3) return nope("Something looked off with your movement, so finds aren't counting this session. Reload to try again.");
      if (!a.s || now - a.sAt > 4000 || now - a.firstAt < 5000 || now < (a.cleanAt ?? 0)) return nope("Keep exploring a moment, then try again.");
      const p = trip.spots[i], far = arcBetween(a.s, p.d, trip.R), up = Math.abs(a.s[6] + 0.85 - p.h);
      if (far > trip.reach || up > trip.reachUp) return nope("You weren't close enough to that one.");
      set.add(i);
      await this.ctx.storage.put(key, [...set]);
      this.vouchersSent?.delete(ws); // (the next vouchers include it)
      return send(ws, ["found", day, i, set.size, k]);
    }
    if (m[0] === "vouchers") {
      // ["vouchers"]: a signed note of each drop's finds, today's and yesterday's, for TokenDrops.claimMany. (The same
      // answer again for a few seconds, so asking over and over can't keep the room signing.)
      if (!on) return send(ws, ["nope", -1, "The treasure hunt isn't paying out yet."]);
      this.vouchersSent ??= new WeakMap();
      const sent = this.vouchersSent.get(ws);
      if (sent && sent.wallet === a.wallet && now - sent.at < 5000) return send(ws, await sent.reply);
      const reply = this.vouchers(a, day, now);
      this.vouchersSent.set(ws, { at: now, wallet: a.wallet, reply });
      reply.catch(() => this.vouchersSent.get(ws)?.reply === reply && this.vouchersSent.delete(ws));
      return send(ws, await reply);
    }
  }

  /// The ["vouchers"] answer for a signed-in hunter: a signed note of each drop's finds, today's and yesterday's, and
  /// their companion bonus shares, for TokenDrops.claimMany.
  async vouchers(a, day, now) {
    const signer = (this.signer ??= privateKeyToAccount(this.env.DROPS_KEY));
    const deadline = Math.floor(now / 1000) + VOUCHER_SECS;
    const out = [];
    for (const d of [day - 1, day]) {
      const lay = layDrops(d, SPOTS.length, await this.dropsOn(d));
      const wanted = lay.coins.map((c) => [c.drop, c.drop]);
      if (lay.golden.drop !== null) wanted.unshift([lay.golden.drop, "golden"]);
      for (const [drop, key] of wanted) {
        // (Golden stamps on the planet, the moon and Mars are paid by the same $STAMP drop.)
        let n = (await this.finds(d, a.wallet, key)).set.size;
        if (key === "golden") for (const k of Object.keys(TRIPS)) n += (await this.finds(d, a.wallet, k)).set.size;
        if (!n) continue;
        const coins = Math.min(n, key === "golden" ? HUNT_STAMPS + Object.values(TRIPS).reduce((t, x) => t + x.stamps, 0) : 65535);
        const signature = await signer.signTypedData({
          domain: { name: "Courier World Drops", version: "1", chainId: Number(this.env.DROPS_CHAIN_ID ?? 4663), verifyingContract: this.env.DROPS_ADDRESS },
          types: { Finds: [{ name: "player", type: "address" }, { name: "drop", type: "uint256" }, { name: "day", type: "uint32" }, { name: "coins", type: "uint16" }, { name: "deadline", type: "uint64" }] },
          primaryType: "Finds",
          message: { player: a.wallet, drop: BigInt(drop), day: d, coins, deadline: BigInt(deadline) },
        });
        out.push({ drop, day: d, coins, deadline, signature });
      }
    }
    // The companion bonus: yesterday's share (paid as today) and the day before's (paid as yesterday, still open).
    if (await this.bonusDropsReady()) {
      const { day: today, ms } = this.bonusClock(now), until = Math.floor(ms / 1000) + VOUCHER_SECS;
      for (const playDay of [today - 2, today - 1]) {
        const p = await this.bonusPaid(a.wallet, playDay);
        if (!p) continue;
        const signature = await signer.signTypedData({
          domain: { name: "Courier World Drops", version: "1", chainId: Number(this.env.DROPS_CHAIN_ID ?? 4663), verifyingContract: this.env.DROPS_ADDRESS },
          types: { Finds: [{ name: "player", type: "address" }, { name: "drop", type: "uint256" }, { name: "day", type: "uint32" }, { name: "coins", type: "uint16" }, { name: "deadline", type: "uint64" }] },
          primaryType: "Finds",
          message: { player: a.wallet, drop: BigInt(p.drop), day: p.payDay, coins: p.coins, deadline: BigInt(until) },
        });
        out.push({ drop: p.drop, day: p.payDay, coins: p.coins, deadline: until, signature });
      }
    }
    return out.length ? ["vouchers", out] : ["nope", -1, "Find a golden stamp or a coin first."];
  }

  // ---------------------------------------------------------------- the companion bonus

  /// The bonus's clock: { ms, day, minute } at `now`. (`wrangler dev` alone can set BONUS_DEV_DAYS, to try settling a
  /// day without waiting for it to end, and BONUS_DEV_MINUTE_MS and BONUS_DEV_SAMPLE_MS, to try it in seconds.)
  bonusClock(now) {
    const ms = now + Number(this.env.BONUS_DEV_DAYS ?? 0) * 86_400_000;
    return { ms, day: huntDay(ms), minute: Math.floor(now / Number(this.env.BONUS_DEV_MINUTE_MS ?? 60_000)) };
  }

  /// The bonus drops (bonus-rules.js) as last read from TokenDrops, kept a minute: [{ id, startDay, endDay, dailyCoins,
  /// dry }] ($STAMP drops only). null when there's no bonus at all (none listed, no companions contract, no voucher
  /// key); undefined until they've been read once (the last good list is also kept in storage, for after a wake).
  bonusDrops() {
    if (!BONUS_DROPS.length || !this.env.COMPANIONS_ADDRESS || !this.env.DROPS_KEY || !this.env.DROPS_ADDRESS) return null;
    const c = this.bonusDropsCache;
    if (!c || Date.now() - c.at > DROPS_CHECK_MS) this.readBonusDrops();
    return c?.drops;
  }
  /// The same, waiting for the first read.
  async bonusDropsReady() {
    if (this.bonusDrops() === undefined) await this.bonusDropsRead;
    return this.bonusDrops();
  }
  readBonusDrops() {
    return (this.bonusDropsRead ??= (async () => {
      try {
        if (!this.bonusDropsCache) {
          const kept = await this.ctx.storage.get("bonusDrops");
          if (kept && !this.bonusDropsCache) this.bonusDropsCache = { at: 0, drops: kept };
        }
        this.chain ??= createPublicClient({ transport: http(this.env.PAD_RPC ?? this.env.SKINS_RPC ?? "https://robinhood-rpc.publicnode.com") });
        const read = (functionName, args = []) => this.chain.readContract({ address: this.env.DROPS_ADDRESS, abi: DROPS_ABI, functionName, args });
        this.dropStamp ??= (await read("stamp")).toLowerCase();
        const drops = [];
        for (const id of BONUS_DROPS) {
          let d;
          try {
            d = await read("drop", [BigInt(id)]);
          } catch (e) {
            if (e?.walk?.((x) => x?.name === "ContractFunctionRevertedError")) continue; // (no such drop: a typo in the list)
            throw e;
          }
          if (d.token.toLowerCase() !== this.dropStamp) continue;
          drops.push({ id, startDay: Number(d.startDay), endDay: Number(d.endDay), dailyCoins: Number(d.dailyCoins), dry: d.left < d.perCoin });
        }
        if (JSON.stringify(drops) !== JSON.stringify(this.bonusDropsCache?.drops)) await this.ctx.storage.put("bonusDrops", drops);
        this.bonusDropsCache = { at: Date.now(), drops };
      } catch {
        // (The chain didn't answer: keep what was known, and try again in 10 s.)
        this.bonusDropsCache = { at: Date.now() - DROPS_CHECK_MS + 10_000, drops: this.bonusDropsCache?.drops };
      } finally {
        this.bonusDropsRead = null;
      }
    })());
  }
  /// The bonus drop that pays for `playDay`'s minutes (the latest listed one whose days include its pay day), or null.
  bonusDropFor(drops, playDay) {
    const payDay = bonusPayDay(playDay);
    return drops?.findLast((d) => payDay >= d.startDay && payDay <= d.endDay) ?? null;
  }

  /// A wallet's bonus for `day`: { day, min: { kind: minutes }, lost: [kinds that left the wallet that day], last (the
  /// minute last counted), at and world (where), dirty (minutes counted since it was written), savedAt, ready }. From
  /// memory, or loading (`loading` until `ready` settles). What was counted but not yet written also rides in the
  /// counting connection's attachment (`bonusMem`), so a room that sleeps and wakes doesn't lose it.
  bonusRec(wallet, day) {
    this.bonus ??= new Map();
    const r = this.bonus.get(wallet);
    if (r && r.day === day) return r;
    if (r?.dirty && !r.loading) this.saveBonus(wallet, r); // (the last minutes of their day before)
    const rec = { day, loading: true, min: {}, lost: [], last: 0, dirty: 0, savedAt: 0 };
    rec.ready = this.ctx.storage.get(`bonus:${day}:${wallet}`).then((v) => {
      if (v) Object.assign(rec, { min: v.min ?? {}, lost: v.lost ?? [], last: v.last ?? 0 });
      // (Counts only grow within a day, so the most any of their connections counted is right.)
      for (const ws of this.ctx.getWebSockets()) {
        const m = this.info(ws)?.bonusMem;
        if (m?.wallet !== wallet || m.day !== day) continue;
        for (const [k, n] of Object.entries(m.min)) if (n > (rec.min[k] ?? 0)) [rec.min[k], rec.dirty] = [n, rec.dirty + 1];
        for (const k of m.lost) if (!rec.lost.includes(k)) rec.lost.push(k);
        rec.last = Math.max(rec.last, m.last);
      }
      rec.loading = false;
    }, () => {
      if (this.bonus.get(wallet) === rec) this.bonus.delete(wallet); // (try again next time)
    });
    this.bonus.set(wallet, rec);
    if (this.bonus.size > 3000) {
      for (const [w, x] of this.bonus) if (!x.dirty && !x.loading && w !== wallet) {
        this.bonus.delete(w);
        break;
      }
    }
    return rec;
  }
  /// A connection signs in as `wallet`: if it was counting another wallet's bonus, that wallet's minutes are written
  /// first (the new wallet starts from its own).
  async switchWallet(a, wallet) {
    if (a.bonusMem && a.bonusMem.wallet !== wallet) await this.flushMem(a.bonusMem).catch(() => {});
    if (a.wallet !== wallet) a.bonusMem = undefined;
    a.wallet = wallet;
  }

  /// Write what a connection counted (its attachment's `bonusMem`) into its wallet's day, if it adds anything: for when
  /// the room has slept since and only the attachment still has it.
  async flushMem(mem) {
    const grow = (rec) => {
      let more = false;
      for (const [k, n] of Object.entries(mem.min)) {
        if (n > (rec.min[k] ?? 0)) [rec.min[k], more] = [n, true];
      }
      for (const k of mem.lost) {
        if (!rec.lost.includes(k)) {
          rec.lost.push(k);
          more = true;
        }
      }
      if (mem.last > rec.last) [rec.last, more] = [mem.last, true];
      return more;
    };
    const live = this.bonus?.get(mem.wallet);
    if (live?.day === mem.day) {
      await live.ready;
      if (!live.loading && grow(live)) await this.saveBonus(mem.wallet, live);
      return;
    }
    const key = `bonus:${mem.day}:${mem.wallet}`, v = (await this.ctx.storage.get(key)) ?? {};
    const rec = { min: v.min ?? {}, lost: v.lost ?? [], last: v.last ?? 0 };
    if (grow(rec)) await this.ctx.storage.put(key, rec);
  }
  saveBonus(wallet, rec) {
    [rec.dirty, rec.savedAt] = [0, Date.now()];
    return this.ctx.storage.put(`bonus:${rec.day}:${wallet}`, { min: rec.min, lost: rec.lost, last: rec.last }).catch(() => {
      rec.dirty ||= 1;
    });
  }

  /// Everyone who has earned with each companion on `day` ("wallet:kind"), for the ownership checks...
  bonusWho(day) {
    return this.daySet("bonusWho", day);
  }
  /// ...and those an ownership check found still holding it: only their minutes are paid.
  bonusOk(day) {
    return this.daySet("bonusOk", day);
  }
  daySet(name, day) {
    this.daySets ??= new Map();
    const key = `${name}:${day}`;
    let p = this.daySets.get(key);
    if (!p) {
      p = this.ctx.storage.get(key).then((v) => new Set(v ?? []));
      p.catch(() => this.daySets.get(key) === p && this.daySets.delete(key));
      this.daySets.set(key, p);
      if (this.daySets.size > 12) this.daySets.delete(this.daySets.keys().next().value);
    }
    return p;
  }
  async addWho(day, wallet, kind) {
    const set = await this.bonusWho(day), k = `${wallet}:${kind}`;
    if (set.has(k)) return;
    set.add(k);
    (this.whoAt ??= new Map()).set(k, Date.now());
    await this.ctx.storage.put(`bonusWho:${day}`, [...set]);
    // The day's last ownership check, just before it ends (an alarm wakes even a sleeping room for it).
    const at = (day + 1) * 86_400_000 - Number(this.env.BONUS_DEV_DAYS ?? 0) * 86_400_000 - 30_000;
    if ((await this.ctx.storage.getAlarm()) !== at) await this.ctx.storage.setAlarm(at);
  }
  async alarm() {
    // The day's last ownership check; if the chain doesn't answer, again in ten seconds while the day lasts. (A room
    // the alarm wakes hasn't read the drops yet: the check doesn't need them, only that there's a bonus at all.)
    const now = Date.now(), { day } = this.bonusClock(now);
    if (this.bonusDrops() === null) return;
    try {
      await this.sampling?.catch(() => {}); // (a random check in flight: let it finish, then look afresh)
      await this.sampleOwners(day);
    } catch {
      if (this.bonusClock(now + 10_000).day === day) await this.ctx.storage.setAlarm(now + 10_000);
    }
  }

  /// Whether `wallet` has a post office open (only those can claim, so only they earn): a yes is kept for the day, a
  /// no for ten minutes (they may open one). null while it's being read.
  officeOpen(wallet, day) {
    if (!this.env.POST_OFFICE) return true;
    this.offices ??= new Map();
    const c = this.offices.get(wallet);
    if (c && !c.reading && (c.ok ? c.day === day : Date.now() - c.at < 10 * 60_000)) return c.ok;
    if (!c?.reading) {
      this.offices.set(wallet, { ok: c?.ok ?? null, reading: true });
      this.cosmeticChain().readContract({ address: this.env.POST_OFFICE, abi: OFFICES_ABI, functionName: "offices", args: [wallet] }).then(
        ([open]) => this.offices.set(wallet, { ok: open, day, at: Date.now() }),
        () => this.offices.set(wallet, { ok: null, day, at: Date.now() - 9 * 60_000 }), // (again in a minute)
      );
      if (this.offices.size > 3000) this.offices.delete(this.offices.keys().next().value);
    }
    return c?.ok ?? null;
  }

  /// Why a player's minutes aren't counting toward the bonus right now (see the ["bonus"] status in web/net.js), or
  /// null if they are; undefined while something it needs is still being read ("checking").
  bonusWhy(a, drops, day, now) {
    if (!drops) return undefined;
    if (!this.bonusDropFor(drops, day)) return "season";
    const w = a.wallet, kind = a.hello?.companion;
    if (!w) return "signin";
    if (!a.hello?.addr || a.hello.addr.toLowerCase() !== w.toLowerCase()) return "wallet";
    if (!kind) return "companion";
    if ((a.strikes ?? 0) >= 3) return "strikes";
    const rec = this.bonusRec(w, day);
    if (rec.loading) return undefined;
    if (rec.lost.includes(kind)) return "left";
    if (Object.values(rec.min).reduce((t, m) => t + m, 0) >= BONUS_MINUTES) return "full";
    // (An office seen open today stays known in their attachment, so a room that wakes needn't ask the chain again.)
    if (a.officeOk?.wallet !== w || a.officeOk.day !== day) {
      const open = this.officeOpen(w, day);
      if (open === null) return undefined;
      if (!open) return "office";
      a.officeOk = { wallet: w, day };
    }
    if (now - (a.bonusFrom ?? now) < BONUS_WARMUP_MS || now < (a.cleanAt ?? 0)) return "warmup";
    return null;
  }

  /// One more update from a moving player: count this minute toward their companion bonus if it qualifies (moved far
  /// enough since their last counted minute, and not already counted from another of their tabs), and tell them when
  /// that changes. Synchronous: what needs the chain or storage starts here and counts from a later update.
  bonusTick(ws, a, s, world, now) {
    const drops = this.bonusDrops();
    if (drops === null) return;
    a.bonusFrom ??= now;
    this.maybeSample(now);
    const { day, minute } = this.bonusClock(now), why = this.bonusWhy(a, drops, day, now);
    let counted = 0;
    if (why === null) {
      const rec = this.bonusRec(a.wallet, day);
      if (rec.last === minute) return;
      if (rec.at && rec.world === world && arcBetween(rec.at, s, TRIPS[world]?.R ?? R) < BONUS_MOVE_M) return;
      const kind = a.hello.companion;
      if (!rec.min[kind]) this.addWho(day, a.wallet, kind).catch(() => {});
      rec.min[kind] = (rec.min[kind] ?? 0) + 1;
      [rec.last, rec.at, rec.world] = [minute, s.slice(0, 3), world];
      if (a.bonusMem && (a.bonusMem.day !== day || a.bonusMem.wallet !== a.wallet)) this.flushMem(a.bonusMem).catch(() => {});
      a.bonusMem = { wallet: a.wallet, day, min: { ...rec.min }, lost: [...rec.lost], last: rec.last };
      if (++rec.dirty >= BONUS_SAVE_EVERY) this.saveBonus(a.wallet, rec);
      counted = Object.values(rec.min).reduce((t, m) => t + m, 0);
    }
    const shown = why === undefined ? "checking" : why;
    if (shown !== a.bonusWhy || day !== a.bonusDay || (counted && counted % BONUS_STATUS_EVERY === 0)) {
      [a.bonusWhy, a.bonusDay] = [shown, day]; // (and a new day starts afresh)
      this.sendBonus(ws, a, now).catch(() => {});
    }
  }

  /// Tell a player how their companion bonus stands: whether a season is running (`live`), what's counted today, why it
  /// isn't counting now (if it isn't), and their shares of the last two days, waiting to be claimed.
  async sendBonus(ws, a, now = Date.now()) {
    if (!BONUS_DROPS.length || !this.env.COMPANIONS_ADDRESS) return; // (no bonus at all: nothing to say)
    const drops = await this.bonusDropsReady();
    if (drops === null) return;
    const { day } = this.bonusClock(now), w = a.wallet, live = this.bonusDropFor(drops, day);
    let minutes = 0, coins = 0, lost = [];
    const paid = [];
    if (w) {
      const rec = this.bonusRec(w, day);
      await rec.ready;
      minutes = Object.values(rec.min).reduce((t, m) => t + m, 0);
      coins = bonusCoins(keptMinutes(rec));
      lost = rec.lost;
      for (const playDay of [day - 2, day - 1]) {
        const p = await this.bonusPaid(w, playDay).catch(() => null);
        if (p) paid.push(p);
      }
    }
    let why = this.bonusWhy(a, drops, day, now);
    if (why === undefined) why = "checking"; // (null goes out only when minutes really count)
    send(ws, ["bonus", { on: true, live: !!live, dry: !!live?.dry, day, minutes, max: BONUS_MINUTES, kind: a.hello?.companion ?? null, coins, why, lost, pool: live?.dailyCoins ?? 0, paid }]);
  }

  /// A wallet's minutes for a day that count: without the companions that left it, and only those an ownership check
  /// found it holding.
  paidMinutes(v, wallet, ok) {
    return Object.fromEntries(Object.entries(keptMinutes(v)).filter(([k]) => ok.has(`${wallet}:${k}`)));
  }

  /// Everyone's coins for `day` together, before any sharing: added up once the day is over, and kept.
  bonusTotal(day) {
    this.totals ??= new Map();
    let p = this.totals.get(day);
    if (!p) {
      p = (async () => {
        const kept = await this.ctx.storage.get(`bonusTotal:${day}`);
        if (kept !== undefined) return kept;
        // (What's only in memory or in a connection's attachment for that day is written first, so it's counted.)
        await Promise.all([...(this.bonus ?? [])].filter(([, r]) => r.day === day && r.dirty && !r.loading).map(([w, r]) => this.saveBonus(w, r)));
        for (const ws of this.ctx.getWebSockets()) {
          const m = this.info(ws)?.bonusMem;
          if (m?.day === day) await this.flushMem(m);
        }
        const ok = await this.bonusOk(day);
        let total = 0;
        for (const [key, v] of await this.ctx.storage.list({ prefix: `bonus:${day}:` })) total += bonusCoins(this.paidMinutes(v, key.split(":")[2], ok));
        await this.ctx.storage.put(`bonusTotal:${day}`, total);
        return total;
      })();
      p.catch(() => this.totals.get(day) === p && this.totals.delete(day));
      this.totals.set(day, p);
      for (const d of this.totals.keys()) if (d < day - 3) this.totals.delete(d);
    }
    return p;
  }

  /// A wallet's share of `playDay`'s pool, once that day is over ({ drop, payDay, coins }: paid by bonus drop `drop` as
  /// its day payDay), or null if there's nothing (or no season paid for that day).
  async bonusPaid(wallet, playDay) {
    const drop = this.bonusDropFor(this.bonusDrops(), playDay), payDay = bonusPayDay(playDay);
    if (!drop || playDay >= this.bonusClock(Date.now()).day) return null;
    this.paidCache ??= new Map();
    const key = `${playDay}:${wallet}`;
    if (!this.paidCache.has(key)) {
      // (A day that's over doesn't change, so its share is worked out once.)
      const [total, ok, v] = [await this.bonusTotal(playDay), await this.bonusOk(playDay), await this.ctx.storage.get(`bonus:${playDay}:${wallet}`)];
      this.paidCache.set(key, bonusShare(bonusCoins(this.paidMinutes(v, wallet, ok)), total, drop.dailyCoins));
      if (this.paidCache.size > 4000) this.paidCache.delete(this.paidCache.keys().next().value);
    }
    const coins = this.paidCache.get(key);
    return coins > 0 ? { drop: drop.id, payDay, coins } : null;
  }

  /// Now and then (at random times, so nobody can time handing a companion from wallet to wallet), and once more just
  /// before the day ends (alarm), check in one read that every wallet that has earned today still holds the companion
  /// it earned with. One that does is confirmed (only confirmed minutes are paid); one that doesn't loses that
  /// companion's minutes for the day. So a companion earns for one wallet a day.
  maybeSample(now) {
    const mean = Number(this.env.BONUS_DEV_SAMPLE_MS ?? BONUS_SAMPLE_MS);
    const gap = () => Math.min(2.5 * mean, Math.max(0.2 * mean, -Math.log(1 - Math.random()) * mean));
    this.nextSample ??= now + gap();
    if (now < this.nextSample || this.sampling) return;
    this.nextSample = now + gap();
    this.sampleOwners(this.bonusClock(now).day).catch(() => {});
  }
  async sampleOwners(day) {
    if (this.sampling) return this.sampling;
    this.sampling = (async () => {
      // (A pair that started earning in the last minute is left to the next check: the read may not show a companion
      // bought moments ago yet.)
      const recent = Date.now() - 60_000;
      const pairs = [...(await this.bonusWho(day))].filter((k) => !((this.whoAt?.get(k) ?? 0) > recent)).map((k) => {
        const [w, kind] = k.split(":");
        return [w, Number(kind)];
      });
      const held = [];
      for (let i = 0; i < pairs.length; i += 200) {
        const part = pairs.slice(i, i + 200);
        held.push(...await this.cosmeticChain().readContract({
          address: this.env.COMPANIONS_ADDRESS, abi: COMPANIONS_ABI, functionName: "balanceOfBatch",
          args: [part.map(([w]) => w), part.map(([, k]) => BigInt(k))],
        }));
      }
      if (this.bonusClock(Date.now()).day !== day) return; // (past midnight: tomorrow's holdings say nothing of today's)
      const ok = await this.bonusOk(day), had = ok.size;
      for (let j = 0; j < pairs.length; j++) {
        if (held[j] > 0n) ok.add(`${pairs[j][0]}:${pairs[j][1]}`);
        else await this.loseBonus(day, ...pairs[j]);
      }
      if (ok.size !== had) await this.ctx.storage.put(`bonusOk:${day}`, [...ok]);
    })().finally(() => (this.sampling = null));
    return this.sampling;
  }
  /// `wallet` no longer holds a `kind` it earned with today: those minutes don't count today.
  async loseBonus(day, wallet, kind) {
    const rec = this.bonusRec(wallet, day);
    await rec.ready;
    if (rec.loading || rec.lost.includes(kind)) return;
    rec.lost.push(kind);
    await this.saveBonus(wallet, rec);
    for (const ws of this.ctx.getWebSockets()) {
      const o = this.info(ws);
      if (o?.bonusMem?.wallet === wallet && o.bonusMem.day === day && !o.bonusMem.lost.includes(kind)) o.bonusMem.lost.push(kind);
      if (o?.wallet === wallet) this.sendBonus(ws, o).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- trips: the moon and Mars

  /// A signed-in player's tickets, as kept (`moon:<wallet>` and so on: when each runs out).
  async tickets(a) {
    for (const k of Object.keys(TRIPS)) a[`${k}Until`] = (await this.ctx.storage.get(`${k}:${a.wallet}`)) ?? 0;
  }

  /// ["ticket", world, txHash]: a ticket to the moon or Mars (trips.js). It's good if that transaction (in the last
  /// few hours, and not used before for any trip) sent the trip's price in $STAMP from this player's signed-in wallet
  /// to the treasury; then the trip is theirs for its hour (kept, so a reload doesn't lose it). `legacy`: the old
  /// ["moon", txHash], answered the old way.
  async ticket(ws, a, k, hash, now, legacy = false) {
    const no = (why) => send(ws, ["nope", -2, why]);
    const trip = TRIPS[k];
    if (!trip) return no("The rocket doesn't fly there.");
    if (!a.wallet) return no("Sign in to the hunt first, so the room knows your wallet.");
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return no("That isn't a transaction.");
    const key = `moonTx:${hash.toLowerCase()}`; // (every trip's tickets, so one payment can't buy two)
    this.ticketChecking ??= new Set();
    if (this.ticketChecking.has(key) || (await this.ctx.storage.get(key))) return no("That ticket has already been used.");
    this.ticketChecking.add(key);
    try {
      if (this.env.MOON_DEV !== "1") {
        // (Only `wrangler dev` sets MOON_DEV, to try the trips without paying.)
        await this.dropsOn(huntDay(now)); // (reads $STAMP's address from the drops contract)
        if (!this.chain || !this.dropStamp) return no("The Space Express isn't open right now. Try again soon.");
        let receipt = null;
        for (let i = 0; i < 6 && !receipt; i++) {
          try {
            receipt = await this.chain.getTransactionReceipt({ hash });
          } catch {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        if (!receipt) return no("Couldn't find that transaction yet. Try again in a moment.");
        if (receipt.status !== "success") return no("That transaction failed.");
        const addr = (topic) => `0x${topic.slice(-40)}`.toLowerCase();
        const paid = receipt.logs.some((l) => l.address.toLowerCase() === this.dropStamp && l.topics[0] === TRANSFER && l.topics.length === 3 &&
          addr(l.topics[1]) === a.wallet.toLowerCase() && addr(l.topics[2]) === TREASURY.toLowerCase() && BigInt(l.data) >= trip.price);
        if (!paid) return no(`That transaction didn't send ${trip.priceText} $STAMP from your wallet to the treasury.`);
        const block = await this.chain.getBlock({ blockNumber: receipt.blockNumber });
        if (now / 1000 - Number(block.timestamp) > TICKET_AGE) return no("That ticket is too old.");
      }
      const until = now + trip.secs * 1000;
      await this.ctx.storage.put(key, a.wallet);
      await this.ctx.storage.put(`${k}:${a.wallet}`, until);
      a[`${k}Until`] = until;
      ws.serializeAttachment(a);
      send(ws, legacy ? ["moonok", until] : ["ticketok", k, until]);
    } catch {
      no("Couldn't check that ticket. Try again in a moment.");
    } finally {
      this.ticketChecking.delete(key);
    }
  }

  /// ["world", "moon" | "mars" | "planet"]: off on a trip (with a ticket) or home. Everyone hears, so they can draw
  /// them on the right world; where they were is forgotten (it was on another one).
  goTo(ws, a, w, now) {
    if (!WORLDS.includes(w)) return;
    if (TRIPS[w] && !(a[`${w}Until`] > now)) return send(ws, ["nope", -2, `You need a ticket to ${TRIPS[w].name} for that.`]);
    if (worldOf(a) === w) return;
    a.world = TRIPS[w] ? w : undefined;
    a.s = null;
    a.sAt = 0;
    // (Where they were is on another world now: the speed check starts afresh, and finds wait as on a new connection.)
    a.firstAt = null;
    ws.serializeAttachment(a);
    if (a.hello) this.broadcast(ws, ["world", a.id, w]);
    // Where everyone already there is (those standing still don't send it again).
    send(ws, ["here", this.others(ws).flatMap((o) => {
      const oi = this.info(o);
      return worldOf(oi) === w && oi.s ? [[oi.id, oi.s]] : [];
    })]);
  }

  async webSocketClose(ws, code) {
    await this.left(ws);
    try {
      ws.close(code >= 1000 && code < 1004 ? code : 1000, "Bye");
    } catch {}
  }
  async webSocketError(ws) {
    await this.left(ws);
  }
  async left(ws) {
    const a = this.info(ws);
    this.seen.delete(ws);
    if (a) a.hiSeq = (a.hiSeq ?? 0) + 1; // (a hello still reading the chain stops there: no join for someone gone)
    if (a?.hello) this.broadcast(ws, ["leave", a.id]);
    // Their companion bonus's last minutes, if this was their last connection (from memory, or after the room slept,
    // from what this connection carried).
    const mem = a?.bonusMem;
    if (mem && !this.ctx.getWebSockets().some((o) => o !== ws && this.info(o)?.bonusMem?.wallet === mem.wallet)) {
      const rec = this.bonus?.get(mem.wallet);
      if (rec?.day === mem.day && rec.dirty && !rec.loading) await this.saveBonus(mem.wallet, rec);
      else await this.flushMem(mem).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------- launchpad pictures
// Token pictures for the launchpad, kept in a Durable Object of their own (so the room never waits on them),
// by the SHA-256 of their bytes. Only a wallet with a post office can upload (it signs for the picture), at
// most UPLOADS_PER_DAY a day; anyone can fetch one. The game shrinks pictures to 512 px before sending.
const UPLOADS_PER_DAY = 12;
const UPLOAD_WINDOW_MS = 10 * 60_000; // how old a signature can be
const OFFICES_ABI = parseAbi(["function offices(address) view returns (bool, uint8, uint8, uint16, uint64, address, uint256, uint256, uint256)"]);
const MAGIC = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] };
const corsJson = (body, status = 200) =>
  Response.json(body, { status, headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });

export class Images extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const hash = url.pathname.split("/").pop();
      const img = /^[0-9a-f]{64}$/.test(hash) ? await this.ctx.storage.get(`img:${hash}`) : null;
      if (!img) return new Response("Not found", { status: 404 });
      return new Response(img.data, { headers: { "content-type": img.type } });
    }
    // An upload the Worker has checked: count it against the wallet's day, then keep it.
    const { wallet, hash, type, data } = await req.json();
    const day = Math.floor(Date.now() / 86_400_000), key = `up:${wallet}:${day}`;
    const n = (await this.ctx.storage.get(key)) ?? 0;
    if (!(await this.ctx.storage.get(`img:${hash}`))) {
      if (n >= UPLOADS_PER_DAY) return corsJson({ error: "That's enough pictures for today. Try again tomorrow." }, 429);
      await this.ctx.storage.put({ [`img:${hash}`]: { type, data: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) }, [key]: n + 1 });
    }
    return corsJson({ hash });
  }
}

async function padImage(req, env, url) {
  const images = env.IMAGES.get(env.IMAGES.idFromName("images"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } });
  }
  if (req.method === "GET") {
    const cache = caches.default, hit = await cache.match(req);
    if (hit) return hit;
    const r = await images.fetch(new Request(`https://images${url.pathname}`));
    if (!r.ok) return new Response("Not found", { status: 404, headers: { "access-control-allow-origin": "*" } });
    const out = new Response(r.body, {
      headers: { "content-type": r.headers.get("content-type"), "access-control-allow-origin": "*", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
    });
    await cache.put(req, out.clone());
    return out;
  }
  if (req.method !== "POST" || url.pathname !== "/pad/image") return new Response("Not found", { status: 404 });
  if (!ORIGINS.some((re) => re.test(req.headers.get("Origin") || ""))) return corsJson({ error: "Not allowed" }, 403);
  let body;
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "Send the picture as JSON." }, 400);
  }
  const { wallet, time, type, data, signature } = body ?? {};
  if (!isAddress(wallet ?? "") || !Number.isInteger(time) || typeof data !== "string" || typeof signature !== "string" || !IMAGE_TYPES.includes(type)) {
    return corsJson({ error: "That upload is missing something." }, 400);
  }
  if (Math.abs(Date.now() - time * 1000) > UPLOAD_WINDOW_MS) return corsJson({ error: "That signature has expired. Try again." }, 400);
  let buf;
  try {
    buf = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  } catch {
    return corsJson({ error: "That file isn't a picture." }, 400);
  }
  const magic = MAGIC[type];
  const isWebp = type !== "image/webp" || String.fromCharCode(...buf.slice(8, 12)) === "WEBP";
  if (!buf.length || buf.length > IMAGE_MAX_BYTES || !magic.every((b, i) => buf[i] === b) || !isWebp) {
    return corsJson({ error: "Use a JPG, PNG or WEBP picture under 160 KB." }, 400);
  }
  const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));
  let ok = false;
  try {
    ok = await verifyMessage({ address: wallet, message: imageMessage(wallet, hash, time), signature });
  } catch {}
  if (!ok) return corsJson({ error: "That signature didn't check out. Try again." }, 401);
  // Only players with a post office (the same rule as launching).
  try {
    const chain = createPublicClient({ transport: http(env.PAD_RPC ?? env.SKINS_RPC ?? "https://robinhood-rpc.publicnode.com") });
    const [open] = await chain.readContract({ address: env.POST_OFFICE, abi: OFFICES_ABI, functionName: "offices", args: [getAddress(wallet)] });
    if (!open) return corsJson({ error: "Open a post office first: only post office owners can launch." }, 403);
  } catch {
    return corsJson({ error: "Couldn't check your post office right now. Try again." }, 503);
  }
  const r = await images.fetch(new Request("https://images/put", {
    method: "POST", body: JSON.stringify({ wallet: wallet.toLowerCase(), hash, type, data }),
  }));
  const j = await r.json();
  if (!r.ok) return corsJson(j, r.status);
  return corsJson({ url: `${url.origin}/pad/image/${hash}` });
}

const polled = new Map(); // "/count" or "/names" -> { at, body }: what the room last said, kept a few seconds

// ---------------------------------------------------------------- the leaderboard's relay
// The same narrow relay as the website's /api/logs (web/api/logs.js), for hosts without it (the IMD backup): only
// the block number, the chain id and the post office's own events pass to Robinhood Chain's official RPC, which
// some internet providers block. Only for the game's own sites.
// The official RPC first; it turns Cloudflare's shared addresses away for event queries now and then (429), and
// then the website's own relay on Vercel answers instead (server to server, so a browser block on the website's
// domain doesn't matter).
const LOGS_UPSTREAMS = ["https://rpc.mainnet.chain.robinhood.com", "https://courierworld.fun/api/logs"];
async function logsRelay(req, env) {
  const origin = req.headers.get("Origin") || "";
  if (!ORIGINS.some((re) => re.test(origin))) return new Response("Not allowed", { status: 403 });
  const cors = { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", vary: "Origin" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const json = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
  });
  if (req.method !== "POST") return json({ error: "POST a JSON-RPC request" }, 405);
  const office = String(env.POST_OFFICE ?? "").toLowerCase();
  const allowed = (c) => c && typeof c === "object" && (c.method === "eth_blockNumber" || c.method === "eth_chainId" ||
    (c.method === "eth_getLogs" && office && String(c.params?.[0]?.address ?? "").toLowerCase() === office));
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Not JSON" }, 400);
  }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 20 || !calls.every(allowed)) return json({ error: "Not allowed" }, 403);
  // A range of the post office's events never changes once it's mined: kept at Cloudflare's edge (by the query,
  // not its id), so one visitor's scan of the history serves everyone's.
  const one = !Array.isArray(body) && body.method === "eth_getLogs";
  const cache = caches.default;
  let key = null;
  if (one) {
    const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body.params)))));
    key = new Request(`https://logs.cache/${hash}`);
    const hit = await cache.match(key).catch(() => null);
    if (hit) return json(JSON.stringify({ ...(await hit.json()), id: body.id }));
  }
  // Turned away (429) or broken (5xx): the other upstream, then both again after a pause.
  let r = null;
  for (let i = 0; i < 4; i++) {
    try {
      r = await fetch(LOGS_UPSTREAMS[i % 2], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status !== 429 && r.status < 500) break;
    } catch {
      r = null;
    }
    if (i % 2) await new Promise((ok) => setTimeout(ok, 500));
  }
  if (!r) return json({ error: "The chain didn't answer. Try again." }, 502);
  const text = await r.text();
  if (one && r.ok) {
    try {
      const out = JSON.parse(text);
      if (Array.isArray(out.result)) {
        await cache.put(key, new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "public, max-age=2592000" } }));
      }
    } catch {}
  }
  return json(text, r.status);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/pad/image")) return padImage(req, env, url);
    if (url.pathname === "/logs") return logsRelay(req, env);
    const room = env.PLANET.get(env.PLANET.idFromName("planet"));
    // The online count and the names are polled by every open game: kept a little while at Cloudflare's edge, so
    // the polls share one request to the room instead of each costing one (the free plan caps the room's
    // requests a day).
    if (url.pathname === "/count" || url.pathname === "/names") {
      const ttl = url.pathname === "/count" ? 15 : 30;
      const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": `public, max-age=${ttl}` };
      // In this Worker's memory first (it serves many requests), then Cloudflare's cache, then the room.
      const kept = polled.get(url.pathname);
      if (kept && Date.now() - kept.at < ttl * 1000) return new Response(kept.body, { headers });
      const key = new Request(`${url.origin}${url.pathname}`), cache = caches.default;
      const hit = await cache.match(key).catch(() => null);
      if (hit) return hit;
      const r = await room.fetch(`https://room${url.pathname}`);
      const body = await r.text();
      if (r.ok) {
        polled.set(url.pathname, { at: Date.now(), body });
        await cache.put(key, new Response(body, { headers })).catch(() => {});
      }
      return new Response(body, { status: r.status, headers });
    }
    if (url.pathname === "/ws") {
      if (!ORIGINS.some((re) => re.test(req.headers.get("Origin") || ""))) return new Response("Not allowed", { status: 403 });
      return room.fetch(req);
    }
    return new Response("Courier World multiplayer\n", { headers: { "content-type": "text/plain" } });
  },
};
