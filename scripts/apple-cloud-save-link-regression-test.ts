/**
 * Apple account link → cloud save ownership/sync regression.
 * Run: npx tsx scripts/apple-cloud-save-link-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import {
  getAccountConnectionHeroCopy,
  isCloudProtectedState,
  resolveAccountConnectionState,
} from '../src/utils/accountConnectionState';
import {
  classifyCloudSaveError,
  createLinkFlowDiagnosticId,
} from '../src/utils/accountLinkFlowLog';
import { resolveCloudSaveDisplayInfo } from '../src/utils/accountCenterCloudStatus';
import { reconcileLocalSaveOwnershipAfterAccountLink } from '../src/utils/cloudSaveOwnership';
import type { CloudSaveStatusState } from '../src/storage/cloudSaveSync';

const ROOT = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(): void {
  console.log('\napple-cloud-save-link-regression-test\n');

  // Ownership
  const preserved = reconcileLocalSaveOwnershipAfterAccountLink({
    previousUid: 'anon-1',
    currentUid: 'anon-1',
    localOwnerUid: 'anon-1',
    providerId: 'apple.com',
  });
  assert(preserved.result === 'uid-preserved', 'UID preserved reconcile');
  assert(preserved.resolvedOwnerUid === 'anon-1', 'resolved owner is current uid');

  const legacy = reconcileLocalSaveOwnershipAfterAccountLink({
    previousUid: 'anon-2',
    currentUid: 'anon-2',
    localOwnerUid: null,
    providerId: 'apple.com',
  });
  assert(legacy.result === 'safe-legacy-claim', 'legacy missing owner safe claim');
  assert(legacy.shouldClaimLocalOwner, 'legacy claim flag');

  const conflict = reconcileLocalSaveOwnershipAfterAccountLink({
    previousUid: 'anon-3',
    currentUid: 'anon-3',
    localOwnerUid: 'other-user',
    providerId: 'apple.com',
  });
  assert(conflict.result === 'conflict', 'foreign owner is conflict');
  assert(!conflict.shouldClaimLocalOwner, 'conflict does not claim');

  // Connection state machine
  const guest = resolveAccountConnectionState({
    authReady: true,
    isAnonymous: true,
    provider: 'guest',
    isLinking: false,
    hasConflict: false,
    cloudStatus: 'disabled',
    lastCloudSaveAt: null,
  });
  assert(guest === 'guest', 'guest state');

  const linkedLocal = resolveAccountConnectionState({
    authReady: true,
    isAnonymous: false,
    provider: 'apple',
    isLinking: false,
    hasConflict: false,
    cloudStatus: 'pending',
    lastCloudSaveAt: null,
  });
  assert(linkedLocal === 'cloud-syncing', 'pending cloud → cloud-syncing');

  const retry = resolveAccountConnectionState({
    authReady: true,
    isAnonymous: false,
    provider: 'apple',
    isLinking: false,
    hasConflict: false,
    cloudStatus: 'failed',
    lastCloudSaveAt: null,
    lastCloudErrorCode: 'unavailable',
  });
  assert(retry === 'sync-retry', 'transient fail → sync-retry');

  const protectedState = resolveAccountConnectionState({
    authReady: true,
    isAnonymous: false,
    provider: 'apple',
    isLinking: false,
    hasConflict: false,
    cloudStatus: 'success',
    lastCloudSaveAt: Date.now(),
  });
  assert(protectedState === 'cloud-protected', 'verified save → cloud-protected');
  assert(isCloudProtectedState(protectedState), 'isCloudProtectedState true');

  const heroRetry = getAccountConnectionHeroCopy('sync-retry');
  assert(
    heroRetry.footnoteTone === 'amber',
    'sync-retry footnote is amber, not green protected',
  );
  assert(
    !heroRetry.footnote?.includes('Bulut kaydı aktif') ||
      Boolean(heroRetry.footnote?.includes('henüz doğrulanmadı')),
    'sync-retry does not claim cloud-protected',
  );

  const perm = classifyCloudSaveError('permission-denied');
  assert(perm.permanent, 'permission-denied is permanent');
  assert(!perm.transient || perm.permanent, 'permission-denied not treated as only transient');

  const transient = classifyCloudSaveError('unavailable');
  assert(transient.transient, 'unavailable is transient');
  assert(!transient.permanent, 'unavailable not permanent');

  assert(createLinkFlowDiagnosticId('apple').startsWith('apple-'), 'diagnostic id prefix');

  // Source contracts
  const authSrc = readSrc('src/services/authService.ts');
  assert(authSrc.includes('getIdToken(true)'), 'force token refresh after link');
  assert(authSrc.includes('waitForCanonicalAuthState'), 'canonical auth wait after link');
  assert(authSrc.includes('account-link-apple'), 'apple force sync trigger');
  assert(authSrc.includes('logAppleLinkFlow'), 'structured apple-link-flow logging');
  assert(authSrc.includes('cloudSyncOk'), 'link result exposes cloudSyncOk');

  const syncSrc = readSrc('src/storage/cloudSaveSync.ts');
  assert(syncSrc.includes('scheduleCloudSaveRetry'), 'retry scheduler exists');
  const appStateLifecycle = readSrc('src/hooks/useAppStateLifecycle.ts');
  assert(syncSrc.includes('retryCloudSaveSyncOnForeground'), 'foreground retry entry point');
  assert(appStateLifecycle.includes('retryCloudSaveSyncOnForeground()'), 'foreground retry hook');
  assert(syncSrc.includes('readBackVerified'), 'read-back gates success');
  assert(syncSrc.includes('syncInFlight'), 'duplicate sync mutex');
  assert(syncSrc.includes('cloudProtected'), 'status exposes cloudProtected');

  const cloudSrc = readSrc('src/services/cloudSaveService.ts');
  assert(cloudSrc.includes('ownerUid'), 'cloud save writes ownerUid');
  assert(cloudSrc.includes('writeBatch'), 'atomic batch write');
  assert(cloudSrc.includes('verifyCloudSaveReadBack'), 'read-back verify helper');
  assert(cloudSrc.includes("users/${uid}/saves/"), 'canonical document path helper');

  const accountCenterSrc = readSrc('src/screens/AccountCenterScreen.tsx');
  const connectionTabSrc = readSrc('src/components/accountCenter/AccountConnectionTab.tsx');
  const baseCloudStatus: CloudSaveStatusState = {
    status: 'failed',
    statusLabel: 'Bağlantı yok',
    uid: 'test-user',
    uidShort: 'test-use',
    lastSyncAt: null,
    lastError: 'Ağ bağlantısı kurulamadı.',
    lastErrorCode: 'unavailable',
    nextRetryAt: null,
    firebaseEnabled: true,
    restoreCandidate: null,
    cloudProtected: false,
  };
  const retryDisplay = resolveCloudSaveDisplayInfo({
    cloudStatus: baseCloudStatus,
    isGuest: false,
    recoveryRequired: false,
    hasAccountConflict: false,
  });
  const guestDisplay = resolveCloudSaveDisplayInfo({
    cloudStatus: { ...baseCloudStatus, status: 'disabled', firebaseEnabled: false },
    isGuest: true,
    recoveryRequired: false,
    hasAccountConflict: false,
  });
  const syncedDisplay = resolveCloudSaveDisplayInfo({
    cloudStatus: {
      ...baseCloudStatus,
      status: 'success',
      statusLabel: 'Bağlı',
      lastSyncAt: Date.now(),
      lastError: null,
      lastErrorCode: null,
      cloudProtected: true,
    },
    isGuest: false,
    recoveryRequired: false,
    hasAccountConflict: false,
  });

  assert(
    accountCenterSrc.includes('resolveCloudSaveDisplayInfo') &&
      accountCenterSrc.includes('AccountConnectionTab'),
    'Account Center uses canonical connection display state',
  );
  assert(
    retryDisplay.ctaLabel === 'Şimdi Senkronize Et' &&
      accountCenterSrc.includes('vm.handleManualSync()') &&
      connectionTabSrc.includes("? 'Senkronize Et'"),
    'manual cloud sync CTA is wired',
  );
  assert(
    retryDisplay.badgeVariant === 'amber' && guestDisplay.badgeVariant === 'amber',
    'unverified cloud states use amber treatment',
  );
  assert(
    !/Hesabın güvende · Bulut kaydı aktif/.test(
      connectionTabSrc,
    ),
    'hardcoded green protected footnote removed from static path',
  );
  assert(
    syncedDisplay.key === 'synced' &&
      syncedDisplay.badgeVariant === 'success' &&
      connectionTabSrc.includes("cloudDisplay.key === 'synced'"),
    'verified cloud state drives success treatment',
  );

  const rulesSrc = readSrc('firestore.rules');
  assert(rulesSrc.includes('ownerUid'), 'rules source mentions ownerUid');
  assert(
    rulesSrc.includes('request.resource.data.ownerUid == userId'),
    'cloud save create/update enforces ownerUid',
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
