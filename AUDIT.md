# Audit brief

What Courier's contracts do, what they must guarantee, and where reviewers should look hardest. Everything
referenced is in this repository. Not deployed yet; the deploy settings are in `contracts/launch.env`.

## 1. The system

Courier is a game on **Robinhood Chain** (chain ID 4663, an Arbitrum Orbit L2). Players open post offices, put
Courier NFTs on duty and earn **$STAMP**, which trades in one **Uniswap v4** pool against **IMD**
(`0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127`). It launches in two stages from one wallet:

1. **Couriers** (`DeployCouriers.s.sol`): the NFT and its on-chain art. The mint runs; the owner reveals.
2. **Game** (`DeployMainnet.s.sol`), only once the couriers are revealed: the hook and its routers, $STAMP and the
   post office. The script links everything, opens the pool, then renounces every owner, the NFT's included.
   After it, nothing in the system has an owner.

- **$STAMP** (`StampToken`, name "Courier World", symbol STAMP): ERC-20 + EIP-2612, hard cap 21,000,000 counting
  every mint (burns are permanent). The launch allocation (2,100,000) is minted to `StampHook` in the
  constructor; everything else is minted by `PostOffice` as players claim. `setMinter` is one-shot and the
  deploy renounces the token's ownership right after it. No transfer tax, blocklist, pause or upgradeability.
- **The pool** (`StampHook`): the hook is also the pool's owner. `openPool` (owner, once) initializes the
  $STAMP/IMD pool at a start tick fixed in the constructor (|tick| ≤ 400,000, launch between 1 and 21M $STAMP,
  so `openPool` always works) and adds the launch allocation as single-sided $STAMP liquidity, owned by the hook, which has no
  function to remove it. The hook rejects other pools that use it and outside liquidity in its pool
  (`beforeInitialize`/`beforeAddLiquidity` revert for any caller but the hook). LP fee is 0. The deploy
  renounces the hook right after `openPool` (`renounceOwnership` refuses before the launch). After that only the
  fee recipient itself can point the fees to a new address (`setFeeRecipient`), for example if IMD's issuer
  blocks it; nobody else can redirect them.
- **The fee:** 4% of the IMD side of every swap in the hook's pool, rounded up, through any router, both
  directions, exact-in and exact-out, all of it to the protocol. It is taken through the swap's return deltas
  (specified side in `beforeSwap`, unspecified side in `afterSwap`), held as ERC-6909 IMD claims in the
  PoolManager (`pendingProtocolFees`) and sent to `feeRecipient` by `collectProtocolFees` (anyone may call). A
  swap where IMD is the specified side must fill completely, or it reverts `PartialFill`.
- **Routers:** `StampRouter` (buy/sell with IMD, permit sells) and `StampEthRouter` (ETH → IMD → $STAMP and
  back, through the hookless IMD/ETH v4 pool: fee 1%, tick spacing 100). Both are deployed by the hook's
  constructor, pull tokens only from `msg.sender`, and pass the user in `hookData` for the `Trade` event. Sells
  stop at the launch price (`sellPriceLimit`): beyond it the pool holds no IMD.
- **The game** (`PostOffice`): no owner at all; the office price, treasury, tiers, level and upgrade costs, burn
  and referral rates are fixed in the constructor or as constants. It refuses to deploy before the couriers are
  revealed, so emissions never run while couriers can't go on duty. An office costs ETH (0.005, paid straight to
  the treasury) and comes with a trainee worth 60 power. Couriers on duty add power by ride
  (100 / 160 / 260 / 450 / 800) and level (+12% per level, 10 levels, paid in $STAMP). Each virtual block (one per
  `blockTimeMs` = 1,100 ms since deployment) emits `initialReward` $STAMP, split by power through a
  reward-per-power accumulator, halving every 4,200,000 blocks over at most 64 eras. `initialReward` =
  (21M − launch allocation) / 8.4M = 2.25 $STAMP, so allocation + emissions ≤ 21M (checked in the constructor;
  `claim` also clamps to the remaining cap). Spending $STAMP (levels, office tiers) burns 75% and sends 25% to the
  treasury. A referrer gets 2.5% of what the offices they invited claim, taken from the claimer's share;
  `claimable` shows a claim's exact result.
- **Couriers** (`CourierNFT`): 3,333 NFTs, minted for ETH (0.003, up to 10 per transaction, paid straight to the
  treasury). Traits come from `keccak256(abi.encode(seed, id))`. `seedCommit` is fixed at deploy; when the mint
  is over the owner calls `reveal(secret)`, which ends the sale for good and mixes the secret with
  `blockhash(block.number - 1)`. The ride sets delivery power. A courier on duty is locked (`setLocked`, callable
  only by the one-shot `game`) and can't be transferred. Ownership moves in two steps, and `renounceOwnership`
  only works once the couriers are revealed, linked to the game and their art frozen. `setGame` only takes a
  post office whose `couriers()` is this collection; `freezeRenderer` only freezes a deployed renderer.
  `setTreasury` moves the royalty receiver along with mint payments when royalties went to the treasury, and
  leaves a receiver set elsewhere with `setRoyalty` alone.
- **Art:** `CourierRenderer` / `CourierSVG` / `CourierTraits` build `tokenURI` on-chain (view-only). The NFT owner
  can swap the renderer until `freezeRenderer()`, which the game deploy calls; the game deploy also links and
  renounces the renderer the NFT actually uses. Before deploying anything it checks the couriers are revealed,
  unlinked and unfrozen, the renderer belongs to this collection and the deployer and has no office, and the
  NFT's treasury is the game's treasury.

## 2. Scope

| File | Role |
| --- | --- |
| `contracts/src/StampHook.sol` | Pool owner and v4 hook: 4% fee, one-time `openPool`, locked liquidity, fee collection |
| `contracts/src/StampRouter.sol`, `contracts/src/StampEthRouter.sol` | Buy/sell with IMD, or with ETH via the IMD/ETH pool |
| `contracts/src/StampToken.sol` | $STAMP: capped supply, one-shot minter |
| `contracts/src/PostOffice.sol` | Offices, duty, levels, emissions and halvings, spending, referrals; no owner |
| `contracts/src/CourierNFT.sol` | Mint, commit-reveal, rides, duty lock, admin until renounced |
| `contracts/src/lib/SafeTransfer.sol` | Transfer helpers |
| `contracts/script/DeployMainnet.s.sol`, `DeployCouriers.s.sol`, `DeployLib.sol` | Mainnet addresses, the two launch stages, start tick from a USD market cap, hook salt mining, linking, renouncing |

Out of scope: `CourierRenderer.sol`, `CourierSVG.sol`, `CourierTraits.sol` (view-only art), the dev scripts
(`Deploy.s.sol`, `DeployFork.s.sol`) and `web/`.

Tests: `contracts/test/StampHook.t.sol` (hook and routers against a real v4 `PoolManager`, run twice: with IMD
as currency0 and as currency1), `contracts/test/PostOffice.t.sol` (NFT, game, emissions), `contracts/test/Renderer.t.sol`,
and `contracts/test/StampHook.fork.t.sol` (live Robinhood Chain PoolManager, IMD and IMD/ETH pool):

```bash
cd contracts && git submodule update --init --recursive && forge test
forge test --match-contract "StampHookForkTest|LaunchStagesForkTest" --fork-url https://robinhood.drpc.org
./script/deploy-mainnet.sh rehearse   # both launch stages against a fork, with the real settings
```

## 3. Guarantees to check

1. **Fee always paid, never undercharged:** every swap in the hook's pool pays 4% of its IMD side (of what the
   buyer pays, or of the gross the pool pays a seller), rounded up, whatever the router, direction or
   exact-in/out mode; no path (partial fills, price limits, zero-amount or dust swaps, a swap with the
   PoolManager unlocked by someone else) skips it, and no trader pays more than 1 wei above 4%.
2. **Fee solvency:** the hook's ERC-6909 IMD claims are never less than `pendingProtocolFees[IMD]`;
   `collectProtocolFees` sends exactly that to `feeRecipient` and nothing else, and works whether or not the
   PoolManager is already unlocked. Only the owner (before the renounce) or the fee recipient itself can change
   `feeRecipient`.
3. **Locked liquidity:** nobody can remove the launch liquidity, add other liquidity to the pool, open another
   pool on this hook, or call `openPool` twice; a donation of $STAMP to the hook before the launch can't block
   `openPool`, and every start price and allocation the constructor accepts opens.
4. **Supply:** $STAMP's `totalMinted` can never exceed 21M; only `PostOffice` mints; nobody can change the
   minter, balances or transfers after deployment.
5. **Reward accounting:** total minted ≤ `totalEmitted` ≤ the emission schedule; an office earns only for the
   power it had over each interval (every power change checkpoints first, and each stretch rounds down once);
   nobody earns for time before their courier went on duty; halvings are applied across era boundaries.
