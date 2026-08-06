/**
 * Temaya uyumlu premium dialog kartı — native Alert yerine kullanılır.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { getSafeBottom, getSafeModalMaxHeight } from '../../constants/layout';
import { useAppSafeAreaInsets } from '../AppSafeAreaProvider';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

export type AppDialogVariant = 'info' | 'warning' | 'confirm' | 'danger' | 'success';

export type AppDialogDetailTone = 'default' | 'success' | 'warning' | 'danger' | 'muted';

export interface AppDialogDetailRow {
  label: string;
  value: string;
  tone?: AppDialogDetailTone;
}

export interface AppDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  variant?: AppDialogVariant;
  details?: AppDialogDetailRow[];
  footerNote?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  actions?: Array<{
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'destructive';
  }>;
  onConfirm?: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
}

const VARIANT_CONFIG: Record<
  AppDialogVariant,
  { icon: GameIconName; accent: string; soft: string; border: string }
> = {
  info: {
    icon: 'alert',
    accent: colors.info,
    soft: colors.infoSoft,
    border: 'rgba(56, 189, 248, 0.35)',
  },
  warning: {
    icon: 'warning',
    accent: colors.warning,
    soft: colors.warningSoft,
    border: 'rgba(245, 158, 11, 0.35)',
  },
  confirm: {
    icon: 'alert',
    accent: colors.accentBlue,
    soft: colors.accentBlueSoft,
    border: 'rgba(59, 130, 246, 0.35)',
  },
  danger: {
    icon: 'warning',
    accent: colors.danger,
    soft: colors.dangerSoft,
    border: 'rgba(239, 68, 68, 0.35)',
  },
  success: {
    icon: 'success',
    accent: colors.success,
    soft: colors.successSoft,
    border: 'rgba(34, 197, 94, 0.35)',
  },
};

function getDetailToneColor(tone: AppDialogDetailTone = 'default'): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    case 'muted':
      return colors.textMuted;
    default:
      return colors.textPrimary;
  }
}

function DialogActionButton({
  label,
  onPress,
  variant,
  style,
}: {
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary' | 'destructive';
  style?: StyleProp<ViewStyle>;
}) {
  const palette =
    variant === 'primary'
      ? {
          backgroundColor: colors.accentBlue,
          borderColor: colors.accentBlue,
          textColor: colors.textPrimary,
        }
      : variant === 'destructive'
        ? {
            backgroundColor: colors.dangerSoft,
            borderColor: colors.danger,
            textColor: colors.danger,
          }
        : {
            backgroundColor: colors.cardSoft,
            borderColor: colors.borderStrong,
            textColor: colors.textSecondary,
          };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          opacity: pressed ? 0.88 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.actionButtonText, { color: palette.textColor }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function AppDialog({
  visible,
  title,
  message,
  variant = 'info',
  details = [],
  footerNote,
  confirmLabel = 'Tamam',
  cancelLabel,
  destructive = false,
  actions,
  onConfirm,
  onCancel,
  onDismiss,
}: AppDialogProps) {
  const config = VARIANT_CONFIG[variant];
  const insets = useAppSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const cardMaxHeight = getSafeModalMaxHeight(windowHeight, insets, 0.82);
  const hasCustomActions = Boolean(actions && actions.length > 0);
  const isDualAction = !hasCustomActions && Boolean(cancelLabel);
  const confirmVariant = destructive ? 'destructive' : 'primary';

  const handleDismiss = () => {
    onDismiss?.();
  };

  const handleCancel = () => {
    const fn = onCancel;
    handleDismiss();
    if (fn) {
      queueMicrotask(() => fn());
    }
  };

  const handleConfirm = () => {
    const fn = onConfirm;
    handleDismiss();
    if (fn) {
      queueMicrotask(() => fn());
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <Pressable
        style={[
          styles.overlay,
          {
            paddingTop: Math.max(insets.top, 12) + spacing.md,
            paddingBottom: getSafeBottom(insets) + spacing.md,
          },
        ]}
        onPress={handleDismiss}
      >
        <Pressable
          style={[styles.card, shadows.glowBlue, { borderColor: config.border, maxHeight: cardMaxHeight }]}
          onPress={() => {}}
        >
          <View style={[styles.iconBadge, { backgroundColor: config.soft, borderColor: config.border }]}>
            <GameIcon name={config.icon} size={22} color={config.accent} />
          </View>

          <Text style={styles.title}>{title}</Text>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {message ? <Text style={styles.message}>{message}</Text> : null}

            {details.length > 0 ? (
              <View style={styles.detailsBlock}>
                {details.map((row) => (
                  <View key={`${row.label}-${row.value}`} style={styles.detailRow}>
                    <Text style={styles.detailLabel} numberOfLines={2}>
                      {row.label}
                    </Text>
                    <Text
                      style={[styles.detailValue, { color: getDetailToneColor(row.tone) }]}
                      numberOfLines={3}
                    >
                      {row.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
          </ScrollView>

          <View
            style={[
              styles.actionsRow,
              hasCustomActions && styles.actionsRowStacked,
              !isDualAction && !hasCustomActions && styles.actionsRowSingle,
            ]}
          >
            {hasCustomActions ? (
              actions!.map((action) => (
                <DialogActionButton
                  key={action.label}
                  label={action.label}
                  onPress={() => {
                    const fn = action.onPress;
                    handleDismiss();
                    // Nested dialog (ör. Yükselt confirm) dismiss tarafından silinmesin.
                    queueMicrotask(() => fn());
                  }}
                  variant={action.variant ?? 'secondary'}
                  style={styles.actionFull}
                />
              ))
            ) : isDualAction ? (
              <>
                <DialogActionButton
                  label={cancelLabel ?? 'Vazgeç'}
                  onPress={handleCancel}
                  variant="secondary"
                  style={styles.actionHalf}
                />
                <DialogActionButton
                  label={confirmLabel}
                  onPress={handleConfirm}
                  variant={confirmVariant}
                  style={styles.actionHalf}
                />
              </>
            ) : (
              <DialogActionButton
                label={confirmLabel}
                onPress={handleConfirm}
                variant="primary"
                style={styles.actionFull}
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 8, 20, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111B2E',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyScrollContent: {
    paddingBottom: spacing.xs,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.screenTitle,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  detailsBlock: {
    backgroundColor: colors.cardSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailLabel: {
    ...typography.bodySmall,
    color: colors.textMuted,
    flex: 1,
  },
  detailValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
    maxWidth: '58%',
  },
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionsRowStacked: {
    flexDirection: 'column',
  },
  actionsRowSingle: {
    flexDirection: 'column',
  },
  actionButton: {
    minHeight: 52,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionButtonText: {
    ...typography.buttonText,
    fontSize: 16,
    fontWeight: '700',
  },
  actionHalf: {
    flex: 1,
  },
  actionFull: {
    width: '100%',
  },
});
