import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { GameIcon } from '../ui';
import type { GameIconName } from '../../theme/icons';
import { colors } from '../../theme';
import { FLEET_SEGMENT_BG, FLEET_SEGMENT_BORDER } from './fleetTheme';

export type FleetTabKey = 'trucks' | 'drivers' | 'trailers' | 'upgrades';

export const FLEET_TABS: ReadonlyArray<{
  key: FleetTabKey;
  label: string;
  icon: GameIconName;
}> = [
  { key: 'trucks', label: 'Kamyonlar', icon: 'truck' },
  { key: 'drivers', label: 'Şoförler', icon: 'driver' },
  { key: 'trailers', label: 'Dorseler', icon: 'route' },
  { key: 'upgrades', label: 'Geliştirmeler', icon: 'upgrade' },
];

interface FleetTabSegmentProps {
  activeTab: FleetTabKey;
  onChange: (tab: FleetTabKey) => void;
}

export default function FleetTabSegment({
  activeTab,
  onChange,
}: FleetTabSegmentProps) {
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const labelStyle = compact ? styles.segmentLabelCompact : styles.segmentLabel;

  const tabs = useMemo(
    () =>
      FLEET_TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            style={[styles.segmentTab, isActive && styles.segmentTabActive]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <GameIcon
              name={tab.icon}
              size={compact ? 13 : 14}
              color={isActive ? colors.accentBlue : colors.textMuted}
            />
            <Text
              style={[labelStyle, isActive && styles.segmentLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      }),
    [activeTab, compact, labelStyle, onChange],
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.segmentScrollContent}
      style={styles.segmentScroll}
    >
      <View style={styles.segmentContainer}>{tabs}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  segmentScroll: {
    flexGrow: 0,
  },
  segmentScrollContent: {
    flexGrow: 1,
  },
  segmentContainer: {
    minHeight: 44,
    minWidth: '100%',
    borderRadius: 14,
    padding: 3,
    backgroundColor: FLEET_SEGMENT_BG,
    borderWidth: 1,
    borderColor: FLEET_SEGMENT_BORDER,
    flexDirection: 'row',
    gap: 3,
  },
  segmentTab: {
    flex: 1,
    minWidth: 72,
    minHeight: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  segmentTabActive: {
    backgroundColor: 'rgba(35,136,255,0.13)',
    borderColor: colors.accentBlue,
  },
  segmentLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8795AA',
  },
  segmentLabelCompact: {
    fontSize: 9,
    fontWeight: '600',
    color: '#8795AA',
  },
  segmentLabelActive: {
    color: colors.accentBlue,
    fontWeight: '700',
  },
});
