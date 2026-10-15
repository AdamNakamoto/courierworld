// Courier Planets: each planet's look, drawn from its number alone (1 to 333), so the game, the Post Office panel
// and the metadata (web/planets/<id>.json, made by web/planets/make.mjs) always agree. Cosmetic only: every planet
// has the same rights in the game. No imports and no DOM, so Node can run it too.

export const PLANET_SUPPLY = 333;

/// The kinds of world, with how often each comes up (out of 100). `pal`: HSL colours (hue, saturation %, lightness %)
/// for the surface's base, its light side, its dark side and its features; `glow`: the atmosphere.
export const PLANET_TYPES = [
  { key: "verdant", name: "Verdant", weight: 16, surface: "continents", pal: { base: [205, 62, 42], light: [195, 70, 62], dark: [215, 70, 20], feat: [110, 45, 42], feat2: [42, 40, 55] }, glow: [195, 90, 70] },
  { key: "ocean", name: "Ocean", weight: 13, surface: "islands", pal: { base: [212, 72, 38], light: [200, 80, 58], dark: [222, 78, 16], feat: [160, 40, 48], feat2: [48, 55, 70] }, glow: [200, 95, 72] },
  { key: "desert", name: "Desert", weight: 13, surface: "dunes", pal: { base: [16, 58, 48], light: [26, 70, 66], dark: [8, 55, 20], feat: [36, 60, 66], feat2: [8, 50, 34] }, glow: [20, 85, 66] },
  { key: "ice", name: "Ice", weight: 11, surface: "cracks", pal: { base: [196, 45, 80], light: [190, 60, 93], dark: [210, 45, 40], feat: [200, 70, 62], feat2: [0, 0, 98] }, glow: [190, 90, 85] },
  { key: "gas", name: "Gas giant", weight: 13, surface: "bands", pal: { base: [28, 55, 58], light: [36, 70, 75], dark: [18, 50, 22], feat: [14, 55, 46], feat2: [40, 45, 82] }, glow: [30, 80, 70] },
  { key: "rocky", name: "Rocky", weight: 10, surface: "craters", pal: { base: [25, 8, 50], light: [30, 10, 72], dark: [230, 10, 18], feat: [20, 8, 36], feat2: [30, 10, 66] }, glow: [220, 30, 75] },
  { key: "lava", name: "Lava", weight: 8, surface: "rivers", pal: { base: [10, 20, 18], light: [15, 25, 34], dark: [0, 25, 6], feat: [22, 100, 55], feat2: [45, 100, 62] }, glow: [18, 100, 58] },
  { key: "toxic", name: "Toxic", weight: 7, surface: "haze", pal: { base: [78, 55, 45], light: [70, 70, 62], dark: [95, 50, 18], feat: [60, 75, 52], feat2: [120, 45, 38] }, glow: [80, 95, 60] },
  { key: "crystal", name: "Crystal", weight: 6, surface: "facets", pal: { base: [282, 45, 52], light: [300, 70, 78], dark: [265, 55, 22], feat: [320, 70, 68], feat2: [190, 80, 75] }, glow: [295, 90, 78] },
  { key: "candy", name: "Candy", weight: 2, surface: "swirls", pal: { base: [330, 70, 72], light: [340, 85, 86], dark: [300, 45, 40], feat: [190, 75, 70], feat2: [55, 90, 78] }, glow: [330, 95, 85] },
  { key: "golden", name: "Golden", weight: 1, surface: "bands", pal: { base: [38, 82, 44], light: [44, 90, 60], dark: [26, 80, 18], feat: [32, 88, 34], feat2: [45, 95, 58] }, glow: [40, 100, 58] },
];
const TOTAL_WEIGHT = PLANET_TYPES.reduce((n, t) => n + t.weight, 0);

/// The night sky round each planet.
export const PLANET_SKIES = [
  { name: "Midnight", hue: 228, sat: 45, weight: 40 },
  { name: "Violet nebula", hue: 275, sat: 55, weight: 22 },
  { name: "Teal nebula", hue: 185, sat: 55, weight: 18 },
  { name: "Rose nebula", hue: 335, sat: 50, weight: 14 },
  { name: "Ember nebula", hue: 18, sat: 60, weight: 6 },
];
const SKY_WEIGHT = PLANET_SKIES.reduce((n, t) => n + t.weight, 0);

