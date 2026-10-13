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
// their wallet address from then on.
import { DurableObject } from "cloudflare:workers";
import { verifyMessage, isAddress, getAddress, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import SPOTS from "../../web/hunt-spots.json";
import { HUNT_STAMPS, huntDay, authMessage } from "../../web/hunt-pick.js";
import { layDrops } from "../../web/drop-pick.js";
import { MOON_R, MOON_PRICE, MOON_PRICE_TEXT, MOON_TREASURY, MOON_SECS, MOON_STAMPS, MOON_SPOTS, MOON_REACH, MOON_REACH_UP, moonSpots } from "../../web/moon-pick.js";
import { cleanChat, CHAT_EVERY_MS } from "../../web/chat-rules.js";
import { cleanName, nameMessage, nameShown, NAME_EVERY_MS } from "../../web/name-rules.js";
import { imageMessage, IMAGE_MAX_BYTES, IMAGE_TYPES } from "../../web/pad-rules.js";

const R = 34; // the planet's radius, in metres (matches web/world.js)
const NEAR = Math.cos(40 / R); // players within 40 m (a dot product of their directions) get every update
const FAR_EVERY = 8; // everyone else gets one in eight
const MAX_PLAYERS = 200;
const MAX_MSG = 2048;
const PHRASES = 16; // emotes the game can show (web/net.js EMOTES); -1 is a wave

const ORIGINS = [/^https:\/\/(www\.)?courierworld\.fun$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const ENUMS = {
  hairStyle: ["pony", "bun", "bob", "twin", "long"],
  headwear: ["none", "cap", "bucket", "beanie", "headphones", "goggles", "hardhat"],
  bottomsStyle: ["shorts", "skirt", "pants"],
  bag: ["satchel", "backpack", "tote", "sack", "golden", "none"],
};
const COLOURS = ["skin", "hair", "shirt", "accent", "bottoms", "socks", "shoes"];
const RIDES = ["foot", "skate", "bike", "moped", "plane"];
const SKIN_SUPPLY = 999;
const SKINS_ABI = parseAbi(["function ownerOf(uint256) view returns (address)", "function designOf(uint256) view returns (uint256)"]);
const DROPS_ABI = parseAbi([
  "function activeDrops(uint32 day) view returns (uint256[])",
  "function drop(uint256 id) view returns ((address token, uint16 spots, uint16 maxPerWallet, uint32 startDay, uint32 endDay, uint256 perCoin, uint256 dailyCoins, uint256 left))",
  "function stamp() view returns (address)",
]);
const DROPS_CHECK_MS = 60_000; // how long the running drops are trusted before they're read again
const SKIN_CHECK_MS = 60_000; // how long a skin's owner is trusted before it's read again
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
const spotDir = SPOTS.map((p) => {
  const l = Math.hypot(p.x, p.y, p.z);
  return [p.x / l, p.y / l, p.z / l];
});
const arcBetween = (a, b, r = R) => r * Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // ERC-20 Transfer(from, to, value)
const MOON_TICKET_AGE = 3 * 3600; // seconds: how old a ticket's transaction can be
const HUNT_TOKEN_MS = 12 * 3600_000; // how long a browser can pick the hunt up again without signing
/// Which world a player is on: "moon", or the planet.
const worldOf = (a) => (a.world === "moon" ? "moon" : "planet");

const colour = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff) || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v));
const send = (ws, m) => {
  try {
    ws.send(typeof m === "string" ? m : JSON.stringify(m));
  } catch {}
};

/// A player's hello with anything unexpected dropped: a look built only from known keys and values,
/// a ride, their wallet address if they're logged in (shown on their name tag; not checked), and the
/// Courier Skin they'd like to wear (checked in `hi` before anyone sees it).
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
  return out;
}

/// Where a player is: ["s", x, y, z (their direction from the planet's centre), fx, fy, fz (which
/// way they face), height, jump, speed, swim, and from newer games vx, vy, vz, turn (how fast that
/// direction is changing, per second, and how fast it's turning, in radians a second, for the others to
/// predict them by between updates)], checked and with the direction made unit length. Older games'
/// updates get a velocity and turn of zero.
function cleanState(m) {
  if (m.length !== 11 && m.length !== 15) return null;
  const s = m.slice(1).map(Number);
  if (!s.every(Number.isFinite)) return null;
  const [x, y, z, fx, fy, fz, h, air, spd, swim, vx = 0, vy = 0, vz = 0, turn = 0] = s;
  const len = Math.hypot(x, y, z);
  if (len < 0.9 || len > 1.1 || Math.hypot(fx, fy, fz) > 1.1 || Math.abs(h) > 12 || air < 0 || air > 6 || spd < 0 || spd > 3 || swim < 0 || swim > 1) return null;
  const moving = Math.hypot(vx, vy, vz) * R <= TOP_SPEED && Math.abs(turn) <= 12;
  return [x / len, y / len, z / len, fx, fy, fz, h, air, spd, swim, ...(moving ? [vx, vy, vz, turn] : [0, 0, 0, 0])];
}

