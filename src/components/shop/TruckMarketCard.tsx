import React, { useCallback, useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getTruckArtworkByTemplateId } from '../../assets/fleetAssets';
import { resolveTruckMarketRequiredLevel, type TruckMarketItem } from '../../data/trucks';
import { formatMoney } from '../../theme';
import {
  formatLeaseOfferCost,
  resolveLeaseOfferCost,
} from '../../utils/truckLeasePresentation';
import { ActionButton, GameIcon } from '../ui';
import {
  formatLevelRequirement,
  formatTruckMarketSubtitle,
  getTruckMarketArtworkLayout,
  isTruckLevelLocked,
  resolveTruckShopClass,
  SHOP_CARD_BG,
  SHOP_CARD_BORDER,
  SHOP_MUTED_COLOR,
  SHOP_NARROW_BREAKPOINT,
  SHOP_PRICE_COLOR,
  SHOP_TITLE_COLOR,
  type TruckShopClass,
} from './shopTheme';

export interface TruckMarketCardProps {
  template: TruckMarketItem;
  playerMoney: number;
  playerLevel: number;
  ownedCount: number;
  canBuy: boolean;
  canLease: boolean;
  onBuy: (catalogId: string) => void;
  onLease: (catalogId: string) => void;
  onDetail: (template: TruckMarketItem) => void;
}

function ShopPrimaryButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: object;
}) {
  return (
    <Pressable
      style={[buttonStyles.primary, disabled && buttonStyles.primaryDisabled, style]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[buttonStyles.primaryLabel, disabled && buttonStyles.primaryLabelDisabled]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const TruckMarketCard = React.memo(function TruckMarketCard({
  template,
  playerMoney,
  playerLevel,
  ownedCount,
  canBuy,
  canLease,
  onBuy,
  onLease,
  onDetail,
}: TruckMarketCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < SHOP_NARROW_BREAKPOINT;

  const artwork = useMemo(() => getTruckArtworkByTemplateId(template.id), [template.id]);
  const requiredLevel = useMemo(() => resolveTruckMarketRequiredLevel(template), [template]);
  const isLevelLocked = useMemo(
    () => isTruckLevelLocked(template, playerLevel),
    [playerLevel, template],
  );
  const artworkLayout = useMemo(
    () => getTruckMarketArtworkLayout(template.id, isCompact),
    [isCompact, template.id],
  );
  const weeklyLeaseCost = template.weeklyLeaseCost ?? 0;
  const monthlyLeaseCost =
    weeklyLeaseCost > 0 ? resolveLeaseOfferCost(weeklyLeaseCost, 'monthly') : 0;
  const canAffordWeeklyLease = weeklyLeaseCost > 0 && playerMoney >= weeklyLeaseCost;
  const canAffordAnyLease =
    weeklyLeaseCost > 0 &&
    (playerMoney >= weeklyLeaseCost || playerMoney >= monthlyLeaseCost);
  const canAffordBuy = playerMoney >= template.purchasePrice;
  const buyDisabled = !canBuy || !canAffordBuy || isLevelLocked;
  const leaseDisabled = !canLease || !canAffordAnyLease || isLevelLocked || weeklyLeaseCost <= 0;
  const subtitle = useMemo(() => formatTruckMarketSubtitle(template), [template]);
  const classLabel = useMemo(() => subtitle.split(' · ')[0], [subtitle]);

  let buyButtonLabel = 'Satın Al';
  if (isLevelLocked) {
    buyButtonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canBuy) {
    buyButtonLabel = 'Yakında';
  } else if (!canAffordBuy) {
    buyButtonLabel = 'Nakit yetersiz';
  }

  let leaseButtonLabel = 'Kirala';
  if (isLevelLocked) {
    leaseButtonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canLease || weeklyLeaseCost <= 0) {
    leaseButtonLabel = 'Kiralama yok';
  } else if (!canAffordAnyLease) {
    leaseButtonLabel = 'Nakit yetersiz';
  } else {
    leaseButtonLabel = `Kirala · ${formatLeaseOfferCost(weeklyLeaseCost, 'weekly')}`;
  }

  const handleBuyPress = useCallback(() => {
    onBuy(template.id);
  }, [onBuy, template.id]);

  const handleLeasePress = useCallback(() => {
    onLease(template.id);
  }, [onLease, template.id]);

  const handleDetailPress = useCallback(() => {
    onDetail(template);
  }, [onDetail, template]);

  return (
    <View style={[styles.card, isLevelLocked && styles.cardLocked]}>
      <Pressable
        style={[styles.artworkCol, { width: artworkLayout.columnWidthPercent }]}
        onPress={handleDetailPress}
      >
        {artwork ? (
          <Image
            source={artwork}
            style={[
              styles.artwork,
              {
                width: artworkLayout.imageWidth,
                height: artworkLayout.imageHeight,
                transform: [{ translateY: artworkLayout.translateY }, { scale: artworkLayout.scale }],
              },
            ]}
            resizeMode="contain"
          />
        ) : (
          <View style={[styles.artworkFallback, { height: artworkLayout.imageHeight }]}>
            <GameIcon name="truck" size={34} color="#2388FF" />
          </View>
        )}
        <View style={styles.typeBadge}>
          <GameIcon name="level" size={11} color="#91A0B8" />
          <Text style={styles.typeBadgeText}>{classLabel}</Text>
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

          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>

          <Text style={styles.metaLine} numberOfLines={1}>
            {template.speed} km/h · {template.fuelConsumptionPerKm.toFixed(2)} L/km
          </Text>

          <View style={styles.durabilityRow}>
            <GameIcon name="maintenance" size={11} color="#39A0FF" />
            <Text style={styles.durabilityText}>Dayanıklılık {template.reliability}</Text>
          </View>

          {ownedCount > 0 ? (
            <Text style={styles.ownedHint}>Filonda {ownedCount} adet</Text>
          ) : null}
        </Pressable>

        <View style={styles.footerRow}>
          <View style={styles.priceRow}>
            <View style={styles.priceCol}>
              <Text style={styles.priceLabel}>Satın al</Text>
              <Text style={styles.price} numberOfLines={1}>
                {formatMoney(template.purchasePrice)}
              </Text>
            </View>
            {weeklyLeaseCost > 0 ? (
              <View style={styles.leaseCol}>
                <Text style={styles.leasePriceLabel}>Kira</Text>
                <Text style={styles.leasePrice} numberOfLines={1}>
                  {formatLeaseOfferCost(weeklyLeaseCost, 'weekly')}
                </Text>
                <Text style={styles.leasePriceAlt} numberOfLines={1}>
                  {formatLeaseOfferCost(weeklyLeaseCost, 'monthly')}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.actionCol}>
            {weeklyLeaseCost > 0 ? (
              <View style={styles.dualActions}>
                <ShopPrimaryButton
                  label={buyButtonLabel}
                  onPress={handleBuyPress}
                  disabled={buyDisabled}
                  style={styles.actionHalf}
                />
                <ActionButton
                  label={leaseButtonLabel}
                  onPress={handleLeasePress}
                  disabled={leaseDisabled}
                  variant="secondary"
                  compact
                  style={styles.actionHalf}
                />
              </View>
            ) : (
              <ShopPrimaryButton
                label={buyButtonLabel}
                onPress={handleBuyPress}
                disabled={buyDisabled}
                style={styles.actionFull}
              />
            )}
          </View>
        </View>
      </View>
    </View>
  );
});

export default TruckMarketCard;

const buttonStyles = StyleSheet.create({
  primary: {
    minHeight: 40,
    borderRadius: 11,
    backgroundColor: '#2388FF',
    borderWidth: 1,
    borderColor: '#2388FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  primaryDisabled: {
    backgroundColor: '#1A2F4D',
    borderColor: 'rgba(147, 197, 253, 0.38)',
  },
  primaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F3F7FF',
  },
  primaryLabelDisabled: {
    color: '#B8D4F0',
  },
});

const styles = StyleSheet.create({
  card: {
    minHeight: 182,
    borderRadius: 18,
    marginBottom: 10,
    backgroundColor: SHOP_CARD_BG,
    borderWidth: 1,
    borderColor: SHOP_CARD_BORDER,
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
    backgroundColor: 'transparent',
  },
  artworkFallback: {
    width: '94%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  typeBadgeText: {
    fontSize: 9.5,
    color: '#91A0B8',
    fontWeight: '600',
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
    color: '#91A0B8',
    fontWeight: '600',
  },
  metaLine: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 13,
    color: SHOP_MUTED_COLOR,
  },
  durabilityRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durabilityText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#39A0FF',
  },
  ownedHint: {
    marginTop: 3,
    fontSize: 9.5,
    color: '#7F8EA6',
  },
  footerRow: {
    marginTop: 8,
    gap: 8,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  priceCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  leaseCol: {
    alignItems: 'flex-end',
    gap: 1,
  },
  priceLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: SHOP_MUTED_COLOR,
    textTransform: 'uppercase',
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    color: SHOP_PRICE_COLOR,
  },
  leasePriceLabel: {
    marginTop: 4,
    fontSize: 9,
    fontWeight: '700',
    color: SHOP_MUTED_COLOR,
    textTransform: 'uppercase',
  },
  leasePrice: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#F5C26B',
  },
  leasePriceAlt: {
    fontSize: 10,
    fontWeight: '600',
    color: '#B8A06A',
  },
  actionCol: {
    width: '100%',
  },
  dualActions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionHalf: {
    flex: 1,
    minHeight: 40,
  },
  actionFull: {
    minHeight: 40,
    alignSelf: 'stretch',
  },
});

export function filterTruckMarketByClass<T extends TruckMarketItem>(
  items: T[],
  filter: 'all' | TruckShopClass,
): T[] {
  if (filter === 'all') return items;
  return items.filter((item) => resolveTruckShopClass(item.id) === filter);
}
