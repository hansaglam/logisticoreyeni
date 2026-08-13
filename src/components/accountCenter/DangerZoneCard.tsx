import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../ui';
import { colors, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';
import { ACCOUNT_CARD_PADDING } from './accountCenterTheme';

export interface DangerZoneCardProps {
  expanded: boolean;
  onToggle: () => void;
  isDeleting: boolean;
  isSwitchingAccount: boolean;
  isGuest: boolean;
  isReady: boolean;
  onDelete: () => void;
}

export default function DangerZoneCard({
  expanded,
  onToggle,
  isDeleting,
  isSwitchingAccount,
  isGuest,
  isReady,
  onDelete,
}: DangerZoneCardProps) {
  return (
    <View style={styles.zone}>
      <Pressable
        style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Tehlikeli İşlemler"
      >
        <View style={styles.toggleCopy}>
          <GameIcon name="warning" size={14} color={colors.danger} />
          <Text style={styles.title}>Tehlikeli İşlemler</Text>
        </View>
        <GameIcon
          name={expanded ? 'chevronUp' : 'chevronDown'}
          size={14}
          color={colors.textMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.actions}>
          <Text style={styles.deleteTitle}>Hesabı Sil</Text>
          <Text style={styles.deleteHint}>
            Tüm oyun verilerini kalıcı olarak sil.
          </Text>
          <ActionButton
            label={isDeleting ? 'Siliniyor…' : isGuest ? 'Misafir Kaydını Sil' : 'Hesabı Sil'}
            onPress={onDelete}
            variant="danger"
            compact
            disabled={isDeleting || isSwitchingAccount || !isReady}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.22)',
    backgroundColor: '#0A1628',
    overflow: 'hidden',
  },
  toggle: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ACCOUNT_CARD_PADDING,
    paddingVertical: 10,
  },
  togglePressed: {
    opacity: 0.92,
  },
  toggleCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '800',
    fontSize: 15,
  },
  actions: {
    paddingHorizontal: ACCOUNT_CARD_PADDING,
    paddingBottom: ACCOUNT_CARD_PADDING,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(239, 68, 68, 0.12)',
    paddingTop: 10,
  },
  deleteTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.danger,
  },
  deleteHint: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
});
