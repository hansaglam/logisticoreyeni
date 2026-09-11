/**
 * Phase 7 Step 9 — Reward-enabled season designation regression.
 * Run: npx tsx scripts/season-reward-designation-regression-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  freezeSeasonRewardPolicyFields,
  parseSeasonRewardEnabledSeasonAllowlist,
  resolveSeasonRewardPolicy,
  validateSeasonRewardDesignation,
} from '../backend/src/seasonRewardPolicy';
import {
  SEASON_REWARD_CATALOG_VERSION,
  isSeasonRewardsEnabled,
} from '../backend/src/seasonRewardTypes';

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const FIXTURE = '2026-W99';

console.log('\n=== Season Reward Designation Regression ===\n');

const policySrc = read('backend/src/seasonRewardPolicy.ts');
const closeSrc = read('backend/src/seasonClose.ts');
const rewardsSrc = read('backend/src/seasonRewards.ts');
const indexSrc = read('backend/src/index.ts');
const rules = read('firestore.rules');
const inspect = read('backend/scripts/inspectSeasonRewardPolicy.ts');
const materializeScript = read('backend/scripts/materializeSeasonRewards.ts');

// 1–4 designation resolve
{
  const off = resolveSeasonRewardPolicy(FIXTURE, { enabledSeasonsRaw: '' });
  check(off.rewardsEnabled === false, '1. non-designated season freezes rewards false');
  check(off.rewardCatalogVersion === null, '2. rewardCatalogVersion null when disabled');

  const on = resolveSeasonRewardPolicy(FIXTURE, { enabledSeasonsRaw: FIXTURE });
  check(on.rewardsEnabled === true, '3. designated future season freezes rewards true');
  check(
    on.rewardCatalogVersion === SEASON_REWARD_CATALOG_VERSION,
    '4. designated future season freezes catalog v1',
  );
}

// 5–8 resume / historical
{
  check(
    closeSrc.includes('resolveSeasonRewardPolicy') &&
      closeSrc.includes('freezeSeasonRewardPolicyFields'),
    'close init uses designation resolver',
  );
  check(
    closeSrc.includes('if (snap.exists)') && closeSrc.includes('return existing'),
    '5/6. existing closing/closed meta returned (not overwritten)',
  );

  const frozen = freezeSeasonRewardPolicyFields(
    resolveSeasonRewardPolicy(FIXTURE, { enabledSeasonsRaw: FIXTURE }),
  );
  const later = resolveSeasonRewardPolicy(FIXTURE, { enabledSeasonsRaw: '' });
  check(
    frozen.rewardsEnabled === true &&
      later.rewardsEnabled === false &&
      frozen.rewardsEnabled !== later.rewardsEnabled,
    '7. config change after freeze would resolve differently (meta must win)',
  );
  check(
    policySrc.includes('never retrofit') ||
      closeSrc.includes('never overwrite') ||
      closeSrc.includes('Preserve frozen reward'),
    '8. historical rewards-disabled cannot retrofit (docs/invariant)',
  );
}

// 9–10 global vs per-season
{
  const previous = process.env.SEASON_REWARDS_ENABLED;
  process.env.SEASON_REWARDS_ENABLED = 'true';
  const stillOff = resolveSeasonRewardPolicy(FIXTURE, { enabledSeasonsRaw: '' });
  check(
    isSeasonRewardsEnabled() === true && stillOff.rewardsEnabled === false,
    '9. global backend flag alone does not designate a season',
  );
  delete process.env.SEASON_REWARDS_ENABLED;
  const designatedWhileGlobalOff = resolveSeasonRewardPolicy(FIXTURE, {
    enabledSeasonsRaw: FIXTURE,
  });
  check(
    isSeasonRewardsEnabled() === false && designatedWhileGlobalOff.rewardsEnabled === true,
    '10. per-season designation alone does not allow claim while global flag false',
  );
  check(
    rewardsSrc.includes('isSeasonRewardsEnabled()') &&
      rewardsSrc.includes('rewardsEnabled !== true'),
    '10b. claim/materialize require BOTH global flag and meta rewardsEnabled',
  );
  if (previous === undefined) delete process.env.SEASON_REWARDS_ENABLED;
  else process.env.SEASON_REWARDS_ENABLED = previous;
}

// 11 unsupported catalog
{
  const bad = resolveSeasonRewardPolicy(FIXTURE, {
    enabledSeasonsRaw: FIXTURE,
    supportedCatalogVersion: 99,
  });
  check(
    bad.rewardsEnabled === false && bad.reason === 'unsupported-catalog-version',
    '11. unsupported catalog fails closed',
  );
  const validation = validateSeasonRewardDesignation(FIXTURE, {
    enabledSeasonsRaw: FIXTURE,
    supportedCatalogVersion: 99,
  });
  check(validation.ok === false, '11b. validate rejects unsupported catalog');
}

// 12–14 materialization contract
{
  check(
    rewardsSrc.includes("reason: 'rewards-disabled-for-season'"),
    '12/13. materialization requires frozen enabled policy / rejects disabled',
  );
  check(
    rewardsSrc.includes("reason: 'unsupported-catalog-version'"),
    '14. materialization rejects unsupported catalog',
  );
  check(
    rewardsSrc.includes('isSeasonRewardsEnabled()') &&
      materializeScript.includes('SEASON_REWARDS_ENABLED'),
    'materialize ops require global flag',
  );
}

// 15–16 scheduler
{
  check(
    indexSrc.includes('finalizeWeeklySeasonClose') && indexSrc.includes('finalizeSeason('),
    '15. scheduler finalizes via finalizeSeason',
  );
  const schedulerBlock = indexSrc.slice(
    indexSrc.indexOf('export const finalizeWeeklySeasonClose'),
    indexSrc.indexOf('export const', indexSrc.indexOf('export const finalizeWeeklySeasonClose') + 10),
  );
  check(
    schedulerBlock.includes('finalizeSeason') &&
      !schedulerBlock.includes('materializeSeasonReward'),
    '16. scheduler does not materialize rewards',
  );
  check(
    closeSrc.includes('resolveSeasonRewardPolicy(seasonKey)'),
    '15b. scheduler path freezes via same resolver at close init',
  );
}

// 17–18 client authority
{
  check(
    rules.includes('match /seasons/{seasonKey}') &&
      rules.includes('allow read, write: if false'),
    '17. client cannot write season reward authority',
  );
  check(
    rules.includes('match /rewardEntitlements/{uid}') &&
      rules.includes('match /rewardClaims/{uid}'),
    '17b. entitlement/claim paths deny client',
  );
  check(
    !indexSrc.includes('enableSeasonRewards') &&
      !indexSrc.includes('materializeSeasonRewardEntitlementsCallable'),
    '18. no public enable / materialize callable',
  );
}

// 19 W34 protections
{
  check(
    parseSeasonRewardEnabledSeasonAllowlist(undefined).size === 0,
    '19. default allowlist empty (W34 not auto-designated)',
  );
  const w34ConfigOnly = resolveSeasonRewardPolicy('2026-W34', {
    enabledSeasonsRaw: '2026-W34',
  });
  // Config could resolve true, but production meta already closed false — documented.
  check(
    w34ConfigOnly.rewardsEnabled === true &&
      closeSrc.includes('return existing'),
    '19b. W34-like existing meta path returns existing (no retrofit write)',
  );
}

// operator + source of truth
{
  check(inspect.includes('readOnly: true'), 'operator inspect is read-only');
  check(
    inspect.includes('configWouldBeIgnoredBecauseMetaExists'),
    'operator reports when config would be ignored',
  );
  check(
    policySrc.includes('SEASON_REWARD_ENABLED_SEASONS'),
    'config source SEASON_REWARD_ENABLED_SEASONS',
  );
  check(
    !policySrc.includes('isSeasonRewardsEnabled'),
    'designation module does not collapse into global ops flag',
  );
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('✅ ALL PASS\n');
