// On-chain side of the game: post offices, Courier NFTs and $STAMP. Reads every second.
// Uses web/chain.json from ./dev.sh when present, otherwise the mainnet deployment.
import {
  createPublicClient, createWalletClient, createTestClient, http, custom, defineChain,
  maxUint256, BaseError, ContractFunctionRevertedError,
} from "https://esm.sh/viem@2";
import { pickWallet, wallets, lastWallet, rememberWallet } from "./wallet.js";

const ERROR_TEXT = {
  AlreadyOpen: "You already run a post office.",
  NotOpen: "Open a post office first.",
  WrongPayment: "The price changed. Try again.",
  NotCourierOwner: "That courier isn't yours.",
  AlreadyOnDuty: "That courier is already on duty.",
  NotOnDuty: "That courier isn't on duty.",
  NoFreeSlot: "No free desks. Upgrade your post office.",
  NotEnoughRoutes: "Not enough routes for that ride. Upgrade your post office.",
  MaxLevel: "That courier is already level 10.",
  MaxTier: "Your post office is already HQ.",
  CooldownActive: "The upgrade is still cooling down.",
  NothingToClaim: "No $STAMP to collect yet.",
  SaleClosed: "The mint is closed.",
  SoldOut: "All 3,333 couriers have been minted.",
  BadQuantity: "Mint between 1 and 10 at a time.",
  NotRevealed: "Couriers are still sealed. Wait for the reveal.",
  CourierOnDuty: "Take the courier off duty before trading it.",
  ERC20InsufficientBalance: "Not enough $STAMP.",
};

export function explain(e) {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
    const name = revert?.data?.errorName;
    if (name) return ERROR_TEXT[name] ?? name;
    if (/rejected|denied/i.test(e.shortMessage ?? "")) return "Transaction rejected in wallet.";
    return e.shortMessage ?? e.message;
  }
  return e?.message ?? String(e);
}

