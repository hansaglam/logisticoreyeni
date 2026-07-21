/**
 * Sözleşme detay modalı — karttaki özet bilgilerin tamamını gösterir.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { ContractPreview } from '../../simulation/contractPreview';
import { getContractCargoWeight } from '../../simulation/delivery';
import { getContractAvailabilityLabel } from '../../utils/contractAvailabilityDisplay';
import { getCityName, getProductName } from '../../utils/entityLookup';
import { colors, formatMoney, formatRatioPercent, radius, shadows, spacing, typography } from '../../theme';
import type { Contract } from '../../types/game';
import { ProductIcon } from '../ui';

export interface ContractDetailModalProps {
  visible: boolean;
  contract: Contract | null;
  preview: ContractPreview | null;
  onClose: () => void;
  onSelectTeam?: () => void;
}

function DetailRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'muted';
}) {
  const valueColor =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : tone === 'muted'
            ? colors.textMuted
            : colors.textPrimary;

  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.detailValue, { color: valueColor }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  variant,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary' | 'disabled';
  disabled?: boolean;
}) {
  const palette =
    variant === 'primary'
      ? {
          backgroundColor: colors.accentBlue,
          borderColor: colors.accentBlue,
          textColor: colors.textPrimary,
        }
      : variant === 'disabled'
        ? {
            backgroundColor: '#1A2F4D',
            borderColor: 'rgba(147, 197, 253, 0.38)',
            textColor: '#B8D4F0',
          }
        : {
            backgroundColor: colors.cardSoft,
            borderColor: colors.borderStrong,
            textColor: colors.textSecondary,
          };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          opacity: disabled ? 1 : pressed ? 0.88 : 1,
        },
      ]}
    >
      <Text style={[styles.actionButtonText, { color: palette.textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ContractDetailModal({
  visible,
  contract,
  preview,
  onClose,
  onSelectTeam,
}: ContractDetailModalProps) {
  if (!contract || !preview) {
    return null;
  }

  const { availability } = preview;
  const canStart = availability.canStart;
  const cargoWeight = availability.requiredCapacity ?? getContractCargoWeight(contract);
  const routeLine = `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}`;
  const availabilityLabel = canStart
    ? 'Alınabilir'
    : getContractAvailabilityLabel(availability.reason) ?? availability.title ?? 'Alınamaz';

  const urgencyLabel = preview.isUrgent ? 'Acil' : 'Normal';
  const profitTone = preview.estimatedOperationalProfit >= 0 ? 'success' : 'danger';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, shadows.glowBlue]} onPress={() => {}}>
          <View style={styles.headerRow}>
            <View style={styles.iconBox}>
              <ProductIcon productId={contract.productId} size={22} color={colors.info} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Sözleşme Detayı</Text>
              <Text style={styles.routeLine} numberOfLines={1} ellipsizeMode="tail">
                {routeLine}
              </Text>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <DetailRow label="Rota" value={routeLine} />
            <DetailRow label="Ürün" value={getProductName(contract.productId)} />
            <DetailRow label="Yük" value={`${cargoWeight.toFixed(1)} t`} />
            <DetailRow label="Kalan süre" value={formatTimeLeft(contract.deadlineHours)} />
            <DetailRow label="Ödeme" value={formatMoney(preview.estimatedGrossPayment)} tone="success" />
            {preview.contractTypePaymentBonus != null &&
            preview.contractTypePaymentBonus !== 0 ? (
              <DetailRow
                label="Sözleşme tipi bonusu"
                value={formatMoney(preview.contractTypePaymentBonus)}
                tone="success"
              />
            ) : null}
            {preview.baseGrossPayment != null &&
            preview.worldEventPaymentBonus != null &&
            preview.worldEventPaymentBonus !== 0 ? (
              <>
                <DetailRow
                  label="Baz ödeme"
                  value={formatMoney(preview.baseGrossPayment)}
                  tone="muted"
                />
                <DetailRow
                  label="Olay bonusu"
                  value={formatMoney(preview.worldEventPaymentBonus)}
                  tone={preview.worldEventPaymentBonus >= 0 ? 'success' : 'warning'}
                />
              </>
            ) : null}
            <DetailRow label="İş gideri" value={formatMoney(preview.estimatedTripCost)} tone="muted" />
            <DetailRow
              label="İş kârı"
              value={formatMoney(preview.estimatedOperationalProfit)}
              tone={profitTone}
            />
            <DetailRow label="Marj" value={formatRatioPercent(preview.estimatedMarginPercent)} />
            <DetailRow label="Risk" value={preview.riskLabel} />
            {preview.contractTypeLabel ? (
              <DetailRow label="Sözleşme tipi" value={preview.contractTypeLabel} />
            ) : null}
            {preview.contractTypeDescription ? (
              <DetailRow label="Tip açıklaması" value={preview.contractTypeDescription} tone="muted" />
            ) : null}
            {contract.requiredReputation != null ? (
              <DetailRow label="Gerekli itibar" value={`${contract.requiredReputation}+`} />
            ) : null}
            {contract.requiredDriverLevel != null && contract.requiredDriverLevel > 1 ? (
              <DetailRow label="Gerekli şoför seviyesi" value={`Seviye ${contract.requiredDriverLevel}`} />
            ) : null}
            {contract.recommendedTruckCondition != null ? (
              <DetailRow
                label="Önerilen kondisyon"
                value={`${contract.recommendedTruckCondition}+`}
                tone="warning"
              />
            ) : null}
            {preview.contractTypePenaltyMultiplier != null &&
            preview.contractTypePenaltyMultiplier > 1 ? (
              <DetailRow
                label="Ceza çarpanı"
                value={`×${preview.contractTypePenaltyMultiplier.toFixed(2)}`}
                tone="warning"
              />
            ) : null}
            {preview.contractTypeWarning ? (
              <DetailRow label="Uyarı" value={preview.contractTypeWarning} tone="warning" />
            ) : null}
            <DetailRow label="Aciliyet" value={urgencyLabel} tone={preview.isUrgent ? 'danger' : 'default'} />
            <DetailRow label="Tahmini yakıt gideri" value={formatMoney(preview.estimatedFuelCost)} tone="muted" />
            <DetailRow
              label="Tahmini bakım gideri"
              value={formatMoney(preview.estimatedMaintenanceCost)}
              tone="muted"
            />
            <DetailRow
              label="Uygunluk durumu"
              value={availabilityLabel}
              tone={canStart ? 'success' : 'warning'}
            />
          </ScrollView>

          {!canStart && availability.message ? (
            <Text style={styles.footerNote} numberOfLines={4}>
              {availability.message}
            </Text>
          ) : null}

          <View style={styles.actionsRow}>
            <ActionButton label="Kapat" onPress={onClose} variant="secondary" />
            <ActionButton
              label={canStart ? 'Ekibi Seç' : 'Alınamaz'}
              onPress={() => onSelectTeam?.()}
              variant={canStart ? 'primary' : 'disabled'}
              disabled={!canStart}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatTimeLeft(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) {
    return `${h}s ${m}dk`;
  }
  return `${m}dk`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  card: {
    maxHeight: '88%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.sectionTitle,
    fontWeight: '800',
    marginBottom: 2,
  },
  routeLine: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  scroll: {
    maxHeight: 360,
  },
  scrollContent: {
    gap: 2,
    paddingBottom: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  detailLabel: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  detailValue: {
    flex: 1.2,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  footerNote: {
    marginTop: spacing.sm,
    fontSize: 11,
    lineHeight: 16,
    color: colors.warning,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
});
