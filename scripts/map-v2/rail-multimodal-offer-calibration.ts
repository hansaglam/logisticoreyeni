/**
 * Map V2 Step 27 — RAIL multimodal offer calibration (no mutation).
 * Run: npx tsx scripts/map-v2/rail-multimodal-offer-calibration.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'path';

import { contractPaymentBalance } from '../../src/config/balance';
import { ACCEPTED_RAIL_TARIFF_CORRIDORS } from '../../src/domain/multimodalRailTariff';
import { enumerateRailMultimodalOfferCandidates } from '../../src/domain/multimodalRailOffer';
import { SAVE_GAME_VERSION } from '../../src/storage/saveGame';
import { STARTER_MONEY } from '../../src/utils/localSaveMeaning';
import { getTurkeyRoadTransferAccessArtifact } from '../../src/mapV2/world/multimodalRoadTransferAccessLoader';

const root = resolve(__dirname, '../..');
const access = getTurkeyRoadTransferAccessArtifact();
const { valid, rejected } = enumerateRailMultimodalOfferCandidates({
  generationSeed: 'cal-v1',
  accessArtifact: access,
  playerLevel: 1,
  productIds: ['steel'],
  cargoTonnesBands: [1, 5, 10, 25],
});

const l1Min = contractPaymentBalance.levelCaps[1].paymentMin;
const l1Max = contractPaymentBalance.levelCaps[1].paymentMax;

type Flag = 'NEGATIVE_MARGIN' | 'MARGIN_TOO_THIN' | 'REWARD_OUTLIER' | 'PROGRESSION_OUTLIER';

const rows = valid.map((offer) => {
  const payment = offer.playerPayment;
  const margin = offer.economics.expectedGrossMargin;
  const flags: Flag[] = [];
  if (margin <= 0) flags.push('NEGATIVE_MARGIN');
  if (margin < 80 || offer.economics.expectedGrossMarginRatio < 0.08) flags.push('MARGIN_TOO_THIN');
  if (offer.cargo.quantity <= 10 && payment > l1Max * 1.5) flags.push('REWARD_OUTLIER');
  if (offer.cargo.quantity === 25 && payment > 12_000) flags.push('REWARD_OUTLIER');
  if (payment > STARTER_MONEY * 0.35) flags.push('PROGRESSION_OUTLIER');
  return {
    origin: offer.originCityId,
    destination: offer.destinationCityId,
    cargoTonnes: offer.cargo.quantity,
    plannedDurationGameSeconds: offer.durationSnapshot.totalDurationGameSeconds,
    deadlineGameSeconds: offer.deadlineSnapshot.deadlineGameSeconds,
    railCarrierCost: offer.economics.railCarrierCost,
    estimatedRoadOperatingCost: offer.economics.estimatedRoadOperatingCost,
    playerPayment: payment,
    expectedGrossMargin: margin,
    expectedGrossMarginPercent: Math.round(offer.economics.expectedGrossMarginRatio * 1000) / 10,
    paymentVsStartingCash: payment / STARTER_MONEY,
    paymentVsL1Min: payment / l1Min,
    paymentVsL1Max: payment / l1Max,
    flags,
  };
});

const report = {
  policyVersion: 'multimodal-rail-offer-economics-v1',
  saveGameVersion: SAVE_GAME_VERSION,
  equation: 'playerPayment = round((railCarrierCost + roadAccessOpex) * 1.22 + 180)',
  notCarrierCostRenamed: true,
  validCount: valid.length,
  rejectedCount: rejected.length,
  negativeMarginCount: rows.filter((row) => row.flags.includes('NEGATIVE_MARGIN')).length,
  outlierCount: rows.filter((row) => row.flags.length > 0).length,
  scenarios: rows,
};

const outDir = resolve(root, 'src/mapV2/generated/multimodal');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'turkey-rail-multimodal-offer-calibration.report.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log('\n=== RAIL multimodal offer calibration ===\n');
console.log(`valid ${valid.length} rejected ${rejected.length} outliers ${report.outlierCount}`);
for (const row of rows) {
  console.log(
    `${row.origin}→${row.destination} ${row.cargoTonnes}t pay$${row.playerPayment} rail$${row.railCarrierCost} road$${row.estimatedRoadOperatingCost} margin$${row.expectedGrossMargin} (${row.expectedGrossMarginPercent}%) ${row.flags.join(',') || 'ok'}`,
  );
}
if (report.negativeMarginCount > 0) {
  console.error('NEGATIVE_MARGIN present — Step 27 must not PASS');
  process.exit(1);
}
console.log(`\nwrote ${outPath}`);
