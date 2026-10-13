// On-chain side of the game: post offices, Courier NFTs and $STAMP. Reads every second.
// Uses web/chain.json from ./dev.sh when present, otherwise the mainnet deployment.
import {
  createPublicClient, createWalletClient, createTestClient, http, custom, defineChain,
  maxUint256, zeroAddress, keccak256, encodeAbiParameters, parseSignature, decodeErrorResult, parseAbi, parseAbiItem, parseEther, parseEventLogs,
  BaseError, ContractFunctionRevertedError,
} from "https://esm.sh/viem@2";
import { pickWallet, wallets, lastWallet, rememberWallet } from "./wallet.js";

const ERROR_TEXT = {
  // Courier Skins for $STAMP (SkinsStampSale)
  Closed: "Paying in $STAMP is paused right now. You can still pay in ETH.",
  NeedsTopUp: "The $STAMP sale needs topping up. Pay in ETH for now, or try again soon.",
  PriceChanged: "The $STAMP price just went up. Check the new price and try again.",
  ERC2612ExpiredSignature: "The signature expired. Try again.",
  ERC2612InvalidSigner: "The wallet signature didn't match. Try again.",
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
  SoldOut: "Sold out: every one has been minted.",
  BadQuantity: "Mint between 1 and 10 at a time.",
  NotRevealed: "Still sealed. Wait for the reveal.",
  CourierOnDuty: "Take the courier off duty before trading it.",
  ERC20InsufficientBalance: "Not enough tokens for that.",
  // The launchpad (CourierPad)
  NoPostOffice: "Open a post office first: only post office owners can launch.",
  FeeChanged: "The launch fee just went up. Check the new fee and try again.",
  StartTickChanged: "The starting price for new tokens just changed. Check it and try again.",
  DustSwap: "That amount is too small to trade.",
  FeeTooHigh: "That fee is above the launchpad's limit (100,000 $STAMP).",
  BadMetadata: "Check the name (up to 32 characters), symbol (up to 12) and description.",
  Slippage: "The price moved past your slippage limit. Try again, or allow more slippage.",
  Expired: "The trade took too long and expired. Try again.",
  PartialFill: "The pool can't fill that much right now. Try a smaller amount.",
  BadAmount: "Enter an amount to trade.",
  PermitFailed: "The wallet signature didn't work. Try again.",
  TransferFailed: "A token transfer failed. Check your balance.",
  PriceLimitAlreadyExceeded: "The pool doesn't hold any IMD to pay for sells right now.",
  SaleStillOpen: "Close the sale first, then reveal.",
  RevealTooSoon: "The sale was closed moments ago: wait about 15 seconds, then reveal.",
  BadSecret: "That isn't this collection's reveal secret.",
  ZeroPrice: "The price can't be zero.",
  // The treasure hunt (TokenDrops)
  NoOffice: "Open a post office first: only post office owners can claim treasure.",
  NothingToClaim: "Nothing to claim right now: the day's coins may all be claimed already (each day pays a set number across everyone), or you've had a wallet's most for the day. New coins come out at 00:00 UTC.",
  IsPaused: "Treasure claims are paused right now. Your finds stay claimable until the day after.",
  TooLate: "Those finds are too old to claim: claim by the end of the next day (UTC).",
  NotRunning: "That drop isn't running.",
  BadDrop: "Check the drop's settings: coins out (1 to 48), a wallet's daily coins (up to that), coins paid a day across everyone (a wallet's to 10,000), days (1 to 365), starting within a year.",
  StillRunning: "Players can still claim from this drop: withdraw the day after it ends.",
};

