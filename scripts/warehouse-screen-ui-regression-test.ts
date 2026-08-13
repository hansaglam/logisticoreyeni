/**
 * Warehouse screen compact UI regression.
 * Run: npx tsx scripts/warehouse-screen-ui-regression-test.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.log(`  ✗ ${label}`);
}

const screen = read('src/screens/WarehouseScreen.tsx');
const overview = read('src/components/warehouse/WarehouseOverviewGrid.tsx');
const infoBanner = read('src/components/warehouse/WarehouseInfoBanner.tsx');
const ownedCard = read('src/components/warehouse/OwnedWarehouseCard.tsx');
const ownedSection = read('src/components/warehouse/OwnedWarehousesSection.tsx');
const transfers = read('src/components/warehouse/WarehouseTransfersSection.tsx');
const opportunities = read('src/components/warehouse/WarehouseOpportunitiesSection.tsx');
const opportunityCard = read('src/components/warehouse/WarehouseOpportunityCard.tsx');
const strategy = read('src/components/warehouse/WarehouseStrategyTips.tsx');
const theme = read('src/components/warehouse/warehouseTheme.ts');

console.log('\n=== Warehouse Screen UI Regression ===\n');

console.log('Section hierarchy');
{
  const overviewIdx = screen.indexOf('<WarehouseOverviewGrid');
  const ownedIdx = screen.indexOf('<OwnedWarehousesSection');
  const transfersIdx = screen.indexOf('<WarehouseTransfersSection');
  const oppsIdx = screen.indexOf('<WarehouseOpportunitiesSection');
  const strategyIdx = screen.indexOf('<WarehouseStrategyTips');
  assert(overviewIdx < ownedIdx, 'overview before owned warehouses');
  assert(ownedIdx < transfersIdx, 'owned warehouses before transfers');
  assert(transfersIdx < oppsIdx, 'transfers before opportunities');
  assert(oppsIdx < strategyIdx, 'opportunities before strategy');
}

console.log('\nSummary card');
assert(overview.includes('Depo Özeti'), 'single summary title');
assert(overview.includes('summaryCard'), 'single parent summary container');
assert(overview.includes('statCell'), 'compact stat cells');
assert(!overview.includes('borderLeftWidth'), 'no per-stat heavy left borders');

console.log('\nInsight banner');
assert(infoBanner.includes('Depo İpucu'), 'compact insight kicker');
assert(infoBanner.includes('minHeight: 52'), 'compact banner height');

console.log('\nOwned warehouse card');
assert(ownedCard.includes('Stokları Gör'), 'primary stock CTA');
assert(ownedCard.includes('Transfer'), 'secondary transfer CTA');
assert(ownedCard.includes('onUpgrade'), 'upgrade wired');
assert(ownedCard.includes('Maksimum Seviye'), 'max level label');
assert(ownedCard.includes('Kapasite'), 'capacity metric');
assert(ownedCard.includes('Doluluk'), 'occupancy metric');
assert(ownedCard.includes('Stok değeri'), 'stock value row');
assert(!ownedCard.includes('Taşı'), 'old Taşı label removed');

console.log('\nTransfers compact');
assert(transfers.includes('Yoldaki Transferler'), 'transfer section title');
assert(transfers.includes('Henüz transfer yok'), 'empty state copy');
assert(transfers.includes('Yeni Transfer'), 'compact start CTA');
assert(transfers.includes('compactCard'), 'single compact card wrapper');

console.log('\nOpportunities');
assert(opportunities.includes('PREVIEW_LIMIT = 3'), 'preview first 3');
assert(opportunities.includes('Tüm Fırsatları Gör'), 'view all CTA');
assert(opportunityCard.includes('Depoyu İncele'), 'compact opportunity CTA');
assert(opportunityCard.includes('sinyal'), 'compact signal badge');

console.log('\nStrategy accordion');
assert(strategy.includes('Depo Stratejisi'), 'strategy section');
assert(strategy.includes('minHeight: 56'), 'collapsed accordion height');

console.log('\nSpacing tokens');
assert(theme.includes('warehouseLayout'), 'canonical layout tokens');
assert(theme.includes('pagePadding: 16'), 'page padding 16');

console.log('\nTutorial targets preserved');
assert(screen.includes('targetId="warehouse-header"'), 'warehouse-header target');
assert(screen.includes('targetId="special-products"'), 'special-products target');
assert(screen.includes('targetId="stock-management"'), 'stock-management target');
assert(
  ownedSection.includes('targetId="city-warehouse-link"') &&
    ownedSection.includes('layoutMode="stretch"'),
  'city-warehouse-link stretch',
);
assert(
  ownedSection.includes('targetId="capacity"') && ownedSection.includes('layoutMode="stretch"'),
  'capacity stretch',
);

console.log('\nAction handlers preserved');
assert(screen.includes('handleUpgrade'), 'upgrade handler');
assert(screen.includes('handleOpenWarehouse'), 'open warehouse handler');
assert(screen.includes('handleManageStock'), 'manage stock handler');
assert(screen.includes('handleTransferFromWarehouse'), 'transfer handler');
assert(screen.includes('upgradeWarehouse'), 'store upgrade');
assert(screen.includes('openWarehouse'), 'store open warehouse');
assert(screen.includes('WarehouseStockTransferModal'), 'transfer modal');

console.log('\nLimit label');
assert(screen.includes('aktif depo'), 'clear limit label');

console.log(`\nPASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
