/**
 * iOS layout / safe-area / overflow regression.
 * Run: npx tsx scripts/ios-layout-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

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
  console.log('\nios-layout-regression-test\n');

  const layoutSrc = readSrc('src/constants/layout.ts');
  assert(layoutSrc.includes('export const MIN_TOUCH_TARGET = 44'), 'MIN_TOUCH_TARGET is 44');
  assert(layoutSrc.includes('export function getModalSheetPaddingBottom'), 'modal sheet bottom helper exists');
  assert(layoutSrc.includes('export function getSafeModalMaxHeight'), 'modal maxHeight helper exists');
  assert(layoutSrc.includes('export function getSafeBottom'), 'safe bottom helper exists');

  const headerSrc = readSrc('src/components/ui/ScreenHeader.tsx');
  assert(headerSrc.includes('MIN_TOUCH_TARGET'), 'ScreenHeader uses min touch target');
  assert(headerSrc.includes('numberOfLines={2}'), 'ScreenHeader title can wrap to 2 lines');
  assert(!headerSrc.includes('SafeAreaView'), 'ScreenHeader does not wrap SafeAreaView');

  const iconSrc = readSrc('src/components/ui/IconButton.tsx');
  assert(iconSrc.includes('MIN_TOUCH_TARGET'), 'IconButton is at least 44px');

  const actionSrc = readSrc('src/components/ui/ActionButton.tsx');
  assert(actionSrc.includes('minHeight: MIN_TOUCH_TARGET'), 'ActionButton minHeight is 44');

  const appScreenSrc = readSrc('src/components/ui/AppScreen.tsx');
  assert(appScreenSrc.includes('screenTopPadding'), 'AppScreen applies top inset once');
  assert(appScreenSrc.includes('contentBottomPadding'), 'AppScreen applies tab-bar content padding');
  assert(!appScreenSrc.includes('SafeAreaView'), 'AppScreen does not double SafeAreaView');

  const dialogSrc = readSrc('src/components/ui/AppDialog.tsx');
  assert(dialogSrc.includes('getSafeModalMaxHeight'), 'auth/error dialog has maxHeight');
  assert(dialogSrc.includes('ScrollView'), 'dialog content scrolls when long');
  assert(dialogSrc.includes('getSafeBottom'), 'dialog overlay uses safe bottom');
  assert(dialogSrc.includes('statusBarTranslucent'), 'dialog covers status bar backdrop');

  const offlineSrc = readSrc('src/components/offline/OfflineProgressSummaryModal.tsx');
  assert(offlineSrc.includes('getModalSheetPaddingBottom'), 'offline summary uses sheet bottom helper');
  assert(offlineSrc.includes('getSafeModalMaxHeight'), 'offline summary has maxHeight');
  assert(offlineSrc.includes('ScrollView'), 'offline summary scrolls');
  assert(offlineSrc.includes('statusBarTranslucent'), 'offline summary is status-bar translucent');

  const toastSrc = readSrc('src/components/GameToast.tsx');
  assert(toastSrc.includes('getScreenTopPadding'), 'toast uses shared top inset helper');
  assert(!toastSrc.includes('STATUS_BAR_HEIGHT'), 'toast does not use Android statusBarHeight on iOS path');
  assert(toastSrc.includes('MIN_TOUCH_TARGET'), 'toast close target is 44px');

  const moreSrc = readSrc('src/screens/MoreScreen.tsx');
  assert(moreSrc.includes('function EmbeddedModule'), 'Şirket subroutes use embedded top inset wrapper');
  assert(moreSrc.includes('screenTopPadding'), 'embedded modules get top safe-area once');
  assert(moreSrc.includes('minHeight: MIN_TOUCH_TARGET'), 'Şirket back control is 44px');
  assert(moreSrc.includes('minWidth: 0'), 'growth stat boxes shrink instead of overflowing');

  const financeSrc = readSrc('src/screens/FinanceScreen.tsx');
  assert(!/horizontal\s*\n\s*showsHorizontalScrollIndicator/.test(financeSrc), 'Finance metrics are not a horizontal carousel');
  assert(financeSrc.includes('flexWrap'), 'Finance metrics wrap instead of half-card scroll');
  assert(!financeSrc.includes('paddingBottom: 90'), 'Finance has no hardcoded unsafe bottom 90');

  const missionsSrc = readSrc('src/screens/MissionsScreen.tsx');
  assert(missionsSrc.includes('paddingTop: screenTopPadding'), 'Missions applies top safe-area');
  assert(missionsSrc.includes('contentBottomPadding'), 'Missions applies tab-bar content padding');

  const debugSrc = readSrc('src/screens/DebugSimulationScreen.tsx');
  assert(!debugSrc.includes('SafeAreaView'), 'debug screen no longer double-applies SafeAreaView');
  assert(!debugSrc.includes('STATUS_BAR_HEIGHT'), 'debug screen does not add statusBarHeight on top of parent inset');

  const incidentSrc = readSrc('src/components/delivery/DeliveryIncidentCard.tsx');
  assert(incidentSrc.includes('numberOfLines={2}'), 'incident titles/choices can wrap');
  assert(incidentSrc.includes('minWidth: 0'), 'incident choice text can shrink');

  const warehouseSheets = [
    'src/components/WarehouseStockTransferModal.tsx',
    'src/components/warehouse/WarehouseOpportunityCard.tsx',
    'src/components/warehouse/WarehouseTransfersSection.tsx',
    'src/components/warehouse/WarehouseOpportunitiesSection.tsx',
  ];
  for (const file of warehouseSheets) {
    const src = readSrc(file);
    assert(
      src.includes('getModalSheetPaddingBottom'),
      `${path.basename(file)} uses canonical sheet bottom inset`,
    );
    assert(
      !/Math\.max\(insets\.bottom/.test(src),
      `${path.basename(file)} does not use raw insets.bottom floor`,
    );
  }

  const modalFiles = [
    'src/components/market/MarketAlertModal.tsx',
    'src/components/market/ProductMarketDetailModal.tsx',
    'src/components/contracts/ContractQuickActionSheet.tsx',
    'src/components/contracts/AssignmentPickerSheet.tsx',
  ];
  for (const file of modalFiles) {
    const src = readSrc(file);
    assert(src.includes('maxHeight'), `${path.basename(file)} has maxHeight`);
    assert(
      src.includes('getSafeModalMaxHeight') || src.includes('getBottomInset') || src.includes('getModalSheetPaddingBottom'),
      `${path.basename(file)} uses shared safe-area helper`,
    );
  }

  const screenFiles = [
    'src/screens/DashboardScreen.tsx',
    'src/screens/MapScreen.tsx',
    'src/screens/ContractsScreen.tsx',
    'src/screens/MarketScreen.tsx',
    'src/screens/MoreScreen.tsx',
    'src/screens/FinanceScreen.tsx',
    'src/screens/FleetScreen.tsx',
    'src/screens/WarehouseScreen.tsx',
    'src/screens/MissionsScreen.tsx',
    'src/screens/LeaderboardScreen.tsx',
    'src/screens/ShopScreen.tsx',
  ];
  for (const file of screenFiles) {
    const src = readSrc(file);
    assert(
      !/marginBottom:\s*-\d+/.test(src) && !/marginTop:\s*-\d+/.test(src),
      `${path.basename(file)} has no negative vertical margin`,
    );
    assert(!/width:\s*4[4-9]\d\b/.test(src) && !/width:\s*[5-9]\d{2}\b/.test(src), `${path.basename(file)} has no fixed width over 430`);
    assert(
      src.includes('contentBottomPadding') ||
        src.includes('scrollBottomPadding') ||
        src.includes('<AppScreen') ||
        src.includes('AppScreen'),
      `${path.basename(file)} keeps tab-bar content inset`,
    );
  }

  const assignmentSrc = readSrc('src/components/ContractAssignmentModal.tsx');
  assert(assignmentSrc.includes('getScreenTopPadding'), 'assignment modal uses shared top inset');

  const truckTransferSrc = readSrc('src/components/TruckTransferModal.tsx');
  assert(truckTransferSrc.includes('getModalSheetPaddingBottom'), 'truck transfer uses sheet bottom helper');
  assert(!/insets\.bottom\s*\?\?/.test(truckTransferSrc), 'truck transfer does not use raw insets.bottom');

  const alertSrc = readSrc('src/components/market/MarketAlertModal.tsx');
  assert(alertSrc.includes('KeyboardAvoidingView'), 'price alert sheet avoids keyboard on iOS');

  assert(
    !fs.existsSync(path.join(ROOT, 'src/components/ScreenHeader.tsx')),
    'legacy unused ScreenHeader is removed',
  );

  const tabBarSrc = readSrc('src/components/navigation/GameTabBar.tsx');
  assert(!tabBarSrc.includes('SafeAreaView'), 'tab bar still has no wrapping SafeAreaView');
  assert(tabBarSrc.includes('tabBarBottom'), 'tab bar stays pinned to bottom 0');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
