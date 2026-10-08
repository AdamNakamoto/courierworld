# IMD Swarm final check 2 request

After the fixes for [final check 19b34b9b](https://explorer.imd.fun/jobs/19b34b9b-94ef-4543-8d85-b05028860fcf).
Paste the description below at [explorer.imd.fun/launch](https://explorer.imd.fun/launch) (choose **Audit**).

- **Repository:** https://github.com/AdamNakamoto/courierworld
- **Commit:** `96b82166490136d59696b1b6151ee44418e9ec5d`

## Description

```text
Courier ($STAMP), final check 2, after IMD Swarm final check 19b34b9b (which read commit ca016a4; this is commit 96b8216). Read AUDIT.md first: section 8 maps each finding of that check to its fix and test; sections 6 and 7 do the same for the earlier rounds (ea514609, ca28d248); section 1 describes the system.

What it is: a game on Robinhood Chain (4663). Players put Courier NFTs on duty at post offices and earn $STAMP (21M cap), which trades in one Uniswap v4 pool against IMD; the hook takes 4% of the IMD side of every swap, rounded up, all to the protocol, and locks a single-sided launch allocation forever. Two launch stages from one wallet: stage 1 deploys the NFT for the mint; stage 2, only after the reveal, deploys the token, pool and post office, links them, freezes the art and renounces every owner.

Scope: contracts/src/StampHook.sol, StampRouter.sol, StampEthRouter.sol, StampToken.sol, PostOffice.sol, CourierNFT.sol, lib/SafeTransfer.sol, contracts/script/DeployMainnet.s.sol, DeployCouriers.s.sol, DeployLib.sol. Out of scope: the view-only art (CourierRenderer, CourierSVG, CourierTraits), the dev scripts (Deploy.s.sol, DeployFork.s.sol) and web/.

Changes in this round, and what to check:
1. StampHook.setFeeRecipient is now callable by the owner (until the renounce) or by the current fee recipient itself, so a recipient blocked by IMD's issuer can move its own fees. Check that nobody else can ever change the recipient or reach the fees, that a recipient change can't strand or double-pay pendingProtocolFees, and that this adds no scanner flag beyond a self-rotating fee address.
2. CourierNFT: freezeRenderer reverts NoRenderer unless a contract is set; setGame reverts NotThisGame unless the address is a contract whose couriers() is this collection; setTreasury moves the royalty receiver only when it was the old treasury. Check no order of owner calls before the renounce can leave the collection frozen without art, linked to the wrong game, or royalties and mint money pointing somewhere unintended.
3. Stage 2 (_deployGame → _checkCouriers) checks before deploying anything: the NFT's renderer is c.renderer, belongs to this collection and the deployer and has no office; the couriers are revealed by this wallet, unlinked and unfrozen; the NFT's treasury equals TREASURY. Check stage 2 either completes with every owner gone or reverts before its first deployment.
4. Confirm the earlier guarantees still hold: minted never exceeds totalEmitted, the fee is never below 4% nor more than 1 wei over it in all four modes, sells stop at the launch price, every accepted launch opens, and no admin power reaches user funds.

Tests: cd contracts; git submodule update --init --recursive; forge test (95 tests; the hook suite runs in both orderings). Fork: forge test --match-contract "StampHookForkTest|LaunchStagesForkTest" --fork-url https://robinhood.drpc.org (includes IMD's real owner blocking the fee recipient, and the real stage 2). Both launch stages with the real settings: ./script/deploy-mainnet.sh rehearse.
```

## Same request as an API body (`job.open`)

```json
{
  "objective": "<the description above>",
  "template": "audit",
  "repoUrl": "https://github.com/AdamNakamoto/courierworld.git",
  "baseCommit": "96b82166490136d59696b1b6151ee44418e9ec5d"
}
```
