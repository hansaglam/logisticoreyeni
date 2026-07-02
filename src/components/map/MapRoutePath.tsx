import React from 'react';
import { Line } from 'react-native-svg';

export interface MapRouteLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isActive: boolean;
  opacity: number;
  onPress?: () => void;
}

export default function MapRoutePath({
  x1,
  y1,
  x2,
  y2,
  isActive,
  opacity,
  onPress,
}: MapRouteLineProps) {
  if (opacity <= 0) return null;

  return (
    <Line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="#F59E0B"
      strokeWidth={isActive ? 3 : 1.8}
      strokeLinecap="round"
      opacity={opacity}
      onPress={onPress}
    />
  );
}
