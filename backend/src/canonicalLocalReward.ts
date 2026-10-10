/**
 * INTERNAL_TEST local reward claims (Step 29W).
 * Eligibility is canonical fleet count. Amounts come from mission/milestone catalogs.
 * With the Step 29AI client-reward XP gate on, claims go through claimCanonicalClientReward.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_LOCAL_REWARD_POLICY_VERSION,
  CANONICAL_LOCAL_REWARD_SCHEMA_VERSION,
  CANONICAL_REWARD_CLAIMS_COLLECTION,
  countCanonicalActiveRewardTrucks,
  createCanonicalRewardClaimId,
  deriveCanonicalLocalRewardEligibility,
  findCanonicalLocalReward,
  isCanonicalLocalRewardAllowed,
  type CanonicalRewardClaimReceipt,
  type CanonicalRewardDefinition,
} from '../../src/domain/canonicalLocalRewardClaim';
import {
  CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV,
  CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED,
  isCanonicalClientRewardXpAllowed,
} from '../../src/domain/canonicalClientRewardXp';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
} from './canonicalCashTransaction';

export type ClaimCanonicalLocalRewardResult =
  | { ok: true; alreadyApplied: boolean; receipt: CanonicalRewardClaimReceipt }
  | { ok: false; reason: string };

export function canonicalRewardClaimPath(uid: string, claimId: string): string {
  return `users/${uid}/${CANONICAL_REWARD_CLAIMS_COLLECTION}/${claimId}`;
}

function isCollectionQuerySnap(
  snap: unknown,
): snap is { docs: Array<{ data: () => Record<string, unknown> | undefined }> } {
  return Boolean(snap && typeof snap === 'object' && Array.isArray((snap as { docs?: unknown }).docs));
}

export async function listCollectionDocs(
  transaction: Transaction,
  firestore: Firestore,
  collectionPath: string,
): Promise<Record<string, unknown>[]> {
  const collection = (
    firestore as Firestore & { collection?: (path: string) => { path: string } }
  ).collection?.(collectionPath);
  if (!collection) return [];
  const snap = await transaction.get(collection as never);
  if (isCollectionQuerySnap(snap)) {
    return snap.docs
      .map((doc) => doc.data())
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }
  return [];
}

/**
 * The 29W cash grant (transaction id = claim id). Must run after every other read in the
 * caller's transaction; returns the 29W claim receipt fields.
 */
export async function applyCanonicalLocalRewardCashInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  reward: CanonicalRewardDefinition,
  amount: number,
  nowMs: number,
): Promise<
  | { ok: true; fields: Omit<CanonicalRewardClaimReceipt, 'claimedAtMs' | 'ownerUid'> }
  | { ok: false; reason: string }
> {
  const claimId = createCanonicalRewardClaimId(reward);
  const cash = await applyCanonicalCashMutationsInTransaction(
    transaction,
    firestore,
    uid,
    [
      {
        uid,
        transactionId: claimId,
        operationType: reward.operationType,
        sourceId: reward.rewardId,
        amountDelta: amount,
        nowMs,
        metadata: { policyVersion: CANONICAL_LOCAL_REWARD_POLICY_VERSION },
      },
    ],
    nowMs,
  );
  if (!cash.ok) return { ok: false, reason: cash.reason };
  if (cash.alreadyApplied) return { ok: false, reason: 'CANONICAL_REWARD_CLAIM_CONFLICT' };
  return {
    ok: true,
    fields: {
      schemaVersion: CANONICAL_LOCAL_REWARD_SCHEMA_VERSION,
      claimId,
      rewardId: reward.rewardId,
      rewardFamily: reward.family,
      eligibilityPolicyVersion: CANONICAL_LOCAL_REWARD_POLICY_VERSION,
      rewardAmount: amount,
      cashBefore: cash.cashBefore,
      cashAfter: cash.cashAfter,
      cashTransactionId: claimId,
      eligibilityEvidenceClass: reward.eligibility,
      authoritySource: 'INTERNAL_CANONICAL_FLEET',
      multiplicity: 'ONE_TIME',
    },
  };
}

export async function claimCanonicalLocalRewardTransaction(
  firestore: Firestore,
  uid: string,
  rewardId: string,
  nowMs: number,
  options?: { envValue?: string | null; clientRewardXpEnvValue?: string | null },
): Promise<ClaimCanonicalLocalRewardResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalLocalRewardAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_LOCAL_REWARD_AUTHORITY_OFF' };
  }
  const xpGate =
    options && 'clientRewardXpEnvValue' in options
      ? options.clientRewardXpEnvValue
      : process.env[CANONICAL_CLIENT_REWARD_XP_AUTHORITY_ENV];
  if (isCanonicalClientRewardXpAllowed({ envValue: xpGate })) {
    return { ok: false, reason: CLIENT_REWARD_XP_CLAIM_PATH_REQUIRED };
  }
  const reward = findCanonicalLocalReward(rewardId);
  if (!reward) return { ok: false, reason: 'UNKNOWN_REWARD' };
  const claimId = createCanonicalRewardClaimId(reward);

  return firestore.runTransaction(async (transaction) => {
    const cRef = firestore.doc(canonicalRewardClaimPath(uid, claimId));
    const [claimSnap, fleetRows] = await Promise.all([
      transaction.get(cRef),
      listCollectionDocs(transaction, firestore, `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}`),
    ]);
    if (claimSnap.exists) {
      const existing = claimSnap.data() as CanonicalRewardClaimReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.rewardId !== reward.rewardId ||
        existing.rewardAmount !== reward.amount ||
        existing.cashTransactionId !== claimId
      ) {
        return { ok: false as const, reason: 'CANONICAL_REWARD_CLAIM_CONFLICT' };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }
    const trucks = countCanonicalActiveRewardTrucks(
      fleetRows as unknown as Parameters<typeof countCanonicalActiveRewardTrucks>[0],
    );
    const eligibility = deriveCanonicalLocalRewardEligibility(reward, trucks);
    if (!eligibility.ok) return { ok: false as const, reason: eligibility.reason };
    const cash = await applyCanonicalLocalRewardCashInTransaction(
      transaction,
      firestore,
      uid,
      reward,
      eligibility.amount,
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    const receipt: CanonicalRewardClaimReceipt = {
      ...cash.fields,
      claimedAtMs: nowMs,
      ownerUid: uid,
    };
    transaction.create(cRef, receipt);
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}
