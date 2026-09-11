/**
 * Contextual guide performance regression — static + pure helper contracts.
 * No fake FPS claims.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  canShowContextualGuideCard,
  getCurrentContextualGuideCardId,
  isContextualGuideAutoShowAllowed,
  selectHasRunningDelivery,
} from '../src/contextualGuide/contextualGuideSequence';
import type { ContextualGuideState } from '../src/types/game';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

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

console.log('\n=== Contextual Guide Performance Regression ===\n');

const host = read('src/contextualGuide/components/ContextualGuideHost.tsx');
const hook = read('src/contextualGuide/hooks/useContextualGuideHost.ts');
const card = read('src/contextualGuide/components/ContextualGuideCard.tsx');
const help = read('src/screens/HelpGuideScreen.tsx');
const helpSections = read('src/contextualGuide/helpGuideSections.ts');
const map = read('src/screens/MapScreen.tsx');
const fleet = read('src/screens/FleetScreen.tsx');
const sequence = read('src/contextualGuide/contextualGuideSequence.ts');
const dashboard = read('src/screens/DashboardScreen.tsx');
const contracts = read('src/screens/ContractsScreen.tsx');
const more = read('src/screens/MoreScreen.tsx');

console.log('Inactive / subscriptions');
check(host.includes('selectGuideStatus'), 'host gates on status primitive');
check(host.includes('isContextualGuideAutoShowAllowed'), 'inactive early-out before Active');
check(host.includes('memo(') || host.includes('memo(ContextualGuideHost'), 'host memoized');
check(!/useGameStore\(\(state\) => state\.contextualGuide\)/.test(hook), 'hook does not subscribe to full guide object');
check(hook.includes('canShowContextualGuideCard(state.contextualGuide'), 'visibility derived in selector');
check(!hook.includes('selectHasRunningDelivery'), 'hook no longer requires delivery selector');
check(!/\buseGameStore\(\s*\)/.test(hook), 'no bare useGameStore()');
check(!/\buseGameStore\(\s*\)/.test(host), 'host no bare useGameStore()');

console.log('\nMap');
check(map.includes("cardId=\"follow_route\""), 'map mounts follow_route');
check(!map.includes('hasActiveDelivery={runningDeliveries.length'), 'map does not pass delivery array length prop');
check(!map.includes('hasActiveDelivery='), 'map does not pass hasActiveDelivery');
check(!hook.includes('routeCoordinates') && !hook.includes('truckPosition'), 'guide ignores route/position');
check(
  canShowContextualGuideCard(
    {
      version: 1,
      status: 'active',
      completedCardIds: ['welcome', 'choose_contract', 'manage_fleet'],
      dismissedCardIds: [],
    },
    'follow_route',
  ),
  'follow_route showable without delivery',
);

console.log('\nOther screens');
check(dashboard.includes("cardId=\"welcome\""), 'dashboard host');
check(contracts.includes("cardId=\"choose_contract\""), 'contracts host');
check(fleet.includes("cardId=\"manage_fleet\""), 'fleet host');
{
  const hostMatch = fleet.match(/<ContextualGuideHost[\s\S]*?\/>/);
  check(
    Boolean(hostMatch && !/\bvehicles\s*=/.test(hostMatch[0])),
    'fleet guide not subscribed via vehicles prop',
  );
}
check(more.includes("cardId=\"need_help\""), 'more host');

console.log('\nTimers / media / writes');
const guideFiles = [host, hook, card, sequence, help, helpSections];
check(guideFiles.every((src) => !/\bsetInterval\s*\(/.test(src)), 'no setInterval');
check(guideFiles.every((src) => !/\bsetTimeout\s*\(/.test(src)), 'no setTimeout engine');
check(guideFiles.every((src) => !/\bonSnapshot\s*\(/.test(src)), 'no Firestore onSnapshot');
check(!card.includes('lottie') && !card.includes('Lottie'), 'no Lottie');
check(!card.includes('Video') && !card.includes('.gif'), 'no video/gif');
check(!card.includes('Animated.') && !card.includes(' co-layout'), 'no RN Animated loop on card');
check(card.includes('shadows.soft'), 'lightweight soft shadow');
check(card.includes('memo(') || card.includes('memo(function'), 'card memoized');
check(!help.includes('getFirestore') && !help.includes('onSnapshot'), 'help no backend fetch');
check(helpSections.includes('HELP_GUIDE_SECTIONS'), 'help static module content');

console.log('\nPersistence / purity');
check(!host.includes('saveGame') && !hook.includes('saveGame'), 'host does not save on render');
check(!hook.includes('set({') && !hook.includes('.setState'), 'hook no direct store write on render');

const dismissed: ContextualGuideState = {
  version: 1,
  status: 'dismissed',
  completedCardIds: [],
  dismissedCardIds: [],
};
const completed: ContextualGuideState = {
  version: 1,
  status: 'completed',
  completedCardIds: ['welcome', 'choose_contract', 'manage_fleet', 'follow_route', 'need_help'],
  dismissedCardIds: [],
};
const active: ContextualGuideState = {
  version: 1,
  status: 'active',
  completedCardIds: ['welcome'],
  dismissedCardIds: [],
};

check(!isContextualGuideAutoShowAllowed(dismissed), 'dismissed not auto-show');
check(!isContextualGuideAutoShowAllowed(completed), 'completed not auto-show');
check(getCurrentContextualGuideCardId(dismissed) === null, 'dismissed current card null');
check(getCurrentContextualGuideCardId(completed) === null, 'completed current card null');
check(getCurrentContextualGuideCardId(active) === 'choose_contract', 'active next card');
check(
  canShowContextualGuideCard(
    {
      version: 1,
      status: 'active',
      completedCardIds: ['welcome', 'choose_contract', 'manage_fleet'],
      dismissedCardIds: [],
    },
    'follow_route',
  ),
  'follow_route without delivery (guided)',
);
check(
  canShowContextualGuideCard(active, 'choose_contract'),
  'choose_contract visible when current',
);
check(
  selectHasRunningDelivery({ activeDeliveries: [{ status: 'on_route' }] }) === true,
  'delivery boolean true (compat helper)',
);
check(
  selectHasRunningDelivery({ activeDeliveries: [{ status: 'completed' }] }) === false,
  'delivery boolean ignores completed',
);
check(selectHasRunningDelivery({ activeDeliveries: [] }) === false, 'delivery boolean empty');
check(selectHasRunningDelivery({}) === false, 'delivery boolean missing');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('✅ ALL PASS\n');
