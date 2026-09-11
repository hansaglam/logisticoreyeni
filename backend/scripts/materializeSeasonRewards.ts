/**
 * Admin/ops-only: materialize season reward entitlements via Admin SDK.
 * Not a Cloud Function. Not callable by players.
 *
 * Usage:
 *   SEASON_REWARDS_ENABLED=true npx tsx backend/scripts/materializeSeasonRewards.ts 2026-W40
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { materializeSeasonRewardEntitlements } from '../src/seasonRewards';

async function main(): Promise<void> {
  const seasonKey = process.argv[2];
  if (!seasonKey || !/^\d{4}-W\d{2}$/.test(seasonKey)) {
    console.error('Usage: SEASON_REWARDS_ENABLED=true npx tsx backend/scripts/materializeSeasonRewards.ts <seasonKey>');
    process.exitCode = 1;
    return;
  }
  if (process.env.SEASON_REWARDS_ENABLED !== 'true') {
    console.error('Refusing: set SEASON_REWARDS_ENABLED=true explicitly for this ops script.');
    process.exitCode = 1;
    return;
  }
  if (getApps().length === 0) {
    initializeApp();
  }
  const result = await materializeSeasonRewardEntitlements(getFirestore(), seasonKey, {
    maxDurationMs: 120_000,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
