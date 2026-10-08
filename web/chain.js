// On-chain side of the game: post offices, Courier NFTs and $STAMP. Reads every second.
// Uses web/chain.json from ./dev.sh when present, otherwise the mainnet deployment.
import {
  createPublicClient, createWalletClient, createTestClient, http, custom, defineChain,
  maxUint256, zeroAddress, keccak256, encodeAbiParameters, parseSignature, decodeErrorResult, parseAbi, parseEther,
  BaseError, ContractFunctionRevertedError,
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
  Slippage: "The price moved past your slippage limit. Try again, or allow more slippage.",
  Expired: "The trade took too long and expired. Try again.",
  PartialFill: "The pool can't fill that much right now. Try a smaller amount.",
  BadAmount: "Enter an amount to trade.",
  PermitFailed: "The wallet signature didn't work. Try again.",
  TransferFailed: "A token transfer failed. Check your balance.",
};

// Uniswap v4 wraps a hook's revert; the reason inside is what the player needs.
const V4_ABI = parseAbi([
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
  "function extsload(bytes32 slot) view returns (bytes32)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const FEED_ABI = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);
const QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }",
  "function quoteExactInputSingle((PoolKey poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactInput((address exactCurrency, PathKey[] path, uint128 exactAmount) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
let knownErrors = [];

export function explain(e) {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
    let name = revert?.data?.errorName;
    if (name === "WrappedError") {
      try { name = decodeErrorResult({ abi: knownErrors, data: revert.data.args[2] }).errorName; } catch {}
    }
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
    contracts: dep.contracts.multicall3 ? { multicall3: { address: dep.contracts.multicall3 } } : undefined,
  });
  // With Multicall3 on the chain, each second's reads go out as one call.
  const pub = createPublicClient({
    chain, transport: http(dep.rpcUrl), pollingInterval: 500, batch: { multicall: !!dep.contracts.multicall3 },
  });
  const test = dep.local ? createTestClient({ chain, mode: "anvil", transport: http(dep.rpcUrl) }) : null;
  const errors = [
    ...dep.abis.stamp, ...dep.abis.nft, ...dep.abis.office,
    ...(dep.abis.hook ?? []), ...(dep.abis.router ?? []), ...(dep.abis.ethRouter ?? []), ...V4_ABI,
  ].filter((i) => i.type === "error");
  knownErrors = errors;
  const withErrors = (abi) => [...abi.filter((i) => i.type !== "error"), ...errors];
  const C = {
    stamp: { address: dep.contracts.stamp, abi: withErrors(dep.abis.stamp) },
    nft: { address: dep.contracts.nft, abi: withErrors(dep.abis.nft) },
    office: { address: dep.contracts.office, abi: withErrors(dep.abis.office) },
  };
  const read = (c, fn, args = []) => pub.readContract({ ...c, functionName: fn, args });
  // The $STAMP pool and its routers: on mainnet and on a fork (./dev.sh --fork), not on a bare local chain.
  const T = dep.contracts.hook ? {
    hook: { address: dep.contracts.hook, abi: withErrors(dep.abis.hook) },
    router: { address: dep.contracts.router, abi: withErrors(dep.abis.router) },
    ethRouter: { address: dep.contracts.ethRouter, abi: withErrors(dep.abis.ethRouter) },
    imd: { address: dep.contracts.imd, abi: withErrors(ERC20_ABI) },
    quoter: { address: dep.contracts.quoter, abi: QUOTER_ABI },
    pm: { address: dep.contracts.poolManager, abi: V4_ABI },
    ethUsd: { address: dep.contracts.ethUsd, abi: FEED_ABI },
  } : null;

  // Players log in with a browser wallet on mainnet, and on a dev chain started with ./dev.sh --wallet.
  // Otherwise a dev chain plays as Anvil's unlocked accounts. Dev tools always act through those.
  const browserWallet = !dep.local || !!dep.wallet;
  const devWallet = dep.local ? createWalletClient({ chain, transport: http(dep.rpcUrl) }) : null;
  let wallet = null, account = null, accounts = [], provider = null;
  if (dep.local) accounts = await pub.request({ method: "eth_accounts" });
  if (!browserWallet) {
    wallet = devWallet;
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
      devAccounts: !browserWallet, browserWallet,
    };
    if (!account) return s;
    const [o, pending, stampBal, eth, allowance, mine, imd] = await Promise.all([
      read(C.office, "offices", [account]), read(C.office, "pendingRewards", [account]), read(C.stamp, "balanceOf", [account]),
      pub.getBalance({ address: account }), read(C.stamp, "allowance", [account, C.office.address]),
      read(C.nft, "tokensOfOwner", [account]).then((ids) => ids.map(Number)),
      T ? read(T.imd, "balanceOf", [account]) : null,
    ]);
    s.office = { open: o[0], tier: Number(o[1]), onDuty: Number(o[2]), routesUsed: Number(o[3]), lastUpgrade: o[4], referrer: o[5], power: o[6] };
    Object.assign(s, { pending, stamp: stampBal, eth, allowance, imd });
    const [levels, duty] = await Promise.all([
      Promise.all(mine.map((id) => read(C.office, "levelOf", [BigInt(id)]))),
      Promise.all(mine.map((id) => read(C.office, "dutyOf", [BigInt(id)]))),
    ]);
    s.mine = mine.map((id, i) => ({ id, level: Number(levels[i]) + 1, onDuty: duty[i].toLowerCase() === account.toLowerCase() }));
    return s;
  }

  async function send(c, fn, args = [], value, from = account, client = wallet) {
    const hash = await client.writeContract({ ...c, functionName: fn, args, value, account: from, chain });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${fn} reverted`);
  }
  async function ensureAllowance(s, amount) {
    if (amount > 0n && s.allowance < amount) await send(C.stamp, "approve", [C.office.address, maxUint256]);
  }

  // ---------------------------------------------------------------- trading
  let poolKeys = null;
  async function keys() {
    if (!poolKeys) {
      const [stampKey, imdEth] = await Promise.all([read(T.hook, "poolKey", [C.stamp.address]), read(T.ethRouter, "imdEthKey")]);
      poolKeys = { stamp: stampKey, imdEth };
    }
    return poolKeys;
  }
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  /// $STAMP out for a buy (`amountIn` ETH or IMD), or ETH/IMD out for a sell (`amountIn` $STAMP), after every fee.
  async function quote(side, asset, amountIn) {
    const k = await keys(), S = C.stamp.address, I = T.imd.address;
    if (asset === "IMD") {
      const zeroForOne = same(k.stamp.currency0, side === "buy" ? I : S);
      const [out] = await read(T.quoter, "quoteExactInputSingle", [{ poolKey: k.stamp, zeroForOne, exactAmount: amountIn, hookData: "0x" }]);
      return out;
    }
    const hop = (to, key) => ({ intermediateCurrency: to, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks, hookData: "0x" });
    const path = side === "buy" ? [hop(I, k.imdEth), hop(S, k.stamp)] : [hop(I, k.stamp), hop(zeroAddress, k.imdEth)];
    const [out] = await read(T.quoter, "quoteExactInput", [{ exactCurrency: side === "buy" ? zeroAddress : S, path, exactAmount: amountIn }]);
    return out;
  }

  /// $STAMP's pool price, and USD through the IMD/ETH pool and Chainlink ETH/USD.
  async function market() {
    const k = await keys();
    const id = keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [k.imdEth.currency0, k.imdEth.currency1, k.imdEth.fee, k.imdEth.tickSpacing, k.imdEth.hooks],
    ));
    const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n])); // PoolManager pools mapping
    const [price, slot0, round] = await Promise.all([
      read(T.hook, "price", [C.stamp.address]), read(T.pm, "extsload", [slot]), read(T.ethUsd, "latestRoundData"),
    ]);
    const sqrtP = Number(BigInt(slot0) & ((1n << 160n) - 1n)) / 2 ** 96;
    const imdUsd = Number(round[1]) / 1e8 / (sqrtP * sqrtP); // ETH is currency0: price = IMD per ETH
    const stampImd = Number(price) / 1e18;
    return { stampImd, imdUsd, stampUsd: stampImd * imdUsd };
  }

  async function signPermit(spender, value, deadline) {
    const [nonce, domain] = await Promise.all([read(C.stamp, "nonces", [account]), read(C.stamp, "eip712Domain")]);
    const signature = await wallet.signTypedData({
      account,
      domain: { name: domain[1], version: domain[2], chainId: Number(domain[3]), verifyingContract: domain[4] },
      types: {
        Permit: [
          { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: account, spender, value, nonce, deadline },
    });
    const { r, s, v, yParity } = parseSignature(signature);
    return { r, s, v: Number(v ?? BigInt(yParity + 27)) };
  }
  const rejected = (e) => e?.code === 4001 || /reject|denied/i.test(e?.shortMessage ?? e?.message ?? "");

  async function trade({ side, asset, amountIn, minOut }) {
    const S = C.stamp.address;
    const deadline = (await pub.getBlock()).timestamp + 600n;
    if (side === "buy" && asset === "ETH") return send(T.ethRouter, "buyWithEth", [S, minOut, deadline], amountIn);
    if (side === "buy") {
      if ((await read(T.imd, "allowance", [account, T.router.address])) < amountIn) {
        await send(T.imd, "approve", [T.router.address, amountIn]);
      }
      return send(T.router, "buy", [S, amountIn, minOut, deadline]);
    }
    const [r, plain, withPermit] = asset === "ETH"
      ? [T.ethRouter, "sellForEth", "sellForEthWithPermit"]
      : [T.router, "sell", "sellWithPermit"];
    if ((await read(C.stamp, "allowance", [account, r.address])) >= amountIn) {
      return send(r, plain, [S, amountIn, minOut, deadline]);
    }
    // One signature instead of an approval transaction; wallets that can't sign typed data approve instead.
    let sig = null;
    try {
      sig = await signPermit(r.address, amountIn, deadline);
    } catch (e) {
      if (rejected(e)) throw e;
    }
    if (sig) return send(r, withPermit, [S, amountIn, minOut, deadline, sig.v, sig.r, sig.s]);
    await send(C.stamp, "approve", [r.address, amountIn]);
    return send(r, plain, [S, amountIn, minOut, deadline]);
  }

  return {
    local: dep.local,
    browserWallet,
    chainName: chain.name,
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
    trade: T ? { quote, market, execute: trade } : null,
    /// Local chain only: close the sale and reveal with the dev secret, as the owner.
    async devReveal() {
      await send(C.nft, "setSaleOpen", [false], undefined, accounts[0], devWallet);
      await send(C.nft, "reveal", [BigInt(dep.devSecret)], undefined, accounts[0], devWallet);
    },
    /// Local chain only: top up the logged-in wallet with play ETH.
    async devFund() {
      const balance = await pub.getBalance({ address: account });
      await test.setBalance({ address: account, value: balance + parseEther("10") });
    },
    async devWarp(seconds) {
      await test.increaseTime({ seconds });
      await test.mine({ blocks: 1 });
    },
  };
}
