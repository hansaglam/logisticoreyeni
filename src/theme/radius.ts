export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  card: 20,
  cardMedium: 20,
  cardLarge: 24,
  button: 18,
  icon: 16,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;
