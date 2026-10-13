# Map v2 — Canonical progression write authority (Step 29AO)

Status: `CANONICAL_PROGRESSION_WRITE_AUTHORITY_PASS_INTERNAL_ONLY`.

The write gate is `CANONICAL_PROGRESSION_WRITE_AUTHORITY=INTERNAL_TEST`, and it stays off unless `CANONICAL_PROGRESSION_READ_AUTHORITY` is also `INTERNAL_TEST`. Guest and pre-migration accounts keep local XP and reputation mutations. A canonical account does not advance `player.xp`, `totalXp`, `level`, or `reputation` from the client. Loading and unavailable projections fail closed. Cash, contracts, ROAD settlement, and RAIL/SEA/AIR are unchanged.

Code: `src/domain/canonicalProgressionWriteAuthority.ts`, `src/services/canonicalProgressionWriteAuthority.ts`. The service reads `getCanonicalProgressionReadSnapshot()` and does not open a listener. Test: `scripts/map-v2-canonical-progression-write-authority-regression-test.ts`.

## Authority

| Class | Write decision |
| --- | --- |
| Guest | `LOCAL_AUTHORITATIVE` |
| Signed-in, no canonical document | `LOCAL_AUTHORITATIVE` |
| Canonical server projection | `CANONICAL_SERVER_EXPECTED` when a receipt pipeline exists, otherwise `LOCAL_NON_AUTHORITATIVE_BLOCKED` |
| Canonical loading | `CANONICAL_LOADING_BLOCKED` |
| Canonical unavailable, invalid, or unsupported | `CANONICAL_UNAVAILABLE_BLOCKED` |

Both canonical decisions skip the local mutation. `CANONICAL_SERVER_EXPECTED` is an acknowledgement that the server receipt is the company grant. The client does not invent a second grant.

## Audited paths

| Path | Trigger | Write target | Canonical action | Backend source |
| --- | --- | --- | --- | --- |
| completeDelivery XP | delivery completed | xp, level, totalXp | ack / no-op | `ROAD_DELIVERY_COMPLETION` |
| completeDelivery reputation | delivery completed | reputation, history | ack / no-op | `canonical-road-reputation-v1` |
| failDelivery reputation | failure | reputation, history | ack / no-op | `ROAD_DELIVERY_SERVER_FAILURE` |
| failDelivery cancel reputation | cancel | reputation, history | ack / no-op | `ROAD_DELIVERY_CANCEL` |
| buyTruck XP | truck purchase | xp, level, totalXp | ack / no-op | catalog purchase receipt |
| hireDriver XP | driver hire | xp, level, totalXp | ack / no-op | hire receipt |
| openWarehouse XP | warehouse open | xp, level, totalXp | ack / no-op | warehouse open receipt |
| upgradeWarehouse XP | warehouse upgrade | xp, level, totalXp | ack / no-op | warehouse upgrade receipt |
| sellProductFromWarehouse XP | cargo sale | xp, level, totalXp | ack / no-op | cargo sale receipt, zero-decay only |
| mission claim XP and reputation | mission reward | xp, reputation, history | ack / no-op | `claimCanonicalClientReward` mission |
| milestone claim XP and reputation | milestone reward | xp, reputation, history | ack / no-op | milestone claim |
| weekly claim XP and reputation | weekly objective | xp, reputation, history | ack / no-op | weekly claim |
| operation choice XP and reputation | incident choice | xp, reputation, history | blocked | none |
| vehicle recovery reputation | recovery | reputation, history | blocked | none |
| checkLevelUp | stored xp crosses threshold | level, xp | blocked | none |
| debug +XP | debug buttons | xp, level, totalXp | blocked | none |

Fleet, cash, warehouse inventory, mission claim flags, and driver XP still commit. Driver level is not company progression.

## Feedback suppressed for canonical accounts

- Level-up toast, level-up event, and level-up OS notification. They run only after a local XP commit.
- Reputation toast `İtibar güncellendi`. It runs only when the local reputation patch applied.
- Delivery event suffix `+XP`.
- Cargo sale notification suffix `+XP`. Profit text stays.
- Debug buttons report `Yerel şirket XP yazımı kapalı` instead of claiming XP was added.

Mission, milestone, and weekly claim copy still says the reward was claimed, because cash and claim flags still apply. That copy does not state an XP amount.

## Still not a company grant

Operation-choice XP, vehicle-recovery reputation, debug XP, cargo-sale quality decay, and mission/milestone/weekly rewards whose progress is client-only. Those local writes are blocked and this step does not add a server grant for them.

Legacy save fields stay in schema version 6 for guest and pre-migration saves. A blocked call does not advance them and does not upload a new company progression value.

## Left local on purpose

Contracts filters, contract acceptance, assignment, the tab badge, map matching, ads, and delivery boost. Shop, warehouse, and Map v2 preview eligibility stay on the Step 29AN resolver.

## Next blocker

`CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE`. Public migration UI stays unwired. Unsupported reward progress and cargo quality remain without a server grant.
