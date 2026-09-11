/**
 * Optional icon map for contextual guide cards — presentation only.
 */

import type { ContextualGuideCardId } from '../types/game';
import type { GameIconName } from '../theme/icons';

export const CONTEXTUAL_GUIDE_CARD_ICONS: Record<ContextualGuideCardId, GameIconName> = {
  welcome: 'map',
  choose_contract: 'contract',
  manage_fleet: 'truck',
  follow_route: 'route',
  need_help: 'help',
};

export function getContextualGuideCardIcon(
  cardId: ContextualGuideCardId,
): GameIconName {
  return CONTEXTUAL_GUIDE_CARD_ICONS[cardId];
}
