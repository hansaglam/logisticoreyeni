# Map v2 — Immediate legacy progression cutover (Step 29AL)

Internal-only. One transaction reads the stored save, freezes that exact slice, and creates the migration baseline. There is no freeze-then-wait-then-apply window in this path. Public rollout stays off.

## 1. Problem with separate freeze/apply

Step 29AK can leave `FROZEN_FOR_MIGRATION` while the client keeps writing the save. XP and local claims earned after that freeze are not in the baseline (`LOCAL_PROGRESSION_AFTER_FREEZE_NOT_CAPTURED`, `CLAIM_AFTER_FREEZE_NOT_CAPTURED`). That path remains internal tooling (`NOT_PUBLIC_CUTOVER_PATH`). Apply of an already frozen source remains `INTERNAL_PRE_FROZEN_SOURCE_PATH`.

## 2. Immediate cutover model

`cutoverCanonicalLegacyProgressionMigration` / callable `cutoverCanonicalLegacyProgressionMigrationInternal`.

Gate: `CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER=INTERNAL_TEST`. Missing is off. This is not the 29AJ migration gate.

Policy recorded on the cutover documents: `canonical-progression-immediate-cutover-v1`. The snapshot schema stays `canonical-progression-migration-source-freeze-v1`. Migration records stay `canonical-progression-migration-v1`. Older internal migrations are not invalidated.

The request may contain only `canonicalSchemaVersion` and an optional exact `cutoverPolicyVersion`. Level, XP, reputation, claims, hashes, and baselines are rejected.

## 3. Transaction boundary

One Firestore transaction reads `saves/current`, canonical progression, the migration source, the migration record and receipt, the baseline progression receipt, `serverState/current`, canonical reward claims, and progression receipts.

It then creates, together:

- `canonicalProgressionMigrationSource/current` with `freezeStatus` `FROZEN_AT_CUTOVER`
- the source receipt
- `canonicalProgressionMigration/current` with status `MIGRATED`
- the migration receipt
- `canonicalCompanyProgression/current`
- `canonicalProgressionReceipts/progression:migration:v1`

A failure writes none of those documents. The callable does not return after creating only a source.

## 4. Save read semantics

The save document is read inside that transaction, not from process memory captured earlier. Production Firestore transactions are optimistic. If `saves/current` (or any other document read in the transaction) is committed by someone else before this transaction commits, Firestore retries the transaction and the retry reads the new committed save. The transaction does not lock the save against the client. It does not mix two saves into one normalized snapshot: each attempt normalizes the single save version it read.

This repository's unit tests serialize transactions in memory. They do not prove Firestore retry behavior. The emulator was not run (`FIRESTORE_EMULATOR_BLOCKED_NO_JAVA`).

## 5–7. Normalization, hash, source

The normalized snapshot is the existing migration slice. Its SHA-256 is stored on the source, the migration record, the migration receipt, and the baseline receipt from that same computation. Attestation stays `SERVER_ATTESTED_LEGACY_BASELINE`. The hash is not proof that the history was earned. `gameplayAuthority` remains `NOT_RECONSTRUCTED_LEGACY_HISTORY`. The progression receipt stays `LEGACY_BASELINE_ATTESTED_NOT_EARNED`.

## 8–11. Migration, baseline, rewards, provenance

Level, XP, and `xpToNextLevel` are derived from the in-transaction total XP. Reputation follows the existing migration policy. Reward-history markers come from that same snapshot. Existing server claims stay authoritative. No claim documents, XP grants, cash, or reputation rewards are fabricated. A default-equivalent save stays `NEW_ACCOUNT_DEFAULTS_EQUIVALENT`.

## 12–15. Retry, two devices, races

A retry after commit returns `alreadyMigrated` with the original hash and migration id. It does not create a second source or baseline.

Two concurrent cutovers: one commits, the other observes the migration and returns `alreadyMigrated`.

A concurrent save upload either commits before the cutover retry, so the retry freezes that newer save, or commits after the cutover, so its progression fields are ignored. A concurrent local claim is either inside the save version the transaction reads, or it lands after cutover and is not canonical.

An existing canonical progression or a non-migration progression receipt blocks cutover. If cutover commits first, later delivery XP, non-delivery XP, and canonical reward claims read `canonicalCompanyProgression/current` only. `readCanonicalProgressionContext` does not read the save. New-account initialization reads the save only to refuse a legacy account; it does not import progression. Contract batch generation reads canonical progression for level and reputation.

## 16. Existing frozen source

If a 29AK source exists and migration is not complete, cutover returns `MIGRATION_SOURCE_PREEXISTING_FROZEN_REQUIRES_RESOLUTION` and does not replace the source. Resolve it with the internal apply path, or leave it. There is no refreeze.

## 17–18. After cutover

Later save uploads may still contain progression fields. Those fields are `POST_MIGRATION_SAVE_PROGRESSION_IGNORED_FOR_AUTHORITY` and `POST_MIGRATION_LOCAL_PROGRESSION_NON_AUTHORITATIVE`. The cloud checksum can still validate the blob. It does not move canonical progression. There is no remigration.

Step 29AM adds an internal read path (`MAP_V2_CANONICAL_PROGRESSION_READ_AUTHORITY.md`). With `CANONICAL_PROGRESSION_READ_AUTHORITY=INTERNAL_TEST`, signed-in canonical accounts display the server doc and do not fall back to the save. The gate defaults off, so public clients still show the save. Local progression writes still continue and are non-authoritative after cutover.

## 19. Public rollout

Backend cutover status: `LEGACY_PROGRESSION_IMMEDIATE_CUTOVER_PASS_INTERNAL_ONLY`.

Public migration rollout stays blocked by the UI split-brain, continued client-side progression, legacy fleet and drivers, public Contracts, and the other ROAD gaps. `canUseServerAuthoritativeSettlement` stays false. RAIL, SEA, and AIR stay foundation-only. `SAVE_GAME_VERSION` stays 6.

## 20. Next step

29AM closes the display split only behind `CANONICAL_PROGRESSION_READ_AUTHORITY=INTERNAL_TEST`. 29AN moves shop and warehouse client level gates onto that projection behind a second gate (`MAP_V2_CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY.md`). Contract eligibility stays local. Public rollout remains blocked. Local progression writes still run. Do not enable ROAD settlement until the cash gate is actually clear.