6. **Couriers:** a courier on duty can't be transferred; only its owner can put it on duty and only that office
   can take it off; levels stay with the NFT; nobody can learn or influence a token's traits before the mint
   ends; the collection can't be left unrevealed, unlinked or with unfrozen art by an ownership mistake.
7. **Routers:** they only move the caller's tokens; deadlines and minimum outputs hold; the ETH router returns
   unused ETH and IMD; permit front-running can't make a sell fail; sells stop at the launch price.
8. **No owner after launch:** once the game deploy has run, no contract has an owner, nothing can give one
   back, and no setting can change, except that the fee recipient can move its own fees to a new address. Before that, no owner, at any point, can move a player's $STAMP, NFTs or
   IMD, change the fee, or hold player money (mint and office payments go straight to the treasury).

## 4. Admin powers, and when they end

- `StampToken`: one-shot `setMinter`, then renounced by the game deploy.
- `StampHook` (two-step transfer): `openPool` once and `setFeeRecipient`, until `renounceOwnership` right after
  `openPool` in the game deploy. The fee recipient can always call `setFeeRecipient` for itself.
- `PostOffice`: none, ever.
- `CourierRenderer`: one-shot `setOffice`, then renounced by the game deploy.
- `CourierNFT` (two-step transfer), from stage 1 until the game deploy: open/close the sale (never after the
  reveal), `setPrice`, `reveal` (ends the sale), `setRenderer` until frozen, URIs, treasury (with royalties),
  royalty, the one-shot `setGame`. The game deploy freezes the renderer and renounces; renouncing earlier
  reverts.

Deploy settings (`contracts/launch.env`): fee recipient, treasury and deployer
`0x72215670C2266Bc224949A12C514a77D7fD5D566`; launch allocation 2,100,000 $STAMP; start price a $3,000 fully
diluted market cap for 21M $STAMP, converted to IMD at deploy time from the IMD/ETH pool and Chainlink ETH/USD
(a rehearsal on 2026-10-09 gave 382 IMD, 388 IMD after rounding to the pool's tick spacing).

## 5. Known and accepted

- **Single-sided launch:** until buys bring IMD into the pool, sells can't fill (our routers stop at the
  launch price, so the v4 pool reverts `PriceLimitAlreadyExceeded`; an exact-in sell through another router
  receives nothing).
