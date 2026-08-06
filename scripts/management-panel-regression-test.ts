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
import {
  estimateManagementPanelContentHeight,
} from '../src/components/management/managementLayout';
import {
  MANAGEMENT_GRID_GAP,
  MANAGEMENT_PANEL_MAX_HEIGHT_RATIO,
  MANAGEMENT_TILE_MIN_HEIGHT,
} from '../src/components/management/managementTheme';

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
    QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO >= 0.72 &&
      QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO <= 0.78,
    'panel max height ratio in 72–78% range',
  );
  assert(
    MANAGEMENT_PANEL_MAX_HEIGHT_RATIO >= 0.72 &&
      MANAGEMENT_PANEL_MAX_HEIGHT_RATIO <= 0.78,
    'management panel max height ratio in 72–78% range',
  );
  assert(
    QUICK_ACCESS_TILE_GAP >= 12 && QUICK_ACCESS_TILE_GAP <= 16,
    'tile gap in 12–16px range',
  );
  assert(MANAGEMENT_GRID_GAP === 12, 'management grid gap is 12px');
  assert(QUICK_ACCESS_TILE_HEIGHT >= 122, 'tile min height in 122–136px range');
  assert(MANAGEMENT_TILE_MIN_HEIGHT >= 122, 'management tile min height in range');
  const eightCardHeight = estimateManagementPanelContentHeight(8);
  assert(eightCardHeight > 500 && eightCardHeight < 900, '8-card natural height is reasonable');
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
  const managementPanel = readFileSync('src/components/management/ManagementPanel.tsx', 'utf8');
  const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');

  assert(app.includes("pendingMoreSubRoute: 'leaderboard'"), 'leaderboard route via more tab');
  assert(app.includes("pendingMoreSubRoute: 'account'"), 'account route via more tab');
  assert(moreScreen.includes("pendingMoreSubRoute === 'account'"), 'account deep-link handled in MoreScreen');
  assert(moreScreen.includes("setRoute('account')"), 'account opens AccountCenterScreen route');
  assert(moreScreen.includes('AccountCenterScreen'), 'AccountCenterScreen wired in MoreScreen');
  assert(moreScreen.includes("route === 'leaderboard'"), 'leaderboard sub-route always reachable');
  assert(gameStore.includes("'account'"), 'pendingMoreSubRoute includes account');
  assert(managementPanel.includes('onQuickAccess'), 'management panel forwards navigation actions');
}

console.log('\nPanel interaction');
{
  const managementPanel = readFileSync('src/components/management/ManagementPanel.tsx', 'utf8');
  const managementCard = readFileSync('src/components/management/ManagementCard.tsx', 'utf8');
  const managementGrid = readFileSync('src/components/management/ManagementGrid.tsx', 'utf8');
  const dataHook = readFileSync('src/components/management/useManagementPanelData.ts', 'utf8');

  assert(managementPanel.includes('tapLockRef'), 'double-tap lock present');
  assert(managementPanel.includes('onClose();'), 'panel closes before navigation callback');
  assert(managementPanel.includes('onRequestClose={onClose}'), 'Android back closes panel');
  assert(managementPanel.includes('accessibilityViewIsModal'), 'modal accessibility set');
  assert(
    managementPanel.includes('scrollToOffset') || managementPanel.includes('scrollTo'),
    'panel opens at top scroll',
  );
  assert(managementCard.includes('accessibilityRole="button"'), 'cards expose button role');
  assert(managementCard.includes('adjustsFontSizeToFit'), 'font scale support on card labels');
  assert(managementCard.includes('minWidth: 24'), 'badge min 24px');
  assert(managementGrid.includes('numColumns={2}'), '2-column grid uses FlatList numColumns');
  assert(managementGrid.includes('columnWrapperStyle'), 'FlatList column wrapper present');
  assert(managementPanel.includes("width: '100%'"), 'panel stretches to full anchor width');
  assert(managementPanel.includes('panelContentWidth'), 'grid width from window dimensions');
  assert(!managementPanel.includes('panelWidth'), 'no shrink-wrap onLayout width loop');
  assert(managementPanel.includes('managementLayout'), 'panel height fits content when possible');
  assert(managementPanel.includes('<ManagementGrid'), 'panel content scrollable via grid FlatList');
  assert(managementPanel.includes('Şirketini, filonu ve operasyonlarını yönet'), 'new subtitle copy');
  assert(dataHook.includes('useFleetSubtitle'), 'fleet subtitle from store');
  assert(dataHook.includes('useWarehouseSubtitle'), 'warehouse subtitle from store');
  assert(dataHook.includes('useMissionsReadyBadge'), 'missions badge from canonical selector');
}

console.log('\nExisting cards preserved');
{
  const labels = buildQuickAccessItems(true).map((item) => item.label);
  for (const label of ['Filo', 'Mağaza', 'Depolar', 'Finans', 'Araç Pazarı', 'Görevler', 'Liderlik', 'Hesap']) {
    assert(labels.includes(label), `${label} card still present`);
  }
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
console.log('management-panel-regression-test: PASSED\n');
