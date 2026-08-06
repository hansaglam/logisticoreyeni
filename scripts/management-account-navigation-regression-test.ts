/**
 * Management menu → Account navigation regression.
 * Run: npx tsx scripts/management-account-navigation-regression-test.ts
 */

import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import {
  CANONICAL_ACCOUNT_MORE_ROUTE,
  CANONICAL_ACCOUNT_TAB,
  MANAGEMENT_MODULE_ROUTES,
  getManagementNavigationTarget,
  resolveManagementModule,
  resolveMoreScreenRoute,
  shouldFocusAccountSection,
} from '../src/navigation/managementNavigation';

const ROOT = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(): void {
  console.log('\nmanagement-account-navigation-regression-test\n');

  const accountTarget = getManagementNavigationTarget('Account');
  assert(accountTarget.tab === CANONICAL_ACCOUNT_TAB, 'canonical Account tab is more/Şirket');
  assert(
    accountTarget.moreSubRoute === CANONICAL_ACCOUNT_MORE_ROUTE,
    'canonical Account more route is account',
  );
  assert(resolveMoreScreenRoute('account') === 'menu', 'account pending resolves to Şirket menu');
  assert(shouldFocusAccountSection('account'), 'account pending focuses Hesap section');
  assert(!shouldFocusAccountSection('finance'), 'finance pending does not focus Hesap');
  assert(resolveMoreScreenRoute('finance') === 'finance', 'finance pending stays finance');

  assert(resolveManagementModule('account') === 'Account', 'quick access account maps to Account module');
  assert(resolveManagementModule('finance') === 'Finance', 'quick access finance maps to Finance module');
  assert(resolveManagementModule('warehouse') === 'Warehouses', 'quick access warehouse maps to Warehouses');
  assert(resolveManagementModule('fleet') === 'Fleet', 'quick access fleet maps to Fleet');
  assert(resolveManagementModule('missions') === 'Missions', 'quick access missions maps to Missions');
  assert(resolveManagementModule('shop') === 'Store', 'quick access shop maps to Store');

  assert(MANAGEMENT_MODULE_ROUTES.Finance.tab === 'more', 'Finance lives under more/Şirket');
  assert(MANAGEMENT_MODULE_ROUTES.Finance.moreSubRoute === 'finance', 'Finance subroute is finance');
  assert(MANAGEMENT_MODULE_ROUTES.Warehouses.moreSubRoute === 'warehouse', 'Warehouses subroute is warehouse');
  assert(MANAGEMENT_MODULE_ROUTES.Fleet.tab === 'fleet', 'Fleet is a root tab');
  assert(!MANAGEMENT_MODULE_ROUTES.Account.moreSubRoute || MANAGEMENT_MODULE_ROUTES.Account.moreSubRoute === 'account', 'Account does not invent a second screen route');

  const appSrc = readSrc('App.tsx');
  const moreSrc = readSrc('src/screens/MoreScreen.tsx');
  const tabBarSrc = readSrc('src/components/navigation/GameTabBar.tsx');
  const menuSrc = readSrc('src/components/navigation/QuickAccessMenu.tsx');
  const navSrc = readSrc('src/navigation/managementNavigation.ts');

  assert(appSrc.includes('navigateToManagementModule'), 'App uses central management navigation helper');
  assert(appSrc.includes('resolveManagementModule'), 'quick access actions go through module mapping');
  assert(
    !/case 'account':\s*setActiveTab\('more'\)/.test(appSrc),
    'Account no longer only setActiveTab(more) without subroute',
  );
  assert(appSrc.includes("pendingMoreSubRoute: target.moreSubRoute"), 'more modules set pendingMoreSubRoute');

  assert(moreSrc.includes('resolveMoreScreenRoute'), 'MoreScreen resolves pending subroutes centrally');
  assert(moreSrc.includes('shouldFocusAccountSection'), 'MoreScreen focuses Hesap section for Account');
  assert(moreSrc.includes('<AccountSection />'), 'AccountSection remains on Şirket menu');
  assert(!moreSrc.includes("if (route === 'account')"), 'no duplicate Account screen route in MoreScreen');

  assert(tabBarSrc.includes('InteractionManager.runAfterInteractions'), 'sheet waits for interactions before navigate');
  assert(tabBarSrc.includes('managementNavLockRef'), 'double tap is locked during navigation');
  assert(tabBarSrc.includes('setQuickAccessOpen(false)'), 'management sheet closes on selection');
  assert(menuSrc.includes('onRequestClose={onClose}'), 'modal still closes on request close');
  assert(!menuSrc.includes('onClose();\n    onQuickAccess'), 'menu does not navigate before parent closes sheet');

  assert(!navSrc.includes('react-navigation'), 'no new navigation library');
  assert(!navSrc.includes('@react-navigation'), 'no React Navigation dependency');
  assert(navSrc.includes("tab: 'more'") && navSrc.includes("moreSubRoute: CANONICAL_ACCOUNT_MORE_ROUTE"), 'Account mapping is centralized');

  const origins = ['dashboard', 'finance', 'warehouse', 'fleet', 'contracts', 'market'] as const;
  for (const origin of origins) {
    const target = getManagementNavigationTarget('Account');
    assert(
      target.tab === 'more' && target.moreSubRoute === 'account',
      `${origin} → Hesap uses the same canonical Account route`,
    );
  }

  assert(
    getManagementNavigationTarget('Account').tab === getManagementNavigationTarget('Finance').tab,
    'Account and Finance share the Şirket/more parent tab',
  );
  assert(
    getManagementNavigationTarget('Account').moreSubRoute !==
      getManagementNavigationTarget('Finance').moreSubRoute,
    'Account does not stay on the Finance nested route',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
