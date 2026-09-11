# LogistiCore V1.1 — Phase 7 Final Audit

**Date:** 2026-09-11  
**Project:** `logisticore-53ab4`  
**Scope:** Audit + release-readiness documentation only  
**Mutations this step:** none (no flag enablement, no season designation, no materialize, no claim, no W34 write, no tutorial/marketplace/economy changes)

**Verdict:** `PHASE_7_FINAL_AUDIT_VERIFIED`

---

## 1. Step 1–10 timeline

| Step | Outcome |
|---|---|
| 1 | Weekly season / leaderboard authority audited |
| 2 | Immutable season-close backend foundation |
| 3 | Trusted Season History integration (`getSeasonResult`) |
| 3.5–3.7 | Production canary on **2026-W34**; fingerprint + idempotency + getSeasonResult verified; temporary canary harness removed |
| 4 | Reward catalog v1 |
| 5 | Reward entitlement + claim backend source |
| 6 | Authority hardening; public materialize callable removed; reward UI behind flag |
| 7 | Reward backend deployed; authenticated fail-closed GET/CLAIM; cash unchanged; harness removed |
| 8 | Payout readiness: **NO SAFE PAYOUT CANDIDATE** (`WAITING_FOR_NATURAL_QUALIFYING_SEASON`) |
| 9 | Future-season reward designation architecture (`SEASON_REWARD_ENABLED_SEASONS`) |
| 10 | Designation architecture deployed; allowlist empty; all flags OFF; W34 unchanged |
| **Final** | This document — architecture + production integrity + regression pack |

Detailed evidence trail: `docs/release-audit/V1_1_PHASE_7_SEASON_CLOSE_SNAPSHOT.md`.

---

## 2. Final architecture (text)

```
CLIENT (fail-closed flags)
  ├─ Season History UI ──► getSeasonResult (immutable seasons/{key}/results/{uid})
  ├─ Reward UI (OFF) ───► getSeasonRewardEntitlement / claimSeasonReward
  └─ Live Leaderboard ──► submitLeaderboardScore (NO client score fields)
         │
         ▼
BACKEND AUTHORITY
  ├─ calculateLeaderboardScore(serverState) → leaderboards/{season}/entries/{uid}
  ├─ finalizeSeason (scheduler 10 0 * * * UTC OR ensure/get with ensure)
  │     create-once meta + create-once results
  │     order: companyScore DESC, uid ASC
  │     freeze rewardsEnabled + rewardCatalogVersion at meta CREATE only
  ├─ resolveSeasonRewardPolicy(seasonKey) ← SEASON_REWARD_ENABLED_SEASONS (server-only)
  ├─ materializeSeasonRewardEntitlements ← Admin/ops script ONLY (no public callable)
  └─ claimSeasonRewardTransaction ← seasonKey + idempotencyKey only; cash atomic

FIRESTORE (client write denied)
  seasons/{seasonKey}
  seasons/{seasonKey}/results/{uid}
  seasons/{seasonKey}/rewardEntitlements/{uid}
  seasons/{seasonKey}/rewardClaims/{uid}
```

**No parallel payout authority.** Live leaderboard is mutable until close; final placement for history/rewards uses immutable results only.

---

## 3. Production function inventory

Region: **us-central1** · Runtime: **nodejs20** · API: **v2**

| Function | Trigger | Memory | Role |
|---|---|---|---|
| `finalizeWeeklySeasonClose` | scheduled `10 0 * * *` UTC | 512 | Close previous ISO week when snapshot flag ON |
| `ensureSeasonFinalizedCallable` | callable | 256 | Idempotent finalize/resume |
| `getSeasonResult` | callable | 256 | Trusted final placement for Season History |
| `getSeasonRewardEntitlement` | callable | 256 | Entitlement read (fail-closed when rewards OFF) |
| `claimSeasonReward` | callable | 256 | Cash claim (fail-closed when rewards OFF) |
| `prepareVehicleMarketplaceAccountDeletion` | callable | 256 | Account deletion incl. season result/reward cleanup |

**Absent:** any public `materializeSeasonRewardEntitlementsCallable` (confirmed via `firebase functions:list` + source).

Materialization path: `backend/scripts/materializeSeasonRewards.ts` (Admin SDK; requires process `SEASON_REWARDS_ENABLED=true`).

---

## 4. Current production flags

### Backend (local deploy env `backend/.env.logisticore-53ab4`)

