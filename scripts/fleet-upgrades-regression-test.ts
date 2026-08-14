/**
 * Fleet upgrades tab integration regression guard.
 * Run: npx tsx scripts/fleet-upgrades-regression-test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STARTER_TRUCK } from '../src/data/trucks';
import { ROUTES } from '../src/data/routes';
import { PRODUCTS } from '../src/data/products';
import { calculateConditionLoss } from '../src/simulation/delivery';
import {
  calculateContractDurationHours,
  estimateContractTripCostBreakdown,
} from '../src/simulation/contractEconomics';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import {
  applyTruckUpgrade,
  canUpgradeTruck,
  getEngineSpeedMultiplier,
  getTruckUpgradeCost,
  normalizeTruckUpgrades,
} from '../src/simulation/truckUpgrades';
import { getTruckFuelConsumptionPerKm } from '../src/utils/truckFuel';
import { normalizeTruckUpgrades } from '../src/simulation/truckUpgrades';
import type { Contract, Driver, Product, Route, Truck } from '../src/types/game';

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

let pass = 0;
let fail = 0;

function ok(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
}

console.log('\n=== fleet-upgrades-regression-test ===\n');

const fleetScreen = read('src/screens/FleetScreen.tsx');
const fleetTabSegment = read('src/components/fleet/FleetTabSegment.tsx');
const upgradesPanel = read('src/components/fleet/FleetUpgradesPanel.tsx');
const truckUpgrades = read('src/simulation/truckUpgrades.ts');
const gameStore = read('src/store/gameStore.ts');
const delivery = read('src/simulation/delivery.ts');
const contractEconomics = read('src/simulation/contractEconomics.ts');
const truckFuel = read('src/utils/truckFuel.ts');
const saveGame = read('src/storage/saveGame.ts');

console.log('1. Fleet tab integration');
ok(fleetTabSegment.includes("label: 'Geliştirmeler'"), 'Geliştirmeler tab defined');
ok(fleetTabSegment.includes("'upgrades'"), 'upgrades tab key exists');
ok(fleetTabSegment.includes('Kamyonlar'), 'Kamyonlar tab preserved');
ok(fleetTabSegment.includes('Şoförler'), 'Şoförler tab preserved');
ok(fleetTabSegment.includes('Dorseler'), 'Dorseler tab preserved');
ok(fleetScreen.includes('FleetTabSegment'), 'FleetScreen uses FleetTabSegment');
ok(fleetScreen.includes('FleetUpgradesPanel'), 'FleetScreen embeds FleetUpgradesPanel');
ok(fleetScreen.includes("activeTab === 'upgrades'"), 'upgrades tab content branch');
ok(!fleetScreen.includes('managingUpgradesTruckId'), 'no full-screen upgrade drill-down');
ok(fleetTabSegment.includes('ScrollView'), 'responsive horizontal tab scroll');

console.log('\n2. Canonical domain reuse');
ok(upgradesPanel.includes('upgradeTruck'), 'panel uses store upgradeTruck');
ok(upgradesPanel.includes('getTruckUpgradeCost'), 'panel uses canonical cost helper');
ok(upgradesPanel.includes('TRUCK_UPGRADE_TYPES'), 'panel uses canonical upgrade types');
ok(!upgradesPanel.includes('const UPGRADE_COST'), 'no hardcoded upgrade economy in panel');
ok(upgradesPanel.includes('calculateTruckUpgradeInvestmentValue'), 'summary uses investment helper');
ok(gameStore.includes('upgradeTruck: (truckId, upgradeType)'), 'store upgrade action exists');

console.log('\n3. Purchase safety');
ok(upgradesPanel.includes('upgradeInFlightRef'), 'double tap guard ref');
ok(upgradesPanel.includes('upgradingType'), 'upgrade in-flight UI state');
ok(gameStore.includes('canAffordVoluntaryPurchase'), 'store cash guard');
ok(gameStore.includes('applyTruckUpgrade'), 'store uses applyTruckUpgrade');
ok(gameStore.includes('applyCashTransaction'), 'atomic cash deduction');

console.log('\n4. Performance');
ok(!upgradesPanel.includes('useGameStore()'), 'panel avoids whole-store subscription');
ok(fleetScreen.includes("activeTab === 'upgrades'"), 'upgrades panel conditionally mounted');

console.log('\n5. Simulation wiring');
ok(truckFuel.includes('getFuelEfficiencyReduction'), 'fuel consumption reads upgrade reduction');
ok(contractEconomics.includes('getEngineSpeedMultiplier'), 'duration uses engine upgrade multiplier');
ok(contractEconomics.includes('getTruckFuelConsumptionPerKm'), 'contract fuel uses upgraded consumption');
ok(delivery.includes('getDurabilityConditionLossReduction'), 'condition loss reads durability upgrade');

const baseTruck = normalizeTruckUpgrades({
  ...STARTER_TRUCK,
  id: 'upgrade-test-truck',
  status: 'idle',
  ownershipType: 'owned',
});
const upgradedTruck = applyTruckUpgrade(
  applyTruckUpgrade(applyTruckUpgrade(normalizeTruckUpgrades(baseTruck), 'engine'), 'fuelEfficiency'),
  'durability',
);

ok(
  getTruckFuelConsumptionPerKm(upgradedTruck) < getTruckFuelConsumptionPerKm(baseTruck),
  'fuel efficiency upgrade lowers L/km',
);
ok(getEngineSpeedMultiplier(upgradedTruck) > 1, 'engine upgrade increases speed multiplier');

const route = ROUTES[0] as Route;
const product = PRODUCTS[0] as Product;
const contract = {
  distanceKm: route.distanceKm,
  amount: 12,
  urgency: 0.4,
} as Contract;
const driver = {
  attention: 80,
} as Driver;

const baseLoss = calculateConditionLoss(contract, baseTruck, driver, route, product);
const durableLoss = calculateConditionLoss(
  contract,
  applyTruckUpgrade(baseTruck, 'durability'),
  driver,
  route,
  product,
);
ok(durableLoss < baseLoss, 'durability upgrade reduces condition loss');

const baseDuration = calculateContractDurationHours({
  distanceKm: route.distanceKm,
  cargoTons: 12,
  truckSpeedKmh: baseTruck.speed,
  truckCapacityTons: baseTruck.capacity,
  truck: baseTruck,
}).durationHours;
const engineDuration = calculateContractDurationHours({
  distanceKm: route.distanceKm,
  cargoTons: 12,
  truckSpeedKmh: baseTruck.speed,
  truckCapacityTons: baseTruck.capacity,
  truck: applyTruckUpgrade(baseTruck, 'engine'),
}).durationHours;
ok(engineDuration < baseDuration, 'engine upgrade shortens estimated duration');

const baseFuel = estimateContractTripCostBreakdown({
  amount: 12,
  route,
  urgency: 0.4,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  truck: baseTruck,
}).fuelCost;
const efficientFuel = estimateContractTripCostBreakdown({
  amount: 12,
  route,
  urgency: 0.4,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  truck: applyTruckUpgrade(baseTruck, 'fuelEfficiency'),
}).fuelCost;
ok(efficientFuel < baseFuel, 'fuel efficiency upgrade lowers trip fuel cost');

console.log('\n6. Persistence');
const persisted = normalizeTruckUpgrades({
  ...baseTruck,
  upgrades: { engine: 2, fuelEfficiency: 1, cargo: 3, durability: 0 },
  upgradeLevel: 6,
} as Truck);
ok(persisted.upgrades?.engine === 2, 'save normalization keeps engine level');
ok(persisted.upgrades?.cargo === 3, 'save normalization keeps cargo level');
ok(saveGame.includes('normalizeTruckUpgrades'), 'saveGame normalizes truck upgrades on load');

console.log('\n7. Upgrade business rules');
ok(canUpgradeTruck(baseTruck, 'engine'), 'can upgrade at level 0');
const maxed = normalizeTruckUpgrades({
  ...baseTruck,
  upgrades: { engine: 3, fuelEfficiency: 3, cargo: 3, durability: 3 },
});
ok(!canUpgradeTruck(maxed, 'engine'), 'max level blocks upgrade');
ok(getTruckUpgradeCost(maxed, 'engine') === 0, 'max level has zero cost');

console.log('\n8. Deep-link routing');
ok(gameStore.includes("pendingFleetSubTab: 'upgrades'"), 'openUpgradesScreen routes to fleet upgrades tab');

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
