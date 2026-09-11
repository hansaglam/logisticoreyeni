/**
 * Legacy tutorial COMPLETE REMOVAL regression.
 * Run: npx tsx scripts/legacy-tutorial-removal-regression-test.ts
 */
import './test-globals';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildContextualGuideProgressSignals,
  hasExistingPlayerProgress,
  resolveContextualGuideFromSave,
} from '../src/contextualGuide/contextualGuideState';
import { hasLegacyTutorialActivityFromRawSave } from '../src/contextualGuide/legacyTutorialSaveSignals';
import {
  normalizeSavePayload,
  payloadToStoreState,
  serializeGameState,
  type SaveGamePayload,
} from '../src/storage/saveGame';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const exists = (rel: string) => existsSync(resolve(root, rel));

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'Pods') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function minimalPayload(
  overrides: Partial<SaveGamePayload> & Record<string, unknown> = {},
): Partial<SaveGamePayload> & Record<string, unknown> {
  return {
    version: 6,
    currentTime: 0,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Test Co',
      money: 20_000,
      level: 1,
      companyLevel: 1,
      xp: 0,
      xpToNextLevel: 100,
      totalXp: 0,
      homeCityId: 'izmir',
      reputation: 50,
      completedContracts: 0,
      failedDeliveries: 0,
      lateDeliveries: 0,
      trucks: [],
      trailers: [],
      drivers: [],
      warehouses: [],
      ...(overrides.player as object),
    },
    ...overrides,
  };
}

console.log('\n=== Legacy Tutorial Complete Removal ===\n');

console.log('Deleted modules');
const deleted = [
  'src/hooks/useAppTutorial.ts',
  'src/hooks/useScreenAppTutorial.ts',
  'src/hooks/useMarketTutorial.ts',
  'src/hooks/useTutorialLayoutReady.ts',
  'src/hooks/useSpotlightTutorialTriggers.ts',
  'src/store/spotlightTutorialStore.ts',
  'src/components/tutorial/AppTutorialOverlay.tsx',
  'src/components/tutorial/AppTutorialTarget.tsx',
  'src/components/tutorial/TutorialOverlay.tsx',
  'src/components/tutorial/SpotlightMask.tsx',
  'src/components/tutorial/TutorialTooltip.tsx',
  'src/components/market/MarketTutorialOverlay.tsx',
  'src/components/market/MarketTutorialHelpButton.tsx',
  'src/tutorial/app/controller.ts',
  'src/tutorial/featureFlags.ts',
  'src/config/marketTutorial.ts',
];
for (const path of deleted) {
  check(!exists(path), `deleted ${path}`);
}
check(!exists('src/tutorial'), 'src/tutorial/ directory gone');
check(!exists('src/components/tutorial'), 'src/components/tutorial/ directory gone');

console.log('\nRuntime source free of legacy systems');
const banned =
  /useAppTutorial|useScreenAppTutorial|useMarketTutorial|AppTutorialOverlay|AppTutorialTarget|MarketTutorialOverlay|ENABLE_SPOTLIGHT_TUTORIAL|APP_TUTORIALS_ENABLED|openHelpGuideForTutorial/;
