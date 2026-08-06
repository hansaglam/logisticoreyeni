import {
  signInWithCredential,
  signOut,
  type AuthCredential,
} from 'firebase/auth';

import type { SaveGamePayload } from '../storage/saveGame';
import {
  clearAccountSwitchJournal,
  readAccountSwitchJournal,
  writeAccountSwitchJournal,
  type AccountSwitchJournal,
  type AccountSwitchJournalStage,
} from '../storage/accountSwitchJournal';
import type { StoreGameState } from '../types/game';
import { devLog, devWarn } from '../utils/devLog';
import { getFirebaseAuthSafe } from './firebase';
import {
  captureGoogleRollbackCredential,
  clearGoogleSignInSession,
} from './googleAuthService';

export type AccountSwitchStage = AccountSwitchJournalStage | 'idle';

export type LocalOwnerGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'owner-mismatch' | 'owner-missing' | 'switch-in-progress' | 'recovery-required';
    };

interface AccountSwitchMemorySnapshot {
  oldAuthUid: string;
  oldProviderIds: string[];
  localOwnerUid: string;
  localPayload: SaveGamePayload;
  gameState: StoreGameState;
  rollbackCredential: AuthCredential | null;
  targetCredential: AuthCredential | null;
  targetUid: string | null;
  provider: 'google' | 'apple' | 'guest';
  startedAt: number;
}

let currentStage: AccountSwitchStage = 'idle';
let inFlight = false;
let memorySnapshot: AccountSwitchMemorySnapshot | null = null;

function setStage(stage: AccountSwitchStage, reason: string): void {
  currentStage = stage;
  if (__DEV__) {
    devLog('[account-switch-stage]', { stage, reason });
  }
}

async function updateJournal(
  patch: Partial<AccountSwitchJournal>,
): Promise<AccountSwitchJournal | null> {
  const existing = await readAccountSwitchJournal();
  if (!existing) return null;
  const next: AccountSwitchJournal = { ...existing, ...patch };
  await writeAccountSwitchJournal(next);
  return next;
}

export function getAccountSwitchStage(): AccountSwitchStage {
  return currentStage;
}

export function isAccountSwitchInProgress(): boolean {
  return inFlight || currentStage === 'recovery-required';
}

export async function isCloudSyncBlockedByAccountSwitch(): Promise<boolean> {
  const journal = await readAccountSwitchJournal();
  if (!journal) return inFlight;
  if (journal.commitCompleted) return false;
  if (journal.rollbackRequired || journal.stage === 'recovery-required') {
    return true;
  }
  return !journal.commitCompleted;
}

export async function isAccountSwitchRecoveryRequired(): Promise<boolean> {
  const journal = await readAccountSwitchJournal();
  return Boolean(
    journal &&
      !journal.commitCompleted &&
      (journal.rollbackRequired || journal.stage === 'recovery-required'),
  );
}

export function assertLocalSaveOwnerMatchesAuth(
  localOwnerUid: string | undefined,
  authUid: string | null,
): LocalOwnerGuardResult {
  if (isAccountSwitchInProgress()) {
    return { ok: false, reason: 'switch-in-progress' };
  }
  if (currentStage === 'recovery-required') {
    return { ok: false, reason: 'recovery-required' };
  }
  if (!authUid) {
    return { ok: false, reason: 'owner-missing' };
  }
  if (!localOwnerUid) {
    return { ok: false, reason: 'owner-missing' };
  }
  if (localOwnerUid !== authUid) {
    return { ok: false, reason: 'owner-mismatch' };
  }
  return { ok: true };
}

