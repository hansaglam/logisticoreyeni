import React, { useCallback, useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  getDriverOperationalState,
  type DriverAssignmentContext,
} from '../../domain/driverOperationalState';
import { resolveTruckCityId } from '../../simulation/delivery';
import { resolveDriverDailySalary } from '../../simulation/fleetManagement';
import { GameIcon, ProgressBar, StatusBadge } from '../ui';
import type { StatusBadgeVariant } from '../ui';
import { colors, formatMoney } from '../../theme';
import { getCityName } from '../../utils/entityLookup';
import type { Delivery, Driver, Truck } from '../../types/game';
import {
  FLEET_ASSIGN_BADGE_ACTIVE_BG,
  FLEET_ASSIGN_BADGE_ACTIVE_BORDER,
  FLEET_ASSIGN_BADGE_ACTIVE_TEXT,
  FLEET_ASSIGN_BADGE_IDLE_BG,
  FLEET_ASSIGN_BADGE_IDLE_BORDER,
  FLEET_ASSIGN_BADGE_IDLE_TEXT,
  FLEET_CARD_BG,
  FLEET_CARD_BORDER,
  FLEET_DRIVER_ACTION_DISABLED_TEXT,
  FLEET_DRIVER_ACTION_FONT_SIZE,
  FLEET_DRIVER_ASSIGNMENT_LINE,
  FLEET_DRIVER_CARD_MIN_HEIGHT,
  FLEET_DRIVER_MORE_DOTS_COLOR,
  FLEET_DRIVER_NEUTRAL_BG,
  FLEET_DRIVER_NEUTRAL_BORDER,
  FLEET_DRIVER_OUTLINE_TEXT,
  FLEET_DRIVER_SKILL_LABEL,
  FLEET_AVATAR_BG,
  FLEET_AVATAR_BORDER,
  FLEET_LEVEL_COLOR,
  FLEET_PROGRESS_TRACK,
  FLEET_SALARY_COLOR,
  FLEET_SKILL_PILL_BG,
  getFleetDriverColumnWidths,
} from './fleetTheme';

const MORALE_CRITICAL_THRESHOLD = 35;
const MORALE_WARNING_THRESHOLD = 70;

function getDriverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function operationalBadgeVariant(kind: string, morale: number): StatusBadgeVariant {
  if (kind === 'on_delivery' || kind === 'on_transfer') return 'blue';
  if (kind === 'resting') return 'info';
  if (morale < MORALE_CRITICAL_THRESHOLD) return 'danger';
  if (morale < MORALE_WARNING_THRESHOLD) return 'amber';
  return 'success';
}

function formatSpeedSkillValue(speed: number): string {
  const normalized = Math.round(Math.min(100, Math.max(0, (speed + 100) / 2)));
  return String(normalized);
}

export interface DriverCardProps {
  driver: Driver;
  trucks: Truck[];
  driverContext: DriverAssignmentContext;
  homeCityId?: string;
  activeDelivery?: Delivery;
  onAssign: (driver: Driver) => void;
  onTraining: (driver: Driver) => void;
  onDetail: (driver: Driver) => void;
  onMore: (driver: Driver) => void;
}

