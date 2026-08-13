/**
 * Save flow state machine — separate from Firebase auth lifecycle.
 *
 * idle → checking → restoring | uploading | conflict → ready | error
 */

export type AccountSaveFlowPhase =
  | 'idle'
  | 'checking'
  | 'restoring'
  | 'conflict'
  | 'uploading'
  | 'ready'
  | 'error';

export type AccountAuthPhase = 'idle' | 'authenticating' | 'authenticated' | 'error';

let savePhase: AccountSaveFlowPhase = 'idle';
let authPhase: AccountAuthPhase = 'idle';

export function getAccountSaveFlowPhase(): AccountSaveFlowPhase {
  return savePhase;
}

export function setAccountSaveFlowPhase(phase: AccountSaveFlowPhase): void {
  savePhase = phase;
}

export function getAccountAuthPhase(): AccountAuthPhase {
  return authPhase;
}

export function setAccountAuthPhase(phase: AccountAuthPhase): void {
  authPhase = phase;
}

export function resetAccountSaveFlowState(): void {
  savePhase = 'idle';
  authPhase = 'idle';
}

/** Blocks automatic cloud upload until login/restore flow completes. */
export function isAutomaticCloudUploadBlockedBySaveFlow(): boolean {
  return (
    savePhase === 'checking' ||
    savePhase === 'restoring' ||
    savePhase === 'conflict' ||
    savePhase === 'uploading' ||
    savePhase === 'error'
  );
}
