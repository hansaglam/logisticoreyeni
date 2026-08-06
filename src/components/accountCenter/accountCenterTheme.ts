import { colors, spacing } from '../../theme';

export const ACCOUNT_OUTER_GAP = spacing.lg;
export const ACCOUNT_SECTION_GAP = spacing.lg;
export const ACCOUNT_CARD_PADDING = spacing.lg;
export const ACCOUNT_ROW_GAP = spacing.sm + 2;

export const accountCardStyle = {
  borderColor: 'rgba(56, 129, 200, 0.22)',
  backgroundColor: '#0A1628',
  borderRadius: 18,
} as const;

export const accountSectionTitleColor = colors.textPrimary;
export const accountLabelColor = colors.textSecondary;
export const accountValueColor = colors.textPrimary;
