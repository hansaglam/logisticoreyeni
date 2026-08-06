import React from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';

import type { WorldEvent } from '../../types/game';
import { colors } from '../../theme';
import { GameIcon } from '../ui';
import {
  buildWorldEventDisplay,
  getImpactItemColors,
  getWorldEventToneColors,
  type WorldEventImpactDirection,
} from '../../utils/worldEventDisplay';
import { getWorldEventBorderAccent } from './marketTheme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface MarketWorldEventCardProps {
  event: WorldEvent;
  currentTime: number;
  expanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}

function impactArrow(direction: WorldEventImpactDirection): string {
  if (direction === 'up') return '↑';
  if (direction === 'down') return '↓';
  return '↕';
}

function MarketWorldEventCard({
  event,
  currentTime,
  expanded,
  onToggle,
  compact = false,
}: MarketWorldEventCardProps) {
  const { width } = useWindowDimensions();
  const narrow = width < 360;
  const display = buildWorldEventDisplay(event, currentTime);
  const toneColors = getWorldEventToneColors(display.tone);
  const accentStyle = getWorldEventBorderAccent(event.type);
  const visibleImpacts = expanded ? display.impactItems : display.impactItems.slice(0, 3);
  const visibleMeaning = expanded
    ? display.meaningBullets
    : display.meaningBullets.slice(0, 1);

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  if (compact) {
    return (
      <Pressable
        onPress={handleToggle}
        style={[styles.compactCard, accentStyle]}
        accessibilityRole="button"
        accessibilityLabel={`${display.title} olay detayını aç`}
      >
        <GameIcon name={display.iconName} size={14} color={display.accentColor} />
        <Text style={[styles.compactTitle, { color: display.accentColor }]} numberOfLines={1}>
          {display.title}
        </Text>
        <View style={[styles.statusBadge, styles.compactBadge, {
          backgroundColor: toneColors.badgeBg,
          borderColor: toneColors.badgeBorder,
        }]}>
          <Text style={[styles.statusBadgeText, { color: toneColors.badgeText }]}>
            {display.statusLabel}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, accentStyle]}>
      <Pressable
        onPress={handleToggle}
        style={styles.headerPressable}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Olay detayını kapat' : 'Olay detayını aç'}
      >
        <View style={styles.headerRow}>
          <View style={[styles.iconWrap, { backgroundColor: `${display.accentColor}18` }]}>
            <GameIcon name={display.iconName} size={narrow ? 16 : 18} color={display.accentColor} />
          </View>
          <View style={styles.headerText}>
            <View style={styles.titleRow}>
              <Text
                style={[styles.title, { color: display.accentColor }]}
                numberOfLines={2}
                adjustsFontSizeToFit={narrow}
                minimumFontScale={0.85}
              >
                {display.title}
              </Text>
              <View style={[styles.statusBadge, {
                backgroundColor: toneColors.badgeBg,
                borderColor: toneColors.badgeBorder,
              }]}>
                <Text style={[styles.statusBadgeText, { color: toneColors.badgeText }]}>
                  {display.statusLabel}
                </Text>
              </View>
            </View>
            {display.scopeLabel ? (
              <Text style={styles.scopeLabel} numberOfLines={1}>
                {display.scopeLabel}
              </Text>
            ) : null}
          </View>
          <GameIcon
            name={expanded ? 'chevronUp' : 'chevronDown'}
            size={16}
            color={colors.textMuted}
          />
        </View>

        <Text style={styles.shortDescription}>
          {display.isFallback ? 'Bu olay piyasa koşullarını etkiliyor. Detaylar yakında güncellenecek.' : display.shortDescription}
        </Text>

        {display.durationLabel ? (
          <View style={styles.durationRow}>
            <GameIcon name="time" size={11} color={colors.textMuted} />
            <Text style={styles.durationText}>{display.durationLabel}</Text>
          </View>
        ) : null}

        {visibleImpacts.length > 0 ? (
          <View style={styles.impactRow}>
            {visibleImpacts.map((item) => {
              const chipColors = getImpactItemColors(item.sentiment);
              return (
                <View
                  key={item.label}
                  style={[styles.impactChip, {
                    backgroundColor: chipColors.bg,
                    borderColor: chipColors.border,
                  }]}
                >
                  <Text style={[styles.impactChipText, { color: chipColors.text }]}>
                    {item.label}: {impactArrow(item.direction)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {visibleMeaning.length > 0 ? (
          <View style={styles.meaningSection}>
            <Text style={styles.meaningHeading}>Bu ne anlama geliyor?</Text>
            {visibleMeaning.map((bullet) => (
              <View key={bullet} style={styles.meaningRow}>
                <Text style={styles.meaningBullet}>•</Text>
                <Text style={styles.meaningText}>{bullet}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>

      {expanded ? (
        <View style={styles.expandedBody}>
          <View style={styles.detailBlock}>
            <Text style={styles.detailHeading}>Neden oldu?</Text>
            <Text style={styles.detailText}>{display.causeText}</Text>
          </View>

          {display.playerAdvice.length > 0 ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailHeading}>Oyuncu önerisi</Text>
              {display.playerAdvice.map((tip) => (
                <View key={tip} style={styles.meaningRow}>
                  <Text style={styles.meaningBullet}>•</Text>
                  <Text style={styles.detailText}>{tip}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable onPress={handleToggle} style={styles.collapseRow} hitSlop={8}>
            <Text style={styles.collapseText}>Detayı gizle</Text>
            <GameIcon name="chevronUp" size={12} color={colors.accentBlue} />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={handleToggle} style={styles.expandRow} hitSlop={8}>
          <Text style={styles.expandText}>Detayı gör</Text>
          <GameIcon name="chevronDown" size={12} color={colors.accentBlue} />
        </Pressable>
      )}
    </View>
  );
}

export default React.memo(MarketWorldEventCard);

const styles = StyleSheet.create({
  card: {
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
  },
  headerPressable: {
    paddingHorizontal: 11,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 7,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    flexWrap: 'wrap',
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 16,
  },
  scopeLabel: {
    fontSize: 9.5,
    lineHeight: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  compactBadge: {
    marginLeft: 'auto',
  },
  statusBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  shortDescription: {
    fontSize: 11,
    lineHeight: 15,
    color: '#C5D0E0',
    fontWeight: '500',
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationText: {
    fontSize: 9.5,
    color: colors.textMuted,
    fontWeight: '600',
  },
  impactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  impactChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  impactChipText: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
  meaningSection: {
    gap: 4,
    marginTop: 2,
  },
  meaningHeading: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  meaningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  meaningBullet: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    marginTop: 1,
  },
  meaningText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  expandedBody: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(120, 160, 220, 0.10)',
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 8,
  },
  detailBlock: {
    gap: 4,
  },
  detailHeading: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  detailText: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: 'rgba(120, 160, 220, 0.08)',
  },
  expandText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accentBlue,
  },
  collapseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 2,
  },
  collapseText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accentBlue,
  },
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
    minWidth: 0,
    flex: 1,
  },
  compactTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
