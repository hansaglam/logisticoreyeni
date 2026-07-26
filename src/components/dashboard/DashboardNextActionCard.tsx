import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getOnboardingArtwork } from '../../assets/onboardingAssets';
import { GameIcon } from '../ui';
import type { GameIconName } from '../../theme/icons';
import type { OnboardingStepId } from '../../types/game';
import type { NextActionVariant } from './dashboardHubLogic';

const NARROW_BREAKPOINT = 360;
const CARD_HEIGHT = 154;
const CARD_HEIGHT_NARROW = 150;

const ARTWORK_COLUMN_WIDTH = 110;
const ARTWORK_COLUMN_HEIGHT = 62;
const ARTWORK_IMAGE_WIDTH = 104;
const ARTWORK_IMAGE_HEIGHT = 58;

const ARTWORK_COLUMN_WIDTH_NARROW = 91;
const ARTWORK_IMAGE_WIDTH_NARROW = 87;
const ARTWORK_IMAGE_HEIGHT_NARROW = 52;

export interface DashboardNextActionCardProps {
  stepId: OnboardingStepId;
  title: string;
  description: string;
  ctaLabel: string;
  onPress: () => void;
  variant?: NextActionVariant;
  icon?: GameIconName;
  progressLabel: string;
  stepIndex: number;
  totalSteps: number;
}

const CARD_BG = '#07172C';
const CTA_BLUE = '#2388FF';

const STEP_DISPLAY: Record<
  OnboardingStepId,
  { title: string; description: string; guideIcon: GameIconName; accent: string }
> = {
  choose_first_contract: {
    title: 'İlk İşini Seç',
    description: 'Uygun bir sözleşme seçerek operasyonuna başla.',
    guideIcon: 'contract',
    accent: '#2388FF',
  },
  assign_team: {
    title: 'Kamyon ve Şoför Ata',
    description: 'Yüke uygun araç ve müsait şoförü görevlendir.',
    guideIcon: 'truck',
    accent: '#28C6E8',
  },
  track_delivery: {
    title: 'Teslimatı Takip Et',
    description: 'Rotayı ve kalan süreyi haritadan izle.',
    guideIcon: 'map',
    accent: '#39A0FF',
  },
  complete_first_delivery: {
    title: 'İlk Teslimatını Tamamla',
    description: 'Teslimatı bitirerek ödeme ve deneyim kazan.',
    guideIcon: 'success',
    accent: '#11C96B',
  },
  claim_first_reward: {
    title: 'İlk Ödülünü Al',
    description: 'Hazır görev ödülünü alarak şirketini güçlendir.',
    guideIcon: 'level',
    accent: '#FFAA00',
  },
};

const STEP_ARTWORK_SCALE: Record<OnboardingStepId, number> = {
  choose_first_contract: 1,
  assign_team: 1.03,
  track_delivery: 1.08,
  complete_first_delivery: 1.08,
  claim_first_reward: 1.1,
};

function StepDots({
  stepIndex,
  totalSteps,
  activeAccent,
}: {
  stepIndex: number;
  totalSteps: number;
  activeAccent: string;
}) {
  return (
    <View style={styles.stepDots}>
      {Array.from({ length: totalSteps }, (_, index) => {
        const isCompleted = index < stepIndex - 1;
        const isActive = index === stepIndex - 1;
        return (
          <View
            key={index}
            style={[
              styles.stepDot,
              isCompleted && styles.stepDotCompleted,
              isActive && { backgroundColor: activeAccent },
              !isCompleted && !isActive && styles.stepDotPending,
            ]}
          />
        );
      })}
    </View>
  );
}

