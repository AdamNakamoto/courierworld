# Audit brief

What Courier's contracts do, what they must guarantee, and where reviewers should look hardest. Everything
referenced is in this repository. Not deployed yet; the deploy settings are in `contracts/launch.env`.

## 1. The system

Courier is a game on **Robinhood Chain** (chain ID 4663, an Arbitrum Orbit L2). Players open post offices, put
Courier NFTs on duty and earn **$STAMP**, which trades in one **Uniswap v4** pool against **IMD**
(`0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127`).

- **$STAMP** (`StampToken`): ERC-20 + EIP-2612, hard cap 21,000,000 counting every mint (burns are permanent).
  The launch allocation (2,100,000) is minted to `StampHook` in the constructor; everything else is minted by
  `PostOffice` as players claim. `setMinter` is one-shot and the deploy script renounces the token's ownership
  right after it. No transfer tax, blocklist, pause or upgradeability.
- **The pool** (`StampHook`): the hook is also the pool's owner. `openPool` (owner, once) initializes the
  $STAMP/IMD pool at a start tick fixed in the constructor and adds the launch allocation as single-sided
  $STAMP liquidity above the start price, owned by the hook, which has no function to remove it. The hook
  rejects other pools that use it and outside liquidity in its pool (`beforeInitialize`/`beforeAddLiquidity`
  revert for any caller but the hook). LP fee is 0.
- **The fee:** 4% of the IMD side of every swap in the hook's pool, through any router, both directions,
  exact-in and exact-out, all of it to the protocol. The fee is taken through the swap's return deltas
  (specified side in `beforeSwap`, unspecified side in `afterSwap`), held as ERC-6909 IMD claims in the
  PoolManager (`pendingProtocolFees`) and sent to `feeRecipient` by `collectProtocolFees` (anyone may call).
  A swap where IMD is the specified side must fill completely, or it reverts `PartialFill`.
- **Routers:** `StampRouter` (buy/sell with IMD, permit sells) and `StampEthRouter` (ETH → IMD → $STAMP and
  back, through the hookless IMD/ETH v4 pool: fee 1%, tick spacing 100). Both are deployed by the hook's
  constructor, pull tokens only from `msg.sender`, and pass the user in `hookData` for the `Trade` event.
- **The game** (`PostOffice`): an office costs ETH (0.005) and comes with a trainee worth 60 power. Couriers on
  duty add power by ride (100 / 160 / 260 / 450 / 800) and level (+12% per level, 10 levels, paid in $STAMP).
  Each virtual block (one per `blockTimeMs` = 1,100 ms since deployment) emits `initialReward` $STAMP, split
  by power through a reward-per-power accumulator, halving every 4,200,000 blocks over at most 64 eras.
  `initialReward` = (21M − launch allocation) / 8.4M = 2.25 $STAMP, so allocation + emissions ≤ 21M (checked
  in the constructor; `claim` also clamps to the remaining cap). Spending $STAMP (levels, office tiers) burns
  75% and sends 25% to the treasury. A referrer gets 2.5% of what the offices they invited claim, taken from
  the claimer's share.
- **Couriers** (`CourierNFT`): 3,333 NFTs, minted for ETH (0.003, up to 10 per transaction). Traits come from
  `keccak256(abi.encode(seed, id))`. `seedCommit` is fixed at deploy; after the sale is closed the owner calls
  `reveal(secret)`, which mixes the secret with `blockhash(block.number - 1)`. The ride sets delivery power. A
  courier on duty is locked (`setLocked`, callable only by the one-shot `game`) and can't be transferred.
- **Art:** `CourierRenderer` / `CourierSVG` / `CourierTraits` build `tokenURI` on-chain (view-only; the NFT
  owner can swap the renderer until `freezeRenderer()`).

## 2. Scope

| File | Role |
| --- | --- |
| `contracts/src/StampHook.sol` | Pool owner and v4 hook: 4% fee, one-time `openPool`, locked liquidity, fee collection |
| `contracts/src/StampRouter.sol`, `contracts/src/StampEthRouter.sol` | Buy/sell with IMD, or with ETH via the IMD/ETH pool |
| `contracts/src/StampToken.sol` | $STAMP: capped supply, one-shot minter |
| `contracts/src/PostOffice.sol` | Offices, duty, levels, emissions and halvings, spending, referrals |
| `contracts/src/CourierNFT.sol` | Mint, commit-reveal, rides, duty lock, admin |
| `contracts/src/lib/SafeTransfer.sol` | Transfer helpers |
| `contracts/script/DeployMainnet.s.sol`, `contracts/script/DeployLib.sol` | Mainnet addresses, start tick from a USD market cap, hook salt mining, deploy order, ownership renounce |

Out of scope: `CourierRenderer.sol`, `CourierSVG.sol`, `CourierTraits.sol` (view-only art), `web/`.

