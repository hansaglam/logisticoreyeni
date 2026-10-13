/**
 * Live progression write decision. Reads the existing canonical snapshot.
 * Does not open a second Firestore listener and does not write the save.
 */

import {
  isCanonicalProgressionWriteAuthorityAllowed,
  normalizeClientProgressionWriteSource,
  resolveCanonicalProgressionWrite,
  type ClientProgressionWriteSource,
  type ProgressionWriteResolution,
} from '../domain/canonicalProgressionWriteAuthority';
import { resolveEffectiveCompanyProgression } from '../domain/canonicalProgressionReadAuthority';
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

const loggedDiagnostics = new Set<string>();

function diagnosticsEnabled(): boolean {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  const internal =
    typeof process !== 'undefined' && process.env.LOGISTICORE_BUILD_PROFILE === 'internal';
  return dev || internal;
}

export function noteCanonicalProgressionWriteDiagnostic(resolution: ProgressionWriteResolution): void {
  if (resolution.decision === 'LOCAL_AUTHORITATIVE' || !diagnosticsEnabled()) return;
  const key = `${resolution.decision}:${resolution.source}:${resolution.diagnostic}`;
  if (loggedDiagnostics.has(key)) return;
  loggedDiagnostics.add(key);
  console.info(
    '[canonical-progression-write]',
    resolution.diagnostic,
    resolution.source,
    resolution.decision,
  );
}

export function resolveLiveCanonicalProgressionWrite(
  player: LocalProgression,
  source: ClientProgressionWriteSource | string | undefined,
): ProgressionWriteResolution {
  const account = getAccountStatus();
  const signedIn = account.isReady && !account.isAnonymous && Boolean(account.uid);
  const auth = !account.isReady ? 'loading' : signedIn ? 'signed-in' : 'guest';
  const writeGateEnabled = isCanonicalProgressionWriteAuthorityAllowed();
  const progression = resolveEffectiveCompanyProgression(
    {
      gateEnabled: writeGateEnabled,
      auth,
      uid: signedIn ? account.uid : null,
      snapshot: getCanonicalProgressionReadSnapshot(),
    },
    player,
  );
  const resolution = resolveCanonicalProgressionWrite({
    writeGateEnabled,
    progression,
    source: normalizeClientProgressionWriteSource(source),
  });
  noteCanonicalProgressionWriteDiagnostic(resolution);
  return resolution;
}
