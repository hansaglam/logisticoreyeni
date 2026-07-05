import { Platform, type ViewStyle } from 'react-native';

type ShadowStyle = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

type IosShadow = Pick<
  ShadowStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius'
>;

function createShadow(iosShadow: IosShadow, elevation: number): ShadowStyle {
  if (Platform.OS === 'ios') {
    return iosShadow;
  }
  return { elevation };
}

export const shadows = {
  soft: createShadow(
    {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 6,
    },
    3,
  ),

  medium: createShadow(
    {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.22,
      shadowRadius: 10,
    },
    6,
  ),

  glowBlue: createShadow(
    {
      shadowColor: '#3B82F6',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
    },
    4,
  ),

  glowAmber: createShadow(
    {
      shadowColor: '#F59E0B',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
    },
    4,
  ),
} as const;

export type ShadowToken = keyof typeof shadows;
