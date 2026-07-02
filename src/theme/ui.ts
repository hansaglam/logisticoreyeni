import { Platform, StatusBar } from 'react-native';

import { BASE_TAB_HEIGHT, EXTRA_BOTTOM_SPACE } from '../constants/layout';

export const UI = {
  colors: {
    background: '#070A12',
    card: '#111827',
    cardAlt: '#121826',
    border: '#1F2A3C',
    primary: '#F59E0B',
    secondary: '#38BDF8',
    success: '#22C55E',
    danger: '#EF4444',
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    tabBarBg: '#0B1020',
    tabBarBorder: '#1F2937',
  },
  spacing: {
    screen: 18,
    section: 14,
    tabBarHeight: BASE_TAB_HEIGHT,
    screenBottomPad: BASE_TAB_HEIGHT + EXTRA_BOTTOM_SPACE,
  },
  typography: {
    title: 26,
    subtitle: 13,
    section: 15,
  },
} as const;

export const STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0;
