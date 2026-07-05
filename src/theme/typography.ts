import type { TextStyle } from 'react-native';

import { colors } from './colors';

export const typography = {
  screenTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 0.3,
  } satisfies TextStyle,

  screenSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    lineHeight: 18,
  } satisfies TextStyle,

  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.2,
  } satisfies TextStyle,

  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  } satisfies TextStyle,

  body: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    lineHeight: 20,
  } satisfies TextStyle,

  bodySmall: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    lineHeight: 17,
  } satisfies TextStyle,

  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  } satisfies TextStyle,

  caption: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    lineHeight: 15,
  } satisfies TextStyle,

  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  } satisfies TextStyle,

  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.2,
  } satisfies TextStyle,

  buttonText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  } satisfies TextStyle,

  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
  } satisfies TextStyle,
} as const;

export type TypographyToken = keyof typeof typography;
