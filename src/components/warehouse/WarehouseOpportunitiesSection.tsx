import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getModalSheetPaddingBottom } from '../../constants/layout';
import { IconButton } from '../ui';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { colors, typography } from '../../theme';
import type { WarehouseOpportunityVm } from '../../utils/warehouseScreenViewModel';
import WarehouseOpportunityCard from './WarehouseOpportunityCard';
import { warehouseLayout } from './warehouseTheme';

const PREVIEW_LIMIT = 3;

interface WarehouseOpportunitiesSectionProps {
  opportunities: WarehouseOpportunityVm[];
  playerMoney: number;
  canOpenMore: boolean;
  nextLevelForMore: number;
  onOpenWarehouse: (cityId: string, type: 'standard' | 'cold') => void;
  sectionRef?: (y: number) => void;
}

export default function WarehouseOpportunitiesSection({
  opportunities,
  playerMoney,
  canOpenMore,
  nextLevelForMore,
  onOpenWarehouse,
  sectionRef,
}: WarehouseOpportunitiesSectionProps) {
  const insets = useAppSafeAreaInsets();
  const [showAll, setShowAll] = useState(false);

  const preview = useMemo(
    () => opportunities.slice(0, PREVIEW_LIMIT),
    [opportunities],
  );
  const hasMore = opportunities.length > PREVIEW_LIMIT;

  return (
    <View
      style={styles.section}
      onLayout={(event) => sectionRef?.(event.nativeEvent.layout.y)}
    >
      <Text style={styles.title}>Yeni Depo Fırsatları</Text>

      {opportunities.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Şu anda açılabilir yeni şehir bulunmuyor.</Text>
        </View>
      ) : (
        <>
          {preview.map((opportunity, index) => (
            <WarehouseOpportunityCard
              key={`${opportunity.mode}-${opportunity.cityId}`}
              opportunity={opportunity}
              playerMoney={playerMoney}
              canOpenMore={canOpenMore}
              nextLevelForMore={nextLevelForMore}
              onOpenWarehouse={onOpenWarehouse}
              measureLayout={index === 0}
            />
          ))}
          {hasMore ? (
            <Pressable
              onPress={() => setShowAll(true)}
              style={styles.moreLink}
              accessibilityRole="button"
              accessibilityLabel="Tüm depo fırsatlarını gör"
            >
              <Text style={styles.moreText}>
                Tüm Fırsatları Gör ({opportunities.length})
              </Text>
            </Pressable>
          ) : null}
        </>
      )}

      <Modal
        visible={showAll}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAll(false)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAll(false)} />
          <View style={[styles.sheet, { paddingBottom: getModalSheetPaddingBottom(insets) }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Tüm Depo Fırsatları</Text>
              <IconButton icon="close" onPress={() => setShowAll(false)} />
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              {opportunities.map((opportunity) => (
                <WarehouseOpportunityCard
                  key={`all-${opportunity.mode}-${opportunity.cityId}`}
                  opportunity={opportunity}
                  playerMoney={playerMoney}
                  canOpenMore={canOpenMore}
                  nextLevelForMore={nextLevelForMore}
                  onOpenWarehouse={(cityId, type) => {
                    onOpenWarehouse(cityId, type);
                    setShowAll(false);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: warehouseLayout.sectionGap,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: warehouseLayout.internalGap,
  },
  empty: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  emptyText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontSize: 12,
  },
  moreLink: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  moreText: {
    ...typography.bodySmall,
    color: colors.accentBlue,
    fontWeight: '700',
    fontSize: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sheetBody: {
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
});
