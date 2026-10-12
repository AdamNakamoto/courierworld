// The launchpad's rules for what the game shows, shared by the game and the multiplayer server (which
// hosts the token pictures). The contract takes any name and symbol; the game hides tokens that break these
// rules, and any on the hide list (pad-hidden.json), but they still trade on-chain.
import { offensive } from "./name-rules.js";

export const NAME_MAX = 32; // bytes, as the contract counts them
export const SYMBOL = /^[A-Z0-9]{1,12}$/; // what the launch form allows
export const DESCRIPTION_MAX = 280;
export const IMAGE_MAX_BYTES = 160_000; // after the game shrinks it to 512 px
export const IMAGE_SIZE = 512;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Symbols and names players would read as the game's own tokens, or the chain's money.
const RESERVED_SYMBOLS = new Set(["STAMP", "IMD", "ETH", "WETH", "USDC", "USDT", "USDG", "COURIER", "SKINS", "SKIN"]);
const RESERVED_NAMES = ["courier world", "courierworld", "identity.md", "courier skins"];

const bytes = (s) => new TextEncoder().encode(s).length;

/// Why a new token's name and symbol can't be launched from the game, or null.
export function launchProblem(name, symbol) {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return "Give your token a name.";
  if (bytes(n) > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  if (!SYMBOL.test(symbol ?? "")) return "Use 1 to 12 capital letters or numbers for the symbol.";
  if (RESERVED_SYMBOLS.has(symbol) || RESERVED_NAMES.includes(n.toLowerCase())) return "That's one of the game's own names. Pick another.";
  if (offensive(n) || offensive(symbol)) return "Pick a different name.";
  return null;
}

/// Whether the game shows a launched token at all.
export const tokenShown = (t, hidden = new Set()) =>
  !hidden.has(t.address.toLowerCase()) && t.name.trim() !== "" && launchProblem(t.name, String(t.symbol).toUpperCase()) === null;

/// The message a wallet signs to upload a token picture (free, no transaction).
export const imageMessage = (wallet, hash, time) =>
  `Courier World: upload a picture for a token on the launchpad.\n\nPicture: ${hash}\nWallet: ${wallet}\nTime: ${time}\n\nSigning is free and sends no transaction.`;

const https = (u) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
const handle = (h) => (typeof h === "string" && /^@?[A-Za-z0-9_]{1,32}$/.test(h.trim()) ? h.trim().replace(/^@/, "") : null);

/// The token's description as the contract stores it (JSON, at most 2048 bytes).
export function buildMeta({ image, description, website, x, telegram }) {
  const m = {};
  if (image) m.image = image;
  if (description?.trim()) m.description = description.trim().slice(0, DESCRIPTION_MAX);
  if (website?.trim()) m.website = website.trim();
  if (x?.trim()) m.x = x.trim();
  if (telegram?.trim()) m.telegram = telegram.trim();
  return JSON.stringify(m);
}

/// A token's metadata, read safely: only https links (and pictures from `imageHosts`), X and Telegram as handles.
export function parseMeta(raw, imageHosts = []) {
  let m = {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") m = v;
  } catch {}
  const out = {};
  // Pictures only from the game's own picture host (`imageHosts`: prefixes up to the hash), by their hash.
  const host = typeof m.image === "string" ? imageHosts.find((h) => m.image.startsWith(h)) : null;
  if (host && /^[0-9a-f]{64}$/.test(m.image.slice(host.length))) out.image = m.image;
  if (typeof m.description === "string") out.description = offensive(m.description) ? "" : m.description.slice(0, DESCRIPTION_MAX);
  if (typeof m.website === "string") out.website = https(m.website);
  const xh = handle(m.x?.replace?.(/^https:\/\/(x|twitter)\.com\//, ""));
  if (xh) out.x = `https://x.com/${xh}`;
  const tg = handle(m.telegram?.replace?.(/^https:\/\/t\.me\//, ""));
  if (tg) out.telegram = `https://t.me/${tg}`;
  return out;
}
