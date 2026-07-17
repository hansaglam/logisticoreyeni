import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { GameIcon } from '../ui';
import type { GameIconName } from '../../theme/icons';
import { colors, radius, spacing, typography } from '../../theme';

export type OnboardingHintBadge = 'REHBER' | 'İPUCU';

export interface OnboardingHintCardProps {
  title: string;
  description: string;
  icon?: GameIconName;
  badgeLabel?: OnboardingHintBadge;
  accentVariant?: 'guide' | 'reward';
  onDismiss: () => void;
  style?: StyleProp<ViewStyle>;
}

const GUIDE_CYAN = '#38BDF8';
const GUIDE_BORDER = 'rgba(56, 189, 248, 0.42)';
const REWARD_BORDER = 'rgba(245, 158, 11, 0.4)';

export default function OnboardingHintCard({
  title,
  description,
  icon = 'alert',
  badgeLabel = 'REHBER',
  accentVariant = 'guide',
  onDismiss,
  style,
}: OnboardingHintCardProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(6)).current;

  const isReward = accentVariant === 'reward';
  const accentColor = isReward ? colors.accentAmber : GUIDE_CYAN;
  const iconBg = isReward ? 'rgba(245, 158, 11, 0.18)' : 'rgba(14, 165, 233, 0.18)';
  const iconBorder = isReward ? 'rgba(245, 158, 11, 0.42)' : 'rgba(56, 189, 248, 0.42)';
  const borderColor = isReward ? REWARD_BORDER : GUIDE_BORDER;
  const glowColor = isReward ? 'rgba(245, 158, 11, 0.08)' : 'rgba(56, 189, 248, 0.09)';
  const badgeBg = isReward ? colors.accentAmberSoft : 'rgba(56, 189, 248, 0.14)';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View
      style={[
        styles.outer,
        isReward && styles.outerReward,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
        style,
      ]}
    >
      <View style={[styles.card, { borderColor }]}>
        <View style={[styles.accentStrip, { backgroundColor: accentColor }]} />
        <View style={[styles.glowOverlay, { backgroundColor: glowColor }]} pointerEvents="none" />
        <View
          style={[
            styles.glowOrb,
            {
              backgroundColor: isReward
                ? 'rgba(245, 158, 11, 0.1)'
                : 'rgba(56, 189, 248, 0.1)',
            },
          ]}
          pointerEvents="none"
        />

        <View style={[styles.iconWrap, { backgroundColor: iconBg, borderColor: iconBorder }]}>
          <GameIcon name={icon} size={15} color={accentColor} />
        </View>

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={[styles.badge, { borderColor, backgroundColor: badgeBg }]}>
              <Text style={[styles.badgeText, { color: accentColor }]}>{badgeLabel}</Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.65}
          accessibilityRole="button"
          accessibilityLabel="İpucunu kapat"
        >
          <GameIcon name="close" size={10} color="rgba(148, 163, 184, 0.85)" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginBottom: 10,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: GUIDE_CYAN,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.16,
        shadowRadius: 5,
      },
    }),
  },
  outerReward: {
    ...Platform.select({
      ios: {
        shadowColor: colors.accentAmber,
      },
    }),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 9,
    paddingRight: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#08111F',
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  accentStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    opacity: 0.95,
  },
  glowOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  glowOrb: {
    position: 'absolute',
    top: -30,
    right: -24,
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 1 },
    }),
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    paddingRight: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  badge: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  title: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
    flex: 1,
    minWidth: 0,
  },
  description: {
    ...typography.caption,
    fontSize: 10.5,
    color: colors.textSecondary,
    lineHeight: 14,
  },
  dismissButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
  },
});
