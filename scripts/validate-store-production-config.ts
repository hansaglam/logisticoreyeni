/**
 * Fail-closed store production config validator.
 * Run: npm run validate:store-production
 */

import { resolve } from 'node:path';

import { loadBuildProfileEnv } from './build-env';
import {
  validateInternalProfileEnv,
  validateStoreProductionEnv,
} from '../src/config/storeProductionPolicy';

const ROOT = resolve(import.meta.dirname, '..');

function main(): void {
  console.log('\n=== validate-store-production-config ===\n');

  const productionEnv = loadBuildProfileEnv(ROOT, 'production');
  const internalEnv = loadBuildProfileEnv(ROOT, 'internal');

  const productionErrors = validateStoreProductionEnv({ env: productionEnv });
  const internalErrors = validateInternalProfileEnv(internalEnv);

  for (const error of productionErrors) {
    console.error(`  ✗ production: ${error}`);
  }
  for (const error of internalErrors) {
    console.error(`  ✗ internal profile: ${error}`);
  }

  const moreScreen = loadSource('src/screens/MoreScreen.tsx');
  if (!moreScreen.includes("route === 'debug' && __DEV__")) {
    console.error('  ✗ debug simulation route must be __DEV__ guarded');
  } else {
    console.log('  ✓ debug simulation route __DEV__ guarded');
  }

  const gate = loadSource('src/components/BackendDiagnosticsGate.tsx');
  if (!gate.includes('isBackendDiagnosticsEnabled')) {
    console.error('  ✗ BackendDiagnosticsGate missing enabled guard');
  } else {
    console.log('  ✓ BackendDiagnosticsGate fail-closed');
  }

  const adProvider = loadSource('src/services/adProvider.ts');
  if (!adProvider.includes('canRequestAdsAfterConsent')) {
    console.error('  ✗ adProvider must gate on UMP consent');
  } else {
    console.log('  ✓ adProvider consent gate');
  }

  const adsBootstrap = loadSource('src/services/adsPrivacyBootstrap.ts');
  if (adsBootstrap.includes('resolveAttBeforeAdsInitialization')) {
    console.error('  ✗ ads bootstrap must not request ATT');
  } else {
    console.log('  ✓ ads bootstrap has no ATT');
  }

  if (!adProvider.includes('buildRewardedAdRequestOptions')) {
    console.error('  ✗ adProvider must apply non-personalized ad requests on iOS');
  } else if (!adProvider.includes("Platform.OS === 'ios'")) {
    console.error('  ✗ adProvider must gate NPA to iOS');
  } else {
    console.log('  ✓ adProvider iOS NPA request options');
  }

  const appTsx = loadSource('App.tsx');
  if (!appTsx.includes('initializeAdsPrivacyStack')) {
    console.error('  ✗ App must use initializeAdsPrivacyStack');
  } else {
    console.log('  ✓ App ads privacy bootstrap');
  }

  const failed = productionErrors.length + internalErrors.length;
  console.log(`\nResult: ${failed === 0 ? 'PASS' : 'FAIL'} (${failed} failed)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

function loadSource(relativePath: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

main();
