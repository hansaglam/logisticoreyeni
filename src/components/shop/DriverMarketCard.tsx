import React, { useCallback, useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  getDriverTierLabel,
  type DriverMarketItem,
} from '../../data/drivers';
import { formatMoney } from '../../theme';
import { GameIcon, StatusBadge } from '../ui';
import type { StatusBadgeVariant } from '../ui';
import {
  isDriverLevelLocked,
  SHOP_CARD_BG,
  SHOP_CARD_BORDER,
  SHOP_NARROW_BREAKPOINT,
  SHOP_PRICE_COLOR,
  SHOP_TITLE_COLOR,
} from './shopTheme';

function getDriverShopTags(template: DriverMarketItem): { label: string; variant: StatusBadgeVariant }[] {
  const tags: { label: string; variant: StatusBadgeVariant }[] = [];
  if (template.comingSoon) tags.push({ label: 'Yakında', variant: 'warning' });
  if (template.fuelSaving >= 50) tags.push({ label: 'Yakıt tasarruflu', variant: 'success' });
  if (template.attention >= 80) tags.push({ label: 'Güvenli sürücü', variant: 'success' });
  if (template.speed >= 15) tags.push({ label: 'Hızlı sürücü', variant: 'warning' });
  if (tags.length === 0) {
    tags.push({ label: getDriverTierLabel(template.tier), variant: 'muted' });
  }
  return tags.slice(0, 2);
}

export interface DriverMarketCardProps {
  template: DriverMarketItem;
  playerMoney: number;
  playerLevel: number;
  alreadyHired: boolean;
  canHire: boolean;
  onHire: (poolId: string) => void;
  onDetail: (template: DriverMarketItem) => void;
}

const DriverMarketCard = React.memo(function DriverMarketCard({
  template,
  playerMoney,
  playerLevel,
  alreadyHired,
  canHire,
  onHire,
  onDetail,
}: DriverMarketCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < SHOP_NARROW_BREAKPOINT;

  const requiredLevel = template.requiredLevel ?? 1;
  const isLevelLocked = useMemo(
    () => isDriverLevelLocked(template, playerLevel),
    [playerLevel, template],
  );
  const isComingSoon = template.comingSoon === true;
  const canAfford = playerMoney >= template.hiringFee;
  const hireDisabled = !canHire || alreadyHired || !canAfford || isLevelLocked || isComingSoon;
  const tags = useMemo(() => getDriverShopTags(template), [template]);

  let buttonLabel = 'İşe Al';
  if (isComingSoon) {
    buttonLabel = 'Yakında';
  } else if (isLevelLocked) {
    buttonLabel = `Level ${requiredLevel} gerekli`;
  } else if (!canHire) {
    buttonLabel = 'Yakında';
  } else if (!canAfford) {
    buttonLabel = 'Nakit yetersiz';
  }

  const handleHirePress = useCallback(() => {
    onHire(template.id);
  }, [onHire, template.id]);

  const handleDetailPress = useCallback(() => {
    onDetail(template);
  }, [onDetail, template]);

  return (
    <View
      style={[
        styles.card,
        alreadyHired && styles.cardHired,
        (isLevelLocked || isComingSoon) && !alreadyHired && styles.cardLocked,
      ]}
    >
      <Pressable style={styles.avatarCol} onPress={handleDetailPress}>
        <View style={styles.avatar}>
          <GameIcon name="driver" size={28} color="#2388FF" />
        </View>
      </Pressable>

      <View style={styles.contentCol}>
        <Pressable onPress={handleDetailPress}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, isCompact && styles.titleCompact]} numberOfLines={1} ellipsizeMode="tail">
              {template.name}
            </Text>
            {alreadyHired ? <StatusBadge label="KADRODA" variant="blue" size="sm" /> : null}
          </View>

          <Text style={styles.statsLine} numberOfLines={1}>
            Deneyim {template.experience} · Dikkat {template.attention}
          </Text>

          <Text style={styles.salaryLine} numberOfLines={1}>
            Maaş · {formatMoney(template.salaryPerDay)}/gün
          </Text>

          {tags.length > 0 ? (
            <View style={styles.tagRow}>
              {tags.map((tag) => (
                <StatusBadge key={tag.label} label={tag.label} variant={tag.variant} size="sm" />
              ))}
            </View>
          ) : null}
        </Pressable>

        <View style={styles.footerRow}>
          <View style={styles.feeBlock}>
            <Text style={styles.feeLabel}>İşe alım</Text>
            <Text style={styles.price} numberOfLines={1}>
              {formatMoney(template.hiringFee)}
            </Text>
          </View>

          {alreadyHired ? (
            <Pressable style={styles.detailBtn} onPress={handleDetailPress} accessibilityLabel="Detay">
              <GameIcon name="search" size={18} color="#91A0B8" />
            </Pressable>
          ) : (
            <View style={styles.actionWrap}>
              <Pressable
                style={[styles.hireBtn, hireDisabled && styles.hireBtnDisabled]}
                onPress={handleHirePress}
                disabled={hireDisabled}
              >
                <Text style={[styles.hireBtnLabel, hireDisabled && styles.hireBtnLabelDisabled]} numberOfLines={1}>
                  {buttonLabel}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
});

export default DriverMarketCard;

const styles = StyleSheet.create({
  card: {
    minHeight: 152,
    borderRadius: 18,
    marginBottom: 10,
    backgroundColor: SHOP_CARD_BG,
    borderWidth: 1,
    borderColor: SHOP_CARD_BORDER,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
  },
  cardHired: {
    minHeight: 138,
  },
  cardLocked: {
    opacity: 0.96,
  },
  avatarCol: {
    flexShrink: 0,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(60,110,170,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentCol: {
    flex: 1,
    minWidth: 0,
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
    fontSize: 15.5,
    fontWeight: '800',
    color: SHOP_TITLE_COLOR,
  },
  titleCompact: {
    fontSize: 14,
  },
  statsLine: {
    marginTop: 3,
    fontSize: 10.5,
    color: '#91A0B8',
    fontWeight: '600',
  },
  salaryLine: {
    marginTop: 2,
    fontSize: 9.5,
    color: '#91A0B8',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
  },
  footerRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  feeBlock: {
    flexShrink: 0,
  },
  feeLabel: {
    fontSize: 8,
    color: '#74839B',
    marginBottom: 2,
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    color: SHOP_PRICE_COLOR,
  },
  actionWrap: {
    flex: 1,
    minWidth: 0,
  },
  hireBtn: {
    minHeight: 38,
    borderRadius: 11,
    backgroundColor: '#2388FF',
    borderWidth: 1,
    borderColor: '#2388FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  hireBtnDisabled: {
    backgroundColor: '#1A2F4D',
    borderColor: 'rgba(147, 197, 253, 0.38)',
  },
  hireBtnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F3F7FF',
  },
  hireBtnLabelDisabled: {
    color: '#B8D4F0',
  },
  detailBtn: {
    width: 44,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(50,95,150,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
});