export async function prepareAccountSwitch(input: {
  provider: 'google' | 'apple' | 'guest';
  oldUid: string;
  oldProviderIds: string[];
  localOwnerUid: string;
  localPayload: SaveGamePayload;
  gameState: StoreGameState;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (inFlight) {
    return { ok: false, reason: 'switch-already-in-progress' };
  }
  inFlight = true;
  setStage('preparing', 'snapshot');
  const rollbackCredential =
    input.provider === 'google' ? await captureGoogleRollbackCredential() : null;
  const startedAt = Date.now();
  memorySnapshot = {
    oldAuthUid: input.oldUid,
    oldProviderIds: input.oldProviderIds,
    localOwnerUid: input.localOwnerUid,
    localPayload: input.localPayload,
    gameState: structuredClone(input.gameState),
    rollbackCredential,
    targetCredential: null,
    targetUid: null,
    provider: input.provider,
    startedAt,
  };
  await writeAccountSwitchJournal({
    stage: 'preparing',
    oldUid: input.oldUid,
    localOwnerUid: input.localOwnerUid,
    oldProviderIds: input.oldProviderIds,
    provider: input.provider,
    startedAt,
    commitCompleted: false,
    rollbackRequired: false,
  });
  return { ok: true };
}

export async function markAccountSwitchSelectingProvider(): Promise<void> {
  setStage('selecting-provider', 'provider-picker');
  await updateJournal({ stage: 'selecting-provider' });
}

export async function markAccountSwitchTargetAuthenticated(
  targetUid: string,
  targetCredential: AuthCredential,
): Promise<void> {
  if (!memorySnapshot) return;
  memorySnapshot.targetUid = targetUid;
  memorySnapshot.targetCredential = targetCredential;
  setStage('auth-switched-pending-validation', 'target-auth');
  await updateJournal({
    stage: 'auth-switched-pending-validation',
    targetUid,
  });
}

export async function markAccountSwitchAwaitingUserChoice(): Promise<void> {
  setStage('awaiting-user-choice', 'user-choice');
  await updateJournal({ stage: 'awaiting-user-choice' });
}

export async function abortAccountSwitchBeforeAuth(reason: string): Promise<void> {
  setStage('failed', reason);
  await clearAccountSwitchJournal();
  memorySnapshot = null;
  inFlight = false;
}

export async function rollbackAccountSwitch(
  reason = 'rollback',
): Promise<{ ok: true; restoredAuth: boolean } | { ok: false; recoveryRequired: true }> {
  const snapshot = memorySnapshot;
  const journal = await readAccountSwitchJournal();
  setStage('rolling-back', reason);
  if (journal) {
    await updateJournal({ stage: 'rolling-back', rollbackRequired: true });
  }

  if (snapshot) {
    try {
      const { useGameStore } = await import('../store/gameStore');
      const { saveGameState } = await import('../storage/saveGame');
      useGameStore.setState(snapshot.gameState);
      await saveGameState(snapshot.gameState, {
        ownerUid: snapshot.localOwnerUid,
      });
    } catch (error) {
      devWarn('[account-switch] local restore failed', error);
    }
  }

  const auth = getFirebaseAuthSafe();
  let restoredAuth = false;
  if (auth && snapshot) {
    try {
      if (
        snapshot.rollbackCredential &&
        auth.currentUser?.uid !== snapshot.oldAuthUid
      ) {
        const restored = await signInWithCredential(
          auth,
          snapshot.rollbackCredential,
        );
        restoredAuth = restored.user.uid === snapshot.oldAuthUid;
      } else if (
        snapshot.oldProviderIds.length === 0 ||
        snapshot.provider === 'guest'
      ) {
        await signOut(auth);
        const { initAnonymousAuth } = await import('./authService');
        const guest = await initAnonymousAuth();
        restoredAuth = guest?.uid === snapshot.oldAuthUid;
      } else if (auth.currentUser?.uid === snapshot.oldAuthUid) {
        restoredAuth = true;
      }
    } catch (error) {
      devWarn('[account-switch] auth rollback failed', error);
    }
  }

  if (!restoredAuth && snapshot && auth?.currentUser?.uid !== snapshot.oldAuthUid) {
    setStage('recovery-required', 'auth-restore-failed');
    await updateJournal({
      stage: 'recovery-required',
      rollbackRequired: true,
    });
    await clearGoogleSignInSession();
    memorySnapshot = null;
    inFlight = true;
    return { ok: false, recoveryRequired: true };
  }

  await clearAccountSwitchJournal();
  memorySnapshot = null;
  inFlight = false;
  setStage('idle', 'rollback-complete');
  return { ok: true, restoredAuth };
}

export async function commitAccountSwitch(input: {
  targetUid: string;
  bindLocalProgress: boolean;
  newGame?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const snapshot = memorySnapshot;
  const journal = await readAccountSwitchJournal();
  if (!snapshot) {
    return { ok: false, reason: 'missing-switch-snapshot' };
  }
  setStage('committing', 'commit');
  await updateJournal({
    stage: 'committing',
    targetUid: input.targetUid,
  });

  const { useGameStore } = await import('../store/gameStore');
  const { saveGameState } = await import('../storage/saveGame');
  const { syncLocalSaveToCloud } = await import('../storage/cloudSaveSync');

  try {
    if (input.newGame) {
      await useGameStore.getState().clearSave();
      await useGameStore.getState().saveGame();
    }

    const state = useGameStore.getState();
    await saveGameState(state, { ownerUid: input.targetUid });

    if (input.bindLocalProgress || input.newGame) {
      const synced = await syncLocalSaveToCloud('manual', {
        force: true,
        state,
        ownerUid: input.targetUid,
      });
      if (!synced) {
        return { ok: false, reason: 'cloud-sync-failed' };
      }
    }

    await writeAccountSwitchJournal({
      stage: 'completed',
      oldUid: snapshot.oldAuthUid,
      targetUid: input.targetUid,
      localOwnerUid: input.targetUid,
      oldProviderIds: snapshot.oldProviderIds,
      provider: snapshot.provider,
      startedAt: journal?.startedAt ?? snapshot.startedAt,
      commitCompleted: true,
      rollbackRequired: false,
    });
    await clearAccountSwitchJournal();
    memorySnapshot = null;
    inFlight = false;
    setStage('completed', 'committed');
    setStage('idle', 'finished');
    return { ok: true };
  } catch (error) {
    devWarn('[account-switch] commit failed', error);
    return { ok: false, reason: 'commit-failed' };
  }
}

export async function resolveInterruptedAccountSwitchOnStartup(): Promise<
  'none' | 'rolled-back' | 'recovery-required'
> {
  const journal = await readAccountSwitchJournal();
  if (!journal || journal.commitCompleted) {
    return 'none';
  }
  if (journal.stage === 'recovery-required' || journal.rollbackRequired) {
    setStage('recovery-required', 'journal-recovery');
    inFlight = true;
    return 'recovery-required';
  }
  const rollback = await rollbackAccountSwitch('app-kill-recovery');
  return rollback.ok ? 'rolled-back' : 'recovery-required';
}

export function resetAccountSwitchRuntime(): void {
  memorySnapshot = null;
  inFlight = false;
  currentStage = 'idle';
}

export async function finalizeAccountSwitchJournal(): Promise<void> {
  await clearAccountSwitchJournal();
  memorySnapshot = null;
  inFlight = false;
  setStage('idle', 'finalized');
}
