import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { GameIcon } from '../ui';
import {
  MAP_ACCENT,
  MAP_ACCENT_BORDER,
  MAP_HEADER_ICON_RADIUS,
  MAP_HEADER_ICON_SIZE,
  MAP_HEADER_ICON_SIZE_COMPACT,
  MAP_HEADER_REFRESH_SIZE,
  MAP_HEADER_REFRESH_SIZE_COMPACT,
  MAP_HEADER_SUBTITLE_SIZE,
  MAP_HEADER_TITLE_SIZE,
  MAP_HEADER_TITLE_SIZE_COMPACT,
  MAP_MUTED,
  MAP_SURFACE,
  MAP_TITLE_COLOR,
} from './mapTheme';

const COMPACT_BREAKPOINT = 360;

export interface MapHeaderProps {
  onRefresh?: () => void;
}

export default function MapHeader({ onRefresh }: MapHeaderProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < COMPACT_BREAKPOINT;
  const iconSize = isCompact ? MAP_HEADER_ICON_SIZE_COMPACT : MAP_HEADER_ICON_SIZE;
  const refreshSize = isCompact ? MAP_HEADER_REFRESH_SIZE_COMPACT : MAP_HEADER_REFRESH_SIZE;
  const titleSize = isCompact ? MAP_HEADER_TITLE_SIZE_COMPACT : MAP_HEADER_TITLE_SIZE;

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.iconBox,
          {
            width: iconSize,
            height: iconSize,
            borderRadius: MAP_HEADER_ICON_RADIUS,
          },
        ]}
      >
        <GameIcon name="map" size={isCompact ? 24 : 26} color={MAP_ACCENT} />
      </View>

      <View style={styles.textCol}>
        <Text style={[styles.title, { fontSize: titleSize, lineHeight: titleSize + 4 }]} numberOfLines={1}>
          Türkiye Lojistik Ağı
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          Şehirler, rotalar ve aktif teslimatlar
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.refreshBtn,
          {
            width: refreshSize,
            height: refreshSize,
          },
        ]}
        onPress={onRefresh}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Haritayı yenile"
      >
        <GameIcon name="refresh" size={isCompact ? 18 : 20} color={MAP_TITLE_COLOR} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontWeight: '800',
    color: MAP_TITLE_COLOR,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: MAP_HEADER_SUBTITLE_SIZE,
    color: MAP_MUTED,
    lineHeight: 15,
  },
  refreshBtn: {
    borderRadius: 14,
    backgroundColor: MAP_SURFACE,
    borderWidth: 1,
    borderColor: MAP_ACCENT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
