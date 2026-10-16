// Times Square: the town crossing farthest from the post office becomes a square of tall towers covered in
// giant screens, with red steps to sit on, a bronze courier on a plinth, parked cabs and a tour bus.
//
// The houses, shops, park and poles that were there are still drawn at random and keep their places in
// the town (see "left out" in world.js), so nothing anywhere else moves: each building's footprint, door
// and residents stay, under a tower, and the treasure hunt's spots and the players' lots are kept clear.
//
// The screens show posters for the game and for shows that only play on this planet; a few show the ad
// that's on the Orb (orb.json) at the time. None of them name a real brand. One poster shows the biggest
// tokens players launched in the Launchpad, on the corner tower's ground floor (pad.js), and the ticker
// carries them too; tokens on the game's hide list never show. While the treasury drops a token's coins
// round the planet, the hunt poster, a banner on the Launchpad's and the ticker say so.
import * as THREE from "https://esm.sh/three@0.160.0";

export const SQUARE_R = 13; // metres from the crossing that the square covers
const L_CHANNELS = 6, P_CHANNELS = 4, CYCLE = 8; // landscape and portrait screens taking turns; seconds per poster

// ---------------------------------------------------------------- posters

const BUNGEE = "Bungee, Impact, sans-serif", HAND = '"Patrick Hand", "Comic Sans MS", sans-serif', SERIF = 'Georgia, "Times New Roman", serif';
const bungee = (s) => `400 ${s}px ${BUNGEE}`, hand = (s) => `400 ${s}px ${HAND}`;
const serif = (s, style = "700") => `${style} ${s}px ${SERIF}`, italic = (s) => `italic 700 ${s}px ${SERIF}`;

/// Write `text` centred at (x, y), as big as `size` but no wider than `max`.
function say(g, text, x, y, max, size, font, color) {
  let s = size;
  for (; s > 6; s -= 2) {
    g.font = font(s);
    if (g.measureText(text).width <= max) break;
  }
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, x, y);
  return s;
}
const fill = (g, w, h, color) => {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
};
const gradient = (g, w, h, a, b, across = false) => {
  const gr = g.createLinearGradient(0, 0, across ? w : 0, across ? 0 : h);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
};
function envelope(g, cx, cy, ew, eh, body, line) {
  g.fillStyle = body;
  g.fillRect(cx - ew / 2, cy - eh / 2, ew, eh);
  g.strokeStyle = line;
  g.lineWidth = Math.max(2, ew * 0.04);
  g.beginPath();
  g.moveTo(cx - ew / 2, cy - eh / 2);
  g.lineTo(cx, cy + eh * 0.08);
  g.lineTo(cx + ew / 2, cy - eh / 2);
  g.stroke();
}
function star(g, cx, cy, r, color) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.fill();
}
/// Faint lines between the LEDs, so a poster reads as a screen.
function leds(g, w, h) {
  g.fillStyle = "rgba(0,0,0,0.13)";
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
}

/// "$PEPE", or "$PEPE + $LCAT": the tokens a running drop is paying out.
const dropSymbols = (drops) => [...new Set(drops.map((d) => `$${d.symbol}`))].slice(0, 2).join(" + ");
/// The drop the posters feature: the newest one running.
const featured = (drops) => drops[drops.length - 1];
const tokens = (wei, compact = true) =>
  new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }).format(Number(wei) / 1e18);
/// "30M $PEPE": a drop's size and token (or just its token, before its size is known).
const dropTitle = (d) => (d.size ? `${tokens(d.size)} $${d.symbol}` : `$${d.symbol}`);
/// Wallets a drop pays in full each day.
const paidDaily = (d) => Math.floor(Number(d.dailyCoins) / Math.max(1, Number(d.maxPerWallet)));
/// A gold coin at (cx, cy) with a token's picture on its face (or its symbol, until the picture loads).
function coin(g, cx, cy, r, d) {
  const disc = (rr, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.fill();
  };
  disc(r, "#a8740a");
  disc(r * 0.92, "#f2c94c");
  disc(r * 0.76, "#ffe27a");
  if (d.picture) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    g.clip();
    g.drawImage(d.picture, cx - r * 0.72, cy - r * 0.72, r * 1.44, r * 1.44);
    g.restore();
  } else say(g, d.symbol.slice(0, 4), cx, cy + r * 0.04, r * 1.2, r * 0.5, bungee, "#a8740a");
}
/// A red "LIVE NOW" badge centred at (cx, cy), its letters `size` high.
function liveBadge(g, cx, cy, size) {
  g.font = bungee(size);
  const bw = g.measureText("LIVE NOW").width + size * 2.1, bh = size * 1.55;
  g.fillStyle = "#e8364a";
  g.beginPath();
  g.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, bh / 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(cx - bw / 2 + size * 0.8, cy, size * 0.22, 0, Math.PI * 2);
  g.fill();
  say(g, "LIVE NOW", cx + size * 0.32, cy + 1, bw, size, bungee, "#ffffff");
}
/// A token drop's poster: the newest drop running, its size, its coins out every day and what they pay.
function coinDrop(g, w, h, wide, drops) {
  gradient(g, w, h, "#0d3b66", "#0b1f3a");
  for (let i = 0; i < 14; i++) star(g, ((i * 61 + 17) % 100) / 100 * w, ((i * 29 + 11) % 100) / 100 * h, Math.min(w, h) * (0.012 + (i % 3) * 0.008), "#ffd23f");
  const d = featured(drops), sym = `$${d.symbol}`;
  const each = d.perCoin ? `${tokens(d.perCoin, false)} ${sym} A COIN` : "", daily = d.dailyCoins ? `${paidDaily(d)} COURIERS PAID DAILY` : "";
  if (wide) {
    coin(g, w * 0.19, h * 0.5, h * 0.33, d);
    const tx = w * 0.65, tw = w * 0.62;
    say(g, d.size ? dropTitle(d) : `COLLECT ${sym}`, tx, h * 0.17, tw * 0.98, h * 0.24, bungee, "#ffd23f");
    say(g, "TREASURE HUNT", tx, h * 0.36, tw * 0.8, h * 0.11, bungee, "#ffffff");
    liveBadge(g, tx, h * 0.53, h * 0.085);
    say(g, d.spots ? `${d.spots} COINS HIDDEN EVERY DAY` : "FIND THEM ROUND THE PLANET", tx, h * 0.69, tw * 0.95, h * 0.085, bungee, "#ffffff");
    say(g, [each, daily].filter(Boolean).join(" · "), tx, h * 0.8, tw * 0.95, h * 0.07, hand, "#ffe27a");
    say(g, "POST OFFICE OWNERS REDEEM", tx, h * 0.91, tw * 0.86, h * 0.055, bungee, "#7ef0ff");
  } else {
    coin(g, w / 2, h * 0.19, w * 0.32, d);
    say(g, d.size ? tokens(d.size) : "COLLECT", w / 2, h * 0.41, w * 0.9, h * 0.11, bungee, "#ffd23f");
    say(g, sym, w / 2, h * 0.5, w * 0.8, h * 0.065, bungee, "#ffd23f");
    say(g, "TREASURE HUNT", w / 2, h * 0.575, w * 0.9, h * 0.045, bungee, "#ffffff");
    liveBadge(g, w / 2, h * 0.655, h * 0.038);
    say(g, d.spots ? `${d.spots} COINS EVERY DAY` : "FIND THEM ROUND THE PLANET", w / 2, h * 0.745, w * 0.9, h * 0.04, bungee, "#ffffff");
    if (each) say(g, each, w / 2, h * 0.805, w * 0.92, h * 0.036, hand, "#ffe27a");
    if (daily) say(g, daily, w / 2, h * 0.855, w * 0.92, h * 0.036, hand, "#ffe27a");
    say(g, "POST OFFICE OWNERS REDEEM", w / 2, h * 0.93, w * 0.9, h * 0.03, bungee, "#7ef0ff");
  }
}

