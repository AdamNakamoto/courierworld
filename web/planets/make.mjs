// Writes the Courier Planets metadata the contract points marketplaces at (base https://courierworld.fun/planets/):
// <id>.json and <id>.svg for planets 1 to 333, and collection.json + collection.svg (contractURI). Everything comes
// from web/planet-looks.js, so running this again writes the same files.
//   node web/planets/make.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANET_SUPPLY, planetLook, planetMetadata, planetSvg } from "../planet-looks.js";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = "https://courierworld.fun";

for (let id = 1; id <= PLANET_SUPPLY; id++) {
  writeFileSync(join(here, `${id}.svg`), planetSvg(id, 512));
  writeFileSync(join(here, `${id}.json`), `${JSON.stringify(planetMetadata(id, SITE), null, 2)}\n`);
}

// The collection's picture: a few planets on one sky.
const PICKS = [
  { id: 6, x: 18, y: 40, size: 300 },
  { id: 3, x: 250, y: 190, size: 250 },
  { id: 27, x: 300, y: 10, size: 190 },
  { id: 4, x: 30, y: 300, size: 200 },
];
let sky = "";
for (let i = 0; i < 90; i++) {
  const x = (i * 197) % 512, y = (i * 331 + 77) % 512, r = i % 9 === 0 ? 1.6 : 0.7;
  sky += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.35 + (i % 5) * 0.12}"/>`;
}
const inner = (id) => planetSvg(id, 512).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")
  // (drop each planet's own sky and stars: the collection shares one)
  .replace(/<rect width="512" height="512" fill="url\(#p\d+sky\)"\/>/, "")
  .replace(/(<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill="#fff" opacity="[\d.]+"\/>){70}/, "");
let collection = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs><radialGradient id="csky" cx="40%" cy="35%" r="85%"><stop offset="0" stop-color="hsl(262 50% 20%)"/><stop offset="0.6" stop-color="hsl(235 45% 9%)"/><stop offset="1" stop-color="hsl(230 40% 4%)"/></radialGradient></defs>
<rect width="512" height="512" fill="url(#csky)"/>${sky}`;
for (const p of PICKS) collection += `<svg x="${p.x}" y="${p.y}" width="${p.size}" height="${p.size}" viewBox="0 0 512 512" overflow="visible">${inner(p.id)}</svg>`;
writeFileSync(join(here, "collection.svg"), `${collection}</svg>`);

writeFileSync(join(here, "collection.json"), `${JSON.stringify({
  name: "Courier Planets",
  description: "333 planets in Courier World, a tiny-planet courier game on Robinhood Chain. The planet worlds are coming to the game: each planet will be a world of its own that its owner explores and builds on, and can open to other players for a ticket in $STAMP, most of it paid to the planet's owner. Bought only with $STAMP, all of it to the Courier World treasury. Every planet has the same rights; its look comes from its number. Play: https://courierworld.fun/ - X: https://x.com/PlayCourierWld",
  image: `${SITE}/planets/collection.svg`,
  external_link: SITE,
}, null, 2)}\n`);

const counts = {};
for (let id = 1; id <= PLANET_SUPPLY; id++) counts[planetLook(id).typeName] = (counts[planetLook(id).typeName] ?? 0) + 1;
console.log(`wrote ${PLANET_SUPPLY} planets + the collection to ${here}`);
console.log(counts);
