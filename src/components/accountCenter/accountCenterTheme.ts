import { colors } from '../../theme';

export const ACCOUNT_PAGE_PADDING = 16;
export const ACCOUNT_SECTION_GAP = 14;
export const ACCOUNT_CARD_PADDING = 14;
export const ACCOUNT_ROW_GAP = 8;
export const ACCOUNT_HEADER_GAP = 10;

export const accountCardStyle = {
  borderColor: 'rgba(56, 129, 200, 0.22)',
  backgroundColor: '#0A1628',
  borderRadius: 16,
} as const;

export const accountSectionTitleColor = colors.textPrimary;
export const accountLabelColor = colors.textSecondary;
export const accountValueColor = colors.textPrimary;

/** @deprecated use ACCOUNT_PAGE_PADDING */
export const ACCOUNT_OUTER_GAP = ACCOUNT_PAGE_PADDING;