/// Each poster draws itself to fit a landscape (wide) or portrait canvas. `img` holds the pictures it uses.
const POSTERS = [
  // Shows that only play here.
  function letterKing(g, w, h, wide) {
    fill(g, w, h, "#f6c90e");
    const sx = wide ? w * 0.75 : w / 2, sy = wide ? h * 0.5 : h * 0.33, sr = Math.min(w, h) * (wide ? 0.42 : 0.4);
    const gr = g.createRadialGradient(sx, sy, sr * 0.1, sx, sy, sr);
    gr.addColorStop(0, "#ffe27a");
    gr.addColorStop(1, "#f08a24");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(sx, sy, sr, 0, Math.PI * 2);
    g.fill();
    envelope(g, sx, sy + sr * 0.12, sr * 1.0, sr * 0.62, "#4a230f", "#f6c90e");
    g.fillStyle = "#4a230f";
    g.beginPath();
    const cw = sr * 0.6, cy = sy - sr * 0.2;
    g.moveTo(sx - cw / 2, cy);
    g.lineTo(sx - cw / 2, cy - sr * 0.28);
    g.lineTo(sx - cw / 4, cy - sr * 0.12);
    g.lineTo(sx, cy - sr * 0.34);
    g.lineTo(sx + cw / 4, cy - sr * 0.12);
    g.lineTo(sx + cw / 2, cy - sr * 0.28);
    g.lineTo(sx + cw / 2, cy);
    g.fill();
    const tx = wide ? w * 0.29 : w / 2, ty = wide ? h * 0.36 : h * 0.72;
    say(g, "THE LETTER", tx, ty, (wide ? w * 0.5 : w) * 0.9, h * 0.16, bungee, "#4a230f");
    say(g, "KING", tx, ty + h * (wide ? 0.2 : 0.1), (wide ? w * 0.5 : w) * 0.9, h * (wide ? 0.26 : 0.13), bungee, "#4a230f");
    say(g, "JOIN THE CIRCLE OF MAIL", tx, ty + h * (wide ? 0.4 : 0.2), (wide ? w * 0.5 : w) * 0.9, h * 0.08, hand, "#7a3a12");
  },
  function mailAMia(g, w, h, wide) {
    gradient(g, w, h, "#2b6fd6", "#163f8f");
    for (let i = 0; i < 26; i++) star(g, ((i * 97) % 100) / 100 * w, ((i * 61) % 100) / 100 * h, Math.min(w, h) * 0.025, i % 3 ? "#ffd23f" : "#ff8ac2");
    g.save();
    g.shadowColor = "#ffd23f";
    g.shadowOffsetX = g.shadowOffsetY = 4;
    say(g, "MAIL-A-MIA!", w / 2, h * (wide ? 0.45 : 0.42), w * 0.9, h * (wide ? 0.32 : 0.16), bungee, "#ffffff");
    g.restore();
    say(g, "THE SUNNIEST MUSICAL IN TOWN", w / 2, h * (wide ? 0.78 : 0.6), w * 0.86, h * (wide ? 0.11 : 0.055), hand, "#ffe9a8");
  },
  function phantom(g, w, h, wide) {
    fill(g, w, h, "#0d0d10");
    const mx = wide ? w * 0.27 : w / 2, my = wide ? h / 2 : h * 0.32, mr = Math.min(w, h) * (wide ? 0.34 : 0.32);
    g.fillStyle = "#f4f1ea";
    g.beginPath();
    g.ellipse(mx, my, mr * 0.75, mr, 0, -Math.PI / 2, Math.PI / 2, true);
    g.closePath();
    g.fill();
    g.fillStyle = "#0d0d10";
    g.beginPath();
    g.ellipse(mx - mr * 0.3, my - mr * 0.15, mr * 0.18, mr * 0.11, 0, 0, Math.PI * 2);
    g.fill();
    const tx = wide ? w * 0.67 : w / 2, ty = wide ? h * 0.42 : h * 0.7;
    say(g, "PHANTOM", tx, ty, (wide ? w * 0.6 : w) * 0.9, h * (wide ? 0.22 : 0.11), serif, "#f4f1ea");
    say(g, "OF THE POST OFFICE", tx, ty + h * (wide ? 0.22 : 0.1), (wide ? w * 0.6 : w) * 0.88, h * (wide ? 0.11 : 0.055), serif, "#c9a24a");
  },
  function somethingPosted(g, w, h, wide) {
    fill(g, w, h, "#f4ecd8");
    g.strokeStyle = "#c1272d";
    g.lineWidth = Math.min(w, h) * 0.04;
    g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
    say(g, "SOMETHING", w / 2, h * (wide ? 0.27 : 0.3), w * 0.75, h * (wide ? 0.15 : 0.08), serif, "#c1272d");
    say(g, "POSTED!", w / 2, h * (wide ? 0.52 : 0.44), w * 0.86, h * (wide ? 0.32 : 0.16), italic, "#c1272d");
    say(g, "THE FUNNIEST NEW SMASH", w / 2, h * (wide ? 0.8 : 0.62), w * 0.8, h * (wide ? 0.1 : 0.05), serif, "#2b2b2b");
    if (!wide) envelope(g, w / 2, h * 0.8, w * 0.5, w * 0.32, "#c1272d", "#f4ecd8");
  },
  function springDelivery(g, w, h, wide) {
    gradient(g, w, h, "#8c2232", "#5a1420");
    say(g, "Spring", w / 2, h * (wide ? 0.28 : 0.28), w * 0.8, h * (wide ? 0.26 : 0.13), italic, "#fbe9d0");
    say(g, "Delivery", w / 2, h * (wide ? 0.55 : 0.41), w * 0.86, h * (wide ? 0.26 : 0.13), italic, "#fbe9d0");
    for (let i = 0; i < 5; i++) star(g, w / 2 + (i - 2) * Math.min(w, h) * 0.12, h * (wide ? 0.8 : 0.58), Math.min(w, h) * 0.05, "#ffd23f");
    if (!wide) say(g, "A SHEER TRIUMPH!", w / 2, h * 0.7, w * 0.86, h * 0.05, serif, "#ffd23f");
  },
  function schoolOfPost(g, w, h, wide) {
    fill(g, w, h, "#1b1b1f");
    g.fillStyle = "#ffd23f";
    g.beginPath();
    const bx = wide ? w * 0.86 : w * 0.5, by = wide ? h * 0.5 : h * 0.78, bs = Math.min(w, h) * 0.28;
    g.moveTo(bx + bs * 0.2, by - bs);
    g.lineTo(bx - bs * 0.35, by + bs * 0.1);
    g.lineTo(bx, by + bs * 0.1);
    g.lineTo(bx - bs * 0.2, by + bs);
    g.lineTo(bx + bs * 0.35, by - bs * 0.1);
    g.lineTo(bx, by - bs * 0.1);
    g.fill();
    const tx = wide ? w * 0.42 : w / 2;
    say(g, "SCHOOL", tx, h * (wide ? 0.3 : 0.2), (wide ? w * 0.7 : w) * 0.9, h * (wide ? 0.24 : 0.12), bungee, "#f4f1ea");
    say(g, "OF POST", tx, h * (wide ? 0.58 : 0.36), (wide ? w * 0.7 : w) * 0.9, h * (wide ? 0.24 : 0.12), bungee, "#e8312f");
    say(g, "THE MUSICAL", tx, h * (wide ? 0.83 : 0.5), (wide ? w * 0.7 : w) * 0.8, h * (wide ? 0.1 : 0.05), hand, "#f4f1ea");
  },
  function chill(g, w, h, wide) {
    gradient(g, w, h, "#ff9a3c", "#f2622e");
    for (let i = 0; i < 14; i++) {
      const x = ((i * 53) % 100) / 100 * w, y = ((i * 37) % 100) / 100 * h, r = Math.min(w, h) * 0.04;
      g.strokeStyle = "rgba(255,255,255,0.75)";
      g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        g.beginPath();
        g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        g.stroke();
      }
    }
    say(g, "CHILL IN", w / 2, h * (wide ? 0.34 : 0.36), w * 0.84, h * (wide ? 0.26 : 0.13), bungee, "#ffffff");
    say(g, "THE MAIL", w / 2, h * (wide ? 0.62 : 0.5), w * 0.84, h * (wide ? 0.26 : 0.13), bungee, "#ffffff");
    say(g, "NOW SHOWING", w / 2, h * (wide ? 0.86 : 0.64), w * 0.6, h * (wide ? 0.09 : 0.045), hand, "#fff1d6");
  },
  // The game.
  function skins(g, w, h, wide, img) {
    gradient(g, w, h, "#f7a8d8", "#9b59e6");
    const pic = wide ? img.banner : img.collection;
    if (pic) {
      if (wide) g.drawImage(pic, 0, 0, w, w / 4);
      else g.drawImage(pic, w * 0.06, h * 0.05, w * 0.88, w * 0.88);
    }
    const ty = wide ? h * 0.62 : h * 0.62;
    say(g, "COURIER SKINS", w / 2, ty, w * 0.9, h * (wide ? 0.17 : 0.085), bungee, "#ffffff");
    say(g, "999 LIMITED OUTFITS & RIDES", w / 2, ty + h * (wide ? 0.16 : 0.08), w * 0.88, h * (wide ? 0.09 : 0.045), hand, "#ffffff");
    say(g, "MINT AT THE POST OFFICE", w / 2, ty + h * (wide ? 0.28 : 0.14), w * 0.8, h * (wide ? 0.08 : 0.04), bungee, "#3d1466");
  },
  function stamp(g, w, h, wide) {
    fill(g, w, h, "#1f2a44");
    const sx = wide ? w * 0.22 : w / 2, sy = wide ? h / 2 : h * 0.3, ss = Math.min(w, h) * (wide ? 0.62 : 0.6);
    g.fillStyle = "#f2c94c";
    g.fillRect(sx - ss / 2, sy - ss / 2, ss, ss);
    g.fillStyle = "#1f2a44";
    const holes = 7, hr = ss / holes / 3.2;
    for (let i = 0; i <= holes; i++) {
      const o = -ss / 2 + (i * ss) / holes;
      for (const [x, y] of [[sx + o, sy - ss / 2], [sx + o, sy + ss / 2], [sx - ss / 2, sy + o], [sx + ss / 2, sy + o]]) {
        g.beginPath();
        g.arc(x, y, hr, 0, Math.PI * 2);
        g.fill();
      }
    }
    say(g, "$", sx, sy + ss * 0.04, ss * 0.7, ss * 0.62, bungee, "#1f2a44");
    const tx = wide ? w * 0.64 : w / 2, ty = wide ? h * 0.34 : h * 0.66;
    say(g, "$STAMP", tx, ty, (wide ? w * 0.6 : w) * 0.9, h * (wide ? 0.24 : 0.12), bungee, "#f2c94c");
    say(g, "THE TOWN'S TOKEN", tx, ty + h * (wide ? 0.22 : 0.11), (wide ? w * 0.6 : w) * 0.86, h * (wide ? 0.1 : 0.05), hand, "#ffffff");
    say(g, "21,000,000. EVER.", tx, ty + h * (wide ? 0.36 : 0.18), (wide ? w * 0.6 : w) * 0.8, h * (wide ? 0.09 : 0.045), bungee, "#8fb3ff");
  },
  function postOffice(g, w, h, wide) {
    fill(g, w, h, "#d9534a");
    const bx = wide ? w * 0.2 : w / 2, by = wide ? h * 0.52 : h * 0.3, bw = Math.min(w, h) * (wide ? 0.42 : 0.44);
    g.fillStyle = "#fbf6ea";
    g.beginPath();
    g.roundRect(bx - bw / 2, by - bw * 0.7, bw, bw * 1.4, bw * 0.25);
    g.fill();
    g.fillStyle = "#3b4145";
    g.fillRect(bx - bw * 0.32, by - bw * 0.35, bw * 0.64, bw * 0.08);
    envelope(g, bx, by + bw * 0.22, bw * 0.62, bw * 0.4, "#f2c94c", "#d9534a");
    const tx = wide ? w * 0.62 : w / 2, ty = wide ? h * 0.36 : h * 0.66;
    say(g, "OPEN A", tx, ty, (wide ? w * 0.66 : w) * 0.9, h * (wide ? 0.15 : 0.075), bungee, "#fbf6ea");
    say(g, "POST OFFICE", tx, ty + h * (wide ? 0.2 : 0.1), (wide ? w * 0.66 : w) * 0.92, h * (wide ? 0.2 : 0.1), bungee, "#fbf6ea");
    say(g, "EARN $STAMP EVERY DAY", tx, ty + h * (wide ? 0.38 : 0.19), (wide ? w * 0.66 : w) * 0.86, h * (wide ? 0.09 : 0.045), hand, "#ffe1a8");
  },
  // The treasure hunt: a token drop's coins while one is running (img.drops, from showDrops), else word that coins
  // come with a drop.
  function hunt(g, w, h, wide, img) {
    if (img.drops?.length) return coinDrop(g, w, h, wide, img.drops);
    gradient(g, w, h, "#16958d", "#0e5f5a");
    for (let i = 0; i < 9; i++) star(g, ((i * 71 + 13) % 100) / 100 * w, ((i * 43 + 7) % 100) / 100 * h, Math.min(w, h) * (0.04 + (i % 3) * 0.02), "#f2c94c");
    say(g, "TREASURE", w / 2, h * (wide ? 0.36 : 0.4), w * 0.9, h * (wide ? 0.2 : 0.1), bungee, "#ffe27a");
    say(g, "HUNT", w / 2, h * (wide ? 0.6 : 0.52), w * 0.8, h * (wide ? 0.24 : 0.12), bungee, "#ffe27a");
    say(g, "COINS WHEN A DROP IS ON", w / 2, h * (wide ? 0.83 : 0.65), w * 0.84, h * (wide ? 0.09 : 0.045), hand, "#ffffff");
  },
  function advertise(g, w, h, wide) {
    fill(g, w, h, "#0b1024");
    say(g, "YOUR PROJECT ON THE BIG SCREENS", w / 2, h * (wide ? 0.18 : 0.26), w * 0.9, h * (wide ? 0.08 : 0.04), bungee, "#ffd75e");
    say(g, "ADVERTISE", w / 2, h * (wide ? 0.42 : 0.4), w * 0.9, h * (wide ? 0.25 : 0.12), bungee, "#f7a8d8");
    say(g, "HERE", w / 2, h * (wide ? 0.64 : 0.52), w * 0.6, h * (wide ? 0.2 : 0.1), bungee, "#f7a8d8");
    say(g, "DM @PLAYCOURIERWLD", w / 2, h * (wide ? 0.85 : 0.66), w * 0.86, h * (wide ? 0.09 : 0.045), bungee, "#5ff3ff");
  },
  function courierWorld(g, w, h, wide) {
    gradient(g, w, h, "#9fdcef", "#6fbfd8");
    const rows = wide ? ["COURIER"] : ["COU", "RIER"];
    const tile = wide ? Math.min(w / 8.2, h * 0.42) : w / 4.6;
    rows.forEach((row, ri) => {
      const y0 = wide ? h * 0.18 : h * 0.12 + ri * tile * 1.12;
      [...row].forEach((ch, i) => {
        const x = w / 2 + (i - (row.length - 1) / 2) * tile * 1.08 - tile / 2;
        g.fillStyle = "#283033";
        g.fillRect(x + 3, y0 + 4, tile, tile);
        g.fillStyle = "#fbf8ef";
        g.fillRect(x, y0, tile, tile);
        g.strokeStyle = "#283033";
        g.lineWidth = Math.max(2, tile * 0.06);
        g.strokeRect(x, y0, tile, tile);
        say(g, ch, x + tile / 2, y0 + tile * 0.54, tile * 0.8, tile * 0.7, bungee, "#283033");
      });
    });
    say(g, "DELIVERING HAPPINESS", w / 2, h * (wide ? 0.82 : 0.62), w * 0.86, h * (wide ? 0.11 : 0.055), bungee, "#283033");
    if (!wide) envelope(g, w / 2, h * 0.8, w * 0.48, w * 0.3, "#fbf8ef", "#283033");
  },
  // The three biggest tokens from the Launchpad (img.launches, from showLaunches), or an invitation to launch one;
  // and while a token drop is running (img.drops), a banner along the bottom saying so.
  function launchpad(g, w, h0, wide, img) {
    gradient(g, w, h0, "#1b1046", "#3a1c8c");
    for (let i = 0; i < 12; i++) star(g, ((i * 67 + 11) % 100) / 100 * w, ((i * 37 + 5) % 100) / 100 * h0, Math.min(w, h0) * 0.012, "#ffffff");
    const drops = img.drops ?? [], h = drops.length ? h0 * (wide ? 0.84 : 0.88) : h0; // (the rest is the banner's)
    if (drops.length) {
      g.fillStyle = "#ffd23f";
      g.fillRect(0, h, w, h0 - h);
      const hunt = featured(drops).size ? `${dropTitle(featured(drops))} HUNT` : `COLLECT ${dropSymbols(drops)} COINS`;
      if (wide) say(g, `${hunt} · LIVE NOW`, w / 2, h + (h0 - h) / 2 + 1, w * 0.92, (h0 - h) * 0.62, bungee, "#2a1060");
      else {
        say(g, hunt, w / 2, h + (h0 - h) * 0.32, w * 0.9, (h0 - h) * 0.34, bungee, "#2a1060");
        say(g, "LIVE NOW", w / 2, h + (h0 - h) * 0.72, w * 0.9, (h0 - h) * 0.34, bungee, "#d62246");
      }
    }
    const list = img.launches ?? [];
    if (!list.length) {
      say(g, "LAUNCHPAD", w / 2, h * (wide ? 0.34 : 0.36), w * 0.9, h * (wide ? 0.24 : 0.12), bungee, "#ffd23f");
      say(g, "LAUNCH YOUR OWN TOKEN", w / 2, h * (wide ? 0.58 : 0.5), w * 0.88, h * (wide ? 0.11 : 0.055), hand, "#ffffff");
      say(g, img.padOpen ? "RIGHT HERE IN TIMES SQUARE" : "COMING SOON TO TIMES SQUARE", w / 2, h * (wide ? 0.76 : 0.6), w * 0.84, h * (wide ? 0.08 : 0.04), bungee, "#7ef0ff");
      return;
    }
    say(g, `TOP ${Math.min(3, list.length)} COINS`, w / 2, h * (wide ? 0.13 : 0.08), w * 0.86, h * (wide ? 0.13 : 0.06), bungee, "#ffd23f");
    const n = Math.min(3, list.length);
    for (let i = 0; i < n; i++) {
      const t = list[i];
      // Side by side on a wide screen; down a tall one, spread over its height however many there are.
      const cx = wide ? w * ((i + 0.5) / n) : w / 2, cy = wide ? h * 0.48 : h * (0.13 + ((i + 0.5) * 0.74) / n) - h * 0.03;
      const r = wide ? Math.min(h * 0.2, (w / n) * 0.28) : Math.min(w * 0.3, h * (0.075 + (3 - n) * 0.02));
      g.save();
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.closePath();
      g.fillStyle = `hsl(${parseInt(t.address.slice(2, 6), 16) % 360} 55% 52%)`;
      g.fill();
      if (t.pic) {
        g.clip();
        g.drawImage(t.pic, cx - r, cy - r, r * 2, r * 2);
      } else say(g, t.symbol.slice(0, 3), cx, cy, r * 1.6, r * 0.8, bungee, "#ffffff");
      g.restore();
      g.lineWidth = Math.max(2, r * 0.08);
      g.strokeStyle = "#ffffff";
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      const tw = wide ? w / n * 0.92 : w * 0.9;
      say(g, `$${t.symbol}`, cx, cy + r + h * (wide ? 0.09 : 0.03), tw, h * (wide ? 0.1 : 0.04), bungee, "#ffffff");
      if (t.mcap) say(g, t.mcap, cx, cy + r + h * (wide ? 0.19 : 0.065), tw, h * (wide ? 0.08 : 0.032), hand, "#7ef0ff");
    }
    if (!wide) say(g, "LAUNCHPAD · TIMES SQUARE", w / 2, h * 0.95, w * 0.9, h * 0.035, bungee, "#ffd23f");
  },
  function gm(g, w, h, wide) {
    gradient(g, w, h, "#ffcf6b", "#ff6f91");
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.arc(w / 2, h * (wide ? 0.95 : 0.85), Math.min(w, h) * 0.5, 0, Math.PI * 2);
    g.fill();
    say(g, "GM", w / 2, h * (wide ? 0.44 : 0.38), w * 0.8, h * (wide ? 0.55 : 0.3), bungee, "#ffffff");
    say(g, "COURIERS", w / 2, h * (wide ? 0.82 : 0.6), w * 0.7, h * (wide ? 0.13 : 0.065), bungee, "#7a2a48");
  },
];

