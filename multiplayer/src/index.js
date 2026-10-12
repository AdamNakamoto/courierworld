// Courier World multiplayer. One Durable Object holds the planet's room: each player says who they
// are (their courier's look and ride, and a name), then sends where they are a few times a second
// while moving. The room passes that on to the players near them, and now and then to everyone
// else, so the far side of the planet still knows who's about. Waves and preset phrases go to the
// players nearby, and chat lines (text only: no links) to everyone. It also runs the golden stamp
// hunt: a hunter signs in with their wallet, the room checks each find against where they've
// actually been, and signs vouchers the StampHunt contract pays $STAMP for. Positions and emotes are just for show; only the vouchers touch the chain. A player
// wearing a Courier Skin is shown in it only once the room has read on-chain that their wallet owns it.
// Players can take their X handle as their name: they sign in to X here (/x/login), then sign with their
// wallet in the game, and the room shows them as @handle from then on.
import { DurableObject } from "cloudflare:workers";
import { verifyMessage, isAddress, getAddress, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import SPOTS from "../../web/hunt-spots.json";
import { HUNT_STAMPS, huntDay, pickSpots, authMessage } from "../../web/hunt-pick.js";
import { cleanChat, CHAT_EVERY_MS } from "../../web/chat-rules.js";
import { X_HANDLE, claimMessage } from "../../web/x-claim.js";

const R = 34; // the planet's radius, in metres (matches web/world.js)
const NEAR = Math.cos(40 / R); // players within 40 m (a dot product of their directions) get every update
const FAR_EVERY = 8; // everyone else gets one in eight
const MAX_PLAYERS = 200;
const MAX_MSG = 2048;
const PHRASES = 16; // emotes the game can show (web/net.js EMOTES); -1 is a wave

const ORIGINS = [/^https:\/\/(www\.)?courierworld\.fun$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// Where an X sign-in may send its claim back to: the game itself (or your own machine, for development),
// never any other site, which could pass someone's handle to a wallet of its own.
const X_BACK = [/^https:\/\/(www\.)?courierworld\.fun$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
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
const SKIN_CHECK_MS = 60_000; // how long a skin's owner is trusted before it's read again
const CHAT_KEEP = 30; // chat lines kept for players who join later
const CHAT_RECENT_MS = 60 * 60_000; // ...if they're less than an hour old
const CHAT_ROOM_MAX = 20; // lines from everyone together every five seconds
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Names from X. X's OAuth 2.0 sign-in (with PKCE) tells us who they are on X; nothing is posted and the
// token is let go straight away. A sign-in has this long to finish, and its claim this long to be signed.
const X_AUTHORIZE = "https://x.com/i/oauth2/authorize", X_API = "https://api.x.com";
const X_STEP_MS = 10 * 60_000;
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
/// A plain page, for the few times the X sign-in can't send them back to the game.
const page = (text, status) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Courier World</title>` +
    `<body style="font:18px/1.4 system-ui,sans-serif;background:#f7f1e3;color:#283033;max-width:520px;margin:auto;padding:32px 16px">${text}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } });

