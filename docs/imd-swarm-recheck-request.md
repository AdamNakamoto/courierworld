# IMD Swarm re-check request

Re-check of [audit ea514609](https://explorer.imd.fun/jobs/ea514609-097d-4b62-a4f4-76f8f4e9594d) after the fixes.
Paste the description below at [explorer.imd.fun/launch](https://explorer.imd.fun/launch) (choose **Audit**).

- **Repository:** https://github.com/AdamNakamoto/courierworld
- **Commit:** `312f6a9c350961faecdea36695bf3f3479062ac3`

## Description

```text
Courier ($STAMP), re-check of IMD Swarm audit ea514609 (that audit read commit 0a2ce30; this is commit 312f6a9). Read AUDIT.md first: section 6 maps every finding to its fix and the test that reproduces it, and section 1 describes the system as it is now.

What it is: a game on Robinhood Chain (4663). Players put Courier NFTs on duty at post offices and earn $STAMP (21M cap), which trades in one Uniswap v4 pool against IMD; the hook takes 4% of the IMD side of every swap, rounded up, all to the protocol, and locks a 2.1M single-sided launch allocation forever. It launches in two stages from one wallet: stage 1 deploys the NFT for the mint; stage 2, only after the reveal, deploys the token, the pool and the post office, links them, and renounces every owner, so nothing has an owner afterwards.

Scope: contracts/src/StampHook.sol, StampRouter.sol, StampEthRouter.sol, StampToken.sol, PostOffice.sol, CourierNFT.sol, lib/SafeTransfer.sol, contracts/script/DeployMainnet.s.sol, DeployCouriers.s.sol, DeployLib.sol. Out of scope: the view-only art (CourierRenderer, CourierSVG, CourierTraits), the dev scripts (Deploy.s.sol, DeployFork.s.sol) and web/.

What changed, and what to look at hardest:
1. PostOffice has no owner (costs, rates and tiers fixed) and refuses to deploy before the couriers are revealed; reward debt is now kept unscaled (power x accRewardPerPower) so each stretch rounds down once. Check that total minted can never exceed totalEmitted, under any order of assign, unassign, levelUp on duty and claims, and that the new claimable() view matches claim().
2. Routers stop sells at the launch price (StampHook.sellPriceLimit); price() reports the launch price when the pool sits beyond it. Check both $STAMP/IMD orderings, partial sells, the ETH router's sell path, and that nothing else changed in the fee or settlement.
3. The fee rounds up (mulDivRoundingUp) in beforeSwap and afterSwap. Check the PartialFill accounting still holds in all four modes and that no trader pays more than 1 wei over 4%.
4. Start tick bounded to +-400,000 and launch to 21M: check that every accepted constructor input opens.
5. CourierNFT: Ownable2Step; renounceOwnership reverts until the couriers are revealed and the game is set; mint payments go straight to the treasury; reveal ends the sale itself. PostOffice office payments go straight to the treasury.
6. The deploy scripts: stage 2 must leave no owner on StampToken, StampHook, CourierRenderer or CourierNFT (it logs each), and must not be runnable before the reveal or from another wallet.

Tests: cd contracts; git submodule update --init --recursive; forge test (86 tests; the hook suite runs with IMD as currency0 and as currency1). Fork: forge test --match-contract StampHookForkTest --fork-url https://robinhood.drpc.org. Both launch stages against a fork with the real settings: ./script/deploy-mainnet.sh rehearse.
```

## Same request as an API body (`job.open`)

```json
{
  "objective": "<the description above>",
  "template": "audit",
  "repoUrl": "https://github.com/AdamNakamoto/courierworld.git",
  "baseCommit": "312f6a9c350961faecdea36695bf3f3479062ac3"
}
```
