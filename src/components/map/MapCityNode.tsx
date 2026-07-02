import React from 'react';
import { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

export type CityMarketStatus = 'Shortage' | 'Surplus' | 'Mixed' | 'Balanced';

export interface MapCityNodeProps {
  x: number;
  y: number;
  cityName: string;
  labelOffset: { x: number; y: number };
  isSelected: boolean;
  hasDepot: boolean;
  marketStatus: CityMarketStatus;
  dimmed?: boolean;
  onPress?: () => void;
}

const NODE_RADIUS = 5;
const NODE_DEPOT = '#38BDF8';
const NODE_DEFAULT = '#F59E0B';
const SHORTAGE = '#EF4444';
const SURPLUS = '#22C55E';

export default function MapCityNode({
  x,
  y,
  cityName,
  labelOffset,
  isSelected,
  hasDepot,
  marketStatus,
  dimmed = false,
  onPress,
}: MapCityNodeProps) {
  const nodeFill = hasDepot ? NODE_DEPOT : NODE_DEFAULT;
  const labelX = x + labelOffset.x;
  const labelY = y + labelOffset.y;
  const labelWidth = Math.max(44, cityName.length * 7 + 10);
  const labelHeight = 18;

  const showShortage = marketStatus === 'Shortage' || marketStatus === 'Mixed';
  const showSurplus = marketStatus === 'Surplus' || marketStatus === 'Mixed';

  return (
    <G opacity={dimmed ? 0.35 : 1}>
      {isSelected ? (
        <Circle cx={x} cy={y} r={12} fill="none" stroke={NODE_DEFAULT} strokeWidth={1.5} opacity={0.55} />
      ) : null}

      <Circle cx={x} cy={y} r={20} fill="transparent" onPress={onPress} />

      <Rect
        x={labelX - labelWidth / 2}
        y={labelY - labelHeight / 2}
        width={labelWidth}
        height={labelHeight}
        rx={4}
        fill="rgba(2, 6, 23, 0.78)"
      />
      <SvgText
        x={labelX}
        y={labelY + 4}
        fill="#FFFFFF"
        fontSize={12}
        fontWeight="600"
        textAnchor="middle"
      >
        {cityName}
      </SvgText>

      <Circle cx={x} cy={y} r={NODE_RADIUS + 1.5} fill="rgba(2, 6, 23, 0.65)" />
      <Circle
        cx={x}
        cy={y}
        r={NODE_RADIUS}
        fill={nodeFill}
        stroke="#020617"
        strokeWidth={1.5}
      />

      {showShortage ? (
        <Circle cx={x + 8} cy={y - 8} r={3} fill={SHORTAGE} stroke="#020617" strokeWidth={1} />
      ) : null}
      {showSurplus ? (
        <Circle
          cx={x + (showShortage ? 14 : 8)}
          cy={y - 8}
          r={3}
          fill={SURPLUS}
          stroke="#020617"
          strokeWidth={1}
        />
      ) : null}
    </G>
  );
}
