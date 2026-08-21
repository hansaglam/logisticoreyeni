/**
 * Incident frequency / severity distribution over synthetic deliveries.
 * Run: npx tsx scripts/incident-distribution-simulation-test.ts
 */
import './test-globals';

import {
  getIncidentTriggerProgress,
  getMaxIncidentsForDelivery,
  maybeRollDeliveryIncident,
  resolveDeliveryIncident,
} from '../src/simulation/deliveryIncidents';
import { getIncidentDefinition } from '../src/simulation/incidentCatalog';
import type { Contract, Delivery, Driver, Player, Truck } from '../src/types/game';

type Severity = 'minor' | 'moderate' | 'major';

function truck(condition: number): Truck {
  return {
    id: 'truck-sim',
    name: 'Sim',
    capacity: 22,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 250,
    currentFuelL: 200,
    totalMileageKm: 8_000,
    speed: 70,
    reliability: 85,
    maintenanceCost: 0.1,
    comfort: 70,
    condition,
    purchasePrice: 60_000,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'on_route',
  };
}

function driver(): Driver {
  return {
    id: 'driver-sim',
    name: 'Sim Driver',
    experience: 55,
    attention: 60,
    fuelSaving: 50,
    speed: 10,
    morale: 60,
    salaryPerDay: 80,
    hireCost: 0,
    assignedTruckId: 'truck-sim',
    status: 'driving',
  };
}

function player(level: number, condition: number): Player {
  return {
    companyName: 'Sim Co',
    money: 40_000,
    companyLevel: level,
    level,
    homeCityId: 'izmir',
    reputation: 52,
    completedContracts: 8,
    trucks: [truck(condition)],
    drivers: [driver()],
    warehouses: [],
  } as Player;
}

function contract(): Contract {
  return {
    id: 'sim-contract',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'machinery',
    amount: 10,
    payment: 4_000,
    distanceKm: 450,
    deadlineHours: 18,
    contractType: 'standard',
    status: 'in_progress',
  } as Contract;
}

function delivery(id: string, hours: number, risk: 'low' | 'medium' | 'high'): Delivery {
  const breakdownChance = risk === 'low' ? 0.03 : risk === 'high' ? 0.18 : 0.08;
  const accidentChance = risk === 'low' ? 0.02 : risk === 'high' ? 0.12 : 0.05;
  return {
    id,
    contractId: 'sim-contract',
    truckId: 'truck-sim',
    driverId: 'driver-sim',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'machinery',
    amount: 10,
    distanceKm: 450,
    progress: 0,
    status: 'on_route',
    startedAt: 100,
    estimatedArrivalTime: 100 + hours,
    deadlineTime: 100 + hours * 1.3,
    fuelCost: 280,
    maintenanceCost: 90,
    estimatedProfit: 2_400,
    travelHours: hours,
    breakdownChance,
    accidentChance,
    conditionLoss: 3,
  };
}

function simulateOne(params: {
  id: string;
  hours: number;
  level: number;
  risk: 'low' | 'medium' | 'high';
  condition: number;
}): Array<{ type: string; severity: Severity; polarity: string }> {
  let current = delivery(params.id, params.hours, params.risk);
  const p = player(params.level, params.condition);
  const c = contract();
  const max = getMaxIncidentsForDelivery(current);
  const events: Array<{ type: string; severity: Severity; polarity: string }> = [];
  let time = 120;

  for (let slot = 0; slot < max; slot += 1) {
    const trigger = getIncidentTriggerProgress(current, current.incidentRollsAttempted ?? 0);
    current = {
      ...current,
      progress: Math.min(0.89, Math.max(current.progress, trigger + 0.002)),
    };
    time += 2.2;
    current = maybeRollDeliveryIncident(current, c, p, time);
    if (current.incident?.status !== 'pending') {
      continue;
    }
    const definition = getIncidentDefinition(current.incident.type);
    events.push({
      type: current.incident.type,
      severity: current.incident.severity ?? definition.severity,
      polarity: current.incident.polarity ?? definition.polarity,
    });
    const resolved = resolveDeliveryIncident(current, current.incident.choices[0]!.id, time + 0.05);
    if (!resolved.ok || !resolved.delivery) {
      break;
    }
    current = {
      ...resolved.delivery,
      progress: Math.min(0.89, (resolved.delivery.progress ?? 0) + 0.2),
    };
    time += 2;
  }

  return events;
}

function percentile(counts: number[], value: number): number {
  if (counts.length === 0) {
    return 0;
  }
  return counts.filter((item) => item === value).length / counts.length;
}

