/**
 * Starter guide UI removal regression — Dashboard uses app tutorial only.
 * Run: npx tsx scripts/dashboard-starter-guide-removal-test.ts
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log('\n=== dashboard-starter-guide-removal-test ===\n');

const dashboard = readFileSync('src/screens/DashboardScreen.tsx', 'utf8');
assert(!dashboard.includes('DashboardNextActionCard'), 'DashboardScreen does not mount starter guide card');
assert(!dashboard.includes('BAŞLANGIÇ REHBERİ'), 'DashboardScreen has no starter guide label');
assert(!dashboard.includes('resolveOnboardingDashboardAction'), 'DashboardScreen does not resolve legacy card action');
assert(dashboard.includes('advanceOnboardingProgress'), 'background onboarding sync retained');
assert(dashboard.includes('useScreenAppTutorial'), 'reusable dashboard tutorial retained');
assert(dashboard.includes('AppTutorialOverlay'), 'dashboard tutorial overlay retained');

for (const screen of ['ContractsScreen.tsx', 'MapScreen.tsx', 'MissionsScreen.tsx']) {
  const source = readFileSync(`src/screens/${screen}`, 'utf8');
  assert(!source.includes('OnboardingHintCard'), `${screen} has no legacy onboarding hint card`);
  assert(!source.includes('useActiveOnboardingHint'), `${screen} has no legacy hint hook`);
  assert(source.includes('useOnboardingScreenVisit'), `${screen} keeps visit tracking for progression gate`);
}

const hook = readFileSync('src/hooks/useOnboardingScreenVisit.ts', 'utf8');
assert(!hook.includes('useActiveOnboardingHint'), 'hint hook removed from useOnboardingScreenVisit');

try {
  readFileSync('src/components/dashboard/DashboardNextActionCard.tsx', 'utf8');
  assert(false, 'DashboardNextActionCard.tsx deleted');
} catch {
  assert(true, 'DashboardNextActionCard.tsx deleted');
}

try {
  readFileSync('src/components/onboarding/OnboardingHintCard.tsx', 'utf8');
  assert(false, 'OnboardingHintCard.tsx deleted');
} catch {
  assert(true, 'OnboardingHintCard.tsx deleted');
}

const index = readFileSync('src/components/dashboard/index.ts', 'utf8');
assert(!index.includes('DashboardNextActionCard'), 'dashboard index does not export starter card');

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
