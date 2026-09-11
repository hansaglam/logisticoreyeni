/**
 * Presentational in-game contextual guide card.
 * No store / progression logic — callbacks only.
 */

import React, { memo, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MIN_TOUCH_TARGET, PAGE_HORIZONTAL_PADDING } from '../../constants/layout';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { GameIcon } from '../../components/ui';

const LIGHT_SURFACE = '#F7F9FC';
const LIGHT_TITLE = '#0B1220';
const LIGHT_BODY = '#5B6B82';
const LIGHT_BORDER = '#D7E0EE';
const LIGHT_CLOSE = '#6B7C94';
const DOT_INACTIVE = '#C5D0E0';

export type ContextualGuideCardProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  primaryLabel?: string;
  onPrimaryPress?: () => void;
  onDismiss?: () => void;
  /** Accessibility label for dismiss (manual replay: Eğitimden Çık). */
  dismissAccessibilityLabel?: string;
  currentStep?: number;
  totalSteps?: number;
  /** Extra space above tab bar / home indicator when floating. */
  bottomOffset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default memo(function ContextualGuideCard({
  title,
  description,
  icon,
  primaryLabel = 'İleri',
  onPrimaryPress,
  onDismiss,
  dismissAccessibilityLabel = 'Rehberi kapat',
  currentStep,
  totalSteps,
  bottomOffset = 0,
  style,
  testID,
}: ContextualGuideCardProps) {
  const insets = useSafeAreaInsets();
  const showSteps =
    typeof currentStep === 'number' &&
    typeof totalSteps === 'number' &&
    totalSteps > 0 &&
    currentStep >= 1;

  return (
    <View
      testID={testID}
      pointerEvents="box-none"
      style={[
        styles.anchor,
        {
          paddingBottom: Math.max(bottomOffset, insets.bottom, spacing.sm),
          paddingHorizontal: PAGE_HORIZONTAL_PADDING,
        },
        style,
      ]}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${description}`}
    >
      <View style={styles.card}>
        <View style={styles.topRow}>
          {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
          <View style={styles.titleBlock}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          </View>
          {onDismiss ? (
            <TouchableOpacity
              testID={testID ? `${testID}-dismiss` : undefined}
              onPress={onDismiss}
              style={styles.closeButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={dismissAccessibilityLabel}
              activeOpacity={0.7}
            >
              <GameIcon name="close" size={18} color={LIGHT_CLOSE} />
            </TouchableOpacity>
          ) : (
            <View style={styles.closeSpacer} />
          )}
        </View>

        <Text style={styles.description}>{description}</Text>

        {showSteps ? (
          <View
            style={styles.dotsRow}
            accessibilityLabel={`Adım ${currentStep} / ${totalSteps}`}
          >
            {Array.from({ length: totalSteps }, (_, index) => {
              const active = index + 1 === currentStep;
              return (
                <View
                  key={`dot-${index}`}
                  style={[styles.dot, active ? styles.dotActive : styles.dotInactive]}
                />
              );
            })}
          </View>
        ) : null}

        {onPrimaryPress ? (
          <TouchableOpacity
            testID={testID ? `${testID}-primary` : undefined}
            style={styles.primaryButton}
            onPress={onPrimaryPress}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
          >
            <Text style={styles.primaryLabel}>{primaryLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  anchor: {
    width: '100%',
    alignSelf: 'stretch',
  },
  card: {
    backgroundColor: LIGHT_SURFACE,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: LIGHT_BORDER,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    // Prefer soft elevation — medium shadow is heavier on low-end Android.
    ...shadows.soft,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  iconSlot: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: 'rgba(35, 136, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  title: {
    ...typography.cardTitle,
    color: LIGHT_TITLE,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  closeButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    marginTop: -6,
    marginRight: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeSpacer: {
    width: spacing.lg,
  },
  description: {
    ...typography.body,
    color: LIGHT_BODY,
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 19,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  dotActive: {
    backgroundColor: colors.accentAmber,
    width: 8,
    height: 8,
  },
  dotInactive: {
    backgroundColor: DOT_INACTIVE,
  },
  primaryButton: {
    marginTop: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.button,
    backgroundColor: colors.accentAmber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryLabel: {
    ...typography.buttonText,
    color: '#1A1200',
    fontWeight: '800',
  },
});