function runBatch(
  label: string,
  count: number,
  factory: (index: number) => {
    hours: number;
    level: number;
    risk: 'low' | 'medium' | 'high';
    condition: number;
  },
) {
  const perDelivery: number[] = [];
  let minor = 0;
  let moderate = 0;
  let major = 0;
  let positive = 0;
  let negative = 0;
  let multiMajor = 0;
  let overCap = 0;

  for (let index = 0; index < count; index += 1) {
    const config = factory(index);
    const events = simulateOne({
      id: `${label}-${index}`,
      ...config,
    });
    const cap = getMaxIncidentsForDelivery(delivery(`${label}-${index}`, config.hours, config.risk));
    perDelivery.push(events.length);
    if (events.length > cap) {
      overCap += 1;
    }
    const majors = events.filter((item) => item.severity === 'major').length;
    if (majors > 1) {
      multiMajor += 1;
    }
    for (const event of events) {
      if (event.severity === 'minor') minor += 1;
      else if (event.severity === 'moderate') moderate += 1;
      else major += 1;
      if (event.polarity === 'positive') positive += 1;
      if (event.polarity === 'negative') negative += 1;
    }
  }

  const avg = perDelivery.reduce((sum, item) => sum + item, 0) / count;
  const totalEvents = minor + moderate + major;
  const summary = {
    label,
    avg,
    zero: percentile(perDelivery, 0),
    one: percentile(perDelivery, 1),
    twoPlus: perDelivery.filter((item) => item >= 2).length / count,
    minorShare: totalEvents ? minor / totalEvents : 0,
    moderateShare: totalEvents ? moderate / totalEvents : 0,
    majorShare: totalEvents ? major / totalEvents : 0,
    positiveShare: totalEvents ? positive / totalEvents : 0,
    negativeShare: totalEvents ? negative / totalEvents : 0,
    overCap,
    multiMajor,
    totalEvents,
  };
  console.log(
    `  ${label}: avg=${summary.avg.toFixed(3)}  0=${(summary.zero * 100).toFixed(1)}%  1=${(summary.one * 100).toFixed(1)}%  2+=${(summary.twoPlus * 100).toFixed(1)}%  minor=${(summary.minorShare * 100).toFixed(0)}%  mod=${(summary.moderateShare * 100).toFixed(0)}%  major=${(summary.majorShare * 100).toFixed(0)}%  pos=${(summary.positiveShare * 100).toFixed(0)}%`,
  );
  return summary;
}

let failed = 0;
function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log('\n=== Incident distribution simulation (10k+) ===\n');

const main = runBatch('10h L5 medium healthy', 10_000, () => ({
  hours: 10,
  level: 5,
  risk: 'medium',
  condition: 88,
}));
const short = runBatch('2h L5 medium healthy', 3_000, () => ({
  hours: 2,
  level: 5,
  risk: 'medium',
  condition: 88,
}));
const long = runBatch('30h L5 medium healthy', 3_000, () => ({
  hours: 30,
  level: 5,
  risk: 'medium',
  condition: 88,
}));
const lowLevel = runBatch('10h L2 low-risk', 3_000, () => ({
  hours: 10,
  level: 2,
  risk: 'low',
  condition: 92,
}));
const highLevel = runBatch('10h L10 high-risk worn', 3_000, () => ({
  hours: 10,
  level: 10,
  risk: 'high',
  condition: 48,
}));

assert(main.avg > 0.25 && main.avg < 0.8, 'normal 10h average stays below one incident');
assert(main.zero > 0.4, 'most normal deliveries still have zero incidents');
assert(main.twoPlus < 0.22, '2+ incidents stay uncommon on 10h routes');
assert(main.majorShare < 0.12, 'majors stay rare among fired events');
assert(main.positiveShare > 0.12, 'positive/opportunity events are present');
assert(main.overCap === 0, 'caps never exceeded');
assert(main.multiMajor === 0, 'at most one major per delivery');
assert(short.avg < main.avg, 'short routes fire less often than 10h');
assert(long.avg > main.avg, 'long routes fire more often than 10h');
assert(long.avg < 2.2, '30h routes do not become popup sequences');
assert(lowLevel.majorShare <= highLevel.majorShare, 'higher level/risk unlocks more major complexity');
assert(highLevel.avg < 1.2, 'worn high-risk routes still are not spam');

if (failed > 0) {
  console.error(`\n${failed} distribution assertions failed`);
  process.exit(1);
}

console.log('\nDistribution assertions passed');
