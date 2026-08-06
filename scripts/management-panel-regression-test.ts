/**
 * Management panel regression tests.
 * Run: npx tsx scripts/management-panel-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  buildQuickAccessItems,
  QUICK_ACCESS_CARD_ORDER,
  QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO,
  QUICK_ACCESS_TILE_GAP,
  QUICK_ACCESS_TILE_HEIGHT,
} from '../src/navigation/quickAccessConfig';

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

console.log('\n=== Management Panel Regression ===\n');

console.log('Card config');
{
  const items = buildQuickAccessItems(true);
  assert(items.length === 8, 'marketplace enabled → 8 cards');
  assert(
    items.map((item) => item.key).join(',') === QUICK_ACCESS_CARD_ORDER.join(','),
    'card order matches 2×4 grid layout',
  );
  assert(items[6].key === 'leaderboard' && items[6].label === 'Liderlik', '7th card is Liderlik');
  assert(items[7].key === 'account' && items[7].label === 'Hesap', '8th card is Hesap');
  assert(
    buildQuickAccessItems(false).length === 7,
    'marketplace disabled → 7 cards without removing Liderlik/Hesap',
  );
}

console.log('\nLayout constants');
{
  assert(
    QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO >= 0.82 && QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO <= 0.88,
    'panel max height ratio in 82–88% range',
  );
  assert(
    QUICK_ACCESS_TILE_GAP >= 12 && QUICK_ACCESS_TILE_GAP <= 16,
    'tile gap in 12–16px range',
  );
  assert(QUICK_ACCESS_TILE_HEIGHT >= 44, 'tile height exceeds 44px touch target');
}

console.log('\nAccessibility copy');
{
  const leaderboard = buildQuickAccessItems(true).find((item) => item.key === 'leaderboard');
  const account = buildQuickAccessItems(true).find((item) => item.key === 'account');
  assert(
    leaderboard?.accessibilityLabel === 'Liderlik tablosunu aç',
    'leaderboard accessibilityLabel',
  );
  assert(
    leaderboard?.accessibilityHint === 'Haftalık sıralamayı ve kendi dereceni görüntüler',
    'leaderboard accessibilityHint',
  );
  assert(account?.accessibilityLabel === 'Hesap ayarlarını aç', 'account accessibilityLabel');
  assert(
    account?.accessibilityHint === 'Profil, giriş ve hesap seçeneklerini görüntüler',
    'account accessibilityHint',
  );
}

console.log('\nNavigation wiring');
{
  const app = readFileSync('App.tsx', 'utf8');
  const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
  const quickAccessMenu = readFileSync('src/components/navigation/QuickAccessMenu.tsx', 'utf8');
  const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');

  assert(app.includes("pendingMoreSubRoute: 'leaderboard'"), 'leaderboard route via more tab');
  assert(app.includes("pendingMoreSubRoute: 'account'"), 'account route via more tab');
  assert(moreScreen.includes("pendingMoreSubRoute === 'account'"), 'account deep-link handled in MoreScreen');
  assert(moreScreen.includes("setRoute('account')"), 'account opens AccountCenterScreen route');
  assert(moreScreen.includes('AccountCenterScreen'), 'AccountCenterScreen wired in MoreScreen');
  assert(moreScreen.includes("route === 'leaderboard'"), 'leaderboard sub-route always reachable');
  assert(gameStore.includes("'account'"), 'pendingMoreSubRoute includes account');
}

console.log('\nPanel interaction');
{
  const quickAccessMenu = readFileSync('src/components/navigation/QuickAccessMenu.tsx', 'utf8');
  assert(quickAccessMenu.includes('tapLockRef'), 'double-tap lock present');
  assert(quickAccessMenu.includes('onClose();'), 'panel closes before navigation callback');
  assert(quickAccessMenu.includes('onRequestClose={onClose}'), 'Android back closes panel');
  assert(quickAccessMenu.includes('accessibilityRole="button"'), 'tiles expose button role');
  assert(quickAccessMenu.includes('adjustsFontSizeToFit'), 'font scale support on tile labels');
  assert(quickAccessMenu.includes('width: \'48.4%\''), '2-column grid tile width');
  assert(quickAccessMenu.includes('<ScrollView'), 'panel content scrollable');
}

console.log('\nExisting cards preserved');
{
  const labels = buildQuickAccessItems(true).map((item) => item.label);
  for (const label of ['Filo', 'Mağaza', 'Depolar', 'Finans', 'Araç Pazarı', 'Görevler']) {
    assert(labels.includes(label), `${label} card still present`);
  }
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
console.log('management-panel-regression-test: PASSED\n');
