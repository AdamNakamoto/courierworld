// Courier World multiplayer. One Durable Object holds the planet's room: each player says who they
// are (their courier's look and ride, and a name), then sends where they are a few times a second
// while moving. The room passes that on to the players near them, and now and then to everyone
// else, so the far side of the planet still knows who's about. Waves and preset phrases go to the
// players nearby. It also runs the golden stamp hunt: a hunter signs in with their wallet, the room
// checks each find against where they've actually been, and signs vouchers the StampHunt contract
// pays $STAMP for. Positions and emotes are just for show; only the vouchers touch the chain. A player
// wearing a Courier Skin is shown in it only once the room has read on-chain that their wallet owns it.
import { DurableObject } from "cloudflare:workers";
import { verifyMessage, isAddress, getAddress, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import SPOTS from "../../web/hunt-spots.json";
import { HUNT_STAMPS, huntDay, pickSpots, authMessage } from "../../web/hunt-pick.js";

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
const SKIN_CHECK_MS = 60_000; // how long a skin's owner is trusted before it's read again

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
    if (new URL(req.url).pathname === "/count") return Response.json({ online: this.others(null).length });
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
    if (m[0] === "auth" || m[0] === "hunt" || m[0] === "grab" || m[0] === "voucher") return this.hunt(ws, a, m, now);
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
    const first = !a.hello;
    a.hello = hello;
    ws.serializeAttachment(a);
    if (first) {
      send(ws, ["welcome", a.id, this.others(ws).map((o) => [this.info(o).id, this.info(o).hello, this.info(o).s]), a.code]);
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
    if (url.pathname === "/ws") {
      if (!ORIGINS.some((re) => re.test(req.headers.get("Origin") || ""))) return new Response("Not allowed", { status: 403 });
      return room.fetch(req);
    }
    return new Response("Courier World multiplayer\n", { headers: { "content-type": "text/plain" } });
  },
};
