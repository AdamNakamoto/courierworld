// The Orb: a giant LED globe across the street from the post office, showing paid ads. The ads are
// listed in ads.json, and only what's listed there shows, so every ad is approved before it goes up.
// Each one shows for ROTATE seconds, in turn, at the same moment for everyone (it's timed from the clock),
// and the "advertise here" card fills the gaps.
import * as THREE from "https://esm.sh/three@0.160.0";
import { texFromCanvas } from "./world.js";

const ROTATE = 20; // seconds per ad
export const ADVERTISE_URL = "https://x.com/PlayCourierWld";
const HOUSE = {
  house: true,
  name: "Advertise on the Orb",
  text: "Put your project in front of every courier on the planet. DM us on X.",
  url: ADVERTISE_URL,
};

/// The ads in ads.json that are well-formed and running now.
function validAds(list, now = Date.now()) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const ok =
      typeof a?.name === "string" && a.name.length > 0 && a.name.length <= 40 &&
      typeof a.image === "string" && /^ads\/[a-z0-9._-]+\.(png|jpe?g|webp)$/i.test(a.image) &&
      isHttps(a.url) && (a.chart == null || isHttps(a.chart)) &&
      (a.text == null || (typeof a.text === "string" && a.text.length <= 140));
    if (!ok) {
      console.warn("ads.json: skipping a malformed ad", a);
      continue;
    }
    const from = Date.parse(a.from ?? "1970-01-01"), until = Date.parse(a.until ?? "2999-01-01");
    if (now >= from && now < until) out.push({ name: a.name, image: a.image, url: a.url, chart: a.chart ?? null, text: a.text ?? "" });
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

/// An ad as LED panels round the globe: its picture twice (front and back) on a dark screen, the
/// name under each, then the whole thing seen through a grid of LED dots.
function panelTexture(ad, img) {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, 1024);
  sky.addColorStop(0, "#0b1024");
  sky.addColorStop(0.5, "#16204a");
  sky.addColorStop(1, "#0b1024");
  g.fillStyle = sky;
  g.fillRect(0, 0, 2048, 1024);
  for (const cx of [512, 1536]) {
    const w = 600, h = 300, x = cx - w / 2, y = 512 - h / 2 - 20;
    if (img) {
      // Cover the panel, cropping the picture to 2:1 if it isn't.
      const r = Math.max(w / img.width, h / img.height), sw = w / r, sh = h / r;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
    } else {
      g.fillStyle = "#f7a8d8";
      g.font = "400 62px Bungee, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("ADVERTISE", cx, y + 95);
      g.fillText("HERE", cx, y + 170);
      g.fillStyle = "#5ff3ff";
      g.font = "400 30px Bungee, Impact, sans-serif";
      g.fillText("DM @PLAYCOURIERWLD", cx, y + 245);
    }
    g.fillStyle = "#fbf8ef";
    g.font = "400 40px Bungee, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(ad.house ? "YOUR PROJECT ON THE ORB" : ad.name.toUpperCase(), cx, y + h + 54, 640);
    g.fillStyle = "#ffd75e";
    g.font = "400 22px Bungee, Impact, sans-serif";
    g.fillText(ad.house ? "TAP THE ORB" : "AD · TAP THE ORB", cx, y - 34);
  }
  // LED dots: everything between them dimmed.
  const dot = document.createElement("canvas");
  dot.width = dot.height = 8;
  const dg = dot.getContext("2d");
  dg.fillStyle = "#3a3a3a";
  dg.fillRect(0, 0, 8, 8);
  dg.fillStyle = "#ffffff";
  dg.beginPath();
  dg.arc(4, 4, 3.1, 0, Math.PI * 2);
  dg.fill();
  g.globalCompositeOperation = "multiply";
  g.fillStyle = g.createPattern(dot, "repeat");
  g.fillRect(0, 0, 2048, 1024);
  g.globalCompositeOperation = "source-over";
  const tex = texFromCanvas(c);
  tex.anisotropy = 4;
  return tex;
}

const loadImage = (src) =>
  new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });

/// `orb`: the globe from world.js ({ mesh }). Loads ads.json, paints each ad and turns the globe.
export function createOrbAds(orb) {
  let ads = [HOUSE];
  const pictures = new Map(); // ad -> its loaded picture
  // Only the house card's texture is kept; a paid ad's is painted when its turn comes and freed after,
  // so a long list of ads costs no more memory than one.
  const houseTex = panelTexture(HOUSE, null);
  orb.mesh.material.color.set(0xffffff);
  orb.mesh.material.map = houseTex;
  orb.mesh.material.needsUpdate = true;
  let shown = HOUSE;

  fetch("./ads.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { ads: [] }))
    .then(async (cfg) => {
      const paid = validAds(cfg.ads);
      for (const ad of paid) {
        const img = await loadImage(ad.image);
        if (img) pictures.set(ad, img);
      }
      // The paid ads whose picture loaded, then the house card once a round.
      ads = [...paid.filter((a) => pictures.has(a)), HOUSE];
    })
    .catch(() => {});

  /// The ad on the globe right now.
  const current = () => ads[Math.floor(Date.now() / 1000 / ROTATE) % ads.length];

  return {
    current,
    /// Each frame: turn slowly, and change the picture when the next ad's turn comes.
    update(dt) {
      orb.mesh.rotateY(dt * 0.12);
      const ad = current();
      if (ad !== shown) {
        shown = ad;
        const old = orb.mesh.material.map;
        orb.mesh.material.map = ad.house ? houseTex : panelTexture(ad, pictures.get(ad));
        orb.mesh.material.needsUpdate = true;
        if (old !== houseTex) old.dispose();
      }
    },
  };
}
