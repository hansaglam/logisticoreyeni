# V1.1 Leaderboard Zero-Start Release Audit

**Status:** `LEADERBOARD_ZERO_START_PRODUCTION_VERIFIED` (2026-09-11)  
**Date:** 2026-09-11  
**scoreVersion:** **3** (semantic bump from 2)

---

## NEW PRODUCT RULE

> Every newly eligible leaderboard player starts at **0** points and climbs by playing.

Server-authoritative `companyScore` must be genuinely `0` for a true new player — not a display-only fake.

---

## Fresh-player definition

A true new leaderboard player has **no meaningful completed gameplay/progression** beyond account bootstrap:

| Signal | Fresh baseline |
|---|---|
| `completedDeliveries` | `0` |
| `companyLevel` | `1` (default) |
| `reputation` | `50` (neutral baseline) |
| Cash | starter `20_000` (not earned) |
| Fleet | starter truck only |
| Warehouse | starter 100t tier-1 |

Do **not** treat starter resources as earned leaderboard progress. Do **not** use account creation timestamp alone.

---

## Zero baseline (formula)

**scoreVersion 3** keeps the same component math as v2, then subtracts the deterministic starter asset/finance contribution:

- `assetContribution = max(0, rawAssetScore − starterAssetScore)`
- `financeContribution = max(0, rawFinanceScore − starterFinanceScore)`
- delivery / progression / reputation / weekly remain earned-only
- final: `companyScore = max(0, round(sum))` floored at **0**

Starter baseline constants live in `LEADERBOARD_STARTER_BASELINE` (aligned with `SERVER_DEFAULT_*`).

---

## Eligibility change

**Removed:** lifetime completed deliveries ≥ 3 ranked gate (`LEADERBOARD_MIN_COMPLETED_DELIVERIES` → `0`; `isLeaderboardRankedEligible` always `true`).

**Preserved:**

- Linked Google/Apple account (non-anonymous)
- Username / profile setup
- Valid serverState / trusted submit path
- Guests remain unranked

---

## Score floor

Leaderboard `companyScore` output is floored at `0` via `Math.max(0, …)` at the canonical authoritative score output. Gameplay reputation penalties themselves are unchanged.

---

## scoreVersion decision

| Version | Semantics |
|---|---|
| 1 | Legacy inflated formula |
| 2 | Soft-cap formula + ≥3 delivery ranked gate; starter assets/cash still scored |
| **3** | Same soft-cap components + **starter baseline subtraction** + **no delivery ranked gate**; fresh = 0 |

**Why bump to 3:** Output for progressed players with ≥ starter assets/cash drops by the starter baseline (~8837 on typical accounts). That is a semantic change — must not silently rewrite v2.

- Current submissions write `scoreVersion: 3`
- Live board queries filter `scoreVersion == LEADERBOARD_SCORE_VERSION` (3)
- Closed seasons / W34 snapshots that captured v2 remain immutable historical truth

---

## Existing-player impact

No wipe / no retroactive zero of stored progression stats. On next trusted submit/seed after deploy, live **current-season** entries recalculate under v3.

Typical delta for players who still hold ≥ starter fleet/cash:

`newScore ≈ oldV2Score − starterAssetBaseline − starterFinanceBaseline`  
(≈ `old − 7847 − 990` = `old − 8837` when raw asset/finance ≥ starter)

Players far above starter assets see the same absolute baseline subtraction on the asset/finance legs only.

---

## Historical snapshot protection

- Do **not** mutate closed immutable season results
- W34 fingerprint `ea2310b854f11eb4` untouched
- Reward catalog / Phase 7 payout logic untouched
- Future season closes capture whatever `LEADERBOARD_SCORE_VERSION` is current at close time (3 after this rolls out)

---

## Current-season refresh requirement

After production Functions deploy:

1. Players refresh via normal submit / lazy sync → entry rewritten at v3
2. Admin OPS: `backend/scripts/recalculateCurrentLeaderboardV3.ts` (dry-run default; `--confirm-write` for active season only)
3. Do **not** bulk-rewrite closed seasons

---

## Production rollout (2026-09-11 UTC)

| Item | Result |
|---|---|
| Project | `logisticore-53ab4` |
| Active season | **2026-W37** (not closed; no `seasons/2026-W37` meta) |
| Previous season | 2026-W36 |
| Pre-board | 5 entries, all `scoreVersion=2`, min 17994, max 78359, zeros 0 |
| Functions deployed | `submitLeaderboardScore`, `getLeaderboard`, `seedWeeklyLeaderboard`, `finalizeWeeklySeasonClose`, `ensureSeasonFinalizedCallable`, `getSeasonResult` |
| Flags | `SEASON_CLOSE_SNAPSHOT_ENABLED=false`, `SEASON_REWARDS_ENABLED=false`, Expo season close/rewards flags false; allowlist empty |
| Dry-run | update 5, create 2, becomingZero 1, newlyIncludedZeroProgress 1, Δ median −8837 |
| Post-board | **7** entries, all `scoreVersion=3`, min **0**, max 69522, zeros 1, no duplicates, no mixed versions |
| Fresh zero-progress | board score 0 / v3 / completedDeliveries 0 (uidPrefix `XYYbTv`) |
| Progressed check | board 69522 == serverState.leaderboardScore |
| W34 | status=closed, results=3, scoreVersion=2, fingerprint **`ea2310b854f11eb4`** |
| Emulator | Unavailable this session (not faked) |

Ops scripts:

- `backend/scripts/recalculateCurrentLeaderboardV3.ts`
- `backend/scripts/verifyLeaderboardZeroStartRollout.ts`

**Production deploy status: DONE (narrow Functions + active-season Admin refresh).**

---

## Rollout requirement

1. ~~Review impact table~~  
2. ~~Deploy affected Functions~~  
3. ~~Current-season v3 refresh~~  
4. ~~Verify zero-score eligible entry~~  
5. ~~Confirm W34 unchanged~~  

Optional follow-up: open LeaderboardScreen on device for visual confirmation of **Puan: 0** (server entry already authoritative).

---

## Impact examples (computed locally)

| Profile | Approx old (v2) | New (v3) |
|---|---:|---:|
| Fresh starter | ~8837 (was unranked) | **0** (ranked) |
| Progressed A (L3, 10 del, +truck, cash 50k) | ~30657 | ~21820 |
| Progressed B (5 del, starter assets, weekly 5) | ~19342 | ~10505 |

Live W37 update deltas (uid hashes): −8775 / −8837 / −8837 / −8636 / −8837.

---

## Files (primary)

- `backend/src/leaderboardScore.ts`
- `src/simulation/companyScore.ts`
- `src/domain/leaderboardRankEligibility.ts`
- `src/screens/LeaderboardScreen.tsx`
- `src/config/leaderboard.ts` / `src/config/balance.ts`
- `scripts/leaderboard-zero-start-regression-test.ts`
- `backend/scripts/recalculateCurrentLeaderboardV3.ts`
- `backend/scripts/verifyLeaderboardZeroStartRollout.ts`
- This audit doc
