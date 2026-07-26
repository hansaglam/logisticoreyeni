import React, { useCallback, useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getTrailerArtwork } from '../../assets/trailerAssets';
import { getTrailerTypeLabel } from '../../simulation/trailerOps';
import { GameIcon, ProgressBar, StatusBadge } from '../ui';
import type { StatusBadgeVariant } from '../ui';
import { colors } from '../../theme';
import { getCityName } from '../../utils/entityLookup';
import type { Trailer, Truck } from '../../types/game';
import {
  FLEET_CARD_BG,
  FLEET_CARD_BORDER,
  FLEET_PROGRESS_TRACK,
  FLEET_SKILL_PILL_BG,
  FLEET_NARROW_BREAKPOINT,
  FLEET_TRAILER_CARD_MIN_HEIGHT,
  getTrailerAccentBorder,
  getTrailerAccentTint,
  getTrailerArtworkLayout,
} from './fleetTheme';

function getConditionColor(condition: number): string {
  if (condition >= 70) return colors.success;
  if (condition >= 35) return colors.accentAmber;
  return colors.danger;
}

function getTrailerStatusPresentation(
  trailer: Trailer,
  linkedTruck?: Truck,
): { label: string; variant: StatusBadgeVariant } {
  if (linkedTruck?.status === 'maintenance') {
    return { label: 'BAKIMDA', variant: 'danger' };
  }
  if (trailer.status === 'in_use') {
    return { label: 'TESLİMATTA', variant: 'info' };
  }
  if (trailer.status === 'attached') {
    return { label: 'BAĞLI', variant: 'blue' };
  }
  return { label: 'BOŞTA', variant: 'success' };
}

export interface OwnedTrailerCardProps {
  trailer: Trailer;
  trucks: Truck[];
  onAttach: (trailer: Trailer) => void;
  onDetach: (trailer: Trailer) => void;
  onMaintenance: (trailer: Trailer) => void;
  onDetail: (trailer: Trailer) => void;
  onMore: (trailer: Trailer) => void;
}

