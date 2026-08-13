import React, { useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../ui';
import { colors, typography } from '../../theme';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import { warehouseLayout, warehouseVisual } from './warehouseTheme';

interface WarehouseInfoBannerProps {
  onPress?: () => void;
}

export default function WarehouseInfoBanner({ onPress }: WarehouseInfoBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((value) => !value);
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Depo ipucu"
      onLayout={(event) => {
        logWarehouseLayout({
          infoBannerHeight: Math.round(event.nativeEvent.layout.height),
        });
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.emoji} accessibilityElementsHidden>
        💡
      </Text>
      <View style={styles.textWrap}>
        <Text style={styles.kicker}>Depo İpucu</Text>
        <Text style={styles.title} numberOfLines={expanded ? 3 : 1}>
          Ucuza al · depola · doğru şehirde sat
        </Text>
        {expanded ? (
          <Text style={styles.detail} numberOfLines={3}>
            Soğuk ürünler için uygun depo gerekir.
          </Text>
        ) : null}
      </View>
      <GameIcon name="chevronRight" size={14} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.9,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: warehouseLayout.internalGap,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: warehouseVisual.border,
    backgroundColor: warehouseVisual.surfaceElevated,
    marginBottom: warehouseLayout.sectionGap,
    minHeight: 52,
  },
  emoji: {
    fontSize: 16,
    lineHeight: 20,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  kicker: {
    ...typography.caption,
    color: colors.accentAmber,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  title: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 16,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
});
