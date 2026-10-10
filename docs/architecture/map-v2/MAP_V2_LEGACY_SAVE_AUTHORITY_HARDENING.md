# Map v2 — Legacy save authority hardening (Step 29AK)

Internal source freeze for a future public progression migration. Public rollout stays off. A frozen source is an immutable server copy of migration-relevant fields. It is not reconstructed gameplay history.

## 1. Current save writer model

`users/{uid}/saves/current` is written by the signed-in client in `uploadCloudSave` (`src/services/cloudSaveService.ts`). The write is a Firestore batch `set` with `merge: true` of the full envelope: `ownerUid`, `schemaVersion`, `saveVersion`, `deviceUpdatedAt`, `gameState`, `summary`, `payloadChecksum`, `syncId`. Rules allow the owner to create and update any field except that `ownerUid` must match. There is no server validator on that write.

| Field / subtree | Writer | Write API | Client writable | Server validated | Revision control | Checksum | Conflict model | Offline writes | Migration relevance | Authority class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `gameState.player.level` | client `uploadCloudSave` | `set` merge | yes | no | client `deviceUpdatedAt` | integrity only | client timestamp LWW | yes, later upload | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `gameState.player.companyLevel` | same | same | yes | no | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `gameState.player.xp` | same | same | yes | no | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `gameState.player.xpToNextLevel` | same | same | yes | no | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `gameState.player.totalXp` | same | same | yes | no | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `gameState.player.reputation` | same | same | yes | no | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `gameState.meta.level/xp/totalXp` | same, copied from player at serialize | same | yes | structural check only at freeze | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| missions / milestones / weekly claims / `rewardReceipts` | same | same | yes | shape check at freeze only | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `saveVersion` | client payload | same | yes | must be 6 at freeze | same | same | same | yes | yes | `CLIENT_WRITABLE_UNTRUSTED` |
| `syncId` / `deviceUpdatedAt` | client | same | yes | stored, not a server counter | client timestamp | no | LWW | yes | revision label only | `CLIENT_WRITABLE_UNTRUSTED` |
| `payloadChecksum` | client SHA-256 of canonical JSON | same | yes, client recomputes | server recomputes at freeze | n/a | yes | mismatch blocks freeze | yes | integrity only | `INTEGRITY_SIGNAL_ONLY` |
| fleet, contracts, inventory, settings inside `gameState` | client | same | yes | no | same | full-blob checksum | LWW | yes | no | `NOT_MIGRATION_RELEVANT` |
| `canonicalProgressionMigrationSource/current` | Admin SDK freeze | transaction `create` | read only | yes | one document | server hash | create-only | n/a | yes | `SERVER_FROZEN_LEGACY_MIGRATION_SOURCE` / `IMMUTABLE_AFTER_FREEZE` |
| canonical progression, receipts, reward claims | Admin SDK | transaction create | write false | yes | server | n/a | create-only | n/a | preserved | `SERVER_WRITTEN` |

## 2–6. Authority, checksum, revision, conflict

Checksum is computed on the client (`sha256(canonicalJsonStringify(gameState))`). The client can recompute it. The server independently recomputes it at freeze and compares it to `payloadChecksum`. A match detects corruption or a torn envelope. It does not prove gameplay. Classification: `INTEGRITY_SIGNAL_ONLY`.

Revision is not a server counter and is not compare-and-swap. `syncId` is `${uid}:${saveVersion}:${deviceUpdatedAt}` and `deviceUpdatedAt` is `meta.savedAt` or `Date.now()` on the device. Firestore `updatedAt` is a server timestamp stored beside the blob and is not used to reject stale writes. The write model is last-write-wins.

Conflict handling is client-side. `compareLocalAndCloudSave` picks the newer `lastLocalSaveAt`. If the cloud copy is newer, upload waits for an explicit choice. The server stores one document, so an unresolved UI conflict is not visible on `saves/current`. Freeze fails with `MIGRATION_SOURCE_BLOCKED_SAVE_CONFLICT` when the stored checksum does not match the server hash of `gameState`, or when `ownerUid` does not match. It does not freeze one side of a conflict the server cannot see.

## 7. Migration source threat

Until freeze, a client can change level, XP, total XP, reputation, and claim markers, then upload. A later server read only proves which blob was stored.

## 8–14. Frozen source

Policy: `canonical-progression-migration-source-freeze-v1`. Any other `migrationPolicyVersion` fails closed.

Path: `users/{uid}/canonicalProgressionMigrationSource/current`.

Identity: `progressionMigrationSource:{uid}:v1`. One document per user. Receipt: `users/{uid}/canonicalProgressionMigrationSourceReceipts/progressionMigrationSource:{uid}:v1`.