export class Planet extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // The game's keep-alive is answered without waking the room, so a quiet planet can sleep.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.seen = new Map(); // socket -> its attachment, read once after each wake
    this.skins = new Map(); // skin id -> { at, owner, design }
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
      if (!near || !s || world === "moon" || s[0] * near[0] + s[1] * near[1] + s[2] * near[2] > NEAR) send(ws, out);
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
      const s = cleanState(m);
      if (!s) return;
      // Faster than anyone can travel (a teleport, a script): count a strike; three, and this session's
      // finds stop counting. (On the moon, distances are on the moon.)
      const world = worldOf(a);
      if (a.s && a.sAt) {
        const secs = (now - a.sAt) / 1000;
        if (secs > 0.12 && arcBetween(a.s, s, world === "moon" ? MOON_R : R) / secs > TOP_SPEED) a.strikes = (a.strikes ?? 0) + 1;
      }
      a.firstAt ??= now;
      a.sAt = now;
      a.s = s;
      a.n = (a.n + 1) % FAR_EVERY;
      ws.serializeAttachment(a);
      // Only to those on the same world (everyone on the moon is near).
      const out = JSON.stringify(["s", a.id, ...s]);
      for (const o of this.others(ws)) {
        const oi = this.info(o), os = oi.s;
        if (worldOf(oi) !== world) continue;
        if (world === "moon" || a.n === 0 || !os || os[0] * s[0] + os[1] * s[1] + os[2] * s[2] > NEAR) send(o, out);
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
    if (m[0] === "auth" || m[0] === "resume" || m[0] === "hunt" || m[0] === "grab" || m[0] === "vouchers" || m[0] === "mgrab") return this.hunt(ws, a, m, now);
    if (m[0] === "moon") return this.moonTicket(ws, a, m[1], now);
    if (m[0] === "world") return this.goTo(ws, a, m[1], now);
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

  /// Who they are: their look, and the Courier Skin they asked to wear if it's theirs (its design number).
  async hi(ws, a, raw) {
    const hello = cleanHello(raw);
    if (!hello) return;
    const seq = (a.hiSeq = (a.hiSeq ?? 0) + 1);
    const id = hello.skinId;
    delete hello.skinId;
    // A different skin at most every two seconds, so nobody can make the room hammer the chain.
    if (id && (id === a.skinAsked || Date.now() - (a.skinAskedAt ?? 0) > 2000)) {
      [a.skinAsked, a.skinAskedAt] = [id, Date.now()];
      const design = await this.skinDesign(id, a.wallet ?? hello.addr);
      if (a.hiSeq !== seq) return; // a newer hello arrived while we were checking
      if (design !== null) hello.skin = design;
    }
    await this.decorate(hello, a);
    if (a.hiSeq !== seq) return;
    const first = !a.hello;
    a.hello = hello;
    ws.serializeAttachment(a);
    if (first) {
      const recent = (await this.chatLog()).filter((l) => Date.now() - l[3] < CHAT_RECENT_MS);
      // (Everyone starts on the planet; those on the moon come with where they are only for the moon.)
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
        this.chain ??= createPublicClient({ transport: http(this.env.SKINS_RPC ?? "https://robinhood-rpc.publicnode.com") });
        const read = (functionName) => this.chain.readContract({ address: this.env.SKINS_ADDRESS, abi: SKINS_ABI, functionName, args: [BigInt(id)] });
        const [who, design] = await Promise.all([read("ownerOf"), read("designOf")]);
        c = { at: Date.now(), owner: who, design: Number(design) };
        this.skins.set(id, c);
      } catch {
        return null;
      }
    }
    return c.owner.toLowerCase() === owner.toLowerCase() ? c.design : null;
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
      if (!a.wallet) return ["hunt", { on, day, wallet: null, found: [], coins: {}, moon: [], moonUntil: 0 }];
      const lay = layDrops(day, SPOTS.length, await this.dropsOn(day));
      const coins = {};
      for (const c of lay.coins) coins[c.drop] = [...(await this.finds(day, a.wallet, c.drop)).set];
      const moon = [...(await this.finds(day, a.wallet, "moon")).set];
      return ["hunt", { on, day, wallet: a.wallet, found: [...(await this.finds(day, a.wallet)).set], coins, moon, moonUntil: a.moonUntil ?? 0 }];
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
      a.wallet = getAddress(wallet);
      a.moonUntil = (await this.ctx.storage.get(`moon:${a.wallet}`)) ?? 0; // (a ticket bought before, still good)
      ws.serializeAttachment(a);
      // A token for this browser to pick the hunt up again on a new connection (a reload, a dropped line) without
      // signing again. It only counts finds for this wallet; claiming still takes the wallet itself.
      const token = randomHex(16);
      await this.ctx.storage.put(`htok:${a.wallet}`, { token, at: now });
      send(ws, ["hunttoken", token]);
      return send(ws, await state());
    }
    if (m[0] === "resume") {
      // ["resume", wallet, token]: the token we gave this browser when it signed in.
      const [, wallet, token] = m;
      if (typeof wallet !== "string" || !isAddress(wallet) || typeof token !== "string" || token.length > 64) return;
      const t = await this.ctx.storage.get(`htok:${getAddress(wallet)}`);
      if (!t || t.token !== token || now - t.at > HUNT_TOKEN_MS) return;
      a.wallet = getAddress(wallet);
      a.moonUntil = (await this.ctx.storage.get(`moon:${a.wallet}`)) ?? 0;
      ws.serializeAttachment(a);
      return send(ws, await state());
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
      if (!a.s || now - a.sAt > 4000 || now - a.firstAt < 5000) return nope("Keep exploring a moment, then try again.");
      const p = SPOTS[i], far = arcBetween(a.s, spotDir[i]), up = Math.abs(a.s[6] + 0.85 - p.h);
      if (far > REACH || up > REACH_UP) return nope("You weren't close enough to that one.");
      set.add(i);
      await this.ctx.storage.put(key, [...set]);
      return send(ws, ["found", day, i, set.size, owner]);
    }
    if (m[0] === "mgrab") {
      // ["mgrab", spot]: a moon stamp (an index into MOON_SPOTS) picked up, on the moon with a ticket.
      const i = m[1];
      const nope = (why) => send(ws, ["nope", i, why, "moon"]);
      if (!Number.isInteger(i) || !moonSpots(day).includes(i)) return nope("Nothing is out there today.");
      if (worldOf(a) !== "moon" || !(a.moonUntil > now)) return nope("Moon stamps count for couriers with a moon ticket.");
      const { key, set } = await this.finds(day, a.wallet, "moon");
      if (set.has(i)) return send(ws, ["found", day, i, set.size, "moon"]);
      if ((a.strikes ?? 0) >= 3) return nope("Something looked off with your movement, so finds aren't counting this session. Reload to try again.");
      if (!a.s || now - a.sAt > 4000 || now - a.firstAt < 5000) return nope("Keep exploring a moment, then try again.");
      const p = MOON_SPOTS[i], far = arcBetween(a.s, p.d, MOON_R), up = Math.abs(a.s[6] + 0.85 - p.h);
      if (far > MOON_REACH || up > MOON_REACH_UP) return nope("You weren't close enough to that one.");
      set.add(i);
      await this.ctx.storage.put(key, [...set]);
      return send(ws, ["found", day, i, set.size, "moon"]);
    }
    if (m[0] === "vouchers") {
      // ["vouchers"]: a signed note of each drop's finds, today's and yesterday's, for TokenDrops.claimMany.
      if (!on) return send(ws, ["nope", -1, "The treasure hunt isn't paying out yet."]);
      const signer = privateKeyToAccount(this.env.DROPS_KEY);
      const deadline = Math.floor(now / 1000) + VOUCHER_SECS;
      const out = [];
      for (const d of [day - 1, day]) {
        const lay = layDrops(d, SPOTS.length, await this.dropsOn(d));
        const wanted = lay.coins.map((c) => [c.drop, c.drop]);
        if (lay.golden.drop !== null) wanted.unshift([lay.golden.drop, "golden"]);
        for (const [drop, key] of wanted) {
          // (Golden stamps and moon stamps are paid by the same $STAMP drop.)
          const n = (await this.finds(d, a.wallet, key)).set.size + (key === "golden" ? (await this.finds(d, a.wallet, "moon")).set.size : 0);
          if (!n) continue;
          const coins = Math.min(n, key === "golden" ? HUNT_STAMPS + MOON_STAMPS : 65535);
          const signature = await signer.signTypedData({
            domain: { name: "Courier World Drops", version: "1", chainId: Number(this.env.DROPS_CHAIN_ID ?? 4663), verifyingContract: this.env.DROPS_ADDRESS },
            types: { Finds: [{ name: "player", type: "address" }, { name: "drop", type: "uint256" }, { name: "day", type: "uint32" }, { name: "coins", type: "uint16" }, { name: "deadline", type: "uint64" }] },
            primaryType: "Finds",
            message: { player: a.wallet, drop: BigInt(drop), day: d, coins, deadline: BigInt(deadline) },
          });
          out.push({ drop, day: d, coins, deadline, signature });
        }
      }
      if (!out.length) return send(ws, ["nope", -1, "Find a golden stamp or a coin first."]);
      return send(ws, ["vouchers", out]);
    }
  }

  // ---------------------------------------------------------------- the moon

  /// ["moon", txHash]: a ticket to the moon. It's good if that transaction (in the last few hours, and not used
  /// before) sent MOON_PRICE $STAMP from this player's signed-in wallet to the treasury; then the moon is theirs
  /// for MOON_SECS (kept, so a reload doesn't lose it).
  async moonTicket(ws, a, hash, now) {
    const no = (why) => send(ws, ["nope", -2, why]);
    if (!a.wallet) return no("Sign in to the hunt first, so the room knows your wallet.");
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return no("That isn't a transaction.");
    const key = `moonTx:${hash.toLowerCase()}`;
    this.moonChecking ??= new Set();
    if (this.moonChecking.has(key) || (await this.ctx.storage.get(key))) return no("That ticket has already been used.");
    this.moonChecking.add(key);
    try {
      if (this.env.MOON_DEV !== "1") {
        // (Only `wrangler dev` sets MOON_DEV, to try the moon without paying.)
        await this.dropsOn(huntDay(now)); // (reads $STAMP's address from the drops contract)
        if (!this.chain || !this.dropStamp) return no("The moon isn't open right now. Try again soon.");
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
          addr(l.topics[1]) === a.wallet.toLowerCase() && addr(l.topics[2]) === MOON_TREASURY.toLowerCase() && BigInt(l.data) >= MOON_PRICE);
        if (!paid) return no(`That transaction didn't send ${MOON_PRICE_TEXT} $STAMP from your wallet to the treasury.`);
        const block = await this.chain.getBlock({ blockNumber: receipt.blockNumber });
        if (now / 1000 - Number(block.timestamp) > MOON_TICKET_AGE) return no("That ticket is too old.");
      }
      const until = now + MOON_SECS * 1000;
      await this.ctx.storage.put(key, a.wallet);
      await this.ctx.storage.put(`moon:${a.wallet}`, until);
      a.moonUntil = until;
      ws.serializeAttachment(a);
      send(ws, ["moonok", until]);
    } catch {
      no("Couldn't check that ticket. Try again in a moment.");
    } finally {
      this.moonChecking.delete(key);
    }
  }

  /// ["world", "moon" | "planet"]: off to the moon (with a ticket) or home. Everyone hears, so they can draw them
  /// on the right world; where they were is forgotten (it was on the other one).
  goTo(ws, a, w, now) {
    if (w !== "moon" && w !== "planet") return;
    if (w === "moon" && !(a.moonUntil > now)) return send(ws, ["nope", -2, "You need a moon ticket for that."]);
    if (worldOf(a) === w) return;
    a.world = w === "moon" ? "moon" : undefined;
    a.s = null;
    a.sAt = 0;
    ws.serializeAttachment(a);
    if (a.hello) this.broadcast(ws, ["world", a.id, w]);
    // Where everyone already there is (those standing still don't send it again).
    send(ws, ["here", this.others(ws).flatMap((o) => {
      const oi = this.info(o);
      return worldOf(oi) === w && oi.s ? [[oi.id, oi.s]] : [];
    })]);
  }

  webSocketClose(ws, code) {
    this.left(ws);
    try {
      ws.close(code >= 1000 && code < 1004 ? code : 1000, "Bye");
    } catch {}
  }
  webSocketError(ws) {
    this.left(ws);
  }
  left(ws) {
    const a = this.info(ws);
    this.seen.delete(ws);
    if (a?.hello) this.broadcast(ws, ["leave", a.id]);
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/pad/image")) return padImage(req, env, url);
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