const DriverCard = React.memo(function DriverCard({
  driver,
  trucks,
  driverContext,
  homeCityId,
  activeDelivery,
  onAssign,
  onTraining,
  onDetail,
  onMore,
}: DriverCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const layout = useMemo(() => getFleetDriverColumnWidths(screenWidth), [screenWidth]);
  const isNarrow = screenWidth < 360;

  const operational = useMemo(
    () => getDriverOperationalState(driver, driverContext),
    [driver, driverContext],
  );

  const assignedTruck = useMemo(() => {
    const truckId = operational.assignedTruckId ?? activeDelivery?.truckId ?? null;
    if (!truckId) return undefined;
    return trucks.find((truck) => truck.id === truckId);
  }, [activeDelivery?.truckId, operational.assignedTruckId, trucks]);

  const driverCityId = useMemo(() => {
    if (assignedTruck) return resolveTruckCityId(assignedTruck, homeCityId);
    return homeCityId ?? 'izmir';
  }, [assignedTruck, homeCityId]);

  const driverLevel = driver.level ?? 1;
  const morale = Math.round(driver.morale ?? 80);
  const statusBadge = useMemo(
    () => ({
      label: operational.statusBadgeLabel,
      variant: operationalBadgeVariant(operational.kind, morale),
    }),
    [morale, operational.kind, operational.statusBadgeLabel],
  );
  const moraleColor = morale >= MORALE_WARNING_THRESHOLD
    ? colors.success
    : morale >= MORALE_CRITICAL_THRESHOLD
      ? colors.accentAmber
      : colors.danger;
  const dailySalary = driver.salaryPerDay ?? driver.dailySalary ?? resolveDriverDailySalary(driver);
  const isAssigned = operational.assignmentBadgeLabel === 'ATANMIŞ';
  const assignDisabled =
    operational.kind === 'on_delivery' ||
    operational.kind === 'on_transfer' ||
    operational.kind === 'resting';
  const assignLabel = isAssigned ? 'Değiştir' : 'Ata';
  const narrowAssignLabel = isAssigned ? 'Değ.' : 'Ata';

  const skills = useMemo(
    () => [
      { label: 'Deneyim', value: String(Math.round(driver.experience ?? 0)) },
      { label: 'Güvenlik', value: String(Math.round(driver.attention ?? 0)) },
      { label: 'Hız', value: formatSpeedSkillValue(driver.speed ?? 0) },
      { label: 'Yakıt', value: String(Math.round(driver.fuelSaving ?? 0)) },
    ],
    [driver.attention, driver.experience, driver.fuelSaving, driver.speed],
  );

  const assignmentLine = useMemo(() => {
    if (assignedTruck) {
      return `${assignedTruck.name} · ${getCityName(driverCityId)}`;
    }
    return 'Araç atanmamış';
  }, [assignedTruck, driverCityId]);

  const showMoraleCaption =
    morale < MORALE_CRITICAL_THRESHOLD || (operational.kind === 'resting' && morale < MORALE_WARNING_THRESHOLD);

  const handleMorePress = useCallback(() => {
    onMore(driver);
  }, [driver, onMore]);

  return (
    <View style={[styles.card, { minHeight: FLEET_DRIVER_CARD_MIN_HEIGHT }]}>
      <View style={styles.topRow}>
        <View
          style={[
            styles.avatar,
            {
              width: layout.avatarSize,
              height: layout.avatarSize,
              borderRadius: layout.avatarRadius,
            },
          ]}
        >
          <Text style={styles.avatarInitials}>{getDriverInitials(driver.name)}</Text>
        </View>

        <View style={styles.infoCol}>
          <Text style={styles.driverName} numberOfLines={1} ellipsizeMode="tail">
            {driver.name}
          </Text>
          <View style={styles.badgeRow}>
            <View style={styles.cityBadge}>
              <GameIcon name="city" size={10} color="#39A0FF" />
              <Text style={styles.cityBadgeText} numberOfLines={1}>
                {getCityName(driverCityId)}
              </Text>
            </View>
            <StatusBadge label={statusBadge.label} variant={statusBadge.variant} size="sm" />
            <View style={[styles.assignBadge, isAssigned ? styles.assignBadgeActive : styles.assignBadgeIdle]}>
              <Text style={[styles.assignBadgeText, isAssigned ? styles.assignBadgeTextActive : styles.assignBadgeTextIdle]}>
                {operational.assignmentBadgeLabel}
              </Text>
            </View>
          </View>
          <Text style={styles.assignmentLine} numberOfLines={1} ellipsizeMode="tail">
            {assignmentLine}
          </Text>
        </View>

        <View style={[styles.rightCol, { width: layout.rightCol }]}>
          <Text style={styles.levelValue}>Lv. {driverLevel}</Text>
          <Text style={styles.salaryValue} numberOfLines={1} ellipsizeMode="tail">
            {formatMoney(dailySalary)}/gün
          </Text>
        </View>
      </View>

      <View style={styles.skillRow}>
        {skills.map((skill) => (
          <View key={skill.label} style={styles.skillPill}>
            <Text style={styles.skillLabel} numberOfLines={1}>
              {isNarrow && skill.label === 'Güvenlik' ? 'Güven.' : skill.label}
            </Text>
            <Text style={styles.skillValue} numberOfLines={1}>
              {skill.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.moraleBlock}>
        <View style={styles.moraleHeader}>
          <Text style={styles.moraleTitle}>Moral</Text>
          <Text style={[styles.moralePercent, { color: moraleColor }]}>{morale}%</Text>
        </View>
        <ProgressBar
          progress={morale / 100}
          color={moraleColor}
          height={6}
          trackColor={FLEET_PROGRESS_TRACK}
        />
        {showMoraleCaption ? (
          <Text style={[styles.moraleCaption, { color: morale < MORALE_CRITICAL_THRESHOLD ? colors.danger : colors.accentAmber }]}>
            Dinlenmesi gerekiyor
          </Text>
        ) : (
          <View style={styles.moraleCaptionSpacer} />
        )}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionBtn, styles.actionPrimary, assignDisabled && styles.actionDisabled]}
          onPress={() => onAssign(driver)}
          disabled={assignDisabled}
        >
          <GameIcon name="truck" size={13} color={assignDisabled ? FLEET_DRIVER_ACTION_DISABLED_TEXT : '#FFFFFF'} />
          <Text style={[styles.actionPrimaryText, assignDisabled && styles.actionDisabledText]} numberOfLines={1}>
            {isNarrow ? narrowAssignLabel : assignLabel}
          </Text>
        </Pressable>

        <Pressable style={[styles.actionBtn, styles.actionTraining]} onPress={() => onTraining(driver)}>
          <GameIcon name="level" size={13} color="#22D3EE" />
          <Text style={styles.actionTrainingText} numberOfLines={1}>
            {isNarrow ? 'Eğit' : 'Eğitim'}
          </Text>
        </Pressable>

        <Pressable style={[styles.actionBtn, styles.actionOutline]} onPress={() => onDetail(driver)}>
          <GameIcon name="account" size={13} color={FLEET_DRIVER_OUTLINE_TEXT} />
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

export default DriverCard;

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 10,
    marginBottom: 10,
    overflow: 'hidden',
    backgroundColor: FLEET_CARD_BG,
    borderWidth: 1,
    borderColor: FLEET_CARD_BORDER,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    flexShrink: 0,
    backgroundColor: FLEET_AVATAR_BG,
    borderWidth: 1,
    borderColor: FLEET_AVATAR_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: '800',
    color: '#39A0FF',
    lineHeight: 18,
  },
  infoCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 9,
    gap: 3,
  },
  driverName: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  cityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(35,136,255,0.10)',
    maxWidth: '42%',
  },
  cityBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#39A0FF',
  },
  assignBadge: {
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignBadgeActive: {
    backgroundColor: FLEET_ASSIGN_BADGE_ACTIVE_BG,
    borderColor: FLEET_ASSIGN_BADGE_ACTIVE_BORDER,
  },
  assignBadgeIdle: {
    backgroundColor: FLEET_ASSIGN_BADGE_IDLE_BG,
    borderColor: FLEET_ASSIGN_BADGE_IDLE_BORDER,
  },
  assignBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    lineHeight: 10,
  },
  assignBadgeTextActive: {
    color: FLEET_ASSIGN_BADGE_ACTIVE_TEXT,
  },
  assignBadgeTextIdle: {
    color: FLEET_ASSIGN_BADGE_IDLE_TEXT,
  },
  assignmentLine: {
    fontSize: 9.5,
    color: FLEET_DRIVER_ASSIGNMENT_LINE,
    lineHeight: 12,
  },
  rightCol: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 2,
    justifyContent: 'center',
  },
  levelValue: {
    fontSize: 14,
    fontWeight: '800',
    color: FLEET_LEVEL_COLOR,
    lineHeight: 16,
  },
  salaryValue: {
    fontSize: 11.5,
    fontWeight: '800',
    color: FLEET_SALARY_COLOR,
    lineHeight: 13,
  },
  skillRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  skillPill: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 11,
    backgroundColor: FLEET_SKILL_PILL_BG,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  skillLabel: {
    fontSize: 8,
    color: FLEET_DRIVER_SKILL_LABEL,
    lineHeight: 10,
  },
  skillValue: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F3F7FF',
    lineHeight: 13,
  },
  moraleBlock: {
    marginTop: 8,
    gap: 3,
  },
  moraleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moraleTitle: {
    fontSize: 9.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  moralePercent: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  moraleCaption: {
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '600',
  },
  moraleCaptionSpacer: {
    height: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 9,
  },
  actionBtn: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  actionPrimary: {
    backgroundColor: colors.accentBlue,
  },
  actionPrimaryText: {
    fontSize: FLEET_DRIVER_ACTION_FONT_SIZE,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionTraining: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.55)',
  },
  actionTrainingText: {
    fontSize: FLEET_DRIVER_ACTION_FONT_SIZE,
    fontWeight: '700',
    color: '#22D3EE',
  },
  actionOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(90,135,195,0.48)',
  },
  actionOutlineText: {
    fontSize: FLEET_DRIVER_ACTION_FONT_SIZE,
    fontWeight: '700',
    color: FLEET_DRIVER_OUTLINE_TEXT,
  },
  actionNeutral: {
    backgroundColor: FLEET_DRIVER_NEUTRAL_BG,
    borderWidth: 1,
    borderColor: FLEET_DRIVER_NEUTRAL_BORDER,
  },
  moreDots: {
    fontSize: 12,
    fontWeight: '700',
    color: FLEET_DRIVER_MORE_DOTS_COLOR,
    lineHeight: 14,
    letterSpacing: 1,
  },
  actionDisabled: {
    opacity: 0.72,
  },
  actionDisabledText: {
    color: FLEET_DRIVER_ACTION_DISABLED_TEXT,
  },
});
