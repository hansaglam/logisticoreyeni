import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing } from '../../theme';
import { AppDialog } from '../ui';

interface MapHelpMenuProps {
  helpGuideOnPress: () => void;
  helpGuideDisabled?: boolean;
  helpGuideAccessibilityLabel: string;
  onSyncMap: () => void;
  onInspectVehicles: () => void;
}

export default function MapHelpMenu({
  helpGuideOnPress,
  helpGuideDisabled = false,
  helpGuideAccessibilityLabel,
  onSyncMap,
  onInspectVehicles,
}: MapHelpMenuProps) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Pressable
        style={[styles.button, helpGuideDisabled && styles.buttonDisabled]}
        onPress={() => setVisible(true)}
        disabled={helpGuideDisabled}
        accessibilityRole="button"
        accessibilityLabel="Harita yardımı"
        hitSlop={8}
      >
        <Text style={styles.label}>?</Text>
      </Pressable>
      <AppDialog
        visible={visible}
        title="Harita Yardımı"
        message="Haritadaki araç konumlarını filo ve aktif teslimatlarla yeniden eşleştirir. Oyun ilerlemesi silinmez."
        variant="info"
        footerNote="Geçerli teslimatlar ve sahip olunan araçlar korunur."
        actions={[
          {
            label: 'Haritayı Senkronize Et',
            onPress: onSyncMap,
            variant: 'primary',
          },
          {
            label: 'Araç Durumlarını Kontrol Et',
            onPress: onInspectVehicles,
            variant: 'secondary',
          },
          {
            label: helpGuideAccessibilityLabel || 'Yardım & Rehber',
            onPress: helpGuideOnPress,
            variant: 'secondary',
            disabled: helpGuideDisabled,
          },
        ]}
        onDismiss={() => setVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${colors.info}44`,
    backgroundColor: `${colors.info}14`,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  label: {
    color: colors.info,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
});
