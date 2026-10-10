/**
 * Map V2 Step 26 — RAIL tariff calibration (visibility, not auto-balance).
 * Run: npx tsx scripts/map-v2/rail-tariff-calibration.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  contractBalance,
  contractPaymentBalance,
  deliveryCostBalance,
  economyBalance,
} from '../../src/config/balance';
import { STARTER_TRUCK } from '../../src/data/trucks';
import { ROUTES } from '../../src/data/routes';
import {
  ACCEPTED_RAIL_TARIFF_CORRIDORS,
  estimateMultimodalRailTariff,
  MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
  RAIL_TARIFF_BASE_FEE_DOLLARS,
  RAIL_TARIFF_CARGO_QUANTITY_UNIT,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
  RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
  RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS,
  RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM,
  RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS,
} from '../../src/domain/multimodalRailTariff';
import { SAVE_GAME_VERSION } from '../../src/storage/saveGame';
import { STARTER_MONEY } from '../../src/utils/localSaveMeaning';
import { getTurkeyRailRouteDiagnostics } from '../../src/mapV2/world/railRouteDiagnosticsLoader';

const root = resolve(__dirname, '../..');
const cargoSamples = [1, 10, 25] as const;

function roadRouteKm(a: string, b: string): number | null {
  const hit = ROUTES.find((row) => row.fromCityId === a && row.toCityId === b);
  return hit ? hit.distanceKm : null;
}

function representativeRoadOpex(distanceKm: number, tonnes: number): number {
  const fuel =
    contractBalance.estimateFuelPerKm *
    distanceKm *
    economyBalance.baseFuelPrice *
    deliveryCostBalance.fuelCostMultiplier;
  const maintenance =
    distanceKm * contractBalance.estimateMaintenancePerKm * deliveryCostBalance.maintenanceCostMultiplier;
  const toll = 200;
  const handling = tonnes * deliveryCostBalance.cargoHandlingCostPerTon;
  return Math.round(fuel + maintenance + toll + handling);
}

const diagnostics = getTurkeyRailRouteDiagnostics();
const scenarios = ACCEPTED_RAIL_TARIFF_CORRIDORS.flatMap((corridor) =>
  cargoSamples.map((tonnes) => {
    const estimate = estimateMultimodalRailTariff({
      routeReference: corridor.routeReference,
      distanceMeters: corridor.distanceMeters,
      distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
      cargoQuantity: tonnes,
      cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
      sourceRailPackageHash: diagnostics.sourceRailPackageHash,
    });
    const km = corridor.distanceMeters / 1000;
    const cost = estimate.totalCarrierCost ?? 0;
    const roadKm = roadRouteKm(corridor.leftCityId, corridor.rightCityId);
    const roadOpex = roadKm != null ? representativeRoadOpex(roadKm, tonnes) : null;
    return {
      corridor: `${corridor.leftCityId}↔${corridor.rightCityId}`,
      routeReference: corridor.routeReference,
      distanceMeters: corridor.distanceMeters,
      cargoTonnes: tonnes,
      status: estimate.status,
      railCarrierCost: cost,
      perKm: cost / km,
      perTonne: cost / tonnes,
      vsStartingCash: cost / STARTER_MONEY,
      vsL1PaymentMin: cost / contractPaymentBalance.levelCaps[1].paymentMin,
      vsL1PaymentMax: cost / contractPaymentBalance.levelCaps[1].paymentMax,
      vsStarterTruck: cost / STARTER_TRUCK.purchasePrice,
      roadDirectKm: roadKm,
      roadOpexEstimate: roadOpex,
      vsRoadOpex: roadOpex != null && roadOpex > 0 ? cost / roadOpex : null,
    };
  }),
);

const report = {
  policyVersion: MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
  saveGameVersion: SAVE_GAME_VERSION,
  sourceRailPackageHash: RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
  diagnosticsHash: diagnostics.sourceRailPackageHash,
  equation: 'max(minimum, baseFee + round(distanceKm * tonnes * rate) + terminalFee)',
  constants: {
    kind: 'GAMEPLAY_BALANCE_CONSTANT',
    notOfficialRailwayTariff: true,
    baseFeeDollars: RAIL_TARIFF_BASE_FEE_DOLLARS,
    rateDollarsPerTonneKm: RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM,
    minimumChargeDollars: RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS,
    terminalHandlingDollars: RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS,
  },
  economyBaselineCode: {
    startingMoney: STARTER_MONEY,
    starterTruckPurchasePrice: STARTER_TRUCK.purchasePrice,
    starterTruckCapacityTons: STARTER_TRUCK.capacity,
    l1PaymentMin: contractPaymentBalance.levelCaps[1].paymentMin,
    l1PaymentMax: contractPaymentBalance.levelCaps[1].paymentMax,
    absolutePaymentMax: contractPaymentBalance.absolutePaymentMax,
    baseFuelPrice: economyBalance.baseFuelPrice,
    estimateFuelPerKm: contractBalance.estimateFuelPerKm,
    estimateMaintenancePerKm: contractBalance.estimateMaintenancePerKm,
    cargoMassUnit: 'tonnes',
    historicalPromptStartingCash: 20_000,
    historicalPromptL1: [2000, 8000],
    historicalPromptStarterTruck: 45_000,
    historicalMatchesCode: true,
  },
  scenarios,
};

const outDir = resolve(root, 'src/mapV2/generated/multimodal');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'turkey-rail-tariff-calibration.report.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log('\n=== RAIL tariff calibration (gameplay balance, not TCDD) ===\n');
console.log(`policy ${report.policyVersion}  SAVE_GAME_VERSION ${report.saveGameVersion}`);
console.log(
  `constants base=${RAIL_TARIFF_BASE_FEE_DOLLARS} rate=${RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM}/t-km min=${RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS} terminal=${RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS}`,
);
for (const row of scenarios) {
  console.log(
    `${row.corridor}  ${row.cargoTonnes}t  $${row.railCarrierCost}  vsL1min=${row.vsL1PaymentMin.toFixed(3)}  vsCash=${row.vsStartingCash.toFixed(3)}  vsRoadOpex=${row.vsRoadOpex?.toFixed(3) ?? 'n/a'}`,
  );
}
console.log(`\nwrote ${outPath}`);
