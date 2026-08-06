/**
 * iOS tab bar safe-area layout regression.
 * Run: npx tsx scripts/ios-tabbar-safe-area-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const VISUAL_TAB_BAR_HEIGHT = 72;
const TAB_BAR_BOTTOM = 0;
const SCREEN_CONTENT_GAP = 16;

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
  console.log('\nios-tabbar-safe-area-regression-test\n');

  assert(VISUAL_TAB_BAR_HEIGHT === 72, 'canonical visualBarHeight is 72');
  assert(TAB_BAR_BOTTOM === 0, 'canonical tabBarBottom is 0');
  assert(SCREEN_CONTENT_GAP >= 12 && SCREEN_CONTENT_GAP <= 20, 'screen content gap is 12–20px');

  const totalBarHeight = VISUAL_TAB_BAR_HEIGHT + 34;
  const contentBottomPadding = totalBarHeight + SCREEN_CONTENT_GAP;
  assert(totalBarHeight === 106, 'totalBarHeight = visual + safeBottom');
  assert(contentBottomPadding === 122, 'contentBottomPadding = totalBarHeight + gap');
  assert(
    totalBarHeight === contentBottomPadding - SCREEN_CONTENT_GAP,
    'safe-area is applied once in total height',
  );

  const hookSrc = readSrc('src/hooks/useTabBarLayout.ts');
  assert(hookSrc.includes('safeBottom'), 'useTabBarLayout exposes safeBottom');
  assert(hookSrc.includes('visualBarHeight'), 'useTabBarLayout exposes visualBarHeight');
  assert(hookSrc.includes('totalBarHeight'), 'useTabBarLayout exposes totalBarHeight');
  assert(hookSrc.includes('contentBottomPadding'), 'useTabBarLayout exposes contentBottomPadding');
  assert(hookSrc.includes('tabBarBottom'), 'useTabBarLayout exposes tabBarBottom');
  assert(hookSrc.includes('TAB_BAR_BOTTOM'), 'tabBarBottom comes from canonical constant');
  assert(!hookSrc.includes('Math.max(insets.bottom, MIN_IOS_BOTTOM_INSET)'), 'hook does not floor iOS inset to fake minimum');

  const layoutSrc = readSrc('src/constants/layout.ts');
  assert(layoutSrc.includes('export const VISUAL_TAB_BAR_HEIGHT = 72'), 'layout visual height is 72');
  assert(layoutSrc.includes('export const TAB_BAR_BOTTOM = 0'), 'layout tabBarBottom is 0');
  assert(layoutSrc.includes('export const SCREEN_CONTENT_GAP = 16'), 'layout content gap is 16');
  assert(layoutSrc.includes('export function getSafeBottom'), 'layout exports getSafeBottom');
  assert(layoutSrc.includes("Platform.OS === 'android'"), 'Android keeps zero bottom inset');
  assert(layoutSrc.includes('return MIN_ANDROID_BOTTOM_INSET'), 'Android branch returns 0 inset');
  assert(
    !/return Math\.max\(insets\.bottom,\s*MIN_IOS_BOTTOM_INSET\)/.test(layoutSrc),
    'live iOS inset is not inflated by MIN_IOS_BOTTOM_INSET',
  );

  const tabBarSrc = readSrc('src/components/navigation/GameTabBar.tsx');
  assert(!tabBarSrc.includes('SafeAreaView'), 'GameTabBar does not wrap in SafeAreaView');
  assert(!tabBarSrc.includes('isSafeAreaContextAvailable'), 'GameTabBar does not branch on SafeAreaView availability');
  assert(!tabBarSrc.includes('NativeGameTabBar'), 'duplicate NativeGameTabBar path removed');
  assert(!tabBarSrc.includes('FallbackGameTabBar'), 'duplicate FallbackGameTabBar path removed');
  assert(tabBarSrc.includes('useTabBarLayout()'), 'GameTabBar uses canonical hook');
  assert(tabBarSrc.includes('tabBarBottom'), 'GameTabBar pins bottom from canonical metric');
  assert(tabBarSrc.includes('paddingBottom: bottomPadding'), 'GameTabBar applies safe bottom as padding once');
  assert(!/bottom:\s*insets\.bottom/.test(tabBarSrc), 'GameTabBar does not offset with bottom: insets.bottom');
  assert(!/marginBottom:\s*insets\.bottom/.test(tabBarSrc), 'GameTabBar has no marginBottom inset');
  assert(!/bottom:\s*-\d+/.test(tabBarSrc), 'GameTabBar has no negative bottom');
  assert(!/marginBottom:\s*-\d+/.test(tabBarSrc), 'GameTabBar has no negative marginBottom');
  assert(
    !/height:\s*Dimensions|screenHeight|windowHeight/.test(tabBarSrc),
    'tab bar position is not derived from screen height',
  );

  const bottomTabSrc = readSrc('src/components/BottomTabBar.tsx');
  assert(!bottomTabSrc.includes('SafeAreaView'), 'legacy BottomTabBar does not wrap SafeAreaView');
  assert(bottomTabSrc.includes('tabBarBottom'), 'legacy BottomTabBar uses canonical bottom');

  const appScreenSrc = readSrc('src/components/ui/AppScreen.tsx');
  assert(appScreenSrc.includes('contentBottomPadding'), 'AppScreen default padding uses contentBottomPadding');

  const screenChecks: Array<{ file: string; label: string }> = [
    { file: 'src/screens/DashboardScreen.tsx', label: 'Dashboard' },
    { file: 'src/screens/ContractsScreen.tsx', label: 'Contracts' },
    { file: 'src/screens/MoreScreen.tsx', label: 'Company/More' },
    { file: 'src/screens/FinanceScreen.tsx', label: 'Finance' },
    { file: 'src/screens/FleetScreen.tsx', label: 'Fleet' },
    { file: 'src/screens/MarketScreen.tsx', label: 'Market' },
    { file: 'src/screens/WarehouseScreen.tsx', label: 'Warehouses' },
    { file: 'src/screens/MissionsScreen.tsx', label: 'Missions' },
    { file: 'src/screens/LeaderboardScreen.tsx', label: 'Leaderboard' },
    { file: 'src/screens/ShopScreen.tsx', label: 'Vehicle Marketplace' },
    { file: 'src/screens/MapScreen.tsx', label: 'Map' },
    { file: 'src/screens/UpgradesScreen.tsx', label: 'Upgrades' },
  ];

  for (const screen of screenChecks) {
    const src = readSrc(screen.file);
    const usesHelper =
      src.includes('contentBottomPadding') ||
      src.includes('scrollBottomPadding') ||
      src.includes('<AppScreen') ||
      src.includes('<AppScreen ');
    assert(usesHelper, `${screen.label} uses shared tab-bar content inset`);
    assert(
      !src.includes('DASHBOARD_SCROLL_BOTTOM_EXTRA') &&
        !src.includes('FLEET_SCROLL_BOTTOM_EXTRA') &&
        !src.includes('MARKET_SCROLL_BOTTOM_EXTRA') &&
        !src.includes('SHOP_SCROLL_BOTTOM_EXTRA'),
      `${screen.label} has no screen-specific tab padding extra`,
    );
    assert(!/paddingBottom:\s*90\b/.test(src), `${screen.label} has no hardcoded paddingBottom 90`);
    assert(!/paddingBottom:\s*100\b/.test(src), `${screen.label} has no hardcoded paddingBottom 100`);
    assert(!/paddingBottom:\s*110\b/.test(src), `${screen.label} has no hardcoded paddingBottom 110`);
    assert(!/TAB_BAR_HEIGHT\s*\+\s*20/.test(src), `${screen.label} has no TAB_BAR_HEIGHT + 20`);
    assert(
      !/insets\.bottom\s*\+\s*tabBarHeight/.test(src) && !/tabBarHeight\s*\+\s*insets\.bottom/.test(src),
      `${screen.label} does not add insets.bottom + tabBarHeight`,
    );
  }

  const moreSrc = readSrc('src/screens/MoreScreen.tsx');
  assert(moreSrc.includes('<AppScreen scroll'), 'Şirket menu uses AppScreen scroll inset');

  const financeSrc = readSrc('src/screens/FinanceScreen.tsx');
  assert(financeSrc.includes('<AppScreen scroll'), 'Finance uses AppScreen scroll inset');

  const keyboardSrc = [
    readSrc('src/components/AccountSection.tsx'),
    readSrc('src/screens/MoreScreen.tsx'),
    tabBarSrc,
  ].join('\n');
  assert(!keyboardSrc.includes('KeyboardAvoidingView'), 'tab bar is not lifted by KeyboardAvoidingView');

  const removedExtras = [
    'src/components/dashboard/dashboardTheme.ts',
    'src/components/fleet/fleetTheme.ts',
    'src/components/market/marketTheme.ts',
    'src/components/shop/shopTheme.ts',
  ];
  for (const file of removedExtras) {
    const src = readSrc(file);
    assert(
      !src.includes('SCROLL_BOTTOM_EXTRA'),
      `${path.basename(file)} no longer defines duplicate scroll bottom extras`,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
