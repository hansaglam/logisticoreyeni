export const colors = {
  background: '#050A12',
  background2: '#07111F',
  surface: '#0B1220',
  surface2: '#0F172A',
  card: '#111827',
  cardSoft: '#162033',
  border: 'rgba(148, 163, 184, 0.16)',
  borderStrong: 'rgba(148, 163, 184, 0.28)',

  textPrimary: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  textDisabled: '#64748B',

  accentBlue: '#3B82F6',
  accentBlueSoft: 'rgba(59, 130, 246, 0.16)',

  accentAmber: '#F59E0B',
  accentAmberSoft: 'rgba(245, 158, 11, 0.16)',

  success: '#22C55E',
  successSoft: 'rgba(34, 197, 94, 0.16)',

  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.16)',

  danger: '#EF4444',
  dangerSoft: 'rgba(239, 68, 68, 0.16)',

  info: '#38BDF8',
  infoSoft: 'rgba(56, 189, 248, 0.16)',

  tabBarBg: '#0B1220',
  tabBarBorder: 'rgba(148, 163, 184, 0.16)',
} as const;

export type ColorToken = keyof typeof colors;
