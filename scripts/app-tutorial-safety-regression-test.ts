/**
 * App tutorial safety regression tests.
 * Run: npx tsx scripts/app-tutorial-safety-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  createDisabledScreenTutorialResult,
  disableTutorialForSession,
  isTutorialSessionDisabled,
  resetTutorialSessionDisables,
} from '../src/tutorial/app/controller';
import { APP_TUTORIALS_ENABLED } from '../src/tutorial/app/featureFlags';
import { getAppTutorialSteps } from '../src/tutorial/app/definitions';
import {
  normalizeTutorialProgress,
  shouldAutoStartTutorial,
} from '../src/tutorial/app/persistence';
import { selectHasPendingDeliveryIncident } from '../src/tutorial/app/selectors';
import { resolveScreenTutorialId, SCREEN_TUTORIAL_MAP } from '../src/tutorial/app/screenMap';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

console.log('\n=== App Tutorial Safety Regression ===\n');

console.log('Malformed tutorialProgress');
{
  assert(JSON.stringify(normalizeTutorialProgress(null)) === '{}', 'null → {}');
  assert(JSON.stringify(normalizeTutorialProgress(undefined)) === '{}', 'undefined → {}');
  assert(JSON.stringify(normalizeTutorialProgress([])) === '{}', 'array → {}');
  assert(JSON.stringify(normalizeTutorialProgress('bad')) === '{}', 'string → {}');
  const malformed = normalizeTutorialProgress({
    dashboard: { completed: 'yes', version: 'x' },
    bogus: { completed: true, version: 1 },
  } as unknown);
  assert(malformed.dashboard?.completed === false, 'invalid completed → false');
  assert(malformed.dashboard?.version === 0, 'invalid version → 0');
  assert(malformed.bogus == null, 'unknown tutorial id dropped');
  assert(
    shouldAutoStartTutorial('dashboard', null as unknown as never, undefined),
    'null progress still auto-starts dashboard',
  );
}

console.log('\nSafe delivery incident selector');
{
  assert(
    selectHasPendingDeliveryIncident({ activeDeliveries: undefined } as never) === false,
    'undefined activeDeliveries is safe',
  );
  assert(
    selectHasPendingDeliveryIncident({ activeDeliveries: null } as never) === false,
    'null activeDeliveries is safe',
  );
  assert(
    selectHasPendingDeliveryIncident({
      activeDeliveries: [
        {
          incident: { status: 'pending' },
          incidentResolved: false,
        },
      ],
    } as never),
    'pending incident detected safely',
  );
}

console.log('\nScreen tutorial mapping');
{
  assert(SCREEN_TUTORIAL_MAP.more === null, 'more has no screen tutorial');
  assert(resolveScreenTutorialId('more') === null, 'resolve more → null');
  assert(resolveScreenTutorialId('dashboard') === 'dashboard', 'resolve dashboard');
  assert(getAppTutorialSteps('dashboard').length > 0, 'dashboard definition exists');
}

console.log('\nDisabled controller + session disable');
{
  resetTutorialSessionDisables();
  const disabled = createDisabledScreenTutorialResult({ current: null }, 'contracts');
  assert(disabled.overlayProps.visible === false, 'disabled overlay is hidden');
  assert(disabled.helpButtonProps.disabled === true, 'help button disabled');
  disableTutorialForSession('dashboard');
  assert(isTutorialSessionDisabled('dashboard'), 'session disable works');
  resetTutorialSessionDisables();
  assert(!isTutorialSessionDisabled('dashboard'), 'session disable resets');
}

console.log('\nKill switch default');
{
  assert(typeof APP_TUTORIALS_ENABLED === 'boolean', 'kill switch is boolean');
}

console.log('\nSource wiring');
{
  const hookSource = readFileSync('src/hooks/useScreenAppTutorial.ts', 'utf8');
  assert(hookSource.includes('selectHasPendingDeliveryIncident'), 'hook uses safe selector');
  assert(hookSource.includes('normalizeTutorialProgress'), 'hook normalizes progress');
  assert(hookSource.includes('APP_TUTORIALS_ENABLED'), 'hook respects kill switch');

  const boundarySource = readFileSync('src/components/ScreenErrorBoundary.tsx', 'utf8');
  assert(boundarySource.includes('[screen-runtime-error]'), 'screen boundary logs runtime error');
  assert(boundarySource.includes('Bu ekran şu anda yüklenemedi'), 'user-facing copy updated');

  const appSource = readFileSync('App.tsx', 'utf8');
  assert(appSource.includes('screenRetryKeys'), 'screen retry remount key exists');
  assert(appSource.includes('onRetry'), 'screen retry handler wired');

  const overlaySource = readFileSync('src/components/tutorial/AppTutorialOverlay.tsx', 'utf8');
  assert(overlaySource.includes('AppTutorialErrorBoundary'), 'overlay wrapped in tutorial boundary');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
