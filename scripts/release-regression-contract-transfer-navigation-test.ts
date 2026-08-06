/** Release regression checks for contracts, transfer eligibility and navigation entry points. */
import './test-globals';

import { readFileSync } from 'node:fs';

import { STARTER_TRUCK } from '../src/data/trucks';
import { ROUTES } from '../src/data/routes';
import {
  getTruckTransferBlockedReason,
  resolveTransferRoute,
} from '../src/simulation/truckTransfer';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

console.log('\n=== release-regression-contract-transfer-navigation-test ===\n');

const idleOwnedTruck = { ...STARTER_TRUCK, status: 'idle' as const, leaseExpired: false };
const idleLeasedTruck = {
  ...idleOwnedTruck,
  leaseId: 'test-lease',
  leaseExpiresAt: 999_999,
};

assert(getTruckTransferBlockedReason(idleOwnedTruck, true) === null, 'Boşta sahip olunan araç yönlendirilebilir');
assert(getTruckTransferBlockedReason(idleLeasedTruck, true) === null, 'Aktif kiralık boşta araç yönlendirilebilir');
assert(
  getTruckTransferBlockedReason({ ...idleOwnedTruck, status: 'on_route' }, true) === 'Teslimatta',
  'Teslimattaki araç sebebi açıklanır',
);
assert(
  getTruckTransferBlockedReason({ ...idleOwnedTruck, status: 'marketplace_locked' }, true) === 'Araç Pazarı’nda',
  'Pazardaki araç sebebi açıklanır',
);
assert(
  getTruckTransferBlockedReason({ ...idleOwnedTruck, status: 'out_of_fuel' }, true) === 'Yakıt yetersiz',
  'Yakıtı biten araç sebebi açıklanır',
);
assert(
  getTruckTransferBlockedReason({ ...idleOwnedTruck, leaseExpired: true }, true) === 'Kiralama süresi doldu',
  'Süresi biten kiralama engellenir',
);
assert(getTruckTransferBlockedReason(idleOwnedTruck, false) === 'Müsait şoför yok', 'Şoför eksikliği açıklanır');

const route = ROUTES.find((candidate) => candidate.fromCityId !== candidate.toCityId)!;
assert(
  resolveTransferRoute(ROUTES, route.fromCityId, route.toCityId)?.id === route.id,
  'Farklı şehir için transfer rotası bulunur',
);

const accountSection = readFileSync('src/components/AccountSection.tsx', 'utf8');
const accountCenter = readFileSync('src/screens/AccountCenterScreen.tsx', 'utf8');
const moreScreen = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
const leaderboardScreen = readFileSync('src/screens/LeaderboardScreen.tsx', 'utf8');
assert(accountSection.includes('onOpenLeaderboard'), 'Hesap kartında Liderlik Tablosu erişimi korunur');
assert(moreScreen.includes("setRoute('leaderboard')"), 'Liderlik Tablosu route’u erişilebilir');
assert(leaderboardScreen.includes('Kullanıcı Adı Oluştur'), 'Kullanıcı adı olmayan bağlı hesap için CTA gösterilir');
assert(accountCenter.includes('İlerlemeni korumak için Google veya Apple hesabını bağla'), 'Misafir kullanıcı için hesap bağlama açıklaması gösterilir');

console.log('\nrelease-regression-contract-transfer-navigation-test: PASSED');
