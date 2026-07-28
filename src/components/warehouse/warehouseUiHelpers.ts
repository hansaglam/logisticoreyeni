import { colors } from '../../theme';
import type { WarehouseType } from '../../types/game';
import type { WarehouseOccupancyStatus } from '../../utils/warehouseScreenViewModel';

export function getOccupancyBarColor(percent: number): string {
  if (percent >= 100) return colors.danger;
  if (percent >= 80) return colors.accentAmber;
  if (percent >= 40) return colors.success;
  return colors.accentBlue;
}

export function getStatusBadgeVariant(
  status: WarehouseOccupancyStatus,
): 'muted' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'empty':
      return 'muted';
    case 'nearly-full':
      return 'warning';
    case 'full':
      return 'danger';
    default:
      return 'success';
  }
}

export function getTypeBadgeVariant(type: WarehouseType): 'blue' | 'info' | 'muted' {
  if (type === 'cold') return 'info';
  if (type === 'standard') return 'blue';
  return 'muted';
}
