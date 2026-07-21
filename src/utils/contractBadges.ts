/**
 * Sözleşme kartı badge metinleri ve stilleri — ContractsScreen ve detay modalında paylaşılır.
 */

import type { ContractAvailability } from '../types/game';
import type { ContractRiskLevel } from '../simulation/contractPreview';
import { getContractAvailabilityLabel } from './contractAvailabilityDisplay';

export interface ContractCardBadge {
  key: string;
  label: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  soft?: boolean;
}

const AMBER = {
  textColor: '#F59E0B',
  backgroundColor: 'rgba(245, 158, 11, 0.14)',
  borderColor: 'rgba(245, 158, 11, 0.7)',
} as const;

const AMBER_MUTED = {
  textColor: '#FBBF24',
  backgroundColor: 'rgba(245, 158, 11, 0.10)',
  borderColor: 'rgba(245, 158, 11, 0.5)',
} as const;

const RED = {
  textColor: '#F87171',
  backgroundColor: 'rgba(248, 113, 113, 0.12)',
  borderColor: 'rgba(248, 113, 113, 0.65)',
} as const;

const GRAY = {
  textColor: '#94A3B8',
  backgroundColor: 'rgba(148, 163, 184, 0.10)',
  borderColor: 'rgba(148, 163, 184, 0.35)',
} as const;

export function getAvailabilityBadgeLabel(
  reason: ContractAvailability['reason'] | undefined,
  _playerLevel?: number,
  _requiredLevel?: number,
): string | null {
  return getContractAvailabilityLabel(reason);
}

function getAvailabilityBadgeStyle(
  reason: ContractAvailability['reason'] | undefined,
): Pick<ContractCardBadge, 'textColor' | 'backgroundColor' | 'borderColor'> {
  switch (reason) {
    case 'LEVEL_INSUFFICIENT':
      return GRAY;
    case 'TRUCK_CONDITION_TOO_LOW':
      return RED;
    case 'REPUTATION_TOO_LOW':
    case 'DRIVER_LEVEL_TOO_LOW':
      return GRAY;
    case 'NO_IDLE_TRUCK_IN_ORIGIN_CITY':
      return AMBER_MUTED;
    case 'NO_TRUCK_AT_ORIGIN':
    case 'NO_TRUCK_IN_ORIGIN_CITY':
    case 'NO_TRUCKS':
    case 'NO_IDLE_TRUCKS':
    case 'NO_TRUCK_WITH_CAPACITY':
    case 'CAPACITY_INSUFFICIENT':
      return AMBER;
    case 'NO_DRIVERS':
    case 'NO_IDLE_DRIVERS':
      return GRAY;
    default:
      return GRAY;
  }
}

function getAvailabilityBadge(availability: ContractAvailability): ContractCardBadge | null {
  if (availability.canStart) {
    return null;
  }

  const label = getContractAvailabilityLabel(availability.reason);
  if (!label) {
    return null;
  }

  const style = getAvailabilityBadgeStyle(availability.reason);
  return {
    key: 'availability',
    label,
    ...style,
  };
}

function getRiskBadge(riskLevel: ContractRiskLevel, riskLabel: string): ContractCardBadge | null {
  if (riskLevel === 'low') {
    return null;
  }

  const label = riskLabel === 'Yüksek risk' || riskLabel === 'Yüksek Risk' ? 'Yüksek Risk' : 'Orta Risk';

  if (riskLevel === 'high') {
    return {
      key: 'risk',
      label,
      textColor: '#F87171',
      backgroundColor: 'transparent',
      borderColor: 'rgba(248, 113, 113, 0.65)',
      soft: true,
    };
  }

  return {
    key: 'risk',
    label,
    textColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderColor: 'rgba(245, 158, 11, 0.55)',
  };
}

/** Kart üzerinde en fazla 2 badge: önce uygunluk, sonra tip veya acil/risk. */
export function buildContractCardBadges(params: {
  availability: ContractAvailability;
  playerLevel: number;
  urgent: boolean;
  riskLevel: ContractRiskLevel;
  riskLabel: string;
  contractType?: import('../types/game').ContractType;
  contractTypeLabel?: string;
}): ContractCardBadge[] {
  const { availability, urgent, riskLevel, riskLabel, contractType, contractTypeLabel } = params;
  const badges: ContractCardBadge[] = [];

  const availabilityBadge = getAvailabilityBadge(availability);
  if (availabilityBadge) {
    badges.push(availabilityBadge);
  }

  if (contractType && contractType !== 'standard' && contractTypeLabel) {
    const typeStyle =
      contractType === 'urgent'
        ? RED
        : contractType === 'fragile'
          ? AMBER
          : contractType === 'high_reputation'
            ? { textColor: '#A78BFA', backgroundColor: 'rgba(167, 139, 250, 0.12)', borderColor: 'rgba(167, 139, 250, 0.6)' }
            : contractType === 'bulk'
              ? GRAY
              : AMBER_MUTED;
    badges.push({
      key: `type-${contractType}`,
      label: contractTypeLabel,
      ...typeStyle,
    });
  } else if (urgent) {
    badges.push({
      key: 'urgent',
      label: 'Acil · Ceza yüksek',
      textColor: '#F87171',
      backgroundColor: 'rgba(248, 113, 113, 0.10)',
      borderColor: 'rgba(248, 113, 113, 0.65)',
    });
  } else {
    const riskBadge = getRiskBadge(riskLevel, riskLabel);
    if (riskBadge) {
      badges.push(riskBadge);
    }
  }

  return badges.slice(0, 2);
}

export type ContractCardVisualTier = 'available' | 'blocked' | 'locked';

export function getContractCardVisualTier(
  availability: ContractAvailability,
  playerLevel: number,
  requiredLevel: number,
): ContractCardVisualTier {
  if (availability.canStart) {
    return 'available';
  }

  if (availability.reason === 'LEVEL_INSUFFICIENT') {
    const gap = requiredLevel - Math.max(1, playerLevel);
    if (gap > 1) {
      return 'locked';
    }
  }

  return 'blocked';
}
