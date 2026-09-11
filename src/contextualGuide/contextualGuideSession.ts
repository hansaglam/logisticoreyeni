/**
 * Runtime-only guided tutorial session (not persisted).
 * Distinguishes mandatory first-run vs Help manual replay.
 */

import type { ContextualGuideState } from '../types/game';
import { isContextualGuideAutoShowAllowed } from './contextualGuideSequence';

export type ContextualGuideRunMode = 'mandatory_first_run' | 'manual_replay' | 'none';

type SessionState = {
  replayActive: boolean;
  replaySnapshot: ContextualGuideState | null;
  /** Allows one programmatic tab change while mandatory lock is on. */
  navigationBypass: boolean;
};

let session: SessionState = {
  replayActive: false,
  replaySnapshot: null,
  navigationBypass: false,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeContextualGuideSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getContextualGuideSessionSnapshot(): Readonly<SessionState> {
  return session;
}

export function startContextualGuideManualReplay(snapshot: ContextualGuideState): void {
  session = {
    replayActive: true,
    replaySnapshot: {
      version: snapshot.version,
      status: snapshot.status,
      completedCardIds: [...snapshot.completedCardIds],
      dismissedCardIds: [...snapshot.dismissedCardIds],
    },
    navigationBypass: false,
  };
  emit();
}

/** Ends replay and returns prior durable guide state to restore (if any). */
export function endContextualGuideManualReplay(): ContextualGuideState | null {
  const prior = session.replaySnapshot;
  session = {
    replayActive: false,
    replaySnapshot: null,
    navigationBypass: false,
  };
  emit();
  return prior;
}

export function clearContextualGuideManualReplay(): void {
  session = {
    replayActive: false,
    replaySnapshot: null,
    navigationBypass: false,
  };
  emit();
}

export function isContextualGuideManualReplayActive(): boolean {
  return session.replayActive;
}

export function resolveContextualGuideRunMode(
  guide: { status?: string } | null | undefined,
): ContextualGuideRunMode {
  if (!isContextualGuideAutoShowAllowed(guide as { status: 'eligible' | 'active' })) {
    return 'none';
  }
  return session.replayActive ? 'manual_replay' : 'mandatory_first_run';
}

export function isContextualGuideInteractionLocked(
  guide: { status?: string } | null | undefined,
): boolean {
  return resolveContextualGuideRunMode(guide) !== 'none';
}

export function isContextualGuideMandatoryLocked(
  guide: { status?: string } | null | undefined,
): boolean {
  return resolveContextualGuideRunMode(guide) === 'mandatory_first_run';
}

/** Consume one-shot navigation bypass for programmatic tab switches. */
export function allowContextualGuideNavigationBypass(): void {
  session = { ...session, navigationBypass: true };
  emit();
}

export function consumeContextualGuideNavigationBypass(): boolean {
  if (!session.navigationBypass) return false;
  session = { ...session, navigationBypass: false };
  emit();
  return true;
}

export function peekContextualGuideNavigationBypass(): boolean {
  return session.navigationBypass;
}

/**
 * Durable guide for save serialization.
 * While a Help replay is active, persist the pre-replay snapshot so a crash
 * mid-replay does not permanently undo completion.
 */
export function getDurableContextualGuideForSave(
  liveGuide: ContextualGuideState | null | undefined,
): ContextualGuideState | null | undefined {
  if (session.replayActive && session.replaySnapshot) {
    return session.replaySnapshot;
  }
  return liveGuide;
}

/** Test helper. */
export function __resetContextualGuideSessionForTests(): void {
  session = {
    replayActive: false,
    replaySnapshot: null,
    navigationBypass: false,
  };
  emit();
}