// Uniswap v4 wraps a hook's revert; the reason inside is what the player needs.
const V4_ABI = parseAbi([
  "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
  "error PriceLimitAlreadyExceeded(uint160 sqrtPriceCurrentX96, uint160 sqrtPriceLimitX96)",
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
  // Stage 1 of the launch has only the couriers; the game (token, post office, pool) comes after the reveal.
  const game = !!dep.contracts.office;
  const errors = [
    ...dep.abis.nft, ...(dep.abis.stamp ?? []), ...(dep.abis.office ?? []),
    ...(dep.abis.hook ?? []), ...(dep.abis.router ?? []), ...(dep.abis.ethRouter ?? []), ...(dep.abis.skins ?? []), ...(dep.abis.skinsStamp ?? []),
    ...(dep.abis.pad ?? []), ...(dep.abis.drops ?? []), ...V4_ABI,
  ].filter((i) => i.type === "error");
  knownErrors = errors;
  const withErrors = (abi) => [...abi.filter((i) => i.type !== "error"), ...errors];
  const C = {
    nft: { address: dep.contracts.nft, abi: withErrors(dep.abis.nft) },
    stamp: game ? { address: dep.contracts.stamp, abi: withErrors(dep.abis.stamp) } : null,
    office: game ? { address: dep.contracts.office, abi: withErrors(dep.abis.office) } : null,
    drops: dep.contracts.drops ? { address: dep.contracts.drops, abi: withErrors(dep.abis.drops) } : null,
    skins: dep.contracts.skins ? { address: dep.contracts.skins, abi: withErrors(dep.abis.skins) } : null,
    skinsStamp: dep.contracts.skinsStamp ? { address: dep.contracts.skinsStamp, abi: withErrors(dep.abis.skinsStamp) } : null,
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
  // The launchpad: players' tokens, each in its own pool against IMD, traded through the pad's own routers.
  const P = T && dep.contracts.pad ? {
    pad: { address: dep.contracts.pad, abi: withErrors(dep.abis.pad) },
    router: { address: dep.contracts.padRouter, abi: withErrors(dep.abis.router) },
    ethRouter: { address: dep.contracts.padEthRouter, abi: withErrors(dep.abis.ethRouter) },
    tokenAbi: withErrors(dep.abis.padToken),
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
  if (game) {
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

  const skinDesigns = new Map(); // skin id -> design, after the reveal
  async function snapshot() {
    const [block, minted, price, saleOpen, seed] = await Promise.all([
      pub.getBlock(), read(C.nft, "totalMinted"), read(C.nft, "price"), read(C.nft, "saleOpen"), read(C.nft, "seed"),
    ]);
    const s = {
      now: block.timestamp, minted: Number(minted), price, saleOpen, seed, game, tiers, account, accounts, nft: C.nft.address,
      local: dep.local, explorer: dep.explorer, devAccounts: !browserWallet, browserWallet,
    };
    if (C.skins) {
      const [minted, price, saleOpen, seed, owner] = await Promise.all([
        read(C.skins, "totalMinted"), read(C.skins, "price"), read(C.skins, "saleOpen"), read(C.skins, "seed"), read(C.skins, "owner"),
      ]);
      s.skins = { minted: Number(minted), price, saleOpen, seed, address: C.skins.address, mine: null, isOwner: !!account && same(owner, account) };
      // Paying in $STAMP: its price, whether it's open, and the ETH float that pays each skin's ETH price.
      if (C.skinsStamp) {
        const [stampPrice, open, float, saleOwner] = await Promise.all([
          read(C.skinsStamp, "stampPrice"), read(C.skinsStamp, "open"), pub.getBalance({ address: C.skinsStamp.address }), read(C.skinsStamp, "owner"),
        ]);
        s.skins.stamp = { address: C.skinsStamp.address, price: stampPrice, open, float, isOwner: !!account && same(saleOwner, account) };
      }
      if (account) {
        const ids = (await read(C.skins, "tokensOfOwner", [account])).map(Number);
        // A skin's design never changes once revealed, so it's read once.
        const design = (id) => skinDesigns.get(id) ?? read(C.skins, "designOf", [BigInt(id)]).then((d) => (skinDesigns.set(id, Number(d)), Number(d)));
        const designs = seed === 0n ? ids.map(() => null) : await Promise.all(ids.map(design));
        s.skins.mine = ids.map((id, i) => ({ id, design: designs[i] }));
      }
    }
    if (game) {
      const [totalPower, rewardPerBlock, officePrice, cooldown, levelBase] = await Promise.all([
        read(C.office, "totalPower"), read(C.office, "rewardPerBlock"), read(C.office, "officePrice"),
        read(C.office, "UPGRADE_COOLDOWN"), read(C.office, "LEVEL_COST_BASE"),
      ]);
      Object.assign(s, { totalPower, rewardPerBlock, officePrice, cooldown, levelBase });
    }
    if (!account) return s;
    const [eth, mine] = await Promise.all([
      pub.getBalance({ address: account }), read(C.nft, "tokensOfOwner", [account]).then((ids) => ids.map(Number)),
    ]);
    s.eth = eth;
    if (!game) {
      s.mine = mine.map((id) => ({ id, level: 1, onDuty: false }));
      return s;
    }
    const [o, [pending], stampBal, allowance, imd] = await Promise.all([
      // What a claim mints for this player: after the inviter's cut and the supply cap.
      read(C.office, "offices", [account]), read(C.office, "claimable", [account]), read(C.stamp, "balanceOf", [account]),
      read(C.stamp, "allowance", [account, C.office.address]), T ? read(T.imd, "balanceOf", [account]) : null,
    ]);
    s.office = { open: o[0], tier: Number(o[1]), onDuty: Number(o[2]), routesUsed: Number(o[3]), lastUpgrade: o[4], referrer: o[5], power: o[6] };
    Object.assign(s, { pending, stamp: stampBal, allowance, imd });
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
    return receipt;
  }
  async function ensureAllowance(s, amount) {
    if (amount > 0n && s.allowance < amount) await send(C.stamp, "approve", [C.office.address, maxUint256]);
  }

  // ---------------------------------------------------------------- trading
  // A venue is a token with the hook that holds its pool and that hook's routers: $STAMP's, or the launchpad's
  // for a player's token. Both hooks have the same interface, so quoting and trading are the same.
  const STAMP_VENUE = T ? { hook: T.hook, router: T.router, ethRouter: T.ethRouter, token: C.stamp } : null;
  const padVenue = (address) => ({ hook: P.pad, router: P.router, ethRouter: P.ethRouter, token: { address, abi: P.tokenAbi } });
  const poolKeys = new Map(); // token -> its pool key
  let imdEthKey = null;
  async function keys(v) {
    const t = v.token.address.toLowerCase();
    if (!poolKeys.has(t)) poolKeys.set(t, await read(v.hook, "poolKey", [v.token.address]));
    imdEthKey ??= await read(T.ethRouter, "imdEthKey");
    return { pool: poolKeys.get(t), imdEth: imdEthKey };
  }
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  /// Tokens out for a buy (`amountIn` ETH or IMD), or ETH/IMD out for a sell (`amountIn` tokens), after every fee.
  async function quote(side, asset, amountIn, v = STAMP_VENUE) {
    const k = await keys(v), S = v.token.address, I = T.imd.address;
    if (asset === "IMD") {
      const zeroForOne = same(k.pool.currency0, side === "buy" ? I : S);
      const [out] = await read(T.quoter, "quoteExactInputSingle", [{ poolKey: k.pool, zeroForOne, exactAmount: amountIn, hookData: "0x" }]);
      return out;
    }
    const hop = (to, key) => ({ intermediateCurrency: to, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks, hookData: "0x" });
    const path = side === "buy" ? [hop(I, k.imdEth), hop(S, k.pool)] : [hop(I, k.pool), hop(zeroAddress, k.imdEth)];
    const [out] = await read(T.quoter, "quoteExactInput", [{ exactCurrency: side === "buy" ? zeroAddress : S, path, exactAmount: amountIn }]);
    return out;
  }

  /// IMD's price in USD, through the IMD/ETH pool and Chainlink ETH/USD.
  async function imdUsd() {
    imdEthKey ??= await read(T.ethRouter, "imdEthKey");
    const k = imdEthKey;
    const id = keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks],
    ));
    const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n])); // PoolManager pools mapping
    const [slot0, round] = await Promise.all([read(T.pm, "extsload", [slot]), read(T.ethUsd, "latestRoundData")]);
    const sqrtP = Number(BigInt(slot0) & ((1n << 160n) - 1n)) / 2 ** 96;
    return Number(round[1]) / 1e8 / (sqrtP * sqrtP); // ETH is currency0: price = IMD per ETH
  }

  /// A token's pool price, and in USD.
  async function market(v = STAMP_VENUE) {
    const [price, usd] = await Promise.all([read(v.hook, "price", [v.token.address]), imdUsd()]);
    const stampImd = Number(price) / 1e18;
    return { stampImd, imdUsd: usd, stampUsd: stampImd * usd };
  }

  // ---------------------------------------------------------------- the leaderboard
  // Every post office, from the OfficeOpened events, then each one's tier and power from the contract.
  // Public RPCs won't serve old events, so the history comes from the chain's official RPC, or, where an
  // internet provider blocks that, through the site's own relay (/api/logs). What's been read is kept in
  // the browser, so later visits only read the new blocks.
  const OPENED = parseAbiItem("event OfficeOpened(address indexed owner, address indexed referrer)");
  const CLAIMED = parseAbiItem("event Claimed(address indexed owner, uint256 amount, address indexed referrer, uint256 referralAmount)");
  const logSources = dep.local ? [pub] : [
    dep.logsRpcUrl && createPublicClient({ chain, transport: http(dep.logsRpcUrl, { timeout: 5000, retryCount: 0 }) }),
    dep.logsRelay && createPublicClient({ chain, transport: http(new URL(dep.logsRelay, location.href).href, { timeout: 20000 }) }),
  ].filter(Boolean);
  const boardKey = game ? `courier:offices2:${dep.chainId}:${C.office.address.toLowerCase()}` : null;
  let board = null, boardSource = 0;
  // Start from whichever source worked last time (the relay, where the official RPC is blocked).
  try { boardSource = Math.min(logSources.length - 1, Math.max(0, Number(localStorage.getItem("courier:logSource")) || 0)); } catch {}
  async function scanOffices() {
    if (!board) {
      try { board = JSON.parse(localStorage.getItem(boardKey)); } catch {}
      // owners: every office; claimed: what each has claimed so far (before the referral cut), in wei.
      if (!board?.owners || !board.claimed) board = { from: String(dep.officeBlock ?? 0), owners: [], claimed: {} };
    }
    for (; boardSource < logSources.length; boardSource++) {
      const src = logSources[boardSource];
      try {
        const latest = await src.getBlockNumber();
        let from = BigInt(board.from);
        while (from <= latest) {
          // The official RPC answers a two-event query for at most 100,000 blocks at a time.
          const to = from + 90_000n > latest ? latest : from + 90_000n;
          const logs = await src.getLogs({ address: C.office.address, events: [OPENED, CLAIMED], fromBlock: from, toBlock: to });
          for (const l of logs) {
            const o = l.args.owner;
            if (l.eventName === "OfficeOpened") {
              if (!board.owners.includes(o)) board.owners.push(o);
            } else {
              board.claimed[o] = String(BigInt(board.claimed[o] ?? 0) + l.args.amount + l.args.referralAmount);
            }
          }
          from = to + 1n;
          board.from = String(from);
        }
        try {
          localStorage.setItem(boardKey, JSON.stringify(board));
          localStorage.setItem("courier:logSource", String(boardSource));
        } catch {}
        return board;
      } catch (e) {
        console.warn("office history: trying the next source", e?.shortMessage ?? e);
      }
    }
    boardSource = 0; // try them all again next time
    throw new Error("Couldn't read the post office history right now.");
  }
  /// Every post office, strongest first: { count, totalPower, totalEarned, list: [{ owner, tier, onDuty, power,
  /// claimed, waiting, earned }] }. `earned` is all the $STAMP an office has made: claimed plus waiting to be claimed.
  async function leaderboard() {
    if (!game) return null;
    const { owners, claimed } = await scanOffices();
    const [rows, waiting] = await Promise.all([
      Promise.all(owners.map((o) => read(C.office, "offices", [o]))),
      Promise.all(owners.map((o) => read(C.office, "pendingRewards", [o]))),
    ]);
    const list = owners.map((owner, i) => {
      const got = BigInt(claimed[owner] ?? 0);
      return { owner, tier: Number(rows[i][1]), onDuty: Number(rows[i][2]), power: rows[i][6], claimed: got, waiting: waiting[i], earned: got + waiting[i] };
    }).sort((a, b) => (b.power === a.power ? b.tier - a.tier : b.power > a.power ? 1 : -1));
    const sum = (k) => list.reduce((s, x) => s + x[k], 0n);
    return { count: list.length, totalPower: sum("power"), totalEarned: sum("earned"), list };
  }

  // ---------------------------------------------------------------- admin
  // The wallet the contracts pay (the pool's fee recipient, and the treasury) gets an admin view. Ownership of
  // everything is renounced, so the only things left to do on-chain are collecting the trading fees and handing
  // the fee wallet to another address.
  let payee = null, payeeAt = 0;
  async function payees() {
    if (!game || !T) return [];
    if (!payee || Date.now() - payeeAt > 30_000) {
      payee = await Promise.all([read(T.hook, "feeRecipient"), read(C.office, "treasury")]);
      payeeAt = Date.now();
    }
    return payee;
  }
  async function isAdmin(a = account) {
    if (!a) return false;
    return (await payees()).some((p) => same(p, a));
  }
  let blockTimeMs = null;
  async function adminStats() {
    const [feeRecipient, treasury] = await payees();
    if (blockTimeMs === null) blockTimeMs = await read(C.office, "blockTimeMs");
    const [pendingFees, minted, supply, burned, emitted, totalPower, curBlock, reward, interval, royalty, tEth, tImd, tStamp, mkt] = await Promise.all([
      read(T.hook, "pendingProtocolFees", [T.imd.address]), read(C.stamp, "totalMinted"), read(C.stamp, "totalSupply"),
      read(C.stamp, "totalBurned"), read(C.office, "totalEmitted"), read(C.office, "totalPower"), read(C.office, "currentBlock"),
      read(C.office, "rewardPerBlock"), read(C.office, "HALVING_INTERVAL"), read(C.nft, "royaltyInfo", [1n, 10_000n]),
      pub.getBalance({ address: treasury }), read(T.imd, "balanceOf", [treasury]), read(C.stamp, "balanceOf", [treasury]),
      market().catch(() => null),
    ]);
    // The launchpad's 4% on every launched token's trades, waiting in its pools (null before it's deployed).
    const [padFees, padFeeRecipient] = P ? await Promise.all([read(P.pad, "pendingProtocolFees", [T.imd.address]), read(P.pad, "feeRecipient")]) : [null, null];
    const nextHalving = (curBlock / interval + 1n) * interval;
    return {
      feeRecipient, treasury, pendingFees, minted, supply, burned, emitted, totalPower, reward, market: mkt,
      halvingIn: Number(((nextHalving - curBlock) * blockTimeMs) / 1000n), royaltyBps: Number(royalty[1]), royaltyTo: royalty[0],
      treasuryEth: tEth, treasuryImd: tImd, treasuryStamp: tStamp, padFees, padFeeRecipient,
    };
  }

  async function signPermit(spender, value, deadline, token = C.stamp) {
    const [nonce, domain] = await Promise.all([read(token, "nonces", [account]), read(token, "eip712Domain")]);
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

  async function trade({ side, asset, amountIn, minOut }, v = STAMP_VENUE) {
    const S = v.token.address;
    const deadline = (await pub.getBlock()).timestamp + 600n;
    if (side === "buy" && asset === "ETH") return send(v.ethRouter, "buyWithEth", [S, minOut, deadline], amountIn);
    if (side === "buy") {
      if ((await read(T.imd, "allowance", [account, v.router.address])) < amountIn) {
        await send(T.imd, "approve", [v.router.address, amountIn]);
      }
      return send(v.router, "buy", [S, amountIn, minOut, deadline]);
    }
    const [r, plain, withPermit] = asset === "ETH"
      ? [v.ethRouter, "sellForEth", "sellForEthWithPermit"]
      : [v.router, "sell", "sellWithPermit"];
    if ((await read(v.token, "allowance", [account, r.address])) >= amountIn) {
      return send(r, plain, [S, amountIn, minOut, deadline]);
    }
    // One signature instead of an approval transaction; wallets that can't sign typed data approve instead.
    let sig = null;
    try {
      sig = await signPermit(r.address, amountIn, deadline, v.token);
    } catch (e) {
      if (rejected(e)) throw e;
    }
    if (sig) return send(r, withPermit, [S, amountIn, minOut, deadline, sig.v, sig.r, sig.s]);
    await send(v.token, "approve", [r.address, amountIn]);
    return send(r, plain, [S, amountIn, minOut, deadline]);
  }

  // ---------------------------------------------------------------- the launchpad
  // Players with a post office launch their own tokens (CourierPad): 1B supply, 95% locked in a pool against
  // IMD, 5% to the treasury for drops. Token details that never change are read once and kept.
  const padStatic = new Map(); // token (lower case) -> { address, name, symbol, metadata, creator, createdAt }
  const pad = P ? {
    address: P.pad.address,
    async info() {
      const [stampFee, startTick, count, owner] = await Promise.all([
        read(P.pad, "stampFee"), read(P.pad, "startTick"), read(P.pad, "tokenCount"), read(P.pad, "owner"),
      ]);
      return { stampFee, startTick: Number(startTick), count: Number(count), owner, isOwner: !!account && same(owner, account) };
    },
    /// Every token launched, oldest first: [{ address, name, symbol, metadata, creator, createdAt }].
    async tokens(count) {
      const known = [...padStatic.values()];
      if (known.length >= count) return known;
      const fresh = await Promise.all(Array.from({ length: count - known.length }, (_, i) => read(P.pad, "allTokens", [BigInt(known.length + i)])));
      const details = await Promise.all(fresh.map(async (address) => {
        const t = { address, abi: P.tokenAbi };
        const [name, symbol, metadata, creator, launch] = await Promise.all([
          read(t, "name"), read(t, "symbol"), read(t, "metadata"), read(t, "creator"), read(P.pad, "launches", [address]),
        ]);
        return { address, name, symbol, metadata, creator, createdAt: Number(launch[2]) };
      }));
      for (const d of details) padStatic.set(d.address.toLowerCase(), d);
      return [...padStatic.values()];
    },
    /// Market caps (IMD wei) of `addresses`, at their pools' current prices.
    marketCaps: (addresses) => Promise.all(addresses.map((a) => read(P.pad, "marketCap", [a]))),
    imdUsd,
    balanceOf: (token) => (account ? read({ address: token, abi: P.tokenAbi }, "balanceOf", [account]) : 0n),
    quote: (token, side, asset, amountIn) => quote(side, asset, amountIn, padVenue(token)),
    market: (token) => market(padVenue(token)),
    trade: (token, args) => trade(args, padVenue(token)),
    /// Launch a token, burning the $STAMP fee (one permit signature, or an approval); resolves to its address.
    /// `fee` and `startTick` are what the launcher was shown: if either has changed, the launch reverts.
    async launch({ name, symbol, metadata, fee, startTick }) {
      let receipt;
      if (fee === 0n || (await read(C.stamp, "allowance", [account, P.pad.address])) >= fee) {
        receipt = await send(P.pad, "launch", [name, symbol, metadata, fee, startTick]);
      } else {
        const deadline = (await pub.getBlock()).timestamp + 600n;
        let sig = null;
        try {
          sig = await signPermit(P.pad.address, fee, deadline);
        } catch (e) {
          if (rejected(e)) throw e;
        }
        if (sig) receipt = await send(P.pad, "launchWithPermit", [name, symbol, metadata, fee, startTick, deadline, sig.v, sig.r, sig.s]);
        else {
          await send(C.stamp, "approve", [P.pad.address, fee]);
          receipt = await send(P.pad, "launch", [name, symbol, metadata, fee, startTick]);
        }
      }
      const [ev] = parseEventLogs({ abi: P.pad.abi, logs: receipt.logs, eventName: "TokenLaunched" });
      return ev.args.token;
    },
    /// The owner: the $STAMP fee per launch, and the start tick (price) of future launches.
    admin: {
      setStampFee: (wei) => send(P.pad, "setStampFee", [wei]),
      setStartTick: (tick) => send(P.pad, "setStartTick", [tick]),
    },
  } : null;

  // ---------------------------------------------------------------- the treasure hunt
  // Golden stamps and the treasury's token drops (TokenDrops): coins round the planet that the multiplayer server
  // checks and signs vouchers for. Only wallets with a post office can claim.
  const dropToken = new Map(); // token (lower case) -> { symbol, name, image }
  async function tokenInfo(token) {
    const k = token.toLowerCase();
    if (!dropToken.has(k)) {
      if (same(token, C.stamp.address)) dropToken.set(k, { symbol: "STAMP", name: "Courier World", metadata: "{}" });
      else {
        const t = { address: token, abi: P?.tokenAbi ?? ERC20_ABI };
        const [symbol, name, metadata] = await Promise.all([read(t, "symbol"), read(t, "name"), P ? read(t, "metadata").catch(() => "{}") : "{}"]);
        dropToken.set(k, { symbol, name, metadata });
      }
    }
    return dropToken.get(k);
  }
  const dropOf = async (id) => {
    const d = await read(C.drops, "drop", [BigInt(id)]);
    return {
      id: Number(id), token: d.token, isStamp: same(d.token, C.stamp.address), spots: Number(d.spots), maxPerWallet: Number(d.maxPerWallet),
      startDay: Number(d.startDay), endDay: Number(d.endDay), perCoin: d.perCoin, dailyCoins: d.dailyCoins, left: d.left,
      ...(await tokenInfo(d.token)),
    };
  };
  const drops = C.drops ? {
    address: C.drops.address,
    today: () => Number(BigInt(Math.floor(Date.now() / 1000)) / 86400n),
    /// The drops with coins out on `day`, oldest first, each with its token's symbol and metadata and the coins
    /// paid that day.
    async running(day) {
      const ids = await read(C.drops, "activeDrops", [day]);
      return Promise.all(ids.map(async (id) => ({ ...(await dropOf(id)), paid: await read(C.drops, "paidCoins", [id, day]) })));
    },
    /// Every drop (for the treasury's list), newest first, with the coins each has paid today.
    async all(day) {
      const n = Number(await read(C.drops, "dropCount"));
      const list = await Promise.all(Array.from({ length: n }, async (_, i) => ({ ...(await dropOf(i)), paidToday: await read(C.drops, "paidCoins", [BigInt(i), day]) })));
      return list.reverse();
    },
    async owner() {
      const [owner, paused] = await Promise.all([read(C.drops, "owner"), read(C.drops, "paused")]);
      return { owner, paused, isOwner: !!account && same(owner, account) };
    },
    /// The coins drop `id` paid for `day`'s finds.
    paidOn: (id, day) => read(C.drops, "paidCoins", [BigInt(id), day]),
    /// What a find count would pay now: [coins, amount].
    claimable: (id, day, coins) => (account ? read(C.drops, "claimable", [BigInt(id), account, day, coins]) : [0, 0n]),
    /// A drop's day: the coins paid that day across everyone and its cap, and yours and a wallet's most.
    async dayOf(id, day) {
      const [d, paid, mine] = await Promise.all([
        dropOf(id), read(C.drops, "paidCoins", [BigInt(id), day]), account ? read(C.drops, "claimed", [BigInt(id), day, account]) : 0,
      ]);
      return { ...d, paid: Number(paid), mine: Number(mine) };
    },
    /// Sign the hunt's sign-in message with the logged-in wallet (proves it's theirs; no transaction).
    sign: (message) => wallet.signMessage({ account, message }),
    /// Claim every voucher from the multiplayer server in one transaction.
    claimAll: (vouchers) => send(C.drops, "claimMany", [vouchers.map((v) => ({
      drop: BigInt(v.drop), day: v.day, coins: v.coins, deadline: BigInt(v.deadline), signature: v.signature,
    }))]),
    tokenBalance: (token) => (account ? read({ address: token, abi: ERC20_ABI }, "balanceOf", [account]) : 0n),
    /// The treasury: start, top up, end and withdraw drops, and pause claims.
    admin: {
      async createDrop({ token, perCoin, spots, maxPerWallet, dailyCoins, startDay, days, amount }) {
        const t = { address: token, abi: ERC20_ABI };
        if ((await read(t, "allowance", [account, C.drops.address])) < amount) await send(t, "approve", [C.drops.address, amount]);
        await send(C.drops, "createDrop", [token, perCoin, spots, maxPerWallet, dailyCoins, startDay, days, amount]);
      },
      async topUp(id, token, amount) {
        const t = { address: token, abi: ERC20_ABI };
        if ((await read(t, "allowance", [account, C.drops.address])) < amount) await send(t, "approve", [C.drops.address, amount]);
        await send(C.drops, "topUp", [BigInt(id), amount]);
      },
      /// Stop a drop after `lastDay` (today: its coins stay out until midnight UTC).
      endDrop: (id, lastDay) => send(C.drops, "endDrop", [BigInt(id), lastDay]),
      /// Take a drop's tokens back (once claims have closed, or while paused); a running one ends after `lastDay`.
      withdraw: (id, lastDay) => send(C.drops, "withdraw", [BigInt(id), account, lastDay]),
      setPaused: (on) => send(C.drops, "setPaused", [on]),
    },
  } : null;

  return {
    local: dep.local,
    drops,
    /// The $STAMP token's address (once the game is out).
    stampAddress: C.stamp?.address ?? null,
    browserWallet,
    chainName: chain.name,
    snapshot,
    get account() { return account; },
    /// Sign a message with the logged-in wallet (proves it's theirs; no transaction).
    signMessage: (message) => wallet.signMessage({ account, message }),
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
    mintSkins: (s, n) => send(C.skins, "mint", [BigInt(n)], s.skins.price * BigInt(n)),
    /// Mint with $STAMP instead: one signature (a permit) and one transaction, or an approval first for wallets
    /// that can't sign typed data.
    /// Pays the price the panel showed, at most: if it goes up first, the sale refuses (PriceChanged).
    async mintSkinsWithStamp(s, n) {
      const sale = C.skinsStamp, cost = s.skins.stamp.price * BigInt(n);
      if ((await read(C.stamp, "allowance", [account, sale.address])) >= cost) return send(sale, "buy", [BigInt(n), cost]);
      const deadline = (await pub.getBlock()).timestamp + 600n;
      let sig = null;
      try {
        sig = await signPermit(sale.address, cost, deadline);
      } catch (e) {
        if (rejected(e)) throw e;
      }
      if (sig) return send(sale, "buyWithPermit", [BigInt(n), cost, deadline, sig.v, sig.r, sig.s]);
      await send(C.stamp, "approve", [sale.address, cost]);
      return send(sale, "buy", [BigInt(n), cost]);
    },
    /// The $STAMP sale's owner: pause or open it, change its price, top up its ETH float.
    skinsStampAdmin: C.skinsStamp ? {
      setOpen: (open) => send(C.skinsStamp, "setOpen", [open]),
      setPrice: (wei) => send(C.skinsStamp, "setStampPrice", [wei]),
      async topUp(wei) {
        const hash = await wallet.sendTransaction({ account, to: C.skinsStamp.address, value: wei, chain });
        if ((await pub.waitForTransactionReceipt({ hash })).status !== "success") throw new Error("The top-up didn't go through.");
      },
    } : null,
    /// The skins contract's owner: open or close the sale, and reveal once it has been closed for a block.
    skinsAdmin: C.skins ? {
      setSaleOpen: (open) => send(C.skins, "setSaleOpen", [open]),
      /// True if `secret` (a number, as deploy-skins.sh printed it) is the one committed at deploy.
      async isSecret(secret) {
        return keccak256(encodeAbiParameters([{ type: "uint256" }], [secret])) === (await read(C.skins, "seedCommit"));
      },
      reveal: (secret) => send(C.skins, "reveal", [secret]),
    } : null,
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
    pad,
    leaderboard,
    admin: T ? {
      isAdmin,
      stats: adminStats,
      /// Send the trading fees waiting in the pool to the fee wallet (anyone may; it always pays the fee wallet).
      collectFees: () => send(T.hook, "collectProtocolFees", [T.imd.address]),
      /// The same for the launchpad's pools (every launched token): always paid to the launchpad's fee recipient.
      collectPadFees: () => send(P.pad, "collectProtocolFees", [T.imd.address]),
      /// Hand the fee wallet to another address. Only the current fee wallet can.
      async setFeeWallet(to) {
        await send(T.hook, "setFeeRecipient", [to]);
        payee = null;
      },
    } : null,
    /// Local chain only: reveal with the dev secret, as the owner (the reveal also ends the sale).
    async devReveal() {
      await send(C.nft, "reveal", [BigInt(dep.devSecret)], undefined, accounts[0], devWallet);
    },
    /// Local chain only: reveal the skins with the dev secret, as the owner (the reveal also ends their sale).
    async devRevealSkins() {
      if (await read(C.skins, "saleOpen")) await send(C.skins, "setSaleOpen", [false], undefined, accounts[0], devWallet);
      await test.mine({ blocks: 1 }); // the reveal must come in a later block than the close
      await send(C.skins, "reveal", [BigInt(dep.devSecret)], undefined, accounts[0], devWallet);
    },
    /// Local chain only: move `n` couriers from the dev players to the logged-in wallet.
    async devCouriers(n) {
      for (const from of accounts.slice(2)) {
        const ids = await read(C.nft, "tokensOfOwner", [from]);
        for (const id of ids) {
          if (n === 0) return;
          if (await read(C.nft, "locked", [id])) continue;
          await send(C.nft, "transferFrom", [from, account, id], undefined, from, devWallet);
          n--;
        }
      }
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
