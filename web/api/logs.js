// A narrow relay to Robinhood Chain's official RPC, for the post office leaderboard. The official RPC
// is the only public one that serves the OfficeOpened history, and some internet providers block its
// domain, so the site falls back to reading it through here. Only the block number and the post
// office's own events pass; anything else is refused, so this can't be used as a free RPC.
export const config = { runtime: "edge" };

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const OFFICE = "0x26d80804d0fa2f4598369e0062bfc9536d115d82";

const allowed = (c) =>
  c && typeof c === "object" &&
  (c.method === "eth_blockNumber" || c.method === "eth_chainId" ||
    (c.method === "eth_getLogs" && String(c.params?.[0]?.address ?? "").toLowerCase() === OFFICE));

const json = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "POST a JSON-RPC request" }, 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Not JSON" }, 400);
  }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 20 || !calls.every(allowed)) return json({ error: "Not allowed" }, 403);
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return json(await r.text(), r.status);
}
