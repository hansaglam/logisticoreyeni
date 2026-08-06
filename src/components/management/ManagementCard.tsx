import React from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';
import {
  MANAGEMENT_CARD_ICON_GLYPH,
  MANAGEMENT_CARD_ICON_SIZE,
  MANAGEMENT_GRID_GAP,
  MANAGEMENT_TONE_STYLES,
  MANAGEMENT_TILE_MIN_HEIGHT,
} from './managementTheme';
import type { ManagementItem } from './managementTypes';

export interface ManagementCardProps {
  item: ManagementItem;
  width: number;
  disabled?: boolean;
  onPress: () => void;
}

function ManagementBadge({ count }: { count: number }) {
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.countBadge} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.countBadgeText} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
}

function AttentionBadge() {
  return (
    <View style={styles.attentionBadge} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.attentionBadgeText}>!</Text>
    </View>
  );
}

export default function ManagementCard({
  item,
  width,
  disabled = false,
  onPress,
}: ManagementCardProps) {
  const tone = MANAGEMENT_TONE_STYLES[item.tone];
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) {
        setReduceMotion(value);
      }
    });
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  const pressedScale = reduceMotion ? 1 : 0.98;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel}
      accessibilityHint={item.accessibilityHint}
      style={({ pressed }) => [
        styles.card,
        {
          width,
          minHeight: MANAGEMENT_TILE_MIN_HEIGHT,
          borderColor: pressed ? tone.borderAccent : 'rgba(56, 89, 130, 0.38)',
          transform: [{ scale: pressed && !disabled ? pressedScale : 1 }],
        },
      ]}
    >
      <View style={styles.topRow}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: tone.iconBackground,
              borderColor: tone.borderAccent,
            },
          ]}
        >
          <GameIcon name={item.icon} size={MANAGEMENT_CARD_ICON_GLYPH} color={tone.iconColor} />
        </View>
        {item.badge != null && item.badge > 0 ? (
          <ManagementBadge count={item.badge} />
        ) : item.badgeAttention ? (
          <AttentionBadge />
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {item.title}
      </Text>
      <Text
        style={[styles.subtitle, { color: tone.statusColor }]}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {item.subtitle}
      </Text>
    </Pressable>
  );
}

export function getManagementCardWidth(params: {
  containerWidth: number;
  gap?: number;
}): number {
  const gap = params.gap ?? MANAGEMENT_GRID_GAP;
  return (params.containerWidth - gap) / 2;
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    justifyContent: 'flex-start',
    gap: 5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    minHeight: MANAGEMENT_CARD_ICON_SIZE,
  },
  iconWrap: {
    width: MANAGEMENT_CARD_ICON_SIZE,
    height: MANAGEMENT_CARD_ICON_SIZE,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  title: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  subtitle: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentAmber,
    borderWidth: 1.5,
    borderColor: colors.surface2,
  },
  countBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13,
  },
  attentionBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251, 146, 60, 0.92)',
    borderWidth: 1.5,
    borderColor: colors.surface2,
  },
  attentionBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 15,
  },
});
