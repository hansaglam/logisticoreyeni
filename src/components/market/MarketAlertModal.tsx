import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { getBottomInset } from '../../constants/layout';
import type { MarketPriceAlertCondition } from '../../types/game';
import type { City, Product } from '../../types/game';
import { colors, spacing, typography } from '../../theme';
import { formatMoney } from '../../theme/format';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { ActionButton, IconButton, ProductIcon } from '../ui';

const OVERLAY_OPACITY = 0.52;
const SHEET_RADIUS = 22;

export interface MarketAlertModalProps {
  visible: boolean;
  city: City | null;
  product: Product | null;
  currentPrice: number;
  onConfirm: (input: {
    condition: MarketPriceAlertCondition;
    targetPrice: number;
  }) => void | Promise<void>;
  onClose: () => void;
}

type AlertConditionOption = 'price_below' | 'price_above';

const CONDITION_OPTIONS: Array<{
  key: AlertConditionOption;
  label: string;
}> = [
  { key: 'price_below', label: 'Fiyat altına düşünce' },
  { key: 'price_above', label: 'Fiyat üstüne çıkınca' },
];

function parsePriceInput(value: string): number | null {
  const normalized = value.replace(/[^0-9.,]/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export default function MarketAlertModal({
  visible,
  city,
  product,
  currentPrice,
  onConfirm,
  onClose,
}: MarketAlertModalProps) {
  const insets = useAppSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [condition, setCondition] = useState<AlertConditionOption>('price_below');
  const [priceInput, setPriceInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const suggested =
      condition === 'price_below'
        ? Math.max(1, Math.round(currentPrice * 0.9))
        : Math.round(currentPrice * 1.1);
    setPriceInput(String(suggested));
  }, [visible, currentPrice, condition]);

  const targetPrice = useMemo(() => parsePriceInput(priceInput), [priceInput]);
  const isValidTarget = targetPrice != null;

  const sheetMaxHeight = Math.min(windowHeight * 0.62, 420);

  const handleConfirm = async () => {
    if (!targetPrice || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm({ condition, targetPrice });
    } finally {
      setSubmitting(false);
    }
  };

  if (!city || !product) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              paddingBottom: getBottomInset(insets) + spacing.lg,
            },
          ]}
        >
          <View style={styles.sheetHandle} />

          <View style={styles.headerRow}>
            <View style={styles.headerMain}>
              <Text style={styles.title}>Fiyat Alarmı</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {city.name} · {product.name}
              </Text>
            </View>
            <IconButton icon="close" onPress={onClose} size={18} color={colors.textMuted} />
          </View>

          <View style={styles.priceRow}>
            <ProductIcon productId={product.id} size={16} color={colors.info} />
            <Text style={styles.currentPriceLabel}>Güncel fiyat</Text>
            <Text style={styles.currentPriceValue}>{formatMoney(currentPrice)} / ton</Text>
          </View>

          <Text style={styles.sectionLabel}>Koşul</Text>
          <View style={styles.conditionRow}>
            {CONDITION_OPTIONS.map((option) => {
              const active = condition === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.conditionChip, active && styles.conditionChipActive]}
                  onPress={() => setCondition(option.key)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.conditionChipText, active && styles.conditionChipTextActive]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Hedef fiyat</Text>
          <TextInput
            style={styles.priceInput}
            value={priceInput}
            onChangeText={setPriceInput}
            keyboardType="decimal-pad"
            placeholder="Örn. 2000"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.helperText}>
            Ürün bu hedefe ulaştığında bildirim alırsın.
          </Text>

          <View style={styles.actionsRow}>
            <ActionButton
              label="Vazgeç"
              onPress={onClose}
              variant="secondary"
              style={styles.actionButton}
            />
            <ActionButton
              label="Alarm Kur"
              onPress={() => void handleConfirm()}
              variant="primary"
              disabled={!isValidTarget || submitting}
              style={styles.actionButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: `rgba(2, 8, 23, ${OVERLAY_OPACITY})`,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: spacing.sm,
  },
  currentPriceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
  currentPriceValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.accentAmber,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 4,
  },
  conditionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  conditionChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  conditionChipActive: {
    borderColor: colors.accentBlue,
    backgroundColor: `${colors.accentBlue}22`,
  },
  conditionChipText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  conditionChipTextActive: {
    color: colors.accentBlue,
    fontWeight: '800',
  },
  priceInput: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  helperText: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
    marginBottom: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minHeight: 40,
  },
});
