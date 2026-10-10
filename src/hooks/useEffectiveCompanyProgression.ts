import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  isCanonicalProgressionReadAuthorityAllowed,
  resolveEffectiveCompanyProgression,
  type EffectiveCompanyProgression,
} from '../domain/canonicalProgressionReadAuthority';
import { getAccountStatus, subscribeAuthState } from '../services/authService';
import {
  bindCanonicalProgressionAccount,
  clearCanonicalProgressionReadState,
  getCanonicalProgressionReadSnapshot,
  subscribeCanonicalProgressionRead,
} from '../services/canonicalProgressionService';

type LocalPlayer = {
  level?: number;
  companyLevel?: number;
  xp?: number;
  xpToNextLevel?: number;
  totalXp?: number;
  reputation?: number;
} | null;

export function useEffectiveCompanyProgression(player: LocalPlayer): EffectiveCompanyProgression {
  const snapshot = useSyncExternalStore(subscribeCanonicalProgressionRead, getCanonicalProgressionReadSnapshot);
  const [authEpoch, setAuthEpoch] = useState(0);
  useEffect(() => subscribeAuthState(() => setAuthEpoch((value) => value + 1)), []);
  const account = getAccountStatus();
  void authEpoch;
  const signedIn = account.isReady && !account.isAnonymous && Boolean(account.uid);
  const auth = !account.isReady ? 'loading' : signedIn ? 'signed-in' : 'guest';
  useEffect(() => {
    if (!isCanonicalProgressionReadAuthorityAllowed()) {
      clearCanonicalProgressionReadState();
      return;
    }
    bindCanonicalProgressionAccount(signedIn ? account.uid : null, signedIn);
  }, [signedIn, account.uid]);
  return resolveEffectiveCompanyProgression(
    {
      gateEnabled: isCanonicalProgressionReadAuthorityAllowed(),
      auth,
      uid: signedIn ? account.uid : null,
      snapshot,
    },
    player,
  );
}
