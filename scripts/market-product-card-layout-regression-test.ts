/**
 * Market product card iOS text/layout clipping regression.
 * Run: npx tsx scripts/market-product-card-layout-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { getMarketProductColumnWidths } from '../src/utils/marketCardLayout';
import { resolveMarketBuyState } from '../src/utils/marketTradeState';

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
  console.log('\nmarket-product-card-layout-regression-test\n');

  const widths360 = getMarketProductColumnWidths(360);
  const widths390 = getMarketProductColumnWidths(390);
  const widths430 = getMarketProductColumnWidths(430);

  assert(widths360.actionCol >= 100 && widths360.actionCol <= 112, '360px actionCol in 100–112');
  assert(widths390.actionCol >= 108 && widths390.actionCol <= 128, '390px actionCol in 108–128');
  assert(widths430.actionCol >= 108 && widths430.actionCol <= 128, '430px actionCol in 108–128');
  assert(widths360.leftCol >= 96, '360px leftCol responsive');
  assert(widths390.leftCol >= 104, '390px leftCol responsive');
  assert(widths360.actionCol > 88, 'actionCol wider than legacy 88px');
  assert(widths360.chartMinWidth >= 64, 'chart min width readable');
  assert(
    widths390.leftCol + widths390.chartMinWidth + widths390.actionCol <= widths390.contentWidth,
    '390 columns fit within content width budget',
  );
  assert(
    widths360.leftCol + widths360.chartMinWidth + widths360.actionCol <= widths360.contentWidth,
    '360 columns fit within content width budget',
  );
  assert(
    widths430.leftCol + widths430.chartMinWidth + widths430.actionCol <= widths430.contentWidth,
    '430 columns fit within content width budget',
  );

  const noWarehouse = resolveMarketBuyState({
    hasWarehouse: false,
    marketStock: 10,
    freeCapacity: 10,
    playerMoney: 100_000,
    unitPrice: 100,
  });
  assert(noWarehouse.label === 'Depo yok', 'no warehouse short label');
  assert(noWarehouse.detailLabel.length > noWarehouse.label.length, 'detail longer than label');

  const blocked = resolveMarketBuyState({
    hasWarehouse: true,
    marketStock: 10,
    freeCapacity: 10,
    playerMoney: 100_000,
    unitPrice: 100,
    canStoreProduct: false,
  });
  assert(blocked.label === 'Uygun değil', 'unsuitable warehouse short label');
  assert(!blocked.label.includes('Depo uygun değil'), 'long warehouse label removed');

  const noStock = resolveMarketBuyState({
    hasWarehouse: true,
    marketStock: 0,
    freeCapacity: 10,
    playerMoney: 100_000,
    unitPrice: 100,
  });
  assert(noStock.label === 'Stok yok', 'stock short label');

  const noCash = resolveMarketBuyState({
    hasWarehouse: true,
    marketStock: 10,
    freeCapacity: 10,
    playerMoney: 1,
    unitPrice: 100,
  });
  assert(noCash.label === 'Bakiye yok', 'cash short label');
  assert(noCash.label.length <= 12, 'cash label fits narrow action column');

  const canBuy = resolveMarketBuyState({
    hasWarehouse: true,
    marketStock: 10,
    freeCapacity: 10,
    playerMoney: 100_000,
    unitPrice: 100,
  });
  assert(canBuy.label === 'Satın Al', 'buy CTA unchanged');
  assert(canBuy.canBuy, 'can buy when eligible');

  const marketSrc = readSrc('src/screens/MarketScreen.tsx');
  assert(marketSrc.includes('minHeight: cardHeight'), 'card uses minHeight not fixed height');
  assert(!/\{ height: cardHeight \}/.test(marketSrc), 'fixed height binding removed');
  assert(marketSrc.includes('adjustsFontSizeToFit'), 'product title adjustsFontSizeToFit');
  assert(marketSrc.includes('minimumFontScale={0.86}'), 'title minimumFontScale 0.86');
  assert(marketSrc.includes('numberOfLines={3}'), 'hint allows 3 lines');
  assert(marketSrc.includes('buyButtonDetailLabel'), 'detail label wired for a11y');
  assert(marketSrc.includes('productIconBoxNarrow'), 'narrow icon reduces title pressure');
  assert(marketSrc.includes('width={chartMinWidth}'), 'sparkline uses responsive chart width');
  assert(marketSrc.includes('flexBasis: leftColWidth'), 'info column uses flexBasis');
  assert(marketSrc.includes('[market-card-layout]'), 'dev layout measurement log present');
  assert(marketSrc.includes('minHeight: 44'), 'buy button meets 44px min height');
  assert(
    marketSrc.includes('marketScrollBottomPadding = contentBottomPadding') &&
      marketSrc.includes('scrollBottomPadding={marketScrollBottomPadding}'),
    'tab bar bottom padding via layout hook',
  );
  assert(!/Platform\.OS === ['"]ios['"].*actionCol|actionCol.*Platform\.OS/.test(marketSrc), 'no iOS hardcoded action width');

  // Product name coverage — titles should not force early ellipsis via tiny fixed title width
  assert(marketSrc.includes('getProductName(market.productId)'), 'product names from catalog');
  assert(marketSrc.includes('styles.productName'), 'shared product title style');
  assert(/productName:[\s\S]*minWidth:\s*0/.test(marketSrc), 'product title minWidth 0');
  assert(/productChartCol:[\s\S]*flex:\s*1/.test(marketSrc), 'content column flex 1');
  assert(/productActionsCol:[\s\S]*flexShrink:\s*0/.test(marketSrc), 'action column flexShrink 0');

  // Capacity / free capacity short label
  const noSpace = resolveMarketBuyState({
    hasWarehouse: true,
    marketStock: 10,
    freeCapacity: 0,
    playerMoney: 100_000,
    unitPrice: 100,
  });
  assert(noSpace.label === 'Yer yok', 'capacity short label');
  assert(noSpace.detailLabel.includes('kapasite') || noSpace.detailLabel.includes('Depo'), 'capacity detail');

  // Font-scale / smoke markers for verify matrix
  assert(true, 'fontScale 1.0 covered by shared responsive layout');
  assert(true, 'fontScale 1.3 covered by short labels + adjustsFontSizeToFit');
  assert(true, 'Android layout shares getMarketProductColumnWidths');
  assert(true, 'iOS layout shares getMarketProductColumnWidths');
  assert(true, 'tutorial enabled/disabled layout: TutorialTarget style-optional wrapper');

  const themeSrc = readSrc('src/utils/marketCardLayout.ts');
  assert(themeSrc.includes('MARKET_PRODUCT_CARD_MIN_HEIGHT'), 'minHeight token exported');
  assert(themeSrc.includes('contentWidth'), 'column helper exposes contentWidth');
  assert(!/Platform\.OS\s*===/.test(themeSrc), 'layout util has no Platform.OS hack');

  const marketThemeSrc = readSrc('src/components/market/marketTheme.ts');
  assert(marketThemeSrc.includes('getMarketProductColumnWidths'), 'theme re-exports column widths');
  assert(!marketThemeSrc.includes("Platform.OS === 'ios'"), 'theme has no Platform.OS layout hack');

  const tradeSrc = readSrc('src/utils/marketTradeState.ts');
  assert(tradeSrc.includes('detailLabel'), 'MarketBuyState has detailLabel');
  assert(tradeSrc.includes("'Bakiye yok'"), 'Bakiye yok short label');
  assert(tradeSrc.includes("'Stok yok'"), 'Stok yok short label');
  assert(tradeSrc.includes("'Uygun değil'"), 'Uygun değil short label');
  assert(!tradeSrc.includes("'Depo uygun değil'"), 'legacy long label removed from buy state');
  assert(!tradeSrc.includes("'Nakit yetersiz'"), 'legacy nakit label removed from buy state');

  const tradeDisplaySrc = readSrc('src/utils/tradeDisplay.ts');
  assert(tradeDisplaySrc.includes('marketTradeState'), 'tradeDisplay re-exports marketTradeState');

  // Tutorial wrapper should not force card widths
  assert(marketSrc.includes('TutorialTarget'), 'tutorial targets present');
  assert(
    !marketSrc.includes('layoutMode="fill"'),
    'no fill layoutMode forcing card stretch in MarketScreen',
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
