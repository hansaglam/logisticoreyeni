import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getBottomInset, getSafeModalMaxHeight } from '../../../constants/layout';
import { ActionButton, GameIcon, IconButton, ProductIcon } from '../../../components/ui';
import { useAppSafeAreaInsets } from '../../../components/AppSafeAreaProvider';
import { colors, spacing, typography } from '../../../theme';
import {
  MULTIMODAL_RAIL_PLAYER_MODE_LABEL,
  type RailOfferCardViewModel,
} from '../../../domain/presentation/multimodalRailOfferPresentation';
import MultimodalFleetReadiness from './MultimodalFleetReadiness';
import MultimodalModeStrip from './MultimodalModeStrip';

const RAIL_STEEL = '#8BA3B8';
const OVERLAY_OPACITY = 0.52;
const SHEET_RADIUS = 24;

interface MultimodalRailOfferDetailModalProps {
  visible: boolean;
  viewModel: RailOfferCardViewModel | null;
  onClose: () => void;
  onAccept?: () => void;
  accepting?: boolean;
}

export default function MultimodalRailOfferDetailModal({
  visible,
  viewModel,
  onClose,
  onAccept,
  accepting,
}: MultimodalRailOfferDetailModalProps) {
  const insets = useAppSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const bottom = getBottomInset(insets);
  const maxHeight = getSafeModalMaxHeight(windowHeight, insets, 0.88);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.overlay} onPress={onClose} accessibilityRole="button" accessibilityLabel="Kapat" />
        <View style={[styles.sheet, { maxHeight, height: maxHeight, paddingBottom: Math.max(bottom, spacing.md) }]}>
          {viewModel ? (
            <>
              <View style={styles.handle} />
              <View style={styles.header}>
                <View style={styles.headerIcon}>
                  <ProductIcon productId={viewModel.cargoProductId} size={22} color={colors.info} />
                </View>
                <View style={styles.headerText}>
                  <Text style={styles.route} numberOfLines={2}>
                    {viewModel.originName} → {viewModel.destinationName}
                  </Text>
                  <View style={styles.badge}>
                    <GameIcon name="train" size={12} color={RAIL_STEEL} />
                    <Text style={styles.badgeText}>{MULTIMODAL_RAIL_PLAYER_MODE_LABEL}</Text>
                  </View>
                  <Text style={styles.cargo} numberOfLines={1}>
                    {viewModel.cargoName} · {viewModel.cargoAmountText}
                  </Text>
                </View>
                <IconButton icon="close" onPress={onClose} size={18} color={colors.textSecondary} accessibilityLabel="Kapat" />
              </View>

              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.section}>Taşıma Planı</Text>
                <MultimodalModeStrip
                  stages={viewModel.modeStages}
                  accessibleLabel={viewModel.modeSequenceAccessible}
                />
                <Text style={styles.stageTitle}>1. Kamyon</Text>
                <Text style={styles.stageBody}>
                  {viewModel.firstMileLabel}
                  {viewModel.firstMileKmText ? ` · ${viewModel.firstMileKmText}` : ''}
                </Text>
                <Text style={styles.stageTitle}>2. Tren</Text>
                <Text style={styles.stageBody}>
                  {viewModel.railLegLabel}
                  {viewModel.railKmText ? ` · ${viewModel.railKmText}` : ''}
                </Text>
                <Text style={styles.stageTitle}>3. Kamyon</Text>
                <Text style={styles.stageBody}>
                  {viewModel.lastMileLabel}
                  {viewModel.lastMileKmText ? ` · ${viewModel.lastMileKmText}` : ''}
                </Text>

                <Text style={styles.section}>Teklif</Text>
                <Text style={styles.payment}>{viewModel.paymentText}</Text>
                <Text style={styles.kv}>Tahmini süre · {viewModel.durationText}</Text>
                <Text style={styles.kv}>Teslim süresi · {viewModel.deadlineText}</Text>
                <Text style={styles.kv}>Yük · {viewModel.cargoAmountText}</Text>

                <Text style={styles.section}>Hazırlık</Text>
                <MultimodalFleetReadiness viewModel={viewModel} />

                <Text style={styles.section}>Nasıl çalışır?</Text>
                <Text style={styles.explain}>{viewModel.explanation}</Text>
              </ScrollView>

              <View style={styles.footer}>
                <ActionButton
                  label={viewModel.ctaLabel}
                  onPress={viewModel.ctaDisabled || !onAccept ? () => undefined : onAccept}
                  disabled={viewModel.ctaDisabled || Boolean(accepting)}
                  fullWidth
                  accessibilityLabel={viewModel.ctaAccessibilityLabel}
                />
                <Text style={styles.ctaHint}>
                  {viewModel.ctaBlockReason ?? 'Kabul henüz açık değil. Bu önizleme iş başlatmaz.'}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(0,0,0,${OVERLAY_OPACITY})`,
  },
  sheet: {
    backgroundColor: colors.background2,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    minWidth: 0,
    minHeight: 0,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: spacing.md,
    flexShrink: 0,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  route: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3D5166',
    backgroundColor: 'rgba(139, 163, 184, 0.12)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: RAIL_STEEL,
  },
  cargo: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  scroll: {
    minWidth: 0,
    minHeight: 0,
    flex: 1,
  },
  scrollContent: {
    gap: 4,
    paddingBottom: spacing.md,
  },
  section: {
    ...typography.sectionTitle,
    marginTop: spacing.sm,
    color: colors.textPrimary,
  },
  stageTitle: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  stageBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  payment: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.success,
  },
  kv: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  explain: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  footer: {
    gap: 8,
    paddingTop: spacing.md,
    flexShrink: 0,
  },
  ctaHint: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
