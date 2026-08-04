import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getModalSheetPaddingBottom, getSafeModalMaxHeight } from '../../constants/layout';
import { ActionButton, GameIcon, IconButton, StatusBadge } from '../ui';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { colors, formatMoney, typography } from '../../theme';
import type { WarehouseOpportunityVm } from '../../utils/warehouseScreenViewModel';
import { logWarehouseLayout } from './warehouseLayoutDebug';

interface WarehouseOpportunityCardProps {
  opportunity: WarehouseOpportunityVm;
  playerMoney: number;
  canOpenMore: boolean;
  nextLevelForMore: number;
  onOpenWarehouse: (cityId: string, type: 'standard' | 'cold') => void;
  measureLayout?: boolean;
}

export default function WarehouseOpportunityCard({
  opportunity,
  playerMoney,
  canOpenMore,
  nextLevelForMore,
  onOpenWarehouse,
  measureLayout = false,
}: WarehouseOpportunityCardProps) {
  const insets = useAppSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const sheetMaxHeight = getSafeModalMaxHeight(height, insets, 0.8);
  const stacked = width < 380;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<'standard' | 'cold'>(
    opportunity.mode === 'add-cold' ? 'cold' : 'standard',
  );

  const locked = !canOpenMore || !opportunity.cityUnlocked;
  const selectedCost =
    selectedType === 'cold' ? opportunity.coldOpenCost : opportunity.standardOpenCost;
  const selectedDaily =
    selectedType === 'cold' ? opportunity.coldDailyCost : opportunity.standardDailyCost;
  const canAfford = playerMoney >= selectedCost;
  const openDisabled = locked || !canAfford;

  const openLabel = locked
    ? 'Seviye Gerekli'
    : !canAfford
      ? 'Nakit Yetersiz'
      : selectedType === 'cold'
        ? 'Soğuk Depo Aç'
        : 'Normal Depo Aç';

  const handleConfirm = () => {
    onOpenWarehouse(opportunity.cityId, selectedType);
    setSheetOpen(false);
  };

  return (
    <>
      <Pressable
        style={styles.card}
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${opportunity.cityName} depo seç`}
        onLayout={
          measureLayout
            ? (event) => {
                logWarehouseLayout({
                  opportunityCardHeight: Math.round(event.nativeEvent.layout.height),
                });
              }
            : undefined
        }
      >
        <View style={styles.header}>
          <GameIcon name="city" size={14} color={colors.accentBlue} />
          <Text style={styles.city} numberOfLines={1}>
            {opportunity.cityName}
          </Text>
          <View style={styles.badgeWrap}>
            <StatusBadge
              label={
                opportunity.signalCount > 0
                  ? `${opportunity.signalCount} sinyal`
                  : opportunity.economicLabel
              }
              variant="amber"
              size="sm"
            />
          </View>
          <Text style={styles.modifier}>{opportunity.costModifier.toFixed(2)}x</Text>
        </View>

        <View style={[styles.optionsRow, stacked && styles.optionsStacked]}>
          {opportunity.mode === 'new-city' ? (
            <View style={styles.optionChip}>
              <Text style={styles.optionLabel}>Normal</Text>
              <Text style={styles.optionValue} numberOfLines={1}>
                {formatMoney(opportunity.standardOpenCost)} · {formatMoney(opportunity.standardDailyCost)}
                /gün
              </Text>
            </View>
          ) : (
            <View style={styles.optionChip}>
              <Text style={styles.optionLabel}>Mevcut depo</Text>
              <Text style={styles.optionValue} numberOfLines={1}>
                Soğuk zincir eklenebilir
              </Text>
            </View>
          )}
          <View style={[styles.optionChip, styles.optionCold]}>
            <Text style={[styles.optionLabel, { color: colors.purple }]}>Soğuk</Text>
            <Text style={styles.optionValue} numberOfLines={1}>
              {formatMoney(opportunity.coldOpenCost)} · {formatMoney(opportunity.coldDailyCost)}/gün
            </Text>
          </View>
        </View>

        <View style={styles.selectRow}>
          <Text style={styles.selectLabel}>Depo Seç</Text>
          <GameIcon name="chevronRight" size={14} color={colors.accentBlue} />
        </View>
      </Pressable>

      <Modal
        visible={sheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetOpen(false)} />
          <View
            style={[
              styles.sheet,
              {
                maxHeight: sheetMaxHeight,
                paddingBottom: getModalSheetPaddingBottom(insets),
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleBlock}>
                <Text style={styles.sheetTitle}>{opportunity.cityName}</Text>
                <Text style={styles.sheetSub}>Depo tipini seç</Text>
              </View>
              <IconButton icon="close" onPress={() => setSheetOpen(false)} />
            </View>

            {opportunity.mode === 'new-city' ? (
              <Pressable
                style={[
                  styles.typeOption,
                  selectedType === 'standard' && styles.typeOptionActive,
                ]}
                onPress={() => setSelectedType('standard')}
              >
                <Text style={styles.typeTitle}>Normal Depo</Text>
                <Text style={styles.typeMeta}>
                  Açılış {formatMoney(opportunity.standardOpenCost)} · Günlük{' '}
                  {formatMoney(opportunity.standardDailyCost)}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              style={[styles.typeOption, selectedType === 'cold' && styles.typeOptionActiveCold]}
              onPress={() => setSelectedType('cold')}
            >
              <Text style={[styles.typeTitle, { color: colors.purple }]}>Soğuk Depo</Text>
              <Text style={styles.typeMeta}>
                Açılış {formatMoney(opportunity.coldOpenCost)} · Günlük{' '}
                {formatMoney(opportunity.coldDailyCost)}
              </Text>
            </Pressable>

            <View style={styles.compareBox}>
              <Text style={styles.compareLine}>
                Seçim: {selectedType === 'cold' ? 'Soğuk Depo' : 'Normal Depo'}
              </Text>
              <Text style={styles.compareLine}>Maliyet: {formatMoney(selectedCost)}</Text>
              <Text style={styles.compareLine}>Günlük: {formatMoney(selectedDaily)}</Text>
            </View>

            {!canOpenMore ? (
              <Text style={styles.lock}>
                Daha fazla depo için Level {nextLevelForMore} gerekli.
              </Text>
            ) : !opportunity.cityUnlocked ? (
              <Text style={styles.lock}>
                Bu şehir için Level {opportunity.requiredLevel} gerekli.
              </Text>
            ) : null}

            <ActionButton
              label={openLabel}
              onPress={handleConfirm}
              variant="primary"
              disabled={openDisabled}
              fullWidth
              accessibilityLabel={`${opportunity.cityName} ${openLabel}`}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 11,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.28)',
    backgroundColor: '#0E1C34',
    borderLeftWidth: 3,
    borderLeftColor: colors.accentBlue,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  city: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  badgeWrap: {
    flexShrink: 1,
    minWidth: 0,
  },
  modifier: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 0,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  optionsStacked: {
    flexDirection: 'column',
  },
  optionChip: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  optionCold: {
    borderColor: 'rgba(140, 107, 255, 0.35)',
  },
  optionLabel: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '800',
    fontSize: 11,
  },
  optionValue: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.35)',
  },
  selectLabel: {
    ...typography.caption,
    color: colors.accentBlue,
    fontWeight: '800',
    fontSize: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sheetSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  typeOption: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  typeOptionActive: {
    borderColor: colors.accentBlue,
    backgroundColor: colors.accentBlueSoft,
  },
  typeOptionActiveCold: {
    borderColor: colors.purple,
    backgroundColor: colors.purpleSoft,
  },
  typeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.accentBlue,
  },
  typeMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
    fontSize: 12,
  },
  compareBox: {
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 2,
  },
  compareLine: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontSize: 12,
  },
  lock: {
    ...typography.caption,
    color: colors.accentAmber,
    fontSize: 11,
  },
});
