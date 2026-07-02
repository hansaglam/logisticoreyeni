import React from 'react';
import { Circle, G, Path, Rect } from 'react-native-svg';

export interface MapTruckMarkerProps {
  x: number;
  y: number;
  angle: number;
  isSelected: boolean;
  onPress?: () => void;
}

const MARKER_RADIUS = 12;

function TruckIcon({ fill }: { fill: string }) {
  return (
    <G scale={0.72}>
      <Rect x={-7} y={-3.5} width={14} height={7} rx={1.5} fill={fill} />
      <Path d="M 7 -2.5 L 10 -1 L 10 2.5 L 7 2.5 Z" fill={fill} />
      <Circle cx={-2.5} cy={4.5} r={1.8} fill="#020617" stroke={fill} strokeWidth={0.8} />
      <Circle cx={5} cy={4.5} r={1.8} fill="#020617" stroke={fill} strokeWidth={0.8} />
    </G>
  );
}

export default function MapTruckMarker({ x, y, angle, isSelected, onPress }: MapTruckMarkerProps) {
  return (
    <G transform={`translate(${x}, ${y}) rotate(${angle})`} onPress={onPress}>
      {isSelected ? (
        <Circle
          cx={0}
          cy={0}
          r={MARKER_RADIUS + 4}
          fill="none"
          stroke="#F59E0B"
          strokeWidth={1.5}
          opacity={0.6}
        />
      ) : null}
      <Circle cx={0} cy={0} r={MARKER_RADIUS + 2} fill="rgba(2, 6, 23, 0.75)" />
      <Circle
        cx={0}
        cy={0}
        r={MARKER_RADIUS}
        fill="#0F172A"
        stroke="#F59E0B"
        strokeWidth={isSelected ? 2.2 : 1.8}
      />
      <TruckIcon fill="#F59E0B" />
    </G>
  );
}
