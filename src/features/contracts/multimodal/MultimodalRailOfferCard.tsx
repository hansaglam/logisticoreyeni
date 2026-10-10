import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { GameIcon, ProductIcon } from '../../../components/ui';
import { colors } from '../../../theme';
import {
  MULTIMODAL_RAIL_PLAYER_MODE_LABEL,
  type RailOfferCardViewModel,
} from '../../../domain/presentation/multimodalRailOfferPresentation';
import MultimodalModeStrip from './MultimodalModeStrip';

const RAIL_STEEL = '#8BA3B8';
const RAIL_BORDER = '#3D5166';

interface MultimodalRailOfferCardProps {
  viewModel: RailOfferCardViewModel;
  onPress?: () => void;
}

const MultimodalRailOfferCard = React.memo(function MultimodalRailOfferCard({
  viewModel,
  onPress,
}: MultimodalRailOfferCardProps) {
  const muted = viewModel.visualState === 'UNAVAILABLE';

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      disabled={!viewModel.canInspect}
      accessibilityRole="button"
      accessibilityLabel={viewModel.accessibilityLabel}
      style={[styles.card, muted && styles.cardMuted]}
    >
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <GameIcon name="train" size={11} color={RAIL_STEEL} />
          <Text style={styles.badgeText}>{MULTIMODAL_RAIL_PLAYER_MODE_LABEL}</Text>
        </View>
        <View style={styles.badgeSoft}>
          <Text style={styles.badgeSoftText} numberOfLines={1}>
            {viewModel.readinessLabel}
          </Text>
        </View>
      </View>

      <View style={styles.header}>
        <View style={styles.iconBox}>
          <ProductIcon productId={viewModel.cargoProductId} size={20} color={colors.info} />
        </View>
        <View style={styles.left}>
          <Text style={styles.route} numberOfLines={2} ellipsizeMode="tail">
            {viewModel.originName} → {viewModel.destinationName}
          </Text>
          <Text style={styles.product} numberOfLines={1} ellipsizeMode="tail">
            {viewModel.cargoName} · {viewModel.cargoAmountText}
          </Text>
          <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
            Süre {viewModel.durationText} · Teslim {viewModel.deadlineText}
          </Text>
        </View>
        <View style={styles.price}>
          <Text
            style={styles.payment}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            ellipsizeMode="tail"
          >
            {viewModel.paymentText}
          </Text>
        </View>
      </View>

      <MultimodalModeStrip
        stages={viewModel.modeStages}
        accessibleLabel={viewModel.modeSequenceAccessible}
        compact
      />
    </TouchableOpacity>
  );
});

export default MultimodalRailOfferCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RAIL_BORDER,
    borderLeftWidth: 3,
    borderLeftColor: RAIL_STEEL,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
    minWidth: 0,
  },
  cardMuted: {
    opacity: 0.82,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    minWidth: 0,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 163, 184, 0.12)',
    borderWidth: 1,
    borderColor: RAIL_BORDER,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: RAIL_STEEL,
  },
  badgeSoft: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '100%',
  },
  badgeSoftText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    minWidth: 0,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  left: {
    flex: 1,
    minWidth: 0,
  },
  price: {
    flexShrink: 1,
    alignItems: 'flex-end',
    minWidth: 72,
    maxWidth: '42%',
    paddingLeft: 6,
  },
  route: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  product: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  meta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
  payment: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.success,
  },
});
