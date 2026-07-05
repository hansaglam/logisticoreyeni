import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import ActionButton from './ActionButton';
import GameIcon from './GameIcon';

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: GameIconName;
  actionLabel?: string;
  onAction?: () => void;
  /** Ana sayfa vb. için daha az yer kaplayan boş durum */
  compact?: boolean;
}

export default function EmptyState({
  title,
  message,
  icon = 'inventory',
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
        <GameIcon name={icon} size={compact ? 22 : 28} color={colors.textMuted} />
      </View>
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, compact && styles.messageCompact]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <ActionButton label={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    fontSize: 15,
    textAlign: 'center',
  },
  message: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 280,
  },
  action: {
    marginTop: spacing.lg,
  },
  containerCompact: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  iconWrapCompact: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginBottom: spacing.sm,
  },
  titleCompact: {
    fontSize: 13,
  },
  messageCompact: {
    fontSize: 12,
    marginTop: spacing.xs,
    maxWidth: 260,
  },
});