| Key | Value |
|---|---|
| `SEASON_CLOSE_SNAPSHOT_ENABLED` | `false` |
| `SEASON_REWARDS_ENABLED` | `false` |
| `SEASON_REWARD_ENABLED_SEASONS` | **absent** (empty allowlist / fail-closed) |

### Client

| Key | Value |
|---|---|
| `EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT` | unset in `.env` → fail-closed (`false`) |
| `EXPO_PUBLIC_ENABLE_SEASON_REWARDS` | unset in `.env` → fail-closed (`false`) |
| `.env.example` defaults | both `false` |

### Flag separation

| Layer | Key | Responsibility |
|---|---|---|
| Global ops | `SEASON_REWARDS_ENABLED` | Allows materialize / get / claim service paths |
| Per-season frozen | `meta.rewardsEnabled` | Frozen at close-init; existing meta always wins |
| Designation config | `SEASON_REWARD_ENABLED_SEASONS` | Which **future** seasons freeze enabled at first close-init |
| Client UI | `EXPO_PUBLIC_ENABLE_SEASON_REWARDS` | Show reward UI only |
| Snapshot | `SEASON_CLOSE_SNAPSHOT_ENABLED` / client twin | Schedule + finalize/read paths |

No single flag alone authorizes full payout.

---

## 5. W34 immutable reference (live read-only, 2026-09-11)

`verifySeasonCloseSnapshot.ts --seasonKey=2026-W34` → `ok: true`

| Field | Value |
|---|---|
| status | `closed` |
| participantCount | `3` |
| processedCount | `3` |
| results | `3` |
| rewardsEnabled | `false` |
| rewardCatalogVersion | `null` |
| rewardEntitlements | `0` |
| rewardClaims | `0` |
| fingerprint | **`ea2310b854f11eb4`** |

Active season observed: `2026-W37` (no canonical seasons meta).

---

## 6. Live fail-closed evidence (Step 7 retained)

Authenticated GET/CLAIM against W34 with rewards backend OFF:

| Call | ok | reason | status |
|---|---|---|---|
| GET entitlement | false | `feature-disabled` | `no-entitlement` |
| CLAIM | false | `feature-disabled` | `no-entitlement` |

Cash (uidHash `d59ef7e84edd`):

| | canonicalCash | serverState.cash |
|---|---|---|
| Before | `56248.59` | `56248.59` |
| After | `56248.59` | `56248.59` |

Entitlements `0`, claims `0`. Temporary DEV harness removed after proof.

---

## 7. Reward catalog v1 (source authority)

`backend/src/seasonRewardCatalog.ts` · `SEASON_REWARD_CATALOG_VERSION = 1`

| Rank | Cash |
|---|---|
| 1 | 60000 |
| 2 | 40000 |
| 3 | 25000 |
| 4–10 | 12000 |
| 11–25 | 7500 |
| 26–50 | 4000 |
| 51+ | no reward |

Minimum ranked participants: **10**.

---

## 8. Designation architecture

`resolveSeasonRewardPolicy(seasonKey)`:

- Empty/absent `SEASON_REWARD_ENABLED_SEASONS` → disabled (`rewardsEnabled=false`, catalog `null`)
- Explicit future key → enabled + freeze catalog `1` at **first** meta create
- Existing closing/closed meta **never rewritten** for reward fields
- No historical retrofit; no client write path

---

## 9. Payout blocker

**Status:** `WAITING_FOR_NATURAL_QUALIFYING_SEASON`

Not a code failure:

1. No naturally closed recent season with `participantCount >= 10`
2. W34 protected and insufficient (3)
3. Historical seasons intentionally not retrofitted

---

## 10. Future payout runbook (DO NOT EXECUTE)

1. Choose a **future** ISO week  
2. Add to `SEASON_REWARD_ENABLED_SEASONS`  
3. Redeploy affected season-close functions  
4. Inspect policy read-only (`inspectSeasonRewardPolicy.ts`)  
5. Keep `SEASON_REWARDS_ENABLED=false` if delaying payout  
6. Season closes naturally (snapshot flag only when intentionally opening close window)  
7. Verify frozen `rewardsEnabled=true`, `rewardCatalogVersion=1`  
8. Verify `participantCount >= 10`  
9. Enable reward backend capability  
10. Materialize entitlements via Admin script only  
11. Verify entitlement docs  
12. One linked-user payout canary  
13. Verify cash  
14. Same-key claim retry  
15. Different-key after claimed (must not double-pay)  
16. Verify receipt  
17. Enable client reward UI only after proof  

---

## 11. Security rules

`firestore.rules`: client `read, write: if false` for:

- `seasons/{seasonKey}`
- `results/{uid}`
- `rewardEntitlements/{uid}`
- `rewardClaims/{uid}`

Leaderboard client writes remain denied (Admin/callable only).

---

## 12. Account deletion

`prepareVehicleMarketplaceAccountDeletion` / `accountDeletion.ts` cleans:

- `seasons/*/results/{uid}` (meta retained)
- `rewardEntitlements/{uid}`
- `rewardClaims/{uid}`

No production deletion performed this audit.

---

## 13. Scheduler

`finalizeWeeklySeasonClose`: `10 0 * * *` UTC.

With `SEASON_CLOSE_SNAPSHOT_ENABLED=false` → no-op (`feature-disabled`).

When later ON: closes previous week; uses same reward policy resolver at meta init; freezes reward metadata once; **no** automatic entitlement materialization; **no** automatic payout.

---

## 14. DEV tool cleanup (Phase 7)

Runtime/UI search: no player-facing Phase 7 Canary / Season Close DEV / Reward Fail-Closed / temporary W34 DEV / canary routes.

**Retained (out of Phase 7 scope):** none for Tutorial QA Reset — runtime helper/card removed. Android mandatory tutorial physical QA remains **PENDING** (external to Phase 7).

---

## 15. Tests (2026-09-11)

| Suite | Result |
|---|---|
| season-close-foundation | PASS 39/0 |
| season-close-canary-readiness | PASS 53/0 |
| season-close-canary-pack | PASS 21/0 |
| season-history-finals | PASS 47/0 |
| season-reward-policy | PASS 20/0 |
| season-reward-designation | PASS 28/0 |
| season-reward-claim | PASS 44/0 |
| season-reward-ui | PASS 56/0 |
| seasons-challenges-foundation | PASS 26/0 |
| account-signout-deletion | PASS |
| management-panel (no Phase 7 DEV cards) | PASS |
| root `tsc --noEmit` | PASS |
| backend `tsc --noEmit` | PASS |
| `git diff --check` | PASS |

### Known unrelated stale baselines (do not weaken)

None remaining for the former leaderboard-season-seed / seasons-challenges-ui drift items — cleaned 2026-09-11 (see hygiene pass; tests now assert extracted lifecycle + profile policy truth).

| Suite | Status |
|---|---|
| `leaderboard-season-seed-regression-test.ts` | Updated for `useAppStateLifecycle` extraction |
| `seasons-challenges-ui-regression-test.ts` | Updated for internal ON / production fail-closed via `loadBuildProfileEnv` + policy validators |

---

## 16. Release status matrix

| Component | Classification |
|---|---|
| A. Season-close architecture | **READY** |
| B. Immutable results | **READY** |
| C. Season History integration | **READY** |
| D. Reward backend | **READY_BUT_DISABLED** |
| E. Reward designation | **READY_BUT_EMPTY** |
| F. Reward payout | **WAITING_FOR_NATURAL_QUALIFYING_SEASON** |
| G. Client reward UI | **IMPLEMENTED_BUT_DISABLED** |
| H. Production reward rollout | **NOT_ENABLED** |

---

## 17. External pending QA (not a Phase 7 blocker)

```
EXTERNAL_TO_PHASE_7:
MANDATORY_TUTORIAL_ANDROID_QA_PENDING
```

iOS mandatory tutorial main flow previously PASS; restart/resume fix implemented separately — device retest operator-owned. Do not conflate with Phase 7.

---

## 18. Risks / follow-ups

1. Wait for natural ≥10-participant designated future season before payout canary.  
2. When enabling snapshot scheduler, disable or plan before next `00:10 UTC` unless intentional auto-close of previous week is desired.  
3. Dual score calculators (server `calculateLeaderboardScore` vs client display `calculateCompanyScore`) — display-only risk; do not treat client score as authority.  
4. Authenticated lazy finalize via `ensureSeasonFinalizedCallable` / `getSeasonResult(ensure)` is intentional and rate-limited; monitor.  
5. Keep Phase 7 snapshot/rewards flags independent of seasons/challenges UI enablement.  
6. Tutorial Android QA remains an independent release gate.

---

## 19. Production status summary

Phase 7 architecture is **complete and fail-closed in production**.

- Immutable W34 reference intact (`ea2310b854f11eb4`)  
- All reward/snapshot flags OFF; designation allowlist empty  
- Reward backend proven fail-closed  
- Payout intentionally deferred until a natural qualifying designated season  

**PHASE_7_FINAL_AUDIT_VERIFIED**