/// A canvas drawn by `draw(g, w, h)`, as a texture, with LED lines over it.
function canvasTexture(w, h, draw, wrap = false) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (wrap) tex.wrapS = THREE.RepeatWrapping;
  const paint = () => {
    const g = c.getContext("2d");
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    leds(g, w, h);
    tex.needsUpdate = true;
  };
  paint();
  return { tex, paint, canvas: c };
}

// ---------------------------------------------------------------- the square

/// `k`: world.js's kit. Call `inside` while the town is laid out, `replace` for each building it leaves
/// out here, `raise` after the streets are built, and `finish` once everything else is.
export function createSquare(k) {
  const { R, ROADS, ROAD_HW, WALK, terrain, box, part, glow, bake, frameAt, spinToward, world, C, nearestRoad, mulberry32 } = k;
  const arc = (a, b) => R * Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- where: the crossing of two town streets farthest from the post office, well clear of the sea
  // and the other places
  let best = null;
  for (let i = 0; i < ROADS.length; i++) {
    for (let j = i + 1; j < ROADS.length; j++) {
      const x = new THREE.Vector3().crossVectors(ROADS[i].axis, ROADS[j].axis);
      if (x.lengthSq() < 1e-6) continue;
      for (const s of [1, -1]) {
        const d = x.clone().normalize().multiplyScalar(s);
        if (terrain.zoneAt(d).key !== "town" || terrain.waterAt(d) !== null) continue;
        const clear = terrain.ZONES.every((z) => arc(d, z.d) - z.r * R > (z.key === "sea" ? 20 : 15));
        const far = arc(d, k.from);
        if (clear && (!best || far > best.far)) best = { d, far, roads: [i, j] };
      }
    }
  }
  if (!best) return null;
  const centre = best.d;
  const inside = (d, extra = 0) => arc(d, centre) < SQUARE_R + extra;
  const recs = [];

  // ---- screens: quads in planet space, one mesh per channel (a few posters taking turns, the Orb's ad,
  // the ticker...), so the whole square is a handful of draw calls
  const img = {};
  const L = POSTERS.map((p) => canvasTexture(512, 256, (g, w, h) => p(g, w, h, true, img)));
  const P = POSTERS.map((p) => canvasTexture(256, 512, (g, w, h) => p(g, w, h, false, img)));
  const repaint = () => [...L, ...P, ticker, year, busSign, ad, padSign].forEach((t) => t.paint());
  document.fonts?.ready.then(repaint);
  for (const [key, src] of [["banner", "skins/banner.png"], ["collection", "skins/collection.png"]]) {
    const im = new Image();
    im.onload = () => {
      img[key] = im;
      const i = POSTERS.findIndex((p) => p.name === "skins");
      L[i].paint();
      P[i].paint();
    };
    im.src = src;
  }
  const TICKER = " ★ COURIER WORLD ★ DELIVERING HAPPINESS ★ $STAMP ★ GM COURIERS ★ POST OFFICES OPEN 24/7 ★ FLY TO THE MOON AND MARS ★ PICK YOUR NAME AT THE POST OFFICE";
  let tickerTokens = ""; // once the Launchpad is open: an invitation, and its biggest tokens (from showLaunches)
  let tickerDrops = ""; // the treasury's token drops running today (from showDrops)
  // The ticker's line fills its texture exactly, so it runs round without a seam.
  const ticker = canvasTexture(4096, 64, (g, w, h) => {
    const line = TICKER + tickerDrops + tickerTokens;
    fill(g, w, h, "#120d05");
    g.font = bungee(40);
    const s = Math.ceil((40 * w) / g.measureText(line).width) + 1;
    g.font = bungee(Math.min(48, s));
    g.fillStyle = "#ffb000";
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText(line, 0, h / 2 + 2, w);
  }, true);
  // The Launchpad's sign, over the corner tower's door.
  const padSign = canvasTexture(512, 128, (g, w, h) => {
    gradient(g, w, h, "#2a1466", "#5b2bd1", true);
    say(g, "🚀 LAUNCHPAD", w / 2, h * 0.42, w * 0.92, h * 0.5, bungee, "#ffd23f");
    say(g, img.padOpen ? "LAUNCH YOUR TOKEN · WALK IN" : "COMING SOON", w / 2, h * 0.8, w * 0.86, h * 0.17, bungee, "#ffffff");
  });
  const year = canvasTexture(256, 128, (g, w, h) => {
    fill(g, w, h, "#0d0d10");
    say(g, "2026", w / 2, h * 0.55, w * 0.9, h * 0.8, bungee, "#ff3b3b");
  });
  const busSign = canvasTexture(512, 64, (g, w, h) => {
    fill(g, w, h, "#16181d");
    say(g, "BIG POST TOURS ★ HOP ON, HOP OFF", w / 2, h * 0.56, w * 0.94, h * 0.7, bungee, "#ffd23f");
  });
  // The Orb's ad (main.js calls showAd when it changes); until then, "advertise here".
  let shownAd = null, adPicture = null;
  const ad = canvasTexture(512, 256, (g, w, h) => {
    const a = shownAd;
    if (!a || a.house) return POSTERS.find((p) => p.name === "advertise")(g, w, h, true);
    fill(g, w, h, a.color ?? "#0b1024");
    if (adPicture) g.drawImage(adPicture, h * 0.08, h * 0.08, h * 0.84, h * 0.84);
    const light = (() => {
      const c = (a.color ?? "#000000").replace("#", "");
      const [r, gg, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
      return 0.299 * r + 0.587 * gg + 0.114 * b > 150;
    })();
    const ink = light ? "#16181d" : "#ffffff", tx = h + (w - h) / 2;
    say(g, a.name.toUpperCase(), tx, h * 0.34, (w - h) * 0.9, h * 0.24, bungee, ink);
    // The line, over two rows if it's long.
    const words = (a.text ?? "").split(/\s+/), rows = [""];
    for (const wd of words) {
      g.font = hand(h * 0.1);
      if (g.measureText(`${rows[rows.length - 1]} ${wd}`).width > (w - h) * 0.88 && rows[rows.length - 1]) rows.push(wd);
      else rows[rows.length - 1] = `${rows[rows.length - 1]} ${wd}`.trim();
    }
    rows.slice(0, 3).forEach((r, i) => say(g, r, tx, h * (0.56 + i * 0.12), (w - h) * 0.9, h * 0.1, hand, ink));
    say(g, "AD · TAP FOR MORE", tx, h * 0.9, (w - h) * 0.7, h * 0.06, bungee, light ? "#3b4145" : "#cfd6e0");
  });

  const channels = new Map(); // key -> { tex | channel, quads: { pos, uv } }
  const addQuad = (key, corners, uvs) => {
    if (!channels.has(key)) channels.set(key, { pos: [], uv: [] });
    const c = channels.get(key);
    for (const p of corners) c.pos.push(p.x, p.y, p.z);
    c.uv.push(...uvs);
  };
  let nextL = 0, nextP = 0;
  /// A screen on a building at `dir` turned by `spin`: centred at local (x, y, z), w by h, facing local
  /// +z turned by ry. cls: "L" landscape poster, "P" portrait poster, "A" the Orb's ad, "T" ticker,
  /// "Y" the year, "B" the bus's sign, "D" the Launchpad's sign.
  function screen(dir, spin, s) {
    const q = frameAt(dir, spin), o = dir.clone().multiplyScalar(R);
    const rot = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), s.ry);
    const corner = (cx, cy) => V(cx, cy, 0).applyQuaternion(rot).add(V(s.x, s.y, s.z)).applyQuaternion(q).add(o);
    const pts = [corner(-s.w / 2, -s.h / 2), corner(s.w / 2, -s.h / 2), corner(s.w / 2, s.h / 2), corner(-s.w / 2, s.h / 2)];
    let key = s.cls, u = 1;
    if (s.cls === "L") key = `L${nextL++ % L_CHANNELS}`;
    if (s.cls === "P") key = `P${nextP++ % P_CHANNELS}`;
    if (s.cls === "T") u = s.w / s.h / 64; // the ticker's texture is 64 times as wide as it's tall
    const u0 = s.u0 ?? 0; // (where a ticker band starts in its line, so the words run on round a corner)
    addQuad(key, pts, [u0, 0, u0 + u, 0, u0 + u, 1, u0, 1]);
  }

  // ---- the towers
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const MARQUEE = [0xffd23f, 0xff3ea5, 0x2de2e6, 0xf4f1ea, 0xff7a3c];
  /// A tower on a building's footprint (w by d, facing local +z), its door where the building's was.
  /// `side` is the side (1 or -1, local x) facing the middle of the square.
  function tower(rec, r, iconic, side) {
    const { w, d } = rec.spec, g = new THREE.Group(), screens = [], front = d / 2;
    const frontScreen = (x, y, sw, sh, cls) => {
      box(g, sw + 0.18, sh + 0.18, 0.12, 0x16181d, x, y, front + 0.06);
      screens.push({ x, y, z: front + 0.125, w: sw, h: sh, ry: 0, cls });
    };
    const sideScreen = (s, z, y, sw, sh, cls) => {
      box(g, 0.12, sh + 0.18, sw + 0.18, 0x16181d, s * (w / 2 + 0.06), y, z);
      screens.push({ x: s * (w / 2 + 0.125), y, z, w: sw, h: sh, ry: (s * Math.PI) / 2, cls });
    };
    // A podium: dark base with shop windows, the door and a glowing marquee.
    box(g, w + 0.08, 2.6, d + 0.08, 0x23262e, 0, 1.3, 0);
    box(g, w * 0.84, 1.7, 0.06, C.glass, 0, 1.0, front + 0.06);
    box(g, 0.86, 1.8, 0.08, 0x15151c, rec.doorX, 0.9, front + 0.09);
    glow(g, new THREE.BoxGeometry(w * 0.96, 0.16, 0.5), pick(r, MARQUEE), 0, 2.55, front + 0.29);
    if (rec.vend) {
      // A newsstand where the shop's vending machines were.
      box(g, 1.0, 1.5, 1.3, 0x2f6b4f, w / 2 + 0.6, 0.75, d / 2 - 0.9);
      box(g, 1.2, 0.08, 1.5, 0x24543e, w / 2 + 0.6, 1.54, d / 2 - 0.9);
      for (let i = 0; i < 4; i++) box(g, 0.05, 0.3, 0.22, pick(r, [0xe46f5f, 0x5d8fd1, 0xf2c94c, 0x7cc2b5]), w / 2 + 1.12, 0.6 + (i % 2) * 0.4, d / 2 - 1.3 + (i >> 1) * 0.5);
    }
    if (iconic) {
      // Its ground floor is the Launchpad: a lit sign over the door.
      box(g, 2.2, 0.62, 0.1, 0x16181d, rec.doorX, 2.12, front + 0.11);
      screens.push({ x: rec.doorX, y: 2.12, z: front + 0.17, w: 2.04, h: 0.51, ry: 0, cls: "D" });
      // The tower on the corner: narrow, stacked with screens, a ticker round its podium and a lit ball on top.
      const bw = Math.min(w, 4.4) * 0.86, bd = Math.min(d, 4.0) * 0.86, H = 16;
      box(g, bw, H - 2.6, bd, 0x3b404c, 0, 2.6 + (H - 2.6) / 2, -front + bd / 2);
      const fz = -front + bd;
      const band = (len) => len / 0.42 / 64; // how much of the ticker's line a band this long shows
      for (const [x, z, sw, ry, u0] of [[0, fz + 0.03, bw + 0.1, 0, 0], [bw / 2 + 0.03, fz - bd / 2, bd, Math.PI / 2, band(bw + 0.1)], [-bw / 2 - 0.03, fz - bd / 2, bd, -Math.PI / 2, -band(bd)]]) {
        screens.push({ x, y: 3.0, z, w: sw, h: 0.42, ry, cls: "T", u0 });
      }
      const sw = bw * 0.96, sh = sw / 2;
      let y = 3.55 + sh / 2, n = 0;
      while (y + sh / 2 < H - 2.2) {
        box(g, sw + 0.14, sh + 0.14, 0.1, 0x16181d, 0, y, fz + 0.05);
        screens.push({ x: 0, y, z: fz + 0.11, w: sw, h: sh, ry: 0, cls: n % 2 ? "A" : "L" });
        y += sh + 0.22;
        n++;
      }
      box(g, sw * 0.62, sw * 0.31, 0.1, 0x16181d, 0, H - 1.2, fz + 0.05);
      screens.push({ x: 0, y: H - 1.2, z: fz + 0.11, w: sw * 0.6, h: sw * 0.3, ry: 0, cls: "Y" });
      part(g, new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), 0x9aa0aa, 0, H + 1.2, fz - bd / 2);
      glow(g, new THREE.IcosahedronGeometry(0.62, 1), 0xfff3c4, 0, H + 2.6, fz - bd / 2);
      for (let i = 0; i < 4; i++) part(g, new THREE.TorusGeometry(0.66, 0.025, 4, 18), 0xd8c27a, 0, H + 2.6, fz - bd / 2, 0, (i * Math.PI) / 4, 0);
      return { g, screens, h: H + 3.3, door: { x: rec.doorX, z: front + 1.1 } };
    }
    const floors = 6 + Math.floor(r() * 5), fh = 1.25, H = 2.7 + floors * fh;
    const glassy = r() < 0.55;
    box(g, w, H - 2.6, d, glassy ? pick(r, [0x5d7a93, 0x6b8aa3, 0x4d667c, 0x7393ab]) : pick(r, [0xcbc2b0, 0xb5ab9c, 0xa3968a, 0x8c8073, 0xd8cfbf]), 0, 2.6 + (H - 2.6) / 2, 0);
    // Screens on the front, from just above the podium; one or two, and maybe a tall one down the side
    // that faces the square.
    const sw = w * 0.9, sh = sw / 2;
    let top = 3.0;
    if (top + sh < H - 0.8) {
      frontScreen(0, top + sh / 2, sw, sh, "L");
      top += sh + 0.3;
    }
    const sw2 = w * 0.76;
    if (r() < 0.6 && top + sw2 / 2 < H - 0.8) {
      frontScreen(0, top + sw2 / 4, sw2, sw2 / 2, "L");
      top += sw2 / 2 + 0.3;
    }
    const pw = d * 0.62, ph = pw * 2;
    if (side && 3.0 + ph < H - 0.6) sideScreen(side, 0, 3.0 + ph / 2, pw, ph, "P");
    // Above the screens: floor bands on glass, rows of windows on stone.
    for (let f = Math.ceil((top - 2.7) / fh); f < floors; f++) {
      const y = 2.7 + f * fh;
      if (glassy) box(g, w + 0.04, 0.07, d + 0.04, 0x2c3a47, 0, y, 0);
      else for (let i = 0; i < 3; i++) box(g, w * 0.2, fh * 0.55, 0.05, C.glass, (i - 1) * w * 0.3, y + fh * 0.5, front + 0.02);
    }
    let h = H;
    // On the roof: a water tower, a billboard, or both.
    if (r() < 0.5) {
      const tx = -w * 0.22, tz = -d * 0.15;
      for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) part(g, new THREE.CylinderGeometry(0.04, 0.04, 1.0, 5), 0x4a4038, tx + x, H + 0.5, tz + z);
      part(g, new THREE.CylinderGeometry(0.58, 0.58, 1.2, 12), 0x8a6a4a, tx, H + 1.6, tz);
      part(g, new THREE.ConeGeometry(0.64, 0.5, 12), 0x5a4636, tx, H + 2.45, tz);
      h = H + 2.7;
    }
    if (r() < 0.45) {
      const bw = w * 0.82, bh = bw / 2, bz = front - 0.6;
      for (const x of [-bw * 0.35, bw * 0.35]) box(g, 0.12, 0.7, 0.12, 0x4a4f5c, x, H + 0.35, bz - 0.1);
      box(g, bw + 0.18, bh + 0.18, 0.12, 0x16181d, 0, H + 0.7 + bh / 2, bz);
      screens.push({ x: 0, y: H + 0.7 + bh / 2, z: bz + 0.065, w: bw, h: bh, ry: 0, cls: "L" });
      h = Math.max(h, H + 0.8 + bh);
    }
    return { g, screens, h };
  }

  /// Build a tower on every building the square left out (after the streets are laid out). The one
  /// nearest the crossing is the corner tower; the biggest other screen shows the Orb's ad too.
  let padDoor = null; // where you stand to walk into the Launchpad
  function raise() {
    if (!recs.length) return;
    const near = recs.reduce((a, b) => (arc(a.dir, centre) <= arc(b.dir, centre) ? a : b));
    let adGiven = false;
    for (const rec of recs.sort((a, b) => arc(a.dir, centre) - arc(b.dir, centre))) {
      const r = mulberry32(Math.floor(Math.abs(rec.dir.x * 1e7 + rec.dir.y * 3e7 + rec.dir.z * 7e7)));
      const q = frameAt(rec.dir, rec.spin);
      const toMid = centre.clone().sub(rec.dir).applyQuaternion(q.clone().invert());
      const side = Math.abs(toMid.x) > Math.abs(toMid.z) * 0.35 ? Math.sign(toMid.x) : 0;
      const t = tower(rec, r, rec === near, side);
      if (!adGiven && rec !== near) {
        const big = t.screens.find((s) => s.cls === "L");
        if (big) [big.cls, adGiven] = ["A", true];
      }
      bake(t.g, rec.dir, rec.spin);
      for (const s of t.screens) screen(rec.dir, rec.spin, s);
      if (t.door) padDoor = V(t.door.x, 0, t.door.z).applyQuaternion(q).add(rec.dir.clone().multiplyScalar(R)).normalize();
      // Taller now: the camera keeps clear of all of it.
      if (rec.obstacle?.wall) rec.obstacle.wall.h = t.h;
    }
  }

  // ---- the plaza, built once everything else in the town is
  function finish({ animators, npcs, keepClear, lots, tufts, blocked, addRect, addCircle }) {
    // The plaza's props go into batches of their own (the town's are built by now): two draw calls for all.
    const late = k.makeBatch(), lateGlow = k.makeBatch();
    const put = (g, d, spin) => {
      g.position.copy(d).multiplyScalar(R);
      g.quaternion.copy(frameAt(d, spin));
      g.updateMatrixWorld(true);
      g.traverse((o) => o.isMesh && (o.material.userData.neon ? lateGlow : late).add(o.geometry, o.matrixWorld, o.material.color));
      g.traverse((o) => o.geometry?.dispose());
    };
    const spots = keepClear.map((p) => V(p.x, p.y, p.z).normalize());
    const offRoad = (d, m) => nearestRoad(d) > ROAD_HW + WALK + m;
    const clearOf = (d, r, avoid = []) =>
      inside(d, -r) && !blocked(d, r) && spots.every((s) => arc(s, d) > r + 1.6) && lots.every((l) => arc(l.d, d) > r + 2.6) && avoid.every(([a, ar]) => arc(a, d) > r + ar);
    const e1 = new THREE.Vector3().crossVectors(centre, Math.abs(centre.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(centre, e1);
    const around = (rho, a) => centre.clone().multiplyScalar(R).addScaledVector(e1, Math.cos(a) * rho).addScaledVector(e2, Math.sin(a) * rho).normalize();
    /// The open spot nearest the crossing with room r around it, off the streets.
    const find = (r, margin, avoid, from = 4) => {
      for (let rho = from; rho < SQUARE_R - r; rho += 0.4) {
        for (let i = 0; i < 40; i++) {
          const d = around(rho, (i / 40) * Math.PI * 2 + rho);
          if (offRoad(d, margin) && clearOf(d, r, avoid)) return d;
        }
      }
      return null;
    };
    const placed = [];

    // The red steps: you can climb them and sit facing the crossing, a ticket booth tucked underneath.
    const steps = find(2.5, 2.2, []);
    if (steps) {
      const spin = spinToward(steps, centre), q = frameAt(steps, spin);
      const g = new THREE.Group(), W2 = 1.6, D = 3.6, Hs = 2.2, n = 9;
      for (let i = 0; i < n; i++) {
        const z0 = D / 2 - (i * D) / n, hh = ((i + 1) * Hs) / n;
        box(g, W2 * 2, 0.08, D / n + 0.02, 0xd8322f, 0, hh - 0.04, z0 - D / n / 2);
        box(g, W2 * 2, Hs / n, 0.04, 0xf06a5f, 0, hh - Hs / n / 2, z0);
      }
      // Solid sides under the slope, and glass rails along them.
      const cheek = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(D / 2, Hs)]);
      for (const s of [-1, 1]) {
        const geo = new THREE.ExtrudeGeometry(cheek, { depth: 0.08, bevelEnabled: false }).rotateY(Math.PI / 2);
        part(g, geo, 0xa8282a, s < 0 ? -W2 - 0.08 : W2, 0, 0);
        for (const [hgt, wid, col, lift] of [[0.9, 0.06, 0xbfe3ea, 0.5], [0.06, 0.08, 0x9aa0aa, 0.97]]) {
          const rail = new THREE.BoxGeometry(wid, hgt, D, 1, 1, 4).applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0, 0, -Hs / D));
          part(g, rail, col, s * (W2 + 0.04), Hs / 2 + lift, 0);
        }
      }
      // The ticket booth tucked in under the top of the steps, its window at the back.
      box(g, W2 * 2 - 0.1, 1.25, 1.0, 0x23262e, 0, 0.63, -D / 2 + 0.52);
      box(g, 1.4, 0.6, 0.06, C.glass, 0, 0.8, -D / 2 - 0.01);
      box(g, W2 * 2, 0.9, 0.08, 0xbfe3ea, 0, Hs + 0.45, -D / 2 - 0.04);
      put(g, steps, spin);
      const L2 = (x, z) => steps.clone().multiplyScalar(R).add(V(x, 0, z).applyQuaternion(q)).normalize();
      const up = V(0, 0, -1).applyQuaternion(q);
      // Sloped, with the ground underneath walled off, side rails, and a rail across the back.
      const ramp = terrain.addRamp(L2(0, D / 2), up, D, W2 - 0.1, 0, Hs);
      for (let i = 1; i < 4; i++) {
        const m = L2(0, D / 2 - (D * (i + 0.5)) / 4);
        addRect(m, spinToward(m, L2(0, -D)), W2, D / 8, null, { y1: (Hs * i) / 4 - 0.6 });
      }
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const m = L2(s * (W2 + 0.03), D / 2 - (D * (i + 0.5)) / 4);
        addRect(m, spinToward(m, L2(s * (W2 + 0.03), -D)), 0.05, D / 8, null, { y0: (Hs * i) / 4 - 0.4, y1: (Hs * (i + 1)) / 4 + 0.6 });
      }
      const back = L2(0, -D / 2 - 0.04);
      addRect(back, spinToward(back, L2(1, -D / 2 - 0.04)), 0.05, W2, null, { y0: Hs - 0.5, y1: Hs + 0.6 });
      void ramp;
      placed.push([steps, 2.6]);
    }

    // The First Courier: a bronze courier on a granite plinth, holding a letter up to the screens.
    const statue = find(0.9, 1.0, placed, 3.5);
    if (statue) {
      const spin = spinToward(statue, centre), g = new THREE.Group(), bronze = 0x8c6a3c;
      box(g, 1.3, 1.5, 1.3, 0x9a9a96, 0, 0.75, 0);
      box(g, 1.45, 0.12, 1.45, 0x85857f, 0, 1.56, 0);
      for (const x of [-0.13, 0.13]) box(g, 0.16, 0.7, 0.2, bronze, x, 1.97, 0);
      box(g, 0.5, 0.62, 0.3, bronze, 0, 2.62, 0);
      part(g, new THREE.SphereGeometry(0.2, 10, 8), bronze, 0, 3.12, 0);
      box(g, 0.42, 0.08, 0.36, bronze, 0, 3.3, 0.06);
      box(g, 0.12, 0.62, 0.12, bronze, 0.32, 3.12, 0.04, 0, 0, -0.2);
      box(g, 0.34, 0.22, 0.03, bronze, 0.4, 3.5, 0.05);
      box(g, 0.12, 0.5, 0.12, bronze, -0.3, 2.55, 0);
      box(g, 0.3, 0.32, 0.14, bronze, -0.28, 2.45, 0.2);
      put(g, statue, spin);
      addCircle(statue, 0.8, { wall: { h: 3.6 } });
      placed.push([statue, 1.0]);
    }

    // Parked along the kerbs: yellow cabs, and a red double-decker tour bus.
    const vehicles = [[0, 6.8, 1, "cab"], [0, 9.6, 1, "cab"], [0, -7.4, -1, "cab"], [1, 8.4, 1, "bus"], [1, -7.2, -1, "cab"], [1, -10.2, -1, "cab"]];
    for (const [which, s, way, kind] of vehicles) {
      const road = ROADS[best.roads[which]], t = terrain.roadT(road, centre) + s / R, p = road.point(t);
      const tan = road.tangent(t).multiplyScalar(way), side = new THREE.Vector3().crossVectors(p, tan).normalize();
      const len = kind === "bus" ? 5.2 : 2.2, half = kind === "bus" ? 0.7 : 0.55;
      const d = k.offsetOnSphere(p, side, ROAD_HW - half - 0.1);
      if (!inside(d, -len / 2) || nearestRoad(d, best.roads[which]) < ROAD_HW + WALK + len / 2 + 1 || !spots.every((sp) => arc(sp, d) > len / 2 + 1.2)) continue;
      const spin = spinToward(d, k.offsetOnSphere(d, tan, 1)), g = new THREE.Group();
      if (kind === "cab") {
        box(g, 1.0, 0.5, 2.2, 0xf5c518, 0, 0.5, 0);
        box(g, 0.86, 0.4, 1.15, 0xf5c518, 0, 0.94, -0.1);
        for (const s2 of [-1, 1]) box(g, 0.02, 0.28, 1.0, 0x2b3a4f, s2 * 0.44, 0.96, -0.1);
        box(g, 0.8, 0.28, 0.02, 0x2b3a4f, 0, 0.96, 0.48);
        for (const s2 of [-1, 1]) for (let i = 0; i < 8; i++) box(g, 0.02, 0.06, 0.12, i % 2 ? 0x111111 : 0xf4f1ea, s2 * 0.51, 0.55, -0.9 + i * 0.25);
        glow(g, new THREE.BoxGeometry(0.38, 0.12, 0.16), 0xfff3b0, 0, 1.2, -0.1);
        for (const [x, z] of [[-0.5, 0.7], [0.5, 0.7], [-0.5, -0.7], [0.5, -0.7]]) part(g, new THREE.CylinderGeometry(0.22, 0.22, 0.14, 10), 0x1d1d22, x, 0.22, z, 0, 0, Math.PI / 2);
      } else {
        box(g, 1.4, 1.25, 5.2, 0xc8102e, 0, 0.8, 0);
        box(g, 1.42, 0.5, 4.9, 0x2b3a4f, 0, 1.0, 0.05);
        box(g, 1.4, 0.95, 5.2, 0xc8102e, 0, 1.9, 0);
        box(g, 1.42, 0.45, 4.9, 0x2b3a4f, 0, 2.0, 0.05);
        box(g, 1.34, 0.06, 5.1, 0x9aa0aa, 0, 2.4, 0);
        for (const [x, z] of [[-0.62, 1.7], [0.62, 1.7], [-0.62, -1.7], [0.62, -1.7]]) part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.16, 10), 0x1d1d22, x, 0.3, z, 0, 0, Math.PI / 2);
        for (const s2 of [-1, 1]) screen(d, spin, { x: s2 * 0.72, y: 1.48, z: 0, w: 4.6, h: 0.42, ry: (s2 * Math.PI) / 2, cls: "B" });
      }
      put(g, d, spin);
      addRect(d, spin, half, len / 2, { h: kind === "bus" ? 2.5 : 1.3, hd: len / 2 });
    }

    // People: a busker in next to nothing, and a tourist who can't stop taking pictures.
    const busker = find(0.5, 1.0, placed, 4);
    if (busker) {
      placed.push([busker, 0.7]);
      npcs.push({ d: busker, y: terrain.landAt(busker), face: centre.clone().sub(busker).addScaledVector(busker, -centre.clone().sub(busker).dot(busker)).normalize(), name: "The Naked Courier", own: true, hi: ["Howdy!", "Tips welcome!", "Yeehaw!"],
        look: { skin: 0xf1d0b5, shirt: 0xf1d0b5, collar: 0xf1d0b5, accent: 0xf4f1ea, bottoms: 0xf4f1ea, bottomsStyle: "shorts", socks: 0xf4f1ea, shoes: 0x6c4a32, headwear: "bucket", hair: 0xc9a24a, hairStyle: "bob", bag: "satchel", height: 1.06 },
        lines: ["Welcome to the square, partner! The screens are bright, the letters are fast and my shorts are... optional.", "I deliver serenades. Small fee. Big feelings.",
          "I've been playing here since before the screens. Back then it was just houses and a very confused cat.", "Climb the red steps and look up. Best seat on the planet, and it's free."] });
    }
    const tourist = find(0.5, 1.0, placed, 5);
    if (tourist) {
      npcs.push({ d: tourist, y: terrain.landAt(tourist), face: centre.clone().sub(tourist).addScaledVector(tourist, -centre.clone().sub(tourist).dot(tourist)).normalize(), name: "Tourist Tomo",
        look: { hair: 0x2b2522, hairStyle: "pony", headwear: "cap", shirt: 0x5fb2dd, accent: 0xffd23f, bottoms: 0xe8dcc0, bottomsStyle: "shorts", bag: "backpack" },
        lines: ["Smile! ...Again! One more! The light from the screens is perfect.", "I came all the way from the other side of the planet. That's about a hundred metres.",
          "Have you seen The Letter King? I've seen it nine times. I cry every time the envelope opens.", "They say if you stand here long enough, every courier on the planet walks past."] });
    }

    // Paving instead of grass: no tufts in the square.
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, m);
      if (inside(p.setFromMatrixPosition(m).normalize(), 0.5)) tufts.setMatrixAt(i, zero);
    }
    tufts.instanceMatrix.needsUpdate = true;

    world.add(late.build(k.toon(0xffffff, { vertexColors: true })));
    if (lateGlow.n) {
      const glowing = lateGlow.build(new THREE.MeshBasicMaterial({ vertexColors: true }));
      glowing.castShadow = false;
      world.add(glowing);
    }

    // The screens: one mesh per channel.
    const mats = new Map();
    const textureOf = (key) => {
      if (key === "A") return ad.tex;
      if (key === "T") return ticker.tex;
      if (key === "Y") return year.tex;
      if (key === "B") return busSign.tex;
      if (key === "D") return padSign.tex;
      const n = Number(key.slice(1));
      return (key[0] === "L" ? L : P)[(n * 3) % POSTERS.length].tex;
    };
    const adMeshes = [], padMeshes = [];
    for (const [key, c] of channels) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(c.pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(c.uv, 2));
      const idx = [];
      for (let i = 0; i < c.pos.length / 3; i += 4) idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({ map: textureOf(key) });
      mats.set(key, mat);
      const mesh = new THREE.Mesh(geo, mat);
      world.add(mesh);
      if (key === "A") adMeshes.push(mesh);
      if (key === "D") padMeshes.push(mesh);
    }
    // Posters take turns, each channel a little after the last, so the square never changes all at once.
    const showing = new Map();
    animators.push((t, night, dt) => {
      ticker.tex.offset.x = (ticker.tex.offset.x + (dt ?? 0.016) * 0.045) % 1;
      for (const [key, mat] of mats) {
        if (key[0] !== "L" && key[0] !== "P") continue;
        const n = Number(key.slice(1)), set = key[0] === "L" ? L : P;
        const i = ((n * 3) + Math.floor((t + n * 1.3) / CYCLE)) % POSTERS.length;
        if (showing.get(key) !== i) {
          showing.set(key, i);
          mat.map = set[i].tex;
        }
      }
    });

    const pictures = new Map(); // picture URL -> Image, once loaded
    const at = POSTERS.findIndex((p) => p.name === "launchpad");
    let launchKey = "", dropsKey = "";
    const usd = (n) => (Number.isFinite(n) && n > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n) : "");
    // Biggest market cap first (tokens without a price yet after them, newest first).
    const biggest = (list) => [...list].sort((a, b) => (Number.isFinite(b.mcapUsd) ? b.mcapUsd : 0) - (Number.isFinite(a.mcapUsd) ? a.mcapUsd : 0));
    function paintLaunches(list) {
      img.launches = biggest(list).slice(0, 3).map((t) => ({ address: t.address, symbol: t.symbol, mcap: usd(t.mcapUsd), pic: pictures.get(t.meta?.image) ?? null }));
      const top = biggest(list).filter((t) => Number.isFinite(t.mcapUsd) && t.mcapUsd > 0).slice(0, 5);
      tickerTokens = " ★ LAUNCH YOUR TOKEN AT THE LAUNCHPAD" + top.map((t) => ` ★ $${t.symbol} ${usd(t.mcapUsd)}`).join("");
      L[at].paint();
      P[at].paint();
      ticker.paint();
      padSign.paint();
    }

    return {
      key: "square", name: "Times Square", d: centre, r: SQUARE_R, adMeshes,
      /// The Launchpad's door (stand within `reach` and press E) and its sign (tap it).
      pad: padDoor ? { d: padDoor, reach: 2.6, meshes: padMeshes } : null,
      /// The token drops running today, oldest first ({ id, symbol, picture (once loaded), size (its tokens as it
      /// started), spots, perCoin, dailyCoins, maxPerWallet }): the hunt poster features the newest, with a banner on
      /// the Launchpad's poster and the ticker.
      showDrops(drops) {
        const key = drops.map((d) => `${d.id}:${d.symbol}:${d.picture ? 1 : 0}:${d.size ?? ""}:${d.spots}:${d.perCoin}:${d.dailyCoins}`).join(",");
        if (key === dropsKey) return;
        dropsKey = key;
        img.drops = drops;
        const f = featured(drops);
        tickerDrops = !f ? "" : f.size ? ` ★ ${dropTitle(f)} TREASURE HUNT: LIVE NOW ★ ${f.spots} COINS HIDDEN EVERY DAY ★ COLLECT ${dropSymbols(drops)} COINS, REDEEM AT YOUR POST OFFICE`
          : ` ★ COLLECT ${dropSymbols(drops)} COINS: LIVE NOW`;
        for (const name of ["hunt", "launchpad"]) {
          const i = POSTERS.findIndex((p) => p.name === name);
          L[i].paint();
          P[i].paint();
        }
        ticker.paint();
      },
      /// The tokens the Launchpad shows, newest first (pad.js onTokens): the three biggest on a poster, the five
      /// biggest on the ticker. Until the first call (no launchpad deployed yet) the sign and the poster say it's
      /// coming soon.
      showLaunches(list) {
        const key = "open:" + list.map((t) => `${t.address}:${Math.round(t.mcapUsd || 0)}`).join(",");
        if (key === launchKey) return;
        img.padOpen = true;
        launchKey = key;
        for (const t of biggest(list).slice(0, 3)) {
          const url = t.meta?.image;
          if (!url || pictures.has(url)) continue;
          const im = new Image();
          im.crossOrigin = "anonymous";
          im.onload = () => {
            pictures.set(url, im);
            paintLaunches(list);
          };
          im.src = url;
          pictures.set(url, null);
        }
        paintLaunches(list);
      },
      /// Show the Orb's ad (from orb.js: the ad and its loaded picture) on the square's ad screens.
      showAd(a, picture) {
        [shownAd, adPicture] = [a, picture ?? null];
        ad.paint();
      },
    };
  }

  return {
    d: centre, inside,
    /// A street building left out here: { dir, spin, spec, doorX, vend, obstacle }.
    replace: (rec) => recs.push(rec),
    raise,
    finish,
  };
}
