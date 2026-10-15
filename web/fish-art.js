// Courier Fish pictures: each species of web/fish-kinds.js drawn as an SVG, the same in the game's catch card, the
// Post Office panel and the metadata (web/fish/make.mjs writes <id>.svg). Courier World's own designs. No DOM.
import { FISH, fishOf } from "./fish-kinds.js";

const f = (n) => Math.round(n * 10) / 10;
/// A small PRNG (mulberry32) per species, so its spots and bubbles never move.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Each tier's backdrop: deep water in its colour.
const BACK = {
  Common: ["#2f5d73", "#123044"],
  Uncommon: ["#2f7a5e", "#103a2c"],
  Rare: ["#2f5fa8", "#10234a"],
  Epic: ["#6f3f9a", "#2a1240"],
  Legendary: ["#c98f1f", "#4a2a06"],
};

/// The generic fish body facing right, centred on (cx, cy): `L` long and `H` tall.
function bodyPath(cx, cy, L, H) {
  const N = [cx + L / 2, cy], T = [cx + L * 0.05, cy - H / 2], TT = [cx - L / 2, cy - H * 0.1], TB = [cx - L / 2, cy + H * 0.1], B = [cx + L * 0.05, cy + H / 2];
  return `M${f(N[0])} ${f(N[1])}C${f(N[0] - L * 0.04)} ${f(cy - H * 0.42)} ${f(T[0] + L * 0.2)} ${f(T[1])} ${f(T[0])} ${f(T[1])}`
    + `C${f(T[0] - L * 0.3)} ${f(T[1])} ${f(TT[0] + L * 0.16)} ${f(TT[1] - H * 0.06)} ${f(TT[0])} ${f(TT[1])}L${f(TB[0])} ${f(TB[1])}`
    + `C${f(TB[0] + L * 0.16)} ${f(TB[1] + H * 0.06)} ${f(B[0] - L * 0.3)} ${f(B[1])} ${f(B[0])} ${f(B[1])}`
    + `C${f(B[0] + L * 0.2)} ${f(B[1])} ${f(N[0] - L * 0.04)} ${f(cy + H * 0.42)} ${f(N[0])} ${f(N[1])}Z`;
}

/// Spots, stripes, scales or bands over the body (clipped to it).
function pattern(kind, r, cx, cy, L, H, pal) {
  let out = "";
  switch (kind) {
    case "dots":
      for (let i = 0; i < 16; i++) out += `<circle cx="${f(cx + (r() - 0.5) * L * 0.85)}" cy="${f(cy + (r() - 0.6) * H * 0.8)}" r="${f(3 + r() * 6)}" fill="${pal[2]}" opacity="0.45"/>`;
      break;
    case "tiger":
      for (let i = 0; i < 7; i++) {
        const x = cx - L * 0.35 + i * L * 0.11;
        out += `<path d="M${f(x)} ${f(cy - H * 0.6)}Q${f(x + 14)} ${f(cy - H * 0.1)} ${f(x - 4)} ${f(cy + H * 0.15)}" stroke="${pal[2]}" stroke-width="${f(L * 0.035)}" fill="none" stroke-linecap="round" opacity="0.6"/>`;
      }
      break;
    case "line":
      out += `<path d="M${f(cx - L * 0.45)} ${f(cy + 2)}Q${f(cx)} ${f(cy - 8)} ${f(cx + L * 0.38)} ${f(cy - 2)}" stroke="${pal[2]}" stroke-width="5" fill="none" opacity="0.5"/>`;
      break;
    case "bands":
      for (const k of [0.28, -0.02, -0.3]) {
        const x = cx + L * k;
        out += `<path d="M${f(x)} ${f(cy - H * 0.6)}Q${f(x + 18)} ${f(cy)} ${f(x)} ${f(cy + H * 0.6)}" stroke="${pal[2]}" stroke-width="${f(L * 0.085)}" fill="none"/>`
          + `<path d="M${f(x)} ${f(cy - H * 0.6)}Q${f(x + 18)} ${f(cy)} ${f(x)} ${f(cy + H * 0.6)}" stroke="${pal[1]}" stroke-width="${f(L * 0.06)}" fill="none"/>`;
      }
      break;
    case "scales":
      for (let row = -3; row <= 3; row++) {
        for (let col = -6; col <= 6; col++) {
          const x = cx + col * 20 + (row % 2 ? 10 : 0), y = cy + row * 16;
          out += `<path d="M${f(x - 10)} ${f(y)}Q${f(x)} ${f(y + 12)} ${f(x + 10)} ${f(y)}" stroke="${pal[2]}" stroke-width="2" fill="none" opacity="0.4"/>`;
        }
      }
      break;
  }
  return out;
}