/// A small, fast PRNG (mulberry32) seeded from the planet's number: the same number always draws the same planet.
function rng(id, salt) {
  let h = 1779033703 ^ salt;
  for (const c of `courier-planet-${id}`) {
    h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickWeighted = (list, total, r) => {
  let x = r * total;
  for (const item of list) if ((x -= item.weight) < 0) return item;
  return list[list.length - 1];
};

/// Planet `id`'s look: its type, sky, rings, moons and the numbers the picture is drawn from. Traits are what the
/// metadata lists; everything else only shapes the picture.
export function planetLook(id) {
  if (!Number.isInteger(id) || id < 1 || id > PLANET_SUPPLY) throw new Error(`No planet #${id}`);
  const r = rng(id, 0x9e3779b9);
  const type = pickWeighted(PLANET_TYPES, TOTAL_WEIGHT, r());
  const sky = pickWeighted(PLANET_SKIES, SKY_WEIGHT, r());
  const hueShift = Math.round((r() - 0.5) * 24); // each planet's own tint of its type's colours
  // Gas giants, golden and crystal worlds wear rings more often than the rest.
  const ringChance = { gas: 0.7, golden: 0.9, crystal: 0.5, candy: 0.5 }[type.key] ?? 0.22;
  const ringRoll = r();
  // (The rarest kind always wears two.)
  const rings = type.key === "golden" ? "Double" : ringRoll < ringChance ? (ringRoll < ringChance * 0.35 ? "Double" : "Single") : "None";
  const moonRoll = r();
  const moons = moonRoll < 0.34 ? 0 : moonRoll < 0.7 ? 1 : moonRoll < 0.9 ? 2 : 3;
  const tilt = Math.round((r() - 0.5) * 50); // the planet's axis, in degrees
  return {
    id, type: type.key, typeName: type.name, surface: type.surface, sky: sky.name, rings, moons, tilt, hueShift,
    seed: Math.floor(r() * 2 ** 31),
    traits: [
      { trait_type: "Type", value: type.name },
      { trait_type: "Surface", value: type.surface[0].toUpperCase() + type.surface.slice(1) },
      { trait_type: "Rings", value: rings },
      { trait_type: "Moons", value: String(moons) },
      { trait_type: "Sky", value: sky.name },
    ],
  };
}

const hsl = ([h, s, l], shift = 0, dl = 0) => `hsl(${(((h + shift) % 360) + 360) % 360} ${s}% ${Math.max(0, Math.min(100, l + dl))}%)`;
const f = (n) => Math.round(n * 10) / 10;

/// A closed, smooth blob round (cx, cy): `n` points at radius `rad` give or take `wobble`.
function blob(r, cx, cy, rad, n, wobble, stretch = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = rad * (1 - wobble + r() * wobble * 2);
    pts.push([cx + Math.cos(a) * k * stretch, cy + Math.sin(a) * k]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let d = `M${f(mid(pts[n - 1], pts[0])[0])} ${f(mid(pts[n - 1], pts[0])[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], m = mid(p, pts[(i + 1) % n]);
    d += `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
  }
  return `${d}Z`;
}

/// A wavy band across the planet from y0 to y1 (in the planet's own frame, centred on 0).
function band(r, y0, y1, R) {
  const amp = (y1 - y0) * (0.15 + r() * 0.25), waves = 2 + Math.floor(r() * 4), ph = r() * Math.PI * 2;
  const top = [], bottom = [];
  for (let i = 0; i <= 16; i++) {
    const x = -R + (2 * R * i) / 16, w = Math.sin((i / 16) * Math.PI * waves + ph) * amp;
    top.push(`${f(x)} ${f(y0 + w)}`);
    bottom.unshift(`${f(x)} ${f(y1 + w * 0.6)}`);
  }
  return `M${top.join("L")}L${bottom.join("L")}Z`;
}

/// Planet `id`'s picture as an SVG document (square, `size` px).
export function planetSvg(id, size = 512) {
  const L = planetLook(id), T = PLANET_TYPES.find((t) => t.key === L.type), P = T.pal, sh = L.hueShift;
  const r = rng(id, L.seed), S = 512, cx = 256, cy = 262, R = L.rings === "None" ? 150 : 128;
  const uid = `p${id}`;
  const sky = PLANET_SKIES.find((s) => s.name === L.sky);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${size}" height="${size}">`;
  out += `<defs>
    <radialGradient id="${uid}sky" cx="${f(30 + r() * 40)}%" cy="${f(25 + r() * 40)}%" r="85%"><stop offset="0" stop-color="hsl(${sky.hue} ${sky.sat}% 22%)"/><stop offset="0.55" stop-color="hsl(${sky.hue} ${sky.sat}% 9%)"/><stop offset="1" stop-color="hsl(${sky.hue} 40% 4%)"/></radialGradient>
    <radialGradient id="${uid}body" cx="36%" cy="32%" r="78%"><stop offset="0" stop-color="${hsl(P.light, sh)}"/><stop offset="0.5" stop-color="${hsl(P.base, sh)}"/><stop offset="1" stop-color="${hsl(P.dark, sh)}"/></radialGradient>
    <radialGradient id="${uid}shade" cx="34%" cy="30%" r="82%"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="0.85" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></radialGradient>
    <radialGradient id="${uid}glow" cx="50%" cy="50%" r="50%"><stop offset="0.78" stop-color="${hsl(T.glow, sh)}" stop-opacity="0"/><stop offset="0.86" stop-color="${hsl(T.glow, sh)}" stop-opacity="0.45"/><stop offset="1" stop-color="${hsl(T.glow, sh)}" stop-opacity="0"/></radialGradient>
    <clipPath id="${uid}clip"><circle cx="0" cy="0" r="${R}"/></clipPath>
    <clipPath id="${uid}back"><rect x="-400" y="-400" width="800" height="400"/></clipPath>
    <clipPath id="${uid}front"><rect x="-400" y="0" width="800" height="400"/></clipPath>
    <filter id="${uid}soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="${uid}hot" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
  out += `<rect width="${S}" height="${S}" fill="url(#${uid}sky)"/>`;
  // Stars, a few of them brighter.
  let stars = "";
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, big = r() < 0.12;
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${big ? f(1.2 + r()) : f(0.4 + r() * 0.7)}" fill="#fff" opacity="${f(0.35 + r() * 0.6)}"/>`;
  }
  out += stars;

  // Rings: a tilted ellipse, its far half behind the planet and its near half in front.
  const ringTilt = L.tilt - 12, ringRx = R * 1.7, ringRy = R * (0.32 + r() * 0.12);
  const ringCol = hsl(P.feat2, sh), ringCol2 = hsl(P.light, sh, -8);
  const ring = (clip) => {
    let g = `<g transform="translate(${cx} ${cy}) rotate(${ringTilt})"><g clip-path="url(#${uid}${clip})">`;
    g += `<ellipse rx="${f(ringRx)}" ry="${f(ringRy)}" fill="none" stroke="${ringCol}" stroke-width="${f(R * 0.16)}" opacity="0.75"/>`;
    if (L.rings === "Double") g += `<ellipse rx="${f(ringRx * 1.14)}" ry="${f(ringRy * 1.16)}" fill="none" stroke="${ringCol2}" stroke-width="${f(R * 0.06)}" opacity="0.6"/>`;
    g += `<ellipse rx="${f(ringRx * 0.9)}" ry="${f(ringRy * 0.9)}" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.35"/>`;
    return `${g}</g></g>`;
  };
  if (L.rings !== "None") out += ring("back");

  // The planet: its body, the surface (in the planet's own tilted frame), shading, and the atmosphere's rim.
  out += `<circle cx="${cx}" cy="${cy}" r="${f(R * 1.16)}" fill="url(#${uid}glow)"/>`;
  out += `<g transform="translate(${cx} ${cy})"><circle r="${R}" fill="url(#${uid}body)"/><g clip-path="url(#${uid}clip)"><g transform="rotate(${L.tilt})">`;
  const feat = hsl(P.feat, sh), feat2 = hsl(P.feat2, sh), dark = hsl(P.dark, sh), light = hsl(P.light, sh);
  let surf = "";
  switch (L.surface) {
    case "continents":
    case "islands": {
      const n = L.surface === "continents" ? 4 + Math.floor(r() * 3) : 7 + Math.floor(r() * 6);
      const size = L.surface === "continents" ? [0.32, 0.22] : [0.12, 0.08];
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = r() * R * 0.85, rad = R * (size[0] * r() + size[1]);
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        surf += `<path d="${blob(r, x, y, rad, 9, 0.35, 1 + r() * 0.6)}" fill="${feat}"/>`;
        if (r() < 0.6) surf += `<path d="${blob(r, x + rad * 0.15, y - rad * 0.1, rad * 0.45, 7, 0.3)}" fill="${feat2}" opacity="0.65"/>`;
      }
      if (r() < 0.75) surf += `<ellipse cx="0" cy="${-R}" rx="${f(R * 0.7)}" ry="${f(R * 0.2)}" fill="#fff" opacity="0.85"/><ellipse cx="0" cy="${R}" rx="${f(R * 0.6)}" ry="${f(R * 0.16)}" fill="#fff" opacity="0.8"/>`;
      // Clouds.
      for (let i = 0; i < 6; i++) {
        const x = (r() - 0.5) * R * 1.8, y = (r() - 0.5) * R * 1.6;
        surf += `<path d="${blob(r, x, y, R * (0.08 + r() * 0.08), 8, 0.4, 2.2 + r() * 1.5)}" fill="#fff" opacity="${f(0.35 + r() * 0.3)}" filter="url(#${uid}soft)"/>`;
      }
      break;
    }
    case "dunes": {
      // Sand seas, dune ridges, a canyon or two and old craters.
      for (let i = 0; i < 6; i++) surf += `<path d="${blob(r, (r() - 0.5) * R * 1.6, (r() - 0.5) * R * 1.6, R * (0.18 + r() * 0.22), 9, 0.35, 1 + r())}" fill="${feat}" opacity="${f(0.35 + r() * 0.3)}"/>`;
      for (let i = 0; i < 9; i++) {
        const x = (r() - 0.5) * R * 1.6, y = (r() - 0.5) * R * 1.6, w = R * (0.12 + r() * 0.16);
        surf += `<path d="M${f(x - w)} ${f(y)}Q${f(x)} ${f(y - w * 0.55)} ${f(x + w)} ${f(y)}" fill="none" stroke="${light}" stroke-width="${f(1.5 + r() * 2)}" stroke-linecap="round" opacity="0.55"/>`;
      }
      for (let i = 0; i < 2; i++) {
        let x = -R, y = (r() - 0.5) * R * 1.2, d = `M${f(x)} ${f(y)}`;
        while (x < R) {
          x += R * (0.12 + r() * 0.1);
          y += (r() - 0.5) * R * 0.25;
          d += `L${f(x)} ${f(y)}`;
        }
        surf += `<path d="${d}" fill="none" stroke="${feat2}" stroke-width="${f(3 + r() * 4)}" stroke-linejoin="round" opacity="0.7"/>`;
      }
      for (let i = 0; i < 6; i++) {
        const x = (r() - 0.5) * R * 1.7, y = (r() - 0.5) * R * 1.7, cr = R * (0.04 + r() * 0.08);
        surf += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(cr)}" fill="${dark}" opacity="0.35"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(cr)}" fill="none" stroke="${light}" stroke-width="1.2" opacity="0.4"/>`;
      }
      break;
    }
    case "bands":
    case "haze": {
      const n = 7 + Math.floor(r() * 6);
      let y = -R * 1.05;
      for (let i = 0; i < n && y < R; i++) {
        const h = ((R * 2.1) / n) * (0.5 + r());
        const col = [feat, feat2, light, dark][Math.floor(r() * 4)];
        surf += `<path d="${band(r, y, y + h, R * 1.1)}" fill="${col}" opacity="${f(L.surface === "haze" ? 0.35 + r() * 0.25 : 0.45 + r() * 0.4)}"${L.surface === "haze" ? ` filter="url(#${uid}soft)"` : ""}/>`;
        y += h;
      }
      if (L.surface === "bands" && r() < 0.8) {
        const sx = (r() - 0.5) * R, sy = (r() - 0.3) * R * 0.8, sw = R * (0.18 + r() * 0.12);
        surf += `<ellipse cx="${f(sx)}" cy="${f(sy)}" rx="${f(sw)}" ry="${f(sw * 0.55)}" fill="${feat}" opacity="0.9"/><ellipse cx="${f(sx)}" cy="${f(sy)}" rx="${f(sw * 0.6)}" ry="${f(sw * 0.3)}" fill="${feat2}" opacity="0.8"/>`;
      }
      if (L.type === "golden") for (let i = 0; i < 14; i++) surf += `<circle cx="${f((r() - 0.5) * R * 1.8)}" cy="${f((r() - 0.5) * R * 1.8)}" r="${f(1 + r() * 2.5)}" fill="#fff" opacity="${f(0.5 + r() * 0.5)}"/>`;
      break;
    }
    case "craters": {
      for (let i = 0; i < 16; i++) {
        const x = (r() - 0.5) * R * 1.9, y = (r() - 0.5) * R * 1.9, cr = R * (0.04 + r() * r() * 0.22);
        surf += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(cr)}" fill="${feat}" opacity="0.75"/><circle cx="${f(x - cr * 0.18)}" cy="${f(y - cr * 0.18)}" r="${f(cr * 0.8)}" fill="${dark}" opacity="0.35"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(cr)}" fill="none" stroke="${feat2}" stroke-width="${f(Math.max(1, cr * 0.12))}" opacity="0.6"/>`;
      }
      break;
    }
    case "cracks":
    case "rivers": {
      const hot = L.surface === "rivers";
      if (!hot) for (let i = 0; i < 5; i++) surf += `<path d="${blob(r, (r() - 0.5) * R * 1.4, (r() - 0.5) * R * 1.4, R * (0.15 + r() * 0.2), 8, 0.35)}" fill="${feat2}" opacity="0.55"/>`;
      for (let i = 0; i < (hot ? 9 : 7); i++) {
        let x = (r() - 0.5) * R * 1.8, y = (r() - 0.5) * R * 1.8, a = r() * Math.PI * 2, d = `M${f(x)} ${f(y)}`;
        for (let k = 0; k < 6 + Math.floor(r() * 6); k++) {
          a += (r() - 0.5) * 1.3;
          x += Math.cos(a) * R * 0.12;
          y += Math.sin(a) * R * 0.12;
          d += `L${f(x)} ${f(y)}`;
        }
        surf += `<path d="${d}" fill="none" stroke="${hot ? hsl(P.feat2, sh) : feat}" stroke-width="${f(hot ? 3 + r() * 3 : 1.5 + r() * 2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${hot ? 0.95 : 0.7}"${hot ? ` filter="url(#${uid}hot)"` : ""}/>`;
      }
      if (hot) for (let i = 0; i < 4; i++) surf += `<circle cx="${f((r() - 0.5) * R * 1.5)}" cy="${f((r() - 0.5) * R * 1.5)}" r="${f(R * (0.05 + r() * 0.06))}" fill="${feat}" opacity="0.9" filter="url(#${uid}hot)"/>`;
      break;
    }
    case "facets": {
      const pts = Array.from({ length: 18 }, () => [(r() - 0.5) * R * 2.2, (r() - 0.5) * R * 2.2]);
      for (let i = 0; i < 16; i++) {
        const a = pts[i], b = pts[(i + 3) % pts.length], c = pts[(i + 7) % pts.length];
        surf += `<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}L${f(c[0])} ${f(c[1])}Z" fill="${[feat, feat2, light, dark][i % 4]}" opacity="${f(0.25 + r() * 0.35)}"/>`;
      }
      break;
    }
    case "swirls": {
      for (let i = 0; i < 7; i++) {
        const rad = R * (0.2 + i * 0.13);
        surf += `<circle cx="${f((r() - 0.5) * R * 0.4)}" cy="${f((r() - 0.5) * R * 0.4)}" r="${f(rad)}" fill="none" stroke="${[feat, feat2, light][i % 3]}" stroke-width="${f(R * 0.07)}" stroke-dasharray="${f(rad * 0.9)} ${f(rad * 0.5)}" opacity="0.75"/>`;
      }
      break;
    }
  }
  out += surf;
  out += `</g></g><circle r="${R}" fill="url(#${uid}shade)"/><circle r="${R}" fill="none" stroke="${hsl(T.glow, sh)}" stroke-width="2" opacity="0.55"/></g>`;
  if (L.rings !== "None") out += ring("front");

  // Moons, kept clear of the planet and its rings.
  for (let i = 0; i < L.moons; i++) {
    const a = -Math.PI * 0.85 + i * 1.9 + r() * 0.6, d = R * (L.rings === "None" ? 1.38 : 1.95) + r() * 18;
    const mx = Math.max(30, Math.min(S - 30, cx + Math.cos(a) * d)), my = Math.max(30, Math.min(S - 30, cy + Math.sin(a) * d * 0.8));
    const mr = 9 + r() * 12, mh = Math.floor(r() * 360);
    out += `<clipPath id="${uid}m${i}"><circle cx="${f(mx)}" cy="${f(my)}" r="${f(mr)}"/></clipPath>
      <circle cx="${f(mx)}" cy="${f(my)}" r="${f(mr)}" fill="hsl(${mh} 12% 62%)"/><circle cx="${f(mx + mr * 0.35)}" cy="${f(my + mr * 0.3)}" r="${f(mr)}" fill="#000" opacity="0.5" clip-path="url(#${uid}m${i})"/>`;
  }
  return `${out}</svg>`;
}

/// Planet `id`'s metadata, as marketplaces read it (`base` + id + ".json").
export function planetMetadata(id, site = "https://courierworld.fun") {
  const L = planetLook(id);
  return {
    name: `Planet #${id}`,
    description: `${/^[AEIOU]/.test(L.typeName) ? "An" : "A"} ${L.type === "gas" ? "gas giant" : `${L.typeName.toLowerCase()} world`} in Courier World, one of 333 Courier Planets. The planet worlds are coming to the game: each planet will be a world of its own that its owner explores and builds on, and can open to other players for a ticket in $STAMP. Every planet has the same rights in the game; its look comes from its number.`,
    image: `${site}/planets/${id}.svg`,
    external_url: `${site}/`,
    attributes: L.traits,
  };
}
