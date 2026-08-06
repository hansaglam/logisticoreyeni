/**
 * Daily Operation Support card UI regression tests.
 * Run: npx tsx scripts/daily-operation-support-ui-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

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

console.log('\n=== Daily Operation Support UI Regression ===\n');

console.log('Compact horizontal layout');
{
  const card = readFileSync('src/components/monetization/DashboardDailyOpsBonusCard.tsx', 'utf8');
  assert(card.includes('supportVisual'), 'visual column present');
  assert(card.includes('supportContent'), 'content column flex:1');
  assert(card.includes('supportAction'), 'CTA constrained width');
  assert(card.includes('maxWidth: 132'), 'CTA max width capped');
  assert(card.includes('minWidth: 108'), 'CTA min width set');
  assert(card.includes('fontSize: 14'), 'title 14px');
  assert(card.includes('fontSize: 11'), 'subtitle 11px');
  assert(card.includes('fontSize: 13'), 'reward 13px');
  assert(card.includes('fontSize: 10'), 'ad status 10px');
  assert(card.includes('fontSize: 12'), 'CTA label 12px');
  assert(card.includes('Günlük Operasyon Desteği'), 'full title string');
  assert(card.includes('Bir günlük temel giderlerini karşıla.'), 'compact subtitle copy');
  assert(card.includes('Reklam izleyerek al'), 'ready ad status copy');
  assert(card.includes('Reklam hazırlanıyor'), 'loading ad status copy');
  assert(card.includes('Reklam yüklenemedi'), 'error ad status copy');
  assert(card.includes('Ödülü Al'), 'ready CTA label');
  assert(card.includes('Tekrar Dene'), 'retry CTA label');
  assert(card.includes('STACKED_FONT_SCALE'), 'fontScale stacked fallback');
  assert(!card.includes('fontSize: 16'), 'oversized 16px title removed');
  assert(!card.includes('fontSize: 17'), 'oversized 17px reward removed');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
