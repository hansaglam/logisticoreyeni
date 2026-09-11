/**
 * Phase 7 Step 9 — READ-ONLY season reward designation inspector.
 *
 * Usage:
 *   npx tsx backend/scripts/inspectSeasonRewardPolicy.ts --seasonKey=2026-W40
 *
 * Never writes. Never enables flags. Never mutates Firestore.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { isValidLeaderboardSeasonKey } from '../src/leaderboardSeason';
import {
  parseSeasonRewardEnabledSeasonAllowlist,
  resolveSeasonRewardPolicy,
  validateSeasonRewardDesignation,
  SEASON_REWARD_ENABLED_SEASONS_ENV,
} from '../src/seasonRewardPolicy';
import { isSeasonRewardsEnabled } from '../src/seasonRewardTypes';

const PROJECT_ID = 'logisticore-53ab4';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

function prepareAdc(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () =>
      | { tokens?: { refresh_token?: string } }
      | undefined;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cliApi = require('firebase-tools/lib/api') as {
    clientId: () => string;
    clientSecret: () => string;
  };
  const refreshToken = cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  if (!refreshToken) return;
  const directory = mkdtempSync(resolve(tmpdir(), 'lc-reward-policy-inspect-'));
  const credentialPath = resolve(directory, 'authorized-user.json');
  writeFileSync(
    credentialPath,
    JSON.stringify({
      type: 'authorized_user',
      client_id: cliApi.clientId(),
      client_secret: cliApi.clientSecret(),
      refresh_token: refreshToken,
      quota_project_id: PROJECT_ID,
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
}

async function main(): Promise<void> {
  const seasonKey = argValue('seasonKey') ?? process.argv[2];
  if (!seasonKey || !isValidLeaderboardSeasonKey(seasonKey)) {
    console.error(
      'Usage: npx tsx backend/scripts/inspectSeasonRewardPolicy.ts --seasonKey=2026-W40',
    );
    process.exitCode = 1;
    return;
  }

  const allowlist = [...parseSeasonRewardEnabledSeasonAllowlist()];
  const resolved = resolveSeasonRewardPolicy(seasonKey);
  const validation = validateSeasonRewardDesignation(seasonKey);

  let existingMeta: Record<string, unknown> | null = null;
  let metaExists = false;
  let configWouldBeIgnored = false;

  try {
    prepareAdc();
    if (getApps().length === 0) {
      initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    }
    const snap = await getFirestore().doc(`seasons/${seasonKey}`).get();
    metaExists = snap.exists;
    if (snap.exists) {
      const data = snap.data() as Record<string, unknown>;
      existingMeta = {
        status: data.status ?? null,
        rewardsEnabled: data.rewardsEnabled === true,
        rewardCatalogVersion: data.rewardCatalogVersion ?? null,
        participantCount: data.participantCount ?? null,
        processedCount: data.processedCount ?? null,
        closedAt: data.closedAt ?? null,
      };
      configWouldBeIgnored = true;
    }
  } catch (error) {
    existingMeta = {
      readError: error instanceof Error ? error.message : String(error),
    };
  }

  console.log(
    JSON.stringify(
      {
        readOnly: true,
        seasonKey,
        globalSeasonRewardsEnabled: isSeasonRewardsEnabled(),
        envAllowlistKey: SEASON_REWARD_ENABLED_SEASONS_ENV,
        configuredAllowlist: allowlist,
        configuredDesignation: resolved.configuredDesignation,
        resolvedPolicy: {
          rewardsEnabled: resolved.rewardsEnabled,
          rewardCatalogVersion: resolved.rewardCatalogVersion,
          reason: resolved.reason,
        },
        validation: {
          ok: validation.ok,
          reason: validation.reason,
        },
        existingMeta,
        metaExists,
        configWouldBeIgnoredBecauseMetaExists: configWouldBeIgnored,
        note: configWouldBeIgnored
          ? 'Existing closing/closed meta is authoritative; config changes will not retrofit.'
          : 'No meta yet — next close init would freeze resolvedPolicy.',
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
