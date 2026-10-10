# Map V2 — Canonical ROAD timing authority (Step 29I)

**Status:** `CANONICAL_ROAD_TIMING_AUTHORITY_PASS_INTERNAL_FIXED_SPEED_ONLY`

**Settlement readiness:** `ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_FLEET_MIGRATION` (updated in Step 29J)

HUD overlay/listener off. `canUseServerAuthoritativeSettlement()` false. `SAVE_GAME_VERSION` **6**.  
`MULTIMODAL_OFF`. RAIL/SEA/AIR `FOUNDATION_ONLY`. **No cash movement.**

This is **not** production game-clock authority and **not** HUD cash activation.

---

## 1. Why timing blocked settlement

Step 29H could derive cash from frozen truck fixtures **if** travel hours were trusted. Completions accepted client `actualTravelHours` after a weak bound check. A client could send `0` (or any in-bound value) and erase late penalties.

---

## 2. Existing game-time model

| Item | Production behavior |
| --- | --- |
| Mapping | `realMsToGameHours(ms, speed) = ms / getMsPerGameHour(speed)` |
| `getMsPerGameHour` | `speed >= 6` → 1000ms/hour (debug); `>= 1.5` → 7500; else **15000** (`simulationTimeScale`) |
| Online | `useGameLoop` ticks `advanceTime` every `tickMs` (1000) unless paused / inactive |
| Speed | `setGameSpeed` clamps 0.25–8; persisted as `gameSpeed` / `lastSimulationGameSpeed` |
| Pause | Stops the online loop. Offline catch-up still uses wall clock at last simulation speed |
| Background / app-closed | `applyOfflineProgressionIfNeeded` converts elapsed real ms → game hours |
| Delivery progress | Incremental `advanceTime` **plus** wall-clock catch-up from `lastProgressedRealAtMs` |
| Settlement hours | `computeEffectiveTravelHours` uses **game** `currentTime - startedAt`, pause diagnostics, **capped by progress × travelHours** |

There is a global game clock (`currentTime`) advanced incrementally. Speed changes mid-delivery. Offline continues. Therefore **naive `completedAt - acceptedAt` at live speed is not production travel hours**.

---

## 3–5. Speed, pause, offline (production)

Speed is mutable and persisted. Pause stops ticks only. Offline/background still progress deliveries. Do not treat production wall-clock as live `actualTravelHours`.

---

## 6. Timing authority model chosen

**INTERNAL_TEST Model A (constrained):** `INTERNAL_FIXED_SPEED_WALL_CLOCK`

- Frozen speed **1x** → `msPerGameHour = 15000` (`road-game-time-policy-v1`)
- Policy `canonical-road-timing-internal-fixed-v1`
- Server `nowMs` (callable arrival / test injection) is the only clock
- Client `actualTravelHours`, device `Date.now`, and timing category are **ignored**
- Pause/speed-change callables **not** built (canonical clock does not pause)
- Offline: **server wall clock continues** (cannot hide elapsed time)
- Accept = execution start (same transaction as economics freeze)

Not production parity with `computeEffectiveTravelHours` / boosts / pause.

---

## 7. Server start time

`timingSnapshot.startedAtServerMs = acceptedAtMs`. Retry accept does **not** rewrite it.

---

## 8. Timing segments

Single open segment at 1x from start until completion `endedAtServerMs`. No speed-change API.

---

## 9–10. Completion time / classifications

`elapsed = max(0, completedAtServerMs - startedAtServerMs)`  
`actualTravelHours = realMsToGameHours(elapsed, 1)`  
Integer seconds: `floor(elapsed * 3600 / 15000)`

Production **cash** late penalty: `actual > deadline` using `calculateLatePenalty` (continuous). EARLY vs ON_TIME **does not change cash**.

**Category** matches `classifyDeliveryPunctuality` (reputation), not the 29H 85%/1.5× heuristic:

- `EARLY`: `actual <= plannedTravel × 0.92`
- `ON_TIME`: `actual <= deadline`
- `LATE_MINOR`: lateness ratio `<= 0.1` (≤ 1.1× deadline)
- `LATE_MAJOR`: later than that
- `FAILED`: client-reported failure (separate authority)

Planned travel = frozen `expectedDurationHours`. Deadline = canonical contract `deadlineHours`.

---

## 11. Late penalty authority

Uses **server-derived** hours in `prepareCanonicalRoadDeliverySettlement`. Client hours diagnostic only.

---

## 12–13. Device clock / latency

Device ±2h cannot change `nowMs` on the backend. Completion timestamp = request arrival. **No grace** (`completionNetworkGraceMs` unused). Latency can slightly increase elapsed; INTERNAL_TEST accepts that.

---

## 14–16. Two-device, restart, kill switch

One delivery doc / one `startedAt`. Either device completing uses the same timeline. Restart does not reset start. Report callable does not require the timing env gate; in-flight completions remain resolvable if issuance/accept later turns off.

---

## 17. Failure authority

`FAILURE_EXECUTION_AUTHORITY_CLIENT_REPORTED`. Failure penalty still from canonical payment. Client can still report FAILED vs COMPLETED. Public anti-cheat incomplete.

---

## 18. Incidents

No trusted incident delay. Extra real time while the job is open is included in server elapsed automatically.

---

## 19. Fragile

Unchanged from 29H: frozen start condition; live completion-time condition still a gap. Timing does not mix that blocker.

---

## 20–21. INTERNAL_TEST / public limits

Fixture trucks remain. Live speed/pause/offline formula is **not** what the server uses. Public ROAD unchanged. Canonical timing env `EXPO_PUBLIC_CANONICAL_ROAD_TIMING` defaults **OFF** (documentation/client). Server derives time whenever a canonical delivery has a timing snapshot.

---

## 22. Next

Live save fleet remains `LEGACY_CLIENT_FLEET_UNVERIFIED`. INTERNAL_TEST fixtures are server-owned as of Step 29J.

Recommended: **STEP 29K — INTERNAL_TEST server-cash shadow** (standard jobs) or production fleet migration. Do not enable HUD.

Step 29Y stamps `canonical-road-execution-timing-internal-v1` on new INTERNAL deliveries when `CANONICAL_ROAD_TIMING_AUTHORITY=INTERNAL_TEST`. Those deliveries derive hours from server elapsed, speed buckets, and the production offline cap. This fixed-speed snapshot remains the authority only when that policy is absent.