/// A generic fish: body, tail, fins, pattern, belly shine, eye and mouth.
function fishBody(id, kind, r, pal, { L, H, dorsal = 0.3, bigEye = 1, extra = "", flat = false } = {}) {
  const cx = 262, cy = 262, uid = `f${id}`;
  const tailX = cx - L / 2;
  let out = `<defs><clipPath id="${uid}c"><path d="${bodyPath(cx, cy, L, H)}"/></clipPath>
    <linearGradient id="${uid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset="0.62" stop-color="${pal[0]}"/><stop offset="1" stop-color="${pal[1]}"/></linearGradient></defs>`;
  // Tail, then the fins behind the body.
  out += `<path d="M${f(tailX + 6)} ${f(cy)}L${f(tailX - L * 0.2)} ${f(cy - H * 0.42)}Q${f(tailX - L * 0.12)} ${f(cy)} ${f(tailX - L * 0.2)} ${f(cy + H * 0.42)}Z" fill="${pal[2]}" stroke="#14202a" stroke-width="5" stroke-linejoin="round"/>`;
  if (dorsal) out += `<path d="M${f(cx + L * 0.16)} ${f(cy - H * 0.42)}Q${f(cx)} ${f(cy - H * (0.5 + dorsal))} ${f(cx - L * 0.26)} ${f(cy - H * 0.36)}Z" fill="${pal[2]}" stroke="#14202a" stroke-width="5" stroke-linejoin="round"/>`;
  if (flat) out += `<path d="${bodyPath(cx, cy, L * 1.08, H * 1.18)}" fill="${pal[2]}" stroke="#14202a" stroke-width="5"/>`;
  out += `<path d="M${f(cx)} ${f(cy + H * 0.42)}Q${f(cx - L * 0.08)} ${f(cy + H * 0.62)} ${f(cx - L * 0.2)} ${f(cy + H * 0.4)}Z" fill="${pal[2]}" stroke="#14202a" stroke-width="5" stroke-linejoin="round"/>`;
  // The body and what's on it.
  out += `<path d="${bodyPath(cx, cy, L, H)}" fill="url(#${uid}g)"/>`;
  out += `<g clip-path="url(#${uid}c)">${pattern(kind, r, cx, cy, L, H, pal)}<ellipse cx="${f(cx + L * 0.05)}" cy="${f(cy - H * 0.24)}" rx="${f(L * 0.32)}" ry="${f(H * 0.1)}" fill="#fff" opacity="0.22"/></g>`;
  out += `<path d="${bodyPath(cx, cy, L, H)}" fill="none" stroke="#14202a" stroke-width="6" stroke-linejoin="round"/>`;
  // Pectoral fin, gill line, eye, mouth.
  out += `<path d="M${f(cx + L * 0.2)} ${f(cy + H * 0.05)}q${f(-L * 0.12)} ${f(H * 0.08)} ${f(-L * 0.16)} ${f(H * 0.24)}q${f(L * 0.1)} ${f(-H * 0.04)} ${f(L * 0.16)} ${f(-H * 0.24)}Z" fill="${pal[2]}" stroke="#14202a" stroke-width="4" stroke-linejoin="round"/>`;
  out += `<path d="M${f(cx + L * 0.24)} ${f(cy - H * 0.3)}Q${f(cx + L * 0.19)} ${f(cy)} ${f(cx + L * 0.24)} ${f(cy + H * 0.28)}" stroke="#14202a" stroke-width="4" fill="none" opacity="0.6"/>`;
  const ex = cx + L * 0.34, ey = cy - H * 0.12, er = Math.max(9, H * 0.085) * bigEye;
  out += `<circle cx="${f(ex)}" cy="${f(ey)}" r="${f(er)}" fill="#fff" stroke="#14202a" stroke-width="4"/><circle cx="${f(ex + er * 0.25)}" cy="${f(ey)}" r="${f(er * 0.5)}" fill="#14202a"/><circle cx="${f(ex + er * 0.4)}" cy="${f(ey - er * 0.25)}" r="${f(er * 0.18)}" fill="#fff"/>`;
  out += `<path d="M${f(cx + L * 0.47)} ${f(cy + H * 0.08)}q${f(-L * 0.04)} ${f(H * 0.06)} ${f(-L * 0.08)} ${f(H * 0.02)}" stroke="#14202a" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  return out + extra;
}

const outline = 'stroke="#14202a" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"';

/// Species `id`'s picture as an SVG document (square, `size` px).
export function fishSvg(id, size = 512) {
  const k = fishOf(id);
  if (!k) throw new Error(`No fish #${id}`);
  const r = rng(id * 7919 + 17), pal = k.pal, [b0, b1] = BACK[k.tier];
  let art = "";
  switch (k.shape) {
    case "slim": art = fishBody(id, k.pattern, r, pal, { L: 320, H: 96, dorsal: 0.35 }); break;
    case "torpedo": art = fishBody(id, k.pattern, r, pal, { L: 320, H: 126, dorsal: 0.3 }); break;
    case "round": art = fishBody(id, k.pattern, r, pal, { L: 250, H: 176, dorsal: 0.2 }); break;
    case "goby": art = fishBody(id, k.pattern, r, pal, { L: 280, H: 112, dorsal: 0.25, bigEye: 1.5 }); break;
    case "flat": art = fishBody(id, k.pattern, r, pal, { L: 270, H: 190, dorsal: 0, flat: true }); break;
    case "moon": art = fishBody(id, k.pattern, r, pal, { L: 250, H: 220, dorsal: 0.28 }); break;
    case "coela": art = fishBody(id, k.pattern, r, pal, { L: 330, H: 140, dorsal: 0.25,
      extra: [0.1, -0.18].map((x) => `<ellipse cx="${f(262 + 330 * x)}" cy="${f(262 + 140 * 0.55)}" rx="22" ry="13" fill="${pal[2]}" ${outline}/>`).join("") }); break;
    case "lion": {
      let spines = "";
      for (let i = 0; i < 13; i++) {
        const a = -Math.PI * 0.95 + (i / 12) * Math.PI * 0.9, x0 = 262 + Math.cos(a) * 60, y0 = 262 + Math.sin(a) * 50;
        spines += `<path d="M${f(x0)} ${f(y0)}L${f(262 + Math.cos(a) * 165)} ${f(262 + Math.sin(a) * 150)}" stroke="${i % 2 ? pal[1] : pal[0]}" stroke-width="7" stroke-linecap="round"/>`;
      }
      art = spines + fishBody(id, k.pattern, r, pal, { L: 240, H: 150, dorsal: 0 });
      break;
    }
    case "sword": art = `<path d="M${f(262 + 155)} 252L${f(262 + 270)} 246L${f(262 + 155)} 262Z" fill="${pal[2]}" ${outline}/>` + fishBody(id, k.pattern, r, pal, { L: 300, H: 112, dorsal: 0.75 }); break;
    case "stamp": {
      // On its own postage stamp: a perforated edge, a gold frame, the fish across it.
      let perf = "";
      for (let i = 0; i <= 12; i++) {
        const t = 96 + i * 26.7;
        perf += `<circle cx="${f(t)}" cy="96" r="8" fill="${b1}"/><circle cx="${f(t)}" cy="428" r="8" fill="${b1}"/><circle cx="96" cy="${f(t)}" r="8" fill="${b1}"/><circle cx="428" cy="${f(t)}" r="8" fill="${b1}"/>`;
      }
      art = `<g transform="rotate(-6 262 262)"><rect x="96" y="96" width="332" height="332" fill="#fffaf0" stroke="#14202a" stroke-width="5"/>${perf}`
        + `<rect x="126" y="126" width="272" height="272" fill="${pal[1]}" stroke="${pal[2]}" stroke-width="8"/>`
        + `<path d="M150 360h60M150 376h40" stroke="${pal[2]}" stroke-width="6" stroke-linecap="round" opacity="0.6"/></g>`
        + `<g transform="translate(262 262) scale(0.92) translate(-262 -262)">${fishBody(id, "scales", r, pal, { L: 270, H: 160, dorsal: 0.4 })}</g>`;
      for (let i = 0; i < 10; i++) art += `<path d="M${f(60 + r() * 392)} ${f(60 + r() * 392)}m-7 0l14 0m-7 -7l0 14" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.9"/>`;
      break;
    }
    case "puffer": {
      let spikes = "";
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2, x = 262 + Math.cos(a) * 112, y = 262 + Math.sin(a) * 104;
        spikes += `<path d="M${f(x - Math.sin(a) * 9)} ${f(y + Math.cos(a) * 9)}L${f(262 + Math.cos(a) * 138)} ${f(262 + Math.sin(a) * 130)}L${f(x + Math.sin(a) * 9)} ${f(y - Math.cos(a) * 9)}Z" fill="${pal[2]}" stroke="#14202a" stroke-width="3" stroke-linejoin="round"/>`;
      }
      art = spikes + `<path d="M150 262L104 222Q120 262 104 302Z" fill="${pal[2]}" ${outline}/><ellipse cx="262" cy="262" rx="118" ry="110" fill="${pal[0]}" ${outline}/>`
        + `<ellipse cx="262" cy="300" rx="90" ry="60" fill="${pal[1]}" opacity="0.8"/>${pattern("dots", r, 262, 250, 200, 150, pal)}`
        + `<circle cx="318" cy="236" r="18" fill="#fff" stroke="#14202a" stroke-width="4"/><circle cx="322" cy="236" r="9" fill="#14202a"/><ellipse cx="368" cy="276" rx="12" ry="9" fill="#14202a"/>`;
      break;
    }
    case "seahorse":
      art = `<g transform="translate(262 262) scale(1.35) translate(-300 -250)"><path d="M300 130Q352 120 360 160Q366 186 342 196L392 206Q396 222 380 224L336 222Q312 240 314 280Q318 330 286 360Q262 384 240 368Q220 352 236 334Q252 322 268 336Q282 326 276 300Q268 250 280 214Q262 196 266 168Q272 136 300 130Z" fill="${pal[0]}" ${outline}/>`
        + `<path d="M276 300Q268 250 280 214" stroke="${pal[1]}" stroke-width="16" fill="none" opacity="0.7"/><path d="M262 168Q236 186 248 214Q258 236 276 226" fill="${pal[2]}" ${outline}/>`
        + [180, 210, 240, 270, 300].map((y) => `<path d="M${f(296 + (y - 180) * 0.05)} ${y}l18 4" stroke="${pal[2]}" stroke-width="5" stroke-linecap="round"/>`).join("")
        + `<circle cx="318" cy="160" r="12" fill="#fff" stroke="#14202a" stroke-width="4"/><circle cx="321" cy="160" r="6" fill="#14202a"/></g>`;
      break;
    case "boot":
      art = `<path d="M196 130L296 130L300 290Q360 296 386 318Q404 336 396 360L176 360Q166 300 182 250Z" fill="${pal[0]}" ${outline}/>`
        + `<path d="M176 340L398 340L396 368L174 368Z" fill="${pal[2]}" ${outline}/><path d="M200 150L292 150" stroke="${pal[1]}" stroke-width="10" stroke-linecap="round"/>`
        + [190, 220, 250].map((y) => `<path d="M${y === 250 ? 214 : 218} ${y}l60 -10m-60 0l60 10" stroke="${pal[1]}" stroke-width="5" stroke-linecap="round"/>`).join("")
        + `<path d="M320 300Q330 280 350 286" stroke="#7fd0e8" stroke-width="5" fill="none"/><circle cx="356" cy="276" r="7" fill="none" stroke="#7fd0e8" stroke-width="4"/>`;
      break;
    case "bottle":
      art = `<g transform="rotate(-28 262 262)"><path d="M232 120L292 120L292 170Q340 196 340 250L340 380Q340 404 316 404L208 404Q184 404 184 380L184 250Q184 196 232 170Z" fill="${pal[0]}" fill-opacity="0.75" ${outline}/>`
        + `<rect x="228" y="96" width="68" height="34" rx="6" fill="#b88654" ${outline}/>`
        + `<path d="M214 250L310 250L310 360L214 360Z" fill="${pal[1]}" stroke="#14202a" stroke-width="4"/><path d="M226 276h72M226 298h60M226 320h68M226 342h40" stroke="#8a7a66" stroke-width="5" stroke-linecap="round"/>`
        + `<rect x="232" y="306" width="28" height="22" fill="#d9534a" stroke="#14202a" stroke-width="3"/><path d="M202 200Q214 188 230 186" stroke="#fff" stroke-width="8" fill="none" opacity="0.6" stroke-linecap="round"/></g>`;
      break;
    case "octopus": case "squid": {
      const squid = k.shape === "squid";
      let arms = "";
      for (let i = 0; i < 8; i++) {
        if (squid) {
          const x = 214 + i * 14, w = r() * 30 - 15;
          arms += `<path d="M${f(x)} 300Q${f(x + w)} ${f(350 + r() * 20)} ${f(x - w * 1.5)} ${f(400 + r() * 30)}" stroke="${pal[0]}" stroke-width="14" fill="none" stroke-linecap="round"/>`;
          continue;
        }
        // Spread round the bottom of the head, each ending in a curl.
        const a = Math.PI * (0.08 + (i / 7) * 0.84), x0 = 262 + Math.cos(a) * 84, y0 = 270 + Math.sin(a) * 24;
        const x1 = 262 + Math.cos(a) * 170, y1 = 300 + Math.sin(a) * 120, curl = (i < 4 ? -1 : 1) * 26;
        arms += `<path d="M${f(x0)} ${f(y0)}Q${f((x0 + x1) / 2 + curl)} ${f((y0 + y1) / 2 + 30)} ${f(x1)} ${f(y1)}q${f(-curl * 0.8)} 18 ${f(-curl * 0.2)} 34" stroke="#14202a" stroke-width="28" fill="none" stroke-linecap="round"/>`
          + `<path d="M${f(x0)} ${f(y0)}Q${f((x0 + x1) / 2 + curl)} ${f((y0 + y1) / 2 + 30)} ${f(x1)} ${f(y1)}q${f(-curl * 0.8)} 18 ${f(-curl * 0.2)} 34" stroke="${pal[0]}" stroke-width="18" fill="none" stroke-linecap="round"/>`;
      }
      if (squid) arms += `<path d="M228 300Q200 400 168 440M300 300Q330 400 360 446" stroke="${pal[0]}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
      const head = squid
        ? `<path d="M262 70L318 150L306 300L218 300L206 150Z" fill="${pal[0]}" ${outline}/><path d="M262 70L340 120L314 170ZM262 70L184 120L210 170Z" fill="${pal[2]}" ${outline}/>`
        : `<path d="M162 290Q150 160 262 140Q374 160 362 290Z" fill="${pal[0]}" ${outline}/>`;
      art = arms + head + pattern("dots", r, 262, squid ? 200 : 220, squid ? 90 : 190, squid ? 200 : 120, pal)
        + (squid ? `<circle cx="236" cy="262" r="20" fill="#fff" ${outline}/><circle cx="288" cy="262" r="20" fill="#fff" ${outline}/><circle cx="240" cy="264" r="10" fill="#14202a"/><circle cx="292" cy="264" r="10" fill="#14202a"/>`
          : `<circle cx="226" cy="238" r="16" fill="#fff" ${outline}/><circle cx="298" cy="238" r="16" fill="#fff" ${outline}/><circle cx="229" cy="240" r="8" fill="#14202a"/><circle cx="301" cy="240" r="8" fill="#14202a"/><path d="M244 272Q262 284 280 272" stroke="#14202a" stroke-width="5" fill="none" stroke-linecap="round"/>`);
      break;
    }
    case "manta":
      art = `<path d="M262 380Q246 440 228 470" stroke="${pal[2]}" stroke-width="8" fill="none" stroke-linecap="round"/>`
        + `<path d="M262 150Q300 160 330 200Q400 240 460 250Q400 300 320 300Q290 330 262 380Q234 330 204 300Q124 300 64 250Q124 240 194 200Q224 160 262 150Z" fill="${pal[0]}" ${outline}/>`
        + `<path d="M232 166L222 132M292 166L302 132" stroke="${pal[0]}" stroke-width="14" stroke-linecap="round"/><path d="M200 250Q262 280 324 250" stroke="${pal[1]}" stroke-width="8" fill="none" opacity="0.5"/>`
        + `<circle cx="236" cy="190" r="8" fill="#fff"/><circle cx="288" cy="190" r="8" fill="#fff"/>`;
      break;
    case "angler":
      art = `<path d="M330 150Q356 70 300 70" stroke="${pal[2]}" stroke-width="6" fill="none"/><circle cx="296" cy="70" r="20" fill="${pal[1]}" opacity="0.35"/><circle cx="296" cy="70" r="11" fill="${pal[1]}" stroke="#14202a" stroke-width="3"/>`
        + fishBody(id, "plain", r, pal, { L: 270, H: 210, dorsal: 0.12, bigEye: 0.9,
          extra: `<path d="M346 296L396 276L396 330L346 318Z" fill="#14202a"/>${[0, 1, 2, 3].map((i) => `<path d="M${352 + i * 11} 300l5 14l5 -14" fill="#fff"/>`).join("")}` });
      break;
  }
  // The water: the tier's colour, bubbles, light from above (rays for the legendary).
  let bubbles = "";
  for (let i = 0; i < 9; i++) bubbles += `<circle cx="${f(40 + r() * 432)}" cy="${f(40 + r() * 432)}" r="${f(4 + r() * 10)}" fill="none" stroke="#fff" stroke-width="2.5" opacity="${f(0.25 + r() * 0.3)}"/>`;
  const rays = k.tier === "Legendary" || k.tier === "Epic"
    ? [0, 1, 2, 3].map((i) => `<path d="M${120 + i * 90} 0L${160 + i * 90} 0L${100 + i * 110} 512L${40 + i * 110} 512Z" fill="#fff" opacity="0.07"/>`).join("") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">`
    + `<defs><radialGradient id="w${id}" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="${b0}"/><stop offset="1" stop-color="${b1}"/></radialGradient></defs>`
    + `<rect width="512" height="512" fill="url(#w${id})"/>${rays}${bubbles}${art}</svg>`;
}

/// Species `id`'s metadata, as marketplaces read it (`base` + id + ".json").
export function fishMetadata(id, site = "https://courierworld.fun") {
  const k = fishOf(id);
  return {
    name: k.name,
    description: `${k.blurb} Caught in the bay of Courier World and kept as a Courier Fish. ${k.supply ? `Only ${k.supply.toLocaleString("en")} will ever be minted.` : "This species never runs out."}`,
    image: `${site}/fish/${id}.svg`,
    external_url: `${site}/`,
    attributes: [
      { trait_type: "Rarity", value: k.tier },
      { trait_type: "Species", value: k.name },
      ...(k.supply ? [{ trait_type: "Supply", value: String(k.supply) }] : []),
    ],
  };
}

export { FISH };
