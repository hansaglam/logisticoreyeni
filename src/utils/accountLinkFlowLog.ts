/**
 * Structured Apple link + post-link cloud save diagnostics.
 * Hassas değer (token/nonce/email/UID) loglanmaz — yalnız presence/boolean/code.
 */

let diagnosticSeq = 0;

export function createLinkFlowDiagnosticId(prefix = 'apple'): string {
  diagnosticSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${diagnosticSeq}`;
}

export type AppleLinkFlowStage =
  | 'apple-request-start'
  | 'apple-credential-received'
  | 'firebase-credential-created'
  | 'firebase-link-start'
  | 'firebase-link-success'
  | 'token-refresh'
  | 'owner-reconcile'
  | 'profile-write'
  | 'save-write'
  | 'read-back-verify'
  | 'metadata-commit'
  | 'cloud-ready'
  | 'link-failed'
  | 'cloud-failed';

export interface AppleLinkFlowLog {
  stage: AppleLinkFlowStage;
  previousUidPresent?: boolean;
  resultingUidPresent?: boolean;
  uidPreserved?: boolean;
  previousUserAnonymous?: boolean | null;
  resultingUserAnonymous?: boolean | null;
  providerIds?: string[];
  appleProviderLinked?: boolean;
  firebaseErrorCode?: string | null;
  nativeErrorCode?: string | null;
  hasIdentityToken?: boolean;
  hasAuthorizationCode?: boolean;
  hasRawNonce?: boolean;
  diagnosticId: string;
}

export type CloudSaveAfterLinkStage =
  | 'trigger'
  | 'auth-gate'
  | 'payload-prepare'
  | 'write-start'
  | 'write-success'
  | 'write-failed'
  | 'read-back-success'
  | 'read-back-failed'
  | 'metadata-commit'
  | 'cloud-ready'
  | 'retry-scheduled';

export interface CloudSaveAfterLinkLog {
  stage: CloudSaveAfterLinkStage;
  trigger?: string;
  authReady?: boolean;
  authUidPresent?: boolean;
  authUserAnonymous?: boolean | null;
  providerIds?: string[];
  localOwnerUidPresent?: boolean;
  ownerMatchesAuth?: boolean;
  documentPath?: string;
  payloadPrepared?: boolean;
  writeStarted?: boolean;
  writeSucceeded?: boolean;
  readBackSucceeded?: boolean;
  firebaseErrorCode?: string | null;
  retryScheduled?: boolean;
  diagnosticId: string;
}

function safeLog(tag: string, payload: Record<string, unknown>): void {
  try {
    console.log(tag, payload);
  } catch {
    // ignore
  }
}

export function logAppleLinkFlow(payload: AppleLinkFlowLog): void {
  safeLog('[apple-link-flow]', { ...payload });
}

export function logCloudSaveAfterLink(payload: CloudSaveAfterLinkLog): void {
  safeLog('[cloud-save-after-link]', { ...payload });
}

export function classifyCloudSaveError(errorCodeOrMessage: string | null | undefined): {
  code: string;
  permanent: boolean;
  transient: boolean;
} {
  const raw = (errorCodeOrMessage ?? 'unknown').toLowerCase();
  const code =
    raw.includes('permission-denied') || raw.includes('permission_denied')
      ? 'permission-denied'
      : raw.includes('unauthenticated')
        ? 'unauthenticated'
        : raw.includes('owner-mismatch') || raw.includes('owner_mismatch')
          ? 'owner-mismatch'
          : raw.includes('invalid-argument')
            ? 'invalid-argument'
            : raw.includes('save-too-large')
              ? 'save-too-large'
              : raw.includes('unavailable')
                ? 'unavailable'
                : raw.includes('deadline')
                  ? 'deadline-exceeded'
                  : raw.includes('network') || raw.includes('offline')
                    ? 'network-request-failed'
                    : raw.includes('aborted')
                      ? 'aborted'
                      : raw.includes('meta-status')
                        ? 'meta-status-write-failed'
                        : raw.includes('read-back')
                          ? 'read-back-failed'
                          : raw.slice(0, 64) || 'unknown';

  const permanent = [
    'permission-denied',
    'unauthenticated',
    'owner-mismatch',
    'invalid-argument',
    'save-too-large',
  ].includes(code);

  const transient = [
    'unavailable',
    'deadline-exceeded',
    'network-request-failed',
    'aborted',
    'meta-status-write-failed',
    'read-back-failed',
  ].includes(code);

  return { code, permanent, transient: transient || !permanent };
}
