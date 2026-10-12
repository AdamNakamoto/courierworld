// The Orb: a giant LED globe near the post office, showing paid ads. The ads are listed in orb.json
// (pictures in orb/), and only what's listed there shows, so every ad is approved before it goes up.
// (Nothing here is named "ad...": ad blockers hide such files and page elements.)
//
// Like the big LED spheres it's modelled on, an ad covers the whole globe: its colour fills the surface
// and its picture sits on the front and the back as a perfect circle, filling the face you see. A running
// ad stays on the globe until it ends; several take turns, ROTATE seconds each, at the same moment for
// everyone (it's timed from the clock). The "advertise here" card shows only when no ad is running.
import * as THREE from "https://esm.sh/three@0.160.0";
import { texFromCanvas } from "./world.js";

const ROTATE = 20; // seconds per ad
const FACE = 0.94; // the picture's radius on the globe's face (1 fills it to the outline)
export const ADVERTISE_URL = "https://x.com/PlayCourierWld";
const HOUSE = {
  house: true,
  name: "Advertise on the Orb",
  text: "Put your project in front of every courier on the planet. DM us on X.",
  url: ADVERTISE_URL,
  color: "#0b1024",
};

/// The ads in orb.json that are well-formed and running now.
function validAds(list, now = Date.now()) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const ok =
      typeof a?.name === "string" && a.name.length > 0 && a.name.length <= 40 &&
      typeof a.image === "string" && /^orb\/[a-z0-9._-]+\.(png|jpe?g|webp)$/i.test(a.image) &&
      (isHttps(a.url) || isHttps(a.chart)) && (a.url == null || isHttps(a.url)) && (a.chart == null || isHttps(a.chart)) &&
      (a.text == null || (typeof a.text === "string" && a.text.length <= 140)) &&
      (a.color == null || /^#[0-9a-f]{6}$/i.test(a.color));
    if (!ok) {
      console.warn("orb.json: skipping a malformed entry", a);
      continue;
    }
    const from = Date.parse(a.from ?? "1970-01-01"), until = Date.parse(a.until ?? "2999-01-01");
    if (now >= from && now < until) {
      out.push({ name: a.name, image: a.image, url: a.url ?? null, chart: a.chart ?? null, text: a.text ?? "", color: a.color ?? null });
    }
  }
  return out;
}
function isHttps(u) {
  try {
    return typeof u === "string" && new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}
export const domainOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/// The globe's surface: the ad's colour everywhere, its picture as a round decal on the front (+z) and
/// the back, seen straight on (so it stays a circle), all through a grid of LED dots. Unlit, so it shines
/// the same day and night.
function orbMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uBg: { value: new THREE.Color(HOUSE.color) },
      uFace: { value: FACE },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      void main() {
        vN = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uBg;
      uniform float uFace;
      varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        // Front and back faces each show the picture the right way round.
        vec2 p = vec2(n.z >= 0.0 ? n.x : -n.x, n.y) / uFace;
        vec3 col = uBg;
        float r = length(p);
        if (r < 1.0) {
          vec4 t = texture2D(uMap, p * 0.5 + 0.5);
          col = mix(col, t.rgb, t.a * smoothstep(1.0, 0.985, r));
        }
        // LED dots on a latitude-longitude grid.
        vec2 g = fract(vec2(atan(n.x, n.z) * 160.0 / 6.2831853, asin(clamp(n.y, -1.0, 1.0)) * 80.0 / 3.1415927)) - 0.5;
        float led = smoothstep(0.48, 0.28, length(g));
        col *= mix(0.62, 1.08, led);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/// A square texture of the picture, cropped to its centre if it isn't square.
function pictureTexture(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  const s = Math.min(img.width, img.height);
  g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 1024, 1024);
  const tex = texFromCanvas(c);
  tex.anisotropy = 4;
  return tex;
}

/// The colour round a picture's edge (its corners), for the rest of the globe when an ad doesn't say.
function edgeColour(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, 16, 16);
  const px = [[0, 0], [15, 0], [0, 15], [15, 15]].map(([x, y]) => g.getImageData(x, y, 1, 1).data);
  const avg = (i) => Math.round(px.reduce((s, p) => s + p[i], 0) / px.length);
  return `#${[0, 1, 2].map((i) => avg(i).toString(16).padStart(2, "0")).join("")}`;
}

/// The house card's picture: "advertise here" in neon on the dark globe.
function houseTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = HOUSE.color;
  g.fillRect(0, 0, 1024, 1024);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ffd75e";
  g.font = "400 46px Bungee, Impact, sans-serif";
  g.fillText("YOUR PROJECT ON THE ORB", 512, 300, 900);
  g.fillStyle = "#f7a8d8";
  g.font = "400 150px Bungee, Impact, sans-serif";
  g.fillText("ADVERTISE", 512, 470, 920);
  g.fillText("HERE", 512, 620, 920);
  g.fillStyle = "#5ff3ff";
  g.font = "400 56px Bungee, Impact, sans-serif";
  g.fillText("DM @PLAYCOURIERWLD", 512, 770, 900);
  return texFromCanvas(c);
}

const loadImage = (src) =>
  new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });

/// `orb`: the globe from world.js ({ mesh }). Loads orb.json, paints each ad and turns the globe.
export function createOrbAds(orb) {
  let ads = [HOUSE];
  const pictures = new Map(); // ad -> its loaded picture
  // Only the house card's texture is kept; a paid ad's is made when its turn comes and freed after, so a
  // long list of ads costs no more memory than one.
  const houseTex = houseTexture();
  const mat = orbMaterial();
  mat.uniforms.uMap.value = houseTex;
  orb.mesh.material.dispose();
  orb.mesh.material = mat;
  let shown = HOUSE;

  fetch("./orb.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { ads: [] }))
    .then(async (cfg) => {
      const paid = validAds(cfg.ads);
      for (const ad of paid) {
        const img = await loadImage(ad.image);
        if (!img) continue;
        pictures.set(ad, img);
        ad.color ??= edgeColour(img);
      }
      // The paid ads whose picture loaded, taking turns if there are several; the house card only when
      // there are none.
      const running = paid.filter((a) => pictures.has(a));
      ads = running.length ? running : [HOUSE];
    })
    .catch(() => {});

  /// The ad on the globe right now.
  const current = () => ads[Math.floor(Date.now() / 1000 / ROTATE) % ads.length];

  return {
    current,
    /// Each frame: turn slowly, and change the picture when the next ad's turn comes.
    update(dt) {
      orb.mesh.rotateY(dt * 0.1);
      const ad = current();
      if (ad !== shown) {
        shown = ad;
        const old = mat.uniforms.uMap.value;
        mat.uniforms.uMap.value = ad.house ? houseTex : pictureTexture(pictures.get(ad));
        mat.uniforms.uBg.value.set(ad.color);
        if (old !== houseTex) old.dispose();
      }
    },
  };
}
