/**
 * Lightweight Help & Guide navigation (no tutorial overlays).
 * Ephemeral pending section — not part of save payload.
 */

import type { HelpGuideSectionId } from './helpGuideSections';

let pendingHelpGuideSection: HelpGuideSectionId | null = null;

function requestHelpNavigation(): void {
  // Lazy require keeps Node regression scripts from pulling RN/Expo natives.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useGameStore } = require('../store/gameStore') as typeof import('../store/gameStore');
  useGameStore.setState({
    navigationRequest: { tab: 'more' },
    pendingMoreSubRoute: 'help',
  });
}

export function openHelpGuide(sectionId?: HelpGuideSectionId | null): void {
  pendingHelpGuideSection = sectionId ?? null;
  requestHelpNavigation();
}

/** Consume once when HelpGuideScreen mounts / remounts. */
export function consumePendingHelpGuideSection(): HelpGuideSectionId | null {
  const next = pendingHelpGuideSection;
  pendingHelpGuideSection = null;
  return next;
}

/** Test/dev helper — does not navigate. */
export function __setPendingHelpGuideSectionForTests(
  sectionId: HelpGuideSectionId | null,
): void {
  pendingHelpGuideSection = sectionId;
}
