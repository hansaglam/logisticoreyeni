import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
  icon?: GameIconName;
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  activeKey: T;
  onChange: (key: T) => void;
  accentColor?: string;
  compact?: boolean;
}

export default function SegmentedControl<T extends string>({
  options,
  activeKey,
  onChange,
  accentColor = colors.accentBlue,
  compact = false,
}: SegmentedControlProps<T>) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {options.map((option) => {
        const isActive = option.key === activeKey;
        return (
          <TouchableOpacity
            key={option.key}
            style={[
              styles.segment,
              compact && styles.segmentCompact,
              isActive && {
                backgroundColor: `${accentColor}22`,
                borderColor: accentColor,
              },
            ]}
            onPress={() => onChange(option.key)}
            activeOpacity={0.85}
          >
            {option.icon ? (
              <GameIcon
                name={option.icon}
                size={14}
                color={isActive ? accentColor : colors.textMuted}
              />
            ) : null}
            <View style={styles.labelRow}>
              <Text
                style={[
                  styles.label,
                  isActive && { color: accentColor, fontWeight: '800' },
                ]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
              {typeof option.count === 'number' && option.count > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>
                    {option.count > 99 ? '99+' : option.count}
                  </Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  containerCompact: {
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    gap: 2,
  },
  segmentCompact: {
    minHeight: 32,
    paddingHorizontal: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  countBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  countText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 11,
  },
});
