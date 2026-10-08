# IMD Swarm final check request

Final check after the fixes for the [re-check ca28d248](https://explorer.imd.fun/jobs/ca28d248-399e-4f07-b77f-2ef35593c3bd)
(and the [first audit ea514609](https://explorer.imd.fun/jobs/ea514609-097d-4b62-a4f4-76f8f4e9594d)). Paste the
description below at [explorer.imd.fun/launch](https://explorer.imd.fun/launch) (choose **Audit**).

- **Repository:** https://github.com/AdamNakamoto/courierworld
- **Commit:** `ca016a43dae29930918a9302bc643ab2edf08796`

## Description

```text
Courier ($STAMP), final check after IMD Swarm re-check ca28d248 (which read commit d5a04ed; this is commit ca016a4). Read AUDIT.md first: section 7 maps each re-check finding to its fix and test, section 6 does the same for the first audit ea514609, and section 1 describes the system.

What it is: a game on Robinhood Chain (4663). Players put Courier NFTs on duty at post offices and earn $STAMP (21M cap), which trades in one Uniswap v4 pool against IMD; the hook takes 4% of the IMD side of every swap, rounded up, all to the protocol, and locks a single-sided launch allocation forever. Two launch stages from one wallet: stage 1 deploys the NFT for the mint; stage 2, only after the reveal, deploys the token, pool and post office, links them, freezes the art and renounces every owner.

Scope: contracts/src/StampHook.sol, StampRouter.sol, StampEthRouter.sol, StampToken.sol, PostOffice.sol, CourierNFT.sol, lib/SafeTransfer.sol, contracts/script/DeployMainnet.s.sol, DeployCouriers.s.sol, DeployLib.sol. Out of scope: the view-only art (CourierRenderer, CourierSVG, CourierTraits), the dev scripts (Deploy.s.sol, DeployFork.s.sol) and web/.

Changes in this round, and what to check:
1. StampHook: launch allocation must be at least 1 $STAMP (MIN_LAUNCH_SUPPLY) and at most 21M, start tick within +-400,000. Check that every input the constructor accepts gives a nonzero launch liquidity within v4's per-tick cap, so openPool always succeeds, in both $STAMP/IMD orderings.
2. Stage 2 (_deployGame) requires the NFT's current renderer and DeployMainnet reads it from the NFT. Check that stage 2 can never leave a renderer, the NFT, the token or the hook with an owner, or freeze a renderer it didn't link.
3. CourierNFT.setTreasury moves the ERC-2981 receiver along with mint payments (rate unchanged); renounceOwnership now also requires rendererFrozen. Check no ordering of owner calls before renouncing leaves funds or royalties pointing somewhere unintended, or the collection unrevealed, unlinked or unfrozen.
4. Confirm the earlier fixes still hold: total minted never exceeds totalEmitted, the fee is never below 4% nor more than 1 wei over it in all four modes, sells stop at the launch price, and no admin power reaches user funds.

Tests: cd contracts; git submodule update --init --recursive; forge test (88 tests; the hook suite runs in both orderings). Fork: forge test --match-contract "StampHookForkTest|LaunchStagesForkTest" --fork-url https://robinhood.drpc.org (the second runs the real stage 2 after a renderer swap). Both launch stages with the real settings: ./script/deploy-mainnet.sh rehearse.
```

## Same request as an API body (`job.open`)

```json
{
  "objective": "<the description above>",
  "template": "audit",
  "repoUrl": "https://github.com/AdamNakamoto/courierworld.git",
  "baseCommit": "ca016a43dae29930918a9302bc643ab2edf08796"
}
```
