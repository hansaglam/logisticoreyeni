# Map v2 — Legacy progression & reward history migration (Step 29AJ)

Server-only attested baseline migration. No public UI, no auto-run, no client-trusted progression fields, no cash grants, no public save mutation.

## PREVIEW

- Callable: `previewCanonicalLegacyProgressionMigrationInternal` (gate: `CANONICAL_PROGRESSION_MIGRATION=INTERNAL_TEST`).
- Backend: `previewCanonicalLegacyProgressionMigration` — **read-only** (no Firestore writes).
- Request keys allowed: `canonicalSchemaVersion` only. All progression/claim/hash/save fields are rejected.
- Loads `users/{uid}/saves/current` from server storage, plus canonical progression/migration docs, `canonicalRewardClaims`, `canonicalProgressionReceipts`, and `serverState/current`.
- Returns classification, structural validation, server `sourceSnapshotHash`, proposed baseline, blockers, and policy — never the raw save blob.

## APPLY

- Callable: `applyCanonicalLegacyProgressionMigrationInternal` (same gate).
- Backend: `applyCanonicalLegacyProgressionMigration` — **create-only** single Firestore transaction.
- Request keys: `canonicalSchemaVersion` only. A client snapshot hash is rejected (`sourceHash`, `sourceSnapshotHash`, `expectedSourceSnapshotHash`).
- Step 29AK apply is `INTERNAL_PRE_FROZEN_SOURCE_PATH`. The public-ready path is immediate cutover in `MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`, which reads the save and creates the source plus migration in one transaction.
- Creates migration record, migration receipt, `canonicalCompanyProgression/current`, and one baseline progression receipt (`progression:migration:v1`). No overwrite of existing canonical progression or successful migration.

## SERVER SNAPSHOT

Source of truth is always the stored cloud save document (`users/{uid}/saves/current`), not request bodies.

Audited fields for migration decisions:

- Envelope: `schemaVersion`, `saveVersion`, `syncId`, `payloadChecksum`, `ownerUid`
- `gameState.version`, `gameState.player` (level, companyLevel, xp, xpToNextLevel, totalXp, reputation)
- Mirrored `gameState.meta` (level, xp, totalXp when present)
- Mission/milestone/weekly claim markers and `rewardReceipts` keys
- Existing canonical reward claims and progression/migration docs

## NORMALIZATION

`buildNormalizedLegacyMigrationSnapshot(gameState)` extracts a stable, migration-only object:

- `saveVersion`
- `player` progression scalars (including `companyLevel` when present)
- `meta` mirrors (nullable per field)
- `rewardHistory`: sorted mission ids, milestone ids, weekly claim pairs, sorted receipt keys

Unrelated save fields (cash, trucks, map state, etc.) are excluded from the migration hash.

## HASH

- Algorithm: UTF-8 canonical JSON of the normalized snapshot → SHA-256 → reported as `sha256:<64-char-hex>`.
- Constant: `LEGACY_PROGRESSION_MIGRATION_SOURCE_HASH_ALGORITHM = sha256-canonical-json-v1`.
- Full `gameState` hash (same as cloud save `payloadChecksum`) is computed separately for **integrity** only (`cloudSaveSnapshotHashInput`).

### Exact hashed field set

Top-level keys (stable order via `canonicalJsonStringify`):

1. `saveVersion`
2. `player` — `level`, `companyLevel`, `xp`, `xpToNextLevel`, `totalXp`, `reputation`
3. `meta` — `level`, `xp`, `totalXp`
4. `rewardHistory` — `claimedMissionRewardIds`, `milestoneIdsClaimed`, `weeklyClaims`, `rewardReceiptKeys` (all sorted)

## HASH THREAT MODEL

- **SNAPSHOT_INTEGRITY_IDENTITY** — the hash identifies the exact server-loaded migration snapshot used for apply provenance.
- **≠ GAMEPLAY_AUTHORITY** — the hash does **not** prove historical client XP/reputation/claims were legitimately earned.
- Legacy baseline uses `SERVER_ATTESTED_LEGACY_BASELINE` / `LEGACY_BASELINE_ATTESTED_NOT_EARNED`, not earned canonical gameplay.

## CREATE-ONLY GUARANTEE

Apply transaction fails (no partial writes) when:

- Canonical progression already exists (non-retry)
- Successful migration record/receipt already exists
- Non-migration `canonicalProgressionReceipts` indicate active earned history
- Structural/meta/reward-history validation fails
- Unsupported save schema/version
- Optional `expectedSourceSnapshotHash` ≠ current server migration hash (`MIGRATION_BLOCKED_SAVE_CONFLICT`)

Retry after success returns `alreadyMigrated: true` without creating a second baseline or receipt.

## PROVENANCE

Migration record + receipts store:

- `attestationClass` (`SERVER_ATTESTED_LEGACY_BASELINE` or `NEW_ACCOUNT_DEFAULTS_EQUIVALENT`)
- `migrationPolicyVersion`, `sourceSaveVersion`, `sourceSyncId`, `sourceSnapshotHash`
- Derived baseline level/xp/totalXp/reputation from server-side `totalXp` curve
- `rewardHistory` consumption policy metadata (no fabricated historical claim docs)

## REWARD HISTORY

- Existing server `canonicalRewardClaims` remain authoritative.
- Save-local claim markers are consumed for one-time rewards only (no retroactive XP/cash).
- No retroactive fabrication of `canonicalRewardClaims` or gameplay progression receipts.
- Post-migration 29AI claims use `resolveMigratedClientRewardTreatment` (consumed missions/milestones, cutover week closed, 29W cash blocked).

## RACES

- Single apply transaction reads migration + progression + receipts + save before create.
- Concurrent apply: one wins; the other gets `ALREADY_MIGRATED` or create failure.
- Claim/delivery XP races: migration does not mutate save or cash; canonical progression appears atomically with migration lock docs.

## RETRY

Exact retry after successful apply: read existing migration + progression + receipts → `alreadyMigrated: true`, same hash/baseline, no second receipt.

## Meta / player consistency

When both `player` and `meta` expose a field, values must match exactly. Mismatch → `LEGACY_PROGRESSION_META_PLAYER_CONFLICT` (no silent pick). Older schemas without meta fields skip mirror checks for absent meta keys only.

## Structural validation

Uses production `calculateXpToNextLevel` / `deriveProgressionFromTotalXp` through max level 30. `STRUCTURALLY_VALID` is separate from server trust.

## Firestore paths

| Artifact | Path |
|----------|------|
| Migration record | `users/{uid}/canonicalProgressionMigration/current` |
| Migration receipt | `users/{uid}/canonicalProgressionMigrationReceipts/progressionMigration:{uid}:v1` |
| Progression | `users/{uid}/canonicalCompanyProgression/current` |
| Baseline progression receipt | `users/{uid}/canonicalProgressionReceipts/progression:migration:v1` |

Client write: **false** for all migration/progression/receipt docs (rules unchanged in strength).

## Status

`LEGACY_PROGRESSION_REWARD_MIGRATION_PASS_INTERNAL_ATTESTED_BASELINE` — internal attested baseline only; public rollout remains blocked (`LEGACY_PROGRESSION_MIGRATION_PUBLIC_ROLLOUT`).

Step 29AM: internal canonical read authority can display the migrated doc without copying it back into the save (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`). The public read gate stays off. Cash authority and ROAD settlement are unchanged.
