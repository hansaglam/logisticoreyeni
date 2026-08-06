/**
 * Piyasa olayı kartı display mapping doğrulaması.
 * Run: npx tsx scripts/market-world-event-display-test.ts
 */

import './test-globals';

import {
  buildWorldEventDisplay,
  sortWorldEventsByImportance,
} from '../src/utils/worldEventDisplay';
import type { WorldEvent } from '../src/types/game';

let failed = 0;

function check(condition: boolean, label: string): void {
  if (!condition) {
    failed += 1;
    console.error(`  ✗ ${label}`);
    return;
  }
  console.log(`  ✓ ${label}`);
}

console.log('\n=== market-world-event-display-test ===\n');

const fuelEvent: WorldEvent = {
  id: 'fuel-test',
  type: 'fuel_crisis',
  title: 'Küresel Yakıt Baskısı',
  description: 'Dünya genelinde yakıt tedariki geçici baskı altında.',
  startsAtDay: 1,
  endsAtDay: 7,
  durationDays: 6,
  startsAt: Date.now(),
  endsAt: Date.now() + 6 * 60 * 60 * 1000,
  impact: { fuelPriceMultiplier: 1.12 },
  severity: 'high',
  isActive: true,
};

const display = buildWorldEventDisplay(fuelEvent, 120);
check(display.title === 'Yakıt Krizi', 'fuel_crisis başlığı Yakıt Krizi');
check(display.statusLabel === 'KRİZ', 'fuel_crisis durum etiketi KRİZ');
check(display.shortDescription.includes('yakıt'), 'fuel_crisis kısa açıklama yakıt içerir');
check(display.impactItems.some((item) => item.label.includes('Yakıt')), 'fuel_crisis etki satırı var');
check(display.meaningBullets.length >= 2, 'fuel_crisis anlam maddeleri var');
check(display.playerAdvice.length >= 2, 'fuel_crisis oyuncu önerisi var');
check(display.causeText.length > 10, 'fuel_crisis sebep metni var');

const minimalEvent: WorldEvent = {
  id: 'unknown-event',
  type: 'road_work',
  title: 'Test',
  description: '',
  startsAtDay: 1,
  endsAtDay: 2,
  durationDays: 1,
  impact: {},
  severity: 'low',
  isActive: true,
};

const fallbackDisplay = buildWorldEventDisplay(minimalEvent, 48);
check(fallbackDisplay.meaningBullets.length > 0, 'eksik veride fallback anlam maddeleri');
check(fallbackDisplay.playerAdvice.length > 0, 'eksik veride fallback öneri');

const sorted = sortWorldEventsByImportance([
  { ...minimalEvent, id: 'low', severity: 'low' },
  {
    ...minimalEvent,
    id: 'high',
    type: 'fuel_crisis',
    severity: 'high',
    impact: { fuelPriceMultiplier: 1.2 },
  },
]);
check(sorted[0]?.severity === 'high', 'yüksek önemli olay öne çıkar');

console.log(`\nResult: ${failed === 0 ? 'passed' : `${failed} failed`}\n`);
process.exit(failed > 0 ? 1 : 0);
