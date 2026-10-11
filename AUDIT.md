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

- **Mint:** blind, for ETH (`price`, 0.004 at launch), up to 10 per transaction, paid straight to the treasury in
  the same call; the contract never holds ETH. Token IDs run 1 to 999.
- **Reveal:** `seedCommit = keccak256(abi.encode(secret))` is fixed at deploy. `reveal(secret)` (owner, once) ends
  the sale for good and sets `seed = keccak256(abi.encode(secret, blockhash(block.number - 1)))`, never 0.
- **Designs:** `designOf(id) = _designAt(_shuffle(id - 1))`. `_shuffle` is a 4-round Feistel network on 10 bits
  keyed by `seed` (a permutation of 0..1023), repeated until it lands below 999 (cycle-walking), so it is a
  permutation of 0..998. `_designAt` deals that slot from a 999-card deck in design order: five designs of 120,
  four of 60, two of 40, two of 20, three of 13. A full mint therefore gives each design exactly its supply.
- **Metadata:** `tokenURI` and `contractURI` (ERC-7572) are JSON built on-chain; only the pictures are fetched,
  from `imageBase`, which the owner can change until `freezeImages`. `setContractURI` can replace the collection
  JSON (or restore the built-in one with "").
- **Royalty, enforced:** ERC-2981 at a fixed 5% (`ROYALTY_BPS`) to the treasury; `setTreasury` moves mint payments
  and the royalty together and can't change the rate. ERC721-C: `_update` calls the transfer validator's
  `validateTransfer(msg.sender, from, to, tokenId)` (a view) on every transfer between two non-zero addresses;
  mints skip it and there is no burn. The validator at launch is OpenSea's `StrictAuthorizedTransferSecurityRegistry`
  (`0xA000027A9B2802E1ddf7000061001e5c005A0000`, live on Robinhood Chain): it allows a holder moving their own token
  (`caller == from`) and any other caller only inside OpenSea's SignedZone flow, which checks the creator fee is
  paid. `setTransferValidator` (owner) only takes a contract, so enforcement can move but never be switched off.
- **Owner powers** (two-step ownership): open or close the sale (never after the reveal), `setPrice`, `reveal`,
  `setTreasury`, `setImageBase` until frozen, `freezeImages`, `setContractURI`, `setTransferValidator`.
  `renounceOwnership` only works once revealed and the images are frozen. The owner can't mint for free, change
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
  `dailyLimit` for that day (0 = no limit); the rest stays claimable with a later voucher. `nonReentrant`.
- **Owner powers** (two-step ownership): `withdraw` any amount of the pool, `setSigner`, `setReward`,
  `setLimits`. Deploy settings: reward 10 $STAMP, 24 stamps per wallet per day, 10,000 $STAMP per day in all.

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
2. **Fair reveal:** before `reveal` nobody, minter or owner, can know or influence any token's design; after it,
   designs never change; `_shuffle` is a bijection on 0..998, so no two tokens share a deck slot and no design
   ever exceeds its supply, whatever the seed.
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
- **Reveal timing**, as for the couriers: the owner chooses when to reveal and could wait for a blockhash it likes;
  minters can't predict designs. If the secret is lost the skins stay sealed for good.
- If the mint doesn't sell out, the unminted deck slots are random, so a design can end with fewer than its supply.
- There is no per-wallet mint limit, only 10 per transaction.
- `imageBase` is owner-set text placed in the JSON as is; the owner is trusted to set a plain URL. Pictures live on
  the game's website until moved (to IPFS, say) and frozen.
- **The hunt trusts its server.** Whoever holds the signer key can sign vouchers for any wallet with a post
  office, up to the per-wallet and daily limits, until the owner calls `setSigner`. The owner can withdraw the pool
  at any time (it is the owner's $STAMP, never the players'). A reward change applies to stamps not yet claimed.
- `tokensOfOwner` loops over every token ID; it is meant for off-chain reads.
