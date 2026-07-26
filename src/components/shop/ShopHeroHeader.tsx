import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getShopHeroArtwork } from '../../assets/shopAssets';
import { GameIcon } from '../ui';
import {
  SHOP_BACKGROUND,
  SHOP_HERO_ARTWORK_HEIGHT,
  SHOP_HERO_ARTWORK_HEIGHT_COMPACT,
  SHOP_HERO_ARTWORK_RIGHT,
  SHOP_HERO_ARTWORK_SCALE,
  SHOP_HERO_ARTWORK_TRANSLATE_X,
  SHOP_HERO_ARTWORK_TRANSLATE_Y,
  SHOP_HERO_ARTWORK_WIDTH,
  SHOP_HERO_ARTWORK_WIDTH_COMPACT,
  SHOP_HERO_CONTENT_GAP,
  SHOP_HERO_CONTENT_PADDING_RIGHT,
  SHOP_HERO_CONTENT_PADDING_RIGHT_COMPACT,
  SHOP_HERO_HEIGHT,
  SHOP_HERO_HEIGHT_COMPACT,
  SHOP_HERO_ICON_GLYPH,
  SHOP_HERO_ICON_RADIUS,
  SHOP_HERO_ICON_SIZE,
  SHOP_HERO_PADDING_H,
  SHOP_HERO_SUBTITLE_COLOR,
  SHOP_HERO_SUBTITLE_MAX_WIDTH,
  SHOP_HERO_SUBTITLE_SIZE,
  SHOP_HERO_TITLE_COLOR,
  SHOP_HERO_TITLE_SIZE,
  SHOP_NARROW_HERO_BREAKPOINT,
} from './shopTheme';

export default function ShopHeroHeader() {
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < SHOP_NARROW_HERO_BREAKPOINT;
  const heroArtwork = getShopHeroArtwork();

  const heroHeight = isCompact ? SHOP_HERO_HEIGHT_COMPACT : SHOP_HERO_HEIGHT;
  const artworkWidth = isCompact ? SHOP_HERO_ARTWORK_WIDTH_COMPACT : SHOP_HERO_ARTWORK_WIDTH;
  const artworkHeight = isCompact ? SHOP_HERO_ARTWORK_HEIGHT_COMPACT : SHOP_HERO_ARTWORK_HEIGHT;
  const contentPaddingRight = isCompact
    ? SHOP_HERO_CONTENT_PADDING_RIGHT_COMPACT
    : SHOP_HERO_CONTENT_PADDING_RIGHT;

  return (
    <View style={[styles.heroRoot, { height: heroHeight }]}>
      <Image
        source={heroArtwork}
        style={[
          styles.heroArtwork,
          {
            width: artworkWidth,
            height: artworkHeight,
            transform: [
              { translateX: SHOP_HERO_ARTWORK_TRANSLATE_X },
              { translateY: SHOP_HERO_ARTWORK_TRANSLATE_Y },
              { scale: SHOP_HERO_ARTWORK_SCALE },
            ],
          },
        ]}
        resizeMode="contain"
      />

      <View style={[styles.contentRow, { paddingRight: contentPaddingRight }]}>
        <View style={styles.iconBox}>
          <GameIcon name="inventory" size={SHOP_HERO_ICON_GLYPH} color="#2388FF" />
        </View>

        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            Mağaza
          </Text>
          <Text style={styles.subtitle} numberOfLines={2} ellipsizeMode="tail">
            Kamyon, dorse ve şoför yatırımları
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroRoot: {
    backgroundColor: SHOP_BACKGROUND,
    paddingHorizontal: SHOP_HERO_PADDING_H,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
  },
  heroArtwork: {
    position: 'absolute',
    right: SHOP_HERO_ARTWORK_RIGHT,
    bottom: 0,
    zIndex: 0,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHOP_HERO_CONTENT_GAP,
    zIndex: 2,
  },
  iconBox: {
    width: SHOP_HERO_ICON_SIZE,
    height: SHOP_HERO_ICON_SIZE,
    borderRadius: SHOP_HERO_ICON_RADIUS,
    backgroundColor: 'rgba(35, 136, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(35, 136, 255, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: SHOP_HERO_SUBTITLE_MAX_WIDTH,
    zIndex: 2,
    gap: 2,
  },
  title: {
    fontSize: SHOP_HERO_TITLE_SIZE,
    lineHeight: SHOP_HERO_TITLE_SIZE + 3,
    fontWeight: '800',
    color: SHOP_HERO_TITLE_COLOR,
    letterSpacing: -0.15,
  },
  subtitle: {
    fontSize: SHOP_HERO_SUBTITLE_SIZE,
    lineHeight: 14,
    fontWeight: '500',
    color: SHOP_HERO_SUBTITLE_COLOR,
  },
});
