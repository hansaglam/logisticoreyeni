import React, { useCallback, useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getTrailerArtworkByType } from '../../assets/trailerAssets';
import type { TrailerMarketItem } from '../../data/trailers';
import { formatMoney } from '../../theme';
import { GameIcon } from '../ui';
import {
  formatLevelRequirement,
  formatTrailerMarketSubtitle,
  getMarketCardArtworkWidthPercent,
  getTrailerMarketAccentBorder,
  getTrailerMarketAccentColor,
  getTrailerMarketArtworkLayout,
  getTrailerMarketFeatureLine,
  isTrailerLevelLocked,
  SHOP_CARD_BG,
  SHOP_MUTED_COLOR,
  SHOP_NARROW_BREAKPOINT,
  SHOP_PRICE_COLOR,
  SHOP_TITLE_COLOR,
} from './shopTheme';

export interface TrailerMarketCardProps {
  template: TrailerMarketItem;
  playerMoney: number;
  playerLevel: number;
  onBuy: (catalogId: string) => void;
  onDetail: (template: TrailerMarketItem) => void;
}

const TrailerMarketCard = React.memo(function TrailerMarketCard({
  template,
  playerMoney,
  playerLevel,
  onBuy,
  onDetail,
}: TrailerMarketCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < SHOP_NARROW_BREAKPOINT;

  const artwork = useMemo(() => getTrailerArtworkByType(template.type), [template.type]);
  const requiredLevel = template.requiredLevel ?? 1;
  const isLevelLocked = useMemo(
    () => isTrailerLevelLocked(template, playerLevel),
    [playerLevel, template],
  );
  const canAfford = playerMoney >= template.purchasePrice;
  const disabled = isLevelLocked || !canAfford;
  const accentColor = useMemo(() => getTrailerMarketAccentColor(template.type), [template.type]);
  const accentBorder = useMemo(() => getTrailerMarketAccentBorder(template.type), [template.type]);
  const artworkLayout = useMemo(
    () => getTrailerMarketArtworkLayout(template.type, isCompact),
    [isCompact, template.type],
  );
  const artworkWidth = getMarketCardArtworkWidthPercent(isCompact);
  const subtitle = useMemo(() => formatTrailerMarketSubtitle(template), [template]);
  const featureLine = useMemo(() => getTrailerMarketFeatureLine(template), [template]);

  let buttonLabel = 'Satın Al';
  if (isLevelLocked) {
    buttonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canAfford) {
    buttonLabel = 'Nakit yetersiz';
  }

  const handleBuyPress = useCallback(() => {
    onBuy(template.id);
  }, [onBuy, template.id]);

  const handleDetailPress = useCallback(() => {
    onDetail(template);
  }, [onDetail, template]);

  return (
    <View style={[styles.card, accentBorder, isLevelLocked && styles.cardLocked]}>
      <Pressable style={[styles.artworkCol, { width: artworkWidth }]} onPress={handleDetailPress}>
        {artwork ? (
          <Image
            source={artwork}
            style={[
              styles.artwork,
              {
                height: artworkLayout.imageHeight,
                transform: [
                  { translateX: artworkLayout.translateX },
                  { translateY: artworkLayout.translateY },
                  { scale: artworkLayout.scale },
                ],
              },
            ]}
            resizeMode="contain"
          />
        ) : (
          <View style={[styles.artworkFallback, { height: artworkLayout.imageHeight }]}>
            <GameIcon name="route" size={34} color={accentColor} />
          </View>
        )}
        <View style={[styles.typeBadge, { borderColor: `${accentColor}55` }]}>
          <GameIcon name="route" size={11} color={accentColor} />
          <Text style={[styles.typeBadgeText, { color: accentColor }]}>
            {subtitle.split(' · ')[0]}
          </Text>
        </View>
      </Pressable>

      <View style={styles.contentCol}>
        <Pressable onPress={handleDetailPress}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, isCompact && styles.titleCompact]} numberOfLines={1} ellipsizeMode="tail">
              {template.name}
            </Text>
            <View style={[styles.levelBadge, isLevelLocked && styles.levelBadgeLocked]}>
              <Text style={[styles.levelBadgeText, isLevelLocked && styles.levelBadgeTextLocked]}>
                {formatLevelRequirement(requiredLevel)}
              </Text>
            </View>
          </View>

          <Text style={[styles.subtitle, { color: accentColor }]} numberOfLines={1}>
            {subtitle}
          </Text>

          <Text style={styles.description} numberOfLines={isCompact ? 1 : 2}>
            {template.description}
          </Text>

          <Text style={[styles.featureLine, { color: accentColor }]}>{featureLine}</Text>
        </Pressable>

        <View style={styles.footerRow}>
          <Text style={styles.price}>{formatMoney(template.purchasePrice)}</Text>
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.buyBtn, disabled && styles.buyBtnDisabled]}
              onPress={handleBuyPress}
              disabled={disabled}
            >
              <Text style={[styles.buyBtnLabel, disabled && styles.buyBtnLabelDisabled]} numberOfLines={1}>
                {buttonLabel}
              </Text>
            </Pressable>
            <Pressable style={styles.detailBtn} onPress={handleDetailPress} accessibilityLabel="Detay">
              <GameIcon name="search" size={18} color="#91A0B8" />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
});

export default TrailerMarketCard;

const styles = StyleSheet.create({
  card: {
    minHeight: 176,
    borderRadius: 18,
    marginBottom: 10,
    backgroundColor: SHOP_CARD_BG,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  cardLocked: {
    opacity: 0.96,
  },
  artworkCol: {
    backgroundColor: 'rgba(7,18,34,0.85)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: 10,
    overflow: 'visible',
  },
  artwork: {
    width: '95%',
    backgroundColor: 'transparent',
  },
  artworkFallback: {
    width: '95%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(8,20,38,0.55)',
  },
  typeBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  contentCol: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '800',
    color: SHOP_TITLE_COLOR,
  },
  titleCompact: {
    fontSize: 14,
  },
  levelBadge: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(120,140,180,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(120,140,180,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadgeLocked: {
    backgroundColor: 'rgba(245,158,11,0.10)',
    borderColor: 'rgba(245,158,11,0.35)',
  },
  levelBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B8C6DC',
  },
  levelBadgeTextLocked: {
    color: '#F5A623',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 10.5,
    fontWeight: '700',
  },
  description: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 13,
    color: SHOP_MUTED_COLOR,
  },
  featureLine: {
    marginTop: 5,
    fontSize: 10,
    fontWeight: '700',
  },
  footerRow: {
    marginTop: 8,
    gap: 6,
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    color: SHOP_PRICE_COLOR,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buyBtn: {
    flex: 1,
    height: 40,
    borderRadius: 11,
    backgroundColor: '#2388FF',
    borderWidth: 1,
    borderColor: '#2388FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  buyBtnDisabled: {
    backgroundColor: '#1A2F4D',
    borderColor: 'rgba(147, 197, 253, 0.38)',
  },
  buyBtnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F3F7FF',
  },
  buyBtnLabelDisabled: {
    color: '#B8D4F0',
  },
  detailBtn: {
    width: 44,
    height: 40,
    borderRadius: 11,
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(50,95,150,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