Schema stores schema/policy versions, save version, save revision (`syncId`), `sourceSnapshotHash`, `normalizedSnapshot`, `authorityClass` `SERVER_FROZEN_LEGACY_MIGRATION_SOURCE`, `freezeStatus` `FROZEN_FOR_MIGRATION`, `frozenAtServerMs`, and `freezeId`. Unrelated save data is not copied.

Gate: `CANONICAL_PROGRESSION_MIGRATION=INTERNAL_TEST`. Missing is off.

`freezeCanonicalProgressionMigrationSource` authenticates, checks the gate, refuses an existing canonical progression, refuses a completed migration, reads `saves/current` inside one transaction, validates schema, meta/player equality, and structure, normalizes, hashes, and creates the source once. It does not create progression, XP, or cash.

Re-freeze is forbidden. A second freeze returns the same source (`MIGRATION_SOURCE_ALREADY_FROZEN`) and does not overwrite it. There is no client abort and no expiry.

## 15–16. Apply linkage and later save edits

Apply reads the frozen source inside its transaction and ignores `saves/current`. If the source is missing, the result is `MIGRATION_SOURCE_NOT_FROZEN`. There is no fallback. If `sha256(normalizedSnapshot)` does not match the stored hash, apply returns `MIGRATION_SOURCE_HASH_INTEGRITY_ERROR`.

The migration record and receipt store `migrationSourceId`, `migrationSourcePolicyVersion`, `sourceSnapshotHash`, and `frozenAtServerMs`.

A save edited after freeze does not change the baseline. Example: freeze at total XP 5000, later save total XP 50000, apply still uses 5000.

## 17–20. Progress and claims after freeze

`POST_FREEZE_SAVE_STILL_MUTABLE`. Firestore rules still allow the owner to rewrite the save. Apply ignores that rewrite.

`LOCAL_PROGRESSION_AFTER_FREEZE_NOT_CAPTURED`. `CLAIM_AFTER_FREEZE_NOT_CAPTURED`.

Chosen cutover: internal states are unfrozen, then frozen, then migrated (a short-lived freeze). That freeze is transitional. A long-lived gap is not acceptable for public rollout because local XP and local claims after freeze are dropped. Public cutover, when it exists, must freeze and apply in one player-visible step. Field-level progression locks were not added: the client writes the whole save with merge, and nested equality rules were not proven safe. Full save blocking was not added because it would stop fleet, contract, and inventory writes.

## 21–24. Races and rules

Two freezes: one create, the other reads the committed source. Two applies: one migration, the other `alreadyMigrated`.

The freeze transaction reads `saves/current` before creating the source. In production Firestore, a concurrent commit to that save document retries the transaction onto the new committed save. This repository's unit harness serializes transactions and does not simulate that retry. A save write after the freeze commit does not change the source. That case is tested.

Canonical claim, delivery XP, and non-delivery XP still cannot overwrite a migration, and a migration cannot overwrite existing canonical progression or non-migration receipts.

Client write is false for the source, source receipt, migration, progression, and progression receipts.

## 25–27. Public limits and next step

Status: `LEGACY_SAVE_AUTHORITY_HARDENING_PASS_PARTIAL`.

Public source readiness: `LEGACY_MIGRATION_SOURCE_PUBLIC_CUTOVER_BLOCKED`.

`LEGACY_PROGRESSION_MIGRATION_PUBLIC_ROLLOUT` stays blocked. The freeze is server-owned and cannot be repeated, and apply uses it, but post-freeze local progress can still be lost, the save stays client-writable, and there is no UI cutover.

Baseline attestation remains `SERVER_ATTESTED_LEGACY_BASELINE`. Source immutability is `SERVER_FROZEN_LEGACY_MIGRATION_SOURCE`. The progression receipt stays `LEGACY_BASELINE_ATTESTED_NOT_EARNED`.

Normalized snapshot size is the canonical JSON of the migration slice only (well under the 1 MiB document limit; a default account is under 1 KB).

The public-ready path is immediate cutover, not this freeze API (`NOT_PUBLIC_CUTOVER_PATH`). See `MAP_V2_LEGACY_PROGRESSION_IMMEDIATE_CUTOVER.md`. Applying an already frozen source remains `INTERNAL_PRE_FROZEN_SOURCE_PATH`.

Step 29AM: signed-in canonical display can read `canonicalCompanyProgression/current` behind `CANONICAL_PROGRESSION_READ_AUTHORITY=INTERNAL_TEST` (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`). The listener does not write the save. Public rollout stays blocked. Cash authority and ROAD settlement are unchanged.

Step 29AN: shop and warehouse client level gates can read that same projection (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`). The eligibility reader does not write the save. Contract eligibility stays local.
