import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AccountCenterTab } from '../../hooks/useAccountCenter';
import { colors, spacing, typography } from '../../theme';
import { ACCOUNT_SECTION_GAP } from './accountCenterTheme';
import { ACCOUNT_CENTER_TABS } from './constants';

export interface AccountSegmentedTabsProps {
  active: AccountCenterTab;
  onChange: (tab: AccountCenterTab) => void;
}

export default function AccountSegmentedTabs({ active, onChange }: AccountSegmentedTabsProps) {
  return (
    <View
      style={styles.container}
      accessibilityRole="tablist"
      accessibilityLabel="Hesap Merkezi sekmeleri"
    >
      {ACCOUNT_CENTER_TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            style={({ pressed }) => [
              styles.tab,
              selected && styles.tabActive,
              pressed && !selected && styles.tabPressed,
            ]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: ACCOUNT_SECTION_GAP,
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(56, 129, 200, 0.18)',
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  tabActive: {
    backgroundColor: 'rgba(35, 136, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.38)',
  },
  tabPressed: {
    opacity: 0.88,
  },
  label: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 13,
  },
  labelActive: {
    color: colors.textPrimary,
  },
});
