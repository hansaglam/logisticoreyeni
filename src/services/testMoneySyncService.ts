/**
 * TEST-ONLY: realtime sync of Firestore users/{uid}.money → player.money.
 *
 * Production economy remains local/save-authoritative. This channel exists so
 * Internal Testing can inject cash from the Firestore Console without reinstall.
 *
 * Loop prevention: while enabled, cloud profile writes omit `money` so autosave
 * cannot overwrite a console edit. Apply only when remote money differs from the
 * last accepted override for this uid (survives restart via AsyncStorage).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { isTestMoneySyncEnabled, parseRemoteTestMoney } from '../config/testMoneySync';
import { bumpSaveContentRevision } from '../storage/saveRevision';
import { saveGameState } from '../storage/saveGame';
import { syncLocalSaveToCloud } from '../storage/cloudSaveSync';
import { useGameStore } from '../store/gameStore';
import { getFirestoreSafe, isFirebaseEnabled } from './firebase';
import { isVehicleMarketplaceOperationActive } from './marketplaceOperationLock';
import { subscribeAuthState } from './authService';

const LOG_PREFIX = '[TEST_MONEY_SYNC]';
const LAST_APPLIED_KEY_PREFIX = '@logisticore/testMoneySync/lastApplied:';

let acceptedRemoteMoney: number | null = null;
let lastAppliedRemoteMoney: number | null = null;
let pendingRemoteMoney: number | null = null;
let authUnsubscribe: (() => void) | null = null;
let docUnsubscribe: Unsubscribe | null = null;
let activeUid: string | null = null;
let applyInFlight = false;
let lastAppliedLoadedForUid: string | null = null;

function lastAppliedStorageKey(uid: string): string {
  return `${LAST_APPLIED_KEY_PREFIX}${uid}`;
}

async function loadLastAppliedRemoteMoney(uid: string): Promise<void> {
  if (lastAppliedLoadedForUid === uid) {
    return;
  }
  try {
    const raw = await AsyncStorage.getItem(lastAppliedStorageKey(uid));
    if (raw != null && raw.length > 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        lastAppliedRemoteMoney = parsed;
        acceptedRemoteMoney = parsed;
      }
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} failed to load lastApplied`, error);
  }
  lastAppliedLoadedForUid = uid;
}

async function persistLastAppliedRemoteMoney(uid: string, money: number): Promise<void> {
  try {
    await AsyncStorage.setItem(lastAppliedStorageKey(uid), String(money));
  } catch (error) {
    console.warn(`${LOG_PREFIX} failed to persist lastApplied`, error);
  }
}

export function getAcceptedTestRemoteMoney(): number | null {
  return acceptedRemoteMoney;
}

export function shouldOmitProfileMoneyWrite(): boolean {
  return isTestMoneySyncEnabled();
}

export { parseRemoteTestMoney };

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

async function applyRemoteMoney(uid: string, remoteMoney: number): Promise<void> {
  if (isVehicleMarketplaceOperationActive()) {
    console.info(`${LOG_PREFIX} deferred — marketplace purchase in flight`);
    return;
  }
  if (applyInFlight) {
    pendingRemoteMoney = remoteMoney;
    return;
  }

  await loadLastAppliedRemoteMoney(uid);

  // Same console value already applied for this uid — do not clobber local earnings.
  if (lastAppliedRemoteMoney != null && nearlyEqual(lastAppliedRemoteMoney, remoteMoney)) {
    pendingRemoteMoney = null;
    return;
  }

  const state = useGameStore.getState();
  if (!state.isGameReady) {
    pendingRemoteMoney = remoteMoney;
    console.info(`${LOG_PREFIX} deferred — game not ready yet money=${remoteMoney}`);
    return;
  }

  const localBefore = state.player?.money ?? 0;
  if (nearlyEqual(localBefore, remoteMoney)) {
    lastAppliedRemoteMoney = remoteMoney;
    acceptedRemoteMoney = remoteMoney;
    pendingRemoteMoney = null;
    await persistLastAppliedRemoteMoney(uid, remoteMoney);
    return;
  }

  applyInFlight = true;
  pendingRemoteMoney = null;
  try {
    console.info(`${LOG_PREFIX} remote money received=${remoteMoney}`);
    console.info(`${LOG_PREFIX} local before=${localBefore}`);

    acceptedRemoteMoney = remoteMoney;
    lastAppliedRemoteMoney = remoteMoney;

    useGameStore.setState({
      player: {
        ...state.player,
        money: remoteMoney,
      },
    });
    bumpSaveContentRevision();

    const afterState = useGameStore.getState();
    const localAfter = afterState.player?.money ?? 0;
    console.info(`${LOG_PREFIX} local after=${localAfter}`);

    const persisted = await saveGameState(afterState, { ownerUid: uid });
    console.info(`${LOG_PREFIX} persisted=${persisted}`);
    await persistLastAppliedRemoteMoney(uid, remoteMoney);

    // Keep saves/current aligned so cloud restore cannot revive stale cash.
    void syncLocalSaveToCloud('manual', {
      force: true,
      state: useGameStore.getState(),
      ownerUid: uid,
    });
  } finally {
    applyInFlight = false;
    if (
      pendingRemoteMoney != null &&
      (lastAppliedRemoteMoney == null ||
        !nearlyEqual(pendingRemoteMoney, lastAppliedRemoteMoney))
    ) {
      const next = pendingRemoteMoney;
      pendingRemoteMoney = null;
      void applyRemoteMoney(uid, next);
    }
  }
}

function detachDocumentListener(): void {
  if (docUnsubscribe) {
    docUnsubscribe();
    docUnsubscribe = null;
  }
  activeUid = null;
}

function attachDocumentListener(uid: string): void {
  if (activeUid === uid && docUnsubscribe) {
    return;
  }
  detachDocumentListener();

  const db = getFirestoreSafe();
  if (!db) {
    console.warn(`${LOG_PREFIX} firestore unavailable`);
    return;
  }

  activeUid = uid;
  console.info(`${LOG_PREFIX} listener attached uid=${uid}`);
  void loadLastAppliedRemoteMoney(uid);

  const userRef = doc(db, 'users', uid);
  docUnsubscribe = onSnapshot(
    userRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        console.info(`${LOG_PREFIX} remote doc missing — ignored`);
        return;
      }
      const remoteMoney = parseRemoteTestMoney(snapshot.data()?.money);
      if (remoteMoney == null) {
        console.info(`${LOG_PREFIX} invalid/missing money field — ignored`);
        return;
      }
      void applyRemoteMoney(uid, remoteMoney);
    },
    (error) => {
      console.warn(`${LOG_PREFIX} listener error`, error);
    },
  );
}

export function flushPendingTestMoneySync(): void {
  if (!isTestMoneySyncEnabled() || !activeUid || pendingRemoteMoney == null) {
    return;
  }
  void applyRemoteMoney(activeUid, pendingRemoteMoney);
}

export function startTestMoneySync(): () => void {
  if (!isTestMoneySyncEnabled()) {
    return () => {};
  }
  if (!isFirebaseEnabled()) {
    console.warn(`${LOG_PREFIX} disabled — firebase not enabled`);
    return () => {};
  }
  if (authUnsubscribe) {
    flushPendingTestMoneySync();
    return stopTestMoneySync;
  }

  console.info(`${LOG_PREFIX} enabled — waiting for auth`);
  authUnsubscribe = subscribeAuthState((user) => {
    if (!user?.uid) {
      console.info(`${LOG_PREFIX} auth cleared — listener detached`);
      detachDocumentListener();
      acceptedRemoteMoney = null;
      lastAppliedRemoteMoney = null;
      pendingRemoteMoney = null;
      lastAppliedLoadedForUid = null;
      return;
    }
    attachDocumentListener(user.uid);
  });

  return stopTestMoneySync;
}

export function stopTestMoneySync(): void {
  detachDocumentListener();
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  acceptedRemoteMoney = null;
  lastAppliedRemoteMoney = null;
  pendingRemoteMoney = null;
  lastAppliedLoadedForUid = null;
}

export function resetTestMoneySyncStateForTests(): void {
  stopTestMoneySync();
  applyInFlight = false;
}