Tests: `contracts/test/StampHook.t.sol` (hook and routers against a real v4 `PoolManager`),
`contracts/test/PostOffice.t.sol` (game, emissions, NFT), `contracts/test/Renderer.t.sol`, and
`contracts/test/StampHook.fork.t.sol` (live Robinhood Chain PoolManager, IMD and IMD/ETH pool):

```bash
cd contracts && git submodule update --init --recursive && forge test
forge test --match-contract StampHookForkTest --fork-url https://robinhood.drpc.org
```

## 3. Guarantees to check

1. **Fee always paid, never overcharged:** every swap in the hook's pool pays exactly 4% of its IMD side (of
   what the buyer pays, or of the gross the pool pays a seller), whatever the router, direction or exact-in/out
   mode; no path (partial fills, price limits, zero-amount swaps, a swap with the PoolManager unlocked by
   someone else, rounding) skips it or charges a trader more.
2. **Fee solvency:** the hook's ERC-6909 IMD claims always equal `pendingProtocolFees[IMD]`;
   `collectProtocolFees` sends exactly that to `feeRecipient` and nothing else, and works whether or not the
   PoolManager is already unlocked.
3. **Locked liquidity:** nobody, including the owner, can remove the launch liquidity, add other liquidity to
   the pool, open another pool on this hook, or call `openPool` twice; a donation of $STAMP to the hook before
   the launch can't block `openPool`.
4. **Supply:** $STAMP's `totalMinted` can never exceed 21M; only `PostOffice` mints; nobody can change the
   minter, balances or transfers after deployment.
5. **Reward accounting:** total claimed ≤ `totalEmitted` ≤ the emission schedule; an office earns only for
   the power it had over each interval (every power change checkpoints first); nobody earns for time before
   their courier went on duty; halvings are applied across era boundaries; no rounding lets a claim exceed
   what was earned.
6. **Couriers:** a courier on duty can't be transferred; only its owner can put it on duty and only that
   office can take it off; levels stay with the NFT; nobody can learn or influence a token's traits before
   the mint ends.
7. **Routers:** they only move the caller's tokens; deadlines and minimum outputs hold; the ETH router returns
   unused ETH and IMD; permit front-running can't make a sell fail.
8. **No privileged control over user funds:** the admin powers are listed in section 4; none of them can move a
   player's $STAMP, NFTs or IMD, or change the fee.

## 4. Admin powers (intended)

- `StampHook` owner (two-step transfer): `openPool` once, `setFeeRecipient`.
- `PostOffice` owner (two-step): `addTier` (tiers never shrink), `setTierUpgradeCost`, `setOfficePrice`,
  `setLevelCostBase`, `setTreasury`, `setBurnBps` (≤ 100%), `setReferralBps` (≤ 10%), `setUpgradeCooldown`
  (≤ 7 days), `withdrawETH` (to the treasury only).
- `CourierNFT` owner: open/close the sale (never after the reveal), `setPrice`, `reveal`, `setRenderer` until
  frozen, URIs, treasury, royalty, `withdraw` (to the treasury only). `setGame` is one-shot.
- `StampToken`: owner renounced at deploy, after the one-shot `setMinter`.

Deploy settings (`contracts/launch.env`): fee recipient, treasury and every owner
`0x72215670C2266Bc224949A12C514a77D7fD5D566` (ownership is planned to move to a multisig after the mint);
launch allocation 2,100,000 $STAMP; start price a $3,000 fully diluted market cap for 21M $STAMP, converted to
IMD at deploy time from the IMD/ETH pool and Chainlink ETH/USD (a dry run on 2026-10-08 gave 326 IMD, 330 IMD
after rounding to the pool's tick spacing).

## 5. Known and accepted

- **Single-sided launch:** until buys bring IMD into the pool, sells can't fill (our routers revert
  `Slippage`; an exact-in sell through another router receives nothing).
- Anyone can open a separate, hookless $STAMP pool; swaps there pay no fee.
- Donations to the pool are allowed (no donate hook) and accrue to the locked position, so they are lost to the
  donor.
- `Trade` logs the user reported by our routers, or `tx.origin` for any other router.
- **Reveal timing:** the owner, who knows the secret, chooses when to call `reveal`. On an Arbitrum chain
  `blockhash(block.number - 1)` is a pseudo-random value, not a secure source, so the owner could wait for a
  seed they like. Minters can't predict traits (the secret is private until the reveal); the owner is trusted
  not to grind the reveal.
- Emissions for intervals with no power on duty are never minted, so $STAMP's final supply ends below 21M.
- The virtual block clock uses `block.timestamp`, which the sequencer sets within the chain's bounds.
- The start price is read from live pools when the deploy script runs; the deployer checks the logged market
  cap before broadcasting.
- Owner-set prices and costs (office price, level and tier costs, burn and referral rates within their bounds)
  can change the game's economy, but never balances.
- `tokensOfOwner` loops over every token ID; it is meant for off-chain reads.
