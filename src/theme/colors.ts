export const colors = {
  background: '#040A14',
  background2: '#07111F',
  surface: '#091423',
  surface2: '#0C1830',
  surface3: '#10203C',
  card: '#091423',
  cardSoft: '#0C1830',
  border: '#18365E',
  borderStrong: '#20497B',

  textPrimary: '#F3F7FF',
  textSecondary: '#A9B6CC',
  textMuted: '#74839B',
  textDisabled: '#74839B',

  /** Primary brand blue */
  primary: '#2388FF',
  primaryLight: '#39A0FF',
  primaryLighter: '#4AA8FF',
  primaryDeep: '#186FD9',
  primarySoft: '#102D55',
  primaryGlow: 'rgba(35, 136, 255, 0.28)',
  accentBlue: '#2388FF',
  accentBlueSoft: 'rgba(35, 136, 255, 0.14)',
  buttonGradientTop: '#369CFF',
  buttonGradientBottom: '#2388FF',

  /** Amber / level / warning accent */
  amber: '#FFAA00',
  amberMid: '#F2A000',
  amberDeep: '#C47A00',
  amberSoft: '#352308',
  amberGlow: 'rgba(255, 170, 0, 0.22)',
  accentAmber: '#FFAA00',
  accentAmberSoft: 'rgba(255, 170, 0, 0.14)',

  success: '#12D66B',
  successDeep: '#11C96B',
  successSoft: 'rgba(18, 214, 107, 0.14)',

  warning: '#FFAA00',
  warningSoft: 'rgba(255, 170, 0, 0.14)',

  danger: '#FF5A59',
  dangerSoft: 'rgba(255, 90, 89, 0.14)',

  purple: '#8C6BFF',
  purpleDeep: '#7A5CF4',
  purpleSoft: 'rgba(140, 107, 255, 0.14)',

  info: '#38BDF8',
  infoSoft: 'rgba(56, 189, 248, 0.14)',

  divider: 'rgba(120, 160, 220, 0.16)',

  tabBarBg: '#091423',
  tabBarBorder: '#18365E',
} as const;

export type ColorToken = keyof typeof colors;