export default function DashboardNextActionCard({
  stepId,
  title: _title,
  description: _description,
  ctaLabel,
  onPress,
  progressLabel,
  stepIndex,
  totalSteps,
}: DashboardNextActionCardProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < NARROW_BREAKPOINT;
  const stepDisplay = STEP_DISPLAY[stepId];
  const displayTitle = stepDisplay?.title ?? _title;
  const displayDescription = stepDisplay?.description ?? _description;
  const guideIcon = stepDisplay?.guideIcon ?? 'contract';
  const accent = stepDisplay?.accent ?? '#39A0FF';
  const artwork = getOnboardingArtwork(stepId);
  const artworkScale = STEP_ARTWORK_SCALE[stepId];

  const artworkColumnWidth = isNarrow ? ARTWORK_COLUMN_WIDTH_NARROW : ARTWORK_COLUMN_WIDTH;
  const artworkImageWidth = isNarrow ? ARTWORK_IMAGE_WIDTH_NARROW : ARTWORK_IMAGE_WIDTH;
  const artworkImageHeight = isNarrow ? ARTWORK_IMAGE_HEIGHT_NARROW : ARTWORK_IMAGE_HEIGHT;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [stepIndex, fadeAnim, slideAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <View style={[styles.card, isNarrow && styles.cardNarrow]}>
        <View style={styles.cardBgGlowTop} pointerEvents="none" />
        <View style={styles.cardBgTintBottom} pointerEvents="none" />

        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconWrap}>
              <GameIcon name={guideIcon} size={isNarrow ? 12 : 13} color={accent} />
            </View>
            <Text
              style={styles.headerLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {progressLabel}
            </Text>
          </View>
          <StepDots stepIndex={stepIndex} totalSteps={totalSteps} activeAccent={accent} />
        </View>

        <View style={[styles.mainRow, isNarrow && styles.mainRowNarrow]}>
          <View style={styles.textColumn}>
            <Text
              style={[styles.title, isNarrow && styles.titleNarrow]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {displayTitle}
            </Text>
            <Text
              style={[styles.description, isNarrow && styles.descriptionNarrow]}
              numberOfLines={2}
            >
              {displayDescription}
            </Text>
          </View>

          {artwork != null ? (
            <View
              style={[
                styles.artworkColumn,
                { width: artworkColumnWidth, height: ARTWORK_COLUMN_HEIGHT },
              ]}
              pointerEvents="none"
            >
              <Image
                source={artwork}
                style={{
                  width: artworkImageWidth,
                  height: artworkImageHeight,
                  opacity: 1,
                  backgroundColor: 'transparent',
                  transform: [{ scale: artworkScale }],
                }}
                resizeMode="contain"
              />
            </View>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.ctaButton,
            isNarrow && styles.ctaButtonNarrow,
            pressed && styles.ctaButtonPressed,
          ]}
          onPress={onPress}
        >
          <View style={styles.ctaHighlight} pointerEvents="none" />
          <View style={styles.ctaShade} pointerEvents="none" />
          <View style={styles.ctaContentRow}>
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
            <View style={styles.ctaChevron}>
              <GameIcon name="chevronRight" size={14} color="#FFFFFF" />
            </View>
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.72)',
    backgroundColor: CARD_BG,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: CTA_BLUE,
        shadowOpacity: 0.1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  cardNarrow: {
    height: CARD_HEIGHT_NARROW,
  },
  cardBgGlowTop: {
    position: 'absolute',
    right: -40,
    top: -30,
    width: 150,
    height: 110,
    borderRadius: 999,
    backgroundColor: 'rgba(35, 136, 255, 0.035)',
  },
  cardBgTintBottom: {
    position: 'absolute',
    left: -24,
    bottom: -20,
    width: 120,
    height: 90,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 20, 50, 0.045)',
  },
  headerRow: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  headerIconWrap: {
    marginRight: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#39A0FF',
    flexShrink: 1,
  },
  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 8,
    marginRight: 2,
    flexShrink: 0,
    alignSelf: 'center',
  },
  stepDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  stepDotCompleted: {
    backgroundColor: '#2388FF',
  },
  stepDotPending: {
    backgroundColor: 'rgba(50, 95, 150, 0.32)',
  },
  mainRow: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    minWidth: 0,
  },
  mainRowNarrow: {
    marginBottom: 4,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingRight: 8,
  },
  title: {
    fontSize: 18,
    lineHeight: 21,
    fontWeight: '800',
    color: '#F3F7FF',
  },
  titleNarrow: {
    fontSize: 16.5,
    lineHeight: 20,
  },
  description: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '400',
    color: '#A9B6CC',
    marginTop: 2,
  },
  descriptionNarrow: {
    fontSize: 10,
    lineHeight: 13,
  },
  artworkColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'visible',
    backgroundColor: 'transparent',
  },
  ctaButton: {
    height: 42,
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: 13,
    marginTop: 0,
    marginBottom: 0,
    overflow: 'hidden',
    backgroundColor: CTA_BLUE,
    borderWidth: 1,
    borderColor: 'rgba(74, 168, 255, 0.85)',
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: CTA_BLUE,
        shadowOpacity: 0.16,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  ctaButtonNarrow: {
    height: 40,
  },
  ctaButtonPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.985 }],
  },
  ctaHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
  },
  ctaShade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: 'rgba(0, 38, 100, 0.10)',
    borderBottomLeftRadius: 13,
    borderBottomRightRadius: 13,
  },
  ctaContentRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  ctaLabel: {
    fontSize: 14.5,
    lineHeight: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  ctaChevron: {
    marginLeft: 8,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
