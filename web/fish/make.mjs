// Writes the Courier Fish metadata the contract points marketplaces at (base https://courierworld.fun/fish/):
// <id>.json and <id>.svg for every species, and collection.json + collection.svg (contractURI). Everything comes from
// web/fish-kinds.js and web/fish-art.js, so running this again writes the same files.
//   node web/fish/make.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FISH, fishMetadata, fishSvg } from "../fish-art.js";

const here = dirname(fileURLToPath(import.meta.url));
const SITE = "https://courierworld.fun";

for (const k of FISH) {
  writeFileSync(join(here, `${k.id}.svg`), fishSvg(k.id, 512));
  writeFileSync(join(here, `${k.id}.json`), `${JSON.stringify(fishMetadata(k.id, SITE), null, 2)}\n`);
}

// The collection's picture: four of them, one in each corner of the bay.
const inner = (id) => fishSvg(id, 512).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
let collection = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`;
for (const [i, id] of [10, 24, 18, 16].entries()) {
  collection += `<svg x="${(i % 2) * 256}" y="${Math.floor(i / 2) * 256}" width="256" height="256" viewBox="0 0 512 512">${inner(id)}</svg>`;
}
collection += `<path d="M256 0V512M0 256H512" stroke="#14202a" stroke-width="6"/></svg>`;
writeFileSync(join(here, "collection.svg"), collection);

writeFileSync(join(here, "collection.json"), `${JSON.stringify({
  name: "Courier Fish",
  description: "Fish caught in the bay of Courier World, a tiny-planet courier game on Robinhood Chain. Fishing is free for post office owners: stand on the pier, a bridge or the beach, cast, and hook what bites. 24 species from common sardines to the Golden Stampfish, of which only 21 will ever be caught. The game's server checks every catch; players mint their own, up to 10 a day. Play: https://courierworld.fun/ - X: https://x.com/PlayCourierWld",
  image: `${SITE}/fish/collection.svg`,
  external_link: SITE,
}, null, 2)}\n`);
console.log(`wrote ${FISH.length} species + the collection to ${here}`);