const runtimeFiles = [
  ...walkTsFiles(resolve(root, 'src/screens')),
  ...walkTsFiles(resolve(root, 'src/components')),
  ...walkTsFiles(resolve(root, 'src/hooks')),
  ...walkTsFiles(resolve(root, 'src/store')),
  ...walkTsFiles(resolve(root, 'src/storage')),
  resolve(root, 'App.tsx'),
];
let bannedHit: string | null = null;
for (const file of runtimeFiles) {
  if (file.includes(`${join('src', 'contextualGuide', 'legacyTutorialSaveSignals')}`)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  if (banned.test(text)) {
    bannedHit = file.replace(root + '/', '');
    break;
  }
}
check(bannedHit == null, bannedHit ? `banned ref in ${bannedHit}` : 'screens/components/hooks/store/App clean');
check(!read('src/store/gameStore.ts').includes('tutorialProgress'), 'gameStore no tutorialProgress');
check(
  !read('src/types/game.ts').includes('spotlightTutorial') &&
    !read('src/types/game.ts').includes('tutorialProgress'),
  'game types drop legacy fields',
);
check(exists('src/components/help/HelpGuideButton.tsx'), 'HelpGuideButton present');
check(exists('src/contextualGuide/openHelpGuide.ts'), 'openHelpGuide present');
check(
  !read('src/contextualGuide/openHelpGuide.ts').includes('AppTutorialId'),
  'openHelpGuide has no AppTutorialId',
);

console.log('\nPersistence / old save compatibility');
{
  check(
    hasLegacyTutorialActivityFromRawSave({
      tutorialProgress: { market: { hasBeenPresented: true } },
    }),
    'raw tutorialProgress detected',
  );
  check(
    hasLegacyTutorialActivityFromRawSave({ marketTutorialCompleted: true }),
    'raw marketTutorialCompleted detected',
  );
  const normalized = normalizeSavePayload(
    minimalPayload({
      marketTutorialCompleted: true,
      tutorialProgress: { dashboard: { hasBeenPresented: true, status: 'completed' } },
      spotlightTutorial: { completedIds: ['first_contract'], skippedIds: [] },
    }),
  );
  const record = normalized as unknown as Record<string, unknown>;
  check(normalized.contextualGuide?.status === 'dismissed', 'legacy activity → existing cohort');
  check(!('tutorialProgress' in record), 'normalize drops tutorialProgress');
  check(!('marketTutorialCompleted' in record), 'normalize drops marketTutorialCompleted');
  check(!('spotlightTutorial' in record), 'normalize drops spotlightTutorial');

  const serialized = serializeGameState(payloadToStoreState(normalized)) as unknown as Record<
    string,
    unknown
  >;
  check(!('tutorialProgress' in serialized), 'serialize omits tutorialProgress');
  check(!('marketTutorialCompleted' in serialized), 'serialize omits marketTutorialCompleted');
  check(!('spotlightTutorial' in serialized), 'serialize omits spotlightTutorial');
}

console.log('\nExisting / new player detection');
{
  const fresh = buildContextualGuideProgressSignals({
    player: { completedContracts: 0, level: 1 },
    activeDeliveries: [],
    missions: { flags: {} },
    tutorial: { isCompleted: false },
    onboarding: { completed: false },
    legacyTutorialActivity: false,
  });
  check(!hasExistingPlayerProgress(fresh), 'true new player');
  check(
    resolveContextualGuideFromSave(undefined, fresh).status === 'eligible',
    'new player eligible for guide',
  );

  const old = buildContextualGuideProgressSignals({
    player: { completedContracts: 0, level: 1 },
    activeDeliveries: [],
    missions: { flags: {} },
    tutorial: { isCompleted: false },
    onboarding: { completed: false },
    legacyTutorialActivity: true,
  });
  check(hasExistingPlayerProgress(old), 'legacy-only signal still existing');
  check(
    resolveContextualGuideFromSave(undefined, old).status === 'dismissed',
    'legacy-only never auto-starts guide',
  );

  const leveled = buildContextualGuideProgressSignals({
    player: { completedContracts: 0, level: 2 },
    onboarding: { completed: false },
    legacyTutorialActivity: false,
  });
  check(hasExistingPlayerProgress(leveled), 'level>1 existing without legacy fields');
}

console.log('\nProtected systems intact');
check(exists('src/contextualGuide/contextualGuideSequence.ts'), 'contextualGuide sequence present');
check(exists('src/screens/HelpGuideScreen.tsx'), 'HelpGuideScreen present');
check(read('src/types/game.ts').includes('onboarding'), 'onboarding types retained');
check(read('src/store/gameStore.ts').includes('completeTutorialStep'), 'mission tutorial step retained');
check(exists('src/config/tutorial.ts'), 'mission tutorial config retained');
check(
  !read('src/screens/MoreScreen.tsx').includes('resetSpotlightTutorials'),
  'MoreScreen no spotlight DEV reset',
);
check(
  !read('src/screens/MoreScreen.tsx').includes('Phase 7 Canary') &&
    !read('src/screens/MoreScreen.tsx').includes('season-close-canary') &&
    !read('src/screens/MoreScreen.tsx').includes('SeasonCloseCanaryScreen'),
  'Phase 7 season-close canary DEV harness removed',
);
check(
  !read('src/screens/MoreScreen.tsx').includes('season-reward-failclosed-canary') &&
    !read('src/screens/MoreScreen.tsx').includes('Reward Fail-Closed') &&
    !read('src/screens/MoreScreen.tsx').includes('SeasonRewardFailClosedCanaryScreen'),
  'Reward Fail-Closed DEV harness removed from MoreScreen',
);

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('✅ ALL PASS\n');
