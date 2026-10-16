// The website is the web/ folder as it is (no bundling). For static hosts that serve a build folder (the IMD backup),
// this copies it to dist/, leaving out the Vercel-only function (web/api/) and the local dev chain's chain.json.
// Vercel serves web/ directly and never runs this.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";

const from = "web", to = "dist";
rmSync(to, { recursive: true, force: true });
cpSync(from, to, {
  recursive: true,
  filter: (src) => {
    const rel = relative(from, src).split(sep).join("/");
    return rel !== "api" && !rel.startsWith("api/") && rel !== "chain.json";
  },
});
if (!existsSync(join(to, "index.html"))) throw new Error("dist/index.html is missing");
console.log(`copied ${from}/ to ${to}/`);