- Anyone can open a separate, hookless $STAMP pool; swaps there pay no fee.
- Donations to the pool, or ERC-6909 IMD claims transferred to the hook, are allowed and stay where they land
  (the locked position, or the hook's claims above `pendingProtocolFees`): lost to the donor, never to anyone
  else.
- A sell through another router can walk the pool price past the launch price into the empty range; `price()`
  and `marketCap()` report the launch price there, which is where the next trade fills.
- **IMD's issuer:** IMD on Robinhood Chain has an owner (a single wallet) that can block addresses
  (`setBlocked`), switch transfers off, and configure Uniswap v4 handling (`setV4Config`). Courier can't limit
  that. A blocked user can't sell through our routers; a blocked fee recipient can't receive fees, so it moves
  them with `setFeeRecipient` (`test_Fork_BlockedFeeRecipientMovesItsFees` replays it with IMD's real owner).
  If IMD transfers were switched off, every swap in the pool would stop until they're back on.
- `Trade` logs the user reported by our routers, or `tx.origin` for any other router.
- The fee rounds up, so a 1-wei exact-in buy through another router pays its 1 wei as the fee and receives
  nothing (within the stated tolerance of 1 wei over 4%).
- **Reveal timing:** the owner, who knows the secret, chooses when to call `reveal`. On an Arbitrum chain
  `blockhash(block.number - 1)` is a pseudo-random value, not a secure source, so the owner could wait for a
  seed they like. Minters can't predict traits (the secret is private until the reveal); the owner is trusted
  not to grind the reveal. If the secret is lost the collection can't be revealed and the game can't launch.
- Emissions for intervals with no power on duty are never minted, so $STAMP's final supply ends below 21M; the
  per-stretch rounding leaves a few wei per claim unminted too.
- The virtual block clock uses `block.timestamp`, which the sequencer sets within the chain's bounds.
- The start price is read from live pools when the deploy script runs; the deployer checks the logged market
  cap before broadcasting.
- **Everything is final after renouncing:** the fee recipient, the treasury, the office price (in ETH), level
  and tier costs, and the burn and referral rates can never change, even if ETH's price moves a lot or the fee
  recipient's key is lost. The treasury must be able to receive ETH (a normal wallet or a Safe), since mints and
  office purchases pay it directly and would fail otherwise.
- `tokensOfOwner` loops over every token ID; it is meant for off-chain reads.

## 6. Resolved: IMD Swarm audit ea514609 (on commit 0a2ce30)

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | Medium: the PostOffice owner could raise costs and pull a player's approved $STAMP | `PostOffice` has no owner: costs, rates and tiers are constants or constructor values. `test_NoOwnerAndFixedSettings`. |
| 2 | Low: re-flooring the reward debt on power changes could mint a few wei above `totalEmitted` | The debt is kept unscaled (`power × accRewardPerPower`) and each stretch divides once, rounding down. `test_PowerChangesNeverPayMoreThanEmitted` replays a sequence where the old accounting minted 1 wei over (fails on the old code), plus `testFuzz_PowerChangesNeverPayMoreThanEmitted`. |
| 3 | Low: `price()`/`marketCap()` read 0 after a sell walks past the launch price | The routers stop sells at the launch price (`sellPriceLimit`); `price()` reports the launch price when the pool sits beyond it. `test_PriceSurvivesSellsPastTheLaunchPrice`. |
| 4 | Low: single-step NFT ownership could brick the reveal | `CourierNFT` uses `Ownable2Step`, and `renounceOwnership` reverts `NotFinished` until the couriers are revealed and the game is set. `test_OwnershipTransferTakesTwoSteps`, `test_RenounceOnlyOnceRevealedAndLinkedToTheGame`. |
| 5 | Low: permit sells documented `value >= tokenAmount` | NatSpec corrected: the permit is for exactly `tokenAmount`. `test_PermitMustMatchTheAmountSold`, `test_SellsWithPermitNeedNoApproval`. |
| 6 | Info: the fee rounded to 0 below 25 wei | Rounded up with `mulDivRoundingUp`. `test_DustSwapsStillPayTheFee`, `test_EveryModePaysExactlyFourPercentRoundedUp`. |
| 7 | Info: ERC-6909 claims donated to the hook are unrecoverable | Accepted and documented (section 5): only `pendingProtocolFees` is collected; guarantee 2 now says claims ≥ pending. |
| 8 | Info: `pendingRewards` ignores the referral cut and the cap | New `claimable(owner)` returns what a claim mints for the owner and the referrer; the site shows it. `test_ClaimableMatchesTheClaim`. |
| 9 | Info: rate changes applied to already-accrued rewards | Rates can't change (finding 1). |
| 10 | Info: emissions started at deployment, before the reveal | `PostOffice` reverts `CouriersNotRevealed` unless the couriers are revealed; the launch is two stages. `test_DeploysOnlyAfterTheReveal`. |
| 11 | Info: the constructor accepted start ticks that make `openPool` revert | |start tick| ≤ 400,000 and launch ≤ 21M; every corner opens. `test_StartPriceIsBoundedSoOpenPoolAlwaysWorks`. |
| 12 | Info: tests never ran with $STAMP as currency0 | The hook suite runs twice (`StampHookImdFirstTest`, `StampHookImdSecondTest`), with exact fees in all four modes, partial fills, permit sells and collection inside another caller's unlock. |

Also changed since that commit: the token's name ("Courier World", same in the permit domain); every owner is
renounced at launch (`StampHook.renounceOwnership`, the deploy scripts); mint and office payments go straight to
the treasury (`withdraw` and `withdrawETH` are gone); `reveal` ends the sale itself; the deploy is split into the
two stages. 86 tests in all.

## 7. Resolved: IMD Swarm re-check ca28d248 (on commit d5a04ed)

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | Low: a tiny accepted launch allocation at the top start tick gives zero liquidity, so `openPool` reverts | The launch must be at least 1 $STAMP (`MIN_LAUNCH_SUPPLY`), which gives ~2e9 liquidity at the top tick. `test_StartPriceIsBoundedSoOpenPoolAlwaysWorks` now rejects 1e18 − 1 and opens 1, 2.1M and 21M at both extreme ticks, in both orderings. |
| 2 | Low: stage 2 could link and renounce a stale renderer while freezing a different one | `_deployGame` requires the NFT's current renderer, and `DeployMainnet` reads it from the NFT. `LaunchStagesForkTest.test_Fork_StageTwoRenouncesTheRendererTheNftUses` swaps the renderer between stages, sees stage 2 refuse the stale address, then checks everything is linked, frozen and ownerless. |
| 3 | Info: `setTreasury` left royalties on the old treasury | `setTreasury` moves the default royalty receiver too, keeping the rate. `test_SetTreasuryMovesRoyaltiesToo`. |
| 4 | Info: the NFT could renounce without freezing its art | `renounceOwnership` also requires `rendererFrozen`. `test_RenounceOnlyOnceRevealedLinkedAndFrozen`. |

## 8. Resolved: IMD Swarm final check 19b34b9b (on commit ca016a4)

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | Low: `freezeRenderer` accepted an empty or unusable renderer | It reverts `NoRenderer` unless a contract is set, and stage 2 checks before deploying anything that the renderer belongs to this collection and the deployer and has no office. `test_FreezeNeedsARenderer`; the fixtures attach a renderer as stage 1 does. |
| 2 | Low: `setTreasury` overwrote a royalty receiver chosen with `setRoyalty` | It moves royalties only when they went to the old treasury. `test_SetTreasuryKeepsADeliberateRoyaltyReceiver`, `test_SetTreasuryMovesRoyaltiesToo`. |
| 3 | Low: IMD's issuer can block the fee recipient, stranding every fee after the renounce | The fee recipient can move its own fees to a new address; nobody else can. Documented in section 5. `test_FeeRecipientCanMoveItsOwnFees`, and on a fork with IMD's real owner `test_Fork_BlockedFeeRecipientMovesItsFees`. |
| 4 | Info: stage 2 never compared its treasury with the NFT's | Stage 2 requires them equal, and logs both and the fee recipient. `test_Fork_StageTwoRefusesADifferentTreasury`. |
| 5 | Info: the one-shot `setGame` took any address | It reverts `NotThisGame` unless the address is a contract whose `couriers()` is this collection. `test_SetGameOnlyTakesThisCollectionsPostOffice`. |

95 tests, plus 4 against a Robinhood Chain fork (`--match-contract "StampHookForkTest|LaunchStagesForkTest"`).

## 9. New since launch: Courier Skins and the golden stamp hunt

The game above is live on Robinhood Chain and unchanged (addresses in `contracts/deployments/robinhood.json`; every
owner renounced). This round adds two separate contracts that only read from it. Neither is deployed yet.

### Courier Skins (`CourierSkins.sol`)

999 cosmetic NFTs to wear in the game: 16 designs in `web/skins.js`. They change how a player looks and never
touch $STAMP, the post office or the couriers.

- **Mint:** blind, for ETH (`price`, 0.004 at launch, never 0), up to 10 per transaction. Each mint sends the
  contract's whole balance to the treasury in the same call, so it never holds ETH. Token IDs run 1 to 999.
- **Reveal:** `seedCommit = keccak256(abi.encode(secret))` is fixed at deploy. `setSaleOpen(false)` records
  `saleClosedAt = block.number`. `reveal(secret)` (owner, once) needs the sale closed and `block.number >
  saleClosedAt`, then sets `seed = keccak256(abi.encode(secret, blockhash(block.number - 1)))`, never 0: that hash
  didn't exist while anyone could mint. The reveal ends the sale for good (`setSaleOpen` reverts after it). On
  Robinhood Chain `block.number` follows the parent chain, so the reveal waits for the next parent-chain block.
- **Designs:** `designOf(id) = _designAt(_shuffle(id - 1))`. `_shuffle` is a 4-round Feistel network on 10 bits
  keyed by `seed` (a permutation of 0..1023), repeated until it lands below 999 (cycle-walking), so it is a
  permutation of 0..998. `_designAt` deals that slot from a 999-card deck in design order: five designs of 120,
  four of 60, two of 40, two of 20, three of 13. A full mint therefore gives each design exactly its supply.
- **Metadata:** `tokenURI` and `contractURI` (ERC-7572) are JSON built on-chain; only the pictures are fetched,
  from `imageBase`, which the owner can change until `freezeImages`. `setContractURI` can replace the collection
  JSON (or restore the built-in one with ""). The reveal and `setImageBase` emit ERC-4906
  `BatchMetadataUpdate(1, totalMinted)` so marketplaces re-read every token.
- **Royalty, enforced:** ERC-2981 at a fixed 5% (`ROYALTY_BPS`) to the treasury; `setTreasury` moves mint payments
  and the royalty together and can't change the rate. ERC721-C: `_update` calls the transfer validator's
  `validateTransfer(msg.sender, from, to, tokenId)` (a view) on every transfer between two non-zero addresses;
  mints skip it and there is no burn. The validator at launch is OpenSea's `StrictAuthorizedTransferSecurityRegistry`
  (`0xA000027A9B2802E1ddf7000061001e5c005A0000`, live on Robinhood Chain): it allows a holder moving their own token
  (`caller == from`) and any other caller only inside OpenSea's SignedZone flow, which checks the creator fee is
  paid. `setTransferValidator` (owner) only takes a contract, so enforcement can move but never be switched off.
- **Owner powers** (two-step ownership): open or close the sale (never after the reveal), `setPrice` (never 0),
  `reveal`, `setTreasury`, `setImageBase` until frozen, `freezeImages`, `setContractURI`, `setTransferValidator`.
  `renounceOwnership` only works once revealed and the images are frozen. The owner can't make skins free, change
  the royalty rate, hold or redirect a holder's ETH, or move anyone's skins.

### The golden stamp hunt (`StampHunt.sol`)

Golden stamps are hidden round the planet, 24 new spots every UTC day. The multiplayer server (a Cloudflare
Worker, `multiplayer/src/index.js`, out of scope) checks each find against the player's reported path and signs an
EIP-712 voucher `Finds(player, day, stamps, deadline)` (domain "Courier World Stamp Hunt", version "1"): the
day's total finds so far, valid for an hour. `StampHunt` pays `rewardPerStamp` $STAMP per stamp from a pool the
owner fills with `deposit` (anyone may deposit). It never mints.

- `claim(day, stamps, deadline, signature)`: reverts after `deadline`, for a future `day` (`today()` =
  `block.timestamp / 1 days`), for a caller without an open post office (`PostOffice.offices(msg.sender).open`)
  or a signature not from `signer` over the caller's own address. It pays for `min(stamps, maxStampsPerDay)`
  minus what that wallet was already paid for that day, cut down to what the pool holds and what is left of
  `dailyLimit` for that day (0 = no limit); the rest stays claimable with a later voucher. `nonReentrant`. A claim
  that pays nothing says why: `NothingToClaim`, `DailyLimitReached` or `PoolEmpty`.
- **Owner powers** (two-step ownership): `withdraw` any amount of the pool, `setSigner`, `setReward`,
  `setLimits` (`maxStampsPerDay` at least 1). Deploy settings: reward 10 $STAMP, 24 stamps per wallet per day,
  10,000 $STAMP per day in all; `DeployHunt` refuses a cap outside 1-65535 and a post office that isn't $STAMP's.

### Scope

| File | Role |
| --- | --- |
| `contracts/src/CourierSkins.sol` | Skins: mint, commit-reveal shuffle, on-chain metadata, enforced royalty, admin |
| `contracts/src/StampHunt.sol` | Hunt rewards: vouchers, limits, the pool |
| `contracts/script/DeploySkins.s.sol`, `contracts/script/DeployHunt.s.sol` | Deploy settings |

Out of scope: `contracts/script/DevTransferValidator.sol` (local chains only), `web/`, `multiplayer/`.

```bash
cd contracts && git submodule update --init --recursive && forge test --match-contract "CourierSkinsTest|StampHuntTest"
forge test --match-contract CourierSkinsForkTest --fork-url https://robinhood.drpc.org   # OpenSea's real registry
```

### Guarantees to check

1. **Skins supply and payment:** at most 999 tokens, only through `mint` with exactly `price × quantity` while the
   sale is open; the payment reaches the treasury in the same call; nothing is ever left in the contract.
2. **Fair reveal:** nobody, minter or owner, can mint knowing any token's design: the reveal's block hash can't
   exist while the sale is open; after the reveal, designs never change; `_shuffle` is a bijection on 0..998, so
   no two tokens share a deck slot and no design ever exceeds its supply, whatever the seed.
3. **Royalty can't be skipped by contract:** no path moves a skin between two non-zero addresses without calling
   the validator (`transferFrom`, both `safeTransferFrom`s, anything else reaching `_update`); the validator can't
   be set to zero or a non-contract; the royalty rate can't change from 5%; a holder can always move their own skin
   with the launch registry.
4. **Metadata:** `tokenURI` and `contractURI` always return valid base64 JSON for existing tokens; `designOf` and
   `tokenURI` agree.
5. **Hunt payouts:** only vouchers signed by `signer` for `msg.sender` pay; a voucher can't be reused for more than
   its count; one wallet is never paid for more than `maxStampsPerDay` stamps in a day; one day's payouts never
   exceed `dailyLimit` when it is set; a claim never pays more than the pool holds; only wallets with an open post
   office are paid; the contract can't mint $STAMP or touch anyone's tokens but its own pool.

### Known and accepted

- **The validator is trusted.** The owner (or OpenSea, which controls the registry) could set or change rules
  that block marketplace sales, or every transfer. That is how ERC721-C works; the owner keeps ownership so the
  validator can follow OpenSea if it moves to a new registry.
- Holders moving skins between wallets pay no royalty (a private deal can skip it); only marketplace sales are
  enforced.
- **Reveal timing**, as for the couriers: after closing the sale the owner chooses when to reveal and could wait
  for a block hash it likes, which re-rolls every design at once (it can no longer mint after seeing one). On an
  Arbitrum chain the block hash is pseudo-random, not a secure source. If the secret is lost the skins stay
  sealed for good.
- The owner can mint during the sale like anyone, at the full price, which goes to its own treasury.
- If the mint doesn't sell out, the unminted deck slots are random, so a design can end with fewer than its supply.
- There is no per-wallet mint limit, only 10 per transaction.
- `imageBase` is owner-set text placed in the JSON as is; the owner is trusted to set a plain URL. Pictures live on
  the game's website until moved (to IPFS, say) and frozen.
- **The hunt trusts its server.** Whoever holds the signer key can sign vouchers for any wallet with a post
  office, up to the per-wallet and daily limits, until the owner calls `setSigner`. The owner can withdraw the pool
  at any time (it is the owner's $STAMP, never the players'). A reward change applies to stamps not yet claimed.
- `tokensOfOwner` loops over every token ID; it is meant for off-chain reads.

## 10. Resolved: IMD Swarm audit 25e6a0b3 (on commit 2cf3432)

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | Medium: `reveal` could run while the sale was open, so its seed was computable before it landed and the owner (or anyone seeing the pending reveal) could mint IDs with known designs; on Arbitrum the entropy is shared by every L2 block of one L1 block | `setSaleOpen(false)` records `saleClosedAt`; `reveal` reverts `SaleStillOpen` while the sale is open and `RevealTooSoon` until `block.number > saleClosedAt`, and no longer closes the sale itself. `test_OwnerCantMintKnowingTheDesigns` (the audit's proof: mint and reveal in one block is refused), `test_RevealNeedsTheSaleClosedInAnEarlierBlock` (reopening moves the reveal after the new close). |
| 2 | Low: `DeployHunt` truncated `HUNT_MAX_PER_DAY` to uint16 and checked nothing; a cap of 0 silently stopped every payout | `StampHunt` reverts `ZeroLimit` on a cap of 0 in the constructor and `setLimits`. `DeployHunt` requires a cap of 1-65535, that `OFFICE` has code and that its `stamp()` is `STAMP`, and logs every setting. `test_MaxPerDayCantBeZero`, `test_DeployScriptRefusesBadSettings`. |
| 3 | Low: the reveal and `setImageBase` changed every token's metadata with no ERC-4906 event | Both emit `BatchMetadataUpdate(1, totalMinted)`; `supportsInterface(0x49064906)` is true. `test_RevealAndImageMovesRefreshMarketplaces`. |
| 4 | Info: a claim stopped by the day's limit reverted `PoolEmpty` | New `DailyLimitReached`, chosen when the day's limit, not the pool, is what's short. `test_DailyLimitRevertNamesTheLimit`, `test_DailyLimitNotAMultipleOfTheReward`. |
| 5 | Info: `setPrice(0)` made every mint free | `setPrice` and the constructor revert `ZeroPrice` on 0; the owner's full-price mints paying its own treasury are documented in section 9. `test_PriceCantBeZero`. |
| 6 | Info: ETH forced into the contract was stuck | `mint` forwards the whole balance to the treasury. `test_ForcedEthGoesToTheTreasury`. |
| 7 | Info: test gaps | Added: reveal in the mint's block (finding 1); the shuffle checked as a bijection with exact design counts for 48 fuzzed seeds (`testFuzz_ShuffleIsABijection`); `safeTransferFrom` with data through the validator; a cap lowered below what was claimed; a claim at its deadline second and after the UTC day rolls; a daily limit that isn't a multiple of the reward. On a Robinhood Chain fork, a sale authorized the way OpenSea runs it (the SignedZone authorizes the token on the live registry, the approved marketplace transfers it and the flag is cleared, all in one transaction) goes through, and a stranger can't authorize (`test_Fork_SaleAuthorizedByOpenSeaGoesThrough`, `test_Fork_StrangersCantAuthorize`). |

140 tests, plus 4 against OpenSea's live registry on a Robinhood Chain fork (`--match-contract CourierSkinsForkTest`).

## 11. New: paying for Courier Skins in $STAMP

`contracts/src/SkinsStampSale.sol`, live since 2026-10-12 at `0x6DB7DCdFDBCe63Dd1e960CB8cE676bd32c99bc6a` (source
verified on Sourcify; deployed from `8fc1a67`, after the fixes below). Courier Skins only takes ETH and can't be changed,
so this sale sits beside it:

- `buy(quantity, maxStampCost)` / `buyWithPermit(quantity, maxStampCost, deadline, v, r, s)`: takes
  `stampPrice × quantity` $STAMP from the buyer straight to `treasury` (reverting `PriceChanged(stampPrice)` if
  that's more than `maxStampCost`), calls `CourierSkins.mint{value: price × quantity}` from its own ETH float,
  then `transferFrom(this, buyer, id)` for each new id (`totalMinted + 1` onward). Courier Skins enforces its
  own sale switch, 1–10 per transaction and the 999 cap; a failed mint reverts the whole buy, $STAMP included.
- The float only ever pays Courier Skins' own `mint`, at Courier Skins' current price; that ETH goes to the
  Courier Skins treasury. Anyone can top it up (`receive`); only the owner withdraws (`withdrawEth`).
- The permit is for `maxStampCost`. If it fails, the buy goes on only when the allowance already covers the
  cost (someone submitted the permit first); otherwise the permit's own error is passed on.
- `nonReentrant` on both buys (a Courier Skins treasury that calls back in is refused).
- Owner (Ownable2Step): `setStampPrice` (> 0), `setOpen`, `setTreasury` (≠ 0), `withdrawEth`, `withdrawToken`,
  `withdrawSkin` (a skin sent to the sale by mistake). `renounceOwnership` only once the sale is closed and the
  float is empty. None of them can take a buyer's $STAMP or skins.
- The hand-over from the sale to the buyer is an owner moving its own token, which OpenSea's registry
  allows: checked on a Robinhood Chain fork against the live Courier Skins, $STAMP and registry
  (`SkinsStampSaleForkTest`).

Known and accepted: the $STAMP price is fixed by the owner, not read from a pool (a pool price could be
pushed around within a transaction); if $STAMP moves a lot, the owner changes it or pauses. When the float
runs dry, $STAMP buys revert with `NeedsTopUp` until it's topped up; ETH mints are unaffected.

The owner of Courier Skins (the same wallet) sets the ETH price the float pays per skin, and could point Courier
Skins' treasury at the sale so the float refills itself; both are owner powers, not buyer risks. The $STAMP price
is set by hand: at 150 $STAMP and about $0.08 a $STAMP, a skin costs a little more than 0.004 ETH, and the owner
reprices or pauses if that drifts.

Independent review: IMD's audit of `d11a6b1` (four specialists and a judge, 5 low and 2 info, nothing above
low) found, and the fix covers: (1) no buyer-side price bound, so a reprice mined first charged a standing
allowance the new price: `maxStampCost`; (2) the permit value came from the live price, so any reprice voided
the signature and a blanket catch hid the reason: permit for `maxStampCost`, errors passed on when there's no
allowance to fall back on; (3) a Courier Skin sent to the sale was stuck: `withdrawSkin`; (4) an unguarded
`renounceOwnership` could strand the float: refused while open or holding ETH; (5) the fork test passed
silently without a fork: now `vm.skip`, and a closed sale fails it. Their three proof tests pass on the fix.
Report: https://explorer.imd.fun/jobs/1cb3a064-ca38-4c22-954d-7a748cd4fb23

Tests: `test/SkinsStampSale.t.sol`, 27 unit tests (with the real CourierSkins and StampToken, including every
edge the audit listed) and the fork test.


## 12. New: the launchpad (CourierPad, PadToken)

`contracts/src/CourierPad.sol` and `contracts/src/PadToken.sol`, live since 2026-10-13 at
`0x90c3aaae34cf4681701452379D3819D6Bc8Fe8CC` (deployed from `7324e0a`, after the fixes below; source verified on
Sourcify). Players launch their own tokens inside the game.

- `launch(name, symbol, metadata, maxStampFee, expectedStartTick)` / `launchWithPermit(..., deadline, v, r, s)`:
  needs an open post office (`PostOffice.offices(msg.sender).open`), reverts `FeeChanged(stampFee)` if the fee is
  more than `maxStampFee` and `StartTickChanged(startTick)` if the start price isn't the one the launcher saw (both
  before anything is burned), burns `stampFee` $STAMP from the launcher (`burnFrom`), deploys a `PadToken` (1B minted to the pad), sends 5%
  to `dropRecipient`, initializes the token's IMD pool at the current `startTick` and adds the other 95% (less a
  1e9-wei rounding buffer, burned) as single-sided liquidity owned by the pad. Name 1–32 bytes, symbol 1–12,
  metadata ≤ 2048. The permit path mirrors SkinsStampSale's audited fix: the permit is for `maxStampFee`, and a
  failed permit with no allowance to fall back on passes its error on.
- The hook code (`beforeSwap`/`afterSwap`, the 4% fee on the IMD side in all four swap kinds, rounding up, full
  fills only, fees held as PoolManager claims until `collectProtocolFees`) is StampHook's unchanged, audited in
  ea514609 and ca28d248, now keyed per pool (`tokenOfPool`). `beforeInitialize` and `beforeAddLiquidity` revert
  for anyone but the pad itself, so nobody else can create a pool with this hook or add liquidity; there is no
  remove function, so launch liquidity is locked forever.
- Each launch keeps the start tick it launched at (`launchTick`), so `sellPriceLimit`, `price` and `marketCap`
  don't move when the owner changes `startTick`. `launches(token)` has the same shape as StampHook's, so
  StampRouter and StampEthRouter are reused unchanged (deployed by the pad's constructor).
- Start ticks are bounded to [-300,000, 400,000] (tokens per IMD): within them the launch liquidity is above
  zero and about 12× below v4's per-tick cap for 950M tokens; a test launches and trades at both ends.
- `PadToken`: OpenZeppelin ERC20 + ERC20Permit, no owner (`owner()` returns 0), no mint after the constructor,
  no tax, no blocklist; stores `pad`, `creator` and `metadata`.
- Owner (two-step, renounceable at any time): `setStampFee` (at most `MAX_STAMP_FEE`, 100,000 $STAMP),
  `setStartTick` (bounded, future launches only), and proposing a new fee or drop recipient. The recipients can also
  propose their own replacement; either way the proposed address takes over only by accepting
  (`acceptFeeRecipient` / `acceptDropRecipient`), fees earned until then go to the outgoing recipient (or move along
  if it can't be paid), and the pad, the PoolManager and the burn address are refused. None of it touches
  launched tokens, pools or anyone's balances.

Trust and known limits:
- The treasury receives 5% of every launch and can sell it into the pool like any holder (the owner's
  choice: drops are run by hand). A sell is bounded by the IMD in the pool.
- Names, symbols and metadata are not filtered on-chain; the game hides tokens on its own list. A token can
  copy another's name (including $STAMP's); the game shows the contract address.
- No launch-and-buy in one transaction: the creator buys after launching. Robinhood Chain's sequencer is
  first-come first-served, without a public mempool.
- Sells before the first buy can't fill (the pool holds no IMD yet), as for $STAMP.

Independent review: IMD's audit of `0b01b0c` (four specialists and a judge, 4 low and 5 info, nothing above low)
found, and the fix covers: (1) the launcher bounded the fee but not the start price, so a `setStartTick` sequenced
first could reprice a launch: `expectedStartTick`, checked before the burn; (2) an unbounded `setStampFee` then a
renounce could stop launching for good: `MAX_STAMP_FEE`; (3) `TokenLaunched` carried the pool's tick, the inverse
for tokens that sort below IMD: it carries the launch's start tick now; (4) one-step recipient changes made a typo
after the renounce permanent: propose and accept; (5) a recipient could be the pad or the PoolManager (tokens
burned or stranded): refused; (6) a 1-wei exact-in buy ran a zero swap: refused (`DustSwap`); (7) `marketCap`
carried `price`'s whole-wei rounding at the top of the range: worked out from the pool price; (8) no suite mixed
both currency orders on one pad: a mid-range IMD fixture now does, and the burned remainder is asserted against
the supply. (9) lists the owner and recipient powers above; the deployer keeps FEE_RECIPIENT and TREASURY on one
key, as for the rest of the game.
Report: https://explorer.imd.fun/jobs/59db1445-68d3-4495-bd02-087f2c6c768a

Tests: `test/CourierPad.t.sol`, 45 tests run in three setups (IMD as currency0, as currency1, and mid-range as on
mainnet, where one pad holds pools of both orders): launch split, fee burn and bound, start price check, permit
paths, limits, every allowed start price, independent pools, the 4% in all four swap kinds, dust and partial
fills, ETH routing, fee collection, two-step recipients, admin, and a fuzz that every token bought sells back with
the fees adding up. `test/CourierPad.fork.t.sol` launches and trades on Robinhood Chain state (real PoolManager,
IMD, $STAMP burn, post office check, IMD/ETH pool).

## 13. New: the treasure hunt's token drops (TokenDrops)

`contracts/src/TokenDrops.sol`, live since 2026-10-13 at `0xD0e785276840F7175DF12678991605042e89771C` (deployed from
`a54e30b`, after the fixes below; source verified on Sourcify; owner the treasury, signer `0xac7e…55Ca`), replaces
`StampHunt` (never deployed): the treasury scatters
launchpad tokens, or $STAMP for the golden stamps, round the planet as coins, and players with a post office
claim what they find.

- `createDrop(token, perCoin, spots, maxPerWallet, dailyCoins, startDay, days, amount)`, owner only: the token must
  be $STAMP or launched by the launchpad (`CourierPad.launches(token).createdAt != 0`); `perCoin > 0`, 1 to 48
  spots (always 24 for $STAMP: the golden stamps), 1 ≤ `maxPerWallet` ≤ spots, `maxPerWallet` ≤ `dailyCoins` ≤ 10,000 (required:
  every player can collect each coin, as with golden stamps, so `spots` is how many are out, not how many a day
  pays; `dailyCoins` is what bounds a day), 1 to 365 days, starting today or up to a year ahead.
  The drop's balance is what actually arrived (balance difference), and each drop's tokens are its own
  (`left`), never mixed with another's.
- `claim(id, day, coins, deadline, sig)` / `claimMany(Claim[])`: not while paused, post office open, `day` not in the
  future, claimed that day or the next (`CLAIM_DAYS = 2`), within the drop's days, and an EIP-712 voucher
  `Finds(player, drop, day, coins, deadline)` signed by `signer` (the multiplayer room). Pays for the coins not yet
  claimed, capped by `maxPerWallet` per wallet per day, `dailyCoins` per day across everyone, and the drop's
  tokens. `claimMany` skips claims that would pay nothing, whose voucher has expired or whose day can't be
  claimed now (a batch sent just before midnight), and reverts if all do; a forged or malformed voucher, or an
  unknown drop, still reverts it. `claimable` quotes nothing where a claim would fail (paused, no post office,
  outside the drop's days or the window).
  `nonReentrant`.
- Owner (Ownable2Step, never renounceable, since drops need it): `topUp`; `endDrop(id, lastDay)` (stops after
  `lastDay`, today or later, so nobody's coins move mid-day, and reverts if mined after it; a drop that hasn't
  started is cancelled); `withdraw` a drop's remaining tokens once nobody can claim (its last day and the day after
  are over, or it was cancelled), or at any time while paused, which also ends a running drop after `lastDay`
  (today; reverts if mined after it, as `endDrop` does);
  `sweep` tokens above the drops' own balances (`held`); `setSigner` (the event records the previous key);
  `setPaused`.
- The room (`multiplayer/src/index.js`) reads the running drops from the chain, places coins with
  `web/drop-pick.js` (the same as the game), checks each find against the player's reported path as it did for
  golden stamps, and signs per-drop vouchers for today and yesterday.

Trust: the room's key decides finds. A leaked key can only claim from running drops, for wallets with a post office
(0.005 ETH each), at most `dailyCoins × perCoin` per drop per day and never more than the drop holds; timed at
midnight it can fill three days' caps per drop within a second (yesterday's, today's and, a second later,
tomorrow's), then one a day until the owner pauses. It can't pull from the treasury (only the owner's own
`createDrop`/`topUp` pull, from the owner), move one drop's tokens through another, or block the owner's pause,
key change or withdrawals (confirmed by re-check 147b18fe). The treasury's drop list shows each running drop's
coins paid today against its cap, so a leak shows as caps filling fast. The owner can take a running drop's tokens
back at any time (pause, withdraw, unpause, even in one block), which voids finds not yet claimed, and can install
its own signer: the drops are the treasury's own deposit, and the signer is no check on the owner.

Independent review: IMD's audit of `30ade10` (four specialists and a judge, 1 medium, 2 low, 5 info) found: (1) a
day's payout wasn't bounded by `spots`, and `dailyCoins` = 0 meant no daily bound, so a leaked key could drain a
drop: `dailyCoins` is now required (≥ `maxPerWallet`). We kept `spots` as coins out, not a payout cap, because
every player can collect each coin (the auditors assumed a coin can be found once); (2) `claimMany` reverted on one
stale voucher: stale ones are skipped; (3) a drop withdrawn while paused stayed listed: withdraw ends it; (4)
`claimable` ignored the windows and pause: fixed; (5) trust notes, above, plus `endDrop` takes the intended last
day and `SignerSet` records the previous key; (6) stray tokens were stuck: `sweep`; (7) the deploy script could
default the owner to the deployer: on Robinhood Chain `DROPS_OWNER` is required (deploy-drops.sh passes the
treasury); (8) tests now cover the day edges to the second, many wallets sharing a day's cap, a batch with a
stale and a forged voucher, same-token drops, and a $STAMP drop's golden stamps. The proofs for (2) and (3) pass.
Report: https://explorer.imd.fun/jobs/9755203f-4263-447d-b876-007724cd321b

Re-check: IMD's audit of `d59c2ab` (2 low, 6 info) answered the leaked-key question as above and found: (1) no ceiling
on `dailyCoins` (a units slip, tokens typed for coins, would void it): capped at 10,000; (2) a withdraw while paused
mined after midnight ended the drop a day late: `withdraw(id, to, lastDay)` reverts `TooLate` like `endDrop`; (3)
`claimable` quoted wallets without a post office: zero; (4) the midnight three-cap bound, now stated above; (5) a
drop scheduled near the end of `uint32` days overflowed: starts are limited to a year ahead; (6) malformed signatures
surfaced OpenZeppelin's errors: `tryRecover`, all `BadSignature`; (7) a drop emptied by claims kept its coins out:
the game hides an empty drop's coins (its spots stay reserved, so no one else's move); (8) tests: added.
Report: https://explorer.imd.fun/jobs/147b18fe-465a-4578-b366-7dfb5a6a512c

Tests: `test/TokenDrops.t.sol`, 40 tests against the real post office and $STAMP (including a leaked key timed at
midnight, which takes exactly three days' caps and nothing else), a fuzz that no sequence of claims overpays, and
`test/TokenDrops.invariant.t.sol`: random creates, top-ups, claims (today's and yesterday's, single and batched,
several wallets), ends, paused withdrawals, stray transfers, sweeps and time across midnights, checking that each
token's `held` is exactly its drops' tokens, the contract holds it, and no day ever pays more than its cap.

## 14. New: Courier Planets (CourierPlanets)

`contracts/src/CourierPlanets.sol`, live since 2026-10-15 at `0xE7F9fc69Cb0471EDDcb62e8FC3e4D0256306e7e3` (deployed
from `0ee4d24`; source verified on Sourcify; owner and treasury `0x7221…D566`; the treasury opens the sale from the
Post Office panel, as a presale before the planet worlds are in the game). Deployed without an independent audit, the
owner's choice: our own review is below. 333 planets (ERC-721, "Courier Planets", PLANET), each a
world of its own in the game: its owner explores it, builds on it and finds a daily treasure there, and can open it
to other players for a ticket in $STAMP. The game side (the planet worlds, building, the treasure and the
Worker's visitor passes) comes later and is out of scope; the treasure will be a TokenDrops drop funded by the
treasury, not this contract.

- **Buying:** `buy(quantity, maxCost)` / `buyWithPermit(..., deadline, v, r, s)`, `nonReentrant`: needs the sale
  open (closed at deploy), 1 to 3 per buy (`MAX_PER_BUY`), numbers 1 to 333 in order (`SoldOut` past 333), and
  `bought[buyer] + quantity ≤ perWallet` (3 at launch, 0 = no limit; it counts what a wallet bought, not what it
  holds). It reverts `PriceChanged(price)` if `price × quantity` is more than `maxCost`, and on the permit path
  `PermitFailed` if the allowance is still short after the permit (a permit someone else already used still
  works). Then it sends `price × quantity` $STAMP straight from the buyer to the treasury (10,000 a planet at
  launch, never 0) and `_safeMint`s each planet to the buyer, after all state is written. The contract never
  holds $STAMP.
- **Tickets:** `setTicket(id, price, open)`, the planet's owner only (`NotPlanetOwner`; operators can't), at most
  1,000 $STAMP (`MAX_TICKET`), 0 for free. `visit(id, maxPrice)` / `visitWithPermit(...)`, `nonReentrant`: reverts
  `Closed` unless open, `PriceChanged(price)` if the ticket is now more than `maxPrice` (an owner can't raise it on
  a visitor in flight), `PermitFailed` as above. It pays `price × treasuryBps / 10,000` (rounded down; 20% at
  launch, at most 50%, `MAX_TREASURY_BPS`) to the treasury and the rest to the planet's owner, both straight from
  the visitor, and emits `Visited(id, visitor, planetOwner, price, toOwner, toTreasury)` (all three addresses
  indexed). A free planet's visit moves nothing and still emits it.
- **A planet that changes hands starts closed:** `_update` deletes its ticket on every transfer between wallets
  (`TicketSet(id, 0, false)`), so a new owner never inherits a price set by someone else. No planet can be sent to
  the contract itself (`BadReceiver`: `transferFrom` doesn't ask the receiver, and nothing could move it out).
- **Royalty, enforced:** ERC-2981 at a fixed 5% (`ROYALTY_BPS`) to the treasury, moving with `setTreasury`; the
  rate can't change. ERC721-C exactly as Courier Skins: `_update` calls the validator's
  `validateTransfer(msg.sender, from, to, tokenId)` (a view, selector `0xcaee23ea`) on every transfer between two
  non-zero addresses; mints skip it and there is no burn. The validator at launch is OpenSea's
  `StrictAuthorizedTransferSecurityRegistry` (`0xA000027A9B2802E1ddf7000061001e5c005A0000`); `setTransferValidator`
  only takes a contract. `supportsInterface` reports ICreatorToken (`0xad0d7f6c`), ERC-721, ERC-2981 and ERC-4906.
- **Metadata:** `tokenURI(id) = base + id + ".json"` (existing planets only), `contractURI() = base +
  "collection.json"` (ERC-7572). `setBase` emits `ContractURIUpdated` and `BatchMetadataUpdate(1, totalMinted)`. A
  planet's look comes from its number (the game and the metadata draw it), so every planet has the same rights.
- **Reads for the game:** `planetsOf(owner)` and `allPlanets()` (every planet's owner and ticket) loop over at most
  333 planets.
- **Owner** (Ownable2Step; `renounceOwnership` always reverts `CannotRenounce`): `setSaleOpen`, `setPrice` (never
  0), `setPerWallet`, `setTreasury` (never 0 or the contract; the royalty follows), `setTreasuryShare` (at most
  50%), `setBase`, `setTransferValidator`, `rescue` (ERC-20s sent by mistake), and, as the collection's owner, its
  rules at OpenSea's registry. The owner can't touch anyone's planets or $STAMP, set a ticket, or change the
  royalty rate.

### Scope

| File | Role |
| --- | --- |
| `contracts/src/CourierPlanets.sol` | Planets: the sale, tickets and visits, enforced royalty, admin |
| `contracts/script/DeployPlanets.s.sol`, `contracts/script/deploy-planets.sh` | Deploy settings and the deploy (sale closed, owner = the signing wallet, the treasury) |

Out of scope: `contracts/script/DevTransferValidator.sol` (local chains only), `contracts/script/export-web.sh`,
`web/`, `multiplayer/`.

```bash
cd contracts && git submodule update --init --recursive && forge test --match-contract "CourierPlanets"
forge test --match-contract CourierPlanetsForkTest --fork-url https://robinhood.drpc.org   # OpenSea's real registry
```

### Guarantees to check

1. **Supply and payment:** at most 333 planets, numbered 1 to 333, only through a buy at the current price,
   never more than the buyer's `maxCost`; all of it reaches the treasury in the same call; the contract never
   holds $STAMP; the wallet limit holds across buys; a reentrant buy from `onERC721Received` is refused.
2. **Tickets:** only a planet's current owner sets its ticket; a ticket never exceeds 1,000 $STAMP; a visit pays
   exactly the ticket (never more than `maxPrice`), split exactly between the planet's owner and the treasury,
   with the treasury's part never above half; a closed planet can't be visited; no planet keeps a ticket across a
   change of hands, by any transfer path.
3. **Royalty can't be skipped by an operator:** no path moves a planet between two non-zero addresses without
   calling the validator; the rate stays 5%; a holder can always move its own planet with the launch registry.
4. **The owner's reach:** nothing the owner can call moves a planet, takes or holds anyone's $STAMP, or sets a
   ticket; ownership can only be handed over (two steps), never renounced.

### Known and accepted

- **The validator is trusted**, as for Skins and Companions: the owner (or OpenSea, which controls the registry)
  could stop enforcing the royalty, which only costs the treasury, or hold every transfer up. A validator can only
  refuse a transfer, never make one.
- A holder (a wallet or a contract) moving its own planet pays no royalty, so a private deal or a venue that takes
  planets into its own custody can skip it. Closing that would stop holders moving their own planets; OpenSea's
  default policy (level 3, OTC allowed) is kept.
- The owner sets the price and can buy like anyone; when the owner is the treasury (as deployed) its own buys pay
  itself. Wallet limits are per address, not per person.
- Visiting your own planet pays only the treasury's share (the rest comes back to you). A free planet's `Visited`
  costs only gas; the game won't need one to let visitors into a free open planet.
- A `Visited` is proof of payment only. The game (not written yet) will let a visitor in for an hour per `Visited`
  log (tx hash + log index, single use, shared with the other ticket checks), only while the planet still belongs
  to the `planetOwner` that was paid.
- `allPlanets` and `planetsOf` loop over every planet; they are meant for off-chain reads.

### Our own review (before the audit)

Four reviewers (money, access, royalty, integration), each finding checked by a separate skeptic who tried to
refute it, with proofs on a Robinhood Chain fork. No critical, high or medium findings. Fixed: a planet sent with
`transferFrom` to the contract was stuck for good (`BadReceiver`); the royalty rate could be raised to 10% (now
fixed at 5%, like Skins); the NatSpec overstated the enforcement (it now states the holder and custody case and
the owner's registry power); a failed deploy or an RPC error could export a stale address (`deploy-planets.sh`
and `export-web.sh` now check the chain first and write nothing if it can't answer); the fork tests passed
without a fork (they now skip); test gaps (a new treasury's ticket share, `planetsOf` after transfers, the reset's
event, the deploy script on the fork).

Tests: `test/CourierPlanets.t.sol`, 31 tests (buying, permits, limits, the sell-out, reentrancy, tickets, visits
and their split, a fuzzed split, resets, enforcement with a strict validator, owner powers, metadata, the deploy
script) plus 4 against OpenSea's live registry on a fork; `test/CourierPlanets.invariant.t.sol`, two suites (from
an empty sale, and from 325 sold) of random buys, permits, transfers, marketplace moves without the fee check,
tickets set by owners and strangers, visits and owner changes, every call's outcome predicted, checking supply,
that every $STAMP went to the treasury or a planet's owner exactly, that tickets always belong to the current
owner, and that `planetsOf` lists only a wallet's own planets.

## 15. New: Courier Fish (CourierFish)

`contracts/src/CourierFish.sol`, live since 2026-10-15 at `0xacF37fE6FdB848a4182d5A3646C2C0Ec11E09c90` (source
verified on Sourcify; owner and treasury `0x7221…D566`; signer `0x1ce8…8fDe`, the room's FISH_KEY). Deployed without an
independent audit, the owner's choice: our own review is below. Fishing in the bay is free: the multiplayer room checks each catch
and signs vouchers; players mint their fish as ERC-1155 tokens (one token id per species), paying only gas.

- **Species:** `setSpecies(id, maxSupply, dailyCap)` (owner). `maxSupply` 0 never runs out; once capped, a species'
  total can only shrink (never below what's minted, never back to uncapped). `dailyCap`: the most minted of it for
  one day's catch across everyone (0: none). The deploy sets 24 (`web/fish-kinds.js`): ids 1-15 uncapped, 16-20
  500 each (20 a day), 21-23 100 each (5 a day), 24 the Golden Stampfish, 21 ever (1 a day).
- **Minting:** `mint(Voucher)` / `mintMany(Voucher[])`, `nonReentrant`: not paused, an open post office
  (`PostOffice.offices(msg.sender).open`), and an EIP-712 voucher `Catch(player, day, ids[], counts[], deadline)`
  (domain "Courier World Fish" v1; arrays hashed as `keccak256(abi.encodePacked(...))`) signed by `signer` for
  `msg.sender`, with `ids` strictly increasing. `counts` are each species' totals for that day so far: a later
  voucher mints only what's new. The day must be today or within `CLAIM_DAYS` (7) before; `mintMany` skips expired or
  out-of-window vouchers, a forged or malformed one reverts the lot. Each wallet's day mints at most `maxPerDay`
  (10 at deploy, at most 50): new catches beyond what's left of it are spent, not owed, as are those a capped species
  has no room for (its day's `dailyCap`, its `maxSupply`). A call that mints nothing reverts `NothingToMint`.
  `mintable(player, day, ids, counts)` quotes exactly what a mint would give.
- **Royalty, enforced:** a fixed 5% (`ROYALTY_BPS`) to the treasury, following `setTreasury`; ERC1155-C exactly as
  Courier Companions (`validateTransfer(msg.sender, from, to, id, amount)` on every transfer between wallets, not a
  view; mints skip it). OpenSea's registry at launch; `setTransferValidator` takes only a contract.
- **Owner** (Ownable2Step, `renounceOwnership` reverts): `setSigner`, `setPaused`, `setSpecies` (and `setSpeciesMany`,
  the same rules for several at once, which the deploy uses), `setMaxPerDay`,
  `setTreasury`, `setBase` (re-emits every species' `URI`), `setTransferValidator`, `rescue` (ERC-20s sent by
  mistake). It can't move or burn anyone's fish.
- **The room** (`multiplayer/src/index.js`, out of scope): `fcast` needs the hunt's sign-in, the planet, a fresh
  position at a fishing spot (`web/fish-rules.js`: over the bay standing above the water, or at its edge, not
  swimming), an open post office and room in the wallet's day; it picks the bite time. `fland` needs the same cast,
  the time (no sooner than 2.2 s after the bite, no later than a minute), and the player within 3 m of where they
  cast; only then is the species picked (tiers 600/280/92/24/4 per 1000, a capped species only with room left), and
  the catch is kept in storage with no other wait in between, so two landings can't both take a cap's last one.

### Scope

| File | Role |
| --- | --- |
| `contracts/src/CourierFish.sol` | Fish: vouchers, the day's limit, caps, enforced royalty, admin |
| `contracts/script/DeployFish.s.sol`, `contracts/script/deploy-fish.sh` | Deploy settings and the 24 species |

```bash
cd contracts && forge test --match-contract "CourierFish"
forge test --match-contract CourierFishForkTest --fork-url https://robinhood.drpc.org   # OpenSea's real registry
```

### Guarantees to check

1. Nothing is minted except by a voucher from `signer` for the caller; a voucher mints each count at most once.
2. A wallet's day never mints more than `maxPerDay`; a capped species never passes its `dailyCap` for a day or its
   `maxSupply`; a capped species can't grow or become uncapped.
3. No path moves fish between two non-zero addresses without the validator; the royalty stays 5%.
4. The owner can't move, burn or mint fish (except by installing its own signer, which is the trust below).

### Known and accepted

- **The room's key decides catches.** A leaked key can mint, for wallets with an open post office (0.005 ETH each),
  at most `maxPerDay` a wallet for each day of the 7-day window, and never past a capped species' daily cap or total,
  until the owner pauses or replaces the key. The owner could install its own key.
- Catches past a limit are spent, not owed: if the owner lowers `maxPerDay`, or a capped species fills up, the rest
  of that day's catch can't be minted (in a single `mint`, a voucher that would mint nothing reverts instead).
- A pause doesn't stop the 7-day window. Holders moving their own fish pay no royalty.

Tests: `test/CourierFish.t.sol`, 27 tests (vouchers and their rules, the window to the second, the day's limit
including a leaked key mixing species and a lowered limit, caps forever and per day, batches, reentrancy, owner
powers, the deploy script) plus 4 against OpenSea's live registry; `test/CourierFish.invariant.t.sol`: honest and
leaked-key vouchers, batches, transfers, pauses, limit and cap changes and time, every outcome predicted by a model,
checking supplies, holdings and settings. Our own review (vouchers, limits, access, deploy; each finding checked by a
skeptic) found no critical or high issues; fixed: a lowered limit reverted a day's vouchers (now clamped), the
export missed the fish contract, the invariant harness couldn't tell success from an empty revert.

## 16. New: partner drops (a second TokenDrops, DropsTokenList)

Live since 2026-10-16 (deployed from `5e4efae`, L2 block 89850616; both source verified on Sourcify): TokenDrops
`0x35E75cbE2EACb407D2dEB068AF0665E7858BE75F`, DropsTokenList `0x11e8AbeD2a6B5933a7aB13C88Db5D851f9ed7FA1`; owner the
treasury, signer `0xac7e…55Ca` (the first contract's).

A second `TokenDrops`, the same audited contract, unchanged, drops tokens that aren't the Launchpad's (first, $MINE,
`0x1583948760169672C2AF7198026F1AEDE048657F`: a plain OpenZeppelin ERC-20 with no transfer fee or hook, ownership
renounced). TokenDrops asks its `pad` whether a token can be dropped, only in `createDrop`; this one's `pad` is
`contracts/src/DropsTokenList.sol`:

- `launches(token)`: for a token the owner approved, a record with `createdAt` 1 (all TokenDrops reads); for any
  other, the real Launchpad's record, forwarded (a view call). So the partner contract takes approved tokens,
  Launchpad tokens and $STAMP, and nothing else.
- `setApproved(token, ok)`, owner only (the treasury, `Ownable2Step`, never renounceable: the list would freeze).
  Approving a token moves nothing: drops are still funded only by the drops' owner, from its own tokens. Removing a
  token stops new drops of it; running ones carry on (TokenDrops never asks again).
- Deployed by `script/DeployPartnerDrops.s.sol` (`deploy-partner-drops.sh`): the list (owner the treasury, $MINE
  approved) and the TokenDrops (the real $STAMP and post office, owner the treasury, signer the first contract's,
  `0xac7e…55Ca`). `CreatePartnerDrop` (`deploy-partner-drops.sh drop`) approves the token and starts the drop today,
  signed by the owner, checking the amount covers every day's coins.

Trust: unchanged from §13, per contract. Both contracts trust the same room key: if it leaked, each could lose at
most its drops' daily caps, and the treasury pauses both (the panel has a pause for each). A voucher is bound to its
contract by the EIP-712 domain, so one contract's voucher fails on the other (`BadSignature`), even with the same
drop number.

The game and the room: each contract has its own block of each day's shuffled spots (`web/drop-pick.js`): the
first 24 stay empty, the next 60 are the first contract's, the rest the partner contract's; the partner contract's
drop k is drop 1000 + k in the game and the room (its finds, its coins in the hunt state, `["found"]`). So a drop
started on either contract mid-day, or one contract's read failing, can't move the other's coins; the first
contract's layout is exactly as before while its drops use 60 spots or fewer (today's PEPE drops use 58). The room
signs partner vouchers with the partner contract's domain and its own drop number and sends them apart
(`["vouchers", first, partner]`, each with `contract` and `id`): games loaded before only read the first list, and
the first contract quotes nothing for drop numbers it doesn't have (`claimable` returns 0 past `dropCount`).

Tests: `test/PartnerDrops.t.sol`, 11 tests (the list's answers and owner rules, partner tokens only on the partner
contract, removing a token, the $MINE drop's 30 full days paying exactly 495,000 and leaving 5,000 to withdraw, a
voucher working only on its own contract, pausing one contract, no post office) and a fork test against the live
chain (the real Launchpad, post office, $STAMP and $MINE, with the treasury's own $MINE: the drop receives the full
amount and pays a hunter, and the live drops contract never pays drop 1000). End to end on a local chain and room:
both contracts' coins laid out with no shared spot, grabs credited to the right drop, vouchers split by contract,
a partner voucher refused by the first contract, and one click in the panel claiming from both.

Our own review (two independent passes over the room, the game, the scripts and the contracts) found nothing that
moves the PEPE coins or misroutes a voucher, and these smaller things, fixed: a partner contract that doesn't
answer (or a page without it) no longer holds up claiming from the first (each contract's claim is tried on its
own, and the panel says if only part went through); the room's drop cache is keyed by contract and number base
and never reads the same contract twice; the drop script counts the coins already out on the partner contract
(36 a day in all) and checks its inputs; the deploy script refuses to run again once the partner drops exist,
takes the contracts' addresses from their receipts, and checks the voucher key and Launchpad against the first
contract's on chain; admin controls show only for the contracts the wallet owns. Not fixed, by design: the first
contract's coins are capped at 60 a day (it was 96), so until the PEPE drops end (day 20745) a new Launchpad drop
can have 2 coins; drops should be started from a freshly loaded page (an old one doesn't know the cap).

Before the $MINE drop started, an independent preflight against the live chain and site confirmed that the drop
moves no PEPE coin on any day (old and new layouts compared for the real drop list) and that the room and the game
lay out the same coins. It added: `script/pause-drops.sh on|off` pauses or resumes both drops contracts from the
treasury's wallet without the site; a "no" in the wallet on the first of two claims stops the second; the drop
script refuses the first contract as `DROPS2`.

## 17. New: Courier Cars (CourierCars)

Live since 2026-10-17 at `0x79DD8994Fa61AE96e40C3881d6cdc1188Bd44eE6` (L2 block 90985457, source verified on Sourcify; owner and treasury the treasury,
19 kinds on sale). `contracts/src/CourierCars.sol` is `CourierCompanions.sol` (live at
`0x4254cEac6B7C9F8911Ce908A910DD1874C5B49B7`, IMD-audited in job 145af84f, findings fixed) deployed again for cars:
an ERC-1155 where each kind of car is a token id with its own $STAMP price, a supply that can only shrink and a
per-wallet limit counting purchases; paid only in $STAMP, straight from the buyer to the treasury; resales carry a
royalty enforced through the transfer validator (OpenSea's registry); ownership two-step, never renounceable. The
whole diff against `CourierCompanions.sol`:

- Name "Courier Cars", symbol `CAR`, and car wording in the NatSpec.
- **The royalty is fixed**: `ROYALTY_BPS = 500` (5%) replaces `MAX_ROYALTY_BPS`; `setRoyalty` and `RoyaltyTooHigh`
  are gone; `setTreasury` always sets the default royalty to the new treasury at 5% (the companions' only moved it
  if it was being paid to the old treasury). So the royalty is always 5%, always to the current treasury.
- **`setKinds(ids, prices, maxSupplies, perWallets, open)`**, owner only: `setKind` for each entry, in order, in one
  transaction (`BadLength` if the lists differ in length). `setKind` and `setKinds` share one private `_setKind`
  (the companions' `setKind` body, unchanged), so every rule holds per entry: a kind's supply can only shrink and
  never below what's minted, a new kind announces its `URI`. A repeated id in one call is just two `setKind`s.

Deployed by `script/DeployCars.s.sol` (`deploy-cars.sh`), two transactions signed by the treasury wallet: the
contract (owner and treasury the signer, the OpenSea registry, base https://courierworld.fun/cars/), then
`setKinds` with the 19-car lineup, open: Common 500 $STAMP (300 each, 5 a wallet), Rare 1,500 (100, 3), Epic 4,000
(30, 2), Legendary 10,000 (10, 1). Halved the same day (Common 250, Rare 750, Epic 2,000, Legendary 5,000) by the
script's `reprice(address)`: one `setKinds` from the owner with the new prices and each kind's supply, wallet limit
and open flag read from the chain, so nothing else moves (it refuses if some kinds are open and others closed). The script refuses to run again once `deployments/robinhood-cars.json` exists,
and after sending checks the contract's code and that all 19 kinds are on sale (the lineup goes to the address
forge simulated: if the wallet used another nonce, or the second transaction failed, nothing is exported, and
`DeployCars.s.sol`'s `lineupOn(address)` sends the lineup alone, signed by the owner).

Trust: as for Courier Companions. The owner sets prices, opens and closes sales, adds kinds and shrinks supplies,
sets the treasury and the validator, and can `rescue` tokens sent to the contract by mistake; it can't mint without
paying, raise a supply, change the royalty, or reach anyone's cars or $STAMP.

The game and the room: the room shows a player's car only after `balanceOf(addr, id)` on `CARS_ADDRESS` says the
wallet on their name tag holds one (cached a few minutes if so, seconds if not; at most one new read per player
every 2 s); the client's `carId` is never passed on, only the checked `car`.

Tests: `test/CourierCars.t.sol` (the companions' unit tests, with `setKinds`, the 19-car lineup and the fixed royalty
following the treasury; the `setRoyalty` tests removed) and `test/CourierCars.invariant.t.sol` (every call's outcome
predicted); `CourierCarsForkTest` against the live registry (holders move their own; only OpenSea's fee-checked
flow can sell; no more than authorized). End to end on a local chain and room: buying, driving, getting out, the
car kept per wallet across reloads, wallet limits, and the room showing a car only to a wallet that owns it (a
wallet without it, and a made-up car id, are shown on foot).

Our own review (four independent passes, each finding checked by a skeptic) found nothing that lets a car be minted
without paying or shown for a wallet that doesn't own it, and these, fixed: the deploy script now refuses to export
a contract without its lineup and no longer stops before its checks when forge fails early; a car name that used a
real brand was renamed (the Trail 4x4) and the neon cyber car redrawn so it resembles no real vehicle; the camera's
see-through cut no longer cuts holes in your own car; a wallet switch mid-read can't restore the wrong wallet's car
or lose the saved one; getting in ends fishing and patting; name tags and bubbles sit above a floating car.
