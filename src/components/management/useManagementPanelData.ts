import React, { useMemo, useState } from 'react';

import { VEHICLE_MARKETPLACE_ENABLED } from '../../config/backendRoadmap';
import { createDefaultMissionsState } from '../../config/missions';
import { buildQuickAccessItems } from '../../navigation/quickAccessConfig';
import type { QuickAccessAction } from '../../navigation/quickAccessTypes';
import {
  getAccountStatus,
  subscribeAuthState,
  type AccountStatus,
} from '../../services/authService';
import { useGameStore } from '../../store/gameStore';
import { getWarehouseUsedCapacityTon, normalizeWarehouse } from '../../simulation/trading';
import { getMissionDisplayStatus } from '../../utils/missionProgress';
import type { ManagementItem, ManagementTone } from './managementTypes';

const ITEM_TONES: Record<QuickAccessAction, ManagementTone> = {
  fleet: 'cyan',
  shop: 'blue',
  warehouse: 'amber',
  finance: 'green',
  vehicleMarketplace: 'purple',
  missions: 'orange',
  leaderboard: 'gold',
  settings: 'slate',
  account: 'slate',
};

function resolveAccountSubtitle(status: AccountStatus): string {
  if (!status.isReady) {
    return 'Profil ve tercihler';
  }
  const isGuest = status.isAnonymous || status.provider === 'guest';
  return isGuest ? 'Misafir hesap' : 'Profil ve tercihler';
}

function accountNeedsAttention(status: AccountStatus): boolean {
  if (!status.isReady) {
    return false;
  }
  return status.isAnonymous || status.provider === 'guest';
}

export function useAccountManagementSubtitle(): {
  subtitle: string;
  needsAttention: boolean;
} {
  const [status, setStatus] = useState(() => getAccountStatus());

  React.useEffect(() => {
    const refresh = () => setStatus(getAccountStatus());
    refresh();
    return subscribeAuthState(refresh);
  }, []);

  return {
    subtitle: resolveAccountSubtitle(status),
    needsAttention: accountNeedsAttention(status),
  };
}

function useFleetSubtitle(): string {
  const trucks = useGameStore((state) => state.player.trucks ?? []);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries ?? []);

  return useMemo(() => {
    const operableTrucks = trucks.filter((truck) => !truck.leaseExpired);
    const onRouteIds = new Set(
      activeDeliveries
        .filter((delivery) => delivery.status === 'on_route' || delivery.status === 'preparing')
        .map((delivery) => delivery.truckId),
    );
    const activeCount = operableTrucks.filter((truck) => onRouteIds.has(truck.id)).length;

    if (activeCount > 0) {
      return `${activeCount} aktif araç`;
    }
    if (operableTrucks.length > 0) {
      return `${operableTrucks.length} araç`;
    }
    return 'Kamyon ve şoförler';
  }, [trucks, activeDeliveries]);
}

function useWarehouseSubtitle(): string {
  const player = useGameStore((state) => state.player);
  const currentTime = useGameStore((state) => state.currentTime);

  return useMemo(() => {
    const warehouses = player?.warehouses ?? [];
    if (warehouses.length === 0) {
      return 'Depo aç';
    }

    let totalCapacity = 0;
    let usedCapacity = 0;
    for (const warehouse of warehouses) {
      const normalized = normalizeWarehouse(warehouse, currentTime);
      totalCapacity += normalized.capacityTons ?? 0;
      usedCapacity += getWarehouseUsedCapacityTon(normalized);
    }
    const fillPercent =
      totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0;
    const depotLabel = warehouses.length === 1 ? '1 depo' : `${warehouses.length} depo`;
    return `${depotLabel} · %${fillPercent} dolu`;
  }, [player, currentTime]);
}

export function useMissionsReadyBadge(): number {
  const missions = useGameStore((state) => state.missions);
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);

  return useMemo(() => {
    const state = missions ?? createDefaultMissionsState();
    const activeIds = state.activeMissionIds ?? [];
    return activeIds.filter((missionId) => {
      const progress = getMissionProgressValue(missionId);
      return getMissionDisplayStatus(missionId, state, progress) === 'ready';
    }).length;
  }, [missions, getMissionProgressValue]);
}

function useMissionsSubtitle(readyCount: number): string {
  return useMemo(() => {
    if (readyCount > 0) {
      return `${readyCount} görev hazır`;
    }
    return 'Günlük ve haftalık görevler';
  }, [readyCount]);
}

export function useManagementItems(): ManagementItem[] {
  const fleetSubtitle = useFleetSubtitle();
  const warehouseSubtitle = useWarehouseSubtitle();
  const missionsReadyCount = useMissionsReadyBadge();
  const missionsSubtitle = useMissionsSubtitle(missionsReadyCount);
  const accountState = useAccountManagementSubtitle();

  const configItems = useMemo(
    () => buildQuickAccessItems(VEHICLE_MARKETPLACE_ENABLED),
    [],
  );

  return useMemo(
    () =>
      configItems.map((item) => {
        let subtitle = item.defaultSubtitle ?? '';
        let badge: number | undefined;
        let badgeAttention = false;

        switch (item.key) {
          case 'fleet':
            subtitle = fleetSubtitle;
            break;
          case 'shop':
            subtitle = 'Araç ve ekipman';
            break;
          case 'warehouse':
            subtitle = warehouseSubtitle;
            break;
          case 'finance':
            subtitle = 'Gelir ve giderler';
            break;
          case 'vehicleMarketplace':
            subtitle = 'Oyuncu ilanları';
            break;
          case 'missions':
            subtitle = missionsSubtitle;
            if (missionsReadyCount > 0) {
              badge = missionsReadyCount;
            }
            break;
          case 'leaderboard':
            subtitle = 'Sezon sıralaması';
            break;
          case 'account':
            subtitle = accountState.subtitle;
            badgeAttention = accountState.needsAttention;
            break;
          default:
            break;
        }

        const accessibilityLabel =
          badge != null && badge > 0
            ? `${item.label}, ${subtitle}`
            : badgeAttention
              ? `${item.label}, dikkat gerekli`
              : item.accessibilityLabel;

        return {
          id: item.key,
          title: item.label,
          subtitle,
          icon: item.icon,
          tone: ITEM_TONES[item.key],
          badge,
          badgeAttention,
          accessibilityLabel,
          accessibilityHint: item.accessibilityHint,
        };
      }),
    [
      configItems,
      fleetSubtitle,
      warehouseSubtitle,
      missionsSubtitle,
      missionsReadyCount,
      accountState,
    ],
  );
}
