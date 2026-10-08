import { createPublicClient, http } from "https://esm.sh/viem@2";
import { SUPPLY, PREVIEW_SEED, RIDES, courier, metadata } from "./traits.js";
import { renderStamp } from "./portrait.js";

const $ = (id) => document.getElementById(id);
const PER_PAGE = 30;
const RARITY_INK = { Common: "#5f6b6e", Uncommon: "#5e9f57", Rare: "#3f6fbf", Epic: "#8d5a99", Legendary: "#c9962a" };

let seed = PREVIEW_SEED;
let all = [];
let filter = "all";
let page = 0;
let renderToken = 0;
let art = "3d"; // "3d": the game's renderer; "chain": the SVG the contract draws
const thumbs = new Map(); // `${art}:${seed}:${id}` -> data URL

// With a local chain running, show the art exactly as CourierRenderer draws it on-chain.
let chainRenderer = null;
try {
  const dep = await fetch("./chain.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
  if (dep?.contracts?.renderer) {
    const pub = createPublicClient({ transport: http(dep.rpcUrl) });
    chainRenderer = (fn, args) => pub.readContract({ address: dep.contracts.renderer, abi: dep.abis.renderer, functionName: fn, args });
    $("artToggle").hidden = false;
  }
} catch {}

/// Art for courier `c` as a data URL, in the current mode.
async function artURL(c, size) {
  if (art === "chain") {
    const svg = await chainRenderer("previewSVG", [seed, BigInt(c.id)]);
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  return (await renderStamp(c, size)).toDataURL("image/png");
}

$("supply").textContent = SUPPLY.toLocaleString();
$("seed").value = "0x" + seed.toString(16);

function load() {
  all = Array.from({ length: SUPPLY }, (_, i) => courier(i + 1, seed));
  drawRides();
  draw();
}

function visible() {
  return filter === "all" ? all : all.filter((c) => c.ride.key === filter);
}

function drawRides() {
  const counts = Object.fromEntries(RIDES.map((r) => [r.key, 0]));
  for (const c of all) counts[c.ride.key]++;
  $("rides").innerHTML =
    `<button class="chip ${filter === "all" ? "on" : ""}" data-ride="all"><b>All</b><span>${SUPPLY.toLocaleString()}</span></button>` +
    RIDES.map((r) => `<button class="chip ${filter === r.key ? "on" : ""}" data-ride="${r.key}" style="--ink:${RARITY_INK[r.rarity]}">
        <b>${r.name}</b><span>${r.rarity} · ${counts[r.key]} · ${r.power} power · ${r.routes} route${r.routes > 1 ? "s" : ""}</span></button>`).join("");
}

async function draw() {
  const list = visible();
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  page = Math.min(page, pages - 1);
  $("page").textContent = `${page + 1} / ${pages}`;
  const slice = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  $("grid").innerHTML = slice
    .map((c) => `<button class="card" data-id="${c.id}"><img alt="Courier #${c.id}" ${thumbs.has(`${art}:${seed}:${c.id}`) ? `src="${thumbs.get(`${art}:${seed}:${c.id}`)}"` : ""}>
      <span class="meta"><b>#${c.id}</b><i style="color:${RARITY_INK[c.ride.rarity]}">${c.ride.name}</i></span></button>`)
    .join("");
  // Render missing thumbnails one at a time; a newer draw cancels this one.
  const token = ++renderToken;
  for (const c of slice) {
    const key = `${art}:${seed}:${c.id}`;
    if (thumbs.has(key)) continue;
    const url = await artURL(c, 320);
    if (token !== renderToken) return;
    thumbs.set(key, url);
    const img = $("grid").querySelector(`[data-id="${c.id}"] img`);
    if (img) img.src = thumbs.get(key);
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function open(id) {
  const c = all[id - 1];
  $("modal").hidden = false;
  $("bigName").textContent = c.name;
  $("bigRide").innerHTML = `<b style="color:${RARITY_INK[c.ride.rarity]}">${c.ride.rarity}</b> · ${c.ride.name} · ${c.ride.power} delivery power · ${c.ride.routes} route${c.ride.routes > 1 ? "s" : ""}`;
  $("traits").innerHTML = Object.entries(c.traits).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
  $("json").textContent = JSON.stringify(metadata(c, `ipfs://<images CID>/${c.id}.png`), null, 2);
  $("bigImg").removeAttribute("src");
  $("bigImg").src = await artURL(c, 768);
}

/// Render every courier at full size and bundle images + metadata into a zip.
async function exportZip() {
  if (!window.JSZip) return alert("The zip library hasn't loaded yet.");
  if (!confirm(`Render all ${SUPPLY.toLocaleString()} couriers at 1024×1024 and download a zip? This takes a few minutes.`)) return;
  const zip = new JSZip();
  const bar = $("progress");
  bar.hidden = false;
  $("export").disabled = true;
  try {
    for (const c of all) {
      const canvas = await renderStamp(c, 1024);
      const blob = await new Promise((ok) => canvas.toBlob(ok, "image/png"));
      zip.file(`images/${c.id}.png`, blob);
      zip.file(`metadata/${c.id}.json`, JSON.stringify(metadata(c, `ipfs://REPLACE_WITH_IMAGES_CID/${c.id}.png`), null, 2));
      bar.querySelector("div").style.width = `${(c.id / SUPPLY) * 100}%`;
      bar.querySelector("span").textContent = `Rendering ${c.id} / ${SUPPLY}`;
      if (c.id % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    bar.querySelector("span").textContent = "Zipping…";
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `courier-collection-${seed.toString(16)}.zip`;
    a.click();
    bar.querySelector("span").textContent = "Done";
  } finally {
    $("export").disabled = false;
  }
}

$("rides").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ride]");
  if (!b) return;
  filter = b.dataset.ride;
  page = 0;
  drawRides();
  draw();
});
$("grid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (b) open(Number(b.dataset.id));
});
$("prev").addEventListener("click", () => { if (page > 0) { page--; draw(); } });
$("next").addEventListener("click", () => { page++; draw(); });
$("close").addEventListener("click", () => ($("modal").hidden = true));
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("modal").hidden = true; });
$("seed").addEventListener("change", () => {
  try {
    seed = BigInt($("seed").value.trim());
    page = 0;
    load();
  } catch {
    $("seed").value = "0x" + seed.toString(16);
  }
});
$("export").addEventListener("click", exportZip);
$("artToggle").addEventListener("click", (e) => {
  const b = e.target.closest("[data-art]");
  if (!b) return;
  art = b.dataset.art;
  for (const x of $("artToggle").querySelectorAll("[data-art]")) x.classList.toggle("on", x.dataset.art === art);
  draw();
});

load();
