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
  resolveManagementPanelHeight,
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
    QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO >= 0.68 &&
      QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO <= 0.76,
    'panel max height ratio in 68–76% range',
  );
  assert(
    MANAGEMENT_PANEL_MAX_HEIGHT_RATIO >= 0.68 &&
      MANAGEMENT_PANEL_MAX_HEIGHT_RATIO <= 0.76,
    'management panel max height ratio in 68–76% range',
  );
  assert(
    QUICK_ACCESS_TILE_GAP >= 8 && QUICK_ACCESS_TILE_GAP <= 12,
    'tile gap in 8–12px range',
  );
  assert(MANAGEMENT_GRID_GAP === 8, 'management grid gap is 8px');
  assert(QUICK_ACCESS_TILE_HEIGHT >= 90, 'tile min height in compact range');
  assert(MANAGEMENT_TILE_MIN_HEIGHT >= 90, 'management tile min height in compact range');
  const eightCardHeight = estimateManagementPanelContentHeight(8);
  assert(eightCardHeight > 380 && eightCardHeight < 620, '8-card natural height is compact');
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

console.log('\nPanel height strategy');
{
  const eightItems = resolveManagementPanelHeight({ itemCount: 8, availableHeight: 700 });
  const cramped = resolveManagementPanelHeight({ itemCount: 8, availableHeight: 300 });
  assert(eightItems.panelHeight > 0, 'visible panel height is always > 0');
  assert(eightItems.rowCount === 4, '8 items → 4 rows');
  assert(eightItems.panelHeight === eightItems.naturalHeight, 'tall screen uses natural height');
  assert(cramped.needsScroll, 'short available height enables scroll');
  assert(cramped.panelHeight === 300, 'cramped screen caps at available height');
  assert(eightItems.naturalHeight > 380 && eightItems.naturalHeight < 620, 'natural height compact');
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
    managementPanel.includes('scrollTo({ y: 0') || managementPanel.includes('scrollToOffset'),
    'panel opens at top scroll',
  );
  assert(managementCard.includes('accessibilityRole="button"'), 'cards expose button role');
  assert(managementCard.includes('adjustsFontSizeToFit'), 'font scale support on card labels');
  assert(managementCard.includes('minWidth: 24'), 'badge min 24px');
  assert(managementGrid.includes('ScrollView'), 'grid uses ScrollView for bounded height');
  assert(managementGrid.includes('columnRow'), '2-column row layout preserved');
  assert(managementGrid.includes('flexGrow: 0'), 'grid content does not stretch with dead space');
  assert(managementPanel.includes("width: '100%'"), 'panel stretches to full anchor width');
  assert(managementPanel.includes('panelContentWidth'), 'grid width from window dimensions');
  assert(!managementPanel.includes('panelWidth'), 'no shrink-wrap onLayout width loop');
  assert(managementPanel.includes('resolveManagementPanelHeight'), 'panel uses bounded height resolver');
  assert(managementPanel.includes('height: panelHeight'), 'panel always gets explicit height');
  assert(!managementPanel.includes('scrollBottomPadding'), 'panel does not double-count tab bar inset');
  assert(managementPanel.includes('listBottomInset'), 'panel uses compact internal bottom inset');
  assert(managementPanel.includes('<ManagementGrid'), 'panel content scrollable via grid');
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
