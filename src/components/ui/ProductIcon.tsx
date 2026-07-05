import React from 'react';

import { colors } from '../../theme';
import { getProductGameIcon } from '../../theme/icons';
import GameIcon from './GameIcon';

interface ProductIconProps {
  productId?: string | null;
  size?: number;
  color?: string;
}

export default function ProductIcon({
  productId,
  size = 18,
  color = colors.textSecondary,
}: ProductIconProps) {
  return <GameIcon name={getProductGameIcon(productId)} size={size} color={color} />;
}
