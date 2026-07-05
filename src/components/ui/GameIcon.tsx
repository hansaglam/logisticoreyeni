import React from 'react';
import { MaterialCommunityIcons, resolveGameIcon, type GameIconName } from '../../theme/icons';

interface GameIconProps {
  name: GameIconName;
  size?: number;
  color?: string;
}

export default function GameIcon({ name, size = 20, color }: GameIconProps) {
  return <MaterialCommunityIcons name={resolveGameIcon(name)} size={size} color={color} />;
}
