import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';

export const COUNTRY_MODE_TABS = ['map', 'cities', 'contracts', 'trade'] as const;
export type CountryModeTab = (typeof COUNTRY_MODE_TABS)[number];

const LABELS: Record<CountryModeTab, string> = {
  map: mapV2ExperienceCopy.tabMap,
  cities: mapV2ExperienceCopy.tabCities,
  contracts: mapV2ExperienceCopy.tabContracts,
  trade: mapV2ExperienceCopy.tabTrade,
};

type Props = {
  active: CountryModeTab;
  onChange: (tab: CountryModeTab) => void;
};

export default function MapV2CountryModeTabs({ active, onChange }: Props) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {COUNTRY_MODE_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab)}
            hitSlop={6}
            style={styles.tab}
          >
            <Text style={[styles.label, selected && styles.labelOn]} numberOfLines={1}>
              {LABELS[tab]}
            </Text>
            <View style={[styles.underline, selected && styles.underlineOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xs,
  },
  label: { ...typography.tabLabel, color: colors.textMuted },
  labelOn: { color: colors.primaryLight, fontWeight: '800' },
  underline: {
    marginTop: 6,
    height: 2,
    width: '72%',
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  underlineOn: { backgroundColor: colors.primaryLight },
});
