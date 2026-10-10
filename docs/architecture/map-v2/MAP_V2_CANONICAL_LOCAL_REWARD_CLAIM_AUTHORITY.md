# Map V2 — Canonical local reward claim authority (Step 29W)

**Status:** `CANONICAL_LOCAL_REWARD_CLAIM_AUTHORITY_PASS_PARTIAL`

**Readiness:** `LOCAL_REWARD_PARTIAL`

Gate `CANONICAL_LOCAL_REWARD_AUTHORITY=INTERNAL_TEST` (missing = OFF). Public mission, milestone, weekly, and ad UI stay local. HUD coverage stays **24 / 0 / 24**.

## Audit

| Family | Function | Completion | Amount | Server? | Status |
| --- | --- | --- | --- | --- | --- |
| `own_2_trucks` | `claimMissionReward` | local truck list; INTERNAL canonical fleet count | catalog 3000 | INTERNAL fleet only | `MISSION_INTERNAL_CANONICAL_STATE_ONLY` |
| Other missions | `claimMissionReward` | save counters, flags, ledger | mission catalog | no | `MISSION_CLIENT_PROGRESS_UNVERIFIED` |
| `ms_second_truck` | `claimMilestoneReward` | local truck count; INTERNAL canonical fleet | catalog 2500 | INTERNAL fleet only | `MILESTONE_INTERNAL_CANONICAL_STATE_ONLY` |
| Other milestones | `claimMilestoneReward` | save progress | milestone catalog | no | client progress |
| Local weekly objectives | `claimWeeklyObjectiveReward` | save weekly counters; disabled when backend weekly is on | local template | no | separate system, do not dual-pay |
| Server weekly | `claimWeeklyMissionReward` | server progress | server catalog | yes | `WEEKLY_ALREADY_CANONICAL` |
| Season | `claimSeasonReward` | server entitlement | server | yes | already canonical |
| Challenge | `claimChallengeReward` | server table | server | yes | already canonical |
| Ad `daily_ops_bonus` | `applyAdReward` | AdMob `EARNED_REWARD` client callback | fleet-derived local amount | no SSV | `AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION` |
| Other ad slots | `applyAdReward` | same callback | non-cash effects | n/a | non-cash |
| Achievement catalog | progression foundation | local | no cash | n/a | informational |
| Onboarding | marks mission claim | UI step | no separate cash | n/a | not a cash path |
| Daily/login | none | — | — | — | `NOT_PRESENT` |
| Debug cash | debug helpers | DEV | DEV | no | local only |
| Guest | local claims | save | local | no | guest stays local |

AdMob as a product can do server-side verification. This repo has no SSV callback, signature check, or custom data. Status: `AD_REWARD_PROVIDER_SSV_AVAILABLE_NOT_IMPLEMENTED`. There is no `claimAdReward` callable.

## Canonical claims

Registry policy `canonical-local-reward-internal-v1`. Claimable ids: `own_2_trucks`, `ms_second_truck`. Both are one-time and require two canonical active trucks (owned, not sold, or `LEASE_ACTIVE`). Amounts come from the existing catalogs. Request fields: `rewardId`, `canonicalSchemaVersion`. Rejected: completed, progress, rewardAmount, cashDelta, multiplier, watchedAd, period.

Receipt: `users/{uid}/canonicalRewardClaims/{claimId}` with claim id `reward:mission:own_2_trucks` or `reward:milestone:ms_second_truck`. Cash transaction uses the same id. Credits apply even when `serverState.cash` is negative. Retry returns the stored receipt. A different amount on the same id is `CANONICAL_REWARD_CLAIM_CONFLICT`.

Legacy trucks are not imported, so this does not cover production saves. Other missions stay on local progress. Local weekly objectives are a different reward from `weeklyMissionClaims` and are not paid again.

## Next

**STEP 29X — PRODUCTION FUEL PROGRESSIVE AUTHORITY.** Ads stay blocked until a real provider SSV integration exists. Market tick and incident parity remain separate public blockers.