async function loadDeployment() {
  for (const url of ["./chain.json", "./deployments/robinhood.json"]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
}

export async function connectChain() {
  const dep = await loadDeployment();
  if (!dep) return null;
  const chain = defineChain({
    id: dep.chainId, name: dep.chainName ?? "Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    // Wallets get the official RPC; reads can use a separate (public) one.
    rpcUrls: { default: { http: [dep.walletRpcUrl ?? dep.rpcUrl] } },
    blockExplorers: dep.explorer ? { default: { name: "Blockscout", url: dep.explorer } } : undefined,
  });
  const pub = createPublicClient({ chain, transport: http(dep.rpcUrl), pollingInterval: 500 });
  const test = dep.local ? createTestClient({ chain, mode: "anvil", transport: http(dep.rpcUrl) }) : null;
  const errors = [...dep.abis.stamp, ...dep.abis.nft, ...dep.abis.office].filter((i) => i.type === "error");
  const withErrors = (abi) => [...abi.filter((i) => i.type !== "error"), ...errors];
  const C = {
    stamp: { address: dep.contracts.stamp, abi: withErrors(dep.abis.stamp) },
    nft: { address: dep.contracts.nft, abi: withErrors(dep.abis.nft) },
    office: { address: dep.contracts.office, abi: withErrors(dep.abis.office) },
  };
  const read = (c, fn, args = []) => pub.readContract({ ...c, functionName: fn, args });

  let wallet = null, account = null, accounts = [], provider = null;
  if (dep.local) {
    wallet = createWalletClient({ chain, transport: http(dep.rpcUrl) });
    accounts = await pub.request({ method: "eth_accounts" });
    let saved = null;
    try { saved = localStorage.getItem("courier:account"); } catch {}
    account = accounts.includes(saved) ? saved : accounts[2];
  }

  const tiers = [];
  {
    const n = Number(await read(C.office, "tierCount"));
    for (let i = 0; i < n; i++) {
      const [slots, routes, upgradeCost] = await read(C.office, "tiers", [BigInt(i)]);
      tiers.push({ slots, routes, upgradeCost });
    }
  }

  /// Log in with a browser wallet and make sure it's on the game's chain.
  async function useProvider(w) {
    provider = w.provider;
    wallet = createWalletClient({ chain, transport: custom(provider) });
    [account] = await wallet.requestAddresses();
    if ((await wallet.getChainId()) !== chain.id) {
      try {
        await wallet.switchChain({ id: chain.id });
      } catch {
        await wallet.addChain({ chain });
        await wallet.switchChain({ id: chain.id });
      }
    }
    rememberWallet(w.info.rdns);
    provider.on?.("accountsChanged", (a) => {
      account = a[0] ?? null;
      onAccount?.(account);
    });
    provider.on?.("chainChanged", () => location.reload());
  }
  let onAccount = null;

  async function snapshot() {
    const [block, minted, price, saleOpen, seed, totalPower, rewardPerBlock, officePrice, cooldown, levelBase] = await Promise.all([
      pub.getBlock(), read(C.nft, "totalMinted"), read(C.nft, "price"), read(C.nft, "saleOpen"), read(C.nft, "seed"),
      read(C.office, "totalPower"), read(C.office, "rewardPerBlock"), read(C.office, "officePrice"),
      read(C.office, "upgradeCooldown"), read(C.office, "levelCostBase"),
    ]);
    const s = {
      now: block.timestamp, minted: Number(minted), price, saleOpen, seed, totalPower, rewardPerBlock,
      officePrice, cooldown, levelBase, tiers, account, accounts, local: dep.local, explorer: dep.explorer,
    };
    if (!account) return s;
    const [o, pending, stampBal, eth, allowance, mine] = await Promise.all([
      read(C.office, "offices", [account]), read(C.office, "pendingRewards", [account]), read(C.stamp, "balanceOf", [account]),
      pub.getBalance({ address: account }), read(C.stamp, "allowance", [account, C.office.address]),
      read(C.nft, "tokensOfOwner", [account]).then((ids) => ids.map(Number)),
    ]);
    s.office = { open: o[0], tier: Number(o[1]), onDuty: Number(o[2]), routesUsed: Number(o[3]), lastUpgrade: o[4], referrer: o[5], power: o[6] };
    Object.assign(s, { pending, stamp: stampBal, eth, allowance });
    const [levels, duty] = await Promise.all([
      Promise.all(mine.map((id) => read(C.office, "levelOf", [BigInt(id)]))),
      Promise.all(mine.map((id) => read(C.office, "dutyOf", [BigInt(id)]))),
    ]);
    s.mine = mine.map((id, i) => ({ id, level: Number(levels[i]) + 1, onDuty: duty[i].toLowerCase() === account.toLowerCase() }));
    return s;
  }

  async function send(c, fn, args = [], value, from = account) {
    const hash = await wallet.writeContract({ ...c, functionName: fn, args, value, account: from, chain });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${fn} reverted`);
  }
  async function ensureAllowance(s, amount) {
    if (amount > 0n && s.allowance < amount) await send(C.stamp, "approve", [C.office.address, maxUint256]);
  }

  return {
    local: dep.local,
    snapshot,
    get account() { return account; },
    setAccount(a) {
      account = a;
      try { localStorage.setItem("courier:account", a); } catch {}
    },
    /// Show the wallet picker and log in. Returns false if the player closed it.
    async login() {
      const w = await pickWallet();
      if (!w) return false;
      await useProvider(w);
      return true;
    },
    /// Quietly reconnect the wallet used last time, if it's still authorised.
    async resume() {
      const rdns = lastWallet();
      const w = rdns && wallets().find((x) => x.info.rdns === rdns);
      if (!w) return false;
      const accs = await w.provider.request({ method: "eth_accounts" }).catch(() => []);
      if (!accs.length) return false;
      await useProvider(w);
      return true;
    },
    logout() {
      account = null;
      wallet = null;
      rememberWallet(null);
    },
    onAccountChange(fn) {
      onAccount = fn;
    },
    mint: (s, n) => send(C.nft, "mint", [BigInt(n)], s.price * BigInt(n)),
    openOffice: (s, ref) => send(C.office, "openOffice", [ref], s.officePrice),
    assign: (id) => send(C.office, "assign", [BigInt(id)]),
    unassign: (id) => send(C.office, "unassign", [BigInt(id)]),
    async levelUp(s, id, level) {
      const l = BigInt(level);
      await ensureAllowance(s, s.levelBase * l * l);
      await send(C.office, "levelUp", [BigInt(id)]);
    },
    async upgrade(s) {
      await ensureAllowance(s, tiers[s.office.tier + 1].upgradeCost);
      await send(C.office, "upgradeOffice");
    },
    claim: () => send(C.office, "claim"),
    /// Local chain only: close the sale and reveal with the dev secret, as the owner.
    async devReveal() {
      await send(C.nft, "setSaleOpen", [false], undefined, accounts[0]);
      await send(C.nft, "reveal", [BigInt(dep.devSecret)], undefined, accounts[0]);
    },
    async devWarp(seconds) {
      await test.increaseTime({ seconds });
      await test.mine({ blocks: 1 });
    },
  };
}
