/**
 * Reads the existing canonical progression snapshot. Does not open a listener
 * and does not write the save.
 */

import { resolveEffectiveCompanyProgression } from '../domain/canonicalProgressionReadAuthority';
import {
  isCanonicalProgressionEligibilityAllowed,
  resolveProgressionEligibilityAuthority,
  type EffectiveProgressionEligibility,
} from '../domain/canonicalProgressionEligibility';
import { getAccountStatus } from './authService';
import { getCanonicalProgressionReadSnapshot } from './canonicalProgressionService';

type LocalProgression = {
  level?: number;
  companyLevel?: number;
  xp?: number;
  xpToNextLevel?: number;
  totalXp?: number;
  reputation?: number;
} | null;

export function readProgressionEligibility(player: LocalProgression): EffectiveProgressionEligibility {
  const account = getAccountStatus();
  const signedIn = account.isReady && !account.isAnonymous && Boolean(account.uid);
  const auth = !account.isReady ? 'loading' : signedIn ? 'signed-in' : 'guest';
  const eligibilityGateEnabled = isCanonicalProgressionEligibilityAllowed();
  const progression = resolveEffectiveCompanyProgression(
    {
      gateEnabled: eligibilityGateEnabled,
      auth,
      uid: signedIn ? account.uid : null,
      snapshot: getCanonicalProgressionReadSnapshot(),
    },
    player,
  );
  return resolveProgressionEligibilityAuthority({
    eligibilityGateEnabled,
    progression,
    localLevel: Math.max(1, player?.level ?? player?.companyLevel ?? 1),
    localReputation: player?.reputation ?? 0,
  });
}

export function requireClientProgressionLevel(player: LocalProgression):
  | { ok: true; level: number }
  | { ok: false; message: string } {
  const eligibility = readProgressionEligibility(player);
  if (!eligibility.canEvaluate || eligibility.level == null) {
    return {
      ok: false,
      message:
        eligibility.status === 'loading'
          ? 'Şirket ilerlemesi yükleniyor.'
          : 'Şirket ilerlemesi şu an kullanılamıyor.',
    };
  }
  return { ok: true, level: eligibility.level };
}
