import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../ui';
import { colors, spacing, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';

export interface DangerZoneCardProps {
  expanded: boolean;
  onToggle: () => void;
  isSigningOut: boolean;
  isDeleting: boolean;
  isSwitchingAccount: boolean;
  isGuest: boolean;
  isReady: boolean;
  deleteConfirmStep: 0 | 1;
  onSignOut: () => void;
  onDelete: () => void;
}

export default function DangerZoneCard({
  expanded,
  onToggle,
  isSigningOut,
  isDeleting,
  isSwitchingAccount,
  isGuest,
  isReady,
  deleteConfirmStep,
  onSignOut,
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
          <GameIcon name="warning" size={16} color={colors.danger} />
          <Text style={styles.title}>Tehlikeli İşlemler</Text>
        </View>
        <GameIcon
          name={expanded ? 'chevronUp' : 'chevronDown'}
          size={16}
          color={colors.danger}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.actions}>
          <ActionButton
            label={isSigningOut ? 'Çıkış yapılıyor…' : 'Çıkış Yap'}
            onPress={onSignOut}
            variant="secondary"
            compact
            disabled={isSwitchingAccount || isSigningOut || isDeleting}
          />
          <ActionButton
            label={
              isDeleting
                ? 'Siliniyor…'
                : deleteConfirmStep === 1
                  ? 'Silme İşlemini Onayla'
                  : isGuest
                    ? 'Misafir Kaydını Sil'
                    : 'Hesabı Sil'
            }
            onPress={onDelete}
            variant="danger"
            compact
            disabled={isDeleting || isSwitchingAccount || isSigningOut || !isReady}
          />
          {deleteConfirmStep === 1 ? (
            <Text style={styles.hint}>
              Silinecek: yerel oyun kaydı, bulut verileri ve hesap bağlantısı.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.32)',
    backgroundColor: 'rgba(127, 29, 29, 0.12)',
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  toggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  togglePressed: {
    opacity: 0.92,
  },
  toggleCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.bodySmall,
    color: colors.danger,
    fontWeight: '800',
  },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(239, 68, 68, 0.16)',
    paddingTop: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: colors.danger,
    lineHeight: 16,
  },
});
