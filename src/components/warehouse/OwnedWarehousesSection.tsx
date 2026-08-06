import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppTutorialTarget } from '../tutorial/AppTutorialTarget';
import { EmptyState } from '../ui';
import { colors } from '../../theme';
import type { OwnedWarehouseCardVm } from '../../utils/warehouseScreenViewModel';
import OwnedWarehouseCard from './OwnedWarehouseCard';

interface OwnedWarehousesSectionProps {
  warehouses: OwnedWarehouseCardVm[];
  limitLabel: string;
  expandedWarehouseId: string | null;
  onToggleWarehouse: (warehouseId: string) => void;
  onManageStock: (warehouseId: string) => void;
  onTransfer: (warehouseId: string) => void;
  onUpgrade: (warehouseId: string) => void;
  onMore: (warehouseId: string) => void;
  onGoToMarket: () => void;
  onSellStock: (warehouseId: string, productId: string) => void;
  onTransferStock: (warehouseId: string, productId: string) => void;
  onOpenNewWarehouse: () => void;
}

export default function OwnedWarehousesSection({
  warehouses,
  limitLabel,
  expandedWarehouseId,
  onToggleWarehouse,
  onManageStock,
  onTransfer,
  onUpgrade,
  onMore,
  onGoToMarket,
  onSellStock,
  onTransferStock,
  onOpenNewWarehouse,
}: OwnedWarehousesSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Depolarım</Text>
        <Text style={styles.limit}>{limitLabel}</Text>
      </View>

      {warehouses.length === 0 ? (
        <EmptyState
          title="Henüz depon yok"
          message="İlk deponu açarak ürün ticaretine başla."
          icon="warehouse"
          actionLabel="Yeni Depo Aç"
          onAction={onOpenNewWarehouse}
          compact
        />
      ) : (
        warehouses.map((card, index) => {
          const warehouseCard = (
            <OwnedWarehouseCard
              key={card.warehouse.id}
              card={card}
              expanded={expandedWarehouseId === card.warehouse.id}
              measureLayout={index === 0}
              onToggle={() => onToggleWarehouse(card.warehouse.id)}
              onManageStock={() => onManageStock(card.warehouse.id)}
              onTransfer={() => onTransfer(card.warehouse.id)}
              onUpgrade={() => onUpgrade(card.warehouse.id)}
              onMore={() => onMore(card.warehouse.id)}
              onGoToMarket={onGoToMarket}
              onSellStock={(productId) => onSellStock(card.warehouse.id, productId)}
              onTransferStock={(productId) => onTransferStock(card.warehouse.id, productId)}
            />
          );

          if (index === 0) {
            return (
              <AppTutorialTarget
                key={card.warehouse.id}
                tutorialId="warehouses"
                targetId="city-warehouse-link"
                layoutMode="stretch"
              >
                <AppTutorialTarget tutorialId="warehouses" targetId="capacity" layoutMode="stretch">
                  {warehouseCard}
                </AppTutorialTarget>
              </AppTutorialTarget>
            );
          }

          return warehouseCard;
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  limit: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accentBlue,
    backgroundColor: colors.accentBlueSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
