/**
 * 30 oyun günü ekonomi + retention simülasyonu.
 * Run: npx tsx scripts/economy-retention-30day-test.ts
 */

import './test-globals';

import { MILESTONE_DEFINITIONS } from '../src/data/milestones';
import {
  installProfileSeed,
  runHeadlessSim,
  SIM_PROFILES,
  type SimRunMetrics,
} from './lib/headlessSim';

const SIM_DAYS = 30;
const ORIGINAL_RANDOM = Math.random.bind(Math);

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function printProfileMetrics(m: SimRunMetrics, label: string): void {
  const specialTotal = Object.entries(m.contractTypesCompleted)
    .filter(([t]) => t !== 'standard')
    .reduce((s, [, n]) => s + n, 0);
  const totalTypes = Object.values(m.contractTypesCompleted).reduce((s, n) => s + n, 0);
  const specialPct = totalTypes > 0 ? ((specialTotal / totalTypes) * 100).toFixed(1) : '0';

  console.log(`\n--- ${label} ---`);
  console.table({
    'Başlangıç nakit': formatMoney(m.startCash),
    'Gün 7 nakit': formatMoney(m.cashDay7),
    'Gün 14 nakit': formatMoney(m.cashDay14),
    'Gün 30 nakit': formatMoney(m.cashDay30),
    'Tamamlanan teslimat': m.completedDeliveries,
    'Başarısız': m.failedDeliveries,
    'Geç teslimat': m.lateDeliveries,
    'Ort. sözleşme net': formatMoney(m.avgContractNet),
    'Trade kârı': formatMoney(m.totalTradeProfit),
    'Yakıt': formatMoney(m.totalFuelCost),
    'Bakım': formatMoney(m.totalMaintenanceCost),
    'Günlük ops': formatMoney(m.totalDailyOpsCost),
    'Şirket level': m.playerLevel,
    'Max şoför L': m.maxDriverLevel,
    'Upgrade': m.upgradeCount,
    'Depo %': `${m.warehouseUsagePct.toFixed(1)}%`,
    'Rep': `${m.startReputation} → ${m.reputationDay30}`,
    'CompanyScore': `${Math.round(m.startCompanyScore).toLocaleString()} → ${Math.round(m.companyScoreDay30).toLocaleString()}`,
    'Milestone': `${m.milestonesClaimed}/${MILESTONE_DEFINITIONS.length}`,
    'Weekly claimed': m.weeklyObjectivesClaimed,
    'Hazır ödül G30': m.retentionReadyRewards,
    'Özel tip %': `${specialPct}%`,
    'Playable düşük gün': m.playableContractLowDays,
    'Negatif nakit gün': m.negativeCashDays,
    'Ort. world event': m.avgWorldEventsActive.toFixed(2),
  });
  console.log('Tip dağılımı:', m.contractTypesCompleted);
  console.log('Şoför level:', m.driverLevels);
}

function assessBalance(all: SimRunMetrics[]): void {
  console.log('\n=== Denge Kontrolü ===\n');

  for (const m of all) {
    const growth = m.cashDay30 / Math.max(1, m.startCash);
    const rich = m.cashDay30 > 400_000 ? '⚠ çok hızlı zenginleşme' : growth > 10 ? '⚠ hızlı büyüme' : '✓ para OK';
    const lock = m.negativeCashDays > 3 || m.playableContractLowDays > 8 ? '⚠ kilitlenme riski' : '✓ akış OK';
    const xp = m.maxDriverLevel >= 5 ? '⚠ driver L5 çok erken' : m.maxDriverLevel <= 1 && m.completedDeliveries > 15 ? '⚠ XP yavaş' : '✓ XP OK';
    console.log(`${m.profile}: nakit×${growth.toFixed(1)} | ${rich} | ${lock} | ${xp}`);
  }
}

function assessRetention(all: SimRunMetrics[]): void {
  console.log('\n=== Retention Kontrolü ===\n');
  for (const m of all) {
    const pct = ((m.milestonesClaimed / MILESTONE_DEFINITIONS.length) * 100).toFixed(0);
    console.log(
      `${m.profile}: ${m.milestonesClaimed} milestone (%${pct}), ${m.milestonesRemaining} kalan, hazır ödül=${m.retentionReadyRewards}`,
    );
  }
  console.log(
    '\nNot: Haftalık görevler gerçek takvim haftasına bağlı — 30 oyun günü ≠ 4 gerçek hafta.',
  );
}

console.log('\n=== LogistiCore 30 Gün Ekonomi + Retention Simülasyonu ===\n');

const results: SimRunMetrics[] = [];

for (const profile of SIM_PROFILES) {
  installProfileSeed(profile);
  const metrics = runHeadlessSim(profile, SIM_DAYS);
  results.push(metrics);
  printProfileMetrics(metrics, profile.label);
}

assessBalance(results);
assessRetention(results);

Math.random = ORIGINAL_RANDOM;

console.log('\n=== Simülasyon tamamlandı ===\n');
