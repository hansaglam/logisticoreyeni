import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getMarketplaceBackendReason,
  mapMarketplaceCallableError,
} from '../src/domain/vehicleMarketplaceErrors';
import { getMarketplaceErrorMessage } from '../src/domain/vehicleMarketplacePresentation';

assert.equal(
  mapMarketplaceCallableError({ code: 'functions/unauthenticated' }),
  'auth-required',
);
assert.equal(
  mapMarketplaceCallableError({ code: 'functions/permission-denied' }),
  'permission-denied',
);
assert.equal(
  mapMarketplaceCallableError({ code: 'functions/not-found' }),
  'function-not-found',
);
assert.equal(
  mapMarketplaceCallableError({ code: 'functions/unavailable' }),
  'service-unavailable',
);
assert.equal(
  mapMarketplaceCallableError({ code: 'functions/internal' }),
  'service-unavailable',
);
assert.notEqual(
  mapMarketplaceCallableError({ code: 'functions/internal' }),
  'function-not-found',
);
assert.equal(
  mapMarketplaceCallableError({
    code: 'functions/failed-precondition',
    details: { reason: 'save-conflict' },
  }),
  'save-conflict',
);
assert.equal(
  getMarketplaceBackendReason({ details: { reason: 'truck-busy' } }),
  'truck-busy',
);

assert.match(getMarketplaceErrorMessage('auth-required'), /hesabını bağla/);
assert.match(
  getMarketplaceErrorMessage('marketplace-state-missing'),
  /henüz hazırlanmadı/,
);
assert.match(
  getMarketplaceErrorMessage('save-conflict'),
  /senkronizasyonu tamamlanmadan/,
);
assert.notEqual(
  getMarketplaceErrorMessage('truck-not-found'),
  getMarketplaceErrorMessage('service-unavailable'),
);

const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/services/vehicleMarketplaceService.ts'),
  'utf8',
);
const backendSource = readFileSync(
  resolve(process.cwd(), 'backend/src/index.ts'),
  'utf8',
);
assert.match(
  serviceSource,
  /getFirebaseFunctionsSafe\(VEHICLE_MARKETPLACE_FUNCTIONS_REGION\)/,
);
assert.doesNotMatch(serviceSource, /ensureVehicleMarketplaceState/);
assert.match(backendSource, /region: 'us-central1'/);
for (const callableName of [
  'createVehicleListing',
  'cancelVehicleListing',
  'purchaseVehicleListing',
  'getVehicleMarketplaceListings',
  'getMyVehicleListings',
  'prepareVehicleMarketplaceAccountDeletion',
]) {
  assert.match(serviceSource, new RegExp(`'${callableName}'`));
  assert.match(backendSource, new RegExp(`export const ${callableName}`));
}
assert.doesNotMatch(
  backendSource,
  /export const ensureVehicleMarketplaceState/,
);

const marketplaceUiSource = readFileSync(
  resolve(process.cwd(), 'src/screens/VehicleMarketplaceScreen.tsx'),
  'utf8',
);
assert.match(marketplaceUiSource, /unavailableReason === 'auth-required'/);
assert.match(marketplaceUiSource, /Araç Pazarı hesabı gerekli/);
assert.match(marketplaceUiSource, /getMarketplaceErrorMessage\('auth-required'\)/);

console.log('[vehicle-marketplace-create-chain-test] PASS', {
  structuredErrors: true,
  functionsRegion: 'us-central1',
  trustedInitializationInsideExistingCallable: true,
  genericFallbackDoesNotHideKnownReasons: true,
});