const OwnedTrailerCard = React.memo(function OwnedTrailerCard({
  trailer,
  trucks,
  onAttach,
  onDetach,
  onMaintenance,
  onDetail,
  onMore,
}: OwnedTrailerCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const isNarrow = screenWidth < FLEET_NARROW_BREAKPOINT;
  const layout = useMemo(
    () => getTrailerArtworkLayout(trailer.type, isNarrow),
    [isNarrow, trailer.type],
  );

  const linkedTruck = useMemo(
    () =>
      trailer.attachedTruckId
        ? trucks.find((truck) => truck.id === trailer.attachedTruckId)
        : undefined,
    [trailer.attachedTruckId, trucks],
  );

  const artwork = useMemo(() => getTrailerArtwork(trailer), [trailer.catalogId, trailer.type]);
  const accentBorder = useMemo(() => getTrailerAccentBorder(trailer.type), [trailer.type]);
  const accentTint = useMemo(() => getTrailerAccentTint(trailer.type), [trailer.type]);
  const statusBadge = useMemo(
    () => getTrailerStatusPresentation(trailer, linkedTruck),
    [linkedTruck, trailer],
  );

  const typeLabel = useMemo(() => getTrailerTypeLabel(trailer.type), [trailer.type]);
  const cityName = useMemo(() => getCityName(trailer.city), [trailer.city]);
  const condition = Math.round(trailer.condition ?? 100);
  const conditionColor = getConditionColor(condition);

  const isIdle = trailer.status === 'idle';
  const isAttached = trailer.status === 'attached';
  const isInUse = trailer.status === 'in_use';
  const truckInMaintenance = linkedTruck?.status === 'maintenance';

  const attachActionDisabled = !isIdle || truckInMaintenance;
  const detachActionDisabled = isInUse;
  const maintenanceDisabled = isInUse;

  const attachLabel = isAttached ? 'Ayır' : 'Bağla';
  const attachHandler = isAttached ? onDetach : onAttach;

  const featurePills = useMemo(
    () => [
      {
        label: 'Kapasite',
        value: `+${Math.round(trailer.capacityBonusTons)} t`,
      },
      {
        label: 'Tip',
        value: isNarrow && typeLabel === 'Konteyner' ? 'Kont.' : typeLabel,
      },
      {
        label: isNarrow ? 'Kamyon' : 'Bağlı Kamyon',
        value: linkedTruck?.name ?? 'Yok',
      },
    ],
    [isNarrow, linkedTruck?.name, trailer.capacityBonusTons, typeLabel],
  );

  const linkLine = linkedTruck
    ? `${linkedTruck.name}'a bağlı`
    : 'Kamyon bağlı değil';

  const handleAttachPress = useCallback(() => {
    attachHandler(trailer);
  }, [attachHandler, trailer]);

  const handleMorePress = useCallback(() => {
    onMore(trailer);
  }, [onMore, trailer]);

  return (
    <View style={[styles.card, accentBorder, { minHeight: FLEET_TRAILER_CARD_MIN_HEIGHT }]}>
      <View style={styles.topRow}>
        <View
          style={[
            styles.artworkCol,
            { width: layout.columnWidth, height: layout.imageHeight },
          ]}
        >
          {artwork ? (
            <Image
              source={artwork}
              style={[
                styles.artwork,
                {
                  width: layout.imageWidth,
                  height: layout.imageHeight,
                  transform: [
                    { translateX: layout.translateX },
                    { translateY: layout.translateY },
                    { scale: layout.scale },
                  ],
                },
              ]}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.artworkFallback, { width: layout.imageWidth, height: layout.imageHeight }]}>
              <GameIcon name="route" size={32} color={accentTint} />
            </View>
          )}
        </View>

        <View style={styles.infoCol}>
          <Text style={styles.trailerName} numberOfLines={1} ellipsizeMode="tail">
            {trailer.name}
          </Text>
          <Text style={styles.metaLine} numberOfLines={1} ellipsizeMode="tail">
            {typeLabel} · {cityName}
          </Text>
          <Text style={styles.linkLine} numberOfLines={1} ellipsizeMode="tail">
            {linkLine}
          </Text>
        </View>

        <View style={[styles.statusCol, { width: layout.statusCol }]}>
          <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
        </View>
      </View>

      <View style={styles.featureRow}>
        {featurePills.map((pill) => (
          <View key={pill.label} style={styles.featurePill}>
            <Text style={styles.featureLabel} numberOfLines={1}>
              {pill.label}
            </Text>
            <Text style={styles.featureValue} numberOfLines={1} ellipsizeMode="tail">
              {pill.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.conditionBlock}>
        <View style={styles.conditionHeader}>
          <Text style={styles.conditionTitle}>Kondisyon</Text>
          <Text style={[styles.conditionPercent, { color: conditionColor }]}>{condition}%</Text>
        </View>
        <ProgressBar
          progress={condition / 100}
          color={conditionColor}
          height={6}
          trackColor={FLEET_PROGRESS_TRACK}
        />
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[
            styles.actionBtn,
            isAttached ? styles.actionOutline : styles.actionPrimary,
            (attachActionDisabled || detachActionDisabled) && styles.actionDisabled,
          ]}
          onPress={handleAttachPress}
          disabled={isAttached ? detachActionDisabled : attachActionDisabled}
        >
          <GameIcon
            name="truck"
            size={13}
            color={
              isAttached
                ? colors.accentBlue
                : attachActionDisabled
                  ? colors.textMuted
                  : '#FFFFFF'
            }
          />
          <Text
            style={[
              isAttached ? styles.actionOutlineText : styles.actionPrimaryText,
              (attachActionDisabled || detachActionDisabled) && styles.actionDisabledText,
            ]}
            numberOfLines={1}
          >
            {attachLabel}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.actionBtn, styles.actionAmber, maintenanceDisabled && styles.actionDisabled]}
          onPress={() => onMaintenance(trailer)}
          disabled={maintenanceDisabled}
        >
          <GameIcon name="repair" size={13} color={colors.accentAmber} />
          <Text style={styles.actionAmberText} numberOfLines={1}>
            Bakım
          </Text>
        </Pressable>

        <Pressable style={[styles.actionBtn, styles.actionOutline]} onPress={() => onDetail(trailer)}>
          <GameIcon name="account" size={13} color={colors.accentBlue} />
          <Text style={styles.actionOutlineText} numberOfLines={1}>
            Detay
          </Text>
        </Pressable>

        <Pressable style={[styles.actionBtn, styles.actionNeutral]} onPress={handleMorePress}>
          <Text style={styles.moreDots}>•••</Text>
        </Pressable>
      </View>
    </View>
  );
});

export default OwnedTrailerCard;

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 10,
    marginBottom: 10,
    overflow: 'hidden',
    backgroundColor: FLEET_CARD_BG,
    borderWidth: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  artworkCol: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  artwork: {
    backgroundColor: 'transparent',
  },
  artworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  infoCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    gap: 2,
  },
  trailerName: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 17,
  },
  metaLine: {
    fontSize: 9.5,
    color: '#91A0B8',
    lineHeight: 11,
  },
  linkLine: {
    fontSize: 9,
    color: '#7F8EA6',
    lineHeight: 11,
  },
  statusCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
    justifyContent: 'center',
  },
  featureRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 7,
  },
  featurePill: {
    flex: 1,
    minWidth: 0,
    height: 36,
    borderRadius: 11,
    backgroundColor: FLEET_SKILL_PILL_BG,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  featureLabel: {
    fontSize: 8,
    color: '#74839B',
    lineHeight: 10,
  },
  featureValue: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 12,
  },
  conditionBlock: {
    marginTop: 7,
    gap: 3,
  },
  conditionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  conditionTitle: {
    fontSize: 9,
    fontWeight: '600',
    color: '#A9B6CC',
  },
  conditionPercent: {
    fontSize: 10,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    minWidth: 0,
    height: 37,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 3,
  },
  actionPrimary: {
    backgroundColor: colors.accentBlue,
  },
  actionPrimaryText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionAmber: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.45)',
  },
  actionAmberText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.accentAmber,
  },
  actionOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(90,135,195,0.40)',
  },
  actionOutlineText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.accentBlue,
  },
  actionNeutral: {
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(70,120,190,0.22)',
  },
  moreDots: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    lineHeight: 14,
    letterSpacing: 1,
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionDisabledText: {
    color: colors.textMuted,
  },
});