// The hunt: how close (in metres, and in height) a hunter's last reported position must be to a stamp
// for the find to count, the fastest anyone moves (paper plane, running: ~13 m/s; this allows lag),
// and how long a voucher lasts.
const REACH = 3.2, REACH_UP = 1.6, TOP_SPEED = 22, VOUCHER_SECS = 3600;
const spotDir = SPOTS.map((p) => {
  const l = Math.hypot(p.x, p.y, p.z);
  return [p.x / l, p.y / l, p.z / l];
});
const arcBetween = (a, b) => R * Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

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
/// way they face), height, jump, speed, swim], checked and with the direction made unit length.
function cleanState(m) {
  if (m.length !== 11) return null;
  const s = m.slice(1).map(Number);
  if (!s.every(Number.isFinite)) return null;
  const [x, y, z, fx, fy, fz, h, air, spd, swim] = s;
  const len = Math.hypot(x, y, z);
  if (len < 0.9 || len > 1.1 || Math.hypot(fx, fy, fz) > 1.1 || Math.abs(h) > 12 || air < 0 || air > 6 || spd < 0 || spd > 3 || swim < 0 || swim > 1) return null;
  return [x / len, y / len, z / len, fx, fy, fz, h, air, spd, swim];
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
  broadcast(from, m, near = null) {
    const out = JSON.stringify(m);
    for (const ws of this.others(from)) {
      const s = this.info(ws).s;
      if (!near || !s || s[0] * near[0] + s[1] * near[1] + s[2] * near[2] > NEAR) send(ws, out);
    }
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/count") return Response.json({ online: this.others(null).length });
    if (url.pathname === "/names") return Response.json({ on: this.xOn(), names: Object.fromEntries(await this.names()) });
    if (url.pathname === "/x/login") return this.xLogin(req, url);
    if (url.pathname === "/x/callback") return this.xCallback(url);
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
      // finds stop counting.
      if (a.s && a.sAt) {
        const secs = (now - a.sAt) / 1000;
        if (secs > 0.12 && arcBetween(a.s, s) / secs > TOP_SPEED) a.strikes = (a.strikes ?? 0) + 1;
      }
      a.firstAt ??= now;
      a.sAt = now;
      a.s = s;
      a.n = (a.n + 1) % FAR_EVERY;
      ws.serializeAttachment(a);
      const out = JSON.stringify(["s", a.id, ...s]);
      for (const o of this.others(ws)) {
        const os = this.info(o).s;
        if (a.n === 0 || !os || os[0] * s[0] + os[1] * s[1] + os[2] * s[2] > NEAR) send(o, out);
      }
      return;
    }
    if (m[0] === "say") {
      const i = m[1];
      if (Number.isInteger(i) && i >= -1 && i < PHRASES) this.broadcast(ws, ["say", a.id, i], a.s);
      return;
    }
    if (m[0] === "chat") return this.chat(ws, a, m[1], now);
    if (m[0] === "claim" || m[0] === "name" || m[0] === "unname") return this.naming(ws, a, m);
    if (m[0] === "auth" || m[0] === "hunt" || m[0] === "grab" || m[0] === "voucher") return this.hunt(ws, a, m, now);
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

  // ---------------------------------------------------------------- names from X

  xOn() {
    return !!(this.env.X_CLIENT_ID && this.env.X_CLIENT_SECRET);
  }
  /// Every claimed name: wallet (lower case) -> X handle.
  async names() {
    return (this.nameList ??= new Map([...(await this.ctx.storage.list({ prefix: "name:" }))].map(([k, v]) => [k.slice(5), v.handle])));
  }
  /// Put their @handle on a hello, if the room knows their wallet is theirs and they've claimed one.
  async decorate(hello, a) {
    delete hello.name;
    const handle = a.named && hello.addr?.toLowerCase() === a.named ? (await this.names()).get(a.named) : null;
    if (handle) hello.name = `@${handle}`;
  }
  /// Their name changed (claimed, moved to another wallet, or unlinked): update everyone's view of them.
  async renamed(ws, a) {
    if (!a.hello) return;
    await this.decorate(a.hello, a);
    ws.serializeAttachment(a);
    this.broadcast(ws, ["look", a.id, a.hello]);
  }
  /// Drop sign-ins and claims that were never finished.
  async dropExpired(prefix) {
    const now = Date.now();
    const dead = [...(await this.ctx.storage.list({ prefix, limit: 200 }))].filter(([, v]) => !(v?.exp > now)).map(([k]) => k);
    if (dead.length) await this.ctx.storage.delete(dead.slice(0, 128));
  }

  /// The game's "Claim your name" button opens this: off to X to sign in, coming back to /x/callback.
  async xLogin(req, url) {
    if (!this.xOn()) return page("Claiming a name with X isn't open yet. Check back soon.", 503);
    const back = url.searchParams.get("back") ?? "";
    if (!X_BACK.some((re) => re.test(back))) return page("Not allowed.", 403);
    // A few sign-ins a minute from one address at most.
    const ip = req.headers.get("CF-Connecting-IP") ?? "", now = Date.now();
    this.xTries ??= new Map();
    if (this.xTries.size > 5000) this.xTries.clear();
    const t = this.xTries.get(ip);
    if (t && now - t.at < 60_000 && t.n >= 10) return page("Too many tries. Wait a minute, then try again.", 429);
    this.xTries.set(ip, t && now - t.at < 60_000 ? { at: t.at, n: t.n + 1 } : { at: now, n: 1 });
    await this.dropExpired("xstate:");
    const state = randomHex(16), verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await this.ctx.storage.put(`xstate:${state}`, { verifier, back, exp: now + X_STEP_MS });
    const q = new URLSearchParams({
      response_type: "code", client_id: this.env.X_CLIENT_ID, redirect_uri: `${url.origin}/x/callback`, scope: "tweet.read users.read",
      state, code_challenge: b64url(await sha256(verifier)), code_challenge_method: "S256",
    });
    return Response.redirect(`${this.env.X_AUTHORIZE ?? X_AUTHORIZE}?${String(q).replace(/\+/g, "%20")}`, 302); // (scopes split by %20, as X's docs have it)
  }

  /// X sends them back here. Find out who they are on X, then send them back to the game (x.html) with
  /// a claim for their wallet to sign.
  async xCallback(url) {
    const state = url.searchParams.get("state") ?? "";
    const st = /^[0-9a-f]{32}$/.test(state) ? await this.ctx.storage.get(`xstate:${state}`) : null;
    if (!st || !(st.exp > Date.now())) return page("That sign-in took too long. Go back to Courier World and try again.", 400);
    await this.ctx.storage.delete(`xstate:${state}`);
    const back = (result) => Response.redirect(`${st.back}/x.html#${new URLSearchParams(result)}`, 302);
    const code = url.searchParams.get("code");
    if (!code) return back({ error: "cancelled" });
    try {
      const api = this.env.X_API ?? X_API, basic = `Basic ${btoa(`${this.env.X_CLIENT_ID}:${this.env.X_CLIENT_SECRET}`)}`;
      const form = { authorization: basic, "content-type": "application/x-www-form-urlencoded" };
      const tr = await fetch(`${api}/2/oauth2/token`, {
        method: "POST", headers: form,
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${url.origin}/x/callback`, code_verifier: st.verifier, client_id: this.env.X_CLIENT_ID }),
      });
      const token = tr.ok ? (await tr.json()).access_token : null;
      if (typeof token !== "string") throw new Error(`token: ${tr.status}`);
      const ur = await fetch(`${api}/2/users/me`, { headers: { authorization: `Bearer ${token}` } });
      const user = ur.ok ? (await ur.json()).data : null;
      // That's all we needed: let the token go.
      await fetch(`${api}/2/oauth2/revoke`, { method: "POST", headers: form, body: new URLSearchParams({ token, token_type_hint: "access_token" }) }).catch(() => {});
      if (!X_HANDLE.test(user?.username ?? "") || !/^\d{1,30}$/.test(user?.id ?? "")) throw new Error(`users/me: ${ur.status}`);
      await this.dropExpired("xclaim:");
      const claim = randomHex(16);
      await this.ctx.storage.put(`xclaim:${claim}`, { xid: user.id, handle: user.username, exp: Date.now() + X_STEP_MS });
      return back({ claim, handle: user.username });
    } catch (e) {
      console.error("X sign-in failed:", e.message);
      return back({ error: "failed" });
    }
  }

  /// ["claim", claim, wallet, signature]: their wallet signed claimMessage for an X sign-in, so that
  /// wallet takes the handle (and gets a token, so the game can show the name on later visits without
  /// signing again). ["name", token]: a later visit. ["unname"]: back to their wallet address.
  async naming(ws, a, m) {
    const S = this.ctx.storage;
    if (m[0] === "claim") {
      const [, claim, wallet, signature] = m;
      if (typeof claim !== "string" || !/^[0-9a-f]{32}$/.test(claim) || typeof wallet !== "string" || !isAddress(wallet) ||
        typeof signature !== "string" || signature.length > 200) return;
      const c = await S.get(`xclaim:${claim}`);
      if (!c || !(c.exp > Date.now())) return send(ws, ["nameno", "That X sign-in has expired. Connect X again."]);
      let ok = false;
      try {
        ok = await verifyMessage({ address: wallet, message: claimMessage(wallet, c.handle, claim), signature });
      } catch {}
      if (!ok) return send(ws, ["nameno", "That signature didn't check out. Try again."]);
      await S.delete(`xclaim:${claim}`);
      const w = wallet.toLowerCase();
      // One wallet per X account, and one X account per wallet: claiming again moves the name.
      const was = await S.get(`xid:${c.xid}`), had = await S.get(`name:${w}`);
      if (was && was !== w) await S.delete(`name:${was}`);
      if (had && had.xid !== c.xid) await S.delete(`xid:${had.xid}`);
      const token = randomHex(32);
      await S.put({ [`name:${w}`]: { xid: c.xid, handle: c.handle, at: Date.now() }, [`xid:${c.xid}`]: w, [`tok:${hex(await sha256(token))}`]: w });
      this.nameList = null;
      a.named = w;
      for (const o of this.ctx.getWebSockets()) {
        const oa = this.info(o);
        if (o === ws || !oa?.named || (oa.named !== w && oa.named !== was)) continue;
        await this.renamed(o, oa);
        send(o, ["named", oa.named === w ? { handle: c.handle, wallet: w } : null]);
      }
      await this.renamed(ws, a);
      ws.serializeAttachment(a);
      return send(ws, ["named", { handle: c.handle, wallet: w, token }]);
    }
    if (m[0] === "name") {
      const token = m[1];
      if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return;
      const w = await S.get(`tok:${hex(await sha256(token))}`);
      const handle = w ? (await this.names()).get(w) : null;
      if (w) a.named = w; // the token was given to this wallet, so it's theirs either way
      ws.serializeAttachment(a);
      if (handle) await this.renamed(ws, a);
      return send(ws, ["named", handle ? { handle, wallet: w } : null]);
    }
    if (m[0] === "unname" && a.named) {
      const w = a.named, n = await S.get(`name:${w}`);
      if (n) await S.delete([`name:${w}`, `xid:${n.xid}`]);
      this.nameList = null;
      for (const o of this.ctx.getWebSockets()) {
        const oa = this.info(o);
        if (oa?.named !== w) continue;
        await this.renamed(o, oa);
        send(o, ["named", null]);
      }
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
      send(ws, ["welcome", a.id, this.others(ws).map((o) => [this.info(o).id, this.info(o).hello, this.info(o).s]), a.code, recent]);
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

  /// Today's finds for a wallet (kept in storage, so they survive the room sleeping).
  async finds(day, wallet) {
    this.found ??= new Map();
    const key = `hunt:${day}:${wallet}`;
    if (!this.found.has(key)) this.found.set(key, new Set((await this.ctx.storage.get(key)) ?? []));
    return { key, set: this.found.get(key) };
  }

  async hunt(ws, a, m, now) {
    const on = !!(this.env.HUNT_KEY && this.env.HUNT_ADDRESS);
    const day = huntDay(now);
    const state = async () => ["hunt", { on, day, wallet: a.wallet ?? null, found: a.wallet ? [...(await this.finds(day, a.wallet)).set] : [] }];

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
      ws.serializeAttachment(a);
      return send(ws, await state());
    }
    if (m[0] === "hunt") return send(ws, await state());
    if (!a.wallet) return send(ws, ["nope", -1, "Sign in with your wallet to hunt for $STAMP."]);

    if (m[0] === "grab") {
      // ["grab", spot]: they say they've just picked up the stamp at that spot. Check they were there.
      const i = m[1];
      const nope = (why) => send(ws, ["nope", i, why]);
      if (!Number.isInteger(i) || !pickSpots(day, SPOTS.length).includes(i)) return nope("That stamp isn't out today.");
      const { key, set } = await this.finds(day, a.wallet);
      if (set.has(i)) return send(ws, ["found", day, i, set.size]);
      if ((a.strikes ?? 0) >= 3) return nope("Something looked off with your movement, so finds aren't counting this session. Reload to try again.");
      if (!a.s || now - a.sAt > 4000 || now - a.firstAt < 5000) return nope("Keep exploring a moment, then try again.");
      const p = SPOTS[i], far = arcBetween(a.s, spotDir[i]), up = Math.abs(a.s[6] + 0.85 - p.h);
      if (far > REACH || up > REACH_UP) return nope("You weren't close enough to that stamp.");
      set.add(i);
      await this.ctx.storage.put(key, [...set]);
      return send(ws, ["found", day, i, set.size]);
    }
    if (m[0] === "voucher") {
      // ["voucher"]: a signed note of today's finds, for the StampHunt contract.
      if (!on) return send(ws, ["nope", -1, "The stamp hunt isn't open yet."]);
      const { set } = await this.finds(day, a.wallet);
      if (!set.size) return send(ws, ["nope", -1, "Find a golden stamp first."]);
      const stamps = Math.min(set.size, HUNT_STAMPS), deadline = Math.floor(now / 1000) + VOUCHER_SECS;
      const signer = privateKeyToAccount(this.env.HUNT_KEY);
      const signature = await signer.signTypedData({
        domain: { name: "Courier World Stamp Hunt", version: "1", chainId: Number(this.env.HUNT_CHAIN_ID ?? 4663), verifyingContract: this.env.HUNT_ADDRESS },
        types: { Finds: [{ name: "player", type: "address" }, { name: "day", type: "uint32" }, { name: "stamps", type: "uint16" }, { name: "deadline", type: "uint64" }] },
        primaryType: "Finds",
        message: { player: a.wallet, day, stamps, deadline: BigInt(deadline) },
      });
      return send(ws, ["voucher", { day, stamps, deadline, signature }]);
    }
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const room = env.PLANET.get(env.PLANET.idFromName("planet"));
    if (url.pathname === "/count") {
      const r = await room.fetch("https://room/count");
      return new Response(r.body, { headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "max-age=10" } });
    }
    if (url.pathname === "/names") {
      const r = await room.fetch("https://room/names");
      return new Response(r.body, { headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "max-age=20" } });
    }
    if (url.pathname === "/x/login" || url.pathname === "/x/callback") return room.fetch(req);
    if (url.pathname === "/ws") {
      if (!ORIGINS.some((re) => re.test(req.headers.get("Origin") || ""))) return new Response("Not allowed", { status: 403 });
      return room.fetch(req);
    }
    return new Response("Courier World multiplayer\n", { headers: { "content-type": "text/plain" } });
  },
};
