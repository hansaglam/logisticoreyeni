import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../ui';
import { colors, typography } from '../../theme';
import { logWarehouseLayout } from './warehouseLayoutDebug';
import { warehouseVisual } from './warehouseTheme';

interface WarehouseInfoBannerProps {
  onPress?: () => void;
}

export default function WarehouseInfoBanner({ onPress }: WarehouseInfoBannerProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Depo rehberini aç"
      onLayout={(event) => {
        logWarehouseLayout({
          infoBannerHeight: Math.round(event.nativeEvent.layout.height),
        });
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>
        <GameIcon name="alert" size={14} color={colors.info} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={2}>
          Ucuz al, depola, başka şehre taşı ve kârlı piyasada sat.
        </Text>
        <Text style={styles.line} numberOfLines={1}>
          Soğuk ürünler için soğuk depo ve uygun dorse gerekir.
        </Text>
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
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    backgroundColor: 'rgba(14, 28, 52, 0.95)',
    marginBottom: 12,
    minHeight: 64,
    maxHeight: 80,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 16,
  },
  line: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
});
