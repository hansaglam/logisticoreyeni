import type { GameIconName } from '../../theme/icons';
import type { QuickAccessAction } from '../../navigation/quickAccessTypes';

export type ManagementTone =
  | 'cyan'
  | 'blue'
  | 'amber'
  | 'green'
  | 'purple'
  | 'orange'
  | 'gold'
  | 'slate';

export interface ManagementItem {
  id: QuickAccessAction;
  title: string;
  subtitle: string;
  icon: GameIconName;
  tone: ManagementTone;
  badge?: number;
  badgeAttention?: boolean;
  accessibilityLabel: string;
  accessibilityHint: string;
}
