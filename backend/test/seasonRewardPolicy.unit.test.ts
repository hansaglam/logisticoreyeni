/**
 * Phase 7 Step 9 — season reward designation unit tests (no emulator / no prod writes).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  freezeSeasonRewardPolicyFields,
  parseSeasonRewardEnabledSeasonAllowlist,
  resolveSeasonRewardPolicy,
  validateSeasonRewardDesignation,
} from '../src/seasonRewardPolicy';
import { SEASON_REWARD_CATALOG_VERSION, isSeasonRewardsEnabled } from '../src/seasonRewardTypes';

const FIXTURE_SEASON = '2026-W99';

test('allowlist empty fail-closed', () => {
  assert.equal(parseSeasonRewardEnabledSeasonAllowlist(undefined).size, 0);
  assert.equal(parseSeasonRewardEnabledSeasonAllowlist('').size, 0);
  assert.equal(parseSeasonRewardEnabledSeasonAllowlist('  ').size, 0);
});

test('allowlist parses valid keys only', () => {
  const set = parseSeasonRewardEnabledSeasonAllowlist(
    ` ${FIXTURE_SEASON}, bogus, 2026-W1, 2026-W40 `,
  );
  assert.equal(set.has(FIXTURE_SEASON), true);
  assert.equal(set.has('2026-W40'), true);
  assert.equal(set.has('bogus'), false);
  assert.equal(set.has('2026-W1'), false);
});

test('non-designated season freezes rewards false / catalog null', () => {
  const policy = resolveSeasonRewardPolicy(FIXTURE_SEASON, {
    enabledSeasonsRaw: '',
  });
  assert.equal(policy.rewardsEnabled, false);
  assert.equal(policy.rewardCatalogVersion, null);
  assert.equal(policy.reason, 'not-designated');
  assert.deepEqual(freezeSeasonRewardPolicyFields(policy), {
    rewardsEnabled: false,
    rewardCatalogVersion: null,
  });
});

test('designated future season freezes rewards true / catalog v1', () => {
  const policy = resolveSeasonRewardPolicy(FIXTURE_SEASON, {
    enabledSeasonsRaw: FIXTURE_SEASON,
  });
  assert.equal(policy.rewardsEnabled, true);
  assert.equal(policy.rewardCatalogVersion, SEASON_REWARD_CATALOG_VERSION);
  assert.equal(policy.reason, 'designated');
  assert.deepEqual(freezeSeasonRewardPolicyFields(policy), {
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
  });
});

test('global SEASON_REWARDS_ENABLED alone does not designate', () => {
  const previous = process.env.SEASON_REWARDS_ENABLED;
  process.env.SEASON_REWARDS_ENABLED = 'true';
  assert.equal(isSeasonRewardsEnabled(), true);
  const policy = resolveSeasonRewardPolicy(FIXTURE_SEASON, {
    enabledSeasonsRaw: '',
  });
  assert.equal(policy.rewardsEnabled, false);
  assert.equal(policy.configuredDesignation, false);
  if (previous === undefined) delete process.env.SEASON_REWARDS_ENABLED;
  else process.env.SEASON_REWARDS_ENABLED = previous;
});

test('designation independent of global flag off', () => {
  const previous = process.env.SEASON_REWARDS_ENABLED;
  delete process.env.SEASON_REWARDS_ENABLED;
  assert.equal(isSeasonRewardsEnabled(), false);
  const policy = resolveSeasonRewardPolicy(FIXTURE_SEASON, {
    enabledSeasonsRaw: FIXTURE_SEASON,
  });
  assert.equal(policy.rewardsEnabled, true);
  assert.equal(policy.rewardCatalogVersion, 1);
  if (previous === undefined) delete process.env.SEASON_REWARDS_ENABLED;
  else process.env.SEASON_REWARDS_ENABLED = previous;
});

test('unsupported catalog fail-closed at resolve', () => {
  const policy = resolveSeasonRewardPolicy(FIXTURE_SEASON, {
    enabledSeasonsRaw: FIXTURE_SEASON,
    supportedCatalogVersion: 99,
  });
  assert.equal(policy.rewardsEnabled, false);
  assert.equal(policy.rewardCatalogVersion, null);
  assert.equal(policy.reason, 'unsupported-catalog-version');
  assert.equal(policy.configuredDesignation, true);
});

test('invalid season key fail-closed', () => {
  const policy = resolveSeasonRewardPolicy('not-a-season', {
    enabledSeasonsRaw: 'not-a-season',
  });
  assert.equal(policy.rewardsEnabled, false);
  assert.equal(policy.reason, 'invalid-season-key');
});

test('validateSeasonRewardDesignation', () => {
  const ok = validateSeasonRewardDesignation(FIXTURE_SEASON, {
    enabledSeasonsRaw: FIXTURE_SEASON,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'ok');

  const off = validateSeasonRewardDesignation(FIXTURE_SEASON, {
    enabledSeasonsRaw: '',
  });
  assert.equal(off.ok, true);
  assert.equal(off.reason, 'not-designated');

  const bad = validateSeasonRewardDesignation('nope');
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid-season-key');
});

test('frozen meta simulation: config change does not alter prior freeze', () => {
  const frozen = freezeSeasonRewardPolicyFields(
    resolveSeasonRewardPolicy(FIXTURE_SEASON, { enabledSeasonsRaw: FIXTURE_SEASON }),
  );
  assert.equal(frozen.rewardsEnabled, true);
  assert.equal(frozen.rewardCatalogVersion, 1);

  // Later config removes designation — frozen values must stay as previously written.
  const later = resolveSeasonRewardPolicy(FIXTURE_SEASON, { enabledSeasonsRaw: '' });
  assert.equal(later.rewardsEnabled, false);
  // Simulate initializeClosingMeta resume: existing meta wins.
  const existingMeta = {
    rewardsEnabled: frozen.rewardsEnabled,
    rewardCatalogVersion: frozen.rewardCatalogVersion,
  };
  assert.equal(existingMeta.rewardsEnabled, true);
  assert.equal(existingMeta.rewardCatalogVersion, 1);
  assert.notEqual(existingMeta.rewardsEnabled, later.rewardsEnabled);
});

test('historical closed rewards-disabled cannot retrofit via config', () => {
  const historical = {
    status: 'closed',
    rewardsEnabled: false,
    rewardCatalogVersion: null as number | null,
  };
  const wouldDesignate = resolveSeasonRewardPolicy('2026-W34', {
    enabledSeasonsRaw: '2026-W34',
  });
  assert.equal(wouldDesignate.rewardsEnabled, true);
  // Existing meta remains authoritative:
  assert.equal(historical.rewardsEnabled, false);
  assert.equal(historical.rewardCatalogVersion, null);
});
